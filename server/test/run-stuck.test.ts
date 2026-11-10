// D-8071 (spec 2026-11-04 §7, A4, A28, A29, A39, A45, A46, A54 to A57, A60, A63): the stuck verdict. Pure rows first
// (`runStuck.ts`, L1), then the pass that feeds the one in-memory reader (`runStuckPass.ts`), then the reader and the wire.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { localIO } from '../src/io.js';
import type { SessionVerdict } from '../src/exec.js';
import type { DeadCoordinatorJournal } from '../src/deadCoordinator.js';
import { DEAD_COORDINATOR_JOURNAL_TRUSTED } from '../src/deadCoordinator.js';
import {
  blockedByOf, claimantGone, runStuck, runWaitsOn, secondsToMs, stuckCause, stuckSince,
  type PersonFacts, type RunStuckFacts, type StoredTimes,
} from '../src/coord/runStuck.js';
import { createRunVerdicts } from '../src/coord/runVerdicts.js';
import { runStuckPass, type RunStuckPassDeps } from '../src/coord/runStuckPass.js';
import { withVerdicts } from '../src/coord/runWire.js';
import { abandonDetail } from '../src/coord/close.js';
import type { RunWaitsOn } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

const alive: PersonFacts = { verdict: { state: 'alive' }, hibernatedAt: null, substrate: null };
const dead = (cause: 'orphan' | 'never-started' | 'absent' | 'stopped' = 'orphan', over: Partial<PersonFacts> = {}): PersonFacts =>
  ({ verdict: { state: 'dead', cause }, hibernatedAt: null, substrate: null, ...over });
const quiet: DeadCoordinatorJournal = { kind: 'quiet', started: true };

const zero: StoredTimes = {
  journalAt: null, archivedAt: null, stoppedAt: null, workerStoppedAt: null, deadFirstAt: null, supervisedAt: null,
  goneSinceCoordinator: null, goneSinceWorker: null, openedAt: NOW - H, dispatchStartedAt: null, targetClosedAt: null,
  laterReviewAt: null, overtakenAt: null, nameReusedAt: null,
};
const times = (over: Partial<StoredTimes> = {}): StoredTimes => ({ ...zero, ...over });
const facts = (over: Partial<RunStuckFacts> = {}): RunStuckFacts => ({
  id: 1, state: 'planned', kind: 'work', dispatchStartedAt: null, dispatchedAt: null, lastMoveAt: null,
  claimant: alive, claimantJournal: quiet, worker: null, workerJournal: null, target: null, laterReviewMoved: false, e1Quiet: false,
  overtaken: false, aloneInProgramme: false, reviewOpen: null, behind: null, times: times(), ...over,
});

