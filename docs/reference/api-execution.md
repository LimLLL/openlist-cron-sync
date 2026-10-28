用途：定义 Run 执行与只读 Operation 历史接口。

范围：全部需要管理JWT；模型见[API schemas](api-schemas.md)，不提供任意远程删除或旧计划重放API。

# 执行API

## 路由

| 方法/路径                | 请求/查询                                                       | 成功响应                                  |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------- |
| POST /jobs/:id/runs      | {dryRun?:boolean=false,confirmDeletes?:boolean=false}           | 202 RunView，Location=/api/v1/runs/:runId |
| GET /runs                | page,pageSize,jobId?,status?,dryRun?                            | 200 Page<RunView>                         |
| GET /runs/:id            | 无                                                              | 200 RunDetail                             |
| POST /runs/:id/cancel    | {}                                                              | 202 RunView；已终态200现有Run             |
| GET /runs/:id/operations | page,pageSize,status?,action?,includeMaintenance?:boolean=false | 200 Page<OperationView>                   |
| GET /runs/:id/issues     | page,pageSize                                                   | 200 Page<ScanIssueView>                   |
| GET /operations/:id      | 无                                                              | 200 OperationView                         |
| GET /operations          | page,pageSize,status?,instanceId?                               | 200 Page<OperationView>                   |

分页和错误格式继承[REST](rest-api.md)，error code取值见[固定原因码](rest-api.md#reason-codes)。没有Operation直接retry API；请求新Run重新扫描，自动有限attempt由执行器负责。
Operation列表按(runId,seq)升序，seq是Run内的计划顺序。includeMaintenance=false时不返回旧版本留下的 REMOTE_TASK_CHANGED 历史记录；GET /operations不按此过滤。

默认dryRun=false，支持relay与server_copy真实执行、取消及 unknown 历史查询；dry-run仅规划。

## 手动执行

disabled Job可手动执行；归档、缺secret、路径身份未确定拒绝。手动Run（含dry-run）和启用Job都检查已测试的版本及能力：不支持的OpenList版本拒绝，multipart禁用的实例不能作为relay Target；disabled配置可先引用未测试实例保存。JOB_BUSY覆盖queued及恢复状态；入队不等待扫描，因此202不承诺执行成功。
confirmDeletes只在该Run有效，不修改Job保存值。它只跳过每个Target的数量/比例阈值检查（maxCount/maxPercent，见[文件阈值](../design/deletion.md#文件阈值)），没有扫描全目标删除阻断时该Target的deleteBudgetCount为null（数量/比例不限）；有此类阻断时仍为0。它不覆盖其他任何删除保护：

- 扫描完整性与suspect视图、挂载边界；
- 空源保护（allowEmptySource）；
- 名称/类型碰撞及受保护后代；
- PLAN_INVALID。

dryRun=true且confirmDeletes=true只展示跳过阈值后的计划，仍没有远程文件变更。
重复HTTP请求没有幂等key；第一个仍非终态时第二个409。若第一个已完成，第二个是新的运行，此行为必须公开。

取消：非终态Run返回202并写cancelRequestedAt，重复请求不重复发送远程cancel或abort。recovering Run同样返回202，但只写cancelRequestedAt，并对仍未终态的已知task每进程最多尝试一次cancel（崩溃后允许重复）；该Run最终仍为interrupted（stopReason=PROCESS_RESTART），不会变为cancelled。完整转换见[取消与超时](../design/scheduling-recovery.md#取消与超时)。

## 未知结果

unknown 只作为本次尝试的历史结果，不提供管理动作或直接重试接口。需要同步时触发新的 Run，它按自己的配置和扫描规划；不改旧结果，不额外强制 refresh。旧请求仍可能迟到生效，见[ADR 0004](../adr/0004-unknown-outcomes.md)。

## 查询与进度

Operation 未知列表使用 status=unknown，可按 instanceId 过滤；历史结果不因后续 Run 成功而改写。
Stats 按 error.code=REMOTE_TASK_CHANGED 排除旧版维护记录，含活动 Run 聚合和 extras 判断。Stats 在 Run 终态固定；维护只更新 task 事实，不改变历史同步结果或重发终态通知。
GET /runs/:id在planned/executing/cancelling/recovering时用单条SQL聚合每个Target的当前执行统计，规则与终态聚合一致；queued/scanning显示已持久化的规划统计。issueCount读取已提交的scan_issues。下载及上传字节约每5秒持久化，因此长单文件上传中也会增长；不是逐字节更新。payload全部发送完成后刷新最终字节并停止周期写入，complete等待仍保留心跳；源EOF释放配额不等于Operation成功，也不提前持久化上传的EOF检查点。聚合超出安全整数返回HTTP 500 RESOURCE_LIMIT，不通过读取改变Run状态。GET /runs列表及触发/取消返回的RunView仍为持久化摘要，详情轮询使用GET /runs/:id。
RunDetail.sourceInstanceName、targets[].instanceName以及操作响应的sourceInstanceName/targetInstanceName按冻结名称、当前（含归档）实例名、8字符Instance ID前缀解析；操作没有源端时sourceInstanceName为null。所有原始ID仍返回。操作过滤的“全部”对应省略status/action，不能发送all；翻页参数仍为page/pageSize。
RunDetail.config只包含当时有效的脱敏值；路径密码和download sign从不展示。
活动操作轮询建议 3s，终态 unknown 不持续轮询；允许客户端退避；MVP没有SSE、WS、按字节实时数据库更新承诺。

## 例子

```json
{ "dryRun": true, "confirmDeletes": false }
```

这是一次完整扫描预览请求，不产生可直接执行的审批产物。后续实跑再次POST并设dryRun=false。

查看未知历史使用 `GET /operations?status=unknown`。
