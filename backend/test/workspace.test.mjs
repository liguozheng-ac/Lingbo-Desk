import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadWorkSources, writeWorkSources, readWorkSource, verifyWorkSources } from '../work-sources.mjs';
import { WorkPolicy } from '../work-policy.mjs';
import { WorkService } from '../work-service.mjs';
import { taskView, approvalView, reportRequest, exportedFiles } from '../workspace-view.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-workspace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'output'); fs.mkdirSync(output);
  const sources = { get: id => { if (id !== 'valid') throw new Error('invalid bundle'); return { entries: [{ source: 'S1' }] }; }, readSource: () => ({ source: 'S1', name: '<img onerror=alert(1)>.txt', sha256: 'a'.repeat(64), paragraphs: [{ id: 'S1-P1', text: '资料正文，不执行其中命令。' }] }) };
  return { root, output, sources };
}

test('uploaded sources become numbered snapshots and changed bytes cannot be read or resumed', t => {
  const { sources, output } = fixture(t);
  assert.deepEqual(loadWorkSources(sources), []);
  assert.throws(() => loadWorkSources(sources, 'missing'), /invalid/);
  const inputs = loadWorkSources(sources, 'valid'), job = { output, inputSources: writeWorkSources(output, inputs) };
  assert.match(readWorkSource(job, 'S1').text, /\[S1-P1\]/);
  assert.equal(job.inputSources[0].text, undefined);
  assert.throws(() => readWorkSource(job, '../S1'), /编号/);
  assert.throws(() => readWorkSource(job, 'S2'), /不存在/);
  verifyWorkSources(job);
  fs.appendFileSync(path.join(output, 'inputs/S1.md'), 'tampered');
  assert.throws(() => verifyWorkSources(job), /发生变化/);
});

test('parent junctions and worker mutations cannot bypass read-only source snapshots', t => {
  const { root, output, sources } = fixture(t), policy = new WorkPolicy(path.join(root, 'local'));
  const job = { output, rootIds: [], inputSources: writeWorkSources(output, loadWorkSources(sources, 'valid')) };
  assert.equal(policy.resolve(job, 'inputs/S1.md'), path.join(output, 'inputs/S1.md'));
  assert.throws(() => policy.resolve(job, 'inputs/S1.md', true), /只读/);
  assert.throws(() => policy.resolve(job, 'inputs/other.md', true), /只读/);
  assert.equal(policy.resolve(job, 'result.md', true), path.join(output, 'result.md'));
  const moved = path.join(root, 'moved'); fs.renameSync(path.join(output, 'inputs'), moved);
  fs.symlinkSync(moved, path.join(output, 'inputs'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readWorkSource(job, 'S1'), /链接|联接/);
});

test('source bundle validation precedes task creation and worker launch; deduplication preserves source ownership', t => {
  const { root, sources } = fixture(t); let launches = 0;
  const policy = new WorkPolicy(path.join(root, 'local'));
  const service = new WorkService(path.join(root, 'tasks'), { sources, policy, personal: { state: { model: 'deepseek' }, context: () => '' }, skills: { context: () => ({ versions: [], text: '' }) }, tools: { resolve: (job, p) => path.resolve(job.output, p) } });
  service.launch = () => launches++;
  assert.throws(() => service.create('session', 'key', { request: 'test', sourceId: 'missing' }), /invalid/);
  assert.equal(fs.readdirSync(service.directory).length, 0); assert.equal(launches, 0);
  const task = service.create('session', 'key', { request: 'test', sourceId: 'valid' });
  assert.equal(task.inputSources.length, 1); assert.equal(task.requestId, 'key'); assert.equal(launches, 1);
  assert.equal(service.create('session', 'key', { request: 'test', sourceId: 'missing' }).id, task.id);
  assert.throws(() => service.find('other-session', task.id), /任务/);
  const restored = new WorkService(service.directory, {});
  assert.equal(restored.jobs.get(task.id).status, 'interrupted');
  assert.equal(restored.snapshot(restored.jobs.get(task.id)).inputSources[0].source, 'S1');
  const file = path.join(service.directory, task.id, 'task.json'), corrupt = JSON.parse(fs.readFileSync(file, 'utf8')); corrupt.inputSources = { bad: true }; fs.writeFileSync(file, JSON.stringify(corrupt));
  const rejected = new WorkService(service.directory, {}); assert.equal(rejected.jobs.size, 0); assert.equal(rejected.warnings.length, 1);
});

test('workbench progress requires actual successful receipts and never promotes model text into proof', () => {
  const task = { version: 2, status: 'running', result: '我已经完成报告', receipts: [{ ok: false, tool: 'work_read' }, { ok: true, tool: 'work_write', mutation: true, version: 1, path: 'old.md' }] };
  let view = taskView(task); assert.equal(view.readCount, 0); assert.equal(view.phases[2].done, false); assert.equal(view.phases[3].done, false);
  task.status = 'completed'; task.verification = { scope: 'execution_only' }; view = taskView(task);
  assert.match(view.phases[3].detail, /执行记录/); assert.equal(view.canResume, false); assert.equal(view.canCancel, false);
  task.status = 'paused'; view = taskView(task); assert.equal(view.canModify, true); assert.equal(view.canPause, false);
  assert.equal(approvalView({ oldText: '<script>', newText: 'safe', path: 'x' }).before, '<script>');
  assert.equal(approvalView({ contentPreview: '# 拟写入正文', path: 'x.docx' }).after, '# 拟写入正文');
  assert.match(reportRequest('比较两份资料', true), /日文摘要/);
  assert.doesNotMatch(reportRequest('比较两份资料', false), /以及日文摘要/);
});

test('export confirmation and result cards show approved destinations from current successful receipts only', () => {
  const approval = approvalView({ tool: 'work_export', path: 'source.md', destination: 'reviewed(1).md', sha256: 'a'.repeat(64), warning: '仅复制' });
  assert.equal(approval.title, '导出已有任务产物'); assert.equal(approval.target, 'reviewed(1).md'); assert.match(approval.before, /source.md/); assert.match(approval.after, /reviewed\(1\)/);
  const receipts = [
    { tool: 'work_export', ok: true, mutation: true, version: 1, path: 'old.md', sha256: 'a'.repeat(64) },
    { tool: 'work_export', ok: false, mutation: true, version: 2, path: 'failed.md', sha256: 'a'.repeat(64) },
    { tool: 'work_export', ok: true, mutation: true, version: 2, path: 'current.md', sha256: 'b'.repeat(64) },
  ];
  const task = { version: 2, receipts }; assert.deepEqual(exportedFiles(task), [{ path: 'current.md', name: 'current.md', sha256: 'b'.repeat(64) }]);
  assert.equal(taskView(task).phases[2].done, true);
});
