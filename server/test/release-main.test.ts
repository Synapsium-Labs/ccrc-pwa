// deploy/release-main.sh — spec §3. On a clean, untagged HEAD: derive the next
// patch tag from the highest existing vX.Y.Z, push it to origin, build with
// build-release.sh, publish with gh — and delete the pushed tag if the publish
// never completes. Fixture: a repo with a BARE origin (so `git push` is real
// and its effect is measurable), the real build-release.sh copied in (its own
// suite proves it), a recording npm that fabricates dists, a recording gh
// whose exit code the test chooses. Never touches the network: curl is
// poisoned, gh is the stub.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SCRIPT = join(REPO, 'deploy', 'release-main.sh');
const BUILDER = join(REPO, 'deploy', 'build-release.sh');
const NOTES = join(REPO, 'deploy', 'release-notes.mjs');
const SCOPE = join(REPO, 'deploy', 'release-scope.mjs');
/** The real engines object, read at test time: the fixture never spells a version (D-6403). */
const REAL_ENGINES = (JSON.parse(readFileSync(join(REPO, 'server', 'package.json'), 'utf8')) as { engines: Record<string, string> }).engines;

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};

function git(root: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', root, ...args], { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** The smallest tree build-release.sh's `git archive` pathspec accepts.
 *  `.gitignore` mirrors the real repo's (node_modules, the three dist dirs) —
 *  without it, a build's untracked output would read as a dirty tree on a
 *  second `prepare` against the same checkout, exactly as it would NOT in
 *  the real, gitignored repo. */
const FILES: Record<string, string> = {
  '.gitignore': 'node_modules\nserver/dist/\nserver/dist-pwa/\nagent/dist/\n',
  'install.sh': '#!/usr/bin/env bash\necho fixture\n',
  'ccd/ccrc': '#!/usr/bin/env bash\necho fixture\n',
  'shared/package.json': '{ "type": "module" }\n',
  'deploy/ccrc.service': '[Unit]\nDescription=fixture\n',
  'server/package-lock.json': '{}\n',
  'agent/package.json': '{ "name": "a" }\n', 'agent/package-lock.json': '{}\n',
  'pwa/package.json': '{ "name": "p" }\n', 'pwa/package-lock.json': '{}\n',
  // build-release.sh installs ui before pwa (pwa builds @ccrc/ui from source).
  'ui/package.json': '{ "name": "u" }\n', 'ui/package-lock.json': '{}\n',
};

/** `<home>/repo` with one commit, `<home>/origin.git` bare and added as
 *  `origin`, optional existing tags (pushed to origin too, as real ones are).
 *  `merge` writes the change 'the merge under release' carries (default: a
 *  shipped change to ccd/ccrc, so every release row still releases); `after`
 *  adds a later commit; `floor` replaces server/package.json's engines.node
 *  (null: no engines); `scope` is the helper every tag carries (false: none,
 *  a string: that text) and `headScope` overwrites it in the merge only. */
function fixture(home: string, opts: {
  tags?: string[]; tagHead?: string; notes?: boolean;
  merge?: (root: string) => void; after?: (root: string) => void;
  floor?: string | null; scope?: false | string; headScope?: string;
} = {}): string {
  const root = join(home, 'repo');
  for (const [rel, body] of Object.entries(FILES)) {
    mkdirSync(path.dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body, { mode: rel.endsWith('.sh') || rel === 'ccd/ccrc' ? 0o755 : 0o644 });
  }
  const engines = opts.floor === null ? {} : { ...REAL_ENGINES, ...(opts.floor === undefined ? {} : { node: opts.floor }) };
  writeFileSync(join(root, 'server', 'package.json'), `${JSON.stringify({ name: 's', engines }, null, 2)}\n`);
  copyFileSync(BUILDER, join(root, 'deploy', 'build-release.sh'));
  copyFileSync(SCRIPT, join(root, 'deploy', 'release-main.sh'));
  // D-5548: the notes writer rides beside the script, as in the real tree;
  // `notes: false` leaves it out, the shape of a writer that fails.
  if (opts.notes !== false) copyFileSync(NOTES, join(root, 'deploy', 'release-notes.mjs'));
  // D-6392: so does the scope helper, in every tag; `scope` changes that.
  if (opts.scope === undefined) copyFileSync(SCOPE, join(root, 'deploy', 'release-scope.mjs'));
  else if (opts.scope !== false) writeFileSync(join(root, 'deploy', 'release-scope.mjs'), opts.scope);
  chmodSync(join(root, 'deploy', 'build-release.sh'), 0o755);
  chmodSync(join(root, 'deploy', 'release-main.sh'), 0o755);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'first');
  for (const t of opts.tags ?? []) {
    // Each older tag sits on its own earlier commit, so HEAD stays untagged.
    git(root, 'commit', '-q', '--allow-empty', '-m', `release ${t}`);
    git(root, 'tag', t);
  }
  (opts.merge ?? ((r: string) => {
    writeFileSync(join(r, 'ccd', 'ccrc'), '#!/usr/bin/env bash\necho the merge\n', { mode: 0o755 });
  }))(root);
  if (opts.headScope !== undefined) writeFileSync(join(root, 'deploy', 'release-scope.mjs'), opts.headScope);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'the merge under release');
  if (opts.after !== undefined) {
    opts.after(root);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'a docs merge after it');
  }
  if (opts.tagHead !== undefined) git(root, 'tag', opts.tagHead);
  const origin = join(home, 'origin.git');
  spawnSync('git', ['init', '-q', '--bare', origin], { env: { ...process.env, ...GIT_ENV } });
  // An `update` hook records every ref pushed to origin — including a
  // transient push that a later refusal unwinds — so "no push happened at
  // all" is OBSERVABLE from outside the process (R4: `git tag`/`push`
  // succeeding and then being cleaned up is not the same as never running).
  // Hooks run with the pusher's environment, so HOME is the fixture home.
  mkdirSync(join(origin, 'hooks'), { recursive: true });
  writeFileSync(join(origin, 'hooks', 'update'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$1" >> "$HOME/origin-pushes"',
    'exit 0',
  ].join('\n'), { mode: 0o755 });
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main', '--tags');
  // fixture()'s own setup push fires the hook too (main, and any pre-existing
  // tags); clear that so `origin-pushes` reflects only what `run()` does.
  rmSync(join(home, 'origin-pushes'), { force: true });
  return root;
}

