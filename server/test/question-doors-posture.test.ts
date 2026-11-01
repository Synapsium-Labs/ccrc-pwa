// W3 Q3f's characterization pin (D-7030; ARCH-57 (#792), server half; plan
// 2026-10-26-consolidation-w3-questions.md, Task Q3f Step 1, Review focus 3). Each answer door's AUTH POSTURE, measured
// live through an ARMED gate rather than read off the tables: what each door answers a request with no credential, with
// a live session cookie, with the box token, and with either credential from a foreign `Origin`. `question-doors-pin`
// holds every refusal and success after the gate and `requireMailToken`; this file holds the step before them, so an
// alias that changed principals (a box-token request reaching an operator's press, a session reaching a claimant's
// ruling) reds here with the door's name. Green on the old code, and run unedited through every Q3f commit.
//
// HOW A ROW READS. `door | credential` and its outcome `{status, gate, error}`: `gate` is whether THE GATE refused it
// (a 401 carrying a `verdict`), never the route's own 401, and `error` the body's word. The body each request sends is
// deliberately not a valid answer (`{}`), so a request the gate and the box token let through stops at the door's first
// body check, before any store read or keystroke: the property is who got that far, not what they then did.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { PtyLike } from '../src/pty.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const BOX_TOKEN = 'box-token-for-the-door-posture-pin';
const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

/** An armed server with a passphrase, the box token and a coordination store, as a live box is. */
const armedApp = async (): Promise<FastifyInstance> => {
  const home = mkTmp('ccrc-door-posture-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const base = testDeps(home);
  const deps: Deps = {
    ...base, cfg: { ...base.cfg, authEnabled: true, cookieSecure: false }, mailToken: BOX_TOKEN, spawnPty: stubPty,
    coord: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))),
  };
  const a = await buildServer(deps);
  await a.ready();
  return a;
};

const login = async (a: FastifyInstance): Promise<string> => {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};

type Credential = 'none' | 'session' | 'token' | 'session, foreign origin' | 'token, foreign origin';
const CREDENTIALS: readonly Credential[] = ['none', 'session', 'token', 'session, foreign origin', 'token, foreign origin'];
const FOREIGN = { origin: 'https://foreign.example' };

/** One door's outcome for one credential. */
interface Posture { status: number; gate: boolean; error: unknown }

const postureOf = async (url: string, cred: Credential): Promise<Posture> => {
  app = await armedApp();
  const headers: Record<string, string> = {
    ...(cred.startsWith('session') ? { cookie: await login(app) } : {}),
    ...(cred.startsWith('token') ? { 'x-ccrc-mail-token': BOX_TOKEN } : {}),
    ...(cred.endsWith('foreign origin') ? FOREIGN : {}),
  };
  const res = await app.inject({ method: 'POST', url, headers, payload: {} });
  const body = JSON.parse(res.body) as { error?: unknown; verdict?: unknown };
  return { status: res.statusCode, gate: res.statusCode === 401 && typeof body.verdict === 'string', error: body.error ?? null };
};

/** The old doors, each with a concrete url its router matches. */
const OLD_DOORS: Readonly<Record<string, string>> = {
  'POST /api/approvals/:id/release': '/api/approvals/1/release',
  'POST /api/sessions/:id/dialog/tab': '/api/sessions/project-a-quiet-basin/dialog/tab',
};

/** What a claimant door answers: the gate never refuses it (EXEMPT), the box token is its credential (a session alone
 *  is the route's own 401 `unauthenticated`, no verdict), a valid token reaches its body check (`bad-request`), and no
 *  origin is checked. */
const CLAIMANT: Readonly<Record<Credential, Posture>> = {
  none: { status: 401, gate: false, error: 'unauthenticated' },
  session: { status: 401, gate: false, error: 'unauthenticated' },
  token: { status: 400, gate: false, error: 'bad-request' },
  'session, foreign origin': { status: 401, gate: false, error: 'unauthenticated' },
  'token, foreign origin': { status: 400, gate: false, error: 'bad-request' },
};

/** What an operator door answers: the gate refuses no credential and the box token alike (a verdict-carrying 401), a
 *  live session reaches the door (an unregistered session id: `unknown-session`), and a foreign origin is refused
 *  (`403 foreign-origin`) before the door runs, whichever credential it carries. */
