// server/test/unattended-actor.test.ts
//
// Wave 6's headline sentence: "archiveMerged's timer and a human's ws-rm stop
// being byte-identical." The `--surface` word alone cannot carry that — the
// closed set has four members and none of them means "a server sweep" — so the
// distinguisher is the ACTOR, and that is why `ActorFlags.actor` is not
// optional. This file pins that every unattended lane names itself.
//
// FIX ROUND 1 (review, 2026-08-23): the ORIGINAL scan below only catches a
// hand-written `null` — it says nothing about a VALID-BUT-WRONG label. The
// reviewer's own mutant proved the gap: swapping `archiveMerged`'s actor for
// `sweepNames`'s left 391 tests and `tsc` green, because nothing anywhere
// pinned WHICH label belongs to WHICH call site. A mislabelled lane is worse
// than an unlabelled one — an unlabelled one leaves a visible gap; a
// mislabelled one puts a confident wrong answer into the provenance record.
// Two new mechanisms close that gap, and they are deliberately not the same
// mechanism twice:
//   - `describe('each unattended label is pinned to its own call site')`
//     below is a STRUCTURAL scan, one regex per site, anchored on the code
//     AROUND the label (the verb, the other arguments) so it identifies the
//     site independently of what the label currently says, then asserts the
//     label against a hardcoded expectation — the same shape a swap-between-
//     sites mutation cannot survive, because the anchor for site A does not
//     match at site B.
//   - `describe('an interpolated label carries the RUN ID ACTUALLY IN
//     SCOPE...')` below calls `dispatchRun` for real, with a concrete run id
//     nobody chose to make the test convenient, and reads the id back out of
//     the ACTUAL argv `runCcd` received — proving the `${run.id}` in the
//     template evaluates to the id in scope at that call, not merely that
//     the source text has the right shape.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTOR_FLAGS_CAP, CCD_ARGV, sweepDec } from '../src/ccdargv.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const NEW = { ccdVerbs: [ACTOR_FLAGS_CAP] };
const FILES = ['watch.ts', 'coord/close.ts', 'coord/dispatch.ts', 'coord/routes.ts'];
const BUILDERS = /CCD_ARGV\.(wsArchive|wsRestore|wsHold|wsRelease|wsRename)\(/;

describe('sweepDec', () => {
  it('declares the agent lane and names the sweep', () => {
    expect(sweepDec(NEW, 'sweep:archive-merged'))
      .toEqual({ surface: 'agent', actor: 'sweep:archive-merged', reason: null });
  });

  it('is null on no evidence, exactly as the human lane is', () => {
    expect(sweepDec({ ccdVerbs: null }, 'sweep:names')).toBeNull();
    expect(sweepDec(undefined, 'sweep:names')).toBeNull();
    expect(sweepDec({ ccdVerbs: ['ws-rename'] }, 'sweep:names')).toBeNull();
  });

  it('builds an argv whose actor survives to the flags', () => {
    expect(CCD_ARGV.wsRename('demo-quiet-basin', 'ws/x', sweepDec(NEW, 'sweep:names')))
      .toEqual(['ws-rename', '--session', 'demo-quiet-basin', '--branch', 'ws/x',
                '--surface', 'agent', '--actor', 'sweep:names']);
  });
});

describe('every unattended ccd call site names itself', () => {
  it('leaves no hand-written `null` dec at a site that has a lane to declare', () => {
    // A source scan, and the reason is that the alternative pins nothing: a
    // sweep threaded with `null` compiles, runs, and records exactly what the
    // pre-wave build recorded — a byte-identical act with no way to tell whose
    // it was, which is the defect this wave exists to remove. The `null`s that
    // remain are the CAPABILITY answer (`sweepDec`/`pwaDec` return it), never a
    // hand-written one. The window is three lines because two of these call
    // sites already wrap (`close.ts:181-183`).
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(path.join(srcRoot, f), 'utf8').split('\n');
      src.forEach((line, i) => {
        if (!BUILDERS.test(line)) return;
        if (/,\s*null\s*\)/.test(src.slice(i, i + 3).join('\n'))) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders, `these unattended sites record nothing about who acted: ${offenders.join(', ')}`)
      .toEqual([]);
  });

  it('found EXACTLY the ten pinned call sites — not a floor, an exact count (fix round 2, F5b)', () => {
    // `toBeGreaterThanOrEqual(10)` was a floor, not a count: an eleventh
    // unattended call site — a NEW verb call this file's `SITES` array below
    // has no entry for — would satisfy `11 >= 10` silently, so a mislabelled
    // eleventh site would evade this test AND the SITES pins below (neither
    // scans for a site nobody told them to look for). `SITES.length` is the
    // single source of truth for how many are pinned; this assertion is
    // exact so the two can never drift apart without one of them going red.
    let n = 0;
    for (const f of FILES) {
      n += readFileSync(path.join(srcRoot, f), 'utf8').split('\n')
        .filter((l) => BUILDERS.test(l)).length;
    }
    expect(n, 'the scan matched no unattended ccd call site at all').toBeGreaterThan(0);
    expect(n, `the unattended call-site count drifted from SITES.length (${SITES.length}) — `
      + 'a site was added or removed; update SITES to match before trusting this guard again')
      .toBe(SITES.length);
  });
});

/**
 * Ten sites, five distinct labels, each site identified by the code AROUND
 * the label rather than by the label itself — so a mutation that swaps two
 * valid labels between two valid sites cannot hide by also moving the
 * anchor. `close.ts`'s five sites share one identical label
 * (`` `run:${id} close` `` — `id` is `closeRun`'s own parameter at every one
 * of them, so there is no textual difference between "the right label" and
 * "the same label copied from a sibling site" to catch there); what a
 * cross-FILE or cross-VERB swap into `close.ts` WOULD change is caught here
 * because every anchor also carries the surrounding call, not just the
 * label — a foreign label pasted in changes the captured text and reds
 * against the hardcoded expectation below, exactly as the reviewer's mutant
 * (a foreign label pasted into `archiveMerged`) does for `watch.ts`.
 */
interface Site { file: string; what: string; find: RegExp; label: string }
const SITES: readonly Site[] = [
  { file: 'watch.ts', what: 'sweepNames verb-probe (the pre-write `verbSupported` check)',
    find: /CCD_ARGV\.wsRename\(r\.id, born, sweepDec\(this\.deps\.fleetState, ('[^']*')\)\)\)\) continue;/,
    label: "'sweep:names'" },
  { file: 'watch.ts', what: 'sweepNames real rename (the queued `runCcd` call)',
    find: /CCD_ARGV\.wsRename\(r\.id, branch, sweepDec\(this\.deps\.fleetState, ('[^']*')\)\)\)\);/,
    label: "'sweep:names'" },
  { file: 'watch.ts', what: 'archiveMerged',
    find: /CCD_ARGV\.wsArchive\(r\.id, sweepDec\(this\.deps\.fleetState, ('[^']*')\)\);/,
    label: "'sweep:archive-merged'" },
  { file: 'coord/close.ts', what: 'abandon-arm hold (a surviving sibling claims the workspace)',
    find: /CCD_ARGV\.wsHold\(run\.sessionId,\n\s+holdReason\(survivor\.program, survivor\.wave, survivor\.waveOf, survivor\.id\),\n\s+sweepDec\(deps\.fleetState, (`[^`]*`)\)\)/,
    label: '`run:${id} close`' },
  { file: 'coord/close.ts', what: 'abandon-arm release (no survivor)',
    find: /: CCD_ARGV\.wsRelease\(run\.sessionId, sweepDec\(deps\.fleetState, (`[^`]*`)\)\);/,
    label: '`run:${id} close`' },
  { file: 'coord/close.ts', what: 'ordinary close, failed+archive branch',
    find: /const argv = CCD_ARGV\.wsArchive\(run\.sessionId, sweepDec\(deps\.fleetState, (`[^`]*`)\)\);/,
    label: '`run:${id} close`' },
  { file: 'coord/close.ts', what: 'ordinary close, final+safe release branch',
    find: /const argv = CCD_ARGV\.wsRelease\(run\.sessionId, sweepDec\(deps\.fleetState, (`[^`]*`)\)\);/,
    label: '`run:${id} close`' },
  { file: 'coord/close.ts', what: 'ordinary close, non-final/sibling-survivor hold branch',
    find: /const argv = CCD_ARGV\.wsHold\(run\.sessionId, nextReason, sweepDec\(deps\.fleetState, (`[^`]*`)\)\);/,
    label: '`run:${id} close`' },
  // Fix round 2 (final whole-branch review, F5b): the two `find`s below used
  // to be the bare `sweepDec(deps.fleetState, …)` pattern, unanchored to any
  // surrounding call — `RegExp.exec` returns the FIRST match in the whole
  // file, so a second `sweepDec(deps.fleetState, …)` call added anywhere
  // earlier in either file (a mislabelled eleventh site, say) would make this
  // pin silently start checking the WRONG call, its own textual position
  // notwithstanding. Anchored now on the surrounding `CCD_ARGV.wsHold(...)`
  // call, the same shape every `close.ts` entry above already uses — a
  // foreign call captured here changes the surrounding text and reds against
  // the hardcoded label below, exactly as a cross-site label swap would.
  { file: 'coord/dispatch.ts', what: 'dispatchRun hold, step 5',
    find: /const holdArgv = CCD_ARGV\.wsHold\(sessionId,\n\s+holdReason\(run\.program, run\.wave, run\.waveOf, run\.id\),\n\s+sweepDec\(deps\.fleetState, (`[^`]*`)\)\);/,
    label: '`run:${run.id} dispatch`' },
  { file: 'coord/routes.ts', what: 'open-then-hold, sessionId reclaim',
    find: /const argv = CCD_ARGV\.wsHold\(sessionId,\n\s+holdReason\(program, wave, waveOfVal, opened\.id\),\n\s+sweepDec\(deps\.fleetState, (`[^`]*`)\)\);/,
    label: '`run:${opened.id} open`' },
];

describe('each unattended label is pinned to its own call site', () => {
  it.each(SITES)('$file — $what declares exactly its own label', ({ file, find, label }) => {
    const src = readFileSync(path.join(srcRoot, file), 'utf8');
    const m = find.exec(src);
    expect(m, `the anchor for this site was not found in ${file} — it moved or was rewritten; `
      + 'update the anchor before trusting this guard again').not.toBeNull();
    expect(m![1], `${file} — ${find} captured the wrong text`).toBe(label);
  });
});

/**
 * The structural scan above proves the SOURCE TEXT at each site is the
 * right label. It cannot prove the label is right AT RUNTIME — a template
 * can read correctly and still close over the wrong variable if two
 * same-named-looking identifiers are in scope. This test calls `dispatchRun`
 * for real and reads the id back out of the argv `runCcd` actually received,
 * for a run id nobody hand-picked to make the label look right.
 */
describe('an interpolated label carries the RUN ID ACTUALLY IN SCOPE, not merely the right shape', () => {
  it("dispatchRun's hold argv names the concrete run id, measured at runtime", async () => {
    const home = mkTmp('ccrc-unattended-actor-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const SESSION = 'demo-unattended-actor';
    const calls: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      if ((args[0] ?? '') === 'ws-add') {
        const reg = path.join(home, '.cc-sessions');
        const fields: Record<string, string> = {
          wrapper: 'claude', project: 'demo', workdir: `/w/${SESSION}`, uuid: `u-${SESSION}`,
          started: '1', workspace: SESSION, branch: `ws/${SESSION}`, base: 'origin/main',
        };
        for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${SESSION}.${k}`), v);
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const base = testDeps(home, run);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    // Two DIFFERENT runs opened first, so the run under test does not happen
    // to land on id 1 — the one value a hardcoded-but-never-checked template
    // could produce by accident even with the wrong variable in scope. Each
    // decoy needs its OWN `program`: `openRun` is idempotent on
    // `(program, wave, waveOf, claimedBy)` while `state === 'planned'`
    // (`store.ts`'s own comment on the point), so two decoys sharing one
    // program with the run under test would collapse onto the SAME row
    // instead of consuming distinct ids — measured: the first attempt at
    // this fixture did exactly that (`opened.id` came back `1`).
    for (const program of ['build9a-decoy-a', 'build9a-decoy-b']) {
      const decoy = coord.openRun({ program, title: 'decoy', project: 'demo',
        wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-coordinator' });
      if (!('id' in decoy)) throw new Error('fixture openRun (decoy) refused');
    }
    const opened = coord.openRun({ program: 'build9a-under-test', title: 'Unattended actor under test',
      project: 'demo', wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-coordinator' });
    if (!('id' in opened)) throw new Error('fixture openRun refused');
    expect(opened.id).toBeGreaterThan(1);   // the decoys actually consumed ids

    const deps: DispatchRunDeps = {
      coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
      // `ws-hold` itself, alongside the capability token: `verbSupported`
      // gates the hold call on the VERB being advertised, independently of
      // `sweepDec`'s own `capSupported` gate on the FLAG-parsing token —
      // omitting the verb here answers `{ok:false, kind:'unsupported'}`
      // before the argv this test reads is ever built (measured).
      fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-hold', ACTOR_FLAGS_CAP],
                    rosterFp: null, build: null },
      tmux: base.tmux, queue: base.queue,
    };
    const outcome = await dispatchRun(deps, opened.id, 'do the thing', undefined);
    expect(outcome.ok, `fixture must actually reach the hold step: ${JSON.stringify(outcome)}`).toBe(true);

    const holdCall = calls.find((c) => c[0] === 'ws-hold');
    expect(holdCall, 'ws-hold must have run').toBeDefined();
    const actorIdx = holdCall!.indexOf('--actor');
    expect(actorIdx, '--actor must be present in the hold argv').toBeGreaterThan(-1);
    // Measured, not merely shaped: the concrete `opened.id` this run was
    // actually assigned, not a stand-in for "some number".
    expect(holdCall![actorIdx + 1]).toBe(`run:${opened.id} dispatch`);
  });
});