interface GhView { view?: string; viewExit?: number }
function plantBin(home: string, ghExit = 0, ghView: GhView = {}): string {
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'npm'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$PWD $*" >> "$HOME/npm-argv"',
    'if [ "$1" = "run" ] && [ "$2" = "build" ]; then case "$PWD" in',
    '  */server) mkdir -p dist/server/src; echo "// s" > dist/server/src/index.js ;;',
    '  */pwa) mkdir -p ../server/dist-pwa; echo "<title>p</title>" > ../server/dist-pwa/index.html ;;',
    '  */agent) mkdir -p dist/agent/src; echo "// a" > dist/agent/src/index.js ;;',
    'esac; fi; exit 0',
  ].join('\n'), { mode: 0o755 });
  // gh RECORDS its argv and, at call time, records which tags origin holds —
  // the ordering pin (tag pushed BEFORE publish) reads that record.
  writeFileSync(join(bin, 'gh'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/gh-argv"',
    'git -C "$HOME/origin.git" tag > "$HOME/origin-tags-at-gh"',
    // `release view` is decide's published-base check: it records the token it
    // was given and answers from files the test plants (default: false, rc 0).
    'if [ "$1 $2" = "release view" ]; then',
    '  printf \'GH_TOKEN=%s\\n\' "${GH_TOKEN:-unset}" >> "$HOME/gh-env"',
    '  if [ -f "$HOME/gh-view-exit" ]; then exit "$(cat "$HOME/gh-view-exit")"; fi',
    '  if [ -f "$HOME/gh-view" ]; then cat "$HOME/gh-view"; else echo false; fi',
    '  exit 0',
    'fi',
    `exit ${ghExit}`,
  ].join('\n'), { mode: 0o755 });
  rmSync(join(home, 'gh-view'), { force: true });
  rmSync(join(home, 'gh-view-exit'), { force: true });
  if (ghView.view !== undefined) writeFileSync(join(home, 'gh-view'), `${ghView.view}\n`);
  if (ghView.viewExit !== undefined) writeFileSync(join(home, 'gh-view-exit'), `${ghView.viewExit}\n`);
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho "release-main tests never reach the network" >&2\nexit 97\n', { mode: 0o755 });
  return bin;
}

