// 从不同工作目录启动真实编译产物，验证迁移、重启、认证和信号关闭。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const entry = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'openlist-compiled-'));
const password = 'compiled-smoke-password';
const replacement = 'compiled-smoke-replacement';
const children = [];

/** 取得一个可用的本地端口，不改变生产 PORT 校验边界。
 * @param 不适用。
 * @returns {Promise<number>} 可用端口。
 * @throws {Error} socket 创建或关闭失败。
 */
function availablePort() {
  return new Promise(
    /** 启动短生命周期端口探测。
     * @param resolve 成功回调。
     * @param reject 失败回调。
     * @returns {void} 不适用。
     * @throws {Error} socket 操作失败。
     */
    (resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(
        0,
        '127.0.0.1',
        /** 关闭探测 socket 后交出端口。
         * @param 不适用。
         * @returns {void} 不适用。
         * @throws {Error} 未得到 TCP 地址。
         */
        () => {
          const address = server.address();
          assert(address && typeof address === 'object');
          server.close(
            /** 确认端口已释放。
             * @param error 关闭错误。
             * @returns {void} 不适用。
             * @throws 不适用。
             */
            (error) => {
              if (error) reject(error);
              else resolve(address.port);
            },
          );
        },
      );
    },
  );
}

/** 使用当前 mise 提供的 Node 二进制启动编译产物。
 * @param {number} port 监听端口。
 * @param {Record<string, string>} overrides 环境覆盖。
 * @returns 子进程及其日志和退出结果。
 * @throws {Error} 进程启动失败。
 */
