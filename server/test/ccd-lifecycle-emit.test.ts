// server/test/ccd-lifecycle-emit.test.ts
//
// The lifecycle journal's own vocabulary and clock, read by EXECUTING ccd rather
// than grepping it — `wrapper-roster-fixture.test.ts`'s rule: compare a SET
// against ccd's own answer space, BOTH DIRECTIONS, never "each row got an
// answer". `_LC_ACTS` is a declared bash array, so `"${_LC_ACTS[@]}"` is the
// strongest reading available.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LIFECYCLE_ACTS, LIFECYCLE_OUTCOMES, LC_ACT_UNKNOWN, LC_OUTCOME_UNKNOWN } from '../../shared/api.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-emit-'); });
afterEach(() => { h.cleanup(); });

const lines = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean);

describe('_LC_ACTS / _LC_OUTCOMES — the closed vocabularies, bound to L0', () => {
  it('is set-equal to LIFECYCLE_ACTS minus the degrade name, BOTH directions', () => {
    // Mutant: drop `attic-drop` from `_LC_ACTS` -> this fails with
    // `expected [ …20 acts… ] to deeply equal [ …21 acts… ]`, and an act ccd
    // emits would degrade to `unknown` on a build that models it perfectly well.
    const want = LIFECYCLE_ACTS.filter((a) => a !== LC_ACT_UNKNOWN);
    expect(want.length, 'guards the guard: an empty want passes everything').toBe(21);
    const got = lines(h.sh('printf "%s\\n" "${_LC_ACTS[@]}"'));
    expect([...got].sort()).toEqual([...want].sort());
    expect(got, 'unknown is the READER\'s degrade, never a call site\'s choice')
      .not.toContain(LC_ACT_UNKNOWN);
  });

  it('spells every act kebab-lowercase', () => {
    for (const a of lines(h.sh('printf "%s\\n" "${_LC_ACTS[@]}"'))) {
      expect(a, `${a} is not kebab-lowercase`).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it('is set-equal to LIFECYCLE_OUTCOMES minus the degrade name, BOTH directions', () => {
    // Symmetric with the acts case above, and for the same reason: the
    // vocabulary is the set of ACCEPTABLE INPUTS, and the degrade word is the
    // OUTPUT `_lc_emit` produces when an input is not in that set. If a
    // caller's token could legitimately BE `unknown`, "the outcome genuinely
    // was unknown" and "the caller passed a token we could not recognise"
    // would collapse into one value, and `badoutcome` — which exists to
    // preserve the raw token — would become unreachable for that input.
    const want = LIFECYCLE_OUTCOMES.filter((o) => o !== LC_OUTCOME_UNKNOWN);
    expect(want.length, 'guards the guard: an empty want passes everything').toBe(4);
    const got = lines(h.sh('printf "%s\\n" "${_LC_OUTCOMES[@]}"'));
    expect([...got].sort()).toEqual([...want].sort());
    expect(got, 'unknown is the READER\'s degrade, never a call site\'s choice')
      .not.toContain(LC_OUTCOME_UNKNOWN);
  });
});

describe('_lc_now_ns — 19 digits, always', () => {
  it('answers 19 ASCII digits on a box whose date supports %N', () => {
    expect(h.sh('_lc_now_ns')).toMatch(/^[0-9]{19}$/);
  });

  it('still answers 19 digits when date cannot do %N — never the literal N', () => {
    // Mutant: delete the `[[ "$ns" =~ ^[0-9]{19}$ ]] ||` fallback rung -> this
    // fails with `expected '1787327575N' to match /^[0-9]{19}$/`, and the
    // generation filename would sort wrong for ever after.
    const out = h.sh('date() { case "$*" in *%N*) echo "1787327575N" ;; *) echo 1787327575 ;; esac; }; _lc_now_ns');
    expect(out).toMatch(/^[0-9]{19}$/);
    expect(out).toBe('1787327575000000000');
  });

  it('answers 19 digits even when date cannot be run at all', () => {
    expect(h.sh('date() { return 127; }; _lc_now_ns')).toMatch(/^[0-9]{19}$/);
  });
});

describe('_lc_tx — a correlation id, minted at the call site, never a global', () => {
  it('is uid-shaped and distinct across two calls in one process', () => {
    const out = h.sh('a=$(_lc_tx); b=$(_lc_tx); printf "%s\\n%s\\n" "$a" "$b"');
    const [a, b] = lines(out);
    expect(a).toMatch(/^[0-9]{19}\.[0-9]+\.[0-9]+$/);
    expect(b).toMatch(/^[0-9]{19}\.[0-9]+\.[0-9]+$/);
    expect(a).not.toBe(b);
  });
});