describe('runStuck — §7\'s table, row by row, first match wins', () => {
  it('owner-gone at 1 h of a dead claimant, not at 59 min', () => {
    const f = (ago: number): RunStuckFacts => facts({ claimant: dead(), times: times({ goneSinceCoordinator: NOW - ago }) });
    expect(runStuck(f(H), NOW)).toEqual({ reason: 'owner-gone', cause: 'coordinator-gone', since: NOW - H, closes: null });
    expect(runStuck(f(59 * MIN), NOW)).toBeNull();
  });
  it('start-never-landed over 1 h', () => {
    const f = (ago: number): RunStuckFacts => facts({ dispatchStartedAt: NOW - ago, times: times({ dispatchStartedAt: NOW - ago }) });
    expect(runStuck(f(H + 1), NOW)).toMatchObject({ reason: 'start-never-landed', cause: null, since: NOW - H - 1 });
    expect(runStuck(f(H), NOW)).toBeNull();
    expect(runStuck({ ...f(2 * H), dispatchedAt: NOW - H }, NOW)).toBeNull();
  });
  it('review-of-closed over 1 h', () => {
    const f = (ago: number): RunStuckFacts => facts({ kind: 'review', target: { closed: true }, times: times({ targetClosedAt: NOW - ago }) });
    expect(runStuck(f(H + 1), NOW)).toMatchObject({ reason: 'review-of-closed', cause: 'target-closed', since: NOW - H - 1 });
    expect(runStuck(f(H), NOW)).toBeNull();
    expect(runStuck(facts({ kind: 'review', target: { closed: false }, times: times() }), NOW)).toBeNull();
  });
  it('overtaken over 24 h', () => {
    const f = (ago: number): RunStuckFacts => facts({ overtaken: true, times: times({ overtakenAt: NOW - ago }) });
    expect(runStuck(f(D + 1), NOW)).toMatchObject({ reason: 'overtaken', cause: null, since: NOW - D - 1 });
    expect(runStuck(f(D), NOW)).toBeNull();
  });
  it('never-started over 7 days with nothing else open', () => {
    const f = (ago: number, alone: boolean): RunStuckFacts => facts({ aloneInProgramme: alone, times: times({ openedAt: NOW - ago }) });
    expect(runStuck(f(7 * D + 1, true), NOW)).toMatchObject({ reason: 'never-started', cause: null, since: NOW - 7 * D - 1 });
    expect(runStuck(f(7 * D, true), NOW)).toBeNull();
    expect(runStuck(f(30 * D, false), NOW)).toBeNull();
  });
  it('first match wins: owner-gone over never-started', () => {
    const v = runStuck(facts({ claimant: dead(), aloneInProgramme: true,
      times: times({ openedAt: NOW - 30 * D, goneSinceCoordinator: NOW - 2 * H }) }), NOW);
    expect(v?.reason).toBe('owner-gone');
  });
  it('a worker gone with no move for 24 h reads owner-gone, and a recent move holds it', () => {
    const f = (move: number | null): RunStuckFacts => facts({ state: 'working', worker: dead(), lastMoveAt: move,
      times: times({ goneSinceWorker: NOW - 2 * D }) });
    expect(runStuck(f(null), NOW)).toMatchObject({ reason: 'owner-gone', cause: 'worker-gone', since: NOW - 2 * D });
    expect(runStuck(f(NOW - 23 * H), NOW)).toBeNull();
    expect(runStuck(f(NOW - D), NOW)?.reason).toBe('owner-gone');
  });
  it('hibernated is never owner-gone', () => {
    const f = facts({ claimant: dead('orphan', { hibernatedAt: NOW - 3 * D }), times: times({ goneSinceCoordinator: NOW - 3 * D }) });
    expect(runStuck(f, NOW)).toBeNull();
    expect(claimantGone(f.claimant!)).toBe('asleep');
  });
  it('an absent claimant with no history gets no verdict', () => {
    const f = facts({ claimant: dead('absent'), claimantJournal: { kind: 'no-history' }, times: times({ goneSinceCoordinator: NOW - 3 * D }) });
    expect(runStuck(f, NOW)).toBeNull();
    expect(runStuck({ ...f, claimantJournal: quiet }, NOW)?.reason).toBe('owner-gone');
  });
  it('an uncertain reading gives no verdict', () => {
    const f = facts({ claimant: { verdict: { state: 'unmeasurable' }, hibernatedAt: null, substrate: null },
      times: times({ goneSinceCoordinator: NOW - 3 * D }) });
    expect(claimantGone(f.claimant!)).toBe('uncertain');
    expect(runStuck(f, NOW)).toBeNull();
  });
  it('an uncertain claimant blocks every later row too (rule R2)', () => {
    const sub = dead('orphan', { substrate: { at: NOW - 3 * D, text: 'x' } });
    const unm: PersonFacts = { verdict: { state: 'unmeasurable' }, hibernatedAt: null, substrate: null };
    const absent = dead('absent');
    const cases: Partial<RunStuckFacts>[] = [
      { claimant: sub, dispatchStartedAt: NOW - 2 * H, times: times({ dispatchStartedAt: NOW - 2 * H }) },
      { claimant: sub, aloneInProgramme: true, times: times({ openedAt: NOW - 9 * D }) },
      { claimant: unm, aloneInProgramme: true, times: times({ openedAt: NOW - 9 * D }) },
      { claimant: absent, claimantJournal: { kind: 'no-history' }, overtaken: true, times: times({ overtakenAt: NOW - 2 * D }) },
      { claimant: sub, kind: 'review', target: { closed: true }, times: times({ targetClosedAt: NOW - 2 * H }) },
    ];
    for (const c of cases) expect(runStuck(facts(c), NOW)).toBeNull();
  });
  it('an uncertain worker of a started run gives no verdict', () => {
    const f = facts({ state: 'working', worker: dead('orphan', { substrate: { at: NOW - 3 * D, text: 'x' } }),
      times: times({ goneSinceWorker: NOW - 3 * D }) });
    expect(runStuck(f, NOW)).toBeNull();
  });
  it('a person with no stored time gets no verdict that pass', () => {
    expect(runStuck(facts({ claimant: dead() }), NOW)).toBeNull();
  });
  it('closes is null on every verdict', () => {
    const all = [
      facts({ claimant: dead(), times: times({ goneSinceCoordinator: NOW - 2 * H }) }),
      facts({ dispatchStartedAt: NOW - 2 * H }),
      facts({ kind: 'review', target: { closed: true }, times: times({ targetClosedAt: NOW - 2 * H }) }),
      facts({ overtaken: true, times: times({ overtakenAt: NOW - 2 * D }) }),
      facts({ aloneInProgramme: true, times: times({ openedAt: NOW - 9 * D }) }),
    ];
    for (const f of all) expect(runStuck(f, NOW)).toMatchObject({ closes: null });
  });
  it('a closed or unknown run has no verdict', () => {
    for (const state of ['done', 'failed', 'unknown'] as const) expect(runStuck(facts({ state, claimant: dead(), times: times({ goneSinceCoordinator: 1 }) }), NOW)).toBeNull();
  });
});

