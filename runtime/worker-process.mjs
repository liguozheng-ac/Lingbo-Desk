import path from 'node:path';
import { fork, spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { workerEnvironment } from './worker-environment.mjs';
import { DiagnosticLog } from './diagnostic-log.mjs';
const exec = promisify(execFile);
export async function withinTime(promise, milliseconds, label = 'Worker cleanup timed out') {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
export function safeWorkerSend(child, message, onError = () => {}) {
  if (!child?.connected || child.exitCode !== null || child.signalCode) return false;
  try { child.send(message, error => { if (error) onError(); }); return true; } catch { onError(); return false; }
}
export function startWorker(file, { env = {}, cwd, diagnosticsDirectory, shutdownMs = 3000, killMs = 2000, execPath = process.execPath } = {}) {
  const environment = workerEnvironment(env), log = new DiagnosticLog(diagnosticsDirectory);
  let child;
  try { child = fork(file, [], { cwd, env: environment, execPath, execArgv: [], detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); }
  catch (error) { log.append({ type: 'worker.error' }); log.close(); throw error; }
  return supervise(child, log, shutdownMs, killMs);
}
// The gateway needs a different explicit environment from its restricted agents.
export function startManagedProcess(command, args, { env = workerEnvironment(), cwd, diagnosticsDirectory, shutdownMs = 25000, killMs = 2000 } = {}) {
  const log = new DiagnosticLog(diagnosticsDirectory); let child;
  try { child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); }
  catch (error) { log.close(); throw error; }
  return supervise(child, log, shutdownMs, killMs);
}
function supervise(child, log, shutdownMs, killMs) {
  const started = Date.now(), counts = { stdout: { bytes: 0, chunks: 0 }, stderr: { bytes: 0, chunks: 0 } };
  const ownerPid = child.pid;
  let closed = false, stopping, failure;
  child.on('error', () => { failure = true; log.append({ type: 'worker.error' }); });
  for (const channel of ['stdout', 'stderr']) child[channel]?.on('data', chunk => { counts[channel].bytes += chunk.length; counts[channel].chunks++; });
  log.append({ type: 'worker.started', data: { pid: ownerPid } });
  const done = new Promise(resolve => child.once('close', (code, signal) => {
    closed = true;
    for (const channel of ['stdout', 'stderr']) log.append({ type: 'worker.stream', data: { channel, ...counts[channel] } });
    log.append({ type: 'worker.closed', data: { code, durationMs: Date.now() - started } }); log.close();
    resolve({ code, signal, error: failure ? 'Worker process error' : null });
  }));
  const send = (command, fields = {}) => safeWorkerSend(child, { command, ...fields }, () => log.append({ type: 'worker.ipc_error' }));
  async function killTree() {
    if (closed) return;
    if (!Number.isSafeInteger(ownerPid) || ownerPid < 1 || ownerPid === process.pid || child.pid !== ownerPid) throw new Error('Invalid owned worker PID');
    log.append({ type: 'worker.kill', data: { forced: true, pid: ownerPid } });
    if (process.platform === 'win32') {
      const executable = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'taskkill.exe');
      try { await exec(executable, ['/PID', String(ownerPid), '/T', '/F'], { windowsHide: true, timeout: killMs, env: workerEnvironment() }); }
      catch { if (!closed) { try { child.kill('SIGKILL'); } catch {} } }
    } else {
      try { process.kill(-ownerPid, 'SIGKILL'); } catch { if (!closed) child.kill('SIGKILL'); }
    }
  }
  return { child, done, log, get closed() { return closed; }, send,
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        if (closed) return done;
        send('shutdown');
        try { return await withinTime(done, shutdownMs); }
        catch {
          await killTree();
          try { return await withinTime(done, killMs, 'Worker process has not closed after termination'); }
          catch (error) { log.append({ type: 'worker.cleanup_error' }); throw error; }
        }
      })();
      stopping.catch(() => { stopping = undefined; });
      return stopping;
    },
  };
}
