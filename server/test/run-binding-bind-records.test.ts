// ARCH-60 follow-up (#1407, part of #795): what every bind records about the incarnation it binds to. This file pins, by
// name, what `CoordStore.bindSession` writes for the bound incarnation, and the two gaps #1407 names. Since round 8 of
// #1573 the write is the merge base's, unchanged, and this file is green over the merge base too: it is a census of what
// each bind site records, not a change to it. GAP 2 (a bind over a birth `childBirthOf` cannot place records nothing) is
// an inherited residual since round 8 (a fallback stamp closed it in rounds 6 and 7 and made reviewed shapes worse than
// the merge base; the plan note). GAP 1 (unplaceable) is an inherited residual since round 5 (the readers keep the merge
// base's id-string rule for every unplaceable worker). Both are pinned at the merge base's answer. The adopted read-back case at the end had its read half red on an earlier
// round of this PR (the first anchor, which borrowed an earlier occupant's birth); the rollback case was red on another
// (an anchor to the minting run's own birth). Both are green on the merge base and after. Every shape the reviews
// reported, with both answers, is in run-binding-probe-corpus.test.ts.
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { bindingOf, bornIncarnation, childParentOf, claimantsOf, incarnationOf, parentOf, unbornIncarnation } from '../src/coord/runBinding.js';
import { childBirthOf } from '../src/coord/childSpent.js';
import { incarnationsOfSessions, sessionRunRead, withChildIds } from '../src/coord/runWire.js';
import { REPO_ROOT, callsIn, parsedFile, sqlStatementsInFile, symbolOf } from './scan/symbols.js';
import { mkTmp } from './tmpHelpers.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { clearSender } from '../src/inject/send.js';
import type { CcdResult } from '../src/lifecycle.js';
import { UNMEASURED } from '../src/exec.js';
import type { CcdArgv } from '../src/ccdargv.js';
import { configDirFor, type CcrcConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { testDeps } from './helpers.js';

const STORE = 'server/src/coord/store.ts';
const OLD = 1_700_000_000_000;
const BORN = OLD + 5_000_000;
const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-bind-records-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, program: string, claimedBy: string, openedAt: number): number => {
  const id = (s.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
  s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(openedAt, id);
  return id;
};
const born = (s: CoordStore, id: number) => s.db.prepare('SELECT sessionBornAt, sessionBornFor FROM runs WHERE id = ?').get(id);
const series = (s: CoordStore, session: string) => {
  const r = s.bindingRunsOf(session);
  if (!r.ok) throw new Error(r.detail);
  return r.runs;
};

describe('the bound incarnation has one writer (ARCH-60 follow-up, #1407)', () => {
  // The statements of the store that SET a non-null birth from a bind: the explicit stamp in bindSession and the
  // occupant stamp. `clearSession` and the backfill write NULL or seed it, and are not binds.
  const setsBirth = (set: string | null): boolean => /sessionBornAt\s*=\s*(\?|b\.at)/.test(set ?? '');
  it('exactly the bind and the occupant stamp write a birth, and bindSession reaches the occupant stamp', () => {
    const writers = sqlStatementsInFile(STORE).filter((st) => st.verb === 'UPDATE' && st.table === 'runs' && setsBirth(st.set));
    const holders = writers.map((st) => [symbolOf(STORE, 'CoordStore.bindSession'), symbolOf(STORE, 'CoordStore.stampOccupantBirth')]
      .find((sym) => st.start >= sym.start && st.end <= sym.end)?.name);
    expect(holders.sort()).toEqual(['CoordStore.bindSession', 'CoordStore.stampOccupantBirth']);
    expect(callsIn(symbolOf(STORE, 'CoordStore.bindSession')).map((c) => c.callee)).toContain('this.stampOccupantBirth');
  });
});

describe('a bind with no placeable birth still records an incarnation (the gaps of #1407)', () => {
  it('GAP 2, inherited residual: a wave bound to a live worker whose minting run cannot be placed records no birth, as on the merge base', () => {
    const s = store();
    const w1 = open(s, 'prog-a', 'coord-1', BORN - 1000);
    // The minting run recorded a birth but its dispatchStartedAt does not agree, so `childBirthOf` cannot place it.
    s.setSession(w1, 'demo-w', BORN);
    const w2 = open(s, 'prog-b', 'coord-1', BORN - 1000);
    s.setSession(w2, 'demo-w');
    // The follow-up owns this: the stamp writes placeable births only, so wave 2 is undecided once the worker is placed.
    expect(born(s, w2)).toEqual({ sessionBornAt: null, sessionBornFor: null });
    const binding = bindingOf(series(s, 'demo-w'), bornIncarnation('demo-w', BORN));
    expect(binding.undecided.map((r) => r.id)).toEqual([w2]);
    expect(binding.newest?.id).toBe(w1);
  });

  it('GAP 1 (unplaceable), inherited residual: an unplaceable worker keeps the id-string rule, so an earlier occupant\'s open run is still its parent, as on the merge base', () => {
    const s = store();
    const ghost = open(s, 'prog-old', 'coord-gone', OLD);
    s.setSession(ghost, 'demo-w', OLD);
    const live = open(s, 'prog-new', 'coord-live', BORN + 1000);
    s.setSession(live, 'demo-w', BORN);
    s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(live);
    const incarnation = incarnationOf('demo-w', childBirthOf(s.run(live), 'demo-w'));
    expect(incarnation).toEqual({ kind: 'unborn', sessionId: 'demo-w', why: 'unplaceable' });
    // The follow-up for D6 gap 1 owns this: the answer below is the merge base's, and it is wrong (coord-gone).
    const binding = bindingOf(series(s, 'demo-w'), incarnation);
    expect(binding.open?.id).toBe(ghost);
    expect(parentOf(binding)).toBe('coord-gone');
    expect(binding.newest?.id).toBe(live);
  });

  it('GAP 1 (not-a-child), residual: a session that never had a recorded birth keeps the id-string rule (#1532)', () => {
    const s = store();
    const manual = open(s, 'prog-m', 'coord-1', OLD);
    s.setSession(manual, 'manual-ws');
    const binding = bindingOf(series(s, 'manual-ws'), unbornIncarnation('manual-ws', 'not-a-child'));
    expect(binding.open?.id).toBe(manual);
    expect(parentOf(binding)).toBe('coord-1');
  });
});

// A cross-build rollback with a same-id redraw (review of #1573, round 4). The stamp writes the NEWEST placeable birth on
// record for the id; an anchor to the birth the worker's own minting run recorded would differ from it, drop the live occupant's own
// new-build wave and make a dead coordinator's wave the parent. Since round 5 no reader anchors an unplaceable worker. The
// reviewer's probe, pinned: red on the round-4 anchor (childParentOf and claimantsOf answered coord-gone), green at the
// merge base and after.
describe('a cross-build rollback with a same-id redraw (#1573 round 4)', () => {
  it('a worker whose minting run kept an OLDER birth than one on record reads by the id-string rule, so its new-build wave is its parent', () => {
    const s = store();
    const W = 'demo-w';
    const T1 = BORN;
    const TX = BORN + 2000;
    const T4 = BORN + 4000;
    // R mints occupant A at T1 (a placeable fresh spawn).
    const r = open(s, 'prog-r', 'coord-live', T1 - 100);
    s.markDispatchStarted(r, T1);
    s.setSession(r, W, T1);
    // A's later wave WA is stamped T1 and left open by a coordinator that is now gone.
    const wa = open(s, 'prog-wa', 'coord-gone', T1 + 100);
    s.setSession(wa, W);
    expect(born(s, wa)).toEqual({ sessionBornAt: T1, sessionBornFor: W });
    // Rx re-mints the same id as occupant D at TX, and closes.
    const rx = open(s, 'prog-rx', 'coord-x', TX - 100);
    s.markDispatchStarted(rx, TX);
    s.setSession(rx, W, TX);
    s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(rx);
    // An OLDER build redraws occupant C on R: R keeps its birth T1 for W and only its dispatchStartedAt moves. R closes.
    s.db.prepare("UPDATE runs SET dispatchStartedAt = ?, state = 'done' WHERE id = ?").run(T4, r);
    // This build binds C's wave W2 (two-arg): the stamp writes the newest placeable birth on record, TX (Rx's).
    const w2 = open(s, 'prog-w2', 'coord-live', T4 + 100);
    s.setSession(w2, W);
    expect(born(s, w2)).toEqual({ sessionBornAt: TX, sessionBornFor: W });
    const incarnation = incarnationOf(W, childBirthOf(s.run(r), W));
    expect(incarnation).toMatchObject({ kind: 'unborn', why: 'unplaceable' });
    const runs = series(s, W);
    expect(childParentOf(runs, 'coord-live', incarnation)).toBe('coord-live');
    expect(claimantsOf(runs, incarnation)[0]).toBe('coord-live');
    const viaMark = incarnationsOfSessions(s, [{ id: W, child: { kind: 'child', runId: r } }]).get(W)!;
    expect(sessionRunRead(s, W, viaMark)).toMatchObject({ ok: true, openRun: { id: w2, claimedBy: 'coord-live' } });
    const [summary] = withChildIds(s, [{ id: w2, claimedBy: 'coord-live' }] as never, new Map([[W, viaMark]]), () => undefined);
    expect(summary!.childIds).toContain(w2);
  });
});

// THE CENSUS (ARCH-60 follow-up, #1407, counted exit). SEMANTIC, not syntactic: every call of `bindSession`/`setSession`/
// `markDispatched` in the server is found by symbol, and every one of them is DRIVEN, through the path that reaches it,
// over two fixtures: a worker whose birth on record `childBirthOf` places, and one whose only birth on record it cannot
// place (its minting run's `dispatchStartedAt` does not agree). What the bind then writes on the run it binds is the
// census. A bind that records the birth it binds to is `records`; one that leaves the run with no birth is
// `records-nothing`. The records-nothing lists are NAMED allow-lists. Over a placeable birth: one arm, the adopted arm of
// `spawnFresh` (D-6993, child-reclamation spec section 5.1: no birth on record for an adopted id is provably its own).
// Over an unplaceable birth: every arm but the fresh spawn, which records its own (gap 2, a residual: the stamp writes
// placeable births only, the merge base's rule). A caller this table has no driver for reds the first case, so a new bind
// site cannot go uncounted. Measured: this file gives the same census over the merge base (865e1833b) and this branch.
describe('every bind site records an incarnation, or is named (ARCH-60 follow-up, #1407)', () => {
  const SRC = 'server/src';
  const WORKER = 'demo-w';
  const ADOPTED = 'demo-quiet-basin';
  const CLAIMANT = 'demo-coordinator';
  const walk = (dir: string): string[] => readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []));
  const innermost = (file: string, at: number): string => {
    const spans = parsedFile(file).symbols.filter((sy) => sy.start <= at && at < sy.end).sort((a, b) => (a.end - a.start) - (b.end - b.start));
    return spans[0]?.name ?? '(top level)';
  };
  const sites = (): string[] => walk(SRC).flatMap((file) =>
    parsedFile(file).calls.filter((c) => c.name !== null && ['bindSession', 'setSession', 'markDispatched'].includes(c.name))
      .map((c) => `${file.slice(SRC.length + 1)}#${innermost(file, c.start)} ${c.name}`));

  type Born = { sessionBornAt: number | null; sessionBornFor: string | null };
  type OnRecord = 'placeable' | 'unplaceable';
  /** The fixture: an earlier run (done) recorded a birth for `session`, which `childBirthOf` places or cannot place. */
  const birthOnRecord = (s: CoordStore, session: string, kind: OnRecord): void => {
    const minting = open(s, 'prog-minting', CLAIMANT, BORN - 1000);
    if (kind === 'placeable') s.markDispatchStarted(minting, BORN);
    s.setSession(minting, session, BORN);
    s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(minting);
  };
  const plannedWave = (s: CoordStore): number => open(s, 'prog-wave', CLAIMANT, BORN + 10);
  const storeArm = (bind: (s: CoordStore, id: number) => void) => async (kind: OnRecord): Promise<Born> => {
    const s = store();
    birthOnRecord(s, WORKER, kind);
    const id = plannedWave(s);
    bind(s, id);
    return born(s, id) as Born;
  };
  const openRoute = async (kind: OnRecord): Promise<Born> => {
    const home = mkTmp('ccrc-bind-census-route-');
    seedRow(home, CLAIMANT);
    const { app, coord } = await appFor(home, recorder().run);
    try {
      birthOnRecord(coord, WORKER, kind);
      const res = await app.inject({ method: 'POST', url: '/api/runs', headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN },
        payload: { program: 'prog-wave', title: 'wave', project: 'demo', wave: 2, waveOf: 3, claimedBy: CLAIMANT,
          claimedByUuid: `u-${CLAIMANT}`, homeProject: 'demo', sessionId: WORKER } });
      expect(res.statusCode, res.body).toBe(200);
      return born(coord, (res.json() as { id: number }).id) as Born;
    } finally { await app.close(); }
  };
  /** `dispatchRun` wave 1 into `spawnFresh`: `ws-add` leaves `ADOPTED`'s row; `adopt` cuts it short, so the arm adopts. */
  const spawnWave1 = async (adopt: boolean, seed: (coord: CoordStore) => void, claimedBy = CLAIMANT): Promise<{ coord: CoordStore; id: number }> => {
    const home = mkTmp('ccrc-bind-census-spawn-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    seed(coord);
    const opened = coord.openRun({ program: 'prog-wave', title: 'wave', project: 'demo', wave: 1, waveOf: 3, claimedBy });
    if (!('id' in opened)) throw new Error(JSON.stringify(opened));
    const runCcd = async (argv: CcdArgv): Promise<CcdResult> => {
      if (argv[0] === 'ws-add') {
        seedRow(home, ADOPTED);
        return adopt ? { ran: true, ok: false, stdout: '', stderr: '', killed: true, signal: UNMEASURED }
          : { ran: true, ok: true, stdout: '', stderr: '', killed: false, signal: null };
      }
      return { ran: true, ok: true, stdout: '', stderr: '', killed: false, signal: null };
    };
    const base = testDeps(home, async () => ({ ran: true, code: 0, stdout: '', stderr: '' }));
    const deps = { ...base, io: localIO, coord, runCcd, fleetState: undefined,
      configDir: (w: string) => configDirFor(base.cfg as CcrcConfig, w), turnVerdict: async () => 'idle' as const,
      sendClear: clearSender(base) } as DispatchRunDeps;
    expect(await dispatchRun(deps, opened.id, 'go', undefined, undefined, undefined)).toMatchObject({ ok: true, adopted: adopt });
    return { coord, id: opened.id };
  };
  const wave1 = (adopt: boolean) => async (kind: OnRecord): Promise<Born> => {
    const { coord, id } = await spawnWave1(adopt, (c) => birthOnRecord(c, ADOPTED, kind));
    return born(coord, id) as Born;
  };

  const records = (b: Born, session: string): boolean => b.sessionBornAt !== null && b.sessionBornFor === session;
  // site -> its arms, each driven over the fixture, with the session the bind names.
  const DRIVERS: Record<string, ReadonlyArray<{ arm: string; session: string; drive: (kind: OnRecord) => Promise<Born> }>> = {
    'coord/routes.ts#registerCoordRoutes.holdAndBindSession setSession': [{ arm: 'open route', session: WORKER, drive: openRoute }],
    'coord/store.ts#CoordStore.markDispatched bindSession': [{ arm: 'markDispatched', session: WORKER,
      drive: storeArm((s, id) => s.markDispatched(id, WORKER, null, null, true)) }],
    'coord/store.ts#CoordStore.dispatchRun markDispatched': [{ arm: 'dispatchRun', session: WORKER,
      drive: storeArm((s, id) => { s.dispatchRun({ runId: id, sessionId: WORKER, workspace: null, branch: null, resumed: true, clearedAt: null, items: [] }); }) }],
    'coord/store.ts#CoordStore.setSession bindSession': [{ arm: 'setSession', session: WORKER,
      drive: storeArm((s, id) => { s.setSession(id, WORKER); }) }],
    'coord/dispatch.ts#spawnFresh setSession': [
      { arm: 'spawnFresh fresh', session: ADOPTED, drive: wave1(false) },
      { arm: 'spawnFresh adopted', session: ADOPTED, drive: wave1(true) },
    ],
  };
  const ARMS = Object.values(DRIVERS).flat();
  const RECORDS_NOTHING: Record<OnRecord, readonly string[]> = {
    placeable: ['spawnFresh adopted'],
    unplaceable: ['open route', 'markDispatched', 'dispatchRun', 'setSession', 'spawnFresh adopted'],
  };
  const CASES = (['placeable', 'unplaceable'] as const).flatMap((kind) => ARMS.map((a) => [`${a.arm}, over a ${kind} birth on record`, a, kind] as const));

  it('every bind site in the server has a driver here, and no driver names a site that is gone', () => {
    expect([...new Set(sites())].sort()).toEqual(Object.keys(DRIVERS).sort());
  });

  it.each(CASES)('%s, records what the census says', async (_n, a, kind) => {
    expect(records(await a.drive(kind), a.session)).toBe(!RECORDS_NOTHING[kind].includes(a.arm));
  });

  it.each(['placeable', 'unplaceable'] as const)('measured, over a %s birth on record: the records-nothing arms are exactly the named allow-list', async (kind) => {
    const nothing: string[] = [];
    for (const a of ARMS) if (!records(await a.drive(kind), a.session)) nothing.push(a.arm);
    expect(nothing).toEqual(RECORDS_NOTHING[kind]);
  });

  // READ BACK, not only what the bind wrote (review of #1573: the census above never read an adopted worker back). D6's
  // ghost parent (D-5920) over the residual arm: an EARLIER occupant of the recycled name was minted (placeable birth
  // OLD_BIRTH) by a run that is still OPEN because its coordinator is gone; a run planned before that mint then
  // dispatches and ADOPTS the name's workspace, recording no birth (D-6993). The adopted worker keeps the id-string rule:
  // its parent is the adopting run's claimant (the newest open run naming it), never the dead coordinator the earlier
  // occupant's birth would date it to. The read half was red on an earlier round of this PR (every unplaceable worker
  // anchored to the newest recorded birth of its id: childParentOf/claimantsOf/sessionRunRead answered coord-gone) and is
  // green on the merge base. The stamp is the merge base's: wave 2 records the earlier occupant's placeable birth
  // (OLD_BIRTH), and while the adopted worker stays unplaceable no reader of it takes a birth from that stamp (round 6 of
  // #1573: a veto on the adopted shape took a placeable worker's birth away from its later waves).
  it('an adopted worker under a recycled name whose earlier occupant\'s run is still open reads the ADOPTING run\'s claimant, and its later wave carries the merge base\'s stamp', async () => {
    const T0 = 1_700_000_000_000;
    const OLD_BIRTH = T0 + 5000;
    let earlier = 0;
    const { coord, id } = await spawnWave1(true, (c) => {
      earlier = open(c, 'prog-old', 'coord-gone', T0);
      c.markDispatchStarted(earlier, OLD_BIRTH);
      c.setSession(earlier, ADOPTED, OLD_BIRTH);
    }, 'coord-live');
    // Planned before the earlier occupant was minted (the reviewer's probe: the adopting run's openedAt < OLD_BIRTH).
    coord.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(T0 + 1000, id);
    expect(born(coord, id)).toEqual({ sessionBornAt: null, sessionBornFor: null });
    expect(coord.run(earlier)).toMatchObject({ ok: true, run: { state: 'planned', sessionId: ADOPTED, sessionBornAt: OLD_BIRTH } });
    const runs = series(coord, ADOPTED);
    const incarnation = incarnationOf(ADOPTED, childBirthOf(coord.run(id), ADOPTED));
    expect(incarnation).toMatchObject({ kind: 'unborn', why: 'unplaceable' });
    expect(childParentOf(runs, 'coord-live', incarnation)).toBe('coord-live');
    // The id-string rule cannot tell the earlier occupant's open run apart (D-6993), so it is still listed, but AFTER the
    // adopting run's claimant, and never alone.
    expect(claimantsOf(runs, incarnation)[0]).toBe('coord-live');
    const viaMark = incarnationsOfSessions(coord, [{ id: ADOPTED, child: { kind: 'child', runId: id } }]).get(ADOPTED)!;
    expect(sessionRunRead(coord, ADOPTED, viaMark)).toMatchObject({ ok: true, openRun: { id, claimedBy: 'coord-live' } });
    // A later wave bound to the adopted worker records the newest placeable birth of the id (the merge base's stamp),
    // and the adopted worker, unplaceable, reads by the id-string rule: the adopting claimant stays the parent.
    const wave2 = open(coord, 'prog-wave-2', 'coord-live', T0 + 9000);
    coord.setSession(wave2, ADOPTED);
    expect(born(coord, wave2)).toEqual({ sessionBornAt: OLD_BIRTH, sessionBornFor: ADOPTED });
    expect(childParentOf(series(coord, ADOPTED), 'coord-live', incarnation)).toBe('coord-live');
  });
});
