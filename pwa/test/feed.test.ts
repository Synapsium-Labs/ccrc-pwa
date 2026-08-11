// The durable feed's client half: degrade an unknown kind, never fabricate an
// event, never silently lose one, and merge two sources by seq.
//
// `NotifyEvent` has no `runId` (PR I reconciliation, item 2 — a feed row
// cannot link back to its run without a second lookup) and its per-field
// revival already has ONE implementation, `reviveNotifyEvent` (shared/api.ts).
// `reviveNotifyEvents` here is a caller of it, not a second copy — so a field
// of the wrong type rejects the WHOLE event (that function's own contract),
// never degrades in place.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FEED_CAP, mergeBySeq, reviveNotifyEvents } from '../src/lib/feed';
import type { NotifyEvent } from '../../shared/api';

const e = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  seq: 1, at: 1_000, kind: 'mail', sessionId: 'cc-a', title: 't', body: 'b', ...over,
});

describe('reviveNotifyEvents', () => {
  it('delegates to the shared reviveNotifyEvent rather than re-implementing field validation', () => {
    // Structural, same idiom as seen.test.ts's isUnseen/isUnseenAt check: the
    // point is that there is ONE NotifyEvent revival function in the tree.
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'feed.ts'), 'utf8');
    expect(src).toContain('reviveNotifyEvent(');
  });

  it('keeps a known kind exactly as it arrived', () => {
    const { events, dropped } = reviveNotifyEvents([e({ kind: 'run' })]);
    expect(events).toEqual([e({ kind: 'run' })]);
    expect(dropped).toBe(0);
  });

  it('lands a kind from a NEWER build on `unknown` rather than typing it as something it is not', () => {
    // shared/api.ts's isNotifyKind: a kind this build does not recognise
    // becomes the client-side we-do-not-know member, not a fourth event
    // dropped or mistyped as one of the three it is not.
    const { events, dropped } = reviveNotifyEvents([{ ...e(), kind: 'ritual-sacrifice' }]);
    expect(dropped).toBe(0);
    expect(events[0]!.kind).toBe('unknown');
    expect(events[0]!.title).toBe('t');
    expect(events[0]!.body).toBe('b');
  });

  it('drops — and COUNTS — an event with no place in the order', () => {
    // seq and at are the identity and the ordering. Nothing can invent them,
    // so the event is dropped and the count is surfaced. A feed that loses a
    // record silently is the failure this whole surface exists to prevent.
    const { events, dropped } = reviveNotifyEvents([e(), { at: 3_000, kind: 'mail' }, e({ seq: 4 })]);
    expect(events.map((x) => x.seq)).toEqual([1, 4]);
    expect(dropped).toBe(1);
  });

  it('answers empty for a body that is not an array at all', () => {
    expect(reviveNotifyEvents(null)).toEqual({ events: [], dropped: 0 });
    expect(reviveNotifyEvents({ events: [] })).toEqual({ events: [], dropped: 0 });
  });

  it('drops — and counts — a record whose title/body is the wrong type', () => {
    // reviveNotifyEvent rejects the WHOLE event on any field of the wrong
    // type (its own documented contract) — it does not degrade a bad title
    // or body to '' in place. A half-trusted record is not a truthful one.
    const { events, dropped } = reviveNotifyEvents(
      [{ seq: 9, at: 9, kind: 'mail', sessionId: 'cc-a', title: 7, body: null }],
    );
    expect(dropped).toBe(1);
    expect(events).toEqual([]);
  });
});

describe('mergeBySeq', () => {
  it('unions two sources on seq, newest last, with no duplicates', () => {
    const durable = [e({ seq: 1 }), e({ seq: 2 })];
    const live = [e({ seq: 2 }), e({ seq: 3 })];
    expect(mergeBySeq(durable, live).map((x) => x.seq)).toEqual([1, 2, 3]);
  });

  it('lets the LATER source win a seq collision — a re-read is fresher than a cached copy', () => {
    expect(mergeBySeq([e({ seq: 1, title: 'old' })], [e({ seq: 1, title: 'new' })])[0]!.title).toBe('new');
  });

  it('caps the list from the OLD end, so the newest record is never the one dropped', () => {
    const many = Array.from({ length: FEED_CAP + 10 }, (_, i) => e({ seq: i + 1 }));
    const out = mergeBySeq([], many);
    expect(out).toHaveLength(FEED_CAP);
    expect(out.at(-1)!.seq).toBe(FEED_CAP + 10);
  });

  // `seq` is unique only WITHIN one NotifyLog epoch (`server/src/coord/
  // schema.ts`'s `feed_events` comment, verbatim) — the server mints a fresh
  // epoch and resets seq to 0 whenever ~/.ccrc/notify-log.json is missing,
  // unreadable or malformed, a designed-for restart path. Two records from
  // different epochs can carry the same seq, and must never collapse into one.
  it('does NOT collapse two different epochs whose seq both start at 1 — seq alone is not a record\'s identity', () => {
    const preRotation = [e({ seq: 1, at: 1_000, title: 'before the restart' })];
    const postRotation = [e({ seq: 1, at: 9_000, title: 'after the restart' })];
    const out = mergeBySeq(preRotation, postRotation);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.title)).toEqual(['before the restart', 'after the restart']);
  });

  it('orders by `at`, not by the `seq` that resets on rotation — a low post-rotation seq never jumps ahead of a high pre-rotation one', () => {
    const durable = [e({ seq: 50, at: 1_000 })];   // late in the old epoch
    const live = [e({ seq: 1, at: 9_000 })];        // seq just reset, but later in real time
    expect(mergeBySeq(durable, live).map((x) => x.at)).toEqual([1_000, 9_000]);
  });

  it('still dedupes the SAME record seen twice — identical at AND seq, from two sources', () => {
    const durable = [e({ seq: 3, at: 3_000, title: 'from GET /api/feed' })];
    const live = [e({ seq: 3, at: 3_000, title: 'same record, from catch-up' })];
    const out = mergeBySeq(durable, live);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('same record, from catch-up'); // later source wins
  });
});
