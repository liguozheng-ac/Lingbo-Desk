import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { migrateProfile } from './profile-migration.mjs';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.moc3': 'application/octet-stream' };
export async function startStaticRenderer(directory, port = 5173, { migration, runtime } = {}) {
  const root = path.resolve(directory);
  if (runtime) { const url = new URL(runtime.gatewayOrigin); if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== runtime.gatewayOrigin) throw new Error('Invalid gateway origin'); }
  const server = http.createServer((req, res) => {
    try {
      const actualPort = server.address()?.port ?? port;
      if (!['localhost:' + actualPort, '127.0.0.1:' + actualPort].includes(req.headers.host) || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(403); return res.end(); }
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/local-gateway-bootstrap' && runtime) {
        const own = new Set(['http://localhost:' + actualPort, 'http://127.0.0.1:' + actualPort]);
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && !own.has(req.headers.origin))) { res.writeHead(403); return res.end(); }
        void (async () => {
          try {
            const response = await fetch(runtime.gatewayOrigin + '/bootstrap', { signal: AbortSignal.timeout(5000) }), value = await response.json();
            if (!response.ok || value.baseURL !== runtime.gatewayOrigin + '/v1/' || !/^[a-f0-9]{64}$/.test(value.token)) throw new Error('Invalid bootstrap');
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            res.end(JSON.stringify({ token: value.token, baseURL: value.baseURL }));
          } catch { if (!res.headersSent) res.writeHead(503); res.end(); }
        })();
        return;
      }
      if (pathname === '/profile-migration.mjs') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(`const migrate = ${migrateProfile.toString()}; await migrate(${JSON.stringify(migration || null)});`);
      }
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + (['.html', '.js', '.mjs', '.css', '.json'].includes(path.extname(file)) ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') return res.end();
      if ((migration || runtime) && path.extname(file) === '.html') {
        let html = fs.readFileSync(file, 'utf8');
        if (migration) html = html.replace(/<script\b([^>]*\btype="module"[^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/g, (_all, _before, src) => `<script type="module">await import('/profile-migration.mjs'); await import(${JSON.stringify(src)});</script>`);
        if (runtime) html = html.replace(/<head[^>]*>/i, match => `${match}<script>globalThis.__lingboRuntime=${JSON.stringify({ gatewayOrigin: runtime.gatewayOrigin })};if(localStorage.getItem('settings/audio/input/off')===null)localStorage.setItem('settings/audio/input/off','true');</script>`);
        return res.end(html);
      }
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
