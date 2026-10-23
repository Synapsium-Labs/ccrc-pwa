// D-5857 `notify-funnel` (plan docs/superpowers/plans/2026-10-19-consolidation-w1a-switches-notify.md, Task C1c;
// ARCH-54 (#789), first PR; spec K6). The notice funnel's own suite.
//
// PART 1, characterization (green on the code before the funnel): the catch-up response's bytes, filled through each
// writer outside `coord/` that this task moves, compared as `JSON.stringify` output so a writer's key order counts and a
// response that gains a field is red. `pushOne`'s and the operator-answer pair's byte rows sit beside their own rows in
// `feed-writers-pin.test.ts`; the interrupt writer's and the collector's two rows are here.
//
// PART 2, the funnel itself (red before `notice.ts` existed): each mode's sinks over `visible ∈ {true, false}` equal the
// matching `pushOne` flag combination's row in `feed-writers-pin.test.ts`; a failed archive leaves the ring and the push
// and prints the caller's sentence; the order is ring, archive, push with a flush after the ring record; the caller's
// record reaches the ring with its keys in the caller's order; no notify log means no ring and no archive row.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordInterrupt } from '../src/interruptlog.js';
import { COLLECT_FEED_TITLE, COLLECT_SETTING_FEED_TITLE } from '../src/collectLane.js';
import { interruptEventBody } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { collectRig } from './collectLaneFixture.js';
import {
  catchUpBody, catchUpExpected, degradeLine, feedRecorder, flushedAfterRecord, interruptDeps, withoutFlush,
  type FeedRecorder,
} from './feedWriterFixture.js';
import {
  NOTICE_DEGRADED_DEFAULT, notify, notifyEach, notifyPushOnly, type NoticeMode, type NoticeRecord,
} from '../src/notice.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const A = 'acct-a-project-a';

describe("the catch-up response's bytes, filled through each moved writer (D-5857)", () => {
  it("through recordInterrupt: the interrupt writer's key order, the response's four keys", async () => {
    const home = mkTmp('ccrc-notice-interrupt-');
    const rec = await feedRecorder(home);
    recordInterrupt(interruptDeps(rec), A, 'keycap', 'sent');
    const [ev] = rec.ring;
    expect(await catchUpBody(home, rec.notifyLog)).toBe(catchUpExpected(rec.notifyLog, [
      { kind: 'interrupt', sessionId: A, title: 'interrupt · keycap', body: interruptEventBody('keycap', 'sent'),
        runId: null, seq: 1, at: ev!.at },
    ]));
  });

  it("through the collector's `run` row (collectRecordFeed): its key order", async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-collect-'));
    const f = await collectRig({ coord: rec.coord, notifyLog: rec.notifyLog, push: rec.push });
    f.pastHoldOff();
    await f.goLive();
    const ev = rec.ring.find((e) => e.title === COLLECT_FEED_TITLE.switch);
    expect(ev, 'the premise: the switch row was recorded').toBeDefined();
    expect(await catchUpBody(f.home, rec.notifyLog)).toBe(catchUpExpected(rec.notifyLog, rec.ring.map((e) =>
      ({ kind: e.kind, sessionId: e.sessionId, runId: e.runId, title: e.title, body: e.body, seq: e.seq, at: e.at }))));
  });

  it("through the collector's `coord` row (collectRecordCoordFeed): its key order", async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-latch-'));
    const f = await collectRig({ armed: true, coord: rec.coord, notifyLog: rec.notifyLog, push: rec.push });
    f.setVisible(() => true);
    await f.pass(); await f.settled();
    f.disarm();
    f.next(); await f.pass(); await f.settled();
    const ev = rec.ring.find((e) => e.title === COLLECT_SETTING_FEED_TITLE);
    expect(ev, 'the premise: the latch row was recorded').toBeDefined();
    expect(await catchUpBody(f.home, rec.notifyLog)).toBe(catchUpExpected(rec.notifyLog, rec.ring.map((e) =>
      ({ kind: e.kind, sessionId: e.sessionId, runId: e.runId, title: e.title, body: e.body, seq: e.seq, at: e.at }))));
  });

  it('a box with no coord.db: the interrupt is still recorded and served by catch-up', async () => {
    const home = mkTmp('ccrc-notice-nocoord-');
    const rec = await feedRecorder(home);
    recordInterrupt(interruptDeps({ notifyLog: rec.notifyLog }), A, 'keycap', 'sent');
    expect(rec.calls.filter((c) => c !== 'flush')).toEqual(['record']);
    expect(rec.archived).toEqual([]);
    const [ev] = rec.ring;
    expect(await catchUpBody(home, rec.notifyLog)).toBe(catchUpExpected(rec.notifyLog, [
      { kind: 'interrupt', sessionId: A, title: 'interrupt · keycap', body: interruptEventBody('keycap', 'sent'),
        runId: null, seq: 1, at: ev!.at },
    ]));
  });

  it('a box with no notify log: the interrupt archives nothing', async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-nolog-'));
    recordInterrupt(interruptDeps({ coord: rec.coord }), A, 'keycap', 'sent');
    expect(rec.calls).toEqual([]);
    expect(rec.archived).toEqual([]);
  });
});

