import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { diagnosticMetadata } from '../engine/src/runtime/diagnostic-privacy.js';
const active = new Set(), pattern = /^lingbo-diagnostic-[a-f0-9-]{36}\.jsonl(?:\.1)?$/;
const header = JSON.stringify({ format: 'lingbo-diagnostics-v1', content: 'metadata-only' }) + '\n';
export class DiagnosticLog {
  constructor(directory, { maxBytes = 256 * 1024, maxFiles = 16, retentionMs = 7 * 86400000 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 512 || !Number.isSafeInteger(maxFiles) || maxFiles < 1 || !Number.isFinite(retentionMs) || retentionMs < 0) throw new Error('Invalid diagnostic retention limits');
    this.directory = path.resolve(directory); this.maxBytes = maxBytes; this.maxFiles = maxFiles; this.retentionMs = retentionMs; this.closed = false; this.failed = false;
    fs.mkdirSync(this.directory, { recursive: true });
    if (fs.lstatSync(this.directory).isSymbolicLink()) throw new Error('Diagnostic directory cannot be a link');
    this.file = path.join(this.directory, 'lingbo-diagnostic-' + crypto.randomUUID() + '.jsonl');
    fs.writeFileSync(this.file, header, { flag: 'wx', mode: 0o600 }); this.bytes = Buffer.byteLength(header); active.add(this.file); this.prune();
  }
  owned(file) {
    if (path.dirname(file) !== this.directory || !pattern.test(path.basename(file))) return false;
    const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const handle = fs.openSync(file, 'r'), buffer = Buffer.alloc(Buffer.byteLength(header));
    try { fs.readSync(handle, buffer, 0, buffer.length, 0); return buffer.toString() === header; } finally { fs.closeSync(handle); }
  }
  prune() {
    try {
      const files = fs.readdirSync(this.directory).map(name => path.join(this.directory, name)).filter(file => this.owned(file)).map(file => ({ file, mtime: fs.statSync(file).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
      for (let i = 0; i < files.length; i++) {
        const { file, mtime } = files[i], base = file.endsWith('.1') ? file.slice(0, -2) : file;
        if (!active.has(base) && (i >= this.maxFiles || Date.now() - mtime > this.retentionMs)) fs.unlinkSync(file);
      }
    } catch { this.failed = true; }
  }
  append(event) {
    if (this.closed || this.failed) return;
    try {
      const line = JSON.stringify(diagnosticMetadata(event)) + '\n', size = Buffer.byteLength(line);
      if (size + Buffer.byteLength(header) > this.maxBytes || !this.owned(this.file)) throw new Error('Diagnostic record exceeds limit or ownership changed');
      if (this.bytes + size > this.maxBytes) {
        const backup = this.file + '.1';
        if (fs.existsSync(backup)) { if (!this.owned(backup)) throw new Error('Unknown diagnostic backup'); fs.unlinkSync(backup); }
        if (!this.owned(this.file)) throw new Error('Diagnostic ownership changed');
        fs.renameSync(this.file, backup); fs.writeFileSync(this.file, header, { flag: 'wx', mode: 0o600 }); this.bytes = Buffer.byteLength(header);
      }
      fs.appendFileSync(this.file, line); this.bytes += size;
    } catch { this.failed = true; }
  }
  close() { if (this.closed) return; this.closed = true; active.delete(this.file); this.prune(); }
}
