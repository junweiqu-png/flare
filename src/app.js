import { normalizeState, normalizeItem, publicState, needsPrivacy, networkScope, searchMatches, destination, mergeImported, httpURL } from './model.mjs';

const $ = id => document.getElementById(id);
const SEED = JSON.parse($('nav-data').textContent);
const CONFIG = JSON.parse($('client-config').textContent);
const PRIVATE_APP = Boolean(CONFIG.privateApp);
const API = PRIVATE_APP ? location.origin : (CONFIG.apiBase || '').replace(/\/$/, '');
const local = {
  get(key) { try { return localStorage.getItem('flare-v2-' + key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem('flare-v2-' + key, value); } catch {} },
};
let state = normalizeState(SEED), version = 0, owner = null, busy = false, managing = false;
let privateCount = SEED.privateCount || 0, category = null, dragged = null, loginFlow = null, loginTimer = null;
let importPending = null, renamedCategory = null, editorVersion = 0;
let mode = local.get('network') === 'internal' ? 'internal' : 'external';
let toastTimer;
let locallyLocked = local.get('locked') === '1';

function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000); }
function showError(id, error) { $(id).textContent = error.message || String(error); $(id).hidden = false; }
function button(label, title, handler) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', e => { e.stopPropagation(); handler(); }); return b; }
function element(tag, cls, content) { const e = document.createElement(tag); if (cls) e.className = cls; if (content != null) e.textContent = content; return e; }
function clone() { return structuredClone(state); }
function syncText(message) { $('sync-status').textContent = message; }
function anyDialog() { return Boolean(document.querySelector('dialog[open]')); }
function activeItems() { return state.links.filter(x => !x.deletedAt); }

document.documentElement.dataset.theme = local.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
$('theme').addEventListener('click', () => { const value = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = value; local.set('theme', value); });
const clockFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
const dayFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short' });
function tick() { const now = new Date(); $('clock').textContent = clockFormat.format(now); $('date').textContent = dayFormat.format(now); const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(now)); $('greeting').textContent = h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'; }
tick(); setInterval(tick, 60_000);
$('version').textContent = `v${CONFIG.release} · ${CONFIG.buildId}`;
$('public-home').hidden = !PRIVATE_APP;

async function api(path, options = {}) {
  if (!API) throw new Error('同步服务尚未接通，当前显示公开导航快照。');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(API + path, { method: options.method || 'GET', credentials: PRIVATE_APP ? 'same-origin' : 'omit', cache: 'no-store', headers: options.body ? { 'Content-Type': 'application/json' } : {}, ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: controller.signal });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.message || '暂时无法同步，请稍后重试。'), { status: response.status, conflict: result.conflict });
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接同步服务超时，当前数据仍保留。');
    throw error;
  } finally { clearTimeout(timer); }
}

function rememberPublic() {
  const safe = owner ? publicState(state) : { ...state, privateCount };
  local.set('public-cache', JSON.stringify({ state: safe, version }));
}

function lock() {
  if (owner) { const safe = publicState(state); state = normalizeState(safe); privateCount = safe.privateCount; }
  owner = null; managing = false; importPending = null;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  $('editor-form').reset(); $('rename-form').reset(); $('import-file').value = '';
  render();
}

async function refresh({ quiet = false } = {}) {
  if (busy) return;
  if (!quiet) syncText('正在同步…');
  try {
    if (PRIVATE_APP && !locallyLocked) {
      try {
        const me = await api('/api/me');
        const current = await api('/api/state');
        owner = me.login; version = current.version;
        if (current.state) state = normalizeState(current.state);
        privateCount = activeItems().filter(x => x.private).length || (current.version === 0 ? SEED.privateCount : 0);
        rememberPublic(); render();
        syncText(current.version ? `已同步 · ${new Date(current.updatedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}` : '已登录 · 请先导入完整导航备份');
        return;
      } catch (error) { if (error.status !== 401) throw error; lock(); }
    }
    const current = await api('/api/public');
    state = normalizeState(current.state); version = current.version; privateCount = current.state.privateCount || 0;
    rememberPublic(); render(); syncText('公开导航 · 已同步');
  } catch (error) {
    if (!owner) { try { const cached = JSON.parse(local.get('public-cache')); if (cached?.state) { state = normalizeState(cached.state); privateCount = cached.state.privateCount || 0; version = cached.version || 0; } } catch {} }
    render(); syncText(owner ? '连接暂时中断 · 云端修改尚未完成' : '公开导航快照 · 同步暂不可用');
    if (!quiet) toast(error.message);
  }
}

