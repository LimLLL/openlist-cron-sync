用途：列出MVP依赖的OpenList HTTP契约及兼容性限制。

范围：OpenList v4公开API；只使用上游OpenList提供的端点。

# OpenList依赖表

## 兼容版本

源码核对基准：OpenList v4.2.6 系列源码（上游 main 分支 2026-09 快照，提交 5447ecb0）；行号可能随上游演进漂移。
最低支持 OpenList 4.2.5，即分片上传接口首次发布的版本（上游提交 cca773f0）。M1 额外只读核对了本地上游 HEAD `c7c63173149e5fa6c99e67b29f7a105a9ce7f2f7`：新增 verified-upload 路径不属于本服务 M1，已核对的普通五个 multipart 端点、登录、文件读取、copy/task 和挂载规则无不兼容契约变化；这不是实际镜像集成测试记录。
M1 集成测试记录（2026-10-19）：官方镜像 `openlistteam/openlist:latest`（digest `sha256:11b490123d57f88c84ecda46285e1921869cf511da3e5bb4062f183e7e1200b7`，OpenList v4.2.7，Commit 3b28270，linux/arm64，OrbStack），两个 Local storage 分别挂载在 /a 与 /b；`pnpm test:integration` 3/3 通过，覆盖静态 token 与非管理员 password 账号的连接测试、浏览及管理员完整挂载解析。另对该临时实例做过一次性写入核对：multipart init→chunk→status→complete、init→abort 与 0 字节 put 均按本表协议成功；尚未收到分片时快照的 `received` 为 `null`（Go nil 切片），客户端按空区间处理。
M3a/M3b 集成测试记录（2026-10-20）：继续使用上述 v4.2.7 实例（Local /a、/b），以及 `openlistteam/openlist:v4.2.5`（digest `sha256:3b9e56330ebf4aa40192e566bbbd79567591bb13c0ac252db02c41616cd75d1d`，Local /a）。`pnpm test:integration` 共 8/8 通过（含 Phase 5 复验）：保留 M1 三个只读用例，新增 L1、L2-relay、L3 双向及 L3 限速取消五个执行用例，验证新建、替换、0 字节 put、mirror 文件 extras 和空目录清理。每种拓扑包含 10 MiB+4097 字节模式数据，并读取最终内容核对；取消用例核对 Run cancelled、Operation unknown 和 session 已停止接收。仅使用测试自有 UUID 临时目录并清理，不创建或调整容器。该记录只认证 Local 的 relay/Put/Remove；该历史记录未覆盖server_copy；新增覆盖见下一条，真实云驱动仍未测。
M4–M6 集成测试记录（2026-10-20）：同一既有v4.2.7 Local /a、/b环境，完整`pnpm test:integration` 10/10通过。新增L1同storage及L2跨storage的server_copy替换验收均实际返回task（L1回退，未认证同步reflink分支），生产tracker跟踪到state2，本地结果落库后delete_some清理，info返回JSON404。每例核对1,052,673字节模式内容；测试自有UUID目录已清理。专项verbose复验2/2再次观察到相同分支。镜像身份沿用上文兼容记录，本次未重建或调整容器。
连接测试从 /api/public/settings 的 version 字段（形如 `v4.2.6 (Commit: …) - Frontend: …`）解析版本号，无法解析或低于 4.2.5 时失败。MVP 发布以 M8 实际集成测试所用的固定官方镜像版本（tag/digest）为准，并同时覆盖 4.2.5；运行时响应字段缺失报协议错误。

## 公共行为

管理API应用响应为HTTP200和{code:number,message:string,data:unknown}，成功code=200；仍处理反代真实HTTP错误。Authorization直接使用裸token，无Bearer。
文件路径相对账号base_path；/d、/p使用全局路径。文档中的POST是客户端固定方法，即使某handler允许Any，也不依赖其他方法。

