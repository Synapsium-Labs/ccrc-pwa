// `deploy/build-release.sh` — the release pipeline's TESTABLE CORE (stage 4,
// spec §2). CI merely invokes it; everything a release artifact promises is
// promised HERE, so this file measures the script directly, against a fixture
// git repository, with npm stubbed out.
//
// ── THE FIXTURE IS A REAL GIT REPOSITORY (the `gitInit` idiom) ────────────
// The script's two refusals are `git status --porcelain` and `git tag
// --points-at HEAD`, and its staging step is `git archive HEAD` — all three
// are questions only git itself can answer, so the fixture is a real
// one-commit repo (ccrc-install.test.ts:660's idiom, copied here rather than
// imported: importing a .test.ts module would register its 2,600 lines of
// tests inside this file's run). The script under test is COPIED into the
// fixture's `deploy/` (install-sh.test.ts's idiom) so its own
// `${BASH_SOURCE[0]}` root-resolution points at the fixture and never at this
// checkout — a run against the real repo would `npm ci` for real and write
// artifacts into the working tree.
//
// ── CONTAINMENT ───────────────────────────────────────────────────────────
// `npm` is a RECORDING STUB that fabricates the `dist/` artifacts a real
// build would leave: the test pins the script's ORCHESTRATION (what runs,
// in which directory, what lands in the tarball), never tsc's output. A real
// `npm ci` would reach the registry and take minutes per test. `curl` and
// `gh` are poisons — nothing in this script may ever touch the network or a
// repository remote; a poison firing is a loud 97, not a silent pass.
// git/tar/sha256sum are the REAL tools, because the artifact's integrity
// story (`sha256sum -c`, the MANIFEST) is exactly what must not be simulated.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync, writeFileSync, existsSync, chmodSync, copyFileSync, readFileSync,
  readdirSync, statSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SCRIPT = join(REPO, 'deploy', 'build-release.sh');

const realPath = (name: string): string => {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
};
/** Absolute, for the reason every sibling suite resolves it once: the child's
 *  PATH decides what a bare name means, and this runner rearranges PATH. */
const BASH = realPath('bash');
const TAR = realPath('tar');
const SHA256SUM = realPath('sha256sum');

/** Hermetic git env — identity from variables, ambient config unread — the
 *  `gitInit` idiom (ccrc-install.test.ts:660), plus this file's one addition:
 *  the same env is handed to the RUNNER below, so the script's own `git
 *  status`/`git archive` answer for the fixture and never for whatever
 *  templates or hooks this box's operator configured globally. */
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};

