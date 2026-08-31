// `POST /api/coord/pause` — the operator's door onto `$REG/coordinator-paused`,
// and one of the FOUR write routes in `coord/routes.ts` deliberately not behind
// `requireMailToken` (D-282 (was D-B4-9)). The others are `POST /api/runs/:id/abandon` (same
// build, same reason), `POST /api/claims/:id/break` (build 9 D12, the same
// abandon-door shape) and `POST /api/runs/:id/reclaim` (F5, D-1123 — the same
// shape again, for the coordinator itself); the `UNGATED` set below is the whole
// list, and the scanner holds it to exactly those four IN BOTH DIRECTIONS.
//
// The authorization ruling is spec §4.1 and it is the whole reason this file
// asserts an ABSENCE: the box token authenticates the FLEET HOST, the
// coordinator holds it by design, and the pause marker exists precisely so the
// coordinator cannot unpause itself. A pause route gated by that token would
// hand the coordinator its own unpause — the same key on both sides of a
// boundary that only means anything because the two callers differ.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { CCD_ARGV } from '../src/ccdargv.js';
import { isExecAllowed } from '../../agent/src/whitelist.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);

interface RunnerCfg { fail?: ReadonlySet<string> }

const makeRunner = (cfg: RunnerCfg = {}): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (cfg.fail?.has(verb)) return { code: 1, stdout: '', stderr: `ccd: ${verb} refused on the box` };
    return { code: 0, stdout: verb === 'coord-pause' ? 'paused' : '', stderr: '' };
  };
  return { run, calls };
};

/** `withCoord: false` builds a server with NO coordination database — every
 *  other route in this file's module answers 501 there, and this one must not. */
const openApp = async (
  run: Runner, over: Partial<Omit<Deps, 'cfg'>> = {}, withCoord = true,
) => {
  const home = mkTmp('ccrc-coord-pause-');
  const base = testDeps(home, run);
  const coord = withCoord
    ? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')))
    : undefined;
  const app = await buildServer({ ...base, mailToken: TOKEN, ...(coord ? { coord } : {}), ...over });
  return { app, home };
};

