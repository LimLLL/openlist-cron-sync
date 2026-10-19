用途：定义维护任务的调度，以及SQLite历史记录的保留与清理。

范围：仅本服务的本地记录与server_copy的远程任务记录；不管理目标上的任何文件。

# 维护与历史保留

## 维护调度

进程启动完成后30秒执行一次维护周期，此后每小时一次；每天UTC03:00另外执行本地历史清理。不补跑错过的维护时刻。
每小时周期只处理server_copy遗留的远程任务记录：清理已持久化终态的task（[远程任务清理](openlist-integration.md#任务跟踪)），以及轮询REMOTE_TASK_CHANGED。维护器获得API配额后执行，不阻塞用户Run。
维护器不删除、不移动目标上的任何文件；删除产生的删除只发生在Run中。

## SQLite历史

默认保留终态 Run 及 operations 30 天，依据 endedAt；dry-run 同样适用。每批删除100个 Run 及其纯历史子记录，短事务。
承担[未决责任](data-model.md#responsibility)的记录所在的整组 Run 不清理；此外仍被组外后续 Run/Operation 引用的组也跳过。
清理仅选择整条引用闭包均无责任且全部 Run 超期的组。单事务先清除组内 nullable 反向引用（operations.retry_of/caused_by_operation_id/resolved_by_run_id/reobserved_by_run_id），删除 delivery、operation_dependencies、scan_issues、operations、run_targets、runs。组外引用存在则整组跳过。外键 RESTRICT 失败回滚并记录，不关闭 foreign_keys 硬删。
同一次关联链只要仍有责任就保留；长期 unknown 会使实际历史超过30天，system/info 显示数量和最老时间。
关联 Run 的通知投递随 Run 清理；test 投递保留30天。终态后立即清除投递的 URL 与 secret 副本。确认无需远程责任后清除 Run 路径密码副本。
不自动 VACUUM 大型数据库，不添加磁盘对账服务。磁盘满或 SQL 写失败停止新远程写入并 fail-fast。relay 的 spool 不属于历史记录，规则见 [Relay](relay.md#spool)。
