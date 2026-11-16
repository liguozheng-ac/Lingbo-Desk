import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installChatInputMonitor, inputMetadata } from '../../desktop/launcher/chat-input-monitor.mjs';
import { diagnosticMetadata } from '../../engine/src/runtime/diagnostic-privacy.js';

function fixture(url = 'http://localhost:5173/?stage-runtime=minimal#/chat-floating') {
  const app = new EventEmitter(), window = new EventEmitter(), contents = new EventEmitter(), records = [], scripts = [], intervals = new Set(), timeouts = new Set();
  let answer = () => Promise.resolve();
  Object.assign(contents, { getURL: () => url, isDestroyed: () => false, isLoading: () => false, executeJavaScript: code => { scripts.push(code); return answer(code); } });
  window.webContents = contents;
  const timers = { setInterval: fn => { intervals.add(fn); return fn; }, clearInterval: fn => intervals.delete(fn), setTimeout: fn => { timeouts.add(fn); return fn; }, clearTimeout: fn => timeouts.delete(fn) };
  const stop = installChatInputMonitor({ app, BrowserWindow: { getAllWindows: () => [window] }, rendererOrigin: 'http://localhost:5173', record: event => records.push(diagnosticMetadata(event)), timers });
  return { app, window, contents, records, scripts, intervals, timeouts, stop, setAnswer: fn => { answer = fn; }, navigate: next => { url = next; contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }); contents.emit('did-finish-load'); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('only own chat pages install a probe; lifecycle events contain no prose or paths', async () => {
  for (const url of ['https://example.com/#/chat', 'http://localhost:5174/#/chat', 'http://localhost:5173/#/settings', 'http://localhost:5173/not-owned#/chat']) { const f = fixture(url); await flush(); assert.equal(f.scripts.length, 0); f.stop(); }
  const f = fixture(); await flush(); assert.equal(f.scripts.length, 1); assert.equal(f.records[0].type, 'desktop.monitor_ready');
  f.window.emit('unresponsive'); f.window.emit('responsive'); f.contents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 9, message: 'PRIVATE CONTENT' }); f.app.emit('before-quit');
  assert(f.records.some(r => r.type === 'desktop.renderer_gone' && r.reason === 'oom' && r.code === 9)); assert(f.records.some(r => r.type === 'desktop.quit_requested')); assert(!JSON.stringify(f.records).includes('PRIVATE'));
  f.stop(); assert.equal(f.intervals.size, 0); assert.equal(f.app.listenerCount('before-quit'), 0); assert.equal(f.contents.listenerCount('did-finish-load'), 0);
});

test('stalled renderer produces one timeout and never overlaps polls; navigation discards old results', async () => {
  const f = fixture(); await flush(); let resolve;
  f.setAnswer(() => new Promise(r => { resolve = r; })); [...f.intervals][0](); const calls = f.scripts.length;
  for (let i = 0; i < 10; i++) [...f.intervals][0](); assert.equal(f.scripts.length, calls);
  [...f.timeouts][0](); assert.equal(f.records.filter(r => r.type === 'desktop.monitor_timeout').length, 1);
  f.navigate('https://example.com/#/chat'); resolve({ inputCount: 100, text: 'PRIVATE' }); await flush(); assert(!f.records.some(r => r.type === 'desktop.input_sample')); assert.equal(f.intervals.size, 0); f.stop();
});

test('samples allow only finite numeric counters and fixed booleans; failures do not affect app flow', async () => {
  const dirty = { inputCount: 7, keyDownCount: Infinity, frameMaxMs: -1, frameSamples: 2, frameP95Ms: 20, visible: true, focused: false, text: 'PRIVATE', key: 'password', reason: 'private prose' };
  assert.deepEqual(inputMetadata(dirty), { inputCount: 7, frameSamples: 2, frameP95Ms: 20, visible: true, focused: false });
  const f = fixture(); await flush(); f.setAnswer(() => Promise.resolve(dirty)); [...f.intervals][0](); await flush(); const sample = f.records.find(r => r.type === 'desktop.input_sample'); assert.equal(sample.inputCount, 7); assert(!JSON.stringify(f.records).includes('PRIVATE'));
  f.setAnswer(() => Promise.reject(new Error('PRIVATE'))); [...f.intervals][0](); await flush(); assert(f.records.some(r => r.type === 'desktop.monitor_failed')); assert(!JSON.stringify(f.records).includes('PRIVATE')); f.stop();
  assert.equal(inputMetadata(null), null);
});
