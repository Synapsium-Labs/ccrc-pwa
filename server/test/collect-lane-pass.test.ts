// Child reclamation wave 9 (spec §5.10): the temp-root collector's PASS, wired into the watcher. `collect-lane-bounds`
// pins who a pass asks and what a settled act job does to the lane; the executor's and L1's suites pin each step and
// each answer. What is only provable HERE is what reaches ccd, when, and on which queue:
// - the constants are derived, and the tick dispatches the pass after the dead-coordinator lane;
// - ONE gather (the two listings and the switches' own listing, read together) after the throttle, and nothing else
//   awaited: the pass never awaits a call it queued; one pass at a time; the throttle on the monotonic clock, stamped
//   before and after;
// - the gates at the pass's start (both capabilities, the pause, an unlistable registry) each clear every observation
//   pair; a port that rejects under the population read is no gate: it makes those listings unmeasured;
// - forgetting, the pre-filter's listing, the learning cap, the act offered first, and the id's queue key;
// - the stale-answer generations across a marker flip, the live flag that starts SHADOWED, a restart, and an id under a
//   standing presence claim that never starves another;
// - the collector's items reach the frame through the attention list's ONE write.
// FIXTURE HOME ONLY (`collectLaneFixture.ts`): ccd is a scripted model, the registry a fixture HOME's.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHILD_RECLAIM_SWEEP_MS, COLLECT_AUDIT_STALL_MS, COLLECT_OBSERVE_INTERVAL_MS } from '../src/watch.js';
import { CHILD_RECLAIM_DEFER_CEILING_MS } from '../src/childReclaimSweep.js';
import {
  COLLECT_AUDITS_PER_PASS, COLLECT_FEED_TITLE, COLLECT_LANE_LIVE_MARKER, collectFeedSwitchBody,
} from '../src/collectLane.js';
import { COLLECT_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { COLLECT_BOX_LABELS } from '../../shared/api.js';
import { collectRig, type CcdAnswer, type CollectRig } from './collectLaneFixture.js';
import { FULL_CAPS } from './collectTempRootFixture.js';
import { codeOnly } from './sourceScan.js';

afterEach(() => { vi.restoreAllMocks(); });

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const watchSrc = (): string => codeOnly(readFileSync(path.join(srcDir, 'watch.ts'), 'utf8'));
/** A method's code, from its signature to its closing brace at two spaces. */
const methodOf = (src: string, sig: string): string => {
  const at = src.indexOf(sig);
  expect(at, `${sig.trim()} is gone`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('\n  }\n', at));
};
/** The feed rows of one flip, by Task 5's own title and words. */
const flipRows = (f: CollectRig, live: boolean) =>
  f.feed().filter((e) => e.title === COLLECT_FEED_TITLE.switch && e.body === collectFeedSwitchBody(live));

describe('the lane’s constants are derived, and the tick dispatches it (spec §5.10)', () => {
  it('the observation interval IS the sweep interval, spelled from it, never a second literal', () => {
    expect(COLLECT_OBSERVE_INTERVAL_MS).toBe(CHILD_RECLAIM_SWEEP_MS);
    expect(watchSrc()).toContain('export const COLLECT_OBSERVE_INTERVAL_MS = CHILD_RECLAIM_SWEEP_MS;');
  });

  it('a learning audit’s unsettled bound is twice ws-audit’s remote runner row', () => {
    const row = /^\s*'ws-audit':\s*([0-9_]+),/m.exec(readFileSync(path.join(srcDir, 'remote', 'runner.ts'), 'utf8'));
    expect(row, 'ws-audit’s runner row is gone').not.toBeNull();
    expect(COLLECT_AUDIT_STALL_MS).toBe(2 * Number(row![1]!.replace(/_/g, '')));
  });

  it('the tick dispatches the pass, unawaited, after the dead-coordinator lane and before the mail lane', () => {
    const src = watchSrc();
    const dead = src.indexOf('void this.sweepDeadCoordinators(records, registryRead.names)');
    const mine = src.indexOf('void this.sweepTempRootCollect(records, registryRead.names)');
    const mail = src.indexOf('void this.sweepMail()');
    expect([dead, mine, mail].every((i) => i > -1), 'an anchor is gone').toBe(true);
    expect(dead).toBeLessThan(mine);
    expect(mine).toBeLessThan(mail);
  });

  it('and a tick reaches the lane: a witnessed id is audited', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    await f.watcher.tick();
    await vi.waitFor(() => expect(f.audits('demo-a')).toHaveLength(1));
  });
});