function git(root: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', root, ...args],
    { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** Every TRACKED file the fixture repo holds — the pathspec set `git archive`
 *  is asked for, in miniature. Contents are stubs: the script promises to
 *  SHIP these bytes faithfully (the MANIFEST digests prove fidelity), not
 *  that they do anything. `deploy/build-release.sh` itself joins the set via
 *  `copyFileSync` in `fixtureRepo` — it is tracked in the real repo too. */
const FIXTURE_FILES: Record<string, string> = {
  'install.sh': '#!/usr/bin/env bash\necho fixture install.sh\n',
  'ccd/ccrc': '#!/usr/bin/env bash\necho fixture ccrc\n',
  'ccd/ccrc-doctor-checks': '# fixture doctor checks\n',
  'shared/api.ts': '// fixture shared/api.ts\n',
  'shared/package.json': '{ "type": "module" }\n',
  'deploy/ccrc.service': '[Unit]\nDescription=fixture ccrc.service\n',
  'deploy/verify-service.sh': '#!/usr/bin/env bash\necho fixture verify\n',
  'server/package.json': '{ "name": "ccrc-server-fixture" }\n',
  'server/package-lock.json': '{ "name": "ccrc-server-fixture", "lockfileVersion": 3 }\n',
  'agent/package.json': '{ "name": "ccrc-agent-fixture" }\n',
  'agent/package-lock.json': '{ "name": "ccrc-agent-fixture", "lockfileVersion": 3 }\n',
  'pwa/package.json': '{ "name": "ccrc-pwa-fixture" }\n',
  'pwa/package-lock.json': '{ "name": "ccrc-pwa-fixture", "lockfileVersion": 3 }\n',
};

/** `<home>/repo` — one commit holding `FIXTURE_FILES` plus the real script,
 *  optionally tagged. Returns the repo root. */
function fixtureRepo(home: string, opts: { tag?: string } = {}): string {
  const root = join(home, 'repo');
  for (const [rel, body] of Object.entries(FIXTURE_FILES)) {
    const dest = join(root, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, body, { mode: rel.endsWith('.sh') || rel === 'ccd/ccrc' ? 0o755 : 0o644 });
  }
  copyFileSync(SCRIPT, join(root, 'deploy', 'build-release.sh'));
  chmodSync(join(root, 'deploy', 'build-release.sh'), 0o755);
  git(root, 'init', '-q', '-b', 'fixture-branch');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture tree');
  if (opts.tag !== undefined) git(root, 'tag', opts.tag);
  return root;
}

/** The stub bin: a recording `npm` that FABRICATES what a build leaves behind
 *  (per-package, keyed on its own cwd — the script's `cd` into each package
 *  is half of what it promises), and poisons for the two tools this script
 *  must never reach. */
function plantStubBin(home: string): string {
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'npm'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$PWD $*" >> "$HOME/npm-argv"',
    'if [ "$1" = "run" ] && [ "$2" = "build" ]; then',
    '  case "$PWD" in',
    '    */server)',
    '      mkdir -p dist/server/src',
    '      echo "// fixture server build" > dist/server/src/index.js ;;',
    '    */pwa)',
    '      mkdir -p ../server/dist-pwa',
    '      echo "<!doctype html><title>fixture PWA build</title>" > ../server/dist-pwa/index.html ;;',
    '    */agent)',
    '      mkdir -p dist/agent/src',
    '      echo "// fixture agent build" > dist/agent/src/index.js ;;',
    '  esac',
    'fi',
    'exit 0',
  ].join('\n'), { mode: 0o755 });
  const poison = (name: string, says: string): void =>
    writeFileSync(join(bin, name),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\necho "${says}" >&2\nexit 97\n`,
      { mode: 0o755 });
  poison('curl', 'build-release tests must never reach the network');
  poison('gh', 'build-release tests must never reach a repository remote');
  return bin;
}

interface Result { code: number; stdout: string; stderr: string }

/** Runs the FIXTURE's copy of the script (never this checkout's), stub bin at
 *  the head of an otherwise-real PATH: `git`, `tar` and `sha256sum` must be
 *  the real tools, `npm`/`curl`/`gh` must be the stubs above. */
function runRelease(root: string, home: string, args: string[] = []): Result {
  const bin = plantStubBin(home);
  const env = {
    ...process.env, ...GIT_ENV, HOME: home,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
  };
  const r = spawnSync(BASH, [join(root, 'deploy', 'build-release.sh'), ...args],
    { env, cwd: root, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** `tar -tzf`, entries normalized: the leading `./` stripped, bare directory
 *  entries dropped — what remains is the file set a reader of the layout
 *  cares about. */
function tarListing(tarball: string): string[] {
  const r = spawnSync(TAR, ['-tzf', tarball], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar -tzf failed: ${r.stderr}`);
  return r.stdout.split('\n')
    .map((l) => l.replace(/^\.\/?/, ''))
    .filter((l) => l !== '' && !l.endsWith('/'));
}

