用途：记录server_copy模式统一采用OpenList复制成功语义的取舍与后果。

范围：已接受的设计决策；不表示相关实现已经完成。

# ADR 0005：统一采用OpenList复制成功语义

- 状态：accepted
- 日期：2026-10-19
- 决策者：项目维护者

## 背景

部分同存储驱动只受理后台copy，不暴露可跟踪的完成句柄；产品需求明确排除复制后校验（见[非目标](../design/requirements.md#非目标)）。

## 决策

仅适用于createMode=server_copy（见[ADR 0006](0006-create-mode.md)）：明确copy成功无task即succeeded，所有驱动一致；有task则跟踪终态。无accepted状态，不由本服务自动改用relay；需要更可控结果的用户选择默认的relay。

## 考虑的替代方案

- refresh轮询或复制后校验：需求明确排除，且增加API成本、受缓存与权限限制。
- 只允许安全驱动名单：onedrive/onedrive_app/189/azure_blob的同存储复制将不可用。
- 本服务对异步受理驱动自动改走relay：行为难以预期；用户可直接选择relay。
- accepted中间状态或后台完成检测：没有可靠的完成句柄，状态无法收敛。

## 后果

- 收益：所有驱动语义统一、实现简单、无额外校验成本。
- 已接受风险：后台失败在该Run内不可见；extras可能已删除；通知和历史不追溯。
- 不提供的保证：后续Run只能检测缺失或大小差异，不保证自动修复。

## 落地规范

详见[OpenList集成](../design/openlist-integration.md)与[驱动兼容](../reference/driver-compatibility.md)；默认值以[配置](../reference/configuration.md)为准。
