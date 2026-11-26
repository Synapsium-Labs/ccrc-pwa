// Native Docs HTML artifacts X5, plan Task A2.3: the artifact tier's five console doors in the docs plugin (spec 2026-11-19 sections
// 3.2 and 3.3): the availability read, the scope read, the mint, Revoke and Revoke all. Each case builds a small Fastify app with the
// docs plugin's request and response policy and `registerDocsArtifactRoutes`, over
// - a fake `DocsReader` whose `tree` answers a built tree (or a failure) and counts its calls, so "no tree read" is a count that
//   did not move; the real lanes of `composeDocs`, so the mint goes through the console's own flight and cache;
// - a REAL `createAccountGate` over a stub `sessionAuth` (the cookie's presence is the session) and a stub step-up that is never
//   asked, because the mint asks none;
// - a REAL `createArtifactStore` over a fake clock and a fake liveness.
// Hosts are under `.test`, the project is `project-a`, and the docs marker header is L0's constant (`PWA_HEADERS`), never quoted.
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  ARTIFACT_IDLE_MS, ARTIFACT_MAX_ORIGINS, ARTIFACT_REFUSALS, type ArtifactListOk, type ArtifactMintAsk, type ArtifactMintOk,
  type ArtifactRefusal, type ArtifactScopeOk,
} from '../../shared/artifacts.js';
import {
  DOCS_MAX_FILE_BYTES, DOCS_RANGE_MAX_BYTES, docsApi, type DocListPin, type DocPin, type DocsEntry, type DocsFailureBody,
  type DocsTreeOk,
} from '../../shared/docs.js';
import { ARTIFACT_MINT_REFUSALS, REFUSAL_STATUS, type RouteRefusal } from '../../shared/refusal.js';
import { createAccountGate } from '../src/accounts/gate.js';
import { createArtifactListenerState } from '../src/artifacts/routes.js';
import type { ArtifactConfig } from '../src/artifacts/policy.js';
import { listAnswer, manifestScope, originAdmission, revokeAnswer } from '../src/artifacts/policy.js';
import type { SessionLiveness } from '../src/artifacts/ports.js';
import { createArtifactStore, type ArtifactStore, type CapabilityInput } from '../src/artifacts/store.js';
import { NO_SESSION, type GateDecision } from '../src/auth/gate.js';
import { SESSION_COOKIE } from '../src/auth/cookie.js';
import { sessionIdHash } from '../src/auth/sessions.js';
import { installDocsRequestPolicy, installDocsResponsePolicy } from '../src/docs/hooks.js';
import type { DocsFetcher, DocsReader, DocsTreeRead } from '../src/docs/ports.js';
import { composeDocs, registerDocsArtifactRoutes, registerDocsReadRoutes, registerDocsRefreshRoute } from '../src/docs/routes.js';
import { FIXTURE_COMMIT, FIXTURE_SERVED, PWA_HEADERS, committedEntry, treeOk } from './docsRouteHelpers.js';

// ---- Fixtures ----

const CONSOLE = 'https://console.example.test';
const ARTIFACT = 'https://art.example.test';
const CONTENT = 'https://content.example.test';
const ON: ArtifactConfig = {
  state: 'on', artifactOrigin: ARTIFACT, contentOrigin: CONTENT, port: 7790, artifactHost: 'art.example.test', contentHost: 'content.example.test',
};
const COOKIE = `${SESSION_COOKIE}=fixture-session`;
const SESSION_HASH = sessionIdHash('fixture-session');
const DECISION: GateDecision = { allow: true, verdict: 'ok', reason: 'session', device: 'fixture-device' };
const T0 = 1_800_000_000_000;
/** A well-formed token for draw number `n`: 43 characters of the base64url alphabet. */
const tok = (n: number): string => String(n).padStart(43, 'a');
const BLOB = 'b'.repeat(40);
const DRAFT_FP = 'd'.repeat(64);
const SNAPSHOT_DIGEST = 'e'.repeat(64);
const MTIME = '1700000000000000000';
const MIB = 1048576;

const PAGE = 'x/page.html';
const committedPin = (path = PAGE): DocPin =>
  ({ kind: 'committed', commit: FIXTURE_COMMIT, servedRef: FIXTURE_SERVED, section: 'specs', path });
const draftPin = (fp: string, path = PAGE): DocPin =>
  ({ kind: 'draft', branch: 'feature', head: FIXTURE_COMMIT, section: 'specs', path, fp });
const statDraftPin = (path = PAGE): DocListPin =>
  ({ kind: 'draft', branch: 'feature', head: FIXTURE_COMMIT, section: 'specs', path, fp: null, stat: { size: 5 * MIB, mtimeNs: MTIME } });

const file = (path: string, size: number | null, kind: 'file' | 'exec' | 'symlink' | 'submodule' = 'file'): DocsEntry =>
  committedEntry(path, BLOB, size, kind);

interface DraftOver { fp: string | null; size: number | null; mtimeNs?: string; state?: 'modified' | 'added' | 'untracked' | 'deleted' | 'typechange'; kind?: 'file' | 'symlink' | 'absent' }
/** A draft-only row of `specs`, `kind` file and untracked unless it says otherwise. */
const draft = (path: string, over: DraftOver): DocsEntry => ({
  section: 'specs', path, committed: null,
  draft: {
    state: over.state ?? 'untracked', kind: over.kind ?? 'file', size: over.size, fp: over.fp, trust: 'hash',
    ...(over.mtimeNs === undefined ? {} : { mtimeNs: over.mtimeNs }),
  },
});

/** The standard committed listing: the page, two assets below its directory, and the files that must stay out of its manifest. */
const standardEntries = (): DocsEntry[] => [
  file(PAGE, 1000), file('x/a.js', 20), file('x/sub/m.glb', 30), file('x/notes.md', 40), file('y.js', 50), file('index.md', 60),
];

const treeOf = (entries: DocsEntry[], over: Partial<DocsTreeOk> = {}): DocsTreeOk => treeOk({ project: 'project-a', entries, ...over });

// ---- The rig ----

