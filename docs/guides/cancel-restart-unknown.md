用途：说明如何取消运行、如何安全地计划内重启，以及如何处理结果未知（unknown）的操作。

范围：适用于 Web 控制台和 REST API（路径相对 `/api/v1`，需要管理员 JWT）；状态与规则的规范定义见[状态机](../design/state-machines.md)和[调度与恢复](../design/scheduling-recovery.md)，本文只给出操作步骤和后果。

# 取消、重启和 unknown 处理

下文示例中的 `$TOKEN` 是 `POST /api/v1/auth/login` 返回的 `accessToken`。

## 取消运行

入口：控制台运行详情页的“取消运行”按钮；或者调用 API：

```sh
curl -X POST http://localhost:3000/api/v1/runs/<runId>/cancel \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'
```

非终态 Run 返回 202 并记录 `cancelRequestedAt`；已结束的 Run 返回 200 和现有记录。重复请求不会重复发送远端 cancel 或 abort。

取消后的行为取决于 Run 当时的状态：

| 状态                         | 行为                                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| queued                       | 直接变为 cancelled，不发起任何远端操作                                                                                                                                                                                      |
| scanning、planned、executing | 进入 cancelling：停止派发新动作，尚未派发的 pending 变为 cancelled；中止本地扫描和下载；relay 对已建立的分片上传会话发一次有界 abort；server_copy 对已知任务发 cancel 并轮询。已发出的 mkdir、删除和 0 字节上传继续等待响应 |
| recovering（重启后收尾中）   | 只记录取消请求，并对仍未结束的已知任务各尝试一次 cancel；Run 最终仍是 interrupted（stopReason=PROCESS_RESTART），不会变成 cancelled                                                                                         |

cancelling 的收尾期限是 `CANCEL_GRACE_SECONDS`（默认 60 秒，取 Run 被接受时的配置）。期限内拿到结果的动作照常记录；期限结束仍没有结论的动作记为 unknown 并隔离。已经成功的动作保留，不回滚。最终 Run 为 cancelled，stopReason=USER_CANCEL。

超过任务的超时（`timeoutSeconds`，默认 86400 秒）时走同样的收尾，stopReason=RUN_TIMEOUT。

注意：在 relay 上传进行中取消，正在上传的文件通常会变成 unknown，因为 abort 请求返回不能证明目标驱动已经停止写入。这些路径会被隔离（默认 24 小时），处理方法见下文。如果不想产生 unknown，可以等正在传输的大文件结束后再取消。

## 计划内重启

服务收到 SIGTERM（`docker stop`、`docker compose stop/restart/down` 发出）或 SIGINT（终端 Ctrl+C）时：

1. 立即不再就绪：`/system/health/ready` 返回 503，手动触发返回 503 NOT_READY，定时触发、新的派发和维护循环停止。
2. 中止本地扫描和下载。已建立分片上传会话的 relay 在关机宽限内尝试 abort，结果通常是 unknown 并隔离；尚未提交的动作保持原状。
3. 在 `SHUTDOWN_GRACE_SECONDS`（默认 30 秒）内保存已经收到的响应和任务结果。**不会**对 OpenList 中的已知任务发送 cancel，也不会删除远端任务记录。
4. 关闭连接池和数据库后退出。宽限到期后还会额外给本地持久化固定 5 秒；仍未结束则以错误退出。

关机过程**不写任何 Run 终态**。下次启动时统一收尾：

| 重启前状态                        | 启动后                                                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| queued                            | 按原排队时间重新入队；已超过排队期限则 failed（QUEUE_TIMEOUT）                                                                                                                                                                    |
| scanning、planned                 | interrupted（PROCESS_RESTART），旧计划不执行，pending 记 skipped（PLAN_INTERRUPTED）                                                                                                                                              |
| executing、cancelling、recovering | 先进入 recovering：剩余 pending 记 skipped（PLAN_INTERRUPTED），只跟踪已知的远端任务和分片会话，最长 `RECOVERY_TIMEOUT_SECONDS`（默认 600 秒，重启不会延长）；之后统一为 interrupted（PROCESS_RESTART），仍无结论的动作记 unknown |

因此计划内重启和进程被强杀得到相同的 Run 终态。重启不会续传 relay，下次运行会重新下载整个文件；重启期间错过的定时触发也不会补跑。

推荐的重启步骤：

1. 在控制台“运行”页确认没有进行中的运行（queued、scanning、planned、executing、cancelling、recovering）。也可以用 `GET /runs?status=executing` 等按状态逐一查询。
2. 如果担心检查之后、停止之前又被定时触发，可以先停用相关任务：`POST /jobs/:id/disable`（不会取消已在运行的 Run），重启后再 `POST /jobs/:id/enable`。
3. 停止或重启进程。使用容器时，平台给出的停止宽限应大于 `SHUTDOWN_GRACE_SECONDS` 加 5 秒；仓库中的 `docker-compose.yaml` 设为 60 秒。
4. 启动后确认 `/system/health/ready` 返回 200；查看“操作”页是否出现新的未解决 unknown。

## 什么是 unknown

unknown 表示请求可能已经到达 OpenList，但本服务得不到可靠结论，例如：

