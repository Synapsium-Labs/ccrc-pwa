// deploy/release-notes-backfill.mjs (D-5548) — the one-off that gives the
// releases cut before the notes step a body, from their own tag ranges.
// --dry-run is local only (git, never gh); the real run edits each release
// with `gh release edit <tag> --notes-file <file>` (an argv, never a shell)
// and leaves a release whose body is already non-empty alone unless --force.
// gh is a recording stub planted first on PATH: no test reaches GitHub.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(path.resolve(here, '..', '..'), 'deploy', 'release-notes-backfill.mjs');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
function git(root: string, ...args: string[]): void {
  const r = spawnSync('git', ['-C', root, ...args], { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
}

/** v0.0.1..v0.0.4, one `feat` commit each; `vnext` is not release-shaped. */
function fixture(home: string): string {
  const root = join(home, 'repo');
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  for (let i = 1; i <= 4; i += 1) {
    git(root, 'commit', '-q', '--allow-empty', '-m', `feat: change ${i} (#${i})`);
    git(root, 'tag', `v0.0.${i}`);
  }
  git(root, 'tag', 'vnext');
  return root;
}

/** A gh that records each call's argv (one line, NUL-free) and the notes file
 *  it was handed, answers `release view` from `$HOME/body-<tag>` (empty when
 *  absent), and fails `release edit` for the tags listed in `$HOME/fail`. */
function plantGh(home: string): string {
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/gh-argv"',
    'if [ "$1 $2" = "release view" ]; then cat "$HOME/body-$3" 2>/dev/null; exit 0; fi',
    'if [ "$1 $2" = "release edit" ]; then',
    '  if grep -qx "$3" "$HOME/fail" 2>/dev/null; then echo "release not found" >&2; exit 1; fi',
    '  cp "$5" "$HOME/notes-$3"; exit 0',
    'fi',
    'exit 3',
  ].join('\n'), { mode: 0o755 });
  return bin;
}

function run(root: string, home: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const bin = plantGh(home);
  const r = spawnSync(process.execPath, [SCRIPT, '--repo', root, ...args],
    { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` }, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const ghCalls = (home: string): string[] =>
  existsSync(join(home, 'gh-argv')) ? readFileSync(join(home, 'gh-argv'), 'utf8').split('\n').filter((l) => l !== '') : [];

describe('release-notes-backfill.mjs', () => {
  it('--dry-run prints the newest N releases\' notes and never calls gh', () => {
    const home = mkTmp('ccrc-backfill-dry-');
    const root = fixture(home);
    const r = run(root, home, ['--last', '2', '--dry-run']);
    expect(r.code, r.stderr).toBe(0);
    expect(ghCalls(home)).toEqual([]);
    expect(r.stdout).toContain('== v0.0.4');
    expect(r.stdout).toContain('Changes since v0.0.3\n\nNew\n- Change 4 #4\n');
    expect(r.stdout).toContain('== v0.0.3');
    expect(r.stdout).not.toContain('== v0.0.2');
    expect(r.stdout.indexOf('== v0.0.4')).toBeLessThan(r.stdout.indexOf('== v0.0.3'));
    expect(r.stdout).toMatch(/dry run: 2 releases, nothing edited/);
  });

  it('the real run edits each release through a notes FILE, newest first, skipping one that already has a body', () => {
    const home = mkTmp('ccrc-backfill-real-');
    const root = fixture(home);
    writeFileSync(join(home, 'body-v0.0.3'), 'Hand-written notes.\n');
    const r = run(root, home, ['--last', '3']);
    expect(r.code, r.stderr).toBe(0);
    const edits = ghCalls(home).filter((l) => l.startsWith('release edit'));
    expect(edits.map((l) => l.split(' ')[2])).toEqual(['v0.0.4', 'v0.0.2']);
    for (const e of edits) expect(e).toMatch(/^release edit v0\.0\.\d --notes-file \S+$/);
    expect(readFileSync(join(home, 'notes-v0.0.4'), 'utf8')).toBe('Changes since v0.0.3\n\nNew\n- Change 4 #4\n');
    expect(readFileSync(join(home, 'notes-v0.0.2'), 'utf8')).toBe('Changes since v0.0.1\n\nNew\n- Change 2 #2\n');
    expect(r.stdout).toMatch(/v0\.0\.3: has a body already — left alone \(--force replaces it\)/);
    expect(r.stdout).toMatch(/2 edited, 1 left alone, 0 failed/);
  });

  it('--force replaces an existing body; a failed edit is reported, the rest still run, and the exit is 1', () => {
    const home = mkTmp('ccrc-backfill-force-');
    const root = fixture(home);
    writeFileSync(join(home, 'body-v0.0.3'), 'Hand-written notes.\n');
    writeFileSync(join(home, 'fail'), 'v0.0.4\n');
    const r = run(root, home, ['--last', '2', '--force']);
    expect(r.code).toBe(1);
    expect(ghCalls(home).filter((l) => l.startsWith('release view'))).toEqual([]);
    expect(ghCalls(home).filter((l) => l.startsWith('release edit')).map((l) => l.split(' ')[2])).toEqual(['v0.0.4', 'v0.0.3']);
    expect(existsSync(join(home, 'notes-v0.0.3'))).toBe(true);
    expect(r.stderr).toMatch(/v0\.0\.4: gh release edit failed/);
    expect(r.stdout).toMatch(/1 edited, 0 left alone, 1 failed/);
  });

  it('refuses a malformed --last, exit 2, nothing touched', () => {
    const home = mkTmp('ccrc-backfill-usage-');
    const root = fixture(home);
    for (const bad of [['--last', '0'], ['--last', 'x'], ['--bogus']]) {
      const r = run(root, home, bad);
      expect(r.code, bad.join(' ')).toBe(2);
    }
    expect(ghCalls(home)).toEqual([]);
  });

  it('source pins: gh and git through execFileSync with an argv, the notes from release-notes.mjs', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/execFileSync\(gh, \['release', 'edit', tag, '--notes-file', file\]/);
    expect(src).toContain("from './release-notes.mjs'");
    expect(src).not.toMatch(/\bexecSync\b|shell:\s*true|\beval\(|new Function\b/);
  });
});
