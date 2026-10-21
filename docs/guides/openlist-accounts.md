用途：说明如何为本服务准备 OpenList 账号、理解 base_path 与挂载解析，并添加、测试和浏览实例。

范围：面向部署者的操作指南；协议细节以[OpenList集成](../design/openlist-integration.md)和[OpenList依赖表](../reference/openlist-api.md)为准。

# OpenList 账号与挂载配置

本服务通过 OpenList 的公开 API 读写文件，每个 OpenList 服务器在本服务中登记为一个**实例**。任务的源和目标都引用实例，所以账号权限、base_path 和挂载结构直接决定任务能做什么、哪些删除会被禁止。

## 选择认证方式

| 方式       | 填写                                   | 身份                               | 特点                                                                                                                                                    |
| ---------- | -------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token`    | OpenList 后台设置中的令牌（token）原文 | 固定为 OpenList 管理员             | 请求头直接携带令牌；OpenList 重启不影响；能读取完整挂载列表                                                                                             |
| `password` | 账号用户名与原始密码                   | 该账号本身，可以是管理员或普通用户 | 按 OpenList 的哈希登录接口登录，会话只保存在本服务内存中；会话失效时自动重新登录一次。开启了两步验证的账号无法登录（OpenList 返回 402，见下文阻断原因） |

- 凭据用 AES-256-GCM 加密保存，接口和控制台之后只显示“已保存”，不再回显原文。
- 两种方式都会在请求中传输凭据，OpenList 地址应使用 HTTPS 或可信内网。
- guest 身份不算连接成功。

## 账号需要的权限

OpenList 按账号的权限位（`permission`）和目录 meta 决定能否操作。本服务用到的权限如下，管理员账号默认全部具备：

| 用途                         | 需要的权限                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| 作为源（读取）               | 能列出并下载源目录；源目录设置了路径密码时，在任务中填写该密码                                  |
| 列表完整                     | bit 0 CanSeeHides（查看隐藏）。缺少时连接测试给出 `SUSPECT_VIEW` 警告，列表可能漏掉被隐藏的条目 |
| 作为 relay 目标（新建文件）  | bit 3 CanWriteContent（新建目录、上传），且目标路径的 meta `write_users` 没有排除该账号         |
| 替换和 mirror 删除           | bit 7 CanRemove（删除），同样受 meta `write_users` 约束                                         |
| 作为 server_copy 目标        | bit 6 CanCopy（复制），并能读取源、写入目标                                                     |
| 扫描时刷新（`refresh=true`） | bit 3 CanWriteContent 且未被 meta 排除，或该路径的 meta 允许写入；见下文[刷新](#刷新refresh)    |

- 连接测试只读取 `/api/me` 返回的权限位并给出警告，不会通过上传或删除来探测权限。`/api/me` 也无法证明某个具体路径的 meta 权限，所以权限不足通常要到运行时才表现为对应操作失败（403 不会被当作“文件不存在”）。
- 缺少 bit 0 时，源侧被隐藏的文件不会出现在列表里。对 mirror 目标而言，目标上与之同名的文件可能被当作多余文件删除，因此用于 mirror 的源账号应具备 bit 0。

## base_path 与路径

任务中的 `path` 都是**账号内路径**：以 `/` 开头，`/` 指账号的 base_path，而不是 OpenList 的全局根。

| 账号 base_path | 任务中填写的 path | 实际的 OpenList 全局路径 |
| -------------- | ----------------- | ------------------------ |
| `/`            | `/photos`         | `/photos`                |
| `/family`      | `/photos`         | `/family/photos`         |
| `/family`      | `/`               | `/family`                |

- 路径会被规范化：重复和末尾的 `/` 去掉。路径中不能有反斜杠、控制字符或单独的 `.`、`..` 段，最长 4096 字节（UTF-8）。
- 以 `/@s` 开头的路径（包括 `/@sync` 这类名字）保存时返回 400：OpenList 的列表接口会把这类路径当作分享命名空间读取，写接口却按账号路径处理，读和写会指向不同的对象。任务路径为 `/` 时，根下以 `@s` 开头的条目在源和每个目标上都固定排除并受保护。
- 目录设置了 OpenList 路径密码时，在任务的 `source.password` 或 `targets[].password` 中填写；不填表示没有密码。
- 连接测试成功后，实例记录账号的用户名与 base_path（`accountUsername`、`accountBasePath`）。同一 OpenList 地址登记成多个实例时，本服务先加上各自的 base_path 再检查任务路径是否重叠，见[建立任务](jobs-and-dry-run.md#路径规则)。

## 挂载解析：管理员与普通用户

OpenList 的一个目录下可能挂载着别的存储。本服务在删除前需要确认文件属于哪个存储、列表有没有因为嵌套挂载而不完整（判定规则见[可疑视图](../design/deletion.md#可疑视图)）。

| 账号                                 | 能力                                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 管理员（token 方式，或 role=2 账号） | 每次运行读取完整的存储列表，按挂载路径找到唯一的存储，识别嵌套挂载、`.balance` 负载均衡挂载和禁用存储。存储列表读取失败时，该实例记 `MOUNT_BOUNDARY_UNKNOWN`，涉及该实例的删除全部禁止 |
| 普通用户（role=0）                   | 读不到存储列表，连接测试给出 `MOUNT_BOUNDARY_UNKNOWN` 警告。同步仍可进行，但只能依靠列表条目上的挂载提示（`mount_details`）发现嵌套挂载，没有提示不能证明没有嵌套挂载                  |

使用普通用户账号时，你需要自己保证任务涉及的目录范围内**没有嵌套挂载、负载均衡挂载或别名**，并且位于同一个存储中。这是部署前提，本服务不会把这个警告当作“已验证”。用作 mirror 目标或需要替换文件时，建议使用管理员身份。

## 刷新（refresh）

OpenList 会缓存目录列表。任务的 `source.refresh` 和 `targets[].refresh`（默认 `false`）决定常规扫描时是否让 OpenList 先刷新缓存：

- 关闭时，列表可能来自 OpenList 缓存，绕过 OpenList 直接改动的文件可能要等缓存过期后才能被看到。
- 开启后每次扫描都会让 OpenList 重新读取底层存储，云盘的 API 调用会增加；刷新还要求上表中的写入权限，源账号只读时不要开启源刷新，否则列目录会失败。
- 这两个开关只影响常规扫描。删除前的复查、删除确认和写操作出错后的观察总是强制刷新，不受开关控制。server_copy 替换旧文件前还会刷新源的父目录，同样需要写入权限。
- 浏览目录时也可以选择刷新（接口字段 `refresh`），只影响这一次浏览。

## 添加、测试与浏览实例

### 在 Web 控制台中

1. 打开“实例”页，点击“新建实例”，填写名称、地址、认证方式（令牌或密码）和凭据。下载方式与资源配额可以留空使用默认值。保存时不会访问 OpenList。
2. 进入实例详情页，点击“测试连接”。成功后页面显示账号、根路径（base_path）、角色、权限位、OpenList 版本和分片上传状态。
3. 点击“浏览目录”确认能看到要同步的目录；对话框中可以输入路径密码，也可以刷新当前目录。

### 通过 API

所有接口位于 `/api/v1` 下，需要先登录取得 `accessToken`（首次登录须先修改管理员密码），再放在 `Authorization: Bearer` 头中：

```sh
BASE=http://localhost:3000/api/v1
TOKEN=...   # POST $BASE/auth/login 返回的 accessToken

