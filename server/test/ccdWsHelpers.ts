// The isolated-HOME harness every ccd test file uses. HOME is the ONLY isolation
// boundary ccd has: PROJECTS_ROOT and WORKTREES_ROOT derive from it and take no
// environment override, which is what stops a unit test pointing
// `git worktree remove` or `git branch -d` at a real repository.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export const CCD = path.resolve(__dirname, '../../../ccrc-portability/ccd');

/** ws-add spawns a session; tmux is not available under test, so stub _spawn and
 *  the systemd call. Everything else runs for real. `tmux` is shadowed too,
 *  unconditionally: nothing in ws-add reaches it today, and this is what keeps
 *  that true if something ever does. */
export const WS_ADD = `_spawn() { :; }; _ws_supervise() { :; }; tmux() { :; };`;

export interface CcdHarness {
  home: string;
  sh(snippet: string, env?: NodeJS.ProcessEnv): string;
  reg(id: string, field: string): string | null;
  calls(): string[];
  makeRepo(name: string): string;
  /** Like `makeRepo`, but with an origin `ccd`'s `_gh_repo_slug` resolves to
   *  `<slug>` — required by every pr-state/pr-open/ws-audit/ws-reap test. */
  makeGhRepo(name: string, slug?: string): string;
  git(cwd: string, ...args: string[]): string;
  cleanup(): void;
}

export function makeCcdHarness(prefix: string): CcdHarness {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const w of ['claude', 'claude2', 'claude-corp']) {
    fs.writeFileSync(path.join(bin, w), '#!/bin/sh\n', { mode: 0o755 });
  }

  const gitEnv = (): NodeJS.ProcessEnv => ({
    ...process.env, HOME: home,
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x',
    GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x',
  });

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv() }).trim();

  /** A real git repo with one commit and an origin, so worktree/base logic is
   *  exercised for real rather than mocked. */
  const makeRepoAt = (name: string): string => {
    const origin = path.join(home, 'origins', `${name}.git`);
    const main = path.join(home, 'projects', name);
    execFileSync('git', ['init', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['init', '-b', 'main', main]);
    fs.writeFileSync(path.join(main, 'README.md'), 'hi\n');
    git(main, 'add', 'README.md');
    git(main, 'commit', '-m', 'init');
    git(main, 'remote', 'add', 'origin', origin);
    git(main, 'push', '-u', 'origin', 'main');
    git(main, 'remote', 'set-head', 'origin', '-a');
    return main;
  };

  return {
    home,
    // `cwd: home` is part of the isolation, not a convenience. Without it the
    // snippet inherits vitest's cwd — `infra/ccrc/server` — so any ccd path that
    // resolves a RELATIVE path writes into the repository. Measured: the hostile
    // -CDPATH ws-add case makes `$common` two lines long, and `mkdir -p
    // "$common/info"` then created 74 directories under `server/`, two of them
    // holding a real `.git/info/exclude`. `git status` cannot see them (the tree
    // walk skips a component named `.git`, and empty dirs are unreported), so
    // the suite littered the checkout invisibly and `git add -A` would have
    // committed newline-bearing paths. HOME is only the ONLY boundary this file
    // claims if the process starts inside it.
    sh: (snippet, env = {}) =>
      execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
        { encoding: 'utf8', cwd: home, env: { ...process.env, HOME: home, ...env } }).trim(),
    reg: (id, field) => {
      const p = path.join(home, '.cc-sessions', `${id}.${field}`);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
    },
    calls: () => {
      const p = path.join(home, 'ccd-calls');
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
    },
    makeRepo: makeRepoAt,
    /** A repo that reads as GitHub and behaves as a local bare repo.
     *
     *  `_gh_repo_slug` reads `remote.origin.url` and requires OWNER/NAME, so a
     *  bare local path (what `makeRepo` sets) makes it return non-zero and
     *  every PR verb answer `no-remote`. Three keys:
     *    - `url`      -> the https string `_gh_repo_slug` parses
     *    - `insteadOf`-> rewrites fetch AND push back to the local bare repo.
     *      Without it `cmd_ws_add`'s `git fetch origin` (ccd:269) and
     *      `_ws_reap_eval`'s mandatory fetch would both leave the box for the
     *      real github.com. `git config --get remote.origin.url` is NOT
     *      affected by insteadOf, which is the whole point.
     *    - `pushurl`  -> the same bare repo, said out loud. Measured: insteadOf
     *      alone already routes the push locally, so this is not what makes
     *      pr-open's "the branch really landed in $HOME/origins/demo.git" work
     *      — it is here so `git remote -v` names the push target without the
     *      reader having to reason about rewrite precedence.
     *  Configured AFTER the initial push/set-head, so the repo is built with
     *  a plain local origin exactly as makeRepo builds it. */
    makeGhRepo: (name, slug = 'o/r') => {
      const main = makeRepoAt(name);
      const origin = path.join(home, 'origins', `${name}.git`);
      git(main, 'config', 'remote.origin.url', `https://github.com/${slug}`);
      git(main, 'config', `url.${origin}.insteadOf`, `https://github.com/${slug}`);
      git(main, 'config', 'remote.origin.pushurl', origin);
      return main;
    },
    git,
    cleanup: () => { fs.rmSync(home, { recursive: true, force: true }); },
  };
}
