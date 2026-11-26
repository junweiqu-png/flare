import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeItem, normalizeState, needsPrivacy, publicState, networkScope, mergeImported, searchMatches, destination } from '../src/model.mjs';
import { demoState } from './db.mjs';

test('内网、编码 IP、本机和凭据地址均自动转为私密', () => {
  for (const url of ['http://192.168.1.30:5080/', 'http://2130706433/', 'http://10.1.2.3/', 'http://172.20.0.1/', 'http://[::1]/', 'http://[fd12::1]/', 'http://[::ffff:192.168.1.1]/', 'http://nas.local/', 'https://example.com/?token=sample', 'https://example.com/#/login?api_key=sample', 'https://user:pass@example.com/']) {
    assert.equal(normalizeItem({ id: 'test', name: '测试', url, private: false }).private, true, url);
  }
  assert.equal(needsPrivacy({ url: 'https://example.com/?page=2' }), false);
  assert.equal(networkScope('https://172.32.0.1/'), '');
});

test('公开投影不含私密名称、地址和回收站', () => {
  const input = demoState(); input.links.push({ id: 'deleted', name: '已删除', url: 'https://deleted.example/', deletedAt: '2026-01-01T00:00:00Z' });
  const output = publicState(input), serialized = JSON.stringify(output);
  assert.equal(output.links.length, 1); assert.equal(output.privateCount, 1); assert.equal(output.totalCount, 2);
  assert.ok(!serialized.includes('测试私密入口')); assert.ok(!serialized.includes('192.168')); assert.ok(!serialized.includes('已删除'));
});

test('禁止可执行网址、重复编号和无效备份', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'https://exa mple.com/']) assert.throws(() => normalizeItem({ id: 'test', name: '测试', url }));
  const state = demoState(); state.links[1].id = state.links[0].id;
  assert.throws(() => normalizeState(state), /编号重复/);
  assert.throws(() => normalizeState({ schemaVersion: 1, links: [] }));
  assert.throws(() => normalizeItem({ id: 'invalid-legacy', name: '缺少地址', legacyPrivateId: 'invalid' }));
});

test('导入合并不覆盖已有条目，去掉重复地址', () => {
  const current = normalizeState(demoState()), incoming = normalizeState(demoState());
  incoming.links[0].id = 'another-id'; incoming.links[0].name = '尝试覆盖';
  incoming.links.push(normalizeItem({ id: 'new', name: '新增', url: 'https://new.example/', category: '新分类' }));
  const output = mergeImported(current, incoming);
  assert.equal(output.added, 1); assert.equal(output.skipped, 2); assert.equal(output.state.links[0].name, '公开测试入口');
  assert.ok(output.state.categories.includes('新分类'));
});

test('搜索覆盖别名、标签和组合词；双地址按设备偏好选择', () => {
  const item = normalizeState(demoState()).links[0]; item.internalUrl = 'http://192.168.1.3/';
  assert.equal(searchMatches(item, 'GONGKAI 示例'), true); assert.equal(searchMatches(item, '缺失'), false);
  assert.equal(destination(item, 'internal'), 'http://192.168.1.3/'); assert.equal(destination(item, 'external'), 'https://example.com/');
});

test('发布数据和生成页面保持公开；JSON 内嵌不形成脚本标签', () => {
  const data = JSON.parse(readFileSync(new URL('../data/nav.json', import.meta.url), 'utf8'));
  assert.equal(data.links.length + data.privateCount, data.totalCount);
  assert.ok(data.links.every(x => !x.private && !needsPrivacy(x)));
  const page = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.ok(page.includes('Content-Security-Policy'));
  const appData = page.match(/<script type="application\/json" id="nav-data">([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(appData), data);
});
