import { request } from './client-api.mjs';
import { personalPanel } from './personal-dashboard.mjs';
import { workPanel } from './work-dashboard.mjs';

const byId = id => document.getElementById(id);
let token;
let activeLingboSessionId;
let jobs = [];
let latest;
let sourceId;
let selectedFiles = [];
let connection;
let refreshing = false;
let eventConnectionStarted = false;
let changingLanguage = false;
let displayedTask;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const labels = { starting: '准备中', running: '执行中', pause_requested: '等待安全暂停点', paused: '已暂停', interrupted: '已中断，等待处理', cancel_requested: '正在取消', cancelled: '已取消', completed: '已完成', failed: '失败' };
const stageLabels = { fetch: '读取网页', extract: '提取资料', report: '生成报告', export: '导出 Word' };
const terminal = new Set(['completed', 'cancelled', 'failed', 'interrupted']);
const owner = () => latest?.sessionId || activeLingboSessionId;
const api = (url, data, options = {}) => request(url, { token, owner: owner(), data, ...options });
const personal = personalPanel(api);
const work = workPanel(api, () => activeLingboSessionId);
let personalLoaded = false;

function setTaskState() {
  latest = jobs.find(job => job.id === byId('task-select').value);
  byId('task-state').textContent = latest
    ? `${labels[latest.status] || latest.status} · 已完成 ${latest.completed.length}/${latest.stages || 2} 阶段${latest.current ? ` · 当前：${stageLabels[latest.current] || latest.current}` : ''}\n${latest.error ? `原因：${latest.error}\n` : ''}${['interrupted', 'failed'].includes(latest.status) ? `恢复检查：${latest.recovery?.reason || '暂不可恢复'}\n` : ''}${latest.sourceFiles?.length ? `资料：${latest.sourceFiles.map(file => file.name).join('、')}\n` : ''}执行次数：${latest.attempts || 1}${latest.legacy ? '（旧版历史记录）' : ''}\n任务编号：${latest.id}`
    : '还没有任务。可先选择资料文件夹，或提交公开网页链接。';
  if (latest?.kind === 'web') byId('task-state').textContent += '\n网页读取：\n' + (latest.pageStates.length ? latest.pageStates.map(page => `${page.index}. ${page.status === 'completed' ? '已读取' : page.status === 'failed' ? '失败' : '读取中'} · ${page.title || page.url}${page.error ? '\n' + page.error : ''}`).join('\n') : '等待开始');
  for (const button of byId('controls').querySelectorAll('button')) {
    const action = button.dataset.action;
    button.disabled = !token || (action === 'pause' ? latest?.status !== 'running' || latest.current === 'export'
      : action === 'resume' ? latest?.status !== 'paused' && !latest?.recovery?.canResume
        : action === 'cancel' ? !latest || ['completed', 'cancelled'].includes(latest.status)
          : action?.startsWith('modify') ? !(latest?.status === 'paused' && ['fetch', 'extract'].includes(latest.current)) && !(latest?.recovery?.canResume && !latest.completed.includes('report'))
            : action === 'progress' ? !latest : false);
  }
  byId('download-word').disabled = !latest?.artifacts?.includes('report.docx');
  byId('audit-report').disabled = !latest?.sourceId || !latest.completed.includes('report') || !terminal.has(latest.status);
  byId('view-source').disabled = byId('download-source').disabled = !latest?.sourceFiles?.length;
  const selected = byId('source-reference').value;
  byId('source-reference').replaceChildren(...(latest?.sourceFiles || []).map(source => new Option(`[${source.source}] ${source.title || source.name}`, source.source)));
  if ([...byId('source-reference').options].some(option => option.value === selected)) byId('source-reference').value = selected;
  if (displayedTask !== latest?.id) { byId('task-reply').textContent = ''; byId('audit-detail').textContent = ''; byId('source-text').textContent = ''; byId('source-origin').replaceChildren(); byId('citation-links').replaceChildren(); byId('requirements').value = latest?.requirements || ''; displayedTask = latest?.id; }
  byId('audit-state').textContent = latest?.audit ? `来源检查：${latest.audit.status === 'references_resolved' ? '编号均可追溯，结论仍需复核' : latest.audit.status === 'integrity_failed' ? '资料完整性校验失败' : '有待复核项'} · ${latest.audit.errors} 个错误、${latest.audit.warnings} 个提示` : '选择资料报告后可检查来源。旧报告需先点击检查。';
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    if (!token) token = (await request('/bootstrap')).token;
    const status = await api('/status');
    activeLingboSessionId = status.activeLingboSessionId;
    jobs = status.jobs;
    const selectedId = byId('task-select').value;
    byId('task-select').replaceChildren(...jobs.map(job => new Option(`${labels[job.status] || job.status} · ${job.kind === 'web' ? '网页报告' : job.sourceId ? '资料报告' : '测试报告'} · ${job.id.slice(-8)}`, job.id)));
    byId('task-select').value = jobs.some(job => job.id === selectedId) ? selectedId : jobs.findLast(job => !terminal.has(job.status))?.id || jobs.at(-1)?.id || '';
    byId('status').textContent = `本机连接正常 · ${status.model?.name || '模型'} ${status.llm ? '已配置' : '未配置'} · ASR ${status.asr ? '就绪' : '未配置'} · TTS ${status.tts ? '就绪' : '未配置'}${status.settingsWarning ? `\n${status.settingsWarning}` : ''}${status.taskWarnings?.length ? '\n' + status.taskWarnings.join('\n') : ''}`;
    if (!personalLoaded) { await personal.refresh(); personalLoaded = true; }
    await work.refresh();
    byId('desktop-state').textContent = status.lingboConnected ? 'Hiyori窗口已连接。语音输入请使用角色旁的麦克风按钮。' : '尚未收到Hiyori窗口连接。请启动“聆泊”；此网页的文字与任务功能可单独使用。';
    if (!changingLanguage && document.activeElement !== byId('language')) byId('language').value = status.language;
    if (!eventConnectionStarted) { eventConnectionStarted = true; events(); }
    setTaskState();
  } catch (error) {
    byId('status').textContent = error.message;
    token = undefined;
    for (const button of byId('controls').querySelectorAll('button')) button.disabled = true;
  } finally { refreshing = false; }
}

