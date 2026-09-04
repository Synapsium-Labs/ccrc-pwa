// THE SWEEP. One `onRequest` hook is supposed to stand in front of every route
// and every socket on this server; this file is the measurement that says so.
//
// It does NOT hold a hand-copied list of routes, and that is the whole point:
// `coord-pause-route.test.ts:152-211` and `verb-gate.test.ts` are the templates
// — read the registrations out of the SOURCE, then assert the property over
// what was read. A route added next month is covered because it exists, not
// because someone remembered to add it here; a list typed out by hand goes stale
// on the first PR and reports green for a surface it no longer describes.
//
// The scanner is therefore the single most load-bearing thing in the file, and a
// scanner that matched NOTHING would make every `it.each` below vacuously green
// — a suite that asserts a property over the empty set. `the scanner is looking
// at something` (first describe) fails first and specifically for exactly that.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { buildServer, type Deps } from '../src/server.js';
import {
  EXEMPT, NO_SESSION, SECRET_UNREAD, authVerdict, exemptKey, installGate, measureSecret, sessionVerdict,
  type GateRequest,
} from '../src/auth/gate.js';
import { SESSION_COOKIE, serializeCookie } from '../src/auth/cookie.js';
import { SessionStore } from '../src/auth/sessions.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { PtyLike } from '../src/pty.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', 'src');

/**
 * scrypt at the shipped `DEFAULT_PARAMS` (N=65536) is ~100 ms of deliberate CPU
 * per verify — that cost is the actual brute-force brake and it belongs in
 * production. Here it would be ~100 ms × every login this file performs, for a
 * property that has nothing to do with the cost factor. The FORMAT is
 * self-describing (`secret.ts`), so a cheap line verifies through the identical
 * code path a real one does.
 */
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
/** The box token the fleet host presents (`x-ccrc-mail-token`). */
const BOX_TOKEN = 'box-token-for-the-gate-suite';
const tokenHeader = { 'x-ccrc-mail-token': BOX_TOKEN };

/**
 * EXEMPT FROM THE GATE, BUT AUTHENTICATED BY THE HANDLER — D-149's category,
 * declared here rather than derived, exactly as `FLAG_AWARE` is and for the same
 * reason: membership is the only way out of the strongest assertions in this
 * file, so it has to be a line a reviewer looks at.
 *
 * These routes are in `EXEMPT`, so the hook lets them through — and then they
 * refuse an anonymous caller themselves, with a body deliberately shaped like
 * the gate's (it carries an `AuthVerdict`, so the PWA's one login screen keeps
 * working). That shape is why `gateRefused` CANNOT tell the two apart for them,
 * and why the sweep below probes them with the box token instead: if the GATE
 * were refusing, presenting a token would change nothing.
 */
const EXEMPT_BUT_AUTHENTICATED = new Set(
  ['GET /api/lifecycle', 'GET /api/runs', 'GET /api/runs/:id/items',
   'GET /api/peers', 'GET /api/claims']);

// ── the scanner ──────────────────────────────────────────────────────────

interface ScannedRoute { method: string; routePath: string; file: string }

/** Every `app.get('…')` / `app.post('…')` registration in one file. Matches the
 *  five HTTP verbs Fastify's shorthand exposes, not just the two in use today —
 *  a `app.delete(...)` added tomorrow must be swept, not silently skipped. */
function scanRoutes(file: string): ScannedRoute[] {
  const src = readFileSync(path.join(srcRoot, file), 'utf8');
  return [...src.matchAll(/app\.(get|post|put|patch|delete)\('([^']+)'/g)]
    .map((m) => ({ method: m[1]!.toUpperCase(), routePath: m[2]!, file }));
}

const ROUTES: ScannedRoute[] = [...scanRoutes('server.ts'), ...scanRoutes('coord/routes.ts')];

/** The three websocket upgrades — the same registrations, told apart by their
 *  `{ websocket: true }` option. They are swept through `injectWS`, not
 *  `inject`. */
const WS_ROUTES = ['/ws/fleet', '/ws/session/:id', '/ws/pty/:id'];
const isWs = (r: ScannedRoute): boolean => WS_ROUTES.includes(r.routePath);

const key = (r: ScannedRoute): string => `${r.method} ${r.routePath}`;

/** A concrete url for a route pattern — `:id` becomes something a param route
 *  will match. The VALUE is irrelevant: every assertion here is about the gate,
 *  which runs before any handler looks at a param. */
const concrete = (routePath: string): string => routePath.replace(/:[^/]+/g, 'x');

/** Is the dist-pwa bundle present in this checkout? `server/dist-pwa/` is a
 *  BUILD ARTEFACT and gitignored, so it is there on a developer box that has run
 *  the PWA build and absent on a fresh clone. `buildServer` skips the static
 *  plugin and the SPA fallback entirely when it is missing, which means the
 *  `GET /*` exemption is dormant rather than wrong — the tests that touch it say
 *  so out loud instead of quietly passing. */
const HAS_PWA = existsSync(path.resolve(here, '..', 'dist-pwa', 'index.html'));

// ── fixtures ─────────────────────────────────────────────────────────────

/** A pty that never touches tmux. REQUIRED, not tidiness: the real `attachPty`
 *  runs `tmux attach -t cc-<id>` on this box, and `/ws/pty/:id` is one of the
 *  three sockets swept below. The gate refuses the upgrade before the handler
 *  runs — but the mutation runs that measure this suite DELETE the gate, and a
 *  suite whose mutant spawns tmux against the live box is not a suite anyone can
 *  run. */
const stubPty = (): PtyLike => ({
  onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {},
});

interface AppOpts {
  /** `CCRC_AUTH` — armed unless a test says otherwise. */
  enabled?: boolean;
  /** Write a passphrase file? `false` is the fail-shut "armed but unconfigured" box. */
  secret?: boolean;
  /** Raw bytes for the secret file, for the garbled/unusable cases. */
  secretText?: string;
  generation?: number;
  cookieSecure?: boolean;
}

const openApp = async (opts: AppOpts = {}): Promise<{ app: FastifyInstance; home: string }> => {
  const home = mkTmp('ccrc-auth-gate-');
  const base = testDeps(home);
  if (opts.secretText !== undefined || opts.secret !== false) {
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const line = opts.secretText
      ?? `${await hashLine(PASSPHRASE, FAST_PARAMS, opts.generation ?? 1)}\n`;
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), line, { mode: 0o600 });
  }
  const deps: Deps = {
    ...base,
    cfg: {
      ...base.cfg,
      authEnabled: opts.enabled ?? true,
      cookieSecure: opts.cookieSecure ?? false,
    },
    // The box token, so the EXEMPT-BUT-AUTHENTICATED lane (D-149) can be probed
    // with its OTHER credential. Without one configured, `checkMailToken`
    // answers `'unconfigured'`, which those routes refuse — fail-shut, and not
    // the thing this file wants to measure.
    mailToken: BOX_TOKEN,
    spawnPty: stubPty,
  };
  const app = await buildServer(deps);
  await app.ready();
  return { app, home };
};

/** A live session cookie for `app`, minted through the real login route. */
const login = async (app: FastifyInstance): Promise<string> => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};

/**
 * Is this response THE GATE's refusal, as opposed to a route's own 401?
 *
 * The distinction is load-bearing in both directions: `/api/mail` answers its
 * OWN 401 (`checkMailToken`, no `verdict` field) for a caller with no box token,
 * and it must keep doing so — an exempt route is exempt from the SESSION gate,
 * not from its own. Matching on the `verdict` field rather than on the status
 * code is what lets the sweep tell "the gate refused this" from "the route
 * refused this for its own, unrelated reason".
 */
const gateRefused = (res: { statusCode: number; body: string }): boolean => {
  if (res.statusCode !== 401) return false;
  try { return typeof (JSON.parse(res.body) as { verdict?: unknown }).verdict === 'string'; }
  catch { return false; }
};

const verdictOf = (res: { body: string }): unknown => (JSON.parse(res.body) as { verdict?: unknown }).verdict;

// ── the meta-test: the scanner is looking at something ───────────────────

