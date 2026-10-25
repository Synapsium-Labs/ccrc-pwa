// `deploy/build-release.sh` — the release pipeline's TESTABLE CORE (stage 4,
// spec §2). CI merely invokes it; everything a release artifact promises is
// promised HERE, so this file measures the script directly, against a fixture
// git repository, with npm stubbed out.
//
// ── THE FIXTURE IS A REAL GIT REPOSITORY (the `gitInit` idiom) ────────────
// The script's two refusals are `git status --porcelain` and `git tag
// --points-at HEAD`, and its staging step is `git archive HEAD` — all three
// are questions only git itself can answer, so the fixture is a real
// one-commit repo (ccrc-install-*.test.ts's idiom, copied here rather than
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
import { canonicalPython3 } from './ccdWsHelpers.js';
import { verifyMarker } from '../../shared/mark.mjs';
import { parse } from 'yaml';
import { onBlock } from './workflowTrigger.js';
import { workflowJobs, type WorkflowJob, type WorkflowStep } from './workflowJobs.js';

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
 *  `gitInit` idiom (ccrc-installFixture.ts), plus this file's one addition:
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
  // The installed `ccd` is TWO release inputs: the Bash body (`ccd/ccd`, placed
  // at `~/.local/libexec/ccrc/ccd`) and the launcher TEMPLATE (`ccd/ccd-entry.py`,
  // rendered into `~/.local/bin/ccd` on the box). The script archives all of
  // `ccd/`, so neither is named in its pathspec — which is exactly why each is an
  // explicit expected member below rather than something that merely rides along.
  'ccd/ccd': '#!/usr/bin/env bash\necho fixture ccd body\n',
  'ccd/ccd-entry.py': '#!/usr/bin/env python3\n# fixture launcher template\n',
  'shared/api.ts': '// fixture shared/api.ts\n',
  'shared/package.json': '{ "type": "module" }\n',
  'deploy/ccrc.service': '[Unit]\nDescription=fixture ccrc.service\n',
  'deploy/verify-service.sh': '#!/usr/bin/env bash\necho fixture verify\n',
  // The real server package's install-time hook, in miniature: `npm ci` on the
  // box runs it, so the file it names must ride the tarball (D-3105 — v0.0.2
  // shipped the hook without the file, and every box's install died after the
  // new tree was placed).
  'server/package.json': '{ "name": "ccrc-server-fixture", "scripts": { "postinstall": "node scripts/fix-node-pty-helper.mjs" } }\n',
  'server/scripts/fix-node-pty-helper.mjs': '// fixture postinstall — exits 0\n',
  'server/package-lock.json': '{ "name": "ccrc-server-fixture", "lockfileVersion": 3 }\n',
  'agent/package.json': '{ "name": "ccrc-agent-fixture" }\n',
  'agent/package-lock.json': '{ "name": "ccrc-agent-fixture", "lockfileVersion": 3 }\n',
  'pwa/package.json': '{ "name": "ccrc-pwa-fixture" }\n',
  'pwa/package-lock.json': '{ "name": "ccrc-pwa-fixture", "lockfileVersion": 3 }\n',
  // @ccrc/ui: INSTALLED by the builder (pwa reads its source), never built and
  // never shipped — so it is a fixture input here and absent from the layout.
  'ui/package.json': '{ "name": "@ccrc/ui" }\n',
  'ui/package-lock.json': '{ "name": "@ccrc/ui", "lockfileVersion": 3 }\n',
};

/** `<home>/repo` — one commit holding `FIXTURE_FILES` plus the real script,
 *  optionally tagged. Returns the repo root. */
