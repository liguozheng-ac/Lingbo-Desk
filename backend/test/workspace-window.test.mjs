import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWorkspaceWindow } from '../../desktop/launcher/workspace-window.mjs';

function fixture({ fail = false } = {}) {
  const windows = []; let loads = 0, quits = 0, characterShows = 0, closing = false;
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = fn => { this.popup = fn; }; windows.push(this); }
    setMenu(menu) { this.menu = menu; } isDestroyed() { return !!this.destroyed; } isMinimized() { return !!this.minimized; } restore() { this.minimized = false; } show() { this.shown = true; } focus() { this.focused = true; }
    async loadURL(url) { loads++; this.url = url; await Promise.resolve(); if (fail) throw Error('load failed'); }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const controller = createWorkspaceWindow({ BrowserWindow: Window, Menu: { buildFromTemplate: m => m }, app: { quit: () => quits++ }, origin: 'http://127.0.0.1:39850', version: 'fixture', showCharacter: () => characterShows++, isClosing: () => closing });
  return { controller, windows, counts: () => ({ loads, quits, characterShows }), close: () => { closing = true; } };
}
test('workspace is one native window across simultaneous entry and repeated activation; menu exits entire app', async () => {
  const f = fixture(); const [a,b] = await Promise.all([f.controller.open(),f.controller.open()]); assert.equal(a,b); assert.equal(f.windows.length,1); assert.equal(f.counts().loads,1);
  a.minimized = true; assert.equal(await f.controller.open(),a); assert.equal(a.minimized,false);
  a.menu[0].submenu[0].click(); a.menu[0].submenu[2].click(); assert.equal(f.counts().quits,1); assert.equal(f.counts().characterShows,1);
  a.destroy(); assert.notEqual(await f.controller.open(),a); f.close(); assert.equal(await f.controller.open(),null);
});
test('workspace denies external navigation, new windows and webviews without weakening character microphone permissions', async () => {
  const f = fixture(), w = await f.controller.open(); assert.deepEqual(w.options.webPreferences,{nodeIntegration:false,contextIsolation:true,sandbox:true,webviewTag:false}); assert.equal(w.popup({url:'https://example.com'}).action,'deny');
  for (const event of ['will-navigate','will-redirect']) for (const [url, denied] of [['http://127.0.0.1:39850/',false],['http://127.0.0.1:39851/',true],['https://example.com',true],['file:///C:/private.txt',true],['javascript:alert(1)',true]]) { let prevented = false; w.webContents.emit(event,{preventDefault:()=>{prevented=true;}},url); assert.equal(prevented,denied); }
  let blocked = false; w.webContents.emit('will-attach-webview',{preventDefault:()=>{blocked=true;}}); assert.equal(blocked,true);
});
test('failed window load is cleaned up and can be retried; non-loopback origins are rejected', async () => {
  const f = fixture({fail:true}); await assert.rejects(f.controller.open(),/load failed/); assert.equal(f.windows[0].destroyed,true); await assert.rejects(f.controller.open(),/load failed/); assert.equal(f.windows.length,2);
  for (const origin of ['https://example.com','file:///C:/','http://localhost:3850','http://127.0.0.1:3850/path']) assert.throws(()=>createWorkspaceWindow({origin}),/Invalid/);
});