# 新建实例（password 方式；token 方式写 {"mode":"token","secret":"..."}，不能带 username）
curl -X POST "$BASE/instances" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"家里 NAS","baseUrl":"https://openlist.example.com","auth":{"mode":"password","username":"sync","secret":"账号密码"}}'

# 连接测试：测试本身完成即返回 200，失败原因在响应的 error 字段中
curl -X POST "$BASE/instances/$INSTANCE_ID/test" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'

# 浏览账号根目录
curl -X POST "$BASE/instances/$INSTANCE_ID/browse" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"path":"/","refresh":false,"page":1,"pageSize":50}'
```

- `baseUrl` 必须是 http(s) 地址，可以带反向代理子路径（如 `https://example.com/openlist`），不能含用户名密码、查询参数或片段。
- `downloadMode` 默认 `d`，relay 从 OpenList 的 `/d` 下载路由读取源文件（可能跳转到存储的直链）；`p` 改走 `/p`，由 OpenList 代理传输，需要 OpenList 允许该存储代理。
- `limits` 控制本服务对这台 OpenList 的压力，默认值见[配置](../reference/configuration.md)。有未结束的运行引用该实例时，`limits` 和 `downloadMode` 不能修改（409 `ENDPOINT_IN_USE`）。
- 浏览结果只返回名称、大小、类型和修改时间，不返回下载签名；名称非法的条目被排除并以 `INVALID_NAME` 警告提示。