describe('one gather, one pass at a time, a monotonic throttle (spec §5.10)', () => {
  it('the pass awaits ONE thing — the gather, after the throttle — never a call it queued, and reads the pause alone', () => {
    const src = watchSrc();
    const outer = methodOf(src, '  async sweepTempRootCollect(');
    const stamp = outer.indexOf('this.lastCollectSweep = gate;');
    const guard = outer.indexOf('this.collectSweeping = true;');
    expect(stamp > -1 && guard > stamp, 'the throttle is stamped, then the guard raised').toBe(true);
    expect([...outer.matchAll(/\bawait\b/g)], 'the pass awaits its gather alone').toHaveLength(1);
    const pass = methodOf(src, '  private async collectPass(');
    const gather = pass.indexOf('await Promise.all([');
    expect([...pass.matchAll(/\bawait\b/g)].map((m) => m.index)).toEqual([gather]);
    expect(pass.indexOf('readCollectPopulation(this.deps.io, this.deps.cfg.registryDir)')).toBeGreaterThan(gather);
    expect(pass.indexOf('collectSwitches(this.deps.io, this.deps.cfg.registryDir)')).toBeGreaterThan(gather);
    expect(pass.indexOf('this.lastCollectSweep = mono;')).toBeGreaterThan(gather);
    expect(pass, 'the live marker is the executor’s to read, at its act').not.toMatch(/\.live\b/);
  });

  it('a tick that lands while a pass gathers returns at once: a second gather never starts', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    const gate = f.holdGather();
    const first = f.pass();
    await vi.waitFor(() => expect(f.gatherReached()).toBe(1));
    f.next();                                               // a whole interval on: only one-pass-at-a-time can stop it
    await f.pass();
    expect(f.gatherReached(), 'the second pass gathered nothing').toBe(1);
    gate.release(); await first; await f.settled();
    expect(f.audits('demo-a')).toHaveLength(1);
  });

  it('a pass inside the interval reads nothing, and one a whole interval later reads again', async () => {
    const f = await collectRig();
    await f.pass();
    f.advance(CHILD_RECLAIM_SWEEP_MS - 1); await f.pass();
    expect(f.gatherReached()).toBe(1);
    f.advance(1); await f.pass();
    expect(f.gatherReached()).toBe(2);
  });

  it('the throttle is stamped BEFORE the gather: a pass the capability gate stopped still spends its interval', async () => {
    const f = await collectRig();
    f.fleetState.ccdVerbs = FULL_CAPS.filter((v) => v !== COLLECT_CAP);
    await f.pass();                                         // stopped at the gate, before any read
    f.fleetState.ccdVerbs = [...FULL_CAPS];
    await f.pass();                                         // the same instant: throttled by the stopped pass's stamp
    expect(f.gatherReached(), 'throttled from the stamp before the gather').toBe(0);
    f.next(); await f.pass();
    expect(f.gatherReached()).toBe(1);
  });

  it('and RE-STAMPED after it: a gather that settles just short of an interval puts the next pass a whole interval later', async () => {
    const f = await collectRig();
    const gate = f.holdGather();
    const first = f.pass();
    await vi.waitFor(() => expect(f.gatherReached()).toBe(1));
    f.advance(CHILD_RECLAIM_SWEEP_MS - 1);
    gate.release(); await first;
    f.advance(1);                                           // an interval after the gate's stamp, 1 ms after the decision
    await f.pass();
    expect(f.gatherReached(), 'throttled from the decision clock').toBe(1);
  });
});

