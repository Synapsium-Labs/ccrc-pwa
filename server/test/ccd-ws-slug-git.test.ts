// ws-add's slug judgement against GIT and the DISK, beside the registry one
// (programme ws-slug-collision, plan 2026-09-23-ws-slug-git-collision.md).
//
// `_ws_slug_free` reads `$REG` alone, so a slug whose `ws/<slug>` branch or
// worktree path survives an older workspace used to pass it, and ws-add then
// died late at `git worktree add` — measured as a bare 502 on dispatch
// (`fatal: a branch named 'ws/quiet-delta' already exists`). The fix is a
// separate three-answer helper, `_ws_slug_git_state`, consulted beside
// `_ws_slug_free` at ws-add's three slug sites: the random loop, the
// `CCD_WS_SLUG` arm and the named-slug refusal.
//
// THREE ANSWERS, NOT TWO. `unmeasurable` folded into `free` retries into the
// same late death; folded into `taken` it burns every draw and blames the
// slug. Every case below that pins the third answer asserts it is neither.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { makeCcdHarness, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;
let REG: string;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-ws-slug-git-'); home = h.home; REG = path.join(home, '.cc-sessions'); });
afterEach(() => { h.cleanup(); });

/** The registry files an id would hold — dot-free fields and the dot-leading
 *  private families both, the two globs `_ws_slug_free` reads. */
const regTrace = (id: string): string[] =>
  fs.readdirSync(REG).filter((n) => n.startsWith(`${id}.`) || n.startsWith(`.${id}.`));

/** Whether `refs/heads/<b>` exists, asked of git rather than of the ref file,
 *  so a packed ref counts. */
const hasBranch = (main: string, b: string): boolean => h.git(main, 'branch', '--list', b) !== '';

/** Corrupts the repository so git refuses to recognise it while the
 *  `[[ -d "$main/.git" ]]` pre-check ws-add makes still passes — the shape
 *  of a repository ccd can see but cannot read. */
const breakRepo = (main: string): void => { fs.writeFileSync(path.join(main, '.git', 'HEAD'), 'garbage\n'); };

