// server/test/ccd-wsaudit-nonpoison.test.ts
//
// `wsaudit.test.ts` computes the refusal-token set by grepping THIS FILE'S TEXT
// with four regexes, comments included, and holds it set-equal to `SENTENCES`.
// The lifecycle emitter is a new writer of refusal-shaped JSON, so it is exactly
// the shape that could poison that scan — which is why the journal field is
// spelled `refusal`, never `refused`.
//
// FIX ROUND 2 (task 15) — CITATION CORRECTED. This originally cited
// ccd:3024-3030 and ccd:7530-7535 as recording this class having shipped
// once already; neither range is about a poisoned refusal-token scan (one
// is `_pr_py`'s PR-check JSON output, the other is `_ws_reap_locked`'s audit
// row builder) and the citation was wrong. The actual precedent is
// `wsaudit.test.ts:12-15`'s own docstring: a token renamed in `ccd`
// (`branch-drift` -> `registry-branch-drift`) failed no test and the UI
// silently fell back to `ccrc declined: <token>.` until a human read the
// sheet by hand — the class this whole linkage exists to catch, and the
// reason THIS file exists as its own guard: a new writer of refusal-shaped
// JSON is exactly the shape that class recurs in.
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts:1045`'s
// `/^ccd.*\.ts$/` containment scan. It reads ccd's TEXT and runs nothing, so it
// is compliant with no stub of its own.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';

const src = withoutReclaim(readFileSync(CCD, 'utf8'));

const scan = (text: string): string[] => {
  const t = new Set<string>();
  for (const m of text.matchAll(/_reap_refuse\s+([a-zA-Z][a-zA-Z0-9_-]*)\b/g)) t.add(m[1]!);
  for (const m of text.matchAll(/"refused":"([a-zA-Z0-9-]+)"/g)) t.add(m[1]!);
  for (const m of text.matchAll(/'!([a-zA-Z0-9-]+)/g)) t.add(m[1]!);
  for (const m of text.matchAll(/"verdict":"([a-zA-Z0-9-]+)"/g)) { if (m[1] !== 'reapable') t.add(m[1]!); }
  return [...t].sort();
};

describe('the lifecycle block cannot poison wsaudit.test.ts\'s scan', () => {
  const from = src.indexOf('# ── lifecycle journal ');
  const to = src.indexOf('# ── end lifecycle journal ');

  it('found the block — an empty slice would pass every assertion below vacuously', () => {
    expect(from, 'LC-BEGIN marker not found in ccd').toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(src.slice(from, to).length).toBeGreaterThan(2000);
  });

  it('carries none of the four harvested shapes, in code OR in a comment', () => {
    // Mutant: spell the journal field `"refused":"` instead of `"refusal"` ->
    // this fails, AND wsaudit.test.ts's reverse direction fails with a token
    // SENTENCES has no copy for.
    //
    // Independent claims — one per shape — so a failure on one must not hide
    // whether the other three also fail. expect.soft per STANDING RULE #1,
    // softened from the brief's literal hard `expect` inside this loop.
    const slice = src.slice(from, to);
    for (const shape of [/_reap_refuse\s/, /"refused":"/, /"verdict":"/, /'!/]) {
      expect.soft(slice, `the lifecycle emitter is written in a harvested shape: ${shape}`).not.toMatch(shape);
    }
  });

  it('leaves the token set OUTSIDE the reclaim region at exactly the 55 that shipped before build 9', () => {
    // Three independent claims about the same scan — STANDING RULE #1 —
    // softened from the brief's literal hard `expect`s so a first failure
    // does not hide the rest.
    //
    // RE-BASELINED 54 -> 55 at the Synapsium transplant, and re-DERIVED rather
    // than nudged until green: Stage 5 added one token to `ccd/ccd` while this
    // branch was out of tree, so the "before build 9" baseline moved for
    // main's reason, not this build's. Measured at the transplant with the
    // scan above run over both `origin/main:ccd/ccd` and `HEAD:ccd/ccd` —
    // 55 and 55, with the set difference EMPTY IN BOTH DIRECTIONS. So the
    // claim this `it` actually makes (build 9 harvests no new token) is
    // unchanged and still true; only the constant it is measured against
    // moved. A number changed to make a suite green without that measurement
    // would have hidden exactly the defect this file exists to catch.
    expect.soft(scan(src)).toHaveLength(55);
    expect.soft(scan(src)).toContain('in-progress');
    expect.soft(scan(src)).not.toContain('refusal');
    // THE RECLAIM REGION IS HELD APART, NOT HIDDEN (child reclamation wave 3,
    // Task 2 — the reclaim ladder, spec 2026-09-22 §5.5). `src` above is the
    // file with its `RECLAIM-BEGIN`…`RECLAIM-END` region cut out, because the
    // pin line above is quoted BYTE FOR BYTE, at its line, by the frozen
    // compaction-card corpus (`session-hook.test.ts`'s citation audit), so its
    // number cannot move while that corpus stands. The region's words are
    // counted here instead, measured the same way as the 54 -> 55 re-baseline:
    // the scan over the task's base `ccd/ccd` answers 55 and over its tree 60,
    // and the set difference is exactly the five ladder words that task gave
    // `SENTENCES` copy for (ENTERED below; LEFT none). A later word, in or out
    // of the region, reds one of these three assertions or the pin above.
    // 60 -> 62 (Task 4, the verb): `reap-in-progress` (ws-reclaim's refusal of
    // a ws-reap breadcrumb) and `reclaim-in-progress` (ws-reap's refusal of a
    // `reclaim:` one), both given `SENTENCES` copy. The second is ws-reap's own
    // word, so its literal is in neither place: not among ws-reap's lines
    // (the pin above would move) and not in the RECLAIM region (whose words
    // are ws-reclaim's fourteen alone). It stands in its own `MIRROR-BEGIN`…
    // `MIRROR-END` block below the region (`_ws_reclaim_mirror`, called from
    // `_ws_reap_locked` in one line), which `src` cuts out exactly as it cuts
    // the region — so the pin above stays 55 and byte-identical. Measured the
    // same way: base 60 -> tree 62, ENTERED those two, LEFT none; the scan
    // outside both blocks answers 55 at both.
    const full = readFileSync(CCD, 'utf8');
    expect.soft(scan(full)).toHaveLength(62);
    expect.soft(scan(full).filter((t) => !scan(src).includes(t)))
      .toEqual(['attached', 'containment-unproven', 'not-a-child', 'paused', 'reap-in-progress', 'reclaim-in-progress',
        'tree-busy']);
    expect.soft(reclaimRegion(full).length, 'the region was found — an empty cut proves nothing').toBeGreaterThan(5000);
    expect.soft(markedBlock(full, 'MIRROR-BEGIN', 'MIRROR-END'), 'the mirror block was found, and holds its one word')
      .toContain('"refused":"reclaim-in-progress"');
  });
});

