// Overlord W1, inbox piece, Task 3 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`; spec §6.8, §3.8, §11.2):
// the three doors of `coord/overlordInboxRoutes.ts`, `GET /api/overlord/inbox`, `GET /api/overlord/messages/:id` and `POST
// /api/overlord/messages/:id/acknowledge`, through the REAL gate runner over a real fixture `coord.db` (as `linking-overlord-
// confirm.test.ts` stands it up), the REAL read runner and a real `OperatorModelStore` on a fixture file. Fixture names only.
//
// The sequence line `acknowledge` writes after its move (the plan's question 19) is not built in this tree: the sequence piece adds
// the stamp call, and its cases come with it.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { issueActKey } from '../src/continuity/actKeyStore.js';
import { genExpectOf, openRound, type GenRow, type MintInput } from '../src/continuity/continuityStore.js';
import { openCoordDb } from '../src/coord/db.js';
import { overlordGateRun, type OverlordGateDeps } from '../src/coord/overlordGateRun.js';
import { actKeyFact, advanceCounterGuarded, recordFenceRefusal } from '../src/coord/overlordGateStore.js';
import { registerOverlordInboxRoutes } from '../src/coord/overlordInboxRoutes.js';
import { runOverlordRead } from '../src/coord/overlordRead.js';
import { CoordStore } from '../src/coord/store.js';
import { bootSettlement } from '../src/operatorModel/messages.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { ACT_COUNTER_HEADER, ACT_GENERATION_HEADER, ACT_KEY_HEADER, WITNESS_KEY_HEADER } from '../../shared/continuity-door.js';
import { READ_CEILINGS } from '../../shared/overlordInbox.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const NOW = 1_800_000_000_000;
const TOKEN = 'a'.repeat(64);
const BODY = 'lane-a-overlord';            // the Overlord's session id
const OTHER = 'lane-b-project-a';          // any other session
const INC = 'inc-1';
const MSG_TEXT = 'MSG-MARKER do the thing in project-a';
const QUESTION = 'Q-MARKER which thread is open?';
const EXPECTED = 'EXPECTED-MARKER none';
const DESIGNATED = (term = 1): DesignationRead => ({
  kind: 'designated', sessionId: BODY, term,
  row: { bound: { sessionId: BODY, generation: INC }, pending: null, term, designatedTerm: term },
}) as unknown as DesignationRead;
const ACTOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('Fixture browser', 'abcdef0123456789'));
/** A journal double: issues one above the larger of the store's highest and its own. */
function issuer(): PrivacyIssuer {
  let last = 0;
  return { kind: 'ready', issue: (high) => { last = Math.max(high ?? 0, last) + 1; return { ok: true, id: last }; } };
}

let s: CoordStore;
let seq = 0;
beforeAll(() => { s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-inbox-routes-'), '.ccrc', 'coord.db'))); });
afterAll(removeTmpFixtures);
const apps: FastifyInstance[] = [];
const dbs: DatabaseSync[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of dbs.splice(0)) if (db.isOpen) db.close();
  await Promise.all(apps.splice(0).map((a) => a.close()));
  s.db.exec('DELETE FROM overlord_fence_refusals; DELETE FROM continuity_probes');
});