describe('the gates at the pass’s start: nothing is asked, and every observation pair clears (spec §5.10)', () => {
  /** Shadowed, past the start hold-off: demo-a gets its first observation; `raise` stands for ONE pass; then `lower`.
   *  Answers the pass, counted after the gate lowered, that records demo-a's would-collect: 2 when the pair was cleared
   *  (a fresh observation first), 1 when it survived. demo-b, planted while the gate stands, is due for a LEARNING audit,
   *  which reads no switch itself: only the pass's own gate keeps it unasked. */
  const passOfWouldCollect = async (f: CollectRig, raise: () => void, lower: () => void): Promise<number> => {
    f.pastHoldOff();
    f.witness('demo-a');
    await f.pass(); await f.settled();
    expect(f.audits('demo-a'), 'observation 1').toHaveLength(1);
    raise();
    f.witness('demo-b');                                    // never asked: due for a LEARNING audit, which reads no switch itself
    f.next(); await f.pass(); await f.settled();
    expect(f.audits('demo-a'), 'nothing is asked while the gate stands').toHaveLength(1);
    expect(f.audits('demo-b'), 'no learning audit while the gate stands: the pass itself stops').toEqual([]);
    lower();
    return f.passesUntil(() => f.wouldCollects('demo-a').length > 0, 3);
  };
  const without = (f: CollectRig, cap: string) => (): void => { f.fleetState.ccdVerbs = FULL_CAPS.filter((v) => v !== cap); };
  const restore = (f: CollectRig) => (): void => { f.fleetState.ccdVerbs = [...FULL_CAPS]; };

  it('the collector’s capability missing', async () => {
    const f = await collectRig();
    expect(await passOfWouldCollect(f, without(f, COLLECT_CAP), restore(f))).toBe(2);
  });

  it('the pause’s capability missing: never an automatic destructive lane on a box the phone cannot pause', async () => {
    const f = await collectRig();
    expect(await passOfWouldCollect(f, without(f, RECLAIM_PAUSE_CAP), restore(f))).toBe(2);
  });

  it('reclaim-paused raised', async () => {
    const f = await collectRig();
    expect(await passOfWouldCollect(f, f.pause, f.unpause)).toBe(2);
  });

  it('a registry that does not list: a pause this server cannot rule out, never shadow', async () => {
    const f = await collectRig();
    expect(await passOfWouldCollect(f, () => f.setUnlistable(true), () => f.setUnlistable(false))).toBe(2);
  });

  it('a port that rejects under the population read is no gate: both listings unmeasured, nothing audited or forgotten from them, two box lines, and the pair survives', async () => {
    const f = await collectRig();
    expect(await passOfWouldCollect(f, () => f.setRejecting(true), () => f.setRejecting(false)), 'no pair cleared').toBe(1);
    const g = await collectRig();
    g.witness('demo-a');
    await g.pass(); await g.settled();
    g.setRejecting(true);
    g.next(); await g.pass(); await g.settled();
    expect(g.audits('demo-a'), 'nothing audited from an unmeasured listing').toHaveLength(1);
    expect(g.lane().entries.has('demo-a'), 'nor forgotten').toBe(true);
    expect(g.boxWide(await g.attention()).map((a) => a.sessionId).sort())
      .toEqual([COLLECT_BOX_LABELS.tmpquarantine, COLLECT_BOX_LABELS.tmproots].sort());
  });

  it('the capabilities are asked before anything is read', async () => {
    const f = await collectRig();
    without(f, COLLECT_CAP)();
    await f.pass();
    expect(f.gatherReached()).toBe(0);
  });
});

describe('the population is the two listings, read in the gather (spec §5.10)', () => {
  it('an id is forgotten only when BOTH listings were measured and neither names it', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    await f.pass(); await f.settled();
    expect(f.lane().entries.has('demo-a')).toBe(true);
    f.unwitness('demo-a');
    f.breakQuarantine();
    f.next(); await f.pass(); await f.settled();
    expect(f.lane().entries.has('demo-a'), 'one listing unmeasured: its absence is never read').toBe(true);
    f.mendQuarantine();
    f.next(); await f.pass(); await f.settled();
    expect(f.lane().entries.has('demo-a'), 'both measured, neither names it: forgotten').toBe(false);
  });

  it('an answer that arrives after its id was forgotten is dropped: no entry comes back', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    const late = f.hold('audit', 'demo-a');
    await f.pass();
    await vi.waitFor(() => expect(late.reached()).toBe(true));
    f.unwitness('demo-a');
    f.next(); await f.pass();                               // the guard is down: the calls are not under it
    expect(f.lane().entries.has('demo-a')).toBe(false);
    late.release(); await f.settled();
    expect(f.lane().entries.has('demo-a'), 'the late answer re-created nothing').toBe(false);
  });

  it('the pre-filter reads the listing the TICK handed the pass: an id whose exact row stands there is not audited', async () => {
    const f = await collectRig();
    f.witness('demo-a');
    await f.pass([...f.names(), 'demo-a.uuid']); await f.settled();
    expect(f.audits('demo-a')).toEqual([]);
    f.next(); await f.pass(); await f.settled();
    expect(f.audits('demo-a')).toHaveLength(1);
  });

  it(`at most ${COLLECT_AUDITS_PER_PASS} learning audits a pass; the never-asked go by id`, async () => {
    const f = await collectRig();
    for (const id of ['demo-d', 'demo-b', 'demo-a', 'demo-c']) f.witness(id);
    await f.pass(); await f.settled();
    expect(f.audits().map((c) => c.id).sort()).toEqual(['demo-a', 'demo-b']);
    f.next(); await f.pass(); await f.settled();            // inside the hold-off: the two paired wait; the rest learn
    expect(f.audits().map((c) => c.id).slice(2).sort()).toEqual(['demo-c', 'demo-d']);
  });
});

