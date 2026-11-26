import { normalizeState, publicState } from '../src/model.mjs';
import { APP_HTML, APP_BUILD_ID } from './generated-app.mjs';

const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
const BODY_LIMIT = 1_500_000;
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...extra } });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const hashToken = async text => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
const cookieName = '__Host-flare_session';
const sessionCookie = token => `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_AGE / 1000}`;

async function bodyJSON(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail('请求格式不正确。', 415);
  if (Number(request.headers.get('Content-Length') || 0) > BODY_LIMIT) fail('数据过大。', 413);
  const reader = request.body?.getReader();
  if (!reader) fail('缺少请求内容。');
  let size = 0; const parts = [];
  for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > BODY_LIMIT) { await reader.cancel(); fail('数据过大。', 413); } parts.push(r.value); }
  const all = new Uint8Array(size); let offset = 0;
  for (const p of parts) { all.set(p, offset); offset += p.length; }
  try { return JSON.parse(new TextDecoder().decode(all)); } catch { fail('请求内容不是有效的 JSON。'); }
}

async function getSession(request, env) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
    || request.headers.get('Cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (token && !/^[a-f0-9]{64}$/.test(token)) fail('登录凭据无效。', 401);
  if (!token) fail('请先使用 GitHub 登录。', 401);
  const hash = await hashToken(token);
  const session = await env.DB.prepare('SELECT github_id, login, expires_at FROM sessions WHERE token_hash = ?').bind(hash).first();
  if (!session || session.expires_at <= Date.now()) fail('登录已过期，请重新登录。', 401);
  if (String(session.github_id) !== String(env.ALLOWED_GITHUB_ID)) fail('此账号没有编辑权限。', 403);
  return { ...session, hash };
}

