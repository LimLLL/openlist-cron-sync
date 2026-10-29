用途：定义 Run 执行与只读 Operation 历史接口。

范围：全部需要管理JWT；模型见[API schemas](api-schemas.md)，不提供任意远程删除或旧计划重放API。

# 执行API

## 路由

| 方法/路径                | 请求/查询                                                       | 成功响应                                  |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------- |
| POST /jobs/:id/runs      | {dryRun?:boolean=false,confirmDeletes?:boolean=false}           | 202 RunView，Location=/api/v1/runs/:runId |
| GET /runs                | page,pageSize,jobId?,status?,dryRun?                            | 200 Page<RunListItem>                     |
| GET /runs/:id            | 无                                                              | 200 RunDetail                             |
| POST /runs/:id/cancel    | {}                                                              | 202 RunView；已终态200现有Run             |
| POST /runs/:id/retry     | {confirmDeletes?:boolean=false}                                 | 202 RunView，Location=/api/v1/runs/:runId |
| GET /runs/:id/operations | page,pageSize,status?,action?                                   | 200 Page<OperationView>                   |
| GET /runs/:id/issues     | page,pageSize                                                   | 200 Page<ScanIssueView>                   |
| GET /operations/:id      | 无                                                              | 200 OperationDetail                       |
| GET /operations          | page,pageSize,status?,instanceId?                               | 200 Page<OperationView>                   |

