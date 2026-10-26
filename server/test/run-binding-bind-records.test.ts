// ARCH-60 follow-up (#1407, part of #795): every bind records the incarnation it binds to. This file pins, by name, what
// `CoordStore.bindSession` writes for the bound incarnation, and the two gaps #1407 names. Written first as a
// characterization (green on the code before the fix); the gap cases carry a WRONG-ANSWER comment and flip with the fix.
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { bindingOf, bornIncarnation, parentOf, unbornIncarnation } from '../src/coord/runBinding.js';
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

  it('GAP 1 (unplaceable): an unborn session with recorded births is its newest recorded birth, so an earlier occupant\'s open run is no parent', () => {
    const s = store();
    const ghost = open(s, 'prog-old', 'coord-gone', OLD);
    s.setSession(ghost, 'demo-w', OLD);
    const live = open(s, 'prog-new', 'coord-live', BORN + 1000);
    s.setSession(live, 'demo-w', BORN);
    s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(live);
    const binding = bindingOf(series(s, 'demo-w'), unbornIncarnation('demo-w', 'unplaceable'));
    expect(binding.open).toBeNull();
    expect(parentOf(binding)).toBeNull();
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
  const wave1 = (adopt: boolean) => async (): Promise<Born> => {
    const home = mkTmp('ccrc-bind-census-spawn-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    unplaceableOnRecord(coord, ADOPTED);
    const opened = coord.openRun({ program: 'prog-wave', title: 'wave', project: 'demo', wave: 1, waveOf: 3, claimedBy: CLAIMANT });
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
    return born(coord, opened.id) as Born;
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
});
