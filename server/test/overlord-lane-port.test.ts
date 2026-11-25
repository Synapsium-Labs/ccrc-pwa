// Overlord W1 designation B (plan Tasks 7 and 10): `overlordLanePortOf`, the watcher's one port into the designation, over fakes:
// the facts the deadline decider reads, the settle step again, the expiry, the owed-stop drain and the write-set before a renewal.
// Every write must run INSIDE the coordination serialiser, so each fake body call records whether the serialiser was held. The
// end-to-end proof of the sweep (a settle lost after the door's answer, re-run through the real `settleLoads`) is in
// `continuity-start-loads-route.test.ts`, which owns the fixtures that build a stored report. Fixture ids only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { overlordLanePortOf, type OverlordBody, type OverlordLaneDeps } from '../src/coord/overlordRoutes.js';
import type { DesignationRead, DesignationView, SettleFact } from '../../shared/overlord-designation.js';
import { ROSTER, SET_AB, limit } from './sim/designationSets.js';

const NOW = 2_000_000_000; // 2_000_000 s: the clock the roster fixtures' account facts are built at
const OLD = 'overlord-quiet-otter';
const NEW = 'overlord-brisk-heron';

const view = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: null, pending: null, term: 1, designatedTerm: 1, model: 'opus', accountPools: SET_AB, pastIds: [], actor: 'op',
  lastAttempt: null, stopsOwed: [], ...over,
});
const pendingOf = (sessionId: string, kind: 'designate' | 'rebind' = 'designate') =>
  ({ sessionId, kind, deadlineAt: NOW + 1000, since: NOW - 1000, actor: 'op', generation: 'g-new' }) as const;
const designated = (sessionId: string, over: Partial<DesignationView> = {}): DesignationRead =>
  ({ kind: 'designated', sessionId, term: 2, row: view({ bound: { sessionId, generation: 'g-1' }, ...over }) });
const notDesignated = (over: Partial<DesignationView> = {}): DesignationRead => ({ kind: 'not-designated', row: view(over) });

interface Rig {
  readonly deps: OverlordLaneDeps;
  /** Every body, coord and settle call in order, each tagged with whether the serialiser was held when it was made. */
  readonly log: string[];
  readonly settleFact: ReturnType<typeof vi.fn>;
  readonly settleAgain: ReturnType<typeof vi.fn>;
  readonly failPending: ReturnType<typeof vi.fn>;
  readonly stopDone: ReturnType<typeof vi.fn>;
  readonly serialRuns: () => number;
  reads: DesignationRead[];
  failAnswer: unknown;
  writeSetAnswer: { ok: true } | { ok: false; detail: string };
  limitsThrow: boolean;
}

