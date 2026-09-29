// The close path's skip (child-reclamation spec §5.8: "The sweep skips; the
// close path skips; the PWA renders. And `ws-reclaim` itself reads it"). The
// executor both triggers share reads `$REG/reclaim-paused` before it composes
// ANY argv, and answers `deferred` / `paused-at-server` — the member wave 3
// declared in `ChildReclaimDeferWhy` and produces nowhere.
//
// Not the authority: ccd's rung 3 re-reads the file inside its lock. This is
// the server declining to ask for what it already knows will be refused, and
// the one server-side read that covers a reclaim QUEUED behind a session's
// KeyedQueue before the switch went up. Where it sits is pinned three ways:
// after the sibling re-read, before presence, and inside the function whose
// every answer gets the executor's one feed row (spec §5.9: "One feed row per
// outcome").
//
// This file also covers the coordinating re-read that sits BETWEEN the
// sibling re-read and the pause read (spec §1, rules 3-4, "Manual cleanup
// should be reserved ONLY FOR COORDINATOR WORKSPACE CLEANUP") — a session
// that has EVER coordinated a run, in any state, is never reclaimed
// automatically, and it is checked before the pause so the more specific
// answer (`siblings-open`) wins over `paused-at-server` when both are true.
// "Ever" covers both a reclaim's HEIR and the coordinator that SAME reclaim
// displaced (`CoordStore.childReclaimCoordinatorIds`'s own docstring states
// the full scope and its one residual).
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { childReclaimPauseRead, reclaimChild, type ChildReclaimDeps } from '../src/coord/childReclaim.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { NotifyLog } from '../src/notifylog.js';
import { ACTOR_FLAGS_CAP, CCD_ARGV, RECLAIM_CAP } from '../src/ccdargv.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

describe('childReclaimPauseRead — three answers off one listing', () => {
  const io = (names: string[] | null) => ({ readdir: async () => names });
  it('set when the listing names the marker, clear when it lists without it', async () => {
    expect(await childReclaimPauseRead(io(['demo-a.uuid', 'reclaim-paused']), '/reg')).toBe('set');
    expect(await childReclaimPauseRead(io(['demo-a.uuid', 'coordinator-paused']), '/reg')).toBe('clear');
  });
  it('unmeasurable when the registry does not list — a pause that cannot be ruled out', async () => {
    expect(await childReclaimPauseRead(io(null), '/reg')).toBe('unmeasurable');
  });
});

/** A marked child of a FINISHED run with nothing open on it — the executor's
 *  own re-reads all pass, so the pause read is the only thing that can stop it
 *  before the audit. `visible` makes the presence claim answer yes. */
const fixture = async (over: { visible?: boolean } = {}) => {
  const home = mkTmp('ccrc-child-reclaim-paused-');
  const calls: string[][] = [];
  const base = testDeps(home, async (_cmd, args) => { calls.push(args); return { code: 1, stdout: '', stderr: '' }; });
  const reg = base.cfg.registryDir;
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'w4-paused', title: 'w4-paused', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  const closed = coord.closeRun({ runId: opened.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: 'w4-paused', viaClosing: false });
  if (!closed.ok) throw new Error(`abandon refused: ${JSON.stringify(closed)}`);
  const fields: Record<string, string> = {
    uuid: 'u-demo-a', wrapper: 'claude', project: 'demo', workdir: '/w/demo-a', workspace: 'a',
    branch: 'ws/demo-a', base: 'origin/main', started: '1', child: String(opened.id),
  };
  for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `demo-a.${f}`), v);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  // The member set Task 1 Step 3 fact 2 recorded — the one the close route
  // composes. The verbs are the ones wave 3's executor checks before it
  // reaches the audit, as its own test's `CAPS` spells them: `ws-audit`
  // (`verbSupported`, which REFUSES a verb a present list does not name),
  // `reclaim-v1` (`capSupported`), and `ws-reclaim` + `actor-flags-v1` (the
  // act and its dec). Without `ws-audit` the CONTROL below never sees an argv.
  const deps: ChildReclaimDeps = {
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-audit', 'ws-reclaim', RECLAIM_CAP, ACTOR_FLAGS_CAP] },
    presence: { isVisible: (id: string) => over.visible === true && id === 'demo-a' },
    notifyLog,
  };
  const ccdCalls = (): string[][] => calls.filter((c) => c[0] === 'ws-audit' || c[0] === 'ws-reclaim');
  const feed = (): string[] => coord.feedEvents(50).filter((e) => e.sessionId === 'demo-a').map((e) => e.title);
  const bodies = (): string[] => coord.feedEvents(50).filter((e) => e.sessionId === 'demo-a').map((e) => e.body);
  const raise = (): void => writeFileSync(path.join(reg, 'reclaim-paused'), '');
  return { reg, coord, deps, runId: opened.id, ccdCalls, feed, bodies, raise };
};

