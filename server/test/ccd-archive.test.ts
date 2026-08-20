// ws-archive / ws-restore / ws-attic and the caps list, under the isolated
// HOME harness. HOME is the only isolation boundary ccd has: PROJECTS_ROOT and
// WORKTREES_ROOT derive from it and take no override, which is what stops any
// of this reaching a real repository.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, ghContainedEnv, harnessBin, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';
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
  _spawn_start() { echo "spawn_start $1 $2" >> "$HOME/ccd-calls"; SPAWN_FROMSWAP=0; };
  _spawn_settle() { echo "spawn_settle $1" >> "$HOME/ccd-calls"; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };
  _session_verdict() { echo gone; };`;

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
  // harnessBin(), not a private dir: ghContainedEnv PREPENDS the harness bin,
  // so a stub anywhere else can never win. Writing here REPLACES the contained
  // systemctl/tmux for this test, which is what these two files need — and the
  // replacement STICKS, because the systemd poison is create-if-absent while
  // this write is unconditional.
  const stub = harnessBin(h.home);
  // `has-session` says WHY it failed, because ccd now reads that: only
  // "can't find session" means the session is gone, and a bare exit 1 means
  // "the tmux server did not answer" — under which `_ws_status` correctly
  // refuses instead of reporting idle. This harness models a box with no
  // session, not a box with no tmux server, so it says so (D-B8-12).
  fs.writeFileSync(path.join(stub, 'tmux'),
    '#!/bin/sh\necho "tmux $*" >> "$HOME/ccd-calls"\n'
    + '[ "$1" = has-session ] && echo "can\'t find session: $3" >&2\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(stub, 'systemctl'),
    '#!/bin/sh\necho "systemctl $*" >> "$HOME/ccd-calls"\nexit 0\n', { mode: 0o755 });
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    // Through `ghContainedEnv`, so this caller-supplied PATH cannot displace
    // the poisoned `gh`: it is prepended, and the tmux/systemctl stubs below
    // it are still found.
    env: ghContainedEnv(h.home,
      { ...process.env, HOME: h.home, PATH: `${stub}:${process.env.PATH ?? ''}` }, { systemd: true }),
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

    // ...and the same arm on its SUCCESS path, because the refusal above is not
    // enough: an arm that forgets its `shift` passes three arguments, fails the
    // arity rung, and prints that same usage line. Only a listing proves the verb
    // arrived with the argv it was meant to have.
    const main = path.join(h.home, 'projects', 'demo');
    const atticTip = h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin');
    h.git(main, 'update-ref', `refs/ccrc/attic/demo-quiet-basin/${atticTip}`, atticTip);
    const listed = runCcd('ws-attic', '--session', 'demo-quiet-basin');
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(atticTip);

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
  // Fix round 2 (task 14 follow-up): `cmd_caps` now also advertises
  // CAPABILITY tokens — verb-shaped strings that name a FLAG on an existing
  // verb, not a second dispatchable command, so the server can ask "does
  // this deployed ccd understand `--surface`" the exact same way it already
  // asks "does this deployed ccd understand `ws-reap`" (`verbSupported`,
  // reused rather than duplicated — see `ccd/ccd`'s own comment on the
  // token). Named here, individually, so the exact-equality check below can
  // still fail loudly on anything ELSE that drifts: a THIRD capability token
  // added without updating this list is exactly as much a silent hole as an
  // undispatched verb would be.
  const KNOWN_CAPABILITY_TOKENS = ['stop-surface'];

  it('advertises exactly the verbs the dispatcher implements, plus the known capability tokens', () => {
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
    const verbs = advertised.filter((a) => !KNOWN_CAPABILITY_TOKENS.includes(a));
    expect([...verbs].sort()).toEqual([...new Set(dispatched)].sort());
    // The other half: the capability tokens actually advertised are EXACTLY
    // the known set — neither a silently-dropped one nor an undocumented
    // extra one hiding inside what the verb-parity check above now excludes.
    const capabilities = advertised.filter((a) => KNOWN_CAPABILITY_TOKENS.includes(a));
    expect(capabilities.sort()).toEqual([...KNOWN_CAPABILITY_TOKENS].sort());
  });
});

/** `_alive` true plus a pane pid, so `_ws_status` reads a real status file
 *  instead of short-circuiting on "no pane at all". */
const LIVE = ARCH
  .replace('_session_verdict() { echo gone; };', '_session_verdict() { echo live; };')
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

  it('counts an OFF-BRANCH stash — a DETACHED worktree names no branch at all', () => {
    // Final-round integration docket 6, "THE headline gap": a stash taken with
    // a bare `git stash` from a worktree on a DETACHED HEAD. git writes the
    // literal `(no branch)` in place of a name, so both `-e "On ws/x:"` and
    // `-e "WIP on ws/x:"` matched nothing and the count came back an
    // honest-looking 0 — §7's no-override `stashes-present` guard could not
    // fire, and the reap went on to CAS-delete the branch the stash was taken
    // from. Attribution is by BASE COMMIT (the stash commit's first parent),
    // because the message carries no name to match.
    const wt = workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    // A commit of its own first: that is what makes this branch's history
    // distinguishable from main's, and it is what every reapable workspace has
    // (Phase C requires a merged PR bound to the branch).
    fs.writeFileSync(path.join(wt, 'work.txt'), 'the work\n');
    h.git(wt, 'add', 'work.txt'); h.git(wt, 'commit', '-m', 'the work');
    h.git(wt, 'checkout', '-q', '--detach');
    fs.writeFileSync(path.join(wt, 'README.md'), 'unsaved\n');
    h.git(wt, 'stash', 'push');                       // NO -m: "WIP on (no branch): …"
    expect(h.sh(`git -C "${main}" stash list`), 'the fixture must be the (no branch) form')
      .toContain('WIP on (no branch):');
    expect(h.sh(`_ws_stash_count "${main}" ws/quiet-basin`),
      'a stash taken from this branch\'s worktree belongs to it, named or not').toBe('1');
    // NOT attributed to a branch that does not contain the base commit — the
    // whole point of using the parent rather than "any (no branch) stash".
    h.git(main, 'branch', 'ws/elsewhere', 'main');
    expect(h.sh(`_ws_stash_count "${main}" ws/elsewhere`)).toBe('0');

    // The named form of the same state, `git stash push -m` while detached,
    // which git writes as `On (no branch): <message>`. Two arms, two fixtures:
    // the WIP-arm lesson one test down is that these two subjects differ by
    // more than a prefix.
    fs.writeFileSync(path.join(wt, 'README.md'), 'unsaved again\n');
    h.git(wt, 'stash', 'push', '-m', 'detached and named');
    expect(h.sh(`git -C "${main}" stash list`)).toContain('On (no branch): detached and named');
    expect(h.sh(`_ws_stash_count "${main}" ws/quiet-basin`)).toBe('2');
    expect(h.sh(`_ws_stash_count "${main}" ws/elsewhere`)).toBe('0');
  });

  it('counts an UNNAMED stash — git writes "WIP on <branch>:", with a lowercase "on"', () => {
    // Final-round integration review, docket item 7, first bullet — recorded
    // there as "genuinely equivalent … `grep -F` is a substring match, so
    // `-e "On ws/x:"` already matches `WIP on ws/x:`. No input distinguishes
    // them." IT IS NOT EQUIVALENT, and this test is the input.
    //
    // `grep -F` is a substring match but it is CASE SENSITIVE, and the two
    // subjects git writes differ in exactly that:
    //     git stash push -m msg  ->  "stash@{0}: On ws/x: msg"        capital O
    //     git stash push         ->  "stash@{0}: WIP on ws/x: 1a2b3c" lowercase
    // so "On ws/x:" is NOT a substring of "WIP on ws/x:". Measured in a scratch
    // repo holding one of each: both arms -> 2, `-e "On ws/x:"` alone -> 1.
    //
    // The unnamed form is the COMMON one — a bare `git stash` — and every other
    // fixture in this file and in ccd-ws-audit.test.ts uses `stash push -m`,
    // which is why deleting the WIP arm left the suite green. What it would
    // cost: `_ws_reap_eval` gates `stashes-present` on this count (ccd:2357),
    // so a workspace whose only stash was made with a bare `git stash` would
    // read 0, the §7 guard would not fire, and the reap would CAS-delete the
    // branch those stashes name.
    const wt = workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    fs.writeFileSync(path.join(wt, 'README.md'), 'edited\n');
    h.git(wt, 'stash', 'push');                       // NO -m: "WIP on ws/quiet-basin: …"
    expect(h.sh(`git -C "${main}" stash list`), 'the fixture must be the WIP form')
      .toContain('WIP on ws/quiet-basin:');
    expect(h.sh(`_ws_stash_count "${main}" ws/quiet-basin`)).toBe('1');

    // AND THE WIP ARM IS SCOPED TOO — the other half of the same line, and the
    // survivor the docket calls "stash scoping arg". A `WIP on ` pattern with
    // the branch dropped, or with the trailing colon dropped, counts another
    // branch's unnamed stash as this workspace's: over-counting refuses a
    // legitimate reap and names stashes the human cannot find on this branch.
    h.git(main, 'branch', 'ws/quiet-basin-2', 'main');
    h.git(wt, 'checkout', '-q', 'ws/quiet-basin-2');
    fs.writeFileSync(path.join(wt, 'README.md'), 'sibling work\n');
    h.git(wt, 'stash', 'push');                       // NO -m, on the sibling
    expect(h.sh(`_ws_stash_count "${main}" ws/quiet-basin-2`)).toBe('1');
    expect(h.sh(`_ws_stash_count "${main}" ws/quiet-basin`),
      'the sibling\'s unnamed stash is not this branch\'s').toBe('1');
    expect(h.sh(`_ws_stash_count "${main}" ws/other`)).toBe('0');
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

  /** Plant a transcript at an exact <cfg>/projects/<dir>/<uuid>.jsonl and return its path. */
  const plant = (cfg: string, dir: string, uuid: string, body = '{}\n'): string => {
    const p = path.join(h.home, cfg, 'projects', dir, `${uuid}.jsonl`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    return p;
  };

  it('prefers the resolved munge when a file is actually there', () => {
    // Rung 1, and the only rung that ever fired before this task. Kills the
    // mutant that drops the existence check and returns rung 1 unconditionally
    // — that mutant passes every OTHER test in this block, because they are all
    // cases where rung 1 is also the right answer.
    const wd = path.join(h.home, 'projects', 'demo');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set t1 wrapper claude; _reg_set t1 workdir '${wd}'; _reg_set t1 uuid u-1`);
    const want = plant('.claude', mungePath(fs.realpathSync(wd)), 'u-1');
    expect(h.sh('_transcript_path t1')).toBe(want);
  });

  it('falls to the RAW munge when only the unresolved path has the file', () => {
    // A workdir reached through a symlink whose transcript sits under the
    // symlinked spelling. Kills "resolve, then never look at the raw form".
    const real = path.join(h.home, 'volume', 'demo');
    const link = path.join(h.home, 'projects-link');
    fs.mkdirSync(real, { recursive: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.join(h.home, 'volume'), link);
    const wd = path.join(link, 'demo');
    h.sh(`_reg_set t2 wrapper claude; _reg_set t2 workdir '${wd}'; _reg_set t2 uuid u-2`);
    const want = plant('.claude', mungePath(wd), 'u-2');   // the RAW spelling
    expect(h.sh('_transcript_path t2')).toBe(want);
  });

  it('finds a transcript that moved, by uuid, under its own config dir', () => {
    // The defect this task exists for: the session relocated into a worktree,
    // so neither munge of the registry workdir has anything. Kills a ladder that
    // stops after the two exact candidates.
    const wd = path.join(h.home, 'projects', 'moved');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set t3 wrapper claude; _reg_set t3 workdir '${wd}'; _reg_set t3 uuid u-3`);
    const want = plant('.claude', '-somewhere-else-entirely', 'u-3');
    expect(h.sh('_transcript_path t3')).toBe(want);
  });

  it('takes the NEWEST when the uuid matches in more than one project dir', () => {
    // Kills "first glob hit wins", which is alphabetical and therefore
    // arbitrary. The spec's rule is newest mtime, the same one §5.1 uses.
    const wd = path.join(h.home, 'projects', 'multi');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set t4 wrapper claude; _reg_set t4 workdir '${wd}'; _reg_set t4 uuid u-4`);
    const older = plant('.claude', '-aaa-older', 'u-4');
    const newer = plant('.claude', '-zzz-newer', 'u-4');
    fs.utimesSync(older, new Date(1_600_000_000_000), new Date(1_600_000_000_000));
    fs.utimesSync(newer, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    expect(h.sh('_transcript_path t4')).toBe(newer);
  });

  it('never crosses into another account to answer', () => {
    // The one thing the ladder must NOT do. A session on `claude` whose only
    // copy sits under `.claude-corp` gets the canonical unchecked address, not
    // another account's file — that is D4's bannered rung, and it belongs to a
    // surface that can show the banner, not to a tombstone that cannot.
    const wd = path.join(h.home, 'projects', 'lonely');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set t5 wrapper claude; _reg_set t5 workdir '${wd}'; _reg_set t5 uuid u-5`);
    plant('.claude-corp', mungePath(fs.realpathSync(wd)), 'u-5');
    expect(h.sh('_transcript_path t5')).toBe(
      path.join(h.home, '.claude', 'projects', mungePath(fs.realpathSync(wd)), 'u-5.jsonl'),
    );
  });

  it('still prints the resolved munge when nothing exists anywhere', () => {
    // Rung 4, and the reason the two pre-existing tests in this block keep
    // passing: a session that has written nothing yet records the canonical
    // address, never an empty string.
    const wd = path.join(h.home, 'projects', 'fresh');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set t6 wrapper claude; _reg_set t6 workdir '${wd}'; _reg_set t6 uuid u-6`);
    expect(h.sh('_transcript_path t6')).toBe(
      path.join(h.home, '.claude', 'projects', mungePath(fs.realpathSync(wd)), 'u-6.jsonl'),
    );
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

  it('reads the ignored set from the START of each line — an untracked `a!! b` is not an ignored entry', () => {
    // Final-round integration review, docket item 7 / new finding 4: the `^`
    // anchor in this function's `grep '^!! '` was one of four mutation
    // survivors sitting on comment-justified lines, and the only one of the
    // four that is PINNABLE. It is pinned rather than justified here.
    //
    // `git status --porcelain` prefixes every line with a two-character status
    // plus a space, so `!! ` at the start means "ignored" — and `grep -F`-style
    // substring matching finds that same three-character sequence ANYWHERE. A
    // single untracked file whose NAME contains `!! ` is therefore enough: git
    // reports it as `?? "a!! b"` (quoted, because of the space), which an
    // unanchored grep admits into the preimage as though it were an ignored
    // entry.
    //
    // Measured in a scratch repo before this test existed — one untracked
    // `a!! b`, one ignored directory:
    //     with    ^ anchor -> 07f8c2c3b4cd2eee...
    //     without ^ anchor -> 0ba8517d511c376e...
    // The consequence is not cosmetic. `ignoredDigest` is the archive
    // manifest's record of what was ignored at archive time; an untracked file
    // that renames or disappears would move a digest that is supposed to
    // describe the IGNORED set only, and the two names ccd would then be
    // treating as the same kind of fact are not the same kind of fact.
    const wt = workspace('demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, '.gitignore'), 'ignored/\n');
    fs.mkdirSync(path.join(wt, 'ignored'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'ignored', 'f'), 'x\n');
    h.git(wt, 'add', '.gitignore'); h.git(wt, 'commit', '-m', 'ignore');
    // UNTRACKED, never committed and never ignored: the whole point is that it
    // belongs to the `??` half of the porcelain and must not reach the digest.
    fs.writeFileSync(path.join(wt, 'a!! b'), 'y\n');
    // The exact preimage, not merely "64 hex chars": the entry list is ONE
    // line, and asserting the digest of that one line is what kills the
    // unanchored mutant, whose preimage carries `?? "a!! b"` as a second.
    expect(h.sh(`_ws_ignored_digest "${wt}"`))
      .toBe(createHash('sha256').update('!! ignored/\n').digest('hex'));
    // Said again as the literal the review measured, so a future change to the
    // fixture cannot quietly turn the assertion above into a tautology.
    expect(h.sh(`_ws_ignored_digest "${wt}"`))
      .toBe('07f8c2c3b4cd2eeef0e53352c025ca37548f9a1ec7b75652d59dc3e00b6f6422');
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
    // The MESSAGE, not just the code: `-ge 2` in place of `-eq 2` refuses the
    // two-pair form too, but as `no such session: a` — an arity error reported as
    // a lookup, which passes an exit-code-only assertion while the verb quietly
    // accepts trailing argv it was never given a meaning for.
    for (const argv of ['cmd_ws_archive', 'cmd_ws_archive demo-quiet-basin',
                        'cmd_ws_archive --session', 'cmd_ws_archive --session a --session b']) {
      const r = shFail(argv);
      expect(r.code, argv).toBe(1);
      expect(r.stderr, argv).toMatch(/usage: ccd ws-archive --session <id>/);
    }
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
    const BUSY = ARCH.replace('_session_verdict() { echo gone; };', '_session_verdict() { echo live; };');
    expect(shFail(`${BUSY} cmd_ws_archive --session demo-quiet-basin`).stderr)
      .toMatch(/status-unknown/);
  });

  it('refuses a busy session', () => {
    workspace('demo', 'quiet-basin');
    const cfg = path.join(h.home, '.claude', 'sessions');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, '4242.json'), '{"status":"busy","statusUpdatedAt":1}');
    const BUSY = ARCH
      .replace('_session_verdict() { echo gone; };', '_session_verdict() { echo live; };')
      .replace('tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };',
               'tmux() { case "$1" in list-panes) echo 4242 ;; *) echo "tmux $*" >> "$HOME/ccd-calls" ;; esac; };');
    expect(shFail(`${BUSY} cmd_ws_archive --session demo-quiet-basin`).stderr).toMatch(/session-busy/);
  });

  it('names the PR in archivedreason AND in what it prints — merged outranks empty even with nothing ahead', () => {
    // Naming the PR now requires the gh-verified prphase to say `merged`,
    // not just a bound number — `cmd_pr_state` is what writes prphase off a
    // real `gh` read, and this fixture sets the registry fields it would
    // have left exactly as that command leaves them.
    //
    // NO commit here, deliberately — pinning the ladder's new precedence
    // rather than working around it. Before the reorder this fixture had to
    // commit real work first or the empty-branch check ahead of the
    // merged/prphase check would claim the row; now `merged:#N` outranks
    // `empty` (a bound PR whose phase reads merged implies commits existed to
    // merge, even when this branch's own ahead-count reads 0 — exactly what a
    // squash or an ancestor-swallowing rebase looks like from here), so an
    // untouched workspace with a merged, bound PR still reads `merged:#42`,
    // not `empty`.
    workspace('demo', 'quiet-basin');
    h.sh('_reg_set demo-quiet-basin prnumber 42; _reg_set demo-quiet-basin prphase merged');
    const out = h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'archivedreason')).toBe('merged:#42');
    // The line a person reads, not only the field: the sweep's push notification
    // says "PR #n merged", and this is the box's own account of the same fact.
    expect(out).toContain('(merged in #42)');
  });

  it('records manual even with no PR number, and no note in the line', () => {
    // `manual` is the honest reason for a workspace with real commits beyond
    // base and no bound PR — an ABSENT archivedreason would leave the archive
    // screen with a row it cannot explain, and the pre-fix constant `merged`
    // would claim a fact nobody proved. A commit is required here too: with
    // none, this fixture reads `empty`, which is a different row entirely.
    const wt = workspace('demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, 'work.txt'), 'the work\n');
    h.git(wt, 'add', 'work.txt'); h.git(wt, 'commit', '-m', 'the work');
    const out = h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'archivedreason')).toBe('manual');
    expect(out).not.toContain('merged in #');
  });

  it('records empty for a workspace with no commits beyond base', () => {
    // The merged/prphase check runs FIRST in the ladder now (see the reorder
    // above), but an untouched workspace with no bound, merged PR never
    // matches it, so `empty` is still what an ordinary unmerged, unbound
    // workspace records — distinct from the precedence pin two tests up
    // (merged outranking empty when BOTH would otherwise apply), which this
    // fixture does not exercise: nothing here is bound to a PR at all.
    workspace('demo', 'quiet-basin');
    const out = h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'archivedreason')).toBe('empty');
    expect(out).toContain('(no commits beyond base)');
  });

  it('records manual for a bound PR whose prphase was never checked — the old bug\'s shape', () => {
    // The pre-fix write was `[[ "$pr" =~ ^[0-9]+$ ]] then merged:#$pr` — a
    // bound PR number ALONE, no verification the branch ever merged. A
    // bound number with prphase left unset (nobody ran `cmd_pr_state` yet)
    // is exactly the shape that used to lie.
    const wt = workspace('demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, 'work.txt'), 'the work\n');
    h.git(wt, 'add', 'work.txt'); h.git(wt, 'commit', '-m', 'the work');
    h.sh('_reg_set demo-quiet-basin prnumber 42');
    const out = h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'archivedreason')).toBe('manual');
    expect(out).not.toContain('merged in #');
  });

  it('records manual for a bound PR whose prphase is open, not merged — the exact case the rider exists for', () => {
    // Distinct from the test above: here `cmd_pr_state` HAS run and gh HAS
    // answered — the PR is real, bound, and simply not merged yet. A number
    // being bound was ALL the pre-fix code checked, so this is the case that
    // used to be filed as `merged:#42` for a PR that had not merged: the old
    // lie, pinned dead.
    const wt = workspace('demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, 'work.txt'), 'the work\n');
    h.git(wt, 'add', 'work.txt'); h.git(wt, 'commit', '-m', 'the work');
    h.sh('_reg_set demo-quiet-basin prnumber 42; _reg_set demo-quiet-basin prphase open');
    const out = h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'archivedreason')).toBe('manual');
    expect(out).not.toContain('merged in #');
  });

  /** A REAL squash merge, not merely a same-lineage one with a bound PR number
   *  slapped on top: main gains an unrelated commit after the branch is cut,
   *  then the branch's commit lands on main as ONE squashed commit sharing no
   *  lineage with the branch it replaces — the shape an ancestor check can
   *  never prove and the whole reason `prphase` decides `merged:#N` instead of
   *  `_ws_gc_merged`. Copied from `squashMovedBase` (ccd-ws-audit.test.ts:40)
   *  / `ready` (ccd-ws-reap.test.ts:16-42), trimmed to this file's plain
   *  `workspace()` fixture rather than PrHarness's gh-shaped repo: neither
   *  `_ws_gc_merged` nor `_ws_archive_manifest` ever calls `gh`, so no gh stub
   *  is needed here — only a real second push, the part the old fixture never
   *  built at all. */
  function squashMerged(): string {
    const wt = workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    fs.writeFileSync(path.join(wt, 'work.txt'), 'the work\n');
    h.git(wt, 'add', 'work.txt'); h.git(wt, 'commit', '-m', 'the work');
    // main moves underneath, THEN the squash lands on top of that.
    fs.writeFileSync(path.join(main, 'other.txt'), 'someone else\n');
    h.git(main, 'add', 'other.txt'); h.git(main, 'commit', '-m', 'unrelated');
    fs.writeFileSync(path.join(main, 'work.txt'), 'the work\n');
    h.git(main, 'add', 'work.txt'); h.git(main, 'commit', '-m', 'squash of the work (#42)');
    h.git(main, 'push', 'origin', 'main');
    h.git(wt, 'push', '-u', 'origin', 'ws/quiet-basin');
    return wt;
  }

  it('re-pins merged:#N for a genuine squash merge — the case _ws_gc_merged cannot see', () => {
    // The whole reason for the deviation from the spec: a squash merge's
    // commit on main shares no lineage with the branch it replaces, so an
    // ancestor check can never prove it — asserted directly below, against a
    // REAL squash (built by `squashMerged` above; the old form of this test
    // built no squash at all, only a bound PR number over an unmerged
    // branch), with the SAME `_ws_gc_merged` the spec originally named. The
    // exit code alone cannot prove the point: `_ws_gc_merged` returns the
    // same nonzero code whether it proved "not an ancestor" or merely found no
    // `origin/HEAD` to compare against, so only `$GC_MERGED_STATE` tells a
    // real squash apart from an accidentally-unprovable fixture — pinned as
    // `unmerged`, not `unprovable`. prphase, written from a real `gh` read, is
    // what still gets `merged:#N` right underneath it.
    squashMerged();
    expect(h.sh(`_ws_gc_merged "$HOME/projects/demo" ws/quiet-basin; echo $GC_MERGED_STATE`))
      .toBe('unmerged');
    h.sh('_reg_set demo-quiet-basin prnumber 42; _reg_set demo-quiet-basin prphase merged');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'archivedreason')).toBe('merged:#42');
  }, 30000);

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

  // Pre-merge fix round, finding 5 — the seventh instance of the
  // measurement-forgery class in this plan (deviation 10: "a number is a
  // measurement"). Before this fix, a failed `du` on a workdir that EXISTS
  // and IS readable wrote a literal `"worktreeBytes":0` — a false claim of
  // "measured, zero bytes" when the truth was "could not measure it". The
  // whole-directory-gone case is refused earlier (`[[ -d "$workdir" ]] ||
  // die …` above, and `git -C "$workdir" status` failing before `_ws_gc_bytes`
  // is ever reached) — this is the narrower window: the read itself failing
  // on an otherwise-describable tree. `registry.ts`'s `manifestBytes` already
  // treats anything but a finite JSON number as null (Task 19), so the ONLY
  // gap was ccd writing the wrong JSON value in the first place.
  it('records worktreeBytes as null, not a fabricated 0, when du fails on an existing readable worktree', () => {
    workspace('demo', 'quiet-basin');
    // `du() { return 1; }` — the established technique in this suite for a
    // failed size read (ccd-ws-audit.test.ts's own `records 0 bytes rather
    // than an empty field…` fixture) — reproduces the failure WITHOUT
    // touching the directory itself: $workdir still exists and is still
    // readable, only the measurement fails. `_ws_gc_bytes` then answers '-',
    // which the manifest must record as JSON `null`, never a fabricated 0.
    h.sh(`${ARCH} du() { return 1; }; cmd_ws_archive --session demo-quiet-basin`);
    const m = JSON.parse(h.reg('demo-quiet-basin', 'archivemanifest')!) as Record<string, unknown>;
    expect(m.worktreeBytes).toBeNull();
  });

  it('still records a genuine ZERO-byte measurement as 0, not null — the two stay distinguishable', () => {
    workspace('demo', 'quiet-basin');
    // A successful `du` that genuinely answers 0 (rc 0, numeric output) must
    // not be conflated with a failed read: 0 is a measurement, and this is
    // the other half of that rule — a real zero must survive as 0.
    h.sh(`${ARCH} du() { printf '0\\tx\\n'; }; cmd_ws_archive --session demo-quiet-basin`);
    const m = JSON.parse(h.reg('demo-quiet-basin', 'archivemanifest')!) as Record<string, unknown>;
    expect(m.worktreeBytes).toBe(0);
  });

  // Pre-merge fix round, finding F: the `du() { return 1; }` fixture above
  // reproduces a TOTAL failure — empty stdout, and `_ws_gc_bytes` (before its
  // own fix) answered '-' for that shape by accident, because an empty string
  // fails the numeric regex too. Real GNU `du` on a tree it can only PARTLY
  // read does not behave like that stub: it prints the partial total it DID
  // sum — a real, numeric, WRONG answer — and the old `_ws_gc_bytes` passed
  // that number straight through. This is the gap the stub-only coverage
  // above could not see: a `chmod 000` on a real subdirectory, not a shell
  // function shadow.
  //
  // FIXTURE NARROWED (final-round integration item 5, in the same round as the
  // tree-read fix below): `blocked_sub` is now GITIGNORED. It has to be, and
  // the reason is the finding this test is about. A chmod-000 subdirectory that
  // git WALKS makes `git status --porcelain` print `warning: could not open
  // directory 'blocked_sub/'` on stderr, and the manifest's tree read now
  // refuses on any diagnostic — so the old fixture stopped reaching
  // `_ws_gc_bytes` at all and asserted the wrong guard's refusal. Measured, and
  // this is why the narrowing is sound rather than convenient: with the
  // directory gitignored, `git status --porcelain` answers rc 0 with EMPTY
  // stderr and `--ignored=matching` collapses it to `!! blocked_sub/` without
  // descending, while `du -sb` still walks in, still fails, and still prints
  // the partial total — i.e. the du blind spot is reproduced EXACTLY as before
  // and nothing else is. One fixture, one finding.
  it('records worktreeBytes as null — not the understated number a partially-unreadable subdirectory produces', () => {
    const wt = workspace('demo', 'quiet-basin');
    const readable = path.join(wt, 'readable_sub');
    const blocked = path.join(wt, 'blocked_sub');
    fs.writeFileSync(path.join(wt, '.gitignore'), 'blocked_sub/\nreadable_sub/\n');
    h.git(wt, 'add', '.gitignore'); h.git(wt, 'commit', '-m', 'ignore the fixture dirs');
    fs.mkdirSync(readable, { recursive: true });
    fs.mkdirSync(blocked, { recursive: true });
    fs.writeFileSync(path.join(readable, 'f'), Buffer.alloc(102_400));   // 100 kB, du CAN see
    fs.writeFileSync(path.join(blocked, 'f'), Buffer.alloc(921_600));    // 900 kB, du CANNOT
    fs.chmodSync(blocked, 0o000);
    try {
      const m = JSON.parse(h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin >/dev/null; `
        + `cat "$HOME/.cc-sessions/demo-quiet-basin.archivemanifest"`)) as Record<string, unknown>;
      expect(m.worktreeBytes).toBeNull();
    } finally {
      // rmSync cannot recurse into a 0o000 directory — without this the
      // harness's own cleanup throws and leaks the fixture HOME.
      fs.chmodSync(blocked, 0o755);
    }
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

  it('refuses a tree it could only PARTIALLY read, instead of recording it pristine', () => {
    // Final-round integration review, item 5 / new finding 3 — closed on the
    // reap path, still open here. `git status --porcelain` over a partially
    // unreadable tree exits ZERO with EMPTY stdout and the diagnostic on
    // stderr alone, so `2>/dev/null` plus an exit-code test recorded
    // `"dirty":0` for a tree with uncommitted work in it. Measured on git 2.43
    // against this exact fixture — `chmod 000` on a TRACKED directory holding a
    // modified file:
    //     rc 0, stdout empty, stderr "tracked/deep/code.txt: Permission denied"
    //                                "warning: could not open directory 'tracked/'"
    //
    // NO STUB. A `git() { return 128; }` shadow — the technique the rung above
    // uses, and the right one for the exit-code case — cannot reproduce this at
    // all, because the whole point is that real git SUCCEEDS. This is the
    // lesson the ninth measurement forgery taught: a stub that does not
    // resemble the failure proves nothing about it.
    const wt = workspace('demo', 'quiet-basin');
    fs.mkdirSync(path.join(wt, 'tracked', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'tracked', 'deep', 'code.txt'), 'v1\n');
    h.git(wt, 'add', '-A'); h.git(wt, 'commit', '-m', 'tracked work');
    fs.writeFileSync(path.join(wt, 'tracked', 'deep', 'code.txt'), 'v2\n');   // uncommitted
    fs.chmodSync(path.join(wt, 'tracked'), 0o000);
    try {
      // The premise, asserted rather than assumed: real git really does answer
      // rc 0 with an empty porcelain here.
      expect(h.sh(`git -C "${wt}" status --porcelain 2>/dev/null; echo "rc=$?"`),
        'the fixture only means anything if git SUCCEEDS with an empty answer').toBe('rc=0');

      // THE DIRTY RUNG, ON ITS OWN. `_ws_ignored_digest` reads the same tree
      // under the same rule one line later, so without this stub either guard
      // alone would refuse and neither would be pinned — the same "one fixture
      // pins neither" shape `_ws_collect_ignored` records for its own two rungs.
      const OKDIGEST = `_ws_ignored_digest() { echo ${'a'.repeat(64)}; };`;
      const m = shFail(`${OKDIGEST} _ws_archive_manifest demo-quiet-basin`);
      expect(m.code, `stdout: ${m.stdout}`).not.toBe(0);
      expect(m.stdout, 'a refused manifest prints NOTHING — a partial record is the forgery').toBe('');
      expect(m.stderr).toMatch(/could not read the tree/);
      expect(m.stderr, 'and it says what git actually said').toMatch(/Permission denied/);

      // THE IGNORED-DIGEST RUNG, ON ITS OWN. `PIPESTATUS[0]` is 0 in this state
      // too, so before the fix the digest hashed a SHORT set and reported
      // success — a complete-looking digest over an incomplete set.
      const d = shFail(`_ws_ignored_digest "${wt}"`);
      expect(d.code).not.toBe(0);
      expect(d.stdout).toBe('');

      // AND THE VERB REFUSES, so nothing is staged for deletion off the back of
      // a record nobody could make.
      const r = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/cannot describe demo-quiet-basin truthfully/);
      expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
      expect(h.reg('demo-quiet-basin', 'archivemanifest')).toBeNull();
    } finally {
      fs.chmodSync(path.join(wt, 'tracked'), 0o755);
    }
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
    // `spawn_start`, not `spawn`: restore now calls the two halves so the claim
    // and the supervision land BEFORE the blocking settle (F8).
    expect(h.calls()).toContain('spawn_start demo-quiet-basin resume');
    expect(h.calls()).toContain('supervise demo-quiet-basin');
  });

  it('leaves the started flag set even when the entry never had one', () => {
    // Nothing in ccd ever clears `started`, so in the ordinary fixture this
    // assignment is a no-op and its deletion is invisible. The state it exists for
    // is an entry that never got one — ws-add is interrupted between `_spawn` and
    // `_reg_set started 1` — and the cost is not cosmetic: `cmd_ensure` and
    // `cmd_start` read this flag to choose `new` over `resume` (ccd:1431,
    // ccd:1440), so a restored session missing it gets re-spawned as a FRESH
    // session by the next supervise tick, discarding the transcript ws-restore
    // just resumed from.
    workspace('demo', 'quiet-basin');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.started'));
    h.sh(`${ARCH} cmd_ws_restore --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'started')).toBe('1');
  });

  it('refuses a session that is not archived', () => {
    workspace('demo', 'quiet-basin');
    expect(shFail(`${ARCH} cmd_ws_restore --session demo-quiet-basin`).stderr).toMatch(/not archived/);
  });

  it('refuses anything but the exact --session <id> shape', () => {
    // The same argv contract archive has, asserted for the verb that SPAWNS: an
    // id that is not an id reaches `$REG/$id.*` and `_spawn`, so the shape check
    // is the boundary, not a formality.
    for (const argv of ['cmd_ws_restore', 'cmd_ws_restore demo-quiet-basin',
                        'cmd_ws_restore --session', 'cmd_ws_restore --session a --session b']) {
      const r = shFail(argv);
      expect(r.code, argv).toBe(1);
      expect(r.stderr, argv).toMatch(/usage: ccd ws-restore --session <id>/);
    }
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

describe('ws-restore propagates a failed spawn', () => {
  // The same plan-level gap ws-add has, mirrored on the restore path:
  // `_spawn` failing (rc 3 or rc 4) must not print `restored <id> — <workdir>`
  // over a session that never came back — M6's silent success.
  const restoreWithSpawnRc = (rc: number): string =>
    `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };
     _ws_supervise() { echo "supervise $1" >> "$HOME/ccd-calls"; };
     _spawn() { echo "spawn $1 $2" >> "$HOME/ccd-calls"; return ${rc}; };
     _spawn_start() { echo "spawn_start $1 $2" >> "$HOME/ccd-calls"; SPAWN_FROMSWAP=0; };
     _spawn_settle() { echo "spawn_settle $1" >> "$HOME/ccd-calls"; return ${rc}; };
     tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };
     _session_verdict() { echo gone; };`;

  it('refuses the success line and returns the rc on a vanished-session spawn (rc 3)', () => {
    workspace('demo', 'quiet-basin');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    const r = shFail(`${restoreWithSpawnRc(3)} cmd_ws_restore --session demo-quiet-basin`);
    expect(r.code).toBe(3);
    expect(r.stdout).not.toMatch(/^restored /);
    // The undo IS complete regardless — the archive stamps are gone whether or
    // not the revived spawn came up, or the row is stuck archived with nothing
    // left to un-archive it on a retry.
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
  });

  it('does the same on rc 4 (startup window expired)', () => {
    workspace('demo', 'quiet-basin');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    const r = shFail(`${restoreWithSpawnRc(4)} cmd_ws_restore --session demo-quiet-basin`);
    expect(r.code).toBe(4);
    expect(r.stdout).not.toMatch(/^restored /);
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
    // ...and the arity rung is not what caught it — asserted by its own message,
    // since `-ge 2` would refuse the three-argument form as a missing session.
    for (const argv of ['cmd_ws_attic --session', 'cmd_ws_attic --session a b']) {
      const a = shFail(argv);
      expect(a.code, argv).toBe(1);
      expect(a.stderr, argv).toMatch(/usage: ccd ws-attic --session <id> \| ccd ws-attic --drop <id>/);
    }
  });
});

describe('the archive manifest is written atomically (registry-durability wave 2)', () => {
  it('rides _reg_set and KEEPS its trailing newline — the bytes do not move', () => {
    // The manifest was `printf '%s\n' "$manifest" > …`, and `_reg_set` adds no
    // newline of its own, so the newline is passed IN THE VALUE. Its one
    // consumer (`manifestBytes`, server/src/registry.ts:363) runs JSON.parse
    // and would not notice either way — which is exactly why the bytes are
    // preserved deliberately rather than by luck: a migration that also
    // changes what is on disk is two changes wearing one commit.
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src).not.toMatch(/>\s*"\$REG\/\$id\.archivemanifest"/);
    expect(src).toMatch(/_reg_set "\$id" archivemanifest "\$manifest"\$'\\n'/);
  });

  it('and the file on disk still ENDS IN A NEWLINE and still parses as the manifest', () => {
    // The behavioural half — a source scan alone would pass on a migration
    // that dropped the newline, which is the one byte this task exists to
    // preserve. Written against the helper directly rather than a whole
    // ws-archive run, so it pins the BYTES without depending on a fixture
    // worktree, a gh row, or systemd.
    const h2 = makeCcdHarness('ccrc-ccd-manifestbytes-');
    try {
      h2.sh(`_reg_set demo-quiet-basin archivemanifest '{"worktreeBytes":4096}'$'\\n'`);
      const raw = fs.readFileSync(
        path.join(h2.home, '.cc-sessions', 'demo-quiet-basin.archivemanifest'), 'utf8');
      expect(raw).toBe('{"worktreeBytes":4096}\n');
      expect(JSON.parse(raw).worktreeBytes).toBe(4096);
    } finally { h2.cleanup(); }
  });
});
