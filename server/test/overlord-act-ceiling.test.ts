// The act ceilings (Overlord W2, the act catalogue A; plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md`
// §5 and Task A4): Table 5 against the catalogue, `actCeilingStep` and `ceilingLatchDue` (their cases live once in
// `sim/actCatalogueSets.ts`, which the mutation floors run against each mutant), the cause row, the gate runner's count read
// and its latch raise, and the coordinator's item 5 held as a fact: no door of today reaches the count reader.
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import * as ceiling from '../src/coord/overlordActCeiling.js';
import {
  ACT_CEILINGS, ACT_CEILING_WINDOW_MS, CEILING_GROUPS, OVERLORD_ACT_KINDS, OVERLORD_ACT_KIND_LIST, type CeilingGroup,
} from '../../shared/overlord.js';
import { LADDER_CAUSE_MAP } from '../../shared/overlord-ladder.js';
import { NOTES_CAP } from '../../shared/continuity.js';
import { OVERLORD_DOORS, type DoorRow, type OverlordDoorRow } from '../src/coord/overlordDoors.js';
import { gateReads } from '../src/coord/overlordGate.js';
import {
  NOT_WIRED_ACT_COUNT, overlordGateRun, overlordReadGate, type ActCountReader, type OverlordGateDeps,
} from '../src/coord/overlordGateRun.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { HELD_BY, TABLE_5, actCeilingStepCases, ceilingLatchDueCases } from './sim/actCatalogueSets.js';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { actCountPort } from '../src/coord/overlordCeilingWiring.js';
import { mkTmp } from './tmpHelpers.js';

describe('Table 5 and Table 6 against the catalogue', () => {
  it('each group\'s values are Table 5\'s, and its kinds are the rows counted in it', () => {
    expect([...CEILING_GROUPS].sort()).toEqual(Object.keys(TABLE_5).sort());
    for (const [g, t] of Object.entries(TABLE_5)) {
      expect(ACT_CEILINGS[g as CeilingGroup], g).toEqual({ perProgramme: t.perProgramme, all: t.all });
      const counted = OVERLORD_ACT_KIND_LIST.filter((k) => { const c = OVERLORD_ACT_KINDS[k].ceiling; return c.kind === 'counted' && c.group === g; });
      expect(counted.sort(), g).toEqual([...t.kinds].sort());
    }
    expect(ACT_CEILING_WINDOW_MS).toBe(3_600_000);
  });
  it('the held-by kinds are Table 6\'s and the team link (call 1816), each naming its owner', () => {
    const held = OVERLORD_ACT_KIND_LIST.filter((k) => OVERLORD_ACT_KINDS[k].ceiling.kind === 'held-by');
    expect(held.sort()).toEqual([...HELD_BY].sort());
    for (const k of held) expect((OVERLORD_ACT_KINDS[k].ceiling as { owner: string }).owner.length, k).toBeGreaterThan(10);
    // The notes' owner is the cap it names; acknowledge's owner reads the index's wording (ruling 6).
    expect(NOTES_CAP).toEqual({ count: 200, chars: 500 });
    expect((OVERLORD_ACT_KINDS['write-note'].ceiling as { owner: string }).owner).toContain('200 notes of 500 characters');
    expect((OVERLORD_ACT_KINDS.acknowledge.ceiling as { owner: string }).owner)
      .toBe('its targets: one acknowledgement for each operator message, each held delivery to the role and each band-3 request row');
  });
  it('never is exactly the rows refused at every rung, accept-limit among them (F7)', () => {
    for (const k of OVERLORD_ACT_KIND_LIST) {
      const r = OVERLORD_ACT_KINDS[k];
      expect(r.ceiling.kind === 'never', k).toBe(Object.values(r.rungs).every((c) => c === 'refuse'));
    }
    expect(OVERLORD_ACT_KINDS['accept-limit'].ceiling).toEqual({ kind: 'never' });
    expect(OVERLORD_ACT_KINDS['escalate-request'].ceiling).toEqual({ kind: 'counted', group: 'request' });
  });
  it('act-ceiling-hit is a latch capping advise, notice none (plan question 3)', () => {
    expect(LADDER_CAUSE_MAP['act-ceiling-hit']).toMatchObject({ kind: 'latch', effect: { kind: 'cap', cap: 'advise' }, notice: 'none' });
    expect(ceiling.ACT_CEILING_LATCH).toBe('act-ceiling-hit');
  });
});

