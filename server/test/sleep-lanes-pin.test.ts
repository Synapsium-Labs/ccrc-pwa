// ARCH-43 (spec 2026-10-19 K1, §5.1 rule 1), the characterization commit: the two lanes that put a session to sleep,
// pinned side by side BEFORE they share one decider and one executor. `run-done` is the stop-done lane
// (`stopDoneVerdict`, `stopDonePass`); `idle-hours` is hibernation (`hibernateVerdict`, `hibernatePass`). Green on the
// old code. Every later move changes only what this file imports; a row that changes is a behaviour change and lands in
// a commit of its own, with its ruling.
//
// What it holds, in order: the decision matrix (every hold word each policy answers, alone and in every pair, so the
// ladder's order is measured, not read off the source); the boundary rows; the live-word rows; the difference table,
// one `it` per fact; the act-time rows, including today's gap (a kill switch raised between the pass and the act does
// not hold the act); two policies on one session in one tick; and the cadence rows, through the watcher's real sweeps.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withBindingsOf } from './bindingsFake.js';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  STOP_DONE_ACTOR, STOP_DONE_DISABLED_MARKER, STOP_DONE_GRACE_MS, STOP_DONE_HOLDS, STOP_DONE_MEASURES_PER_PASS,
  STOP_DONE_PARKED_IDLE_MS, STOP_DONE_PARKED_STATES, STOP_DONE_PER_PASS, STOP_DONE_RETRY_MS, STOP_DONE_SWEEP_MS,
  mailOnly, stopDoneVerdict, type StopDoneHeldKind, type StopDoneHold, type StopDoneInput, type StopDoneVerdict,
} from '../src/stopDone.js';
import {
  HIBERNATE_ACT_LINE_MS, HIBERNATE_AFTER_HOURS_FILE, HIBERNATE_AFTER_MS_DEFAULT, HIBERNATE_DISABLED_MARKER,
  HIBERNATE_HOLDS, HIBERNATE_LIVE_MARKER, HIBERNATE_PER_SWEEP, HIBERNATE_SHADOW_LINE_MS, HIBERNATE_SWEEP_ACTOR,
  HIBERNATE_SWEEP_MS, NO_HIBERNATE_SUFFIX,
  hibernateAfterMs, hibernateVerdict, type HibernateHold, type HibernateInput, type HibernateVerdict,
} from '../src/coord/hibernate.js';
import { heldKindOf, stopDonePass, type StopDoneMemory, type StopDoneSweepDeps } from '../src/stopDoneSweep.js';
import { hibernatePass, type HibernateActPort, type HibernateSweepDeps, type HibernateSweepMemory } from '../src/hibernateSweep.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { ACTOR_FLAGS_CAP, HIBERNATE_HOLD_OK_CAP } from '../src/ccdargv.js';
import { PRESENCE_OPEN_TTL_MS, type FleetSession } from '../../shared/api.js';
import type { SessionRecord } from '../src/registry.js';
import type { FleetState } from '../src/fleetstate.js';
import type { CcdResult } from '../src/lifecycle.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const GRACE = STOP_DONE_GRACE_MS;
const N = HIBERNATE_AFTER_MS_DEFAULT;
const STARTED = NOW - PRESENCE_OPEN_TTL_MS - MIN;
const ID = 'project-a-quiet-basin';
const PROGRAMME_HOLD = 'program:programme-a wave:2';

/** A `done` turn marker whose newest stamp is `ageMs` old, nothing in the background, nothing scheduled. */
const MARK = (ageMs: number) => ({
  ok: true as const, state: 'done', bg: 0, crons: 0, turnAt: NOW - ageMs - MIN, stopAt: NOW - ageMs, restartAt: null,
});

/** One row both lanes can read: a dispatched child, idle, nothing standing. */
const row = (id: string, o: Record<string, unknown> = {}): FleetSession => ({
  id, child: { kind: 'child', runId: 1 }, status: 'idle', archivedAt: null, bucket: 'idle', held: null, stoppedBy: null,
  unmeasured: [], statusUnmeasured: false, dialogPending: false, background: null, subagents: null, stranded: null,
  swapBlocked: null, substrate: null, ...o,
}) as unknown as FleetSession;
const rec = (id: string): SessionRecord => ({ id, uuid: `uuid-${id}`, wrapper: 'claude-a' }) as unknown as SessionRecord;
const STANDING = { at: NOW - MIN } as never;

// ── The decision matrix ────────────────────────────────────────────────────────────────────────────────────────────

type Mut<I> = (i: I) => I;
/** One rung of a ladder: the word it answers, the input fields it sets (two rungs that set one field cannot stand
 *  together), and the change that makes it stand. */
interface Rung<I, W extends string> { readonly name: string; readonly word: W; readonly touches: readonly string[]; readonly set: Mut<I>; readonly live?: true }

const word = (v: StopDoneVerdict | HibernateVerdict): string => (v.act === 'hold' ? v.reason : v.act);

// run-done's input: everything clear, the live state read and idle, the run closed past the grace, the marker 7 h quiet.
const SD: StopDoneInput = {
  row: row(ID) as unknown as StopDoneInput['row'], heldKind: 'none', holdOkVerb: true,
  store: { ok: true, last: { runId: 7, state: 'done', closedAt: NOW - GRACE - MIN }, openWorker: false, parkedWorker: false, openClaimant: false, claim: false, mail: false },
  viewer: false, sinceStartMs: PRESENCE_OPEN_TTL_MS + 1, viewerOpenTtlMs: PRESENCE_OPEN_TTL_MS, verb: true, optedOut: false,
  live: { kind: 'read', word: { ok: true, word: 'idle' }, turn: 'idle', mark: MARK(7 * HOUR) },
  now: NOW, graceMs: GRACE,
};
const sdRow = (o: Record<string, unknown>): Mut<StopDoneInput> => (i) => ({ ...i, row: { ...i.row, ...o } as StopDoneInput['row'] });
const sdIn = (o: Partial<StopDoneInput>): Mut<StopDoneInput> => (i) => ({ ...i, ...o });
const sdStore = (o: Record<string, unknown>): Mut<StopDoneInput> => (i) => ({ ...i, store: { ...i.store, ...o } as StopDoneInput['store'] });
const sdLast = (o: Record<string, unknown> | null): Mut<StopDoneInput> => (i) => (!i.store.ok ? i
  : sdStore({ last: o === null || i.store.last === null ? null : { ...i.store.last, ...o } })(i));
const sdLive = (o: Record<string, unknown>): Mut<StopDoneInput> => (i) => (i.live.kind === 'read' ? { ...i, live: { ...i.live, ...o } as StopDoneInput['live'] } : i);
const sdMark = (o: Record<string, unknown>): Mut<StopDoneInput> => (i) => (i.live.kind === 'read' && i.live.mark.ok
  ? { ...i, live: { ...i.live, mark: { ...i.live.mark, ...o } } as StopDoneInput['live'] } : i);
const sdv = (i: StopDoneInput): string => word(stopDoneVerdict(i));

/** run-done's ladder, as the verdict answers it (measured below, pair by pair). */
const RUN_DONE: readonly Rung<StopDoneInput, StopDoneHold>[] = [
  { name: 'not-a-child', word: 'not-a-child', touches: ['child'], set: sdRow({ child: { kind: 'none' } }) },
  { name: 'child-unreadable', word: 'child-unreadable', touches: ['child'], set: sdRow({ child: { kind: 'unreadable' } }) },
  { name: 'archived', word: 'archived', touches: ['archivedAt'], set: sdRow({ archivedAt: NOW - HOUR }) },
  { name: 'stopped', word: 'stopped', touches: ['stoppedBy'], set: sdRow({ stoppedBy: { at: NOW - HOUR, surface: 'agent' } }) },
  { name: 'unmeasured', word: 'unmeasured', touches: ['unmeasured'], set: sdRow({ unmeasured: ['uuid'] }) },
  { name: 'opted-out', word: 'opted-out', touches: ['optedOut'], set: sdIn({ optedOut: true }) },
  { name: 'held', word: 'held', touches: ['held'], set: (i) => sdIn({ heldKind: 'operator' })(sdRow({ held: 'the operator holds it' })(i)) },
  { name: 'stranded', word: 'stranded', touches: ['stranded'], set: sdRow({ stranded: STANDING }) },
  { name: 'swap-blocked', word: 'swap-blocked', touches: ['swapBlocked'], set: sdRow({ swapBlocked: STANDING }) },
  { name: 'substrate', word: 'substrate', touches: ['substrate'], set: sdRow({ substrate: STANDING }) },
  { name: 'runs-unreadable', word: 'runs-unreadable', touches: ['store.ok'], set: sdStore({ ok: false, detail: 'fixture' }) },
  { name: 'no-run', word: 'no-run', touches: ['last.state', 'last.closedAt'], set: sdLast(null) },
  { name: 'not-done', word: 'not-done', touches: ['last.state'], set: sdLast({ state: 'working' }) },
  { name: 'close-unplaced', word: 'close-unplaced', touches: ['last.closedAt'], set: sdLast({ closedAt: null }) },
  { name: 'grace', word: 'grace', touches: ['last.closedAt'], set: sdLast({ closedAt: NOW - GRACE + 1 }) },
  { name: 'run-worker', word: 'run-worker', touches: ['openWorker'], set: sdStore({ openWorker: true }) },
  { name: 'run-claimant', word: 'run-claimant', touches: ['openClaimant'], set: sdStore({ openClaimant: true }) },
  { name: 'claim', word: 'claim', touches: ['claim'], set: sdStore({ claim: true }) },
  { name: 'mail', word: 'mail', touches: ['mail'], set: sdStore({ mail: true }) },
  { name: 'viewer', word: 'viewer', touches: ['viewer'], set: sdIn({ viewer: true }) },
  { name: 'menu', word: 'menu', touches: ['dialogPending'], set: sdRow({ dialogPending: true }) },
  { name: 'bucket', word: 'bucket', touches: ['bucket'], set: sdRow({ bucket: 'done' }) },
  { name: 'background', word: 'background', touches: ['background'], set: sdRow({ background: STANDING }) },
  { name: 'roster', word: 'roster', touches: ['subagents'], set: sdRow({ subagents: [{ id: 'agent-a' }] }) },
  { name: 'no-verb', word: 'no-verb', touches: ['verb'], set: sdIn({ verb: false }) },
  { name: 'pane', word: 'pane', touches: ['word'], set: sdLive({ word: { ok: false, reason: 'no-pane' } }), live: true },
  { name: 'live-word', word: 'live-word', touches: ['word'], set: sdLive({ word: { ok: true, word: 'busy' } }), live: true },
  { name: 'turn', word: 'turn', touches: ['turn'], set: sdLive({ turn: 'busy' }), live: true },
  { name: 'marker', word: 'marker', touches: ['mark.state'], set: sdMark({ state: 'running' }), live: true },
  { name: 'marker-background', word: 'marker-background', touches: ['mark.bg'], set: sdMark({ bg: 1 }), live: true },
  { name: 'scheduled', word: 'scheduled', touches: ['mark.crons'], set: sdMark({ crons: 1 }), live: true },
  { name: 'recent', word: 'recent', touches: ['mark.stamps'], set: sdMark({ turnAt: NOW - 2 * MIN, stopAt: NOW - MIN }), live: true },
];
/** The other ways run-done reaches a word its ladder already holds. */
const RUN_DONE_ALSO: readonly Rung<StopDoneInput, StopDoneHold>[] = [
  { name: 'unmeasured (status)', word: 'unmeasured', touches: [], set: sdRow({ statusUnmeasured: true }) },
  { name: 'viewer (after a start)', word: 'viewer', touches: [], set: sdIn({ sinceStartMs: PRESENCE_OPEN_TTL_MS - 1 }) },
  { name: 'unmeasured (live word)', word: 'unmeasured', touches: [], set: sdLive({ word: { ok: false, reason: 'unmeasured' } }) },
  { name: 'pane (no config dir)', word: 'pane', touches: [], set: sdLive({ word: { ok: false, reason: 'no-config-dir' } }) },
  { name: 'unmeasured (turn verdict)', word: 'unmeasured', touches: [], set: sdLive({ turn: 'unmeasured' }) },
  { name: 'marker (unreadable)', word: 'marker', touches: [], set: sdLive({ mark: { ok: false, reason: 'foreign' } }) },
  { name: 'marker-background (bg -1)', word: 'marker-background', touches: [], set: sdMark({ bg: -1 }) },
  { name: 'scheduled (crons absent)', word: 'scheduled', touches: [], set: sdMark({ crons: null }) },
  { name: 'recent (no stamp)', word: 'recent', touches: [], set: sdMark({ turnAt: null, stopAt: null, restartAt: null }) },
];

// idle-hours' input: everything clear, the live state read and idle, the marker 7 h quiet (past the default N).
const HB: HibernateInput = {
  row: row(ID) as unknown as HibernateInput['row'], optedOut: false,
  store: { ok: true, openWorker: false, openClaimant: false, claim: false, mail: false },
  viewer: false, sinceStartMs: PRESENCE_OPEN_TTL_MS + 1,
  live: { kind: 'read', word: { ok: true, word: 'idle' }, mark: MARK(7 * HOUR) },
};
const hbRow = (o: Record<string, unknown>): Mut<HibernateInput> => (i) => ({ ...i, row: { ...i.row, ...o } as HibernateInput['row'] });
const hbIn = (o: Partial<HibernateInput>): Mut<HibernateInput> => (i) => ({ ...i, ...o });
const hbStore = (o: Record<string, unknown>): Mut<HibernateInput> => (i) => ({ ...i, store: { ...i.store, ...o } as HibernateInput['store'] });
const hbLive = (o: Record<string, unknown>): Mut<HibernateInput> => (i) => (i.live.kind === 'read' ? { ...i, live: { ...i.live, ...o } as HibernateInput['live'] } : i);
const hbMark = (o: Record<string, unknown>): Mut<HibernateInput> => (i) => (i.live.kind === 'read' && i.live.mark.ok
  ? { ...i, live: { ...i.live, mark: { ...i.live.mark, ...o } } as HibernateInput['live'] } : i);
const hbv = (i: HibernateInput, afterMs = N): string => word(hibernateVerdict(i, NOW, afterMs));

