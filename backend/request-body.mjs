// Chat can carry inline desktop screenshots. Other routes retain their limits.
export const CHAT_BODY_LIMIT = 32 * 1024 * 1024;
export const DEFAULT_BODY_LIMIT = 1024 * 1024;

export class RequestBodyTooLarge extends Error {
  constructor(limitBytes, receivedBytes, declaredBytes) {
    const limit = limitBytes >= 1024 * 1024 ? `${limitBytes / 1024 / 1024} MiB` : `${limitBytes / 1024} KiB`;
    super(`请求内容超过本机 ${limit} 上限。请减少上传内容后重试；聊天也可另开会话，减少附带的历史截图。`);
    this.code = 'REQUEST_BODY_TOO_LARGE';
    this.statusCode = 413;
    this.limitBytes = limitBytes;
    this.receivedBytes = receivedBytes;
    this.declaredBytes = declaredBytes;
  }
}

export async function readBody(req, max = DEFAULT_BODY_LIMIT) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > max) {
    req.resume();
    throw new RequestBodyTooLarge(max, 0, declared);
  }
  const chunks = []; let size = 0;
  // Keep the socket alive long enough to deliver a readable 413 response.
  // A normal async-iterator early exit would destroy IncomingMessage's socket.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > max) {
      req.resume();
      throw new RequestBodyTooLarge(max, size);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