describe('the scanner is looking at something', () => {
  // A scanner that matched zero registrations would make every `it.each` in this
  // file iterate an empty array and report green — the exact failure mode that
  // makes a source-scanning suite worse than no suite. This one fails first.
  it('found both files, and EXACTLY the route count the surface has', () => {
    // EXACT, not a floor (review fold-in). A `toBeGreaterThanOrEqual` catches a
    // scanner that broke outright but not one that quietly stops matching SOME
    // registrations — a changed quote style in one file, a verb the regex does
    // not know — and a sweep that silently shrank from 52 routes to 46 is
    // precisely the state this whole file exists to make impossible. Adding a
    // route is now a deliberate act that edits these three numbers, with a
    // reviewer looking at them.
    expect(scanRoutes('server.ts').length).toBe(46);
    // 22 since `GET /api/runs/:id/items` — the READ half of the settle route,
    // which keys on item ids that nothing else published.
    // 23 since `POST /api/runs/:id/reclaim` — the fourth ungated operator door,
    // and the first route in this file whose whole job is to rewrite `claimedBy`.
    // 25 since `GET`/`POST /api/coord/caps` — the operator dial on the two
    // coordination caps, and the first pair in this file that is neither
    // box-token gated nor one of the D-282 ungated doors (D-1240).
    expect(scanRoutes('coord/routes.ts').length).toBe(25);
    expect(ROUTES.length).toBe(71);
    // …and the three partitions add up: the websockets plus the HTTP half.
    expect(ROUTES.filter(isWs).length + ROUTES.filter((r) => !isWs(r)).length).toBe(ROUTES.length);
    // DERIVED, not the literal 68 (D-1242's family, extended — F7). `WS_ROUTES`
    // is declared with exactly its three members and the sweep test below proves
    // each was FOUND, so this equality says "the HTTP half is everything that is
    // not one of those sockets" — which is what the literal stood in for.
    //
    // THE FLOOR STAYS, and it is not decoration: the derived form is an identity
    // that a collapsed `ROUTES` satisfies at 0 = 0, which is the one thing the
    // literal could never do. `httpCount > 50` in the D-1223 block below asserts
    // the same floor from the other end; this one keeps it local to the
    // assertion it protects.
    expect(ROUTES.filter((r) => !isWs(r)).length).toBeGreaterThan(50);
    expect(ROUTES.filter((r) => !isWs(r)).length).toBe(ROUTES.length - WS_ROUTES.length);
  });

  it('found the specific registrations this file reasons about', () => {
    const keys = ROUTES.map(key);
    for (const k of [
      'GET /health', 'POST /api/notify', 'POST /api/mail', 'GET /api/mail/:id',
      'POST /api/runs', 'GET /api/runs', 'GET /api/feed', 'POST /api/coord/pause',
      'POST /api/sessions/:id/prompt', 'GET /ws/fleet', 'GET /ws/pty/:id',
      'POST /api/auth/login', 'POST /api/auth/logout', 'GET /api/auth/status',
      // Task 8's four, which split TWO ways under the gate: the register pair is
      // gated (enrolling requires already being in), the assert pair is exempt
      // (it IS the door). A scanner that missed either would leave the sweep
      // blind to exactly that distinction.
      'POST /api/auth/passkey/register/start', 'POST /api/auth/passkey/register/finish',
      'POST /api/auth/passkey/assert/start', 'POST /api/auth/passkey/assert/finish',
      // Revocation (MF-2). `DELETE` is the first non-GET/POST verb on this
      // server, which is exactly why `scanRoutes`' regex has always matched all
      // five shorthands rather than the two in use.
      'GET /api/auth/passkeys', 'DELETE /api/auth/passkey/:id',
    ]) expect(keys, `${k} was not found by the scanner`).toContain(k);
    // Both a GET and a POST on the same path, which is the case a path-only
    // exempt table would get wrong (the POST is a box-token machine lane, the
    // GET is the PWA's read).
    expect(keys.filter((k) => k.endsWith(' /api/runs')).sort()).toEqual(['GET /api/runs', 'POST /api/runs']);
  });

  it('sweeps all three websockets, and finds them registered', () => {
    const keys = ROUTES.map(key);
    for (const w of WS_ROUTES) expect(keys).toContain(`GET ${w}`);
    // DERIVED, not the literal 3 (D-1242's family): `WS_ROUTES` is declared three
    // lines from here with exactly these members, and this file already writes
    // `WS_ROUTES.length` elsewhere. Paired with the loop above — which proves
    // every member was actually FOUND in the scan — the equality says the scan
    // sees those sockets and no others, which is what the literal was standing in
    // for. It was the one avoidable member of this file's six hand-kept cardinals.
    expect(ROUTES.filter(isWs)).toHaveLength(WS_ROUTES.length);
  });
});

// ── the scanner, measured against reality ────────────────────────────────

/**
 * Every route Fastify itself says it has, reconstructed from `printRoutes`.
 *
 * WHY THIS EXISTS (review R4): the exact counts above catch a scanner that
 * NARROWS on the two files it reads, but they are blind to the opposite failure —
 * a route registered in a syntax the regex at the top of this file never matches
 * (`app.route({…})`, a template-literal path, a third source file, a plugin's own
 * routes). Such a route never enters the count, every number stays green, and it
 * is SILENTLY UNGATED. Counting is not measuring; the whole sweep's authority
 * rests on the scanner being complete, and until now that was assumed.
 *
 * `printRoutes` prints a radix TREE, so a node carries only the segment its
 * parent does not — `/api/sessions` → `/:id/pr` → `ompt` is
 * `/api/sessions/:id/prompt`. Depth comes from the indent (four columns a level)
 * and the full path is the stack joined, which is why this walks rather than
 * greps. `HEAD` rows are dropped: Fastify auto-exposes one per GET route and
 * `exemptKey` normalises them onto their GET.
 */
function realRouteTable(app: FastifyInstance): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [];
  let matched = 0;
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = /^([│\s]*)[├└]──\s(\S*)\s\(([^)]+)\)\s*$/.exec(line);
    if (line.trim() === '') continue;
    // A line the parser cannot read is a BROKEN PARSER, not a route to skip —
    // and a silently skipped line is how this guard would come to certify a table
    // it never saw. It is recorded as a pseudo-route so the assertion names it.
    if (!m) { out.add(`UNPARSED ${line}`); continue; }
    matched++;
    const depth = m[1]!.length / 4;
    stack.length = depth;
    stack[depth] = m[2]!;
    // The root wildcard prints as `*`; it is registered as `/*`.
    const full = stack.slice(0, depth + 1).join('') || '/';
    for (const method of m[3]!.split(',')) {
      const verb = method.trim();
      if (verb === 'HEAD') continue;
      out.add(`${verb} ${full === '*' ? '/*' : full}`);
    }
  }
  if (matched === 0) out.add('UNPARSED the whole tree — printRoutes changed shape');
  return out;
}

describe('the scanner is COMPLETE — measured against Fastify\'s own route table', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('every route the server really registers was found by the source scan', async () => {
    const w = await openApp(); app = w.app;
    const real = realRouteTable(app);
    const scanned = new Set(ROUTES.map(key));
    // The only registrations that legitimately do NOT appear in either source
    // file, named with their origin. `@fastify/static`'s wildcard is the whole
    // list — and it is already an EXEMPT entry with its own stated reason.
    const FROM_A_PLUGIN = new Set(['GET /*']);
    const unscanned = [...real].filter((r) => !scanned.has(r) && !FROM_A_PLUGIN.has(r)).sort();
    expect(unscanned,
      'routes the server serves that the sweep never sees — each one is silently UNGATED').toEqual([]);
  });

  it('…and in the other direction: nothing the scan found is a phantom', async () => {
    const w = await openApp(); app = w.app;
    const real = realRouteTable(app);
    const missing = ROUTES.map(key).filter((k) => !real.has(k)).sort();
    expect(missing, 'the scan invented routes this server does not register').toEqual([]);
  });

  it('the table parser is looking at something — guards the guard', async () => {
    // If `printRoutes` ever changes shape, both assertions above would pass
    // vacuously on an empty set. This fails first and specifically.
    const w = await openApp(); app = w.app;
    const real = realRouteTable(app);
    expect([...real].filter((r) => r.startsWith('UNPARSED'))).toEqual([]);
    // 59 scanned + the static wildcard when the bundle is built.
    expect(real.size).toBe(ROUTES.length + (HAS_PWA ? 1 : 0));
    // And the reconstruction really joins the tree back up, rather than reading
    // leaf segments: these two only exist if the depth walk works.
    expect(real.has('GET /api/fleet/health')).toBe(true);
    expect(real.has('POST /api/sessions/:id/prompt')).toBe(true);
  });
});

// ── EXEMPT, in both directions ───────────────────────────────────────────

