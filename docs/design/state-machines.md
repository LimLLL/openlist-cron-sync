用途：提供 Run、Operation 及辅助生命周期的唯一规范枚举和转换条件。

范围：数据库 CHECK、API enum、日志和实现均引用本文；不允许其他文档另建同义状态。

# 状态机

<a id="run-status"></a>

## RunStatus

`queued | scanning | planned | executing | cancelling | recovering | succeeded | partial | failed | cancelled | interrupted`

终态：`succeeded | partial | failed | cancelled | interrupted`。终态不重新进入执行，不因后来观察或通知失败改写。

| 当前                            | 事件/条件                                                                                                 | 下一状态                 | 允许动作                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| queued                          | 得到执行位及全部路径占用                                                                                  | scanning                 | 读取并规划                                                                                                 |
| queued                          | 取消                                                                                                      | cancelled                | 不执行远程操作                                                                                             |
| queued                          | 等待期限届满                                                                                              | failed                   | error_code=QUEUE_TIMEOUT，stop_reason=NULL                                                                 |
| scanning                        | 全部扫描结束且计划落库                                                                                    | planned                  | 计算保护结果，不写远程文件                                                                                 |
| scanning                        | source根目录读取失败（SOURCE_ROOT_UNAVAILABLE）、扫描期资源超限（RESOURCE_LIMIT，见下）、无法安全建立计划 | failed                   | 所有 pending 标 skipped（error_code=PLAN_INTERRUPTED）；不执行任何计划                                     |
| scanning/planned                | 用户取消/执行超时                                                                                         | cancelling               | 停止扫描/派发                                                                                              |
| planned                         | dryRun=true                                                                                               | succeeded 或 partial     | 只结束预览；Operations 保持 pending 或 skipped                                                             |
| planned                         | 非 dry-run 且有可执行动作                                                                                 | executing                | 只提交依赖满足的动作                                                                                       |
| planned                         | 无动作且无异常                                                                                            | succeeded                | unchanged 属于正常完成                                                                                     |
| planned                         | 无可执行动作但有保护/冲突/扫描问题                                                                        | partial                  | 保留原因                                                                                                   |
| executing                       | 工作全部结束                                                                                              | succeeded/partial/failed | 按下方聚合规则                                                                                             |
| executing                       | 取消或总执行超时                                                                                          | cancelling               | 停止新工作，请求取消                                                                                       |
| executing                       | 本地不可恢复实现错误                                                                                      | failed                   | 不进入cancelling：停止派发，对已知远程动作执行取消步骤（宽限内）；未决者unknown；error_code=INTERNAL_ERROR |
| cancelling                      | 已收尾或取消宽限到期                                                                                      | cancelled                | 未确认副作用进入 unknown                                                                                   |
| recovering                      | 用户取消                                                                                                  | recovering               | 只写cancelRequestedAt；对仍未终态的已知tid每进程最多尝试一次cancel；最终仍为interrupted                    |
| scanning/planned                | 进程重启                                                                                                  | interrupted              | 旧计划不可执行；pending→skipped（PLAN_INTERRUPTED）                                                        |
| executing/cancelling/recovering | 进程重启                                                                                                  | recovering               | 只恢复已知远程任务，不派发旧 pending；同一事务将剩余pending标skipped（PLAN_INTERRUPTED）                   |
| recovering                      | 已知任务均终态或持久恢复时钟派生的最终宽限届满                                                            | interrupted              | 未决副作用按 unknown 记录；stop_reason=PROCESS_RESTART                                                     |

