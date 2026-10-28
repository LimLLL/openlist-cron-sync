用途：定义管理REST路由、HTTP状态、错误格式，并登记全部固定原因码。

范围：/api/v1；请求/响应schema见[API schemas](api-schemas.md)，执行及风险管理接口见[执行API](api-execution.md)。

# REST API

## 公共协议

本服务使用真实HTTP状态，不使用OpenList envelope。JSON UTF-8；响应对象直接返回，不再包data。本文及执行API表中的所有路由均相对/api/v1，包括文档路由：实际地址为/api/v1/docs和/api/v1/openapi.json，不额外注册根路径别名。
除login、health/live、health/ready和API文档路由外，所有路由都要求Authorization: Bearer <本服务JWT>。OpenList裸token不能用于本服务。
API文档：API_DOCS_ENABLED=true（默认，见[配置](configuration.md)）时，GET /docs（Swagger UI）与GET /openapi.json无需认证即可访问。文档只含公共DTO，不含秘密或数据库实体。设为false时两条路由都不注册，请求返回404。在Swagger UI中发起的API调用仍需通过Authorize填入本服务JWT。
POST资源创建201，异步工作202并返回可查询资源；GET/PATCH成功200；DELETE成功204无body。所有未列字段400。
分页GET使用page默认1、pageSize默认50最大200；正整数。未知查询字段400。未找到资源404，包括归档资源（includeArchived=true的管理员列表除外）。
Error={error:{code:string,message:string,details:FieldError[]},requestId:string}；FieldError={field:string,reason:string}；无字段错误details=[]。不返回stack、raw response或secret。

| HTTP | code                                                  | 含义                                                      |
| ---- | ----------------------------------------------------- | --------------------------------------------------------- |
| 400  | VALIDATION_ERROR / INVALID_PATH / INVALID_CRON        | 输入错误：字段、路径或cron非法，或含未声明字段            |
| 400  | IMPORT_VERSION_UNSUPPORTED                            | 导入formatVersion不是1                                    |
| 401  | UNAUTHENTICATED / INVALID_CREDENTIALS / TOKEN_REVOKED | 本服务管理认证失败                                        |
| 403  | PASSWORD_CHANGE_REQUIRED                              | 首次随机密码只允许me/change-password                      |
| 404  | NOT_FOUND                                             | 本服务对象缺失                                            |
| 409  | JOB_BUSY                                              | Job已有非终态Run（含queued与recovering）                  |
| 409  | ENDPOINT_IN_USE                                       | Instance仍被引用，或其地址/账号变化涉及未决责任           |
| 409  | PATH_OVERLAP                                          | 同Job的source与targets、或targets之间路径重叠             |
| 409  | AUTH_COOLDOWN                                         | OpenList登录429冷却期内的人工重试                         |
| 409  | INVALID_STATE                                         | 对象当前状态不允许该动作                                  |
| 409  | RETRY_NOT_ALLOWED                                     | 该Run不能重试；details[0].reason同retryEligibility.reason |
| 409  | URL_REVIEW_REQUIRED                                   | Webhook URL待复核（needsUrlReview=true）时请求启用channel |
| 413  | PAYLOAD_TOO_LARGE                                     | 管理JSON/import上限                                       |
| 429  | LOGIN_RATE_LIMITED                                    | 本服务登录限流，返回Retry-After秒                         |
| 502  | OPENLIST_ERROR / UPSTREAM_PROTOCOL_ERROR              | 同步浏览等上游失败                                        |
| 503  | QUEUE_FULL / NOT_READY                                | 暂不能接受工作                                            |
| 500  | INTERNAL_ERROR                                        | 本地不可恢复异常，脱敏                                    |
| 500  | RESOURCE_LIMIT                                        | Run列表或详情实时统计超过安全整数；读取不改变Run状态      |

<a id="reason-codes"></a>

## 固定原因码

下列code不是HTTP状态。它们出现在Operation.error.code、Run.error.code或stopReason、RunTargetView.blockReasons、ScanIssueView.code、InstanceView.authBlockReason、JobListItem.scheduleError、DeliveryView.errorCode，或启动失败日志中。
本表是全部固定原因码的唯一登记处：新增code必须先登记在这里并写入OpenAPI描述；实现只按code分支，不按message分支。某个code是生成skipped Operation还是scan_issue、是否构成异常、是否阻断extras、是否使Run partial，见[状态机](../design/state-machines.md)中的分类表。

