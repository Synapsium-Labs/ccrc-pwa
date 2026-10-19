// D-5240 (spec §5.9, "The server and the PWA"): `POST /api/sessions/:id/swap` reads the same fail-closed turn verdict
// as archive (`turnVerdictFor`) before the queue and again inside it. Without consent a measured turn is `409
// session-busy` and a turn nobody could read `409 status-unknown`; with `{interrupt: true}` a busy turn proceeds and an
// unread one is still refused. `--interrupt` reaches ccd only behind the fleet's `swap-busy-v1` word, and ccd's own two
// refusals come back as the same two 409s rather than the generic 502. End to end through `buildServer` over a fixture
// HOME: the registry row and the live status file are files in it; every tmux and ccd call is a recorded double.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { Tmux, type Runner } from '../src/exec.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { POOLS_CAP, SWAP_BUSY_CAP } from '../src/ccdargv.js';
import { SWAP_REFUSALS, SWAP_REFUSAL_CODES } from '../../shared/api.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PANE = 4242;
const ID = 'lane-a-project-a';
const ROSTER = {
  version: 1,
  accounts: ['lane-a', 'lane-b'].map((id, i) => ({
    id, label: id, configDirSuffix: `.${id}`, exec: i === 0 ? { kind: 'upstream' } : { kind: 'generated' },
    homeAble: true, hue: 'blue', telemetry: 'anthropic',
  })),
};

interface BoxCfg {
  /** The fleet box's `ccd caps` words; `null` is a box whose caps were never measured. */
  caps?: string[] | null;
  /** Called with every call's argv before it is answered — a turn that starts while the route waits. */
  onCall?: (args: string[]) => void;
  /** `ccd swap`'s answer; every other call exits 0. */
  swap?: { code: number; stderr: string };
  queue?: KeyedQueue;
  /** The row's `.uuid` is listed but its read fails: the identity is unmeasured (D-5380). */
  uuidUnreadable?: boolean;
}

let open: Array<{ app: FastifyInstance; home: string }> = [];
afterEach(async () => {
  for (const o of open) { await o.app.close(); rmSync(o.home, { recursive: true, force: true }); }
  open = [];
});

const box = async (cfg: BoxCfg = {}) => {
  const home = mkTmp('ccrc-swap-busy-');
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    cfg.onCall?.(args);
    const verb = args[0] ?? '';
    if (verb === 'list-panes') return { code: 0, stdout: `${PANE}\n`, stderr: '' };
    if (verb === 'swap' && cfg.swap) return { code: cfg.swap.code, stdout: '', stderr: cfg.swap.stderr };
    return { code: 0, stdout: '', stderr: '' };
  };
  seedRoster(home, ROSTER);
  const config = loadConfig({ CCRC_HOME: home });
  const deps = {
    cfg: config, runCcd: ccdRunner(run, config), tmux: new Tmux(run),
    io: cfg.uuidUnreadable !== true ? localIO : {
      ...localIO,
      readFileMeasured: async (p: string, t?: number, sig?: AbortSignal) =>
        (p.endsWith('.uuid') ? { ok: false, reason: 'unreadable' } as const : localIO.readFileMeasured(p, t, sig)),
    },
    queue: cfg.queue ?? new KeyedQueue(),
    ...(cfg.caps === undefined ? {} : {
      fleetState: { connected: true, downSince: null, ccdVerbs: cfg.caps, rosterFp: null, build: null },
    }),
  } as Deps;
  const app = await buildServer(deps, new Bus());
  open.push({ app, home });
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'lane-a', project: 'project-a', workdir: path.join(home, 'projects', 'project-a'),
    uuid: `u-${ID}`, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  return { home, calls, app, ccd: () => calls.filter((c) => c[0] === 'swap') };
};

/** Claude Code's own live file for the pane: what `status` is read from. */
const liveStatus = (home: string, status: string): void => {
  const dir = path.join(home, '.lane-a', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${PANE}.json`),
    JSON.stringify({ pid: PANE, sessionId: 'u', status, statusUpdatedAt: Date.now() - 60_000 }));
};

const post = (app: FastifyInstance, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/sessions/${ID}/swap`, payload });

