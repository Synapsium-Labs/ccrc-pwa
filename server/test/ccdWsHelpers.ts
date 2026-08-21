// The isolated-HOME harness every ccd test file uses. HOME is the ONLY isolation
// boundary ccd has: PROJECTS_ROOT and WORKTREES_ROOT derive from it and take no
// environment override, which is what stops a unit test pointing
// `git worktree remove` or `git branch -d` at a real repository.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { parseRoster } from '../../shared/roster.js';
import { generateAccountsSh } from '../../shared/generate.mjs';

/** The home-able ids of the test roster — the set ccd reads as `CCRC_HOME_ABLE`
 *  out of the roster `seedAccountsSh` writes below. Derived, not hand-typed,
 *  for the same reason `single-definition.test.ts`'s scanner is: a copy frozen
 *  at write time stops tracking the roster the moment a home-able account is
 *  added or removed. */
const HOME_ABLE_WRAPPERS: readonly string[] =
  DEFAULT_TEST_ROSTER.accounts.filter((a) => a.homeAble).map((a) => a.id);

export const CCD = path.resolve(__dirname, '../../ccd/ccd');

/** How many lines BACK of source `ccd-workspaces.test.ts`'s bash-spawn scan
 *  reads to find a call site's `ghContainedEnv(...)` and its opts — single-
 *  sourced here so `ccd-harness-containment.test.ts`'s own self-check (the
 *  SYSTEMD-OPT-OUT marker must stay within this many lines of the spawn
 *  lines it exempts) can never drift from the number the scan itself uses.
 *  Two conditions the scan cannot currently tell apart — "this call site
 *  really lacks containment" and "the marker fell out of the window" — must
 *  not silently start disagreeing about where the window ends. */
export const SCAN_LOOKBACK_LINES = 12;

/**
 * Writes `<home>/.ccrc/accounts.sh` — the generated roster `ccd` sources on the
 * line after it defines `die`, and the FIRST thing any fixture home needs,
 * because ccd now dies with a remedy rather than running against a roster that
 * is not the box's. Sourcing ccd without this file does not produce a failing
 * assertion; it produces a non-zero `execFileSync` and an opaque
 * `ccd: no account roster…` on stderr.
 *
 * Generated, never hand-written, for the reason the whole stage-2a plan
 * exists: a fixture `accounts.sh` typed out here would be a fourth copy of the
 * roster, and it would be the copy that decides what every ccd test believes.
 * `parseRoster` runs first so the fixture crosses the same validation a real
 * `~/.ccrc/accounts.json` does — a test roster that the production loader
 * would reject is not a test of anything.
 *
 * The marker `shared/mark.mjs` adds is deliberately absent: it is provenance
 * for a human reading a deployed file, and ccd neither reads nor cares.
 */
export function seedAccountsSh(home: string, roster: unknown = DEFAULT_TEST_ROSTER): void {
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ccrc', 'accounts.sh'), generateAccountsSh(parseRoster(roster)));
}

/** ws-add spawns a session; tmux is not available under test, so stub the spawn
 *  and the systemd calls. Everything else runs for real. `tmux` is shadowed
 *  too, unconditionally: nothing in ws-add reaches it today, and this is what
 *  keeps that true if something ever does.
 *
 *  THE SET IS THE THREE TOGETHER. `_supervised_start` is here even though
 *  `cmd_ws_add` does not call it, because stubbing the systemd PROBE alone is
 *  insufficient: reporting "no systemd" sends `_supervised_start` down its
 *  fallback into a REAL `_spawn`. */
export const WS_ADD =
  `_spawn() { :; }; _spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; };`
  + ` _ws_supervise() { :; }; _supervised_start() { :; }; tmux() { :; };`;

/** THE VARIANT THE ORDERING PINS NEED: `_spawn_start` and `_spawn_settle` stay
 *  REAL, so §1.1's "the claim and the supervision precede anything that can
 *  block" is an assertion rather than an assumption. Three things are stubbed:
 *
 *   - `tmux`            — no tmux under test.
 *   - `_accept_first_run_prompts` — the settle's 450-poll gate loop; RC is the
 *     fixture's input via $ACCEPT_RC.
 *   - `_ws_supervise`   — a RECORDING stub, readable through `h.calls()`, and
 *     this one is a SAFETY RULE, not convenience: left real it would
 *     `systemctl --user enable --now claude-session@<id>` against the live user
 *     manager, write a PERSISTENT default.target.wants symlink, and start a
 *     Restart=always supervise loop against a vitest tmpdir — while swallowing
 *     its own error, so the test would pass green. (The harness's contained
 *     systemctl is the structural backstop; this is what makes ORDERING
 *     assertable, because a real systemctl writes nothing into the fixture.)
 *   - `_supervised_start` — the third member of the set: reporting "no systemd"
 *     sends it down its fallback into a REAL spawn. */
