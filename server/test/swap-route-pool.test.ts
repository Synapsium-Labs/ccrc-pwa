// Spec §5.6 / §11 row 46. The server REFUSES; it never places. These cases pin
// both halves of that: a mismatch is a 409 with a slug and ccd is NEVER called,
// and a deliberate crossing is gated on MEASURED evidence that the box parses
// the flag — because a `--cross-pool` that an old ccd mis-binds is the
// silent-success class, not a loud failure.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { CCD_ARGV, POOLS_CAP } from '../src/ccdargv.js';
import { POOLS_DIR_NAME } from '../src/pools.js';
import { DEFAULT_TEST_ROSTER, seedRoster } from './helpers.js';
import { degradedReadIO } from './ioDoubles.js';
import { mkTmp } from './tmpHelpers.js';

let home: string;
let app: FastifyInstance | undefined;
let calls: string[][];

const ID = 'claude-demo';

const POOLED = {
  ...DEFAULT_TEST_ROSTER,
  accounts: DEFAULT_TEST_ROSTER.accounts.map((a) =>
    a.id === 'claude' ? { ...a, pool: 'pool-a' }
    : a.id === 'claude-b' ? { ...a, pool: 'pool-b' } : a),
};

const seedField = (id: string, field: string, value: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  writeFileSync(path.join(reg, `${id}.${field}`), value);
};

const seedSession = (id: string, wrapper: string, project: string): void => {
  seedField(id, 'wrapper', wrapper);
  seedField(id, 'project', project);
  seedField(id, 'workdir', `/data/projects/${project}`);
  seedField(id, 'uuid', 'a'.repeat(36));
};

const tag = (project: string, bytes: string): void => {
  const dir = path.join(home, '.cc-sessions', POOLS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, project), bytes);
};

/**
 * A `KeyedQueue` that records the keys it was asked to run under. The swap
 * route's serialization is then observable WITHOUT a timeout: a test can wait
 * until the route has enqueued rather than sleeping long enough that it
 * probably has. That distinction is the point — see the both-arms case at the
 * bottom of this file.
 */
class RecordingQueue extends KeyedQueue {
  readonly keys: string[] = [];
  override run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    this.keys.push(key);
    return super.run(key, fn);
  }
}

/** Poll until `pred` holds. Fails the test on the cap rather than hanging. */
const waitFor = async (pred: () => boolean, what: string, capMs = 2_000): Promise<void> => {
  const started = Date.now();
  while (!pred()) {
    if (Date.now() - started > capMs) throw new Error(`waitFor timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 1));
  }
};

const open = async (
  opts: { ccdVerbs?: string[] | null; io?: FleetIO; queue?: KeyedQueue } = {},
): Promise<FastifyInstance> => {
  calls = [];
  const run: Runner = async (_cmd, args) => { calls.push([...args]); return { code: 0, stdout: '', stderr: '' }; };
  const cfg = loadConfig({ CCRC_HOME: home });
  const a = await buildServer({
    cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: opts.io ?? localIO, queue: opts.queue ?? new KeyedQueue(),
    ...(opts.ccdVerbs !== undefined
      ? { fleetState: { connected: true, downSince: null, ccdVerbs: opts.ccdVerbs, rosterFp: null, build: null } }
      : {}),
  } as Deps);
  await a.ready();
  return a;
};

beforeEach(() => {
  home = mkTmp('ccrc-swap-pool-');
  seedRoster(home, POOLED);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  seedSession(ID, 'claude', 'demo');
});

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  rmSync(home, { recursive: true, force: true });
});

describe('POST /api/sessions/:id/swap — the pool pre-check', () => {
  it('passes an in-pool target straight through, argv unchanged', async () => {
    tag('demo', 'pool-a');
    app = await open();
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude' } });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([['swap', ID, 'claude']]);
  });

  it('passes an UNTAGGED account through to a tagged project — an untagged account is unconstrained', async () => {
    tag('demo', 'pool-a');
    app = await open();
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-d' } })).statusCode).toBe(200);
    expect(calls).toEqual([['swap', ID, 'claude-d']]);
  });

  it('409s a mismatch, names both pools, and NEVER calls ccd', async () => {
    tag('demo', 'pool-a');
    app = await open();
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-b' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'pool-mismatch', accountPool: 'pool-b', projectPool: 'pool-a' });
    expect(calls, 'the server refuses; it must not also ask the box').toEqual([]);
  });

  it('503s an undecidable tag with the state, and never calls ccd', async () => {
    // NOBODY DECIDES (spec §5.2). Not a 409 — a 409 says "this account is
    // wrong", and nothing here knows that.
    tag('demo', 'Pool A');
    app = await open();
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-b' } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'pool-unreadable', state: 'malformed' });
    expect(calls).toEqual([]);
  });

  it('503s `unreadable` when the marker is there and its bytes did not come back', async () => {
    tag('demo', 'pool-a');
    app = await open({ io: degradedReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/demo`)) });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-b' } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'pool-unreadable', state: 'unreadable' });
  });

  it('404s an id the registry does not list, and 503s a registry it could not list', async () => {
    app = await open();
    const missing = await app.inject({ method: 'POST', url: '/api/sessions/claude-nothing/swap', payload: { wrapper: 'claude' } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ ok: false, error: 'unknown-session' });
    await app.close();
    app = await open({ io: { ...localIO, readdir: async () => null } });
    const unlistable = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude' } });
    expect(unlistable.statusCode).toBe(503);
    expect(unlistable.json()).toEqual({ ok: false, error: 'registry-unmeasurable' });
  });
});

