export function readableError(error) {
  if (['TimeoutError', 'AbortError'].includes(error?.name)) return '请求超时，请检查本机服务后重试。';
  if (error instanceof TypeError) return '无法连接本机服务。请运行“开始验证.cmd”，服务恢复后会自动重连。';
  return error?.message || '请求失败，请重试。';
}

export async function request(url, { token, owner, data, timeout = 10000, raw = false, requestId } = {}) {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (owner) headers.set('X-Lingbo-Session', owner);
  if (requestId) headers.set('X-Request-ID', requestId);
  const multipart = data instanceof FormData;
  if (data && !multipart) headers.set('Content-Type', 'application/json');
  try {
    const response = await fetch(url, { method: data ? 'POST' : 'GET', headers, ...(data ? { body: multipart ? data : JSON.stringify(data) } : {}), signal: AbortSignal.timeout(timeout), cache: 'no-store' });
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      throw new Error(response.status === 401 ? '本机连接凭据已失效，正在重新连接；请稍后重试本次操作。' : value.error?.message || value.error || `服务返回 ${response.status}`);
    }
    return raw ? response : await response.json();
  } catch (error) { throw new Error(readableError(error)); }
}