function rig(read: DesignationRead = designated(OLD)): Rig {
  let held = 0;
  let runs = 0;
  const log: string[] = [];
  const at = (name: string): void => { log.push(`${name}${held > 0 ? ' [serial]' : ' [OUTSIDE]'}`); };
  const r: Rig = {
    log, reads: [read], failAnswer: { ok: true, changed: true }, writeSetAnswer: { ok: true }, limitsThrow: false,
    settleFact: vi.fn(async (_id: string): Promise<SettleFact> => ({ kind: 'no-report' })),
    settleAgain: vi.fn(async (_id: string, _startId: number) => ({ act: 'go-live' })),
    failPending: vi.fn(),
    stopDone: vi.fn(),
    serialRuns: () => runs,
    deps: undefined as never,
  };
  const body = {
    keepAwake: async (id: string, state: string) => { at(`keep-awake ${id} ${state}`); return { ok: true, foreign: [] }; },
    writeSet: async (id: string, set: { poolset: string; acctorder: string }) => {
      at(`write-set ${id} [${set.poolset}] [${set.acctorder}]`);
      return set.poolset === '' ? { ok: true } : r.writeSetAnswer;
    },
    writeClass: async (id: string, cls: string) => { at(`write-class ${id} ${cls}`); return { ok: true }; },
    clearProfile: async (id: string) => { at(`clear-profile ${id}`); return { ok: true }; },
    stop: async (id: string) => { at(`stop ${id}`); return { ok: true, absent: false }; },
  } as unknown as OverlordBody;
  r.failPending.mockImplementation((id: string, outcome: string, now: number, owes: boolean) => {
    at(`fail-pending ${id} ${outcome} ${now} ${owes}`);
    if ((r.failAnswer as { ok: boolean }).ok) r.reads.push(r.reads.at(-1)!); // the row after the write is the next read
    return r.failAnswer;
  });
  r.stopDone.mockImplementation((id: string) => { at(`stop-done ${id}`); return { ok: true, changed: true }; });
  const sequenceRead = (): DesignationRead => { at('designation-read'); return r.reads.length > 1 ? r.reads.shift()! : r.reads[0]!; };
  (r as { deps: OverlordLaneDeps }).deps = {
    serial: async (fn) => { held += 1; runs += 1; try { return await fn(); } finally { held -= 1; } },
    body,
    clock: { wall: () => NOW },
    coord: {
      designationRead: sequenceRead, failPending: r.failPending, stopDone: r.stopDone, accountPoolEdges: () => new Map(),
    } as unknown as OverlordLaneDeps['coord'],
    facts: {
      roster: () => ROSTER,
      limits: async () => {
        if (r.limitsThrow) throw new Error('the limits could not be read');
        return Object.fromEntries(ROSTER.accounts.map((a) => [a.id, limit({ disabled: a.id === 'lane-off' })]));
      },
      shares: async () => ({ kind: 'absent' }),
    },
    settle: { fact: r.settleFact as never, again: r.settleAgain as never },
  };
  return r;
}

describe('overlordLanePortOf: facts and resettle (designation B, Task 7)', () => {
  it('with no pending attempt, facts answers no-report beside the row and never asks the settle step', async () => {
    for (const read of [designated(OLD), notDesignated(), { kind: 'not-designated', row: null } as DesignationRead,
      { kind: 'unmeasured', why: 'locked' } as DesignationRead]) {
      const r = rig(read);
      expect(await overlordLanePortOf(r.deps).facts()).toStrictEqual({ read, settle: { kind: 'no-report' } });
      expect(r.settleFact).not.toHaveBeenCalled();
    }
  });

  it('with a pending attempt, facts asks the settle step for that session and answers its fact beside the row', async () => {
    const reported: SettleFact = { kind: 'reported', sessionId: NEW, startId: 4, generation: 'g-new', held: true };
    for (const read of [notDesignated({ pending: pendingOf(NEW) }), designated(OLD, { pending: pendingOf(NEW, 'rebind') })]) {
      const r = rig(read);
      r.settleFact.mockResolvedValue(reported);
      expect(await overlordLanePortOf(r.deps).facts()).toStrictEqual({ read, settle: reported });
      expect(r.settleFact).toHaveBeenCalledTimes(1);
      expect(r.settleFact).toHaveBeenCalledWith(NEW);
    }
  });

  it('resettle calls the settle step again with the session and the start, and answers what it did', async () => {
    const r = rig();
    r.settleAgain.mockResolvedValue({ act: 'refused' });
    expect(await overlordLanePortOf(r.deps).resettle(NEW, 7)).toStrictEqual({ act: 'refused' });
    expect(r.settleAgain).toHaveBeenCalledWith(NEW, 7);
    expect(r.settleAgain).toHaveBeenCalledTimes(1);
  });
});