// ─── PART 2: the funnel ──────────────────────────────────────────────────────────────────────────────────────────────

const sinks = (rec: FeedRecorder) => ({ notifyLog: rec.notifyLog, coord: rec.coord, push: rec.push, presence: rec.presence });
const EVENT: NoticeRecord = { kind: 'done', sessionId: A, title: 'done › project-a', body: 'finished', runId: null };

describe('notify: each mode over visible ∈ {true, false} equals pushOne\'s matching row (D-5857)', () => {
  const rows: readonly [NoticeMode, boolean, readonly string[], boolean][] = [
    ['push', false, ['record', 'archive', 'push'], true],
    ['push', true, [], false],
    ['record-always', false, ['record', 'archive', 'push'], true],
    ['record-always', true, ['record', 'archive'], true],
    ['record-only', false, ['record', 'archive'], true],
    ['record-only', true, ['record', 'archive'], true],
  ];
  it.each(rows)('%s, visible %s: %j', async (mode, visible, order, recorded) => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-mode-'));
    if (visible) rec.setVisible([A]);
    const out = notify(sinks(rec), EVENT, mode);
    expect(withoutFlush(rec.calls)).toEqual(order);
    if (recorded) expect(flushedAfterRecord(rec.calls), 'ring, archive, push: a flush after the ring record').toBe(true);
    else expect(rec.calls, 'nothing recorded: no flush either').toEqual([]);
    expect(out).toEqual({ recorded, archived: recorded ? 'landed' : 'none' });
    if (order.includes('push')) expect(rec.pushes).toEqual([{ title: EVENT.title, body: EVENT.body, sessionId: A, tag: `done-${A}` }]);
  });

  it("the push carries the caller's tag, actions and url, in pushOne's payload order", async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-opts-'));
    const actions = [{ action: 'a1', title: 'One' }];
    notify(sinks(rec), EVENT, 'push', { tag: 't-1', actions, url: '/digest' });
    expect(JSON.stringify(rec.pushes)).toBe(JSON.stringify([
      { title: EVENT.title, body: EVENT.body, sessionId: A, tag: 't-1', actions, url: '/digest' }]));
  });
});

describe('notify: a failed archive leaves the ring and the push (D-5857)', () => {
  it("a failed archive leaves the ring and the push, answers archived 'failed', and prints the caller's sentence", async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-fail-'));
    rec.archiveThrowsOn('every');
    const out = notify(sinks(rec), EVENT, 'push', { degraded: 'the writer\'s own sentence' });
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive', 'push']);
    expect(rec.ring).toHaveLength(1);
    expect(rec.pushes).toHaveLength(1);
    expect(out).toEqual({ recorded: true, archived: 'failed' });
    expect(rec.warned()).toEqual([degradeLine('the writer\'s own sentence')]);
  });

  it("with no sentence named, it prints pushOne's", async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-fail-default-'));
    rec.archiveThrowsOn('every');
    notify(sinks(rec), EVENT, 'record-only');
    expect(rec.warned()).toEqual([degradeLine(NOTICE_DEGRADED_DEFAULT)]);
    expect(NOTICE_DEGRADED_DEFAULT).toBe('feed archive degraded, ring/push unaffected');
  });
});

