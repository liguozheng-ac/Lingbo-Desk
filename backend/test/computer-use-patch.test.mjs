import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { patchComputerUseRuntime, patchComputerUseTools } from '../computer-use-runtime-patch.mjs';

const file = new URL('../../desktop/apps/stage-tamagotchi/src/main/services/lingbo/computer-use/runtime.ts', import.meta.url);
const original = fs.readFileSync(file, 'utf8');

test('Windows patch keeps launcher authentication and storage while aligning daemon and CLI DPI contexts', () => {
  const patched = patchComputerUseRuntime(original, 'win32');
  assert.equal(patched.match(/__COMPAT_LAYER: 'HIGHDPIAWARE'/g)?.length, 2);
  assert.match(patched, /noRegister: true/);
  assert.match(patched, /--credential-stdin/);
  assert.match(patched, /Only screenshots from this LINGBO computer-use store/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('DPI patch refuses a changed upstream runtime and leaves other platforms unchanged', () => {
  assert.equal(patchComputerUseRuntime(original, 'linux'), original);
  assert.throws(() => patchComputerUseRuntime(original.replace('noRegister: true', 'noRegister: false'), 'win32'), /runtime changed/);
  assert.throws(() => patchComputerUseRuntime(patchComputerUseRuntime(original, 'win32'), 'win32'), /runtime changed/);
});

test('Windows tool guidance adds positional CLI and separate-dialog observations without changing the executor', () => {
  const toolsFile = new URL('../../desktop/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/computer-use.ts', import.meta.url);
  const before = fs.readFileSync(toolsFile, 'utf8');
  const after = patchComputerUseTools(before, 'win32');
  assert.match(after, /window.list/);
  assert.match(after, /foreground-preferred/);
  assert.equal(after.slice(after.indexOf('      execute:')), before.slice(before.indexOf('      execute:')));
  assert.equal(patchComputerUseTools(before, 'linux'), before);
  assert.equal(fs.readFileSync(toolsFile, 'utf8'), before);
});
