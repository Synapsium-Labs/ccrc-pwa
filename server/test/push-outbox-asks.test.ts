// Overlord W1, the push outbox, Task 5 (plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md): an ask reaches
// the operator with its reach stamp and its one outbox row, written in the one transaction that moves it (I2). Three moves
// make an ask reach the operator: the mint at `released` (`insertAsk`), the lapse (`releaseAsk`) and the parent's
// release (`declineAsk`). Driven on a real `CoordStore` over a temp coord.db and the real questions owner
// (`createQuestions` with `questionOutboxOf`), with a recording push double and fake time. Neutral names (lane-a-project-a).
import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { heldFor } from '../src/coord/heldFor.js';
import { createQuestions, questionsTestView, type ClaimantDoorDeps, type QuestionOutbox, type QuestionPush, type Questions } from '../src/coord/questions.js';
import { insertBoundRowInTx } from '../src/coord/pushOutboxStore.js';
import { tx } from '../src/coord/tx.js';
import { questionOutboxOf } from '../src/notice.js';
import { noticePayload, noticeTitle } from '../src/pushOutbox.js';
import { outboxSettledOf, senderFor } from '../src/pushSender.js';
import { pushSeam, type PushSeam } from './pushSeam.js';
import { fakeTime, type FakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); removeTmpFixtures(); });

const NOW = 1_800_000_000_000;
const CHILD = 'lane-a-project-a';
const PARENT = 'lane-b-project-a';
const EV: QuestionPush = {
  kind: 'ask', sessionId: CHILD, project: 'project-a', title: 'Needs an answer', body: 'Proceed?',
  actions: [{ action: 'answer-0', title: 'Yes' }, { action: 'answer-1', title: 'No' }],
};

interface Rig {
  coord: CoordStore; questions: Questions; seam: PushSeam; ft: FakeTime; outbox: QuestionOutbox;
  deps: { coord: CoordStore; push?: PushSeam['push']; time: FakeTime['ports']; viewers: { isVisible: (id: string) => boolean } };
  /** The ring's `record`, when the rig was built with a ring (`log`). */
  record: Mock<(e: unknown) => unknown>;
}

/** A real store, the questions owner with its outbox (`questionOutboxOf`), and the double every push lands in. */
function rig(o: { service?: boolean; viewing?: readonly string[]; projects?: readonly string[]; log?: boolean } = {}): Rig {
  const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-outbox-asks-'), '.ccrc', 'coord.db')));
  const seam = pushSeam();
  const ft = fakeTime({ wallMs: NOW });
  const record = vi.fn((e: unknown) => ({ ...(e as object), seq: 1 }));
  const deps = { coord, ...(o.service === false ? {} : { push: seam.push }), time: ft.ports,
    viewers: { isVisible: (id: string): boolean => (o.viewing ?? []).includes(id) },
    ...(o.log === true ? { notifyLog: { epoch: 'epoch-a', record, flush: async (): Promise<void> => undefined } as never } : {}) };
  const projects = new Set(o.projects ?? ['project-a']);
  let questions!: Questions;
  const outbox = questionOutboxOf(deps, () => questions, () => projects);
  questions = createQuestions({ coord }, { heldFor, outbox });
  return { coord, questions, seam, ft, deps, outbox, record };
}

/** The lapse sweep with the watcher's push channel: a won lapse's bound row is sent through the outbox
 *  (`FleetWatcher`'s sink does the same), and `spy` sees every push the sweep hands its channel. */
const lapse = (r: Rig, at: number, spy: (ev: QuestionPush, bound?: unknown) => void = () => {}): void => {
  r.questions.lapseAsks(at, (ev, bound) => {
    spy(ev, bound);
    if (bound !== undefined) r.outbox.sent(ev, bound.askId, bound.row);
  });
};

