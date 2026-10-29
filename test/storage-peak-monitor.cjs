// 迁移验收专用旁路采样器；只观察文件大小，不读取数据库内容或修改运行环境。
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const database = process.argv[2];
const parent = process.ppid;
const peak = {
  databaseBytes: 0,
  walBytes: 0,
  temporaryBytes: 0,
  totalBytes: 0,
  samples: 0,
};
let timer;
/** 缺失文件视为零，其他文件系统错误不隐藏。 */
function size(name) {
  try {
    return fs.statSync(name).size;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}
/** 读取SQLite已打开的临时文件，包含VACUUM已经unlink的临时库。 */
function temporaryBytes() {
  if (process.platform === 'linux') {
    let bytes = 0;
    const directory = `/proc/${parent}/fd`;
    for (const fd of fs.readdirSync(directory)) {
      const file = path.join(directory, fd);
      try {
        if (fs.readlinkSync(file).includes('etilqs_'))
          bytes += fs.statSync(file).size;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return bytes;
  }
  const output = execFileSync(
    'lsof',
    ['-a', '-p', String(parent), '-F', 'fstn'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let length = 0;
  let bytes = 0;
  const seen = new Set();
  for (const line of output.split('\n')) {
    if (line.startsWith('f')) length = 0;
    else if (line.startsWith('s')) length = Number(line.slice(1));
    else if (
      line.startsWith('n') &&
      line.includes('etilqs_') &&
      !seen.has(line)
    ) {
      seen.add(line);
      bytes += length;
    }
  }
  return bytes;
}
/** 每次保留各文件峰值及同时存在的总峰值，采样间隔不是精确高水位保证。 */
function sample() {
  const main = size(database),
    wal = size(`${database}-wal`),
    temporary = temporaryBytes();
  peak.databaseBytes = Math.max(peak.databaseBytes, main);
  peak.walBytes = Math.max(peak.walBytes, wal);
  peak.temporaryBytes = Math.max(peak.temporaryBytes, temporary);
  peak.totalBytes = Math.max(peak.totalBytes, main + wal + temporary);
  peak.samples++;
}
/** 按固定间隔持续采样，直到收到停止消息。 */
function tick() {
  sample();
  timer = setTimeout(tick, 50);
}
process.on('message', (message) => {
  if (message !== 'stop') return;
  clearTimeout(timer);
  sample();
  process.send(peak);
  process.disconnect();
});
tick();
process.send('ready');
