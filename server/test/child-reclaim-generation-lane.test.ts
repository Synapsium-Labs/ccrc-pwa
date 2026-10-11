// Child-reclamation wave 8 (spec §5.5, §5.7): the sweep lane reads every marked row's registry generation and keys
// its memory and every request on it. What is only provable HERE:
// - the reads are GATHERED, concurrently, before the per-child loop, so the loop stays synchronous and no await
//   sits between a row's entry read and its write;
// - a tick during the gather is throttled, a pass overtaken during its gather decides nothing, and a pass that
//   decides re-stamps the throttle with its own decision clock, so any two passes that decide are at least one
//   interval apart on the monotonic clock, however long a gather takes;
// - every decision clock is read AFTER the gather, so no entry is stamped with an instant older than its evidence;
// - the generation is the entry's third key, an unreadable one is the doubt word `identity-unmeasured` and seeds
//   nothing, and every request carries the entry's key as `licenceGeneration`.
// The executor is stubbed at `Deps.childReclaimExec`, the lane's one seam (`child-reclaim-sweep.test.ts`'s idiom).
// FIXTURE HOMEs only: every registry path is under a `mkTmp` HOME, and the runner is a recording stub.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { ACTOR_FLAGS_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { localIO, type FleetIO, type MeasuredRead } from '../src/io.js';
import type { ChildReclaimOutcome, ChildReclaimRequest } from '../src/coord/childReclaim.js';
import { holdReason } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { codeOnly } from './sourceScan.js';

afterEach(() => { vi.restoreAllMocks(); });

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const T0 = 1_790_000_000_000;
/** The journal file's own generation, the MIRROR's key: not a registry generation. */
const JOURNAL_GEN = '1790000000000000000';
const G1 = '0b6f8a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b';
const G2 = '7c9d0e1f-2a3b-4c5d-8e6f-1a2b3c4d5e6f';

