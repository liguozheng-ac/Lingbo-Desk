import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// SKILL.md frontmatter convention follows Lingbo src/skills/registry.js.
// Resources are data; executing a pinned script needs a separate per-action approval.
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const idPattern = /^[a-z0-9][a-z0-9-]{0,59}$/;
export function parseSkill(id, raw) {
  if (!idPattern.test(id) || typeof raw !== 'string' || Buffer.byteLength(raw) > 16000) throw new Error('技能编号无效，或 SKILL.md 超过 16 KB');
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(raw);
  if (!match) throw new Error('SKILL.md 需要 name、description 和 scope 前置信息');
  const meta = Object.fromEntries(match[1].split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).map(line => {
    const m = /^([a-z-]+):\s*(.+)$/.exec(line); if (!m) throw new Error('原型技能前置信息只支持单行字段');
    return [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2').trim()];
  }));
  meta.scope ||= 'both';
  if (!meta.name || meta.name.length > 80 || !meta.description || meta.description.length > 300 || !['chat', 'report', 'work', 'both'].includes(meta.scope)) throw new Error('技能须提供 name、description、scope（chat/report/work/both）');
  return { id, name: meta.name, description: meta.description, scope: meta.scope, body: match[2].trim(), sha256: digest(raw), raw };
}
export class PersonalSkills {
  constructor(directory, store) { this.directory = directory; this.store = store; fs.mkdirSync(directory, { recursive: true }); }
  list() {
    return fs.readdirSync(this.directory, { withFileTypes: true }).filter(e => e.isDirectory() && idPattern.test(e.name)).map(entry => {
      try {
        const dir = path.join(this.directory, entry.name), file = path.join(dir, 'SKILL.md');
        if (fs.lstatSync(dir).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 16000) throw new Error('技能路径或大小不符合要求');
        const skill = parseSkill(entry.name, fs.readFileSync(file, 'utf8'));
        const resourcesFile = path.join(dir, '.resources.json');
        const resources = fs.existsSync(resourcesFile) ? JSON.parse(fs.readFileSync(resourcesFile, 'utf8')) : [];
        if (!Array.isArray(resources) || resources.length > 20) throw new Error('技能资源清单无效');
        const files = resources.map(name => {
          if (typeof name !== 'string' || !/^(?:scripts|references|assets)\/[A-Za-z0-9_.\/-]+$/.test(name) || name.split('/').some(n => ['.', '..', ''].includes(n))) throw new Error('资源路径无效');
          const file = path.join(dir, name);
          for (let at = file; at !== dir; at = path.dirname(at)) if (fs.lstatSync(at).isSymbolicLink()) throw new Error('资源路径不能包含链接');
          if (fs.statSync(file).size > 64000) throw new Error('资源超过 64 KB');
          return { name, content: fs.readFileSync(file, 'utf8') };
        }).sort((a, b) => a.name.localeCompare(b.name));
        if (files.length) skill.sha256 = digest(skill.raw + '\n' + JSON.stringify(files));
        skill.files = files;
        const saved = this.store.snapshot().skills[skill.id];
        return { ...skill, enabled: saved?.enabled === true && saved.sha256 === skill.sha256, changed: !!saved && saved.sha256 !== skill.sha256 };
      } catch (error) { return { id: entry.name, enabled: false, error: error.message }; }
    });
  }
  install({ id, raw, revision, files = [] }) {
    const skill = parseSkill(id, raw), directory = path.join(this.directory, id);
    if (!Array.isArray(files) || files.length > 20 || new Set(files.map(f => f.name)).size !== files.length || files.some(f => !/^(?:scripts|references|assets)\/[A-Za-z0-9_.\/-]+$/.test(f.name || '') || f.name.split('/').some(n => ['.', '..', ''].includes(n)) || typeof f.content !== 'string' || Buffer.byteLength(f.content) > 64000) || JSON.stringify(files).length > 256000) throw new Error('技能最多 20 个文字资源，每个 64 KB，总计 256 KB');
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error('技能目录不能是链接');
    const previous = this.list().find(s => s.id === id);
    // Check concurrent edits before touching disk. Import/update always disables.
    if (revision !== undefined && revision !== this.store.state.revision) throw Object.assign(new Error('配置已更新，请刷新'), { statusCode: 409 });
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'SKILL.md');
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('技能文件不能是链接');
    if (previous?.raw) {
      const history = path.join(this.directory, '.history', id); fs.mkdirSync(history, { recursive: true });
      fs.writeFileSync(path.join(history, previous.sha256 + '.md'), previous.raw);
      if (previous.files?.length) fs.writeFileSync(path.join(history, previous.sha256 + '.resources.json'), JSON.stringify(previous.files));
    }
    const temporary = file + '.tmp'; fs.writeFileSync(temporary, raw); fs.renameSync(temporary, file);
    for (const resource of files) {
      const target = path.join(directory, resource.name);
      for (let at = target; at !== directory; at = path.dirname(at)) if (fs.existsSync(at) && fs.lstatSync(at).isSymbolicLink()) throw new Error('资源路径不能包含链接');
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, resource.content);
    }
    fs.writeFileSync(path.join(directory, '.resources.json'), JSON.stringify(files.map(f => f.name)));
    if (files.length) skill.sha256 = digest(raw + '\n' + JSON.stringify([...files].sort((a, b) => a.name.localeCompare(b.name))));
    this.store.commit(next => { next.skills[id] = { enabled: false, sha256: skill.sha256 }; }, revision);
    return this.list();
  }
  toggle({ id, enabled, revision, sha256 }) {
    const skill = this.list().find(s => s.id === id && !s.error);
    if (!skill || typeof enabled !== 'boolean') throw new Error('找不到有效技能或启用值无效');
    if (sha256 !== skill.sha256) throw Object.assign(new Error('技能内容已变化，请刷新并阅读后再启用'), { statusCode: 409 });
    this.store.commit(next => { next.skills[id] = { enabled, sha256: skill.sha256 }; }, revision);
    return this.list();
  }
  context(ids, scope) {
    if (!Array.isArray(ids) || ids.length > 3 || new Set(ids).size !== ids.length) throw new Error('每次最多选择 3 个不同技能');
    const all = this.list();
    const active = ids.map(id => {
      const skill = all.find(s => s.id === id);
      if (!skill?.enabled || ![scope, 'both'].includes(skill.scope)) throw new Error(`技能 ${id} 未启用、已更新或不适用于当前任务`);
      return skill;
    });
    return { versions: active.map(({ id, sha256 }) => ({ id, sha256 })), text: active.length ? '本次由用户选择的技能说明，只使用当前已开放的工具。脚本不获得自动执行权限，必须通过 work_skill 经用户审阅确认。\n' + JSON.stringify(active.map(({ id, body, files }) => ({ id, instructions: body, resources: (files || []).map(f => f.name) }))) : '' };
  }
  chatSelection(text) {
    const match = /^使用技能[：:]\s*([a-z0-9-]+)(?:\s+|[，,：:])([\s\S]+)$/.exec(text);
    if (match && this.list().find(s => s.id === match[1])?.scope === 'work') {
      this.context([match[1]], 'work');
      return { versions: [], text: `用户指定工作技能 ${match[1]}。通过 lingbo_submit_work 提交工作，并在 skillIds 中包含此编号。技能只在后台工作中生效。` };
    }
    return match ? this.context([match[1]], 'chat') : { versions: [], text: '' };
  }
}