let n = 0;
/** An ask row, `held`, as `insertAsk` writes one. */
const mint = (r: Rig, child = CHILD): number => {
  n += 1;
  return r.coord.insertAsk({ childId: child, parentId: PARENT, runId: null, askKey: `key-${n}`, askAt: NOW, dialogId: `dialog-${n}`,
    question: 'Proceed?', options: ['Yes', 'No'], now: NOW });
};
/** The hold `hold()` leaves for the ask, as the lapse sweep reads it. */
const plant = (r: Rig, askId: number, ev: QuestionPush = EV, until = NOW + 1_000): void => {
  questionsTestView(r.questions).plantHeldAsk(ev.sessionId, { until, askId, answeringSince: null, ev });
};
const holds = (r: Rig): number => questionsTestView(r.questions).heldAsks().size;

const outboxRows = (c: CoordStore): Record<string, unknown>[] =>
  c.db.prepare('SELECT id, pushId, sourceKind, sourceId, payload, tag, state, silentWhy, claimSeq FROM push_outbox ORDER BY id')
    .all() as Record<string, unknown>[];
const askCols = (c: CoordStore, id: number): { state: string; releasedAt: number | null; reachedOperatorAt: number | null } =>
  c.db.prepare('SELECT state, releasedAt, reachedOperatorAt FROM asks WHERE id = ?').get(id) as never;
const warnLines = (): (() => string[]) => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return () => warn.mock.calls.map((c) => String(c[0]));
};
/** What today's push carries for `ev`, built as `FleetWatcher.pushOne` builds it: the title rule, then the rest. */
const todaysPayload = (ev: QuestionPush, projects: ReadonlySet<string>): string => JSON.stringify(noticePayload(
  { kind: ev.kind, sessionId: ev.sessionId, title: noticeTitle(ev.title, ev.project, projects), body: ev.body },
  ev.actions === undefined ? {} : { actions: ev.actions }));
/** A bound write the store takes whole, with a valid tag (so it writes) or without one (so its insert throws). */
const boundOf = (o: { tag?: boolean; due?: 'now' | 'silent'; pushId?: string } = {}) => ({
  prepared: { payload: { title: 'Needs an answer', body: 'Proceed?', sessionId: CHILD, ...(o.tag === false ? {} : { tag: `ask-${CHILD}` }) },
    pushId: o.pushId ?? 'a'.repeat(32), service: true },
  due: o.due === 'silent' ? { due: 'silent' as const, why: 'viewing' as const } : { due: 'now' as const },
  viewing: o.due === 'silent',
});
const doorDeps = (r: Rig): ClaimantDoorDeps => ({ coord: r.coord }) as unknown as ClaimantDoorDeps;
const release = (r: Rig, id: number) => r.questions.release({ kind: 'ask', id, fromId: PARENT }, doorDeps(r));

describe('a lapse that wins writes the stamp, the row and the move together (I2)', () => {
  it('writes reachedOperatorAt, the one outbox row and the released state in one transaction', () => {
    const r = rig();
    const id = mint(r);
    const got = r.coord.releaseAsk(id, NOW + 5, boundOf());
    expect(got).toMatchObject({ id: expect.any(Number), due: { due: 'now' } });
    expect(askCols(r.coord, id)).toEqual({ state: 'released', releasedAt: NOW + 5, reachedOperatorAt: NOW + 5 });
    expect(outboxRows(r.coord)).toMatchObject([{ sourceKind: 'ask', sourceId: id, state: 'pending', tag: `ask-${CHILD}` }]);
  });

  it('a throw inside the transaction (a payload with no tag) lands none of the three', () => {
    const r = rig();
    const id = mint(r);
    expect(() => r.coord.releaseAsk(id, NOW + 5, boundOf({ tag: false }))).toThrow(/no tag/);
    expect(askCols(r.coord, id)).toEqual({ state: 'held', releasedAt: null, reachedOperatorAt: null });
    expect(outboxRows(r.coord)).toEqual([]);
  });

  it('a throw after the stamp (the source already has a row) rolls the stamp and the move back too', () => {
    const r = rig();
    const id = mint(r);
    tx(r.coord.db, () => insertBoundRowInTx(r.coord.db, { source: 'ask', sourceId: id, pushId: 'b'.repeat(32), state: 'silent',
      silentWhy: 'viewing', payload: null, at: NOW }));
    expect(() => r.coord.releaseAsk(id, NOW + 5, boundOf())).toThrow();
    expect(askCols(r.coord, id)).toEqual({ state: 'held', releasedAt: null, reachedOperatorAt: null });
    expect(outboxRows(r.coord)).toHaveLength(1);
  });
});

