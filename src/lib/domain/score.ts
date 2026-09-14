/**
 * Domain Score（0〜100）。式は docs/03_architecture.md §5.4（research/04 §5.4 を採用）。
 * 重みと閾値はこのファイルの定数 1 か所に置く。
 *
 * 価格は **更新価格**（USD）で見る。初年度割引で並べても意味がないため（research/04 §5.6）。
 * 価格が取れないときは 70（中立値）にして、減点も加点もしない。
 */
import { segment } from './words';

export const WEIGHTS = {
  length: 0.22,
  pronounce: 0.18,
  spell: 0.15,
  keywordMatch: 0.15,
  structure: 0.12,
  memorability: 0.1,
  price: 0.08,
} as const;

/** 生成規則から決まるキーワード一致度。手動入力は 'n/a'（50）。 */
export type KeywordMatch = 'concat' | 'suffix' | 'prefix' | 'reorder' | 'abbrev' | 'partial' | 'none' | 'n/a';

export const KEYWORD_MATCH_SCORE: Readonly<Record<KeywordMatch, number>> = {
  concat: 100,
  suffix: 85,
  prefix: 85,
  reorder: 70,
  abbrev: 50,
  partial: 25,
  none: 0,
  'n/a': 50,
};

/** 価格不明のときの中立値。 */
export const NEUTRAL_PRICE_SCORE = 70;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const cl100 = (x: number): number => Math.min(100, Math.max(0, x));

export interface DomainFeatures {
  sld: string;
  tld: string;
  len: number;
  words: string[];
  hyphens: number;
  digits: number;
  leadingDigit: boolean;
  vowelRatio: number;
  maxConsRun: number;
  syllables: number;
  dictCoverage: number;
  keywordMatch: KeywordMatch;
  /** 更新価格（USD）。取れないときは null。 */
  renewalPrice: number | null;
  isPremium: boolean;
}

export const syllableCount = (s: string): number =>
  (s.toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]+/g) ?? []).length;

export function vowelRatio(s: string): number {
  const letters = s.toLowerCase().replace(/[^a-z]/g, '');
  if (!letters) return 0;
  const vowels = letters.match(/[aeiouy]/g)?.length ?? 0;
  return vowels / letters.length;
}

export function maxConsonantRun(s: string): number {
  const runs = s.toLowerCase().replace(/[^a-z]/g, '').split(/[aeiouy]+/);
  return runs.reduce((m, r) => Math.max(m, r.length), 0);
}

export interface FeatureOptions {
  keywordMatch?: KeywordMatch;
  renewalPrice?: number | null;
  isPremium?: boolean;
  /** キーワードのトークン。dictCoverage の語彙に足す。 */
  keywordTokens?: readonly string[];
}

export function extractFeatures(domain: string, opts: FeatureOptions = {}): DomainFeatures {
  const lower = domain.toLowerCase().trim();
  const dot = lower.lastIndexOf('.');
  const sld = dot === -1 ? lower : lower.slice(0, dot);
  const tld = dot === -1 ? '' : lower.slice(dot + 1);
  const seg = segment(sld, opts.keywordTokens ?? []);
  return {
    sld,
    tld,
    len: sld.length,
    words: seg.words,
    hyphens: (sld.match(/-/g) ?? []).length,
    digits: (sld.match(/[0-9]/g) ?? []).length,
    leadingDigit: /^[0-9]/.test(sld),
    vowelRatio: vowelRatio(sld),
    maxConsRun: maxConsonantRun(sld),
    syllables: syllableCount(sld),
    dictCoverage: seg.coverage,
    keywordMatch: opts.keywordMatch ?? 'n/a',
    renewalPrice: opts.renewalPrice ?? null,
    isPremium: opts.isPremium ?? false,
  };
}

/** 1. 長さ（22%）。極端に短いのは実質取れないので満点にしない。 */
export function lengthScore(L: number): number {
  if (L <= 3) return 60;
  if (L <= 10) return 100;
  if (L <= 14) return 100 - 8 * (L - 10);
  if (L <= 20) return 68 - 9 * (L - 14);
  return 0;
}

/** 2. 発音しやすさ（18%）。 */
export function pronounceScore(f: Pick<DomainFeatures, 'sld' | 'vowelRatio' | 'maxConsRun' | 'syllables'>): number {
  let s = 100;
  s -= 60 * clamp01((Math.abs(f.vowelRatio - 0.42) - 0.08) / 0.25);
  s -= 20 * Math.max(0, f.maxConsRun - 3);
  s -= 12 * Math.max(0, f.syllables - 4);
  s -= 10 * Math.max(0, 2 - f.syllables);
  if (/(zx|qx|vk|kx|jq|xz|tsq)/.test(f.sld)) s -= 25;
  return cl100(s);
}

const AMBIGUOUS = [/ph/, /gh/, /kn/, /wr/, /mb$/, /ce/, /ck/, /x/, /que/, /ough/];