/** Mint the Overlord identity's next generation with its own act key, standing in `state`. */
function fresh(state: 'active' | 'degraded' = 'active'): { gen: GenRow; key: string } {
  seq += 1;
  const key = createHash('sha256').update(`key-${seq}`).digest('hex');
  const r0 = s.insertStart({ sessionId: BODY, reportId: `rr-${seq}`, uuid: '11111111-2222-3333-4444-555555555555', source: 'startup',
    model: 'claude-opus-5-5', rowIncarnation: null, reportedAt: NOW + seq, receivedAt: NOW + seq, doorNonceSha256: null });
  if (!r0.ok) throw new Error('start not recorded');
  const live = s.liveGenerations();
  if (!live.ok) throw new Error(live.detail);
  const old = live.rows.find((g) => g.identity === 'overlord');
  const mint: MintInput = { identity: 'overlord', sessionId: BODY, role: 'coordinator', term: 1, rowIncarnation: null, startId: r0.id,
    startReportedAt: NOW + seq, resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000 + seq,
    proc: `p${seq}`, now: NOW };
  const m = s.mintGeneration(mint, old === undefined ? null : genExpectOf(old), true);
  if (!m.ok) throw new Error('not minted');
  s.db.prepare('UPDATE continuity_generations SET state = ?, deadlineAt = NULL WHERE id = ?').run(state, m.id);
  const after = s.liveGenerations();
  if (!after.ok) throw new Error(after.detail);
  const gen = after.rows.find((g) => g.id === m.id)!;
  const issued = issueActKey(s.db, { generationId: gen.id, nonceSha256: createHash('sha256').update(`n-${seq}`).digest('hex'),
    keySha256: createHash('sha256').update(key, 'utf8').digest('hex'), issuedAt: NOW });
  if (!issued.ok) throw new Error('key not issued');
  return { gen, key };
}

interface Rig {
  app: FastifyInstance; store: OperatorModelStore; db: DatabaseSync; gen: GenRow;
  /** The store methods the doors called, by name. */
  calls: string[];
  act: () => Record<string, string>;
  record: (text?: string, over?: Partial<Parameters<OperatorModelStore['recordMessage']>[0]>) => number;
  lines: () => Record<string, unknown>[];
  fenceRows: () => number;
}
interface RigOpts { state?: 'active' | 'degraded'; words?: readonly string[]; designationTerm?: number; storeUp?: boolean }
async function rig(o: RigOpts = {}): Promise<Rig> {
  const { gen, key } = fresh(o.state ?? 'active');
  const db = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-inbox-routes-store-')));
  dbs.push(db);
  const store = new OperatorModelStore(db, issuer());
  const calls: string[] = [];
  const spied = new Proxy(store, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv) as unknown;
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => { calls.push(String(prop)); return (v as (...a: unknown[]) => unknown).apply(target, args); };
    },
  });
  const gateDeps: OverlordGateDeps = {
    identity: {
      session: async (sessionId, uuid) => ({ ok: true, sessionId, uuid, actor: { kind: 'session', subject: sessionId } as never }),
      incarnation: async () => ({ kind: 'measured', incarnation: INC }) as never,
    },
    designation: () => DESIGNATED(o.designationTerm ?? 1),
    authority: () => ({ kind: 'coherent' }),
    ladder: () => ({ kind: 'read', rung: { rung: 'full', operatorRung: 'full', binding: [], readBy: [] } }),
    generations: () => s.liveGenerations(),
    continuityLive: () => true,
    cardRead: () => ({ ok: true, read: { current: true } as never }),
    actKey: (g, k) => actKeyFact(s.db, g, k),
    counter: (g, c) => advanceCounterGuarded(s.db, g, c),
    witness: () => ({ kind: 'witnessed', witnessId: 7 }),
    recordWitness: () => true,
    recordFenceRefusal: (r) => { recordFenceRefusal(s.db, r); },
    serverWords: () => o.words ?? ['overlord-v1'],
    now: () => NOW,
  };
  // The coordination store's three reads, the designation being the gate's own fixture (this store seeds none).
  const probeReads = { designationRead: () => DESIGNATED(o.designationTerm ?? 1), liveGenerations: () => s.liveGenerations(), openProbeRound: (id: string) => s.openProbeRound(id) };
  const app = Fastify({ logger: false });
  apps.push(app);
  registerOverlordInboxRoutes(app, {
    mailToken: () => TOKEN, gate: overlordGateRun(gateDeps),
    readRunner: runOverlordRead({ ledger: store, turn: async () => 'done', now: () => NOW }),
    inboxStore: o.storeUp === false ? undefined : spied, reads: probeReads, continuityLive: () => true, now: () => NOW,
  });
  await app.ready();
  let counter = 0;
  let n = 0;
  return {
    app, store, db, gen, calls,
    act: () => { counter += 1; return { [ACT_KEY_HEADER]: key, [ACT_GENERATION_HEADER]: String(gen.n), [ACT_COUNTER_HEADER]: String(counter), [WITNESS_KEY_HEADER]: 'w-1' }; },
    record: (text = MSG_TEXT, over = {}) => {
      n += 1;
      const r = store.recordMessage({ at: NOW - 100_000 + n, sessionId: BODY, term: 1, actor: ACTOR, text, mark: false, composedKey: null, ...over });
      if (!r.ok) throw new Error(`${r.error}: ${r.detail}`);
      return r.value.id;
    },
    lines: () => db.prepare('SELECT at, door, caller, scope, count, outcome, generation, generationRead, turnState FROM read_ledger ORDER BY id').all() as never,
    fenceRows: () => (s.db.prepare('SELECT count(*) AS c FROM overlord_fence_refusals').get() as { c: number }).c,
  };
}

