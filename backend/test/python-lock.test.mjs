import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPythonLock, verifyPythonPackages } from '../../scripts/python-lock.mjs';

test('Python lock rejects unhashed, duplicate and stale direct requirements', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-wheel-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lock = path.join(root, 'requirements.lock'), direct = path.join(root, 'requirements.txt');
  fs.writeFileSync(direct, 'example==1.0\n');
  const valid = 'example==1.0 --hash=sha256:' + 'a'.repeat(64) + '\n';
  for (const invalid of ['example==1.0\n', valid + valid, valid.replace('==1.0', '==2.0')]) {
    fs.writeFileSync(lock, invalid); assert.throws(() => readPythonLock(lock, direct));
  }
});

test('Python distribution audit rejects missing, extra and changed installed packages', () => {
  const expected = { 'typing-extensions': '4.16.0' };
  assert.doesNotThrow(() => verifyPythonPackages(expected, { typing_extensions: '4.16.0' }));
  for (const actual of [{}, { typing_extensions: '4.15.0' }, { typing_extensions: '4.16.0', unexpected: '1.0' }]) assert.throws(() => verifyPythonPackages(expected, actual));
});
