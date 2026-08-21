// The stamp reader refuses to invent: absent file, unreadable file, invalid
// JSON, wrong shape — all null, never a throw and never a partial object.
// /health is the deploy's own verification gate; a stamp problem must not
// take the route down with it.
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildInfo } from '../src/buildinfo.js';
import { mkTmp } from './tmpHelpers.js';

const put = (content: string): string => {
  const dir = mkTmp('ccrc-buildinfo-');
  const f = path.join(dir, 'build.json');
  writeFileSync(f, content);
  return f;
};

describe('readBuildInfo', () => {
  it('reads a complete stamp', () => {
    const stamp = JSON.stringify({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false });
    expect(readBuildInfo(put(stamp))).toEqual(JSON.parse(stamp));
  });

  it('a missing file is null', () => {
    expect(readBuildInfo(path.join(mkTmp('ccrc-buildinfo-'), 'nope.json'))).toBeNull();
  });

  it('invalid JSON is null, not a throw', () => {
    expect(readBuildInfo(put('{half a stamp'))).toBeNull();
  });

  it('a wrong shape is null — a stamp with no sha is not a stamp', () => {
    expect(readBuildInfo(put('{"ref":"main","builtAt":"2026-08-11T11:00:00Z","dirty":false}'))).toBeNull();
    expect(readBuildInfo(put('{"sha":42,"ref":"main","builtAt":"x","dirty":false}'))).toBeNull();
  });

  it('an EMPTY sha is null — the malformed value that fails safe-looking', () => {
    // A `typeof`-only check accepts this file as a stamp, and it is the one
    // bad value that does not announce itself downstream: two boxes both
    // reporting `sha: ''` compare EQUAL, so the cross-box skew check would
    // report "the builds agree" from two files neither box could read.
    // "Nothing is known" and "they match" must not be the same value —
    // rejecting the stamp keeps them apart, because absence is already a
    // distinct condition every consumer handles.
    expect(readBuildInfo(put('{"sha":"","ref":"main","builtAt":"x","dirty":false}'))).toBeNull();
    // Whole or not at all: `stamp_build` writes these three from `git
    // rev-parse`, `git rev-parse --abbrev-ref` and `date -u`, none of which
    // can emit an empty string, so an empty one anywhere means the file was
    // not written by a deploy. Accepting a `ref: ''` would hand every consumer
    // a field it has to re-check for itself.
    expect(readBuildInfo(put('{"sha":"abc","ref":"","builtAt":"x","dirty":false}'))).toBeNull();
    expect(readBuildInfo(put('{"sha":"abc","ref":"main","builtAt":"","dirty":false}'))).toBeNull();
    // ...and the same stamp with all three present is still read, so the guard
    // above is rejecting emptiness rather than the shape.
    expect(readBuildInfo(put('{"sha":"abc","ref":"main","builtAt":"x","dirty":true}')))
      .toEqual({ sha: 'abc', ref: 'main', builtAt: 'x', dirty: true });
  });

  // ── Stage 4, Task 1: the release version rides ADDITIVELY ────────────────
  // `version` is the fifth field, written only when a `v*` tag points at the
  // built commit (or always by the release job). Additive wire discipline:
  // every stamp already on a box omits it, and those stamps must keep parsing
  // exactly as before — absence is the ordinary case, not a defect.
  it('keeps a valid version when the stamp carries one', () => {
    expect(readBuildInfo(put('{"sha":"abc","ref":"main","builtAt":"x","dirty":false,"version":"v1.2.3"}')))
      .toEqual({ sha: 'abc', ref: 'main', builtAt: 'x', dirty: false, version: 'v1.2.3' });
  });

  it('tolerates absence — a version-less stamp is still a stamp, with NO version key', () => {
    // `toEqual` is strict about extra keys in the EXPECTED object's absence
    // too: the parsed literal must not carry `version: undefined`, because a
    // JSON.stringify round-trip (the ready frame's revalidation) would then
    // differ from the disk read.
    const parsed = readBuildInfo(put('{"sha":"abc","ref":"main","builtAt":"x","dirty":false}'));
    expect(parsed).toEqual({ sha: 'abc', ref: 'main', builtAt: 'x', dirty: false });
    expect(parsed !== null && 'version' in parsed).toBe(false);
  });

  it('a present-but-invalid version rejects the stamp whole — same rule as the other strings', () => {
    // Our stampers never write an empty or non-string version, so one means
    // the file was written by something other than a deploy — accepted whole
    // or not at all, exactly like sha/ref/builtAt.
    expect(readBuildInfo(put('{"sha":"abc","ref":"main","builtAt":"x","dirty":false,"version":""}'))).toBeNull();
    expect(readBuildInfo(put('{"sha":"abc","ref":"main","builtAt":"x","dirty":false,"version":42}'))).toBeNull();
  });
});

