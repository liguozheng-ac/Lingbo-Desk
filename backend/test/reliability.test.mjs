import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { loadSettings, saveSettings } from '../settings.mjs';
import { request } from '../client-api.mjs';
import { SourceBundles } from '../source-bundles.mjs';

test('language survives reload and invalid settings are recoverable', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-settings-'));
  const file = path.join(directory, 'settings.json');
  assert.equal(loadSettings(file).value.language, 'auto');
  saveSettings(file, { language: 'auto' });
  assert.equal(loadSettings(file).value.language, 'auto');
  saveSettings(file, { language: 'ja' });
  assert.equal(loadSettings(file).value.language, 'ja');
  assert.throws(() => saveSettings(file, { language: 'invalid' }));
  assert.equal(loadSettings(file).value.language, 'ja');
  fs.writeFileSync(file, '{broken');
  assert.ok(loadSettings(file).warning);
  assert.equal(loadSettings(file).value.language, 'auto');
  saveSettings(file, { language: 'en' });
  assert.equal(loadSettings(file).warning, undefined);
  fs.unlinkSync(file); fs.rmdirSync(directory);
});

test('HTTP timeout and credential errors are readable and POST is never replayed', async () => {
  let posts = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') posts++;
    if (req.url === '/slow') return;
    res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(request(origin + '/slow', { timeout: 50 }), /超时/);
    await assert.rejects(request(origin + '/denied', { data: { action: 'create' } }), /凭据已失效/);
    assert.equal(posts, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('source import rejects traversal, unsupported and excessive selections', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-sources-'));
  const bundles = new SourceBundles(directory);
  const file = new File(['content'], 'source.txt');
  await assert.rejects(bundles.import([file], ['../escape.txt']), /名称无效/);
  await assert.rejects(bundles.import([new File(['x'], 'run.exe')], []), /格式/);
  await assert.rejects(bundles.import(Array(21).fill(file), []), /20/);
  assert.throws(() => bundles.get('../outside'), /编号/);
  for (const name of fs.readdirSync(directory)) fs.rmdirSync(path.join(directory, name));
  fs.rmdirSync(directory);
});
