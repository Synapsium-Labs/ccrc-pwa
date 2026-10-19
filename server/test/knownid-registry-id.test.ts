// Path identity W1a (spec 2026-10-12 §2.3, as built): a request id that is not a registry id never reaches an
// id-taking argv through the session routes. Three doors:
//   - `knownId`, the membership gate of 18 request-id routes, asks the L0 predicate FIRST and spends no listing;
//   - `POST /api/sessions/:id/ensure` and the crossing arm of `POST /api/sessions/:id/swap`, which `knownId` does not
//     gate, ask it at their own heads and answer 400 `bad-session-id`. The crossing arm asks it ahead of its skew gate.
// Every refused id has its row PLANTED (`$REG/--actor.uuid` is an ordinary file in a fixture HOME), so the 404 is the
// predicate's answer and never the listing's.
//
// THE ROUTER IS AN OUTER GATE FOR LENGTH. Fastify's default `maxParamLength` is 100, and `server.ts` builds
// `Fastify({ logger: false })`, so the router answers a request `:id` over 100 characters with 414 before any handler
// runs. The predicate's 255-character clause is therefore unreachable through these routes, and Task 1's L0 table
// pins it. This file pins the router's answer for the over-long ids instead, and its longest control is 100 characters.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { localIO, type FleetIO } from '../src/io.js';
import { POOLS_CAP } from '../src/ccdargv.js';
import type { FleetState } from '../src/fleetstate.js';
import { Tmux, type Runner } from '../src/exec.js';
import { mkTmp } from './tmpHelpers.js';
import { appFor, recorder, seedRow } from './idGateFixture.js';
import { EDGE_ACCEPTED_IDS, REFUSED_IDS } from './registryIdCases.js';

/** Fastify's default `maxParamLength` (find-my-way): the router answers a longer `:id` with 414. */
const ROUTER_PARAM_MAX = 100;
const ROUTABLE_REFUSED = REFUSED_IDS.filter((id) => id.length <= ROUTER_PARAM_MAX);
const OVER_LONG = [...REFUSED_IDS, ...EDGE_ACCEPTED_IDS].filter((id) => id.length > ROUTER_PARAM_MAX);
const CONTROLS = [...EDGE_ACCEPTED_IDS.filter((id) => id.length <= ROUTER_PARAM_MAX), 'x'.repeat(ROUTER_PARAM_MAX)];

const NO_EVIDENCE: FleetState = { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null };
const POOLS_ADVERTISED: FleetState = {
  connected: true, downSince: null, ccdVerbs: ['swap', POOLS_CAP], rosterFp: null, build: null,
};

interface Rig { app: FastifyInstance; calls: string[][]; listings: () => number }

let opened: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of opened) await a.close();
  opened = [];
});

/** A server over a fresh fixture HOME with `plant`'s rows on disk. `listings` counts `readdir`s of the registry. */
const rig = async (
  plant: readonly string[], opts: { fleetState?: FleetState; fail?: ReadonlySet<string>; tmux?: Tmux } = {},
): Promise<Rig> => {
  const home = mkTmp('ccrc-knownid-');
  for (const id of plant) seedRow(home, id);
  const registryDir = path.join(home, '.cc-sessions');
  let n = 0;
  const io: FleetIO = {
    ...localIO,
    readdir: async (p, timeoutMs, signal) => {
      if (p === registryDir) n += 1;
      return localIO.readdir(p, timeoutMs, signal);
    },
  };
  const { run, calls } = recorder(opts.fail === undefined ? {} : { fail: opts.fail });
  const w = await appFor(home, run, {
    io, ...(opts.fleetState === undefined ? {} : { fleetState: opts.fleetState }),
    ...(opts.tmux === undefined ? {} : { tmux: opts.tmux }),
  });
  opened.push(w.app);
  return { app: w.app, calls, listings: () => n };
};

const post = (app: FastifyInstance, id: string, verb: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `/api/sessions/${id}/${verb}`, payload });

