// D-5857 `notify-funnel` (plan docs/superpowers/plans/2026-10-19-consolidation-w1a-switches-notify.md, Task C1c;
// ARCH-54 (#789), first PR; spec K6). The notice funnel's own suite.
//
// PART 1, characterization (green on the code before the funnel): the catch-up response's bytes, filled through each
// writer outside `coord/` that this task moves, compared as `JSON.stringify` output so a writer's key order counts and a
// response that gains a field is red. `pushOne`'s and the operator-answer pair's byte rows sit beside their own rows in
// `feed-writers-pin.test.ts`; the interrupt writer's and the collector's two rows are here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordInterrupt } from '../src/interruptlog.js';
import { COLLECT_FEED_TITLE, COLLECT_SETTING_FEED_TITLE } from '../src/collectLane.js';
import { interruptEventBody } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { collectRig } from './collectLaneFixture.js';
import { catchUpBody, catchUpExpected, feedRecorder, interruptDeps } from './feedWriterFixture.js';

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
