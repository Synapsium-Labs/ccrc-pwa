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
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';

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
