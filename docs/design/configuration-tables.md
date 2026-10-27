用途：给出管理员、实例、Job、Target及通知配置的完整存储字段。

范围：字段记号和通用时间/FK规则继承[数据模型](data-model.md)；API命名采用camelCase。

# 配置表

## admins

| 字段                    | 类型       | 默认/约束               |
| ----------------------- | ---------- | ----------------------- |
| id                      | INTEGER PK | CHECK(id=1)，仅单管理员 |
| username                | STR        | UNIQUE，1–64字符        |
| password_hash           | STR        | scrypt封装，含参数及盐  |
| token_version           | INT        | 1；改密增加，JWT需匹配  |
| must_change_password    | BOOL       | 首次随机密码为1，否则0  |
| created_at / updated_at | TS         | 通用                    |

## instances

| 字段                                 | 类型         | 默认/约束                                                    |
| ------------------------------------ | ------------ | ------------------------------------------------------------ |
| id / name                            | ID / STR     | name长度1–100                                                |
| base_url                             | STR          | http(s)，规范化；无userinfo/query/fragment，允许子路径       |
| auth_mode                            | ENUM         | token / password                                             |
| username                             | STR?         | password时必填，token时NULL                                  |
| secret_enc                           | ENC?         | token或原始密码；脱敏导入可NULL                              |
| auth_state                           | ENUM         | untested，见状态机                                           |
| auth_block_reason                    | STR?         | 登录码、ACCOUNT_CHANGED或缺凭据原因                          |
| auth_blocked_until                   | TS?          | 仅429自动冷却；401/402为NULL且需人工更新                     |
| account_username                     | STR?         | /api/me返回的用户名（两种认证模式都记录）                    |
| account_base_path                    | STR?         | /api/me成功后写入；未连接时NULL                              |
| account_role                         | INTEGER?     | OpenList role原值                                            |
| account_permissions                  | INT?         | /api/me位图                                                  |
| download_mode                        | ENUM         | d / p，默认d                                                 |
| last_test_at                         | TS?          | 最近连接测试                                                 |
| openlist_version / multipart_enabled | STR? / BOOL? | 最近一次连接测试从/api/public/settings读到的值；未测试为NULL |
| last_error_code / last_error_message | STR?         | 脱敏，不存原始响应                                           |
| archived_at                          | TS?          | 归档时间                                                     |
| created_at / updated_at              | TS           | 通用                                                         |

