用途：定义 openlist-cron-sync 的实现范围、对外保证和已接受风险。

范围：已接受的产品范围、保证、部署前提和风险；本文描述目标产品，实现进度以[里程碑](../development/milestones.md)为准。

# 需求与保证

## 产品范围

| 项目        | 基线                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| 形态        | 开源、backend-first、自托管 REST 服务；MVP（M0–M8）只交付 REST/OpenAPI，Web 前端在后端 MVP 完成后再实现                  |
| 来源        | 一个 Job 只有一个 source，目录可位于账号虚拟文件系统任意深度                                                             |
| 目标        | 每 Job 一个或多个 Target（上限见[配置](../reference/configuration.md)），可分布于不同 Instance                           |
| incremental | 新增、替换同名且大小变化的文件；保留目标 extras                                                                          |
| mirror      | incremental 加删除受管理的目标 extras                                                                                    |
| 比较        | 原始名称、类型、大小；同名同大小视为 unchanged，不比较时间和 hash                                                        |
| 替换        | 删除旧文件 → 刷新确认原名称消失 → create，禁止原地覆盖                                                                   |
| 删除        | 一律调用 OpenList remove；替换和 extras 共同计入删除阈值                                                                 |
| 创建方式    | 每个 Target 独立选择 relay（默认，本服务下载后经 OpenList 分片接口上传）或 server_copy（同 Instance 调用 OpenList copy） |
| 控制        | cron、手动执行、dry-run、取消、超时、重试、保守重启恢复                                                                  |
| 限制        | 同 Job 不重叠、全局执行位、Job/Target 扫描间隔、Job 源读取配额、Target 文件/分片配额、Job 聚合 relay 上传限速            |
| 管理        | 多实例、单管理员认证、凭据与 Webhook URL 静态加密、Webhook、脱敏导入导出、OpenAPI、Docker                                |

source 永不修改文件内容和目录结构：不写入或覆盖、不创建文件或目录、不改名、移动或删除。读取、OpenList 缓存刷新及管理本服务产生的远程任务不算修改源文件。源 refresh 仍可能要求 OpenList 写权限。

过滤为 Job 级，应用于源和所有目标。Target 独立配置 mode、deleteLimits、refresh。