// ── Stage 4, Task 1: deploy.sh's stamp_build derivation, RUN, not read ─────
// `deploy.sh` cannot be executed end to end from a test (it deploys), but the
// stamp it writes is produced by a self-contained block: the top-level
// `BUILD_*` derivation lines plus the printf inside `stamp_build`, between
// `stamp="$(mktemp)"` and the ssh that ships it. This extracts exactly those
// lines and runs them in a fixture repository — so a casual edit to the
// derivation (dropping the tag lookup, making the version field unconditional)
// goes red here instead of shipping.
describe('deploy.sh stamp_build — the tag rides when a v* tag points at HEAD', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const DEPLOY_SH = path.join(here, '..', '..', 'deploy', 'deploy.sh');

  /** The stamp-producing lines of deploy.sh, verbatim. */
  function stampScript(): string {
    const lines = readFileSync(DEPLOY_SH, 'utf8').split('\n');
    const derivation = lines.filter((l) => /^(BUILD_[A-Z_]+=|git diff --quiet)/.test(l));
    // The BUILD_SHA/DIRTY/REF trio, plus the version line this task adds.
    expect(derivation.length).toBeGreaterThanOrEqual(4);
    expect(derivation.join('\n')).toContain('git tag --points-at HEAD');
    const open = lines.findIndex((l) => l.includes('stamp="$(mktemp)"'));
    const close = lines.findIndex((l, i) => i > open && l.includes('"${SSH[@]}"'));
    expect(open, 'stamp_build\'s mktemp line moved').toBeGreaterThan(-1);
    expect(close, 'stamp_build\'s ssh line moved').toBeGreaterThan(open);
    const inner = lines.slice(open + 1, close);
    return ['set -euo pipefail', ...derivation, 'stamp="$(mktemp)"', ...inner,
      'cat "$stamp"', 'rm -f "$stamp"'].join('\n');
  }

  /** A one-commit fixture repository, identity from the environment (CI-safe). */
  function fixtureRepo(): { root: string; env: NodeJS.ProcessEnv } {
    const root = mkTmp('ccrc-stampbuild-');
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    };
    const git = (...args: string[]): void => {
      const r = spawnSync('git', ['-C', root, ...args], { env, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
    };
    writeFileSync(path.join(root, 'file'), 'fixture\n');
    git('init', '-q', '-b', 'fixture-branch');
    git('add', '-A');
    git('commit', '-q', '-m', 'fixture');
    return { root, env };
  }

  const runStamp = (root: string, env: NodeJS.ProcessEnv): Record<string, unknown> => {
    const r = spawnSync('bash', ['-c', stampScript()], { cwd: root, env, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as Record<string, unknown>;
  };

  it('stamps the version when a v* tag points at HEAD', () => {
    const { root, env } = fixtureRepo();
    spawnSync('git', ['-C', root, 'tag', 'v1.2.3'], { env, encoding: 'utf8' });
    const stamp = runStamp(root, env);
    expect(stamp['version']).toBe('v1.2.3');
    expect(stamp['dirty']).toBe(false);
    expect(stamp['ref']).toBe('fixture-branch');
  });

  it('omits the version — no key at all — when no tag points at HEAD', () => {
    const { root, env } = fixtureRepo();
    const stamp = runStamp(root, env);
    expect('version' in stamp).toBe(false);
    expect(typeof stamp['sha']).toBe('string');
  });

  it('a tag that is not vX.Y.Z does not become a version', () => {
    // The tag IS the version, so only the release shape qualifies — a
    // `release-1` or `wip` tag at HEAD is not an identity claim.
    const { root, env } = fixtureRepo();
    spawnSync('git', ['-C', root, 'tag', 'release-1'], { env, encoding: 'utf8' });
    expect('version' in runStamp(root, env)).toBe(false);
  });
});
