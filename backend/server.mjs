import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { ReportTaskService } from './task-service.mjs';
import { parseCommand, plainText } from './commands.mjs';
import { initializeData } from '../runtime/shared.mjs';
import { SourceBundles } from './source-bundles.mjs';
import { loadSettings, saveSettings, speechLanguages } from './settings.mjs';
import { VoiceMetrics } from './voice-metrics.mjs';
import { recognizeFile } from './asr-file.mjs';
import { PublicWebReader } from './web-reader.mjs';
import { readBody, CHAT_BODY_LIMIT } from './request-body.mjs';
import { PersonalStore, memoryCommand } from './personal-store.mjs';
import { PersonalSkills } from './personal-skills.mjs';
import { ModelRouter, profiles } from './model-router.mjs';
import { WorkPolicy } from './work-policy.mjs';
import { WorkTools } from './work-tools.mjs';
import { WorkBrowser } from './work-browser.mjs';
import { WorkService } from './work-service.mjs';
import { DiagnosticLog } from '../runtime/diagnostic-log.mjs';
import { createSecretRedactor } from '../engine/src/runtime/diagnostic-privacy.js';
import { EventFeed } from './event-feed.mjs';
import { ServiceConfig } from './service-config.mjs';
import { probeSpeech } from './service-probe.mjs';
import { decodeAudio } from './audio-decoder.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(process.env.VOICE_AGENT_WORKSPACE || path.join(root, '..', '.local', 'workspace'));
const local = path.join(workspace, '.local');
const run = path.join(workspace, 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(local, { recursive: true });
process.env.LINGBO_DIAGNOSTICS_METADATA_ONLY = '1';
initializeData(path.join(run, 'foreground'));
const { credentials } = await import('./credentials.mjs');
const serviceConfig = new ServiceConfig(local, credentials());
await serviceConfig.load();
let { deepseekKey, speech } = serviceConfig.current();
process.env.DEEPSEEK_API_KEY = deepseekKey;
process.env.DEEPSEEK_MODEL = 'deepseek-flash';
const { streamTTS } = await import('../speech/adapters/tts-providers.mjs');
const { createCloudASRSession } = await import('../speech/adapters/cloud-asr.mjs');
const { python } = await import('./python-runtime.mjs');
const tokenFile = path.join(local, 'gateway-token');
if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString('hex'));
const token = fs.readFileSync(tokenFile, 'utf8').trim();
const sensitive = [deepseekKey, token, ...Object.values(speech.asr || {}), ...Object.values(speech.tts?.keys || {})].filter(x => typeof x === 'string' && x.length >= 8);
let clean = createSecretRedactor(sensitive);
const diagnosticsDirectory = path.join(local, 'diagnostics');
const diagnostics = new DiagnosticLog(diagnosticsDirectory);
const eventFeed = new EventFeed();
const voiceMetrics = new VoiceMetrics(record);
let sequence = 0;
function record(event) {
  const safe = clean({ ...event, sequence: ++sequence });
  diagnostics.append(safe);
  eventFeed.publish(safe);
}
const sources = new SourceBundles(path.join(local, 'sources'));
const personal = new PersonalStore(local);
const skills = new PersonalSkills(path.join(local, 'skills'), personal);
const models = new ModelRouter(personal, deepseekKey);
let changingModel = false;
let changingServices = false, activeSpeech = 0;
function applyServices() {
  ({ deepseekKey, speech } = serviceConfig.current()); models.cloudKey = deepseekKey;
  process.env.DEEPSEEK_API_KEY = deepseekKey;
  for (const value of [deepseekKey, speech.asr?.aliyunApiKey, speech.tts?.keys?.doubaoKey]) if (value && !sensitive.includes(value)) sensitive.push(value);
  clean = createSecretRedactor(sensitive);
}
const webReader = new PublicWebReader(path.join(local, 'web-tmp'));
const workPolicy = new WorkPolicy(local, { protectedPaths: [root, process.env.VOICE_PROGRAM_DIRECTORY].filter(Boolean) });
const workBrowser = new WorkBrowser(path.join(local, 'work-browser'));
const workTools = new WorkTools({ policy: workPolicy, personal, skills, webReader, browser: workBrowser });
const work = new WorkService(path.join(local, 'work-tasks'), { policy: workPolicy, personal, skills, tools: workTools, record, diagnosticsDirectory, workerEnv: job => ({ LINGBO_MODEL_GATEWAY: `${origin}/worker/${job.modelProfile}/v1`, LINGBO_MODEL_TOKEN: token, WORK_BROKER: `${origin}/work/execute` }) });
const tasks = new ReportTaskService(path.join(run, 'tasks'), record, Number(process.env.LINGBO_TASK_HOLD_MS) || 20000, { workspace, storeDirectory: path.join(local, 'tasks'), sources, webReader, legacyRuns: path.join(workspace, 'runs'), workerOptions: job => ({ diagnosticsDirectory, env: { LINGBO_MODEL_GATEWAY: `${origin}/worker/${job.modelProfile || personal.state.model}/v1`, LINGBO_MODEL_TOKEN: token } }) });
const settingsFile = path.join(local, 'settings.json');
const loadedSettings = loadSettings(settingsFile);
const defaultSessionId = 'lingbo-personal-validation';
let activeLingboSessionId = null;
let speechLanguage = loadedSettings.value.language;
let lastLingboSeen = 0;
let lastLingboConnectedAt = 0;
const allowedOrigins = new Set(['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174', 'null']);
if (process.env.LINGBO_RENDERER_ORIGIN) {
  const renderer = new URL(process.env.LINGBO_RENDERER_ORIGIN);
  if (renderer.protocol !== 'http:' || renderer.hostname !== 'localhost' || renderer.origin !== process.env.LINGBO_RENDERER_ORIGIN) throw new Error('Invalid local renderer origin');
  allowedOrigins.add(renderer.origin); allowedOrigins.add(renderer.origin.replace('localhost', '127.0.0.1'));
}
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
async function command(value, key, sessionId = defaultSessionId) {
  if (value.action === 'create' || value.action === 'create_web') {
    if (changingModel) throw new Error('正在切换模型，请稍后提交任务');
    const sourceBundle = value.sourceId ? sources.get(value.sourceId) : undefined;
    const selectedSkills = skills.context(value.skillIds || [], 'report');
    const task = tasks.create(sessionId, key, { sources: sourceBundle, requirements: value.requirements, modelProfile: personal.state.model, personalContext: [personal.context(), selectedSkills.text].filter(Boolean).join('\n'), skillVersions: selectedSkills.versions, ...(value.action === 'create_web' ? { urls: value.urls || [] } : {}) });
    return { content: `${value.action === 'create_web' ? '网页资料与 Word 报告' : sourceBundle ? '资料整理与 Word 报告' : '测试报告'}任务已提交。你可以继续聊天，或说“报告任务进度”。`, task };
  }
  if (value.action === 'stop_speech') {
    const requestedAt = Date.now();
    const requestId = crypto.randomUUID();
    record({ type: 'speech.stop_requested', data: { sessionId, requestId, requestedAt }, at: requestedAt });
    return { content: '已请求停止播报，后台任务继续。', action: 'stop_speech', requestId, requestedAt };
  }
  const job = tasks.find(sessionId, value.taskId);
  if (value.action === 'progress') return { task: tasks.snapshot(job.id), content: `报告任务状态：${job.status}，已完成 ${job.completed.length}/${tasks.stages(job).length} 个阶段。` };
  if (value.action === 'modify') tasks.modify(job, value.version ?? job.version, value.includeJapanese, value.requirements);
  else if (['pause', 'resume', 'cancel'].includes(value.action)) tasks[value.action](job);
  else throw new Error('不支持该任务操作');
  const labels = { pause: '已请求暂停，等待安全检查点。', resume: '已恢复任务。', cancel: '已请求取消，等待执行器确认。', modify: '已更新尚未开始的报告要求。' };
  return { content: labels[value.action], task: tasks.snapshot(job.id) };
}
function chatResponse(res, content, stream) {
  const id = 'chatcmpl-' + crypto.randomUUID();
  const base = { id, created: Math.floor(Date.now() / 1000), model: 'deepseek-flash' };
  if (!stream) return json(res, 200, { ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`);
  res.end(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
}
function languageOf(text, requested) {
  if (['zh', 'ja', 'en'].includes(requested)) return requested;
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja';
  return /\p{Script=Han}/u.test(text) ? 'zh' : 'en';
}

let origin;
const server = http.createServer(async (req, res) => {
  const controller = new AbortController();
  let timing;
  let modelLease = false;
  let speechLease = false;
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    const hosts = [new URL(origin).host, new URL(origin).host.replace('127.0.0.1', 'localhost')];
    if (!hosts.includes(req.headers.host)) return json(res, 403, { error: { message: 'Host rejected' } });
    const requestOrigin = req.headers.origin;
    if (requestOrigin && requestOrigin !== origin && !allowedOrigins.has(requestOrigin)) return json(res, 403, { error: { message: 'Origin rejected' } });
    if (requestOrigin) { res.setHeader('Access-Control-Allow-Origin', requestOrigin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-ID, X-Lingbo-Session, X-Lingbo-Command, X-Lingbo-Personal-Input, X-Voice-Trace', 'Access-Control-Max-Age': '600' });
      return res.end();
    }
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:" });
      return res.end(fs.readFileSync(path.join(root, 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/privacy.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'" });
      return res.end(fs.readFileSync(path.join(root, 'privacy.html')));
    }
    if (req.method === 'GET' && ['/dashboard.mjs', '/personal-dashboard.mjs', '/work-dashboard.mjs', '/service-dashboard.mjs', '/client-api.mjs', '/entry.js'].includes(url.pathname)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(root, url.pathname.slice(1))));
    }
    if (req.method === 'GET' && url.pathname === '/bootstrap' && (!requestOrigin || requestOrigin === origin) && !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) {
      return json(res, 200, { token, baseURL: origin + '/v1/', sessionId: defaultSessionId });
    }
    if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: { message: '本机连接凭据无效' } });
    if (url.pathname === '/settings/services' && req.method === 'GET') return json(res, 200, serviceConfig.snapshot());
    if (['/settings/services', '/settings/services/probe'].includes(url.pathname) && req.method === 'POST') {
      if ((requestOrigin && requestOrigin !== origin) || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return json(res, 403, { error: { message: '请从本机工作台管理服务配置' } });
      let value;
      try { value = JSON.parse(await readBody(req, 16384)); }
      catch { throw new Error('服务配置请求格式无效，请刷新工作台后重试'); }
      if (changingServices || changingModel || models.active || activeSpeech) throw Object.assign(new Error('服务正在使用或检查中，请结束当前回复与播报后再配置'), { statusCode: 409 });
      tasks.ensureAvailable(); work.ensureAvailable();
      changingServices = true;
      try {
        if (url.pathname === '/settings/services') {
          const snapshot = await serviceConfig.save(value); applyServices();
          return json(res, 200, snapshot);
        }
        if (['deepseek', 'ollama'].includes(value.id)) return json(res, 200, { ...await models.probe(value.id, controller.signal), scope: '单次文本生成；未切换当前模型' });
        return json(res, 200, await probeSpeech(value.id, speech, { createSession: createCloudASRSession, streamTTS, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) }));
      } finally { changingServices = false; }
    }
    if (changingServices && req.method === 'POST' && ['/work/submit', '/task-control', '/personal/model/probe', '/personal/model/select', '/v1/chat/completions', '/v1/audio/speech', '/v1/audio/transcriptions'].some(route => url.pathname === route || url.pathname.endsWith('/v1/chat/completions'))) throw Object.assign(new Error('正在更新或检查服务配置，请稍后重试'), { statusCode: 409 });
    const workerRoute = /^\/worker\/(deepseek|ollama)\/v1\/chat\/completions$/.exec(url.pathname);
    if (workerRoute) url.pathname = '/v1/chat/completions';
    const sessionId = String(req.headers['x-lingbo-session'] || defaultSessionId);
    if (!/^[A-Za-z0-9_:.-]{1,200}$/.test(sessionId)) throw new Error('会话编号无效');
    if (req.method === 'GET' && url.pathname === '/voice/metrics') return json(res, 200, { items: voiceMetrics.list(), native: voiceMetrics.native, rawAudioStored: false, rawTextStored: false });
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { checkedAt: new Date().toISOString(), workspace, uptimeSeconds: Math.round(process.uptime()), memoryMiB: Math.round(process.memoryUsage().rss / 1048576), activeModelRequests: models.active, selectedModel: personal.state.model, desktopConnected: Date.now() - lastLingboSeen < 20000, taskStates: [...tasks.jobs.values()].reduce((counts, job) => { counts[job.status] = (counts[job.status] || 0) + 1; return counts; }, {}), workStates: work.list().reduce((counts, job) => { counts[job.status] = (counts[job.status] || 0) + 1; return counts; }, {}), warnings: [...tasks.warnings, ...work.warnings], memoryEntries: personal.state.memories.length, enabledSkills: skills.list().filter(s => s.enabled).map(s => s.id) });
    if (req.method === 'POST' && ['/v1/chat/completions', '/v1/audio/speech', '/v1/audio/transcriptions'].includes(url.pathname)) {
      if (url.pathname !== '/v1/chat/completions') { activeSpeech++; speechLease = true; }
      timing = voiceMetrics.begin(url.pathname.endsWith('transcriptions') ? 'asr' : url.pathname.endsWith('speech') ? 'tts' : 'llm', sessionId, String(req.headers['x-voice-trace'] || ''));
      res.setHeader('X-Voice-Trace', timing.id); res.setHeader('Access-Control-Expose-Headers', 'X-Voice-Trace');
    }
    if (!workerRoute && req.headers['x-lingbo-session'] && url.pathname === '/v1/chat/completions') activeLingboSessionId = sessionId;
    if (req.method === 'GET' && url.pathname === '/status') return json(res, 200, { pid: process.pid, run, sessionId, activeLingboSessionId, model: models.choice(), modelsInFlight: models.active, memoryCount: personal.state.memories.length, language: speechLanguage, settingsWarning: [loadedSettings.warning, serviceConfig.warning].filter(Boolean).join('\n') || null, taskWarnings: tasks.warnings, lingboConnected: Date.now() - lastLingboSeen < 20000, lastLingboConnectedAt, llm: personal.state.model === 'ollama' || !!deepseekKey, asr: !!speech.asr?.aliyunApiKey, tts: !!speech.tts?.keys?.doubaoKey, configurationRequired: personal.state.model === 'deepseek' && !deepseekKey, jobs: [...tasks.jobs.values()].map(job => tasks.snapshot(job.id)) });
    if (req.method === 'GET' && url.pathname === '/personal') return json(res, 200, { ...personal.snapshot(), skills: skills.list(), profiles: Object.values(profiles).map(({ id, name, model }) => ({ id, name, model })) });
    if (req.method === 'POST' && url.pathname === '/personal/memory') {
      const value = JSON.parse(await readBody(req, 8192));
      const state = personal.memory(value); record({ type: 'memory.changed', at: Date.now(), data: { action: value.action, count: state.memories.length } });
      return json(res, 200, state);
    }
    if (req.method === 'POST' && ['/personal/skills/import', '/personal/skills/toggle'].includes(url.pathname)) {
      const value = JSON.parse(await readBody(req, 300000));
      const result = url.pathname.endsWith('/import') ? skills.install(value) : skills.toggle(value);
      record({ type: 'skills.changed', at: Date.now(), data: { id: value.id, action: url.pathname.endsWith('/import') ? 'import' : 'toggle' } });
      return json(res, 200, { revision: personal.state.revision, skills: result });
    }
    if (req.method === 'POST' && ['/personal/model/probe', '/personal/model/select'].includes(url.pathname)) {
      const value = JSON.parse(await readBody(req, 1024));
      if (changingModel) throw Object.assign(new Error('已有模型检查或切换在进行'), { statusCode: 409 });
      if (url.pathname.endsWith('/select')) { tasks.ensureAvailable(); work.ensureAvailable(); if (models.active) throw Object.assign(new Error('模型正在回复，请结束当前回复后再切换'), { statusCode: 409 }); }
      changingModel = true;
      try {
        const probe = await models.probe(value.id, controller.signal);
        if (url.pathname.endsWith('/select')) {
          tasks.ensureAvailable(); work.ensureAvailable(); if (models.active) throw Object.assign(new Error('有新回复正在进行，尚未切换'), { statusCode: 409 });
          personal.commit(next => { next.model = models.choice(value.id).id; }, value.revision);
          record({ type: 'model.selected', at: Date.now(), data: { id: value.id } });
        }
        return json(res, 200, { ...probe, selected: personal.state.model, revision: personal.state.revision });
      } finally { changingModel = false; }
    }
    if (req.method === 'POST' && url.pathname === '/bridge-event') {
      const value = JSON.parse(await readBody(req, 4096));
      if (['voice.timing', 'voice.trace'].includes(value.type)) voiceMetrics.captureNative(value.data);
      if (['connected', 'heartbeat'].includes(value.type)) { activeLingboSessionId = sessionId; lastLingboSeen = Date.now(); }
      if (value.type === 'connected') lastLingboConnectedAt = Date.now();
      record({ type: 'lingbo.' + String(value.type || 'event').slice(0,50), data: value.data, at: Date.now() });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/settings/language') {
      const value = JSON.parse(await readBody(req, 1024));
      if (!speechLanguages.includes(value.language)) throw new Error('仅支持自动识别、中文、日语、英语');
      saveSettings(settingsFile, { language: value.language });
      speechLanguage = value.language;
      loadedSettings.warning = null;
      return json(res, 200, { language: speechLanguage });
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      eventFeed.subscribe(res); return;
    }
    if (req.method === 'POST' && url.pathname === '/sources/import') {
      const data = await readBody(req, 22 * 1024 * 1024);
      const form = await new Request(origin, { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] }, body: data }).formData();
      const files = form.getAll('files');
      if (files.some(file => !file || typeof file.arrayBuffer !== 'function')) throw new Error('资料文件无效');
      return json(res, 200, await sources.import(files, form.getAll('names')));
    }
    if (req.method === 'POST' && url.pathname === '/task-control') {
      const value = JSON.parse(await readBody(req, 16384));
      const result = await command(value, String(req.headers['x-request-id'] || crypto.randomUUID()), sessionId);
      return json(res, 200, result);
    }
    if (req.method === 'GET' && url.pathname === '/work/status') return json(res, 200, { jobs: work.list(), permissions: workPolicy.state, warnings: work.warnings });
    if (req.method === 'POST' && url.pathname === '/work/permissions') {
      const value = JSON.parse(await readBody(req, 8192));
      const state = workPolicy.update(value); record({ type: 'work.permissions_changed', at: Date.now(), data: { action: value.action, revision: state.revision } });
      return json(res, 200, state);
    }
    if (req.method === 'POST' && url.pathname === '/work/submit') {
      if (changingModel) throw new Error('正在切换模型，请稍后提交任务');
      const value = JSON.parse(await readBody(req, 80000));
      const task = work.create(sessionId, String(req.headers['x-request-id'] || crypto.randomUUID()), value);
      return json(res, 200, { task, content: `工作任务已提交：${task.id}。可继续聊天；需要确认时在本机任务台处理，任务完成以执行回执为准。` });
    }
    if (req.method === 'POST' && ['/work/control', '/work/approve'].includes(url.pathname)) {
      const value = JSON.parse(await readBody(req, 80000)); const job = work.find(sessionId, value.taskId);
      return json(res, 200, { task: url.pathname.endsWith('/approve') ? await work.approve(job, value) : work.control(job, value) });
    }
    if (req.method === 'POST' && url.pathname === '/work/execute') {
      const value = JSON.parse(await readBody(req, 200000));
      return json(res, 200, await work.execute(value));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/work/artifact/')) {
      const parts = url.pathname.split('/'), job = work.find(sessionId, parts[3]), name = decodeURIComponent(parts[4] || '');
      if (parts.length !== 5 || path.basename(name) !== name || !name || !work.snapshot(job).artifacts.includes(name)) throw new Error('工作产物不存在');
      const file = workPolicy.resolve(job, name); workTools.checkSize(file);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(fs.readFileSync(file));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/task-audit/')) {
      const job = tasks.find(sessionId, url.pathname.split('/')[2]);
      return json(res, 200, tasks.audit(job));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/task-source/')) {
      const parts = url.pathname.split('/');
      if (parts.length !== 4) throw new Error('来源路径无效');
      const job = tasks.find(sessionId, parts[2]);
      if (!job.sources) throw new Error('此任务的来源快照不可用');
      const source = sources.readSource(job.sources, parts[3]);
      if (url.searchParams.get('download') === '1') {
        const index = job.sources.entries.findIndex(entry => entry.source === source.source);
        const file = path.join(job.sources.directory, `${index + 1}${path.extname(source.name).toLowerCase()}`);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(source.name))}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(fs.readFileSync(file));
      }
      return json(res, 200, source);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/artifact/')) {
      const parts = url.pathname.split('/');
      if (parts.length !== 4) throw new Error('产物路径无效');
      const job = tasks.find(sessionId, parts[2]);
      if (parts[3] === 'report.docx') {
        const bytes = tasks.artifact(job, parts[3]);
        res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename="report.docx"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(bytes);
      }
      return json(res, 200, { name: parts[3], content: tasks.artifact(job, parts[3]) });
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') return json(res, 200, { object: 'list', data: ['voice-agent-default', 'deepseek-flash', 'local-paraformer', 'local-doubao-tts'].map(id => ({ id, object: 'model', owned_by: 'local-gateway' })) });
    if (req.method === 'GET' && url.pathname === '/v1/audio/voices') return json(res, 200, { voices: [{ id: 'local-vivi', name: 'Vivi', languages: ['zh', 'ja', 'en'] }] });
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = await readBody(req, CHAT_BODY_LIMIT);
      const value = JSON.parse(body);
      const last = value.messages?.at(-1);
      const text = last?.role === 'user' ? plainText(last.content).trim() : '';
      const originalPersonalInput = req.headers['x-lingbo-personal-input'] ? decodeURIComponent(String(req.headers['x-lingbo-personal-input'])) : '';
      if (originalPersonalInput.length > 1000) throw new Error('个人指令超过 1000 字');
      if (!workerRoute && (originalPersonalInput || text)) {
        const remembered = memoryCommand(originalPersonalInput || text, personal);
        if (remembered !== null) { timing?.finish(); return chatResponse(res, remembered, !!value.stream); }
      }
      const actionHeader = String(req.headers['x-lingbo-command'] || '');
      if (actionHeader && !['create','progress','pause','resume','cancel','modify','stop_speech'].includes(actionHeader)) throw new Error('任务指令无效');
      const parsed = workerRoute ? null : actionHeader ? { action: actionHeader, ...(actionHeader === 'modify' ? { includeJapanese: true } : {}) } : parseCommand(text);
      record({ type: 'model.request_routed', at: Date.now(), data: { sessionId, command: parsed?.action || null, headerCommand: !!actionHeader, bodyBytes: body.length, messageCount: value.messages?.length || 0 } });
      if (parsed) {
        let content;
        try { const result = await command(parsed, crypto.createHash('sha256').update(JSON.stringify(value.messages)).digest('hex'), sessionId); content = parsed.action === 'stop_speech' ? '' : result.content; }
        catch (error) { content = clean(error.message); }
        timing?.mark('commandFinished'); timing?.finish();
        return chatResponse(res, content, !!value.stream);
      }
      const begin = Date.now();
      const profile = workerRoute ? models.choice(workerRoute[1]) : models.forTurn(sessionId, String(req.headers['x-voice-trace'] || ''));
      if (!workerRoute) {
        const userText = originalPersonalInput || plainText(value.messages?.findLast(m => m.role === 'user')?.content || '').trim();
        const selectedSkills = skills.chatSelection(userText);
        // One durable memory authority. LINGBO's native data remains on disk; it is
        // no longer an independent model-write path in this integrated product.
        value.tools = value.tools?.filter(t => !['builtIn_readMemory','builtIn_writeMemory','builtIn_forgetMemory', 'computer_use', 'computer_use_read_image'].includes(t.function?.name));
        const context = ['只有本机记忆服务明确返回写入回执，才能声称已持久保存记忆。普通聊天不会自动保存。需要保存时让用户明确说“记住：内容”或使用本机任务台，不编造保存成功。', '当前后台工作统一通过 lingbo_submit_work 提交，lingbo_work_control 查询、暂停、取消、恢复或修改。文件、Office、浏览器和脚本工作使用这个入口，避免绕过任务权限直接操作桌面。工具只返回提交回执时不能说已经完成。高风险动作要在本机任务台确认，不能把聊天中的“好的”解释为某个未展示动作的确认。长期记忆以本条提供的本机个人记忆为准，不自动写入 LINGBO 角色记忆。', personal.context(), selectedSkills.text].filter(Boolean).join('\n');
        if (context) value.messages = [{ role: 'system', content: context }, ...value.messages];
      }
      record({ type: 'model.dispatched', at: Date.now(), data: { sessionId, profile: profile.id, worker: !!workerRoute, outputTokenLimit: models.body(value, profile).max_tokens } });
      models.active++; modelLease = true;
      // LINGBO retains dialogue orchestration. This endpoint forwards model calls.
      const response = await models.request(value, profile, controller.signal);
      timing?.mark('modelHeaders');
      if (!response.ok) {
        const descriptions = { 401: '凭据无效，请检查本机 DeepSeek 配置', 402: '余额不足，请检查 DeepSeek 账户', 429: '请求过于频繁，请稍后重试', 503: '服务暂时不可用，请稍后重试' };
        await response.body?.cancel();
        throw Object.assign(new Error(`${profile.name} ${response.status}：${profile.id === 'deepseek' ? descriptions[response.status] || '模型请求失败，请稍后重试' : '本地模型请求失败，请检查 Ollama，未自动改用云端'}`), { statusCode: 502 });
      }
      res.writeHead(200, { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
      let pending = ''; const decoder = new TextDecoder(); const finishReasons = new Set();
      const meter = new Transform({ transform(chunk, _encoding, callback) {
        timing?.mark('modelFirstByte');
        if (value.stream) {
          pending += decoder.decode(chunk, { stream: true });
          const lines = pending.split('\n'); pending = lines.pop();
          for (const line of lines) if (line.startsWith('data: ') && line.slice(6) !== '[DONE]') {
            try {
              const chunk = JSON.parse(line.slice(6));
              if (chunk.choices?.some(choice => choice.delta?.content)) timing?.mark('modelFirstToken');
              for (const choice of chunk.choices || []) if (choice.finish_reason) finishReasons.add(choice.finish_reason);
            } catch {}
          }
        }
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), meter, res);
      timing?.mark('modelFinished'); timing?.finish();
      record({ type: 'dialogue.completed', at: Date.now(), data: { elapsedMs: Date.now() - begin, profile: profile.id, finishReasons: [...finishReasons] } });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/audio/speech') {
      const value = JSON.parse(await readBody(req, 16384));
      const text = String(value.input || '').trim();
      if (!text || text.length > 800) throw new Error('播报文字须为 1 至 800 字');
      const lang = languageOf(text, value.language);
      timing?.mark('synthesisStarted');
      const audio = await streamTTS({ ...speech.tts, text, language: lang, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
      let bytes = 0;
      const meter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; timing?.mark('audioFirstByte'); callback(null, chunk); } });
      await pipeline(audio, meter, res);
      timing?.mark('audioFinished'); timing?.finish('completed', { language: lang, characters: text.length, bytes });
      record({ type: 'speech.completed', at: Date.now(), data: { lang, characters: text.length } });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/audio/transcriptions') {
      const data = await readBody(req, 5 * 1024 * 1024);
      const form = await new Request(origin, { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] }, body: data }).formData();
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') throw new Error('缺少音频文件');
      const input = path.join(local, crypto.randomUUID() + '.audio');
      const output = input + '.pcm';
      try {
        timing?.mark('fileReceived');
        fs.writeFileSync(input, Buffer.from(await file.arrayBuffer()));
        await decodeAudio(python, path.join(root, '../speech/decode-audio.py'), input, output, controller.signal);
        const pcm = fs.readFileSync(output);
        timing?.mark('decoded');
        if (pcm.length > 32 * 32000) throw new Error('单段音频最多 32 秒');
        // LINGBO injects its UI locale into the upload. The task panel owns the
        // recognition mode, so an implicit client hint must not disable auto.
        const lang = speechLanguage;
        const delivery = String(form.get('delivery') || 'buffered');
        const text = await recognizeFile(pcm, lang, { createSession: createCloudASRSession, credentials: speech.asr, signal: controller.signal, delivery, timing });
        timing?.finish('completed', { language: lang, characters: text.length, audioDurationMs: pcm.length / 32, delivery });
        record({ type: 'asr.completed', at: Date.now(), data: { lang, characters: text.length, rawAudioStored: false } });
        return json(res, 200, { text });
      } finally { for (const name of [input, output]) if (fs.existsSync(name)) fs.unlinkSync(name); }
    }
    return json(res, 404, { error: { message: 'Not found' } });
  } catch (error) {
    timing?.finish(controller.signal.aborted ? 'cancelled' : 'failed');
    if (controller.signal.aborted) { record({ type: 'request.cancelled', at: Date.now() }); res.destroy(); return; }
    const code = /^[A-Z_]{1,60}$/.test(error.code || '') ? error.code : undefined;
    const causeCode = /^[A-Z_]{1,60}$/.test(error.cause?.code || '') ? error.cause.code : undefined;
    const detail = { message: clean(error.message), code, causeCode, route: ['/v1/chat/completions', '/v1/audio/speech', '/v1/audio/transcriptions'].includes(req.url) ? req.url : 'other', ...(Number.isFinite(error.limitBytes) ? { limitBytes: error.limitBytes, receivedBytes: error.receivedBytes, declaredBytes: error.declaredBytes } : {}) };
    record({ type: 'gateway.error', at: Date.now(), data: detail });
    if (!res.headersSent) {
      json(res, error.statusCode || 400, { error: { message: detail.message, ...(code ? { code } : {}) } });
    } else res.destroy();
  } finally { if (modelLease) models.active--; if (speechLease) activeSpeech--; }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.LINGBO_GATEWAY_PORT) || 3850, '127.0.0.1', resolve); });
origin = `http://127.0.0.1:${server.address().port}`;
allowedOrigins.add(origin);
fs.writeFileSync(path.join(local, 'server-info.json'), JSON.stringify({ origin, run, pid: process.pid }, null, 2));
console.log('LINGBO_GATEWAY_READY ' + origin);
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  eventFeed.close();
  server.close();
  const closed = await Promise.allSettled([tasks.close(), work.close()]);
  const incomplete = closed.some(result => result.status === 'rejected') || [...work.jobs.values()].some(job => job.worker || job.inTool);
  diagnostics.append({ type: 'gateway.closed', data: { ok: !incomplete } }); diagnostics.close();
  process.exit(incomplete ? 1 : 0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.send) {
  process.on('message', message => { if (message?.command === 'shutdown') void shutdown(); });
  process.on('disconnect', () => { void shutdown(); });
}
