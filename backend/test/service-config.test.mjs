import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { ServiceConfig } from '../service-config.mjs';
import { windowsCrypt } from '../windows-secret-store.mjs';
import { credentials } from '../credentials.mjs';
import { probeSpeech } from '../service-probe.mjs';
import { decodeAudio } from '../audio-decoder.mjs';
import { workerEnvironment } from '../../runtime/worker-environment.mjs';
import { startManagedProcess } from '../../runtime/worker-process.mjs';

const empty = () => ({ deepseekKey: '', speech: { asr: {}, tts: { provider: 'doubao', keys: {} } } });
function directory(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-services-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
// Mock codec exercises transactional validation only; the Windows test below uses actual DPAPI.
const codec = async (_action, bytes) => Buffer.from(bytes);

test('configuration preserves blanks, explicitly disables legacy fallback, and rejects stale or unknown changes', async t => {
  const config = new ServiceConfig(directory(t), { ...empty(), deepseekKey: 'legacy-only-for-test' }, codec);
  await config.save({ revision: 0, values: { asrKey: 'synthetic-asr-only' } });
  await config.save({ revision: 1, values: { deepseekKey: '' }, clear: ['deepseekKey'] });
  assert.equal(config.current().deepseekKey, ''); assert.equal(config.current().speech.asr.aliyunApiKey, 'synthetic-asr-only');
  assert.equal(config.snapshot().services.deepseekKey.source, 'disabled');
  for (const change of [{ revision: 1 }, { revision: 2, values: { token: 'invalid' } }, { revision: 2, values: { asrKey: 'bad key' } }]) await assert.rejects(config.save(change));
  assert.equal(config.state.revision, 2);
  assert.doesNotMatch(JSON.stringify(config.snapshot()), /synthetic-asr-only|legacy-only-for-test/);
});

test('failed encryption and corrupt ciphertext preserve original file without plaintext fallback', async t => {
  const config = new ServiceConfig(directory(t), empty(), codec);
  await config.save({ revision: 0, values: { deepseekKey: 'synthetic-dpapi-only' } });
  const before = fs.readFileSync(config.file);
  config.crypt = async () => { throw new Error('controlled failure'); };
  await assert.rejects(config.save({ revision: 1, clear: ['deepseekKey'] }));
  assert.deepEqual(fs.readFileSync(config.file), before);
  const corrupt = new ServiceConfig(path.dirname(config.file), { ...empty(), deepseekKey: 'legacy-only-for-test' }, config.crypt);
  await corrupt.load(); assert.ok(corrupt.warning); assert.equal(corrupt.current().deepseekKey, '');
  await assert.rejects(corrupt.save({ revision: 0 })); assert.deepEqual(fs.readFileSync(config.file), before);
});

test('actual CurrentUser DPAPI round trip keeps credentials out of the ciphertext and status', { skip: process.platform !== 'win32' }, async t => {
  const root = directory(t), secret = 'synthetic-windows-service-key-only';
  const config = new ServiceConfig(root, empty());
  await config.save({ revision: 0, values: { deepseekKey: secret } });
  assert.equal(fs.readFileSync(config.file).includes(Buffer.from(secret)), false);
  const restored = new ServiceConfig(root, empty()); await restored.load();
  assert.equal(restored.current().deepseekKey, secret); assert.doesNotMatch(JSON.stringify(restored.snapshot()), /synthetic-windows/);
  await assert.rejects(windowsCrypt('unprotect', Buffer.from('invalid ciphertext')), /安全存储/);
});

test('missing cloud key no longer prevents gateway credential initialization', () => {
  const previous = { key: process.env.DEEPSEEK_API_KEY, speech: process.env.LINGBO_SPEECH_CONFIG };
  try { delete process.env.DEEPSEEK_API_KEY; delete process.env.LINGBO_SPEECH_CONFIG; assert.equal(credentials().deepseekKey, ''); }
  finally { for (const [name, value] of [['DEEPSEEK_API_KEY', previous.key], ['LINGBO_SPEECH_CONFIG', previous.speech]]) if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});

test('speech connection check distinguishes a session handshake from transcription and handles abort', async () => {
  let closed = 0;
  const createSession = (_config, _text, _error, _close, event) => { queueMicrotask(() => event('task-started')); return { close() { closed++; } }; };
  const result = await probeSpeech('asr', { asr: { aliyunApiKey: 'synthetic-asr-only' } }, { createSession, signal: new AbortController().signal });
  assert.match(result.scope, /未验证识别准确率/); assert.equal(closed, 1);
  await assert.rejects(probeSpeech('asr', { asr: {} }, { createSession, signal: new AbortController().signal }), /先保存/);
  await assert.rejects(probeSpeech('asr', { asr: { aliyunApiKey: 'synthetic-asr-only' } }, { createSession, signal: AbortSignal.abort() }), /取消或超时/);
});

test('audio decoder isolates its environment and replaces raw stderr with an actionable error', async () => {
  const previous = process.env.DEEPSEEK_API_KEY; process.env.DEEPSEEK_API_KEY = 'synthetic-never-inherit-to-decoder';
  try {
    await assert.rejects(decodeAudio('python', 'decoder.py', 'input', 'output', new AbortController().signal, async (_file, _args, options) => {
      assert.equal(options.env.DEEPSEEK_API_KEY, undefined);
      throw Object.assign(new Error('raw private traceback'), { stderr: "ModuleNotFoundError: No module named 'av'" });
    }), error => error.code === 'AUDIO_DECODER_UNAVAILABLE' && !error.message.includes('raw private'));
  } finally { if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous; }
});

test('credential-free gateway supports local selection, auth guards, live encrypted updates and update exclusion', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-services-')), local = path.join(root, '.local');
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const managed = startManagedProcess(process.execPath, [fileURLToPath(new URL('../test-support/config-gateway.mjs', import.meta.url))], { cwd: root, diagnosticsDirectory: path.join(root, 'diagnostics'), env: { ...workerEnvironment(), VOICE_AGENT_WORKSPACE: root, LINGBO_GATEWAY_PORT: String(port) } });
  t.after(async () => { await managed.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  const origin = 'http://127.0.0.1:' + port;
  let ready = false;
  for (let i = 0; i < 150; i++) { if (managed.closed) throw new Error('Fixture gateway exited'); try { ready = (await fetch(origin + '/bootstrap')).ok; } catch {} if (ready) break; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(ready);
  const token = fs.readFileSync(path.join(local, 'gateway-token'), 'utf8').trim();
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const post = (route, value, extra = {}) => fetch(origin + route, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(value) });
  assert.equal((await fetch(origin + '/settings/services')).status, 401);
  assert.equal((await post('/settings/services', { revision: 0 }, { Origin: 'http://localhost:5173' })).status, 403);
  const malformed = await fetch(origin + '/settings/services', { method: 'POST', headers, body: '{"deepseekKey":"synthetic-private-malformed' });
  assert.equal(malformed.status, 400); assert.doesNotMatch(await malformed.text(), /synthetic-private-malformed/);
  let state = await fetch(origin + '/status', { headers }).then(r => r.json()); assert.equal(state.llm, false); assert.equal(state.tts, false); assert.equal(state.configurationRequired, true);
  assert.equal((await post('/personal/model/select', { id: 'ollama', revision: 0 })).status, 200);
  state = await fetch(origin + '/status', { headers }).then(r => r.json()); assert.equal(state.llm, true); assert.equal(state.configurationRequired, false);
  const saved = await post('/settings/services', { revision: 0, values: { deepseekKey: 'synthetic-config-api-key-only' } }); assert.equal(saved.status, 200);
  assert.equal((await saved.json()).services.deepseekKey.source, 'encrypted');
  const pending = post('/settings/services/probe', { id: 'deepseek' }); await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal((await post('/settings/services', { revision: 1, clear: ['deepseekKey'] })).status, 409);
  assert.equal((await pending).status, 200);
  const response = await fetch(origin + '/settings/services', { headers }); assert.doesNotMatch(await response.text(), /synthetic-config-api-key-only/);
  assert.equal(fs.readFileSync(path.join(local, 'services.dpapi')).includes(Buffer.from('synthetic-config-api-key-only')), false);
});
