// A diagnostic observer, not a renderer recovery or task-control mechanism.
export function rendererInputProbe() {
  const key = Symbol.for('lingbo.input-probe');
  if (globalThis[key]) return;
  let counts, samples = [], pending, observer;
  const reset = () => { counts = { keyDownCount: 0, inputCount: 0, compositionStarts: 0, compositionEnds: 0, compositionMaxMs: 0, keyDispatchMaxMs: 0, frameTimeouts: 0, hiddenSkipped: 0, focusChanges: 0, longTasks: 0, longTaskMaxMs: 0 }; samples = []; };
  reset();
  let composingAt;
  const listeners = [];
  const listen = (target, type, fn) => { target.addEventListener(type, fn, true); listeners.push(() => target.removeEventListener(type, fn, true)); };
  const editable = target => target instanceof Element && !!target.closest('textarea, input:not([type=password]), [contenteditable=true]');
  const eligible = () => document.visibilityState === 'visible' && document.hasFocus();
  const cancel = () => { if (pending) { cancelAnimationFrame(pending.frame); clearTimeout(pending.timer); pending = undefined; counts.hiddenSkipped++; } };
  listen(document, 'keydown', event => {
    if (!event.isTrusted || !editable(event.target)) return;
    counts.keyDownCount++;
    const age = performance.now() - event.timeStamp;
    if (age >= 0 && age < 60000) counts.keyDispatchMaxMs = Math.max(counts.keyDispatchMaxMs, age);
  });
  listen(document, 'input', event => {
    if (!event.isTrusted || !editable(event.target)) return;
    counts.inputCount++;
    if (!eligible()) { counts.hiddenSkipped++; return; }
    if (pending) return;
    const started = performance.now(), current = {};
    pending = current;
    current.frame = requestAnimationFrame(() => {
      if (pending !== current) return;
      clearTimeout(current.timer); pending = undefined;
      if (!eligible()) { counts.hiddenSkipped++; return; }
      samples.push(performance.now() - started);
      if (samples.length > 64) samples.shift();
    });
    current.timer = setTimeout(() => { if (pending !== current) return; cancelAnimationFrame(current.frame); pending = undefined; if (eligible()) counts.frameTimeouts++; else counts.hiddenSkipped++; }, 1000);
  });
  listen(document, 'compositionstart', event => { if (event.isTrusted && editable(event.target)) { counts.compositionStarts++; composingAt = performance.now(); } });
  listen(document, 'compositionend', event => { if (event.isTrusted && editable(event.target)) { counts.compositionEnds++; if (composingAt !== undefined) counts.compositionMaxMs = Math.max(counts.compositionMaxMs, performance.now() - composingAt); composingAt = undefined; } });
  listen(window, 'blur', () => { counts.focusChanges++; cancel(); composingAt = undefined; });
  listen(window, 'focus', () => counts.focusChanges++);
  listen(document, 'visibilitychange', () => { if (!eligible()) cancel(); });
  try { observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) { counts.longTasks++; counts.longTaskMaxMs = Math.max(counts.longTaskMaxMs, entry.duration); } }); observer.observe({ type: 'longtask', buffered: false }); } catch {}
  globalThis[key] = {
    snapshot() { const sorted = [...samples].sort((a, b) => a - b); const value = { ...counts, frameSamples: sorted.length, frameMaxMs: sorted.at(-1) || 0, frameP95Ms: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : 0, visible: document.visibilityState === 'visible', focused: document.hasFocus() }; reset(); return value; },
    dispose() { cancel(); observer?.disconnect(); listeners.forEach(stop => stop()); delete globalThis[key]; },
  };
}

const fields = ['keyDownCount', 'inputCount', 'compositionStarts', 'compositionEnds', 'compositionMaxMs', 'keyDispatchMaxMs', 'frameTimeouts', 'hiddenSkipped', 'focusChanges', 'longTasks', 'longTaskMaxMs', 'frameSamples', 'frameMaxMs', 'frameP95Ms'];
export function inputMetadata(value) {
  if (!value || typeof value !== 'object') return null;
  const clean = {};
  for (const key of fields) if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0) clean[key] = Math.min(value[key], 1e9);
  for (const key of ['visible', 'focused']) if (typeof value[key] === 'boolean') clean[key] = value[key];
  return Object.keys(clean).length ? clean : null;
}

