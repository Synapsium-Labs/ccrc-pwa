// `_ws_leaf_checkouts` — the question `_ws_leaf_remove` asks of a DIRECTORY leaf
// before it removes anything (child reclamation wave 6, spec §5.5 and §5.6):
// does the leaf hold a checkout that git links to somewhere else? Another
// session's tree `mv`'d into a child's temp root or clips directory keeps its
// `.git` FILE, and that file still names the admin directory its repository
// keeps for it — a tree git records as living ELSEWHERE, or no longer records.
// The tail removes the leaf whole, so such a tree is refused, and kept.
// Three answers: 0 nothing linked elsewhere; 1 refused (the checkout named);
// 2 unmeasured (a walk or a read that did not finish). Every `.git` entry is
// asked without following: a link refuses, a directory (a clone, the leaf's own
// scratch) passes, a file is read AS A FILE — never by running git inside the
// leaf — and passes only when the admin directory it names lies inside the leaf,
// or is a linked worktree's whose `gitdir` back-link names this very `.git`.
// FIXTURE HOME ONLY: every repository, leaf and root is under the harness's
// HOME; the `find` shim is a script on PATH inside it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-leaf-checkouts-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
/** chmod for the case, restored (in reverse) before the HOME is removed. */
const chmodFor = (p: string, mode: number): void => {
  restore.push([p, fs.statSync(p).mode & 0o7777]);
  fs.chmodSync(p, mode);
};

const ID = 'demo-quiet-basin';
const ROOT_USER = process.getuid?.() === 0;
const rootOf = (): string => path.join(h.home, 'root');
const leafOf = (): string => path.join(rootOf(), ID);

interface Answer { rc: string; why: string }
/** The predicate's own answer: its rc and `_WS_CHECKOUTS_WHY`. */
const ask = (leaf: string, pre = ''): Answer => {
  const [rc = '', why = ''] = h.sh(`${pre} _ws_leaf_checkouts "${leaf}"; rc=$?;`
    + ' printf \'%s\\x1f%s\' "$rc" "$_WS_CHECKOUTS_WHY"').split('\x1f');
  return { rc, why };
};
/** The removal helper's answer: its rc and `_WS_LEAF_WHY`. */
const remove = (root: string, id: string, pre = ''): Answer => {
  const [rc = '', why = ''] = h.sh(`${pre} _ws_leaf_remove "${root}" "${id}"; rc=$?;`
    + ' printf \'%s\\x1f%s\' "$rc" "$_WS_LEAF_WHY"').split('\x1f');
  return { rc, why };
};

/** A linked worktree of a repository OUTSIDE the leaf, with an uncommitted file —
 *  another session's tree — then `mv`'d to `dest`. git's record now reads
 *  `prunable`, and the moved tree's `.git` still names the admin directory. */
const movedTree = (dest: string, name = 'still-harbor'): { main: string; admin: string } => {
  const main = fs.existsSync(path.join(h.home, 'projects', 'demo2')) ? path.join(h.home, 'projects', 'demo2') : h.makeRepo('demo2');
  const wt = path.join(h.home, 'worktrees', 'demo2', name);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  h.git(main, 'worktree', 'add', '-q', '-b', `ws/${name}`, wt);
  fs.writeFileSync(path.join(wt, 'precious.txt'), 'uncommitted work of another session\n');
  const admin = h.git(wt, 'rev-parse', '--absolute-git-dir');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(wt, dest);
  expect(fs.readFileSync(path.join(dest, '.git'), 'utf8').trim(), 'the CONTROL: the moved tree names its admin dir')
    .toBe(`gitdir: ${admin}`);
  return { main, admin };
};
/** A clone (a `.git` DIRECTORY) at `dest`, of a repository outside the leaf. */
const cloneAt = (dest: string): void => {
  const origin = path.join(h.home, 'origins', 'up.git');
  if (!fs.existsSync(origin)) h.makeRepo('up');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync('git', ['clone', '-q', origin, dest], { env: { ...inheritedEnv(), HOME: h.home } });
};

