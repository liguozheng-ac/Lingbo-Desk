import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { WorkPolicy, hashFile, realTarget } from '../work-policy.mjs';
import { WorkTools } from '../work-tools.mjs';
import { WorkService } from '../work-service.mjs';
import { PersonalStore } from '../personal-store.mjs';
import { PersonalSkills } from '../personal-skills.mjs';
import { python } from '../source-bundles.mjs';
import { runVerifiedWork } from '../work-finalize.mjs';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hiyori-work-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, 'local'), input = path.join(root, 'input'), output = path.join(local, 'work', 'output'); fs.mkdirSync(input); fs.mkdirSync(output, { recursive: true });
  const policy = new WorkPolicy(local), personal = new PersonalStore(local), skills = new PersonalSkills(path.join(local, 'skills'), personal);
  const grant = policy.update({ action: 'grant', directory: input, mode: 'write', revision: 0 });
  const job = { id: 'fixture', output, rootIds: grant.roots.map(r => r.id), skillVersions: [], controller: new AbortController() };
  const tools = new WorkTools({ policy, personal, skills });
  return { root, local, input, output, policy, personal, skills, job, tools };
}
test('folder scopes reject traversal, links, protected areas, stale grants and disk roots', t => {
  const { root, local, input, output, policy, job } = fixture(t);
  assert.equal(policy.resolve(job, 'new.md', true), path.join(output, 'new.md'));
  assert.throws(() => policy.resolve(job, path.join(root, 'outside.md')), /未授权/);
  assert.throws(() => policy.resolve(job, path.join(local, 'personal.json')), /禁止/);
  assert.throws(() => policy.update({ action: 'grant', directory: path.parse(root).root, mode: 'write', revision: 1 }));
  const link = path.join(input, 'linked'); fs.symlinkSync(output, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => policy.resolve(job, path.join(link, 'escape.txt')), /链接|联接/);
  policy.update({ action: 'revoke', id: job.rootIds[0], revision: 1 });
  assert.throws(() => policy.resolve(job, input), /未授权/);
});
test('Windows AppData virtualization is not mistaken for a junction, while physical protected aliases stay blocked', t => {
  const { root, output } = fixture(t), original = fs.realpathSync.native;
  const virtualized = path.join(root, 'virtualized'); fs.mkdirSync(virtualized);
  fs.realpathSync.native = value => String(value) === output ? virtualized : original(value);
  try {
    assert.equal(realTarget(path.join(output, 'new.md')), path.join(output, 'new.md'));
    const policy = new WorkPolicy(path.join(root, 'other-local'), { protectedPaths: [output] });
    assert.throws(() => policy.update({ action: 'grant', directory: virtualized, mode: 'read', revision: 0 }), /不能授权/);
  } finally { fs.realpathSync.native = original; }
});
test('original edits require concrete approval, detect concurrent changes, and keep verified backups', async t => {
  const { input, job, tools } = fixture(t); const file = path.join(input, 'notes.txt'); fs.writeFileSync(file, '第一行,第二行.\r\n保持原样。');
  const original = hashFile(file), intents = []; let preview;
  const args = { path: file, old_text: ',', new_text: '，', expected_sha256: original };
  await assert.rejects(tools.execute(job, 'work_edit', args, async p => { preview = p; throw new Error('拒绝'); }, i => intents.push(i)), /拒绝/);
  assert.equal(hashFile(file), original); assert.equal(intents.length, 0); assert.equal(preview.oldText, ',');
  await assert.rejects(tools.execute(job, 'work_edit', args, async () => fs.appendFileSync(file, '并发修改'), i => intents.push(i)), /变化/);
  fs.writeFileSync(file, '第一行,第二行.\r\n保持原样。');
  const result = await tools.execute(job, 'work_edit', args, async () => {}, i => intents.push(i));
  assert.equal(fs.readFileSync(file, 'utf8'), '第一行，第二行.\r\n保持原样。');
  assert.equal(hashFile(result.value.backup), original); assert.equal(result.value.sha256, hashFile(file));
});
test('new writes never clobber and deletion keeps a recoverable single-file copy', async t => {
  const { input, job, tools } = fixture(t), file = path.join(input, 'new.txt');
  await tools.execute(job, 'work_write', { path: file, content: 'original' }, () => assert.fail(), () => {});
  await assert.rejects(tools.execute(job, 'work_write', { path: file, content: 'overwrite' }, () => assert.fail(), () => {}), /SHA256/);
  const result = await tools.execute(job, 'work_delete', { path: file, expected_sha256: hashFile(file) }, async () => {}, () => {});
  assert.equal(fs.existsSync(file), false); assert.equal(fs.readFileSync(result.value.backup, 'utf8'), 'original');
  await assert.rejects(tools.execute(job, 'work_delete', { path: input }, async () => {}, () => {}), /单个文件/);
});
test('DOCX exact replacement preserves paragraph/run/table structure and every other ZIP part', async t => {
  const { input, job, tools } = fixture(t), file = path.join(input, 'fixture.docx');
  execFileSync(python, ['-c', "from docx import Document; import sys; d=Document(); p=d.add_paragraph(); p.add_run('第一行,').bold=True; p.add_run('第二行.'); d.add_table(rows=1,cols=1).cell(0,0).text='表格不动'; d.save(sys.argv[1])", file]);
  const backup = fs.readFileSync(file);
  const result = await tools.execute(job, 'work_edit', { path: file, old_text: ',第二行.', new_text: '，第二行。', expected_sha256: hashFile(file) }, async () => {}, () => {});
  assert.equal(result.value.replacements, 1); assert.equal(result.value.structureUnchanged, true); assert.deepEqual(fs.readFileSync(result.value.backup), backup);
  const verification = execFileSync(python, ['-c', "from zipfile import ZipFile; from docx import Document; import sys; a,b=map(ZipFile,sys.argv[1:]); assert a.namelist()==b.namelist(); assert all(a.read(n)==b.read(n) for n in a.namelist() if n!='word/document.xml'); d=Document(sys.argv[2]); assert len(d.paragraphs)==1; assert d.paragraphs[0].text=='第一行，第二行。'; assert d.paragraphs[0].runs[0].bold; assert d.tables[0].cell(0,0).text=='表格不动'; print('verified')", result.value.backup, file], { encoding: 'utf8' });
  assert.match(verification, /verified/);
});
test('Office creation and spreadsheet edits return real files, hashes and bounded reads', async t => {
  const { job, tools } = fixture(t);
  for (const [operation, file, args] of [
    ['create_docx', 'result.docx', { content: '# 测试报告\n\n这是测试内容。' }],
    ['create_xlsx', 'result.xlsx', { data: JSON.stringify({ sheets: [{ name: '数据', rows: [['项目', '数量'], ['语音', 5]] }] }) }],
    ['create_pptx', 'result.pptx', { data: JSON.stringify({ slides: [{ title: '测试方案', body: '这是测试内容。' }] }) }],
  ]) {
    const result = await tools.execute(job, 'work_office', { operation, path: file, ...args }, () => assert.fail(), () => {});
    assert.equal(hashFile(result.value.path), result.value.sha256);
    const read = await tools.execute(job, 'work_read', { path: file }, () => assert.fail(), () => {}); assert.equal(read.value.sha256, result.value.sha256);
  }
  const result = await tools.execute(job, 'work_office', { operation: 'edit_xlsx', path: 'result.xlsx', expected_sha256: hashFile(path.join(job.output, 'result.xlsx')), data: JSON.stringify({ sheet: '数据', cells: { B2: 10 } }) }, async () => {}, () => {});
  assert.ok(fs.existsSync(result.value.backup));
  const read = await tools.execute(job, 'work_read', { path: 'result.xlsx' }, () => assert.fail(), () => {}); assert.equal(read.value.sheets[0].rows[1][1], 10);
});
test('skill resource edits revoke version approval and a selected script runs only after source review', async t => {
  const { job, tools, skills, personal } = fixture(t);
  const raw = '---\nname: 测试技能\ndescription: 测试资源\nscope: work\n---\n执行 scripts/test.py';
  skills.install({ id: 'fixture', raw, files: [{ name: 'scripts/test.py', content: "from pathlib import Path\nPath('script-result.txt').write_text('ok')\nprint('done')" }] });
  let skill = skills.list()[0]; skills.toggle({ id: skill.id, enabled: true, sha256: skill.sha256 }); job.skillVersions = skills.context(['fixture'], 'work').versions;
  let reviewed = false;
  const result = await tools.execute(job, 'work_skill', { skill: 'fixture', action: 'run', file: 'scripts/test.py', args: [] }, async preview => { assert.match(preview.source, /script-result/); assert.match(preview.warning, /没有.*沙箱/); reviewed = true; }, () => {});
  assert.equal(reviewed, true); assert.match(result.value.stdout, /done/); assert.equal(fs.readFileSync(path.join(job.output, 'script-result.txt'), 'utf8'), 'ok');
  await assert.rejects(tools.execute(job, 'work_skill', { skill: 'fixture', action: 'run', file: 'scripts/test.py', args: [] }, async () => { skills.toggle({ id: skill.id, enabled: false, sha256: skill.sha256 }); }, () => assert.fail('revoked script cannot start')), /被禁用/);
  skills.toggle({ id: skill.id, enabled: true, sha256: skill.sha256 });
  fs.appendFileSync(path.join(skills.directory, 'fixture/scripts/test.py'), '\n# edited');
  assert.equal(skills.list()[0].enabled, false);
  await assert.rejects(tools.execute(job, 'work_skill', { skill: 'fixture', action: 'run', file: 'scripts/test.py' }, () => assert.fail(), () => {}), /未被选择|版本/);
  personal.memory({ action: 'add', title: '共享偏好', text: '输出中文' });
  assert.equal((await tools.execute(job, 'work_memory', {}, () => {}, () => {})).value.memories[0].text, '输出中文');
});
test('task ownership, exact action approvals and crash ambiguity survive persistence', async t => {
  const f = fixture(t), directory = path.join(f.local, 'tasks'); fs.mkdirSync(directory);
  const service = new WorkService(directory, f), id = 'work-' + crypto.randomUUID();
  const output = path.join(directory, id, 'output'); fs.mkdirSync(output, { recursive: true });
  const job = { schema: 1, id, key: 'test', sessionId: 'owner', output, rootIds: [], skillVersions: [], request: 'test', status: 'running', version: 2, receipts: [], attempts: 1, controller: new AbortController(), createdAt: new Date().toISOString() }; service.jobs.set(id, job);
  assert.throws(() => service.find('other', id), /当前会话/);
  const pending = service.confirmation(job, { tool: 'work_delete', path: 'fixture' });
  const approval = job.approval;
  await assert.rejects(service.approve(job, { approvalId: approval.id, approved: true, version: 1 }), /失效/);
  await service.approve(job, { approvalId: approval.id, approved: false, version: 2 }); await assert.rejects(pending, /拒绝/);
  await assert.rejects(service.approve(job, { approvalId: approval.id, approved: true, version: 2 }), /失效/);
  job.intent = { tool: 'work_move' }; job.status = 'running'; service.persist(job);
  const restored = new WorkService(directory, f), recovered = restored.find('owner', id);
  assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.uncertain, true);
  assert.throws(() => restored.control(recovered, { action: 'resume' }), /不确定/);
});
test('read ranges bound context and expose truncation instead of silently reading partial documents', async t => {
  const { input, job, tools } = fixture(t), file = path.join(input, 'long.txt'); fs.writeFileSync(file, '甲'.repeat(70000));
  let result = await tools.execute(job, 'work_read', { path: file, offset: 65000, limit: 1000 }, () => {}, () => {});
  assert.equal(result.value.totalCharacters, 70000); assert.equal(result.value.content.length, 1000); assert.equal(result.value.truncated, true); assert.equal(result.value.sha256, hashFile(file));
  job.modelProfile = 'ollama'; job.readCharacters = 12000;
  await assert.rejects(tools.execute(job, 'work_read', { path: file, limit: 1 }, () => {}, () => {}), /上下文达到上限/);
});
test('a read receipt cannot finish an edit request, and model tools cannot approve their own actions', async t => {
  const f = fixture(t), directory = path.join(f.local, 'tasks'); fs.mkdirSync(directory);
  const service = new WorkService(directory, f), id = 'work-' + crypto.randomUUID(), output = path.join(directory, id, 'output'); fs.mkdirSync(output, { recursive: true });
  const job = { schema: 1, id, output, sessionId: 'owner', request: '修改文件标点', status: 'running', version: 2, attempts: 2, rootIds: [], receipts: [{ ok: true, tool: 'work_read', attempt: 2 }], controller: new AbortController(), ticket: 'fixture', createdAt: new Date().toISOString() }; service.jobs.set(id, job);
  let response = await service.execute({ taskId: id, ticket: 'fixture', tool: 'work_finish', args: { outcome: 'complete', summary: 'done' } });
  assert.equal(response.ok, false); assert.match(response.error, /没有成功的动作回执/); assert.equal(job.finish, undefined);
  for (const request of ['Replace punctuation in the document', '文書の句読点を置換して']) {
    job.request = request;
    const reply = await service.execute({ taskId: id, ticket: 'fixture', tool: 'work_finish', args: { outcome: 'complete', summary: 'done' } });
    assert.equal(reply.ok, false); assert.match(reply.error, /没有成功的动作回执/);
  }
  response = await service.execute({ taskId: id, ticket: 'fixture', tool: 'approve', args: { approved: true } }); assert.equal(response.ok, false);
  response = await service.execute({ taskId: id, ticket: 'fixture', tool: 'work_finish', args: { outcome: 'needs_input', summary: '需要授权资料目录' } }); assert.equal(response.outcome, 'needs_input');
});
test('missing final receipt gets one verification-only follow-up without replaying side effects', async () => {
  const calls = [];
  await runVerifiedWork(async options => {
    calls.push(options.tools);
    if (calls.length === 1) options.onToolCall('work_write', { path: 'proof.md' }, JSON.stringify({ ok: true, path: 'proof.md', sha256: 'a'.repeat(64) }));
    else { assert.deepEqual(options.tools, ['work_finish']); options.onToolCall('work_finish', {}, JSON.stringify({ ok: true, outcome: 'complete' })); }
    return { content: 'done' };
  }, { message: 'create proof.md', tools: ['work_write', 'work_finish'] });
  assert.equal(calls.length, 2);
  let count = 0;
  await runVerifiedWork(async options => { count++; options.onToolCall('work_finish', {}, JSON.stringify({ ok: true, outcome: 'complete' })); return {}; }, { tools: ['work_finish'] });
  assert.equal(count, 1);
});
test('cancelling an approved Python script stops its process before its pending write', async t => {
  const { job, tools, skills } = fixture(t);
  skills.install({ id: 'cancel-script', raw: '---\nname: 取消测试\ndescription: 只用于合成验收\nscope: work\n---\n运行脚本', files: [{ name: 'scripts/hold.py', content: "import os,time\nfrom pathlib import Path\nPath('running.txt').write_text(str(os.getpid()))\ntime.sleep(10)\nPath('finished.txt').write_text('should not exist')" }] });
  const skill = skills.list()[0]; skills.toggle({ id: skill.id, enabled: true, sha256: skill.sha256 }); job.skillVersions = skills.context([skill.id], 'work').versions;
  const pending = tools.execute(job, 'work_skill', { skill: skill.id, action: 'run', file: 'scripts/hold.py' }, async () => {}, () => {});
  for (let i = 0; i < 100 && !fs.existsSync(path.join(job.output, 'running.txt')); i++) await new Promise(resolve => setTimeout(resolve, 10));
  const pid = Number(fs.readFileSync(path.join(job.output, 'running.txt'), 'utf8'));
  job.controller.abort(); await assert.rejects(pending);
  for (let i = 0; i < 50; i++) { try { process.kill(pid, 0); await new Promise(resolve => setTimeout(resolve, 10)); } catch { break; } }
  assert.throws(() => process.kill(pid, 0)); assert.equal(fs.existsSync(path.join(job.output, 'finished.txt')), false);
});
