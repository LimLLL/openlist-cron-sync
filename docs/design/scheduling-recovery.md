用途：定义触发、资源互斥、取消、重启与未知结果历史的行为。

范围：单进程调度；状态规范见[状态机](state-machines.md)，不提供多副本锁。

# 调度与恢复

## 职责归属

CoordinationModule是叶子模块，只依赖Config与Database，在进程内持有Run执行位、全局FIFO队列状态、路径占用、按Instance ID与全局路径首段共享的扫描间隔、每Job/Target的relay和server-copy文件名额，以及每Job的relay令牌桶。
RunsModule负责接受触发（建立queued Run）、派发、取消和启动恢复；SchedulingModule只注册cron，并在触发时调用RunsModule的触发服务。MaintenanceModule、SyncModule、RelayModule都通过CoordinationModule使用同一套占用与配额，不另建资源池。模块依赖见[架构](architecture.md)。

现有FIFO、执行位、队列过期、Run期限、路径互斥和恢复被cron、relay及server_copy共用。恢复闸门仅等待责任及task额度重建，不等待远程task全部结束。

## 触发和队列

cron使用直接依赖cron的CronJob，由@nestjs/schedule的SchedulerRegistry管理；手动REST请求与cron回调都进入RunsModule的同一个触发服务。5段分钟表达式，不接受秒、@reboot或自然语言日期；timezone使用IANA。
计算nextFire和实际注册使用同一版本cron。MVP遵循该库的DST规则，不自行补齐缺失时刻、不自行去重重复当地时间。next-fire-times API输出UTC时间及Job的IANA timezone，由客户端换算当地时间和UTC offset。测试固定Europe/Berlin缺失/重复时刻并锁定依赖版本行为。
重启不补错过的cron。Job disabled禁止cron但允许显式手动Run；归档Job禁止所有触发。
同Job存在queued/scanning/planned/executing/cancelling/recovering时：手动返回409 JOB_BUSY，cron不创建Run，仅记录一次跳过事件。queued也占Job名额。
全局队列按createdAt,id FIFO；遇到路径忙可让不冲突后项运行，保持每Job只有一个候选。队列满手动503 QUEUE_FULL、cron记录跳过。队列用最近截止时间唤醒，过期处理不依赖有空闲执行位。到queueDeadlineAt仍未开始的Run直接failed，写error_code=QUEUE_TIMEOUT、stop_reason=NULL，startedAt保持NULL。

## 资源层级

