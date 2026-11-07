import { app, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startStaticRenderer } from './static-renderer.mjs';
import { packageSettings, gatewayEnvironment } from './package-settings.mjs';

const settings = packageSettings(process.resourcesPath, process.env, { testRelease: app.getVersion().includes('-test') });
fs.mkdirSync(settings.local, { recursive: true });
process.env.APP_USER_DATA_PATH = path.join(settings.local, 'character-profile');
fs.mkdirSync(process.env.APP_USER_DATA_PATH, { recursive: true });
app.setPath('userData', process.env.APP_USER_DATA_PATH);
process.env.ELECTRON_RENDERER_URL = settings.rendererOrigin;
process.env.APP_REMOTE_DEBUG_NO_OPEN = 'true';

if (!app.requestSingleInstanceLock()) app.exit(0);
else {
  const program = path.dirname(fileURLToPath(import.meta.url));
  const { startManagedProcess } = await import(pathToFileURL(path.join(settings.service, 'runtime/worker-process.mjs')));
  const { workerEnvironment } = await import(pathToFileURL(path.join(settings.service, 'runtime/worker-environment.mjs')));
  const { DiagnosticLog } = await import(pathToFileURL(path.join(settings.service, 'runtime/diagnostic-log.mjs')));
  // Retention's active-file tracking is process-local. Keep Electron's logs
  // separate from the gateway process so neither prunes the other's active log.
  const launcherDiagnostics = path.join(settings.diagnostics, 'launcher');
  const diagnostics = new DiagnosticLog(launcherDiagnostics);
  let backend, staticServer, setupWindow, quitting = false, exitReady = false, restarts = 0, restartTimer, cleanup;
  const log = (type, data = {}) => diagnostics.append({ type, data });
  const activeMainContents = new WeakSet();
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-finish-load', () => {
      if (contents.isDestroyed() || activeMainContents.has(contents)) return;
      let url; try { url = new URL(contents.getURL()); } catch { return; }
      if (url.origin !== settings.rendererOrigin || url.searchParams.get('synced-leader') !== 'true' || url.searchParams.get('fullscreen-host') !== 'main-window') return;
      contents.setBackgroundThrottling(false); activeMainContents.add(contents);
    });
  });
  async function available(port) {
    const probe = net.createServer();
    await new Promise((resolve, reject) => { probe.once('error', () => reject(new Error(`本机端口 ${port} 已被占用。请退出另一实例，或配置独立测试端口。`))); probe.listen(port, '127.0.0.1', resolve); });
    await new Promise(resolve => probe.close(resolve));
  }
  async function launchBackend() {
    if (quitting) return;
    backend = startManagedProcess(settings.node, ['--env-file-if-exists=' + settings.envFile, settings.entry], {
      cwd: path.join(settings.service, 'backend'), diagnosticsDirectory: launcherDiagnostics,
      env: gatewayEnvironment(settings, workerEnvironment()), shutdownMs: 25000,
    });
    const running = backend;
    running.done.then(() => {
      if (!quitting && backend === running && restarts++ < 3) restartTimer = setTimeout(() => { if (!quitting) void launchBackend(); }, Math.min(9000, 1000 * 3 ** (restarts - 1)));
    });
  }
  function closeResources() {
    if (cleanup) return cleanup;
    quitting = true; clearTimeout(restartTimer);
    cleanup = (async () => {
      let failed = false;
      try { const exit = await backend?.stop(); if (exit && (exit.error || exit.code !== 0)) failed = true; } catch { failed = true; }
      if (staticServer) { staticServer.closeAllConnections(); await new Promise(resolve => staticServer.close(resolve)); }
      log('gateway.closed', { ok: !failed }); diagnostics.close();
      if (failed) throw new Error('后端进程未能确认关闭，请检查诊断记录。');
    })();
    return cleanup;
  }
  app.on('before-quit', event => {
    if (exitReady) return;
    event.preventDefault();
    void closeResources().then(() => { exitReady = true; app.quit(); }, () => { exitReady = true; app.exit(1); });
  });
  // Only the owning smoke process can request a graceful app exit over its IPC.
  if (process.send) process.on('message', message => { if (message?.command === 'shutdown') app.quit(); });
  try {
    for (const file of [settings.node, settings.python, settings.entry]) if (!fs.existsSync(file)) throw new Error('测试包缺少必要运行文件，请重新生成测试包。');
    await available(settings.gatewayPort); await available(settings.rendererPort);
    await launchBackend();
    const deadline = Date.now() + 30000; let ready = false;
    while (Date.now() < deadline && !quitting) {
      try {
        const token = fs.readFileSync(path.join(settings.local, 'gateway-token'), 'utf8').trim();
        const response = await fetch(settings.gatewayOrigin + '/status', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(1000) });
        const value = await response.json(); if (response.ok && value.pid === backend?.child.pid) { ready = true; break; }
      } catch {}
      if (backend?.closed) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error('后端未能启动，请检查诊断记录。缺少 API 密钥不会阻止配置界面启动。');
    const mapping = path.join(settings.local, 'profile-migration.json');
    staticServer = await startStaticRenderer(path.join(program, 'out/bundle/renderer'), settings.rendererPort, { migration: fs.existsSync(mapping) ? JSON.parse(fs.readFileSync(mapping, 'utf8')) : null, runtime: { gatewayOrigin: settings.gatewayOrigin } });
    log('gateway.started');
    await import('./out/launcher/index.mjs');
    const startup = await fetch(settings.gatewayOrigin + '/status', { headers: { Authorization: 'Bearer ' + fs.readFileSync(path.join(settings.local, 'gateway-token'), 'utf8').trim() }, signal: AbortSignal.timeout(3000) }).then(r => r.json());
    if (startup.configurationRequired) {
      // Electron emits ready after the entry module's top-level await finishes.
      // Awaiting whenReady here would deadlock both the setup and character windows.
      void app.whenReady().then(async () => {
        if (quitting) return;
        setupWindow = new BrowserWindow({ title: '聆泊 · 首次配置', width: 1000, height: 800, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
        setupWindow.on('closed', () => { setupWindow = null; });
        setupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        setupWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== settings.gatewayOrigin) event.preventDefault(); });
        await setupWindow.loadURL(settings.gatewayOrigin + '/#services');
      }).catch(() => log('setup.window_failed'));
    }
  } catch (error) {
    await closeResources().catch(() => {}); exitReady = true;
    await app.whenReady(); dialog.showErrorBox('Lingbo Desk 启动失败', error.message); app.exit(1);
  }
}
