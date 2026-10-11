// Child reclamation, wave 8: the birth (spec §5.1) is the opening `create` of the workspace's current
// generation, and a `purge` that follows it makes it unplaced (spec §5.6: slugs recycle). The row's OWN
// purge never does: ccd journals `purge done` BEFORE it unlinks the row, so a purge that died mid-way,
// or answered rc 3, leaves the same generation's row listed with its own purge after its own create.
// ONE store read (`lifecycleBirthEventsFor`), ONE placement (`childReclaimBornAt`). There are FOUR
// consumers that hand it the uuid of the row each one read: the sweep, the executor's step 2a, close,
// and the hold-release job's step 5. An unplaced birth with an earlier claim reads "coordinated" at
// the last three; each of them declines (the sweep shows its doubt word first). This file pins that
// residual so it cannot widen.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SessionRecord } from '../src/registry.js';
import { CoordStore, type LifecycleBirthEvent } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { closeRun, type CloseRunDeps } from '../src/coord/close.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, childReclaimBornAt, childReclaimGeneration, childReclaimRowUuid, reclaimChild,
  releaseRetiredChildHold, type ChildReclaimDeps, type ChildReclaimOutcome, type ChildReclaimReleaseRequest,
  type ChildReclaimRequest,
} from '../src/coord/childReclaim.js';
import { CHILD_RECLAIM_SKIP } from '../src/childReclaimSweep.js';
import { CHILD_BIRTH_SKEW_MS } from '../src/coord/childSpent.js';
import { ACTOR_FLAGS_CAP, RECLAIM_CAP } from '../src/ccdargv.js';
import { LIFECYCLE_ACTS, holdReason, type MirroredLifecycleEvent } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { laneFixture, type Lane } from './childReclaimGenerationFixture.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const T0 = 1_790_000_000_000;
const NOW = T0 + 60_000;
const GEN = '1790000000000000000';
const ID = 'demo-a';
const ROW_UUID = 'u-demo-a';
const OLD_UUID = 'u-demo-a-old';
const S = CHILD_BIRTH_SKEW_MS;

let uidN = 0;
/** One ccd journal line for `id`, mirrored. `meas` is the line's own `meas` object: `_reg_purge` writes `uuid`. */
const mirror = (coord: CoordStore, id: string, act: string, outcome: string, at: number | null,
  meas?: Record<string, unknown>): void => {
  uidN += 1;
  const line = JSON.stringify({ uid: `r8b.1.${uidN}`, ...(at === null ? {} : { at }), act, outcome, id,
    ...(meas === undefined ? {} : { meas }) });
  coord.ingestJournal({ gen: GEN, rows: [parseJournalLine(line)], cursor: uidN * 200, size: uidN * 200, at: at ?? T0 });
};
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-birth-rm-'), '.ccrc', 'coord.db')));