function requireOwner() {
  if (owner && PRIVATE_APP) return true;
  if (!PRIVATE_APP) { if (!API) { toast('同步服务配置中，当前可以浏览和导出公开导航。'); return false; } location.assign(API + '/app'); return false; }
  $('login-error').hidden = true; $('login-dialog').showModal(); return false;
}

async function save(next, expectedVersion = version) {
  if (!requireOwner()) return false;
  if (busy) throw new Error('上一项修改正在同步，请稍候。');
  if (expectedVersion !== version) throw new Error('其他设备已更新导航。输入仍保留，请先复制需要保留的内容，关闭后重新编辑。');
  const checked = normalizeState(next);
  busy = true; syncText('正在保存并同步…');
  try {
    const answer = await api('/api/state', { method: 'PUT', body: { expectedVersion, state: checked } });
    state = normalizeState(answer.state); version = answer.version; privateCount = activeItems().filter(x => x.private).length;
    rememberPublic(); render(); syncText('已同步 · 刚刚'); return true;
  } catch (error) {
    busy = false;
    if (error.status === 401) { lock(); syncText('登录已过期，请重新登录。'); toast('登录已过期，这次修改尚未同步。'); }
    else if (error.conflict) { await refresh({ quiet: true }); throw new Error('其他设备已更新导航。输入仍保留，请先复制需要保留的内容，关闭后重新编辑。'); }
    else syncText('保存未完成 · 当前输入仍保留');
    throw error;
  } finally { busy = false; }
}

function iconFor(item) { if (/NAS|DS213/i.test(item.name)) return 'NAS'; if (/Bitwarden/i.test(item.name)) return 'BW'; if (/PiKVM/i.test(item.name)) return 'KVM'; return item.name.replace(/[^a-zA-Z\u3400-\u9fff]/g, '').slice(0, 2).toUpperCase() || '✦'; }

