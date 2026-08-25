import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tmux, classifyHasSession, realRunner, type Runner, type ExecResult } from '../src/exec.js';
import { VERDICT_MESSAGE_ROWS } from './sessionVerdictFixture.js';

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

/** D-309 (was D-B8-13): the server twin of ccd's `_session_verdict` (D-308 (was D-B8-12)). `has-session`
 *  answers three different questions with one exit status, and `hasSession`
 *  collapsed all three into one boolean — the exact narrowing the architecture
 *  doc's highest-yield rule forbids an adapter, in the adapter. The polarity is
 *  the whole design: recognise the ONE message that means death, call everything
 *  else unknown. The fixture rows are shared with the bash suite
 *  (`ccd-session-verdict.test.ts`) so the twins cannot drift apart. */
describe('classifyHasSession — three answers, not one boolean (D-309)', () => {
  it('live: has-session succeeded', () => {
    expect(classifyHasSession({ code: 0, stdout: '', stderr: '' })).toEqual({ verdict: 'live' });
  });

  for (const row of VERDICT_MESSAGE_ROWS) {
    it(row.name, () => {
      const v = classifyHasSession({ code: 1, stdout: '', stderr: `${row.message}\n` });
      expect(v.verdict).toBe(row.expected);
      // The message IS the diagnosis (substrate-unreachable spec §2): an
      // unknown must carry it verbatim, because narrowing it here would repeat
      // the mistake D-308 removed one layer down.
      if (v.verdict === 'unknown') expect(v.detail).toBe(row.message);
    });
  }

  it('unknown with a NON-EMPTY detail when stderr is empty and a signal names the killer', () => {
    // The remote path: the agent's execFile deadline (TMUX_TIMEOUT_MS) kills a
    // client wedged on an unresponsive server — measured 2026-08-19: a
    // SIGSTOPped tmux server blocks `has-session` indefinitely. The child dies
    // by signal having printed nothing; an empty detail is the blank marker
    // reason the spec forbids.
    const v = classifyHasSession({ code: 1, stdout: '', stderr: '', killed: true, signal: 'SIGTERM' });
    expect(v.verdict).toBe('unknown');
    if (v.verdict === 'unknown') {
      expect(v.detail).toContain('SIGTERM');
      expect(v.detail.trim()).not.toBe('');
    }
  });

  it('unknown with a NON-EMPTY detail when NOTHING was measured — the older-agent / dropped-link shape', () => {
    // `remote/runner.ts` synthesizes `{code:1, stdout:'', stderr:<message>}` on
    // a transport failure, but an older agent frame can arrive with all three
    // fields defaulted. Absence of evidence is still not evidence of absence.
    const v = classifyHasSession({ code: 1, stdout: '', stderr: '' });
    expect(v.verdict).toBe('unknown');
    if (v.verdict === 'unknown') expect(v.detail.trim()).not.toBe('');
  });

  it('sessionVerdict wires the classifier to the has-session argv; hasSession derives, true only for live', async () => {
    const wedged = fake({ 'has-session': { code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-1000/default\n' } });
    const t = new Tmux(wedged.run);
    expect((await t.sessionVerdict('myid')).verdict).toBe('unknown');
    expect(wedged.calls[0]).toEqual(['tmux', 'has-session', '-t', 'cc-myid']);
    // Derived, exactly like bash `_alive`: unknown and gone BOTH read false to
    // the callers that kept the boolean — their deliberate collapses are
    // documented at each site, not here.
    expect(await t.hasSession('myid')).toBe(false);
    const gone = new Tmux(fake({ 'has-session': { code: 1, stdout: '', stderr: "can't find session: cc-myid\n" } }).run);
    expect((await gone.sessionVerdict('myid')).verdict).toBe('gone');
    expect(await gone.hasSession('myid')).toBe(false);
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
