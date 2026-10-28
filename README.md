<div align="center">
  <a href="https://github.com/LimLLL/openlist-cron-sync">
    <img height="64" alt="openlist-cron-sync" src="./web/public/logo.svg"/>
  </a>
  <p><em>Openlist-Cron-Sync是一个适用于OpenList v4.2.5+的自动化同步工具。</em></p>
  <div>
    <a href="https://github.com/LimLLL/openlist-cron-sync/blob/main/LICENSE">
      <img src="https://img.shields.io/github/license/LimLLL/openlist-cron-sync" alt="License" />
    </a>
    <a href="https://nestjs.com/">
      <img src="https://img.shields.io/badge/backend-nestjs-e0234e.svg" alt="NestJS" />
    </a>
    <a href="https://react.dev/">
      <img src="https://img.shields.io/badge/frontend-react-61dafb.svg" alt="React" />
    </a>
    <a href="https://github.com/LimLLL/openlist-cron-sync/releases">
      <img src="https://img.shields.io/github/release/LimLLL/openlist-cron-sync" alt="latest version" />
    </a>
    <a href="https://github.com/LimLLL/openlist-cron-sync/pkgs/container/openlist-cron-sync">
      <img src="https://img.shields.io/badge/image-ghcr.io-2496ed?logo=docker&logoColor=white" alt="GHCR" />
    </a>
  </div>
</div>

---

