// D-7278 (the deps-shed arm of the run-done row; design note 2026-10-28 §4): what the PASS does with the rule's answers —
// shadow composes the box's dry run and writes one "would" row a sleep, armed composes the act, the kill switches, a
// missing capability, a missing serialiser and a switch dropped at the act are inert, the act re-reads the verdict, the
// per-pass bound takes the oldest clock first, and a refusal is not asked again for the retry interval. The rule itself
// is pinned in `deps-shed-verdict.test.ts`.
import { describe, expect, it, vi } from 'vitest';
import {
  depsShedMemory, depsShedPass, parseDepsShedAnswer, parseDepsShedStamp, type DepsShedMemory, type DepsShedPassDeps,
} from '../src/depsShedPass.js';
import { DEPS_SHED_RETRY_MAX_MS, DEPS_SHED_RETRY_MS } from '../src/depsShed.js';
import { ACTOR_FLAGS_CAP, SHED_DEPS_CAP } from '../src/ccdargv.js';
import { STOP_DONE_DISABLED_MARKER } from '../src/stopDone.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { HIBERNATE_DISABLED_MARKER } from '../src/coord/hibernate.js';
import { DEPS_SHED_LIVE_MARKER } from '../../shared/switches.js';
import { VIEWER_OPEN_TTL_MS, type FleetSession } from '../../shared/api.js';
import type { SessionRecord } from '../src/registry.js';
import type { FleetState } from '../src/fleetstate.js';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const STARTED = NOW - VIEWER_OPEN_TTL_MS - 60_000;
const W = 'project-a-quiet-basin';
const C = 'lane-a-project-a';

const row = (id: string, o: Partial<FleetSession> = {}): FleetSession => ({
  id, workspace: id, archivedAt: null, stoppedBy: { at: NOW - 30 * HOUR, surface: 'agent' },
  child: { kind: 'child', runId: 7 }, unmeasured: [], statusUnmeasured: false, held: null, ...o,
}) as unknown as FleetSession;
const rec = (id: string): SessionRecord => ({ id, uuid: `uuid-${id}`, unmeasured: [] }) as unknown as SessionRecord;

interface Fake {
  deps: DepsShedPassDeps;
  argv: string[][];
  feed: { title: string; sessionId: string; body: string }[];
  serialCalls: number;
  /** The session queue's calls: the armed act only (a shadow never queues behind, or ahead of, that session's routes). */
  queueCalls: number;
  /** Per worker: its newest placed run. */
  runs: Map<string, { runId: number; state: string; closedAt: number | null }>;
  /** Per session: its coordinator claim, as `childReclaimCoordinatorClaims` folds it. */
  chairs: Map<string, number | 'open' | 'unplaced'>;
  /** What the box answers, per session (default: the act or the dry run it was asked for). */
  answer: Map<string, string>;
  /** What `rowAtAct` reads, per session. */
  atAct: Map<string, Partial<FleetSession> | 'unreadable'>;
  /** The act's fresh listing (default: the pass's names). */
  actListing: string[] | null | undefined;
  stamps: Map<string, string | null>;
  setNames: (n: readonly string[]) => void;
}

