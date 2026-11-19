// Overlord W1 gates B, Task 5: the gate runner (`coord/overlordGateRun.ts`) in a real Fastify route, with fake ports and a
// real fixture coord.db behind the three store-backed ones (`actKey`, `counter`, `recordFenceRefusal`), so the counter race
// is real. One shared fixture database; every case mints its own generation and its own key.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { actKeyOf, issueActKey } from '../src/continuity/actKeyStore.js';
import { genExpectOf, type GenRow, type MintInput } from '../src/continuity/continuityStore.js';
import { OVERLORD_DOORS } from '../src/coord/overlordDoors.js';
import { overlordGateRun, type OverlordGateDeps, type WitnessCheck } from '../src/coord/overlordGateRun.js';
import { actKeyFact, advanceCounterGuarded, recordFenceRefusal } from '../src/coord/overlordGateStore.js';
import type { WitnessVerdict } from '../src/coord/overlordGate.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { ACT_COUNTER_HEADER, ACT_GENERATION_HEADER, ACT_KEY_HEADER, WITNESS_KEY_HEADER } from '../../shared/continuity-door.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const NOW = 1_800_000_000_000;
const BODY = 'lane-a-overlord';
const COORDINATOR = 'lane-a-project-a';
const INC = 'inc-1';
/** The binding the L5 composition gives the witness port until door process B lands: it refuses, never passes. */
const DEFAULT_WITNESS: WitnessVerdict = { kind: 'unmeasured', why: 'the witness report is not built' };
const WITNESSED: WitnessVerdict = { kind: 'witnessed', witnessId: 7 };
const DESIGNATED = {
  kind: 'designated', sessionId: BODY, term: 1,
  row: { bound: { sessionId: BODY, generation: INC }, pending: null, term: 1, designatedTerm: 1 },
} as unknown as DesignationRead;

