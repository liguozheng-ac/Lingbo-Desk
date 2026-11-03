import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export const hashFile = file => sha(fs.readFileSync(file));
export const atomicJSON = (file, value) => { const temp = file + '.' + crypto.randomUUID() + '.tmp'; fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: 'wx' }); fs.renameSync(temp, file); };
export const within = (root, target) => { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
export function realTarget(value) {
  const full = path.resolve(value); let existing = full;
  while (!fs.existsSync(existing)) { const next = path.dirname(existing); if (next === existing) throw new Error('路径没有有效父目录'); existing = next; }
  // Windows packaged-app AppData virtualization can return a different realpath
  // without any reparse point. Detect actual junctions/links per component;
  // comparing path strings falsely rejects the installed app's own output.
  for (let at = existing; path.dirname(at) !== at; at = path.dirname(at)) if (fs.lstatSync(at).isSymbolicLink()) throw new Error('路径含链接或目录联接');
  return full;
}
export class WorkPolicy {
  constructor(directory, { protectedPaths = [] } = {}) {
    fs.mkdirSync(directory, { recursive: true }); this.file = path.join(directory, 'work-permissions.json');
    this.protectedPaths = [directory, ...protectedPaths, path.join(process.env.USERPROFILE || directory, '.codex'), process.env.WINDIR].filter(Boolean).flatMap(x => { const full = path.resolve(x); return fs.existsSync(full) ? [full, fs.realpathSync.native(full)] : [full]; });
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { version: 1, revision: 0, roots: [] };
    if (this.state.version !== 1 || !Number.isInteger(this.state.revision) || !Array.isArray(this.state.roots) || this.state.roots.some(r => !r.id || !path.isAbsolute(r.path) || !['read', 'write'].includes(r.mode))) throw new Error('工作目录授权文件损坏，已保留原文件');
  }
  update({ action, directory, mode, id, revision }) {
    if (revision !== this.state.revision) throw Object.assign(new Error('授权已变化，请刷新'), { statusCode: 409 });
    const next = structuredClone(this.state);
    if (action === 'revoke') { if (!next.roots.some(r => r.id === id)) throw new Error('授权不存在'); next.roots = next.roots.filter(r => r.id !== id); }
    else if (action === 'grant') {
      if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.startsWith('\\\\') || !['read', 'write'].includes(mode)) throw new Error('请输入本机绝对目录和读写范围');
      const target = realTarget(directory);
      if (!fs.statSync(target).isDirectory() || path.dirname(target) === target || this.protectedPaths.some(p => within(target, p) || within(p, target))) throw new Error('不能授权磁盘根目录、程序配置、凭据或系统目录；请选具体资料文件夹');
      if (next.roots.length >= 20) throw new Error('最多授权 20 个文件夹');
      next.roots = next.roots.filter(r => r.path.toLowerCase() !== target.toLowerCase());
      next.roots.push({ id: crypto.randomUUID(), path: target, mode });
    } else throw new Error('授权操作无效');
    next.revision++; atomicJSON(this.file, next); this.state = next; return structuredClone(next);
  }
  resolve(job, value = '.', write = false) {
    if (typeof value !== 'string' || !value || value.length > 2000 || /[\x00-\x1f]/.test(value) || value.startsWith('\\\\') || (process.platform === 'win32' && value.slice(2).includes(':'))) throw new Error('文件路径无效');
    const target = realTarget(path.resolve(job.output, value));
    if (this.protectedPaths.some(p => within(p, target)) && !within(job.output, target)) throw new Error('禁止访问程序、凭据或系统目录');
    if (within(job.output, target)) return target;
    const grant = this.state.roots.find(r => job.rootIds.includes(r.id) && within(r.path, target) && (!write || r.mode === 'write'));
    if (!grant) throw new Error('此路径未授权，请在任务台添加具体资料文件夹授权后另建任务');
    realTarget(grant.path); return target;
  }
}
