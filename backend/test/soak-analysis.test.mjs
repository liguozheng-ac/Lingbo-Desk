import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSoak, median, slopePerMinute } from '../../scripts/soak-analysis.mjs';

test('resource summaries preserve zero counters, use medians and report slopes in minutes', () => {
  assert.equal(median([0, 4, 2, 100]), 3); assert.equal(median([]), null);
  assert.equal(slopePerMinute([{ t: 0, y: 0 }, { t: 60, y: 2 }, { t: 120, y: 4 }]), 2);
  assert.equal(slopePerMinute([{ t: 0, y: 1 }, { t: 0, y: 2 }, { t: 0, y: 3 }]), null);
});

test('a backend restart is split into epochs and cannot be counted as an RSS improvement', () => {
  const samples = Array.from({ length: 13 }, (_, index) => {
    const elapsedSeconds = index * 150, backendPid = index < 7 ? 20 : 30;
    return { elapsedSeconds, backendPid, gatewayRssMiB: backendPid === 20 ? 150 : 60, processes: [{ pid: 10, parentPid: 1, privateBytes: 100 * 1048576, workingSetBytes: 80 * 1048576, handles: 100, cpuSeconds: index }, { pid: backendPid, parentPid: 10 }], lingeringWorkers: [], diagnostics: { files: 3, bytes: 1000 }, retainedJobs: index };
  });
  const result = analyzeSoak({ version: 'fixture', samples, plannedDurationSeconds: 1800, actualMeasurementSeconds: 1800, sampleSeconds: 150, tasks: [], faults: [], issues: [] });
  assert.equal(result.mainPid, 10); assert.equal(result.gatewayEpochs.length, 2); assert.equal(result.gatewayEpochs[0].rssMiBMedian, 150); assert.equal(result.gatewayEpochs[1].rssMiBMedian, 60);
  assert.equal(result.mainPrivateDeltaMiB, 0); assert.equal(result.mainCooldownPrivateSlopeMiBPerMinute, 0); assert.equal(result.measurementCoveredRequestedWindow, true);
});

test('an abbreviated pilot cannot be presented as a full 30-minute observation', () => {
  const samples = [0, 15, 30].map(elapsedSeconds => ({ elapsedSeconds, backendPid: 20, gatewayRssMiB: 50, processes: [{ pid: 10, parentPid: 1, privateBytes: 1024, workingSetBytes: 1024, handles: 1, cpuSeconds: 0 }, { pid: 20, parentPid: 10 }], diagnostics: { files: 1, bytes: 1 }, lingeringWorkers: [] }));
  assert.equal(analyzeSoak({ samples, plannedDurationSeconds: 1800, actualMeasurementSeconds: 30, sampleSeconds: 15 }).measurementCoveredRequestedWindow, false);
});

test('renderer-family growth is visible even when the main process is flat, without folding in a gateway restart', () => {
  const samples = Array.from({ length: 31 }, (_, index) => ({ elapsedSeconds: index * 60, backendPid: index < 18 ? 20 : 30, gatewayRssMiB: index < 18 ? 150 : 50, lingeringWorkers: [], diagnostics: { files: 3, bytes: 1000 }, processes: [
    { pid: 10, parentPid: 1, name: 'LingboDesk', privateBytes: 100 * 1048576, workingSetBytes: 80 * 1048576, handles: 100, cpuSeconds: index },
    { pid: 11, parentPid: 10, name: 'LingboDesk', privateBytes: (200 + index * 2) * 1048576 },
    { pid: index < 18 ? 20 : 30, parentPid: 10, name: 'node', privateBytes: (index < 18 ? 1000 : 50) * 1048576 },
  ] }));
  const summary = analyzeSoak({ samples, plannedDurationSeconds: 1800, actualMeasurementSeconds: 1800, sampleSeconds: 60, faults: [{ type: 'backend-crash-auto-restart-and-manual-task-resume', newPid: 30 }] });
  assert.equal(summary.mainPrivateDeltaMiB, 0); assert.ok(summary.desktopFamilyPrivateDeltaMiB > 0); assert.ok(summary.desktopFamilyCooldownSlopeMiBPerMinute > 0);
  assert.deepEqual(summary.unexpectedGatewayPids, []); assert.equal(summary.desktopProcessIdentityGroupsAfterWarmup, 1);
});