| 方法/路径                                   | 请求                                                                           | 响应/必要字段                                                                                       | 使用                            |
| ------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------- |
| POST /api/auth/login/hash                   | {username,password:sha256静态hash}                                             | data.token                                                                                          | password认证                    |
| GET /api/me                                 | 裸Authorization                                                                | data.base_path,role,permission,username                                                             | 身份与权限                      |
| POST /api/fs/list                           | {path,password,page:1,per_page:0,refresh:boolean}                              | data.content[],total,write；content可null当空数组仅code200时                                        | 扫描/刷新                       |
| POST /api/fs/get                            | {path,password}                                                                | data.name,size,is_dir,modified,sign,raw_url,provider                                                | 诊断/能力信息；不作新鲜度证明   |
| POST /api/fs/mkdir                          | {path}                                                                         | code200；data可null                                                                                 | 递归创建父目录                  |
| POST /api/fs/copy                           | {src_dir,dst_dir,names:[name],overwrite:false,skip_existing:false,merge:false} | data.tasks[]或无tasks                                                                               | 同Instance文件复制              |
| POST /api/fs/remove                         | {dir,names:[name]}                                                             | code200；缺失可能也是成功                                                                           | 删除、空目录                    |
| PUT /api/fs/put                             | 空body，见上传头                                                               | code200且无task（As-Task:false）                                                                    | 仅0字节文件                     |
| POST /api/fs/multipart/init                 | 无body，见上传头                                                               | data为session快照：upload_id,state,attempt,chunk_size,total_chunks,received,received_bytes,frontier | relay创建；一执行就启动驱动写入 |
| PUT /api/fs/multipart/chunk                 | X-Upload-Id、X-Chunk-Index（从0开始），body为该chunk的字节                     | session快照；429窗口满、409同块在途、404 session不存在                                              | relay分片                       |
| POST /api/fs/multipart/complete             | X-Upload-Id                                                                    | 等待驱动结果；成功时state=completed，session随即移除                                                | relay完成                       |
| GET /api/fs/multipart/status?upload_id={id} | —                                                                              | session快照；404不存在                                                                              | 丢响应后核对、心跳              |
| POST /api/fs/multipart/abort                | X-Upload-Id                                                                    | code200；不等待驱动退出                                                                             | 主动中止                        |
| GET /api/public/settings                    | 无需认证                                                                       | data.version、multipart_enabled、multipart_chunk_size（MiB）                                        | 连接测试                        |
| POST /api/task/copy/info?tid={id}           | 无body，裸Authorization                                                        | data TaskInfo                                                                                       | server_copy按tid跟踪            |
| POST /api/task/copy/cancel?tid={id}         | 无body                                                                         | code200只代表取消请求                                                                               | 取消                            |
| POST /api/task/copy/delete_some             | JSON字符串数组[id]                                                             | data为id→错误消息map，空map才全部成功                                                               | 仅本服务已终态任务清理          |
| GET /api/admin/storage/list                 | query page=1,per_page=100                                                      | data.content[],total；storage.id,mount_path,driver,disabled,status                                  | 仅admin，完整挂载映射           |
| GET /d/{globalPath}?sign=...                | 不带API token，Accept-Encoding:identity                                        | 302或200，真实HTTP错误                                                                              | 默认下载                        |
| GET /p/{globalPath}?sign=...                | 同上                                                                           | 代理内容或配置的下载代理302；可能403                                                                | 强制代理选项                    |

password字段填该endpoint的路径密码（从runs.secret_snapshot_enc解密，无密码时为空字符串）。只有fs/list和fs/get接收路径密码；mkdir/copy/remove/put/multipart由/api/me权限位和meta write_users控制。子路径自己的meta密码不同时返回403，按扫描不完整处理，不当作缺失。
任务只来自server_copy的copy。若As-Task:false的0字节put返回非预期task，其形状为 `data.task: TaskInfo`（与 copy 的 `data.tasks[]` 不同），属于非符合协议的服务响应；执行器记unknown + UPSTREAM_PROTOCOL_ERROR并隔离，不保存tid、不跟踪上传task，也不按无副作用失败重传。
multipart session按创建它的用户校验所有权，只在内存中保存，OpenList重启即消失，闲置30分钟过期；本服务不用path+size形式的status接管会话。
绝不调用task.retry、delete运行任务、clear_*、fs/move、recursive_move、remove_empty_directory或目录copy。批量names只用单个名字以避免部分提交不知对应关系。

## List对象

Obj={name:string,size:int64,is_dir:boolean,modified:string,created:string,sign:string,hash_info:object|null,mount_details?:object}。
public/settings 的 data 是字符串映射：multipart_enabled 为 `"true"`/`"false"`，multipart_chunk_size 为正整数字符串（MiB），不按 JavaScript truthiness 转换。