1. Run执行位：含扫描及执行，恢复中的Run只保留路径占用，不占新Run执行位。
2. 路径占用：真实Run的source只读、targets写；dry-run全部endpoint只读；read/read可并行，write/write和write/read的相等/祖先后代关系互斥。
3. 扫描间隔：Job sourceScanIntervalSeconds与每Target scanIntervalSeconds只拉开目录请求的开始时间，见[扫描间隔](#扫描间隔)。本地不再有每Instance的API并发或速率配额；需间隔的请求等待FIFO派发顺序，其余请求不经过该队列。
4. 每Job sourceDownloadConcurrency限制所有Target共享的未完成源读取数；源位先于首块spool预留取得，验证精确长度与正常EOF并关闭源后释放。spool背压、Range恢复期间仍占位；0不设隐藏并发上限。
5. 每Target concurrentFiles限制relay准备、上传、等待complete及收尾的文件数，或server-copy未终态任务数；mkdir与文件extras阶段也按同一值派发，目录extras逐个执行；0不设隐藏并发上限。Target chunkConcurrency另限单文件chunk请求数（1–8）。
6. Job聚合带宽bucket只影响relay上传。不同Job的文件名额分别计数并相加；spool FIFO和SPOOL_RESERVE_BYTES提供唯一的磁盘背压。

路径比较键用于第2层路径占用：

- 两个Instance记录的规范化baseUrl相同时，把各自的accountBasePath与路径按POSIX段连接成全局路径后比较，因此同一OpenList的两个账号记录不能绕过彼此的路径占用。
- 规范化baseUrl不同时，按(instance_id,path)比较。
- “相等/祖先后代”按完整路径段判断，`/a`不包含`/ab`。baseUrl与accountBasePath取Run快照中记录的值。

历史 unknown 不保护路径，也不占 Job 名额。
以下迟到写入不在进程互斥保证内：无法观察的别名；OpenList已受理、仍在云端后台进行的复制（见[ADR 0005](../adr/0005-openlist-success.md)）；旧请求的迟到动作（见[ADR 0004](../adr/0004-unknown-outcomes.md)）。Run结束并释放路径占用，不代表这些云端动作已经结束。

## 扫描间隔

间隔按“Instance ID + 规范化全局路径（accountBasePath与账号路径按POSIX段连接）的第一段”分组，全局根路径`/`单独成组；同组由所有Job、Target以及源/目标角色共享，进程内存保存上次实际开始时间，Run结束后仍保留，重启清空。例如账号根为`/drive/team`、账号路径为`/photos`时，分组首段为`drive`；相同URL的不同Instance ID不共享间隔。

- 无历史开始时间时首个请求立即开始；之后每组FIFO发放开始顺序；每个调用方用自己冻结的间隔对比上次实际开始时间（开始到开始），因此同组不同间隔不会合成单一速率，0间隔的请求也不越过先到者。
- 只约束请求开始，不占用响应期容量：上一个请求未返回也可按时开始下一个。
- 源间隔覆盖源树扫描（含刷新与回退列举）。目标间隔覆盖目标树扫描、强制刷新、根/父目录证明、mkdir后的根目录校验、目录删除前的空目录检查，以及同步发出的全部mkdir和remove（文件extras、目录extras、替换链删除、重试清理）。
- 不受间隔约束：fs/get、下载、multipart全部请求、空文件put、复制提交、单条目观察（删除确认、恢复结果检查、server_copy源校验、中转签名刷新，即使底层用fs/list）、task查询/取消/删除、实例测试与浏览、登录、/me、公开设置及存储发现。
- 等待受Run停止、文件期限和进程关闭约束；排队中被取消的请求不派发、不进入submitting，也不推进开始时间。读取重试先退避再重新排队；401后的重放在认证恢复后重新排队。
- 间隔等待不计入OPENLIST_API_TIMEOUT_MS，但计入Run期限及适用的文件期限。执行期已准入动作在等待期间仍占Target名额；扫描期不占文件名额。已派发的写请求使用已有的在途/收尾期限，Run停止不再直接截断这些写请求的响应；扫描读取仍随Run停止中止。

## 取消与超时

POST cancel对非终态返回202、写cancelRequestedAt；重复请求不重复远程cancel。终态返回200现有Run。queued Run直接cancelled，不执行远程操作。
scanning/planned/executing进入cancelling：立即停止派发；pending→cancelled；本地扫描Abort；relay停止发送并对已记录session发一次有界abort；对已知tid发cancel并轮询到终态或cancelGrace到期。已派发的mkdir/remove/0字节put继续等待响应，已收到remove成功的delete继续确认读，二者都在cancelGrace内按[完成分类](openlist-integration.md#完成分类)记录结果。
宽限结束仍无终态的动作unknown；已知成功保留成功，不回滚。Run cancelled；终态通知策略见[通知](observability-notifications.md)。
recovering Run收到cancel：只写cancelRequestedAt，对仍未终态的已知tid每进程最多尝试一次cancel（用户请求与期限到期共用记录，崩溃后允许重复）；Run终态仍为interrupted+PROCESS_RESTART，不变为cancelled。
timeoutSeconds从startedAt计，不包含queue等待。RUN_TIMEOUT与USER_CANCEL都走相同收尾，stopReason区别。
执行中出现本地不可恢复错误且数据库仍可写：Run保持executing，不进入cancelling；停止派发，对已知远程动作执行上述取消步骤（abort relay session、cancel tid、最多等待cancelGrace，仍无终态记unknown），然后executing→failed，error_code=INTERNAL_ERROR。收尾期间进程重启时按executing→recovering→interrupted处理。数据库已不可写时fail-fast，交给下次启动恢复。

## 优雅停止

SIGTERM（计划内停止）不写任何Run终态，按以下顺序处理：

1. ready=false；停止新触发、派发、新的OpenList提交和维护循环。
2. Abort本地扫描和下载。已记录upload_id的relay在宽限内尝试multipart abort，结果按[relay结果分类](relay.md#结果分类)记录，通常为unknown；尚未提交的relay保持pending，重启时按PLAN_INTERRUPTED跳过。
3. 在SHUTDOWN_GRACE_SECONDS内持久化已经收到的响应与task结果。不对已知OpenList task发cancel，也不delete远程任务。宽限内仍无响应的请求保持submitting，正在确认的delete保持running，由下次启动按崩溃窗口及确认读处理。
4. 关闭HTTP连接池和数据库后退出。宽限到期时在途远端动作已中止；关闭流程另给本地持久化与资源释放固定5秒余量，仍未结束则以错误退出，不在晚回调存在时关闭数据库。

下次启动按[启动恢复](#启动恢复)处理：queued重新入队；scanning/planned→interrupted；executing/cancelling/recovering→recovering→interrupted（stopReason=PROCESS_RESTART）。因此计划内重启与强杀得到相同的Run终态，不取决于停止耗时。进程被强杀时没有第2–3步，submitting窗口同样由恢复识别。

## 启动恢复

启动恢复由RunsModule执行：先在CoordinationModule中重建非终态 Run 路径占用和未结束 task 额度，再置ready、恢复queued、注册cron和启动维护；已知task的跟踪在后台有界进行。

| 旧状态                                 | 行为                                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| queued                                 | 保留配置、createdAt与queueDeadlineAt重新入队；已过期则failed，error_code=QUEUE_TIMEOUT                                                                                                                              |
| scanning/planned                       | interrupted（stopReason=PROCESS_RESTART）；pending→skipped，error_code=PLAN_INTERRUPTED；不执行旧计划                                                                                                               |
| executing/cancelling/recovering        | recovering；同一事务将剩余pending标skipped（error_code=PLAN_INTERRUPTED）；recovery_deadline_at仅在首次进入recovering时写入，后续重启沿用；保留路径占用，已知task恢复info跟踪                                       |
| submitting且无可靠响应                 | unknown，不通过名字猜task                                                                                                                                                                                           |
| running且无tid（delete已收到成功响应） | 在恢复期限内只做refresh=true确认读：原名消失→succeeded；仍存在且已有结束证据→按DELETE_NOT_EFFECTIVE规则；无法确认→unknown                                                                                           |
| relay（本服务进程已退出）              | 有upload_id：恢复期限内按upload_id查status并尝试abort，没有可靠完成证据则unknown（completed后session即被移除，查不到不代表失败）；已写submitting但无upload_id：unknown；尚未提交的pending：skipped PLAN_INTERRUPTED |

启动时先重建未决责任，再清空spool。恢复不派发旧pending，不续传relay，也不继续旧multipart session；确认读只读取，不算派发。到recovery_deadline_at，未取得终态的已知task进入最终cancel及确认宽限；宽限末仍未明确终止则unknown，记录原tid。
relay已持久化multipart_state=completed且source_stream_completed_at非NULL时，直接采用该完成证据收敛为succeeded；不能因之后status返回404而丢失证据。仅在内存收到过响应不满足此条件。
恢复完成Run统一interrupted（stopReason=PROCESS_RESTART），即使已知task全部成功；具体Operation结果仍保留。
下一次cron或人工Run重新扫描；manual-only Job不自动产生新Run。通知delivery的重启处理见[投递](observability-notifications.md#投递)。

## Unknown历史

unknown 用于变更请求可能已经到达 OpenList、但没有可靠结果证据的情形，完整分类见[OperationStatus](state-machines.md#operation-status)。事务保存 unknown_since、目标路径及已知 tid/upload_id，不设置期限，不改写历史结果。

同一 Run 不重试 unknown；未知父 mkdir 阻止子操作，未知替换 delete 阻止依赖 create，创建阶段的未知结果仍阻止该 Target 的 mirror extras。后续 Run 忽略历史 unknown，按自己的配置快照和扫描视图重新规划，不额外强制刷新；删除前提和确认仍为 refresh=true。

server_copy 不因历史任务仍运行而按路径跳过，但未结束的已知任务继续占用该稳定 Target 的 concurrentFiles。活动 Run 的读写路径互斥独立保留。

维护观察到原远程任务从终态变为非终态，只更新原行 remote_state 并记录一次日志，不新增 Operation。原 status 和 Run 统计不变；任务再次终态才删除其远程记录。旧版本留下的 REMOTE_TASK_CHANGED 行仅为历史，默认运行操作列表和所有执行统计排除这些行。

后续扫描不保证修复同大小错误内容、TYPE_CONFLICT、持续缓存缺失的差异或无人再运行的目标；incremental 和过滤规则可能保留迟到 extras。目标作为另一 Job 的 source 时可能传播临时状态，OneDrive mkdir 也可能留下改名空目录。风险见[ADR 0004](../adr/0004-unknown-outcomes.md)。

## 配置修改

更新Job配置期间有非终态Run返回409；enable/disable是明确例外，仅更新enabled和updatedAt，不改变活动Run快照。Instance地址、账号、base_path变化在存在[未决责任](data-model.md#responsibility)时返回409 ENDPOINT_IN_USE；同地址同账号凭据修复允许。
token模式的PATCH无法当场确认账号，因此每次/api/me成功（连接测试、未测试后的首次使用、重新登录）都把返回的base_path和username与已存值比较；有未决责任且不一致时不覆盖已存值，把Instance置auth_blocked（reason=ACCOUNT_CHANGED），阻断其操作直至管理员处理相关责任。见[认证与实例身份](openlist-integration.md#认证与实例身份)。

## 时序来源

见[时序说明](sequences.md)。本地期限不是远端取消证明；[AWS超时与重试说明](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)用于解释限制，不引入外部幂等服务。

本轮路径密码快照保留到 Run 终态事务（含恢复后的 interrupted），该事务清除 secret_snapshot_enc。后续 Run 使用自己的密码与身份快照；维护已知 task 仍使用原 Run 固定的身份和当前凭据。历史 unknown 不阻止实例身份修改；活动 Run 或待删除的远程任务记录仍阻止身份变化。迟到的目标变化可能被将其作为 source 的另一个 Job 读取。

## M4–M6合并契约

已布置的cron定时器迟到时仍触发一次，保留注册时记住的理论scheduledAt；同次timer的重复回调在注册内合并，下一时刻从当前时间计算，重启不补跑。next-fire-times的count为最大数量，仅返回固定cron库八年搜索范围内的前缀。无下一时刻的表达式保存/启用时INVALID_CRON。

启动重建时，存量enabled Job若未通过调度校验（例如旧版本保存的二月31日），只跳过该Job并记录warn `Cron registration skipped`，不修改配置；其它合法Job正常注册。数据库或其它非ApiError失败仍fail-fast；配置提交后的意外注册失败也fail-fast，不与存量校验失败混淆。

启动闸门指路径责任及task额度重建完成，已知tid继续后台恢复。恢复期限结束普通观察；最终cancel和确认宽限由持久recoveryDeadlineAt（或更早cancelRequestedAt）推导，重启不延长。每tid每进程最多尝试一次cancel，崩溃后可重复；不增加cancel列。SIGTERM不cancel/delete任务。

执行及恢复期间已知 tid 非终态或暂时不可观察时保留额度；远程终态或 info404 释放。无可靠 tid 释放提交预留但保留 unknown 历史。遗留任务维护在有界观察/删除失败后记录日志、结束本地跟踪并释放额度；观察仍为非终态则继续占用。task owner 跨执行、恢复、维护共享。