const by = (who = BODY): string => `byId=${who}&byUuid=u-1`;
const HEADERS = { 'x-ccrc-mail-token': TOKEN };
const inbox = (r: Rig, who = BODY, headers: Record<string, string> = r.act()): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'GET', url: `/api/overlord/inbox?${by(who)}`, headers: { ...HEADERS, ...headers } });
const message = (r: Rig, id: string | number, who = BODY, headers: Record<string, string> = r.act()): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'GET', url: `/api/overlord/messages/${id}?${by(who)}`, headers: { ...HEADERS, ...headers } });
const ack = (r: Rig, id: string | number, who = BODY, headers: Record<string, string> = r.act()): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'POST', url: `/api/overlord/messages/${id}/acknowledge`, headers: { ...HEADERS, ...headers }, payload: { byId: who, byUuid: 'u-1' } });
const json = (res: { body: string }): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;

/** A round of `n` questions in the generation, as the lane opens one (its text and answers are markers). */
function openProbe(gen: GenRow, kind: 'compaction' | 'start' | 'spot' = 'compaction', n = 2): void {
  const r = openRound(s.db, {
    roundId: 'round-7', sessionId: BODY, generationId: gen.id, kind, snapshotId: null, depthTokens: null, modelClass: null,
    roundUnmeasured: false, askedAt: NOW - 5_000, supersedes: null,
    questions: Array.from({ length: n }, (_, i) => ({ qid: `p${i}`, cls: 'thread' as const, question: `${QUESTION} ${i}`, choices: null, expected: EXPECTED })),
  });
  if (!r.ok) throw new Error(`round not opened: ${r.kind}`);
}