export const WS_ADD_REAL_SPAWN = `
  _ws_supervise() { echo "supervise $1" >> "$HOME/ccd-calls"; };
  _supervised_start() { echo "supervised_start $1" >> "$HOME/ccd-calls"; return 0; };
  _accept_first_run_prompts() { echo "accept $*" >> "$HOME/ccd-calls"; return \${ACCEPT_RC:-0}; };
  sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "\$1" in
      new-session)  : > "\$HOME/pane-up" ;;
      kill-session) rm -f "\$HOME/pane-up" ;;
      has-session)  [[ -e "\$HOME/pane-up" ]] ;;
      capture-pane) printf '%s' "\${PANE_TEXT:-? for shortcuts}" ;;
    esac
  };`;

/** THE HARNESS'S PATH-STUB DIRECTORY, and the FIRST entry of every PATH
 *  `ghContainedEnv` returns. Whatever this directory holds cannot be displaced
 *  by a caller-supplied PATH, which is what makes the `gh` poison structural.
 *
 *  So a CCD test that needs a FUNCTIONAL `tmux`/`systemctl` on PATH (the two
 *  `runCcd` idioms, which must survive `exec`) writes it HERE, where it
 *  REPLACES the poison file instead of racing it.
 *
 *  It is NOT "the one stub directory in the suite", and reading it that way is
 *  what broke five `ccrc status` tests: a consumer that never runs ccd
 *  (`ccrc-doctor.test.ts`) keeps its own `<home>/stub-bin`, and only the
 *  poisons this file actually plants can shadow what is in it. That set is `gh`
 *  for every caller, plus systemd for a caller that ASKS — see
 *  `ghContainedEnv`. */
export function harnessBin(home: string): string {
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  return bin;
}

/**
 * THE SECOND ISOLATION BOUNDARY, beside HOME: a `gh` that logs its argv and
 * refuses, first on the PATH of every snippet that sources ccd.
 *
 * `/usr/bin/gh` is installed on this box and `~/.config/gh/hosts.yml` holds a
 * real `gho_` token with repo WRITE scope. Isolating HOME does not close it —
 * `GH_TOKEN`/`GH_HOST`/`GH_CONFIG_DIR` are inherited from the parent env, and
 * even an unauthenticated call still leaves the box. So this is a property of
 * the harness rather than a rule each test file remembers: `makeGhRepo` makes
 * every PR verb functional from the BASE harness, so any ccd test file can grow
 * a gh call. Measured before it moved here: a bare
 * `makeCcdHarness(…).sh('_gh_pr_list o/r')` ran `/usr/bin/gh`.
 *
 * Exported because two ccd test files (`ccd-limits`, `ccd-clip`) predate
 * `makeCcdHarness` and build their own HOME; containment cannot be structural
 * in one harness while a second one exists beside it. A shell-function stub
 * (`GH_STUB`) still wins over this — bash resolves functions before PATH — so
 * this is what answers when a snippet has no stub.
 *
 * `gh` IS THE WHOLE UNCONDITIONAL PART, and the function's name is the whole
 * promise. `opts.systemd` adds the SECOND poison (below) for callers that run
 * ccd, and it defaults OFF: this function is imported by files that run no ccd
 * at all, and anything planted here lands in a directory it PREPENDS — so an
 * unconditional systemd poison displaces the `systemctl` such a file planted on
 * its own PATH, in a directory the create-if-absent guard below can never see.
 * Measured: planting it unconditionally took `ccrc-doctor.test.ts` from 170/170
 * to 165/170, and every failure named `ccrc status`, three files from the edit.
 */
