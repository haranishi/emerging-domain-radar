import type { Db } from '../client';
import { nowIso } from '../client';
import type { KeywordInput, KeywordRow } from '../types';

/** URL に載せる slug。決定的（同じ語 → 同じ slug）。 */
export function slugify(keyword: string): string {
  return keyword
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function upsertKeyword(db: Db, input: KeywordInput): number {
  const existing = db.prepare(`SELECT id, first_seen_at FROM keywords WHERE slug = ?`).get(input.slug) as
    | { id: number; first_seen_at: string | null }
    | undefined;

  if (existing) {
    db.prepare(
      `UPDATE keywords SET keyword = ?, description = COALESCE(?, description), why_emerging = COALESCE(?, why_emerging),
         first_seen_context = COALESCE(?, first_seen_context), related_terms_json = ?, extraction_method = ?,
         llm_confidence = ?, llm_basis = ?, first_seen_at = COALESCE(first_seen_at, ?), updated_run_id = ?
       WHERE id = ?`,
    ).run(
      input.keyword,
      input.description,
      input.why_emerging,
      input.first_seen_context,
      JSON.stringify(input.related_terms),
      input.extraction_method,
      input.llm_confidence,
      input.llm_basis,
      input.first_seen_at ?? nowIso(),
      input.run_id,
      existing.id,
    );
    return existing.id;
  }

  const info = db
    .prepare(
      `INSERT INTO keywords(slug, keyword, description, why_emerging, first_seen_context, related_terms_json,
         extraction_method, llm_confidence, llm_basis, first_seen_at, created_run_id, updated_run_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.slug,
      input.keyword,
      input.description,
      input.why_emerging,
      input.first_seen_context,
      JSON.stringify(input.related_terms),
      input.extraction_method,
      input.llm_confidence,
      input.llm_basis,
      input.first_seen_at ?? nowIso(),
      input.run_id,
      input.run_id,
    );
  return Number(info.lastInsertRowid);
}

export function getKeywordBySlug(db: Db, slug: string): KeywordRow | undefined {
  return db.prepare(`SELECT * FROM keywords WHERE slug = ?`).get(slug) as KeywordRow | undefined;
}

export function getKeywordById(db: Db, id: number): KeywordRow | undefined {
  return db.prepare(`SELECT * FROM keywords WHERE id = ?`).get(id) as KeywordRow | undefined;
}

export function listAllKeywords(db: Db): KeywordRow[] {
  return db.prepare(`SELECT * FROM keywords ORDER BY id`).all() as KeywordRow[];
}

/**
 * 追跡継続用。前回ランの Opportunity 降順で既存キーワードを返す。
 * ランがまだ 1 つも無ければ登録順。
 */
export function listTrackedKeywords(db: Db, limit: number): KeywordRow[] {
  return db
    .prepare(
      `SELECT k.* FROM keywords k
       LEFT JOIN (SELECT keyword_id, MAX(score) AS score FROM opportunity
                  WHERE run_id = (SELECT MAX(run_id) FROM opportunity) GROUP BY keyword_id) o
              ON o.keyword_id = k.id
       ORDER BY COALESCE(o.score, -1) DESC, k.id ASC
       LIMIT ?`,
    )
    .all(limit) as KeywordRow[];
}

export function parseRelatedTerms(row: KeywordRow): string[] {
  if (!row.related_terms_json) return [];
  try {
    const parsed = JSON.parse(row.related_terms_json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
