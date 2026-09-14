/**
 * 「公式サイトで確認」と Evidence のリンク（architecture §3・§6）。
 * 純関数だけで fetch はしない。カート・購入 URL は作らない。
 */
import { describe, expect, it } from 'vitest';
import { evidenceUrl, officialLinks, trademarkSearchLinks } from '../../src/lib/domain/links';

describe('officialLinks', () => {
  const links = officialLinks('agentmesh.com');

  it('レジストラの検索画面と ICANN Lookup の 3 つ', () => {
    expect(links.map((l) => l.label)).toEqual(['Porkbun', 'Namecheap', 'ICANN Lookup']);
  });

  it('ドメインを URL エンコードして埋める', () => {
    for (const l of links) expect(l.url).toContain('agentmesh.com');
  });

  it('アフィリエイト・カート投入のパラメータを付けない', () => {
    for (const l of links) {
      expect(l.url).not.toMatch(/aff|ref=|coupon|add-to-cart|addtocart/i);
    }
  });

  it('すべて https', () => {
    for (const l of links) expect(l.url.startsWith('https://')).toBe(true);
  });
});

describe('evidenceUrl', () => {
  it('ソースごとの検索 URL を作る（引用符付きフレーズ）', () => {
    expect(evidenceUrl('hn', 'agent mesh')).toBe('https://hn.algolia.com/?q=%22agent%20mesh%22&dateRange=pastMonth&type=all');
    expect(evidenceUrl('github', 'agent mesh')).toContain('type=repositories');
    expect(evidenceUrl('arxiv', 'agent mesh')).toContain('searchtype=all');
    expect(evidenceUrl('openalex', 'agent mesh')).toContain('title_and_abstract.search');
    expect(evidenceUrl('qiita', 'agent mesh')).toContain('qiita.com/search');
    expect(evidenceUrl('wikipv', 'agent mesh')).toContain('ja.wikipedia.org');
  });

  it('特殊文字を含む語でも壊れない', () => {
    const url = evidenceUrl('hn', 'c++ & rust');
    expect(() => new URL(url)).not.toThrow();
  });
});

describe('trademarkSearchLinks', () => {
  it('5 件（4 庁 + J-PlatPat トップ）', () => {
    expect(trademarkSearchLinks('agent mesh')).toHaveLength(5);
  });
});