索引：(archived_at,created_at,id)。base_url不设唯一：不同账号可访问同实例，规范化地址相同的Instance按“accountBasePath+path”的全局路径参与路径重叠、占用与隔离比较，见[调度与恢复](scheduling-recovery.md#资源层级)。
每次/api/me成功时比较account_username与account_base_path：实例没有[未决责任](data-model.md#responsibility)时以新值覆盖；有未决责任且任一值不同时不覆盖旧值，置auth_blocked（ACCOUNT_CHANGED），规则见[OpenList集成](openlist-integration.md#认证与实例身份)。

M1 已实现本表，并将 `secret_enc` 登记到生产 ENC 清单；AAD 为 `instances:<id>:secret_enc:v1`。M2起身份更新和DELETE执行真实责任检查，DELETE另检查非归档Job引用，通过后归档并清空该列；实现边界见[认证实现边界](openlist-integration.md#m1-实现边界)。

## jobs

| 字段                            | 类型            | 默认/约束                                                   |
| ------------------------------- | --------------- | ----------------------------------------------------------- |
| id / name                       | ID / STR        | name 1–100                                                  |
| enabled                         | BOOL            | 0                                                           |
| source_instance_id              | ID FK instances | 不允许归档Instance                                          |
| source_path                     | STR             | 规范化账号相对绝对形式，如 /照片                            |
| source_password_enc             | ENC?            | 路径密码                                                    |
| source_refresh                  | BOOL            | 0                                                           |
| source_download_concurrency     | INT             | 2；0不限，Job各Target共享的下载中文件数，EOF即释放          |
| source_scan_interval_seconds    | INT             | 0；0–3600整数秒，源列目录请求开始的最小间隔                 |
| cron                            | STR?            | NULL=仅手动；5段，分钟精度                                  |
| timezone                        | STR             | UTC，IANA名                                                 |
| include_globs_json              | JSON            | []                                                          |
| exclude_globs_json              | JSON            | []                                                          |
| min_size_bytes / max_size_bytes | INT?            | NULL=无该边界；min≤max                                      |
| allow_empty_source              | BOOL            | 0                                                           |
| sync_empty_dirs                 | BOOL            | 0                                                           |
| relay_bandwidth_limit           | INT             | 0=不限；单位bytes/s，聚合该Job所有relay Target的上传payload |
| timeout_seconds                 | INT             | 86400                                                       |
| archived_at                     | TS?             | 归档时间                                                    |
| created_at / updated_at         | TS              | 通用                                                        |

索引：(enabled,archived_at)、(source_instance_id)。同Job targets不能含源或彼此重叠，见[过滤与路径](filters-paths.md)。

## job_targets

| 字段                    | 类型            | 默认/约束                                                                           |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------- |
| id                      | ID              | 稳定id，修改列表不能复用旧id                                                        |
| job_id                  | ID FK jobs      | RESTRICT                                                                            |
| instance_id             | ID FK instances | RESTRICT                                                                            |
| path / password_enc     | STR / ENC?      | 目标根及路径密码                                                                    |
| position                | INT             | 从0开始；同Job成员唯一                                                              |
| mode                    | ENUM            | incremental / mirror；默认incremental                                               |
| create_mode             | ENUM            | relay / server_copy，默认relay；仅该目标生效，见[创建方式](sync-engine.md#创建方式) |
| concurrent_files        | INT             | 2；0不限；relay为在途文件数，server_copy为未终态任务数；也约束mkdir与文件extras     |
| scan_interval_seconds   | INT             | 0；0–3600整数秒，该Target列目录、mkdir、remove请求开始的最小间隔                    |
| chunk_concurrency       | INT             | 2；1–8；单个relay文件的chunk请求数                                                  |
| refresh                 | BOOL            | 0                                                                                   |
| delete_limits_enabled   | BOOL            | 1                                                                                   |
| max_delete_count        | INT?            | 1000；NULL禁用数量一项                                                              |
| max_delete_percent      | INTEGER?        | 50，整数0–100；NULL禁用比例一项                                                     |
| archived_at             | TS?             | 被配置更新移出成员集合的时间                                                        |
| created_at / updated_at | TS              | 通用                                                                                |

CHECK(delete_limits_enabled=0 OR max_delete_count IS NOT NULL OR max_delete_percent IS NOT NULL)。部分UNIQUE(job_id,position) WHERE archived_at IS NULL（同Job成员position唯一）；索引(instance_id,archived_at)。路径唯一/包含在应用事务中检查。
成员关系：Target属于其Job且archived_at为NULL。archived_at只记录被PATCH或导入update移出目标集合，Job归档时不写入；归档Job的JobView.targets即其最终成员集合。archived_at为NULL只说明是成员，能否运行、导出、修改或构成活动引用还要求父Job未归档；移出的id不再复用。

## notification_channels

| 字段                    | 类型     | 默认/约束                                                          |
| ----------------------- | -------- | ------------------------------------------------------------------ |
| id / name               | ID / STR | name 1–100                                                         |
| type                    | ENUM     | webhook（唯一MVP值）                                               |
| url_enc                 | ENC?     | 完整URL按秘密加密（推送服务常把key放在路径里）；导入缺失可NULL     |
| url_origin              | STR      | scheme://host[:port]，仅供展示和导出                               |
| needs_url_review        | BOOL     | 0；导入时URL被截短则为1，PATCH提供url后清零                        |
| secret_enc              | ENC?     | 至少32随机字节；导入缺失可NULL                                     |
| enabled                 | BOOL     | 0；缺url_enc/secret或needs_url_review=1时不能启用                  |
| events_json             | JSON     | 默认全部三个事件；[run.succeeded,run.partial,run.failed]的非空子集 |
| archived_at             | TS?      | 归档                                                               |
| created_at / updated_at | TS       | 通用                                                               |

索引：(archived_at,enabled)。job_notification_channels：job_id FK jobs、channel_id FK notification_channels，复合PK(job_id,channel_id)，删除关联CASCADE只用于最终物理清理。
修改channel不影响已经创建的delivery（URL与secret在投递创建时各自加密固定）。删除channel不取消已接受的本次有限投递。日志与API永不输出URL的路径和query。

## 归档与凭据删除

Instance被活动Job引用时DELETE返回409；存在引用它的[未决责任](data-model.md#responsibility)时也409。否则归档并清空secret_enc，历史只留地址和名称。
Job DELETE要求无非终态Run，只归档Job本身并停止cron：最终成员集合原样保留，随父Job一起失效，不另写Target的archived_at；保留未决unknown与远程任务清理所需的路径与凭据引用。
Channel DELETE逻辑归档并清空当前url_enc与secret_enc；已有delivery使用自己的短期加密副本直至终态清除。
