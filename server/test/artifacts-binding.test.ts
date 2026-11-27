// Native Docs HTML artifacts X5, wave A2 review F1: the capability store's session binding, through the REAL `buildServer`. The
// store is bound to the minting console session by the liveness port `server.ts` builds (`createArtifactStore(Date.now,
// sessionLiveness(authStore, () => secretNow()))`); every other test of the binding builds its own store, its own session store
// or an always-live port, so a wiring fault in that one line (an always-live port, a secret read once at boot) went red nowhere.
// These cases run the whole path: the tier on (`cfg.artifact`), sign-in armed over a fixture passphrase file, a real login, a
// real mint of one committed page, then the two ways a console session ends: a sign-out, and a passphrase change (the
// generation moves). The capability must end with its session: the list is box-wide (every record passes the store's dead-record
// drop), so a list that then holds no row proves the store dropped the first session's record as dead.
//
// Rig: `docs-headers.test.ts`'s `m54Server` (a fixture HOME, a fake runner answering the docs verbs, a handshaken fleet state
// carrying the docs caps, `auth.scrypt` written with `hashLine`) and `artifacts-listener.test.ts`'s `onConfig()` (the tier on).
// The artifact listener is `pending` until listened, so the case marks it `listening` through the decorated state: no port is bound.
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { artifactConfig, type ArtifactConfig } from '../src/artifacts/policy.js';
import type { ArtifactListenerState } from '../src/artifacts/routes.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { DOCS_CAP } from '../src/ccdargv.js';
import type { ExecResult, Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import type { ArtifactListOk, ArtifactMintAsk, ArtifactMintOk } from '../../shared/artifacts.js';
import { docsApi, type DocPin } from '../../shared/docs.js';
import { FIXTURE_COMMIT, FIXTURE_SERVED, PWA_HEADERS, committedEntry, indexOk, line, treeOk } from './docsRouteHelpers.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PASSPHRASE = 'correct horse battery staple';
const NEW_PASSPHRASE = 'a different passphrase entirely';
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PAGE = 'x/page.html';
const BLOB = 'b'.repeat(40);

const exit = (stdout: string): ExecResult => ({ ran: true, code: 0, stdout, stderr: '', killed: false, signal: null });

const pin: DocPin = { kind: 'committed', commit: FIXTURE_COMMIT, servedRef: FIXTURE_SERVED, section: 'specs', path: PAGE };
const mintAsk: ArtifactMintAsk = { project: 'demo', pin, origins: [], windows: false };

function onConfig(consoleOrigin: string): Extract<ArtifactConfig, { state: 'on' }> {
  const c = artifactConfig({ origin: 'https://art.artifacts.invalid', content: 'https://content.artifacts.invalid', port: '7790' },
    consoleOrigin, 7788);
  if (c.state !== 'on') throw new Error(`the fixture config is not on: ${JSON.stringify(c)}`);
  return c;
}

const opened: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of opened.splice(0)) await app.close();
});

/** The real server: tier on, sign-in armed over a fixture passphrase file, a runner answering the docs verbs with a tree that
 *  holds one committed page, and the artifact listener marked listening. `rewriteSecret` replaces the passphrase file. */
async function server(): Promise<{ app: FastifyInstance; rewriteSecret: (passphrase: string, generation: number) => Promise<void>; origin: string }> {
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'docs-index') return exit(line(indexOk()));
    if (args[0] === 'docs-tree') return exit(line(treeOk({ entries: [committedEntry(PAGE, BLOB, 1000)] })));
    return { ran: true, code: 1, stdout: '', stderr: 'boom', killed: false, signal: null };
  };
  const home = mkTmp('ccrc-artifacts-binding-');
  const base = testDeps(home, run);
  const secretPath = path.join(home, '.ccrc', 'auth.scrypt');
  const rewriteSecret = async (passphrase: string, generation: number): Promise<void> => {
    writeFileSync(secretPath, `${await hashLine(passphrase, FAST_PARAMS, generation)}\n`, { mode: 0o600 });
  };
  await rewriteSecret(PASSPHRASE, 1);
  const state: FleetState = { connected: true, downSince: null, ccdVerbs: ['caps', DOCS_CAP], rosterFp: null, build: null };
  const deps: Deps = {
    ...base, cfg: { ...base.cfg, authEnabled: true, cookieSecure: false, artifact: onConfig('https://console.example.test') }, fleetState: state,
  };
  const app = await buildServer(deps);
  await app.ready();
  opened.push(app);
  const listener = (app as unknown as { artifactListener: ArtifactListenerState | null }).artifactListener;
  if (listener === null) throw new Error('the tier is on, so the listener state is decorated');
  listener.mark('listening');
  return { app, rewriteSecret, origin: base.cfg.origin };
}