const ALL_CAPS = [POOLS_CAP, SWAP_BUSY_CAP];

describe('the swap route refuses a turn it was not told to lose (D-5240)', () => {
  it('D-5379: the declared crossing reads the row: an unknown id is 404 unknown-session, and ccd is never called', async () => {
    const b = await box({ caps: ALL_CAPS });
    const res = await b.app.inject({
      method: 'POST', url: '/api/sessions/lane-a-nothing/swap', payload: { wrapper: 'lane-b', crossPool: true } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
    expect(b.ccd()).toEqual([]);
  });

  it('D-5380: a row whose identity could not be read is 503 registry-unmeasurable on both arms, with or without consent', async () => {
    for (const payload of [{ wrapper: 'lane-b' }, { wrapper: 'lane-b', crossPool: true, interrupt: true }]) {
      const b = await box({ caps: ALL_CAPS, uuidUnreadable: true });
      liveStatus(b.home, 'idle');
      const res = await post(b.app, payload);
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ ok: false, error: 'registry-unmeasurable' });
      expect(b.ccd()).toEqual([]);
    }
  });

  it('an idle session swaps as before: 200, the old argv', async () => {
    const b = await box();
    liveStatus(b.home, 'idle');
    const res = await post(b.app, { wrapper: 'lane-b' });
    expect(res.statusCode).toBe(200);
    expect(b.ccd()).toEqual([['swap', ID, 'lane-b']]);
  });

  it('a busy session is 409 session-busy, and ccd is never called', async () => {
    const b = await box({ caps: ALL_CAPS });
    liveStatus(b.home, 'busy');
    const res = await post(b.app, { wrapper: 'lane-b' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: SWAP_REFUSALS.sessionBusy });
    expect(b.ccd()).toEqual([]);
  });

  it('a status nobody could read is 409 status-unknown, and ccd is never called', async () => {
    const b = await box({ caps: ALL_CAPS });
    const res = await post(b.app, { wrapper: 'lane-b' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: SWAP_REFUSALS.statusUnknown });
    expect(b.ccd()).toEqual([]);
  });

  it('consent does not cover an unread status: interrupt + unmeasured is still 409 status-unknown', async () => {
    const b = await box({ caps: ALL_CAPS });
    const res = await post(b.app, { wrapper: 'lane-b', interrupt: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: SWAP_REFUSALS.statusUnknown });
    expect(b.ccd()).toEqual([]);
  });

  it('consent is the boolean true only: interrupt "true" or 1 on a busy session is still 409 session-busy', async () => {
    for (const interrupt of ['true', 1] as const) {
      const b = await box({ caps: ALL_CAPS });
      liveStatus(b.home, 'busy');
      const res = await post(b.app, { wrapper: 'lane-b', interrupt });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ ok: false, error: SWAP_REFUSALS.sessionBusy });
      expect(b.ccd()).toEqual([]);
    }
  });

  it('interrupt + busy, on a box that advertises swap-busy-v1, sends --interrupt', async () => {
    const b = await box({ caps: ALL_CAPS });
    liveStatus(b.home, 'busy');
    const res = await post(b.app, { wrapper: 'lane-b', interrupt: true });
    expect(res.statusCode).toBe(200);
    expect(b.ccd()).toEqual([['swap', '--interrupt', ID, 'lane-b']]);
  });

  it('interrupt + busy, on a box without the word, sends the old argv (an old ccd refuses nothing)', async () => {
    const b = await box({ caps: [POOLS_CAP] });
    liveStatus(b.home, 'busy');
    const res = await post(b.app, { wrapper: 'lane-b', interrupt: true });
    expect(res.statusCode).toBe(200);
    expect(b.ccd()).toEqual([['swap', ID, 'lane-b']]);
  });

  it('a box whose caps were never measured gets the old argv too', async () => {
    const b = await box({ caps: null });
    liveStatus(b.home, 'busy');
    expect((await post(b.app, { wrapper: 'lane-b', interrupt: true })).statusCode).toBe(200);
    expect(b.ccd()).toEqual([['swap', ID, 'lane-b']]);
  });
});

