用途：用通俗语言介绍 openlist-cron-sync 做什么、不做什么和核心概念，并走查一次完整运行。

范围：面向初次阅读者的入门说明；不定义新规则，所有规则以文中链接的规范文档为准。

# 概览

## 这个服务做什么

openlist-cron-sync 是一个自托管的后端服务。它通过 [OpenList](https://github.com/OpenListTeam/OpenList) 的 HTTP API，把一个 OpenList 目录（source）中的文件按计划同步到一个或多个目标目录（Target）。目标可以与 source 在同一个 OpenList 实例上，也可以在另一个实例上。

- 按 cron 或手动触发一次运行（Run）。每次 Run 比较 source 与每个 Target：新建目标缺失的文件，替换大小发生变化的文件；mirror 模式还会删除目标上多余的文件。见[同步引擎](sync-engine.md)。
- 新建文件默认由本服务下载上传（relay）：下载 worker 把源文件分块写入本地缓冲，上传 worker 同时用目标 OpenList 的分片上传接口写入，两边互不等待。同实例的 Target 也可以显式改选 server_copy，由 OpenList 在同一实例内自己复制。见[创建方式](sync-engine.md#创建方式)与[Relay](relay.md)。
- 删除一律调用 OpenList 的 remove。
- 执行前有固定的安全检查：dry-run 预览、删除数量/比例阈值、扫描不完整时禁止删除、结果不明时隔离相关路径。见[删除保护](deletion.md)。
- 管理面是 REST API 加 OpenAPI 文档，单管理员登录，支持 Webhook 通知、脱敏配置导入导出和 Docker 部署。见[REST API](../reference/rest-api.md)。

## 这个服务不做什么

- 不修改 source：不写入、不创建、不改名、不移动、不删除 source 中的任何文件或目录；没有“同步后删除源文件”的 move 模式。见 [ADR 0009](../adr/0009-drop-move.md)。
- 不做双向同步。
- 只比较名称、类型和大小；不比较修改时间或内容 hash，也不在复制后校验内容。
- 替换不是原子的：删除旧文件与写入新文件之间，目标上会短暂缺少该文件；失败时不自动回滚，也不保存被删除的旧文件。
- 不保证远程操作恰好执行一次，不提供 source 的时间点快照。
- MVP 只交付 REST/OpenAPI，Web 前端在后端 MVP 完成后再实现。

完整的非目标、保证和已接受风险见[需求与保证](requirements.md)。

## 核心概念

| 概念                 | 含义                                                                                                                                                                     | 规范                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Instance             | 一个 OpenList 服务地址加一个账号凭据（用户名密码或 token）；本服务通过它调用 OpenList API。OpenList 最低 4.2.5                                                           | [配置表](configuration-tables.md#instances)           |
| Job                  | 一条同步配置：一个 source、一个或多个 Target、Job 级过滤规则、cron 与时区等                                                                                              | [配置表](configuration-tables.md#jobs)                |
| source               | Job 的来源端点，即（Instance，目录）；本服务只读                                                                                                                         | [需求](requirements.md#产品范围)                      |
| Target               | 目标端点（Instance，目录），并带有本目标自己的同步模式 mode、创建方式 createMode、删除阈值和 refresh 设置                                                                | [配置表](configuration-tables.md#job_targets)         |
| incremental / mirror | Target 的两种模式。incremental 新建缺失文件、替换大小变化的文件，保留目标上 source 没有的文件（extras）；mirror 在此基础上还会删除 extras                                | [行为矩阵](sync-engine.md#行为矩阵)                   |
| relay / server_copy  | Target 的两种创建方式，同一 Job 可以混合使用。relay（默认）由本服务下载再分片上传，适用于任意实例；server_copy 调用 OpenList copy，只适用于同一实例                      | [创建方式](sync-engine.md#创建方式)                   |
| Run                  | Job 的一次执行。创建时固定配置快照，之后编辑 Job 不影响它；状态从 queued 经 scanning、planned、executing 到终态（succeeded、partial、failed、cancelled、interrupted）    | [RunStatus](state-machines.md#run-status)             |
| Operation            | Run 中针对一个目标路径的一次远程动作（mkdir、create、delete）及其结果；重试会创建新的 Operation，旧记录不改写                                                            | [OperationStatus](state-machines.md#operation-status) |
| dry-run              | 只扫描、规划和做安全检查，不写任何远程文件的 Run；用来预览计划和被阻止的原因                                                                                             | [同步引擎](sync-engine.md)                            |
| unknown              | Operation 的一种终态：请求可能已到达 OpenList，但本服务无法确定它是否生效（例如超时或响应丢失）。unknown 记录永远不会改写为成功                                          | [OperationStatus](state-machines.md#operation-status) |
| quarantine（隔离）   | 对 unknown 涉及路径的写入隔离。到期（默认期限见[配置](../reference/configuration.md)）或管理员提前释放之前，后续 Run 不写这些路径；之后先 refresh 重新观察，再决定怎么做 | [Unknown 隔离](scheduling-recovery.md#unknown隔离)    |

## 一次运行走查

下面用一个具体例子走一遍 Run 的全过程。例子只覆盖正常路径，最后一节列出常见异常的去向。

### 示例配置

Job “照片备份”的 cron 为 `0 3 * * *`，时区 UTC；各 Target 的创建方式均为默认的 relay；没有过滤规则，syncEmptyDirs 使用默认值 false。

| 端点     | Instance | 目录                  | 设置             |
| -------- | -------- | --------------------- | ---------------- |
| source   | A        | `/115/照片`           | —                |
| Target 1 | A        | `/阿里云盘/备份/照片` | mode=mirror      |
| Target 2 | B        | `/local/nas/照片`     | mode=incremental |

运行前各端的内容（其余 118 个文件三端同名同大小）：

| 相对路径       | source | Target 1 | Target 2 |
| -------------- | ------ | -------- | -------- |
| `2024/a.jpg`   | 3 MiB  | 缺失     | 缺失     |
| `2024/b.jpg`   | 5 MiB  | 4 MiB    | 4 MiB    |
| `2022/old.jpg` | 缺失   | 2 MiB    | 2 MiB    |

### 1. 触发与排队

UTC 03:00，cron 触发（手动触发等价于调用 `POST /jobs/:id/runs`）。服务创建一个 queued 状态的 Run，并固定当时的 Job、Instance 配置。同一个 Job 已有未结束的 Run 时，不会再创建新 Run。

Run 在全局队列中等待一个执行位，并占用路径：source 目录按只读占用，两个 Target 目录按写占用。拿到资源后进入 scanning。见[触发和队列](scheduling-recovery.md#触发和队列)与[资源层级](scheduling-recovery.md#资源层级)。

### 2. 扫描与规划

服务先列出 source 根目录；若失败，Run 直接 failed，不执行任何动作。接着列出每个 Target 的根目录：如果能确认根目录不存在（例如第一次同步到新目录），dry-run 会报告 TARGET_ROOT_WILL_BE_CREATED，实跑会先 mkdir 创建它；如果无法判断，该 Target 本次不做任何写入，Run 记为 partial。本例中两个根目录都存在。

然后逐个目录比较：先列 source 的一个目录，再列各 Target 中对应的目录，按名称、类型和大小比较。Target 未开启 refresh 时，列表可能来自 OpenList 缓存。比较结果如下：

| 相对路径       | Target 1（mirror）               | Target 2（incremental）           |
| -------------- | -------------------------------- | --------------------------------- |
| `2024/a.jpg`   | create                           | create                            |
| `2024/b.jpg`   | 替换：delete → create            | 替换：delete → create             |
| `2022/old.jpg` | extra，计划在创建阶段之后 delete | 保留（incremental 不删除 extras） |
| 其余 118 个    | unchanged（不生成 Operation）    | unchanged                         |

计划分批写入 SQLite，全部写完后 Run 进入 planned。在此之前，本服务不写任何远程文件。见[同步引擎](sync-engine.md)与[行为矩阵](sync-engine.md#行为矩阵)。

### 3. 安全检查

服务对每个 Target 检查[删除保护](deletion.md)：扫描是否完整、是否有受保护或冲突的路径、是否有隔离中的路径，以及删除数量是否超过阈值。

- Target 1：计划删除 R = 1 个替换 + 1 个 extra = 2；受管理的目标文件 D = 118 + b.jpg + old.jpg = 120。远低于默认阈值，通过。
- Target 2：只有 1 个替换，通过。

如果某个 Target 超过阈值，它的所有 delete 及依赖这些 delete 的 create 都会跳过（DELETE_LIMIT），纯新建照常执行，Run 记为 partial；不会先删除到上限再停下。手动 Run 可以设置 confirmDeletes=true，它只解除数量/比例限制。见[文件阈值](deletion.md#文件阈值)。

如果这是 dry-run，Run 到这里结束（succeeded，或在有保护原因时为 partial），计划中的 Operation 保持 pending 作为预览，不发送 Webhook。

### 4. 执行

执行顺序是：先准备父目录，再按 Target 执行 create 和替换链，最后执行 mirror extras。一个 Target 失败不会取消其他 Target。见[同步引擎](sync-engine.md)。

- `a.jpg`（两个 Target 各一次）：每个文件先取得 Job 源配额和对应 Target 文件配额，并在打开实例 A 的下载路由前预留首个 spool 块。读取按 1 MiB 块写入本地 spool，FIFO/frontier 优先级驱动上传；目标先调用分片上传 init，再按返回的分片大小并行发送不超过 Target chunkConcurrency 的 chunk，确认后删掉本地块。源读完且字节数恰好等于 3 MiB 后才发出最后一个 chunk，然后调用 complete，返回成功即记 succeeded。Target 1 虽然与 source 同在实例 A，也同样下载再上传。
- `b.jpg` 走[替换链](sync-engine.md#替换链)：
  1. 先打开源下载并写入第一块，确认源能正常出数据；源不可用就不动旧文件。
  2. 用 refresh=true 重新列出目标的 `2024` 目录，确认 b.jpg 仍是 4 MiB；若已变化则跳过这次替换（PRECONDITION_CHANGED）。
  3. 调用 `/api/fs/remove` 删除旧 b.jpg，再 refresh=true 确认它已不在原位置。
  4. 按上面同样的分片流程写入新的 b.jpg。
- `old.jpg`：Target 2 是 incremental，保留不动。

**Target 1 的 mirror extras**

只有当 Target 1 的全部 create 和替换都成功、且没有异常的跳过、失败或 unknown 时，才执行 extras：删除 `2022/old.jpg`。

假设 source 中已经没有 `2022/` 目录。因为 syncEmptyDirs=false，变空的 `2022/` 会留在 Target 1 上；若为 true，它作为目标独有的目录，会在 refresh 确认为空后被删除。见[空目录](filters-paths.md#空目录)。

### 5. 用户看到什么

Run 最终为 succeeded：所有必要动作都成功或 unchanged，且没有保护问题。`GET /runs/:id` 返回 Run 及每个 Target 的统计，`GET /runs/:id/operations` 按计划顺序列出每个 Operation。主要统计如下（定义见 [API schemas](../reference/api-schemas.md#stats)）：

| 字段                | 值     | 说明                                |
| ------------------- | ------ | ----------------------------------- |
| plannedCreates      | 4      | 两个 Target 各有 a.jpg、b.jpg       |
| plannedReplacements | 2      | 两个 Target 的 b.jpg                |
| plannedExtraDeletes | 1      | Target 1 的 old.jpg                 |
| succeededCreates    | 4      |                                     |
| deletedForReplace   | 2      |                                     |
| deletedAsExtra      | 1      |                                     |
| unchangedFiles      | 236    | 118 个文件 × 2 个 Target            |
| downloadedBytes     | 16 MiB | 每个 Target 各自下载 a.jpg 与 b.jpg |
| transferredBytes    | 16 MiB | 上传字节；chunk 重传也计入          |

如果 Job 关联了已启用、且订阅 run.succeeded 的 Webhook 渠道，服务会发送一个带 HMAC 签名的 POST，summary 中 succeededCreates=4、deletedForReplace=2、deletedAsExtra=1、failedOperations=0、unknownOperations=0。投递是有界 best-effort：可能重复，失败也不改变 Run 状态。见[通知](observability-notifications.md)。

## 出问题时会怎样

| 情况                                     | 结果                                                                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧 b.jpg 已删除，但新版本 create 失败    | 目标暂时缺少 b.jpg；该 Target 本次不执行 extras；Run 为 partial。下一次 Run 发现缺失会重新创建                                                                                |
| 请求超时或响应丢失                       | Operation 记为 unknown，相关路径隔离，依赖它的 create 不执行；Run 为 partial（本例还有其他成功或 unchanged 的文件）。到期或管理员释放后，下一次 Run 先 refresh 重新观察再决定 |
| 下载中途断开                             | 从已写好的最后一块用 Range 接着下载，不用中止上传；源大小变了则中止该文件并记失败                                                                                             |
| 本地磁盘快满                             | 下载暂停，等上传释放空间；只有真实写盘失败才报错                                                                                                                              |
| OpenList 执行前明确拒绝（如 403 无权限） | Operation 记为 failed，不当作文件缺失                                                                                                                                         |
| OpenList 已处理但返回错误                | 做一次有界的 refresh 观察：已生效记成功；原状态未变记可重试的失败；无法判断记 unknown 并隔离                                                                                  |
| 某个 Target 扫描不完整                   | 该 Target 的所有删除（含替换）都被禁止，已确认的新建仍可执行；Run 为 partial                                                                                                  |
| 服务重启或收到 SIGTERM                   | 不续跑旧计划、不续传；重启后有界收尾已知的上传会话和 task，Run 记为 interrupted（stopReason=PROCESS_RESTART）；下一次 cron 或手动 Run 重新扫描                                |
| 用户取消                                 | 停止派发，中止上传会话、对已知 task 请求取消，宽限期内仍未确认结果的动作记 unknown；Run 为 cancelled                                                                          |

各情况的完整规则见[状态机](state-machines.md)、[调度与恢复](scheduling-recovery.md)和[时序](sequences.md)。
