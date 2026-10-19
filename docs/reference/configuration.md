用途：集中定义可调默认值、单位、验证范围及其理由。

范围：启动环境和API配置的唯一数值规范；标为可调的值由环境或对应API字段修改，不直接编辑数据库。

# 配置参考

## 解析和优先级

启动参数读取process.env；.env仅本地开发通过@nestjs/config加载。启动环境决定服务级设置及新配置对象默认值；已保存Job/Instance值优先，Run采用固定后的值。
数字只接受十进制整数，拒绝NaN、小数、负值和单位字符串。BOOL环境只接受true/false。空字符串不是未设置；非法配置启动失败并指明字段，不输出值中的秘密。
时间内部用UTC；毫秒/秒按本表，不隐式混用。API以camelCase字段映射数据库。

## 环境变量

| 名称                           | 默认           | 校验；理由（均可调，密钥除外）                                                                              |
| ------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------- |
| NODE_ENV                       | production     | development/test/production                                                                                 |
| HOST                           | 0.0.0.0        | 合法监听地址；容器需外部可达                                                                                |
| PORT                           | 3000           | 1–65535                                                                                                     |
| DATA_DIR                       | /data          | 绝对可写本地路径                                                                                            |
| LOG_LEVEL                      | info           | error/warn/info/debug；debug仍脱敏                                                                          |
| TRUST_PROXY_HOPS               | 0              | 0–5；仅可信代理拓扑可提高                                                                                   |
| API_DOCS_ENABLED               | true           | true/false；true时/docs与/openapi.json免认证提供，false时两者均不注册（见[REST](rest-api.md#公共协议)）     |
| ADMIN_USERNAME                 | admin          | 1–64字符；只首次初始化读取                                                                                  |
| ADMIN_PASSWORD                 | 未设置         | 初次随机生成；设置时12–128字符；不在重启覆盖旧密码                                                          |
| JWT_SECRET                     | 未设置         | 标准base64，解码32字节；缺失时按[密钥规则](#密钥优先级)生成                                                 |
| ENCRYPTION_MASTER_KEY          | 未设置         | 标准base64，解码32字节；缺失时按[密钥规则](#密钥优先级)生成或启动失败                                       |
| ADMIN_JWT_TTL_SECONDS          | 28800          | 300–86400；8小时管理会话                                                                                    |
| LOGIN_MAX_FAILURES             | 5              | 1–20；窗口内失败达到此数后，其余尝试429                                                                     |
| LOGIN_WINDOW_SECONDS           | 900            | 60–86400；IP与账号各自的固定窗口，自首次失败起算，见[管理认证](rest-api.md#管理认证)                        |
| GLOBAL_MAX_RUNS                | 2              | 1–16；单机SQLite和云API负载折中                                                                             |
| MAX_QUEUED_RUNS                | 100            | 1–10000；防止无界内存/DB积压                                                                                |
| QUEUE_TIMEOUT_SECONDS          | 3600           | 60–86400；过期工作不长期排队                                                                                |
| OPENLIST_CONNECT_TIMEOUT_MS    | 10000          | 1000–120000                                                                                                 |
| OPENLIST_API_TIMEOUT_MS        | 30000          | 1000–300000；控制请求超时，不用于chunk请求与complete等待                                                    |
| OPENLIST_TASK_POLL_MS          | 3000           | 500–60000；请求均匀加±20%抖动                                                                               |
| RETRY_MAX_ATTEMPTS             | 3              | 1–10，含首次；不含OpenList内部重试                                                                          |
| RETRY_BASE_MS                  | 1000           | 100–60000                                                                                                   |
| RETRY_MAX_MS                   | 30000          | base–300000；含抖动在内的退避上限                                                                           |
| OPENLIST_AUTH_COOLDOWN_SECONDS | 600            | 600–86400；避免延长共享IP锁定                                                                               |
| DELETE_CONFIRM_TIMEOUT_SECONDS | 60             | 5–600；等待原名称消失                                                                                       |
| DELETE_CONFIRM_INTERVAL_MS     | 2000           | 500–30000                                                                                                   |
| RELAY_IDLE_TIMEOUT_SECONDS     | 60             | 5–600；只在向源请求数据时计时，spool背压和令牌等待不计入；定义见[relay超时](../design/relay.md#超时)        |
| RELAY_TOTAL_TIMEOUT_SECONDS    | 21600          | 60–604800；单文件relay总期限（含chunk请求与complete等待），6小时，受Run剩余期限限制                         |
| RELAY_DOWNLOAD_WORKERS         | 4              | 1–64；全局下载worker数，见[relay资源](../design/relay.md#资源)                                              |
| RELAY_UPLOAD_WORKERS           | 8              | 1–128；全局同时进行的chunk请求数                                                                            |
| SPOOL_DIR                      | DATA_DIR/spool | 绝对可写本地路径；可放到独立卷                                                                              |
| SPOOL_RESERVE_BYTES            | 536870912      | 0–安全整数；spool预算扣除的保留空间（默认512MiB），保证同卷SQLite/WAL可写；spool在独立卷时可设0             |
| QUARANTINE_SECONDS             | 86400          | 2100–2592000；默认24h风险策略；下限35分钟覆盖OpenList分片session的闲置TTL与GC间隔                           |
| RECOVERY_TIMEOUT_SECONDS       | 600            | 10–86400；有界收尾而非续跑                                                                                  |
| CANCEL_GRACE_SECONDS           | 60             | 1–600                                                                                                       |
| SHUTDOWN_GRACE_SECONDS         | 30             | 1–600；SIGTERM后中止本地工作并持久化已收结果的时限，见[优雅停止](../design/scheduling-recovery.md#优雅停止) |
| RUN_RETENTION_DAYS             | 30             | 1–3650；有责任的记录不受此硬删除                                                                            |
| NOTIFICATION_TIMEOUT_SECONDS   | 10             | 1–60                                                                                                        |
| NOTIFICATION_MAX_ATTEMPTS      | 3              | 1–10；best-effort，不跨重启补发                                                                             |
| SCAN_MAX_DEPTH                 | 128            | 1–1024；限制symlink循环伤害；超深子树记SCAN_DEPTH_EXCEEDED并受保护，Run不因此失败                           |
| SCAN_MAX_DIRECTORY_ENTRIES     | 100000         | 1–1000000；超限Run failed，不截断继续                                                                       |
| OPENLIST_MAX_JSON_BYTES        | 33554432       | 1024–268435456；含列表和管理响应；扫描列表超限Run failed                                                    |
| MAX_OPERATIONS_PER_RUN         | 1000000        | 1–10000000；超限Run failed，不执行                                                                          |
| MAX_SCAN_ISSUES_PER_RUN        | 10000          | 1–100000；超过则终止扫描，Run failed                                                                        |
| PLAN_BATCH_SIZE                | 500            | 1–5000；短事务与吞吐折中                                                                                    |

扫描/规划期的资源上限（SCAN_MAX_DIRECTORY_ENTRIES、扫描列表响应的OPENLIST_MAX_JSON_BYTES、MAX_OPERATIONS_PER_RUN、MAX_SCAN_ISSUES_PER_RUN）超限时Run failed（RESOURCE_LIMIT），不执行任何计划动作。SCAN_MAX_DEPTH例外：只保护超深子树，因此该Target（源侧超深时为所有Target）的删除禁止，其他create继续。执行期refresh读取超限只阻断相关动作。
退避：delay=min(RETRY_MAX_MS, RETRY_BASE_MS×2^(attempt-1)×U[0.5,1.5])，attempt为刚失败的尝试序号（从1起），因此RETRY_MAX_MS是含抖动的真实上限；最终截到剩余deadline。Retry-After若有效且更长使用它，超出deadline则失败，不提前撞限流。
OpenList task info轮询：单次info请求的网络错误、5xx、JSON500按RETRY_*重试；重试耗尽不改变Operation状态，继续按OPENLIST_TASK_POLL_MS轮询，直到Run的deadlineAt（随后进入取消流程，CANCEL_GRACE_SECONDS后仍无终态则unknown），恢复期间则到recoveryDeadlineAt。task not found（JSON404）立即unknown。MVP不设单独的info失败次数上限。
内部维护默认每小时、历史UTC03:00、启动后30s，单批100；测试delivery（run_id为NULL）保留30天，Run关联的delivery随所属Run按RUN_RETENTION_DAYS清理。这些作为实现常量集中声明，MVP不增加额外运行时开关。
SQLite busy_timeout=5000ms、WAL/FULL/foreign_keys、令牌桶单次取用64KiB、spool块1MiB、每session chunk并发2、session status心跳60s、redirect上限5为固定基线；变更需更新设计与测试。

## Instance默认值

| API字段                       | 默认 | 范围/理由                                        |
| ----------------------------- | ---- | ------------------------------------------------ |
| limits.maxApiConcurrency      | 4    | 1–32；一个位置优先留给控制请求                   |
| limits.maxOutstandingTasks    | 4    | 1–64；仅server_copy，限制OpenList未完任务        |
| limits.maxDownloadConnections | 2    | 1–16；作为relay源时打开的GET数（含因背压暂停的） |
| limits.maxUploadSessions      | 2    | 1–16；作为relay目标时的分片上传session数         |
| limits.maxChunkConcurrency    | 4    | 1–32；作为relay目标时同时进行的chunk请求         |
| limits.apiRequestsPerSecond   | 5    | 1–100；并发不替代速率限制                        |
| downloadMode                  | d    | d/p；p须OpenList允许                             |

## Job与Target默认值

| API字段                             | 默认        | 范围/理由                                                                                                       |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| enabled                             | false       | 导入和初创不立即运行                                                                                            |
| cron                                | null        | 仅手动，5段分钟表达式                                                                                           |
| timezone                            | UTC         | 有效IANA时区                                                                                                    |
| source.refresh / targets[].refresh  | false       | 降低云API请求；不控制删除前提刷新                                                                               |
| filters.include / exclude           | []          | 各最多100条，每条≤1024字符                                                                                      |
| filters.minSizeBytes / maxSizeBytes | null        | 0至安全整数，min≤max                                                                                            |
| allowEmptySource                    | false       | 防止空视图清空目标                                                                                              |
| syncEmptyDirs                       | false       | false只建create所需父目录，从不删除目标目录；true同步目录结构，见[空目录](../design/filters-paths.md#空目录)    |
| createMode                          | relay       | relay/server_copy；server_copy要求所有Target与source同Instance，见[创建方式](../design/sync-engine.md#创建方式) |
| relayBandwidthLimit                 | 0           | 0不限；正数1–安全整数bytes/s，聚合该Job全部relay上传payload                                                     |
| timeoutSeconds                      | 86400       | 60–604800；默认最长一天                                                                                         |
| targets[].mode                      | incremental | incremental/mirror                                                                                              |
| targets[].deleteLimits.enabled      | true        | 可禁用数量/比例保护，其他保护仍在                                                                               |
| targets[].deleteLimits.maxCount     | 1000        | null或0–安全整数                                                                                                |
| targets[].deleteLimits.maxPercent   | 50          | null或0–100整数；超过一半视作异常规模                                                                           |

每Job 1–32个Target；每endpoint path≤4096 UTF-8字节，名称≤1024字节；超过限制返回400，不截断。API管理JSON上限1MiB，import上限10MiB；分页默认50、最大200。
阈值enabled=true时两项不能同时null。保留值0的含义：count=0禁止任何文件删除；percent=0同理；bandwidth=0才代表不限，不能通用转换。

## 通知渠道默认值

| API字段 | 默认                                     | 范围/理由                        |
| ------- | ---------------------------------------- | -------------------------------- |
| enabled | false                                    | 新建和导入不立即投递             |
| events  | [run.succeeded, run.partial, run.failed] | 非空子集；省略即订阅全部自动事件 |

## 密钥优先级

两把密钥分开处理：JWT key（JWT_SECRET）只签发管理会话，不保护任何存储数据；master key（ENCRYPTION_MASTER_KEY）加密数据库中的全部ENC字段。每把key的来源是环境变量和DATA_DIR/keys.json：

| 情况                              | JWT key                                                | master key                                                                   |
| --------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 环境变量与keys.json都提供且不一致 | 启动失败，CONFIG_KEY_CONFLICT                          | 启动失败，CONFIG_KEY_CONFLICT                                                |
| 只有一处提供，或两处一致          | 使用该值                                               | 使用该值，并通过下方启动校验                                                 |
| 两处都没有                        | 生成新key写入keys.json，记录告警：已有管理会话全部失效 | 数据库没有任何ENC值时生成并写入keys.json；已有ENC值则启动失败，不生成替代key |

keys.json={version:1,jwtSecret?:base64,encryptionMasterKey?:base64}，两个字段各自可选。文件只保存服务生成的key，从不写入环境变量提供的key；写入时保留已有字段并原子替换，目录0700、文件0600。
启动校验：在注册调度和写入任何ENC值之前，用master key试解密数据库中已有的ENC值；任一失败即以KEY_MISMATCH退出，不写入新ENC值，避免数据库混用两把key。数据库没有ENC值时无需校验。轮换流程见[安全](../design/security.md)。

## ExecutionSettings固定映射

Run.snapshot.settings包含下列全部字段，值取接受Run时的有效环境配置：

| 字段                                                            | 环境来源                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| queueTimeoutSeconds                                             | QUEUE_TIMEOUT_SECONDS                                                         |
| connectTimeoutMs / apiTimeoutMs / taskPollMs                    | OPENLIST_CONNECT_TIMEOUT_MS / OPENLIST_API_TIMEOUT_MS / OPENLIST_TASK_POLL_MS |
| retryMaxAttempts / retryBaseMs / retryMaxMs                     | RETRY_MAX_ATTEMPTS / RETRY_BASE_MS / RETRY_MAX_MS                             |
| authCooldownSeconds                                             | OPENLIST_AUTH_COOLDOWN_SECONDS                                                |
| deleteConfirmTimeoutSeconds / deleteConfirmIntervalMs           | DELETE_CONFIRM_TIMEOUT_SECONDS / DELETE_CONFIRM_INTERVAL_MS                   |
| relayIdleTimeoutSeconds / relayTotalTimeoutSeconds              | RELAY_IDLE_TIMEOUT_SECONDS / RELAY_TOTAL_TIMEOUT_SECONDS                      |
| quarantineSeconds / recoveryTimeoutSeconds / cancelGraceSeconds | QUARANTINE_SECONDS / RECOVERY_TIMEOUT_SECONDS / CANCEL_GRACE_SECONDS          |
| scanMaxDepth / scanMaxDirectoryEntries / maxJsonBytes           | SCAN_MAX_DEPTH / SCAN_MAX_DIRECTORY_ENTRIES / OPENLIST_MAX_JSON_BYTES         |
| maxOperationsPerRun / maxScanIssuesPerRun / planBatchSize       | MAX_OPERATIONS_PER_RUN / MAX_SCAN_ISSUES_PER_RUN / PLAN_BATCH_SIZE            |

全部是已验证整数，无NULL。进程全局并发、登录安全参数、服务监听、日志、历史清理和通知投递使用进程当前有效配置，不为每Run复制资源池或安全策略。
维护循环创建的REMOTE_TASK_CHANGED隔离记录不属于新的Run执行，使用进程当前有效配置的quarantineSeconds、retry*、apiTimeoutMs与taskPollMs，不读取原Run快照。