export interface ContainOpts {
  /** Plant the `systemctl`/`systemd-run` poisons too. ASK FOR THIS IF THE SPAWN
   *  RUNS ccd: every path that can reach `_have_systemctl` or
   *  `_supervised_start` needs it, `makeCcdHarness` asks on behalf of every test
   *  that goes through the harness, and `ccd-workspaces.test.ts`'s source scan
   *  is what says so for the call sites that build their own env. */
  systemd?: boolean;
  /** Plant the `tmux` poison. ASK FOR THIS IF THE SNIPPET CAN REACH `_lc_obs`,
   *  which is every ccd path once wave 2 lands: `_lc_obs` runs
   *  `tmux list-panes -a` and neither `HOME` nor `TMUX_TMPDIR` is isolated by
   *  this harness, so the uncontained call reads the operator's LIVE server.
   *  Same create-if-absent shape as systemd, for the same displaceability
   *  reason, and a bash FUNCTION stub still wins over both. */
  tmux?: boolean;
}

export function ghContainedEnv(
  home: string, env: NodeJS.ProcessEnv = {}, opts: ContainOpts = {},
): NodeJS.ProcessEnv {
  const bin = harnessBin(home);
  fs.writeFileSync(path.join(bin, 'gh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/gh-poison"\n'
    + 'echo "ccd tests must never reach the real gh" >&2\nexit 97\n', { mode: 0o755 });
  // Everything below is the SYSTEMD boundary, and it happens only for a caller
  // that asked. OPT-IN, not opt-out: a default-on poison is invisible to the
  // consumer it hurts, because the damage shows up as a wrong ANSWER in a file
  // that never mentioned systemd (see the header). Opt-in makes the widening
  // land at the call site, where the reviewer of that call site can see it.
  if (!opts.systemd && !opts.tmux) return { ...env, PATH: `${bin}:${env['PATH'] ?? ''}` };
  // THE SECOND STRUCTURAL BOUNDARY for the ccd runners, and the reason it is a
  // poison rather than an absence: `_have_systemctl` is `command -v systemctl`,
  // so REMOVING systemctl would send every ccd test down `_supervised_start`'s
  // no-systemd fallback — a different code path, silently. This one exists,
  // records, and refuses.
  //
  // CREATE-IF-ABSENT, unlike the `gh` poison above, AND THE ASYMMETRY IS THE
  // POINT. This function runs on EVERY `sh()` (see `makeCcdHarness`'s `sh:`),
  // so an unconditional write re-plants itself between two calls. `gh` WANTS
  // that — the host token has repo WRITE scope and nothing may displace it.
  // systemd must be displaceable: `ccd-supervised-start.test.ts` and
  // `ccd-archive.test.ts` MODEL the unit through a functional
  // `systemctl --user enable --now` that touches `$HOME/pane-up`, and their
  // `runCcd` writes that stub BEFORE this function is evaluated in its `opts`
  // literal. Re-planting would break both suites and read as a mystery.
  //
  // That guard only answers WITHIN this directory, which is why it did not
  // save `ccrc-doctor.test.ts`: its `systemctl` lives in `<home>/stub-bin`, so
  // there was nothing here to be absent, and the poison won on ordering alone.
  // Displaceability inside `harnessBin` and remit outside it are two different
  // questions, and only the second one has an answer that helps a stranger.
  //
  // `systemd-run`'s exit code is the ONE thing a test may steer, through
  // $SYSTEMD_RUN_RC, and it DEFAULTS TO 97 so every existing case is unchanged.
  // `_tmux_server_ensure` is `systemd-run … || tmux start-server`, and with a
  // poison that can only ever fail, nothing proved the `||` was load-bearing —
  // deleting the fallback and deleting the systemd-run call are both green
  // against a refusal-only stub. A test that makes it SUCCEED is the negative
  // control. Steering the rc keeps the containment structural: the stub still
  // records, and a real `systemd-run` is unreachable at every value.
  for (const [name, log, rc, want] of [
    ['systemctl', 'systemctl-calls', 'rc=97', !!opts.systemd],
    ['systemd-run', 'systemd-run-calls', 'rc=${SYSTEMD_RUN_RC:-97}', !!opts.systemd],
    // `_lc_obs`'s only shelled read. It must EXIST and REFUSE rather than be
    // absent: `_lc_obs` branches on `command -v tmux`, so removing tmux would
    // send every lifecycle test down the `no-tmux` arm silently — a different
    // answer, reached by a different path, with nothing saying so.
    ['tmux', 'tmux-calls', 'rc=${TMUX_STUB_RC:-97}', !!opts.tmux],
  ] as const) {
    if (!want) continue;
    const p = path.join(bin, name);
    if (fs.existsSync(p)) continue;
    fs.writeFileSync(p,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${log}"\n${rc}\n`
      // The refusal message is conditional on actually refusing: at rc 0 the
      // stub is standing in for a systemd that WORKED, and a line saying
      // otherwise would send the next reader looking for a failure.
      + '[ "$rc" = 0 ] || echo "ccd tests must never reach the real user manager" >&2\nexit "$rc"\n',
      { mode: 0o755 });
  }
  // Prepended to whatever the caller passed, never the other way round: a
  // snippet that supplies its own PATH must not be able to displace the poison,
  // which is the difference between structural and advisory.
  return { ...env, PATH: `${bin}:${env['PATH'] ?? ''}` };
}

/** The one reader every append-only call log in this file goes through: absent
 *  file == no calls, and blank lines are not calls. */
const readLines = (p: string): string[] =>
  fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];