describe('doubt (A56)', () => {
  it('a substrate stamp over a gone pane gives no verdict under every dead lifecycle (D-7370)', () => {
    for (const cause of ['orphan', 'never-started', 'absent', 'stopped'] as const) {
      const p = dead(cause, { substrate: { at: 1, text: 'tmux unreachable' } });
      expect(claimantGone(p)).toBe('uncertain');
      expect(runStuck(facts({ claimant: p, times: times({ goneSinceCoordinator: NOW - 3 * D }) }), NOW)).toBeNull();
    }
  });
  it('a hibernated orphan or never-started claimant is asleep, and hibernation wins over a substrate stamp (D-7371)', () => {
    for (const cause of ['orphan', 'never-started'] as const) {
      expect(claimantGone(dead(cause, { hibernatedAt: 5 }))).toBe('asleep');
      expect(claimantGone(dead(cause, { hibernatedAt: 5, substrate: { at: 1, text: 'x' } }))).toBe('asleep');
    }
  });
  it('a worker\'s substrate stamp gives no owner-gone', () => {
    const f = facts({ state: 'working', worker: dead('orphan', { substrate: { at: 1, text: 'x' } }), times: times({ goneSinceWorker: NOW - 3 * D }) });
    expect(runStuck(f, NOW)).toBeNull();
  });
});

describe('since, one case per reason (A39)', () => {
  it('each reason\'s since is the stored time it names', () => {
    expect(runStuck(facts({ claimant: dead(), times: times({ goneSinceCoordinator: NOW - 5 * H }) }), NOW)?.since).toBe(NOW - 5 * H);
    expect(runStuck(facts({ dispatchStartedAt: NOW - 3 * H }), NOW)?.since).toBe(NOW - 3 * H);
    expect(runStuck(facts({ kind: 'review', target: { closed: true }, times: times({ targetClosedAt: NOW - 4 * H }) }), NOW)?.since).toBe(NOW - 4 * H);
    // overtaken's is the first later wave to leave planned, which the facts carry as `overtakenAt`.
    expect(runStuck(facts({ overtaken: true, times: times({ overtakenAt: NOW - 3 * D }) }), NOW)?.since).toBe(NOW - 3 * D);
    expect(runStuck(facts({ aloneInProgramme: true, times: times({ openedAt: NOW - 9 * D }) }), NOW)?.since).toBe(NOW - 9 * D);
  });
});

