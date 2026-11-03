import { request } from './client-api.mjs';
const el = id => document.getElementById(id);
const labels = { starting: '准备中', running: '运行中', awaiting_approval: '等待你确认', pause_requested: '正在安全暂停', paused: '已暂停', cancel_requested: '正在取消', cancelled: '已取消', interrupted: '已中断，需核对', completed: '已结束', failed: '未完成' };
export function workPanel(api, activeSession) {
  let state, selected, polling = false;
  const message = value => { el('work-message').textContent = value; };
  async function refresh() {
    if (polling) return; polling = true;
    try {
      state = await api('/work/status'); const previous = el('work-select').value;
      el('work-select').replaceChildren(...state.jobs.map(j => new Option(`${labels[j.status]} · ${j.request.slice(0, 35)}`, j.id)));
      el('work-select').value = state.jobs.some(j => j.id === previous) ? previous : state.jobs.at(-1)?.id || '';
      const chosen = [...el('work-roots').selectedOptions].map(o => o.value);
      el('work-roots').replaceChildren(...state.permissions.roots.map(r => new Option(`${r.mode === 'write' ? '读写' : '只读'} · ${r.path}`, r.id, false, chosen.includes(r.id))));
      const personal = await api('/personal'), skillSelected = [...el('work-skills').selectedOptions].map(o => o.value);
      el('work-skills').replaceChildren(...personal.skills.filter(s => s.enabled && ['work', 'both'].includes(s.scope)).map(s => new Option(s.name, s.id, false, skillSelected.includes(s.id))));
      el('work-permissions').replaceChildren(...state.permissions.roots.map(r => {
        const row = document.createElement('p'); row.textContent = `${r.mode === 'write' ? '读写' : '只读'}：${r.path} `;
        const button = document.createElement('button'); button.textContent = '撤销'; button.onclick = () => act(async () => { await api('/work/permissions', { action: 'revoke', id: r.id, revision: state.permissions.revision }); message('已撤销，后续工具调用立即重新检查权限。'); }); row.append(button); return row;
      }));
      render();
    } catch (error) { message(error.message); }
    finally { polling = false; }
  }
  function render() {
    selected = state?.jobs.find(j => j.id === el('work-select').value);
    el('work-state').textContent = selected ? `${labels[selected.status]} · 版本 ${selected.version} · 执行 ${selected.attempts} 次\n${selected.request}\n产物文件夹：${selected.output}\n${selected.error || ''}\n${selected.result || ''}` : '暂无工作任务。可在此输入，或直接对 Hiyori 说出工作要求。';
    el('work-receipts').textContent = selected ? JSON.stringify(selected.receipts, null, 2) : '';
    el('work-approval').textContent = selected?.approval ? JSON.stringify(selected.approval, null, 2) : '暂无待确认动作。';
    for (const id of ['work-approve', 'work-reject']) el(id).disabled = !selected?.approval;
    el('work-downloads').replaceChildren(...(selected?.artifacts || []).map(name => {
      const button = document.createElement('button'); button.textContent = `下载 ${name}`;
      button.onclick = () => act(async () => { const response = await api(`/work/artifact/${selected.id}/${encodeURIComponent(name)}`, undefined, { owner: selected.sessionId, raw: true }); const url = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }); return button;
    }));
  }
  async function act(fn) { try { await fn(); } catch (error) { message(error.message); } finally { await refresh(); } }
  el('work-select').onchange = () => { el('work-reviewed').checked = false; render(); };
  el('work-grant').onclick = () => act(async () => {
    const directory = el('work-directory').value.trim(), mode = el('work-mode').value;
    if (!window.confirm(`授权 ${mode === 'write' ? '读写' : '只读'}：${directory}\n使用云端模型时，读到的正文会发送给该服务。语音新任务可使用已授权文件夹。是否继续？`)) return;
    await api('/work/permissions', { action: 'grant', directory, mode, revision: state.permissions.revision }); message('已授权指定文件夹。');
  });
  el('work-submit').onclick = () => act(async () => {
    const result = await api('/work/submit', { request: el('work-request').value, rootIds: [...el('work-roots').selectedOptions].map(o => o.value), skillIds: [...el('work-skills').selectedOptions].map(o => o.value) }, { owner: activeSession(), requestId: crypto.randomUUID() });
    el('work-select').add(new Option(result.task.id, result.task.id)); el('work-select').value = result.task.id; message(result.content);
  });
  for (const action of ['progress', 'pause', 'resume', 'cancel', 'modify']) el('work-' + action).onclick = () => act(async () => {
    if (!selected) throw new Error('请先选择工作任务');
    await api('/work/control', { taskId: selected.id, action, version: selected.version, ...(action === 'modify' ? { request: el('work-request').value } : {}), ...(action === 'resume' ? { reviewed: el('work-reviewed').checked } : {}) }, { owner: selected.sessionId }); message('任务状态已更新。');
  });
  for (const [id, approved] of [['work-approve', true], ['work-reject', false]]) el(id).onclick = () => act(async () => {
    if (!selected?.approval) throw new Error('没有待确认动作');
    await api('/work/approve', { taskId: selected.id, approvalId: selected.approval.id, version: selected.version, approved }, { owner: selected.sessionId }); message(approved ? '已确认这一项具体动作。' : '已拒绝这一项动作。');
  });
  setInterval(refresh, 5000);
  return { refresh };
}
