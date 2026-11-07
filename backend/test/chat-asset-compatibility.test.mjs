import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatAssetReference, readHistoricalChatAsset } from '../../desktop/packages/stage-ui/src/libs/chat-asset-reference.ts';
const digest = 'a'.repeat(64), prefix = 'current-asset:';
test('historical local references are not mistaken for base64 while new references keep their format', () => {
  assert.deepEqual(parseChatAssetReference(prefix + digest, prefix), { id: digest });
  assert.deepEqual(parseChatAssetReference('previous-asset:' + digest, prefix), { id: digest, legacyNamespace: 'previous' });
  for (const value of ['UklGRg==', 'data:audio/wav;base64,UklGRg==', 'https://example.com/a', '../previous-asset:' + digest, 'previous-asset:not-a-digest', 'previous-asset:' + digest + '/path']) assert.equal(parseChatAssetReference(value, prefix), undefined);
});
test('missing historical databases do not get created and malformed references never reach storage', async () => {
  let opens = 0;
  const factory = { databases: async () => [], open() { opens++; throw Error('Unexpected open'); } };
  assert.equal(await readHistoricalChatAsset(digest, 'previous', factory), null); assert.equal(opens, 0);
  await assert.rejects(readHistoricalChatAsset(digest, '../previous', factory), /Invalid historical/);
  await assert.rejects(readHistoricalChatAsset('not-a-digest', 'previous', factory), /Invalid historical/);
  assert.equal(opens, 0);
});
test('existing historical assets are queried read-only and the database closes after completion', async () => {
  const asset = { blob: new Blob(['synthetic audio']), mimeType: 'audio/wav', owners: ['session'] };
  let closed = 0, transactions = 0;
  const factory = { databases: async () => [{ name: 'previous-chat-assets' }], open(name) {
    assert.equal(name, 'previous-chat-assets'); const request = {};
    queueMicrotask(() => { request.result = { objectStoreNames: { contains: name => name === 'assets' }, close() { closed++; }, transaction(name, mode) {
      transactions++; assert.equal(name, 'assets'); assert.equal(mode, 'readonly'); const tx = { objectStore: () => ({ get(id) { assert.equal(id, digest); const read = { result: asset }; queueMicrotask(() => tx.oncomplete()); return read; } }) }; return tx;
    } }; request.onsuccess(); }); return request;
  } };
  assert.equal(await readHistoricalChatAsset(digest, 'previous', factory), asset); assert.equal(closed, 1); assert.equal(transactions, 1);
});
test('an enumeration/open race aborts database creation instead of erasing the missing asset distinction', async () => {
  let aborted = false;
  const factory = { databases: async () => [{ name: 'previous-chat-assets' }], open() {
    const request = { transaction: { abort() { aborted = true; queueMicrotask(() => request.onerror()); } } };
    queueMicrotask(() => request.onupgradeneeded()); return request;
  } };
  await assert.rejects(readHistoricalChatAsset(digest, 'previous', factory), /could not be read/); assert.equal(aborted, true);
});
test('storage permission and transaction failures remain explicit without creating replacement data', async () => {
  await assert.rejects(readHistoricalChatAsset(digest, 'previous', { databases: async () => [{ name: 'previous-chat-assets' }], open() { throw Error('denied'); } }), /could not be read/);
  let closed = 0;
  const factory = { databases: async () => [{ name: 'previous-chat-assets' }], open() {
    const request = {};
    queueMicrotask(() => { request.result = { objectStoreNames: { contains: () => true }, close() { closed++; }, transaction() { throw Error('failed'); } }; request.onsuccess(); });
    return request;
  } };
  await assert.rejects(readHistoricalChatAsset(digest, 'previous', factory), /could not be read/); assert.equal(closed, 1);
});
