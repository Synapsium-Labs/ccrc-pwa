// D-8955: the disk-lane stall alert. A cleanup lane (child reclaim, temp-root collect, dependency shed) that stops finishing
// anything while work waits on it, under disk pressure, raises ONE Waiting on you item and ONE push, keyed on lane and
// reason, and the item settles when the lane finishes one again. The decider's table is pure; the lane runs on a real
// coord.db in a fixture HOME (no ccd, no tmux, no process).
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { StatementSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseJournalLine, type JournalRow } from '../src/coord/journalparse.js';
import { NotifyLog } from '../src/notifylog.js';
import { lifecycleLaneRowsSinceSql } from '../src/coord/lifecycleLaneRows.js';
import {
  DISK_LANE_STALL_ITEM_PROGRAMME, DISK_LANE_STALL_MS, DISK_STALL_ACTS, diskLaneStallItemOf, diskLaneStallMoves, diskLaneVerdicts,
  laneProgressOf, type DiskLaneRow, type DiskLaneVerdict,
} from '../src/diskLaneStall.js';
import { DiskLaneStallLane } from '../src/diskLaneStallLane.js';
import { DISK_LANE_STALL_SWEEP_MS, laneRow } from '../src/laneSchedule.js';
import { parseItemAction } from '../../shared/ledgers.js';
import type { CleanupHeldByItem, CoordStatus, NotifyEvent } from '../../shared/api.js';
import type { DiskFilesystemLevel, DiskHealth } from '../../shared/disk.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { readFileSync } from 'node:fs';
import { DEPS_SHED_FINAL_REFUSALS, DEPS_SHED_REFUSAL_WORDS, depsShedRefusalBlocks } from '../src/depsShed.js';
import { sourceOfSymbol } from './scan/symbols.js';

afterEach(() => removeTmpFixtures());

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const GIB = 1024 ** 3;

const fs = (level: DiskFilesystemLevel['level'], usedPct: number): DiskFilesystemLevel => ({
  dev: 'dev-a', mount: '/work', fsType: 'ext4', roots: ['home', 'worktrees'], sizeBytes: 100 * GIB,
  availBytes: (100 - usedPct) * GIB, freeBytes: (100 - usedPct) * GIB, files: 1000, filesFree: 900, readOnly: false, level,
});
const disk = (pressure: boolean): DiskHealth => ({
  at: NOW, level: pressure ? 'critical' : 'ok', filesystems: [pressure ? fs('critical', 98) : fs('ok', 50)], expectedMounts: [],
  pressure, holders: [],
});
const r = (act: string, outcome: string, sessionId: string, at: number, refusal: string | null = null): DiskLaneRow =>
  ({ act, outcome, sessionId, at, refusal });
const held = (rowId: string, word: CleanupHeldByItem['word'], reclaim: number, collect = 0): CleanupHeldByItem => ({
  rowId, word, sentence: `the sentence for ${rowId}`, holds: { reclaim, expire: 0, collect }, act: 'recheck',
});
/** Two child workspaces failing for three hours, one done four hours ago. */
const wedged: DiskLaneRow[] = [
  r('reclaim', 'done', 'child-0', NOW - 4 * HOUR),
  r('reclaim', 'failed', 'child-a', NOW - 3 * HOUR, 'probe-unmeasured'),
  r('reclaim', 'failed', 'child-b', NOW - 2 * HOUR, 'probe-unmeasured'),
  r('reclaim', 'failed', 'child-a', NOW - 10 * MIN, 'probe-unmeasured'),
];
const verdict = (v: DiskLaneVerdict[], lane: string) => v.find((x) => x.lane === lane)!;
/** The registry rows the last listing named. */
const LIVE: ReadonlySet<string> = new Set(['child-0', 'child-a', 'child-b', 'child-c', 'lane-a-project-a', 'lane-b-project-a']);
const ALL = (): boolean => true;
const NONE_SEEN: ReadonlySet<string> = new Set();