describe('actCeilingStep', () => {
  for (const [name, fn] of Object.entries(actCeilingStepCases(ceiling, OVERLORD_ACT_KIND_LIST))) it(name, fn);
});
describe('ceilingLatchDue', () => {
  for (const [name, fn] of Object.entries(ceilingLatchDueCases(ceiling))) it(name, fn);
});

// ------------------------------------------------------------------------------------------------- the runner, the walk

const NOW = 1_800_000_000_000;
const BODY = 'lane-a-overlord';
const DESIGNATED = {
  kind: 'designated', sessionId: BODY, term: 1,
  row: { bound: { sessionId: BODY, generation: 'inc-1' }, pending: null, term: 1, designatedTerm: 1 },
} as unknown as DesignationRead;
const LIVE = { id: 9, identity: 'overlord', sessionId: BODY, n: 3, term: 1, startId: 4, state: 'active' };

/** A runner's deps whose every fact passes, for an unfenced read door; the count port and the latch ports are the case's. */
function depsOf(over: Partial<OverlordGateDeps> = {}): OverlordGateDeps {
  return {
    identity: {
      session: async (sessionId, uuid) => ({ ok: true, sessionId, uuid, actor: { kind: 'session', subject: sessionId } as never }),
      incarnation: async () => ({ kind: 'measured', incarnation: 'inc-1' }) as never,
    },
    designation: () => DESIGNATED,
    authority: () => ({ kind: 'coherent' }),
    ladder: () => ({ kind: 'read', rung: { rung: 'full', operatorRung: 'full', binding: [], readBy: [] } }),
    generations: () => ({ ok: true, rows: [LIVE] }) as never,
    continuityLive: () => true,
    cardRead: () => ({ ok: true, read: { current: true } }) as never,
    actKey: () => ({ kind: 'unmeasured', why: 'unused' }),
    counter: () => 'unmeasured',
    witness: () => ({ kind: 'unmeasured', why: 'unused' }),
    recordWitness: () => true,
    recordFenceRefusal: () => undefined,
    serverWords: () => ['overlord-v1', 'continuity-v1', 'timers-v1'],
    now: () => NOW,
    ...over,
  };
}

/** A synthetic door of a counted kind, added to the table for one case and removed after it: no such door exists today. */
async function withDoor<T>(key: string, act: OverlordDoorRow['act'], fn: () => Promise<T>): Promise<T> {
  const table = OVERLORD_DOORS as Record<string, DoorRow>;
  table[key] = { ...(OVERLORD_DOORS.sequence as OverlordDoorRow), act };
  try { return await fn(); } finally { delete table[key]; }
}
async function callRunner(deps: OverlordGateDeps, key: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const run = overlordGateRun(deps);
  const app = Fastify({ logger: false });
  app.get('/gate', async (req, reply) => {
    const g = await run(req, reply, key, { sessionId: BODY, uuid: 'u-1', uuidField: 'byUuid' });
    return g.kind === 'refused' ? reply : { ok: true, gate: g.kind };
  });
  await app.ready();
  try {
    const res = await app.inject({ method: 'GET', url: '/gate' });
    return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
  } finally { await app.close(); }
}
const spyReader = (answer: ReturnType<ActCountReader['count']>) => {
  const calls: { group: string; programme: string | null; since: number }[] = [];
  const reader: ActCountReader = { count: (group, programme, since) => { calls.push({ group, programme, since }); return answer; } };
  return { reader, calls };
};
const latchSpy = (standing: boolean | 'unmeasured' | 'throws') => {
  const raised: { detail: string; actor: unknown }[] = [];
  let standingReads = 0;
  return {
    raised, standingReads: () => standingReads,
    ports: {
      standing: () => { standingReads += 1; if (standing === 'throws') throw new Error('rows'); return standing; },
      raise: (detail: string, actor: unknown) => { raised.push({ detail, actor }); },
    } as NonNullable<OverlordGateDeps['ceilingLatch']>,
  };
};

