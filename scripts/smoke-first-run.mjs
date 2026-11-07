import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { workerEnvironment } from '../runtime/worker-environment.mjs';
import { withinTime } from '../runtime/worker-process.mjs';
import { packageModelFixture } from '../backend/test-support/package-model.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))), candidate = path.resolve(process.argv[2] || '');
assert.ok(process.argv[2]);
assert.equal(JSON.parse(fs.readFileSync(path.join(candidate, 'resources/package-manifest.json'))).version, '0.3.4-test');
const workspace = fs.mkdtempSync(path.join(root, 'artifacts/first-run-')), local = path.join(workspace, '.local'), origin = 'http://127.0.0.1:39850';
const result = { passed: false, candidate, workspace, scope: 'Packaged first boot without provider keys; synthetic saved key and local model fixture only', checks: [] };
const save = () => fs.writeFileSync(path.join(workspace, 'first-run-result.json'), JSON.stringify(result, null, 2));
let app, exited, fixture, headers;
async function api(route, body) { const r = await fetch(origin + route, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000) }); const value = await r.json(); assert.equal(r.status, 200); return value; }
const wait = async predicate => { for (let i = 0; i < 150; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw new Error('First-run check timed out'); };
try {
  fixture = await packageModelFixture();
  app = spawn(path.join(candidate, 'LingboDesk.exe'), [], { cwd: candidate, windowsHide: !process.argv.includes('--ui-hold'), stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...workerEnvironment(), VOICE_AGENT_WORKSPACE: workspace } }); exited = once(app, 'close');
  await wait(async () => { if (app.exitCode !== null) throw new Error('App exited during credential-free startup'); try { return fs.existsSync(path.join(local, 'gateway-token')) && (await fetch(origin + '/bootstrap')).ok; } catch { return false; } });
  headers = { Authorization: 'Bearer ' + fs.readFileSync(path.join(local, 'gateway-token'), 'utf8').trim(), 'Content-Type': 'application/json' };
  const status = await api('/status'); assert.equal(status.configurationRequired, true); assert.equal(status.llm, false); assert.equal(status.asr, false); assert.equal(status.tts, false); assert.equal(fs.existsSync(path.join(local, '.env')), false);
  result.checks.push('credential-free native app and configuration API startup');
  const html = await fetch(origin).then(r => r.text()); assert.match(html, /services-form/); assert.match(html, /type="password"/);
  const config = await api('/settings/services'); assert.equal(config.canSave, true); assert.equal(config.revision, 0);
  await wait(async () => (await api('/status')).lingboConnected === true);
  result.checks.push('configuration form and real character bridge available'); save(); console.log('FIRST_RUN_UI_READY');
  if (process.argv.includes('--ui-hold')) await new Promise(resolve => setTimeout(resolve, 60000));
  const selected = await api('/personal/model/select', { id: 'ollama', revision: 0 }); assert.equal(selected.selected, 'ollama'); assert.equal((await api('/status')).configurationRequired, false);
  result.checks.push('local model selected without any DeepSeek credential');
  await api('/settings/services', { revision: 0, values: { asrKey: 'synthetic-first-run-key-only' } });
  assert.equal(fs.readFileSync(path.join(local, 'services.dpapi')).includes(Buffer.from('synthetic-first-run-key-only')), false);
  assert.equal((await api('/settings/services')).services.asrKey.source, 'encrypted');
  result.checks.push('UI configuration API encrypts and applies a new credential');
  app.send({ command: 'shutdown' }); const [code] = await withinTime(exited, 35000); assert.equal(code, 0);
  result.checks.push('credential-free first-run app exits cleanly'); result.passed = true;
} catch (error) { result.error = error.message; process.exitCode = 1; }
finally { if (app && app.exitCode === null) { try { app.send({ command: 'shutdown' }); await withinTime(exited, 35000); } catch { app.kill(); } } await fixture?.close(); save(); console.log(JSON.stringify(result, null, 2)); }