export function installChatInputMonitor({ app, BrowserWindow, rendererOrigin, record, intervalMs = 5000, timeoutMs = 2000, timers = globalThis }) {
  const origin = new URL(rendererOrigin);
  if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(origin.hostname) || origin.origin !== rendererOrigin) throw new Error('Invalid diagnostic renderer origin');
  const windows = new Map(); let disposed = false;
  const emit = (type, data = {}) => { try { record({ type, data }); } catch {} };
  const allowed = contents => { try { const u = new URL(contents.getURL()); return u.origin === rendererOrigin && u.pathname === '/' && ['/chat', '/chat-floating'].includes(u.hash.split('?')[0].slice(1)); } catch { return false; } };
  const reasons = new Set(['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction']);
  function attach(_event, window) {
    if (disposed || windows.has(window)) return;
    const contents = window.webContents; let generation = 0, pending = false, ready = false, timer, lastTick = Date.now();
    const listeners = [];
    const on = (target, type, fn) => { target.on(type, fn); listeners.push(() => target.off(type, fn)); };
    const clear = () => { generation++; ready = false; if (timer) timers.clearInterval(timer); timer = undefined; };
    async function bounded(script, kind, version, durationMs = 0) {
      if (pending) return;
      pending = true; let timeout, expired = false;
      try {
        const run = contents.executeJavaScript(script);
        timeout = timers.setTimeout(() => { expired = true; if (version === generation && !disposed) emit('desktop.monitor_timeout', { count: kind === 'install' ? 0 : 1 }); }, timeoutMs);
        const result = await run;
        if (expired || version !== generation || disposed || !allowed(contents)) return;
        if (kind === 'install') { ready = true; emit('desktop.monitor_ready'); }
        else { const clean = inputMetadata(result); if (clean) emit('desktop.input_sample', { ...clean, durationMs }); }
      } catch { if (version === generation && !disposed) emit('desktop.monitor_failed'); }
      finally { if (timeout) timers.clearTimeout(timeout); pending = false; }
    }
    const install = () => {
      clear(); if (!allowed(contents) || contents.isDestroyed()) return;
      const version = generation;
      void bounded(`(${rendererInputProbe.toString()})()`, 'install', version);
      lastTick = Date.now();
      timer = timers.setInterval(() => { const now = Date.now(), lag = Math.max(0, now - lastTick - intervalMs); lastTick = now; if (!ready || pending || !allowed(contents)) return; void bounded("globalThis[Symbol.for('lingbo.input-probe')]?.snapshot()", 'sample', version, lag); }, intervalMs);
      timer?.unref?.();
    };
    on(contents, 'did-finish-load', install);
    on(contents, 'did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) clear(); });
    on(contents, 'render-process-gone', (_e, details) => { if (allowed(contents)) emit('desktop.renderer_gone', { reason: reasons.has(details.reason) ? details.reason : 'unknown', code: Number.isSafeInteger(details.exitCode) ? details.exitCode : -1 }); clear(); });
    on(window, 'unresponsive', () => { if (allowed(contents)) emit('desktop.unresponsive'); });
    on(window, 'responsive', () => { if (allowed(contents)) emit('desktop.responsive'); });
    const cleanup = () => { clear(); listeners.forEach(stop => stop()); windows.delete(window); };
    on(window, 'closed', () => { if (ready) emit('desktop.window_closed'); cleanup(); });
    windows.set(window, cleanup);
    if (!contents.isLoading()) install();
  }
  const beforeQuit = () => emit('desktop.quit_requested');
  const childGone = (_e, details) => emit('desktop.child_gone', { reason: reasons.has(details.reason) ? details.reason : 'unknown', code: Number.isSafeInteger(details.exitCode) ? details.exitCode : -1 });
  app.on('browser-window-created', attach); app.on('before-quit', beforeQuit); app.on('child-process-gone', childGone);
  BrowserWindow.getAllWindows().forEach(window => attach(null, window));
  return () => { disposed = true; for (const cleanup of [...windows.values()]) cleanup(); app.off('browser-window-created', attach); app.off('before-quit', beforeQuit); app.off('child-process-gone', childGone); };
}
