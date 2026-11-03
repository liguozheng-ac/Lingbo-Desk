import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startStaticRenderer } from '../static-renderer.mjs';
test('packaged static renderer serves modules with correct MIME and cannot write or read outside its root', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-static-')), root = path.join(directory, 'web');
  fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'index.html'), '<html>ready</html>'); fs.writeFileSync(path.join(root, 'app.mjs'), 'export const ready=true;'); fs.writeFileSync(path.join(directory, 'private.txt'), 'outside');
  const server = await startStaticRenderer(root, 0), base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.match(await (await fetch(base)).text(), /ready/);
    const script = await fetch(base + '/app.mjs'); assert.match(script.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(base + '/..%2fprivate.txt')).status, 404);
    assert.equal((await fetch(base + '/app.mjs', { method: 'POST', body: 'overwrite' })).status, 403);
    assert.equal(fs.readFileSync(path.join(root, 'app.mjs'), 'utf8'), 'export const ready=true;');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
});
