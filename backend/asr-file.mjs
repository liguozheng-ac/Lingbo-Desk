import { setTimeout as delay, setImmediate as tick } from 'node:timers/promises';

function timeoutError() {
  const error = new Error('语音识别超时，请稍后重试。');
  error.code = 'ASR_TIMEOUT'; error.statusCode = 504; return error;
}

// Captured files are already complete. Buffered delivery keeps packet order
// without adding a second recording-length wait. Live capture still needs pacing.
export async function recognizeFile(pcm, language, { createSession, credentials, signal, delivery = 'buffered', timing, retryDelayMs = 300, timeoutMs = 45000 }) {
  if (!['paced', 'buffered'].includes(delivery)) throw new Error('识别传输方式无效');
  const budget = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  for (let attempt = 1; attempt <= 2; attempt++) {
    let ready = false;
    try {
      return await recognizeAttempt(pcm, language, { createSession, credentials, signal: budget, delivery, timing, onReady() { ready = true; } });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (budget.aborted) throw timeoutError();
      const dnsFailure = ['ENOTFOUND', 'EAI_AGAIN'].includes(error.code) || /^(?:getaddrinfo )?(?:ENOTFOUND|EAI_AGAIN)\b/.test(error.message);
      if (dnsFailure && !ready && attempt === 1) {
        timing?.mark('asrDnsRetry');
        try { await delay(retryDelayMs, undefined, { signal: budget }); }
        catch { if (signal.aborted) throw signal.reason; throw timeoutError(); }
        continue;
      }
      if (dnsFailure) {
        const unavailable = new Error('语音识别服务的域名暂时无法解析，请检查网络后重试。', { cause: error });
        unavailable.code = 'ASR_DNS_UNAVAILABLE'; unavailable.statusCode = 503; throw unavailable;
      }
      throw error;
    }
  }
}

function recognizeAttempt(pcm, language, { createSession, credentials, signal, delivery, timing, onReady }) {
  return new Promise((resolve, reject) => {
    let session; let done = false;
    const segments = new Map();
    const finish = error => {
      if (done) return; done = true;
      signal.removeEventListener('abort', abort); session?.close();
      if (error) reject(error); else resolve([...segments.values()].join(' '));
    };
    const abort = () => finish(signal.reason || new DOMException('语音识别已取消', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try { session = createSession({ ...credentials, lang: language }, (text, final, segment) => {
      if (done) return;
      timing?.mark('asrFirstResult'); segments.set(segment ?? 'single', text);
      if (final) timing?.mark('asrFirstFinal');
    }, (error, originalError) => finish(originalError instanceof Error ? originalError : error instanceof Error ? error : new Error(String(error))), () => { if (!done) finish(new Error('识别连接提前关闭')); }, event => {
      if (done) return;
      if (event === 'task-started') (async () => {
        onReady();
        timing?.mark('asrReady');
        for (let offset = 0; offset < pcm.length && !done; offset += 4096) {
          signal.throwIfAborted(); session.sendAudio(pcm.subarray(offset, offset + 4096));
          if (delivery === 'paced') await delay(128, undefined, { signal });
          else if (offset % 16384 === 0) await tick(undefined, { signal });
        }
        if (!done) { timing?.mark('audioSent'); session.flush(); }
      })().catch(finish);
      if (event === 'task-finished') { timing?.mark('asrFinished'); finish(); }
    }); } catch (error) { finish(error); }
    if (done) session?.close();
  });
}
