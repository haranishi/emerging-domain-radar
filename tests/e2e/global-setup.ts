/**
 * E2E 用の DB を作り直す。
 *
 * `.tmp/e2e.db` を消してから `seed:demo` を流す。開発中の `.tmp/demo.db` とは分けてあるので、
 * E2E を回しても手元で見ている画面のデータは変わらない。
 *
 * `-wal` / `-shm` も消す: `client.ts` が `journal_mode = WAL` を張るため、本体だけ消して
 * WAL を残すと SQLite が「未反映のトランザクションを持つ別 DB」を読もうとして壊れる。
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';

const DB_PATH = '.tmp/e2e.db';

export default function globalSetup(config: FullConfig): void {
  const root = config.rootDir;
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(path.join(root, `${DB_PATH}${suffix}`), { force: true });
  }

  const output = execFileSync('npm', ['run', 'seed:demo'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, RADAR_OFFLINE: '1', RADAR_DB_PATH: DB_PATH },
  });
  process.stdout.write(output);
}
