// Overlord W1a, the renewal hand-offs, Task 6 (plan `w1a-renewal-handoffs.md`): the generations lane writes the PreCompact arm's
// route field. `precompactField` (L1) reads the soft budget's count alone (m8): `refuse` while a renewal is left, `allow` once it
// is spent. The lane plans the write for a live long-lived generation only while the `continuity` row is live, only when the
// field differs from what the registry read, and never over a field it could not read; the acts write it through the route
// writer. A field that outlives its reason, the row lowered to shadow or its generation ended unreplaced, is retracted to
// `allow` on every pass, live or shadow (`precompactRetractions`, the coordinator's ruling F2 on review 2312: ccd's route has no
// clear form for this field). A real coord.db and the fake time ports; nothing reaches the fleet.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import * as precompactModule from '../src/continuity/precompact.js';
import { precompactField } from '../src/continuity/precompact.js';
import { retractionCases } from './sim/handoffSets.js';
import { generationsPass, type GenerationsDeps, type PlannedAct, type RegistryFacts } from '../src/continuity/generationsLane.js';
import { runRenewalActs, type PrecompactWrite } from '../src/continuity/renewalActs.js';
import type { GenRow } from '../src/continuity/continuityStore.js';
import type { SessionHost } from '../src/continuity/sessionHost.js';
import { SOFT_BUDGET } from '../../shared/continuity.js';
import { CONTINUITY_LANE } from '../../shared/lane-arm.js';
import { fakeTime, FAKE_T0 } from './fakeTime.js';
import { mkTmp } from './tmpHelpers.js';

const COORD = 'lane-a-project-a';
const U1 = '11111111-1111-4111-8111-111111111111';

describe('precompactField (L1)', () => {
  it('refuse while the soft budget has a renewal left, allow at or above it; a count that is not one is allow', () => {
    expect(SOFT_BUDGET.count).toBe(3);
    expect([0, 1, 2, 3, 4].map(precompactField)).toEqual(['refuse', 'refuse', 'refuse', 'allow', 'allow']);
    expect(precompactField(Number.NaN)).toBe('allow');
    expect(precompactField(-1)).toBe('allow');
    expect(precompactField(1.5)).toBe('allow');
  });
});

describe('precompactRetractions (L1, ruling F2 on review 2312)', () => {
  // Written once, in the mutation set, and run here against the real module.
  for (const [name, run] of Object.entries(retractionCases(precompactModule))) it(name, run);
});

function fx(live: boolean) {
  const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-precompact-field-'), '.ccrc', 'coord.db')));
  s.db.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'P', 1, 'active')");
  s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 1, 2, 'project-a', 'working', ?, 1)").run(COORD);
  if (live) s.setLaneArm(CONTINUITY_LANE, 'live', 1);
  const t = fakeTime({ wallMs: FAKE_T0, monoMs: 1_000 });
  const st = s.insertStart({ sessionId: COORD, reportId: 'r-1', uuid: U1, source: 'startup', model: null, rowIncarnation: 'inc',
    reportedAt: FAKE_T0, receivedAt: FAKE_T0 });
  if (!st.ok) throw new Error('start');
  const w = s.mintGeneration({ identity: COORD, sessionId: COORD, role: 'coordinator', term: 1, rowIncarnation: 'inc', startId: st.id,
    startReportedAt: FAKE_T0, resumed: false, model: null, lane: 'lane-a', host: null, outcome: 'woken', mono: 1_000, proc: 'p1',
    now: FAKE_T0 }, null, live);
  if (!w.ok) throw new Error('mint');
  // At rest, no walk in flight on either column; the starts cursor past the start.
  s.db.prepare("UPDATE continuity_generations SET state = 'active', shadowState = NULL, walk = NULL, deadlineAt = NULL, shadowDeadlineAt = NULL WHERE id = ?").run(w.id);
  s.advanceCursor({ lane: 'generations', from: 0, to: st.id });
  const gen = (): GenRow => { const r = s.liveGenerations(); if (!r.ok) throw new Error(r.detail); return r.rows[0]!; };
  const pass = (precompact: RegistryFacts['precompact'], more: readonly RegistryFacts[] = []) => {
    const deps: GenerationsDeps = { coord: s, clock: t.ports.clock, entropy: t.ports.entropy, proc: 'p1', log: () => {}, retried: new Set(),
      emptyTries: new Map(), gate: () => null };
    const registry: RegistryFacts[] = [{ id: COORD, uuid: U1, lane: 'lane-a', child: { kind: 'none' }, ...(precompact === undefined ? {} : { precompact }) }, ...more];
    return generationsPass(deps, { registry, readings: new Map(), listedAt: t.ports.clock.wall() + 1, canRenew: true });
  };
  return { s, t, gen, pass };
}
const fieldActs = (planned: readonly PlannedAct[]) => planned.filter((p) => p.act.kind === 'precompact-field').map((p) => p.act);

