// ws-archive / ws-restore / ws-attic and the caps list, under the isolated
// HOME harness. HOME is the only isolation boundary ccd has: PROJECTS_ROOT and
// WORKTREES_ROOT derive from it and take no override, which is what stops any
// of this reaching a real repository.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';
import { mungePath } from '../src/munge.js';

/** sha256 of the empty string — what a failed read used to be indistinguishable
 *  from, and what a genuinely empty ignored set still legitimately hashes to. */
const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-arch-'); });
afterEach(() => { h.cleanup(); });

/** ws-archive/ws-restore reach tmux and systemd; stub exactly those. The live
 *  status file is what `_ws_status` reads, so tests write it directly. */
const ARCH = `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };
  _ws_supervise() { echo "supervise $1" >> "$HOME/ccd-calls"; };
  _spawn() { echo "spawn $1 $2" >> "$HOME/ccd-calls"; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };
  _alive() { return 1; };`;

const shFail = (snippet: string, env?: NodeJS.ProcessEnv): { code: number; stdout: string; stderr: string } => {
  try { return { code: 0, stdout: h.sh(snippet, env), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

const workspace = (project: string, slug: string): string => {
  h.makeRepo(project);
  h.sh(`${WS_ADD} CCD_WS_SLUG=${slug} cmd_ws_add ${project}`);
  return path.join(h.home, 'worktrees', project, slug);
};

/** The dispatcher, run the way the box runs it: the real file as a PROGRAM, not a
 *  sourced copy. Nothing in the suite proved an arm calls the function it names —
 *  the caps parity test only checks that the arm exists — so `ws-archive` could
 *  have invoked cmd_ws_restore, or dropped its `shift`, and shipped green.
 *  tmux and systemctl are shadowed on PATH, which is the only way to stub a
 *  subprocess: `_alive`'s `tmux has-session` then fails, so _ws_status answers
 *  idle with no status file to write. */
const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const stub = path.join(h.home, 'stubbin');
  fs.mkdirSync(stub, { recursive: true });
  fs.writeFileSync(path.join(stub, 'tmux'),
    '#!/bin/sh\necho "tmux $*" >> "$HOME/ccd-calls"\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(stub, 'systemctl'),
    '#!/bin/sh\necho "systemctl $*" >> "$HOME/ccd-calls"\nexit 0\n', { mode: 0o755 });
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    env: { ...process.env, HOME: h.home, PATH: `${stub}:${process.env.PATH ?? ''}` },
  };
  try { return { code: 0, stdout: execFileSync('bash', [CCD, ...args], opts).trim(), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
  }
};

describe('the dispatcher', () => {
  it('routes each new verb to its OWN command, with argv shifted', () => {
    workspace('demo', 'quiet-basin');

    // ws-restore first, while the workspace is NOT archived: its own refusal
    // proves the arm reached cmd_ws_restore, and it stops before _spawn.
    const notArchived = runCcd('ws-restore', '--session', 'demo-quiet-basin');
    expect(notArchived.code).toBe(1);
    expect(notArchived.stderr).toMatch(/not archived: demo-quiet-basin/);

    // ws-attic: a rejected mode word can only come from cmd_ws_attic's case, and
    // only if `--frobnicate` arrived as $1 — i.e. the verb was shifted off.
    const badMode = runCcd('ws-attic', '--frobnicate', 'demo-quiet-basin');
    expect(badMode.code).toBe(1);
    expect(badMode.stderr).toMatch(/usage: ccd ws-attic/);

    // caps accepts no argv — and now SAYS so instead of printing the list
    // anyway. The arm shifts and forwards, so the guard can see what it was
    // given: `ccd caps --json` used to answer with the plain list at exit 0,
    // which is the one lie a capability probe must not tell.
    expect(runCcd('caps').stdout.split('\n')).toContain('ws-archive');
    const capsArgv = runCcd('caps', '--json');
    expect(capsArgv.code).toBe(1);
    expect(capsArgv.stderr).toMatch(/usage: ccd caps/);
    expect(capsArgv.stdout).toBe('');

    // ws-archive last, because it is the one that changes state. Without the
    // shift cmd_ws_archive sees three arguments and dies on its arity guard;
    // pointed at cmd_ws_restore it dies with "not archived".
    const arch = runCcd('ws-archive', '--session', 'demo-quiet-basin');
    expect(arch.stderr).toBe('');
    expect(arch.code).toBe(0);
    expect(arch.stdout).toMatch(/^archived demo-quiet-basin/);
    expect(h.reg('demo-quiet-basin', 'archived')).toMatch(/^\d+$/);
  });

  it('names every verb it dispatches in the usage line', () => {
    // The usage line is the only thing a mistyped verb prints, and reverting it
    // to its pre-Task-2 text was invisible to the whole suite.
    const r = runCcd();
    expect(r.code).toBe(1);
    for (const verb of ['caps', 'ws-archive', 'ws-restore', 'ws-attic']) {
      expect(r.stderr, verb).toContain(verb);
    }
  });
});

describe('ccd caps', () => {
  it('advertises exactly the verbs the dispatcher implements', () => {
    // The deployed ~/.local/bin/ccd is a COPY, not a symlink to the repo, so a
    // verb can pass the agent whitelist and still not exist on the box. This
    // list is what the agent reports; a list that drifts from the dispatcher
    // is worse than none, because the server would trust it.
    const src = fs.readFileSync(CCD, 'utf8');
    // Anchored on the dispatcher's own preamble, and the anchor's uniqueness is
    // asserted. `case "${1:-}" in` occurs TWICE — cmd_ws_gc's option parser
    // (ccd:995) comes first — so slicing from indexOf landed inside ws-gc, and
    // the arm regex missed ws-gc's arms only because they are indented four
    // spaces instead of two. That coincidence held the whole parity check up: one
    // re-indentation and this test would have compared the caps list against
    // ws-gc's flags.
    const guard = 'if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then';
    expect(src.split(guard).length - 1, 'exactly one dispatcher preamble').toBe(1);
    const block = src.slice(src.indexOf(guard));
    const dispatched = [...block.matchAll(/^ {2}([a-z][a-z|-]*)\)/gm)]
      .flatMap((m) => m[1]!.split('|'));
    const advertised = h.sh('cmd_caps').split('\n').filter(Boolean);
    expect([...advertised].sort()).toEqual([...new Set(dispatched)].sort());
  });
});

/** `_alive` true plus a pane pid, so `_ws_status` reads a real status file
 *  instead of short-circuiting on "no pane at all". */
const LIVE = ARCH
  .replace('_alive() { return 1; };', '_alive() { return 0; };')
  .replace('tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };',
           'tmux() { case "$1" in list-panes) echo 4242 ;; *) echo "tmux $*" >> "$HOME/ccd-calls" ;; esac; };');

const withStatus = (status: string): void => {
  const cfg = path.join(h.home, '.claude', 'sessions');
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, '4242.json'), JSON.stringify({ status, statusUpdatedAt: 1 }));
};

