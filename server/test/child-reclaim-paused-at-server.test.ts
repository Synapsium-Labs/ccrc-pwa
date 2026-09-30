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
// sibling re-read and the pause read (spec §1, rule 4, "Manual cleanup
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
  // The member set the close route composes. The verbs are the ones wave 3's
  // executor checks before it reaches the audit, as its own test's `CAPS`
  // spells them: `ws-audit`
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
// `reclaim:<from> -> <to>` row `reclaimProgram` writes (spec §1, rule 4).
describe('CoordStore.childReclaimCoordinatorIds — the displaced side', () => {
  // The size case's bound: the bounded read measured about 7 ms on the fleet
  // box, the unbounded one about 7.8 s; 1000 ms sits far from both.
  const CHILD_RECLAIM_COORDINATOR_IDS_BOUND_MS = 1000;
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
  // back verbatim. `to` is narrower but not clean: the reclaim route trims it
  // and `reclaimRun` (`reclaim.ts`) requires `<to>.uuid` in the registry
  // listing, so it is never empty — but a filename may hold a space, a tab or
  // a line feed; see the `to`-side cases below.
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

  // An arrow on the `from` side: the true `from` is the LAST prefix here, and
  // the prefix before the first arrow joins the set too — the over-protection
  // `childReclaimDisplacedCandidates` accepts rather than pick one split.
  it('round-trips a from with its own embedded " -> " — the true from and the earlier prefix both join', () => {
    const coord = bareStore();
    const from = 'demo -> x';
    const opened = coord.openRun({ program: 'w4-embedded-arrow', title: 'w4-embedded-arrow', project: 'demo',
      wave: 1, waveOf: null, claimedBy: from });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    expect(coord.reclaimProgram(opened.id, 'heir-arrow', Date.now(), null)).toMatchObject({ ok: true });
    const ids = coord.childReclaimCoordinatorIds();
    expect(ids.has(from)).toBe(true);
    expect(ids.has('demo')).toBe(true);   // the documented over-protection
  });

  // A `from` ENDING in ` ->` makes the writer's separator overlap an earlier
  // occurrence: `demo -> -> heir` holds ` -> ` at two overlapping offsets,
  // and only a search that resumes one character past each hit finds both.
  it('round-trips a from ending in " ->" — overlapping occurrences are all found', () => {
    const coord = bareStore();
    const from = 'demo ->';
    const opened = coord.openRun({ program: 'w4-trailing-arrow', title: 'w4-trailing-arrow', project: 'demo',
      wave: 1, waveOf: null, claimedBy: from });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    expect(coord.reclaimProgram(opened.id, 'heir', Date.now(), null)).toMatchObject({ ok: true });
    expect(coord.childReclaimCoordinatorIds().has(from)).toBe(true);
  });

  // A LINE TERMINATOR in `from`: `POST /api/runs`'s own check is
  // `claimedBy.trim() === ''`, which refuses a value that is ONLY line
  // terminators but not one holding a terminator beside other characters,
  // so such a value reaches the writer. Each case reads its `from` back
  // VERBATIM through the real `reclaimProgram` writer, exactly as the
  // whitespace cases above do — a reader that matched with a bare regex `.`
  // (which excludes `\n`, `\r`, U+2028 and U+2029) would throw on these.
  it('round-trips a from holding an embedded line feed', () => {
    const coord = bareStore();
    const from = 'demo\nx';
    const opened = coord.openRun({ program: 'w4-embedded-lf', title: 'w4-embedded-lf', project: 'demo',
      wave: 1, waveOf: null, claimedBy: from });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    expect(coord.reclaimProgram(opened.id, 'heir-lf', Date.now(), null)).toMatchObject({ ok: true });
    expect(coord.childReclaimCoordinatorIds().has(from)).toBe(true);
  });

  it('round-trips a from holding an embedded carriage return', () => {
    const coord = bareStore();
    const from = 'demo\rx';
    const opened = coord.openRun({ program: 'w4-embedded-cr', title: 'w4-embedded-cr', project: 'demo',
      wave: 1, waveOf: null, claimedBy: from });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    expect(coord.reclaimProgram(opened.id, 'heir-cr', Date.now(), null)).toMatchObject({ ok: true });
    expect(coord.childReclaimCoordinatorIds().has(from)).toBe(true);
  });

  it('round-trips a from with a LEADING line feed — the value is stored untrimmed', () => {
    const coord = bareStore();
    const from = '\ndemo-x';
    const opened = coord.openRun({ program: 'w4-leading-lf', title: 'w4-leading-lf', project: 'demo',
      wave: 1, waveOf: null, claimedBy: from });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    expect(coord.reclaimProgram(opened.id, 'heir-leading-lf', Date.now(), null)).toMatchObject({ ok: true });
    expect(coord.childReclaimCoordinatorIds().has(from)).toBe(true);
  });

  // An EMPTY `from`. `trim` does not strip NUL, so `POST /api/runs` accepts
  // a `claimedBy` of `"\u0000"`; node:sqlite reads the stored value back
  // truncated at the NUL, as `""`, so the writer emits `reclaim: -> <to>`.
  // A reader that needed at least one character of `from` threw on that row
  // forever.
  it('round-trips an EMPTY from — a NUL-leading claimedBy reads back as ""', () => {
    const coord = bareStore();
    const opened = coord.openRun({ program: 'w4-nul-from', title: 'w4-nul-from', project: 'demo',
      wave: 1, waveOf: null, claimedBy: '\u0000' });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    expect(coord.reclaimProgram(opened.id, 'heir-nul', Date.now(), null)).toMatchObject({ ok: true });
    let ids: ReadonlySet<string> | undefined;
    expect(() => { ids = coord.childReclaimCoordinatorIds(); }).not.toThrow();
    expect(ids!.has('')).toBe(true);
    expect(ids!.has('heir-nul')).toBe(true);
  });

  // The `to` side. The reclaim door hands `reclaimProgram` a trimmed id whose
  // `<to>.uuid` is in the registry listing — a filename, which may hold a
  // space, a tab, a line feed, a ` -> ` of its own, or start with `-> `.
  // Each such `to` must still parse, and the true displaced `from` must be in
  // the set. With an arrow in `to`, the true `from` is the FIRST prefix, not
  // the last: a reader that took the last arrow as the separator dropped it
  // (measured through the reclaim route before this reader existed).
  for (const [slug, label, to] of [
    ['space', 'a space', 'heir x'], ['tab', 'a tab', 'heir\tx'], ['lf', 'a line feed', 'heir\nx'],
    ['arrow', 'its own " -> "', 'heir -> y'], ['lead-arrow', 'a leading "-> "', '-> y'],
  ] as const) {
    it(`round-trips a to holding ${label}`, () => {
      const coord = bareStore();
      const opened = coord.openRun({ program: `w4-to-${slug}`, title: 'w4-to-ws', project: 'demo',
        wave: 1, waveOf: null, claimedBy: 'demo-a' });
      if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
      expect(coord.reclaimProgram(opened.id, to, Date.now(), null)).toMatchObject({ ok: true });
      const ids = coord.childReclaimCoordinatorIds();
      expect(ids.has('demo-a')).toBe(true);
      expect(ids.has(to)).toBe(true);
    });
  }

  // THE LENGTH BOUND. A session id is a filename component (`<id>.uuid`), so
  // no id over 255 characters can be a reclaimable child, and the reader
  // drops every longer candidate. Both edges of that bound, through the real
  // writer: a 255-character `from` still joins (its own separator sits at
  // offset 255, the last one the search takes), and the arrows inside it
  // still yield their shorter prefixes.
  it('round-trips a from of exactly 255 characters holding its own arrows', () => {
    const coord = bareStore();
    const from = `${'a'.repeat(240)} -> ${'b'.repeat(11)}`;
    expect(from.length).toBe(255);
    const opened = coord.openRun({ program: 'w4-255', title: 'w4-255', project: 'demo',
      wave: 1, waveOf: null, claimedBy: from });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    expect(coord.reclaimProgram(opened.id, 'heir-255', Date.now(), null)).toMatchObject({ ok: true });
    const ids = coord.childReclaimCoordinatorIds();
    expect(ids.has(from)).toBe(true);
    expect(ids.has('a'.repeat(240))).toBe(true);
    expect(ids.has('heir-255')).toBe(true);
  });

  it('a from of 256 characters is dropped — it could never be a session id — and the read neither throws nor loses the heir', () => {
    const coord = bareStore();
    const from = 'c'.repeat(256);
    const opened = coord.openRun({ program: 'w4-256', title: 'w4-256', project: 'demo',
      wave: 1, waveOf: null, claimedBy: from });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    expect(coord.reclaimProgram(opened.id, 'heir-256', Date.now(), null)).toMatchObject({ ok: true });
    let ids: ReadonlySet<string> | undefined;
    expect(() => { ids = coord.childReclaimCoordinatorIds(); }).not.toThrow();
    expect(ids!.has(from)).toBe(false);
    expect(ids!.has('heir-256')).toBe(true);
  });

  // THE SIZE CASE. `POST /api/runs` bounds `claimedBy` only by the body
  // limit, and `reclaimProgram` writes one displacement row per run it moves.
  // A megabyte `claimedBy` of repeated ` -> ` over three rows once cost this
  // read about 7.8 s of synchronous event-loop time per call (it runs on
  // every sweep pass and every close): every row's prefixes are the same
  // strings, which made a `Set` of them quadratic. With the length bound it
  // measured a few milliseconds on the fleet box; the bound below is a
  // generous multiple of that and far below the regression. Three
  // programmes, one distinct text each, so the rows stay distinct after the
  // read's own `DISTINCT` and this case measures the length bound alone.
  it('three rows displaced from megabyte claimedBy values of repeated arrows read back in bounded time', () => {
    const coord = bareStore();
    for (const n of [1, 2, 3]) {
      const opened = coord.openRun({ program: `w4-huge-${n}`, title: 'w4-huge', project: 'demo',
        wave: 1, waveOf: null, claimedBy: `${' -> '.repeat(250_000)}x${n}` });
      if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened).slice(0, 200)}`);
      expect(coord.reclaimProgram(opened.id, `heir-huge-${n}`, Date.now(), null)).toMatchObject({ ok: true });
    }
    for (let call = 0; call < 2; call += 1) {
      const t0 = performance.now();
      const ids = coord.childReclaimCoordinatorIds();
      const ms = performance.now() - t0;
      expect(ids.has('heir-huge-3')).toBe(true);
      expect(ms).toBeLessThan(CHILD_RECLAIM_COORDINATOR_IDS_BOUND_MS);
    }
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
