// Explicit real-API evaluation only. Observe metadata; never replace model answers.
import { workerData, parentPort } from 'node:worker_threads';
import { WorkBrowser } from '../work-browser.mjs';
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.deepseek.com' || url.pathname !== '/chat/completions') return originalFetch(input, options);
  const sequence = ++requests;
  if (sequence > workerData.requestLimit) throw new Error('Real evaluation model request budget exhausted');
  const body = JSON.parse(options.body); body.max_tokens = Math.min(body.max_tokens || 1200, 1200);
  if (body.stream) body.stream_options = { ...body.stream_options, include_usage: true };
  const start = performance.now();
  const metric = { sequence, usageAvailable: false, inputTokens: null, outputTokens: null, totalTokens: null, cachedTokens: null, firstByteMs: null, firstOutputMs: null, model: body.model };
  let sent = false;
  const publish = () => { if (sent) return; sent = true; parentPort.postMessage({ type: 'model-metric', value: { ...metric, elapsedMs: Math.round(performance.now() - start) } }); };
  const accept = value => {
    if (value.usage) { metric.usageAvailable = true; metric.inputTokens = value.usage.prompt_tokens ?? null; metric.outputTokens = value.usage.completion_tokens ?? null; metric.totalTokens = value.usage.total_tokens ?? null; metric.cachedTokens = value.usage.prompt_cache_hit_tokens ?? null; }
    if (metric.firstOutputMs === null && value.choices?.some(c => c.delta?.content || c.delta?.tool_calls || c.message?.content)) metric.firstOutputMs = Math.round(performance.now() - start);
  };
  try {
    const response = await originalFetch(input, { ...options, body: JSON.stringify(body) }); metric.status = response.status;
    if (!response.body) { publish(); return response; }
    const decoder = new TextDecoder(); let pending = '';
    const stream = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        if (metric.firstByteMs === null) metric.firstByteMs = Math.round(performance.now() - start);
        pending += decoder.decode(chunk, { stream: true });
        if (body.stream) { const lines = pending.split('\n'); pending = lines.pop(); for (const line of lines) if (line.startsWith('data: ') && line.slice(6).trim() !== '[DONE]') try { accept(JSON.parse(line.slice(6))); } catch {} }
        if (pending.length > 1024 * 1024) { publish(); throw new Error('Evaluation response observation limit exceeded'); }
        controller.enqueue(chunk);
      },
      flush() { if (!body.stream) try { accept(JSON.parse(pending)); } catch {} publish(); },
      cancel() { publish(); },
    }));
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) { metric.errorClass = error.name; publish(); throw error; }
};
// The real Edge adapter already supports headless operation with a fresh profile.
const startBrowser = WorkBrowser.prototype.start;
WorkBrowser.prototype.start = function (job) { this.headless = true; return startBrowser.call(this, job); };
await import('../server.mjs');
parentPort.on('message', message => { if (message.command === 'shutdown') process.emit('SIGTERM'); });
parentPort.postMessage({ type: 'ready' });
