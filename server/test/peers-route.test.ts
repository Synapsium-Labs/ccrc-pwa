// GET /api/peers — discovery reports the contradiction instead of resolving it
// (build 9 D9). No `addressable` boolean anywhere: `archivedAt` rides verbatim
// and decides nothing; `archivedStale` NAMES archived-but-live; `projects[]`
// replaces a `projectKnown` boolean because the obvious `io.stat` probe is
// built on the one call the tree already knows lies (D-114).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { PEER_ETIQUETTE } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const UUID_A = 'a'.repeat(36);
const UUID_B = 'b'.repeat(36);
const UUID_C = 'c'.repeat(36);
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';

/** A registry row `readRegistry` will keep: wrapper+workdir+uuid, plus the
 *  workspace/branch pair the peer list reports. */
const seed = (home: string, id: string, uuid: string,
              over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const slug = id.replace(/^[a-z-]+?-/, '');
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/demo/${slug}`, uuid,
    started: '1', workspace: slug, branch: `ws/${slug}`, ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** tmux that answers has-session per id: ids named in `dead` have no pane.
 *  `sessionLifecycle` then classifies each row from the pane verdict plus the
 *  registry stamps — dead + `.stopped` reads `stopped`, alive + started reads
 *  running/unsupervised (`shared/api.ts:1325`). */
const tmuxRunner = (dead: readonly string[] = []): Runner => async (_cmd, args) => {
  if (args[0] === 'has-session') {
    const target = args.join(' ');
    return { code: dead.some((d) => target.includes(d)) ? 1 : 0, stdout: '', stderr: '' };
  }
  if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
  if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
  return { code: 1, stdout: '', stderr: '' };
};

const openApp = async (home: string, run: Runner, over: Partial<Deps> = {}) => {
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, run), mailToken: TOKEN, coord, ...over });
  return { app, coord };
};

const peers = (app: FastifyInstance, qs: string, headers: Record<string, string> = tok) =>
  app.inject({ method: 'GET', url: `/api/peers${qs}`, headers });

interface PeerRow {
  id: string; deliverable: string; archivedAt: number | null; archivedStale: boolean;
  lifecycle: string | null; intent: string | null; claimedPaths: string[];
}
const rows = (res: { body: string }): PeerRow[] =>
  (JSON.parse(res.body) as { peers: PeerRow[] }).peers;

describe('GET /api/peers', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('refuses zero query params and both — exactly one of ?project= / ?of=', async () => {
    const home = mkTmp('ccrc-peers-');
    const w = await openApp(home, tmuxRunner()); app = w.app;
    for (const qs of ['', '?project=demo&of=demo-quiet-mesa']) {
      const res = await peers(app, qs);
      expect(res.statusCode, qs || '(none)').toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    }
  });

  it('lists a project: a live peer is yes, a stopped one is no:stopped, and etiquette rides along', async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'demo-still-pond', UUID_B, { stopped: '1755700000 pwa' });
    const w = await openApp(home, tmuxRunner(['demo-still-pond'])); app = w.app;

    const res = await peers(app, '?project=demo');
    expect(res.statusCode).toBe(200);
    const byId = new Map(rows(res).map((p) => [p.id, p]));
    expect(byId.get('demo-quiet-mesa')?.deliverable).toBe('yes');
    expect(byId.get('demo-still-pond')?.deliverable).toBe('no:stopped');
    expect(byId.get('demo-still-pond')?.lifecycle).toBe('stopped');
    // The five rules, verbatim, in the SAME answer that granted discovery
    // (D17: a skill reaches a home only once its installer has run there;
    // the route reaches every caller).
    expect(res.json().etiquette).toEqual([...PEER_ETIQUETTE]);
  });

  it('reports the archived-but-live row: archivedAt verbatim, archivedStale NAMED, deliverable yes', async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'demo-calm-mesa', UUID_B, { archived: '1755300123', archivedreason: 'merged:#42' });
    const w = await openApp(home, tmuxRunner()); app = w.app;   // calm-mesa is ALIVE

    const p = rows(await peers(app, '?project=demo')).find((r) => r.id === 'demo-calm-mesa')!;
    expect(p.archivedAt).toBe(1755300123);        // verbatim — a field that is silently false
    expect(p.deliverable).toBe('yes');            // ...must not be laundered into a filter (D9)
    expect(p.archivedStale).toBe(true);           // the contradiction, named
  });

  it("an unmeasurable row is 'unknown' — which is NOT 'no'", async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'demo-vague-hill', UUID_B);
    const w = await openApp(home, tmuxRunner(),
      { io: unreadableField('demo-vague-hill', 'started') }); app = w.app;

    const p = rows(await peers(app, '?project=demo')).find((r) => r.id === 'demo-vague-hill')!;
    expect(p.deliverable).toBe('unknown');
    expect(p.lifecycle).toBe('unmeasurable');
  });

  it('?of= derives the project and excludes the asker; ?project= includes every row', async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'demo-still-pond', UUID_B);
    const w = await openApp(home, tmuxRunner()); app = w.app;

    const of = rows(await peers(app, '?of=demo-quiet-mesa')).map((p) => p.id);
    expect(of).toEqual(['demo-still-pond']);
    const proj = rows(await peers(app, '?project=demo')).map((p) => p.id).sort();
    expect(proj).toEqual(['demo-quiet-mesa', 'demo-still-pond']);
  });

  it("a typo'd project answers [] plus projects[] — 'I am alone' is disprovable", async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'other-plain-harbor', UUID_C, { project: 'other', workdir: '/w/other/plain-harbor' });
    const w = await openApp(home, tmuxRunner()); app = w.app;

    const res = await peers(app, '?project=demo-typo');
    expect(res.statusCode).toBe(200);
    expect(res.json().peers).toEqual([]);
    // Every project measured THIS pass — the free measurement, not an io.stat
    // probe on the one call the tree knows lies (D-114). No projectKnown boolean.
    expect(res.json().projects).toEqual(['demo', 'other']);
  });

  it('?of= an unknown id is 404; an unlistable registry is 502, never 404', async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const w = await openApp(home, tmuxRunner()); app = w.app;
    const gone = await peers(app, '?of=demo-never-was');
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toMatchObject({ ok: false, error: 'unknown-session' });
    await app.close();

    const unlistable: FleetIO = { ...localIO, readdir: async () => null };
    const w2 = await openApp(home, tmuxRunner(), { io: unlistable }); app = w2.app;
    const res = await peers(app, '?of=demo-quiet-mesa');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
  });

  it('renders a live claim as intent + claimedPaths on the holding row (D12 ruling 3)', async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'demo-still-pond', UUID_B);
    const w = await openApp(home, tmuxRunner()); app = w.app;
    // `claimAttempt` with `sessionId`/`uuid` is the LANDED spelling (Task 12's
    // store) — the plan's `acquireClaims({byId, byUuid, ...})` predates it,
    // and the defining task's landed spelling wins (plan governance).
    const r = w.coord.claimAttempt({ project: 'demo', paths: ['shared/api.ts', 'shared/roster.ts'],
      sessionId: 'demo-quiet-mesa', uuid: UUID_A, intent: 'rewiring the roster', runId: null,
      now: Date.now() });
    expect(r.ok).toBe(true);

    const byId = new Map(rows(await peers(app, '?project=demo')).map((p) => [p.id, p]));
    expect(byId.get('demo-quiet-mesa')?.intent).toBe('rewiring the roster');
    expect(byId.get('demo-quiet-mesa')?.claimedPaths.sort())
      .toEqual(['shared/api.ts', 'shared/roster.ts']);
    expect(byId.get('demo-still-pond')?.intent).toBeNull();
  });

  it('intent is the MOST RECENTLY RENEWED live claim, not the newest row (D12 ruling 3)', async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const w = await openApp(home, tmuxRunner()); app = w.app;
    const t0 = Date.now();
    // Claim A: the OLDER row.
    const a = w.coord.claimAttempt({ project: 'demo', paths: ['server/src/io.ts'],
      sessionId: 'demo-quiet-mesa', uuid: UUID_A, intent: 'measuring the read seam',
      runId: null, now: t0 });
    expect(a.ok).toBe(true);
    // Claim B: a NEWER row (higher id), never renewed after this.
    const b = w.coord.claimAttempt({ project: 'demo', paths: ['shared/api.ts'],
      sessionId: 'demo-quiet-mesa', uuid: UUID_A, intent: 'sketching the wire',
      runId: null, now: t0 + 1_000 });
    expect(b.ok).toBe(true);
    // Renewal UPDATEs claim A IN PLACE: id unchanged, intent re-written,
    // renewedAt moves PAST claim B's. Row id therefore cannot stand in for
    // recency — the L0 contract (PeerSummary docstring) says the intent is
    // the most recently RENEWED live claim's, and that is A's now.
    const r = w.coord.claimAttempt({ project: 'demo', paths: ['server/src/io.ts'],
      sessionId: 'demo-quiet-mesa', uuid: UUID_A, intent: 'hardening the read seam',
      runId: null, now: t0 + 2_000 });
    expect(r.ok).toBe(true);

    const p = rows(await peers(app, '?project=demo')).find((x) => x.id === 'demo-quiet-mesa')!;
    expect(p.intent).toBe('hardening the read seam');   // claim A's, renewed last — never row B's
    // The paths still aggregate EVERY live claim; only the intent picks one.
    expect(p.claimedPaths.sort()).toEqual(['server/src/io.ts', 'shared/api.ts']);
  });

  it('ARMED: anon is 401 with a verdict; the box token passes; auth precedes even the 501', async () => {
    const home = mkTmp('ccrc-peers-');
    const base = testDeps(home, tmuxRunner());
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
    // NO coord store: the 501 must come AFTER the credential check, or an
    // anonymous tailnet caller learns whether this box runs coordination.
    app = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: true }, mailToken: TOKEN });
    const anon = await peers(app, '?project=demo', {});
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ ok: false, error: 'unauthenticated', verdict: 'no-session' });
    const withToken = await peers(app, '?project=demo');
    expect(withToken.statusCode).toBe(501);
    expect(withToken.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('DARK: a box with CCRC_AUTH off behaves exactly as before the slice', async () => {
    const home = mkTmp('ccrc-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const w = await openApp(home, tmuxRunner()); app = w.app;
    const res = await peers(app, '?project=demo', {});   // no credential of any kind
    expect(res.statusCode).toBe(200);
  });
});