/** Every argv the poisoned `gh` at `<home>` saw. */
export const ghPoisonAt = (home: string): string[] => readLines(path.join(home, 'gh-poison'));

export interface CcdHarness {
  home: string;
  sh(snippet: string, env?: NodeJS.ProcessEnv): string;
  reg(id: string, field: string): string | null;
  calls(): string[];
  /** Every argv the POISONED `gh` saw — i.e. every gh call that was not
   *  shadowed by a stub shell function. In a test that means to reach gh at all
   *  this is the assertion that it reached OURS; in every other test it must be
   *  empty. */
  ghPoison(): string[];
  /** Every argv the contained `systemctl` saw — i.e. every systemd call that
   *  was not shadowed by a stub shell function. */
  systemctlCalls(): string[];
  /** Every argv the contained `systemd-run` saw (`_tmux_server_ensure`). */
  systemdRunCalls(): string[];
  /** Every argv the contained `tmux` saw (`_lc_obs`'s `list-panes`). */
  tmuxCalls(): string[];
  makeRepo(name: string): string;
  /** Like `makeRepo`, but with an origin `ccd`'s `_gh_repo_slug` resolves to
   *  `<slug>` — required by every pr-state/pr-open/ws-audit/ws-reap test. */
  makeGhRepo(name: string, slug?: string): string;
  git(cwd: string, ...args: string[]): string;
  cleanup(): void;
}

export function makeCcdHarness(prefix: string): CcdHarness {
  const home = mkTmp(prefix);
  // BEFORE anything else: sourcing ccd without a roster is fatal by design, so
  // a harness that built its directories first and its roster last would fail
  // every snippet with a stderr message instead of a test result.
  seedAccountsSh(home);
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  // The wrappers a bare binary on $PATH must exist for (`_account_ok`'s
  // `-x "$WRAPPER_DIR/$w"` check, `_spawn`'s `command -v "$w"`): the roster's
  // home-able set, i.e. exactly ccd's `CCRC_HOME_ABLE`. A non-home-able account
  // deliberately gets NO stub — an opt-in lane nobody installed is the ordinary
  // state of a box, and `ccd-account-ok.test.ts` asserts `_account_ok gpt` is
  // false straight out of this harness for exactly that reason.
  for (const w of HOME_ABLE_WRAPPERS) {
    fs.writeFileSync(path.join(bin, w), '#!/bin/sh\n', { mode: 0o755 });
  }

  // Beside HOME, and for the same reason — see `ghContainedEnv` above. THIS
  // harness runs ccd, so it asks for the systemd boundary too, here and on
  // every `sh()` below: that is what makes "every test that can reach
  // `_supervised_start` is contained" a property of the harness rather than a
  // rule each ccd test file remembers.
  ghContainedEnv(home, {}, { systemd: true, tmux: true });

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
        { encoding: 'utf8', cwd: home,
          env: ghContainedEnv(home, { ...process.env, HOME: home, ...env }, { systemd: true, tmux: true }) }).trim(),
    reg: (id, field) => {
      const p = path.join(home, '.cc-sessions', `${id}.${field}`);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
    },
    calls: () => readLines(path.join(home, 'ccd-calls')),
    ghPoison: () => ghPoisonAt(home),
    systemctlCalls: () => readLines(path.join(home, 'systemctl-calls')),
    systemdRunCalls: () => readLines(path.join(home, 'systemd-run-calls')),
    tmuxCalls: () => readLines(path.join(home, 'tmux-calls')),
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
