import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * better-sqlite3 はネイティブアドオンなのでバンドルせず Node の require に任せる。
   * （Next.js の既定の除外リストにも入っているが、依存の中核なので明示しておく）
   */
  serverExternalPackages: ['better-sqlite3'],

  /**
   * `next dev` は起動時のホスト（既定 localhost）以外からの dev 用リソースを既定で拒否する
   * （allowedDevOrigins の項）。`http://127.0.0.1:3210` で開くと `/_next/hmr` が
   * ブロックされ、HMR クライアントの接続が失敗したまま **ハイドレーションが走らない**。
   * 画面は描かれるのにフィルターも検索ボタンも一切反応しない、という分かりにくい壊れ方をする
   * （2026-09-04、E2E をこのアドレスで回して発見）。ループバックだけを明示的に許可する。
   * 本番ビルドには影響しない。
   */
  allowedDevOrigins: ['127.0.0.1', '[::1]'],
};

export default nextConfig;