const fixture = () => {
  let clock = T0;
  let mono = 5_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const home = mkTmp('ccrc-cr-gen-lane-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const calls: string[][] = [];
  const run = async (_cmd: string, args: string[]) => {
    calls.push(args);
    if (args[0] === 'ws-release') {
      const id = args[args.indexOf('--session') + 1] ?? '';
      try { rmSync(path.join(reg, `${id}.hold`)); return { code: 0, stdout: `released ${id}\n`, stderr: '' }; }
      catch { return { code: 0, stdout: `not held ${id}\n`, stderr: '' }; }
    }
    return { code: 1, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const requests: ChildReclaimRequest[] = [];
  // The generation reads, counted, holdable and rejectable: while `holding`, a read waits for `release()`, so a case
  // decides exactly when a pass's gather settles; a row named by `reject(id)` has its read REJECT (spec §5.5). Every
  // other read is the real one.
  const genReads: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let holding = false;
  const held: (() => void)[] = [];
  const rejecting = new Set<string>();
  const io: FleetIO = {
    ...localIO,
    async readFileMeasured(p, timeoutMs, signal): Promise<MeasuredRead> {
      if (!p.endsWith('.generation')) return localIO.readFileMeasured(p, timeoutMs, signal);
      genReads.push(path.basename(p));
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (rejecting.has(path.basename(p, '.generation'))) throw new Error('agent gone');
        if (holding) await new Promise<void>((resolve) => { held.push(resolve); });
        return await localIO.readFileMeasured(p, timeoutMs, signal);
      } finally {
        inFlight -= 1;
      }
    },
  };
  const deps = {
    ...testDeps(home, run), cfg, coord, io,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-audit', 'ws-reclaim', RECLAIM_CAP, RECLAIM_PAUSE_CAP, 'ws-release', ACTOR_FLAGS_CAP] },
    presence: { isVisible: () => false },
    childReclaimExec: async (req: ChildReclaimRequest): Promise<ChildReclaimOutcome> => {
      requests.push(req);
      return { kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 };
    },
    monotonicMs: () => mono,
  };
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  let uid = 0;
  let progN = 0;
  /** A run opened and abandoned: the minting run of a finished child. */
  const finishedRun = (): { id: number; program: string } => {
    const program = `w8-gen-${++progN}`;
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    const c = coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program,
      viaClosing: false });
    if (!c.ok) throw new Error(`abandon refused: ${JSON.stringify(c)}`);
    return { id: r.id, program };
  };
  /** The row's generation file: exactly `content`, or none at all. */
  const setGeneration = (id: string, content: string | null): void => {
    const p = path.join(reg, `${id}.generation`);
    if (content === null) rmSync(p, { force: true }); else writeFileSync(p, content);
  };
  /** A registry row, its `.child` marker (none when `runId` is null), its generation and its journalled `create`. */
  const plant = (id: string, runId: number | null, generation: string | null, extra: Record<string, string> = {}): void => {
    const fields: Record<string, string> = {
      uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, workspace: id.slice('demo-'.length),
      branch: `ws/${id}`, base: 'origin/main', started: '1', ...(runId === null ? {} : { child: String(runId) }), ...extra,
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
    setGeneration(id, generation);
    uid += 1;
    const line = JSON.stringify({ uid: `w8.1.${uid}`, at: clock, act: 'create', outcome: 'done', verb: 'ws-add', id });
    coord.ingestJournal({ gen: JOURNAL_GEN, rows: [parseJournalLine(line)], cursor: uid * 200, size: uid * 200, at: clock });
  };
  const pass = async (): Promise<void> => {
    await watcher.sweepChildReclaim(await readRegistry(deps.io, cfg), readdirSync(reg));
  };
  const next = (): void => { clock += CHILD_RECLAIM_SWEEP_MS + 1; mono += CHILD_RECLAIM_SWEEP_MS + 1; };
  const advance = (ms: number): void => { clock += ms; mono += ms; };
  return {
    reg, calls, requests, genReads, finishedRun, plant, setGeneration, pass, next, advance,
    mono: () => mono,
    maxInFlight: () => maxInFlight,
    hold: (): void => { holding = true; },
    unhold: (): void => { holding = false; },
    release: (): void => { for (const r of held.splice(0)) r(); },
    heldCount: (): number => held.length,
    reject: (id: string): void => { rejecting.add(id); },
    entryOf: (id: string) => watcher.currentChildReclaimDefers().get(id),
    verdictOf: (id: string) => watcher.currentChildReclaimVerdicts()?.get(id),
    releases: (): string[][] => calls.filter((c) => c[0] === 'ws-release'),
  };
};

describe('every sweep request carries the generation it was judged under (spec §5.5)', () => {
  it('a value, or absent, as the entry was sighted', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    f.plant('demo-b', f.finishedRun().id, null);
    await f.pass();
    f.next(); await f.pass();
    f.next(); await f.pass();
    expect(f.requests.map((q) => [q.sessionId, q.licenceGeneration])).toEqual([
      ['demo-a', { kind: 'value', v: G1 }],
      ['demo-b', { kind: 'absent' }],
    ]);
  });
});

describe('the generation is the entry’s third key (spec §5.5, §5.6)', () => {
  it('a generation that moves under the same birth and the same marker run is a NEW workspace: sighted afresh', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    await f.pass();
    expect(f.entryOf('demo-a')?.generation).toEqual({ kind: 'value', v: G1 });
    f.setGeneration('demo-a', G2);                               // a same-run re-mint, its create not yet placed
    f.next(); await f.pass();
    expect(f.requests, 'the old sighting does not count for the new generation').toEqual([]);
    expect(f.entryOf('demo-a')?.generation).toEqual({ kind: 'value', v: G2 });
    f.next(); await f.pass();
    expect(f.requests.map((q) => q.licenceGeneration)).toEqual([{ kind: 'value', v: G2 }]);
  });

  it('a value that goes absent is a new workspace too', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    await f.pass();
    f.setGeneration('demo-a', null);
    f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();
    expect(f.requests.map((q) => q.licenceGeneration)).toEqual([{ kind: 'absent' }]);
  });
});

