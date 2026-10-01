// ccd's direct-entry PAIR, published (reclaim-entry-safety, D-3696; Task 3 as
// tightened): `ccd/ccd-entry-install.py`, run by BOTH install lanes — `ccrc
// install`/`update` (`_inst_ccd_pair` in ccd/ccrc) and the fallback deploy
// (`install_ccd_pair` in deploy/deploy.sh, on the box) — renders the launcher,
// self-tests the STAGED launcher through the kernel, and publishes the body
// first and the launcher last, refusing a destination it would have to move a
// file INTO.
//
// FIXTURE HOMEs ONLY. Every case builds a shipped-tree copy at `<home>/ccrc`
// (where deploy.sh's remote command reads it) and asserts what is on disk
// afterwards — bytes, modes, inodes, link targets — never only what the helper
// printed. The ordering and the self-test are proved with an EXECUTABLE hook:
// a fixture copy of the template whose self-test branch, which runs between
// staging and publication, records or obstructs the live destinations.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { CCD, canonicalPython3, ghContainedEnv } from './ccdWsHelpers.js';

const REPO = path.resolve(__dirname, '..', '..');
const PYTHON = canonicalPython3();
/** What the publisher renders into the shebang (D-3698): the PATH-selected
 *  python3 when it resolves to the very interpreter that answered the probe —
 *  so an upgrade that repoints that path does not strand every ccd start —
 *  otherwise the canonical path. */
const PATH_PYTHON = (process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, 'python3'))
  .find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } }) ?? '';
const RENDERED = fs.realpathSync(PATH_PYTHON) === PYTHON ? PATH_PYTHON : PYTHON;
const DEPLOY = fs.readFileSync(path.join(REPO, 'deploy', 'deploy.sh'), 'utf8');

