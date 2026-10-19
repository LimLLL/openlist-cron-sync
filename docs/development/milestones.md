用途：把设计拆分为可执行任务与行为验收标准。

范围：M0–M8的交付物、任务与验收条件；设计文档存在不等于功能完成，完成以验收测试为准。

# 实施里程碑

每个里程碑的“验收”是行为标准，必须由实际运行的测试证明，测试方法见[测试策略](testing.md)。验证证据写入已有的长期位置，不另建逐里程碑记录：

- 驱动实测结果写入[驱动矩阵](../reference/driver-matrix.md)的“实测”列；
- 集成测试所用OpenList镜像的tag/digest与版本写入[OpenList依赖表](../reference/openlist-api.md)的兼容版本记录；
- 命令输出及未运行的测试写在对应PR说明中。

## M0 基础设施

交付：Node版本约束（engines `^22.22.3 || >=24.15.0`）、配置验证、Drizzle schema及生成迁移、WAL/FULL、JSON日志、错误DTO、单管理员JWT/scrypt/AES-GCM、health、OpenAPI文档路由、spool目录与权限。

任务：

- 固定已批准依赖；按[架构](../design/architecture.md)建立模块，模块依赖无环、不使用forwardRef。
- 首次bootstrap与密钥文件权限；迁移先于scheduler；OpenAPI基础。
- 让lint配置真正生效：使用oxlint自动加载的.oxlintrc.json，并把typescript/no-explicit-any设为error，背景见[约定](conventions.md#已核查基线)。
- 修正test/app.e2e-spec.ts中对'supertest/types'的导入，使含测试代码的`tsc -p tsconfig.json`检查通过。

验收：

- 错误环境变量、迁移失败均fail-fast；环境与keys.json中同一密钥不一致时启动失败。M0没有生产ENC列：“主密钥错误或缺失时启动失败且不写入新ENC值”的校验逻辑用测试夹具（真实SQLite与AES-GCM）验证，生产数据上的端到端验收在M1完成。
- 改密后旧JWT失效；日志和错误体中无secret。
- API_DOCS_ENABLED=true时GET /api/v1/docs与GET /api/v1/openapi.json无需认证即可访问，文档只含公共DTO；设为false时两个路由都不提供。除login、health与启用时的API文档路由外，其余路由缺少本服务JWT时返回401。
- NodeNext构建、DI测试、lint及[测试策略](testing.md#api-e2e与命令)中的两条tsc检查通过；不执行Docker build。

## M1 OpenList与实例

交付：裸token/password client、lockout-safe认证、/me、浏览、实例CRUD、管理员挂载解析、真实OpenList集成测试入口。

任务：

- envelope和真实HTTP错误；base_path与/d编码；API配额；部分任务响应协议；storage分页及.balance有效挂载计算；/api/public/settings读取与最低版本4.2.5检查；multipart五个接口的协议客户端。
- 建立集成测试入口：`*.int-spec.ts`后缀、独立vitest配置和`pnpm test:integration`脚本，规则见[集成测试运行方式](testing.md#集成测试运行方式)。修改package.json与新增配置须先取得项目维护者确认。

验收：

- 并发401只登录一次；登录401/402阻断且跨重启保持；429不延长锁定；fs返回500不当作缺失。
- admin storage列表读取失败或不完整时不降级为非管理员路径；storage的addition等字段不落日志。
- 名称含`/`或`\`的条目记INVALID_NAME，从不进入names[]、File-Path或/d、/p URL。
- 缺少集成测试环境变量时`pnpm test:integration`立即失败并列出缺少的变量，不以“全部跳过”结束。
- 连接测试：版本低于4.2.5或无法解析时OPENLIST_VERSION_UNSUPPORTED；multipart_enabled=false时报告MULTIPART_DISABLED；不调用multipart init。
- 实例凭据（首个生产ENC列）登记到加密列清单；已保存凭据后以错误或缺失的主密钥启动时以KEY_MISMATCH失败，且不写入任何新的ENC值。

## M2 扫描、规划、预览

交付：每目标模式、Job createMode及其配置校验（server_copy要求所有Target与source同Instance）、Job过滤、碰撞/类型冲突、mkdir/create/delete计划、安全预算及dry-run API。

任务：逐目录扫描与SQLite批量写计划（Operation按Run内计划顺序编号seq）；source错误映射；Target根检查；Target独有树枚举；完整计划后执行门槛。

验收：

- dry-run无远程文件写入；filtered不能成为extra；替换与extra共同计数；不以整目录绕过保护。
- source根读取失败：Run failed，无执行。
- Target根缺失（父目录可列出且其中没有该名称）：dry-run计划全部create并报告TARGET_ROOT_WILL_BE_CREATED。父目录列表失败、权限错误或同名项是文件：该Target记SCAN_INCOMPLETE（TARGET_ROOT_UNAVAILABLE），无create和删除，Run partial。规则见[同步引擎](../design/sync-engine.md)。
- 目录条目数、列表响应字节数、Run操作数或扫描问题数超过上限（SCAN_MAX_DIRECTORY_ENTRIES、OPENLIST_MAX_JSON_BYTES、MAX_OPERATIONS_PER_RUN、MAX_SCAN_ISSUES_PER_RUN）：Run failed且无执行，不截断后继续。超过SCAN_MAX_DEPTH：该子树记scan_issue并保护，不使Run失败。
- syncEmptyDirs=true时计划创建全部未排除的source目录（含空目录）；false时只创建所建文件需要的父目录。include只筛选文件，不决定目录是否创建；命中目录的exclude剪枝并保护该子树。
- Operation列表按(run_id, seq)返回计划顺序。

## M3a 默认relay的新建与基础恢复

交付：仅新文件create（createMode=relay）、下载/上传worker与spool、multipart分片上传、0字节put、Target根创建、尝试记录、全局/实例名额、取消、submitting窗口、unknown隔离，以及unknown处理端点：POST /operations/:id/quarantine-release、POST /operations/:id/resolve（abandoned）、带unresolved过滤的GET /operations。

任务：[relay结果分类](../design/relay.md#结果分类)与[完成分类](../design/openlist-integration.md#完成分类)、spool预算与防死锁、chunk重试与status心跳、Range续传、路径互斥、upload_id持久化与重启收尾、Operation查询。

验收：

- 文件明显大于可用spool时仍持续推进；下载不等上传；已开始上传的文件不被预读饿死；预算不足时下载暂停而不报错，真实ENOSPC记SPOOL_FULL。
- 最后一个chunk只在源EOF且字节数等于计划大小后发出；源过长或过短时主动abort并记failed，不提交截断文件。
- 明确的执行前拒绝（init的400、403含file exists与IgnoredSystemFile、405、认证阻断）直接failed，不做观察；IgnoredSystemFile不重试。mkdir、0字节put得到JSON 500时只做一次refresh=true观察。init或complete响应丢失→unknown并隔离；complete成功后查不到session不判失败。
- Target根缺失时，真实Run先以prepare mkdir创建根，再执行create。
- TTL到期或提前释放后先refresh再写；Run和Operation历史结果不改写。
- 真实L1/L3拓扑：同实例同storage、同实例跨storage与跨实例relay均通过；跨origin跳转不泄漏token；限速按Job聚合上传payload。

此阶段不对外宣称完整incremental，changed文件替换尚未完成。

## M3b 替换

交付：delete→refresh-confirm→create依赖链（两种createMode共用）、删除预算与retry_cleanup。

任务：依赖与失败出口、重试部分目标处理、阈值预算、源变化处理；relay在删除前先打开源并写入首块。

验收：

- 源不可用时旧文件不动；原名仍存在不create；无自动rollback；create失败时目标暂缺该文件，下一次Run重新创建。
- 替换链的全部失败出口按[故障窗口](testing.md#必须覆盖的故障窗口)中“替换链”各项通过：delete超时或丢响应→unknown并隔离原路径；删除前重读或删除确认时刷新失败/视图suspect→不开始create；create重试发现部分目标→refresh后以retry_cleanup删除，绝不overwrite=true；已成功的delete不重复提交。
- remove得到JSON 500时按M3a的观察规则分类。
- 真实L1/L3拓扑：delete→refresh→create全链路通过。

## M4 调度与完整恢复编排

交付：动态cron、FIFO队列、无重叠、期限、恢复管理与next-fire API。

任务：5段表达式/IANA时区、DST行为测试、Job启停、启动先重建责任、SIGTERM优雅停止。

验收：

- queued占Job名额；错过cron不补跑；manual-only重启不自发运行；读写交叉Job不并发；恢复最终interrupted，不执行旧pending。
- SIGTERM：ready=false；停止新触发、派发、提交和维护；中止本地扫描与relay；保存已收到的结果；不cancel已知OpenList task，不写Run终态。下次启动按[启动恢复](../design/scheduling-recovery.md)收尾为interrupted（stopReason=PROCESS_RESTART）；recovery_deadline_at只在首次进入recovering时写入，反复重启不延长。

## M5 Mirror与历史保留

交付：创建阶段后extras删除、syncEmptyDirs目录同步和历史清理。

任务：文件计数、protected后代、Run历史关联保留。

验收：

- 某Target失败不删其extras；另一Target可成功。
- mirror且syncEmptyDirs=true：Target独有目录（source中不存在、非保护）在其中extras删除后自底向上删除，每个目录先refresh=true确认为空；syncEmptyDirs=false时从不删除Target目录，允许留下空目录壳。
- unknown责任不被历史保留期清理。

## M6 server_copy

交付：可选的createMode=server_copy、copy task逐id跟踪、取消、远程任务记录清理与重启恢复。

任务：同Instance配置校验、task状态映射、REMOTE_TASK_CHANGED、task清理维护循环。

验收：

- 无task成功直接succeeded；返回task等待终态；cancel不delete运行中的task；本地unknown而远程未结束时绝不delete_some。
- copy得到JSON 500时按M3a的观察规则分类。
- 真实L1/L2拓扑：记录L1同存储copy实际是无task同步返回还是回退为task，并通过对应分支的断言；L2跨storage copy返回task并跟踪到终态。

## M7 通知与配置迁移

交付：Webhook HMAC协议、独立投递结果、按秘密处理的Webhook URL、脱敏export/import、运维信息。

任务：事件去重创建、有限attempt、重启不补发、原子导入/ID映射/缺secret禁用、关联归档规则。

验收：

- 按原始bytes验签；通知失败不改Run；导出无secret；update省略保留/null清除；import不启动远程写入。
- Webhook URL：数据库只保存加密的完整URL；ChannelView只返回urlOrigin与urlHasPathOrQuery；导出只写urlOrigin，已有needsUrlReview或原URL含非根路径/query时仍为true；导入后needs_url_review=1时启用返回409 URL_REVIEW_REQUIRED，任何提供url的PATCH将其清除；日志不含URL路径或query。

## M8 发布

交付：Dockerfile与部署示例、OpenAPI完整契约、README和用户指南、AGPL-3.0许可证及CLA（同步package.json的license字段）、版本兼容记录。

任务：固定Node24-bookworm-slim版本、原生依赖架构验证流程、迁移携带、备份恢复演练、指南和API示例对照。

验收：

- 用固定版本的官方OpenList发布镜像及4.2.5镜像重跑L1/L2/L3，包括M3a/M3b/M6的真实拓扑验收；记录copy实际是同步返回还是fallback，并把镜像tag/digest和OpenList版本写入兼容版本记录。
- 只有实际通过的Local操作可在驱动矩阵标integration-tested；其余保持source-derived；仅有设计不能标tested。
- 用户指南写明两类已接受风险：未知结果的隔离到期后旧请求仍可能迟到写入（[ADR 0004](../adr/0004-quarantine-expiry.md)）；server_copy下异步受理驱动的同存储复制按成功计，后台失败不可见（[ADR 0005](../adr/0005-openlist-success.md)）；relay主动中止上传后目标端可能迟到清理。指南同时说明驱动矩阵的读法和云盘人工验证步骤。

## 端点归属

路径均相对/api/v1，形状见[REST API](../reference/rest-api.md)与[执行API](../reference/api-execution.md)。端点在下表的里程碑交付并通过API e2e。

| 里程碑 | 端点                                                                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0     | POST /auth/login、GET /auth/me、POST /auth/change-password、GET /system/health/live、GET /system/health/ready、GET /docs、GET /openapi.json                                       |
| M1     | /instances的CRUD、POST /instances/:id/test、POST /instances/:id/browse                                                                                                            |
| M2     | /jobs的CRUD、POST /jobs/:id/runs（dryRun=true）、GET /runs、GET /runs/:id、GET /runs/:id/operations、GET /runs/:id/issues                                                         |
| M3a    | POST /jobs/:id/runs真实执行、POST /runs/:id/cancel、GET /operations/:id、GET /operations（unresolved过滤）、POST /operations/:id/quarantine-release、POST /operations/:id/resolve |
| M4     | POST /jobs/:id/enable、POST /jobs/:id/disable、GET /jobs/:id/next-fire-times                                                                                                      |
| M7     | /notification-channels（含POST /notification-channels/:id/test）、/notification-deliveries、GET /system/info、GET /system/export、POST /system/import                             |

## 横向完成条件

每阶段同步更新OpenAPI和受影响的设计文档，不留“最后再补契约”。每功能需覆盖入口→核心→边界/异常→出口，检查资源释放和状态持久化。
每文件≤500行、JSDoc完整、无any/静默异常、无未授权新依赖；lint配置生效前，“无any”由代码评审检查（见[约定](conventions.md#已核查基线)）。行为验证标准见[测试策略](testing.md)。
