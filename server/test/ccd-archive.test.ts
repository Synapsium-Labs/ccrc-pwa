// ws-archive / ws-restore / ws-attic and the caps list, under the isolated
// HOME harness. HOME is the only isolation boundary ccd has: PROJECTS_ROOT and
// WORKTREES_ROOT derive from it and take no override, which is what stops any
// of this reaching a real repository.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeCcdHarness, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

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

describe('ccd caps', () => {
  it('advertises exactly the verbs the dispatcher implements', () => {
    // The deployed ~/.local/bin/ccd is a COPY, not a symlink to the repo, so a
    // verb can pass the agent whitelist and still not exist on the box. This
    // list is what the agent reports; a list that drifts from the dispatcher
    // is worse than none, because the server would trust it.
    const src = fs.readFileSync(CCD, 'utf8');
    const block = src.slice(src.indexOf('case "${1:-}" in'));
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

  it('names the PR in archivedreason when the registry knows one', () => {
    workspace('demo', 'quiet-basin');
    h.sh('_reg_set demo-quiet-basin prnumber 42');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'archivedreason')).toBe('merged:#42');
  });

  it('writes the manifest into the REGISTRY, never into the worktree', () => {
    const wt = workspace('demo', 'quiet-basin');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    const m = JSON.parse(h.reg('demo-quiet-basin', 'archivemanifest')!) as Record<string, unknown>;
    expect(m.branch).toBe('ws/quiet-basin');
    expect(m.base).toBe('origin/main');
    expect(m.tip).toMatch(/^[0-9a-f]{40}$/);
    expect(m.dirty).toBe(0);
    expect(m.stashes).toBe(0);
    expect(m.ignoredDigest).toBe(SHA256_EMPTY);     // nothing ignored, read OK
    expect(typeof m.worktreeBytes).toBe('number');
    expect(String(m.transcript)).toContain('.claude/projects/');
    // The manifest describes the thing that may later be deleted, so it cannot
    // live inside it.
    expect(fs.existsSync(path.join(wt, '.archivemanifest'))).toBe(false);
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
    expect(h.reg('demo-quiet-basin', 'archived')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'archivemanifest')).toBeNull();
  });

  it('refuses when the registry names a branch git’s record does not', () => {
    workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    // $main really has both branches, so nothing else would stop it: the manifest
    // would record ws/other's tip as this workspace's, and ws-reap would compare
    // the wrong branch's state against the wrong tree.
    h.git(main, 'branch', 'ws/other', 'main');
    h.sh('_reg_set demo-quiet-basin branch ws/other');
    const r = shFail(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/registry says ws\/other/);
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
    expect(h.sh('cmd_ws_attic --drop demo-quiet-basin')).toMatch(/dropped 1 attic ref/);
    expect(h.sh('cmd_ws_attic --session demo-quiet-basin')).toBe('');
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
