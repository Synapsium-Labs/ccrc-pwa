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

  return {
    home,
    sh: (snippet, env = {}) =>
      execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
        { encoding: 'utf8', env: { ...process.env, HOME: home, ...env } }).trim(),
    reg: (id, field) => {
      const p = path.join(home, '.cc-sessions', `${id}.${field}`);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
    },
    calls: () => {
      const p = path.join(home, 'ccd-calls');
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
    },
    /** A real git repo with one commit and an origin, so worktree/base logic is
     *  exercised for real rather than mocked. */
    makeRepo: (name) => {
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
    },
    git,
    cleanup: () => { fs.rmSync(home, { recursive: true, force: true }); },
  };
}