let home: string;
beforeEach(() => { home = mkTmp('ccrc-entry-install-'); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const tree = (): string => path.join(home, 'ccrc');
const entry = (): string => path.join(home, '.local', 'bin', 'ccd');
const body = (): string => path.join(home, '.local', 'libexec', 'ccrc', 'ccd');
const sha = (p: string): string => createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** The template's self-test branch, extended by a fixture HOOK that runs
 *  exactly where the real self-test runs — after staging, before publication.
 *  It finds the real home from its own throwaway layout and acts on marker
 *  files there: `hook-record` writes what the LIVE pair is at that instant;
 *  `hook-obstruct-entry` / `hook-obstruct-body` turn that live destination
 *  into a directory, the shape publication must refuse. */
const HOOK = [
  '        _home = os.path.realpath(sys.argv[0]).split("/.local/.ccd-selftest.")[0]',
  '        def _digest(p):',
  '            try:',
  '                return hashlib.sha256(open(p, "rb").read()).hexdigest()',
  '            except OSError:',
  '                return "absent"',
  '        _e = os.path.join(_home, ".local", "bin", "ccd")',
  '        _b = os.path.join(_home, ".local", "libexec", "ccrc", "ccd")',
  '        if os.path.exists(os.path.join(_home, "hook-record")):',
  '            open(os.path.join(_home, "selftest-saw"), "w").write(_digest(_e) + " " + _digest(_b) + "\\n")',
  '        for _flag, _dest in (("hook-obstruct-entry", _e), ("hook-obstruct-body", _b)):',
  '            if os.path.exists(os.path.join(_home, _flag)):',
  '                os.remove(_dest)',
  '                os.mkdir(_dest)',
].join('\n');

/** A shipped-tree copy at `<home>/ccrc`: the body, the template and the helper.
 *  `template` rewrites the template's text (a hook, a broken self-test); `ccd`
 *  appends to the body. */
function plantTree(o: { template?: (t: string) => string; ccd?: string } = {}): void {
  const dir = path.join(tree(), 'ccd');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ccd'), fs.readFileSync(CCD, 'utf8') + (o.ccd ?? ''), { mode: 0o755 });
  const tpl = fs.readFileSync(path.join(REPO, 'ccd', 'ccd-entry.py'), 'utf8');
  fs.writeFileSync(path.join(dir, 'ccd-entry.py'), o.template ? o.template(tpl) : tpl);
  fs.copyFileSync(path.join(REPO, 'ccd', 'ccd-entry-install.py'), path.join(dir, 'ccd-entry-install.py'));
}
const withHook = (t: string): string => {
  const at = "    if argv == [SELFTEST_ARGV]:\n";
  if (!t.includes(at)) throw new Error('the template has no self-test branch for the hook');
  return t.replace(at, `${at}${HOOK}\n`);
};

interface Ran { code: number; stdout: string; stderr: string }
const ran = (r: ReturnType<typeof spawnSync>): Ran =>
  ({ code: r.status ?? -1, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') });
const env = (pathPrefix = ''): NodeJS.ProcessEnv =>
  ({ HOME: home, PATH: `${pathPrefix}${process.env['PATH'] ?? '/usr/bin:/bin'}` });

/** The helper itself, under the canonical python3. */
const helper = (args: readonly string[], python = PYTHON): Ran =>
  ran(spawnSync(python, ['-IS', path.join(tree(), 'ccd', 'ccd-entry-install.py'), ...args],
    { encoding: 'utf8', cwd: home, env: env() }));

/** THE TWO LANES, each through its own shipped call site. */
const LANES: Record<string, (pathPrefix?: string) => Ran> = {
  // `_inst_ccd_pair`, sourced out of the repository's ccd/ccrc (its dispatch is
  // guarded by BASH_SOURCE, so sourcing runs nothing else) — its interpreter
  // resolution and its exit mapping included.
  'ccrc install/update': (pathPrefix = '') => ran(spawnSync('bash', ['-c', '. "$1"; _inst_ccd_pair "$2"', 'lane',
    path.join(REPO, 'ccd', 'ccrc'), tree()], { encoding: 'utf8', cwd: home,
    env: ghContainedEnv(home, env(pathPrefix), { systemd: true, tmux: true }) })),
  // `install_ccd_pair`'s body, with ssh replaced by a stub that runs the remote
  // command on THIS box with HOME = the fixture — the remote side's own
  // `python3`, `~/ccrc` and `$HOME`.
  'deploy.sh': (pathPrefix = '') => {
    const fn = /\ninstall_ccd_pair\(\) \{([\s\S]*?)\n\}/.exec(DEPLOY);
    if (!fn) throw new Error('deploy.sh has no install_ccd_pair()');
    const stub = path.join(home, 'stubbin');
    fs.mkdirSync(stub, { recursive: true });
    fs.writeFileSync(path.join(stub, 'fake-ssh'), '#!/bin/sh\nshift\nexec bash -c "$1"\n', { mode: 0o755 });
    return ran(spawnSync('bash', ['-c', `SSH=(fake-ssh); BOX=box; ${fn[1]}`],
      { encoding: 'utf8', cwd: home, env: ghContainedEnv(home, env(`${stub}:${pathPrefix}`), { systemd: true, tmux: true }) }));
  },
};

/** What a published pair must be, read from disk. */
function assertPair(): void {
  expect(fs.lstatSync(body()).isFile(), 'the body is a regular file, not a link').toBe(true);
  expect(fs.lstatSync(entry()).isFile(), 'the launcher is a regular file, not a link').toBe(true);
  expect(fs.statSync(body()).mode & 0o777).toBe(0o644);
  expect(fs.statSync(entry()).mode & 0o777).toBe(0o755);
  expect(fs.readFileSync(body()).equals(fs.readFileSync(path.join(tree(), 'ccd/ccd'))), 'the body is the tree\'s ccd').toBe(true);
  const text = fs.readFileSync(entry(), 'utf8');
  expect(text.split('\n')[0]).toBe(`#!${RENDERED} -IS`);
  expect(/^BODY_SHA256 = '([0-9a-f]{64})'$/m.exec(text)?.[1], 'the launcher names the published body').toBe(sha(body()));
  // The kernel starts it, and it accepts its body.
  const st = ran(spawnSync(entry(), ['--ccrc-entry-self-test'], { encoding: 'utf8', env: env() }));
  expect(st.stdout, st.stderr).toBe('ccd-entry-self-test 3 1 1 1 1\n');
}
function assertNoLeftovers(): void {
  const left = spawnSync('find', [path.join(home, '.local'), '(', '-name', '.ccd*', '-o', '-name', '__pycache__', '-o', '-name', '*.pyc', ')'],
    { encoding: 'utf8' }).stdout.trim();
  expect(left, 'a staging file, a self-test layout or bytecode was left behind').toBe('');
}
const ident = (p: string): string => { const s = fs.statSync(p); return `${s.ino}:${s.mtimeMs}`; };

describe('the pair, through both lanes: fresh, converged, and re-run after drift', () => {
  for (const [lane, run] of Object.entries(LANES)) {
    it(`${lane}: a fresh box gets the pair, body first; a second run rewrites nothing`, () => {
      plantTree();
      const r = run();
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout.indexOf('body published'), r.stdout).toBeGreaterThan(-1);
      expect(r.stdout.indexOf('body published'), 'body FIRST').toBeLessThan(r.stdout.indexOf('launcher published'));
      assertPair();
      assertNoLeftovers();
      const before = [ident(entry()), ident(body())];
      const again = run();
      expect(again.code, again.stderr).toBe(0);
      expect(again.stdout).toContain('converged');
      expect([ident(entry()), ident(body())], 'a converged re-run moved a file').toEqual(before);
    }, 60_000);
  }

  it('migration from the old self-contained Bash entry: the legacy file is replaced by the launcher, the body appears', () => {
    plantTree();
    fs.mkdirSync(path.dirname(entry()), { recursive: true });
    fs.copyFileSync(CCD, entry());
    fs.chmodSync(entry(), 0o755);
    expect(fs.existsSync(body())).toBe(false);
    const r = helper(['install', tree(), home]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/body published .*\(replaced: absent\)/);
    expect(r.stdout).toMatch(/launcher published .*\(replaced: file\)/);
    assertPair();
  }, 60_000);

  it('a body-only change republishes the body AND the launcher (which names its digest)', () => {
    plantTree();
    expect(helper(['install', tree(), home]).code).toBe(0);
    const oldDigest = sha(body());
    plantTree({ ccd: '\n# a new verb\n' });
    const r = helper(['install', tree(), home]);
    expect(r.code, r.stderr).toBe(0);
    expect(sha(body())).not.toBe(oldDigest);
    assertPair();
  }, 60_000);

  it('a launcher-only render change republishes the launcher and leaves the body’s inode alone', () => {
    plantTree();
    expect(helper(['install', tree(), home]).code).toBe(0);
    const bodyBefore = ident(body());
    plantTree({ template: (t) => `${t}\n# a launcher-only change\n` });
    const r = helper(['install', tree(), home]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toContain('body published');
    expect(r.stdout).toContain('launcher published');
    expect(ident(body()), 'the body was rewritten for a launcher-only change').toBe(bodyBefore);
    assertPair();
  }, 60_000);

  it('a missing body, or a body that no longer matches its launcher’s digest, refuses every start — and a re-run converges', () => {
    plantTree();
    expect(helper(['install', tree(), home]).code).toBe(0);
    for (const [name, spoil, cls] of [
      ['missing', () => fs.rmSync(body()), 'body-absent'],
      ['changed out of band', () => fs.appendFileSync(body(), '\n# edited on the box\n'), 'body-digest'],
    ] as const) {
      spoil();
      const st = ran(spawnSync(entry(), ['--ccrc-entry-self-test'], { encoding: 'utf8', env: env() }));
      expect(st.code, name).toBe(125);
      expect(st.stderr, name).toContain(`ccd: refused (entry-${cls}):`);
      const launcherBefore = ident(entry());
      const r = helper(['install', tree(), home]);
      expect(r.code, `${name}: ${r.stderr}`).toBe(0);
      expect(ident(entry()), `${name}: the launcher was rewritten though its bytes were right`).toBe(launcherBefore);
      assertPair();
    }
  }, 60_000);
});

describe('destinations are inspected without following them — in both lanes, for both halves', () => {
  type Kind = 'link-to-file' | 'dangling-link' | 'link-to-dir' | 'dir';
  const KINDS: readonly Kind[] = ['link-to-file', 'dangling-link', 'link-to-dir', 'dir'];
  const replaces = (k: Kind): boolean => k === 'link-to-file' || k === 'dangling-link';

  for (const [lane, run] of Object.entries(LANES)) {
    for (const half of ['launcher', 'body'] as const) {
      for (const kind of KINDS) {
        it(`${lane}: the ${half}'s destination is a ${kind} → ${replaces(kind) ? 'the entry itself is replaced, its target untouched' : 'refused, nothing moved, nothing moved into it'}`, () => {
          // A converged v1 pair, then a v2 tree, so BOTH halves need publishing.
          plantTree();
          expect(helper(['install', tree(), home]).code).toBe(0);
          const v1 = { entry: fs.readFileSync(entry()), body: fs.readFileSync(body()) };
          plantTree({ ccd: '\n# v2\n' });
          const dest = half === 'launcher' ? entry() : body();
          const other = half === 'launcher' ? body() : entry();
          fs.rmSync(dest);
          const target = path.join(home, 'elsewhere', 'target');
          fs.mkdirSync(path.dirname(target), { recursive: true });
          if (kind === 'link-to-file') { fs.writeFileSync(target, 'TARGET\n'); fs.symlinkSync(target, dest); }
          if (kind === 'dangling-link') fs.symlinkSync(path.join(home, 'nowhere', 'missing'), dest);
          if (kind === 'link-to-dir') { fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'kept'), 'k\n'); fs.symlinkSync(target, dest); }
          if (kind === 'dir') { fs.mkdirSync(dest); fs.writeFileSync(path.join(dest, 'kept'), 'k\n'); }
          const r = run();
          if (replaces(kind)) {
            expect(r.code, r.stderr).toBe(0);
            assertPair();
            if (kind === 'link-to-file') expect(fs.readFileSync(target, 'utf8'), 'the link\'s target was written through').toBe('TARGET\n');
            if (kind === 'dangling-link') expect(fs.existsSync(path.join(home, 'nowhere')), 'the dangling target was created').toBe(false);
          } else {
            expect(r.code, `${r.stdout}${r.stderr}`).not.toBe(0);
            expect(r.stderr).toMatch(kind === 'dir' ? /is a directory/ : /is a link to a directory/);
            const inside = kind === 'dir' ? dest : target;
            expect(fs.readdirSync(inside), 'something was moved into the directory').toEqual(['kept']);
            expect(fs.readFileSync(other).equals(half === 'launcher' ? v1.body : v1.entry), 'the other half moved').toBe(true);
            assertNoLeftovers();
          }
        }, 60_000);
      }
    }
  }
});

describe('the pre-publication kernel self-test, and the order of publication, proved by an executable hook', () => {
  it('the self-test runs before EITHER live file moves: the hook sees the old pair', () => {
    plantTree();
    expect(helper(['install', tree(), home]).code).toBe(0);
    const old = `${sha(entry())} ${sha(body())}\n`;
    plantTree({ template: withHook, ccd: '\n# v2\n' });
    fs.writeFileSync(path.join(home, 'hook-record'), '');
    const r = helper(['install', tree(), home]);
    expect(r.code, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(home, 'selftest-saw'), 'utf8'), 'the live pair had moved before the self-test ran').toBe(old);
    assertPair();
  }, 60_000);

  it('a body that cannot be published moves NOTHING — the launcher is never published ahead of its body', () => {
    plantTree();
    expect(helper(['install', tree(), home]).code).toBe(0);
    const launcherBefore = fs.readFileSync(entry());
    plantTree({ template: withHook, ccd: '\n# v2\n' });
    fs.writeFileSync(path.join(home, 'hook-obstruct-body'), '');
    const r = helper(['install', tree(), home]);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain('is a directory');
    expect(fs.readFileSync(entry()).equals(launcherBefore), 'the launcher moved ahead of a body that never landed').toBe(true);
    assertNoLeftovers();
  }, 60_000);

  it('a launcher that cannot be published after its body did is exit 2 — a pair that refuses by digest — and a re-run converges', () => {
    plantTree();
    expect(helper(['install', tree(), home]).code).toBe(0);
    plantTree({ template: withHook, ccd: '\n# v2\n' });
    fs.writeFileSync(path.join(home, 'hook-obstruct-entry'), '');
    const r = helper(['install', tree(), home]);
    expect(r.code, r.stderr).toBe(2);
    expect(r.stdout).toContain('body published');
    expect(r.stderr).toContain('refused after the body moved');
    expect(fs.readFileSync(body()).equals(fs.readFileSync(path.join(tree(), 'ccd/ccd'))), 'the body is the new one').toBe(true);
    expect(fs.lstatSync(entry()).isDirectory(), 'the obstruction stands').toBe(true);
    // Both lanes say the same thing about it.
    expect(LANES['ccrc install/update']!().stderr).toMatch(/is a directory/);
    // Retry convergence: the obstruction gone, the next run publishes the launcher.
    fs.rmSync(path.join(home, 'hook-obstruct-entry'));
    fs.rmSync(entry(), { recursive: true });
    const again = helper(['install', tree(), home]);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).not.toContain('body published');
    assertPair();
    assertNoLeftovers();
  }, 60_000);

  it('a staged launcher whose kernel self-test fails publishes nothing and leaves nothing behind', () => {
    plantTree();
    expect(helper(['install', tree(), home]).code).toBe(0);
    const before = [fs.readFileSync(entry()), fs.readFileSync(body())];
    plantTree({ template: (t) => t.replace("        sys.stdout.write('ccd-entry-self-test %d %d %d %d %d\\n'",
      "        sys.stdout.write('ccd-entry-self-test-BROKEN %d %d %d %d %d\\n'"), ccd: '\n# v2\n' });
    expect(fs.readFileSync(path.join(tree(), 'ccd', 'ccd-entry.py'), 'utf8')).toContain('self-test-BROKEN');
    for (const [lane, run] of [['helper', () => helper(['install', tree(), home])], ...Object.entries(LANES)] as const) {
      const r = run();
      expect(r.code, lane).not.toBe(0);
      expect(r.stderr, lane).toContain('kernel self-test');
      expect([fs.readFileSync(entry()), fs.readFileSync(body())].every((b, i) => b.equals(before[i]!)), `${lane}: a file moved`).toBe(true);
      assertNoLeftovers();
    }
  }, 60_000);
});

