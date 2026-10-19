用途：记录AGPL-3.0与CLA的取舍与后果。

范围：已接受的设计决策；不表示相关实现已经完成。

# ADR 0008：AGPL-3.0与CLA

- 状态：accepted
- 日期：2026-10-19
- 决策者：项目维护者

## 背景

项目开源，需要在发布阶段明确分发与贡献规则。

## 决策

采用AGPL-3.0+CLA；LICENSE/CLA及贡献入口在M8加入。

## 考虑的替代方案

本决策由项目维护者直接确定，未形成书面的许可证比较。scaffold中的`UNLICENSED`只是初始化占位，不视为备选政策。

## 后果

- 收益：许可证义务覆盖以网络服务形式提供的修改版（AGPL-3.0第13条）。
- 代价：运营修改版并向用户提供网络服务的一方须提供对应源码；部分组织限制使用AGPL软件；CLA增加贡献流程。
- 不提供的保证：不凭“CLA”三个字推定版权转让或再许可权；未发布法律文本前不宣称贡献者已签署。
- [REQ] SPDX表述（AGPL-3.0-only或AGPL-3.0-or-later）与CLA文本、签署方式待项目维护者在M8确认；届时同步修改package.json的license字段（当前为UNLICENSED）。

## 落地规范

发布任务见[里程碑M8](../development/milestones.md#m8-发布)；待定事项见[实施细化记录](../development/implementation-decisions.md)。