function extract(tarball: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const r = spawnSync(TAR, ['-xzf', tarball, '-C', dest], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar -xzf failed: ${r.stderr}`);
}

const sha256 = (p: string): string =>
  createHash('sha256').update(readFileSync(p)).digest('hex');

function walkFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const rel = prefix === '' ? e : `${prefix}/${e}`;
    if (statSync(p).isDirectory()) out.push(...walkFiles(p, rel));
    else out.push(rel);
  }
  return out;
}

/** The layout spec §2 names, as it appears in this fixture. The dist paths
 *  are the stub npm's own fabrications — asserting them proves the builds'
 *  OUTPUT was shipped, not merely that npm was invoked. */
const EXPECTED_ENTRIES = [
  'server/dist/server/src/index.js',
  'server/dist-pwa/index.html',
  'agent/dist/agent/src/index.js',
  'server/package.json', 'server/package-lock.json',
  'agent/package.json', 'agent/package-lock.json',
  'pwa/package.json', 'pwa/package-lock.json',
  'shared/api.ts', 'shared/package.json',
  'ccd/ccrc', 'ccd/ccrc-doctor-checks',
  'deploy/ccrc.service', 'deploy/verify-service.sh',
  'install.sh',
  'MANIFEST',
];

describe('build-release.sh: the two refusals, before anything is written', () => {
  it('refuses a dirty tree — die, nothing written, no npm ran', () => {
    const home = mkTmp('build-release-dirty-');
    const root = fixtureRepo(home, { tag: 'v1.2.3' });
    // An UNTRACKED straggler is the weakest form of dirt — `git status
    // --porcelain` reports it as `??`, and a check that only caught modified
    // tracked files would ship whatever secret happened to be lying around.
    writeFileSync(join(root, 'straggler.txt'), 'not committed\n');
    const r = runRelease(root, home, ['--out', join(home, 'out')]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^build-release\.sh: refusing a dirty tree/m);
    expect(existsSync(join(home, 'out')), 'the out dir was created before the refusal').toBe(false);
    expect(existsSync(join(home, 'npm-argv')), 'npm ran before the refusal').toBe(false);
  });

  it('refuses an untagged HEAD without --untagged, naming the flag', () => {
    const home = mkTmp('build-release-untagged-refuse-');
    const root = fixtureRepo(home); // no tag
    const r = runRelease(root, home, ['--out', join(home, 'out')]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^build-release\.sh: HEAD carries no vX\.Y\.Z tag/m);
    expect(r.stderr).toContain('--untagged');
    expect(existsSync(join(home, 'out'))).toBe(false);
    expect(existsSync(join(home, 'npm-argv')), 'npm ran before the refusal').toBe(false);
  });

  it('refuses an argument it does not recognise', () => {
    const home = mkTmp('build-release-badarg-');
    const root = fixtureRepo(home, { tag: 'v1.2.3' });
    const r = runRelease(root, home, ['--dry-run']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^build-release\.sh: unknown argument: --dry-run$/m);
    expect(existsSync(join(home, 'npm-argv')), 'npm ran before the refusal').toBe(false);
  });
});

