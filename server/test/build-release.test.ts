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
describe('release.yml: the thin workflow, pinned to the script', () => {
  const WORKFLOW = join(REPO, '.github', 'workflows', 'release.yml');
  const wf = (): string => readFileSync(WORKFLOW, 'utf8');

  it('triggers on v* tag pushes and on NOTHING else', () => {
    const src = wf();
    expect(src).toMatch(/^on:\n  push:\n    tags: \['v\*'\]$/m);
    // The full trigger vocabulary that would widen when a release fires:
    // ci.yml's own workflow_dispatch escape hatch is deliberately absent —
    // a re-cut is `git tag -f` + push, so the artifact always matches a tag.
    for (const trigger of ['branches:', 'pull_request', 'schedule:', 'workflow_dispatch', 'workflow_call']) {
      expect(src, `release.yml must not also trigger on ${trigger}`).not.toContain(trigger);
    }
  });

  it('invokes build-release.sh and owns no second build path', () => {
    const src = wf();
    expect(src).toContain('bash deploy/build-release.sh --out release-out');
    // The script runs `npm ci`/`npm run build` itself, per package. A copy of
    // either in the YAML is a second build path — the drift this pin forbids.
    expect(src, 'the YAML must not run npm itself').not.toMatch(/npm ci|npm run/);
    expect(src, 'the YAML must not invoke a compiler').not.toMatch(/\btsc\b|\bvite\b/);
  });

  it('uploads both artifacts to the tag\'s release, token from the workflow', () => {
    const src = wf();
    // `release-out/*` is the script's whole --out dir: ccrc-<tag>.tar.gz AND
    // SHA256SUMS — naming one file here would silently drop the other.
    expect(src).toContain('gh release create "$GITHUB_REF_NAME" release-out/* --verify-tag');
    expect(src).toContain('GH_TOKEN: ${{ github.token }}');
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
