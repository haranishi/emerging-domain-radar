/**
 * ルールベースのキーワード候補抽出（architecture §5.3）。
 *
 * タイトルを小文字化・記号除去・トークン化し、2〜3-gram とハイフン複合語を候補にする。
 * 採用条件は「2 件以上の異なるアイテムかつ 2 ソース以上」または「1 ソースで 3 件以上」。
 * LLM を使わなくてもここだけで候補が出る（キー 0 個で完走させるため）。
 */
import { checkTrademark } from '../domain/trademark';
import { getEnv } from '../env';
import { containsGenericPhrase, genericTokens, isGenericPhrase, isStopword } from './blocklist';
import type { HarvestItem, SourceId } from '../trend/types';

export interface KeywordCandidate {
  keyword: string;
  /** 候補スコア（`EXTRACT_LIMITS` の式。山形なので「頻出＝上位」にはならない）。 */
  score: number;
  itemCount: number;
  sourceCount: number;
  sources: SourceId[];
  /** 由来のタイトル（最大 3 件）。first_seen_context に使う。 */
  sampleTitles: string[];
  /** そのソース群で観測した最古の作成日（ISO）。 */
  oldestCreatedAt: string | null;
  /** 統合された包含関係の句（`related_terms` に入る）。 */
  relatedTerms: string[];
}

const MIN_TOKEN_LEN = 3;
const GENERIC_TOKENS = genericTokens();

/**
 * 候補選定の定数（1 か所にまとめる）。
 *
 * なぜ「アイテム数 × ソース数」を捨てたか（2026-09-03 の実測）:
 * `--max-keywords 3` で出た 3 語が全部 Mainstream だった。
 * 単純な積は「1 ラン内で何度も出てくる語」＝すでに一般化した語を必ず上位に押し上げる。
 * ここで欲しいのは逆で、「複数ソースに散らばっているが、まだ数は少ない語」。
 * そこでアイテム数は対数で効かせ、山形（2〜15 件を満点）にして頻出語を降格させる。
 */
export const EXTRACT_LIMITS = {
  /** 採用に必要なアイテム数（2 ソース以上のとき）。 */
  minItems: 2,
  /** 1 ソースだけのときに必要なアイテム数。 */
  minItemsSingleSource: 3,
  /** ここまでは満点（山の頂上）。 */
  peakItems: 15,
  /** `peakItems` 超〜`maxItems` 未満に掛ける係数。 */
  plateauFactor: 0.5,
  /** 既定の上限。これ以上のアイテム数を持つ句は新規候補にしない（env で上書き可）。 */
  defaultMaxItems: 25,
  /** 包含関係の句を 1 つに統合する支持アイテム集合の重なり（Jaccard）の下限。 */
  mergeOverlap: 0.8,
} as const;

/** 新規候補として認めるアイテム数の上限（`RADAR_EXTRACT_MAX_ITEMS`）。 */
export function extractMaxItems(): number {
  return getEnv().RADAR_EXTRACT_MAX_ITEMS;
}

/**
 * 候補スコア。`s * (1 + log2(n))` を基本に、n が多すぎる帯を減点する。
 * n=2 → 2s、n=8 → 4s、n=15 → ~4.9s、n=20 → ~2.7s（0.5 倍）。
 */
export function candidateScore(itemCount: number, sourceCount: number): number {
  const base = sourceCount * (1 + Math.log2(Math.max(itemCount, 1)));
  const factor = itemCount <= EXTRACT_LIMITS.peakItems ? 1 : EXTRACT_LIMITS.plateauFactor;
  return Math.round(base * factor * 100) / 100;
}

/** タイトルをトークン列にする。ハイフン複合語は空白に開く（`vibe-coding` → `vibe coding`）。 */
export function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[-_/]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** 1 タイトルから 2〜3-gram を作る。 */
export function phrasesFromTitle(title: string): string[] {
  const tokens = tokenizeTitle(title);
  const out: string[] = [];
  for (const n of [2, 3]) {
    for (let i = 0; i + n <= tokens.length; i += 1) {
      out.push(tokens.slice(i, i + n).join(' '));
    }
  }
  return out;
}

