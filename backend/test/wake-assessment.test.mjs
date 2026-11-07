import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPowerTransition, assessWakeRun } from '../../scripts/wake-assessment.mjs';

const kernel = 'Microsoft-Windows-Kernel-Power', troubleshooter = 'Microsoft-Windows-Power-Troubleshooter';
const time = seconds => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
const event = (id, seconds, recordId, extra = {}) => ({ provider: kernel, id, at: time(seconds), recordId, ...extra });
const entry = () => event(506, 10, 100, { scenarioIdV2: '18446744073709551610', bootId: '7' });
const exit = () => event(507, 40, 101, { scenarioIdV2: '18446744073709551610', bootId: '7' });
const input = (events = [exit(), entry()]) => ({ manual: true, armedAt: time(0), acknowledgedAt: time(60), powerEvidence: { available: true, events, truncated: false, modernStandbyDefinitionsAvailable: true, window: { since: time(0), until: time(60) } } });
const classify = (events, overrides = {}) => classifyPowerTransition({ ...input(events), ...overrides });

test('modern standby uses bounded Windows record order, exact numeric identities and no input mutation', () => {
  const value = input(), before = JSON.stringify(value); const result = classifyPowerTransition(value);
  assert.equal(result.status, 'verified'); assert.equal(result.mode, 'modern-standby-s0'); assert.equal(result.cycles[0].elapsedSeconds, 30);
  assert.deepEqual(result.cycles[0].identityBasis, ['scenarioIdV2', 'bootId']); assert.equal(JSON.stringify(value), before);
});
test('traditional resume supports both providers without claiming S3 or counting two wake notices as two cycles', () => {
  const result = classify([event(42, 10, 1), event(107, 40, 2), event(1, 41, 3, { provider: troubleshooter })]);
  assert.equal(result.status, 'verified'); assert.equal(result.mode, 'sleep-wake-state-unspecified'); assert.equal(result.cycles.length, 1);
  assert.equal(classify([event(42, 10, 1), event(1, 40, 2, { provider: troubleshooter })]).status, 'verified');
});
test('missing entry, missing exit, reversed order, equal times and mixed modes never verify', () => {
  for (const events of [[], [exit()], [entry()], [event(507, 10, 1), event(506, 40, 2)], [entry(), { ...exit(), at: entry().at }], [entry(), event(107, 40, 101)]]) assert.equal(classify(events).status, 'unverified');
});
test('wrong providers and old or post-acknowledgement cycles cannot stand in for the observed wake', () => {
  for (const events of [[entry(), { ...exit(), provider: troubleshooter }], [event(506, -10, 1), event(507, -1, 2)], [entry(), event(507, 61, 101)], [event(42, 10, 1), event(107, 40, 2, { provider: troubleshooter })]]) assert.equal(classify(events).status, 'unverified');
});
test('unavailable logs, truncated history, absent provider definitions and query-window mismatch remain unverified', () => {
  for (const fields of [{ available: false }, { available: 'true' }, { events: null }, { truncated: true }, { modernStandbyDefinitionsAvailable: false }, { window: { since: time(-1), until: time(60) } }]) {
    const value = input(); Object.assign(value.powerEvidence, fields); assert.equal(classifyPowerTransition(value).status, 'unverified');
  }
});
test('malformed timestamps and observation windows cannot verify a cycle', () => {
  for (const overrides of [{ armedAt: 'invalid' }, { acknowledgedAt: time(0) }, { acknowledgedAt: time(-1) }, { acknowledgedAt: undefined }]) assert.equal(classify(undefined, overrides).status, 'unverified');
  for (const at of ['invalid', '', '2026-01-01', null]) assert.equal(classify([entry(), { ...exit(), at }]).status, 'unverified');
});
test('clock reversal, invalid record identity and conflicting duplicate records cannot verify', () => {
  for (const events of [[entry(), { ...exit(), recordId: 99 }], [entry(), { ...exit(), recordId: 0 }], [entry(), { ...exit(), recordId: '101' }], [entry(), { ...exit(), recordId: 100 }]]) assert.equal(classify(events).status, 'unverified');
  assert.equal(classify([entry(), exit(), exit()]).cycles.length, 1);
});
test('mismatched standby session or boot identifiers cannot be paired', () => {
  for (const fields of [{ scenarioIdV2: '18446744073709551611' }, { bootId: '8' }, { scenarioIdV2: 18446744073709551610 }]) assert.equal(classify([entry(), { ...exit(), ...fields }]).status, 'unverified');
  const result = classify([event(506, 10, 1), event(507, 40, 2)]);
  assert.equal(result.status, 'verified'); assert.deepEqual(result.cycles[0].identityBasis, ['record-order-and-time']);
});
test('the observed Windows cycle prefers matching V2 and boot IDs over changing legacy byte IDs', () => {
  const result = classify([ { ...entry(), scenarioId: '58' }, { ...exit(), scenarioId: '60' } ]);
  assert.equal(result.status, 'verified'); assert.equal(result.cycles[0].legacyScenarioIdDiffers, true);
  assert.deepEqual(result.cycles[0].identityBasis, ['scenarioIdV2', 'bootId']);
  assert.equal(classify([event(506, 10, 1, { scenarioId: '58' }), event(507, 40, 2, { scenarioId: '60' })]).status, 'unverified');
});
test('overlapping entries and a trailing unfinished cycle are conservative while separate complete cycles stay separate', () => {
  assert.equal(classify([entry(), event(506, 20, 101), event(507, 40, 102)]).status, 'unverified');
  assert.equal(classify([entry(), exit(), event(506, 50, 102)]).status, 'unverified');
  const result = classify([event(506, 1, 1), event(507, 10, 2), event(506, 20, 3), event(507, 50, 4)]);
  assert.equal(result.cycles.length, 2); assert.deepEqual(result.cycles.map(c => c.elapsedSeconds), [9, 30]);
});
test('preparation mode and a sampling gap alone never prove a power transition', () => {
  assert.equal(classify(undefined, { manual: false }).status, 'not-requested');
  assert.equal(classify([], { samples: [{ gapMs: 85000 }] }).status, 'unverified');
});
test('functional outcome, power evidence, cleanup and overall outcome are independent', () => {
  const value = input(); const run = { mode: 'manual-wake', armedAt: value.armedAt, manualWakeAcknowledgedAt: value.acknowledgedAt, powerEvidence: value.powerEvidence, functionalPassed: true, cleanExit: true };
  assert.equal(assessWakeRun(run).overallStatus, 'passed');
  const missing = assessWakeRun({ ...run, powerEvidence: { available: true, events: [] } });
  assert.equal(missing.functionalStatus, 'passed'); assert.equal(missing.power.status, 'unverified'); assert.equal(missing.overallStatus, 'unverified');
  const broken = assessWakeRun({ ...run, functionalPassed: false }); assert.equal(broken.power.status, 'verified'); assert.equal(broken.overallStatus, 'failed');
  assert.equal(assessWakeRun({ ...run, cleanupWarning: true }).overallStatus, 'failed');
  assert.equal(assessWakeRun({ ...run, cleanExit: undefined }).overallStatus, 'not-completed');
  assert.equal(assessWakeRun({ ...run, error: 'test failure' }).overallStatus, 'failed');
  const prepare = assessWakeRun({ ...run, mode: 'preparation-only' }); assert.equal(prepare.overallStatus, 'passed'); assert.equal(prepare.power.status, 'not-requested');
});