describe('overlordLanePortOf: expire and drain (designation B, Task 7)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  it('expire records the failure at the wall clock with its stop owed, then drains the row\'s owed stops, all inside the serialiser', async () => {
    const r = rig(notDesignated({ pending: pendingOf(NEW), stopsOwed: [] }));
    // the row after the write names the failed body (and an older one still owed)
    r.reads = [notDesignated({ stopsOwed: [NEW, OLD] })];
    const out = await overlordLanePortOf(r.deps).expire(NEW, 'deadline-passed');
    expect(out).toStrictEqual({ changed: true });
    expect(r.failPending).toHaveBeenCalledWith(NEW, 'deadline-passed', NOW, true);
    expect(r.log).toStrictEqual([
      `fail-pending ${NEW} deadline-passed ${NOW} true [serial]`,
      'designation-read [serial]',
      `keep-awake ${NEW} off [serial]`, `write-set ${NEW} [] [] [serial]`, `clear-profile ${NEW} [serial]`, `stop ${NEW} [serial]`, `stop-done ${NEW} [serial]`,
      `keep-awake ${OLD} off [serial]`, `write-set ${OLD} [] [] [serial]`, `clear-profile ${OLD} [serial]`, `stop ${OLD} [serial]`, `stop-done ${OLD} [serial]`,
    ]);
    expect(r.serialRuns()).toBe(1);
  });

  it('expire carries the outcome it is given, and answers changed: false when the attempt was no longer pending', async () => {
    const r = rig(notDesignated({ stopsOwed: [] }));
    r.failAnswer = { ok: true, changed: false };
    expect(await overlordLanePortOf(r.deps).expire(NEW, 'authority-unrecorded')).toStrictEqual({ changed: false });
    expect(r.failPending).toHaveBeenCalledWith(NEW, 'authority-unrecorded', NOW, true);
    expect(r.log.filter((l) => l.startsWith('stop '))).toStrictEqual([]); // an empty owed list drains nothing
  });

  it('expire drains the id itself when the row can no longer be read after the write', async () => {
    const r = rig();
    r.reads = [{ kind: 'unmeasured', why: 'locked' }];
    await overlordLanePortOf(r.deps).expire(NEW, 'deadline-passed');
    expect(r.log.filter((l) => l.startsWith('stop '))).toStrictEqual([`stop ${NEW} [serial]`]);
    expect(r.stopDone).toHaveBeenCalledWith(NEW);
  });

  it('a refused failPending throws (the runner logs it), drains nothing and never reads the row again', async () => {
    for (const answer of [{ ok: false, reason: 'unmeasured', detail: 'the row holds a value it cannot narrow' },
      { ok: false, reason: 'bad-outcome' }]) {
      const r = rig(notDesignated({ pending: pendingOf(NEW) }));
      r.failAnswer = answer;
      await expect(overlordLanePortOf(r.deps).expire(NEW, 'deadline-passed')).rejects.toThrow(new RegExp(`${NEW}.*could not be recorded`));
      expect(r.log).toStrictEqual([`fail-pending ${NEW} deadline-passed ${NOW} true [serial]`]);
      expect(r.stopDone).not.toHaveBeenCalled();
    }
  });

  it('the refusal\'s own detail reaches the thrown message', async () => {
    const r = rig();
    r.failAnswer = { ok: false, reason: 'unmeasured', detail: 'stopsOwed is not json' };
    await expect(overlordLanePortOf(r.deps).expire(NEW, 'deadline-passed')).rejects.toThrow('stopsOwed is not json');
  });

  it('drain runs the owed-stop drain over the ids inside the serialiser and answers what it stopped', async () => {
    const r = rig();
    const out = await overlordLanePortOf(r.deps).drain([OLD, NEW, OLD]);
    expect(out).toStrictEqual({ stopped: [OLD, NEW], owed: [] });
    expect(r.log).toStrictEqual([
      `keep-awake ${OLD} off [serial]`, `write-set ${OLD} [] [] [serial]`, `clear-profile ${OLD} [serial]`, `stop ${OLD} [serial]`, `stop-done ${OLD} [serial]`,
      `keep-awake ${NEW} off [serial]`, `write-set ${NEW} [] [] [serial]`, `clear-profile ${NEW} [serial]`, `stop ${NEW} [serial]`, `stop-done ${NEW} [serial]`,
    ]);
    expect(r.serialRuns()).toBe(1);
  });

  it('drain of nothing makes no call', async () => {
    const r = rig();
    expect(await overlordLanePortOf(r.deps).drain([])).toStrictEqual({ stopped: [], owed: [] });
    expect(r.log).toStrictEqual([]);
  });
});