function card(item, pinned = false) {
  const wrap = element('article', 'entry-card'); wrap.dataset.linkId = item.id;
  const url = destination(item, mode), link = element(url ? 'a' : 'button', 'entry-link');
  if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = item.description || item.name; }
  else { link.type = 'button'; link.addEventListener('click', () => openEditor(item)); }
  link.append(element('span', 'entry-icon', iconFor(item)));
  const text = element('span', 'entry-text'); text.append(element('span', 'entry-name', item.name));
  const scope = url ? networkScope(url) : '待设置';
  const detail = item.description || (url ? (scope || new URL(url).hostname) : '点击补充地址');
  text.append(element('div', 'entry-detail', detail));
  const badges = [];
  if (item.private) badges.push('私密');
  if (scope && detail !== scope) badges.push(scope);
  if (item.url && item.internalUrl) badges.push(mode === 'internal' ? '内网入口' : '外网入口');
  badges.push(...item.tags.slice(0, 2));
  if (badges.length) { const b = element('span', 'entry-badges'); for (const label of badges) b.append(element('span', 'badge', label)); text.append(b); }
  link.append(text); wrap.append(link);
  if (owner) {
    const actions = element('div', 'entry-actions');
    actions.append(button(item.pinned ? '★' : '☆', `${item.pinned ? '取消置顶' : '置顶'} ${item.name}`, async () => { try { const next = clone(); next.links.find(x => x.id === item.id).pinned = !item.pinned; await save(next); } catch (e) { toast(e.message); } }));
    actions.append(button('↑', `上移 ${item.name}`, () => moveRelative(item, -1, pinned)));
    actions.append(button('↓', `下移 ${item.name}`, () => moveRelative(item, 1, pinned)));
    actions.append(button('✎', `编辑 ${item.name}`, () => openEditor(item))); wrap.append(actions);
    let hold, start, held = false;
    link.addEventListener('pointerdown', event => { if (event.pointerType !== 'touch') return; start = [event.clientX, event.clientY]; held = false; hold = setTimeout(() => { held = true; openEditor(item); }, 600); });
    link.addEventListener('pointermove', e => { if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10) clearTimeout(hold); });
    for (const event of ['pointerup', 'pointercancel']) link.addEventListener(event, () => clearTimeout(hold));
    link.addEventListener('click', event => { if (held) { event.preventDefault(); held = false; } });
    wrap.draggable = managing;
    wrap.addEventListener('dragstart', e => { if (!managing) { e.preventDefault(); return; } dragged = item.id; e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move'; wrap.classList.add('dragging'); });
    wrap.addEventListener('dragend', () => { dragged = null; wrap.classList.remove('dragging'); document.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target')); });
    wrap.addEventListener('dragover', e => { if (managing && dragged && dragged !== item.id) { e.preventDefault(); wrap.classList.add('drop-target'); } });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('drop-target'));
    wrap.addEventListener('drop', async e => { e.preventDefault(); wrap.classList.remove('drop-target'); if (!managing || !dragged || dragged === item.id) return; const source = dragged; dragged = null; try { const next = clone(), i = next.links.findIndex(x => x.id === source), moved = next.links.splice(i, 1)[0]; if (!moved) return; if (pinned) moved.pinned = true; else moved.category = item.category; next.links.splice(next.links.findIndex(x => x.id === item.id), 0, moved); await save(next); } catch (error) { toast(error.message); } });
  }
  return wrap;
}

async function moveRelative(item, delta, pinned) {
  const list = activeItems().filter(x => pinned ? x.pinned : x.category === item.category);
  const index = list.findIndex(x => x.id === item.id), target = list[index + delta];
  if (!target) { toast(delta < 0 ? '已经在最前面。' : '已经在最后面。'); return; }
  try { const next = clone(), a = next.links.findIndex(x => x.id === item.id), b = next.links.findIndex(x => x.id === target.id); [next.links[a], next.links[b]] = [next.links[b], next.links[a]]; await save(next); } catch (error) { toast(error.message); }
}

function render() {
  const active = activeItems(), query = $('search').value.trim();
  if (category && category !== '@pinned' && !active.some(x => x.category === category)) category = null;
  const names = [...state.categories.filter(c => active.some(x => x.category === c)), ...new Set(active.map(x => x.category).filter(c => !state.categories.includes(c)))];
  const filters = document.createDocumentFragment();
  for (const [value, title] of [[null, '全部'], ['@pinned', '置顶'], ...names.map(x => [x, x])]) {
    const b = button(title, title, () => { category = value; render(); }); b.className = 'filter'; b.setAttribute('aria-pressed', String(category === value));
    b.append(element('span', '', value === null ? active.length : value === '@pinned' ? active.filter(x => x.pinned).length : active.filter(x => x.category === value).length)); filters.append(b);
  }
  $('filters').replaceChildren(filters);
  const matches = active.filter(x => (category === null || (category === '@pinned' ? x.pinned : x.category === category)) && searchMatches(x, query));
  const pins = matches.filter(x => x.pinned);
  $('pinned').replaceChildren(...pins.map(x => card(x, true))); $('pinned-count').textContent = pins.length + ' 个'; $('pinned-section').hidden = !pins.length;
  const groups = document.createDocumentFragment();
  if (category !== '@pinned') for (const name of names) {
    const items = matches.filter(x => x.category === name); if (!items.length) continue;
    const group = element('section', 'group'); group.setAttribute('aria-label', name); const head = element('div', 'group-head'), title = element('div', 'group-title');
    title.append(element('h3', '', name), element('span', 'subtle', items.length)); head.append(title);
    if (owner) { const rename = button('✎', `修改分类 ${name}`, () => { renamedCategory = name; $('rename-input').value = name; $('rename-error').hidden = true; $('rename-dialog').showModal(); }); rename.className = 'rename-category'; head.append(rename); }
    const container = element('div', 'group-items'); container.append(...items.map(x => card(x))); group.append(head, container); groups.append(group);
  }
  $('groups').replaceChildren(groups); $('links-section').hidden = category === '@pinned' || !matches.length;
  $('links-count').textContent = matches.length + ' 个'; $('empty').hidden = matches.length > 0;
  $('clear-search').hidden = !query; $('result-status').hidden = !query; $('result-status').textContent = `找到 ${matches.length} 个入口`;
  $('footer-count').textContent = owner ? `${active.length} 个入口 · ${active.filter(x => x.private).length} 个私密 · ${state.categories.length} 个分类` : `${active.length} 个公开入口 · ${privateCount} 个私密入口需登录`;
  $('private-notice').hidden = Boolean(owner) || !privateCount;
  $('private-notice-text').textContent = `另有 ${privateCount} 个私密入口，登录后显示名称和地址。`;
  $('account').textContent = owner ? '退出登录' : 'GitHub 登录';
  $('account').title = owner ? `当前 GitHub 账号：${owner}` : '打开个人导航并使用 GitHub 登录';
  document.body.classList.toggle('manage-mode', Boolean(owner && managing)); $('manage').setAttribute('aria-pressed', String(managing)); $('manage').textContent = managing ? '完成整理' : '整理';
  $('network-external').setAttribute('aria-pressed', String(mode === 'external')); $('network-internal').setAttribute('aria-pressed', String(mode === 'internal'));
  $('category-options').replaceChildren(...[...new Set([...state.categories, '常用应用'])].map(x => { const o = document.createElement('option'); o.value = x; return o; }));
  if ($('backup').open) renderTrash();
}

function openEditor(item = null) {
  if (!requireOwner()) return;
  $('editor-form').reset(); $('editor-title').textContent = item ? '编辑入口' : '新增入口'; $('editor-error').hidden = true;
  editorVersion = version;
  const value = item || { id: '', name: '', url: '', internalUrl: '', category: category && category !== '@pinned' ? category : state.categories[0] || '未分类', kind: 'bookmarks', aliases: [], tags: [], pinned: false, private: false };
  for (const key of ['id', 'name', 'url', 'internalUrl', 'category', 'kind', 'description']) $(key === 'internalUrl' ? 'edit-internal' : 'edit-' + key).value = value[key] || '';
  $('edit-aliases').value = value.aliases.join(', '); $('edit-tags').value = value.tags.join(', '); $('edit-pinned').checked = value.pinned; $('edit-private').checked = value.private;
  $('delete-link').hidden = !item; updatePrivacyHint(); $('editor').showModal(); $('edit-name').focus();
}

function updatePrivacyHint() {
  let required = false;
  try { required = needsPrivacy({ url: $('edit-url').value.trim(), internalUrl: $('edit-internal').value.trim(), category: $('edit-category').value }); } catch {}
  if (required) $('edit-private').checked = true;
  $('edit-private').disabled = required;
  $('privacy-hint').textContent = required ? '检测到内网、本机或敏感地址，已自动设为私密。' : '私密入口的名称和地址仅在登录后显示。';
}
for (const id of ['edit-url', 'edit-internal', 'edit-category']) $(id).addEventListener('input', updatePrivacyHint);
$('editor-form').addEventListener('submit', async event => {
  event.preventDefault(); $('editor-error').hidden = true; $('save-link').disabled = true;
  try {
    const next = clone(), id = $('edit-id').value || crypto.randomUUID(); const old = next.links.find(x => x.id === id);
    const list = id => $(id).value.split(/[,，\n]/).map(x => x.trim()).filter(Boolean);
    const item = normalizeItem({ id, name: $('edit-name').value, url: $('edit-url').value, internalUrl: $('edit-internal').value, category: $('edit-category').value, kind: $('edit-kind').value, description: $('edit-description').value, aliases: list('edit-aliases'), tags: list('edit-tags'), pinned: $('edit-pinned').checked, private: $('edit-private').checked, ...(old?.legacyPrivateId ? { legacyPrivateId: old.legacyPrivateId } : {}) });
    if ((item.url || item.internalUrl) && item.legacyPrivateId) delete item.legacyPrivateId;
    const index = next.links.findIndex(x => x.id === id); if (index < 0) next.links.push(item); else next.links[index] = item;
    if (await save(next, editorVersion)) { $('editor').close(); $('editor-form').reset(); toast('已保存，其他设备会自动同步。'); }
  } catch (error) { showError('editor-error', error); } finally { $('save-link').disabled = false; }
});

let confirmAction = null;
$('delete-link').addEventListener('click', () => { const id = $('edit-id').value, item = state.links.find(x => x.id === id); if (!item) return; $('confirm-description').textContent = item.name; confirmAction = async () => { const next = clone(); next.links.find(x => x.id === id).deletedAt = new Date().toISOString(); await save(next, editorVersion); $('editor').close(); $('editor-form').reset(); toast('已移入回收站，可随时恢复。'); }; $('confirm-dialog').showModal(); });
$('confirm-cancel').addEventListener('click', () => { confirmAction = null; $('confirm-dialog').close(); });
$('confirm-accept').addEventListener('click', async () => { $('confirm-accept').disabled = true; try { if (confirmAction) await confirmAction(); $('confirm-dialog').close(); } catch (error) { $('confirm-dialog').close(); showError('editor-error', error); } finally { confirmAction = null; $('confirm-accept').disabled = false; } });
$('rename-form').addEventListener('submit', async event => { event.preventDefault(); $('rename-save').disabled = true; $('rename-error').hidden = true; try { const name = $('rename-input').value.trim(); if (!name) throw new Error('请填写分类名称。'); const next = clone(); next.categories = [...new Set(next.categories.map(x => x === renamedCategory ? name : x))]; for (const x of next.links) if (x.category === renamedCategory) x.category = name; if (await save(next)) { if (category === renamedCategory) category = name; $('rename-dialog').close(); render(); toast('分类已同步更新。'); } } catch (error) { showError('rename-error', error); } finally { $('rename-save').disabled = false; } });

function renderTrash() {
  const items = owner ? state.links.filter(x => x.deletedAt) : [];
  $('export-private').disabled = !owner; if (!owner) $('export-private').checked = false;
  $('trash-login').hidden = Boolean(owner); $('trash-count').textContent = owner ? items.length + ' 个' : '';
  $('trash-list').replaceChildren(...items.map(item => { const row = element('div', 'trash-row'), text = element('span', '', item.name); text.append(element('span', 'subtle', item.category + ' · ' + new Date(item.deletedAt).toLocaleDateString('zh-CN'))); const restore = button('恢复', '恢复 ' + item.name, async () => { restore.disabled = true; try { const next = clone(); delete next.links.find(x => x.id === item.id).deletedAt; await save(next); toast('已恢复并同步。'); } catch (error) { showError('backup-error', error); restore.disabled = false; } }); restore.className = 'button'; row.append(text, restore); return row; }));
  if (owner && !items.length) $('trash-list').append(element('p', 'hint', '回收站为空。'));
}

$('tools').addEventListener('click', () => { $('backup-error').hidden = true; $('export-private').checked = false; renderTrash(); $('backup').showModal(); });
$('export-data').addEventListener('click', () => {
  const full = Boolean(owner && $('export-private').checked), data = full ? clone() : publicState(state);
  const output = { schemaVersion: 2, title: data.title, categories: data.categories, links: data.links };
  const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `flare-${full ? 'private' : 'public'}-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000); toast(full ? '已下载完整备份，请妥善保存。' : '已下载公开导航备份。');
});

function parseImport(text) {
  try { return normalizeState(JSON.parse(text)); } catch (error) { if (!/<!DOCTYPE|<DL|<A\s/i.test(text)) throw error; }
  const doc = new DOMParser().parseFromString(text, 'text/html'), links = [];
  for (const a of doc.querySelectorAll('a[href]')) {
    try {
      const url = httpURL(a.getAttribute('href'), false), name = a.textContent.trim() || new URL(url).hostname;
      let folder = a.closest('dl'), categoryName = '导入书签';
      if (folder) { const title = folder.previousElementSibling?.querySelector('h3') || folder.parentElement?.querySelector(':scope > h3'); if (title?.textContent.trim()) categoryName = title.textContent.trim(); }
      links.push(normalizeItem({ id: crypto.randomUUID(), name, url, category: categoryName, kind: 'bookmarks' }));
    } catch {}
  }
  if (!links.length) throw new Error('没有找到可导入的 HTTP／HTTPS 书签。');
  return normalizeState({ schemaVersion: 2, title: state.title, categories: [], links });
}
$('import-file').addEventListener('change', async () => {
  importPending = null; $('import-confirm').hidden = true; $('backup-error').hidden = true;
  const file = $('import-file').files[0]; if (!file) return;
  if (!owner) { $('backup').close(); requireOwner(); return; }
  try { if (file.size > 1_500_000) throw new Error('备份文件超过 1.5 MB，请拆分后导入。'); importPending = parseImport(await file.text()); const merged = mergeImported(state, importPending); $('import-status').textContent = `将新增 ${merged.added} 个入口，跳过 ${merged.skipped} 个已有入口。原有数据会保留。`; $('import-confirm').hidden = false; } catch (error) { showError('backup-error', error); }
});
$('import-confirm').addEventListener('click', async () => { if (!importPending) return; $('import-confirm').disabled = true; try { const merged = mergeImported(state, importPending); await save(merged.state); importPending = null; $('import-confirm').hidden = true; $('import-file').value = ''; $('import-status').textContent = `已导入 ${merged.added} 个入口。`; } catch (error) { showError('backup-error', error); } finally { $('import-confirm').disabled = false; } });

$('account').addEventListener('click', async () => { if (!owner) { requireOwner(); return; } locallyLocked = true; local.set('locked', '1'); lock(); try { await api('/auth/logout', { method: 'POST', body: {} }); syncText('已退出 · 仅显示公开入口'); toast('已退出，私密入口已从本页清除。'); } catch { syncText('本页已锁定 · 服务端退出尚未确认'); toast('本页私密内容已清除；联网后请重新登录以管理会话。'); } });
$('unlock').addEventListener('click', requireOwner);
$('add-link').addEventListener('click', () => openEditor());
$('manage').addEventListener('click', () => { if (requireOwner()) { managing = !managing; render(); } });
$('refresh-data').addEventListener('click', () => refresh());
for (const value of ['external', 'internal']) $('network-' + value).addEventListener('click', () => { mode = value; local.set('network', mode); render(); });
$('search').addEventListener('input', render);
function clearSearch() { $('search').value = ''; category = null; render(); $('search').focus(); }
$('clear-search').addEventListener('click', clearSearch); $('reset-search').addEventListener('click', clearSearch);
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !anyDialog() && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { event.preventDefault(); $('search').focus(); }
  if (document.activeElement === $('search')) { if (event.key === 'Escape') clearSearch(); if (event.key === 'Enter') { const first = document.querySelector('.entry-link[href]'); if (first) { event.preventDefault(); window.open(first.href, '_blank', 'noopener,noreferrer'); } } }
});
for (const close of document.querySelectorAll('[data-close]')) close.addEventListener('click', () => $(close.dataset.close).close());

$('start-login').addEventListener('click', async () => {
  $('start-login').disabled = true; $('login-error').hidden = true;
  try { loginFlow = await api('/auth/device/start', { method: 'POST', body: {} }); $('login-code').textContent = loginFlow.userCode; $('login-intro').hidden = true; $('login-code-panel').hidden = false; $('login-progress').textContent = '完成 GitHub 授权后，这里会自动登录。'; schedulePoll(loginFlow.interval); }
  catch (error) { showError('login-error', error); } finally { $('start-login').disabled = false; }
});
$('copy-login-code').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('login-code').textContent); toast('验证码已复制。'); } catch { toast('请长按验证码复制。'); } });
function schedulePoll(seconds) { clearTimeout(loginTimer); loginTimer = setTimeout(pollLogin, Math.max(seconds, 5) * 1000); }
async function pollLogin() {
  if (!loginFlow || !$('login-dialog').open) return;
  try { const result = await api('/auth/device/poll', { method: 'POST', body: { flowToken: loginFlow.flowToken } }); if (result.pending) { schedulePoll(result.interval); return; } loginFlow = null; locallyLocked = false; local.set('locked', '0'); $('login-dialog').close(); await refresh(); toast('已登录，私密入口和修改会跨设备同步。'); }
  catch (error) { if (error.status && [401, 403, 410].includes(error.status)) { loginFlow = null; $('login-intro').hidden = false; $('login-code-panel').hidden = true; showError('login-error', error); } else { $('login-progress').textContent = '连接暂时中断，正在重试…'; schedulePoll(10); } }
}
$('login-dialog').addEventListener('close', () => { clearTimeout(loginTimer); loginFlow = null; $('login-code').textContent = ''; $('login-intro').hidden = false; $('login-code-panel').hidden = true; });

async function checkVersion() { if (location.protocol === 'file:') return; try { const response = await fetch(new URL('version.json', PRIVATE_APP ? location.origin + '/' : location.href), { cache: 'no-store' }); if (response.ok) { const next = await response.json(); $('update-notice').hidden = !next.buildId || next.buildId === CONFIG.buildId; } } catch {} }
$('update-page').addEventListener('click', () => { if (anyDialog()) { toast('请先保存或关闭正在编辑的内容。'); return; } const url = new URL(location.href); url.searchParams.set('v', Date.now()); location.replace(url.href); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !anyDialog() && !busy) { refresh({ quiet: true }); checkVersion(); } });
window.addEventListener('storage', event => { if (event.key === 'flare-v2-locked') { locallyLocked = event.newValue === '1'; if (locallyLocked) { lock(); syncText('已在其他标签页退出。'); } } });
setInterval(() => { if (!document.hidden && !anyDialog() && !busy) refresh({ quiet: true }); }, 30_000);
setInterval(checkVersion, 5 * 60_000);
render(); refresh({ quiet: true }); checkVersion();