describe('the generations lane plans the PreCompact field (Task 6)', () => {
  it('live with budget left: refuse is planned once; with the registry already reading refuse nothing is planned', () => {
    const f = fx(true);
    expect(fieldActs(f.pass(null).planned)).toEqual([{ kind: 'precompact-field', value: 'refuse' }]);
    expect(fieldActs(f.pass('refuse').planned)).toEqual([]);
  });

  it('live with the budget spent: allow is planned, and nothing once the registry reads allow', () => {
    const f = fx(true);
    for (let i = 0; i < SOFT_BUDGET.count; i += 1) expect(f.s.recordSoftRenewal(f.gen(), f.gen().observed.ms).ok).toBe(true);
    expect(fieldActs(f.pass('refuse').planned)).toEqual([{ kind: 'precompact-field', value: 'allow' }]);
    expect(fieldActs(f.pass('allow').planned)).toEqual([]);
  });

  it('a generation inside its least age with budget left writes refuse: the budget alone decides (m8)', () => {
    const f = fx(true);
    expect(f.gen().observed.ms - f.gen().mintedObservedMs).toBe(0);
    expect(fieldActs(f.pass(null).planned)).toEqual([{ kind: 'precompact-field', value: 'refuse' }]);
  });

  // One fixture a case: each opens a coord.db, and three in one case outran the timeout on a loaded box (review 2312).
  it('shadow writes nothing', () => {
    expect(fieldActs(fx(false).pass(null).planned)).toEqual([]);
  });

  it('a field the registry could not read is never written over', () => {
    const f = fx(true);
    expect(fieldActs(f.pass('unread').planned)).toEqual([]);
    expect(fieldActs(f.pass(undefined).planned)).toEqual([]);
  });
});

describe('the lane retracts a refuse that outlived its reason (ruling F2 on review 2312)', () => {
  const OTHER = 'lane-b-project-a';
  const other = (precompact: RegistryFacts['precompact']): RegistryFacts => ({ id: OTHER, uuid: U1, lane: 'lane-b', child: { kind: 'none' }, precompact });

  it('a lowering to shadow retracts it, for the generation\'s own session and any other row that reads refuse', () => {
    const f = fx(true);
    expect(f.pass('refuse').retract).toEqual([]);
    f.s.setLaneArm(CONTINUITY_LANE, 'shadow', 2);
    const r = f.pass('refuse', [other('refuse'), other('allow')]);
    expect(r.live).toBe(false);
    expect(r.retract).toEqual([COORD, OTHER]);
    expect(fieldActs(r.planned)).toEqual([]);
  });

  it('a generation that ends unreplaced retracts it on the next live pass', () => {
    const f = fx(true);
    f.s.db.prepare("UPDATE continuity_generations SET state = 'ended'").run();
    const r = f.pass('refuse');
    expect(r.live).toBe(true);
    expect(r.retract).toEqual([COORD]);
  });

  it('a live generation inside its budget keeps refuse; a row with no generation that reads refuse is retracted', () => {
    const f = fx(true);
    const r = f.pass('refuse', [other('refuse')]);
    expect(r.retract).toEqual([OTHER]);
    expect(fieldActs(r.planned)).toEqual([]);
  });

  it('a field that reads allow, is not set or was not read is never retracted', () => {
    const f = fx(false);
    expect(f.pass('allow', [other(null), other('unread')]).retract).toEqual([]);
  });
});

describe('the acts write the field through the route writer', () => {
  const host = {} as SessionHost;
  const planned = (value: 'refuse' | 'allow'): PlannedAct[] => [{
    target: { genId: 1, identity: COORD, sessionId: COORD, role: 'coordinator', n: 1, startId: 1, cls: null, episode: 0 },
    act: { kind: 'precompact-field', value },
  }];
  const deps = (routePrecompact?: (id: string, v: 'refuse' | 'allow') => Promise<PrecompactWrite>) => {
    const logs: string[] = [];
    return { logs, deps: { coord: {} as never, host, mail: () => true, now: () => 0, log: (l: string) => logs.push(l),
      ...(routePrecompact === undefined ? {} : { routePrecompact }) } };
  };

  it('a write that lands counts nothing failed; a refused one is counted and logged', async () => {
    const calls: string[] = [];
    const ok = deps(async (id, v) => { calls.push(`${id}=${v}`); return { kind: 'written' }; });
    expect(await runRenewalActs(ok.deps, planned('refuse'))).toMatchObject({ failed: 0, skipped: 0 });
    expect(calls).toEqual([`${COORD}=refuse`]);
    const no = deps(async () => ({ kind: 'refused', reason: 'ccd: route: bad value' }));
    expect(await runRenewalActs(no.deps, planned('allow'))).toMatchObject({ failed: 1 });
    expect(no.logs.join('\n')).toContain('precompact=allow was not written (refused: ccd: route: bad value)');
  });

  it('with no route writer the act is skipped and logged, never a throw', async () => {
    const none = deps();
    expect(await runRenewalActs(none.deps, planned('refuse'))).toMatchObject({ skipped: 1, failed: 0 });
    expect(none.logs.join('\n')).toContain('no route writer');
  });
});