describe('overlordLanePortOf: beforeRenew, the write-set before a renewal (designation B, Task 10)', () => {
  it('for the bound id writes the set with the row\'s spelling and the ordered list, then the class, inside the serialiser', async () => {
    const r = rig(designated(OLD, { model: 'fable' }));
    expect(await overlordLanePortOf(r.deps).beforeRenew(OLD)).toStrictEqual({ ok: true });
    expect(r.log).toStrictEqual([
      'designation-read [serial]',
      `write-set ${OLD} [pool-a,pool-b] [lane-b,lane-a,lane-c] [serial]`,
      `write-class ${OLD} fable [serial]`,
    ]);
    expect(r.serialRuns()).toBe(1);
  });

  it('the class is the row\'s own: an opus row writes opus', async () => {
    const r = rig(designated(OLD, { model: 'opus', accountPools: { pools: ['pool-a'], untagged: false } }));
    expect(await overlordLanePortOf(r.deps).beforeRenew(OLD)).toStrictEqual({ ok: true });
    expect(r.log.slice(1)).toStrictEqual([`write-set ${OLD} [pool-a] [lane-a,lane-c] [serial]`, `write-class ${OLD} opus [serial]`]);
  });

  it('not designated, another session\'s renewal, an unmeasured row and an unspellable set answer ok: false and write nothing', async () => {
    const cases: [string, DesignationRead, string, RegExp][] = [
      ['no binding', notDesignated({ pending: pendingOf(NEW) }), OLD, /no Overlord is bound/],
      ['no row', { kind: 'not-designated', row: null }, OLD, /no Overlord is bound/],
      ['another session', designated(OLD), NEW, new RegExp(`${OLD}, not ${NEW}`)],
      ['unmeasured', { kind: 'unmeasured', why: 'locked' }, OLD, /could not be read: locked/],
      ['an empty set', designated(OLD, { accountPools: { pools: [], untagged: false } }), OLD, /empty/],
      ['no account in the set', designated(OLD, { accountPools: { pools: ['pool-z'], untagged: false } }), OLD, /list is empty/],
    ];
    for (const [name, read, id, detail] of cases) {
      const r = rig(read);
      const out = await overlordLanePortOf(r.deps).beforeRenew(id);
      expect(out.ok, name).toBe(false);
      expect(out.ok === false && out.detail, name).toMatch(detail);
      expect(r.log.filter((l) => l.startsWith('write-')), name).toStrictEqual([]);
    }
  });

  it('a failed writeSet answers its refusal and skips the class', async () => {
    const r = rig(designated(OLD));
    r.writeSetAnswer = { ok: false, detail: 'ccd route refused the set' };
    expect(await overlordLanePortOf(r.deps).beforeRenew(OLD)).toStrictEqual({ ok: false, detail: 'ccd route refused the set' });
    expect(r.log.filter((l) => l.startsWith('write-class'))).toStrictEqual([]);
    expect(r.log.filter((l) => l.startsWith('write-set'))).toHaveLength(1);
  });

  it('an account read that fails rejects, and nothing is written', async () => {
    const r = rig(designated(OLD));
    r.limitsThrow = true;
    await expect(overlordLanePortOf(r.deps).beforeRenew(OLD)).rejects.toThrow('the limits could not be read');
    expect(r.log.filter((l) => l.startsWith('write-'))).toStrictEqual([]);
  });
});
