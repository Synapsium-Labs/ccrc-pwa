// The checkout question ACROSS THE COLLECTOR'S MOVE (child reclamation wave 7,
// spec §5.10). The collector asks `_ws_leaf_checkouts` of the leaf at its own
// path, BEFORE it moves the leaf into a quarantine slot, and records every
// admin directory OUTSIDE the leaf that passed by back-link, with that back-link
// (`_WS_CHECKOUTS_ACCEPTED`). After the move the leaf's own linked worktrees
// still back-link to the PRE-MOVE spelling, so the removal of `<slot>/leaf`
// would refuse every one of them. The ALIAS — the pre-move physical spelling and
// the accepted list, passed by the collector alone — lets such a back-link count
// as the leaf's own ONLY when (1) the same admin directory with the same
// back-link value was accepted before the move, and (2) nothing stands at the
// pre-move spelling now, PROVEN. Each condition has its own MEASURED break:
// without (1), a foreign worktree moved into an orphan leaf passes once a
// recycled slug's `git worktree add` re-creates its pruned admin name at the
// pre-move spelling and its tree is later removed; without (2), the leaf's own
// worktree passes while a recycled slug's live worktree holds its admin name.
// The alias also answers a clone in the leaf whose linked worktree is in the
// leaf too: git names that worktree's git directory ABSOLUTELY, by the leaf's
// pre-move spelling, and under the alias it is read at the leaf's new place
// while nothing stands at that spelling, PROVEN — measured: without it the
// moved leaf refuses for ever, a leaf the pre-move ask passed.
// Every other caller passes no alias and is answered exactly as before.
//
// FIXTURE HOMES ONLY (`makePrHarness`): every repository, leaf and slot is under
// the harness's HOME. The slot lives under `$HOME/q`, outside `~/.cc-tmp`, so
// the pre-move spelling's parent can be made unsearchable on its own.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-leaf-alias-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const chmodFor = (p: string, mode: number): void => {
  restore.push([p, fs.statSync(p).mode & 0o7777]);
  fs.chmodSync(p, mode);
};

const ID = 'demo-quiet-mesa';
const ROOT_USER = process.getuid?.() === 0;
const root = (): string => path.join(h.home, '.cc-tmp');
const L = (): string => path.join(root(), ID);                     // the leaf's pre-move spelling
const slot = (): string => path.join(h.home, 'q', `slot.${ID}.1.2`);
const moved = (): string => path.join(slot(), 'leaf');            // the leaf in its slot

interface Answer { rc: string; why: string; accepted: string }
const ask = (leaf: string, alias?: { path: string; accepted: string }, pre = ''): Answer => {
  const args = alias ? ` '${alias.path}' '${alias.accepted}'` : '';
  const [rc = '', why = '', accepted = ''] = h.sh(`${pre} _ws_leaf_checkouts '${leaf}'${args}; rc=$?;`
    + ' printf \'%s\\x1f%s\\x1f%s\' "$rc" "$_WS_CHECKOUTS_WHY" "$_WS_CHECKOUTS_ACCEPTED"').split('\x1f');
  return { rc, why, accepted };
};
const remove = (args: string): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`_ws_leaf_remove ${args}; rc=$?; printf '%s\\x1f%s' "$rc" "$_WS_LEAF_WHY"`).split('\x1f');
  return { rc, why };
};
const enc = (s: string): string => h.sh(`_ws_collect_enc '${s}'`);
const devino = (p: string): string => { const st = fs.lstatSync(p); return `${st.dev}:${st.ino}`; };

/** The repository OUTSIDE the leaf whose worktrees these cases make. */
const repo = (): string => (fs.existsSync(path.join(h.home, 'projects', 'demo2'))
  ? path.join(h.home, 'projects', 'demo2') : h.makeRepo('demo2'));
const adminOf = (wt: string): string => fs.realpathSync(h.git(wt, 'rev-parse', '--absolute-git-dir'));
/** The leaf's OWN worktree at L/<name>: its admin directory is outside the leaf, and back-links here. */
const ownWorktree = (name = 'wt'): { admin: string; backlink: string } => {
  fs.mkdirSync(L(), { recursive: true });
  const wt = path.join(L(), name);
  h.git(repo(), 'worktree', 'add', '-q', '-b', `scratch-${name}`, wt);
  const admin = adminOf(wt);
  return { admin, backlink: fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim() };
};
/** The collector's move: the leaf to `<slot>/leaf`, the slot made first. */
const moveToSlot = (): void => {
  fs.mkdirSync(slot(), { recursive: true, mode: 0o700 });
  fs.renameSync(L(), moved());
};
/** A recycled slug's child: a NEW leaf at the pre-move spelling, and `git worktree add` there. */
const recycledAdd = (name: string): void => {
  fs.mkdirSync(L(), { recursive: true });
  h.git(repo(), 'worktree', 'add', '-q', '-b', `recycled-${name}`, path.join(L(), name));
};

