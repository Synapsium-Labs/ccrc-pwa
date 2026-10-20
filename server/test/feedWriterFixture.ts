// D-5850 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0c; spec K6): the feed writers' pin's
// ONE recording fixture, shared by part 1 (`feed-writers-pin.test.ts`) and part 2 (Task C0d). A later part adds a member
// here, additively, and never builds a second recorder.
//
// It records every call a feed writer makes into its sinks, in order, into one array:
// - `NotifyLog.record` and `NotifyLog.flush`, on a REAL `NotifyLog` (so `record` answers `{ epoch, seq }` and never
//   throws, as the real one does), observed by wrapping the instance's own two methods;
// - `CoordStore.recordFeedEvent`, on a REAL `CoordStore` (or one a rig already built), wrapped the same way; it can be
//   told to throw on its n-th call, as `node:sqlite` throws synchronously on a full disk or a held write lock;
// - `PushService.notify`, a fake that records the payload;
// - a presence fake: `isVisible(id)` per session.
// `console.warn` is spied (and silenced), so each writer's degrade sentence can be asserted byte for byte. The events
// `record` returned are kept as the objects it returned, so a row can compare `JSON.stringify` of what reaches catch-up.
// It drives nothing itself: each row reaches a writer through that writer's own lane or route.
import { vi, type MockInstance } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import type { PushPayload } from '../src/push.js';
import type { recordInterrupt } from '../src/interruptlog.js';
import { noticeSink } from '../src/notice.js';
import type { NotifyEvent } from '../../shared/api.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';

/** One sink call, in the order the writers made them. */
export type FeedSinkCall = 'record' | 'flush' | 'archive' | 'push';

/** The message every scripted archive failure throws, so a degrade sentence is spelled from it. */
export const ARCHIVE_FAILURE = 'disk full';

export interface FeedRecorder {
  /** Every sink call, in order. `mark()` answers an index, so a row can read only what happened after its arrange. */
  readonly calls: FeedSinkCall[];
  /** The events `NotifyLog.record` returned, as the objects it returned. */
  readonly ring: NotifyEvent[];
  /** The events `recordFeedEvent` was handed and stored (a throwing call stores nothing). */
  readonly archived: NotifyEvent[];
  readonly pushes: PushPayload[];
  readonly notifyLog: NotifyLog;
  readonly coord: CoordStore;
  readonly push: { notify: (p: PushPayload) => Promise<void> };
  readonly presence: { isVisible: (id: string) => boolean };
  readonly warn: MockInstance<typeof console.warn>;
  /** The `recordFeedEvent` call numbered `n` (1-based, counted from the recorder's creation) throws `ARCHIVE_FAILURE`.
   *  `'every'` makes every later call throw. */
  archiveThrowsOn(n: number | 'every'): void;
  /** The sessions a client is looking at. */
  setVisible(ids: readonly string[]): void;
  /** The index the next call will take: `since(mark())` reads only what came after. */
  mark(): number;
  since(at: number): FeedSinkCall[];
  /** Every `console.warn` line, as the first argument each call printed. */
  warned(): string[];
}

/** A recorder over a REAL `NotifyLog` (`opts.notifyLog`, or a fresh one under `home/.ccrc/notify.json`) and a real
 *  `CoordStore` (`opts.coord`, or a fresh one under `home/.ccrc/coord.db`). Restore the warn spy with
 *  `vi.restoreAllMocks()` in the suite's `afterEach`. `opts.notifyLog` (D-5851, part 2) is for a rig that built its
 *  own log before the recorder: its two methods are wrapped in place, as `opts.coord`'s archive is. */