interface RigOpts {
  signIn?: 'armed' | 'dark';
  /** The gate's own origin: an `http://` one that is not loopback makes the gate answer `insecure-origin`. */
  gateOrigin?: string;
  tier?: ArtifactConfig;
  listener?: 'pending' | 'listening' | 'down' | null;
  store?: boolean;
  /** The tree the fake reader answers; a function sees each call. */
  tree?: DocsTreeRead | (() => DocsTreeRead);
  draw?: () => string;
  maskChanges?: (answer: unknown) => boolean;
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function rig(o: RigOpts = {}) {
  const signIn = o.signIn ?? 'armed';
  const tier = o.tier ?? ON;
  let now = T0;
  const liveness: SessionLiveness = { of: () => 'live' };
  const store = o.store === false ? null : createArtifactStore(() => now, liveness, o.draw, undefined);
  const listener = o.listener === null ? null : createArtifactListenerState();
  if (listener !== null && o.listener !== 'pending') listener.mark(o.listener ?? 'listening');
  const treeCalls: { project: string; ref: unknown }[] = [];
  const reader = {
    tree: async (src: { project: string }, ref: unknown): Promise<DocsTreeRead> => {
      treeCalls.push({ project: src.project, ref });
      const t = o.tree ?? { ok: true as const, answer: treeOf(standardEntries()) };
      return typeof t === 'function' ? t() : t;
    },
  } as unknown as DocsReader;
  const docs = composeDocs({ runCcd: async () => { throw new Error('the mint never runs ccd'); }, fleetState: { ccdVerbs: [] } });
  /** Every answer the egress mask was asked about, in order: the last one of a mint is the one that is sent. */
  const maskSeen: unknown[] = [];
  const fetchCalls: (string | null)[] = [];
  const fetchers = {
    primary: docs.fetchers.primary,
    byNode: new Map([[docs.fetchers.primary, {
      fetch: async (_src: unknown, branch: string | null) => { fetchCalls.push(branch); throw new Error('the refresh case fetches nothing'); },
    } as unknown as DocsFetcher]]),
  };
  const gate = createAccountGate({
    enabled: signIn === 'armed', origin: o.gateOrigin ?? CONSOLE,
    sessionAuth: (req) => (typeof req.headers.cookie === 'string' && req.headers.cookie.includes(COOKIE) ? DECISION : NO_SESSION),
    fleetState: () => ({ ccdVerbs: [] }),
    stepUp: { requireRecentAssertion: () => () => { throw new Error('the mint asks no step-up'); } },
  });
  const app = Fastify({ logger: false });
  await app.register(async (plugin) => {
    installDocsRequestPolicy(plugin);
    installDocsResponsePolicy(plugin);
    const readers = { primary: docs.readers.primary, byNode: new Map([[docs.readers.primary, reader]]) };
    registerDocsReadRoutes(plugin, readers, docs.lanes);
    registerDocsRefreshRoute(plugin, readers, fetchers, docs.lanes);
    registerDocsArtifactRoutes(plugin, readers, docs.lanes, {
      gate, signIn: () => signIn, tier, listener, store, consoleOrigin: CONSOLE, clock: () => now,
      maskChanges: (answer) => { maskSeen.push(answer); return o.maskChanges?.(answer) ?? false; },
    });
  });
  apps.push(app);
  return {
    app, store, listener, treeCalls, maskSeen, fetchCalls,
    advance: (ms: number): void => { now += ms; },
    get: (url: string, headers: Record<string, string> = { ...PWA_HEADERS, cookie: COOKIE }) =>
      app.inject({ method: 'GET', url, headers }),
    post: (url: string, body?: unknown, headers: Record<string, string> = { ...PWA_HEADERS, cookie: COOKIE }) =>
      app.inject({
        method: 'POST', url, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      }),
  };
}
type Rig = Awaited<ReturnType<typeof rig>>;

const ask = (over: Partial<ArtifactMintAsk> = {}): ArtifactMintAsk =>
  ({ project: 'project-a', pin: committedPin(), origins: [], windows: false, ...over });
const mint = (r: Rig, over: Partial<ArtifactMintAsk> = {}) => r.post(docsApi.artifactMint(), ask(over));
const scope = (r: Rig, pin: DocListPin = committedPin()) => r.get(docsApi.artifactScope('project-a', pin));
/** The token in a mint answer's URL. */
const tokenOf = (res: { json(): unknown }): string => (res.json() as ArtifactMintOk).url.split('/a/')[1]!;
const errorOf = (res: { json(): unknown }): string => (res.json() as { error: string }).error;
const manifestKeys = (store: ArtifactStore | null, token: string): string[] =>
  [...(store!.lookup(token)?.manifest.keys() ?? [])].sort();

// ---- The cases ----

describe('artifact mint doors: the gate and the tier (X5 A2.3)', () => {
  it('mint: dark answers `auth-off`', async () => {
    const r = await rig({ signIn: 'dark' });
    const m = await mint(r);
    expect(m.statusCode).toBe(REFUSAL_STATUS['auth-off']);
    expect(errorOf(m)).toBe('auth-off');
    const s = await scope(r);
    expect(errorOf(s)).toBe('auth-off');
    expect(r.treeCalls).toHaveLength(0);
    expect(r.store!.list()).toEqual([]);
  });

  it('mint: an http origin that is not loopback answers the gate\'s `insecure-origin`, a request with no session its 401', async () => {
    const insecure = await rig({ gateOrigin: 'http://console.example.test' });
    expect(errorOf(await mint(insecure))).toBe('insecure-origin');
    expect(errorOf(await scope(insecure))).toBe('insecure-origin');
    const anon = await rig();
    const noCookie = { ...PWA_HEADERS };
    const m = await anon.post(docsApi.artifactMint(), ask(), noCookie);
    expect(m.statusCode).toBe(401);
    expect(errorOf(m)).toBe('unauthenticated');
    expect(errorOf(await anon.get(docsApi.artifactScope('project-a', committedPin()), noCookie))).toBe('unauthenticated');
    expect(anon.treeCalls).toHaveLength(0);
  });

  it('mint: the tier off answers `artifact-host-unset`, before any parse or tree read', async () => {
    const r = await rig({ tier: { state: 'off', why: 'unset', detail: '' }, store: false, listener: null });
    const m = await r.post(docsApi.artifactMint(), { not: 'a mint body' });
    expect(m.statusCode).toBe(REFUSAL_STATUS['artifact-host-unset']);
    expect(errorOf(m)).toBe('artifact-host-unset');
    expect(errorOf(await r.get('/api/docs/artifacts/scope?project=%00'))).toBe('artifact-host-unset');
    expect(r.treeCalls).toHaveLength(0);
  });

  it('mint: a listener that is down has its own word', async () => {
    for (const state of ['down', 'pending'] as const) {
      const r = await rig({ listener: state });
      const m = await mint(r);
      expect(m.statusCode, state).toBe(REFUSAL_STATUS['artifact-listener-down']);
      expect(errorOf(m), state).toBe('artifact-listener-down');
      expect(errorOf(await scope(r)), state).toBe('artifact-listener-down');
      const list = (await r.get(docsApi.artifacts())).json() as ArtifactListOk;
      expect(list, state).toMatchObject({ ok: true, available: false, why: 'listener-down' });
      expect(r.treeCalls, state).toHaveLength(0);
    }
  });

  it('mint: each door sits behind the docs marker check', async () => {
    const r = await rig();
    const bare = { cookie: COOKIE };
    const answers = [
      await r.get(docsApi.artifacts(), bare),
      await r.get(docsApi.artifactScope('project-a', committedPin()), bare),
      await r.post(docsApi.artifactMint(), ask(), bare),
      await r.post(docsApi.artifactRevoke('someid'), undefined, bare),
      await r.post(docsApi.artifactRevokeAll(), undefined, bare),
    ];
    for (const a of answers) {
      expect(a.statusCode).toBe(403);
      expect((a.json() as DocsFailureBody).failure).toBe('foreign-request');
    }
    expect(r.treeCalls).toHaveLength(0);
  });
});

describe('artifact mint doors: the list read (X5 A2.3)', () => {
  const list = async (r: Rig): Promise<ArtifactListOk> => (await r.get(docsApi.artifacts())).json() as ArtifactListOk;

  it('answers `available` with no reason when the tier is on and listening', async () => {
    const body = await list(await rig());
    expect(body).toEqual({ ok: true, available: true, live: [] });
  });

  it('answers the reason it is not available: dark first, then the config\'s own word, then the listener', async () => {
    expect(await list(await rig({ signIn: 'dark', tier: { state: 'off', why: 'partial', detail: 'x' } })))
      .toMatchObject({ available: false, why: 'auth-off' });
    for (const why of ['unset', 'partial', 'invalid', 'by-address'] as const) {
      const r = await rig({ tier: { state: 'off', why, detail: '' }, store: false, listener: null });
      expect(await list(r), why).toMatchObject({ available: false, why, live: [] });
    }
    expect(await list(await rig({ listener: 'down' }))).toMatchObject({ available: false, why: 'listener-down' });
    expect(await list(await rig({ listener: 'pending' }))).toMatchObject({ available: false, why: 'listener-down' });
  });

  it('needs no session: the list is not account-gated', async () => {
    const r = await rig();
    const res = await r.get(docsApi.artifacts(), { ...PWA_HEADERS });
    expect(res.statusCode).toBe(200);
  });

  it('lists a minted capability as a row with no token and no URL', async () => {
    const r = await rig();
    const m = await mint(r, { origins: ['https://api.example.test'], windows: true });
    expect(m.statusCode).toBe(200);
    const rows = (await list(r)).live;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ project: 'project-a', section: 'specs', path: PAGE, windows: true, origins: ['https://api.example.test'] });
    expect(Object.keys(rows[0]!)).not.toContain('url');
    expect(Object.keys(rows[0]!)).not.toContain('token');
  });
});

