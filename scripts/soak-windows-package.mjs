import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { workerEnvironment } from '../runtime/worker-environment.mjs';
import { withinTime, safeWorkerSend } from '../runtime/worker-process.mjs';
import { packageModelFixture } from '../backend/test-support/package-model.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))), args = process.argv.slice(2);
const candidate = path.resolve(args[0] || ''), option = (name, fallback) => args.includes(name) ? Number(args[args.indexOf(name) + 1]) : fallback;
const durationSeconds = option('--duration-seconds', 1800), sampleSeconds = option('--sample-seconds', durationSeconds < 300 ? 5 : 15);
assert.equal(process.platform, 'win32'); assert.ok(args[0] && candidate.startsWith(path.join(root, 'artifacts') + path.sep), 'Only a local artifact, never the installed app');
assert.ok(Number.isFinite(durationSeconds) && durationSeconds >= 60 && durationSeconds <= 7200); assert.ok(Number.isFinite(sampleSeconds) && sampleSeconds >= 5 && sampleSeconds <= 30);
const manifest = JSON.parse(fs.readFileSync(path.join(candidate, 'resources/package-manifest.json'))); assert.ok(manifest.version.endsWith('-test'));
const workspace = fs.mkdtempSync(path.join(root, 'artifacts/stability-soak-')), local = path.join(workspace, '.local'); fs.mkdirSync(local);
fs.writeFileSync(path.join(local, 'personal.json'), JSON.stringify({ version: 1, revision: 0, model: 'ollama', memories: [], skills: {} }));
const origin = 'http://127.0.0.1:39850', rendererOrigin = 'http://127.0.0.1:39851';
const result = { passed: false, version: manifest.version, candidate, workspace, scope: 'Real packaged Electron/Node/workers; deterministic loopback Ollama; generated text/DOCX only; no microphone, real TTS, sleep or account', plannedDurationSeconds: durationSeconds, sampleSeconds, startedAt: new Date().toISOString(), samples: [], tasks: [], faults: [], issues: [], sse: { connections: 0, heartbeats: 0, events: 0, completions: {} } };
const save = () => fs.writeFileSync(path.join(workspace, 'soak-result.json'), JSON.stringify(result, null, 2));
const progressFile = path.join(workspace, 'soak-progress.json'), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let app, exited, fixture, headers, backendPid, owner, observer, observerDone, stopObserving = false, runStart, lastProgress = 0;
const elapsed = () => runStart === undefined ? 0 : (performance.now() - runStart) / 1000;
async function wait(predicate, ms = 30000) { const end = Date.now() + ms; while (!await predicate()) { if (Date.now() >= end) throw new Error('Soak condition timed out'); await delay(100); } }
async function api(route, body, { allowFailure = false, requestId } = {}) {
  const r = await fetch(origin + route, { headers: { ...headers, ...(requestId ? { 'X-Request-ID': requestId } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const value = await r.json(); if (!allowFailure) assert.equal(r.status, 200, value.error?.message || route); return { httpStatus: r.status, ...value };
}
async function free(port) { const s = net.createServer(); await new Promise((resolve, reject) => { s.once('error', reject); s.listen(port, '127.0.0.1', resolve); }); await new Promise(resolve => s.close(resolve)); }
async function processSnapshot() {
  const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolve, reject) => {
    const child = execFile(shell, ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts/windows-process-snapshot.ps1')], { windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024, env: workerEnvironment() }, (error, stdout) => { if (error) reject(new Error('Owned process metrics unavailable')); else try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, ''))); } catch { reject(new Error('Invalid process metrics response')); } });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify({ rootProcessId: app.pid }));
  });
}
function diagnosticStats(directory) { let bytes = 0, files = 0; if (!fs.existsSync(directory)) return { bytes, files }; for (const item of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, item.name); if (item.isDirectory()) { const nested = diagnosticStats(file); bytes += nested.bytes; files += nested.files; } else if (/\.jsonl(?:\.1)?$/.test(item.name)) { bytes += fs.statSync(file).size; files++; } } return { bytes, files }; }
function startObserver() {
  observerDone = (async () => {
    while (!stopObserving) {
      observer = new AbortController();
      try {
        const response = await fetch(origin + '/events', { headers, signal: observer.signal }); assert.equal(response.status, 200); result.sse.connections++;
        const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
        while (!stopObserving) {
          const { value, done } = await reader.read(); if (done) break;
          pending += decoder.decode(value, { stream: true }); const frames = pending.split('\n\n'); pending = frames.pop();
          for (const frame of frames) {
            if (frame.startsWith(': heartbeat')) result.sse.heartbeats++;
            const line = frame.split('\n').find(line => line.startsWith('data: ')); if (!line) continue;
            const event = JSON.parse(line.slice(6)); result.sse.events++;
            if (event.type === 'work.snapshot' && event.data?.status === 'completed') result.sse.completions[event.data.id] = (result.sse.completions[event.data.id] || 0) + 1;
          }
        }
      } catch { /* Connection drops are observed by health samples and fault checks. */ }
      if (!stopObserving) await delay(300);
    }
  })();
}
async function sample(phase = 'scheduled') {
  assert.equal(app.exitCode, null, 'Packaged application exited early');
  const status = await api('/status'), health = await api('/health'), processes = await processSnapshot();
  backendPid = status.pid; owner ||= status.activeLingboSessionId || status.sessionId;
  const main = processes.find(p => p.pid === app.pid); assert.ok(main, 'Owned Electron main process is missing');
  assert.ok(processes.some(p => p.pid === backendPid), 'Health endpoint is not owned by this app');
  const currentWork = await api('/work/status');
  const active = currentWork.jobs.filter(j => !['completed', 'cancelled', 'failed', 'paused', 'interrupted'].includes(j.status));
  const lingeringWorkers = !active.length ? processes.filter(p => /^node$/i.test(p.name) && p.pid !== backendPid).map(p => p.pid) : [];
  const item = { elapsedSeconds: Math.round(elapsed() * 10) / 10, at: new Date().toISOString(), phase, backendPid, connected: status.lingboConnected, gatewayRssMiB: health.memoryMiB, processes, activeJobs: active.length, retainedJobs: currentWork.jobs.length, lingeringWorkers, diagnostics: diagnosticStats(path.join(local, 'diagnostics')) };
  result.samples.push(item); fs.appendFileSync(path.join(workspace, 'samples.jsonl'), JSON.stringify(item) + '\n');
  if (lingeringWorkers.length) result.issues.push({ type: 'idle_workers_remaining', elapsedSeconds: item.elapsedSeconds, pids: lingeringWorkers });
  if (!item.connected && phase !== 'after-backend-restart') result.issues.push({ type: 'unexpected_character_disconnect', elapsedSeconds: item.elapsedSeconds });
  const progress = { workspace, version: result.version, elapsedSeconds: item.elapsedSeconds, plannedDurationSeconds: durationSeconds, completedTasks: result.tasks.filter(t => t.status === 'completed').length, taskCount: result.tasks.length, connected: item.connected, backendPid, mainPrivateMiB: Math.round(main.privateBytes / 1048576), processCount: processes.length, issueCount: result.issues.length, lastFault: result.faults.at(-1)?.type || null, stage: elapsed() >= durationSeconds * 5 / 6 ? 'idle-cooldown' : 'active-baseline' };
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2)); save();
  if (elapsed() - lastProgress >= 45 || result.samples.length === 1) { console.log(JSON.stringify({ type: 'progress', ...progress })); lastProgress = elapsed(); }
}
async function task(office = false, restart = false) {
  const index = result.tasks.length + 1, file = office ? 'proof.docx' : 'proof.md';
  const request = restart ? 'PACKAGE_WAIT PACKAGE_WORK create proof.md with Package work proof.' : office ? 'PACKAGE_OFFICE create proof.docx with Package Office proof.' : 'PACKAGE_WORK create proof.md with Package work proof.';
  const created = (await api('/work/submit', { request, acceptance: [{ path: file, contains: [office ? 'Package Office proof' : 'Package work proof'] }], rootIds: [] }, { requestId: 'soak-' + index })).task;
  const entry = { id: created.id, office, restart, output: created.output, status: created.status, submittedAtSeconds: Math.round(elapsed()) }; result.tasks.push(entry); save();
  if (restart) return entry;
  await wait(async () => { const job = (await api('/work/status')).jobs.find(j => j.id === entry.id); entry.status = job.status; if (['completed', 'failed', 'interrupted', 'paused'].includes(job.status)) { assert.equal(job.status, 'completed', job.error); assert.equal(job.verification?.scope, 'declared_outputs'); entry.mutationReceipts = job.receipts.filter(r => r.ok && r.mutation).length; entry.toolCalls = job.toolCalls; return true; } return false; }, 45000);
  assert.equal(entry.mutationReceipts, 1, 'A single output task must have one mutation receipt'); save(); return entry;
}
async function upstreamFault() {
  const begin = elapsed(), before = fixture.denied; fixture.setOffline(true);
  try { const failed = await api('/personal/model/probe', { id: 'ollama' }, { allowFailure: true }); assert.notEqual(failed.httpStatus, 200); assert.ok(fixture.denied > before); }
  finally { fixture.setOffline(false); }
  const recovered = await api('/personal/model/probe', { id: 'ollama' }); assert.equal(recovered.id, 'ollama');
  result.faults.push({ type: 'upstream-offline-and-recovery', atSeconds: begin, recovered: true, deniedRequests: fixture.denied - before }); await task(); save();
}
async function backendFault() {
  const entry = await task(false, true); await wait(() => fixture.pending > 0);
  const oldPid = backendPid, owned = await processSnapshot(); assert.ok(owned.some(p => p.pid === oldPid && p.parentPid === app.pid), 'Never kill a PID that is not this test app backend');
  const begin = elapsed(); process.kill(oldPid, 'SIGKILL');
  await wait(async () => { try { const status = await api('/status'); if (status.pid !== oldPid) { backendPid = status.pid; return true; } } catch {} return false; }, 30000);
  await wait(async () => (await api('/status')).lingboConnected === true, 25000);
  const restored = (await api('/work/status')).jobs.find(j => j.id === entry.id); assert.equal(restored.status, 'interrupted');
  const before = fixture.requests; fixture.releaseWaitingRequests(); await delay(Math.min(2000, durationSeconds * 10)); assert.equal(fixture.requests, before, 'Interrupted task resumed by itself'); assert.equal(fs.existsSync(path.join(entry.output, 'proof.md')), false);
  await api('/work/control', { taskId: entry.id, action: 'resume' });
  await wait(async () => { const job = (await api('/work/status')).jobs.find(j => j.id === entry.id); entry.status = job.status; if (['completed', 'failed', 'paused', 'interrupted'].includes(job.status)) { assert.equal(job.status, 'completed', job.error); entry.mutationReceipts = job.receipts.filter(r => r.ok && r.mutation).length; return true; } return false; });
  assert.equal(entry.mutationReceipts, 1); result.faults.push({ type: 'backend-crash-auto-restart-and-manual-task-resume', atSeconds: begin, recoveredAfterSeconds: Math.round((elapsed() - begin) * 10) / 10, oldPid, newPid: backendPid, taskId: entry.id, recovered: true }); await sample('after-backend-restart'); save();
}
async function sseFault() {
  const before = result.sse.connections; observer.abort(); await wait(() => result.sse.connections > before, 10000);
  const entry = await task(); await wait(() => result.sse.completions[entry.id] === 1, 10000); result.faults.push({ type: 'observer-sse-reconnect', atSeconds: Math.round(elapsed()), recovered: true, taskId: entry.id }); save();
}
try {
  await free(39850); await free(39851); fixture = await packageModelFixture();
  app = spawn(path.join(candidate, 'LingboDesk.exe'), [], { cwd: candidate, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...workerEnvironment(), VOICE_AGENT_WORKSPACE: workspace, LINGBO_GATEWAY_PORT: '39850', LINGBO_RENDERER_PORT: '39851' } }); exited = once(app, 'close'); exited.catch(() => {});
  await wait(async () => { if (app.exitCode !== null) throw new Error('Test app exited during startup'); try { return fs.existsSync(path.join(local, 'gateway-token')) && (await fetch(origin + '/bootstrap')).ok; } catch { return false; } });
  headers = { Authorization: 'Bearer ' + fs.readFileSync(path.join(local, 'gateway-token'), 'utf8').trim(), 'Content-Type': 'application/json' };
  await wait(async () => (await api('/status')).lingboConnected === true, 45000); owner = (await api('/status')).activeLingboSessionId || 'soak-fixture'; headers['X-Lingbo-Session'] = owner;
  runStart = performance.now(); result.measurementStartedAt = new Date().toISOString(); startObserver(); await wait(() => result.sse.connections > 0); await sample('initial');
  let nextSample = sampleSeconds, nextTask = Math.min(20, durationSeconds / 12), upstreamDone = false, backendDone = false, sseDone = false;
  while (elapsed() < durationSeconds) {
    const now = elapsed();
    if (!upstreamDone && now >= durationSeconds / 2) { upstreamDone = true; await upstreamFault(); }
    if (!backendDone && now >= durationSeconds * 0.6) { backendDone = true; await backendFault(); }
    if (!sseDone && now >= durationSeconds * 0.8) { sseDone = true; await sseFault(); }
    if (now >= nextTask && now < durationSeconds * 5 / 6) { await task(result.tasks.length % 5 === 4); nextTask = elapsed() + (durationSeconds < 300 ? Math.max(5, durationSeconds / 10) : now < 180 ? 60 : 30); }
    if (elapsed() >= nextSample) { await sample(); nextSample = elapsed() + sampleSeconds; }
    await delay(500);
  }
  await sample('final-idle'); result.actualMeasurementSeconds = Math.round(elapsed() * 10) / 10;
  const state = await api('/work/status'); assert.equal(state.jobs.length, result.tasks.length, 'Tasks lost or unexpectedly duplicated');
  assert.ok(state.jobs.every(j => j.status === 'completed' && j.receipts.filter(r => r.ok && r.mutation).length === 1), 'Task state or mutation count incorrect');
  for (const entry of result.tasks) assert.equal(result.sse.completions[entry.id], 1, 'Completion snapshot lost or duplicated at the observer');
  result.maxSampleGapSeconds = Math.max(...result.samples.slice(1).map((s, i) => s.elapsedSeconds - result.samples[i].elapsedSeconds));
  if (result.maxSampleGapSeconds > Math.max(60, sampleSeconds * 3)) result.issues.push({ type: 'measurement_gap', seconds: result.maxSampleGapSeconds });
  result.functionalPassed = result.issues.length === 0 && result.faults.length === 3;
  stopObserving = true; observer.abort(); await observerDone;
  safeWorkerSend(app, { command: 'shutdown' }); const [code] = await withinTime(exited, 35000); assert.equal(code, 0); await free(39850); await free(39851);
  result.cleanExit = true; result.passed = result.functionalPassed; result.modelRequests = fixture.requests; result.actualCloudCalls = 0; result.audioPlaybackTested = false;
} catch (error) { result.error = error.message; process.exitCode = 1; }
finally {
  stopObserving = true; observer?.abort(); await observerDone?.catch(() => {});
  if (app && app.exitCode === null) { safeWorkerSend(app, { command: 'shutdown' }); try { await withinTime(exited, 35000); } catch { app.kill('SIGKILL'); result.cleanupWarning = true; } }
  await fixture?.close(); result.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ type: 'finished', passed: result.passed, workspace, durationSeconds: result.actualMeasurementSeconds, tasks: result.tasks.length, samples: result.samples.length, issues: result.issues, error: result.error })); process.exitCode = result.passed ? 0 : 1;
}
