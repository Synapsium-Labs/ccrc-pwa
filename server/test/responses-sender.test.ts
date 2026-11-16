// Overlord W1, the response record (Task 3: plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md): each
// push carries its outbox push id, and its response row is written `pending` in the claim's (or the unbound insert's)
// transaction, before `PushService.notify` is called. The verdict lands on the row with the outbox's, a never-delivered
// row goes on a terminal, answered move, and a push whose row could not be written goes with no id (C67).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { tx } from '../src/coord/tx.js';
import { armBoundRowInTx, insertBoundRowInTx, type OutboxPayload } from '../src/coord/pushOutboxStore.js';
import * as responsesStore from '../src/coord/responsesStore.js';
import { SHAPE_ONLY_MASKER, SecretMasker, fingerprintGeneration, fingerprintRow } from '../src/accounts/mask.js';
import { notify, notifyPushOnly } from '../src/notice.js';
import { bootPushOutbox, senderFor, type SenderDeps, type SettledOf } from '../src/pushSender.js';
import type { PushPayload } from '../src/push.js';
import { OUTBOX_RETRY_HORIZON_MS, type PushSendVerdict } from '../../shared/push-outbox.js';
import type { ResponseStamp } from '../../shared/responses.js';
import { fakeTime, type FakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); removeTmpFixtures(); });

const HASH = (c: string): string => c.repeat(64);
const PAYLOAD: OutboxPayload = { title: 'Waiting on you', body: 'Pick one', sessionId: '', tag: 'item-1', url: '/waiting' };
const accepted = (...hashes: string[]): PushSendVerdict =>
  ({ kind: 'sent', subs: hashes.map((h) => ({ endpointHash: h, verdict: 'accepted' as const, status: 201 })) });
const REFUSED: PushSendVerdict = { kind: 'sent', subs: [{ endpointHash: HASH('r'), verdict: 'refused', status: 429 }] };
const NO_ANSWER: PushSendVerdict = { kind: 'sent', subs: [{ endpointHash: HASH('n'), verdict: 'no-answer', status: null }] };
const NO_SUB: PushSendVerdict = { kind: 'no-subscription' };
const OPEN: SettledOf = () => ({ settled: false, blocking: true });
const STAMP: ResponseStamp = { boot: { kind: 'measured', epoch: 3 }, restore: { kind: 'unmeasured' } };
const PUSH_ID = /^[0-9a-f]{32}$/;

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-resp-sender-'), '.ccrc', 'coord.db')));
interface Rig { readonly coord: CoordStore; readonly ft: FakeTime; readonly now: () => number }
const rig = (): Rig => { const ft = fakeTime(); return { coord: store(), ft, now: () => ft.ports.clock.wall() }; };
const responses = (s: CoordStore): Record<string, unknown>[] =>
  s.db.prepare('SELECT * FROM operator_responses ORDER BY id').all() as Record<string, unknown>[];
const outbox = (s: CoordStore): Record<string, unknown>[] =>
  s.db.prepare('SELECT id, pushId, state FROM push_outbox ORDER BY id').all() as Record<string, unknown>[];

/** A recording push double: each call answers the next scripted answer, and the last one repeats. `onSend` runs inside
 *  `notify`, so a case can read the store at the moment of the send. */
function double(...script: (unknown | ((p: PushPayload) => Promise<unknown>))[]) {
  const sent: PushPayload[] = [];
  let i = 0;
  const notify = vi.fn((p: PushPayload): Promise<unknown> => {
    sent.push(p);
    const a = script[Math.min(i, script.length - 1)];
    i += 1;
    return typeof a === 'function' ? (a as (p: PushPayload) => Promise<unknown>)(p) : Promise.resolve(a);
  });
  return { push: { notify }, sent };
}
const deps = (r: Rig, push: { notify: unknown } | undefined, over: Partial<SenderDeps> = {}): SenderDeps =>
  ({ push: push as SenderDeps['push'], coord: r.coord, time: r.ft.ports, responseStamp: () => STAMP, ...over });
const bound = (r: Rig, source: 'item' | 'ask' = 'item', sourceId = 1, at = r.now()): number =>
  tx(r.coord.db, () => insertBoundRowInTx(r.coord.db, { source, sourceId, pushId: `${source === 'item' ? 'a' : 'b'}${String(sourceId).padStart(31, '0')}`,
    payload: { ...PAYLOAD, tag: `${source}-${sourceId}` }, state: 'pending', at }));

