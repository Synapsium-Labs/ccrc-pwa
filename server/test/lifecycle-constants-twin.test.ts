// One number, one unit, two languages — the SUPERVISED_FRESH_MS bash-twin
// idiom, applied to the journal's ceilings.
//
// B5's paid lesson: `--reason`'s cap arrived with three names
// (LC_REASON_MAX_BYTES / a bare `${reason:0:512}` / _LC_DEC_MAX), two units
// (bytes and characters) and two policies (truncate and refuse). A 200-emoji
// reason then passed one destructive verb at 800 bytes and was refused by
// another. The number is decided in L0; ccd speaks it; this file holds the
// two equal, and the READER is pinned against synthetic declarations before it
// is pointed at the real ccd (`ccd-die-containment.test.ts:1-25`'s precedent)
// so the comparison is measurable TODAY, while ccd still declares none of it.
//
// GREEN BEFORE WAVES 2 AND 3, GREEN AFTER THEM, RED IN BETWEEN: each wave's
// twins are all-or-nothing, so a half-landed wave is the illegal middle.
//
// Deviation from the task-9 brief, per the standing rule established in Tasks
// 4/6/7/8: every `it` block below that makes more than one INDEPENDENT claim
// uses `expect.soft` rather than a hard `expect`, so a first failure does not
// hide the rest. The brief's draft used hard `expect` throughout; this file
// applies `expect.soft` to the classifier-pinning blocks (the all-
// present/all-absent pair, and both mixture loops plus their length guards)
// and to the reader-pinning blocks whose two assertions do not gate one
// another at runtime (the declared-scalar/undeclared pair, the
// declared-function/missing-function pair, and the drifted-twin
// match/mismatch pair). The directory-basename test keeps its first
// `expect(dir).not.toBeNull()` as a HARD expect on purpose: the second
// assertion dereferences `dir!`, so a soft failure there would let
// `path.basename(null)` throw an uncaught TypeError instead of a clean
// assertion failure — this is the "downstream depends on it running"
// exception Task 8 documented, not an oversight. Assertions alone in their
// branch (the wave-2/wave-3 per-name equality checks, each single-claim
// behind its own early-return) are left as plain `expect`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import {
  LC_DIR_NAME, LC_LINE_MAX, LC_GEN_MAX_BYTES, LC_GEN_KEEP, LC_REASON_MAX_BYTES,
} from '../../shared/api.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-twin-'); });
afterEach(() => { h.cleanup(); });

/** ccd's value for a top-level scalar, or null when it is not declared.
 *  `declare -p` rather than a bare expansion because ccd runs under
 *  `set -uo pipefail` (`ccd/ccd:6`) and an unset expansion exits the shell.
 *  `prelude` exists so the reader can be pinned against a SYNTHETIC
 *  declaration before it is pointed at the real file. */
const scalar = (name: string, prelude = ''): string | null => {
  const out = h.sh(
    `${prelude}\n`
    + `if declare -p ${name} >/dev/null 2>&1; then printf '%s' "\${${name}}"; `
    + "else printf '__ABSENT__'; fi",
  );
  return out === '__ABSENT__' ? null : out;
};

/** Declared as EITHER a variable or a function. */
const declared = (name: string, prelude = ''): boolean =>
  h.sh(
    `${prelude}\n`
    + `if declare -p ${name} >/dev/null 2>&1 || declare -F ${name} >/dev/null 2>&1; `
    + "then printf yes; else printf no; fi",
  ) === 'yes';

/** All-or-nothing, per wave. `half` is the illegal middle. */
const twinWorld = (present: readonly boolean[]): 'present' | 'absent' | 'half' => {
  const n = present.filter(Boolean).length;
  return n === present.length ? 'present' : n === 0 ? 'absent' : 'half';
};

/** Every mixture of `n` booleans that is neither all-true nor all-false. */
const mixtures = (n: number): boolean[][] => {
  const out: boolean[][] = [];
  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    out.push(Array.from({ length: n }, (_, i) => (mask & (1 << i)) !== 0));
  }
  return out;
};

const WAVE2 = ['_LC_DIR', '_LC_LINE_MAX', '_LC_GEN_MAX_BYTES', '_LC_GEN_KEEP'] as const;
const WAVE3 = ['_LC_DEC_MAX', '_lc_surface_norm', '_lc_dec_ok'] as const;

describe('the twin-world classifier, pinned before it is pointed at ccd', () => {
  it('calls all-present `present` and all-absent `absent`', () => {
    // Two independent claims — expect.soft per the standing rule.
    expect.soft(twinWorld([true, true, true, true])).toBe('present');
    expect.soft(twinWorld([false, false, false, false])).toBe('absent');
  });

  it('calls every wave-2 mixture `half` — all fourteen of them', () => {
    const ms = mixtures(4);
    // Independent claims — one per mixture — so a failure on mixture 1 must
    // not hide whether mixtures 2-14 also fail. expect.soft per the standing
    // rule.
    for (const m of ms) expect.soft(twinWorld(m), JSON.stringify(m)).toBe('half');
    expect.soft(ms.length, '2^4 minus the two pure worlds').toBe(14);
  });

  it('calls every wave-3 mixture `half` — all six of them', () => {
    const ms = mixtures(3);
    for (const m of ms) expect.soft(twinWorld(m), JSON.stringify(m)).toBe('half');
    expect.soft(ms.length, '2^3 minus the two pure worlds').toBe(6);
  });
});

