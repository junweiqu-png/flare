// Internal interaction QA only. No original private navigation or GitHub token is loaded.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { handle } from '../worker/index.mjs';
import { LocalD1, demoState } from './db.mjs';
import { normalizeState } from '../src/model.mjs';

const db = new LocalD1();
await db.prepare("INSERT INTO navigation (id, version, document, updated_at) VALUES ('main', 1, ?, ?)").bind(JSON.stringify(normalizeState(demoState())), Date.now()).run();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) === 'https://github.com/login/device/code') return Response.json({ device_code: 'preview-only-code', user_code: 'TEST-ONLY', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 });
  if (String(url) === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'preview-only-identity' });
  if (String(url) === 'https://api.github.com/user') return Response.json({ id: 308556221, login: '预览账号' });
  return realFetch(url, options);
};
const marker = '<div style="padding:8px 16px;background:#fff0bf;color:#594516;text-align:center;font:14px/1.6 system-ui">交互预览 · 登录和私密区使用示例数据，未连接真实 GitHub 账号</div>';
const server = createServer(async (req, res) => {
  try {
    const base = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
    const url = new URL(req.url, base);
    if (url.pathname === '/' || url.pathname === '/index.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8').replace('<body>', '<body>' + marker)); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const request = new Request(url.href, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
    const response = await handle(request, { DB: db, SITE_URL: base + '/', DEV_ORIGIN: req.headers.origin || base, GITHUB_CLIENT_ID: 'preview-only-client', ALLOWED_GITHUB_ID: '308556221' });
    res.statusCode = response.status; for (const [k, v] of response.headers) res.setHeader(k, v);
    const content = await response.text(); res.end(response.headers.get('Content-Type')?.includes('text/html') ? content.replace('<body>', '<body>' + marker) : content);
  } catch { res.statusCode = 500; res.end('Preview unavailable'); }
});
const portArg = process.argv.indexOf('--port'), hostArg = process.argv.indexOf('--host');
server.listen(Number(portArg >= 0 ? process.argv[portArg + 1] : process.env.PORT) || 3000, hostArg >= 0 ? process.argv[hostArg + 1] : '127.0.0.1', () => console.log('Flare QA preview ready'));
