import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { documentEnvironment } from '../runtime/worker-environment.mjs';

export async function decodeAudio(python, script, input, output, signal, execute = promisify(execFile)) {
  try { await execute(python, [script, input, output], { windowsHide: true, signal, timeout: 20000, maxBuffer: 8192, env: documentEnvironment() }); }
  catch (error) {
    if (signal?.aborted) throw signal.reason;
    const unavailable = error.code === 'ENOENT' || /ModuleNotFoundError|ImportError|DLL load failed/.test(error.stderr || '');
    throw Object.assign(new Error(unavailable ? '音频解码组件不可用，请使用完整测试包中的 Python 运行时（需包含 PyAV）' : '无法解码这段音频，请检查音频格式、大小后重试'), { code: unavailable ? 'AUDIO_DECODER_UNAVAILABLE' : 'AUDIO_DECODE_FAILED', statusCode: unavailable ? 503 : 400 });
  }
}
