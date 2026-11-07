import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { WorkPolicy, hashFile } from '../work-policy.mjs';
import { WorkTools } from '../work-tools.mjs';
import { WorkService, WORK_TOOL_LIMIT } from '../work-service.mjs';
import { PersonalStore } from '../personal-store.mjs';
import { PersonalSkills } from '../personal-skills.mjs';
import { normalizeAcceptance } from '../work-acceptance.mjs';

function fixture(t, acceptance = [], request = '生成文件') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-acceptance-'));
  t.after(() => { if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('lingbo-acceptance-')) fs.rmSync(root, { recursive: true, force: true }); });
  const local = path.join(root, 'local'), input = path.join(root, 'input'); fs.mkdirSync(input);
  const policy = new WorkPolicy(local), personal = new PersonalStore(local), skills = new PersonalSkills(path.join(local, 'skills'), personal);
  const permissions = policy.update({ action: 'grant', directory: input, mode: 'write', revision: 0 });
  const tools = new WorkTools({ policy, personal, skills }), directory = path.join(local, 'work');
  const service = new WorkService(directory, { policy, personal, skills, tools }); service.launch = () => {};
  const task = service.create('owner', crypto.randomUUID(), { request, acceptance, rootIds: permissions.roots.map(r => r.id) });
  const job = service.jobs.get(task.id); Object.assign(job, { status: 'running', attempts: 1, ticket: 'fixture', controller: new AbortController() });
  const execute = (tool, args = {}) => service.execute({ taskId: job.id, ticket: 'fixture', tool, args });
  const finish = extra => execute('work_finish', { outcome: 'complete', summary: '模型声称已完成', ...extra });
  return { root, local, input, directory, policy, personal, skills, tools, service, job, execute, finish };
}

test('an unrelated output cannot satisfy a pinned target, nor can finish override the contract', async t => {
  const f = fixture(t, [{ path: 'expected.md', contains: ['正确内容'] }]);
  assert.equal((await f.execute('work_write', { path: 'other.md', content: '正确内容' })).ok, true);
  const reply = await f.finish({ acceptance: [{ path: 'other.md' }], verification: { scope: 'forged' } });
  assert.equal(reply.ok, false); assert.match(reply.error, /缺少当前版本/); assert.equal(f.job.finish, undefined);
  assert.equal(path.basename(f.job.acceptance[0].path), 'expected.md');
});

test('declared exact-text conditions inspect the whole text, including beyond model read limits', async t => {
  const f = fixture(t, [{ path: 'result.md', contains: ['项目结论'], notContains: ['待补充'] }]);
  await f.execute('work_write', { path: 'result.md', content: '甲'.repeat(21000) + '\n项目结论\n待补充' });
  const reply = await f.finish();
  assert.equal(reply.ok, false); assert.match(reply.error, /禁止出现/); assert.equal(f.job.readCharacters || 0, 0);
});

test('matching file evidence, exact contents and optional SHA256 produce a persisted scoped verdict', async t => {
  const f = fixture(t, [{ path: 'result.md', contains: ['项目结论'], notContains: ['待补充'] }]);
  const output = await f.execute('work_write', { path: 'result.md', content: '项目结论：验证通过。' });
  f.job.acceptance[0].sha256 = output.sha256;
  const reply = await f.finish();
  assert.equal(reply.ok, true); assert.equal(reply.verification.scope, 'declared_outputs');
  assert.equal(reply.verification.checks[0].sha256, hashFile(output.path));
  assert.equal(reply.verification.checks[0].contentChecked, true);
  assert.equal(reply.verification.checks[0].textScope, 'full_text');
  const restored = new WorkService(f.directory, f).find('owner', f.job.id);
  assert.equal(restored.finish.verification.scope, 'declared_outputs');
  assert.deepEqual(restored.acceptance, f.job.acceptance);
});

test('missing required text and mismatched expected hash cannot be completed', async t => {
  const f = fixture(t, [{ path: 'result.md', contains: ['项目结论'] }]);
  await f.execute('work_write', { path: 'result.md', content: '只有标题' });
  assert.match((await f.finish()).error, /缺少必须包含/);
  f.job.acceptance[0].sha256 = '0'.repeat(64);
  assert.match((await f.finish()).error, /SHA256/);
});

test('old task versions and read-only receipts cannot satisfy an output contract', async t => {
  const f = fixture(t, [{ path: 'result.md' }], '核对产物');
  await f.execute('work_write', { path: 'result.md', content: 'data' }); f.job.version++;
  await f.execute('work_read', { path: 'result.md' });
  assert.match((await f.finish()).error, /缺少当前版本/);
});