describe('the act is offered first (spec §5.10)', () => {
  it('a single collectable orphan reaches its executor job within the interval plus two passes', async () => {
    const f = await collectRig();
    f.pastHoldOff(); f.witness('demo-a');
    const jobAt: number[] = [];                             // when the slot became the job for demo-a
    f.onCall.push(() => {
      const s = f.lane().slot;
      if (jobAt.length === 0 && s.kind === 'job' && s.id === 'demo-a') jobAt.push(s.sinceMono);
    });
    const firstPass = f.mono();
    await f.pass(); await f.settled();
    await f.passesUntil(() => jobAt.length > 0, 3);
    expect(jobAt[0]! - firstPass).toBeLessThanOrEqual(COLLECT_OBSERVE_INTERVAL_MS + 2 * CHILD_RECLAIM_SWEEP_MS);
  });
});

describe('every collector call rides the id’s queue key (spec §5.10)', () => {
  it('a learning audit waits behind that id’s queued job — another lane’s reclaim or expiry', async () => {
    const f = await collectRig();
    f.witness('demo-a'); f.witness('demo-b');
    const release = f.occupy('demo-a');
    await f.pass();
    await vi.waitFor(() => expect(f.audits('demo-b')).toHaveLength(1));
    expect(f.audits('demo-a'), 'queued behind it, not composed').toEqual([]);
    release(); await f.settled();
    expect(f.audits('demo-a')).toHaveLength(1);
  });

  it('so does the act job, its slot taken as it is queued', async () => {
    const f = await collectRig();
    f.pastHoldOff(); f.witness('demo-a');
    await f.pass(); await f.settled();                      // observation 1
    const release = f.occupy('demo-a');
    f.next();
    const listed = f.registryListings();
    await f.pass();
    await vi.waitFor(() => expect(f.lane().slot).toMatchObject({ kind: 'job', id: 'demo-a' }));
    // A job run off the queue reads its switches (step 2) the moment it is queued, before the pass returns.
    expect(f.registryListings() - listed, 'the job has not started: only the pass’s own gather listed the registry').toBe(1);
    expect(f.audits('demo-a'), 'the job’s own audit waits too').toHaveLength(1);
    release(); await f.settled();
    expect(f.audits('demo-a')).toHaveLength(2);
    expect(f.wouldCollects('demo-a')).toHaveLength(1);
  });
});