describe('the gate runner reads the act count (W2 act catalogue A)', () => {
  it('a counted door reads its group\'s count over the last hour, in all only, once', async () => {
    const s = spyReader({ kind: 'counted', programme: null, all: 0 });
    await withDoor('zz-relay', 'relay', async () => {
      const r = await callRunner(depsOf({ actCount: s.reader }), 'zz-relay');
      expect(r.body).toEqual({ ok: true, gate: 'pass' });
    });
    expect(s.calls).toEqual([{ group: 'relay', programme: null, since: NOW - 3_600_000 }]);
  });
  it('with no reader wired, the stated default refuses unavailable, not-wired, and raises nothing', async () => {
    const l = latchSpy(false);
    await withDoor('zz-relay', 'relay', async () => {
      const r = await callRunner(depsOf({ ceilingLatch: l.ports }), 'zz-relay');
      expect([r.body.error, r.body.step]).toEqual(['unavailable', '10']);
      expect(String(r.body.detail)).toContain('not-wired');
    });
    expect(NOT_WIRED_ACT_COUNT.count('relay', null, 0)).toEqual({ kind: 'unmeasured', why: 'not-wired' });
    expect([l.raised, l.standingReads()]).toEqual([[], 0]);
  });
  it('a reader that throws reads unmeasured and refuses unavailable', async () => {
    await withDoor('zz-relay', 'relay', async () => {
      const r = await callRunner(depsOf({ actCount: { count: () => { throw new Error('boom'); } } }), 'zz-relay');
      expect([r.body.error, r.body.step]).toEqual(['unavailable', '10']);
    });
  });
  it('a ceiling hit refuses act-ceiling (429) and raises the latch through the port, under the caller\'s actor, when none stands', async () => {
    for (const standing of [false, 'unmeasured', 'throws'] as const) {
      const l = latchSpy(standing);
      const s = spyReader({ kind: 'counted', programme: null, all: 30 });
      await withDoor('zz-relay', 'relay', async () => {
        const r = await callRunner(depsOf({ actCount: s.reader, ceilingLatch: l.ports }), 'zz-relay');
        expect([r.status, r.body.error, r.body.step], String(standing)).toEqual([429, 'act-ceiling', '10']);
      });
      expect(l.raised.length, String(standing)).toBe(1);
      expect(l.raised[0]!.actor).toEqual({ kind: 'session', subject: BODY });
      expect(l.raised[0]!.detail).toContain('relay');
    }
  });
  it('unless one stands: a standing latch is not raised again', async () => {
    const l = latchSpy(true);
    await withDoor('zz-relay', 'relay', async () => {
      const r = await callRunner(depsOf({ actCount: spyReader({ kind: 'counted', programme: null, all: 31 }).reader, ceilingLatch: l.ports }), 'zz-relay');
      expect(r.body.error).toBe('act-ceiling');
    });
    expect([l.raised, l.standingReads()]).toEqual([[], 1]);
  });
  it('a raise that throws still refuses, and the runner never throws', async () => {
    const ports = { standing: () => false, raise: () => { throw new Error('journal'); } };
    await withDoor('zz-relay', 'relay', async () => {
      const r = await callRunner(depsOf({ actCount: spyReader({ kind: 'counted', programme: null, all: 30 }).reader, ceilingLatch: ports }), 'zz-relay');
      expect([r.status, r.body.error]).toEqual([429, 'act-ceiling']);
    });
  });
  it('a refusal other than act-ceiling reads no standing latch and raises nothing', async () => {
    const l = latchSpy(false);
    await withDoor('zz-relay', 'relay', async () => {
      const r = await callRunner(depsOf({ actCount: spyReader({ kind: 'counted', programme: null, all: 0 }).reader, ceilingLatch: l.ports,
        cardRead: () => ({ ok: true, read: { current: false } }) as never }), 'zz-relay');
      expect(r.body.error).toBe('card-unread');
    });
    expect([l.raised, l.standingReads()]).toEqual([[], 0]);
  });
  it('a held-by kind, a start door and a door with no act kind ask no count', async () => {
    for (const act of ['read', 'acknowledge', 'link-team', 'write-note'] as const) {
      const s = spyReader({ kind: 'unmeasured', why: 'must not be read' });
      await withDoor('zz-held', act, async () => {
        const r = await callRunner(depsOf({ actCount: s.reader, ladder: () => ({ kind: 'read', rung: { rung: 'full', operatorRung: 'full', binding: [], readBy: [] } }) }), 'zz-held');
        expect(r.body, act).toEqual({ ok: true, gate: 'pass' });
      });
      expect(s.calls, act).toEqual([]);
    }
    expect(gateReads({ ...(OVERLORD_DOORS.sequence as OverlordDoorRow), act: 'relay', ladderClass: 'card-probe-note' }).ceiling).toBeNull();
    expect(gateReads(OVERLORD_DOORS['timer-list'] as OverlordDoorRow).ceiling).toBeNull();
  });
});