const postPause = (app: FastifyInstance, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/coord/pause', headers, payload: body as Record<string, unknown> });

describe('POST /api/coord/pause', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('runs coord-pause --state on for {paused:true}, and off for false', async () => {
    const { run, calls } = makeRunner();
    const w = await openApp(run); app = w.app;

    const on = await postPause(app, { paused: true });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toEqual({ ok: true, requested: true });
    expect(calls).toContainEqual(['coord-pause', '--state', 'on']);

    const off = await postPause(app, { paused: false });
    expect(off.statusCode).toBe(200);
    // `requested`, never `paused`: this route RAN a verb, it did not read the
    // marker. The authoritative answer is the `{type:'coord'}` frame, and the
    // toggle settles on that (spec §4.2).
    expect(off.json()).toEqual({ ok: true, requested: false });
    expect(calls).toContainEqual(['coord-pause', '--state', 'off']);
  });

  it('mints the argv AT THE CALL SITE — never table-looked-up (cross-cutting rule d)', async () => {
    const { run, calls } = makeRunner();
    const w = await openApp(run); app = w.app;
    await postPause(app, { paused: true });
    // Byte-equal to what the ONE mint site builds, derived here rather than
    // typed out: a route that assembled its own literal would drift from the
    // agent's grant with every suite green, which is exactly how ws-add/ws-rm
    // shipped whitelisted-out and dead on the fleet.
    expect(calls.filter((c) => c[0] === 'coord-pause'))
      .toEqual([[...CCD_ARGV.coordPause('on')]]);
    // …and the grant admits it. `whitelist-subset.test.ts` owns the exhaustive
    // enumeration; this is the one-line proof for the argv this route emits.
    expect(isExecAllowed('ccd', [...CCD_ARGV.coordPause('on')])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.coordPause('off')])).toBe(true);
  });

  it('answers 501 unsupported when the fleet ccd does not advertise the verb', async () => {
    const { run, calls } = makeRunner();
    const w = await openApp(run, {
      fleetState: { connected: true, downSince: null, ccdVerbs: ['start', 'ws-hold'], rosterFp: null, build: null },
    }); app = w.app;
    const res = await postPause(app, { paused: true });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ ok: false, error: 'unsupported' });
    // A 501 is a REFUSAL, not a no-op with a status: the verb never ran.
    expect(calls.filter((c) => c[0] === 'coord-pause')).toEqual([]);
  });

  it("answers 502 with ccd's stderr when the verb fails on the box", async () => {
    const { run } = makeRunner({ fail: new Set(['coord-pause']) });
    const w = await openApp(run); app = w.app;
    const res = await postPause(app, { paused: true });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, stderr: 'ccd: coord-pause refused on the box' });
  });

  it('answers 400 on a body that is not {paused:boolean}', async () => {
    const { run, calls } = makeRunner();
    const w = await openApp(run); app = w.app;
    for (const body of [{}, { paused: 'on' }, { paused: 1 }, { paused: null }]) {
      const res = await postPause(app, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    }
    expect(calls.filter((c) => c[0] === 'coord-pause')).toEqual([]);
  });

  it('answers WITHOUT the box token — deliberately (spec §4.1)', async () => {
    const { run } = makeRunner();
    const w = await openApp(run); app = w.app;
    // No `x-ccrc-mail-token` header at all. Every other write route in this
    // module answers 401 here; this one must answer 200, and the reason is
    // written at the call site rather than left to be inferred.
    const res = await postPause(app, { paused: true });
    expect(res.statusCode).toBe(200);
    // …and a WRONG token is not a refusal either — the route does not consult
    // the header at all, so presenting garbage changes nothing.
    const wrong = await postPause(app, { paused: false }, { 'x-ccrc-mail-token': 'a'.repeat(64) });
    expect(wrong.statusCode).toBe(200);
  });

  it('answers even with NO coordination database: a pause is a fleet-host file, not a run', async () => {
    const { run, calls } = makeRunner();
    const w = await openApp(run, {}, false); app = w.app;
    const res = await postPause(app, { paused: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, requested: true });
    expect(calls).toContainEqual(['coord-pause', '--state', 'on']);
  });
});