interface Result { code: number; stdout: string; stderr: string }
function run(root: string, home: string, args: string[] = [], ghExit = 0,
  extraEnv: NodeJS.ProcessEnv = {}, ghView: GhView = {}): Result {
  const bin = plantBin(home, ghExit, ghView);
  // The summary and output files are the job's, not the fixture's: a CI test
  // job would otherwise append fixture lines to its own (D-6395).
  const r = spawnSync('bash', [join(root, 'deploy', 'release-main.sh'), ...args],
    { env: { ...process.env, ...GIT_ENV, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}`, GITHUB_STEP_SUMMARY: '', GITHUB_OUTPUT: '', ...extraEnv }, cwd: root, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
/** decide, then prepare, into one out directory — the workflow's order. */
function decideThenPrepare(root: string, home: string, out: string, gh: GhView = {}, env: NodeJS.ProcessEnv = {}): { d: Result; p: Result } {
  const d = run(root, home, ['decide', '--out', out], 0, env, gh);
  const p = run(root, home, ['prepare', '--out', out], 0, env, gh);
  return { d, p };
}
/** What the attest step leaves behind: any file — the script copies it, never reads it. */
function plantBundle(home: string): string {
  const p = join(home, 'attest-bundle.json');
  writeFileSync(p, '{"fixture":"sigstore bundle"}\n');
  return p;
}
const originTags = (home: string): string[] =>
  spawnSync('git', ['-C', join(home, 'origin.git'), 'tag'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l !== '');

/** The decision lines (D-6395), spelled once for the rows below. */
const L = {
  skip: (hi: string, n: number, next: string): string =>
    `release-main.sh: no release for this merge — nothing that ships changed since ${hi} (paths changed: ${n}, each on release-scope.mjs's NOT_SHIPPED list); nothing was tagged or built, and the next merge that changes the build takes ${next}`,
  changed: (next: string, hi: string, n: number, first: string): string =>
    `release-main.sh: releasing ${next} — what ships changed since ${hi} (shipped paths changed: ${n}; first: ${first})`,
  changedByBase: (next: string, hi: string, n: number, first: string): string =>
    `release-main.sh: releasing ${next} — what ships changed since ${hi}, by ${hi}'s own release-scope.mjs; HEAD's answered unchanged (shipped paths changed: ${n}; first: ${first})`,
  unmeasured: (next: string, hi: string, why: string): string =>
    `release-main.sh: releasing ${next} — could not measure what changed since ${hi} (${why}); a merge whose change cannot be measured is released`,
  first: (next: string): string => `release-main.sh: releasing ${next} — no earlier release tag to compare against`,
  unpublished: (next: string, hi: string, why: string): string =>
    `release-main.sh: releasing ${next} — ${hi} is not a published release (${why}), so nothing is measured against it`,
  noDecision: (next: string, file: string): string =>
    `release-main.sh: releasing ${next} — no decision was recorded in ${file} (release-main.sh decide did not run); a merge whose change cannot be measured is released`,
  malformed: (next: string, file: string, hi: string): string =>
    `release-main.sh: releasing ${next} — ${file} records neither 'release' nor 'same-as ${hi}'; a merge whose change cannot be measured is released`,
};

describe('release-main.sh: refusals before anything is written', () => {
  it('refuses a dirty tree — no tag, no npm, no gh', () => {
    const home = mkTmp('ccrc-relmain-dirty-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    writeFileSync(join(root, 'straggler.txt'), 'untracked\n');
    const r = run(root, home, ['prepare']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/refusing a dirty tree/);
    expect(originTags(home)).toEqual(['v0.0.1']);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    // No transient tag/push either — the refusal must fire before any push
    // reaches origin at all, not merely before one that sticks (R4).
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  it('an unknown argument is a usage error, exit 2', () => {
    const home = mkTmp('ccrc-relmain-usage-');
    const root = fixture(home);
    const r = run(root, home, ['prepare', '--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/unknown argument: --bogus/);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('a HEAD that already carries a vX.Y.Z tag exits 0 and does nothing — release.yml owns it', () => {
    const home = mkTmp('ccrc-relmain-tagged-');
    const root = fixture(home, { tags: ['v0.0.1'], tagHead: 'v1.0.0' });
    const r = run(root, home, ['prepare']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/already tagged v1\.0\.0; release\.yml owns it/);
    expect(originTags(home).sort()).toEqual(['v0.0.1', 'v1.0.0']);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
  });

  it('refuses when origin already holds the derived tag — a tag-stale checkout (R5)', () => {
    const home = mkTmp('ccrc-relmain-stale-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    // Origin already has v0.0.2 — created directly in the bare repo, NOT in
    // the working tree, so the local checkout's tags stay behind origin's,
    // exactly the "tag-stale checkout" this guard exists for.
    const originSha = git(root, 'rev-parse', 'HEAD');
    spawnSync('git', ['-C', join(home, 'origin.git'), 'tag', 'v0.0.2', originSha], { env: { ...process.env, ...GIT_ENV } });
    const r = run(root, home, ['prepare', '--out', join(home, 'out')]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/origin already holds v0\.0\.2/);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });
});

describe('release-main.sh: prepare (tag locally, build) then publish (push, three artifacts, --prerelease)', () => {
  it.each([
    [['v0.0.1'], 'v0.0.2'],
    [['v1.9.9', 'v1.9.10'], 'v1.9.11'],
    [['v0.0.1', 'vnext', 'v1.2', 'v1.2.3-rc1'], 'v0.0.2'],
    [[], 'v0.0.1'],
  ])('highest %j → next %s: prepare tags locally, publish pushes and publishes', (tags, next) => {
    const home = mkTmp('ccrc-relmain-derive-');
    const root = fixture(home, { tags });
    const out = join(home, 'out');
    const prev = tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).pop();
    // decide runs first, as the workflow does; the merge ships ccd/ccrc, so it releases (W25).
    const d = run(root, home, ['decide', '--out', out]);
    expect(d.code, `stderr: ${d.stderr}\nstdout: ${d.stdout}`).toBe(0);
    expect(d.stdout).toContain(prev === undefined ? L.first(next) : L.changed(next, prev, 1, '"ccd/ccrc"'));
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code, `stderr: ${p.stderr}\nstdout: ${p.stdout}`).toBe(0);
    // Prepared: the tag is local, origin has NOT seen it, nothing was published.
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe(next);
    expect(originTags(home)).not.toContain(next);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe(`built true\ntag ${next}\n`);
    expect(existsSync(join(out, `ccrc-${next}.tar.gz`))).toBe(true);
    const bundle = plantBundle(home);
    const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: bundle });
    expect(q.code, `stderr: ${q.stderr}\nstdout: ${q.stdout}`).toBe(0);
    expect(originTags(home)).toContain(next);
    expect(readFileSync(join(home, 'origin-pushes'), 'utf8')).toBe(`refs/tags/${next}\n`);
    // All three artifacts NAMED, the flag trailing (the stub records `$*` as one line).
    expect(readFileSync(join(home, 'gh-argv'), 'utf8').trim())
      .toBe(`release create ${next} ${out}/ccrc-${next}.tar.gz ${out}/SHA256SUMS ${out}/ccrc-${next}.tar.gz.sigstore.json --verify-tag --prerelease --notes-file ${out}/release-notes.txt`);
    // D-5548: the body says what changed since the previous release tag.
    // The fixture's commits after `prev`, newest first: the merge, then each
    // later tag's own `release <t>` commit (a tag that is not release-shaped
    // sits inside the range), then `first` when there is no previous tag.
    const later = tags.slice(prev === undefined ? 0 : tags.indexOf(prev) + 1).reverse().map((t) => `- Release ${t}`);
    expect(readFileSync(join(out, 'release-notes.txt'), 'utf8')).toBe([
      prev === undefined ? 'First release' : `Changes since ${prev}`, '',
      'Behind the scenes', '- The merge under release', ...later, ...(prev === undefined ? ['- First'] : []), '',
    ].join('\n'));
    expect(existsSync(join(out, `ccrc-${next}.tar.gz.sigstore.json`))).toBe(true);
    expect(q.stdout).toMatch(/published v[0-9.]+ as a prerelease/);
  });

  it('a notes writer that fails never stops the release: publish says so and ships an empty body (D-5548)', () => {
    const home = mkTmp('ccrc-relmain-nonotes-');
    const root = fixture(home, { tags: ['v0.0.1'], notes: false });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q.code, q.stderr).toBe(0);
    expect(q.stderr).toMatch(/could not write the release notes for v0\.0\.2 — publishing with an empty body/);
    expect(readFileSync(join(out, 'release-notes.txt'), 'utf8')).toBe('');
    expect(readFileSync(join(home, 'gh-argv'), 'utf8').trim()).toMatch(/--prerelease --notes-file \S+\/release-notes\.txt$/);
    expect(originTags(home)).toContain('v0.0.2');
  });

  it('publish pushes the tag BEFORE gh runs — --verify-tag needs it on origin', () => {
    const home = mkTmp('ccrc-relmain-order-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q.code, q.stderr).toBe(0);
    expect(readFileSync(join(home, 'origin-tags-at-gh'), 'utf8').split('\n')).toContain('v0.0.2');
  });

  it('publish without a bundle refuses, pushes nothing, keeps the local tag for a retry', () => {
    const home = mkTmp('ccrc-relmain-nobundle-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const q = run(root, home, ['publish', '--out', out]);
    expect(q.code).toBe(1);
    expect(q.stderr).toMatch(/no provenance bundle .* refusing to publish an unattested release; nothing was pushed/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('v0.0.2');
    // CCRC_BUNDLE_PATH naming a file that does not exist is the same refusal.
    const q2 = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: join(home, 'missing.json') });
    expect(q2.code).toBe(1);
    expect(q2.stderr).toMatch(/CCRC_BUNDLE_PATH names no file/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  it('publish without a prepared state is a usage error, exit 2, nothing touched', () => {
    const home = mkTmp('ccrc-relmain-nostate-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const q = run(root, home, ['publish', '--out', join(home, 'out')]);
    expect(q.code).toBe(2);
    expect(q.stderr).toMatch(/run 'release-main.sh prepare' first/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('a failed publish deletes the pushed tag from origin, so no release-less tag remains', () => {
    const home = mkTmp('ccrc-relmain-cleanup-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const q = run(root, home, ['publish', '--out', out], 1, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q.code).toBe(1);
    expect(q.stderr).toMatch(/deleting tag v0\.0\.2 from origin/);
    expect(originTags(home)).toEqual(['v0.0.1']);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('');
  });

  it('an already-tagged HEAD: prepare records built false and publish does nothing — release.yml owns it', () => {
    const home = mkTmp('ccrc-relmain-tagged-');
    const root = fixture(home, { tags: ['v0.0.1'], tagHead: 'v1.0.0' });
    const out = join(home, 'out');
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code).toBe(0);
    expect(p.stdout).toMatch(/already tagged v1\.0\.0; release\.yml owns it/);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built false\ntag v1.0.0\n');
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    const q = run(root, home, ['publish', '--out', out]);
    expect(q.code).toBe(0);
    expect(q.stdout).toMatch(/nothing to publish — v1\.0\.0 was already tagged at checkout; release\.yml owns it/);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  it('a leftover LOCAL tag from an earlier prepare is named, not mistaken for release.yml\'s', () => {
    const home = mkTmp('ccrc-relmain-leftover-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code).toBe(1);
    expect(p.stderr).toMatch(/HEAD carries v0\.0\.2 which origin does not hold — a previous prepare's local tag/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  it('an arm is required, and only one', () => {
    const home = mkTmp('ccrc-relmain-arm-');
    const root = fixture(home);
    expect(run(root, home, []).code).toBe(2);
    expect(run(root, home, ['prepare', 'publish']).code).toBe(2);
  });
});

// ── W25: decide cuts no release when nothing that ships changed, and says so ──
// (D-6392 to D-6395, D-6397, D-6401 to D-6403.) Every row runs the arms in the
// workflow's order, decide then prepare, into one out directory.
const docsOnly = (r: string): void => {
  mkdirSync(join(r, 'docs'), { recursive: true });
  writeFileSync(join(r, 'docs', 'a.md'), 'a doc\n');
  writeFileSync(join(r, 'README.md'), 'a readme\n');
};
const put = (rel: string, body = 'x\n') => (r: string): void => {
  mkdirSync(path.dirname(join(r, rel)), { recursive: true });
  writeFileSync(join(r, rel), body);
};
const nothingBuilt = (home: string): void => {
  expect(existsSync(join(home, 'npm-argv'))).toBe(false);
  expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
};

describe('release-main.sh: decide — a merge that changes nothing that ships cuts no release (W25)', () => {
  it('W25-R1: a docs-only merge skips — no tag, no build, no tarball, no push, publish a no-op', () => {
    const home = mkTmp('ccrc-relmain-w25r1-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly });
    const out = join(home, 'out');
    const { d, p } = decideThenPrepare(root, home, out, {}, { GITHUB_STEP_SUMMARY: join(home, 'summary.md'), GITHUB_OUTPUT: join(home, 'output') });
    const skipLine = "release-main.sh: no release for this merge — nothing that ships changed since v0.0.1 (paths changed: 2, each on release-scope.mjs's NOT_SHIPPED list); nothing was tagged or built, and the next merge that changes the build takes v0.0.2";
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain(skipLine);
    expect(readFileSync(join(out, 'release-main.decision'), 'utf8')).toBe('same-as v0.0.1\n');
    expect(readFileSync(join(home, 'output'), 'utf8')).toBe('build=false\n');
    expect(readFileSync(join(home, 'summary.md'), 'utf8')).toBe(`${skipLine}\n`);
    expect(readFileSync(join(home, 'gh-argv'), 'utf8')).toBe('release view v0.0.1 --json isDraft --jq .isDraft\n');
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built unchanged\nsame-as v0.0.1\n');
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('');
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    expect(readdirSync(out).filter((f) => f.endsWith('.tar.gz'))).toEqual([]);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(readFileSync(join(home, 'summary.md'), 'utf8')).toBe(`${skipLine}\n`); // prepare's skip line is log-only
    // publish, as the workflow runs it after a skipped attest: CCRC_BUNDLE_PATH empty
    const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: '' });
    expect(q.code, q.stderr).toBe(0);
    expect(q.stdout).toContain('release-main.sh: no release for this merge — nothing that ships changed since v0.0.1; nothing to push, attest or publish');
    expect(readFileSync(join(home, 'gh-argv'), 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
    expect(originTags(home)).toEqual(['v0.0.1']);
  });

  it('W25-R2: a test-only merge skips', () => {
    const home = mkTmp('ccrc-relmain-w25r2-');
    const merge = (r: string): void => { put('server/test/x.test.ts')(r); put('server/test-e2e/y.ts')(r); put('agent/test/z.test.ts')(r); };
    const root = fixture(home, { tags: ['v0.0.1'], merge });
    const out = join(home, 'out');
    const { d, p } = decideThenPrepare(root, home, out);
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain(L.skip('v0.0.1', 3, 'v0.0.2'));
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built unchanged\nsame-as v0.0.1\n');
    nothingBuilt(home);
  });

  it('W25-R3: a shipped skill (a Markdown file in a shipped tree) releases', () => {
    const home = mkTmp('ccrc-relmain-w25r3-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: put('ccd/worker-skill/SKILL.md') });
    const out = join(home, 'out');
    const line = L.changed('v0.0.2', 'v0.0.1', 1, '"ccd/worker-skill/SKILL.md"');
    const { d, p } = decideThenPrepare(root, home, out, {}, { GITHUB_STEP_SUMMARY: join(home, 'summary.md'), GITHUB_OUTPUT: join(home, 'output') });
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain(line);
    expect(readFileSync(join(out, 'release-main.decision'), 'utf8')).toBe('release\n');
    expect(readFileSync(join(home, 'output'), 'utf8')).toBe('build=true\n');
    expect(readFileSync(join(home, 'summary.md'), 'utf8')).toBe(`${line}\n`);
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it.each([
    'agent/CLAUDE.md', '.github/workflows/x.yml', '.github/pull_request_template.md', 'ui/src/x.ts', 'pwa/test/x.test.tsx',
  ])('W25-R4: deny by default — %s is on no rule, so it releases', (rel) => {
    const home = mkTmp('ccrc-relmain-w25r4-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: put(rel) });
    const out = join(home, 'out');
    const { d, p } = decideThenPrepare(root, home, out);
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain(L.changed('v0.0.2', 'v0.0.1', 1, JSON.stringify(rel)));
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');
  });

  it('W25-R5: a failed release, then a docs merge — the diff runs from the highest tag, so the code releases', () => {
    const home = mkTmp('ccrc-relmain-w25r5-');
    const root = fixture(home, { tags: ['v0.0.1'], after: docsOnly });
    const out = join(home, 'out');
    const { d, p } = decideThenPrepare(root, home, out);
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain(L.changed('v0.0.2', 'v0.0.1', 1, '"ccd/ccrc"'));
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');
  });

  it('W25-R6: a mode-only change to a shipped file releases', () => {
    const home = mkTmp('ccrc-relmain-w25r6-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: (r) => chmodSync(join(r, 'ccd/ccrc'), 0o644) });
    const out = join(home, 'out');
    const { d, p } = decideThenPrepare(root, home, out);
    expect(d.stdout).toContain(L.changed('v0.0.2', 'v0.0.1', 1, '"ccd/ccrc"'));
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');
  });

  it('W25-R7: no earlier release tag — nothing to compare against, so it releases, and gh is never asked', () => {
    const home = mkTmp('ccrc-relmain-w25r7-');
    const root = fixture(home, { tags: [], merge: docsOnly });
    const out = join(home, 'out');
    const { d, p } = decideThenPrepare(root, home, out);
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain(L.first('v0.0.1'));
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.1\n');
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('W25-R8: a helper that is absent is unmeasured, and a merge that cannot be measured releases', () => {
    const home = mkTmp('ccrc-relmain-w25r8-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, scope: false });
    const out = join(home, 'out');
    const { d, p } = decideThenPrepare(root, home, out);
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain('could not measure what changed since v0.0.1 (release-scope.mjs exited 1)');
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');
  });

  it.each([
    ["process.stdout.write('unchanged 0\\n'); process.exit(3);", 'release-scope.mjs exited 3'],
    ["process.stdout.write('Unchanged 0\\n');", "release-scope.mjs answered 'Unchanged 0'"],
    ["process.stdout.write('unchanged 0\\nunchanged 0\\n');", 'release-scope.mjs answered more than one line'],
    ["process.stdout.write('unchanged x\\n');", "release-scope.mjs answered 'unchanged x'"],
  ])('W25-R9: only a positive answer skips — %s', (scope, why) => {
    const home = mkTmp('ccrc-relmain-w25r9-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, scope });
    const out = join(home, 'out');
    const { d, p } = decideThenPrepare(root, home, out);
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain(L.unmeasured('v0.0.2', 'v0.0.1', why));
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');
  });

  it.each([
    [{ viewExit: 1 }, 'gh release view exited 1'],
    [{ view: 'true' }, "gh release view answered 'true'"],
  ])('W25-R10: a base that is not a published release releases — %j', (gh, why) => {
    const home = mkTmp('ccrc-relmain-w25r10-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly });
    const out = join(home, 'out');
    const { d, p } = decideThenPrepare(root, home, out, gh);
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain(L.unpublished('v0.0.2', 'v0.0.1', why));
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');
  });

  it('W25-R11: monotonic — a skipped docs merge, then a code merge, releases both in one release', () => {
    const home = mkTmp('ccrc-relmain-w25r11-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly });
    const out1 = join(home, 'out1');
    const first = decideThenPrepare(root, home, out1);
    expect(first.p.code, first.p.stderr).toBe(0);
    expect(readFileSync(join(out1, 'release-main.state'), 'utf8')).toBe('built unchanged\nsame-as v0.0.1\n');
    writeFileSync(join(root, 'ccd', 'ccrc'), '#!/usr/bin/env bash\necho the code\n', { mode: 0o755 });
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'the code merge after');
    const out2 = join(home, 'out2');
    const second = decideThenPrepare(root, home, out2);
    expect(second.p.code, second.p.stderr).toBe(0);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('v0.0.2');
    const q = run(root, home, ['publish', '--out', out2], 0, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q.code, q.stderr).toBe(0);
    const notes = readFileSync(join(out2, 'release-notes.txt'), 'utf8');
    expect(notes).toContain('- The code merge after');
    expect(notes).toContain('- The merge under release');
  });

  it('W25-R12: the attest tripwire — a tarball already in the out directory refuses the skip', () => {
    const home = mkTmp('ccrc-relmain-w25r12-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly });
    const out = join(home, 'out');
    const d = run(root, home, ['decide', '--out', out]);
    expect(d.code, d.stderr).toBe(0);
    writeFileSync(join(out, 'ccrc-v0.0.1.tar.gz'), 'planted\n');
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code).toBe(1);
    expect(p.stderr).toMatch(/a tarball is already in .* — the attest step would sign an artifact no release publishes/);
    expect(existsSync(join(out, 'release-main.state'))).toBe(false);
  });

  it('W25-R13: a malformed skip state is refused by publish', () => {
    const home = mkTmp('ccrc-relmain-w25r13-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'release-main.state'), 'built unchanged\nsame-as junk\n');
    const q = run(root, home, ['publish', '--out', out]);
    expect(q.code).toBe(1);
    expect(q.stderr).toMatch(/malformed .*release-main\.state/);
  });

  it('W25-R14: the token reaches gh — the published-base check runs with decide\'s own GH_TOKEN', () => {
    const home = mkTmp('ccrc-relmain-w25r14-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly });
    const d = run(root, home, ['decide', '--out', join(home, 'out')], 0, { GH_TOKEN: 'fixture-token' });
    expect(d.code, d.stderr).toBe(0);
    expect(readFileSync(join(home, 'gh-env'), 'utf8')).toBe('GH_TOKEN=fixture-token\n');
  });

  it('W25-R15: HEAD\'s helper cannot vouch for its own merge — the base tag\'s copy sees the helper change', () => {
    const home = mkTmp('ccrc-relmain-w25r15-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, headScope: "process.stdout.write('unchanged 0\\n');" });
    const out = join(home, 'out');
    const { d, p } = decideThenPrepare(root, home, out);
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain(L.changedByBase('v0.0.2', 'v0.0.1', 1, '"deploy/release-scope.mjs"'));
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('W25-R16: a base with no helper cannot confirm HEAD\'s answer, so it releases', () => {
    const home = mkTmp('ccrc-relmain-w25r16-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, scope: false, headScope: "process.stdout.write('unchanged 0\\n');" });
    const out = join(home, 'out');
    const { d, p } = decideThenPrepare(root, home, out);
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain(L.unmeasured('v0.0.2', 'v0.0.1', 'v0.0.1 carries no deploy/release-scope.mjs to confirm the answer'));
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');
  });

  it('W25-R17: prepare consumes only an exact decision — none, or a stale one, releases and says so', () => {
    const home = mkTmp('ccrc-relmain-w25r17a-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code, p.stderr).toBe(0);
    expect(p.stdout).toContain(L.noDecision('v0.0.2', join(out, 'release-main.decision')));
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');

    const home2 = mkTmp('ccrc-relmain-w25r17b-');
    const root2 = fixture(home2, { tags: ['v0.0.1'], merge: docsOnly });
    const out2 = join(home2, 'out');
    mkdirSync(out2, { recursive: true });
    writeFileSync(join(out2, 'release-main.decision'), 'same-as v0.0.9\n');
    const p2 = run(root2, home2, ['prepare', '--out', out2]);
    expect(p2.code, p2.stderr).toBe(0);
    expect(p2.stdout).toContain(L.malformed('v0.0.2', join(out2, 'release-main.decision'), 'v0.0.1'));
    expect(readFileSync(join(out2, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');
  });

  it('W25-R18: an unwritable summary never fails the run and prints no shell error', () => {
    const home = mkTmp('ccrc-relmain-w25r18-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly });
    const out = join(home, 'out');
    const d = run(root, home, ['decide', '--out', out], 0, { GITHUB_STEP_SUMMARY: home });
    expect(d.code).toBe(0);
    expect(readFileSync(join(out, 'release-main.decision'), 'utf8')).toBe('same-as v0.0.1\n');
    expect(d.stdout).toContain(L.skip('v0.0.1', 2, 'v0.0.2'));
    expect(d.stderr).toBe('');
  });

  it('W25-R20: a node below the engines floor is unmeasured, so the merge releases', () => {
    const home = mkTmp('ccrc-relmain-w25r20-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, floor: '>=999.0.0' });
    const out = join(home, 'out');
    const { d, p } = decideThenPrepare(root, home, out);
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain('could not measure what changed since v0.0.1 (node v');
    expect(d.stdout).toContain("is below server/package.json's engines floor >=999.0.0)");
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('W25-R21: an unreadable floor is not a pass', () => {
    const home = mkTmp('ccrc-relmain-w25r21-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, floor: null });
    const out = join(home, 'out');
    const { d, p } = decideThenPrepare(root, home, out);
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain(L.unmeasured('v0.0.2', 'v0.0.1', 'server/package.json names no readable engines floor'));
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');
  });

  it('W25-R22: an unreadable node version is not a pass', () => {
    const home = mkTmp('ccrc-relmain-w25r22-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly });
    const shim = join(home, 'shim');
    mkdirSync(shim, { recursive: true });
    // Every argument but --version goes to the real node.
    writeFileSync(join(shim, 'node'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo garbage; exit 0; fi\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
    const out = join(home, 'out');
    const env = { PATH: `${shim}:${join(home, 'bin')}:${process.env.PATH ?? ''}` };
    const { d, p } = decideThenPrepare(root, home, out, {}, env);
    expect(d.code, d.stderr).toBe(0);
    expect(d.stdout).toContain(L.unmeasured('v0.0.2', 'v0.0.1', "node --version answered 'garbage'"));
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built true\ntag v0.0.2\n');
  });

  it('W25-R19: the measure arm answers one line and writes nothing', () => {
    const home = mkTmp('ccrc-relmain-w25r19a-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly });
    const m = run(root, home, ['measure', '--base', 'v0.0.1']);
    expect(m.code, m.stderr).toBe(0);
    expect(m.stdout).toBe('unchanged 2\n');
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    expect(existsSync(join(root, 'release-out'))).toBe(false);

    const home2 = mkTmp('ccrc-relmain-w25r19b-');
    const root2 = fixture(home2, { tags: ['v0.0.1'] });
    const m2 = run(root2, home2, ['measure', '--base', 'v0.0.1']);
    expect(m2.code, m2.stderr).toBe(0);
    expect(m2.stdout).toBe('changed 1 "ccd/ccrc"\n');

    const home3 = mkTmp('ccrc-relmain-w25r19c-');
    const root3 = fixture(home3, { tags: ['v0.0.1'], merge: docsOnly, scope: false });
    const m3 = run(root3, home3, ['measure', '--base', 'v0.0.1']);
    expect(m3.code, m3.stderr).toBe(0);
    expect(m3.stdout).toBe('unmeasured release-scope.mjs exited 1\n');

    expect(run(root, home, ['measure', '--base', 'junk']).code).toBe(2);
    expect(run(root, home, ['measure']).code).toBe(2);
    expect(run(root, home, ['prepare', '--base', 'v0.0.1']).code).toBe(2);
  });

  it.each([
    ['a docs-only merge, which skips', docsOnly, 'built unchanged\nsame-as v0.0.1\n', 'same-as v0.0.1\n'],
    ['a shipped merge, which releases', undefined, 'built true\ntag v0.0.2\n', undefined],
  ] as const)('W25-R23: --out inside the checkout (the workflow\'s release-out) — the decision file is not a dirty tree, for prepare or for the builder; %s', (_name, merge, state, decision) => {
    const home = mkTmp('ccrc-relmain-w25r23-');
    const root = fixture(home, { tags: ['v0.0.1'], ...(merge === undefined ? {} : { merge }) });
    const { d, p } = decideThenPrepare(root, home, 'release-out');
    expect(d.code, d.stderr).toBe(0);
    expect(p.code, p.stderr).toBe(0);
    expect(readFileSync(join(root, 'release-out', 'release-main.state'), 'utf8')).toBe(state);
    // The skip leaves the decision (nothing builds); a release consumes it before the tag (D-6404).
    if (decision === undefined) expect(existsSync(join(root, 'release-out', 'release-main.decision'))).toBe(false);
    else expect(readFileSync(join(root, 'release-out', 'release-main.decision'), 'utf8')).toBe(decision);
  });

  it('W25-R23: a decision beside the sources (--out is the checkout root) is refused as a straggler', () => {
    const home = mkTmp('ccrc-relmain-w25r23r-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly });
    expect(run(root, home, ['decide', '--out', '.']).code).toBe(0);
    const p = run(root, home, ['prepare', '--out', '.']);
    expect(p.code).toBe(1);
    expect(p.stderr).toMatch(/refusing a dirty tree/);
  });

  it('W25-R24: the helpers never see the job\'s token or its workflow-command files', () => {
    const home = mkTmp('ccrc-relmain-w25r24-');
    const leak = "process.stdout.write(process.env.GH_TOKEN || process.env.GITHUB_OUTPUT ? 'changed 1 \"leak\"\\n' : 'unchanged 0\\n');";
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, scope: leak });
    const out = join(home, 'out');
    const d = run(root, home, ['decide', '--out', out], 0, { GH_TOKEN: 'fixture-token', GITHUB_OUTPUT: join(home, 'output') });
    expect(d.code, d.stderr).toBe(0);
    expect(readFileSync(join(out, 'release-main.decision'), 'utf8')).toBe('same-as v0.0.1\n');
    expect(readFileSync(join(home, 'gh-env'), 'utf8')).toBe('GH_TOKEN=fixture-token\n');
  });

  it('W25-R23: a real straggler beside the decision file still refuses the dirty tree', () => {
    const home = mkTmp('ccrc-relmain-w25r23s-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly });
    expect(run(root, home, ['decide', '--out', 'release-out']).code).toBe(0);
    // A name that merely CONTAINS the decision's path must not be excluded with it.
    writeFileSync(join(root, 'release-out', 'release-main.decision.bak'), 'untracked\n');
    const p = run(root, home, ['prepare', '--out', 'release-out']);
    expect(p.code).toBe(1);
    expect(p.stderr).toMatch(/refusing a dirty tree/);
  });
});

describe('release-main.sh: source pins', () => {
  const src = (): string => readFileSync(SCRIPT, 'utf8');
  it('runs under set -euo pipefail', () => { expect(src()).toMatch(/^set -euo pipefail$/m); });
  it('derives with sort -V — plain sort would rank v1.9.10 below v1.9.9', () => { expect(src()).toMatch(/sort -V/); });
  it('builds through build-release.sh and owns no second build path', () => {
    expect(src()).toContain('deploy/build-release.sh" --out "$OUT_DIR"');
    expect(src()).not.toMatch(/npm ci|npm run/);
  });
  it('names all three artifacts to gh rather than globbing, and publishes a PRERELEASE (design §4, §18 rows 1 and 7)', () => {
    expect(src()).toContain('"$tarball" "$sums" "$bundle" --verify-tag --prerelease');
  });
  it('hands gh the notes as a FILE, written by release-notes.mjs — commit text never reaches a command line (D-5548)', () => {
    expect(src()).toContain('--verify-tag --prerelease --notes-file "$notes"');
    expect(src()).toContain('node "$ROOT/deploy/release-notes.mjs" --repo "$ROOT" --tag "$tag" --out "$notes"');
    expect(src(), 'the script must not read commit text itself').not.toMatch(/git[^\n]* log\b/);
    expect(src(), 'no --notes argument: the body goes through a file').not.toMatch(/--notes /);
  });

  it('W25-P1: the helper, the base\'s copy and the published-base check are asked in exactly these spellings', () => {
    expect(src()).toContain('node "$helper" --repo "$ROOT" --base "$base"');
    expect(src()).toContain('git -C "$ROOT" show "$base:deploy/release-scope.mjs"');
    expect(src()).toContain('gh release view "$tag" --json isDraft --jq .isDraft');
  });
  it('W25-P2: the skip has its own state word, beside the already-tagged one', () => {
    expect(src()).toContain("printf 'built unchanged\\nsame-as %s\\n'");
    expect(src()).toContain("printf 'built false\\ntag %s\\n'");
  });
  it('W25-P3: the list of what never ships lives in the helper, not in this script', () => {
    const code = src().split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).not.toMatch(/\bdocs\/|test-e2e|server\/test|agent\/test|\*\.md|['"]LICENSE['"]/);
  });
  it('W25-P4: prepare makes no gh call and holds no token — the step that installs makes no network ask', () => {
    const body = /^prepare\(\) \{\n[\s\S]*?\n\}$/m.exec(src())?.[0] ?? '';
    expect(body.length, 'prepare\'s body was not found').toBeGreaterThan(200);
    expect(body).not.toMatch(/\bgh /);
    expect(body).not.toContain('base_published');
    expect(body).not.toContain('GH_TOKEN');
  });
  it('W25-P5: the version sort is spelled once, in derive_tags', () => {
    expect(src().match(/sort -V/g) ?? []).toHaveLength(1);
    expect(/^derive_tags\(\) \{\n[\s\S]*?\n\}$/m.exec(src())?.[0] ?? '').toMatch(/sort -V/);
  });
});
