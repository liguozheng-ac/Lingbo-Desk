export async function probeSpeech(id, speech, { createSession, streamTTS, signal }) {
  const start = Date.now();
  if (id === 'tts') {
    if (!speech.tts?.keys?.doubaoKey) throw new Error('请先保存豆包 TTS 密钥');
    const audio = await streamTTS({ ...speech.tts, text: '连接测试成功。', language: 'zh', signal });
    let bytes = 0;
    for await (const chunk of audio) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) { audio.destroy(); throw new Error('合成检查响应过大'); } }
    if (!bytes) throw new Error('合成服务未返回音频');
    return { id, elapsedMs: Date.now() - start, bytes, scope: '短文本合成，未播放音频' };
  }
  if (id !== 'asr') throw new Error('服务编号无效');
  if (!speech.asr?.aliyunApiKey) throw new Error('请先保存阿里云 ASR 密钥');
  await new Promise((resolve, reject) => {
    let session, done = false;
    const finish = error => { if (done) return; done = true; signal.removeEventListener('abort', abort); session?.close(); error ? reject(error) : resolve(); };
    const abort = () => finish(new Error('识别连接检查已取消或超时'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try { session = createSession({ ...speech.asr, lang: 'auto' }, () => {}, () => finish(new Error('识别连接检查失败，请检查密钥、服务权限与网络')), () => finish(new Error('识别连接提前关闭')), event => { if (event === 'task-started') finish(); }); if (done) session?.close(); }
    catch { finish(new Error('识别连接检查失败，请检查密钥、服务权限与网络')); }
  });
  return { id, elapsedMs: Date.now() - start, scope: '鉴权与会话建立，未验证识别准确率' };
}