describe('an unbound push with a label', () => {
  it('writes one pending row before the send, sends its push id, and on an accepted verdict the row is delivered', async () => {
    const r = rig();
    let atSend: Record<string, unknown>[] = [];
    const { push, sent } = double((): Promise<unknown> => { atSend = responses(r.coord); return Promise.resolve(accepted(HASH('b'), HASH('a'))); });
    const sender = senderFor(deps(r, push));
    sender.send({ title: 'T', body: 'B', tag: 'x', actions: [{ action: 'go', title: 'Go' }] }, { label: 'coord' });
    await sender.idle();
    expect(atSend).toHaveLength(1);
    expect(atSend[0]).toMatchObject({ kind: 'push', label: 'coord', state: 'pending', carriesKind: null, hasActions: 1, tag: 'x',
      bootMeasured: 1, bootEpoch: 3, restoreMeasured: 0 });
    expect(sent[0]!.pushId).toMatch(PUSH_ID);
    expect(sent[0]!.pushId).toBe(outbox(r.coord)[0]!.pushId);
    expect(responses(r.coord)[0]).toMatchObject({ pushId: sent[0]!.pushId, state: 'delivered', sends: 1,
      acceptedSubs: JSON.stringify([HASH('a'), HASH('b')]) });
  });

  it('a no-subscription verdict (the outbox row ends unsent) removes the row', async () => {
    const r = rig();
    const sender = senderFor(deps(r, double(NO_SUB).push));
    sender.send({ title: 'T', body: 'B', tag: 'x' }, { label: 'coord' });
    await sender.idle();
    expect(outbox(r.coord)[0]).toMatchObject({ state: 'unsent' });
    expect(responses(r.coord)).toHaveLength(0);
  });

  it('a verdict whose only subscription answered no-answer (unknown, none accepted) leaves it pending, and so does a deadline', async () => {
    const r = rig();
    const sender = senderFor(deps(r, double(NO_ANSWER).push));
    sender.send({ title: 'T', body: 'B', tag: 'x' }, { label: 'coord' });
    await sender.idle();
    expect(outbox(r.coord)[0]).toMatchObject({ state: 'unknown' });
    expect(responses(r.coord)[0]).toMatchObject({ state: 'pending' });
    const s2 = senderFor(deps(r, double(() => new Promise(() => undefined)).push));
    s2.send({ title: 'T', body: 'B', tag: 'y' }, { label: 'coord' });
    r.ft.advance(3_600_000);
    await s2.idle();
    expect(outbox(r.coord)[1]).toMatchObject({ state: 'unknown' });
    expect(responses(r.coord)).toHaveLength(2);
    expect(responses(r.coord)[1]).toMatchObject({ state: 'pending' });
  });
});

