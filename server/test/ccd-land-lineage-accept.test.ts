// Landing order wave 4, Task 2, end to end: the SHIPPED radar (`ccd/ccd-land-probe`, wave 3b) writes the `enabled` marker
// and a `<id>.lineage` file for a registry row, and the SERVER's fingerprint (`verifyDone`) reads them and accepts a
// claim that the live branch reaches by clean merges of the base alone. Every file here is the probe's own output on a
// fixture HOME: the format the server reads is the one the radar writes, not one this test spelled by hand.
//
// The probe is spawned from the fixture (`ccdLandProbeFixture.ts`), which spells `ghContainedEnv(..., {systemd, tmux,
// net})` at each call site; the harness's poison `gh` stays on PATH and its record must be empty after each case. The
// server half is `verifyDone` with deps built the way `coord-fingerprint.test.ts` builds them (the few helper lines are
// COPIED from there, annex R6, not moved): the fixture HOME's registry, `projects/` as the projects root, a stubbed
// `pr-state`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghPoisonAt, type CcdHarness } from './ccdWsHelpers.js';
import { makeLandFixture, type LandFixture } from './ccdLandProbeFixture.js';
import { verifyDone, type DoneClaim } from '../src/coord/fingerprint.js';
import { parseLineage, type LineageRead } from '../src/coord/lineage.js';
import type { Runner } from '../src/exec.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { assembleFleet } from '../src/fleet.js';
import { liveStateReaderOver } from '../src/livestate.js';
import { readRegistry } from '../src/registry.js';
import { testDeps, withFakeClock } from './helpers.js';

let h: CcdHarness;
let fx: LandFixture;
beforeEach(() => { h = makeCcdHarness('land-lineage'); fx = makeLandFixture(h); });
afterEach(() => {
  const poison = ghPoisonAt(h.home);
  h.cleanup();
  expect(poison, 'the real gh was reached').toEqual([]);
});

const ID = 'lane-a-proj-a-alpha';
const OTHER_ID = 'lane-a-proj-a-other';
const BRANCH = 'ws/alpha';
const PROJECT = 'proj-a';
const RUN = { sessionId: ID, project: PROJECT, branch: BRANCH };

// ── copied from coord-fingerprint.test.ts (annex R6) ──
const prRow = (): Record<string, unknown> => ({
  number: 42, state: 'OPEN', headRefName: BRANCH, baseRefName: 'main',
  isCrossRepository: false, ours: true, isDraft: false,
});
const ccdLine = (): string => JSON.stringify({
  id: ID, rows: [prRow()], baseShort: 'main', branch: BRANCH, ahead: 1, checkedAt: Date.now(),
});
const openPrState: Runner = async () => ({ ran: true, code: 0, stdout: `${ccdLine()}\n`, stderr: '' });
const claimAt = (tip: string): DoneClaim => ({ branchTip: tip, prNumber: null, prPhase: 'open', handoffCommit: tip });

/** The server's `verifyDone` deps over the fixture HOME, `projects/` as the projects root. */
const serverDeps = () => {
  const base = testDeps(h.home, openPrState);
  return { ...base, cfg: { ...base.cfg, projectsRoot: path.join(h.home, 'projects') } };
};

/** A FULL registry record, every field `readRegistryMeasured` reads: `fx.addRow` writes only `.project` and `.branch`. */
function seedRecord(id: string, branch: string): void {
  fx.addRow(id, branch);
  const fields: Record<string, string> = {
    wrapper: 'claude', workdir: `/w/${id}`, uuid: 'a'.repeat(36), started: '1', workspace: id,
  };
  for (const [k, v] of Object.entries(fields)) fs.writeFileSync(path.join(fx.reg, `${id}.${k}`), v);
}

/** The opted-in project with one row on `ws/alpha` holding one commit of its own, and the radar's first tick over it. */
function optedIn(): string {
  fx.addHead(1, { 'pr.txt': 'pr\n' });
  seedRecord(ID, BRANCH);
  const own = fx.commitOn(BRANCH, { 'alpha.txt': 'a\n' });
  fx.conf(PROJECT, 'lineage=on\n');
  expect(fx.run().status).toBe(0);
  return own;
}

