# openlist-cron-sync

基于 [OpenList](https://github.com/OpenListTeam/OpenList) API 的自托管定时同步服务：按计划把一个 OpenList 目录中的文件同步到一个或多个目标目录，目标可以和源在同一个 OpenList 实例上，也可以在另一个实例上。

> **开发中**：目前支持 relay 新建/替换、Mirror 清理、dry-run、取消、隔离管理和重启恢复。cron 调度、server_copy 真实执行、历史保留和通知仍待后续里程碑。进度见[开发进度](#开发进度)。

## 功能

规划中的完整功能如下，设计细节见[设计文档](docs/README.md)：

- **定时或手动同步**：按 cron 表达式定时运行，也可以手动触发。每次运行比较源目录和目标目录中文件的名称、类型和大小，新建目标缺失的文件，替换大小发生变化的文件。
- **两种目标模式**：`incremental` 只新增和替换文件；`mirror` 还会删除目标上源目录中没有的文件。
- **跨实例传输**：默认由本服务边下载边分片上传，适用于任意两个 OpenList 实例；源和目标在同一实例时，也可以改用 OpenList 自带的服务端复制。
- **删除保护**：支持 dry-run 预览、删除数量和比例阈值；扫描不完整时禁止删除；结果不明的路径会被暂时隔离，不再写入。
- **安全**：单管理员登录（JWT）；保存的 OpenList 凭据用 AES-256-GCM 加密存储。
- **管理与集成**：REST API 加 OpenAPI 文档，支持 Webhook 通知、配置导入导出和 Docker 部署。

明确不做的事：

- 不修改源目录：对源只读，没有“同步后删除源文件”的移动模式。
- 不做双向同步。
- 只比较名称、类型和大小，不比较修改时间或内容 hash。
- 暂时没有 Web 界面，后端完成后再开发。

## 开发进度

| 里程碑  | 内容                                                         | 状态   |
| ------- | ------------------------------------------------------------ | ------ |
| M0      | 基础设施：配置、数据库、管理员认证、密钥、健康检查、API 文档 | 已完成 |
| M1      | OpenList 客户端与实例管理                                    | 已完成 |
| M2      | 扫描、规划与 dry-run 预览                                    | 已实现 |
| M3a/M3b | relay新建/替换、Mirror、取消/隔离与恢复                      | 已实现 |
| M4      | cron、启停与next-fire/DST                                    | 计划中 |
| M5      | 历史记录保留                                                 | 计划中 |
| M6      | 同实例服务端复制                                             | 计划中 |
| M7      | Webhook 通知与配置导入导出                                   | 计划中 |
| M8      | Docker 镜像与正式发布                                        | 计划中 |

## 快速开始

环境要求：Node.js `^22.22.3` 或 `>=24.15.0`，pnpm 10。

```sh
pnpm install --frozen-lockfile
pnpm build
DATA_DIR=/path/to/data ADMIN_PASSWORD='your-strong-password' node dist/main.js
```

- `DATA_DIR` 必须是绝对路径，并且属于运行服务的用户。服务启动时会把它的权限收紧为 0700。
- 如果不设置 `ADMIN_PASSWORD`，首次启动会生成一个随机密码，并在 stderr 打印一次；用它首次登录后必须修改密码。
- 服务默认监听 `0.0.0.0:3000`。

启动后可以这样验证：

```sh
# 就绪检查
curl http://localhost:3000/api/v1/system/health/ready

# 登录，获取访问令牌
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your-strong-password"}'
```

在浏览器中打开 <http://localhost:3000/api/v1/docs> 可以查看 API 文档，OpenAPI JSON 位于 `/api/v1/openapi.json`。

Docker 镜像会在正式发布时提供。

## 配置

服务通过环境变量配置。以 `NODE_ENV=development` 启动时，还会读取项目根目录下的 `.env` 文件。常用变量如下；M2另读取全局运行/排队容量及[完整ExecutionSettings固定映射](docs/reference/configuration.md#executionsettings固定映射)，即使对应执行器尚未开放，这些映射字段也会在启动时校验：

| 变量                             | 默认值           | 说明                                                      |
| -------------------------------- | ---------------- | --------------------------------------------------------- |
| `HOST`                           | `0.0.0.0`        | 监听地址                                                  |
| `PORT`                           | `3000`           | 监听端口                                                  |
| `DATA_DIR`                       | `/data`          | 数据目录，必须是绝对路径                                  |
| `SPOOL_DIR`                      | `DATA_DIR/spool` | 传输时的临时缓冲目录，可以放在独立磁盘上                  |
| `LOG_LEVEL`                      | `info`           | `error`、`warn`、`info` 或 `debug`；日志为 JSON 格式      |
| `API_DOCS_ENABLED`               | `true`           | 是否提供 API 文档页面和 OpenAPI JSON                      |
| `TRUST_PROXY_HOPS`               | `0`              | 服务前面可信反向代理的层数，用于识别客户端真实 IP         |
| `ADMIN_USERNAME`                 | `admin`          | 首次初始化时的管理员用户名                                |
| `ADMIN_PASSWORD`                 | 未设置           | 首次初始化时的管理员密码，12–128 个字符；不设置则随机生成 |
| `ADMIN_JWT_TTL_SECONDS`          | `28800`          | 登录令牌的有效期，单位为秒                                |
| `LOGIN_MAX_FAILURES`             | `5`              | 一个计数窗口内允许的登录失败次数                          |
| `LOGIN_WINDOW_SECONDS`           | `900`            | 登录失败计数窗口的长度，单位为秒                          |
| `JWT_SECRET`                     | 自动生成         | 令牌签名密钥：32 字节，标准 base64 编码                   |
| `ENCRYPTION_MASTER_KEY`          | 自动生成         | 凭据加密主密钥：32 字节，标准 base64 编码                 |
| `OPENLIST_CONNECT_TIMEOUT_MS`    | `10000`          | 连接 OpenList 的建连超时，单位为毫秒                      |
| `OPENLIST_API_TIMEOUT_MS`        | `30000`          | 一次 OpenList 管理请求（含读取重试）的期限，单位为毫秒    |
| `RETRY_MAX_ATTEMPTS`             | `3`              | 读取请求遇到网络错误、5xx 或限流时的总尝试次数（含首次）  |
| `RETRY_BASE_MS` / `RETRY_MAX_MS` | `1000` / `30000` | 读取重试的指数退避基数与上限，单位为毫秒                  |
| `OPENLIST_AUTH_COOLDOWN_SECONDS` | `600`            | OpenList 登录被限流（429）后暂停登录的时长，单位为秒      |
| `OPENLIST_MAX_JSON_BYTES`        | `33554432`       | 单个 OpenList 响应允许的最大字节数                        |

- `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 只在首次启动、数据库中还没有管理员时使用；之后以数据库中保存的账号为准。
- 配置值不合法时，服务拒绝启动并报告是哪个字段，但不会打印该字段的值。
- 完整说明见[配置参考](docs/reference/configuration.md)。

## 数据与备份

| 路径                                       | 内容                                       |
| ------------------------------------------ | ------------------------------------------ |
| `DATA_DIR/app.sqlite`（及 `-wal`、`-shm`） | 配置与运行记录                             |
| `DATA_DIR/keys.json`                       | 自动生成的密钥（没有用环境变量提供时才有） |
| `SPOOL_DIR`                                | 传输时的临时缓冲                           |

- **`keys.json` 必须和数据库一起备份。** 主密钥一旦丢失，数据库中加密保存的 OpenList 凭据就无法再解密，只能重新录入。如果数据库里已有加密数据，而密钥缺失或不匹配，服务会拒绝启动，不会换一把新密钥继续运行。
- 备份时先停止服务，再整体复制数据目录（spool 目录除外）。不要在服务运行时只复制 `app.sqlite`。
- 一个数据目录同一时间只能被一个服务进程使用。
- 忘记管理员密码时，参考[安全文档](docs/design/security.md#管理员)中的离线重置步骤。

## API

所有接口都在 `/api/v1` 下。除登录、健康检查和 API 文档外，其余接口都需要请求头 `Authorization: Bearer <token>`。

| 接口                                                                   | 说明                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `POST /auth/login`                                                     | 登录，返回访问令牌                                                       |
| `GET /auth/me`                                                         | 获取当前管理员信息                                                       |
| `POST /auth/change-password`                                           | 修改密码；成功后所有旧令牌立即失效                                       |
| `GET /system/health/live`                                              | 存活检查                                                                 |
| `GET /system/health/ready`                                             | 就绪检查，未就绪时返回 503                                               |
| `POST /instances`、`GET /instances`、`GET/PATCH/DELETE /instances/:id` | 管理 OpenList 实例；凭据加密保存，接口从不返回                           |
| `POST /instances/:id/test`                                             | 连接测试：核对账号、版本（至少 4.2.5）与分片上传是否启用，不写入任何文件 |
| `POST /instances/:id/browse`                                           | 浏览实例中的目录                                                         |

还提供`/jobs` CRUD、`GET /runs`、`GET /runs/:id`及其`operations`/`issues`分页查询。预览包含替换、mirror extras和目录删除候选及阻断原因，不写远程文件；后续真实运行重新扫描。Job可保存五段cron和enabled，cron调度留在M4。

`POST /api/v1/jobs/:id/runs`默认`dryRun=false`；预览须显式传`true`。当前真实执行只支持relay，server_copy真实请求返回400 VALIDATION_ERROR，预览仍支持。`POST /runs/:id/cancel`取消运行；`GET /operations`支持`unresolved`过滤；`POST /operations/:id/quarantine-release`提前释放隔离，`POST /operations/:id/resolve`以abandoned结束责任。释放/放弃不证明远端旧请求已停止。

连续登录失败会被限流：默认 15 分钟内失败 5 次后，接口返回 429 并带上 `Retry-After` 响应头。完整接口规范见 [REST API](docs/reference/rest-api.md)。

## 开发

技术栈：NestJS 12、TypeScript 6（ESM）、SQLite（better-sqlite3 + Drizzle ORM）、Vitest、oxlint。

```sh
NODE_ENV=development pnpm run start:dev   # 开发模式：监听文件变化，读取 .env
pnpm run lint                              # 代码检查
pnpm exec tsc --noEmit --incremental false -p tsconfig.json   # 类型检查（含测试代码）
pnpm test                                  # 单元测试
pnpm test:e2e                              # 端到端测试
pnpm test:integration                      # 真实 OpenList 集成测试，需要 OPENLIST_IT_* 环境变量
pnpm build                                 # 构建
node test/compiled-smoke.mjs               # 构建产物冒烟测试，需先 build
pnpm run db:generate                       # 修改数据库 schema 后生成迁移（自动先 build）
```

表定义分在多个文件中，NodeNext 要求它们以 `.js` 相对引用；drizzle-kit 0.31 直接加载 TS 源文件时无法解析这类引用（[上游 issue #2705](https://github.com/drizzle-team/drizzle-orm/issues/2705)），因此 `drizzle.config.ts` 读取编译后的 `dist/database/schema.js`，`db:generate` 脚本先执行 `nest build` 保证产物最新。数据库迁移由 drizzle-kit 生成到 `drizzle/` 目录，服务启动时会自动应用，生成的文件不要手工修改。部署时需要一起带上 `dist/`、生产依赖和整个 `drizzle/` 目录。

真实集成测试沿用维护者准备的实例，额外要求`OPENLIST_IT_SECOND_LOCAL_PATH`、`OPENLIST_IT_PEER_BASE_URL`、`OPENLIST_IT_PEER_ADMIN_TOKEN`、`OPENLIST_IT_PEER_LOCAL_PATH`；只在测试自有UUID目录内写入及清理，不创建容器。变量缺失会在收集前失败。

开发约定和测试策略见[开发约定](docs/development/conventions.md)与[测试策略](docs/development/testing.md)。

## 文档

完整的设计文档（中文）见 [docs/README.md](docs/README.md)，建议从[概览](docs/design/overview.md)开始读。

## 许可证

项目计划以 AGPL-3.0 开源，并要求贡献者签署 CLA。许可证文件会在首个正式版本发布前加入（见 [ADR 0008](docs/adr/0008-license-cla.md)），目前仓库还没有附带许可证文件。