describe('a bound push', () => {
  it('an ask\'s send and an item\'s send each write a row carrying their source, labelled by it (question 18)', async () => {
    const r = rig();
    const { push, sent } = double(accepted(HASH('b')));
    const sender = senderFor(deps(r, push));
    sender.sendRow({ id: bound(r, 'ask', 4), source: 'ask', sourceId: 4 }, OPEN);
    sender.sendRow({ id: bound(r, 'item', 5), source: 'item', sourceId: 5 }, OPEN);
    await sender.idle();
    expect(responses(r.coord).map((x) => [x.label, x.carriesKind, x.carriesId, x.pushId, x.state])).toEqual([
      ['ask', 'ask', 4, sent[0]!.pushId, 'delivered'], ['item', 'item', 5, sent[1]!.pushId, 'delivered']]);
  });

  it('a retry after an all-refused verdict: the row stays pending, the retry inserts nothing, one row with sends 1', async () => {
    const r = rig();
    const { push, sent } = double(REFUSED, accepted(HASH('b')));
    const sender = senderFor(deps(r, push));
    bound(r);
    await sender.drain(r.now(), OPEN);
    expect(outbox(r.coord)[0]).toMatchObject({ state: 'retrying' });
    expect(responses(r.coord)).toEqual([expect.objectContaining({ state: 'pending', sends: 0 })]);
    r.ft.advance(30_000);
    await sender.drain(r.now(), OPEN);
    expect(responses(r.coord)).toEqual([expect.objectContaining({ state: 'delivered', sends: 1 })]);
    expect(sent.map((p) => p.pushId)).toEqual([sent[0]!.pushId, sent[0]!.pushId]);
  });

  it('an outbox row that ends failed with none accepted: its never-delivered response row is gone', async () => {
    const r = rig();
    const sender = senderFor(deps(r, double(REFUSED).push));
    bound(r);
    r.ft.advance(OUTBOX_RETRY_HORIZON_MS - 10_000);
    await sender.drain(r.now(), OPEN);
    expect(outbox(r.coord)[0]).toMatchObject({ state: 'failed' });
    expect(responses(r.coord)).toHaveLength(0);
  });

  it('a re-arm of a delivered item push: the same push id, one row, sends 2', async () => {
    const r = rig();
    const { push, sent } = double(accepted(HASH('b')));
    const sender = senderFor(deps(r, push));
    const id = bound(r);
    sender.sendRow({ id, source: 'item', sourceId: 1 }, OPEN);
    await sender.idle();
    tx(r.coord.db, () => armBoundRowInTx(r.coord.db, 'item', 1, { pushId: 'unused', payload: PAYLOAD, at: r.now() }));
    sender.sendRow({ id, source: 'item', sourceId: 1 }, OPEN);
    await sender.idle();
    expect(sent[1]!.pushId).toBe(sent[0]!.pushId);
    expect(responses(r.coord)).toEqual([expect.objectContaining({ pushId: sent[0]!.pushId, sends: 2, state: 'delivered' })]);
  });

  it('a re-arm of a push whose response row is sealed: one row, sends up by one, nothing else changed', async () => {
    const r = rig();
    const sender = senderFor(deps(r, double(accepted(HASH('b'))).push));
    const id = bound(r);
    sender.sendRow({ id, source: 'item', sourceId: 1 }, OPEN);
    await sender.idle();
    r.coord.db.prepare("UPDATE operator_responses SET state = 'sealed', sealedAt = 9, outcome = 'unmeasured', why = 'receipts'").run();
    const before = responses(r.coord)[0]!;
    tx(r.coord.db, () => armBoundRowInTx(r.coord.db, 'item', 1, { pushId: 'unused', payload: PAYLOAD, at: r.now() }));
    sender.sendRow({ id, source: 'item', sourceId: 1 }, OPEN);
    await sender.idle();
    expect(responses(r.coord)).toEqual([{ ...before, sends: Number(before.sends) + 1 }]);
  });

  it('a stale row the boot pass fails removes its never-delivered response row; a claim it seals unknown leaves it pending', async () => {
    const r = rig();
    const sender = senderFor(deps(r, double(REFUSED, () => new Promise(() => undefined)).push));
    bound(r, 'item', 1);
    await sender.drain(r.now(), OPEN);                         // item 1: refused, retrying, response pending
    const two = bound(r, 'item', 2);
    sender.sendRow({ id: two, source: 'item', sourceId: 2 }, OPEN);   // item 2: claimed, never answered
    expect(responses(r.coord)).toHaveLength(2);
    r.ft.advance(OUTBOX_RETRY_HORIZON_MS + 1);
    bootPushOutbox(r.coord, r.ft.ports.clock);
    expect(outbox(r.coord).map((x) => x.state)).toEqual(['failed', 'unknown']);
    expect(responses(r.coord)).toEqual([expect.objectContaining({ carriesId: 2, state: 'pending' })]);
  });

  it('a claim reached inside an open transaction writes the claim and the row inline and does not throw', () => {
    const r = rig();
    const id = bound(r);
    const claim = tx(r.coord.db, () => r.coord.claimOutboxRow(id, r.now(), { label: 'item', carries: { kind: 'item', id: 1 }, stamp: STAMP }));
    expect(claim).toMatchObject({ changed: true, responseWritten: true });
    expect(outbox(r.coord)[0]).toMatchObject({ state: 'sending' });
    expect(responses(r.coord)).toHaveLength(1);
  });

  it('a late verdict of an older attempt lands on neither the outbox nor the response row', async () => {
    const r = rig();
    let release!: (v: unknown) => void;
    const { push } = double(() => new Promise((res) => { release = res; }), accepted(HASH('b')));
    const sender = senderFor(deps(r, push));
    const id = bound(r);
    sender.sendRow({ id, source: 'item', sourceId: 1 }, OPEN);
    const first = release;
    tx(r.coord.db, () => armBoundRowInTx(r.coord.db, 'item', 1, { pushId: 'unused', payload: PAYLOAD, at: r.now() }));
    sender.sendRow({ id, source: 'item', sourceId: 1 }, OPEN);
    await new Promise((res) => { setImmediate(res); });
    expect(responses(r.coord)).toEqual([expect.objectContaining({ sends: 1, acceptedSubs: JSON.stringify([HASH('b')]) })]);
    first(accepted(HASH('z')));
    await sender.idle();
    expect(responses(r.coord)).toEqual([expect.objectContaining({ sends: 1, acceptedSubs: JSON.stringify([HASH('b')]) })]);
  });
});

