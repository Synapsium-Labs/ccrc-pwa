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

describe('§1.4/§1.7 — ExecResult.killed is OPTIONAL, and realRunner MEASURES both halves', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ccrcRoot = path.resolve(here, '..', '..');

  it('accepts a bare {code,stdout,stderr} literal — 249 of them exist across 32 files', () => {
    const r: ExecResult = { code: 0, stdout: '', stderr: '' };
    expect(r.killed).toBeUndefined();
    expect(r.signal).toBeUndefined();
  });

  it('realRunner passes NO deadline, so `killed` is a measured, permanently-false fact', async () => {
    // The source assertion is the load-bearing half: `killed: false` below is only
    // an invariant for as long as nothing hands `execFile` a deadline of its own.
    // (`localcaps.ts` wraps its own ceiling at ITS call site, never on `realRunner`.)
    const src = readFileSync(path.join(ccrcRoot, 'server/src/exec.ts'), 'utf8');
    const real = /export const realRunner[\s\S]*?\n  \}\);/.exec(src)?.[0] ?? '';
    expect(real).not.toContain('timeout');
    const r = await realRunner('/bin/sh', ['-c', 'exit 3']);
    expect(r.code).toBe(3);
    // MEASURED false, not absent (§1.7). It used to be absent, which told
    // `cutShort` "nobody looked" — about the one function holding the error
    // object that knows.
    expect(r.killed).toBe(false);
    expect(r.signal).toBeNull();
  });

  it('realRunner reports the SIGNAL of an externally-killed child — killed stays false', async () => {
    // §1.7's whole point, and the case a `local`-mode fleet can genuinely hit: an
    // operator `kill`, an OOM reaper, or systemd stopping the unit mid-`ws-add`.
    // node sets `killed` only for a kill IT issued, so `signal` is the ONLY
    // evidence this child was cut short rather than refusing cleanly. Killing the
    // shell from inside itself is the same fact as an outside killer, and needs no
    // second process to race.
    const r = await realRunner('/bin/sh', ['-c', 'kill -TERM $$; sleep 5']);
    expect(r.signal).toBe('SIGTERM');
    expect(r.killed).toBe(false);
  });
});
