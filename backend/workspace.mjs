import { request } from './client-api.mjs';
import { taskView, approvalView, reportRequest, fileName, exportedFiles } from './workspace-view.mjs';

const $ = id => document.getElementById(id);
const state = { token: '', owner: '', activeOwner: '', jobs: [], selected: null, compose: true, online: false, busy: false, files: [], pending: null };
let approvalBinding = '', modification = null, cancellation = null;
const api = (url, options = {}) => request(url, { token: state.token, owner: state.owner, ...options });
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
const current = () => state.jobs.find(j => j.id === state.selected);
const time = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''; };
function select(job) {
  state.selected = job.id; state.compose = false; $('reviewed').checked = false;
  sessionStorage.setItem('lingbo-workspace-task', job.id); render();
}
function replaceTask(task) {
  state.jobs = [...state.jobs.filter(j => j.id !== task.id), task]; select(task);
}
function renderFiles() {
  $('file-list').replaceChildren(...state.files.map((file, index) => {
    const row = node('div', undefined, 'file-row'); row.append(node('span', file.name.split('.').at(-1).toUpperCase(), 'file-type'), node('span', file.name, 'name'), node('small', `${Math.ceil(file.size / 1024)} KB`));
    const remove = node('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `移除 ${file.name}`); remove.disabled = state.busy || !!state.pending;
    remove.onclick = () => { state.files.splice(index, 1); renderFiles(); render(); }; row.append(remove); return row;
  }));
}
function render() {
  const job = state.compose ? null : current(), view = taskView(job), locked = state.busy || !state.online;
  $('connection-dot').classList.toggle('online', state.online);
  $('connection-label').textContent = state.online ? '本机服务已连接' : '连接中断 · 自动重连';
  $('live-badge').textContent = state.online ? '实际状态' : '上次已知状态';
  $('compose-card').hidden = !state.compose; $('task-card').hidden = !job;
  $('submit').disabled = locked || (!state.pending && (!state.files.length || !$('requirements').value.trim()));
  $('submit').textContent = state.pending ? '核对上次提交 / 重试' : '开始整理 ↗';
  $('files').disabled = state.busy || !!state.pending; $('requirements').disabled = state.busy || !!state.pending; $('japanese').disabled = state.busy || !!state.pending;
  $('new-task').disabled = state.busy || !!state.pending;
  $('compose-hint').textContent = state.busy ? '正在处理，请稍候…' : state.pending ? '上次提交结果未确认；重试会复用同一请求，不重复创建。' : state.activeOwner ? '关联当前桌面对话，可用语音查询这个任务' : '独立工作台会话；桌面角色连接后新任务将关联当前对话';
  const visible = state.jobs.filter(j => $('all-tasks').checked || j.sessionId === (state.activeOwner || state.owner) || j.id === state.selected).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  $('history').replaceChildren(...visible.slice(0, 30).map(j => {
    const button = node('button', undefined, j.id === job?.id ? 'selected' : ''); button.append(node('strong', j.request.split('\n')[0]), node('small', `${taskView(j).label} · ${time(j.createdAt)}`)); button.onclick = () => select(j); return button;
  }));
  if (!visible.length) $('history').append(node('p', '暂无关联任务', 'muted'));
  $('approval-card').hidden = !job?.approval || job.status !== 'awaiting_approval';
  if (job) {
    $('task-title').textContent = job.request.split('\n')[0]; $('task-request').textContent = job.request;
    $('task-status').textContent = view.label; $('task-status').className = `tag${job.status === 'completed' ? ' success' : ['awaiting_approval','interrupted','failed'].includes(job.status) ? ' warn' : ''}`;
    $('task-meta').replaceChildren(node('span', `要求版本 ${job.version}`), node('span', job.modelProfile === 'ollama' ? '本地模型' : '云端模型'), node('span', `提交 ${time(job.createdAt)}`));
    $('pause').disabled = locked || !view.canPause; $('modify').disabled = locked || !view.canModify;
    $('resume').disabled = locked || !view.canResume || (job.uncertain && !$('reviewed').checked); $('cancel').disabled = locked || !view.canCancel || job.status === 'cancel_requested';
    const blocker = job.status === 'paused' && job.result ? `${job.error || '任务已暂停'}\n${job.error?.includes(job.result) ? '' : job.result}`.trim() : job.error;
    $('review-row').hidden = !view.canResume; $('task-error').hidden = !blocker; $('task-error').textContent = blocker || '';
    $('read-count').textContent = view.readCount; $('write-count').textContent = view.writtenCount;
    $('activity-label').textContent = `${state.online ? '根据真实执行回执更新' : '连接恢复前不代表当前进展'}；阶段标记表示已有证据，不代表语义正确。`;
    $('phases').replaceChildren(...view.phases.map((p,i) => { const li = node('li', undefined, `step${p.done ? ' done' : ''}${view.active && view.current === i ? ' current' : ''}`); const body = node('div'); body.append(node('strong', p.title), node('p', p.detail)); li.append(node('span', p.done ? '✓' : String(i + 1), 'step-icon'), body); return li; }));
    $('receipt-count').textContent = `${view.history.length} 条`;
    $('timeline').replaceChildren(...view.history.slice(-30).reverse().map(r => { const li = node('li'); const body = node('div'); body.append(node('div', r.title), node('small', r.detail)); li.append(node('span', '', 'dot'), body, node('time', time(r.at))); return li; }));
    if (!view.history.length) $('timeline').append(node('li', '等待真实工具回执', 'muted'));
    renderApproval(job, locked);
  } else {
    $('phases').replaceChildren(node('li', '尚未开始任务', 'empty')); $('timeline').replaceChildren(node('li', '真实工具回执会显示在这里。', 'muted')); $('receipt-count').textContent = '0 条';
    $('activity-label').textContent = '接收任务后，根据真实执行记录更新。';
  }
  renderSources(job); renderResults(job, locked);
}
function renderApproval(job, locked) {
  if (!job.approval || job.status !== 'awaiting_approval') { approvalBinding = ''; return; }
  const a = job.approval, key = `${job.id}:${job.version}:${a.id}`, view = approvalView(a);
  if (approvalBinding !== key) {
    approvalBinding = key; $('approval-title').textContent = view.title; $('approval-target').textContent = view.target;
    $('approval-before').textContent = view.before ?? '完整动作见下方'; $('approval-after').textContent = view.after ?? '完整动作见下方';
    $('approval-diff').hidden = view.before === undefined && view.after === undefined;
    $('approval-warning').textContent = view.warning;
    $('approval-detail').textContent = JSON.stringify(a, null, 2);
    // Capture the exact action, version and owner shown to the user. A refresh
    // cannot silently redirect an approval click to another task or action.
    for (const [id, approved] of [['approve',true], ['reject',false]]) $(id).onclick = () => approve({ taskId: job.id, approvalId: a.id, version: job.version, approved }, job.sessionId, key);
  }
  $('approve').disabled = locked; $('reject').disabled = locked;
}
function renderSources(job) {
  const sources = job?.inputSources || [];
  $('source-count').textContent = `${sources.length} 份`;
  $('sources').replaceChildren(...sources.map(source => {
    const row = node('div', undefined, 'source-row'); const button = node('button', source.name); button.onclick = () => openSource(job, source); button.disabled = !state.online;
    row.append(node('span', source.source, 'source-ref'), button); return row;
  }));
  if (!sources.length) $('sources').append(node('p', job ? '此任务没有上传资料快照；可能通过授权文件或网页工作。' : '资料原文快照会随任务保留，便于核对报告依据。', 'footnote'));
}
function renderResults(job, locked) {
  $('result-badge').textContent = !job ? '等待任务' : job.status === 'completed' ? '实际文件' : '中间产物';
  $('result-badge').className = `tag${job?.status === 'completed' ? ' success' : ''}`;
  const names = job?.artifacts || [], exports = exportedFiles(job); $('results').className = names.length || exports.length ? '' : 'empty';
  $('results').replaceChildren(...names.map(name => {
    const row = node('div', undefined, 'result-file'); const button = node('button', '下载 ↗'); button.disabled = locked; button.onclick = () => download(job, name, button);
    row.append(node('span', name.split('.').at(-1).toUpperCase(), 'file-type'), node('span', name, 'name'));
    if (/\.(md|txt|csv)$/i.test(name)) { const preview = node('button', '预览'); preview.disabled = locked; preview.onclick = () => previewArtifact(job, name); row.append(preview); }
    row.append(button); return row;
  }));
  for (const file of exports) {
    const row = node('div', undefined, 'result-file');
    const detail = node('div'); detail.append(node('strong', file.name), node('p', `已复制到：${file.path}`, 'footnote'), node('p', `SHA256：${file.sha256}`, 'footnote'));
    row.append(node('span', file.name.split('.').at(-1).toUpperCase(), 'file-type'), detail); $('results').append(row);
  }
  if (!names.length && !exports.length) $('results').append(node('div', '尚无实际产物。完成后可在此下载并复核。'));
  $('verification').hidden = !job?.verification;
  $('verification').textContent = job?.verification?.limitation || '';
}
async function refresh() {
  try {
    if (!state.token) { const boot = await request('/bootstrap'); state.token = boot.token; state.owner = boot.sessionId; }
    const [status, work] = await Promise.all([api('/status'), api('/work/status')]);
    state.activeOwner = status.lingboConnected ? status.activeLingboSessionId || '' : ''; state.jobs = work.jobs; state.online = true;
    $('voice-title').textContent = status.lingboConnected ? '桌面角色已连接' : '桌面角色尚未连接';
    $('voice-detail').textContent = status.lingboConnected ? '开启角色麦克风，即可边聊边工作' : '可以先完成资料任务，语音需启动桌面角色';
    if (!state.selected) { const saved = sessionStorage.getItem('lingbo-workspace-task'); if (state.jobs.some(j => j.id === saved)) { state.selected = saved; state.compose = false; } }
    if (state.pending) { const found = state.jobs.find(j => j.sessionId === state.pending.owner && j.requestId === state.pending.requestId); if (found) { clearPending(); select(found); notice('任务已接收，已恢复上次提交结果。'); } }
    render();
  } catch (error) { state.online = false; state.token = ''; render(); $('connection-label').title = error.message; }
}
function clearPending() { state.pending = null; sessionStorage.removeItem('lingbo-workspace-pending'); }
async function operation(fn) {
  if (state.busy || !state.online) return;
  state.busy = true; render();
  try { await fn(); } catch (error) { notice(error.message); }
  finally { state.busy = false; await refresh(); renderFiles(); render(); }
}
async function approve(data, owner, binding) {
  if (binding !== approvalBinding) return notice('确认内容已变化，请先查看当前动作。');
  await operation(async () => { const { task } = await api('/work/approve', { owner, data }); replaceTask(task); notice(data.approved ? '已确认当前这一项动作。' : '已拒绝这一项动作，请检查任务状态。'); });
}
async function control(action, extra = {}, target = current()) {
  if (!target) return;
  const data = { taskId: target.id, action, version: target.version, ...extra };
  await operation(async () => { const { task } = await api('/work/control', { owner: target.sessionId, data }); replaceTask(task); notice(action === 'pause' ? '已请求安全暂停，当前动作结束后会更新状态。' : action === 'cancel' ? '已请求取消；此前完成的操作会保留。' : action === 'modify' ? '新要求已保存，检查后点击“继续执行”。' : '已请求继续执行，以下方实际状态为准；原有权限不会自动改变。'); });
}
async function openSource(job, source) {
  try {
    const result = await api(`/work/source/${job.id}/${source.source}`, { owner: job.sessionId });
    $('source-dialog-title').textContent = `${source.source} · ${source.name}`; $('source-dialog-meta').textContent = `资料快照 · SHA256 ${result.snapshotSha256}`; $('source-dialog-text').textContent = result.text; $('source-dialog').showModal();
  } catch (error) { notice(error.message); }
}
async function download(job, name, button) {
  button.disabled = true;
  try {
    const response = await api(`/work/artifact/${job.id}/${encodeURIComponent(name)}`, { owner: job.sessionId, raw: true }); const blob = await response.blob(); const url = URL.createObjectURL(blob);
    const link = node('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { notice(error.message); } finally { button.disabled = !state.online; }
}
async function previewArtifact(job, name) {
  try {
    const response = await api(`/work/artifact/${job.id}/${encodeURIComponent(name)}`, { owner: job.sessionId, raw: true });
    const blob = await response.blob(); if (blob.size > 1024 * 1024) throw new Error('文件较大，请下载后查看。');
    $('source-dialog-title').textContent = fileName(name); $('source-dialog-meta').textContent = '实际产物正文 · 请结合资料来源复核；执行完成不保证语义正确。'; $('source-dialog-text').textContent = await blob.text(); $('source-dialog').showModal();
  } catch (error) { notice(error.message); }
}
$('files').onchange = () => {
  const next = [...state.files, ...$('files').files]; $('files').value = '';
  if (next.length > 20 || next.reduce((n,f) => n + f.size, 0) > 20 * 1024 * 1024) return notice('请选择最多 20 份资料，合计不超过 20 MB。');
  if (next.some(f => !/\.(txt|md|docx|pdf)$/i.test(f.name))) return notice('当前支持 TXT、Markdown、Word 和文字型 PDF。');
  state.files = next; notice(); renderFiles(); render();
};
$('requirements').oninput = render;
$('compose').onsubmit = async event => {
  event.preventDefault(); if (!state.pending && (!state.files.length || !$('requirements').value.trim())) return;
  await operation(async () => {
    if (!state.pending) {
      const submitOwner = state.activeOwner || state.owner;
      const data = new FormData(); for (const file of state.files) { data.append('files', file); data.append('names', file.name); }
      const bundle = await api('/sources/import', { data, timeout: 120000 });
      state.pending = { requestId: crypto.randomUUID(), owner: submitOwner, data: { sourceId: bundle.id, request: reportRequest($('requirements').value, $('japanese').checked), rootIds: [], skillIds: [], acceptance: [{ path: '资料分析报告.docx' }, { path: '资料分析摘要.md' }] } };
      sessionStorage.setItem('lingbo-workspace-pending', JSON.stringify(state.pending));
    }
    const pending = state.pending;
    const { task } = await api('/work/submit', { data: pending.data, owner: pending.owner, requestId: pending.requestId, timeout: 15000 });
    clearPending(); state.files = []; replaceTask(task); notice('任务已开始。你可以继续对话，或在这里查看进展。');
  });
};
$('pause').onclick = () => control('pause'); $('resume').onclick = () => control('resume', { reviewed: $('reviewed').checked });
$('reviewed').onchange = render; $('all-tasks').onchange = render;
$('new-task').onclick = () => { state.compose = true; sessionStorage.removeItem('lingbo-workspace-task'); notice(); render(); };
$('modify').onclick = () => { const job = current(); if (job?.status !== 'paused') return; modification = structuredClone(job); $('new-requirements').value = job.request; $('modify-error').textContent = ''; $('modify-dialog').showModal(); };
$('modify-form').onsubmit = async event => { event.preventDefault(); const text = $('new-requirements').value.trim(); if (!text) return; $('modify-dialog').close(); await control('modify', { request: text }, modification); };
$('cancel').onclick = () => { cancellation = structuredClone(current()); $('confirm-title').textContent = '取消当前任务？'; $('confirm-text').textContent = '将停止后续执行，已完成的文件操作和产物会保留。取消后不能继续这个任务，请先确认不再需要执行。'; $('confirm-dialog').showModal(); };
$('confirm-no').onclick = () => $('confirm-dialog').close(); $('confirm-yes').onclick = async () => { $('confirm-dialog').close(); await control('cancel', {}, cancellation); };
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => $(button.dataset.close).close();
try { state.pending = JSON.parse(sessionStorage.getItem('lingbo-workspace-pending') || 'null'); } catch { sessionStorage.removeItem('lingbo-workspace-pending'); }
renderFiles(); await refresh();
// No overlapping polling requests or synthetic progress. Lost connections retain
// explicitly labelled last-known evidence and disable every execution action.
async function poll() { await refresh(); setTimeout(poll, 2500); }
setTimeout(poll, 2500);
