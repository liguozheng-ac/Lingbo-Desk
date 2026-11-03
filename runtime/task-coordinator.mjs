// Experiment-only coordinator: two fixed file stages, one worker runtime per task.
// It does not claim arbitrary tool rollback, process-crash recovery or remote exactly-once effects.
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { root, upstream, initializeData, fixtures, waitUntil, sleep } from './shared.mjs';

export class WorkerClient {
  constructor(directory, record = () => {}, options = {}) {
    initializeData(directory); fixtures(directory);
    this.directory = directory;
    this.events = [];
    this.child = fork(path.join(root, 'worker.mjs'), [], {
      cwd: upstream, env: { ...process.env, ...options.env, VALIDATION_DATA: directory, VALIDATION_MAX_TOKENS: String(options.maxTokens || 1600) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    });
    const log = fs.createWriteStream(path.join(directory, 'runtime.log'));
    this.child.stdout.pipe(log, { end: false });
    this.child.stderr.pipe(log, { end: false });
    this.child.on('message', event => { this.events.push(event); record(event); });
    this.child.on('exit', (code, signal) => { this.exit = { code, signal }; log.end(); });
    this.child.on('error', error => { this.exit = { error: error.message }; });
  }
  send(command, fields = {}) { this.child.send({ command, ...fields }); }
  async wait(type, predicate = () => true, after = 0, timeout = 90000) {
    let found;
    await waitUntil(() => {
      found = this.events.slice(after).find(e => e.type === type && predicate(e));
      if (!found && this.exit) throw new Error(`Worker exited before ${type}: ${JSON.stringify(this.exit)}`);
      const error = this.events.slice(after).find(e => e.type === 'runtime.error');
      if (!found && error) throw new Error(`Runtime error: ${JSON.stringify(error.data)}`);
      return found;
    }, timeout);
    return found;
  }
  async close() {
    if (this.exit) return;
    this.send('shutdown');
    try { await waitUntil(() => this.exit, 5000); } catch { this.child.kill(); }
  }
}

export class TaskCoordinator {
  constructor(directory, record = () => {}) {
    this.directory = directory; this.record = record; this.jobs = new Map(); this.keys = new Map();
    fs.mkdirSync(directory, { recursive: true });
  }
  persist(job) {
    const snapshot = this.snapshot(job.id);
    const file = path.join(this.directory, `${job.id}.json`);
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(snapshot, null, 2)); fs.renameSync(temporary, file);
    this.record({ type: 'task.snapshot', data: snapshot, at: Date.now() });
  }
  snapshot(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Unknown task');
    return { id, key: job.key, status: job.status, version: job.version,
      includeJapanese: job.includeJapanese, completed: [...job.completed],
      current: job.current, evidence: [...job.evidence], error: job.error || null };
  }
  async create(key) {
    if (this.keys.has(key)) return this.jobs.get(this.keys.get(key));
    const id = `task-${this.jobs.size + 1}`;
    const job = { id, key, status: 'starting', version: 1, includeJapanese: false,
      completed: [], evidence: [], current: null };
    this.keys.set(key, id); this.jobs.set(id, job); this.persist(job);
    job.worker = new WorkerClient(path.join(this.directory, id), event => {
      this.record({ ...event, taskId: id });
      if (event.type === 'paused') { job.status = 'paused'; this.persist(job); }
      if (event.type === 'tool.result') job.evidence.push({ tool: event.data.name, path: event.data.path, at: event.at });
    });
    await job.worker.wait('ready'); job.status = 'running'; this.persist(job);
    job.execution = this.run(job).catch(error => {
      job.status = 'failed'; job.error = error.message; this.persist(job);
    });
    return job;
  }
  async run(job) {
    const stages = [
      { name: 'extract', output: 'extract.md', prompt: () => '这是隔离文件工具验证。只允许 read_file 和 write_file。请先实际读取 source-a.md 与 source-b.md，再将两份资料的事实要点写入 extract.md。必须调用真实文件工具；完成后简短回复。不调用其他工具，不创建额外文件。' },
      { name: 'report', output: 'report.md', prompt: () => `创建一个全新的文件 report.md。要求版本：${job.version}。输入资料：extract.md。先用 read_file 读取输入，再用 write_file 创建输出。内容包含中文标题、产品定位、核心需求、后续验证。日语摘要：${job.includeJapanese ? '必需，使用“日语摘要”标题并写一段真正的日语。' : '无需。'} 输出路径仅 report.md。完成后简短回复。` },
    ];
    for (const stage of stages) {
      if (job.status === 'cancel_requested' || job.status === 'cancelled') break;
      while (['pause_requested', 'paused'].includes(job.status)) await sleep(25);
      if (job.status === 'cancel_requested' || job.status === 'cancelled') break;
      job.current = stage.name; this.persist(job);
      const after = job.worker.events.length;
      job.worker.send('run', { id: `${job.id}-${stage.name}`, hold: stage.name === 'extract', holdAt: 'write_file', version: job.version, prompt: stage.prompt() });
      const settled = await job.worker.wait('model.settled', e => e.data.request?.id === `${job.id}-${stage.name}`, after);
      if (job.status === 'cancel_requested') break;
      if (settled.data.aborted) throw new Error('Stage aborted unexpectedly');
      await job.worker.wait('runtime.response', e => e.data.request?.id === `${job.id}-${stage.name}`, after);
      const output = path.join(job.worker.directory, 'sandbox', stage.output);
      if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error(`Missing stage output: ${stage.output}`);
      if (!job.evidence.some(e => e.tool === 'write_file' && e.path === stage.output)) throw new Error('Output has no executor evidence');
      job.completed.push(stage.name); this.persist(job); await sleep(100);
    }
    job.status = job.status === 'cancel_requested' ? 'cancelled' : 'completed';
    job.current = null; this.persist(job);
  }
  pause(id) {
    const job = this.jobs.get(id);
    if (job.status !== 'running') throw new Error('Task is not running');
    job.status = 'pause_requested'; this.persist(job); job.worker.send('pause');
  }
  modify(id, expectedVersion, includeJapanese) {
    const job = this.jobs.get(id);
    if (job.status !== 'paused' || job.current !== 'extract') throw new Error('This PoC only modifies the pending report stage at a safe pause');
    if (job.version !== expectedVersion) throw new Error('Task version conflict');
    job.includeJapanese = includeJapanese; job.version++; this.persist(job);
  }
  resume(id) {
    const job = this.jobs.get(id);
    if (job.status !== 'paused') throw new Error('Task is not paused');
    job.status = 'running'; this.persist(job); job.worker.send('resume');
  }
  cancel(id) {
    const job = this.jobs.get(id);
    if (['completed', 'cancelled', 'failed'].includes(job.status)) return;
    job.status = 'cancel_requested'; this.persist(job); job.worker.send('cancel');
  }
  async close() { await Promise.all([...this.jobs.values()].map(job => job.worker.close())); }
}
