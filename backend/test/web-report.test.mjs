import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { PublicWebReader, publicTarget, requestPage, webUrls, webLimits } from '../web-reader.mjs';
import { SourceBundles } from '../source-bundles.mjs';
import { inspectSources, auditReport } from '../report-audit.mjs';
import { ReportTaskService, assertStageEvidence } from '../task-service.mjs';

const text = '第一段是公开网页资料，讲述桌面助手如何整理信息并保留来源。\n第二段说明报告需要区分事实、建议和待核实事项。\n第三段强调停止声音不会取消后台工作，公开网页的引用可以定位到本机保存的段落。';
const html = `<html><head><meta charset="utf-8"><title>公开资料样例</title></head><body><nav>导航应被排除</nav><article>${text.split('\n').map(line => `<p>${line}</p>`).join('')}<script>恶意脚本不得执行</script></article><footer>页脚应被排除</footer></body></html>`;
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-web-test-'));

test('a written placeholder cannot complete a stage after a denied read or with evidence from another request', () => {
  const evidence = [{ tool: 'read_file', path: 'extract.md', ok: false, attempt: 1, requestId: 'report-stage' }, { tool: 'write_file', path: 'report.md', ok: true, attempt: 1, requestId: 'report-stage' }];
  assert.throws(() => assertStageEvidence(evidence, 1, 'report-stage', 'report'), /未成功读取/);
  evidence[0].ok = true; evidence[0].requestId = 'old-stage';
  assert.throws(() => assertStageEvidence(evidence, 1, 'report-stage', 'report'), /未成功读取/);
  evidence[0].requestId = 'report-stage'; evidence[1].ok = false;
  assert.throws(() => assertStageEvidence(evidence, 1, 'report-stage', 'report'), /写入/);
  evidence[1].ok = true;
  assert.doesNotThrow(() => assertStageEvidence(evidence, 1, 'report-stage', 'report'));
});

test('web URL policy rejects local DNS, alternate IP syntax, credentials and unsupported inputs', async () => {
  for (const url of ['file:///C:/Windows/win.ini', 'https://user:password@example.com/', 'http://localhost/', 'http://test.local/', 'https://example.com:8443/']) assert.throws(() => webUrls([url]));
  assert.throws(() => webUrls(Array(6).fill('https://example.com/')));
  assert.throws(() => webUrls(['https://example.com/#a', 'https://example.com/#b']));
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:7f00:1']) await assert.rejects(publicTarget('https://public.example/', { lookup: async () => [{ address }] }));
  await assert.rejects(publicTarget('http://2130706433/'));
  await assert.rejects(publicTarget('http://0x7f000001/'));
  const target = await publicTarget('https://example.com/', { lookup: async () => [{ address: '93.184.216.34', family: 4 }] });
  assert.equal(target.address, '93.184.216.34');
});

test('redirect destinations are checked before a second request and aborted DNS does not hang', async () => {
  let requests = 0;
  const reader = new PublicWebReader(dir(), {
    resolve: (url, options) => publicTarget(url, { ...options, lookup: async () => [{ address: '93.184.216.34', family: 4 }] }),
    request: async () => { requests++; return { status: 302, location: 'http://127.0.0.1/private' }; },
  });
  await assert.rejects(reader.read('https://example.com/'));
  assert.equal(requests, 1);
  await assert.rejects(publicTarget('https://example.com/', { signal: AbortSignal.timeout(30), lookup: () => new Promise(() => {}) }));
});

