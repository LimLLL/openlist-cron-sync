用途：规定单进程容器部署、数据持久化、升级和恢复操作。

范围：目标部署和运维流程；Dockerfile与部署示例已在M8交付。

# 部署

## 镜像与进程

镜像固定为node:22.23.3-bookworm-slim，与本地开发和测试所用Node版本一致；本地开发最低Node 22.22.3。package.json的engines为`^22.22.3 || >=24.15.0`，与Nest CLI依赖链（@angular-devkit/core）声明的支持范围一致。Dockerfile只在一处声明精确镜像版本，不使用浮动标签；升级Node时先在本地新版本上通过全部测试，再同步修改镜像版本。
构建和运行采用相同libc（Debian bookworm glibc）。better-sqlite3固定版本，随包附带各平台（含Linux glibc/musl的x64与arm64）预编译二进制，运行时按架构选择，因此多架构镜像的编译与依赖安装可在构建机原生架构完成；新增带原生或分平台二进制的生产依赖时须重新评估。禁止将macOS node_modules拷入Linux。
多阶段镜像最终仅含dist、生产依赖和发行版迁移目录（drizzle/下的SQL与meta/_journal.json，缺journal时migrator无法运行）；drizzle-kit为dev依赖，启动调用ORM migrator，不执行generate/push。
容器非root，uid/gid建议1000，工作目录/app，数据/data；管理员自行预建卷并设置权限。应用不以root递归chown宿主目录；启动时只把数据目录与spool目录自身收紧为0700，因此卷须由运行用户拥有，否则启动失败。
启动命令显式node dist/main.js。一个数据目录只运行一个应用进程，不开PM2 cluster或Kubernetes多副本；这是部署前提，不新增自造文件锁。

## 数据目录

| 路径                        | 内容                                   |
| --------------------------- | -------------------------------------- |
| /data/app.sqlite            | 配置、运行、操作、通知结果             |
| /data/app.sqlite-wal / -shm | SQLite运行期文件，不能单独当备份       |
| /data/keys.json             | 未使用环境密钥时的JWT/master key，0600 |
| /data/spool                 | relay按1 MiB块暂存的下载数据，重启清空 |

spool默认位于DATA_DIR下，可用SPOOL_DIR放到独立卷；默认可用全部剩余空间，并在同卷时为SQLite保留SPOOL_RESERVE_BYTES，规则见[Relay](relay.md#spool)。OpenList自身的分片接收窗口和部分驱动也会使用其TempDir，需独立配置容量；与OpenList同机部署时一并估算。
日志输出stdout/stderr，由容器平台轮转；不在/data再建无限日志文件。

## 网络与代理

管理端口默认3000，生产经可信TLS反向代理；仅按真实拓扑设置TRUST_PROXY_HOPS。私网OpenList地址必须从容器内部可达，localhost指容器自身。
目标OpenList前的代理允许单个chunk大小的请求body（默认10MiB）及足够的read/send timeout，complete可能长时间等待驱动结果；source /d重定向到的地址也必须可达。下载UA/IP绑定、/p代理权限错误按实例限制排查。
管理API body限1MiB，import例外10MiB，不把它套到向OpenList发出的relay上传。
health/live只判断进程存活；ready在迁移/恢复责任重建后成功，shutdown开始即失败。实例离线不会使整个服务ready永久失败。

## 启动和升级

启动顺序见[架构](architecture.md)。迁移失败不启动调度，保留错误并退出。表重建时仅启动迁移连接在事务外临时关闭外键；重建与数据转换在同一迁移事务内完成，外键违规会中止并回滚。恢复foreign_keys=ON并通过完整性检查后才继续启动；见[数据模型](data-model.md#持久性与清理)。
升级前禁用触发并等待运行结束，备份DB+keys，停止旧进程，再启动携带已审核迁移的新镜像。不可同时运行新旧实例。
停止进程（SIGTERM）时，仍在运行的Run不会被写成终态，也不会取消已提交的OpenList任务；下次启动按[关机与恢复规则](state-machines.md#shutdown)收尾为interrupted。因此计划内重启前应先等待Run结束。
回滚版本前确认其支持现有schema；不支持时恢复成套备份，不能只换旧镜像硬读新schema。发布记录迁移版本和最低可读版本。
许可证为AGPL-3.0-only，不设CLA，见[许可证ADR](../adr/0008-license-cla.md)。

## 备份

MVP提供最简单的停机一致备份流程：

1. 通过POST /jobs/:id/disable禁用每个Job并记录原本启用的Job，取消或等待运行结束，确认没有queued Run；查看 unknown 历史及待删除的远程任务记录。这样备份里的Job都是禁用状态。
2. 正常停止进程，确认没有另一个进程使用/data。
3. 整体复制/data（包括仍存在的SQLite sidecar文件，spool目录除外）到受保护备份位置；环境提供的两种key另行安全保存。
4. 记录应用版本、schema版本、OpenList地址及备份时间；加密备份介质并限制权限。
5. 启动原实例，确认ready和调度配置。

不支持运行中仅cp app.sqlite的备份建议；不为MVP新增在线备份API。配置export没有secret和执行责任，不能替代此备份。

## 恢复

停止服务，恢复成套DB+匹配keys到空数据目录，使用兼容schema的镜像。按上面流程制作的备份中Job已全部禁用，启动后不会自动运行；若备份不是按该流程制作，启动前先用网络隔离阻止本服务访问OpenList，启动后立即禁用所有Job。检查恢复记录和凭据，确认后再逐个启用。
从旧备份恢复会回退本地Operation/unknown事实，但远端文件不会回退；这是备份时点限制。不得立刻对含退回历史的目标自动删除，管理员需先运行dry-run并处理未决路径，再启用Job。
密钥规则见[配置](../reference/configuration.md#密钥优先级)：master key缺失且数据库已有密文时启动失败，不能生成新key尝试运行；key不匹配以KEY_MISMATCH启动失败；JWT key丢失只会重新生成并使现有会话失效；master key丢失则已保存的凭据无法恢复，只能重新录入。管理员密码遗忘的离线重置见[安全](security.md#管理员)。
恢复指南须包含手动更新凭据和unknown处理，列为MVP待完成用户指南而非post-MVP功能。

## 资源

建议初始容器内存512MiB以上（scrypt并发2约256MiB加应用/目录列表），磁盘按操作数量和保留周期估算。目录上限不是容量承诺，超限运行失败而非OOM后继续部分删除。
集成测试使用已发布OpenList镜像和临时卷，严格与生产数据隔离。