byId('task-select').addEventListener('change', setTaskState);
byId('retry').addEventListener('click', () => refresh());
byId('language').addEventListener('change', async event => {
  changingLanguage = true;
  try {
    await api('/settings/language', { language: event.target.value });
    byId('language-state').textContent = event.target.value === 'auto' ? '已保存：自动识别，无需切换中、日、英。' : '已保存：固定识别所选语言；切回自动识别即可自由切换。';
  } catch (error) { byId('language-state').textContent = error.message; }
  finally { changingLanguage = false; await refresh(); }
});

byId('controls').addEventListener('click', async event => {
  const action = event.target.dataset.action;
  if (!action) return;
  event.target.disabled = true;
  try {
    const result = await api('/task-control', {
      action: action === 'modify_requirements' ? 'modify' : action,
      ...(action === 'create' ? { requirements: byId('requirements').value, skillIds: personal.reportSkillIds() } : { taskId: latest?.id }),
      ...(action === 'modify' ? { version: latest?.version, includeJapanese: true } : {}),
      ...(action === 'modify_requirements' ? { version: latest?.version, requirements: byId('requirements').value } : {}),
    }, { owner: action === 'create' || action === 'stop_speech' ? activeLingboSessionId : owner(), requestId: crypto.randomUUID() });
    byId('task-reply').textContent = result.content;
    if (result.task) { byId('task-select').add(new Option(result.task.id, result.task.id)); byId('task-select').value = result.task.id; }
  } catch (error) { byId('task-reply').textContent = error.message; }
  finally { await refresh(); }
});