describe('EXEMPT is complete in both directions', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('every EXEMPT entry names a route this server really registers — no dead entries', async () => {
    const w = await openApp(); app = w.app;
    const dead: string[] = [];
    for (const k of EXEMPT.keys()) {
      const [method, url] = [k.slice(0, k.indexOf(' ')), k.slice(k.indexOf(' ') + 1)];
      // `GET /*` is @fastify/static's wildcard, registered only when the bundle
      // has been built into `server/dist-pwa/`. On a checkout without one the
      // entry is DORMANT, not dead — and the branch says so rather than being
      // quietly skipped.
      if (url === '/*' && !HAS_PWA) continue;
      if (!app.hasRoute({ method: method as 'GET', url })) dead.push(k);
    }
    expect(dead, 'EXEMPT names routes that do not exist').toEqual([]);
  });

  it('every EXEMPT entry states its reason, in the source', () => {
    // An exemption is a hole with an argument attached. A later edit that adds
    // one must have to write the argument, not merely add a line.
    for (const [k, reason] of EXEMPT) {
      expect(reason, `${k} carries no reason`).toBeTruthy();
      expect(reason.length, `${k}'s reason is too short to be one`).toBeGreaterThan(40);
    }
  });

  it('exempts exactly the six classes the plan names — nothing has crept in', () => {
    // The whole set, spelled out, so that adding an exemption is a deliberate act
    // that edits this list with a reviewer looking at it. 25 = /health + the 13
    // box-token lanes + /api/notify + login + status + the SPA shell + the two
    // halves of the passkey door + the FIVE exempt-BUT-authenticated GETs
    // (D-149's pattern): GET /api/runs, GET /api/runs/:id/items,
    // GET /api/lifecycle, GET /api/peers and GET /api/claims.
    //
    // It read 24 and enumerated 24 until F7 (D-1302), three lines above a
    // `toEqual` listing 25 keys: the tail omitted `GET /api/runs/:id/items`,
    // which IS in the exempt-but-authenticated class and is the fifth member
    // `EXEMPT_BUT_AUTHENTICATED` in box-token-census.test.ts already derives. A
    // breakdown beside the list it describes is the one place a reader checks
    // the list against, so it being wrong is worse than it being absent.
    expect([...EXEMPT.keys()].sort()).toEqual([
      'GET /*',
      'GET /api/auth/status',
      'GET /api/claims',
      'GET /api/ledger',
      'GET /api/lifecycle',
      'GET /api/mail',
      'GET /api/mail/:id',
      'GET /api/peers',
      'GET /api/runs',
      'GET /api/runs/:id/items',
      'GET /health',
      'POST /api/auth/login',
      'POST /api/auth/passkey/assert/finish',
      'POST /api/auth/passkey/assert/start',
      'POST /api/claims',
      'POST /api/claims/:id/release',
      'POST /api/ledger/deviations',
      'POST /api/mail',
      'POST /api/mail/:id/ack',
      'POST /api/notify',
      'POST /api/runs',
      'POST /api/runs/:id/advance',
      'POST /api/runs/:id/close',
      'POST /api/runs/:id/dispatch',
      'POST /api/runs/:id/items',
    ]);
    // `/api/auth/logout` is the auth route that is NOT here — logging out is
    // something only a logged-in caller can do.
    expect(EXEMPT.has('POST /api/auth/logout')).toBe(false);
    // AND THE TASK 8 SPLIT, asserted as its own clause rather than left implicit
    // in the list above: ENROLLING A KEY IS GATED. An exempt register route
    // would let anyone on the tailnet register their own authenticator and log
    // in with it forever — it is the decision that makes `attestation: 'none'`
    // safe (`webauthn.ts`), and it is one line away from being reversed by
    // someone tidying the table into a `/api/auth/passkey/*` wildcard.
    expect(EXEMPT.has('POST /api/auth/passkey/register/start')).toBe(false);
    expect(EXEMPT.has('POST /api/auth/passkey/register/finish')).toBe(false);
  });

  it('the eighteen box-token lanes in EXEMPT are those coord routes, and nineteen with notify', () => {
    // ORDER-PINNED TITLE. `box-token-census.test.ts` reads the number words in the
    // line above IN SEQUENCE — lanes first, total second — so rewording the title
    // the other way round is a red suite until that expectation moves with it
    // (D-1233). The comment you are reading is NOT scanned; only the title line is.
    //
    // The claim "they are already guarded" is checked against the source, not
    // trusted: an exemption whose stated justification is a gate the route does
    // not actually have is the worst kind of hole.
    const coord = readFileSync(path.join(srcRoot, 'coord/routes.ts'), 'utf8');
    const server = readFileSync(path.join(srcRoot, 'server.ts'), 'utf8');
    const handlers = [...coord.matchAll(/app\.(get|post)\('([^']+)'/g)]
      .map((m) => ({ k: `${m[1]!.toUpperCase()} ${m[2]!}`, at: m.index! }));
    const gated = handlers.filter(({ at }, i) => {
      const end = handlers[i + 1]?.at ?? coord.length;
      const body = coord.slice(at, end);
      return /requireMailToken\(req/.test(body) || /checkMailToken\(/.test(body);
    }).map((h) => h.k);
    // EIGHTEEN since `GET /api/runs/:id/items` joined the
    // exempt-but-authenticated class — the coordinator reads its own wave
    // ledger cookieless from the fleet host, and must, because settling keys
    // on ids only this route publishes.
    // SEVENTEEN before that, since build 9b's claims and ledger routes: GET /api/claims
    // joined the exempt-but-authenticated class beside runs/lifecycle/peers;
    // POST /api/claims + POST /api/claims/:id/release joined the plain
    // box-token lanes (POST /api/claims/:id/break is deliberately NOT here —
    // it is UNGATED, the abandon-door shape, and not EXEMPT either); and the
    // allocator pair, POST /api/ledger/deviations + GET /api/ledger, are
    // plain box-token lanes too (requireMailToken — the fleet host is the
    // caller, with no cookie jar). The scan reads the SOURCE rather than
    // trusting the table, which is the whole point — an exemption whose
    // stated justification is a gate the route does not actually have is the
    // worst kind of hole.
    expect(gated.sort()).toEqual([
      'GET /api/claims', 'GET /api/ledger', 'GET /api/lifecycle', 'GET /api/mail',
      'GET /api/mail/:id', 'GET /api/peers', 'GET /api/runs', 'GET /api/runs/:id/items',
      'POST /api/claims', 'POST /api/claims/:id/release', 'POST /api/ledger/deviations',
      'POST /api/mail', 'POST /api/mail/:id/ack',
      'POST /api/runs', 'POST /api/runs/:id/advance', 'POST /api/runs/:id/close',
      'POST /api/runs/:id/dispatch', 'POST /api/runs/:id/items',
    ]);
    for (const k of gated) expect(EXEMPT.has(k), `${k} is box-token gated but not EXEMPT`).toBe(true);
    // …and `/api/notify`, the nineteenth lane, which lives in server.ts (D-1242:
    // this comment used to call it the eighteenth, double-counting the coord
    // routes' own eighteen).
    expect(server).toContain('checkMailToken(deps.mailToken');
    expect(EXEMPT.has('POST /api/notify')).toBe(true);
  });
});

// ── the sweep: CCRC_AUTH=on, no cookie ───────────────────────────────────

describe('with the gate ARMED and no cookie', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const gated = ROUTES.filter((r) => !isWs(r) && !EXEMPT.has(key(r)));

  it('sweeps EXACTLY the routes that are neither websockets nor exempt', () => {
    // Guards the `it.each` below the same way the scanner meta-test guards the
    // scan: an EXEMPT table that had swallowed everything would leave nothing to
    // assert and report green. Exact rather than a floor, for the same reason —
    // 71 scanned − 3 websockets − 24 exempt-and-scanned (25 EXEMPT entries less
    // `GET /*`, which no `app.get('…')` registers) = 44; the gated non-exempt
    // routes this file reasons about by name are `POST /api/claims/:id/break`,
    // which meets the session gate on an armed box exactly as abandon and pause
    // do, — program-leverage wave 4 — `POST /api/sessions/:id/kickoff`, and —
    // program-leverage wave 5 — `POST /api/runs/:id/reclaim`, the fourth
    // ungated operator door and DELIBERATELY not EXEMPT: with `CCRC_AUTH` armed
    // it must sit behind the session gate exactly as abandon, pause and break
    // do (`auth/gate.ts`'s NOT-EXEMPT note: gating them there "strengthens
    // D-282 rather than reversing it").
    //
    // The kickoff route is DELIBERATELY not EXEMPT: it is a cookie-bearing PWA
    // write, the browser has one, and nothing on a fleet host posts it
    // cookieless. Being gated is the whole posture, not a cost.
    //
    // UNCHANGED at its then-value by `GET /api/runs/:id/items`, and that was the
    // arithmetic working rather than a coincidence: that route is EXEMPT, so it
    // raised the scanned count and the exempt count by one each and left the
    // difference alone. A new route that is NOT exempt moves this number, which
    // is exactly what the kickoff route just did.
    // 44 since the caps pair: both are NOT exempt (an operator dial is not a
    // machine lane), so both raise the scanned count without raising the exempt
    // count — the arithmetic this comment's own paragraph above describes.
    // DERIVED (F7), the same move as the HTTP half above. The relation on the
    // line below already WAS this arithmetic; collapsing the literal into it
    // means the count cannot disagree with the sets it is a count of.
    //
    // The `- 1` it used to carry was an ASSUMPTION — that exactly one EXEMPT key
    // is not a scanned registration — so it is replaced by the set itself, which
    // is strictly stronger: it names WHICH key, and a second unscanned entry
    // (a typo'd path, a route that moved out of these two files) reds here with
    // that key in the message instead of silently keeping the count right.
    const unscanned = [...EXEMPT.keys()].filter((k) => !ROUTES.map(key).includes(k));
    expect(unscanned,
      'an EXEMPT entry names no scanned registration — a typo here is an exemption for nothing, ' +
      'and an exemption for nothing is how a real route later inherits one')
      .toEqual(['GET /*']);
    expect(gated.length, 'the gated sweep went vacuous').toBeGreaterThan(30);
    expect(gated.length).toBe(ROUTES.length - ROUTES.filter(isWs).length - (EXEMPT.size - unscanned.length));
  });

  it.each(gated.map((r) => [key(r), r] as const))(
    '%s answers 401 no-session', async (_k, r) => {
      const w = await openApp(); app = w.app;
      const res = await app.inject({ method: r.method as 'GET', url: concrete(r.routePath) });
      expect(gateRefused(res), `${key(r)} answered ${res.statusCode} ${res.body.slice(0, 120)}`).toBe(true);
      expect(verdictOf(res)).toBe('no-session');
    });

  it.each(WS_ROUTES)('the %s upgrade is refused before any socket exists', async (route) => {
    const w = await openApp(); app = w.app;
    // `injectWS` resolves only on a `101`; a non-101 rejects with the status in
    // the message. That IS the assertion — a 401 here means the hook answered
    // before @fastify/websocket ever handed the connection to `ws`, which for
    // `/ws/pty/:id` is also the difference between refusing and spawning a pty.
    await expect(app.injectWS(concrete(route))).rejects.toThrow('Unexpected server response: 401');
  });

  it.each([...EXEMPT.keys()].filter((k) => k !== 'GET /*'))(
    '%s is NOT refused by the gate', async (k) => {
      const w = await openApp(); app = w.app;
      const method = k.slice(0, k.indexOf(' '));
      const url = concrete(k.slice(k.indexOf(' ') + 1));
      // D-149's lane refuses an anonymous caller ITSELF, with a verdict-carrying
      // body that `gateRefused` cannot distinguish from the gate's. So it is
      // probed with the credential it actually takes — and THAT is the proof the
      // gate let it through: a gated route ignores the box token entirely, so if
      // this route left `EXEMPT` the header below would make no difference.
      const headers = EXEMPT_BUT_AUTHENTICATED.has(k) ? tokenHeader : undefined;
      const res = await app.inject({ method: method as 'GET', url, ...(headers ? { headers } : {}) });
      // Not "answers 200": `/api/mail` still answers its OWN 401 for a caller
      // with no box token, and `/api/runs` a 501 with no coordination database.
      // The property is that THE GATE let it through.
      expect(gateRefused(res), `${k} was refused by the session gate`).toBe(false);
    });

  it.each([...EXEMPT_BUT_AUTHENTICATED])(
    '%s is exempt from the GATE and refused by its own HANDLER', async (k) => {
      // Both halves, because either one alone is the bug. Exempt-and-open would
      // publish the run list to the tailnet; gated-and-closed would wedge the
      // coordinator out of its own program (D-149).
      const w = await openApp(); app = w.app;
      const method = k.slice(0, k.indexOf(' '));
      const url = concrete(k.slice(k.indexOf(' ') + 1));
      const anon = await app.inject({ method: method as 'GET', url });
      expect(anon.statusCode, `${k} answered an anonymous caller`).toBe(401);
      const withToken = await app.inject({ method: method as 'GET', url, headers: tokenHeader });
      expect(withToken.statusCode, `${k} refused a valid box token`).not.toBe(401);
      const withCookie = await app.inject({
        method: method as 'GET', url, headers: { cookie: await login(app) },
      });
      expect(withCookie.statusCode, `${k} refused a live session`).not.toBe(401);
    });

  it('the SPA shell loads with no cookie — the login screen must be able to render', async () => {
    const w = await openApp(); app = w.app;
    if (!HAS_PWA) {
      // Fail SHUT is still the right answer with no bundle to serve: there is no
      // login screen on this box, so there is nothing to let through.
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(gateRefused(res)).toBe(true);
      return;
    }
    for (const url of ['/', '/index.html', '/sessions/deep/link']) {
      const res = await app.inject({ method: 'GET', url });
      expect(gateRefused(res), `${url} was refused — the login screen cannot load`).toBe(false);
      expect(res.statusCode, url).toBe(200);
    }
  });
});

// ── the two shapes a hole would take ─────────────────────────────────────

describe('the exempt check is set membership on the MATCHED ROUTE, not the raw url', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('a param route reaches its exemption through the router pattern', async () => {
    const w = await openApp(); app = w.app;
    // The url `/api/mail/7` is in no table anywhere. It is exempt because the
    // ROUTER matched `/api/mail/:id`, which is. A raw-url comparison would 401
    // this — and with it every box-token machine lane that carries a param,
    // i.e. the whole coordinator surface.
    for (const url of ['/api/mail/7', '/api/mail/7?x=1']) {
      const res = await app.inject({ method: 'GET', url });
      expect(gateRefused(res), `${url} was gate-refused`).toBe(false);
    }
    const ack = await app.inject({ method: 'POST', url: '/api/mail/7/ack' });
    expect(gateRefused(ack)).toBe(false);
  });

  it('a crafted url cannot borrow an exemption it did not match', async () => {
    const w = await openApp(); app = w.app;
    // `/api/runs/1/dispatch` is exempt; `/api/runs/1` is not a route at all and
    // `GET /api/feed` is a wholly different entry. Neither may ride the other's.
    //
    // `GET /api/runs` USED TO BE THE FOIL HERE and no longer can be: D-149 put
    // it in the table (exempt-but-authenticated), so the GATE lets it through
    // and its own handler refuses. `gateRefused` would still answer `true` —
    // that helper matches a verdict-carrying 401, which this route now sends
    // deliberately — so leaving it here would have kept the test GREEN while it
    // measured something else entirely. `/api/feed` is a real gated sibling on
    // the same router.
    expect(gateRefused(await app.inject({ method: 'POST', url: '/api/runs/1/dispatch' }))).toBe(false);
    expect(gateRefused(await app.inject({ method: 'GET', url: '/api/feed' }))).toBe(true);
  });

  it('EXEMPT is keyed by METHOD as well as path — POST /api/runs is a machine lane, GET is not', async () => {
    const w = await openApp(); app = w.app;
    // One path, two meanings. A path-only table publishes every open program to
    // anything on the tailnet.
    expect(gateRefused(await app.inject({ method: 'POST', url: '/api/runs' }))).toBe(false);
    const read = await app.inject({ method: 'GET', url: '/api/runs' });
    expect(gateRefused(read)).toBe(true);
    expect(verdictOf(read)).toBe('no-session');
  });
});

