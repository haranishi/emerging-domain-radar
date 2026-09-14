/**
 * better-sqlite3 のシングルトン。Next.js のサーバー側と CLI の両方から使う。
 * `next.config.ts` の `serverExternalPackages` に better-sqlite3 を入れてある
 * （ネイティブアドオンなのでバンドルできない）。
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { dbPath } from '../env';
import { applySchema, TABLES } from './schema';

export type Db = Database.Database;

const instances = new Map<string, Db>();

export function getDb(file?: string): Db {
  const target = file ?? dbPath();
  const existing = instances.get(target);
  if (existing && existing.open) return existing;

  if (target !== ':memory:') mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  applySchema(db);
  instances.set(target, db);
  return db;
}

/** テスト・シード用。インメモリ DB を作る。 */
export function createMemoryDb(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  return db;
}

export function closeDb(file?: string): void {
  const target = file ?? dbPath();
  const db = instances.get(target);
  if (db?.open) db.close();
  instances.delete(target);
}

/** 全テーブルを空にする（seed:demo の再実行用）。 */
export function truncateAll(db: Db): void {
  const tx = db.transaction(() => {
    for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();
  });
  tx();
}

export const nowIso = (): string => new Date().toISOString();