目录结构是否同步由 Job.syncEmptyDirs 控制。true 时，每个未被排除且未受保护的源目录都会在 Target 上创建，即使其中没有可传输的文件；mirror Target 还会在 extras 删除后，自底向上删除目标独有的空目录（每个都先 refresh=true 确认为空）。false 时只创建 create 所需的父目录，本服务从不删除目标目录。include 只筛选文件，不决定目录是否创建；匹配目录的 exclude 会剪枝并保护该子树。细则见[空目录](filters-paths.md#空目录)。

## 非目标

双向同步、源端 move、常规复制后校验、内容 hash 比较、本地文件索引、跨运行源目录快照、多副本调度、分布式事务、原子替换、运行期间目标文件持续可用、保留被删除的旧版本、远程文件操作 exactly-once（重试与未知结果可能导致重复提交或残留）、自动回滚均不属于 MVP。
源端 move 的原因分析及其他延期项见[剩余工作](../remaining_tasks.md)。

## 保证及限制

1. 本服务只在已固定的运行配置和计划范围内执行；历史 Run 不随 Job 编辑改变。
2. create 设置 overwrite=false，不因重名改用覆盖或静默跳过；该预检查不是存储级 compare-and-swap。
3. 删除保护失败时不执行对应删除及依赖 create；阈值覆盖只解除 count/percent 限制。
4. 本服务不保存被删除的文件。relay 在删除旧文件前先确认源能正常出数据；create 失败时目标暂时缺少该文件，由下一次 Run 按源重新创建。
5. unknown 的历史结果不改写，同一 Run 不自动重试；后续 Run 按自己的配置和扫描独立规划。
6. succeeded 表示达到本产品定义的成功条件（relay 为分片上传 complete 成功，server_copy 为 OpenList 响应/任务成功），不代表云端持久化或内容完整性校验。
7. server_copy 无 task 的明确成功响应就是成功；有 task 时逐个跟踪到终态。OpenList 内部下载上传回退仍属于 server_copy，不是本服务 relay。
8. 完整性保护只覆盖能识别的异常，不承诺证明任何驱动的列表完整。
9. 变更请求的结果按[OpenList 集成](openlist-integration.md#完成分类)与 [relay 结果分类](relay.md#结果分类)判定：执行前的明确拒绝记 failed；OpenList 已处理但返回错误时，只做一次有界的 refresh=true 观察，观察到效果记 succeeded，观察到原状态未变记可重试的 failed，其余记 unknown；无响应、超时或连接中断后结果不明一律 unknown。
10. 重启只在恢复期限内有界跟踪已知 task 与 multipart session：scanning/planned 的 Run 直接 interrupted；executing/cancelling/recovering 的 Run 最终统一 interrupted，不续跑旧计划、不续传；queued 保留并重新入队。计划内停止（SIGTERM）同样如此：关闭期间不取消已知 OpenList task，也不写 Run 终态。见[启动恢复](scheduling-recovery.md#启动恢复)。
11. 删除范围含嵌套挂载、balance 挂载或无法确定唯一 storage，或管理员 storage/list 读取失败时，相关删除禁止，也不退回非管理员的宽松路径。见[挂载边界](deletion.md#挂载边界)。
12. source 内部的已知简单折叠名称碰撞对所有 Target 跳过并保护；Target 内部或 source 与 Target 之间的碰撞只保护该 Target。见[名称碰撞](filters-paths.md#名称碰撞)。
13. 删除前的检查与删除确认总是 refresh=true，与 Target 扫描的 refresh 设置无关。见[执行时复查](deletion.md#执行时复查)。
14. Webhook 投递是有界 best-effort：投递结果独立记录，不改变 Run.status，重启后不补发。见[通知投递](observability-notifications.md#投递)。

## 部署前提

- 一个进程拥有一个本地 /data；不共享 SQLite 给多个容器，不使用网络文件系统承载 WAL。relay 的 spool 需要本地磁盘，见 [Relay](relay.md#spool)。
- 运行期间目标只由本服务写入；外部客户端和其他服务实例不修改目标。已接受的迟到云端操作不在本服务控制内。
- 账号能读取全部受管理目录；can_see_hides、meta.read_users、目录密码、Copy/Remove/WriteContent 权限需与操作匹配。管理员也可能被 read_users 限制。
- 配置同源同目标、包含关系或已知名称别名均拒绝；跨挂载、跨地址、底层 symlink 别名无法全部识别。
- 管理员读取 storage/list 解析边界；非管理员明确提示需要自行保证可见性与无嵌套挂载。mount_details 只是风险信号。
- 不承诺跟随符号链接的一致行为。目录链接可能形成循环，文件链接可能产生 lstat 大小和下载长度不一致。
- OpenList 挂载配置在运行期间保持不变；修改后下一次运行重新取映射。
- OpenList 版本：最低 4.2.5（分片上传接口首次发布的版本）；设计依据 OpenList v4.2.6 系列源码（上游 main 分支 2026-09 快照，提交 5447ecb0），行号可能随上游演进漂移。MVP 发布以 M8 实际集成测试所用的固定官方镜像版本为准。

## 已接受风险

| 决策                                       | 必须公开的后果                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| server_copy 按 OpenList copy 成功计成功    | 后台复制未完成时 extras 可能已经删除；稍后云端失败不撤销该 Run 的成功及通知                                                                                               |
| 历史 unknown 不阻止后续路径规划            | 旧动作可能迟到覆盖或删除新状态；没有额外强制刷新义务                                                                                                                      |
| OpenList 报错后观察到原状态未变即记 failed | 原请求若仍在云端执行，可能在重试或后续计划之后迟到生效，造成同名冲突或重复结果                                                                                            |
| relay 主动中止上传记 failed                | 目标端可能迟到清理被中止的写入，删掉随后重试写入的文件；下一次 Run 会重新创建                                                                                             |
| Run 结束不等于云端动作结束                 | 异步受理的后台 copy 及旧请求，可在 Run 结束、路径占用释放后继续写目标；下一 Run 或以该目标为 source 的其他 Job 可能观察到未完成状态，进程内路径互斥与目标独占前提对此无效 |
| 先删除再创建                               | 目标有名称缺失窗口；create 失败时本服务没有保存旧版本                                                                                                                     |
| 名称＋大小、无复制后校验                   | 同大小错误内容、同大小源修改不会被发现，失败不一定靠下一轮修复                                                                                                            |
| 缓存扫描、普通账号部署前提                 | Temp 幽灵、隐藏、权限过滤和混合虚拟目录可造成不完整视图                                                                                                                   |
| 源运行中变化                               | best effort，不提供时间点快照；已取得操作响应也可能对应不同时间的源版本                                                                                                   |

后续运行只有在能观察到缺失或大小变化时才会重新规划；无后续运行、缓存未失效、同大小损坏、TYPE_CONFLICT 保护或持续失败都可能使问题长期存在。incremental 保留迟到 extras；OneDrive mkdir 可能产生改名空目录，即使 mirror 也只有在 syncEmptyDirs=true 且删除保护允许时才删除。已知历史 copy task 未结束时仍计入稳定 Target 的 concurrentFiles，可能使后续提交等待，但不按路径阻断。

## 术语与规范源

| 术语      | 定义                                                     |
| --------- | -------------------------------------------------------- |
| delete    | 用单名称 remove 删除目标当前路径上的对象（替换或 extra） |
| extra     | 源完整视图中不存在、且属于受管理范围的目标对象           |
| protected | 已观察到但禁止操作的路径，不可解释为 absent              |

其他概念及一次完整运行的走查见[概览](overview.md)。状态唯一规范见[状态机](state-machines.md)，数值唯一规范见[配置](../reference/configuration.md)，API 字段见 [API schemas](../reference/api-schemas.md)。