const OPERATOR: Readonly<Record<Credential, Posture>> = {
  none: { status: 401, gate: true, error: 'unauthenticated' },
  session: { status: 404, gate: false, error: 'unknown-session' },
  token: { status: 401, gate: true, error: 'unauthenticated' },
  'session, foreign origin': { status: 403, gate: false, error: 'foreign-origin' },
  'token, foreign origin': { status: 403, gate: false, error: 'foreign-origin' },
};

/** What a RETIRED door answers (W7 C7p, D-7194, the operator's; K5 Q3l, D-7324, the claimant's): the gate refuses no
 *  credential and the box token alike, and a foreign origin; a live session reaches no door at all (fastify's own 404,
 *  `Not Found`, never a door's word), so nothing past the gate runs. A retired operator door's rows moved to
 *  `POST /api/questions/:id/answer` (`NEW_DOORS`), which keeps the `OPERATOR` posture; a retired claimant door's to the
 *  family's `/rule` or `/release`, which keep the `CLAIMANT` posture (a claimant alias leaves `EXEMPT` with its
 *  registration, so the gate now refuses its no-credential and box-token callers, as for any route it does not name). */
const RETIRED: Readonly<Record<Credential, Posture>> = {
  none: { status: 401, gate: true, error: 'unauthenticated' },
  session: { status: 404, gate: false, error: 'Not Found' },
  token: { status: 401, gate: true, error: 'unauthenticated' },
  'session, foreign origin': { status: 403, gate: false, error: 'foreign-origin' },
  'token, foreign origin': { status: 403, gate: false, error: 'foreign-origin' },
};

/** The doors W7 C7p (the operator's) and K5 Q3l (the claimant's) retired, each with the url its router matched. */
const RETIRED_DOORS: Readonly<Record<string, string>> = {
  'POST /api/asks/:id/answer': '/api/asks/1/answer',
  'POST /api/asks/:id/release': '/api/asks/1/release',
  'POST /api/approvals/:id/rule': '/api/approvals/1/rule',
  'POST /api/sessions/:id/ask': '/api/sessions/project-a-quiet-basin/ask',
  'POST /api/sessions/:id/dialog/multi': '/api/sessions/project-a-quiet-basin/dialog/multi',
  'POST /api/sessions/:id/dialog/text': '/api/sessions/project-a-quiet-basin/dialog/text',
  'POST /api/sessions/:id/dialog': '/api/sessions/project-a-quiet-basin/dialog',
};

const EXPECTED: Readonly<Record<string, Readonly<Record<Credential, Posture>>>> = {
  'POST /api/approvals/:id/release': CLAIMANT,
  'POST /api/sessions/:id/dialog/tab': OPERATOR,
};

describe('question-doors posture: each old door through an armed gate (W3 Q3f, D-7030)', () => {
  it('every door has an expectation', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(OLD_DOORS).sort());
  });

  it.each(Object.entries(OLD_DOORS).flatMap(([door, url]) => CREDENTIALS.map((c) => [`${door} | ${c}`, door, url, c] as const)))(
    '%s', async (_name, door, url, cred) => {
      expect(await postureOf(url, cred)).toEqual(EXPECTED[door]![cred]);
    });

  it.each(Object.entries(RETIRED_DOORS).flatMap(([door, url]) => CREDENTIALS.map((c) => [`${door} (retired) | ${c}`, url, c] as const)))(
    '%s', async (_name, url, cred) => {
      expect(await postureOf(url, cred)).toEqual(RETIRED[cred]);
    });

  // The new family's rows (Task Q3f Step 3): the operator's door takes the operator doors' posture, the claimant's two
  // take the claimant doors'. The path picks the principal (OA-C7 (a)).
  const NEW_DOORS: ReadonlyArray<readonly [string, string, Readonly<Record<Credential, Posture>>]> = [
    ['POST /api/questions/:id/answer', '/api/questions/session-project-a-quiet-basin/answer', OPERATOR],
    ['POST /api/questions/:id/rule', '/api/questions/ask-1/rule', CLAIMANT],
    ['POST /api/questions/:id/release', '/api/questions/ask-1/release', CLAIMANT],
    // K5 Q3l (D-7324): a retired approval alias's CLAIMANT posture, held on the family's approval id.
    ['POST /api/questions/:id/rule', '/api/questions/approval-1/rule', CLAIMANT],
  ];
  it.each(NEW_DOORS.flatMap(([door, url, want]) => CREDENTIALS.map((c) => [`${door} | ${c}`, url, want, c] as const)))(
    '%s', async (_name, url, want, cred) => {
      expect(await postureOf(url, cred)).toEqual(want[cred]);
    });
});
