// Overlord W1 door process A1 (plan `w1-door-process.md` Task 2): `POST /api/sessions/:id/act-key`, the door process's one
// claim. The box token first, then the path's session is the sender, then the body's shape (no echo of the nonce), then the
// registry's attribution, then the facts and `actKeyClaimVerdict`. A good claim answers the key once; every refusal says its
// why in `detail`; no log line and no table holds the key or the nonce. Fixture HOMEs only, a seeded fake `Entropy`.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { CoordStore } from '../src/coord/store.js';
import { genExpectOf, type MintInput } from '../src/continuity/continuityStore.js';
import { FAKE_T0 } from './fakeTime.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { answerMasked } from '../src/server.js';
import { SHAPE_ONLY_MASKER } from '../src/accounts/mask.js';
import { CREDENTIAL_MASKS } from '../../shared/api.js';

const ID = 'lane-a-project-a';
const UUID = '11111111-2222-3333-4444-555555555555';
const NONCE = '0123456789abcdef'.repeat(4);
const NONCE2 = 'fedcba9876543210'.repeat(4);
const sha = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

let home: string;
let app: FastifyInstance | undefined;
let coord: CoordStore | undefined;
let warns: string[];

beforeEach(() => {
  home = mkTmp('ccrc-actkey-route-');
  seedRow(home, ID, { uuid: UUID, project: 'project-a' });
  warns = [];
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warns.push(a.map(String).join(' ')); });
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  app = undefined;
  coord?.db.close();
  coord = undefined;
  removeTmpFixtures();
});

const open = async (): Promise<FastifyInstance> => {
  const r = await appFor(home, recorder().run);
  coord = r.coord;
  await r.app.ready();
  return r.app;
};
let reports = 0;
/** A start report through the start door, as the hook sends it, bound to `nonce`'s hash (or to none). */
const reportStart = async (a: FastifyInstance, nonce: string | null, source = 'startup', at = FAKE_T0): Promise<number> => {
  reports += 1;
  const res = await a.inject({ method: 'POST', url: `/api/sessions/${ID}/start`, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN },
    payload: { fromId: ID, fromUuid: UUID, reportId: `r-${reports}-abcd`, source, model: null, rowIncarnation: null, reportedAt: at,
      ...(nonce === null ? {} : { doorNonceSha256: sha(nonce) }) } });
  expect(res.statusCode, res.body).toBe(202);
  return (res.json() as { id: number }).id;
};
const mintIn = (startId: number): MintInput => ({
  identity: ID, sessionId: ID, role: 'coordinator', term: 1, rowIncarnation: null, startId, startReportedAt: FAKE_T0,
  resumed: false, model: null, lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000, proc: 'p1', now: FAKE_T0,
});
/** Mints the identity's next generation from `startId`, ending the live one as the generations lane does. */
const mint = (startId: number): number => {
  const live = coord!.liveGenerations();
  if (!live.ok) throw new Error(live.detail);
  const old = live.rows.find((g) => g.identity === ID);
  const r = coord!.mintGeneration(mintIn(startId), old === undefined ? null : genExpectOf(old), true);
  if (!r.ok) throw new Error('not minted');
  return r.n;
};
const claim = (a: FastifyInstance, b: Record<string, unknown> = {}, token: string | null = ID_GATE_TOKEN, id = ID) =>
  a.inject({ method: 'POST', url: `/api/sessions/${id}/act-key`, headers: token === null ? {} : { 'x-ccrc-mail-token': token },
    payload: { fromId: id, fromUuid: UUID, nonce: NONCE, ...b } });
const why = (res: { json: () => unknown }): string => String((res.json() as { detail?: string }).detail).split(':')[0]!;
/** Every cell of every table that could hold a secret, and every log line, as one text. */
const everything = (): string =>
  [...(coord!.db.prepare('SELECT * FROM continuity_act_keys').all() as Record<string, unknown>[]),
    ...(coord!.db.prepare('SELECT * FROM continuity_starts').all() as Record<string, unknown>[])]
    .flatMap((r) => Object.values(r)).map(String).concat(warns).join('\n');