/** idle-hours' ladder, as the verdict answers it. */
const IDLE_HOURS: readonly Rung<HibernateInput, HibernateHold>[] = [
  { name: 'archived', word: 'archived', touches: ['archivedAt'], set: hbRow({ archivedAt: NOW - HOUR }) },
  { name: 'pane (row)', word: 'pane', touches: ['status'], set: hbRow({ status: 'dead' }) },
  { name: 'unmeasured', word: 'unmeasured', touches: ['unmeasured'], set: hbRow({ unmeasured: ['uuid'] }) },
  { name: 'opted-out', word: 'opted-out', touches: ['optedOut'], set: hbIn({ optedOut: true }) },
  { name: 'held', word: 'held', touches: ['held'], set: hbRow({ held: 'the operator holds it' }) },
  { name: 'stranded', word: 'stranded', touches: ['stranded'], set: hbRow({ stranded: STANDING }) },
  { name: 'swap-blocked', word: 'swap-blocked', touches: ['swapBlocked'], set: hbRow({ swapBlocked: STANDING }) },
  { name: 'substrate', word: 'substrate', touches: ['substrate'], set: hbRow({ substrate: STANDING }) },
  { name: 'runs-unreadable', word: 'runs-unreadable', touches: ['store.ok'], set: hbStore({ ok: false, detail: 'fixture' }) },
  { name: 'run-worker', word: 'run-worker', touches: ['openWorker'], set: hbStore({ openWorker: true }) },
  { name: 'run-claimant', word: 'run-claimant', touches: ['openClaimant'], set: hbStore({ openClaimant: true }) },
  { name: 'claim', word: 'claim', touches: ['claim'], set: hbStore({ claim: true }) },
  { name: 'mail', word: 'mail', touches: ['mail'], set: hbStore({ mail: true }) },
  { name: 'viewer', word: 'viewer', touches: ['viewer'], set: hbIn({ viewer: true }) },
  { name: 'menu', word: 'menu', touches: ['dialogPending'], set: hbRow({ dialogPending: true }) },
  { name: 'bucket', word: 'bucket', touches: ['bucket'], set: hbRow({ bucket: 'done' }) },
  { name: 'background', word: 'background', touches: ['background'], set: hbRow({ background: STANDING }) },
  { name: 'roster', word: 'roster', touches: ['subagents'], set: hbRow({ subagents: [{ id: 'agent-a' }] }) },
  { name: 'pane (word)', word: 'pane', touches: ['word'], set: hbLive({ word: { ok: false, reason: 'no-pane' } }), live: true },
  { name: 'live-word', word: 'live-word', touches: ['word'], set: hbLive({ word: { ok: true, word: 'busy' } }), live: true },
  { name: 'marker', word: 'marker', touches: ['mark.state'], set: hbMark({ state: 'running' }), live: true },
  { name: 'marker-background', word: 'marker-background', touches: ['mark.bg'], set: hbMark({ bg: 1 }), live: true },
  { name: 'scheduled', word: 'scheduled', touches: ['mark.crons'], set: hbMark({ crons: 1 }), live: true },
  { name: 'recent', word: 'recent', touches: ['mark.stamps'], set: hbMark({ turnAt: NOW - 2 * MIN, stopAt: NOW - MIN }), live: true },
];
const IDLE_HOURS_ALSO: readonly Rung<HibernateInput, HibernateHold>[] = [
  { name: 'archived (bucket)', word: 'archived', touches: [], set: hbRow({ bucket: 'archived' }) },
  { name: 'unmeasured (status)', word: 'unmeasured', touches: [], set: hbRow({ statusUnmeasured: true }) },
  { name: 'viewer (after a start)', word: 'viewer', touches: [], set: hbIn({ sinceStartMs: PRESENCE_OPEN_TTL_MS - 1 }) },
  { name: 'unmeasured (live word)', word: 'unmeasured', touches: [], set: hbLive({ word: { ok: false, reason: 'unmeasured' } }) },
  { name: 'pane (no config dir)', word: 'pane', touches: [], set: hbLive({ word: { ok: false, reason: 'no-config-dir' } }) },
  { name: 'marker (unreadable)', word: 'marker', touches: [], set: hbLive({ mark: { ok: false, reason: 'foreign' } }) },
  { name: 'marker-background (bg -1)', word: 'marker-background', touches: [], set: hbMark({ bg: -1 }) },
  { name: 'scheduled (crons absent)', word: 'scheduled', touches: [], set: hbMark({ crons: null }) },
  { name: 'recent (no stamp)', word: 'recent', touches: [], set: hbMark({ turnAt: null, stopAt: null, restartAt: null }) },
];

/** Every pair `(a, b)` of a ladder, `a` above `b`, that can stand together (no field both set). */
function pairsOf<I, W extends string>(ladder: readonly Rung<I, W>[]): Array<[Rung<I, W>, Rung<I, W>]> {
  const out: Array<[Rung<I, W>, Rung<I, W>]> = [];
  for (let a = 0; a < ladder.length; a++) {
    for (let b = a + 1; b < ladder.length; b++) {
      if (!ladder[a]!.touches.some((t) => ladder[b]!.touches.includes(t))) out.push([ladder[a]!, ladder[b]!]);
    }
  }
  return out;
}
const adjacent = <I, W extends string>(ladder: readonly Rung<I, W>[]) =>
  ladder.slice(1).map((b, k) => [ladder[k]!, b] as [Rung<I, W>, Rung<I, W>]);

describe('the decision matrix: run-done (stopDoneVerdict)', () => {
  it('the clear input sleeps, carrying its run and the marker\'s quiet, and no hold-ok text', () => {
    expect(stopDoneVerdict(SD)).toStrictEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR });
  });

  it('measure comes before any live read: the clear input, its live state unread, answers measure', () => {
    expect(stopDoneVerdict({ ...SD, live: { kind: 'unread' } })).toEqual({ act: 'measure' });
  });

  it.each(RUN_DONE.filter((r) => !r.live).map((r) => [r.name, r] as const))('every hold above the live reads answers without them: %s', (_n, r) => {
    expect(sdv(r.set({ ...SD, live: { kind: 'unread' } }))).toBe(r.word);
  });

  it.each([...RUN_DONE, ...RUN_DONE_ALSO].map((r) => [r.name, r] as const))('alone, %s answers its word', (_n, r) => {
    expect(sdv(r.set(SD))).toBe(r.word);
  });

  it('every word of STOP_DONE_HOLDS is reached', () => {
    expect([...new Set([...RUN_DONE, ...RUN_DONE_ALSO].map((r) => r.word))].sort()).toEqual([...STOP_DONE_HOLDS].sort());
  });

  it.each(adjacent(RUN_DONE).filter(([a, b]) => !a.touches.some((t) => b.touches.includes(t))).map(([a, b]) => [`${a.name} above ${b.name}`, a, b] as const))(
    'adjacent pair: %s', (_n, a, b) => {
      expect(sdv(b.set(a.set(SD)))).toBe(a.word);
    });

  it('every pair standing together answers the higher one (the whole ladder\'s order)', () => {
    const wrong = pairsOf(RUN_DONE).filter(([a, b]) => sdv(b.set(a.set(SD))) !== a.word).map(([a, b]) => `${a.name} + ${b.name}`);
    expect(wrong).toEqual([]);
  });

  it('a programme hold, or one naming a terminal run, passes with hibernate-hold-ok and carries its exact text', () => {
    for (const kind of ['programme', 'run-terminal'] as const) {
      const v = stopDoneVerdict({ ...SD, heldKind: kind, row: { ...SD.row, held: PROGRAMME_HOLD } });
      expect(v, kind).toStrictEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR, holdOk: PROGRAMME_HOLD });
    }
  });
});

describe('the decision matrix: idle-hours (hibernateVerdict)', () => {
  it('the clear input sleeps, carrying the marker\'s quiet', () => {
    expect(hibernateVerdict(HB, NOW, N)).toStrictEqual({ act: 'hibernate', idleMs: 7 * HOUR });
  });

  it('measure comes before any live read: the clear input, its live state unread, answers measure', () => {
    expect(hibernateVerdict({ ...HB, live: { kind: 'unread' } }, NOW, N)).toEqual({ act: 'measure' });
  });

  it.each(IDLE_HOURS.filter((r) => !r.live).map((r) => [r.name, r] as const))('every hold above the live reads answers without them: %s', (_n, r) => {
    expect(hbv(r.set({ ...HB, live: { kind: 'unread' } }))).toBe(r.word);
  });

  it.each([...IDLE_HOURS, ...IDLE_HOURS_ALSO].map((r) => [r.name, r] as const))('alone, %s answers its word', (_n, r) => {
    expect(hbv(r.set(HB))).toBe(r.word);
  });

  it('every word of HIBERNATE_HOLDS is reached', () => {
    expect([...new Set([...IDLE_HOURS, ...IDLE_HOURS_ALSO].map((r) => r.word))].sort()).toEqual([...HIBERNATE_HOLDS].sort());
  });

  it.each(adjacent(IDLE_HOURS).filter(([a, b]) => !a.touches.some((t) => b.touches.includes(t))).map(([a, b]) => [`${a.name} above ${b.name}`, a, b] as const))(
    'adjacent pair: %s', (_n, a, b) => {
      expect(hbv(b.set(a.set(HB)))).toBe(a.word);
    });

  it('every pair standing together answers the higher one (the whole ladder\'s order)', () => {
    const wrong = pairsOf(IDLE_HOURS).filter(([a, b]) => hbv(b.set(a.set(HB))) !== a.word).map(([a, b]) => `${a.name} + ${b.name}`);
    expect(wrong).toEqual([]);
  });
});

// ── The boundary rows ──────────────────────────────────────────────────────────────────────────────────────────────

/** A marker whose newest stamp is exactly `idleMs` old. */
const quiet = (idleMs: number) => ({ turnAt: NOW - idleMs - MIN, stopAt: NOW - idleMs, restartAt: null });

describe('the boundary rows', () => {
  it('idle-hours: idleMs equal to N holds recent', () => {
    expect(hbv(hbMark(quiet(N))(HB))).toBe('recent');
  });

  it('idle-hours: N + 1 ms sleeps', () => {
    expect(hibernateVerdict(hbMark(quiet(N + 1))(HB), NOW, N)).toStrictEqual({ act: 'hibernate', idleMs: N + 1 });
  });

  it('idle-hours: hibernate-after-hours, through hibernateAfterMs (whole hours 1 to 168, whitespace allowed)', () => {
    const cases: Array<[string | null, number]> = [
      [null, N], ['1', HOUR], ['168', 168 * HOUR], ['0', N], ['169', N], ['6.5', N], [' 6 ', 6 * HOUR], ['6h', N],
    ];
    expect(cases.map(([raw]) => hibernateAfterMs(raw))).toEqual(cases.map(([, ms]) => ms));
    expect(N).toBe(6 * HOUR);
  });

  it('run-done: a run closed exactly the grace ago passes grace; one ms later it holds', () => {
    expect(sdv(sdLast({ closedAt: NOW - GRACE })(SD))).toBe('hibernate');
    expect(sdv(sdLast({ closedAt: NOW - GRACE + 1 })(SD))).toBe('grace');
  });

  it('run-done: marker quiet exactly the grace sleeps; one ms less holds recent', () => {
    expect(sdv(sdMark(quiet(GRACE))(SD))).toBe('hibernate');
    expect(sdv(sdMark(quiet(GRACE - 1))(SD))).toBe('recent');
  });

  it('run-done: a parked run (awaiting-review, merging, closing) takes STOP_DONE_PARKED_IDLE_MS, with no close', () => {
    expect([...STOP_DONE_PARKED_STATES]).toEqual(['awaiting-review', 'merging', 'closing']);
    expect(STOP_DONE_PARKED_IDLE_MS).toBe(30 * MIN);
    for (const state of STOP_DONE_PARKED_STATES) {
      const parked = sdLast({ state, closedAt: null })(SD);
      expect(sdv(sdMark(quiet(STOP_DONE_PARKED_IDLE_MS))(parked)), state).toBe('hibernate');
      expect(sdv(sdMark(quiet(STOP_DONE_PARKED_IDLE_MS - 1))(parked)), state).toBe('recent');
      expect(sdv(sdMark(quiet(GRACE + 1))(parked)), state).toBe('recent');
    }
  });

  it('run-done: a done run with an older sibling parked run takes the parked clock too', () => {
    const sibling = sdStore({ parkedWorker: true })(SD);
    expect(sdv(sdMark(quiet(GRACE + 1))(sibling))).toBe('recent');
    expect(sdv(sdMark(quiet(STOP_DONE_PARKED_IDLE_MS))(sibling))).toBe('hibernate');
  });

  it('run-done: failed and closed sleeps like done (D-6092)', () => {
    expect(stopDoneVerdict(sdLast({ state: 'failed' })(SD))).toStrictEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR });
  });
});

// ── The live-word rows ─────────────────────────────────────────────────────────────────────────────────────────────

/** `turn-words-characterization.test.ts`'s corpus: the three words Claude Code writes and four it does not. */
const WORDS = ['idle', 'busy', 'shell', 'waiting', 'compacting', '', 'Idle'] as const;

describe('the live-word rows', () => {
  it('idle-hours reads turnSays(\'sleep\', …), run-done compares the raw word to idle, and they agree on every word', () => {
    const idleHours = WORDS.map((w) => hbv(hbLive({ word: { ok: true, word: w } })(HB)));
    const runDone = WORDS.map((w) => sdv(sdLive({ word: { ok: true, word: w } })(SD)));
    expect(idleHours).toEqual(['hibernate', 'live-word', 'live-word', 'live-word', 'live-word', 'live-word', 'live-word']);
    // They agree on the whole corpus, so C4b may give both policies the `sleep` turn policy.
    expect(runDone).toEqual(idleHours);
  });
});

// ── The pass fakes: one world both lanes read, so the window between the pass and the act can be written ────────────

const OK: CcdResult = { ran: true, ok: true, stdout: '', stderr: '', killed: false, signal: null };
const BUSY: CcdResult = { ran: true, ok: false, stdout: '', stderr: 'ccd: session-busy: attached', killed: false, signal: null };
const REFUSED: CcdResult = { ran: true, ok: false, stdout: '', stderr: 'refused', killed: false, signal: null };

interface World {
  now: number;
  /** `fleetState.ccdVerbs`, mutated in place: the act-time verb question reads it. */
  readonly verbs: string[];
  readonly runState: Map<string, string>;
  readonly openWorker: Set<string>;
  readonly mail: Set<string>;
  readonly viewers: Set<string>;
  readonly words: Map<string, string>;
  readonly turns: Map<string, 'idle' | 'busy' | 'unmeasured'>;
  /** What the record re-read at the act adds to the row; `vanished`: the re-read fails. */
  readonly atAct: Map<string, Record<string, unknown>>;
  readonly vanished: Set<string>;
  /** Sessions a `ccd hibernate` put down: their re-read row carries the stop stamp and a dead pane. */
  readonly stopped: Set<string>;
  readonly argv: string[][];
  readonly events: string[];
  readonly lines: string[];
  readonly feed: Array<{ kind: string; sessionId: string; runId: number | null; title: string; body: string }>;
  answer: (argv: readonly string[]) => CcdResult;
  /** Runs on entering the coordination serialiser: the window between the pass and the act. */
  beforeAct: () => void;
  serial: boolean;
}
const world = (): World => ({
  now: NOW, verbs: ['hibernate', ACTOR_FLAGS_CAP, HIBERNATE_HOLD_OK_CAP], runState: new Map(), openWorker: new Set(),
  mail: new Set(), viewers: new Set(), words: new Map(), turns: new Map(), atAct: new Map(), vanished: new Set(),
  stopped: new Set(), argv: [], events: [], lines: [], feed: [], answer: () => OK, beforeAct: () => undefined, serial: true,
});
const idOf = (argv: readonly string[]): string => argv[argv.indexOf('--surface') - 1]!;

const runCcdOf = (w: World): StopDoneSweepDeps['runCcd'] => async (a) => {
  w.events.push(`ccd ${idOf(a)}`);
  w.argv.push([...a]);
  const r = w.answer(a);
  if (r.ok) w.stopped.add(idOf(a));
  return r;
};
const rowAtActOf = (w: World) => async (r: SessionRecord) => (w.vanished.has(r.id) ? { ok: false as const } : {
  ok: true as const,
  row: row(r.id, { ...(w.stopped.has(r.id) ? { stoppedBy: { at: NOW, surface: 'agent' }, status: 'dead' } : {}), ...w.atAct.get(r.id) }) as never,
});
const serialOf = (w: World) => (w.serial ? async <T>(fn: () => Promise<T>): Promise<T> => { w.events.push('serial'); w.beforeAct(); return fn(); } : null);
const queueOf = (w: World) => async <T>(id: string, fn: () => Promise<T>): Promise<T> => { w.events.push(`queue ${id}`); return fn(); };
const liveWordOf = (w: World) => async (r: SessionRecord) => {
  w.events.push(`word ${r.id}`);
  return { ok: true as const, word: w.words.get(r.id) ?? 'idle', since: null };
};
const markOf = (w: World) => async (r: SessionRecord) => { w.events.push(`mark ${r.id}`); return MARK(7 * HOUR); };

