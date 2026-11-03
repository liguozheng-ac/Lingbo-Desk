import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { readBody, CHAT_BODY_LIMIT, DEFAULT_BODY_LIMIT } from '../request-body.mjs';

async function withServer(run) {
  const server = http.createServer(async (req, res) => {
    try {
      const bytes = await readBody(req, req.url === '/chat' ? CHAT_BODY_LIMIT : undefined);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }));
    } catch (error) {
      res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: error.code, limit: error.limitBytes }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('chat accepts an 11 MiB screenshot-sized body without truncation; unrelated routes keep the original limit', async () => {
  await withServer(async origin => {
    const bytes = Buffer.alloc(11 * 1024 * 1024, 65);
    const accepted = await fetch(origin + '/chat', { method: 'POST', body: bytes });
    assert.equal(accepted.status, 200);
    const result = await accepted.json();
    assert.equal(result.bytes, bytes.length); assert.equal(result.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    const rejected = await fetch(origin + '/other', { method: 'POST', body: bytes });
    assert.equal(rejected.status, 413); assert.equal((await rejected.json()).limit, DEFAULT_BODY_LIMIT);
  });
});

test('oversized declared content length receives readable HTTP 413 without sending a huge payload', async () => {
  await withServer(async origin => {
    const response = await new Promise((resolve, reject) => {
      const req = http.request(origin + '/chat', { method: 'POST', headers: { 'Content-Length': CHAT_BODY_LIMIT + 1 } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
      });
      req.on('error', reject); req.end();
    });
    assert.equal(response.status, 413); assert.equal(response.body.code, 'REQUEST_BODY_TOO_LARGE');
  });
});

test('chunked upload cannot bypass the cap and delivers HTTP 413 instead of a socket reset', async () => {
  await withServer(async origin => {
    const response = await new Promise((resolve, reject) => {
      const req = http.request(origin + '/other', { method: 'POST' }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
      });
      req.on('error', reject);
      req.write(Buffer.alloc(DEFAULT_BODY_LIMIT)); req.end(Buffer.alloc(1));
    });
    assert.equal(response.status, 413); assert.equal(response.body.limit, DEFAULT_BODY_LIMIT);
  });
});
