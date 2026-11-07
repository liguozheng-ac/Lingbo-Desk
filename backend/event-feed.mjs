// Owns SSE responses and timers, including publication during server shutdown.
export class EventFeed {
  constructor({ heartbeatMs = 10000 } = {}) { this.clients = new Map(); this.closed = false; this.heartbeatMs = heartbeatMs; }
  write(res, frame) {
    if (res.destroyed || res.writableEnded) { this.clients.get(res)?.(); return; }
    try { res.write(frame); } catch { this.clients.get(res)?.(); res.destroy(); }
  }
  subscribe(res) {
    if (this.closed) { res.writeHead(503); res.end(); return; }
    let timer;
    const remove = () => { clearInterval(timer); this.clients.delete(res); };
    // Keep the error listener for this response's lifetime: a late socket error
    // must not become an unhandled EventEmitter error after removal from the map.
    res.on('error', remove); res.once('close', remove);
    this.clients.set(res, remove);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    this.write(res, ': connected\n\n');
    if (!this.clients.has(res)) return;
    timer = setInterval(() => this.write(res, ': heartbeat\n\n'), this.heartbeatMs);
  }
  publish(event) {
    if (this.closed) return;
    const frame = `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients.keys()) this.write(res, frame);
  }
  close() {
    if (this.closed) return; this.closed = true;
    const clients = [...this.clients.entries()]; this.clients.clear();
    for (const [res, remove] of clients) { remove(); if (!res.destroyed && !res.writableEnded) res.end(); }
  }
}
