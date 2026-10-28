用途：定义维护任务的调度，以及SQLite历史记录的保留与清理。

范围：仅本服务的本地记录与server_copy的远程任务记录；不管理目标上的任何文件。

# 维护与历史保留

## 维护调度

进程启动完成后30秒执行一次维护周期，此后每小时一次；每天UTC03:00另外执行本地历史清理。不补跑错过的维护时刻。
每小时周期只处理 server_copy 遗留的远程任务记录，维护请求不受扫描间隔约束。先 info：非终态则继续占用 Target 的 concurrentFiles，不删除任务；终态则按现有 RETRY_* 预算删除任务记录；404 或有界观察/删除失败则结束本地跟踪并释放额度，失败记录日志。原 Operation 的 unknown 不延长这一责任。

远程终态变回非终态只更新原行并记录日志，不新增操作。维护器不修改目标文件，文件删除仅发生在 Run 中。见[任务跟踪](openlist-integration.md#任务跟踪)。

## SQLite历史

默认保留终态 Run 及 operations 30 天，依据 endedAt；dry-run 同样适用。每页选择约100个候选Run；整组资格确认后按有界子记录批次提交并让出事件循环，不以Run数界定事务工作量。
承担[未决责任](data-model.md#responsibility)的记录所在的整组 Run 不清理；此外仍被组外后续 Run/Operation 引用的组也跳过。
删除前沿 retry_of 双向扩展引用闭包，只选择全部Run超期且无责任的组，破坏性工作前重新核验。按有界事务删除dependencies、scan_issues及operations；先清除组内 retry 引用，删除依赖后再删除操作。run_targets随后、runs最后删除。已过期组可能暂时呈现部分历史，崩溃后下次周期继续；不建立持久删除账本。FK RESTRICT失败仅回滚当前批次、记录并跳过该组本轮剩余工作，其他SQL错误fail-fast。foreign_keys始终开启。delivery清理及system/info统计随M7接入。
同一次关联链只要仍有活动 Run 或待删除远程任务记录就保留；单纯 unknown 历史按普通保留期删除，不会永久保留。旧 REMOTE_TASK_CHANGED 行同样适用。
M7接入notification_deliveries后，关联Run投递随Run清理，test投递保留30天；当前不创建占位表或清理路径。终态后立即清除投递的 URL 与 secret 副本。Run终态事务清除其路径密码副本；后续 Run 使用自己的快照。
不自动 VACUUM 大型数据库，不添加磁盘对账服务。磁盘满或 SQL 写失败停止新远程写入并 fail-fast。relay 的 spool 不属于历史记录，规则见 [Relay](relay.md#spool)。

小时远程维护与每日历史清理共用一个串行runner，不重叠。小时调度不是一小时内完成每行的保证：配额、读取重试、历史批次与停机均可能延迟。
