用途：定义运行计划、操作结果、隔离及保留责任的持久化结构。

范围：继承[数据模型](data-model.md)的类型和NOT NULL规则；全部状态取自[状态机](state-machines.md)。

# 执行数据表

## runs

| 字段                                                     | 类型            | 约束/含义                                              |
| -------------------------------------------------------- | --------------- | ------------------------------------------------------ |
| id / job_id                                              | ID / ID FK jobs | 稳定关联                                               |
| trigger                                                  | ENUM            | manual / cron                                          |
| scheduled_at                                             | TS?             | cron理论触发点；manual为NULL                           |
| dry_run / confirm_deletes                                | BOOL            | 接受请求时固定                                         |
| status                                                   | ENUM RunStatus  | queued                                                 |
| run_config_json                                          | JSON            | snapshotVersion=1，见数据模型                          |
| secret_snapshot_enc                                      | ENC?            | 本轮路径密码，Run终态事务清除                          |
| stats_json                                               | JSON            | Stats，默认各项0                                       |
| stop_reason                                              | STR?            | USER_CANCEL / RUN_TIMEOUT / PROCESS_RESTART            |
| error_code / error_message                               | STR?            | 脱敏；如 QUEUE_TIMEOUT、SOURCE_ROOT_UNAVAILABLE        |
| created_at / updated_at                                  | TS              | 通用                                                   |
| queue_deadline_at                                        | TS              | createdAt+queueTimeout                                 |
| started_at / scan_completed_at / ended_at                | TS?             | 对应转换写入                                           |
| deadline_at / cancel_requested_at / recovery_deadline_at | TS?             | 执行、取消、恢复时钟；recovery只在首次进入recovering写 |

部分UNIQUE(job_id) WHERE status IN ('queued','scanning','planned','executing','cancelling','recovering')。索引(created_at DESC,id DESC)、(job_id,created_at DESC,id DESC)、(status,created_at,id)。

## run_targets

| 字段                                        | 类型                          | 约束/含义                                               |
| ------------------------------------------- | ----------------------------- | ------------------------------------------------------- |
| id / run_id / target_id                     | ID / FK runs / FK job_targets | UNIQUE(run_id,target_id)                                |
| target_snapshot_json                        | JSON                          | Target配置及Instance身份的本轮副本                      |
| stats_json                                  | JSON                          | Stats                                                   |
| source_complete / target_complete           | BOOL                          | 0；扫描结束后确定                                       |
| suspect / delete_blocked / extras_blocked   | BOOL                          | 0；按下文分别维护扫描保护与执行阶段判定                 |
| block_reasons_json                          | JSON                          | []，公开errorCode集合                                   |
| observed_target_file_count                  | INT                           | 0，阈值分母D                                            |
| planned_replace_count / planned_extra_count | INT                           | 0，分子R的组成                                          |
| delete_budget_count                         | INT?                          | 有效删除预算；扫描全目标阻断为0，NULL仅表示数值阈值不限 |