describe("notify: the caller's record reaches the ring unchanged (D-5857)", () => {
  it.each([
    ['pushOne\'s order', { kind: 'done', sessionId: A, title: 't', body: 'b', runId: null }],
    ['the hand pairs\' order', { kind: 'run', sessionId: A, runId: 7, title: 't', body: 'b' }],
  ] as const)('%s: the ring row and the archive row keep the caller\'s key order', async (_name, event) => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-keys-'));
    notify(sinks(rec), event as NoticeRecord, 'record-only');
    expect(Object.keys(rec.ring[0]!)).toEqual([...Object.keys(event), 'seq', 'at']);
    expect(rec.archived[0]).toBe(rec.ring[0]);
  });
});

describe('notify: the sinks are independently optional (D-5857)', () => {
  it('no ring, no archive row: with no notify log nothing is archived, and the push still goes', async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-nolog-unit-'));
    const out = notify({ coord: rec.coord, push: rec.push, presence: rec.presence }, EVENT, 'push');
    expect(rec.calls).toEqual(['push']);
    expect(rec.archived).toEqual([]);
    expect(out).toEqual({ recorded: false, archived: 'none' });
  });

  it("no coord.db: the ring records and flushes, the push goes, and the archive answers 'none'", async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-nocoord-unit-'));
    const out = notify({ notifyLog: rec.notifyLog, push: rec.push }, EVENT, 'push');
    expect(withoutFlush(rec.calls)).toEqual(['record', 'push']);
    expect(flushedAfterRecord(rec.calls)).toBe(true);
    expect(out).toEqual({ recorded: true, archived: 'none' });
  });

  it("'record-only' does not consult presence: it decides nothing there", async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-presence-'));
    const isVisible = vi.fn(() => true);
    notify({ ...sinks(rec), presence: { isVisible } }, EVENT, 'record-only');
    expect(isVisible).not.toHaveBeenCalled();
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
  });
});

// D-5859 (Task C1e; departure `funnel-batch-one-flush`): the dead-coordinator executor writes several rows in ONE try
// (spec K6: "stop-on-first-failed-row batch", kept), and its pin counts one flush per batch. `notifyEach` is that
// batch through the funnel: each row through the same gate, ring and guarded archive as `notify`, the batch stops at
// its first failed archive (the rows after it reach neither the ring nor the archive), the caller's sentence is
// printed once, and the ring is flushed once, after the records.
describe('notifyEach: a batch through the funnel, stopping at its first failed archive (D-5859)', () => {
  const ROWS: NoticeRecord[] = [1, 2, 3].map((n) => ({ kind: 'run', sessionId: A, runId: null, title: `row ${n}`, body: `b${n}` }));

  it('records and archives each row in order, one flush after the records, and never pushes in record-only', async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-each-'));
    rec.setVisible([]);
    expect(notifyEach(sinks(rec), ROWS, 'record-only', { degraded: 'batch degraded' }))
      .toEqual({ recorded: true, archived: 'landed' });
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive', 'record', 'archive', 'record', 'archive']);
    expect(rec.calls.filter((c) => c === 'flush')).toHaveLength(1);
    expect(rec.calls.at(-1)).toBe('flush');
    expect(rec.archived.map((e) => e.title)).toEqual(['row 1', 'row 2', 'row 3']);
    expect(rec.pushes).toEqual([]);
  });

  it('stops at the first failed archive: the row is in the ring only, the rows after it in neither, one sentence', async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-each-fail-'));
    rec.archiveThrowsOn(2);
    expect(notifyEach(sinks(rec), ROWS, 'record-only', { degraded: 'batch degraded' }))
      .toEqual({ recorded: true, archived: 'failed' });
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive', 'record', 'archive']);
    expect(rec.calls.filter((c) => c === 'flush')).toHaveLength(1);
    expect(rec.ring.map((e) => e.title)).toEqual(['row 1', 'row 2']);
    expect(rec.archived.map((e) => e.title)).toEqual(['row 1']);
    expect(rec.warned().filter((l) => l.includes('recordFeedEvent failed'))).toEqual([degradeLine('batch degraded')]);
  });

  it('each row takes the mode: push rows push unless visible, as notify does', async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-each-push-'));
    rec.setVisible([]);
    notifyEach(sinks(rec), ROWS.slice(0, 2), 'push');
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive', 'push', 'record', 'archive', 'push']);
    rec.setVisible([A]);
    const at = rec.mark();
    expect(notifyEach(sinks(rec), ROWS.slice(0, 2), 'push')).toEqual({ recorded: false, archived: 'none' });
    expect(rec.since(at)).toEqual([]);
  });

  it('no notify log: no ring, no archive row, no flush; an empty batch does nothing', async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-each-none-'));
    expect(notifyEach({ coord: rec.coord }, ROWS, 'record-only')).toEqual({ recorded: false, archived: 'none' });
    expect(notifyEach(sinks(rec), [], 'record-only')).toEqual({ recorded: false, archived: 'none' });
    expect(rec.calls).toEqual([]);
  });

  it('a batch carries no once-only key: a dedupeKey forced into its opts reaches no row (D-5860)', async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-each-nokey-'));
    notifyEach(sinks(rec), ROWS, 'record-only', { dedupeKey: 'k1' } as never);
    expect((rec.coord.db.prepare('SELECT dedupe_key AS k FROM feed_events').all() as { k: string | null }[]))
      .toEqual([{ k: null }, { k: null }, { k: null }]);
    expect(rec.coord.hasNotice('run', A, 'k1')).toBe(false);
  });
});

