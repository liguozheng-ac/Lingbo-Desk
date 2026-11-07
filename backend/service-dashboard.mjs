const el = id => document.getElementById(id);
export function servicePanel(api) {
  let state, busy = false;
  const fields = ['deepseekKey', 'asrKey', 'ttsKey'];
  const names = { deepseekKey: 'DeepSeek', asrKey: '阿里云 ASR', ttsKey: '豆包 TTS' };
  async function refresh() {
    state = await api('/settings/services');
    for (const name of fields) {
      const service = state.services[name];
      el('service-' + name + '-state').textContent = service.configured ? `${names[name]} 已配置 · ${service.source === 'encrypted' ? 'Windows 加密存储' : '环境变量或旧配置'}` : `${names[name]} 未配置`;
    }
    el('services-save').disabled = !state.canSave;
    el('services-storage').textContent = state.warning || '新提交的密钥用当前 Windows 用户的 DPAPI 加密保存；不会回显。旧环境变量或文件不会自动删除。';
  }
  el('services-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !state) return;
    busy = true; el('services-save').disabled = true;
    try {
      const values = Object.fromEntries(fields.map(name => [name, el('service-' + name).value]));
      const clear = fields.filter(name => el('service-' + name + '-clear').checked);
      await api('/settings/services', { revision: state.revision, values, clear }, { timeout: 25000 });
      for (const name of fields) { el('service-' + name).value = ''; el('service-' + name + '-clear').checked = false; }
      el('services-result').textContent = '服务配置已加密保存并生效。可分别检查连接；模型切换在下方完成。';
    } catch (error) { el('services-result').textContent = error.message; }
    finally { busy = false; await refresh(); }
  });
  for (const button of document.querySelectorAll('[data-service-probe]')) button.addEventListener('click', async () => {
    if (busy) return; busy = true; button.disabled = true;
    try {
      if (fields.some(name => el('service-' + name).value || el('service-' + name + '-clear').checked)) throw new Error('请先保存填写的配置，再检查连接。');
      el('services-result').textContent = '正在检查连接；本地模型首次加载可能较慢…';
      const result = await api('/settings/services/probe', { id: button.dataset.serviceProbe }, { timeout: 190000 });
      el('services-result').textContent = `检查通过 · ${(result.elapsedMs / 1000).toFixed(1)} 秒 · ${result.scope}`;
    } catch (error) { el('services-result').textContent = error.message; }
    finally { busy = false; button.disabled = false; }
  });
  return { refresh };
}
