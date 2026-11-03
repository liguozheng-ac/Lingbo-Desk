import fs from 'node:fs';
import path from 'node:path';
import { fileDigest, digest } from './task-store.mjs';

export function paragraphs(text, source) {
  return text.split(/\n\s*\n|\r?\n/).map(line => line.trim()).filter(Boolean).map((text, index) => ({ id: `${source}-P${index + 1}`, text }));
}

export function inspectSources(bundle) {
  const findings = [];
  const sources = [];
  for (const [name, expected] of Object.entries(bundle.snapshotSha256 || {})) {
    if (!['source-a.md', 'source-b.md'].includes(name)) continue;
    try { if (fileDigest(path.join(bundle.directory, name)) !== expected) throw new Error('mismatch'); }
    catch { findings.push({ severity: 'error', code: 'source_integrity', message: `资料聚合快照 ${name} 缺失或哈希不一致。` }); }
  }
  for (const [index, entry] of bundle.entries.entries()) {
    try {
      if (entry.source !== `S${index + 1}` || typeof entry.name !== 'string') throw new Error('来源编号无效');
      const original = path.join(bundle.directory, `${index + 1}${path.extname(entry.name).toLowerCase()}`);
      const cache = JSON.parse(fs.readFileSync(path.join(bundle.directory, `${index + 1}.json`), 'utf8'));
      if (fileDigest(original) !== entry.sha256) throw new Error('原文件快照哈希不一致');
      if (entry.textSha256 && digest(cache.text) !== entry.textSha256) throw new Error('提取正文哈希不一致');
      if (entry.kind === 'web' && ['kind', 'title', 'url', 'finalUrl', 'fetchedAt', 'contentType'].some(field => entry[field] !== cache.web?.[field])) throw new Error('网页来源元数据与正文快照不一致');
      if (!entry.textSha256) findings.push({ severity: 'warning', code: 'legacy_text_digest', source: entry.source, message: `${entry.source} 是旧版资料，仅有原文件哈希，缺少导入时正文哈希。` });
      sources.push({ ...entry, text: cache.text, paragraphs: paragraphs(cache.text, entry.source) });
    } catch (error) { findings.push({ severity: 'error', code: 'source_integrity', source: entry.source, message: `${entry.source} ${error.message}` }); }
  }
  return { passed: !findings.some(item => item.severity === 'error'), findings, sources };
}

export function auditReport(markdown, bundle) {
  const integrity = inspectSources(bundle);
  const findings = [...integrity.findings];
  const byId = new Map(integrity.sources.map(source => [source.source, source]));
  const references = [];
  let checkedParagraphs = 0;
  const numbers = text => [...text.matchAll(/\d+(?:\.\d+)?\s*(?:万元|毫秒|元|秒|天|人|份|%|％|ms|MB|GB)/gi)].map(match => match[0].replace(/\s/g, '').toLowerCase());
  const normalized = text => text.replace(/\s/g, '').toLowerCase();
  markdown.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;
    if (!text.trim() || /^\s*#/.test(text)) return;
    const refs = [];
    for (const match of text.matchAll(/\[([^\]\n]{1,80})\]/g)) {
      const id = match[1];
      const parsed = /^(S[1-9]\d*)(?:-P([1-9]\d*))?$/.exec(id);
      if (!parsed) {
        if (/^(?:s\d|source[-_]|\d+$)/i.test(id)) findings.push({ severity: 'error', code: 'invalid_reference', line, reference: id, message: `第 ${line} 行引用 [${id}] 不是资料来源编号。` });
        continue;
      }
      const source = byId.get(parsed[1]);
      const paragraph = parsed[2] && source?.paragraphs.find(item => item.id === id);
      if (!source || (parsed[2] && !paragraph)) {
        findings.push({ severity: 'error', code: 'unknown_reference', line, reference: id, message: `第 ${line} 行引用 [${id}] 不存在。` });
        continue;
      }
      refs.push({ source: source.source, reference: id, text: paragraph?.text || source.text });
      references.push({ line, reference: id, source: source.source, file: source.name, paragraph: paragraph?.id || null });
    }
    const content = text.replace(/\[[^\]]+\]/g, '').replace(/^\s*(?:[-*]|\d+[.)、])\s*/, '');
    if (content.length > 24) {
      checkedParagraphs++;
      if (!refs.length && !/^(?:建议|待核实|推测|假设)/.test(content)) findings.push({ severity: 'warning', code: 'missing_reference', line, message: `第 ${line} 行未提供可追溯引用，请复核。` });
    }
    for (const number of numbers(content)) {
      if (!refs.length || !refs.some(ref => normalized(ref.text).includes(number))) findings.push({ severity: 'warning', code: 'number_not_found', line, value: number, message: `第 ${line} 行的“${number}”未在所引用正文中找到原样数值；换算或推断需人工核实。` });
    }
    if (/\b(?:source-[ab]|extract)\.md\b/.test(content)) findings.push({ severity: 'warning', code: 'internal_filename', line, message: `第 ${line} 行包含内部中间文件名，请确认报告表述。` });
  });
  const fields = new Map();
  for (const source of integrity.sources) for (const paragraph of source.paragraphs) {
    const match = /^\s*([^:#：]{2,20})[：:]\s*(\d+(?:\.\d+)?\s*(?:万元|元|毫秒|秒|天|%|％|ms|MB|GB))/i.exec(paragraph.text);
    if (match) {
      const field = match[1].trim();
      const list = fields.get(field) || [];
      list.push({ source: source.source, paragraph: paragraph.id, value: normalized(match[2]) }); fields.set(field, list);
    }
  }
  for (const [field, values] of fields) if (new Set(values.map(value => value.value)).size > 1) findings.push({ severity: 'warning', code: 'source_conflict', field, values, message: `资料中“${field}”存在不同数值，请核实口径。` });
  if (!references.length) findings.push({ severity: 'error', code: 'no_references', message: '报告没有任何可追溯来源编号。' });
  const errors = findings.filter(item => item.severity === 'error').length;
  const warnings = findings.length - errors;
  return { schemaVersion: 1, checkedAt: new Date().toISOString(), status: !integrity.passed ? 'integrity_failed' : findings.length ? 'needs_review' : 'references_resolved', errors, warnings, checkedParagraphs, references, findings,
    sources: integrity.sources.map(source => ({ source: source.source, name: source.name, sha256: source.sha256, paragraphs: source.paragraphs.length, ...(source.kind === 'web' ? { title: source.title, url: source.url, finalUrl: source.finalUrl, fetchedAt: source.fetchedAt } : {}) })),
    scope: '只校验资料完整性、引用编号、原文位置和部分数字；不证明结论正确，也不自动核实外部事实。' };
}
