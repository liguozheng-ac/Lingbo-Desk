import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { documentEnvironment, workerEnvironment } from '../runtime/worker-environment.mjs';
import { withinTime } from '../runtime/worker-process.mjs';
import { hashFile } from '../backend/work-policy.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))), args = process.argv.slice(2);
assert.ok(args.includes('--run-real') && args.includes('--services'), 'Explicit --run-real --services <services.dpapi> required; this consumes API quota');
const credentials = path.resolve(args[args.indexOf('--services') + 1]); assert.equal(path.basename(credentials), 'services.dpapi');
assert.ok(process.env.VOICE_PYTHON, 'Provide a complete Python runtime via VOICE_PYTHON');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const workspace = fs.mkdtempSync(path.join(root, 'artifacts/long-document-evaluation-')), local = path.join(workspace, '.local'), input = path.join(workspace, 'synthetic-input'); fs.mkdirSync(local); fs.mkdirSync(input);
fs.copyFileSync(credentials, path.join(local, 'services.dpapi'));
const fixtureScript = path.join(root, 'backend/test-support/long-documents.py');
const fixture = JSON.parse(execFileSync(process.env.VOICE_PYTHON, [fixtureScript, 'make-long', input], { encoding: 'utf8', windowsHide: true, env: documentEnvironment() }));
const sourceHash = hashFile(fixture.file), sourceMtime = fs.statSync(fixture.file).mtimeMs;
const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); const origin = 'http://127.0.0.1:' + port;
const result = { passed: false, scope: 'Actual DeepSeek, work broker and Python DOCX adapter; generated long document with read-only source grant; no personal file or Office GUI', workspace, sourceCharacters: fixture.characters, modelRequestLimit: 14, outputTokenLimitPerRequest: 1200, modelRequests: [], approvals: [], monetaryCost: null };
const save = () => fs.writeFileSync(path.join(workspace, 'long-document-result.json'), JSON.stringify(result, null, 2));
let worker, headers, taskId, failure; const started = performance.now();
async function api(route, body) { const r = await fetch(origin + route, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) }); const value = await r.json(); assert.equal(r.status, 200, value.error?.message || route); return value; }
try {
  worker = new Worker(new URL('../backend/test-support/real-service-gateway.mjs', import.meta.url), { workerData: { requestLimit: 14 }, env: { ...workerEnvironment(), VOICE_AGENT_WORKSPACE: workspace, LINGBO_GATEWAY_PORT: String(port), VOICE_PYTHON: process.env.VOICE_PYTHON }, stdout: true, stderr: true });
  worker.stdout.resume(); worker.stderr.resume(); worker.on('error', () => { failure = new Error('Evaluation gateway failed; raw output not retained'); });
  worker.on('message', message => { if (message.type === 'model-metric') { result.modelRequests.push(message.value); save(); } });
  for (let i = 0; i < 150; i++) { if (failure) throw failure; try { if ((await fetch(origin + '/bootstrap')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  headers = { Authorization: 'Bearer ' + fs.readFileSync(path.join(local, 'gateway-token'), 'utf8').trim(), 'Content-Type': 'application/json', 'X-Lingbo-Session': 'long-document-fixture', 'X-Request-ID': 'long-document-edit' };
  const granted = await api('/work/permissions', { action: 'grant', directory: input, mode: 'read', revision: 0 });
  const created = (await api('/work/submit', { request: `只处理合成资料 ${fixture.file}。它超过10万字，待改位置字符偏移约 ${fixture.offset}。先用 work_read 的 offset/limit 仅读取附近100字并取得SHA256，然后 work_copy 到本任务产物目录的 edited.docx。对副本只将“待改,”精确替换为“已改，”，保留全部其他内容和结构。读取副本取得当前SHA256后使用 work_edit；需要确认时等待确认卡。不要修改原件，不要读取全文，不要用创建新Word重写原有结构。检查副本后用 work_finish 提交完成。`, rootIds: granted.roots.map(r => r.id), acceptance: [{ path: 'edited.docx', contains: ['已改，'], notContains: ['待改,'] }] })).task;
  taskId = created.id; const expected = path.join(created.output, 'edited.docx'); let task;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    task = (await api('/work/status')).jobs.find(j => j.id === taskId);
    if (task.approval) {
      const p = task.approval;
      const approved = p.tool === 'work_edit' && path.relative(expected, p.path) === '' && p.oldText === '待改,' && p.newText === '已改，' && fs.existsSync(expected) && p.before === hashFile(expected) && p.detail?.replacements === 1;
      result.approvals.push({ id: p.id, approved, scope: 'Only the exact generated-copy punctuation replacement stated in this test; no general approval' }); save();
      await api('/work/approve', { taskId, approvalId: p.id, version: task.version, approved });
      if (!approved) throw new Error('Model requested an action outside the explicit synthetic-fixture approval');
    }
    if (['completed', 'failed', 'interrupted', 'paused', 'cancelled'].includes(task.status)) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.equal(task.status, 'completed', task.error || task.result || 'Task did not complete'); assert.equal(task.verification.scope, 'declared_outputs');
  assert.ok(task.receipts.some(r => r.ok && r.tool === 'work_copy')); assert.ok(task.receipts.some(r => r.ok && r.tool === 'work_edit'));
  const structural = JSON.parse(execFileSync(process.env.VOICE_PYTHON, [fixtureScript, 'verify-edited-copy', input, expected], { encoding: 'utf8', windowsHide: true, env: documentEnvironment() }));
  assert.equal(structural.passed, true); assert.equal(hashFile(fixture.file), sourceHash); assert.equal(fs.statSync(fixture.file).mtimeMs, sourceMtime);
  Object.assign(result, { passed: true, taskId, toolCalls: task.toolCalls, readCharacters: task.receipts.filter(r => r.ok && r.tool === 'work_read').reduce((sum, r) => sum + (r.result.content?.length || 0), 0), sourceUnchanged: true, structural, verification: task.verification, receipts: task.receipts.map(r => ({ tool: r.tool, ok: r.ok })), artifact: expected });
} catch (error) { result.error = error.message; if (taskId) await api('/work/control', { taskId, action: 'cancel' }).catch(() => {}); }
finally {
  if (worker) { const exit = once(worker, 'exit'); worker.postMessage({ command: 'shutdown' }); try { await withinTime(exit, 30000); } catch { await worker.terminate(); result.passed = false; result.shutdownWarning = true; } }
  result.elapsedMs = Math.round(performance.now() - started); result.inputTokens = result.modelRequests.reduce((sum, r) => sum + (r.inputTokens || 0), 0); result.outputTokens = result.modelRequests.reduce((sum, r) => sum + (r.outputTokens || 0), 0); save();
  console.log(JSON.stringify({ passed: result.passed, workspace, characters: result.sourceCharacters, elapsedMs: result.elapsedMs, modelRequests: result.modelRequests.length, ...(result.error ? { error: result.error } : {}) })); process.exitCode = result.passed ? 0 : 1;
}