let s: CoordStore;
let seq = 0;
beforeAll(() => { s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-gaterun-'), '.ccrc', 'coord.db'))); });
afterAll(removeTmpFixtures);
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  s.db.exec('DELETE FROM overlord_fence_refusals');
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

/** Mint the overlord identity's next generation with its own act key; answers the row and the key text. */
function fresh(keyText?: string): { gen: GenRow; key: string } {
  seq += 1;
  const key = keyText ?? createHash('sha256').update(`key-${seq}`).digest('hex');
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
  const after = s.liveGenerations();
  if (!after.ok) throw new Error(after.detail);
  const gen = after.rows.find((g) => g.id === m.id)!;
  const issued = issueActKey(s.db, { generationId: gen.id, nonceSha256: createHash('sha256').update(`n-${seq}`).digest('hex'),
    keySha256: createHash('sha256').update(key, 'utf8').digest('hex'), issuedAt: NOW });
  if (!issued.ok) throw new Error('key not issued');
  return { gen, key };
}
const storedCounter = (g: GenRow): number => {
  const r = actKeyOf(s.db, g.id);
  if (!r.ok || r.value === 'none') throw new Error('no row');
  return r.value.counter;
};
const fenceRows = (): { sessionId: string; door: string; why: string; generationId: number | null }[] =>
  s.db.prepare('SELECT sessionId, generationId, door, why FROM overlord_fence_refusals ORDER BY id').all() as never;

interface Rig { app: FastifyInstance; incarnationCalls: () => number; witnessChecks: WitnessCheck[]; cardCalls: () => number }
async function rig(over: Partial<OverlordGateDeps> = {}): Promise<Rig> {
  let incarnationCalls = 0;
  let cardCalls = 0;
  const witnessChecks: WitnessCheck[] = [];
  const deps: OverlordGateDeps = {
    identity: {
      session: async (sessionId, uuid) => ({ ok: true, sessionId, uuid, actor: { kind: 'session', subject: sessionId } as never }),
      incarnation: async () => { incarnationCalls += 1; return { kind: 'measured', incarnation: INC } as never; },
    },
    designation: () => DESIGNATED,
    authority: () => ({ kind: 'coherent' }),
    ladder: () => ({ kind: 'read', rung: { rung: 'full', operatorRung: 'full', binding: [], readBy: [] } }),
    generations: () => s.liveGenerations(),
    continuityLive: () => true,
    cardRead: () => { cardCalls += 1; return { ok: true, read: null }; },
    actKey: (g, k) => actKeyFact(s.db, g, k),
    counter: (g, c) => advanceCounterGuarded(s.db, g, c),
    witness: () => WITNESSED,
    recordWitness: (c) => { witnessChecks.push(c); },
    recordFenceRefusal: (r) => { recordFenceRefusal(s.db, r); },
    serverWords: () => ['continuity-v1'],
    now: () => NOW,
    ...over,
  };
  const run = overlordGateRun(deps);
  const app = Fastify({ logger: false });
  apps.push(app);
  app.all('/gate/:key', async (req, reply) => {
    const q = req.query as { s?: string };
    const g = await run(req, reply, (req.params as { key: string }).key, { sessionId: q.s ?? BODY, uuid: 'u-1', uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;
    return { ok: true, gate: g.kind };
  });
  await app.ready();
  return { app, incarnationCalls: () => incarnationCalls, witnessChecks, cardCalls: () => cardCalls };
}
const call = (r: Rig, key: string, headers: Record<string, string> = {}, who: string = BODY) =>
  r.app.inject({ method: key === 'notes-read' ? 'GET' : 'POST', url: `/gate/${key}?s=${who}`, headers });
const act = (gen: GenRow, key: string, counter: number, witness = 'w-1'): Record<string, string> =>
  ({ [ACT_KEY_HEADER]: key, [ACT_GENERATION_HEADER]: String(gen.n), [ACT_COUNTER_HEADER]: String(counter), [WITNESS_KEY_HEADER]: witness });
const json = (res: { body: string }): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;

describe('step 1: who calls', () => {
  it('a coordinator at a start door gets hook, and the incarnation port is never called', async () => {
    const r = await rig();
    const res = await call(r, 'notes-write', {}, COORDINATOR);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, gate: 'hook' });
    const res2 = await call(r, 'notes-read', {}, COORDINATOR);
    expect(json(res2)).toEqual({ ok: true, gate: 'hook' });
    expect(r.incarnationCalls()).toBe(0);
  });
  it('a bound id with a differing incarnation is refused 403 not-the-overlord at a read and a write start door, recording nothing', async () => {
    const { gen, key } = fresh();
    const r = await rig({ identity: {
      session: async (sessionId, uuid) => ({ ok: true, sessionId, uuid, actor: {} as never }),
      incarnation: async () => ({ kind: 'measured', incarnation: 'inc-other' }) as never,
    } });
    for (const door of ['notes-read', 'notes-write']) {
      const res = await call(r, door, act(gen, key, 1));
      expect(res.statusCode).toBe(403);
      expect(json(res)).toMatchObject({ ok: false, error: 'not-the-overlord' });
    }
    expect(r.witnessChecks).toEqual([]);
    expect(fenceRows()).toEqual([]);
    expect(storedCounter(gen)).toBe(0);
  });
});

describe('a write start door: steps 5, 7, 7a and the counter', () => {
  it('the designated session with the right key, generation and a higher counter passes; the counter advanced and the witness was spent once', async () => {
    const { gen, key } = fresh();
    const r = await rig();
    const res = await call(r, 'notes-write', act(gen, key, 3));
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, gate: 'pass' });
    expect(storedCounter(gen)).toBe(3);
    expect(r.witnessChecks).toHaveLength(1);
    expect(r.witnessChecks[0]).toMatchObject({ outcome: 'used', witnessId: 7, sessionId: BODY, generationId: gen.id, door: 'notes-write', why: null });
    expect(fenceRows()).toEqual([]);
  });
  it('two concurrent writes presenting one counter: one passes, one is refused 409 stale-generation naming a fork, and one fence row records it', async () => {
    const { gen, key } = fresh();
    const r = await rig();
    const [a, b] = await Promise.all([call(r, 'notes-write', act(gen, key, 1)), call(r, 'notes-write', act(gen, key, 1))]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(json(loser)).toMatchObject({ ok: false, error: 'stale-generation' });
    expect(String(json(loser).detail)).toContain('fork');
    expect(storedCounter(gen)).toBe(1);
    expect(fenceRows()).toEqual([{ sessionId: BODY, generationId: gen.id, door: 'notes-write', why: 'fork' }]);
  });
  it('the counter arm is a TOCTOU re-check: a stale read of the stored counter still loses at the compare-and-set', async () => {
    const { gen, key } = fresh();
    // The key read always answers counter 0, as a read made before a racing write would; only the guarded write can tell.
    const r = await rig({ actKey: (g, k) => { const f = actKeyFact(s.db, g, k); return f.kind === 'read' ? { ...f, counter: 0 } : f; } });
    const first = await call(r, 'notes-write', act(gen, key, 2));
    const second = await call(r, 'notes-write', act(gen, key, 2));
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(String(json(second).detail)).toContain('fork');
    expect(json(second)).toMatchObject({ step: '7' });
    expect(fenceRows().map((x) => x.why)).toEqual(['fork']);
  });
  it('a wrong key is refused 409 stale-generation with one key-mismatch row, and the witness is never spent', async () => {
    const { gen } = fresh();
    const r = await rig();
    const res = await call(r, 'notes-write', act(gen, 'b'.repeat(64), 1));
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ ok: false, error: 'stale-generation' });
    expect(fenceRows()).toEqual([{ sessionId: BODY, generationId: gen.id, door: 'notes-write', why: 'key-mismatch' }]);
    expect(r.witnessChecks).toEqual([]);
    expect(storedCounter(gen)).toBe(0);
  });
  it('no act headers at all: 409 stale-generation, detail "no act key presented", one no-key row', async () => {
    fresh();
    const r = await rig();
    const res = await call(r, 'notes-write', {});
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ ok: false, error: 'stale-generation', detail: 'no act key presented' });
    expect(fenceRows().map((x) => x.why)).toEqual(['no-key']);
    expect(r.witnessChecks).toEqual([]);
  });
});

