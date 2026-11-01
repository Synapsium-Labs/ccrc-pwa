// Ticket titles through the Linear slots (#1444, D-7668; spec 2026-10-31 §6.10, §14 row 21; plan task LK3).
//
// The first block is the CHARACTERIZATION, written green on the code before titles moved to the slots: a box with
// only the legacy `linear.key` gets real titles through all three callers of `resolveTitle` (the preview, the
// workspace create and the rename), a Linear 401 marks the legacy pair rejected and a success clears that verdict,
// and a box with no key at all asks Linear nothing. It never changes after it lands.
//
// Every caller is driven through `buildServer`, with the one rate service handed in `Deps` as `index.ts` hands it.
// Nothing here reaches the network: `deps.linear.fetch` is the seam, and every Linear answer is a stub.
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildServer } from '../src/server.js';
import { WS_TITLE_CAP, WS_TITLE_VERB, WS_WRAPPER_CAP } from '../src/ccdargv.js';
import { LINEAR_DETAILS_FILE, LINEAR_KEY_FILE, keyTailOf, parseLinearDetails } from '../src/linear/connection.js';
import type { FetchLike } from '../src/linear/client.js';
import { ticketTitle } from '../src/linear/title.js';
import { valueDigestHex } from '../src/token/files.js';
import { testDeps } from './helpers.js';
import { linearAnswer, type LinearAnswer } from './linearFetchFake.js';
import { linearDeps, linearServicesFake } from './linearServicesFake.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const ID = 'project-a-quiet-basin';
const LEGACY_KEY = 'lin_api_fixture_titles_legacy_01';
const T0 = 1_800_000_000_000;

const issueOk = (identifier = 'AAA-12', title = 'Fix the login flow'): LinearAnswer =>
  linearAnswer({ ok: true, status: 200, json: async () => ({ data: { issue: { identifier, title } } }) });
const refused = (status: number): LinearAnswer => linearAnswer({ ok: false, status, json: async () => ({}) });

interface Rig {
  app: FastifyInstance;
  dir: string;
  /** The authorization header of every call Linear was sent, in order. */
  auth: string[];
  answer: (a: LinearAnswer) => void;
}

let open: FastifyInstance | null = null;
afterEach(async () => { await open?.close(); open = null; });

async function boot(o: { legacyKey?: string | null } = {}): Promise<Rig> {
  const deps = testDeps(undefined, async () => ({ ran: true, code: 0, stdout: '', stderr: '' }));
  const dir = deps.cfg.ccrcDir;
  mkdirSync(dir, { recursive: true });
  const legacy = o.legacyKey === undefined ? LEGACY_KEY : o.legacyKey;
  if (legacy !== null) writeFileSync(path.join(dir, LINEAR_KEY_FILE), `${legacy}\n`, { mode: 0o600 });
  mkdirSync(deps.cfg.registryDir, { recursive: true });
  writeFileSync(path.join(deps.cfg.registryDir, `${ID}.uuid`), 'a'.repeat(36));
  const auth: string[] = [];
  let next: LinearAnswer = issueOk();
  const f: FetchLike = async (_u, init) => { auth.push(init.headers['authorization'] ?? ''); return next; };
  const app = await buildServer({
    ...deps,
    fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-add', WS_TITLE_CAP, WS_WRAPPER_CAP, WS_TITLE_VERB], rosterFp: null, build: null },
    linear: { fetch: f },
    ...linearDeps(linearServicesFake({ clock: () => T0 })),
  });
  open = app;
  return { app, dir, auth, answer: (a) => { next = a; } };
}

const body = (res: LightMyRequestResponse): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;
const preview = (r: Rig, ref = 'AAA-12'): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'GET', url: `/api/linear/resolve?ref=${encodeURIComponent(ref)}` });
const create = (r: Rig, name = 'AAA-12'): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'POST', url: '/api/projects/project-a/workspaces', payload: { name } });
const rename = (r: Rig, title = 'AAA-12'): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'POST', url: `/api/sessions/${ID}/title`, payload: { title } });

/** The title each of the three callers gives for `ref`, in order: the preview, the create, the rename. */
const titlesOf = async (r: Rig, ref = 'AAA-12'): Promise<unknown[]> => [
  body(await preview(r, ref))['title'], body(await create(r, ref))['title'], body(await rename(r, ref))['title'],
];

const detailsOf = (dir: string): ReturnType<typeof parseLinearDetails> =>
  parseLinearDetails(readFileSync(path.join(dir, LINEAR_DETAILS_FILE), 'utf8'));
const writeDetails = (dir: string, key: string, outcome: 'ok' | 'rejected'): void => writeFileSync(
  path.join(dir, LINEAR_DETAILS_FILE),
  `${JSON.stringify({ v: 1, org: 'Workspace A', user: 'user-a', keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: T0, outcome })}\n`,
);

describe('characterization: a box with only linear.key (green before titles moved to the slots)', () => {
  it('the preview, the create and the rename all give Linear\'s title, asked with the legacy key', async () => {
    const r = await boot();
    const want = ticketTitle('AAA-12', 'Fix the login flow');
    expect(body(await preview(r))).toMatchObject({ kind: 'named', title: want, source: 'linear' });
    expect(await titlesOf(r)).toEqual([want, want, want]);
    expect(r.auth).toEqual(Array(4).fill(LEGACY_KEY));
  });

  it('a Linear 401 gives the offline title and marks the legacy pair rejected; a success clears that verdict', async () => {
    const r = await boot();
    writeDetails(r.dir, LEGACY_KEY, 'ok');
    r.answer(refused(401));
    expect(body(await preview(r))).toMatchObject({ title: 'AAA-12', source: 'offline', reason: 'unauthorised' });
    expect(detailsOf(r.dir)).toMatchObject({ keyDigest: valueDigestHex(LEGACY_KEY), outcome: 'rejected' });
    r.answer(issueOk());
    expect(body(await preview(r))).toMatchObject({ source: 'linear' });
    expect(detailsOf(r.dir)).toMatchObject({ keyDigest: valueDigestHex(LEGACY_KEY), outcome: 'ok' });
  });

  it('a 403 gives the offline title and leaves the pair\'s verdict alone', async () => {
    const r = await boot();
    writeDetails(r.dir, LEGACY_KEY, 'ok');
    const before = readFileSync(path.join(r.dir, LINEAR_DETAILS_FILE), 'utf8');
    r.answer(refused(403));
    expect(body(await preview(r))).toMatchObject({ title: 'AAA-12', source: 'offline', reason: 'forbidden' });
    expect(readFileSync(path.join(r.dir, LINEAR_DETAILS_FILE), 'utf8')).toBe(before);
  });

  it('a box with no key gives every caller the offline title, not-configured, and asks Linear nothing', async () => {
    const r = await boot({ legacyKey: null });
    expect(body(await preview(r))).toMatchObject({ title: 'AAA-12', source: 'offline', reason: 'not-configured' });
    expect(await titlesOf(r)).toEqual(['AAA-12', 'AAA-12', 'AAA-12']);
    expect(r.auth).toEqual([]);
  });

  it('a plain name is never looked up', async () => {
    const r = await boot();
    expect(body(await preview(r, 'login-cleanup'))).toMatchObject({ source: 'offline' });
    expect(r.auth).toEqual([]);
  });
});