describe('a beaten lapse writes nothing', () => {
  it('an ask that is not held gets no row and no stamp, and the sweep sends no unbound push for an answered one', () => {
    const r = rig();
    const id = mint(r);
    r.coord.db.prepare("UPDATE asks SET state = 'answered' WHERE id = ?").run(id);
    expect(r.coord.releaseAsk(id, NOW + 5, boundOf())).toBe(false);
    plant(r, id);
    const push = vi.fn();
    lapse(r, NOW + 5_000, push);
    expect(push).not.toHaveBeenCalled();
    expect(outboxRows(r.coord)).toEqual([]);
    expect(askCols(r.coord, id).reachedOperatorAt).toBeNull();
    expect(r.seam.sent).toEqual([]);
  });

  it('a second lapse attempt on a released ask writes nothing', () => {
    const r = rig();
    const id = mint(r);
    plant(r, id);
    lapse(r, NOW + 5_000);
    const first = { cols: askCols(r.coord, id), rows: outboxRows(r.coord).map((x) => x.id) };
    expect(first.cols).toMatchObject({ state: 'released', reachedOperatorAt: NOW + 5_000 });
    expect(first.rows).toHaveLength(1);
    plant(r, id);
    const push = vi.fn();
    lapse(r, NOW + 9_000, push);
    expect(push).not.toHaveBeenCalled();
    expect(askCols(r.coord, id)).toEqual(first.cols);
    expect(outboxRows(r.coord).map((x) => x.id)).toEqual(first.rows);
    expect(r.coord.releaseAsk(id, NOW + 9_000, boundOf())).toBe(false);
  });
});

describe('the stamp equals releasedAt on all three moves (open question 6)', () => {
  it('the minted-released insert', () => {
    const r = rig();
    const bound = questionOutboxOf(r.deps, () => r.questions).prepare(EV);
    const { id, row } = r.coord.insertAsk({ childId: CHILD, parentId: PARENT, runId: null, askKey: 'k-mint', askAt: NOW,
      dialogId: 'd-mint', question: 'Proceed?', options: ['Yes'], now: NOW + 7, releaseReason: 'parent-not-live', bound });
    expect(row).not.toBeNull();
    const c = askCols(r.coord, id);
    expect(c).toEqual({ state: 'released', releasedAt: NOW + 7, reachedOperatorAt: NOW + 7 });
    expect(outboxRows(r.coord)).toMatchObject([{ sourceKind: 'ask', sourceId: id, state: 'pending' }]);
  });

  it('the lapse', () => {
    const r = rig();
    const id = mint(r);
    plant(r, id);
    lapse(r, NOW + 5_000);
    const c = askCols(r.coord, id);
    expect(c.releasedAt).toBe(NOW + 5_000);
    expect(c.reachedOperatorAt).toBe(c.releasedAt);
  });

  it('the decline (the parent hands the question over, through the release door)', async () => {
    const r = rig();
    const id = mint(r);
    plant(r, id);
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 3_000);
    const res = await release(r, id);
    expect(res).toMatchObject({ status: 200, body: { ok: true } });
    const c = askCols(r.coord, id);
    expect(c).toMatchObject({ state: 'declined', releasedAt: NOW + 3_000 });
    expect(c.reachedOperatorAt).toBe(c.releasedAt);
    expect(holds(r)).toBe(0);
    expect(r.seam.sent).toHaveLength(1);
  });
});

