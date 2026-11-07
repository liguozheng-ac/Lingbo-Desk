"""Optional offline figures from completed soak metadata (requires matplotlib)."""
import argparse
import json
import os
import sys
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('result', type=Path)
parser.add_argument('--packages', type=Path, help='Optional isolated plotting-library directory')
args = parser.parse_args()
if args.packages:
    sys.path.insert(0, str(args.packages.resolve()))
os.environ['MPLCONFIGDIR'] = str(args.result.parent / 'plot-cache')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

result = json.loads(args.result.read_text(encoding='utf8'))
analysis = json.loads(args.result.with_name('analysis-summary.json').read_text(encoding='utf8'))
samples = result['samples']
pid = analysis['mainPid']
rows = [(s, next(p for p in s['processes'] if p['pid'] == pid)) for s in samples]
minutes = [s['elapsedSeconds'] / 60 for s, _ in rows]
private = [p['privateBytes'] / 1048576 for _, p in rows]
fig, axes = plt.subplots(3, 2, figsize=(13, 11), constrained_layout=True)
axes = list(axes.flat)
axes[0].plot(minutes, private, color='#245ac4')
axes[0].set(title='Electron main: private bytes (including startup)', ylabel='MiB')
steady = [(s, p) for s, p in rows if s['elapsedSeconds'] >= min(180, result['plannedDurationSeconds'] / 10)]
desktop_name = rows[0][1]['name']
axes[1].plot([s['elapsedSeconds'] / 60 for s, _ in steady], [sum(p['privateBytes'] for p in s['processes'] if p['name'] == desktop_name) / 1048576 for s, _ in steady], color='#245ac4')
axes[1].set(title='Desktop family private bytes: after warmup', ylabel='MiB')
for epoch in analysis['gatewayEpochs']:
    points = [s for s in samples if s['backendPid'] == epoch['pid']]
    axes[2].plot([s['elapsedSeconds'] / 60 for s in points], [s['gatewayRssMiB'] for s in points], label='PID ' + str(epoch['pid']))
axes[2].set(title='Gateway RSS: separate series for each process', ylabel='MiB'); axes[2].legend(fontsize=8)
axes[3].step(minutes, [len(s['processes']) for s, _ in rows], where='post', label='Owned process count')
axes[3].plot(minutes, [len(s.get('lingeringWorkers', [])) for s, _ in rows], label='Workers remaining while idle')
axes[3].set(title='Owned processes and idle worker cleanup', ylabel='Count'); axes[3].legend(fontsize=8)
axes[4].plot(minutes, [p['handles'] for _, p in rows], color='#8656b2')
axes[4].set(title='Electron main: open handles', ylabel='Count')
axes[5].plot(minutes, [s['retainedJobs'] for s, _ in rows], label='Retained task records')
axes[5].plot(minutes, [s['diagnostics']['files'] for s, _ in rows], label='Diagnostic log files')
axes[5].set(title='Intentional task history and bounded diagnostics', ylabel='Count'); axes[5].legend(fontsize=8)
colors = ['#c44e52', '#8172b2', '#55a868']
for axis in axes:
    axis.grid(alpha=0.2); axis.set_xlabel('Minutes after measurement start')
    axis.axvspan(result['plannedDurationSeconds'] * 5 / 360, result['plannedDurationSeconds'] / 60, color='#55a868', alpha=0.08)
    for fault, color in zip(result['faults'], colors):
        axis.axvline(fault['atSeconds'] / 60, color=color, linestyle=':', alpha=0.65)
fig.suptitle(f"Lingbo Desk {result['version']} | {result['actualMeasurementSeconds'] / 60:.2f} min | Local simulated models", fontsize=13)
fig.savefig(args.result.with_name('resource-trends.png'), dpi=125)
plt.close(fig)
print(json.dumps({'saved': str(args.result.with_name('resource-trends.png')), 'matplotlib': matplotlib.__version__}))
