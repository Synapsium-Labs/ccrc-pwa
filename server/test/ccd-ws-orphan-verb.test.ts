// DR-17 (D-6629, spec 2026-10-23 §2.3, §2.6.2): `ccd ws-orphan`, the SERVER's act on an orphaned worktree, behind a
// token the audit (`ws-audit --orphan-hex`) minted and the verb re-proves inside its lock. Every case runs under a
// FIXTURE HOME; nothing here touches a live box. The holder probe, the working-directory probe and the idle walk are
// stubbed exactly as `ccd-orphan-audit.test.ts` stubs them (the verb calls the same ladder, so the same seams apply).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, CCD_ENTRY, type CcdHarness } from './ccdWsHelpers.js';
import { readJournal } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ws-orphan-'); h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

const real = (p: string): string => fs.realpathSync(p);
const hex = (p: string): string => Buffer.from(p).toString('hex');
const sha16 = (p: string): string => createHash('sha256').update(p).digest('hex').slice(0, 16);
const NOW = Math.floor(Date.now() / 1000);
const STUBS = '_ws_cwd_users() { return 0; };'
  + ' _ws_path_users_many() { local i; _WS_PATH_USERS_RCS=(); _WS_PATH_USERS_PIDS_OF=(); _WS_PATH_USERS_WHY_OF=();'
  + ' for i in "$@"; do _WS_PATH_USERS_RCS+=(0); _WS_PATH_USERS_PIDS_OF+=(""); _WS_PATH_USERS_WHY_OF+=(""); done; return 0; };'
  + ` _ws_collect_idle() { _WS_IDLE_NEWEST_NS="${NOW - 8 * 86400}000000000"; _WS_IDLE_COUNT=7; _WS_IDLE_WHY=''; _WS_IDLE_DETAIL=''; return 0; };`;

const main = (): string => path.join(h.home, 'projects', 'demo');
const tree = (at: string, branch: string): string => {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  h.git(main(), 'worktree', 'add', '-b', branch, at);
  return real(at);
};
const claudeTree = (name = 'agent-a'): string => tree(path.join(main(), '.claude', 'worktrees', name), `claude/${name}`);
const ccdRoot = (slug = 'still-cove'): string => tree(path.join(h.home, 'worktrees', 'demo', slug), `ws/${slug}`);

interface Audit { verdict: string; refusal: string | null; detail: string; token: string | null; rescueToken: string | null }
const audit = (p: string, pre = STUBS): Audit =>
  JSON.parse(h.sh(`${pre} _ws_orphan_audit ${hex(p)} || true`).trim().split('\n').pop()!) as Audit;
const tokenOf = (p: string): string => { const a = audit(p); expect(a.token, a.detail).toMatch(/^[0-9a-f]{64}$/); return a.token!; };
const rescueOf = (p: string): string => { const a = audit(p); expect(a.rescueToken, a.detail).toMatch(/^[0-9a-f]{64}$/); return a.rescueToken!; };

interface Out { code: number; doc: Record<string, unknown> }
/** Runs the verb; the last stdout line is its document. `rc` is the verb's exit status. */
const orphan = (p: string, token: string, flags = '', pre = STUBS): Out => {
  const out = h.sh(`${pre} cmd_ws_orphan --expect ${token} --tree-hex ${hex(p)} ${flags}; echo "rc=$?"`);
  const lines = out.trim().split('\n');
  const rc = Number(/^rc=(\d+)$/.exec(lines.pop()!)![1]);
  return { code: rc, doc: JSON.parse(lines.pop() ?? '{}') as Record<string, unknown> };
};
const branches = (): string[] => h.git(main(), 'branch', '--format=%(refname:short)').split('\n').filter(Boolean);
const pushCommit = (t: string, branch: string): void => {
  fs.writeFileSync(path.join(t, 'work.txt'), 'w\n'); h.git(t, 'add', 'work.txt'); h.git(t, 'commit', '-m', 'wip');
  void branch;
};