describe('the stored payload is the payload today\'s push carries, byte for byte', () => {
  it('a minted-released ask', () => {
    const r = rig();
    const bound = questionOutboxOf(r.deps, () => r.questions, () => new Set(['project-a'])).prepare(EV);
    const { id } = r.coord.insertAsk({ childId: CHILD, parentId: PARENT, runId: null, askKey: 'k-bytes', askAt: NOW,
      dialogId: 'd-bytes', question: 'Proceed?', options: ['Yes'], now: NOW, releaseReason: 'parent-not-live', bound });
    const [row] = outboxRows(r.coord);
    expect(row).toMatchObject({ sourceId: id, state: 'pending' });
    expect(row!.payload).toBe(todaysPayload(EV, new Set(['project-a'])));
    expect(JSON.parse(String(row!.payload))).toMatchObject({ title: 'Needs an answer', tag: `ask-${CHILD}`, sessionId: CHILD });
  });

  it('a lapsed ask with two active projects carries the project in its title, and the push is the stored text', () => {
    const projects = new Set(['project-a', 'project-b']);
    const r = rig({ projects: [...projects] });
    const id = mint(r);
    plant(r, id);
    lapse(r, NOW + 5_000);
    // Read before the verdict lands: the row is `sending`, its payload not yet nulled.
    const [row] = outboxRows(r.coord);
    expect(row).toMatchObject({ sourceId: id, state: 'sending' });
    expect(row!.payload).toBe(todaysPayload(EV, projects));
    expect(JSON.parse(String(row!.payload)).title).toBe('Needs an answer · project-a');
    expect(r.seam.sent.map((p) => JSON.stringify(p))).toEqual([todaysPayload(EV, projects)]);
  });
});

describe('presence', () => {
  it('a viewed session\'s ask gets a silent row, why viewing, and no push', () => {
    const r = rig({ viewing: [CHILD] });
    const id = mint(r);
    plant(r, id);
    lapse(r, NOW + 5_000);
    expect(askCols(r.coord, id)).toMatchObject({ state: 'released', reachedOperatorAt: NOW + 5_000 });
    expect(outboxRows(r.coord)).toMatchObject([{ sourceKind: 'ask', sourceId: id, state: 'silent', silentWhy: 'viewing' }]);
    expect(r.seam.sent).toEqual([]);
  });
});

describe('the release door', () => {
  it('keeps the in-memory hold when the decline loses, and writes no row', async () => {
    const r = rig();
    const id = mint(r);
    plant(r, id);
    expect(r.coord.releaseAsk(id, NOW + 1)).toBe(true);      // someone else moved it first
    const res = await release(r, id);
    expect(res).toMatchObject({ body: { ok: false, error: 'not-held' } });
    expect(holds(r)).toBe(1);
    expect(outboxRows(r.coord)).toEqual([]);
    expect(askCols(r.coord, id).reachedOperatorAt).toBeNull();
    expect(r.seam.sent).toEqual([]);
  });

  it('with no in-memory hold it writes the stamp and a silent no-payload row, and pushes nothing', async () => {
    const r = rig();
    const id = mint(r);
    const warned = warnLines();
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 4_000);
    const res = await release(r, id);
    expect(res).toMatchObject({ status: 200, body: { ok: true } });
    expect(askCols(r.coord, id)).toEqual({ state: 'declined', releasedAt: NOW + 4_000, reachedOperatorAt: NOW + 4_000 });
    expect(outboxRows(r.coord)).toMatchObject([{ sourceKind: 'ask', sourceId: id, state: 'silent', silentWhy: 'no-payload', payload: null }]);
    expect(r.seam.sent).toEqual([]);
    expect(warned().some((l) => l.includes('push was never fired'))).toBe(true);
  });
});