describe('the coordinator\'s item 5: no door of today reaches the count reader', () => {
  const overlordRows = Object.entries(OVERLORD_DOORS).filter(([, r]) => r.group === 'overlord') as [string, OverlordDoorRow][];
  it('derived from each row\'s kind and that kind\'s ceiling: no door of today asks a count', () => {
    expect(overlordRows.length).toBeGreaterThan(10);
    // A kind changed to counted with a door of today naming it, and nothing wired, reds here (call 1816, condition 3).
    const reaching = overlordRows.filter(([, r]) => r.ladderClass !== 'card-probe-note' && r.act !== null
      && OVERLORD_ACT_KINDS[r.act].ceiling.kind === 'counted').map(([k]) => k);
    expect(reaching).toEqual([]);
    for (const [k, r] of overlordRows) expect(gateReads(r).ceiling, k).toBeNull();
  });
  it('every Overlord door row, through the read gate with a reader that records every call, answers as before and asks no count', async () => {
    const s = spyReader({ kind: 'unmeasured', why: 'must not be read' });
    const read = overlordReadGate(depsOf({ actCount: s.reader }));
    for (const [k] of overlordRows) {
      const v = await read(BODY, k);
      // At `full` every row passes, the team link included; a start door passes too.
      expect(v, k).toEqual({ kind: 'pass' });
    }
    expect(s.calls).toEqual([]);
  });
});

// --------------------------------------------------------------------------------- act rows A: the count wired (Task A6)