describe('the interpreter must be able to be a shebang — refused before anything moves', () => {
  for (const [name, dirName, why] of [
    ['whitespace in its path', 'py dir', /contains whitespace or a line break/],
    ['a shebang longer than every supported kernel reads', `p${'y'.repeat(140)}`, /over the 127 every supported kernel reads/],
  ] as const) {
    it(`${name}: the helper, the ccrc lane and the deploy lane all refuse with the old pair untouched`, () => {
      plantTree();
      expect(helper(['install', tree(), home]).code).toBe(0);
      const before = [ident(entry()), ident(body())];
      plantTree({ ccd: '\n# v2\n' });
      const venv = path.join(home, dirName, 'v');
      const mk = spawnSync(PYTHON, ['-m', 'venv', '--copies', '--without-pip', venv], { encoding: 'utf8' });
      expect(mk.status, mk.stderr).toBe(0);
      const vpy = path.join(venv, 'bin', 'python3');
      expect(helper(['check'], vpy).stderr).toMatch(why);
      const r = helper(['install', tree(), home], vpy);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(why);
      for (const [lane, run] of Object.entries(LANES)) {
        const l = run(`${path.join(venv, 'bin')}:`);
        expect(l.code, `${lane}: ${l.stdout}`).not.toBe(0);
        expect(l.stderr, lane).toMatch(why);
      }
      expect([ident(entry()), ident(body())], 'a file moved').toEqual(before);
      assertNoLeftovers();
    }, 120_000);
  }

  it('the template\'s placeholder census: a missing, a duplicated or a residual placeholder refuses before anything moves', () => {
    plantTree();
    expect(helper(['install', tree(), home]).code).toBe(0);
    const before = [ident(entry()), ident(body())];
    for (const [name, edit, msg] of [
      ['missing digest placeholder', (t: string) => t.replace("'@CCRC_CCD_SHA256@'", "'0'"), /carries 0 copies of @CCRC_CCD_SHA256@/],
      ['duplicated python placeholder', (t: string) => `${t}\n# @CCRC_PYTHON3@\n`, /carries 2 copies of @CCRC_PYTHON3@/],
      ['a residual placeholder', (t: string) => `${t}\n# @CCRC_SOMETHING_ELSE@\n`, /still carries a placeholder/],
    ] as const) {
      plantTree({ template: edit, ccd: '\n# v2\n' });
      const r = helper(['install', tree(), home]);
      expect(r.code, name).toBe(1);
      expect(r.stderr, name).toMatch(msg);
      expect([ident(entry()), ident(body())], `${name}: a file moved`).toEqual(before);
    }
  }, 60_000);
});

