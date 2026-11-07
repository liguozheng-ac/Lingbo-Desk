import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolExecutionBudget, createToolExecutionBoundary } from '../../engine/src/runtime/tool-execution-boundary.js';
const schema = name => ({ function: { name } });

test('unadvertised tools and pinned native escape calls never reach the executor', async () => {
  const dispatched = [], schemas = [schema('work_read')];
  const guard = createToolExecutionBoundary({ schemas, allowedTools: ['work_read'], maxTotalCalls: 4, execute: async name => { dispatched.push(name); return 'ok'; } });
  for (const name of ['write_file', 'install_tool', 'exec_command', 'send_message']) {
    assert.equal(JSON.parse(await guard.execute(name, {}, { source: 'fallback' })).error, 'tool_not_allowed');
  }
  assert.deepEqual(dispatched, []);
  assert.equal(await guard.execute('work_read'), 'ok');
  assert.deepEqual(dispatched, ['work_read']);
});

test('only trusted discovery can extend default schemas; a pinned allowlist stays fixed', async () => {
  const schemas = [schema('find_tool')], calls = [];
  const make = allowedTools => createToolExecutionBoundary({ schemas, allowedTools, maxTotalCalls: 3, execute: async name => { calls.push(name); return 'ok'; } });
  const normal = make(), pinned = make(['find_tool']);
  assert.equal(JSON.parse(await normal.execute('read_file')).error, 'tool_not_allowed');
  schemas.push(schema('read_file'));
  assert.equal(await normal.execute('read_file'), 'ok');
  assert.equal(JSON.parse(await pinned.execute('read_file')).error, 'tool_not_allowed');
  assert.deepEqual(calls, ['read_file']);
});

test('parallel reservations and failed dispatches respect the actual hard call cap', async () => {
  let calls = 0;
  const guard = createToolExecutionBoundary({ schemas: [schema('read_file')], maxTotalCalls: 2, execute: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); throw new Error('synthetic failure'); } });
  const results = await Promise.allSettled(Array.from({ length: 9 }, () => guard.execute('read_file')));
  assert.equal(calls, 2); assert.equal(guard.remaining, 0);
  assert.equal(results.filter(r => r.status === 'rejected').length, 2);
  assert.equal(results.filter(r => r.status === 'fulfilled' && JSON.parse(r.value).error === 'tool_budget_exhausted').length, 7);
});

test('one budget spans main execution, receipt-only follow-up and internal delivery', async () => {
  const budget = createToolExecutionBudget(3), calls = [];
  const make = (maxTotalCalls, allowedTools) => createToolExecutionBoundary({ schemas: [schema('work_read'), schema('work_finish')], maxTotalCalls, allowedTools, budget, execute: async name => { calls.push(name); return 'ok'; } });
  const main = make(2, ['work_read']), followup = make(3, ['work_finish']);
  await main.execute('work_read'); await main.execute('work_read');
  assert.equal(JSON.parse(await main.execute('work_read')).error, 'tool_budget_exhausted');
  assert.equal(JSON.parse(await followup.execute('work_read')).error, 'tool_not_allowed');
  await followup.execute('work_finish');
  assert.equal(JSON.parse(await followup.execute('work_finish')).error, 'tool_budget_exhausted');
  assert.equal(budget.used, 3); assert.deepEqual(calls, ['work_read', 'work_read', 'work_finish']);
  const delivery = createToolExecutionBoundary({ schemas: [], maxTotalCalls: 1, execute: async () => 'sent' });
  assert.equal(JSON.parse(await delivery.execute('send_message')).error, 'tool_not_allowed');
  assert.equal(await delivery.execute('send_message', {}, { source: 'fallback' }), 'sent');
  assert.equal(JSON.parse(await delivery.execute('send_message', {}, { source: 'ack' })).error, 'tool_budget_exhausted');
});
