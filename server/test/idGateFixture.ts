// Path identity W1a (spec 2026-10-12 §2.3): the shared rig of the id-gate suites. A refused id is planted as a REAL
// row under a fixture HOME's registry (`$REG/--actor.uuid` is an ordinary file), so a gate that refuses it is shown
// refusing a row that EXISTS, never an absent one. Fixture HOMEs only: `testDeps` loads its config from the HOME it
// is given, and the runner here records argv and never execs anything (`testDeps` puts `guardRunner`, the agent's
// whitelist, in front of it).
//
// Task 3 adds `storedRun` here. Every later id-gate suite builds on this file, never on a second rig.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import type { CcrcConfig } from '../src/config.js';
import type { Runner } from '../src/exec.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps } from './helpers.js';
import type { RunState } from '../../shared/api.js';

/** The box token `appFor` builds every server with: send it as `x-ccrc-mail-token` on a box-token-gated route. */
export const ID_GATE_TOKEN = 'f'.repeat(64);

/** `coord-abandon.test.ts`'s `seed` row: every field a workspace session carries, for any id. */
const rowDefaults = (id: string): Record<string, string> => ({
  wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
  workspace: id, branch: `ws/${id}`, base: 'origin/main',
});

/** Plants `$REG/<id>.<field>` for every field, `fields` overriding the defaults. Any id: `--actor` included. */
export function seedRow(home: string, id: string, fields: Record<string, string> = {}): void {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({ ...rowDefaults(id), ...fields })) {
    writeFileSync(path.join(reg, `${id}.${k}`), v);
  }
}

/** Records every argv (ccd's verb or tmux's subcommand at `[0]`) and answers success, or a failure for any
 *  `args[0]` in `fail`. Records BEFORE answering, so a failed call is still on the record. */
export function recorder(cfg: { fail?: ReadonlySet<string> } = {}): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    const verb = args[0] ?? '';
    if (cfg.fail?.has(verb)) return { code: 1, stdout: '', stderr: `${verb} failed on the box` };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

/** The server over a fixture HOME, with a real CoordStore and `ID_GATE_TOKEN` as its box token. */
export async function appFor(
  home: string, run: Runner, over: Partial<Omit<Deps, 'cfg'>> = {},
): Promise<{ app: FastifyInstance; coord: CoordStore; cfg: CcrcConfig }> {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const app = await buildServer({ ...base, mailToken: ID_GATE_TOKEN, coord, ...over });
  return { app, coord, cfg: base.cfg };
}

// ── Task 3 (spec §2.3): a stored run row, written through the store ─────────────────────────────────────────────

/** Where `storedRun` parks a run, by kind. `advance` is the only writer of `runs.state`, so a row is parked by walking
 *  its own machine's forward edges from `dispatched`. A review run has no `awaiting-review` and no `merging`. */
const STORED_RUN_WALK: Readonly<Record<'work' | 'review', readonly RunState[]>> = {
  work: ['dispatched', 'working', 'awaiting-review', 'merging'],
  review: ['dispatched', 'working'],
};
let storedRunPrograms = 0;

/**
 * A run row opened THROUGH THE STORE, never through `POST /api/runs`, as `coord-abandon.test.ts`'s `wedged` does. A
 * row written before any ingress check, or rebuilt from the registry, is exactly what the stored-row gates exist for,
 * so the fixture must be able to write one the route would refuse.
 *
 * Each call opens its own programme (`id-gate-<n>`), wave 1 of 2, project `demo`. One programme for all calls would
 * break two ways: `openRun` is idempotent per programme, wave and claimant while a run is `planned`, so two calls would
 * fold into one row; and it refuses a second claimant on one programme. A test that needs a second run in the SAME
 * programme opens it with `coord.openRun` itself.
 *
 * Binding: a `planned` run with a session is bound by `setSession`, a wave-N reclaim's shape. Any other state is bound
 * by `markDispatched` (workspace = the id, branch `ws/<id>`) and then walked forward. This plants no registry row:
 * `seedRow` does that.
 */
export function storedRun(coord: CoordStore, r: {
  state: RunState; sessionId: string | null; claimedBy: string; kind?: 'work' | 'review'; reviews?: number;
}): number {
  storedRunPrograms += 1;
  const opened = coord.openRun({
    program: `id-gate-${storedRunPrograms}`, title: 'id gate', project: 'demo', wave: 1, waveOf: 2,
    claimedBy: r.claimedBy,
    ...(r.kind === undefined ? {} : { kind: r.kind }),
    ...(r.reviews === undefined ? {} : { reviews: r.reviews }),
  });
  if (!('id' in opened)) throw new Error(`storedRun: openRun refused: ${JSON.stringify(opened)}`);
  const { id } = opened;
  if (r.sessionId !== null) {
    if (r.state === 'planned') coord.setSession(id, r.sessionId);
    else coord.markDispatched(id, r.sessionId, r.sessionId, `ws/${r.sessionId}`, false);
  }
  if (r.state === 'planned') return id;
  const kind = r.kind ?? 'work';
  const walk = STORED_RUN_WALK[kind];
  const stop = walk.indexOf(r.state);
  if (stop < 0) throw new Error(`storedRun: a ${kind} run cannot be parked in ${r.state}`);
  for (const to of walk.slice(0, stop + 1)) {
    const adv = coord.advance(id, to, 'coordinator');
    if (!adv.ok) throw new Error(`storedRun: could not reach ${r.state}: ${JSON.stringify(adv)}`);
  }
  return id;
}