// D-5860 `notice-dedupe-key` (Task C1f; ARCH-55 #790): a notice's once-only key reaches the archive and nothing else.
// The archive refuses nothing and the funnel never suppresses the ring or the push on a key (O11 (a)): whether to raise
// a notice at all is the caller's `hasNotice` read, made before the write.
describe('notify: the once-only key reaches the archive and decides nothing (D-5860)', () => {
  it('opts.dedupeKey is archived beside the row, and hasNotice reads it back by kind, session and key', async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-key-'));
    expect(rec.coord.hasNotice('done', A, 'k1')).toBe(false);
    notify(sinks(rec), EVENT, 'record-only', { dedupeKey: 'k1' });
    expect(rec.coord.hasNotice('done', A, 'k1')).toBe(true);
    expect(rec.coord.hasNotice('done', A, 'k2')).toBe(false);
    expect(rec.coord.hasNotice('done', 'acct-a-project-b', 'k1')).toBe(false);
    expect(rec.coord.hasNotice('ask', A, 'k1')).toBe(false);
  });

  it('an archive refusal never suppresses the ring: a key already archived is recorded, archived and pushed again', async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-key-again-'));
    const first = notify(sinks(rec), EVENT, 'push', { dedupeKey: 'k1' });
    const again = notify(sinks(rec), EVENT, 'push', { dedupeKey: 'k1' });
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive', 'push', 'record', 'archive', 'push']);
    expect(rec.ring).toHaveLength(2);
    expect(rec.archived).toHaveLength(2);
    expect(rec.pushes).toHaveLength(2);
    expect([first, again]).toEqual([{ recorded: true, archived: 'landed' }, { recorded: true, archived: 'landed' }]);
  });

  it('a notice with no key archives a NULL key, which no key read matches', async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-nokey-'));
    notify(sinks(rec), EVENT, 'record-only');
    expect((rec.coord.db.prepare('SELECT dedupe_key AS k FROM feed_events').all() as { k: string | null }[]))
      .toEqual([{ k: null }]);
    expect(rec.coord.hasNotice('done', A, '')).toBe(false);
  });
});

describe('notifyPushOnly: a push with no ring record and no archive row (D-TBD-banner-funnel; ARCH-59 #794)', () => {
  const PAYLOAD = { title: 'Model classes', body: 'lane-a: opus moved', tag: 'models-advance:lane-a:opus', url: '/accounts' };

  it('sends the payload to the push service unchanged, and touches neither the ring nor the archive', async () => {
    const rec = await feedRecorder(mkTmp('ccrc-notice-pushonly-'));
    notifyPushOnly({ push: rec.push }, PAYLOAD, 'the push did not go out');
    expect(rec.calls).toEqual(['push']);
    expect(rec.pushes).toEqual([PAYLOAD]);
    expect(rec.ring).toEqual([]);
    expect(rec.archived).toEqual([]);
  });

  it('with no push service it does nothing, and does not throw', () => {
    expect(() => notifyPushOnly({}, PAYLOAD, 'the push did not go out')).not.toThrow();
  });

  it('a rejected push is logged under the caller\'s sentence, and never thrown or left unhandled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const push = { notify: vi.fn(async () => { throw new Error('store unwritable'); }) };
    notifyPushOnly({ push }, PAYLOAD, 'ccrc-server: /api/notify: the push did not go out');
    await vi.waitFor(() => expect(warn.mock.calls.flat().join(' '))
      .toContain('ccrc-server: /api/notify: the push did not go out (store unwritable)'));
  });
});
