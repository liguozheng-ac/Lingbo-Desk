import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskNoticeQueue, taskNoticeBusy } from '../../desktop/bridges/task-notices.mjs';

test('buffered ASR finalization keeps notices behind the user even after capture releases its slot', () => {
  const base = { sessionId: 'owner', activeSessionId: 'owner', sending: false, inputActive: false, activeTurns: [] };
  assert.equal(taskNoticeBusy({ ...base, inputPhase: 'finalizing' }), true);
  assert.equal(taskNoticeBusy({ ...base, inputPhase: 'pending' }), true);
  assert.equal(taskNoticeBusy({ ...base, inputPhase: 'settled' }), false);
  assert.equal(taskNoticeBusy({ ...base, activeTurns: [{ sessionId: 'owner', turnId: 'playing' }] }), true);
  assert.equal(taskNoticeBusy({ ...base, sending: true }), true);
  assert.equal(taskNoticeBusy({ ...base, activeSessionId: 'other' }), true);
});

function clock() {
  const pending = new Map(); let next = 0;
  return {
    setTimeout(fn) { const id = ++next; pending.set(id, fn); return id; },
    clearTimeout(id) { pending.delete(id); },
    async tick() { const entry = pending.entries().next().value; assert.ok(entry, 'expected scheduled tick'); pending.delete(entry[0]); await entry[1](); },
    get size() { return pending.size; },
  };
}

test('task notices wait for conversation/playback idle and coalesce statuses for one task', async () => {
  const timers = clock(), delivered = []; let busy = true;
  const queue = createTaskNoticeQueue({ timers, isBusy: () => busy, deliver: async (session, notice) => delivered.push({ session, notice }) });
  queue.enqueue('task-a', 'owner', { text: 'waiting for approval' });
  await timers.tick(); assert.deepEqual(delivered, []);
  queue.enqueue('task-a', 'owner', { text: 'completed' });
  queue.enqueue('task-b', 'owner', { text: 'other completed' });
  await timers.tick(); assert.deepEqual(delivered, []);
  busy = false;
  await timers.tick(); assert.deepEqual(delivered, [{ session: 'owner', notice: { text: 'completed' } }]);
  // Generation can settle before audio. The next notice must still observe busy.
  busy = true; await timers.tick(); assert.equal(delivered.length, 1);
  busy = false; await timers.tick(); assert.equal(delivered.length, 2);
  assert.equal(timers.size, 0); queue.close();
});

test('closing a waiting notice queue never sends it later or blocks another session', async () => {
  const timers = clock(), delivered = [];
  const queue = createTaskNoticeQueue({ timers, isBusy: session => session === 'inactive', deliver: async session => delivered.push(session) });
  queue.enqueue('a', 'inactive', { text: 'hold' }); queue.enqueue('b', 'active', { text: 'deliver' });
  await timers.tick(); assert.deepEqual(delivered, ['active']);
  assert.equal(timers.size, 1); queue.close(); assert.equal(timers.size, 0);
  queue.enqueue('c', 'active', { text: 'closed' }); assert.equal(timers.size, 0);
});

test('a failed notice releases delivery and the queue retains only its bounded latest entries', async () => {
  const timers = clock(), delivered = [], failures = [];
  const queue = createTaskNoticeQueue({ timers, limit: 2, isBusy: () => false, deliver: async (_session, notice) => { delivered.push(notice.text); if (notice.text === 'fail') throw new Error('fixture'); }, onError: error => failures.push(error.message) });
  queue.enqueue('old', 'owner', { text: 'evicted' }); queue.enqueue('a', 'owner', { text: 'fail' }); queue.enqueue('b', 'owner', { text: 'latest' });
  await timers.tick(); await timers.tick();
  assert.deepEqual(delivered, ['fail', 'latest']); assert.deepEqual(failures, ['fixture']); assert.equal(timers.size, 0); queue.close();
});
