// The reclaim and expire suites' ONE strip of git's inherited environment
// (child-reclamation spec §5.6). Spread `inheritedEnv()` wherever a
// fixture would spread `process.env`, and hand it to every git spawn that would
// otherwise name no env: an inherited GIT_DIR, GIT_WORK_TREE or
// GIT_INDEX_FILE (a runner started under a git hook) outranks every
// `git -C <dir>`, so the fixture would init, commit and reclaim in ANOTHER
// repository. NEVER put this inside `ghContainedEnv`: its callers pass git
// variables to ccd on purpose (the containment CONTROLs), and only the
// INHERITED environment is stripped. GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM
// are not on git's list and are kept (spec §5.6: a stated residual).
// The strip is repository-clean, not HOME-clean. A git spawn handed
// `inheritedEnv()` keeps the runner's HOME, so the runner's own global git
// config (init.templateDir, core.hooksPath, commit.gpgsign, url.insteadOf)
// still reaches the repository it makes; and a kept GIT_CONFIG_GLOBAL or
// GIT_CONFIG_SYSTEM outranks a fixture HOME's global config at every `h.sh`
// and `h.git` too. Two more kept variables outside git's local list reach
// the fixture repositories the same way:
// GIT_TEMPLATE_DIR (the environment twin of init.templateDir, so a runner's
// template hooks reach every `git init` here) and GIT_EXEC_PATH (the
// directory git runs its own subcommands from). A stated harness residual.
import { execFileSync } from 'node:child_process';

/** `git rev-parse --local-env-vars` on git 2.43.0, the fleet box's git: the
 *  floor, so an older git that prints fewer names strips no less. */
export const GIT_LOCAL_ENV_FLOOR: readonly string[] = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
];

let live: readonly string[] | undefined;
/** What THIS box's git calls local — asked once, with PATH alone, so an
 *  inherited GIT_DIR cannot change the answer (it needs no repository). */
export function gitLocalEnvVars(): readonly string[] {
  if (live === undefined) {
    live = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } })
      .split('\n').filter(Boolean);
  }
  return live;
}

/** A COPY of process.env minus git's local list (the floor and this box's),
 *  GIT_NAMESPACE (not on the list; it scopes every ref read and write) and every
 *  GIT_CONFIG_KEY_<n>/GIT_CONFIG_VALUE_<n> entry. */
export function inheritedEnv(): NodeJS.ProcessEnv {
  const drop = new Set([...GIT_LOCAL_ENV_FLOOR, ...gitLocalEnvVars(), 'GIT_NAMESPACE']);
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (drop.has(k) || k.startsWith('GIT_CONFIG_KEY_') || k.startsWith('GIT_CONFIG_VALUE_')) continue;
    env[k] = v;
  }
  return env;
}