分页和错误格式继承[REST](rest-api.md)，error code取值见[固定原因码](rest-api.md#reason-codes)。没有单个Operation的直接retry API，自动有限尝试由执行器负责；需要重做时触发新的完整Run，或对Job最近一次正式Run用POST /runs/:id/retry只重新检查其未成功项（见[重试未成功项](#重试未成功项)）。
GET /runs支持status=active，等价于queued/scanning/planned/executing/cancelling/recovering，可与jobId和dryRun组合。过滤在分页前应用，total使用同一条件；响应status仍为实际Run状态。未传dryRun时活动查询也包含预览。列表的jobName取冻结快照，不依赖Job当前名称或是否归档。
Operation列表按(runId,seq)升序，seq是Run内的计划顺序，重试不改变序号，历史序号可能有间隔。列表每项是一个计划动作（逻辑操作）：一次失败后自动重试成功只返回一条succeeded，attemptCount为2；status过滤按逻辑结果，因此这条不会出现在status=failed中。列表项不含尝试明细。
GET /operations/:id返回OperationDetail，attempts按attemptNo升序列出每次尝试的状态、错误、远程任务、分片会话、字节与时钟。旧版本链接里的尝试ID同样返回200，响应id为所属操作的ID（不做HTTP重定向）；控制台旧的?op=链接用该ID取详情后按响应id定位。升级时删除的旧REMOTE_TASK_CHANGED维护记录返回404。includeMaintenance参数已删除，继续传入返回400。

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

## 重试未成功项

POST /runs/:id/retry 新建一个重试运行（trigger=manual，retryOfRunId=来源Run ID），只重新检查来源Run中未成功的项目，不重新扫描整棵树。请求体只接受confirmDeletes（默认false，不继承来源Run的值）；不接受路径、dryRun或其他字段，路径由服务端从历史中提取。

资格（GET /runs/:id 的 retryEligibility 给出同样结论，POST 在接受事务中复查）：

| 原因                    | 含义                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| RUN_NOT_TERMINAL        | 来源Run尚未结束                                                              |
| DRY_RUN                 | 来源是试运行                                                                 |
| HISTORY_EXPIRED         | 来源Run已超过RUN_RETENTION_DAYS，历史可能正被分批清理                        |
| JOB_ARCHIVED            | Job已归档                                                                    |
| JOB_BUSY                | Job有非终态Run（HTTP为409 JOB_BUSY）                                         |
| RUN_SUPERSEDED          | 来源不是该Job最近一次正式Run（试运行不算）                                   |
| SOURCE_ENDPOINT_CHANGED | Job当前源的instanceId或path与来源Run不同；需要完整运行                       |
| NO_RETRY_ITEMS          | 没有未成功项，或其所属目标都已被移除/改了instanceId或path                    |

其余拒绝为409 RETRY_NOT_ALLOWED，details=[{field:'runId',reason}]；队列满、未就绪和当前端点配置不可运行沿用手动执行的错误。并发的两个请求最多接受一个。

候选：结果不是succeeded的新建/替换文件（含failed、unknown、cancelled、skipped及未执行的）和mkdir目录自身；replace的删除与新建合并为一个文件项，扫描中断留下的半条replace也能提取；不包含mirror extras删除和retry_cleanup。目录项只代表该目录自身，不展开其中后来新增的内容。来源本身是重试运行时，候选为其范围中尚未处理、受阻或已规划但最终未成功的项，确认无需操作的项不再入选。

配置：使用Job当前配置（过滤、并发、超时、refresh等）并在接受时冻结。目标按稳定Target ID匹配；已移除或instanceId/path改变的目标排除（计入excludedItems），新加的目标不参与；快照只保留参与的目标。范围随新Run持久化，排队、重启恢复、取消与超时规则与普通Run相同；扫描或排队阶段中断时，尚未处理的项可再次重试。来源Run被历史保留清理不影响已接受的重试运行。

执行：只遍历范围路径所在的各级目录（源端共享祖先不因多个Target重复遍历，各Target分别读取；遵守端点refresh与扫描间隔），完整父目录列表仍参与名称碰撞、过滤和挂载保护，再按普通规划规则逐项判断：源文件已不存在（可证明缺失时）或目标已有同大小文件则无需操作，计入unchangedFiles；无需操作的目录项不计入unchangedFiles；大小不同则replace。当前源与目标的类型冲突仍记TYPE_CONFLICT；原重试项在源上的类型改变、或必要祖先变成文件时，若未先被过滤或保护，则记RETRY_TYPE_CHANGED。不规划任何mirror extras删除，也不推断空源（EMPTY_SOURCE）。删除阈值按本次范围计算：分母D只计范围内明确选中的受管理目标文件，replace与retry_cleanup共用同一预算，因此范围很小时比例阈值很容易拦下替换；需要放行时在请求中设confirmDeletes=true，它与手动执行同义，只跳过数量/比例阈值。

重试运行的stats、sourceComplete/targetComplete只表示范围项及必要祖先目录的观察，不代表整个Job已完整扫描；来源Run中未形成操作的纯扫描问题（不可读目录、深度超限、碰撞等）不会单独成为候选，需完整运行全面重新评估；与本次范围相交的路径仍会执行相同的扫描保护检查。

## 未知结果

unknown 只作为本次尝试的历史结果，不提供管理动作或单个操作的重试接口。需要同步时触发新的 Run（完整运行，或对最近一次正式运行做[重试未成功项](#重试未成功项)），它按自己的配置和扫描规划；不改旧结果，不额外强制 refresh。旧请求仍可能迟到生效，见[ADR 0004](../adr/0004-unknown-outcomes.md)。

## 查询与进度

Operation 未知列表使用 status=unknown，可按 instanceId 过滤；历史结果不因后续 Run 成功而改写。
Stats 的结果计数按逻辑操作的状态，字节累计全部尝试，retryAttempts 为额外尝试数；活动 Run 聚合、终态聚合和 extras 判断使用同一口径。Stats 在 Run 终态固定；维护只更新 task 事实，不改变历史同步结果或重发终态通知。
GET /runs/:id及GET /runs当前页的planned/executing/cancelling/recovering运行使用同一SQL聚合口径读取当前执行统计，规则与终态聚合一致；queued/scanning显示已持久化的规划统计。列表仅聚合返回页中的运行，不聚合页外记录。issueCount读取已提交的scan_issues。下载及上传字节约每5秒持久化，因此长单文件上传中也会增长；不是逐字节更新。payload全部发送完成后刷新最终字节并停止周期写入，complete等待仍保留心跳；源EOF释放配额不等于Operation成功，也不提前持久化上传的EOF检查点。列表和详情聚合超出安全整数均返回HTTP 500 RESOURCE_LIMIT，不通过读取改变Run状态或回退成零统计。触发/取消返回的RunView仍为持久化摘要。
RunDetail.sourceInstanceName、targets[].instanceName以及操作响应的sourceInstanceName/targetInstanceName按冻结名称、当前（含归档）实例名、8字符Instance ID前缀解析；操作没有源端时sourceInstanceName为null。所有原始ID仍返回。操作过滤的“全部”对应省略status/action，不能发送all；翻页参数仍为page/pageSize。
RunDetail.config只包含当时有效的脱敏值；路径密码和download sign从不展示。
活动Run轮询以5s为起点，空活动列表可15s刷新以发现新运行；只轮询当前可见页面/操作面板，隐藏浏览器标签页暂停。终态后刷新一次最终数据并停止，终态unknown不持续轮询；MVP没有SSE、WS、按字节实时数据库更新承诺。

## 例子

```json
{ "dryRun": true, "confirmDeletes": false }
```

这是一次完整扫描预览请求，不产生可直接执行的审批产物。后续实跑再次POST并设dryRun=false。

查看未知历史使用 `GET /operations?status=unknown`。