/** 候補として残すか。落とした理由を返す（デバッグ用）。 */
export function rejectReason(phrase: string): string | null {
  const tokens = phrase.split(' ');
  if (tokens.length < 2) return 'too-few-tokens';
  if (/[0-9]/.test(phrase)) return 'contains-digit';
  if (isStopword(tokens[0])) return 'leading-stopword';
  if (isStopword(tokens[tokens.length - 1])) return 'trailing-stopword';
  if (isGenericPhrase(phrase)) {
    // どのブロック語で落ちたかを残す（部分一致だと理由が分からないと直せない）。
    const hit = containsGenericPhrase(phrase);
    return hit && hit !== phrase ? `generic-phrase:${hit}` : 'generic-phrase';
  }
  if (tokens.every((t) => GENERIC_TOKENS.has(t))) return 'all-generic-tokens';
  if (tokens.every((t) => t.length < MIN_TOKEN_LEN)) return 'tokens-too-short';
  if (tokens.some((t) => isStopword(t) && tokens.length === 2)) return 'stopword-in-bigram';
  const tm = checkTrademark(tokens.join(''), tokens);
  if (tm.blocked) return `trademark:${tm.matched}`;
  return null;
}

/**
 * `inner` のトークン列が `outer` に連続部分列として入っているか。
 * n-gram は連続なので、両端に空白を付けた部分文字列判定で足りる。
 */
export function containsPhrase(outer: string, inner: string): boolean {
  if (outer === inner) return false;
  return ` ${outer} `.includes(` ${inner} `);
}

/**
 * 支持アイテム集合の重なり（Jaccard）。
 * 包含関係の句では「長い句のアイテム ⊆ 短い句のアイテム」が必ず成り立つので、
 * これは「長い句の件数 ÷ 短い句の件数」になる。共通集合を分母にすると常に 1 になり
 * 何も区別できないため、和集合で割る。
 */
export function itemOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const v of a) if (b.has(v)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 包含関係の重複候補を 1 つに畳む（`self improving agents` / `improving agents` /
 * `self improving` が同じランに 3 つ並ぶのを防ぐ）。
 *
 * 畳む条件は「包含関係」かつ「支持アイテム集合の重なりが `mergeOverlap` 以上」の 2 つ。
 * 包含だけで畳むと、`agent mesh`（広く使われる語）が `local agent mesh`（1 記事だけの
 * 言い方）に吸われて別の話が消える。重なりだけで畳むと、たまたま同じ記事に出た
 * 無関係な 2 語が 1 つになる。
 *
 * 畳む単位は「対」ではなく**連結成分**。`mesh router` ⊂ `agent mesh router` ⊂ `agent mesh`
 * のような鎖では、両端が直接の包含関係になくても同じ 1 語を指しているため、
 * 対単位で処理すると中間だけが消えて両端が残る。
 *
 * 残すのはスコアが高い方、同点なら語数が多い方（＝具体的な言い方）。
 * 畳んだ句は残した候補の `relatedTerms` に入れて、消えたことが分かるようにする。
 */
function mergeNestedCandidates(
  candidates: KeywordCandidate[],
  itemsOf: (phrase: string) => ReadonlySet<string>,
): KeywordCandidate[] {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i].keyword;
      const b = candidates[j].keyword;
      if (!containsPhrase(a, b) && !containsPhrase(b, a)) continue;
      if (itemOverlap(itemsOf(a), itemsOf(b)) < EXTRACT_LIMITS.mergeOverlap) continue;
      union(a, b);
    }
  }

  /** 同じ成分の中で残す 1 つ。スコア → 語数 → 辞書順（決定的にするため）。 */
  const better = (a: KeywordCandidate, b: KeywordCandidate): KeywordCandidate => {
    if (a.score !== b.score) return a.score > b.score ? a : b;
    const lenA = a.keyword.split(' ').length;
    const lenB = b.keyword.split(' ').length;
    if (lenA !== lenB) return lenA > lenB ? a : b;
    return a.keyword <= b.keyword ? a : b;
  };
  const keeperOf = new Map<string, KeywordCandidate>();
  for (const c of candidates) {
    const root = find(c.keyword);
    const current = keeperOf.get(root);
    keeperOf.set(root, current ? better(current, c) : c);
  }
  const kept = new Set([...keeperOf.values()].map((c) => c.keyword));
  for (const c of candidates) {
    if (kept.has(c.keyword)) continue;
    keeperOf.get(find(c.keyword))?.relatedTerms.push(c.keyword);
  }
  for (const c of candidates) c.relatedTerms.sort();
  return candidates.filter((c) => kept.has(c.keyword));
}

