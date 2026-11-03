import { app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { startStaticRenderer } from './static-renderer.mjs';

if (!app.requestSingleInstanceLock()) app.exit(0);
else {
  const program = path.dirname(fileURLToPath(import.meta.url));
  const workspace = process.env.VOICE_AGENT_WORKSPACE || path.join(process.env.LOCALAPPDATA, 'LingboDesk');
  const local = path.join(workspace, '.local');
  let child, staticServer, quitting = false, restarts = 0;
  fs.mkdirSync(local, { recursive: true });
  const output = fs.openSync(path.join(local, 'packaged-backend.log'), 'a');
  const log = text => fs.appendFileSync(path.join(local, 'packaged-launcher.log'), new Date().toISOString() + ' ' + text + '\n');
  // Chromium can reduce a background page's timer cadence to roughly a minute.
  // Only the main character page owns continuous speech and bridge heartbeats.
  // Match the actual WebContents URL, including embedded WebContentsViews.
  const activeMainContents = new WeakSet();
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-finish-load', () => {
      if (contents.isDestroyed() || activeMainContents.has(contents)) return;
      let url;
      try { url = new URL(contents.getURL()); } catch { return; }
      if (url.origin !== 'http://localhost:5173' || url.searchParams.get('synced-leader') !== 'true' || url.searchParams.get('fullscreen-host') !== 'main-window') return;
      contents.setBackgroundThrottling(false);
      activeMainContents.add(contents);
      log('main renderer background timing enabled: webContents ' + contents.id);
    });
  });
  process.env.APP_USER_DATA_PATH = path.join(local, 'character-profile');
  process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
  process.env.APP_REMOTE_DEBUG_NO_OPEN = 'true';
  // Keep the existing storage origin, using a read-only static server rather
  // than Vite. Ergosphere disables its upstream updater on this private URL.
  const backend = path.join(process.resourcesPath, 'backend');
  async function launchBackend() {
    child = spawn(path.join(process.resourcesPath, 'node-runtime', 'node.exe'), [path.join(backend, 'lingbo-desktop', 'server.mjs')], {
      cwd: path.join(backend, 'lingbo-desktop'), windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, PSModulePath: path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'), VOICE_AGENT_WORKSPACE: workspace, VOICE_PYTHON: path.join(process.resourcesPath, 'python', 'python.exe'), VOICE_POWERSHELL: path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') },
      stdio: ['ignore', output, output],
    });
    child.on('error', error => log('backend spawn failed: ' + error.code));
    child.on('exit', code => {
      log('backend exit: ' + code);
      if (!quitting && restarts++ < 3) setTimeout(() => { if (!quitting) void launchBackend(); }, Math.min(9000, 1000 * 3 ** (restarts - 1)));
    });
  }
  app.on('before-quit', () => { quitting = true; child?.kill(); staticServer?.close(); });
  try {
    if (await fetch('http://127.0.0.1:3850/bootstrap', { signal: AbortSignal.timeout(1500) }).then(() => true).catch(() => false)) throw new Error('3850 端口已有服务运行。请先结束开发版，再启动安装版。');
    const migration = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'migration-source.json'), 'utf8'));
    if (!fs.existsSync(path.join(local, 'migration-complete.json'))) {
      // Never overwrite an existing personal data directory. Copy only data,
      // no downloaded installers, source, credentials, or package artifacts.
      for (const name of ['gateway-token', 'settings.json', 'personal.json', 'tasks', 'sources', 'skills', 'work-tasks', 'work-backups', 'work-permissions.json', 'profile-migration.json', 'character-profile']) {
        const source = path.join(migration.workspace, '.local', migration.profileDirectory && name === 'character-profile' ? migration.profileDirectory : name), target = path.join(local, name);
        if (fs.existsSync(source) && !fs.existsSync(target)) fs.cpSync(source, target, { recursive: true, dereference: false, filter: p => !['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lock', 'store.lock'].includes(path.basename(p)) });
      }
      if (fs.existsSync(path.join(migration.workspace, 'runs')) && !fs.existsSync(path.join(workspace, 'runs'))) fs.cpSync(path.join(migration.workspace, 'runs'), path.join(workspace, 'runs'), { recursive: true });
      fs.writeFileSync(path.join(local, 'migration-complete.json'), JSON.stringify({ at: new Date().toISOString(), source: migration.workspace }));
    }
    await launchBackend();
    const deadline = Date.now() + 30000; let ready = false;
    while (Date.now() < deadline) {
      try { const response = await fetch('http://127.0.0.1:3850/bootstrap', { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!ready) throw new Error('后端启动失败，请查看 ' + path.join(local, 'packaged-backend.log'));
    const profileMigration = path.join(local, 'profile-migration.json');
    staticServer = await startStaticRenderer(path.join(program, 'out', 'bundle', 'renderer'), 5173, { migration: fs.existsSync(profileMigration) ? JSON.parse(fs.readFileSync(profileMigration, 'utf8')) : null });
    log('gateway and static renderer ready');
    await import('./out/launcher/index.mjs');
  } catch (error) {
    quitting = true; child?.kill(); staticServer?.close(); log(error.message);
    await app.whenReady(); dialog.showErrorBox('Lingbo Desk 启动失败', error.message); app.exit(1);
  }
}