// D-282. The gate is a property of the FILE, not of the routes anyone
// remembers to check: `MAIL_REJECT_CODES`-excludes-`undeliverable` is the same
// idiom — an exclusion written down by name, rather than a scanner quietly
// narrowed until it passes.
describe('the token gate is total, with the operator routes excluded BY NAME', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../src/coord/routes.ts'), 'utf8');

  /** Routes that ride the PWA's unauthenticated surface on purpose (spec §4.1).
   *  Adding a name here is a deliberate act with an argument attached; every
   *  other write route must carry the gate.
   *
   *  `/api/coord/pause`: the box token is the coordinator's own key, and the
   *  pause marker exists so the coordinator cannot unpause itself.
   *  `/api/runs/:id/abandon`: the same door, for the same reason — a run wedged
   *  because its coordinator is stuck cannot be released by a key that
   *  coordinator holds.
   *  `/api/claims/:id/break`: the sessions that hold claims hold the box token;
   *  a wedge's release valve must not be behind the wedger's own key — build 9
   *  D12.
   *  `/api/runs/:id/reclaim`: the same door one turn further on — the release
   *  valve for a program whose COORDINATOR is the corpse. The box token is that
   *  coordinator's own key, so gating the act of replacing it would be the
   *  D-282 shape exactly (F5, D-1123). */
  const UNGATED = new Set([
    '/api/coord/pause', '/api/runs/:id/abandon', '/api/claims/:id/break',
    '/api/runs/:id/reclaim',
  ]);

  /** Write routes that carry NO box token and are NOT release valves — the
   *  distinction `UNGATED` alone cannot express, and which stayed invisible for
   *  as long as the D-282 doors were the only ungated POSTs in this file
   *  (D-1159).
   *
   *  `UNGATED` is an argument about a WEDGE: the locked-out party holds the box
   *  token, so the valve must not sit behind it. A name in the set below makes
   *  no such claim. These are ordinary same-origin PWA writes that no machine
   *  lane calls, so the fleet's shared secret is simply the wrong key for them
   *  — and nothing may rely on one of them to open a wedge.
   *
   *  Kept DISJOINT from `UNGATED` below, in both directions, so a door cannot
   *  quietly acquire the release-valve argument by being listed twice. Keeping
   *  the sets apart also leaves `UNGATED.size` alone, which matters beyond
   *  tidiness: five prose sites are checked against it, and folding an ordinary
   *  write in here would have moved a cardinal in all five to record something
   *  that is not a D-282 door.
   *
   *  `/api/coord/caps`: the operator's dial on `maxConcurrentWorkers` and
   *  `maxSessionsPerDay`, which before it had no door at all and changed only by
   *  hand-editing sqlite. Raising a cap releases no wedge.
   *
   *  A BLIND SPOT, recorded beside the set rather than papered over by widening
   *  the scanner (coordinator ruling, wave 6 item 2). `POST /api/sessions/:id/
   *  kickoff` is the natural second member — a coordination WRITE that is
   *  session-gated only — and it is ABSENT here because this file scans
   *  `coord/routes.ts` alone and that route is registered in `server.ts`. Its
   *  absence is therefore not a judgement that it belongs elsewhere; it is the
   *  scanner's reach, and the difference matters: dodging a pin by placement is
   *  not being ungated, it is being unmeasured. Whoever widens the scan to
   *  `server.ts` should add it here in the same change. */
  const SESSION_ONLY = new Set(['/api/coord/caps']);

  /** The two mechanisms that count as "the token was checked" — the shared
   *  helper AND the two inline `checkMailToken` sites. Hoisted because BOTH
   *  directions below read it now: a narrowed copy in one test and not the
   *  other would let a route be gated for one assertion and ungated for the
   *  other, which is the drift this file exists to prevent. */
  const GATE_PATTERNS = [/requireMailToken\(req/, /checkMailToken\(/];

  /** Each `app.post` handler's own text, from its route line to the next
   *  handler in the file. */
  const handlers = (): { route: string; body: string }[] => {
    const starts = [...SRC.matchAll(/app\.(?:post|get)\('([^']+)'/g)]
      .map((m) => ({ route: m[1]!, at: m.index!, post: m[0].startsWith('app.post') }));
    return starts.filter((s) => s.post).map((s) => {
      const next = starts.find((o) => o.at > s.at);
      return { route: s.route, body: SRC.slice(s.at, next ? next.at : SRC.length) };
    });
  };

  it('every app.post handler in coord/routes.ts checks the box token, except the named ones', () => {
    // TWO mechanisms answer here, and the property is "the token was checked",
    // not "one particular helper was called": the four run routes and
    // `GET /api/mail*` call `requireMailToken`, while `/api/mail` and
    // `/api/mail/:id/ack` inline `checkMailToken` — deliberately, and their own
    // docstrings say why (they record every refusal through `refuse()`). A
    // scanner that credited only the shared helper would report those two as
    // ungated, which is false, and the fix for a false report is a narrowed
    // scanner — exactly the failure this file exists to prevent.
    const missing: string[] = [];
    for (const { route, body } of handlers()) {
      // TWO exemptions, not one, and they are different arguments — see
      // `SESSION_ONLY`'s own docstring (D-1159). Both are checked back the other
      // way below, so neither list can document an exemption the code does not
      // actually take.
      if (UNGATED.has(route) || SESSION_ONLY.has(route)) continue;
      const gate = Math.min(
        ...GATE_PATTERNS.map((re) => {
          const m = re.exec(body);
          return m ? m.index : Number.POSITIVE_INFINITY;
        }),
      );
      // BEFORE the first `await`, not merely somewhere in the body: a gate
      // downstream of a fleet act has already let the act happen.
      const firstAwait = body.indexOf('await ');
      if (gate === Number.POSITIVE_INFINITY || (firstAwait >= 0 && gate > firstAwait)) missing.push(route);
    }
    expect(missing, 'write routes with no box-token gate ahead of their first await').toEqual([]);
  });

  it('SESSION_ONLY and UNGATED are disjoint — a door gets one argument, not both', () => {
    expect([...SESSION_ONLY].filter((r) => UNGATED.has(r)),
      'a route claims both the release-valve argument and the ordinary-write one').toEqual([]);
    // …and neither set is empty, or every assertion over them is vacuous.
    expect(SESSION_ONLY.size, 'SESSION_ONLY emptied — the scans over it prove nothing')
      .toBeGreaterThan(0);
    expect(UNGATED.size, 'UNGATED emptied — the scans over it prove nothing').toBeGreaterThan(0);
  });

  it('every SESSION_ONLY route really IS ungated, and really EXISTS', () => {
    // The mirror of the UNGATED direction below, for the same reason: a name in
    // a set that skips a check is a one-way promise until something checks the
    // other way. Both halves — the route exists, and it takes no box token.
    const listed = handlers().filter((h) => SESSION_ONLY.has(h.route));
    expect(listed.map((h) => h.route).sort(), 'a SESSION_ONLY name matches no app.post in this file')
      .toEqual([...SESSION_ONLY].sort());
    const gated = listed.filter((h) => GATE_PATTERNS.some((re) => re.test(h.body))).map((h) => h.route);
    expect(gated, 'a SESSION_ONLY route checks the box token after all').toEqual([]);
  });

  it('no SESSION_ONLY route is EXEMPT — armed, it sits behind the session gate', () => {
    // This is what "session-gated when armed" MEANS. Without it the phrase is
    // prose: a route could be added to the EXEMPT table and still pass every
    // other assertion in this file.
    for (const route of SESSION_ONLY) {
      for (const verb of ['GET', 'POST']) {
        expect(GATE_SRC.includes(`'${verb} ${route}'`),
          `${verb} ${route} is in auth/gate.ts's EXEMPT table; a PWA-surface write must not be`)
          .toBe(false);
      }
    }
  });

  it('every UNGATED route really IS ungated — the direction this set could not fail in', () => {
    // THE MISSING HALF, and the reason a name in `UNGATED` was until now a
    // one-way promise. The test above SKIPS the listed routes; the docstring test
    // below only reads prose. Between them, a route added to this set whose
    // handler ALSO checked the box token passed both, and the set would be
    // documenting an exemption the code does not take — the mirror image of
    // `auth-gate.test.ts:400-402`'s "an exemption whose stated justification is a
    // gate the route does not actually have", which that file calls the worst
    // kind of hole. Measured red by adding the gate to the reclaim handler.
    const seen: string[] = [];
    const gated: string[] = [];
    for (const { route, body } of handlers()) {
      if (!UNGATED.has(route)) continue;
      seen.push(route);
      if (GATE_PATTERNS.some((re) => re.test(body))) gated.push(route);
    }
    // Guard the guard, and it is not decoration: `handlers()` keys on the exact
    // registration text, so a route renamed in `coord/routes.ts` and not here
    // drops silently out of the loop and leaves this green over an empty set.
    // Every listed name must have been FOUND.
    expect(seen.sort(), 'a name in UNGATED that no app.post registers').toEqual([...UNGATED].sort());
    expect(gated, 'listed as UNGATED, and yet the handler checks the box token').toEqual([]);
  });

  it('finds the routes it claims to scan — a scanner that matches nothing proves nothing', () => {
    const routes = [...SRC.matchAll(/app\.post\('([^']+)'/g)].map((m) => m[1]!);
    expect(routes).toContain('/api/coord/pause');
    expect(routes.length).toBeGreaterThan(4);
  });

  /**
   * A route's OWN docstring: everything between the end of the previous
   * handler and this route's registration.
   *
   * ANCHORED TO THE TEXT, NOT TO A BYTE COUNT — review finding F-A, and the
   * second instance this wave of "a pin that cannot fail". The first version
   * sliced 2000 characters backwards from the route, and measured on the
   * shipped tree that window reached 437 characters PAST the docstring into
   * the previous route's body: `requireMailToken` came free from
   * `POST /api/runs/:id/items`'s own gate and `/coordinator/i` from the
   * advance route's `causedBy` literal, so deleting this docstring entirely
   * left both assertions green. A window sized in bytes is a window whose
   * contents depend on how long the neighbours are.
   *
   * `\n  });\n` is the close of a route handler at this file's one-level
   * indentation, which is what makes the slice this route's own text and
   * nothing else's.
   */
  const HANDLER_END = '\n  });\n';
  const docstringFor = (route: string): string => {
    const at = SRC.indexOf(`app.post('${route}'`);
    expect(at, `${route} is not registered`).toBeGreaterThan(0);
    const prevEnd = SRC.lastIndexOf(HANDLER_END, at);
    expect(prevEnd, `no preceding handler close before ${route}`).toBeGreaterThan(0);
    return SRC.slice(prevEnd + HANDLER_END.length, at);
  };

  it.each([...UNGATED])('%s names its reason at the call site, not in a plan nobody reads', (route) => {
    // The argument is load-bearing documentation: a later edit that "fixes"
    // the missing gate must have to delete a written argument, not merely add
    // a line. Verified by running the mutant — deleting either docstring turns
    // this red.
    const doc = docstringFor(route);
    // Guard the guard: an empty or one-line slice must not be able to pass the
    // content checks by having nothing in it to contradict them.
    expect(doc.length, `${route} carries no docstring`).toBeGreaterThan(600);
    expect(doc, 'says what it is NOT behind').toContain('requireMailToken');
    expect(doc, 'says it is ungated, in the word the reader greps for').toContain('UNGATED');
    expect(doc, 'names the deviation that carries the ruling').toContain('D-282');
    expect(doc, "names the caller the box token would have handed the other side of")
      .toMatch(/coordinator/i);
  });

  /** The docstring as PROSE: comment markers stripped and whitespace
   *  collapsed, so a phrase that happens to wrap across two comment lines
   *  still matches. Without this a sentence is findable or not depending on
   *  where the 80th column fell. */
  const prose = (doc: string): string =>
    doc.split('\n').map((l) => l.replace(/^\s*(\/\*\*|\*\/|\*|\/\/)?\s?/, '')).join(' ')
      .replace(/\s+/g, ' ');

  it('the pause docstring carries the honesty clause spec §4.1 demands', () => {
    // Not decoration: the ruling is explicitly "convention with a speed bump,
    // named as exactly that". A version of this route whose comment claimed
    // enforcement it does not have would be worse than no comment.
    const doc = prose(docstringFor('/api/coord/pause'));
    expect(doc).toMatch(/Honesty clause/i);
    expect(doc).toMatch(/single-uid box any session can `rm` this marker directly/i);
    expect(doc).toMatch(/convention with a speed bump/i);
  });

  /** THE COUNT, DERIVED — because the wave that opened the fourth door found
   *  FIVE prose sites still saying THREE and not one of them had a test.
   *  `UNGATED` is the only place the door list is decided, so it is the only
   *  place the count may be spelled; every site below is checked against
   *  `UNGATED.size`, and the enumerating ones against the names themselves.
   *
   *  A CARDINAL is a claim about the tree NOW. An ORDINAL is a PLACE in the
   *  order the doors were opened and stays true for ever. Confusing the two is
   *  exactly what left "the THIRD route in this file that is UNGATED", written
   *  at the end of a list of three, reading as a completeness claim. CAPS is
   *  the convention that makes the difference checkable: a number in capitals
   *  is a claim this scanner reads, a number in lower case is history it
   *  leaves alone. */
  const CARDINAL = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN'];
  const ORDINAL = ['ZEROTH', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH'];
  // ZERO/ONE/FIRST stay out of both patterns: they are this repo's ordinary
  // CAPS emphasis ("Exactly ONE field is read", "the FIRST await"), and
  // scanning for them would fire on passages that state no count at all.
  const CARD_RE = /\b(?:TWO|THREE|FOUR|FIVE|SIX|SEVEN)\b/g;
  const ORD_RE = /\b(?:SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH)\b/g;

  const REPO = path.resolve(__dirname, '..', '..');
  const SELF = readFileSync(path.resolve(__dirname, 'coord-pause-route.test.ts'), 'utf8');
  const GATE_SRC = readFileSync(path.resolve(__dirname, '../src/auth/gate.ts'), 'utf8');
  const CLAUDE_MD = readFileSync(path.resolve(REPO, 'CLAUDE.md'), 'utf8');

  /** A named passage, or a loud failure. An anchor that stopped matching would
   *  otherwise yield the empty string, and the empty string satisfies the
   *  negative half of every assertion below — `docstringFor`'s own lesson
   *  (review finding F-A: a window whose contents depend on how long the
   *  neighbours are) applied to three more slices. */
  const passage = (name: string, text: string, from: string, to: string): string => {
    const a = text.indexOf(from);
    expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
    const b = text.indexOf(to, a + from.length);
    expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
    const out = text.slice(a, b);
    expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(300);
    return out;
  };

  /** The sites that ENUMERATE the doors. Two docstrings in `coord/routes.ts`
   *  are deliberately absent: the break door's and the reclaim door's each
   *  argue about THEMSELVES and name two of the four. They state a place, not
   *  a census, and demanding the full roster there would mint two more copies
   *  of the list this scanner exists to stop copying. */
  const enumerations = (): [string, string][] => [
    ['coord/routes.ts, the pause docstring', docstringFor('/api/coord/pause')],
    ["coord-pause-route.test.ts, this file's own header",
      passage('the file header', SELF, '// `POST /api/coord/pause`', 'import {')],
    ['auth/gate.ts, the NOT-EXEMPT block',
      passage('the NOT-EXEMPT block', GATE_SRC,
        ' *  - `POST /api/coord/pause`', 'export const EXEMPT')],
    ['CLAUDE.md, the box-token bullet',
      passage('the box-token bullet', CLAUDE_MD,
        '- **Box token gates every coordination WRITE**', '\n- **')],
  ];

  it('every prose site that states the door count states the DERIVED one', () => {
    const want = CARDINAL[UNGATED.size];
    expect(want, 'the door count outgrew the word list').toBeDefined();
    const sites: [string, string][] = [
      ...enumerations(),
      ['coord/routes.ts, the break docstring', docstringFor('/api/claims/:id/break')],
    ];
    // A site deleted from this list rather than corrected is the failure this
    // pin exists to prevent; five is the number this wave measured stale.
    expect(sites.length, 'a count site was dropped instead of corrected').toBe(5);
    for (const [name, text] of sites) {
      expect(new Set([...text.matchAll(CARD_RE)].map((m) => m[0])),
        `${name} does not state the count as ${want}`).toEqual(new Set([want]));
      for (const ord of [...text.matchAll(ORD_RE)].map((m) => m[0])) {
        expect(ORDINAL.indexOf(ord),
          `${name} names the ${ord} ungated door and there are ${UNGATED.size}`)
          .toBeLessThanOrEqual(UNGATED.size);
      }
    }
  });

  it('every site that lists the doors lists ALL of them', () => {
    // The half that catches the NEXT door rather than this one: a fifth member
    // joins `UNGATED` and four passages go red until each names it. Nothing
    // here is typed by hand, so there is no second list to forget.
    for (const [name, text] of enumerations()) {
      for (const door of UNGATED) {
        expect(text, `${name} does not name ${door}`).toContain(door);
      }
    }
  });
});