describe('act rows A: the wired count at gate step 10', () => {
  const counted = (all: number, programme: number | null = null) => ({ kind: 'counted', programme, all }) as const;
  it('a wired count that is not a non-negative safe integer could not be measured: unavailable, never read as zero', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
      expect(ceiling.actCeilingStep('relay', null, { act: counted(bad), effect: 'not-asked' }), String(bad))
        .toEqual({ pass: false, word: 'unavailable', group: 'relay', why: ceiling.UNREADABLE_COUNT, latch: null });
      expect(ceiling.actCeilingStep('relay', null, { act: counted(0, bad), effect: 'not-asked' }), `programme ${bad}`)
        .toEqual({ pass: false, word: 'unavailable', group: 'relay', why: ceiling.UNREADABLE_COUNT, latch: null });
      expect(ceiling.actCeilingStep('relay', 'widen-scope', { act: counted(0), effect: counted(bad) }), `effect ${bad}`)
        .toEqual({ pass: false, word: 'unavailable', group: 'o3-effect', why: ceiling.UNREADABLE_COUNT, latch: null });
    }
    expect(ceiling.actCeilingStep('relay', null, { act: { kind: 'counted', programme: null, all: '0' as never }, effect: 'not-asked' }))
      .toMatchObject({ pass: false, word: 'unavailable' });
    expect(ceiling.countReadable(counted(0))).toBe(true);
    expect(ceiling.countReadable(counted(29, 5))).toBe(true);
    expect(ceiling.actCeilingStep('relay', null, { act: counted(29, 5), effect: 'not-asked' })).toEqual({ pass: true });
    expect(ceiling.actCeilingStep('relay', null, { act: counted(30), effect: 'not-asked' })).toMatchObject({ pass: false, word: 'act-ceiling' });
  });

  it('an effect carrier that is not itself counted is held by its effect\'s group alone', () => {
    expect(OVERLORD_ACT_KINDS.acknowledge.ceiling.kind).toBe('held-by');
    expect(ceiling.actCeilingStep('acknowledge', 'relay', { act: 'not-asked', effect: counted(30) }))
      .toEqual({ pass: false, word: 'act-ceiling', group: 'relay', scope: 'all', limit: 30, latch: 'act-ceiling-hit' });
    expect(ceiling.actCeilingStep('acknowledge', 'relay', { act: 'not-asked', effect: counted(29, 5) })).toEqual({ pass: true });
    expect(ceiling.actCeilingStep('acknowledge', 'relay', { act: 'not-asked', effect: 'not-asked' })).toEqual({ pass: true });
    expect(ceiling.actCeilingStep('acknowledge', 'relay', { act: 'not-asked', effect: { kind: 'unmeasured', why: 'u' } }))
      .toMatchObject({ pass: false, word: 'unavailable', group: 'relay' });
  });

  it('the composed count is the act store\'s reader over the open database, or the stated default where none is open', () => {
    expect(actCountPort(undefined)).toBe(NOT_WIRED_ACT_COUNT);
    const db = openCoordDb(path.join(mkTmp('ccrc-act-count-'), 'coord.db'));
    try {
      expect(actCountPort({ db }).count('relay', null, 0)).toEqual({ kind: 'counted', programme: null, all: 0 });
      expect(actCountPort({ db }).count('relay', 'prog-a', 0)).toEqual({ kind: 'counted', programme: 0, all: 0 });
    } finally { db.close(); }
  });

  it('with the real reader bound, every Overlord door row answers as before through the read gate, and none reaches it', async () => {
    const db = openCoordDb(path.join(mkTmp('ccrc-act-count-'), 'coord.db'));
    try {
      const real = actCountPort({ db });
      const calls: string[] = [];
      const read = overlordReadGate(depsOf({ actCount: { count: (g, p, s) => { calls.push(g); return real.count(g, p, s); } } }));
      const rows = Object.entries(OVERLORD_DOORS).filter(([, r]) => r.group === 'overlord');
      for (const [k] of rows) expect(await read(BODY, k), k).toEqual({ kind: 'pass' });
      expect(calls).toEqual([]);
    } finally { db.close(); }
  });

  it('a counted door reads the real table: an empty one passes, a dropped one refuses unavailable at step 10', async () => {
    const db = openCoordDb(path.join(mkTmp('ccrc-act-count-'), 'coord.db'));
    try {
      await withDoor('zz-relay', 'relay', async () => {
        expect((await callRunner(depsOf({ actCount: actCountPort({ db }) }), 'zz-relay')).body).toEqual({ ok: true, gate: 'pass' });
        db.exec('DROP TABLE overlord_acts');
        const r = await callRunner(depsOf({ actCount: actCountPort({ db }) }), 'zz-relay');
        expect([r.status, r.body.error, r.body.step]).toEqual([503, 'unavailable', '10']);
      });
    } finally { db.close(); }
  });
});