export interface ExtractOptions {
  /** 上位いくつ返すか。 */
  limit?: number;
  /** 新規候補として認めるアイテム数の上限。既定は `RADAR_EXTRACT_MAX_ITEMS`。 */
  maxItems?: number;
}

/**
 * 収穫したアイテム群から候補を出す。
 * 同じアイテム内の重複は 1 回として数える（連呼で水増しされないように）。
 *
 * アイテム数が `maxItems` 以上の句は「一般語予備軍」として新規候補から外す。
 * ブロックリストは知っている語しか塞げないので、頻度そのものを門にして
 * 「表に無いがもう一般語」（`ai coding agents` の類）を機械的に落とす。
 * 追跡中のキーワードは DB から来るのでこの門の影響を受けない。
 */
export function extractCandidates(items: HarvestItem[], opts: ExtractOptions = {}): KeywordCandidate[] {
  const limit = opts.limit ?? 200;
  const maxItems = opts.maxItems ?? extractMaxItems();
  interface Acc {
    items: Set<string>;
    sources: Set<SourceId>;
    titles: string[];
    oldest: string | null;
  }
  const acc = new Map<string, Acc>();

  for (const item of items) {
    const seen = new Set<string>();
    for (const phrase of phrasesFromTitle(item.title)) {
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      if (rejectReason(phrase) !== null) continue;
      const cur = acc.get(phrase) ?? { items: new Set<string>(), sources: new Set<SourceId>(), titles: [], oldest: null };
      cur.items.add(`${item.source}:${item.externalId}`);
      cur.sources.add(item.source);
      if (cur.titles.length < 3) cur.titles.push(item.title);
      if (item.createdAt && (cur.oldest === null || item.createdAt < cur.oldest)) cur.oldest = item.createdAt;
      acc.set(phrase, cur);
    }
  }

  const out: KeywordCandidate[] = [];
  for (const [phrase, a] of acc) {
    const itemCount = a.items.size;
    const sourceCount = a.sources.size;
    const accepted =
      (itemCount >= EXTRACT_LIMITS.minItems && sourceCount >= 2) ||
      (sourceCount === 1 && itemCount >= EXTRACT_LIMITS.minItemsSingleSource);
    if (!accepted) continue;
    if (itemCount >= maxItems) continue;
    out.push({
      keyword: phrase,
      score: candidateScore(itemCount, sourceCount),
      itemCount,
      sourceCount,
      sources: [...a.sources].sort(),
      sampleTitles: a.titles,
      oldestCreatedAt: a.oldest,
      relatedTerms: [],
    });
  }

  const merged = mergeNestedCandidates(out, (phrase) => acc.get(phrase)?.items ?? new Set<string>());
  merged.sort((a, b) => b.score - a.score || b.itemCount - a.itemCount || a.keyword.localeCompare(b.keyword));
  return merged.slice(0, limit);
}
