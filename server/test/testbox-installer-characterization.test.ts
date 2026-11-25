// D-8903 (spec docs/superpowers/specs/2026-11-22-test-box-managed-node-design.md §9, PR 2; note
// docs/superpowers/programs/overlord/testbox-box-updater.md). The characterization of the test box's installer and of
// the tool sync's functions, written BEFORE the installer's steps moved into `deploy/testbox/box-steps` and recorded
// against the installer as it stood on `main`: what `deploy/testbox/install.sh` asks of the system, in order, and what
// it leaves on the box, for a first install, a second run, `--reapply --force`, a changed box file and `--unpair`.
//
// The record is `fixtures/testbox-installer-golden.json`. It was written from the old code and is compared, never
// rewritten, by a run of this file; `CCRC_TESTBOX_GOLDEN=write` rewrites it, which a move commit never does.
// `testbox-box-package.test.ts` pins the installer's rules one by one; this file pins the whole of what it does, so a
// step that moves between files cannot change one call's argv or one file's bytes unseen.
//
// Left out of the record on purpose: the release tree's own files and node's (they are this checkout's, and change
// with every commit), a bare repository's own files, its config among them (git's, and its version's and platform's: the existing suite
// reads the keys the installer sets), and the egress names file, which
// `testbox-box-package.test.ts` pins line for line and `testbox-box-update.test.ts` holds equal between the installer
// and the updater.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOOT_NODE, BOOT_TAG, exec, install, makeBox, makeWorld, sha256, sysLog, type Box, type Ran, type World,
} from './testboxBoxFixture.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const GOLDEN = path.join(HERE, 'fixtures', 'testbox-installer-golden.json');
const WRITE = process.env.CCRC_TESTBOX_GOLDEN === 'write';

let W: World;
beforeAll(async () => { W = await makeWorld(); }, 240_000);
afterAll(async () => { await W.close(); });

/** A fixture path made the same on every run: the box's root, its fixture directory, the staging tree, and the
 *  installer's own work directory under TMPDIR. */
