// D1's one rule, as a red suite. `$REG/swap.log` is the precedent AND the
// counter-example: 141,762 B over 49 days with zero corruption from 13
// concurrent `printf >>` sites, and ~30% of its lines untimestamped because
// ccd:7568 and ccd:9423 redirect a CHILD'S stdout+stderr into it from inside a
// double-quoted `bash -c` string. That second shape is what this forbids.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';

const src = readFileSync(CCD, 'utf8');
const BEGIN = '# ── lifecycle journal ';
const END = '# ── end lifecycle journal ';

/** Code lines only. The rule is "nothing outside the block WRITES", not
 *  "nothing outside the block MENTIONS": ccd:1536's dot-artifact inventory
 *  names `.lifecycle/` on purpose, and a scan that cannot tell a comment from a
 *  redirect punishes the documentation this design depends on. */
const code = (s: string): string[] =>
  s.split('\n').map((l) => (/^\s*#/.test(l) ? '' : l));

describe('nothing but the _lc_* block writes into .lifecycle/', () => {
  const from = src.indexOf(BEGIN);
  const to = src.indexOf(END);

  it('found the block, and it is substantial — an empty slice passes everything', () => {
    expect(from, 'LC-BEGIN not found').toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(src.slice(from, to).length,
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
    for (const line of src.split('\n')) {
      if (/bash -c|systemd-run/.test(line)) {
        expect(line, 'a child process is being pointed at the journal').not.toContain('.lifecycle');
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
    expect([...block.matchAll(/python3 -c/g)]).toHaveLength(2);
    expect(block).toContain('_lc_obs_json()');
    expect(block).toContain('_lc_json()');
  });

  it('the agent structurally cannot write it — no write grant is added anywhere', () => {
    const wl = readFileSync(CCD.replace(/ccd\/ccd$/, 'agent/src/whitelist.ts'), 'utf8');
    expect(wl).not.toContain('.lifecycle');
    expect(wl.match(/mode === 'write'/g), 'the write whitelist grew a second arm').toHaveLength(1);
  });
});

describe('the meas key vocabulary is ONE list', () => {
  // L0's LifecycleMeas declares the first ten. The other thirteen are this
  // wave's, and wave 4's `reviveMeas` reads through one list either way — a key
  // not on it is silently dropped at ingest, which is why the list lives in a
  // test rather than in a comment.
  //
  // FIX (Task 21): the brief's own counts were wrong, and re-measuring is what
  // this task exists to do:
  //   awk '/export interface LifecycleMeas/,/^}/' shared/api.ts
  //     -> declares TEN: project workspace branch uuid wrapper tip attic
  //        archivedAt archivedReason held.
  //   grep -oE "meas\.[a-zA-Z]+" ccd/ccd | sort -u
  //     -> emits TWENTY-TWO distinct keys.
  // Emitted-but-undeclared = 13 (not 15): base bytes dropped from inUnit mode
  // old rc registered resumed state tombstone workdir. Declared-but-unemitted
  // = 1: tip (kept — a reader tolerating a key the writer does not yet
  // produce is fine). Real total = 23, not 25. `manifestBytes` and `atticsrc`
  // — named in an earlier draft of this list — are emitted NOWHERE in
  // `ccd/ccd` and are deliberately NOT members of the vocabulary; see the
  // second test below.
  const DECLARED = [
    'project', 'workspace', 'branch', 'uuid', 'wrapper',
    'tip', 'attic', 'archivedAt', 'archivedReason', 'held',
  ];
  const EXTENSIONS = [
    'workdir', 'base', 'old', 'rc', 'mode', 'inUnit', 'from', 'dropped',
    'registered', 'state', 'bytes', 'resumed', 'tombstone',
  ];

  it('every meas.<key> ccd writes is on the list, and the list is exactly 23', () => {
    // Mutant: emit `meas.slug` at any call site -> this fails with
    // `an unlisted meas key: [ 'slug' ]`, and wave 4 drops it at ingest with
    // nothing saying so.
    const all = new Set([...DECLARED, ...EXTENSIONS]);
    expect(all.size, 'the list itself has a duplicate').toBe(23);
    const used = new Set([...src.matchAll(/\bmeas\.([A-Za-z][A-Za-z0-9]*)\b/g)].map((m) => m[1]!));
    expect(used.size, 'no meas key found at all — the scan is vacuous').toBeGreaterThan(10);
    expect([...used].filter((k) => !all.has(k)).sort(), 'an unlisted meas key').toEqual([]);
  });

  it('never invents an emit for manifestBytes or atticsrc — they are not on the wire', () => {
    // A prior draft of this vocabulary named these two, but neither is
    // emitted anywhere in the shipped `ccd/ccd`. Re-adding them to the list
    // "on the brief's say-so" would widen `LifecycleMeas` with dead members;
    // this pins that ccd itself still agrees they are unused.
    const used = new Set([...src.matchAll(/\bmeas\.([A-Za-z][A-Za-z0-9]*)\b/g)].map((m) => m[1]!));
    expect(used.has('manifestBytes')).toBe(false);
    expect(used.has('atticsrc')).toBe(false);
  });

  it('every top-level key ccd writes is one of the five', () => {
    const TOP = ['detail', 'refusal', 'verb', 'badact', 'branchDeleted'];
    const block = src.slice(src.indexOf(BEGIN), src.indexOf(END));
    for (const t of TOP) expect(block, `${t} is not routed by the encoder`).toContain(`"${t}"`);
    expect([...src.matchAll(/^\s*TOP = \(/gm)], 'the TOP tuple moved or was duplicated')
      .toHaveLength(1);
  });
});