describe('the declared crossing takes the same gate (D-5240)', () => {
  it('busy without consent: 409 session-busy, no ccd call', async () => {
    const b = await box({ caps: ALL_CAPS });
    liveStatus(b.home, 'busy');
    const res = await post(b.app, { wrapper: 'lane-b', crossPool: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: SWAP_REFUSALS.sessionBusy });
    expect(b.ccd()).toEqual([]);
  });

  it('unmeasured with consent: 409 status-unknown, no ccd call', async () => {
    const b = await box({ caps: ALL_CAPS });
    const res = await post(b.app, { wrapper: 'lane-b', crossPool: true, interrupt: true });
    expect(res.json()).toEqual({ ok: false, error: SWAP_REFUSALS.statusUnknown });
    expect(b.ccd()).toEqual([]);
  });

  it('busy with consent and the word: --cross-pool --interrupt; without the word: the old crossing argv', async () => {
    const b = await box({ caps: ALL_CAPS });
    liveStatus(b.home, 'busy');
    expect((await post(b.app, { wrapper: 'lane-b', crossPool: true, interrupt: true })).statusCode).toBe(200);
    expect(b.ccd()).toEqual([['swap', '--cross-pool', '--interrupt', ID, 'lane-b']]);
    const old = await box({ caps: [POOLS_CAP] });
    liveStatus(old.home, 'busy');
    expect((await post(old.app, { wrapper: 'lane-b', crossPool: true, interrupt: true })).statusCode).toBe(200);
    expect(old.ccd()).toEqual([['swap', '--cross-pool', ID, 'lane-b']]);
  });
});

describe('a turn that begins while the swap waits in the queue is refused inside the job (D-5240)', () => {
  it('idle at the request, busy when the slot frees: 409 session-busy, no ccd call', async () => {
    const queue = new KeyedQueue();
    const b = await box({ caps: ALL_CAPS, queue });
    liveStatus(b.home, 'idle');
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const heldRun = queue.run(ID, async () => { await held; });
    const pending = post(b.app, { wrapper: 'lane-b' });
    // The pre-queue read has run once the pane pid was asked for; the job cannot run until the slot frees.
    const started = Date.now();
    while (!b.calls.some((c) => c[0] === 'list-panes')) {
      if (Date.now() - started > 5_000) throw new Error('the route never read the pane');
      await new Promise((r) => setTimeout(r, 1));
    }
    await new Promise((r) => setTimeout(r, 20));
    liveStatus(b.home, 'busy');
    release();
    await heldRun;
    const res = await pending;
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: SWAP_REFUSALS.sessionBusy });
    expect(b.ccd()).toEqual([]);
  });
});

describe('the turn gate refuses BEFORE the queue (D-5240)', () => {
  it('a busy session is refused while another write holds its slot, taking no slot of its own', async () => {
    const keys: string[] = [];
    const queue = new (class extends KeyedQueue {
      override run<T>(key: string, fn: () => Promise<T>): Promise<T> { keys.push(key); return super.run(key, fn); }
    })();
    const b = await box({ caps: ALL_CAPS, queue });
    liveStatus(b.home, 'busy');
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const heldRun = queue.run(ID, async () => { await held; });
    try {
      const answered = await Promise.race([post(b.app, { wrapper: 'lane-b' }),
        new Promise<'blocked'>((r) => { setTimeout(() => r('blocked'), 2_000); })]);
      expect(answered, 'the refusal waited for the held slot: it was decided inside the queue').not.toBe('blocked');
      const res = answered as Exclude<typeof answered, 'blocked'>;
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ ok: false, error: SWAP_REFUSALS.sessionBusy });
      expect(keys, 'a refusal must not take a queue slot').toEqual([ID]);
    } finally {
      release();
      await heldRun;
    }
  });
});

