import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handle } from '../worker/index.mjs';
import { LocalD1, demoState } from './db.mjs';

const origin = 'https://sync.example';
const token = 'a'.repeat(64);
const sha = text => createHash('sha256').update(text).digest('hex');
function setup() { return { DB: new LocalD1(), SITE_URL: 'https://junweiqu-png.github.io/flare/', ALLOWED_GITHUB_ID: '308556221', GITHUB_CLIENT_ID: 'public-test-client' }; }
async function ownerSession(env, id = env.ALLOWED_GITHUB_ID) { await env.DB.prepare('INSERT INTO sessions (token_hash, github_id, login, expires_at) VALUES (?, ?, ?, ?)').bind(sha(token), id, 'owner', Date.now() + 60_000).run(); }
function request(path, { method = 'GET', body, session = true, site = origin } = {}) {
  return new Request(origin + path, { method, headers: { ...(site ? { Origin: site } : {}), ...(session ? { Cookie: '__Host-flare_session=' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function seed(env) { await ownerSession(env); const r = await handle(request('/api/state', { method: 'PUT', body: { expectedVersion: 0, state: demoState() } }), env); assert.equal(r.status, 200); }

test('匿名请求无法读取、初始化、修改或退出其他人的会话', async () => {
  const env = setup();
  for (const [path, method] of [['/api/state', 'GET'], ['/api/state', 'PUT'], ['/auth/logout', 'POST']]) assert.equal((await handle(request(path, { method, session: false }), env)).status, 401);
  await ownerSession(env, 'another-owner');
  assert.equal((await handle(request('/api/state'), env)).status, 403); env.DB.close();
});

test('公开 API 二次过滤私密数据，且不允许携带跨站凭据读取个人区', async () => {
  const env = setup(); await seed(env);
  const r = await handle(request('/api/public', { session: false, site: 'https://junweiqu-png.github.io' }), env), data = await r.json();
  assert.equal(r.status, 200); assert.equal(data.state.links.length, 1); assert.equal(data.state.privateCount, 1);
  assert.ok(!JSON.stringify(data).includes('192.168')); assert.ok(!JSON.stringify(data).includes('测试私密入口'));
  assert.equal(r.headers.get('Access-Control-Allow-Credentials'), null);
  assert.equal((await handle(request('/api/state', { site: 'https://junweiqu-png.github.io' }), env)).status, 403);
  assert.equal((await handle(request('/api/public', { site: 'https://attacker.example' }), env)).status, 403);
  env.DB.close();
});

test('两台设备并发修改时拒绝旧版本，不会静默覆盖', async () => {
  const env = setup(); await seed(env);
  const first = demoState(); first.links[0].name = '设备一修改';
  const second = demoState(); second.links[0].name = '设备二修改';
  const a = await handle(request('/api/state', { method: 'PUT', body: { expectedVersion: 1, state: first } }), env);
  const b = await handle(request('/api/state', { method: 'PUT', body: { expectedVersion: 1, state: second } }), env);
  assert.equal(a.status, 200); assert.equal(b.status, 409);
  const current = await (await handle(request('/api/state'), env)).json();
  assert.equal(current.state.links[0].name, '设备一修改'); assert.equal(current.version, 2); env.DB.close();
});

test('软删除从公开列表移除，恢复后保留原地址与排序', async () => {
  const env = setup(); await seed(env);
  const state = demoState(); state.links[0].deletedAt = new Date().toISOString();
  assert.equal((await handle(request('/api/state', { method: 'PUT', body: { expectedVersion: 1, state } }), env)).status, 200);
  assert.equal((await (await handle(request('/api/public', { session: false }), env)).json()).state.links.length, 0);
  delete state.links[0].deletedAt;
  await handle(request('/api/state', { method: 'PUT', body: { expectedVersion: 2, state } }), env);
  const current = await (await handle(request('/api/state'), env)).json();
  assert.equal(current.state.links[0].url, 'https://example.com/'); env.DB.close();
});

test('退出后旧会话立即失效，Cookie 为 HttpOnly、Secure 和 SameSite', async () => {
  const env = setup(); await seed(env);
  const r = await handle(request('/auth/logout', { method: 'POST', body: {} }), env);
  assert.equal(r.status, 200); assert.match(r.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax; Max-Age=0/);
  assert.equal((await handle(request('/api/state'), env)).status, 401); env.DB.close();
});

test('验证无效输入与超大请求，不写入损坏数据', async () => {
  const env = setup(); await seed(env);
  const invalid = demoState(); invalid.links[0].url = 'javascript:alert(1)';
  assert.equal((await handle(request('/api/state', { method: 'PUT', body: { expectedVersion: 1, state: invalid } }), env)).status, 400);
  const oversized = new Request(origin + '/api/state', { method: 'PUT', headers: { Origin: origin, Cookie: '__Host-flare_session=' + token, 'Content-Type': 'application/json', 'Content-Length': '1600000' }, body: '{}' });
  assert.equal((await handle(oversized, env)).status, 413); env.DB.close();
});

test('GitHub 登录仅确认所有者，丢弃提供商令牌，浏览器只接收安全 Cookie', async () => {
  const env = setup(), originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/login/device/code')) return Response.json({ device_code: 'test-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 });
    if (String(url).endsWith('/login/oauth/access_token')) return Response.json({ access_token: 'test-provider-token-never-store' });
    if (String(url) === 'https://api.github.com/user') return Response.json({ id: 308556221, login: 'owner' });
    throw new Error('Unexpected URL');
  };
  try {
    const start = await (await handle(request('/auth/device/start', { method: 'POST', body: {}, session: false }), env)).json();
    assert.equal(start.userCode, 'ABCD-EFGH'); assert.ok(!start.deviceCode);
    env.DB.sql.exec('UPDATE login_flows SET next_poll_at = 0');
    const result = await handle(request('/auth/device/poll', { method: 'POST', body: { flowToken: start.flowToken }, session: false }), env);
    const body = await result.json(); assert.equal(body.login, 'owner'); assert.ok(!body.token);
    assert.match(result.headers.get('Set-Cookie'), /__Host-flare_session=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax/);
    const dump = env.DB.sql.prepare('SELECT payload FROM login_flows').all(); assert.ok(!JSON.stringify(dump).includes('test-provider-token-never-store'));
    assert.ok(!dump[0].payload.includes('test-device-code'));
  } finally { globalThis.fetch = originalFetch; env.DB.close(); }
});

test('GitHub 账号不匹配时不创建会话', async () => {
  const env = setup(), originalFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url).endsWith('/login/device/code') ? Response.json({ device_code: 'test-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 }) : String(url).endsWith('/login/oauth/access_token') ? Response.json({ access_token: 'test-only' }) : Response.json({ id: 123, login: 'someone-else' });
  try {
    const start = await (await handle(request('/auth/device/start', { method: 'POST', body: {}, session: false }), env)).json(); env.DB.sql.exec('UPDATE login_flows SET next_poll_at = 0');
    assert.equal((await handle(request('/auth/device/poll', { method: 'POST', body: { flowToken: start.flowToken }, session: false }), env)).status, 403);
    assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  } finally { globalThis.fetch = originalFetch; env.DB.close(); }
});