describe('_ws_slug_git_state: three answers', () => {
  it('free: no branch, nothing at the path, no registered worktree', () => {
    h.makeRepo('demo');
    expect(h.sh('_ws_slug_git_state demo quiet-delta; echo "rc=$?"')).toBe('free\nrc=0');
  });

  it('taken branch: refs/heads/ws/<slug> exists', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'branch', 'ws/quiet-delta');
    expect(h.sh('_ws_slug_git_state demo quiet-delta; echo "rc=$?"')).toBe('taken branch ws/quiet-delta\nrc=1');
  });

  it('taken path: a dangling link at the worktree path counts', () => {
    h.makeRepo('demo');
    const wt = path.join(home, 'worktrees', 'demo', 'quiet-delta');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    fs.symlinkSync(path.join(home, 'no-such-target'), wt);
    expect(h.sh('_ws_slug_git_state demo quiet-delta; echo "rc=$?"')).toBe(`taken path ${wt}\nrc=1`);
  });

  it('unmeasurable: a repository git cannot read is rc 2 — never free, never taken', () => {
    const main = h.makeRepo('demo');
    breakRepo(main);
    const out = h.sh('_ws_slug_git_state demo quiet-delta; echo "rc=$?"');
    const [line, rc] = out.split('\n');
    expect(rc).toBe('rc=2');
    expect(line).toMatch(/^unmeasurable \S/);
    expect(out.split('\n')).toHaveLength(2);
  });

  it('unmeasurable: show-ref failing for a reason other than absence (a corrupt packed-refs)', () => {
    // Measured: the repository still opens (`--show-toplevel` rc 0) while
    // `show-ref --verify` exits 128 — the arm past the open check.
    const main = h.makeRepo('demo');
    h.git(main, 'pack-refs', '--all');
    fs.appendFileSync(path.join(main, '.git', 'packed-refs'), 'garbage line\n');
    expect(h.sh('_ws_slug_git_state demo quiet-delta; echo "rc=$?"'))
      .toMatch(/^unmeasurable git show-ref refs\/heads\/ws\/quiet-delta failed \(rc 128\)[^\n]*\nrc=2$/);
  });

  it('unmeasurable: a worktree list that fails is not an empty list', () => {
    // A shell-function `git` in THIS test's shell, failing only the listing —
    // nothing in ccd is told it is under test.
    h.makeRepo('demo');
    const stub = 'git() { [[ " $* " == *" worktree list "* ]] && return 128; command git "$@"; };';
    expect(h.sh(`${stub} _ws_slug_git_state demo quiet-delta; echo "rc=$?"`))
      .toMatch(/^unmeasurable git worktree list failed[^\n]*\nrc=2$/);
  });

  // ── THE LOOSE SIDE (fix round 2, D-3476). Measured on git 2.43: `show-ref
  // --verify` exits 1 — the ABSENT answer — for an unreadable or corrupt loose
  // ref, for anything under an unsearchable `refs/heads/ws` or `refs/heads`,
  // and for a directory/file conflict (a `ws/<slug>/<x>` branch, or one named
  // just `ws`), all of which `git worktree add -b ws/<slug>` then dies on.
  // Directories chmod-ed here are restored in `finally`, or cleanup cannot
  // remove them.
  const refsDir = (main: string, ...rest: string[]): string => path.join(main, '.git', 'refs', 'heads', ...rest);
  const state = (): string => h.sh('_ws_slug_git_state demo quiet-delta; echo "rc=$?"');

  it('unmeasurable: a loose ref git cannot read (mode 000), never free', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'branch', 'ws/quiet-delta');
    fs.chmodSync(refsDir(main, 'ws', 'quiet-delta'), 0o000);
    try {
      expect(state()).toMatch(/^unmeasurable \S*\/refs\/heads\/ws\/quiet-delta exists but git cannot resolve it\nrc=2$/);
    } finally { fs.chmodSync(refsDir(main, 'ws', 'quiet-delta'), 0o644); }
  });

  it('unmeasurable: a corrupt loose ref, never free', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'branch', 'ws/quiet-delta');
    fs.writeFileSync(refsDir(main, 'ws', 'quiet-delta'), 'junk\n');
    expect(state()).toMatch(/^unmeasurable \S*\/refs\/heads\/ws\/quiet-delta exists but git cannot resolve it\nrc=2$/);
  });

  it('unmeasurable: refs/heads/ws cannot be searched', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'branch', 'ws/other');
    fs.chmodSync(refsDir(main, 'ws'), 0o000);
    try {
      expect(state()).toMatch(/^unmeasurable cannot search \S*\/refs\/heads\/ws\nrc=2$/);
    } finally { fs.chmodSync(refsDir(main, 'ws'), 0o755); }
  });

  it('unmeasurable: refs/heads cannot be searched', () => {
    const main = h.makeRepo('demo');
    fs.chmodSync(refsDir(main), 0o000);
    try {
      expect(state()).toMatch(/^unmeasurable cannot search \S*\/refs\/heads\nrc=2$/);
    } finally { fs.chmodSync(refsDir(main), 0o755); }
  });

  it('taken: a PACKED child ref ws/<slug>/<x> — only for-each-ref can see it', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'branch', 'ws/quiet-delta/x');
    h.git(main, 'pack-refs', '--all');
    expect(fs.existsSync(refsDir(main, 'ws')), 'packed: no loose directory left').toBe(false);
    expect(state()).toBe('taken branch ws/quiet-delta/x\nrc=1');
  });

  it('taken: a child ref git cannot read — the directory at the ref path holds it', () => {
    // for-each-ref only warns "ignoring broken ref" and lists nothing here.
    const main = h.makeRepo('demo');
    h.git(main, 'branch', 'ws/quiet-delta/x');
    fs.chmodSync(refsDir(main, 'ws', 'quiet-delta', 'x'), 0o000);
    try {
      expect(state()).toMatch(/^taken branch ws\/quiet-delta\/ \(a directory holds its path\)\nrc=1$/);
    } finally { fs.chmodSync(refsDir(main, 'ws', 'quiet-delta', 'x'), 0o644); }
  });

  it('taken: a branch named exactly ws', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'branch', 'ws');
    expect(state()).toBe('taken branch ws\nrc=1');
  });

  it('taken: a PACKED branch named exactly ws — only show-ref can see it', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'branch', 'ws');
    h.git(main, 'pack-refs', '--all');
    expect(fs.existsSync(refsDir(main, 'ws')), 'packed: no loose file left').toBe(false);
    expect(state()).toBe('taken branch ws\nrc=1');
  });

  it('unmeasurable: show-ref on refs/heads/ws failing for a reason other than absence', () => {
    // Fails ONLY the exact `refs/heads/ws` read (a shell-function `git` in this
    // test's shell), so the arm is measured on its own rather than masked by
    // the `ws/<slug>` read before it, which a real corrupt packed-refs also fails.
    h.makeRepo('demo');
    const stub = 'git() { [[ " $* " == *" refs/heads/ws "* ]] && return 128; command git "$@"; };';
    expect(h.sh(`${stub} _ws_slug_git_state demo quiet-delta; echo "rc=$?"`))
      .toMatch(/^unmeasurable git show-ref refs\/heads\/ws failed \(rc 128\)[^\n]*\nrc=2$/);
  });

  it('taken: a branch named exactly ws whose loose ref git cannot read', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'branch', 'ws');
    fs.chmodSync(refsDir(main, 'ws'), 0o000);
    try {
      expect(state()).toBe('taken branch ws\nrc=1');
    } finally { fs.chmodSync(refsDir(main, 'ws'), 0o644); }
  });

  it('unmeasurable: the worktree path\'s parent cannot be searched, never free', () => {
    h.makeRepo('demo');
    const parent = path.join(home, 'worktrees', 'demo');
    fs.mkdirSync(path.join(parent, 'quiet-delta'), { recursive: true });
    fs.chmodSync(parent, 0o600);
    try {
      expect(state()).toMatch(/^unmeasurable cannot search \S*\/worktrees\/demo\nrc=2$/);
    } finally { fs.chmodSync(parent, 0o755); }
  });

  it('a named slug on an unreadable loose ref is refused as unmeasurable, not at worktree add', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'branch', 'ws/quiet-delta');
    fs.chmodSync(refsDir(main, 'ws', 'quiet-delta'), 0o000);
    try {
      const out = h.sh(`${WS_ADD} ( cmd_ws_add demo quiet-delta ) 2>&1 || echo REFUSED`);
      expect(out).toContain('REFUSED');
      expect(out).toContain('unmeasurable');
      expect(out).not.toContain('git worktree add failed');
      expect(regTrace('demo-quiet-delta')).toEqual([]);
    } finally { fs.chmodSync(refsDir(main, 'ws', 'quiet-delta'), 0o644); }
  });

  it('unmeasurable, never the OUTER repository\'s answer: a broken repository nested inside another', () => {
    // Measured: git skips a `.git` it cannot read and keeps discovering
    // upwards, so a broken `$main` inside a repository (a dotfiles `$HOME`)
    // answers `show-ref` from the outer one — rc 1, which read as `free`.
    const main = h.makeRepo('demo');
    h.git(home, 'init', '-q');
    h.git(home, 'commit', '-q', '--allow-empty', '-m', 'outer');
    breakRepo(main);
    const out = h.sh('_ws_slug_git_state demo quiet-delta; echo "rc=$?"');
    expect(out).toMatch(/^unmeasurable \S[^\n]*\nrc=2$/);
  });
});

