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

/**
 * The TEST default roster — deliberately NOT the single-`claude` roster a
 * fresh install ships (`deploy/accounts.default.json`, Task 10 of the
 * stage-2a plan). Over twenty files under `server/test/` exercise `claude2`,
 * `claude-corp`, `claude-dev0` and `gpt` by id (`dialog.test.ts` resolves
 * `configDirFor(cfg, 'claude2')` and expects a real path back, for example),
 * so the test default has to mirror today's five production accounts
 * exactly — built here from `shared/api.ts`'s `ACCOUNTS` literal, in its
 * declaration order, rather than invented fresh. `shared/api.ts` still owns
 * the live roster in this task (Task 6 removes it); this is a parallel,
 * independent copy for tests only. */
export const DEFAULT_TEST_ROSTER = {
  version: 1,
  accounts: [
    {
      id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    },
    {
      id: 'claude2', label: 'claude2', configDirSuffix: '.claude-personal',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/claude2-oauth.env' },
      homeAble: true, hue: 'violet', telemetry: 'anthropic',
    },
    {
      id: 'claude-corp', label: 'claude-corp', configDirSuffix: '.claude-corp',
      exec: { kind: 'generated' }, homeAble: true, hue: 'blue', telemetry: 'anthropic',
    },
    {
      id: 'gpt', label: 'gpt', configDirSuffix: '.claude-gpt',
      exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none',
    },
    {
      id: 'claude-dev0', label: 'claude-dev0', configDirSuffix: '.claude-dev0',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/claude-dev0-oauth.env' },
      homeAble: true, hue: 'green', telemetry: 'anthropic',
    },
  ],
};

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
