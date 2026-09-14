/**
 * ドメイン候補の生成。決定的（同じ入力 → 同じ出力）で、`.com` のみ・最大 10 件。
 * 規則と順序は docs/03_architecture.md §6 に固定。
 *
 * 生成するのは「調べる候補の一覧」であって購入候補ではない。
 * ここにも購入・カート・予約の概念は存在しない。
 */
import { checkTrademark } from './trademark';
import { domainScoreBreakdown, extractFeatures, type DomainScoreBreakdown, type KeywordMatch } from './score';
import { ABBREVIATIONS, GENERIC_TAILS, PREFIXES, SUFFIXES } from './words';

export const MAX_DOMAINS = 10;
const MIN_SLD_LEN = 4;
const MAX_SLD_LEN = 24;
const PREFIX_MAX_BASE_LEN = 12;

/** 先頭から落とす冠詞・前置詞。 */
const LEADING_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'for']);

export type GenerationRule = KeywordMatch;

export interface DomainCandidate {
  domain: string;
  sld: string;
  rule: GenerationRule;
  domainScore: number | null;
  breakdown: DomainScoreBreakdown | null;
  trademarkFlag: string | null;
  excluded: boolean;
  excludeReason: string | null;
}

/**
 * キーワードを生成用トークンに正規化する。
 * 小文字・ASCII 英字のみ → 先頭の冠詞・前置詞を除去 → 数字を含むトークンは捨てる。
 */
export function normalizeKeywordTokens(keyword: string): string[] {
  const raw = keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
  const noDigits = raw.filter((t) => !/[0-9]/.test(t));
  let i = 0;
  while (i < noDigits.length && LEADING_STOPWORDS.has(noDigits[i])) i += 1;
  return noDigits.slice(i);
}

interface RawCandidate {
  sld: string;
  rule: GenerationRule;
}

/** 生成規則を順序固定で適用する（①concat ②abbrev ③reorder ④prefix ⑤suffix ⑥partial）。 */
export function buildRawCandidates(tokens: readonly string[]): RawCandidate[] {
  const out: RawCandidate[] = [];
  if (tokens.length === 0) return out;

  const concat = tokens.join('');
  out.push({ sld: concat, rule: 'concat' });

  // ② 略語辞書。1 語ずつ置換 → 置換できる全語をまとめて置換。
  const abbrevIndexes = tokens.map((t, i) => (ABBREVIATIONS[t] ? i : -1)).filter((i) => i >= 0);
  for (const idx of abbrevIndexes) {
    const swapped = tokens.map((t, i) => (i === idx ? ABBREVIATIONS[t] : t));
    out.push({ sld: swapped.join(''), rule: 'abbrev' });
  }
  if (abbrevIndexes.length > 1) {
    const all = tokens.map((t) => ABBREVIATIONS[t] ?? t);
    out.push({ sld: all.join(''), rule: 'abbrev' });
  }

  // ③ 2 語なら逆順
  if (tokens.length === 2) out.push({ sld: `${tokens[1]}${tokens[0]}`, rule: 'reorder' });

  // ④ 接頭辞（結合が 12 文字以下のときだけ）
  if (concat.length <= PREFIX_MAX_BASE_LEN) {
    for (const p of PREFIXES) out.push({ sld: `${p}${concat}`, rule: 'prefix' });
  }

  // ⑤ 接尾辞（ai はキーワードに ai を含まない場合のみ）
  const hasAi = tokens.includes('ai');
  for (const s of SUFFIXES) {
    if (s === 'ai' && hasAi) continue;
    out.push({ sld: `${concat}${s}`, rule: 'suffix' });
  }

  // ⑥ 末尾の一般語を落とす
  if (tokens.length >= 2 && GENERIC_TAILS.includes(tokens[tokens.length - 1] as (typeof GENERIC_TAILS)[number])) {
    out.push({ sld: tokens.slice(0, -1).join(''), rule: 'partial' });
  }

  return out;
}

export interface GenerateOptions {
  max?: number;
  /** `.com` の更新価格（USD）。価格スコアに使う。不明なら null。 */
  renewalPrice?: number | null;
  isPremium?: boolean;
}

/**
 * 除外分も含めた全候補を返す（UI に「なぜ外したか」を出すため）。
 * 並び順は Domain Score 降順 → 短い順 → 辞書順（安定・決定的）。
 */
export function generateDomainCandidates(keyword: string, opts: GenerateOptions = {}): DomainCandidate[] {
  const tokens = normalizeKeywordTokens(keyword);
  const seen = new Set<string>();
  const candidates: DomainCandidate[] = [];

  for (const raw of buildRawCandidates(tokens)) {
    const sld = raw.sld;
    if (!/^[a-z]+$/.test(sld)) continue;
    if (sld.length < MIN_SLD_LEN || sld.length > MAX_SLD_LEN) continue;
    if (seen.has(sld)) continue;
    seen.add(sld);

    const domain = `${sld}.com`;
    const tm = checkTrademark(sld, tokens);
    const features = extractFeatures(domain, {
      keywordMatch: raw.rule,
      renewalPrice: opts.renewalPrice ?? null,
      isPremium: opts.isPremium ?? false,
      keywordTokens: tokens,
    });
    const breakdown = domainScoreBreakdown(features);
    candidates.push({
      domain,
      sld,
      rule: raw.rule,
      domainScore: breakdown?.total ?? null,
      breakdown,
      trademarkFlag: tm.flag,
      excluded: tm.blocked,
      excludeReason: tm.blocked ? tm.flag : null,
    });
  }

  candidates.sort(
    (a, b) =>
      (b.domainScore ?? -1) - (a.domainScore ?? -1) ||
      a.sld.length - b.sld.length ||
      a.sld.localeCompare(b.sld),
  );
  return candidates;
}

/** 採用候補だけ（商標除外を落とし、上限 10 件）。 */
export function generateDomains(keyword: string, opts: GenerateOptions = {}): DomainCandidate[] {
  const max = opts.max ?? MAX_DOMAINS;
  return generateDomainCandidates(keyword, opts)
    .filter((c) => !c.excluded)
    .slice(0, max);
}
