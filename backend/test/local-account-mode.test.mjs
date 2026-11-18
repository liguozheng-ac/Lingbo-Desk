import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../desktop/packages/stage-ui/src/stores/auth.ts', import.meta.url), 'utf8');
function method(name) {
  const start = source.indexOf(`async function ${name}(`);
  const opening = source.indexOf('{', start);
  let depth = 1, end = opening + 1;
  while (depth && end < source.length) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
  return source.slice(start, end).replace(/: Promise<[^>]+>/g, '').replace('expectedVersion: number', 'expectedVersion');
}
function store(enabled) {
  const context = vm.createContext({ accountLoginEnabled: enabled, needsLogin: { value: false }, isAuthenticated: { value: false }, sessionVersion: { value: 3 }, signingOut: false, clears: 0 });
  vm.runInContext(`function clearAuthState(){clears++;isAuthenticated.value=false;} ${['requestLogin', 'consumeLoginRequest', 'expireSession'].map(method).join('\n')}`, context);
  return context;
}
test('local desktop rejects repeated login requests and consumes stale requests without retry', async () => {
  const s = store(false);
  for (let i = 0; i < 500; i++) { await s.requestLogin(); assert.equal(s.needsLogin.value, false); s.needsLogin.value = true; assert.equal(await s.consumeLoginRequest(), false); assert.equal(s.needsLogin.value, false); }
});
test('session expiry still clears credentials but local mode does not request login', async () => {
  const s = store(false); await s.expireSession(2); assert.equal(s.clears, 0); await s.expireSession(3); assert.equal(s.clears, 1); assert.equal(s.sessionVersion.value, 4); assert.equal(s.needsLogin.value, false);
});
test('configured account mode retains single-consumer login and version checks', async () => {
  const s = store(true); await s.requestLogin(); assert.equal(await s.consumeLoginRequest(), true); assert.equal(await s.consumeLoginRequest(), false); await s.expireSession(3); assert.equal(s.needsLogin.value, true); s.isAuthenticated.value = true; assert.equal(await s.consumeLoginRequest(), false);
});
