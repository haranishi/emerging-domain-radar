/** Domain Score（architecture §5.4 / research/04 §5.4）。 */
import { describe, expect, it } from 'vitest';
import {
  KEYWORD_MATCH_SCORE,
  NEUTRAL_PRICE_SCORE,
  WEIGHTS,
  domainScore,
  extractFeatures,
  lengthScore,
  maxConsonantRun,
  memorabilityScore,
  priceScore,
  pronounceScore,
  scoreDomain,
  spellScore,
  structureScore,
  syllableCount,
  vowelRatio,
} from '../../src/lib/domain/score';

describe('特徴量', () => {
  it('SLD と TLD を分ける', () => {
    const f = extractFeatures('vibecoding.com');
    expect(f.sld).toBe('vibecoding');
    expect(f.tld).toBe('com');
    expect(f.len).toBe(10);
    expect(f.words).toEqual(['vibe', 'coding']);
    expect(f.dictCoverage).toBe(1);
  });

  it('音節・母音比・子音連続', () => {
    expect(syllableCount('vibecoding')).toBe(4);
    expect(syllableCount('strngthtrnr')).toBe(0);
    expect(vowelRatio('mcpserver')).toBeCloseTo(2 / 9, 6); // e が 2 つ（y も母音扱いだが無い）
    expect(maxConsonantRun('strngthtrnr')).toBe(11);
    expect(maxConsonantRun('vibecoding')).toBe(2);
  });

  it('ハイフン・数字・先頭数字を数える', () => {
    const f = extractFeatures('3ai-agent2.com');
    expect(f.hyphens).toBe(1);
    expect(f.digits).toBe(2);
    expect(f.leadingDigit).toBe(true);
  });
});

