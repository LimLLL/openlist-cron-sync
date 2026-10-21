用途：规定所有替换和镜像删除的保护条件、阈值公式及依赖阻断行为。

范围：固定业务规则，非可插拔gate；文件和空目录的删除均适用。

# 删除保护

删除指用单名称 remove 移除目标当前路径上的对象。替换旧文件（replace）和镜像多余项（extra）都属于删除，适用本文全部规则。本服务不保留被删除的旧版本，因此下列保护都是硬性条件。

## 固定禁止条件

| 条件                                                | 影响                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| source根list失败                                    | Run failed，不执行计划                                             |
| 扫描期资源超限                                      | Run failed，不执行计划（见[状态机](state-machines.md#run-status)） |
| 任一source子树读取不完整（含超过SCAN_MAX_DEPTH）    | 所有Target删除禁止，包括replace                                    |
| Target扫描不完整或根目录不可用                      | 该Target所有删除禁止                                               |
| source视图可疑（见[可疑视图](#可疑视图)）           | 可疑范围映射到所有Target的删除禁止；无法界定则全部禁止             |
| Target删除范围内视图可疑（含嵌套挂载）              | 该范围删除禁止                                                     |
| 账号/路径权限不满足                                 | 相关动作失败，不将403当缺失                                        |
| protected后代、名称/类型冲突                        | 相关路径及祖先删除禁止                                             |
| active或待重新观察的隔离涉及路径                    | 禁止写该路径及删除其祖先                                           |
| effectiveSourceEntryCount=0且allowEmptySource=false | 所有删除禁止（EMPTY_SOURCE），partial                              |
| create阶段failed/unknown/cancelled/阻断类skipped    | 该Target的extras禁止；不撤回已完成replace                          |

effectiveSourceEntryCount=通过文件过滤且大小已知、未受保护的文件数，加syncEmptyDirs=true时允许的源子目录数（不计endpoint根本身）。不用未过滤根列表非空替代此值；空根不能因为syncEmptyDirs=true被算成非空。
allowEmptySource只允许成功完整但有效集合为空，不能覆盖读取失败、权限错误或可疑视图。conflict不当作有效空源授权。
各码的记录方式与影响范围以[原因码分类](state-machines.md#code-classification)为准。

## 扫描阻断的计划表示

比较时已知的过滤、碰撞、类型冲突、未知大小及保护子树不生成变更Operation；局部可疑范围只不生成replace与delete，其中已列出的源文件仍按新建规划（见[可疑视图](#可疑视图)）。其余已识别的delete候选照常分批持久化，不能因为较早发现一个全局阻断就省略后续候选。
全部扫描后，source子树不完整、Target不完整/根不可用、EMPTY_SOURCE、实例级MOUNT_BOUNDARY_UNKNOWN、PLAN_INVALID使相应Target全部delete及依赖create标skipped DELETE_BLOCKED。仅extras被扫描问题阻断时，对该Target的extra删除候选使用同一码；其他合法replace不因此阻断。具体原因保留在blockReasons和scan_issues，DELETE_BLOCKED不另写scan_issue。
planned计数与D/R保留全部已识别候选，不随skipped减少；实例级挂载不可信等全局保护不通过清零D/R表达，局部可疑或已保护条目仍不计入D。结果不依赖遍历顺序。DELETE_LIMIT仍表示数值阈值拒绝，不借用DEPENDENCY_FAILED或PLAN_INTERRUPTED表示扫描保护。

## 文件阈值

**受管理目标文件**：来自完整、非可疑视图、大小已知的目标非目录条目，不受保护，并且满足以下之一：

1. 与一个通过Job过滤、大小已知的源文件同名（只按源侧过滤判断，不看目标文件自己的大小是否通过过滤）；
2. 目标单侧条目，自身路径与大小通过过滤（存在大小条件时大小必须已知）。

对每Target独立计算：

- `D` = 受管理目标文件数（不含目录）。
- `R` = plannedReplaceCount + plannedExtraCount；每个计划删除的路径都必须属于D的集合，每个路径最多计一次，因此恒有R≤D。
- 数量超限：`R > maxDeleteCount`。
- 比例超限：`100 × R > maxDeletePercent × D`，用安全整数/BigInt临时运算避免浮点舍入。
- D=0且R=0：比例0。若出现R>D（只能是实现缺陷），记录scan_issue PLAN_INVALID，该Target全部删除及依赖create skipped DELETE_BLOCKED，Run partial，并按缺陷记录错误日志；不可人工覆盖。
- 等于上限允许。例：D=10、R=5、percent=50允许；R=6拒绝。
- limits.enabled=false：不检查count/percent。单字段NULL只禁用该项，enabled=true时至少一项非NULL。
- confirmDeletes=true只对本次Run的所有Target跳过count/percent，不修改Job保存值。
- 删除预算 budget 的定义与 retry_cleanup 的余量规则见[执行数据表](execution-tables.md#run_targets)。

阈值失败：该Target全部delete及其依赖create标skipped DELETE_LIMIT；纯新建可以继续，Run partial。禁止先执行部分删除到上限再停止。
整目录不是“一次删除”；MVP按文件与空目录执行。空目录删除数量单列，不参与R/D，但完整性、隔离、空源保护仍适用。

## 执行时复查

scan refresh开关只控制通常扫描。delete前、delete确认、隔离到期或释放后的观察，以及写操作返回错误后的观察，必须refresh=true；403/500/超限/可疑视图都不能解释为空。
create提交前不另行刷新目标父目录：overwrite=false由OpenList按其目录缓存检查，本服务的扫描刷新与delete确认刷新都会更新该缓存；只有绕过OpenList的外部写入才可能使检查漏判，属于目标独占前提之外的已接受风险。
delete前刷新目标父目录可发现大小/类型变化；变化就跳过（PRECONDITION_CHANGED），不把后来对象按旧计划删除。刷新读取失败、403、视图可疑或父目录无法确认时，按读取重试规则重试后仍无法确认则不提交：delete skipped PRECONDITION_UNVERIFIED，依赖create skipped DEPENDENCY_FAILED，阻断该Target的extras。同大小外部变化无法识别，目标独占为前提。
新发现extra不加入本轮删除计划；等待下一轮重新计算。原extra消失则skipped PRECONDITION_ALREADY_ABSENT，不算异常也不重复累计删除成功。
delete确认刷新后原名称仍存在：有界等待后failed DELETE_NOT_EFFECTIVE，依赖create不提交，也绝不改用overwrite=true。确认重试受DELETE_CONFIRM_TIMEOUT_SECONDS及Run/恢复剩余期限共同约束。PRECONDITION_CHANGED只用于删除提交前复查发现的变化；create遇上游403按[完成分类](openlist-integration.md#完成分类)记failed，不按message细分原因。

## 挂载边界

管理员读取完整storage/list，规范化账号basePath后的全局路径，用最长路径段匹配得到storage id。有效挂载路径按OpenList规则在mount_path中最后一次出现“.balance”处截断（不是只看后缀）；同一有效挂载有多个候选时，视为不能证明唯一storage，禁止涉及的删除。
禁用存储不作为可写候选；其挂载边界仍当保护范围，不能退回父storage操作。失败/未初始化候选同样不作为可写storage。已判为protect_subtree的范围不再下探，不能因其中另有可用挂载而重新开放；独立旁支仍按自己的完整视图比较。
范围包含嵌套挂载时，只保护该范围及危险祖先；可证明独立的其他文件允许处理。

## 可疑视图

OpenList 在某目录下挂有其他 storage 时，底层列表失败会被吞掉，只返回挂载点目录（code 仍为 200）。因此删除前必须判断视图是否可疑：

| 账号模式 | 判定                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 管理员   | 按挂载边界映射，若某个被列出的目录严格位于某个 storage 挂载路径之上（即它是挂载点的祖先），该目录视图可疑。只影响从 endpoint 到挂载点路径上的目录，旁支目录不受影响。 |
| 管理员   | storage/list 读取失败或重读一次后仍不一致：该 Instance 的挂载边界不可信，所有目录按可疑处理（MOUNT_BOUNDARY_UNKNOWN），不退回非管理员规则。                           |
| 非管理员 | 列表条目带有 mount_details 视为检测到嵌套挂载，效果同上。没有 mount_details 不能证明没有嵌套挂载，这是文档写明的部署前提和已接受风险。                                |

可疑视图的效果：记 scan_issue SUSPECT_VIEW；该目录范围内不建立“目标目录缺失”的快速路径、不允许空源授权、不允许任何删除；新建仍可按已确认的范围执行。
非管理员缺少admin读取能力按部署前提警告，要求用户保证范围无嵌套/平衡/别名并同存储；不能把此警告记成“已验证”。管理员读取失败不能自动进入非管理员宽松路径。source列表异常被吞没的风险不能靠挂载字段完全消除。

M3文件协调器在源准备成功之后才调用替换及retry_cleanup删除。删除前仍检查全部既有保护；confirmDeletes不解除隔离、挂载、源完整性或空源保护。未知责任查询包括待删目录的后代，即使缓存列表没有显示这些路径。

server_copy替换与retry_cleanup沿用全部删除保护；在每次remove尝试前先refresh源父目录，要求原名、文件类型、已知大小与计划一致。元数据不可读或变化时不提交该delete。该前提不保证后续copy内容可读，也不是源版本锁；纯新建不增加源探测。
