// D1's one rule, as a red suite. `$REG/swap.log` is the precedent AND the
// counter-example: 141,762 B over 49 days with zero corruption from 13
// concurrent `printf >>` sites, and ~30% of its lines untimestamped because
// ccd:9060 and ccd:10956 redirect a CHILD'S stdout+stderr into it from inside a
// double-quoted `bash -c` string. That second shape is what this forbids.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';
import { LIFECYCLE_MEAS_KEYS, LIFECYCLE_DEC_KEYS } from '../../shared/api.js';

const src = readFileSync(CCD, 'utf8');
const BEGIN = '# ── lifecycle journal ';
const END = '# ── end lifecycle journal ';

/** Code lines only. The rule is "nothing outside the block WRITES", not
 *  "nothing outside the block MENTIONS": ccd:2348's dot-artifact inventory
 *  names `.lifecycle/` on purpose, and a scan that cannot tell a comment from a
 *  redirect punishes the documentation this design depends on. */
const code = (s: string): string[] =>
  s.split('\n').map((l) => (/^\s*#/.test(l) ? '' : l));

/** How many times `needle` occurs in `haystack`, non-overlapping. Used to
 *  prove each marker is unique BEFORE trusting `indexOf`'s result — see the
 *  first test below. */
const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe('nothing but the _lc_* block writes into .lifecycle/', () => {
  const from = src.indexOf(BEGIN);
  const to = src.indexOf(END);

  it('each marker appears EXACTLY ONCE — indexOf silently keeps only the first of a duplicate', () => {
    // FIX ROUND 1 (CRITICAL, task 21 review): `indexOf` returns the FIRST
    // occurrence and nothing asserted uniqueness. The reviewer planted a
    // spurious duplicate `LC-BEGIN` line two lines above the real one
    // (ccd:780), with a genuine `echo x >> "$REG/.lifecycle/probe-tight"` in
    // the gap between the two — and the suite reported 10/10 green: `from`
    // silently moved to the SPURIOUS marker, so the planted write landed
    // INSIDE the (wrongly widened) "protected" slice and every downstream
    // assertion passed on a live D1 violation. A missing marker was already
    // caught by `toBeGreaterThan(-1)` below; a DUPLICATED one was not — same
    // class of defect as the brief's own vacuous-scan bug, arriving by a
    // different route.
    const beginCount = occurrences(src, BEGIN);
    const endCount = occurrences(src, END);
    expect.soft(beginCount,
      `LC-BEGIN ("${BEGIN}") appears ${beginCount} times, not once — a duplicate silently moves the block boundary`)
      .toBe(1);
    expect.soft(endCount,
      `LC-END ("${END}") appears ${endCount} times, not once — a duplicate silently moves the block boundary`)
      .toBe(1);
  });

  it('found the block, and it is substantial — an empty slice passes everything', () => {
    expect.soft(from, 'LC-BEGIN not found').toBeGreaterThan(-1);
    expect.soft(to, 'LC-END not found, or not after LC-BEGIN').toBeGreaterThan(from);
    expect.soft(src.slice(from, to).length,
      'the block collapsed — every assertion below would be vacuous').toBeGreaterThan(4000);
  });

  it('CATCHES a write planted outside the block — the positive control', () => {
    // The scan is weakened to code lines, so it must be shown to still bite.
    // Synthetic source first, ccd second: `ccd-die-containment.test.ts`'s rule.
    const planted = `${src.slice(0, from)}\n  echo x >> "$REG/.lifecycle/probe"\n${src.slice(from)}`;
    const outside = code(planted.slice(0, planted.indexOf(BEGIN)))
      .filter((l) => l.includes('.lifecycle'));
    expect(outside, 'the scanner cannot see a planted write — it is vacuous').toHaveLength(1);
  });

  it('names .lifecycle in no CODE line outside the block', () => {
    // Mutant: add `echo x >> "$REG/.lifecycle/journal-1.ndjson"` to cmd_ws_rm ->
    // this fails naming ccd's line number, and the journal grows a second
    // writer with no cap, no rotation and no uid.
    const before = code(src.slice(0, from));
    const after = code(src.slice(to));
    const hits = [...before, ...after]
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => l.includes('.lifecycle'));
    expect(hits.map(([n, l]) => `${n}: ${l.trim()}`),
      'a .lifecycle WRITE lives outside the _lc_* block').toEqual([]);
  });

  it('never names .lifecycle inside a bash -c or systemd-run string', () => {
    // The swap.log defect exactly: a child's stdout redirected into the log
    // from inside a quoted string produces unstructured, untimestamped lines
    // that no parser can model and no cap can bound.
    //
    // FIX ROUND 1 (IMPORTANT, task 21 review): a hard `expect` per loop
    // iteration only ever reports the FIRST violating line — demonstrated
    // with two simultaneous plants, where the second was silently absent
    // from the failure output. `expect.soft` reports every line in one run.
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (/bash -c|systemd-run/.test(line)) {
        expect.soft(line, `line ${i + 1}: a child process is being pointed at the journal`)
          .not.toContain('.lifecycle');
      }
    }
  });

  it('routes every journal write through exactly one printf, inside _lc_emit', () => {
    // FIX (Task 21): the brief's own regex anchored `printf` at line-start
    // (`^\s*printf`), but `_lc_emit`'s real append site (ccd:1455) wraps the
    // redirect in a `{ …; } 2>/dev/null` compound — FIX ROUND 3 (task 15)'s
    // own comment explains why: a bare `>> "$live"` leaks bash's own
    // redirect-setup diagnostic to the caller's stderr when `$live` exists
    // but is unwritable. Anchoring on `printf` alone (not on line-start)
    // still finds exactly the one real append site and nothing else in the
    // block — verified by running this suite, not by inspection.
    const block = src.slice(from, to);
    const appends = block.split('\n').filter((l) => /printf .*>>\s*"\$live"/.test(l));
    expect(appends, 'there must be exactly one append site in the whole file').toHaveLength(1);
  });

  it('forks python3 exactly twice in the block — the event encoder and the obs encoder', () => {
    // Mutant: add a third `python3 -c` -> this fails with `expected 3 to be 2`.
    // `_json_str`'s contract is "non-zero means python3 could not be RUN", and
    // ccd:711-713 records what a third, unchecked encoder costs: `"reason":,`
    // inside a printf argument list that swallowed the status.
    const block = src.slice(from, to);
    expect.soft([...block.matchAll(/python3 -c/g)]).toHaveLength(2);
    expect.soft(block).toContain('_lc_obs_json()');
    expect.soft(block).toContain('_lc_json()');
  });

  it('the agent structurally cannot write it — no write grant is added anywhere', () => {
    const wl = readFileSync(CCD.replace(/ccd\/ccd$/, 'agent/src/whitelist.ts'), 'utf8');
    expect.soft(wl).not.toContain('.lifecycle');
    expect.soft(wl.match(/mode === 'write'/g), 'the write whitelist grew a second arm').toHaveLength(1);
  });
});