describe('the server accepts what the shipped radar measured (landing order wave 4)', () => {
  it('commit, tick, a clean merge of the base, tick: the claim at the old tip is accepted AT the live tip', { timeout: 120_000 }, async () => {
    const own = optedIn();
    const live = fx.mergeBase(BRANCH);
    expect(live).not.toBe(own);
    expect(fx.run().status).toBe(0);
    // The radar's output is what the server reads: a measured chain whose one step has the claim as its first parent.
    expect(fx.readJson('enabled')).toMatchObject({ v: 1, project: PROJECT });
    expect(fx.readJson(`${ID}.lineage`)).toMatchObject({ state: 'measured', tip: live, chain: [{ merge: live, p1: own }] });

    const res = await verifyDone(serverDeps(), RUN, claimAt(own));
    expect(res).toMatchObject({ ok: true, measured: { branchTip: live, prNumber: 42, prPhase: 'open', via: 'base-only-merge' } });
  });

  it('with no clean merge at all the claim is simply current: today\'s accept, no via', { timeout: 120_000 }, async () => {
    const own = optedIn();
    const res = await verifyDone(serverDeps(), RUN, claimAt(own));
    expect(res.ok).toBe(true);
    expect(res.ok && res.measured.branchTip).toBe(own);
    expect(res.ok && 'via' in res.measured).toBe(false);
  });

  it('a hand-edited merge is stale-tip', { timeout: 120_000 }, async () => {
    const own = optedIn();
    fx.handMerge(BRANCH, { 'hand.txt': 'slipped in\n' });
    expect(fx.run().status).toBe(0);
    expect(await verifyDone(serverDeps(), RUN, claimAt(own))).toMatchObject({ ok: false, code: 'stale-tip' });
  });

  it('a rebase onto the base (a single-parent tip) is stale-tip', { timeout: 120_000 }, async () => {
    const own = optedIn();
    fx.rebaseOnto(BRANCH);
    expect(fx.run().status).toBe(0);
    expect(await verifyDone(serverDeps(), RUN, claimAt(own))).toMatchObject({ ok: false, code: 'stale-tip' });
  });

  it('a merge of another workspace branch is stale-tip', { timeout: 120_000 }, async () => {
    const own = optedIn();
    seedRecord(OTHER_ID, 'ws/other');
    fx.commitOn('ws/other', { 'other.txt': 'o\n' });
    fx.mergeOther(BRANCH, 'ws/other');
    expect(fx.run().status).toBe(0);
    expect(await verifyDone(serverDeps(), RUN, claimAt(own))).toMatchObject({ ok: false, code: 'stale-tip' });
  });

  it('a clean merge the radar has not yet measured is lineage-unmeasured, never an accept', { timeout: 120_000 }, async () => {
    const own = optedIn();
    fx.mergeBase(BRANCH);                       // no run(): the lineage file still describes the old tip
    expect(await verifyDone(serverDeps(), RUN, claimAt(own)))
      .toMatchObject({ ok: false, code: 'lineage-unmeasured', detail: 'older-than-the-live-tip' });
  });

  it('the project\'s conf deleted and one more tick: the marker is gone and the answer is today\'s stale-tip', { timeout: 120_000 }, async () => {
    const own = optedIn();
    fx.mergeBase(BRANCH);
    expect(fx.run().status).toBe(0);
    expect(await verifyDone(serverDeps(), RUN, claimAt(own))).toMatchObject({ ok: true });   // control: opted in, it accepts
    fs.rmSync(fx.confPath());
    expect(fx.run().status).toBe(0);
    expect(fx.exists('enabled')).toBe(false);
    const res = await verifyDone(serverDeps(), RUN, claimAt(own));
    expect(res).toMatchObject({ ok: false, code: 'stale-tip' });
    expect((res as { detail: string }).detail).not.toMatch(/\((landing|lineage)/);
  });
});

// Landing order wave 4c (D-7469): `parseLineage` refuses a doc the radar cannot write, so every shape the SHIPPED radar
// does write must still read. Each file below is the probe's own output on a fixture HOME, read back through the parser.
describe("the parser reads every shape the shipped radar writes (wave 4c, D-7469)", () => {
  /** The row's lineage file as the probe left it, read by the server's parser with this row's expectations. */
  const parsed = (): LineageRead =>
    parseLineage(fs.readFileSync(path.join(fx.landDir, `${ID}.lineage`), 'utf8'), { project: PROJECT, id: ID, branch: BRANCH }, Date.now());
  /** The opted-in project with one row on `ws/alpha`, holding one commit of its own. */
  function alpha(): string {
    fx.addRow(ID, BRANCH);
    const own = fx.commitOn(BRANCH, { 'alpha.txt': 'a\n' });
    fx.conf(PROJECT, 'lineage=on\n');
    return own;
  }

  it('CCD_LAND_PROBE_LINEAGE_STEPS=0: a measured limit walk of no entries', { timeout: 90_000 }, () => {
    alpha();
    const tip = fx.mergeBase(BRANCH);
    expect(fx.run({ CCD_LAND_PROBE_LINEAGE_STEPS: '0' }).status).toBe(0);
    expect(fx.readJson(`${ID}.lineage`)).toMatchObject({ state: 'measured', tip, chain: [], stop: 'limit' });
    const r = parsed();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc).toMatchObject({ state: 'measured', tip, chain: [], stop: 'limit', branch: BRANCH });
  });

  it('nine clean base merges: a measured limit walk of eight entries', { timeout: 120_000 }, () => {
    alpha();
    let tip = '';
    for (let i = 0; i < 9; i++) tip = fx.mergeBase(BRANCH);
    expect(fx.run().status).toBe(0);
    expect(fx.readJson(`${ID}.lineage`)).toMatchObject({ state: 'measured', tip, stop: 'limit' });
    const r = parsed();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.stop).toBe('limit');
      expect(r.doc.chain).toHaveLength(8);
    }
  });

  it('a walk the project budget cut: unmeasured, a why of budget, stop unmeasured, and what was proven first', { timeout: 90_000 }, () => {
    alpha();
    const tip = fx.mergeBase(BRANCH);
    // The merge-tree of the walk's first step outlives the whole project budget (bounded: 30 s), so the budget cuts it.
    fx.wrapGit('case " $* " in *" merge-tree "*) sleep 30;; esac');
    expect(fx.run({ CCD_LAND_PROBE_BUDGET: '10' }).status).toBe(0);
    expect(fx.readJson(`${ID}.lineage`)).toMatchObject({ state: 'unmeasured', why: 'budget', tip, stop: 'unmeasured', chain: [] });
    const r = parsed();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc).toMatchObject({ state: 'unmeasured', tip, stop: 'unmeasured', chain: [] });
  });

  it('a git failure partway through the walk: a cut walk of one entry, with its why', { timeout: 90_000 }, () => {
    alpha();
    fx.mergeBase(BRANCH);
    const tip = fx.mergeBase(BRANCH);
    const cnt = path.join(h.home, 'ancestor.count');
    fx.wrapGit(`case " $* " in *" merge-base --is-ancestor "*) n=$(cat '${cnt}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${cnt}'; [ $n -ge 2 ] && exit 128;; esac`);
    expect(fx.run().status).toBe(0);
    expect(fx.readJson(`${ID}.lineage`)).toMatchObject({ state: 'unmeasured', why: 'rc-128', tip, stop: 'unmeasured' });
    const r = parsed();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.chain).toHaveLength(1);
  });

  it('a failed fetch: the unmeasured shape with a null base and stop, and the tip the registry read', { timeout: 90_000 }, () => {
    alpha();
    fx.wrapGit('case " $* " in *" fetch "*) exit 128;; esac');
    expect(fx.run().status).toBe(0);
    expect(fx.readJson(`${ID}.lineage`)).toMatchObject({ state: 'unmeasured', base: null, stop: null, chain: [] });
    const r = parsed();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc).toMatchObject({ state: 'unmeasured', chain: [], branch: BRANCH });
  });
});

