用途：定义Run、Operation、隔离释放与未知结果处理接口。

范围：全部需要管理JWT；模型见[API schemas](api-schemas.md)，不提供任意远程删除或旧计划重放API。

# 执行API

## 路由

| 方法/路径                               | 请求/查询                                                       | 成功响应                                  |
| --------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| POST /jobs/:id/runs                     | {dryRun?:boolean=false,confirmDeletes?:boolean=false}           | 202 RunView，Location=/api/v1/runs/:runId |
| GET /runs                               | page,pageSize,jobId?,status?,dryRun?                            | 200 Page<RunView>                         |
| GET /runs/:id                           | 无                                                              | 200 RunDetail                             |
| POST /runs/:id/cancel                   | {}                                                              | 202 RunView；已终态200现有Run             |
| GET /runs/:id/operations                | page,pageSize,status?,action?,includeMaintenance?:boolean=false | 200 Page<OperationView>                   |
| GET /runs/:id/issues                    | page,pageSize                                                   | 200 Page<ScanIssueView>                   |
| GET /operations/:id                     | 无                                                              | 200 OperationView                         |
| GET /operations                         | page,pageSize,status?,instanceId?,unresolved?:boolean           | 200 Page<OperationView>                   |
| POST /operations/:id/quarantine-release | {reason:string}                                                 | 200 OperationView                         |
| POST /operations/:id/resolve            | {kind:'abandoned',reason:string}                                | 200 OperationView                         |

reason要求1–1000字符，禁止只有空白。分页和错误格式继承[REST](rest-api.md)，error code取值见[固定原因码](rest-api.md#reason-codes)。没有Operation直接retry API；请求新Run重新扫描，自动有限attempt由执行器负责。
Operation列表按(runId,seq)升序，seq是Run内的计划顺序。includeMaintenance=false时不返回维护循环挂在该Run下的REMOTE_TASK_CHANGED隔离记录；GET /operations不按此过滤。

M2阶段请求必须显式提供dryRun=true；false或省略返回400 VALIDATION_ERROR且不创建Run，M3a才解除此阶段限制。M2只提供里程碑端点表列出的触发与查询，不提供cancel、隔离或真实执行。

## 手动执行

disabled Job可手动执行；归档、缺secret、路径身份未确定拒绝。手动Run（含dry-run）和启用Job都检查已测试的版本及能力：不支持的OpenList版本拒绝，multipart禁用的实例不能作为relay Target；disabled配置可先引用未测试实例保存。JOB_BUSY覆盖queued及恢复状态；入队不等待扫描，因此202不承诺执行成功。
confirmDeletes只在该Run有效，不修改Job保存值。它只跳过每个Target的数量/比例阈值检查（maxCount/maxPercent，见[文件阈值](../design/deletion.md#文件阈值)），没有扫描全目标删除阻断时该Target的deleteBudgetCount为null（数量/比例不限）；有此类阻断时仍为0。它不覆盖其他任何删除保护：

- 扫描完整性与suspect视图、挂载边界；
- 空源保护（allowEmptySource）；
- 名称/类型碰撞及受保护后代；
- 未决unknown隔离与重新观察；
- PLAN_INVALID。

dryRun=true且confirmDeletes=true只展示跳过阈值后的计划，仍没有远程文件变更。
重复HTTP请求没有幂等key；第一个仍非终态时第二个409。若第一个已完成，第二个是新的运行，此行为必须公开。

取消：非终态Run返回202并写cancelRequestedAt，重复请求不重复发送远程cancel或abort。recovering Run同样返回202，但只写cancelRequestedAt，并对仍未终态的已知task最多发送一次cancel；该Run最终仍为interrupted（stopReason=PROCESS_RESTART），不会变为cancelled。完整转换见[取消与超时](../design/scheduling-recovery.md#取消与超时)。

## 两种管理动作的区别

| 动作                        | 改变                                                                                                                                                                                | 不改变                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| quarantine-release          | 写quarantineReleasedAt及原因；隔离提前结束，路径进入reobserve_required                                                                                                              | 不改Operation.status，不写resolution，不直接写远程文件 |
| operation.resolve abandoned | 写独立resolution（kind=abandoned，note=reason）；对unknown行，quarantineReleasedAt为空时同一事务写入当前时间及reason，并结束该记录；该Operation不再计入未决责任，也不再要求重新观察 | 不改status，不修复或回滚目标                           |

quarantine-release一个unknown之后，任何要写受影响路径或删除其祖先的非dry-run Run，都必须先用refresh=true读取全部受影响父目录，成功后才写reobservedAt；读取失败则本轮不写这些路径。规则见[Unknown隔离](../design/scheduling-recovery.md#unknown隔离)，派生状态见[辅助状态](../design/state-machines.md#auxiliary-states)。

quarantine-release仅允许status=unknown且无resolution；重复release返回200现有结果，不延长/重置期限。其他状态409 INVALID_STATE。
operation.resolve只接受status=unknown且无resolution的Operation。对已abandoned的同一Operation重复请求返回200现有对象，不覆盖已存note。已有observed/superseded resolution或不属于上述对象时409 INVALID_STATE。有活动Run占用受影响路径时409 PATH_BUSY。
人工resolve不保证旧请求已停止，与隔离到期接受同一迟到写入风险（见[ADR 0004](../adr/0004-quarantine-expiry.md)）；必须在UI/API描述里写明。凭据修复、取消请求和隔离释放不是一个动作。

## 查询与进度

Operation未知列表用status=unknown&unresolved=true；已resolution但历史unknown仍能用status=unknown查到。不要用状态成功数推算它们已被改写。
Stats在Run终态固定；后续resolution只改变其独立记录，不改变历史同步统计或重发终态通知。
RunDetail.config只包含当时有效的脱敏值；路径密码和download sign从不展示。
轮询建议3s，允许客户端退避；MVP没有SSE、WS、按字节实时数据库更新承诺。

## 例子

```json
{ "dryRun": true, "confirmDeletes": false }
```

这是一次完整扫描预览请求，不产生可直接执行的审批产物。后续实跑再次POST并设dryRun=false。

```json
{
  "kind": "abandoned",
  "reason": "已在OpenList中确认该路径状态，不再跟踪这次未知结果"
}
```

这是结束一条unknown记录的请求；不能用于表示“云端复制已经被校验”。
