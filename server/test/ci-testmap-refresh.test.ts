// The bounded test-map refresh (#1407's measurement: no map published since the hourly refresh outgrew its
// 60-minute shards). This file pins how select treats a fresh, a missing and a stale map TODAY (characterization,
// green on the unchanged code), then the bounded refresh: a partial-merge that stamps each record with the sha it was
// traced at, the uncertain-means-full rule, the batch sizer and the stale-map warning.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mkTmp } from './tmpHelpers.js';

const SELECT_MJS = path.resolve(__dirname, '../../.github/ci/select.mjs');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

function git(repo: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, { cwd: repo, env: { ...process.env, ...GIT_ENV, ...env }, encoding: 'utf8' });
}

function writeFile(repo: string, rel: string, content: string): void {
  const full = path.join(repo, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commitAll(repo: string, message: string, date?: string): string {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message], date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {});
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

function rec(opts: { read?: string[]; unknown?: boolean; tracedAt?: string } = {}) {
  const r: Record<string, unknown> = { read: opts.read ?? [], probed: [], listed: [], subtree: [], git: false, unknown: !!opts.unknown };
  if (opts.tracedAt) r.tracedAt = opts.tracedAt;
  return r;
}

function parseOutput(text: string): Record<string, string> {
  const lines = text.split('\n');
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_]+)<<(.+)$/.exec(lines[i]);
    if (!m) continue;
    const vals: string[] = [];
    i++;
    while (i < lines.length && lines[i] !== m[2]) vals.push(lines[i++]);
    out[m[1]] = vals.join('\n');
  }
  return out;
}

function runSelect(repo: string, args: string[]) {
  const io = mkTmp('ccrc-ci-refresh-io-');
  const outputFile = path.join(io, 'output.txt');
  const summaryFile = path.join(io, 'summary.md');
  writeFileSync(outputFile, '');
  writeFileSync(summaryFile, '');
  let stdout = '';
  try {
    stdout = execFileSync('node', [SELECT_MJS, '--repo', repo, ...args], {
      env: { ...process.env, GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile }, encoding: 'utf8',
    });
  } catch (e) {
    throw new Error(`select failed: ${String((e as { stderr?: unknown }).stderr)}`);
  }
  return { stdout, outputs: parseOutput(readFileSync(outputFile, 'utf8')), summary: readFileSync(summaryFile, 'utf8') };
}

/** A repo whose map commit is `OLD_DATE` (days old) and whose HEAD changes src/foo.ts. */
const OLD_DATE = '2026-01-01T00:00:00Z';
function fixture(opts: { mapDate?: string } = {}) {
  const repo = mkTmp('ccrc-ci-refresh-repo-');
  git(repo, ['init', '-q']);
  git(repo, ['checkout', '-q', '-b', 'main']);
  writeFile(repo, 'src/foo.ts', 'export const foo = 1;\n');
  writeFile(repo, 'server/test/a.test.ts', "it('a', () => {});\n");
  writeFile(repo, 'server/test/b.test.ts', "it('b', () => {});\n");
  const baseSha = commitAll(repo, 'base', opts.mapDate ?? OLD_DATE);
  writeFile(repo, 'src/foo.ts', 'export const foo = 2;\n');
  const headSha = commitAll(repo, 'head');
  return { repo, baseSha, headSha };
}

function writeMap(repo: string, map: unknown): string {
  const f = path.join(repo, '..', `map-${path.basename(repo)}.json`);
  writeFileSync(f, JSON.stringify(map));
  return f;
}

function mapOf(sha: string, tests: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { format: 1, sha, baseline: { read: [], probed: [], listed: [], subtree: [], git: false }, tests, ...extra };
}

describe('select today: a fresh, a missing and a stale map (characterization)', () => {
  it('a fresh map selects exactly what the change affects, and the summary carries no stale-map warning', () => {
    const { repo, baseSha } = fixture({ mapDate: new Date().toISOString() });
    const map = writeMap(repo, mapOf(baseSha, {
      'server/test/a.test.ts': rec({ read: ['src/foo.ts'] }), 'server/test/b.test.ts': rec(),
    }));
    const r = runSelect(repo, ['--event', 'pull_request', '--map', map]);
    expect(r.outputs.tests).toBe('selected');
    expect(r.outputs.count).toBe('1');
    expect(r.summary).toContain('server/test/a.test.ts');
    expect(r.summary).not.toMatch(/stale|older than/i);
    expect(r.stdout).not.toMatch(/::warning::/);
  });

  it('a missing map answers a full run and says so', () => {
    const { repo } = fixture();
    const r = runSelect(repo, ['--event', 'pull_request', '--map', path.join(repo, 'absent.json')]);
    expect(r.outputs.tests).toBe('full');
    expect(r.outputs.fallback).toMatch(/no map restored/);
  });

  it('a months-old map is trusted exactly like a fresh one: selected, no warning, however old it is', () => {
    const { repo, baseSha } = fixture({ mapDate: OLD_DATE });
    const map = writeMap(repo, mapOf(baseSha, {
      'server/test/a.test.ts': rec({ read: ['src/foo.ts'] }), 'server/test/b.test.ts': rec(),
    }));
    const r = runSelect(repo, ['--event', 'pull_request', '--map', map]);
    expect(r.outputs.tests).toBe('selected');
    expect(r.outputs.count).toBe('1');
    expect(r.summary).not.toMatch(/stale|older than/i);
  });

  it('a refresh with no durations traces the whole selection, every file once, in at most eight shards', () => {
    const { repo, baseSha } = fixture();
    const map = writeMap(repo, mapOf(baseSha, {
      'server/test/a.test.ts': rec({ read: ['src/foo.ts'] }), 'server/test/b.test.ts': rec(),
    }));
    const r = runSelect(repo, ['--event', 'schedule', '--input-mode', 'refresh', '--map', map]);
    expect(r.outputs.trace).toBe('refresh');
    expect(r.outputs.trace_count).toBe('1');
    expect(JSON.parse(r.outputs.trace_matrix).include.length).toBeLessThanOrEqual(8);
  });
});