describe('_ws_leaf_checkouts — refused: rc 1, a checkout git records elsewhere', () => {
  it('a tree moved AS the leaf — its `.git` at depth 1 — is refused, by name', () => {
    fs.mkdirSync(rootOf());
    movedTree(leafOf());
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`${leafOf()}/.git`);
  }, 60_000);

  it('a moved worktree deeper in the leaf: its admin dir’s back-link names another tree', () => {
    const { admin } = movedTree(path.join(leafOf(), 'parked', 'still-harbor'));
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`${leafOf()}/parked/still-harbor/.git`);
    expect(a.why).toContain(admin);
  }, 60_000);

  it('the RECYCLED admin name: pruned, then re-created by a later worktree — it names that tree, not this one', () => {
    const { main, admin } = movedTree(path.join(leafOf(), 'parked', 'still-harbor'));
    h.git(main, 'worktree', 'prune');
    expect(fs.existsSync(admin), 'the CONTROL: prune took the moved tree’s admin dir').toBe(false);
    const later = path.join(h.home, 'later', 'still-harbor');
    fs.mkdirSync(path.dirname(later), { recursive: true });
    h.git(main, 'worktree', 'add', '-q', '-b', 'ws/later', later);
    expect(fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim(), 'the CONTROL: the same admin name, re-created')
      .toBe(`${later}/.git`);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`${later}/.git`);
  }, 60_000);

  it('a MISSING admin dir: git no longer records the tree', () => {
    const { admin } = movedTree(path.join(leafOf(), 'parked', 'still-harbor'));
    fs.rmSync(admin, { recursive: true });
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('no longer exists');
  }, 60_000);

  it('an admin dir with NO back-link file at all is refused', () => {
    const { admin } = movedTree(path.join(leafOf(), 'parked', 'still-harbor'));
    fs.rmSync(path.join(admin, 'gitdir'));
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('holds no record');
  }, 60_000);

  it('a `.git` that is a LINK is refused — ccd never follows it, and git would', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    fs.mkdirSync(path.join(h.home, 'elsewhere', '.git'), { recursive: true });
    fs.symlinkSync(path.join(h.home, 'elsewhere', '.git'), path.join(leafOf(), 'x', '.git'));
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('symbolic link');
  }, 60_000);

  it('a name holding a NEWLINE is read whole (NUL-separated): the moved tree under it is refused', () => {
    const { admin } = movedTree(path.join(leafOf(), 'a\nb', 'still-harbor'));
    fs.rmSync(admin, { recursive: true });
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`${leafOf()}/a\nb/still-harbor/.git`);
  }, 60_000);

  it('under a NEWLINE name whose admin dir still stands, a tree that is not provably the leaf’s is unmeasured — a physical path holding a newline is never resolved', () => {
    movedTree(path.join(leafOf(), 'a\nb', 'still-harbor'));
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain(`${leafOf()}/a\nb/still-harbor cannot be resolved`);
  }, 60_000);

  it('a refusal OUTRANKS an unmeasured entry, whichever order the walk lists them in', () => {
    movedTree(path.join(leafOf(), 'm', 'still-harbor'));
    for (const d of ['a', 'z']) {
      fs.mkdirSync(path.join(leafOf(), d), { recursive: true });
      fs.writeFileSync(path.join(leafOf(), d, '.git'), 'not a gitdir line\n');
    }
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
  }, 60_000);
});

