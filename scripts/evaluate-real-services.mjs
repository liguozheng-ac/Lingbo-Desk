import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { workerEnvironment } from '../runtime/worker-environment.mjs';
import { withinTime } from '../runtime/worker-process.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2), argument = name => args[args.indexOf(name) + 1];
if (!args.includes('--run-real') || !args.includes('--services')) throw new Error('Explicitly provide --run-real --services <encrypted services.dpapi>; this uses real provider quota.');
const input = path.resolve(argument('--services'));
const selected = args.includes('--only') ? argument('--only').split(',') : null;
const caseIds = ['deepseek-connection', 'asr-connection', 'tts-connection', 'dialogue-context', 'speech-roundtrip-zh', 'speech-roundtrip-ja', 'speech-roundtrip-en', 'file-create', 'office-docx', 'browser-read'];
if (selected && (new Set(selected).size !== selected.length || selected.some(id => !caseIds.includes(id)))) throw new Error('Unknown or duplicate evaluation case');
if (path.basename(input) !== 'services.dpapi' || !fs.statSync(input).isFile()) throw new Error('Provide an explicit encrypted service configuration, never a plaintext key');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const workspace = fs.mkdtempSync(path.join(root, 'artifacts/real-evaluation-')), local = path.join(workspace, '.local'); fs.mkdirSync(local);
fs.copyFileSync(input, path.join(local, 'services.dpapi'));
const portProbe = net.createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve)); const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
const origin = 'http://127.0.0.1:' + port, requestLimit = 24;
const result = { startedAt: new Date().toISOString(), scope: 'Real providers, synthetic data, actual Agent workers and file tools, fresh headless Edge profile. No microphone, audio playback, personal document or signed-in browser.', workspace, conditions: { modelRequestLimit: requestLimit, outputTokensPerModelRequestMax: 1200, speechLanguage: 'auto', microphone: false, selectedCases: selected || caseIds }, cases: [], modelRequests: [], cost: { amount: null, currency: null, reason: 'Provider billing was not read; token usage and synthesis characters are reported, without inventing monetary costs.' } };
const save = () => fs.writeFileSync(path.join(workspace, 'evaluation-result.json'), JSON.stringify(result, null, 2));
let worker, failure, headers;
async function api(route, body, timeout = 150000) {
  const response = await fetch(origin + route, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeout) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error?.message || 'HTTP ' + response.status); return value;
}
async function run(id, fn) {
  if (selected && !selected.includes(id)) return;
  const start = performance.now(), first = result.modelRequests.length;
  const item = { id, passed: false }; result.cases.push(item);
  try { Object.assign(item, await fn(), { passed: true }); }
  catch (error) { item.error = error.message; }
  item.elapsedMs = Math.round(performance.now() - start); item.modelSequences = result.modelRequests.slice(first).map(m => m.sequence);
  save(); console.log(JSON.stringify({ case: id, passed: item.passed, elapsedMs: item.elapsedMs, ...(item.error ? { error: item.error } : {}) }));
}
async function workCase(id, request, contains, requiredTool) {
  return run(id, async () => {
    headers['X-Request-ID'] = id;
    const name = id === 'office-docx' ? 'evaluation.docx' : id === 'browser-read' ? 'browser.md' : 'result.md';
    const created = (await api('/work/submit', { request, acceptance: [{ path: name, contains }], rootIds: [] })).task;
    let job;
    const end = Date.now() + 240000;
    while (Date.now() < end) {
      if (failure) throw failure;
      job = (await api('/work/status')).jobs.find(j => j.id === created.id);
      if (job.approval) { await api('/work/control', { taskId: job.id, action: 'cancel' }); throw new Error('Task requested a high-risk approval; the evaluator did not approve it.'); }
      if (['completed', 'failed', 'interrupted', 'paused', 'cancelled'].includes(job.status)) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (job.status !== 'completed') { await api('/work/control', { taskId: job.id, action: 'cancel' }).catch(() => {}); throw new Error('Task did not complete: ' + job.status + ' / ' + (job.error || job.result || 'evaluation timeout')); }
    if (job.verification?.scope !== 'declared_outputs') throw new Error('No declared-output verification');
    if (!job.receipts.some(r => r.tool === requiredTool && r.ok)) throw new Error('Expected real tool receipt missing');
    if (id === 'browser-read' && !job.receipts.some(r => r.tool === 'work_browser' && r.ok && JSON.stringify(r.result).includes('Example Domain'))) throw new Error('No actual browser page evidence');
    return { taskId: job.id, artifact: path.join(job.output, name), verification: job.verification, toolCalls: job.toolCalls, receipts: job.receipts.map(r => ({ tool: r.tool, ok: r.ok })) };
  });
}
try {
  worker = new Worker(new URL('../backend/test-support/real-service-gateway.mjs', import.meta.url), { workerData: { requestLimit }, env: { ...workerEnvironment(), VOICE_AGENT_WORKSPACE: workspace, LINGBO_GATEWAY_PORT: String(port), ...(process.env.VOICE_PYTHON ? { VOICE_PYTHON: process.env.VOICE_PYTHON } : {}) }, stdout: true, stderr: true });
  worker.stdout.resume(); worker.stderr.resume(); worker.on('error', () => { failure = new Error('Evaluation gateway failed; raw output was not retained'); });
  worker.on('message', message => { if (message.type === 'model-metric') { result.modelRequests.push(message.value); save(); } });
  for (let i = 0; i < 200; i++) { if (failure) throw failure; try { if ((await fetch(origin + '/bootstrap')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  headers = { Authorization: 'Bearer ' + fs.readFileSync(path.join(local, 'gateway-token'), 'utf8').trim(), 'Content-Type': 'application/json', 'X-Lingbo-Session': 'real-evaluation' };
  await run('deepseek-connection', async () => { const probe = await api('/settings/services/probe', { id: 'deepseek' }); return { providerElapsedMs: probe.elapsedMs, model: probe.model }; });
  for (const id of ['asr', 'tts']) await run(id + '-connection', async () => { const probe = await api('/settings/services/probe', { id }); return { providerElapsedMs: probe.elapsedMs, scope: probe.scope, ...(probe.bytes ? { audioBytes: probe.bytes } : {}) }; });
  await run('dialogue-context', async () => {
    const messages = [{ role: 'user', content: '二加三等于几？只回复阿拉伯数字。' }];
    const first = await api('/v1/chat/completions', { messages, max_tokens: 40 }); const reply = first.choices?.[0]?.message?.content?.trim();
    if (reply !== '5') throw new Error('First arithmetic response did not match 5');
    messages.push({ role: 'assistant', content: reply }, { role: 'user', content: '把刚才的结果乘以二，只回复阿拉伯数字。' });
    const second = await api('/v1/chat/completions', { messages, max_tokens: 40 });
    if (second.choices?.[0]?.message?.content?.trim() !== '10') throw new Error('Context response did not match 10');
    return { expected: ['5', '10'], scope: 'API dialogue context, not the microphone or character renderer' };
  });
  await api('/settings/language', { language: 'auto' });
  for (const [language, text] of [['zh', '今天是语音测试，答案是五。'], ['ja', 'これは音声テストです。答えは五です。'], ['en', 'This is a speech test. The answer is five.']]) await run('speech-roundtrip-' + language, async () => {
    const response = await fetch(origin + '/v1/audio/speech', { method: 'POST', headers, body: JSON.stringify({ input: text, language }), signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error('TTS HTTP ' + response.status);
    const audio = await response.arrayBuffer(); if (!audio.byteLength) throw new Error('Empty synthesized audio');
    const form = new FormData(); form.set('file', new Blob([audio], { type: 'audio/mpeg' }), 'synthetic.mp3');
    const recognized = await fetch(origin + '/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: headers.Authorization, 'X-Lingbo-Session': 'real-evaluation' }, body: form, signal: AbortSignal.timeout(60000) });
    const value = await recognized.json(); if (!recognized.ok) throw new Error(value.error?.message || 'ASR HTTP ' + recognized.status);
    const transcript = value.text || '';
    if (!/(?:五|5|five)/i.test(transcript)) throw new Error('ASR roundtrip did not retain the expected answer');
    return { language, synthesisCharacters: text.length, audioBytes: audio.byteLength, transcript, scope: 'Synthetic TTS-to-ASR, automatic language mode; no acoustic/interrupt test' };
  });
  await workCase('file-create', '在本任务产物目录创建 result.md，正文必须包含“评测编号：LBD-001”和“合计：15”。计算依据为 3、5、7 相加。核对后用 work_finish 提交完成，不要操作其他文件。', ['评测编号：LBD-001', '合计：15'], 'work_write');
  await workCase('office-docx', '用 work_office 在本任务产物目录新建 evaluation.docx，包含标题“聆泊合成测试”和一段“此文件仅使用合成资料，不包含个人信息。”。用实际读取结果检查，再调用 work_finish 完成。不修改任何已有文档。', ['聆泊合成测试', '此文件仅使用合成资料'], 'work_office');
  await workCase('browser-read', '用 work_browser 打开公开网页 https://example.com 并读取实际页面快照。在任务产物目录创建 browser.md，包含页面的实际标题以及一句正文摘要。不要使用其他网页读取工具，不登录、不点击、不填写表单。完成后调用 work_finish。', ['Example Domain'], 'work_browser');
  result.voiceMetrics = await api('/voice/metrics');
} catch (error) { result.error = error.message; }
finally {
  if (worker) { const exit = once(worker, 'exit'); worker.postMessage({ command: 'shutdown' }); try { await withinTime(exit, 30000); } catch { await worker.terminate(); result.shutdownWarning = 'Gateway had to be terminated after its graceful-shutdown deadline'; } }
  result.finishedAt = new Date().toISOString(); result.passed = result.cases.length === (selected || caseIds).length && result.cases.every(c => c.passed) && !result.error && !result.shutdownWarning;
  result.totals = { cases: result.cases.length, passed: result.cases.filter(c => c.passed).length, modelRequests: result.modelRequests.length, usageReportedRequests: result.modelRequests.filter(m => m.usageAvailable).length, inputTokens: result.modelRequests.reduce((s, m) => s + (m.inputTokens || 0), 0), outputTokens: result.modelRequests.reduce((s, m) => s + (m.outputTokens || 0), 0) };
  save();
  fs.writeFileSync(path.join(workspace, 'evaluation-summary.md'), '# 真实服务评测\n\n' + result.scope + '\n\n| 场景 | 结果 | 耗时 ms |\n|---|---|---:|\n' + result.cases.map(c => `| ${c.id} | ${c.passed ? '通过' : '未通过'} | ${c.elapsedMs} |`).join('\n') + '\n\n费用：暂无可靠货币金额；详见 JSON 的实际服务用量。样本仅一次，不代表总体任务成功率、延迟分布或真人语音体验。\n');
  console.log(JSON.stringify({ saved: true, workspace, passed: result.passed, totals: result.totals }));
  process.exitCode = result.passed ? 0 : 1;
}
