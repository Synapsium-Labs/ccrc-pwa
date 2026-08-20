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
  EXEMPT, SECRET_UNREAD, authVerdict, exemptKey, installGate, measureSecret, sessionVerdict,
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
    expect(scanRoutes('server.ts').length).toBe(39);
    expect(scanRoutes('coord/routes.ts').length).toBe(13);
    expect(ROUTES.length).toBe(52);
    // …and the three partitions add up: 3 websockets + 49 HTTP.
    expect(ROUTES.filter(isWs).length + ROUTES.filter((r) => !isWs(r)).length).toBe(ROUTES.length);
    expect(ROUTES.filter((r) => !isWs(r)).length).toBe(49);
  });

  it('found the specific registrations this file reasons about', () => {
    const keys = ROUTES.map(key);
    for (const k of [
      'GET /health', 'POST /api/notify', 'POST /api/mail', 'GET /api/mail/:id',
      'POST /api/runs', 'GET /api/runs', 'GET /api/feed', 'POST /api/coord/pause',
      'POST /api/sessions/:id/prompt', 'GET /ws/fleet', 'GET /ws/pty/:id',
      'POST /api/auth/login', 'POST /api/auth/logout', 'GET /api/auth/status',
    ]) expect(keys, `${k} was not found by the scanner`).toContain(k);
    // Both a GET and a POST on the same path, which is the case a path-only
    // exempt table would get wrong (the POST is a box-token machine lane, the
    // GET is the PWA's read).
    expect(keys.filter((k) => k.endsWith(' /api/runs')).sort()).toEqual(['GET /api/runs', 'POST /api/runs']);
  });

  it('sweeps all three websockets, and finds them registered', () => {
    const keys = ROUTES.map(key);
    for (const w of WS_ROUTES) expect(keys).toContain(`GET ${w}`);
    expect(ROUTES.filter(isWs)).toHaveLength(3);
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
    // 52 scanned + the static wildcard when the bundle is built.
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

  it('exempts exactly the four classes the plan names — nothing has crept in', () => {
    // The whole set, spelled out, so that adding an exemption is a deliberate act
    // that edits this list with a reviewer looking at it. 14 = /health + the 9
    // box-token lanes + /api/notify + login + status + the SPA shell.
    expect([...EXEMPT.keys()].sort()).toEqual([
      'GET /*',
      'GET /api/auth/status',
      'GET /api/mail',
      'GET /api/mail/:id',
      'GET /health',
      'POST /api/auth/login',
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
  });

  it('the nine box-token lanes in EXEMPT are the nine that really check the token', () => {
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
    expect(gated.sort()).toEqual([
      'GET /api/mail', 'GET /api/mail/:id', 'POST /api/mail', 'POST /api/mail/:id/ack',
      'POST /api/runs', 'POST /api/runs/:id/advance', 'POST /api/runs/:id/close',
      'POST /api/runs/:id/dispatch', 'POST /api/runs/:id/items',
    ]);
    for (const k of gated) expect(EXEMPT.has(k), `${k} is box-token gated but not EXEMPT`).toBe(true);
    // …and `/api/notify`, the tenth, which lives in server.ts.
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
    // 52 scanned − 3 websockets − 13 exempt-and-scanned (14 EXEMPT entries less
    // `GET /*`, which no `app.get('…')` registers) = 36.
    expect(gated.length).toBe(36);
    expect(ROUTES.length - ROUTES.filter(isWs).length - gated.length).toBe(EXEMPT.size - 1);
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
      const res = await app.inject({ method: method as 'GET', url });
      // Not "answers 200": `/api/mail` still answers its OWN 401 for a caller
      // with no box token, and `/api/runs` a 501 with no coordination database.
      // The property is that THE GATE let it through.
      expect(gateRefused(res), `${k} was refused by the session gate`).toBe(false);
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
    // `/api/runs` as a GET is a different entry. Neither may ride the other's.
    expect(gateRefused(await app.inject({ method: 'POST', url: '/api/runs/1/dispatch' }))).toBe(false);
    expect(gateRefused(await app.inject({ method: 'GET', url: '/api/runs' }))).toBe(true);
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
  const FLAG_AWARE = new Set(['POST /api/auth/login', 'POST /api/auth/logout']);

  it('FLAG_AWARE is exactly those two — joining it is how a route leaves the sweep', () => {
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
    expect([...FLAG_AWARE].sort()).toEqual(['POST /api/auth/login', 'POST /api/auth/logout']);
    // …and both really are exempt-or-gated as the loop below assumes: login is
    // EXEMPT (the door), logout is GATED (only a logged-in caller can log out).
    expect(EXEMPT.has('POST /api/auth/login')).toBe(true);
    expect(EXEMPT.has('POST /api/auth/logout')).toBe(false);
  });

  it('the gate changes the status of EXACTLY the gated routes, and of nothing else', async () => {
    // THE PROPERTY, in one loop over all 49 HTTP routes, with THREE probes each:
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
          if (EXEMPT.has(k)) {
            if (!FLAG_AWARE.has(k) && dk.statusCode !== anon.statusCode) {
              drift.push(`${k}: EXEMPT but dark ${dk.statusCode} ≠ armed-anonymous ${anon.statusCode}`);
            }
          } else if (anon.statusCode !== 401 || verdictOf(anon) !== 'no-session') {
            drift.push(`${k}: gated but armed-anonymous → ${anon.statusCode} ${anon.body.slice(0, 80)}`);
          }

          // 3. Armed WITH a live session: identical to dark, for every route that
          //    is not itself flag-aware. This is the assertion that covers all 49
          //    rather than the 13 exempt ones.
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
    // All THREE (review R2), not just `/ws/fleet`: "49 routes and 3 websockets
    // are unaffected when the flag is off" is the claim, and one socket did not
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

  it('a cookie for a DIFFERENT token does not, and is told it was signed OUT (D-114)', async () => {
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
    // them to the store's one (D-114).
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
    // The other half of D-114, and the assertion that keeps the fix from being a
    // blanket rename: a caller who sent nothing has nothing to be signed out of.
    const w = await openApp(); app = w.app;
    const res = await app.inject({ method: 'GET', url: '/api/accounts' });
    expect(verdictOf(res)).toBe('no-session');
    expect(res.headers['set-cookie']).toBeUndefined();
    // An EMPTY cookie value is the no-cookie arm too — handled one line earlier
    // than the store call, so it never reaches the D-114 mapping.
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
      .toEqual({ allow: true, verdict: 'ok', reason: 'flag-off' });
  });

  it('an unmeasured secret with the flag ON denies — nobody looked is not permission', () => {
    // The belt-and-braces arm: it is unreachable through `installGate`, and it
    // exists so that a future caller who forgets to measure is refused rather
    // than admitted.
    const d = authVerdict(req('GET', '/api/accounts'), { enabled: true, secret: SECRET_UNREAD, store }, 0);
    expect(d).toEqual({ allow: false, verdict: 'unconfigured', reason: 'refused' });
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
    // …but a HEAD on a gated route is still gated.
    expect(authVerdict(req('HEAD', '/api/runs'), { enabled: true, secret: secretOk, store }, 0).allow).toBe(false);
  });

  it('an empty or absent cookie is `no-session`, never a pass', () => {
    // Every one of these is the NO-COOKIE arm — `other=1` carries no session
    // cookie at all and `ccrc_session=` carries an empty value, which is caught
    // one line above the store call and so never reaches D-114's mapping.
    for (const cookie of [undefined, '', 'other=1', `${SESSION_COOKIE}=`]) {
      expect(authVerdict(req('GET', '/api/accounts', cookie), { enabled: true, secret: secretOk, store }, 0))
        .toEqual({ allow: false, verdict: 'no-session', reason: 'refused' });
    }
  });

  it('D-114 is a REFUSAL-side mapping only — it can never turn a deny into an allow', () => {
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
    expect(junk).toEqual({ allow: false, verdict: 'expired', reason: 'refused' });
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
      .toEqual({ allow: false, verdict: 'no-session', reason: 'refused' });

    // Exempt route, LIVE cookie: `'session'`, which is the only value that means
    // a credential verified.
    const withCookie = req('GET', '/health', `${SESSION_COOKIE}=${token}`);
    expect(sessionVerdict(withCookie, deps, 1_000)).toEqual({ allow: true, verdict: 'ok', reason: 'session' });

    // And it never invents the two shortcuts it exists to skip.
    expect(sessionVerdict(req('GET', '/health'), { ...deps, enabled: false }, 1_000).reason)
      .not.toBe('flag-off');
  });
});
