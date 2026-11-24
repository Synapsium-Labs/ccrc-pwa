// docs-folder (X2 spec 2026-11-18 section 4.1, plan Task P2.1, ccd half): the registry of outside folders and the
// admission of one, by descriptors. Every end-to-end case runs the SHIPPED dispatcher in a fixture HOME through
// `runCcdDocs` (the three poisons are `runCcdDocs`'s), never the live HOME; the pure identity comparison is called
// through `unitJson`. The folders live inside the fixture HOME: an ordinary directory under it is admissible, since HOME
// itself is refused only as an exact match, or when the folder contains it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { REAL_PYTHON3, parseOneLine, runCcdDocs, type DocsRun } from './ccdDocsHelpers.js';
import { unitJson } from './docsHelperPy.js';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers/roster.js';

type Answer = Record<string, unknown>;

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccd-docs-folder-'); });
afterEach(() => { h.cleanup(); });

const registryDir = (): string => path.join(h.home, '.cc-sessions', 'docs-folders');
const cacheDir = (): string => path.join(h.home, '.cc-docs-range');
const mkdir = (...parts: string[]): string => {
  const p = path.join(h.home, ...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
};
const ccd = (args: readonly string[], env: NodeJS.ProcessEnv = {}): DocsRun => runCcdDocs(h, ['docs-folder', ...args], env);
const ans = (args: readonly string[], env: NodeJS.ProcessEnv = {}): Answer => parseOneLine(ccd(args, env));
const add = (label: string, p: string, env: NodeJS.ProcessEnv = {}): Answer => ans(['--add', label, '--path', p], env);
const list = (env: NodeJS.ProcessEnv = {}): Answer => ans(['--list'], env);
const folders = (): { label: string; path: string | null; state: string }[] =>
  list()['folders'] as { label: string; path: string | null; state: string }[];
/** Nothing the verb makes exists: no registry directory, no range cache. */
const noSideEffects = (): void => {
  expect(fs.existsSync(registryDir()), 'no registry directory was made').toBe(false);
  expect(fs.existsSync(cacheDir()), 'no range cache was made').toBe(false);
};
/** What the run's streams carry of `p`: the whole path and each component longer than 3 characters. */
const leaks = (r: DocsRun, p: string): string[] =>
  [p, ...p.split('/').filter((c) => c.length > 3)].filter((s) => (r.stdout + r.stderr).includes(s));
/** A symlink to the fixture HOME, spelled under /var/tmp: outside the per-run temp parent that holds the real HOME, so
 *  no spelling of the link is a path prefix of the real HOME's, and neither is a prefix of the other's ancestors. */
const linkedHome = (): { link: string; drop: () => void } => {
  const parent = path.dirname(h.home);
  const base = ['/var/tmp', '/dev/shm', '/run/user'].find((b) => fs.existsSync(b) && !parent.startsWith(`${b}/`) && b !== parent);
  if (base === undefined) throw new Error('linkedHome: no directory outside the per-run temp parent');
  const dir = fs.mkdtempSync(path.join(base, 'ccd-docs-folder-link-'));
  const link = path.join(dir, 'home');
  fs.symlinkSync(h.home, link);
  return { link, drop: () => { fs.rmSync(dir, { recursive: true, force: true }); } };
};
const sleepMs = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
/** One unit run on the helper's functions, on a ctx for the fixture HOME's own roots. */
const ctxPy = (): string => [
  'import os',
  `home = ${JSON.stringify(h.home)}`,
  "ctx = H.Ctx('docs-folder', home + '/projects', home + '/worktrees', home + '/.cc-sessions', 0)",
].join('\n');

describe('docs-folder: the parser (X2 P2.1)', () => {
  const GOOD = '/zq/dir';
  it('folder parser: a second mode and every malformed shape is refused with the usage line, rc 1, empty stdout, no side effect', () => {
    const bad: string[][] = [
      [],
      ['--list', '--add', 'x'], ['--list', 'x'], ['--list', '--list'], ['--list', '--remove', 'a'],
      ['--add'], ['--add', 'a'], ['--add', 'a', '--path'], ['--add', 'a', '--path', GOOD, '--remove', 'a'],
      ['--add', 'a', '--path', GOOD, '--path', GOOD], ['--add', 'a', '--path', GOOD, '--add', 'b'],
      ['--add', 'a', '--path', GOOD, '--list'], ['--add', 'a', '--remove', 'a'], ['--add', 'a', '--paths', GOOD],
      ['--path', GOOD, '--add', 'a'], ['--path', GOOD],
      ['--remove'], ['--remove', 'a', 'b'], ['--remove', 'a', '--list'], ['--remove', 'a', '--remove', 'a'],
      ['--remove', 'a', '--add', 'b', '--path', GOOD], ['--list', '--remove'],
      ['a'], ['--bogus'], ['--List'],
    ];
    for (const args of bad) {
      const r = ccd(args);
      const where = JSON.stringify(args);
      expect(r.code, `rc for ${where}`).toBe(1);
      expect(r.stdout, `stdout for ${where}`).toBe('');
      expect(r.stderr, `usage for ${where}`).toContain('usage: ccd docs-folder');
    }
    noSideEffects();
  });

  it('folder parser: a flag in a value slot is a value, which its grammar then refuses', () => {
    // Fixed indexes: `--path` as the label is a label, and the label grammar refuses it, rc 0 and one line.
    expect(ans(['--add', '--path', '--path', GOOD])).toMatchObject({ v: 1, verb: 'docs-folder', ok: false, failure: 'bad-label' });
    expect(ans(['--remove', '--list'])).toMatchObject({ ok: false, failure: 'bad-label' });
    noSideEffects();
  });

  it('folder parser: the verb and its token are in ccd caps', () => {
    const lines = runCcdDocs(h, ['caps']).stdout.split('\n');
    expect(lines).toContain('docs-folder');
    expect(lines).toContain('docs-folders-v1');
  });
});

describe('docs-folder: the registry round trip (X2 P2.1)', () => {
  it('folder: --add then --list shows label and path, --remove then --list is empty', () => {
    expect(list(), 'before any add, the list is empty and creates nothing').toMatchObject({ v: 1, verb: 'docs-folder', ok: true, folders: [] });
    noSideEffects();
    const a = mkdir('zqfix', 'alpha');
    const b = mkdir('zqfix', 'beta');
    const added = add('beta', b);
    expect(added).toMatchObject({ v: 1, verb: 'docs-folder', ok: true, label: 'beta' });
    expect(JSON.stringify(added), 'an add answers no path').not.toContain(b);
    expect(add('alpha', a)).toMatchObject({ ok: true, label: 'alpha' });
    expect(list()).toMatchObject({ ok: true, folders: [{ label: 'alpha', path: a }, { label: 'beta', path: b }] });
    // The registry: a directory of mode 0700, one 0600 regular file per label holding the path and a newline, and a lock.
    expect(fs.statSync(registryDir()).mode & 0o777).toBe(0o700);
    expect(fs.readFileSync(path.join(registryDir(), 'alpha'), 'utf8')).toBe(`${a}\n`);
    expect(fs.statSync(path.join(registryDir(), 'alpha')).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(registryDir()).sort(), 'no temporary file is left').toEqual(['.lock', 'alpha', 'beta']);
    const removed = ans(['--remove', 'alpha']);
    expect(removed).toMatchObject({ ok: true, label: 'alpha', removed: true });
    expect(JSON.stringify(removed)).not.toContain(a);
    expect(folders()).toEqual([{ label: 'beta', path: b, state: 'ok' }]);
    expect(ans(['--remove', 'beta'])).toMatchObject({ ok: true, removed: true });
    expect(folders()).toEqual([]);
  });

  it('folder add: a label already registered refuses label-exists and leaves the registry as it was', () => {
    const a = mkdir('zqfix', 'alpha');
    const other = mkdir('zqfix', 'other');
    expect(add('alpha', a)).toMatchObject({ ok: true });
    const again = ccd(['--add', 'alpha', '--path', other]);
    expect(parseOneLine(again)).toMatchObject({ ok: false, failure: 'label-exists' });
    expect(leaks(again, other)).toEqual([]);
    expect(fs.readFileSync(path.join(registryDir(), 'alpha'), 'utf8')).toBe(`${a}\n`);
    expect(fs.readdirSync(registryDir()).sort()).toEqual(['.lock', 'alpha']);
  });

  it('folder remove: a label nothing registered refuses unknown-folder, with or without a registry directory', () => {
    expect(ans(['--remove', 'nosuch'])).toMatchObject({ ok: false, failure: 'unknown-folder' });
    noSideEffects();
    expect(add('alpha', mkdir('zqfix', 'alpha'))).toMatchObject({ ok: true });
    expect(ans(['--remove', 'nosuch'])).toMatchObject({ ok: false, failure: 'unknown-folder' });
    expect(folders()).toHaveLength(1);
  });

  it('folder list: a label file that cannot be read, or holds no one admissible absolute path, is listed unreadable, never echoed', () => {
    const good = mkdir('zqfix', 'good');
    const dir = registryDir();
    fs.mkdirSync(dir, { mode: 0o700 });
    const put = (name: string, body: string | Buffer): void => { fs.writeFileSync(path.join(dir, name), body); };
    put('good', `${good}\n`);
    put('relative', 'zqrelative/dir\n');
    put('twolines', `${good}\n${good}\n`);
    put('nonewline', good);
    put('dotdot', '/zq/../etc\n');
    put('trailing', '/zq/dir/\n');
    put('control', '/zq/di\u0001r\n');
    put('empty', '');
    put('toolong', `/${'a'.repeat(4096)}\n`);
    put('Upper', `${good}\n`);
    put('.hidden', `${good}\n`);
    put('badutf8', Buffer.from([0x2f, 0xff, 0xfe, 0x0a]));
    fs.symlinkSync(path.join(dir, 'good'), path.join(dir, 'linked'));
    execFileSync('mkfifo', [path.join(dir, 'fifo')]);
    fs.mkdirSync(path.join(dir, 'adir'));
    const r = ccd(['--list']);
    // Every entry named as a label is listed, so Settings can remove it: the good one carries its path and state ok, each
    // other one a null path and state unreadable. A name that is no label ('Upper', '.hidden', '.lock') is not listed.
    const bad = ['adir', 'badutf8', 'control', 'dotdot', 'empty', 'fifo', 'linked', 'nonewline', 'relative', 'toolong', 'trailing', 'twolines'];
    expect(parseOneLine(r)).toMatchObject({
      ok: true,
      folders: [{ label: 'adir', path: null, state: 'unreadable' }, { label: 'badutf8', path: null, state: 'unreadable' },
        { label: 'control', path: null, state: 'unreadable' }, { label: 'dotdot', path: null, state: 'unreadable' },
        { label: 'empty', path: null, state: 'unreadable' }, { label: 'fifo', path: null, state: 'unreadable' },
        { label: 'good', path: good, state: 'ok' }, { label: 'linked', path: null, state: 'unreadable' },
        { label: 'nonewline', path: null, state: 'unreadable' }, { label: 'relative', path: null, state: 'unreadable' },
        { label: 'toolong', path: null, state: 'unreadable' }, { label: 'trailing', path: null, state: 'unreadable' },
        { label: 'twolines', path: null, state: 'unreadable' }],
    });
    expect(folders().map((f) => f.label)).toEqual([...bad, 'good'].sort());
    for (const junk of ['zqrelative', '/zq/../etc', 'aaaaaaaa', 'Upper', '.hidden']) expect(r.stdout).not.toContain(junk);
    expect(r.stdout, 'a path is carried by the good row alone').toContain(good);
    expect(r.stdout.split(good).length - 1).toBe(1);
  });

  it('folder remove: a label whose file is unreadable is removed, and its snapshots go with it', () => {
    const dir = registryDir();
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'junk'), 'zqrelative/dir\n');
    fs.writeFileSync(path.join(dir, 'twolines'), '/a\n/b\n');
    execFileSync('mkfifo', [path.join(dir, 'fifo')]);
    fs.symlinkSync('/nonexistent-zq', path.join(dir, 'dangling'));
    expect(folders().map((f) => [f.label, f.state])).toEqual(
      [['dangling', 'unreadable'], ['fifo', 'unreadable'], ['junk', 'unreadable'], ['twolines', 'unreadable']]);
    for (const label of ['junk', 'twolines', 'fifo', 'dangling']) {
      expect(ans(['--remove', label]), label).toMatchObject({ ok: true, label, removed: true });
    }
    expect(folders()).toEqual([]);
  });

  it('folder registry: a failure other than absence on $REG or on docs-folders answers unreadable, never an empty list or unknown-folder', () => {
    // docs-folders is a file where the directory belongs.
    fs.mkdirSync(path.join(h.home, '.cc-sessions'), { recursive: true });
    fs.writeFileSync(registryDir(), 'a file\n');
    for (const args of [['--list'], ['--remove', 'alpha'], ['--add', 'alpha', '--path', mkdir('zqfix', 'alpha')]]) {
      expect(parseOneLine(ccd(args)), `docs-folders a file: ${JSON.stringify(args)}`).toMatchObject({ ok: false, failure: 'unreadable' });
    }
    fs.rmSync(registryDir());
    // $REG itself is a file: ENOTDIR on the root of the registry.
    fs.rmSync(path.join(h.home, '.cc-sessions'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-sessions'), 'a file\n');
    for (const args of [['--list'], ['--remove', 'alpha'], ['--add', 'alpha', '--path', mkdir('zqfix', 'alpha')]]) {
      expect(parseOneLine(ccd(args)), `$REG a file: ${JSON.stringify(args)}`).toMatchObject({ ok: false, failure: 'unreadable' });
    }
    // CONTROL: an absent $REG is absence, not a failure: an empty list and unknown-folder.
    fs.rmSync(path.join(h.home, '.cc-sessions'));
    expect(list()).toMatchObject({ ok: true, folders: [] });
    expect(ans(['--remove', 'alpha'])).toMatchObject({ ok: false, failure: 'unknown-folder' });
  });

  it('folder registry: a symlinked registry directory refuses unreadable, for a list, an add and a remove', () => {
    const elsewhere = mkdir('zqfix', 'elsewhere');
    fs.symlinkSync(elsewhere, registryDir());
    const f = mkdir('zqfix', 'alpha');
    for (const args of [['--list'], ['--add', 'alpha', '--path', f], ['--remove', 'alpha']]) {
      const r = ccd(args);
      expect(parseOneLine(r), JSON.stringify(args)).toMatchObject({ ok: false, failure: 'unreadable' });
      expect(leaks(r, f)).toEqual([]);
    }
    expect(fs.readdirSync(elsewhere), 'nothing was written through the link').toEqual([]);
  });
});

describe('docs-folder: the label and the path shape (X2 P2.1)', () => {
  it('folder add: a label outside the grammar refused by ccd', () => {
    const f = mkdir('zqfix', 'alpha');
    // A file a traversing label would reach, and a path that would answer something else if the label were not first.
    const victim = path.join(h.home, '.cc-sessions', 'victim');
    fs.writeFileSync(victim, 'keep\n');
    const bad = ['..', '.', 'a/b', '.x', 'a\u0001b', 'a\nb', 'a'.repeat(33), 'Upper', 'a b', '-a', '', '../victim', 'ünï', 'abc\n'];
    for (const label of bad) {
      const where = JSON.stringify(label);
      expect(ans(['--add', label, '--path', f]), `add ${where}`).toMatchObject({ ok: false, failure: 'bad-label' });
      expect(ans(['--add', label, '--path', '/zq/does/not/exist']), `add ${where}, absent path`).toMatchObject({ failure: 'bad-label' });
      expect(ans(['--remove', label]), `remove ${where}`).toMatchObject({ ok: false, failure: 'bad-label' });
    }
    expect(fs.readFileSync(victim, 'utf8')).toBe('keep\n');
    noSideEffects();
    // CONTROL: the edges of the grammar are accepted: 32 characters, a leading digit, inner dashes.
    for (const label of ['a'.repeat(32), '0a', 'a-b-c', 'a']) {
      expect(add(label, f), `add ${label}`).toMatchObject({ ok: true, label });
      expect(ans(['--remove', label])).toMatchObject({ ok: true });
    }
  });

  it('folder add: a path outside the shape refuses bad-path, checked after the label and before any filesystem call', () => {
    const bad = ['', 'relative-zqdir/x', '/', '/zq//x', '/zq/./x', '/zq/../x', '/zq/x/', '/zq/x\n', '/zq/\u0001x', `/${'a'.repeat(4096)}`];
    for (const p of bad) {
      const r = ccd(['--add', 'alpha', '--path', p]);
      expect(parseOneLine(r), JSON.stringify(p.slice(0, 40))).toMatchObject({ ok: false, failure: 'bad-path' });
      expect(r.stdout + r.stderr).not.toContain('relative-zqdir');
    }
    // A bad label is named before a bad path.
    expect(ans(['--add', 'Bad', '--path', 'relative'])).toMatchObject({ failure: 'bad-label' });
    // The longest allowed path (4096 bytes) passes the shape, and the filesystem refuses its 4095-byte component.
    expect(add('alpha', `/${'a'.repeat(4095)}`)).toMatchObject({ ok: false, failure: 'unreadable', reason: 'ENAMETOOLONG' });
    noSideEffects();
  });
});

describe('docs-folder: admission by descriptors (X2 P2.1)', () => {
  it('folder add: symlinked component refused', () => {
    const real = mkdir('zqfix', 'real', 'sub');
    fs.symlinkSync(path.join(h.home, 'zqfix', 'real'), path.join(h.home, 'zqfix', 'link'));
    // A symlink in the middle of the path, and one as the folder itself.
    expect(add('alpha', path.join(h.home, 'zqfix', 'link', 'sub'))).toMatchObject({ ok: false, failure: 'symlink-in-path' });
    expect(add('alpha', path.join(h.home, 'zqfix', 'link'))).toMatchObject({ ok: false, failure: 'symlink-in-path' });
    noSideEffects();
    // CONTROL: the real directory is admitted.
    expect(add('alpha', real)).toMatchObject({ ok: true });
  });

  it('folder add: a file refused', () => {
    mkdir('zqfix');
    const file = path.join(h.home, 'zqfix', 'afile');
    fs.writeFileSync(file, 'not a directory\n');
    expect(add('alpha', file)).toMatchObject({ ok: false, failure: 'not-a-directory' });
    expect(add('alpha', path.join(file, 'below'))).toMatchObject({ ok: false, failure: 'not-a-directory' });
    expect(add('alpha', path.join(h.home, 'zqfix', 'nosuch'))).toMatchObject({ ok: false, failure: 'absent' });
    expect(add('alpha', path.join(h.home, 'zqfix', 'nosuch', 'deeper'))).toMatchObject({ ok: false, failure: 'absent' });
    noSideEffects();
  });

  it('folder add: a foreign owner refused', (ctx) => {
    // A real directory (no symlink on the way) that is not this user's and is not protected: reading its stat writes nothing.
    const euid = process.geteuid?.() ?? -1;
    const foreign = ['/usr', '/etc', '/var', '/opt', '/srv', '/boot', '/lib']
      .find((d) => { try { const st = fs.lstatSync(d); return st.isDirectory() && st.uid !== euid; } catch { return false; } });
    if (foreign === undefined) ctx.skip(); // this box has no directory of another owner at those paths
    const r = ccd(['--add', 'alpha', '--path', foreign!]);
    expect(parseOneLine(r)).toMatchObject({ ok: false, failure: 'foreign-owner' });
    noSideEffects();
  });

  it('folder add: inside the projects root refused', () => {
    const projects = path.join(h.home, 'projects');
    expect(add('alpha', mkdir('projects', 'zqsub'))).toMatchObject({ ok: false, failure: 'protected', reason: 'projects-root' });
    expect(add('alpha', projects)).toMatchObject({ ok: false, failure: 'protected', reason: 'projects-root' });
    // In production the projects root is a symlink to a directory outside HOME. The folder given as that target's parent
    // contains the root (named by its target's identity), and one inside the target is inside it.
    fs.rmSync(projects, { recursive: true });
    const outside = mkTmp('ccd-docs-folder-outside-');
    const target = path.join(outside, 'data', 'projects');
    fs.mkdirSync(path.join(target, 'zqsub'), { recursive: true });
    fs.symlinkSync(target, projects);
    expect(add('alpha', path.join(target, 'zqsub'))).toMatchObject({ ok: false, failure: 'protected', reason: 'projects-root' });
    expect(add('alpha', target)).toMatchObject({ ok: false, failure: 'protected', reason: 'projects-root' });
    expect(add('alpha', path.dirname(target)), 'the parent of the root\'s target').toMatchObject({ ok: false, failure: 'protected', reason: 'projects-root' });
    // CONTROL: a sibling of the target's parent, with nothing protected in it or above, is ordinary.
    expect(add('alpha', mkdir('zqfix', 'ok'))).toMatchObject({ ok: true });
    expect(fs.existsSync(path.join(registryDir(), 'alpha'))).toBe(true);
  });

  it('folder add: every protected directory refused, each with its own reason', () => {
    // Every protected directory is refused with its own reason, the folder inside it or the directory itself.
    const table: [string, string][] = [
      ['projects/zqsub', 'projects-root'], ['projects', 'projects-root'], ['worktrees/zqsub', 'worktrees-root'],
      ['.cc-sessions/zqsub', 'registry'], ['.cc-secrets/zqsub', 'secrets'], ['.cc-limits', 'limits'], ['.ccrc/zqsub', 'ccrc-state'],
      ['ccrc-backups/zqsub', 'backups'], ['.claude-zq/zqsub', 'config-dir'], ['.config', 'dot-config'], ['.ssh/zqsub', 'ssh'],
      ['.gnupg', 'gnupg'], ['.local/share/zqsub', 'local-share'], ['.cc-docs-range', 'range-cache'],
    ];
    for (const [rel, reason] of table) {
      const p = mkdir(...rel.split('/'));
      expect(add('alpha', p), rel).toMatchObject({ ok: false, failure: 'protected', reason });
    }
    // (The range cache directory is among the folders above, made by this test, so only the registry is checked.)
    expect(fs.existsSync(registryDir()), 'no registry directory was made').toBe(false);
  });

  it('folder add: a wrapper config directory from the roster refused', () => {
    // A roster whose account keeps its config directory outside the `.claude*` rule: only the roster's list protects it.
    const roster = {
      ...DEFAULT_TEST_ROSTER,
      accounts: DEFAULT_TEST_ROSTER.accounts.map((a) => (a.id === 'claude-d' ? { ...a, configDirSuffix: '.zqwrap' } : a)),
    };
    seedAccountsSh(h.home, roster);
    const inside = mkdir('.zqwrap', 'zqsub');
    expect(add('alpha', inside)).toMatchObject({ ok: false, failure: 'protected', reason: 'config-dir' });
    expect(add('alpha', path.dirname(inside))).toMatchObject({ ok: false, failure: 'protected', reason: 'config-dir' });
    // CONTROL: a dot directory the roster does not name is an ordinary folder.
    expect(add('alpha', mkdir('.zqplain', 'zqsub'))).toMatchObject({ ok: true });
  });

  it('folder add: a parent of the session registry refused', () => {
    // The directory above HOME holds HOME and so the registry: the folder contains a protected directory.
    const r = ccd(['--add', 'alpha', '--path', path.dirname(h.home)]);
    expect(parseOneLine(r)).toMatchObject({ ok: false, failure: 'protected', reason: 'registry' });
    expect(leaks(r, path.dirname(h.home))).toEqual([]);
    noSideEffects();
  });

  it('folder add: the home directory refused', () => {
    expect(add('alpha', h.home)).toMatchObject({ ok: false, failure: 'protected', reason: 'home' });
    noSideEffects();
    // CONTROL: a directory directly inside HOME is the ordinary case.
    expect(add('alpha', mkdir('zqfix'))).toMatchObject({ ok: true });
  });

  it('folder add: a protected directory named through a symlinked HOME refused', () => {
    // ccd runs with HOME a symlink to the real directory, so its protected paths spell `<link>/.config` while the folder is
    // given by its REAL path under it: a path-prefix comparison passes it, only the device and inode say it is inside.
    const { link, drop } = linkedHome();
    try {
      const inside = mkdir('.config', 'zqapp');
      expect(inside.startsWith(link), 'the two spellings share no prefix').toBe(false);
      // The INSIDE check: the folder is below a protected directory.
      expect(add('alpha', inside, { HOME: link })).toMatchObject({ ok: false, failure: 'protected', reason: 'dot-config' });
      expect(add('alpha', path.join(h.home, '.config'), { HOME: link })).toMatchObject({ ok: false, failure: 'protected', reason: 'dot-config' });
      // The CONTAINS check: the folder, given by its real path, is the HOME's parent, which holds the protected directories
      // that ccd spells through the link. A path-prefix comparison of the two spellings finds nothing in common.
      const parent = path.dirname(h.home);
      expect(parent.startsWith(path.dirname(link)) || link.startsWith(parent), 'the two spellings are unrelated').toBe(false);
      const above = ccd(['--add', 'alpha', '--path', parent], { HOME: link });
      expect(parseOneLine(above)).toMatchObject({ ok: false, failure: 'protected', reason: 'registry' });
      expect(leaks(above, parent)).toEqual([]);
      expect(fs.existsSync(registryDir())).toBe(false);
      // CONTROL: through the same symlinked HOME, an ordinary folder is admitted, so the refusals were the protected rule.
      const ok = mkdir('zqfix', 'ok');
      expect(add('alpha', ok, { HOME: link })).toMatchObject({ ok: true });
      expect(list({ HOME: link })).toMatchObject({ folders: [{ label: 'alpha', path: ok }] });
    } finally {
      drop();
    }
  });

  it('protected comparison: a directory whose device and inode match a protected one refuses, whatever its path', () => {
    // The pure function: identities only, no path. A hit names the first protected entry in list order; HOME alone is
    // excluded from the inside check, except for the folder itself.
    const got = unitJson<(string | null)[]>(h.home, [
      'chain = [(5, 1), (5, 20), (5, 300)]',
      'protected = [((5, 99), "ssh"), ((5, 20), "dot-config"), ((5, 300), "secrets")]',
      'out([',
      '    H.folder_protected_hit(chain, (5, 300), protected),',
      '    H.folder_protected_hit([(5, 1), (5, 20)], (5, 20), protected),',
      '    H.folder_protected_hit([(5, 1)], (5, 1), protected),',
      '    H.folder_protected_hit([(6, 20), (5, 21)], (5, 21), protected),',
      '    H.folder_protected_hit([], (5, 1), protected),',
      '    H.folder_protected_hit(chain, (5, 300), [((5, 300), "secrets"), ((5, 20), "dot-config")]),',
      '    H.folder_protected_hit([(5, 1), (5, 2)], (5, 2), [((5, 1), "home")]),',
      '    H.folder_protected_hit([(5, 1)], (5, 1), [((5, 1), "home")]),',
      '    H.folder_protected_hit([[5, 20]], [5, 20], [[[5, 20], "ssh"]]),',
      '])',
    ].join('\n'));
    expect(got).toEqual([
      'dot-config', // an ancestor matches: the first listed entry in the chain wins, not the deepest
      'dot-config', // the folder itself matches
      null,         // nothing in the chain is protected
      null,         // same inode on another device, and same device with another inode: not a match
      null,         // an empty chain
      'secrets',    // list order decides
      null,         // HOME above the folder is the ordinary case
      'home',       // HOME as the folder itself
      'ssh',        // pairs from JSON arrive as lists and compare alike
    ]);
  });

  it('folder add: refusal never echoes the path', () => {
    const zq = mkdir('zqfix', 'zqrealdir', 'zqchild');
    fs.symlinkSync(path.join(h.home, 'zqfix', 'zqrealdir'), path.join(h.home, 'zqfix', 'zqlinkname'));
    const file = path.join(h.home, 'zqfix', 'zqplainfile');
    fs.writeFileSync(file, 'x\n');
    const cfg = mkdir('.config', 'zqappdir');
    const refusals: [string, string, string][] = [
      ['symlink-in-path', path.join(h.home, 'zqfix', 'zqlinkname', 'zqchild'), 'symlink-in-path'],
      ['absent', path.join(h.home, 'zqfix', 'zqnosuchdir'), 'absent'],
      ['not-a-directory', file, 'not-a-directory'],
      ['protected (inside)', cfg, 'protected'],
      ['protected (contains)', path.dirname(h.home), 'protected'],
      ['bad-path', 'zqrelative/zqdir', 'bad-path'],
    ];
    const euid = process.geteuid?.() ?? -1;
    const foreign = ['/usr', '/etc', '/var', '/opt'].find((d) => { try { return fs.lstatSync(d).uid !== euid; } catch { return false; } });
    if (foreign !== undefined) refusals.push(['foreign-owner', foreign, 'foreign-owner']);
    // unreadable: a directory on the way that cannot be searched (root searches anything, so there is no such case for root).
    const locked = mkdir('zqfix', 'zqlockeddir');
    mkdir('zqfix', 'zqlockeddir', 'zqlockedchild');
    if (euid !== 0) refusals.push(['unreadable', path.join(locked, 'zqlockedchild'), 'unreadable']);
    try {
      if (euid !== 0) fs.chmodSync(locked, 0o000);
      for (const [name, p, failure] of refusals) {
        const r = ccd(['--add', 'alpha', '--path', p]);
        expect(parseOneLine(r), name).toMatchObject({ ok: false, failure });
        expect(leaks(r, p), `${name}: the refusal carries nothing of the path`).toEqual([]);
      }
    } finally {
      fs.chmodSync(locked, 0o755);
    }
    expect(refusals.some(([n]) => n === 'unreadable') || euid === 0, 'the unreadable refusal is in the scan').toBe(true);
    // A remove and an add of a registered label name no path either; only a list does.
    expect(add('alpha', zq)).toMatchObject({ ok: true });
    const again = ccd(['--add', 'alpha', '--path', zq]);
    expect(parseOneLine(again)).toMatchObject({ failure: 'label-exists' });
    expect(leaks(again, zq)).toEqual([]);
    const gone = ccd(['--remove', 'nosuch']);
    expect(leaks(gone, zq)).toEqual([]);
    expect(leaks(ccd(['--list']), zq), 'the list is the one answer that carries a path').toContain(zq);
  });
});

describe('docs-folder: remove purges the label\'s snapshots (X2 P2.1)', () => {
  /** A completed snapshot in the fixture HOME's range cache, in the cache's own format, bound to `bind`. */
  const snapshot = (bind: Record<string, unknown>): string => {
    const id = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(cacheDir(), `${id}.bin`), 'bytes\n', { mode: 0o400 });
    const st = fs.statSync(path.join(cacheDir(), `${id}.bin`));
    fs.writeFileSync(path.join(cacheDir(), `${id}.meta`), JSON.stringify({
      id, size: 6, digest: crypto.createHash('sha256').update('bytes\n').digest('hex'), used: Date.now(), bind,
      ino: st.ino, mtime_ns: Math.floor(st.mtimeMs) * 1_000_000, ctime_ns: Math.floor(st.ctimeMs) * 1_000_000,
    }));
    return id;
  };
  const names = (): string[] => fs.readdirSync(cacheDir()).sort();

  it('folder remove: purges snapshots', () => {
    expect(add('gone', mkdir('zqfix', 'gone'))).toMatchObject({ ok: true });
    expect(add('keep', mkdir('zqfix', 'keep'))).toMatchObject({ ok: true });
    const folderBind = (label: string): Record<string, unknown> => ({ label, section: 'specs', path: 'a.md', pin: `stat:6:1` });
    const mine = snapshot(folderBind('gone'));
    const mine2 = snapshot(folderBind('gone'));
    const other = snapshot(folderBind('keep'));
    const project = snapshot({ project: 'demo', commit: 'c'.repeat(40), branch: null, head: null, section: 'specs', path: 'a.md', pin: `blob:${'b'.repeat(40)}` });
    expect(names()).toHaveLength(8);
    expect(ans(['--remove', 'gone'])).toMatchObject({ ok: true, label: 'gone', removed: true });
    const left = names().filter((n) => n !== 'lock');
    expect(left, 'only the snapshots bound to the removed label went, both halves of each').toEqual(
      [`${other}.bin`, `${other}.meta`, `${project}.bin`, `${project}.meta`].sort());
    for (const id of [mine, mine2]) expect(left.some((n) => n.startsWith(id))).toBe(false);
    expect(folders().map((f) => f.label)).toEqual(['keep']);
  });

  it('folder remove: a remove with no range cache makes none', () => {
    expect(add('gone', mkdir('zqfix', 'gone'))).toMatchObject({ ok: true });
    expect(ans(['--remove', 'gone'])).toMatchObject({ ok: true, removed: true });
    expect(fs.existsSync(cacheDir()), 'the purge never creates the cache').toBe(false);
  });

  it('folder remove: a failed purge leaves the label registered, and a retry works', () => {
    expect(add('gone', mkdir('zqfix', 'gone'))).toMatchObject({ ok: true });
    const id = snapshot({ label: 'gone', section: 'specs', path: 'a.md', pin: 'stat:6:1' });
    // The snapshot's `.bin` is a directory: removing it fails (EISDIR), after the purge has been asked for the label.
    fs.rmSync(path.join(cacheDir(), `${id}.bin`));
    fs.mkdirSync(path.join(cacheDir(), `${id}.bin`));
    const r = ccd(['--remove', 'gone']);
    expect(parseOneLine(r)).toMatchObject({ ok: false, failure: 'unreadable', reason: 'EISDIR' });
    expect(folders().map((f) => f.label), 'the purge failed, so the label is still registered').toEqual(['gone']);
    // The cause cleared, the retry removes the label and the snapshot.
    fs.rmdirSync(path.join(cacheDir(), `${id}.bin`));
    fs.writeFileSync(path.join(cacheDir(), `${id}.bin`), 'bytes\n', { mode: 0o400 });
    expect(ans(['--remove', 'gone'])).toMatchObject({ ok: true, removed: true });
    expect(names().filter((n) => n.startsWith(id))).toEqual([]);
    expect(folders()).toEqual([]);
  });

  it('folder remove: a symlinked, non-directory or lock-broken range cache answers unreadable (range-cache), never helper-failed', () => {
    expect(add('gone', mkdir('zqfix', 'gone'))).toMatchObject({ ok: true });
    const refused = (what: string): void => {
      const r = ccd(['--remove', 'gone']);
      expect(parseOneLine(r), what).toMatchObject({ ok: false, failure: 'unreadable', reason: 'range-cache' });
      expect(folders().map((f) => f.label), `${what}: the label stays`).toEqual(['gone']);
    };
    const elsewhere = mkdir('zqfix', 'elsewhere-cache');
    fs.symlinkSync(elsewhere, cacheDir());
    refused('a symlink');
    expect(fs.readdirSync(elsewhere), 'nothing was made through the link').toEqual([]);
    fs.rmSync(cacheDir());
    fs.writeFileSync(cacheDir(), 'a file\n');
    refused('a file');
    fs.rmSync(cacheDir());
    fs.mkdirSync(cacheDir(), { mode: 0o700 });
    execFileSync('mkfifo', [path.join(cacheDir(), 'lock')]);
    refused('a FIFO for the lock');
    fs.rmSync(path.join(cacheDir(), 'lock'));
    // CONTROL: a sound cache lets the same remove through.
    expect(ans(['--remove', 'gone'])).toMatchObject({ ok: true, removed: true });
  });

  it('folder remove: a busy range cache answers prepare-busy, and the label stays registered', () => {
    expect(add('gone', mkdir('zqfix', 'gone'))).toMatchObject({ ok: true });
    fs.mkdirSync(cacheDir(), { mode: 0o700 });
    const ready = path.join(h.home, 'zqholder-ready');
    // Another process holds the cache's own lock, as a prepare in flight does.
    const child = spawn(REAL_PYTHON3, ['-c', [
      'import fcntl, os, time',
      `fd = os.open(${JSON.stringify(path.join(cacheDir(), 'lock'))}, os.O_RDWR | os.O_CREAT, 0o600)`,
      'fcntl.flock(fd, fcntl.LOCK_EX)',
      `open(${JSON.stringify(ready)}, 'w').close()`,
      'time.sleep(120)',
    ].join('\n')], { stdio: 'ignore' });
    try {
      for (let i = 0; i < 100 && !fs.existsSync(ready); i++) sleepMs(100);
      expect(fs.existsSync(ready), 'the holder has the lock').toBe(true);
      const t0 = Date.now();
      expect(ans(['--remove', 'gone'])).toMatchObject({ ok: false, failure: 'prepare-busy' });
      expect(Date.now() - t0, 'the wait is bounded').toBeLessThan(30_000);
      expect(folders().map((f) => f.label)).toEqual(['gone']);
    } finally {
      child.kill('SIGKILL');
    }
    sleepMs(500);
    expect(ans(['--remove', 'gone']), 'the holder gone, the same remove goes through').toMatchObject({ ok: true, removed: true });
  });
});

