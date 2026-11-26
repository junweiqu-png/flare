// Shared data rules for the page, build checks, and sync service.
export const SCHEMA_VERSION = 2;
export const MAX_LINKS = 3000;
const SECRET_KEY = /^(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|auth|password|passwd|secret|credential)$/i;
const UUID = /[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i;

export function httpURL(value, allowEmpty = true) {
  const text = String(value ?? '').trim();
  if (!text && allowEmpty) return '';
  if (!text || text.length > 4096 || /[\x00-\x20\x7f]/.test(text)) throw new Error('请输入完整的 HTTP 或 HTTPS 地址。');
  let u;
  try { u = new URL(text); } catch { throw new Error('请输入完整的 HTTP 或 HTTPS 地址。'); }
  if (!['https:', 'http:'].includes(u.protocol) || !u.hostname) throw new Error('只支持 HTTP 和 HTTPS 地址。');
  return u.href;
}

export function networkScope(value) {
  if (!value) return '';
  const h = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || /^127\./.test(h) || h === '::1' || h === '0.0.0.0' || h === '::') return '本机';
  if (/^(?:10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h) || /^(?:fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:/i.test(h) || h.startsWith('::ffff:') || h.endsWith('.local') || !/[.:]/.test(h)) return '内网';
  return '';
}

export function needsPrivacy(item) {
  for (const raw of [item.url, item.internalUrl]) {
    if (!raw) continue;
    const u = new URL(httpURL(raw));
    const fragment = u.hash.slice(1).split('?').at(-1);
    const keys = [...u.searchParams.keys(), ...new URLSearchParams(fragment).keys()];
    if (networkScope(raw) || u.username || u.password || keys.some(k => SECRET_KEY.test(k)) || UUID.test(u.pathname)) return true;
  }
  return false;
}

function text(value, max, required = false) {
  const v = String(value ?? '').trim();
  if ((required && !v) || v.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)) throw new Error('名称或说明为空、过长或包含无效字符。');
  return v;
}

export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('入口数据格式不正确。');
  const id = text(raw.id, 100, true);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('入口编号格式不正确。');
  const item = {
    id,
    name: text(raw.name, 140, true),
    url: httpURL(raw.url),
    internalUrl: httpURL(raw.internalUrl),
    kind: raw.kind === 'apps' ? 'apps' : 'bookmarks',
    category: text(raw.category || '未分类', 80, true),
    description: text(raw.description, 1000),
    aliases: Array.isArray(raw.aliases) ? [...new Set(raw.aliases.map(x => text(x, 80, true)))].slice(0, 20) : [],
    tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.map(x => text(x, 50, true)))].slice(0, 20) : [],
    pinned: Boolean(raw.pinned),
    private: Boolean(raw.private),
  };
  if (!item.url && !item.internalUrl && !/^private-[a-f0-9]{12}$/.test(String(raw.legacyPrivateId || ''))) throw new Error('至少填写一个访问地址。');
  if (raw.legacyPrivateId && /^private-[a-f0-9]{12}$/.test(raw.legacyPrivateId)) item.legacyPrivateId = raw.legacyPrivateId;
  if (item.legacyPrivateId || needsPrivacy(item)) item.private = true;
  if (raw.deletedAt) {
    if (!Number.isFinite(Date.parse(raw.deletedAt))) throw new Error('回收站时间格式不正确。');
    item.deletedAt = new Date(raw.deletedAt).toISOString();
  }
  return item;
}

export function normalizeState(raw) {
  if (!raw || raw.schemaVersion !== SCHEMA_VERSION || !Array.isArray(raw.links) || raw.links.length > MAX_LINKS) throw new Error('导航备份格式不正确或入口数量过多。');
  const links = raw.links.map(normalizeItem);
  if (new Set(links.map(x => x.id)).size !== links.length) throw new Error('入口编号重复，未保存。');
  const categories = [...new Set((raw.categories || []).map(x => text(typeof x === 'string' ? x : x.title, 80, true)))];
  for (const x of links) if (!categories.includes(x.category) && x.category !== '常用应用') categories.push(x.category);
  if (categories.length > 200) throw new Error('分类数量过多。');
  return {
    schemaVersion: SCHEMA_VERSION,
    title: text(raw.title || 'Flare 导航', 100, true),
    categories,
    links,
  };
}

export function publicState(raw) {
  const state = normalizeState(raw);
  const active = state.links.filter(x => !x.deletedAt);
  return {
    ...state,
    links: active.filter(x => !x.private && !needsPrivacy(x)),
    privateCount: active.filter(x => x.private || needsPrivacy(x)).length,
    totalCount: active.length,
  };
}

export function searchMatches(item, query) {
  const hay = [item.name, item.url, item.internalUrl, item.category, item.description, ...item.aliases, ...item.tags].join(' ').normalize('NFKC').toLocaleLowerCase();
  return query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).every(word => hay.includes(word));
}

export function destination(item, mode) {
  return mode === 'internal' ? (item.internalUrl || item.url) : (item.url || item.internalUrl);
}

export function mergeImported(current, incoming) {
  const next = normalizeState(current);
  const data = normalizeState(incoming);
  const ids = new Set(next.links.map(x => x.id));
  const addresses = new Set(next.links.flatMap(x => [x.url, x.internalUrl]).filter(Boolean));
  let added = 0, skipped = 0;
  for (const item of data.links) {
    if (ids.has(item.id) || [item.url, item.internalUrl].some(x => x && addresses.has(x))) { skipped++; continue; }
    next.links.push(item); ids.add(item.id);
    for (const u of [item.url, item.internalUrl]) if (u) addresses.add(u);
    added++;
  }
  next.categories = [...new Set([...next.categories, ...data.categories])];
  return { state: normalizeState(next), added, skipped };
}
