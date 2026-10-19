// S10a (D-5473, D-5497): the status grouping and the needs-you reason, as a
// pure model. `groupByStatus` reads the server's `bucket` and `sortFleet`'s
// order; `needsReason` reads only fields `FleetSession` carries. The unseen
// case runs one fixture through this model and through `BucketBar` itself, so
// the two counts are compared on what the operator would see, not on a copy
// of BucketBar's rule.
import { describe, it, expect, expectTypeOf, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, cleanup } from '@testing-library/react';
import type { FleetSession, SessionBucket } from '../../shared/api';
import { groupByStatus, needsReason, STATUS_GROUPS } from '../src/fleet/statusGroups';
import { BUCKET_ORDER, sortFleet } from '../src/fleet/sortFleet';
import { BucketBar } from '../src/fleet/BucketBar';
import type { Acks } from '../src/lib/seen';
import { fleetSession } from './fleetFixture';

const s = (over: Partial<FleetSession>): FleetSession =>
  fleetSession({ id: 'x', wrapper: 'claude9', home: 'claude9', project: 'p', workdir: '/p', statusUpdatedAt: 0, ...over });

afterEach(cleanup);

describe('groupByStatus (D-5473)', () => {
  it('groups in the fixed order, the last four folding', () => {
    const g = groupByStatus([], {});
    expect(g.map((x) => x.bucket)).toEqual(['attention', 'working', 'done', 'idle', 'cleanup', 'archived', 'dead']);
    expect(g.map((x) => x.label)).toEqual(['Needs you', 'Working', 'Done', 'Idle', 'Cleanup', 'Archived', 'Dead']);
    expect(g.map((x) => x.folds)).toEqual([false, false, false, true, true, true, true]);
    // An empty group is kept, with a count of 0: the view decides.
    expect(g.every((x) => x.sessions.length === 0 && x.unseen === 0)).toBe(true);
  });

  it('a dead session still dialogPending is in Dead, not Needs you', () => {
    const killed = s({ id: 'k', status: 'dead', dialogPending: true, hookState: 'waiting', bucket: 'dead' });
    const g = groupByStatus([killed], {});
    expect(g.find((x) => x.bucket === 'attention')!.sessions).toEqual([]);
    expect(g.find((x) => x.bucket === 'dead')!.sessions.map((x) => x.id)).toEqual(['k']);
  });

  it("rows keep sortFleet's order within a group", () => {
    // sortFleet orders by statusUpdatedAt desc, then id. The names run the
    // other way, so an alphabetical (title or id) sort is a different order.
    const rows = [
      s({ id: 'a', name: 'alpha', bucket: 'working', statusUpdatedAt: 100 }),
      s({ id: 'c', name: 'charlie', bucket: 'working', statusUpdatedAt: 300 }),
      s({ id: 'b', name: 'bravo', bucket: 'working', statusUpdatedAt: 200 }),
      s({ id: 'q', name: 'quebec', bucket: 'attention', statusUpdatedAt: 5 }),
      s({ id: 'p', name: 'papa', bucket: 'attention', statusUpdatedAt: 9 }),
    ];
    const g = groupByStatus(rows, {});
    for (const group of g) {
      const expected = sortFleet(rows).filter((x) => x.bucket === group.bucket).map((x) => x.id);
      expect(group.sessions.map((x) => x.id)).toEqual(expected);
    }
    expect(g.find((x) => x.bucket === 'working')!.sessions.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  it('every SessionBucket has a group and a label', () => {
    // The compiler's half: the record is keyed by exactly SessionBucket.
    expectTypeOf<keyof typeof STATUS_GROUPS>().toEqualTypeOf<SessionBucket>();
    // The runtime half, against sortFleet's `RANK`-derived list (itself a
    // `Record<SessionBucket, …>`), never a list typed a second time here.
    expect(Object.keys(STATUS_GROUPS).sort()).toEqual([...BUCKET_ORDER].sort());
    const g = groupByStatus([], {});
    expect(g.map((x) => x.bucket).sort()).toEqual([...BUCKET_ORDER].sort());
    for (const x of g) expect(x.label.trim()).not.toBe('');
  });

  it("each group's unseen count equals BucketBar's for its bucket", () => {
    const fleet = [
      s({ id: 'att-new', bucket: 'attention', bucketSince: 500 }),
      s({ id: 'att-seen', bucket: 'attention', bucketSince: 100 }),
      s({ id: 'done-new', bucket: 'done', bucketSince: 400 }),
      s({ id: 'work-new', bucket: 'working', bucketSince: 400 }),
      // Never acked and dated: `isUnseenAt` alone would count it; the BADGED
      // precondition in `isUnseen` does not.
      s({ id: 'idle-never', bucket: 'idle', bucketSince: 300 }),
      s({ id: 'clean-new', bucket: 'cleanup', status: 'dead', archivedAt: 1, bucketSince: 700 }),
      s({ id: 'dead-new', bucket: 'dead', status: 'dead', bucketSince: 600 }),
    ];
    const acks: Acks = { 'att-seen': 200 };
    const g = groupByStatus(fleet, acks);

    const { container } = render(createElement(BucketBar, { sessions: fleet, acks, ackAll: () => {} }));
    const heads = [...container.querySelectorAll('.bucket-head')];
    const shown = BUCKET_ORDER.filter((b) => fleet.some((x) => x.bucket === b));
    expect(heads).toHaveLength(shown.length);
    const barUnseen = new Map<SessionBucket, number>();
    heads.forEach((head, i) => {
      const badge = head.querySelector('.bucket-head-unseen');
      barUnseen.set(shown[i]!, badge === null ? 0 : Number(badge.textContent));
    });

    for (const group of g) expect(group.unseen).toBe(barUnseen.get(group.bucket) ?? 0);
    expect(g.find((x) => x.bucket === 'idle')!.unseen).toBe(0);
    expect(g.find((x) => x.bucket === 'attention')!.unseen).toBe(1);
  });
});

describe('needsReason (D-5473, D-5497)', () => {
  const attention = (over: Partial<FleetSession>): FleetSession =>
    s({ id: 'n', bucket: 'attention', status: 'busy', dialogPending: true, hookState: 'waiting', ...over });

  it('needsReason reads ask and fault from their fields, never allow or sign-in that no field carries (D-5497), and null for an attention session no field explains', () => {
    // fault: the supervisor's standing substrate fault.
    expect(needsReason(attention({ substrate: { at: 1, text: 'tmux answered neither live nor gone' } }))).toBe('fault');
    // An unreadable marker is still a fault (`substrateFault`'s `at: 0` arm).
    expect(needsReason(attention({ substrate: { at: 0, text: '' } }))).toBe('fault');
    // ask: a held row on the ask lane, which only questions mint today.
    expect(needsReason(attention({ ask: { state: 'held', parentId: 'p-coord', answeredBy: null } }))).toBe('ask');
    expect(needsReason(attention({ ask: { state: 'answering', parentId: 'p-coord', answeredBy: null } }))).toBe('ask');
    // A malformed ask (cast, not checked, off the live frame) goes through the
    // single reader `sessionAsk`, which rejects it: no reason, never 'ask'.
    expect(needsReason(attention({ ask: { state: 'held', parentId: '', answeredBy: null } }))).toBeNull();
    expect(needsReason(attention({
      ask: { state: 'bogus', parentId: 'p-coord', answeredBy: null } as unknown as FleetSession['ask'],
    }))).toBeNull();
    // A fault outranks the ask: the console cannot re-measure the row.
    expect(needsReason(attention({
      substrate: { at: 1, text: 'x' }, ask: { state: 'held', parentId: 'p-coord', answeredBy: null },
    }))).toBe('fault');

    // No field tells a question from a permission prompt on an attention row,
    // and none carries sign-in, so these answer null, never a guess.
    expect(needsReason(attention({}))).toBeNull();
    expect(needsReason(attention({ askSummary: 'Bash: rm -rf build' }))).toBeNull();
    expect(needsReason(attention({ askSummary: 'Which branch?' }))).toBeNull();
    expect(needsReason(attention({ hookState: null, askSummary: 'sandbox request' }))).toBeNull();
    // An answered ask explains a ruling already made, not the open dialog.
    expect(needsReason(attention({ ask: { state: 'answered', parentId: 'p-coord', answeredBy: 'p-coord' } }))).toBeNull();
    // A live frame from an older server omits the keys (it is cast, not revived).
    const { substrate: _substrate, ask: _ask, ...older } = attention({});
    expect(needsReason(older as FleetSession)).toBeNull();
  });

  it('a session outside Needs you has no reason, whatever its fields say', () => {
    expect(needsReason(s({ bucket: 'working', substrate: { at: 1, text: 'x' } }))).toBeNull();
    expect(needsReason(s({ bucket: 'dead', status: 'dead', dialogPending: true, ask: { state: 'held', parentId: 'p', answeredBy: null } }))).toBeNull();
    expect(needsReason(s({
      bucket: 'working', withCoordinator: { kind: 'approval', parentId: 'p-coord', since: 1, notifyAt: 2 },
    }))).toBeNull();
  });
});