describe('the act: a token from the audit removes the tree', () => {
  it('a clean `claude` tree is removed and its branch stays', () => {
    const t = claudeTree();
    const r = orphan(t, tokenOf(t));
    expect(r.code, JSON.stringify(r.doc)).toBe(0);
    expect(r.doc).toMatchObject({ removed: true, class: 'claude', branch: 'left' });
    expect(fs.existsSync(t)).toBe(false);
    expect(branches()).toContain('claude/agent-a');
  }, 60_000);

  it('a `ccd-root` tree’s branch is deleted with -d', () => {
    const t = ccdRoot();
    const r = orphan(t, tokenOf(t));
    expect(r.doc).toMatchObject({ removed: true, class: 'ccd-root', branch: 'deleted' });
    expect(fs.existsSync(t)).toBe(false);
    expect(branches()).not.toContain('ws/still-cove');
  }, 60_000);

  it('a `ccd-root` branch checked out in a second worktree is kept (branch-kept)', () => {
    const t = ccdRoot();
    const other = path.join(h.home, 'other-checkout');
    h.git(main(), 'worktree', 'add', '--force', other, 'ws/still-cove');
    const r = orphan(t, tokenOf(t));
    expect(r.doc).toMatchObject({ removed: true, branch: 'branch-kept' });
    expect(fs.existsSync(t)).toBe(false);
    expect(branches()).toContain('ws/still-cove');
  }, 60_000);

  it('a `ccd-root` branch git will not delete with -d is kept (branch-kept), and the tree is still gone', () => {
    const t = ccdRoot();
    // a commit pushed under another name is on a remote (the tree passes), yet not merged into the main checkout's HEAD
    fs.writeFileSync(path.join(t, 'work.txt'), 'w\n'); h.git(t, 'add', 'work.txt'); h.git(t, 'commit', '-m', 'wip');
    h.git(t, 'push', 'origin', 'HEAD:refs/heads/elsewhere');
    const r = orphan(t, tokenOf(t));
    expect(r.doc).toMatchObject({ removed: true, branch: 'branch-kept' });
    expect(fs.existsSync(t)).toBe(false);
    expect(branches()).toContain('ws/still-cove');
  }, 60_000);

  it('the journal holds an intent and then a done, both under verb ws-orphan', () => {
    const t = claudeTree();
    orphan(t, tokenOf(t));
    const ev = readJournal(h.home).filter((e) => (e['verb'] ?? (e['meas'] as Record<string, string> | undefined)?.['verb']) === 'ws-orphan'
      || JSON.stringify(e).includes('ws-orphan'));
    expect(ev.map((e) => e['outcome'])).toEqual(['intent', 'done']);
    expect(ev[0]!['tx']).toBe(ev[1]!['tx']);
  }, 60_000);

  it('git is never handed --force (a recording shim)', () => {
    const t = claudeTree();
    const tok = tokenOf(t);
    const log = path.join(h.home, 'git-argv');
    const shim = `git() { printf '%s\\n' "$*" >> "${log}"; command git "$@"; };`;
    const r = orphan(t, tok, '', `${STUBS} ${shim}`);
    expect(r.doc).toMatchObject({ removed: true });
    const argv = fs.readFileSync(log, 'utf8');
    expect(argv).toContain('worktree remove');
    expect(argv).not.toMatch(/--force|\s-f(\s|$)|\s-D(\s|$)/);
  }, 60_000);
});

