import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isExecAllowed } from '../../agent/src/whitelist.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { wireCmd } from '../src/remote/runner.js';
import type { Deps } from '../src/server.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { mkTmp } from './tmpHelpers.js';
// Re-exported from the leaf module so ccdWsHelpers.ts (and anything else that
// only needs the roster) does not transitively pull in config.ts → shared/api.ts.
export { DEFAULT_TEST_ROSTER } from './helpers/roster.js';
import { DEFAULT_TEST_ROSTER } from './helpers/roster.js';

/**
 * The TEST default roster lives in `./helpers/roster.ts` — a leaf module that
 * imports nothing from server/src, so test files that only need the roster
 * (ccdWsHelpers.ts) do not transitively reach shared/api.ts. Re-exported
 * above. The full docblock is in the leaf.
 */

/** Every `loadConfig({ CCRC_HOME: home })` needs this first — `loadConfig`
 *  refuses to boot without a roster, by design (`RosterError`, naming the
 *  remedy, rather than an empty or partial fleet). */
export function seedRoster(home: string, roster: unknown = DEFAULT_TEST_ROSTER): void {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'accounts.json'), JSON.stringify(roster, null, 2));
}

/**
 * Layer 1: every runner used in a server test crosses the agent's real
 * whitelist first. Applying `wireCmd` is load-bearing — call sites pass
 * `cfg.ccdBin`, an absolute path, and `isExecAllowed` rejects any cmd
 * containing '/'. Free coverage on every existing route test.
 */
export const guardRunner = (inner: Runner): Runner => async (cmd, args) => {
  const wire = wireCmd(cmd);
  if (!isExecAllowed(wire, args)) {
    throw new Error(`argv not in the agent EXEC_WHITELIST: ${wire} ${args.join(' ')}`);
  }
  return inner(cmd, args);
};

/** Deps against a throwaway fixture home; default runner fails every exec (all sessions dead).
 *
 *  Both capabilities `Deps` carries are built from the SAME guarded runner:
 *  `runCcd` composes it through `ccdRunner`, `Tmux` gets it by constructor
 *  injection. Guarding at the `Runner` level rather than at `CcdRunner`'s is
 *  what lets one guard cover both paths — `routes.test.ts`'s two wiring tests
 *  pin each use site independently. */
export function testDeps(
  home: string = mkTmp('ccrc-'),
  run: Runner = async () => ({ code: 1, stdout: '', stderr: '' }),
): Deps {
  const guarded = guardRunner(run);
  seedRoster(home);
  const cfg = loadConfig({ CCRC_HOME: home });
  return { cfg, runCcd: ccdRunner(guarded, cfg), tmux: new Tmux(guarded), io: localIO, queue: new KeyedQueue() };
}
