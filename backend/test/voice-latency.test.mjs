import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceMetrics } from '../voice-metrics.mjs';
import { recognizeFile } from '../asr-file.mjs';
import { selectSpeechTargets, speechTurnKey } from '../speech-targets.mjs';

test('delayed stop excludes a newer reply, another conversation and the stop command itself', () => {
  const turns = ['old', 'new', 'other', 'command'].map(turnId => ({ turnId, sessionId: turnId === 'other' ? 'other-session' : 'session' }));
  const known = new Map(turns.map(turn => [speechTurnKey(turn), { ...turn, startedAt: turn.turnId === 'new' ? 200 : 100, controlOnly: turn.turnId === 'command' }]));
  assert.deepEqual(selectSpeechTargets(turns, known, { sessionId: 'session', requestedAt: 150 }).map(turn => turn.turnId), ['old']);
  assert.throws(() => selectSpeechTargets(turns, known, { sessionId: 'session' }), /时间标识/);
  const collision = { sessionId: 'different', turnId: 'old' };
  known.set(speechTurnKey(collision), { ...collision, startedAt: 90 });
  assert.deepEqual(selectSpeechTargets([...turns, collision], known, { sessionId: 'different', requestedAt: 150 }), [collision]);
});

test('timing storage is bounded, strips content and finalizes each request once', () => {
  const events = []; const metrics = new VoiceMetrics(event => events.push(event), 2);
  const span = metrics.begin('tts', 'session', 'turn-one'); span.mark('audioFirstByte'); span.mark('audioFirstByte');
  span.finish('completed', { characters: 10, text: 'private text', apiKey: 'secret' }); span.finish('failed');
  metrics.begin('asr', 'session'); metrics.begin('llm', 'session');
  assert.equal(metrics.list().length, 2); assert.equal(events.length, 1);
  assert.ok(!JSON.stringify(events).includes('private')); assert.ok(!JSON.stringify(events).includes('secret'));
  assert.equal(events[0].data.outcome, 'completed');
});

test('buffered ASR preserves every PCM packet and finishes only after provider completion', async () => {
  const pcm = Buffer.alloc(16000, 7); const received = []; let closed = false;
  const text = await recognizeFile(pcm, 'zh', { signal: new AbortController().signal,
    createSession(_config, transcript, _error, _close, event) {
      queueMicrotask(() => event('task-started'));
      return { sendAudio(chunk) { received.push(chunk); }, flush() { transcript('最终文本', true, 'a0'); event('task-finished'); }, close() { closed = true; } };
    } });
  assert.ok(Buffer.concat(received).equals(pcm)); assert.equal(text, '最终文本'); assert.equal(closed, true);
});

test('aborted upload closes ASR without flushing pending audio', async () => {
  const controller = new AbortController(); let flushed = false; let sent = 0; let closed = false;
  await assert.rejects(recognizeFile(Buffer.alloc(32000), 'en', { delivery: 'paced', signal: controller.signal,
    createSession(_config, _transcript, _error, _close, event) {
      queueMicrotask(() => event('task-started'));
      return { sendAudio() { sent++; controller.abort(); }, flush() { flushed = true; }, close() { closed = true; } };
    } }), { name: 'AbortError' });
  assert.equal(sent, 1); assert.equal(flushed, false); assert.equal(closed, true);
});