test('HTTP reader sends no cookies, bounds bytes, rejects binary responses and supports cancellation', async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.cookie, undefined); assert.equal(req.headers.authorization, undefined);
    if (req.url === '/slow') return;
    if (req.url === '/large') { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': webLimits.bytes + 1 }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end('not a webpage');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const target = route => ({ url: `http://public.test:${server.address().port}${route}`, address: '127.0.0.1', family: 4 });
  try {
    await assert.rejects(requestPage(target('/large'), AbortSignal.timeout(1000)), /2 MB/);
    await assert.rejects(requestPage(target('/pdf'), AbortSignal.timeout(1000)), /不是/);
    await assert.rejects(requestPage(target('/slow'), AbortSignal.timeout(30)));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('HTML extraction strips active content and saves source URLs and exact paragraph snapshots', async () => {
  const root = dir();
  const reader = new PublicWebReader(path.join(root, 'temp'), {
    resolve: async url => ({ url }),
    request: async () => ({ status: 200, bytes: gzipSync(html), type: 'text/html; charset=utf-8', encoding: 'gzip' }),
  });
  const page = await reader.read('https://example.com/article');
  assert.equal(page.title, '公开资料样例'); assert.ok(page.text.includes('后台工作'));
  assert.ok(!/恶意脚本|导航应|页脚应/.test(page.text));
  assert.equal(fs.readdirSync(path.join(root, 'temp')).length, 0);
  reader.request = async () => ({ status: 200, bytes: Buffer.from('<html><head><title>Loading</title></head><body>Please enable JavaScript. ' + 'This page needs the client application to load the article. '.repeat(3) + '</body></html>'), type: 'text/html; charset=utf-8', encoding: '' });
  await assert.rejects(reader.read('https://example.com/dynamic'), /脚本提示/);
  assert.equal(fs.readdirSync(path.join(root, 'temp')).length, 0);
  const bundles = new SourceBundles(path.join(root, 'sources'));
  const bundle = bundles.importWeb([page]);
  assert.equal(inspectSources(bundle).passed, true);
  const source = bundles.readSource(bundle, 'S1-P1');
  assert.equal(source.url, page.url); assert.equal(source.title, page.title); assert.equal(source.paragraphs.length, 1);
  assert.equal(auditReport('公开资料需要保留来源。[S1-P1]', bundle).references[0].paragraph, 'S1-P1');
  bundle.entries[0].url = 'https://different.example/';
  assert.equal(inspectSources(bundle).passed, false);
  const aborted = new AbortController(); aborted.abort();
  assert.throws(() => bundles.importWeb([page], aborted.signal));
  assert.ok(fs.readdirSync(bundles.directory).every(name => !name.endsWith('.pending')));
});

function collectionFixture(reader) {
  const root = dir();
  const sources = new SourceBundles(path.join(root, 'sources'));
  const service = new ReportTaskService(path.join(root, 'runs'), () => {}, 10, { workspace: root, sources, webReader: reader });
  const id = 'report-' + crypto.randomUUID(); const workspace = path.join(root, 'runs', id);
  fs.mkdirSync(path.join(workspace, 'sandbox'), { recursive: true });
  const job = { id, sessionId: 'web-owner', requestKey: 'fixture', kind: 'web', urls: ['https://example.com/a', 'https://example.com/b'], pageStates: [], status: 'running', version: 1, requirements: '', includeJapanese: false, workspace, completed: [], evidence: [], checkpoints: {}, inputHashes: {}, attempts: [{ number: 1, workspace: path.relative(root, workspace) }], controller: new AbortController(), createdAt: new Date().toISOString() };
  service.jobs.set(id, job);
  return { root, sources, service, job };
}

test('web collection pauses between pages, applies edits, and restores verified fetch checkpoint without refetch', async () => {
  let release; let calls = 0;
  const firstPage = new Promise(resolve => { release = resolve; });
  const fixture = collectionFixture({ read: async url => { calls++; if (calls === 1) await firstPage; return { text, title: '资料', url, finalUrl: url, fetchedAt: new Date().toISOString(), contentType: 'text/html' }; } });
  const { service, job } = fixture;
  const execution = service.collectWeb(job);
  try {
    await new Promise(resolve => setTimeout(resolve, 10)); service.pause(job); release();
    for (let i = 0; i < 100 && job.status !== 'paused'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(job.status, 'paused'); assert.equal(calls, 1);
    service.modify(job, 1, true, '保留来源');
    // Collection has no worker yet in this focused unit test.
    job.status = 'running'; await execution;
    assert.equal(calls, 2); assert.deepEqual(job.completed, ['fetch']); assert.equal(job.sourceFiles[0].url, job.urls[0]);
    job.status = 'interrupted'; service.persist(job);
    assert.equal(service.recoveryPlan(job).nextStage, 'extract');
    await service.close();
    const restored = new ReportTaskService(path.join(fixture.root, 'after'), () => {}, 10, { workspace: fixture.root, storeDirectory: path.join(fixture.root, 'runs', 'state'), sources: fixture.sources });
    try { const loaded = restored.find('web-owner', job.id); assert.equal(restored.snapshot(loaded.id).stages, 4); assert.equal(restored.recoveryPlan(loaded).nextStage, 'extract'); assert.equal(loaded.requirements, '保留来源'); }
    finally { await restored.close(); }
  } finally { await service.close(); }
});

test('page failure and cancellation publish no source bundle and remain distinct from successful partial reading', async () => {
  let calls = 0;
  const fixture = collectionFixture({ read: async url => { if (++calls === 2) throw new Error('HTTP 403'); return { text, url, finalUrl: url, fetchedAt: new Date().toISOString(), contentType: 'text/html' }; } });
  try {
    await assert.rejects(fixture.service.collectWeb(fixture.job), /第 2.*未跳过/);
    assert.equal(fixture.job.pageStates[1].status, 'failed'); assert.equal(fixture.job.sourceId, undefined);
    assert.equal(fs.readdirSync(fixture.sources.directory).length, 0);
    fixture.job.status = 'failed'; assert.equal(fixture.service.recoveryPlan(fixture.job).nextStage, 'fetch');
  } finally { await fixture.service.close(); }
  const cancelled = collectionFixture({ read: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  const pending = cancelled.service.collectWeb(cancelled.job);
  try {
    await new Promise(resolve => setTimeout(resolve, 10)); cancelled.service.cancel(cancelled.job);
    await assert.rejects(pending); assert.equal(cancelled.job.sourceId, undefined);
    assert.equal(fs.readdirSync(cancelled.sources.directory).length, 0);
  } finally { await cancelled.service.close(); }
});