/** The `RECLAIM-BEGIN`…`RECLAIM-END` region of `ccd/ccd`, whole lines, or ''
 *  when the markers are absent. */
function reclaimRegion(text: string): string {
  return markedBlock(text, 'RECLAIM-BEGIN', 'RECLAIM-END');
}

/** The whole lines from the one holding `begin` to the one holding `end`, or
 *  '' when either marker is absent. */
function markedBlock(text: string, begin: string, end: string): string {
  const b = text.indexOf(begin);
  const e = text.indexOf(end);
  if (b < 0 || e < b) return '';
  const from = text.lastIndexOf('\n', b) + 1;
  const nl = text.indexOf('\n', e);
  return text.slice(from, nl < 0 ? text.length : nl + 1);
}

/** `text` with that region — and ws-reap's mirror block below it, which holds
 *  ws-reap's refusal of a reclaim breadcrumb (child reclamation wave 3, Task 4)
 *  — cut out. A function DECLARATION, so it is hoisted and `src` can use it on
 *  its own line without moving the lines the corpus cites. */
function withoutReclaim(text: string): string {
  let out = text;
  for (const block of [reclaimRegion(text), markedBlock(text, 'MIRROR-BEGIN', 'MIRROR-END')]) {
    if (block !== '') out = out.replace(block, '');
  }
  return out;
}
