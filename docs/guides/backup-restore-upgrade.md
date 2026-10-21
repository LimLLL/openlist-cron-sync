用途：说明停机一致备份、从备份恢复以及升级和回滚的操作步骤。

范围：单实例部署的 MVP 流程，命令以 Docker compose 为例；行为规范见[部署](../design/deployment.md#备份)，密钥规则见[配置参考](../reference/configuration.md#密钥优先级)。不提供在线备份接口。

# 备份、恢复和升级

## 要备份什么

| 路径                               | 内容                                  | 是否备份                   |
| ---------------------------------- | ------------------------------------- | -------------------------- |
| `/data/app.sqlite`、`-wal`、`-shm` | 配置、运行记录和操作记录              | 是，三个文件一起           |
| `/data/keys.json`                  | 自动生成的 JWT key 和 master key      | 是，与数据库成套           |
| `/data/spool`                      | relay 临时缓冲，启动时清空            | 否                         |
| 环境变量提供的密钥                 | `JWT_SECRET`、`ENCRYPTION_MASTER_KEY` | 不在数据目录里，要另行保存 |

- 数据库和 master key 必须成套保存。master key 丢失后，数据库中加密保存的凭据无法解密，服务也拒绝用这个数据库启动。
- 备份里通常同时包含数据库和 `keys.json`，泄露它就等于泄露所有 OpenList 凭据。备份介质要加密，并限制访问权限。
- 不要在服务运行时只复制 `app.sqlite`。

下文的 API 示例假设服务在 `http://localhost:3000`，`$TOKEN` 是管理员登录得到的 `accessToken`（见[首次部署](getting-started.md#首次登录与改密)）。

## 备份

### 1. 禁用所有任务

先记下当前启用了定时的任务，备份结束后要逐个恢复。

- 控制台：进入“任务”，在每个任务的详情页点“停用定时”。
- API（示例用到 `jq`）：

  ```sh
  # 列出启用了定时的任务 ID，保存下来
  curl -s 'http://localhost:3000/api/v1/jobs?pageSize=200' \
    -H "Authorization: Bearer $TOKEN" | jq -r '.items[] | select(.enabled) | .id' > enabled-jobs.txt

  # 逐个停用
  while read -r id; do
    curl -s -X POST "http://localhost:3000/api/v1/jobs/$id/disable" \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' > /dev/null
  done < enabled-jobs.txt
  ```

停用只影响定时触发，不影响已经开始或已在排队的运行。这样做出的备份里，所有任务都处于停用状态，恢复后不会自动运行。

### 2. 等待或取消运行

确认没有处于 `queued`、`scanning`、`planned`、`executing`、`cancelling`、`recovering` 状态的运行。尤其不能留下 `queued` 的运行：服务启动时会把它们重新排队并执行，即使任务已经停用。

- 控制台：在“运行”页按状态筛选；需要取消的，在运行详情页点“取消运行”，等它进入终态。
- API：

  ```sh
  for s in queued scanning planned executing cancelling recovering; do
    curl -s "http://localhost:3000/api/v1/runs?status=$s" \
      -H "Authorization: Bearer $TOKEN" | jq -r '.items[].id'
  done

  # 取消某个运行（返回 202，进行中的工作收尾后才会停止）
  curl -X POST "http://localhost:3000/api/v1/runs/<runId>/cancel" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
  ```

### 3. 查看未决的 unknown

结果不明的操作（unknown）及其隔离责任会随备份一起保存。备份前先了解有哪些：

- 控制台：在“操作”页把“未解决筛选”设为“未解决”。
- API：`GET /api/v1/operations?unresolved=true`。

### 4. 停止服务

```sh
docker compose stop
docker compose ps    # 确认服务已退出
```

确认没有其他容器或进程在使用这个数据目录。

### 5. 复制数据目录

整个数据目录（含 SQLite 的 `-wal`、`-shm` 文件）打包，跳过 spool：

```sh
mkdir -p backups
docker compose run --rm --user 0:0 -v "$PWD/backups:/backup" openlist-cron-sync \
  sh -c 'umask 077 && tar -C /data --exclude=./spool -czpf /backup/openlist-cron-sync-$(date -u +%Y%m%dT%H%M%SZ).tar.gz .'
```

`docker compose run` 使用服务的同一个数据卷，不会发布端口，也不会启动服务本身。从源码运行时，直接对 `DATA_DIR` 执行同样的 `tar` 命令。

用环境变量提供密钥时，把 `JWT_SECRET` 和 `ENCRYPTION_MASTER_KEY` 的值另行安全保存。

### 6. 记录备份信息

记录应用版本（镜像标签或 digest，可用 `docker compose images` 查看）、各实例的 OpenList 地址和备份时间。数据库结构版本由应用版本决定，恢复时要用兼容这个结构的版本。

### 7. 恢复服务

```sh
docker compose up -d
curl http://localhost:3000/api/v1/system/health/ready
```

就绪后，按第 1 步记下的列表重新启用定时：控制台点“启用定时”，或调用 `POST /api/v1/jobs/<id>/enable`。

## 恢复

恢复时，要把成套的数据库和匹配的密钥放进一个**空的**数据目录，并使用兼容该数据库结构的镜像版本。较新的版本会在启动时自动应用前向迁移；不能用比备份时更旧的版本，见[回滚](#回滚)。

### 1. 把备份放进空卷

```sh
docker compose down               # 删除容器，保留命名卷
docker volume ls                  # 找到本项目的卷，通常是 <项目目录名>_data
docker volume rm <项目目录名>_data  # 删除当前卷：先确认手上的备份可用，必要时先把当前卷也备份一份

# docker compose run 会新建空卷，再把备份解压进去
docker compose run --rm --user 0:0 -v "$PWD/backups:/backup:ro" openlist-cron-sync \
  tar -C /data -xzpf /backup/<备份文件>.tar.gz
```

以 root 解压并使用 `-p`，会保留原来的属主（uid 1000）和权限（目录 0700、`keys.json` 0600）。用宿主机目录时，解压到一个空目录，再确认属主为 1000。

用环境变量提供密钥时，配置成备份时的同一组值。

### 2. 启动

**按上面流程做出的备份**：所有任务都已停用，也没有排队的运行，直接 `docker compose up -d` 即可，不会自动同步。

**不是按这个流程做出的备份**（任务可能仍启用，可能有排队的运行）：启动前先切断本服务对 OpenList 的访问，启动后马上停用所有任务。一种做法是先用无网络的临时容器启动：

```sh
docker run -d --name ocs-restore --network none \
  -v <项目目录名>_data:/data ghcr.io/limlll/openlist-cron-sync:<版本>
# 用环境变量提供密钥时，加上相同的 -e JWT_SECRET=… -e ENCRYPTION_MASTER_KEY=…

# 待日志显示启动完成后，在容器内登录并停用所有启用了定时的任务
docker exec -i -e ADMIN_USER=admin -e ADMIN_PASS='<管理员密码>' ocs-restore \
  node --input-type=module - <<'EOF'
const base = 'http://127.0.0.1:3000/api/v1';
const json = { 'content-type': 'application/json' };
const login = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: json,
  body: JSON.stringify({ username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const headers = { ...json, authorization: `Bearer ${(await login.json()).accessToken}` };
for (let page = 1; ; page++) {
  const list = await (await fetch(`${base}/jobs?page=${page}&pageSize=200`, { headers })).json();
  for (const job of list.items.filter((item) => item.enabled)) {
    const res = await fetch(`${base}/jobs/${job.id}/disable`, { method: 'POST', headers, body: '{}' });
    console.log(job.id, res.status);
  }
  if (page * list.pageSize >= list.total) break;
}
EOF

docker stop -t 60 ocs-restore && docker rm ocs-restore
docker compose up -d
```

断网期间，排队中的运行会因为连不上 OpenList 而失败，不会改动远端文件。如果管理员账号还处于“必须改密”状态，脚本会因为没有权限而失败，要先改密。

### 3. 启用前检查

- **凭据**：备份之后修改过的 OpenList 凭据要重新录入。在控制台的“实例”详情页编辑，或调用 `PATCH /api/v1/instances/<id>`，例如 `{"auth":{"mode":"token","secret":"<新 token>"}}`。改完后做一次连接测试（实例详情页，或 `POST /api/v1/instances/<id>/test`）。
- **远端不会回退**：从旧备份恢复，会把本地的操作记录和 unknown 状态退回到备份时点，但 OpenList 上的文件保持现状，两者可能不一致。启用前，先对每个任务做一次预览：在控制台任务详情页点“立即运行”并选“预览运行”，或调用 `POST /api/v1/jobs/<id>/runs` 并传 `{"dryRun":true}`。检查其中的替换和删除候选，并处理未决的路径（`GET /api/v1/operations?unresolved=true`）。
- 确认无误后，再逐个启用任务。

### 密钥问题

| 情况                                | 结果                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| 数据库有加密数据，但缺少 master key | 启动失败，服务不会生成新 key 来尝试运行                      |
| master key 与数据库不匹配           | 启动失败（`KEY_MISMATCH`），不写入任何新密文                 |
| 环境变量与 `keys.json` 中的值不一致 | 启动失败（`CONFIG_KEY_CONFLICT`）                            |
| 只丢失 JWT key                      | 启动时生成新的，只是已有登录会话失效                         |
| 丢失 master key 且找不回            | 这份数据库无法再使用；只能换用空数据目录，重新录入实例和任务 |

## 升级

不能同时运行新旧两个实例，例如不要在旧容器还在运行时，用另一个 compose 项目挂载同一个卷启动新版本。

1. 查看新版本的发行说明，确认是否包含数据库迁移。
2. 按[备份](#备份)的第 1–3 步停用任务，等待或取消运行。
3. 停止服务并做一份备份（备份第 4–6 步）。
4. 修改 compose 中的镜像标签，例如从 `:0.0.1` 改为新版本，然后拉取并启动：

   ```sh
   docker compose pull
   docker compose up -d
   docker compose logs openlist-cron-sync
   ```

   迁移在启动时自动执行。迁移失败时服务报错退出，不会开始调度；这时保留日志，用升级前的备份和旧版本恢复。

5. `curl http://localhost:3000/api/v1/system/health/ready` 返回 200 后，按备份时记下的列表重新启用任务。

从源码运行时，同样先停用任务、等待运行、停止进程并备份，再切换到新版本的代码，执行 `pnpm install --frozen-lockfile && pnpm build:all`，然后启动。

## 回滚

旧版本启动时，不会检查数据库是否已经被新版本迁移过，只换回旧镜像可能让旧代码读写新结构。因此：

- 新版本**没有**数据库迁移：可以把镜像标签改回旧版本，再重新启动。
- 新版本**带有**数据库迁移：停止服务，按[恢复](#恢复)把升级前的成套备份放回空卷，再用旧版本启动。备份之后在新版本上产生的本地记录会随之丢失，启用任务前同样要先预览检查。
