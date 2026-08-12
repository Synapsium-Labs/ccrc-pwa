// `POST /api/coord/pause` — the operator's door onto `$REG/coordinator-paused`,
// and one of the TWO write routes in `coord/routes.ts` deliberately not behind
// `requireMailToken` (D-B4-9). The other is `POST /api/runs/:id/abandon`, added
// by the same build for the same reason; the `UNGATED` set below is the whole
// list, and the scanner holds it to exactly those two.
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
      fleetState: { connected: true, downSince: null, ccdVerbs: ['start', 'ws-hold'] },
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

// D-B4-9. The gate is a property of the FILE, not of the routes anyone
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
   *  coordinator holds. */
  const UNGATED = new Set(['/api/coord/pause', '/api/runs/:id/abandon']);

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
      if (UNGATED.has(route)) continue;
      const gate = Math.min(
        ...[/requireMailToken\(req/, /checkMailToken\(/].map((re) => {
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
    expect(doc, 'names the deviation that carries the ruling').toContain('D-B4-9');
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
});
