import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { WorkPolicy, hashFile } from '../work-policy.mjs';
import { WorkTools } from '../work-tools.mjs';
import { WorkService } from '../work-service.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-export-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^lingbo-export-/); fs.rmSync(root, { recursive: true, force: true }); });
  const local = path.join(root, 'local'), destination = path.join(root, 'desktop'); fs.mkdirSync(destination);
  const policy = new WorkPolicy(local);
  const permissions = policy.update({ action: 'grant', directory: destination, mode: 'read', revision: 0 });
  const personal = { state: { model: 'deepseek' }, context: () => '' }, skills = { context: () => ({ text: '', versions: [] }) };
  const tools = new WorkTools({ policy, personal, skills });
  const service = new WorkService(path.join(local, 'work-tasks'), { policy, personal, skills, tools }); service.launch = () => {};
  const source = service.jobs.get(service.create('owner', crypto.randomUUID(), { request: '生成资料' }).id);
  const file = path.join(source.output, '报价.md'); fs.writeFileSync(file, 'DEMO-A-CN CNY');
  source.status = 'completed'; source.receipts.push({ ok: true, mutation: true, path: file, sha256: hashFile(file), tool: 'work_write' }); service.persist(source);
  const job = service.jobs.get(service.create('owner', crypto.randomUUID(), { request: '复制已有产物，不覆盖原文件' }).id);
  Object.assign(job, { status: 'running', attempts: 1, ticket: 'test', controller: new AbortController() });
  const args = { sourceTaskId: source.id, name: '报价.md', directory: destination };
  const execute = (tool, args) => service.execute({ taskId: job.id, ticket: 'test', tool, args });
  const pendingExport = async (approvalHook = () => {}, exportArgs = args) => {
    const pending = execute('work_export', exportArgs);
    if (job.approval) {
      await approvalHook(job.approval);
      await service.approve(job, { approvalId: job.approval.id, version: job.version, approved: true });
    }
    return pending;
  };
  return { root, local, destination, policy, permissions, tools, service, source, job, file, args, execute, pendingExport };
}

test('same-session recorded artifacts export with exact approval without granting general writes', async t => {
  const f = fixture(t), original = hashFile(f.file);
  assert.throws(() => f.tools.resolve(f.job, f.file), /禁止/);
  assert.throws(() => f.tools.resolve(f.job, path.join(f.destination, 'other.txt'), true), /未授权/);
  const listing = await f.execute('work_artifacts', { sourceTaskId: f.source.id });
  assert.equal(listing.ok, true, listing.error); assert.equal(listing.files[0].sha256, original);
  const result = await f.pendingExport(preview => {
    assert.equal(preview.tool, 'work_export'); assert.equal(preview.path, f.file);
    assert.equal(preview.destination, path.join(f.destination, '报价.md')); assert.equal(preview.sha256, original);
    assert.equal(fs.existsSync(preview.destination), false);
  });
  assert.equal(result.ok, true, result.error); assert.equal(hashFile(result.path), original); assert.equal(hashFile(f.file), original);
  assert.equal(f.policy.state.roots[0].mode, 'read'); assert.equal(f.job.receipts.at(-1).mutation, true);
  assert.equal((await f.execute('work_export', f.args)).replayed, true);
  assert.equal(fs.readdirSync(f.destination).length, 1);
});

test('collisions use a reviewed suffix, and only explicitly renameable acceptance follows that receipt', async t => {
  const f = fixture(t), requested = path.join(f.destination, '报价.md'); fs.writeFileSync(requested, '保留原件');
  f.job.acceptance = [{ path: requested, contains: ['DEMO-A-CN'], allowRename: true }];
  const result = await f.pendingExport(preview => assert.equal(preview.destination, path.join(f.destination, '报价(1).md')));
  assert.equal(result.ok, true, result.error); assert.equal(fs.readFileSync(requested, 'utf8'), '保留原件');
  const finish = () => f.execute('work_finish', { outcome: 'complete', summary: '已复制并核对' });
  assert.equal((await finish()).verification?.checks[0].path, result.path);
  f.job.finish = null; f.job.acceptance[0].allowRename = false;
  assert.match((await finish()).error, /缺少当前版本/);
});

test('cross-session, unrecorded, nested, changed and unfinished source artifacts are rejected', async t => {
  const f = fixture(t);
  f.source.sessionId = 'another'; assert.equal((await f.execute('work_artifacts', { sourceTaskId: f.source.id })).ok, false);
  assert.equal((await f.execute('work_export', f.args)).ok, false); f.source.sessionId = 'owner';
  for (const name of ['../task.json', '..\\task.json', 'inputs/input.txt', 'secret.json', '报价.md:secret']) {
    const result = await f.execute('work_export', { ...f.args, name }); assert.equal(result.ok, false); assert.ok(f.job.approval == null);
  }
  fs.appendFileSync(f.file, 'changed'); assert.equal((await f.execute('work_export', f.args)).ok, false);
  f.source.receipts[0].sha256 = hashFile(f.file); f.source.status = 'running';
  assert.equal((await f.execute('work_export', f.args)).ok, false);
  assert.deepEqual(fs.readdirSync(f.destination), []);
});

test('refusal, cancellation, changed source, revoked destination and a new collision do not copy', async t => {
  for (const scenario of ['refuse', 'cancel', 'source', 'revoke', 'collision']) {
    const f = fixture(t); const pending = f.execute('work_export', f.args);
    assert.ok(f.job.approval, scenario);
    if (scenario === 'source') fs.appendFileSync(f.file, 'changed');
    if (scenario === 'revoke') f.policy.update({ action: 'revoke', id: f.job.rootIds[0], revision: 1 });
    if (scenario === 'collision') fs.writeFileSync(f.job.approval.destination, '外部文件');
    if (scenario === 'cancel') f.service.control(f.job, { action: 'cancel' });
    else await f.service.approve(f.job, { approvalId: f.job.approval.id, version: f.job.version, approved: scenario !== 'refuse' });
    const result = await pending; assert.equal(result.ok, false, scenario);
    assert.deepEqual(fs.readdirSync(f.destination), scenario === 'collision' ? ['报价.md'] : [], scenario);
    assert.equal(f.job.intent, null);
    if (scenario === 'refuse') {
      assert.match((await f.execute('work_export', f.args)).error, /用户已拒绝/);
      const restored = new WorkService(f.service.directory, f).find('owner', f.job.id);
      assert.equal(restored.declinedExports.length, 1);
    }
  }
});

test('export refuses unauthorized destinations and linked paths even after a valid preview', async t => {
  const f = fixture(t);
  assert.equal((await f.execute('work_export', { ...f.args, directory: f.local })).ok, false);
  const other = path.join(f.root, 'other'); fs.mkdirSync(other);
  const pending = f.execute('work_export', f.args); assert.ok(f.job.approval);
  fs.rmdirSync(f.destination); fs.symlinkSync(other, f.destination, process.platform === 'win32' ? 'junction' : 'dir');
  await f.service.approve(f.job, { approvalId: f.job.approval.id, version: f.job.version, approved: true });
  assert.equal((await pending).ok, false); assert.deepEqual(fs.readdirSync(other), []);
});
