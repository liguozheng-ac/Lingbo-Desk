import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
export function slopePerMinute(points) {
  const valid = points.filter(p => Number.isFinite(p.t) && Number.isFinite(p.y));
  if (valid.length < 3) return null;
  const mt = valid.reduce((sum, p) => sum + p.t, 0) / valid.length, my = valid.reduce((sum, p) => sum + p.y, 0) / valid.length;
  const denominator = valid.reduce((sum, p) => sum + (p.t - mt) ** 2, 0);
  return denominator ? valid.reduce((sum, p) => sum + (p.t - mt) * (p.y - my), 0) / denominator * 60 : null;
}
const round = number => Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
const MiB = 1048576;
export function analyzeSoak(result) {
  const samples = result.samples || [], initial = samples[0];
  if (!initial) throw new Error('No process samples to analyze');
  const ownedIds = new Set(initial.processes.map(p => p.pid)), roots = initial.processes.filter(p => !ownedIds.has(p.parentPid));
  if (roots.length !== 1) throw new Error('Cannot identify one owned application main process');
  const mainPid = roots[0].pid, desktopName = roots[0].name, duration = result.actualMeasurementSeconds || samples.at(-1).elapsedSeconds;
  const warmup = Math.min(180, duration / 10), baselineWidth = Math.min(120, duration / 10), cooldown = result.plannedDurationSeconds * 5 / 6;
  const points = samples.map(s => ({ ...s, main: s.processes.find(p => p.pid === mainPid), desktopPrivateMiB: s.processes.filter(p => p.name === desktopName).reduce((sum, p) => sum + (p.privateBytes || 0), 0) / MiB, desktopCpuSeconds: s.processes.filter(p => p.name === desktopName).reduce((sum, p) => sum + (p.cpuSeconds || 0), 0) })).filter(s => s.main);
  const baseline = points.filter(s => s.elapsedSeconds >= warmup && s.elapsedSeconds < warmup + baselineWidth);
  const idle = points.filter(s => s.elapsedSeconds >= cooldown);
  const steady = points.filter(s => s.elapsedSeconds >= warmup);
  const summary = list => ({ samples: list.length, privateMiBMedian: round(median(list.map(s => s.main.privateBytes / MiB))), workingSetMiBMedian: round(median(list.map(s => s.main.workingSetBytes / MiB))), handlesMedian: median(list.map(s => s.main.handles)), processCountMedian: median(list.map(s => s.processes.length)) });
  const first = baseline.length ? baseline : points.slice(0, 3), last = idle.length ? idle : points.slice(-3);
  const cpu = list => { const a = list[0], b = list.at(-1); return a && b && b.elapsedSeconds > a.elapsedSeconds ? round((b.main.cpuSeconds - a.main.cpuSeconds) / (b.elapsedSeconds - a.elapsedSeconds) * 100) : null; };
  const gatewayGroups = new Map();
  for (const sample of samples) { const list = gatewayGroups.get(sample.backendPid) || []; list.push(sample); gatewayGroups.set(sample.backendPid, list); }
  const gatewayEpochs = [...gatewayGroups].map(([pid, list]) => ({ pid, firstSeenSeconds: list[0].elapsedSeconds, lastSeenSeconds: list.at(-1).elapsedSeconds, samples: list.length, rssMiBMin: Math.min(...list.map(s => s.gatewayRssMiB)), rssMiBMax: Math.max(...list.map(s => s.gatewayRssMiB)), rssMiBMedian: median(list.map(s => s.gatewayRssMiB)), note: 'Each PID is an independent epoch; restart drops are not memory improvements.' }));
  const lastMinute = idle.filter(s => s.elapsedSeconds >= duration - Math.min(60, duration / 20));
  const firstIdleMinute = idle.filter(s => s.elapsedSeconds < cooldown + Math.min(60, duration / 20));
  const idleDelta = median(lastMinute.map(s => s.main.privateBytes / MiB)) - median(firstIdleMinute.map(s => s.main.privateBytes / MiB));
  const reviewFlags = [];
  const expectedPids = new Set([initial.backendPid, ...(result.faults || []).filter(f => f.type === 'backend-crash-auto-restart-and-manual-task-resume').map(f => f.newPid)]);
  const unexpectedGatewayPids = [...gatewayGroups.keys()].filter(pid => !expectedPids.has(pid));
  const desktopIdentities = new Set(steady.map(s => s.processes.filter(p => p.name === desktopName).map(p => p.pid).sort((a, b) => a - b).join(',')));
  const expectedObserverConnections = 1 + (result.faults || []).filter(f => ['backend-crash-auto-restart-and-manual-task-resume', 'observer-sse-reconnect'].includes(f.type)).length;
  if (unexpectedGatewayPids.length) reviewFlags.push('Unplanned gateway process identities were observed.');
  if (desktopIdentities.size > 1) reviewFlags.push('Desktop subprocess identities changed after warmup; aggregate changes need per-process interpretation.');
  if ((result.sse?.connections || 0) > expectedObserverConnections) reviewFlags.push('More observer SSE connections occurred than the injected faults explain.');
  if (firstIdleMinute.length >= 2 && lastMinute.length >= 2 && idleDelta > 64) reviewFlags.push('Private bytes grew by over 64 MiB within cooldown; diagnostic flag, not a leak verdict.');
  const maxGap = samples.length > 1 ? Math.max(...samples.slice(1).map((s, i) => s.elapsedSeconds - samples[i].elapsedSeconds)) : null;
  return {
    version: result.version, requestedDurationSeconds: result.plannedDurationSeconds, observedDurationSeconds: duration,
    functionalPassed: result.passed, measurementCoveredRequestedWindow: duration >= result.plannedDurationSeconds && samples.length >= result.plannedDurationSeconds / result.sampleSeconds * 0.8,
    sampleCount: samples.length, maxSampleGapSeconds: round(maxGap), mainPid,
    taskCount: result.tasks?.length || 0, completedTasks: result.tasks?.filter(t => t.status === 'completed').length || 0,
    mainBaseline: summary(first), mainCooldown: summary(last), mainPrivateDeltaMiB: round(median(last.map(s => s.main.privateBytes / MiB)) - median(first.map(s => s.main.privateBytes / MiB))),
    mainSteadyPrivateSlopeMiBPerMinute: round(slopePerMinute(steady.map(s => ({ t: s.elapsedSeconds, y: s.main.privateBytes / MiB })))),
    mainCooldownPrivateSlopeMiBPerMinute: round(slopePerMinute(idle.map(s => ({ t: s.elapsedSeconds, y: s.main.privateBytes / MiB })))),
    mainHandleDelta: median(last.map(s => s.main.handles)) - median(first.map(s => s.main.handles)),
    mainCooldownHandleSlopePerMinute: round(slopePerMinute(idle.map(s => ({ t: s.elapsedSeconds, y: s.main.handles })))),
    mainCooldownCpuPercentOfOneCore: cpu(idle), gatewayEpochs, unexpectedGatewayPids, desktopProcessIdentityGroupsAfterWarmup: desktopIdentities.size,
    desktopFamilyBaselinePrivateMiB: round(median(first.map(s => s.desktopPrivateMiB))), desktopFamilyCooldownPrivateMiB: round(median(last.map(s => s.desktopPrivateMiB))),
    desktopFamilyPrivateDeltaMiB: round(median(last.map(s => s.desktopPrivateMiB)) - median(first.map(s => s.desktopPrivateMiB))),
    desktopFamilyCooldownSlopeMiBPerMinute: round(slopePerMinute(idle.map(s => ({ t: s.elapsedSeconds, y: s.desktopPrivateMiB })))),
    desktopFamilyCooldownCpuPercentOfOneCore: desktopIdentities.size === 1 && idle.length >= 2 ? round((idle.at(-1).desktopCpuSeconds - idle[0].desktopCpuSeconds) / (idle.at(-1).elapsedSeconds - idle[0].elapsedSeconds) * 100) : null,
    expectedObserverConnections,
    idleWorkerSamples: samples.filter(s => s.lingeringWorkers?.length).length,
    maximumDiagnosticFiles: Math.max(...samples.map(s => s.diagnostics.files)), maximumDiagnosticKiB: round(Math.max(...samples.map(s => s.diagnostics.bytes)) / 1024),
    faults: result.faults, issues: result.issues, sse: result.sse, cleanExit: result.cleanExit, actualCloudCalls: result.actualCloudCalls,
    reviewFlags, interpretation: 'Observed resource counters only. Startup, GC, retained task/chat history, OS scheduling and backend restart confound leak claims. CPU is a one-core equivalent; working-set sums can double-count shared pages. No audible speech, GPU VRAM, sleep/wake or long-term guarantee.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.resolve(process.argv[2] || '');
  if (!process.argv[2]) throw new Error('Provide an explicit soak-result.json');
  const result = JSON.parse(fs.readFileSync(file, 'utf8')), analysis = analyzeSoak(result);
  const target = path.join(path.dirname(file), 'analysis-summary.json'); fs.writeFileSync(target, JSON.stringify(analysis, null, 2));
  const header = 'seconds,backend_pid,main_private_mib,main_handles,gateway_rss_mib,process_count,retained_jobs,connected,diagnostic_files';
  const rows = result.samples.map(s => { const main = s.processes.find(p => p.pid === analysis.mainPid); return [s.elapsedSeconds, s.backendPid, round(main.privateBytes / MiB), main.handles, s.gatewayRssMiB, s.processes.length, s.retainedJobs, s.connected, s.diagnostics.files].join(','); });
  fs.writeFileSync(path.join(path.dirname(file), 'samples.csv'), header + '\n' + rows.join('\n') + '\n');
  console.log(JSON.stringify({ saved: target, ...analysis }, null, 2));
}