function norm(b: Box, s: string): string {
  return s.split(b.root).join('<root>').split(b.fx).join('<fx>').split(W.staging).join('<staging>')
    .replace(/[^\s\t"']*ccrc-testbox-install\.[A-Za-z0-9]{6}/g, '<work>')
    .replace(/box-sha256\t[0-9a-f]{64}/g, 'box-sha256\t<sha256>');
}

/** The TB_SYS log from line `from` on, one call per line, normalized. */
const calls = (b: Box, from = 0): string[] => sysLog(b).slice(from).map((l) => norm(b, l.join(' ')));

/** What the installer leaves on the box, in path order: a link and its target, a directory, or a file with the digest
 *  of its normalized text. Modes are recorded where the installer sets them through `install -m`. */
function left(b: Box): string[] {
  const out: string[] = [];
  const SKIP = [
    /^opt\/ccrc-testbox\/tools\/release\/v[^/]+\/./, /^opt\/ccrc-testbox\/tools\/node\/[^/]+\/./, /^srv\/mirrors\/[^/]+\/./,
    /^etc\/ccrc-testbox\/egress$/, /^etc\/os-release$/, /^etc\/apt\//,
  ];
  const MODED = [/^etc\/systemd\//, /^etc\/polkit-1\//, /^etc\/ccrc-testbox\/(ccrc-testbox\.nft|installed|ccrc\.env)$/, /^usr\/local\/sbin\//, /^var\/lib\//, /^srv\/testbox(\/|$)/, /^srv\/testbox-repos\.d(\/|$)/];
  const walk = (d: string, rel: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = path.join(d, n);
      const r = rel === '' ? n : `${rel}/${n}`;
      if (SKIP.some((re) => re.test(r))) continue;
      const st = lstatSync(p);
      const mode = MODED.some((re) => re.test(r)) ? ` ${(st.mode & 0o7777).toString(8)}` : '';
      if (st.isSymbolicLink()) out.push(`${r} -> ${norm(b, readlinkSync(p))}`);
      else if (st.isDirectory()) { out.push(`${r}/${mode}`); walk(p, r); }
      else out.push(`${r}${mode} ${sha256(norm(b, readFileSync(p, 'utf8')))}`);
    }
  };
  walk(b.root, '');
  return out;
}

const installed = (b: Box): string => path.join(b.tools, 'release', 'installed', 'deploy', 'testbox', 'install.sh');
const phases = (r: Ran): string[] => r.stderr.split('\n').filter((l) => / phase \d:/.test(l)).map((l) => /phase (\d)/.exec(l)![1]!);
const says = (b: Box, r: Ran): string[] => r.stderr.split('\n').filter((l) => l.startsWith('ccrc-testbox-install: ')).map((l) => norm(b, l));

interface Golden { [scene: string]: { code: number; phases: string[]; says: string[]; calls: string[]; left: string[] } }
const seen: Golden = {};
const golden: Golden = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden : {};

function scene(name: string, b: Box, r: Ran, from: number): void {
  seen[name] = { code: r.code, phases: phases(r), says: says(b, r), calls: calls(b, from), left: left(b) };
  if (WRITE) return;
  expect(golden[name], `no record of "${name}" in ${path.relative(REPO, GOLDEN)}`).toBeDefined();
  expect(seen[name]).toEqual(golden[name]);
}

describe('the installer, characterized against main before its steps moved (D-8903)', () => {
  let b: Box;
  beforeAll(() => { b = makeBox(W); });

  it('a first install: every system call in order, and every file it leaves', async () => {
    const r = await install(b, { staging: W.staging });
    expect(r.code, r.stderr).toBe(0);
    scene('first install', b, r, 0);
  }, 240_000);

  it('a second run with nothing changed: the queries only, and the same box', async () => {
    const n = sysLog(b).length;
    scene('second run', b, await install(b, { staging: W.staging }), n);
  }, 240_000);

  it('--reapply --force: phases 5 and 6 over an installed box, every file written again with the same bytes', async () => {
    const n = sysLog(b).length;
    scene('reapply --force', b, await exec('bash', [installed(b), '--reapply', '--force'], b.env), n);
  }, 240_000);

  it('--reapply after a box file edit: the new values in the drop-ins and the marker', async () => {
    writeFileSync(b.boxFile, `${readFileSync(b.boxFile, 'utf8')}CCRC_TESTBOX_UNIT_MAX=45m\nCCRC_TESTBOX_RUNS=3\n`);
    chmodSync(b.boxFile, 0o600);
    const n = sysLog(b).length;
    scene('reapply, changed box file', b, await exec('bash', [installed(b), '--reapply'], b.env), n);
  }, 240_000);

  it('--unpair: the service and the timer stopped, the key emptied, the token removed, the rest left', async () => {
    const tokenDir = path.join(b.root, 'var', 'lib', 'ccrc-tb-svc', '.ccrc');
    mkdirSync(tokenDir, { recursive: true });
    writeFileSync(path.join(tokenDir, 'testbox-service.token'), 'fixture-token\n');
    const n = sysLog(b).length;
    scene('unpair', b, await exec('bash', [installed(b), '--unpair'], b.env), n);
  }, 240_000);

  it('a refusal writes nothing: a run root that is not on XFS', async () => {
    const c = makeBox(W, { findmnt: 'ext4 /srv\n' });
    const r = await install(c, { staging: W.staging });
    scene('refusal, not XFS', c, r, 0);
    expect(r.code).toBe(1);
  }, 240_000);

  it('the record is complete: every scene above is in it, and it holds no other', () => {
    if (WRITE) { writeFileSync(GOLDEN, `${JSON.stringify(seen, null, 1)}\n`); return; }
    expect(Object.keys(golden).sort()).toEqual(Object.keys(seen).sort());
  });
});

// ── the four retry defects of 2026-11-20 (#3130), the two the box package owns ──────────────────────────────────
// The other two are the admin verb's (the token write, and the egress probe on a box that holds the release) and
// `testbox-admin-connect-retry.test.ts` pins them there; `testbox-box-update.test.ts` pins their form in the updater.
describe('the retry defects of 2026-11-20 that the installer owns (#3130)', () => {
  let b: Box;
  let gitLog: string;
  beforeAll(async () => {
    b = makeBox(W);
    const first = await install(b, { staging: W.staging });
    expect(first.code, first.stderr).toBe(0);
    gitLog = path.join(b.fx, 'git.log');
  }, 240_000);

  /** A `git` that answers as git does for a repository another user owns: any call that opens the mirror (`-C`, or a
   *  working directory inside it) is refused; a call that names a config file runs. */
  function strangerGit(): string {
    const bin = path.join(b.fx, 'stranger-bin');
    mkdirSync(bin, { recursive: true });
    const real = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(bin, 'git'), [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> '${gitLog}'`,
      'for a in "$@"; do [ "$a" = -C ] && { echo "fatal: detected dubious ownership in repository" >&2; exit 128; }; done',
      `case "$PWD/" in '${b.mirror}'/*) echo "fatal: detected dubious ownership in repository" >&2; exit 128 ;; esac`,
      `exec '${real}' "$@"`, '',
    ].join('\n'), { mode: 0o755 });
    return bin;
  }

  it('a mirror\'s config is written by file, so a second run over a mirror that is now the service user\'s completes', async () => {
    const bin = strangerGit();
    const r = await exec('bash', [installed(b), '--reapply', '--force'], { ...b.env, PATH: `${bin}:${b.env.PATH}` });
    expect(r.code, r.stderr).toBe(0);
    const cfg = readFileSync(gitLog, 'utf8').split('\n').filter((l) => l.includes('config'));
    expect(cfg.length).toBe(4);
    for (const l of cfg) expect(l.startsWith(`config --file ${b.mirror}/config `), l).toBe(true);
  }, 240_000);

  it('the reflink probe\'s directory: the run root is root\'s, and `out` and `captures` under it are the service user\'s', () => {
    const made = sysLog(b).filter((l) => l[0] === 'install' && l[1] === '-d').map((l) => `${l[3]} ${l[5]} ${norm(b, l[8]!)}`);
    expect(made).toContain('0755 root <root>/srv/testbox');
    expect(made).toContain('0750 ccrc-tb-svc <root>/srv/testbox/out');
    // The build capture's store: the service user's, beside its other directories; the build copy drops to its owner.
    expect(made).toContain('0750 ccrc-tb-svc <root>/srv/testbox/captures');
  });
});

// ── the tool sync, as a library ─────────────────────────────────────────────────────────────────────────────────
// `agent/test/testbox-tools.test.ts` characterizes the sync itself. What the installer and the updater rest on is that
// the file can be sourced for its functions without running, and that the functions they call are there.
describe('the tool sync is a library to the installer and the updater (D-7424, D-8903)', () => {
  const TOOLS_SYNC = path.join(REPO, 'deploy', 'testbox', 'bin', 'tools-sync');
  const FUNCTIONS = [
    '_tbt_home', '_tbt_sha256', '_tbt_clean', '_tbt_curl', '_tbt_node_install', '_tbt_npm_install', '_tbt_chrome_install',
    '_tbt_apt', '_tbt_apt_cache', '_tbt_apt_sources', '_tbt_apt_version', '_tbt_apt_pins', '_tbt_dep_pick', '_tbt_link',
  ];

  it('sourcing it runs nothing and defines each function its callers use', () => {
    const r = spawnSync('bash', ['--norc', '--noprofile', '-c', `set -uo pipefail; . "$1"; for f in ${FUNCTIONS.join(' ')}; do declare -F "$f" >/dev/null || echo "missing $f"; done; echo sourced`, 'bash', TOOLS_SYNC],
      { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
    expect(r.stdout, r.stderr).toBe('sourced\n');
  });

  it('the fetch hosts are the two the firewall\'s tools set names, and node\'s version shape is the installer\'s', () => {
    const src = readFileSync(TOOLS_SYNC, 'utf8');
    expect(/^TBT_NODE_HOST=(.*)$/m.exec(src)![1]).toBe('https://nodejs.org/dist');
    expect(/^TBT_CHROME_HOST=(.*)$/m.exec(src)![1]).toBe('https://storage.googleapis.com/chrome-for-testing-public');
    expect(BOOT_NODE).toMatch(/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/);
    expect(BOOT_TAG).toMatch(/^v\d+\.\d+\.\d+$/);
  });
});