/** The stop-done lane's deps over the world. */
function sdDeps(w: World): StopDoneSweepDeps {
  return {
    coord: {
      lastRunBySession: (asked: readonly string[]) => ({
        ok: true, last: [], openWorkers: [], openClaimants: [],
        lastPlaced: asked.map((sessionId) => ({
          sessionId, runId: 10, state: w.runState.get(sessionId) ?? 'done', closedAt: NOW - GRACE - MIN,
          program: 'p', programTitle: null, claimedBy: 'lane-a-project-a',
        })),
        openPlacedWorkers: asked.filter((id) => w.openWorker.has(id)), parkedPlacedWorkers: [],
      }) as never,
      activeClaims: () => [],
      outstandingMailFor: (id: string) => (w.mail.has(id) ? [{ parkedAt: null }] : []) as never,
      recordFeedEvent: () => undefined,
      run: (runId: number) => ({ ok: true, run: { id: runId, state: 'working', reviews: null } }) as never,
    },
    runCcd: runCcdOf(w),
    fleetState: { ccdVerbs: w.verbs } as unknown as FleetState,
    viewers: { isOpen: (id: string) => w.viewers.has(id) },
    notifyLog: {
      epoch: 'e',
      record: (e: World['feed'][number]) => { w.feed.push(e); return { ...e, seq: w.feed.length, at: NOW }; },
      flush: async () => undefined,
    } as unknown as StopDoneSweepDeps['notifyLog'],
    liveWord: liveWordOf(w),
    turnVerdict: async (r) => { w.events.push(`turn ${r.id}`); return w.turns.get(r.id) ?? 'idle'; },
    mark: markOf(w),
    rowAtAct: rowAtActOf(w),
    serial: serialOf(w),
    queueRun: queueOf(w),
    startedAt: STARTED,
    now: () => w.now,
  };
}

/** Hibernation's deps over the world; `act: null` is a shadow-only harness. */
function hbDeps(w: World, o: { act?: boolean } = {}): HibernateSweepDeps {
  const port: HibernateActPort = {
    runCcd: runCcdOf(w), fleetState: { ccdVerbs: w.verbs } as unknown as FleetState, serial: serialOf(w),
    queueRun: queueOf(w), rowAtAct: rowAtActOf(w),
  };
  return {
    coord: withBindingsOf({
      openRunsForSession: ((id: string, _e?: number, _i?: undefined, role?: 'worker' | 'claimant') => ({
        ok: true, siblings: role !== 'claimant' && w.openWorker.has(id) ? [{ id: 1, program: 'program-a', wave: 1, waveOf: 1 }] : [],
      })) as never,
      activeClaims: () => [],
      outstandingMailFor: (id: string) => (w.mail.has(id) ? [{ parkedAt: null }] : []) as never,
    }),
    viewers: { isOpen: (id: string) => w.viewers.has(id) },
    liveWord: liveWordOf(w),
    mark: markOf(w),
    readAfterHours: async () => null,
    log: (l) => { w.lines.push(l); },
    startedAt: STARTED,
    now: () => w.now,
    act: o.act === false ? null : port,
  };
}
const sdMem = (): StopDoneMemory => ({ retryAt: new Map() });
const hbMem = (): HibernateSweepMemory => ({ lastLine: new Map(), lastActLine: new Map() });
const ids = (n: number): string[] => Array.from({ length: n }, (_, k) => `project-a-basin-${k}`);
const sdPass = (w: World, names: string[] = [], list = [ID], m = sdMem()) =>
  stopDonePass(sdDeps(w), m, list.map((id) => row(id)), list.map(rec), names);
const hbPass = (w: World, names: string[] = [HIBERNATE_LIVE_MARKER], list = [ID], m = hbMem()) =>
  hibernatePass(hbDeps(w), m, list.map((id) => row(id)), list.map(rec), names);
const HIB_SD = (id: string, ...holdOk: string[]): string[] => ['hibernate', ...holdOk, id, '--surface', 'agent', '--actor', 'sweep:stop-done'];
const HIB_HB = (id: string): string[] => ['hibernate', id, '--surface', 'agent', '--actor', 'sweep:hibernate'];

// ── A watcher, for the rows that drive the real sweepStopDone / sweepHibernate ────────────────────────────────────

function watcherWith(extra: Record<string, unknown>) {
  const home = mkTmp('ccrc-sleep-pin-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const deps: Record<string, unknown> = { ...testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' })), cfg, ...extra };
  const w = new FleetWatcher(deps as never, new Bus(), 10_000);
  return { w, deps };
}
/** A listing that counts its reads: a pass that ran asked it for its switches first. */
const probe = () => Object.assign([] as string[], { includes: vi.fn((_s: string) => false) });
const atClock = (t: number) => vi.spyOn(Date, 'now').mockReturnValue(t);

// ── The difference table, one row per fact ─────────────────────────────────────────────────────────────────────────

describe('the difference table (run-done | idle-hours), one row each', () => {
  it('differs: the holds before opted-out', () => {
    const opted = sdIn({ optedOut: true })(SD);
    expect([
      sdRow({ child: { kind: 'none' } }), sdRow({ child: { kind: 'unreadable' } }), sdRow({ archivedAt: NOW - HOUR }),
      sdRow({ stoppedBy: { at: NOW, surface: 'agent' } }), sdRow({ unmeasured: ['uuid'] }),
      sdRow({ bucket: 'archived' }), sdRow({ status: 'dead' }),
    ].map((m) => sdv(m(opted)))).toEqual(['not-a-child', 'child-unreadable', 'archived', 'stopped', 'unmeasured', 'opted-out', 'opted-out']);
    const hopted = hbIn({ optedOut: true })(HB);
    expect([
      hbRow({ archivedAt: NOW - HOUR }), hbRow({ bucket: 'archived' }), hbRow({ status: 'dead' }), hbRow({ unmeasured: ['uuid'] }),
      hbRow({ child: { kind: 'none' } }), hbRow({ stoppedBy: { at: NOW, surface: 'agent' } }),
    ].map((m) => hbv(m(hopted)))).toEqual(['archived', 'archived', 'pane', 'unmeasured', 'opted-out', 'opted-out']);
    expect(hbv(hbRow({ child: { kind: 'none' } })(HB)), 'idle-hours puts a non-child to sleep').toBe('hibernate');
  });

  it('differs: held — run-done passes a programme hold or a terminal run\'s, only with hibernate-hold-ok; idle-hours holds any', () => {
    const coord = { run: (id: number) => ({ ok: true, run: { id, state: id === 5 ? 'done' : 'working' } }) as never };
    const kinds: Array<[string | null, StopDoneHeldKind]> = [
      [null, 'none'], ['the operator holds it', 'operator'], [PROGRAMME_HOLD, 'programme'],
      [`${PROGRAMME_HOLD} run:5`, 'run-terminal'], [`${PROGRAMME_HOLD} run:6`, 'run-live'],
    ];
    expect(kinds.map(([t]) => heldKindOf(t, coord))).toEqual(kinds.map(([, k]) => k));
    const held = (k: StopDoneHeldKind, holdOkVerb = true) => sdv({ ...SD, heldKind: k, holdOkVerb, row: { ...SD.row, held: PROGRAMME_HOLD } });
    expect((['programme', 'run-terminal', 'operator', 'run-live', 'unreadable', 'none'] as const).map((k) => held(k)))
      .toEqual(['hibernate', 'hibernate', 'held', 'held', 'held', 'held']);
    expect(held('programme', false), 'no hold-ok token: held').toBe('held');
    expect([PROGRAMME_HOLD, `${PROGRAMME_HOLD} run:5`, 'the operator holds it'].map((t) => hbv(hbRow({ held: t })(HB))))
      .toEqual(['held', 'held', 'held']);
  });

  it('differs: the run clock — run-done holds no-run, not-done, close-unplaced and grace after runs-unreadable; idle-hours has none', () => {
    expect([sdLast(null), sdLast({ state: 'working' }), sdLast({ closedAt: null }), sdLast({ closedAt: NOW - 1 })].map((m) => sdv(m(SD))))
      .toEqual(['no-run', 'not-done', 'close-unplaced', 'grace']);
    expect(sdv(sdStore({ ok: false, detail: 'x', last: null })(SD))).toBe('runs-unreadable');
    expect(Object.keys(HB.store).sort(), 'idle-hours\' store read carries no run').toEqual(['claim', 'mail', 'ok', 'openClaimant', 'openWorker']);
  });

  it('differs: run-worker — run-done counts an ACTIVE placed run, idle-hours any non-terminal run (a planned one, on a real store)', async () => {
    const store = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-sleep-pin-store-'), '.ccrc', 'coord.db')));
    try {
      const done = store.openRun({ program: 'p', title: 't', project: 'project-a', wave: 1, waveOf: 2, claimedBy: 'lane-a-project-a' });
      if (!('id' in done)) throw new Error('fixture openRun refused');
      store.markDispatched(done.id, ID, ID, `ws/${ID}`, false);
      for (const to of ['dispatched', 'working'] as const) if (!store.advance(done.id, to, 'test').ok) throw new Error(to);
      if (!store.closeRun({ runId: done.id, finalState: 'done', causedBy: 'test', handoffCommit: null, program: 'p', viaClosing: true }).ok) throw new Error('close');
      store.db.prepare('UPDATE runs SET closedAt = ? WHERE id = ?').run(NOW - GRACE - MIN, done.id);
      const planned = store.openRun({ program: 'p', title: 't', project: 'project-a', wave: 2, waveOf: 2, claimedBy: 'lane-a-project-a' });
      if (!('id' in planned)) throw new Error('fixture openRun refused');
      store.setSession(planned.id, ID);
      store.db.prepare("UPDATE runs SET state = 'planned' WHERE id = ?").run(planned.id);
      const w = world();
      const sd = await stopDonePass({ ...sdDeps(w), coord: store }, sdMem(), [row(ID)], [rec(ID)], []);
      expect(sd, 'run-done: the planned run does not hold').toEqual([{ id: ID, kind: 'hibernated', runId: done.id }]);
      const hb = await hibernatePass({ ...hbDeps(w), coord: store }, hbMem(), [row(ID)], [rec(ID)], [HIBERNATE_LIVE_MARKER]);
      expect(hb.map((o) => o.verdict), 'idle-hours: the planned run holds').toEqual([{ act: 'hold', reason: 'run-worker' }]);
    } finally {
      store.db.close();
    }
  });

  it('differs: the verb — run-done holds no-verb before measure; idle-hours has no such hold and stays unarmed without it', async () => {
    expect(sdv(sdIn({ verb: false, live: { kind: 'unread' } })(SD))).toBe('no-verb');
    const sd = world();
    sd.verbs.splice(0, sd.verbs.length, ACTOR_FLAGS_CAP);
    expect(await sdPass(sd)).toEqual([]);
    expect(sd.events.filter((e) => e.startsWith('word')), 'run-done measures nothing').toEqual([]);
    const hb = world();
    hb.verbs.splice(0, hb.verbs.length, ACTOR_FLAGS_CAP);
    const out = await hbPass(hb);
    expect(out).toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR } }]);
    expect(hb.argv).toEqual([]);
    expect(hb.lines).toEqual([`ccrc-server: hibernate-shadow ${ID} idle=7h`]);
  });

  it('idle-hours asks the verb again beside the act', async () => {
    const w = world();
    w.beforeAct = () => { w.verbs.splice(w.verbs.indexOf('hibernate'), 1); };
    const out = await hbPass(w);
    expect(out).toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR }, act: { kind: 'skipped', detail: 'no-verb' } }]);
    expect(w.argv).toEqual([]);
  });

  it('differs: the live reads — run-done reads the word, the turn verdict and the marker; idle-hours the word and the marker', async () => {
    const sd = world();
    sd.turns.set(ID, 'busy');
    await sdPass(sd);
    expect(sd.events).toEqual([`word ${ID}`, `turn ${ID}`, `mark ${ID}`]);
    const hb = world();
    await hbPass(hb, []);
    expect(hb.events).toEqual([`word ${ID}`, `mark ${ID}`]);
  });

  it('differs: recent — run-done holds while idleMs < its threshold, idle-hours while idleMs <= N', () => {
    expect(sdv(sdMark(quiet(GRACE))(SD))).toBe('hibernate');
    expect(hbv(hbMark(quiet(N))(HB))).toBe('recent');
  });

  it('differs: the kill switches — run-done stops for three, idle-hours for hibernate-disabled alone', async () => {
    for (const k of [STOP_DONE_DISABLED_MARKER, RECLAIM_PAUSE_MARKER, HIBERNATE_DISABLED_MARKER]) {
      const w = world();
      expect(await sdPass(w, [k]), k).toEqual([]);
      expect(w.events, k).toEqual([]);
    }
    const off = world();
    expect(await hbPass(off, [HIBERNATE_LIVE_MARKER, HIBERNATE_DISABLED_MARKER])).toEqual([]);
    expect(off.events).toEqual([]);
    const sdOff = world();
    expect((await hbPass(sdOff, [HIBERNATE_LIVE_MARKER, STOP_DONE_DISABLED_MARKER]))[0]!.act, 'stop-done-disabled is not idle-hours\'').toEqual({ kind: 'hibernated' });
  });

  it('reclaim-paused does not stop idle-hours', async () => {
    const w = world();
    const out = await hbPass(w, [HIBERNATE_LIVE_MARKER, RECLAIM_PAUSE_MARKER]);
    expect(out).toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR }, act: { kind: 'hibernated' } }]);
    expect(w.argv).toEqual([HIB_HB(ID)]);
  });

  it('differs: arming — run-done is live with no marker; idle-hours acts only with hibernate-live, the verb and the serialiser', async () => {
    const sd = world();
    expect(await sdPass(sd, [])).toEqual([{ id: ID, kind: 'hibernated', runId: 10 }]);
    const unarmed = world();
    await hbPass(unarmed, []);
    expect(unarmed.argv).toEqual([]);
    expect(unarmed.lines).toEqual([`ccrc-server: hibernate-shadow ${ID} idle=7h`]);
    const noSerial = world();
    noSerial.serial = false;
    await hbPass(noSerial);
    expect(noSerial.argv).toEqual([]);
    expect(noSerial.lines).toEqual([`ccrc-server: hibernate-shadow ${ID} idle=7h`]);
    const armed = world();
    await hbPass(armed);
    expect(armed.argv).toEqual([HIB_HB(ID)]);
  });

  it('differs: the store — run-done needs it (no coord: the lane does not run, its clock unstamped); idle-hours holds runs-unreadable', async () => {
    const { w, deps } = watcherWith({ coord: undefined });
    atClock(NOW);
    const names = probe();
    await w.sweepStopDone([], [], names);
    expect(names.includes, 'no coord: nothing ran').not.toHaveBeenCalled();
    deps.coord = {};
    await w.sweepStopDone([], [], names);
    expect(names.includes, 'the clock was not stamped: the same instant runs').toHaveBeenCalled();
    const hb = await hibernatePass({ ...hbDeps(world()), coord: undefined }, hbMem(), [row(ID)], [rec(ID)], [HIBERNATE_LIVE_MARKER]);
    expect(hb.map((o) => o.verdict)).toEqual([{ act: 'hold', reason: 'runs-unreadable' }]);
  });

  it('differs: the serialiser not handed over — run-done measures and acts on nothing; idle-hours stays in shadow', async () => {
    const sd = world();
    sd.serial = false;
    expect(await sdPass(sd)).toEqual([]);
    expect(sd.events).toEqual([]);
    const hb = world();
    hb.serial = false;
    expect(await hbPass(hb)).toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR } }]);
    expect(hb.lines).toEqual([`ccrc-server: hibernate-shadow ${ID} idle=7h`]);
  });

  it('differs: the population — run-done takes dispatched children, not stopped, not archived, with a record, not in retry, by id; idle-hours every row with a record, in frame order', async () => {
    const rows = [
      row('c-child'), row('a-child'), row('b-stopped', { stoppedBy: { at: NOW, surface: 'agent' } }),
      row('d-archived', { archivedAt: NOW - HOUR }), row('e-own', { child: { kind: 'none' } }), row('f-no-record'), row('g-retry'),
    ];
    const recs = ['c-child', 'a-child', 'b-stopped', 'd-archived', 'e-own', 'g-retry'].map(rec);
    const sd = world();
    const m = sdMem();
    m.retryAt.set('g-retry', NOW + HOUR);
    await stopDonePass(sdDeps(sd), m, rows, recs, []);
    expect(sd.events.filter((e) => e.startsWith('word')).slice(0, 2)).toEqual(['word a-child', 'word c-child']);
    expect(sd.argv.map(idOf)).toEqual(['a-child', 'c-child']);
    const hb = world();
    const out = await hibernatePass(hbDeps(hb, { act: false }), hbMem(), rows, recs, []);
    expect(out.map((o) => [o.id, word(o.verdict)])).toEqual([
      ['c-child', 'hibernate'], ['a-child', 'hibernate'], ['b-stopped', 'hibernate'], ['d-archived', 'archived'],
      ['e-own', 'hibernate'], ['g-retry', 'hibernate'],
    ]);
  });

  it('run-done measures at most 6 a pass', async () => {
    const w = world();
    for (const id of ids(8)) w.turns.set(id, 'busy');
    await sdPass(w, [], ids(8));
    expect(w.events.filter((e) => e.startsWith('word')).length).toBe(6);
    expect(STOP_DONE_MEASURES_PER_PASS).toBe(6);
  });

  it('differs: per pass — run-done at most 3 acts and 6 measures, stopping at either; idle-hours at most 3 acts, measures unbounded', async () => {
    expect([STOP_DONE_PER_PASS, HIBERNATE_PER_SWEEP]).toEqual([3, 3]);
    const sd = world();
    await sdPass(sd, [], ids(5));
    expect(sd.argv.map(idOf)).toEqual(ids(3));
    const firstAct = sd.events.indexOf('serial');
    expect(sd.events.slice(0, firstAct).filter((e) => e.startsWith('word')).length, 'it stops measuring once 3 are due').toBe(3);
    const hb = world();
    const out = await hbPass(hb, [HIBERNATE_LIVE_MARKER], ids(5));
    expect(hb.argv.map(idOf)).toEqual(ids(3));
    expect(out.map((o) => o.act?.kind ?? null)).toEqual(['hibernated', 'hibernated', 'hibernated', null, null]);
    expect(hb.lines.filter((l) => l.includes('hibernate-shadow')), 'past the bound a row waits, unlogged').toEqual([]);
    const busy = world();
    for (const id of ids(8)) busy.words.set(id, 'busy');
    await hbPass(busy, [HIBERNATE_LIVE_MARKER], ids(8));
    expect(busy.events.filter((e) => e.startsWith('word')).length).toBe(8);
  });

  it('differs: when it acts — run-done after the loop, in id order; idle-hours inline, as each row is reached', async () => {
    const sd = world();
    await sdPass(sd, [], ['b-row', 'a-row']);
    expect(sd.events.slice(0, 7)).toEqual(['word a-row', 'turn a-row', 'mark a-row', 'word b-row', 'turn b-row', 'mark b-row', 'serial']);
    const hb = world();
    await hbPass(hb, [HIBERNATE_LIVE_MARKER], ['b-row', 'a-row']);
    expect(hb.events.slice(0, 7)).toEqual(['word b-row', 'mark b-row', 'serial', 'queue b-row', 'word b-row', 'mark b-row', 'ccd b-row']);
  });

  it('run-done remembers a refused act for an hour', async () => {
    const w = world();
    w.answer = () => BUSY;
    const m = sdMem();
    expect(await sdPass(w, [], [ID], m)).toEqual([{ id: ID, kind: 'skipped', detail: 'attached' }]);
    expect(m.retryAt.get(ID)).toBe(NOW + HOUR);
    expect(STOP_DONE_RETRY_MS).toBe(HOUR);
    await sdPass(w, [], [ID], m);
    expect(w.argv, 'not asked again inside the hour').toHaveLength(1);
    w.now = NOW + HOUR;
    await sdPass(w, [], [ID], m);
    expect(w.argv, 'asked again once the hour is up').toHaveLength(2);
  });

  it('differs: retry memory — run-done also after a refusal or a throw; idle-hours none, its lines throttled hourly per id and pruned', async () => {
    for (const answer of [() => REFUSED, () => { throw new Error('boom'); }]) {
      const w = world();
      w.answer = answer;
      const m = sdMem();
      await sdPass(w, [], [ID], m);
      expect(m.retryAt.get(ID)).toBe(NOW + HOUR);
    }
    const hb = world();
    hb.answer = () => BUSY;
    const m = hbMem();
    await hbPass(hb, [HIBERNATE_LIVE_MARKER], [ID], m);
    await hbPass(hb, [HIBERNATE_LIVE_MARKER], [ID], m);
    expect(hb.argv, 'asked again next sweep').toHaveLength(2);
    expect(hb.lines, 'one skip line inside the hour').toHaveLength(1);
    expect(HIBERNATE_ACT_LINE_MS).toBe(HOUR);
    hb.now = NOW + HOUR;
    await hbPass(hb, [HIBERNATE_LIVE_MARKER], [ID], m);
    expect(hb.lines).toHaveLength(2);
    expect(m.lastActLine.has(ID)).toBe(true);
    await hbPass(hb, [HIBERNATE_LIVE_MARKER], [], m);
    expect(m.lastActLine.has(ID), 'pruned of an id the pass no longer sees').toBe(false);
    const sh = world();
    const ms = hbMem();
    await hbPass(sh, [], [ID], ms);
    sh.now = NOW + HIBERNATE_SWEEP_MS;
    await hbPass(sh, [], [ID], ms);
    expect(sh.lines, 'one shadow line an hour per id').toHaveLength(1);
    expect(HIBERNATE_SHADOW_LINE_MS).toBe(HOUR);
    await hbPass(sh, [], [], ms);
    expect(ms.lastLine.has(ID)).toBe(false);
  });

  it('differs: the feed — run-done records Worker asleep and the mail-only count; idle-hours writes none', async () => {
    const w = world();
    const m = sdMem();
    await sdPass(w, [], [ID], m);
    expect(w.feed).toEqual([
      { kind: 'coord', sessionId: '', runId: null, title: 'Workers kept awake by unread mail: 0',
        body: '0 finished worker(s) stay awake for unread mail to them, with nothing in the coordination store or their workspace holding them besides; their panes are measured once it is read.' },
      { kind: 'run', sessionId: ID, runId: 10, title: 'Worker asleep',
        body: `${ID} was put to sleep: its run 10 is done and it sat idle. Mail, a re-dispatch or a restart wakes it.` },
    ]);
    await sdPass(w, [], [ID], m);
    expect(w.feed, 'an unchanged count writes no second row').toHaveLength(2);
    expect(mailOnly(sdStore({ mail: true })(SD))).toBe(true);
    expect(mailOnly(sdIn({ viewer: true })(sdStore({ mail: true })(SD))), 'mail beside another hold is not counted').toBe(false);
    const hb = world();
    const record = vi.fn();
    await hibernatePass({ ...hbDeps(hb), notifyLog: { record, flush: vi.fn() } } as unknown as HibernateSweepDeps, hbMem(), [row(ID)], [rec(ID)], [HIBERNATE_LIVE_MARKER]);
    expect(hb.argv).toEqual([HIB_HB(ID)]);
    expect(record).not.toHaveBeenCalled();
  });

  it('differs: the log lines, byte for byte', async () => {
    const warns: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((l: unknown) => { warns.push(String(l)); });
    for (const [answer, line] of [
      [() => OK, `ccrc-server: stop-done: put ${ID} to sleep (run 10 done, idle; D-5370, D-5427, D-6091, D-6092)`],
      [() => BUSY, `ccrc-server: stop-done: ccd re-measured ${ID} as attached — not asked again for an hour`],
      [() => REFUSED, `ccrc-server: stop-done: the hibernate of ${ID} failed (refused) — not asked again for an hour`],
    ] as const) {
      warns.length = 0;
      const w = world();
      w.answer = answer;
      await sdPass(w);
      expect(warns).toEqual([line]);
    }
    const two = world();
    const order: string[] = [];
    two.events.push = (...e: string[]) => { order.push(...e); return 0; };
    vi.spyOn(console, 'warn').mockImplementation(() => { order.push('warn'); });
    await sdPass(two, [], ['a-row', 'b-row']);
    expect(order.slice(order.lastIndexOf('ccd b-row')), 'run-done logs after the loop').toEqual(['ccd b-row', 'warn', 'warn']);
    for (const [names, answer, line] of [
      [[], () => OK, `ccrc-server: hibernate-shadow ${ID} idle=7h`],
      [[HIBERNATE_LIVE_MARKER], () => OK, `ccrc-server: hibernated ${ID} idle=7h (D-5242)`],
      [[HIBERNATE_LIVE_MARKER], () => BUSY, `ccrc-server: hibernate-skip ${ID}: ccd re-measured it as attached — asked again next sweep`],
      [[HIBERNATE_LIVE_MARKER], () => REFUSED, `ccrc-server: hibernate of ${ID} failed (refused) — asked again next sweep`],
      [[HIBERNATE_LIVE_MARKER], () => { throw new Error('boom'); }, `ccrc-server: hibernate of ${ID} failed (boom) — asked again next sweep`],
    ] as const) {
      const w = world();
      w.answer = answer;
      await hbPass(w, [...names]);
      expect(w.lines).toEqual([line]);
    }
  });

  it('differs: the actor — sweep:stop-done (with --hold-ok <text> when passed) | sweep:hibernate', async () => {
    expect([STOP_DONE_ACTOR, HIBERNATE_SWEEP_ACTOR]).toEqual(['sweep:stop-done', 'sweep:hibernate']);
    const sd = world();
    await sdPass(sd);
    expect(sd.argv).toEqual([HIB_SD(ID)]);
    const held = world();
    held.atAct.set(ID, { held: PROGRAMME_HOLD });
    await stopDonePass(sdDeps(held), sdMem(), [row(ID, { held: PROGRAMME_HOLD })], [rec(ID)], []);
    expect(held.argv).toEqual([HIB_SD(ID, '--hold-ok', PROGRAMME_HOLD)]);
    const hb = world();
    await hbPass(hb);
    expect(hb.argv).toEqual([HIB_HB(ID)]);
  });

  it('differs: the catch line — sweepStopDone: no stops this pass | sweepHibernate: no verdicts this pass', async () => {
    const warns: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((l: unknown) => { warns.push(String(l)); });
    const { w } = watcherWith({ coord: {} });
    const broken = Object.assign([] as string[], { includes: () => { throw new Error('boom'); } });
    await w.sweepStopDone([], [], broken);
    await w.sweepHibernate([], [], broken);
    expect(warns.filter((l) => l.startsWith('ccrc-server: sweep'))).toEqual([
      'ccrc-server: sweepStopDone failed (boom) — no stops this pass',
      'ccrc-server: sweepHibernate failed (boom) — no verdicts this pass',
    ]);
  });

  it('differs: the cadence — 60 s | 5 min, both on the wall clock, both due at start (the watcher rows below)', () => {
    expect([STOP_DONE_SWEEP_MS, HIBERNATE_SWEEP_MS]).toEqual([60_000, 5 * 60_000]);
  });
});

