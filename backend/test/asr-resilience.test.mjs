import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeFile } from '../asr-file.mjs';

const dnsError = () => Object.assign(new Error('getaddrinfo ENOTFOUND dashscope.aliyuncs.com'), { code: 'ENOTFOUND' });

test('pre-task DNS failure retries once, ignores late old events and submits PCM only to the new task', async () => {
  const pcm = Buffer.alloc(20000, 8); const sent = []; let attempts = 0; let closed = 0;
  const marks = [];
  const text = await recognizeFile(pcm, 'auto', { retryDelayMs: 0, signal: new AbortController().signal, timing: { mark: name => marks.push(name) },
    createSession(_config, transcript, error, _close, event) {
      const attempt = ++attempts;
      queueMicrotask(() => {
        if (attempt === 1) { const failure = dnsError(); error(failure.message, failure); transcript('late stale result', true, 'a0'); event('task-started'); event('task-finished'); }
        else event('task-started');
      });
      return { sendAudio(chunk) { sent.push({ attempt, chunk }); }, flush() { transcript('こんにちは', true, 'a0'); event('task-finished'); }, close() { closed++; } };
    },
  });
  assert.equal(text, 'こんにちは'); assert.equal(attempts, 2); assert.equal(closed, 2);
  assert.ok(sent.every(item => item.attempt === 2)); assert.ok(Buffer.concat(sent.map(item => item.chunk)).equals(pcm));
  assert.equal(marks.filter(name => name === 'asrFinished').length, 1);
  assert.ok(marks.includes('asrDnsRetry'));
});

test('repeated DNS failure stops after two attempts and returns a readable 503', async () => {
  let attempts = 0;
  await assert.rejects(recognizeFile(Buffer.alloc(100), 'auto', { retryDelayMs: 0, signal: new AbortController().signal,
    createSession(_config, _text, error) { attempts++; queueMicrotask(() => error(dnsError())); return { close() {} }; },
  }), error => error.code === 'ASR_DNS_UNAVAILABLE' && error.statusCode === 503 && /域名/.test(error.message));
  assert.equal(attempts, 2);
});

test('recognition already started is never replayed, even for a DNS-like failure', async () => {
  let attempts = 0; let sent = 0;
  await assert.rejects(recognizeFile(Buffer.alloc(100), 'auto', { retryDelayMs: 0, signal: new AbortController().signal,
    createSession(_config, _text, error, _close, event) {
      attempts++; queueMicrotask(() => event('task-started'));
      return { sendAudio() { sent++; error(dnsError()); }, flush() { assert.fail('must not flush'); }, close() {} };
    },
  }), { code: 'ASR_DNS_UNAVAILABLE' });
  assert.equal(attempts, 1); assert.equal(sent, 1);
});

test('provider rejection does not retry and synchronous construction failure cleans up', async () => {
  for (const synchronous of [false, true]) {
    let attempts = 0;
    await assert.rejects(recognizeFile(Buffer.alloc(100), 'auto', { retryDelayMs: 0, signal: new AbortController().signal,
      createSession(_config, _text, error) {
        attempts++;
        if (synchronous) throw new Error('invalid credentials');
        queueMicrotask(() => error('invalid credentials')); return { close() {} };
      },
    }), /invalid credentials/);
    assert.equal(attempts, 1);
  }
});

test('abort during DNS retry backoff prevents all further attempts', async () => {
  const controller = new AbortController(); let attempts = 0;
  await assert.rejects(recognizeFile(Buffer.alloc(100), 'auto', { retryDelayMs: 1000, signal: controller.signal,
    createSession(_config, _text, error) {
      attempts++; queueMicrotask(() => { error(dnsError()); setTimeout(() => controller.abort(), 5); });
      return { close() {} };
    },
  }), { name: 'AbortError' });
  assert.equal(attempts, 1);
});

test('one overall timeout covers DNS backoff and closes an idle recognition session', async () => {
  for (const failDns of [true, false]) {
    let attempts = 0; let closed = 0;
    // Timers from AbortSignal.timeout are unref'ed; keep this artificial idle test alive.
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      await assert.rejects(recognizeFile(Buffer.alloc(100), 'auto', { retryDelayMs: 1000, timeoutMs: 20, signal: new AbortController().signal,
        createSession(_config, _text, error) {
          attempts++; if (failDns) queueMicrotask(() => error(dnsError()));
          return { close() { closed++; } };
        },
      }), { code: 'ASR_TIMEOUT', statusCode: 504 });
      assert.equal(attempts, 1); assert.equal(closed, 1);
    } finally { clearTimeout(keepAlive); }
  }
});
