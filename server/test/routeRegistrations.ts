// The route slicer and the box-token census's lane sources (Overlord W1 other lanes, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-other-lanes.md` Task 4, slug `route-slicer-shared`): moved here
// unchanged from `box-token-census.test.ts`, so that census and `overlord-other-lanes-census.test.ts` slice route
// handlers one way and read one list of lane sources. A piece that adds a lane source adds it here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..', '..');
export const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

export const COORD_SRC = read('server/src/coord/routes.ts');
export const SERVER_SRC = read('server/src/server.ts');
/** The THIRD file that registers routes (update-management W2, design 2026-09-20
 *  §12 census step (a)). Without it, "the update routes are absent from every
 *  box-token lane" would be a measured zero over an empty set — this file is
 *  where a box-token call on the update surface would BE, so it is read like
 *  the two above. */
export const UPDATE_SRC = read('server/src/update/routes.ts');
/** The FOURTH file that registers routes (box-token lifecycle, spec 4.6): the
 *  claim door and "Rotate now". Read as a lane source for the update file's
 *  reason — a box-token call there would BE a lane — and so that "neither route
 *  consults the box token" is a measured zero over a file this census reads. */
export const TOKEN_SRC = read('server/src/token/routes.ts');
/** The NINTH file that registers routes and the sixth lane source (programme ledgers PL3): the coordinator's nine item and goals routes. Their
 *  handlers sit in a lane file of their own rather than in `coord/routes.ts` (ARCH-01, `growth-check`: that file does not take
 *  another 400 lines), and `registerCoordRoutes` registers them with its own `requireMailToken` and `requireAttribution`.
 *  Read here as a lane source so that "nine box-token lanes" is a measured count over the file that holds them and not a
 *  claim: a scan of `coord/routes.ts` alone would see none of them. */
export const LEDGER_SRC = read('server/src/coord/ledgersRoutes.ts');
/** The EIGHTH file that registers routes and the fifth lane source (#1444, plan task LK9): the Linear proxy's twelve,
 *  every one a box-token lane. Read like the files above, so its lanes are counted where the prose counts them. */
export const LINEAR_PROXY_SRC = read('server/src/linear/proxyRoutes.ts');
/** The TENTH file that registers routes and the seventh lane source (D-8147): the linking standard's routes. Its one
 *  box-token lane is the session's read, `GET /api/linking`; the operator's write beside it is session-gated and no lane. */
export const LINKING_SRC = read('server/src/linking/routes.ts');
/** The ELEVENTH file that registers routes and the eighth lane source (D-8126, wave A3): the coordinator call record's one route,
 *  `POST /api/coord/programmes/:slug/calls`, a box-token machine lane. Handled like the ledgers' file: registered from
 *  `registerCoordRoutes`, written in a file of its own, so a scan of `coord/routes.ts` alone would not see it. */
export const CALLS_SRC = read('server/src/coord/coordCallsRoute.ts');
/** A further file that registers routes and lane source (Overlord W2 remaining work A): the remaining-work door's one route,
 *  `POST /api/coord/programmes/:slug/remaining`, a box-token machine lane. Handled like the call record's file: registered from
 *  `registerCoordRoutes`, written in a file of its own, so a scan of `coord/routes.ts` alone would not see it. */
export const REMAINING_SRC = read('server/src/coord/programmeRemainingRoute.ts');
/** The TWELFTH file that registers routes and the ninth lane source (D-8181): the plan verbs' seven. `plan show` is a session-or-token
 *  read and the six writes are box-token lanes, every one consulting `checkMailToken` in its own registration. */
