// Overlord W1, the renewal readings PR H (plan `w1-renewal-readings.md` Task 11; spec §3.6): the launch profile's account hold.
// The deciders' cases are written once in `sim/renewalHoldReadingSets.ts` and run here against the real modules; the generations
// pass's hold step (`holdOverlordStart`) runs against a real coord.db, with the designation read handed in, so a start that
// loaded what the profile does not list holds its account once, an unmeasured verdict holds nothing and is asked again, a
// settled start is not asked again, and nobody designated reads and writes nothing.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import * as readings from '../src/continuity/renewalReadings.js';
import * as shared from '../../shared/renewal-readings.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { expectedSurfaceOf } from '../src/continuity/sandboxCheck.js';
import { holdOverlordStart } from '../src/continuity/generationsLane.js';
import type { GenRow } from '../src/continuity/continuityStore.js';
import type { StartLoadsReport } from '../src/continuity/startLoads.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import { sourceOfSymbol } from './scan/symbols.js';
import { heldOutOfListCases, holdOfStartCases, holdTargetCases, installBehindCases } from './sim/renewalHoldReadingSets.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { readinessLaneOver } from '../src/coord/overlordReadinessWiring.js';
import type { ReadinessLanePort } from '../src/coord/overlordReadinessLane.js';

afterEach(removeTmpFixtures);

describe('holdOfStart (PR H)', () => {
  for (const [name, fn] of Object.entries(holdOfStartCases(readings))) it(name, fn);
});
describe('holdTargetOf (PR H)', () => {
  for (const [name, fn] of Object.entries(holdTargetCases(readings))) it(name, fn);
});
describe('heldOutOfList (PR H, L0)', () => {
  for (const [name, fn] of Object.entries(heldOutOfListCases(shared))) it(name, fn);
});
describe('overlordInstallBehindOf, startDigestDiffersOf and buildsAgreeOf (PR H, question 5)', () => {
  for (const [name, fn] of Object.entries(installBehindCases(readings))) it(name, fn);
});

// ---------------------------------------------------------------------------------------------------- the generations pass's hold

const BODY = 'lane-a-overlord';
const NOW = 1_800_000_000_000;
const view = (): DesignationView => ({
  bound: { sessionId: BODY, generation: 'g1' }, pending: null, term: 2, designatedTerm: 2, model: 'opus',
  accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'flag-off', lastAttempt: null, stopsOwed: [],
});
const BOUND: DesignationRead = { kind: 'designated', sessionId: BODY, term: 2, row: view() };
const NONE: DesignationRead = { kind: 'not-designated', row: null };
const expected = expectedSurfaceOf('overlord')!;

/** A real store, the session's `startup` start, and the hold step's deps over it with the designation handed in; every read and
 *  write the step makes is counted. */
function rig(designation: DesignationRead = BOUND) {
  const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-holds-pass-'), 'coord.db')));
  const start = s.insertStart({ sessionId: BODY, reportId: 'r-0001', uuid: '11111111-2222-3333-4444-555555555555', source: 'startup',
    model: 'claude-opus-5-5', rowIncarnation: 'g1', reportedAt: NOW - 60_000, receivedAt: NOW - 60_000 });
  if (!start.ok) throw new Error('start not recorded');
  const calls: string[] = [];
  const logs: string[] = [];
  const coord = {
    designationRead: () => { calls.push('designation'); return designation; },
    startLoadsOfNewestStart: (id: string) => { calls.push(`loads:${id}`); return s.startLoadsOfNewestStart(id); },
    holdAccount: (h: { lane: string; startId: number; at: number }) => { calls.push(`hold:${h.lane}:${h.startId}`); return s.holdAccount(h); },
  };
  const deps = { coord, holdsSettled: new Set<number>(), log: (l: string) => { logs.push(l); } };
  const gen = { id: 1, identity: 'overlord', sessionId: BODY, role: 'overlord', lane: 'lane-a', startId: start.id } as unknown as GenRow;
  return { s, startId: start.id, calls, logs, deps, gen };
}