describe('ws-add refuses a named slug git or the disk already holds, before anything is minted', () => {
  it('an existing ws/<slug> branch: named, and nothing is created', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'branch', 'ws/quiet-delta');
    const tip = h.git(main, 'rev-parse', 'ws/quiet-delta');
    const wt = path.join(home, 'worktrees', 'demo', 'quiet-delta');

    const out = h.sh(`${WS_ADD} ( cmd_ws_add demo quiet-delta ) 2>&1 || echo REFUSED`);

    expect(out).toContain('REFUSED');
    expect(out).toContain('slug in use: quiet-delta');
    expect(out, 'the refusal names what holds the slug').toContain('branch ws/quiet-delta');
    expect(out, 'refused at the slug gate, not late at worktree add').not.toContain('git worktree add failed');
    expect(regTrace('demo-quiet-delta'), 'no registry row').toEqual([]);
    expect(fs.existsSync(wt), 'no worktree directory').toBe(false);
    expect(h.git(main, 'rev-parse', 'ws/quiet-delta'), 'the branch is untouched').toBe(tip);
    expect(fs.existsSync(path.join(main, '.git', 'FETCH_HEAD')), 'refused before the fetch').toBe(false);
  });

  it('an existing non-empty directory at the worktree path: named as path', () => {
    const main = h.makeRepo('demo');
    const wt = path.join(home, 'worktrees', 'demo', 'quiet-delta');
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, 'keep'), 'x');

    const out = h.sh(`${WS_ADD} ( cmd_ws_add demo quiet-delta ) 2>&1 || echo REFUSED`);

    expect(out).toContain('REFUSED');
    expect(out).toContain('slug in use: quiet-delta');
    expect(out).toContain(`path ${wt}`);
    expect(regTrace('demo-quiet-delta')).toEqual([]);
    expect(hasBranch(main, 'ws/quiet-delta'), 'no branch minted').toBe(false);
    expect(fs.readdirSync(wt), 'the directory is left as found').toEqual(['keep']);
  });

  it('a registered worktree whose directory is gone, under a symlinked worktrees root: named as worktree', () => {
    const main = h.makeRepo('demo');
    // Production's shape: `$HOME/worktrees` is a symlink, and git records the
    // RESOLVED path, so a literal comparison against ccd's path would miss it.
    fs.mkdirSync(path.join(home, 'wt-real'));
    fs.symlinkSync(path.join(home, 'wt-real'), path.join(home, 'worktrees'));
    const wt = path.join(home, 'worktrees', 'demo', 'quiet-delta');
    h.git(main, 'worktree', 'add', '-b', 'elsewhere', wt);
    fs.rmSync(path.join(home, 'wt-real', 'demo', 'quiet-delta'), { recursive: true, force: true });
    expect(h.git(main, 'worktree', 'list', '--porcelain')).toContain('quiet-delta');

    const out = h.sh(`${WS_ADD} ( cmd_ws_add demo quiet-delta ) 2>&1 || echo REFUSED`);

    expect(out).toContain('REFUSED');
    expect(out).toContain('slug in use: quiet-delta');
    expect(out).toContain(`worktree ${wt}`);
    expect(regTrace('demo-quiet-delta')).toEqual([]);
    expect(hasBranch(main, 'ws/quiet-delta'), 'no branch minted').toBe(false);
  });

  it('an unreadable repository: the refusal names the unmeasurable cause, not a slug in use', () => {
    const main = h.makeRepo('demo');
    breakRepo(main);

    const out = h.sh(`${WS_ADD} ( cmd_ws_add demo quiet-delta ) 2>&1 || echo REFUSED`);

    expect(out).toContain('REFUSED');
    expect(out).toContain('unmeasurable');
    expect(out).not.toContain('slug in use');
    expect(regTrace('demo-quiet-delta')).toEqual([]);
  });
});