describe('the witness (step 7a)', () => {
  it('the default binding refuses 502 unmeasured at a write door and records nothing', async () => {
    const { gen, key } = fresh();
    const r = await rig({ witness: () => DEFAULT_WITNESS });
    const res = await call(r, 'notes-write', act(gen, key, 1));
    expect(res.statusCode).toBe(502);
    expect(json(res)).toMatchObject({ ok: false, error: 'unmeasured', step: '7a' });
    expect(r.witnessChecks).toEqual([]);
    expect(fenceRows()).toEqual([]);
    expect(storedCounter(gen)).toBe(0);
  });
  it('an unwitnessed write is refused 409 unwitnessed and records one unwitnessed check', async () => {
    const { gen, key } = fresh();
    const r = await rig({ witness: () => ({ kind: 'unwitnessed', why: 'none' }) });
    const res = await call(r, 'notes-write', act(gen, key, 1));
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ ok: false, error: 'unwitnessed' });
    expect(r.witnessChecks).toHaveLength(1);
    expect(r.witnessChecks[0]).toMatchObject({ outcome: 'unwitnessed', witnessId: null, why: 'none', generationId: gen.id });
    expect(fenceRows()).toEqual([]);
    expect(storedCounter(gen)).toBe(0);
  });
});

describe('unmeasured facts refuse unavailable, never pass', () => {
  const closedDb = (): DatabaseSync => { const d = new DatabaseSync(':memory:'); d.close(); return d; };
  const cases: [string, () => Partial<OverlordGateDeps>][] = [
    ['a generations port that throws', () => ({ generations: () => { throw new Error('boom'); } })],
    ['a generations read that answers not-ok', () => ({ generations: () => ({ ok: false, detail: 'unreadable' }) })],
    ['a closed database behind the key read', () => ({ actKey: (g, k) => actKeyFact(closedDb(), g, k) })],
    ['a key read that answers unmeasured', () => ({ actKey: () => ({ kind: 'unmeasured', why: 'no table' }) })],
    ['a key read that throws', () => ({ actKey: () => { throw new Error('boom'); } })],
  ];
  for (const [name, over] of cases) {
    it(`${name}: 503 unavailable at a write door, no pass, nothing spent`, async () => {
      const { gen, key } = fresh();
      const r = await rig(over());
      const res = await call(r, 'notes-write', act(gen, key, 1));
      expect(res.statusCode).toBe(503);
      expect(json(res)).toMatchObject({ ok: false, error: 'unavailable' });
      expect(r.witnessChecks).toEqual([]);
      expect(fenceRows()).toEqual([]);
      expect(storedCounter(gen)).toBe(0);
    });
  }
  it('the counter port answering unmeasured, or throwing, refuses 503 unavailable at step 7', async () => {
    const { gen, key } = fresh();
    for (const counter of [(): 'unmeasured' => 'unmeasured', (): never => { throw new Error('boom'); }]) {
      const r = await rig({ counter });
      const res = await call(r, 'notes-write', act(gen, key, 1));
      expect(res.statusCode).toBe(503);
      expect(json(res)).toMatchObject({ ok: false, error: 'unavailable', step: '7' });
    }
    expect(fenceRows()).toEqual([]);
  });
  it('an unreadable designation refuses 503 unavailable at step 1', async () => {
    const r = await rig({ designation: () => { throw new Error('boom'); } });
    const res = await call(r, 'notes-read', {});
    expect(res.statusCode).toBe(503);
    expect(json(res)).toMatchObject({ ok: false, error: 'unavailable', step: '1' });
  });
  // The card port is reached only past step 8, and every row in the door table is a `card-probe-note` start door, which skips
  // step 8. A test-local row (the table is a plain object, `doorRow` reads it by name) gives the runner a door that reads it.
  describe('the card port, at a test-local door of class other', () => {
    const KEY_ROW = 'test-card-door';
    beforeAll(() => {
      (OVERLORD_DOORS as Record<string, unknown>)[KEY_ROW] = { group: 'overlord', method: 'GET', path: '/api/test/card', file: 'none', verbClass: 'view',
        write: false, word: 'continuity-v1', others: 'refuse', ladderClass: 'other', act: 'read' };
    });
    afterAll(() => { delete (OVERLORD_DOORS as Record<string, unknown>)[KEY_ROW]; });
    it('a card read that throws refuses 503 unavailable at step 8', async () => {
      fresh();
      const r = await rig({ cardRead: () => { throw new Error('boom'); } });
      const res = await call(r, KEY_ROW);
      expect(res.statusCode).toBe(503);
      expect(json(res)).toMatchObject({ ok: false, error: 'unavailable', step: '8' });
    });
    it('a card read that answers not-ok refuses 503 unavailable at step 8', async () => {
      fresh();
      const r = await rig({ cardRead: () => ({ ok: false, detail: 'unreadable' }) });
      const res = await call(r, KEY_ROW);
      expect(res.statusCode).toBe(503);
      expect(json(res)).toMatchObject({ error: 'unavailable', step: '8' });
    });
    it('an unread card refuses card-unread, and the port is asked (control: the door does read it)', async () => {
      fresh();
      const r = await rig();
      const res = await call(r, KEY_ROW);
      expect(json(res)).toMatchObject({ ok: false, error: 'card-unread', step: '8' });
      expect(r.cardCalls()).toBe(1);
    });
  });
  it('a start door never reads the card port', async () => {
    const { gen, key } = fresh();
    const r = await rig();
    await call(r, 'notes-write', act(gen, key, 1));
    await call(r, 'notes-read');
    expect(r.cardCalls()).toBe(0);
  });
});

