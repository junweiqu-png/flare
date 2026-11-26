import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Runs real SQLite statements behind the small D1 interface used by the Worker.
export class LocalD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); this.sql.exec(readFileSync(new URL('../worker/migrations/0001_initial.sql', import.meta.url), 'utf8')); }
  prepare(query) {
    const db = this.sql;
    return { bind(...params) {
      return {
        first: async () => { const row = db.prepare(query).get(...params); return row ? { ...row } : null; },
        all: async () => ({ results: db.prepare(query).all(...params).map(x => ({ ...x })) }),
        run: async () => { const r = db.prepare(query).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
      };
    },
    first: async () => { const row = db.prepare(query).get(); return row ? { ...row } : null; },
    all: async () => ({ results: db.prepare(query).all().map(x => ({ ...x })) }),
    run: async () => { const r = db.prepare(query).run(); return { success: true, meta: { changes: Number(r.changes) } }; },
    };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try { const out = []; for (const stmt of statements) out.push(await stmt.run()); this.sql.exec('COMMIT'); return out; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
  close() { this.sql.close(); }
}

export const demoState = () => ({ schemaVersion: 2, title: 'Flare 导航', categories: ['测试分类'], links: [
  { id: 'public-example', name: '公开测试入口', url: 'https://example.com/', category: '测试分类', kind: 'bookmarks', pinned: true, aliases: ['gongkai'], tags: ['示例'] },
  { id: 'private-example', name: '测试私密入口', url: '', internalUrl: 'http://192.168.1.25:8000/', category: '测试分类', kind: 'apps', pinned: true },
] });
