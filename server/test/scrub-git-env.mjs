// The test runner's ONE scrub of git's repository-redirecting variables from ITS OWN environment.
// Only `node:` builtins are imported, so the vitest main process (globalSetup), every worker (setupFiles) and a
// bare-`node` child can all load it.
//
// WHY: git honours GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE over the working directory, and `git init` re-initialises
// the repository GIT_DIR names. A runner started with any of them exported (from a git hook, an alias, a shell that
// sourced a repository's environment) turned every fixture `git init` + `git config` + `git checkout -B` in a mkdtemp
// dir into a write against that REAL repository: bare flag flipped, fixture identity written, fixture branches and
// refs created, a real branch moved. `gitEnvStrip.ts` guards the spawns that opt in with `inheritedEnv()`; this
// closes the other ~200 call sites at the root by removing the variables before any test code or any child spawn.
//
// The list is `git rev-parse --local-env-vars` on git 2.43.0 (the floor; `gitEnvStrip.ts` unions in what the live git
// prints) plus GIT_NAMESPACE (scopes every ref read and write) and the numbered GIT_CONFIG_KEY_<n>/VALUE_<n> pairs.
// Kept on purpose: GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM (some suites set them for isolation), GIT_CEILING_DIRECTORIES
// and GIT_DISCOVERY_ACROSS_FILESYSTEM (they only narrow repository discovery, so they fail safe: a fixture directory
// finds no outer repository, never the wrong one).
// A test that WANTS one of these hands it to a child through that spawn's explicit `env`; process.env is never the route.

export const GIT_LOCAL_ENV_FLOOR = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
];

const DROP = new Set([...GIT_LOCAL_ENV_FLOOR, 'GIT_NAMESPACE']);

/** True for a name the scrub removes (beyond the floor, which `extra` carries). */
export function isGitRedirectVar(name, extra = []) {
  return DROP.has(name) || extra.includes(name) || name.startsWith('GIT_CONFIG_KEY_') || name.startsWith('GIT_CONFIG_VALUE_');
}

/** Deletes the redirecting variables from `env` (default process.env) in place; returns the names it removed. */
export function scrubGitEnv(env = process.env) {
  const removed = [];
  for (const k of Object.keys(env)) {
    if (isGitRedirectVar(k)) { delete env[k]; removed.push(k); }
  }
  return removed;
}
