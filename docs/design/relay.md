用途：定义 createMode=relay（下载上传）的分片流水线、资源、字节规则和结果分类。

范围：已知大小的单文件；跨本服务重启的续传、多目标共享下载和复制后内容校验不在 MVP。

# Relay（下载上传）

relay 是 Job 的默认创建方式（见[创建方式](sync-engine.md#创建方式)）。它从源实例下载文件，再用目标 OpenList 的分片上传接口写入目标，对源与目标是否同一实例、同一 storage 没有要求。同实例同 storage 也照常下载再上传，不借用 OpenList copy。

## 总体结构

下载和上传是两组独立 worker，中间是本地磁盘 spool：

```text
源 GET 流 ──下载worker──▶ spool（1 MiB 块）──上传worker──▶ multipart chunk ──▶ complete
```

- 下载 worker 的工作单位是一个 spool 块：取得空间额度、从该文件的 GET 流读满 1 MiB（或读到 EOF）、写盘、发布，然后立即去处理下一个块或下一个文件，不等待上传。
- 上传 worker 的工作单位是一次 chunk 请求：取若干已发布的连续块拼成 chunk 发送，确认后释放这些块。
- 文件协调器连接两端：负责准入、删除依赖、init、最后 chunk 的发布时机、complete 和结果落库。等待 complete 不占 chunk worker。
- 每个 (源文件, Target) 独立下载一次；同一文件发往多个 Target 时各自下载，不共享 spool 块。

## 资源

| 资源                         | 默认 | 说明                                           |
| ---------------------------- | ---- | ---------------------------------------------- |
| 全局下载 worker              | 4    | 正在读取并写入 spool 的块数                    |
| 每源 Instance 下载连接       | 2    | 打开的 GET，包括因 spool 背压暂停的连接        |
| 每目标 Instance 上传 session | 2    | 从 init 前预留，到 complete 结果落库或本地收尾 |
| 全局 chunk 上传 worker       | 8    | 同时进行的 chunk HTTP 请求                     |
| 每目标 Instance chunk 并发   | 4    | 防止单个实例占满全部上传能力                   |
| 每 session chunk 并发        | 2    | 固定值，不主动填满 OpenList 的 8 槽窗口        |

数值的配置键见[配置](../reference/configuration.md)。一个文件开始前同时取得源下载连接与目标上传 session，按 instance id 排序获取，避免 A→B 与 B→A 互相等待；同实例时分别占用两类名额。
init、status、abort 及 list/remove 等控制请求走实例的 API 并发与速率令牌；chunk 请求和 complete 等待使用上表名额，不消耗控制请求的速率令牌，长时间的 complete 等待也不占用取消和 status 所需的控制通道。

## Spool

- 目录 `SPOOL_DIR`，默认 `DATA_DIR/spool`，权限 0700，文件 0600。块固定 1 MiB（最后一块可更短），先写临时文件，关闭后才发布给上传 worker；未完成的块不可消费。
- 块内容与引用只存在于当前进程，不建持久化块表或续传索引。启动时在重建未决责任之后清空 spool；备份排除 spool。
- 预算 = 文件系统对本进程的可用空间 − `SPOOL_RESERVE_BYTES`（默认 512 MiB，保证同卷的 SQLite/WAL 仍可写）− 已承诺未完成的写入。不需要配置上限，默认可用全部剩余空间。
- 预算不足时下载暂停等待上传释放空间，这是正常背压，不报错。真实写入失败（ENOSPC、EDQUOT 或其他 I/O 错误，例如其他进程占满磁盘）记 SPOOL_FULL 或 SPOOL_IO_ERROR，按下文“主动 abort”收尾该文件。
- spool 含明文文件内容（crypt 源下载后即为明文）；清理是普通删除，不承诺安全擦除。

防死锁规则：

1. 每个已开始上传的文件保留至少两块的进展空间。
2. 已开始上传的文件，其下一个缺失块优先于任何预读；上传优先发送最靠近 session frontier 的 chunk。
3. 尚未开始上传的文件最多预读一个块，处于预读状态的文件总数不超过下载 worker 数。
4. 空间紧张时停止接纳新文件和预读，让已有上传消费并释放块。

因此 60 GB 文件不需要 60 GB spool：已确认的块持续释放。等待同样受 relay 与 Run 总期限约束。OpenList 侧另有磁盘开销（每 session 最多 8 个 chunk 的接收窗口，部分驱动还会缓存整文件）；与 OpenList 同机部署时一并估算。

## 单文件流程

1. **准入**：取得下载连接和上传 session 名额。
2. **打开源**：解析全局 /d 或 /p 路径及 sign，GET 携带 `Accept-Encoding: identity`，通常不向下载路由发送 OpenList API token。最终必须是 200；Content-Length 存在时必须等于计划 size。Content-Type 不作判断。读出第一个块（或小文件读到 EOF）写入 spool，证明源能正常出数据。
3. **删除依赖**：替换时先按[删除保护](deletion.md#执行时复查)remove 旧文件并 refresh 确认消失；第 2 步失败时绝不删除。删除失败则本 create skipped DEPENDENCY_FAILED，释放 spool 与名额。
4. **提交**：Operation 写 submitting 并提交事务，然后 `POST /api/fs/multipart/init`：File-Path 一次编码，`X-File-Size`=size，`Overwrite: false`，不发 hash 头、不发 `X-Chunk-Size`、不发 Content-Type（OpenList 按文件名推断）。源 modified 可解析且晚于 Unix 纪元时发送毫秒 Last-Modified；Go 零值时间或 ≤0 毫秒省略。
5. **记录 session**：收到有效 init 响应后，先持久化 upload_id、state、attempt 与 chunk_size，再发送任何 chunk。chunk i 由块 `[i×k, (i+1)×k)` 拼成，k = chunk_size ÷ 1 MiB。
6. **发送 chunk**：`PUT /api/fs/multipart/chunk`，带 `X-Upload-Id`、`X-Chunk-Index`，body 精确取自 spool。确认后释放对应块。
7. **最后一个 chunk**：只有源正常 EOF 且累计字节恰好等于 size 后才发布；先持久化 source_stream_completed_at。源多出任何字节都在最后一个 chunk 发出前发现，按 SIZE_MISMATCH 主动 abort。
8. **完成**：`POST /api/fs/multipart/complete` 等待驱动结果；返回 completed 即 succeeded。上传 session 名额在结果落库后释放。

### chunk 重试与心跳

- 同一 session 内重传必须读取原 spool 数据；OpenList 对已接收的 chunk 只吸收、不比较内容。
- 响应丢失先按 upload_id 查 status：已在 received 区间则视为确认；仍 receiving 且明确缺失才重发。
- 429（窗口满）和 409（同块在途）是流控：250 ms 起、最高 2 秒的抖动等待，不消耗重试预算，仍受总期限约束。其他瞬时错误使用 RETRY\_\* 有界预算。
- 每次响应都检查 session 的 state 与 attempt，不能只看 code 200。attempt 意外变化或 state 不再是 receiving 时停止发送，按下表收尾。
- 出现 failed_retriable 时不发送 chunk 0 触发 OpenList 自动重填；文件级重试一律新建 Operation 和新 session。
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
| 准入、打开源或读首块失败（未发生任何远程写入）                                                        | failed，可按读取规则重试，不隔离                                                                                  |
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
同一 Run 内的文件级重试先 refresh 观察目标路径；有残留则按[替换链](sync-engine.md#替换链)的 retry_cleanup 清理并确认缺失后，才用新 Operation 和新 session 重新创建。unknown 的路径进入[隔离](scheduling-recovery.md#unknown隔离)，不立即清理或重试。
上传失败可能留下同名同大小的错误文件，名称+大小比较会将其视为 unchanged；不为此引入 hash 或修复索引，这是已接受的比较能力边界。

## 超时

连接、控制 API、下载 idle、relay total 与 Run total 分别配置，见[配置](../reference/configuration.md)。

| 计时                  | 规则                                                               |
| --------------------- | ------------------------------------------------------------------ |
| 下载 idle             | 只在正向源索取数据而没有字节到达时计时；spool 背压和令牌等待不计入 |
| init / status / abort | 普通控制 API 超时                                                  |
| chunk 请求            | relay total；低带宽下单个 chunk 本来就可能很久                     |
| complete 等待         | relay total；OpenList 驱动可能还在向云端上传                       |

等待名额、spool 空间或令牌不算网络无进展，但计入 relay 与 Run 总期限。

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
