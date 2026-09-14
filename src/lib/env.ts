/**
 * 環境変数の読み取り。サーバー（Next.js のサーバー側）と CLI の両方から使う。
 * 契約: docs/03_architecture.md §9。すべて任意で、キー 0 個でも全機能が動く。
 *
 * なぜ `import 'server-only'` を使わないか（architecture §2 からの意図的な逸脱）:
 *   `server-only` パッケージは `react-server` 条件が立っていない環境で import されると
 *   常に throw する。この env は `scripts/*.ts`（tsx・素の Node）からも読むため採用できない。
 *   代わりに (1) ブラウザでの読み込みを実行時に拒否し、(2) tests/unit/client-boundary.test.ts で
 *   'use client' ファイルからの import と、クライアント公開接頭辞の不在を機械的に保証する。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/env.ts はサーバー専用です。クライアントコンポーネントから import しないでください。',
  );
}

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const EnvSchema = z.object({
  /** SQLite の場所。相対パスはプロジェクトルート起点。 */
  RADAR_DB_PATH: z.preprocess(blankToUndefined, z.string().min(1).default('data/radar.db')),
  /** '1' なら外部 HTTP と DNS を fixtures に差し替える。 */
  RADAR_OFFLINE: z.preprocess(blankToUndefined, z.enum(['0', '1']).default('0')),
  /** 1 ランで計測するキーワードの合計上限。 */
  RADAR_MAX_KEYWORDS: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).default(25)),
  /** 1 ランで新規に採用するキーワードの上限。 */
  RADAR_MAX_NEW_KEYWORDS: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).default(15)),
  /** RDAP の 1 日あたり問い合わせ上限（Verisign 規約対応）。 */
  RADAR_RDAP_DAILY_BUDGET: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).default(300)),
  /**
   * 新規候補として認める「1 ラン内の出現アイテム数」の上限（extract/ngram.ts）。
   * これを超える句は既に一般化した語とみなして新規候補から外す（追跡中の語は対象外）。
   */
  RADAR_EXTRACT_MAX_ITEMS: z.preprocess(blankToUndefined, z.coerce.number().int().min(2).default(25)),
  /**
   * arXiv の最短リクエスト間隔（ms）。既定 5000。
   * 500 を連発する時間帯は 10000 にすると 1 ランを通しやすい（実測）。
   */
  RADAR_ARXIV_INTERVAL_MS: z.preprocess(blankToUndefined, z.coerce.number().int().min(1000).default(5000)),
  /** キーワード抽出に使う LLM。既定は none（ルールベースのみ）。 */
  LLM_PROVIDER: z.preprocess(blankToUndefined, z.enum(['none', 'anthropic', 'codex-cli']).default('none')),
  ANTHROPIC_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  ANTHROPIC_MODEL: z.preprocess(blankToUndefined, z.string().optional()),
  CODEX_HOME: z.preprocess(blankToUndefined, z.string().optional()),
  /** 権限ゼロの fine-grained PAT で足りる（Search 10/min → 30/min）。 */
  GITHUB_TOKEN: z.preprocess(blankToUndefined, z.string().optional()),
  OPENALEX_MAILTO: z.preprocess(blankToUndefined, z.string().optional()),
  OPENALEX_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  QIITA_TOKEN: z.preprocess(blankToUndefined, z.string().optional()),
  PORT: z.preprocess(blankToUndefined, z.coerce.number().int().optional()),
});

export type Env = z.infer<typeof EnvSchema>;

/** 秘密を持つ変数名。ログには set/unset だけを出す。 */
const SECRET_KEYS = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'OPENALEX_API_KEY', 'QIITA_TOKEN'] as const;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // メッセージにキーの値は載せない（zod は invalid_type で received を出しうるため整形する）
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`).join(', ');
    throw new Error(`環境変数が不正です: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** テスト専用。process.env を書き換えたあとに呼ぶ。 */
export function resetEnvCache(): void {
  cached = null;
}

export function isOffline(): boolean {
  return getEnv().RADAR_OFFLINE === '1';
}

/*
 * Project root = nearest ancestor holding `fixtures/` or `next.config.ts`.
 * Needed because scripts/*.ts may run from a subdirectory.
 *
 * Why `turbopackIgnore` below: Turbopack's static analysis reads this walk as
 * "dynamic filesystem access" and traces the whole project. The remedy it
 * prints is this comment. Silencing it also removes the warning's code frame,
 * and that frame is what made `next build` unstable here: `next-code-frame`
 * truncates the quoted lines by byte offset, so a long multibyte (Japanese)
 * line inside the frame can be cut mid-character and panic the Rust side.
 * Keep the lines in this file ASCII for the same reason.
 */
export function projectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const marker =
      existsSync(path.join(/*turbopackIgnore: true*/ dir, 'fixtures')) ||
      existsSync(path.join(/*turbopackIgnore: true*/ dir, 'next.config.ts'));
    if (marker) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function fixturesDir(): string {
  return path.join(projectRoot(), 'fixtures');
}

export function dbPath(): string {
  const p = getEnv().RADAR_DB_PATH;
  return path.isAbsolute(p) ? p : path.join(/*turbopackIgnore: true*/ projectRoot(), p);
}

/* UA string per architecture 5.2. Contact = OPENALEX_MAILTO when set. */
export function userAgent(): string {
  const contact = getEnv().OPENALEX_MAILTO ?? 'not-set';
  return `emerging-domain-radar/0.1 (local research tool; contact: ${contact})`;
}

/*
 * Reference "now" for offline runs.
 * The fixtures are verbatim responses captured on 2026-09-03, so the window
 * maths has to use that date; otherwise every window is empty and the offline
 * result drifts day by day.
 */
export const OFFLINE_REFERENCE_NOW = new Date('2026-09-03T00:00:00.000Z');

/** ログ用。値は絶対に出さない。 */
export function describeEnv(): string {
  const env = getEnv();
  const secrets = SECRET_KEYS.map((k) => `${k}=${env[k] ? 'set' : 'unset'}`);
  return [
    `RADAR_DB_PATH=${env.RADAR_DB_PATH}`,
    `RADAR_OFFLINE=${env.RADAR_OFFLINE}`,
    `RADAR_MAX_KEYWORDS=${env.RADAR_MAX_KEYWORDS}`,
    `RADAR_MAX_NEW_KEYWORDS=${env.RADAR_MAX_NEW_KEYWORDS}`,
    `RADAR_RDAP_DAILY_BUDGET=${env.RADAR_RDAP_DAILY_BUDGET}`,
    `RADAR_EXTRACT_MAX_ITEMS=${env.RADAR_EXTRACT_MAX_ITEMS}`,
    `RADAR_ARXIV_INTERVAL_MS=${env.RADAR_ARXIV_INTERVAL_MS}`,
    `LLM_PROVIDER=${env.LLM_PROVIDER}`,
    `OPENALEX_MAILTO=${env.OPENALEX_MAILTO ? 'set' : 'unset'}`,
    ...secrets,
  ].join(' ');
}