describe('the meas key vocabulary is ONE list', () => {
  // L0's `LifecycleMeas` interface is the single source. `LIFECYCLE_MEAS_KEYS`
  // (`shared/api.ts`) is DERIVED from it via `Object.keys(LIFECYCLE_MEAS_KEY_MAP)`
  // — the same idiom `LIFECYCLE_ACTS` already uses for acts — so this test
  // IMPORTS the declared side rather than hand-listing it.
  //
  // FIX ROUND 1 (IMPORTANT, task 21 review): the first draft of this file
  // hand-listed `DECLARED`/`EXTENSIONS` here, a THIRD copy of the same 23
  // names next to the interface and next to `lifecycle-wire.test.ts`'s
  // literals — exactly the class of defect `single-definition.test.ts` exists
  // to catch, just outside the four roots it scans. Importing
  // `LIFECYCLE_MEAS_KEYS` makes a future interface rename (which `tsc` already
  // forces into `lifecycle-wire.test.ts`) reach this file automatically
  // instead of drifting silently.
  //
  // Re-measured, not trusted from the brief: L0 declared TEN
  // (`awk '/export interface LifecycleMeas/,/^}/' shared/api.ts`); at wave 2
  // HEAD ccd emitted TWENTY-TWO distinct `meas.<key>` names (`grep -oE
  // "meas\.[a-zA-Z]+" ccd/ccd | sort -u`); the union was TWENTY-THREE, not
  // the brief's twenty-five — `manifestBytes` and `atticsrc`, named in an
  // earlier draft, were emitted NOWHERE in `ccd/ccd` at that HEAD, so wave 2
  // pinned their absence (see the second test below, then).
  //
  // FIX ROUND 1 (Task 24 fix round 1): wave 3 supplied the missing evidence.
  // `cmd_ws_rm`'s attic pin now emits `meas.atticsrc` (`ccd:2983`) and
  // `cmd_ws_restore`'s R4-2 supersede now emits `meas.manifestBytes`
  // (`ccd:4493`) — re-measuring the same scan at this HEAD finds TWENTY-FOUR
  // distinct names, and the union with L0's now-twelve is the brief's
  // TWENTY-FIVE.
  //
  // FIX ROUND 1 (account pools wave 2b, Task 6 fix round 1): Task 6 landed
  // `cmd_prefer` and, earlier in the same wave, the tick's re-seed — both
  // `rehome` emitters (grep `ccd/ccd` for `_lc_done rehome`) — writing
  // `meas.home` and `meas.reason` (both writers) plus `meas.pool` (the
  // tick's re-seed only), three keys with no member on `LifecycleMeas` at
  // the time. THIS SCAN is what would have caught it, and nobody ran it:
  // `ccd-lifecycle-contain.test.ts` is not in the seven-suite blast radius a
  // pool/swap change runs, so it never executed between either emit landing
  // and the coordinator's review that found the gap — the scan did not pass
  // vacuously, it simply was never run against the widened emission
  // (confirmed: with the interface fix reverted, this exact case reds
  // immediately with `['home','pool','reason']`). The fix is a suite-list
  // gap, not a guard weakness — any change to what `ccd` EMITS must also run
  // this suite (and, since fix round 1, its dec twin below).
  // `shared/api.ts`'s own `LifecycleMeas` docstring has the full account.
  // Re-measuring the scan at THIS HEAD
  // (`grep -oE "meas\.[a-zA-Z]+" ccd/ccd | sort -u | wc -l`) finds
  // TWENTY-EIGHT distinct names — every one of them now a declared member,
  // with no undeclared residue (unlike wave 2's TWENTY-TWO-against-TEN gap
  // above): this fix round closes both new keys AND the interface at once,
  // so the "24 emitted, 25 declared" style split the wave-3 paragraph above
  // records does not currently exist to re-state.
  const all = new Set<string>(LIFECYCLE_MEAS_KEYS);

  it('every meas.<key> ccd writes is on the list, and the list is exactly 28', () => {
    // Mutant: emit `meas.slug` at any call site -> this fails with
    // `an unlisted meas key: [ 'slug' ]`, and wave 4 drops it at ingest with
    // nothing saying so — the identical failure mode `home`/`pool`/`reason`
    // themselves shipped with, silently, until this assertion's own `all`
    // was widened to see them (see the fix-round note above).
    expect.soft(all.size, 'LIFECYCLE_MEAS_KEYS drifted from the measured 28').toBe(28);
    const used = new Set([...src.matchAll(/\bmeas\.([A-Za-z][A-Za-z0-9]*)\b/g)].map((m) => m[1]!));
    expect.soft(used.size, 'no meas key found at all — the scan is vacuous').toBeGreaterThan(10);
    expect.soft([...used].filter((k) => !all.has(k)).sort(), 'an unlisted meas key').toEqual([]);
  });

  it('now invents no emit for anything OTHER than manifestBytes or atticsrc — the wire evidence for those two, not a blanket widening', () => {
    // FIX ROUND 1 (Task 24 fix round 1): this test PINNED THE ABSENCE of
    // `manifestBytes`/`atticsrc` through wave 2 and all of wave 3's first
    // pass — a guard specifically against re-adding either "on the brief's
    // say-so" with no wire evidence. Wave 3's fix round supplied that
    // evidence (`ccd:2983`, `ccd:4493`), so the two are now real members of
    // `LifecycleMeas` (see above) and this guard is INVERTED, not deleted:
    // deleting it would let a future edit quietly remove either emitter with
    // nothing noticing, which is exactly the drift class this whole describe
    // block exists to catch. It now holds the line from the other side —
    // both keys MUST still be on the wire — while continuing to prove the
    // scan itself is not vacuous for any other speculative key nobody has
    // proposed yet.
    const used = new Set([...src.matchAll(/\bmeas\.([A-Za-z][A-Za-z0-9]*)\b/g)].map((m) => m[1]!));
    expect.soft(used.has('manifestBytes'), 'ws-restore stopped emitting meas.manifestBytes').toBe(true);
    expect.soft(used.has('atticsrc'), 'ws-rm stopped emitting meas.atticsrc').toBe(true);
  });

  it('every top-level key ccd writes is one of the five', () => {
    // FIX ROUND 1 (IMPORTANT, task 21 review): a hard `expect` per TOP entry
    // only ever reports the first missing key. `expect.soft` reports all of
    // them in one run.
    const TOP = ['detail', 'refusal', 'verb', 'badact', 'branchDeleted'];
    const block = src.slice(src.indexOf(BEGIN), src.indexOf(END));
    for (const t of TOP) expect.soft(block, `${t} is not routed by the encoder`).toContain(`"${t}"`);
    expect.soft([...src.matchAll(/^\s*TOP = \(/gm)], 'the TOP tuple moved or was duplicated')
      .toHaveLength(1);
  });
});

describe('the dec key vocabulary is ONE list', () => {
  // Mirrors the meas describe above, one string down: `LifecycleDec` is L0's
  // single source, `LIFECYCLE_DEC_KEYS` is DERIVED from it via
  // `Object.keys(LIFECYCLE_DEC_KEY_MAP)` exactly the way `LIFECYCLE_MEAS_KEYS`
  // is — the same idiom, applied to `dec` for the first time.
  //
  // THIS GUARD DID NOT EXIST BEFORE ACCOUNT POOLS WAVE 2B (Task 6 fix round
  // 1), and its absence is exactly why `dec.crosspool` shipped GREEN two
  // tasks in a row: Task 5's `cmd_swap` and Task 6's `cmd_prefer` — the
  // key's only two emitters (D-1895; `cmd_start`'s own Task 6 work is
  // `_crosspool_mark`'s registry-marker call, never this journal key, so it
  // is not a third) — with no `LifecycleDec` member, no
  // `LIFECYCLE_DEC_KEY_MAP` entry, and nothing anywhere scanning for one:
  // `ccd-lifecycle-contain.
  // test.ts` had the meas-key scan above but no dec-key equivalent, so a
  // `dec.` word with no interface member was invisible to every suite in
  // this project's seven-suite blast radius. The coordinator's review is
  // what found the gap; this describe closes it so the same class of defect
  // — a wire vocabulary widened in `ccd/ccd` with no L0 member and no scan
  // to notice — cannot recur silently the next time a `dec.` word is added.
  //
  // Measured (`grep -oE '\bdec\.[A-Za-z][A-Za-z0-9]*\b' ccd/ccd | sed
  // 's/^dec\.//' | sort -u`): FIVE distinct tokens, one of them a false
  // positive the scan below excludes by name — see its own comment.
  const all = new Set<string>(LIFECYCLE_DEC_KEYS);

  it('every dec.<key> ccd writes is on the list, and the list is exactly 4', () => {
    // Mutant: emit `dec.newthing` at any call site -> this fails with
    // `an unlisted dec key: [ 'newthing' ]` — the identical failure mode
    // `dec.crosspool` itself shipped with, silently, until this test existed.
    expect.soft(all.size, 'LIFECYCLE_DEC_KEYS drifted from the measured 4').toBe(4);
    const used = new Set([...src.matchAll(/\bdec\.([A-Za-z][A-Za-z0-9]*)\b/g)].map((m) => m[1]!));
    // `dec.setdefault("surface", "none")` (grep `ccd/ccd` for it, inside the
    // journal encoder's python3 block) is Python's `dict.setdefault` —
    // backfilling an undeclared `surface` before the line is written — not a
    // `dec.<key>` journal key at all. `meas` has no equivalent collision
    // (nothing anywhere calls `meas.<word>(...)`), which is why the meas
    // scan above needs no such exclusion. Named explicitly, by the one
    // literal token that causes it, rather than a general "ignore anything
    // followed by `(`" heuristic that could just as easily hide a real
    // `dec.badkey(...)` typo from this very scan.
    used.delete('setdefault');
    expect.soft(used.size, 'no dec key found at all — the scan is vacuous').toBeGreaterThan(0);
    expect.soft([...used].filter((k) => !all.has(k)).sort(), 'an unlisted dec key').toEqual([]);
  });
});
