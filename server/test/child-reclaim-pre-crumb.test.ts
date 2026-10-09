// Child reclamation wave 6, fix round 1 (review 335 F3) — a `{failed:…}` word
// that ccd prints BEFORE the tombstone and the breadcrumb (spec §5.6, "The
// tail, the breadcrumb and the resume"; spec §5.7, the presence rungs) left
// nothing to resume from, so the next attempt starts completely afresh: the
// verb read must say `not-resumable`, and the feed must say "retried from the
// start", never "resumes where it stopped".
//
// Two words are in that set: `probe-unmeasured` (the in-lock probe failing) and
// `state-changed` (the consent binding: the in-lock recompute and the pin
// read different branch states). `pin-failed` is deliberately NOT in it — it
// has post-breadcrumb producers too, so the word alone cannot tell them apart
// (a stated residual; the pre-breadcrumb `pin-failed` stays read `resumable`).
//
// The runner is `testDeps`', so every argv the executor composes crosses the
// agent's real exec whitelist first. Fixture HOME only (`mkTmp`).
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, isChildReclaimKebab, parseChildReclaimResult, reclaimChild,
  type ChildReclaimDeps, type ChildReclaimRequest,
} from '../src/coord/childReclaim.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'demo-quiet-basin';
const TOK = 'a'.repeat(64);
const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-reclaim', 'reclaim-v1', 'actor-flags-v1'] };

describe('parseChildReclaimResult: a failed word printed before the breadcrumb is not resumable', () => {
  it('state-changed (the consent binding, before the tombstone) reads not-resumable, with its token', () => {
    expect(parseChildReclaimResult(ID, '{"failed":"state-changed","detail":"d"}', '')).toEqual({
      kind: 'failed', resume: 'not-resumable', detail: 'state-changed: d', token: 'state-changed' });
  });

  it('probe-unmeasured still reads not-resumable (control)', () => {
    expect(parseChildReclaimResult(ID, '{"failed":"probe-unmeasured","detail":"d"}', '')).toEqual({
      kind: 'failed', resume: 'not-resumable', detail: 'probe-unmeasured: d', token: 'probe-unmeasured' });
  });

  it('pin-failed still reads resumable (control: it has post-breadcrumb producers, so the word cannot tell)', () => {
    expect(parseChildReclaimResult(ID, '{"failed":"pin-failed","detail":"d"}', '')).toMatchObject({
      kind: 'failed', resume: 'resumable', token: 'pin-failed' });
  });

  it('a post-breadcrumb word (worktree-remove-failed) and an unknown word still read resumable (control)', () => {
    for (const w of ['worktree-remove-failed', 'a-word-a-newer-ccd-prints']) {
      expect(parseChildReclaimResult(ID, JSON.stringify({ failed: w, detail: 'd' }), '')).toMatchObject({
        kind: 'failed', resume: 'resumable', token: w });
    }
  });

  it('the kebab scanner’s guard admits both pre-breadcrumb words and not pin-failed', () => {
    expect(isChildReclaimKebab('probe-unmeasured')).toBe(true);
    expect(isChildReclaimKebab('state-changed')).toBe(true);
    expect(isChildReclaimKebab('pin-failed')).toBe(false);
  });
});

/** A closed minting run and a registry row, a scripted ccd, and the feed —
 *  the part of `child-reclaim.test.ts`'s rig this file needs. */
const rig = async (verb: { code: number; stdout: string }) => {
  const home = mkTmp('ccrc-child-reclaim-precrumb-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'demo-coordinator' });
  if (!('id' in opened)) throw new Error('openRun refused');
  const runId = opened.id;
  coord.markDispatched(runId, ID, ID, 'ws/quiet-basin', false);
  expect(coord.closeRun({ runId, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
    viaClosing: false }).ok).toBe(true);
  const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`,
    started: '1', workspace: ID, branch: 'ws/quiet-basin', base: 'origin/main', child: String(runId) };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  const audit = JSON.stringify({ id: ID, mode: 'reclaim', childOf: runId, verdict: 'reclaimable', detail: '', token: TOK });
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'ws-audit') return { code: 0, stdout: audit, stderr: '' };
    if (args[0] === 'ws-reclaim') return { code: verb.code, stdout: verb.stdout, stderr: '' };
    return { code: 1, stdout: '', stderr: `unscripted ${args[0]}` };
  };
  const base = testDeps(home, run);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, fleetState: CAPS,
    presence: { isVisible: () => false }, notifyLog };
  const req: ChildReclaimRequest = { sessionId: ID, runId, trigger: 'close' as const, deferExpired: false,
    deferredSinceMs: null, feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE };
  const bodies = () => coord.feedEvents(50).filter((e) => e.sessionId === ID).map((e) => e.body);
  return { deps, req, bodies };
};

describe('reclaimChild: the feed sentence follows the resume reading', () => {
  it('a state-changed FAILURE says it is retried from the start, not that the box resumes where it stopped', async () => {
    const s = await rig({ code: 1, stdout: '{"failed":"state-changed","detail":"d"}' });
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', resume: 'not-resumable', token: 'state-changed' });
    expect(s.bodies()).toHaveLength(1);
    expect(s.bodies()[0]).toContain('It is retried from the start.');
    expect(s.bodies()[0]).not.toContain('resumes where it stopped');
  });

  it('a probe-unmeasured failure says the same (control)', async () => {
    const s = await rig({ code: 1, stdout: '{"failed":"probe-unmeasured","detail":"d"}' });
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', resume: 'not-resumable' });
    expect(s.bodies()[0]).toContain('It is retried from the start.');
    expect(s.bodies()[0]).not.toContain('resumes where it stopped');
  });

  it('a pin-failed failure still says the box resumes where it stopped (control)', async () => {
    const s = await rig({ code: 1, stdout: '{"failed":"pin-failed","detail":"d"}' });
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', resume: 'resumable' });
    expect(s.bodies()[0]).toContain('the box resumes where it stopped');
    expect(s.bodies()[0]).not.toContain('It is retried from the start.');
  });
});