describe('成分ごとの式', () => {
  it('length: L<=3 は 60、<=10 は 100、以降は逓減', () => {
    expect(lengthScore(3)).toBe(60);
    expect(lengthScore(10)).toBe(100);
    expect(lengthScore(11)).toBe(92);
    expect(lengthScore(14)).toBe(68);
    expect(lengthScore(17)).toBe(41);
    expect(lengthScore(20)).toBe(14);
    expect(lengthScore(21)).toBe(0);
  });

  it('pronounce: 母音欠落と子音連続を強く減点する', () => {
    const good = pronounceScore({ sld: 'vibecoding', vowelRatio: 0.4, maxConsRun: 2, syllables: 4 });
    const bad = pronounceScore({ sld: 'strngthtrnr', vowelRatio: 0.09, maxConsRun: 11, syllables: 1 });
    expect(good).toBeGreaterThan(90);
    expect(bad).toBe(0);
  });

  it('pronounce: 英語で成立しない音素連鎖は −25', () => {
    const base = pronounceScore({ sld: 'aviba', vowelRatio: 0.42, maxConsRun: 1, syllables: 3 });
    const withCluster = pronounceScore({ sld: 'avkba', vowelRatio: 0.42, maxConsRun: 1, syllables: 3 });
    expect(base - withCluster).toBe(25);
  });

  it('spell: 曖昧綴りは 1 件 −15・最大 −45', () => {
    expect(spellScore({ sld: 'agentmesh', words: ['agent', 'mesh'], dictCoverage: 1 })).toBe(100);
    expect(spellScore({ sld: 'phone', words: ['phone'], dictCoverage: 1 })).toBe(85);
    expect(spellScore({ sld: 'xphgh', words: [], dictCoverage: 0 })).toBe(35); // 45 減 + 辞書外 20 減
  });

  it('spell: 同一文字 3 連は −20、語境界の重複は −15', () => {
    expect(spellScore({ sld: 'aaargh', words: ['aaargh'], dictCoverage: 1 })).toBe(65);
    expect(spellScore({ sld: 'newsstand', words: ['news', 'stand'], dictCoverage: 1 })).toBe(85);
    expect(spellScore({ sld: 'apple', words: ['apple'], dictCoverage: 1 })).toBe(100);
    expect(spellScore({ sld: 'memory', words: ['memory'], dictCoverage: 1 })).toBe(100);
  });

  it('spell: 語境界の −15 は実際の単語分割で決まる（単語内の二重字は減点しない）', () => {
    // words を手で渡さず、SLD の分割（segment）を通した結果で確かめる。
    expect(extractFeatures('newsstand.com').words).toEqual(['news', 'stand']);
    expect(scoreDomain('newsstand.com').breakdown?.spell).toBe(85);
    // memory は二重字なし、apple の pp は単語内なので減点しない
    expect(scoreDomain('memory.com').breakdown?.spell).toBe(100);
    expect(scoreDomain('apple.com').breakdown?.spell).toBe(100);
  });

  it('spell: 語が隣接していなければ境界ではない（segment が落とした文字を挟む場合）', () => {
    // segment は辞書に無い文字を落とすので words だけ見ると news/stand が隣に並ぶ。
    // SLD 上では `newsxstand` と離れているので、境界の重複としては数えない（x の曖昧綴り −15 だけ）。
    expect(extractFeatures('newsxstand.com').words).toEqual(['news', 'stand']);
    expect(spellScore(extractFeatures('newsxstand.com'))).toBe(85);
    expect(spellScore({ sld: 'newszstand', words: ['news', 'stand'], dictCoverage: 0.9 })).toBe(100);
  });

  it('structure: ハイフン −35 / 数字 −25 / 先頭数字 追加 −15 / 3 語 −15 / 4 語以上 −30', () => {
    expect(structureScore({ hyphens: 0, digits: 0, leadingDigit: false, words: ['a', 'b'] })).toBe(100);
    expect(structureScore({ hyphens: 1, digits: 0, leadingDigit: false, words: ['a', 'b'] })).toBe(65);
    expect(structureScore({ hyphens: 0, digits: 1, leadingDigit: true, words: ['a', 'b'] })).toBe(60);
    expect(structureScore({ hyphens: 0, digits: 0, leadingDigit: false, words: ['a', 'b', 'c'] })).toBe(85);
    expect(structureScore({ hyphens: 0, digits: 0, leadingDigit: false, words: ['a', 'b', 'c', 'd'] })).toBe(70);
  });

  it('memorability: 語が 0〜1 個でも頭韻ボーナスが誤って付かない', () => {
    // research/04 の実装例は words[0]?.[0] === words[1]?.[0] が undefined 同士で真になっていた
    const zeroWords = memorabilityScore({ syllables: 3, words: [], dictCoverage: 0 });
    expect(zeroWords).toBe(85); // 60 + 25（2〜3 音節）のみ
    const alliteration = memorabilityScore({ syllables: 3, words: ['side', 'stack'], dictCoverage: 0.95 });
    expect(alliteration).toBe(100); // 60 + 25 + 10 + 5 → 上限 100
  });

  it('price: 更新価格ベース・USD・不明は中立値 70', () => {
    expect(priceScore(11.08, false)).toBe(100);
    expect(priceScore(13, false)).toBe(100);
    expect(priceScore(33, false)).toBe(60);
    expect(priceScore(130, false)).toBe(10);
    expect(priceScore(200, false)).toBe(9);
    expect(priceScore(11.08, true)).toBe(70); // premium は −30
    expect(priceScore(null, false)).toBe(NEUTRAL_PRICE_SCORE);
    expect(priceScore(null, false)).toBe(70);
  });

  it('keywordMatch の写像', () => {
    expect(KEYWORD_MATCH_SCORE).toEqual({
      concat: 100,
      suffix: 85,
      prefix: 85,
      reorder: 70,
      abbrev: 50,
      partial: 25,
      none: 0,
      'n/a': 50,
    });
  });

  it('重みの合計は 1', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});

describe('domainScore', () => {
  it('.com 以外は null（TLD はゲート）', () => {
    expect(domainScore(extractFeatures('vibecoding.io'))).toBeNull();
    expect(domainScore(extractFeatures('vibecoding.ai'))).toBeNull();
    expect(domainScore(extractFeatures('vibecoding'))).toBeNull();
  });

  it('research/04 §5.5 の並び（短くて素直な 2 語が上・母音欠落が下）を再現する', () => {
    const opts = { keywordMatch: 'concat' as const, renewalPrice: 11.08 };
    const vibecoding = scoreDomain('vibecoding.com', opts).score ?? 0;
    const mcpserver = scoreDomain('mcpserver.com', opts).score ?? 0;
    const withHyphen = scoreDomain('ai-agent-hub.com', { ...opts, keywordMatch: 'suffix' }).score ?? 0;
    const withDigit = scoreDomain('getvibecoding2.com', { ...opts, keywordMatch: 'reorder' }).score ?? 0;
    const noVowels = scoreDomain('strngthtrnr.com', { ...opts, keywordMatch: 'partial' }).score ?? 0;

    expect(vibecoding).toBeGreaterThan(90);
    expect(mcpserver).toBeGreaterThan(90);
    expect(withHyphen).toBeLessThan(vibecoding);
    expect(withDigit).toBeLessThan(withHyphen);
    expect(noVowels).toBeLessThan(withDigit);
  });

  it('価格が不明でもスコアが出る（推測値を入れない）', () => {
    const withPrice = scoreDomain('agentmesh.com', { keywordMatch: 'concat', renewalPrice: 11.08 });
    const noPrice = scoreDomain('agentmesh.com', { keywordMatch: 'concat', renewalPrice: null });
    expect(withPrice.breakdown?.price).toBe(100);
    expect(noPrice.breakdown?.price).toBe(70);
    expect(noPrice.score).toBeLessThan(withPrice.score ?? 0);
  });

  it('0〜100 の整数', () => {
    for (const d of ['a.com', 'ab.com', 'agentmesh.com', 'verylongdomainnamethatis.com', 'zxqxjq.com']) {
      const s = scoreDomain(d, { keywordMatch: 'concat' }).score;
      if (s === null) continue;
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});
