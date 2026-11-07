import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { workerEnvironment } from '../runtime/worker-environment.mjs';
import { safeWorkerSend, withinTime } from '../runtime/worker-process.mjs';
import { packageModelFixture } from '../backend/test-support/package-model.mjs';
import { assessWakeRun } from './wake-assessment.mjs';

// Preparation by default. --manual-wake only observes; it never suspends Windows.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2), candidate = fs.realpathSync(path.resolve(args[0] || '.'));
const artifacts = fs.realpathSync(path.join(root, 'artifacts'));
assert.equal(process.platform, 'win32');
assert.ok(args[0] && candidate.startsWith(artifacts + path.sep), 'Only an artifact candidate may run, never an installed app');
assert.ok(args.slice(1).every(arg => arg === '--manual-wake'), 'Unknown option');
const manifest = JSON.parse(fs.readFileSync(path.join(candidate, 'resources/package-manifest.json')));
assert.ok(manifest.version.endsWith('-test'));
const manual = args.includes('--manual-wake'), workspace = fs.mkdtempSync(path.join(artifacts, 'wake-readiness-'));
const local = path.join(workspace, '.local'); fs.mkdirSync(local);
fs.writeFileSync(path.join(local, 'personal.json'), JSON.stringify({ version: 1, revision: 0, model: 'ollama', memories: [], skills: {} }));
const origin = 'http://127.0.0.1:39850', runId = randomUUID();
const result = { passed: false, runId, mode: manual ? 'manual-wake' : 'preparation-only', candidate, workspace, version: manifest.version, startedAt: new Date().toISOString(), scope: 'Real test package, loopback mock model, synthetic text only. No microphone, cloud, audio playback or automatic suspend.', checks: [], samples: [], observer: { connections: 0, heartbeats: 0, completions: {} }, actualCloudCalls: 0, sleepVerified: false };
const resultFile = path.join(workspace, 'wake-result.json'), progressFile = path.join(workspace, 'wake-progress.json');
const save = () => fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
const progress = stage => { fs.writeFileSync(progressFile, JSON.stringify({ stage, runId, workspace, mode: result.mode, markerFile: path.join(workspace, 'check-after-wake.json') }, null, 2)); save(); console.log(JSON.stringify({ stage, workspace })); };
const check = (name, details = {}) => { result.checks.push({ name, ...details }); save(); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(predicate, ms = 30000) { const deadline = Date.now() + ms; while (!await predicate()) { assert.ok(Date.now() < deadline, 'Wake check timed out'); await delay(150); } }
async function free(port) { const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); await new Promise(resolve => server.close(resolve)); }
let fixture, app, exited, headers, observer, observerDone, stop = false;
async function api(route, body) {
  const response = await fetch(origin + route, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000) });
  const value = await response.json(); assert.equal(response.status, 200, value.error?.message || route); return value;
}
async function powershell(script, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts', script)], { windowsHide: true, timeout: 12000, env: workerEnvironment(), maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error('Test metadata collection failed')); else try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, ''))); } catch { reject(new Error('Invalid metadata response')); }
    }); child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(input));
  });
}
function observe() {
  observerDone = (async () => {
    while (!stop) {
      observer = new AbortController();
      try {
        const response = await fetch(origin + '/events', { headers, signal: observer.signal }); assert.equal(response.status, 200); result.observer.connections++;
        const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
        while (!stop) {
          const { value, done } = await reader.read(); if (done) break;
          pending += decoder.decode(value, { stream: true }); const frames = pending.split('\n\n'); pending = frames.pop();
          for (const frame of frames) {
            if (frame.startsWith(': heartbeat')) result.observer.heartbeats++;
            const data = frame.split('\n').find(line => line.startsWith('data: ')); if (!data) continue;
            const event = JSON.parse(data.slice(6));
            if (event.type === 'work.snapshot' && event.data?.status === 'completed') result.observer.completions[event.data.id] = (result.observer.completions[event.data.id] || 0) + 1;
          }
        }
      } catch { /* State checks distinguish a missed stream from a missing task. */ }
      if (!stop) await delay(300);
    }
  })();
}
async function sample() {
  const now = Date.now(), previous = result.samples.at(-1);
  const sample = { at: new Date(now).toISOString(), gapMs: previous ? now - Date.parse(previous.at) : 0 };
  try { const status = await api('/status'); sample.backendPid = status.pid; sample.connected = status.lingboConnected; } catch { sample.unavailable = true; }
  sample.observerConnections = result.observer.connections; sample.observerHeartbeats = result.observer.heartbeats;
  result.samples.push(sample); save();
}
async function job(id) { return (await api('/work/status')).jobs.find(item => item.id === id); }
async function state(id, expected) { let value; await wait(async () => { value = await job(id); return expected.includes(value?.status); }, 45000); return value; }
async function submit(waiting = false) {
  return (await api('/work/submit', { request: `${waiting ? 'PACKAGE_WAIT ' : ''}PACKAGE_WORK create proof.md with Package work proof.`, rootIds: [], acceptance: [{ path: 'proof.md', contains: ['Package work proof'] }] })).task;
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function outputCheck(task) {
  assert.equal(task.status, 'completed'); assert.equal(task.verification?.scope, 'declared_outputs');
  assert.equal(task.receipts.filter(receipt => receipt.ok && receipt.mutation).length, 1);
  const file = path.join(task.output, 'proof.md'); assert.ok(file.startsWith(workspace + path.sep)); assert.match(fs.readFileSync(file, 'utf8'), /Package work proof/);
  return { taskId: task.id, sha256: hash(file), file, mtimeMs: fs.statSync(file).mtimeMs };
}
try {
  await free(39850); await free(39851); fixture = await packageModelFixture();
  app = spawn(path.join(candidate, 'LingboDesk.exe'), [], { cwd: candidate, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...workerEnvironment(), VOICE_AGENT_WORKSPACE: workspace, LINGBO_GATEWAY_PORT: '39850', LINGBO_RENDERER_PORT: '39851' } });
  exited = once(app, 'close'); exited.catch(() => {});
  await wait(async () => { assert.equal(app.exitCode, null, 'Test app exited'); try { return fs.existsSync(path.join(local, 'gateway-token')) && (await fetch(origin + '/bootstrap')).ok; } catch { return false; } });
  headers = { Authorization: 'Bearer ' + fs.readFileSync(path.join(local, 'gateway-token'), 'utf8').trim(), 'Content-Type': 'application/json' };
  await wait(async () => (await api('/status')).lingboConnected === true, 45000);
  const before = await api('/status'); headers['X-Lingbo-Session'] = before.activeLingboSessionId;
  assert.ok(headers['X-Lingbo-Session']);
  const processes = await powershell('windows-process-snapshot.ps1', { rootProcessId: app.pid });
  assert.ok(processes.some(p => p.pid === before.pid && p.parentPid === app.pid));
  check('isolated native renderer and owned gateway connected', { appPid: app.pid, backendPid: before.pid });
  observe(); await wait(() => result.observer.connections > 0);
  const first = outputCheck(await state((await submit()).id, ['completed', 'failed', 'interrupted'])); check('baseline output verified', first);
  const parked = await submit(true); await wait(() => fixture.pending > 0);
  await api('/work/control', { taskId: parked.id, action: 'pause' }); const paused = await state(parked.id, ['paused', 'interrupted']);
  assert.equal(paused.status, 'paused'); assert.equal(paused.receipts.filter(r => r.mutation).length, 0);
  await wait(() => fixture.pending === 0); check('task safely paused before observation', { taskId: parked.id });
  result.armedAt = new Date().toISOString(); progress(manual ? 'ready-for-user-manual-sleep' : 'preparation-idle');
  if (manual) {
    const deadline = Date.now() + 20 * 60 * 1000, marker = path.join(workspace, 'check-after-wake.json');
    while (!fs.existsSync(marker)) { assert.ok(Date.now() < deadline, 'Manual observation expired'); assert.equal(app.exitCode, null); await sample(); await delay(2000); }
    const value = JSON.parse(fs.readFileSync(marker)); assert.equal(value.runId, runId); assert.equal(value.action, 'check-after-wake');
    result.manualWakeAcknowledgedAt = new Date().toISOString();
  } else {
    for (let i = 0; i < 6; i++) { await sample(); await delay(2000); }
  }
  progress('checking-after-observation');
  // /status keeps a heartbeat valid for 20 seconds. Outwait that grace period
  // so a pre-observation heartbeat cannot falsely count as a fresh connection.
  const freshnessStarted = Date.now();
  for (let i = 0; i < 11; i++) { await delay(2000); await sample(); }
  await wait(async () => { try { return (await api('/status')).lingboConnected === true; } catch { return false; } }, 30000);
  await sample(); const after = await api('/status');
  check('native heartbeat available after observation', { backendPid: after.pid, backendChanged: before.pid !== after.pid, freshnessWindowMs: Date.now() - freshnessStarted, gatewayHeartbeatGraceMs: 20000 });
  const heartbeatCount = result.observer.heartbeats; await wait(() => result.observer.heartbeats > heartbeatCount, 15000);
  check('independent event observer receives a fresh heartbeat');
  assert.equal(hash(first.file), first.sha256); assert.equal(fs.statSync(first.file).mtimeMs, first.mtimeMs);
  const stillPaused = await job(parked.id); assert.equal(stillPaused.status, 'paused'); assert.equal(stillPaused.receipts.filter(r => r.mutation).length, 0); assert.equal(fs.existsSync(path.join(parked.output, 'proof.md')), false);
  check('existing output unchanged and paused task did not replay');
  fixture.releaseWaitingRequests(); await api('/work/control', { taskId: parked.id, action: 'resume' });
  check('explicit task resume produced one verified mutation', outputCheck(await state(parked.id, ['completed', 'failed', 'interrupted'])));
  const fresh = outputCheck(await state((await submit()).id, ['completed', 'failed', 'interrupted'])); check('new work available after observation', fresh);
  await wait(() => [first.taskId, parked.id, fresh.taskId].every(id => result.observer.completions[id] >= 1));
  const jobs = (await api('/work/status')).jobs; assert.equal(jobs.length, 3); assert.ok(jobs.every(j => j.status === 'completed' && j.receipts.filter(r => r.ok && r.mutation).length === 1));
  // SSE completion snapshots can legitimately repeat after reconnection; receipts are authoritative.
  check('all three tasks retained with one successful mutation each');
  result.powerEvidence = await powershell('windows-power-events.ps1', { since: result.armedAt, until: result.manualWakeAcknowledgedAt || new Date().toISOString() });
  result.functionalPassed = true;
  stop = true; observer.abort(); await observerDone;
  const finalProcesses = await powershell('windows-process-snapshot.ps1', { rootProcessId: app.pid }); result.finalProcessIds = finalProcesses.map(p => p.pid);
  safeWorkerSend(app, { command: 'shutdown' }); const [exitCode] = await withinTime(exited, 35000); assert.equal(exitCode, 0);
  await free(39850); await free(39851); result.cleanExit = true;
} catch (error) { result.error = error.message; }
finally {
  stop = true; observer?.abort(); await observerDone?.catch(() => {});
  if (app && app.exitCode === null) { safeWorkerSend(app, { command: 'shutdown' }); try { await withinTime(exited, 35000); } catch { app.kill('SIGKILL'); result.cleanupWarning = true; } }
  await fixture?.close(); result.modelRequests = fixture?.requests || 0; result.finishedAt = new Date().toISOString();
  result.assessment = assessWakeRun(result); result.sleepVerified = result.assessment.power.status === 'verified'; result.passed = result.assessment.overallStatus === 'passed';
  if (manual && !result.sleepVerified) result.limitation = 'Power transition unverified: ' + result.assessment.power.reason;
  progress('finished');
  console.log(JSON.stringify({ passed: result.passed, mode: result.mode, sleepVerified: result.sleepVerified, assessment: result.assessment, workspace, checks: result.checks.length, error: result.error })); process.exitCode = result.passed ? 0 : 1;
}