// ── The act-time rows ──────────────────────────────────────────────────────────────────────────────────────────────

const WINDOW: ReadonlyArray<[string, (w: World) => void, string]> = [
  ['a run opened', (w) => { w.openWorker.add(ID); }, 'run-worker'],
  ['a hold written', (w) => { w.atAct.set(ID, { held: 'the operator holds it' }); }, 'held'],
  ['mail queued', (w) => { w.mail.add(ID); }, 'mail'],
  ['a viewer opened', (w) => { w.viewers.add(ID); }, 'viewer'],
  ['the live word turning busy', (w) => { w.words.set(ID, 'busy'); }, 'live-word'],
  ['the record vanishing', (w) => { w.vanished.add(ID); }, 'unmeasured'],
];

describe('the act-time rows: everything is read again inside the serialiser and the session\'s queue', () => {
  it.each(WINDOW)('run-done: %s between the pass and the act holds', async (_n, between, reason) => {
    const w = world();
    w.beforeAct = () => between(w);
    expect(await sdPass(w)).toEqual([{ id: ID, kind: 'held-at-act', verdict: { act: 'hold', reason } }]);
    expect(w.argv).toEqual([]);
  });

  it.each(WINDOW)('idle-hours: %s between the pass and the act holds', async (_n, between, reason) => {
    const w = world();
    w.beforeAct = () => between(w);
    expect(await hbPass(w)).toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR }, act: { kind: 'held-at-act', verdict: { act: 'hold', reason } } }]);
    expect(w.argv).toEqual([]);
  });

  it('the roster falls back to the tick\'s read only when the re-read row has none (both lanes)', async () => {
    for (const lane of ['run-done', 'idle-hours'] as const) {
      for (const [reread, expected] of [[undefined, 'roster'], [[], 'acted']] as const) {
        const w = world();
        const tick = row(ID);
        if (reread !== undefined) w.atAct.set(ID, { subagents: reread });
        w.beforeAct = () => { (tick as unknown as { subagents: unknown }).subagents = [{ id: 'agent-a' }]; };
        if (lane === 'run-done') {
          const out = await stopDonePass(sdDeps(w), sdMem(), [tick], [rec(ID)], []);
          expect(out[0]!.kind === 'held-at-act' ? word(out[0]!.verdict) : 'acted', `${lane} ${String(reread)}`).toBe(expected);
        } else {
          const out = await hibernatePass(hbDeps(w), hbMem(), [tick], [rec(ID)], [HIBERNATE_LIVE_MARKER]);
          const act = out[0]!.act!;
          expect(act.kind === 'held-at-act' ? word(act.verdict) : 'acted', `${lane} ${String(reread)}`).toBe(expected);
        }
      }
    }
  });

  it('the serialiser wraps the session\'s queue (both lanes)', async () => {
    const sd = world();
    await sdPass(sd);
    expect(sd.events.filter((e) => e === 'serial' || e.startsWith('queue'))).toEqual(['serial', `queue ${ID}`]);
    const hb = world();
    await hbPass(hb);
    expect(hb.events.filter((e) => e === 'serial' || e.startsWith('queue'))).toEqual(['serial', `queue ${ID}`]);
  });

  it('today\'s gap: a kill switch raised between the pass\'s listing and the act does NOT hold the act (neither lane re-reads the listing; C4g flips this row only once its ruling is made)', async () => {
    const sd = world();
    const names: string[] = [];
    sd.beforeAct = () => { names.push(STOP_DONE_DISABLED_MARKER, RECLAIM_PAUSE_MARKER, HIBERNATE_DISABLED_MARKER); };
    expect(await sdPass(sd, names)).toEqual([{ id: ID, kind: 'hibernated', runId: 10 }]);
    expect(sd.argv).toEqual([HIB_SD(ID)]);
    const hb = world();
    const hnames: string[] = [HIBERNATE_LIVE_MARKER];
    hb.beforeAct = () => { hnames.push(HIBERNATE_DISABLED_MARKER); };
    expect((await hbPass(hb, hnames))[0]!.act).toEqual({ kind: 'hibernated' });
    expect(hb.argv).toEqual([HIB_HB(ID)]);
  });
});

// ── Two policies, one session, one tick ────────────────────────────────────────────────────────────────────────────

describe('two policies, one session, one tick', () => {
  it('run-done first: idle-hours\' act re-reads the row, sees the stop stamp ccd hibernate wrote, and holds pane', async () => {
    const w = world();
    const tick = row(ID);
    expect(await stopDonePass(sdDeps(w), sdMem(), [tick], [rec(ID)], [])).toEqual([{ id: ID, kind: 'hibernated', runId: 10 }]);
    const out = await hibernatePass(hbDeps(w), hbMem(), [tick], [rec(ID)], [HIBERNATE_LIVE_MARKER]);
    expect(out[0]!.act).toEqual({ kind: 'held-at-act', verdict: { act: 'hold', reason: 'pane' } });
    expect(w.argv, 'at most one ccd hibernate reaches the runner').toEqual([HIB_SD(ID)]);
  });

  it('idle-hours first: run-done\'s act re-reads the row, sees the stop stamp, and holds stopped', async () => {
    const w = world();
    const tick = row(ID);
    expect((await hibernatePass(hbDeps(w), hbMem(), [tick], [rec(ID)], [HIBERNATE_LIVE_MARKER]))[0]!.act).toEqual({ kind: 'hibernated' });
    expect(await stopDonePass(sdDeps(w), sdMem(), [tick], [rec(ID)], [])).toEqual([
      { id: ID, kind: 'held-at-act', verdict: { act: 'hold', reason: 'stopped' } },
    ]);
    expect(w.argv).toEqual([HIB_HB(ID)]);
  });
});