describe('POST /api/sessions/:id/act-key: the refusals, in order', () => {
  it('1. a missing or wrong box token: 401, nothing read or written', async () => {
    app = await open();
    for (const t of [null, 'e'.repeat(64)]) expect((await claim(app, {}, t)).statusCode).toBe(401);
  });
  it('2. the path\'s session is not the sender: not-owner', async () => {
    app = await open();
    const res = await claim(app, { fromId: 'lane-b-project-a' });
    expect([res.statusCode, (res.json() as { error: string }).error]).toEqual([403, 'not-owner']);
  });
  it('2. a malformed nonce: 400 bad-request with no echo of the value', async () => {
    app = await open();
    for (const nonce of ['ABCD'.repeat(16), 'a'.repeat(63), 7, null, `${NONCE}\n`]) {
      const res = await claim(app, { nonce });
      expect([res.statusCode, (res.json() as { error: string }).error], String(nonce)).toEqual([400, 'bad-request']);
      expect(res.body).not.toContain('ABCD');
    }
  });
  it('3. a sender the registry does not attribute: stale-uuid', async () => {
    app = await open();
    const res = await claim(app, { fromUuid: '99999999-2222-3333-4444-555555555555' });
    expect([res.statusCode, (res.json() as { error: string }).error]).toEqual([403, 'stale-uuid']);
  });
  it('5. no start carries the hash: 409 renewing (start-unreported)', async () => {
    app = await open();
    const res = await claim(app);
    expect([res.statusCode, (res.json() as { error: string }).error, why(res)]).toEqual([409, 'renewing', 'start-unreported']);
  });
  it('5. a store that cannot be read: 502 unmeasured (store-unreadable)', async () => {
    app = await open();
    coord!.db.exec('DROP TABLE continuity_act_keys');
    const res = await claim(app);
    expect([res.statusCode, (res.json() as { error: string }).error, why(res)]).toEqual([502, 'unmeasured', 'store-unreadable']);
  });
});

describe('POST /api/sessions/:id/act-key: the key, once', () => {
  it('a good claim answers the generation and the key once; the row keeps only its sha256', async () => {
    app = await open();
    const s = await reportStart(app, NONCE);
    expect(why(await claim(app))).toBe('not-minted');
    const n = mint(s);
    const res = await claim(app);
    expect(res.statusCode, res.body).toBe(200);
    const ans = res.json() as { ok: boolean; generation: number; key: string };
    expect(ans.ok).toBe(true);
    expect(ans.generation).toBe(n);
    expect(ans.key).toMatch(/^[0-9a-f]{64}$/);
    expect(coord!.db.prepare('SELECT nonceSha256, keySha256, counter, claimsRefused FROM continuity_act_keys').all())
      .toEqual([{ nonceSha256: sha(NONCE), keySha256: sha(ans.key), counter: 0, claimsRefused: 0 }]);
    // A second claim with the same nonce: nonce-spent, counted, never a key.
    const again = await claim(app);
    expect([again.statusCode, (again.json() as { error: string }).error, why(again)]).toEqual([409, 'stale-generation', 'nonce-spent']);
    expect(again.body).not.toContain(ans.key);
    expect(coord!.db.prepare('SELECT claimsRefused FROM continuity_act_keys').get()).toEqual({ claimsRefused: 1 });
    // No table and no log line holds the key or the nonce.
    const all = everything();
    expect(all).not.toContain(ans.key);
    expect(all).not.toContain(NONCE);
    expect(warns.some((w) => w.includes('act-key') && w.includes(ID))).toBe(true);
  });

  it('a superseded start: stale-generation (superseded) once a newer start has minted; a start with no hash never matches', async () => {
    app = await open();
    mint(await reportStart(app, NONCE, 'startup', FAKE_T0));
    mint(await reportStart(app, NONCE2, 'clear', FAKE_T0 + 10));
    expect(why(await claim(app))).toBe('superseded');
    mint(await reportStart(app, null, 'clear', FAKE_T0 + 20));
    expect(why(await claim(app, { nonce: NONCE2 }))).toBe('superseded');
  });

  it('a nested process\'s start carries the spawn\'s hash and is declined: it supersedes nothing, the key issues (review 2636 F1)', async () => {
    app = await open();
    const n = mint(await reportStart(app, NONCE, 'startup', FAKE_T0));
    // A nested Claude Code process in the pane inherits the spawn's environment, so the hook's report of its start carries
    // the same hash; the generations lane declines it (not the row's own conversation) and mints nothing from it.
    await reportStart(app, NONCE, 'resume', FAKE_T0 + 30);
    const res = await claim(app);
    expect([res.statusCode, (res.json() as { generation: number }).generation]).toEqual([200, n]);
  });

  it('a start the lane declined, with a newer start minted, answers superseded, never renewing for ever (review 2636 F1)', async () => {
    app = await open();
    await reportStart(app, NONCE, 'startup', FAKE_T0);
    mint(await reportStart(app, NONCE2, 'clear', FAKE_T0 + 10));
    expect(why(await claim(app))).toBe('superseded');
  });

  it('a compaction repeats the hash and supersedes nothing', async () => {
    app = await open();
    const s = await reportStart(app, NONCE, 'startup', FAKE_T0);
    mint(s);
    await reportStart(app, NONCE, 'compact', FAKE_T0 + 10);
    expect((await claim(app)).statusCode).toBe(200);
  });

  for (const restart of ['a crash respawn', 'a Restart', 'a swap landing', 'a wake']) {
    it(`${restart}: renewing (not-minted) while the old generation is live, then the key once the new start is minted`, async () => {
      app = await open();
      mint(await reportStart(app, NONCE2, 'startup', FAKE_T0));
      const s = await reportStart(app, NONCE, 'resume', FAKE_T0 + 10);
      const first = await claim(app);
      expect([first.statusCode, (first.json() as { error: string }).error, why(first)]).toEqual([409, 'renewing', 'not-minted']);
      const n = mint(s);
      const res = await claim(app);
      expect([res.statusCode, (res.json() as { generation: number }).generation]).toEqual([200, n]);
    });
  }

  it('a typed /clear (a second start under the same hash, minted as generation n+1) answers nonce-spent', async () => {
    app = await open();
    mint(await reportStart(app, NONCE, 'startup', FAKE_T0));
    expect((await claim(app)).statusCode).toBe(200);
    mint(await reportStart(app, NONCE, 'clear', FAKE_T0 + 10));
    const res = await claim(app);
    expect([res.statusCode, why(res)]).toEqual([409, 'nonce-spent']);
  });

  it('a generation that has ended: stale-generation (generation-ended)', async () => {
    app = await open();
    const s = await reportStart(app, NONCE, 'startup', FAKE_T0);
    mint(s);
    coord!.db.prepare("UPDATE continuity_generations SET state = 'ended' WHERE startId = ?").run(s);
    expect(why(await claim(app))).toBe('generation-ended');
  });

  it('two claims racing: the insert the second meets answers nonce-spent, never a key', async () => {
    app = await open();
    const s = await reportStart(app, NONCE, 'startup', FAKE_T0);
    const n = mint(s);
    // The first claim's row lands between the second claim's reads and its insert: planted for the same generation.
    const gen = (coord!.db.prepare('SELECT id FROM continuity_generations WHERE n = ?').get(n) as { id: number }).id;
    coord!.db.prepare('INSERT INTO continuity_act_keys (generationId, nonceSha256, keySha256, issuedAt) VALUES (?, ?, ?, ?)')
      .run(gen, sha(NONCE2), 'd'.repeat(64), FAKE_T0);
    const res = await claim(app);
    expect([res.statusCode, why(res)]).toEqual([409, 'nonce-spent']);
    expect((res.json() as { key?: string }).key).toBeUndefined();
  });
});