基于 [OpenList](https://github.com/OpenListTeam/OpenList) API 的自托管定时同步服务：按计划把一个 OpenList 目录中的文件同步到一个或多个目标目录，目标可以和源在同一个 OpenList 实例上，也可以在另一个实例上。

> Webhook 通知和配置导入导出尚未提供，计划在首个版本发布后实现。进度见[开发进度](#开发进度)。

## 功能

功能如下，设计细节见[设计文档](docs/README.md)：

- **定时或手动同步**：按 cron 表达式定时运行，也可以手动触发。每次运行比较源目录和目标目录中文件的名称、类型和大小，新建目标缺失的文件，替换大小发生变化的文件。
- **两种目标模式**：`incremental` 只新增和替换文件；`mirror` 还会删除目标上源目录中没有的文件。
- **跨实例传输**：默认由本服务边下载边分片上传，适用于任意两个 OpenList 实例；源和目标在同一实例时，也可以改用 OpenList 自带的服务端复制。
- **删除保护**：支持 dry-run 预览、删除数量和比例阈值；扫描不完整时禁止删除；本轮结果未知时不重试，后续运行按自己的扫描独立规划。
- **安全**：单管理员登录（JWT）；保存的 OpenList 凭据用 AES-256-GCM 加密存储。
- **管理与集成**：REST API 加 OpenAPI 文档，提供 Docker 镜像。Webhook 通知和配置导入导出计划中。
- **Web 控制台**：高信息密度的运维界面，浅色与深色主题默认跟随系统。概览集中显示运行中、需要处理（按最近一次正式运行判断，试运行不计）、即将运行和最近运行；任务列表直接显示上次正式运行结果、下次定时并可在行内运行；运行详情显示实时计数及操作、问题、目标明细；实例页提供连接测试、目录浏览，并可按实例排查文件操作。支持中文和英文界面。

明确不做的事：

- 不修改源目录：对源只读，没有“同步后删除源文件”的移动模式。
- 不做双向同步。
- 只比较名称、类型和大小，不比较修改时间或内容 hash。

## 开发进度

| 里程碑  | 内容                                                         | 状态             |
| ------- | ------------------------------------------------------------ | ---------------- |
| M0      | 基础设施：配置、数据库、管理员认证、密钥、健康检查、API 文档 | 已完成           |
| M1      | OpenList 客户端与实例管理                                    | 已完成           |
| M2      | 扫描、规划与 dry-run 预览                                    | 已实现           |
| M3a/M3b | relay新建/替换、Mirror、取消、未知历史与恢复                 | 已实现           |
| M4      | cron、启停与next-fire/DST                                    | 已实现           |
| M5      | 历史记录保留                                                 | 已实现           |
| M6      | 同实例服务端复制                                             | 已实现           |
| M7      | Webhook 通知与配置导入导出                                   | 计划中（发布后） |
| M8      | Docker 镜像与正式发布                                        | 已实现           |

## 快速开始

### Docker

镜像发布在 `ghcr.io/limlll/openlist-cron-sync`，支持 amd64 和 arm64。使用仓库中的 [docker-compose.yaml](docker-compose.yaml)：

```sh
docker compose up -d
docker compose logs openlist-cron-sync   # 未设置 ADMIN_PASSWORD 时，在日志中查看随机初始密码
```

- 数据保存在 `/data` 卷中，容器以 uid 1000 运行。使用宿主机目录挂载时，先把目录属主改为 1000。
- 一个数据目录只能给一个容器使用，不要多副本运行。
- 容器内的 `localhost` 指容器自身；OpenList 地址要填容器能访问到的地址。

首次部署、添加实例和建立任务的完整步骤见[用户指南](docs/README.md#用户指南)，从[首次部署与管理员初始化](docs/guides/getting-started.md)开始。

### 从源码运行

环境要求：Node.js `^22.22.3` 或 `>=24.15.0`，pnpm 10。

```sh
pnpm install --frozen-lockfile
pnpm build:all
DATA_DIR=/path/to/data ADMIN_PASSWORD='your-strong-password' node dist/main.js
```

- `DATA_DIR` 必须是绝对路径，并且属于运行服务的用户。服务启动时会把它的权限收紧为 0700。
- 如果不设置 `ADMIN_PASSWORD`，首次启动会生成一个随机密码，并在 stderr 打印一次；用它首次登录后必须修改密码。
- 服务默认监听 `0.0.0.0:3000`。
- Web 控制台与 API 共用端口，在 <http://localhost:3000/> 打开。登录后 JWT 保存在浏览器 localStorage 中，刷新页面仍保持登录，直到令牌过期或主动退出；改密会撤销所有旧会话。界面语言首次按浏览器语言选择（中文或英文），主题默认跟随系统深浅色；两者都可在左下角账户菜单中切换，切换后会被记住。

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

## 配置

服务通过环境变量配置。以 `NODE_ENV=development` 启动时，还会读取项目根目录下的 `.env` 文件。常用变量如下；此外还读取全局运行/排队容量、spool 资源参数及[完整ExecutionSettings固定映射](docs/reference/configuration.md#executionsettings固定映射)，全部在启动时校验：

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
| `OPENLIST_API_TIMEOUT_MS`        | `30000`          | 普通请求单次尝试的期限（毫秒），含连接与完整响应          |
| `RETRY_MAX_ATTEMPTS`             | `3`              | 失败时的总尝试次数（含首次）；任务可单独设置              |
| `RETRY_BASE_MS` / `RETRY_MAX_MS` | `1000` / `30000` | 读取重试的指数退避基数与上限，单位为毫秒                  |
| `OPENLIST_AUTH_COOLDOWN_SECONDS` | `600`            | OpenList 登录被限流（429）后暂停登录的时长，单位为秒      |
| `OPENLIST_MAX_JSON_BYTES`        | `33554432`       | 单个 OpenList 响应允许的最大字节数                        |
| `RUN_RETENTION_DAYS`             | `30`             | 已结束运行记录的保留天数，1–3650                          |

- `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 只在首次启动、数据库中还没有管理员时使用；之后以数据库中保存的账号为准。
- 配置值不合法时，服务拒绝启动并报告是哪个字段，但不会打印该字段的值。
- Instance 上没有 API 并发或速率设置，实例 API 配额队列已删除；目录扫描与同步 mkdir/remove 仍按扫描间隔 FIFO 排队。Job 的 `sourceDownloadConcurrency` 控制所有 Target 共享的下载阶段文件数，验证 EOF 后立即释放，spool 背压及 Range 恢复暂停仍计入；每个 Target 的 `concurrentFiles` 控制从准备到上传、等待 complete 和收尾的文件数或未结束的 server-copy 任务数，`chunkConcurrency` 控制单文件分片请求数；建目录和删除多余文件也按 `concurrentFiles` 并发。Job 的 `sourceScanIntervalSeconds` 和每个 Target 的 `scanIntervalSeconds`（0–3600 整数秒，默认 0）分别约束源树扫描，以及目标目录扫描、建目录和 delete 请求；单项验证与观察不受间隔约束。同一 Instance ID 下，拼接账号根路径后的全局路径首段相同，就共享上次开始时间；每次请求使用本端配置的间隔，从开始到开始计时，0 不增加间隔但仍遵守 FIFO，见[扫描间隔](docs/design/scheduling-recovery.md#扫描间隔)。源下载和同时文件数填 `0` 表示不限；单文件分片并发为 1–8；不同 Job 同时运行时额度相加。server-copy 的 `0` 可能一次提交大量任务；relay 的 `0` 可积累大量已下载但尚在等待 complete 的文件，其源位虽已释放，目标会话和请求仍会占用资源。
- 任务可设置“失败后的重试次数”（0–9），留空时使用 `RETRY_MAX_ATTEMPTS`；运行开始时固定有效次数，退避间隔仍由全局配置决定。
- 普通 API 每次尝试从调用 HTTP 客户端前计时，含建连、协议协商和完整响应，不含扫描间隔、认证等待或退避；完整说明见[配置参考](docs/reference/configuration.md)。

## 数据与备份

| 路径                                       | 内容                                       |
| ------------------------------------------ | ------------------------------------------ |
| `DATA_DIR/app.sqlite`（及 `-wal`、`-shm`） | 配置与运行记录                             |
| `DATA_DIR/keys.json`                       | 自动生成的密钥（没有用环境变量提供时才有） |
| `SPOOL_DIR`                                | 传输时的临时缓冲                           |

- **`keys.json` 必须和数据库一起备份。** 主密钥一旦丢失，数据库中加密保存的 OpenList 凭据就无法再解密，只能重新录入。如果数据库里已有加密数据，而密钥缺失或不匹配，服务会拒绝启动，不会换一把新密钥继续运行。
- 备份时先停止服务，再整体复制数据目录（spool 目录除外）。不要在服务运行时只复制 `app.sqlite`。完整步骤见[备份、恢复和升级](docs/guides/backup-restore-upgrade.md)。
- 一个数据目录同一时间只能被一个服务进程使用。
- 运行记录（含 dry-run）在结束后默认保留 30 天，每天 UTC 03:00 自动删除过期部分；仍有未处理的 unknown 或仍在跟踪 OpenList 远程任务的记录会继续保留。清理只删数据库行，不碰 OpenList 上的文件，也不会自动 VACUUM 收缩数据库文件。
- 忘记管理员密码时，按[首次部署指南](docs/guides/getting-started.md#忘记管理员密码)中的步骤离线重置。

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

还提供`/jobs` CRUD、`GET /runs`、`GET /runs/:id`及其`operations`/`issues`分页查询。预览包含替换、mirror extras和目录删除候选及阻断原因，不写远程文件；后续真实运行重新扫描。

Job保存五段cron（IANA时区，默认UTC）后，`POST /jobs/:id/enable`启用定时、`POST /jobs/:id/disable`停用；两者运行期间也可调用，不影响已开始的运行，停用后仍可手动运行。`GET /jobs/:id/next-fire-times?count=5`返回接下来的触发时间（UTC，附Job时区），很稀疏的表达式可能少于count。迟到的定时只补跑一次，服务停机期间错过的不补跑。

`POST /api/v1/jobs/:id/runs`默认`dryRun=false`；预览须显式传`true`。真实执行按各Target的`createMode`新建文件：`relay`（默认）由本服务下载再分片上传；`server_copy`调用OpenList服务端复制并逐个跟踪其后台任务，要求选择server_copy的目标与源使用同一Instance ID。`POST /runs/:id/cancel`取消运行；`GET /operations?status=unknown`查询未知历史。后续 Run 不因历史结果按路径跳过；未结束的已知 copy task 仍占用 Target 并发额度。取消/abort 不保证云端动作已经停止，后续扫描也无法发现同大小内容错误或自动修复类型冲突，见[未知结果与迟到副作用](docs/adr/0004-unknown-outcomes.md)。

连续登录失败会被限流：默认 15 分钟内失败 5 次后，接口返回 429 并带上 `Retry-After` 响应头。完整接口规范见 [REST API](docs/reference/rest-api.md)。

## 开发

技术栈：NestJS 12、TypeScript 6（ESM）、SQLite（better-sqlite3 + Drizzle ORM）、Vitest、oxlint；`web/` 为 pnpm workspace 成员，使用 React 19、Vite 6、Tailwind CSS 4、Radix UI、TanStack Query 和 react-i18next。

```sh
NODE_ENV=development pnpm run start:dev   # 开发模式：监听文件变化，读取 .env
pnpm dev:web                              # 另一终端启动 Vite，按根目录 PORT 代理 /api/v1
pnpm run lint                              # 代码检查
pnpm exec tsc --noEmit --incremental false -p tsconfig.json   # 类型检查（含测试代码）
pnpm test                                  # 单元测试
pnpm test:e2e                              # 端到端测试
pnpm --filter web test                     # 前端请求与认证契约测试
pnpm --filter web lint                     # 前端代码检查
pnpm test:integration                      # 真实 OpenList 集成测试，需要 OPENLIST_IT_* 环境变量
pnpm build                                 # 构建
pnpm build:web                             # 前端类型检查与构建，输出 web/dist/
pnpm build:all                             # 同时构建后端和前端
node test/compiled-smoke.mjs               # 构建产物冒烟测试，需先 build
pnpm run db:generate                       # 修改数据库 schema 后生成迁移（自动先 build）
```

表定义分在多个文件中，NodeNext 要求它们以 `.js` 相对引用；drizzle-kit 0.31 直接加载 TS 源文件时无法解析这类引用（[上游 issue #2705](https://github.com/drizzle-team/drizzle-orm/issues/2705)），因此 `drizzle.config.ts` 读取编译后的 `dist/database/schema.js`，`db:generate` 脚本先执行 `nest build` 保证产物最新。数据库迁移由 drizzle-kit 生成到 `drizzle/` 目录，服务启动时会自动应用，结构 SQL 与元数据由工具生成；需要保留既有数据的重构在新的前向迁移中补充数据转换与校验，已应用的迁移及其元数据不可修改。部署时需要一起带上 `dist/`、`web/dist/`、生产依赖和整个 `drizzle/` 目录。

`test:e2e` 自动构建前端后验证 API 和 SPA 托管。仅运行后端开发服务时不要求已有前端产物；Vite 单独提供页面。生产通过 `@nestjs/serve-static` 在根路径提供 SPA，`/api` 和缺失资源不进入 HTML 回退。浏览器环境变量是公开构建内容，不得放入管理员密码或实例凭据。

Vite 开发代理从仓库根目录的 `.env`（及 Vite 当前模式对应的环境文件）读取端口，优先级为 `VITE_API_PORT`、`PORT`、默认 `3000`；同名变量以启动进程中已导出的值优先。例如根目录配置 `PORT=39123` 时直接运行 `pnpm dev:web` 即可；也可以用 `VITE_API_PORT=40123 pnpm dev:web` 单独指定代理目标端口。修改环境文件后需重启 Vite。此配置只读取代理所需的端口，不把后端环境目录设为浏览器环境目录。

真实集成测试沿用维护者准备的实例，额外要求`OPENLIST_IT_SECOND_LOCAL_PATH`、`OPENLIST_IT_PEER_BASE_URL`、`OPENLIST_IT_PEER_ADMIN_TOKEN`、`OPENLIST_IT_PEER_LOCAL_PATH`；只在测试自有UUID目录内写入及清理，不创建容器。变量缺失会在收集前失败。

开发约定和测试策略见[开发约定](docs/development/conventions.md)与[测试策略](docs/development/testing.md)。

## 文档

[用户指南](docs/README.md#用户指南)说明部署、配置和日常操作步骤；完整的设计文档（中文）见 [docs/README.md](docs/README.md)，建议从[概览](docs/design/overview.md)开始读。

## 许可证

[AGPL-3.0-only](LICENSE)。提交贡献即表示同意以同一许可证授权，不需要另签 CLA（见 [ADR 0008](docs/adr/0008-license-cla.md)）。
