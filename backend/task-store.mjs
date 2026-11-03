import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const taskIdPattern = /^report-[a-f0-9-]{36}$/;
export const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const fileDigest = file => digest(fs.readFileSync(file));
export function inside(root, relative) {
  const target = path.resolve(root, relative);
  const back = path.relative(root, target);
  if (!back || back.startsWith('..') || path.isAbsolute(back)) throw new Error('任务目录不在工作区内');
  return target;
}

export class TaskStore {
  constructor(directory, workspace) {
    this.directory = path.resolve(directory);
    this.workspace = path.resolve(workspace);
    this.warnings = [];
    fs.mkdirSync(directory, { recursive: true });
    this.lockFile = path.join(directory, '.writer-lock');
    this.lockToken = crypto.randomUUID();
    this.acquire();
  }
  acquire() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const descriptor = fs.openSync(this.lockFile, 'wx');
        try { fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token: this.lockToken })); fs.fsyncSync(descriptor); }
        finally { fs.closeSync(descriptor); }
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let previous;
        try { previous = JSON.parse(fs.readFileSync(this.lockFile, 'utf8')); }
        catch { throw new Error('任务写入锁损坏，请检查 .local/tasks/.writer-lock；未自动删除'); }
        if (!Number.isInteger(previous.pid) || previous.pid < 1) throw new Error('任务写入锁无效');
        let alive = true;
        try { process.kill(previous.pid, 0); } catch (cause) { if (cause.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('已有任务服务持有写入锁，请勿重复启动');
        fs.unlinkSync(this.lockFile);
      }
    }
    throw new Error('无法取得任务写入锁');
  }
  save(record) {
    if (!taskIdPattern.test(record.id)) throw new Error('任务编号无效');
    const file = path.join(this.directory, record.id + '.json');
    const temporary = file + '.tmp';
    const descriptor = fs.openSync(temporary, 'w');
    try { fs.writeFileSync(descriptor, JSON.stringify({ ...record, schemaVersion: 1 }, null, 2)); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, file);
  }
  load() {
    const records = [];
    for (const entry of fs.readdirSync(this.directory).sort()) {
      if (!entry.endsWith('.json') || !taskIdPattern.test(entry.slice(0, -5))) continue;
      try {
        const record = JSON.parse(fs.readFileSync(path.join(this.directory, entry), 'utf8'));
        if (record.schemaVersion !== 1 || record.id + '.json' !== entry || !/^[A-Za-z0-9_:.-]{1,200}$/.test(record.sessionId)) throw new Error('状态结构无效');
        inside(this.workspace, record.workspace);
        records.push(record);
      } catch { this.warnings.push(`任务状态损坏或结构无效：${entry}。原状态和文件已保留，未自动执行。`); }
    }
    return records.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  release() {
    try {
      const record = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
      if (record.token === this.lockToken) fs.unlinkSync(this.lockFile);
    } catch { /* A missing lock is already released. */ }
  }
}