扫描期资源超限指 SCAN_MAX_DIRECTORY_ENTRIES、列表响应超过 OPENLIST_MAX_JSON_BYTES、MAX_OPERATIONS_PER_RUN、MAX_SCAN_ISSUES_PER_RUN：Run failed，不执行部分计划。SCAN_MAX_DEPTH 例外：超过深度的子树记 scan_issue（SCAN_DEPTH_EXCEEDED，protect_subtree=1），按子树读取不完整处理，不使整个 Run 失败。执行期刷新超限只阻断相关动作，见[删除保护](deletion.md#执行时复查)。
Target 根目录不可用不是 Run 失败：该 Target 记 TARGET_ROOT_UNAVAILABLE，不做新建和删除，Run partial；根目录确认不存在时由 prepare mkdir 创建，见[同步引擎](sync-engine.md#阶段一scan--plan)。
数据库已无法写入时 fail-fast，依赖下次启动发现旧非终态，不伪报终态。
超时使用 cancelled + stopReason=RUN_TIMEOUT；手动取消 stopReason=USER_CANCEL；重启收尾使用 interrupted + stopReason=PROCESS_RESTART。
queued 重启仍 queued，保留 createdAt 和 queueDeadlineAt；过期则 failed。recovery_deadline_at 只在首次进入 recovering 时写入，之后的重启沿用原值，避免崩溃循环无限延长恢复。

<a id="shutdown"></a>

### 正常关机（SIGTERM）

关机不写任何 Run 终态：ready=false；停止新触发、派发、提交和维护；中止本地扫描与 relay（已记录 session 的 relay 在关机宽限内尝试 abort，结果按 [relay 结果分类](relay.md#结果分类)记录，通常为 unknown）；保存已收到的结果；不主动 cancel 已知 OpenList task。下次启动按上表“进程重启”各行处理。

## Run 聚合

聚合按本轮每个必要逻辑操作的结果计算；一次失败后重试成功的操作就是succeeded，早先失败的尝试只留在尝试记录中，不作为当前失败或extras阻断条件。unknown不在本轮自动重试，不能用此规则抹去。依赖已安排下一次尝试时下游保持pending，依赖关系不变；预算耗尽才将下游skipped。
在未被取消/中断的 Run 内，结果为 cancelled 的 Operation（例如管理员在 OpenList 外部取消了 task）按 failed 参与聚合和 extras 判定。

- dry-run：未发现降级类异常为 succeeded；降级类保护、冲突、子树读取失败为 partial；source 根失败为 failed。预览计数不冒充执行计数。
- 正常：所有必要动作 succeeded 或 unchanged，且无降级类扫描/保护问题 → succeeded。下表的提示/警告不使Run降级，保护这些路径不妨碍其他extras。
- 已有成功动作或 unchanged 文件，同时有 failed/unknown/cancelled/异常 skipped → partial。
- 只有保护/冲突导致无动作 → partial；全部尝试失败且无任何成功/unchanged → failed。
- 取消、重启优先使用 cancelled/interrupted，不被部分成功覆盖。
- 单 Target 的 failed/unknown/cancelled/阻断类 skipped 禁止该 Target 的 mirror extras。其他 Target 可以完成。
- filtered 不生成 Operation、不构成异常。

<a id="code-classification"></a>

## 原因码分类

每个码只有一种记录方式。scan_issue 不对应 Operation；skipped/failed 写在 Operation.error_code。“阻断 extras”指该 Target 本轮不执行 mirror extras 删除；“Run 降级”指使 succeeded 变 partial。

| 码                                        | 记录方式                    | 影响范围                                                                       | 阻断 extras              | Run 降级 |
| ----------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ | ------------------------ | -------- |
| SOURCE_ROOT_UNAVAILABLE / RESOURCE_LIMIT  | Run.error_code              | 整个 Run failed                                                                | —                        | failed   |
| SCAN_INCOMPLETE                           | scan_issue，protect_subtree | source：所有 Target 全部删除禁止；target：该 Target 全部删除禁止               | 是（对应范围）           | 是       |
| SCAN_DEPTH_EXCEEDED                       | scan_issue，protect_subtree | 同 SCAN_INCOMPLETE                                                             | 是（对应范围）           | 是       |
| SUSPECT_VIEW                              | scan_issue                  | source可疑范围映射到所有Target；target仅该范围禁止删除，独立列出的旁支不受影响 | 是（相关Target的extras） | 是       |
| MOUNT_BOUNDARY_UNKNOWN                    | scan_issue                  | 管理员挂载列表不可信：目标实例阻断其Target；源实例阻断所有Target删除           | 是（相关 Target）        | 是       |
| TARGET_ROOT_UNAVAILABLE                   | scan_issue                  | 该 Target 无新建无删除                                                         | 是                       | 是       |
| TARGET_ROOT_WILL_BE_CREATED               | scan_issue（提示）          | 仅 dry-run 说明                                                                | 否                       | 否       |
| EMPTY_SOURCE                              | scan_issue                  | 所有 Target 全部删除禁止                                                       | 是                       | 是       |
| PLAN_INVALID                              | scan_issue                  | 该 Target 全部删除禁止，不可人工覆盖                                           | 是                       | 是       |
| TYPE_CONFLICT                             | scan_issue                  | 冲突路径及子树保护                                                             | 是（该 Target）          | 是       |
| RETRY_TYPE_CHANGED                        | scan_issue                  | 仅重试运行：该范围项保护，不扩展范围；按源问题记录                             | 是（所有 Target）        | 是       |
| NAME_COLLISION（source 内部）             | scan_issue                  | 所有 Target 保护冲突名                                                         | 是（所有 Target）        | 是       |
| NAME_COLLISION（source 与 Target 之间）   | scan_issue                  | 该 Target 保护                                                                 | 是（该 Target）          | 是       |
| NAME_COLLISION（仅 Target 单侧条目之间）  | scan_issue（警告）          | 该 Target 保护，不计入阈值分母                                                 | 否                       | 否       |
| INVALID_NAME（source 侧）                 | scan_issue                  | 保护所在目录                                                                   | 是（所有 Target）        | 是       |
| INVALID_NAME（仅 Target 侧）              | scan_issue（警告）          | 保护所在目录                                                                   | 否                       | 否       |
| UNKNOWN_SIZE（source 文件）               | scan_issue                  | 同名目标保护                                                                   | 是（所有 Target）        | 是       |
| TARGET_UNKNOWN_SIZE（Target 单侧文件）    | scan_issue（警告）          | 保护，不是 extra，不计入阈值分母                                               | 否                       | 否       |
| TARGET_UNKNOWN_SIZE（与 source 文件同名） | scan_issue                  | 保护，不替换                                                                   | 是（该 Target）          | 是       |
| DELETE_BLOCKED                            | skipped Operation           | 扫描保护阻断的Target删除及依赖create；具体原因见blockReasons/issues            | 是                       | 是       |
| DELETE_LIMIT                              | skipped Operation           | 该 Target 全部 delete 及依赖 create                                            | 是                       | 是       |
| SOURCE_CHANGED / PRECONDITION_CHANGED     | skipped Operation           | 当前文件                                                                       | 是                       | 是       |
| PRECONDITION_UNVERIFIED                   | skipped Operation           | 前提读取失败的文件及依赖 create                                                | 是                       | 是       |
| DEPENDENCY_FAILED                         | skipped Operation           | 依赖未成功的下游                                                               | 是                       | 是       |
| DELETE_NOT_EFFECTIVE                      | failed Operation            | 当前文件；依赖 create skipped                                                  | 是                       | 是       |
| PRECONDITION_ALREADY_ABSENT               | skipped Operation（正常）   | 原 extra 或待删除文件已不存在                                                  | 否                       | 否       |
| PLAN_INTERRUPTED                          | skipped Operation           | 重启/扫描失败导致不执行的旧计划                                                | —                        | —        |
| OBSERVED_AFTER_ERROR                      | succeeded Operation 的说明  | 写操作返回错误后观察到已生效                                                   | 否                       | 否       |

“警告”类只保护规定的路径范围，不影响范围外的extras，也不使Run降级；Target单侧INVALID_NAME不操作该非法条目，不删除其父目录或祖先，但不一并禁止合法兄弟条目的文件删除。Target内部碰撞若任一冲突名与source条目关联，按source与Target之间碰撞分类，只有全部为Target单侧条目时才是警告。提示/警告仍出现在issues查询中，不因protect_subtree=true自动升级为阻断类。新增规划保护码同时登记本表和[REST原因码](../reference/rest-api.md#reason-codes)。

<a id="operation-status"></a>

## OperationStatus

`pending | submitting | submitted | running | succeeded | failed | skipped | unknown | cancelled`

终态：`succeeded | failed | skipped | unknown | cancelled`。下表描述单次尝试；尝试终态不修改。逻辑操作的状态等于当前尝试的状态：可重试的 failed 在同一事务内结束该尝试并新建下一次 pending 尝试，操作回到 pending、attemptCount 增加；不再重试时操作随该尝试进入同一终态。

| 当前              | 条件                                                                            | 下一状态                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| pending           | 本地源准备失败（尚未提交create）                                                | failed，读取瞬时错误可在预算内重试                                                                                                                  |
| pending           | create提交前确认SOURCE_CHANGED                                                  | skipped SOURCE_CHANGED；保留已成功delete，不执行过期计划                                                                                            |
| pending           | 依赖未满足                                                                      | pending                                                                                                                                             |
| pending           | 保护拒绝、依赖失败、旧计划失效                                                  | skipped（写error_code）                                                                                                                             |
| pending           | 运行取消且未派发                                                                | cancelled                                                                                                                                           |
| pending           | 即将提交，先提交本地事务                                                        | submitting                                                                                                                                          |
| submitting        | 明确成功且无 task：create/mkdir                                                 | succeeded                                                                                                                                           |
| submitting        | 明确成功：delete（remove）                                                      | running，等待刷新确认                                                                                                                               |
| submitting        | server_copy 收到 task id                                                        | submitted                                                                                                                                           |
| submitting        | relay 收到有效 init 响应，已写入 upload_id                                      | running                                                                                                                                             |
| submitting        | 明确执行前拒绝：JSON 400/403（含 file exists、IgnoredSystemFile）/405、认证阻断 | failed                                                                                                                                              |
| submitting        | OpenList 返回 JSON 500 或其他非成功码                                           | 一次有界观察后：已生效→succeeded（OBSERVED_AFTER_ERROR）；原状态完整→failed；其他→unknown                                                           |
| submitting        | 无响应、超时、连接中断、进程崩溃（请求可能仍在进行）                            | unknown                                                                                                                                             |
| submitted/running | 任务 pending/重试中                                                             | submitted                                                                                                                                           |
| submitted         | 任务运行/取消中                                                                 | running                                                                                                                                             |
| submitted/running | create task 成功（state 2）                                                     | succeeded                                                                                                                                           |
| submitted/running | task failed（7）/canceled（4）                                                  | failed/cancelled                                                                                                                                    |
| submitted/running | task 不存在（JSON 404）、恢复期限内无法取得终态                                 | unknown                                                                                                                                             |
| running           | delete 刷新确认原路径消失                                                       | succeeded                                                                                                                                           |
| running           | 同步返回成功的 delete，确认超时后原路径仍在                                     | failed（DELETE_NOT_EFFECTIVE）                                                                                                                      |
| running           | 无法确认 delete：刷新失败/视图可疑                                              | unknown                                                                                                                                             |
| running           | relay 的 chunk/complete 阶段结果                                                | 按 [relay 结果分类](relay.md#结果分类)：completed 且已记录源 EOF→succeeded；session 失败或主动 abort→failed；响应丢失、取消或关机无结束证据→unknown |

“一次有界观察”的具体判定见 [OpenList 集成](openlist-integration.md#完成分类)。成功无 task 不属于 unknown；task progress=100 不决定终态。
relay 在 init 前为 submitting，收到有效 init 响应并写入 upload_id 后为 running；init 明确拒绝则 failed，init 响应丢失则 unknown。0 字节文件的普通 put 按 create 的同步成功处理。
delete 使用 remove 确认路径；mkdir/create 没有常规后验文件校验。
失败可重试只有在没有仍可能进行的写入、当前前提仍满足且次数未耗尽时；见 [集成](openlist-integration.md)。
管理员在 OpenList 中重试已结束的 task 时，维护仅更新原尝试的 remote_state 并记录终态逆转日志，不新增操作或尝试。原结果保持不变，任务再次终态才删除远程记录。

<a id="auxiliary-states"></a>

## 辅助状态与派生事实

| 对象                        | 枚举/事实                              | 转换                                                                                                                       |
| --------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Instance.authState          | untested / ready / auth_blocked        | 成功认证→ready；登录401/402/429、静态token401、/api/me 账号与已记录不符（ACCOUNT_CHANGED）→auth_blocked；更新凭据→untested |
| NotificationDelivery.status | pending / sending / succeeded / failed | pending→sending→succeeded；失败有预算→pending，否则failed；重启时pending/sending→failed（PROCESS_RESTART），不补发         |

unknown 是历史终态，不派生路径阻断状态；后续 Run 按自己的扫描独立规划。当前 Run 的依赖和删除保护仍生效，详见[ADR 0004](../adr/0004-unknown-outcomes.md)。

## 典型时序

完整事件顺序见 [时序](sequences.md)，持久化字段见 [执行数据表](execution-tables.md)。

M3补充：SOURCE_CHANGED按create的提交窗口分类，不能以该Run是否执行过mkdir/delete判断。尚未提交create时skipped，已成功delete不回滚；init可能已到达而没有可靠响应时unknown；已知session的源异常按主动abort收尾。SIGTERM时未提交的pending保持原状，由下次启动统一skipped PLAN_INTERRUPTED。
