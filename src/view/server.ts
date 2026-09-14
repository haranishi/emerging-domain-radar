/**
 * サーバーコンポーネントから DB を開くための入口。
 *
 * `better-sqlite3` は同期ドライバなので、そのまま書くとビルド時のプリレンダリングで
 * クエリが走ってしまう（Next.js 16 の `connection()` の項に same-case として載っている）。
 * `connection()` を先に待つことで「リクエストが来てから読む」に固定する。
 */
import { connection } from 'next/server';
import { getDb, type Db } from '@/lib/db/client';

export async function openDb(): Promise<Db> {
  await connection();
  return getDb();
}

export type { Db };