describe('_ws_slug_new consults git: the random loop and the CCD_WS_SLUG arm', () => {
  // DETERMINISTIC WITHOUT A PRODUCTION KNOB: the word lists are ordinary
  // arrays in the sourced copy, so the test narrows them in its own shell.
  it('the random loop never picks a slug whose branch exists', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'branch', 'ws/quiet-delta');
    // One candidate, taken: the loop must exhaust rather than hand it out.
    expect(h.sh('WS_ADJ=(quiet); WS_NOUN=(delta); _ws_slug_new demo 2>/dev/null && echo PICKED || echo NONE'))
      .toBe('NONE');
    // Two candidates, one taken: sixty draws land on the free one.
    expect(h.sh('WS_ADJ=(quiet); WS_NOUN=(delta mesa); _ws_slug_new demo 2>/dev/null')).toBe('quiet-mesa');
  });

  it('the random loop stops at once on an unmeasurable repository and says why', () => {
    const main = h.makeRepo('demo');
    breakRepo(main);
    const out = h.sh('WS_ADJ=(quiet); WS_NOUN=(delta mesa); _ws_slug_new demo 2>&1; echo "rc=$?"');
    const lines = out.split('\n');
    expect(lines.at(-1)).toBe('rc=1');
    expect(lines.filter((l) => l.startsWith('ccd: unmeasurable')), 'one line: it stopped drawing').toHaveLength(1);
    expect(lines, 'and printed no slug').toHaveLength(2);

    const add = h.sh(`${WS_ADD} ( cmd_ws_add demo ) 2>&1 || echo REFUSED`);
    expect(add).toContain('REFUSED');
    expect(add).toMatch(/ccd: unmeasurable [^\n]*\n[^\n]*could not find a free slug for demo/);
  });

  it('the CCD_WS_SLUG arm refuses a slug whose branch exists, and says why', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'branch', 'ws/quiet-delta');
    expect(h.sh('_ws_slug_new demo 2>&1 && echo PICKED || echo NONE', { CCD_WS_SLUG: 'quiet-delta' }))
      .toBe('ccd: taken branch ws/quiet-delta\nNONE');

    const add = h.sh(`${WS_ADD} ( cmd_ws_add demo ) 2>&1 || echo REFUSED`, { CCD_WS_SLUG: 'quiet-delta' });
    expect(add).toContain('REFUSED');
    expect(add).toContain('could not find a free slug for demo');
    expect(regTrace('demo-quiet-delta')).toEqual([]);
  });

  it('the CCD_WS_SLUG arm refuses an unmeasurable repository, and says why', () => {
    const main = h.makeRepo('demo');
    breakRepo(main);
    const out = h.sh('_ws_slug_new demo 2>&1; echo "rc=$?"', { CCD_WS_SLUG: 'quiet-delta' });
    expect(out).toMatch(/^ccd: unmeasurable \S[^\n]*\nrc=1$/);
  });

  it('CONTROL: a free slug still goes through on all three paths', () => {
    h.makeRepo('demo');
    expect(h.sh('WS_ADJ=(quiet); WS_NOUN=(delta); _ws_slug_new demo')).toBe('quiet-delta');
    expect(h.sh('_ws_slug_new demo', { CCD_WS_SLUG: 'quiet-delta' })).toBe('quiet-delta');
    const out = h.sh(`${WS_ADD} ( cmd_ws_add demo quiet-delta ) 2>&1 || echo REFUSED`);
    expect(out).not.toContain('REFUSED');
    expect(out).toContain('workspace demo-quiet-delta');
  });
});
