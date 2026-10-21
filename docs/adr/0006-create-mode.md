用途：记录每个 Target 独立选择创建方式的取舍与后果。

范围：已接受的设计决策；不表示相关实现已经完成。

# ADR 0006：两种创建方式，默认 relay

- 状态：accepted
- 日期：2026-10-19
- 决策者：项目维护者

## 背景

OpenList 的 fs/copy 在同 storage 内很快，但会产生后台任务：任务默认不持久化，异步受理驱动只报告受理，各驱动 copy 行为也不一致。本服务自己下载上传则只用同步接口，结果更可控，代价是流量和时间。

## 决策

- Target.createMode = relay | server_copy，默认 relay；每个 Target 显式选择，同一 Job/Run 可以混合两种方式。
- relay 适用于任意实例关系，规则见 [ADR 0007](0007-relay.md)。
- server_copy 要求该 Target 与 source 使用同一 Instance ID，否则配置校验拒绝，不做隐式 fallback。
- OpenList 后台任务的跟踪、取消、清理和重启恢复只在 server_copy 中存在；成功语义见 [ADR 0005](0005-openlist-success.md)。

## 考虑的替代方案

- 只做 relay：同盘复制无法利用服务端复制。
- 只做 server_copy：跨实例无法同步，异步受理驱动的后台失败不可见。
- 整个 Job 共用一种创建方式：同实例与跨实例目标混合时，同实例目标也被迫使用 relay，或用户必须拆分 Job。
- 按 Target 自动选择：隐藏用户意图，实例关系变化可能悄悄改变传输行为；仍要求显式选择，不自动切换或 fallback。

## 后果

- 收益：默认路径没有 OpenList 后台任务；需要服务端复制的用户仍可显式选择。
- 代价：维护两条创建路径以及混合 Target 的配置、规划、执行和恢复测试。
- Run 接受时固定每个 Target 的创建方式；规划将其写入各 create Operation 的 method。删除始终 remove，relay 带宽仍是 Job 所有 relay Target 的聚合上传上限。
- 已接受风险：server_copy 继承 ADR 0005 的已接受风险。

## 落地规范

详见[同步引擎](../design/sync-engine.md#创建方式)。