export const feedRecorder = async (
  home: string, opts: { coord?: CoordStore; notifyLog?: NotifyLog } = {},
): Promise<FeedRecorder> => {
  const calls: FeedSinkCall[] = [];
  const ring: NotifyEvent[] = [];
  const archived: NotifyEvent[] = [];
  const pushes: PushPayload[] = [];
  const notifyLog = opts.notifyLog ?? new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  if (opts.notifyLog === undefined) await notifyLog.load();
  const record = notifyLog.record.bind(notifyLog);
  const flush = notifyLog.flush.bind(notifyLog);
  notifyLog.record = (e) => {
    calls.push('record');
    const ev = record(e);
    ring.push(ev);
    return ev;
  };
  notifyLog.flush = () => {
    calls.push('flush');
    return flush();
  };
  const coord = opts.coord ?? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const archive = coord.recordFeedEvent.bind(coord);
  let archiveN = 0;
  let throwOn: number | 'every' | null = null;
  coord.recordFeedEvent = (epoch, ev) => {
    calls.push('archive');
    archiveN += 1;
    if (throwOn === 'every' || throwOn === archiveN) throw new Error(ARCHIVE_FAILURE);
    archive(epoch, ev);
    archived.push(ev);
  };
  const push = {
    notify: async (p: PushPayload): Promise<void> => {
      calls.push('push');
      pushes.push(p);
    },
  };
  let visible: ReadonlySet<string> = new Set();
  const presence = { isVisible: (id: string): boolean => visible.has(id) };
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return {
    calls, ring, archived, pushes, notifyLog, coord, push, presence, warn,
    archiveThrowsOn: (n) => { throwOn = n; },
    setVisible: (ids) => { visible = new Set(ids); },
    mark: () => calls.length,
    since: (at) => calls.slice(at),
    warned: () => warn.mock.calls.map((c) => String(c[0])),
  };
};

/** The sink calls with every flush dropped: the order the pin asserts (ring, archive, push). Where a flush sits
 *  relative to the archive is an observation, never asserted (spec K6, rev 2.1: production cannot see it). */
export const withoutFlush = (calls: readonly FeedSinkCall[]): FeedSinkCall[] => calls.filter((c) => c !== 'flush');

/** A flush follows the first ring record. */
export const flushedAfterRecord = (calls: readonly FeedSinkCall[]): boolean => {
  const r = calls.indexOf('record');
  return r !== -1 && calls.indexOf('flush', r + 1) !== -1;
};

/** A writer's degrade sentence for the scripted failure: `ccrc-server: recordFeedEvent failed (<message>) — <tail>`. */
export const degradeLine = (tail: string): string => `ccrc-server: recordFeedEvent failed (${ARCHIVE_FAILURE}) — ${tail}`;

/** D-5857 (Task C1c): the deps `recordInterrupt` is handed over a recorder, in the shape it takes on this tree. A row
 *  that drives the interrupt writer calls this, so the writer's deps shape lives here, beside the recorder. */
export const interruptDeps = (sinks: { notifyLog?: NotifyLog; coord?: CoordStore }): Parameters<typeof recordInterrupt>[0] =>
  ({ notice: noticeSink(sinks) });

/** D-5857 (Task C1c): the bytes `GET /api/notifications/catchup` answers a client at `seq=0` of the log's own epoch,
 *  served by a real `buildServer` over the log (masker included), never `catchUp()` read directly. */
export const catchUpBody = async (home: string, notifyLog: NotifyLog): Promise<string> => {
  const app = await buildServer({ ...testDeps(home), notifyLog });
  try {
    return (await app.inject({ method: 'GET', url: `/api/notifications/catchup?epoch=${notifyLog.epoch}&seq=0` })).body;
  } finally {
    await app.close();
  }
};

/** The catch-up bytes a client must read: the response's four keys in their order, and each event as the row spells
 *  it, key by key. A writer that reorders its record, or a response that gains a field, differs from this. */
export const catchUpExpected = (notifyLog: NotifyLog, events: readonly Record<string, unknown>[]): string =>
  JSON.stringify({ epoch: notifyLog.epoch, seq: events.length === 0 ? 0 : events.at(-1)!['seq'], resync: false, events });
