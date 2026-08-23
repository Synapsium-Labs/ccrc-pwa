// server/test/ccd-reason-flag.test.ts
//
// ccd:9473-9476 is the paid lesson and it is quoted in full there: a second
// POSITIONAL on `ensure` was threaded down to `(( … >= bound ))`, where bash
// evaluates a variable's CONTENTS as arithmetic and a command substitution
// inside an array subscript EXECUTES — i.e. any extra argv word a
// prefix-whitelisted verb accepts is a candidate for arbitrary code as the fleet
// user. So `--reason` is a validated FLAG, stripped before the arity rule, and
// its value reaches no arithmetic context anywhere.
//
// STANDING NOTE: matches `ccd-workspaces.test.ts:1045`'s `/^ccd.*\.ts$/`
// containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, decOf, refusalsOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-reason-'); });
afterEach(() => { h.cleanup(); });

const reasonOf = (act: string): string | undefined => decOf(eventsOf(h.home, act)[0] ?? {})['reason'];

const fails = (snippet: string): { code: number; stderr: string } => {
  try { h.sh(snippet); return { code: 0, stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? '') };
  }
};

const STUB = `_ws_unsupervise() { :; }; _tmux() { echo t; }; tmux() { :; };`;

describe('--reason on ws-rm', () => {
  const seed = (): void => {
    h.makeRepo('demo');
    h.sh(`_reg_set demo-x uuid u; _reg_set demo-x project demo; _reg_set demo-x workspace x
      _reg_set demo-x workdir ${h.home}/gone`);
  };

  it('carries the reason onto the destroy lines', () => {
    seed();
    h.sh(`${STUB} cmd_ws_rm --reason 'merged in #42' demo-x 2>/dev/null || true`);
    expect(reasonOf('destroy')).toBe('merged in #42');
  });

  it('accepts --reason=<text> too', () => {
    seed();
    h.sh(`${STUB} cmd_ws_rm --reason='wave 3 done' demo-x 2>/dev/null || true`);
    expect(reasonOf('destroy')).toBe('wave 3 done');
  });

  it('STRIPS THE FLAG BEFORE THE ID IS BOUND — the id is never `--reason`', () => {
    // Mutant: strip after `local id="${1:?…}"` -> `$id` becomes the flag word,
    // `_reg_get` answers nothing, and the verb aims at a session that does not
    // exist while the real one keeps running. Same defect cmd_stop's own header
    // (ccd:11085) records for --surface.
    seed();
    h.sh(`${STUB} cmd_ws_rm --reason r demo-x 2>/dev/null || true`);
    expect(eventsOf(h.home, 'destroy')[0]?.['id']).toBe('demo-x');
  });

  it('does not loop for ever on a flag with no value', () => {
    // Under `set -uo pipefail` with NO `-e`, a `shift 2` past the end of argv
    // fails, shifts nothing, and the loop never terminates. The explicit
    // `[[ $# -ge 2 ]]` is what stops that; ccd:2805 states it.
    const r = fails(`${STUB} cmd_ws_rm --reason`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd ws-rm');
  });

  it('REFUSES extra positionals with a RECORD — the flag widening did not open the arity', () => {
    // ws-rm had NO arity guard at all before this task: `ccd ws-rm x y z`
    // silently ignored `y z`.
    seed();
    const r = fails(`${STUB} cmd_ws_rm demo-x extra`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd ws-rm');
    expect(refusalsOf(h.home)).toEqual([{ act: 'destroy', token: 'bad-args' }]);
  });

  it('never lets the reason reach an arithmetic context', () => {
    seed();
    h.sh(`${STUB} cmd_ws_rm --reason 'a[$(touch $HOME/PWNED)]' demo-x 2>/dev/null || true`);
    expect(fs.existsSync(path.join(h.home, 'PWNED')),
      'a --reason must be display-only, parsed nowhere').toBe(false);
    expect(reasonOf('destroy')).toBe('a[$(touch $HOME/PWNED)]');
  });

  it('REFUSES an over-cap reason rather than truncating it', () => {
    // Mutant: `reason="${reason:0:512}"` instead of `_lc_dec_ok || _lc_refuse`
    // -> this fails with `expected 0 not to be 0`, and a 900-byte note is
    // recorded as 512 bytes of the operator's own words with nothing saying so.
    seed();
    const r = fails(`${STUB} cmd_ws_rm --reason "$(printf 'z%.0s' {1..900})" demo-x`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('longer than 512 bytes');
    expect(refusalsOf(h.home)).toEqual([{ act: 'destroy', token: 'bad-args' }]);
  });

  it('measures the cap in BYTES — 200 emoji are 800 bytes and are refused', () => {
    seed();
    const r = fails(`${STUB} cmd_ws_rm --reason "$(printf '\\U0001F600%.0s' {1..200})" demo-x`);
    expect(r.code, 'a character cap would have let this through at 200').not.toBe(0);
  });

  it('accepts exactly 512 bytes', () => {
    seed();
    h.sh(`${STUB} cmd_ws_rm --reason "$(printf 'z%.0s' {1..512})" demo-x 2>/dev/null || true`);
    expect(reasonOf('destroy')!.length).toBe(512);
  });
});

describe('--reason on forget', () => {
  it('carries the reason and keeps the exact-arity guard on the residue', () => {
    h.sh('_reg_set s uuid u');
    h.sh(`${STUB} _session_verdict() { echo gone; }; cmd_forget --reason 'stale row' s`);
    expect(reasonOf('forget')).toBe('stale row');
  });

  it('still refuses an extra positional, with a record', () => {
    h.sh('_reg_set s uuid u');
    const r = fails(`${STUB} _session_verdict() { echo gone; }; cmd_forget s extra`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd forget');
    expect(refusalsOf(h.home)).toEqual([{ act: 'forget', token: 'bad-args' }]);
  });
});