describe('an unreadable generation is identity-unmeasured, and seeds nothing (spec §5.5)', () => {
  it('the verdict is the doubt word, the entry is dropped, and two fresh passes follow once it reads again', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    await f.pass();
    expect(f.entryOf('demo-a')).toBeDefined();
    f.setGeneration('demo-a', `${G1}\n`);                        // 37 bytes: ccd's own read refuses it too
    f.next(); await f.pass();
    expect(f.verdictOf('demo-a')).toEqual({ eligible: false, why: 'identity-unmeasured' });
    expect(f.entryOf('demo-a'), 'the entry is dropped').toBeUndefined();
    f.next(); await f.pass();
    expect(f.entryOf('demo-a'), 'and never seeded while it reads unreadable').toBeUndefined();
    expect(f.requests).toEqual([]);
    f.setGeneration('demo-a', G1);
    f.next(); await f.pass();
    expect(f.requests, 'a first sighting again').toEqual([]);
    f.next(); await f.pass();
    expect(f.requests.map((q) => q.licenceGeneration)).toEqual([{ kind: 'value', v: G1 }]);
  });

  it('it drops the hold-retired memory: a retired hold is released only after two fresh sightings', async () => {
    const f = fixture();
    const r = f.finishedRun();
    f.plant('demo-a', r.id, G1, { hold: holdReason(r.program, 2, null, null) });
    await f.pass();                                              // the 1st hold-retired sighting
    expect(f.verdictOf('demo-a')).toMatchObject({ eligible: false, why: 'hold-retired' });
    f.setGeneration('demo-a', `${G1}\n`);
    f.next(); await f.pass();                                    // identity-unmeasured: the memory is dropped
    expect(f.releases()).toEqual([]);
    f.setGeneration('demo-a', G1);
    f.next(); await f.pass();                                    // hold-retired again: a FRESH 1st sighting
    expect(f.releases(), 'queued on one sighting after an unreadable pass').toEqual([]);
    f.next(); await f.pass();                                    // its 2nd: only now
    expect(f.releases()).toHaveLength(1);
  });
});

describe('a rejecting generation read is that row’s doubt, never the pass’s failure (spec §5.5, H5)', () => {
  it('the row reads identity-unmeasured and seeds nothing; the other rows proceed, and the pass resolves', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    f.plant('demo-b', f.finishedRun().id, G1);
    f.reject('demo-a');
    await expect(f.pass()).resolves.toBeUndefined();
    expect(f.verdictOf('demo-a')).toEqual({ eligible: false, why: 'identity-unmeasured' });
    expect(f.entryOf('demo-a'), 'a rejection seeds no entry').toBeUndefined();
    expect(f.entryOf('demo-b')?.generation).toEqual({ kind: 'value', v: G1 });
    f.next(); await f.pass();
    expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-b']);
  });
});