describe('causes (A54)', () => {
  const journal = (act: Extract<DeadCoordinatorJournal, { kind: 'deliberate' }>['act']): DeadCoordinatorJournal => ({ kind: 'deliberate', act, at: 5 });
  it('archivedAt gives coordinator-archived, and so does an archive act', () => {
    expect(stuckCause(dead('stopped', { archivedAt: 5 }), quiet, 'coordinator')).toBe('coordinator-archived');
    expect(stuckCause(dead('stopped'), journal('archive'), 'coordinator')).toBe('coordinator-archived');
  });
  it('forget gives coordinator-forgotten', () => {
    expect(stuckCause(dead('stopped'), journal('forget'), 'coordinator')).toBe('coordinator-forgotten');
  });
  it('purge, destroy, reap, reclaim and expire give coordinator-removed', () => {
    for (const act of ['purge', 'destroy', 'reap', 'reclaim', 'expire'] as const) {
      expect(stuckCause(dead('orphan'), journal(act), 'coordinator')).toBe('coordinator-removed');
    }
  });
  it('stop or a stopped lifecycle gives coordinator-stopped', () => {
    expect(stuckCause(dead('orphan'), journal('stop'), 'coordinator')).toBe('coordinator-stopped');
    expect(stuckCause(dead('stopped'), quiet, 'coordinator')).toBe('coordinator-stopped');
  });
  it('a crash or an unreadable journal gives coordinator-gone', () => {
    expect(stuckCause(dead('orphan'), quiet, 'coordinator')).toBe('coordinator-gone');
    expect(stuckCause(dead('orphan'), { kind: 'unreadable', detail: 'x' }, 'coordinator')).toBe('coordinator-gone');
  });
  it('a worker reading orphan, never-started or absent with history gives worker-gone, and stopped gives worker-stopped', () => {
    for (const c of ['orphan', 'never-started', 'absent'] as const) expect(stuckCause(dead(c), quiet, 'worker')).toBe('worker-gone');
    expect(stuckCause(dead('stopped'), quiet, 'worker')).toBe('worker-stopped');
  });
  it('every owner-gone verdict has a cause, and the other reasons but review-of-closed have a null cause', () => {
    const gone = runStuck(facts({ claimant: dead(), times: times({ goneSinceCoordinator: NOW - 2 * H }) }), NOW)!;
    expect(gone.cause).not.toBeNull();
    expect(runStuck(facts({ dispatchStartedAt: NOW - 2 * H }), NOW)!.cause).toBeNull();
    expect(runStuck(facts({ overtaken: true, times: times({ overtakenAt: NOW - 2 * D }) }), NOW)!.cause).toBeNull();
    expect(runStuck(facts({ aloneInProgramme: true, times: times({ openedAt: NOW - 9 * D }) }), NOW)!.cause).toBeNull();
    expect(runStuck(facts({ kind: 'review', target: { closed: true }, times: times({ targetClosedAt: NOW - 2 * H }) }), NOW)!.cause).toBe('target-closed');
  });
  it('since is the act the cause names', () => {
    expect(stuckSince('coordinator-archived', 'owner-gone', times({ journalAt: 11, archivedAt: 22 }))).toBe(11);
    expect(stuckSince('coordinator-archived', 'owner-gone', times({ archivedAt: 22 }))).toBe(22);
    expect(stuckSince('coordinator-forgotten', 'owner-gone', times({ journalAt: 11 }))).toBe(11);
    expect(stuckSince('coordinator-removed', 'owner-gone', times({ journalAt: 11 }))).toBe(11);
    expect(stuckSince('coordinator-stopped', 'owner-gone', times({ journalAt: 11, stoppedAt: 33 }))).toBe(11);
    expect(stuckSince('coordinator-stopped', 'owner-gone', times({ stoppedAt: 33 }))).toBe(33);
    expect(stuckSince('worker-stopped', 'owner-gone', times({ workerStoppedAt: 44 }))).toBe(44);
  });
});