/** Sign in with `passphrase` (204) and answer the cookie pair the session answered. */
async function signIn(app: FastifyInstance, passphrase: string): Promise<string> {
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase } });
  expect(login.statusCode, login.body).toBe(204);
  const set = login.headers['set-cookie'];
  const first = Array.isArray(set) ? set[0]! : String(set);
  return first.slice(0, first.indexOf(';'));
}

/** What the PWA sends on a write: the docs marker, its provenance and the console's own Origin, with the session cookie. */
const writeHeaders = (cookie: string, origin: string): Record<string, string> =>
  ({ ...PWA_HEADERS, cookie, origin, 'content-type': 'application/json' });

const mintWith = (app: FastifyInstance, cookie: string, origin: string) =>
  app.inject({ method: 'POST', url: docsApi.artifactMint(), headers: writeHeaders(cookie, origin), payload: JSON.stringify(mintAsk) });

const listWith = async (app: FastifyInstance, cookie: string): Promise<ArtifactListOk> => {
  const res = await app.inject({ method: 'GET', url: docsApi.artifacts(), headers: { ...PWA_HEADERS, cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ArtifactListOk;
};

describe('artifact capabilities end with the console session that minted them (X5 A2 review F1, through buildServer)', () => {
  it('binding: a sign-out ends the capability, and the dead session cannot mint', async () => {
    const { app, origin } = await server();
    const first = await signIn(app, PASSPHRASE);
    const minted = await mintWith(app, first, origin);
    expect(minted.statusCode, minted.body).toBe(200);
    expect((minted.json() as ArtifactMintOk).url).toMatch(/^https:\/\/art\.artifacts\.invalid\/a\/[A-Za-z0-9_-]{43}$/);
    const before = await listWith(app, first);
    expect(before).toMatchObject({ ok: true, available: true });
    expect(before.live).toHaveLength(1);

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...PWA_HEADERS, cookie: first, origin } });
    expect(out.statusCode, out.body).toBe(204);

    const second = await signIn(app, PASSPHRASE);
    expect((await listWith(app, second)).live, 'the first session ended, so its capability did').toEqual([]);

    // The dead session's own cookie reaches no mint: the account gate refuses it before the tree read, so this refusal never
    // reaches the store. The binding itself is proved by the empty list above, not by this 401.
    const dead = await mintWith(app, first, origin);
    expect(dead.statusCode).toBe(401);
    expect(dead.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
    expect((await listWith(app, second)).live).toEqual([]);
  });

  it('binding: a passphrase change moves the generation and ends the capability', async () => {
    const { app, rewriteSecret, origin } = await server();
    const first = await signIn(app, PASSPHRASE);
    const minted = await mintWith(app, first, origin);
    expect(minted.statusCode, minted.body).toBe(200);
    expect((await listWith(app, first)).live).toHaveLength(1);

    await rewriteSecret(NEW_PASSPHRASE, 2);

    const second = await signIn(app, NEW_PASSPHRASE);
    expect((await listWith(app, second)).live, 'the generation moved, so the first session\'s capability ended').toEqual([]);

    // As in the sign-out case: the gate refuses the old generation's cookie before the store; the list above is the proof.
    const dead = await mintWith(app, first, origin);
    expect(dead.statusCode).toBe(401);
    expect(dead.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
    expect((await listWith(app, second)).live).toEqual([]);
  });
});
