// `ccd ws-add --base <full commit id>` (delegation broker wave 5 PR3, F3; spec §5.7, D-7827).
//
// The flag is a START POINT and nothing else: it changes only the commit `git worktree add` checks the new
// child workspace out at. The workspace's recorded base (`$REG/<id>.base`), its branch name, its PR target and
// every reader of `.base` stay exactly as a plain `ws-add --child` leaves them; the start point is recorded only
// as the lifecycle create row's `meas.startpoint`. Every refusal precedes the row, the worktree, the marker, the
// add lock and the pane, and the flag is unreachable without `--child`.
//
// Fixture HOMEs only (`makeCcdHarness`); `WS_ADD_REAL_SPAWN` keeps `_spawn_start` real and records `tmux`
// instead of running it. The idiom (`shStatus`, `wsAdd`, `nothingCreated`) is `ccd-ws-add-child.test.ts`'s.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ccdSource, ghContainedEnv, makeCcdHarness, WS_ADD_REAL_SPAWN, type CcdHarness } from './ccdWsHelpers.js';
import { readJournal } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-ws-add-base-'); h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
/** `ccd-lifecycle-sites.test.ts`'s spelling: macOS ships coreutils' `timeout` as `gtimeout`. */
const TIMEOUT_BIN = process.platform === 'darwin' ? 'gtimeout' : 'timeout';

