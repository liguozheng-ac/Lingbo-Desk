import path from 'node:path';
import { execFile } from 'node:child_process';
import { workerEnvironment } from '../runtime/worker-environment.mjs';

// Secrets cross a private stdin/stdout pipe, never command arguments or a temp file.
// CurrentUser DPAPI protects at rest, not against another process running as this user.
const script = `$ErrorActionPreference='Stop'; try {
Add-Type -AssemblyName System.Security;
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json;
$bytes = [Convert]::FromBase64String($request.data);
$entropy = [Text.Encoding]::UTF8.GetBytes('LingboDesk/services/v1');
if ($request.action -eq 'protect') { $result = [Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser) }
elseif ($request.action -eq 'unprotect') { $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser) }
else { throw 'Unsupported action' };
[Console]::Write([Convert]::ToBase64String($result));
} catch { [Console]::Error.Write('DPAPI operation failed'); exit 1 }`;

export function windowsCrypt(action, bytes) {
  if (process.platform !== 'win32') throw new Error('安全保存当前仅支持 Windows；其他系统请使用环境变量配置');
  const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolve, reject) => {
    const child = execFile(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 128 * 1024, env: workerEnvironment() }, (error, stdout) => {
      if (error || !/^[A-Za-z0-9+/]+={0,2}$/.test(stdout.trim())) return reject(new Error('Windows 安全存储不可用；原配置未更改，请检查当前 Windows 用户与系统权限'));
      resolve(Buffer.from(stdout.trim(), 'base64'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ action, data: Buffer.from(bytes).toString('base64') }));
  });
}