describe("ccd's own refusals reach the operator as the same two 409s (D-5240)", () => {
  it('`ccd: status-unknown:` is 409 status-unknown', async () => {
    const b = await box({ caps: ALL_CAPS,
      swap: { code: 1, stderr: `ccd: status-unknown: the status of ${ID} could not be read, so a swap could lose a turn nobody measured; nothing was touched.\n` } });
    liveStatus(b.home, 'idle');
    const res = await post(b.app, { wrapper: 'lane-b' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: SWAP_REFUSALS.statusUnknown });
  });

  it('`ccd: session-busy:` (both server reads said idle) is 409 session-busy', async () => {
    const b = await box({ caps: ALL_CAPS,
      swap: { code: 1, stderr: `ccd: session-busy: ${ID} is working — a swap restarts it and loses the turn in progress and its background tasks; nothing was touched.\n` } });
    liveStatus(b.home, 'idle');
    const res = await post(b.app, { wrapper: 'lane-b' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: SWAP_REFUSALS.sessionBusy });
  });

  it('the phrase anywhere but at the head of the first line is an ordinary failure: 502', async () => {
    const stderr = 'ccd: cannot carry the transcript (an earlier run said ccd: session-busy: once)\n';
    const b = await box({ caps: ALL_CAPS, swap: { code: 1, stderr } });
    liveStatus(b.home, 'idle');
    const res = await post(b.app, { wrapper: 'lane-b' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr });
  });

  it('a second-line refusal is not the first line: 502', async () => {
    const stderr = 'ccd: warning: something\nccd: session-busy: x\n';
    const b = await box({ caps: ALL_CAPS, swap: { code: 1, stderr } });
    liveStatus(b.home, 'idle');
    expect((await post(b.app, { wrapper: 'lane-b' })).statusCode).toBe(502);
  });

  it('any other ccd failure is 502 with its stderr, as before', async () => {
    const b = await box({ caps: ALL_CAPS, swap: { code: 1, stderr: 'boom' } });
    liveStatus(b.home, 'idle');
    const res = await post(b.app, { wrapper: 'lane-b' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'boom' });
  });
});

// TASK 17b (D-5242): a hibernated row has no running session to move — `cmd_swap` refuses it (`ccd: hibernated:`)
// while `.hibernated` stands. The route answers that before any turn read (an asleep row's turn reads `unmeasured`,
// which would otherwise answer the misleading `status-unknown`), and maps ccd's own word to the same 409.
describe('a hibernated row is 409 hibernated (D-5242)', () => {
  const sleep = (home: string): void => {
    const reg = path.join(home, '.cc-sessions');
    writeFileSync(path.join(reg, `${ID}.stopped`), '1799974800 ccd');
    writeFileSync(path.join(reg, `${ID}.hibernated`), '1799974800 7');
  };

  it('on both arms, with or without consent: 409 hibernated, and ccd is never called', async () => {
    for (const payload of [{ wrapper: 'lane-b' }, { wrapper: 'lane-b', interrupt: true }, { wrapper: 'lane-b', crossPool: true }]) {
      const b = await box({ caps: ALL_CAPS });
      sleep(b.home);
      const res = await post(b.app, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(409);
      expect(res.json()).toEqual({ ok: false, error: SWAP_REFUSALS.hibernated });
      expect(b.ccd()).toEqual([]);
    }
  });

  it('`ccd: hibernated:` (the row fell asleep after the route read it) is 409 hibernated, never 502', async () => {
    const b = await box({ caps: ALL_CAPS,
      swap: { code: 1, stderr: `ccd: hibernated: ${ID} is asleep — wake it first (ccd ensure); nothing was touched\n` } });
    liveStatus(b.home, 'idle');
    const res = await post(b.app, { wrapper: 'lane-b' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: SWAP_REFUSALS.hibernated });
  });

  it('the word is the refusal table\'s: hibernated answers 409 through REFUSAL_STATUS', () => {
    expect(REFUSAL_STATUS[SWAP_REFUSALS.hibernated]).toBe(409);
    for (const code of SWAP_REFUSAL_CODES) expect(REFUSAL_STATUS[code], code).toBe(409);
  });
});