// ── the flag: dark by default ────────────────────────────────────────────

describe('with CCRC_AUTH off — the shipped default', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const httpRoutes = ROUTES.filter((r) => !isWs(r));

  /**
   * Routes whose OWN behaviour depends on the flag, so the dark answer is
   * legitimately different from either armed one. Both are named rather than
   * inferred, and both answer `501 not-configured` on a box with no session gate
   * — there is nothing there to log into or out of.
   */
  const FLAG_AWARE = new Set([
    'POST /api/auth/login', 'POST /api/auth/logout',
    // Task 8's four. Predicted by the note below when it was written, and it
    // landed exactly that way: with no session gate there is nothing to enrol
    // into and nothing to log into, so all four answer `501 not-configured`.
    'POST /api/auth/passkey/register/start', 'POST /api/auth/passkey/register/finish',
    'POST /api/auth/passkey/assert/start', 'POST /api/auth/passkey/assert/finish',
    // The revocation pair, same reasoning: with no session gate there is nothing
    // to enrol into, so there is nothing to list or revoke either.
    'GET /api/auth/passkeys', 'DELETE /api/auth/passkey/:id',
  ]);

  it('FLAG_AWARE is exactly those eight — joining it is how a route leaves the sweep', () => {
    // Review F2. The set is self-checking in ONE direction (a member is held to an
    // exact 501 dark) and nothing pinned its size, so a future route — Task 8's
    // passkey endpoints plausibly 501 when the gate is dark — could join it and
    // quietly stop being compared against its authenticated answer. Membership is
    // the only way out of the strongest assertion in this file, so it is spelled
    // out here and a reviewer has to look at the diff.
    //
    // DECLARED, NOT DERIVED, deliberately — the alternative ("everything that
    // 501s dark") would swallow `GET /api/push/key`, `POST /api/push/subscribe`,
    // `GET /api/runs`, `GET /api/feed` and every other route that answers
    // `not-configured` for its own unrelated reason, dropping all of them from the
    // authenticated comparison. That is precisely the failure this test exists to
    // prevent, arrived at by automation.
    expect([...FLAG_AWARE].sort()).toEqual([
      'DELETE /api/auth/passkey/:id',
      'GET /api/auth/passkeys',
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'POST /api/auth/passkey/assert/finish',
      'POST /api/auth/passkey/assert/start',
      'POST /api/auth/passkey/register/finish',
      'POST /api/auth/passkey/register/start',
    ]);
    // …and both really are exempt-or-gated as the loop below assumes: login is
    // EXEMPT (the door), logout is GATED (only a logged-in caller can log out).
    expect(EXEMPT.has('POST /api/auth/login')).toBe(true);
    expect(EXEMPT.has('POST /api/auth/logout')).toBe(false);
  });

  it('the gate changes the status of EXACTLY the gated routes, and of nothing else', async () => {
    // THE PROPERTY, in one loop over all 68 HTTP routes, with THREE probes each:
    // dark, armed-anonymous, and armed-with-a-live-session. Comparing dark
    // against AUTHENTICATED is what makes this a real status assertion for the
    // gated routes too (review R1) — the earlier version asserted only
    // `!gateRefused` on the dark side, which a 503, a 500 or a 404 satisfies just
    // as well, so it proved the gate had not refused without proving the route
    // was reachable at all. A logged-in caller must see EXACTLY what a box with
    // the gate dark sees; that is the whole promise of "the gate is the only
    // thing this slice changes", and it needs no expected-status table to rot.
    const dark = await openApp({ enabled: false, secret: false });
    const armed = await openApp();
    try {
      const cookie = await login(armed.app);
      const drift: string[] = [];
      for (const r of httpRoutes) {
        const k = key(r);
        // Defensively per route (review R1): a throw in here — a non-JSON armed
        // body reaching `verdictOf`, a handler that 500s in a new way — used to
        // abort the whole loop and leave every later route SILENTLY unmeasured,
        // which is the one failure mode a sweep must not have.
        try {
          const url = concrete(r.routePath);
          const dk = await dark.app.inject({ method: r.method as 'GET', url });
          const anon = await armed.app.inject({ method: r.method as 'GET', url });
          // NOT sent to a flag-aware route, and `POST /api/auth/logout` is why:
          // probing it with the live cookie REVOKES the session, and every route
          // after it in the loop then reads as 401. (Found by this very sweep on
          // its first run — 35 routes drifted at once, which is what a shared
          // credential quietly consumed mid-loop looks like.)
          const auth = FLAG_AWARE.has(k)
            ? null
            : await armed.app.inject({ method: r.method as 'GET', url, headers: { cookie } });

          // 1. The flag OFF is a passthrough for every route, gated or not.
          if (gateRefused(dk)) drift.push(`${k}: DARK, and the gate refused it anyway`);

          // 2. Armed and anonymous: exempt routes answer for themselves, gated
          //    routes answer exactly `401 no-session`.
          //
          //    …and D-149's category is neither. An EXEMPT-BUT-AUTHENTICATED
          //    route is let through by the hook and then refuses an anonymous
          //    caller itself, so its dark and armed-anonymous answers are
          //    legitimately DIFFERENT — which is the plain exempt branch's whole
          //    assertion. It is held to the STRONGER pair instead: refuse
          //    anonymously (like a gated route) and match dark when
          //    authenticated (clause 3 below, which it is not excused from).
          //    NOT folded into `FLAG_AWARE`: that set's own docstring warns
          //    against exactly this — it would excuse the route from the
          //    dark-vs-authenticated comparison, and `GET /api/runs` answering
          //    `501` dark here is an artefact of no coord database in the
          //    fixture, not a fact about the flag.
          if (EXEMPT_BUT_AUTHENTICATED.has(k)) {
            if (anon.statusCode !== 401) {
              drift.push(`${k}: exempt-but-authenticated, yet armed-anonymous → ${anon.statusCode}`);
            }
          } else if (EXEMPT.has(k)) {
            if (!FLAG_AWARE.has(k) && dk.statusCode !== anon.statusCode) {
              drift.push(`${k}: EXEMPT but dark ${dk.statusCode} ≠ armed-anonymous ${anon.statusCode}`);
            }
          } else if (anon.statusCode !== 401 || verdictOf(anon) !== 'no-session') {
            drift.push(`${k}: gated but armed-anonymous → ${anon.statusCode} ${anon.body.slice(0, 80)}`);
          }

          // 3. Armed WITH a live session: identical to dark, for every route that
          //    is not itself flag-aware — the assertion that covers all 68, not the 24 exempt.
          //    (Both counts are derived and checked against this very sentence at the
          //    bottom of this file. They read fifty-five and fifteen for several builds
          //    after the tree had grown past both — D-1223.)
          if (auth === null) {
            if (dk.statusCode !== 501) drift.push(`${k}: dark → ${dk.statusCode}, want 501 not-configured`);
          } else if (dk.statusCode !== auth.statusCode) {
            drift.push(`${k}: dark ${dk.statusCode} ≠ authenticated ${auth.statusCode}`);
          }
        } catch (err) {
          drift.push(`${k}: threw while probing — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      expect(drift).toEqual([]);
    } finally { await dark.app.close(); await armed.app.close(); }
  });

  it.each(WS_ROUTES)('the %s socket still upgrades with the gate dark', async (route) => {
    // All three sockets, not just `/ws/fleet` (review R2). The flag-off claim is
    // about 3 websockets and every HTTP route alike, and one socket did not
    // establish it. Safe to open here for the same reason the armed sweep is
    // safe to run: `spawnPty` is stubbed, so `/ws/pty` attaches nothing, and its
    // close path's `tmux resize-window` goes through the whitelist-guarded
    // runner like every other exec in this suite.
    const w = await openApp({ enabled: false, secret: false }); app = w.app;
    const ws = await app.injectWS(concrete(route));
    expect(ws.readyState).toBe(ws.OPEN);
    ws.close();
  });

  it('touches no disk: a box with the flag off and no secret file boots and serves', async () => {
    const w = await openApp({ enabled: false, secret: false }); app = w.app;
    const res = await app.inject({ method: 'GET', url: '/api/accounts' });
    expect(res.statusCode).toBe(200);
  });
});

// ── a live session passes ────────────────────────────────────────────────

describe('a live session cookie passes the gate', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('login → cookie → the gated route answers its own status, not the gate\'s', async () => {
    const w = await openApp(); app = w.app;
    const cookie = await login(app);
    const res = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const ws = await app.injectWS('/ws/fleet', { headers: { cookie } });
    expect(ws.readyState).toBe(ws.OPEN);
    ws.close();
  });

  it('a cookie for a DIFFERENT token does not, and is told it was signed OUT (D-127)', async () => {
    const w = await openApp({ cookieSecure: true }); app = w.app;
    await login(app);
    const forged = serializeCookie(SESSION_COOKIE, 'a'.repeat(43), { secure: false, maxAgeSeconds: 60 });
    const res = await app.inject({
      method: 'GET', url: '/api/accounts', headers: { cookie: forged.slice(0, forged.indexOf(';')) },
    });
    expect(gateRefused(res)).toBe(true);
    // `'expired'`, NOT the `'no-session'` the store answered. A cookie was
    // PRESENTED, so "you were signed out" is the true sentence and a cold "sign
    // in to reach this box" is not — the gate has both facts and must not narrow
    // them to the store's one (D-127).
    expect(verdictOf(res)).toBe('expired');
    // …and THIS is why it matters rather than being a nicety: the expire-cookie
    // guard fires only on `'expired'`, so under the conflation it missed the case
    // it was written for — an idle-lapsed row, swept away, whose browser then
    // presented a dead cookie for the rest of its 30-day Max-Age with no in-app
    // way to shed it (logout is gated, the cookie is HttpOnly).
    const set = res.headers['set-cookie'];
    const line = Array.isArray(set) ? String(set[0]) : String(set);
    expect(line).toContain(`${SESSION_COOKIE}=;`);
    expect(line).toContain('Max-Age=0');
    expect(line).toContain('Secure');
  });

  it('…while NO cookie stays `no-session` — the two arms are the point', async () => {
    // The other half of D-127, and the assertion that keeps the fix from being a
    // blanket rename: a caller who sent nothing has nothing to be signed out of.
    const w = await openApp(); app = w.app;
    const res = await app.inject({ method: 'GET', url: '/api/accounts' });
    expect(verdictOf(res)).toBe('no-session');
    expect(res.headers['set-cookie']).toBeUndefined();
    // An EMPTY cookie value is the no-cookie arm too — handled one line earlier
    // than the store call, so it never reaches the D-127 mapping.
    const empty = await app.inject({
      method: 'GET', url: '/api/accounts', headers: { cookie: `${SESSION_COOKIE}=` },
    });
    expect(verdictOf(empty)).toBe('no-session');
    expect(empty.headers['set-cookie']).toBeUndefined();
  });

  it('a session minted under a superseded generation is expired, not accepted', async () => {
    // The `ccrc passwd` invalidation, end to end: log in at generation 1, then
    // rewrite the secret file at generation 2 while the server runs. No restart.
    const w = await openApp({ generation: 1 }); app = w.app;
    const cookie = await login(app);
    expect((await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } })).statusCode).toBe(200);
    writeFileSync(path.join(w.home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(PASSPHRASE, FAST_PARAMS, 2)}\n`, { mode: 0o600 });
    const after = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
    expect(gateRefused(after)).toBe(true);
    expect(verdictOf(after)).toBe('expired');
  });

  it('the store is loaded ONCE at boot — a session written before boot verifies', async () => {
    // Proves `await store.load()` ran in `buildServer`: this record was never
    // created through the login route, it was on disk before the server existed.
    // (An unloaded store answers `'no-session'` safely but never `'ok'`.)
    const home = mkTmp('ccrc-auth-gate-boot-');
    const base = testDeps(home);
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`);
    // Minted through the store's own API, then a fresh server reads that file.
    const seeder = new SessionStore(path.join(home, '.ccrc', 'sessions.json'));
    await seeder.load();
    const { token } = await seeder.create('fixture', 1, Date.now());
    app = await buildServer({
      ...base, cfg: { ...base.cfg, authEnabled: true, cookieSecure: false }, spawnPty: stubPty,
    });
    const res = await app.inject({
      method: 'GET', url: '/api/accounts', headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.statusCode, res.body).toBe(200);
  });
});

// ── fail SHUT ────────────────────────────────────────────────────────────

describe('fail SHUT — the D-39 inversion', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('ARMED with NO passphrase file refuses every gated route — it does not pass through', async () => {
    // `coord/token.ts`'s D-39 folded `'unconfigured'` into `'ok'` and ran
    // /api/mail unauthenticated. The same mistake here, inverted, would run the
    // WHOLE server unauthenticated on a box whose operator armed the flag and
    // has not run `ccrc passwd` yet — the single most likely misconfiguration
    // this slice will ever meet.
    const w = await openApp({ secret: false }); app = w.app;
    for (const url of ['/api/accounts', '/api/fleet', '/api/runs', '/api/feed']) {
      const res = await app.inject({ method: 'GET', url });
      expect(gateRefused(res), `${url} was let through with no passphrase configured`).toBe(true);
      expect(verdictOf(res), url).toBe('unconfigured');
    }
    await expect(app.injectWS('/ws/fleet')).rejects.toThrow('Unexpected server response: 401');
    // `/api/auth/status` is EXEMPT, so it still answers — and it must answer
    // ANONYMOUSLY. Reading `authed` off the gate's `allow` (which is `true` here,
    // for `reason: 'exempt'`) would tell a cold browser it was signed in, on the
    // one box state where nobody can be.
    const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ authed: false });
  });

  it('a GARBLED passphrase file refuses to boot, rather than starting on a secret it cannot trust', async () => {
    await expect(openApp({ secretText: 'scrypt$N=notanumber$aaaa$bbbb$gen=1\n' }))
      .rejects.toThrow(/not a plain decimal integer|auth\.scrypt/);
  });

  it('a secret broken WHILE the server runs answers 401, never a 500', async () => {
    const w = await openApp(); app = w.app;
    const cookie = await login(app);
    writeFileSync(path.join(w.home, '.ccrc', 'auth.scrypt'), 'not a secret line at all\n');
    const res = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
    // The polarity that matters: an uncaught throw inside `onRequest` is a 500,
    // which is an error page on a path whose only correct answer is a refusal.
    expect(res.statusCode).toBe(401);
    expect(verdictOf(res)).toBe('unconfigured');
  });
});

// ── the two refusal shapes ───────────────────────────────────────────────

describe('the refusal', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  /**
   * A bare app with `installGate` on it and `request.ws` FORCED — the only way to
   * measure the upgrade branch's BODY.
   *
   * `injectWS` can report the status of a rejected upgrade and nothing else (it
   * rejects with `Unexpected server response: 401`), so the armed sweep above
   * proves the refusal happened and cannot see what was in it. Fastify runs root
   * `onRequest` hooks in registration order, so a hook added here BEFORE
   * `installGate` sets the same flag `@fastify/websocket`'s own hook would have
   * set — which is the one input that branch reads — and then an ordinary
   * `inject` can read the body back.
   */
  const gateWithWs = async (ws: boolean): Promise<FastifyInstance> => {
    const probe = Fastify({ logger: false });
    await probe.register(fastifyWebsocket);          // decorates `request.ws`
    probe.addHook('onRequest', async (req) => { req.ws = ws; });
    const home = mkTmp('ccrc-auth-wsbody-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const secretPath = path.join(home, '.ccrc', 'auth.scrypt');
    writeFileSync(secretPath, `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`);
    installGate(probe, {
      enabled: true, secretPath, cookieSecure: false,
      // Task 8's `/ws/*` Origin check reads this. These probes send NO `Origin`
      // header, which is the `'absent'` verdict — allowed, because a browser
      // always sends one on a real upgrade and its absence means no browser is
      // calling (`wsOriginVerdict`). So the refusals below are still the SESSION
      // gate's, unchanged, which is what this describe measures.
      origin: 'http://localhost:7788',
      store: new SessionStore(path.join(home, '.ccrc', 'sessions.json')),
    });
    probe.get('/api/probe', async () => ({ ok: true }));
    await probe.ready();
    return probe;
  };

  it('an ordinary refusal carries the JSON envelope the PWA reads', async () => {
    app = await gateWithWs(false);
    const res = await app.inject({ method: 'GET', url: '/api/probe' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ ok: false, error: 'unauthenticated', verdict: 'no-session' });
  });

  it('a refused UPGRADE carries NO body — the status line is the whole message', async () => {
    // The client of an upgrade is parsing an HTTP response it expected to be
    // `101`; a JSON body on a socket that is about to close is noise it never
    // reads. Without this the branch was asserted only by the fact that
    // `injectWS` rejects, which it would do just as happily with a body.
    app = await gateWithWs(true);
    const res = await app.inject({ method: 'GET', url: '/api/probe' });
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe('');
  });

  it('an EXPIRED session is swept out of the jar on the way past', async () => {
    // `POST /api/auth/logout` is gated and the cookie is HttpOnly, so a browser
    // holding a dead token has no other way to shed it — it would keep presenting
    // it for the rest of its 30-day Max-Age.
    const w = await openApp({ generation: 1, cookieSecure: true }); app = w.app;
    const cookie = await login(app);
    writeFileSync(path.join(w.home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(PASSPHRASE, FAST_PARAMS, 2)}\n`, { mode: 0o600 });
    const res = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
    expect(verdictOf(res)).toBe('expired');
    const set = res.headers['set-cookie'];
    const line = Array.isArray(set) ? String(set[0]) : String(set);
    expect(line).toContain(`${SESSION_COOKIE}=;`);
    expect(line).toContain('Max-Age=0');
    // The attributes must MATCH the login line's or the browser will not replace
    // the cookie — including `Secure`, which is why this app sets it.
    expect(line).toContain('Secure');
    expect(line).toContain('Path=/');
  });

  it('a `no-session` refusal does NOT clear anything — there is nothing to clear', async () => {
    const w = await openApp(); app = w.app;
    const res = await app.inject({ method: 'GET', url: '/api/accounts' });
    expect(verdictOf(res)).toBe('no-session');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

// ── the pure decision ────────────────────────────────────────────────────

describe('authVerdict — the decision, with no server around it', () => {
  const req = (method: string, url: string | undefined, cookie?: string): GateRequest =>
    ({ method, routeOptions: { url }, headers: cookie === undefined ? {} : { cookie } });
  const store = new SessionStore(path.join(mkTmp('ccrc-auth-verdict-'), 'sessions.json'));
  const secretOk = { kind: 'ok' as const, secret: { n: 2, r: 8, p: 1, saltB64: '', hashB64: '', generation: 3 } };

  it('the flag off allows everything, before anything else is read', () => {
    expect(authVerdict(req('GET', '/api/accounts'), { enabled: false, secret: SECRET_UNREAD, store }, 0))
      .toEqual({ allow: true, verdict: 'ok', reason: 'flag-off', device: null });
  });

  it('an unmeasured secret with the flag ON denies — nobody looked is not permission', () => {
    // The belt-and-braces arm: it is unreachable through `installGate`, and it
    // exists so that a future caller who forgets to measure is refused rather
    // than admitted.
    const d = authVerdict(req('GET', '/api/accounts'), { enabled: true, secret: SECRET_UNREAD, store }, 0);
    expect(d).toEqual({ allow: false, verdict: 'unconfigured', reason: 'refused', device: null });
  });

  it('an absent and an unusable secret both deny, and stay distinct facts', () => {
    for (const secret of [{ kind: 'absent' as const }, { kind: 'unusable' as const, detail: 'EACCES' }]) {
      expect(authVerdict(req('GET', '/api/accounts'), { enabled: true, secret, store }, 0).allow).toBe(false);
    }
    // …and "distinct" is MEASURED, not asserted in the name (review fold-in: the
    // old version of this test claimed a distinction it never looked at).
    // `measureSecret` is what draws it, off the real filesystem: ENOENT is
    // `'absent'`, a present-but-garbled file is `'unusable'` and carries a detail
    // string. Collapsing them is the `secret.ts` polarity error one layer down —
    // a chmod reading as "no passphrase was ever set".
    const dir = mkTmp('ccrc-auth-distinct-');
    const missing = measureSecret(path.join(dir, 'nope.scrypt'));
    writeFileSync(path.join(dir, 'broken.scrypt'), 'not a secret line\n');
    const broken = measureSecret(path.join(dir, 'broken.scrypt'));
    expect(missing.kind).toBe('absent');
    expect(broken.kind).toBe('unusable');
    expect(missing.kind).not.toBe(broken.kind);
    expect(broken.kind === 'unusable' && broken.detail.length > 0).toBe(true);
  });

  it('a request the router matched to nothing is gated, not exempted', () => {
    // `routeOptions.url` is `undefined` exactly when `request.is404` is true.
    expect(exemptKey('GET', undefined)).toBeNull();
    expect(authVerdict(req('GET', undefined), { enabled: true, secret: secretOk, store }, 0).allow).toBe(false);
  });

  it('HEAD rides its route\'s GET exemption, and nothing else\'s', () => {
    expect(exemptKey('HEAD', '/health')).toBe('GET /health');
    expect(authVerdict(req('HEAD', '/health'), { enabled: true, secret: secretOk, store }, 0).allow).toBe(true);
    // …but a HEAD on a gated route is still gated. NOT `/api/runs` any more —
    // D-149 made that one exempt-but-authenticated, so it would pass the GATE
    // (and be refused by its own handler), which is a different property from
    // the one this line measures.
    expect(authVerdict(req('HEAD', '/api/accounts'), { enabled: true, secret: secretOk, store }, 0).allow)
      .toBe(false);
  });

  it('an empty or absent cookie is `no-session`, never a pass', () => {
    // Every one of these is the NO-COOKIE arm — `other=1` carries no session
    // cookie at all and `ccrc_session=` carries an empty value, which is caught
    // one line above the store call and so never reaches D-127's mapping.
    for (const cookie of [undefined, '', 'other=1', `${SESSION_COOKIE}=`]) {
      expect(authVerdict(req('GET', '/api/accounts', cookie), { enabled: true, secret: secretOk, store }, 0))
        .toEqual({ allow: false, verdict: 'no-session', reason: 'refused', device: null });
    }
  });

  it('D-127 is a REFUSAL-side mapping only — it can never turn a deny into an allow', () => {
    // The property the whole change rests on, asserted rather than argued: the
    // mapping rewrites `verdict` on a branch whose `allow` is a hard-coded
    // `false`, and `allow: true` is returned one line EARLIER, from a separate
    // `verdict === 'ok'` test that the mapping never sees.
    const deps = { enabled: true, secret: secretOk, store };
    for (const token of ['a'.repeat(43), 'not-base64!!', 'x', 'ccrc_session', '%%%']) {
      const d = authVerdict(req('GET', '/api/accounts', `${SESSION_COOKIE}=${token}`), deps, 0);
      expect(d.allow, token).toBe(false);
      expect(d.reason, token).toBe('refused');
      expect(d.verdict, token).toBe('expired');
    }
    // A malformed cookie header — `parseCookies` never throws, so garbage lands
    // in the presented-but-unmatched path and is called "signed out". Imprecise,
    // and far cheaper than the alternative.
    const junk = authVerdict(req('GET', '/api/accounts', `${SESSION_COOKIE}=%E0%A4%A`), deps, 0);
    expect(junk).toEqual({ allow: false, verdict: 'expired', reason: 'refused', device: null });
  });

  it('names WHY it allowed — three different facts, never one boolean', () => {
    // `allow: true` has three causes and only ONE of them is "this caller proved
    // who they are". Collapsing them is the "no overloaded null at a seam" rule
    // (CLAUDE.md) broken in the crown-jewel file, and it is load-bearing rather
    // than tidy: `GET /api/auth/status` is EXEMPT and publishes `authed`, so a
    // handler reading that field off `allow` would tell every anonymous browser
    // it was signed in.
    const off = authVerdict(req('GET', '/api/accounts'), { enabled: false, secret: SECRET_UNREAD, store }, 0);
    const exempt = authVerdict(req('GET', '/health'), { enabled: true, secret: secretOk, store }, 0);
    expect(off.reason).toBe('flag-off');
    expect(exempt.reason).toBe('exempt');
    // Both are `allow: true` — which is exactly why the reason has to be there.
    expect([off.allow, exempt.allow]).toEqual([true, true]);
  });

  it('sessionVerdict asks the CREDENTIAL question, skipping both shortcuts', async () => {
    // `/health` is exempt, so `authVerdict` never looks at the cookie. The status
    // route needs the answer anyway, and this is the function that gives it.
    const dir = mkTmp('ccrc-auth-sessionverdict-');
    const live = new SessionStore(path.join(dir, 'sessions.json'));
    await live.load();
    const { token } = await live.create('probe', 3, 1_000);
    const deps = { enabled: true, secret: secretOk, store: live };

    // Exempt route, no cookie: the gate lets it through as `'exempt'`, and the
    // credential question answers `'no-session'` for the very same request.
    expect(authVerdict(req('GET', '/health'), deps, 1_000).reason).toBe('exempt');
    expect(sessionVerdict(req('GET', '/health'), deps, 1_000))
      .toEqual({ allow: false, verdict: 'no-session', reason: 'refused', device: null });

    // Exempt route, LIVE cookie: `'session'`, which is the only value that means
    // a credential verified.
    const withCookie = req('GET', '/health', `${SESSION_COOKIE}=${token}`);
    expect(sessionVerdict(withCookie, deps, 1_000)).toEqual({ allow: true, verdict: 'ok', reason: 'session', device: 'probe' });

    // And it never invents the two shortcuts it exists to skip.
    expect(sessionVerdict(req('GET', '/health'), { ...deps, enabled: false }, 1_000).reason)
      .not.toBe('flag-off');
  });
});

// ── wave 6: the device the gate measured ─────────────────────────────────

describe('GateDecision.device — attribution, never a decision input', () => {
  const req = (method: string, url: string | undefined, cookie?: string): GateRequest =>
    ({ method, routeOptions: { url }, headers: cookie === undefined ? {} : { cookie } });
  const secretOk = { kind: 'ok' as const, secret: { n: 2, r: 8, p: 1, saltB64: '', hashB64: '', generation: 3 } };

  const liveStore = async (): Promise<SessionStore> => {
    const s = new SessionStore(path.join(mkTmp('ccrc-auth-device-'), 'sessions.json'));
    await s.load();
    return s;
  };

  it('carries the session row`s own label on the one arm that verified a credential', async () => {
    const store = await liveStore();
    const { token } = await store.create('Mozilla/5.0 (iPhone)', 3, 1_000);
    const deps = { enabled: true, secret: secretOk, store };
    expect(sessionVerdict(req('GET', '/api/accounts', `${SESSION_COOKIE}=${token}`), deps, 1_000))
      .toEqual({ allow: true, verdict: 'ok', reason: 'session', device: 'Mozilla/5.0 (iPhone)' });
  });

  it('is null on every arm that did NOT verify a credential', async () => {
    // SEVEN construction sites, and each one must SAY it measured nothing
    // rather than omit the field: an optional `device?` would let a site forget
    // it, and a reader cannot tell a forgotten field from a measured absence —
    // which is exactly what a genuinely deviceless allow already means.
    const store = await liveStore();
    const deps = { enabled: true, secret: secretOk, store };
    expect(authVerdict(req('GET', '/api/accounts'), { ...deps, enabled: false }, 1_000))
      .toEqual({ allow: true, verdict: 'ok', reason: 'flag-off', device: null });
    expect(authVerdict(req('GET', '/health'), deps, 1_000))
      .toEqual({ allow: true, verdict: 'ok', reason: 'exempt', device: null });
    expect(sessionVerdict(req('GET', '/api/accounts'), { ...deps, secret: SECRET_UNREAD }, 1_000))
      .toEqual({ allow: false, verdict: 'unconfigured', reason: 'refused', device: null });
    expect(sessionVerdict(req('GET', '/api/accounts'), deps, 1_000))
      .toEqual({ allow: false, verdict: 'no-session', reason: 'refused', device: null });
    expect(sessionVerdict(req('GET', '/api/accounts', `${SESSION_COOKIE}=junk`), deps, 1_000))
      .toEqual({ allow: false, verdict: 'expired', reason: 'refused', device: null });
    expect(NO_SESSION)
      .toEqual({ allow: false, verdict: 'no-session', reason: 'refused', device: null });
  });

  it('never becomes a decision input — allow and reason are unchanged by the label', async () => {
    const store = await liveStore();
    const deps = { enabled: true, secret: secretOk, store };
    const a = await store.create('iPhone', 3, 1_000);
    const b = await store.create('', 3, 1_000);
    const da = sessionVerdict(req('GET', '/api/accounts', `${SESSION_COOKIE}=${a.token}`), deps, 1_000);
    const db = sessionVerdict(req('GET', '/api/accounts', `${SESSION_COOKIE}=${b.token}`), deps, 1_000);
    expect([da.allow, da.reason]).toEqual([db.allow, db.reason]);
    expect(da.device).not.toBe(db.device);
  });

  it('verifyMeasured is the primitive and verify derives — one loop, not two lookups', async () => {
    const store = await liveStore();
    const { token } = await store.create('iPhone', 3, 1_000);
    expect(store.verifyMeasured(token, 3, 1_000)).toEqual({ verdict: 'ok', label: 'iPhone' });
    expect(store.verify(token, 3, 1_000)).toBe('ok');
    // No row matched ⇒ nothing was measured. `null`, never `''`: an empty label
    // is a row that WAS measured and reported nothing — a fact `SessionStore.create`
    // accepts as-is (this test calls it directly with `''`). The login route never
    // produces one in practice — `server.ts`'s `deviceLabel` substitutes
    // `'unknown device'` for a missing/blank user-agent — but the store layer still
    // keeps the two facts distinct rather than leaning on that route's behavior.
    expect(store.verifyMeasured('nope', 3, 1_000)).toEqual({ verdict: 'no-session', label: null });
    expect(store.verifyMeasured(token, 4, 1_000)).toEqual({ verdict: 'expired', label: null });
  });
});

// ── fix round 1, item 1: attribution as a MECHANISM, not a 2-sample check ──
//
// The prior three tests prove "these 7 sites, these 2 labels" — a review
// planted a mutant that denies when the device label contains `'Android'`
// and it left `tsc` clean and the entire suite byte-identical. A sample-based
// test can only be as good as its samples; this is a STRUCTURAL proof instead,
// modelled on `auth-routes.test.ts`'s login-route slice and its
// `trustProxy is settled` scan: read the actual SOURCE, slice out the
// function that decides, strip its comments (this file's prose says
// "device"/"label" constantly — only CODE may count), delete every
// occurrence of the one SAFE write (`device: measured.label` / `label:
// rec.label`, and their `null` twins), and assert nothing with that name is
// left. Any future branch, comparison, or `.includes()` keyed on the label —
// on ANY string, not just the two this file happens to sample — leaves a
// stray `device`/`label` token behind and reds. Verified by replanting the
// reviewer's own mutant (task-53-report.md records the measurement).
describe('device/label never appear in a decision branch — a structural scan, not a sample', () => {
  const gateSrc = readFileSync(path.resolve(__dirname, '../src/auth/gate.ts'), 'utf8');
  const sessionsSrc = readFileSync(path.resolve(__dirname, '../src/auth/sessions.ts'), 'utf8');
  const serverSrc = readFileSync(path.join(srcRoot, 'server.ts'), 'utf8');

  // Comments in this file talk ABOUT device/label constantly; only code counts.
  const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('authVerdict never mentions device outside its own two `device: null` literals', () => {
    const at = gateSrc.indexOf('export function authVerdict(');
    expect(at, 'authVerdict not found').toBeGreaterThan(0);
    const end = gateSrc.indexOf('\n\n/**', at);
    expect(end, 'end of authVerdict not found').toBeGreaterThan(at);
    const body = stripComments(gateSrc.slice(at, end));
    // Guard the guard: a slice gone empty (a rename, a moved function) would
    // satisfy every assertion below by having nothing in it.
    expect(body.length, 'the slice must not be empty').toBeGreaterThan(100);
    const stripped = body.replace(/device:\s*null/g, '');
    expect(stripped, 'authVerdict must not reference device outside its own literal')
      .not.toMatch(/\bdevice\b/);
  });

  it('sessionVerdict never branches on device or the measured label — every mention is the one safe write', () => {
    const at = gateSrc.indexOf("if (deps.secret.kind !== 'ok')");
    expect(at, 'sessionVerdict body not found').toBeGreaterThan(0);
    const end = gateSrc.indexOf('\n\n/**', at);
    expect(end, 'end of sessionVerdict not found').toBeGreaterThan(at);
    const body = stripComments(gateSrc.slice(at, end));
    expect(body.length, 'the slice must not be empty').toBeGreaterThan(200);
    const stripped = body.replace(/device:\s*(null|measured\.label)/g, '');
    expect(stripped, 'sessionVerdict must not branch on device').not.toMatch(/\bdevice\b/);
    // This is the assertion the D1/D2 mutants actually trip: `if
    // (measured.label.includes('Android'))` or `if (measured.label === '')`
    // both leave a `label` token here that the one safe pattern above did not
    // consume, regardless of which string the branch was keyed on.
    expect(stripped, 'sessionVerdict must not branch on the measured label').not.toMatch(/\blabel\b/);
  });

  it('verifyMeasured never lets the label decide the verdict — same proof, one layer down', () => {
    const at = sessionsSrc.indexOf("const presented = Buffer.from(sha256hex(token), 'hex');");
    expect(at, 'verifyMeasured body not found').toBeGreaterThan(0);
    const end = sessionsSrc.indexOf('\n\n  /**', at);
    expect(end, 'end of verifyMeasured not found').toBeGreaterThan(at);
    const body = stripComments(sessionsSrc.slice(at, end));
    expect(body.length, 'the slice must not be empty').toBeGreaterThan(100);
    const stripped = body.replace(/label:\s*(null|rec\.label)/g, '');
    expect(stripped, 'verifyMeasured must not branch on label').not.toMatch(/\blabel\b/);
  });

  // ── fix round 2 (final whole-branch review, F5a): the three scans above
  // slice only `authVerdict`/`sessionVerdict`/`verifyMeasured` — the
  // functions that CONSTRUCT a `GateDecision`. A decision keyed on
  // `GateDecision.device` written anywhere ELSE — the `installGate` hook
  // that RECEIVES the decision, or a route handler reading it back out —
  // was outside every one of those slices and would pass all three
  // unnoticed. This is the boundary the guard exists to close: the reviewer
  // named it as the residual, not a hypothetical.
  it('installGate never mentions device or label anywhere in its body — it only ever RECEIVES a decision, never constructs one', () => {
    const at = gateSrc.indexOf('export function installGate(');
    expect(at, 'installGate not found').toBeGreaterThan(0);
    // installGate is the LAST function in gate.ts (verified by the file-level
    // guard below), so there is no `\n\n/**` sentinel to slice against —
    // the rest of the file IS the function body plus its closing brace.
    const body = stripComments(gateSrc.slice(at));
    expect(body.length, 'the slice must not be empty').toBeGreaterThan(200);
    // Unlike the three functions above, installGate has NO safe write to
    // strip out first: it never builds a `GateDecision`, only reads one
    // (`decision.allow`, `decision.verdict`) — so `device`/`label` must not
    // appear here under ANY spelling at all.
    expect(body, 'installGate must not reference device').not.toMatch(/\bdevice\b/);
    expect(body, 'installGate must not reference label').not.toMatch(/\blabel\b/);
  });

  it('installGate really is the last function in gate.ts — the guard above is not slicing past a boundary that moved', () => {
    // Guards the guard above: if a function were added AFTER installGate,
    // `gateSrc.slice(at)` would silently start covering it too (harmless)
    // or, if installGate itself moved earlier, would silently stop covering
    // part of its own body (not harmless) without either failing loudly.
    // This assertion makes "installGate is last" a checked fact, not an
    // assumption the slice above quietly depends on.
    const at = gateSrc.indexOf('export function installGate(');
    const nextFn = gateSrc.indexOf('\nexport function ', at + 1);
    expect(nextFn, 'a function was added after installGate — update the scan above to bound its slice')
      .toBe(-1);
  });

  it('pwaDec (server.ts) — the one ROUTE-LEVEL site reading .device — never branches on it, only hands it to deviceActor', () => {
    // The other place `GateDecision.device` reaches outside gate.ts/sessions.ts
    // at all: `pwaDec` reads `sessionAuth(req).device` to build the dec a
    // human-driven route declares. A future mutant here (e.g. denying a
    // route, or choosing a different `surface`, when the device label
    // matches some string) would be exactly the same defect class the
    // reviewer's `installGate` mutant demonstrated, one file over.
    const at = serverSrc.indexOf('const pwaDec = (');
    expect(at, 'pwaDec not found').toBeGreaterThan(0);
    const end = serverSrc.indexOf('\n\n  /**', at);
    expect(end, 'end of pwaDec not found').toBeGreaterThan(at);
    const body = stripComments(serverSrc.slice(at, end));
    expect(body.length, 'the slice must not be empty').toBeGreaterThan(50);
    // The one safe write: `.device` is passed straight into `deviceActor(…)`
    // and nowhere else — strip that call, then nothing named `device` may
    // remain.
    const stripped = body.replace(/deviceActor\(sessionAuth\(req\)\.device\)/g, '');
    expect(stripped, 'pwaDec must not branch on device').not.toMatch(/\bdevice\b/);
  });
});

/**
 * D-1223 — THE SWEEP'S OWN PROSE, CHECKED AGAINST WHAT THIS FILE DERIVES.
 *
 * Three comments in this file stated "all 55 HTTP routes" and "the 15 exempt
 * ones" long after the tree had grown past both. That is the D-1156 family
 * exactly — a census nothing checks — and the one site of it whose derived
 * value already lives here at runtime, in `ROUTES`. So the pin lives here too
 * rather than in `box-token-census.test.ts`: that file scans prose against a
 * surface it derives BY READING SOURCE, and this count is derived by scanning
 * the route table, which the census would have to duplicate to check. Same
 * design, one more site — `box-token-census.test.ts`'s "HOW TO ADD A SITE" note
 * points here.
 *
 * DIGITS, not the census's number words: these claims are written as numerals,
 * so the two scanners read different alphabets on purpose. The claim lines are
 * kept free of any OTHER digit (a `review R2` had to move off one of them) —
 * every numeral on a scanned line is read as one of the counts asserted.
 *
 * EVERY NEEDLE IS SPELLED SPLIT (`'a ' + 'b'`), the idiom `deviation-refs.test.ts`
 * already uses for the same reason: the corpus being scanned is THIS file, so an
 * unsplit needle matches its own call site and the "exactly one line" guard fires
 * on a file that is perfectly correct. Measured — all three did, first run.
 */
describe('the gate sweep states the route counts it derives', () => {
  const SELF = readFileSync(path.join(here, 'auth-gate.test.ts'), 'utf8');
  const GATE_SRC = readFileSync(path.join(here, '..', 'src', 'auth', 'gate.ts'), 'utf8');
  const httpCount = ROUTES.filter((r) => !isWs(r)).length;
  const exemptHttp = ROUTES.filter((r) => !isWs(r) && EXEMPT.has(key(r))).length;

  /** One line, named by a needle, failing LOUDLY on none or many — an anchor
   *  that stopped matching yields `''`, and `''` has no digits, which would
   *  satisfy every assertion below it vacuously. */
  const claim = (needle: string): string => {
    const hit = SELF.split('\n').filter((l) => l.includes(needle));
    expect(hit.length, `expected exactly one line containing ${needle}`).toBe(1);
    return hit[0]!;
  };
  const digitsIn = (t: string): number[] => [...t.matchAll(/\d+/g)].map((m) => Number(m[0]));

  it('the derived counts are real numbers, not an empty scan', () => {
    expect(httpCount).toBeGreaterThan(50);
    expect(exemptHttp).toBeGreaterThan(5);
    expect(exemptHttp).toBeLessThan(httpCount);
  });

  it('the property loop names the HTTP-route count', () => {
    expect(digitsIn(claim('in one loop ' + 'over all')),
      'the sweep claims to cover a number of routes this file does not derive')
      .toEqual([httpCount]);
  });

  it('the third probe names the whole and the exempt part', () => {
    expect(digitsIn(claim('the assertion ' + 'that covers all')),
      'the third probe states a whole or an exempt count this file does not derive')
      .toEqual([httpCount, exemptHttp]);
  });

  // F7 (D-1302). gate.ts's own module docstring said "all 55 routes" while the
  // tree derived 68 — the SAME defect D-1223's docstring names, at the one copy
  // D-1223 did not reach. It survived because `box-token-census.test.ts` reads
  // number WORDS and this is a numeral, while the scan above reads `SELF`, which
  // is this test file and not gate.ts. One more corpus, same alphabet.
  it("gate.ts's own docstring names the HTTP-route count it stands in front of", () => {
    const hit = GATE_SRC.split('\n').filter((l) => l.includes('stands in front of all'));
    expect(hit.length, 'expected exactly one line in gate.ts claiming a route count').toBe(1);
    expect(digitsIn(hit[0]!),
      'gate.ts claims a route count this tree does not derive').toEqual([httpCount]);
  });

  it('the websocket row names the socket count', () => {
    expect(digitsIn(claim('websockets and ' + 'every HTTP route')),
      'the flag-off claim states a socket count this file does not derive')
      .toEqual([WS_ROUTES.length]);
  });
});
