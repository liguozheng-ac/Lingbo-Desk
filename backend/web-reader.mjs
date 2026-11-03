import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gunzip, inflate, brotliDecompress } from 'node:zlib';
import { source } from '../runtime/shared.mjs';
import { python } from './source-bundles.mjs';

// This source importer uses HTTP only. It does not restore the removed web_read tool.
const { normalizeWebHttpUrl, assertWebUrlAllowed } = await import(source('src/capabilities/tools/web/url-policy.js'));
const execute = promisify(execFile);
const parser = fileURLToPath(new URL('./web-text.py', import.meta.url));
export const webLimits = Object.freeze({ pages: 5, bytes: 2 * 1024 * 1024, characters: 30000, timeoutMs: 20000, redirects: 3 });

export function webUrls(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > webLimits.pages) throw new Error('请输入 1 至 5 个公开网页链接');
  const urls = input.map(value => {
    if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20]/.test(value)) throw new Error('网页链接无效');
    const url = new URL(normalizeWebHttpUrl(value));
    if (url.port && !['80', '443'].includes(url.port)) throw new Error('网页链接仅支持标准 HTTP/HTTPS 端口');
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('只支持公开网页，不读取本机或内网页面');
    url.hash = '';
    return url.href;
  });
  if (new Set(urls).size !== urls.length) throw new Error('网页链接重复，请删除重复项');
  return urls;
}

function bounded(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function publicTarget(value, { signal = AbortSignal.timeout(webLimits.timeoutMs), lookup = name => dns.lookup(name, { all: true, verbatim: true }) } = {}) {
  const url = webUrls([value])[0];
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  let addresses;
  await assertWebUrlAllowed(url, { allowPrivateNetwork: false, hostnameResolver: async name => {
    addresses = await bounded(Promise.resolve().then(() => lookup(name)), signal);
    return addresses;
  } });
  signal.throwIfAborted();
  // Connect to the checked DNS answer; never resolve again in the HTTP client.
  const records = Array.isArray(addresses) ? addresses : [addresses];
  const selected = records.map(item => typeof item === 'string' ? { address: item, family: net.isIP(item) } : item).find(item => net.isIP(item?.address));
  if (!selected) throw new Error(`网页域名没有可用 IP：${host}`);
  return { url, address: selected.address, family: net.isIP(selected.address) };
}

export function requestPage(target, signal) {
  return new Promise((resolve, reject) => {
    const url = new URL(target.url);
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(url, {
      signal, agent: false,
      headers: { 'User-Agent': 'LINGBO-Personal-Source-Reader/1.0', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8', 'Accept-Encoding': 'identity' },
      lookup: (_host, options, callback) => callback(null, ...(options.all ? [[{ address: target.address, family: target.family }]] : [target.address, target.family])),
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.destroy();
        resolve({ status: response.statusCode, location: response.headers.location });
        return;
      }
      if (response.statusCode !== 200) {
        response.destroy();
        reject(new Error(`网页返回 HTTP ${response.statusCode}；可能需要登录、验证或暂不允许读取`));
        return;
      }
      const type = String(response.headers['content-type'] || '').toLowerCase();
      if (!/^(?:text\/html|application\/xhtml\+xml|text\/plain)(?:\s*;|$)/.test(type)) {
        response.destroy(); reject(new Error('此链接不是可读取的 HTML 或纯文本网页；PDF 请下载后使用本地资料入口')); return;
      }
      if (Number(response.headers['content-length']) > webLimits.bytes) {
        response.destroy(); reject(new Error('网页超过 2 MB，未读取')); return;
      }
      let bytes = 0;
      const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > webLimits.bytes) { response.destroy(new Error('网页超过 2 MB，未读取')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status: 200, bytes: Buffer.concat(chunks), type, encoding: String(response.headers['content-encoding'] || '').toLowerCase() }));
    });
    request.on('error', reject);
  });
}

export class PublicWebReader {
  constructor(directory, options = {}) {
    this.directory = directory;
    this.resolve = options.resolve || publicTarget;
    this.request = options.request || requestPage;
    this.timeoutMs = options.timeoutMs || webLimits.timeoutMs;
  }
  async read(value, { signal = new AbortController().signal } = {}) {
    signal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    const requestedUrl = webUrls([value])[0];
    let current = requestedUrl;
    let response;
    for (let redirects = 0; redirects <= webLimits.redirects; redirects++) {
      const target = await this.resolve(current, { signal });
      response = await this.request(target, signal);
      signal.throwIfAborted();
      if (response.status === 200) break;
      if (!response.location) throw new Error('网页跳转缺少目标地址');
      if (redirects === webLimits.redirects) throw new Error('网页跳转超过 3 次，未继续读取');
      current = webUrls([new URL(response.location, current).href])[0];
    }
    let bytes = response.bytes;
    const decompress = { gzip: gunzip, deflate: inflate, br: brotliDecompress }[response.encoding];
    if (response.encoding && response.encoding !== 'identity' && !decompress) throw new Error('不支持此网页的压缩格式');
    if (decompress) bytes = await promisify(decompress)(bytes, { maxOutputLength: webLimits.bytes });
    if (bytes.length > webLimits.bytes) throw new Error('网页解压后超过 2 MB');
    signal.throwIfAborted();
    fs.mkdirSync(this.directory, { recursive: true });
    const input = path.join(this.directory, crypto.randomUUID() + '.html');
    const output = input + '.json';
    try {
      fs.writeFileSync(input, bytes, { flag: 'wx' });
      await execute(python, [parser, input, output, response.type], { signal, timeout: 10000, windowsHide: true, maxBuffer: 8192, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      signal.throwIfAborted();
      const extracted = JSON.parse(fs.readFileSync(output, 'utf8'));
      return { ...extracted, url: requestedUrl, finalUrl: current, fetchedAt: new Date().toISOString(), contentType: response.type, fetchedBytes: bytes.length };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw new Error(`无法提取网页正文：${String(error.stderr || error.message).split('\n').filter(Boolean).at(-1).slice(0, 220)}`);
    } finally {
      for (const file of [input, output]) if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
}