// ── The cadence rows, through the watcher's real sweeps (the wall clock today; C4e's behaviour commit changes them) ──

describe('the cadence rows (FleetWatcher.sweepStopDone / sweepHibernate)', () => {
  const lanes = [
    ['sweepStopDone', STOP_DONE_SWEEP_MS],
    ['sweepHibernate', HIBERNATE_SWEEP_MS],
  ] as const;

  it.each(lanes)('%s: due at start, then a second call inside its cadence reads nothing, and at the cadence it runs again', async (lane, ms) => {
    const { w } = watcherWith({ coord: {} });
    const sweep = (names: string[]) => w[lane]([], [], names);
    atClock(NOW);
    const first = probe();
    await sweep(first);
    expect(first.includes, 'due at start').toHaveBeenCalled();
    atClock(NOW + ms - 1);
    const inside = probe();
    await sweep(inside);
    expect(inside.includes).not.toHaveBeenCalled();
    atClock(NOW + ms);
    const due = probe();
    await sweep(due);
    expect(due.includes).toHaveBeenCalled();
  });

  it.each(lanes)('%s reads the wall clock: stepped back, the lane waits a whole cadence from the stamp', async (lane, ms) => {
    const { w } = watcherWith({ coord: {} });
    atClock(NOW);
    await w[lane]([], [], probe());
    atClock(NOW - HOUR);
    const back = probe();
    await w[lane]([], [], back);
    expect(back.includes).not.toHaveBeenCalled();
    atClock(NOW + ms);
    const due = probe();
    await w[lane]([], [], due);
    expect(due.includes).toHaveBeenCalled();
  });

  it('sweepStopDone with no coord stamps no clock', async () => {
    const { w, deps } = watcherWith({ coord: undefined });
    atClock(NOW);
    await w.sweepStopDone([], [], probe());
    deps.coord = {};
    const again = probe();
    await w.sweepStopDone([], [], again);
    expect(again.includes).toHaveBeenCalled();
  });

  it('sweepStopDone: a call while one runs returns at once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    let reads = 0;
    const tmux = { sessionVerdict: async () => { reads++; await gate; return { verdict: 'gone' }; } };
    const w0 = world();
    const { w } = watcherWith({
      coord: sdDeps(w0).coord, tmux, fleetState: { ccdVerbs: ['hibernate'] }, viewers: { isOpen: () => false },
    });
    (w as unknown as { sleepStartedAt: number }).sleepStartedAt = NOW - 24 * HOUR;
    w.useStopDoneSerialiser({ serial: async (fn: () => Promise<unknown>) => fn() } as never);
    atClock(NOW);
    const first = w.sweepStopDone([row(ID)], [rec(ID)], []);
    await vi.waitFor(() => { expect(reads).toBe(1); });
    atClock(NOW + 2 * STOP_DONE_SWEEP_MS);
    const second = probe();
    await w.sweepStopDone([row(ID)], [rec(ID)], second);
    expect(second.includes, 'the second call returned at once').not.toHaveBeenCalled();
    expect(reads, 'and read nothing').toBe(1);
    release();
    await first;
  });

  it('sweepHibernate: a call while one runs returns at once', async () => {
    let release: (v: string | null) => void = () => undefined;
    const gate = new Promise<string | null>((r) => { release = r; });
    const { w, deps } = watcherWith({ coord: {} });
    let reads = 0;
    (deps.io as { readFile: unknown }).readFile = async () => { reads++; return gate; };
    atClock(NOW);
    const first = w.sweepHibernate([], [], [HIBERNATE_AFTER_HOURS_FILE]);
    await vi.waitFor(() => { expect(reads).toBe(1); });
    atClock(NOW + 2 * HIBERNATE_SWEEP_MS);
    const second = probe();
    await w.sweepHibernate([], [], second);
    expect(second.includes, 'the second call returned at once').not.toHaveBeenCalled();
    expect(reads, 'and read nothing').toBe(1);
    release(null);
    await first;
  });
});

// The opt-out marker's suffix is both lanes' (`$REG/<id>.no-hibernate`): one spelling, read from the listing.
describe('the opt-out marker', () => {
  it('both lanes hold opted-out for $REG/<id>.no-hibernate on the listing', async () => {
    const sd = world();
    expect(await sdPass(sd, [`${ID}.${NO_HIBERNATE_SUFFIX}`])).toEqual([]);
    expect(sd.events).toEqual([]);
    const hb = world();
    expect((await hbPass(hb, [HIBERNATE_LIVE_MARKER, `${ID}.${NO_HIBERNATE_SUFFIX}`]))[0]!.verdict).toEqual({ act: 'hold', reason: 'opted-out' });
  });
});

// ── C4b (D-7040; ARCH-43, second PR): one row per field of `SleepPolicy`, on the old verdicts ─────────────────────────
// APPENDED by C4b's characterization commit, green on the two old ladders before `decideSleep` exists. Each row names
// one field of the policy row `server/src/sleep.ts` declares, and shows its two values as the old verdicts answer them:
// run-done's value through `stopDoneVerdict`, idle-hours' through `hibernateVerdict`. The move commits change none of
// these rows.
describe('C4b: one row per SleepPolicy field, each value answering the old verdict\'s word', () => {
  it('field entry.child: run-done holds a non-child (not-a-child, child-unreadable); idle-hours never reads the marker', () => {
    expect([sdRow({ child: { kind: 'none' } }), sdRow({ child: { kind: 'unreadable' } })].map((m) => sdv(m(SD))))
      .toEqual(['not-a-child', 'child-unreadable']);
    expect([hbRow({ child: { kind: 'none' } }), hbRow({ child: { kind: 'unreadable' } })].map((m) => hbv(m(HB))))
      .toEqual(['hibernate', 'hibernate']);
  });

  it('field entry.archivedBucket: idle-hours holds archived for bucket archived; run-done reads only archivedAt (its bucket rung answers)', () => {
    expect(sdv(sdRow({ bucket: 'archived' })(SD))).toBe('bucket');
    expect(hbv(hbRow({ bucket: 'archived' })(HB))).toBe('archived');
    expect([sdv(sdRow({ archivedAt: NOW - HOUR })(SD)), hbv(hbRow({ archivedAt: NOW - HOUR })(HB))]).toEqual(['archived', 'archived']);
  });

  it('field entry.paneDead: idle-hours holds pane for a dead row, right after archived; run-done does not read the row\'s status', () => {
    expect(hbv(hbRow({ status: 'dead' })(HB))).toBe('pane');
    expect(hbv(hbRow({ status: 'dead', archivedAt: NOW - HOUR })(HB))).toBe('archived');
    expect(hbv(hbRow({ status: 'dead', unmeasured: ['uuid'] })(HB))).toBe('pane');
    expect(sdv(sdRow({ status: 'dead' })(SD))).toBe('hibernate');
  });

  it('field entry.stopped: run-done holds stopped for a stop stamp, after archived and before unmeasured; idle-hours does not read it', () => {
    const stamp = { stoppedBy: { at: NOW - HOUR, surface: 'agent' } };
    expect(sdv(sdRow(stamp)(SD))).toBe('stopped');
    expect(sdv(sdRow({ ...stamp, archivedAt: NOW - HOUR })(SD))).toBe('archived');
    expect(sdv(sdRow({ ...stamp, unmeasured: ['uuid'] })(SD))).toBe('stopped');
    expect(hbv(hbRow(stamp)(HB))).toBe('hibernate');
  });

  it('field held: run-done lets a workspace hold pass with hibernate-hold-ok, carrying its text; idle-hours holds any hold', () => {
    expect(stopDoneVerdict({ ...SD, heldKind: 'programme', row: { ...SD.row, held: PROGRAMME_HOLD } }))
      .toStrictEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR, holdOk: PROGRAMME_HOLD });
    expect(sdv({ ...SD, heldKind: 'programme', holdOkVerb: false, row: { ...SD.row, held: PROGRAMME_HOLD } })).toBe('held');
    expect(hbv(hbRow({ held: PROGRAMME_HOLD })(HB))).toBe('held');
  });

  it('field runClock: run-done reads the run\'s close after runs-unreadable (no-run, not-done, close-unplaced, grace); idle-hours reads no run', () => {
    expect([sdLast(null), sdLast({ state: 'working' }), sdLast({ closedAt: null }), sdLast({ closedAt: NOW - 1 })].map((m) => sdv(m(SD))))
      .toEqual(['no-run', 'not-done', 'close-unplaced', 'grace']);
    expect(sdv(sdLast(null)(sdStore({ openWorker: true })(SD))), 'the run clock stands above run-worker').toBe('no-run');
    expect(hibernateVerdict(HB, NOW, N)).toStrictEqual({ act: 'hibernate', idleMs: 7 * HOUR });
  });

  it('field verbBeforeMeasure: run-done holds no-verb before measure; idle-hours answers measure with no verb read', () => {
    expect(sdv(sdIn({ verb: false, live: { kind: 'unread' } })(SD))).toBe('no-verb');
    expect(sdv(sdIn({ verb: false })(SD)), 'no-verb stands above the live reads').toBe('no-verb');
    expect(sdv(sdIn({ verb: false })(sdRow({ subagents: [{ id: 'agent-a' }] })(SD))), 'and below roster').toBe('roster');
    expect(hbv(hbIn({ live: { kind: 'unread' } })(HB))).toBe('measure');
  });

  it('field turnVerdict: run-done reads the fail-closed turn verdict after the live word; idle-hours has no turn read', () => {
    expect([sdLive({ turn: 'busy' }), sdLive({ turn: 'unmeasured' })].map((m) => sdv(m(SD)))).toEqual(['turn', 'unmeasured']);
    expect(sdv(sdLive({ turn: 'busy', word: { ok: true, word: 'busy' } })(SD))).toBe('live-word');
    expect(sdv(sdLive({ turn: 'busy' })(sdMark({ state: 'running' })(SD))), 'the turn stands above the marker').toBe('turn');
    expect(Object.keys(HB.live).sort(), 'idle-hours\' live read carries no turn').toEqual(['kind', 'mark', 'word']);
  });

  it('field liveWord: one rule serves both, the sleep turn policy (rest on idle alone), over the whole corpus', () => {
    const rests = WORDS.map((w) => (w === 'idle' ? 'hibernate' : 'live-word'));
    expect(WORDS.map((w) => sdv(sdLive({ word: { ok: true, word: w } })(SD)))).toEqual(rests);
    expect(WORDS.map((w) => hbv(hbLive({ word: { ok: true, word: w } })(HB)))).toEqual(rests);
  });

  it('field quiet.boundary: run-done holds recent while idleMs < its threshold; idle-hours while idleMs <= N', () => {
    expect([sdv(sdMark(quiet(GRACE - 1))(SD)), sdv(sdMark(quiet(GRACE))(SD))]).toEqual(['recent', 'hibernate']);
    expect([hbv(hbMark(quiet(N))(HB)), hbv(hbMark(quiet(N + 1))(HB))]).toEqual(['recent', 'hibernate']);
  });

  it('field quiet threshold: run-done\'s is its input\'s grace, idle-hours\' its afterMs (N)', () => {
    const closed = sdIn({ graceMs: 2 * HOUR })(sdLast({ closedAt: NOW - 3 * HOUR })(SD));
    expect([sdv(sdMark(quiet(2 * HOUR - 1))(closed)), sdv(sdMark(quiet(2 * HOUR))(closed))]).toEqual(['recent', 'hibernate']);
    expect([hbv(hbMark(quiet(HOUR))(HB), HOUR), hbv(hbMark(quiet(HOUR + 1))(HB), HOUR)]).toEqual(['recent', 'hibernate']);
  });

  it('field quiet.parkedMs: run-done takes STOP_DONE_PARKED_IDLE_MS for a parked or sibling-parked run; idle-hours has no parked clock', () => {
    const parked = sdLast({ state: 'merging', closedAt: null })(SD);
    expect([sdv(sdMark(quiet(GRACE + 1))(parked)), sdv(sdMark(quiet(STOP_DONE_PARKED_IDLE_MS))(parked))]).toEqual(['recent', 'hibernate']);
    expect(sdv(sdMark(quiet(GRACE + 1))(sdStore({ parkedWorker: true })(SD)))).toBe('recent');
    expect(Object.keys(HB.store).includes('parkedWorker'), 'idle-hours\' store read carries no parked run').toBe(false);
  });
});

// ── C4b (D-7040; ARCH-43): the one ladder, `decideSleep`, through both policy rows ──────────────────────────────────────
// APPENDED by C4b's red commit. The whole decision matrix above, run through `decideSleep(…, RUN_DONE_POLICY)` and
// `decideSleep(…, IDLE_HOURS_POLICY)` over each policy's own input builder, must answer what the matrix names (the rung's
// word, the higher rung of a pair) and what the policy's verdict answers, row for row. Once the verdicts delegate, the
// rung words keep the rows from reading their answers back.
// Imports sit here, beside the rows that read them, so the head of the file stays as C4a left it.
import { SLEEP_POLICY_NAMES, decideSleep, type SleepInput, type SleepVerdict } from '../src/sleep.js';
import { RUN_DONE_POLICY, stopDoneSleepInput } from '../src/stopDone.js';
import { IDLE_HOURS_POLICY, hibernateSleepInput } from '../src/coord/hibernate.js';

const rd = (i: StopDoneInput): SleepVerdict<StopDoneHold> => decideSleep(stopDoneSleepInput(i), RUN_DONE_POLICY);
const ih = (i: HibernateInput, afterMs = N): SleepVerdict<HibernateHold> => decideSleep(hibernateSleepInput(i, NOW, afterMs), IDLE_HOURS_POLICY);
const dword = (v: SleepVerdict<string>): string => (v.act === 'hold' ? v.reason : v.act);
const rdw = (i: StopDoneInput): string => dword(rd(i));
const ihw = (i: HibernateInput, afterMs = N): string => dword(ih(i, afterMs));

/** Every input of run-done's matrix: the clear one, each rung alone (live read and unread), and every pair. */
const RD_MATRIX: ReadonlyArray<readonly [string, StopDoneInput, string]> = [
  ['clear', SD, 'hibernate'],
  ['clear, unread', { ...SD, live: { kind: 'unread' } }, 'measure'],
  ...[...RUN_DONE, ...RUN_DONE_ALSO].map((r) => [`alone: ${r.name}`, r.set(SD), r.word] as const),
  ...RUN_DONE.filter((r) => !r.live).map((r) => [`unread: ${r.name}`, r.set({ ...SD, live: { kind: 'unread' } }), r.word] as const),
  ...pairsOf(RUN_DONE).map(([a, b]) => [`pair: ${a.name} + ${b.name}`, b.set(a.set(SD)), a.word] as const),
];
const IH_MATRIX: ReadonlyArray<readonly [string, HibernateInput, string]> = [
  ['clear', HB, 'hibernate'],
  ['clear, unread', { ...HB, live: { kind: 'unread' } }, 'measure'],
  ...[...IDLE_HOURS, ...IDLE_HOURS_ALSO].map((r) => [`alone: ${r.name}`, r.set(HB), r.word] as const),
  ...IDLE_HOURS.filter((r) => !r.live).map((r) => [`unread: ${r.name}`, r.set({ ...HB, live: { kind: 'unread' } }), r.word] as const),
  ...pairsOf(IDLE_HOURS).map(([a, b]) => [`pair: ${a.name} + ${b.name}`, b.set(a.set(HB)), a.word] as const),
];

