// D1's one rule, as a red suite. `$REG/swap.log` is the precedent AND the
// counter-example: 141,762 B over 49 days with zero corruption from 13
// concurrent `printf >>` sites, and ~30% of its lines untimestamped because
// ccd:7568 and ccd:9423 redirect a CHILD'S stdout+stderr into it from inside a
// double-quoted `bash -c` string. That second shape is what this forbids.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';
import { LIFECYCLE_MEAS_KEYS } from '../../shared/api.js';

const src = readFileSync(CCD, 'utf8');
const BEGIN = '# ── lifecycle journal ';
const END = '# ── end lifecycle journal ';

/** Code lines only. The rule is "nothing outside the block WRITES", not
 *  "nothing outside the block MENTIONS": ccd:1536's dot-artifact inventory
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
  // (`awk '/export interface LifecycleMeas/,/^}/' shared/api.ts`); ccd emits
  // TWENTY-TWO distinct `meas.<key>` names (`grep -oE "meas\.[a-zA-Z]+"
  // ccd/ccd | sort -u`); the union is TWENTY-THREE, not the brief's
  // twenty-five. `manifestBytes` and `atticsrc` — named in an earlier draft —
  // are emitted NOWHERE in `ccd/ccd`; see the second test below.
  const all = new Set<string>(LIFECYCLE_MEAS_KEYS);

  it('every meas.<key> ccd writes is on the list, and the list is exactly 23', () => {
    // Mutant: emit `meas.slug` at any call site -> this fails with
    // `an unlisted meas key: [ 'slug' ]`, and wave 4 drops it at ingest with
    // nothing saying so.
    expect.soft(all.size, 'LIFECYCLE_MEAS_KEYS drifted from the measured 23').toBe(23);
    const used = new Set([...src.matchAll(/\bmeas\.([A-Za-z][A-Za-z0-9]*)\b/g)].map((m) => m[1]!));
    expect.soft(used.size, 'no meas key found at all — the scan is vacuous').toBeGreaterThan(10);
    expect.soft([...used].filter((k) => !all.has(k)).sort(), 'an unlisted meas key').toEqual([]);
  });

  it('never invents an emit for manifestBytes or atticsrc — they are not on the wire', () => {
    // A prior draft of this vocabulary named these two, but neither is
    // emitted anywhere in the shipped `ccd/ccd`. Re-adding them to the list
    // "on the brief's say-so" would widen `LifecycleMeas` with dead members;
    // this pins that ccd itself still agrees they are unused.
    const used = new Set([...src.matchAll(/\bmeas\.([A-Za-z][A-Za-z0-9]*)\b/g)].map((m) => m[1]!));
    expect.soft(used.has('manifestBytes')).toBe(false);
    expect.soft(used.has('atticsrc')).toBe(false);
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