export const PLAN_SRC = read('server/src/coord/planRoutes.ts');
/** The THIRTEENTH file that registers routes and the tenth lane source (Overlord W1a, the start report): the continuity routes. Its five
 *  box-token lanes are the hook's start report, `POST /api/sessions/:id/start`, the card door, `GET /api/sessions/:id/card`
 *  (the card piece), the note door's three, `POST` and `GET /api/sessions/:id/notes` and `POST /api/sessions/:id/handover`
 *  (the notes piece), the timer doors' three, `POST` and `GET /api/timers` and `POST /api/timers/:id/cancel` (the timers
 *  piece), and the probe door's two, `GET` and `POST /api/sessions/:id/probe` (the probes piece), each gated in its own
 *  onRequest as the linking read is. Its session-gated doors are `CONTINUITY_SESSION_DOORS`. */
export const CONTINUITY_SRC = read('server/src/continuity/routes.ts');

/** The two mechanisms that count as "this handler consulted the box token" —
 *  the same pair `coord-pause-route.test.ts` and `auth-gate.test.ts` already
 *  use. Both, never one: `POST /api/mail` and its ack route gate INLINE rather
 *  than through the shared helper, and a scanner crediting only the helper
 *  reports them ungated, which is false. Arriving at eleven instead of eighteen
 *  by counting `requireMailToken` alone is exactly how D-1156's own ledger entry
 *  had to add a prose caveat about the mail pair. */
