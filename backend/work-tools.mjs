import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { hashFile, sha, within, realTarget } from './work-policy.mjs';
import { python } from './source-bundles.mjs';
import { documentEnvironment } from '../runtime/worker-environment.mjs';
const execute = promisify(execFile);
const office = fileURLToPath(new URL('./work-office.py', import.meta.url));
const documents = fileURLToPath(new URL('./documents.py', import.meta.url));
const textExtensions = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml', '.html', '.css', '.js', '.mjs', '.ts', '.py', '.ps1', '.xml', '.log']);
export class WorkTools {
  constructor({ policy, personal, skills, webReader, browser }) { Object.assign(this, { policy, personal, skills, webReader, browser }); }
  resolve(job, value, write = false) { return this.policy.resolve(job, value, write); }
  checkSize(file) { if (!fs.statSync(file).isFile() || fs.statSync(file).size > 20 * 1024 * 1024) throw new Error('只处理不超过 20 MB 的单个文件'); }
  expected(file, expected) { if (!/^[a-f0-9]{64}$/.test(expected || '') || !fs.existsSync(file) || hashFile(file) !== expected) throw new Error('原文件已变化或缺少 SHA256，请重新读取再操作'); }
  backup(job, file) { const directory = path.join(this.policy.file ? path.dirname(this.policy.file) : this.policy.directory, 'work-backups', job.id); fs.mkdirSync(directory, { recursive: true }); const backup = path.join(directory, crypto.randomUUID() + path.extname(file)); fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL); if (hashFile(backup) !== hashFile(file)) throw new Error('备份校验失败'); return backup; }
  async helper(job, options, output) {
    const input = path.join(path.dirname(job.output), crypto.randomUUID() + '.json'); fs.writeFileSync(input, JSON.stringify(options));
    try { const { stdout } = await execute(python, [office, input, output], { windowsHide: true, signal: job.controller.signal, timeout: 60000, maxBuffer: 512 * 1024, env: documentEnvironment() }); return JSON.parse(stdout.trim()); }
    catch (error) { throw new Error(job.controller.signal.aborted ? '任务已停止' : String(error.stderr || error.message).split('\n').filter(Boolean).at(-1)); }
    finally { if (fs.existsSync(input)) fs.unlinkSync(input); }
  }
  async acceptanceText(job, target) {
    this.resolve(job, target); this.checkSize(target);
    const ext = path.extname(target).toLowerCase();
    if (textExtensions.has(ext)) {
      const bytes = fs.readFileSync(target); let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
      if (text.includes('\0') || text.length > 1000000) throw new Error('验收正文非文本或超过 1000000 字符，未截断验收');
      return text;
    }
    if (ext !== '.docx') throw new Error('正文验收当前仅支持文本和 DOCX；其他格式可验证目标路径和 SHA256');
    const temp = path.join(path.dirname(job.output), crypto.randomUUID() + '.json');
    try {
      await execute(python, [documents, 'extract-check', target, temp], { windowsHide: true, signal: job.controller.signal, timeout: 60000, maxBuffer: 512 * 1024, env: documentEnvironment() });
      const value = JSON.parse(fs.readFileSync(temp, 'utf8'));
      if (typeof value.text !== 'string') throw new Error('验收正文提取失败');
      return value.text;
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  async execute(job, tool, args = {}, confirm, intent) {
    if (!args || typeof args !== 'object' || Array.isArray(args) || JSON.stringify(args).length > 150000) throw new Error('工具参数无效或过大');
    const signal = job.controller.signal; signal.throwIfAborted();
    let value; let evidence = {};
    const target = ['work_list', 'work_read', 'work_write', 'work_edit', 'work_copy', 'work_move', 'work_delete', 'work_office'].includes(tool) ? this.resolve(job, args.path || '.', !['work_list', 'work_read', 'work_copy'].includes(tool)) : null;
    if (tool === 'work_list') {
      if (!fs.statSync(target).isDirectory()) throw new Error('此路径不是目录');
      const entries = fs.readdirSync(target, { withFileTypes: true });
      value = { path: target, entries: entries.slice(0, 200).map(e => ({ name: e.name, directory: e.isDirectory(), link: e.isSymbolicLink() })), truncated: entries.length > 200 };
    } else if (tool === 'work_read') {
      this.checkSize(target); const before = hashFile(target); const ext = path.extname(target).toLowerCase();
      const offset = args.offset ?? 0, max = job.modelProfile === 'ollama' ? 6000 : 20000, limit = Math.min(args.limit ?? max, max);
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) throw new Error('读取范围无效');
      let windowed = false;
      if (textExtensions.has(ext)) {
        const bytes = fs.readFileSync(target); let content; try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { content = new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
        if (content.includes('\0')) throw new Error('不是有效文本');
        value = { content };
      } else if (['.docx', '.pdf'].includes(ext)) {
        const temp = path.join(path.dirname(job.output), crypto.randomUUID() + '.json');
        try { await execute(python, [documents, 'extract-window', target, temp, String(offset), String(limit)], { windowsHide: true, signal, timeout: 60000, env: documentEnvironment() }); value = JSON.parse(fs.readFileSync(temp, 'utf8')); windowed = true; }
        finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
      } else if (['.xlsx', '.pptx'].includes(ext)) value = await this.helper(job, { operation: 'read', source: target }, path.join(path.dirname(job.output), 'unused'));
      else throw new Error('不支持此文件格式');
      const content = value.content ?? value.text ?? JSON.stringify(value);
      if (!windowed && offset > content.length) throw new Error('读取范围无效');
      const selected = windowed ? content : content.slice(offset, offset + limit), budget = job.modelProfile === 'ollama' ? 12000 : 50000;
      if ((job.readCharacters || 0) + selected.length > budget) throw new Error('本次执行的资料上下文达到上限。请缩小读取范围、暂停后分阶段继续，或改用资料报告入口；未发送更多正文。');
      job.readCharacters = (job.readCharacters || 0) + selected.length;
      if (windowed || offset || content.length > limit || 'content' in value || 'text' in value) value = { content: selected, offset, totalCharacters: windowed ? value.totalCharacters : content.length, truncated: windowed ? value.truncated : offset > 0 || offset + limit < content.length };
      if (hashFile(target) !== before) throw new Error('读取期间文件发生变化，请重试');
      value = { ok: true, path: target, sha256: before, ...value }; evidence = { path: target, sha256: before };
    } else if (['work_write', 'work_edit', 'work_office'].includes(tool)) {
      const exists = fs.existsSync(target), ext = path.extname(target).toLowerCase();
      if (exists) { this.checkSize(target); this.expected(target, args.expected_sha256); }
      if (tool === 'work_edit' && !exists) throw new Error('待修改文件不存在');
      if (tool === 'work_write' && (!textExtensions.has(ext) || typeof args.content !== 'string' || Buffer.byteLength(args.content) > 120000)) throw new Error('文字写入仅支持文本扩展名和 120 KB 以内的内容');
      const temporary = path.join(path.dirname(job.output), crypto.randomUUID() + ext);
      let detail = {};
      try {
        if (tool === 'work_office') {
          const expectedExt = { create_docx: '.docx', create_xlsx: '.xlsx', create_pptx: '.pptx', edit_xlsx: '.xlsx' }[args.operation];
          if (!expectedExt || ext !== expectedExt || (args.operation === 'edit_xlsx' && !exists)) throw new Error('Office 操作与文件扩展名不一致，或原文件不存在');
          let data; try { data = args.data ? JSON.parse(args.data) : {}; } catch { throw new Error('Office data 须为有效 JSON 字符串'); }
          detail = await this.helper(job, { operation: args.operation, ...(exists ? { source: target } : {}), content: args.content || '', data }, temporary);
        } else if (tool === 'work_edit') {
          if (ext === '.docx') detail = await this.helper(job, { operation: 'edit_docx', source: target, old_text: args.old_text, new_text: args.new_text, replace_all: args.replace_all === true }, temporary);
          else {
            if (!textExtensions.has(ext) || !args.old_text || typeof args.new_text !== 'string') throw new Error('此格式不能精确替换');
            const content = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(target)); const count = content.split(args.old_text).length - 1;
            if (!count || (count > 1 && !args.replace_all)) throw new Error('原文不存在或不唯一，请补充上下文');
            fs.writeFileSync(temporary, content.split(args.old_text).join(args.new_text)); detail = { replacements: count };
          }
        } else fs.writeFileSync(temporary, args.content, 'utf8');
        signal.throwIfAborted(); this.checkSize(temporary);
        const finalHash = hashFile(temporary);
        if (exists) {
          await confirm({ tool, path: target, before: args.expected_sha256, after: finalHash, operation: args.operation, oldText: args.old_text, newText: args.new_text, contentPreview: tool === 'work_write' ? args.content : undefined, data: args.data || undefined, detail, warning: '将修改原文件；确认后先保存备份。请关闭该文件的 WPS/Office 编辑窗口，避免未保存内容覆盖结果。' });
          this.resolve(job, target, true); this.expected(target, args.expected_sha256);
        }
        signal.throwIfAborted(); const backup = exists ? this.backup(job, target) : null;
        this.resolve(job, target, true); fs.mkdirSync(path.dirname(target), { recursive: true });
        // Copy staged content next to the destination before an atomic rename, across drives too.
        const adjacent = path.join(path.dirname(target), '.hiyori-' + crypto.randomUUID() + '.tmp');
        intent({ tool, path: target, before: exists ? args.expected_sha256 : null, after: finalHash, backup });
        try {
          fs.copyFileSync(temporary, adjacent, fs.constants.COPYFILE_EXCL);
          this.resolve(job, target, true);
          if (exists) this.expected(target, args.expected_sha256);
          else if (fs.existsSync(target)) throw new Error('目标文件刚刚被创建，未覆盖');
          // New files use hard-link creation for atomic no-clobber semantics.
          if (exists) fs.renameSync(adjacent, target); else fs.linkSync(adjacent, target);
        } finally { if (fs.existsSync(adjacent)) fs.unlinkSync(adjacent); }
        if (hashFile(target) !== finalHash) throw new Error('写入后校验失败，请检查备份');
        value = { ok: true, path: target, sha256: finalHash, backup, ...detail }; evidence = { mutation: true, path: target, sha256: finalHash, backup };
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    } else if (['work_copy', 'work_move', 'work_delete'].includes(tool)) {
      this.checkSize(target); const originalHash = hashFile(target);
      let destination = tool === 'work_delete' ? null : this.resolve(job, args.destination, true);
      if (destination && (destination === target || fs.existsSync(destination))) throw new Error('目标已存在，未覆盖');
      if (tool !== 'work_copy') {
        this.expected(target, args.expected_sha256);
        await confirm({ tool, path: target, destination, sha256: originalHash, warning: tool === 'work_delete' ? '单文件将移入备份区，可从回执路径找回。不会递归删除目录。' : '移动文件会改变原路径，请确认目标。' });
        this.resolve(job, target, true); this.expected(target, originalHash);
      }
      signal.throwIfAborted();
      const backup = tool !== 'work_copy' ? this.backup(job, target) : null;
      intent({ tool, path: target, destination, backup, sha256: originalHash });
      if (destination) { fs.mkdirSync(path.dirname(destination), { recursive: true }); this.resolve(job, destination, true); fs.copyFileSync(target, destination, fs.constants.COPYFILE_EXCL); if (hashFile(destination) !== originalHash) throw new Error('复制校验失败，保留源文件'); }
      if (tool !== 'work_copy') { this.resolve(job, target, true); this.expected(target, originalHash); fs.unlinkSync(target); }
      value = { ok: true, source: target, path: destination || backup, sha256: originalHash, backup }; evidence = { mutation: true, source: target, path: destination || backup, sha256: originalHash, backup };
    } else if (tool === 'work_web_read') {
      const page = await this.webReader.read(args.url, { signal }); value = { ...page, text: page.text?.slice(0, 30000), untrusted: true }; evidence = { url: page.finalUrl || args.url, sha256: sha(page.text || JSON.stringify(page)) };
    } else if (tool === 'work_browser') {
      value = await this.browser.execute(job, args, confirm, intent); evidence = { mutation: ['click', 'fill'].includes(args.action), url: value.url || value.page?.url, action: args.action };
    } else if (tool === 'work_memory') value = { memories: this.personal.snapshot().memories };
    else if (tool === 'work_skill') {
      const pinned = job.skillVersions.find(s => s.id === args.skill), skill = this.skills.list().find(s => s.id === args.skill);
      if (!pinned || !skill?.enabled || pinned.sha256 !== skill.sha256) throw new Error('此技能未被选择、已禁用或版本已改变');
      if (typeof args.file !== 'string' || !/^(?:scripts|references|assets)\/[A-Za-z0-9_.\/-]+$/.test(args.file) || args.file.split('/').some(n => ['.', '..', ''].includes(n))) throw new Error('技能资源路径无效');
      if (!skill.files?.some(f => f.name === args.file)) throw new Error('此资源未包含在启用版本中，请重新导入并启用');
      const directory = path.join(this.skills.directory, skill.id), file = realTarget(path.join(directory, args.file));
      if (!within(directory, file) || !fs.existsSync(file) || fs.statSync(file).size > 64000) throw new Error('技能资源不存在或过大');
      const content = fs.readFileSync(file, 'utf8'), checksum = hashFile(file);
      if (args.action === 'read') value = { file: args.file, content, sha256: checksum };
      else if (args.action === 'run') {
        if (!args.file.startsWith('scripts/') || !Array.isArray(args.args || []) || (args.args || []).some(a => typeof a !== 'string' || a.length > 1000)) throw new Error('脚本或参数无效');
        const ext = path.extname(file).toLowerCase();
        const command = ext === '.py' ? python : ext === '.mjs' || ext === '.js' ? process.execPath : ext === '.ps1' ? (process.env.VOICE_POWERSHELL || path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe')) : null;
        if (!command) throw new Error('脚本仅支持 Python、Node、PowerShell');
        await confirm({ tool, skill: args.skill, file: args.file, sha256: checksum, source: content, args: args.args || [], warning: '此脚本没有操作系统沙箱，可访问当前用户所有文件和网络。请完整审阅代码和参数；执行后不能保证撤销。不要批准不可信脚本。' });
        signal.throwIfAborted(); const currentSkill = this.skills.list().find(s => s.id === args.skill);
        if (hashFile(file) !== checksum || !currentSkill?.enabled || currentSkill.sha256 !== pinned.sha256) throw new Error('脚本或技能已变化、被禁用，确认作废');
        const runtimeArgs = ext === '.ps1' ? ['-NoProfile', '-NonInteractive', '-File', file] : ext === '.py' ? ['-I', file] : [file];
        // Secrets never enter the script environment. Full OS access remains explicit in the approval.
        const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ProgramFiles'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
        intent({ tool, skill: args.skill, file: args.file, sha256: checksum });
        const { stdout, stderr } = await execute(command, [...runtimeArgs, ...(args.args || [])], { cwd: job.output, env, windowsHide: true, signal, timeout: 60000, maxBuffer: 128 * 1024 });
        value = { exitCode: 0, stdout: stdout.slice(0, 16000), stderr: stderr.slice(0, 4000) }; evidence = { mutation: true, skill: args.skill, script: args.file, sha256: checksum };
      } else throw new Error('技能操作无效');
    } else throw new Error('工具未开放');
    if (JSON.stringify(value).length > 100000) value = { bounded: true, content: JSON.stringify(value).slice(0, 90000) };
    return { value, evidence };
  }
  async close(job) { await this.browser?.close(job); }
}
