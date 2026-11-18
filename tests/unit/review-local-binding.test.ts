import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

const lan = Object.values(networkInterfaces()).flat().find((a) => a && !a.internal && a.family === 'IPv4')?.address;
const canConnect = (host: string, port: number) => new Promise<boolean>((resolve) => {
  const socket = connect({ host, port });
  const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
  socket.setTimeout(1000, () => done(false));
});

it.skipIf(!lan)('the default dev command accepts only loopback connections', async () => {
  const root = process.cwd();
  const dir = mkdtempSync(path.join(tmpdir(), 'edr-listen-'));
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('port unavailable');
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  mkdirSync(path.join(dir, 'app'));
  writeFileSync(path.join(dir, 'app/page.js'), 'export default function Page() { return null; }');
  writeFileSync(path.join(dir, 'package.json'), '{"private":true}');
  symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const args = pkg.scripts.dev.split(' ').slice(1);
  const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), ...args, '--port', String(port), '--webpack'], {
    cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 起動前に終了しても後始末が止まらないよう、終了の待ちは生成の直後に作って共有する。
  const closed = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(output || 'server did not start')), 15000);
      const capture = (data: Buffer) => {
        output += data.toString();
        if (/Ready in/.test(output)) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`exit=${code}: ${output}`)); });
    });
    expect(await canConnect('127.0.0.1', port)).toBe(true);
    expect(await canConnect(lan!, port)).toBe(false);
  } finally {
    child.kill('SIGTERM');
    await closed;
    rmSync(dir, { recursive: true, force: true });
  }
});
