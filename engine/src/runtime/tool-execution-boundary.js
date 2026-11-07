// Host-owned capabilities and counters. Model output can never expand this boundary.
export function createToolExecutionBudget(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid tool execution budget')
  let used = 0
  return Object.freeze({
    limit,
    get used() { return used },
    get remaining() { return limit - used },
    reserve() { if (used >= limit) return false; used += 1; return true },
  })
}

export function createToolExecutionBoundary({ schemas, allowedTools, maxTotalCalls, budget, execute }) {
  if (allowedTools !== undefined && (!Array.isArray(allowedTools) || allowedTools.some(name => typeof name !== 'string'))) throw new Error('Invalid execution allowlist')
  const pinned = allowedTools === undefined ? null : new Set(allowedTools)
  const local = createToolExecutionBudget(maxTotalCalls)
  if (budget && (!Object.isFrozen(budget) || typeof budget.reserve !== 'function' || !Number.isSafeInteger(budget.remaining))) throw new Error('Invalid shared tool budget')
  const denial = (tool, code) => JSON.stringify({ ok: false, tool, error: code, skipped: code, reason: code === 'tool_not_allowed' ? 'This tool is outside the host execution allowlist.' : 'The host tool execution budget is exhausted. No operation was dispatched.' })
  return {
    get remaining() { return Math.min(local.remaining, budget?.remaining ?? Infinity) },
    async execute(name, args, context) {
      const advertised = schemas.some(schema => schema?.function?.name === name)
      const internalDelivery = name === 'send_message' && ['ack', 'fallback'].includes(context?.source)
      if ((pinned && !pinned.has(name)) || (!advertised && !(internalDelivery && !pinned))) return denial(name, 'tool_not_allowed')
      // Reserve synchronously, before any await: parallel calls cannot oversubscribe.
      if (local.remaining < 1 || (budget && budget.remaining < 1)) return denial(name, 'tool_budget_exhausted')
      local.reserve(); budget?.reserve()
      return execute(name, args, context)
    },
  }
}
