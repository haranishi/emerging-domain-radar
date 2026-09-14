/** DB 行の型。列名は docs/03_architecture.md §4 の DDL と 1 対 1。 */

export type SourceId = 'hn' | 'github' | 'arxiv' | 'openalex' | 'qiita' | 'wikipv';
export type WindowId = '7d' | 'prev7d' | '30d' | 'prev30d';
export type Status = 'Early' | 'Emerging' | 'Rising' | 'Trending' | 'Mainstream';
export type Availability = 'available' | 'taken' | 'unknown' | 'unsupported';
export type Premium = 'premium' | 'standard' | 'standard_inferred' | 'unknown';

export interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  stats_json: string | null;
  notes: string | null;
}

export interface RawItemInput {
  source: SourceId;
  external_id: string;
  title: string;
  url: string | null;
  created_at: string | null;
  score: number | null;
  run_id: number;
}

export interface RawItemRow extends RawItemInput {
  id: number;
}

export interface KeywordInput {
  slug: string;
  keyword: string;
  description: string | null;
  why_emerging: string | null;
  first_seen_context: string | null;
  related_terms: string[];
  extraction_method: string;
  llm_confidence: number | null;
  llm_basis: string | null;
  first_seen_at: string | null;
  run_id: number;
}

export interface KeywordRow {
  id: number;
  slug: string;
  keyword: string;
  description: string | null;
  why_emerging: string | null;
  first_seen_context: string | null;
  related_terms_json: string | null;
  extraction_method: string | null;
  llm_confidence: number | null;
  llm_basis: string | null;
  first_seen_at: string | null;
  created_run_id: number | null;
  updated_run_id: number | null;
}

export interface MetricInput {
  run_id: number;
  keyword_id: number;
  source: SourceId;
  window: WindowId;
  count: number;
  approximate: boolean;
  query_url: string;
  fetched_at: string;
}

export interface MetricRow {
  id: number;
  run_id: number;
  keyword_id: number;
  source: SourceId;
  window: WindowId;
  count: number;
  approximate: number;
  query_url: string | null;
  fetched_at: string | null;
}

export interface ScoreInput {
  run_id: number;
  keyword_id: number;
  trend_score: number;
  novelty_score: number;
  japan_gap_score: number | null;
  status: Status;
  fading: boolean;
  breadth: number;
  c30_units: number;
  g7: number;
  g30: number;
  breakdown: unknown;
}

export interface ScoreRow {
  id: number;
  run_id: number;
  keyword_id: number;
  trend_score: number;
  novelty_score: number;
  japan_gap_score: number | null;
  status: Status;
  fading: number;
  breadth: number;
  c30_units: number;
  g7: number;
  g30: number;
  breakdown_json: string | null;
}

export interface DomainInput {
  keyword_id: number;
  domain: string;
  generation_rule: string;
  domain_score: number | null;
  trademark_flag: string | null;
  excluded?: boolean;
  exclusion_reason?: string | null;
  run_id: number;
}

export interface DomainRow {
  id: number;
  keyword_id: number;
  domain: string;
  generation_rule: string | null;
  domain_score: number | null;
  trademark_flag: string | null;
  excluded: number;
  exclusion_reason: string | null;
  created_run_id: number | null;
}

export interface DomainCheckInput {
  domain: string;
  checked_at: string;
  availability: Availability;
  availability_source: string;
  registration_price: number | null;
  renewal_price: number | null;
  currency: string | null;
  premium: Premium;
  price_source: string | null;
  raw: unknown;
  run_id: number | null;
}

export interface DomainCheckRow {
  id: number;
  domain: string;
  checked_at: string;
  availability: Availability;
  availability_source: string | null;
  registration_price: number | null;
  renewal_price: number | null;
  currency: string | null;
  premium: Premium;
  price_source: string | null;
  raw_json: string | null;
  run_id: number | null;
}

export interface TldPriceRow {
  tld: string;
  registration: number | null;
  renewal: number | null;
  transfer: number | null;
  currency: string | null;
  source: string | null;
  fetched_at: string | null;
}

export interface OpportunityInput {
  run_id: number;
  keyword_id: number;
  domain_id: number | null;
  score: number;
  breakdown: unknown;
}

export interface OpportunityRow {
  id: number;
  run_id: number;
  keyword_id: number;
  domain_id: number | null;
  score: number;
  breakdown_json: string | null;
}

export interface WatchlistInput {
  keyword: string;
  domain: string;
  found_registration_price: number | null;
  found_renewal_price: number | null;
  found_currency: string | null;
  trend_score: number | null;
  opportunity_score: number | null;
  note?: string | null;
}

export interface WatchlistRow {
  id: number;
  keyword: string;
  domain: string;
  added_at: string;
  found_registration_price: number | null;
  found_renewal_price: number | null;
  found_currency: string | null;
  trend_score: number | null;
  opportunity_score: number | null;
  note: string | null;
}

export interface WatchlistHistoryRow {
  id: number;
  watchlist_id: number;
  checked_at: string;
  registration_price: number | null;
  renewal_price: number | null;
  availability: Availability | null;
  premium: Premium | null;
}

export interface FxRateInput {
  base: string;
  quote: string;
  rate: number;
  as_of: string;
  source: string;
  providers: unknown;
}

export interface FxRateRow {
  id: number;
  base: string;
  quote: string;
  rate: number;
  as_of: string;
  source: string;
  providers_json: string | null;
  fetched_at: string;
}
