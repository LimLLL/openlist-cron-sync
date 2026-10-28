用途：定义 createMode=relay（下载上传）的分片流水线、资源、字节规则和结果分类。

范围：已知大小的单文件；跨本服务重启的续传、多目标共享下载和复制后内容校验不在 MVP。

# Relay（下载上传）

relay 是每个 Target 的默认创建方式（见[创建方式](sync-engine.md#创建方式)）。它从源实例下载文件，再用目标 OpenList 的分片上传接口写入目标，对源与目标是否同一实例、同一 storage 没有要求。同实例同 storage 也照常下载再上传，不借用 OpenList copy。

## 总体结构

Job 源配额只覆盖未完成的源读取，Target 文件配额覆盖准备、上传、complete 和收尾；本地磁盘 spool 解耦读取和上传：

```text
源 GET 流 ──Job源配额──▶ spool（1 MiB 块）──Target文件配额──▶ multipart chunk ──▶ complete
```

- 文件开始前取得 Job 源配额和 Target 文件配额，再预留首块、打开 GET。精确长度和正常 EOF 验证后立即关闭源 body/Agent、归还源配额；Target 配额一直持有到 complete 或本地收尾结束。
- 首个 spool 块在打开源 GET 前预留。随后读取块、发布并按 FIFO/frontier 优先级发送；配额为 0 时不设置隐含进程上限。
- 一个文件的 chunk 请求受 Target 的 chunkConcurrency 限制，complete 仍由同一个 Target 文件配额保护。
- Sync 的文件协调器连接两端：负责删除依赖和结果落库；Relay 提供准备句柄，并等待 submitting、session 和 EOF 的持久化检查点后才继续网络操作。等待 complete 仍持有 Target 文件配额，但不占 chunkConcurrency 窗口。
- 每个 (源文件, Target) 独立下载一次；同一文件发往多个 Target 时各自下载，不共享 spool 块。
- 下载阶段包括首块空间等待、未完成源读取时的替换准备、spool 背压和 Range 恢复。小文件（≤1 MiB）及空文件在 prepare 中已验证 EOF，立即释放源；上传阶段不再探测已关闭的源。内存 EOF 事实与数据库 source_stream_completed_at 分开，后者仍在最后 chunk 或空 PUT 前持久化。

## 资源

| 资源                          | 默认   | 说明                                                                                               |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| Job sourceDownloadConcurrency | 2      | 同 Job 所有 Target 共享的下载中文件数，EOF 后释放；0 不限                                          |
| Target concurrentFiles        | 2      | relay 从准备到 complete 收尾的文件数；server_copy 未终态任务数；也约束 mkdir 与文件 extras；0 不限 |
| Target chunkConcurrency       | 2      | 每个 relay 文件同时发送的 chunk 请求数，范围 1–8                                                   |
| SPOOL_RESERVE_BYTES           | 512MiB | SQLite/WAL 保留空间；spool FIFO 背压仍是容量约束                                                   |

数值的配置键见[配置](../reference/configuration.md)。Job 和 Target 配额按稳定的 Job/Target ID 隔离；不同 Job 同时运行时额度相加。server_copy 的 concurrentFiles=0 会持续提交所有待复制的任务，可能使 OpenList 同时承受大量任务。relay 的 concurrentFiles=0 同样允许大量已下载文件等待 complete；它们已释放源位和已确认的 spool 块，但仍有目标请求、会话和心跳开销。源配额不再限制这种积压，spool 只约束磁盘 payload；需要限制在途总量时使用 Target concurrentFiles。
本地没有 Instance 级 API 并发或速率配额：init、status、abort、chunk、complete 及 get/copy/task-info 不等待实例 API 名额，也不受扫描间隔约束；传输仍遵守已有的文件、分片与带宽规则，观察和清理不另取文件名额；只有扫描列目录、mkdir 与 remove 按 Job/Target 扫描间隔拉开开始时间，见[扫描间隔](scheduling-recovery.md#扫描间隔)。complete 受 Target 文件配额及 relay 文件总期限约束，长时间等待不会阻塞同一 Instance 的 list、取消或 status 请求。

## Spool

- 目录 `SPOOL_DIR`，默认 `DATA_DIR/spool`，权限 0700，文件 0600。块固定 1 MiB（最后一块可更短），先写临时文件，关闭后才发布给上传流水线；未完成的块不可消费。
- 块内容与引用只存在于当前进程，不建持久化块表或续传索引。启动时在重建未决责任之后清理私有relay-UUID目录，保留其它内容；若清理范围与DATA_DIR重叠则拒绝启动，防止误删数据库。备份排除 spool。
- 预算 = 文件系统对本进程的可用空间 − `SPOOL_RESERVE_BYTES`（默认 512 MiB，保证同卷的 SQLite/WAL 仍可写）− 已承诺未完成的写入。不需要配置上限，默认可用全部剩余空间。
- 预算不足时下载暂停等待上传释放空间，这是正常背压，不报错。明确例外：init 的 session 已持久化后，如果该文件 frontier 的实际 payload 即使释放本进程全部 spool 仍无法容纳，则有界主动 abort，记 failed SPOOL_FULL（摘要为 insufficient spool capacity）。自身其它 session 的临时争用只等待；容量条件未改变时本 Run 不反复创建 session。真实写入失败（ENOSPC、EDQUOT 或其他 I/O 错误，例如其他进程占满磁盘）记 SPOOL_FULL 或 SPOOL_IO_ERROR，按下文“主动 abort”收尾该文件。
- spool 含明文文件内容（crypt 源下载后即为明文）；清理是普通删除，不承诺安全擦除。

防死锁规则：

1. 以 init 返回的 chunk_size 和剩余文件大小计算 frontier 的实际 payload；为可推进的 session 保留完整 chunk 的进展额度，不把两块 1 MiB 当作足够条件。已发送但未确认的数据仍须保留供重传。
2. 已开始上传的文件，其下一个缺失块优先于任何预读；上传优先发送最靠近 session frontier 的 chunk。
3. 尚未开始上传的文件最多预读一个块；spool FIFO/frontier 优先级保证已有上传先消费缺块。
4. 空间紧张时暂停新的源读取，让已有上传消费并释放块；这是容量背压，不是隐藏的并发上限。源位必须在首块预留之前取得，禁止先持有首块预留再等待源位。

因此 60 GB 文件不需要 60 GB spool：已确认的块持续释放。等待同样受 relay 与 Run 总期限约束。OpenList 侧另有磁盘开销（每 session 最多 8 个 chunk 的接收窗口，部分驱动还会缓存整文件）；与 OpenList 同机部署时一并估算。

## 单文件流程

1. **配额**：取得 Job 源文件配额和 Target 文件配额，并预留首个 spool 块；配额等待和 spool 等待都可被取消。
2. **打开源**：解析全局 /d 或 /p 路径及 sign，GET 携带 `Accept-Encoding: identity`，通常不向下载路由发送 OpenList API token。最终必须是 200；Content-Length 存在时必须等于计划 size。Content-Type 不作判断。首个块已预留后才打开 GET，并读入 spool，证明源能正常出数据。
3. **删除依赖**：替换时先按[删除保护](deletion.md#执行时复查)remove 旧文件并 refresh 确认消失；第 2 步失败时绝不删除。删除失败则本 create skipped DEPENDENCY_FAILED，释放 spool 与名额。
4. **提交**：Operation 写 submitting 并提交事务，然后 `POST /api/fs/multipart/init`：File-Path 一次编码，`X-File-Size`=size，`Overwrite: false`，不发 hash 头、不发 `X-Chunk-Size`、不发 Content-Type（OpenList 按文件名推断）。源 modified 可解析且晚于 Unix 纪元时发送毫秒 Last-Modified；Go 零值时间或 ≤0 毫秒省略。
5. **记录 session**：收到有效 init 响应后，先持久化 upload_id、state、attempt 与 chunk_size，再发送任何 chunk。chunk i 由块 `[i×k, (i+1)×k)` 拼成，k = chunk_size ÷ 1 MiB。
6. **发送 chunk**：`PUT /api/fs/multipart/chunk`，带 `X-Upload-Id`、`X-Chunk-Index`，body 精确取自 spool。确认后释放对应块。
7. **最后一个 chunk**：只有源正常 EOF 且累计字节恰好等于 size 后才发布；先持久化 source_stream_completed_at。源多出任何字节都在最后一个 chunk 发出前发现，按 SIZE_MISMATCH 主动 abort。
8. **完成**：`POST /api/fs/multipart/complete` 等待驱动结果；返回 completed 即 succeeded。此时源已关闭并释放配额，可下载后续文件；Target 文件名额在结果落库及收尾后释放。首块重新发布到 spool 后清空内存副本，payload 全部发送完成时刷新最终字节并停止周期进度写入；complete 等待仍保留 session 心跳。

### chunk 重试与心跳

- 同一 session 内重传必须读取原 spool 数据；OpenList 对已接收的 chunk 只吸收、不比较内容。
- 响应丢失先按 upload_id 查 status：已在 received 区间则视为确认；仍 receiving 且明确缺失才重发。
- 429（窗口满）和 409（同块在途）是流控：250 ms 起、最高 2 秒的抖动等待，不消耗重试预算，仍受总期限约束。其他瞬时错误使用 RETRY\_\* 有界预算。
- 每次响应都检查 session 的 state 与 attempt，不能只看 code 200。attempt 意外变化或 state 不再是 receiving 时停止发送，按下表收尾。
- 出现 failed_retriable 时不发送 chunk 0 触发 OpenList 自动重填；文件级重试创建新 Operation。init 若返回旧 failed_retriable session 的同一 upload ID，先将本次尝试记录为 failed 并尝试 abort，再由下一尝试 init 新 session；不同历史尝试允许记录同一 ID，不续传旧 session。
- session 活跃期间（含下载暂停和 complete 等待）每 60 秒查询一次 status，防止 OpenList 的 30 分钟闲置 TTL 到期；进入 abort 或 unknown 收尾后停止心跳。
- 不用 path+size 查询结果接管或续传 session，只用于诊断。

### 0 字节文件

OpenList 分片接口不接受 0 字节。先确认 GET 正常 EOF 且没有任何 body 字节，再执行删除依赖，然后 `PUT /api/fs/put`：File-Path、`Content-Length: 0`、`As-Task: false`、`Overwrite: false`，按同一规则带 Last-Modified，并消费最终响应。body 非空则 SIZE_MISMATCH，不发 PUT。

源大小未知（含 OpenList 负数 size）按 UNKNOWN_SIZE 跳过；其他非法 size 按[依赖表](../reference/openlist-api.md#list对象)拒绝。

## 下载中断与续传

- 中断时保留已完整写入的块，丢弃未完成的块，从本地完整前缀的结束偏移发起 `Range: bytes=N-`。源有强 ETag 时同时带 `If-Range`。
- 206：校验 Content-Range 的起点与总大小。200：validator 已变化则 SOURCE_CHANGED；否则视为源忽略 Range，从 0 读取并丢弃前 N 字节。416 或总大小变化：SOURCE_CHANGED。
- 没有可靠 validator 时只能按名称、类型、大小继续；同大小的源变化可能造成跨请求内容混合，这是已接受风险。
- /d 自身 401 重新 list 一次取 sign，源大小或类型变化则 SOURCE_CHANGED；跳转后的云端 401 不触发账号登录。
- 续传次数受 RETRY\_\* 预算约束；长度或大小变化时停止该文件，按主动 abort 收尾。

## 背压与限速

使用 undici.request 和可取消的流；所有 response body 必须消费或 destroy。
Job.relayBandwidthLimit 是该 Job 全部上传 payload（所有 chunk、重传和 0 字节路径）的 bytes/s 总和，0 不限。下载不受该值限速，由 spool 背压约束。分别统计 downloadedBytes 与 transferredBytes（上传，含重传）。
令牌桶容量为一秒额度，单次取用上限 64 KiB，大块拆分取用，不让小额度永久饥饿；使用单调时钟，等待可被 AbortSignal 中断。
server_copy 不受此设置限制。

## HTTP 与重定向

Agent 按 origin 分池；下载最多跟随 5 次跳转，每跳仅 http(s)，拒绝 userinfo 及 https 降级为 http。跨 origin 剥离 Authorization、Cookie、Proxy-Authorization。
管理 API、multipart 与 put 请求不跟随重定向，返回 UPSTREAM_REDIRECT。GET 跳转前销毁旧 body；最终错误响应有界读取摘要并脱敏。
不启用隐式 decompress，非 identity 编码的响应明确失败。支持私网 OpenList 及管理员指定的内网代理，信任边界见[安全](security.md)。

## 结果分类

本表是 relay 结果的唯一规范；multipart 的 JSON 400 不一律视为执行前拒绝。

| 证据                                                                                                  | Operation 结果                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 准入、打开源或读首块失败（尚未提交当前create）                                                        | failed，可按读取规则重试；SOURCE_CHANGED在此窗口为skipped，不回滚先前已成功的mkdir/delete                         |
| init 执行前明确拒绝：400（请求头无效）、403（已存在、无权限、IgnoredSystemFile、分片上传被关闭）、405 | failed，无需观察                                                                                                  |
| init 返回其他非成功 code                                                                              | 一次有界 refresh 观察：目标名缺失→failed，否则 unknown                                                            |
| init 响应丢失、超时或进程在 submitting 崩溃                                                           | unknown（init 一旦执行就已启动驱动写入）                                                                          |
| chunk/complete 响应带 session 快照                                                                    | 按快照 state 判定：receiving 继续有界重试；failed_retriable/failed_permanent→failed；aborted→同下方 abort 行      |
| complete 返回 completed，且已记录 source_stream_completed_at                                          | succeeded                                                                                                         |
| complete 响应丢失或超时，status 返回 404 或无法得出结论                                               | unknown（completed 后 session 会立即移除，404 不能说明失败）                                                      |
| 本服务因源异常（SIZE_MISMATCH、SOURCE_CHANGED）或 spool 写失败主动 abort                              | failed；接受目标端迟到清理的风险（见下）                                                                          |
| 取消、Run 超时或 SIGTERM 时 abort                                                                     | abort 之外没有结束证据时 unknown                                                                                  |
| IgnoredSystemFile                                                                                     | failed，后续 Run 同样失败；阻断该 Target 的 extras，建议用排除规则排除 .DS_Store、Thumbs.db、@eaDir、.\_\* 等名字 |

abort 成功或随后 status 404 都不证明驱动已停止：OpenList 取消上下文后不等待驱动退出。主动 abort 记 failed 是已接受风险——目标端可能迟到清理（例如 Local 驱动在请求取消时删除已写的部分文件），该清理可能晚于重试而删掉重试写入的文件；下一次 Run 会发现缺失并重新创建，源文件不受影响。
同一 Run 内的文件级重试先 refresh 观察目标路径；有残留则按[替换链](sync-engine.md#替换链)的 retry_cleanup 清理并确认缺失后，才用新 Operation 和新 session 重新创建。unknown 在同一 Run 不重试；后续 Run 按自己的扫描规划，旧结果保持不变，见[未知历史](scheduling-recovery.md#unknown历史)。
上传失败可能留下同名同大小的错误文件，名称+大小比较会将其视为 unchanged；不为此引入 hash 或修复索引，这是已接受的比较能力边界。

## 超时

连接、控制 API、下载 idle、relay total 与 Run total 分别配置，见[配置](../reference/configuration.md)。

| 计时                  | 规则                                                               |
| --------------------- | ------------------------------------------------------------------ |
| 下载 idle             | 只在正向源索取数据而没有字节到达时计时；spool 背压和令牌等待不计入 |
| init / status / abort | 每次尝试独立的普通 API 超时，含建连与响应，不含认证等待和退避      |
| chunk 请求            | relay total；低带宽下单个 chunk 本来就可能很久                     |
| complete 等待         | relay total；OpenList 驱动可能还在向云端上传                       |

等待名额、spool 空间或令牌不算网络无进展，但计入 relay 与 Run 总期限。取消或源/分片/心跳失败时先停止并等待源读取退出、释放源位，再等待远端 abort、结果观察或 spool 清理；完整文件重试在退避之后重新申请源位，Range 恢复则始终持有原源位。

## 验收

覆盖：

- 文件明显大于可用 spool 时仍持续推进，已开始上传的文件不被预读饿死；
- 429/409、chunk 响应丢失后按 status 补发；
- init 已写目标但响应丢失；complete 成功后响应丢失；
- abort 立即返回但驱动稍后才退出（Local 迟到删除）；
- 长时间背压或 complete 等待期间心跳续期，放弃后停止心跳；
- 最后一个 chunk 等待源 EOF；源过长、过短，0 字节但实际响应非空；
- Range 返回 206/200/416 以及 validator 变化；
- 真实 ENOSPC 与 SQLite 保留空间；
- 跨 origin 跳转剥离凭据，源 401 与云端 401；
- 极低限速下取消不卡死；
- 同实例同 storage、同实例跨 storage 与跨实例三种拓扑。

测试只证明传输协议行为，不能证明云驱动的完整性。
依据：[OpenList multipart](https://github.com/OpenListTeam/OpenList/blob/5447ecb0/server/handles/multipart.go)、[Undici Dispatcher](https://undici.nodejs.org/api/Dispatcher)。
