/** Best-effort task announcements. The durable task status remains in the gateway. */
export function taskNoticeBusy({ sessionId, activeSessionId, sending, inputActive, inputPhase, activeTurns = [] }) {
  return activeSessionId !== sessionId || !!sending || !!inputActive
    // Capture releases its slot before buffered ASR and submission finish.
    || !!(inputPhase && inputPhase !== 'settled')
    || activeTurns.some(turn => turn.sessionId === sessionId)
}

export function createTaskNoticeQueue({ isBusy, deliver, onError = () => {}, timers = globalThis, intervalMs = 100, limit = 100 }) {
  const pending = new Map()
  let timer, running = false, disposed = false
  function schedule() {
    if (disposed || running || timer !== undefined || !pending.size) return
    timer = timers.setTimeout(pump, intervalMs)
    timer?.unref?.()
  }
  async function pump() {
    timer = undefined
    if (disposed || running) return
    const entry = [...pending.entries()].find(([, item]) => !isBusy(item.sessionId))
    if (!entry) { schedule(); return }
    const [key, item] = entry
    pending.delete(key)
    running = true
    try { await deliver(item.sessionId, item.notice) }
    catch (error) { onError(error) }
    finally { running = false; schedule() }
  }
  return {
    enqueue(key, sessionId, notice) {
      if (disposed) return
      // Only the latest pending status for the same task needs to be spoken.
      pending.delete(key)
      pending.set(key, { sessionId, notice })
      while (pending.size > limit) pending.delete(pending.keys().next().value)
      schedule()
    },
    close() {
      disposed = true
      if (timer !== undefined) timers.clearTimeout(timer)
      timer = undefined
      pending.clear()
    },
  }
}
