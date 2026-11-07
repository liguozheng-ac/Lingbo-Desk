export const metadataOnlyDiagnostics = () => process.env.LINGBO_DIAGNOSTICS_METADATA_ONLY === '1'
const sensitiveKey = /(?:api[_-]?key|access[_-]?key|secret|token|password|authorization|bearer|ticket)/i
export function createSecretRedactor(secrets = []) {
  const known = [...new Set(secrets.filter(s => typeof s === 'string' && s.length >= 8))].sort((a, b) => b.length - a.length)
  const text = value => {
    let clean = String(value)
    for (const secret of known) clean = clean.split(secret).join('[REDACTED]')
    return clean.replace(/\b(?:sk|ak|rk|pk)-[\w.-]{12,}/gi, '[REDACTED]')
      .replace(/\bBearer\s+[\w.+/=-]{8,}/gi, 'Bearer [REDACTED]')
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED]')
  }
  function clean(value, depth = 0) {
    if (typeof value === 'string') return text(value)
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
    if (depth > 32) return '[nested]'
    if (Array.isArray(value)) return value.map(v => clean(v, depth + 1))
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [text(key), sensitiveKey.test(key) ? '[REDACTED]' : clean(v, depth + 1)]))
    return String(value)
  }
  return clean
}

// Only fixed enums and finite counters are diagnostic data. No prose or paths.
const events = new Set(['work.snapshot', 'task.snapshot', 'tool.enter', 'tool.result', 'tool.held', 'tool.replayed', 'model.context', 'model.settled', 'model.failed', 'runtime.response', 'runtime.error', 'ready', 'accepted', 'paused', 'resumed', 'worker.started', 'worker.closed', 'worker.stream', 'worker.ipc_error', 'worker.kill', 'worker.error', 'worker.cleanup_error', 'gateway.started', 'gateway.closed', 'speech.stop_requested'])
const statuses = new Set(['starting', 'running', 'awaiting_approval', 'pause_requested', 'paused', 'cancel_requested', 'cancelled', 'interrupted', 'completed', 'failed'])
export function diagnosticMetadata(event = {}) {
  const known = events.has(event.type), data = event.data || {}, result = { type: known ? event.type : 'other', at: Number.isFinite(event.at) ? event.at : Date.now() }
  if (!known) { if (Number.isSafeInteger(event.sequence)) result.sequence = event.sequence; return result }
  for (const key of ['sequence', 'attempt', 'pid', 'code', 'durationMs', 'bytes', 'chunks', 'version', 'toolCalls', 'count']) {
    const value = event[key] ?? data[key]; if (typeof value === 'number' && Number.isFinite(value)) result[key] = value
  }
  for (const key of ['ok', 'aborted', 'forced']) if (typeof data[key] === 'boolean') result[key] = data[key]
  if (statuses.has(data.status)) result.status = data.status
  if (['stdout', 'stderr'].includes(data.channel)) result.channel = data.channel
  return result
}