function fake(o: { caps?: string[]; serial?: boolean; perPass?: number } = {}): Fake {
  const f: Fake = {
    argv: [], feed: [], serialCalls: 0, queueCalls: 0, runs: new Map(), chairs: new Map(), answer: new Map(), atAct: new Map(),
    actListing: undefined, stamps: new Map(), setNames: () => {}, deps: undefined as unknown as DepsShedPassDeps,
  };
  let passNames: readonly string[] = [];
  f.deps = {
    coord: {
      lastRunBySession: (asked: readonly string[]) => ({
        ok: true as const,
        last: [],
        lastPlaced: asked.flatMap((sessionId) => {
          const r = f.runs.get(sessionId);
          return r === undefined ? [] : [{ sessionId, ...r, program: 'p', programTitle: null, claimedBy: C }];
        }),
        openWorkers: [], openPlacedWorkers: [], parkedPlacedWorkers: [], openClaimants: [],
      }),
      activeClaims: () => [],
      childReclaimCoordinatorClaims: () => f.chairs as never,
      lifecycleBirthEventsFor: () => [],
      run: () => ({ ok: true as const, run: { id: 1, state: 'working', reviews: null } as never }),
      recordFeedEvent: () => undefined,
    } as unknown as DepsShedPassDeps['coord'],
    runCcd: async (a) => {
      f.argv.push([...a]);
      const id = a[2]!;
      const dry = a.includes('--dry-run');
      const cls = a[4]!;
      const body = f.answer.get(id)
        ?? JSON.stringify(dry ? { wouldShed: true, session: id, class: cls, dirs: 2, bytes: 2 * 1024 * 1024 }
          : { shed: true, session: id, class: cls, dirs: 2, bytes: 2 * 1024 * 1024 });
      return { ran: true, ok: true, stdout: `${body}\n`, stderr: '', killed: false, signal: null };
    },
    fleetState: { ccdVerbs: o.caps ?? [SHED_DEPS_CAP, ACTOR_FLAGS_CAP] } as unknown as FleetState,
    viewers: { isOpen: () => false },
    notifyLog: {
      epoch: 'e',
      record: (e: { title: string; sessionId: string; body: string }) => { f.feed.push({ title: e.title, sessionId: e.sessionId, body: e.body }); return { ...e, seq: f.feed.length, at: NOW }; },
      flush: async () => undefined,
    } as unknown as DepsShedPassDeps['notifyLog'],
    readStamp: async (id) => (f.stamps.has(id) ? f.stamps.get(id)! : null),
    rowAtAct: async (r) => {
      const a = f.atAct.get(r.id);
      return a === 'unreadable' ? { ok: false } : { ok: true, row: row(r.id, { ...(r.id === C ? { child: { kind: 'none' } } : {}), ...(a ?? {}) } as Partial<FleetSession>) };
    },
    serial: o.serial === false ? null : async (fn) => { f.serialCalls++; return fn(); },
    queueRun: async (_id, fn) => { f.queueCalls++; return fn(); },
    listing: async () => (f.actListing === undefined ? [...passNames] : f.actListing),
    config: { afterMs: 24 * HOUR, parkedAfterMs: null, perPass: o.perPass ?? 1 },
    startedAt: STARTED,
    now: () => NOW,
  };
  // The act's listing defaults to the pass's: `run` tells the fake what the pass was given.
  f.setNames = (n) => { passNames = n; };
  return f;
}

const mem = (): DepsShedMemory => depsShedMemory();
const run = async (f: Fake, m: DepsShedMemory, rows: FleetSession[], names: string[] = []) => {
  f.setNames(names);
  return depsShedPass(f.deps, m, rows, rows.map((r) => rec(r.id)), names);
};
const worker = (f: Fake, id = W, closedAt = NOW - 25 * HOUR): FleetSession => {
  f.runs.set(id, { runId: 7, state: 'done', closedAt });
  return row(id);
};
const coordinator = (f: Fake, endedAt = NOW - 26 * HOUR): FleetSession => {
  f.chairs.set(C, endedAt);
  return row(C, { child: { kind: 'none' } } as Partial<FleetSession>);
};
const DEC = ['--surface', 'agent', '--actor', 'sweep:deps-shed'];
const DRY = (id: string, cls = 'child') => ['ws-shed-deps', '--session', id, '--class', cls, '--dry-run', ...DEC];
const ACT = (id: string, cls = 'child') => ['ws-shed-deps', '--session', id, '--class', cls, ...DEC];

