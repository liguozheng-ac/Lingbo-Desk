import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventFeed } from '../event-feed.mjs';
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
async function fixture() {
  const feed = new EventFeed({ heartbeatMs: 20 }), server = http.createServer((_req, res) => feed.subscribe(res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { feed, server, origin: 'http://127.0.0.1:' + server.address().port, async close() { feed.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
test('shutdown can persist and publish final task states after SSE clients end without crashing', async () => {
  const f = await fixture();
  try {
    const response = await fetch(f.origin), reader = response.body.getReader(); await reader.read();
    assert.equal(f.feed.clients.size, 1); f.feed.close();
    for (let i = 0; i < 5; i++) f.feed.publish({ sequence: i, type: 'work.snapshot', data: { status: 'paused' } });
    while (!(await reader.read()).done) {}
    await tick(); assert.equal(f.feed.clients.size, 0); f.feed.close();
    assert.equal((await fetch(f.origin)).status, 503);
  } finally { await f.close(); }
});
test('client abort clears its heartbeat and later publications stay safe', async () => {
  const f = await fixture(), controller = new AbortController();
  try {
    const response = await fetch(f.origin, { signal: controller.signal }); await response.body.getReader().read(); controller.abort();
    for (let i = 0; i < 20 && f.feed.clients.size; i++) await tick();
    assert.equal(f.feed.clients.size, 0); f.feed.publish({ sequence: 1, data: { status: 'running' } });
  } finally { await f.close(); }
});
