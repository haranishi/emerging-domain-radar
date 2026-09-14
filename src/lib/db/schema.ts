/**
 * SQLite の DDL。正本は docs/03_architecture.md §4（列名・列順まで一致させている）。
 * 書き込み先はこのローカル DB だけ。外部サービスへの書き込みはしない。
 */
import type Database from 'better-sqlite3';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs(
  id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT, status TEXT, stats_json TEXT, notes TEXT
);

CREATE TABLE IF NOT EXISTS raw_items(
  id INTEGER PRIMARY KEY, source TEXT, external_id TEXT, title TEXT, url TEXT, created_at TEXT,
  score INTEGER, run_id INTEGER, UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS keywords(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE, keyword TEXT, description TEXT, why_emerging TEXT,
  first_seen_context TEXT, related_terms_json TEXT, extraction_method TEXT, llm_confidence REAL,
  llm_basis TEXT, first_seen_at TEXT, created_run_id INTEGER, updated_run_id INTEGER
);

-- window: 7d | prev7d | 30d | prev30d
CREATE TABLE IF NOT EXISTS keyword_metrics(
  id INTEGER PRIMARY KEY, run_id INTEGER, keyword_id INTEGER, source TEXT, window TEXT, count INTEGER,
  approximate INTEGER DEFAULT 0, query_url TEXT, fetched_at TEXT,
  UNIQUE(run_id, keyword_id, source, window)
);

CREATE TABLE IF NOT EXISTS keyword_scores(
  id INTEGER PRIMARY KEY, run_id INTEGER, keyword_id INTEGER, trend_score REAL, novelty_score REAL,
  japan_gap_score REAL, status TEXT, fading INTEGER, breadth INTEGER, c30_units REAL, g7 REAL, g30 REAL,
  breakdown_json TEXT, UNIQUE(run_id, keyword_id)
);

CREATE TABLE IF NOT EXISTS domains(
  id INTEGER PRIMARY KEY, keyword_id INTEGER, domain TEXT, generation_rule TEXT, domain_score REAL,
  trademark_flag TEXT, excluded INTEGER NOT NULL DEFAULT 0, exclusion_reason TEXT,
  created_run_id INTEGER, UNIQUE(keyword_id, domain)
);

-- 履歴。availability: available|taken|unknown|unsupported
-- premium: premium|standard|standard_inferred|unknown
CREATE TABLE IF NOT EXISTS domain_checks(
  id INTEGER PRIMARY KEY, domain TEXT, checked_at TEXT, availability TEXT, availability_source TEXT,
  registration_price REAL, renewal_price REAL, currency TEXT, premium TEXT, price_source TEXT,
  raw_json TEXT, run_id INTEGER
);

CREATE TABLE IF NOT EXISTS rdap_budget(
  day TEXT PRIMARY KEY, used INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tld_prices(
  tld TEXT PRIMARY KEY, registration REAL, renewal REAL, transfer REAL, currency TEXT, source TEXT, fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS opportunity(
  id INTEGER PRIMARY KEY, run_id INTEGER, keyword_id INTEGER, domain_id INTEGER, score REAL, breakdown_json TEXT
);

CREATE TABLE IF NOT EXISTS watchlist(
  id INTEGER PRIMARY KEY, keyword TEXT, domain TEXT UNIQUE, added_at TEXT, found_registration_price REAL,
  found_renewal_price REAL, found_currency TEXT, trend_score REAL, opportunity_score REAL, note TEXT
);

CREATE TABLE IF NOT EXISTS watchlist_price_history(
  id INTEGER PRIMARY KEY, watchlist_id INTEGER, checked_at TEXT, registration_price REAL,
  renewal_price REAL, availability TEXT, premium TEXT
);

CREATE TABLE IF NOT EXISTS fx_rates(
  id INTEGER PRIMARY KEY, base TEXT, quote TEXT, rate REAL, as_of TEXT, source TEXT,
  providers_json TEXT, fetched_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_metrics_run_keyword ON keyword_metrics(run_id, keyword_id);
CREATE INDEX IF NOT EXISTS idx_scores_run ON keyword_scores(run_id);
CREATE INDEX IF NOT EXISTS idx_domains_keyword ON domains(keyword_id);
CREATE INDEX IF NOT EXISTS idx_domain_checks_domain_time ON domain_checks(domain, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_run ON opportunity(run_id, keyword_id);
CREATE INDEX IF NOT EXISTS idx_raw_items_run ON raw_items(run_id);
CREATE INDEX IF NOT EXISTS idx_wl_history ON watchlist_price_history(watchlist_id, checked_at DESC);
`;

/** CREATE TABLE IF NOT EXISTS では増えない既存 DB の列を補う。 */
export function applySchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(domains)`).all() as { name: string }[]).map((column) => column.name),
  );
  if (!columns.has('excluded')) {
    db.exec(`ALTER TABLE domains ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columns.has('exclusion_reason')) {
    db.exec(`ALTER TABLE domains ADD COLUMN exclusion_reason TEXT`);
  }
}

/** テーブル名の一覧（テストと seed のリセットで使う）。 */
export const TABLES = [
  'runs',
  'raw_items',
  'keywords',
  'keyword_metrics',
  'keyword_scores',
  'domains',
  'domain_checks',
  'rdap_budget',
  'tld_prices',
  'opportunity',
  'watchlist',
  'watchlist_price_history',
  'fx_rates',
] as const;
