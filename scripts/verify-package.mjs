import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileHash } from './package-payload.mjs';
import { readPythonLock, verifyPythonPackages } from './python-lock.mjs';
const candidate = path.resolve(process.argv[2] || ''), resources = path.join(candidate, 'resources');
assert.ok(process.argv[2], 'Provide the candidate directory');
const manifest = JSON.parse(fs.readFileSync(path.join(resources, 'package-manifest.json'), 'utf8'));
assert.equal(manifest.format, 1);
for (const relative of ['LingboDesk.exe', 'resources/app.asar', 'resources/node-runtime/node.exe', 'resources/python/python.exe', 'resources/service/backend/server.mjs']) assert.ok(fs.statSync(path.join(candidate, relative)).isFile(), relative);
assert.equal(fs.existsSync(path.join(resources, 'migration-source.json')), false);
for (const [relative, expected] of Object.entries(manifest.sourceFiles)) assert.equal(fileHash(path.join(resources, 'service', relative)), expected, relative);
assert.equal(fileHash(path.join(resources, 'node-runtime/node.exe')), manifest.node.sha256);
assert.equal(fileHash(path.join(resources, 'service/engine/node_modules/better-sqlite3/build/Release/better_sqlite3.node')), manifest.sqlite.sha256);
assert.equal(manifest.python.lockFile, 'python/requirements-windows.lock');
const pythonLock = path.join(resources, manifest.python.lockFile);
assert.equal(fileHash(pythonLock), manifest.python.lockSha256);
const actualPackages = JSON.parse(execFileSync(path.join(resources, 'python/python.exe'), ['-I', '-c', 'import json;from importlib.metadata import distributions;print(json.dumps({d.metadata["Name"]:d.version for d in distributions()}))'], { encoding: 'utf8', windowsHide: true, timeout: 15000 }));
verifyPythonPackages(readPythonLock(pythonLock), actualPackages);
const forbidden = [], secretFiles = [], links = []; let files = 0, bytes = 0, longest = '';
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name), relative = path.relative(candidate, file);
    if (entry.isSymbolicLink()) { links.push(relative); continue; }
    if (entry.isDirectory()) { scan(file); continue; }
    files++; const stat = fs.statSync(file); bytes += stat.size; if (relative.length > longest.length) longest = relative;
    if (/^\.env(?:\.|$)|\.dpapi$|^(?:gateway-token|personal\.json|work-permissions\.json|migration-source\.json|task\.json)$/.test(entry.name)) forbidden.push(relative);
    const handle = fs.openSync(file, 'r'), chunk = Buffer.alloc(4 * 1024 * 1024); let tail = '', offset = 0;
    try {
      for (;;) { const count = fs.readSync(handle, chunk, 0, chunk.length, offset); if (!count) break; offset += count; const text = tail + chunk.subarray(0, count).toString('latin1'); if (/\bsk-[a-f0-9]{32}\b/i.test(text) || text.includes('synthetic-package-fixture-only')) { secretFiles.push(relative); break; } tail = text.slice(-128); }
    } finally { fs.closeSync(handle); }
  }
}
scan(candidate);
const result = { passed: !forbidden.length && !secretFiles.length && !links.length, files, bytes, version: manifest.version, links, forbiddenFiles: forbidden, credentialPatternFiles: secretFiles, longestRelativePathCharacters: longest.length, limitation: 'Checks known credential shapes and file types, not every possible secret; excludes ZIP-internal semantic inspection.' };
fs.writeFileSync(path.join(path.dirname(candidate), 'package-verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); assert.equal(result.passed, true);
