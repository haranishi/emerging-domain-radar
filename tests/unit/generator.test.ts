/** ドメイン候補生成（architecture §6）。決定的・最大 10 件・.com のみ。 */
import { describe, expect, it } from 'vitest';
import {
  MAX_DOMAINS,
  buildRawCandidates,
  generateDomainCandidates,
  generateDomains,
  normalizeKeywordTokens,
} from '../../src/lib/domain/generator';
import { ABBREVIATIONS } from '../../src/lib/domain/words';

describe('normalizeKeywordTokens', () => {
  it('小文字・英字のみにする', () => {
    expect(normalizeKeywordTokens('Context  Engineering')).toEqual(['context', 'engineering']);
    expect(normalizeKeywordTokens('vibe-coding')).toEqual(['vibe', 'coding']);
    expect(normalizeKeywordTokens('agent/mesh')).toEqual(['agent', 'mesh']);
  });

  it('先頭の冠詞・前置詞を落とす', () => {
    expect(normalizeKeywordTokens('the agentic protocol')).toEqual(['agentic', 'protocol']);
    expect(normalizeKeywordTokens('a synthetic memory')).toEqual(['synthetic', 'memory']);
    expect(normalizeKeywordTokens('of for the agent mesh')).toEqual(['agent', 'mesh']);
  });

  it('数字を含むトークンは捨てる', () => {
    expect(normalizeKeywordTokens('gpt5 agents')).toEqual(['agents']);
    expect(normalizeKeywordTokens('web3 protocol')).toEqual(['protocol']);
  });
});

describe('生成規則', () => {
  it('順序が固定されている（concat → abbrev → reorder → prefix → suffix → partial）', () => {
    const rules = buildRawCandidates(['synthetic', 'memory']).map((c) => c.rule);
    expect(rules[0]).toBe('concat');
    expect(rules.indexOf('abbrev')).toBeGreaterThan(0);
    expect(rules.indexOf('abbrev')).toBeLessThan(rules.indexOf('reorder'));
    expect(rules.indexOf('reorder')).toBeLessThan(rules.indexOf('suffix'));
  });

  it('略語辞書は 1 語ずつと全語まとめの両方を作る', () => {
    const slds = buildRawCandidates(['synthetic', 'memory']).map((c) => c.sld);
    expect(slds).toContain('synthmemory'); // synthetic → synth
    expect(slds).toContain('syntheticmem'); // memory → mem
    expect(slds).toContain('synthmem'); // 両方
  });

  it('略語辞書は 40 語以上ある', () => {
    expect(Object.keys(ABBREVIATIONS).length).toBeGreaterThanOrEqual(40);
  });

  it('prefix は結合が 12 文字以下のときだけ', () => {
    const short = buildRawCandidates(['vibe', 'coding']).filter((c) => c.rule === 'prefix');
    expect(short.map((c) => c.sld)).toEqual(['getvibecoding', 'tryvibecoding', 'usevibecoding']);
    const long = buildRawCandidates(['context', 'engineering']).filter((c) => c.rule === 'prefix');
    expect(long).toEqual([]);
  });

  it('suffix の ai はキーワードに ai を含まないときだけ', () => {
    const withoutAi = buildRawCandidates(['agent', 'mesh']).filter((c) => c.rule === 'suffix').map((c) => c.sld);
    expect(withoutAi).toContain('agentmeshai');
    const withAi = buildRawCandidates(['ai', 'mesh']).filter((c) => c.rule === 'suffix').map((c) => c.sld);
    expect(withAi).not.toContain('aimeshai');
    expect(withAi).toContain('aimeshhub');
  });

  it('partial は末尾の一般語を落とす', () => {
    const slds = buildRawCandidates(['agentic', 'protocol']).filter((c) => c.rule === 'partial').map((c) => c.sld);
    expect(slds).toEqual(['agentic']);
    expect(buildRawCandidates(['agent', 'mesh']).filter((c) => c.rule === 'partial')).toEqual([]);
  });

  it('reorder は 2 語のときだけ', () => {
    expect(buildRawCandidates(['agent', 'mesh']).filter((c) => c.rule === 'reorder')).toHaveLength(1);
    expect(buildRawCandidates(['a', 'b', 'c']).filter((c) => c.rule === 'reorder')).toHaveLength(0);
  });
});

describe('generateDomains', () => {
  it('決定的（同じ入力 → 同じ出力）', () => {
    const a = generateDomains('synthetic memory');
    const b = generateDomains('synthetic memory');
    expect(a.map((d) => d.domain)).toEqual(b.map((d) => d.domain));
    expect(a.map((d) => d.domainScore)).toEqual(b.map((d) => d.domainScore));
  });

  it('最大 10 件', () => {
    for (const kw of ['agent mesh', 'synthetic memory', 'context engineering', 'distributed inference protocol']) {
      expect(generateDomains(kw).length).toBeLessThanOrEqual(MAX_DOMAINS);
    }
    expect(MAX_DOMAINS).toBe(10);
  });

  it('.com のみ・ハイフン無し・数字無し・4〜24 文字', () => {
    for (const d of generateDomains('context engineering')) {
      expect(d.domain.endsWith('.com')).toBe(true);
      expect(d.sld).toMatch(/^[a-z]+$/);
      expect(d.sld.length).toBeGreaterThanOrEqual(4);
      expect(d.sld.length).toBeLessThanOrEqual(24);
    }
  });

  it('重複しない', () => {
    const list = generateDomains('memory memory');
    expect(new Set(list.map((d) => d.domain)).size).toBe(list.length);
  });

  it('Domain Score 降順 → 短い順 → 辞書順で並ぶ', () => {
    const list = generateDomains('agent mesh');
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1];
      const cur = list[i];
      const prevScore = prev.domainScore ?? -1;
      const curScore = cur.domainScore ?? -1;
      expect(prevScore).toBeGreaterThanOrEqual(curScore);
      if (prevScore === curScore) expect(prev.sld.length).toBeLessThanOrEqual(cur.sld.length);
    }
  });

  it('価格を渡すと価格成分が反映される（渡さなければ中立値）', () => {
    const withPrice = generateDomains('agent mesh', { renewalPrice: 11.08 })[0];
    const withoutPrice = generateDomains('agent mesh', { renewalPrice: null })[0];
    expect(withPrice.domain).toBe(withoutPrice.domain);
    expect(withPrice.breakdown?.price).toBe(100);
    expect(withoutPrice.breakdown?.price).toBe(70);
  });

  it('トークンが 0 個なら候補も 0 件', () => {
    expect(generateDomains('the of for')).toEqual([]);
    expect(generateDomains('2026 5')).toEqual([]);
  });

  it('商標に触れる候補は除外され、理由が残る', () => {
    const all = generateDomainCandidates('google gemini agents');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((c) => c.excluded)).toBe(true);
    expect(all[0].excludeReason).toContain('brand:google');
    expect(all[0].trademarkFlag).toBe('brand:google');
    expect(generateDomains('google gemini agents')).toEqual([]);
  });

  it('generation_rule が候補ごとに記録される', () => {
    const list = generateDomains('synthetic memory');
    expect(list.map((d) => d.rule)).toContain('concat');
    expect(new Set(list.map((d) => d.rule)).size).toBeGreaterThan(1);
  });
});