describe('depsShedPass (D-7278)', () => {
  describe('shadow (no deps-shed-live)', () => {
    it('composes the dry run, writes one "would" row, and answers would-shed', async () => {
      const f = fake();
      const out = await run(f, mem(), [worker(f)]);
      expect(f.argv).toEqual([DRY(W)]);
      expect(out).toEqual([{ id: W, kind: 'would-shed', dirs: 2, bytes: 2 * 1024 * 1024 }]);
      expect(f.feed.map((e) => [e.title, e.sessionId])).toEqual([['Dependencies would be removed', W]]);
      expect(f.feed[0]!.body).toContain('2 directories, 2 MiB');
      // The dry run removes nothing and takes no lock: the box's re-proof is enough, and coordination writes
      // never queue behind its du, git status and process walk.
      expect(f.serialCalls).toBe(0);
      // Nor the session's own queue: its swap, reap, forget, title and pr routes never wait on a shadow.
      expect(f.queueCalls).toBe(0);
    });
    it('asks once a sleep: the next pass skips the row, and a new sleep asks again', async () => {
      const f = fake();
      const m = mem();
      const w = worker(f);
      await run(f, m, [w]);
      await run(f, m, [w]);
      expect(f.argv).toEqual([DRY(W)]);
      await run(f, m, [{ ...w, stoppedBy: { at: NOW - 25 * HOUR, surface: 'agent' } } as FleetSession]);
      expect(f.argv).toEqual([DRY(W), DRY(W)]);
      expect(f.feed.length).toBe(2);
    });
    it('a sleeping coordinator is asked as a coordinator', async () => {
      const f = fake();
      await run(f, mem(), [coordinator(f)]);
      expect(f.argv).toEqual([DRY(C, 'coordinator')]);
    });
  });

  describe('armed', () => {
    it('composes the act and writes the "removed" row', async () => {
      const f = fake();
      const out = await run(f, mem(), [worker(f)], [DEPS_SHED_LIVE_MARKER]);
      expect(f.argv).toEqual([ACT(W)]);
      expect(out).toEqual([{ id: W, kind: 'shed', dirs: 2, bytes: 2 * 1024 * 1024 }]);
      expect(f.feed.map((e) => e.title)).toEqual(['Dependencies removed']);
      expect(f.serialCalls).toBe(1);
      expect(f.queueCalls).toBe(1);
    });
    it('an arming switch gone at the act holds `switched-off`, and nothing is composed', async () => {
      const f = fake();
      f.actListing = [];
      expect(await run(f, mem(), [worker(f)], [DEPS_SHED_LIVE_MARKER])).toEqual([{ id: W, kind: 'switched-off', detail: DEPS_SHED_LIVE_MARKER }]);
      expect(f.argv).toEqual([]);
    });
    it('an arming switch raised only at the act leaves the act a dry run (the safe direction)', async () => {
      const f = fake();
      f.actListing = [DEPS_SHED_LIVE_MARKER];
      await run(f, mem(), [worker(f)]);
      expect(f.argv).toEqual([DRY(W)]);
      expect(f.queueCalls).toBe(0);
    });
  });

  it.each([STOP_DONE_DISABLED_MARKER, RECLAIM_PAUSE_MARKER, HIBERNATE_DISABLED_MARKER])(
    '%s stops the pass: nothing is read, composed or recorded', async (k) => {
      const f = fake();
      const last = vi.fn(f.deps.coord.lastRunBySession);
      f.deps = { ...f.deps, coord: { ...f.deps.coord, lastRunBySession: last } };
      expect(await run(f, mem(), [worker(f)], [k, DEPS_SHED_LIVE_MARKER])).toEqual([]);
      expect(f.argv).toEqual([]);
      expect(f.feed).toEqual([]);
      expect(last).not.toHaveBeenCalled();
      expect(f.serialCalls).toBe(0);
    });
  it.each([STOP_DONE_DISABLED_MARKER, RECLAIM_PAUSE_MARKER, HIBERNATE_DISABLED_MARKER])(
    '%s raised at the act holds `switched-off`', async (k) => {
      const f = fake();
      f.actListing = [k, DEPS_SHED_LIVE_MARKER];
      expect(await run(f, mem(), [worker(f)], [DEPS_SHED_LIVE_MARKER])).toEqual([{ id: W, kind: 'switched-off', detail: k }]);
      expect(f.argv).toEqual([]);
    });
  it('an unlistable registry at the act holds', async () => {
    const f = fake();
    f.actListing = null;
    expect(await run(f, mem(), [worker(f)], [DEPS_SHED_LIVE_MARKER])).toEqual([{ id: W, kind: 'switched-off', detail: 'registry-unlistable' }]);
    expect(f.argv).toEqual([]);
  });
  it('a box whose ccd lacks shed-deps-v1 is never asked', async () => {
    const f = fake({ caps: [ACTOR_FLAGS_CAP] });
    expect(await run(f, mem(), [worker(f)], [DEPS_SHED_LIVE_MARKER])).toEqual([]);
    expect(f.argv).toEqual([]);
  });
  it('nothing happens before the serialiser is handed over', async () => {
    const f = fake({ serial: false });
    expect(await run(f, mem(), [worker(f)], [DEPS_SHED_LIVE_MARKER])).toEqual([]);
    expect(f.argv).toEqual([]);
  });
  it('rows the rule holds are never asked: awake, a chair on an open run, a run closed too recently, an operator\'s own workspace', async () => {
    const f = fake({ perPass: 10 });
    const awake = { ...worker(f, 'project-a-awake'), stoppedBy: null } as FleetSession;
    const recent = worker(f, 'project-a-recent', NOW - HOUR);
    f.chairs.set('project-a-open', 'open');
    const open = worker(f, 'project-a-open');
    const own = row('project-a-own', { child: { kind: 'none' } } as Partial<FleetSession>);
    expect(await run(f, mem(), [awake, recent, open, own], [DEPS_SHED_LIVE_MARKER])).toEqual([]);
    expect(f.argv).toEqual([]);
  });
  it(`at most CCRC_DEPS_SHED_PER_PASS rows a pass, oldest clock first`, async () => {
    const f = fake();
    const rows = [worker(f, 'project-a-b', NOW - 30 * HOUR), worker(f, 'project-a-a', NOW - 40 * HOUR), coordinator(f, NOW - 35 * HOUR)];
    await run(f, mem(), rows, [DEPS_SHED_LIVE_MARKER]);
    expect(f.argv).toEqual([ACT('project-a-a')]);
    const g = fake({ perPass: 2 });
    const rows2 = [worker(g, 'project-a-b', NOW - 30 * HOUR), worker(g, 'project-a-a', NOW - 40 * HOUR), coordinator(g, NOW - 35 * HOUR)];
    await run(g, mem(), rows2, [DEPS_SHED_LIVE_MARKER]);
    expect(g.argv).toEqual([ACT('project-a-a'), ACT(C, 'coordinator')]);
  });
  it('the act re-reads the row and asks the verdict again: a row that woke holds, and so does one that cannot be read', async () => {
    const f = fake();
    f.atAct.set(W, { stoppedBy: null });
    expect(await run(f, mem(), [worker(f)], [DEPS_SHED_LIVE_MARKER])).toEqual([{ id: W, kind: 'held-at-act', verdict: { act: 'hold', reason: 'awake' } }]);
    f.atAct.set(W, 'unreadable');
    expect(await run(f, mem(), [worker(f)], [DEPS_SHED_LIVE_MARKER])).toEqual([{ id: W, kind: 'held-at-act', verdict: null }]);
    expect(f.argv).toEqual([]);
  });
  it('a stamp from this sleep holds; an unreadable one holds; one from an earlier sleep is asked', async () => {
    const f = fake();
    const w = worker(f);
    f.stamps.set(W, `${Math.floor((NOW - 29 * HOUR) / 1000)} 100`);
    expect(await run(f, mem(), [w], [DEPS_SHED_LIVE_MARKER, `${W}.depsshed`])).toEqual([]);
    f.stamps.set(W, null);
    expect(await run(f, mem(), [w], [DEPS_SHED_LIVE_MARKER, `${W}.depsshed`])).toEqual([]);
    expect(f.argv).toEqual([]);
    f.stamps.set(W, `${Math.floor((NOW - 31 * HOUR) / 1000)} 100`);
    await run(f, mem(), [w], [DEPS_SHED_LIVE_MARKER, `${W}.depsshed`]);
    expect(f.argv).toEqual([ACT(W)]);
  });
  it('a refusal is not asked again for the retry interval; after it, it is', async () => {
    const f = fake();
    const m = mem();
    f.answer.set(W, JSON.stringify({ refused: 'in-use', session: W, detail: 'pid 4242' }));
    expect(await run(f, m, [worker(f)], [DEPS_SHED_LIVE_MARKER])).toEqual([{ id: W, kind: 'refused', word: 'in-use', detail: 'pid 4242' }]);
    await run(f, m, [worker(f)], [DEPS_SHED_LIVE_MARKER]);
    expect(f.argv.length).toBe(1);
    expect(f.feed).toEqual([]);
    expect(m.retryAt.get(W)).toBe(NOW + DEPS_SHED_RETRY_MS);
    m.retryAt.set(W, NOW - 1);
    await run(f, m, [worker(f)], [DEPS_SHED_LIVE_MARKER]);
    expect(f.argv.length).toBe(2);
    // A second refusal in the same sleep holds off twice as long, and so on, never past the ceiling.
    expect(m.retryAt.get(W)).toBe(NOW + 2 * DEPS_SHED_RETRY_MS);
    for (let i = 0; i < 10; i++) { m.retryAt.set(W, NOW - 1); await run(f, m, [worker(f)], [DEPS_SHED_LIVE_MARKER]); }
    expect(m.retryAt.get(W)).toBe(NOW + DEPS_SHED_RETRY_MAX_MS);
  });
  it('`nothing-to-shed` is final for that sleep, in shadow and armed; a new sleep asks again', async () => {
    for (const names of [[], [DEPS_SHED_LIVE_MARKER]]) {
      const f = fake();
      const m = mem();
      const w = worker(f);
      f.answer.set(W, JSON.stringify({ refused: 'nothing-to-shed', session: W, detail: 'none' }));
      await run(f, m, [w], names);
      m.retryAt.clear();
      await run(f, m, [w], names);
      expect(f.argv.length, names.join()).toBe(1);
      await run(f, m, [{ ...w, stoppedBy: { at: NOW - 25 * HOUR, surface: 'agent' } } as FleetSession], names);
      expect(f.argv.length, names.join()).toBe(2);
    }
  });
  it('rows the box already refused this sleep come after a fresh one: K refusing rows never starve it', async () => {
    const f = fake();
    const m = mem();
    const old = ['project-a-r1', 'project-a-r2', 'project-a-r3'].map((id, i) => worker(f, id, NOW - (60 + i) * HOUR));
    for (const r of old) f.answer.set(r.id, JSON.stringify({ refused: 'in-use', session: r.id, detail: 'pid 1' }));
    for (let i = 0; i < old.length; i++) await run(f, m, old, [DEPS_SHED_LIVE_MARKER]);
    expect(f.argv.length).toBe(3);
    m.retryAt.clear();
    const fresh = worker(f, 'project-a-fresh', NOW - 25 * HOUR);
    await run(f, m, [...old, fresh], [DEPS_SHED_LIVE_MARKER]);
    expect(f.argv.at(-1)).toEqual(ACT('project-a-fresh'));
    // With no fresh row left, the refused ones are still asked, oldest clock first.
    m.retryAt.clear();
    await run(f, m, old, [DEPS_SHED_LIVE_MARKER]);
    expect(f.argv.at(-1)).toEqual(ACT('project-a-r3'));
  });
  it('a failure and an answer nobody can read hold off the same way, and write no feed row', async () => {
    const f = fake({ perPass: 3 });
    const m = mem();
    f.answer.set('project-a-x', JSON.stringify({ failed: 'git-state-changed', session: 'project-a-x', detail: 'moved' }));
    f.answer.set('project-a-y', 'not json');
    f.answer.set('project-a-z', JSON.stringify({ shed: true, session: 'project-a-other', dirs: 1, bytes: 1 }));
    const out = await run(f, m, [worker(f, 'project-a-x'), worker(f, 'project-a-y'), worker(f, 'project-a-z')], [DEPS_SHED_LIVE_MARKER]);
    expect(out.map((o) => o.kind)).toEqual(['failed', 'unreadable', 'unreadable']);
    expect([...m.retryAt.keys()].sort()).toEqual(['project-a-x', 'project-a-y', 'project-a-z']);
    expect(f.feed).toEqual([]);
  });
});

