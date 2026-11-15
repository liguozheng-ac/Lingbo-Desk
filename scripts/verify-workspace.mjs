// Browser interaction tests against an isolated fixture server. These are NOT
// model/task-success measurements. No production account or document is used.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '..');
const { chromium } = createRequire(path.join(root, 'desktop/package.json'))('playwright');
const task = (id, sessionId, status) => ({ id, sessionId, status, version: 1, request: `${id} 任务`, createdAt: new Date().toISOString(), modelProfile: 'deepseek', receipts: [], artifacts: [], inputSources: [] });
let jobs = [task('task-A', 'owner-A', 'paused'), { ...task('task-B', 'owner-B', 'awaiting_approval'), approval: { id: 'approval-B', tool: 'work_edit', path: '<img src=x onerror="window.injected=true">.docx', oldText: '<script>window.injected=true</script>', newText: '新文本' } }];
let online = true, activeOwner = 'owner-A', submissions = 0, creations = 0, approvals = [], controls = [], dropSubmit = false;
const checks = [], errors = [];
const pass = name => { checks.push(name); console.log('PASS ' + name); };
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const json = data => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (pathname === '/bootstrap') return json({ token: 'fixture-only', sessionId: 'fallback' });
  if (['/workspace', '/workspace.mjs', '/workspace-view.mjs', '/client-api.mjs'].includes(pathname)) {
    res.writeHead(200, { 'Content-Type': pathname === '/workspace' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' }); return res.end(fs.readFileSync(path.join(root, 'backend', pathname === '/workspace' ? 'workspace.html' : pathname.slice(1))));
  }
  if (!online) { res.writeHead(503); return res.end('{}'); }
  if (pathname === '/status') return json({ lingboConnected: true, activeLingboSessionId: activeOwner });
  if (pathname === '/work/status') return json({ jobs, permissions: { roots: [] } });
  if (pathname.startsWith('/work/artifact/')) return res.end('actual fixture bytes');
  if (pathname.startsWith('/work/source/')) return json({ text: '<script>window.injected=true</script> [S1-P1] 来源', snapshotSha256: 'fixture-hash' });
  let raw = ''; for await (const chunk of req) raw += chunk;
  if (pathname === '/sources/import') { activeOwner = 'owner-new-during-upload'; await new Promise(resolve => setTimeout(resolve, 3200)); return json({ id: 'fixture-bundle' }); }
  const data = JSON.parse(raw || '{}');
  if (pathname === '/work/approve') {
    approvals.push({ data, owner: req.headers['x-lingbo-session'] });
    const job = jobs.find(j => j.id === data.taskId); job.status = 'running'; job.approval = null; return json({ task: job });
  }
  if (pathname === '/work/control') {
    controls.push({ data, owner: req.headers['x-lingbo-session'] }); const job = jobs.find(j => j.id === data.taskId);
    if (data.action === 'modify') { job.version++; job.request = data.request; } else if (data.action === 'resume') job.status = 'running'; else if (data.action === 'cancel') job.status = 'cancelled'; else job.status = 'paused';
    return json({ task: job });
  }
  if (pathname === '/work/submit') {
    submissions++; const existing = jobs.find(j => j.sessionId === req.headers['x-lingbo-session'] && j.requestId === req.headers['x-request-id']);
    if (existing) return json({ task: existing });
    creations++; const job = { ...task('task-new', req.headers['x-lingbo-session'], 'running'), requestId: req.headers['x-request-id'], request: data.request }; jobs.push(job);
    if (dropSubmit) { req.socket.destroy(); return; } return json({ task: job });
  }
  res.writeHead(404); res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.LINGBO_TEST_CHROME ? { executablePath: process.env.LINGBO_TEST_CHROME } : { channel: 'chrome' }) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/workspace`);
  await page.getByText('本机服务已连接', { exact: true }).waitFor();
  assert.equal(await page.locator('#history button').count(), 1);
  await page.locator('#all-tasks').check(); await page.locator('#history button').filter({ hasText: 'task-B' }).click();
  assert.equal(await page.evaluate(() => !!window.injected), false); assert.match(await page.locator('#approval-target').textContent(), /<img/);
  await page.locator('#approve').click(); await page.waitForFunction(() => document.querySelector('#task-status').textContent === '正在执行');
  assert.deepEqual(approvals[0], { data: { taskId: 'task-B', approvalId: 'approval-B', version: 1, approved: true }, owner: 'owner-B' });
  pass('cross-session selection binds approval to the displayed owner, task, version and action; text cannot inject HTML');
  await page.locator('#history button').filter({ hasText: 'task-A' }).click(); await page.locator('#modify').click(); await page.locator('#new-requirements').fill('新要求，保留已完成的动作'); await page.locator('#save-modify').click();
  await page.waitForFunction(() => document.querySelector('#task-meta').textContent.includes('版本 2')); await page.locator('#resume').click();
  assert.equal(controls[0].data.version, 1); assert.equal(controls[0].owner, 'owner-A'); assert.equal(controls[1].data.version, 2);
  pass('paused modification saves a new version and resumption uses its actual version and owner');
  online = false; await page.getByText('连接中断 · 自动重连', { exact: true }).waitFor({ timeout: 10000 }); assert.equal(await page.locator('#pause').isDisabled(), true); assert.match(await page.locator('#live-badge').textContent(), /上次已知/);
  online = true; await page.getByText('本机服务已连接', { exact: true }).waitFor({ timeout: 10000 });
  pass('connection loss labels stale evidence and disables task execution until reconnection');
  await page.locator('#new-task').click(); await page.locator('#files').setInputFiles({ name: '测试.md', mimeType: 'text/markdown', buffer: Buffer.from('合成资料') });
  dropSubmit = true; await page.locator('#submit').click(); await page.waitForFunction(() => document.querySelector('#task-title').textContent.includes('对比资料'));
  assert.equal(creations, 1); assert.equal(jobs.at(-1).sessionId, 'owner-A');
  const beforeReload = submissions;
  await page.reload(); await page.locator('#task-card').waitFor({ state: 'visible' }); assert.equal(creations, 1); assert.equal(submissions, beforeReload);
  pass('upload-time session switching preserves the original owner; lost submit response and reload create no duplicate task');
  Object.assign(jobs.at(-1), { status: 'completed', artifacts: ['result.md'], inputSources: [{ source: 'S1', name: '<script>source</script>' }], verification: { scope: 'declared_outputs', checks: [{ contentChecked: false }], limitation: '仅检查文件，不保证业务正确' } });
  await page.locator('#sources button').waitFor(); await page.locator('#sources button').click(); await page.locator('#source-dialog').waitFor({ state: 'visible' }); assert.match(await page.locator('#source-dialog-text').textContent(), /<script>/); assert.equal(await page.evaluate(() => !!window.injected), false); await page.locator('[data-close="source-dialog"]').click();
  await page.locator('#results button').filter({ hasText: '预览' }).click(); await page.locator('#source-dialog').waitFor({ state: 'visible' }); assert.equal(await page.locator('#source-dialog-text').textContent(), 'actual fixture bytes'); await page.locator('[data-close="source-dialog"]').click();
  const downloadPromise = page.waitForEvent('download'); await page.locator('#results button').filter({ hasText: '下载' }).click(); const download = await downloadPromise; assert.equal(download.suggestedFilename(), 'result.md');
  const stream = await download.createReadStream(); let bytes = ''; for await (const chunk of stream) bytes += chunk; assert.equal(bytes, 'actual fixture bytes');
  pass('source viewer renders inert text and downloads actual response bytes with the correct name');
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []); pass('mobile layout has no horizontal overflow or uncaught page errors');
  console.log(JSON.stringify({ mode: 'fixture-only browser tests; no real model or production files', passed: true, checks: checks.length }));
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