function launch(port, overrides = {}) {
  const child = spawn(process.execPath, [entry], {
    cwd: directory,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: directory,
      SPOOL_DIR: join(directory, 'spool'),
      LOG_LEVEL: 'info',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: password,
      JWT_SECRET: undefined,
      ENCRYPTION_MASTER_KEY: undefined,
      ADMIN_JWT_TTL_SECONDS: '28800',
      LOGIN_MAX_FAILURES: '5',
      LOGIN_WINDOW_SECONDS: '900',
      TRUST_PROXY_HOPS: '0',
      API_DOCS_ENABLED: 'true',
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { child, output: '', exited: false, exit: undefined };
  /** 保存日志用于断言，测试结束只打印汇总。
   * @param {Buffer} chunk 输出块。
   * @returns {void} 不适用。
   * @throws 不适用。
   */
  const capture = (chunk) => {
    state.output += chunk.toString();
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  state.exit = new Promise(
    /** 记录退出结果。
     * @param resolve 完成回调。
     * @returns {void} 不适用。
     * @throws 不适用。
     */
    (resolve) => {
      child.once(
        'exit',
        /** 标记进程退出。
         * @param code 退出码。
         * @param signal 终止信号。
         * @returns {void} 不适用。
         * @throws 不适用。
         */
        (code, signal) => {
          state.exited = true;
          resolve({ code, signal });
        },
      );
      child.once(
        'error',
        /** 将启动错误转为退出结果。
         * @param 不适用。
         * @returns {void} 不适用。
         * @throws 不适用。
         */
        () => {
          state.exited = true;
          resolve({ code: -1, signal: null });
        },
      );
    },
  );
  children.push(state);
  return state;
}

/** 等待实际 HTTP readiness，而非初始化日志。
 * @param state 子进程状态。
 * @param {string} base API 地址。
 * @returns {Promise<void>} 就绪完成。
 * @throws {Error} 进程提前退出或等待超时。
 */
async function waitReady(state, base) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (state.exited)
      throw new Error(`Compiled application exited: ${state.output}`);
    let response;
    try {
      response = await fetch(`${base}/system/health/ready`);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    if (response?.status === 200) {
      assert.deepEqual(await response.json(), { status: 'ok', database: 'ok' });
      return;
    }
    await delay(50);
  }
  throw new Error('Compiled application readiness timed out');
}

/** 发送 JSON API 请求并验证状态。
 * @param {string} base API 地址。
 * @param {string} path 路由。
 * @param {number} status 预期状态。
 * @param {unknown} body 可选请求体。
 * @param {string} token 可选 bearer token。
 * @returns {Promise<Response>} HTTP 响应。
 * @throws {Error} 请求或断言失败。
 */
async function api(base, path, status, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, status);
  assert.match(response.headers.get('x-request-id') ?? '', /^[a-f0-9-]{36}$/);
  return response;
}

/** 有界等待 SIGTERM，失败时只对本测试的子进程强制清理。
 * @param state 子进程状态。
 * @returns {Promise<void>} 退出完成。
 * @throws {Error} 信号关闭超时。
 */
async function stop(state) {
  if (state.exited) return;
  state.child.kill('SIGTERM');
  const timeout = new AbortController();
  const result = await Promise.race([
    state.exit,
    delay(10000, 'timeout', { signal: timeout.signal }),
  ]);
  timeout.abort();
  if (result === 'timeout') {
    state.child.kill('SIGKILL');
    await state.exit;
    throw new Error('SIGTERM shutdown timed out');
  }
}

try {
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}/api/v1`;
  const first = launch(port);
  await waitReady(first, base);
  await api(base, '/system/health/live', 200);
  await api(base, '/docs', 200);
  await api(base, '/openapi.json', 200);
  const login = await (
    await api(base, '/auth/login', 200, { username: 'admin', password })
  ).json();
  assert.equal(typeof login.accessToken, 'string');
  await api(base, '/auth/me', 200, undefined, login.accessToken);
  await api(
    base,
    '/auth/change-password',
    204,
    { currentPassword: password, newPassword: replacement },
    login.accessToken,
  );
  await api(base, '/auth/me', 401, undefined, login.accessToken);
  const keys = await readFile(join(directory, 'keys.json'), 'utf8');
  await expectGracefulStop(first);
  const second = launch(port, {
    ADMIN_USERNAME: '',
    ADMIN_PASSWORD: '',
    API_DOCS_ENABLED: 'false',
  });
  await waitReady(second, base);
  await api(base, '/docs', 404);
  await api(base, '/openapi.json', 404);
  await api(base, '/auth/me', 401, undefined, login.accessToken);
  await api(base, '/auth/login', 200, {
    username: 'admin',
    password: replacement,
  });
  assert.equal(await readFile(join(directory, 'keys.json'), 'utf8'), keys);
  await expectGracefulStop(second);
  const invalid = launch(port, { PORT: 'invalid-port-secret' });
  assert.equal((await invalid.exit).code, 1);
  for (const state of children) {
    for (const secret of [
      password,
      replacement,
      login.accessToken,
      'invalid-port-secret',
      ...Object.values(JSON.parse(keys)).filter(isString),
    ])
      assert(!state.output.includes(secret));
    for (const line of state.output.trim().split('\n'))
      if (line) JSON.parse(line);
  }
  console.log(
    'PASS compiled smoke: fresh start, alternate cwd, migrations, auth, password revocation, SIGTERM, restart, ignored bootstrap env, docs toggle, fail-fast, JSON logs without secrets',
  );
} finally {
  for (const state of children) await stop(state);
  await rm(directory, { recursive: true, force: true });
}

/** 过滤密钥文件中的字符串值。
 * @param {unknown} value 字段值。
 * @returns {boolean} 是否字符串。
 * @throws 不适用。
 */
function isString(value) {
  return typeof value === 'string';
}

/** 确认运行中的应用正常完成 SIGTERM，不能把提前崩溃算作关闭成功。
 * @param state 子进程状态。
 * @returns {Promise<void>} 关闭并验证完成。
 * @throws {Error} 提前退出、关闭超时或异常退出。
 */
async function expectGracefulStop(state) {
  assert(!state.exited, 'Application exited before SIGTERM');
  await stop(state);
  const result = await state.exit;
  assert(
    (result.code === 0 && result.signal === null) ||
      (result.code === null && result.signal === 'SIGTERM'),
    `Unexpected shutdown result: ${JSON.stringify(result)}`,
  );
}
