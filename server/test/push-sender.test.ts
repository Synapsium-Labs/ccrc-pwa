// Overlord W1, the push outbox, Task 4 (plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md): the ONE
// sender (`server/src/pushSender.ts`). An unbound push is written claimed and sent at once, a bound row is re-read,
// claimed and sent, each verdict lands only on the claim it answers, and the boot pass seals what a dead process left.
// The store is a real `CoordStore` over a temp coord.db and the time is `fakeTime`, so no case waits on a real timer.
import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { tx } from '../src/coord/tx.js';
import { raiseItem } from '../src/coord/ledgersStore.js';
import { armBoundRowInTx, insertBoundRowInTx, type OutboxPayload } from '../src/coord/pushOutboxStore.js';
import { SHAPE_ONLY_MASKER } from '../src/accounts/mask.js';
import { notifyPushOnly } from '../src/notice.js';
import { bootPushOutbox, senderFor, type SettledOf } from '../src/pushSender.js';
import type { PushPayload } from '../src/push.js';
import { OUTBOX_RETRY_HORIZON_MS, OUTBOX_SEND_DEADLINE_MS, type PushSendVerdict } from '../../shared/push-outbox.js';
import { fakeTime, type FakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { quietAtTestEnd } from './laneQuiet.js';   // D-8140: nothing a watcher fires outlives its test

afterEach(() => { vi.restoreAllMocks(); removeTmpFixtures(); });

const PAYLOAD: OutboxPayload = { title: 'Waiting on you', body: 'Pick one', sessionId: '', tag: 'item-1', url: '/waiting' };
const ACCEPTED: PushSendVerdict = { kind: 'sent', subs: [{ endpointHash: 'h', verdict: 'accepted', status: 201 }] };
const REFUSED: PushSendVerdict = { kind: 'sent', subs: [{ endpointHash: 'h', verdict: 'refused', status: 429 }] };
const NO_SUB: PushSendVerdict = { kind: 'no-subscription' };
const OPEN: SettledOf = () => ({ settled: false, blocking: true });

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-sender-'), '.ccrc', 'coord.db')));
const raw = (s: CoordStore): Record<string, unknown>[] =>
  s.db.prepare('SELECT id, pushId, sourceKind, sourceId, payload, state, armedAt, claimSeq, attempts, nextAttemptAt, pushedAt, '
    + 'verdict, silentWhy, settledAt FROM push_outbox ORDER BY id').all() as Record<string, unknown>[];
const stateOf = (s: CoordStore, id = 1): unknown => raw(s).find((r) => r.id === id)?.state;

interface Deferred { readonly promise: Promise<unknown>; resolve(v: unknown): void; reject(e: unknown): void }
function deferred(): Deferred {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A recording push double: each call answers the next scripted answer (a value, or a function of the payload) and the
 *  last one repeats. */
function double(...script: (unknown | ((p: PushPayload) => Promise<unknown>))[]): {
  readonly push: { notify: Mock<(p: PushPayload) => Promise<unknown>> }; readonly sent: PushPayload[];
} {
  const sent: PushPayload[] = [];
  let i = 0;
  const notify = vi.fn<(p: PushPayload) => Promise<unknown>>((p) => {
    sent.push(p);
    const a = script[Math.min(i, script.length - 1)];
    i += 1;
    return typeof a === 'function' ? (a as (p: PushPayload) => Promise<unknown>)(p) : Promise.resolve(a);
  });
  return { push: { notify }, sent };
}

interface Rig { readonly coord: CoordStore; readonly ft: FakeTime; readonly now: () => number }
const rig = (): Rig => {
  const ft = fakeTime();
  return { coord: store(), ft, now: () => ft.ports.clock.wall() };
};
const deps = (r: Rig, push: { notify: unknown } | undefined) =>
  ({ push: push as { notify(p: PushPayload): Promise<unknown> } | undefined, coord: r.coord, time: r.ft.ports });
/** A `pending` bound row for an item source, written as a raising move writes one. */
const bound = (r: Rig, sourceId = 1, at = r.now(), payload: OutboxPayload = PAYLOAD): number =>
  tx(r.coord.db, () => insertBoundRowInTx(r.coord.db, { source: 'item', sourceId, pushId: `p${String(sourceId).padStart(31, '0')}`,
    payload, state: 'pending', at }));
const item = (r: Rig, over: { heldUntil?: number | null } = {}): number =>
  raiseItem(r.coord.db, { program: 'prog-a', runId: null, raisedBy: 'lane-b-project-a', kind: 'do', title: 'Do it', why: 'because',
    how: ['step'], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null, heldUntil: over.heldUntil ?? null }, r.now());

describe('the sender: an unbound push through its row', () => {
  it('writes one row at sending, and the verdict makes it sent with pushedAt and its verdict', async () => {
    const r = rig();
    const d = deferred();
    const { push } = double(() => d.promise);
    const sender = senderFor(deps(r, push));
    sender.send({ title: 'T', body: 'B', tag: 'x' });
    expect(raw(r.coord)).toHaveLength(1);
    expect(stateOf(r.coord)).toBe('sending');
    d.resolve(ACCEPTED);
    await sender.idle();
    expect(raw(r.coord)[0]).toMatchObject({ state: 'sent', pushedAt: r.now(), payload: null,
      verdict: JSON.stringify(ACCEPTED), attempts: 1 });
  });

  it('with no subscription the row ends unsent', async () => {
    const r = rig();
    const { push } = double(NO_SUB);
    const sender = senderFor(deps(r, push));
    sender.send({ title: 'T', body: 'B', tag: 'x' });
    await sender.idle();
    expect(stateOf(r.coord)).toBe('unsent');
  });

  it('a double that resolves undefined leaves its row unknown', async () => {
    const r = rig();
    const { push } = double(undefined);
    const sender = senderFor(deps(r, push));
    sender.send({ title: 'T', body: 'B', tag: 'x' });
    await sender.idle();
    expect(raw(r.coord)[0]).toMatchObject({ state: 'unknown', verdict: null });
  });

  it('a double that answers no promise at all (a bare mock) is read as no verdict: no throw, its row unknown', async () => {
    const r = rig();
    const notify = vi.fn(() => undefined);
    const sender = senderFor(deps(r, { notify }));
    expect(() => { sender.send({ title: 'T', body: 'B', tag: 'x' }); }).not.toThrow();
    await sender.idle();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(raw(r.coord)[0]).toMatchObject({ state: 'unknown', verdict: null });
  });

  it('a send that never answers ends unknown when the deadline passes', async () => {
    const r = rig();
    const { push } = double(() => new Promise(() => undefined));
    const sender = senderFor(deps(r, push));
    sender.send({ title: 'T', body: 'B', tag: 'x' });
    r.ft.advance(OUTBOX_SEND_DEADLINE_MS - 1);
    expect(stateOf(r.coord)).toBe('sending');
    r.ft.advance(1);
    await sender.idle();
    expect(stateOf(r.coord)).toBe('unknown');
  });

  it('a verdict that lands first cancels the deadline timer: passing it changes nothing', async () => {
    const r = rig();
    const { push } = double(ACCEPTED);
    const sender = senderFor(deps(r, push));
    sender.send({ title: 'T', body: 'B', tag: 'x' });
    expect(r.ft.pending()).toBe(1);
    await sender.idle();
    expect(r.ft.pending()).toBe(0);
    r.ft.advance(OUTBOX_SEND_DEADLINE_MS * 2);
    expect(stateOf(r.coord)).toBe('sent');
  });

  it('a stored payload is the bytes notify received, and masking is idempotent', async () => {
    const r = rig();
    const { push: bare, sent } = double(() => new Promise(() => undefined));
    const push = Object.assign(bare, { payloadMasker: SHAPE_ONLY_MASKER });   // as a `PushService` is built
    const sender = senderFor(deps(r, push));
    const key = `sk-ant-${'api03'}-${'Ab3dE5gH7jK9mN1pQ3sT5vW7yZ'}`;
    sender.send({ title: 'T', body: `token ${key} done`, tag: 'x', sessionId: 'lane-a-project-a' });
    const open = r.coord.openOutboxRows();
    if (!open.ok) throw new Error(open.detail);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(open.rows[0]!.payload)).toBe(JSON.stringify(sent[0]));
    expect(JSON.stringify(sent[0])).not.toContain(key);
    const once = SHAPE_ONLY_MASKER.maskDeep({ title: 'T', body: `token ${key} done`, tag: 'x' });
    expect(SHAPE_ONLY_MASKER.maskDeep(once)).toEqual(once);
  });
});

describe('the sender: a bound row', () => {
  it('three refusals then an accept: sent after the 4th attempt, backing off 30 s and doubling', async () => {
    const r = rig();
    const { push } = double(REFUSED, REFUSED, REFUSED, ACCEPTED);
    const sender = senderFor(deps(r, push));
    const id = bound(r);
    const t0 = r.now();
    await sender.drain(r.now(), OPEN);
    expect(push.notify).toHaveBeenCalledTimes(1);
    expect(raw(r.coord)[0]).toMatchObject({ state: 'retrying', nextAttemptAt: t0 + 30_000, attempts: 1 });
    r.ft.advance(29_999);
    await sender.drain(r.now(), OPEN);
    expect(push.notify).toHaveBeenCalledTimes(1);
    r.ft.advance(1);
    await sender.drain(r.now(), OPEN);
    expect(raw(r.coord)[0]).toMatchObject({ state: 'retrying', nextAttemptAt: r.now() + 60_000, attempts: 2 });
    r.ft.advance(60_000);
    await sender.drain(r.now(), OPEN);
    expect(raw(r.coord)[0]).toMatchObject({ state: 'retrying', nextAttemptAt: r.now() + 120_000, attempts: 3 });
    r.ft.advance(120_000);
    await sender.drain(r.now(), OPEN);
    expect(raw(r.coord)[0]).toMatchObject({ id, state: 'sent', attempts: 4 });
    expect(push.notify).toHaveBeenCalledTimes(4);
  });

  it('a refusal past the horizon (from armedAt) ends failed', async () => {
    const r = rig();
    const { push } = double(REFUSED);
    const sender = senderFor(deps(r, push));
    bound(r);
    r.ft.advance(OUTBOX_RETRY_HORIZON_MS - 10_000);
    await sender.drain(r.now(), OPEN);
    expect(raw(r.coord)[0]).toMatchObject({ state: 'failed', payload: null });
    expect(push.notify).toHaveBeenCalledTimes(1);
  });

  it('a late verdict of an older attempt leaves the newer claim\'s row unchanged (it lands by claimSeq)', async () => {
    const r = rig();
    const first = deferred();
    const second = deferred();
    const { push } = double(() => first.promise, () => second.promise);
    const sender = senderFor(deps(r, push));
    const id = bound(r);
    const target = { id, source: 'item' as const, sourceId: 1 };
    sender.sendRow(target, OPEN);
    expect(stateOf(r.coord)).toBe('sending');
    r.ft.advance(OUTBOX_SEND_DEADLINE_MS);
    await sender.idle();
    expect(stateOf(r.coord)).toBe('unknown');
    tx(r.coord.db, () => armBoundRowInTx(r.coord.db, 'item', 1, { pushId: 'unused', payload: PAYLOAD, at: r.now() }));
    sender.sendRow(target, OPEN);
    const before = raw(r.coord);
    expect(before[0]).toMatchObject({ state: 'sending', claimSeq: 2 });
    first.resolve(REFUSED);
    await Promise.resolve();
    await Promise.resolve();
    expect(raw(r.coord)).toEqual(before);
    second.resolve(ACCEPTED);
    await sender.idle();
    expect(stateOf(r.coord)).toBe('sent');
  });

  it('an older attempt\'s verdict that lands before its deadline, after a re-arm and a new claim, is dropped by claimSeq '
    + '(review 2150 F13)', async () => {
    const r = rig();
    const first = deferred();
    const second = deferred();
    const { push } = double(() => first.promise, () => second.promise);
    const sender = senderFor(deps(r, push));
    const id = bound(r);
    const target = { id, source: 'item' as const, sourceId: 1 };
    sender.sendRow(target, OPEN);
    tx(r.coord.db, () => armBoundRowInTx(r.coord.db, 'item', 1, { pushId: 'unused', payload: PAYLOAD, at: r.now() }));
    sender.sendRow(target, OPEN);
    expect(raw(r.coord)[0]).toMatchObject({ state: 'sending', claimSeq: 2 });
    first.resolve(REFUSED);                                  // the first attempt's deadline has not passed: it lands
    await Promise.resolve();
    await Promise.resolve();
    expect(raw(r.coord)[0]).toMatchObject({ state: 'sending', claimSeq: 2, verdict: null });
    second.resolve(ACCEPTED);
    await sender.idle();
    expect(raw(r.coord)[0]).toMatchObject({ state: 'sent', verdict: JSON.stringify(ACCEPTED) });
  });

  it('a lost sendRow claim sends nothing', () => {
    const r = rig();
    const { push } = double(ACCEPTED);
    const sender = senderFor(deps(r, push));
    const id = bound(r);
    expect(r.coord.claimOutboxRow(id, r.now())).toMatchObject({ changed: true });
    sender.sendRow({ id, source: 'item', sourceId: 1 }, OPEN);
    expect(push.notify).not.toHaveBeenCalled();
  });
});

describe('the sender: an unbound retry, a stale row and an open transaction (review 2150 F4, F6, F7)', () => {
  it('a newer accepted push under the same tag supersedes an older retrying one: sealed silent, never sent again', async () => {
    const r = rig();
    const { push } = double(REFUSED, ACCEPTED, ACCEPTED);
    const sender = senderFor(deps(r, push));
    sender.send({ title: 'Old', body: 'B', tag: 'x' });
    await sender.idle();
    sender.send({ title: 'New', body: 'B', tag: 'x' });
    await sender.idle();
    expect(raw(r.coord).map((row) => row.state)).toEqual(['retrying', 'sent']);
    r.ft.advance(30_000);
    await sender.drain(r.now(), OPEN);
    expect(raw(r.coord)[0]).toMatchObject({ state: 'silent', silentWhy: 'superseded', payload: null });
    expect(push.notify).toHaveBeenCalledTimes(2);
  });

  it('an older retrying push under another tag, or one whose newer row was not taken, is still retried', async () => {
    const r = rig();
    const { push } = double(REFUSED, ACCEPTED, NO_SUB, ACCEPTED);
    const sender = senderFor(deps(r, push));
    sender.send({ title: 'Old', body: 'B', tag: 'x' });
    await sender.idle();
    sender.send({ title: 'Other', body: 'B', tag: 'y' });
    await sender.idle();
    sender.send({ title: 'New', body: 'B', tag: 'x' });
    await sender.idle();
    expect(raw(r.coord).map((row) => row.state)).toEqual(['retrying', 'sent', 'unsent']);
    r.ft.advance(30_000);
    await sender.drain(r.now(), OPEN);
    expect(raw(r.coord)[0]).toMatchObject({ state: 'sent' });
    expect(push.notify).toHaveBeenCalledTimes(4);
  });

  it('a due row past the horizon that the boot pass did not seal is failed by the drain, never sent', async () => {
    const r = rig();
    const { push } = double(ACCEPTED);
    const sender = senderFor(deps(r, push));
    const stale = bound(r, 1, r.now() - OUTBOX_RETRY_HORIZON_MS - 1);
    await sender.drain(r.now(), OPEN);
    expect(stateOf(r.coord, stale)).toBe('failed');
    expect(push.notify).not.toHaveBeenCalled();
  });

  it('the boot pass seals each row on its own: one seal that throws leaves the next row sealed', () => {
    const r = rig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const a = r.coord.insertUnboundRow({ pushId: 'a'.repeat(32), payload: PAYLOAD, at: r.now() });
    const b = r.coord.insertUnboundRow({ pushId: 'b'.repeat(32), payload: PAYLOAD, at: r.now() });
    if (!a.ok || !b.ok) throw new Error('insert');
    const port = Object.assign(Object.create(r.coord) as CoordStore, {
      sealAtBoot: (id: number, to: 'unknown' | 'failed', at: number) => {
        if (id === a.id) throw new Error('disk full');
        return r.coord.sealAtBoot(id, to, at);
      },
    });
    bootPushOutbox(port, r.ft.ports.clock);
    expect(stateOf(r.coord, a.id)).toBe('sending');
    expect(stateOf(r.coord, b.id)).toBe('unknown');
    expect(warn.mock.calls.flat().join('\n')).toMatch(new RegExp(`did not seal row ${a.id} unknown \\(disk full\\)`));
  });

  it('an unbound push inside a caller\'s open transaction writes no row (so no rolled-back id is reused) and is still sent', async () => {
    const r = rig();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { push } = double(ACCEPTED);
    const sender = senderFor(deps(r, push));
    tx(r.coord.db, () => { sender.send({ title: 'T', body: 'B', tag: 'x' }); });
    await sender.idle();
    expect(raw(r.coord)).toHaveLength(0);
    expect(push.notify).toHaveBeenCalledTimes(1);
  });
});

describe('the sender: a rejected send', () => {
  it('notifyPushOnly prints the caller\'s sentence once and leaves no unhandled rejection', async () => {
    const r = rig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { push } = double(() => Promise.reject(new Error('boom')));
      notifyPushOnly(deps(r, push), { title: 'T', body: 'B', tag: 'x' }, 'ccrc-server: X failed');
      await senderFor(deps(r, push)).idle();
      await new Promise((resolve) => setImmediate(resolve));
      expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('ccrc-server: X failed'))).toEqual(['ccrc-server: X failed (boom)']);
      expect(unhandled).not.toHaveBeenCalled();
      expect(stateOf(r.coord)).toBe('unknown');
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('the sender: what a caller may lack', () => {
  it('with no push service it writes no row and calls nothing, and prepare mints an id with no payload', () => {
    const r = rig();
    const sender = senderFor(deps(r, undefined));
    sender.send({ title: 'T', body: 'B', tag: 'x' });
    expect(raw(r.coord)).toEqual([]);
    expect(sender.prepare({ title: 'T', body: 'B', tag: 'x' })).toEqual({ payload: null, pushId: expect.stringMatching(/^[0-9a-f]{32}$/), service: false });
  });

  it('with no store, an unbound push is still sent exactly once, with no row', async () => {
    const r = rig();
    const { push } = double(ACCEPTED);
    const sender = senderFor({ push, coord: undefined, time: r.ft.ports });
    sender.send({ title: 'T', body: 'B', tag: 'x' });
    await sender.idle();
    expect(push.notify).toHaveBeenCalledTimes(1);
    expect(raw(r.coord)).toEqual([]);
  });

  it('with a store whose insertUnboundRow throws, the push is still sent exactly once, with no row', async () => {
    const r = rig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fn = (): never => { throw new Error('unused'); };
    const coord = {
      claimOutboxRow: fn, dueOutboxRows: fn, firstBootAt: fn, heldItemsReached: fn, markFirstBoot: fn, markOutboxVerdict: fn,
      openOutboxRows: fn, purgeOutbox: fn, reachHeldItem: fn, sealAtBoot: fn, silenceOutboxRow: fn, supersededUnbound: fn,
      insertUnboundRow: () => { throw new Error('disk gone'); },
    };
    const { push } = double(ACCEPTED);
    const sender = senderFor({ push, coord, time: r.ft.ports });
    sender.send({ title: 'T', body: 'B', tag: 'x' });
    await sender.idle();
    expect(push.notify).toHaveBeenCalledTimes(1);
    expect(raw(r.coord)).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('one push double shared by a narrow and a full caller, in either order, writes by each call\'s own deps', async () => {
    const r = rig();
    const { push } = double(ACCEPTED);
    const p = { title: 'T', body: 'B', tag: 'x' };
    senderFor({ push }).send(p);                                          // narrow: no store, no time
    senderFor(deps(r, push)).send(p);                                     // full
    await senderFor({ push }).idle();
    expect(raw(r.coord)).toHaveLength(1);
    senderFor(deps(r, push)).send(p);                                     // full, then narrow
    senderFor({ push }).send(p);
    senderFor({ push, coord: undefined, time: r.ft.ports }).send(p);      // a store-less caller with time
    await senderFor({ push }).idle();
    expect(raw(r.coord)).toHaveLength(2);
    expect(push.notify).toHaveBeenCalledTimes(5);
  });

  it('with no push service, a standing held read failure is logged once, not on every drain (review 2150 F10)', async () => {
    const r = rig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    bootPushOutbox(r.coord, r.ft.ports.clock);
    const coord = Object.assign(Object.create(r.coord) as CoordStore, {
      heldItemsReached: () => ({ ok: false as const, detail: 'operator_items read failed: disk' }),
    });
    const sender = senderFor({ push: undefined, coord, time: r.ft.ports });
    await sender.drain(r.now(), OPEN);
    await sender.drain(r.now(), OPEN);
    expect(warn.mock.calls.flat().filter((l) => String(l).includes('operator_items read failed'))).toHaveLength(1);
  });

  it('prepare before a masker is set masks with the push service\'s own masker (the shape-only one it is built with)', () => {
    const r = rig();
    const { push: bare } = double(ACCEPTED);
    const push = Object.assign(bare, { payloadMasker: SHAPE_ONLY_MASKER });
    const key = `sk-ant-${'api03'}-${'Ab3dE5gH7jK9mN1pQ3sT5vW7yZ'}`;
    const out = senderFor(deps(r, push)).prepare({ title: 'T', body: `k ${key}`, tag: 'x' });
    expect(out.service).toBe(true);
    expect(JSON.stringify(out.payload)).not.toContain(key);
    expect(out.payload).toEqual(SHAPE_ONLY_MASKER.maskDeep({ title: 'T', body: `k ${key}`, tag: 'x' }));
  });
});

describe('bootPushOutbox and the held drain', () => {
  it('seals a sending row unknown and a stale row failed, sends the other two once each, and a second boot changes nothing', async () => {
    const r = rig();
    const { push } = double(ACCEPTED);
    const sender = senderFor(deps(r, push));
    const t0 = r.now();
    const dead = r.coord.insertUnboundRow({ pushId: 'dead', payload: PAYLOAD, at: t0 - 1_000 });
    if (!dead.ok) throw new Error(dead.detail);
    const fresh = bound(r, 1, t0);
    const retrying = bound(r, 2, t0);
    const claim = r.coord.claimOutboxRow(retrying, t0);
    if (!claim.changed) throw new Error('claim');
    r.coord.markOutboxVerdict(retrying, claim.claimSeq, { to: 'retrying', verdict: REFUSED, nextAttemptAt: t0 + 500 }, t0);
    const stale = bound(r, 3, t0 - OUTBOX_RETRY_HORIZON_MS - 1_000);
    bootPushOutbox(r.coord, r.ft.ports.clock);
    expect(stateOf(r.coord, dead.id)).toBe('unknown');
    expect(stateOf(r.coord, stale)).toBe('failed');
    expect(stateOf(r.coord, fresh)).toBe('pending');
    expect(stateOf(r.coord, retrying)).toBe('retrying');
    expect(r.coord.firstBootAt()).toBe(t0);
    r.ft.advance(1_000);
    await sender.drain(r.now(), OPEN);
    expect(push.notify).toHaveBeenCalledTimes(2);
    expect(stateOf(r.coord, fresh)).toBe('sent');
    expect(stateOf(r.coord, retrying)).toBe('sent');
    const after = raw(r.coord);
    bootPushOutbox(r.coord, r.ft.ports.clock);
    await sender.drain(r.now(), OPEN);
    expect(raw(r.coord)).toEqual(after);
    expect(push.notify).toHaveBeenCalledTimes(2);
    expect(r.coord.firstBootAt()).toBe(t0);
  });

  it('drain stamps a held item whose hold passed after the first boot, writes one silent row, and sends nothing', async () => {
    const r = rig();
    const { push } = double(ACCEPTED);
    const sender = senderFor(deps(r, push));
    bootPushOutbox(r.coord, r.ft.ports.clock);
    const heldUntil = r.now() + 100;
    const id = item(r, { heldUntil });
    r.ft.advance(200);
    await sender.drain(r.now(), OPEN);
    const stamp = r.coord.db.prepare('SELECT reachedOperatorAt AS at FROM operator_items WHERE id = ?').get(id) as { at: unknown };
    expect(stamp.at, 'stamped at heldUntil, not at the later drain (review 2150 F3)').toBe(heldUntil);
    expect(raw(r.coord)).toHaveLength(1);
    expect(raw(r.coord)[0]).toMatchObject({ sourceKind: 'item', sourceId: id, state: 'silent' });
    expect(push.notify).not.toHaveBeenCalled();
    await sender.drain(r.now(), OPEN);
    expect(raw(r.coord)).toHaveLength(1);
  });
});

describe('FleetWatcher.sweepPushOutbox: the lane needs the store (slug lane-needs-the-store)', () => {
  it('a watcher built without a store or time ports (a narrow test\'s deps) runs no pass, so the lane logs no failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = { ...testDeps(mkTmp('ccrc-sender-w-')), coord: undefined, time: undefined };
    const w = quietAtTestEnd(new FleetWatcher(deps as never, new Bus(), 2000));
    await w.sweepPushOutbox();
    expect(warn.mock.calls.flat().join('\n')).not.toMatch(/push outbox lane failed/);
  });
});
