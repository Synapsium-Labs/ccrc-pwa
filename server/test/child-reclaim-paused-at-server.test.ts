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
// A11 amendment: this file also covers the coordinating re-read that sits
// BETWEEN the sibling re-read and the pause read (spec §1, rules 3-4) — a
// session that has EVER coordinated a run, in any state, is never reclaimed
// automatically, and it is checked before the pause so the more specific
// answer (`siblings-open`) wins over `paused-at-server` when both are true.
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
    expect(out).toMatchObject({ kind: 'deferred', why: 'siblings-open' });
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

describe('reclaimChild — A11: the coordinating re-read, before the pause', () => {
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