async function startLogin(request, env) {
  if (!env.GITHUB_CLIENT_ID || env.GITHUB_CLIENT_ID.startsWith('SET_')) fail('GitHub 登录尚未配置。', 503);
  const now = Date.now(), window = Math.floor(now / 3_600_000);
  const ipHash = await hashToken(request.headers.get('CF-Connecting-IP') || 'unknown');
  const key = `${ipHash}:${window}`;
  const rate = await env.DB.prepare('INSERT INTO rate_limits (id, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1 RETURNING count').bind(key, now + 3_600_000).first();
  if (rate.count > 8) fail('登录尝试较多，请稍后再试。', 429);
  const response = await fetch('https://github.com/login/device/code', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Flare-Navigation' }, body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, scope: '' }) });
  if (!response.ok) fail('暂时无法连接 GitHub，请稍后重试。', 502);
  const flow = await response.json();
  if (!flow.device_code || !flow.user_code || flow.verification_uri !== 'https://github.com/login/device') fail('GitHub 登录配置不可用。', 502);
  const token = randomToken();
  const expiresAt = now + Math.min(Number(flow.expires_in) || 900, 900) * 1000;
  const interval = Math.max(5, Number(flow.interval) || 5);
  await env.DB.prepare('INSERT INTO login_flows (token_hash, payload, next_poll_at, expires_at) VALUES (?, ?, ?, ?)').bind(await hashToken(token), JSON.stringify({ deviceCode: flow.device_code, interval }), now + interval * 1000, expiresAt).run();
  return reply({ flowToken: token, userCode: flow.user_code, verificationUri: flow.verification_uri, interval, expiresAt });
}

async function pollLogin(request, env) {
  const input = await bodyJSON(request);
  if (!/^[a-f0-9]{64}$/.test(input.flowToken || '')) fail('登录请求无效。');
  const hash = await hashToken(input.flowToken), now = Date.now();
  const row = await env.DB.prepare('SELECT payload, next_poll_at, expires_at FROM login_flows WHERE token_hash = ?').bind(hash).first();
  if (!row || row.expires_at <= now) fail('登录验证码已过期，请重新开始。', 410);
  const flow = JSON.parse(row.payload);
  if (flow.result) return reply({ login: flow.result.login, expiresAt: flow.result.expiresAt }, 200, { 'Set-Cookie': sessionCookie(flow.result.token) });
  if (row.next_poll_at > now) return reply({ pending: true, interval: Math.max(1, Math.ceil((row.next_poll_at - now) / 1000)) });
  const lease = await env.DB.prepare('UPDATE login_flows SET next_poll_at = ? WHERE token_hash = ? AND next_poll_at = ?').bind(now + flow.interval * 1000, hash, row.next_poll_at).run();
  if (!lease.meta.changes) return reply({ pending: true, interval: flow.interval });
  const response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Flare-Navigation' }, body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, device_code: flow.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
  if (!response.ok) fail('暂时无法确认 GitHub 登录，请重试。', 502);
  const result = await response.json();
  if (result.error === 'authorization_pending') return reply({ pending: true, interval: flow.interval });
  if (result.error === 'slow_down') {
    flow.interval = Math.max(flow.interval + 5, Number(result.interval) || 0);
    await env.DB.prepare('UPDATE login_flows SET payload = ?, next_poll_at = ? WHERE token_hash = ?').bind(JSON.stringify(flow), now + flow.interval * 1000, hash).run();
    return reply({ pending: true, interval: flow.interval });
  }
  if (!result.access_token) { await env.DB.prepare('DELETE FROM login_flows WHERE token_hash = ?').bind(hash).run(); fail(result.error === 'access_denied' ? '已取消 GitHub 授权。' : '登录未完成，请重新开始。', 401); }
  // Use the GitHub token only to identify the owner; never persist it or return it to the browser.
  const identityResponse = await fetch('https://api.github.com/user', { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${result.access_token}`, 'User-Agent': 'Flare-Navigation', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (!identityResponse.ok) fail('GitHub 身份确认失败，请重新登录。', 502);
  const identity = await identityResponse.json();
  if (String(identity.id) !== String(env.ALLOWED_GITHUB_ID)) { await env.DB.prepare('DELETE FROM login_flows WHERE token_hash = ?').bind(hash).run(); fail('请使用导航所有者的 GitHub 账号登录。', 403); }
  const sessionToken = randomToken(), expiresAt = now + SESSION_AGE;
  const answer = { token: sessionToken, login: identity.login, expiresAt };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (token_hash, github_id, login, expires_at) VALUES (?, ?, ?, ?)').bind(await hashToken(sessionToken), String(identity.id), identity.login, expiresAt),
    env.DB.prepare('UPDATE login_flows SET payload = ? WHERE token_hash = ?').bind(JSON.stringify({ result: answer }), hash),
  ]);
  return reply({ login: answer.login, expiresAt }, 200, { 'Set-Cookie': sessionCookie(sessionToken) });
}

async function routes(request, env) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (path === '/' || path === '/app') return new Response(APP_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } });
  if (path === '/version.json') return reply({ buildId: APP_BUILD_ID });
  if (path === '/health') return reply({ service: 'Flare 导航同步', ready: Boolean(env.DB && env.GITHUB_CLIENT_ID && !env.GITHUB_CLIENT_ID.startsWith('SET_') && env.ALLOWED_GITHUB_ID), schemaVersion: 2 });
  if (!env.DB || !env.ALLOWED_GITHUB_ID) fail('同步服务尚未配置完成。', 503);
  if (path === '/auth/device/start' && method === 'POST') return startLogin(request, env);
  if (path === '/auth/device/poll' && method === 'POST') return pollLogin(request, env);
  if (path === '/api/public' && method === 'GET') {
    const row = await env.DB.prepare("SELECT document, version, updated_at FROM navigation WHERE id = 'main'").first();
    if (!row) return reply({ uninitialized: true }, 503);
    return reply({ state: publicState(JSON.parse(row.document)), version: row.version, updatedAt: row.updated_at });
  }
  const session = await getSession(request, env);
  if (path === '/auth/logout' && method === 'POST') { await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session.hash).run(); return reply({ ok: true }, 200, { 'Set-Cookie': `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` }); }
  if (path === '/api/me' && method === 'GET') return reply({ login: session.login, expiresAt: session.expires_at });
  if (path === '/api/state' && method === 'GET') {
    const row = await env.DB.prepare("SELECT document, version, updated_at FROM navigation WHERE id = 'main'").first();
    return reply(row ? { state: JSON.parse(row.document), version: row.version, updatedAt: row.updated_at } : { state: null, version: 0 });
  }
  if (path === '/api/state' && method === 'PUT') {
    const input = await bodyJSON(request);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) fail('缺少有效的数据版本。');
    let state;
    try { state = normalizeState(input.state); } catch (error) { fail(error.message); }
    const now = Date.now();
    let result;
    if (input.expectedVersion === 0) result = await env.DB.prepare("INSERT OR IGNORE INTO navigation (id, version, document, updated_at) VALUES ('main', 1, ?, ?)").bind(JSON.stringify(state), now).run();
    else result = await env.DB.prepare("UPDATE navigation SET document = ?, version = version + 1, updated_at = ? WHERE id = 'main' AND version = ?").bind(JSON.stringify(state), now, input.expectedVersion).run();
    if (!result.meta.changes) return reply({ message: '其他设备已更新导航。已保留当前输入，请刷新数据后重试。', conflict: true }, 409);
    return reply({ state, version: input.expectedVersion + 1, updatedAt: now });
  }
  return reply({ message: '找不到这个接口。' }, 404);
}

export async function handle(request, env) {
  const siteOrigin = new URL(env.SITE_URL || 'https://junweiqu-png.github.io/flare/').origin;
  const origin = request.headers.get('Origin');
  const ownOrigin = new URL(request.url).origin;
  const allowed = !origin || origin === siteOrigin || origin === ownOrigin || (env.DEV_ORIGIN && origin === env.DEV_ORIGIN);
  const cors = { 'Vary': 'Origin', ...(origin && allowed ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Max-Age': '600' } : {}) };
  if (!allowed) return reply({ message: '此网页不能访问该同步服务。' }, 403);
  const publicPaths = ['/', '/app', '/health', '/version.json', '/api/public'];
  if (origin && origin !== ownOrigin && origin !== env.DEV_ORIGIN && !publicPaths.includes(new URL(request.url).pathname) && request.method !== 'OPTIONS') return reply({ message: '请在个人导航页面操作。' }, 403);
  // Cookie-authenticated writes are accepted only from the isolated personal app.
  // Public GitHub Pages reads never receive credentialed CORS access.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.has('Cookie') && origin !== ownOrigin && origin !== env.DEV_ORIGIN) return reply({ message: '请在个人导航页面操作。' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  let response;
  try { response = await routes(request, env); }
  catch (error) { response = reply({ message: error.status ? error.message : '同步暂时不可用，请稍后重试。' }, error.status || 500); }
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export default { fetch: handle, async scheduled(_event, env) {
  const now = Date.now();
  await env.DB.batch(['sessions', 'login_flows', 'rate_limits'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE expires_at < ?`).bind(now)));
} };