describe('_ws_stash_count', () => {
  it('counts the stashes belonging to that branch, read from $main', () => {
    const wt = workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    fs.writeFileSync(path.join(wt, 'README.md'), 'edited\n');
    h.git(wt, 'stash', 'push', '-m', 'work in progress');
    // A stash made in a LINKED worktree lives in the common ref store, which is
    // why the count is read from $main and still sees it — and why a stash is
    // work the reap must not delete.
    expect(h.sh(`_ws_stash_count "${main}" ws/quiet-basin`)).toBe('1');
    expect(h.sh(`_ws_stash_count "${main}" ws/other`)).toBe('0');
  });

  it('does not count a sibling branch whose name starts the same', () => {
    // The colon is part of the pattern, not punctuation: `On ws/quiet-basin`
    // without it is a prefix match, so a stash on `ws/quiet-basin-2` is counted
    // as this workspace's. Over-counting here refuses a legitimate reap, and the
    // refusal names stashes the user cannot find on this branch.
    const wt = workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    h.git(main, 'branch', 'ws/quiet-basin-2', 'main');
    h.git(wt, 'checkout', '-q', 'ws/quiet-basin-2');
    fs.writeFileSync(path.join(wt, 'README.md'), 'sibling work\n');
    h.git(wt, 'stash', 'push', '-m', 'sibling wip');
    expect(h.sh(`_ws_stash_count "${main}" ws/quiet-basin-2`)).toBe('1');
    expect(h.sh(`_ws_stash_count "${main}" ws/quiet-basin`)).toBe('0');
  });

  it('matches the branch name FIXED — a dot is not a wildcard', () => {
    // -F on both patterns, which is what the comment above them justifies.
    // Without it `On ws.quiet-basin:` is a regex matching the real
    // `On ws/quiet-basin:`, and an over-count here means refusing a legitimate
    // reap. Measured without -F: 1.
    const wt = workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    fs.writeFileSync(path.join(wt, 'README.md'), 'edited\n');
    h.git(wt, 'stash', 'push', '-m', 'work in progress');
    expect(h.sh(`_ws_stash_count "${main}" 'ws.quiet-basin'`)).toBe('0');
  });
});

describe('_transcript_path', () => {
  it('munges the workdir exactly as server/src/munge.ts does', () => {
    // The munge is the whole reason the helper exists, and the plan's stated
    // guarantee is that it matches mungePath. `tr './_' '---'` has to agree on
    // all three characters, so the fixture path carries all three — a real
    // workspace path has only slashes, and would let `tr '/' '-'` pass.
    const odd = '/tmp/proj.dir/some_thing/v1.2';
    h.sh(`_reg_set fake wrapper claude; _reg_set fake workdir '${odd}'; _reg_set fake uuid u-1`);
    expect(h.sh('_transcript_path fake'))
      .toBe(path.join(h.home, '.claude', 'projects', mungePath(odd), 'u-1.jsonl'));
  });

  it('refuses rather than assemble a path out of a missing field', () => {
    // The manifest records `transcript:""` when this fails, and that fallback is
    // only honest if a failure is what happens. Without the guard a missing uuid
    // yields `<cfg>/projects/<munged>/.jsonl` — a path that looks like a
    // measurement, points at nothing, and is what a reap would go looking for
    // after the registry is gone.
    h.sh(`_reg_set half wrapper claude; _reg_set half workdir /tmp/x`);
    const r = shFail('_transcript_path half');
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
  });
});

