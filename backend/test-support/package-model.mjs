import http from 'node:http';
// A local Ollama-compatible fixture. It has no provider keys and contacts no service.
export async function packageModelFixture() {
  let requests = 0, pending = 0, offline = false, denied = 0, releaseWaits = false;
  const server = http.createServer(async (req, res) => {
    if (offline) { denied++; req.socket.destroy(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const value = JSON.parse(raw || '{}'); requests++;
    if (!value.stream) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const emit = delta => res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
    const text = JSON.stringify(value.messages || []);
    if (text.includes('PACKAGE_WAIT') && !releaseWaits) { pending++; emit({ role: 'assistant' }); res.once('close', () => { pending--; }); return; }
    const calls = (value.messages || []).flatMap(m => (m.tool_calls || []).map(t => ({ name: t.function?.name, args: (() => { try { return JSON.parse(t.function?.arguments || '{}'); } catch { return {}; } })() })));
    const used = (name, file) => calls.some(c => c.name === name && c.args.path === file);
    let action;
    if ((value.tools || []).some(t => t.function?.name.startsWith('work_'))) {
      const file = text.includes('PACKAGE_OFFICE') ? 'proof.docx' : text.includes('resumed.md') ? 'resumed.md' : 'proof.md';
      const office = file.endsWith('.docx'), tool = office ? 'work_office' : 'work_write';
      if (!used(tool, file) && (value.tools || []).some(t => t.function?.name === tool)) action = { name: tool, arguments: JSON.stringify(office ? { operation: 'create_docx', path: file, content: '# Package Office proof\nActual packaged Python produced this document.' } : { path: file, content: '# Package work proof\nActual packaged worker and tool executor.' }) };
      else if (!calls.some(c => c.name === 'work_finish')) action = { name: 'work_finish', arguments: JSON.stringify({ outcome: 'complete', summary: 'Produced the requested isolated proof file.' }) };
    } else if ((value.tools || []).some(t => t.function?.name === 'read_file')) {
      const recipe = text.includes('创建全新文件 report.md')
        ? [['read_file', { path: 'extract.md' }], ['write_file', { path: 'report.md', content: '# 产品定位\n桌面语音助手。\n## 核心需求\n语音与后台工作。\n## 后续验证\nPackage report proof.' }]]
        : [['read_file', { path: 'source-a.md' }], ['read_file', { path: 'source-b.md' }], ['write_file', { path: 'extract.md', content: '# 提取\nWindows 桌面语音助手，支持后台任务。' }]];
      const next = recipe.find(([name, args]) => !used(name, args.path));
      if (next) action = { name: next[0], arguments: JSON.stringify(next[1]) };
    }
    emit(action ? { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-' + requests, type: 'function', function: action }] } : { role: 'assistant', content: 'Verified.' });
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: action ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n'); res.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(11434, '127.0.0.1', resolve); });
  return { server, get requests() { return requests; }, get pending() { return pending; }, get denied() { return denied; },
    setOffline(value) { offline = !!value; }, releaseWaitingRequests() { releaseWaits = true; },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