describe('POST /api/sessions/:id/swap — the deliberate crossing', () => {
  it('501s crossPool when the box has not advertised pools-v1 — REFUSE on no evidence', async () => {
    // `capSupported`, not `verbSupported`: for a FLAG a wrong guess is a silent
    // success (an old ccd binds `--cross-pool` somewhere harmless and exits 0,
    // which this route's own `res.ok ? { ok: true }` mapping renders as
    // `200 {ok:true}`), so the no-evidence default is refuse. That mapping is
    // named rather than `runCcdOr502` because the wave-3/D-2177 composition
    // hoisted BOTH arms into one queued call, and neither arm reaches the
    // helper any more — the `/stop` and `/archive` routes still do.
    tag('demo', 'pool-a');
    for (const verbs of [null, ['swap']] as const) {
      app = await open({ ccdVerbs: verbs === null ? null : [...verbs] });
      const res = await app.inject({
        method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-b', crossPool: true },
      });
      expect(res.statusCode, JSON.stringify(verbs)).toBe(501);
      expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
      expect(calls).toEqual([]);
      await app.close();
      app = undefined;
    }
  });

  it('builds the swapCross argv when the box advertises pools-v1', async () => {
    tag('demo', 'pool-a');
    app = await open({ ccdVerbs: ['swap', POOLS_CAP] });
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-b', crossPool: true },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([CCD_ARGV.swapCross(ID, 'claude-b') as unknown as string[]]);
  });

  it('crossPool:false is not a crossing — it takes the ordinary verdict', async () => {
    tag('demo', 'pool-a');
    app = await open({ ccdVerbs: ['swap', POOLS_CAP] });
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-b', crossPool: false },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('POST /api/sessions — creation-only, revival passes through', () => {
  it('409s a mismatched CREATION', async () => {
    tag('quiet-basin', 'pool-a');
    app = await open();
    const res = await app.inject({
      method: 'POST', url: '/api/sessions', payload: { wrapper: 'claude-b', project: 'quiet-basin' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'pool-mismatch', accountPool: 'pool-b', projectPool: 'pool-a' });
    expect(calls).toEqual([]);
  });

  it('passes a REVIVAL through unchecked — the registry wins, and ruling 5 moves it', async () => {
    // `cmd_start`'s own fix (spec §5.5.5): at the two-argument form the registry
    // overrides the wrapper argument, so refusing here would refuse a REVIVE of
    // a session that is already running wrong-pool — and the auto-swapper is
    // what moves it, at the next boundary.
    tag('demo', 'pool-a');
    seedSession('claude-b-demo', 'claude-b', 'demo');
    app = await open();
    const res = await app.inject({
      method: 'POST', url: '/api/sessions', payload: { wrapper: 'claude-b', project: 'demo' },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([['enable', 'claude-b', 'demo']]);
  });

  it('501s a crossPool creation on a box with no pools-v1, and builds enableCross/startCross with it', async () => {
    tag('quiet-basin', 'pool-a');
    app = await open({ ccdVerbs: ['enable'] });
    expect((await app.inject({
      method: 'POST', url: '/api/sessions', payload: { wrapper: 'claude-b', project: 'quiet-basin', crossPool: true },
    })).statusCode).toBe(501);
    await app.close();

    app = await open({ ccdVerbs: ['enable', 'start', POOLS_CAP] });
    await app.inject({
      method: 'POST', url: '/api/sessions', payload: { wrapper: 'claude-b', project: 'quiet-basin', crossPool: true },
    });
    await app.inject({
      method: 'POST', url: '/api/sessions',
      payload: { wrapper: 'claude-b', project: 'quiet-basin', crossPool: true, enable: false, workdir: '/w' },
    });
    expect(calls).toEqual([
      ['enable', '--cross-pool', 'claude-b', 'quiet-basin'],
      ['start', '--cross-pool', 'claude-b', 'quiet-basin', '/w'],
    ]);
  });

  it('503s an undecidable tag on creation', async () => {
    tag('quiet-basin', 'pool a');
    app = await open();
    const res = await app.inject({
      method: 'POST', url: '/api/sessions', payload: { wrapper: 'claude', project: 'quiet-basin' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'pool-unreadable', state: 'malformed' });
  });
});

// THE MERGE'S OWN INVARIANT, and it belongs to neither parent. On
// `ws/clear-meadow` the crossPool arm returned `runCcdOr502(reply,
// CCD_ARGV.swapCross(...))` outside any queue; on `origin/main` there was no
// crossPool arm at all and the ordinary swap went straight into
// `sendDeps.queue.run` (D-2177). Composing them hoisted BOTH arms behind ONE
// queued call — a decision this merge made, which until this case was asserted
// only in a comment. A comment is a request; a red suite is a mechanism.
//
// MEASURED RED, and the message is the one the mutation actually produced,
// not the one predicted for it: with the crossPool arm reverted to a direct
// `return runCcdOr502(reply, CCD_ARGV.swapCross(id, body.wrapper))` this case
// fails `Error: waitFor timed out: the swap route to enqueue` — the route
// answers 200 from outside the queue and `queue.keys` never reaches two, so
// the wait is what fires first. GREEN 14/14 with the arm restored.
describe('POST /api/sessions/:id/swap — both arms ride the per-session queue (D-2177)', () => {
  it('a declared crossing is serialized exactly like an ordinary swap', async () => {
    tag('demo', 'pool-a');
    const queue = new RecordingQueue();
    app = await open({ ccdVerbs: ['swap', POOLS_CAP], queue });

    // Stand in for an `answerAsk` between its pane capture and its keystroke.
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const order: string[] = [];
    const heldRun = queue.run(ID, async () => { order.push('held-start'); await held; order.push('held-end'); });
    await waitFor(() => order.length === 1, 'the held slot to start');

    const post = app.inject({
      method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-b', crossPool: true },
    });

    // NOT a timeout. `origin/main`'s own D-2177 case sleeps 20 ms and argues
    // that an unserialized swap "has nothing async blocking it before its ccd
    // call" — true there, FALSE after this merge, whose ordinary arm awaits
    // `readSessionRecord`, a registry `readdir` and `readProjectPools` first.
    // Waiting for the ENQUEUE itself is the observation that survives both
    // shapes and a loaded box.
    await waitFor(() => queue.keys.length === 2, 'the swap route to enqueue');
    expect(queue.keys).toEqual([ID, ID]);
    expect(calls, 'ccd ran while another write for this session held the slot').toEqual([]);

    release();
    await heldRun;
    const res = await post;
    expect(res.statusCode).toBe(200);
    expect(order).toEqual(['held-start', 'held-end']);
    expect(calls).toEqual([CCD_ARGV.swapCross(ID, 'claude-b') as unknown as string[]]);
  });
});

/**
 * Run a refusal while another write holds the same session's queue slot.
 * A pre-queue refusal answers immediately and never registers another key; a
 * refusal moved inside `queue.run` cannot answer until the held write releases.
 */
const refusalAnswersWhileHeld = async (
  a: FastifyInstance,
  queue: RecordingQueue,
  key: string,
  payload: Record<string, unknown>,
): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const order: string[] = [];
  const heldRun = queue.run(key, async () => {
    order.push('held-start');
    await held;
    order.push('held-end');
  });

  try {
    await waitFor(() => order.length === 1, `the held slot on ${key} to start`);
    const post = a.inject({ method: 'POST', url: `/api/sessions/${key}/swap`, payload });
    let answer: Awaited<typeof post> | undefined;
    void post.then((res) => { answer = res; });
    await waitFor(() => answer !== undefined, `the refusal for ${key} to answer outside the held slot`);
    expect(queue.keys, 'a refusal must not take a queue slot').toEqual([key]);
    expect(calls, 'the server refuses without asking ccd').toEqual([]);
    expect(order, 'the first write must still hold the slot').toEqual(['held-start']);
    return answer!;
  } finally {
    release();
    await heldRun;
  }
};

describe('POST /api/sessions/:id/swap — each arm refuses before the queued call', () => {
  it('answers the crossPool 501 while the slot is held', async () => {
    tag('demo', 'pool-a');
    const queue = new RecordingQueue();
    app = await open({ ccdVerbs: ['swap'], queue });
    const res = await refusalAnswersWhileHeld(app, queue, ID, { wrapper: 'claude-b', crossPool: true });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
  });

  it('answers the ordinary 409 while the slot is held', async () => {
    tag('demo', 'pool-a');
    const queue = new RecordingQueue();
    app = await open({ queue });
    const res = await refusalAnswersWhileHeld(app, queue, ID, { wrapper: 'claude-b' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      ok: false, error: 'pool-mismatch', accountPool: 'pool-b', projectPool: 'pool-a',
    });
  });

  it('answers a malformed pool-tag 503 while the slot is held', async () => {
    tag('demo', 'Pool A');
    const queue = new RecordingQueue();
    app = await open({ queue });
    const res = await refusalAnswersWhileHeld(app, queue, ID, { wrapper: 'claude-b' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'pool-unreadable', state: 'malformed' });
  });

  it('answers an unreadable pool-tag 503 while the slot is held', async () => {
    tag('demo', 'pool-a');
    const queue = new RecordingQueue();
    app = await open({
      io: degradedReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/demo`)),
      queue,
    });
    const res = await refusalAnswersWhileHeld(app, queue, ID, { wrapper: 'claude-b' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'pool-unreadable', state: 'unreadable' });
  });

  it('answers the ordinary 404 while the unlisted id\'s slot is held', async () => {
    const queue = new RecordingQueue();
    app = await open({ queue });
    const res = await refusalAnswersWhileHeld(app, queue, 'claude-nothing', { wrapper: 'claude' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
  });

  it('answers the ordinary 503 while the slot is held', async () => {
    const queue = new RecordingQueue();
    app = await open({ io: { ...localIO, readdir: async () => null }, queue });
    const res = await refusalAnswersWhileHeld(app, queue, ID, { wrapper: 'claude' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'registry-unmeasurable' });
  });
});
