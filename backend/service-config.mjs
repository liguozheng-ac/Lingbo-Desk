import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { windowsCrypt } from './windows-secret-store.mjs';

const fields = ['deepseekKey', 'asrKey', 'ttsKey'];
export class ServiceConfig {
  constructor(directory, legacy, crypt = windowsCrypt) {
    this.file = path.join(directory, 'services.dpapi'); this.legacy = structuredClone(legacy); this.crypt = crypt;
    this.state = { version: 1, revision: 0, values: {} }; this.warning = null;
  }
  async load() {
    if (!fs.existsSync(this.file)) return;
    try {
      const bytes = fs.readFileSync(this.file); if (bytes.length > 100000) throw new Error('Invalid storage size');
      const state = JSON.parse((await this.crypt('unprotect', bytes)).toString('utf8'));
      if (state.version !== 1 || !Number.isInteger(state.revision) || state.revision < 1 || !state.values || typeof state.values !== 'object' || Array.isArray(state.values) || Object.keys(state.values).some(k => !fields.includes(k)) || Object.values(state.values).some(v => v !== null && (typeof v !== 'string' || !v || v.length > 4096 || /\s/.test(v)))) throw new Error('Invalid storage');
      this.state = state;
    } catch { this.warning = '加密服务配置无法读取，原文件已保留。请恢复原 Windows 用户或从备份恢复配置；未使用环境变量替代该损坏配置。'; }
  }
  current() {
    const legacy = this.warning ? { deepseekKey: '', speech: { asr: {}, tts: { provider: 'doubao', keys: {} } } } : this.legacy;
    const pick = (name, fallback) => Object.hasOwn(this.state.values, name) ? this.state.values[name] || '' : fallback || '';
    return { deepseekKey: pick('deepseekKey', legacy.deepseekKey), speech: { ...legacy.speech, asr: { ...legacy.speech?.asr, aliyunApiKey: pick('asrKey', legacy.speech?.asr?.aliyunApiKey) }, tts: { ...legacy.speech?.tts, provider: 'doubao', keys: { ...legacy.speech?.tts?.keys, doubaoKey: pick('ttsKey', legacy.speech?.tts?.keys?.doubaoKey) } } } };
  }
  snapshot() {
    const value = this.current(), keys = { deepseekKey: value.deepseekKey, asrKey: value.speech.asr.aliyunApiKey, ttsKey: value.speech.tts.keys.doubaoKey };
    return { revision: this.state.revision, storage: 'windows-dpapi-current-user', canSave: process.platform === 'win32' && !this.warning, warning: this.warning,
      services: Object.fromEntries(fields.map(name => [name, { configured: !!keys[name], source: Object.hasOwn(this.state.values, name) ? (keys[name] ? 'encrypted' : 'disabled') : keys[name] ? 'legacy' : 'unset' }])) };
  }
  async save({ revision, values = {}, clear = [] }) {
    if (this.warning) throw new Error(this.warning);
    if (revision !== this.state.revision) throw Object.assign(new Error('服务配置已更新，请刷新后重试'), { statusCode: 409 });
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(k => !fields.includes(k)) || !Array.isArray(clear) || clear.some(k => !fields.includes(k))) throw new Error('服务配置字段无效');
    const next = structuredClone(this.state);
    for (const [name, raw] of Object.entries(values)) {
      if (typeof raw !== 'string' || raw.length > 4096) throw new Error('密钥格式无效');
      const value = raw.trim(); if (!value) continue;
      if (value.length < 8 || /\s/.test(value) || clear.includes(name)) throw new Error('密钥格式或清除选择无效');
      next.values[name] = value;
    }
    for (const name of clear) next.values[name] = null;
    next.revision++;
    const encrypted = await this.crypt('protect', Buffer.from(JSON.stringify(next)));
    const temporary = this.file + '.' + crypto.randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, encrypted, { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, this.file); this.state = next; }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return this.snapshot();
  }
}
