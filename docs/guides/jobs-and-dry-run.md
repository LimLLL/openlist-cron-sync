用途：说明如何配置同步任务、运行 dry-run 预览并读懂结果，再执行第一次真实运行。

范围：面向管理员的操作指南；字段与规则以[API schemas](../reference/api-schemas.md)、[同步引擎](../design/sync-engine.md)、[路径与过滤](../design/filters-paths.md)和[删除保护](../design/deletion.md)为准。

# 建立任务与 dry-run 解读

一个**任务**（Job）把一个源目录同步到 1–32 个目标目录。源永远不会被修改：不写入、不创建、不改名、不删除。

## 开始之前

- 源和目标用到的实例都已[测试连接](openlist-accounts.md#添加测试与浏览实例)成功，版本不低于 4.2.5。
- 使用 relay 的目标实例开启了 OpenList 分片上传。
- 未测试的实例可以先保存在停用的任务中，但启用定时、手动运行和 dry-run 时都会检查，不满足时返回 400 `VALIDATION_ERROR`。

## 任务配置

在 Web 控制台的“任务”页点击“新建任务”填写；也可以调用 `POST /api/v1/jobs`：

```json
{
  "name": "照片备份",
  "source": { "instanceId": "<源实例ID>", "path": "/photos" },
  "targets": [
    {
      "instanceId": "<目标实例ID>",
      "path": "/backup/photos",
      "mode": "mirror",
      "createMode": "relay",
      "deleteLimits": { "maxCount": 200, "maxPercent": 20 }
    }
  ],
  "cron": "0 3 * * *",
  "timezone": "Asia/Shanghai",
  "filters": { "exclude": ["**/@eaDir/", "**/*.tmp"] }
}
```

| 字段                             | 默认                      | 说明                                                                                                            |
| -------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `source` / `targets[]` 的 `path` | 必填                      | 账号内路径，`/` 指账号 base_path，见[base_path 与路径](openlist-accounts.md#base_path-与路径)                   |
| `password`                       | 无                        | OpenList 路径密码；修改任务时省略表示保留，`null` 清除，空字符串返回 400                                        |
| `refresh`                        | `false`                   | 常规扫描时是否让 OpenList 刷新缓存，见[刷新](openlist-accounts.md#刷新refresh)                                  |
| `targets[].mode`                 | `incremental`             | `incremental` 或 `mirror`，见[目标模式](#目标模式)                                                              |
| `targets[].createMode`           | `relay`                   | `relay` 或 `server_copy`，见[创建方式](#创建方式)                                                               |
| `targets[].deleteLimits`         | 见[阈值](#删除保护与阈值) | 本目标的删除数量与比例阈值                                                                                      |
| `enabled`                        | `false`                   | 是否按 cron 自动运行；新建任务默认不自动运行                                                                    |
| `cron` / `timezone`              | `null` / `UTC`            | 见[定时](#定时)                                                                                                 |
| `filters`                        | 全部文件                  | 见[过滤](#过滤)                                                                                                 |
| `syncEmptyDirs`                  | `false`                   | 见[空目录](#空目录)                                                                                             |
| `allowEmptySource`               | `false`                   | 源确认为空时是否仍允许删除，见[阈值](#删除保护与阈值)                                                           |
| `sourceDownloadConcurrency`      | `2`                       | Job 所有 Target 共享的下载中文件数，下载完即释放；0 表示不限                                                    |
| `sourceScanIntervalSeconds`      | `0`                       | 源树扫描请求的最小开始间隔，0–3600 整数秒；0 不增加间隔                                                         |
| `targets[].concurrentFiles`      | `2`                       | relay 在途文件数（含上传和等待 complete）或 server-copy 未终态任务数；也约束建目录和多余文件 delete；0 表示不限 |
| `targets[].scanIntervalSeconds`  | `0`                       | 目标目录扫描、mkdir 和 remove 的最小开始间隔，0–3600 整数秒；单项观察不受间隔约束                               |
| `targets[].chunkConcurrency`     | `2`                       | 单个 relay 文件的并行 chunk 请求数；范围 1–8                                                                    |
| `relayBandwidthLimit`            | `0`                       | 本任务所有 relay 目标共用的上传上限（字节/秒），0 表示不限                                                      |
| `retryCount`                     | `null`                    | 失败后的重试次数，0–9；留空继承环境 `RETRY_MAX_ATTEMPTS`，Run 接受时冻结有效尝试数                              |
| `timeoutSeconds`                 | `86400`                   | 60–604800；从开始扫描算起（不含排队），超时后运行以 `RUN_TIMEOUT` 取消                                          |

- 修改任务（`PATCH /api/v1/jobs/:id`）时，`filters` 和已有目标的字段按字段合并；`targets` 数组决定完整的目标集合：已有目标带 `id` 修改，新目标不带 `id`，数组中去掉的目标被归档。
- 任务有未结束的运行时，修改配置返回 409 `JOB_BUSY`；启用和停用定时不受此限制。已开始的运行始终按接受时的配置快照执行。
- `retryCount` 的值分别用于 Run 内的外层文件、chunk、下载、读取、完成和 task-info 重试循环；这些循环各自计数，可能产生乘积效果。退避基数和上限仍由全局环境配置决定。
- 并发配额在 Run 接受时冻结；不同 Job 同时运行时各自额度相加。把 server-copy 的 `concurrentFiles` 设为 0 会持续提交所有待复制的任务，可能使 OpenList 任务队列和驱动承压。

扫描间隔在 Run 接受时冻结；创建省略为 0，PATCH 省略保留，显式 0 清除。同一 Instance ID 与拼接账号根路径后的全局路径首段共享上次开始时间，按调用方间隔 FIFO 派发，详见[扫描间隔](../design/scheduling-recovery.md#扫描间隔)。

### 路径规则

- 同一实例上，源和每个目标、目标彼此之间都不能相同或互相包含（`/a` 不包含 `/ab`）；不同实例使用同一 OpenList 地址时，先加上各自的 base_path 再比较。重叠时返回 409 `PATH_OVERLAP`。
- 目标根目录不存在、而其父目录可以正常列出时，dry-run 报告 `TARGET_ROOT_WILL_BE_CREATED`，真实运行会先创建它。父目录也读不出来时记 `TARGET_ROOT_UNAVAILABLE`，该目标本轮不新建也不删除。
- 不同任务的路径如果互相涉及，它们的运行不会同时执行，后到的运行排队等待。

## 目标模式

比较只看文件的名称、类型和大小，不比较内容或修改时间。

| 情况                             | `incremental` | `mirror`   |
| -------------------------------- | ------------- | ---------- |
| 目标缺少该文件                   | 新建          | 新建       |
| 同名同大小                       | 不变          | 不变       |
| 同名但大小不同                   | 替换          | 替换       |
| 目标有、源没有的文件（多余文件） | 保留          | 删除       |
| 同名但一边是文件一边是目录       | 跳过并保护    | 跳过并保护 |

- **替换**是先删除旧文件、确认消失后再新建。本服务不保留旧文件；新建失败时目标暂时缺少这个文件，下一次运行会重新创建。
- 大小相同但内容不同的变化无法发现。
- mirror 只在该目标的新建和替换阶段全部成功后，才删除多余文件。

## 创建方式

| 方式            | 新建文件的做法                                                               | 限制                                                                     |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `relay`（默认） | 本服务从源下载，经本地 spool 用目标 OpenList 的分片上传写入                  | 任意实例组合都可用；目标实例必须开启分片上传                             |
| `server_copy`   | 调用 OpenList 自带的复制；同存储由驱动复制，跨存储由 OpenList 的后台任务完成 | 该目标必须与源使用**同一个实例**（同一实例 ID，同 URL 的另一个实例不算） |

- 不满足 `server_copy` 条件时，保存返回 400，错误指向 `targets[i].createMode`；不会自动改用 relay。
- `server_copy` 以 OpenList 报告成功为准。部分云盘驱动只是“受理”复制就返回成功，后台失败本服务看不到，见 [ADR 0005](../adr/0005-openlist-success.md) 和[驱动兼容性](../reference/driver-compatibility.md)。
- 删除在两种方式下都是逐个文件调用 OpenList 的删除接口。

## 过滤

过滤对源和所有目标同样生效，规则对相对于任务根的路径匹配（不带前导 `/`），区分大小写，`*` 不跨目录层级，以 `.` 开头的名字同样参与匹配。

- `include` 为空表示全部文件；否则文件只要匹配任意一条即纳入。`include` 只筛选文件，不影响目录的遍历和创建。
- `exclude` 优先于 `include`，同时对文件和目录生效。匹配到目录时整棵子树被跳过并受保护：不列举、不新建、不删除。
- 以 `/` 结尾的 `exclude` 只匹配目录，并且锚定在任务根：`cache/` 只排除根下的 `cache` 目录，任意深度要写 `**/cache/`。
- `*.log` 只匹配根下的文件；任意深度写 `**/*.log`。
- 不支持以 `!` 开头的反选规则，保存时返回 400。每个列表最多 100 条。
- `minSizeBytes` / `maxSizeBytes` 都包含边界。设置了大小条件时，大小未知的文件不能判断，记 `UNKNOWN_SIZE` 并跳过。
- 被过滤掉的源文件，目标上的同名文件也受保护，不会被当作多余文件删除。

## 空目录

| `syncEmptyDirs` | 新建                                       | 清理                                                                                                |
| --------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `false`（默认） | 只为需要新建的文件创建父目录               | 从不删除目标目录；多余文件删除后可能留下空目录                                                      |
| `true`          | 每个未排除、未受保护的源目录都在目标上创建 | 仅 mirror：源中不存在的目标目录，在其中的多余文件删除后，逐个确认为空再自底向上删除；任务根始终保留 |

## 定时

- `cron` 是五段式分钟级表达式（不支持秒字段或 `@reboot`），按 `timezone`（IANA 时区，例如 `Asia/Shanghai`）解析；`null` 表示只手动运行。夏令时按所用 cron 库的规则处理。
- 定时只在任务启用后生效：`POST /api/v1/jobs/:id/enable` / `disable`（请求体 `{}`），控制台任务详情页的“启用定时”/“停用定时”。启用时会再次检查实例和表达式。
- `GET /api/v1/jobs/:id/next-fire-times?count=5`（1–20）返回接下来的触发时间（UTC）。
- 停用的任务仍可手动运行。归档任务（`DELETE /api/v1/jobs/:id`）后不能再触发，运行记录保留。
- 到点时该任务还有未结束的运行，或运行队列已满，这次定时直接跳过，不会排队补跑；服务重启期间错过的定时也不补跑。

## 删除保护与阈值

替换旧文件和删除多余文件都算删除，都受下面的保护。

### 数量与比例阈值

每个目标独立计算：

- `D`：该目标上本服务管理的文件数，即来自完整、非可疑列表、大小已知、未受保护的文件，并且与通过过滤的源文件同名，或自身通过过滤的目标独有文件。
- `R`：计划替换数 + 计划删除的多余文件数。目录不计入 `D` 和 `R`。
- `R > maxCount` 或 `R / D > maxPercent%` 时超限；等于上限允许。例如 `D=10`、`maxPercent=50` 时，`R=5` 允许，`R=6` 拒绝。

| 设置                   | 默认   | 说明                                                    |
| ---------------------- | ------ | ------------------------------------------------------- |
| `deleteLimits.enabled` | `true` | `false` 时不检查数量和比例，其他保护仍然有效            |
| `maxCount`             | `1000` | `null` 只关闭这一项；`0` 表示禁止任何文件删除           |
| `maxPercent`           | `50`   | 0–100；`null` 只关闭这一项；启用时两项不能同时为 `null` |

超限时，该目标**全部**删除及依赖它们的新建（替换）以 `DELETE_LIMIT` 跳过，纯新建照常执行，运行结果为 `partial`。不会先删到上限再停。

确认需要这次大规模删除时，在触发运行时设置 `confirmDeletes: true`（控制台“确认删除”）：只对这一次运行跳过数量和比例检查，不修改任务配置，也不解除下面任何其他保护。

### 其他保护

以下情况由扫描结果决定，`confirmDeletes` 不能跳过：

- 源有任何子目录读取不完整（包括超过最大扫描深度）：所有目标的删除都禁止，包括替换。
- 某个目标扫描不完整或根目录不可用：该目标的删除禁止。
- 列表可疑（嵌套挂载等）或管理员挂载列表不可用：相关范围禁止删除，见[挂载解析](openlist-accounts.md#挂载解析管理员与普通用户)。
- 源完整扫描后为空且 `allowEmptySource=false`：所有删除禁止（`EMPTY_SOURCE`）。只有确实要清空目标时才开启 `allowEmptySource`；它不能放行读取失败或可疑列表。
- 名称碰撞、类型冲突、大小未知、被过滤的条目及其路径受保护。
- 历史 unknown 不参与本轮规划；本轮未知的父目录创建或替换删除仍阻止依赖动作。

## 运行 dry-run

dry-run 只扫描和生成计划，不新建目录、不传输、不删除。

- 控制台：任务详情页点击“立即运行”，选择“预览运行”。
- API：

```sh
curl -X POST "$BASE/jobs/$JOB_ID/runs" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"dryRun":true}'
```

返回 202 和 `queued` 状态的运行，`Location` 头为 `/api/v1/runs/:id`。202 只表示已接受；之后轮询 `GET /api/v1/runs/:id`（建议每 3 秒）直到进入终态。同一任务已有未结束的运行时返回 409 `JOB_BUSY`；队列已满返回 503 `QUEUE_FULL`。

## 解读结果

### 运行状态

| 状态        | dry-run 中的含义                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `succeeded` | 扫描完整，没有降级类问题；计划就是真实运行将要做的改动                                                    |
| `partial`   | 有保护、冲突或子树读取失败，部分改动会被跳过，需查看原因                                                  |
| `failed`    | 源根目录读不出来（`SOURCE_ROOT_UNAVAILABLE`）或扫描超出资源上限（`RESOURCE_LIMIT`），没有生成可执行的计划 |

### 每个目标

`GET /api/v1/runs/:id` 的 `targets[]`（控制台运行详情的“目标”区域）给出每个目标的扫描覆盖与删除预算：

| 字段                                               | 含义                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `sourceComplete` / `targetComplete`                | 源、目标是否完整扫描                                                                                                   |
| `suspect`                                          | 是否有可疑列表                                                                                                         |
| `observedTargetFileCount`                          | 目标现有文件数                                                                                                         |
| `plannedReplaceCount` / `plannedExtraCount`        | 计划替换数、计划删除的多余文件数（即 `R` 的两部分）                                                                    |
| `deleteBudgetCount`                                | 本目标可删除的文件数；扫描保护阻断时为 `0`；`null` 表示不限数量（阈值关闭或本次 `confirmDeletes`），不等于不受其他保护 |
| `deleteBlocked` / `extrasBlocked` / `blockReasons` | 删除是否被阻断，以及阻断原因码                                                                                         |

`stats` 中的计划计数：`plannedCreates`（含替换所需的新建）、`plannedReplacements`、`plannedExtraDeletes`、`plannedDirectoryDeletes`、`plannedBytes`，以及 `unchangedFiles`、`filteredFiles`、`protectedFiles`。dry-run 的执行类计数和传输字节恒为 0。

### 计划的操作

`GET /api/v1/runs/:id/operations`（控制台“操作”标签页）按计划顺序列出每个动作：

- `action` / `method`：`mkdir`，`create`（`relay` 或 `server_copy`），`delete`（`remove`）。
- `reason`：`prepare`（目标根目录）、`new`（新建）、`replace`（替换）、`extra`（多余文件或目录）。
- dry-run 中 `status` 为 `pending`（真实运行会执行）或 `skipped`。跳过的原因在 `error.code`，常见的有 `DELETE_LIMIT`（超出阈值）、`DELETE_BLOCKED`（扫描保护，具体原因见该目标的 `blockReasons` 和扫描问题）。

### 扫描问题

`GET /api/v1/runs/:id/issues`（“扫描问题”标签页）列出扫描中发现的问题，`protectSubtree=true` 表示该路径下整棵子树受保护：

| 码                                        | 含义与处理                                                            |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `SCAN_INCOMPLETE`                         | 目录读取失败或权限不足；检查账号权限、路径密码或 OpenList 存储状态    |
| `SCAN_DEPTH_EXCEEDED`                     | 目录层级超过上限，子树不再下探并受保护                                |
| `SUSPECT_VIEW` / `MOUNT_BOUNDARY_UNKNOWN` | 列表可疑或挂载边界无法确认，相关范围禁止删除                          |
| `EMPTY_SOURCE`                            | 源为空且未允许空源，删除全部禁止                                      |
| `NAME_COLLISION`                          | 名称仅大小写或 Unicode 形式不同，相关名称受保护；需要在源或目标上改名 |
| `TYPE_CONFLICT`                           | 同名但文件与目录类型不同，不会自动删除挡路的对象，需要手动处理        |
| `INVALID_NAME`                            | 名称含 `/`、`\` 等，不处理该条目并保护所在目录                        |
| `UNKNOWN_SIZE` / `TARGET_UNKNOWN_SIZE`    | 大小未知，不传输、不替换                                              |
| `TARGET_ROOT_WILL_BE_CREATED`             | 提示：真实运行会先创建目标根目录                                      |
| `TARGET_ROOT_UNAVAILABLE`                 | 目标根目录不可用，该目标本轮不新建也不删除                            |

完整的原因码及影响见[原因码分类](../design/state-machines.md#code-classification)和[固定原因码](../reference/rest-api.md#reason-codes)。

## 第一次真实运行

1. 对照 dry-run 确认计划符合预期，尤其是 mirror 目标的 `plannedExtraCount` 和替换数量。
2. 触发真实运行：控制台“立即运行”选择“真实运行”，或 `POST /api/v1/jobs/:id/runs` 传 `{"dryRun":false}`（默认值）。确认要越过阈值时再加 `"confirmDeletes":true`。
3. dry-run 不是可以批准执行的计划快照，真实运行会重新扫描；两次之间目录有变化时，实际改动会随之不同。
4. 需要停止时调用 `POST /api/v1/runs/:id/cancel`（请求体 `{}`），或在运行详情页点击“取消运行”。已提交的动作会在宽限期内收尾，结果无法确认的操作记为 `unknown`，后续 Run 按自己的扫描规划。
5. 结果为 `succeeded` 或可以接受的 `partial` 后，再启用定时。

重复提交触发请求没有幂等保护：前一个运行未结束时第二个返回 409，前一个已结束时第二个就是一次新的运行。
