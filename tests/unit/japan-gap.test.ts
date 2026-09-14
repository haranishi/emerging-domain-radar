/** Japan Gap Score（architecture §5.4）。 */
import { describe, expect, it } from 'vitest';
import { WIKI_PRESENT_CAP, japanGapBreakdown, japanGapScore } from '../../src/lib/japan/score';

describe('japanGapScore', () => {
  it('日本語の言及が無ければ 100', () => {
    expect(japanGapScore({ qiita30: 0, wikiJa: false, pv30: 0, enUnits: 50 })).toBe(100);
  });

  it('日本語の言及が英語圏を上回れば 0', () => {
    expect(japanGapScore({ qiita30: 200, wikiJa: false, pv30: 0, enUnits: 50 })).toBe(0);
  });

  it('enUnits が 0 なら null（比べる相手が無い）', () => {
    expect(japanGapScore({ qiita30: 0, wikiJa: false, pv30: 0, enUnits: 0 })).toBeNull();
  });

  it('qiita 件数は SCALE=100 で参照単位に直す', () => {
    // qiita30=25 → 25 units、enUnits=100 → gap = 1 - 0.25 = 75
    expect(japanGapScore({ qiita30: 25, wikiJa: false, pv30: 0, enUnits: 100 })).toBe(75);
  });

  it('日本語版 Wikipedia に記事があると 20 + pv30×100/3000 が加わる', () => {
    const r = japanGapBreakdown({ qiita30: 0, wikiJa: true, pv30: 3000, enUnits: 1000 });
    expect(r.wikiUnits).toBe(120);
    expect(r.jpUnits).toBe(120);
  });

  it('記事があるときは上限 40', () => {
    const r = japanGapBreakdown({ qiita30: 0, wikiJa: true, pv30: 0, enUnits: 10_000 });
    expect(r.capped).toBe(true);
    expect(r.score).toBe(WIKI_PRESENT_CAP);
  });

  it('記事があっても素点が上限より低ければそのまま', () => {
    const r = japanGapBreakdown({ qiita30: 80, wikiJa: true, pv30: 1800, enUnits: 120 });
    expect(r.capped).toBe(false);
    expect(r.score).toBeLessThan(WIKI_PRESENT_CAP);
  });

  it('0〜100 に収まる', () => {
    for (const qiita30 of [0, 5, 50, 500]) {
      for (const enUnits of [1, 10, 100, 1000]) {
        const s = japanGapScore({ qiita30, wikiJa: false, pv30: 0, enUnits });
        expect(s).not.toBeNull();
        expect(s as number).toBeGreaterThanOrEqual(0);
        expect(s as number).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('jaEquivalent の記録（フェーズ3）', () => {
  it('日本語訳が取れた語はそのタイトルを内訳に残す', () => {
    const r = japanGapBreakdown({ qiita30: 24, wikiJa: true, pv30: 300, enUnits: 200, jaEquivalent: 'バイブコーディング' });
    expect(r.jaEquivalent).toBe('バイブコーディング');
  });

  it('取れなければ null（「日本語の言及が無い」ではなく「訳が分からない」）', () => {
    expect(japanGapBreakdown({ qiita30: 0, wikiJa: false, pv30: 0, enUnits: 50 }).jaEquivalent).toBeNull();
    expect(japanGapBreakdown({ qiita30: 0, wikiJa: false, pv30: 0, enUnits: 50, jaEquivalent: null }).jaEquivalent).toBeNull();
  });

  it('enUnits が 0 でも jaEquivalent は残す（画面の注記に使う）', () => {
    const r = japanGapBreakdown({ qiita30: 0, wikiJa: false, pv30: 0, enUnits: 0, jaEquivalent: '大規模言語モデル' });
    expect(r.score).toBeNull();
    expect(r.jaEquivalent).toBe('大規模言語モデル');
  });

  it('日本語訳の件数を合算すると gap が下がる（英語だけだと過大に出る）', () => {
    const enOnly = japanGapScore({ qiita30: 2, wikiJa: false, pv30: 0, enUnits: 100 });
    const withJa = japanGapScore({ qiita30: 2 + 40, wikiJa: false, pv30: 0, enUnits: 100 });
    expect(enOnly).toBe(98);
    expect(withJa).toBe(58);
  });
});
