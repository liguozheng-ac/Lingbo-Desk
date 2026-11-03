import crypto from 'node:crypto';

// Timing records contain identifiers, counts and durations. Content stays out.
export class VoiceMetrics {
  constructor(record = () => {}, limit = 180) { this.record = record; this.limit = limit; this.items = []; this.native = []; }
  captureNative(data) {
    const item = {};
    for (const key of ['type', 'sessionId', 'turnId', 'segmentId', 'requestId', 'status', 'track', 'spanId', 'clock']) if (typeof data?.[key] === 'string' && data[key].length <= 200) item[key] = data[key];
    for (const key of ['at', 'wall', 'ts', 'observedTs', 'targets', 'bytes', 'firstTokenMs']) if (Number.isFinite(data?.[key])) item[key] = data[key];
    if (!item.type) return;
    this.native.push(item); if (this.native.length > 1500) this.native.shift();
  }
  begin(kind, sessionId, traceId) {
    const id = /^[A-Za-z0-9_.:-]{1,160}$/.test(traceId || '') ? traceId : crypto.randomUUID();
    const start = performance.now();
    const entry = { id, requestId: crypto.randomUUID(), kind, sessionId, startedAt: Date.now(), marks: {}, outcome: 'running' };
    this.items.push(entry); if (this.items.length > this.limit) this.items.shift();
    let ended = false;
    return {
      id,
      mark: name => { if (!ended && entry.marks[name] === undefined) entry.marks[name] = Math.round((performance.now() - start) * 10) / 10; },
      finish: (outcome = 'completed', details = {}) => {
        if (ended) return; ended = true;
        for (const key of ['language', 'delivery', 'audioDurationMs', 'characters', 'bytes']) if (typeof details[key] === 'string' || Number.isFinite(details[key])) entry[key] = details[key];
        entry.outcome = outcome; entry.elapsedMs = Math.round((performance.now() - start) * 10) / 10;
        this.record({ type: 'voice.timing', at: Date.now(), data: entry });
      },
    };
  }
  list() { return this.items.map(entry => ({ ...entry, marks: { ...entry.marks } })); }
}