索引(run_id)。没有额外Target状态枚举，公开summary按Run聚合规则计算。
suspect与扫描产生的delete_blocked在本Run内只从0变1；delete_blocked表示该Target全部删除禁止，局部保护以scan_issues.path/protect_subtree表示，不能因此置位该全局标志。suspect仅表示存在可疑范围，不能据此扩大为全部路径禁止。extras_blocked在创建阶段结束、重试预算收敛后，按scan_issues的原因码分类与各逻辑动作最后attempt重算；不能因一次可重试失败永久置1。block_reasons_json只保留当前有效阻断码，不纳入纯提示/警告；失败历史仍保存在原Operation中。
扫描全目标删除阻断（含PLAN_INVALID）时delete_budget_count=0，优先于阈值禁用或confirmDeletes；候选R仍保留。其余情况删除预算在保护检查后固定：limits启用且未被confirmDeletes覆盖时，budget=min(maxCount, ⌊maxPercent×D/100⌋)（为NULL的一项视为无穷大）；只有R≤budget时该Target的删除才能执行。已计划的R预先占用预算；计划外的retry_cleanup只能使用budget−R的余量，超出时该清理及其依赖create在提交前skipped（DELETE_LIMIT）。阈值公式见[删除保护](deletion.md#文件阈值)。NULL只表示数量/比例不限，不是删除许可；局部保护、extras_blocked与其他安全条件始终有效。

## operations

| 字段                                               | 类型                     | 约束/含义                                                                     |
| -------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| id                                                 | ID                       | 唯一逻辑尝试                                                                  |
| run_id / run_target_id                             | FK runs / FK run_targets | 所属Run；维护器新增的REMOTE_TASK_CHANGED记录引用原Run及Target，不改变其终态   |
| seq                                                | INT                      | 本Run内计划顺序，从1递增；维护新增的Operation取该Run下一个值                  |
| action                                             | ENUM                     | mkdir / create / delete                                                       |
| method                                             | ENUM                     | mkdir / server_copy / relay / remove                                          |
| reason                                             | ENUM                     | prepare / new / replace / extra / retry_cleanup                               |
| status                                             | ENUM OperationStatus     | pending                                                                       |
| source_instance_id / source_path                   | ID? FK instances / STR?  | create才指Job source；其他为NULL                                              |
| target_instance_id / target_path                   | FK instances / STR       | 实际目标路径                                                                  |
| is_dir                                             | BOOL                     | 目录动作                                                                      |
| expected_source_size / expected_target_size        | INT?                     | 文件前提；目录NULL                                                            |
| expected_source_modified                           | STR?                     | 原样RFC3339，仅用于Last-Modified尽力传递                                      |
| affected_file_count / affected_bytes               | INT                      | 文件动作为1及文件大小；mkdir和已确认空目录删除为0/0                           |
| retry_of                                           | ID? FK operations        | 首次尝试id；同run、同动作，所有后续attempt指同一个根                          |
| caused_by_operation_id                             | ID? FK operations        | REMOTE_TASK_CHANGED新建unknown时指向原记录                                    |
| attempt_no                                         | INT                      | 初始1；最大见配置                                                             |
| openlist_task_id                                   | STR?                     | 仅server_copy的copy task id                                                   |
| remote_state                                       | INTEGER?                 | 原始tache值，非本地enum；仅server_copy                                        |
| remote_cleanup_pending                             | BOOL                     | 0；有tid的本地终态持久化后置1，先确认远程终态再清理；无tid恒为0               |
| bytes_downloaded / bytes_transferred               | INT                      | 0；本次尝试的下载字节与已上传字节（relay含chunk重传）                         |
| multipart_upload_id / multipart_chunk_size         | STR? / INT?              | 仅relay；收到有效init响应后、发送任何chunk前写入                              |
| multipart_state / multipart_attempt                | STR? / INTEGER?          | 最近一次观察到的OpenList session原始state与attempt（远端从0开始），非本地enum |
| source_stream_completed_at                         | TS?                      | 仅relay；源正常EOF且字节数等于size后、发布最后一个chunk前写入                 |
| error_code / error_message                         | STR?                     | 原因码（见[分类](state-machines.md#code-classification)）及脱敏摘要           |
| created_at / updated_at                            | TS                       | 通用                                                                          |
| submitted_at / ended_at / next_attempt_at          | TS?                      | 尝试时钟                                                                      |
| unknown_since / unknown_until                      | TS?                      | status=unknown时必填，until≥since                                             |
| quarantine_released_at / quarantine_release_reason | TS? / STR?               | 提前释放事实（abandon也写入），不是结果                                       |
| reobserved_at / reobserved_by_run_id               | TS? / ID? FK runs        | 释放/到期后首次完成refresh重新观察的Run                                       |
| resolution_kind                                    | ENUM?                    | observed / superseded / abandoned                                             |
| resolution_note                                    | STR?                     | abandoned时必填的管理员原因；重复请求不覆盖                                   |
| resolved_at / resolved_by_run_id                   | TS? / ID? FK runs        | 后续事实，绝不改unknown结果                                                   |

action/method合法组合：mkdir/mkdir，create/server_copy或relay，delete/remove。应用校验及SQL CHECK共同约束。openlist_task_id与remote_state只允许method=server_copy非NULL；multipart_*与source_stream_completed_at只允许method=relay非NULL。
UNIQUE(run_id,seq)；UNIQUE(target_instance_id,openlist_task_id) WHERE openlist_task_id IS NOT NULL；UNIQUE(target_instance_id,multipart_upload_id) WHERE multipart_upload_id IS NOT NULL。
索引(run_target_id,status,seq)、(status,next_attempt_at)、(target_instance_id,target_path)、(status,unknown_until)、(remote_cleanup_pending,id)。保留清理另有retry_of、(caused_by_operation_id,seq)、(resolved_by_run_id,id)、(reobserved_by_run_id,id)，及run_id上的未决责任/引用稀疏索引；Runs有(ended_at,id)。
相同路径不同尝试不加全局唯一约束；路径占用在应用调度器统一管理。

## operation_dependencies

operation_id FK operations、depends_on_id FK operations，复合PK，CHECK不同id。二者必须属于同一Run，插入时拒绝环。
仅父mkdir及对应delete是必要依赖；extras阶段用run_target.extras_blocked及创建阶段完成条件，不构造全文件两两依赖。
重试建立新依赖引用；原failed结果不修改。依赖成功才ready；依赖终态非成功则skipped DEPENDENCY_FAILED。例外仅限重新观察确认原名已不存在：将delete记正常skipped PRECONDITION_ALREADY_ABSENT，在同事务移除该create对此delete的依赖，不把其他skipped一概当成功。

## scan_issues

id ID、run_id FK runs、run_target_id? FK run_targets、endpoint_role ENUM(source/target)、instance_id FK instances、path STR、code STR、message STR、protect_subtree BOOL、created_at TS。
索引(run_id,id)、(run_target_id,path)。源问题run_target_id=NULL，影响全部Target。同run同endpoint/path/code应用去重，不逐个文件重复写相同子树错误。code取值及影响见[原因码分类](state-machines.md#code-classification)。
记录限额见配置；超过限额终止扫描，不能截掉错误后继续删除。

## notification_deliveries

id ID、run_id? FK runs（test为NULL）、channel_id FK notification_channels、event_id STR、event_type STR、url_snapshot_enc ENC?、secret_snapshot_enc ENC?、payload_json JSON、status ENUM、attempt_count INT默认0、next_attempt_at TS?、http_status INTEGER?、error_code STR?、created_at TS、updated_at TS、ended_at TS?。
UNIQUE(event_id,channel_id)，索引(status,next_attempt_at)。attemptCount是投递次数，不是文件操作次数。终态清除url_snapshot_enc与secret_snapshot_enc；payload不含秘密。关联Run的投递随Run一起按历史保留清理；test投递（run_id为NULL）保留30天。

## 交叉约束

FK创建时允许SQLite表间前向引用；Drizzle迁移最终必须校验外键。
CHECK约束补充：Run终态须ended_at非NULL；Operation终态须ended_at非NULL；unknown须unknown_since/unknown_until非NULL；resolution_kind非NULL须resolved_at非NULL；resolution_kind='abandoned'须resolution_note非NULL。大小、计数均≥0。跨表身份一致性在仓储事务中校验，不能以DTO校验代替FK。
seq、attempt_no必须≥1；caused_by_operation_id仅在error_code=REMOTE_TASK_CHANGED时非NULL，且此类行必须引用原Operation，tid为NULL。reobserved_by_run_id写实际完成重新观察的Run。
Stats和公共JSON形状见[API schemas](../reference/api-schemas.md)。枚举、数据约束与DTO均需行为测试，不能只测试SQL字符串。

MAX_OPERATIONS_PER_RUN只限制初始计划。每个逻辑动作最多RETRY_MAX_ATTEMPTS次；每个额外create attempt最多引入一个retry_cleanup逻辑动作，该清理自身有同样的attempt上限且不生成其它清理。清理预算按逻辑动作累计预留，同一清理的重试不重复占额。
