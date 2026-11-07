import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { workerEnvironment } from '../../runtime/worker-environment.mjs';
import { DiagnosticLog } from '../../runtime/diagnostic-log.mjs';
import { startWorker, withinTime } from '../../runtime/worker-process.mjs';
import { WorkerClient } from '../../runtime/task-coordinator.mjs';
import { createSecretRedactor } from '../../engine/src/runtime/diagnostic-privacy.js';
import { WorkService } from '../work-service.mjs';
import { WorkPolicy, hashFile } from '../work-policy.mjs';
import { WorkTools } from '../work-tools.mjs';
import { PersonalStore } from '../personal-store.mjs';
import { PersonalSkills } from '../personal-skills.mjs';
const workerFile = fileURLToPath(new URL('../test-support/lifecycle-worker.mjs', import.meta.url));
const beforeRemove = new Map();
function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-lifecycle-'));
  t.after(async () => { await beforeRemove.get(root)?.(); beforeRemove.delete(root); if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('lingbo-lifecycle-')) fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
async function waitFor(predicate, milliseconds = 3000) {
  const deadline = Date.now() + milliseconds;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Fixture condition timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
function fixture(t, request, processOptions = {}) {
  const root = directory(t), local = path.join(root, 'local'), input = path.join(root, 'input'); fs.mkdirSync(input);
  const policy = new WorkPolicy(local), personal = new PersonalStore(local), skills = new PersonalSkills(path.join(local, 'skills'), personal);
  const grant = policy.update({ action: 'grant', directory: input, mode: 'write', revision: 0 });
  const tools = new WorkTools({ policy, personal, skills });
  const service = new WorkService(path.join(local, 'tasks'), { policy, personal, skills, tools, workerFile, processOptions: { shutdownMs: 100, killMs: 1500, ...processOptions } });
  beforeRemove.set(root, () => service.close());
  const task = service.create('owner', 'fixture', { request, rootIds: grant.roots.map(r => r.id) }), job = service.jobs.get(task.id);
  return { root, input, service, tools, job };
}
test('environment allowlist strips provider secrets, Node hooks and credential-bearing proxies', () => {
  const result = workerEnvironment({ LINGBO_MODEL_GATEWAY: 'http://127.0.0.1:9/v1', LINGBO_MODEL_TOKEN: 'synthetic-local-only' }, { Path: 'system-path', SystemRoot: 'system-root', DEEPSEEK_API_KEY: 'synthetic-private', CUSTOM_SECRET: 'synthetic-private', NODE_OPTIONS: '--require=bad', HTTP_PROXY: 'http://private:password@localhost' });
  assert.equal(result.Path, 'system-path'); assert.equal(result.SystemRoot, 'system-root');
  assert.equal(result.LINGBO_DIAGNOSTICS_METADATA_ONLY, '1');
  for (const key of ['DEEPSEEK_API_KEY', 'CUSTOM_SECRET', 'NODE_OPTIONS', 'HTTP_PROXY']) assert.equal(result[key], undefined);
  assert.throws(() => workerEnvironment({ DEEPSEEK_API_KEY: 'synthetic' }));
});
test('redaction handles nested sensitive fields, known opaque secrets and generic credential patterns', () => {
  const clean = createSecretRedactor(['opaque-fixture-value']);
  const result = clean({ text: 'opaque-fixture-value sk-fixturefakecredential123456 Bearer fixture-credential-value', nested: [{ password: 'anything', ticket: 'opaque' }], body: 'normal document' });
  assert.equal(result.body, 'normal document'); assert.equal(result.nested[0].password, '[REDACTED]');
  assert.equal(result.nested[0].ticket, '[REDACTED]'); assert.doesNotMatch(JSON.stringify(result), /opaque-fixture-value|sk-fixture|fixture-credential/);
});
test('diagnostic logs contain no document body and respect byte, count and age limits without touching legacy files', t => {
  const root = directory(t), legacy = path.join(root, 'runtime.log'); fs.writeFileSync(legacy, 'legacy data');
  const counterfeit = path.join(root, 'lingbo-diagnostic-00000000-0000-0000-0000-000000000000.jsonl'); fs.writeFileSync(counterfeit, 'unmanaged historical data');
  for (let n = 0; n < 5; n++) {
    const log = new DiagnosticLog(root, { maxBytes: 512, maxFiles: 3 });
    for (let i = 0; i < 80; i++) log.append({ type: 'tool.result', data: { body: 'private fixture', token: 'synthetic-secret', count: i, ok: true } });
    log.close(); assert.equal(log.failed, false);
  }
  const files = fs.readdirSync(root).filter(name => name.startsWith('lingbo-diagnostic-') && name !== path.basename(counterfeit));
  assert.ok(files.length <= 3);
  for (const name of files) { assert.ok(fs.statSync(path.join(root, name)).size <= 512); assert.doesNotMatch(fs.readFileSync(path.join(root, name), 'utf8'), /private fixture|synthetic-secret/); }
  const old = new DiagnosticLog(root); old.close(); fs.utimesSync(old.file, new Date(0), new Date(0));
  const fresh = new DiagnosticLog(root); fresh.close(); assert.equal(fs.existsSync(old.file), false);
  assert.equal(fs.readFileSync(legacy, 'utf8'), 'legacy data'); assert.equal(fs.readFileSync(counterfeit, 'utf8'), 'unmanaged historical data');
});
test('real fork receives no inherited key/preload and stdout/stderr are counted without capturing their contents', async t => {
  const root = directory(t), keys = ['DEEPSEEK_API_KEY', 'NODE_OPTIONS', 'FIXTURE_PRIVATE'];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { DEEPSEEK_API_KEY: 'synthetic-private-only', NODE_OPTIONS: '--require=nonexistent-fixture', FIXTURE_PRIVATE: 'synthetic-private-only' });
  let runtime;
  try {
    runtime = startWorker(workerFile, { diagnosticsDirectory: root });
    const [ready] = await withinTime(once(runtime.child, 'message'), 3000);
    assert.equal(ready.data.cloudKeyPresent, false); assert.equal(ready.data.preloadPresent, false); assert.equal(ready.data.metadataOnly, true);
    const noise = once(runtime.child, 'message'); runtime.send('noise'); await noise;
    await Promise.all([runtime.stop(), runtime.stop()]); assert.equal(runtime.closed, true);
    const log = fs.readFileSync(runtime.log.file, 'utf8'); assert.match(log, /worker.stream/); assert.match(log, /"bytes":[1-9]/);
    assert.doesNotMatch(log, /private-fixture|fixturefakecredential|credential-value|synthetic-private/);
    assert.equal(runtime.send('run'), false);
  } finally { await runtime?.stop(); for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
});
test('a stubborn worker and its live descendant are terminated and reaped before stop resolves', async t => {
  const root = directory(t), runtime = startWorker(workerFile, { diagnosticsDirectory: root, shutdownMs: 80, killMs: 1500 });
  try {
    await withinTime(once(runtime.child, 'message'), 3000);
    const response = once(runtime.child, 'message'); runtime.send('spawn-descendant', { file: path.join(root, 'late.txt') });
    const [message] = await response; const pid = message.data.pid;
    await runtime.stop(); assert.equal(runtime.closed, true);
    assert.throws(() => process.kill(pid, 0)); assert.equal(fs.existsSync(path.join(root, 'late.txt')), false);
  } finally { await runtime.stop(); }
});
test('spawn failure closes without a dangling IPC or log stream', async t => {
  const root = directory(t), runtime = startWorker(workerFile, { diagnosticsDirectory: root, execPath: path.join(root, 'missing-node.exe') });
  const exit = await withinTime(runtime.done, 3000); assert.ok(exit.error); await runtime.stop(); assert.equal(runtime.closed, true);
});
test('pause followed by resume gets a fresh attempt and cancellation cannot leave a stale pause result', async t => {
  const f = fixture(t, 'mode=delayed'); await waitFor(() => f.job.status === 'running');
  const oldTicket = f.job.ticket;
  f.service.control(f.job, { action: 'pause' }); await f.job.execution;
  assert.equal(f.job.status, 'paused'); assert.equal(f.job.worker, undefined); assert.equal(f.job.ticket, undefined);
  await assert.rejects(f.service.execute({ taskId: f.job.id, ticket: oldTicket, tool: 'work_memory', args: {} }));
  f.service.control(f.job, { action: 'resume' }); await waitFor(() => f.job.status === 'running');
  f.service.control(f.job, { action: 'cancel' }); await f.job.execution;
  assert.equal(f.job.status, 'cancelled'); assert.equal(f.job.attempts, 2); assert.equal(f.job.worker, undefined);
  assert.equal(fs.existsSync(path.join(f.service.directory, f.job.id, 'runtime-1', 'late.txt')), false);
});
test('pausing while approval is pending rejects the approval and leaves the original file unchanged', async t => {
  const f = fixture(t, 'mode=hang'); await waitFor(() => f.job.status === 'running');
  const file = path.join(f.input, 'original.txt'); fs.writeFileSync(file, 'original'); const hash = hashFile(file);
  const action = f.service.execute({ taskId: f.job.id, ticket: f.job.ticket, tool: 'work_edit', args: { path: file, old_text: 'original', new_text: 'changed', expected_sha256: hash } });
  await waitFor(() => f.job.status === 'awaiting_approval');
  f.service.control(f.job, { action: 'pause' }); const result = await action; await f.job.execution;
  assert.equal(result.ok, false); assert.equal(hashFile(file), hash); assert.equal(f.job.status, 'paused');
  assert.equal(f.job.approval, null); assert.equal(f.job.waitApproval, undefined); assert.equal(f.job.inTool, undefined);
});
test('a crash aborts an in-flight host tool and preserves uncertainty instead of automatically replaying', async t => {
  const f = fixture(t, 'mode=idle'); await waitFor(() => f.job.status === 'running');
  const target = path.join(f.job.output, 'late.txt');
  f.tools.execute = async (job, _tool, _args, _confirm, intent) => {
    intent({ tool: 'work_write', path: target });
    await new Promise((resolve, reject) => { const timer = setTimeout(() => { fs.writeFileSync(target, 'late'); resolve(); }, 1500); job.controller.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted fixture')); }, { once: true }); });
    return { value: { ok: true }, evidence: { mutation: true } };
  };
  const action = f.service.execute({ taskId: f.job.id, ticket: f.job.ticket, tool: 'work_write', args: { path: 'late.txt', content: 'fixture' } });
  await waitFor(() => !!f.job.intent); f.job.runtime.send('crash');
  await action; await f.job.execution;
  assert.equal(f.job.status, 'interrupted'); assert.equal(f.job.uncertain, true); assert.equal(f.job.worker, undefined);
  assert.equal(fs.existsSync(target), false); assert.throws(() => f.service.control(f.job, { action: 'resume' }), /不确定/);
});
test('startup timeout, process crash and service shutdown all settle and clear their owned workers', async t => {
  const f = fixture(t, 'mode=crash'); await f.job.execution;
  assert.equal(f.job.status, 'failed'); assert.match(f.job.error, /退出/); assert.equal(f.job.worker, undefined);
  f.service.processOptions.startupTimeoutMs = 1;
  f.service.control(f.job, { action: 'resume' }); await f.job.execution;
  assert.equal(f.job.status, 'failed'); assert.match(f.job.error, /及时启动/); assert.equal(f.job.worker, undefined);
  const g = fixture(t, 'mode=hang'); await waitFor(() => g.job.status === 'running');
  await g.service.close(); assert.equal(g.job.worker, undefined); assert.equal(g.job.status, 'paused');
  assert.throws(() => g.service.create('owner', 'new', { request: 'new' }), /正在关闭/);
});
test('report worker client uses the same reaping and safe IPC lifecycle', async t => {
  const root = directory(t), worker = new WorkerClient(root, () => {}, { workerFile, processOptions: { shutdownMs: 80, killMs: 1500 } });
  try { await worker.wait('ready'); worker.send('run', { prompt: 'mode=hang' }); await worker.close(); assert.ok(worker.exit); assert.equal(worker.runtime.closed, true); assert.equal(worker.send('cancel'), false); }
  finally { await worker.close(); }
});
test('a task deadline also reaps an unresponsive process before publishing failure', async t => {
  const f = fixture(t, 'mode=hang', { taskTimeoutMs: 100 }); await f.job.execution;
  assert.equal(f.job.status, 'failed'); assert.match(f.job.error, /超过/); assert.equal(f.job.worker, undefined); assert.equal(f.job.ticket, undefined);
});
test('failed cleanup keeps the owned process visible and blocks recovery and model switching', async t => {
  const f = fixture(t, 'mode=idle'); await waitFor(() => f.job.status === 'running');
  const runtime = f.job.runtime, stop = runtime.stop;
  runtime.stop = async () => { throw new Error('synthetic cleanup failure'); };
  try {
    f.service.control(f.job, { action: 'pause' }); await f.job.execution;
    assert.equal(f.job.status, 'interrupted'); assert.ok(f.job.worker);
    assert.throws(() => f.service.control(f.job, { action: 'resume' }), /尚未停止/);
    assert.throws(() => f.service.ensureAvailable());
  } finally { runtime.stop = stop; await f.service.close(); }
  assert.equal(f.job.worker, undefined);
});
test('replaced diagnostic files are preserved and stop accepting appends', t => {
  const root = directory(t), log = new DiagnosticLog(root);
  fs.writeFileSync(log.file, 'user replacement'); log.append({ type: 'tool.result' }); log.close();
  assert.equal(log.failed, true); assert.equal(fs.readFileSync(log.file, 'utf8'), 'user replacement');
});