describe('the reads are gathered before the loop, so the loop stays synchronous (spec §5.5, §5.7)', () => {
  it('one read per MARKED row per pass, all issued before any settles; an unmarked row and a throttled pass read nothing', async () => {
    const f = fixture();
    for (const id of ['demo-a', 'demo-b', 'demo-c']) f.plant(id, f.finishedRun().id, G1);
    f.plant('demo-d', null, G1);                                 // a row with no child marker
    await f.pass();
    expect([...f.genReads].sort()).toEqual(['demo-a.generation', 'demo-b.generation', 'demo-c.generation']);
    expect(f.maxInFlight(), 'gathered concurrently, never one after another').toBe(3);
    await f.pass();                                              // inside the interval: throttled
    expect(f.genReads).toHaveLength(3);
  });

  it('the pass awaits twice: the gather, after the throttle and before the decision clock and every loop, and the acts at its end', () => {
    const src = codeOnly(readFileSync(path.join(srcDir, 'watch.ts'), 'utf8'));
    const start = src.indexOf('  async sweepChildReclaim(');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    const throttle = body.indexOf('this.lastChildReclaimSweep = gate;');
    const gather = body.indexOf('await this.childReclaimGatherGenerations(records)');
    const decisionClock = body.indexOf('const asked = this.childReclaimLaneNow();');
    const loop = body.indexOf('for (const r of records) {');
    const acts = body.indexOf('await Promise.all(acts);');
    expect([throttle, gather, decisionClock, loop, acts].every((i) => i > -1), 'an anchor is gone').toBe(true);
    expect([...body.matchAll(/\bawait\b/g)].map((m) => m.index)).toEqual([gather, acts]);
    expect(throttle).toBeLessThan(gather);
    expect(gather, 'the decision clock is read after the gather').toBeLessThan(decisionClock);
    expect(gather).toBeLessThan(loop);
  });

  it('a tick that lands while a pass gathers is throttled: it reads nothing', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    f.hold();
    const first = f.pass();
    await vi.waitFor(() => expect(f.heldCount()).toBe(1));
    f.unhold();
    await f.pass();                                              // the same instant
    expect(f.genReads, 'the second pass gathered nothing').toEqual(['demo-a.generation']);
    f.release(); await first;
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(1);
  });

  it('a pass overtaken while it gathers decides nothing: one interval is never two sightings', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    f.hold();
    const slow = f.pass();                                       // pass A: its gather held
    await vi.waitFor(() => expect(f.heldCount()).toBe(1));
    f.unhold();
    f.next(); await f.pass();                                    // pass B, an interval later: the first sighting
    const sighted = f.entryOf('demo-a');
    expect(sighted).toBeDefined();
    f.release(); await slow;                                     // A's gather settles after B's loop
    expect(f.requests, 'A decided nothing: its loop would have been a second sighting').toEqual([]);
    expect(f.entryOf('demo-a'), 'B’s entry stands untouched').toBe(sighted);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(1);
  });

  it('a pass that decides re-stamps the throttle: a gather that settles just short of an interval delays the next pass', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    f.hold();
    const a = f.pass();                                          // pass A: the throttle stamped at the original instant
    await vi.waitFor(() => expect(f.heldCount()).toBe(1));
    f.unhold();
    f.advance(CHILD_RECLAIM_SWEEP_MS - 100);                     // A's gather holds for most of an interval
    f.release(); await a;                                        // not overtaken: A decides, the first sighting
    expect(f.entryOf('demo-a')).toBeDefined();
    f.advance(101);                                              // just past the ORIGINAL stamp + one interval
    await f.pass();                                              // pass B: 101 ms after A decided
    expect(f.genReads, 'B is throttled: it gathered nothing').toEqual(['demo-a.generation']);
    expect(f.requests, 'B is no second sighting: A decided less than an interval ago').toEqual([]);
    f.next(); await f.pass();                                    // a whole interval after A's decision
    expect(f.requests).toHaveLength(1);
  });

  it('the decision clock is read after the gather: a first sighting is stamped when it is decided', async () => {
    const f = fixture();
    f.plant('demo-a', f.finishedRun().id, G1);
    f.hold();
    const a = f.pass();
    await vi.waitFor(() => expect(f.heldCount()).toBe(1));
    f.unhold();
    const gated = f.mono();
    f.advance(30_000);                                           // the gather takes half an interval
    f.release(); await a;
    expect(f.mono()).toBe(gated + 30_000);
    expect(f.entryOf('demo-a')?.firstEligibleAt, 'stamped with the clock after the gather, never the gate’s')
      .toBe(f.mono());
  });
});