describe('the act: re-proved inside the lock, stopped by anything that moved', () => {
  it('a file added between the audit and the verb answers state-changed, and the tree stays', () => {
    const t = claudeTree();
    const tok = tokenOf(t);
    fs.writeFileSync(path.join(t, 'late.txt'), 'x\n');
    const r = orphan(t, tok);
    expect(r.code).toBe(0);
    expect(r.doc['refused']).toBe('state-changed');
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('a token minted for another tree answers state-changed', () => {
    const a = claudeTree('agent-a'); const b = claudeTree('agent-b');
    const r = orphan(b, tokenOf(a));
    expect(r.doc['refused']).toBe('state-changed');
    expect(fs.existsSync(b)).toBe(true);
  }, 60_000);

  it('a holder appearing after the recompute stops the act (the last ask, nearest the removal)', () => {
    const t = claudeTree();
    const tok = tokenOf(t);
    const appear = '_ws_orphan_gap() { if [[ "$1" == recomputed ]]; then _ws_path_users_many() { local i; _WS_PATH_USERS_RCS=(); _WS_PATH_USERS_PIDS_OF=(); _WS_PATH_USERS_WHY_OF=();'
      + ' for i in "$@"; do _WS_PATH_USERS_RCS+=(1); _WS_PATH_USERS_PIDS_OF+=("77"); _WS_PATH_USERS_WHY_OF+=("process 77 holds it"); done; return 0; }; fi; };';
    const r = orphan(t, tok, '', `${STUBS} ${appear}`);
    expect(r.doc['refused']).toBe('in-use');
    expect(fs.existsSync(t)).toBe(true);
    const outcomes = readJournal(h.home).filter((e) => JSON.stringify(e).includes('ws-orphan')).map((e) => e['outcome']);
    expect(outcomes).toEqual(['intent', 'refused']);
  }, 60_000);

  it('a contended lock answers locked-elsewhere, and nothing is removed', () => {
    const t = claudeTree();
    const tok = tokenOf(t);
    const lock = path.join(h.home, '.cc-sessions', `.orphan-${sha16(t)}.lock`);
    const r = orphan(t, tok, '', `exec {held}>>"${lock}"; flock -n "$held"; ${STUBS}`);
    expect(r.doc['refused']).toBe('locked-elsewhere');
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('a unreadable answer (the holder probe could not be asked) is a failure to retry, never a removal', () => {
    const t = claudeTree();
    const tok = tokenOf(t);
    const unm = '_ws_path_users_many() { local i; _WS_PATH_USERS_RCS=(); _WS_PATH_USERS_PIDS_OF=(); _WS_PATH_USERS_WHY_OF=(); for i in "$@"; do _WS_PATH_USERS_RCS+=(2); _WS_PATH_USERS_PIDS_OF+=(""); _WS_PATH_USERS_WHY_OF+=("the walk failed"); done; return 0; };';
    const r = orphan(t, tok, '', `${STUBS} ${unm}`);
    expect(r.code).toBe(1);
    expect(r.doc['failed']).toBe('probe-unmeasured');
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('git’s own refusal is worktree-remove-failed, terminal for the token, and the tree is left', () => {
    const t = claudeTree();
    const tok = tokenOf(t);
    const refuse = 'git() { if [[ "$*" == *"worktree remove"* ]]; then echo "fatal: refused" >&2; return 128; fi; command git "$@"; };';
    const r = orphan(t, tok, '', `${STUBS} ${refuse}`);
    expect(r.code).toBe(1);
    expect(r.doc['failed']).toBe('worktree-remove-failed');
    expect(fs.existsSync(t)).toBe(true);
    const outcomes = readJournal(h.home).filter((e) => JSON.stringify(e).includes('ws-orphan')).map((e) => e['outcome']);
    expect(outcomes).toEqual(['intent', 'failed']);
  }, 60_000);
});

describe('the rescue arm', () => {
  it('--rescue without a rescue token (the tree needs none) refuses', () => {
    const t = claudeTree();
    const r = orphan(t, tokenOf(t), '--rescue');
    expect(r.doc['refused']).toBe('no-rescue-token');
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('a tree with a commit on no remote is refused without --rescue, even with its rescue token', () => {
    const t = claudeTree();
    pushCommit(t, 'claude/agent-a');
    const r = orphan(t, rescueOf(t));
    expect(r.doc['refused']).toBe('head-not-on-remote');
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('--rescue pins HEAD and the reflog shas under the attic, then removes', () => {
    const t = claudeTree();
    pushCommit(t, 'claude/agent-a');
    // amend away the commit: it survives only in this tree's own reflog, which `worktree remove` deletes
    const amendedAway = h.git(t, 'rev-parse', 'HEAD');
    h.git(t, 'commit', '--amend', '-m', 'b');
    const head = h.git(t, 'rev-parse', 'HEAD');
    expect(head).not.toBe(amendedAway);
    const r = orphan(t, rescueOf(t), '--rescue');
    expect(r.code, JSON.stringify(r.doc)).toBe(0);
    expect(r.doc).toMatchObject({ removed: true });
    expect(fs.existsSync(t)).toBe(false);
    const refs = h.git(main(), 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/orphan/${sha16(t)}/`).split('\n');
    expect(refs).toContain(`refs/ccrc/attic/orphan/${sha16(t)}/${head}`);
    expect(refs).toContain(`refs/ccrc/attic/orphan/${sha16(t)}/${amendedAway}`);
    expect(Number(r.doc['pinned'])).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('--rescue pins the TREE’s own reflog, not the 200 first shas of every reflog in the shared repository', () => {
    const t = claudeTree();
    pushCommit(t, 'claude/agent-a');
    const amendedAway = h.git(t, 'rev-parse', 'HEAD');
    h.git(t, 'commit', '--amend', '-m', 'b');
    const head = h.git(t, 'rev-parse', 'HEAD');
    // 205 commits on other branches, each with its own reflog entry, every one sorting BEFORE the amended-away sha:
    // under a shared `reflog show --all | sort -u | head -200` they would fill the cap and push it out.
    const gen = spawnSync('bash', ['-c', [
      'n=0; i=0; lim="$1"',
      'while (( n < 205 )); do i=$((i+1))',
      '  c=$(git commit-tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904 -m "f$i") || exit 1',
      '  if [[ "$c" < "$lim" ]]; then git update-ref -m x "refs/heads/foreign/$n" "$c" || exit 1; n=$((n+1)); fi',
      '  (( i < 20000 )) || exit 2',
      'done'].join('\n'), 'gen', amendedAway], { cwd: main(), env: ghContainedEnv(h.home, h.env({ GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' }), { systemd: true, tmux: true }), encoding: 'utf8' });
    expect(gen.status, gen.stderr).toBe(0);
    const foreign = h.git(main(), 'for-each-ref', '--format=%(objectname)', 'refs/heads/foreign/').split('\n').filter(Boolean);
    expect(foreign.length).toBe(205);
    const r = orphan(t, rescueOf(t), '--rescue');
    expect(r.code, JSON.stringify(r.doc)).toBe(0);
    const refs = h.git(main(), 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/orphan/${sha16(t)}/`).split('\n').filter(Boolean);
    expect(refs).toContain(`refs/ccrc/attic/orphan/${sha16(t)}/${head}`);
    expect(refs).toContain(`refs/ccrc/attic/orphan/${sha16(t)}/${amendedAway}`);
    for (const f of foreign) expect(refs).not.toContain(`refs/ccrc/attic/orphan/${sha16(t)}/${f}`);
  }, 120_000);

  it('--rescue pins EVERY sha of a tree whose HEAD reflog is longer than 200 (the tree is removed)', () => {
    const t = claudeTree();
    pushCommit(t, 'claude/agent-a');
    // 240 amends: more distinct HEAD-reflog shas than the shared-helper cap of 200
    const gen = spawnSync('bash', ['-c', 'for i in $(seq 1 240); do git commit -q --amend -m "a$i" || exit 1; done'], { cwd: t, env: ghContainedEnv(h.home, h.env({ GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' }), { systemd: true, tmux: true }), encoding: 'utf8' });
    expect(gen.status, gen.stderr).toBe(0);
    const shas = [...new Set(h.git(t, 'reflog', 'show', 'HEAD', '--format=%H').split('\n').filter(Boolean))];
    expect(shas.length).toBeGreaterThan(200);
    const r = orphan(t, rescueOf(t), '--rescue');
    expect(r.code, JSON.stringify(r.doc)).toBe(0);
    expect(r.doc['removed']).toBe(true);
    expect(fs.existsSync(t)).toBe(false);
    const refs = h.git(main(), 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/orphan/${sha16(t)}/`).split('\n').filter(Boolean);
    for (const s of shas) expect(refs).toContain(`refs/ccrc/attic/orphan/${sha16(t)}/${s}`);
  }, 180_000);

  it('a partial pin (one reflog sha cannot be pinned) removes nothing and fails pin-failed', () => {
    const t = claudeTree();
    pushCommit(t, 'claude/agent-a');
    const amendedAway = h.git(t, 'rev-parse', 'HEAD');
    h.git(t, 'commit', '--amend', '-m', 'amended');
    const tok = rescueOf(t);
    const failOne = `git() { if [[ "$*" == *update-ref* && "$*" == *${amendedAway}* ]]; then return 1; fi; command git "$@"; };`;
    const r = orphan(t, tok, '--rescue', `${STUBS} ${failOne}`);
    expect(r.code).toBe(1);
    expect(r.doc['failed'], JSON.stringify(r.doc)).toBe('pin-failed');
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('a failed pin removes nothing', () => {
    const t = claudeTree();
    pushCommit(t, 'claude/agent-a');
    const tok = rescueOf(t);
    const nopin = 'git() { if [[ "$*" == *update-ref* ]]; then return 1; fi; command git "$@"; };';
    const r = orphan(t, tok, '--rescue', `${STUBS} ${nopin}`);
    expect(r.code).toBe(1);
    expect(r.doc['failed']).toBe('pin-failed');
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('the pin lands before the removal (the order is the safety)', () => {
    const t = claudeTree();
    pushCommit(t, 'claude/agent-a');
    const tok = rescueOf(t);
    const log = path.join(h.home, 'order');
    const shim = `git() { case "$*" in *update-ref*) echo pin >> "${log}";; *"worktree remove"*) echo remove >> "${log}";; esac; command git "$@"; };`;
    orphan(t, tok, '--rescue', `${STUBS} ${shim}`);
    const order = fs.readFileSync(log, 'utf8').trim().split('\n');
    expect(order[0]).toBe('pin');
    expect(order[order.length - 1]).toBe('remove');
  }, 60_000);
});

describe('reachable only as the server’s act', () => {
  it('ccd caps advertises the verb and its capability token', () => {
    const adv = h.sh('cmd_caps').split('\n');
    expect(adv).toContain('ws-orphan');
    expect(adv).toContain('orphan-v1');
  }, 60_000);

  it('the dispatcher routes ws-orphan to its own usage, and the unknown-verb line names it', () => {
    const env = ghContainedEnv(h.home, h.env(), { systemd: true, tmux: true });
    const r = spawnSync('bash', ['-p', CCD, 'ws-orphan'], { env, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('usage: ccd ws-orphan');
    const u = spawnSync('bash', ['-p', CCD, 'no-such-verb'], { env, encoding: 'utf8' });
    expect(u.stderr).toContain('|ws-orphan|');
  }, 60_000);

  it('an unprivileged explicit bash is refused at entry — nothing runs', () => {
    const r = spawnSync('bash', [CCD, 'ws-orphan', '--expect', 'a'.repeat(64), '--tree-hex', '2f'], { env: ghContainedEnv(h.home, h.env(), { systemd: true, tmux: true }), encoding: 'utf8' });
    expect(r.status).toBe(125);
    expect(r.stderr).toContain('refused (entry-unprivileged)');
  }, 60_000);

  it('the installed launcher classifies ws-orphan as protected, folding case', () => {
    const py = 'import importlib.util,sys\n'
      + 's=importlib.util.spec_from_file_location("e",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n'
      + 'print(m.is_protected(["ws-orphan"]),m.is_protected(["WS-Orphan","--expect"]),m.is_protected(["ws-orphanx"]))';
    const r = spawnSync('python3', ['-I', '-c', py, CCD_ENTRY], { encoding: 'utf8' });
    expect(r.stdout.trim(), r.stderr).toBe('True True False');
  }, 60_000);

  it('bad input is a usage error before any lock or journal row', () => {
    for (const args of ['', '--expect zz --tree-hex 2f', `--expect ${'a'.repeat(64)} --tree-hex zz`, `--expect ${'a'.repeat(64)}`]) {
      expect(() => h.sh(`cmd_ws_orphan ${args}`), args).toThrow();
    }
    expect(readJournal(h.home).filter((e) => JSON.stringify(e).includes('ws-orphan'))).toEqual([]);
  }, 60_000);
});

// DR-22 (D-6634, spec §2.7.1): under `$REG/nested-rescue-live` a tree whose only blocker is a nested checkout carries a RESCUE
// token. The verb pins or rescues each nested checkout under refs/ccrc/attic/orphan/<sha16>/nested/<pathhex>/, re-proves it,
// asks the holder once more, removes each nested directory itself, and only then runs git's own (never forced) removal.
describe('the nested-checkout rescue (DR-22)', () => {
  const MARKER = (): string => path.join(h.home, '.cc-sessions', 'nested-rescue-live');
  const arm = (): void => { fs.writeFileSync(MARKER(), ''); fs.appendFileSync(path.join(main(), '.git', 'info', 'exclude'), 'nested/\ninner-wt/\n'); };
  const base = (t: string, rel: string): string => `refs/ccrc/attic/orphan/${sha16(t)}/nested/${hex(rel)}`;
  /** A repository of another project inside `t`: one commit on no remote and an untracked file. */
  const foreign = (t: string): string => {
    const d = path.join(t, 'nested');
    fs.mkdirSync(d); h.git(d, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(d, 'a.txt'), 'a\n'); h.git(d, 'add', 'a.txt'); h.git(d, 'commit', '-q', '-m', 'a');
    fs.writeFileSync(path.join(d, 'loose.txt'), 'loose\n');
    return d;
  };
  /** A linked worktree of the tree's OWN repository inside `t`, with a commit on no remote and an untracked file. */
  const sameRepo = (t: string): string => {
    const d = path.join(t, 'inner-wt');
    h.git(main(), 'worktree', 'add', '-b', 'inner/x', d);
    fs.writeFileSync(path.join(d, 'inner.txt'), 'i\n'); h.git(d, 'add', 'inner.txt'); h.git(d, 'commit', '-q', '-m', 'inner');
    fs.writeFileSync(path.join(d, 'loose.txt'), 'loose\n');
    return real(d);
  };
  /** A fake process table: the verb's own shell only, until `FP_ADD` puts a process that maps a file under `under` into it. */
  const FP_BASE = 'rm -rf "$HOME/fp"; FU="$(id -u)"; _fpp() { mkdir -p "$HOME/fp/$1/fd";'
    + ' printf "Name:\\tx\\nPPid:\\t%s\\nUid:\\t%s\\t%s\\t%s\\t%s\\n" "$2" "$3" "$3" "$3" "$3" > "$HOME/fp/$1/status"; : > "$HOME/fp/$1/environ"; ln -sfn / "$HOME/fp/$1/cwd"; mkdir -p "$HOME/fp/$1/map_files"; };'
    + ' _fpp $$ 1 "$FU"; _ws_path_users_proc_root() { printf %s "$HOME/fp"; };'
    + ' eval "$(declare -f _ws_path_users_many | sed \'1s/_ws_path_users_many/_pum_orig/\')"; _ws_path_users_many() { local CCD_OS=linux; _fpp "$BASHPID" 1 "$FU"; _pum_orig "$@"; };';
  const FP_ADD = (under: string): string => `_fpp 4242 1 "$FU"; mkdir -p "$HOME/fp/4242/map_files"; ln -sfn "${under}/lib.so" "$HOME/fp/4242/map_files/7f00-7f10";`;

  it('a foreign nested repository is rescued under the attic, its directory removed, the tree removed, and git saw no --force', () => {
    const t = claudeTree(); arm(); const n = foreign(t);
    const nhead = h.git(n, 'rev-parse', 'HEAD');
    const tok = rescueOf(t);
    const log = path.join(h.home, 'git-argv');
    const r = orphan(t, tok, '--rescue', `${STUBS} git() { printf '%s\\n' "$*" >> "${log}"; command git "$@"; };`);
    expect(r.code, JSON.stringify(r.doc)).toBe(0);
    expect(r.doc).toMatchObject({ removed: true });
    expect(fs.existsSync(t)).toBe(false);
    const b = base(t, 'nested');
    expect(h.git(main(), 'rev-parse', `${b}/head`)).toBe(nhead);
    const wip = h.git(main(), 'rev-parse', `${b}/wip`);
    expect(h.git(main(), 'ls-tree', '-r', '--name-only', wip).split('\n')).toContain('loose.txt');
    expect(fs.readFileSync(log, 'utf8')).not.toMatch(/--force|\s-f(\s|$)/);
  }, 90_000);

  it('a same-repository nested checkout is pinned (HEAD, the uncommitted work, the reflog) and removed with the tree', () => {
    const t = claudeTree(); arm(); const d = sameRepo(t);
    const dhead = h.git(d, 'rev-parse', 'HEAD');
    const r = orphan(t, rescueOf(t), '--rescue');
    expect(r.code, JSON.stringify(r.doc)).toBe(0);
    expect(fs.existsSync(t)).toBe(false);
    const b = base(t, 'inner-wt');
    expect(h.git(main(), 'rev-parse', `${b}/head`)).toBe(dhead);
    expect(h.git(main(), 'ls-tree', '-r', '--name-only', h.git(main(), 'rev-parse', `${b}/wip`)).split('\n')).toContain('loose.txt');
    expect(h.git(main(), 'rev-parse', `${b}/reflog/${dhead}`)).toBe(dhead);
  }, 90_000);

  it('the rescue token without --rescue refuses nested-checkout, and nothing is pinned or removed', () => {
    const t = claudeTree(); arm(); const n = foreign(t);
    const r = orphan(t, rescueOf(t));
    expect(r.doc['refused']).toBe('nested-checkout');
    expect(fs.existsSync(n)).toBe(true);
    expect(h.git(main(), 'for-each-ref', `refs/ccrc/attic/orphan/${sha16(t)}/`)).toBe('');
  }, 60_000);

  it('a commit made in the nested repository after the audit answers state-changed (the token binds it)', () => {
    const t = claudeTree(); arm(); const n = foreign(t);
    // the tree's own ignored-set digest is held constant, so only the nested binding can see the commit
    const constIgnored = '_ws_gc_reclaimable() { REAP_SENSITIVE=(); REAP_IGNORED=(); REAP_IGNDIGEST=$(printf "" | _plat_sha256 | cut -d" " -f1); return 0; };';
    const pre = `${STUBS} ${constIgnored}`;
    const a = audit(t, pre); expect(a.rescueToken, a.detail).toBeTruthy();
    fs.writeFileSync(path.join(n, 'b.txt'), 'b\n'); h.git(n, 'add', 'b.txt'); h.git(n, 'commit', '-q', '-m', 'b');
    const r = orphan(t, a.rescueToken!, '--rescue', pre);
    expect(r.doc['refused']).toBe('state-changed');
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('a holder in the nested directory stops the act, with the tree and the nested directory whole', () => {
    const t = claudeTree(); arm(); const n = foreign(t);
    const tok = rescueOf(t);
    const quiet = STUBS.replace(/ _ws_path_users_many\(\) \{.*?return 0; \};/s, '');
    const gap = `_ws_orphan_gap() { if [[ "$1" == pinned ]]; then ${FP_ADD(n)} fi; };`;
    const r = orphan(t, tok, '--rescue', `${quiet} ${FP_BASE} ${gap}`);
    expect(r.doc['refused'], JSON.stringify(r.doc)).toBe('in-use');
    expect(fs.existsSync(t)).toBe(true);
    expect(fs.existsSync(path.join(n, 'loose.txt'))).toBe(true);
  }, 90_000);

  it('a rescue whose fetch fails removes nothing (pin-failed)', () => {
    const t = claudeTree(); arm(); const n = foreign(t);
    const tok = rescueOf(t);
    const r = orphan(t, tok, '--rescue', `${STUBS} git() { if [[ "$*" == *fetch* ]]; then return 1; fi; command git "$@"; };`);
    expect(r.code).toBe(1);
    expect(r.doc['failed']).toBe('pin-failed');
    expect(fs.existsSync(t)).toBe(true);
    expect(fs.existsSync(path.join(n, 'loose.txt'))).toBe(true);
  }, 90_000);

  it('the nested directory is removed by the collector’s removal before git’s, and git is asked only after it', () => {
    const t = claudeTree(); arm(); foreign(t);
    const tok = rescueOf(t);
    const log = path.join(h.home, 'order');
    const shim = `_ws_leaf_remove_real="$(declare -f _ws_leaf_remove)"; eval "\${_ws_leaf_remove_real/_ws_leaf_remove/_ws_leaf_remove_orig}";`
      + ` _ws_leaf_remove() { echo leaf >> "${log}"; _ws_leaf_remove_orig "$@"; }; git() { case "$*" in *"worktree remove"*) echo remove >> "${log}";; esac; command git "$@"; };`;
    const r = orphan(t, tok, '--rescue', `${STUBS} ${shim}`);
    expect(r.code, JSON.stringify(r.doc)).toBe(0);
    expect(fs.readFileSync(log, 'utf8').trim().split('\n')).toEqual(['leaf', 'remove']);
  }, 90_000);
});
