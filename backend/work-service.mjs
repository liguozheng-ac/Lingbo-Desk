import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { atomicJSON, sha, hashFile, within } from './work-policy.mjs';
const terminal = new Set(['completed', 'cancelled', 'failed', 'interrupted', 'paused']);
export class WorkService {
  constructor(directory, { policy, personal, skills, tools, record = () => {}, workerEnv = () => ({}), workerFile = fileURLToPath(new URL('./work-worker.mjs', import.meta.url)) } = {}) {
    Object.assign(this, { directory, policy, personal, skills, tools, record, workerEnv, workerFile }); this.jobs = new Map(); this.warnings = [];
    fs.mkdirSync(directory, { recursive: true });
    for (const entry of fs.readdirSync(directory)) {
      if (!/^work-[a-f0-9-]{36}$/.test(entry)) continue;
      try {
        const job = JSON.parse(fs.readFileSync(path.join(directory, entry, 'task.json'), 'utf8'));
        if (job.id !== entry || job.schema !== 1 || !/^[A-Za-z0-9_:.-]{1,200}$/.test(job.sessionId) || !Array.isArray(job.receipts) || !Array.isArray(job.rootIds) || typeof job.request !== 'string') throw new Error('invalid');
        job.output = path.join(directory, entry, 'output'); job.approval = null;
        if (!terminal.has(job.status)) { job.status = 'interrupted'; job.error = '服务中断。已执行动作不会回滚；检查执行记录后手动恢复。'; }
        if (job.intent) { job.uncertain = true; job.error = '中断前有动作尚无回执，不能自动重放；请先核对目标文件或网页。'; }
        this.jobs.set(job.id, job);
      } catch { this.warnings.push(`工作任务 ${entry} 状态损坏，保留原文件且未自动执行`); }
    }
  }
  saved(job) { const { worker, execution, controller, ticket, waitApproval, output, inTool, ...saved } = job; return saved; }
  persist(job) { job.updatedAt = new Date().toISOString(); atomicJSON(path.join(this.directory, job.id, 'task.json'), this.saved(job)); this.record({ type: 'work.snapshot', at: Date.now(), data: this.snapshot(job) }); }
  snapshot(job) {
    return { id: job.id, kind: 'work', sessionId: job.sessionId, request: job.request, status: job.status, version: job.version, modelProfile: job.modelProfile, rootIds: job.rootIds, skillVersions: job.skillVersions, output: job.output, createdAt: job.createdAt, updatedAt: job.updatedAt, attempts: job.attempts, result: job.result || '', error: job.error || null, uncertain: !!job.uncertain, approval: job.approval || null, receipts: job.receipts, artifacts: fs.existsSync(job.output) ? fs.readdirSync(job.output, { withFileTypes: true }).filter(e => e.isFile() && !e.isSymbolicLink()).map(e => e.name) : [] };
  }
  list(session) { return [...this.jobs.values()].filter(j => !session || j.sessionId === session).map(j => this.snapshot(j)); }
  find(session, id) {
    const jobs = [...this.jobs.values()].filter(j => j.sessionId === session);
    const job = id ? this.jobs.get(id) : jobs.findLast(j => !terminal.has(j.status)) || jobs.at(-1);
    if (!job || job.sessionId !== session) throw new Error('当前会话没有此工作任务'); return job;
  }
  ensureAvailable() { if ([...this.jobs.values()].some(j => !terminal.has(j.status))) throw Object.assign(new Error('工作任务尚在运行或等待确认，请先暂停或结束再切换模型'), { statusCode: 409 }); }
  create(sessionId, key, { request, rootIds, skillIds = [], modelProfile = this.personal.state.model } = {}) {
    if (typeof request !== 'string' || !request.trim() || request.length > 8000) throw new Error('工作任务要求须为 1—8000 字');
    if (!['deepseek', 'ollama'].includes(modelProfile)) throw new Error('工作模型无效');
    const duplicate = [...this.jobs.values()].find(j => j.sessionId === sessionId && j.key === key); if (duplicate) return this.snapshot(duplicate);
    if ([...this.jobs.values()].filter(j => !terminal.has(j.status)).length >= 3) throw new Error('最多同时执行 3 个工作任务');
    rootIds ??= this.policy.state.roots.map(r => r.id);
    if (!Array.isArray(rootIds) || rootIds.some(id => !this.policy.state.roots.some(r => r.id === id))) throw new Error('目录授权已经变化');
    const selected = this.skills.context(skillIds, 'work');
    if (modelProfile === 'ollama' && request.length + this.personal.context().length + selected.text.length > 8000) throw new Error('本地模型的任务与记忆、技能上下文过长，请缩短要求或切换云端模型');
    const id = 'work-' + crypto.randomUUID(), directory = path.join(this.directory, id), output = path.join(directory, 'output'); fs.mkdirSync(output, { recursive: true });
    const job = { schema: 1, id, sessionId, key, request: request.trim(), status: 'starting', version: 1, modelProfile, rootIds, skillVersions: selected.versions, personalContext: [this.personal.context(), selected.text].filter(Boolean).join('\n'), createdAt: new Date().toISOString(), attempts: 0, receipts: [], output, intent: null };
    this.jobs.set(id, job); this.persist(job); this.launch(job); return this.snapshot(job);
  }
  launch(job) {
    job.execution = this.run(job).catch(async error => { job.controller?.abort(); job.worker?.kill(); delete job.worker; delete job.ticket; job.status = job.intent ? 'interrupted' : 'failed'; job.uncertain = !!job.intent; job.error = error.message; this.persist(job); await this.tools.close?.(job); });
  }
  async run(job) {
    job.controller = new AbortController(); job.ticket = crypto.randomBytes(32).toString('hex'); job.status = 'starting'; job.error = null; job.approval = null; job.finish = null; job.readCharacters = 0; job.attempts++; this.persist(job);
    const attempt = path.join(this.directory, job.id, 'runtime-' + job.attempts); fs.mkdirSync(attempt, { recursive: true });
    const worker = fork(this.workerFile, [], { env: { ...process.env, ...this.workerEnv(job), VALIDATION_DATA: attempt, WORK_TASK_ID: job.id, WORK_TICKET: job.ticket }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); job.worker = worker;
    const log = fs.createWriteStream(path.join(attempt, 'runtime.log')); worker.stdout.pipe(log, { end: false }); worker.stderr.pipe(log, { end: false });
    const answer = await new Promise((resolve, reject) => {
      const finish = value => { clearTimeout(deadline); resolve(value); };
      const deadline = setTimeout(() => { job.controller.abort(); worker.kill(); reject(new Error('工作任务超过 20 分钟，已停止；检查记录后可手动继续')); }, 20 * 60 * 1000);
      worker.on('error', e => { clearTimeout(deadline); reject(e); });
      worker.on('exit', (code, signal) => { log.end(); finish({ failed: true, message: `执行器退出（${code ?? signal}）` }); });
      worker.on('message', message => {
        if (message.type === 'ready') {
          if (job.controller.signal.aborted) { worker.send({ command: 'shutdown' }); return; }
          job.status = 'running'; this.persist(job);
          const roots = this.policy.state.roots.filter(r => job.rootIds.includes(r.id));
          const evidence = job.receipts.slice(-20).map(({ result, ...receipt }) => ({ ...receipt, resultPreview: JSON.stringify(result || '').slice(0, job.modelProfile === 'ollama' ? 100 : 500) }));
          worker.send({ command: 'run', prompt: `当前任务版本 ${job.version}\n${job.request}\n产物目录：${job.output}\n本任务的授权文件夹：${JSON.stringify(roots)}\n${job.personalContext}\n已完成的真实工具回执摘要（不要重复已完成动作；必须先核对当前状态）：${JSON.stringify(evidence)}` });
        }
        if (message.type === 'settled') finish(message.data);
        if (message.type === 'failed') finish({ failed: true, ...message.data });
      });
    }).finally(() => { if (worker.connected) worker.send({ command: 'shutdown' }); });
    while (job.inTool) await new Promise(resolve => setTimeout(resolve, 20));
    if (!job.controller.signal.aborted && !answer.aborted) {
      job.status = !answer.failed && job.finish?.outcome === 'complete' ? 'completed' : job.finish?.outcome === 'needs_input' ? 'paused' : 'failed';
      job.result = job.finish?.summary || answer.content || ''; job.error = answer.failed ? answer.message : job.status === 'failed' ? '未取得有效的完成验收回执，不能按完成处理' : job.status === 'paused' ? '需要补充信息，请查看结果后修改或恢复任务。' : null;
    } else job.status = job.stopAs || 'cancelled';
    if (job.uncertain) { job.status = 'interrupted'; job.error = '动作启动后未能取得完整回执，请核对执行记录和目标再恢复。'; }
    job.approval = null; this.persist(job);
    delete job.worker; delete job.ticket;
    await this.tools.close?.(job);
  }
  control(job, { action, request, version, reviewed = false }) {
    if (action === 'progress') return this.snapshot(job);
    if (action === 'modify') {
      if (job.status !== 'paused' || version !== job.version || typeof request !== 'string' || !request.trim() || request.length > 8000) throw new Error('请先安全暂停并刷新任务版本，再修改要求');
      job.request = request.trim(); job.version++; this.persist(job); return this.snapshot(job);
    }
    if (action === 'resume') {
      if (!['paused', 'interrupted', 'failed'].includes(job.status) || job.worker) throw new Error('当前任务不能恢复，或执行器尚未停止');
      if (job.uncertain && !reviewed) throw new Error('上次动作结果不确定，请在任务台核对并勾选后恢复');
      for (const receipt of job.receipts.filter(r => r.ok && r.path && r.sha256)) {
        if (!fs.existsSync(receipt.path) || hashFile(receipt.path) !== receipt.sha256) {
          // A later receipt can supersede a read/write of the same path, or a recorded move/delete.
          const later = job.receipts.slice(job.receipts.indexOf(receipt) + 1).some(r => r.ok && (r.path === receipt.path || r.source === receipt.path));
          if (!later && !reviewed) throw new Error('任务读取或生成的文件已改变，请核对记录后再恢复');
        }
      }
      job.uncertain = false; job.intent = null; this.launch(job); return this.snapshot(job);
    }
    if (!['pause', 'cancel'].includes(action)) throw new Error('工作任务操作无效');
    if (terminal.has(job.status)) { if (action === 'cancel' && job.status !== 'completed') { job.status = 'cancelled'; this.persist(job); } return this.snapshot(job); }
    job.stopAs = action === 'pause' ? 'paused' : 'cancelled'; job.status = action === 'pause' ? 'pause_requested' : 'cancel_requested';
    job.controller.abort(); job.waitApproval?.reject(new Error('任务已暂停或取消')); job.worker?.send({ command: 'stop' }); this.persist(job);
    // Never wait forever on an unresponsive model process.
    const child = job.worker; setTimeout(() => { if (job.worker === child && child && child.exitCode === null) child.kill(); }, 3000).unref();
    return this.snapshot(job);
  }
  async approve(job, { approvalId, approved, version }) {
    if (job.status !== 'awaiting_approval' || !job.approval || job.approval.id !== approvalId || version !== job.version || typeof approved !== 'boolean' || !job.waitApproval) throw Object.assign(new Error('确认已失效，请刷新。一次确认只对应一项具体动作。'), { statusCode: 409 });
    const waiting = job.waitApproval; delete job.waitApproval; job.approval = null; job.status = 'running'; this.persist(job);
    approved ? waiting.resolve() : waiting.reject(new Error('用户拒绝此动作，不得换方式重试'));
    return this.snapshot(job);
  }
  async confirmation(job, preview) {
    job.controller.signal.throwIfAborted();
    if (job.approval) throw new Error('另有动作正在等待确认');
    const approval = { id: crypto.randomUUID(), version: job.version, ...preview, digest: sha(JSON.stringify(preview)), createdAt: new Date().toISOString() };
    const waiting = new Promise((resolve, reject) => { job.waitApproval = { resolve, reject }; });
    job.approval = approval; job.status = 'awaiting_approval'; this.persist(job);
    const abort = () => job.waitApproval?.reject(new Error('任务已停止'));
    job.controller.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => job.waitApproval?.reject(new Error('确认已等待 10 分钟，请重新提交具体动作')), 600000);
    try { await waiting; job.controller.signal.throwIfAborted(); }
    finally { clearTimeout(timer); job.controller.signal.removeEventListener('abort', abort); delete job.waitApproval; job.approval = null; if (job.status === 'awaiting_approval') job.status = 'running'; this.persist(job); }
  }
  async execute({ taskId, ticket, tool, args }) {
    const job = this.jobs.get(taskId);
    if (!job?.ticket || ticket !== job.ticket || !['running', 'awaiting_approval'].includes(job.status)) throw new Error('执行凭据或任务状态无效');
    if (job.inTool) throw new Error('工具必须顺序执行');
    job.inTool = true;
    try {
      job.controller.signal.throwIfAborted();
      if (job.finish) throw new Error('此任务已提交结束回执，不再执行新动作');
      if (tool === 'work_finish') {
        if (!['complete', 'needs_input'].includes(args?.outcome) || typeof args.summary !== 'string' || !args.summary.trim() || args.summary.length > 4000) throw new Error('结束回执无效');
        if (args.outcome === 'complete') {
          if (!job.receipts.some(r => r.ok && r.attempt === job.attempts)) throw new Error('本次没有实际执行证据');
          const mutationRequested = /修改|替换|改成|改为|写入|写几|生成|创建|保存|整理.*(?:成|到)|复制|移动|删除|运行|执行.*脚本|点击|填写|作成|編集|変更|置換|書き|コピー|移動|削除|入力|クリック|実行|\b(?:create|generate|write|edit|replace|export|save|copy|move|delete|fill|click|run)\b/iu.test(job.request);
          if (mutationRequested && !job.receipts.some(r => r.ok && r.mutation && r.version === job.version)) throw new Error('当前要求包含实际修改或产物，但本任务版本还没有成功的动作回执。请执行要求，或用 needs_input 说明缺少什么，不能宣称完成。');
          for (const receipt of job.receipts.filter(r => r.ok && r.mutation && r.path && r.sha256)) {
            if (job.receipts.slice(job.receipts.indexOf(receipt) + 1).some(r => r.ok && (r.path === receipt.path || r.source === receipt.path))) continue;
            if (!fs.existsSync(receipt.path) || hashFile(receipt.path) !== receipt.sha256) throw new Error('已生成或修改文件的最终状态校验失败');
          }
        }
        job.finish = { ...args, at: new Date().toISOString() }; this.persist(job); return { ok: true, outcome: args.outcome, summary: args.summary };
      }
      const fingerprint = sha(JSON.stringify([job.version, tool, args]));
      const previous = job.receipts.find(r => r.fingerprint === fingerprint && r.ok && r.mutation);
      if (previous) return { ...previous.result, replayed: true };
      const result = await this.tools.execute(job, tool, args, preview => this.confirmation(job, preview), intent => { job.intent = { ...intent, at: new Date().toISOString() }; this.persist(job); });
      const receipt = { id: crypto.randomUUID(), tool, fingerprint, at: new Date().toISOString(), attempt: job.attempts, version: job.version, ok: true, ...result.evidence, result: result.value };
      job.receipts.push(receipt); job.intent = null; this.persist(job); return result.value;
    } catch (error) { if (job.intent) job.uncertain = true; job.receipts.push({ tool, attempt: job.attempts, at: new Date().toISOString(), ok: false, error: String(error.message || '操作已停止') }); this.persist(job); return { ok: false, error: String(error.message || '操作已停止') }; }
    finally { delete job.inTool; }
  }
  async close() { for (const job of this.jobs.values()) if (!terminal.has(job.status)) this.control(job, { action: 'pause' }); await Promise.allSettled([...this.jobs.values()].map(j => j.execution)); }
}
