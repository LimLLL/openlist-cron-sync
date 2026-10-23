用途：定义触发、资源互斥、取消、重启与未知副作用隔离的行为。

范围：单进程调度；状态规范见[状态机](state-machines.md)，不提供多副本锁。

# 调度与恢复

## 职责归属

CoordinationModule是叶子模块，只依赖Config与Database，在进程内持有Run执行位、全局FIFO队列状态、路径占用、隔离路径检查、每Instance的API信号量与请求速率限制、每Job/Target的relay和server-copy文件名额，以及每Job的relay令牌桶。
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
3. 每Instance API并发和请求速率；其中至少一个API位优先服务认证/轮询/取消，正数配额下控制请求先于新提交；maxApiConcurrency=0时不设实例并发上限。chunk和complete不取API位。
4. 每Job sourceDownloadConcurrency限制relay源文件读取数；0不设隐藏并发上限。
5. 每Target concurrentFiles限制relay文件生命周期或server-copy未终态任务数；0不设隐藏并发上限。Target chunkConcurrency另限单文件chunk请求数（1–8）。
6. Job聚合带宽bucket只影响relay上传。不同Job的文件名额分别计数并相加；spool FIFO和SPOOL_RESERVE_BYTES提供唯一的磁盘背压。

路径比较键同时用于第2层路径占用和跨Job的unknown保护：

- 两个Instance记录的规范化baseUrl相同时，把各自的accountBasePath与路径按POSIX段连接成全局路径后比较，因此同一OpenList的两个账号记录不能绕过彼此的占用或隔离。
- 规范化baseUrl不同时，按(instance_id,path)比较。
- “相等/祖先后代”按完整路径段判断，`/a`不包含`/ab`。baseUrl与accountBasePath取Run快照中记录的值。

跨Job的未知Operation也保护路径。没有活动Run时，unknown不占整个Job名额。
以下迟到写入不在进程互斥保证内：无法观察的别名；OpenList已受理、仍在云端后台进行的复制（见[ADR 0005](../adr/0005-openlist-success.md)）；隔离到期后旧请求的迟到动作（见[ADR 0004](../adr/0004-quarantine-expiry.md)）。Run结束并释放路径占用，不代表这些云端动作已经结束。

## 取消与超时