describe('build-release.sh: the tagged run — the matched set, checksummed', () => {
  it('assembles ccrc-<tag>.tar.gz holding the layout, having built all three packages', () => {
    const home = mkTmp('build-release-tagged-');
    const root = fixtureRepo(home, { tag: 'v1.2.3' });
    const out = join(home, 'out');
    const r = runRelease(root, home, ['--out', out]);
    expect(r.code, r.stderr).toBe(0);
    const tarball = join(out, 'ccrc-v1.2.3.tar.gz');
    expect(existsSync(tarball), 'the tarball landed under --out, named by the tag').toBe(true);
    expect(existsSync(join(out, 'SHA256SUMS')), 'SHA256SUMS sits beside it').toBe(true);
    const listing = tarListing(tarball);
    for (const entry of EXPECTED_ENTRIES) {
      expect(listing, `the tarball is missing ${entry}`).toContain(entry);
    }
    // The three builds ran, each `cd`'d into its own package — `npm ci` then
    // `npm run build`, per package, recorded with the cwd npm saw.
    const argv = readFileSync(join(home, 'npm-argv'), 'utf8');
    for (const pkg of ['server', 'pwa', 'agent']) {
      expect(argv).toMatch(new RegExp(`^${join(root, pkg)} ci\\b.*$`, 'm'));
      expect(argv).toMatch(new RegExp(`^${join(root, pkg)} run build$`, 'm'));
    }
  });

  it('sha256sum -c SHA256SUMS passes beside the tarball', () => {
    const home = mkTmp('build-release-sums-');
    const root = fixtureRepo(home, { tag: 'v1.2.3' });
    const out = join(home, 'out');
    expect(runRelease(root, home, ['--out', out]).code).toBe(0);
    const r = spawnSync(SHA256SUM, ['-c', 'SHA256SUMS'], { cwd: out, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('ccrc-v1.2.3.tar.gz: OK');
  });

  it('the MANIFEST names every file in the tarball, with digests that verify', () => {
    const home = mkTmp('build-release-manifest-');
    const root = fixtureRepo(home, { tag: 'v1.2.3' });
    const out = join(home, 'out');
    expect(runRelease(root, home, ['--out', out]).code).toBe(0);
    const dest = join(home, 'extracted');
    extract(join(out, 'ccrc-v1.2.3.tar.gz'), dest);
    const manifest = readFileSync(join(dest, 'MANIFEST'), 'utf8')
      .split('\n').filter((l) => l !== '');
    const entries = new Map<string, string>();
    for (const line of manifest) {
      const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
      expect(m, `MANIFEST line is not sha256sum-shaped: ${line}`).not.toBeNull();
      entries.set(m![2], m![1]);
    }
    // Name-set EQUALITY, both directions: a file in the tarball the MANIFEST
    // does not name is an unverifiable stowaway; a named file the tarball
    // lacks makes `ccrc update`'s post-extract verify fail on every box.
    const onDisk = walkFiles(dest).filter((f) => f !== 'MANIFEST').sort();
    expect([...entries.keys()].sort()).toEqual(onDisk);
    // Spot-verify TWO digests independently (node's own crypto, not
    // sha256sum, so the tool cannot vouch for itself)…
    for (const spot of ['install.sh', 'ccd/ccrc']) {
      expect(entries.get(spot), `${spot}'s digest is wrong in the MANIFEST`)
        .toBe(sha256(join(dest, spot)));
    }
    // …and let sha256sum -c verify the whole set, which is exactly what the
    // update verb will do after extraction.
    const r = spawnSync(SHA256SUM, ['-c', 'MANIFEST'], { cwd: dest, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it('--untagged names the artifact untagged-<shortsha>, and only with the flag', () => {
    const home = mkTmp('build-release-untagged-ok-');
    const root = fixtureRepo(home); // no tag
    const out = join(home, 'out');
    const r = runRelease(root, home, ['--untagged', '--out', out]);
    expect(r.code, r.stderr).toBe(0);
    const short = git(root, 'rev-parse', '--short', 'HEAD');
    expect(existsSync(join(out, `ccrc-untagged-${short}.tar.gz`))).toBe(true);
  });
});

describe('build-release.sh: source pins', () => {
  // A casual edit that drops one of these flags makes every artifact's bytes
  // depend on who built it and when — silently, since nothing else fails.
  it('the tar invocation carries the reproducibility flags, on one line', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/tar --sort=name --mtime=@0 --owner=0 --group=0 /);
  });

  it('the script runs under set -euo pipefail', () => {
    expect(readFileSync(SCRIPT, 'utf8')).toMatch(/^set -euo pipefail$/m);
  });

  // The staging tree is `git archive HEAD` — TRACKED content only, which is
  // the mechanism that keeps gitignored secrets (deploy/ccrc-mail.token sits
  // in this very directory on a live box) out of every release forever. A
  // rewrite to `cp -a` would ship them and stay green on any fixture without
  // a planted secret, so the mechanism itself is pinned.
  it('the tracked set is staged via git archive, never copied from the working tree', () => {
    expect(readFileSync(SCRIPT, 'utf8')).toMatch(/git .*archive .*HEAD/);
  });
});