/** `ccd-ws-add-child.test.ts`'s `shStatus`, with the sourced script as a parameter for W5-B8's older copy. */
const shStatus = (snippet: string, boundSec: number, script: string = CCD): { status: number; out: string } => {
  try {
    const out = execFileSync(TIMEOUT_BIN, [String(boundSec), 'bash', '-c', `source "${script}"; exec 2>&1; ${snippet}`],
      { encoding: 'utf8', cwd: h.home,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

const wsAdd = (args: string, script?: string): { status: number; out: string } =>
  shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add ${args}`, 30, script);
const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));
const addLock = (project = 'demo'): string => path.join(h.home, '.cc-sessions', `.ws-add-${project}.lock`);
const nothingCreated = (project = 'demo', id = ID): void => {
  expect(h.reg(id, 'uuid'), 'the refusal must precede the registry row').toBeNull();
  expect(h.reg(id, 'child'), 'and the marker').toBeNull();
  expect(fs.existsSync(path.join(h.home, 'worktrees', project)), 'and the worktree').toBe(false);
  expect(() => h.git(path.join(h.home, 'projects', project), 'show-ref', '--verify', '--quiet', 'refs/heads/ws/quiet-mesa'),
    'and the branch').toThrow();
  expect(newSessions(), 'and the pane').toEqual([]);
};
/** `cmd_ws_add`'s usage refusal, as `die` prints it. */
const USAGE = 'ccd: usage: ccd ws-add [--no-rc] [--child <runId>] [--base <commit>] [--surface <word>] [--actor <text>] '
  + '[--title <text>] [--wrapper <lane>] [--route <field>=<value>]... <project> [slug]';
/** The object check's refusal, for a value of `fmt`'s repository. */
const notFull = (id: string, project = 'demo', fmt = 'sha1'): string => `ccd: ws-add: --base ${id} is not a full ${fmt} commit id of ${project}`;

/** A commit on a branch of the main checkout that origin has never seen: what an Agent tree's tip looks like to
 *  the main checkout (a linked worktree shares its object store). The main checkout is put back on `main`. */
const tipOf = (): string => {
  const at = path.join(h.home, 'projects', 'demo');
  fs.writeFileSync(path.join(at, 'lease-work.txt'), 'w\n');
  h.git(at, 'checkout', '-b', 'claude/agent-a');
  h.git(at, 'add', 'lease-work.txt'); h.git(at, 'commit', '-m', 'lease work');
  const tip = h.git(at, 'rev-parse', 'HEAD').trim();
  h.git(at, 'checkout', '-');
  return tip;
};

const createRows = (): Record<string, unknown>[] =>
  readJournal(h.home).filter((e) => e['act'] === 'create' && e['outcome'] === 'done');
const measOf = (e: Record<string, unknown>): Record<string, unknown> => (e['meas'] ?? {}) as Record<string, unknown>;

describe('--base starts a child workspace at the given commit, and nothing else changes', () => {
  it('W5-B1: --base starts the worktree at the tip, and .base stays the origin ref', () => {
    const tip = tipOf();
    const r = wsAdd(`--no-rc --child 7 --base ${tip} demo`);
    expect(r.status, r.out).toBe(0);
    const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-mesa');
    expect(h.git(wt, 'rev-parse', 'HEAD').trim()).toBe(tip);
    expect(h.reg(ID, 'base')).toMatch(/^origin\//);
    expect(h.reg(ID, 'base'), 'the ref a plain ws-add records, byte for byte').toBe('origin/main');
    expect(h.reg(ID, 'branch')).toBe('ws/quiet-mesa');
    expect(h.reg(ID, 'child')).toBe('7');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'the workspace sits on its own branch').toBe('ws/quiet-mesa');
    expect(() => h.git(wt, 'config', '--get', 'branch.ws/quiet-mesa.merge'), '--no-track still holds: no upstream').toThrow();
    expect(newSessions()).toHaveLength(1);
  });

  it('W5-B6: the equals form --base=<tip> binds the same row as W5-B1', () => {
    const tip = tipOf();
    const r = wsAdd(`--no-rc --child 7 --base=${tip} demo`);
    expect(r.status, r.out).toBe(0);
    expect(h.git(path.join(h.home, 'worktrees', 'demo', 'quiet-mesa'), 'rev-parse', 'HEAD').trim()).toBe(tip);
    expect(h.reg(ID, 'base')).toBe('origin/main');
    expect(h.reg(ID, 'branch')).toBe('ws/quiet-mesa');
    expect(h.reg(ID, 'child')).toBe('7');
  });

  it('W5-B6b: --base AFTER the positional binds the same row: the strip loop is positionless (D-410)', () => {
    const tip = tipOf();
    const r = wsAdd(`--no-rc --child 7 demo --base ${tip}`);
    expect(r.status, r.out).toBe(0);
    expect(h.git(path.join(h.home, 'worktrees', 'demo', 'quiet-mesa'), 'rev-parse', 'HEAD').trim()).toBe(tip);
    expect(h.reg(ID, 'project')).toBe('demo');
    expect(h.reg(ID, 'workspace')).toBe('quiet-mesa');
  });

  it('W5-B7: the create row carries meas.startpoint equal to the tip; a plain ws-add --child carries none', () => {
    const tip = tipOf();
    expect(wsAdd(`--no-rc --child 7 --base ${tip} demo`).status).toBe(0);
    const rows = createRows();
    expect(rows).toHaveLength(1);
    expect(measOf(rows[0]!)['startpoint']).toBe(tip);
    expect(measOf(rows[0]!)['base'], 'meas.base stays the origin ref beside it').toBe('origin/main');
  });

  it('W5-B7b: a plain ws-add --child carries no meas.startpoint key at all', () => {
    expect(wsAdd('--no-rc --child 7 demo').status).toBe(0);
    const rows = createRows();
    expect(rows).toHaveLength(1);
    expect(Object.keys(measOf(rows[0]!))).not.toContain('startpoint');
    expect(measOf(rows[0]!)['base']).toBe('origin/main');
  });

  for (const kind of ['branch', 'tag', 'both'] as const) {
    it(`W5-B9d (${kind}): a ${kind === 'both' ? 'branch and a tag' : kind} named the id, pointing elsewhere, never diverts the start point (review 1457 F1)`, () => {
      const main = path.join(h.home, 'projects', 'demo');
      const older = h.git(main, 'rev-parse', 'HEAD').trim();
      const tip = tipOf();
      expect(older, 'the name points elsewhere').not.toBe(tip);
      if (kind !== 'tag') h.git(main, 'update-ref', `refs/heads/${tip}`, older);
      if (kind !== 'branch') h.git(main, 'update-ref', `refs/tags/${tip}`, older);
      const r = wsAdd(`--no-rc --child 7 --base ${tip} demo`);
      expect(r.status, `${kind}: ${r.out}`).toBe(0);
      expect(r.out, kind).not.toContain('ambiguous object name');
      expect(h.git(path.join(h.home, 'worktrees', 'demo', 'quiet-mesa'), 'rev-parse', 'HEAD').trim(), kind).toBe(tip);
      expect(measOf(createRows()[0]!)['startpoint'], kind).toBe(tip);
    });
  }
});

describe('--base refuses before anything exists', () => {
  it('W5-B2: --base without --child is refused before anything exists', () => {
    const r = wsAdd(`--no-rc --base ${tipOf()} demo`);
    expect(r.status, r.out).toBe(1);
    expect(r.out.trim()).toBe(USAGE);
    nothingCreated();
    expect(fs.existsSync(addLock()), 'and the add lock was never taken').toBe(false);
  });

  it.each([
    ['a short id', 'abc123'],
    ['an upper-case id', 'A'.repeat(40)],
    ['a 41-hex id', 'a'.repeat(41)],
    ['a 39-hex id', 'a'.repeat(39)],
    ['a 63-hex id', 'b'.repeat(63)],
    ['a 65-hex id', 'b'.repeat(65)],
    ['a ref name', 'origin/main'],
    ['an empty value', ''],
    ['a value with a trailing newline', `${'a'.repeat(40)}\n`],
  ])('W5-B3: %s refuses with the usage line and nothing created', (_label, bad) => {
    const r = wsAdd(`--no-rc --child 7 --base '${bad}' demo`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('usage: ccd ws-add');
    nothingCreated();
    expect(fs.existsSync(addLock())).toBe(false);
  });

  it('W5-B3: a 64-hex id in a SHA-1 repository refuses at the object check (the wrong length for its ids), nothing created', () => {
    const bad = 'c'.repeat(64);
    const r = wsAdd(`--no-rc --child 7 --base ${bad} demo`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(notFull(bad));
    nothingCreated();
    expect(fs.existsSync(addLock())).toBe(false);
  });

  it('W5-B3: a 40-hex id that names no object refuses at the object check, nothing created', () => {
    const bad = 'd'.repeat(40);
    const r = wsAdd(`--no-rc --child 7 --base ${bad} demo`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(notFull(bad));
    nothingCreated();
  });

  it('W5-B4: a 40-hex id that is a blob, not a commit, refuses at the object check, and the add lock is never taken', () => {
    const main = path.join(h.home, 'projects', 'demo');
    const blob = h.git(main, 'rev-parse', 'HEAD:README.md').trim();
    expect(blob, 'the fixture names a real blob').toMatch(/^[0-9a-f]{40}$/);
    const r = wsAdd(`--no-rc --child 7 --base ${blob} demo`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(notFull(blob));
    nothingCreated();
    expect(fs.existsSync(addLock()), 'the object check precedes the add lock').toBe(false);
  });

  it('W5-B4b: a tree id is not a commit either', () => {
    const main = path.join(h.home, 'projects', 'demo');
    const tree = h.git(main, 'rev-parse', 'HEAD^{tree}').trim();
    const r = wsAdd(`--no-rc --child 7 --base ${tree} demo`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(notFull(tree));
    nothingCreated();
  });

  it('W5-B4c: an annotated tag id is refused even though it peels to a commit (the start point is the id named)', () => {
    const main = path.join(h.home, 'projects', 'demo');
    h.git(main, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'tag', '-a', 'v1', '-m', 'v1');
    const tag = h.git(main, 'rev-parse', 'refs/tags/v1').trim();
    expect(tag, 'an annotated tag object, not the commit').not.toBe(h.git(main, 'rev-parse', 'HEAD').trim());
    const r = wsAdd(`--no-rc --child 7 --base ${tag} demo`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(notFull(tag));
    nothingCreated();
    expect(fs.existsSync(addLock())).toBe(false);
  });

  it('W5-B5: --base with no value refuses usage, and does not hang', () => {
    const r = wsAdd('--no-rc --child 7 demo --base');
    expect(r.status, 'a valueless --base ran past the wall clock (timeout rc 124)').not.toBe(124);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('usage: ccd ws-add');
    nothingCreated();
  });

  it('W5-B5: --base given twice refuses usage, in both spellings', () => {
    const tip = tipOf();
    for (const args of [`--base ${tip} --base ${tip}`, `--base=${tip} --base ${tip}`, `--base ${tip} --base=${tip}`]) {
      const r = wsAdd(`--no-rc --child 7 ${args} demo`);
      expect(r.status, `${args}: ${r.out}`).toBe(1);
      expect(r.out).toContain('usage: ccd ws-add');
      nothingCreated();
    }
  });

  it('W5-B5b: --base taking --child as its value is refused usage, with nothing created (--child is never seen)', () => {
    const r = wsAdd('--no-rc --base --child 7 demo');
    expect(r.status, r.out).toBe(1);
    expect(r.out.trim()).toBe(USAGE);
    nothingCreated();
  });

  it('W5-B5c: --base taking --no-rc as its value, with --child present, is refused usage, with nothing created', () => {
    const r = wsAdd('--child 7 --base --no-rc demo');
    expect(r.status, r.out).toBe(1);
    expect(r.out.trim()).toBe(USAGE);
    nothingCreated();
    expect(fs.existsSync(addLock())).toBe(false);
  });

  it('W5-B9: a 64-hex REF NAME in a SHA-1 repository is refused, though the branch resolves to a commit (D-7982)', () => {
    const main = path.join(h.home, 'projects', 'demo');
    const name = 'f'.repeat(64);
    h.git(main, 'branch', name);
    expect(h.git(main, 'cat-file', '-t', name).trim(), 'git resolves the name to a commit').toBe('commit');
    const r = wsAdd(`--no-rc --child 7 --base ${name} demo`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(notFull(name));
    nothingCreated();
    expect(fs.existsSync(addLock())).toBe(false);
  });

  it('W5-B9b: a 40-hex branch name naming no object is refused: at full length git reads an object id, never a ref', () => {
    const main = path.join(h.home, 'projects', 'demo');
    const name = 'e'.repeat(40);
    h.git(main, 'branch', name);
    const r = wsAdd(`--no-rc --child 7 --base ${name} demo`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(notFull(name));
    nothingCreated();
  });

  it('W5-B10: an object format git cannot report refuses, with the reason, before anything exists (D-7982)', () => {
    const tip = tipOf();
    const r = shStatus(`${WS_ADD_REAL_SPAWN}
      git() { [[ " $* " == *" --show-object-format "* ]] && return 1; command git "$@"; }
      CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --child 7 --base ${tip} demo`, 30);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('ccd: ws-add: --base: the object format of demo could not be read (no answer)');
    nothingCreated();
    expect(fs.existsSync(addLock())).toBe(false);
  });

  it('W5-B11: a refused --base precedes the disk floor and the placement read, not only the add lock', () => {
    const main = path.join(h.home, 'projects', 'demo');
    const blob = h.git(main, 'rev-parse', 'HEAD:README.md').trim();
    const touched = (n: string): string => path.join(h.home, `touched-${n}`);
    const r = shStatus(`${WS_ADD_REAL_SPAWN}
      _ws_disk_free_gb() { : > "$HOME/touched-disk-floor"; echo 999; }
      _place_for_class() { : > "$HOME/touched-placement"; echo lane-a; return 0; }
      CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --child 7 --base ${blob} demo`, 30);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(notFull(blob));
    // One comparison, so a mutant that reaches either reports both (the placement marker is never masked by the floor's).
    expect({ diskFloor: fs.existsSync(touched('disk-floor')), placement: fs.existsSync(touched('placement')) },
      'neither the disk floor nor the placement was read').toEqual({ diskFloor: false, placement: false });
    nothingCreated();
    // CONTROL: the same stubs on a plain child ws-add are reached, so the absence above is the refusal's order. Placement
    // answers a lane, so an order that reached it first would go on past it and leave its marker (W5-BM11).
    shStatus(`${WS_ADD_REAL_SPAWN}
      _ws_disk_free_gb() { : > "$HOME/touched-disk-floor"; echo 999; }
      _place_for_class() { : > "$HOME/touched-placement"; echo lane-a; return 0; }
      CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --child 7 demo`, 30);
    expect(fs.existsSync(touched('disk-floor'))).toBe(true);
    expect(fs.existsSync(touched('placement'))).toBe(true);
  });
});

/** A `--filter=blob:none` clone of demo's origin at `projects/<name>`, whose history holds one blob that only an older
 *  commit names, so the clone does not have it. Null when this git cannot serve a filtered clone, or ignores
 *  `GIT_NO_LAZY_FETCH` (git before 2.45), measured on the clone itself rather than read from a version string. */
const partialCloneWithMissingBlob = (name: string): { main: string; blob: string } | null => {
  const src = path.join(h.home, 'projects', 'demo');
  const origin = path.join(h.home, 'origins', 'demo.git');
  fs.writeFileSync(path.join(src, 'old.txt'), 'only in history\n');
  h.git(src, 'add', 'old.txt'); h.git(src, 'commit', '-m', 'old');
  const blob = h.git(src, 'rev-parse', 'HEAD:old.txt').trim();
  h.git(src, 'rm', '-q', 'old.txt'); h.git(src, 'commit', '-m', 'drop old');
  h.git(src, 'push', '-q', 'origin', 'main');
  h.git(origin, 'config', 'uploadpack.allowFilter', 'true');
  const main = path.join(h.home, 'projects', name);
  try {
    h.git(h.home, 'clone', '-q', '--filter=blob:none', `file://${origin}`, main);
  } catch { return null; }
  const has = (): boolean => {
    try { execFileSync('git', ['-C', main, 'cat-file', '-e', blob], { env: { ...process.env, HOME: h.home, GIT_NO_LAZY_FETCH: '1' }, stdio: 'ignore' }); return true; } catch { return false; }
  };
  if (has()) return null;
  return { main, blob };
};

describe('a partial clone', () => {
  it('W5-B12: the object check never lazy-fetches a missing object from the promisor remote (skipped without filter support)', (ctx) => {
    const pc = partialCloneWithMissingBlob('demopc');
    if (pc === null) { ctx.skip(); return; }
    const r = wsAdd(`--no-rc --child 7 --base ${pc.blob} demopc`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(notFull(pc.blob, 'demopc'));
    nothingCreated('demopc', 'demopc-quiet-mesa');
    let fetched = true;
    try {
      execFileSync('git', ['-C', pc.main, 'cat-file', '-e', pc.blob], { env: { ...process.env, HOME: h.home, GIT_NO_LAZY_FETCH: '1' }, stdio: 'ignore' });
    } catch { fetched = false; }
    expect(fetched, 'the refusal fetched the object from the promisor remote').toBe(false);
  });
});

/** A SHA-256 repository with an origin, `makeRepo`'s shape; null when this git cannot make one. */
const makeSha256Repo = (name: string): string | null => {
  const origin = path.join(h.home, 'origins', `${name}.git`);
  const main = path.join(h.home, 'projects', name);
  try {
    h.git(h.home, 'init', '--bare', '--object-format=sha256', '-b', 'main', origin);
    h.git(h.home, 'init', '--object-format=sha256', '-b', 'main', main);
  } catch { return null; }
  fs.writeFileSync(path.join(main, 'README.md'), 'hi\n');
  h.git(main, 'add', 'README.md'); h.git(main, 'commit', '-m', 'init');
  h.git(main, 'remote', 'add', 'origin', origin);
  h.git(main, 'push', '-u', 'origin', 'main');
  h.git(main, 'remote', 'set-head', 'origin', '-a');
  return main;
};

describe('a SHA-256 repository', () => {
  it('W5-B3: a 64-hex commit id in a SHA-256 repository is accepted (skipped when this git cannot make one)', (ctx) => {
    const main = makeSha256Repo('demo256');
    if (main === null) { ctx.skip(); return; }
    fs.writeFileSync(path.join(main, 'lease-work.txt'), 'w\n');
    h.git(main, 'checkout', '-b', 'claude/agent-a');
    h.git(main, 'add', 'lease-work.txt'); h.git(main, 'commit', '-m', 'lease work');
    const tip = h.git(main, 'rev-parse', 'HEAD').trim();
    h.git(main, 'checkout', '-');
    expect(tip).toMatch(/^[0-9a-f]{64}$/);
    const r = wsAdd(`--no-rc --child 7 --base ${tip} demo256`);
    expect(r.status, r.out).toBe(0);
    expect(h.git(path.join(h.home, 'worktrees', 'demo256', 'quiet-mesa'), 'rev-parse', 'HEAD').trim()).toBe(tip);
    expect(h.reg('demo256-quiet-mesa', 'base')).toBe('origin/main');
    const rows = createRows();
    expect(measOf(rows[0]!)['startpoint']).toBe(tip);
  });

  it('W5-B9c: a 40-hex PREFIX of a commit in a SHA-256 repository is refused, though git resolves it (D-7982)', (ctx) => {
    const main = makeSha256Repo('demo256');
    if (main === null) { ctx.skip(); return; }
    const full = h.git(main, 'rev-parse', 'HEAD').trim();
    const prefix = full.slice(0, 40);
    expect(h.git(main, 'cat-file', '-t', prefix).trim(), 'git resolves the prefix to a commit').toBe('commit');
    const r = wsAdd(`--no-rc --child 7 --base ${prefix} demo256`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(notFull(prefix, 'demo256', 'sha256'));
    nothingCreated('demo256', 'demo256-quiet-mesa');
  });

  for (const kind of ['branch', 'tag', 'both'] as const) {
    it(`W5-B9e (${kind}): in a SHA-256 repository too, a ${kind === 'both' ? 'branch and a tag' : kind} named the id never diverts the start point (skipped when this git cannot make one)`, (ctx) => {
      const main = makeSha256Repo('demo256');
      if (main === null) { ctx.skip(); return; }
      const older = h.git(main, 'rev-parse', 'HEAD').trim();
      fs.writeFileSync(path.join(main, 'lease-work.txt'), 'w\n');
      h.git(main, 'checkout', '-b', 'claude/agent-a');
      h.git(main, 'add', 'lease-work.txt'); h.git(main, 'commit', '-m', 'lease work');
      const tip = h.git(main, 'rev-parse', 'HEAD').trim();
      h.git(main, 'checkout', '-');
      expect(tip).toMatch(/^[0-9a-f]{64}$/);
      if (kind !== 'tag') h.git(main, 'update-ref', `refs/heads/${tip}`, older);
      if (kind !== 'branch') h.git(main, 'update-ref', `refs/tags/${tip}`, older);
      const r = wsAdd(`--no-rc --child 7 --base ${tip} demo256`);
      expect(r.status, `${kind}: ${r.out}`).toBe(0);
      expect(r.out, kind).not.toContain('ambiguous object name');
      expect(h.git(path.join(h.home, 'worktrees', 'demo256', 'quiet-mesa'), 'rev-parse', 'HEAD').trim(), kind).toBe(tip);
      expect(measOf(createRows()[0]!)['startpoint'], kind).toBe(tip);
    });
  }
});

/** The `--base` arms of `cmd_ws_add`'s strip loop: each is one line, so an older-shaped copy is this source with
 *  exactly these lines removed. */
const BASE_ARM = /^\s+--base(=\*)?\)\s/;

describe('an older ccd binds a leading --base as the project and refuses (D-6164)', () => {
  it('the --base arm is exactly two lines of cmd_ws_add, so W5-B8 strips the whole of it', () => {
    // A scan, so it reads the program (`ccdSource()`, the libraries spliced back), not the file alone.
    const src = ccdSource().split('\n');
    const body = src.slice(src.findIndex((l) => l.startsWith('cmd_ws_add() {')));
    const fnEnd = body.findIndex((l) => l === '}');
    expect(body.slice(0, fnEnd).filter((l) => BASE_ARM.test(l))).toHaveLength(2);
    expect(src.filter((l) => BASE_ARM.test(l)), 'and nowhere else in ccd or its libraries').toHaveLength(2);
  });

  it('W5-B8: a ccd copy with the --base arm removed refuses the leading flag, with nothing created', () => {
    // The copy: ccd/ccd less its `--base` arm, written under the fixture HOME beside regular-file copies of its libraries
    // (the loader refuses a symlinked library). What it lost is checked against the arm the PROGRAM scan finds
    // (`ccdSource()`), not against the text this test just wrote.
    const src = fs.readFileSync(CCD, 'utf8');
    const srcSha = createHash('sha256').update(src).digest('hex');
    const older = src.split('\n').filter((l) => !BASE_ARM.test(l)).join('\n');
    const kept = new Set(older.split('\n'));
    const lost = src.split('\n').filter((l) => !kept.has(l));
    expect(lost, 'the copy lost exactly the --base arm the program scan finds').toEqual(
      ccdSource().split('\n').filter((l) => BASE_ARM.test(l)));
    expect(src.split('\n').length - older.split('\n').length, 'and nothing else').toBe(2);
    const dir = path.join(h.home, 'older-ccd');
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(path.join(path.dirname(CCD), 'lib'), path.join(dir, 'lib'), { recursive: true, dereference: true });
    const copy = path.join(dir, 'ccd');
    fs.writeFileSync(copy, older, { mode: 0o755 });

    const tip = tipOf();
    const r = wsAdd(`--no-rc --child 7 --base ${tip} demo`, copy);
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toContain("invalid project '--base'");
    nothingCreated();
    expect(h.reg(`--base-quiet-mesa`, 'uuid')).toBeNull();
    expect(createHash('sha256').update(fs.readFileSync(CCD, 'utf8')).digest('hex'), 'the source ccd is untouched').toBe(srcSha);
  });
});

describe('cmd_caps', () => {
  it('advertises ws-add-base-v1', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('ws-add-base-v1');
  });
});
