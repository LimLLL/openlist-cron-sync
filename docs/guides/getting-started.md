用途：说明首次部署本服务、初始化管理员和保管密钥的操作步骤。

范围：Docker 与源码两种单实例部署；行为规范见[部署](../design/deployment.md)、[安全](../design/security.md)与[配置参考](../reference/configuration.md)。

# 首次部署与管理员初始化

## 部署前须知

- 服务的全部状态都在一个数据目录里（默认 `/data`）：数据库、自动生成的密钥和 relay 临时缓冲（spool）。
- 一个数据目录同一时间只能给一个服务进程使用。不要多副本运行，也不要让新旧版本同时挂载同一个数据目录。
- 建议给容器 512 MiB 以上内存。
- 生产环境建议放在可信的 TLS 反向代理之后，见[反向代理](#反向代理)。

## 用 Docker 部署

镜像为 `ghcr.io/limlll/openlist-cron-sync`，支持 amd64 和 arm64。标签有三种：版本号（如 `0.0.1`）、`主版本.次版本`（如 `0.0`）和 `latest`。`latest` 只指向正式版，不指向预发布版。生产环境建议在 compose 中写死具体版本号，升级时再手动改，方便回滚。

1. 取得仓库中的 [docker-compose.yaml](../../docker-compose.yaml)，按需修改：
   - 把 `image:` 改成具体版本，例如 `ghcr.io/limlll/openlist-cron-sync:0.0.1`；
   - 如需自己指定初始密码，取消 `environment` 的注释并设置 `ADMIN_PASSWORD`（12–128 个字符），见[首次登录与改密](#首次登录与改密)。
2. 启动并查看日志：

   ```sh
   docker compose up -d
   docker compose logs openlist-cron-sync
   ```

3. 确认就绪：

   ```sh
   curl http://localhost:3000/api/v1/system/health/ready
   # {"status":"ok","database":"ok"}
   ```

   未就绪时返回 503。镜像自带基于存活接口的健康检查，`docker compose ps` 中会显示 healthy。

### 数据卷权限

容器以 uid 1000（镜像内的 `node` 用户）运行。启动时，服务会把数据目录和 spool 目录收紧为 0700、把 `keys.json` 收紧为 0600；目录不属于运行用户时无法收紧，服务会拒绝启动。服务不会以 root 身份递归修改宿主目录的属主。

- 示例使用命名卷 `data`。新建的命名卷会继承镜像中 `/data` 的属主，不需要额外处理。
- 改用宿主机目录时，先建好目录并把属主改为 1000，再把 `volumes` 改为 `- ./data:/data`：

  ```sh
  mkdir -p ./data
  sudo chown 1000:1000 ./data
  ```

### 访问 OpenList

容器内的 `localhost` 指容器自身。添加实例时，要填写容器内能访问到的地址：

- OpenList 在同一个 compose 项目里：直接用服务名，例如 `http://openlist:5244`；
- OpenList 在宿主机上：用宿主机的局域网 IP。在 Linux 上，也可以给本服务加上 `extra_hosts: ['host.docker.internal:host-gateway']`，然后使用 `http://host.docker.internal:5244`。

### 停止与重启

`docker compose stop` 会发送 SIGTERM。服务在 `SHUTDOWN_GRACE_SECONDS`（默认 30 秒）内停止新工作、收尾并退出，关闭流程在此之外另留约 5 秒做本地收尾。示例中的 `stop_grace_period: 60s` 必须大于这两者之和；调大 `SHUTDOWN_GRACE_SECONDS` 时，要一并调大它。

停止时仍在运行的 Run 不会被写成终态，也不会取消已提交给 OpenList 的任务；下次启动时统一记为 `interrupted`。因此计划内重启前，先等运行结束。

## 从源码运行

环境要求：Node.js `^22.22.3` 或 `>=24.15.0`，pnpm 10。

```sh
pnpm install --frozen-lockfile
pnpm build:all
DATA_DIR=/srv/openlist-cron-sync ADMIN_PASSWORD='your-strong-password' node dist/main.js
```

- `DATA_DIR` 必须是绝对路径，并且属于运行服务的用户。
- 部署时要一起带上 `package.json`（声明 ESM，`dist/` 依赖它）、`dist/`、`web/dist/`、生产依赖和整个 `drizzle/` 目录。迁移在启动时自动应用。
- 默认 `NODE_ENV=production`，这时不读取 `.env`，配置只来自环境变量。
- 同样只运行一个进程，不要用 PM2 cluster 之类的多进程模式。

## 首次登录与改密

数据库里还没有管理员时，服务读取下面两个变量创建管理员：

| 变量             | 说明                                |
| ---------------- | ----------------------------------- |
| `ADMIN_USERNAME` | 默认 `admin`，1–64 个字符           |
| `ADMIN_PASSWORD` | 12–128 个字符；不设置则生成随机密码 |

- 没有设置 `ADMIN_PASSWORD` 时，服务生成随机密码，只在首次启动时向 stderr 打印一次：

  ```text
  Initial administrator password (change immediately): <随机密码>
  ```

  Docker 下可以这样找到它：

  ```sh
  docker compose logs openlist-cron-sync | grep 'Initial administrator password'
  ```

  这一行会留在容器日志里，所以首次登录后必须改密。改密之前，这个会话只能查看当前账号（`GET /auth/me`）和修改密码。

- 设置了 `ADMIN_PASSWORD` 时，不生成、不打印，也不强制改密。
- 管理员创建后，这两个变量不再读取，也不校验。之后再修改它们，不会改变已保存的账号或密码。

在浏览器打开 `http://<地址>:3000/`。如果用随机密码登录，控制台会直接进入“账户安全”页面，要求先替换初始密码；之后可以从账户菜单的“修改密码”再次修改。

通过 API 操作（路径都在 `/api/v1` 下）：

```sh
# 登录：返回 accessToken、tokenType、expiresIn、mustChangePassword
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<初始密码>"}'

# 改密：成功返回 204
curl -X POST http://localhost:3000/api/v1/auth/change-password \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'Content-Type: application/json' \
  -d '{"currentPassword":"<初始密码>","newPassword":"<新密码>"}'
```

- 改密成功后，所有旧令牌立即失效，需要用新密码重新登录。
- 登录令牌默认有效 8 小时（`ADMIN_JWT_TTL_SECONDS`），没有刷新令牌。
- 登录失败会限流：默认 15 分钟内失败 5 次后，接口返回 429 并带 `Retry-After`（`LOGIN_MAX_FAILURES`、`LOGIN_WINDOW_SECONDS`）。

## 密钥

服务使用两把相互独立的密钥：

| 密钥       | 环境变量                | 用途                                         | 丢失的后果                                                                   |
| ---------- | ----------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| JWT key    | `JWT_SECRET`            | 只签发管理会话，不保护任何存储数据           | 启动时自动生成新的，所有已登录会话失效                                       |
| master key | `ENCRYPTION_MASTER_KEY` | 加密数据库中保存的 OpenList 凭据和路径密码等 | 数据库里已有加密数据时，服务拒绝启动；只能换用空数据目录，重新录入实例和任务 |

- 两个环境变量都不设置时，服务自动生成密钥，保存在 `DATA_DIR/keys.json`（0600）。这时 `keys.json` 必须和数据库一起备份。
- 用环境变量提供时，值为标准 base64 编码的 32 字节，例如用 `openssl rand -base64 32` 生成。环境变量提供的密钥不会写入 `keys.json`，要单独妥善保存。
- 环境变量与 `keys.json` 同时提供且不一致时，启动失败（`CONFIG_KEY_CONFLICT`）。从自动生成改为环境变量时，值必须与 `keys.json` 中已有的相同。
- master key 与数据库里已有的密文不匹配时，启动失败（`KEY_MISMATCH`），且不会写入任何新密文。服务不会换一把新密钥继续运行。
- 当前没有在线轮换 master key 的工具。

## 反向代理

- 控制台按根路径构建，资源和接口都使用绝对路径（`/assets/…`、`/api/v1/…`）。反向代理要把整个站点（或一个独立子域名）转发给服务，不能挂在子路径下。
- `TRUST_PROXY_HOPS`（默认 0）是服务前面可信代理的层数，用于识别客户端真实 IP，登录限流按这个 IP 计数。只按实际拓扑设置：例如只有一层 Nginx 时设为 1。设得过大，客户端就能伪造 `X-Forwarded-For` 绕过限流。
- 管理 API 的请求体上限是 1 MiB。

## API 文档开关

`API_DOCS_ENABLED` 默认为 `true`：`/api/v1/docs`（Swagger UI）和 `/api/v1/openapi.json` 不需要登录即可访问。文档只包含公共的请求和响应结构，不含秘密；在 Swagger UI 中发起调用，仍需通过 Authorize 填入登录令牌。设为 `false` 时两条路由都不注册，访问返回 404。

## 忘记管理员密码

当前没有在线重置接口，只能离线重置：删除数据库中唯一的管理员记录，再带 `ADMIN_PASSWORD` 启动，服务会像首次启动一样重新创建管理员。以下以 Docker 为例：

1. 停止服务，并按[备份、恢复和升级](backup-restore-upgrade.md#备份)先做一份备份：

   ```sh
   docker compose stop
   ```

2. 删除管理员记录：

   ```sh
   docker compose run --rm openlist-cron-sync node -e "
     const Database = require('better-sqlite3');
     const db = new Database('/data/app.sqlite');
     console.log(db.prepare('DELETE FROM admins').run().changes);
     db.close();"
   ```

   输出 `1` 表示已删除。

3. 让旧会话失效。重建的管理员会话版本从 1 重新开始，旧令牌可能再次有效，所以要更换 JWT key，或者等到 `ADMIN_JWT_TTL_SECONDS`（默认 8 小时）之后再对外开放服务：
   - JWT key 来自环境变量时，换一个新的 `JWT_SECRET`；
   - JWT key 自动生成时，只删除 `keys.json` 中的 `jwtSecret` 字段，下次启动会生成新的。一定要保留 `encryptionMasterKey`：

     ```sh
     docker compose run --rm openlist-cron-sync node -e "
       const fs = require('fs'), f = '/data/keys.json';
       const keys = JSON.parse(fs.readFileSync(f, 'utf8'));
       delete keys.jwtSecret;
       fs.writeFileSync(f, JSON.stringify(keys) + '\n');"
     ```

4. 在 compose 的 `environment` 中设置新的 `ADMIN_PASSWORD`（需要时一并设置 `ADMIN_USERNAME`），然后启动：

   ```sh
   docker compose up -d
   ```

5. 用新密码登录确认后，可以把 `ADMIN_PASSWORD` 从 compose 中删除。管理员已存在时，这个变量不再读取。

从源码运行时步骤相同：停止进程，在项目目录中运行上面的 `node -e` 命令，把其中的 `/data` 换成实际的 `DATA_DIR`。