- 请求超时、连接中断，或进程在提交时崩溃；
- 已知任务 id 查询返回 task not found；
- OpenList 返回错误后，一次有界的刷新观察仍无法判定；
- 取消或恢复期限届满时仍没有结束证据；
- relay 的 init 或 complete 响应丢失，或取消、关机时 abort 之后没有结束证据。

OpenList 明确拒绝执行（400、403、405 等）记为 failed，不是 unknown。完整分类见 [OperationStatus](../design/state-machines.md#operation-status)。

unknown 是 Operation 的永久历史状态，之后的处理只追加“处置结果”（resolution），不改写原记录。每条 unknown 都会隔离它的目标路径：

- 隔离期从 `unknownSince` 起算，到 `unknownUntil` 截止，长度为 `QUARANTINE_SECONDS`（默认 86400 秒；下限 2100 秒，覆盖 OpenList 分片会话 30 分钟的闲置过期）。期限持久化，重启不重新计时。
- 隔离期内，任何 Job 都不会写该路径，也不会删除它的祖先目录；目录动作还保护其全部后代。同一 OpenList 的不同账号记录之间同样生效。
- 被隔离挡住的动作记 skipped（PREVIOUS_OUTCOME_UNKNOWN），Run 为 partial，该 Target 本轮不执行 mirror 删除。其他路径照常同步。
- 隔离不阻止其他 Job 把该路径当作源来读取。

隔离到期或被提前解除后，该记录进入“需要重新观察”：之后第一次要写这些路径的真实运行，必须先以 refresh=true 成功读取全部受影响的父目录才会写入；读取失败则本轮继续跳过。读取成功后按当前源和目标的状态重新规划：

- 目标已经符合当前源：记为“已观察确认”（observed）；
- 目标缺失或大小不同：按普通计划创建或替换，新动作成功后旧记录记为“已被取代”（superseded）。

在出现处置结果之前，之后的每次运行都会重新做这次刷新读取。

**已接受风险**（[ADR 0004](../adr/0004-quarantine-expiry.md)）：时间过去、提前解除、放弃或观察确认，都不能证明原请求已经停止。原请求仍可能迟到生效，覆盖或删除后来写入的新状态。分片会话被 abort、消失或过期，同样不证明驱动已停止写入。

## 查看和处置 unknown

查看：

- 控制台概览的“需要关注”列出未解决操作；“操作”页把状态筛选设为“结果未知”、未解决筛选设为“未解决”。
- API：`GET /operations?status=unknown&unresolved=true`，可加 `instanceId=<id>` 按实例过滤。已有处置结果的历史 unknown 仍可用 `status=unknown` 查到。
- 操作详情页的“生命周期”显示结果未知起始、隔离截止、解除隔离和重新观察的时间。

三种处置方式：

| 方式         | 做什么                                                                                                                                                  | 何时使用                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 等待到期     | 什么都不做；到期后由下一次真实运行自动重新观察                                                                                                          | 默认做法                                                                                                                                          |
| 提前解除隔离 | 只写入解除时间和原因，隔离提前结束，路径进入“需要重新观察”。不改 Operation 状态，不写处置结果，不写远端文件；重复请求返回现有结果，不重置期限           | 已在 OpenList 中确认原请求不会再进行（例如任务已结束、分片会话已过期），希望该路径尽快恢复同步                                                    |
| 放弃责任     | 写入 abandoned 处置结果并结束该记录：不再计入未决责任，也不再要求重新观察；若尚未解除隔离，同时写入解除时间。不修复或回滚目标，之后的运行按普通扫描处理 | 不需要再跟踪这条记录，例如路径已不再受管理；或者要修改实例的地址或账号，而这条 unknown 是阻止修改的未决责任之一（修改会返回 409 ENDPOINT_IN_USE） |

控制台：在操作详情页的“结果未知”区域填写原因后提交“解除隔离”或“放弃操作”。“解除隔离”只在隔离尚未解除时显示，“放弃责任”在没有处置结果时显示。原因为 1–1000 个字符，不要填写凭据。

API：

```sh
# 提前解除隔离
curl -X POST http://localhost:3000/api/v1/operations/<operationId>/quarantine-release \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"reason":"已在 OpenList 中确认该分片上传会话已过期"}'

# 放弃责任
curl -X POST http://localhost:3000/api/v1/operations/<operationId>/resolve \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"kind":"abandoned","reason":"该目录已不再同步，不再跟踪这次未知结果"}'
```

两个接口只接受没有处置结果的 unknown，否则返回 409 INVALID_STATE；对已放弃的同一记录重复放弃返回 200 和现有记录，不覆盖原因。放弃时如有活动 Run 正在占用该路径，返回 409 PATH_BUSY，等该 Run 结束后再试。

两种人工处置都接受与隔离到期相同的迟到写入风险，也都不是“文件已校验正确”的证明。处置之后建议先对相关任务做一次预览运行，确认计划符合预期再真实运行。

## 不要在 OpenList 中手动重试本服务的任务

如果在 OpenList 的任务页手动重试了本服务已经结束的复制任务，使它重新运行，维护循环会为同一路径新建一条 unknown（错误码 REMOTE_TASK_CHANGED，指向原记录）并隔离该路径。原记录的结果不变。这条新的 unknown 按本文同样的方法处理。
