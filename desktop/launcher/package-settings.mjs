import path from 'node:path';
export function packageSettings(resources, env = process.env, { testRelease = false } = {}) {
  const port = (value, fallback) => { const n = Number(value || fallback); if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error('本机端口须在 1024—65535 之间'); return n; };
  const workspace = path.resolve(env.VOICE_AGENT_WORKSPACE || path.join(env.LOCALAPPDATA, testRelease ? 'LingboDesk-Test' : 'LingboDesk'));
  const gatewayPort = port(env.LINGBO_GATEWAY_PORT, testRelease ? 39850 : 3850), rendererPort = port(env.LINGBO_RENDERER_PORT, testRelease ? 39851 : 5173);
  if (gatewayPort === rendererPort) throw new Error('后端与角色窗口不能使用相同端口');
  const local = path.join(workspace, '.local');
  return { workspace, local, gatewayPort, rendererPort, gatewayOrigin: 'http://127.0.0.1:' + gatewayPort, rendererOrigin: 'http://localhost:' + rendererPort,
    envFile: path.join(local, '.env'), node: path.join(resources, 'node-runtime', 'node.exe'), python: path.join(resources, 'python', 'python.exe'),
    service: path.join(resources, 'service'), entry: path.join(resources, 'service', 'backend', 'server.mjs'), diagnostics: path.join(local, 'diagnostics') };
}
export function gatewayEnvironment(settings, base, parent = process.env) {
  const env = { ...base };
  // Cloud credentials belong to this gateway alone, never to worker environments.
  for (const key of ['DEEPSEEK_API_KEY', 'ALIYUN_ASR_API_KEY', 'DOUBAO_TTS_API_KEY', 'LINGBO_SPEECH_CONFIG']) if (parent[key]) env[key] = parent[key];
  return { ...env, VOICE_AGENT_WORKSPACE: settings.workspace, VOICE_PYTHON: settings.python, LINGBO_GATEWAY_PORT: String(settings.gatewayPort), LINGBO_RENDERER_ORIGIN: settings.rendererOrigin, LINGBO_DIAGNOSTICS_METADATA_ONLY: '1' };
}
