import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('documented CLI commands load .env before opening the database', () => {
  const root = process.cwd();
  const dir = mkdtempSync(path.join(tmpdir(), 'edr-env-'));
  try {
    symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    writeFileSync(path.join(dir, 'next.config.ts'), 'export default {};');
    writeFileSync(path.join(dir, '.env'), 'RADAR_DB_PATH=configured.db\nRADAR_OFFLINE=1\nRADAR_MAX_KEYWORDS=3\n');
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const args: string[] = pkg.scripts['radar:collect'].split(' ');
    const executable = args.shift() === 'node' ? process.execPath : path.join(root, 'node_modules/.bin/tsx');
    args[args.length - 1] = path.join(root, 'scripts/collect.ts');
    const result = spawnSync(executable, [...args, '--dry-run'], {
      cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1' },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('RADAR_DB_PATH=configured.db');
    expect(result.stdout).toContain('offline=yes maxKeywords=3');
    expect(existsSync(path.join(dir, 'configured.db'))).toBe(true);
    expect(existsSync(path.join(dir, 'data/radar.db'))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
