// Real report worker and file tools with deterministic local model responses.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))), workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-report-fixture-'));
const worker = new Worker(new URL('../backend/test-support/model-fixture.mjs', import.meta.url), { workerData: { mode: 'report', entry: path.join(root, 'backend/server.mjs') }, env: { ...process.env, VOICE_AGENT_WORKSPACE: workspace, LINGBO_GATEWAY_PORT: '3856', LINGBO_TASK_HOLD_MS: '10', DEEPSEEK_API_KEY: 'synthetic-report-fixture-only' } });
const result = { passed: false, scope: 'Real report gateway, worker, file tools and checkpoints; deterministic model; no cloud.' };
let failure; worker.on('error', error => { failure = error; });
try {
  const origin = 'http://127.0.0.1:3856'; let bootstrap;
  for (let i = 0; i < 80; i++) { if (failure) throw failure; try { bootstrap = await fetch(origin + '/bootstrap').then(r => r.json()); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
  assert.ok(bootstrap?.token);
  const headers = { Authorization: 'Bearer ' + bootstrap.token, 'Content-Type': 'application/json', 'X-Lingbo-Session': 'report-fixture', 'X-Request-ID': 'report-fixture-1' };
  const response = await fetch(origin + '/task-control', { method: 'POST', headers, body: JSON.stringify({ action: 'create' }) }); assert.equal(response.status, 200);
  const created = await response.json(), id = created.task.id; let task;
  for (let i = 0; i < 160; i++) { const state = await fetch(origin + '/status', { headers }).then(r => r.json()); task = state.jobs.find(j => j.id === id); if (['completed', 'failed', 'interrupted', 'cancelled'].includes(task?.status)) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal(task?.status, 'completed', JSON.stringify({ status: task?.status, error: task?.error }));
  assert.deepEqual(task.completed, ['extract', 'report']);
  for (const stage of ['extract', 'report']) assert.ok(task.evidence.some(e => e.tool === 'write_file' && e.path === stage + '.md' && e.ok));
  const nextResponse = await fetch(origin + '/task-control', { method: 'POST', headers: { ...headers, 'X-Request-ID': 'report-fixture-2' }, body: JSON.stringify({ action: 'create' }) });
  assert.equal(nextResponse.status, 200); const next = await nextResponse.json();
  const cancellation = await fetch(origin + '/task-control', { method: 'POST', headers, body: JSON.stringify({ action: 'cancel', taskId: next.task.id }) }); assert.equal(cancellation.status, 200);
  let cancelled;
  for (let i = 0; i < 100; i++) { const state = await fetch(origin + '/status', { headers }).then(r => r.json()); cancelled = state.jobs.find(j => j.id === next.task.id); if (cancelled?.status === 'cancelled') break; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal(cancelled?.status, 'cancelled'); assert.deepEqual(cancelled.artifacts, []);
  const logs = fs.readdirSync(path.join(workspace, '.local', 'diagnostics')).filter(name => name.endsWith('.jsonl'));
  for (const name of logs) assert.doesNotMatch(fs.readFileSync(path.join(workspace, '.local', 'diagnostics', name), 'utf8'), /资料提取|产品定位|synthetic-report-fixture-only/);
  Object.assign(result, { passed: true, taskStatus: task.status, stages: task.completed, cancelledTaskStatus: cancelled.status, newDiagnosticBodiesStored: false });
} catch (error) { result.error = error.message; process.exitCode = 1; }
finally { await worker.terminate(); console.log(JSON.stringify(result, null, 2)); }