function fixtureRepo(home: string, opts: { tag?: string; files?: Record<string, string> } = {}): string {
  const root = join(home, 'repo');
  for (const [rel, body] of Object.entries({ ...FIXTURE_FILES, ...(opts.files ?? {}) })) {
    const dest = join(root, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, body, { mode: rel.endsWith('.sh') || rel === 'ccd/ccrc' || rel === 'ccd/ccd' ? 0o755 : 0o644 });
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
  'server/scripts/fix-node-pty-helper.mjs',
  'agent/package.json', 'agent/package-lock.json',
  'pwa/package.json', 'pwa/package-lock.json',
  'shared/api.ts', 'shared/package.json',
  'ccd/ccrc', 'ccd/ccrc-doctor-checks',
  'ccd/ccd', 'ccd/ccd-entry.py',
  'deploy/ccrc.service', 'deploy/verify-service.sh',
  'install.sh',
  'MANIFEST',
  'build.json',
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
    // AND ui — installed, not built, and BEFORE pwa (PR #346's release-lane
    // blocker). pwa builds @ccrc/ui from SOURCE, whose imports resolve from
    // ui/node_modules alone, so a release machine that skips this line fails
    // pwa's `tsc --noEmit && vite build` and every merge's prerelease stalls.
    // A stub npm cannot reproduce that failure; the ORDER of the recorded
    // calls is what it can prove.
    const lines = argv.split('\n');
    const uiCi = lines.findIndex((l) => l.startsWith(`${join(root, 'ui')} ci `));
    const pwaCi = lines.findIndex((l) => l.startsWith(`${join(root, 'pwa')} ci `));
    expect(uiCi, 'the builder never installs ui — pwa\'s build cannot resolve ui\'s imports').toBeGreaterThan(-1);
    expect(uiCi, 'ui is installed after pwa — pwa\'s install and build ran without it').toBeLessThan(pwaCi);
    expect(lines[uiCi], 'ui is installed exactly as the other three are').toBe(`${join(root, 'ui')} ci --no-audit --no-fund`);
    expect(lines, 'ui ships no dist — nothing reads one, so the builder must not build it')
      .not.toContain(`${join(root, 'ui')} run build`);
    expect(listing.filter((e) => e.startsWith('ui/')),
      'ui rides the PWA bundle in server/dist-pwa; its own tree is not part of the release set').toEqual([]);
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

  // W6 Task 8A (review 173's F4a): `ccd/ccrc`'s `_upd_resolve` bounds the
  // SHA256SUMS fetch with `--max-filesize CCRC_RELEASE_SUMS_MAX_FILESIZE`, a
  // size DERIVED from this builder's output shape and, until now, tied to it by
  // prose alone. Pinned here against the REAL builder: the file is exactly one
  // `sha256sum` line — 64 hex, two spaces, the tarball's name, one newline —
  // so it is 64 + 2 + name + 1 bytes, and the longest name a tag can give
  // (three-digit components) is 24 bytes: 91 in all. The shipped default has
  // to admit that, and has to stay within two orders of magnitude of it, or
  // it stops being a bound. A builder that gained a second line, a `>>`, or a
  // longer name reds this instead of a release host's next SHA256SUMS.
  it('SHA256SUMS is one sha256sum line, at most 91 bytes for any tag, and inside the size bound ccrc update ships (F4a)', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    expect(script.match(/>>?\s*SHA256SUMS/g), 'the builder must write SHA256SUMS exactly once, by a single `>`').toEqual(['> SHA256SUMS']);
    const home = mkTmp('build-release-sums-shape-');
    const root = fixtureRepo(home, { tag: 'v999.999.999' });
    const out = join(home, 'out');
    expect(runRelease(root, home, ['--out', out]).code).toBe(0);
    const sums = readFileSync(join(out, 'SHA256SUMS'), 'utf8');
    expect(sums).toMatch(/^[0-9a-f]{64} {2}ccrc-v999\.999\.999\.tar\.gz\n$/);
    expect(Buffer.byteLength(sums), 'the worst-case tag: 64 + 2 + 24 + 1').toBe(91);
    const shipped = /^: "\$\{CCRC_RELEASE_SUMS_MAX_FILESIZE:=(\d+)\}"$/m.exec(readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8'));
    expect(shipped, 'ccd/ccrc has no CCRC_RELEASE_SUMS_MAX_FILESIZE default').not.toBeNull();
    const bound = Number(shipped![1]);
    expect(bound, 'the default refuses a real SHA256SUMS').toBeGreaterThanOrEqual(91);
    expect(bound, 'the default is no bound at all against a ~100-byte file').toBeLessThanOrEqual(91 * 100);
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
    // Spot-verify FOUR digests independently (node's own crypto, not
    // sha256sum, so the tool cannot vouch for itself) — the original two, plus
    // BOTH halves of the installed `ccd`: the body and the launcher template,
    // each of which a box cannot run without…
    for (const spot of ['install.sh', 'ccd/ccrc', 'ccd/ccd', 'ccd/ccd-entry.py']) {
      expect(entries.get(spot), `${spot}'s digest is wrong in the MANIFEST`)
        .toBe(sha256(join(dest, spot)));
    }
    // …and let sha256sum -c verify the whole set, which is exactly what the
    // update verb will do after extraction.
    const r = spawnSync(SHA256SUM, ['-c', 'MANIFEST'], { cwd: dest, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  // The fixture's `ccd/` members are stubs, so the test above proves the SCRIPT
  // ships whatever `ccd/` holds. This one feeds it this checkout's REAL bytes for
  // the two release inputs of the installed `ccd` and asks the artifact for them
  // back: both present, both MANIFEST-covered, and both byte-identical to the
  // source — the template included, since a release that shipped the body alone
  // would install a `ccd` whose launcher no box can render.
  it('ships the real ccd body, launcher template and pair installer byte-for-byte, MANIFEST-covered (the installed ccd is a pair)', () => {
    const real = (rel: string): string => {
      expect(existsSync(join(REPO, rel)), `${rel} is not in this checkout`).toBe(true);
      return readFileSync(join(REPO, rel), 'utf8');
    };
    // The third member is the program that renders and publishes the pair on
    // the box (`ccrc install`/`update` and `deploy.sh` both run it from the
    // tree), so a release without it installs nothing at all.
    const pair = ['ccd/ccd', 'ccd/ccd-entry.py', 'ccd/ccd-entry-install.py'] as const;
    const home = mkTmp('build-release-ccd-pair-');
    const root = fixtureRepo(home, {
      tag: 'v1.2.3', files: Object.fromEntries(pair.map((rel) => [rel, real(rel)])),
    });
    const out = join(home, 'out');
    expect(runRelease(root, home, ['--out', out]).code).toBe(0);
    const tarball = join(out, 'ccrc-v1.2.3.tar.gz');
    const listing = tarListing(tarball);
    const dest = join(home, 'extracted-pair');
    extract(tarball, dest);
    const manifest = readFileSync(join(dest, 'MANIFEST'), 'utf8');
    for (const rel of pair) {
      expect(listing, `the tarball is missing ${rel}`).toContain(rel);
      const line = manifest.split('\n').find((l) => l.endsWith(` ${rel}`) || l.endsWith(`*${rel}`));
      expect(line, `the MANIFEST does not name ${rel}`).toBeTruthy();
      // Three-way agreement: the digest the MANIFEST states, the bytes the
      // tarball carries, and the source file in this checkout.
      expect(line!.slice(0, 64), `${rel}: MANIFEST digest vs the extracted bytes`).toBe(sha256(join(dest, rel)));
      expect(sha256(join(dest, rel)), `${rel}: shipped bytes vs this checkout's`).toBe(sha256(join(REPO, rel)));
    }
  });

  // The stamp is written at INSTALL time (ccd-entry-install.py), so what a release proves is that the tree
  // it carries INSTALLS a body that verifies: the extracted tarball's ccd, run through the shipped installer
  // into a fixture HOME, reads ccrc-unmodified and the launcher accepts it.
  it('the extracted tarball\'s ccd installs a body that verifies as ccrc-unmodified', () => {
    const real = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');
    const pair = ['ccd/ccd', 'ccd/ccd-entry.py', 'ccd/ccd-entry-install.py'] as const;
    const home = mkTmp('build-release-ccd-stamp-');
    const root = fixtureRepo(home, { tag: 'v1.2.3', files: Object.fromEntries(pair.map((rel) => [rel, real(rel)])) });
    const out = join(home, 'out');
    expect(runRelease(root, home, ['--out', out]).code).toBe(0);
    const dest = join(home, 'extracted-stamp-install');
    extract(join(out, 'ccrc-v1.2.3.tar.gz'), dest);
    const box = mkTmp('build-release-ccd-stamp-box-');
    const py = canonicalPython3();
    const r = spawnSync(py, ['-IS', join(dest, 'ccd', 'ccd-entry-install.py'), 'install', dest, box],
      { encoding: 'utf8', env: { HOME: box, PATH: process.env['PATH'] ?? '/usr/bin:/bin' } });
    expect(r.status, r.stderr).toBe(0);
    const installed = readFileSync(join(box, '.local', 'libexec', 'ccrc', 'ccd'), 'utf8');
    expect(verifyMarker(installed)).toBe('ccrc-unmodified');
    expect(verifyMarker(readFileSync(join(dest, 'ccd', 'ccd'), 'utf8')), 'the release tree itself carries no stamp').toBe('foreign');
  });

  // ── Stage 4, Task 6: the artifact carries its own identity ──────────────
  // An extracted release tree is not a git repository, so the box-side
  // stamper (`_inst_stamp`) cannot measure it — it installs THIS file, and
  // `ccrc update` reports from → to off the same fields. sha/ref are measured
  // on the release machine from the same HEAD `git archive` shipped; dirty is
  // false by the dirty-tree refusal; version is the artifact's own name.
  it('ships build.json stamping the tagged commit — sha=HEAD, dirty:false, version=the tag, MANIFEST-covered', () => {
    const home = mkTmp('build-release-stamp-');
    const root = fixtureRepo(home, { tag: 'v1.2.3' });
    const out = join(home, 'out');
    expect(runRelease(root, home, ['--out', out]).code).toBe(0);
    const dest = join(home, 'extracted-stamp');
    extract(join(out, 'ccrc-v1.2.3.tar.gz'), dest);
    const stamp = JSON.parse(readFileSync(join(dest, 'build.json'), 'utf8')) as Record<string, unknown>;
    expect(stamp['sha']).toBe(git(root, 'rev-parse', 'HEAD'));
    expect(stamp['version']).toBe('v1.2.3');
    expect(stamp['dirty']).toBe(false);
    expect(typeof stamp['ref']).toBe('string');
    expect(stamp['builtAt']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    // Covered by the per-file digests like everything else in the set — a
    // stamp the MANIFEST cannot vouch for is an identity nobody verified.
    const manifest = readFileSync(join(dest, 'MANIFEST'), 'utf8');
    const line = manifest.split('\n').find((l) => l.endsWith(' build.json') || l.endsWith('*build.json'));
    expect(line, 'the MANIFEST does not name build.json').toBeTruthy();
    expect(line!.slice(0, 64)).toBe(sha256(join(dest, 'build.json')));
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

// ── .github/workflows/release.yml — the THIN delivery layer (spec §2) ─────
// "No logic in YAML that the script doesn't own." The workflow cannot be
// executed here (it runs only on GitHub's runners, on a tag push), so it is
// pinned the way runbook-holds pins transcript lines: source-scan against the
// exact strings whose loss would change what a release IS. Three properties:
// the trigger set (only `v*` tags — a branch or PR trigger would cut releases
// from unreviewed pushes), the single build path (the script, never a second
// `npm run build` lane that could drift from it), and the upload (both
// artifacts — tarball AND SHA256SUMS — via the glob over the script's --out).
describe('build-release.sh: install-time hooks ship with their scripts (D-3105)', () => {
  // `npm ci --omit=dev` on the box (ccd/ccrc's install spine) runs every
  // install-time hook the packed package.json declares. v0.0.2, measured in the
  // spec §7 rehearsal: server's `postinstall` named scripts/fix-node-pty-helper.mjs,
  // the tarball carried no server/scripts/, and the staged install died on
  // every box and every contributor HOME — AFTER the new tree was placed.
  it('a tracked <pkg>/scripts/ rides the tarball beside its package.json', () => {
    const home = mkTmp('build-release-hook-scripts-');
    const root = fixtureRepo(home, { tag: 'v1.2.3' });
    const out = join(home, 'out');
    const r = runRelease(root, home, ['--out', out]);
    expect(r.code, r.stderr).toBe(0);
    const listing = tarListing(join(out, 'ccrc-v1.2.3.tar.gz'));
    expect(listing, 'the postinstall hook names it, so npm ci on the box needs it')
      .toContain('server/scripts/fix-node-pty-helper.mjs');
  });

  it('a hook naming a file the release set does not hold is a refusal here — package, hook and path named; no artifact', () => {
    const home = mkTmp('build-release-hook-unshipped-');
    const root = fixtureRepo(home, {
      tag: 'v1.2.3',
      files: { 'agent/package.json': '{ "name": "ccrc-agent-fixture", "scripts": { "postinstall": "node tools/absent.mjs" } }\n' },
    });
    const r = runRelease(root, home, ['--out', join(home, 'out')]);
    expect(r.code, `stdout:\n${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(
      /^build-release\.sh: agent\/package\.json's postinstall runs 'node tools\/absent\.mjs', but agent\/tools\/absent\.mjs is not in the release set/m);
    expect(existsSync(join(home, 'out')), 'an artifact was written despite the refusal').toBe(false);
  });

  // The fixture proves the script's rule; this proves the REAL packages obey it
  // today, so the refusal fires in a PR's CI rather than in release-main.yml
  // after the merge. Every hook token that looks like a path must live under
  // <pkg>/scripts/ (the one directory the script packs) and be tracked (the
  // script ships tracked content only).
  it('the real server/agent/pwa install-time hooks name only tracked files under <pkg>/scripts/', () => {
    const HOOKS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish'];
    let seen = 0;
    for (const pkg of ['server', 'agent', 'pwa']) {
      const scripts = (JSON.parse(readFileSync(join(REPO, pkg, 'package.json'), 'utf8')).scripts ?? {}) as Record<string, string>;
      for (const hook of HOOKS) {
        const cmd = scripts[hook];
        if (!cmd) continue;
        for (const tok of cmd.split(/\s+/)) {
          if (tok.startsWith('-') || !tok.includes('/')) continue;
          seen += 1;
          expect(tok, `${pkg}/package.json's ${hook} runs '${cmd}' — ${tok} is outside ${pkg}/scripts/, the one directory build-release.sh packs`)
            .toMatch(/^scripts\//);
          const tracked = spawnSync('git', ['-C', REPO, 'ls-files', '--error-unmatch', join(pkg, tok)], { encoding: 'utf8' });
          expect(tracked.status, `${pkg}/${tok} is not tracked — git archive would not ship it`).toBe(0);
        }
      }
    }
    // Not vacuous: the server package's postinstall is the case this exists for.
    expect(seen).toBeGreaterThan(0);
  });
});

/** What BOTH build workflows must say to attest (design 2026-09-20 §4): the
 *  pinned action, the tarball glob as subject, and the permission set
 *  `actions/attest`'s README documents for this exact no-registry-push usage
 *  (its "Provenance Attestation (Default)" example) — `attest-build-provenance
 *  @v4`'s own README documents neither permissions nor inputs/outputs, it
 *  only redirects to `actions/attest` (D-3126) — `contents: write` because
 *  the release itself needs it. `id-token` was FORBIDDEN by the stage-4 pin
 *  (a key nobody asked for); it is now the signing identity, asked for in
 *  the diff. Nothing else. */
function expectAttestingWorkflow(src: string, name: string): void {
  expect(src, `${name}: the attest step, pinned by tag, subject = the tarball glob`)
    .toMatch(/^      - uses: actions\/attest-build-provenance@v4\n        id: attest\n(?:        if: .*\n)?        with:\n          subject-path: release-out\/ccrc-\*\.tar\.gz$/m);
  expect(src, `${name}: exactly the documented permission set`)
    .toMatch(/^    permissions:\n      contents: write\n      id-token: write\n      attestations: write(?!\n      [a-z-]+:)$/m);
  expect(src, `${name}: no other permission`).not.toMatch(/(packages|pull-requests|actions|deployments|issues):/);
}

/** A parsed step as written: every key it carries, each with its value, so
 *  an exact comparison reds on a key added or dropped while a comment stays
 *  free. A key this reader has no field for shows as itself and never
 *  compares equal. */
const STEP_FIELDS: Record<string, (s: WorkflowStep) => unknown> = {
  name: (s) => s.name, id: (s) => s.id, uses: (s) => s.uses, run: (s) => s.run,
  with: (s) => s.with, env: (s) => s.env, if: (s) => s.if,
};
const asWritten = (s: WorkflowStep): Record<string, unknown> =>
  Object.fromEntries(s.keys.map((k) => [k, STEP_FIELDS[k]?.(s) ?? `<the key ${k}>`]));
const jobNamed = (jobs: WorkflowJob[], id: string): WorkflowJob => {
  const j = jobs.find((x) => x.id === id);
  expect(j, `no job ${id}`).toBeDefined();
  return j!;
};
const stepUsing = (j: WorkflowJob, action: string): WorkflowStep[] =>
  j.steps.filter((s) => s.uses !== null && s.uses.replace(/@.*$/, '') === action);
const onlyStep = (steps: WorkflowStep[], what: string): WorkflowStep => {
  expect(steps, `exactly one ${what}`).toHaveLength(1);
  return steps[0]!;
};

const RECEIVE_LINE = 'bash deploy/release-main.sh receive --in "$RUNNER_TEMP/release-in" --tag "$CCRC_BUILD_TAG" --digest "$CCRC_BUILD_DIGEST" --out release-out';
const VERIFY_LINE = 'bash deploy/release-artifact.sh verify --tag "$GITHUB_REF_NAME" --digest "$CCRC_BUILD_DIGEST" --in "$RUNNER_TEMP/release-in" --out release-out';
// The decision check's step name and its one line (D-6658, renamed by D-6738:
// the check reads compare's own step output, not the job output).
const DECISION_NAME = 'Fail when the release decision did not reach compare\'s step output';
const DECISION_IF = "steps.compare.outputs.release != 'true' && steps.compare.outputs.release != 'false'";
const DECISION_LINE = 'echo "release-main.yml: the release decision did not reach compare\'s step output; failing rather than skipping a release; re-run all jobs" >&2; exit 1';

/** What differs between the two split workflows; everything else is held
 *  alike (D-6647, D-6653, D-6657). */
interface SplitShape {
  /** The expression the artifact is named by in the build job. */
  tagExpr: string;
  /** The download's artifact name. */
  downloadName: string;
  publishCheckout: Record<string, unknown>;
  check: Record<string, unknown>;
  record: Record<string, unknown>;
  outputs: Record<string, unknown>;
  /** The publish job's keys, as a set, and its job-level `if:` exactly
   *  (null: it carries none). */
  publishKeys: string[];
  publishIf: string | null;
  /** Every publish step that carries an `env:`, by name, with its whole
   *  env, values included. */
  publishEnv: Record<string, Record<string, unknown>>;
}

/** Both build jobs' keys, as a set (D-6727): no `continue-on-error`, no
 *  job-level `if:`, no `strategy`, nothing else. */
const BUILD_JOB_KEYS = ['outputs', 'permissions', 'runs-on', 'steps', 'timeout-minutes'];
/** Each publish action at its pinned version, in order (D-6726, D-6729):
 *  the checkout at `@v7`, the download at `@v8`, the attest at `@v4`. A
 *  version pin is a deliberate edit, so a future bump reds it again (D-6739:
 *  the pins name the majors #364 moved to). */
const PUBLISH_USES_PINNED = ['actions/checkout@v7', 'actions/download-artifact@v8', 'actions/attest-build-provenance@v4'];
/** The two values the publish steps are handed (D-6729). */
const GH_TOKEN_VALUE = '${{ github.token }}';
const BUNDLE_PATH_VALUE = '${{ steps.attest.outputs.bundle-path }}';

function splitRows(file: string, shape: SplitShape): void {
  const src = (): string => readFileSync(join(REPO, '.github', 'workflows', file), 'utf8');
  const jobs = (): WorkflowJob[] => workflowJobs(src());

  it(`W26-Y1: ${file}: the build job holds contents: read and nothing else; build has 30 minutes, publish 10`, () => {
    expect(src(), 'the four-space build permission block, nothing after it')
      .toMatch(/^    permissions:\n      contents: read(?!\n      [a-z-]+:)$/m);
    expect(jobNamed(jobs(), 'build').permissions).toEqual({ contents: 'read' });
    const raw = parse(src()) as { jobs: Record<string, Record<string, unknown>> };
    expect(raw.jobs.build?.['timeout-minutes']).toBe(30);
    expect(raw.jobs.publish?.['timeout-minutes']).toBe(10);
  });

  it(`W26-Y2: ${file}: each job's one checkout takes exactly its with: keys`, () => {
    const js = jobs();
    expect(onlyStep(stepUsing(jobNamed(js, 'build'), 'actions/checkout'), 'build checkout').with)
      .toEqual({ 'fetch-depth': 0, 'persist-credentials': false });
    expect(onlyStep(stepUsing(jobNamed(js, 'publish'), 'actions/checkout'), 'publish checkout').with)
      .toEqual(shape.publishCheckout);
  });

  it(`W26-Y3: ${file}: the hand-over is one artifact of exactly two files, downloaded outside the checkout`, () => {
    const js = jobs();
    expect(onlyStep(stepUsing(jobNamed(js, 'build'), 'actions/upload-artifact'), 'upload').with).toEqual({
      name: `release-${shape.tagExpr}`,
      path: `release-out/ccrc-${shape.tagExpr}.tar.gz\nrelease-out/SHA256SUMS\n`,
      'if-no-files-found': 'error',
      'retention-days': 7,
      'compression-level': 0,
    });
    expect(onlyStep(stepUsing(jobNamed(js, 'publish'), 'actions/download-artifact'), 'download').with).toEqual({
      name: shape.downloadName,
      path: '${{ runner.temp }}/release-in',
    });
  });

  it(`W26-Y4: ${file}: the check and the record step are exactly their shapes, and record is the build job's one step with that id`, () => {
    const js = jobs();
    const publish = jobNamed(js, 'publish');
    const check = onlyStep(publish.steps.filter((s) => s.run === shape.check.run), 'check step');
    expect(asWritten(check)).toEqual(shape.check);
    const records = js.flatMap((j) => j.steps.filter((s) => s.id === 'record').map((s) => [j.id, s] as const));
    expect(records.map(([j]) => j), 'exactly one step with id: record, in build').toEqual(['build']);
    expect(asWritten(records[0]![1])).toEqual(shape.record);
  });

  it(`W26-Y5: ${file}: the build job's outputs are exactly the ones publish reads`, () => {
    expect(jobNamed(jobs(), 'build').outputs).toEqual(shape.outputs);
  });

  // D-6727 (review 871's F10): parsed, so a quoted "if": or a key moved
  // anywhere in the job is seen; a build job that may fail and pass, run
  // conditionally or fan out is not the one verdict publish reads.
  it(`W26-Y7: ${file}: the build job's keys are exactly its five, and publish's job-level if: is exactly its own`, () => {
    const js = jobs();
    expect([...jobNamed(js, 'build').keys].sort()).toEqual(BUILD_JOB_KEYS);
    const publish = jobNamed(js, 'publish');
    expect([...publish.keys].sort()).toEqual([...shape.publishKeys].sort());
    expect(publish.if).toBe(shape.publishIf);
    expect(publish.keys.includes('if')).toBe(shape.publishIf !== null);
  });

  // D-6729 (F13): each publish action at its version, read from the parsed
  // step, so a SHA, a minor pin or a moved major is a red here.
  it(`W26-Y8: ${file}: the publish job uses exactly checkout@v7, download-artifact@v8 and attest-build-provenance@v4, in that order`, () => {
    expect(jobNamed(jobs(), 'publish').steps.flatMap((s) => (s.uses === null ? [] : [s.uses]))).toEqual(PUBLISH_USES_PINNED);
  });

  // D-6729 (F15): the values, parsed, so a changed value with the old line
  // kept as a comment is a red here.
  it(`W26-Y9: ${file}: every publish step's env:, values included, is exactly its own`, () => {
    const publish = jobNamed(jobs(), 'publish');
    expect(Object.fromEntries(publish.steps.filter((s) => s.keys.includes('env')).map((s) => [s.name, s.env]))).toEqual(shape.publishEnv);
  });
}

describe('release.yml: the thin workflow, pinned to the script', () => {
  const WORKFLOW = join(REPO, '.github', 'workflows', 'release.yml');
  const wf = (): string => readFileSync(WORKFLOW, 'utf8');

  it('triggers on v* tag pushes and on NOTHING else', () => {
    const src = wf();
    expect(src).toMatch(/^on:\n  push:\n    tags: \['v\*'\]$/m);
    for (const trigger of ['branches:', 'pull_request', 'schedule:', 'workflow_dispatch', 'workflow_call']) {
      expect(src, `release.yml must not also trigger on ${trigger}`).not.toContain(trigger);
    }
  });

  it('invokes build-release.sh and owns no second build path', () => {
    const src = wf();
    expect(src).toContain('bash deploy/build-release.sh --out release-out');
    expect(src, 'the YAML must not run npm itself').not.toMatch(/npm ci|npm run/);
    expect(src, 'the YAML must not invoke a compiler').not.toMatch(/\btsc\b|\bvite\b/);
  });

  it('attests the tarball after the build and before the publish, names the bundle, publishes a PRERELEASE with all three (design 2026-09-20 §4; D-3118)', () => {
    const src = wf();
    expectAttestingWorkflow(src, 'release.yml');
    // The attest step here carries no `if:` — release.yml's HEAD is always
    // freshly tagged (unlike release-main.yml's prepare/publish split), so
    // there is never a "nothing was built" case to skip (D-3122 is the
    // other file's problem).
    expect(src, 'release.yml: the attest step must carry no if:')
      .not.toMatch(/^      - uses: actions\/attest-build-provenance@v4\n        id: attest\n        if:/m);
    // D-3127: the guard before the copy — the tag that triggered this run,
    // the tarball build-release.sh actually named, and the bundle must all
    // agree, or a doubly-tagged HEAD ships a bundle no tarball matches.
    expect(src).toContain('[ -f "release-out/ccrc-$GITHUB_REF_NAME.tar.gz" ]');
    expect(src).toContain('cp -- "$CCRC_BUNDLE_PATH" "release-out/ccrc-$GITHUB_REF_NAME.tar.gz.sigstore.json"');
    expect(src).toContain('CCRC_BUNDLE_PATH: ${{ steps.attest.outputs.bundle-path }}');
    expect(src).toContain('gh release create "$GITHUB_REF_NAME" release-out/* --verify-tag --prerelease');
    expect(src).toContain('GH_TOKEN: ${{ github.token }}');
    // Located by the STEP LINE itself, not a bare substring a nearby comment
    // could also contain (the collision that forced Task 3's own comments to
    // be reworded around a literal-substring version of this same check).
    // Split (D-6653): the build job builds, records and uploads; the publish
    // job downloads, verifies, attests, names the bundle, writes the notes
    // and publishes, in that order.
    // A version pin is a deliberate edit, so a future bump reds it again
    // (D-6739: the pins name the majors #364 moved to).
    const at = (re: RegExp): number => src.search(re);
    const order = [
      at(/^        run: bash deploy\/build-release\.sh /m),
      at(/^        run: bash deploy\/release-artifact\.sh record /m),
      at(/^      - uses: actions\/upload-artifact@v7$/m),
      at(/^      - uses: actions\/download-artifact@v8$/m),
      at(/^        run: bash deploy\/release-artifact\.sh verify /m),
      at(/^      - uses: actions\/attest-build-provenance@v4$/m),
      at(/^      - name: Name the provenance bundle$/m),
      at(/^        run: \|\n          node deploy\/release-notes\.mjs /m),
      at(/^        run: gh release create /m),
    ];
    expect(order.every((i) => i > -1), `every step is present: ${order.join(',')}`).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  splitRows('release.yml', {
    tagExpr: '${{ github.ref_name }}',
    downloadName: 'release-${{ github.ref_name }}',
    // Nothing in its publish job pushes: gh release create uses GH_TOKEN (D-6653).
    publishCheckout: { 'fetch-depth': 0, 'persist-credentials': false },
    check: {
      name: "Check the build's artifact against its recorded digest",
      env: { CCRC_BUILD_DIGEST: '${{ needs.build.outputs.digest }}' },
      run: VERIFY_LINE,
    },
    record: {
      name: "Record the release files' digest",
      id: 'record',
      run: 'bash deploy/release-artifact.sh record --tag "$GITHUB_REF_NAME" --dir release-out',
    },
    outputs: { digest: '${{ steps.record.outputs.digest }}' },
    // No release decision, so no job-level if: (D-6658).
    publishKeys: ['needs', 'runs-on', 'timeout-minutes', 'permissions', 'steps'],
    publishIf: null,
    publishEnv: {
      "Check the build's artifact against its recorded digest": { CCRC_BUILD_DIGEST: '${{ needs.build.outputs.digest }}' },
      'Name the provenance bundle': { CCRC_BUNDLE_PATH: BUNDLE_PATH_VALUE },
      'Publish the GitHub Release': { GH_TOKEN: GH_TOKEN_VALUE },
    },
  });

  // D-6729 (review 871's F16): the trigger, parsed, exactly; the text row
  // above lists five events, and this one admits no other.
  const EXACT_TRIGGER = { push: { tags: ['v*'] } };
  const triggerOf = (src: string): unknown => (parse(src, { uniqueKeys: true }) as { on?: unknown }).on;

  it('W26-F1: release.yml\'s trigger, parsed, is exactly a push of v* tags', () => {
    expect(triggerOf(wf())).toEqual(EXACT_TRIGGER);
  });

  it('W26-F1: the parsed trigger sees each added event and each widening (the pin is not vacuous)', () => {
    const src = wf();
    const ON = "on:\n  push:\n    tags: ['v*']\n";
    expect(src.split(ON).length - 1, 'the trigger block is there once').toBe(1);
    const variants = [
      `${ON}  workflow_run:\n    workflows: [ci]\n    types: [completed]\n`,
      `${ON}  repository_dispatch:\n`,
      `${ON}  release:\n    types: [published]\n`,
      `${ON}  create:\n`,
      "on:\n  push:\n    tags: ['v*']\n    branches: [main]\n",
      "on:\n  push:\n    tags: ['v*', 'x*']\n",
    ];
    for (const v of variants) expect(triggerOf(src.replace(ON, v)), v).not.toEqual(EXACT_TRIGGER);
  });

  it('W26-Y6: release.yml has no release decision, so no decision check (D-6653, D-6658)', () => {
    const src = wf();
    expect(src).not.toContain(DECISION_IF);
    expect(workflowJobs(src).flatMap((j) => j.steps).filter((s) => s.name === DECISION_NAME)).toEqual([]);
  });
});

describe('release.yml: the release body is written by the notes script, through a file (D-5548)', () => {
  const WORKFLOW = join(REPO, '.github', 'workflows', 'release.yml');
  const wf = (): string => readFileSync(WORKFLOW, 'utf8');

  it('writes the notes after the attest step and before the publish, outside the publish glob', () => {
    const src = wf();
    const attest = src.search(/^      - uses: actions\/attest-build-provenance@v4$/m);
    // A `|` block, never the one-line form (D-5566): that line carries two
    // `: ` — `release.yml: could not` and the shell no-op `; : >` — and a
    // `: ` inside a PLAIN scalar is a mapping indicator, so either one alone
    // left release.yml unparseable.
    const notes = src.search(/^        run: \|\n          node deploy\/release-notes\.mjs --tag "\$GITHUB_REF_NAME" --out "\$RUNNER_TEMP\/release-notes\.txt"/m);
    const publish = src.search(/^        run: gh release create /m);
    expect(notes).toBeGreaterThan(attest);
    expect(publish).toBeGreaterThan(notes);
    expect(src).toContain('gh release create "$GITHUB_REF_NAME" release-out/* --verify-tag --prerelease --notes-file "$RUNNER_TEMP/release-notes.txt"');
    expect(src, 'the notes must not land in release-out/, which the publish globs as assets').not.toMatch(/--out "?release-out\/release-notes/);
  });

  it('a writer that fails publishes an empty body rather than failing the release', () => {
    expect(wf()).toMatch(/release-notes\.mjs [^\n]*\|\| \{ echo "::warning::[^\n]*"; : > "\$RUNNER_TEMP\/release-notes\.txt"; \}$/m);
  });
});

/** Every `run:` body of a workflow — the one-line form and the `|`/`>` block
 *  form, whose body is each following line indented deeper than the key. */
function runBodies(src: string): string[] {
  const lines = src.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)(?:- )?run:\s?(.*)$/.exec(lines[i] ?? '');
    if (m === null) continue;
    const indent = (m[1] ?? '').length;
    const value = m[2] ?? '';
    if (!/^[|>][-+]?$/.test(value.trim())) { out.push(value); continue; }
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const l = lines[j] ?? '';
      if (l.trim() !== '' && l.length - l.trimStart().length <= indent) break;
      body.push(l);
    }
    out.push(body.join('\n'));
  }
  return out;
}

describe('the release workflows never put an expression or commit text in a run: line (D-5548)', () => {
  // A `${{ … }}` inside `run:` is pasted into the script BEFORE the shell
  // parses it, so an expression carrying untrusted text (a commit message, a
  // PR title, `github.event.*`) is script injection. Every value a run: line
  // needs arrives through `env:` and is read as "$VAR"; commit text arrives
  // through a file the notes script writes. This holds all three release
  // workflows to that, the notes step included.
  it.each(['release.yml', 'release-main.yml', 'release-stable.yml'])('%s', (name) => {
    const src = readFileSync(join(REPO, '.github', 'workflows', name), 'utf8');
    const bodies = runBodies(src);
    expect(bodies.length, `${name}: the scan found no run: lines`).toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b, `${name}: an expression inside run:`).not.toContain('${{');
      expect(b, `${name}: run: reads github.event`).not.toMatch(/github\.event|head_commit|GITHUB_EVENT_PATH/);
      expect(b, `${name}: run: reads commit text itself`).not.toMatch(/\bgit\b[^\n]*\blog\b|--notes |-m "\$/);
    }
  });

  it('the scanner sees a planted expression (the guard is not vacuous)', () => {
    const planted = 'jobs:\n  x:\n    steps:\n      - run: echo "${{ github.event.head_commit.message }}"\n      - name: y\n        run: |\n          echo ok\n          echo "${{ github.event.pull_request.title }}"\n';
    const bodies = runBodies(planted);
    expect(bodies).toHaveLength(2);
    expect(bodies.every((b) => b.includes('${{'))).toBe(true);
  });
});

describe('release-main.yml: the thin main-push workflow, pinned to its script (spec 2026-09-18 §3, 2026-09-20 §4)', () => {
  const WORKFLOW = join(REPO, '.github', 'workflows', 'release-main.yml');
  const wf = (): string => readFileSync(WORKFLOW, 'utf8');

  it('serialises: one concurrency group, never cancelling an in-flight release', () => {
    expect(wf()).toMatch(/^concurrency:\n  group: release-main\n  cancel-in-progress: false$/m);
  });

  it('checks out at full depth — the tags it derives from must be present', () => {
    expect(wf()).toMatch(/fetch-depth: 0/);
  });

  it('runs prepare, compare, attests, then publish — the bundle path handed to the script, the publish job run only on an explicit release decision (D-3122, D-6499, D-6658)', () => {
    const src = wf();
    expectAttestingWorkflow(src, 'release-main.yml');
    expect(src).toContain('bash deploy/release-main.sh prepare --out release-out');
    expect(src).toContain('bash deploy/release-main.sh compare --out release-out');
    expect(src).toContain('bash deploy/release-main.sh publish --out release-out');
    expect(src).not.toContain('hashFiles');
    expect(src).toContain('CCRC_BUNDLE_PATH: ${{ steps.attest.outputs.bundle-path }}');
    expect(src).toContain('GH_TOKEN: ${{ github.token }}');
    const prepare = src.search(/^        run: bash deploy\/release-main\.sh prepare /m);
    const compare = src.search(/^        run: bash deploy\/release-main\.sh compare /m);
    const attest = src.search(/^      - uses: actions\/attest-build-provenance@v4$/m);
    const publish = src.search(/^        run: bash deploy\/release-main\.sh publish /m);
    expect(prepare).toBeGreaterThan(-1);
    expect(compare).toBeGreaterThan(prepare);
    expect(attest).toBeGreaterThan(compare);
    expect(publish).toBeGreaterThan(attest);
    expect(src, 'the YAML must not build').not.toMatch(/npm ci|npm run|build-release\.sh/);
    expect(src, 'the YAML must not publish — the script owns the publish and its cleanup').not.toMatch(/gh release/);
    // The decision gates the publish JOB (D-6658): a skip never starts it,
    // so it never mints a write token. The attest step carries no if: of
    // its own; the build job's record and upload carry the compare output.
    const jobs = workflowJobs(src);
    const build = jobNamed(jobs, 'build');
    const pub = jobNamed(jobs, 'publish');
    expect(onlyStep(stepUsing(pub, 'actions/attest-build-provenance'), 'attest step').keys).not.toContain('if');
    expect(src.match(/^    if: .*$/gm) ?? [], 'the publish job\'s if:, exactly, nothing appended').toEqual(["    if: needs.build.outputs.release == 'true'"]);
    expect(pub.if).toBe("needs.build.outputs.release == 'true'");
    expect(src.match(/^        if: steps\.compare\.outputs\.release == 'true'.*$/gm) ?? [], 'record and upload, each exactly the compare output')
      .toEqual(["        if: steps.compare.outputs.release == 'true'", "        if: steps.compare.outputs.release == 'true'"]);
    const record = onlyStep(build.steps.filter((s) => s.id === 'record'), 'record step');
    const upload = onlyStep(stepUsing(build, 'actions/upload-artifact'), 'upload step');
    expect(record.if).toBe("steps.compare.outputs.release == 'true'");
    expect(upload.if).toBe("steps.compare.outputs.release == 'true'");
  });

  // W25 (D-6397, D-6401, D-6499): every merge builds, then compare decides.
  // The `on:` block is read by onBlock (workflowTrigger.ts), which W25-T8 in
  // release-stable.test.ts shares.
  const EXACT_ON = [
    'on:',
    '  push:',
    '    branches: [main]',
    "    paths-ignore: ['docs/**', '*.md']",
  ];

  // W25 (D-6511, D-6513): the trigger is the operator's, spelled once.
  it('W25-F1: the trigger is push to main with paths-ignore of docs/** and *.md, no paths key and no other event', () => {
    expect(onBlock(wf())).toEqual(EXACT_ON);
  });

  it('W25-F1: the block reader sees each widening and addition (the pin is not vacuous)', () => {
    const wrap = (on: string[]): string => `name: x\n\n# note\n${on.join('\n')}\n\n# next\nconcurrency:\n  group: g\n`;
    expect(onBlock(wrap(EXACT_ON))).toEqual(EXACT_ON);
    const variants: string[][] = [
      EXACT_ON.slice(0, 3),
      EXACT_ON.map((l) => l.replace("'*.md'", "'**/*.md'")),
      EXACT_ON.map((l) => l.replace("'docs/**'", "'**/docs/**'")),
      [EXACT_ON[0], '  workflow_dispatch:', ...EXACT_ON.slice(1)],
      [...EXACT_ON.slice(0, 3), "    paths: ['ccd/**']", EXACT_ON[3]],
    ];
    for (const v of variants) expect(onBlock(wrap(v))).not.toEqual(EXACT_ON);
  });

  // W25-F2, by behaviour (D-6512): the trigger ignores docs/** and a root
  // *.md, so the tarball must hold no entry NAMED under docs/ and no root
  // Markdown entry. The real builder runs in a fixture that TRACKS a docs/
  // file and a root Markdown file, and the tarball it writes is listed; no
  // text of the script is parsed. It checks entry names only, not bytes: a
  // build that shipped docs bytes under another name would let the trigger
  // skip a docs-only merge that changes the tarball, and the next run's
  // compare would release it, so such a miss delays a release and never loses
  // one (review 846, ruling 6).
  it('W25-F2: the built tarball holds no entry under docs/ and no root Markdown file, though the repository tracks both', () => {
    const home = mkTmp('build-release-w25-f2-');
    const root = fixtureRepo(home, {
      tag: 'v1.2.3',
      files: { 'docs/x.md': '# a doc\n', 'docs/sub/y.txt': 'y\n', 'README.md': '# fixture readme\n', 'NOTES.md': 'notes\n' },
    });
    expect(git(root, 'ls-files', '--', 'docs/x.md', 'README.md').split('\n').sort(), 'the fixture tracks the files the build must leave out')
      .toEqual(['README.md', 'docs/x.md']);
    const out = join(home, 'out');
    const r = runRelease(root, home, ['--out', out]);
    expect(r.code, r.stderr).toBe(0);
    const t = spawnSync(TAR, ['-tzf', join(out, 'ccrc-v1.2.3.tar.gz')], { encoding: 'utf8' });
    expect(t.status, t.stderr).toBe(0);
    const entries = t.stdout.split('\n').filter((l) => l !== '');
    expect(entries.length, 'the listing is not empty').toBeGreaterThan(8);
    expect(entries.map((l) => l.replace(/^\.\//, '')), 'the listing is the real tarball').toContain('install.sh');
    expect(entries.filter((l) => /^(\.\/)?docs(\/|$)/.test(l)), 'an entry under docs/').toEqual([]);
    expect(entries.filter((l) => /^(\.\/)?[^/]+\.md$/.test(l)), 'a root Markdown entry').toEqual([]);
  });

  it('W25-Y2: the compare step holds the token for the base check and the download, and runs the second arm', () => {
    expect(wf()).toMatch(/^      - name: Compare the build with the newest release it contains\n        id: compare\n        env:\n          GH_TOKEN: \$\{\{ github\.token \}\}\n        run: bash deploy\/release-main\.sh compare --out release-out$/m);
  });

  it('W25-Y3: the steps run in one order — checkout, setup-node, prepare, compare, the decision check, record, upload, download, receive, attest, publish — and setup-node carries no condition', () => {
    const src = wf();
    // A version pin is a deliberate edit, so a future bump reds it again
    // (D-6739: the pins name the majors #364 moved to).
    const at = (re: RegExp): number => src.search(re);
    const order = [
      at(/^      - uses: actions\/checkout@v7$/m),
      at(/^      - uses: actions\/setup-node@v7$/m),
      at(/^        run: bash deploy\/release-main\.sh prepare /m),
      at(/^        run: bash deploy\/release-main\.sh compare /m),
      at(/^      - name: Fail when the release decision did not reach compare's step output$/m),
      at(/^        run: bash deploy\/release-artifact\.sh record /m),
      at(/^      - uses: actions\/upload-artifact@v7$/m),
      at(/^      - uses: actions\/download-artifact@v8$/m),
      at(/^        run: bash deploy\/release-main\.sh receive /m),
      at(/^      - uses: actions\/attest-build-provenance@v4$/m),
      at(/^        run: bash deploy\/release-main\.sh publish /m),
    ];
    expect(order.every((i) => i > -1), `every step is present: ${order.join(',')}`).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    const setup = src.indexOf('      - uses: actions/setup-node@v7\n');
    const setupBlock = src.slice(setup, src.indexOf('\n      - ', setup + 1));
    expect(setupBlock, 'setup-node runs on every merge').not.toMatch(/^\s+if:/m);
  });

  it('W25-Y4: GH_TOKEN reaches compare and publish only; the step that installs has no env, no expression, and nothing continues on error', () => {
    const src = wf();
    expect(src.match(/^\s+GH_TOKEN:/gm) ?? [], 'exactly two GH_TOKEN lines: compare and publish').toHaveLength(2);
    const stepBlock = (name: string): string => {
      const from = src.indexOf(`      - name: ${name}`);
      expect(from, `step ${name} is present`).toBeGreaterThan(-1);
      const rest = src.slice(from + 1);
      const next = rest.indexOf('\n      - ');
      return rest.slice(0, next === -1 ? undefined : next);
    };
    expect(stepBlock('Compare the build with the newest release it contains')).toContain('GH_TOKEN: ${{ github.token }}');
    expect(stepBlock('Push the tag and publish the prerelease')).toContain('GH_TOKEN: ${{ github.token }}');
    const prepare = stepBlock('Derive the next tag and build the candidate');
    expect(prepare).not.toContain('env:');
    expect(prepare).not.toContain('${{');
    expect(prepare).not.toContain('GH_TOKEN');
    expect(src).not.toContain('continue-on-error');
  });

  splitRows('release-main.yml', {
    tagExpr: '${{ steps.compare.outputs.tag }}',
    downloadName: 'release-${{ needs.build.outputs.tag }}',
    // The tag push needs the persisted credential (D-6647).
    publishCheckout: { 'fetch-depth': 0 },
    check: {
      name: "Check the build's artifact and tag it for this commit",
      env: { CCRC_BUILD_TAG: '${{ needs.build.outputs.tag }}', CCRC_BUILD_DIGEST: '${{ needs.build.outputs.digest }}' },
      run: RECEIVE_LINE,
    },
    record: {
      name: "Record the release files' digest",
      id: 'record',
      if: "steps.compare.outputs.release == 'true'",
      env: { CCRC_TAG: '${{ steps.compare.outputs.tag }}' },
      run: 'bash deploy/release-artifact.sh record --tag "$CCRC_TAG" --dir release-out',
    },
    outputs: {
      release: '${{ steps.compare.outputs.release }}',
      tag: '${{ steps.compare.outputs.tag }}',
      digest: '${{ steps.record.outputs.digest }}',
    },
    publishKeys: ['needs', 'if', 'runs-on', 'timeout-minutes', 'permissions', 'steps'],
    publishIf: "needs.build.outputs.release == 'true'",
    publishEnv: {
      "Check the build's artifact and tag it for this commit": {
        CCRC_BUILD_TAG: '${{ needs.build.outputs.tag }}', CCRC_BUILD_DIGEST: '${{ needs.build.outputs.digest }}',
      },
      'Push the tag and publish the prerelease': { GH_TOKEN: GH_TOKEN_VALUE, CCRC_BUNDLE_PATH: BUNDLE_PATH_VALUE },
    },
  });

  it('W26-Y6: a release decision that did not reach compare\'s step output fails the build job, right after compare (D-6658, D-6738)', () => {
    const src = wf();
    const build = jobNamed(workflowJobs(src), 'build');
    const compare = build.steps.findIndex((s) => s.id === 'compare');
    expect(compare).toBeGreaterThan(-1);
    const check = build.steps[compare + 1];
    expect(check, 'a step follows compare').toBeDefined();
    // A `|` block: the line carries `: `, which a plain scalar cannot.
    expect(asWritten(check!)).toEqual({
      name: DECISION_NAME,
      if: DECISION_IF,
      run: `${DECISION_LINE}\n`,
    });
    expect(src.split(DECISION_IF).length - 1, 'the decision check\'s if: is spelled once').toBe(1);
  });
});

describe('the release workflows key their npm cache on every lockfile the builder installs', () => {
  // setup-node's `cache-dependency-path` is the cache KEY: a lockfile the
  // builder installs from but the key omits is a package whose bump never
  // invalidates the cache. Not a correctness failure on its own (npm ci
  // verifies against the lockfile), but it is the same omission as PR #346's
  // release-lane blocker one file over — ui added to the build, forgotten
  // beside it — so it is DERIVED from the builder's own install lines rather
  // than listed here a third time.
  const installed = (): string[] => [...new Set(
    [...readFileSync(SCRIPT, 'utf8')
      .matchAll(/^\( cd "\$ROOT\/([a-z]+)"\s*&& npm ci\b/gm)].map((m) => m[1]!),
  )].sort();

  it('the builder\'s install scan is not vacuous', () => {
    expect(installed()).toEqual(expect.arrayContaining(['agent', 'pwa', 'server', 'ui']));
  });

  it.each(['release.yml', 'release-main.yml'])('%s lists each one', (name) => {
    const src = readFileSync(join(REPO, '.github', 'workflows', name), 'utf8');
    const block = /^ {10}cache-dependency-path: \|\n((?: {12}\S.*\n)+)/m.exec(src);
    expect(block, `${name}: no multi-line cache-dependency-path`).not.toBeNull();
    const keyed = block![1]!.split('\n').map((l) => l.trim()).filter(Boolean).sort();
    expect(keyed, `${name}: cache-dependency-path must name exactly the lockfiles build-release.sh installs from`)
      .toEqual(installed().map((p) => `${p}/package-lock.json`));
  });
});

describe('release-stable.yml: the thin promotion workflow (design 2026-09-20 §4)', () => {
  const WORKFLOW = join(REPO, '.github', 'workflows', 'release-stable.yml');
  const wf = (): string => readFileSync(WORKFLOW, 'utf8');
  /** One job's block: its two-space header through the line before the next. */
  const stableJob = (id: string): string => {
    const m = new RegExp(`^  ${id}:\\n((?:(?!  [A-Za-z][\\w-]*:\\n).*\\n?)*)`, 'm').exec(wf().split(/^jobs:$/m)[1] ?? '');
    expect(m, `release-stable.yml has no job \`${id}\``).not.toBeNull();
    return m![1];
  };

  it('triggers on stable pushes and on NOTHING else', () => {
    const src = wf();
    // Anchored to the block's own terminator (`concurrency:`), not just the
    // `branches:` line — a `repository_dispatch:`/`merge_group:` key added
    // after `branches: [stable]`, or a `paths:` filter under `push:`, would
    // stay green against a shorter pin.
    expect(src).toMatch(/^on:\n  push:\n    branches: \[stable\]\n\nconcurrency:$/m);
    for (const trigger of ['tags:', 'pull_request', 'schedule:', 'workflow_dispatch', 'workflow_call']) {
      expect(src, `release-stable.yml must not also trigger on ${trigger}`).not.toContain(trigger);
    }
  });

  it('serialises under its own group, never cancelling', () => {
    expect(wf()).toMatch(/^concurrency:\n  group: release-stable\n  cancel-in-progress: false$/m);
  });

  it('promote asks for contents: write and nothing else — it flips flags, it signs nothing; the gate reads runs only', () => {
    const src = wf();
    // The lookahead (as `expectAttestingWorkflow` above uses) forbids ANY
    // further permission line, not just the five named below — a
    // `deployments: write` added here would stay green against a bare
    // substring pin.
    expect(stableJob('promote')).toMatch(/^    permissions:\n      contents: write(?!\n      [a-z-]+:)$/m);
    expect(src).not.toMatch(/(id-token|attestations|packages|pull-requests):/);
    // design 2026-09-23 §8 (final review FR-1): the gate checks out the
    // module that judges the evidence (`contents: read`) and READS the
    // commit's workflow runs and their jobs (`actions: read`) — nothing
    // else. The called ci.yml gets what its jobs ask for — a called
    // workflow's jobs can never hold more than the calling job grants, and
    // select reads the trusted main artifacts and the same runs listing
    // (`actions: read`, ruling T4). `actions:` appears in `gate` and `full`
    // and nowhere else in this file; `checks:` nowhere — nothing reads
    // check runs any more.
    expect(stableJob('gate')).toMatch(/^    permissions:\n      contents: read\n      actions: read(?!\n      [a-z-]+:)$/m);
    expect(stableJob('full')).toMatch(/^    permissions:\n      contents: read\n      actions: read(?!\n      [a-z-]+:)$/m);
    expect(src.replace(stableJob('full'), '').replace(stableJob('gate'), ''), 'actions: outside gate and full').not.toMatch(/actions:/);
    expect(src, 'nothing reads check runs any more').not.toMatch(/checks:/);
    expect(src.match(/: write$/gm), 'one write grant in the whole file — promote\'s').toHaveLength(1);
  });

  it('checks out at full depth and invokes release-stable.sh — no build command, no gh release create', () => {
    const src = wf();
    // Line-anchored, not bare substrings: `release-stable.sh --force` (the
    // script refuses any argument) would satisfy a `.toContain`, and
    // `fetch-depth: 0`/`timeout-minutes: 10` could sit anywhere, including a
    // comment, without a line anchor.
    expect(src).toMatch(/^          fetch-depth: 0$/m);
    expect(src).toMatch(/^        run: bash deploy\/release-stable\.sh$/m);
    expect(src).toContain('GH_TOKEN: ${{ github.token }}');
    expect(src).not.toMatch(/npm ci|npm run|build-release\.sh|release-main\.sh|gh release|setup-node|attest/);
    expect(stableJob('promote')).toMatch(/^    timeout-minutes: 10$/m);
  });

  // ── the stable gate (design 2026-09-23 §8) ────────────────────────────────
  // A push to `stable` promotes only a commit the FULL suite passed on: either
  // a green `full-suite` job on it from a trusted run (the daily run, a manual
  // full run, an earlier gate — main-artifact.mjs's green-full-suite), or a
  // full run this workflow starts by calling
  // ci.yml. The gate cannot live in a ruleset — checks from scheduled and
  // manually dispatched runs do not satisfy one.
  it('has exactly three jobs, in order: gate, full, promote', () => {
    const ids = [...(wf().split(/^jobs:$/m)[1] ?? '').matchAll(/^  ([A-Za-z][\w-]*):$/gm)].map((m) => m[1]);
    expect(ids).toEqual(['gate', 'full', 'promote']);
  });

  // The evidence is a RUN spec §8 names, judged by main-artifact.mjs (final
  // review FR-1) — not a check run's name, which a pull_request run's checks
  // on the same head sha also carry while that run tested the merge ref.
  // Which runs count is unit-tested in ci-main-artifact.test.ts; here, that
  // the gate asks that module, and what it does with the answer.
  it('gate checks out the tree and asks main-artifact.mjs green-full-suite about the pushed commit', () => {
    const g = stableJob('gate');
    expect(g).toMatch(/^    timeout-minutes: 5$/m);
    expect(g).toMatch(/^      found: \$\{\{ steps\.look\.outputs\.found \}\}$/m);
    const gateSteps = g.split(/^(?= {6}- )/m).filter((p) => /^ {6}- /.test(p));
    // A version pin is a deliberate edit, so a future bump reds it again
    // (D-6739: the pins name the majors #364 moved to).
    expect(gateSteps.map((st) => /^ {6}- (?:name: (.*)|uses: (.*))$/m.exec(st)?.slice(1).find(Boolean))).toEqual([
      'actions/checkout@v7', 'Look for a green full-suite on this commit',
    ]);
    const look = gateSteps[1];
    expect(look).toMatch(/^ {8}id: look$/m);
    expect(look).toMatch(/^ {8}env:\n {10}GITHUB_TOKEN: \$\{\{ github\.token \}\}\n {10}REPO: \$\{\{ github\.repository \}\}\n {10}REPO_ID: \$\{\{ github\.repository_id \}\}\n {10}SHA: \$\{\{ github\.sha \}\}\n {8}run: \|$/m);
    expect(look, 'no shell override: the runner default is `bash -e`, which fails the step on a failed CLI').not.toMatch(/shell:|continue-on-error/);
    expect(wf(), 'the check-run matcher is gone').not.toMatch(/--jq|check-runs/);
  });

  // Pinned by EXECUTION, not by regex (round-1 fix, F12-1): a text pin of a
  // shell branch binds its spelling, not its effect. So the `look` step's own
  // script is extracted and run for real under GitHub's default `run:` shell
  // (`bash --noprofile --norc -e {0}` on ubuntu — NOT `-o pipefail`), with a
  // fake `node` on PATH that logs its argv and answers per case.
  it('the look step DECIDES found by running it: found=true -> true, found=false -> false, a failed or silent CLI -> the step fails and found is never written', () => {
    const script = ((): string => {
      const src = stableJob('gate');
      const lines = src.split('\n');
      const at = lines.findIndex((l) => /^\s*run: \|$/.test(l));
      expect(at, 'gate has no `run: |` step').toBeGreaterThan(-1);
      const base = lines[at].match(/^ */)![0].length + 2;
      const body: string[] = [];
      for (const l of lines.slice(at + 1)) {
        if (l !== '' && !l.startsWith(' '.repeat(base))) break;
        body.push(l.slice(base));
      }
      return body.join('\n').trimEnd() + '\n';
    })();

    const SHA = 'a'.repeat(40);
    /** Runs the extracted `look` script for real, with a fake `node` on PATH
     *  that logs its argv to `node.log` and then runs `nodeBehavior`. */
    const run = (nodeBehavior: string): { status: number | null, output: string, nodeLog: string } => {
      const dir = mkTmp('release-stable-gate-');
      const scriptFile = join(dir, 'look.sh');
      writeFileSync(scriptFile, script);
      const out = join(dir, 'out');
      writeFileSync(out, '');
      const binDir = join(dir, 'bin');
      mkdirSync(binDir);
      const nodeLog = join(dir, 'node.log');
      writeFileSync(nodeLog, '');
      writeFileSync(join(binDir, 'node'), `#!/bin/sh\necho "$*" >> "${nodeLog}"\n${nodeBehavior}\n`);
      chmodSync(join(binDir, 'node'), 0o755);
      // A poison, so a regression back to `gh` can never reach the host's own (token-carrying) gh.
      writeFileSync(join(binDir, 'gh'), '#!/bin/sh\necho "gh must not run here" >&2\nexit 97\n');
      chmodSync(join(binDir, 'gh'), 0o755);
      const r = spawnSync(BASH, ['--noprofile', '--norc', '-e', scriptFile], {
        env: { PATH: `${binDir}:${process.env.PATH ?? ''}`, GITHUB_OUTPUT: out, REPO: 'o/r', REPO_ID: '1001', SHA },
        encoding: 'utf8',
      });
      return { status: r.status, output: readFileSync(out, 'utf8'), nodeLog: readFileSync(nodeLog, 'utf8') };
    };

    // (1) the module finds a green full-suite -> found=true, and it asked the right question.
    const found = run('echo found=true');
    expect(found.status).toBe(0);
    expect(found.output).toBe('found=true\n');
    expect(found.nodeLog).toBe(`.github/ci/main-artifact.mjs green-full-suite --repo o/r --repo-id 1001 --sha ${SHA}\n`);

    // (2) it answers, and finds nothing -> found=false.
    const none = run('echo found=false');
    expect(none.status).toBe(0);
    expect(none.output).toBe('found=false\n');

    // (3) the module fails (an API error, a malformed answer) -> the step
    // fails, and promotes nothing: a failed gate must never assert
    // found=false (that would run `full` needlessly) or found=true (that
    // would promote unproven).
    const failed = run('echo "HTTP 502" >&2; exit 1');
    expect(failed.status).not.toBe(0);
    expect(failed.output).not.toMatch(/found=/);

    // (4) it exits 0 but answers nothing -> the step fails too, loudly,
    // instead of leaving `found` empty (which would skip both `full` and
    // `promote` with a green gate).
    const silent = run('exit 0');
    expect(silent.status).not.toBe(0);
    expect(silent.output).not.toMatch(/found=/);

    // (5) an answer followed by a failure is a failure: the CLI's exit code
    // is read, not only its output (an `|| true` on that line stays green
    // on every case above, measured).
    const late = run('echo found=true; exit 1');
    expect(late.status).not.toBe(0);
  });

  it('full runs only when the gate found nothing, and runs ci.yml itself in full mode', () => {
    const f = stableJob('full');
    expect(f).toMatch(/^    needs: gate$/m);
    expect(f).toMatch(/^    if: needs\.gate\.outputs\.found == 'false'$/m);
    expect(f).toMatch(/^    uses: \.\/\.github\/workflows\/ci\.yml\n    with:\n      mode: full$/m);
    // The callee's side of the contract: ci.yml is callable, and says green.
    const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toMatch(/^  workflow_call:$/m);
    expect(ci).toMatch(/^ {6}verdict:\n(?: {8}.*\n)*? {8}value: \$\{\{ jobs\.full-suite\.outputs\.verdict \}\}$/m);
  });

  it('promote cannot run unless the gate found a green full-suite or the called full run said green', () => {
    const p = stableJob('promote');
    expect(p).toMatch(/^    needs: \[gate, full\]$/m);
    // `always()` because `full` is SKIPPED on the found path, and a skipped
    // need skips its dependants — then the result checks are what gate it.
    // `verdict == 'green'`, not just `result == 'success'`: a called run in
    // which full-suite never ran (select answered anything but `full`) is a
    // SUCCESSFUL run that proved nothing.
    expect(p).toMatch(/^    if: always\(\) && needs\.gate\.result == 'success' && \(needs\.gate\.outputs\.found == 'true' \|\| \(needs\.full\.result == 'success' && needs\.full\.outputs\.verdict == 'green'\)\)$/m);
  });
});

describe('build-release.sh: source pins', () => {
  // A casual edit that drops one of these flags makes every artifact's bytes
  // depend on who built it and when — silently, since nothing else fails.
  it('the tar invocation carries the reproducibility flags, on one line', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    // The tar BINARY is now chosen at runtime — GNU tar by name, or `gtar`,
    // and a refusal when neither is there, because BSD tar has none of these
    // four options and would emit a different archive for identical input.
    // What this pin is about is unchanged: all four flags, together, on the
    // line that builds the artifact.
    expect(src).toMatch(/"\$BR_TAR" --sort=name --mtime=@0 --owner=0 --group=0 /);
    // …and the refusal really is a refusal, not a fallback that quietly
    // produces an unreproducible tarball.
    expect(src).toMatch(/GNU tar is required to build a release/);
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