describe('stale answers, the live flag and a restart (spec §5.10)', () => {
  it('a learning audit composed before a job sees the marker appear, answering collectable after it, seeds no observation; each first live act follows two observations composed after the flip', async () => {
    const f = await collectRig();
    f.pastHoldOff();
    f.witness('demo-b');
    await f.pass(); await f.settled();                      // demo-b: observation 1
    f.touch(COLLECT_LANE_LIVE_MARKER);
    f.witness('demo-a');
    const late = f.hold('audit', 'demo-a');
    f.next();
    await f.pass();                                         // demo-b's act job sees the arming; demo-a is learned, held
    await vi.waitFor(() => expect(f.lane().lastSeenLive).toBe(true));
    expect(late.reached(), 'demo-a’s audit was composed before the flip was seen').toBe(true);
    expect(f.collects(), 'the job that saw the flip composed nothing').toEqual([]);
    late.release(); await f.settled();                      // ...and it answers collectable AFTER the flip
    const flipAt = f.calls.length;
    await f.passesUntil(() => f.collects('demo-a').length > 0 && f.collects('demo-b').length > 0);
    for (const id of ['demo-a', 'demo-b']) {
      const first = f.calls.findIndex((c) => c.verb === 'collect' && c.id === id);
      const fresh = f.calls.slice(flipAt, first).filter((c) => c.verb === 'audit' && c.id === id);
      expect(fresh.length, `${id}: observations composed after the flip, before its first ws-collect`).toBeGreaterThanOrEqual(2);
    }
  });

  it('a lane built with the marker standing writes "now live" and composes nothing on its first job', async () => {
    const f = await collectRig({ armed: true });
    f.pastHoldOff(); f.witness('demo-a');
    await f.pass(); await f.settled();                      // observation 1
    f.next(); await f.pass(); await f.settled();            // the first act job: the flag starts SHADOWED, so a flip
    expect(flipRows(f, true)).toHaveLength(1);
    expect(f.collects()).toEqual([]);
    await f.passesUntil(() => f.collects('demo-a').length > 0);
    expect(flipRows(f, true), 'one row per flip').toHaveLength(1);
  });

  it('each flip writes ONE row, either way, and the job that sees it composes nothing', async () => {
    const f = await collectRig({ armed: true });
    f.pastHoldOff(); f.witness('demo-a'); f.witness('demo-b');
    await f.passesUntil(() => f.lane().lastSeenLive);
    f.disarm();
    await f.passesUntil(() => !f.lane().lastSeenLive);
    expect(flipRows(f, true)).toHaveLength(1);
    expect(flipRows(f, false)).toHaveLength(1);
    expect(f.collects()).toEqual([]);
  });

  it('a restart needs two fresh observations: no memory is carried', async () => {
    const a = await collectRig();
    a.pastHoldOff(); a.witness('demo-a');
    await a.pass(); await a.settled();                      // observation 1, in the first process
    const b = await collectRig({ home: a.home, coord: a.coord, notifyLog: a.notifyLog, mintingRun: a.mintingRun,
      clock: a.now() + CHILD_RECLAIM_SWEEP_MS + 1, mono: a.mono() + CHILD_RECLAIM_SWEEP_MS + 1 });
    b.pastHoldOff();
    await b.pass(); await b.settled();
    expect(b.wouldCollects('demo-a'), 'the new process learns first: nothing rests on the old one’s observation').toEqual([]);
    expect(b.audits('demo-a')).toHaveLength(1);
    b.next(); await b.pass(); await b.settled();
    expect(b.wouldCollects('demo-a')).toHaveLength(1);
  });

  it('an id under a standing presence claim never starves another: the other’s act is composed within two passes', async () => {
    const f = await collectRig();
    f.pastHoldOff(); await f.goLive();
    f.setVisible((id) => id === 'demo-a');                  // a tab left open on demo-a, its claim re-stated for ever
    f.witness('demo-a'); f.witness('demo-b');
    f.next(); await f.pass(); await f.settled();            // observation 1 of each
    const before = f.calls.length;
    f.next(); await f.pass(); await f.settled();
    f.next(); await f.pass(); await f.settled();
    expect(f.calls.slice(before).filter((c) => c.verb === 'collect').map((c) => c.id)).toEqual(['demo-b']);
  });
});

describe('the collector’s items reach the frame through the list’s ONE write (spec §5.10, §5.9)', () => {
  it('an unmeasured listing is ONE box-wide item with no run, merged by the child lane’s publish', async () => {
    const f = await collectRig();
    f.breakTmproots();
    await f.pass();
    const box = f.boxWide(await f.attention());
    expect(box, 'one box-wide line for the unmeasured listing').toHaveLength(1);
    expect(box[0]!.runId).toBeNull();
  });

  it('a pass whose audits all print nothing raises the no-document box line, published once that pass’s calls settle', async () => {
    const f = await collectRig();
    for (const id of ['demo-a', 'demo-b']) {
      f.witness(id);
      f.scripts.set(id, (verb) => (verb === 'audit' ? f.answers.noDocument() : undefined));
    }
    await f.pass(); await f.settled();                      // two learning audits, one pass, neither printed anything
    expect(f.audits().map((c) => c.id).sort()).toEqual(['demo-a', 'demo-b']);
    expect(f.boxWide(await f.attention()).map((a) => a.word), 'the pass’s tally reached the frame').toContain('no-document');
  });

  it('an older pass whose last call settles after a newer pass published never publishes over it; its tally was pruned at that publish', async () => {
    const f = await collectRig();
    for (const id of ['demo-a', 'demo-b']) {
      f.witness(id);
      f.scripts.set(id, (verb) => (verb === 'audit' ? f.answers.noDocument() : undefined));
    }
    const late = f.hold('audit', 'demo-a');
    await f.pass(); await f.settled();                      // pass 1: demo-b printed nothing; demo-a's audit is held
    expect(late.reached()).toBe(true);
    f.witness('demo-c'); f.witness('demo-d');
    f.next(); await f.pass(); await f.settled();            // pass 2: demo-c and demo-d answer collectable, and publish
    expect(f.audits().map((c) => c.id).slice(2).sort()).toEqual(['demo-c', 'demo-d']);
    // The prune's only effect is memory: read it where it lives.
    const tallies = (f.watcher as unknown as { collectPassTally: ReadonlyMap<number, unknown> }).collectPassTally;
    expect.soft(tallies.size, 'pass 1’s tally, its call still out, was pruned when pass 2 published').toBe(0);
    late.release(); await f.settled();                      // pass 1's last call answers no document, after pass 2 published
    expect(f.boxWide(await f.attention()).map((a) => a.word), 'pass 2’s answers stand: pass 1 never publishes over them')
      .not.toContain('no-document');
  });
});

