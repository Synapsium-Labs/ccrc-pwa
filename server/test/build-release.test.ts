// `deploy/build-release.sh` — the release pipeline's TESTABLE CORE (stage 4,
// spec §2). CI merely invokes it; everything a release artifact promises is
// promised HERE, so this file measures the script directly, against a fixture
// git repository, with npm stubbed out.
//
// ── THE FIXTURE IS A REAL GIT REPOSITORY (the `gitInit` idiom) ────────────
// The script's two refusals are `git status --porcelain` and `git tag
// --points-at HEAD`, and its staging step is `git archive HEAD` — all three
// are questions only git itself can answer, so the fixture is a real
// one-commit repo (ccrc-install.test.ts:510's idiom, copied here rather than
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
 *  `gitInit` idiom (ccrc-install.test.ts:510), plus this file's one addition:
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
};

/** `<home>/repo` — one commit holding `FIXTURE_FILES` plus the real script,
 *  optionally tagged. Returns the repo root. */
function fixtureRepo(home: string, opts: { tag?: string; files?: Record<string, string> } = {}): string {
  const root = join(home, 'repo');
  for (const [rel, body] of Object.entries({ ...FIXTURE_FILES, ...(opts.files ?? {}) })) {
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
  'server/scripts/fix-node-pty-helper.mjs',
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
    const build = src.search(/^        run: bash deploy\/build-release\.sh /m);
    const attest = src.search(/^      - uses: actions\/attest-build-provenance@v4$/m);
    const publish = src.search(/^        run: gh release create /m);
    expect(build).toBeGreaterThan(-1);
    expect(attest).toBeGreaterThan(build);
    expect(publish).toBeGreaterThan(attest);
  });
});

describe('release-main.yml: the thin main-push workflow, pinned to its script (spec 2026-09-18 §3, 2026-09-20 §4)', () => {
  const WORKFLOW = join(REPO, '.github', 'workflows', 'release-main.yml');
  const wf = (): string => readFileSync(WORKFLOW, 'utf8');

  it('triggers on main pushes and on NOTHING else', () => {
    const src = wf();
    expect(src).toMatch(/^on:\n  push:\n    branches: \[main\]$/m);
    for (const trigger of ['tags:', 'pull_request', 'schedule:', 'workflow_dispatch', 'workflow_call']) {
      expect(src, `release-main.yml must not also trigger on ${trigger}`).not.toContain(trigger);
    }
  });

  it('serialises: one concurrency group, never cancelling an in-flight release', () => {
    expect(wf()).toMatch(/^concurrency:\n  group: release-main\n  cancel-in-progress: false$/m);
  });

  it('checks out at full depth — the tags it derives from must be present', () => {
    expect(wf()).toMatch(/fetch-depth: 0/);
  });

  it('runs prepare, attests, then publish — the bundle path handed to the script, the attest step skipped when nothing was built (D-3122)', () => {
    const src = wf();
    expectAttestingWorkflow(src, 'release-main.yml');
    expect(src).toContain('bash deploy/release-main.sh prepare --out release-out');
    expect(src).toContain('bash deploy/release-main.sh publish --out release-out');
    expect(src).toContain("if: hashFiles('release-out/ccrc-*.tar.gz') != ''");
    expect(src).toContain('CCRC_BUNDLE_PATH: ${{ steps.attest.outputs.bundle-path }}');
    expect(src).toContain('GH_TOKEN: ${{ github.token }}');
    const prepare = src.search(/^        run: bash deploy\/release-main\.sh prepare /m);
    const attest = src.search(/^      - uses: actions\/attest-build-provenance@v4$/m);
    const publish = src.search(/^        run: bash deploy\/release-main\.sh publish /m);
    expect(prepare).toBeGreaterThan(-1);
    expect(attest).toBeGreaterThan(prepare);
    expect(publish).toBeGreaterThan(attest);
    expect(src, 'the YAML must not build').not.toMatch(/npm ci|npm run|build-release\.sh/);
    expect(src, 'the YAML must not publish — the script owns the publish and its cleanup').not.toMatch(/gh release/);
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
  // a green `full-suite` check run already on it (the daily run, a manual full
  // run, an earlier gate), or a full run this workflow starts by calling
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
    expect(gateSteps.map((st) => /^ {6}- (?:name: (.*)|uses: (.*))$/m.exec(st)?.slice(1).find(Boolean))).toEqual([
      'actions/checkout@v4', 'Look for a green full-suite on this commit',
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