describe('C4b: decideSleep, one ladder, answers each policy\'s word for the whole decision matrix', () => {
  it('the two rows are named by SLEEP_POLICY_NAMES and answer in their own map\'s words', () => {
    expect([RUN_DONE_POLICY.name, IDLE_HOURS_POLICY.name]).toEqual([...SLEEP_POLICY_NAMES]);
    expect([...SLEEP_POLICY_NAMES]).toEqual(['run-done', 'idle-hours']);
    expect([...RUN_DONE_POLICY.holds].sort()).toEqual([...STOP_DONE_HOLDS].sort());
    expect([...IDLE_HOURS_POLICY.holds].sort()).toEqual([...HIBERNATE_HOLDS].sort());
  });

  it('run-done: every row answers the matrix\'s word and stopDoneVerdict\'s, row for row', () => {
    const wrong = RD_MATRIX.filter(([, i, want]) => rdw(i) !== want || rdw(i) !== sdv(i)).map(([n, i, want]) => `${n}: ${rdw(i)} (want ${want}, verdict ${sdv(i)})`);
    expect(RD_MATRIX.length).toBeGreaterThan(400);
    expect(wrong).toEqual([]);
  });

  it('idle-hours: every row answers the matrix\'s word and hibernateVerdict\'s, row for row', () => {
    const wrong = IH_MATRIX.filter(([, i, want]) => ihw(i) !== want || ihw(i) !== hbv(i)).map(([n, i, want]) => `${n}: ${ihw(i)} (want ${want}, verdict ${hbv(i)})`);
    expect(IH_MATRIX.length).toBeGreaterThan(200);
    expect(wrong).toEqual([]);
  });

  it('every word a row answers is in its policy\'s own hold list', () => {
    const rdHolds: readonly string[] = RUN_DONE_POLICY.holds;
    const ihHolds: readonly string[] = IDLE_HOURS_POLICY.holds;
    expect(RD_MATRIX.map(([, i]) => rd(i)).filter((v) => v.act === 'hold' && !rdHolds.includes(v.reason))).toEqual([]);
    expect(IH_MATRIX.map(([, i]) => ih(i)).filter((v) => v.act === 'hold' && !ihHolds.includes(v.reason))).toEqual([]);
  });

  it('the sleep answer carries what the verdicts carry: run-done its run and hold-ok text, idle-hours no run', () => {
    expect(rd(SD)).toStrictEqual({ act: 'hibernate', idleMs: 7 * HOUR, runId: 7 });
    expect(rd({ ...SD, heldKind: 'run-terminal', row: { ...SD.row, held: PROGRAMME_HOLD } }))
      .toStrictEqual({ act: 'hibernate', idleMs: 7 * HOUR, runId: 7, holdOk: PROGRAMME_HOLD });
    expect(ih(HB)).toStrictEqual({ act: 'hibernate', idleMs: 7 * HOUR, runId: null });
  });

  it('the boundary rows: idle-hours holds at N and sleeps at N + 1; run-done sleeps at its grace and holds one ms less', () => {
    expect([ihw(hbMark(quiet(N))(HB)), ihw(hbMark(quiet(N + 1))(HB))]).toEqual(['recent', 'hibernate']);
    expect([ihw(hbMark(quiet(HOUR))(HB), HOUR), ihw(hbMark(quiet(HOUR + 1))(HB), HOUR)]).toEqual(['recent', 'hibernate']);
    expect([rdw(sdMark(quiet(GRACE - 1))(SD)), rdw(sdMark(quiet(GRACE))(SD))]).toEqual(['recent', 'hibernate']);
    expect([rdw(sdLast({ closedAt: NOW - GRACE + 1 })(SD)), rdw(sdLast({ closedAt: NOW - GRACE })(SD))]).toEqual(['grace', 'hibernate']);
    for (const state of STOP_DONE_PARKED_STATES) {
      const parked = sdLast({ state, closedAt: null })(SD);
      expect([rdw(sdMark(quiet(STOP_DONE_PARKED_IDLE_MS - 1))(parked)), rdw(sdMark(quiet(STOP_DONE_PARKED_IDLE_MS))(parked))], state)
        .toEqual(['recent', 'hibernate']);
    }
    expect(rdw(sdMark(quiet(GRACE + 1))(sdStore({ parkedWorker: true })(SD)))).toBe('recent');
    expect(rdw(sdLast({ state: 'failed' })(SD))).toBe('hibernate');
  });

  it('the live-word rows: both rows read the sleep turn policy, and agree on the whole corpus', () => {
    const rests = WORDS.map((w) => (w === 'idle' ? 'hibernate' : 'live-word'));
    expect(WORDS.map((w) => rdw(sdLive({ word: { ok: true, word: w } })(SD)))).toEqual(rests);
    expect(WORDS.map((w) => ihw(hbLive({ word: { ok: true, word: w } })(HB)))).toEqual(rests);
    expect([RUN_DONE_POLICY.liveWord, IDLE_HOURS_POLICY.liveWord]).toEqual(['sleep', 'sleep']);
  });

  it('idle-hours holds any hold, even one its input says may pass: the held rule is the row\'s, never the input\'s', () => {
    const input: SleepInput = { ...hibernateSleepInput(hbRow({ held: PROGRAMME_HOLD })(HB), NOW, N), heldPasses: true };
    expect(dword(decideSleep(input, IDLE_HOURS_POLICY))).toBe('held');
    expect(dword(decideSleep(input, { ...IDLE_HOURS_POLICY, held: RUN_DONE_POLICY.held }))).toBe('hibernate');
  });

  it('a fact the input did not read holds wherever a row reads it (null is never a pass)', () => {
    const base = hibernateSleepInput(HB, NOW, N);
    // The hybrid row answers run-done's words, so it carries run-done's hold list (C4d: a word outside the list throws).
    const reads = { ...IDLE_HOURS_POLICY, holds: RUN_DONE_POLICY.holds, entry: RUN_DONE_POLICY.entry, verbBeforeMeasure: true, turnVerdict: true };
    expect(dword(decideSleep(base, reads))).toBe('child-unreadable');
    expect(dword(decideSleep({ ...base, child: { kind: 'child', runId: 1 } } as SleepInput, reads))).toBe('stopped');
    expect(dword(decideSleep(stopDoneSleepInput(SD), { ...RUN_DONE_POLICY, entry: { ...RUN_DONE_POLICY.entry, paneDead: true } }))).toBe('pane');
    expect(dword(decideSleep({ ...base, child: { kind: 'child', runId: 1 }, stopped: false } as SleepInput, reads))).toBe('no-verb');
  });

  it('the name is never read: each row renamed to the other answers the same for every input', () => {
    const asIdle = { ...RUN_DONE_POLICY, name: SLEEP_POLICY_NAMES[1] };
    const asRunDone = { ...IDLE_HOURS_POLICY, name: SLEEP_POLICY_NAMES[0] };
    expect(RD_MATRIX.filter(([, i]) => dword(decideSleep(stopDoneSleepInput(i), asIdle)) !== rdw(i)).map(([n]) => n)).toEqual([]);
    expect(IH_MATRIX.filter(([, i]) => dword(decideSleep(hibernateSleepInput(i, NOW, N), asRunDone)) !== ihw(i)).map(([n]) => n)).toEqual([]);
  });
});

// C4d follow-ups of C4b's review (D-7040's decider; ARCH-43). The ladder answers only words of the policy's own list,
// checked at run time rather than cast; and the fail-closed turn verdict's fallback is written as the base wrote it.
describe('C4d: decideSleep answers only its policy\'s words, and its turn fallback is the base\'s', () => {
  it('a word outside the policy\'s hold list is never answered: the ladder throws rather than answer it', () => {
    const viewer = stopDoneSleepInput(sdIn({ viewer: true })(SD));
    expect(dword(decideSleep(viewer, RUN_DONE_POLICY)), 'CONTROL: the input reaches viewer').toBe('viewer');
    const narrowed = { ...RUN_DONE_POLICY, holds: RUN_DONE_POLICY.holds.filter((h) => h !== 'viewer') };
    expect(() => decideSleep(viewer, narrowed)).toThrow(/viewer/);
    // Every word the real rows answer over the whole matrix is in their lists, so neither row ever throws.
    expect(RD_MATRIX.filter(([, i]) => { try { rd(i); return false; } catch { return true; } }).map(([n]) => n)).toEqual([]);
    expect(IH_MATRIX.filter(([, i]) => { try { ih(i); return false; } catch { return true; } }).map(([n]) => n)).toEqual([]);
  });

  it('the turn verdict\'s fallback is the base\'s: unmeasured holds unmeasured, and every other non-idle turn holds turn', () => {
    const at = (turn: 'busy' | 'unmeasured' | null): SleepInput => {
      const i = stopDoneSleepInput(SD);
      return i.live.kind === 'read' ? { ...i, live: { ...i.live, turn } } : i;
    };
    expect(dword(decideSleep(at('busy'), RUN_DONE_POLICY))).toBe('turn');
    expect(dword(decideSleep(at('unmeasured'), RUN_DONE_POLICY))).toBe('unmeasured');
    // A turn the lane did not read (`null`, typeable in SleepLive) under a row that reads it: neither busy nor unmeasured,
    // so `turn`, as the base's `=== 'unmeasured' ? 'unmeasured' : 'turn'` answered it.
    expect(dword(decideSleep(at(null), RUN_DONE_POLICY))).toBe('turn');
  });
});

// ── C4d (D-7042; ARCH-43, fourth PR): one row per field of a SLEEP_LANES row, through a lane's pass ─────────────────
// APPENDED by C4d's characterization commit, green on the two old passes before `sleepLane.ts` exists. Each row names
// one field of the lane row `server/src/sleepLane.ts` declares, and shows run-done's value and idle-hours' as the two
// passes act on them. The rows take the passes as an argument (`LanePasses`), so the same rows drive the one executor
// once it exists; the move commits change none of them.

import type { StopDoneOutcome } from '../src/stopDoneSweep.js';
import type { HibernateSweepOutcome } from '../src/hibernateSweep.js';

interface LanePasses {
  readonly runDone: (deps: StopDoneSweepDeps, mem: StopDoneMemory, sessions: readonly FleetSession[],
    records: readonly SessionRecord[], names: readonly string[]) => Promise<StopDoneOutcome[]>;
  readonly idleHours: (deps: HibernateSweepDeps, mem: HibernateSweepMemory, sessions: readonly FleetSession[],
    records: readonly SessionRecord[], names: readonly string[]) => Promise<HibernateSweepOutcome[]>;
}
const OLD_PASSES: LanePasses = { runDone: stopDonePass, idleHours: hibernatePass };

