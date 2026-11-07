import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { publicTarget } from './web-reader.mjs';
import { workerEnvironment } from '../runtime/worker-environment.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// A dedicated, empty browser profile. Never attaches to the user's tabs/profile.
export class WorkBrowser {
  constructor(directory, { executable, headless = false } = {}) { this.directory = path.resolve(directory); this.executable = executable; this.headless = headless; this.sessions = new Map(); }
  async start(job) {
    if (this.sessions.has(job.id)) return this.sessions.get(job.id);
    const executable = this.executable || [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean).map(p => path.join(p, 'Microsoft/Edge/Application/msedge.exe')).find(fs.existsSync);
    if (!executable) throw new Error('未找到 Microsoft Edge；可使用公开网页读取工具');
    const profile = path.join(this.directory, job.id, crypto.randomUUID()); fs.mkdirSync(profile, { recursive: true });
    const child = spawn(executable, ['--user-data-dir=' + profile, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-features=msEdgeSidebarV2', ...(this.headless ? ['--headless=new'] : []), 'about:blank'], { windowsHide: true, stdio: 'ignore', env: workerEnvironment() });
    const fail = { error: null }; child.on('error', e => { fail.error = e; });
    let socket;
    try {
      const active = path.join(profile, 'DevToolsActivePort');
      for (let i = 0; i < 300 && !fs.existsSync(active); i++) { job.controller.signal.throwIfAborted(); if (fail.error) throw fail.error; await delay(100); }
      if (!fs.existsSync(active)) throw new Error('独立浏览器启动超时');
      const port = Number(fs.readFileSync(active, 'utf8').split('\n')[0]);
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
      const page = pages.find(p => p.type === 'page'); if (!page) throw new Error('浏览器没有任务页');
      socket = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
      const session = { child, socket, pending: new Map(), sequence: 0, elements: new Map(), snapshot: null, closed: false };
      socket.addEventListener('message', event => {
        const data = JSON.parse(String(event.data));
        if (data.id) { const pending = session.pending.get(data.id); if (pending) { session.pending.delete(data.id); data.error ? pending.reject(new Error(data.error.message)) : pending.resolve(data.result); } }
        if (data.method === 'Fetch.requestPaused') {
          const { requestId, request } = data.params;
          // Also check redirects and subresources; local/file URLs are never allowed.
          (async () => {
            try { await publicTarget(request.url); await this.send(session, 'Fetch.continueRequest', { requestId }); }
            catch { await this.send(session, 'Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
          })();
        }
      });
      socket.addEventListener('close', () => { session.closed = true; for (const pending of session.pending.values()) pending.reject(new Error('浏览器窗口已关闭')); session.pending.clear(); });
      await this.send(session, 'Page.enable'); await this.send(session, 'Fetch.enable', { patterns: [{ urlPattern: '*' }] });
      await this.send(session, 'Page.setDownloadBehavior', { behavior: 'deny' });
      this.sessions.set(job.id, session); return session;
    } catch (error) { socket?.close(); child.kill(); throw error; }
  }
  send(session, method, params = {}) {
    if (session.closed) return Promise.reject(new Error('浏览器已关闭；请重新打开'));
    return new Promise((resolve, reject) => {
      const id = ++session.sequence;
      const timer = setTimeout(() => { session.pending.delete(id); reject(new Error('浏览器操作超时')); }, 15000);
      session.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      session.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(session, expression) {
    const result = await this.send(session, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error('页面结构变化，请重新获取快照'); return result.result.value;
  }
  async snapshot(session) {
    const value = await this.evaluate(session, `(() => { const elements = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"]')].filter(e=>e.getClientRects().length).slice(0,100); window.__hiyoriElements=elements; return {url:location.href,title:document.title,text:document.body.innerText.slice(0,18000),elements:elements.map((e,i)=>({id:String(i),tag:e.tagName,type:e.type||'',label:(e.innerText||e.getAttribute('aria-label')||e.placeholder||e.name||'').slice(0,150),href:e.tagName==='A'?e.href:undefined,html:e.outerHTML}))}; })()`);
    session.elements = new Map(value.elements.map(e => [e.id, e.html]));
    value.elements = value.elements.map(({ html, ...entry }) => entry);
    session.snapshot = { ...value, at: Date.now() }; return value;
  }
  async execute(job, args, confirm, intent) {
    if (args.action === 'close') { await this.close(job); return { closed: true }; }
    const session = await this.start(job); job.controller.signal.throwIfAborted();
    if (args.action === 'open') {
      const { url } = await publicTarget(args.url, { signal: job.controller.signal });
      const navigation = await this.send(session, 'Page.navigate', { url });
      if (navigation.errorText) throw new Error('页面加载失败：' + navigation.errorText);
      for (let i = 0; i < 40; i++) {
        const state = await this.evaluate(session, '({url:location.href,ready:document.readyState})');
        if (state.url !== 'about:blank' && state.ready === 'complete') break;
        job.controller.signal.throwIfAborted(); await delay(250);
      }
      job.controller.signal.throwIfAborted(); return this.snapshot(session);
    }
    if (args.action === 'snapshot') return this.snapshot(session);
    if (!['click', 'fill'].includes(args.action) || !/^\d{1,2}$/.test(args.element || '') || !session.snapshot || Date.now() - session.snapshot.at > 120000) throw new Error('请先获取当前页面快照，再选择有效元素');
    const element = session.snapshot.elements.find(e => e.id === args.element);
    if (!element || ['password', 'file', 'hidden'].includes(element.type)) throw new Error('不支持此元素；密码、验证码、付款和文件上传请用户手动处理');
    if (typeof args.text !== 'undefined' && (typeof args.text !== 'string' || args.text.length > 4000)) throw new Error('填写内容超过限制');
    if (element.href) await publicTarget(element.href, { signal: job.controller.signal });
    const expression = `(() => {const e=window.__hiyoriElements?.[${Number(args.element)}],f=e?.closest('form');return e?{url:location.href,html:e.outerHTML,context:f?.outerHTML||document.body.innerText.slice(0,18000),values:f?[...f.querySelectorAll('input,textarea,select')].filter(n=>!['password','file'].includes(n.type)).map(n=>n.value):[]}:null})()`;
    const original = await this.evaluate(session, expression);
    if (!original || original.url !== session.snapshot.url || original.html !== session.elements.get(args.element)) throw new Error('页面已变化，请重新获取快照');
    await confirm({ tool: 'work_browser', action: args.action, url: original.url, element, text: args.text || '', warning: '点击可能提交、发送或产生费用；请核对页面、按钮及内容。此确认仅授权当前一个动作。' });
    job.controller.signal.throwIfAborted();
    const current = await this.evaluate(session, expression);
    if (JSON.stringify(original) !== JSON.stringify(current)) throw new Error('确认后页面或元素发生变化，动作未执行');
    intent({ tool: 'work_browser', action: args.action, url: original.url, element });
    await this.evaluate(session, `(() => {const e=window.__hiyoriElements[${Number(args.element)}];if(!e?.isConnected)throw Error('stale');${args.action === 'click' ? 'e.click();' : `if(!['INPUT','TEXTAREA'].includes(e.tagName))throw Error('unsupported'); const setter=Object.getOwnPropertyDescriptor(e.tagName==='INPUT'?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,'value').set;setter.call(e,${JSON.stringify(args.text || '')});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));`}return true})()`);
    await delay(300); session.snapshot = null; return { action: args.action, element, dispatched: true, warning: '动作已触发；业务是否成功需要读取新快照核对', page: await this.snapshot(session) };
  }
  async close(job) {
    const session = this.sessions.get(job.id); if (!session) return;
    this.sessions.delete(job.id); try { await this.send(session, 'Page.close'); } catch {} session.socket.close();
    session.child.kill();
  }
}
