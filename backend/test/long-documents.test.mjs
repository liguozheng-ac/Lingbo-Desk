import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { documentEnvironment } from '../../runtime/worker-environment.mjs';
import { WorkPolicy, hashFile } from '../work-policy.mjs';
import { WorkTools } from '../work-tools.mjs';
import { verifyAcceptance } from '../work-acceptance.mjs';
const execute = promisify(execFile);
const python = process.env.VOICE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
for (const [name, description] of [
  ['long-window', 'long DOCX reads reach the tail while report extraction retains its context limit'],
  ['format-edit', 'a long DOCX punctuation edit preserves styles, tables, images, headers and other ZIP parts'],
  ['tab-boundary', 'exact DOCX edits cannot collapse a visible tab boundary'],
  ['textbox-target', 'unsupported nested textbox edits reject the whole operation without partial output'],
  ['field-target', 'dynamic field results cannot be silently overwritten'],
]) test(description, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-long-docx-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('lingbo-long-docx-')); fs.rmSync(root, { recursive: true, force: true }); });
  const { stdout } = await execute(python, [fileURLToPath(new URL('../test-support/long-documents.py', import.meta.url)), name, root], { windowsHide: true, timeout: 30000, env: documentEnvironment() });
  assert.equal(JSON.parse(stdout).passed, true);
});

test('real work tools read and edit a long DOCX tail, back up the original and verify the full declared body', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-long-docx-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('lingbo-long-docx-')); fs.rmSync(root, { recursive: true, force: true }); });
  const input = path.join(root, 'input'), local = path.join(root, 'local'), output = path.join(root, 'output'); fs.mkdirSync(input); fs.mkdirSync(output);
  const { stdout } = await execute(python, [fileURLToPath(new URL('../test-support/long-documents.py', import.meta.url)), 'make-long', input], { windowsHide: true, timeout: 30000, env: documentEnvironment() });
  const fixture = JSON.parse(stdout), policy = new WorkPolicy(local);
  const granted = policy.update({ action: 'grant', directory: input, mode: 'write', revision: 0 });
  const tools = new WorkTools({ policy }), job = { id: 'synthetic-document', output, rootIds: granted.roots.map(r => r.id), modelProfile: 'deepseek', controller: new AbortController(), version: 1, receipts: [], acceptance: [{ path: fixture.file, contains: ['已改，'], notContains: ['待改,'] }] };
  const read = (await tools.execute(job, 'work_read', { path: fixture.file, offset: fixture.offset, limit: 40 }, () => {}, () => {})).value;
  assert.equal(read.totalCharacters, fixture.characters); assert.ok(read.content.startsWith('待改,')); assert.ok(read.content.length <= 40); assert.equal(job.readCharacters, read.content.length);
  const before = hashFile(fixture.file); let confirmation = false;
  const edited = await tools.execute(job, 'work_edit', { path: fixture.file, expected_sha256: read.sha256, old_text: '待改,', new_text: '已改，' }, async preview => { confirmation = true; assert.equal(preview.detail.replacements, 1); }, () => {});
  assert.equal(confirmation, true); assert.equal(hashFile(edited.value.backup), before);
  job.receipts.push({ ...edited.evidence, id: 'synthetic-edit-receipt', version: 1, ok: true, tool: 'work_edit' });
  const checked = await verifyAcceptance(job, tools); assert.equal(checked.scope, 'declared_outputs'); assert.equal(checked.checks[0].contentChecked, true);
  const full = await tools.acceptanceText(job, fixture.file); assert.ok(full.length > 100000); assert.ok(full.includes('已改，'));
  job.modelProfile = 'ollama'; job.readCharacters = 12000;
  await assert.rejects(tools.execute(job, 'work_read', { path: fixture.file, offset: fixture.offset, limit: 1 }, () => {}, () => {}), /上下文达到上限/);
});