describe('no row, no id', () => {
  it('no label (notifyPushOnly), no stamp, or no store: the push is sent with no row and no pushId', async () => {
    const r = rig();
    const a = double(accepted(HASH('b')));
    notifyPushOnly({ ...deps(r, a.push), coord: r.coord }, { title: 'T', body: 'B', tag: 'x' }, 'failed');
    const b = double(accepted(HASH('b')));
    const nb = senderFor(deps(r, b.push, { responseStamp: undefined }));
    nb.send({ title: 'T', body: 'B', tag: 'y' }, { label: 'coord' });
    const c = double(accepted(HASH('b')));
    const nc = senderFor(deps(r, c.push, { coord: undefined }));
    nc.send({ title: 'T', body: 'B', tag: 'z' }, { label: 'coord' });
    await Promise.all([senderFor(deps(r, a.push)).idle(), nb.idle(), nc.idle()]);
    expect([...a.sent, ...b.sent, ...c.sent].map((p) => p.pushId)).toEqual([undefined, undefined, undefined]);
    expect(responses(r.coord)).toHaveLength(0);
  });

  it('a bound push with no stamp is sent with no row and no pushId', async () => {
    const r = rig();
    const { push, sent } = double(accepted(HASH('b')));
    const sender = senderFor(deps(r, push, { responseStamp: undefined }));
    sender.sendRow({ id: bound(r), source: 'item', sourceId: 1 }, OPEN);
    await sender.idle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty('pushId');
    expect(responses(r.coord)).toHaveLength(0);
  });

  it('a throwing response insert: the push is still sent, with no push id, the outbox row claimed, and one warning', async () => {
    const r = rig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    r.coord.db.exec("CREATE TRIGGER no_responses BEFORE INSERT ON operator_responses BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    const { push, sent } = double(accepted(HASH('b')), accepted(HASH('b')));
    const sender = senderFor(deps(r, push));
    sender.send({ title: 'T', body: 'B', tag: 'x' }, { label: 'coord' });
    sender.sendRow({ id: bound(r), source: 'item', sourceId: 1 }, OPEN);
    await sender.idle();
    expect(sent).toHaveLength(2);
    expect(sent.map((p) => 'pushId' in p)).toEqual([false, false]);
    expect(outbox(r.coord).map((x) => x.state)).toEqual(['sent', 'sent']);
    expect(warn.mock.calls.filter(([l]) => String(l).includes('response row'))).toEqual([[expect.stringContaining('was not written (disk full)')]]);
    expect(responses(r.coord)).toHaveLength(0);
  });

  it('a 32-hex push id survives notify\'s second mask, under the shape-only masker and a wired one with a secret', () => {
    const id = 'c0ffee'.repeat(5) + '42';
    const token = 'a1'.repeat(32);
    const secret = `cmp-${'0123456789abcdef'.repeat(3)}`;
    const wired = new SecretMasker({ db: openCoordDb(path.join(mkTmp('ccrc-resp-mask-'), 'coord.db')), token: () => token });
    wired.ingest({ gen: fingerprintGeneration(token), rows: [fingerprintRow(token, 'lane0', secret)] });
    expect(wired.maskDeep({ body: `x ${secret} y` }).body).not.toContain(secret);
    for (const m of [SHAPE_ONLY_MASKER, wired]) {
      const once = m.maskDeep({ title: 'T', body: 'B', tag: 'x' });
      expect(m.maskDeep({ ...once, pushId: id }).pushId).toBe(id);
    }
  });
});

describe('the funnel and the adoption sink', () => {
  it('a funnel notice pushes with its notifier kind as the label', async () => {
    const r = rig();
    const { push, sent } = double(accepted(HASH('b')));
    notify({ ...deps(r, push), coord: r.coord }, { kind: 'coord', sessionId: '', runId: null, title: 'Disk', body: 'Low' }, 'push');
    await senderFor(deps(r, push)).idle();
    expect(responses(r.coord)).toEqual([expect.objectContaining({ label: 'coord', pushId: sent[0]!.pushId, carriesKind: null })]);
  });

  it('every hand-built funnel deps literal in server/src that carries push also carries responseStamp (review 2184 F11)', () => {
    const root = path.join(import.meta.dirname, '..', 'src');
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(root);
    const literals = files.flatMap((f) => readFileSync(f, 'utf8').split('\n')
      .filter((l) => /\{\s*notifyLog:/.test(l) && /\bpush:/.test(l)).map((l) => ({ f: path.relative(root, f), l })));
    expect(literals.length).toBeGreaterThan(0);
    expect(literals.filter(({ l }) => !/\bresponseStamp:/.test(l))).toEqual([]);
  });
});