describe('_ws_leaf_checkouts — passes: rc 0, the leaf’s own scratch', () => {
  it('an empty leaf, and a leaf with no `.git` anywhere', () => {
    fs.mkdirSync(path.join(leafOf(), 'cdk.out', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(leafOf(), 'cdk.out', 'manifest.json'), '{}');
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('a CLONE (a `.git` directory) passes', () => {
    cloneAt(path.join(leafOf(), 'clone'));
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('a self-back-linked scratch worktree of a repository OUTSIDE the leaf passes', () => {
    const main = h.makeRepo('demo2');
    h.git(main, 'worktree', 'add', '-q', '-b', 'scratch', path.join(leafOf(), 'scratch-wt'));
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('a SUBMODULE of a clone inside the leaf (a relative gitdir into that clone) passes', () => {
    h.makeRepo('sub');
    const clone = path.join(leafOf(), 'clone');
    cloneAt(clone);
    execFileSync('git', ['-C', clone, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q',
      path.join(h.home, 'origins', 'sub.git'), 'sub'], { env: { ...inheritedEnv(), HOME: h.home } });
    expect(fs.readFileSync(path.join(clone, 'sub', '.git'), 'utf8').trim(), 'the CONTROL: a relative gitdir')
      .toBe('gitdir: ../.git/modules/sub');
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('a worktree of a clone inside the leaf (its admin dir inside the leaf) passes', () => {
    const clone = path.join(leafOf(), 'clone');
    cloneAt(clone);
    h.git(clone, 'worktree', 'add', '-q', '-b', 'side', path.join(leafOf(), 'clone-wt'));
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('a clone under a name holding a NEWLINE passes', () => {
    cloneAt(path.join(leafOf(), 'c\nd', 'clone'));
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('0');
  }, 60_000);
});

describe('_ws_leaf_checkouts — unmeasured: rc 2, never "nothing there"', () => {
  for (const [label, body] of [
    ['not a gitdir line', 'not a gitdir line\n'],
    ['an empty path', 'gitdir: \n'],
    ['a second line', 'gitdir: /x\n/y\n'],
    ['a NUL byte', 'gitdir: /x\0/y\n'],
    ['an empty file', ''],
  ] as const) it(`a MALFORMED \`.git\` file — ${label} — is unmeasured: git cannot tell what it is, so neither can ccd`, () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    fs.writeFileSync(path.join(leafOf(), 'x', '.git'), body);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain(`${leafOf()}/x/.git`);
  }, 60_000);

  it('a `.git` file larger than any gitdir line is unmeasured', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    fs.writeFileSync(path.join(leafOf(), 'x', '.git'), `gitdir: /${'a'.repeat(5000)}\n`);
    expect(ask(leafOf()).rc).toBe('2');
  }, 60_000);

  it('a `.git` file of more than 4096 bytes is unmeasured even when its first 4096 would pass — it is never read in part', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    fs.mkdirSync(path.join(leafOf(), 'admin'));
    fs.writeFileSync(path.join(leafOf(), 'x', '.git'), `gitdir: ${path.join(leafOf(), 'admin')}\n`);
    expect(ask(leafOf()).rc, 'the CONTROL: the same line, alone, names a dir inside the leaf').toBe('0');
    fs.writeFileSync(path.join(leafOf(), 'x', '.git'), `gitdir: ${path.join(leafOf(), 'admin')}${'\n'.repeat(5000)}`);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('more than 4096 bytes');
  }, 60_000);

  it('a gitdir naming its admin dir through a `..` AFTER another component is unmeasured — a logical walk and git’s read it apart', () => {
    fs.mkdirSync(path.join(leafOf(), 'x', 'y'), { recursive: true });
    fs.writeFileSync(path.join(leafOf(), 'x', '.git'), 'gitdir: y/../y\n');
    expect(ask(leafOf()).rc, 'relative').toBe('2');
    fs.writeFileSync(path.join(leafOf(), 'x', '.git'), `gitdir: ${leafOf()}/x/y/../y\n`);
    expect(ask(leafOf()).rc, 'absolute').toBe('2');
  }, 60_000);

  it('a gitdir naming something that is not a directory is unmeasured', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    fs.writeFileSync(path.join(h.home, 'not-a-dir'), 'x');
    fs.writeFileSync(path.join(leafOf(), 'x', '.git'), `gitdir: ${path.join(h.home, 'not-a-dir')}\n`);
    expect(ask(leafOf()).rc).toBe('2');
  }, 60_000);

  it('something named `.git` that is neither a directory, a file nor a link (a FIFO) is unmeasured', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    h.sh(`mkfifo "${path.join(leafOf(), 'x', '.git')}"`);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('2');
  }, 60_000);

  it.skipIf(ROOT_USER)('a mode-000 directory in the leaf: the walk could not read it all', () => {
    fs.mkdirSync(path.join(leafOf(), 'locked'), { recursive: true });
    chmodFor(path.join(leafOf(), 'locked'), 0o000);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('could not read all of');
  }, 60_000);

  it.skipIf(ROOT_USER)('a `.git` FILE that cannot be read is unmeasured', () => {
    movedTree(path.join(leafOf(), 'wt'));
    chmodFor(path.join(leafOf(), 'wt', '.git'), 0o000);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('could not be read');
  }, 60_000);

  it.skipIf(ROOT_USER)('a back-link `gitdir` file that cannot be read is unmeasured', () => {
    const { admin } = movedTree(path.join(leafOf(), 'parked', 'still-harbor'));
    chmodFor(path.join(admin, 'gitdir'), 0o000);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('2');
  }, 60_000);

  it('more than 64 `.git` entries is unmeasured; 64 is examined', () => {
    for (let i = 0; i < 64; i++) fs.mkdirSync(path.join(leafOf(), `c${i}`, '.git'), { recursive: true });
    expect(ask(leafOf()).rc, 'the CONTROL: 64 clones, each examined').toBe('0');
    fs.mkdirSync(path.join(leafOf(), 'c64', '.git'), { recursive: true });
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('more than 64');
  }, 60_000);

  it('a walk that outruns a lowered REAP_SCAN_SECONDS is unmeasured — a real `find` that hangs, killed by the bound', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const realFind = execFileSync('sh', ['-c', 'command -v find'], { encoding: 'utf8', env: inheritedEnv() }).trim();
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    // Only THIS walk hangs (it alone carries both `-xdev` and `.git`); every other find is the real one.
    fs.writeFileSync(path.join(shim, 'find'), `#!/bin/sh\ncase " $* " in *" -xdev "*" .git "*) exec sleep 30 ;; esac\nexec '${realFind}' "$@"\n`,
      { mode: 0o755 });
    const t0 = Date.now();
    const a = ask(leafOf(), `PATH="${shim}:$PATH"; hash -r; REAP_SCAN_SECONDS=1; CCD_TIMEOUT_KILL_AFTER=2;`);
    expect(Date.now() - t0, 'the bound cut it short (the shim sleeps 30 s)').toBeLessThan(20_000);
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('did not finish within 1s');
  }, 60_000);

  it('a leaf that cannot be resolved is unmeasured', () => {
    const a = ask(path.join(h.home, 'nowhere', ID));
    expect(a.rc, a.why).toBe('2');
  }, 60_000);
});

describe('_ws_leaf_remove asks it of every DIRECTORY leaf, after the identity checks and before anything is touched', () => {
  it('a leaf holding a moved worktree is REFUSED: rc 1, the checkout named, nothing normalised, nothing removed', () => {
    movedTree(path.join(leafOf(), 'parked', 'still-harbor'));
    const ro = path.join(leafOf(), 'readonly');
    fs.mkdirSync(ro);
    fs.writeFileSync(path.join(ro, 'x'), 'x');
    chmodFor(ro, 0o500);
    const a = remove(rootOf(), ID);
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`${leafOf()}/parked/still-harbor/.git`);
    expect(a.why).toContain(`nothing under ${leafOf()} was removed`);
    expect(fs.readFileSync(path.join(leafOf(), 'parked', 'still-harbor', 'precious.txt'), 'utf8')).toContain('uncommitted');
    expect((fs.statSync(ro).mode & 0o777).toString(8), 'the permission pass never ran').toBe('500');
  }, 60_000);

  it.skipIf(ROOT_USER)('a leaf the scan cannot measure is UNMEASURED: rc 2, nothing normalised, nothing removed', () => {
    fs.mkdirSync(path.join(leafOf(), 'locked'), { recursive: true });
    fs.writeFileSync(path.join(leafOf(), 'keep'), 'k');
    chmodFor(path.join(leafOf(), 'locked'), 0o000);
    const a = remove(rootOf(), ID);
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('could not read all of');
    expect(fs.existsSync(path.join(leafOf(), 'keep'))).toBe(true);
    expect((fs.statSync(path.join(leafOf(), 'locked')).mode & 0o777).toString(8), 'the permission pass never ran').toBe('0');
  }, 60_000);

  it('a leaf holding only its own scratch — a clone, a self-back-linked worktree, a submodule — is removed and proven gone', () => {
    h.makeRepo('sub');
    const clone = path.join(leafOf(), 'clone');
    cloneAt(clone);
    execFileSync('git', ['-C', clone, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q',
      path.join(h.home, 'origins', 'sub.git'), 'sub'], { env: { ...inheritedEnv(), HOME: h.home } });
    const main = h.makeRepo('demo2');
    h.git(main, 'worktree', 'add', '-q', '-b', 'scratch', path.join(leafOf(), 'scratch-wt'));
    const a = remove(rootOf(), ID);
    expect(a.rc, a.why).toBe('0');
    expect(fs.existsSync(leafOf())).toBe(false);
  }, 60_000);

  it('the temp root’s removal inherits it: a moved worktree keeps the leaf and its witness answer', () => {
    const tmp = path.join(h.home, '.cc-tmp', ID);
    movedTree(path.join(tmp, 'parked', 'still-harbor'));
    const [rc = '', why = ''] = h.sh(`_ws_tmproot_remove ${ID}; rc=$?; printf '%s\\x1f%s' "$rc" "$_WS_LEAF_WHY"`).split('\x1f');
    expect(rc, why).toBe('1');
    expect(fs.existsSync(path.join(tmp, 'parked', 'still-harbor', 'precious.txt'))).toBe(true);
  }, 60_000);

  it('a LINK leaf is unlinked and never scanned — the tree it reaches is not the leaf’s', () => {
    fs.mkdirSync(rootOf());
    const outside = path.join(h.home, 'outside');
    movedTree(path.join(outside, 'still-harbor'));
    fs.symlinkSync(outside, leafOf());
    const a = remove(rootOf(), ID, '_ws_leaf_checkouts() { echo asked >> "$HOME/lc-calls"; return 1; };');
    expect(a.rc, a.why).toBe('0');
    expect(() => fs.lstatSync(leafOf()), 'the link is gone').toThrow();
    expect(fs.existsSync(path.join(outside, 'still-harbor', 'precious.txt')), 'its target is untouched').toBe(true);
    expect(fs.existsSync(path.join(h.home, 'lc-calls')), 'never scanned').toBe(false);
  }, 60_000);

  it('a FILE leaf is unlinked and never scanned', () => {
    fs.mkdirSync(rootOf());
    fs.writeFileSync(leafOf(), 'gitdir: /nowhere\n');
    const a = remove(rootOf(), ID, '_ws_leaf_checkouts() { echo asked >> "$HOME/lc-calls"; return 1; };');
    expect(a.rc, a.why).toBe('0');
    expect(() => fs.lstatSync(leafOf())).toThrow();
    expect(fs.existsSync(path.join(h.home, 'lc-calls')), 'never scanned').toBe(false);
  }, 60_000);
});
