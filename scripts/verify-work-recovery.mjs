import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { workerEnvironment } from '../runtime/worker-environment.mjs';
import { startManagedProcess, withinTime } from '../runtime/worker-process.mjs';
import { hashFile } from '../backend/work-policy.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const directory = fs.mkdtempSync(path.join(root, 'artifacts/recovery-evaluation-'));
const result = { passed: false, scope: 'Actual gateway/worker processes, synthetic files and deterministic model fault injection; no cloud/account/personal files', directory, cases: [] };
const save = () => fs.writeFileSync(path.join(directory, 'recovery-result.json'), JSON.stringify(result, null, 2));
async function wait(predicate, timeout = 45000) { const end = Date.now() + timeout; while (!await predicate()) { if (Date.now() >= end) throw new Error('Recovery check timed out'); await new Promise(resolve => setTimeout(resolve, 50)); } }
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
for (const mode of ['upstream-disconnect', 'gateway-crash-committed', 'gateway-crash-uncertain', 'corrupt-task-state']) {
  const workspace = path.join(directory, mode), local = path.join(workspace, '.local'); fs.mkdirSync(local, { recursive: true });
  const controlFile = path.join(local, 'recovery-control.json'); fs.writeFileSync(controlFile, JSON.stringify({ mode, resume: false }));
  let gateway, origin, headers, ownedWorker;
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); origin = 'http://127.0.0.1:' + port;
  const item = { mode, passed: false, workspace }, begin = performance.now(); result.cases.push(item);
  const api = async (route, body, allowFailure = false) => {
    const r = await fetch(origin + route, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) }); const value = await r.json();
    if (!allowFailure) assert.equal(r.status, 200, value.error?.message || route); return { status: r.status, ...value };
  };
  async function start() {
    gateway = startManagedProcess(process.execPath, [path.join(root, 'backend/test-support/recovery-gateway.mjs')], { cwd: root, diagnosticsDirectory: path.join(workspace, 'supervisor'), shutdownMs: 3000, env: { ...workerEnvironment(), VOICE_AGENT_WORKSPACE: workspace, LINGBO_GATEWAY_PORT: String(port), DEEPSEEK_API_KEY: 'synthetic-recovery-fixture-only', ...(process.env.VOICE_PYTHON ? { VOICE_PYTHON: process.env.VOICE_PYTHON } : {}) } });
    await wait(async () => { if (gateway.closed) throw new Error('Controlled gateway exited'); try { return (await fetch(origin + '/bootstrap')).ok; } catch { return false; } });
    headers = { Authorization: 'Bearer ' + fs.readFileSync(path.join(local, 'gateway-token'), 'utf8').trim(), 'Content-Type': 'application/json', 'X-Lingbo-Session': 'recovery-fixture', 'X-Request-ID': mode };
  }
  try {
    await start();
    const created = (await api('/work/submit', { request: '创建 ledger.txt，包含 Recovery proof。核对产物后完成，不重复已经完成的文件写入。', rootIds: [], acceptance: [{ path: 'ledger.txt', contains: ['Recovery proof'] }] })).task;
    const taskFile = path.join(local, 'work-tasks', created.id, 'task.json'), target = path.join(created.output, 'ledger.txt');
    const job = async () => (await api('/work/status')).jobs.find(j => j.id === created.id);
    await wait(() => fs.existsSync(target));
    await wait(() => fs.existsSync(path.join(local, 'recovery-owned-worker.json')));
    ownedWorker = JSON.parse(fs.readFileSync(path.join(local, 'recovery-owned-worker.json'))).pid;
    const originalHash = hashFile(target), originalMtime = fs.statSync(target).mtimeMs;
    if (mode === 'upstream-disconnect') {
      await wait(async () => (await job()).status === 'failed');
      await wait(() => !alive(ownedWorker));
      item.failureObserved = true;
    } else {
      await wait(() => {
        const state = JSON.parse(fs.readFileSync(taskFile));
        return mode === 'gateway-crash-uncertain' ? fs.existsSync(path.join(local, 'recovery-write-without-receipt.json')) && state.intent : state.receipts.some(r => r.ok && r.mutation);
      });
      gateway.child.kill('SIGKILL'); await withinTime(gateway.done, 5000); await wait(() => !alive(ownedWorker), 5000);
      if (mode === 'corrupt-task-state') fs.writeFileSync(taskFile, '{controlled invalid task state');
      await start();
    }
    const countFile = path.join(local, 'recovery-model-count.json'), beforeCalls = JSON.parse(fs.readFileSync(countFile));
    await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(JSON.parse(fs.readFileSync(countFile)), beforeCalls, 'Restart/idle must not dispatch a model by itself');
    if (mode === 'corrupt-task-state') {
      const status = await api('/work/status'); assert.equal(status.jobs.length, 0); assert.ok(status.warnings.length); assert.equal(fs.readFileSync(taskFile, 'utf8'), '{controlled invalid task state'); item.corruptStatePreserved = true;
    } else if (mode === 'gateway-crash-uncertain') {
      const state = await job(); assert.equal(state.status, 'interrupted'); assert.equal(state.uncertain, true);
      const denied = await api('/work/control', { taskId: created.id, action: 'resume' }, true); assert.notEqual(denied.status, 200); assert.match(denied.error.message, /不确定/);
      assert.equal(JSON.parse(fs.readFileSync(countFile)), beforeCalls); item.uncertainReplayBlocked = true;
    } else {
      const state = await job(); assert.equal(state.status, mode === 'upstream-disconnect' ? 'failed' : 'interrupted'); assert.equal(state.uncertain, false);
      fs.writeFileSync(controlFile, JSON.stringify({ mode, resume: true }));
      await api('/work/control', { taskId: created.id, action: 'resume' }); await wait(async () => ['completed', 'failed', 'interrupted', 'paused'].includes((await job()).status));
      const resumed = await job(); assert.equal(resumed.status, 'completed', resumed.error); assert.equal(resumed.verification.scope, 'declared_outputs'); assert.equal(resumed.receipts.filter(r => r.ok && r.mutation).length, 1);
      item.manualResumeCompletedWithoutReplay = true;
    }
    assert.equal(hashFile(target), originalHash); assert.equal(fs.statSync(target).mtimeMs, originalMtime);
    Object.assign(item, { passed: true, originalFileUnchangedAfterFault: true, workerExited: true });
  } catch (error) { item.error = error.message; }
  finally {
    try { const exit = await gateway?.stop(); if (exit) assert.equal(exit.code, 0, 'Final gateway did not exit cleanly'); }
    catch (error) { item.passed = false; item.cleanupError = error.message; }
    item.elapsedMs = Math.round(performance.now() - begin); save(); console.log(JSON.stringify({ mode, passed: item.passed, elapsedMs: item.elapsedMs, ...(item.error ? { error: item.error } : {}), ...(item.cleanupError ? { cleanupError: item.cleanupError } : {}) }));
  }
}
result.passed = result.cases.every(c => c.passed); save(); console.log(JSON.stringify({ passed: result.passed, cases: result.cases.length, directory })); process.exitCode = result.passed ? 0 : 1;
