// Launcher-owned window: one task workspace per application, sharing the same
// local gateway/session bridge as the character. No Node access in its renderer.
export function createWorkspaceWindow({ BrowserWindow, Menu, app, origin, version, showCharacter, isClosing = () => false }) {
  const gateway = new URL(origin);
  if (gateway.protocol !== 'http:' || gateway.hostname !== '127.0.0.1' || gateway.origin !== origin) throw new Error('Invalid workspace gateway');
  let window, opening;
  const allowed = value => { try { return new URL(value).origin === origin; } catch { return false; } };
  const focus = target => { if (target.isMinimized()) target.restore(); target.show(); target.focus(); };
  return {
    async open() {
      if (isClosing()) return null;
      if (opening) return opening;
      if (window && !window.isDestroyed()) { focus(window); return window; }
      const target = new BrowserWindow({ title: `聆泊 ${version} · 任务工作台`, width: 1240, height: 880, minWidth: 820, minHeight: 600, show: false, backgroundColor: '#f7f6fa', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false } });
      window = target;
      target.on('page-title-updated', e => e.preventDefault());
      target.setMenu(Menu.buildFromTemplate([{ label: '聆泊', submenu: [{ label: '显示角色与语音入口', click: showCharacter }, { type: 'separator' }, { label: '退出聆泊（关闭全部窗口与后台）', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }] }, { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }]));
      target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      for (const event of ['will-navigate', 'will-redirect']) target.webContents.on(event, (e, url) => { if (!allowed(url)) e.preventDefault(); });
      target.webContents.on('will-attach-webview', e => e.preventDefault());
      target.on('closed', () => { if (window === target) window = null; });
      opening = target.loadURL(origin + '/workspace').then(() => { if (!target.isDestroyed() && !isClosing()) focus(target); return target; }).catch(error => { if (!target.isDestroyed()) target.destroy(); throw error; }).finally(() => { opening = null; });
      return opening;
    },
  };
}
