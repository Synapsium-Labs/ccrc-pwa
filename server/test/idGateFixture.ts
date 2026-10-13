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