describe('artifact mint doors: the scope read and the mint (X5 A2.3)', () => {
  it('mint: markdown is `not-html`', async () => {
    const r = await rig({ tree: { ok: true, answer: treeOf([...standardEntries()]) } });
    const m = await mint(r, { pin: committedPin('x/notes.md') });
    expect(m.statusCode).toBe(REFUSAL_STATUS['not-html']);
    expect(errorOf(m)).toBe('not-html');
    expect(errorOf(await scope(r, committedPin('x/notes.md')))).toBe('not-html');
    expect(errorOf(await mint(r, { pin: committedPin('x/a.js') }))).toBe('not-html');
    expect(r.treeCalls).toHaveLength(0);
    expect(r.store!.list()).toEqual([]);
  });

  it('mint: `y.js` is not in the manifest of `x/page.html`', async () => {
    const r = await rig();
    const m = await mint(r);
    expect(m.statusCode).toBe(200);
    // Below the page's directory only: not `y.js` (above it), not `index.md` (above it); `x/notes.md` stays, the page is not at the root.
    expect(manifestKeys(r.store, tokenOf(m))).toEqual(['x/a.js', 'x/notes.md', 'x/page.html', 'x/sub/m.glb']);
    expect(m.json()).toMatchObject({ files: 4, uncommitted: 0, unsized: 0 });
  });

  it('mint: a section-root page leaves out Markdown', async () => {
    const entries = [
      file('page.html', 100), file('page.js', 10), file('x/a.js', 20), file('README.md', 30), file('x/notes.md', 40), file('UP.MD', 5),
      file('notes.markdown', 7), file('x/more.markdown', 8), file('LOUD.MARKDOWN', 9), file('x/page.html', 100),
    ];
    const r = await rig({ tree: { ok: true, answer: treeOf(entries) } });
    // Markdown is `contentClass` `markdown`: `.md` and `.markdown` in any case, root or nested, none in a root page's manifest.
    const root = await mint(r, { pin: committedPin('page.html') });
    expect(root.statusCode).toBe(200);
    expect(manifestKeys(r.store, tokenOf(root))).toEqual(['page.html', 'page.js', 'x/a.js', 'x/page.html']);
    // A page below the root keeps its Markdown neighbours, `.markdown` ones too.
    const nested = await mint(r);
    expect(manifestKeys(r.store, tokenOf(nested))).toEqual(['x/a.js', 'x/more.markdown', 'x/notes.md', 'x/page.html']);
  });

  it('mint: an unsized entry is left out', async () => {
    const committed = [...standardEntries(), file('x/null.bin', null), file('x/link', 3, 'symlink')];
    const r = await rig({ tree: { ok: true, answer: treeOf(committed) } });
    const s = await scope(r);
    const m = await mint(r);
    expect(manifestKeys(r.store, tokenOf(m))).not.toContain('x/null.bin');
    expect(manifestKeys(r.store, tokenOf(m))).not.toContain('x/link');
    // The null size is counted; a symlink is left out and not counted.
    expect(s.json()).toMatchObject({ unsized: 1 });
    expect(m.json()).toMatchObject({ unsized: 1 });

    // A draft entry with no fingerprint and no readable time has no pin to hold it: left out, counted.
    const drafts = [
      draft(PAGE, { fp: DRAFT_FP, size: 100 }), draft('x/nostat.bin', { fp: null, size: 6 * MIB }),
      draft('x/ok.bin', { fp: null, size: 6 * MIB, mtimeNs: MTIME }),
    ];
    const rd = await rig({ tree: { ok: true, answer: treeOf(drafts) } });
    const md = await mint(rd, { pin: draftPin(DRAFT_FP) });
    expect(md.statusCode).toBe(200);
    expect(manifestKeys(rd.store, tokenOf(md))).toEqual(['x/ok.bin', 'x/page.html']);
    expect(md.json()).toMatchObject({ files: 2, uncommitted: 2, unsized: 1 });
  });

  it('the scope read\'s counts equal the mint\'s and mint nothing', async () => {
    const entries = [...standardEntries(), file('x/big.bin', DOCS_RANGE_MAX_BYTES + 1), file('x/null.bin', null)];
    const r = await rig({ tree: { ok: true, answer: treeOf(entries) } });
    const s = (await scope(r)).json() as ArtifactScopeOk;
    expect(r.store!.list()).toEqual([]);
    const m = (await mint(r)).json() as ArtifactMintOk;
    expect(s).toMatchObject({ ok: true, files: m.files, uncommitted: m.uncommitted, unsized: m.unsized });
    expect(s.unsized).toBe(2);
    expect(s.bytes).toBe(1000 + 20 + 30 + 40);
    expect(r.store!.list()).toHaveLength(1);
  });

  it('the URL is `https://<artifact-host>/a/<token>`, and the expiry is an idle hour on', async () => {
    const r = await rig();
    const m = (await mint(r)).json() as ArtifactMintOk;
    expect(m.url).toMatch(new RegExp(`^${ARTIFACT}/a/[A-Za-z0-9_-]{43}$`));
    expect(m.expiresAt).toBe(T0 + ARTIFACT_IDLE_MS);
    expect(m.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('mint: no later answer contains the token', async () => {
    const r = await rig();
    const m = await mint(r);
    const token = tokenOf(m);
    const id = (m.json() as ArtifactMintOk).id;
    const later = [
      await r.get(docsApi.artifacts()),
      await scope(r),
      await mint(r),
      await r.post(docsApi.artifactRevoke(id)),
    ];
    // The second mint holds its own token, not the first's.
    expect(later[2]!.body).not.toContain(token);
    for (const [i, a] of later.entries()) expect(a.body, `answer ${i}`).not.toContain(token);
    const rows = (JSON.parse(later[0]!.body) as ArtifactListOk).live;
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('url');
      expect(JSON.stringify(row)).not.toMatch(/https?:\/\//);
    }
    expect(later[3]!.json()).toEqual({ ok: true, revoked: 1 });
    expect((await r.post(docsApi.artifactRevokeAll())).body).not.toContain(token);
  });

  it('mint: `https://<content-host>` is `bad-origin`', async () => {
    const r = await rig();
    const bad = [
      CONTENT, ARTIFACT, CONSOLE, `${CONTENT}:8443`, 'https://art.example.test:9999', 'http://api.example.test',
      'https://api.example.test/path', 'https://api.example.test/', 'wss://api.example.test', 'not an origin',
    ];
    for (const origin of bad) {
      const m = await mint(r, { origins: ['https://ok.example.test', origin] });
      expect(m.statusCode, origin).toBe(REFUSAL_STATUS['bad-origin']);
      expect(errorOf(m), origin).toBe('bad-origin');
    }
    const nine = Array.from({ length: ARTIFACT_MAX_ORIGINS + 1 }, (_, i) => `https://o${i}.example.test`);
    expect(errorOf(await mint(r, { origins: nine }))).toBe('bad-origin');
    // Refused before the tree read, and nothing minted.
    expect(r.treeCalls).toHaveLength(0);
    expect(r.store!.list()).toEqual([]);
    // Eight others are admitted and held by the capability.
    const eight = nine.slice(0, ARTIFACT_MAX_ORIGINS);
    const ok = await mint(r, { origins: eight });
    expect(ok.statusCode).toBe(200);
    expect([...r.store!.lookup(tokenOf(ok))!.origins]).toEqual(eight);
  });

  it('mint: answer never masked', async () => {
    const draws = [tok(1), tok(2)];
    let n = 0;
    const r = await rig({
      draw: () => draws[n++] ?? tok(100 + n),
      maskChanges: (answer) => JSON.stringify(answer).includes(tok(1)),
    });
    const m = await mint(r);
    expect(m.statusCode).toBe(200);
    expect(tokenOf(m)).toBe(tok(2));
    expect(r.store!.lookup(tok(1))).toBeNull();
    expect(r.store!.lookup(tok(2))).not.toBeNull();
    expect(r.store!.list()).toHaveLength(1);
    // The mask checked the answer exactly as it was sent: the first draw's answer was refused, the second's was sent, and its
    // expiry (the store's own, an idle hour on) was already in the answer the mask saw.
    expect(r.maskSeen).toHaveLength(2);
    expect(r.maskSeen.at(-1)).toEqual(m.json());
    expect(r.maskSeen.at(-1)).toMatchObject({ expiresAt: T0 + ARTIFACT_IDLE_MS });
    // Also for a mint that carries a draft (a manifest of uncommitted files).
    const drafts = await rig({ tree: { ok: true, answer: treeOf([draft(PAGE, { fp: DRAFT_FP, size: 10 })]) } });
    const dm = await mint(drafts, { pin: draftPin(DRAFT_FP) });
    expect(dm.statusCode).toBe(200);
    expect(drafts.maskSeen.at(-1)).toEqual(dm.json());
    // Every draw masked: eight draws, then `unmeasured`, and nothing is live.
    const all = await rig({ maskChanges: () => true });
    const none = await mint(all);
    expect(none.statusCode).toBe(REFUSAL_STATUS.unmeasured);
    expect(errorOf(none)).toBe('unmeasured');
    expect(all.store!.list()).toEqual([]);
  });

  it('mint: a moved pin refuses', async () => {
    const moved = 'c'.repeat(40);
    // A committed pin whose commit is not the tree's.
    const a = await rig({ tree: { ok: true, answer: treeOf(standardEntries(), { ref: { ...treeOf([]).ref, commit: moved } }) } });
    expect(errorOf(await mint(a))).toBe('pin-moved');
    expect(errorOf(await scope(a))).toBe('pin-moved');
    expect(a.store!.list()).toEqual([]);
    // A draft pin whose head is not the tree's.
    const b = await rig({ tree: { ok: true, answer: treeOf([draft(PAGE, { fp: DRAFT_FP, size: 10 })], { ref: { ...treeOf([]).ref, commit: moved } }) } });
    expect(errorOf(await mint(b, { pin: draftPin(DRAFT_FP) }))).toBe('pin-moved');
    expect(errorOf(await scope(b, draftPin(DRAFT_FP)))).toBe('pin-moved');
    expect(b.store!.list()).toEqual([]);
    // A draft pin whose page entry carries another fingerprint.
    const c = await rig({ tree: { ok: true, answer: treeOf([draft(PAGE, { fp: SNAPSHOT_DIGEST, size: 10 })]) } });
    expect(errorOf(await mint(c, { pin: draftPin(DRAFT_FP) }))).toBe('pin-moved');
    expect(errorOf(await scope(c, draftPin(DRAFT_FP)))).toBe('pin-moved');
    expect(c.store!.list()).toEqual([]);
    // A draft page deleted, or replaced by a symlink, after the pin: moved, never too large.
    for (const gone of [
      draft(PAGE, { fp: null, size: 0, state: 'deleted', kind: 'absent' }),
      draft(PAGE, { fp: null, size: 9 * MIB, kind: 'symlink', state: 'typechange' }),
    ]) {
      const d = await rig({ tree: { ok: true, answer: treeOf([gone]) } });
      expect(errorOf(await mint(d, { pin: draftPin(DRAFT_FP) }))).toBe('pin-moved');
      expect(errorOf(await scope(d, draftPin(DRAFT_FP)))).toBe('pin-moved');
      expect(d.store!.list()).toEqual([]);
    }
    // The pin that holds mints.
    const ok = await rig({ tree: { ok: true, answer: treeOf([draft(PAGE, { fp: DRAFT_FP, size: 10 })]) } });
    expect((await mint(ok, { pin: draftPin(DRAFT_FP) })).statusCode).toBe(200);
  });

  it('mint: a failed tree read is `unmeasured` and mints nothing', async () => {
    const failure: DocsFailureBody = { ok: false, failure: 'unknown-project' };
    const r = await rig({ tree: failure });
    const m = await mint(r);
    expect(m.statusCode).toBe(REFUSAL_STATUS.unmeasured);
    expect(errorOf(m)).toBe('unmeasured');
    expect(errorOf(await scope(r))).toBe('unmeasured');
    expect(r.store!.list()).toEqual([]);
    expect(r.treeCalls).toHaveLength(2);
    // A body that carries the docs failure's own free text never reaches the answer.
    expect(m.body).not.toContain('unknown-project');
  });

  it('mint: a committed pin reads the tree at its served ref, a draft pin at its branch', async () => {
    const r = await rig({ tree: { ok: true, answer: treeOf([draft(PAGE, { fp: DRAFT_FP, size: 10 })]) } });
    await mint(r, { pin: draftPin(DRAFT_FP) });
    expect(r.treeCalls[0]!.ref).toEqual({ kind: 'bare', name: 'feature' });
    const c = await rig();
    await mint(c);
    expect(c.treeCalls[0]!.ref).toEqual({ kind: 'qualified', ref: FIXTURE_SERVED });
    expect(c.treeCalls[0]!.project).toBe('project-a');
  });

  it('mint: a malformed pin is the parser\'s word', async () => {
    const r = await rig();
    // A mixed pin on the scope read.
    const mixed = await r.get(`/api/docs/artifacts/scope?project=project-a&commit=${FIXTURE_COMMIT}&branch=feature&section=specs&path=${PAGE}`);
    expect(mixed.statusCode).toBe(400);
    expect(mixed.json()).toMatchObject({ ok: false, failure: 'bad-query', why: 'pin-shape' });
    // An incomplete one.
    const partial = await r.get('/api/docs/artifacts/scope?project=project-a&section=specs&path=x%2Fpage.html');
    expect(partial.json()).toMatchObject({ failure: 'bad-query', why: 'pin-shape' });
    // A bad project, on both doors.
    const badProject = await r.get(docsApi.artifactScope('Not A Project!', committedPin()));
    expect(badProject.json()).toMatchObject({ ok: false, failure: 'bad-project' });
    expect((await mint(r, { project: 'Not A Project!' })).json()).toMatchObject({ failure: 'bad-project' });
    // A bad commit in the mint body, and one value of each other kind.
    const badCommit = await mint(r, { pin: { ...committedPin(), commit: 'zz' } as DocPin });
    expect(badCommit.statusCode).toBe(400);
    expect(badCommit.json()).toMatchObject({ ok: false, failure: 'bad-commit' });
    expect((await mint(r, { pin: { ...committedPin(), section: 'nope' } as unknown as DocPin })).json()).toMatchObject({ failure: 'bad-section' });
    expect((await mint(r, { pin: { ...committedPin(), servedRef: 'main' } as DocPin })).json()).toMatchObject({ failure: 'bad-ref' });
    expect((await mint(r, { pin: draftPin('nope') })).json()).toMatchObject({ failure: 'bad-fingerprint' });
    // A body that mixes the two pin shapes, or whose `kind` disagrees with its keys.
    const mixedBody = await mint(r, { pin: { ...committedPin(), branch: 'feature' } as unknown as DocPin });
    expect(mixedBody.json()).toMatchObject({ failure: 'bad-query', why: 'pin-shape' });
    const wrongKind = await mint(r, { pin: { ...committedPin(), kind: 'draft' } as unknown as DocPin });
    expect(wrongKind.json()).toMatchObject({ failure: 'bad-query', why: 'pin-shape' });
    // A body that is not a mint body.
    for (const body of [[], 'x', null, { project: 'project-a', pin: committedPin(), origins: 'x', windows: false },
      { project: 'project-a', pin: committedPin(), origins: [1], windows: false },
      { project: 'project-a', pin: committedPin(), origins: [], windows: 'yes' }]) {
      const res = await r.post(docsApi.artifactMint(), body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json(), JSON.stringify(body)).toMatchObject({ failure: 'bad-query', why: 'body' });
    }
    // Not one of them reached the tree read, and nothing was minted.
    expect(r.treeCalls).toHaveLength(0);
    expect(r.store!.list()).toEqual([]);
  });

  it('mint: a key outside the grammar is `bad-query` `unknown` before any tree read', async () => {
    const r = await rig();
    const unknown = (res: { statusCode: number; json(): unknown }, key: string, label: string): void => {
      expect(res.statusCode, label).toBe(400);
      expect(res.json(), label).toEqual({ ok: false, failure: 'bad-query', key, why: 'unknown' });
    };
    const scopeUrl = docsApi.artifactScope('project-a', committedPin());
    const pin = committedPin();
    // The scope read's query.
    unknown(await r.get(`${scopeUrl}&extra=1`), 'extra', 'scope query extra');
    unknown(await r.get(`${scopeUrl}&constructor=1`), 'constructor', 'scope query constructor');
    unknown(await r.get(`${scopeUrl}&__proto__=1`), '__proto__', 'scope query __proto__');
    // The mint's body, and the pin inside it.
    unknown(await r.post(docsApi.artifactMint(), { ...ask(), extra: 1 }), 'extra', 'mint body extra');
    unknown(await r.post(docsApi.artifactMint(), { ...ask(), constructor: 1 }), 'constructor', 'mint body constructor');
    unknown(await r.post(docsApi.artifactMint(), ask({ pin: { ...pin, extra: 1 } as unknown as DocListPin })), 'extra', 'mint pin extra');
    unknown(await r.post(docsApi.artifactMint(), ask({ pin: { ...pin, constructor: 1 } as unknown as DocListPin })), 'constructor',
      'mint pin constructor');
    // `__proto__` cannot be sent as a body key the parser would ever see as an own key: Fastify's JSON parser refuses it itself
    // (secure-json-parse), a 400 that is not this parser's, so only its refusal and the count of tree reads are asserted.
    const raw = await r.app.inject({
      method: 'POST', url: docsApi.artifactMint(), headers: { ...PWA_HEADERS, cookie: COOKIE, 'content-type': 'application/json' },
      payload: `{"project":"project-a","origins":[],"windows":false,"pin":${JSON.stringify(pin)},"__proto__":{"x":1}}`,
    });
    expect(raw.statusCode, 'mint body __proto__').toBe(400);
    expect(r.treeCalls).toHaveLength(0);
    expect(r.store!.list()).toEqual([]);
  });

  it('mint: a stat-pinned draft is `draft-too-large` before any tree read', async () => {
    const r = await rig();
    const pin = statDraftPin();
    const s = await scope(r, pin);
    expect(s.statusCode).toBe(REFUSAL_STATUS['draft-too-large']);
    expect(errorOf(s)).toBe('draft-too-large');
    const m = await mint(r, { pin });
    expect(m.statusCode).toBe(REFUSAL_STATUS['draft-too-large']);
    expect(errorOf(m)).toBe('draft-too-large');
    // Before the pin parser, so its other faults never show: a bad branch with no `fp` is still too large.
    const sloppy = await r.get(`/api/docs/artifacts/scope?project=project-a&branch=Bad%20Branch&head=zz&section=specs&path=${PAGE}&stat=1:2`);
    expect(errorOf(sloppy)).toBe('draft-too-large');
    const sloppyPin = { ...statDraftPin(), head: 'zz' } as DocListPin;
    expect(errorOf(await r.post(docsApi.artifactMint(), ask({ pin: sloppyPin })))).toBe('draft-too-large');
    // After the project check, which is the parser's own.
    expect((await r.get(docsApi.artifactScope('Not A Project!', pin))).json()).toMatchObject({ failure: 'bad-project' });
    expect(r.treeCalls).toHaveLength(0);
    expect(r.store!.list()).toEqual([]);
    // `stat` beside draft keys that carry an `fp` is the opened pin, and goes on to the tree read.
    const withFp = await r.get(`/api/docs/artifacts/scope?project=project-a&branch=feature&head=${FIXTURE_COMMIT}&section=specs&path=${PAGE}&fp=${DRAFT_FP}&stat=1:2`);
    expect(errorOf(withFp)).toBe('pin-moved');
    // `stat` with no draft keys is no pin at all.
    const lone = await r.get(`/api/docs/artifacts/scope?project=project-a&commit=${FIXTURE_COMMIT}&servedRef=${FIXTURE_SERVED}&section=specs&path=${PAGE}&stat=1:2`);
    expect(lone.json()).toMatchObject({ failure: 'bad-query', why: 'pin-shape' });
  });

  it('mint: a draft page above 4 MiB is out', async () => {
    const big = draft(PAGE, { fp: null, size: DOCS_MAX_FILE_BYTES + 1, mtimeNs: MTIME });
    const r = await rig({ tree: { ok: true, answer: treeOf([big]) } });
    const m = await mint(r, { pin: draftPin(SNAPSHOT_DIGEST) });
    expect(m.statusCode).toBe(REFUSAL_STATUS['draft-too-large']);
    expect(errorOf(m)).toBe('draft-too-large');
    expect(errorOf(await scope(r, draftPin(SNAPSHOT_DIGEST)))).toBe('draft-too-large');
    expect(r.store!.list()).toEqual([]);
    // A page of exactly 4 MiB with no fingerprint is not this word: its pin is simply not the tree's.
    const edge = await rig({ tree: { ok: true, answer: treeOf([draft(PAGE, { fp: null, size: DOCS_MAX_FILE_BYTES })]) } });
    expect(errorOf(await mint(edge, { pin: draftPin(SNAPSHOT_DIGEST) }))).toBe('pin-moved');
    // A draft page with a fingerprint, beside a 5 MiB stat-pinned draft sibling, mints, the sibling in its manifest.
    const entries = [draft(PAGE, { fp: DRAFT_FP, size: 100 }), draft('x/huge.bin', { fp: null, size: 5 * MIB, mtimeNs: MTIME })];
    const ok = await rig({ tree: { ok: true, answer: treeOf(entries) } });
    const m2 = await mint(ok, { pin: draftPin(DRAFT_FP) });
    expect(m2.statusCode).toBe(200);
    const view = ok.store!.lookup(tokenOf(m2))!;
    expect(view.manifest.get('x/huge.bin')?.pin).toEqual({ kind: 'stat', size: 5 * MIB, mtimeNs: MTIME });
    expect(view.manifest.get(PAGE)?.pin).toEqual({ kind: 'fp', sha: DRAFT_FP });
    expect(m2.json()).toMatchObject({ files: 2, uncommitted: 2 });
  });

  it('mint: a page above 2 MiB is admitted', async () => {
    const r = await rig({ tree: { ok: true, answer: treeOf([file(PAGE, 3145728), file('x/a.js', 10)]) } });
    const m = await mint(r);
    expect(m.statusCode).toBe(200);
    const view = r.store!.lookup(tokenOf(m))!;
    expect(view.manifest.get(PAGE)?.size).toBe(3145728);
    expect(view.manifest.get(PAGE)?.pin).toEqual({ kind: 'blob', sha: BLOB });
    // A page above the tier's one ceiling is refused, on both doors; a sibling that size is left out while the page mints.
    const over = await rig({ tree: { ok: true, answer: treeOf([file(PAGE, DOCS_RANGE_MAX_BYTES + 1)]) } });
    const refused = await mint(over);
    expect(refused.statusCode).toBe(REFUSAL_STATUS['page-too-large']);
    expect(errorOf(refused)).toBe('page-too-large');
    expect(errorOf(await scope(over))).toBe('page-too-large');
    expect(over.store!.list()).toEqual([]);
    const sibling = await rig({ tree: { ok: true, answer: treeOf([file(PAGE, 100), file('x/big.bin', DOCS_RANGE_MAX_BYTES + 1)]) } });
    const ok = await mint(sibling);
    expect(ok.statusCode).toBe(200);
    expect(manifestKeys(sibling.store, tokenOf(ok))).toEqual([PAGE]);
    expect(ok.json()).toMatchObject({ files: 1, unsized: 1 });
  });

  it('mint: a page with no size or no entry is `unmeasured`, never an empty manifest', async () => {
    for (const entries of [[file(PAGE, null)], [file('x/a.js', 10)], [file(PAGE, 10, 'symlink')]]) {
      const r = await rig({ tree: { ok: true, answer: treeOf(entries) } });
      expect(errorOf(await mint(r))).toBe('unmeasured');
      expect(errorOf(await scope(r))).toBe('unmeasured');
      expect(r.store!.list()).toEqual([]);
    }
  });

  it('mint: past the live limit answers `too-many`', async () => {
    const r = await rig();
    let last = await mint(r);
    for (let i = 1; i < 16; i++) last = await mint(r);
    expect(last.statusCode).toBe(200);
    const over = await mint(r);
    expect(over.statusCode).toBe(REFUSAL_STATUS['too-many']);
    expect(errorOf(over)).toBe('too-many');
  });
});

describe('artifact mint doors: Revoke and Revoke all (X5 A2.3)', () => {
  const direct = (store: ArtifactStore, session = SESSION_HASH): string => {
    const input: CapabilityInput = {
      sessionIdHash: session, project: 'project-a', pin: committedPin(), ref: { commit: FIXTURE_COMMIT, served: FIXTURE_SERVED },
      section: 'specs', dir: 'x', page: PAGE, manifest: new Map(), origins: [], windows: false,
    };
    const made = store.mint(input);
    if (!made.ok) throw new Error('the fixture could not mint');
    return made.id;
  };

  it('Revoke ends one capability, and answers 0 for an unknown id', async () => {
    const r = await rig();
    const m = (await mint(r)).json() as ArtifactMintOk;
    const token = m.url.split('/a/')[1]!;
    expect((await r.post(docsApi.artifactRevoke('nope'))).json()).toEqual({ ok: true, revoked: 0 });
    expect((await r.post(docsApi.artifactRevoke(m.id))).json()).toEqual({ ok: true, revoked: 1 });
    expect(r.store!.lookup(token)).toBeNull();
    expect((await r.post(docsApi.artifactRevoke(m.id))).json()).toEqual({ ok: true, revoked: 0 });
  });

  it('Revoke all ends every capability on the box', async () => {
    const r = await rig();
    direct(r.store!, 'a'.repeat(64));
    direct(r.store!, 'b'.repeat(64));
    await mint(r);
    expect((await r.post(docsApi.artifactRevokeAll())).json()).toEqual({ ok: true, revoked: 3 });
    expect(r.store!.list()).toEqual([]);
    expect((await r.post(docsApi.artifactRevokeAll())).json()).toEqual({ ok: true, revoked: 0 });
  });

  it('mint: revoke and revoke-all answer dark, and with no store', async () => {
    const dark = await rig({ signIn: 'dark' });
    const id = direct(dark.store!);
    direct(dark.store!);
    const one = await dark.post(docsApi.artifactRevoke(id));
    expect(one.statusCode).toBe(200);
    expect(one.json()).toEqual({ ok: true, revoked: 1 });
    expect((await dark.post(docsApi.artifactRevokeAll())).json()).toEqual({ ok: true, revoked: 1 });
    const off = await rig({ tier: { state: 'off', why: 'unset', detail: '' }, store: false, listener: null });
    expect((await off.post(docsApi.artifactRevoke('anything'))).json()).toEqual({ ok: true, revoked: 0 });
    expect((await off.post(docsApi.artifactRevokeAll())).json()).toEqual({ ok: true, revoked: 0 });
  });
});

describe('artifact mint doors: the routes and the vocabulary (X5 A2.3)', () => {
  it('a project named `artifacts` still reaches its tree route', async () => {
    const tree = treeOf([], { project: 'artifacts' });
    const r = await rig({ tree: { ok: true, answer: tree } });
    const res = await r.get(docsApi.tree('artifacts', null));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, tree: { project: 'artifacts' } });
    // And the list door still answers at its own path.
    expect((await r.get(docsApi.artifacts())).json()).toMatchObject({ ok: true, available: true });
  });

  it('a project named `artifacts` still reaches its refresh route, and not a mint door', async () => {
    const r = await rig({ tree: { ok: true, answer: treeOf([], { project: 'artifacts' }) } });
    // A local qualified branch is not fetched (the rig's fetcher would throw), so the refresh is the tree half alone.
    const res = await r.post('/api/docs/artifacts/refresh', { ref: 'refs/heads/main', reason: 'manual' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, fetch: { state: 'skipped' }, tree: { ok: true, tree: { project: 'artifacts' } } });
    expect(r.treeCalls.map((c) => c.project)).toEqual(['artifacts']);
    expect(r.fetchCalls).toEqual([]);
    expect(r.store!.list()).toEqual([]);
  });

  it('docsApi builds the five URLs', () => {
    expect(docsApi.artifacts()).toBe('/api/docs/artifacts');
    expect(docsApi.artifactMint()).toBe('/api/docs/artifacts');
    expect(docsApi.artifactRevoke('a/b c')).toBe('/api/docs/artifacts/a%2Fb%20c/revoke');
    expect(docsApi.artifactRevokeAll()).toBe('/api/docs/artifacts/revoke-all');
    expect(docsApi.artifactScope('project-a', committedPin())).toBe(
      `/api/docs/artifacts/scope?project=project-a&commit=${FIXTURE_COMMIT}&servedRef=${encodeURIComponent(FIXTURE_SERVED)}&section=specs&path=x%2Fpage.html`);
    expect(docsApi.artifactScope('project-a', draftPin(DRAFT_FP))).toBe(
      `/api/docs/artifacts/scope?project=project-a&branch=feature&head=${FIXTURE_COMMIT}&section=specs&path=x%2Fpage.html&fp=${DRAFT_FP}`);
    expect(docsApi.artifactScope('project-a', statDraftPin())).toBe(
      `/api/docs/artifacts/scope?project=project-a&branch=feature&head=${FIXTURE_COMMIT}&section=specs&path=x%2Fpage.html&stat=${5 * MIB}%3A${MTIME}`);
  });

  it('every artifact refusal is a route refusal with its own status, and the mint words are declared once', () => {
    // A type-level check: a word of `ArtifactRefusal` that is not a `RouteRefusal` fails to compile here.
    const everyWordIsARouteRefusal: ArtifactRefusal extends RouteRefusal ? true : never = true;
    expect(everyWordIsARouteRefusal).toBe(true);
    for (const word of ARTIFACT_REFUSALS) expect(REFUSAL_STATUS[word], word).toBeGreaterThanOrEqual(400);
    expect(ARTIFACT_MINT_REFUSALS).toEqual({
      'artifact-host-unset': 409, 'artifact-listener-down': 503, 'not-html': 400, 'too-many': 429, 'bad-origin': 400,
      'pin-moved': 409, 'page-too-large': 413, 'draft-too-large': 413,
    });
    for (const [word, status] of Object.entries(ARTIFACT_MINT_REFUSALS)) expect(REFUSAL_STATUS[word as RouteRefusal]).toBe(status);
  });
});

describe('artifact mint policy: origins and the manifest (X5 A2.3)', () => {
  const own = [CONSOLE, ARTIFACT, CONTENT];

  it('originAdmission refuses a non-https-exact origin and a host of the console, the artifact or the content origin, on any port', () => {
    expect(originAdmission('https://api.example.test', own)).toBe(true);
    expect(originAdmission('https://api.example.test:8443', own)).toBe(true);
    for (const o of [CONSOLE, ARTIFACT, CONTENT, `${CONTENT}:1`, `${ARTIFACT}:65535`, 'http://api.example.test', 'https://API.example.test',
      'https://api.example.test/', '']) {
      expect(originAdmission(o, own), o).toBe(false);
    }
    // A loopback console's host is refused whatever its scheme.
    expect(originAdmission('https://localhost', ['http://localhost:7788', ARTIFACT, CONTENT])).toBe(false);
  });

  it('originAdmission refuses a host a browser reads as an IPv4 address, in any spelling', async () => {
    for (const o of ['https://127.0.0.2', 'https://10.1', 'https://0x7f.0.0.1', 'https://127.0.0.1:8443', 'https://0x7f000001']) {
      expect(originAdmission(o, own), o).toBe(false);
    }
    // A name that merely contains digits is still a name.
    expect(originAdmission('https://api1.example.test', own)).toBe(true);
    expect(originAdmission('https://10.example.test', own)).toBe(true);
    // And the mint door answers `bad-origin` for them before any tree read.
    const r = await rig();
    for (const o of ['https://127.0.0.2', 'https://10.1', 'https://0x7f.0.0.1']) {
      const m = await mint(r, { origins: [o] });
      expect(m.statusCode, o).toBe(REFUSAL_STATUS['bad-origin']);
      expect(errorOf(m), o).toBe('bad-origin');
    }
    expect(r.treeCalls).toHaveLength(0);
    expect(r.store!.list()).toEqual([]);
  });

  it('revokeAnswer and listAnswer assemble the trivial answers', () => {
    expect(revokeAnswer(null)).toEqual({ ok: true, revoked: 0 });
    expect(revokeAnswer(false)).toEqual({ ok: true, revoked: 0 });
    expect(revokeAnswer(true)).toEqual({ ok: true, revoked: 1 });
    expect(revokeAnswer(0)).toEqual({ ok: true, revoked: 0 });
    expect(revokeAnswer(7)).toEqual({ ok: true, revoked: 7 });
    expect(listAnswer({ available: true }, null)).toEqual({ ok: true, available: true, live: [] });
    expect(listAnswer({ available: false, why: 'unset' }, null)).toEqual({ ok: true, available: false, why: 'unset', live: [] });
  });

  it('manifestScope leaves out the segments `.`, `..` and the empty one, and another section', () => {
    const pin = committedPin();
    const entries = [
      file(PAGE, 1), file('x/./a.js', 1), file('x/../y.js', 1), file('x//b.js', 1), file('x/ok.js', 2),
      { ...file('x/other.js', 3), section: 'plans' as const },
    ];
    const s = manifestScope(pin, PAGE, entries);
    expect(s.entries.map((e) => e.rel)).toEqual([PAGE, 'x/ok.js']);
    expect(s).toMatchObject({ unsized: 0, uncommitted: 0, bytes: 3, page: 'ok' });
  });

  it('manifestScope names each entry\'s pin and MIME, a draft one by its fingerprint or its stat', () => {
    const pin = draftPin(DRAFT_FP);
    const s = manifestScope(pin, PAGE, [
      draft(PAGE, { fp: DRAFT_FP, size: 10 }), draft('x/a.js', { fp: SNAPSHOT_DIGEST, size: 5 }),
      draft('x/big.wasm', { fp: null, size: 5 * MIB, mtimeNs: MTIME }),
      { ...file('x/c.css', 7), draft: null },
      draft('x/gone.js', { fp: null, size: 0, state: 'deleted', kind: 'absent' }),
    ]);
    const by = Object.fromEntries(s.entries.map((e) => [e.rel, e]));
    expect(by['x/a.js']).toMatchObject({ pin: { kind: 'fp', sha: SNAPSHOT_DIGEST }, mime: 'text/javascript', committed: false });
    expect(by['x/big.wasm']).toMatchObject({ pin: { kind: 'stat', size: 5 * MIB, mtimeNs: MTIME }, mime: 'application/wasm' });
    expect(by['x/c.css']).toMatchObject({ pin: { kind: 'blob', sha: BLOB }, mime: 'text/css', committed: true });
    expect(Object.keys(by)).not.toContain('x/gone.js');
    expect(s).toMatchObject({ uncommitted: 3, unsized: 0, page: 'ok' });
  });
});
