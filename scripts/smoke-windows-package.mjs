import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { workerEnvironment } from '../runtime/worker-environment.mjs';
import { withinTime, safeWorkerSend } from '../runtime/worker-process.mjs';
import { packageModelFixture } from '../backend/test-support/package-model.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))), candidate = path.resolve(process.argv[2] || '');
assert.ok(process.argv[2], 'Provide a newly built candidate, never the installed application');
const resources = path.join(candidate, 'resources'), manifest = JSON.parse(fs.readFileSync(path.join(resources, 'package-manifest.json'), 'utf8'));
assert.equal(manifest.version, '0.3.4-test');
assert.ok(fs.existsSync(path.join(candidate, 'LingboDesk.exe')), 'Candidate executable is missing');
const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const workspace = fs.mkdtempSync(path.join(artifacts, 'package-smoke-')), local = path.join(workspace, '.local'); fs.mkdirSync(local);
fs.writeFileSync(path.join(local, '.env'), 'DEEPSEEK_API_KEY=synthetic-package-fixture-only\n');
fs.writeFileSync(path.join(local, 'personal.json'), JSON.stringify({ version: 1, revision: 0, model: 'ollama', memories: [], skills: {} }));
const evidence = { scope: 'Real packaged Electron, Node, Python and workers; local deterministic Ollama fixture; no cloud.', workspace, candidate, passed: false, checks: [] };
const save = () => fs.writeFileSync(path.join(workspace, 'smoke-result.json'), JSON.stringify(evidence, null, 2));
const check = (name, detail = {}) => { evidence.checks.push({ name, passed: true, ...detail }); save(); console.log('PASS ' + name); };
async function waitFor(predicate, timeout = 30000) { const end = Date.now() + timeout; while (!await predicate()) { if (Date.now() > end) throw new Error('Packaged smoke condition timed out'); await new Promise(resolve => setTimeout(resolve, 100)); } }
async function free(port) { const s = net.createServer(); await new Promise((resolve, reject) => { s.once('error', reject); s.listen(port, '127.0.0.1', resolve); }); await new Promise(resolve => s.close(resolve)); }
let fixture, app, exited, backendPid, headers;
const origin = 'http://127.0.0.1:39850';
async function api(route, body) { const response = await fetch(origin + route, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) }); const value = await response.json(); assert.equal(response.status, 200, value.error?.message || route); return value; }
async function work(request, acceptance = []) { headers['X-Request-ID'] = 'package-' + evidence.checks.length + '-' + Date.now(); return (await api('/work/submit', { request, acceptance, rootIds: [] })).task; }
async function state(id, statuses) { let result; await waitFor(async () => { result = (await api('/work/status')).jobs.find(j => j.id === id); return statuses.includes(result?.status); }); return result; }
try {
  await free(39850); await free(39851); fixture = await packageModelFixture();
  app = spawn(path.join(candidate, 'LingboDesk.exe'), [], { cwd: candidate, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...workerEnvironment(), VOICE_AGENT_WORKSPACE: workspace, LINGBO_GATEWAY_PORT: '39850', LINGBO_RENDERER_PORT: '39851' } });
  exited = once(app, 'close');
  exited.catch(() => {});
  await waitFor(async () => { if (app.exitCode !== null) throw new Error('Packaged app exited during startup'); try { return fs.existsSync(path.join(local, 'gateway-token')) && (await fetch(origin + '/bootstrap')).ok; } catch { return false; } });
  const token = fs.readFileSync(path.join(local, 'gateway-token'), 'utf8').trim();
  headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Lingbo-Session': 'packaged-smoke', 'X-Request-ID': 'package-initial' };
  const status = await api('/status'); backendPid = status.pid;
  await waitFor(async () => { try { return (await fetch('http://127.0.0.1:39851/')).ok; } catch { return false; } });
  const html = await fetch('http://127.0.0.1:39851/').then(r => r.text()); assert.match(html, /__lingboRuntime/); assert.match(html, /39850/);
  assert.equal(fs.existsSync(path.join(resources, 'migration-source.json')), false);
  check('fresh isolated startup without historical migration input', { appPid: app.pid, backendPid });
  await waitFor(async () => (await api('/status')).lingboConnected === true, 45000);
  check('native character renderer connects its real task bridge');
  await api('/personal/model/select', { id: 'ollama' }); check('local model selection and probe');
  let task = await work('PACKAGE_WORK create proof.md with Package work proof.', [{ path: 'proof.md', contains: ['Package work proof'] }]);
  task = await state(task.id, ['completed', 'failed', 'paused']); assert.equal(task.status, 'completed', task.error); assert.equal(task.verification.scope, 'declared_outputs');
  check('packaged work process creates and verifies a real file');
  let office = await work('PACKAGE_OFFICE create proof.docx with Package Office proof.', [{ path: 'proof.docx', contains: ['Package Office proof'] }]);
  office = await state(office.id, ['completed', 'failed', 'paused']); assert.equal(office.status, 'completed', office.error);
  assert.equal(fs.readFileSync(path.join(office.output, 'proof.docx')).subarray(0, 2).toString(), 'PK'); check('packaged Office Python creates and reopens DOCX');
  let waiting = await work('PACKAGE_WAIT wait for further requirements.'); await state(waiting.id, ['running']); await waitFor(() => fixture.pending > 0);
  await api('/work/control', { taskId: waiting.id, action: 'pause' }); waiting = await state(waiting.id, ['paused']); await waitFor(() => fixture.pending === 0);
  await api('/work/control', { taskId: waiting.id, action: 'modify', version: waiting.version, request: 'PACKAGE_WORK create resumed.md with Package work proof.', acceptance: [{ path: 'resumed.md', contains: ['Package work proof'] }] });
  await api('/work/control', { taskId: waiting.id, action: 'resume' }); waiting = await state(waiting.id, ['completed', 'failed', 'paused']); assert.equal(waiting.status, 'completed', waiting.error);
  check('pause, change requirements and resume with a fresh worker');
  let cancelled = await work('PACKAGE_WAIT wait for cancellation.'); await state(cancelled.id, ['running']); await waitFor(() => fixture.pending > 0);
  await api('/work/control', { taskId: cancelled.id, action: 'cancel' }); cancelled = await state(cancelled.id, ['cancelled']); await waitFor(() => fixture.pending === 0); check('cancel aborts pending inference');
  headers['X-Request-ID'] = 'package-report'; const report = (await api('/task-control', { action: 'create', requirements: 'PACKAGE_REPORT produce the isolated test report.' })).task;
  let reportState; await waitFor(async () => { reportState = (await api('/status')).jobs.find(j => j.id === report.id); return ['completed', 'failed', 'interrupted'].includes(reportState?.status); }, 45000);
  assert.equal(reportState.status, 'completed', reportState.error); assert.deepEqual(reportState.completed, ['extract', 'report']); check('packaged report worker and file checkpoints');
  const wave = Buffer.alloc(6444); wave.write('RIFF'); wave.writeUInt32LE(6436, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(16000, 24); wave.writeUInt32LE(32000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(6400, 40);
  const input = path.join(workspace, 'silent.wav'), pcm = path.join(workspace, 'silent.pcm'); fs.writeFileSync(input, wave);
  execFileSync(path.join(resources, 'python/python.exe'), ['-I', path.join(resources, 'service/speech/decode-audio.py'), input, pcm], { windowsHide: true, env: workerEnvironment(), timeout: 15000 });
  assert.equal(fs.statSync(pcm).size, 6400); check('bundled audio decoder processes synthetic audio without playback');
  if (process.argv.includes('--ui-hold')) {
    const resumeFile = path.join(workspace, 'continue-smoke');
    fs.writeFileSync(path.join(artifacts, 'package-smoke-current.json'), JSON.stringify({ workspace, appPid: app.pid, backendPid, resumeFile }));
    console.log('READY_FOR_UI ' + workspace);
    await waitFor(() => fs.existsSync(resumeFile), 60000).catch(() => {});
  }
  // Start this request after UI inspection so the deliberate wait does not hit
  // the production model's idle timeout before the shutdown under test.
  const pendingOnExit = await work('PACKAGE_WAIT wait while the application exits.'); await state(pendingOnExit.id, ['running']); await waitFor(() => fixture.pending > 0);
  assert.equal(safeWorkerSend(app, { command: 'shutdown' }), true); const [code] = await withinTime(exited, 35000); assert.equal(code, 0);
  assert.throws(() => process.kill(backendPid, 0)); await waitFor(() => fixture.pending === 0); await free(39850); await free(39851);
  const stopped = JSON.parse(fs.readFileSync(path.join(local, 'work-tasks', pendingOnExit.id, 'task.json'), 'utf8')); assert.equal(stopped.status, 'paused');
  check('graceful app exit stops active work, reaps backend and releases both ports');
  function verifyLogs(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) verifyLogs(file);
      else if (/\.jsonl(?:\.1)?$/.test(entry.name)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /synthetic-package-fixture-only|Package work proof|Package Office proof|PACKAGE_WAIT/);
    }
  }
  verifyLogs(path.join(local, 'diagnostics'));
  check('launcher, gateway and worker diagnostic logs contain no test credential or document body');
  evidence.passed = true; evidence.modelRequests = fixture.requests; evidence.actualCloudCalls = 0; save();
} catch (error) { evidence.error = error.message; save(); process.exitCode = 1; }
finally {
  if (app && app.exitCode === null) {
    safeWorkerSend(app, { command: 'shutdown' });
    try { await withinTime(exited, 35000); } catch { if (process.platform === 'win32' && Number.isSafeInteger(app.pid)) execFileSync(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else app.kill('SIGKILL'); }
  }
  await fixture?.close(); console.log(JSON.stringify(evidence, null, 2));
}
