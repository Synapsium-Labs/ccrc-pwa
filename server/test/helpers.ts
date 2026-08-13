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
 * exactly — transcribed from `shared/api.ts`'s `ACCOUNTS` literal, in its
 * declaration order, before Task 6 deleted it.
 *
 * That literal is gone, so this is the ROOT copy of the production account
 * names in TypeScript, and deliberately so: it is TEST data, under a directory
 * the roster-drift scanner (`single-definition.test.ts`) does not scan — and
 * that scanner now reads its own list of wrapper names FROM here, because the
 * roster it hunts for copies of no longer exists in any source file it could
 * trust to read them from.
 *
 * KEEP IT IN STEP WITH `deploy/accounts.migration.json` — this fleet's five
 * real accounts: same ids, same declaration order, same config-dir suffixes,
 * home-able flags, hues and `exec` shapes — not with whatever any one test
 * happens to need. NOT with `deploy/accounts.default.json`, which is the
 * single-`claude` fresh-install roster this fixture is deliberately NOT (first
 * paragraph). An earlier version of this comment named `accounts.default.json`
 * here and so contradicted itself two paragraphs up; that correction also
 * inverted the `label` claim it made, so here is the measured truth against
 * `deploy/accounts.migration.json`: `label` DIVERGES from the migration
 * roster for three of the five accounts — `claude`, `claude-corp` and
 * `claude-dev0` all use their own id as the test label here, where
 * production's real label is `team·max`, `team·shared` and `lab·dev0`
 * respectively. It MATCHES for the other two, `claude2` (`alt·max`) and
 * `gpt` (`gpt`). `claude2` is the one worth a second look — see the note on
 * it below — not because it diverges, but for the opposite reason: it is the
 * only entry here whose label is NOT its own id, and that is what lets it
 * agree with production instead of by coincidence.
 *
 * ROOT, AND THE ONLY OTHER COPY IS DERIVED FROM IT.
 * `test/fixtures/ccdMirror.ts` DERIVES its ids, config dirs and home-able
 * flags from this object — adding only the two concepts ccd has and the roster
 * does not, `label` (statusline's display string) and `ccdValid` — and throws
 * at import if the two disagree, so it cannot drift. It STAYS: Task 9
 * considered deleting it once its last reader grew a generated-bash ⇄ server
 * TypeScript round-trip, and ruled against, because that round-trip checks
 * per-input agreement while the four describes still reading this fixture
 * check ccd's whole bash ANSWER SPACE against the roster in both directions —
 * a different property neither replaces. The ruling is recorded in
 * `ccdMirror.ts`'s own header.
 *
 * `pwa/src/lib/accounts.ts`'s `PRODUCTION_ROSTER` — the one genuinely
 * independent hand-typed copy, the thing the PWA could not yet get off the
 * wire — is GONE, deleted in Task 7. `single-definition.test.ts` no longer
 * names it as the single allowed holder: it asserts `toEqual([])`, i.e. NO
 * shipped source file under the four scanned roots holds a compile-time copy
 * of the roster at all. */
export const DEFAULT_TEST_ROSTER = {
  version: 1,
  accounts: [
    {
      id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    },
    {
      // The one account whose LABEL IS NOT ITS ID, deliberately (M9, final
      // review), and it is `alt·max` because that is genuinely this
      // account's label in `deploy/accounts.migration.json`. Every other entry
      // here labels itself with its own id, which made `label` and `id`
      // indistinguishable on the wire: `accounts-route.test.ts`'s roster
      // assertion would have passed just the same if the handler had emitted
      // `a.id` for `label`, and the PWA renders `label`. One discriminating
      // row is enough to make that assertion able to fail.
      id: 'claude2', label: 'alt·max', configDirSuffix: '.claude-personal',
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
