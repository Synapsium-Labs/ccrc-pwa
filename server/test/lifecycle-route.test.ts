import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { LC_ACT_UNKNOWN, LIFECYCLE_ACTS } from '../../shared/api.js';

const TOKEN = 'f'.repeat(64);
const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
const GEN = '1755780000000000000';
const tok = { 'x-ccrc-mail-token': TOKEN };
// D-39: an ARMED box with no passphrase file fails SHUT as `'unconfigured'`,
// not `'no-session'` (`gate.ts:416`) — decided ONCE at boot from the secret
// file's state, `server.ts`'s "ARMED WITH NO PASSPHRASE" branch. The auth test
// below needs the ordinary "nobody is logged in yet" verdict, so it seeds a
// passphrase first, exactly as `auth-gate.test.ts`'s `openApp` and
// `auth-passkey.test.ts`'s `openRunsApp`/`GET /api/runs`'s own 501-before-auth
// case do — this brief's own sample omitted it, which is why this is here
// rather than in the brief's code block.
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';

const seeded = async (over: Partial<Deps> = {}, withCoord = true) => {
  const home = mkTmp('ccrc-lcroute-');
  const base = testDeps(home);
  const coord = withCoord
    ? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')))
    : undefined;
  if (coord) {
    coord.ingestJournal({
      gen: GEN, cursor: 300, size: 300, at: 9,
      rows: [
        parseJournalLine(JSON.stringify({ uid: 'a.1', at: 100, act: AN_ACT, outcome: 'intent',
                                          verb: 'ws-rm', id: 'demo-quiet-basin' })),
        parseJournalLine(JSON.stringify({ uid: 'a.2', at: 110, act: AN_ACT, outcome: 'refused',
                                          verb: 'ws-rm', id: 'demo-quiet-basin', refusal: 'held' })),
        parseJournalLine(JSON.stringify({ uid: 'b.1', at: 120, act: AN_ACT, outcome: 'done',
                                          verb: 'forget', id: 'other-session' })),
      ],
    });
    coord.recordGap({ at: 20, gen: GEN, reason: 'rotated-away', detail: 'undrained',
                      lostFrom: 0, lostTo: 40 });
  }
  const app = await buildServer({ ...base, mailToken: TOKEN, ...(coord ? { coord } : {}), ...over });
  return { app, coord };
};

describe('GET /api/lifecycle', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it("answers one session's timeline oldest-first, with its gaps", async () => {
    const w = await seeded(); app = w.app;
    const res = await app.inject({
      method: 'GET', url: '/api/lifecycle?session=demo-quiet-basin', headers: tok,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: { uid: string; id: string; refusal: string | null }[];
                                 gaps: { reason: string }[] };
    expect(body.events.map((e) => e.uid)).toEqual(['a.1', 'a.2']);
    expect(body.events[0]!.id).toBe('demo-quiet-basin');
    expect(body.events[1]!.refusal).toBe('held');
    expect(body.gaps.map((g) => g.reason)).toEqual(['rotated-away']);
  });

  it('answers the whole fleet when no session is named', async () => {
    const w = await seeded(); app = w.app;
    const body = (await app.inject({ method: 'GET', url: '/api/lifecycle', headers: tok }))
      .json() as { events: { uid: string }[] };
    expect(body.events.map((e) => e.uid)).toEqual(['a.1', 'a.2', 'b.1']);
  });

  it('clamps `limit` rather than trusting it, and survives its absence', async () => {
    const w = await seeded(); app = w.app;
    const two = (await app.inject({ method: 'GET', url: '/api/lifecycle?limit=2', headers: tok }))
      .json() as { events: { uid: string }[] };
    expect(two.events.map((e) => e.uid)).toEqual(['a.2', 'b.1']);
    const huge = (await app.inject({ method: 'GET', url: '/api/lifecycle?limit=99999', headers: tok }))
      .json() as { events: unknown[] };
    expect(huge.events).toHaveLength(3);
    // No `limit` at all: `Number(undefined)` is NaN, which `lifecycleFor`'s
    // `Number.isFinite` guard answers with the page maximum. Pinned so nobody
    // "fixes" the handler into `?? undefined`.
    const none = (await app.inject({ method: 'GET', url: '/api/lifecycle', headers: tok }))
      .json() as { events: unknown[] };
    expect(none.events).toHaveLength(3);
  });

  it('AUTHENTICATES BEFORE ANSWERING 501 — a 501 would publish whether this box runs coordination', async () => {
    const home = mkTmp('ccrc-lcroute-');
    const base = testDeps(home);
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
    const w = await seeded({ cfg: { ...base.cfg, authEnabled: true } } as Partial<Deps>, false);
    app = w.app;
    const anon = await app.inject({ method: 'GET', url: '/api/lifecycle' });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ ok: false, error: 'unauthenticated', verdict: 'no-session' });
    const withToken = await app.inject({ method: 'GET', url: '/api/lifecycle', headers: tok });
    expect(withToken.statusCode).toBe(501);
    expect(withToken.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('is FLAG-AWARE — a dark box behaves exactly as it did before this slice', async () => {
    const w = await seeded(); app = w.app;     // testDeps leaves CCRC_AUTH off
    const res = await app.inject({ method: 'GET', url: '/api/lifecycle' });
    expect(res.statusCode).toBe(200);
  });
});
