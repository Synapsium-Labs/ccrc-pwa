// ARCH-60 follow-up (#1407, part of #795): every bind records the incarnation it binds to. This file pins, by name, what
// `CoordStore.bindSession` writes for the bound incarnation, and the two gaps #1407 names. Red on the pre-fix source
// (d6aae6879: GAP 2, four census arms and the measured allow-list fail) and green after. GAP 1 (unplaceable) is an
// inherited residual since round 5 of #1573 (the readers keep the merge base's id-string rule for every unplaceable
// worker), pinned at the merge base's answer. The adopted read-back case at the end has its read half red at 0d1b8ead5
// (the first anchor, which borrowed an earlier occupant's birth) and its stamp half red on the merge base; the rollback
// case is red at b974fc5e7. All green after. Every shape the reviews reported, with both answers, is in
// run-binding-probe-corpus.test.ts.
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
  it('GAP 2: a wave bound to a live worker whose minting run cannot be placed records the recorded birth and is bound', () => {
    const s = store();
    const w1 = open(s, 'prog-a', 'coord-1', BORN - 1000);
    // The minting run recorded a birth but its dispatchStartedAt does not agree, so `childBirthOf` cannot place it.
    s.setSession(w1, 'demo-w', BORN);
    const w2 = open(s, 'prog-b', 'coord-1', BORN - 1000);
    s.setSession(w2, 'demo-w');
    expect(born(s, w2)).toEqual({ sessionBornAt: BORN, sessionBornFor: 'demo-w' });
    const binding = bindingOf(series(s, 'demo-w'), bornIncarnation('demo-w', BORN));
    expect(binding.undecided).toEqual([]);
    expect(binding.newest?.id).toBe(w2);
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

// A cross-build rollback with a same-id redraw (review of #1573, round 4). The stamp writes the NEWEST birth on record for
// the id; an anchor to the birth the worker's own minting run recorded would differ from it, drop the live occupant's own
// new-build wave and make a dead coordinator's wave the parent. Since round 5 no reader anchors an unplaceable worker. The
// reviewer's probe, pinned: red at b974fc5e7 (childParentOf and claimantsOf answered coord-gone), green at the merge base
// and after.
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
    // This build binds C's wave W2 (two-arg): the stamp writes the newest birth on record, TX.
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
// over the same fixture: a worker whose only birth on record cannot be placed (`childBirthOf` reads it `unplaceable`: its
// minting run's `dispatchStartedAt` does not agree). What the bind then writes on the run it binds is the census. A bind
// that records the birth it binds to is `records`; one that leaves the run with no birth is `records-nothing`. The
// records-nothing list is a NAMED allow-list of one: the adopted arm of `spawnFresh` (D-6993,
// child-reclamation spec section 5.1: no birth on record for an adopted id is provably its own, the fixture's is an
// earlier occupant's). A caller this table has no driver for reds the first case, so a new bind site cannot go uncounted.
// Measured by running this file over the pre-fix source (d6aae6879, the placeable-only stamp): 5 of the 6 driven arms
// recorded nothing (the open route, markDispatched, dispatchRun, the setSession pass-through, the adopted arm; only the
// fresh spawn recorded one); after: 1 (the adopted arm).
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
  /** The fixture: an earlier run (done) recorded a birth for `session` that `childBirthOf` cannot place. */
  const unplaceableOnRecord = (s: CoordStore, session: string): void => {
    const minting = open(s, 'prog-minting', CLAIMANT, BORN - 1000);
    s.setSession(minting, session, BORN);
    s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(minting);
  };
  const plannedWave = (s: CoordStore): number => open(s, 'prog-wave', CLAIMANT, BORN + 10);
  const storeArm = (bind: (s: CoordStore, id: number) => void) => async (): Promise<Born> => {
    const s = store();
    unplaceableOnRecord(s, WORKER);
    const id = plannedWave(s);
    bind(s, id);
    return born(s, id) as Born;
  };
  const openRoute = async (): Promise<Born> => {
    const home = mkTmp('ccrc-bind-census-route-');
    seedRow(home, CLAIMANT);
    const { app, coord } = await appFor(home, recorder().run);
    try {
      unplaceableOnRecord(coord, WORKER);
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
  const wave1 = (adopt: boolean) => async (): Promise<Born> => {
    const { coord, id } = await spawnWave1(adopt, (c) => unplaceableOnRecord(c, ADOPTED));
    return born(coord, id) as Born;
  };

  const records = (b: Born, session: string): boolean => b.sessionBornAt !== null && b.sessionBornFor === session;
  // site -> its arms, each driven over the fixture, with the session the bind names.
  const DRIVERS: Record<string, ReadonlyArray<{ arm: string; session: string; drive: () => Promise<Born> }>> = {
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
  const RECORDS_NOTHING = ['spawnFresh adopted'];

  it('every bind site in the server has a driver here, and no driver names a site that is gone', () => {
    expect([...new Set(sites())].sort()).toEqual(Object.keys(DRIVERS).sort());
  });

  it.each(ARMS.map((a) => [a.arm, a] as const))('%s, over an unplaceable birth on record, records what the census says', async (_n, a) => {
    expect(records(await a.drive(), a.session)).toBe(!RECORDS_NOTHING.includes(a.arm));
  });

  it('measured: the records-nothing arms are exactly the named allow-list', async () => {
    const nothing: string[] = [];
    for (const a of ARMS) if (!records(await a.drive(), a.session)) nothing.push(a.arm);
    expect(nothing).toEqual(RECORDS_NOTHING);
  });

  // READ BACK, not only what the bind wrote (review of #1573: the census above never read an adopted worker back). D6's
  // ghost parent (D-5920) over the residual arm: an EARLIER occupant of the recycled name was minted (placeable birth
  // OLD_BIRTH) by a run that is still OPEN because its coordinator is gone; a run planned before that mint then
  // dispatches and ADOPTS the name's workspace, recording no birth (D-6993). The adopted worker keeps the id-string rule:
  // its parent is the adopting run's claimant (the newest open run naming it), never the dead coordinator the earlier
  // occupant's birth would date it to. The read half is red at 0d1b8ead5 (every unplaceable worker anchored to the newest
  // recorded birth of its id: childParentOf/claimantsOf/sessionRunRead answered coord-gone) and green on the merge base.
  // The stamp half is red on the merge base: its placeable-only stamp gave wave 2 the earlier occupant's birth (OLD_BIRTH).
  it('an adopted worker under a recycled name whose earlier occupant\'s run is still open reads the ADOPTING run\'s claimant, and its later wave borrows no birth', async () => {
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
    // The stamp borrows no birth either: a later wave bound to the adopted worker records none, never the earlier
    // occupant's (`occupantBirthOf`: the name was adopted after that birth), and the adopting claimant stays the parent.
    const wave2 = open(coord, 'prog-wave-2', 'coord-live', T0 + 9000);
    coord.setSession(wave2, ADOPTED);
    expect(born(coord, wave2)).toEqual({ sessionBornAt: null, sessionBornFor: null });
    expect(childParentOf(series(coord, ADOPTED), 'coord-live', incarnation)).toBe('coord-live');
  });
});
