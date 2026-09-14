/**
 * 商標ブロックリストによる候補の除外と、手動確認の導線。
 *
 * ここでやるのは「触りそうな候補を候補一覧から外す」ことだけ。
 * 商標の抵触は指定商品・役務の類似群と称呼・外観・観念で決まるので、
 * 文字列一致では判定できない（research/04 §4.7）。したがって
 *  - 抵触しないと断定する表示は作らない（除外されなかったことは何の保証でもない）
 *  - 残った候補にも常に `Trademark check required` を出す
 * の 2 点をこのモジュールの契約とする。
 */
import { trademarkSearchLinks, TRADEMARK_LINK_CAVEAT, type OfficialLink } from './links';
import { TRADEMARK_BLOCKLIST, TRADEMARK_BLOCKLIST_COMPACT } from './trademark-list';
import { segment } from './words';
import { TRADEMARK_REQUIRED_NOTE } from './types';

export interface TrademarkVerdict {
  blocked: boolean;
  /** `brand:<語>` の形。DB の domains.trademark_flag に入れる。 */
  flag: string | null;
  matched: string | null;
  reason: string | null;
}

const PREFIX_SUFFIX_MIN_LEN = 4;

/**
 * 候補 SLD がブロックリストに触れるか（architecture §6）。
 *  - トークンとして一致（生成トークンと辞書分割の両方を見る）
 *  - 4 文字以上のブロック語で始まる・終わる
 */
export function checkTrademark(sld: string, tokens: readonly string[] = []): TrademarkVerdict {
  const s = sld.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return { blocked: false, flag: null, matched: null, reason: null };

  const tokenSet = new Set<string>();
  for (const t of tokens) {
    const clean = t.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean) tokenSet.add(clean);
  }
  for (const w of segment(s, tokens).words) tokenSet.add(w);

  for (let i = 0; i < TRADEMARK_BLOCKLIST_COMPACT.length; i += 1) {
    const compact = TRADEMARK_BLOCKLIST_COMPACT[i];
    const original = TRADEMARK_BLOCKLIST[i];
    if (!compact) continue;
    if (tokenSet.has(compact)) {
      return { blocked: true, flag: `brand:${original}`, matched: original, reason: 'token-match' };
    }
    if (compact.length >= PREFIX_SUFFIX_MIN_LEN && (s.startsWith(compact) || s.endsWith(compact))) {
      return { blocked: true, flag: `brand:${original}`, matched: original, reason: 'prefix-or-suffix-match' };
    }
  }
  return { blocked: false, flag: null, matched: null, reason: null };
}

export interface TrademarkGuidance {
  /** 全候補に必ず出す注意文。 */
  note: string;
  /** リンク先で検索が自動実行されない場合がある旨の注記。 */
  caveat: string;
  links: OfficialLink[];
}

export function trademarkGuidance(keyword: string): TrademarkGuidance {
  return {
    note: TRADEMARK_REQUIRED_NOTE,
    caveat: TRADEMARK_LINK_CAVEAT,
    links: trademarkSearchLinks(keyword),
  };
}

export { TRADEMARK_BLOCKLIST };