byId('folder').addEventListener('change', event => {
  const all = [...event.target.files];
  selectedFiles = all.filter(file => /\.(md|txt|docx|pdf)$/i.test(file.name));
  sourceId = undefined;
  byId('create-document').disabled = true;
  byId('import').disabled = !selectedFiles.length;
  byId('source-state').textContent = `选中 ${selectedFiles.length} 份支持的资料，跳过 ${all.length - selectedFiles.length} 份其他格式。\n${selectedFiles.map(file => file.webkitRelativePath || file.name).join('\n')}`;
});
byId('import').addEventListener('click', async event => {
  event.target.disabled = true;
  byId('source-state').textContent = '正在读取资料并创建本机快照…';
  try {
    const form = new FormData();
    for (const file of selectedFiles) { form.append('files', file); form.append('names', file.webkitRelativePath || file.name); }
    const value = await api('/sources/import', form, { timeout: 90000 });
    sourceId = value.id;
    byId('source-state').textContent = `已读取 ${value.entries.length} 份资料，共 ${value.characters} 字符。生成报告后可下载 Word。\n${value.entries.map(entry => `${entry.source}：${entry.name}`).join('\n')}`;
    byId('create-document').disabled = false;
  } catch (error) { byId('source-state').textContent = error.message; }
  finally { event.target.disabled = !selectedFiles.length; }
});
byId('create-document').addEventListener('click', async event => {
  if (!sourceId) return;
  event.target.disabled = true;
  try {
    const result = await api('/task-control', { action: 'create', sourceId, requirements: byId('requirements').value, skillIds: personal.reportSkillIds() }, { owner: activeLingboSessionId, requestId: crypto.randomUUID() });
    byId('task-reply').textContent = result.content;
    byId('task-select').add(new Option(result.task.id, result.task.id));
    byId('task-select').value = result.task.id;
    await refresh();
  } catch (error) { byId('task-reply').textContent = error.message; }
  finally { event.target.disabled = false; }
});

byId('web-report').addEventListener('submit', async event => {
  event.preventDefault();
  const button = byId('create-web'); button.disabled = true;
  byId('web-state').textContent = '正在提交网页整理任务…';
  try {
    const urls = byId('web-urls').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const result = await api('/task-control', { action: 'create_web', urls, requirements: byId('web-requirements').value, skillIds: personal.reportSkillIds() }, { owner: activeLingboSessionId, requestId: crypto.randomUUID() });
    byId('web-state').textContent = result.content + ' 请在下方查看各网页的读取进度。';
    byId('task-reply').textContent = result.content;
    byId('requirements').value = byId('web-requirements').value;
    byId('task-select').add(new Option(result.task.id, result.task.id)); byId('task-select').value = result.task.id;
    await refresh();
  } catch (error) { byId('web-state').textContent = error.message; }
  finally { button.disabled = false; }
});

