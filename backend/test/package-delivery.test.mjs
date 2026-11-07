import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import http from 'node:http';
import { packageSettings, gatewayEnvironment } from '../../desktop/launcher/package-settings.mjs';
import { startStaticRenderer } from '../../desktop/launcher/static-renderer.mjs';
import { startManagedProcess, withinTime } from '../../runtime/worker-process.mjs';
import { workerEnvironment } from '../../runtime/worker-environment.mjs';
import { copyTree } from '../../scripts/package-payload.mjs';
function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-package-')); t.after(() => { if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('lingbo-package-')) fs.rmSync(root, { recursive: true, force: true }); }); return root; }
test('package layout and ports are explicit and never require a historical migration source', () => {
  const settings = packageSettings(path.resolve('resources'), { LOCALAPPDATA: path.resolve('isolated-user'), LINGBO_GATEWAY_PORT: '39850', LINGBO_RENDERER_PORT: '39851' });
  assert.equal(settings.gatewayOrigin, 'http://127.0.0.1:39850'); assert.equal(settings.rendererOrigin, 'http://localhost:39851');
  assert.match(settings.entry, /service[\\/]backend[\\/]server.mjs$/); assert.match(settings.envFile, /\.local[\\/]\.env$/);
  for (const port of ['0', '80', '65536', 'text']) assert.throws(() => packageSettings('resources', { LOCALAPPDATA: 'local', LINGBO_GATEWAY_PORT: port }));
  assert.throws(() => packageSettings('resources', { LOCALAPPDATA: 'local', LINGBO_GATEWAY_PORT: '5173' }));
  const isolated = packageSettings('resources', { LOCALAPPDATA: 'local' }, { testRelease: true });
  assert.match(isolated.workspace, /LingboDesk-Test$/); assert.equal(isolated.gatewayPort, 39850); assert.equal(isolated.rendererPort, 39851);
  const override = packageSettings('resources', { LOCALAPPDATA: 'local', VOICE_AGENT_WORKSPACE: 'explicit-fixture' }, { testRelease: true });
  assert.equal(override.workspace, path.resolve('explicit-fixture'));
});
test('gateway alone receives explicitly selected credentials while hooks and unrelated environment are excluded', () => {
  const settings = packageSettings('resources', { LOCALAPPDATA: 'local' });
  const env = gatewayEnvironment(settings, workerEnvironment({}, { PATH: 'os-path', NODE_OPTIONS: '--require=bad' }), { DEEPSEEK_API_KEY: 'synthetic-gateway-key', PRIVATE_SECRET: 'not-copied', NODE_OPTIONS: '--require=bad' });
  assert.equal(env.DEEPSEEK_API_KEY, 'synthetic-gateway-key'); assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.PRIVATE_SECRET, undefined);
  assert.equal(env.VOICE_AGENT_WORKSPACE, settings.workspace); assert.equal(env.LINGBO_RENDERER_ORIGIN, settings.rendererOrigin);
  assert.equal(workerEnvironment({}, env).DEEPSEEK_API_KEY, undefined);
});
test('static packaged runtime config contains only loopback origin and initializes the mic only when unset', async t => {
  const root = temporary(t); fs.writeFileSync(path.join(root, 'index.html'), '<html><head></head><body>fixture</body></html>');
  const server = await startStaticRenderer(root, 0, { runtime: { gatewayOrigin: 'http://127.0.0.1:39850', token: 'must-never-be-injected' } });
  try { const text = await fetch('http://127.0.0.1:' + server.address().port).then(r => r.text()); assert.match(text, /__lingboRuntime/); assert.match(text, /39850/); assert.doesNotMatch(text, /must-never-be-injected/); assert.match(text, /getItem\('settings\/audio\/input\/off'\)===null/); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await assert.rejects(startStaticRenderer(root, 0, { runtime: { gatewayOrigin: 'https://example.com' } }));
});
test('source payload copy excludes credentials, private data, tests and dependency caches', t => {
  const root = temporary(t), input = path.join(root, 'input'), output = path.join(root, 'output'); fs.mkdirSync(input);
  for (const name of ['.env', '.env.example', 'credentials.dpapi', 'private.key', 'runtime.sqlite', 'test-fixture.mjs', 'server.mjs']) fs.writeFileSync(path.join(input, name), 'fixture');
  for (const name of ['.local', 'node_modules', '__pycache__', 'test']) { fs.mkdirSync(path.join(input, name)); fs.writeFileSync(path.join(input, name, 'data'), 'private'); }
  copyTree(input, output); assert.deepEqual(fs.readdirSync(output), ['server.mjs']);
});
test('managed gateway process accepts trusted shutdown IPC and is reaped before the launcher continues', async t => {
  const root = temporary(t), file = fileURLToPath(new URL('../test-support/lifecycle-worker.mjs', import.meta.url));
  const process = startManagedProcess(globalThis.process.execPath, [file], { diagnosticsDirectory: root, env: workerEnvironment(), shutdownMs: 500 });
  try { await withinTime(once(process.child, 'message'), 3000); const result = await process.stop(); assert.equal(result.code, 0); assert.equal(process.closed, true); assert.equal(process.send('shutdown'), false); }
  finally { await process.stop(); }
});
test('renderer bootstrap proxy works at the same origin and rejects cross-site access', async t => {
  const root = temporary(t), token = '1'.repeat(64);
  const gateway = http.createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ token, baseURL: 'http://127.0.0.1:' + gateway.address().port + '/v1/' })); });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const server = await startStaticRenderer(root, 0, { runtime: { gatewayOrigin: 'http://127.0.0.1:' + gateway.address().port } });
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await fetch(origin + '/local-gateway-bootstrap'); assert.equal(response.status, 200); assert.equal((await response.json()).token, token);
    assert.equal((await fetch(origin + '/local-gateway-bootstrap', { headers: { Origin: 'https://example.com', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  } finally { server.closeAllConnections(); gateway.closeAllConnections(); await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => gateway.close(resolve))]); }
});