describe('reclaimChild — the pause, read before any argv', () => {
  it('defers paused-at-server on the CLOSE trigger, and asks ccd nothing', async () => {
    const f = await fixture();
    f.raise();
    // `deferredSinceMs: null` — close never deferred before (spec §5.7: close
    // is a first attempt; the sweep carries the wait).
    const out = await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    expect(out).toMatchObject({ kind: 'deferred', sessionId: 'demo-a', runId: f.runId, why: 'paused-at-server' });
    expect(f.ccdCalls()).toEqual([]);
  });

  it('the defer ceiling never overrides the switch: deferExpired defers too', async () => {
    // `--defer-expired` skips PRESENCE (rungs 5 and 6 and the visibility
    // claim) and nothing else — the pause is not presence (spec §5.7).
    const f = await fixture();
    f.raise();
    // The sweep's ceiling-expired shape exactly: `deferExpired` AND the first
    // deferral it saw, a full ceiling ago.
    const out = await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'sweep', deferExpired: true,
      deferredSinceMs: Date.now() - 15 * 60_000,
    });
    expect(out).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
    expect(f.ccdCalls()).toEqual([]);
  });

  it('is read BEFORE presence: a watched child under a raised switch says paused-at-server, not presence', async () => {
    // The reason that outlasts the watcher, and the one no ceiling reaches past.
    const f = await fixture({ visible: true });
    f.raise();
    const out = await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    expect(out).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
  });

  it('is read AFTER the sibling re-read: a child an open run still names says siblings-open, paused or not', async () => {
    const f = await fixture();
    f.raise();
    const next = f.coord.openRun({ program: 'w4-paused-2', title: 'w4-paused-2', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in next)) throw new Error(`openRun refused: ${JSON.stringify(next)}`);
    f.coord.setSession(next.id, 'demo-a');
    const out = await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    // The detail pins WHICH branch answered: the sibling re-read's own
    // wording, never 2a's `"<id> has coordinated run(s)"` — the two branches
    // both answer `siblings-open`, so only the detail proves this case
    // exercised the sibling re-read and not the coordinating one.
    expect(out).toMatchObject({ kind: 'deferred', why: 'siblings-open',
      detail: `open run(s) #${next.id} still name this workspace` });
  });

  it('the sibling re-read wins when BOTH apply — pins 2a strictly AFTER it, not just the "why"', async () => {
    // `demo-a` in this case satisfies BOTH the sibling re-read's own question
    // (an open run still names it) AND 2a's (it has coordinated a — separate,
    // terminal — programme). Both branches answer the same `why`, so only the
    // detail can prove which one actually fired first; the earlier case above
    // cannot, because its `demo-a` never satisfies 2a's own predicate, so a
    // mutant that swapped 2 and 2a would still pass it.
    const f = await fixture();
    const coordinated = f.coord.openRun({ program: 'w4-both-a', title: 'w4-both-a', project: 'demo',
      wave: 1, waveOf: null, claimedBy: 'demo-a' });
    if (!('id' in coordinated)) throw new Error(`openRun refused: ${JSON.stringify(coordinated)}`);
    expect(f.coord.closeRun({ runId: coordinated.id, finalState: 'failed', causedBy: 'test',
      handoffCommit: null, program: 'w4-both-a', viaClosing: false }).ok).toBe(true);
    const next = f.coord.openRun({ program: 'w4-both-b', title: 'w4-both-b', project: 'demo',
      wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in next)) throw new Error(`openRun refused: ${JSON.stringify(next)}`);
    f.coord.setSession(next.id, 'demo-a');
    const out = await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    expect(out).toMatchObject({ kind: 'deferred', why: 'siblings-open',
      detail: `open run(s) #${next.id} still name this workspace` });
  });

  it('gets the executor\'s ONE feed row, like every other deferral — never a second writer, never none', async () => {
    const f = await fixture();
    f.raise();
    await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    expect(f.feed()).toEqual(['child reclaim deferred']);
    expect(f.bodies()[0]).toContain('paused-at-server');
  });

  it('CONTROL — with the switch down the same child reaches wave 3\'s audit argv', async () => {
    // Without this, the cases above would pass for ANY reason the executor
    // stopped early (a fixture the marker re-read rejects, say, or a verb list
    // the audit's own gate refuses).
    const f = await fixture();
    await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    expect(f.ccdCalls()).toContainEqual([...CCD_ARGV.wsReclaimAudit('demo-a', false)]);
  });
});