describe('the pre-move ask records what it let pass by back-link', () => {
  it('the leaf’s own linked worktree: rc 0, and its admin directory and back-link are recorded, spelled', () => {
    const { admin, backlink } = ownWorktree();
    const a = ask(L());
    expect(a.rc, a.why).toBe('0');
    expect(backlink, 'the CONTROL: git back-links the physical spelling').toBe(`${path.join(fs.realpathSync(root()), ID, 'wt')}/.git`);
    expect(a.accepted).toBe(`${enc(admin)}=${enc(backlink)}`);
  }, 60_000);

  it('a clone, and nothing at all, record nothing — and a second ask in the same shell starts from nothing', () => {
    ownWorktree();
    const other = path.join(h.home, 'other-leaf');
    fs.mkdirSync(path.join(other, 'clone', '.git'), { recursive: true });
    const [first = '', second = ''] = h.sh(`_ws_leaf_checkouts '${L()}'; a="$_WS_CHECKOUTS_ACCEPTED";`
      + ` _ws_leaf_checkouts '${other}'; printf '%s\\x1f%s' "$a" "$_WS_CHECKOUTS_ACCEPTED"`).split('\x1f');
    expect(first, 'the CONTROL: the first ask recorded the leaf’s own worktree').not.toBe('');
    expect(second).toBe('');
  }, 60_000);
});