// Landing order wave 4b (Task 2), end to end: the SHIPPED radar's `probe` doc is what the lane reads, and the row the
// fleet frame assembles for the bound session carries a `landing` that matches it. Two bound heads whose files collide
// on one path, so the doc holds a measured pair.
describe('the fleet frame carries what the shipped radar measured (wave 4b)', () => {
  it('a bound session\'s assembled row has a landing that matches the probe doc, and the other\'s names it back', { timeout: 120_000 }, async () => {
    fx.addHead(1, { 'src/x.ts': 'alpha\n' }, { branch: BRANCH });
    fx.addHead(2, { 'src/x.ts': 'other\n' }, { branch: 'ws/other' });
    seedRecord(ID, BRANCH);
    seedRecord(OTHER_ID, 'ws/other');
    fx.conf(PROJECT, '');
    expect(fx.run().status).toBe(0);
    const doc = fx.readJson('probe');
    expect(doc).toMatchObject({ state: 'measured', pairs: [{ a: 1, b: 2, state: 'conflict', paths: ['src/x.ts'] }] });

    const deps = serverDeps();
    const watcher = new FleetWatcher(withFakeClock(deps), new Bus(), 10_000);
    try {
      const records = await readRegistry(deps.io, deps.cfg);
      await watcher.sweepRadar(records);
      const heads = doc.heads as { pr: number; head: string }[];
      const alpha = watcher.currentLandings().get(ID);
      expect(alpha).toEqual({
        at: doc.at, pr: 1, head: heads.find((x) => x.pr === 1)!.head, baseRef: doc.base.ref,
        base: { state: 'clean' }, paired: true, conflicts: [{ pr: 2, paths: ['src/x.ts'], pathsCut: false }],
        unmeasuredWith: [], cut: { heads: false, pairs: false, unbound: false },
      });

      const frame = await assembleFleet(
        deps.io, deps.cfg, deps.tmux, liveStateReaderOver(deps.io), undefined, undefined, undefined, undefined, undefined, undefined, records,
        undefined, undefined, undefined, undefined, watcher.currentLandings());
      expect(frame.find((r) => r.id === ID)?.landing).toEqual(alpha);
      expect(frame.find((r) => r.id === OTHER_ID)?.landing).toMatchObject({ pr: 2, conflicts: [{ pr: 1, paths: ['src/x.ts'] }] });
    } finally {
      watcher.stop();
    }
  });
});
