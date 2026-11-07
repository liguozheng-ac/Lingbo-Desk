// Actual callLLM loop, deterministic model, intercepted executor. No cloud or user files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { initializeData, source } from '../runtime/shared.mjs';
import { runVerifiedWork } from '../backend/work-finalize.mjs';
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-boundaries-'));
initializeData(isolated);
const { config } = await import(source('src/config.js'));
Object.assign(config, { provider: 'custom', apiKey: 'synthetic-test-only', model: 'fixture', baseURL: 'http://127.0.0.1:9/v1', apiFormat: 'chat-completions' });
const { callLLM } = await import(source('src/llm.js'));
const { installTool } = await import(source('src/capabilities/marketplace/index.js'));
for (const name of ['work_write', 'work_finish']) await installTool({ name, description: 'Synthetic fixture', parameters: { type: 'object', properties: {} }, permissions: { network: false, exec: false }, code: 'return JSON.stringify({ok:true});' });
const call = (name, i) => ({ id: 'call-' + i, name, arguments: JSON.stringify({ path: 'fixture-' + i + '.txt', content: 'synthetic' }) });
const results = [];
async function scenario(name, rounds, extra, expected) {
  const seen = []; let round = 0;
  await callLLM({ systemPrompt: 'Local boundary regression.', message: 'Synthetic tools only.', tools: ['read_file', 'write_file'], localReply: true, mustReply: true, maxTokens: 100, toolLoopLimits: { maxRounds: 4, maxTotalCalls: 2 }, ...extra,
    _streamOnceForTest: async () => ({ content: '', toolCalls: rounds[round++] || [] }),
    _executeToolForTest: async tool => { seen.push(tool); return JSON.stringify({ ok: true }); },
  });
  assert.deepEqual(seen, expected, name); results.push({ name, passed: true, dispatched: seen.length });
}
try {
  await scenario('unadvertised native write', [[call('write_file', 1)]], { tools: ['read_file'] }, []);
  await scenario('pinned host allowlist', [[call('write_file', 1), call('read_file', 2)]], { executionPolicy: { allowedTools: ['read_file'] } }, ['read_file']);
  await scenario('parallel overflow', [[1, 2, 3, 4].map(i => call('read_file', i))], {}, ['read_file', 'read_file']);
  await scenario('one-call budget cannot dispatch a second serial read', [[1, 2, 3].map(i => call('read_file', i))], { toolLoopLimits: { maxRounds: 3, maxTotalCalls: 1 } }, ['read_file']);
  await scenario('serial overflow', [[1, 2, 3, 4].map(i => call('write_file', i))], {}, ['write_file', 'write_file']);
  await scenario('cross-round overflow', [[call('read_file', 1)], [call('read_file', 2)], [call('read_file', 3)]], {}, ['read_file', 'read_file']);
  const seen = []; let round = 0;
  await runVerifiedWork(callLLM, { tools: ['work_write', 'work_finish'], systemPrompt: 'Local finalizer fixture.', message: 'Create synthetic output.', localReply: true, mustReply: true, maxTokens: 100, toolLoopLimits: { maxRounds: 2, maxTotalCalls: 4 },
    _streamOnceForTest: async () => ({ content: '', toolCalls: round++ < 2 ? [call('work_write', round)] : [call('work_write', 99), call('work_finish', 100)] }),
    _executeToolForTest: async tool => { seen.push(tool); return JSON.stringify(tool === 'work_finish' ? { ok: true, outcome: 'complete' } : { ok: true }); },
  });
  assert.deepEqual(seen, ['work_write', 'work_write', 'work_finish']);
  results.push({ name: 'actual finalizer cannot replay work_write', passed: true, dispatched: seen.length });
  const capped = []; let capRound = 0;
  await runVerifiedWork(callLLM, { tools: ['work_write', 'work_finish'], systemPrompt: 'Shared budget fixture.', message: 'Synthetic tools only.', localReply: true, mustReply: true, maxTokens: 100, toolLoopLimits: { maxRounds: 1, maxTotalCalls: 4 },
    _streamOnceForTest: async () => ({ content: '', toolCalls: capRound++ === 0 ? [1, 2, 3].map(i => call('work_write', i)) : [4, 5, 6].map(i => call('work_finish', i)) }),
    _executeToolForTest: async tool => { capped.push(tool); return JSON.stringify({ ok: tool !== 'work_finish', error: tool === 'work_finish' ? 'synthetic rejected receipt' : undefined }); },
  });
  assert.deepEqual(capped, ['work_write', 'work_write', 'work_write', 'work_finish']);
  results.push({ name: 'rejected final receipts cannot refresh the shared budget', passed: true, dispatched: capped.length });
  console.log(JSON.stringify({ scope: 'Real engine loop; synthetic model and intercepted executor; no cloud.', passed: true, results }, null, 2));
} finally {
  const { closeDBForTest } = await import(source('src/db.js')); closeDBForTest();
  if (path.dirname(isolated) === path.resolve(os.tmpdir()) && path.basename(isolated).startsWith('lingbo-boundaries-')) fs.rmSync(isolated, { recursive: true, force: true });
}