describe('stored times (A63)', () => {
  it('a crash reads the lane\'s anchor over gone_since, raised by the supervisor\'s stamp', () => {
    expect(stuckSince('coordinator-gone', 'owner-gone', times({ deadFirstAt: 100, goneSinceCoordinator: 50 }))).toBe(100);
    expect(stuckSince('coordinator-gone', 'owner-gone', times({ deadFirstAt: 100, supervisedAt: 150 }))).toBe(150);
    expect(stuckSince('coordinator-gone', 'owner-gone', times({ deadFirstAt: 100, supervisedAt: 60 }))).toBe(100);
  });
  it('a crash with no lane row reads gone_since', () => {
    expect(stuckSince('coordinator-gone', 'owner-gone', times({ goneSinceCoordinator: 50 }))).toBe(50);
  });
  it('worker-gone reads gone_since; no stored time is null', () => {
    expect(stuckSince('worker-gone', 'owner-gone', times({ goneSinceWorker: 70 }))).toBe(70);
    expect(stuckSince('worker-gone', 'owner-gone', times())).toBeNull();
    expect(stuckSince('coordinator-gone', 'owner-gone', times())).toBeNull();
  });
  it('archivedAt and stopped.at are seconds and read as ms', () => {
    expect(secondsToMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(secondsToMs(null)).toBeNull();
    expect(secondsToMs(0)).toBeNull();
  });
});

describe('waitsOn (A29)', () => {
  const w = (over: Partial<RunStuckFacts>): RunWaitsOn | undefined => runWaitsOn(facts(over));
  it('the table, row by row', () => {
    expect(w({ state: 'planned' })).toBe('coordinator');
    expect(w({ state: 'planned', claimant: dead() })).toBe('nobody');
    expect(w({ state: 'dispatched', worker: alive })).toBe('worker');
    expect(w({ state: 'working', worker: dead() })).toBe('nobody');
    expect(w({ state: 'awaiting-review', reviewOpen: true })).toBe('reviewer');
    expect(w({ state: 'awaiting-review', reviewOpen: false })).toBe('coordinator');
    expect(w({ state: 'merging' })).toBe('merge-queue');
    expect(w({ state: 'closing' })).toBe('coordinator');
    for (const state of ['unknown', 'done', 'failed'] as const) expect(w({ state })).toBeUndefined();
  });
  it('waitsOn has no operator value', () => {
    // @ts-expect-error — `operator` is not a RunWaitsOn (D-6170): "waits on you" comes only from the one needs-you source.
    const bad: RunWaitsOn = 'operator';
    expect(bad).toBe('operator');
  });
  it('blockedBy names the run a planned run waits behind, and only a planned run', () => {
    expect(blockedByOf(facts({ state: 'planned', behind: 7 }))).toBe(7);
    expect(blockedByOf(facts({ state: 'working', behind: 7 }))).toBeNull();
  });
});

// ── the pass, over a real store and a fixture registry ──────────────────────────────────────────────────────────────

const GONE: SessionVerdict = { verdict: 'gone' };
const LIVE: SessionVerdict = { verdict: 'live' };
const COORD = 'demo-quiet-mesa';
const WORKER = 'demo-brisk-fen';

const seedRow = (home: string, id: string, extra: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`, started: '1', workspace: id,
    branch: `ws/${id}`, base: 'origin/main', ...extra,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

interface Harness {
  readonly home: string; readonly coord: CoordStore; readonly deps: RunStuckPassDeps;
  readonly clock: { t: number }; readonly panes: Map<string, SessionVerdict>;
  open(over?: { program?: string; wave?: number; claimedBy?: string }): number;
}
const harness = (): Harness => {
  const home = mkTmp('ccrc-stuck-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const clock = { t: NOW };
  const panes = new Map<string, SessionVerdict>();
  const deps: RunStuckPassDeps = {
    coord, io: localIO, cfg: testDeps(home).cfg, tmux: { sessionVerdict: async (id) => panes.get(id) ?? GONE },
    verdicts: createRunVerdicts(), journalTrust: async () => ({ hold: null, trust: DEAD_COORDINATOR_JOURNAL_TRUSTED }),
    now: () => clock.t,
  };
  const open: Harness['open'] = (over = {}) => {
    const r = coord.openRun({ program: over.program ?? 'programme-a', title: 'Lane A', project: 'demo', wave: over.wave ?? 1, waveOf: 3,
      claimedBy: over.claimedBy ?? COORD });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    coord.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(NOW, r.id);
    return r.id;
  };
  return { home, coord, deps, clock, panes, open };
};
const setCol = (h: Harness, id: number, col: string, v: number | null): void => {
  h.coord.db.prepare(`UPDATE runs SET ${col} = ? WHERE id = ?`).run(v, id);
};

describe('the pass', () => {
  it('a crash first read at T reads owner-gone one hour on, with since T, and not at 59 min', async () => {
    const h = harness(); seedRow(h.home, COORD);
    const id = h.open(); setCol(h, id, 'openedAt', NOW);
    await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(id)).toMatchObject({ stuck: null, coordinatorGone: true, waitsOn: 'nobody' });
    for (let m = 5; m <= 59; m += 5) { h.clock.t = NOW + m * MIN; await runStuckPass(h.deps); }
    h.clock.t = NOW + 59 * MIN; await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(id)!.stuck).toBeNull();
    h.clock.t = NOW + H; await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(id)!.stuck).toEqual({ reason: 'owner-gone', cause: 'coordinator-gone', since: NOW, closes: null });
  });
  it('gone_since is written only for a person with no other stored time', async () => {
    const h = harness(); seedRow(h.home, COORD, { stopped: `${Math.floor(NOW / 1000) - 3600} ccd` }); seedRow(h.home, WORKER);
    const a = h.open(); const b = h.open({ program: 'programme-b', claimedBy: 'other-coord' });
    h.coord.setSession(b, WORKER); void a;
    await runStuckPass(h.deps);
    // The stopped coordinator has its stop stamp, so no row; the unlisted 'other-coord' is absent with no history (doubt).
    expect([...h.coord.goneSince().keys()]).toEqual([]);
    const c = h.open({ program: 'programme-c', claimedBy: COORD + '-2' }); void c;
    seedRow(h.home, COORD + '-2');
    await runStuckPass(h.deps);
    expect([...h.coord.goneSince().keys()]).toEqual([COORD + '-2']);
  });
  it('a later pass moves lastGoneAt alone, and a gap over DEAD_COORDINATOR_GAP_MS starts afresh', async () => {
    const h = harness(); seedRow(h.home, COORD); h.open();
    await runStuckPass(h.deps);
    h.clock.t = NOW + 5 * MIN; await runStuckPass(h.deps);
    expect(h.coord.goneSince().get(COORD)).toEqual({ firstGoneAt: NOW, lastGoneAt: NOW + 5 * MIN });
    h.clock.t = NOW + 5 * MIN + 11 * MIN; await runStuckPass(h.deps);
    expect(h.coord.goneSince().get(COORD)).toEqual({ firstGoneAt: NOW + 16 * MIN, lastGoneAt: NOW + 16 * MIN });
  });
  it('alive or asleep deletes the row; an uncertain pass moves lastGoneAt alone, even past the gap', async () => {
    const h = harness(); seedRow(h.home, COORD); h.open();
    await runStuckPass(h.deps);
    expect(h.coord.goneSince().has(COORD)).toBe(true);
    h.panes.set(COORD, { verdict: 'unknown', detail: 'tmux down' });
    h.clock.t = NOW + 30 * MIN; await runStuckPass(h.deps);
    expect(h.coord.goneSince().get(COORD)).toEqual({ firstGoneAt: NOW, lastGoneAt: NOW + 30 * MIN });
    h.panes.set(COORD, LIVE);
    h.clock.t = NOW + 31 * MIN; await runStuckPass(h.deps);
    expect(h.coord.goneSince().has(COORD)).toBe(false);
    // Gone again after a live pass: a fresh spell, not the old one.
    h.panes.delete(COORD);
    h.clock.t = NOW + 32 * MIN; await runStuckPass(h.deps);
    expect(h.coord.goneSince().get(COORD)).toEqual({ firstGoneAt: NOW + 32 * MIN, lastGoneAt: NOW + 32 * MIN });
  });
  it('a person with no open run loses the row', async () => {
    const h = harness(); seedRow(h.home, COORD); const id = h.open();
    await runStuckPass(h.deps);
    expect(h.coord.goneSince().has(COORD)).toBe(true);
    h.coord.db.prepare("UPDATE runs SET state = 'failed', closedAt = ? WHERE id = ?").run(NOW, id);
    await runStuckPass(h.deps);
    expect(h.coord.goneSince().has(COORD)).toBe(false);
  });
  it('a stopped coordinator reads its stop stamp, in seconds times 1000', async () => {
    const h = harness(); const at = Math.floor(NOW / 1000) - 5 * 3600;
    seedRow(h.home, COORD, { stopped: `${at} ccd` }); const id = h.open();
    await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(id)!.stuck).toMatchObject({ reason: 'owner-gone', cause: 'coordinator-stopped', since: at * 1000 });
  });
  it('the lane\'s dead_claimants row wins over gone_since', async () => {
    const h = harness(); seedRow(h.home, COORD); const id = h.open();
    h.coord.setDeadAnchor(COORD, { firstDeadAt: NOW - 3 * H, lastDeadAt: NOW });
    await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(id)!.stuck).toMatchObject({ cause: 'coordinator-gone', since: NOW - 3 * H });
    expect(h.coord.goneSince().has(COORD)).toBe(false);
  });
  it('an unreadable journal still gives coordinator-gone, from gone_since', async () => {
    const h = harness(); seedRow(h.home, COORD); const id = h.open();
    const deps = { ...h.deps, journalTrust: async () => ({ hold: null, trust: { untrusted: 'mirror stale', gapGens: [], lastWriteErrorAt: null } }) };
    for (let m = 0; m <= 60; m += 5) { h.clock.t = NOW + m * MIN; await runStuckPass(deps); }
    expect(h.deps.verdicts.of(id)!.stuck).toMatchObject({ reason: 'owner-gone', cause: 'coordinator-gone', since: NOW });
  });
  it('a worker gone at T reads owner-gone at T plus 24 h', async () => {
    const h = harness(); seedRow(h.home, WORKER); seedRow(h.home, COORD);
    h.panes.set(COORD, LIVE);
    const id = h.open(); h.coord.markDispatched(id, WORKER, WORKER, `ws/${WORKER}`, false); h.coord.advance(id, 'dispatched', 'coordinator');
    await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(id)).toMatchObject({ stuck: null, waitsOn: 'nobody', coordinatorGone: false });
    for (let m = 5; m <= 24 * 60; m += 5) { h.clock.t = NOW + m * MIN; await runStuckPass(h.deps); }
    expect(h.deps.verdicts.of(id)!.stuck).toMatchObject({ reason: 'owner-gone', cause: 'worker-gone', since: NOW });
  });
  it('a planned run behind a stuck earlier wave names it', async () => {
    const h = harness(); seedRow(h.home, COORD); h.panes.set(COORD, LIVE);
    const first = h.open({ wave: 1 }); const second = h.open({ wave: 2 });
    setCol(h, first, 'dispatchStartedAt', NOW - 3 * H);
    await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(first)!.stuck?.reason).toBe('start-never-landed');
    expect(h.deps.verdicts.of(second)).toMatchObject({ blockedBy: first, stuck: null });
  });
  it('a closed run takes coordinatorGone from its programme\'s entry and nothing else', async () => {
    const h = harness(); seedRow(h.home, COORD);
    const id = h.open();
    h.coord.db.prepare("UPDATE runs SET state = 'done', closedAt = ? WHERE id = ?").run(NOW - 1000, id);
    await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(id)).toBeNull();
    expect(h.deps.verdicts.ofProgramme('programme-a')).toBe(true);
    const out = withVerdicts(h.deps.verdicts, [{ id, program: 'programme-a', state: 'done' }]);
    expect(out[0]).toEqual({ id, program: 'programme-a', state: 'done', coordinatorGone: true });
    // Past 7 days it has none.
    h.clock.t = NOW + 7 * D + 1000; await runStuckPass(h.deps);
    expect(h.deps.verdicts.ofProgramme('programme-a')).toBeNull();
  });
  it('alive, hibernated and uncertain are coordinatorGone false', async () => {
    const h = harness(); seedRow(h.home, COORD); const id = h.open();
    h.panes.set(COORD, LIVE); await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(id)!.coordinatorGone).toBe(false);
    h.panes.set(COORD, { verdict: 'unknown', detail: 'x' }); await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(id)!.coordinatorGone).toBe(false);
    h.panes.delete(COORD);
    seedRow(h.home, COORD, { stopped: `${Math.floor(NOW / 1000)} ccd`, hibernated: `${Math.floor(NOW / 1000)} 7` });
    await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(id)!.coordinatorGone).toBe(false);
  });
  it('a claimant with no fleet row that reads dead is coordinatorGone true; with no history it is not', async () => {
    const h = harness(); seedRow(h.home, 'someone-else'); const id = h.open();
    await runStuckPass(h.deps);
    // Absent from the registry, and the mirror holds no history: the ruled unmeasured rule gives no verdict.
    expect(h.deps.verdicts.of(id)).toMatchObject({ stuck: null, coordinatorGone: false });
  });
  it('each claimant is measured once a pass', async () => {
    const h = harness(); seedRow(h.home, COORD);
    h.open({ wave: 1 }); h.open({ wave: 2 }); h.open({ wave: 3 });
    let asked = 0;
    await runStuckPass({ ...h.deps, tmux: { sessionVerdict: async () => { asked += 1; return GONE; } } });
    expect(asked).toBe(1);
  });
  it('a run gone from a pass loses its entry, and replace leaves the closes map alone', async () => {
    const h = harness(); seedRow(h.home, COORD); h.panes.set(COORD, LIVE);
    const id = h.open();
    setCol(h, id, 'dispatchStartedAt', NOW - 3 * H);
    await runStuckPass(h.deps);
    h.deps.verdicts.setCloses(new Map([[id, { at: NOW + H, armed: false }]]));
    await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(id)!.stuck).toMatchObject({ closes: { at: NOW + H, armed: false } });
    h.coord.db.prepare("UPDATE runs SET state = 'failed', closedAt = ? WHERE id = ?").run(NOW, id);
    await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(id)).toBeNull();
  });
  it('a failed read leaves the reader as it was', async () => {
    const h = harness(); seedRow(h.home, COORD); h.panes.set(COORD, LIVE);
    const id = h.open(); await runStuckPass(h.deps);
    expect(h.deps.verdicts.of(id)).not.toBeNull();
    const broken = { ...h.deps, coord: Object.assign(Object.create(h.coord) as CoordStore, { runs: () => { throw new Error('locked'); } }) };
    await runStuckPass(broken);
    expect(h.deps.verdicts.of(id)).not.toBeNull();
  });
});

describe('the reader', () => {
  it('an empty reader stamps nothing', () => {
    const rs = [{ id: 1, program: 'programme-a', state: 'working' }, { id: 2, program: 'programme-a', state: 'done' }];
    expect(withVerdicts(createRunVerdicts(), rs)).toEqual(rs);
  });
  it('an open run takes all four fields, with waitsOn left off when the table gives none', () => {
    const v = createRunVerdicts();
    v.replace(new Map([[1, { stuck: null, waitsOn: 'worker', blockedBy: null, coordinatorGone: false }],
      [2, { stuck: null, blockedBy: 5, coordinatorGone: true }]]), new Map());
    const [a, b] = withVerdicts(v, [{ id: 1 }, { id: 2 }]);
    expect(a).toEqual({ id: 1, stuck: null, waitsOn: 'worker', blockedBy: null, coordinatorGone: false });
    expect(b).toEqual({ id: 2, stuck: null, blockedBy: 5, coordinatorGone: true });
  });
  it('closes joins as it reads, and a run missing from the map reads null', () => {
    const v = createRunVerdicts();
    const stuck = { reason: 'owner-gone' as const, cause: 'coordinator-gone' as const, since: 1, closes: null };
    v.replace(new Map([[1, { stuck, blockedBy: null, coordinatorGone: true }], [2, { stuck, blockedBy: null, coordinatorGone: true }]]), new Map());
    v.setCloses(new Map([[1, { at: 9, armed: true }]]));
    expect(v.of(1)!.stuck!.closes).toEqual({ at: 9, armed: true });
    expect(v.of(2)!.stuck!.closes).toBeNull();
    expect(v.all().get(1)!.stuck!.closes).toEqual({ at: 9, armed: true });
  });
  it('abandonDetail gives abandon:<reason>, or null with no verdict', () => {
    const stuck = { reason: 'overtaken' as const, cause: null, since: 1, closes: null };
    expect(abandonDetail({ stuck, blockedBy: null, coordinatorGone: false })).toBe('abandon:overtaken');
    expect(abandonDetail({ stuck: null, blockedBy: null, coordinatorGone: false })).toBeNull();
    expect(abandonDetail(null)).toBeNull();
  });
});

describe('migration 45 — gone_since', () => {
  const ENTRY = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE gone_since'));
  it('is one CREATE TABLE and nothing else, so an older build still opens the file (migration 18\'s argument)', () => {
    expect(ENTRY).toBeGreaterThan(0);
    const ddl = MIGRATIONS[ENTRY]!.replace(/--[^\n]*/g, '');
    const statements = ddl.split(';').map((x) => x.trim()).filter((x) => x !== '');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^CREATE TABLE gone_since \(personId TEXT NOT NULL PRIMARY KEY, firstGoneAt INTEGER NOT NULL, lastGoneAt INTEGER NOT NULL\)$/);
  });
  it('steps a file one version below it forward to the newest entry and takes a fresh file there', () => {
    const p = path.join(mkTmp('ccrc-stuck-mig-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    for (let v = 0; v < ENTRY; v++) raw.exec(MIGRATIONS[v]!);
    raw.exec(`PRAGMA user_version = ${ENTRY}`);
    raw.close();
    const stepped = openCoordDb(p);
    expect((stepped.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(MIGRATIONS.length);
    expect(stepped.prepare("SELECT name FROM sqlite_master WHERE name = 'gone_since'").get()).toBeDefined();
    stepped.close();
  });
  it('the pair is an upsert and a delete', () => {
    const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-stuck-mig-'), '.ccrc', 'coord.db')));
    coord.setGoneSince('a', { firstGoneAt: 1, lastGoneAt: 2 });
    coord.setGoneSince('a', { firstGoneAt: 1, lastGoneAt: 9 });
    expect([...coord.goneSince()]).toEqual([['a', { firstGoneAt: 1, lastGoneAt: 9 }]]);
    coord.deleteGoneSince('a'); coord.deleteGoneSince('a');
    expect(coord.goneSince().size).toBe(0);
  });
});
