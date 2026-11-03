import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { TaskStore, digest, fileDigest } from '../task-store.mjs';
import { ReportTaskService } from '../task-service.mjs';
import { auditReport, paragraphs } from '../report-audit.mjs';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-persist-'));
  const storeDirectory = path.join(root, 'state');
  const id = 'report-' + crypto.randomUUID();
  const workspace = path.join(root, 'runs', 'before', id);
  const sandbox = path.join(workspace, 'sandbox');
  fs.mkdirSync(sandbox, { recursive: true });
  for (const name of ['source-a.md', 'source-b.md', 'extract.md', 'report.md']) fs.writeFileSync(path.join(sandbox, name), name + ' body');
  const record = { id, sessionId: 'test-owner', status: 'running', version: 1, includeJapanese: false, requirements: '',
    workspace: path.relative(root, workspace), current: 'report', completed: ['extract'], evidence: [],
    inputHashes: Object.fromEntries(['source-a.md', 'source-b.md'].map(name => [name, fileDigest(path.join(sandbox, name))])),
    checkpoints: { extract: { output: 'extract.md', sha256: fileDigest(path.join(sandbox, 'extract.md')) } },
    attemptHistory: [{ number: 1, workspace: path.relative(root, workspace) }], requestKey: JSON.stringify(['test-owner', 'original-request']), createdAt: new Date().toISOString() };
  const store = new TaskStore(storeDirectory, root); store.save(record); store.release();
  const open = () => new ReportTaskService(path.join(root, 'runs', 'after'), () => {}, 10, { workspace: root, storeDirectory });
  return { root, storeDirectory, id, record, sandbox, open };
}

test('restart retains identity, deduplication, checkpoints and revised requirements without executing', async () => {
  const fixture = setup(); let service = fixture.open();
  try {
    let job = service.find('test-owner', fixture.id);
    assert.equal(job.status, 'interrupted'); assert.equal(service.snapshot(job.id).recovery.nextStage, 'report');
    assert.equal(job.worker, undefined);
    assert.equal(service.create('test-owner', 'original-request').id, job.id);
    service.modify(job, 1, true, '恢复后新增要求');
    await service.close(); service = fixture.open(); job = service.find('test-owner', fixture.id);
    assert.equal(job.version, 2); assert.equal(job.requirements, '恢复后新增要求');
    assert.equal(service.snapshot(job.id).recovery.canResume, true);
    assert.throws(() => service.find('another-owner', job.id), /不属于/);
  } finally { await service.close(); }
});

test('altered checkpoint blocks resume; an interrupted copy can use its intact earlier checkpoint', async () => {
  const fixture = setup(); const service = fixture.open();
  try {
    const job = service.find('test-owner', fixture.id);
    fs.writeFileSync(path.join(fixture.sandbox, 'extract.md'), 'altered');
    assert.equal(service.snapshot(job.id).recovery.canResume, false);
    assert.throws(() => service.resume(job), /不可恢复/);
    fs.writeFileSync(path.join(fixture.sandbox, 'extract.md'), 'extract.md body');
    const partial = path.join(fixture.root, 'runs', 'partial', job.id);
    fs.mkdirSync(partial, { recursive: true }); job.workspace = partial;
    assert.equal(service.snapshot(job.id).recovery.canResume, true);
  } finally { await service.close(); }
});

test('completed artifacts survive reload and changed outputs are detected', async () => {
  const fixture = setup(); fixture.record.status = 'completed'; fixture.record.completed.push('report');
  fixture.record.checkpoints.report = { output: 'report.md', sha256: fileDigest(path.join(fixture.sandbox, 'report.md')) };
  const store = new TaskStore(fixture.storeDirectory, fixture.root); store.save(fixture.record); store.release();
  const service = fixture.open();
  try {
    const job = service.find('test-owner', fixture.id);
    assert.equal(service.artifact(job, 'report.md'), 'report.md body');
    fs.writeFileSync(path.join(fixture.sandbox, 'report.md'), 'tampered');
    assert.throws(() => service.artifact(job, 'report.md'), /校验不一致/);
  } finally { await service.close(); }
});

test('store rejects a second writer and surfaces damaged state without removing it', () => {
  const fixture = setup(); const store = new TaskStore(fixture.storeDirectory, fixture.root);
  try {
    assert.throws(() => new TaskStore(fixture.storeDirectory, fixture.root), /写入锁/);
    const damaged = path.join(fixture.storeDirectory, 'report-' + crypto.randomUUID() + '.json');
    fs.writeFileSync(damaged, '{broken');
    assert.equal(store.load().length, 1); assert.equal(store.warnings.length, 1); assert.ok(fs.existsSync(damaged));
  } finally { store.release(); }
});

test('audit resolves source paragraphs and flags unknown IDs, ungrounded numbers and conflicts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-persist-'));
  const entries = ['预算：5万元\n周期：3天', '预算：8万元\n周期：3天'].map((text, index) => {
    fs.writeFileSync(path.join(root, `${index + 1}.txt`), text);
    fs.writeFileSync(path.join(root, `${index + 1}.json`), JSON.stringify({ text }));
    return { source: `S${index + 1}`, name: `资料${index + 1}.txt`, sha256: digest(text), textSha256: digest(text) };
  });
  const bundle = { directory: root, entries };
  const audit = auditReport('# 报告\n预算为99万元。[S1-P1]\n错误来源[S9]\n错误段落[S1-P9]\n错误格式[source-b]', bundle);
  for (const code of ['unknown_reference', 'invalid_reference', 'number_not_found', 'source_conflict']) assert.ok(audit.findings.some(item => item.code === code), code);
  assert.equal(audit.references[0].file, '资料1.txt'); assert.equal(audit.references[0].paragraph, 'S1-P1');
  assert.equal(paragraphs('第一段\n\n第二段', 'S1')[1].id, 'S1-P2');
  fs.writeFileSync(path.join(root, '1.txt'), 'altered');
  assert.equal(auditReport('预算为5万元。[S1-P1]', bundle).status, 'integrity_failed');
});