describe('the reader itself, pinned against synthetic declarations', () => {
  it('reads a declared scalar, and answers null for an undeclared one', () => {
    // Two independent claims — expect.soft per the standing rule.
    expect.soft(scalar('_LC_LINE_MAX', '_LC_LINE_MAX=2048')).toBe('2048');
    expect.soft(scalar('_LC_LINE_MAX')).toBeNull();
  });

  it('sees a function as declared, and a missing one as not', () => {
    expect.soft(declared('_lc_dec_ok', '_lc_dec_ok() { :; }')).toBe(true);
    expect.soft(declared('_lc_dec_ok')).toBe(false);
  });

  it('a DRIFTED twin is visible — the comparison is not vacuous', () => {
    // This is what makes the whole file worth having before wave 3 exists: the
    // equality below is exercised now, against a value that is right and a
    // value that is wrong, rather than only in a world nobody has built yet.
    // Two independent claims (the match, the mismatch) — expect.soft.
    expect.soft(Number(scalar('_LC_DEC_MAX', '_LC_DEC_MAX=512'))).toBe(LC_REASON_MAX_BYTES);
    expect.soft(Number(scalar('_LC_DEC_MAX', '_LC_DEC_MAX=256'))).not.toBe(LC_REASON_MAX_BYTES);
  });

  it('a directory twin is compared by BASENAME, never by path', () => {
    // `_LC_DIR` is `$REG/.lifecycle` — an absolute path under the fixture
    // HOME. L0 owns the NAME, not the location, so only the last component is
    // a shared value.
    const dir = scalar('_LC_DIR', '_LC_DIR="$HOME/.cc-sessions/.lifecycle"');
    // Kept as a HARD expect: `path.basename(dir!)` below dereferences `dir!`,
    // so a soft failure here would let a null `dir` crash the next line with
    // an uncaught TypeError instead of a clean assertion failure.
    expect(dir).not.toBeNull();
    expect(path.basename(dir!)).toBe(LC_DIR_NAME);
  });
});

describe('wave 2 — the journal`s names and ceilings', () => {
  it('ccd is in ONE world for all four — a half-landed wave 2 is a red suite', () => {
    const present = WAVE2.map((n) => declared(n));
    expect(twinWorld(present),
      WAVE2.map((n, i) => `${n}=${present[i]}`).join(', ')
      + ' — wave 2 ships all four in one commit or none of them',
    ).not.toBe('half');
  });

  it('_LC_DIR`s basename is LC_DIR_NAME', () => {
    const v = scalar('_LC_DIR');
    if (v === null) { expect(twinWorld(WAVE2.map((n) => declared(n)))).toBe('absent'); return; }
    expect(path.basename(v)).toBe(LC_DIR_NAME);
  });

  it('_LC_LINE_MAX equals LC_LINE_MAX', () => {
    const v = scalar('_LC_LINE_MAX');
    if (v === null) { expect(twinWorld(WAVE2.map((n) => declared(n)))).toBe('absent'); return; }
    expect(Number(v)).toBe(LC_LINE_MAX);
  });

  it('_LC_GEN_MAX_BYTES equals LC_GEN_MAX_BYTES', () => {
    const v = scalar('_LC_GEN_MAX_BYTES');
    if (v === null) { expect(twinWorld(WAVE2.map((n) => declared(n)))).toBe('absent'); return; }
    expect(Number(v)).toBe(LC_GEN_MAX_BYTES);
  });

  it('_LC_GEN_KEEP equals LC_GEN_KEEP', () => {
    const v = scalar('_LC_GEN_KEEP');
    if (v === null) { expect(twinWorld(WAVE2.map((n) => declared(n)))).toBe('absent'); return; }
    expect(Number(v)).toBe(LC_GEN_KEEP);
  });
});

describe('wave 3 — the reason cap, in BYTES, refused and never truncated', () => {
  it('ccd is in ONE world for the cap and its two helpers', () => {
    const present = WAVE3.map((n) => declared(n));
    expect(twinWorld(present),
      WAVE3.map((n, i) => `${n}=${present[i]}`).join(', ')
      + ' — wave 3 ships the cap, _lc_surface_norm and _lc_dec_ok together',
    ).not.toBe('half');
  });

  it('_LC_DEC_MAX equals LC_REASON_MAX_BYTES', () => {
    // The number only. That it is measured in BYTES (`LC_ALL=C`) and that an
    // over-cap reason is REFUSED rather than shortened is wave 5's
    // `ccd-actor-flags.test.ts` — one fact, one owner.
    const v = scalar('_LC_DEC_MAX');
    if (v === null) { expect(twinWorld(WAVE3.map((n) => declared(n)))).toBe('absent'); return; }
    expect(Number(v)).toBe(LC_REASON_MAX_BYTES);
  });
});
