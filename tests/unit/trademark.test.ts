/** 商標ブロックリストと手動確認リンク（architecture §6・research/04 §4）。 */
import { describe, expect, it } from 'vitest';
import { TRADEMARK_BLOCKLIST, checkTrademark, trademarkGuidance } from '../../src/lib/domain/trademark';
import { TRADEMARK_LINK_CAVEAT, trademarkSearchLinks } from '../../src/lib/domain/links';
import { TRADEMARK_REQUIRED_NOTE } from '../../src/lib/domain/types';

describe('ブロックリスト', () => {
  it('300 語以上・重複なし・小文字', () => {
    expect(TRADEMARK_BLOCKLIST.length).toBeGreaterThanOrEqual(300);
    expect(new Set(TRADEMARK_BLOCKLIST).size).toBe(TRADEMARK_BLOCKLIST.length);
    for (const w of TRADEMARK_BLOCKLIST) expect(w).toBe(w.toLowerCase());
  });
});

describe('checkTrademark', () => {
  it('トークン一致で除外する', () => {
    const r = checkTrademark('googleagents', ['google', 'agents']);
    expect(r.blocked).toBe(true);
    expect(r.flag).toBe('brand:google');
    expect(r.reason).toBe('token-match');
  });

  it('4 文字以上のブロック語で始まる・終わると除外する', () => {
    expect(checkTrademark('notionclone').blocked).toBe(true);
    expect(checkTrademark('mynotion').blocked).toBe(true);
    expect(checkTrademark('vercelhosting').blocked).toBe(true);
  });

  it('辞書分割でブランド名が現れても捕まえる', () => {
    const r = checkTrademark('supabasetools');
    expect(r.blocked).toBe(true);
    expect(r.matched).toBe('supabase');
  });

  it('無関係な候補は通す', () => {
    for (const sld of ['agentmesh', 'syntheticmemory', 'latentretrieval', 'semanticcaching', 'contexteng']) {
      const r = checkTrademark(sld);
      expect(r.blocked, `${sld} が誤って除外された（${r.matched}）`).toBe(false);
      expect(r.flag).toBeNull();
    }
  });

  it('空文字は通す（判定対象なし）', () => {
    expect(checkTrademark('')).toEqual({ blocked: false, flag: null, matched: null, reason: null });
  });
});

describe('手動確認の導線', () => {
  it('全候補に出す注意文がある', () => {
    expect(TRADEMARK_REQUIRED_NOTE).toBe('Trademark check required');
    expect(trademarkGuidance('agent mesh').note).toBe('Trademark check required');
  });

  it('4 つの検索リンクと J-PlatPat のトップを出す', () => {
    const links = trademarkSearchLinks('agent mesh');
    const labels = links.map((l) => l.label);
    expect(labels).toEqual(['USPTO', 'WIPO Global Brand DB', 'EUIPO eSearch', 'TMview', 'J-PlatPat（要再入力）']);
    for (const l of links) expect(l.url.startsWith('https://')).toBe(true);
  });

  it('検索語を URL エンコードして埋める', () => {
    const links = trademarkSearchLinks('agent mesh');
    expect(links[0].url).toContain('agent%20mesh');
    // J-PlatPat は検索語を URL で渡す公式仕様が無いのでトップだけ
    expect(links[4].url).toBe('https://www.j-platpat.inpit.go.jp/');
  });

  it('リンク先で検索が自動実行されない場合がある旨の注記を持つ', () => {
    expect(trademarkGuidance('x').caveat).toBe(TRADEMARK_LINK_CAVEAT);
    expect(TRADEMARK_LINK_CAVEAT).toContain('再入力');
  });

  it('抵触しないと断定する文言をどこにも作らない', () => {
    const guidance = trademarkGuidance('agent mesh');
    const text = JSON.stringify(guidance);
    for (const banned of ['安全', 'no conflict', 'cleared', 'not infringing']) {
      expect(text).not.toContain(banned);
    }
  });
});
