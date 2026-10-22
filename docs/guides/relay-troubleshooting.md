用途：帮助定位创建方式为“中转”（relay）时的下载、上传和磁盘问题，并给出对应的处理办法。

范围：面向运维排障；relay 的完整行为规范见 [Relay](../design/relay.md)，原因码见[固定原因码](../reference/rest-api.md#reason-codes)，默认值以[配置](../reference/configuration.md)为准。

# relay 排障

relay 从源实例下载文件，写入本地 spool（1 MiB 块），再用目标 OpenList 的分片上传接口（init → chunk → complete）写入目标：

```text
源 /d 或 /p ──下载──▶ spool ──chunk──▶ 目标 OpenList ──complete──▶ 驱动写入云端
```

## 先看哪里

- 控制台运行详情页的“操作”标签页，按状态筛选“失败”或“结果未知”；点进操作详情查看“错误”（原因码和摘要）、已下载和已传输字节数（已传输含重传），以及分片上传的状态、分片大小和“源数据流完成”时间。
- API：`GET /runs/:id/operations?status=failed`，或 `GET /operations/:id`，看 `error.code`、`error.message`、`bytesDownloaded`、`bytesTransferred` 和 `multipart`。
- 服务日志输出到 stdout/stderr（JSON）。`LOG_LEVEL=debug` 会记录更多连接层细节；日志中不会出现下载 URL、sign 或凭据。

## 常见现象对照

| 错误码 / 摘要                                               | 结果              | 常见原因                                                                                             | 处理                                                                                                                                          |
| ----------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| OPENLIST_ERROR / Download connection unavailable            | failed            | 本服务连不上源地址或跳转后的地址：容器内的 `localhost` 指容器自身、内网 DNS 不通、防火墙、连接超时   | 见下文“302 跳转与地址可达性”                                                                                                                  |
| UPSTREAM_REDIRECT                                           | failed            | 下载跳转超过 5 次、跳到非 http(s) 地址、地址带用户名密码，或从 https 降级为 http                     | 检查源存储与代理的跳转配置，或改用“代理流式”                                                                                                  |
| OPENLIST_ERROR / Download HTTP 401                          | failed            | 重新取得 sign 后 `/d` 仍拒绝，或跳转后的云端链接拒绝                                                 | 见下文“sign”                                                                                                                                  |
| OPENLIST_ERROR / Download HTTP 403                          | failed            | 云端直链绑定了 UA 或 IP、链接已失效；或“代理流式”下该存储不允许代理                                  | 见下文“302 跳转与地址可达性”                                                                                                                  |
| OPENLIST_ERROR / Download HTTP 5xx 或 429                   | 按预算重试后失败  | 源或云端暂时不可用、限流                                                                             | 稍后重试；持续出现时降低源实例的下载连接数                                                                                                    |
| UPSTREAM_PROTOCOL_ERROR / Download content encoding refused | failed            | 源 OpenList 前的反向代理压缩了下载响应                                                               | 对 `/d`、`/p` 关闭压缩；本服务只接受未压缩（identity）的响应                                                                                  |
| SIZE_MISMATCH                                               | failed            | 下载长度与计划大小不符                                                                               | 见下文“长度不符”                                                                                                                              |
| SOURCE_CHANGED                                              | skipped 或 failed | 规划之后源文件变了：名称、类型、大小或 ETag 变化，续传时返回 416 或长度变化                          | 正常现象，下一次运行会按新状态重新规划                                                                                                        |
| OPENLIST_ERROR / Download retries exhausted                 | failed            | 下载反复中断或空闲超时，续传次数用尽                                                                 | 见下文“Range 续传”和“低带宽”                                                                                                                  |
| SPOOL_FULL / SPOOL_IO_ERROR                                 | failed            | 本地 spool 空间不足或磁盘错误                                                                        | 见下文“spool 磁盘”                                                                                                                            |
| UPSTREAM_REDIRECT / OpenList API redirect refused           | failed            | 目标（或源）OpenList 的 API 请求被重定向，常见于实例地址写成 http 而代理强制跳转 https，或缺少子路径 | 把实例地址改成最终地址；API、分片和上传请求从不跟随跳转                                                                                       |
| OPENLIST_ERROR / Multipart chunk retries exhausted          | failed            | 分片请求反复失败，例如反向代理以 413 拒绝请求体                                                      | 见下文“目标前的反向代理”                                                                                                                      |
| OPENLIST_ERROR / Multipart session failed                   | failed            | 目标 OpenList 报告上传会话失败，通常是驱动写入云端失败                                               | 查看目标 OpenList 日志；失败可在预算内以新的操作重试                                                                                          |
| OPENLIST_ERROR / Multipart completion outcome unknown       | unknown           | complete 的响应丢失或被截断，例如反向代理读取超时                                                    | 见下文“目标前的反向代理”；unknown 的处理见[取消、重启和 unknown 处理](cancel-restart-unknown.md)                                              |
| OPENLIST_ERROR / Multipart session disappeared              | unknown           | 心跳发现上传会话已不存在，例如目标 OpenList 重启                                                     | 同上                                                                                                                                          |
| OPENLIST_ERROR / Relay total deadline exceeded              | failed 或 unknown | 单个文件超过 `RELAY_TOTAL_TIMEOUT_SECONDS`                                                           | 见下文“低带宽”                                                                                                                                |
| OPENLIST_ERROR / OpenList application code 403              | failed            | 目标 OpenList 拒绝上传：账号没有写权限，或文件是被忽略的系统文件（如 `.DS_Store`、`Thumbs.db`）      | 检查账号权限；系统文件在任务的排除规则中排除 `.DS_Store`、`Thumbs.db`、`@eaDir`、`._*` 等，否则每次运行都会失败并阻断该 Target 的 mirror 删除 |

结果为 failed 的路径不会被隔离，在重试预算内可能以新的操作再次尝试；结果为 unknown 的路径会被隔离。

## 302 跳转与地址可达性

实例的“下载方式”默认是“直接下载”（`/d`）。OpenList 对很多云盘返回 302，把下载跳转到云端直链，本服务会跟随跳转，因此**跳转后的云端地址也必须能从本服务所在主机（或容器内）访问**。

- 跳转最多 5 次，只允许 http(s)，拒绝带用户名密码的地址和 https 降级为 http；跨源跳转时去掉 Authorization、Cookie 等头。
- 部分云盘的直链绑定了获取链接时的 UA 或 IP。OpenList 和本服务出口不同时，云端会返回 403。
- 直链不可达或被拒绝时，把源实例的下载方式改为“代理流式”（`/p`），由 OpenList 自己读取云端数据再转发。它要求该存储在 OpenList 中允许代理（例如开启存储的“Web 代理”），否则 OpenList 返回 403 `proxy not allowed`。代理流式会占用 OpenList 主机的带宽。
- 每一跳都必须在 `OPENLIST_API_TIMEOUT_MS`（默认 30 秒）内返回响应头；建立连接受 `OPENLIST_CONNECT_TIMEOUT_MS`（默认 10 秒）约束。

## sign

OpenList 开启签名后，`/d`、`/p` 链接必须带 `sign` 参数。本服务每次打开源文件前用 `fs/get` 取得当前 sign 并附在链接上，不写入数据库或日志；不向下载链接发送 OpenList API token。

- `/d` 或 `/p` 本身返回 401 时，本服务会重新列出源目录取一次新的 sign；此时源文件名称、类型或大小已变化则记 SOURCE_CHANGED。仍然 401 则记 Download HTTP 401。
- 跳转之后由云端返回的 401 不会触发重新取 sign 或账号登录，直接记失败。
- 源路径在 OpenList 中设置了路径密码时，任务端点的“路径密码”必须正确，否则读取源目录或文件会被 OpenList 拒绝。

## 长度不符

本服务要求下载响应为 200（续传时为 206），并且 `Content-Length` 存在时必须等于计划大小；最后一个分片只在源正常结束且累计字节恰好等于计划大小后才发送。多出或缺少任何字节都记 SIZE_MISMATCH；如已建立上传会话，则主动中止该会话。

常见原因：

- 源文件在同步过程中仍在写入；
- 驱动列出的大小与实际下载内容不符，例如使用转码地址的分享类驱动（见[驱动矩阵](../reference/driver-matrix.md)的说明列）；
- 源前的代理或网关返回了错误页、登录页而不是文件内容。

主动中止后目标端可能迟到清理被中止的写入，见[驱动兼容与云盘人工验证](driver-verification.md#relay-中止后的迟到清理)。

## Range 续传

同一次下载中途断开时，本服务保留已完整写入的块，从完整前缀的结束位置发送 `Range: bytes=N-`；源有强 ETag 时同时带 `If-Range`。

| 源的响应                            | 处理                          |
| ----------------------------------- | ----------------------------- |
| 206 且起点、总大小正确              | 继续                          |
| 200 且 ETag 未变（源忽略了 Range）  | 从头读取并丢弃已有的前 N 字节 |
| 200 且 ETag 已变化、416、总大小变化 | SOURCE_CHANGED，中止该文件    |

续传与首次连接共用 Run 快照中的尝试预算；未设置 Job 重试次数时来自 `RETRY_MAX_ATTEMPTS`（默认 3，含首次），设置后为 Job 重试次数加一。用尽记 Download retries exhausted。没有可靠 ETag 时只能按名称、类型和大小继续，同大小的源变化可能造成内容混合，这是已接受风险。

续传只在同一次运行、同一个文件内有效：本服务重启后不会继续旧的分片上传会话，下一次运行会重新下载整个文件。

## spool 磁盘

- spool 目录为 `SPOOL_DIR`，默认 `DATA_DIR/spool`（容器内为 `/data/spool`），权限 0700，必须属于运行服务的用户。启动时会清空本服务自己的 spool 子目录。spool 中是明文文件内容，备份时应排除。
- 可用预算 = 文件系统可用空间 − `SPOOL_RESERVE_BYTES`（默认 512 MiB，保证同卷的 SQLite 仍可写）− 已承诺未完成的写入。不需要为大文件准备同等大小的空间：已确认的块会立即释放。
- 空间紧张时下载会暂停，等待上传释放空间；这是正常背压，不报错。
- 上传会话建立后，如果即使释放本服务全部 spool 仍放不下一个分片，记 SPOOL_FULL（insufficient spool capacity）。实际写盘遇到 ENOSPC/EDQUOT 记 SPOOL_FULL，其他 I/O 错误记 SPOOL_IO_ERROR。
- 处理办法：释放磁盘空间；或把 `SPOOL_DIR` 放到独立的卷上，此时可以把 `SPOOL_RESERVE_BYTES` 设为 0。
- 目标 OpenList 自己也会占用磁盘：每个上传会话最多在其服务器上缓存 8 个分片，部分驱动还会把整个文件缓存到 OpenList 的临时目录。与 OpenList 同机部署时一并估算。

## 低带宽与并发限制

relay 的期限分别计时：

| 期限                             | 默认               | 计时范围                                                                           |
| -------------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `RELAY_IDLE_TIMEOUT_SECONDS`     | 60 秒              | 只在向源索取数据而没有字节到达时计时；spool 背压和限速等待不计入；超时后按续传处理 |
| `RELAY_TOTAL_TIMEOUT_SECONDS`    | 21600 秒（6 小时） | 单个文件的总期限，包括分片请求和 complete 等待                                     |
| 任务的“超时”（`timeoutSeconds`） | 86400 秒           | 整个 Run，从开始执行计时，不含排队；超出后 Run 以 RUN_TIMEOUT 取消                 |

例如 50 GiB 的文件以 2 MiB/s 上传约需 7.1 小时，会超过默认的单文件期限，需要同时调高 `RELAY_TOTAL_TIMEOUT_SECONDS` 和任务超时（两者上限都是 604800 秒）。源经常停顿超过 60 秒时，调高 `RELAY_IDLE_TIMEOUT_SECONDS`。

吞吐受以下名额限制（实例级在“实例”页修改，任务级在任务表单中修改）：

| 设置                              | 默认 | 作用                                                                      |
| --------------------------------- | ---- | ------------------------------------------------------------------------- |
| 实例“下载连接数”                  | 2    | 作为源时同时打开的下载连接数（含因背压暂停的连接）                        |
| 实例“上传会话数”                  | 2    | 作为目标时同时上传的文件数                                                |
| 实例“分片并发数”                  | 4    | 作为目标时同时进行的分片请求数；每个会话固定最多 2 个                     |
| 实例“API 并发数”“每秒 API 请求数” | 4、5 | init、status、abort、列目录、删除等控制请求；分片请求不占用               |
| `RELAY_DOWNLOAD_WORKERS`          | 4    | 全局同时写入 spool 的下载块数                                             |
| `RELAY_UPLOAD_WORKERS`            | 8    | 全局同时进行的分片请求数                                                  |
| 任务“中转带宽上限”                | 0    | 该任务所有 relay Target 的上传总速率（字节/秒），0 表示不限；下载不受此限 |

链路没有跑满时，可以逐步提高源的下载连接数和目标的上传会话数、分片并发数；大量小文件时，每个文件都要发出若干控制请求，提高“每秒 API 请求数”和“API 并发数”可能更有帮助。云端或 OpenList 频繁限流时则应降低。分片请求遇到 429（窗口已满）和 409（同一分片在途）属于正常流控，会短暂等待后重发，不消耗重试预算。

上传会话活跃期间（包括下载暂停和 complete 等待），本服务每 60 秒查询一次会话状态，防止 OpenList 分片会话 30 分钟的闲置过期。

## 目标前的反向代理

目标 OpenList 前有反向代理或 CDN 时，需要满足：

- **请求体大小**：允许至少一个分片大小的请求体。分片大小由目标 OpenList 的 `multipart_chunk_size` 设置决定（默认 10 MiB），操作详情中的“分片大小”显示实际值。CDN 有请求体上限时，应把该设置调到上限以下。被拒绝时（例如 nginx 返回 413），分片请求反复失败，最终记 Multipart chunk retries exhausted。
- **读取超时**：complete 请求要等驱动把文件写入云端后才返回，期间没有任何响应字节，可能持续很久。代理的读取超时必须长于这段时间，否则 complete 的响应被截断，该文件通常记为 unknown（Multipart completion outcome unknown）并隔离。低带宽下单个分片请求本身也可能持续较久。
- **不要重定向 API 请求**：API、分片和上传请求收到重定向一律失败（UPSTREAM_REDIRECT）。实例地址应直接写最终地址，带子路径的反代要写上子路径。

nginx 示例（数值按实际分片大小和文件规模调整）：

```nginx
location / {
    proxy_pass http://127.0.0.1:5244;
    client_max_body_size 32m;   # 不小于 OpenList 的分片大小（默认 10 MiB）
    proxy_read_timeout 6h;      # 覆盖 complete 等待驱动上传完成的时间
    proxy_send_timeout 6h;
}
```

控制请求遇到代理返回的非 2xx 错误页时，摘要为 `OpenList HTTP <状态码>`；返回 2xx 但不是 JSON 时记 UPSTREAM_PROTOCOL_ERROR。
