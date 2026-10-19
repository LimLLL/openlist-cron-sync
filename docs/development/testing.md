用途：定义实现阶段的行为测试、拓扑及文档交付验证。

范围：只证明实际测试覆盖的协议与驱动；不将模拟器成功当云盘兼容证明。

# 测试策略

## 单元与组件

| 对象             | 必测行为                                                                                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| planner/filter   | 两模式矩阵、过滤优先级、被排除源同名目标保护、source或Target大小未知；syncEmptyDirs=true创建全部未排除目录（含空目录），false只建所需父目录；超过最大扫描深度只保护该子树；createMode=server_copy含跨Instance Target时配置校验拒绝                                                                        |
| glob             | `cache/`只匹配endpoint根下名为cache的目录并保护其子树；`**/cache/`匹配任意深度的cache目录；`**/tmp`对文件和目录路径都生效，命中目录时剪枝并保护；`*.log`不跨层：include只筛文件，exclude同时匹配根层文件和目录；include只筛选文件，不决定目录创建                                                         |
| collision/path   | 原名精确比较、源/目标内部与跨侧碰撞、目录后代保护、/a与/ab；endpoint.path以`/@s`开头（含`/@sync`）保存400，根endpoint下`@s`开头的条目两侧固定排除；名称含`/`或`\`（`a\b`、`..\x`、`..\..\x`）→INVALID_NAME并保护父目录，且从不进入names[]、File-Path或/d、/p URL；%、+、#、?、中文、emoji、空格的编码往返 |
| mount            | `.balance`按mount_path中最后一次出现的位置截断（`/a.balance1`与`/a.balance/b`的有效挂载都是`/a`），不是只去后缀；按路径段最长匹配；多个候选不猜；嵌套挂载禁止相关删除                                                                                                                                     |
| safety           | replace+extra共同阈值、D=0、等于边界、禁用/override不覆盖其他保护                                                                                                                                                                                                                                         |
| state/recovery   | 所有状态转换、提交前事务窗口、无task成功不是unknown、历史终态不改写、Operation按(run_id, seq)排序                                                                                                                                                                                                         |
| mutation outcome | 明确的执行前拒绝（400、403含file exists与IgnoredSystemFile、405、认证阻断）→failed且不观察，IgnoredSystemFile不重试；JSON 500或其他未列出的非成功码→一次refresh=true观察后分类（见故障窗口第5项）；超时/断连/已知tid查询不到→unknown；明确成功无task→succeeded                                            |
| relay pipeline   | 下载不等上传；spool预算与防死锁优先级；块拼chunk按init返回的chunk_size；最后一个chunk等源EOF；chunk重传读取原spool数据；429/409流控不耗重试预算；status心跳与停止条件                                                                                                                                     |
| quarantine       | TTL/人工release先刷新，unknown不变，后续resolution独立；abandoned后不再要求重新观察，删除前refresh复查照常                                                                                                                                                                                                |
| token            | 同一失效token只登录一次、迟到401不重登、401/402阻断、429持久冷却                                                                                                                                                                                                                                          |
| concurrency      | Job queued占位、写写/读写冲突、名额释放、A→B与B→A的relay名额无死锁、取消token等待                                                                                                                                                                                                                         |
| crypto           | 错key/错AAD/篡改tag失败、随机nonce、改密撤销JWT、秘密导出/日志不泄露；主密钥错误时启动失败且不写入新ENC值                                                                                                                                                                                                 |
| webhook          | 精确原始字节签名、重试相同eventId、不同timestamp、3xx失败、结果独立；URL的路径和query不进入日志、ChannelView或导出                                                                                                                                                                                        |

glob用例的预期以[路径与过滤](../design/filters-paths.md)为准；relay规则见[Relay](../design/relay.md)。
优先纯函数输入→预期，不mock内部实现细节。并发测试使用可控时钟/门闩，避免sleep碰运气；测试用标准库和现有Vitest。

## 实际OpenList拓扑

| 标识   | 拓扑                                      | 验收                                                                                                                         |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| L1     | 单实例、一个Local storage下两个目录       | 同存储relay与server_copy、Put/Remove；记录copy是无task同步返回还是回退为task，不能预设reflink可用；替换链                    |
| L2     | 单实例、两个Local storages                | 同实例跨storage的relay；server_copy返回task并跟踪到终态                                                                      |
| L3     | 两个OpenList实例，各Local                 | 跨实例relay、权限、base_path、取消、部分上传；其中一个实例使用4.2.5                                                          |
| S1可选 | MinIO经S3 driver                          | 观察/d是否实际302，验证可达性；只作为可选传输夹具，不把S3全驱动标集成认证                                                    |
| F1     | 测试进程内的Node可控HTTP服务（node:http） | 稳定制造失败窗口、JSON 500、302、401、429/409、短流、超长流、Range、session消失、成功无task；随pnpm test运行，不需要外部实例 |

L1/L3在M3a/M3b验收时真实运行，L2的server_copy部分属于M6，M8用固定发布镜像重跑；见[里程碑](milestones.md)。

### 集成测试运行方式

- 真实OpenList测试使用`*.int-spec.ts`后缀。现有`pnpm test`只匹配`**/*.spec.ts`，`pnpm test:e2e`只匹配`**/*.e2e-spec.ts`，两者都不会选中它，因此单元与e2e运行不依赖外部实例。
- M1 已经维护者确认，新增 `vitest.config.integration.ts` 与 `pnpm test:integration`，只运行 `*.int-spec.ts`；不新增测试依赖。
- OpenList实例在测试进程外准备：使用固定版本的官方发布镜像（docker run或compose）或官方release二进制，禁止docker build。每次记录镜像tag/digest或二进制版本、OpenList版本、平台、Local storage配置和实际响应。
- 实例地址、凭据和各Local storage的挂载路径通过环境变量传入，统一使用前缀`OPENLIST_IT_`，变量名见下表。变量缺失时`pnpm test:integration`立即失败并列出缺少的变量，而不是跳过：跳过会让一次“零测试”的运行显示为通过。
- 只使用临时实例与临时数据，测试结束由夹具清理；禁止指向生产目录。

M1 必需变量（缺失或空字符串均在 Vitest 收集测试前失败，一次列出全部缺失名称）。本地开发可写在项目根 `.env` 中：`pnpm test:integration` 只从中读取 `OPENLIST_IT_*`，已在环境中设置的值优先；`.env.example` 有占位示例。

| 变量                    | 含义                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| OPENLIST_IT_BASE_URL    | 官方 OpenList 实例的 http(s) 地址，可带反向代理子路径                                                |
| OPENLIST_IT_ADMIN_TOKEN | OpenList 管理员静态 token（裸 token）                                                                |
| OPENLIST_IT_USERNAME    | 密码认证账号；必须能读取下述 Local 目录，不支持启用 OTP 的账号                                       |
| OPENLIST_IT_PASSWORD    | 该账号的原始密码；测试按上游静态哈希协议登录                                                         |
| OPENLIST_IT_LOCAL_PATH  | 两种账号均可访问的账号相对 Local 目录；管理员全局映射必须唯一解析为已启用、status=work 的 Local 存储 |

M1 集成用例只读：验证两种认证、连接测试、浏览与管理员完整挂载解析，不创建远端文件，也不调用 multipart init。测试自己的 Nest/SQLite 资源放在临时目录并清理。若两账号 base_path 不同，所给相对目录必须对两者都有效。运行命令为 `mise exec -- pnpm test:integration`。M1 已对官方镜像实际运行，记录见[OpenList依赖表](../reference/openlist-api.md#兼容版本)；只读用例不涉及驱动写入语义，不据此把驱动矩阵标为 integration-tested。

M1 的 F1 用例在 `pnpm test` 内覆盖认证竞态与跨重启阻断、HTTP/envelope/大小边界、读取退避与 Retry-After、禁止跳转、执行前401只重放一次且上传body不重放、挂载分页、名称编码、任务和 multipart 协议；API e2e 覆盖公共路由与生产 ENC 错/缺密钥启动失败。注释与测试均不替代真实镜像兼容验收。

MVP兼容记录中只有Local相关操作在实际通过后可标integration-tested；其余source-derived，真实云盘由用户使用时手工验证并记录manual证据，不自动升级为integration-tested。

## 必须覆盖的故障窗口

1. server_copy的copy code200无task直接成功，包括模拟后台随后失败；不得创建accepted状态或relay fallback。
2. 已知tid从pending到重试中再成功；progress100仍未终态；delete_some逐id失败；清理时task已不存在只清除remote_cleanup_pending，不改Operation结果；本地unknown而远程running时绝不delete；远程终态再转running时只建立一条REMOTE_TASK_CHANGED记录。
3. submitting落库后，远端接受但响应丢失；重启产生unknown，不按任务名字或path+size匹配。
4. OpenList重启：JWT失效后重登再查task得404；multipart session消失，chunk或status返回404且无完成证据→unknown；静态token路径也覆盖。
5. 变更得到JSON 500后的观察（F1）：create的同名文件以预期大小出现、mkdir的目录出现、remove的路径消失→succeeded（OBSERVED_AFTER_ERROR）；create名称不存在或delete原路径仍以预期类型和大小存在→failed并在预算内重试；大小不同、观察读取失败、视图suspect→unknown并隔离。
6. relay分片：init已启动驱动写入但响应丢失→unknown；chunk响应丢失后按status补发；429/409退避；complete成功后响应丢失、status 404→unknown；session转为failed_retriable/failed_permanent→failed且不发chunk 0；abort立即返回而驱动稍后才退出（Local迟到删除）。
7. relay源异常：源过长、过短、Content-Length不符、Range返回206/200/416、validator变化、/d 401重新取sign；源异常主动abort后记failed，同Run重试前先refresh观察并清理残留。
8. relay空间：文件明显大于可用spool时仍持续推进，已开始上传的文件不被预读饿死；预算不足时下载暂停不报错；真实ENOSPC记SPOOL_FULL；SPOOL_RESERVE_BYTES保护同卷SQLite；重启后spool被清空。
9. 替换链，按[替换链](../design/sync-engine.md#替换链)记录：
   - relay打开源或读首块失败：旧文件不动，create failed。
   - 删除前重读父目录失败、403或视图suspect：不提交delete；delete跳过，create跳过（DEPENDENCY_FAILED），该Target extras禁止。
   - remove超时或响应丢失：delete unknown，create跳过，原路径隔离。
   - 删除确认期内原名仍存在：有界等待后failed（DELETE_NOT_EFFECTIVE），不开始create，也不使用overwrite=true；确认时refresh失败或视图suspect：unknown。
   - delete已完成、create失败：目标暂缺该文件，下一次Run重新创建。
   - create重试发现部分目标文件：先refresh确认先前动作已结束，以retry_cleanup删除，重新检查剩余预算后再create；绝不overwrite=true；已成功的delete不重复提交，下一Run中原名缺失记PRECONDITION_ALREADY_ABSENT（正常skipped）。
10. user cancel与Run timeout：停止新派发，对已记录的multipart session发abort、对已知tid发cancel，不delete运行中task；宽限内无终态证据的动作unknown并隔离。
11. SIGTERM与强杀：SIGTERM后ready=false，停止新触发、派发、提交和维护，中止本地扫描与下载，宽限内尝试abort已记录的multipart session，保存已收到的结果，不cancel已知task，不写Run终态。下次启动queued重新入队，scanning/planned→interrupted，executing/cancelling/recovering→recovering→interrupted（PROCESS_RESTART）；recovery_deadline_at只在首次进入recovering时写入。强杀依赖恢复识别submitting窗口。
12. TTL或人工release后刷新失败仍不能写；刷新通过按当前状态执行；允许模拟迟到写入，验证风险政策而非“绝不迟到”。重启后unknownUntil不变，active隔离持续到原到期时间；重复release返回已有结果，不重置期限。
13. non-admin警告、admin storage分页改变、balanced/nested mounts、隐藏mount_details；admin storage列表读取失败或不完整时相关删除禁止，不降级为非管理员路径。
14. source子树失败禁止所有删除；Target失败只影响该目标；纯新建仍按明确范围继续。
15. Target根：缺失（父目录可列出且无该名称）时dry-run计划全部create并报告TARGET_ROOT_WILL_BE_CREATED，真实Run先prepare mkdir再create；父目录列表失败、权限错误或父列表仍有该名称时记TARGET_ROOT_UNAVAILABLE，无create和删除，Run partial；新建根在mkdir后无法刷新确认时不执行子动作。source根失败则Run failed。
16. mirror且syncEmptyDirs=true：Target独有目录在其中extras删除后自底向上删除，每个先refresh=true确认为空，发现非空则skipped PRECONDITION_CHANGED、不递归清除；syncEmptyDirs=false时不删除任何Target目录。
17. 0字节源须先确认EOF才发送put；无Content-Length但实际非空时不发put。覆盖非identity响应、跨origin剥离凭据、极低带宽且取消不卡死。
18. 阈值禁用或confirmDeletes不能绕过冲突/挂载/隔离；受保护后代所在的祖先目录不被删除。
19. import原子失败、缺secret禁用、update省略保留/null清除；needs_url_review=1的channel启用返回409 URL_REVIEW_REQUIRED；导入带needsUrlReview=true的origin URL后再次导出，标志仍为true。
20. DB满/迁移错误/密钥缺失或错误：不继续产生未记账远程写入；已有密文的启动校验发生在打开数据库后、初始化或写入任何新ENC前。
21. warning与重试收敛：仅Target单侧的碰撞/未知大小/非法名称保护规定范围，但不使Run降级、不阻断范围外extras；一次failed后安全重试成功不残留extras_blocked。有关联source的碰撞仍阻断该Target。
22. 连接测试：版本低于4.2.5或无法解析→OPENLIST_VERSION_UNSUPPORTED；multipart_enabled=false→MULTIPART_DISABLED；连接测试从不调用multipart init。错误摘要中的Webhook path/query不得泄露。

## API e2e与命令

supertest验证真实Nest路由、Guard、ValidationPipe、DTO metadata、错误体、HTTP状态、分页及OpenAPI字段，不只调用service方法。至少覆盖：

- API_DOCS_ENABLED=true时/api/v1/docs与/api/v1/openapi.json无需认证，false时两者都不提供；除login与health外的路由缺少JWT返回401。
- 登录限流：失败次数达到上限后返回429及Retry-After，被拒绝的请求不运行scrypt、不计数。
- ChannelView不含完整URL，只有urlOrigin与urlHasPathOrQuery；needs_url_review=1时启用返回409，提供url的PATCH将其清除。
- Run的Operation列表按(run_id, seq)返回计划顺序。

实现阶段相关命令：

| 命令                                                              | 检查内容                                                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| pnpm run lint                                                     | oxlint检查src/与test/（.oxlintrc.json，no-explicit-any为error）；不检查悬空Promise，见[约定](conventions.md#已核查基线)           |
| pnpm exec tsc --noEmit --incremental false -p tsconfig.build.json | 应用代码类型检查（排除test/与`*spec.ts`）                                                                                         |
| pnpm exec tsc --noEmit --incremental false -p tsconfig.json       | 含src、test与vitest配置的类型检查（Vitest只转译不检查类型）                                                                       |
| pnpm test                                                         | 单元与组件测试（`**/*.spec.ts`，含F1）                                                                                            |
| pnpm test:e2e                                                     | API e2e（`**/*.e2e-spec.ts`）                                                                                                     |
| pnpm test:integration                                             | 真实OpenList拓扑（`*.int-spec.ts`）；M1起提供，需要外部实例                                                                       |
| pnpm build                                                        | 仅验证应用构建，不等于镜像构建                                                                                                    |
| pnpm exec node test/compiled-smoke.mjs                            | 先build；用临时数据目录从其他工作目录启动编译产物，验证迁移、认证、改密撤销、SIGTERM、重启、文档开关、fail-fast及JSON日志不含秘密 |

纯文档变更不要求运行会在docs外生成dist/tsbuildinfo的build；可运行无输出的typecheck与lint并执行下节文档检查，同时明确报告未运行的应用/容器测试。

## 文档交付检查

以下检查适用于纯文档变更；实现变更按上节命令验证，并在同一变更中同步受影响的文档。

- 每个.md第一段说明用途，第二段说明范围；每文件≤500行。
- 全部相对Markdown链接解析到实际文件；带fragment需匹配显式id或Markdown标题锚点；不只查文件名。不链接被git忽略的目录。
- RunStatus/OperationStatus只在state-machines定义规范值；SQL、DTO、时序及测试一致，无accepted、delete_source或源move基线。
- config默认值与表字段/API一致；单位明确，NULL/0不同含义可测试；可调默认值只在配置参考定义，其他文档引用而不复述。
- [驱动矩阵](../reference/driver-matrix.md)对当前源码基线中每个非模板上游驱动（86个）各有一行，列为驱动、Copy（server_copy 同存储）、Put（relay 写入；目标已有同名时）、Remove（删除）、说明、主要证据、实测；每个结论有源码证据，“实测”列只记录真实执行过的测试，不伪造。
- 纯文档变更时git status --porcelain仅含docs/。
- Prettier检查docs Markdown格式；使用现有依赖，不新增文档lint包。
