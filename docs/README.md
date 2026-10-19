用途：提供 openlist-cron-sync 设计文档集的入口、阅读顺序和规范优先级。

范围：本目录描述待实现的目标行为；业务代码、依赖安装、镜像和法律文件尚未实现。

# 实施设计索引

## 阅读顺序

1. [概览](design/overview.md)：服务做什么、不做什么、核心概念，以及一次完整运行的走查。
2. [需求与保证](design/requirements.md)：范围、对外保证、部署前提和已接受风险。
3. [架构](design/architecture.md)：模块边界、依赖方向、启动和停止。
4. [状态机](design/state-machines.md)与[数据模型](design/data-model.md)。
5. [同步引擎](design/sync-engine.md)、[删除保护](design/deletion.md)、[维护与历史保留](design/retention.md)、[调度与恢复](design/scheduling-recovery.md)。
6. API 与配置：[REST API](reference/rest-api.md)、[API schemas](reference/api-schemas.md)、[配置参考](reference/configuration.md)。
7. [里程碑](development/milestones.md)与[测试策略](development/testing.md)。

所有跨文档链接均相对本文件所在目录。

## 规范优先级

文档之间出现冲突时按以下规则处理，并修正优先级较低的文件：

1. [需求与保证](design/requirements.md)和已接受的 [ADR](#决策记录) 是产品决策基线，高于其他设计文件中的实现细节，也高于[实施细化选择](development/implementation-decisions.md)。
2. 单一事实来源：状态枚举与转换只在[状态机](design/state-machines.md)中定义（[RunStatus](design/state-machines.md#run-status) / [OperationStatus](design/state-machines.md#operation-status)）；可调数值与默认值只在[配置参考](reference/configuration.md)中定义；公共 JSON 形状只在 [API schemas](reference/api-schemas.md) 中定义；新增错误码或跳过原因登记在 [REST API](reference/rest-api.md) 的原因码表，规划保护码还须同步状态机中的影响分类。其他文件只引用，不另行定义。
3. ADR 说明取舍，不另定义字段或数值。
4. [剩余工作](remaining_tasks.md)只列 MVP 发布前须完成的指南与明确延期的功能，不是扩大 MVP 需求的依据。

OpenList 行为依据 OpenList v4.2.6 系列源码（上游 main 分支 2026-09 快照，提交 5447ecb0）；行号可能随上游演进漂移。源码调查不等同于运行或驱动集成测试通过，所有驱动的初始实测状态均为未执行。MVP 发布以 M8 实际集成测试所用的固定官方镜像版本为准；更早 v4 版本仅为源码推测，不作保证。

## 设计

| 文件                                                                    | 一句话用途                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [overview.md](design/overview.md)                                       | 用通俗语言介绍 openlist-cron-sync 做什么、不做什么和核心概念，并走查一次完整运行      |
| [architecture.md](design/architecture.md)                               | 规定 NestJS 模块职责、依赖方向及单进程运行视图                                        |
| [configuration-tables.md](design/configuration-tables.md)               | 给出管理员、实例、Job、Target及通知配置的完整存储字段                                 |
| [data-model.md](design/data-model.md)                                   | 定义 SQLite/Drizzle 的公共类型、约束、事务和表关系                                    |
| [deployment.md](design/deployment.md)                                   | 规定单进程容器部署、数据持久化、升级和恢复操作                                        |
| [execution-tables.md](design/execution-tables.md)                       | 定义运行计划、操作结果、隔离及保留责任的持久化结构                                    |
| [filters-paths.md](design/filters-paths.md)                             | 定义路径、过滤、名称碰撞和类型冲突的确定性规则                                        |
| [observability-notifications.md](design/observability-notifications.md) | 定义运行统计、结构化日志和可验证的Webhook协议                                         |
| [openlist-integration.md](design/openlist-integration.md)               | 定义 OpenList client 的认证、路径、错误、任务和缓存契约，并规定变更请求结果的分类规则 |
| [relay.md](design/relay.md)                                             | 定义 createMode=relay（下载上传）的分片流水线、资源、字节规则和结果分类               |
| [requirements.md](design/requirements.md)                               | 定义 openlist-cron-sync 的实现范围、对外保证和已接受风险                              |
| [deletion.md](design/deletion.md)                                       | 规定所有替换和镜像删除的保护条件、阈值公式及依赖阻断行为                              |
| [scheduling-recovery.md](design/scheduling-recovery.md)                 | 定义触发、资源互斥、取消、重启与未知副作用隔离的行为                                  |
| [security.md](design/security.md)                                       | 规定管理员认证、秘密存储、网络出口和日志保密边界                                      |
| [sequences.md](design/sequences.md)                                     | 用事件顺序明确正常、预览、失败、中断及隔离释放的因果关系                              |
| [state-machines.md](design/state-machines.md)                           | 提供 Run、Operation 及辅助生命周期的唯一规范枚举和转换条件                            |
| [sync-engine.md](design/sync-engine.md)                                 | 定义持久化三阶段同步管线及每类输入的执行出口                                          |
| [retention.md](design/retention.md)                                     | 定义维护任务的调度，以及SQLite历史记录的保留与清理                                    |

## 参考

| 文件                                                         | 一句话用途                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| [api-execution.md](reference/api-execution.md)               | 定义Run、Operation、隔离释放与未知结果处理接口             |
| [api-schemas.md](reference/api-schemas.md)                   | 定义REST公共数据形状、字段必填性、校验与序列化规则         |
| [configuration.md](reference/configuration.md)               | 集中定义可调默认值、单位、验证范围及其理由                 |
| [driver-compatibility.md](reference/driver-compatibility.md) | 解释驱动兼容矩阵的来源、分类及产品策略                     |
| [driver-matrix.md](reference/driver-matrix.md)               | 列出 OpenList 上游驱动的 Copy、Put、Remove 语义的源码推断  |
| [import-export.md](reference/import-export.md)               | 定义脱敏配置导出和原子配置导入的可移植格式                 |
| [openlist-api.md](reference/openlist-api.md)                 | 列出MVP依赖的OpenList HTTP契约及兼容性限制                 |
| [rest-api.md](reference/rest-api.md)                         | 定义管理REST路由、HTTP状态、错误格式，并登记全部固定原因码 |

## 开发

| 文件                                                                   | 一句话用途                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------ |
| [conventions.md](development/conventions.md)                           | 规定后续实现的代码、注释、依赖和验证标准               |
| [implementation-decisions.md](development/implementation-decisions.md) | 登记在已接受的产品规则内、为实现可执行性补全的具体选择 |
| [milestones.md](development/milestones.md)                             | 把设计拆分为可执行任务与行为验收标准                   |
| [testing.md](development/testing.md)                                   | 定义实现阶段的行为测试、拓扑及文档交付验证             |

## 决策记录

| 文件                                                               | 一句话用途                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| [0001-persisted-plan.md](adr/0001-persisted-plan.md)               | 记录持久化三阶段计划的取舍与后果                            |
| [0002-single-process-sqlite.md](adr/0002-single-process-sqlite.md) | 记录单进程SQLite的取舍与后果                                |
| [0003-delete-create.md](adr/0003-delete-create.md)                 | 记录先删除再创建的替换的取舍与后果                          |
| [0004-quarantine-expiry.md](adr/0004-quarantine-expiry.md)         | 记录未知结果的限时路径隔离的取舍与后果                      |
| [0005-openlist-success.md](adr/0005-openlist-success.md)           | 记录server_copy模式统一采用OpenList复制成功语义的取舍与后果 |
| [0006-create-mode.md](adr/0006-create-mode.md)                     | 记录每个 Job 可选两种创建方式的取舍与后果                   |
| [0007-relay.md](adr/0007-relay.md)                                 | 记录分片流水线 relay 的取舍与后果                           |
| [0008-license-cla.md](adr/0008-license-cla.md)                     | 记录AGPL-3.0与CLA的取舍与后果                               |
| [0009-drop-move.md](adr/0009-drop-move.md)                         | 记录MVP移除源端move的取舍与后果                             |
| [template.md](adr/template.md)                                     | 规定新增MADR决策记录的最小结构                              |