/** A loads report whose every kind the server's own profile lists, then `loaded` laid over it. */
const report = (over: Partial<StartLoadsReport['loaded']> = {}): StartLoadsReport => ({
  fromId: BODY, fromUuid: '11111111-2222-3333-4444-555555555555', reportId: 'r-0001', profileRole: 'overlord', profileDigest: expected.digest, launchRc: 'off', claudeVersion: '9.9.9-unlisted',
  permissionMode: 'bypassPermissions', cwdInWorkspace: true, carriedFrom: null, bodySha256: 'b'.repeat(64), reportedAt: NOW - 59_000,
  loaded: {
    instructions: [{ type: 'Project', name: 'CLAUDE.md', inWorkspace: true, sha256: expected.constitutionSha256 }],
    hooks: [expected.hookSha256], skills: [...expected.skills], agents: [...expected.readerTypes],
    tools: [...expected.tools, `mcp__${expected.toolServer}__act`], toolServers: [expected.toolServer], ...over,
  },
});
const FOREIGN_HOOK = (): Partial<StartLoadsReport['loaded']> => ({ hooks: [expected.hookSha256, 'd'.repeat(64)] });

describe('holdOverlordStart: the generations pass\'s account hold (PR H, Task 11)', () => {
  it('a start that loaded what the profile does not list, from the account\'s own config, holds its account, once per start', () => {
    const r = rig();
    expect(r.s.insertStartLoads(BODY, report(FOREIGN_HOOK()), NOW)).toMatchObject({ ok: true });
    holdOverlordStart(r.deps, [r.gen], NOW);
    expect(r.s.accountHolds()).toEqual({ ok: true, lanes: ['lane-a'] });
    expect(r.calls).toEqual(['designation', `loads:${BODY}`, `hold:lane-a:${r.startId}`]);
    expect(r.logs).toHaveLength(1);
    // settled: the start is not asked again (no second read of its report, no second write)
    holdOverlordStart(r.deps, [r.gen], NOW + 30_000);
    expect(r.calls.filter((c) => c.startsWith('hold:'))).toHaveLength(1);
  });

  it('a verdict that is unmeasured on the first pass (no loads report yet) and fails on the next holds on the next (F10)', () => {
    const r = rig();
    holdOverlordStart(r.deps, [r.gen], NOW);
    expect(r.s.accountHolds()).toEqual({ ok: true, lanes: [] });
    expect(r.deps.holdsSettled.size).toBe(0);
    r.s.insertStartLoads(BODY, report(FOREIGN_HOOK()), NOW + 10_000);
    holdOverlordStart(r.deps, [r.gen], NOW + 30_000);
    expect(r.s.accountHolds()).toEqual({ ok: true, lanes: ['lane-a'] });
  });

  it('an unmeasured property never holds an account, and the start is asked again each pass', () => {
    const r = rig();
    r.s.insertStartLoads(BODY, report({ hooks: 'unmeasured' }), NOW);
    holdOverlordStart(r.deps, [r.gen], NOW);
    holdOverlordStart(r.deps, [r.gen], NOW + 30_000);
    expect(r.s.accountHolds()).toEqual({ ok: true, lanes: [] });
    expect(r.calls.filter((c) => c.startsWith('loads:'))).toHaveLength(2);
    expect(r.calls.filter((c) => c.startsWith('hold:'))).toEqual([]);
  });

  it('a property the workspace loaded never holds an account', () => {
    const r = rig();
    const parent = { type: 'Project', name: 'CLAUDE.md', inWorkspace: false, sha256: 'c'.repeat(64) };
    r.s.insertStartLoads(BODY, report({ skills: [...expected.skills], agents: [...expected.readerTypes],
      instructions: [{ type: 'Project', name: 'CLAUDE.md', inWorkspace: true, sha256: expected.constitutionSha256 }, parent] }), NOW);
    // the build's own lists are not measured here, so pass a verdict through the real profile with this build's lists unread:
    // the skills and agents read unmeasured and keep the start open; the instruction failure alone never holds
    holdOverlordStart(r.deps, [r.gen], NOW);
    expect(r.s.accountHolds()).toEqual({ ok: true, lanes: [] });
    expect(r.calls.filter((c) => c.startsWith('hold:'))).toEqual([]);
  });

  it('a cleared hold is never put back by the same start asked again after a restart (a fresh memo)', () => {
    const r = rig();
    r.s.insertStartLoads(BODY, report(FOREIGN_HOOK()), NOW);
    holdOverlordStart(r.deps, [r.gen], NOW);
    expect(r.s.clearAccountHold({ lane: 'lane-a', by: 'device-1', at: NOW + 1 })).toEqual({ ok: true, changed: true });
    holdOverlordStart({ ...r.deps, holdsSettled: new Set() }, [r.gen], NOW + 30_000);
    expect(r.s.accountHolds()).toEqual({ ok: true, lanes: [] });
  });

  it('nobody designated: nothing is read and nothing is written', () => {
    const r = rig(NONE);
    r.s.insertStartLoads(BODY, report(FOREIGN_HOOK()), NOW);
    holdOverlordStart(r.deps, [r.gen], NOW);
    expect(r.calls).toEqual(['designation']);
    expect(r.s.accountHolds()).toEqual({ ok: true, lanes: [] });
    expect(r.s.db.prepare('SELECT COUNT(*) AS n FROM overlord_account_holds').get()).toEqual({ n: 0 });
  });

  it('a generation of another session, a start newer than the generation, or no memo, holds nothing', () => {
    const r = rig();
    r.s.insertStartLoads(BODY, report(FOREIGN_HOOK()), NOW);
    holdOverlordStart(r.deps, [{ ...r.gen, sessionId: 'lane-b-overlord' } as GenRow], NOW);
    holdOverlordStart(r.deps, [{ ...r.gen, startId: r.startId - 1 } as GenRow], NOW);
    holdOverlordStart({ coord: r.deps.coord, log: r.deps.log }, [r.gen], NOW);
    expect(r.s.accountHolds()).toEqual({ ok: true, lanes: [] });
    expect(r.deps.holdsSettled.size).toBe(0);
  });

  it('a refused write holds nothing yet, is logged, and is asked again', () => {
    const r = rig();
    r.s.insertStartLoads(BODY, report(FOREIGN_HOOK()), NOW);
    r.s.db.exec("CREATE TRIGGER fail_hold BEFORE INSERT ON overlord_account_holds BEGIN SELECT RAISE(ABORT, 'forced'); END");
    holdOverlordStart(r.deps, [r.gen], NOW);
    expect(r.deps.holdsSettled.size).toBe(0);
    expect(r.logs.join('\n')).toContain('could not be written');
    r.s.db.exec('DROP TRIGGER fail_hold');
    holdOverlordStart(r.deps, [r.gen], NOW + 30_000);
    expect(r.s.accountHolds()).toEqual({ ok: true, lanes: ['lane-a'] });
  });

  it('the pass asks the hold step once, over the live generations it judges (the source pin)', () => {
    const body = sourceOfSymbol('server/src/continuity/generationsLane.ts', 'generationsPass');
    expect(body.match(/holdOverlordStart\(/g)).toHaveLength(1);
    expect(body).toContain('if (gens.ok) holdOverlordStart(deps, gens.rows, now);');
  });
});

describe('the readiness wiring reads the holds from the store (PR H)', () => {
  /** The lane's port as the composition builds it over a real store (read through the lane's private field). */
  const portOver = (s: CoordStore): ReadinessLanePort => {
    const roster = { accounts: [] as never[], byId: new Map() };
    const lane = readinessLaneOver({ db: s.db, coord: s, operatorModel: undefined, limits: () => null,
      deps: { cfg: { roster }, time: { clock: { wall: () => NOW, mono: () => 1 } } } as never });
    return (lane as unknown as { port: ReadinessLanePort }).port;
  };

  it('the standing holds read, never not-wired; an unreadable table reads unmeasured', () => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-holds-readiness-'), 'coord.db')));
    const port = portOver(s);
    expect(port.holds()).toEqual({ kind: 'read', lanes: [] });
    s.holdAccount({ lane: 'lane-a', startId: 1, at: NOW });
    expect(port.holds()).toEqual({ kind: 'read', lanes: ['lane-a'] });
    s.db.exec('DROP TABLE overlord_account_holds');
    expect(port.holds()).toEqual({ kind: 'unmeasured' });
  });
});
