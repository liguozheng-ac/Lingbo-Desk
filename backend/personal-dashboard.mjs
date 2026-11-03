const el = id => document.getElementById(id);
export function personalPanel(api) {
  let state;
  let resourceFiles = [];
  const message = (id, text) => { el(id).textContent = text; };
  async function refresh() {
    state = await api('/personal');
    const selectedMemory = el('memory-select').value, selectedSkill = el('skill-select').value;
    el('model-choice').replaceChildren(...state.profiles.map(p => new Option(p.name, p.id)));
    el('model-choice').value = state.model;
    message('model-current', '当前模型：' + state.profiles.find(p => p.id === state.model).name);
    el('memory-select').replaceChildren(new Option('新增记忆', ''), ...state.memories.map(m => new Option(m.title, m.id)));
    el('memory-select').value = state.memories.some(m => m.id === selectedMemory) ? selectedMemory : '';
    el('skill-select').replaceChildren(new Option('新增技能', ''), ...state.skills.map(s => new Option(`${s.enabled ? '已启用' : '已禁用'} · ${s.name || s.id}${s.changed ? '（文件已更新）' : ''}${s.error ? '（格式错误）' : ''}`, s.id)));
    el('skill-select').value = state.skills.some(s => s.id === selectedSkill) ? selectedSkill : '';
    const reportSelected = [...el('report-skills').selectedOptions].map(o => o.value);
    el('report-skills').replaceChildren(...state.skills.filter(s => s.enabled && ['report', 'both'].includes(s.scope)).map(s => new Option(s.name, s.id, false, reportSelected.includes(s.id))));
    message('memory-count', `已保存 ${state.memories.length} 条。只保存明确提交的内容，不自动提取聊天。`);
  }
  async function action(button, status, fn) {
    button.disabled = true;
    try { await fn(); await refresh(); } catch (error) { message(status, error.message); }
    finally { button.disabled = false; }
  }
  el('model-probe').addEventListener('click', e => action(e.target, 'model-state', async () => {
    message('model-state', '正在检查，首次加载本地模型可能较慢…');
    const result = await api('/personal/model/probe', { id: el('model-choice').value }, { timeout: 190000 });
    message('model-state', `连接通过：${result.model} · ${Math.round(result.elapsedMs / 100) / 10} 秒。本次未切换。`);
  }));
  el('model-select').addEventListener('click', e => action(e.target, 'model-state', async () => {
    message('model-state', '正在验证并切换…');
    const result = await api('/personal/model/select', { id: el('model-choice').value, revision: state.revision }, { timeout: 190000 });
    message('model-state', `已切换为 ${result.model}，聊天与新报告共用此选择。`);
  }));
  el('memory-select').addEventListener('change', () => {
    const item = state.memories.find(m => m.id === el('memory-select').value);
    el('memory-title').value = item?.title || ''; el('memory-text').value = item?.text || '';
  });
  el('memory-save').addEventListener('click', e => action(e.target, 'memory-state', async () => {
    const id = el('memory-select').value;
    await api('/personal/memory', { action: id ? 'update' : 'add', id, title: el('memory-title').value, text: el('memory-text').value, revision: state.revision });
    message('memory-state', '记忆已保存，之后的新请求会引用。');
  }));
  el('memory-delete').addEventListener('click', e => action(e.target, 'memory-state', async () => {
    const id = el('memory-select').value; if (!id) throw new Error('请先选择一条记忆');
    await api('/personal/memory', { action: 'delete', id, revision: state.revision });
    el('memory-title').value = ''; el('memory-text').value = '';
    message('memory-state', '已删除；历史聊天和已经创建的任务记录仍保留。');
  }));
  el('skill-select').addEventListener('change', () => {
    const skill = state.skills.find(s => s.id === el('skill-select').value);
    el('skill-id').value = skill?.id || ''; el('skill-text').value = skill?.raw || '';
    resourceFiles = skill?.files || [];
    message('skill-state', skill?.error || skill?.description || '填写新技能编号和 SKILL.md 内容。');
  });
  el('skill-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 16000) return message('skill-state', 'SKILL.md 最多 16 KB');
    el('skill-text').value = await file.text(); message('skill-state', '已读取文件，请检查内容后保存。');
  });
  el('skill-import').addEventListener('click', e => action(e.target, 'skill-state', async () => {
    await api('/personal/skills/import', { id: el('skill-id').value.trim(), raw: el('skill-text').value, files: resourceFiles, revision: state.revision });
    message('skill-state', '已保存并禁用。阅读确认后，可以启用；更新不会执行脚本。');
  }));
  el('skill-bundle').addEventListener('change', async e => {
    try {
      const files = [...e.target.files], main = files.find(f => f.webkitRelativePath.split('/').slice(1).join('/') === 'SKILL.md');
      if (!main || main.size > 16000) throw new Error('文件夹根目录须有不超过 16 KB 的 SKILL.md');
      const resources = files.filter(f => /^(scripts|references|assets)\//.test(f.webkitRelativePath.split('/').slice(1).join('/')));
      if (resources.length > 20 || resources.some(f => f.size > 64000)) throw new Error('最多 20 个文字资源，每个 64 KB');
      resourceFiles = await Promise.all(resources.map(async f => ({ name: f.webkitRelativePath.split('/').slice(1).join('/'), content: await f.text() })));
      el('skill-text').value = await main.text();
      message('skill-state', `已读取 SKILL.md 和 ${resourceFiles.length} 个资源，请填写编号并审阅后保存。脚本不会自动运行。`);
    } catch (error) { resourceFiles = []; message('skill-state', error.message); }
  });
  for (const [id, enabled] of [['skill-enable', true], ['skill-disable', false]]) el(id).addEventListener('click', e => action(e.target, 'skill-state', async () => {
    const skill = state.skills.find(s => s.id === el('skill-id').value.trim());
    if (!skill || skill.error) throw new Error('请先保存并选择有效技能');
    if (el('skill-text').value !== skill.raw) throw new Error('编辑内容尚未保存，请先保存更新');
    await api('/personal/skills/toggle', { id: skill.id, enabled, sha256: skill.sha256, revision: state.revision });
    message('skill-state', enabled ? `已启用。聊天可说“使用技能：${skill.id} 你的要求”；报告请在技能列表选择。` : '已禁用，不再用于新请求。');
  }));
  el('personal-refresh').addEventListener('click', () => refresh().catch(error => message('skill-state', error.message)));
  return { refresh, reportSkillIds: () => [...el('report-skills').selectedOptions].map(o => o.value) };
}