describe('the decider (D-8955): pressure, candidates, a recent done, the reason', () => {
  it('the lanes are the three cleanup acts ccd journals', () => {
    expect([...DISK_STALL_ACTS]).toEqual(['reclaim', 'collect', 'shed-deps']);
    expect(DISK_LANE_STALL_MS).toBe(HOUR);
  });

  it('waits for over an hour, no done for over an hour, under pressure: stalled, counting each waiting subject once', () => {
    const v = diskLaneVerdicts({ disk: disk(true), rows: wedged, heldBy: [], live: LIVE, now: NOW });
    expect(verdict(v, 'reclaim')).toMatchObject({ kind: 'stuck', pressure: true, stall: { reason: 'probe-unmeasured', holder: null,
      progress: { waiting: 2, since: NOW - 3 * HOUR, lastDoneAt: NOW - 4 * HOUR, token: 'probe-unmeasured' } } });
  });

  it('the same lane with no pressure is stuck but not raised', () => {
    const v = diskLaneVerdicts({ disk: disk(false), rows: wedged, heldBy: [], live: LIVE, now: NOW });
    expect(verdict(v, 'reclaim')).toMatchObject({ kind: 'stuck', pressure: false });
    expect(diskLaneStallMoves(v, [], NONE_SEEN).raise).toEqual([]);
    expect(diskLaneStallMoves(diskLaneVerdicts({ disk: null, rows: wedged, heldBy: [], live: LIVE, now: NOW }), [], NONE_SEEN).raise, 'no disk block yet').toEqual([]);
  });

  it('a done within the hour is flowing; so are waits younger than an hour; no waits is idle', () => {
    expect(laneProgressOf('reclaim', [...wedged, r('reclaim', 'done', 'child-c', NOW - 59 * MIN)], NOW, ALL)).toEqual({ kind: 'flowing' });
    expect(laneProgressOf('reclaim', [r('reclaim', 'failed', 'child-a', NOW - 59 * MIN)], NOW, ALL)).toEqual({ kind: 'flowing' });
    expect(laneProgressOf('reclaim', [r('reclaim', 'failed', 'child-a', NOW - 2 * HOUR), r('reclaim', 'done', 'child-a', NOW - 90 * MIN)], NOW, ALL))
      .toEqual({ kind: 'idle' });
    expect(laneProgressOf('reclaim', [], NOW, ALL)).toEqual({ kind: 'idle' });
    expect(laneProgressOf('reclaim', [r('reclaim', 'intent', 'child-a', NOW - 2 * HOUR)], NOW, ALL), 'an intent is no wait').toEqual({ kind: 'idle' });
  });

  it('exactly an hour is stuck (the window is at least an hour)', () => {
    const rows = [r('reclaim', 'done', 'child-0', NOW - HOUR), r('reclaim', 'failed', 'child-a', NOW - HOUR, 'probe-unmeasured')];
    expect(laneProgressOf('reclaim', rows, NOW, ALL).kind).toBe('stuck');
  });

  it('a lane reads only its own act: a collect wait does not stall the reclaim lane', () => {
    const rows = [r('collect', 'failed', 'tmp-a', NOW - 3 * HOUR, 'probe-unmeasured'), r('shed-deps', 'failed', 'lane-a-project-a', NOW - 2 * HOUR, 'git-changed')];
    const v = diskLaneVerdicts({ disk: disk(true), rows, heldBy: [], live: LIVE, now: NOW });
    expect(v.map((x) => `${x.lane}:${x.kind}`)).toEqual(['reclaim:clear', 'collect:stuck', 'deps-shed:stuck']);
  });

  it('the reason is the holding row\'s word, the row holding the most for the lane; else ccd\'s token; else unknown', () => {
    const items = [held('lane-a-project-b', 'not-plain', 1), held('lane-a-project-a', 'entry-pending', 5), held('tmp-row', 'under-proc', 0, 4)];
    const v = diskLaneVerdicts({ disk: disk(true), rows: wedged, heldBy: items, live: LIVE, now: NOW });
    expect(verdict(v, 'reclaim')).toMatchObject({ stall: { reason: 'entry-pending', holder: { rowId: 'lane-a-project-a' } } });
    const noToken = wedged.map((x) => ({ ...x, refusal: null }));
    expect(verdict(diskLaneVerdicts({ disk: disk(true), rows: noToken, heldBy: [], live: LIVE, now: NOW }), 'reclaim')).toMatchObject({ stall: { reason: 'unknown' } });
    // The dependency shed names no holding rows, so a holder never speaks for it.
    const shed = [r('shed-deps', 'failed', 'lane-a-project-a', NOW - 2 * HOUR, 'git-changed')];
    expect(verdict(diskLaneVerdicts({ disk: disk(true), rows: shed, heldBy: items, live: LIVE, now: NOW }), 'deps-shed')).toMatchObject({ stall: { reason: 'git-changed', holder: null } });
  });

  it('a refusal that says nothing waits is no wait: a shed already done or with nothing to shed, a session awake, its run open', () => {
    // Review 1: ccd's `already-shed` and `nothing-to-shed` hold for the whole sleep; the others say the row is not one to shed now.
    const shed = [
      r('shed-deps', 'done', 'lane-a-project-a', NOW - 5 * HOUR),
      r('shed-deps', 'refused', 'lane-a-project-a', NOW - 3 * HOUR, 'already-shed'),
      r('shed-deps', 'refused', 'lane-b-project-a', NOW - 2 * HOUR, 'nothing-to-shed'),
      r('shed-deps', 'refused', 'child-a', NOW - 2 * HOUR, 'not-asleep'),
      r('shed-deps', 'refused', 'child-b', NOW - 2 * HOUR, 'run-open'),
    ];
    expect(verdict(diskLaneVerdicts({ disk: disk(true), rows: shed, heldBy: [], live: LIVE, now: NOW }), 'deps-shed').kind).toBe('clear');
    expect(diskLaneStallMoves(diskLaneVerdicts({ disk: disk(true), rows: shed, heldBy: [], live: LIVE, now: NOW }), [], NONE_SEEN).raise).toEqual([]);
    // Dependencies the box could not remove do wait.
    const blocked = [...shed, r('shed-deps', 'refused', 'child-c', NOW - 2 * HOUR, 'in-use')];
    expect(verdict(diskLaneVerdicts({ disk: disk(true), rows: blocked, heldBy: [], live: LIVE, now: NOW }), 'deps-shed'))
      .toMatchObject({ kind: 'stuck', stall: { reason: 'in-use', progress: { waiting: 1 } } });
  });

  it('a reclaim refusal is a wait only on the owner\'s failure line: a terminal or retry refusal is not', () => {
    // `branch-elsewhere` is terminal (the attention list parks it for the operator); `not-idle` and `paused` are retries.
    const rows = [
      r('reclaim', 'refused', 'child-a', NOW - 3 * HOUR, 'branch-elsewhere'),
      r('reclaim', 'refused', 'child-b', NOW - 3 * HOUR, 'not-idle'),
      r('reclaim', 'refused', 'child-c', NOW - 3 * HOUR, 'paused'),
    ];
    expect(laneProgressOf('reclaim', rows, NOW, ALL)).toEqual({ kind: 'idle' });
    // A pre-lock refusal is a failure line (`childReclaimFailureLine`).
    expect(laneProgressOf('reclaim', [r('reclaim', 'refused', 'child-a', NOW - 3 * HOUR, 'lock-unopenable')], NOW, ALL).kind).toBe('stuck');
  });

  it('a collect refusal the lane paces or ws-collect refuses with is no wait; a pre-lock die is', () => {
    const rows = [
      r('collect', 'refused', 'tmp-a', NOW - 3 * HOUR, 'quarantine-kept'),
      r('collect', 'refused', 'tmp-b', NOW - 3 * HOUR, 'registered'),
      r('collect', 'refused', 'tmp-c', NOW - 3 * HOUR, 'state-changed'),
    ];
    expect(laneProgressOf('collect', rows, NOW, ALL)).toEqual({ kind: 'idle' });
    expect(laneProgressOf('collect', [r('collect', 'refused', 'tmp-d', NOW - 3 * HOUR, 'flock-unavailable')], NOW, ALL).kind).toBe('stuck');
  });

  it('a subject no registry listing names any more is no wait; a temp root is not a registry row, so collect is not filtered', () => {
    const gone = [r('reclaim', 'failed', 'child-gone', NOW - 3 * HOUR, 'probe-unmeasured'), r('shed-deps', 'failed', 'gone-b', NOW - 3 * HOUR, 'git-changed')];
    const v = diskLaneVerdicts({ disk: disk(true), rows: gone, heldBy: [], live: LIVE, now: NOW });
    expect(v.map((x) => `${x.lane}:${x.kind}`)).toEqual(['reclaim:clear', 'collect:clear', 'deps-shed:clear']);
    const tmp = [r('collect', 'failed', 'tmp-root-a', NOW - 3 * HOUR, 'probe-unmeasured')];
    expect(verdict(diskLaneVerdicts({ disk: disk(true), rows: tmp, heldBy: [], live: LIVE, now: NOW }), 'collect').kind).toBe('stuck');
  });

  it('before the first coord frame or the first listing, the lanes that read them answer unknown, never "nothing holds"', () => {
    // Review 2 and 5: a null frame is not an empty one. The shed names no holders, so the frame does not gate it.
    const rows = [...wedged, r('collect', 'failed', 'tmp-a', NOW - 3 * HOUR, 'probe-unmeasured'), r('shed-deps', 'failed', 'lane-a-project-a', NOW - 2 * HOUR, 'git-changed')];
    const noFrame = diskLaneVerdicts({ disk: disk(true), rows, heldBy: null, live: LIVE, now: NOW });
    expect(noFrame.map((x) => `${x.lane}:${x.kind}`)).toEqual(['reclaim:unknown', 'collect:unknown', 'deps-shed:stuck']);
    const noListing = diskLaneVerdicts({ disk: disk(true), rows, heldBy: [], live: null, now: NOW });
    expect(noListing.map((x) => `${x.lane}:${x.kind}`)).toEqual(['reclaim:unknown', 'collect:stuck', 'deps-shed:unknown']);
    expect(diskLaneStallMoves(noFrame, [{ id: 7, lane: 'reclaim', reason: 'entry-pending' }], NONE_SEEN).settle).toEqual([]);
  });

  it('a holder this process has not seen since it started is not a change of cause: the open item stands, and nothing is raised', () => {
    // Review 2: after a restart the held-by facts are re-read one audit at a time, so the token speaks first.
    const v = diskLaneVerdicts({ disk: disk(true), rows: wedged, heldBy: [], live: LIVE, now: NOW });
    expect(diskLaneStallMoves(v, [{ id: 7, lane: 'reclaim', reason: 'entry-pending' }], NONE_SEEN)).toEqual({ settle: [], raise: [] });
    // A holder that names another cause is measured: that change settles and raises.
    const named = diskLaneVerdicts({ disk: disk(true), rows: wedged, heldBy: [held('lane-a-project-a', 'not-plain', 2)], live: LIVE, now: NOW });
    const moved = diskLaneStallMoves(named, [{ id: 7, lane: 'reclaim', reason: 'entry-pending' }], NONE_SEEN);
    expect(moved.settle.map((x) => x.id)).toEqual([7]);
    expect(moved.raise.map((x) => x.reason)).toEqual(['not-plain']);
    // A token cause that changed to another token is measured from the journal: it settles.
    expect(diskLaneStallMoves(v, [{ id: 8, lane: 'reclaim', reason: 'tree-unreadable' }], NONE_SEEN).settle.map((x) => x.id)).toEqual([8]);
  });

  it('the shed refusal table names exactly the words ccd refuses a shed with, and the final ones are derived from it', () => {
    const src = readFileSync(path.join(import.meta.dirname, '../../ccd/lib/disk-retention.sh'), 'utf8');
    const words = new Set([...src.matchAll(/_ws_shed_refused ([a-z][a-z-]*) /g)].map((m) => m[1]!));
    expect([...DEPS_SHED_REFUSAL_WORDS].sort()).toEqual([...words].sort());
    expect(DEPS_SHED_FINAL_REFUSALS).toEqual(['nothing-to-shed', 'already-shed']);
    expect(depsShedRefusalBlocks('in-use')).toBe(true);
    expect(depsShedRefusalBlocks('a-newer-word'), 'a word this build does not know is told').toBe(true);
    expect(depsShedRefusalBlocks('toString')).toBe(true);
    expect(depsShedRefusalBlocks('already-shed')).toBe(false);
  });

  it('a journal that could not be read answers unknown, which raises and settles nothing', () => {
    const v = diskLaneVerdicts({ disk: disk(true), rows: null, heldBy: [], live: LIVE, now: NOW });
    expect(v.every((x) => x.kind === 'unknown')).toBe(true);
    expect(diskLaneStallMoves(v, [{ id: 1, lane: 'reclaim', reason: 'probe-unmeasured' }], NONE_SEEN)).toEqual({ settle: [], raise: [] });
  });

  it('the moves: an open item of the same reason holds the raise; another reason settles and raises; a clear lane settles', () => {
    const v = diskLaneVerdicts({ disk: disk(true), rows: wedged, heldBy: [], live: LIVE, now: NOW });
    expect(diskLaneStallMoves(v, [{ id: 1, lane: 'reclaim', reason: 'probe-unmeasured' }], NONE_SEEN)).toEqual({ settle: [], raise: [] });
    // The holder this process saw is gone, and ccd's token now speaks: the cause changed, measured.
    const other = diskLaneStallMoves(v, [{ id: 2, lane: 'reclaim', reason: 'entry-pending' }], new Set(['reclaim:entry-pending']));
    expect(other.settle).toEqual([{ id: 2, note: 'The cause changed to probe-unmeasured; a new item says so.' }]);
    expect(other.raise.map((s) => `${s.lane}:${s.reason}`)).toEqual(['reclaim:probe-unmeasured']);
    expect(diskLaneStallMoves(v, [{ id: 3, lane: 'collect', reason: 'witness-mismatch' }], NONE_SEEN).settle)
      .toEqual([{ id: 3, note: 'Nothing waits on temp folder cleanup any more.' }]);
    const calm = diskLaneVerdicts({ disk: disk(false), rows: wedged, heldBy: [], live: LIVE, now: NOW });
    expect(diskLaneStallMoves(calm, [{ id: 4, lane: 'reclaim', reason: 'probe-unmeasured' }], NONE_SEEN), 'pressure easing alone does not settle')
      .toEqual({ settle: [], raise: [] });
  });

  it('the words: which lane, how much waits, why, the remedy; the self-heal is named for entry-pending', () => {
    const v = diskLaneVerdicts({ disk: disk(true), rows: wedged, heldBy: [held('lane-a-project-a', 'entry-pending', 2)], live: LIVE, now: NOW });
    const s = (verdict(v, 'reclaim') as Extract<DiskLaneVerdict, { kind: 'stuck' }>).stall;
    const { item, push } = diskLaneStallItemOf(s, disk(true), NOW);
    expect(item.title).toBe('Child workspace cleanup has stalled while the disk is under pressure');
    expect(item.why).toBe('2 closed child workspaces wait to be removed, and none has been removed for 4 hours. '
      + 'The disk holding home, worktrees is 98% full, 2 GiB free. Registry row lane-a-project-a holds them (entry-pending).');
    expect(item.how[0]).toBe('the sentence for lane-a-project-a ccrc\'s automatic roll may stop and start that session by itself once '
      + 'it is idle, unless the roll is kept from it (its setting, a no-roll marker, the Overlord); stopping and starting it now clears this.');
    expect(item.how[1]).toBe('ccrc closes this item when child workspace cleanup removed one again.');
    expect(item).toMatchObject({ program: DISK_LANE_STALL_ITEM_PROGRAMME, kind: 'do', neededBy: 'soon', soonLabel: null,
      action: { verb: 'disk-lane-stall', lane: 'reclaim', reason: 'entry-pending' } });
    expect(push).toEqual({
      title: item.title, url: '/waiting', dedupeKey: `disk-lane-stall:reclaim:entry-pending:${NOW - 4 * HOUR}`,
      body: expect.stringMatching(/^2 closed child workspaces waiting, none removed for 4 hours\. Held by lane-a-project-a \(entry-pending\)\./),
    });
  });

  it('the action round-trips through the one reader of the column', () => {
    expect(parseItemAction(JSON.stringify({ verb: 'disk-lane-stall', lane: 'reclaim', reason: 'entry-pending' })))
      .toEqual({ verb: 'disk-lane-stall', lane: 'reclaim', reason: 'entry-pending' });
    expect(parseItemAction(JSON.stringify({ verb: 'disk-lane-stall', lane: 'reclaim' }))).toBeNull();
  });
});

