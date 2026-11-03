import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = path.dirname(fileURLToPath(import.meta.url));
export const upstream = path.resolve(root, '../engine');
export const source = relative => pathToFileURL(path.join(upstream, relative)).href;
export function initializeData(directory) {
  fs.mkdirSync(path.join(directory, 'sandbox'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
    schemaVersion: 4, heartbeat: { enabled: false }, thinking: false,
    security: { fileSandbox: true, execSandbox: true, blockedTools: [] },
    network: { allowLanAccess: false }, embedding: { timeoutMs: 120 },
  }, null, 2));
  process.env.LINGBO_USER_DIR = directory;
  process.env.LINGBO_RESOURCES_DIR = upstream;
  process.env.DEEPSEEK_MODEL ||= 'deepseek-flash';
}
export function fixtures(directory) {
  const sandbox = path.join(directory, 'sandbox');
  fs.writeFileSync(path.join(sandbox, 'source-a.md'), '# 产品资料 A\n产品：桌面语音助手。目标平台：Windows。首版：个人自用。大模型：DeepSeek API。\n');
  fs.writeFileSync(path.join(sandbox, 'source-b.md'), '# 产品资料 B\n核心需求：中日英交流、自然插话、后台任务、长期记忆。数字人采用 Live2D，稍后验证。\n');
}
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function abortError() { return Object.assign(new Error('Validation operation cancelled'), { name: 'AbortError' }); }
export async function waitUntil(predicate, timeout = 90000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for observable state');
    await sleep(25);
  }
}
export function fileHash(file) {
  return import('node:crypto').then(({ createHash }) => createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
}
