// D-8125: the review-cap store (reviewCapStore.ts): the grant, the coordinator lift's one transaction and its journal.
// Fixture coord.db files only; neutral names (prog-a, lane-a).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { coordLiftsOf, liftReviewCapByCoordinator, raiseReviewCapAsk, reviewCapGate } from '../src/coord/reviewCapStore.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const mk = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-review-cap-store-'), '.ccrc', 'coord.db')));
const NOW = 1_800_000_000_000;
const REASON = 'F1 and F3 are real majors and round 3 closed two of five';

const workRun = (s: CoordStore, program = 'prog-a'): number =>
  (s.openRun({ program, title: 'A', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a' }) as { id: number }).id;
/** One more review round, finished (failed) so the next is not review-in-flight. */
const round = (s: CoordStore, workId: number): number => {
  const res = s.openRun({ program: 'prog-a', title: 'R', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a',
    kind: 'review', reviews: workId }) as { id: number };
  s.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(res.id);
  return res.id;
};
const rounds = (s: CoordStore, workId: number, n: number): void => { for (let i = 0; i < n; i++) round(s, workId); };
const count = (s: CoordStore, table: string): number =>
  Number((s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
const lift = (s: CoordStore, workRunId: number, over: Partial<Parameters<typeof liftReviewCapByCoordinator>[1]> = {}) =>
  liftReviewCapByCoordinator(s.db, { workRunId, byId: 'lane-a', reason: REASON, now: NOW, ...over });
const row = (s: CoordStore, id: number) =>
  s.db.prepare('SELECT askedAt, liftedAt, granted, askHandledAt FROM review_cap WHERE workRunId = ?').get(id) as
    { askedAt: number | null; liftedAt: number | null; granted: number | null; askHandledAt: number | null } | undefined;

describe('review cap store (D-8125)', () => {
  it('reviewCapGate on no row is not lifted and granted 0', () => {
    const s = mk(); const id = workRun(s);
    expect(reviewCapGate(s.db, id)).toEqual({ liftedAt: null, granted: 0 });
  });

  it('a lift at 3 rounds grants 3, journals one lift row and one run event', () => {
    const s = mk(); const id = workRun(s); rounds(s, id, 3);
    const events = count(s, 'run_events');
    const res = lift(s, id);
    expect(res).toMatchObject({ ok: true, rounds: 3, capBefore: 3, capAfter: 6, closedAskAt: null });
    expect(reviewCapGate(s.db, id)).toEqual({ liftedAt: null, granted: 3 });
    expect(s.db.prepare('SELECT workRunId, at, byId, reason, rounds, capBefore, capAfter, closedAskAt FROM review_cap_lifts').all())
      .toEqual([{ workRunId: id, at: NOW, byId: 'lane-a', reason: REASON, rounds: 3, capBefore: 3, capAfter: 6, closedAskAt: null }]);
    expect(count(s, 'run_events')).toBe(events + 1);
    const ev = s.db.prepare('SELECT detail, causedBy FROM run_events WHERE runId = ? ORDER BY id DESC LIMIT 1').get(id) as { detail: string; causedBy: string };
    expect(ev.causedBy).toBe('lane-a');
    expect(ev.detail.startsWith('coord-lift: rounds 3, cap 3 -> 6:')).toBe(true);
  });

  it('a second lift at the same cap is cap-not-reached and writes nothing (R9)', () => {
    const s = mk(); const id = workRun(s); rounds(s, id, 3);
    expect(lift(s, id).ok).toBe(true);
    const lifts = count(s, 'review_cap_lifts'); const events = count(s, 'run_events');
    expect(lift(s, id)).toMatchObject({ ok: false, refused: 'cap-not-reached' });
    expect(count(s, 'review_cap_lifts')).toBe(lifts);
    expect(count(s, 'run_events')).toBe(events);
    expect(reviewCapGate(s.db, id).granted).toBe(3);
  });

  it('after three more rounds a lift grants again: cap 6 to 9, two lift rows (R4)', () => {
    const s = mk(); const id = workRun(s); rounds(s, id, 3);
    lift(s, id); rounds(s, id, 3);
    expect(lift(s, id)).toMatchObject({ ok: true, rounds: 6, capBefore: 6, capAfter: 9 });
    expect(reviewCapGate(s.db, id).granted).toBe(6);
    expect(count(s, 'review_cap_lifts')).toBe(2);
    const m = coordLiftsOf(s.db, [id]).get(id)!;
    expect(m.count).toBe(2);
    expect(m.last).toMatchObject({ by: 'lane-a', reason: REASON, rounds: 6, capBefore: 6, capAfter: 9, count: 2 });
  });

  it('coordLiftsOf has no entry for a run with no lift, and no statement for no ids', () => {
    const s = mk(); const id = workRun(s);
    expect(coordLiftsOf(s.db, [id]).size).toBe(0);
    expect(coordLiftsOf(s.db, []).size).toBe(0);
  });

  it('an operator-lifted run is cap-not-reached and its grant is unchanged', () => {
    const s = mk(); const id = workRun(s); rounds(s, id, 3);
    expect(s.liftReviewCap(id, NOW)).toBe(true);
    expect(lift(s, id)).toMatchObject({ ok: false, refused: 'cap-not-reached' });
    expect(reviewCapGate(s.db, id)).toEqual({ liftedAt: NOW, granted: 0 });
  });

  it('a lift needs no setting: there is none to turn it off (D-8165)', () => {
    const s = mk(); const id = workRun(s); rounds(s, id, 3);
    expect(lift(s, id)).toMatchObject({ ok: true });
    expect(count(s, 'review_cap_lifts')).toBe(1);
  });

  it('a closed work run is run-closed; a review run is not-found; an unknown id is not-found', () => {
    const s = mk(); const id = workRun(s); const review = round(s, id); rounds(s, id, 2);
    expect(lift(s, review)).toMatchObject({ ok: false, refused: 'not-found' });
    expect(lift(s, 987654)).toMatchObject({ ok: false, refused: 'not-found' });
    s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(id);
    expect(lift(s, id)).toMatchObject({ ok: false, refused: 'run-closed' });
  });

  it('with an open ask the lift marks it handled and journals the ask time; without one it leaves both null', () => {
    const s = mk(); const id = workRun(s); rounds(s, id, 3);
    expect(raiseReviewCapAsk(s.db, id, NOW - 5)).toBe(true);
    const res = lift(s, id);
    expect(res).toMatchObject({ ok: true, closedAskAt: NOW - 5 });
    expect(row(s, id)!.askHandledAt).toBe(NOW);
    const other = workRun(s, 'prog-b'); rounds(s, other, 3);
    const res2 = lift(s, other);
    expect(res2).toMatchObject({ ok: true, closedAskAt: null });
    expect(row(s, other)!.askHandledAt).toBeNull();
  });

  it('raiseReviewCapAsk is once per cap level: true, false while open, true again after a coordinator lift (R4)', () => {
    const s = mk(); const id = workRun(s); rounds(s, id, 3);
    expect(raiseReviewCapAsk(s.db, id, 100)).toBe(true);
    expect(raiseReviewCapAsk(s.db, id, 200)).toBe(false);
    lift(s, id); rounds(s, id, 3);
    expect(raiseReviewCapAsk(s.db, id, 300)).toBe(true);
    expect(row(s, id)).toMatchObject({ askedAt: 300, askHandledAt: null });
    expect(raiseReviewCapAsk(s.db, id, 400)).toBe(false);
  });

  it('the lift writes no operator item and never clears askedAt or sets liftedAt (R6, R7)', () => {
    const s = mk(); const id = workRun(s); rounds(s, id, 3);
    raiseReviewCapAsk(s.db, id, 100);
    const items = count(s, 'operator_items'); const itemEvents = count(s, 'operator_item_events');
    lift(s, id);
    expect(count(s, 'operator_items')).toBe(items);
    expect(count(s, 'operator_item_events')).toBe(itemEvents);
    expect(row(s, id)).toMatchObject({ askedAt: 100, liftedAt: null });
  });

  it('openRun: the 4th review opens after a coordinator lift and the 7th is refused by 6', () => {
    const s = mk(); const id = workRun(s); rounds(s, id, 3);
    const open = () => s.openRun({ program: 'prog-a', title: 'R', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a',
      kind: 'review', reviews: id });
    expect(open()).toMatchObject({ refused: 'cap-review-rounds', by: '3' });
    lift(s, id);
    const r4 = open() as { id: number };
    expect(r4.id).toBeGreaterThan(0);
    s.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(r4.id);
    rounds(s, id, 2);
    expect(open()).toMatchObject({ refused: 'cap-review-rounds', by: '6' });
  });

  it('reviewCapStates carries granted, askHandledAt and the last lift', () => {
    const s = mk(); const id = workRun(s); rounds(s, id, 3);
    raiseReviewCapAsk(s.db, id, 100); lift(s, id);
    const st = s.reviewCapStates([id]).get(id)!;
    expect(st).toMatchObject({ rounds: 3, askedAt: 100, liftedAt: null, granted: 3, askHandledAt: NOW });
    expect(st.coordLift).toMatchObject({ by: 'lane-a', reason: REASON, capBefore: 3, capAfter: 6, count: 1 });
  });
});