describe('the gate and the fence come first', () => {
  it('a session that is not the designated one is refused 403 not-the-overlord at every door, before anything is read', async () => {
    const r = await rig();
    r.record();
    const answers = [await inbox(r, OTHER), await message(r, 1, OTHER), await ack(r, 1, OTHER)];
    for (const res of answers) {
      expect(res.statusCode).toBe(REFUSAL_STATUS['not-the-overlord']);
      expect(json(res)).toMatchObject({ ok: false, error: 'not-the-overlord' });
    }
    expect(r.calls).toEqual([]);
    expect(r.lines()).toEqual([]);
  });

  it('a malformed message id is reached only after the gate: a caller that is not the Overlord still reads not-the-overlord', async () => {
    const r = await rig();
    for (const bad of ['abc', '0', '01', '-1', '1,2']) {
      expect((await message(r, bad, OTHER)).statusCode, bad).toBe(REFUSAL_STATUS['not-the-overlord']);
      expect((await ack(r, bad, OTHER)).statusCode, bad).toBe(REFUSAL_STATUS['not-the-overlord']);
    }
    expect(r.calls).toEqual([]);
  });

  it('the designated id without the act key is refused stale-generation with one fence-refusal row each, no ledger line and no store method called', async () => {
    const r = await rig();
    r.record();
    const calledBefore = r.calls.length;
    const answers = [await inbox(r, BODY, {}), await message(r, 1, BODY, {}), await ack(r, 1, BODY, {})];
    for (const res of answers) {
      expect(res.statusCode).toBe(REFUSAL_STATUS['stale-generation']);
      expect(json(res)).toMatchObject({ ok: false, error: 'stale-generation' });
    }
    expect(r.fenceRows()).toBe(3);
    expect(r.lines()).toEqual([]);
    expect(r.calls.length).toBe(calledBefore);
    // …and a fenced refusal of a malformed id never reaches its parse either
    expect((await message(r, 'abc', BODY, {})).statusCode).toBe(REFUSAL_STATUS['stale-generation']);
  });

  it('without the overlord-v1 word, every door answers capability-missing', async () => {
    const r = await rig({ words: ['continuity-v1'] });
    for (const res of [await inbox(r), await message(r, 1), await ack(r, 1)]) {
      expect(res.statusCode).toBe(REFUSAL_STATUS['capability-missing']);
      expect(json(res)).toMatchObject({ error: 'capability-missing' });
    }
    expect(r.calls).toEqual([]);
  });

  it('a call with no box token, or a wrong one, is 401 before the gate', async () => {
    const r = await rig();
    const bare = await r.app.inject({ method: 'GET', url: `/api/overlord/inbox?${by()}`, headers: r.act() });
    expect(bare.statusCode).toBe(REFUSAL_STATUS.unauthenticated);
    const wrong = await r.app.inject({ method: 'POST', url: '/api/overlord/messages/1/acknowledge', headers: { 'x-ccrc-mail-token': 'b'.repeat(64), ...r.act() }, payload: { byId: BODY, byUuid: 'u-1' } });
    expect(wrong.statusCode).toBe(REFUSAL_STATUS.unauthenticated);
    expect(r.fenceRows()).toBe(0);
  });

  it('a missing or malformed caller pair is 400 bad-request before the gate', async () => {
    const r = await rig();
    expect((await r.app.inject({ method: 'GET', url: '/api/overlord/inbox', headers: { ...HEADERS, ...r.act() } })).statusCode).toBe(400);
    expect((await r.app.inject({ method: 'GET', url: '/api/overlord/messages/1?byId=a%20b&byUuid=u-1', headers: { ...HEADERS, ...r.act() } })).statusCode).toBe(400);
    expect((await r.app.inject({ method: 'POST', url: '/api/overlord/messages/1/acknowledge', headers: { ...HEADERS, ...r.act() }, payload: { byId: BODY } })).statusCode).toBe(400);
    expect(r.fenceRows()).toBe(0);
  });

  it('a malformed id after a passing gate is 400 bad-request, and writes no ledger line', async () => {
    const r = await rig();
    for (const bad of ['abc', '0', '01', '-1', '1,2']) {
      const res = await message(r, bad);
      expect(res.statusCode, bad).toBe(400);
      expect(json(res)).toMatchObject({ ok: false, error: 'bad-request' });
      expect((await ack(r, bad)).statusCode, bad).toBe(400);
    }
    expect(r.lines()).toEqual([]);
    expect(r.calls).toEqual([]);
  });
});