describe('_ws_ignored_digest', () => {
  it('is the sha256 of the ignored-entry SET, with directories collapsed', () => {
    const wt = workspace('demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, '.gitignore'), 'secrets/\n*.log\n');
    fs.mkdirSync(path.join(wt, 'secrets'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'secrets', 'creds.env'), 'k\n');
    fs.writeFileSync(path.join(wt, 'debug.log'), 'l\n');
    // `--ignored=matching` collapses `secrets/` to ONE entry — the whole reason
    // this is not `ls-files --others --ignored`, which enumerates per file
    // (measured 210,070 entries / 24.6 MB in custom-tools against an 8 MB agent
    // buffer). Pinning the exact preimage pins the collapse, the `!! ` filter and
    // the sort at once; asserting only "64 hex chars" would not.
    expect(h.sh(`_ws_ignored_digest "${wt}"`))
      .toBe(createHash('sha256').update('!! debug.log\n!! secrets/\n').digest('hex'));
  });

  it('separates a FAILED read from an empty one — both hash to sha256("")', () => {
    // Harmless while the digest is only recorded. A forgery the moment ws-reap
    // compares a stored digest against a live one to prove gitignored content is
    // unchanged: a failure on either side manufactures the match that authorises
    // the delete. The exit code is the only thing that can carry the difference,
    // because the two digests are equal by construction.
    const wt = workspace('demo', 'quiet-basin');
    const clean = shFail(`_ws_ignored_digest "${wt}"`);
    expect(clean.stdout.trim()).toBe(SHA256_EMPTY);
    expect(clean.code).toBe(0);                     // nothing ignored: a SUCCESS
    expect(shFail('_ws_ignored_digest /no/such/directory').code).not.toBe(0);
  });

  it('refuses an answer that is not a digest, however git exited', () => {
    // The exit code alone is not enough. git can succeed while the hashing half
    // of the pipeline does not — a sha256sum that is missing, or killed under
    // memory pressure — and the function would then print whatever landed on
    // stdout as though it were a measurement. The shape check is what makes the
    // manifest's `ignoredDigest` a digest or nothing.
    const wt = workspace('demo', 'quiet-basin');
    const r = shFail(`sha256sum() { echo "not-a-digest"; }; _ws_ignored_digest "${wt}"`);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
  });
});

describe('_ws_status', () => {
  it('reads ONLY "idle" as idle — shell, compacting and anything new are busy', () => {
    // server/src/livestate.ts:14-30 is this repo's own record of the wrapper's
    // vocabulary (`idle`, `busy`, and `shell` = a Bash tool command is running)
    // and of what matching `busy` and calling the rest idle cost when the
    // server side did it. An allowlist is the only polarity that survives a
    // vocabulary that grows.
    workspace('demo', 'quiet-basin');
    const seen = ['idle', 'busy', 'shell', 'compacting', 'somethingnew'].map((st) => {
      withStatus(st);
      return `${st}=${h.sh(`${LIVE} _ws_status demo-quiet-basin`)}`;
    });
    expect(seen).toEqual([
      'idle=idle', 'busy=busy', 'shell=busy', 'compacting=busy', 'somethingnew=busy',
    ]);
  });

  it('refuses when the registry names no wrapper at all', () => {
    // Observable only in isolation, and that is worth saying: `_cfg_dir` answers
    // EMPTY for every wrapper this guard would reject, so with the real _cfg_dir
    // the very next line refuses for exactly the same inputs and the guard looks
    // like dead weight. Stubbing _cfg_dir to answer a path is what makes the
    // registry precondition its own rung — the helper must not go hunting for a
    // pane on behalf of a session it cannot identify.
    workspace('demo', 'quiet-basin');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.wrapper'));
    withStatus('idle');
    expect(shFail(`${LIVE} _cfg_dir() { echo "$HOME/.claude"; }; _ws_status demo-quiet-basin`).code)
      .not.toBe(0);
  });

  it('refuses when the pane is alive and the status file is not there', () => {
    // The fail-closed half, which nothing exercised: with a live pane and a
    // NUMERIC pane pid, the only thing left between "no status file" and an
    // archive is this rung. Dropping it makes an unreadable status answer `busy`
    // at exit 0 — which happens to refuse the archive, for the wrong reason and
    // with the wrong word — and at Task 6 the same answer is what the resume path
    // reports as `session-busy` about a session it never managed to read.
    workspace('demo', 'quiet-basin');
    fs.mkdirSync(path.join(h.home, '.claude', 'sessions'), { recursive: true });
    expect(shFail(`${LIVE} _ws_status demo-quiet-basin`).code).not.toBe(0);
    const r = shFail(`${LIVE} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/status-unknown/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
  });

  it('will not read a status file named after something that is not a pid', () => {
    // tmux should never answer a non-numeric pane_pid, and ccd does not take its
    // word for it: the shape check is what stops `$cfg/sessions/<whatever tmux
    // said>.json` being read as this session's status. Without it the file below
    // is picked up and answers `idle` — a live session archived on the strength
    // of a path ccd assembled from an answer it could not vouch for.
    workspace('demo', 'quiet-basin');
    const cfg = path.join(h.home, '.claude', 'sessions');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'not-a-pid.json'), '{"status":"idle","statusUpdatedAt":1}');
    const ODD = LIVE.replace('list-panes) echo 4242 ;;', 'list-panes) echo not-a-pid ;;');
    expect(shFail(`${ODD} _ws_status demo-quiet-basin`).code).not.toBe(0);
    expect(shFail(`${ODD} cmd_ws_archive --session demo-quiet-basin`).stderr).toMatch(/status-unknown/);
  });

  it('refuses to archive a session that is running a Bash tool command', () => {
    // The pane is the one thing archive costs, and `shell` means a command is
    // running in it — `tmux kill-session` would take the shell out from under a
    // `npm test`. The same answer gates Task 6's `git worktree remove`, where
    // the cost is the tree itself.
    workspace('demo', 'quiet-basin');
    withStatus('shell');
    const r = shFail(`${LIVE} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/session-busy/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
    expect(h.calls()).not.toContain('unsupervise demo-quiet-basin');
  });
});

describe('ws-archive', () => {
  it('refuses anything but the exact --session <id> shape', () => {
    expect(shFail('cmd_ws_archive').code).toBe(1);
    expect(shFail('cmd_ws_archive demo-quiet-basin').code).toBe(1);
    expect(shFail('cmd_ws_archive --session').code).toBe(1);
    expect(shFail('cmd_ws_archive --session a --session b').code).toBe(1);
    expect(shFail('cmd_ws_archive --session "../../etc"').stderr).toMatch(/bad session id/);
  });

  it('says "no such session" for an id the registry has never heard of', () => {
    // The uuid file is the existence check and it is the FIRST thing either verb
    // asks. Drop it from archive and the refusal becomes "not a workspace"; drop
    // it from restore and it becomes "not archived" — both of which describe a
    // session that exists.
    expect(shFail(`${ARCH} cmd_ws_archive --session ghost-session`).stderr)
      .toMatch(/no such session: ghost-session/);
    expect(shFail(`${ARCH} cmd_ws_restore --session ghost-session`).stderr)
      .toMatch(/no such session: ghost-session/);
  });

  it('refuses a main checkout — it has no worktree to archive', () => {
    h.sh(`_reg_set claude-demo uuid u; _reg_set claude-demo wrapper claude; _reg_set claude-demo workdir /w`);
    expect(shFail(`${ARCH} cmd_ws_archive --session claude-demo`).stderr)
      .toMatch(/not a workspace/);
  });

  it('stops the unit and the pane, and destroys nothing', () => {
    const wt = workspace('demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, 'untracked.txt'), 'still here\n');
    const out = h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(out).toMatch(/^archived demo-quiet-basin/);
    expect(h.reg('demo-quiet-basin', 'archived')).toMatch(/^\d+$/);
    // Nothing removed: worktree, branch, registry, untracked file all intact.
    expect(fs.existsSync(wt)).toBe(true);
    expect(fs.existsSync(path.join(wt, 'untracked.txt'))).toBe(true);
    expect(h.reg('demo-quiet-basin', 'uuid')).not.toBeNull();
    expect(h.git(path.join(h.home, 'projects', 'demo'), 'branch', '--list', 'ws/quiet-basin'))
      .toContain('ws/quiet-basin');
    expect(h.calls()).toContain('unsupervise demo-quiet-basin');
    expect(h.calls().some((c) => c.startsWith('tmux kill-session'))).toBe(true);
  });

  it('archives a DIRTY tree — it destroys nothing, and refusing would strand it', () => {
    const wt = workspace('demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, 'README.md'), 'edited\n');
    expect(h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`)).toMatch(/^archived/);
    expect(h.reg('demo-quiet-basin', 'archived')).toMatch(/^\d+$/);
  });

  it('is idempotent — a second call says so and exits 0', () => {
    workspace('demo', 'quiet-basin');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    // Level-triggering depends on this: the sweep retries every 120 s until it
    // succeeds, and a second success must not be an error.
    const r = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('already archived demo-quiet-basin');
  });

  it('RETURNS from the idempotent path — it does not exit the caller', () => {
    // ccd is explicitly sourceable; the BASH_SOURCE guard at the dispatcher
    // exists for exactly that, and every sibling command uses `return`. `exit 0`
    // here terminated the whole shell, so a batch sweep — `for id in …; do
    // cmd_ws_archive --session "$id"; done` — stopped dead at the first
    // already-archived workspace and skipped every one after it, exit 0.
    workspace('demo', 'quiet-basin');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    const out = h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin; echo REACHED-THE-NEXT-ONE`);
    expect(out).toContain('REACHED-THE-NEXT-ONE');
  });

  it('refuses when the wrapper status cannot be read while the pane IS alive', () => {
    workspace('demo', 'quiet-basin');
    const BUSY = ARCH.replace('_alive() { return 1; };', '_alive() { return 0; };');
    expect(shFail(`${BUSY} cmd_ws_archive --session demo-quiet-basin`).stderr)
      .toMatch(/status-unknown/);
  });

  it('refuses a busy session', () => {
    workspace('demo', 'quiet-basin');
    const cfg = path.join(h.home, '.claude', 'sessions');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, '4242.json'), '{"status":"busy","statusUpdatedAt":1}');
    const BUSY = ARCH
      .replace('_alive() { return 1; };', '_alive() { return 0; };')
      .replace('tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };',
               'tmux() { case "$1" in list-panes) echo 4242 ;; *) echo "tmux $*" >> "$HOME/ccd-calls" ;; esac; };');
    expect(shFail(`${BUSY} cmd_ws_archive --session demo-quiet-basin`).stderr).toMatch(/session-busy/);
  });

  it('names the PR in archivedreason AND in what it prints', () => {
    workspace('demo', 'quiet-basin');
    h.sh('_reg_set demo-quiet-basin prnumber 42');
    const out = h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'archivedreason')).toBe('merged:#42');
    // The line a person reads, not only the field: the sweep's push notification
    // says "PR #n merged", and this is the box's own account of the same fact.
    expect(out).toContain('(merged in #42)');
  });

  it('records a reason even with no PR number, and no note in the line', () => {
    // `merged` with nothing after it is the honest reason for a workspace
    // archived without a bound PR — an ABSENT archivedreason would leave the
    // archive screen with a row it cannot explain.
    workspace('demo', 'quiet-basin');
    const out = h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'archivedreason')).toBe('merged');
    expect(out).not.toContain('merged in #');
  });

  it('refuses when the registry has no workdir to describe', () => {
    // Distinct diagnosis, and the only rung that can give it: with the field
    // gone `[[ -d "" ]]` fails too, so dropping this guard still refuses — as
    // "worktree is gone: ", about a path the registry never held.
    workspace('demo', 'quiet-basin');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.workdir'));
    const r = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/incomplete registry/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
  });

  it('writes the manifest into the REGISTRY, never into the worktree', () => {
    const wt = workspace('demo', 'quiet-basin');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    const m = JSON.parse(h.reg('demo-quiet-basin', 'archivemanifest')!) as Record<string, unknown>;
    expect(m.branch).toBe('ws/quiet-basin');
    expect(m.base).toBe('origin/main');
    expect(m.tip).toMatch(/^[0-9a-f]{40}$/);
    // git's own record for this path, beside the registry's claim. Equal here;
    // the pair is what makes the drifted cases below describable rather than
    // refusable, and it is the same fact Task 5 fingerprints as `worktreeHead=`.
    expect(m.worktreeHead).toBe('ws/quiet-basin');
    expect(m.dirty).toBe(0);
    expect(m.stashes).toBe(0);
    expect(m.pr).toBeNull();
    expect(m.ignoredDigest).toBe(SHA256_EMPTY);     // nothing ignored, read OK
    expect(typeof m.worktreeBytes).toBe('number');
    // Not just "contains .claude/projects/" — the exact path munge.ts computes,
    // so the reap can find the transcript after the registry is gone.
    expect(m.transcript).toBe(path.join(
      h.home, '.claude', 'projects', mungePath(wt), `${h.reg('demo-quiet-basin', 'uuid')}.jsonl`));
    // The manifest describes the thing that may later be deleted, so it cannot
    // live inside it.
    expect(fs.existsSync(path.join(wt, '.archivemanifest'))).toBe(false);
  });

  it('carries the stash count a reap would refuse on', () => {
    // `stashes` is one of the fields Task 6 refuses on (`stashes-present`), and
    // the manifest is what the archive screen shows for a workspace nobody has
    // audited yet. A stash pushed in a LINKED worktree lives in the common ref
    // store, which is why the count is read from $main at all.
    const wt = workspace('demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, 'README.md'), 'edited\n');
    h.git(wt, 'stash', 'push', '-m', 'work in progress');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    const m = JSON.parse(h.reg('demo-quiet-basin', 'archivemanifest')!) as Record<string, unknown>;
    expect(m.stashes).toBe(1);
    expect(m.dirty).toBe(0);        // the stash took the edit with it
  });

  it('substitutes 0 when the size cannot be measured, keeping the record JSON', () => {
    workspace('demo', 'quiet-basin');
    // _ws_gc_bytes answers '-' when du fails. Unsubstituted that is
    // "worktreeBytes":- — not JSON — and since the record is now parsed before it
    // is persisted, dropping the fallback turns a measurable tree into a refusal.
    h.sh(`${ARCH} _ws_gc_bytes() { echo -; }; cmd_ws_archive --session demo-quiet-basin`);
    const m = JSON.parse(h.reg('demo-quiet-basin', 'archivemanifest')!) as Record<string, unknown>;
    expect(m.worktreeBytes).toBe(0);
  });
});

/** The manifest is the record Task 5's audit ladder and ws-reap compare against,
 *  so a manifest that cannot be told truthfully has to be a refusal. Every one of
 *  these archived at exit 0 before the fix, with the `archived` marker set. */
describe('ws-archive refuses rather than record a manifest that lies', () => {
  it('refuses when the worktree directory is gone', () => {
    const wt = workspace('demo', 'quiet-basin');
    fs.renameSync(wt, `${wt}-moved`);
    // Every safety-relevant field would read PRISTINE: dirty 0 because
    // `status --porcelain` failed, worktreeBytes 0 because _ws_gc_bytes returned
    // '-' and the fallback zeroed it, ignoredDigest = sha256(''). Measured before
    // the fix: "archived demo-quiet-basin — worktree kept at …, nothing deleted",
    // exit 0, marker set. ws-restore already refuses this shape (ccd:613).
    const r = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/worktree is gone/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'archivemanifest')).toBeNull();
    expect(h.calls()).toEqual([]);              // and nothing was torn down
  });

  it('refuses when a stranger repository sits at $workdir', () => {
    const wt = workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    // The registry's word alone is not identity. git's RECORD outlives the
    // directory, so after a hand-deletion and a stray `git init` at the same path
    // with the same branch NAME the record still reads healthy and still says
    // ws/quiet-basin — `_ws_wt_branch` cannot catch this on its own, which is why
    // the directory has to be asked too. Without both, every tree field in the
    // manifest describes a stranger's tree and files it under this workspace.
    fs.rmSync(wt, { recursive: true, force: true });
    fs.mkdirSync(wt, { recursive: true });
    h.git(wt, 'init', '-q', '-b', 'ws/quiet-basin');
    fs.writeFileSync(path.join(wt, 'evil.txt'), 'evil\n');
    h.git(wt, 'add', 'evil.txt');
    h.git(wt, 'commit', '-m', 'stranger work');
    expect(h.git(main, 'worktree', 'list', '--porcelain')).toContain('branch refs/heads/ws/quiet-basin');
    const r = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/is not a worktree of/);
    // The verb's own refusal, not just the helper's: discarding the helper's exit
    // status leaves the empty-manifest rung to catch it, which refuses for a
    // reason that does not name what actually disagreed.
    expect(r.stderr).toMatch(/cannot describe demo-quiet-basin truthfully/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'archivemanifest')).toBeNull();
  });

  it('refuses when the tree itself cannot be read', () => {
    workspace('demo', 'quiet-basin');
    // A directory can be a genuine worktree of $main and still not answer: an
    // index.lock contention, a permission change mid-flight. The read was
    // 2>/dev/null-swallowed and `grep -c` then counted zero lines, so a tree
    // nobody could read was recorded as a clean one. Only `status --porcelain` is
    // failed here — the ignored-set read and `worktree list --porcelain` go
    // through to the real git, so the rungs before this one still pass.
    const NOSTATUS = `${ARCH} git() { [[ "$*" == *"status --porcelain" ]] && return 128; command git "$@"; };`;
    const r = shFail(`${NOSTATUS} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not read the tree/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'archivemanifest')).toBeNull();
  });

  it('refuses a record that is not parseable JSON, whatever produced it', () => {
    workspace('demo', 'quiet-basin');
    // Every field is individually guarded, so nothing in ccd can produce this
    // today; the parse is what stops a FUTURE unquoted or non-numeric field from
    // becoming a record that only looks like JSON. Dropping _json_str's quoting
    // is exactly what a missing python3 used to do to all ten fields at once.
    const r = shFail(
      `${ARCH} _json_str() { printf '%s' "\${1-}"; }; cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/not valid JSON/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'archivemanifest')).toBeNull();
  });

  it('refuses when git has no worktree record for the directory at all', () => {
    const wt = workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    // Hand-pruned metadata: the directory and the branch both survive, and every
    // read of the directory fails `not a git repository`. Its own rung, ahead of
    // the common-dir one, because "$main holds no registration for this path" and
    // "this path belongs to another repository" are different facts and the more
    // specific one is the one worth printing. Without the rung the common-dir
    // comparison catches the same state and says the vaguer thing.
    fs.rmSync(path.join(main, '.git', 'worktrees', 'quiet-basin'), { recursive: true, force: true });
    expect(fs.existsSync(wt)).toBe(true);
    const r = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/has no worktree record for/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'archivemanifest')).toBeNull();
  });

  it('refuses when the registry entry itself names no branch', () => {
    workspace('demo', 'quiet-basin');
    // With drift RECORDED rather than refused (below), this rung is the only
    // thing left between an incomplete registry entry and an archive record whose
    // `branch` is the empty string — a record naming no branch, filed as the
    // description of a workspace, with `refs/heads/` for a tip lookup.
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.branch'));
    const r = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/incomplete registry/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'archivemanifest')).toBeNull();
  });

  it('refuses an empty manifest the helper reported success for', () => {
    workspace('demo', 'quiet-basin');
    // Distinct from the parse rung below, and worth its own diagnosis: a helper
    // that exits 0 having printed nothing is a different failure from one that
    // printed something unparseable, and only this rung can say so.
    const r = shFail(`${ARCH} _ws_archive_manifest() { return 0; }; cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/empty archive manifest/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'archivemanifest')).toBeNull();
  });

  it('refuses when the ignored set cannot be read, and says which read failed', () => {
    workspace('demo', 'quiet-basin');
    // Only `--ignored=matching` is failed: `worktree list`, the common-dir reads
    // and `status --porcelain` all go through to real git, so every rung before
    // this one passes and this is the one under test. `_ws_ignored_digest` carries
    // the failure out on its exit code — the digests cannot, because a failed read
    // and an empty set hash identically.
    const NOIGN = `${ARCH} git() { [[ "$*" == *"--ignored=matching"* ]] && return 128; command git "$@"; };`;
    const r = shFail(`${NOIGN} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not read the ignored set/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'archivemanifest')).toBeNull();
  });

  it('refuses when $main cannot be ASKED for a tip — unlike a tip that is absent', () => {
    workspace('demo', 'quiet-basin');
    // The two are different answers and only one of them is describable. git
    // itself distinguishes them: `rev-parse --verify --quiet` exits 1 for a ref
    // that does not resolve in a repository it CAN read, and 128 when it cannot
    // read the repository at all (measured, git 2.43). 1 is a fact about the
    // world and becomes `"tip":null`; 128 is no answer and refuses.
    const NOASK = `${ARCH} git() { [[ "$*" == *"rev-parse --verify --quiet refs/heads/"* ]] && return 128; command git "$@"; };`;
    const r = shFail(`${NOASK} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not ask .* for refs\/heads\/ws\/quiet-basin/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'archivemanifest')).toBeNull();
  });

  it('refuses when python3 cannot quote the JSON, instead of persisting garbage', () => {
    workspace('demo', 'quiet-basin');
    const stub = path.join(h.home, 'nopython');
    fs.mkdirSync(stub, { recursive: true });
    fs.writeFileSync(path.join(stub, 'python3'), '#!/bin/sh\nexit 127\n', { mode: 0o755 });
    // _json_str has no fallback, and every field went through it. Measured before
    // the fix: the archived marker was set, exit 0, and the persisted record was
    //   {"id":,"branch":,"base":,"tip":,"dirty":0,…}
    // — not JSON at all, as the archive record. ccd's other python3 call site
    // (ccd:1287) warns and continues; that is right for a best-effort transcript
    // sanitize and wrong for a record deletions are authorised from.
    const r = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`,
                     { PATH: `${stub}:${process.env.PATH ?? ''}` });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/python3/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'archivemanifest')).toBeNull();
  });
});

/** Drift between the registry's branch name and git's worktree record is a
 *  DESCRIBABLE fact about a healthy directory, not an unreadable one — so archive
 *  records it and folds the workspace out of the live fleet. Refusing was
 *  non-convergent: Task 14's sweep fires `ccd ws-archive` every 120 s with no
 *  human in the loop and swallows the exit code, so a permanent refusal keeps the
 *  workspace in the live fleet forever with nothing on screen to explain it. The
 *  destructive verb still refuses — `_ws_reap_eval` has `registry-branch-drift`,
 *  `detached-head` and `branch-missing` for exactly these three states — which is
 *  the same division of labour Task 2's Context already draws for a dirty tree,
 *  and `cmd_ws_rm` (ccd:465-471) draws for this very divergence. */
describe('ws-archive records branch drift instead of refusing forever', () => {
  const manifestOf = (): Record<string, unknown> =>
    JSON.parse(h.reg('demo-quiet-basin', 'archivemanifest')!) as Record<string, unknown>;

  it('archives a branch renamed by hand, naming both records and no tip', () => {
    const wt = workspace('demo', 'quiet-basin');
    // `_ws_wt_branch`'s contract is that it FOLLOWS a rename, ccd's or the
    // user's (ccd:377-383). The registry's name is now the one that resolves to
    // nothing, which is a fact about the world: `"tip":null`, and ws-reap refuses
    // it as `branch-missing` at the instant of deletion.
    h.git(wt, 'branch', '-m', 'feature/renamed-by-hand');
    const r = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^archived demo-quiet-basin/);
    expect(h.reg('demo-quiet-basin', 'archived')).toMatch(/^\d+$/);
    const m = manifestOf();
    expect(m.branch).toBe('ws/quiet-basin');            // the registry's claim
    expect(m.worktreeHead).toBe('feature/renamed-by-hand');   // git's record
    expect(m.tip).toBeNull();                            // absent, not sha256('')
    // Convergence, which is the whole point: the next sweep is answered, not
    // refused again, so the workspace really does leave the live fleet.
    const again = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(again.code).toBe(0);
    expect(again.stdout).toBe('already archived demo-quiet-basin');
  });

  it('archives a worktree parked on another branch, and says which', () => {
    const wt = workspace('demo', 'quiet-basin');
    // The ordinary shape of this: a PR merges while the developer has another
    // branch checked out in that worktree to compare something. Both branches
    // exist, so the registry's tip still resolves — and `dirty` is measured
    // against whatever is checked out, which `worktreeHead` is what makes legible.
    h.git(wt, 'checkout', '-q', '-b', 'compare-thing');
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'comparing\n');
    const r = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    const m = manifestOf();
    expect(m.branch).toBe('ws/quiet-basin');
    expect(m.worktreeHead).toBe('compare-thing');
    expect(m.tip).toMatch(/^[0-9a-f]{40}$/);
    expect(m.dirty).toBe(1);
  });

  it('archives a detached HEAD, recording the empty branch git records', () => {
    const wt = workspace('demo', 'quiet-basin');
    // `git bisect` leaves exactly this. Empty is `_ws_wt_branch`'s own answer for
    // a recorded detached HEAD, and the same "" Task 5 compares against `$branch`
    // and refuses as `detached-head`.
    h.git(wt, 'checkout', '-q', '--detach');
    const r = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    const m = manifestOf();
    expect(m.worktreeHead).toBe('');
    expect(m.tip).toMatch(/^[0-9a-f]{40}$/);
  });

  it('still refuses the state where git records no branch AND no directory', () => {
    // The one shape that stays a refusal, stated here so the boundary is a test
    // and not a comment: with the directory gone, `dirty`, `ignoredDigest` and
    // `worktreeBytes` are all unmeasurable at once, so the record would describe
    // nothing at all — that is the pristine-lying manifest, not drift.
    const wt = workspace('demo', 'quiet-basin');
    fs.renameSync(wt, `${wt}-moved`);
    const r = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/worktree is gone/);
  });
});

describe('ws-restore', () => {
  it('undoes an archive completely and re-supervises', () => {
    workspace('demo', 'quiet-basin');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    const out = h.sh(`${ARCH} cmd_ws_restore --session demo-quiet-basin`);
    expect(out).toMatch(/^restored demo-quiet-basin/);
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'archivedreason')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'archivemanifest')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'started')).toBe('1');
    // `ccd ensure` does NOT re-supervise, so restore must do it explicitly or
    // boot persistence is silently lost.
    expect(h.calls()).toContain('spawn demo-quiet-basin resume');
    expect(h.calls()).toContain('supervise demo-quiet-basin');
  });

  it('refuses a session that is not archived', () => {
    workspace('demo', 'quiet-basin');
    expect(shFail(`${ARCH} cmd_ws_restore --session demo-quiet-basin`).stderr).toMatch(/not archived/);
  });

  it('refuses anything but the exact --session <id> shape', () => {
    // The same argv contract archive has, asserted for the verb that SPAWNS: an
    // id that is not an id reaches `$REG/$id.*` and `_spawn`, so the shape check
    // is the boundary, not a formality.
    expect(shFail('cmd_ws_restore').code).toBe(1);
    expect(shFail('cmd_ws_restore demo-quiet-basin').code).toBe(1);
    expect(shFail('cmd_ws_restore --session').code).toBe(1);
    expect(shFail('cmd_ws_restore --session a --session b').code).toBe(1);
    expect(shFail('cmd_ws_restore --session "../../etc"').stderr).toMatch(/bad session id/);
  });

  it('points at the attic when the worktree is gone', () => {
    const wt = workspace('demo', 'quiet-basin');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    fs.rmSync(wt, { recursive: true, force: true });
    expect(shFail(`${ARCH} cmd_ws_restore --session demo-quiet-basin`).stderr)
      .toMatch(/ccd ws-attic --session demo-quiet-basin/);
  });
});

describe('ws-attic', () => {
  it('lists the refs pinned under this session, and drops them on demand', () => {
    workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    const tip = h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin');
    h.git(main, 'update-ref', `refs/ccrc/attic/demo-quiet-basin/${tip}`, tip);
    expect(h.sh('cmd_ws_attic --session demo-quiet-basin')).toContain(tip);
    // Exact, including the singular: `dropped 1 attic refs` is what the plural
    // logic exists to avoid, and /dropped 1 attic ref/ matches it happily.
    expect(h.sh('cmd_ws_attic --drop demo-quiet-basin')).toBe('dropped 1 attic ref for demo-quiet-basin');
    expect(h.sh('cmd_ws_attic --session demo-quiet-basin')).toBe('');
  });

  it('pluralises only when there is more than one ref', () => {
    workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    const tip = h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin');
    h.git(main, 'update-ref', `refs/ccrc/attic/demo-quiet-basin/${tip}`, tip);
    h.git(main, 'update-ref', 'refs/ccrc/attic/demo-quiet-basin/head', tip);
    expect(h.sh('cmd_ws_attic --drop demo-quiet-basin')).toBe('dropped 2 attic refs for demo-quiet-basin');
    expect(h.sh('cmd_ws_attic --session demo-quiet-basin')).toBe('');
  });

  it('reaches the attic from the TOMBSTONE once the registry is gone', () => {
    // The whole point of the second rung: after a reap there is no registry
    // entry, and the attic is exactly what the user still needs to reach. Without
    // it `ccd ws-attic --session <id>` answers `no such session` for every
    // workspace ccrc has ever cleaned up — the refs are pinned and unreachable.
    workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    const tip = h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin');
    h.git(main, 'update-ref', `refs/ccrc/attic/demo-quiet-basin/${tip}`, tip);
    const reaped = path.join(h.home, '.cc-sessions', '.reaped');
    fs.mkdirSync(reaped, { recursive: true });
    fs.writeFileSync(path.join(reaped, 'demo-quiet-basin.json'),
      JSON.stringify({ id: 'demo-quiet-basin', project: 'demo', tip }));
    for (const f of fs.readdirSync(path.join(h.home, '.cc-sessions'))) {
      if (f.startsWith('demo-quiet-basin.')) fs.rmSync(path.join(h.home, '.cc-sessions', f));
    }
    expect(h.sh('cmd_ws_attic --session demo-quiet-basin')).toContain(tip);
  });

  it('refuses an id it can place in neither the registry nor a tombstone', () => {
    // Without the refusal `$project` is empty, `$main` becomes PROJECTS_ROOT
    // itself, and `for-each-ref` there fails quietly: exit 0, no output — a
    // mistyped id reading as "this workspace has nothing pinned".
    workspace('demo', 'quiet-basin');
    const r = shFail('cmd_ws_attic --session ghost-session');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no such session: ghost-session/);
    expect(shFail('cmd_ws_attic --session "../../etc"').stderr).toMatch(/bad session id/);
  });

  it('rejects any mode word other than --session or --drop', () => {
    // The session has to EXIST for the mode word to be what is under test.
    // Without it `_attic_project` fails and the command dies at `no such
    // session` (ccd:634) before the case is reached, so the assertion cannot
    // tell a rejected mode from a missing session: deleting the `*)` arm left
    // the whole 456-test suite green, while `ccd ws-attic --frobnicate <real
    // id>` then fell out of the case and exited 0 with no output — a mistyped
    // mode reading as success.
    workspace('demo', 'quiet-basin');
    const r = shFail('cmd_ws_attic --frobnicate demo-quiet-basin');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/usage: ccd ws-attic/);
    expect(r.stderr).not.toMatch(/no such session/);
    // ...and the arity rung is not what caught it.
    expect(shFail('cmd_ws_attic --session').code).toBe(1);
    expect(shFail('cmd_ws_attic --session a b').code).toBe(1);
  });
});