### 读懂连接测试结果

响应包含 `reachable`（收到上游响应）、`authenticated`（确认非 guest 身份）、`account`、`warnings` 和 `error`：

| 码                             | 位置       | 含义与处理                                                                                               |
| ------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------- |
| `OPENLIST_VERSION_UNSUPPORTED` | `error`    | OpenList 版本低于 4.2.5 或无法解析，该实例不能用于任何任务。升级 OpenList 后重新测试                     |
| `MULTIPART_DISABLED`           | `warnings` | OpenList 关闭了分片上传。认证仍算成功，但该实例不能作为 relay 目标；在 OpenList 中开启分片上传后重新测试 |
| `MOUNT_BOUNDARY_UNKNOWN`       | `warnings` | 普通用户无法核实完整挂载，见[挂载解析](#挂载解析管理员与普通用户)                                        |
| `SUSPECT_VIEW`                 | `warnings` | 账号缺少 bit 0（查看隐藏），列表可能不完整                                                               |
| `AUTH_BLOCKED` 等认证错误      | `error`    | 实例已被阻止，见下一节                                                                                   |

任务要启用定时或手动运行（包括 dry-run），引用的每个实例都必须测试成功过且版本受支持，relay 目标还必须开启分片上传；未测试的实例只能先保存在停用的任务中。

## 认证被阻止时

实例的 `authState` 为 `untested`（未测试）、`ready`（就绪）或 `auth_blocked`（已阻止）。被阻止后，涉及该实例的请求立即失败（`AUTH_BLOCKED`），不会在每次定时运行时反复登录。`authBlockReason` 说明原因：

| 原因              | 常见情况                                                           | 处理                                                                                                      |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `LOGIN_401`       | 用户名或密码错误                                                   | 更新凭据                                                                                                  |
| `LOGIN_402`       | 账号开启了两步验证                                                 | 改用未开启两步验证的账号，或改用 token 方式                                                               |
| `LOGIN_429`       | OpenList 按 IP 累计登录失败后锁定                                  | 等待冷却（`OPENLIST_AUTH_COOLDOWN_SECONDS`，默认 600 秒）后再试；冷却期内手动重试返回 409 `AUTH_COOLDOWN` |
| `TOKEN_401`       | 静态令牌已在 OpenList 中重置                                       | 更新为新令牌                                                                                              |
| `GUEST`           | 凭据实际得到 guest 身份                                            | 检查凭据                                                                                                  |
| `MISSING_SECRET`  | 实例没有可用凭据                                                   | 补充凭据                                                                                                  |
| `ACCOUNT_CHANGED` | 实例仍有未处理的执行责任时，OpenList 返回的用户名或 base_path 变了 | 换回原账号的凭据，或先处理这些责任（例如结果未知的操作）                                                  |

- 恢复方式：更新凭据（修改认证会把实例重置为未测试），或在详情页点击“重试登录”（接口 `{"retryAuth":true}`）明确尝试一次。不会自动循环重试。
- OpenList 对同一 IP 连续登录失败会持续延长锁定，本服务无法保证冷却结束后一定解锁。

## 修改与归档实例

- `PATCH /api/v1/instances/:id` 只改提供的字段，`limits` 按字段合并，`auth` 整体替换；修改时不访问 OpenList。
- 修改 `auth` 或 `baseUrl` 后实例回到“未测试”，必须重新测试，引用它的任务才能再次运行。
- 实例仍有未处理的执行责任（例如结果未知的操作）时，修改地址、认证方式或用户名返回 409 `ENDPOINT_IN_USE`；同地址、同账号更新密码或令牌仍然允许。token 方式更换令牌时无法当场确认它属于哪个账号，下次连接测试或首次使用时若发现账号变了，实例会以 `ACCOUNT_CHANGED` 阻止。
- `DELETE /api/v1/instances/:id` 归档实例并清除凭据。仍被未归档任务引用或仍有未处理责任时返回 409 `ENDPOINT_IN_USE`，需先归档或修改这些任务。
