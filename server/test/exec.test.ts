import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tmux, realRunner, type Runner, type ExecResult } from '../src/exec.js';

const fake = (responses: Record<string, ExecResult>): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return responses[args[0]] ?? { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
};

describe('Tmux', () => {
  it('hasSession true on code 0, false otherwise', async () => {
    const ok = new Tmux(fake({ 'has-session': { code: 0, stdout: '', stderr: '' } }).run);
    expect(await ok.hasSession('claude2-MekWarLive')).toBe(true);
    const no = new Tmux(fake({ 'has-session': { code: 1, stdout: '', stderr: '' } }).run);
    expect(await no.hasSession('claude2-MekWarLive')).toBe(false);
  });
  it('panePid parses first pane pid', async () => {
    const t = new Tmux(fake({ 'list-panes': { code: 0, stdout: '40613\n', stderr: '' } }).run);
    expect(await t.panePid('x')).toBe(40613);
  });
  it('targets cc-<id> and sends literals with -l', async () => {
    const f = fake({});
    await new Tmux(f.run).sendLiteral('myid', 'hello');
    expect(f.calls[0]).toEqual(['tmux', 'send-keys', '-t', 'cc-myid', '-l', 'hello']);
  });
});

describe('§1.4 — ExecResult.killed is OPTIONAL, and structurally false in local mode', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ccrcRoot = path.resolve(here, '..', '..');

  it('accepts a bare {code,stdout,stderr} literal — 249 of them exist across 32 files', () => {
    const r: ExecResult = { code: 0, stdout: '', stderr: '' };
    expect(r.killed).toBeUndefined();
  });

  it('realRunner can never report a kill — it passes NO timeout', async () => {
    // Which is why every §1.5 test MUST inject a runner: the adoption path is
    // structurally unreachable in `local` mode, and a test that exercised it
    // through `realRunner` would be asserting nothing.
    const src = readFileSync(path.join(ccrcRoot, 'server/src/exec.ts'), 'utf8');
    const real = /export const realRunner[\s\S]*?\n  \}\);/.exec(src)?.[0] ?? '';
    expect(real).not.toContain('timeout');
    const r = await realRunner('/bin/sh', ['-c', 'exit 3']);
    expect(r.code).toBe(3);
    expect(r.killed).toBeUndefined();
  });
});