// ── the lane, on a real coord.db ──────────────────────────────────────────────────────────────────────────────────────

const GEN = '1758500000000000000';
let seq = 0;
const line = (sessionId: string, act: string, outcome: string, at: number, refusal?: string): JournalRow =>
  parseJournalLine(JSON.stringify({ uid: `d8955.1.${++seq}`, at, act, outcome, id: sessionId, ...(refusal === undefined ? {} : { refusal }) }));

async function setup() {
  const home = mkTmp('ccrc-disk-lane-stall-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const notices: NotifyEvent[] = [];
  const record = notifyLog.record.bind(notifyLog);
  notifyLog.record = (e) => { const ev = record(e); if (ev.kind === 'coord') notices.push(ev); return ev; };
  let clock = NOW;
  const lane = new DiskLaneStallLane(() => ({ coord, notifyLog }), () => clock);
  let cursor = 0;
  const ingest = (rows: JournalRow[]): void => { cursor += 100; coord.ingestJournal({ gen: GEN, rows, cursor, size: cursor, at: 9 }); };
  const items = () => coord.itemsFor(DISK_LANE_STALL_ITEM_PROGRAMME, clock).open.filter((i) => i.action?.verb === 'disk-lane-stall');
  return { home, coord, notifyLog, notices, lane, ingest, items, tick: (ms: number) => { clock += ms; }, now: () => clock };
}
const FLEET = [...LIVE].map((id) => ({ id }));
const frame = (items: CleanupHeldByItem[]): CoordStatus =>
  ({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], cleanupHeldBy: items });