describe('a refusal or a die that repeats every cycle writes ONE feed row, and paces as ever (spec §5.10, §5.9)', () => {
  /** ccd's `ws-collect` refusal document, with a detail a case counts its rows by. */
  const refusal = (detail: string): CcdAnswer => ({ code: 0, stdout: JSON.stringify({ refused: 'in-use', detail, paths: [] }) });
  /** ccd's exit-0 audit verdict document, as `_ws_collect_audit_doc` prints it for a refusal word. */
  const verdictDoc = (f: CollectRig, id: string, word: string, detail: string): CcdAnswer => ({ code: 0, stdout: JSON.stringify({
    session: id, mode: 'collect', exists: true, collect: { leaf: path.join(f.home, '.cc-tmp', id), records: [], witness: null },
    verdict: word, detail }) });
  /** The collector's answer rows for `id` that carry `said`. */
  const rowsSaying = (f: CollectRig, id: string, said: string) =>
    f.feed().filter((e) => e.sessionId === id && e.title === COLLECT_FEED_TITLE.answer && e.body.includes(said));
  /** The gaps between an id's consecutive ws-collect calls. */
  const gaps = (f: CollectRig, id: string): number[] => {
    const at = f.collects(id).map((c) => c.mono);
    return at.slice(1).map((m, i) => m - at[i]!);
  };
  const live = async (): Promise<CollectRig> => {
    const f = await collectRig();
    f.pastHoldOff(); await f.goLive();
    f.witness('demo-a');
    return f;
  };

  it('a retryable refusal on every act: one row over three cycles, and the cycles stay a ceiling apart', async () => {
    const f = await live();
    f.scripts.set('demo-a', (verb) => (verb === 'collect' ? refusal('refusal-d') : undefined));
    await f.passesUntil(() => f.collects('demo-a').length >= 3, 200);
    expect(rowsSaying(f, 'demo-a', 'refusal-d'), 'one row, not one per cycle').toHaveLength(1);
    expect(f.collects('demo-a').length).toBeGreaterThanOrEqual(3);
    for (const gap of gaps(f, 'demo-a')) expect(gap, 'the pacing is unmoved').toBeGreaterThanOrEqual(CHILD_RECLAIM_DEFER_CEILING_MS);
  });

  it('a recognised pre-lock die on every act: one row over three cycles, and the cycles stay a ceiling apart', async () => {
    const f = await live();
    f.scripts.set('demo-a', (verb) => (verb === 'collect' ? f.answers.lockUnopenable('demo-a') : undefined));
    await f.passesUntil(() => f.collects('demo-a').length >= 3, 200);
    expect(rowsSaying(f, 'demo-a', 'lock-unopenable'), 'one row, not one per cycle').toHaveLength(1);
    expect(f.collects('demo-a').length).toBeGreaterThanOrEqual(3);
    for (const gap of gaps(f, 'demo-a')) expect(gap, 'the pacing is unmoved').toBeGreaterThanOrEqual(CHILD_RECLAIM_DEFER_CEILING_MS);
  });

  it('CONTROL: an audit verdict between two refusals ends the episode, so the refusal writes a second row', async () => {
    const f = await live();
    let audited = 0;
    f.scripts.set('demo-a', (verb) => {
      if (verb === 'collect') return refusal('refusal-d');
      audited += 1;
      return audited === 3 ? verdictDoc(f, 'demo-a', 'in-use', 'audit-d') : undefined;   // after the first refusal's cycle
    });
    await f.passesUntil(() => f.collects('demo-a').length >= 3, 200);
    expect(audited, 'the verdict was answered').toBeGreaterThanOrEqual(3);
    expect(rowsSaying(f, 'demo-a', 'audit-d'), 'the audit verdict\'s own row').toHaveLength(1);
    expect(rowsSaying(f, 'demo-a', 'refusal-d'), 'a refusal before it and a refusal after it').toHaveLength(2);
  });
});