describe('CoordStore.lifecycleBirthEventsFor — the birth read', () => {
  it('returns the done create and purge rows of one session, in mirror id order, each with its meas.uuid', () => {
    const s = store();
    mirror(s, ID, 'create', 'intent', T0);
    mirror(s, ID, 'create', 'done', T0 + 1, { uuid: ROW_UUID });
    mirror(s, ID, 'reclaim', 'done', T0 + 2);
    mirror(s, ID, 'destroy', 'done', T0 + 3);
    mirror(s, ID, 'purge', 'refused', T0 + 4, { uuid: ROW_UUID });
    mirror(s, ID, 'purge', 'done', T0 + 5, { uuid: ROW_UUID });
    mirror(s, 'demo-b', 'purge', 'done', T0 + 6, { uuid: 'u-demo-b' });
    mirror(s, ID, 'purge', 'done', null);
    const got = s.lifecycleBirthEventsFor(ID);
    expect(got.map(({ act, at, uuid }) => ({ act, at, uuid }))).toEqual([
      { act: 'create', at: T0 + 1, uuid: ROW_UUID },
      { act: 'purge', at: T0 + 5, uuid: ROW_UUID },
      { act: 'purge', at: null, uuid: null },
    ]);
    expect(got[0]!.id).toBeLessThan(got[1]!.id);
    expect(got[1]!.id).toBeLessThan(got[2]!.id);
  });

  it('collect is excluded by construction: a later collect done is not read and does not unplace the birth', () => {
    expect(LIFECYCLE_ACTS as readonly string[], 'wave 7\'s collect act is on this branch')
      .toContain('collect');
    const s = store();
    mirror(s, ID, 'create', 'done', T0, { uuid: ROW_UUID });
    mirror(s, ID, 'collect', 'done', T0 + 1);
    expect(s.lifecycleBirthEventsFor(ID).map((e) => e.act)).toEqual(['create']);
    expect(childReclaimBornAt(s, ID, NOW, ROW_UUID)).toBe(T0);
  });

  it('seeks through lifecycle_by_session: the hint is in the text it runs, and the plan never scans', () => {
    expect(CoordStore.LIFECYCLE_BIRTH_EVENTS_SQL).toContain('INDEXED BY lifecycle_by_session');
    const s = store();
    const plan = (s.db.prepare(`EXPLAIN QUERY PLAN ${CoordStore.LIFECYCLE_BIRTH_EVENTS_SQL}`)
      .all(ID, 'create', 'purge', 'done') as { detail: string }[]).map((r) => r.detail).join(' | ');
    expect(plan).toContain('lifecycle_by_session');
    expect(plan).not.toContain('SCAN lifecycle_events');
  });

  it('lifecycleCreatesFor is unchanged for the attention list: every create row of every outcome, and no purge', () => {
    const s = store();
    mirror(s, ID, 'create', 'intent', T0);
    mirror(s, ID, 'create', 'done', T0 + 1);
    mirror(s, ID, 'purge', 'done', T0 + 2, { uuid: ROW_UUID });
    expect(s.lifecycleCreatesFor(ID).map((e) => `${e.act}:${e.outcome}`)).toEqual(['create:intent', 'create:done']);
  });
});

describe('childReclaimRowUuid — the listed row\'s uuid, as the own-purge test reads it', () => {
  it('the measured uuid; null when the uuid itself was unmeasured; another field\'s doubt does not touch it', () => {
    const rec = (uuid: string, unmeasured: SessionRecord['unmeasured']) => ({ uuid, unmeasured });
    expect(childReclaimRowUuid(rec(ROW_UUID, []))).toBe(ROW_UUID);
    expect(childReclaimRowUuid(rec('', ['uuid']))).toBeNull();
    expect(childReclaimRowUuid(rec(ROW_UUID, ['wrapper', 'workdir']))).toBe(ROW_UUID);
  });
});

/** A store answering the birth read with `rows`, in the order given, so a case can hand them over out of id order. */
const fake = (rows: readonly LifecycleBirthEvent[]) => ({ lifecycleBirthEventsFor: () => rows });
const c = (id: number, at: number | null): LifecycleBirthEvent => ({ id, act: 'create', at, uuid: null });
const p = (id: number, at: number | null, uuid: string | null): LifecycleBirthEvent => ({ id, act: 'purge', at, uuid });

