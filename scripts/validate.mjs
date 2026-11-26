import { readFileSync } from 'node:fs';
import { normalizeState, needsPrivacy } from '../src/model.mjs';
const data = JSON.parse(readFileSync(new URL('../data/nav.json', import.meta.url), 'utf8'));
const state = normalizeState(data);
if (!state.links.length) throw new Error('公开导航为空，停止发布。');
if (state.links.some(x => x.private || needsPrivacy(x) || x.deletedAt)) throw new Error('公开数据包含私密条目或回收站内容，停止发布。');
if (!Number.isSafeInteger(data.privateCount) || data.privateCount < 0) throw new Error('私密条目计数无效。');
console.log(`公开数据检查通过：${state.links.length} 个公开入口，${data.privateCount} 个私密入口仅保留总数。`);