describe('the fix pass of the final review: layouts, mode repair, postcondition, the interpreter path', () => {
  it('a symlinked ~/.local, or ~/.local/bin, gets a pair whose launcher finds its body when started by its installed path (D-3699)', () => {
    for (const linked of ['.local', '.local/bin']) {
      fs.rmSync(path.join(home, '.local'), { recursive: true, force: true });
      const real = path.join(home, `real-${linked.replace('/', '-')}`);
      fs.rmSync(real, { recursive: true, force: true });
      fs.mkdirSync(real, { recursive: true });
      if (linked === '.local') fs.symlinkSync(real, path.join(home, '.local'));
      else { fs.mkdirSync(path.join(home, '.local'), { recursive: true }); fs.symlinkSync(real, path.join(home, '.local', 'bin')); }
      plantTree();
      const r = helper(['install', tree(), home]);
      expect(r.code, `${linked}: ${r.stderr}`).toBe(0);
      assertPair();
    }
  }, 60_000);

  it('a ~/.local/bin that resolves to ANOTHER .local/bin — where the launcher would look for a different body — is refused before anything moves (D-3699)', () => {
    const other = path.join(home, 'elsewhere', '.local', 'bin');
    fs.mkdirSync(other, { recursive: true });
    fs.mkdirSync(path.join(home, '.local'), { recursive: true });
    fs.symlinkSync(other, path.join(home, '.local', 'bin'));
    plantTree();
    const r = helper(['install', tree(), home]);
    expect(r.code, r.stdout).toBe(1);
    expect(r.stderr).toContain('would look for its body at');
    expect(fs.existsSync(body()), 'the body was published for a launcher that could not find it').toBe(false);
    expect(fs.readdirSync(other), 'the launcher was published').toEqual([]);
  }, 60_000);

  it('a half whose bytes are right and whose MODE is not is repaired in place — same inode, same mtime — and reported', () => {
    plantTree();
    expect(helper(['install', tree(), home]).code).toBe(0);
    for (const [p, want] of [[entry(), 0o755], [body(), 0o644]] as const) {
      fs.chmodSync(p, 0o600);
      const before = ident(p);
      const r = helper(['install', tree(), home]);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain(`${p}: mode repaired to ${want.toString(8)}`);
      expect(fs.statSync(p).mode & 0o777).toBe(want);
      expect(ident(p), 'the file was rewritten to repair a mode').toBe(before);
    }
    assertPair();
  }, 60_000);

  it('a rename that does not land the staged bytes is caught at the exact destination: exit 2, named — the postcondition, not a hope', () => {
    // The publisher's own `install`, run in-process with `os.replace`
    // replaced by one that renames and then tampers with what landed — the
    // one way to make a publication land wrong without a race.
    for (const which of ['body', 'launcher'] as const) {
      fs.rmSync(path.join(home, '.local'), { recursive: true, force: true });
      plantTree();
      const suffix = which === 'body' ? '/libexec/ccrc/ccd' : '/bin/ccd';
      const driver = [
        'import importlib.util, os, sys',
        `spec = importlib.util.spec_from_file_location("cei", ${JSON.stringify(path.join(tree(), 'ccd', 'ccd-entry-install.py'))})`,
        'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
        'real = os.replace',
        'def landed_wrong(src, dst):',
        '    real(src, dst)',
        `    if dst.endswith(${JSON.stringify(suffix)}):`,
        '        open(dst, "ab").write(b"# tampered\\n")',
        'm.os.replace = landed_wrong',
        `sys.exit(m.main(["install", ${JSON.stringify(tree())}, ${JSON.stringify(home)}]))`,
      ].join('\n');
      const r = ran(spawnSync(PYTHON, ['-IS', '-c', driver], { encoding: 'utf8', cwd: home, env: env() }));
      expect(r.code, `${which}: ${r.stdout}${r.stderr}`).toBe(2);
      expect(r.stderr).toContain(`after publishing the ${which},`);
      expect(r.stderr).toContain('is not the regular file of mode');
    }
  }, 60_000);

  it('the shebang names the PATH-selected python3 when it is the very interpreter probed, else the canonical one (D-3698)', () => {
    // A python3 on PATH that is a LINK to the real interpreter: rendered as the
    // link, which an upgrade repoints. A python3 on PATH that is a SCRIPT shim:
    // not the interpreter that answered, so the canonical path is rendered.
    for (const [shape, plant, want] of [
      ['a link to the interpreter', (d: string) => fs.symlinkSync(PYTHON, path.join(d, 'python3')), (d: string) => path.join(d, 'python3')],
      ['a shim script', (d: string) => fs.writeFileSync(path.join(d, 'python3'), `#!/bin/sh\nexec '${PYTHON}' "$@"\n`, { mode: 0o755 }), () => PYTHON],
    ] as const) {
      fs.rmSync(path.join(home, '.local'), { recursive: true, force: true });
      const d = path.join(home, `pydir-${shape.replace(/\s+/g, '-')}`);
      fs.rmSync(d, { recursive: true, force: true });
      fs.mkdirSync(d, { recursive: true });
      plant(d);
      plantTree();
      const r = LANES['deploy.sh']!(`${d}:`);
      expect(r.code, `${shape}: ${r.stderr}`).toBe(0);
      expect(fs.readFileSync(entry(), 'utf8').split('\n')[0], shape).toBe(`#!${want(d)} -IS`);
      const st = ran(spawnSync(entry(), ['--ccrc-entry-self-test'], { encoding: 'utf8', env: env() }));
      expect(st.stdout, `${shape}: ${st.stderr}`).toBe('ccd-entry-self-test 3 1 1 1 1\n');
    }
  }, 60_000);
});
