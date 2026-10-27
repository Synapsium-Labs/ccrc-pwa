// `ccrc doctor`'s `node-path` check and its `--fix` (spec 2026-10-26-node-runtime-under-nvm, task 3).
//
// NO healthy() HERE, deliberately: the shared doctor fixture links a real jq, and these arms need no jq. This file
// sources the shipped checks file straight into bash and calls `_check_node-path` / `_fix_node-path` over a fixture
// HOME (the one isolation boundary): a stub `systemctl` that answers `show-environment` from a file, a PATH made of
// fixture directories only (no real systemctl, no real node), and the REAL `ccd/ccrc-node` library beside a fixture
// package.json. Each FAIL arm is its own case, and each case goes red when its arm is deleted (measured; see the report).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CHECKS = join(REPO, 'ccd', 'ccrc-doctor-checks');
const LIB = join(REPO, 'ccd', 'ccrc-node');
const bashPath = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

const FLOOR = '22.16.0';
const dirOf = (home: string): string => join(home, '.local', 'libexec', 'ccrc', 'node-bin');
const fragOf = (home: string): string => join(home, '.config', 'environment.d', '50-ccrc-node.conf');

function nodeBin(home: string, name: string, version: string): string {
  const d = join(home, 'nodes', name, 'bin');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'node'), `#!/bin/sh\n[ "$1" = --version ] && echo ${version}\n`, { mode: 0o755 });
  writeFileSync(join(d, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(d, 'npx'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return d;
}

/** A box `_node_publish` has run on: three links to a v22.20.0 node, the fragment, a manager whose PATH has the dir. */
function box(prefix: string): string {
  const home = mkTmp(prefix);
  const sb = join(home, 'stub-bin');
  mkdirSync(sb, { recursive: true });
  for (const t of ['readlink', 'mkdir', 'ln', 'mv', 'rm', 'chmod', 'id', 'uname', 'dirname', 'cat']) {
    const p = spawnSync('bash', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
    if (p !== '') symlinkSync(p, join(sb, t));
  }
  // `ccd/` of a shipped tree: the library beside a package.json one level up (the `_dr_pkg_candidates` shape).
  mkdirSync(join(home, 'ccrc', 'ccd'), { recursive: true });
  symlinkSync(LIB, join(home, 'ccrc', 'ccd', 'ccrc-node'));
  mkdirSync(join(home, 'ccrc', 'server'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'server', 'package.json'), JSON.stringify({ engines: { node: `>=${FLOOR}` } }));
  const bin = nodeBin(home, 'v22.20.0', 'v22.20.0');
  const dir = dirOf(home);
  mkdirSync(dir, { recursive: true });
  for (const b of ['node', 'npm', 'npx']) symlinkSync(join(bin, b), join(dir, b));
  mkdirSync(join(home, '.config', 'environment.d'), { recursive: true });
  writeFileSync(fragOf(home), `# Written by ccrc\nPATH=${dir}:\${PATH}\n`);
  // systemctl: `show-environment` answers from a file (absent file = no user manager); `daemon-reload` is recorded.
  writeFileSync(join(sb, 'systemctl'),
    '#!/bin/sh\n'
    + 'case "$2" in\n'
    + '  show-environment) [ -f "$HOME/fixture-mgr-env" ] || exit 1; while IFS= read -r l; do echo "$l"; done < "$HOME/fixture-mgr-env"; exit 0 ;;\n'
    + '  daemon-reload) echo reload >> "$HOME/reloads"; exit 0 ;;\n'
    + 'esac\nexit 90\n', { mode: 0o755 });
  writeFileSync(join(home, 'fixture-mgr-env'), `HOME=${home}\nPATH=${dir}:/usr/bin\n`);
  return home;
}

function run(home: string, fn: string, env: Record<string, string> = {}, extraPath = ''): { rc: number; out: string } {
  const r = spawnSync(bashPath, ['-c', `set -uo pipefail; . '${CHECKS}'; ${fn}; echo "rc=$?"`], {
    encoding: 'utf8',
    env: {
      HOME: home, PATH: `${extraPath}${extraPath ? ':' : ''}${join(home, 'stub-bin')}`, LC_ALL: 'C',
      CCRC_HERE: join(home, 'ccrc', 'ccd'), XDG_RUNTIME_DIR: join(home, 'run'), ...env,
    },
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const m = /rc=(\d+)\s*$/.exec(out);
  return { rc: m ? Number(m[1]) : -1, out: out.replace(/rc=\d+\s*$/, '') };
}
const check = (home: string, env: Record<string, string> = {}) => run(home, '_check_node-path', env);

describe('ccrc doctor: node-path', () => {
  it('PASSes on a published box, naming the version, the target and the manager', () => {
    const home = box('ccrc-nodepath-ok-');
    const r = check(home);
    expect(r.rc).toBe(0);
    expect(r.out).toMatch(/^PASS node-path: v22\.20\.0 at .*nodes\/v22\.20\.0\/bin\/node .*the user manager's PATH includes it/m);
  });

  it('is in the check table on the `node` line, so no other line moves', () => {
    const lines = readFileSync(CHECKS, 'utf8').split('\n');
    const i = lines.indexOf('CCRC_DOCTOR_CHECKS=(');
    expect(lines[i + 1]).toBe('  node node-path   # one line, as `flock timeout`: _check_node-path follows _check_node, _fix_node-path after it');
  });

  it('SKIPs on darwin: launchd bakes PATH, nothing to publish', () => {
    const home = box('ccrc-nodepath-darwin-');
    const r = check(home, { CCD_OS: 'darwin' });
    expect(r.rc).toBe(3);
    expect(r.out).toMatch(/^SKIP node-path: /m);
    expect(r.out).not.toMatch(/remedy:/);
  });

  it('FAILs when the link directory is missing', () => {
    const home = box('ccrc-nodepath-nodir-');
    rmSync(dirOf(home), { recursive: true });
    const r = check(home);
    expect(r.rc).toBe(1);
    expect(r.out).toMatch(/^FAIL node-path: the node link directory .* does not exist/m);
    expect(r.out).toMatch(/^ {2}remedy: .*ccrc doctor --fix/m);
  });

  it('FAILs, by name, when one link is missing', () => {
    const home = box('ccrc-nodepath-nolink-');
    rmSync(join(dirOf(home), 'npx'));
    const r = check(home);
    expect(r.rc).toBe(1);
    expect(r.out).toMatch(/^FAIL node-path: .*\/npx is missing/m);
    expect(r.out).not.toMatch(/dangling/);
  });

  it('FAILs with its own words on a dangling link', () => {
    const home = box('ccrc-nodepath-dangling-');
    rmSync(join(home, 'nodes', 'v22.20.0'), { recursive: true });
    const r = check(home);
    expect(r.rc).toBe(1);
    expect(r.out).toMatch(/^FAIL node-path: .*\/node is a dangling link \(-> .*v22\.20\.0\/bin\/node\)/m);
    expect(r.out).not.toMatch(/is missing/);
  });

  it('FAILs when the linked node is below the floor, naming both versions', () => {
    const home = box('ccrc-nodepath-below-');
    const old = nodeBin(home, 'v20.1.0', 'v20.1.0');
    for (const b of ['node', 'npm', 'npx']) { rmSync(join(dirOf(home), b)); symlinkSync(join(old, b), join(dirOf(home), b)); }
    const r = check(home);
    expect(r.rc).toBe(1);
    expect(r.out).toMatch(/^FAIL node-path: the linked node v20\.1\.0 .*is below the floor >=22\.16\.0/m);
    expect(r.out).toMatch(/^ {2}remedy: .*ccrc doctor --fix/m);
  });

  it('FAILs when the linked node does not print a version (a shim, not a node)', () => {
    const home = box('ccrc-nodepath-notver-');
    writeFileSync(join(home, 'nodes', 'v22.20.0', 'bin', 'node'), '#!/bin/sh\necho "not a version"\n', { mode: 0o755 });
    const r = check(home);
    expect(r.rc).toBe(1);
    expect(r.out).toMatch(/^FAIL node-path: '.*\/node --version' printed "not a version", which is not a version/m);
  });

  it('reads the floor through the library: a raised package.json floor turns the same box red', () => {
    const home = box('ccrc-nodepath-floor-moves-');
    writeFileSync(join(home, 'ccrc', 'server', 'package.json'), JSON.stringify({ engines: { node: '>=99.0.0' } }));
    expect(check(home).out).toMatch(/^FAIL node-path: .*below the floor >=99\.0\.0/m);
  });

  it('FAILs when the floor cannot be read, and does not guess one', () => {
    const home = box('ccrc-nodepath-nofloor-');
    rmSync(join(home, 'ccrc', 'server'), { recursive: true });
    const r = check(home);
    expect(r.rc).toBe(1);
    expect(r.out).toMatch(/^FAIL node-path: cannot read the node floor: no shipped package\.json/m);
  });

  it('FAILs when the fragment is missing', () => {
    const home = box('ccrc-nodepath-nofrag-');
    rmSync(fragOf(home));
    const r = check(home);
    expect(r.rc).toBe(1);
    expect(r.out).toMatch(/^FAIL node-path: the environment\.d fragment .* is missing/m);
  });

  it('FAILs when the fragment has no PATH line naming the directory', () => {
    const home = box('ccrc-nodepath-badfrag-');
    writeFileSync(fragOf(home), 'PATH=/somewhere/else:${PATH}\n');
    const r = check(home);
    expect(r.rc).toBe(1);
    expect(r.out).toMatch(/^FAIL node-path: .* has no PATH= line naming /m);
    expect(r.out).not.toMatch(/is missing/);
  });

  it('FAILs when the manager answers and its PATH lacks the directory', () => {
    const home = box('ccrc-nodepath-mgr-');
    writeFileSync(join(home, 'fixture-mgr-env'), 'PATH=/usr/bin\n');
    const r = check(home);
    expect(r.rc).toBe(1);
    expect(r.out).toMatch(/^FAIL node-path: the user manager's PATH \(\/usr\/bin\) lacks /m);
    expect(r.out).toMatch(/^ {2}remedy: .*daemon-reload/m);
  });

  it('FAILs with its own words when the manager answers with no PATH= line at all (not "PATH lacks the dir")', () => {
    const home = box('ccrc-nodepath-mgr-nopath-');
    writeFileSync(join(home, 'fixture-mgr-env'), `HOME=${home}\nLANG=C\n`);
    const r = check(home);
    expect(r.rc).toBe(1);
    expect(r.out).toMatch(/^FAIL node-path: the user manager answered show-environment with no PATH= line/m);
    expect(r.out).not.toMatch(/lacks/);
    expect(r.out).toMatch(/^ {2}remedy: .*show-environment/m);
  });

  it('does not match a longer directory name as the directory (:dir: boundaries)', () => {
    const home = box('ccrc-nodepath-prefix-');
    writeFileSync(join(home, 'fixture-mgr-env'), `PATH=${dirOf(home)}-old:/usr/bin\n`);
    expect(check(home).out).toMatch(/^FAIL node-path: the user manager's PATH/m);
  });

  it('with no user manager answering, the manager arm alone is unmeasured: PASS says so', () => {
    const home = box('ccrc-nodepath-nomgr-');
    rmSync(join(home, 'fixture-mgr-env'));
    const r = check(home);
    expect(r.rc).toBe(0);
    expect(r.out).toMatch(/^PASS node-path: .*manager PATH not measured \(no user manager answers/m);
  });

  it('with no systemctl at all, same: the three file arms still ran', () => {
    const home = box('ccrc-nodepath-nosystemctl-');
    rmSync(join(home, 'stub-bin', 'systemctl'));
    expect(check(home).out).toMatch(/^PASS node-path: .*manager PATH not measured/m);
    rmSync(fragOf(home));
    expect(check(home).out).toMatch(/^FAIL node-path: the environment\.d fragment/m);
  });
});

describe('ccrc doctor --fix: node-path', () => {
  // A box whose published node was removed; a qualifying node is on PATH (the no-nvm arm of `_node_select`).
  function dangling(prefix: string): { home: string; newBin: string } {
    const home = box(prefix);
    rmSync(join(home, 'nodes', 'v22.20.0'), { recursive: true });
    const newBin = nodeBin(home, 'v24.1.0', 'v24.1.0');
    return { home, newBin };
  }

  it('re-chooses and republishes through the library, and the check then passes', () => {
    const { home, newBin } = dangling('ccrc-nodepath-fix-');
    expect(check(home).rc).toBe(1);
    const r = run(home, '_fix_node-path', {}, newBin);
    expect(r.rc).toBe(0);
    expect(r.out).toMatch(/^FIX node-path: published v24\.1\.0 at .*v24\.1\.0\/bin/m);
    expect(readlinkSync(join(dirOf(home), 'node'))).toBe(join(newBin, 'node'));
    expect(readFileSync(fragOf(home), 'utf8')).toContain(`PATH=${dirOf(home)}:`);
    expect(readFileSync(join(home, 'reloads'), 'utf8')).toBe('reload\n');
    // the manager's PATH in the fixture already names the dir; the whole check passes again
    expect(check(home).rc).toBe(0);
  });

  it('never installs: with no qualifying nvm node it refuses by the library\'s reason and says what to run', () => {
    const home = box('ccrc-nodepath-fix-noinstall-');
    const nvm = join(home, 'nvmdir');
    mkdirSync(join(nvm, 'versions', 'node', 'v1.0.0', 'bin'), { recursive: true });
    for (const b of ['node', 'npm', 'npx']) writeFileSync(join(nvm, 'versions', 'node', 'v1.0.0', 'bin', b), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(nvm, 'nvm.sh'), `nvm() { case "$1" in version) echo v1.0.0 ;; install) touch "${home}/INSTALLED" ;; esac; }\n`);
    const r = run(home, '_fix_node-path', { NVM_DIR: nvm });
    expect(r.rc).toBe(1);
    expect(r.out).toMatch(/^FIX node-path: refused — .*no installed nvm node meets the floor \(>=22\.16\.0\).*installing is disabled.*run an interactive 'ccrc install' to install one/m);
    expect(existsSync(join(home, 'INSTALLED'))).toBe(false);
    // and it published nothing new: the links are exactly what they were
    expect(lstatSync(join(dirOf(home), 'node')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(home, 'reloads'))).toBe(false);
  });

  it('refuses, naming why, when no node at all can be found', () => {
    const { home } = dangling('ccrc-nodepath-fix-nonode-');
    const r = run(home, '_fix_node-path');
    expect(r.rc).toBe(1);
    expect(r.out).toMatch(/^FIX node-path: refused — node is not installed/m);
  });

  it('is declared for doctor to dispatch by name (`_fix_<check>`)', () => {
    const home = box('ccrc-nodepath-fix-declared-');
    expect(run(home, 'declare -F _fix_node-path >/dev/null').rc).toBe(0);
  });
});

