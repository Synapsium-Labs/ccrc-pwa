// `ccd/ccd-testbox-times` (test box TB11, D-7413, D-7421, D-7567): the daily fetch of CI's `testtimes` artifact into
// CCRC_TESTBOX_TIMES. A fixture `gh` answers from files under the fixture HOME (no network, no token), and the settings
// come from the real printer (`ccrc test --testbox-knobs host`) through a fixture launcher. Rows: the trusted-run rules
// CI's own picker applies (`.github/ci/main-artifact.mjs`), the nested file the budget reads, the atomic replace, and
// every failure keeping the previous file with one line.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDurations } from '../../agent/src/testbox/budget.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO, 'ccd', 'ccd-testbox-times');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const REPO_ID = 4242;

/** The fixture `gh`: `api <path>` answers `<home>/gh-fix/<path with / and ? as _>.json` (exit 1 when absent), and
 *  `run download <id> … -D <dir>` copies `<home>/gh-fix/download-<id>.json` to `<dir>/testtimes.json`. Every argv is
 *  recorded in `<home>/gh-argv`. */
const GH_STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/gh-argv"
fix="$HOME/gh-fix"
if [ "$1" = api ]; then
  f=$(printf '%s' "$2" | tr '/?&=' '____')
  [ -f "$fix/$f.json" ] || exit 1
  cat "$fix/$f.json"; exit 0
fi
if [ "$1" = run ] && [ "$2" = download ]; then
  id="$3"; dir=""
  shift 3
  while [ $# -gt 0 ]; do [ "$1" = -D ] && dir="$2"; shift; done
  [ -f "$fix/download-$id.json" ] || exit 1
  cp "$fix/download-$id.json" "$dir/testtimes.json"; exit 0
fi
exit 2
`;

const key = (p: string): string => p.replace(/[/?&=]/g, '_');
const artifact = (id: number, runId: number, over: Record<string, unknown> = {}, run: Record<string, unknown> = {}) => ({
  id, name: 'testtimes', expired: false, created_at: `2026-10-${String(10 + id).padStart(2, '0')}T00:00:00Z`,
  workflow_run: { id: runId, repository_id: REPO_ID, head_repository_id: REPO_ID, head_branch: 'main', head_sha: 'a'.repeat(40), ...run },
  ...over,
});
const trustedRun = (id: number, over: Record<string, unknown> = {}) => ({
  id, path: '.github/workflows/ci.yml', event: 'schedule', head_branch: 'main',
  repository: { id: REPO_ID }, head_repository: { id: REPO_ID }, ...over,
});

interface Box { home: string; times: string }
function box(prefix: string, opts: { url?: boolean; rows?: string | null } = {}): Box {
  const home = mkTmp(prefix);
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  // The launcher's shape: a script that runs the tree's ccrc, which finds ccrc-test and testbox-knobs beside itself.
  writeFileSync(join(home, '.local', 'bin', 'ccrc'), `#!/bin/sh\nexec "${BASH}" "${join(REPO, 'ccd', 'ccrc')}" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(home, '.ccrc', 'ccrc.env'), opts.url === false ? '' : 'CCRC_TESTBOX_URL=https://testbox.invalid:7790\n');
  const stubs = join(home, 'stub-bin');
  mkdirSync(stubs, { recursive: true });
  writeFileSync(join(stubs, 'gh'), GH_STUB, { mode: 0o755 });
  // The bash this suite runs on, ahead of the system one: `#!/usr/bin/env bash` in ccd/ccrc-test must find a bash 4+.
  symlinkSync(BASH, join(stubs, 'bash'));
  mkdirSync(join(home, 'gh-fix'), { recursive: true });
  if (opts.rows !== null) writeFileSync(join(home, '.ccrc', 'testbox-times.sources'), opts.rows ?? '# the rows\nproject-a owner-a/project-a\n');
  return { home, times: join(home, '.ccrc', 'testbox-times.json') };
}
function plantGh(home: string, slug: string, artifacts: unknown[], runs: Record<number, unknown>, downloads: Record<number, unknown>): void {
  const fix = join(home, 'gh-fix');
  writeFileSync(join(fix, `${key(`repos/${slug}`)}.json`), JSON.stringify({ id: REPO_ID, full_name: slug }));
  writeFileSync(join(fix, `${key(`repos/${slug}/actions/artifacts?name=testtimes&per_page=100`)}.json`), JSON.stringify({ total_count: artifacts.length, artifacts }));
  for (const [id, run] of Object.entries(runs)) writeFileSync(join(fix, `${key(`repos/${slug}/actions/runs/${id}`)}.json`), JSON.stringify(run));
  for (const [id, body] of Object.entries(downloads)) writeFileSync(join(fix, `download-${id}.json`), typeof body === 'string' ? body : JSON.stringify(body));
}
function run(b: Box): { code: number; stderr: string } {
  const r = spawnSync(BASH, [SCRIPT], {
    env: { HOME: b.home, PATH: `${join(b.home, 'stub-bin')}:/usr/bin:/bin`, TMPDIR: join(b.home), LANG: 'C' }, encoding: 'utf8',
  });
  return { code: r.status ?? -1, stderr: r.stderr ?? '' };
}
const ghCalls = (home: string): string[] => (existsSync(join(home, 'gh-argv'))
  ? readFileSync(join(home, 'gh-argv'), 'utf8').split('\n').filter((l) => l !== '') : []);