POST cancel对非终态返回202、写cancelRequestedAt；重复请求不重复远程cancel。终态返回200现有Run。queued Run直接cancelled，不执行远程操作。
scanning/planned/executing进入cancelling：立即停止派发；pending→cancelled；本地扫描Abort；relay停止发送并对已记录session发一次有界abort；对已知tid发cancel并轮询到终态或cancelGrace到期。已派发的mkdir/remove/0字节put继续等待响应，已收到remove成功的delete继续确认读，二者都在cancelGrace内按[完成分类](openlist-integration.md#完成分类)记录结果。
宽限结束仍无终态的动作unknown并隔离；已知成功保留成功，不回滚。Run cancelled；终态通知策略见[通知](observability-notifications.md)。
recovering Run收到cancel：只写cancelRequestedAt，对仍未终态的已知tid每进程最多尝试一次cancel（用户请求与期限到期共用记录，崩溃后允许重复）；Run终态仍为interrupted+PROCESS_RESTART，不变为cancelled。
timeoutSeconds从startedAt计，不包含queue等待。RUN_TIMEOUT与USER_CANCEL都走相同收尾，stopReason区别。
执行中出现本地不可恢复错误且数据库仍可写：Run保持executing，不进入cancelling；停止派发，对已知远程动作执行上述取消步骤（abort relay session、cancel tid、最多等待cancelGrace，仍无终态记unknown），然后executing→failed，error_code=INTERNAL_ERROR。收尾期间进程重启时按executing→recovering→interrupted处理。数据库已不可写时fail-fast，交给下次启动恢复。

## 优雅停止

SIGTERM（计划内停止）不写任何Run终态，按以下顺序处理：

1. ready=false；停止新触发、派发、新的OpenList提交和维护循环。
2. Abort本地扫描和下载。已记录upload_id的relay在宽限内尝试multipart abort，结果按[relay结果分类](relay.md#结果分类)记录，通常为unknown并隔离；尚未提交的relay保持pending，重启时按PLAN_INTERRUPTED跳过。
3. 在SHUTDOWN_GRACE_SECONDS内持久化已经收到的响应与task结果。不对已知OpenList task发cancel，也不delete远程任务。宽限内仍无响应的请求保持submitting，正在确认的delete保持running，由下次启动按崩溃窗口及确认读处理。
4. 关闭HTTP连接池和数据库后退出。宽限到期时在途远端动作已中止；关闭流程另给本地持久化与资源释放固定5秒余量，仍未结束则以错误退出，不在晚回调存在时关闭数据库。

下次启动按[启动恢复](#启动恢复)处理：queued重新入队；scanning/planned→interrupted；executing/cancelling/recovering→recovering→interrupted（stopReason=PROCESS_RESTART）。因此计划内重启与强杀得到相同的Run终态，不取决于停止耗时。进程被强杀时没有第2–3步，submitting窗口同样由恢复识别。

## 启动恢复

启动恢复由RunsModule执行：先在CoordinationModule中重建全部未决路径占用与隔离，再置ready、恢复queued、注册cron和启动维护；已知task的跟踪在后台有界进行。

| 旧状态                                 | 行为                                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| queued                                 | 保留配置、createdAt与queueDeadlineAt重新入队；已过期则failed，error_code=QUEUE_TIMEOUT                                                                                                                              |
| scanning/planned                       | interrupted（stopReason=PROCESS_RESTART）；pending→skipped，error_code=PLAN_INTERRUPTED；不执行旧计划                                                                                                               |
| executing/cancelling/recovering        | recovering；同一事务将剩余pending标skipped（error_code=PLAN_INTERRUPTED）；recovery_deadline_at仅在首次进入recovering时写入，后续重启沿用；保留路径占用，已知task恢复info跟踪                                       |
| submitting且无可靠响应                 | unknown，不通过名字猜task                                                                                                                                                                                           |
| running且无tid（delete已收到成功响应） | 在恢复期限内只做refresh=true确认读：原名消失→succeeded；仍存在且已有结束证据→按DELETE_NOT_EFFECTIVE规则；无法确认→unknown                                                                                           |
| relay（本服务进程已退出）              | 有upload_id：恢复期限内按upload_id查status并尝试abort，没有可靠完成证据则unknown（completed后session即被移除，查不到不代表失败）；已写submitting但无upload_id：unknown；尚未提交的pending：skipped PLAN_INTERRUPTED |

启动时先重建未决责任，再清空spool。恢复不派发旧pending，不续传relay，也不继续旧multipart session；确认读只读取，不算派发。到recovery_deadline_at，未取得终态的已知task进入最终cancel及确认宽限；宽限末仍未明确终止则unknown并按[Unknown隔离](#unknown隔离)处理，记录原tid。
relay已持久化multipart_state=completed且source_stream_completed_at非NULL时，直接采用该完成证据收敛为succeeded；不能因之后status返回404而丢失证据。仅在内存收到过响应不满足此条件。
恢复完成Run统一interrupted（stopReason=PROCESS_RESTART），即使已知task全部成功；具体Operation结果仍保留。
下一次cron或人工Run重新扫描；manual-only Job不自动产生新Run。通知delivery的重启处理见[投递](observability-notifications.md#投递)。

## Unknown隔离

unknown用于请求可能已到达OpenList却得不到可靠结论的情形：超时、连接中断或进程在submitting崩溃；已知tid查询为task not found；OpenList返回JSON 500后的一次有界观察无法判定；取消或恢复期限届满仍无终态证据；relay的init或complete响应丢失，或取消/关机时abort后没有结束证据。OpenList明确的执行前拒绝是failed，不隔离。完整分类见[OperationStatus](state-machines.md#operation-status)。

unknown事务写unknown_since、unknown_until=since+quarantineSeconds，以及目标路径和tid或upload_id（若有）。适用于所有可能生效的变更，包括mkdir。quarantineSeconds下限为35分钟，覆盖OpenList分片session的30分钟闲置TTL及其GC间隔。
Run内Operation的quarantineSeconds取该Run快照；维护器创建的Operation（REMOTE_TASK_CHANGED）的quarantineSeconds及重试/确认设置使用进程当前有效配置。unknown_until持久化，重启不重新计时。
受影响路径为target_path。active条件：resolution_kind为空、quarantine_released_at为空且now<unknown_until。active期间禁止写受影响路径、禁止删除其祖先目录；目录动作还保护全部后代。路径按[资源层级](#资源层级)中的比较键匹配。

到期或管理员提前release后进入reobserve_required（派生事实，不存enum）；abandon直接结束该记录，见下：

`reobserve_required = (now ≥ unknown_until 或 quarantine_released_at非空) 且 resolution_kind为空`

- 之后任何要写这些路径或删除其祖先的非dry-run Run，必须先用refresh=true读取全部受影响父目录。
- 读取失败、视图可疑（定义见[可疑视图](deletion.md#可疑视图)）或资源超限时，本轮不写这些路径。过期不重放旧请求。
- 首个成功读取全部受影响父目录的非dry-run Run在该次事务中写reobserved_at。刷新义务持续到记录resolution为止，每个后续Run都要重新读取。
- abandon事务在quarantine_released_at为空时同时写quarantine_released_at=now及原因，abandon结束该记录的unknown责任及刷新义务；若仍有remote_cleanup_pending则task责任由维护器结束；之后的Run按普通扫描处理，删除前的refresh复查照常执行。

读取成功后按当前源目标状态规划：目标符合当前源→正常unchanged，可记录observed resolution；缺失→create；不同大小→按删除链；冲突→保护。
历史unknown保持unknown。观察满足条件只是产品层面的resolution，不证明迟到写入已停止；自动到期、人工release与abandon都接受此风险（见[ADR 0004](../adr/0004-quarantine-expiry.md)）。

管理员在OpenList中手动重试本服务已记为终态的task并使其重新运行，属于“运行期间目标只由本服务写入”前提之外的动作。维护器仅在原remote_state从远程终态变为非终态时，在原Operation的同一run/run_target插入一条新Operation：action/method/target_path与原行相同，status=unknown，error_code=REMOTE_TASK_CHANGED，caused_by_operation_id指向原行，tid列为NULL，并按上文写入隔离。同一事务更新原remote_state，后续仍处于非终态的轮询不重复插入。原行保持本地终态和remote_cleanup_pending=1，task再次远程终态后再delete_some；因超时而本地unknown、远程一直未结束的task不属于REMOTE_TASK_CHANGED。

到期后的观察必须按action解释，不能对所有unknown套用“同名同大小成功”：

| 原未知动作       | 新鲜观察                           | 本地后续事实                                                             |
| ---------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| mkdir            | 目标路径是目录                     | observed resolution                                                      |
| mkdir            | 缺失                               | 按普通计划mkdir；新mkdir成功后旧unknown记superseded                      |
| mkdir            | 是文件                             | TYPE_CONFLICT，保护该路径                                                |
| create           | 当前source与Target同名同类型同大小 | observed resolution                                                      |
| create           | 缺失/大小不符                      | 本次按普通计划create或delete→create；新create成功后旧unknown记superseded |
| delete（remove） | 原路径已缺失                       | observed resolution                                                      |
| delete（remove） | 原路径仍存在                       | 旧unknown保持未决；新计划可用新Operation再次删除；之后按本表对应行观察   |
| 任意             | source消失、被过滤或类型冲突       | 按当前模式/保护规则规划                                                  |

superseded只在同一instance_id+target_path上后续有succeeded的Operation、且它覆盖该unknown全部受影响路径时写入。
相同路径匹配只能支持本产品的观察结论，不提供内容证明。已到期且完成必要刷新后，未能解决旧事实本身不再次永久阻塞当前合法计划；旧责任继续保留，直至后续结果写observed/superseded或管理员abandoned。
正常Run因active隔离或重新观察读取失败而跳过的动作标skipped并写error_code=PREVIOUS_OUTCOME_UNKNOWN，Run partial，该Target extras禁止。dry-run展示隔离和到期策略，不执行释放/解决事务，也不写reobserved_at。

## 配置修改

更新Job配置期间有非终态Run返回409；enable/disable是明确例外，仅更新enabled和updatedAt，不改变活动Run快照。Instance地址、账号、base_path变化在存在[未决责任](data-model.md#responsibility)时返回409 ENDPOINT_IN_USE；同地址同账号凭据修复允许。
token模式的PATCH无法当场确认账号，因此每次/api/me成功（连接测试、未测试后的首次使用、重新登录）都把返回的base_path和username与已存值比较；有未决责任且不一致时不覆盖已存值，把Instance置auth_blocked（reason=ACCOUNT_CHANGED），阻断其操作直至管理员处理相关责任。见[认证与实例身份](openlist-integration.md#认证与实例身份)。
提前release API只能写时间和原因；operation.resolve abandoned可用于任一unknown，结束该记录的unknown责任与刷新义务，不清除remote_cleanup_pending或释放task额度；剩余task跟踪由维护器按当前责任分类结束。用户删除Job也不抹去这些责任。
再观察和维护时始终使用记录中固定的身份。Instance地址或账号变更后，不能把旧隔离重新绑定到新身份（存在责任时该变更本身已被409拒绝）；这不影响按[资源层级](#资源层级)比较键对规范化baseUrl相同的别名Instance实施的保护。

## 时序来源

见[时序说明](sequences.md)。期限为风险策略，不是远端取消证明；[AWS超时与重试说明](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)用于解释限制，不引入外部幂等服务。

本轮路径密码快照保留到Run终态事务（含恢复后的interrupted），该事务清除secret_snapshot_enc。后续再观察由新Run使用自己的密码快照；旧unknown仅保留路径和身份责任。缺失父目录可由账号命名空间内最近已有祖先的refresh=true完整非可疑列表证明缺失分支；读取错误不能当作缺失。隔离不阻止作为其他Job的source读取，因此本服务自身迟到写入仍可能被新Run读到，目标独占不能消除此风险。

## M4–M6合并契约

已布置的cron定时器迟到时仍触发一次，保留注册时记住的理论scheduledAt；同次timer的重复回调在注册内合并，下一时刻从当前时间计算，重启不补跑。next-fire-times的count为最大数量，仅返回固定cron库八年搜索范围内的前缀。无下一时刻的表达式保存/启用时INVALID_CRON。

启动重建时，存量enabled Job若未通过调度校验（例如旧版本保存的二月31日），只跳过该Job并记录warn `Cron registration skipped`，不修改配置；其它合法Job正常注册。数据库或其它非ApiError失败仍fail-fast；配置提交后的意外注册失败也fail-fast，不与存量校验失败混淆。

启动闸门指路径责任及task额度重建完成，已知tid继续后台恢复。恢复期限结束普通观察；最终cancel和确认宽限由持久recoveryDeadlineAt（或更早cancelRequestedAt）推导，重启不延长。每tid每进程最多尝试一次cancel，崩溃后可重复；不增加cancel列。SIGTERM不cancel/delete任务。

已知tid非终态或不可观察保留额度；远程终态或info404释放。无可靠tid释放提交预留但保留unknown。维护放弃housekeeping跟踪也释放额度；隔离到期或resolution本身不释放。任务owner跨执行、恢复、维护共享。
