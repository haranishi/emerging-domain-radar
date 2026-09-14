import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // オフラインの単体テストは fixtures だけを使う。実 API は叩かない。
    env: { RADAR_OFFLINE: '1', RADAR_DB_PATH: '.tmp/vitest.db' },
    reporters: ['default'],
    testTimeout: 20_000,
  },
});