describe('a passing write: the counter first, then the witness spend (review 2803 F2, N2, N3)', () => {
  it('the counter is advanced BEFORE the witness is recorded', async () => {
    const { gen, key } = fresh();
    const order: string[] = [];
    const r = await rig({
      counter: (g, c) => { order.push('counter'); return advanceCounterGuarded(s.db, g, c); },
      recordWitness: (c) => { order.push(`witness:${c.outcome}`); },
    });
    const res = await call(r, 'notes-write', act(gen, key, 1));
    expect(res.statusCode).toBe(200);
    expect(order).toEqual(['counter', 'witness:used']);
  });
  it('a counter that answers unmeasured refuses 503 with the witness unspent, and a retry with the same witness passes', async () => {
    const { gen, key } = fresh();
    const spent: string[] = [];
    const r1 = await rig({ counter: () => 'unmeasured', recordWitness: (c) => { spent.push(c.outcome); } });
    const res1 = await call(r1, 'notes-write', act(gen, key, 1, 'w-same'));
    expect(res1.statusCode).toBe(503);
    expect(json(res1)).toMatchObject({ ok: false, error: 'unavailable', step: '7' });
    expect(spent).toEqual([]);
    expect(storedCounter(gen)).toBe(0);
    const r2 = await rig({ recordWitness: (c) => { spent.push(c.outcome); } });
    const res2 = await call(r2, 'notes-write', act(gen, key, 1, 'w-same'));
    expect(res2.statusCode).toBe(200);
    expect(spent).toEqual(['used']);
    expect(storedCounter(gen)).toBe(1);
  });
  it('a recordWitness that throws on the used record refuses 503 unavailable at step 7a', async () => {
    const { gen, key } = fresh();
    const r = await rig({ recordWitness: () => { throw new Error('disk full'); } });
    const res = await call(r, 'notes-write', act(gen, key, 1));
    expect(res.statusCode).toBe(503);
    expect(json(res)).toMatchObject({ ok: false, error: 'unavailable', step: '7a' });
  });
  it('a witness port that throws puts no part of its message in the reply (N3)', async () => {
    const { gen, key } = fresh();
    const hex = 'a1b2c3d4e5f60718'.repeat(4);
    const r = await rig({ witness: () => { throw new Error(`no report for ${hex}`); } });
    const res = await call(r, 'notes-write', act(gen, key, 1));
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain(hex);
    expect(json(res)).toMatchObject({ error: 'unmeasured', step: '7a', detail: expect.stringContaining('the witness lookup failed') });
  });
  it('a serverWords port that throws refuses 503 unavailable at step 2 (N2)', async () => {
    const r = await rig({ serverWords: () => { throw new Error('boom'); } });
    const res = await call(r, 'notes-read', {});
    expect(res.statusCode).toBe(503);
    expect(json(res)).toMatchObject({ ok: false, error: 'unavailable', step: '2' });
  });
});