describe('after the move: the alias lets the leaf’s OWN worktree go, and only it', () => {
  it('CONTROL — no alias (every other caller): the moved leaf’s own worktree refuses, as today', () => {
    ownWorktree();
    moveToSlot();
    const a = ask(moved());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('a checkout git records elsewhere');
  }, 60_000);

  it('with the alias: accepted before the move, nothing at the pre-move spelling now — the leaf’s own: 0', () => {
    ownWorktree();
    const pre = ask(L());
    expect(pre.rc, pre.why).toBe('0');
    const alias = path.join(fs.realpathSync(root()), ID);
    moveToSlot();
    const a = ask(moved(), { path: alias, accepted: pre.accepted });
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('the leaf ITSELF a linked worktree (its `.git` at the leaf’s top): accepted before the move, and its own under the alias: 0', () => {
    fs.mkdirSync(root(), { recursive: true });
    h.git(repo(), 'worktree', 'add', '-q', '-b', 'scratch-leaf', L());
    const admin = adminOf(L());
    const alias = path.join(fs.realpathSync(root()), ID);
    const pre = ask(L());
    expect(pre.accepted, 'the CONTROL: the leaf’s own top-level `.git` was accepted').toBe(`${enc(admin)}=${enc(`${alias}/.git`)}`);
    moveToSlot();
    const a = ask(moved(), { path: alias, accepted: pre.accepted });
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('_ws_leaf_remove hands the alias through: the slot’s leaf is removed and proven gone', () => {
    ownWorktree();
    const pre = ask(L());
    const alias = path.join(fs.realpathSync(root()), ID);
    moveToSlot();
    const r = remove(`'${slot()}' leaf '${devino(moved())}' '${alias}' '${pre.accepted}'`);
    expect(r.rc, r.why).toBe('0');
    expect(fs.existsSync(moved())).toBe(false);
  }, 60_000);

  it('_ws_leaf_remove WITHOUT the alias — two arguments, or three — refuses exactly as before, nothing removed', () => {
    ownWorktree();
    moveToSlot();
    expect(remove(`'${slot()}' leaf`).rc).toBe('1');
    expect(remove(`'${slot()}' leaf '${devino(moved())}'`).rc).toBe('1');
    expect(fs.existsSync(path.join(moved(), 'wt', '.git'))).toBe(true);
  }, 60_000);

  it('_ws_leaf_remove with the alias but NO expected dev:ino is unmeasured: 2 — the identity check is never skipped, nothing removed', () => {
    ownWorktree();
    const pre = ask(L());
    expect(pre.rc, pre.why).toBe('0');
    const alias = path.join(fs.realpathSync(root()), ID);
    moveToSlot();
    const r = remove(`'${slot()}' leaf '' '${alias}' '${pre.accepted}'`);
    expect(r.rc, r.why).toBe('2');
    expect(r.why).toContain('no expected dev:ino');
    expect(fs.existsSync(path.join(moved(), 'wt', '.git')), 'nothing was removed').toBe(true);
  }, 60_000);
});

describe('condition (1): only what the PRE-MOVE ask accepted — the measured moved-tree, recycled-admin break', () => {
  /** Another session's worktree, with uncommitted work, moved into the orphan leaf at L/<at>
   *  (L/still-harbor unless a case names another place). Its admin name is `still-harbor` wherever it lands. */
  const foreignInLeaf = (at = 'still-harbor'): { admin: string } => {
    const xorig = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
    fs.mkdirSync(path.dirname(xorig), { recursive: true });
    h.git(repo(), 'worktree', 'add', '-q', '-b', 'ws/still-harbor', xorig);
    fs.writeFileSync(path.join(xorig, 'precious.txt'), 'uncommitted work of another session\n');
    const admin = adminOf(xorig);
    fs.mkdirSync(L(), { recursive: true });
    fs.renameSync(xorig, path.join(L(), at));
    return { admin };
  };
  /** The break, step by step: the pre-move ask refuses the foreign tree (nothing is accepted); the
   *  leaf moves; `git worktree prune` drops its admin name; a recycled slug's child re-creates that
   *  name AT the pre-move spelling; and that child's own temp root is later removed, leaving the
   *  re-created admin directory back-linking to a spelling where nothing stands. */
  const theBreak = (at = 'still-harbor'): { admin: string; alias: string; accepted: string } => {
    const { admin } = foreignInLeaf(at);
    const pre = ask(L());
    expect(pre.rc, 'the CONTROL: the pre-move ask refuses the foreign tree').toBe('1');
    const alias = path.join(fs.realpathSync(root()), ID);
    moveToSlot();
    h.git(repo(), 'worktree', 'prune');
    expect(fs.existsSync(admin), 'the CONTROL: prune took the moved tree’s admin name').toBe(false);
    recycledAdd('still-harbor');
    expect(fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim(), 'the CONTROL: the same admin name, back-linking the pre-move spelling')
      .toBe(`${alias}/still-harbor/.git`);
    fs.rmSync(L(), { recursive: true, force: true });
    return { admin, alias, accepted: pre.accepted };
  };

  it('nothing accepted before the move: the foreign tree refuses — rc 1 — and its uncommitted work stands', () => {
    const { alias, accepted } = theBreak();
    expect(accepted).toBe('');
    const a = ask(moved(), { path: alias, accepted });
    expect(a.rc, a.why).toBe('1');
    const r = remove(`'${slot()}' leaf '${devino(moved())}' '${alias}' '${accepted}'`);
    expect(r.rc, r.why).toBe('1');
    expect(fs.readFileSync(path.join(moved(), 'still-harbor', 'precious.txt'), 'utf8')).toContain('uncommitted');
  }, 60_000);

  it('the same admin directory accepted with ANOTHER back-link value refuses: the value is half of (1)', () => {
    const { admin, alias } = theBreak();
    const accepted = `${enc(admin)}=${enc(path.join(h.home, 'worktrees', 'demo2', 'still-harbor', '.git'))}`;
    const a = ask(moved(), { path: alias, accepted });
    expect(a.rc, a.why).toBe('1');
  }, 60_000);

  it('the very back-link value accepted for ANOTHER admin directory refuses: the admin is the other half of (1)', () => {
    const { alias } = theBreak();
    const accepted = `${enc(path.join(repo(), '.git', 'worktrees', 'another'))}=${enc(`${alias}/still-harbor/.git`)}`;
    const a = ask(moved(), { path: alias, accepted });
    expect(a.rc, a.why).toBe('1');
    expect(fs.readFileSync(path.join(moved(), 'still-harbor', 'precious.txt'), 'utf8')).toContain('uncommitted');
  }, 60_000);

  it('the accepted pair, back-linking ANOTHER place in the leaf, refuses the tree at this one: the back-link must name the tree’s own pre-move spelling', () => {
    const { admin, alias } = theBreak('other');
    const named = fs.readFileSync(path.join(moved(), 'other', '.git'), 'utf8').trim().replace(/^gitdir: /, '');
    expect(fs.realpathSync(named), 'the CONTROL: the tree at other names the accepted admin directory').toBe(admin);
    const accepted = `${enc(admin)}=${enc(`${alias}/still-harbor/.git`)}`;
    const a = ask(moved(), { path: alias, accepted });
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('a checkout git records elsewhere');
  }, 60_000);
});

describe('condition (2): nothing stands at the pre-move spelling — the measured own-worktree, recycled-admin break', () => {
  it('a recycled slug’s LIVE worktree holds the admin name, with the very back-link accepted before: rc 1', () => {
    const { admin, backlink } = ownWorktree();
    const pre = ask(L());
    expect(pre.accepted, 'the CONTROL: accepted before the move').toBe(`${enc(admin)}=${enc(backlink)}`);
    const alias = path.join(fs.realpathSync(root()), ID);
    moveToSlot();
    h.git(repo(), 'worktree', 'prune');
    recycledAdd('wt');
    expect(fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim(), 'the CONTROL: the same admin, the same back-link value')
      .toBe(backlink);
    const a = ask(moved(), { path: alias, accepted: pre.accepted });
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('where something stands again');
  }, 60_000);

  it.skipIf(ROOT_USER)('the pre-move spelling under a parent that cannot be searched is unmeasured: 2', () => {
    ownWorktree();
    const pre = ask(L());
    const alias = path.join(fs.realpathSync(root()), ID);
    moveToSlot();
    chmodFor(root(), 0o600);
    const a = ask(moved(), { path: alias, accepted: pre.accepted });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('was never asked');
  }, 60_000);
});

describe('a clone and its worktree BOTH inside the leaf — git spells the worktree’s git directory ABSOLUTELY, by the pre-move path', () => {
  /** A clone at L/repo and its linked worktree at L/wt (`git worktree add`'s default). The pre-move ask
   *  passes both as the leaf's own (INSIDE THE LEAF) and records nothing: no admin directory lies outside it. */
  const cloneAndWorktree = (): { alias: string; gitdir: string } => {
    fs.mkdirSync(L(), { recursive: true });
    h.git(L(), 'init', '-q', '-b', 'main', 'repo');
    h.git(path.join(L(), 'repo'), 'commit', '-q', '--allow-empty', '-m', 'init');
    h.git(path.join(L(), 'repo'), 'worktree', 'add', '-q', '-b', 'inner', path.join(L(), 'wt'));
    const alias = path.join(fs.realpathSync(root()), ID);
    const gitdir = path.join(alias, 'repo', '.git', 'worktrees', 'wt');
    expect(fs.readFileSync(path.join(L(), 'wt', '.git'), 'utf8').trim(), 'the CONTROL: git spells it absolutely, by the pre-move path')
      .toBe(`gitdir: ${gitdir}`);
    expect(ask(L()), 'the CONTROL: the pre-move ask passes it, and records nothing').toEqual({ rc: '0', why: '', accepted: '' });
    return { alias, gitdir };
  };

  it('CONTROL — no alias: after the move the worktree names a git directory that is gone, and refuses, as today: 1', () => {
    cloneAndWorktree();
    moveToSlot();
    const a = ask(moved());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('which no longer exists');
  }, 60_000);

  it('with the alias: the git directory’s pre-move spelling is read inside the moved leaf — 0 — and _ws_leaf_remove removes the leaf, proven gone', () => {
    const { alias } = cloneAndWorktree();
    moveToSlot();
    const a = ask(moved(), { path: alias, accepted: '' });
    expect(a.rc, a.why).toBe('0');
    const r = remove(`'${slot()}' leaf '${devino(moved())}' '${alias}' ''`);
    expect(r.rc, r.why).toBe('0');
    expect(fs.existsSync(moved())).toBe(false);
  }, 60_000);

  it('something standing again at the git directory’s pre-move spelling refuses: 1 — an empty recycled leaf at the alias alone does not', () => {
    const { alias, gitdir } = cloneAndWorktree();
    moveToSlot();
    fs.mkdirSync(L());   // a recycled slug's spawn: a new, empty leaf at the pre-move spelling
    expect(ask(moved(), { path: alias, accepted: '' }).rc, 'the CONTROL: only the git directory’s own spelling is asked').toBe('0');
    fs.mkdirSync(gitdir, { recursive: true });   // … and something at that git directory's very spelling
    const a = ask(moved(), { path: alias, accepted: '' });
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('where something stands again');
    const r = remove(`'${slot()}' leaf '${devino(moved())}' '${alias}' ''`);
    expect(r.rc, r.why).toBe('1');
    expect(fs.existsSync(path.join(moved(), 'wt', '.git')), 'nothing was removed').toBe(true);
  }, 60_000);

  it.skipIf(ROOT_USER)('the git directory’s pre-move spelling under a parent that cannot be searched is unmeasured: 2', () => {
    const { alias } = cloneAndWorktree();
    moveToSlot();
    chmodFor(root(), 0o600);
    const a = ask(moved(), { path: alias, accepted: '' });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('was never asked');
  }, 60_000);
});

describe('the alias itself is checked before it is believed', () => {
  it.each([
    ['a relative pre-move spelling', 'tmp/x', ''],
    ['a pre-move spelling holding a newline', '/abs/x\ny', ''],
    ['an accepted list ccd never writes', '/abs/x', 'a b'],
  ])('%s is unmeasured: 2', (_label, aliasPath, accepted) => {
    fs.mkdirSync(path.join(L(), 'clone', '.git'), { recursive: true });
    expect(ask(L(), { path: aliasPath, accepted }).rc).toBe('2');
  });
});
