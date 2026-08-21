// The act vocabulary is ONE vocabulary across bash and TypeScript.
//
// `wrapper-roster-fixture.test.ts` states the law this follows: every
// comparison is a SET equality over ccd's own answer space, "parsed or
// enumerated", never "each member got a matching answer" — the weaker form
// only ever asks ccd about acts the mirror already knows, so an act ccd grew
// on its own is invisible to it. And the answer space here is EXECUTED, not
// grepped: `declare -p` / `printf '%s\n' "${_LC_ACTS[@]}"` under
// `makeCcdHarness`, which cannot be fooled by an `echo` a regex did not
// anticipate.
//
// THIS FILE IS GREEN BEFORE WAVE 2 AND GREEN AFTER IT, AND RED IN BETWEEN.
// ccd is either wholly in the journal world (`_LC_ACTS` + `_lc_emit` + the
// `lifecycle-v1` cap) or wholly out of it; a half-shipped wave 2 is what the
// world classifier below asserts against. The classifier is a PURE function
// pinned FIRST against synthetic inputs and only then pointed at the real ccd
// — `ccd-die-containment.test.ts:1-25`'s precedent, and for its reason: at
// this tip the journal population is empty, so an assertion against the real
// file can only ever pass today.
//
// If it goes red on the SET, fix ccd — never LIFECYCLE_ACTS. L0 is where the
// vocabulary is decided; `_LC_ACTS` is where it is spoken.
//
// WAVE 2 OWES THIS FILE FIVE THINGS, IN ONE COMMIT:
//   1. `_LC_ACTS` as a TOP-LEVEL bash array, readable by `declare -p _LC_ACTS`
//      after `source ccd` — not a local, not built inside a function.
//   2. Its members exactly LIFECYCLE_ACTS minus LC_ACT_UNKNOWN (21 acts).
//   3. `_LC_OUTCOMES`, likewise, exactly LIFECYCLE_OUTCOMES minus
//      LC_OUTCOME_UNKNOWN (4). Both degrades are the reader's.
//   4. `_lc_emit()` at the top level, and it must CONSULT `_LC_ACTS` — an act
//      it cannot find there is written `act:"unknown"` with the token in
//      `badact` (D6), which is what makes the set equality hold BY
//      CONSTRUCTION rather than by discipline.
//   5. `lifecycle-v1` in `cmd_caps`, plus `lifecycle-v1` added to
//      `ccd-archive.test.ts:153`'s KNOWN_CAPABILITY_TOKENS — omitting the
//      second makes the token fall into that test's `verbs` partition and reds
//      it as a phantom verb, which is correct and by design.
// The BEHAVIOURAL half of (4) — emit a bogus act, assert the line degrades —
// belongs in wave 2's own ccd test, not here: this file owns the SET.
//
// Deviation from the task-8 brief, noted per the standing rule established in
// Tasks 4/6/7: every `it` block or loop below that makes more than one
// INDEPENDENT claim uses `expect.soft` rather than a hard `expect`, so a
// first failure does not hide the rest. The brief's draft used hard `expect`
// throughout; this file applies `expect.soft` to the mixture loop and to the
// multi-assertion vocabulary checks. Assertions that are alone in their
// branch (nothing downstream in the same block depends on them running) are
// left as plain `expect` — there is nothing for a hard failure to hide there.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import {
  LIFECYCLE_ACTS, LC_ACT_UNKNOWN, LIFECYCLE_OUTCOMES, LC_OUTCOME_UNKNOWN, LC_DIR_NAME,
} from '../../shared/api.js';

const ccdSrc = readFileSync(CCD, 'utf8');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-vocab-'); });
afterEach(() => { h.cleanup(); });

const sortedSet = (xs: readonly string[]): string[] => [...new Set(xs)].sort();

interface JournalEvidence { readonly acts: boolean; readonly cap: boolean; readonly emitter: boolean }

/** Which of the two legal worlds ccd is in, or `half` for the illegal middle.
 *  Pure, so the six mixtures can be pinned without a fixture HOME. */
const journalWorld = (e: JournalEvidence): 'present' | 'absent' | 'half' => {
  const n = [e.acts, e.cap, e.emitter].filter(Boolean).length;
  return n === 3 ? 'present' : n === 0 ? 'absent' : 'half';
};

describe('the world classifier itself — pinned before it is pointed at ccd', () => {
  it('calls all-three-present `present`', () => {
    expect(journalWorld({ acts: true, cap: true, emitter: true })).toBe('present');
  });

  it('calls all-three-absent `absent`', () => {
    expect(journalWorld({ acts: false, cap: false, emitter: false })).toBe('absent');
  });

  it('calls every mixture `half` — all six of them', () => {
    const mixtures: JournalEvidence[] = [
      { acts: true, cap: false, emitter: false },
      { acts: false, cap: true, emitter: false },
      { acts: false, cap: false, emitter: true },
      { acts: true, cap: true, emitter: false },
      { acts: true, cap: false, emitter: true },
      { acts: false, cap: true, emitter: true },
    ];
    // Independent claims — one per mixture — so a failure on mixture 1 must
    // not hide whether mixtures 2-6 also fail. expect.soft per the standing
    // rule (Tasks 4/6/7).
    for (const m of mixtures) expect.soft(journalWorld(m), JSON.stringify(m)).toBe('half');
    expect.soft(mixtures.length, 'the whole mixed space: 2^3 minus the two pure worlds').toBe(6);
  });
});