/**
 * 語境界の重複文字（`newsstand` の `ss`）があるか。
 *
 * 「同一文字が連続していたら減点」にすると `apple` の `pp` や `memory` のような
 * 単語内の綴りまで落ちる。減点するのは語の分割で見える境界だけにする。
 * さらに `segment()` は辞書に無い文字を落として語だけを返すので、
 * words の隣同士が SLD 上でも隣接しているか（`prev + word` が実際に現れるか）を確かめる。
 * これが無いと `newsxstand` の news / stand のように、間に文字が挟まって
 * 境界が存在しない組み合わせまで −15 になる。
 */
export function hasBoundaryRepeat(sld: string, words: readonly string[]): boolean {
  return words.some((word, index) => {
    if (index === 0) return false;
    const prev = words[index - 1];
    if (!prev || !word) return false;
    return prev.at(-1) === word[0] && sld.includes(`${prev}${word}`);
  });
}

/** 3. 綴りやすさ（15%）。「耳で聞いて一意に書けるか」。 */
export function spellScore(f: Pick<DomainFeatures, 'sld' | 'words' | 'dictCoverage'>): number {
  let s = 100;
  if (/(.)\1\1/.test(f.sld)) s -= 20;
  const amb = AMBIGUOUS.filter((re) => re.test(f.sld)).length;
  s -= Math.min(45, 15 * amb);
  if (hasBoundaryRepeat(f.sld, f.words)) s -= 15;
  if (f.dictCoverage < 0.5) s -= 20;
  return cl100(s);
}

/** 5. 構造（12%）。ハイフン・数字・語数。 */
export function structureScore(
  f: Pick<DomainFeatures, 'hyphens' | 'digits' | 'leadingDigit' | 'words'>,
): number {
  let s = 100;
  if (f.hyphens > 0) s -= 35;
  if (f.digits > 0) s -= 25;
  if (f.leadingDigit) s -= 15;
  if (f.words.length === 3) s -= 15;
  if (f.words.length >= 4) s -= 30;
  return cl100(s);
}

/**
 * 6. 記憶しやすさ（10%）。
 * research/04 の実装例は `f.words[0]?.[0] === f.words[1]?.[0]` が
 * 語数 0〜1 のときに undefined === undefined で真になるため、2 語以上に限定した。
 */
export function memorabilityScore(f: Pick<DomainFeatures, 'syllables' | 'words' | 'dictCoverage'>): number {
  let s = 60;
  if (f.syllables >= 2 && f.syllables <= 3) s += 25;
  if (f.words.length === 1) s += 15;
  if (f.words.length === 2 && f.dictCoverage > 0.9) s += 10;
  if (f.words.length >= 2 && f.words[0][0] === f.words[1][0]) s += 5;
  return cl100(s);
}

/** 7. 価格（8%）。USD・更新価格ベース。取れないときは中立値。 */
export function priceScore(usd: number | null, premium: boolean): number {
  if (usd === null) return NEUTRAL_PRICE_SCORE;
  let s: number;
  if (usd <= 13) s = 100;
  else if (usd <= 33) s = 100 - (40 * (usd - 13)) / 20;
  else if (usd <= 130) s = 60 - (50 * (usd - 33)) / 97;
  else s = Math.max(0, 10 - (usd - 130) / 70);
  if (premium) s -= 30;
  return cl100(s);
}

export interface DomainScoreBreakdown {
  length: number;
  pronounce: number;
  spell: number;
  keywordMatch: number;
  structure: number;
  memorability: number;
  price: number;
  total: number;
}

/** `.com` 以外はゲートで除外（null を返す）。 */
export function domainScoreBreakdown(f: DomainFeatures): DomainScoreBreakdown | null {
  if (!f.sld || f.tld !== 'com') return null;
  const parts = {
    length: lengthScore(f.len),
    pronounce: pronounceScore(f),
    spell: spellScore(f),
    keywordMatch: KEYWORD_MATCH_SCORE[f.keywordMatch],
    structure: structureScore(f),
    memorability: memorabilityScore(f),
    price: priceScore(f.renewalPrice, f.isPremium),
  };
  const total = Math.round(
    cl100(
      WEIGHTS.length * parts.length +
        WEIGHTS.pronounce * parts.pronounce +
        WEIGHTS.spell * parts.spell +
        WEIGHTS.keywordMatch * parts.keywordMatch +
        WEIGHTS.structure * parts.structure +
        WEIGHTS.memorability * parts.memorability +
        WEIGHTS.price * parts.price,
    ),
  );
  return { ...parts, total };
}

export function domainScore(f: DomainFeatures): number | null {
  return domainScoreBreakdown(f)?.total ?? null;
}

/** ドメイン文字列から一発でスコアを出す入口。 */
export function scoreDomain(
  domain: string,
  opts: FeatureOptions = {},
): { score: number | null; breakdown: DomainScoreBreakdown | null; features: DomainFeatures } {
  const features = extractFeatures(domain, opts);
  const breakdown = domainScoreBreakdown(features);
  return { score: breakdown?.total ?? null, breakdown, features };
}