describe('knownId refuses a non-registry id before its listing (spec §2.3)', () => {
  it.each(ROUTABLE_REFUSED)(
    'POST /release for %s, with its row planted, answers 404 unknown-session and runs no ccd verb',
    async (id) => {
      const r = await rig([id]);
      const res = await post(r.app, id, 'release');
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
      expect(r.calls).toEqual([]);
      expect(r.listings(), 'the registry listing count: knownId listed for a name it must refuse unread').toBe(0);
    },
  );

  it.each(ROUTABLE_REFUSED)('POST /restore for %s answers 404 and runs no ccd verb', async (id) => {
    const r = await rig([id]);
    const res = await post(r.app, id, 'restore');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
    expect(r.calls).toEqual([]);
    expect(r.listings(), 'the registry listing count').toBe(0);
  });

  it.each(ROUTABLE_REFUSED)('POST /prompt for %s answers 404 and sends no keys', async (id) => {
    // `capture-pane` fails in this rig, so an id that got past the gate is answered 409 `not-alive` at once rather
    // than walking sendPrompt's verify loop: the red is fast, and the failed capture is still on the record.
    const r = await rig([id], { fail: new Set(['capture-pane']) });
    const res = await post(r.app, id, 'prompt', { text: 'hello' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
    expect(r.calls.filter((c) => c[0] === 'send-keys')).toEqual([]);
    expect(r.calls, 'no tmux or ccd call at all').toEqual([]);
    expect(r.listings(), 'the registry listing count').toBe(0);
  });

  it('controls: a--actor, a.--actor and a 100-character id, rows planted, release normally', async () => {
    for (const id of CONTROLS) {
      const r = await rig([id]);
      const res = await post(r.app, id, 'release');
      expect(res.statusCode, id).toBe(200);
      expect(res.json(), id).toEqual({ ok: true });
      expect(r.calls, id).toEqual([['ws-release', '--session', id]]);
      expect(r.listings(), `${id}: the counter sees knownId's one listing`).toBe(1);
    }
  });
});

describe('the router answers an over-long request id before any gate (spec §2.3, as built)', () => {
  it.each(OVER_LONG.map((id) => [id.length, id] as const))(
    'an id of %i characters never reaches a handler: the router answers 414 and composes nothing',
    async (_n, id) => {
      const r = await rig([], { fleetState: POOLS_ADVERTISED });
      for (const [verb, payload] of [
        ['release', {}], ['restore', {}], ['prompt', { text: 'hello' }], ['ensure', {}],
        ['swap', { wrapper: 'claude-b', crossPool: true }],
      ] as const) {
        const res = await post(r.app, id, verb, payload);
        expect(res.statusCode, verb).toBe(414);
        expect(res.json(), verb).toMatchObject({ code: 'FST_ERR_MAX_PARAM_LENGTH' });
      }
      expect(r.calls).toEqual([]);
      expect(r.listings()).toBe(0);
    },
  );
});

describe('the two request-id routes outside knownId (spec §2.3, as built)', () => {
  it.each(ROUTABLE_REFUSED)('/ensure for %s answers 400 bad-session-id and composes no ensure', async (id) => {
    const r = await rig([id]);
    const res = await post(r.app, id, 'ensure');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session-id' });
    expect(r.calls).toEqual([]);
  });

  it.each(ROUTABLE_REFUSED)(
    '/swap with crossPool:true for %s answers 400 bad-session-id ahead of the skew gate',
    async (id) => {
      // Both fleet states, in this order. With NO evidence of `pools-v1` the skew gate answers 501, so a 400 here
      // proves the predicate stands AHEAD of it (R22). With the capability advertised, a missing predicate would
      // compose `swap --cross-pool <id>`.
      for (const [label, fleetState] of [
        ['no evidence', NO_EVIDENCE], ['pools-v1 advertised', POOLS_ADVERTISED],
      ] as const) {
        const r = await rig([id], { fleetState });
        const res = await post(r.app, id, 'swap', { wrapper: 'claude-b', crossPool: true });
        expect(res.statusCode, label).toBe(400);
        expect(res.json(), label).toEqual({ ok: false, error: 'bad-session-id' });
        expect(r.calls, label).toEqual([]);
      }
    },
  );

  it('control: /ensure for a--actor composes ensure a--actor', async () => {
    const r = await rig(['a--actor']);
    const res = await post(r.app, 'a--actor', 'ensure');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(r.calls).toEqual([['ensure', 'a--actor']]);
  });

  it('control: /swap with crossPool:true for a--actor, pools-v1 advertised, composes the crossing', async () => {
    // D-5240 (landing round 3): the swap route now reads the turn of both arms before the queue. tmux answers on its
    // own runner, never recorded in `calls`: the pane is proven gone, so the verdict is `idle` with no further read
    // (`swap-route-pool.test.ts`'s own adapter for the same gate).
    const paneGone: Runner = async (_cmd, args) =>
      args[0] === 'has-session' ? { code: 1, stdout: '', stderr: `can't find session: ${args[2] ?? ''}` }
        : { code: 0, stdout: '', stderr: '' };
    const r = await rig(['a--actor'], { fleetState: POOLS_ADVERTISED, tmux: new Tmux(paneGone) });
    const res = await post(r.app, 'a--actor', 'swap', { wrapper: 'claude-b', crossPool: true });
    expect(res.statusCode).toBe(200);
    expect(r.calls).toEqual([['swap', '--cross-pool', 'a--actor', 'claude-b']]);
  });
});