describe('the act key is never answered, recorded or logged', () => {
  const SECRET = 'f0e1d2c3b4a59687'.repeat(4);
  it('appears in no reply body, no fence-refusal row and no console.warn line, whether it was right or wrong', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bodies: string[] = [];
    // wrong key: the secret presented against a live generation that holds another key
    const other = fresh();
    const r = await rig();
    bodies.push((await call(r, 'notes-write', act(other.gen, SECRET, 1))).body);
    // then the generation that does hold it
    const { gen } = fresh(SECRET);
    // right key, fork (counter not above the stored one), then no key, then a pass
    expect((await call(r, 'notes-write', act(gen, SECRET, 2))).statusCode).toBe(200);
    bodies.push((await call(r, 'notes-write', act(gen, SECRET, 2))).body);
    bodies.push((await call(r, 'notes-write', act(gen, SECRET, 3))).body);
    const failing = await rig({ actKey: () => ({ kind: 'unmeasured', why: 'no table' }) });
    bodies.push((await call(failing, 'notes-write', act(gen, SECRET, 4))).body);
    expect(fenceRows().length).toBeGreaterThan(0);
    const rows = JSON.stringify(s.db.prepare('SELECT * FROM overlord_fence_refusals').all());
    expect(rows).not.toContain(SECRET);
    for (const b of bodies) expect(b).not.toContain(SECRET);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
  });
});

describe('the runner holds no gate word', () => {
  it('overlordGateRun.ts, comments stripped, spells none of the gate words as a string literal', () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'coord', 'overlordGateRun.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const words = ['not-the-overlord', 'stale-designation', 'stale-generation', 'card-unread', 'unwitnessed', 'renewing', 'overlord-off',
      'rung-below', 'launch-profile-unmet', 'authority-rolled-back', 'capability-missing'];
    const spelled = words.filter((w) => new RegExp(`['"\`]${w}['"\`]`).test(code));
    expect(spelled).toEqual([]);
    // Control: the scan sees a literal when one is there.
    expect(new RegExp(`['"\`]renewing['"\`]`).test(`${code}\nconst x = 'renewing';`)).toBe(true);
  });
});