describe('the lane (D-8955): raises once, settles on the next done, and a restart re-sends nothing', () => {
  it('reads the journal through one bounded, index-seeking statement', () => {
    const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-dls-sql-'), '.ccrc', 'coord.db')));
    const plan = (coord as unknown as { db: { prepare(s: string): StatementSync } }).db
      .prepare(`EXPLAIN QUERY PLAN ${lifecycleLaneRowsSinceSql(3)}`).all() as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' | ')).toMatch(/USING INDEX lifecycle_by_at \(at>\?\)/);
  });

  it('a wedged reclaim under pressure raises ONE item and ONE push; a second pass raises nothing; a done settles it', async () => {
    const s = await setup();
    s.ingest([
      line('child-0', 'reclaim', 'done', NOW - 4 * HOUR),
      line('child-a', 'reclaim', 'failed', NOW - 3 * HOUR, 'probe-unmeasured'),
      line('child-b', 'reclaim', 'failed', NOW - 2 * HOUR, 'probe-unmeasured'),
      line('lane-a-project-a', 'start', 'done', NOW - 2 * HOUR),
    ]);
    const f = frame([held('lane-a-project-a', 'entry-pending', 2)]);
    s.lane.pass(disk(true), f, FLEET);
    expect(s.items().map((i) => i.action)).toEqual([{ verb: 'disk-lane-stall', lane: 'reclaim', reason: 'entry-pending' }]);
    expect(s.notices.map((n) => n.title)).toEqual(['Child workspace cleanup has stalled while the disk is under pressure']);
    s.tick(DISK_LANE_STALL_SWEEP_MS);
    s.lane.pass(disk(true), f, FLEET);
    expect(s.items()).toHaveLength(1);
    expect(s.notices, 'the open item holds the raise').toHaveLength(1);
    // The lane finishes one again: the item settles, with its note, and nothing new is pushed.
    s.ingest([line('child-a', 'reclaim', 'done', s.now() - MIN)]);
    s.tick(DISK_LANE_STALL_SWEEP_MS);
    s.lane.pass(disk(true), f, FLEET);
    expect(s.items()).toEqual([]);
    const closed = s.coord.itemsFor(DISK_LANE_STALL_ITEM_PROGRAMME, s.now()).cleared.filter((i) => i.action?.verb === 'disk-lane-stall');
    expect(closed.map((i) => i.state)).toEqual(['done']);
    const last = s.coord.itemHistory(closed[0]!.id).at(-1);
    expect([last?.act, last?.note]).toEqual(['settle', 'Child workspace cleanup removed one again.']);
    expect(s.notices).toHaveLength(1);
  });

  it('a restart (a new lane over the same store) re-sends nothing while the item stands, nor after a lost item', async () => {
    const s = await setup();
    s.ingest([line('child-a', 'reclaim', 'failed', NOW - 3 * HOUR, 'probe-unmeasured')]);
    s.lane.pass(disk(true), frame([]), FLEET);
    expect(s.notices).toHaveLength(1);
    const again = new DiskLaneStallLane(() => ({ coord: s.coord, notifyLog: s.notifyLog }), s.now);
    again.pass(disk(true), frame([]), FLEET);
    expect(s.items()).toHaveLength(1);
    expect(s.notices, 'restart: the item is durable').toHaveLength(1);
    // The item is closed by hand (dismissed): a later pass raises it again, but the push's key was archived, so no push.
    s.coord.moveItem(s.items()[0]!.id, 'dismiss', 'operator', {}, s.now(), { programmeHasOpenRun: false });
    again.pass(disk(true), frame([]), FLEET);
    expect(s.items()).toHaveLength(1);
    expect(s.notices, 'the push key is read before the write').toHaveLength(1);
  });

  it('no pressure raises nothing; an unread journal moves nothing; with no store the pass is a no-op', async () => {
    const s = await setup();
    s.ingest([line('child-a', 'reclaim', 'failed', NOW - 3 * HOUR, 'probe-unmeasured')]);
    s.lane.pass(disk(false), frame([]), FLEET);
    s.lane.pass(null, null, FLEET);
    expect(s.items()).toEqual([]);
    s.lane.pass(disk(true), null, FLEET);
    expect(s.items(), 'no frame yet: the reclaim lane is unmeasured').toEqual([]);
    s.lane.pass(disk(true), frame([]), null);
    expect(s.items(), 'no listing yet: the reclaim lane is unmeasured').toEqual([]);
    s.lane.pass(disk(true), frame([]), FLEET);
    expect(s.items()).toHaveLength(1);
    const broken = new DiskLaneStallLane(() => ({ coord: { ...s.coord, lifecycleLaneRowsSince: () => { throw new Error('locked'); },
      itemsFor: s.coord.itemsFor.bind(s.coord), moveItem: s.coord.moveItem.bind(s.coord), raiseItem: s.coord.raiseItem.bind(s.coord),
      hasNotice: s.coord.hasNotice.bind(s.coord), recordFeedEvent: s.coord.recordFeedEvent.bind(s.coord) } }), s.now);
    s.ingest([line('child-a', 'reclaim', 'done', s.now() - MIN)]);
    broken.pass(disk(true), frame([]), FLEET);
    expect(s.items(), 'an unread journal settles nothing').toHaveLength(1);
    new DiskLaneStallLane(() => ({}), s.now).pass(disk(true), null, FLEET);
  });

  it('a restart while a held stall stands: no frame, then a frame before the holder is re-read, then the holder; one item, one push', async () => {
    // Review 2 and 5: the first passes after a restart run before the held-by facts are measured again.
    const s = await setup();
    s.ingest([1, 2, 3, 4, 5].map((h) => line('child-a', 'reclaim', 'failed', NOW - h * HOUR, 'probe-unmeasured')));
    const f = frame([held('lane-a-project-a', 'entry-pending', 1)]);
    s.lane.pass(disk(true), f, FLEET);
    const first = s.items();
    expect(first.map((i) => i.action)).toEqual([{ verb: 'disk-lane-stall', lane: 'reclaim', reason: 'entry-pending' }]);
    const again = new DiskLaneStallLane(() => ({ coord: s.coord, notifyLog: s.notifyLog }), s.now);
    again.pass(null, null, null);
    again.pass(disk(true), null, FLEET);
    again.pass(disk(true), frame([]), FLEET);
    expect(s.items().map((i) => i.id), 'the open item is untouched').toEqual(first.map((i) => i.id));
    again.pass(disk(true), f, FLEET);
    expect(s.items().map((i) => i.id)).toEqual(first.map((i) => i.id));
    expect(s.notices).toHaveLength(1);
    // Once this process has seen the holder, its absence is measured: the cause changed, and a new item says so.
    s.tick(DISK_LANE_STALL_SWEEP_MS);
    again.pass(disk(true), frame([]), FLEET);
    expect(s.items().map((i) => i.action)).toEqual([{ verb: 'disk-lane-stall', lane: 'reclaim', reason: 'probe-unmeasured' }]);
  });

  it('its row: one pass at a time, every five minutes', () => {
    expect(laneRow('diskLaneStall')).toMatchObject({ cadenceMs: 5 * MIN, flight: 'skip', clock: 'mono' });
  });

  it('the tick runs it on its row with the disk block and the last coord frame, above the registry read (a full disk is when that read fails)', () => {
    const tick = sourceOfSymbol(path.join(import.meta.dirname, '../src/watch.ts'), 'FleetWatcher.tick');
    const at = tick.indexOf("this.runLane('diskLaneStall', () => { this.diskLaneStall.pass(this.diskAlarm.block(), this.coord, this.lastFleet); })");
    expect(at, 'the dispatch').toBeGreaterThan(0);
    expect(at, 'above the registry read').toBeLessThan(tick.indexOf('readRegistryMeasured('));
  });
});