/** The field rows, over `p`'s two passes. Each is `[field, row]`. */
function laneFieldRows(p: LanePasses): ReadonlyArray<readonly [string, () => Promise<void>]> {
  const sd = (w: World, names: string[] = [], list = [ID], m = sdMem()) =>
    p.runDone(sdDeps(w), m, list.map((id) => row(id)), list.map(rec), names);
  const hb = (w: World, names: string[] = [HIBERNATE_LIVE_MARKER], list = [ID], m = hbMem(), o: { act?: boolean } = {}) =>
    p.idleHours(hbDeps(w, o), m, list.map((id) => row(id)), list.map(rec), names);
  return [
    ['policy: each lane asks its own policy row (run-done holds a non-child, idle-hours a dead pane)', async () => {
      const own = world();
      expect(await p.runDone(sdDeps(own), sdMem(), [row(ID, { child: { kind: 'none' } })], [rec(ID)], [])).toEqual([]);
      expect(own.events, 'held before any read').toEqual([]);
      const dead = await p.idleHours(hbDeps(world()), hbMem(), [row(ID, { status: 'dead' })], [rec(ID)], [HIBERNATE_LIVE_MARKER]);
      expect(dead).toEqual([{ id: ID, verdict: { act: 'hold', reason: 'pane' } }]);
      const child = await p.idleHours(hbDeps(world()), hbMem(), [row(ID, { child: { kind: 'none' } })], [rec(ID)], [HIBERNATE_LIVE_MARKER]);
      expect(child[0]!.act, 'idle-hours puts a non-child to sleep').toEqual({ kind: 'hibernated' });
    }],
    ['kill switches: run-done stops for stop-done-disabled, reclaim-paused or hibernate-disabled; idle-hours for hibernate-disabled alone', async () => {
      for (const k of [STOP_DONE_DISABLED_MARKER, RECLAIM_PAUSE_MARKER, HIBERNATE_DISABLED_MARKER]) {
        const w = world();
        expect(await sd(w, [k]), k).toEqual([]);
        expect(w.events, k).toEqual([]);
      }
      const off = world();
      expect(await hb(off, [HIBERNATE_LIVE_MARKER, HIBERNATE_DISABLED_MARKER])).toEqual([]);
      expect(off.events).toEqual([]);
      for (const k of [STOP_DONE_DISABLED_MARKER, RECLAIM_PAUSE_MARKER]) {
        const w = world();
        expect((await hb(w, [HIBERNATE_LIVE_MARKER, k]))[0]!.act, k).toEqual({ kind: 'hibernated' });
      }
    }],
    ['arming: run-done has none (live); idle-hours acts only with hibernate-live, else its shadow line', async () => {
      const sdw = world();
      expect(await sd(sdw, [])).toEqual([{ id: ID, kind: 'hibernated', runId: 10 }]);
      const shadow = world();
      expect(await hb(shadow, [])).toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR } }]);
      expect(shadow.argv).toEqual([]);
      expect(shadow.lines).toEqual([`ccrc-server: hibernate-shadow ${ID} idle=7h`]);
      const portless = world();
      expect(await hb(portless, [HIBERNATE_LIVE_MARKER], [ID], hbMem(), { act: false }), 'no act port: shadow')
        .toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR } }]);
      expect(portless.argv).toEqual([]);
    }],
    ['cadence: run-done 60 s, idle-hours 5 min (the rows C4e wires)', async () => {
      expect([STOP_DONE_SWEEP_MS, HIBERNATE_SWEEP_MS]).toEqual([60_000, 5 * 60_000]);
    }],
    ['population: run-done the dispatched children not stopped, archived or in retry, with a record, by id; idle-hours every row with a record, in frame order', async () => {
      const rows = [row('c-child'), row('a-child'), row('b-stopped', { stoppedBy: { at: NOW, surface: 'agent' } }),
        row('d-archived', { archivedAt: NOW - HOUR }), row('e-own', { child: { kind: 'none' } }), row('f-no-record'), row('g-retry')];
      const recs = ['c-child', 'a-child', 'b-stopped', 'd-archived', 'e-own', 'g-retry'].map(rec);
      const sdw = world();
      const m = sdMem();
      m.retryAt.set('g-retry', NOW + HOUR);
      await p.runDone(sdDeps(sdw), m, rows, recs, []);
      expect(sdw.events.slice(0, sdw.events.indexOf('serial')).filter((e) => e.startsWith('word'))).toEqual(['word a-child', 'word c-child']);
      expect(sdw.argv.map(idOf)).toEqual(['a-child', 'c-child']);
      const hbw = world();
      const out = await p.idleHours(hbDeps(hbw), hbMem(), rows, recs, []);
      expect(out.map((o) => o.id)).toEqual(['c-child', 'a-child', 'b-stopped', 'd-archived', 'e-own', 'g-retry']);
    }],
    ['per-pass caps: run-done at most 3 acts and 6 measures, stopping at either; idle-hours at most 3 acts, measures unbounded', async () => {
      const acts = world();
      await sd(acts, [], ids(5));
      expect(acts.argv.map(idOf)).toEqual(ids(3));
      const measures = world();
      for (const id of ids(8)) measures.turns.set(id, 'busy');
      await sd(measures, [], ids(8));
      expect(measures.events.filter((e) => e.startsWith('word'))).toHaveLength(6);
      const hacts = world();
      const out = await hb(hacts, [HIBERNATE_LIVE_MARKER], ids(5));
      expect(hacts.argv.map(idOf)).toEqual(ids(3));
      expect(out.map((o) => o.act?.kind ?? null)).toEqual(['hibernated', 'hibernated', 'hibernated', null, null]);
      const hmeasures = world();
      for (const id of ids(8)) hmeasures.words.set(id, 'busy');
      await hb(hmeasures, [HIBERNATE_LIVE_MARKER], ids(8));
      expect(hmeasures.events.filter((e) => e.startsWith('word'))).toHaveLength(8);
    }],
    ['per-pass caps are each lane\'s own: 4 run-done and 4 idle-hours candidates on one tick put 3 and 3 to sleep', async () => {
      const w = world();
      const runDone = ids(4);
      const idle = Array.from({ length: 4 }, (_, k) => `project-a-idle-${k}`);
      const [a, b] = await Promise.all([
        p.runDone(sdDeps(w), sdMem(), runDone.map((id) => row(id)), runDone.map(rec), [HIBERNATE_LIVE_MARKER]),
        p.idleHours(hbDeps(w), hbMem(), idle.map((id) => row(id, { child: { kind: 'none' } })), idle.map(rec), [HIBERNATE_LIVE_MARKER]),
      ]);
      expect(a.filter((o) => o.kind === 'hibernated').map((o) => o.id)).toEqual(runDone.slice(0, 3));
      expect(b.filter((o) => o.act?.kind === 'hibernated').map((o) => o.id)).toEqual(idle.slice(0, 3));
      expect(w.argv.map(idOf).sort()).toEqual([...runDone.slice(0, 3), ...idle.slice(0, 3)].sort());
    }],
    ['when it acts: run-done after the loop, in id order; idle-hours inline', async () => {
      const sdw = world();
      await sd(sdw, [], ['b-row', 'a-row']);
      expect(sdw.events.slice(0, 7)).toEqual(['word a-row', 'turn a-row', 'mark a-row', 'word b-row', 'turn b-row', 'mark b-row', 'serial']);
      const hbw = world();
      await hb(hbw, [HIBERNATE_LIVE_MARKER], ['b-row', 'a-row']);
      expect(hbw.events.slice(0, 7)).toEqual(['word b-row', 'mark b-row', 'serial', 'queue b-row', 'word b-row', 'mark b-row', 'ccd b-row']);
    }],
    ['retry memory: run-done holds off an hour after a refused, busy or thrown act; idle-hours asks again next pass, its lines throttled hourly and pruned', async () => {
      for (const answer of [() => BUSY, () => REFUSED, () => { throw new Error('boom'); }]) {
        const w = world();
        w.answer = answer;
        const m = sdMem();
        await sd(w, [], [ID], m);
        expect(m.retryAt.get(ID)).toBe(NOW + STOP_DONE_RETRY_MS);
        await sd(w, [], [ID], m);
        expect(w.argv, 'not asked again inside the hour').toHaveLength(1);
      }
      const hbw = world();
      hbw.answer = () => BUSY;
      const m = hbMem();
      await hb(hbw, [HIBERNATE_LIVE_MARKER], [ID], m);
      await hb(hbw, [HIBERNATE_LIVE_MARKER], [ID], m);
      expect(hbw.argv, 'asked again next pass').toHaveLength(2);
      expect(hbw.lines, 'one line inside the hour').toHaveLength(1);
      await hb(hbw, [HIBERNATE_LIVE_MARKER], [], m);
      expect(m.lastActLine.has(ID), 'pruned').toBe(false);
    }],
    ['store: run-done\'s deps carry the store; idle-hours without one holds runs-unreadable', async () => {
      const out = await p.idleHours({ ...hbDeps(world()), coord: undefined }, hbMem(), [row(ID)], [rec(ID)], [HIBERNATE_LIVE_MARKER]);
      expect(out).toEqual([{ id: ID, verdict: { act: 'hold', reason: 'runs-unreadable' } }]);
    }],
    ['serialiser not handed over: run-done measures and acts on nothing; idle-hours stays in shadow', async () => {
      const sdw = world();
      sdw.serial = false;
      expect(await sd(sdw)).toEqual([]);
      expect(sdw.events).toEqual([]);
      const hbw = world();
      hbw.serial = false;
      expect(await hb(hbw)).toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR } }]);
      expect(hbw.lines).toEqual([`ccrc-server: hibernate-shadow ${ID} idle=7h`]);
    }],
    ['binding read: run-done reads the placed runs once a pass for every candidate and once at the act; idle-hours the live claims once a pass and its bindings per ask', async () => {
      const w = world();
      const asked: string[][] = [];
      const base = sdDeps(w);
      const coord = { ...base.coord, lastRunBySession: (ids0: readonly string[]) => { asked.push([...ids0]); return base.coord.lastRunBySession(ids0); } };
      await p.runDone({ ...base, coord: coord as StopDoneSweepDeps['coord'] }, sdMem(), ['b-row', 'a-row'].map((id) => row(id)), ['b-row', 'a-row'].map(rec), []);
      expect(asked).toEqual([['a-row', 'b-row'], ['a-row'], ['b-row']]);
      const hw = world();
      const hbase = hbDeps(hw);
      let claims = 0;
      const bound: string[] = [];
      const hcoord = {
        ...hbase.coord!,
        activeClaims: () => { claims++; return hbase.coord!.activeClaims(); },
        bindingsOf: (id: string) => { bound.push(id); return hbase.coord!.bindingsOf(id); },
      };
      await p.idleHours({ ...hbase, coord: hcoord as HibernateSweepDeps['coord'] }, hbMem(), [row(ID)], [rec(ID)], [HIBERNATE_LIVE_MARKER]);
      expect(claims, 'once a pass, once at the act').toBe(2);
      expect(bound, 'the unread ask, the measured ask, the act').toEqual([ID, ID, ID]);
    }],
    ['live reads and order: run-done the word, the turn verdict, the marker; idle-hours the word and the marker', async () => {
      const sdw = world();
      sdw.turns.set(ID, 'busy');
      await sd(sdw);
      expect(sdw.events).toEqual([`word ${ID}`, `turn ${ID}`, `mark ${ID}`]);
      const hbw = world();
      await hb(hbw, []);
      expect(hbw.events).toEqual([`word ${ID}`, `mark ${ID}`]);
    }],
    ['notices: run-done records the mail-only count and Worker asleep; idle-hours records none', async () => {
      const w = world();
      w.mail.add('a-row');
      const m = sdMem();
      await sd(w, [], ['a-row', ID], m);
      expect(w.feed.map((f) => f.title)).toEqual(['Workers kept awake by unread mail: 1', 'Worker asleep']);
      const empty = world();
      await sd(empty, [], [], sdMem());
      expect(empty.feed.map((f) => f.title), 'an empty population counts 0').toEqual(['Workers kept awake by unread mail: 0']);
      const hbw = world();
      await hb(hbw);
      expect(hbw.feed).toEqual([]);
    }],
    ['log sentences: run-done\'s three after the loop; idle-hours\' shadow, slept, skip and failure lines', async () => {
      const warns: string[] = [];
      const spy = vi.spyOn(console, 'warn').mockImplementation((l: unknown) => { warns.push(String(l)); });
      try {
        for (const [answer, line] of [
          [() => OK, `ccrc-server: stop-done: put ${ID} to sleep (run 10 done, idle; D-5370, D-5427, D-6091, D-6092)`],
          [() => BUSY, `ccrc-server: stop-done: ccd re-measured ${ID} as attached — not asked again for an hour`],
          [() => REFUSED, `ccrc-server: stop-done: the hibernate of ${ID} failed (refused) — not asked again for an hour`],
          [() => { throw new Error('boom'); }, `ccrc-server: stop-done: the hibernate of ${ID} failed (boom) — not asked again for an hour`],
        ] as const) {
          warns.length = 0;
          const w = world();
          w.answer = answer;
          await sd(w);
          expect(warns).toEqual([line]);
        }
      } finally {
        spy.mockRestore();
      }
      const blank: CcdResult = { ...REFUSED, stderr: '  ' };
      for (const [names, answer, line] of [
        [[], () => OK, `ccrc-server: hibernate-shadow ${ID} idle=7h`],
        [[HIBERNATE_LIVE_MARKER], () => OK, `ccrc-server: hibernated ${ID} idle=7h (D-5242)`],
        [[HIBERNATE_LIVE_MARKER], () => BUSY, `ccrc-server: hibernate-skip ${ID}: ccd re-measured it as attached — asked again next sweep`],
        [[HIBERNATE_LIVE_MARKER], () => REFUSED, `ccrc-server: hibernate of ${ID} failed (refused) — asked again next sweep`],
        [[HIBERNATE_LIVE_MARKER], () => blank, `ccrc-server: hibernate of ${ID} failed (no stderr) — asked again next sweep`],
        [[HIBERNATE_LIVE_MARKER], () => { throw new Error(' boom '); }, `ccrc-server: hibernate of ${ID} failed ( boom ) — asked again next sweep`],
      ] as const) {
        const w = world();
        w.answer = answer;
        await hb(w, [...names]);
        expect(w.lines).toEqual([line]);
      }
    }],
    ['actor: sweep:stop-done, with --hold-ok and the exact text when a hold passed; sweep:hibernate', async () => {
      const sdw = world();
      await sd(sdw);
      expect(sdw.argv).toEqual([HIB_SD(ID)]);
      const held = world();
      held.atAct.set(ID, { held: PROGRAMME_HOLD });
      await p.runDone(sdDeps(held), sdMem(), [row(ID, { held: PROGRAMME_HOLD })], [rec(ID)], []);
      expect(held.argv).toEqual([HIB_SD(ID, '--hold-ok', PROGRAMME_HOLD)]);
      const noToken = world();
      noToken.verbs.splice(noToken.verbs.indexOf(HIBERNATE_HOLD_OK_CAP), 1);
      noToken.atAct.set(ID, { held: PROGRAMME_HOLD });
      expect(await p.runDone(sdDeps(noToken), sdMem(), [row(ID, { held: PROGRAMME_HOLD })], [rec(ID)], []), 'no hold-ok token: held')
        .toEqual([]);
      const hbw = world();
      await hb(hbw);
      expect(hbw.argv).toEqual([HIB_HB(ID)]);
    }],
    ['verb: run-done asks it once a pass (dropped before the act, the act still runs); idle-hours asks again beside the argv', async () => {
      const sdw = world();
      sdw.beforeAct = () => { sdw.verbs.splice(sdw.verbs.indexOf('hibernate'), 1); };
      expect(await sd(sdw)).toEqual([{ id: ID, kind: 'hibernated', runId: 10 }]);
      const hbw = world();
      hbw.beforeAct = () => { hbw.verbs.splice(hbw.verbs.indexOf('hibernate'), 1); };
      expect(await hb(hbw)).toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR }, act: { kind: 'skipped', detail: 'no-verb' } }]);
      expect(hbw.argv).toEqual([]);
      expect(hbw.lines, 'a verb skip logs nothing').toEqual([]);
    }],
    ['the act never throws: a serialiser that throws is a failed act, remembered by run-done, logged by idle-hours', async () => {
      const sdw = world();
      sdw.beforeAct = () => { throw new Error('serial gone'); };
      const m = sdMem();
      expect(await sd(sdw, [], [ID], m)).toEqual([{ id: ID, kind: 'failed', detail: 'serial gone' }]);
      expect(m.retryAt.get(ID)).toBe(NOW + STOP_DONE_RETRY_MS);
      const hbw = world();
      hbw.beforeAct = () => { throw new Error('serial gone'); };
      expect(await hb(hbw)).toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR }, act: { kind: 'failed', detail: 'serial gone' } }]);
      expect(hbw.lines).toEqual([`ccrc-server: hibernate of ${ID} failed (serial gone) — asked again next sweep`]);
    }],
  ];
}

describe('C4d: one row per SLEEP_LANES field, through the old passes (stopDonePass, hibernatePass)', () => {
  it.each(laneFieldRows(OLD_PASSES))('%s', async (_n, run) => { await run(); });
});

// ── C4d: the one executor, sleepPass and sleepAct over SLEEP_LANES ───────────────────────────────────────────────────
// APPENDED by C4d's red commit: the same field rows, the act-time rows and an old-against-new comparison, driving
// `sleepPass` directly with each lane row. Every lane row value is C4a's measured one; no row merges with the other's.

import { IDLE_HOURS_LANE, RUN_DONE_LANE, SLEEP_LANES, sleepPass } from '../src/sleepLane.js';

const NEW_PASSES: LanePasses = {
  runDone: (deps, mem, sessions, records, names) => sleepPass(RUN_DONE_LANE, deps, mem, sessions, records, names),
  idleHours: (deps, mem, sessions, records, names) => sleepPass(IDLE_HOURS_LANE, deps, mem, sessions, records, names),
};

describe('C4d: one row per SLEEP_LANES field, through sleepPass', () => {
  it.each(laneFieldRows(NEW_PASSES))('%s', async (_n, run) => { await run(); });

  it('SLEEP_LANES holds one row per policy, in today\'s order, each carrying C4a\'s measured values', () => {
    expect(SLEEP_LANES.map((l) => l.policy.name)).toEqual([...SLEEP_POLICY_NAMES]);
    expect([RUN_DONE_LANE.policy, IDLE_HOURS_LANE.policy]).toEqual([RUN_DONE_POLICY, IDLE_HOURS_POLICY]);
    const facts = (l: (typeof SLEEP_LANES)[number]) => ({
      kill: l.kill, arming: l.arming, cadence: l.cadence, population: l.population, caps: l.caps, acts: l.acts,
      retry: { ...l.retry, of: undefined }, store: l.store, unarmed: l.unarmed, verb: l.verb, holdOk: l.holdOk, actor: l.actor,
      clock: l.clock,
    });
    expect(facts(RUN_DONE_LANE)).toEqual({
      kill: [STOP_DONE_DISABLED_MARKER, RECLAIM_PAUSE_MARKER, HIBERNATE_DISABLED_MARKER], arming: null, cadence: 'sleepRunDone',
      population: 'dispatched-children-by-id', caps: { acts: 3, measures: 6, past: 'stop' }, acts: 'after-the-loop',
      retry: { kind: 'hold-off', ms: STOP_DONE_RETRY_MS, of: undefined }, store: 'needed', unarmed: 'nothing',
      verb: 'holds-before-measure', holdOk: true, actor: STOP_DONE_ACTOR, clock: 'per-pass',
    });
    expect(facts(IDLE_HOURS_LANE)).toEqual({
      kill: [HIBERNATE_DISABLED_MARKER], arming: HIBERNATE_LIVE_MARKER, cadence: 'sleepIdleHours',
      population: 'recorded-rows-in-frame-order', caps: { acts: 3, measures: null, past: 'wait' }, acts: 'inline',
      retry: { kind: 'ask-next-pass', lineMs: HIBERNATE_ACT_LINE_MS, shadowLineMs: HIBERNATE_SHADOW_LINE_MS, of: undefined },
      store: 'optional', unarmed: 'shadow', verb: 'arms-and-asked-at-act', holdOk: false, actor: HIBERNATE_SWEEP_ACTOR,
      clock: 'per-row',
    });
  });
});