### 扫描与计划

| code                        | 含义                                                                                                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SCAN_INCOMPLETE             | 子树或端点读取不完整（list失败、权限不足等）；不能当作缺失                                                                                                                                                            |
| SOURCE_ROOT_UNAVAILABLE     | source根目录无法读取；Run failed，不执行任何计划动作                                                                                                                                                                  |
| SUSPECT_VIEW                | 视图可疑（检测到嵌套挂载，或目录是挂载点的祖先）；该范围删除禁止，判定见[可疑视图](../design/deletion.md#可疑视图)；连接测试/浏览也用作账号缺少权限位0（CanSeeHides，列表可能漏掉隐藏条目）或目录含嵌套挂载提示的警告 |
| SCAN_DEPTH_EXCEEDED         | 目录深度超过SCAN_MAX_DEPTH；该子树不再下探并受保护（protectSubtree=true），Run不因此失败                                                                                                                              |
| TARGET_ROOT_WILL_BE_CREATED | Target根不存在（其父目录可列出且无此名）且需要创建内容或目录结构；dry-run报告此码并规划create，实跑先以prepare mkdir创建根                                                                                            |
| TARGET_ROOT_UNAVAILABLE     | Target根无法列出且不能证明缺失（父目录列表失败、权限错误或同名为文件）；该Target按SCAN_INCOMPLETE处理，不create、不删除                                                                                               |
| MOUNT_BOUNDARY_UNKNOWN      | 管理员模式下storage列表不可读或重读后仍不一致；该Instance所有目录按可疑视图处理，相关删除禁止；连接测试/浏览也用作非管理员不能核实完整挂载或不存在唯一可用挂载的警告                                                  |
| INVALID_NAME                | 条目名含`/`、`\`、NUL，或为`.`、`..`；保护其父目录                                                                                                                                                                    |
| UNKNOWN_SIZE                | 源文件大小未知；不传输，存在大小过滤时也不能判为符合                                                                                                                                                                  |
| INVALID_SIZE                | size不是可处理的整数或超过JS安全整数；协议读取失败的具体原因。负数按UNKNOWN_SIZE/TARGET_UNKNOWN_SIZE处理                                                                                                              |
| TARGET_UNKNOWN_SIZE         | 目标文件大小未知；该路径受保护：不替换、不算extra、不计入阈值分母D                                                                                                                                                    |
| TYPE_CONFLICT               | 同一相对路径在源与目标的文件/目录类型不同；所有模式都不自动删除阻挡对象                                                                                                                                               |
| NAME_COLLISION              | NFC/大小写折叠后名称相同（source内部、source与Target之间或Target内部）                                                                                                                                                |
| EMPTY_SOURCE                | 有效源集合为空且allowEmptySource=false；删除禁止                                                                                                                                                                      |
| DELETE_BLOCKED              | 扫描保护阻断的Target删除及依赖create；具体原因在RunTarget.blockReasons及scan_issues；不改变planned计数                                                                                                                |
| DELETE_LIMIT                | 超过数量/比例阈值，或retry_cleanup超出剩余预算；相关delete及其依赖create跳过                                                                                                                                          |
| PLAN_INVALID                | 计划内部断言失败（例如R>D）；按实现缺陷记录日志，只记录scan_issue；该Target的删除及依赖create以DELETE_BLOCKED跳过                                                                                                     |
| PREVIOUS_OUTCOME_UNKNOWN    | 旧版本因历史结果未知而跳过路径的记录；当前版本不再产生，旧结果保持原样                                                                                                                                                |
| RETRY_TYPE_CHANGED          | 重试运行中，选中项在源上已变成另一种类型（文件与目录互换），或到达它所需的祖先已变成文件；该项受保护、不扩展重试范围，需完整运行                                                                                     |

### 执行

| code                        | 含义                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| PRECONDITION_CHANGED        | 删除提交前刷新发现目标大小/类型已变化，或待清理的空目录已非空；不提交该动作                                                                  |
| PRECONDITION_UNVERIFIED     | 删除提交前的刷新无法确认（错误、403、suspect视图或父目录无法确认）；不提交该动作，依赖create记DEPENDENCY_FAILED                              |
| PRECONDITION_ALREADY_ABSENT | 待删除的原路径已不存在；属于正常跳过，不阻断依赖create                                                                                       |
| SOURCE_CHANGED              | 执行时源条目的名称/类型/大小与计划不符                                                                                                       |
| SIZE_MISMATCH               | relay源实际字节数、下载长度或Content-Range与计划大小不符                                                                                     |
| SPOOL_FULL                  | 写spool遇到ENOSPC/EDQUOT，或session落库后当前独占预算仍不足以容纳frontier实际payload；摘要区分insufficient spool capacity，主动abort后failed |
| SPOOL_IO_ERROR              | 写或读spool时遇到其他本地I/O错误；该文件按主动abort收尾记failed                                                                              |
| DEPENDENCY_FAILED           | 依赖动作以非成功终态结束                                                                                                                     |
| DELETE_NOT_EFFECTIVE        | delete确认期限内原名称仍存在；依赖create跳过，从不改用overwrite                                                                              |
| OBSERVED_AFTER_ERROR        | OpenList对变更返回非成功码，但随后一次有界观察确认效果已出现；Operation记succeeded，message保留原错误摘要                                    |
| REMOTE_TASK_CHANGED         | 旧版本记录远程任务重新启动的历史行；当前维护只更新原 task 状态并记录日志，不新增操作                                                         |
| AUTH_BLOCKED                | Instance处于auth_blocked，相关请求立即失败                                                                                                   |
| OPENLIST_ERROR              | 未被专用原因码覆盖的上游失败；响应错误码或网络事实只进入脱敏摘要，不按message猜测业务状态                                                    |
| UPSTREAM_REDIRECT           | 管理API、multipart或put收到重定向；不跟随，也不重放上传body                                                                                  |
| UPSTREAM_JSON_TOO_LARGE     | 上游JSON响应实际字节超限的客户端事实；扫描映射Run RESOURCE_LIMIT，浏览HTTP仍为502 UPSTREAM_PROTOCOL_ERROR                                    |
| UPSTREAM_PROTOCOL_ERROR     | OpenList响应结构未知或不符合协议                                                                                                             |

### Run、实例、通知与启动

| code                         | 出现位置                               | 含义                                                                                          |
| ---------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| QUEUE_TIMEOUT                | Run.error（stopReason=NULL）           | 到queueDeadlineAt仍未开始                                                                     |
| RESOURCE_LIMIT               | Run.error或Run列表/详情HTTP错误        | 扫描/规划资源超限或执行统计溢出；实时读取溢出返回500，不修改Run状态                           |
| INVALID_TIMEZONE             | JobListItem.scheduleError              | 已启用未归档cron的时区无效；配置写入仍使用VALIDATION_ERROR及timezone字段诊断                  |
| INVALID_CRON                 | JobListItem.scheduleError或HTTP错误   | 表达式语法无效或不符合五段规则；写入时也用于无下一时刻的表达式                               |
| NO_NEXT_OCCURRENCE           | JobListItem.scheduleError              | 在固定cron库搜索范围内未找到下一时刻，不表示永久不会触发                                     |
| PLAN_INTERRUPTED             | Operation.error                        | 进程重启或扫描失败使旧计划中的pending不再执行                                                 |
| INTERNAL_ERROR               | Run.error                              | 本地不可恢复实现错误                                                                          |
| RUN_TIMEOUT                  | Run.stopReason                         | 超过Job timeoutSeconds，Run cancelled                                                         |
| USER_CANCEL                  | Run.stopReason                         | 管理员取消，Run cancelled                                                                     |
| PROCESS_RESTART              | Run.stopReason、DeliveryView.errorCode | 进程重启：Run interrupted；pending/sending的delivery failed且不补发                           |
| ACCOUNT_CHANGED              | InstanceView.authBlockReason           | 有未决责任时/api/me返回的base_path或username与已存值不同；不覆盖已存值，Instance auth_blocked |
| OPENLIST_VERSION_UNSUPPORTED | InstanceView.lastError                 | 连接测试读到的OpenList版本低于4.2.5或无法解析；该Instance不能用于任何Job                      |
| MULTIPART_DISABLED           | InstanceView.lastError                 | 连接测试发现multipart_enabled=false；该Instance不能作为relay目标                              |
| CONFIG_KEY_CONFLICT          | 启动失败                               | 同一密钥在环境变量与keys.json中都存在且不一致，见[密钥规则](configuration.md#密钥优先级)      |
| KEY_MISMATCH                 | 启动失败                               | master key无法解密数据库中已有的ENC值；不写入任何新ENC值                                      |

实例认证阻断原因补充：`LOGIN_401`（密码拒绝）、`LOGIN_402`（需要二次认证）、`LOGIN_429`（登录冷却）、`TOKEN_401`（静态 token 拒绝）、`GUEST`（实际为游客）、`MISSING_SECRET`（未保存凭据）。这些值仅作为 InstanceView.authBlockReason，不直接用作 HTTP error.code。

## 管理认证

| 方法/路径                  | 请求                                        | 成功响应                                                                                 |
| -------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| POST /auth/login           | {username:string,password:string}           | 200 {accessToken:string,tokenType:'Bearer',expiresIn:integer,mustChangePassword:boolean} |
| GET /auth/me               | 无                                          | 200 {id:1,username:string,mustChangePassword:boolean}                                    |
| POST /auth/change-password | {currentPassword:string,newPassword:string} | 204；所有旧JWT失效，重新登录                                                             |

登录失败统一401，不暴露账号是否存在。密码12–128字符，限制UTF-8最大512bytes。不提供注册/多管理员/刷新token接口。

登录限流（数值见[配置](configuration.md)）：

- 客户端IP（按TRUST_PROXY_HOPS解析）和username各有一个内存中的固定窗口。窗口从该key的第一次失败开始，长度LOGIN_WINDOW_SECONDS。
- 某个key的失败次数达到LOGIN_MAX_FAILURES后，窗口结束前对该key的后续尝试直接返回429 LOGIN_RATE_LIMITED，Retry-After为距窗口结束的秒数（向上取整）。这些尝试不运行scrypt，也不计入失败。默认值下前5次失败返回401，第6次起返回429。
- 任一key处于限流即拒绝。登录成功清除该username的计数，不清除IP计数。
- scrypt并发最多2；超出时直接返回429，Retry-After:1，不排队、不计入失败。
- change-password的currentPassword错误返回401，并计入同一IP和username计数；处于限流时同样返回429。
- 计数只在内存中，进程重启后清零。

已接受风险：知道管理员用户名的攻击者可以持续制造失败，使该username窗口一直处于限流，从而阻止管理员登录。单管理员自托管部署接受此风险；缓解方式是不把管理端口直接暴露到公网，或在反向代理层限制来源。

## Instances

| 方法/路径                  | 请求                           | 成功响应/规则                                        |
| -------------------------- | ------------------------------ | ---------------------------------------------------- |
| POST /instances            | InstanceCreate                 | 201 InstanceView                                     |
| GET /instances             | page,pageSize,includeArchived? | 200 Page<InstanceView>                               |
| GET /instances/:id         | 无                             | 200 InstanceView                                     |
| PATCH /instances/:id       | InstancePatch                  | 200 InstanceView；有未决责任时拒绝身份变化（见下文） |
| DELETE /instances/:id      | 无                             | 204；有活动引用409                                   |
| POST /instances/:id/test   | TestRequest                    | 200 TestResult；只读测试不上传探测文件               |
| POST /instances/:id/browse | BrowseRequest                  | 200 BrowseResult；上游失败502                        |

M2 已接入非归档Job引用和完整未决责任谓词：DELETE有引用时409，PATCH身份变化有责任时409，downloadMode在非终态Run引用时409（limits字段已删除，带上返回400）；name和同身份凭据修复仍允许。

浏览使用POST避免路径密码进URL。分页为本服务切分OpenList列表，不保证云端游标一致性。
PATCH本身不调用OpenList。地址、账号（password模式的username）或base_path变化在存在[未决责任](../design/data-model.md#responsibility)时返回409 ENDPOINT_IN_USE；同地址同账号的凭据修复允许。
token模式替换token时无法当场判断新token属于哪个账号，因此之后每次/api/me成功（连接测试、未测试后的首次使用、重新登录）都会把返回的base_path和username与已存值比较；有未决责任且不一致时不覆盖已存值，Instance变为auth_blocked、authBlockReason=ACCOUNT_CHANGED，阻断其操作，直至管理员处理相关责任。规则见[认证与实例身份](../design/openlist-integration.md#认证与实例身份)。

## Jobs

| 方法/路径                     | 请求                           | 成功响应/规则                                                 |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------- |
| POST /jobs                    | JobCreate                      | 201 JobView                                                   |
| GET /jobs                     | page,pageSize,includeArchived? | 200 Page<JobListItem>                                         |
| GET /jobs/:id                 | 无                             | 200 JobView                                                   |
| PATCH /jobs/:id               | JobPatch                       | 200 JobView；活动Run时409                                     |
| DELETE /jobs/:id              | 无                             | 204；逻辑归档；活动Run时409                                   |
| POST /jobs/:id/enable         | {}                             | 200 JobView；必要secret缺失400                                |
| POST /jobs/:id/disable        | {}                             | 200 JobView；不取消已运行任务，允许执行期间调用               |
| GET /jobs/:id/next-fire-times | count?默认5，1–20，为最大数量  | 200 {timezone:string,times:Time[]}；manual-only或disabled为[] |

enable/disable只修改enabled，运行snapshot不变，属于PATCH活动限制的明确例外。
next-fire-times仅返回固定cron库八年搜索范围内的时间前缀，可能少于count；没有任何下一时刻的表达式保存/启用返回400 INVALID_CRON。归档Job在enable/disable/next-fire-times均返回404。
next-fire-times的times是UTC时间，timezone是Job的IANA时区；客户端据此换算当地时间和UTC偏移（含DST），API不另行返回偏移。

JobListItem为JobView的平铺扩展，增加latestTerminalRealRun、nextFireAt、scheduleError，均必填且可为null；配置详情、写入响应和Run中的Job快照仍使用JobView。先分页Job再补充摘要，total只统计匹配的Job，不受目标或运行数量影响。
latestTerminalRealRun只选择dryRun=false且终态的运行，按createdAt DESC、id DESC取一条；预览和活动运行不覆盖它。没有符合条件的运行为null，归档Job显式列出时仍保留摘要。主动取消同样属于终态，因此会替换更早的失败结果；摘要包含stopReason以区分USER_CANCEL与RUN_TIMEOUT，不提供统计或持久化关注状态。
nextFireAt以整个响应共用的参考时刻计算，仅表示下一理论cron发生时刻，不保证届时接受执行。归档、disabled和manual-only的nextFireAt及scheduleError均为null。已启用cron的已知时区/表达式错误或搜索范围耗尽以scheduleError返回，不影响其他Job；数据库和非预期计算错误仍使请求失败。

## Notifications与系统

| 方法/路径                            | 请求                            | 成功响应                                                                          |
| ------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------- |
| POST /notification-channels          | ChannelCreate                   | 201 {channel:ChannelView,generatedSecret:string或null}                            |
| GET /notification-channels           | page,pageSize,includeArchived?  | 200 Page<ChannelView>                                                             |
| GET /notification-channels/:id       | 无                              | 200 ChannelView                                                                   |
| PATCH /notification-channels/:id     | ChannelPatch                    | 200 ChannelView；needsUrlReview=true时请求enabled=true返回409 URL_REVIEW_REQUIRED |
| DELETE /notification-channels/:id    | 无                              | 204；关联Job自动移除此channel关联                                                 |
| POST /notification-channels/:id/test | {}                              | 202 DeliveryView；异步有限投递                                                    |
| GET /notification-deliveries/:id     | 无                              | 200 DeliveryView                                                                  |
| GET /notification-deliveries         | page,pageSize,runId?,channelId? | 200 Page<DeliveryView>                                                            |
| GET /system/health/live              | 无                              | 200 {status:'ok'}                                                                 |
| GET /system/health/ready             | 无                              | 200或503 Health                                                                   |
| GET /system/info                     | 无                              | 200 Info                                                                          |
| GET /system/export                   | 无                              | 200 ExportDocument                                                                |
| POST /system/import                  | ImportRequest                   | 200 ImportResult                                                                  |
| GET /openapi.json                    | 无（无需认证）                  | 200 OpenAPI 3.0文档；API_DOCS_ENABLED=false时404                                  |
| GET /docs                            | 无（无需认证）                  | 200 Swagger UI HTML；API_DOCS_ENABLED=false时404                                  |

Webhook URL按秘密处理：path和query可能含密钥（例如Bark、ServerChan把key放在path中）。响应只返回urlOrigin与urlHasPathOrQuery，从不返回完整URL；日志和错误摘要不含URL的path或query。任何提供url的PATCH同时清除needsUrlReview，视为管理员已复核。
system/import不调用远程文件写入，按[导入规范](import-export.md)。通知test使用webhook.test事件，不伪造成功Run。
health只暴露最低状态，不公开地址、数据库位置、用户名。所有响应附X-Request-Id；调用者传入值不直接信任，使用本服务UUID。