describe('docs-folder: what a refusal leaves behind (X2 P2.1)', () => {
  it('folder add: an add refused under the lock leaves no registry directory it made', () => {
    // The re-check under the lock is the second admission. A refusal there (a folder that went away, or became
    // protected, after the first) must not leave the directory this call created. The first admission passes and the
    // second refuses, as a race would have it.
    const got = unitJson<[string | null, boolean, number]>(h.home, [
      ctxPy(),
      'calls = [0]',
      'def fake(ctx, path, cfg):',
      '    calls[0] += 1',
      '    if calls[0] == 1:',
      '        return os.open("/", os.O_RDONLY), None',
      '    raise H.Fail("absent")',
      'H.folder_admit = fake',
      "a = H.FolderArgs('add', 'alpha', '/zq/dir', [])",
      'word = None',
      'try:',
      '    H.verb_folder(ctx, a)',
      'except H.Fail as f:',
      '    word = f.word',
      "out([word, os.path.exists(home + '/.cc-sessions/docs-folders'), calls[0]])",
    ].join('\n'));
    expect(got).toEqual(['absent', false, 2]);
  });

  it('folder add: an add refused under the lock leaves an existing registry as it was', () => {
    // CONTROL for the cleanup: a directory this call did not make is never removed.
    expect(add('beta', mkdir('zqfix', 'beta'))).toMatchObject({ ok: true });
    const got = unitJson<[string | null, string[]]>(h.home, [
      ctxPy(),
      'calls = [0]',
      'def fake(ctx, path, cfg):',
      '    calls[0] += 1',
      '    if calls[0] == 1:',
      '        return os.open("/", os.O_RDONLY), None',
      '    raise H.Fail("absent")',
      'H.folder_admit = fake',
      "a = H.FolderArgs('add', 'alpha', '/zq/dir', [])",
      'word = None',
      'try:',
      '    H.verb_folder(ctx, a)',
      'except H.Fail as f:',
      '    word = f.word',
      "out([word, sorted(os.listdir(home + '/.cc-sessions/docs-folders'))])",
    ].join('\n'));
    expect(got).toEqual(['absent', ['.lock', 'beta']]);
  });

  it('folder add: a FIFO planted at docs-folders/.lock refuses unreadable at once and never hangs', () => {
    fs.mkdirSync(registryDir(), { mode: 0o700 });
    execFileSync('mkfifo', [path.join(registryDir(), '.lock')]);
    const t0 = Date.now();
    const r = ccd(['--add', 'alpha', '--path', mkdir('zqfix', 'alpha')]);
    expect(Date.now() - t0, 'the add came back within its bound').toBeLessThan(20_000);
    expect(parseOneLine(r)).toMatchObject({ ok: false, failure: 'unreadable', reason: 'lock-not-regular' });
    expect(fs.readdirSync(registryDir()), 'nothing was written').toEqual(['.lock']);
  });

  it('folder roster channel: a relative config directory is a contract breach, not skipped', () => {
    const run = (cfg: string): Answer => unitJson<Answer>(h.home, [
      ctxPy(),
      'import json',
      `argv = ['docs-folder', ctx.root, ctx.worktrees, ctx.reg, '1', ${JSON.stringify(cfg)}, '--list']`,
      'out(json.loads(H.run(argv)))',
    ].join('\n'));
    expect(run('rel/dir')).toMatchObject({ ok: false, failure: 'helper-failed' });
    expect(run('/abs/zqwrap')).toMatchObject({ ok: true, folders: [] });
  });
});