const TABLE: readonly (readonly [string, readonly LifecycleBirthEvent[], string | null, number | null])[] = [
  ['no rows: nothing to place', [], ROW_UUID, null],
  ['one placed create is the birth', [c(1, T0)], ROW_UUID, T0],
  ['a clockless create places nothing', [c(1, null)], ROW_UUID, null],
  ['a create ahead of the server clock places nothing', [c(1, NOW + 1)], ROW_UUID, null],
  ['a purge of ANOTHER uuid after the create unplaces it', [c(1, T0), p(2, T0 + 5, OLD_UUID)], ROW_UUID, null],
  ['the row\'s OWN purge never unplaces it', [c(1, T0), p(2, T0 + 5, ROW_UUID)], ROW_UUID, T0],
  ['a purge with no meas.uuid counts', [c(1, T0), p(2, T0 + 5, null)], ROW_UUID, null],
  ['an unmeasured row uuid makes every purge count, its own included', [c(1, T0), p(2, T0 + 5, ROW_UUID)], null, null],
  ['an unmeasured row uuid and a purge with no uuid are never "the same"', [c(1, T0), p(2, T0 + 5, null)], null, null],
  ['an earlier generation\'s purge, below the opening create by id, does not follow it',
    [c(1, T0), p(2, T0 + 5, OLD_UUID), c(3, T0 + 5)], ROW_UUID, T0 + 5],
  ['a purge ccd\'s own clock places before the create does not follow it, whatever its id',
    [c(1, T0 + 10), p(2, T0 + 5, OLD_UUID)], ROW_UUID, T0 + 10],
  ['a purge at the create\'s own instant follows it', [c(1, T0), p(2, T0, OLD_UUID)], ROW_UUID, null],
  ['a purge with a null at follows it', [c(1, T0), p(2, null, OLD_UUID)], ROW_UUID, null],
  ['the recycled-slug window: the new create is ahead of the server clock, so the old purge follows the old create',
    [c(1, T0), p(2, T0 + 5, OLD_UUID), c(3, NOW + 1)], ROW_UUID, null],
  ['the mirror id picks the opening create, never the array order',
    [c(3, T0 + 10), p(2, T0 + 5, OLD_UUID), c(1, T0)], ROW_UUID, T0 + 10],
];

describe('childReclaimBornAt — the opening create, unless a purge that is not the row\'s own follows it', () => {
  it.each(TABLE)('%s', (_name, rows, rowUuid, want) => {
    expect(childReclaimBornAt(fake(rows), ID, NOW, rowUuid)).toBe(want);
  });

  it('a clock that reads NaN places no birth', () => {
    expect(childReclaimBornAt(fake([c(1, T0)]), ID, Number.NaN, ROW_UUID)).toBeNull();
  });

  it('with no purge, the opening create is childReclaimGeneration\'s over the same creates — one placement', () => {
    const asMirrored = (e: LifecycleBirthEvent): MirroredLifecycleEvent => ({
      uid: `eq.${e.id}`, at: e.at, act: 'create', badact: null, outcome: 'done', badoutcome: null, id: ID, tx: null,
      verb: 'ws-add', refusal: null, detail: null, truncated: false, obs: null, dec: null, meas: null, raw: '', gen: '1',
      ingestedAt: T0,
    });
    const lists: readonly LifecycleBirthEvent[][] = [
      [], [c(1, T0)], [c(1, null)], [c(1, T0), c(2, T0 + 10)], [c(1, T0), c(2, null)], [c(1, T0), c(2, NOW + 1)],
      [c(1, T0 + 10), c(2, T0)], [c(1, null), c(2, T0), c(3, NOW + 5), c(4, T0 + 3)],
    ];
    for (const rows of lists) {
      expect(childReclaimBornAt(fake(rows), ID, NOW, ROW_UUID), JSON.stringify(rows))
        .toBe(childReclaimGeneration(rows.map(asMirrored), NOW)[0]?.at ?? null);
    }
  });
});

// ── the four consumers ───────────────────────────────────────────────────────

/** What the consumer timeline drives: the store, a wall clock to move, and a journal line mirrored at that
 *  clock. The sweep's rig is the shared `laneFixture`. The other three consumers call their unit
 *  directly, over `clockRig`. */
type Rig = Pick<Lane, 'coord' | 'advance' | 'journal'>;
const clockRig = (coord: CoordStore): Rig => {
  let t = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => t);
  return {
    coord,
    advance: (ms) => { t += ms; },
    journal: (id, act, outcome, over = {}) =>
      mirror(coord, id, act, outcome, t, over['meas'] as Record<string, unknown> | undefined),
  };
};

