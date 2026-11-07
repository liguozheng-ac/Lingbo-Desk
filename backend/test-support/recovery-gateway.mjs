// Fault injection for isolated gateway/worker recovery tests. No cloud request.
import fs from 'node:fs';
import path from 'node:path';
import { WorkTools } from '../work-tools.mjs';
import { WorkService } from '../work-service.mjs';
const local = path.join(process.env.VOICE_AGENT_WORKSPACE, '.local');
const control = () => JSON.parse(fs.readFileSync(path.join(local, 'recovery-control.json'), 'utf8'));
const counterFile = path.join(local, 'recovery-model-count.json');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  if (new URL(String(input)).hostname !== 'api.deepseek.com') return originalFetch(input, options);
  const counter = fs.existsSync(counterFile) ? JSON.parse(fs.readFileSync(counterFile)) : 0;
  fs.writeFileSync(counterFile, JSON.stringify(counter + 1));
  const state = control(), value = JSON.parse(options.body);
  const names = (value.messages || []).flatMap(m => (m.tool_calls || []).map(call => call.function?.name));
  let action;
  if (state.resume) action = names.includes('work_read')
    ? { name: 'work_finish', arguments: JSON.stringify({ outcome: 'complete', summary: 'Existing receipt and output checked; no write was replayed.' }) }
    : { name: 'work_read', arguments: JSON.stringify({ path: 'ledger.txt' }) };
  else if (!names.includes('work_write')) action = { name: 'work_write', arguments: JSON.stringify({ path: 'ledger.txt', content: 'Recovery proof: one committed write.' }) };
  else {
    if (state.mode === 'upstream-disconnect') throw new TypeError('simulated fetch failed');
    return new Promise((_, reject) => {
      const abort = () => reject(new DOMException('Controlled upstream aborted', 'AbortError'));
      if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
    });
  }
  const event = { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'recovery-' + (counter + 1), type: 'function', function: action }] }, finish_reason: null }] };
  const end = { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
  return new Response([event, end].map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
};
const execute = WorkTools.prototype.execute;
WorkTools.prototype.execute = async function (job, tool, ...args) {
  const result = await execute.call(this, job, tool, ...args);
  if (control().mode === 'gateway-crash-uncertain' && !control().resume && tool === 'work_write') {
    fs.writeFileSync(path.join(local, 'recovery-write-without-receipt.json'), JSON.stringify({ taskId: job.id }));
    await new Promise((_, reject) => job.controller.signal.addEventListener('abort', () => reject(new Error('controlled abort')), { once: true }));
  }
  return result;
};
const persist = WorkService.prototype.persist;
WorkService.prototype.persist = function (job) {
  if (job.worker?.pid) fs.writeFileSync(path.join(local, 'recovery-owned-worker.json'), JSON.stringify({ taskId: job.id, pid: job.worker.pid }));
  return persist.call(this, job);
};
await import('../server.mjs');
