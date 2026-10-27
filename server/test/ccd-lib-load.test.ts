// D-6913 (GitHub #1279): ccd/ccd loads the fleet disk-retention code from ccd/lib/disk-retention.sh.
//
// The file is shell that ccd EVALUATES, so the load is a trust boundary. These tests pin what it promises:
//   1. the committed ccd carries only the pin's fixed placeholder (the installer renders the digest, as it stamps line 2),
//      and the file is in the one shape the load hashes (one trailing newline, no NUL);
//   2. a faithful copy loads, and the moved verbs and helpers exist once it has; ccd/ccd itself no longer defines them;
//   3. a changed, missing or linked file refuses the start (`ccd: refused (lib-…)`, status 125) and NOTHING of it runs,
//      sourced or executed, and through the installed direct entry;
//   4. the file is found from ccd's own location only: no environment variable and no directory under HOME names it.
// FIXTURE HOMEs only; a copy of the two files stands in a temp directory, never the shipped ones.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, CCD_LIB_PIN_PLACEHOLDER, ghContainedEnv, installDirectEntry, installedCcdBody, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { markGenerated } from '../../shared/mark.mjs';

const REPO = path.resolve(__dirname, '..', '..');
const LIB = path.join(REPO, 'ccd', 'lib', 'disk-retention.sh');
/** What the moved code defines, one name per region: the orphan verb, the nested rescue, the stale arm, the loose arm. */
const MOVED = ['cmd_ws_orphan', '_ws_nested_rescue', '_ws_stale_argv', '_ws_loose_collect', 'cmd_scratch_rescue'] as const;

let h: CcdHarness;
let dir: string;
beforeEach(() => { h = makeCcdHarness('ccrc-lib-load-'); dir = path.join(h.home, 'tree'); });
afterEach(() => { h.cleanup(); });

/** A copy of ccd and its library at `<home>/tree/{ccd,lib/disk-retention.sh}`, the library through `mutate`
 *  (`null` leaves it out). The body is the INSTALLED form by default (its pin rendered to the shipped library, then stamped,
 *  as ccd-entry-install.py publishes it), so `mutate` is a library changed after install; `body: 'source'` plants the
 *  committed file as it stands, both placeholders in place, and a function plants what it returns. */
function plant(mutate: ((t: string) => string | null) = (t) => t, body: 'installed' | 'source' | ((src: string) => string) = 'installed'): string {
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  const ccd = path.join(dir, 'ccd');
  const src = fs.readFileSync(CCD, 'utf8');
  fs.writeFileSync(ccd, body === 'source' ? src : body === 'installed' ? installedCcdBody(src, fs.readFileSync(LIB)) : body(src), { mode: 0o755 });
  const lib = mutate(fs.readFileSync(LIB, 'utf8'));
  if (lib !== null) fs.writeFileSync(path.join(dir, 'lib', 'disk-retention.sh'), lib);
  return ccd;
}
const MARK = (): string => path.join(h.home, 'lib-ran');
const RAN = 'echo ran > "$HOME/lib-ran"\n';
/** Source `ccd` and say what came of it: the status of the source, then which moved names exist. */
/** A driver script written to `<home>/<name>` and run as `bash <file> <ccd>`: no `-c` string, so no path of this run is
 *  ever spliced into shell text; `ccd` reaches the script only as `$1`. */
function driver(name: string, body: string): string {
  const file = path.join(h.home, name);
  fs.writeFileSync(file, `${body}\n`, { mode: 0o644 });
  return file;
}
const SOURCED = `source "$1"; rc=$?; echo "rc=$rc"; for f in ${MOVED.join(' ')}; do declare -F "$f" >/dev/null && echo "has $f"; done`;
function sourced(ccd: string, extra: NodeJS.ProcessEnv = {}): { out: string; err: string } {
  const r = spawnSync('bash', [driver('sourced.sh', SOURCED), ccd],
    { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, h.env(extra), { systemd: true, tmux: true, net: true }) });
  return { out: r.stdout, err: r.stderr };
}