/** The registry row `ws-add` writes, `uuid` = ROW_UUID, plus `extra`. */
const writeRow = (reg: string, extra: Record<string, string>): void => {
  const fields: Record<string, string> = { uuid: ROW_UUID, wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`,
    workspace: 'a', branch: `ws/${ID}`, base: 'origin/main', started: '1', ...extra };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
};
/** A run of `program`, opened and abandoned now; its id. */
const finished = (coord: CoordStore, program: string, claimedBy = 'demo-coord'): number => {
  const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy });
  if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
  const closed = coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null,
    program, viaClosing: false });
  if (!closed.ok) throw new Error(`abandon refused: ${JSON.stringify(closed)}`);
  return r.id;
};
/** THE CONSUMER TIMELINE. Both rigs start their wall clock at T0.
 *  - At T0, a run `ID` coordinated closes: an EARLIER claim.
 *  - Ten skews later, ws-add's `create done` is mirrored.
 *  - A second after that, a `purge done` carrying `purgeUuid` is mirrored.
 *  With the row's own uuid, that purge is the row's unfinished purge. The birth stands ten skews after the
 *  claim, so the claim belongs to an earlier generation. With another uuid, the birth is unplaced and the
 *  old claim reads "coordinated". */
const timeline = (rig: Rig, purgeUuid: string): void => {
  finished(rig.coord, 'birth-rm-claim', ID);
  rig.advance(10 * S);
  rig.journal(ID, 'create', 'done', { meas: { uuid: ROW_UUID } });
  rig.advance(1_000);
  rig.journal(ID, 'purge', 'done', { meas: { uuid: purgeUuid } });
};

describe('the sweep hands the birth its row\'s uuid', () => {
  /** The ONE lane rig, with the executor stubbed through its additive `exec`. Its `plant` is not
   *  used: it journals a `create`, which would place the birth again after the purge. */
  const sweep = async (purgeUuid: string) => {
    const f = laneFixture({
      exec: (req) => ({ kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 }),
    });
    timeline(f, purgeUuid);
    const minted = finished(f.coord, 'birth-rm-sweep');
    writeRow(f.reg, { child: String(minted) });
    await f.pass();
    const verdict = f.watcher.currentChildReclaimVerdicts()?.get(ID);
    f.next();
    await f.pass();
    return { verdict, requests: f.requests, minted };
  };

  it('the sweep: the row\'s own purge leaves the birth placed, and the second pass asks', async () => {
    const r = await sweep(ROW_UUID);
    expect(r.verdict).toMatchObject({ eligible: true, runId: r.minted });
    expect(r.requests.map((q) => q.sessionId)).toEqual([ID]);
  });

  it('the sweep: another uuid\'s purge is doubt, child-birth-unplaced — never coordinating — and nothing is asked', async () => {
    const r = await sweep(OLD_UUID);
    expect(r.verdict).toMatchObject({ eligible: false, why: 'child-birth-unplaced' });
    expect(r.requests).toEqual([]);
  });
});

describe('child-birth-unplaced says both of its causes (spec §5.1, §5.6)', () => {
  it('names a missing dated creation AND a removal after it, never the first alone, and still ends on the next pass', () => {
    const s = CHILD_RECLAIM_SKIP['child-birth-unplaced'].sentence;
    expect(s).toContain('holds no dated creation of this workspace, or a removal journaled after its creation');
    expect(s).toContain('has not yet seen replaced by a newer creation');
    expect(s).not.toContain('holds no dated creation of this workspace, so');
    expect(s.endsWith('on its next pass.')).toBe(true);
  });
});

describe('the executor\'s step 2a hands the birth the row it read', () => {
  /** The pause is raised, so step 2b answers whatever step 2a lets through. That happens before presence,
   *  the generation re-read and any argv. */
  const exec = async (purgeUuid: string): Promise<ChildReclaimOutcome> => {
    const home = mkTmp('ccrc-birth-rm-exec-');
    const base = testDeps(home, async () => ({ code: 1, stdout: '', stderr: '' }));
    const reg = base.cfg.registryDir;
    mkdirSync(reg, { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    timeline(clockRig(coord), purgeUuid);
    const minted = finished(coord, 'birth-rm-exec');
    writeRow(reg, { child: String(minted) });
    writeFileSync(path.join(reg, RECLAIM_PAUSE_MARKER), '');
    const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
      fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
        ccdVerbs: ['ws-audit', 'ws-reclaim', RECLAIM_CAP, ACTOR_FLAGS_CAP] } };
    return reclaimChild(deps, { sessionId: ID, runId: minted, trigger: 'sweep', deferExpired: false,
      deferredSinceMs: null, feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: { kind: 'absent' } });
  };

  it('the executor: the row\'s own purge passes step 2a — the raised switch answers', async () => {
    expect(await exec(ROW_UUID)).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
  });

  it('the executor: another uuid\'s purge plus an earlier claim defers siblings-open, has coordinated (the residual)', async () => {
    expect(await exec(OLD_UUID)).toMatchObject({ kind: 'deferred', why: 'siblings-open',
      detail: `${ID} has coordinated run(s)` });
  });
});

describe('the hold-release job\'s step 5 hands the birth the row its step 1 read', () => {
  const release = async (purgeUuid: string) => {
    const home = mkTmp('ccrc-birth-rm-release-');
    const calls: string[][] = [];
    const base = testDeps(home, async (_cmd, args) => {
      calls.push(args);
      return args[0] === 'ws-release' ? { code: 0, stdout: `released ${ID}\n`, stderr: '' } : { code: 1, stdout: '', stderr: '' };
    });
    const reg = base.cfg.registryDir;
    mkdirSync(reg, { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    timeline(clockRig(coord), purgeUuid);
    const minted = finished(coord, 'birth-rm-held');
    const reason = holdReason('birth-rm-held', 2, null, null);
    writeRow(reg, { child: String(minted), hold: reason });
    const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
      fleetState: { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: ['ws-release', ACTOR_FLAGS_CAP] } };
    const req: ChildReclaimReleaseRequest = { sessionId: ID, runId: minted, reason, program: 'birth-rm-held',
      accountedRunId: minted, generation: { kind: 'absent' } };
    return { out: await releaseRetiredChildHold(deps, req), calls };
  };

  it('the release job: the row\'s own purge passes step 5, and ws-release runs', async () => {
    const r = await release(ROW_UUID);
    expect(r.out).toBe('released');
    expect(r.calls.map((a) => a[0])).toEqual(['ws-release']);
  });

  it('the release job: another uuid\'s purge plus an earlier claim answers changed and composes nothing (the residual)', async () => {
    const r = await release(OLD_UUID);
    expect(r.out).toBe('changed');
    expect(r.calls).toEqual([]);
  });
});

describe('close hands the birth the row its mark read read', () => {
  const close = async (purgeUuid: string) => {
    const home = mkTmp('ccrc-birth-rm-close-');
    const base = testDeps(home, async () => ({ code: 0, stdout: '', stderr: '' }));
    const reg = base.cfg.registryDir;
    mkdirSync(reg, { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const handed: ChildReclaimRequest[] = [];
    const deps: CloseRunDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
      childReclaim: (req: ChildReclaimRequest) => { handed.push(req); } };
    timeline(clockRig(coord), purgeUuid);
    const r = coord.openRun({ program: 'birth-rm-close', title: 't', project: 'demo', wave: 1, waveOf: 3,
      claimedBy: 'demo-coordinator' });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatched(r.id, ID, ID, `ws/${ID}`, false);
    expect(coord.advance(r.id, 'dispatched', 'test').ok).toBe(true);
    writeRow(reg, { child: String(r.id) });
    return { out: await closeRun(deps, r.id, { intent: 'abandon' }, 'operator'), handed };
  };

  it('close: the row\'s own purge leaves the birth placed, and the close queues the reclaim', async () => {
    const r = await close(ROW_UUID);
    expect(r.out).toMatchObject({ ok: true, childReclaim: 'queued' });
    expect(r.handed.map((q) => q.sessionId)).toEqual([ID]);
  });

  it('close: another uuid\'s purge plus an earlier claim declines has-coordinated — fail-safe, the sweep re-judges (the residual)', async () => {
    const r = await close(OLD_UUID);
    expect(r.out).toMatchObject({ ok: true, childReclaim: 'not-queued', childReclaimWhy: 'has-coordinated' });
    expect(r.handed).toEqual([]);
  });
});