byId('read-report').addEventListener('click', async () => {
  try {
    const completed = latest?.status === 'completed' ? latest : (await api('/status')).jobs.filter(task => task.status === 'completed').at(-1);
    if (!completed) throw new Error('还没有完成的报告');
    byId('artifact').textContent = (await api(`/artifact/${completed.id}/report.md`, undefined, { owner: completed.sessionId })).content;
  } catch (error) { byId('artifact').textContent = error.message; }
});
byId('download-word').addEventListener('click', async () => {
  try {
    const response = await api(`/artifact/${latest.id}/report.docx`, undefined, { owner: latest.sessionId, raw: true });
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url; link.download = `资料整理报告-${latest.id.slice(-8)}.docx`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) { byId('task-reply').textContent = error.message; }
});
async function showSource(reference) {
  const source = await api(`/task-source/${latest.id}/${reference}`, undefined, { owner: latest.sessionId });
  byId('source-origin').replaceChildren();
  if (source.kind === 'web') {
    const link = document.createElement('a'); link.textContent = source.url; link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    byId('source-origin').append('原始网页：', link);
  }
  byId('source-text').textContent = `${source.title || source.name}\n${source.kind === 'web' ? `读取地址：${source.finalUrl}\n读取时间：${source.fetchedAt}\n正文快照` : '原文件'} SHA256：${source.sha256}\n\n${source.paragraphs.map(paragraph => `[${paragraph.id}] ${paragraph.text}`).join('\n\n')}`;
}
byId('audit-report').addEventListener('click', async event => {
  event.target.disabled = true;
  try {
    const audit = await api(`/task-audit/${latest.id}`, undefined, { owner: latest.sessionId });
    byId('audit-detail').textContent = `${audit.scope}\n\n${audit.findings.length ? audit.findings.map(item => item.message).join('\n') : '未发现编号、完整性或所检查数字的异常。'}`;
    const seen = new Set(); const buttons = [];
    for (const reference of audit.references) {
      if (seen.has(reference.reference)) continue; seen.add(reference.reference);
      const button = document.createElement('button'); button.textContent = `[${reference.reference}] ${reference.file}`; button.dataset.reference = reference.reference; buttons.push(button);
    }
    byId('citation-links').replaceChildren(...buttons);
    await refresh();
  } catch (error) { byId('audit-detail').textContent = error.message; }
  finally { event.target.disabled = false; }
});
byId('citation-links').addEventListener('click', async event => {
  const reference = event.target.closest('button')?.dataset.reference;
  if (reference) try { await showSource(reference); } catch (error) { byId('source-text').textContent = error.message; }
});
byId('view-source').addEventListener('click', async () => {
  try { await showSource(byId('source-reference').value); } catch (error) { byId('source-text').textContent = error.message; }
});
byId('download-source').addEventListener('click', async () => {
  try {
    const reference = byId('source-reference').value;
    const response = await api(`/task-source/${latest.id}/${reference}?download=1`, undefined, { owner: latest.sessionId, raw: true });
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a');
    link.href = url; link.download = latest.sourceFiles.find(source => source.source === reference).name.split('/').at(-1); link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) { byId('source-text').textContent = error.message; }
});
byId('chat').addEventListener('submit', async event => {
  event.preventDefault();
  byId('chat-reply').textContent = '处理中…';
  const button = event.target.querySelector('button'); button.disabled = true;
  try {
    const result = await api('/v1/chat/completions', { model: 'deepseek-flash', messages: [{ role: 'user', content: byId('message').value }], stream: false }, { owner: activeLingboSessionId, timeout: 70000 });
    byId('chat-reply').textContent = result.choices[0].message.content;
    await refresh();
  } catch (error) { byId('chat-reply').textContent = error.message; }
  finally { button.disabled = false; }
});
let audio;
byId('samples').addEventListener('click', async event => {
  const lang = event.target.dataset.lang;
  if (!lang) return;
  const text = { zh: '你好，我是你的桌面助手。现在进行中文声音试听。', ja: 'こんにちは。デスクトップアシスタントです。日本語の音声をテストしています。', en: 'Hello. I am your desktop assistant. This is the English voice preview.' }[lang];
  event.target.disabled = true;
  try {
    audio?.pause();
    byId('sample-state').textContent = '正在合成，请稍等…';
    const response = await api('/v1/audio/speech', { model: 'local-doubao-tts', voice: 'local-vivi', input: text, language: lang }, { raw: true, timeout: 40000 });
    const url = URL.createObjectURL(await response.blob());
    audio = new Audio(url);
    audio.addEventListener('ended', () => { URL.revokeObjectURL(url); byId('sample-state').textContent = '试听结束。'; }, { once: true });
    await audio.play();
    byId('sample-state').textContent = '正在播放。角色口型请在Hiyori窗口中体验。';
  } catch (error) { byId('sample-state').textContent = error.message; }
  finally { event.target.disabled = false; }
});
byId('stop-preview').addEventListener('click', () => { audio?.pause(); byId('sample-state').textContent = '已停止试听。'; });
byId('voice-metrics').addEventListener('click', async event => {
  event.target.disabled = true;
  try {
    const value = await api('/voice/metrics');
    const lines = value.items.slice(-12).map(item => {
      const fields = item.kind === 'asr' ? [['decoded', '解码完成'], ['asrReady', '识别连接就绪'], ['audioSent', '上传完成'], ['asrFirstFinal', '首个句末结果']]
        : item.kind === 'llm' ? [['modelFirstToken', '模型首字'], ['modelFinished', '模型完成']]
          : [['audioFirstByte', '音频首字节'], ['audioFinished', '音频接收完成']];
      return `${{ asr: '语音识别', llm: '模型', tts: '语音合成' }[item.kind]} · ${item.outcome === 'completed' ? '完成' : item.outcome === 'cancelled' ? '已取消' : item.outcome === 'running' ? '进行中' : '失败'} · ${item.elapsedMs ?? '…'} ms\n  ${fields.filter(([key]) => item.marks[key] !== undefined).map(([key, label]) => `${label} ${item.marks[key]} ms`).join('；')}`;
    });
    const turns = new Map();
    for (const item of value.native || []) if (item.turnId && item.at !== undefined) {
      const key = JSON.stringify([item.sessionId, item.turnId]);
      const group = turns.get(key) || []; group.push(item); turns.set(key, group);
    }
    for (const events of [...turns.values()].slice(-4)) {
      const started = events.find(item => item.type === 'turn.started');
      const playing = events.find(item => item.type === 'playback.started');
      if (!started || !playing) continue;
      const firstToken = events.find(item => item.type === 'llm.first_token');
      lines.push(`LINGBO 播放器 · 提交到开始播放 ${Math.round(playing.at - started.at)} ms${firstToken ? ` · 首字 ${Math.round(firstToken.at - started.at)} ms` : ''}`);
    }
    byId('voice-metrics-state').textContent = lines.length ? lines.join('\n\n') + '\n\n以上为请求内相对耗时与播放器调度时间；不代表真人说完到耳朵听见的完整延迟。' : '当前启动后还没有记录。可以先试听或在角色窗口对话。';
  } catch (error) { byId('voice-metrics-state').textContent = error.message; }
  finally { event.target.disabled = false; }
});

