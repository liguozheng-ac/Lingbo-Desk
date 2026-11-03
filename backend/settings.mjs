import fs from 'node:fs';
import path from 'node:path';

export const speechLanguages = ['auto', 'zh', 'ja', 'en'];

export function loadSettings(file) {
  const defaults = { language: 'auto' };
  if (!fs.existsSync(file)) return { value: defaults };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!speechLanguages.includes(parsed.language)) throw new Error('语种值无效');
    return { value: { language: parsed.language } };
  } catch {
    return { value: defaults, warning: '本机设置文件损坏，暂用自动识别；重新选择语种后会保存新设置。' };
  }
}

export function saveSettings(file, value) {
  if (!speechLanguages.includes(value.language)) throw new Error('仅支持自动识别、中文、日语、英语');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify({ language: value.language }, null, 2));
  fs.renameSync(file + '.tmp', file);
}