describe('POST /api/sessions/:id/start: the nonce hash', () => {
  it('is stored when good, null when absent, and refused bad-request when malformed', async () => {
    app = await open();
    await reportStart(app, NONCE);
    await reportStart(app, null);
    expect(coord!.db.prepare('SELECT doorNonceSha256 FROM continuity_starts ORDER BY id').all())
      .toEqual([{ doorNonceSha256: sha(NONCE) }, { doorNonceSha256: null }]);
    for (const bad of ['A'.repeat(64), 'a'.repeat(65), 5]) {
      const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/start`, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN },
        payload: { fromId: ID, fromUuid: UUID, reportId: 'r-bad-0001', source: 'startup', reportedAt: FAKE_T0, doorNonceSha256: bad } });
      expect([res.statusCode, (res.json() as { detail: string }).detail], String(bad)).toEqual([400, 'doorNonceSha256']);
    }
  });
});

describe('the act-key answer and the answer mask (review 2660 F1)', () => {
  // The answer goes through the one answer hook: the route is not in `WRITE_ANSWER_EXEMPT` (`server.ts`). That is safe only
  // while no credential shape matches a key, so this pins both: if a later mask pattern caught 64 lowercase hex, the door
  // process would receive placeholder text instead of its key and fail closed with no reason given. Exempting the route
  // instead is a change to the exempt list, and to this case.
  it('is masked, and the mask hands every key through byte for byte', () => {
    expect(answerMasked('POST', '/api/sessions/:id/act-key')).toBe(true);
    for (let i = 0; i < 256; i += 1) {
      const key = sha(`act-key-${i}`);
      for (const m of CREDENTIAL_MASKS) expect(new RegExp(m.source).test(key), m.id).toBe(false);
      const answer = { ok: true, generation: 3, key };
      expect(SHAPE_ONLY_MASKER.maskDeep(answer)).toEqual(answer);
    }
  });
});