async function events() {
  let backoff = 1000;
  while (true) {
    try {
      if (!token) { await sleep(backoff); continue; }
      connection = new AbortController();
      const response = await fetch('/events', { headers: { Authorization: `Bearer ${token}` }, signal: connection.signal });
      if (!response.ok) throw new Error(`事件连接失败 ${response.status}`);
      byId('event-state').textContent = '进度通知已连接'; backoff = 1000;
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = '';
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        pending += value;
        const chunks = pending.split('\n\n'); pending = chunks.pop();
        for (const chunk of chunks) {
          const line = chunk.split('\n').find(item => item.startsWith('data: '));
          if (!line) continue;
          const data = JSON.parse(line.slice(6));
          if (['task.snapshot', 'speech.stop_requested', 'gateway.error'].includes(data.type)) {
            byId('events').textContent = `${new Date(data.at).toLocaleTimeString()} ${data.type} ${labels[data.data?.status] || ''}\n` + byId('events').textContent.slice(0, 6000);
            if (data.type === 'task.snapshot') await refresh();
          }
        }
      }
    } catch { /* Status polling supplies the detailed connection error. */ }
    byId('event-state').textContent = '进度通知已断开，正在自动重连…';
    await sleep(backoff); backoff = Math.min(backoff * 2, 10000);
  }
}
addEventListener('pagehide', () => { connection?.abort(); audio?.pause(); }, { once: true });
await refresh();
setInterval(refresh, 3000);
