用途：定义 OpenList client 的认证、路径、错误、任务和缓存契约，并规定变更请求结果的分类规则。

范围：本服务调用的 OpenList v4 公开文件API（源码基准见[依赖表](../reference/openlist-api.md#兼容版本)）；逐接口字段见[依赖表](../reference/openlist-api.md)；本文[完成分类](#完成分类)是变更结果分类的唯一规范。

# OpenList集成

## 认证与实例身份

token模式使用管理员静态token，Authorization直接传token，不加Bearer。password模式用username和原始密码生成SHA256(password + '-https://github.com/alist-org/alist')调用login/hash；HTTP仍需TLS或可信内网。
登录后GET /api/me取得base_path、role、permission、username。不得把API成功但实际guest视为连接成功。OpenList重启清空JWT有效token缓存，静态token不受此影响。

| 场景                            | 行为                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| 普通API JSON401，password模式   | 按失效token single-flight重新登录一次，再重放可重放请求一次     |
| 旧token迟到401，但已拿到新token | 使用新token，不再次登录                                         |
| 登录401/402                     | 持久auth_blocked，无自动再登录；更新凭据或显式人工重试恢复      |
| 登录429                         | auth_blocked，blockedUntil=now+冷却；之后下一实际请求只尝试一次 |
| 静态token401                    | auth_blocked，不转password                                      |
| 登录网络错误                    | 一次调用失败；不并发探测，不把失败当密码错误                    |
| auth_blocked                    | 相关请求立即失败AUTH_BLOCKED；不让cron每次再次登录              |

连接测试还读取公开的/api/public/settings：version低于4.2.5时测试失败（OPENLIST_VERSION_UNSUPPORTED），该Instance不能用于任何Job；multipart_enabled=false时报告MULTIPART_DISABLED，该Instance不能作为relay目标；multipart_chunk_size只展示。不得用multipart init做连接测试，因为init会写目标。
连接测试的retryAuth=true是明确人工一次尝试；429冷却内仍返回409。401/402人工测试仅一次，不能被自动循环调用。
失败计数按OpenList看到的IP共享，前五次不衰减，第六次开始429，锁定期间每次请求延长5分钟。不能承诺10分钟冷却必定解锁，其他协议/用户可能持续触发。
路径密码错误403不触发账号登录。JWT只缓存内存；实例auth_blocked状态持久化防止重启绕过。

账号身份核对：每次/api/me成功（连接测试、untested后首次使用、重新登录）都把返回的base_path和username与实例已保存的accountBasePath和账号用户名比较；token模式同样保存/api/me返回的username。实例没有未决责任（与Instance编辑使用同一责任判断，见[数据模型](data-model.md)）时用新值覆盖。有未决责任且任一值不同时不覆盖旧值，实例置auth_blocked、原因ACCOUNT_CHANGED，相关操作立即失败，直到管理员处理这些责任，或换回原账号凭据（实例回到untested后重新核对）。PATCH本身不调用OpenList，因此只有这一步能阻止token模式换成另一账号的token绕过“有责任时禁止身份变化”。

### M1 实现边界

认证阻断由 Security 的 `InstanceAuthState` 持久化，所有 OpenList 调用共享 `OpenListAuth`，不依赖 Instances controller。JWT 只在进程内；重启后重新登录仍先检查持久阻断。`authBlockReason` 的认证值为 `LOGIN_401`、`LOGIN_402`、`LOGIN_429`、`TOKEN_401`、`GUEST`、`MISSING_SECRET`；M2起责任冲突使用 `ACCOUNT_CHANGED`。登录网络错误不写入凭据阻断。成功登录后先验证 `/api/me` 再发布会话。

M1 尚无 jobs/runs/operations，身份比较后允许覆盖。M2 已接入非归档Job引用检查和真实未决责任查询（三项谓词完整）：Instances PATCH/DELETE执行ENDPOINT_IN_USE，Security在同一事务核对责任和保存身份，冲突持久化ACCOUNT_CHANGED且保留旧身份。downloadMode有非终态Run引用时不可改；limits已删除，创建或PATCH携带该字段（包括{}）返回400 VALIDATION_ERROR；同身份凭据可修复。PATCH仍不访问上游，不提供恒false占位函数。

M1 客户端只返回协议事实；不执行 observe-after-500、unknown 历史、任务状态推进或 relay。`putEmpty` 若意外收到 `data.task`，属于协议异常，M3将其记为unknown，错误摘要UPSTREAM_PROTOCOL_ERROR；不持久化tid或引入上传task跟踪。chunk/complete 与 0 字节 put 必须由调用方传入截止信号，不使用普通 API 的短超时：chunk 用于分片传输，complete 与同步 put 等待上游提交结果；建连仍受连接超时约束。init/status/abort 使用每次尝试独立的普通请求期限。网络失败与中止的错误摘要为 `OpenList <方法> <固定端点路径>: <原因>`，原因区分单次 API 超时、连接/响应头/响应体超时、调用方期限或取消与网络失败；不含 query、实例地址、文件路径或秘密。仅派发等待信号中止、在途信号尚未中止且请求未派发时，摘要额外带 `before dispatch`；不能仅凭没有该后缀推断已派发。全部 multipart 请求均不受扫描间隔约束；实例 API 配额及控制请求优先级已删除。人工重试（retryAuth=true）只越过持久阻断尝试一次，阻断在该次尝试成功前保持不变，网络失败不会解除。

## 路径与URL

文件API body中的path/src_dir/dst_dir/dir、File-Path均相对账号base_path，前导/是账号根。GET /d和/p路径为OpenList全局虚拟路径，不使用账号JoinPath。
连接后将accountBasePath与endpoint path按POSIX段连接得到全局下载路径；URL每段编码，query sign独立编码。baseUrl允许反向代理子路径，追加api/d/p时保留该前缀。
不双重编码JSON路径；File-Path执行一次URL path编码。对%、+、#、?、中文、emoji、空格做往返测试，对`a\b`、`..\x`、`..\..\x`做逃逸测试。密码、token、sign和下载URL不写日志。
OpenList对每个API路径及/d、/p路径执行FixAndCleanPath：先把`\`替换为`/`，再做path.Clean；copy/move/remove的handler则先把names[]与src_dir/dir拼接，之后才规范化。因此名称含`\`的条目绝不能放入names[]、File-Path或/d、/p URL：`a\b`会指向子目录b中的对象，names[]中的`..\x`可解析到endpoint根之外。此类名称按[路径规范](filters-paths.md#路径规范)记INVALID_NAME并保护其父目录。
创建方式由每个Target独立选择（见[创建方式](sync-engine.md#创建方式)）：relay对任意实例关系都下载再上传；server_copy只用于同一Instance，同storage或跨storage都走/api/fs/copy，返回task时跟踪。本服务不调用/api/fs/move。

## envelope与错误

先检查真实HTTP状态/内容类型/响应大小，再解析{code,message,data}。HTTP200+code非200为失败；代理502/HTML不是成功。未知结构为UPSTREAM_PROTOCOL_ERROR，不猜测data。
fs/list、fs/get缺失可返回code500，不能按码或消息把它当absent；用成功父目录列表中的缺名判定（Target根缺失与不可用的区分见[同步引擎](sync-engine.md)）。fs/get无refresh且可能读Temp/负缓存，不能证明目标实际存在或缺失。

下表适用于读取与认证。变更请求（mkdir、copy、remove、0字节put）的结果一律按[完成分类](#完成分类)判定；multipart请求见[relay结果分类](relay.md#结果分类)。

| 类别         | 示例                                  | 处理                                                    |
| ------------ | ------------------------------------- | ------------------------------------------------------- |
| 读取瞬时错误 | 网络断开、HTTP502/503、JSON500        | 按`RETRY_*`有界退避；耗尽即读取失败，不解释为缺失       |
| 流量限制     | HTTP/JSON429                          | Retry-After有值则尊重，最长受Run deadline约束；否则退避 |
| 永久错误     | 权限403、请求400、不支持405、凭据阻断 | 不自动重复                                              |
| 下载401      | /d自身签名失败                        | 重新list取sign一次，不账号登录；云端401另报下载失败     |

不按message字符串分支，不维护任意云盘错误字符串规则引擎。真实HTTP重定向对API管理请求禁用，避免凭据换域；下载使用受控重定向。M1 不保存或转发上游 message，统一生成只含 HTTP/应用码的摘要，因此不会保留 URL、凭据或 storage addition。通用上游失败使用OPENLIST_ERROR并保存脱敏摘要；协议异常用UPSTREAM_PROTOCOL_ERROR，不能把任意上游message变成新的业务code。
HTTP层自动重放只用于读取和明确尚未执行的认证拒绝（JSON401重新登录后重放一次）。变更不在HTTP层重放；failed后的再次尝试按[状态机](state-machines.md)创建新Operation。multipart chunk只在同一session内按[relay规则](relay.md#单文件流程)重传；其他上传body不在HTTP层重放。

## 任务跟踪

OpenList任务只来自server_copy（同storage驱动未实现Copy时的回退，或跨storage复制）。按(instanceId,tid)逐个POST copy任务的info，每个任务按taskPollMs带抖动轮询；不使用undone/done列表，避免历史无界响应。
单次info的瞬时失败（网络、HTTP 5xx、JSON500）按`RETRY_*`有界重试；重试耗尽不改变Operation状态，下一周期继续轮询，直到Run deadlineAt（之后走取消流程：cancel、等待cancelGrace、仍无终态则unknown），恢复期间则直到recoveryDeadlineAt。info返回JSON404 task not found（OpenList重启且未持久化任务、任务被管理员删除或不可见）时立即unknown。不另设info失败次数配置。
state0/5/8/9保持submitted；1/3/6保持running；2为成功、4取消、7失败。未知数值为协议错误，有界查询后仍无法分类则unknown。远程progress只展示，不驱动状态。

先持久化本地结果，再确认remote_state为2/4/7，才POST delete_some数组id。Operation本地unknown也是终态，但不是远程已停止的证据，不能据此delete。解析data逐id错误；非空map不直接按message判断task是否丢失，而是对该id再info：404表示已不存在，其他情况按下面的清理规则处理。只清理本服务的远程终态id，不delete运行任务，不retry、不clear_*。
删除时逐 id 返回 task not found，或 info 返回 JSON404，表示远程记录已不存在：清除 remoteCleanupPending，绝不改动 Operation 结果。实时执行中的其他删除失败保留标志交维护。

遗留任务维护统一使用进程当前有效的 RETRY_* 预算。先 info，非终态继续占用 Target 文件额度；终态才删除任务记录。观察或删除在预算内失败时记录日志、清除本地标志并释放额度，不因原结果 unknown 永久保留责任。远程任务记录删除不修改目标文件。

维护 info 发现任务从 2/4/7 回到非终态时，只更新原尝试的 remote_state 并记录一次日志。原 Operation status 和 Run 统计保持不变，不新增操作或尝试；任务仍非终态时不删除，后续终态后再 delete_some。不存在按历史任务状态阻止同路径新计划的规则；实际任务并发额度仍适用。

取消先调用cancel再观察；取消响应不是任务已停止。删除API记录不代表终止后台动作。

## 完成分类

<a id="mutation-outcome"></a>

本节是mkdir、copy、remove与0字节put请求结果分类的唯一规范，[状态机](state-machines.md)、[同步引擎](sync-engine.md)和[relay](relay.md)均引用本节；multipart的init、chunk、complete另见[relay结果分类](relay.md#结果分类)。分类不依赖OpenList message字符串。先判定是否获得有效envelope；无法解析或超过响应上限的变更响应，若请求可能已到达远端，按unknown处理，不能作为可重试的明确失败。

| OpenList响应                                                                                                                                                                                       | 含义                       | Operation结果                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 执行前明确拒绝：JSON400；JSON401（先按认证表重新登录并重放一次，上传body不重放）；JSON403（权限不足、`file [name] exists`/`file exists`、`system file upload ignored`）；JSON405；本地AUTH_BLOCKED | OpenList未执行             | failed，无需观察；AUTH_BLOCKED或通用OPENLIST_ERROR，不按403的message细分；不在本Run内重试。PRECONDITION_CHANGED仅用于本服务删除提交前刷新发现的变化 |
| 其他非成功code（通常为JSON500）                                                                                                                                                                    | OpenList已处理完请求但报错 | 做一次有界观察，按下表判定                                                                                                                          |
| 无响应、超时、连接中断（请求可能已到达OpenList）；非OpenList envelope的代理错误；已知tid查询task not found；submitting中进程崩溃                                                                   | 请求可能仍在途             | unknown，保留[历史结果](scheduling-recovery.md#unknown历史)                                                                                         |
| code200且无task                                                                                                                                                                                    | 明确成功                   | server_copy、0字节put与mkdir直接succeeded，所有驱动一致，包括异步受理、no-op与包装驱动，风险公开；delete进入确认刷新                                |
| code200且返回task                                                                                                                                                                                  | 已受理                     | submitted，按[任务跟踪](#任务跟踪)逐tid跟踪                                                                                                         |

一次有界观察：以refresh=true列出受影响的父目录；读取的瞬时错误按读取规则有界重试，403不重试。

| 动作                            | 观察到效果 → succeeded               | 观察到原状态完好 → failed（attempt预算内可重试） | 其他 → unknown                                           |
| ------------------------------- | ------------------------------------ | ------------------------------------------------ | -------------------------------------------------------- |
| create（server_copy、0字节put） | 目标名存在、是文件且大小等于计划size | 目标名不存在                                     | 观察失败（含无refresh权限）、视图suspect、类型或大小不同 |
| mkdir                           | 目录存在                             | 名称不存在                                       | 观察失败、视图suspect、同名对象是文件                    |
| delete（remove）                | 原名不存在                           | 原名存在且类型/大小符合预期                      | 观察失败、视图suspect、类型或大小不同                    |
| 空目录remove                    | 路径不存在                           | 路径仍存在                                       | 观察失败、视图suspect                                    |

观察到效果时写error_code=OBSERVED_AFTER_ERROR，原OpenList错误摘要写入error_message；delete不再另做确认刷新。观察到原状态完好而记failed，接受一个小风险：云端可能在OpenList报错后仍迟到生效，后续 Run 按自己的扫描独立规划。

有task先submitted，直到终态。delete仍需[前提刷新](deletion.md)，因此remove成功不能直接开放create。
mkdir明确成功即成功；已存在且确认为目录也作为正常已有前提，不吞掉其他mkdir错误。
relay以完整字节及complete结果为准，见[relay结果分类](relay.md#结果分类)。unknown保留事实，按[恢复](scheduling-recovery.md)处理。

## 缓存和挂载

source/target scan refresh默认分别关闭；删除前、删除确认和变更报错后的观察强制refresh=true，不受scan开关影响。权限不允许即阻断相关动作。
管理员每Run读取完整storage/list（per_page=100，page递增直到覆盖total）；发现total变化或重复id时重取一次，仍不一致则本轮边界不可信，该Instance的视图按[挂载边界](deletion.md#挂载边界)的suspect规则处理。只提取id,mount_path,driver,disabled,status；立即丢弃addition等秘密。
尚未覆盖total却返回空页、必要字段缺失、无效total或累计数量超过total同样视为分页不一致；整表重读最多一次后记MOUNT_BOUNDARY_UNKNOWN，不无限翻页或使用部分映射。全部请求受当前Run期限及响应大小限制。M2运行读取使用固定ExecutionSettings；普通浏览仍用进程配置。调用方可中止认证等待而不取消其他调用方共享的登录，发起共享登录的调用方提供该次认证的固定参数；关机等待已开始的认证结束后才关闭数据库。完整映射读取（含一次重读）的每页请求各自使用 OPENLIST_API_TIMEOUT_MS 与读取重试策略，整体受调用方期限约束，不再共享一个整表期限。
有效mount按OpenList算法计算：mount_path在最后一次出现`.balance`处截断（strings.LastIndex语义，不是后缀判断：`/a.balance/b`得`/a`，`/x.balancesheet`得`/x`），再在候选storage中按路径段边界做最长匹配；同一有效mount有多个候选时不猜。测试包含`/a.balance1`与`/a.balance/b`。读取失败不降级到普通账号路径。
mount_details可因设置、超时、驱动能力和中间虚拟目录而缺失，仅用于提示风险。元数据变更和底层别名不在本服务完整证明范围内。

## 来源

源码基准：OpenList v4.2.6 系列源码（上游 main 分支 2026-09 快照，提交 5447ecb0）；行号可能随上游演进漂移。
主要位置：server/handles/fsread.go、fsmanage.go、fsup.go、multipart.go、task.go、storage.go、setting.go；server/common/auth.go、check.go；pkg/utils/path.go、balance.go；internal/op/fs.go、storage.go；internal/fs/copy_move.go；internal/multipart/session.go、window.go。各驱动的操作语义见[兼容矩阵](../reference/driver-compatibility.md)。

## 维护责任分类

remote_cleanup_pending 与有 tid 的本地终态同事务写入。遗留任务统一使用有界 housekeeping；info 或删除失败耗尽预算时清标志、释放额度并记录日志，AUTH_BLOCKED 不重试登录。info404 同样结束责任；观察仍为非终态则继续占用额度。关闭中止不算耗尽，SQL 错误 fail-fast。

每次异步响应后复查 remote_cleanup_pending 和 remote_state，迟到响应不恢复已结束的责任，也不覆盖较新的远程状态。停止跟踪后不可观察的迟到动作属于已接受风险。
