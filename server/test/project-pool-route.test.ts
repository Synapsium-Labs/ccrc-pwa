// Spec §5.4.2. The route's whole contract is that it ANSWERS A MEASURED STATE:
// unlike `$REG/coordinator-paused`, this file IS under the agent's read roots,
// so the truthful answer is available before the 200 leaves — and echoing what
// was requested would report a tag the box may have refused to write.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { CCD_ARGV } from '../src/ccdargv.js';
import { POOLS_DIR_NAME } from '../src/pools.js';
import { DEFAULT_TEST_ROSTER, seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

let home: string;
let app: FastifyInstance | undefined;

const VERB = CCD_ARGV.projectPoolClear('demo')[0]!;

const POOLED = {
  ...DEFAULT_TEST_ROSTER,
  accounts: DEFAULT_TEST_ROSTER.accounts.map((a) => (a.id === 'claude' ? { ...a, pool: 'pool-a' } : a)),
};

const poolsDir = (): string => path.join(home, '.cc-sessions', POOLS_DIR_NAME);

/** A runner that RECORDS the argv and optionally acts on the marker, so the
 *  route's 200 is measured against a filesystem the "verb" actually changed. */
const runnerThat = (
  act: (argv: string[]) => void = () => {}, code = 0,
): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  return {
    calls,
    run: async (_cmd, args) => {
      calls.push([...args]);
      act([...args]);
      return code === 0
        ? { code: 0, stdout: '', stderr: '' }
        : { code, stdout: '', stderr: `ccd: pool tag for demo is malformed: ${poolsDir()}/demo` };
    },
  };
};

const open = async (
  run: Runner, over: Partial<Deps> = {},
): Promise<FastifyInstance> => {
  const cfg = loadConfig({ CCRC_HOME: home });
  const a = await buildServer({
    cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), ...over,
  } as Deps);
  await a.ready();
  return a;
};

const post = async (a: FastifyInstance, project: string, body: unknown) =>
  a.inject({ method: 'POST', url: `/api/projects/${project}/pool`, payload: body as never });

beforeEach(() => {
  home = mkTmp('ccrc-pool-route-');
  seedRoster(home, POOLED);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
});

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  rmSync(home, { recursive: true, force: true });
});

describe('POST /api/projects/:project/pool — refusals', () => {
  it('400 bad-request when `pool` is neither a string nor null', async () => {
    const { run, calls } = runnerThat();
    app = await open(run);
    for (const body of [{}, { pool: 7 }, { pool: true }, { pool: ['pool-a'] }]) {
      const res = await post(app, 'demo', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    }
    expect(calls, 'a refused body must not reach ccd').toEqual([]);
  });

  it('400 bad-pool-name for a string the grammar refuses, and ccd is never called', async () => {
    // The grammar is `POOL_NAME_RE`, imported from `shared/roster.ts` — the one
    // TypeScript spelling, pinned against ccd's one bash literal by
    // `pool-name-parity.test.ts`.
    const { run, calls } = runnerThat();
    app = await open(run);
    for (const pool of ['', 'Pool-A', 'pool a', '1pool', 'pool_a', '-pool', 'a'.repeat(33)]) {
      const res = await post(app, 'demo', { pool });
      expect(res.statusCode, pool).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-pool-name' });
    }
    expect(calls).toEqual([]);
  });

  it('501 unsupported when the deployed ccd does not have the verb', async () => {
    // Refuse on MEASURED absence, permit on none — `verbSupported`'s rule. The
    // verb is new and skew-exposed, so it must never join
    // `UNGATED_BY_DECISION`.
    const { run, calls } = runnerThat();
    app = await open(run, {
      fleetState: { connected: true, downSince: null, ccdVerbs: ['swap', 'start'], rosterFp: null, build: null },
    });
    const res = await post(app, 'demo', { pool: 'pool-a' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(calls).toEqual([]);
  });

  it('proceeds when ccdVerbs is null — an absent list is no evidence', async () => {
    const { run, calls } = runnerThat();
    app = await open(run);
    expect((await post(app, 'demo', { pool: 'pool-a' })).statusCode).toBe(200);
    expect(calls).toEqual([[VERB, '--project', 'demo', '--pool', 'pool-a']]);
  });

  it('502 with ccd\'s own sentence when the box refuses', async () => {
    const { run } = runnerThat(() => {}, 1);
    app = await open(run);
    const res = await post(app, 'demo', { pool: 'pool-a' });
    expect(res.statusCode).toBe(502);
    expect(res.json().ok).toBe(false);
    expect(res.json().stderr).toContain('pool tag for demo is malformed');
  });
});

describe('POST /api/projects/:project/pool — the measured 200', () => {
  it('answers untagged when the verb wrote nothing — never the requested value', async () => {
    // THE POINT OF THE ROUTE. A runner that exits 0 and writes nothing is a
    // stand-in for every way the box can decline; the answer must be what the
    // marker SAYS, not what the caller asked for.
    const { run } = runnerThat();
    app = await open(run);
    const res = await post(app, 'demo', { pool: 'pool-a' });
    expect(res.statusCode).toBe(200);
    expect(res.json().pool).toEqual({ state: 'untagged' });
  });

  it('answers tagged, with the bytes the verb actually wrote', async () => {
    const { run } = runnerThat(() => {
      mkdirSync(poolsDir(), { recursive: true });
      writeFileSync(path.join(poolsDir(), 'demo'), 'pool-a');
    });
    app = await open(run);
    const res = await post(app, 'demo', { pool: 'pool-a' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, pool: { state: 'tagged', name: 'pool-a' } });
  });

  it('answers malformed when the bytes on disk do not match the grammar', async () => {
    const { run } = runnerThat(() => {
      mkdirSync(poolsDir(), { recursive: true });
      writeFileSync(path.join(poolsDir(), 'demo'), 'pool a');
    });
    app = await open(run);
    expect((await post(app, 'demo', { pool: 'pool-a' })).json().pool).toEqual({ state: 'malformed' });
  });

  it('warns unknown-pool when this box\'s roster has no account in that pool', async () => {
    // A WARNING, not a refusal (O4): the server's roster copy can lag the
    // fleet's, and the pool may be about to gain an account.
    const { run } = runnerThat(() => {
      mkdirSync(poolsDir(), { recursive: true });
      writeFileSync(path.join(poolsDir(), 'demo'), 'pool-b');
    });
    app = await open(run);
    const res = await post(app, 'demo', { pool: 'pool-b' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, pool: { state: 'tagged', name: 'pool-b' }, warning: 'unknown-pool' });
  });

  it('does NOT warn for a pool the roster carries', async () => {
    const { run } = runnerThat(() => {
      mkdirSync(poolsDir(), { recursive: true });
      writeFileSync(path.join(poolsDir(), 'demo'), 'pool-a');
    });
    app = await open(run);
    expect(Object.keys((await post(app, 'demo', { pool: 'pool-a' })).json())).not.toContain('warning');
  });

  it('clears with the --clear entry, and never warns on a clear', async () => {
    mkdirSync(poolsDir(), { recursive: true });
    writeFileSync(path.join(poolsDir(), 'demo'), 'pool-b');
    const { run, calls } = runnerThat(() => { rmSync(path.join(poolsDir(), 'demo')); });
    app = await open(run);
    const res = await post(app, 'demo', { pool: null });
    expect(calls).toEqual([[VERB, '--project', 'demo', '--clear']]);
    expect(res.json()).toEqual({ ok: true, pool: { state: 'untagged' } });
  });
});