本服务保留原name、is_dir、size，modified只用于尽力Last-Modified。hash_info/hashinfo不参与比较。sign用于下载，不持久化。mount_details只有容量等信息，不是storage id。list/get请求路径以“/@s”开头时OpenList改读分享命名空间（`server/handles/fsread.go`），写接口无此分支；处理见[路径规范](../design/filters-paths.md#路径规范)。
size<0转内部unknown；int64超过JS安全整数或不是整数时以INVALID_SIZE拒绝这次列表，不舍入，不把该条目悄悄丢掉。source根因此不可读按SOURCE_ROOT_UNAVAILABLE，其他目录按SCAN_INCOMPLETE处理。null content不代表任意失败均可视为空，必须同时检查code及视图风险。
per_page<1服务端取全部，但实际先物化整目录；page分页没有一致性token。source refresh权限为CanWrite且WriteContent或meta bypass。

## 账号与权限位

依据internal/model/user.go：role为0（普通用户）、1（guest）、2（admin），不能用role非零判断管理员。permission按从0开始的bit解释；本服务使用的位如下。

| bit | 能力                     | 用途                                                       |
| --- | ------------------------ | ---------------------------------------------------------- |
| 0   | CanSeeHides              | 可见性前提；缺失时警告可能漏项                             |
| 1   | CanAccessWithoutPassword | 路径密码检查；不等于绕过read_users                         |
| 3   | CanWriteContent          | mkdir、put、multipart init、refresh；还需CanWrite/meta条件 |
| 6   | CanCopy                  | 同实例copy；仍需源CanRead、目标CanWrite                    |
| 7   | CanRemove                | 删除、空目录清理；仍需CanWrite                             |

/api/me不能证明具体路径的meta权限；fs/list的write也不是用户全部操作权限。连接测试只报告所见位图和警告，不通过上传/删除探测权限。meta旁路只适用于源码规定的WriteContent等检查，不替代Copy/Remove位。

## 上传头

multipart init（size>0）与0字节put共用：

| Header        | 值                                                |
| ------------- | ------------------------------------------------- |
| Authorization | 目标裸token                                       |
| File-Path     | 账号相对目标完整路径，URL编码一次                 |
| Overwrite     | false；multipart init缺省按true处理，必须显式发送 |
| Content-Type  | 不发送，由OpenList按文件名推断                    |
| Last-Modified | 源modified的Unix毫秒；Go零值时间或≤0时省略        |

multipart init另发`X-File-Size`=精确字节数（必须>0），不发`X-Chunk-Size`，以响应中的chunk_size为准；Overwrite=false的存在性检查只在init时做一次。0字节put另发`Content-Length: 0`与`As-Task: false`。都不发送X-File-Md5/Sha1/Sha256。未知大小不上传。
chunk请求发`X-Upload-Id`、`X-Chunk-Index`和精确的Content-Length；chunk幂等，已接收的同号chunk会被吸收而不比较内容。

## tache v0.2.2状态

TaskInfo必要字段={id,name,state,status,progress,error,start_time,end_time,total_bytes}，时间可null。creator字段非必需。

| state数值 | 上游名称          | 本服务解释             |
| --------- | ----------------- | ---------------------- |
| 0         | StatePending      | 未终态                 |
| 1         | StateRunning      | 未终态                 |
| 2         | StateSucceeded    | 成功                   |
| 3         | StateCanceling    | 未终态                 |
| 4         | StateCanceled     | 已取消，注意部分文件   |
| 5         | StateErrored      | 未终态，将重试         |
| 6         | StateFailing      | 未终态，失败hook运行中 |
| 7         | StateFailed       | 失败，内部重试已耗尽   |
| 8         | StateWaitingRetry | 未终态                 |
| 9         | StateBeforeRetry  | 未终态                 |

数值依据[上游state.go](https://github.com/OpenListTeam/tache/blob/v0.2.2/state.go)。OpenList内部max_retry默认2，不由本服务修改；任务持久化默认关闭，重启可能丢tid。

## 错误与陷阱

| 响应/行为           | 本服务规则                                                           |
| ------------------- | -------------------------------------------------------------------- |
| login401/402/429    | 阻断/冷却，见client文档；不能普通指数无限登录                        |
| task JSON404        | 跟踪未决提交时unknown；终态记录清理时仅清除cleanup标志，不改历史结果 |
| fs/get/list JSON500 | 不是可靠not-found；用成功父列表观察                                  |
| fs/remove成功       | 可能缓存判缺失，需刷新确认                                           |
| fs/list成功         | 可能只有virtual目录、受hide/read_users过滤；不是完整性证明           |
| copy成功无task      | 按产品政策succeeded，包括后台受理驱动                                |
| copy有task          | 跟踪；目录父任务不等于子任务完成，因此不提交非空目录                 |
| overwrite=false     | 非原子检查，存在性读取也可能过期                                     |
| fs/get              | 无refresh，可能返回Temp源对象或负缓存                                |
| task清理code200     | 解析data中的逐id错误，不能只看外层                                   |

产品层面的取舍以[需求](../design/requirements.md)和[ADR](../README.md#决策记录)为准。
