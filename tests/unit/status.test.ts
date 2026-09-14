/** Status の閾値と fading フラグ（architecture §5.4）。 */
import { describe, expect, it } from 'vitest';
import { THRESHOLDS, classifyStatus } from '../../src/lib/trend/status';

describe('classifyStatus', () => {
  const cases: { name: string; c30: number; c30prev: number; S: number; status: string; fading?: boolean }[] = [
    { name: 'どのソースにも出ない', c30: 0, c30prev: 0, S: 0, status: 'Noise' },
    { name: '定着済み', c30: 600, c30prev: 550, S: 4, status: 'Mainstream' },
    { name: '閾値ちょうど 500', c30: 500, c30prev: 400, S: 4, status: 'Mainstream' },
    { name: '件数で Trending', c30: 120, c30prev: 110, S: 4, status: 'Trending' },
    { name: '成長率で Trending（件数は少ない）', c30: 12, c30prev: 1, S: 3, status: 'Trending' },
    { name: '立ち上がり', c30: 60, c30prev: 20, S: 4, status: 'Rising' },
    { name: '芽が出た', c30: 13, c30prev: 5, S: 4, status: 'Emerging' },
    { name: '出たばかり・横ばい', c30: 5.5, c30prev: 4.3, S: 4, status: 'Early' },
    { name: 'ほぼ無い', c30: 1, c30prev: 1, S: 1, status: 'Early' },
    { name: 'ピーク済み（Status は Trending を維持）', c30: 142, c30prev: 431, S: 4, status: 'Trending', fading: true },
    // fading（g30<0.7）と Rising（g30>=1.5）は両立しないので、この帯は Early に落ちる。
    // fading が付きうる Status は Mainstream / Trending / Early の 3 つだけ。
    { name: 'ピーク済み（Rising の件数帯だが成長率が低い）', c30: 30, c30prev: 100, S: 4, status: 'Early', fading: true },
  ];

  for (const c of cases) {
    it(`${c.name}: c30=${c.c30} c30prev=${c.c30prev} S=${c.S} → ${c.status}${c.fading ? ' + fading' : ''}`, () => {
      const r = classifyStatus(c.c30, c.c30prev, c.S);
      expect(r.status).toBe(c.status);
      expect(r.fading).toBe(c.fading ?? false);
    });
  }

  it('fading は c30>=25 かつ g30<0.7 のときだけ立つ', () => {
    expect(classifyStatus(24, 100, 3).fading).toBe(false); // 件数が足りない
    expect(classifyStatus(30, 40, 3).fading).toBe(false); // 減りが足りない
    expect(classifyStatus(30, 100, 3).fading).toBe(true);
  });

  it('fading が付きうるのは Mainstream / Trending / Early だけ', () => {
    expect(classifyStatus(900, 2000, 4)).toMatchObject({ status: 'Mainstream', fading: true });
    expect(classifyStatus(142, 431, 4)).toMatchObject({ status: 'Trending', fading: true });
    expect(classifyStatus(30, 100, 4)).toMatchObject({ status: 'Early', fading: true });
  });

  it('Noise のときは fading を立てない', () => {
    expect(classifyStatus(0, 100, 0)).toEqual({ status: 'Noise', fading: false, g30: 3 / 103 });
  });

  it('閾値は 1 か所の定数', () => {
    expect(THRESHOLDS).toEqual({
      mainstream: 500,
      trending: 100,
      rising: 25,
      emerging: 5,
      gTrending: 3.0,
      gRising: 1.5,
      gEmerging: 1.3,
      gFading: 0.7,
    });
  });
});