/** ccd's own answer for a top-level ARRAY, EXECUTED. Guarded by `declare -p`
 *  because ccd runs under `set -uo pipefail` (`ccd/ccd:7`) and a bare
 *  `"${arr[@]}"` on an unset array exits the shell — which would read as a
 *  harness failure rather than as "wave 2 has not landed". Returns null for
 *  "not declared". */
const ccdArray = (name: string): string[] | null => {
  const out = h.sh(
    `if declare -p ${name} >/dev/null 2>&1; then printf '%s\\n' "\${${name}[@]}"; ` +
    'else echo __ABSENT__; fi',
  );
  return out.trim() === '__ABSENT__'
    ? null
    : out.split('\n').map((l) => l.trim()).filter(Boolean);
};

const capsTokens = (): string[] =>
  h.sh('cmd_caps').split('\n').map((l) => l.trim()).filter(Boolean);

const evidence = (): JournalEvidence => ({
  acts: ccdArray('_LC_ACTS') !== null,
  cap: capsTokens().includes('lifecycle-v1'),
  emitter: /^_lc_emit\(\)/m.test(ccdSrc),
});

describe('ccd <-> shared: the journal vocabulary', () => {
  it('ccd is in ONE of the two worlds — a half-shipped wave 2 is a red suite', () => {
    const e = evidence();
    expect(journalWorld(e),
      `_LC_ACTS=${e.acts}, caps lifecycle-v1=${e.cap}, _lc_emit=${e.emitter} — ` +
      'wave 2 ships all of them in one commit or none of them',
    ).not.toBe('half');
  });

  it('the ABSENT world is genuinely absent — nothing half-writes the journal', () => {
    if (journalWorld(evidence()) !== 'absent') return;
    // Not a skip: these are the assertions that make "absent" mean absent
    // rather than "the probe found nothing". Measured at this tip: 0 hits
    // each. Two independent claims — expect.soft so one failing does not
    // hide the other.
    expect.soft(ccdSrc, 'a journal path exists but no emitter does').not.toContain(LC_DIR_NAME);
    expect.soft(ccdSrc).not.toMatch(/_lc_[a-z]/);
  });

  it("_LC_ACTS is exactly LIFECYCLE_ACTS minus the reader's degrade", () => {
    // The derivation and its guard run ABOVE the world branch, on purpose: in
    // the absent world the branch returns early, and a `want` computed after
    // the return could be mutated to `LIFECYCLE_ACTS` with nothing red. Here,
    // the length assertion measures the mutant TODAY.
    const want = LIFECYCLE_ACTS.filter((a) => a !== LC_ACT_UNKNOWN);
    // Two independent claims about `want` itself — expect.soft.
    expect.soft(want.length, 'guards the guard: an empty want passes everything').toBe(21);
    expect.soft(want, 'the filter must exclude the degrade, not merely run').not.toContain(LC_ACT_UNKNOWN);
    const acts = ccdArray('_LC_ACTS');
    if (acts === null) {
      expect(journalWorld(evidence()), 'the absent world, asserted above').toBe('absent');
      return;
    }
    // The `ccd-session-lifecycle.test.ts:150` shape — `SESSION_LIFECYCLES
    // .filter((s) => s !== 'unmeasurable')` — except the excluded member is
    // named by a constant, so this filter cannot silently become a no-op.
    // Two independent claims about ccd's actual answer — expect.soft.
    expect.soft(sortedSet(acts)).toEqual(sortedSet(want));
    expect.soft(acts, 'unknown is the READER`s degrade, never a ccd call site')
      .not.toContain(LC_ACT_UNKNOWN);
  });

  it('_LC_OUTCOMES is exactly LIFECYCLE_OUTCOMES minus the degrade', () => {
    const want = LIFECYCLE_OUTCOMES.filter((o) => o !== LC_OUTCOME_UNKNOWN);
    expect.soft(want.length, 'guards the guard: an empty want passes everything').toBe(4);
    expect.soft(want).not.toContain(LC_OUTCOME_UNKNOWN);
    const outcomes = ccdArray('_LC_OUTCOMES');
    if (outcomes === null) {
      expect(journalWorld(evidence()), 'the absent world, asserted above').toBe('absent');
      return;
    }
    expect(sortedSet(outcomes)).toEqual(sortedSet(want));
  });

  it('_LC_ACTS is READ, not merely declared to satisfy this file', () => {
    if (ccdArray('_LC_ACTS') === null) return;
    // The mutant this kills: declare the array, never consult it, and emit
    // whatever a call site passes. One occurrence is the declaration; a
    // second is the emitter validating against it.
    const uses = ccdSrc.match(/_LC_ACTS/g) ?? [];
    expect(uses.length, '_LC_ACTS is declared but never consulted').toBeGreaterThan(1);
  });

  it('the caps token and the vocabulary ship together', () => {
    const e = evidence();
    expect(capsTokens().includes('lifecycle-v1')).toBe(e.acts);
    // Backstop, and it is a real one: after wave 2,
    // `ccd-archive.test.ts:153`'s KNOWN_CAPABILITY_TOKENS is
    // ['lifecycle-v1', 'stop-surface'] and its capability-equality assertion
    // reds the moment cmd_caps stops advertising the token — so the two
    // worlds cannot both be satisfied by deleting the feature.
  });
});
