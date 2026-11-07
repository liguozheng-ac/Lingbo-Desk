const kernel = 'Microsoft-Windows-Kernel-Power';
const troubleshooter = 'Microsoft-Windows-Power-Troubleshooter';
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
function kind(event) {
  if (event?.provider === kernel) {
    if (event.id === 506) return ['modern-standby-s0', 'enter'];
    if (event.id === 507) return ['modern-standby-s0', 'exit'];
    if (event.id === 42) return ['sleep-wake-state-unspecified', 'enter'];
    if (event.id === 107) return ['sleep-wake-state-unspecified', 'exit'];
  }
  if (event?.provider === troubleshooter && event.id === 1) return ['sleep-wake-state-unspecified', 'exit'];
  return null;
}
function safeEvent(event) {
  const result = { provider: event.provider, id: event.id, recordId: event.recordId, at: event.at };
  for (const key of ['scenarioIdV2', 'scenarioId', 'bootId']) if (event[key] !== undefined) result[key] = event[key];
  return result;
}

/** Pure analysis of a bounded observation. No queries, writes or power actions. */
export function classifyPowerTransition({ manual, armedAt, acknowledgedAt, powerEvidence } = {}) {
  const fail = reason => ({ status: 'unverified', mode: null, reason, cycles: [] });
  if (manual !== true) return { status: 'not-requested', mode: null, reason: 'manual_wake_not_requested', cycles: [] };
  const since = timestamp(armedAt), until = timestamp(acknowledgedAt);
  if (!Number.isFinite(since) || !Number.isFinite(until) || until <= since) return fail('invalid_observation_window');
  if (powerEvidence?.available !== true || !Array.isArray(powerEvidence.events)) return fail('power_events_unavailable');
  if (powerEvidence.truncated === true) return fail('power_events_truncated');
  if (powerEvidence.window && (timestamp(powerEvidence.window.since) !== since || timestamp(powerEvidence.window.until) !== until)) return fail('evidence_window_mismatch');
  const byRecord = new Map();
  for (const raw of powerEvidence.events) {
    if (!kind(raw)) continue;
    const time = timestamp(raw.at);
    if (!Number.isFinite(time)) return fail('invalid_event_time');
    if (time < since || time > until) continue;
    if (!Number.isSafeInteger(raw.recordId) || raw.recordId <= 0) return fail('invalid_record_id');
    for (const key of ['scenarioIdV2', 'scenarioId', 'bootId']) if (raw[key] !== undefined && (typeof raw[key] !== 'string' || !/^\d{1,20}$/.test(raw[key]))) return fail('invalid_cycle_identity');
    const event = safeEvent(raw), previous = byRecord.get(event.recordId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) return fail('conflicting_record_identity');
    byRecord.set(event.recordId, event);
  }
  // Windows returns newest first. Use System-log record order and check wall time
  // independently, so a clock reversal cannot create a positive-looking cycle.
  const ordered = [...byRecord.values()].sort((a, b) => a.recordId - b.recordId);
  const cycles = []; let pending, previousTime = -Infinity;
  for (const event of ordered) {
    const time = timestamp(event.at), [mode, direction] = kind(event);
    if (time < previousTime) return fail('non_monotonic_event_time');
    previousTime = time;
    if (direction === 'enter') {
      if (pending) return fail('ambiguous_transition_sequence');
      pending = event;
      continue;
    }
    // A second resume notification (107 and Troubleshooter 1) is normal.
    if (!pending) continue;
    if (kind(pending)[0] !== mode) return fail('mixed_transition_modes');
    if (time <= timestamp(pending.at)) return fail('non_positive_transition_duration');
    // The recorded Windows 506/507 pair has matching V2 IDs but different
    // legacy UInt8 IDs. Prefer the common V2 identity rather than requiring
    // equality of both generations. Never round UInt64 identities to Number.
    const scenarioKey = pending.scenarioIdV2 !== undefined && event.scenarioIdV2 !== undefined ? 'scenarioIdV2' : 'scenarioId';
    const comparable = [scenarioKey, 'bootId'].filter(key => pending[key] !== undefined && event[key] !== undefined);
    if (comparable.some(key => pending[key] !== event[key])) return fail('cycle_identity_mismatch');
    if (mode === 'modern-standby-s0' && powerEvidence.modernStandbyDefinitionsAvailable !== true) return fail('modern_standby_definitions_unavailable');
    cycles.push({ mode, entry: pending, exit: event, elapsedSeconds: (time - timestamp(pending.at)) / 1000, identityBasis: comparable.length ? comparable : ['record-order-and-time'], legacyScenarioIdDiffers: pending.scenarioId !== undefined && event.scenarioId !== undefined && pending.scenarioId !== event.scenarioId });
    pending = undefined;
  }
  if (pending) return fail('incomplete_transition');
  if (!cycles.length) return fail('no_complete_transition');
  return { status: 'verified', mode: cycles.at(-1).mode, reason: 'bounded_event_pair_verified', cycles };
}

/** Keep functionality, power evidence and shutdown results independently visible. */
export function assessWakeRun(run) {
  const power = classifyPowerTransition({ manual: run.mode === 'manual-wake', armedAt: run.armedAt, acknowledgedAt: run.manualWakeAcknowledgedAt, powerEvidence: run.powerEvidence });
  const functionalStatus = run.functionalPassed === true ? 'passed' : run.error || run.functionalPassed === false ? 'failed' : 'not-completed';
  const cleanupStatus = run.cleanExit === true && !run.cleanupWarning ? 'passed' : run.cleanupWarning || run.cleanExit === false ? 'failed' : 'not-confirmed';
  const overallStatus = run.error || functionalStatus === 'failed' || cleanupStatus === 'failed' ? 'failed'
    : functionalStatus !== 'passed' || cleanupStatus !== 'passed' ? 'not-completed'
      : power.status === 'unverified' ? 'unverified' : 'passed';
  return { schemaVersion: 1, overallStatus, functionalStatus, cleanupStatus, power,
    limitations: ['Power event pairs establish transitions, not deepest low-power residency or battery consumption.', 'Mock-model task checks do not validate microphone, ASR/TTS, playback or old speech cancellation.'] };
}