describe('reclaimChild — the coordinating re-read, before the pause', () => {
  it('is read BEFORE the pause, and covers a TERMINAL run too: a session that has ever coordinated defers siblings-open, paused or not', async () => {
    const f = await fixture();
    // `demo-a` coordinated this run once, and it is now terminal — unlike
    // `openCoordinatorIds` (LIVE coordination only), the ANY-state read must
    // still catch it: the operator's rule 4 reserves manual cleanup for a
    // coordinator's own workspace forever, not only while it is coordinating.
    const coordinated = f.coord.openRun({ program: 'w4-paused-coord', title: 'w4-paused-coord', project: 'demo',
      wave: 1, waveOf: null, claimedBy: 'demo-a' });
    if (!('id' in coordinated)) throw new Error(`openRun refused: ${JSON.stringify(coordinated)}`);
    // `planned` only carries a `failed` edge with no dispatch (RUN_TRANSITIONS,
    // `shared/api.ts`) — `failed` is still TERMINAL, and that (not the word
    // `done`) is the whole distinction `childReclaimCoordinatorIds` must not care
    // about: an ANY-state read, unlike `openCoordinatorIds`, keeps a session
    // that coordinated a now-terminal run.
    expect(f.coord.closeRun({ runId: coordinated.id, finalState: 'failed', causedBy: 'test',
      handoffCommit: null, program: 'w4-paused-coord', viaClosing: false }).ok).toBe(true);
    f.raise(); // the switch is ALSO up — the more specific answer must still win
    const out = await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    expect(out).toMatchObject({ kind: 'deferred', why: 'siblings-open', detail: 'demo-a has coordinated run(s)' });
    expect(f.ccdCalls()).toEqual([]);
  });

  it('a throw reading the coordination table defers siblings-unreadable, never paused-at-server', async () => {
    const f = await fixture();
    const original = f.coord.childReclaimCoordinatorIds.bind(f.coord);
    f.coord.childReclaimCoordinatorIds = () => { throw new Error('coord.db unreadable'); };
    try {
      f.raise();
      const out = await reclaimChild(f.deps, {
        sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
      });
      expect(out).toMatchObject({ kind: 'deferred', why: 'siblings-unreadable' });
    } finally {
      f.coord.childReclaimCoordinatorIds = original;
    }
  });
});