describe('with no push service', () => {
  it('a viewed session\'s ask writes no ring record and no feed row, as before the outbox; an unviewed one is recorded '
    + '(review 2150 F1)', () => {
    const viewed = rig({ service: false, viewing: [CHILD], log: true });
    const a = mint(viewed);
    plant(viewed, a);
    lapse(viewed, NOW + 5_000);
    expect(outboxRows(viewed.coord)).toMatchObject([{ sourceId: a, state: 'silent', silentWhy: 'no-service' }]);
    expect(viewed.record).not.toHaveBeenCalled();
    const unviewed = rig({ service: false, log: true });
    const b = mint(unviewed);
    plant(unviewed, b);
    lapse(unviewed, NOW + 5_000);
    expect(unviewed.record).toHaveBeenCalledTimes(1);
  });

  it('a lapse writes the stamp and one silent no-service row with a null payload, and sends nothing', () => {
    const r = rig({ service: false });
    const id = mint(r);
    plant(r, id);
    lapse(r, NOW + 5_000);
    expect(askCols(r.coord, id)).toMatchObject({ state: 'released', reachedOperatorAt: NOW + 5_000 });
    expect(outboxRows(r.coord)).toMatchObject([{ sourceKind: 'ask', sourceId: id, state: 'silent', silentWhy: 'no-service', payload: null, tag: null }]);
    expect(r.seam.sent).toEqual([]);
  });
});

describe('a bound insert that throws rolls the move back', () => {
  /** The ask's source already has a row, so the bound insert of the move throws on `push_outbox_one_per_source`. */
  const poison = (r: Rig, id: number): void => {
    tx(r.coord.db, () => insertBoundRowInTx(r.coord.db, { source: 'ask', sourceId: id, pushId: 'c'.repeat(32), state: 'silent',
      silentWhy: 'viewing', payload: null, at: NOW }));
  };

  it('the lapse keeps the hold, and two sweeps warn once', () => {
    const r = rig();
    const id = mint(r);
    plant(r, id);
    poison(r, id);
    const warned = warnLines();
    const push = vi.fn();
    lapse(r, NOW + 5_000, push);
    lapse(r, NOW + 15_000, push);
    expect(warned().filter((l) => l.includes('releaseAsk failed'))).toHaveLength(1);
    expect(holds(r)).toBe(1);
    expect(push).not.toHaveBeenCalled();
    expect(askCols(r.coord, id)).toEqual({ state: 'held', releasedAt: null, reachedOperatorAt: null });
    expect(r.seam.sent).toEqual([]);
  });

  it('the release door answers an internal refusal, with no unhandled throw and the hold kept', async () => {
    const r = rig();
    const id = mint(r);
    plant(r, id);
    poison(r, id);
    const res = await release(r, id);
    expect(res).toMatchObject({ body: { ok: false, error: 'internal' } });
    expect(askCols(r.coord, id)).toEqual({ state: 'held', releasedAt: null, reachedOperatorAt: null });
    expect(holds(r)).toBe(1);
  });
});

describe('a bound row whose ask was answered before the drain claims it', () => {
  it('goes silent, settled, and sends nothing; an unanswered one is sent', async () => {
    const r = rig();
    const answered = mint(r);
    const open = mint(r, 'lane-c-project-a');
    for (const id of [answered, open]) expect(r.coord.releaseAsk(id, NOW + 1, boundOf({ pushId: String(id).repeat(32).slice(0, 32) }))).not.toBe(false);
    expect(outboxRows(r.coord).map((x) => x.state)).toEqual(['pending', 'pending']);
    r.coord.db.prepare("UPDATE asks SET state = 'answered' WHERE id = ?").run(answered);
    const sender = senderFor({ push: r.seam.push, coord: r.coord, time: r.ft.ports });
    await sender.drain(NOW + 2, outboxSettledOf(r.questions, r.coord));
    await sender.idle();
    const rows = outboxRows(r.coord);
    expect(rows.find((x) => x.sourceId === answered)).toMatchObject({ state: 'silent', silentWhy: 'settled', payload: null });
    expect(rows.find((x) => x.sourceId === open)).toMatchObject({ state: 'sent' });
    expect(r.seam.sent).toHaveLength(1);
  });
});