describe('the inbox', () => {
  it('an active generation with an open round and two messages answers the round alone, with probe-first: 2; after the round is answered, the two messages oldest first', async () => {
    const r = await rig();
    const a = r.record(MSG_TEXT);
    const b = r.record(`${MSG_TEXT} too`);
    openProbe(r.gen, 'compaction', 3);
    const res = await inbox(r);
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toMatchObject({
      ok: true, servedBands: ['probe', 'operator'], behind: { kind: 'probe-first', count: 2 },
      rows: [{ kind: 'probe-round', key: 'probe-round:round-7', band: 'probe', roundId: 'round-7', roundKind: 'compaction', questions: 3, door: 'probe' }],
    });
    expect((json(res).rows as unknown[]).length).toBe(1);
    s.db.prepare("UPDATE continuity_probes SET answeredAt = ?, answer = 'x', grade = 'pass', book = 'closed'").run(NOW - 1_000);
    const after = json(await inbox(r));
    expect((after.rows as { key: string }[]).map((x) => x.key)).toEqual([`operator-message:${a}`, `operator-message:${b}`]);
    expect(after.behind).toEqual({ kind: 'none' });
  });

  it('a generation in degraded serves band 1 and never reads the round', async () => {
    const r = await rig({ state: 'degraded' });
    const a = r.record();
    openProbe(r.gen);
    const spy = vi.spyOn(s, 'openProbeRound');
    const res = await inbox(r);
    expect(res.statusCode, res.body).toBe(200);
    expect((json(res).rows as { key: string }[]).map((x) => x.key)).toEqual([`operator-message:${a}`]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('no row answers rows: [] with the served bands, and a message row names its id, term, state, cut and the messages door', async () => {
    const r = await rig();
    const empty = json(await inbox(r));
    expect(empty).toMatchObject({ ok: true, rows: [], servedBands: ['probe', 'operator'], behind: { kind: 'none' } });
    const id = r.record();
    const one = json(await inbox(r));
    expect(one.rows).toEqual([{
      kind: 'operator-message', key: `operator-message:${id}`, band: 'operator', at: expect.any(Number), due: { kind: 'none' }, door: 'messages',
      messageId: id, term: 1, state: 'recorded', cut: false,
    }]);
  });

  it('the answer holds no question, no expected answer and no word of any message', async () => {
    const r = await rig();
    r.record();
    r.record();
    openProbe(r.gen);
    const withRound = await inbox(r);
    s.db.prepare("UPDATE continuity_probes SET answeredAt = ?, answer = 'x', grade = 'pass', book = 'closed'").run(NOW - 1_000);
    const withMessages = await inbox(r);
    for (const res of [withRound, withMessages]) {
      expect(res.statusCode).toBe(200);
      for (const marker of ['MSG-MARKER', 'Q-MARKER', 'EXPECTED-MARKER', 'do the thing']) expect(res.body, marker).not.toContain(marker);
    }
  });

  it('an unreadable continuity_probes answers 502 naming probe, with its unmeasured line', async () => {
    const r = await rig();
    r.record();
    s.db.exec('ALTER TABLE continuity_probes RENAME TO continuity_probes_away');
    try {
      const res = await inbox(r);
      expect(res.statusCode).toBe(REFUSAL_STATUS.unmeasured);
      expect(json(res)).toMatchObject({ ok: false, error: 'unmeasured', detail: 'probe' });
    } finally { s.db.exec('ALTER TABLE continuity_probes_away RENAME TO continuity_probes'); }
    expect(r.lines()).toEqual([{ at: NOW, door: 'inbox', caller: 'overlord', scope: 'inbox', count: 0, outcome: 'unmeasured', generation: r.gen.n, generationRead: 'measured', turnState: 'done' }]);
  });

  it('unreadable unsettled messages answer 502 naming messages with an unmeasured line, and so does a server with no private store', async () => {
    const r = await rig();
    vi.spyOn(r.store, 'unsettledFacts').mockReturnValueOnce({ kind: 'unmeasured', why: 'the private store is gone' });
    const res = await inbox(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS.unmeasured);
    expect(json(res)).toMatchObject({ ok: false, error: 'unmeasured', detail: 'messages' });
    expect(res.body).not.toContain('is gone');
    expect(r.lines().map((l) => [l.door, l.outcome, l.count])).toEqual([['inbox', 'unmeasured', 0]]);
    const none = await rig({ storeUp: false });
    expect(json(await inbox(none))).toMatchObject({ error: 'unmeasured', detail: 'messages' });
  });

  it('one line a read, scope inbox, with the count served and the turn word', async () => {
    const r = await rig();
    r.record();
    r.record();
    await inbox(r);
    await inbox(r);
    expect(r.lines()).toEqual([
      { at: NOW, door: 'inbox', caller: 'overlord', scope: 'inbox', count: 2, outcome: 'rows', generation: r.gen.n, generationRead: 'measured', turnState: 'done' },
      { at: NOW, door: 'inbox', caller: 'overlord', scope: 'inbox', count: 2, outcome: 'rows', generation: r.gen.n, generationRead: 'measured', turnState: 'done' },
    ]);
  });
});

describe('messages', () => {
  it('an id answers its row, text included; one line a read, scope id:<id>', async () => {
    const r = await rig();
    const id = r.record();
    const res = await message(r, id);
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toMatchObject({ ok: true, message: { id, text: MSG_TEXT, state: 'recorded', term: 1, cut: false } });
    expect(r.lines()).toEqual([{ at: NOW, door: 'messages', caller: 'overlord', scope: `id:${id}`, count: 1, outcome: 'rows', generation: r.gen.n, generationRead: 'measured', turnState: 'done' }]);
  });

  it('a settled message is served too, in any state', async () => {
    const r = await rig();
    const id = r.record();
    r.store.moveMessage(id, 'settle', 'acknowledge', NOW);
    expect(json(await message(r, id))).toMatchObject({ ok: true, message: { id, state: 'settled', settledBy: 'acknowledge' } });
  });

  it('an absent id answers 409 said-not-operator with an absent line, scope id:7', async () => {
    const r = await rig();
    const res = await message(r, 7);
    expect(res.statusCode).toBe(REFUSAL_STATUS['said-not-operator']);
    expect(json(res)).toMatchObject({ ok: false, error: 'said-not-operator' });
    expect(r.lines()).toEqual([{ at: NOW, door: 'messages', caller: 'overlord', scope: 'id:7', count: 0, outcome: 'absent', generation: r.gen.n, generationRead: 'measured', turnState: 'done' }]);
  });

  it('the 121st fenced read in an hour answers 429 read-ceiling with retryAfterS and one read-ceiling line, and the 122nd adds none', async () => {
    const r = await rig();
    const id = r.record();
    for (let i = 0; i < READ_CEILINGS.messages.perHour; i += 1) {
      r.store.recordRead({ at: NOW - 1_800_000 + i, door: 'messages', caller: 'overlord', scope: `id:${id}`, count: 1, outcome: 'rows', generation: r.gen.n, generationRead: 'measured', turnState: 'done' });
    }
    const first = await message(r, id);
    expect(first.statusCode).toBe(REFUSAL_STATUS['read-ceiling']);
    expect(json(first)).toMatchObject({ ok: false, error: 'read-ceiling', retryAfterS: 1800 });
    expect(first.body).not.toContain('MSG-MARKER');
    const second = await message(r, id);
    expect(second.statusCode).toBe(REFUSAL_STATUS['read-ceiling']);
    const ceilingLines = r.lines().filter((l) => l.outcome === 'read-ceiling');
    expect(ceilingLines).toHaveLength(1);
    expect(ceilingLines[0]).toMatchObject({ door: 'messages', count: 0, turnState: 'done' });
  });

  it('refused fence calls write no line and do not count; the console\'s lines do not count either', async () => {
    const r = await rig();
    const id = r.record();
    for (let i = 0; i < READ_CEILINGS.messages.perHour; i += 1) {
      r.store.recordRead({ at: NOW - 1_800_000 + i, door: 'messages', caller: 'operator', scope: `id:${id}`, count: 1, outcome: 'rows', generation: null, generationRead: 'not-a-session', turnState: null });
    }
    const before = r.lines().length;
    for (let i = 0; i < 5; i += 1) expect((await message(r, id, BODY, {})).statusCode).toBe(REFUSAL_STATUS['stale-generation']);
    expect(r.lines().length).toBe(before);
    expect((await message(r, id)).statusCode).toBe(200);
  });
});

describe('acknowledge', () => {
  it('a queued message moves to settled with settledBy acknowledge; no ledger line is written; the boot pass keeps the row settled', async () => {
    const r = await rig();
    const id = r.record();
    r.store.moveMessage(id, 'queue', 'route', NOW - 10);
    const res = await ack(r, id);
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ ok: true, changed: true, state: 'settled' });
    const row = r.store.messageById(id);
    expect(row).toMatchObject({ kind: 'measured', value: { state: 'settled', settledBy: 'acknowledge', settledAt: NOW } });
    expect(r.lines()).toEqual([]);
    const settled = r.store.settledRows();
    expect(settled.kind === 'measured' && settled.value.map((x) => bootSettlement(x, { kind: 'not-applicable' }))).toEqual(['keep']);
  });

  it('a second call answers 200 changed: false and changes nothing; a spent message the same', async () => {
    const r = await rig();
    const id = r.record();
    await ack(r, id);
    const stamp = r.store.messageById(id);
    const again = await ack(r, id);
    expect(again.statusCode).toBe(200);
    expect(json(again)).toEqual({ ok: true, changed: false, state: 'settled' });
    expect(r.store.messageById(id)).toEqual(stamp);
    const spent = r.record();
    r.store.moveMessage(spent, 'spend', 'citing-door', NOW);
    const res = await ack(r, spent);
    expect(json(res)).toEqual({ ok: true, changed: false, state: 'spent' });
  });

  it('an absent id answers 409 said-not-operator', async () => {
    const r = await rig();
    const res = await ack(r, 9);
    expect(res.statusCode).toBe(REFUSAL_STATUS['said-not-operator']);
    expect(json(res)).toMatchObject({ ok: false, error: 'said-not-operator' });
  });

  it('a move the store refuses is re-read: a row settled meanwhile is 200 changed: false, and a row gone is 409', async () => {
    const r = await rig();
    const id = r.record();
    const spy = vi.spyOn(r.store, 'moveMessage').mockImplementationOnce((i) => {
      r.store.moveMessage.call(r.store, i, 'settle', 'route', NOW);
      return { ok: false, error: 'refused', detail: 'raced' };
    });
    const raced = await ack(r, id);
    expect(raced.statusCode).toBe(200);
    expect(json(raced)).toEqual({ ok: true, changed: false, state: 'settled' });
    spy.mockRestore();
    const gone = r.record();
    vi.spyOn(r.store, 'moveMessage').mockImplementationOnce(() => {
      r.db.prepare('DELETE FROM operator_messages WHERE id = ?').run(gone);
      return { ok: false, error: 'refused', detail: 'absent' };
    });
    const res = await ack(r, gone);
    expect(res.statusCode).toBe(REFUSAL_STATUS['said-not-operator']);
  });

  it('a move that fails for another reason answers 503 write-failed, and a refused move that leaves the row unsettled the same', async () => {
    const r = await rig();
    const id = r.record();
    vi.spyOn(r.store, 'moveMessage').mockReturnValueOnce({ ok: false, error: 'write-failed', detail: 'disk' });
    expect((await ack(r, id)).statusCode).toBe(REFUSAL_STATUS['write-failed']);
    vi.spyOn(r.store, 'moveMessage').mockReturnValueOnce({ ok: false, error: 'refused', detail: 'nope' });
    expect((await ack(r, id)).statusCode).toBe(REFUSAL_STATUS['write-failed']);
  });

  it('an unreadable store answers 502 unmeasured, and a server with no store 503 unavailable', async () => {
    const r = await rig();
    const id = r.record();
    r.db.close();
    expect((await ack(r, id)).statusCode).toBe(REFUSAL_STATUS.unmeasured);
    const none = await rig({ storeUp: false });
    expect((await ack(none, 1)).statusCode).toBe(REFUSAL_STATUS.unavailable);
  });

  it('a stale term answers stale-designation, and settles nothing', async () => {
    const r = await rig({ designationTerm: 2 });
    const id = r.record();
    const res = await ack(r, id);
    expect(res.statusCode).toBe(REFUSAL_STATUS['stale-designation']);
    expect(json(res)).toMatchObject({ error: 'stale-designation' });
    expect(r.store.messageById(id)).toMatchObject({ value: { state: 'recorded' } });
  });
});