// `reclaimProgram` OVERWRITES `claimedBy` on every run of a programme,
// terminal runs included, so a bare `SELECT DISTINCT claimedBy` alone loses
// the coordinator it just displaced the instant an heir takes the chair.
// `childReclaimCoordinatorIds` unions in the `from` side of every
// `reclaim:<from> -> <to>` row `reclaimProgram` writes (spec §1, rules 3-4).
describe('CoordStore.childReclaimCoordinatorIds — the displaced side', () => {
  const bareStore = (): CoordStore => {
    const home = mkTmp('ccrc-child-reclaim-coordinator-ids-');
    return new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  };

  it('unions in the coordinator a reclaim displaced, not just its heir', () => {
    const coord = bareStore();
    const opened = coord.openRun({ program: 'w4-displaced', title: 'w4-displaced', project: 'demo',
      wave: 1, waveOf: null, claimedBy: 'demo-a' });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    expect(coord.closeRun({ runId: opened.id, finalState: 'failed', causedBy: 'test',
      handoffCommit: null, program: 'w4-displaced', viaClosing: false }).ok).toBe(true);
    expect(coord.childReclaimCoordinatorIds().has('demo-a')).toBe(true);
    // `reclaimProgram` rewrites `claimedBy` on every run of the programme —
    // the just-closed row included — so a bare `SELECT DISTINCT claimedBy`
    // alone would drop `demo-a` the instant this runs.
    expect(coord.reclaimProgram(opened.id, 'heir-x', Date.now(), null)).toMatchObject({ ok: true });
    const ids = coord.childReclaimCoordinatorIds();
    expect(ids.has('demo-a')).toBe(true);   // the displaced coordinator — the fix
    expect(ids.has('heir-x')).toBe(true);   // the heir — unaffected by the fix
  });

  // `POST /api/runs` checks `claimedBy` only for a non-empty string — no trim,
  // no charset guard (`shared/api.ts`'s `isSessionIdShape` exists precisely
  // because the route does not enforce it) — so `from` (`runs.claimedBy`) can
  // reach `reclaimProgram` carrying whitespace or its own literal ` -> `. Each
  // case here round-trips exactly such a `from` through the real writer
  // (`coord.reclaimProgram`, never a hand-typed `run_events` row) and reads it
  // back verbatim. `to` cannot carry the same hazard: the reclaim route trims
  // it, and `reclaimRun` (`reclaim.ts`) then requires `readSessionRecord` to
  // find it as a real, listed registry row before this UPDATE ever runs.
  it('round-trips a from with an inner space', () => {
    const coord = bareStore();
    const from = 'demo x';
    const opened = coord.openRun({ program: 'w4-inner-space', title: 'w4-inner-space', project: 'demo',
      wave: 1, waveOf: null, claimedBy: from });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    expect(coord.reclaimProgram(opened.id, 'heir-space', Date.now(), null)).toMatchObject({ ok: true });
    expect(coord.childReclaimCoordinatorIds().has(from)).toBe(true);
  });

  it('round-trips a from with a trailing space', () => {
    const coord = bareStore();
    const from = 'demo-x ';
    const opened = coord.openRun({ program: 'w4-trailing-space', title: 'w4-trailing-space', project: 'demo',
      wave: 1, waveOf: null, claimedBy: from });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    expect(coord.reclaimProgram(opened.id, 'heir-trail', Date.now(), null)).toMatchObject({ ok: true });
    expect(coord.childReclaimCoordinatorIds().has(from)).toBe(true);
  });

  it('round-trips a from with its own embedded " -> " — the split lands at the LAST occurrence', () => {
    const coord = bareStore();
    const from = 'demo -> x';
    const opened = coord.openRun({ program: 'w4-embedded-arrow', title: 'w4-embedded-arrow', project: 'demo',
      wave: 1, waveOf: null, claimedBy: from });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    expect(coord.reclaimProgram(opened.id, 'heir-arrow', Date.now(), null)).toMatchObject({ ok: true });
    expect(coord.childReclaimCoordinatorIds().has(from)).toBe(true);
  });

  it('a reclaim: row from the exact writer that does not parse THROWS, never drops silently', () => {
    const coord = bareStore();
    const opened = coord.openRun({ program: 'w4-mangled', title: 'w4-mangled', project: 'demo',
      wave: 1, waveOf: null, claimedBy: 'demo-a' });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    // Same actor (`'operator'`), same prefix, but not the writer's own
    // `<from> -> <to>` shape — the one row this build cannot attribute to a
    // `from` id, and so must not silently exclude.
    coord.recordRunEvent(opened.id, 'operator', 'reclaim:mangled-with-no-arrow');
    expect(() => coord.childReclaimCoordinatorIds()).toThrow(/unparseable reclaim-displacement row/);
  });

  it('the executor defers siblings-open for a coordinator the reclaim door displaced, never reaching ccd', async () => {
    const f = await fixture();
    const coordinated = f.coord.openRun({ program: 'w4-displaced-exec', title: 'w4-displaced-exec', project: 'demo',
      wave: 1, waveOf: null, claimedBy: 'demo-a' });
    if (!('id' in coordinated)) throw new Error(`openRun refused: ${JSON.stringify(coordinated)}`);
    expect(f.coord.closeRun({ runId: coordinated.id, finalState: 'failed', causedBy: 'test',
      handoffCommit: null, program: 'w4-displaced-exec', viaClosing: false }).ok).toBe(true);
    expect(f.coord.reclaimProgram(coordinated.id, 'heir-y', Date.now(), null)).toMatchObject({ ok: true });
    const out = await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    expect(out).toMatchObject({ kind: 'deferred', why: 'siblings-open', detail: 'demo-a has coordinated run(s)' });
    expect(f.ccdCalls()).toEqual([]);
  });
});

// Both shipped `FleetIO` adapters fold every `readdir` failure to `null`, so
// there is no live throw path today — but a future one that REJECTS must
// still land on the executor's own `deferred(...)`, with its one feed row,
// rather than an uncaught rejection.
describe('reclaimChild — a rejecting readdir still defers, with a feed row', () => {
  it('paused-at-server, never an uncaught rejection', async () => {
    const f = await fixture();
    // The FIRST `readdir` is step 1's marker re-read (`readSessionRecord`,
    // `registry.ts:1225`) — it must succeed, or the case would red for a
    // reason unrelated to 2b. The SECOND is `childReclaimPauseRead`'s own
    // call, on the same directory — that is the one this case makes reject.
    let readdirCalls = 0;
    const rejectingIo = {
      ...f.deps.io,
      readdir: async (dir: string, timeoutMs?: number, signal?: AbortSignal) => {
        readdirCalls += 1;
        if (readdirCalls === 1) return f.deps.io.readdir(dir, timeoutMs, signal);
        throw new Error('readdir exploded');
      },
    };
    const deps: ChildReclaimDeps = { ...f.deps, io: rejectingIo };
    const out = await reclaimChild(deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    expect(out).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
    expect(f.ccdCalls()).toEqual([]);
    expect(f.feed()).toEqual(['child reclaim deferred']);
  });
});