test('legacy tasks without explicit checks report execution-only evidence', async t => {
  const f = fixture(t, [], '读取记忆'); await f.execute('work_memory');
  const reply = await f.finish();
  assert.equal(reply.ok, true); assert.equal(reply.verification.scope, 'execution_only');
  assert.match(reply.verification.limitation, /人工复核/); assert.deepEqual(reply.verification.checks, []);
});

test('revoked grants and concurrent changes during extraction invalidate acceptance', async t => {
  const f = fixture(t, [{ path: 'result.md', contains: ['ok'] }]);
  const result = await f.execute('work_write', { path: 'result.md', content: 'ok' });
  const original = f.tools.acceptanceText.bind(f.tools);
  f.tools.acceptanceText = async (...args) => { const text = await original(...args); fs.appendFileSync(result.path, 'changed'); return text; };
  assert.match((await f.finish()).error, /验收期间/);
  const file = path.join(f.input, 'granted.md'); fs.writeFileSync(file, 'ok');
  f.job.acceptance = [{ path: file }];
  f.job.receipts.push({ id: 'fixture-external', ok: true, mutation: true, version: f.job.version, attempt: 1, path: file, sha256: hashFile(file), tool: 'work_write' });
  // Supersede the concurrent-change receipt so the permission check is reached.
  f.job.receipts.push({ ok: true, mutation: true, version: 1, attempt: 1, path: result.path, sha256: hashFile(result.path) });
  f.policy.update({ action: 'revoke', id: f.job.rootIds[0], revision: f.policy.state.revision });
  assert.match((await f.finish()).error, /未授权/);
});

test('real DOCX output is reopened and checked instead of trusting its create receipt', async t => {
  const f = fixture(t, [{ path: 'result.docx', contains: ['项目结论'], notContains: ['待补充'] }]);
  const output = await f.execute('work_office', { operation: 'create_docx', path: 'result.docx', content: '# 项目结论\n真实 Office 产物。' });
  assert.equal(output.ok, true, output.error);
  const reply = await f.finish(); assert.equal(reply.ok, true, reply.error);
  assert.equal(reply.verification.checks[0].contentChecked, true);
  assert.equal(reply.verification.checks[0].textScope, 'docx_body_paragraphs_tables');
});

test('unsupported formats fail closed for text checks instead of accepting truncated extraction', async t => {
  const f = fixture(t, [{ path: 'result.xlsx', contains: ['ok'] }]);
  await f.execute('work_office', { operation: 'create_xlsx', path: 'result.xlsx', data: JSON.stringify({ sheets: [{ name: 'Data', rows: [['ok']] }] }) });
  assert.match((await f.finish()).error, /正文验收当前仅支持/);
});

test('broker independently rejects native tool names and enforces 48 calls before dispatch', async t => {
  const f = fixture(t, [], '读取记忆'); let count = 0;
  const original = f.tools.execute.bind(f.tools); f.tools.execute = (...args) => { count++; return original(...args); };
  assert.match((await f.execute('exec_command', { command: 'never execute' })).error, /白名单/);
  for (let i = 0; i < WORK_TOOL_LIMIT; i++) await f.execute('work_memory');
  assert.match((await f.execute('work_memory')).error, /硬上限/);
  assert.match((await f.finish()).error, /硬上限/);
  assert.equal(count, WORK_TOOL_LIMIT); assert.equal(f.job.toolCalls, WORK_TOOL_LIMIT);
});

test('paused modifications version and copy acceptance conditions, preserving checks when omitted', t => {
  const f = fixture(t, [{ path: 'result.md', contains: ['old'] }]); f.job.status = 'paused';
  f.service.control(f.job, { action: 'modify', request: 'new request', version: 1 });
  assert.deepEqual(f.job.acceptance[0].contains, ['old']); assert.equal(f.job.version, 2);
  const acceptance = [{ path: 'next.md', contains: ['new'] }];
  f.service.control(f.job, { action: 'modify', request: 'next request', version: 2, acceptance });
  acceptance[0].contains.push('untrusted mutation');
  assert.deepEqual(f.job.acceptance[0].contains, ['new']); assert.equal(f.job.version, 3);
  assert.throws(() => f.service.control(f.job, { action: 'modify', request: 'stale', version: 2, acceptance: [] }));
});

test('invalid, excessive and unrecognized acceptance fields are rejected', () => {
  for (const input of [null, {}, Array(9).fill({ path: 'x' }), [{ path: '' }], [{ path: 'x', contains: [''] }], [{ path: 'x', sha256: 'fake' }], [{ path: 'x', execute: 'not allowed' }]]) assert.throws(() => normalizeAcceptance(input));
});
