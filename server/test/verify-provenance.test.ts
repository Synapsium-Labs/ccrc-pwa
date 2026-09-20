// deploy/verify-provenance.mjs — design 2026-09-20 §5. Is this tarball the one
// the release workflow built for this tag? Four checks on either backend:
// signature against the vendored trusted root, subject NAME, OIDC issuer,
// and a SAN in a set of EXACTLY TWO workflow URIs. Fixtures are REAL bundles
// from real releases (release-main.yml's identity at refs/heads/main,
// release.yml's at refs/tags/<tag>) and one from ANOTHER repo's workflow —
// plus the tarballs' DIGESTS, never the 3 MB tarballs (D-3116).
// The sigstore backend runs for real, offline (Task 1 measured it); the gh
// backend runs under a stub that records argv and models gh's identity
// check as an allowlist.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const VERIFIER = join(REPO, 'deploy', 'verify-provenance.mjs');
const FIX = join(here, 'fixtures', 'provenance');

/** The release identity, read from ccd/ccrc's pair — the same pick the
 *  ccrc-update source pin makes; this file spells no org. */
function pick(name: string): string {
  const m = new RegExp(`^${name}="([^"]+)"$`, 'm').exec(readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8'));
  if (m === null) throw new Error(`ccd/ccrc does not spell ${name}`);
  return m[1]!;
}
const OWNER = pick('CCRC_RELEASE_OWNER');
const REPO_NAME = pick('CCRC_RELEASE_REPO');
const ISSUER = 'https://token.actions.githubusercontent.com';
const mainMeta = JSON.parse(readFileSync(join(FIX, 'release-main.meta.json'), 'utf8')) as { tag: string; sha256: string };
const thirdMeta = JSON.parse(readFileSync(join(FIX, 'third-workflow.meta.json'), 'utf8')) as { owner: string; repo: string; sha256: string; identity: string };
const RELEASE_TAG_META = join(FIX, 'release-tag.meta.json');

interface Result { code: number; stdout: string; stderr: string }
function verify(args: string[], env: NodeJS.ProcessEnv = {}, pathPrefix = ''): Result {
  const r = spawnSync('node', [VERIFIER, ...args], {
    env: { ...process.env, ...env, PATH: pathPrefix === '' ? process.env.PATH : `${pathPrefix}:${process.env.PATH ?? ''}` },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const mainArgs = (over: Record<string, string> = {}): string[] => {
  const o = { bundle: join(FIX, 'release-main.sigstore.json'), digest: mainMeta.sha256, tag: mainMeta.tag, owner: OWNER, repo: REPO_NAME, ...over };
  return ['--bundle', o.bundle, '--blob-sha256', o.digest, '--tag', o.tag, '--owner', o.owner, '--repo', o.repo];
};
const flip = (hex: string): string => `${hex.slice(0, -1)}${hex.endsWith('0') ? '1' : '0'}`;

describe('verify-provenance.mjs: the sigstore backend, offline, against real bundles', () => {
  it('release-main.yml\'s bundle verifies under the main identity', () => {
    const r = verify(mainArgs());
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(`verified ccrc-${mainMeta.tag}.tar.gz sha256:${mainMeta.sha256} as https://github.com/${OWNER}/${REPO_NAME}/.github/workflows/release-main.yml@refs/heads/main (sigstore)`);
  });

  it('offered for a DIFFERENT tag it refuses on the subject name (§5 refusal 3; §18 "the verifier asserts the subject name")', () => {
    const r = verify(mainArgs({ tag: 'v9.9.9' }));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/subject is ccrc-v[0-9.]+\.tar\.gz, not ccrc-v9\.9\.9\.tar\.gz — a tarball attested under another tag/);
  });

  it('a different --owner refuses — the identity set is built from owner/repo', () => {
    const r = verify(mainArgs({ owner: 'someone-else' }));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no bundle verified against the trusted root for either release workflow of someone-else\//);
  });

  it('one flipped digit in the blob\'s digest refuses — the bytes are bound', () => {
    const r = verify(mainArgs({ digest: flip(mainMeta.sha256) }));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/but the blob's is [0-9a-f]{64} — not the bytes the workflow built/);
  });

  it('--blob with a file that is not the tarball refuses the same way', () => {
    const home = mkTmp('ccrc-verify-blob-');
    writeFileSync(join(home, 'blob'), 'not the tarball\n');
    const r = verify(['--bundle', join(FIX, 'release-main.sigstore.json'), '--blob', join(home, 'blob'), '--tag', mainMeta.tag, '--owner', OWNER, '--repo', REPO_NAME]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/not the bytes the workflow built/);
  });

  it('a bundle whose SAN names a third workflow refuses — the set is exactly two URIs, never owner/repo alone (§18)', () => {
    // cli/cli's own release bundle, with cli/cli as owner/repo: the identity
    // set becomes cli/cli/…/release-main.yml@main and …/release.yml@tag, and
    // the bundle's SAN (deployment workflow) matches neither.
    const r = verify(['--bundle', join(FIX, 'third-workflow.sigstore.jsonl'), '--blob-sha256', thirdMeta.sha256, '--tag', 'v9.9.9', '--owner', thirdMeta.owner, '--repo', thirdMeta.repo]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no bundle verified against the trusted root for either release workflow of cli\/cli/);
    expect(thirdMeta.identity).not.toMatch(/release-main\.yml|\/release\.yml/);
  });

  it('a wrong trusted root refuses; CCRC_SIGSTORE_TRUSTED_ROOT is the override (D-3119)', () => {
    const home = mkTmp('ccrc-verify-root-');
    writeFileSync(join(home, 'empty.jsonl'), '\n');
    const r = verify(mainArgs(), { CCRC_SIGSTORE_TRUSTED_ROOT: join(home, 'empty.jsonl') });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/holds no trusted root/);
    const ok = verify(mainArgs(), { CCRC_SIGSTORE_TRUSTED_ROOT: join(REPO, 'deploy', 'sigstore-trusted-root.jsonl') });
    expect(ok.code, ok.stderr).toBe(0);
  });
});

describe('verify-provenance.mjs: release.yml\'s identity (the hand-cut tag)', () => {
  const present = existsSync(RELEASE_TAG_META);
  const tagMeta = present ? JSON.parse(readFileSync(RELEASE_TAG_META, 'utf8')) as { tag: string; sha256: string } : null;
  // Override (D-3132): the plan's original presence case
  // (`expect(present…).toBe(true)`) would be a permanently red required CI
  // check while Task 7 Step 5's hand-cut tag stays undecided. Green here
  // means EITHER the fixture landed, OR its absence is written into the plan
  // beside D-3132's own filename — deleting that record reds this case.
  it('the release-tag fixture is present, or its absence is recorded as D-3132 beside its filename', () => {
    if (present) return;
    const planPath = join(REPO, 'docs', 'superpowers', 'plans', '2026-09-20-centralised-update-w1-release-and-provenance.md');
    const plan = readFileSync(planPath, 'utf8');
    const line = plan.split('\n').find((l) => l.startsWith('- **D-3132**'));
    expect(line, `no D-3132 entry found in ${planPath}`).toBeDefined();
    expect(line).toContain('release-tag.*');
  });
  it('verifies under …/release.yml@refs/tags/<tag>, and under no other tag', () => {
    if (tagMeta === null) return;
    const args = ['--bundle', join(FIX, 'release-tag.sigstore.json'), '--blob-sha256', tagMeta.sha256, '--tag', tagMeta.tag, '--owner', OWNER, '--repo', REPO_NAME];
    const r = verify(args);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`as https://github.com/${OWNER}/${REPO_NAME}/.github/workflows/release.yml@refs/tags/${tagMeta.tag} (sigstore)`);
    // The tag is inside the identity URI: another tag is another identity.
    const other = verify(['--bundle', join(FIX, 'release-tag.sigstore.json'), '--blob-sha256', tagMeta.sha256, '--tag', 'v9.9.9', '--owner', OWNER, '--repo', REPO_NAME]);
    expect(other.code).toBe(1);
  });
});

describe('verify-provenance.mjs: the gh backend under a recording stub', () => {
  /** Models gh's identity check: exit 0 only when --cert-identity is one of
   *  the two ccrc URIs for the tag (the fixture's allowlist), records argv. */
  function plantGh(home: string, allow: string[], exit = 0): string {
    const bin = join(home, 'bin'); mkdirSync(bin, { recursive: true });
    writeFileSync(join(home, 'gh-allow'), `${allow.join('\n')}\n`);
    writeFileSync(join(bin, 'gh'), [
      '#!/bin/sh',
      'printf \'%s\\n\' "$*" >> "$HOME/gh-argv"',
      'id=""; while [ $# -gt 0 ]; do case "$1" in --cert-identity) id="$2"; shift 2 ;; *) shift ;; esac; done',
      `[ ${exit} -eq 0 ] || exit ${exit}`,
      'grep -qxF -- "$id" "$HOME/gh-allow" && exit 0',
      'echo "fixture gh: identity not in the allowlist: $id" >&2; exit 1',
    ].join('\n') + '\n', { mode: 0o755 });
    return bin;
  }
  const ids = (tag: string): string[] => [
    `https://github.com/${OWNER}/${REPO_NAME}/.github/workflows/release-main.yml@refs/heads/main`,
    `https://github.com/${OWNER}/${REPO_NAME}/.github/workflows/release.yml@refs/tags/${tag}`,
  ];
  function blobFile(home: string): string { const p = join(home, 'blob'); writeFileSync(p, 'gh hashes this itself\n'); return p; }

  it('the argv carries --cert-identity, --cert-oidc-issuer, --custom-trusted-root, --deny-self-hosted-runners, --bundle and --repo; the first identity tried is release-main\'s', () => {
    const home = mkTmp('ccrc-verify-gh-');
    const bin = plantGh(home, ids(mainMeta.tag));
    const r = verify(['--backend', 'gh', '--bundle', join(FIX, 'release-main.sigstore.json'), '--blob', blobFile(home), '--tag', mainMeta.tag, '--owner', OWNER, '--repo', REPO_NAME], { HOME: home }, bin);
    expect(r.code, r.stderr).toBe(0);
    const argv = readFileSync(join(home, 'gh-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(argv).toEqual([
      `attestation verify ${join(home, 'blob')} --bundle ${join(FIX, 'release-main.sigstore.json')} --repo ${OWNER}/${REPO_NAME} --cert-identity ${ids(mainMeta.tag)[0]} --cert-oidc-issuer ${ISSUER} --custom-trusted-root ${join(REPO, 'deploy', 'sigstore-trusted-root.jsonl')} --deny-self-hosted-runners`,
    ]);
    expect(r.stdout).toContain('(gh)');
  });

  it('the second identity is tried when the first is refused; a third workflow is never sent (§18, both backends)', () => {
    const home = mkTmp('ccrc-verify-gh2-');
    const bin = plantGh(home, [ids(mainMeta.tag)[1]!]);
    const r = verify(['--backend', 'gh', '--bundle', join(FIX, 'release-main.sigstore.json'), '--blob', blobFile(home), '--tag', mainMeta.tag, '--owner', OWNER, '--repo', REPO_NAME], { HOME: home }, bin);
    expect(r.code, r.stderr).toBe(0);
    const argv = readFileSync(join(home, 'gh-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(argv.length).toBe(2);
    expect(argv.map((l) => / --cert-identity (\S+) /.exec(l)![1])).toEqual(ids(mainMeta.tag));
    // cli/cli's bundle: neither of OUR two URIs is its SAN, so nothing gh
    // could accept is ever on the argv — the stub's allowlist is the two.
    const third = verify(['--backend', 'gh', '--bundle', join(FIX, 'third-workflow.sigstore.jsonl'), '--blob', blobFile(home), '--tag', 'v9.9.9', '--owner', thirdMeta.owner, '--repo', thirdMeta.repo], { HOME: home }, bin);
    expect(third.code).toBe(1);
  });

  it('gh refusing both identities refuses; the subject NAME is still checked here (D-3123)', () => {
    const home = mkTmp('ccrc-verify-gh3-');
    const bin = plantGh(home, ids(mainMeta.tag), 1);
    const r = verify(['--backend', 'gh', '--bundle', join(FIX, 'release-main.sigstore.json'), '--blob', blobFile(home), '--tag', mainMeta.tag, '--owner', OWNER, '--repo', REPO_NAME], { HOME: home }, bin);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/gh attestation verify refused for either release workflow/);
    const home2 = mkTmp('ccrc-verify-gh4-');
    const bin2 = plantGh(home2, ids('v9.9.9'));
    const wrongTag = verify(['--backend', 'gh', '--bundle', join(FIX, 'release-main.sigstore.json'), '--blob', blobFile(home2), '--tag', 'v9.9.9', '--owner', OWNER, '--repo', REPO_NAME], { HOME: home2 }, bin2);
    expect(wrongTag.code).toBe(1);
    expect(wrongTag.stderr).toMatch(/not ccrc-v9\.9\.9\.tar\.gz/);
  });

  it('the gh backend needs the file: --blob-sha256 is a usage error there', () => {
    const r = verify(['--backend', 'gh', ...mainArgs()]);
    expect(r.code).toBe(2);
  });
});

describe('verify-provenance.mjs: usage', () => {
  it('missing arguments, a malformed tag, a malformed digest, both blob forms, an unknown backend — all exit 2 with usage on stderr', () => {
    expect(verify([]).code).toBe(2);
    expect(verify(mainArgs({ tag: '0.0.9' })).code).toBe(2);
    expect(verify(mainArgs({ digest: 'abc' })).code).toBe(2);
    expect(verify([...mainArgs(), '--blob', VERIFIER]).code).toBe(2);
    expect(verify([...mainArgs(), '--backend', 'cosign']).code).toBe(2);
    expect(verify(['-h']).stderr).toMatch(/^usage: node verify-provenance\.mjs/);
  });
});
