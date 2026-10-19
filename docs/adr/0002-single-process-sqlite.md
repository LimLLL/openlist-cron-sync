用途：记录单进程SQLite的取舍与后果。

范围：已接受的设计决策；不表示相关实现已经完成。

# ADR 0002：单进程SQLite

- 状态：accepted
- 日期：2026-10-19
- 决策者：项目维护者

## 背景

自托管MVP需要低部署成本、持久运行记录；没有多副本或分布式调度要求。

## 决策

Drizzle0.45+固定better-sqlite3，WAL、FULL、foreign_keys；一个进程管理一个数据目录，迁移完成后启动调度。

## 考虑的替代方案

PostgreSQL/Redis队列、分布式锁增加部署和运维负担；node:sqlite不作为MVP依赖基线。

## 后果

- 收益：部署只需一个容器和一个本地数据卷；运行记录与配置在同一事务边界内，互斥和配额可在进程内实现。
- 代价：同步数据库调用需短批事务；不支持多副本共享WAL。
- 不提供的保证：没有高可用或水平扩展；DB/key故障fail-fast，备份必须一致。

## 落地规范

详见[数据模型](../design/data-model.md)与[部署](../design/deployment.md)；默认值以[配置](../reference/configuration.md)为准。