describe('C4d: the act-time rows, through sleepPass', () => {
  it.each(WINDOW)('run-done: %s between the pass and the act holds', async (_n, between, reason) => {
    const w = world();
    w.beforeAct = () => between(w);
    expect(await NEW_PASSES.runDone(sdDeps(w), sdMem(), [row(ID)], [rec(ID)], [])).toEqual([{ id: ID, kind: 'held-at-act', verdict: { act: 'hold', reason } }]);
    expect(w.argv).toEqual([]);
  });

  it.each(WINDOW)('idle-hours: %s between the pass and the act holds', async (_n, between, reason) => {
    const w = world();
    w.beforeAct = () => between(w);
    expect(await NEW_PASSES.idleHours(hbDeps(w), hbMem(), [row(ID)], [rec(ID)], [HIBERNATE_LIVE_MARKER]))
      .toEqual([{ id: ID, verdict: { act: 'hibernate', idleMs: 7 * HOUR }, act: { kind: 'held-at-act', verdict: { act: 'hold', reason } } }]);
    expect(w.argv).toEqual([]);
  });

  it('the roster falls back to the tick\'s read only when the re-read row has none (both lanes)', async () => {
    for (const [reread, expected] of [[undefined, 'roster'], [[], 'acted']] as const) {
      const sdw = world();
      const tick = row(ID);
      if (reread !== undefined) sdw.atAct.set(ID, { subagents: reread });
      sdw.beforeAct = () => { (tick as unknown as { subagents: unknown }).subagents = [{ id: 'agent-a' }]; };
      const out = await NEW_PASSES.runDone(sdDeps(sdw), sdMem(), [tick], [rec(ID)], []);
      expect(out[0]!.kind === 'held-at-act' ? word(out[0]!.verdict) : 'acted', `run-done ${String(reread)}`).toBe(expected);
      const hbw = world();
      const htick = row(ID);
      if (reread !== undefined) hbw.atAct.set(ID, { subagents: reread });
      hbw.beforeAct = () => { (htick as unknown as { subagents: unknown }).subagents = [{ id: 'agent-a' }]; };
      const act = (await NEW_PASSES.idleHours(hbDeps(hbw), hbMem(), [htick], [rec(ID)], [HIBERNATE_LIVE_MARKER]))[0]!.act!;
      expect(act.kind === 'held-at-act' ? word(act.verdict) : 'acted', `idle-hours ${String(reread)}`).toBe(expected);
    }
  });

  it('the serialiser wraps the session\'s queue, and every re-read is inside them (both lanes)', async () => {
    const sdw = world();
    await NEW_PASSES.runDone(sdDeps(sdw), sdMem(), [row(ID)], [rec(ID)], []);
    expect(sdw.events.slice(sdw.events.indexOf('serial'))).toEqual(['serial', `queue ${ID}`, `word ${ID}`, `turn ${ID}`, `mark ${ID}`, `ccd ${ID}`]);
    const hbw = world();
    await NEW_PASSES.idleHours(hbDeps(hbw), hbMem(), [row(ID)], [rec(ID)], [HIBERNATE_LIVE_MARKER]);
    expect(hbw.events.slice(hbw.events.indexOf('serial'))).toEqual(['serial', `queue ${ID}`, `word ${ID}`, `mark ${ID}`, `ccd ${ID}`]);
  });

  it('a call that never ran is a failure, never a busy refusal read off its stderr (D-6840; both lanes)', async () => {
    const never: CcdResult = { ran: false, ok: false, stdout: '', stderr: 'ccd: session-busy: attached', killed: false, signal: null } as CcdResult;
    const sdw = world();
    sdw.answer = () => never;
    expect(await NEW_PASSES.runDone(sdDeps(sdw), sdMem(), [row(ID)], [rec(ID)], []))
      .toEqual([{ id: ID, kind: 'failed', detail: 'ccd: session-busy: attached' }]);
    const hbw = world();
    hbw.answer = () => never;
    expect((await NEW_PASSES.idleHours(hbDeps(hbw), hbMem(), [row(ID)], [rec(ID)], [HIBERNATE_LIVE_MARKER]))[0]!.act)
      .toEqual({ kind: 'failed', detail: 'ccd: session-busy: attached' });
  });
});

/** One scenario's every observable: the outcomes, the argv, the feed, the lines, the warnings and the event order. */
async function observed<O>(setup: (w: World) => void, pass: (w: World) => Promise<O>) {
  const w = world();
  setup(w);
  const warns: string[] = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((l: unknown) => { warns.push(String(l)); });
  try {
    const out = await pass(w);
    return { out, argv: w.argv, feed: w.feed, lines: w.lines, warns, events: w.events };
  } finally {
    spy.mockRestore();
  }
}

const SCENARIOS: ReadonlyArray<readonly [string, (w: World) => void, string[], string[]]> = [
  ['clear', () => undefined, [ID], []],
  ['five candidates', () => undefined, ids(5), []],
  ['eight busy turns and words', (w) => { for (const id of ids(8)) { w.turns.set(id, 'busy'); w.words.set(id, 'busy'); } }, ids(8), []],
  ['busy refusal', (w) => { w.answer = () => BUSY; }, ids(2), []],
  ['refusal', (w) => { w.answer = () => REFUSED; }, ids(2), []],
  ['thrown runner', (w) => { w.answer = () => { throw new Error('boom'); }; }, ids(2), []],
  ['mail on one', (w) => { w.mail.add(ids(3)[1]!); }, ids(3), []],
  ['a viewer opened at the act', (w) => { w.beforeAct = () => { w.viewers.add(ID); }; }, [ID], []],
  ['no serialiser', (w) => { w.serial = false; }, [ID], []],
  ['no verb on the box', (w) => { w.verbs.splice(0, w.verbs.length, ACTOR_FLAGS_CAP); }, [ID], []],
  ['reclaim-paused', () => undefined, [ID], [RECLAIM_PAUSE_MARKER]],
  ['opted out', () => undefined, [ID], [`${ID}.${NO_HIBERNATE_SUFFIX}`]],
];

describe('C4d: sleepPass equals the old pass on every observable, scenario by scenario', () => {
  it.each(SCENARIOS)('run-done: %s', async (_n, setup, list, names) => {
    const run = (p: LanePasses) => (w: World) => p.runDone(sdDeps(w), sdMem(), list.map((id) => row(id)), list.map(rec), names);
    expect(await observed(setup, run(NEW_PASSES))).toEqual(await observed(setup, run(OLD_PASSES)));
  });

  it.each(SCENARIOS)('idle-hours (armed): %s', async (_n, setup, list, names) => {
    const run = (p: LanePasses) => (w: World) => p.idleHours(hbDeps(w), hbMem(), list.map((id) => row(id)), list.map(rec), [HIBERNATE_LIVE_MARKER, ...names]);
    expect(await observed(setup, run(NEW_PASSES))).toEqual(await observed(setup, run(OLD_PASSES)));
  });

  it.each(SCENARIOS)('idle-hours (shadow): %s', async (_n, setup, list, names) => {
    const run = (p: LanePasses) => (w: World) => p.idleHours(hbDeps(w), hbMem(), list.map((id) => row(id)), list.map(rec), names);
    expect(await observed(setup, run(NEW_PASSES))).toEqual(await observed(setup, run(OLD_PASSES)));
  });
});

// ── C4e (D-7045; ARCH-43, fifth PR): the tick starts both sleep lanes, and neither waits on the other ──────────────────
//
// Characterization, green on the old code (two `void` calls on the tick, each lane behind its own guard field) and kept
// unedited through C4e's one `sweepSleep` (Review focus 9). The rows drive the REAL tick over one fixture worker both
// lanes would put to sleep: a dispatched child whose run closed past the grace, idle, its `done` marker 7 h old. Each
// lane is seen through its own `SLEEP_LANES` row (its `quietMs`, asked once at the head of every pass), never through a
// watcher method a refactor renames. The serialiser and the session queue are test-owned promises.

import { writeFileSync } from 'node:fs';
import { Viewers } from '../src/viewer.js';
import type { Runner } from '../src/exec.js';

describe('C4e: the tick starts both sleep lanes, and neither waits on the other (Review focus 9)', () => {
  const WID = ID;
  const WUUID = `u-${WID}`;
  const WRAPPER = 'claude-a';
  const PANE = 4242;

  const gate = () => {
    let open: () => void = () => undefined;
    const shut = new Promise<void>((r) => { open = r; });
    return { shut, open: () => open() };
  };

  /** The fixture: a registry, a real store and a pane the runner answers for; the watcher built a day in the past, so
   *  neither lane's presence-after-start hold stands. `serial` and `queue` wrap the act's two locks. */
  const tickRig = (o: { live: boolean; serial?: Promise<void>; queue?: Promise<void> }) => {
    const home = mkTmp('ccrc-sleep-tick-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'p', title: 't', project: 'project-a', wave: 1, waveOf: 1, claimedBy: 'c' });
    if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
    coord.markDispatched(opened.id, WID, WID, `ws/${WID}`, false);
    for (const to of ['dispatched', 'working'] as const) {
      const a = coord.advance(opened.id, to, 'test');
      if (!a.ok) throw new Error(`fixture advance to ${to} refused: ${JSON.stringify(a)}`);
    }
    const closed = coord.closeRun({ runId: opened.id, finalState: 'done', causedBy: 'test', handoffCommit: null, program: 'p', viaClosing: true });
    if (!closed.ok) throw new Error(`fixture closeRun refused: ${JSON.stringify(closed)}`);
    coord.db.prepare('UPDATE runs SET closedAt = ? WHERE id = ?').run(Date.now() - GRACE - MIN, opened.id);
    const fields: Record<string, string> = {
      wrapper: WRAPPER, project: 'project-a', workdir: `/w/${WID}`, uuid: WUUID, started: '1',
      workspace: WID, branch: `ws/${WID}`, base: 'origin/main', child: String(opened.id),
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${WID}.${k}`), v);
    if (o.live) writeFileSync(path.join(reg, HIBERNATE_LIVE_MARKER), '');
    const sessions = path.join(home, `.${WRAPPER}`, 'sessions');
    mkdirSync(sessions, { recursive: true });
    writeFileSync(path.join(sessions, `${PANE}.json`), JSON.stringify({
      pid: PANE, sessionId: WUUID, status: 'idle', statusUpdatedAt: Date.now() - 20 * MIN, startedAt: Date.now() - 24 * HOUR }));
    const at = Date.now() - 7 * HOUR;
    writeFileSync(path.join(reg, `${WID}.turn.json`), `${JSON.stringify({
      v: 1, sessionId: WUUID, state: 'done', event: 'Stop', at, turnAt: at - MIN, stopAt: at,
      bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', crons: 0 })}\n`);
    const calls: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      calls.push([...args]);
      if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PANE}\n`, stderr: '' };
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    const deps = { ...testDeps(home, run), cfg, coord, fleetState: { ccdVerbs: ['hibernate'] }, viewers: new Viewers(() => Date.now()) };
    // `queue` counts only the entries made inside the serialiser: an act's (other users of the queue are not counted).
    const entered = { serial: 0, queue: 0 };
    let inSerial = 0;
    const queue = deps.queue as { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
    const queued = queue.run.bind(queue);
    queue.run = async (id, fn) => {
      if (inSerial === 0) return queued(id, fn);
      entered.queue++;
      if (o.queue) await o.queue;
      return queued(id, fn);
    };
    const born = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 24 * HOUR);
    const w = new FleetWatcher(deps as never, new Bus(), 10_000);
    born.mockRestore();
    w.useStopDoneSerialiser({ serial: async (fn: () => Promise<unknown>) => {
      entered.serial++;
      if (o.serial) await o.serial;
      inSerial++;
      try { return await fn(); } finally { inSerial--; }
    } } as never);
    const warns: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((l: unknown) => { warns.push(String(l)); });
    const started: string[] = [];
    for (const lane of SLEEP_LANES) {
      const ask = lane.quietMs.bind(lane);
      vi.spyOn(lane, 'quietMs').mockImplementation(((d: never, n: readonly string[]) => { started.push(lane.policy.name); return ask(d, n); }) as never);
    }
    const sleeps = () => calls.filter((c) => c[0] === 'hibernate');
    const lines = (s: string) => warns.filter((l) => l.includes(s));
    return { w, coord, entered, warns, started, sleeps, lines };
  };

  it('the priming tick runs neither', async () => {
    const r = tickRig({ live: false });
    try {
      await r.w.tick();
      await new Promise((res) => setTimeout(res, 50));
      expect(r.started).toEqual([]);
      expect(r.sleeps()).toEqual([]);
    } finally { r.coord.db.close(); }
  });

  it('both lanes run on the same tick in today\'s order', async () => {
    const r = tickRig({ live: false });
    try {
      await r.w.tick();
      await r.w.tick();
      expect(r.started, 'run-done starts first, then idle-hours, on the one tick').toEqual(['run-done', 'idle-hours']);
      await vi.waitFor(() => { expect(r.lines('stop-done: put')).toHaveLength(1); expect(r.lines('hibernate-shadow')).toHaveLength(1); });
    } finally { r.coord.db.close(); }
  });

  it('a lane\'s catch sentence on a thrown pass, through the tick', async () => {
    const r = tickRig({ live: false });
    try {
      for (const lane of SLEEP_LANES) vi.mocked(lane.quietMs).mockImplementation(() => { throw new Error('boom'); });
      await r.w.tick();
      await r.w.tick();
      const caught = () => r.warns.filter((l) => /^ccrc-server: sweep(?:StopDone|Hibernate) failed/.test(l));
      await vi.waitFor(() => { expect(caught()).toHaveLength(2); });
      expect(caught()).toEqual([
        'ccrc-server: sweepStopDone failed (boom) — no stops this pass',
        'ccrc-server: sweepHibernate failed (boom) — no verdicts this pass',
      ]);
    } finally { r.coord.db.close(); }
  });

  it('a run-done pass blocked on the serialiser does not delay or stop the idle-hours pass', async () => {
    const g = gate();
    const r = tickRig({ live: false, serial: g.shut });
    try {
      await r.w.tick();
      await r.w.tick();
      await vi.waitFor(() => { expect(r.entered.serial, 'run-done holds at the serialiser').toBe(1); });
      await vi.waitFor(() => { expect(r.lines('hibernate-shadow'), 'idle-hours finished its pass behind it').toEqual([`ccrc-server: hibernate-shadow ${WID} idle=7h`]); });
      expect(r.sleeps(), 'nothing acted while the serialiser was held').toEqual([]);
      g.open();
      await vi.waitFor(() => { expect(r.sleeps()).toEqual([['hibernate', WID]]); expect(r.lines('stop-done: put')).toHaveLength(1); });
    } finally { g.open(); r.coord.db.close(); }
  });

  it('a run-done pass blocked on the serialiser: armed, the idle-hours pass still measures every row and its act queues on the one shared serialiser', async () => {
    const g = gate();
    const r = tickRig({ live: true, serial: g.shut });
    try {
      await r.w.tick();
      await r.w.tick();
      await vi.waitFor(() => { expect(r.entered.serial, 'both acts wait on the one serialiser, neither behind the other lane\'s pass').toBe(2); });
      expect(r.sleeps()).toEqual([]);
      expect(r.lines('hibernate-shadow'), 'armed: no shadow line').toEqual([]);
      g.open();
      await vi.waitFor(() => { expect(r.entered.queue).toBe(2); });
      await vi.waitFor(() => {
        expect(r.sleeps(), 'released, each lane composes its own act').toEqual([['hibernate', WID], ['hibernate', WID]]);
        expect([r.lines('stop-done: put').length, r.lines(`hibernated ${WID}`).length]).toEqual([1, 1]);
      });
    } finally { g.open(); r.coord.db.close(); }
  });

  it('the reverse: an idle-hours act blocked on a session\'s queue does not delay the run-done pass\'s measures', async () => {
    const g = gate();
    const r = tickRig({ live: true, queue: g.shut });
    try {
      await r.w.tick();
      await r.w.tick();
      await vi.waitFor(() => { expect(r.entered.queue, 'each lane measured its row and reached its act, the other\'s act held').toBe(2); });
      expect(r.sleeps()).toEqual([]);
      g.open();
      await vi.waitFor(() => {
        expect(r.sleeps(), 'released, each lane composes its own act').toEqual([['hibernate', WID], ['hibernate', WID]]);
        expect([r.lines('stop-done: put').length, r.lines(`hibernated ${WID}`).length]).toEqual([1, 1]);
      });
    } finally { g.open(); r.coord.db.close(); }
  });
});