const leftovers = (b: Box): string[] => readdirSync(path.dirname(b.times)).filter((f) => f.includes('.tmp.'));

const NEW = { 'server/test/a.test.ts': 1200, 'server/test/b.test.ts': 300 };
const OLD = { 'server/test/a.test.ts': 9 };

describe('ccd-testbox-times: the durations file, from a trusted run, replaced whole (D-7421, D-7567)', () => {
  it('writes the newest trusted artifact nested under the row\'s name, which the budget reads', () => {
    const b = box('tbtimes-ok-');
    plantGh(b.home, 'owner-a/project-a', [artifact(1, 101), artifact(2, 102)], { 101: trustedRun(101), 102: trustedRun(102) }, { 101: OLD, 102: NEW });
    const r = run(b);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('ccd-testbox-times: wrote the durations of 1 repository to ~/.ccrc/testbox-times.json\n');
    const text = readFileSync(b.times, 'utf8');
    expect(JSON.parse(text)).toEqual({ 'project-a': NEW });
    const d = readDurations(text, 'none', 'project-a');
    expect(d.ok && [...d.durations.entries()]).toEqual(Object.entries(NEW));
    expect(ghCalls(b.home).filter((l) => l.startsWith('run download'))).toEqual([expect.stringMatching(/^run download 102 -R owner-a\/project-a -n testtimes -D \S+$/)]);
    expect(leftovers(b)).toEqual([]);
  });

  it('skips an artifact whose run is not trusted, rule by rule, for the next one that is', () => {
    const cases: readonly [string, unknown, unknown][] = [
      ['another workflow', artifact(3, 103), trustedRun(103, { path: '.github/workflows/other.yml' })],
      ['a pull_request run', artifact(3, 103), trustedRun(103, { event: 'pull_request' })],
      ['a fork\'s run', artifact(3, 103), trustedRun(103, { head_repository: { id: 7 } })],
      ['a branch run', artifact(3, 103), trustedRun(103, { head_branch: 'feature' })],
      ['an expired artifact', artifact(3, 103, { expired: true }), trustedRun(103)],
      ['an artifact off main', artifact(3, 103, {}, { head_branch: 'feature' }), trustedRun(103)],
      ['an artifact from a fork', artifact(3, 103, {}, { head_repository_id: 7 }), trustedRun(103)],
      ['another artifact name', artifact(3, 103, { name: 'testmap' }), trustedRun(103)],
    ];
    for (const [name, bad, badRun] of cases) {
      const b = box('tbtimes-trust-');
      plantGh(b.home, 'owner-a/project-a', [artifact(1, 101), bad], { 101: trustedRun(101), 103: badRun }, { 101: NEW, 103: OLD });
      expect(run(b).code, name).toBe(0);
      expect(JSON.parse(readFileSync(b.times, 'utf8')), name).toEqual({ 'project-a': NEW });
    }
  });

  it('every row is written, each under its own name; a row naming no GitHub repository is refused', () => {
    const b = box('tbtimes-two-', { rows: 'project-a owner-a/project-a\n\nproject-b owner-b/project-b\n' });
    plantGh(b.home, 'owner-a/project-a', [artifact(1, 101)], { 101: trustedRun(101) }, { 101: NEW });
    plantGh(b.home, 'owner-b/project-b', [artifact(2, 202)], { 202: trustedRun(202) }, { 202: OLD });
    expect(run(b).stderr).toBe('ccd-testbox-times: wrote the durations of 2 repositories to ~/.ccrc/testbox-times.json\n');
    expect(JSON.parse(readFileSync(b.times, 'utf8'))).toEqual({ 'project-a': NEW, 'project-b': OLD });
    const bad = box('tbtimes-badrow-', { rows: 'project-a\n' });
    writeFileSync(bad.times, JSON.stringify({ 'project-a': OLD }));
    expect(run(bad).stderr).toBe("ccd-testbox-times: kept the previous file: ~/.ccrc/testbox-times.sources has a row that is not '<repository> <owner>/<name>': project-a\n");
  });

  it('a failure keeps the previous file byte for byte, logs one line, and exits 0', () => {
    const fails: readonly [string, (b: Box) => void, string][] = [
      ['no trusted run', (b) => plantGh(b.home, 'owner-a/project-a', [artifact(1, 101)], { 101: trustedRun(101, { event: 'pull_request' }) }, { 101: NEW }),
        'project-a: no testtimes artifact of a trusted run of owner-a/project-a\'s .github/workflows/ci.yml on main'],
      ['gh cannot read the repository', () => undefined, 'project-a: gh could not read repos/owner-a/project-a'],
      ['the download fails', (b) => plantGh(b.home, 'owner-a/project-a', [artifact(1, 101)], { 101: trustedRun(101) }, {}),
        'project-a: gh could not download run 101\'s testtimes artifact'],
      ['the artifact is not a durations map', (b) => plantGh(b.home, 'owner-a/project-a', [artifact(1, 101)], { 101: trustedRun(101) }, { 101: '[1,2]' }),
        'project-a: run 101\'s testtimes.json is not a map of test file paths to milliseconds'],
    ];
    for (const [name, plant, why] of fails) {
      const b = box('tbtimes-fail-');
      const before = JSON.stringify({ 'project-a': OLD }) + '\n';
      writeFileSync(b.times, before);
      const ino = statSync(b.times).ino;
      plant(b);
      const r = run(b);
      expect(r.code, name).toBe(0);
      expect(r.stderr, name).toBe(`ccd-testbox-times: kept the previous file: ${why}\n`);
      expect(readFileSync(b.times, 'utf8'), name).toBe(before);
      expect(statSync(b.times).ino, `${name}: the file was not replaced`).toBe(ino);
      expect(leftovers(b), name).toEqual([]);
    }
  });

  it('the replace is a rename: the new file is a new inode, and no temporary file is left', () => {
    const b = box('tbtimes-atomic-');
    writeFileSync(b.times, JSON.stringify({ 'project-a': OLD }));
    const ino = statSync(b.times).ino;
    plantGh(b.home, 'owner-a/project-a', [artifact(1, 101)], { 101: trustedRun(101) }, { 101: NEW });
    expect(run(b).code).toBe(0);
    expect(statSync(b.times).ino).not.toBe(ino);
    expect(JSON.parse(readFileSync(b.times, 'utf8'))).toEqual({ 'project-a': NEW });
    expect(leftovers(b)).toEqual([]);
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/> "\$tmp" 2>\/dev\/null && mv -f "\$tmp" "\$times"/);
  });

  it('no test box configured: nothing is fetched and the file is untouched', () => {
    const b = box('tbtimes-nourl-', { url: false });
    writeFileSync(b.times, 'kept\n');
    const r = run(b);
    expect([r.code, r.stderr]).toEqual([0, 'ccd-testbox-times: no test box is configured (CCRC_TESTBOX_URL is unset); nothing fetched\n']);
    expect(ghCalls(b.home)).toEqual([]);
    expect(readFileSync(b.times, 'utf8')).toBe('kept\n');
  });

  it('no rows: the previous file is kept and gh is never asked', () => {
    const b = box('tbtimes-norows-', { rows: null });
    const r = run(b);
    expect(r.stderr).toBe('ccd-testbox-times: kept the previous file: no rows (~/.ccrc/testbox-times.sources is not there)\n');
    expect(ghCalls(b.home)).toEqual([]);
    expect(existsSync(b.times)).toBe(false);
  });

  it('CCRC_TESTBOX_TIMES moves the file and its rows together', () => {
    const b = box('tbtimes-moved-', { rows: null });
    writeFileSync(join(b.home, '.ccrc', 'ccrc.env'), `CCRC_TESTBOX_URL=https://testbox.invalid:7790\nCCRC_TESTBOX_TIMES=${join(b.home, 'elsewhere', 'times.json')}\n`);
    mkdirSync(join(b.home, 'elsewhere'));
    writeFileSync(join(b.home, 'elsewhere', 'times.sources'), 'project-a owner-a/project-a\n');
    plantGh(b.home, 'owner-a/project-a', [artifact(1, 101)], { 101: trustedRun(101) }, { 101: NEW });
    expect(run(b).stderr).toBe('ccd-testbox-times: wrote the durations of 1 repository to ~/elsewhere/times.json\n');
    expect(JSON.parse(readFileSync(join(b.home, 'elsewhere', 'times.json'), 'utf8'))).toEqual({ 'project-a': NEW });
  });
});