describe('the library and the pin', () => {
  it('the committed ccd carries the pin placeholder, never a digest; the library ends in one newline and holds no NUL', () => {
    // The pin gets the install-time treatment line 2 got (#1525): a committed digest would change, and conflict, in every
    // PR that touches the library. ccd-entry-install.py renders it into the installed body.
    const bytes = fs.readFileSync(LIB);
    const ccdText = fs.readFileSync(CCD, 'utf8');
    expect(ccdText.match(/^__CCD_LIB_SHA256=.*$/gm), 'ccd/ccd carries exactly one pin line, the placeholder').toEqual([CCD_LIB_PIN_PLACEHOLDER]);
    expect(/[0-9a-f]{64}/.test(ccdText.match(/^__CCD_LIB_SHA256=.*$/m)?.[0] ?? ''), 'no committed digest').toBe(false);
    expect(createHash('sha256').update(bytes).digest('hex')).toMatch(/^[0-9a-f]{64}$/);
    const text = bytes.toString('utf8');
    expect(text.endsWith('\n') && !text.endsWith('\n\n'), 'exactly one trailing newline').toBe(true);
    expect(bytes.includes(0), 'no NUL byte: `$(<file)` would drop it and the digest would disagree').toBe(false);
  });

  it('the moved code is in the library and no longer in ccd/ccd', () => {
    const ccd = fs.readFileSync(CCD, 'utf8');
    const lib = fs.readFileSync(LIB, 'utf8');
    for (const f of MOVED) {
      expect(new RegExp(`^${f}\\(\\) \\{`, 'm').test(lib), `${f} is defined in the library`).toBe(true);
      expect(new RegExp(`^${f}\\(\\) \\{`, 'm').test(ccd), `${f} is not defined in ccd/ccd`).toBe(false);
    }
    expect(ccd).not.toContain('LOOSE-BEGIN');
    expect(lib).toContain('LOOSE-BEGIN');
    expect(lib).toContain('LOOSE-END');
  });
});

describe('a test that scans ccd reads all of it', () => {
  // `ccdSource()` puts the moved regions back where they sat; a bare read of `CCD` as text sees ccd without them, and a scanner
  // built on it passes over less than it did. These files read the FILE, not the program, on purpose.
  const FILE_READERS = new Set(['ccd-lib-load.test.ts', 'ccd-entry-install.test.ts', 'ownership.test.ts', 'ccrc-restamp.test.ts', 'ccd-install-stamp.test.ts', 'ccdWsHelpers.ts']);

  it('no test file reads CCD as text outside the ones about the file itself', () => {
    const dir = path.join(REPO, 'server', 'test');
    const bare = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !FILE_READERS.has(f))
      .filter((f) => /\breadFileSync\(\s*CCD\s*,\s*['"]utf-?8['"]\s*\)/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(bare, 'read ccd through ccdSource() (ccdWsHelpers.ts), which includes the library').toEqual([]);
  });
});

describe('a faithful copy loads', () => {
  it('sourcing defines every moved name and returns 0', () => {
    const r = sourced(plant());
    expect(r.err).toBe('');
    expect(r.out).toContain('rc=0');
    for (const f of MOVED) expect(r.out, f).toContain(`has ${f}`);
  });
});

describe('installed or source checkout: only a body with BOTH placeholders skips the check', () => {
  it('a source checkout (line 2 and the pin both placeholders) loads a changed library without a check: nothing was installed', () => {
    const r = sourced(plant((t) => t + RAN, 'source'));
    expect(r.err).toBe('');
    expect(r.out).toContain('rc=0');
    for (const f of MOVED) expect(r.out, f).toContain(`has ${f}`);
    expect(fs.existsSync(MARK()), 'the library was evaluated').toBe(true);
  });

  it('a source checkout still refuses a missing library (lib-missing)', () => {
    const r = sourced(plant(() => null, 'source'));
    expect(r.err).toContain('ccd: refused (lib-missing)');
    expect(r.out).toContain('rc=125');
  });

  it('a real stamp on line 2 with the pin still a placeholder is a broken install: it refuses with lib-digest, nothing evaluated', () => {
    const stampedOnly = (src: string): string => {
      const lines = src.split('\n');
      lines.splice(1, 1);
      return markGenerated(lines.join('\n'));
    };
    const ccd = plant((t) => t, stampedOnly);
    expect(fs.readFileSync(ccd, 'utf8')).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/m);
    expect(fs.readFileSync(ccd, 'utf8')).toContain(`\n${CCD_LIB_PIN_PLACEHOLDER}\n`);
    const r = sourced(ccd);
    expect(r.err).toContain('ccd: refused (lib-digest)');
    expect(r.out).toContain('rc=125');
    expect(r.out).not.toContain('has ');
    const x = spawnSync('bash', [ccd, 'version'], { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, h.env(), { systemd: true, tmux: true, net: true }) });
    expect(x.status).toBe(125);
    expect(x.stderr).toContain('ccd: refused (lib-digest)');
  });

  it('a real pin with line 2 still the placeholder is not a source checkout: the digest is checked', () => {
    const pinnedOnly = (src: string): string =>
      src.replace(CCD_LIB_PIN_PLACEHOLDER, `__CCD_LIB_SHA256=${createHash('sha256').update(fs.readFileSync(LIB)).digest('hex')}`);
    expect(sourced(plant((t) => t, pinnedOnly)).out).toContain('rc=0');
    const r = sourced(plant((t) => t + RAN, pinnedOnly));
    expect(r.err).toContain('ccd: refused (lib-digest)');
    expect(r.out).toContain('rc=125');
    expect(fs.existsSync(MARK())).toBe(false);
  });
});