describe('the box\'s two answers, read', () => {
  it('parseDepsShedStamp: an epoch with or without its bytes; anything else is unreadable', () => {
    expect(parseDepsShedStamp('1800000000 1234\n')).toEqual({ kind: 'at', atMs: 1_800_000_000_000 });
    expect(parseDepsShedStamp('1800000000')).toEqual({ kind: 'at', atMs: 1_800_000_000_000 });
    for (const bad of [null, '', 'x 1', '0 1', '-5', '1e9']) expect(parseDepsShedStamp(bad), String(bad)).toEqual({ kind: 'unreadable' });
  });
  it('parseDepsShedAnswer: each shape, and a document for another session is unreadable', () => {
    expect(parseDepsShedAnswer('{"shed":true,"session":"s","class":"child","dirs":2,"bytes":5}', 's')).toEqual({ kind: 'shed', dirs: 2, bytes: 5 });
    expect(parseDepsShedAnswer('{"wouldShed":true,"session":"s","dirs":0,"bytes":null}', 's')).toEqual({ kind: 'would-shed', dirs: 0, bytes: null });
    expect(parseDepsShedAnswer('{"refused":"paused","session":"s","detail":"d"}', 's')).toEqual({ kind: 'refused', word: 'paused', detail: 'd' });
    expect(parseDepsShedAnswer('{"failed":"shed-incomplete","session":"s","detail":"d"}', 's')).toEqual({ kind: 'failed', word: 'shed-incomplete', detail: 'd' });
    expect(parseDepsShedAnswer('{"shed":true,"session":"t","dirs":1,"bytes":1}', 's').kind).toBe('unreadable');
    expect(parseDepsShedAnswer('{"shed":true,"session":"s"}', 's').kind).toBe('unreadable');
    expect(parseDepsShedAnswer('', 's').kind).toBe('unreadable');
  });
});