export const GATE_PATTERNS = [/requireMailToken\(req/, /checkMailToken\(/];

/** Every fastify registration VERB this scan credits — not just `get`/`post`.
 *  F14: the two callers below (`lanesIn` and the update-surface `REGISTERED`)
 *  used to match only `get|post`, so a route registered with any other verb —
 *  or through `app.route({...})` — was invisible to both: not counted as a
 *  lane, not counted as a door, and "no route can join or leave without the
 *  literal moving" was false for exactly that shape. Measured (fix round 1,
 *  scratch copy of `update/routes.ts`): a planted `app.delete(...)` and a
 *  planted `app.route({ method: 'PUT', ... })` were both absent from
 *  `REGISTERED` before this fix, so "UPDATE_DOORS is exactly the rest" stayed
 *  GREEN over a door it never saw. */
export const ALL_VERBS = 'get|post|put|patch|delete|head|options|all';

/** `app.route({ method, url, ... })` calls, brace-counted rather than regexed
 *  end to end — the handler nested inside the object routinely contains its
 *  own `{`/`}` pairs, so a naive `[\s\S]*?\}\)` would close on the FIRST inner
 *  brace followed by a `)` and silently mis-read the object's extent. `method`
 *  may be a single-quoted/double-quoted string or an array of them; each
 *  method the call registers is emitted as its own entry sharing the call's
 *  `at`, so a `body.slice(at, next.at)` still spans the whole registration.
 *  Fix round 1, dispatch E (F14, m1): `app\.route\(\s*\{` tolerates whitespace
 *  between the call and its opening brace (`app.route( {`), which the bare
 *  `app\.route\(\{` missed — measured, the residual stayed 20/20 green. */
export const routeCallsIn = (src: string): { key: string; at: number }[] => {
  const out: { key: string; at: number }[] = [];
  const re = /app\.route\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const openBrace = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = openBrace; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) continue;
    const body = src.slice(openBrace + 1, close);
    const methodMatch = /method:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/.exec(body);
    const urlMatch = /url:\s*'([^']+)'|url:\s*"([^"]+)"/.exec(body);
    if (!methodMatch || !urlMatch) continue;
    const url = urlMatch[1] ?? urlMatch[2]!;
    const methods = methodMatch[1]!.startsWith('[')
      ? [...methodMatch[1]!.matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => (x[1] ?? x[2])!.toUpperCase())
      : [methodMatch[1]!.replace(/['"]/g, '').toUpperCase()];
    for (const method of methods) out.push({ key: `${method} ${url}`, at: m.index });
  }
  return out;
};

/** Every registration in one source file — every `app.<verb>('/path', ...)` for
 *  every fastify verb, plus every `app.route({...})` — keyed `VERB /path`, in
 *  source order. The shared extraction `lanesIn` and `REGISTERED` both build on,
 *  so a verb or shape invisible to one is invisible to the other. Fix round 1,
 *  dispatch E (F14, m1): the path capture is QUOTE-AGNOSTIC
 *  (`(['"\x60])([^'"\x60]+)\1`) — a single-quoted-only capture left
 *  `app.put("/x", …)` and `` app.put(`/x`, …) `` both unseen, measured 20/20
 *  green residuals. The backtick in the character class needs the `\x60`
 *  escape (a literal backtick is unremarkable inside `[...]`, but this file's
 *  own source is read back by OTHER regex-vs-template scans, so spelling it
 *  as a raw backtick here would itself be a stray template delimiter to
 *  anyone re-reading this literal). Fix round 2 (R14): `\s*` between the verb
 *  call's `(` and the path's quote, for EVERY verb — `app.route(\s*\{` already
 *  had this tolerance (fix round 1, m1), but the bare-verb branch required the
 *  quote to sit immediately after `(`, so a formatter-wrapped
 *  `app.put(\n  '/api/updates/x', …)` matched nothing: invisible to both
 *  `lanesIn` and `REGISTERED`, exactly F14's original failure mode, for a
 *  shape a Prettier-style reflow produces routinely. */
export const registrationsIn = (src: string): { key: string; at: number }[] => {
  const verbRe = new RegExp(`app\\.(${ALL_VERBS})\\(\\s*(['"\\x60])([^'"\\x60]+)\\2`, 'g');
  const verbHits = [...src.matchAll(verbRe)]
    .map((mm) => ({ key: `${mm[1]!.toUpperCase()} ${mm[3]!}`, at: mm.index! }));
  return [...verbHits, ...routeCallsIn(src)].sort((a, b) => a.at - b.at);
};

/** Every handler in one source file whose body consults the box token, keyed
 *  `VERB /path`. Bodies run from a route's own registration to the next one,
 *  the same slice `auth-gate.test.ts` takes for its handler bodies. */
export const lanesIn = (src: string): string[] => {
  const starts = registrationsIn(src);
  return starts
    .filter(({ at }, i) => {
      const body = src.slice(at, starts[i + 1]?.at ?? src.length);
      return GATE_PATTERNS.some((re) => re.test(body));
    })
    .map((s) => s.key);
};

/** One route's handler: the slice from its registration to the next registration in the same file, the slice `lanesIn`
 *  takes. Throws on a key the file does not register exactly once, so a census over nothing cannot pass. */
export const handlerBody = (src: string, key: string): string => {
  const starts = registrationsIn(src);
  const hits = starts.filter((s) => s.key === key);
  if (hits.length !== 1) throw new Error(`handlerBody: ${key} is registered ${hits.length} times`);
  const i = starts.indexOf(hits[0]!);
  return src.slice(starts[i]!.at, starts[i + 1]?.at ?? src.length);
};

/** A named `new Set([...])` literal in `coord-pause-route.test.ts`, read from the
 *  file that decides it rather than retyped — the same literal
 *  `coordinator-skill.test.ts` already harvests. */
export const harvestSet = (name: string): string[] => {
  const src = read('server/test/coord-pause-route.test.ts');
  const m = new RegExp(`${name} = new Set\\(\\[([^\\]]*)\\]\\)`).exec(src);
  expect(m, `the ${name} literal moved — this scan is over nothing`).not.toBeNull();
  return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
};

/** The four release valves (D-282). */
export const UNGATED_DOORS = harvestSet('UNGATED');

/** The coordination writes that are session-gated ONLY — no box token, and not a
 *  release valve either. Derived for the same reason as the doors above: this
 *  wave's own `POST /api/coord/caps` joined the class, and the census hard-coded
 *  the OTHER member instead of reading the set (D-1231). */
export const SESSION_ONLY_DOORS = harvestSet('SESSION_ONLY');