describe('the load needs no temp file', () => {
  // A here-string larger than a pipe buffer is backed by a temp file; on a full temp filesystem it fails and every verb,
  // the retention verbs that free space included, would exit 125. The loader hashes through a pipe.
  it('_ccd_lib_load holds no here-string or here-document', () => {
    const ccd = fs.readFileSync(CCD, 'utf8');
    const start = ccd.indexOf('\n_ccd_lib_load() {');
    const end = ccd.indexOf('\n_ccd_lib_load ||', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = ccd.slice(start, end).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(/<<</.test(body) || /<<-?\s*['"]?\w/.test(body), 'no << or <<< in the loader').toBe(false);
  });

  it('an unusable TMPDIR does not refuse the start', () => {
    const ccd = plant();
    const r = spawnSync('bash', [ccd, 'version'], { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, h.env({ TMPDIR: path.join(h.home, 'no-such-dir') }), { systemd: true, tmux: true, net: true }) });
    expect(r.stderr).not.toContain('ccd: refused');
    expect(r.status).not.toBe(125);
  });

  /** A PATH holding only `bash` and `mkdir` (symlinks to this box's real binaries): no hashing tool on it at all. */
  function strippedPath(): NodeJS.ProcessEnv {
    const bin = path.join(h.home, 'no-hash-bin');
    fs.mkdirSync(bin, { recursive: true });
    for (const name of ['bash', 'mkdir']) {
      const real = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
      if (!fs.existsSync(path.join(bin, name))) fs.symlinkSync(real, path.join(bin, name));
    }
    return { ...ghContainedEnv(h.home, h.env(), { systemd: true, tmux: true, net: true }), PATH: bin, XDG_RUNTIME_DIR: '/tmp' };
  }
  function sourcedStripped(ccd: string): { out: string; err: string } {
    const r = spawnSync('bash', [driver('sourced-stripped.sh', 'source "$1"; rc=$?; echo "rc=$rc"; declare -F cmd_ws_orphan >/dev/null && echo has'), ccd],
      { encoding: 'utf8', cwd: h.home, env: strippedPath() });
    return { out: r.stdout, err: r.stderr };
  }

  it('no hashing tool on PATH, one at a standard location: the digest is still checked and the load succeeds', () => {
    const r = sourcedStripped(plant());
    expect.soft(r.err).toBe('');
    expect.soft(r.out).toContain('rc=0');
    expect.soft(r.out).toContain('has');
  });

  it('no hashing tool on PATH and a tampered library: it refuses with lib-digest, nothing evaluated', () => {
    const r = sourcedStripped(plant((t) => t + RAN));
    expect(r.err).toContain('ccd: refused (lib-digest)');
    expect(r.out).toContain('rc=125');
    expect(r.out).not.toContain('has');
    expect(fs.existsSync(MARK())).toBe(false);
  });

  it('no hashing tool anywhere: it refuses with lib-hash in one quiet line, nothing evaluated', () => {
    // A fake root without one: the planted ccd's fixed list of standard locations points only at paths that do not exist.
    const ccd = plant();
    const text = fs.readFileSync(ccd, 'utf8');
    const list = /^__CCD_HASH_TOOLS=\(.*\)$/m;
    expect(list.test(text), 'ccd names its standard hashing-tool locations in one line').toBe(true);
    fs.writeFileSync(ccd, text.replace(list, `__CCD_HASH_TOOLS=(${path.join(h.home, 'no-root')}/usr/bin/sha256sum ${path.join(h.home, 'no-root')}/usr/bin/shasum)`));
    const r = sourcedStripped(ccd);
    expect(r.err.trim().split('\n')).toHaveLength(1);
    expect(r.err).toContain('ccd: refused (lib-hash)');
    expect(r.out).toContain('rc=125');
    expect(r.out).not.toContain('has');
  });
});

describe('a library that is not the pinned one refuses the start and runs nothing', () => {
  const refusals: Array<[string, (t: string) => string | null, string]> = [
    ['one appended line', (t) => t + RAN, 'lib-digest'],
    ['one byte changed', (t) => t.replace('ws-orphan', 'ws-orphaN'), 'lib-digest'],
    ['an empty file', () => '', 'lib-digest'],
    ['no file at all', () => null, 'lib-missing'],
  ];
  for (const [name, mutate, word] of refusals) {
    it(`${name}: sourced, status 125 with the ${word} line, no moved name defined, nothing evaluated`, () => {
      const r = sourced(plant(mutate));
      expect(r.err).toContain(`ccd: refused (${word})`);
      expect(r.out).toContain('rc=125');
      expect(r.out).not.toContain('has ');
      expect(fs.existsSync(MARK())).toBe(false);
    });
    it(`${name}: executed, exit 125 for a verb that never touches the moved code`, () => {
      const ccd = plant(mutate);
      const r = spawnSync('bash', [ccd, 'version'], { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, h.env(), { systemd: true, tmux: true, net: true }) });
      expect(r.status).toBe(125);
      expect(r.stderr).toContain(`ccd: refused (${word})`);
      expect(r.stdout).toBe('');
    });
  }

  it('a symbolic link in the library\'s place is refused, even to the right bytes', () => {
    const ccd = plant(() => null);
    const real = path.join(h.home, 'elsewhere.sh');
    fs.copyFileSync(LIB, real);
    fs.symlinkSync(real, path.join(dir, 'lib', 'disk-retention.sh'));
    const r = sourced(ccd);
    expect(r.err).toContain('ccd: refused (lib-missing)');
    expect(r.out).toContain('rc=125');
  });

  it('through the installed direct entry: a tampered library refuses a protected verb before it runs, status 125', () => {
    const e = installDirectEntry(h.home);
    fs.appendFileSync(path.join(path.dirname(e.body), 'lib', 'disk-retention.sh'), RAN);
    const r = spawnSync(e.entry, ['ws-orphan', '--expect', 'x'], { encoding: 'utf8', cwd: h.home, env: h.env() });
    expect(r.status).toBe(125);
    expect(r.stderr).toContain('ccd: refused (lib-digest)');
    expect(fs.existsSync(MARK())).toBe(false);
  });

  it('through the installed direct entry: the shipped pair starts and runs a moved verb', () => {
    const e = installDirectEntry(h.home);
    const r = spawnSync(e.entry, ['ws-orphan'], { encoding: 'utf8', cwd: h.home, env: h.env() });
    expect(r.stderr).not.toContain('refused (lib-');
    expect(r.status, r.stderr).not.toBe(125);
  });
});

describe('the bytes checked are the bytes run', () => {
  it('a library rewritten AFTER the digest was taken is not what runs: the load reads the file once', () => {
    const ccd = plant();
    const libFile = path.join(dir, 'lib', 'disk-retention.sh');
    // A hashing tool that answers truthfully for what it was given and then appends a line to the library on disk.
    const fake = path.join(h.home, 'fakebin');
    fs.mkdirSync(fake, { recursive: true });
    // Each fake runs the real tool of its OWN name: on a Linux host with perl's /usr/bin/shasum, a fake sha256sum that ran
    // `shasum` without `-a 256` would hash with SHA-1 and the load would refuse for the wrong reason.
    let made = 0;
    for (const n of ['shasum', 'sha256sum']) {
      const real = spawnSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
      if (!real) continue;
      const script = `#!/bin/sh\nt=$(mktemp); cat >"$t"; printf '%s\\n' 'echo ran > "$HOME/lib-ran"' >> "$FAKE_LIB"\n${real} "$@" <"$t"; rc=$?; rm -f "$t"; exit $rc\n`;
      fs.writeFileSync(path.join(fake, n), script, { mode: 0o755 });
      made += 1;
    }
    expect(made, 'a real hashing tool on this host').toBeGreaterThan(0);
    const r = sourced(ccd, { PATH: `${fake}:${process.env['PATH'] ?? ''}`, FAKE_LIB: libFile });
    expect(r.out).toContain('rc=0');
    expect(fs.readFileSync(libFile, 'utf8'), 'the fake tool did rewrite the file').toContain('lib-ran');
    expect(fs.existsSync(MARK()), 'the appended line ran: the load evaluated a second read').toBe(false);
  });
});

describe('the library is found from ccd\'s own location and nowhere else', () => {
  it('no environment variable and no directory under HOME names it', () => {
    const ccd = plant(() => null);
    const evil = path.join(h.home, 'evil.sh');
    fs.writeFileSync(evil, RAN);
    for (const sub of ['lib', '.local/libexec/ccrc/lib', '.cc-sessions/lib', 'ccrc/ccd/lib']) {
      fs.mkdirSync(path.join(h.home, sub), { recursive: true });
      fs.writeFileSync(path.join(h.home, sub, 'disk-retention.sh'), RAN);
    }
    const r = sourced(ccd, { CCD_LIB: evil, CCD_LIB_DIR: h.home, CCRC_LIB: evil, CCD_LIB_PATH: evil });
    expect(r.err).toContain('ccd: refused (lib-missing)');
    expect(fs.existsSync(MARK())).toBe(false);
  });
});
