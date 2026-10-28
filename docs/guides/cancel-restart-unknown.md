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

cancelling 的收尾期限是 `CANCEL_GRACE_SECONDS`（默认 60 秒，取 Run 被接受时的配置）。期限内拿到结果的动作照常记录；期限结束仍没有结论的动作记为 unknown。已经成功的动作保留，不回滚。最终 Run 为 cancelled，stopReason=USER_CANCEL。

超过任务的超时（`timeoutSeconds`，默认 86400 秒）时走同样的收尾，stopReason=RUN_TIMEOUT。

注意：在 relay 上传进行中取消，正在上传的文件通常会变成 unknown，因为 abort 请求返回不能证明目标驱动已经停止写入。后续运行仍会独立扫描和规划这些路径，处理方法见下文。如果不想产生 unknown，可以等正在传输的大文件结束后再取消。

## 计划内重启

服务收到 SIGTERM（`docker stop`、`docker compose stop/restart/down` 发出）或 SIGINT（终端 Ctrl+C）时：

1. 立即不再就绪：`/system/health/ready` 返回 503，手动触发返回 503 NOT_READY，定时触发、新的派发和维护循环停止。
2. 中止本地扫描和下载。已建立分片上传会话的 relay 在关机宽限内尝试 abort，结果通常是 unknown；尚未提交的动作保持原状。
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
4. 启动后确认 `/system/health/ready` 返回 200；查看“操作”页是否出现新的 unknown 历史。

## 什么是 unknown

unknown 表示请求可能已经到达 OpenList，但本服务得不到可靠结论，例如：

- 请求超时、连接中断，或进程在提交时崩溃；
- 已知任务 id 查询返回 task not found；
- OpenList 返回错误后，一次有界的刷新观察仍无法判定；
- 取消或恢复期限届满时仍没有结束证据；
- relay 的 init 或 complete 响应丢失，或取消、关机时 abort 之后没有结束证据。

OpenList 明确拒绝执行（400、403、405 等）记为 failed，不是 unknown。完整分类见 [OperationStatus](../design/state-machines.md#operation-status)。

unknown 是 Operation 的历史终态，同一 Run 不自动重试，后续 Run 成功也不改写它。未知结果阻止本轮成功，按已有聚合规则为 partial 或 failed；取消和重启仍优先为 cancelled 或 interrupted。

## 查看未知结果与继续同步

- 控制台“操作”页把状态筛选设为“结果未知”；操作详情显示请求、传输事实和结果时间。
- API：`GET /operations?status=unknown`，可加 `instanceId=<id>` 过滤。
- 需要继续同步时，正常触发新的 Run，或等待下次定时运行。它按照自己的配置和扫描结果规划：缺失创建，大小不同先删除再创建，同名同类型同大小保持不变。
- 普通扫描遵守 Job/Target 的 refresh 设置，不会因为旧 unknown 增加刷新请求。删除前提与删除确认仍强制 refresh=true。
- 本轮未知的替换删除不会放行后续创建，未知父目录创建不会放行子操作，本轮创建失败或未知仍阻止该目标的 mirror extras。

历史 unknown 不阻止实例身份修改或历史保留期删除。活动 Run 和待删除的远程任务记录仍有独立责任。已知历史 copy 任务未结束时继续消耗 Target 的 concurrentFiles；因此新 Run 仍可能等待真实远程负载释放额度，但不会因旧结果按路径跳过。

## 已接受的迟到副作用

取消响应、分片 abort 成功或 session 消失都不能证明云端已经停止。旧请求可能覆盖或删除较新的目标，下一轮只能修复它能够观察且允许处理的差异：

- 同大小的不同内容视为 unchanged；文件/目录冲突记 TYPE_CONFLICT 并保护，可能需要人工处理。
- 缓存可能隐藏变化；最后一次 Run 之后发生的删除，要有后续成功运行才可能修复。
- incremental 保留迟到 extras；mirror 仍受过滤、扫描完整性和删除保护限制。
- 目标用作另一 Job 的源时，迟到或临时缺失的状态可能传播到下游。
- OneDrive 的迟到 mkdir 可能生成改名空目录。incremental 会保留；mirror 也只有在 syncEmptyDirs=true 且保护允许时才删除。

source 不作为本 Job 的写入目标，但跨地址、挂载或符号链接的底层别名不能全部识别。详情见[ADR 0004](../adr/0004-unknown-outcomes.md)。

## OpenList 中手动重试任务

管理员手动重试本服务的旧 copy task 属于外部写入。维护观察到远程终态回到非终态时，只更新原记录的 task 状态并记录日志，不新增操作，也不改写原结果。任务未结束时不删除它的远程记录，仍计入 Target 额度；终态后再删除记录。

旧版本产生的 REMOTE_TASK_CHANGED 行仍是可查询历史，不影响当前计划或执行统计。历史结果不需要通过管理表单“解决”。
