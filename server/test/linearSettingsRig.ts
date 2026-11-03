/**
 * The Settings routes' test rig (#1444, spec §10.1, plan task LK11): the four `/api/linear/workspaces` routes and the four
 * legacy `/api/linear/connection` routes on one bare Fastify instance, with the REAL account gate and the real step-up
 * store, so the credential posture is measured here and not assumed (`linear-connection-routes.test.ts`'s rig, for the
 * new routes). The services come from `linearServicesFake`, the Linear stand-in from `linearProxyRig.ts`'s
 * `linearStandIn`, which answers each fixed document in the shape the spec gives it.
 *
 * NOTHING HERE IS RECORDED. No answer here stands for one Linear sent, and no `X-Complexity` or header value is
 * spelled; a row that needs a recorded answer passes a `respond` built from the FX capture's recordings
 * (`linearRecorded.ts`). Fixture vocabulary only: workspaces `ws-a` and `ws-b`, team keys `AAA` and `BBB`, keys of the
 * shape `lin_api_fixture…`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest, type LightMyRequestResponse } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { createAccountGate, type AccountGate } from '../src/accounts/gate.js';
import { measureSecret, sessionVerdict } from '../src/auth/gate.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { SESSION_COOKIE } from '../src/auth/cookie.js';
import { SessionStore, sessionIdHash } from '../src/auth/sessions.js';
import { PasskeyStore } from '../src/auth/credentials.js';
import { createStepUp } from '../src/auth/stepup.js';
import type { FetchLike } from '../src/linear/client.js';
import type { LinearJournal } from '../src/linear/journal.js';
import { registerLinearRoutes, registerLinearWorkspaceRoutes } from '../src/linear/routes.js';
import { linearStandIn, type Responder, type SeenCall } from './linearProxyRig.js';
import { linearServicesFake, type LinearServicesFake } from './linearServicesFake.js';
import { mkTmp } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const LOOPBACK_ORIGIN = 'http://localhost:7788';

export const WORKSPACES = '/api/linear/workspaces';

export interface SettingsRigOpts {
  /** The ccrc dir to serve; a fresh one when absent. */
  ccrcDir?: string;
  /** `cfg.authEnabled` (true by default: the account gate refuses everything while it is false). */
  enabled?: boolean;
  origin?: string;
  respond?: Responder;
  /** The Linear stand-in to use in place of a fresh one (a census that shares one with another rig). */
  standIn?: { fetch: FetchLike; calls: SeenCall[] };
  /** The services to use in place of a fresh fake (a census that shares one with another rig). */
  fx?: LinearServicesFake;
  clock?: () => number;
  /** The coord.db the fake's journal writes (a fresh in-memory one by default). */
  db?: DatabaseSync;
  timeoutMs?: number;
  /** Leave a service out (D-7684). */
  absent?: readonly ('rate' | 'refresher' | 'journal')[];
  /** A journal in place of the fake's (one that cannot write, say). */
  journal?: LinearJournal;
  /** A gate in place of the real one. */
  gate?: AccountGate;
}

export interface SettingsRig {
  app: FastifyInstance;
  ccrcDir: string;
  fx: LinearServicesFake;
  fetch: FetchLike;
  calls: SeenCall[];
  cookie: string;
  /** Records a step-up on the session, as the real step-up route would. */
  stamp: () => Promise<void>;
  /** One request with the session's cookie (unless `cookie: null`). */
  req: (method: 'GET' | 'POST' | 'DELETE' | 'PUT', url: string, payload?: unknown, o?: { cookie?: string | null }) => Promise<LightMyRequestResponse>;
  /** Every `linear_events` row, oldest first. */
  rows: () => Record<string, unknown>[];
  close: () => Promise<void>;
}

export async function settingsRig(o: SettingsRigOpts = {}): Promise<SettingsRig> {
  const ccrcDir = o.ccrcDir ?? path.join(mkTmp('ccrc-linear-settings-'), '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  // The sign-in files live apart from the ccrc dir, so a census that lists the ccrc dir sees only Linear's files.
  const authDir = mkTmp('ccrc-linear-settings-auth-');
  const secretPath = path.join(authDir, 'auth.scrypt');
  writeFileSync(secretPath, `${await hashLine('a test passphrase', FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const store = new SessionStore(path.join(authDir, 'sessions.json'));
  const { token } = await store.create('a test phone', 1, Date.now());
  const enabled = o.enabled ?? true;
  const stepUp = createStepUp({
    enabled, store, passkeys: new PasskeyStore(path.join(authDir, 'passkeys.json')),
    secretNow: () => measureSecret(secretPath), rpProblem: () => null, rpId: 'localhost', device: () => null,
  });
  const gate = o.gate ?? createAccountGate({
    enabled, origin: o.origin ?? LOOPBACK_ORIGIN,
    sessionAuth: (req: FastifyRequest) => sessionVerdict(req, { enabled, secret: measureSecret(secretPath), store }, Date.now()),
    // No ccd caps at all: the Linear routes involve no ccd verb, so an unmeasured fleet must not refuse them.
    fleetState: () => undefined,
    stepUp,
  });
  const stand = o.standIn ?? linearStandIn(o.respond);
  const fx = o.fx ?? linearServicesFake({ clock: o.clock, db: o.db, ccrcDir, fetch: stand.fetch, timeoutMs: o.timeoutMs });
  const absent = new Set(o.absent ?? []);
  const rate = absent.has('rate') ? null : fx.rate;
  const refresher = absent.has('refresher') ? null : fx.refresher;
  const app = Fastify({ logger: false });
  const net = { fetch: stand.fetch, timeoutMs: o.timeoutMs, now: o.clock };
  registerLinearRoutes(app, { ccrcDir, gate, rate, refresher, ...net });
  registerLinearWorkspaceRoutes(app, {
    ccrcDir, gate, rate, refresher, journal: absent.has('journal') ? null : (o.journal ?? fx.journal), ...net,
  });
  await app.ready();
  const cookie = `${SESSION_COOKIE}=${token}`;
  const req: SettingsRig['req'] = (method, url, payload, ro = {}) => app.inject({
    method, url,
    headers: {
      ...(ro.cookie === null ? {} : { cookie: ro.cookie ?? cookie }),
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload: typeof payload === 'string' ? payload : JSON.stringify(payload) }),
  });
  return {
    app, ccrcDir, fx, fetch: stand.fetch, calls: stand.calls, cookie, req,
    stamp: async () => { await store.stampAsserted(sessionIdHash(token), Date.now()); },
    rows: () => fx.db.prepare('SELECT * FROM linear_events ORDER BY id').all() as Record<string, unknown>[],
    close: () => app.close(),
  };
}

/** A response body, parsed. */
export const bodyOf = (res: LightMyRequestResponse): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;
