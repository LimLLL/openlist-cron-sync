用途：定义持久化三阶段同步管线及每类输入的执行出口。

范围：两种Target模式与两种创建方式；不包含源端move、内容校验或原子提交。

# 同步引擎

## 创建方式

Target.createMode决定该目标新建文件的方式；默认relay，逐目标写入Run接受时的固定配置快照。同一Run允许混合relay和server_copy，规划器从Run Target快照生成各create Operation的method，执行与恢复按Operation分派。

| createMode    | 新建文件                                                                                                   | 适用范围                                |
| ------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| relay（默认） | 本服务从源下载、经本地spool用目标OpenList的分片上传写入，见[Relay](relay.md)                               | 任意实例关系，包括同实例同storage       |
| server_copy   | 调用OpenList `/api/fs/copy`（overwrite=false），同storage由驱动复制，跨storage由OpenList自己的传输任务执行 | 该Target必须与source使用同一Instance ID |

某个server_copy Target与source的Instance ID不同时，完整合并配置的校验直接拒绝并定位到该Target的createMode字段；相同URL的不同Instance ID也不满足条件。不静默切换，也没有跨实例的隐式fallback。relay只对该Target检查multipart能力，检查时机仍为启用Job及接受Run（包括dry-run）。OpenList后台任务只会出现在server_copy中，其跟踪、取消、清理与恢复见[OpenList集成](openlist-integration.md#任务跟踪)；“OpenList报告成功即成功”的政策见[ADR 0005](../adr/0005-openlist-success.md)。
两种方式的删除一律是单名称`/api/fs/remove`。

## 阶段一：Scan + Plan

1. 检查Instance认证、endpoint根、路径重叠与已知挂载边界。取run_config固定值。
2. source根目录读取失败则Run failed（SOURCE_ROOT_UNAVAILABLE）。Target根目录按下方“Target根目录”规则处理，不使Run失败。
3. source按目录单次遍历；每目录先列source，再依次列各Target对应目录。持有当前目录原始名称集合、受保护集合及递归帧中的待访问兄弟，不物化全树。
4. 应用[过滤与冲突](filters-paths.md)。按Target生成具体mkdir/create/delete，分批写SQLite（seq按计划顺序递增）。
5. Target缺失目录沿该分支省略后续列表；仍生成父mkdir依赖。已存在父目录时，其list失败不能当成缺失；只有成功且非可疑的父列表中缺名，才建立缺失快速路径。
6. Target独有目录需要递归枚举，才能计算文件阈值和保护后代；未知目录不可整体删除。
7. 记录每Target扫描总数、分子/分母及scan_issues。所有计划写完后同事务标记scanCompletedAt、planned。

OpenList先取得全目录再分页；per_page=0减少不一致翻页，仍受单目录响应/条目上限。扫描期超限终止计划，不执行部分计划；超过SCAN_MAX_DEPTH的子树按读取不完整处理。M2的DFS递归帧保留尚未访问的兄弟目录及各Target状态，内存上界为O(Target数×活动递归路径各层保留的列表数据大小之和＋批量记录大小＋实例挂载映射大小)，而不是O(单个最大目录＋深度)。扫描立即丢弃下载sign，只保留规划事实；目录原始响应另受JSON字节上限限制；不声称端到端流式列举，不建立跨Run目录索引。

### Target根目录

| 观察                                                                                                | 结果                                                                                                 |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 根目录列表成功                                                                                      | 正常比较                                                                                             |
| 根目录列表失败（非权限错误），其父目录（账号命名空间内，refresh=false）列表完整、非可疑且根名不存在 | 根目录缺失：dry-run计划prepare mkdir和全部create并报告TARGET_ROOT_WILL_BE_CREATED；实跑先执行该mkdir |
| 父目录列表失败/可疑、权限错误，或父列表仍有根名（文件或目录）                                       | 该Target记TARGET_ROOT_UNAVAILABLE：本轮无新建无删除，Run partial                                     |

根缺失时，仅在有待创建文件/目录时才计划根prepare mkdir并报告TARGET_ROOT_WILL_BE_CREATED。syncEmptyDirs=true把根自身作为需要创建的目录；false且没有待create文件时不生成根mkdir或提示。此规则不把endpoint根计入effectiveSourceEntryCount。

账号根“/”按已有根处理：其列表失败时没有可向上查询的账号内父目录，记TARGET_ROOT_UNAVAILABLE，不递归向账号base_path之外探测。OpenList mkdir对已存在目录幂等。
实跑的prepare mkdir成功后，refresh=true列出新根，确认完整且非可疑才开放该Target的子操作；失败则记录TARGET_ROOT_UNAVAILABLE并跳过所有依赖动作。新根本轮不产生删除。dry-run不执行这次创建后的读取。

## 行为矩阵

| source             | Target             | incremental                                  | mirror          |
| ------------------ | ------------------ | -------------------------------------------- | --------------- |
| 文件，大小已知     | 缺失               | create                                       | create          |
| 文件               | 同名同类型同大小   | unchanged                                    | unchanged       |
| 文件               | 同名同类型大小不同 | delete→create                                | delete→create   |
| 文件               | 同名文件但大小未知 | TARGET_UNKNOWN_SIZE，保护不替换              | 同左            |
| 目录               | 文件；或反向       | conflict/保护                                | conflict/保护   |
| 缺失且视图完整     | 受管理文件         | 保留                                         | delete-extra    |
| 缺失               | 大小未知的单侧文件 | 保留                                         | 保护，不是extra |
| 被过滤/冲突/不可读 | 对应目标           | 保护                                         | 保护，不当extra |
| 文件大小未知       | 任意               | UNKNOWN_SIZE，跳过                           | 同左            |
| 目录               | 缺失               | 按[空目录规则](filters-paths.md#空目录)mkdir | 同左            |
| source根读取失败   | 任意               | failed，无执行                               | 同左            |
| source子树失败     | 任意               | 可执行已确认的新建；全部删除禁止             | 同左，partial   |
| Target子树失败     | 任意               | 该Target删除禁止；其他已知新建可执行         | 同左            |

未知大小在所有传输方式都跳过，避免server_copy fallback暗中把未知大小交给Put。无法可靠预判symlink，下载长度异常按relay失败记录。

## 阶段二：Safety

先运行[删除规则](deletion.md)，再执行任何远程文件写入。该检查不是通用规则引擎，只是固定业务条件。
dryRun=true停止于此：不mkdir、copy、put、multipart、remove，不释放隔离。允许认证、list及按配置refresh，写本地预览记录。
dry-run显示planned动作、blocked原因、预算及受保护项；不是可随后批准执行的不可变远程快照。手动实跑重新扫描；不存在execute-preview API或审批签名。

## 阶段三：Execute

1. 为确定的新建和替换准备必要父目录（含缺失的Target根目录）；mkdir失败阻断子操作，不扩展远程扫描范围。
2. 按Target执行文件create及delete→create依赖链。同一目标路径串行，不对目录调用批量copy。
3. 每个远程请求只提交一个name。relay按[relay结果分类](relay.md#结果分类)判定；server_copy明确成功且无task直接计成功，有task则逐id跟踪；mkdir、remove和copy返回错误时按[写操作结果分类](openlist-integration.md#完成分类)处理。
4. Target全部创建/替换阶段达到成功条件且没有failed/unknown/cancelled/阻断类skipped，才开放extras。
5. extras按文件删除；syncEmptyDirs=true时，目标单侧的空目录在其extras删除后自底向上清理，根始终保留。
6. 聚合Run终态，创建通知投递；释放本轮执行位，保留未决Operation隔离。

一个Target失败不取消其他Target。Run总超时或用户取消停止全部新派发。资源瞬时失败按重试预算处理；认证阻断不持续重试。

## 替换链

替换只发生在同名同类型、大小不同的文件上：先remove旧文件，确认消失后再create新文件。旧文件删除后本服务不保留副本；create失败时目标暂时缺少该文件，下一次Run按源重新创建。

| 步骤                    | 成功                                                  | 失败/边界                                                                                                                        |
| ----------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| relay准备源             | 打开源GET并写入首块（见[Relay](relay.md#单文件流程)） | 源不可用→create failed，旧文件不动                                                                                               |
| 重新读取目标父目录      | 原文件类型/大小符合计划，继续                         | 已改变→PRECONDITION_CHANGED；已缺失→跳过删除，转当前观察的新建；读取失败/403/可疑/父目录无法确认→PRECONDITION_UNVERIFIED，不提交 |
| 删除预算及路径检查      | 通过，进入提交                                        | 阈值/隔离/挂载/过滤拒绝→删除及create skipped                                                                                     |
| 提交remove              | 明确返回，进入确认                                    | 执行前拒绝→failed；JSON 500→一次观察后决定；无响应→unknown，create skipped                                                       |
| refresh确认原名称消失   | delete succeeded，开放create                          | 仍在：有界等待后failed DELETE_NOT_EFFECTIVE；无法确认→unknown                                                                    |
| create，overwrite=false | relay完成/无task成功/任务成功                         | 明确失败可有界重试；请求未知则隔离；不回滚                                                                                       |

刷新后原文件已缺失时，对应delete标skipped PRECONDITION_ALREADY_ABSENT，作为正常前提变化不阻断依赖create，执行器显式重连依赖。
纯新建server_copy不额外列出源目录；替换和retry_cleanup的每次删除前，先refresh=true读取source父目录并核对原名、文件类型及计划大小。缺失/变化使create skipped SOURCE_CHANGED，读取失败/可疑视图使源准备失败，伴随delete不提交。该元数据前提不锁定后续内容，也不能证明驱动能读完整文件。relay额外依据下载响应（长度不符为SIZE_MISMATCH，见[relay结果分类](relay.md#结果分类)）和/d 401后的重新list（名称/类型/大小变化为SOURCE_CHANGED并跳过本次create）；server_copy以OpenList执行时的源内容为准。不存在源版本锁。
create重试发现部分目标文件：先刷新并确认原远程动作已结束；生成retry_cleanup删除动作（remove），再重新检查预算余量，然后新create。禁止overwrite重试。已成功的delete不会因create重试而再次提交。
同一目标路径的已计划替换重试仍按一个逻辑文件计数，清理字节另报actualDeletedBytes；超出预算余量的retry_cleanup及其create在提交前skipped DELETE_LIMIT。

## 统计

Stats定义见[API schemas](../reference/api-schemas.md)。planned计数在planned后固定；实际动作和重试bytes分别累计，不能用成功HTTP数推算文件数。
unchanged是扫描事实，不逐个持久化Operation。扫描错误保留scan_issues，不能只剩总计。
同大小数据错误、上游成功后实际失败和迟到操作是已接受限制；见[需求](requirements.md#已接受风险)。

## M3执行细化

M3a/M3b作为一个变更实现relay、替换、Mirror和Run生命周期。server_copy与relay共用文件依赖、预算及隔离工作流。执行器查询当前pending集合，按依赖选择准备动作；不能只向前扫描seq，因为重试可能使更早的下游重新就绪。替换和retry_cleanup的delete只能由文件协调器在relay源首块准备或server_copy源元数据前提成立后调用，不能独立派发。父mkdir失败会阻断子操作；新根mkdir成功后的刷新失败保留mkdir成功，并记TARGET_ROOT_UNAVAILABLE。

每个Target的创建阶段包含延迟重试和retry_cleanup。阶段之间保持mkdir → create → file extras → directory extras的屏障；同一阶段内执行器增量补派：任一Operation结束即补位，派发时复查依赖。读取按seq向后翻页并在内存中跳过已认领的逻辑动作（含其重试行），补位开销不随在途数量增长；mkdir结束可能放行seq更早的子目录，因此从头重扫，在途清空后再从头确认没有遗留pending。同时派发数取用户配额：mkdir、create与文件extras均使用Target concurrentFiles，目录extras在各Target内串行；0表示不限。批量读取只限制一次读取的内存，不限制执行并发。relay每Target最多一个首次源准入未完成的协调器；取得源位及首块空间后先记录准入状态再唤醒派发器，允许继续补派，EOF归还源位；等待complete的文件不再堵住后续下载。准入不移除claimed或inFlight，只有完整协调器收尾释放Target派发容量；其重试退避期间不持源位，仍由同一协调器重新排队。取消时撤销等待并收敛全部已启动工作，不遍历全部在途Promise来等待任一完成。取消、deadline、shutdown或本地失败会停止新的查询并等待已开始工作收敛。最后attempt收敛后重算extras_blocked，再执行文件extras；目录extras按计划后序逐个刷新为空再删除。目录成功不计入deletedAsExtra等文件计数，其结果从Operations查询。PRECONDITION_ALREADY_ABSENT是正常收敛；只有这类跳过而无异常时Run仍可succeeded。

活动Run的headline执行统计通过单条SQL聚合读取：按每个Target和`coalesce(retry_of,id)`取最后attempt，字节累计所有attempt，retryAttempts单独累计；原因按首次seq和原因码稳定排序。扫描阶段显示PlanWriter已刷新的值及scan_issues，终态继续使用持久化聚合。这个查询不会把100k操作拉入应用内存。

重试不修改旧终态，retryOf始终指向根。重连仅替换同一逻辑依赖顶点的attempt，不引入反向逻辑边；因此无环性不依赖重试行seq小于下游。一次额外create attempt最多建立一个cleanup根，cleanup只重试自身，不递归建立cleanup。初始R预算不回收，cleanup根累计使用budget−R余量，其重试不重复计额。
