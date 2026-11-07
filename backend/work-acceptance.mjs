import fs from 'node:fs';
import path from 'node:path';
import { hashFile } from './work-policy.mjs';

// This contract is captured on submit/paused modification, never from work_finish.
export function normalizeAcceptance(value = []) {
  if (!Array.isArray(value) || value.length > 8 || JSON.stringify(value).length > 16000) throw new Error('验收条件须为最多 8 项、总计不超过 16000 字符的数组');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(k => !['path', 'contains', 'notContains', 'sha256'].includes(k))) throw new Error('验收条件字段无效');
    if (typeof item.path !== 'string' || !item.path.trim() || item.path.length > 2000) throw new Error('验收目标路径无效');
    const condition = { path: item.path };
    for (const key of ['contains', 'notContains']) {
      if (item[key] === undefined) continue;
      if (!Array.isArray(item[key]) || item[key].length > 8 || item[key].some(s => typeof s !== 'string' || !s.length || s.length > 2000)) throw new Error('验收正文条件须为最多 8 个非空短语');
      condition[key] = [...item[key]];
    }
    if (item.sha256 !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('验收 SHA256 无效');
      condition.sha256 = item.sha256;
    }
    return condition;
  });
}

export async function verifyAcceptance(job, tools) {
  const conditions = normalizeAcceptance(job.acceptance), checks = [];
  const samePath = (a, b) => typeof a === 'string' && path.relative(a, b) === '';
  for (const condition of conditions) {
    job.controller.signal.throwIfAborted();
    const target = tools.resolve(job, condition.path);
    // A different file or a read-only receipt cannot satisfy an output contract.
    const receipt = job.receipts.findLast(r => r.ok && r.mutation && r.version === job.version && samePath(r.path, target));
    if (!receipt?.sha256 || receipt.tool === 'work_delete') throw new Error('验收目标缺少当前版本的文件动作回执');
    tools.checkSize(target);
    const before = hashFile(target);
    if (before !== receipt.sha256 || (condition.sha256 && before !== condition.sha256)) throw new Error('验收目标的 SHA256 不一致');
    const contentCheck = !!(condition.contains?.length || condition.notContains?.length);
    if (contentCheck) {
      const text = await tools.acceptanceText(job, target);
      if (condition.contains?.some(s => !text.includes(s))) throw new Error('验收失败：目标文件缺少必须包含的正文');
      if (condition.notContains?.some(s => text.includes(s))) throw new Error('验收失败：目标文件仍包含禁止出现的正文');
    }
    // Recheck both permission and hash after asynchronous extraction.
    tools.resolve(job, target); job.controller.signal.throwIfAborted();
    if (!fs.existsSync(target) || hashFile(target) !== before) throw new Error('验收期间目标文件发生变化');
    checks.push({ path: target, sha256: before, receiptId: receipt.id, contentChecked: contentCheck, textScope: contentCheck ? path.extname(target).toLowerCase() === '.docx' ? 'docx_body_paragraphs_tables' : 'full_text' : null, matchedContains: condition.contains?.length || 0, matchedNotContains: condition.notContains?.length || 0 });
  }
  return { scope: conditions.length ? 'declared_outputs' : 'execution_only', at: new Date().toISOString(), version: job.version, checks, limitation: conditions.length ? '只验证声明的路径、哈希和精确文本条件；DOCX 仅检查正文段落及表格，不含页眉页脚等内容。不代表语义、排版或业务正确。' : '只验证执行记录及已记录文件状态，业务结果需要人工复核。' };
}
