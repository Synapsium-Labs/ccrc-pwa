// The select job's CLI (`.github/ci/select.mjs`, spec §3-§4 and §6, CONTRACT.md
// Task 9). Every scenario here runs the CLI as a real child process against a
// fixture git repo, a fixture `TestMap`, and (for `decideMode` alone) a direct
// import — matching every OTHER `.github/ci/*.mjs` module's test convention of
// importing relatively with `allowJs` (CONTRACT.md "Conventions"). `GITHUB_OUTPUT`
// and `GITHUB_STEP_SUMMARY` point at temp files per CONTRACT.md's own wiring
// section, never at the real Actions environment.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideMode, modeInvariantViolation } from '../../.github/ci/select.mjs';
import { mkTmp } from './tmpHelpers.js';

const SELECT_MJS = path.resolve(__dirname, '../../.github/ci/select.mjs');

// Same fixture-git-identity idiom as build-release.test.ts / release-main.test.ts
// / ccrc-install.test.ts (grep 'GIT_AUTHOR_EMAIL' server/test/*.ts): an
// `@example.invalid` address, never a real one — topology-clean forbids a real
// `user@host` token in committed text, and this file's own literals are read by
// that guard too.
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
}

function writeFile(repo: string, rel: string, content: string): void {
  const full = path.join(repo, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commitAll(repo: string, message: string): string {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

function initRepo(): string {
  const repo = mkTmp('ccrc-ci-select-repo-');
  git(repo, ['init', '-q']);
  git(repo, ['checkout', '-q', '-b', 'main']);
  return repo;
}

type DepRecordFixture = { read?: string[]; probed?: string[]; listed?: string[]; subtree?: string[]; git?: boolean };

function depRecord(opts: DepRecordFixture = {}) {
  return { read: opts.read ?? [], probed: opts.probed ?? [], listed: opts.listed ?? [], subtree: opts.subtree ?? [], git: !!opts.git };
}

function testRecord(opts: DepRecordFixture & { unknown?: boolean } = {}) {
  return { ...depRecord(opts), unknown: !!opts.unknown };
}

function writeMapFile(repo: string, map: unknown): string {
  const file = path.join(repo, 'testmap.json');
  writeFileSync(file, JSON.stringify(map));
  return file;
}

/** Base commit: package.json, two src files, four server test files. Map
 *  records: `a` READS `src/foo.ts` (rule 3), `b` PROBES `src/newfile.ts`
 *  (rule 4), `c` is `git: true` (rule 2, always), `d` reads/probes/lists
 *  nothing (never selected — the file that makes shadow vs. enforce
 *  observable). HEAD then modifies `foo.ts` and adds `newfile.ts`, touching
 *  neither `package.json` nor anything under `.github/`, so no full trigger
 *  fires — the selection below is a real per-rule one, not a fallback. */
function buildMainFixture() {
  const repo = initRepo();
  writeFile(repo, 'package.json', '{"name":"x"}\n');
  writeFile(repo, 'src/foo.ts', 'export const foo = 1;\n');
  writeFile(repo, 'src/bar.ts', 'export const bar = 1;\n');
  writeFile(repo, 'server/test/a.test.ts', "it('a', () => {});\n");
  writeFile(repo, 'server/test/b.test.ts', "it('b', () => {});\n");
  writeFile(repo, 'server/test/c.test.ts', "it('c', () => {});\n");
  writeFile(repo, 'server/test/d.test.ts', "it('d', () => {});\n");
  const baseSha = commitAll(repo, 'base');

  const map = {
    format: 1,
    sha: baseSha,
    baseline: depRecord(),
    tests: {
      'server/test/a.test.ts': testRecord({ read: ['src/foo.ts'] }),
      'server/test/b.test.ts': testRecord({ probed: ['src/newfile.ts'] }),
      'server/test/c.test.ts': testRecord({ git: true }),
      'server/test/d.test.ts': testRecord({}),
    },
  };
  const mapFile = writeMapFile(repo, map);

  writeFile(repo, 'src/foo.ts', 'export const foo = 2;\n');
  writeFile(repo, 'src/newfile.ts', 'export const n = 1;\n');
  const headSha = commitAll(repo, 'head');

  return { repo, mapFile, baseSha, headSha };
}

/** A second base commit whose HEAD instead bumps `package.json` — the full
 *  trigger of spec §6.3 / CONTRACT.md's `fullTrigger`, which must fire before
 *  any per-file rule is even consulted. */
function buildFullTriggerFixture() {
  const repo = initRepo();
  writeFile(repo, 'package.json', '{"name":"x"}\n');
  writeFile(repo, 'server/test/a.test.ts', "it('a', () => {});\n");
  const baseSha = commitAll(repo, 'base');
  const map = {
    format: 1,
    sha: baseSha,
    baseline: depRecord(),
    tests: { 'server/test/a.test.ts': testRecord({}) },
  };
  const mapFile = writeMapFile(repo, map);
  writeFile(repo, 'package.json', '{"name":"x","version":"2"}\n');
  commitAll(repo, 'bump package.json');
  return { repo, mapFile };
}

/** Parses the `name<<DELIM` / value-lines / `DELIM` records `select.mjs`
 *  writes to `$GITHUB_OUTPUT` (GitHub Actions' own multiline-safe format —
 *  load-bearing here because the JSON matrices and free-text fallback
 *  reasons this CLI writes are exactly the values that format exists for). */
function parseGithubOutput(text: string): Record<string, string> {
  const lines = text.split('\n');
  const out: Record<string, string> = {};
  let i = 0;
  while (i < lines.length) {
    const m = /^([A-Za-z0-9_]+)<<(.+)$/.exec(lines[i]);
    if (!m) { i++; continue; }
    const [, key, delim] = m;
    i++;
    const valueLines: string[] = [];
    while (i < lines.length && lines[i] !== delim) { valueLines.push(lines[i]); i++; }
    out[key] = valueLines.join('\n');
    i++;
  }
  return out;
}

type RunOpts = { event: string; inputMode?: string; selection?: 'shadow' | 'enforce'; fullGreen?: 'true' | 'false'; mapFile?: string; timesFile?: string; traceList?: string };

function runSelect(repo: string, opts: RunOpts) {
  const io = mkTmp('ccrc-ci-select-io-');
  const outputFile = path.join(io, 'output.txt');
  const summaryFile = path.join(io, 'summary.md');
  writeFileSync(outputFile, '');
  writeFileSync(summaryFile, '');

  const args = [
    SELECT_MJS,
    '--repo', repo,
    '--event', opts.event,
    '--selection', opts.selection ?? 'enforce',
    '--full-green', opts.fullGreen ?? 'false',
  ];
  if (opts.inputMode) args.push('--input-mode', opts.inputMode);
  if (opts.mapFile) args.push('--map', opts.mapFile);
  if (opts.timesFile) args.push('--times', opts.timesFile);
  if (opts.traceList) args.push('--trace-list', opts.traceList);

  let status = 0;
  let stderr = '';
  try {
    execFileSync('node', args, {
      env: { ...process.env, GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile },
      encoding: 'utf8',
    });
  } catch (e) {
    status = (e as { status?: number }).status ?? 1;
    stderr = String((e as { stderr?: Buffer | string }).stderr ?? '');
  }

  const outputs = parseGithubOutput(readFileSync(outputFile, 'utf8'));
  const summary = readFileSync(summaryFile, 'utf8');
  return { status, stderr, outputs, summary };
}

/** The distinct SERVER-relative files named across a `toMatrix` JSON string's
 *  `include[].files` (space-joined) — used to check `count`/`macos_count`
 *  against what the matrix actually carries, independent of how many shards
 *  repeat a file (the `durations === null` hash-shard fallback gives every
 *  shard ALL files, so summing shard sizes would over-count). */
function uniqueFilesInMatrix(matrixJson: string): Set<string> {
  const parsed = JSON.parse(matrixJson) as { include: Array<{ files: string }> };
  const set = new Set<string>();
  for (const row of parsed.include) {
    for (const f of row.files.split(' ').filter(Boolean)) set.add(f);
  }
  return set;
}

function expectValidMatrix(matrixJson: string): void {
  expect(matrixJson.includes('\n')).toBe(false);
  const parsed = JSON.parse(matrixJson);
  expect(Array.isArray(parsed.include)).toBe(true);
}

describe('decideMode', () => {
  it('pull_request -> selected/none', () => {
    expect(decideMode({ event: 'pull_request', fullGreen: false })).toEqual({ tests: 'selected', trace: 'none', skip: false });
  });

  it('push with no inputMode -> none/refresh', () => {
    expect(decideMode({ event: 'push', fullGreen: false })).toEqual({ tests: 'none', trace: 'refresh', skip: false });
  });

  it('push WITH an inputMode does not take the refresh branch (falls through to the inputMode rules)', () => {
    expect(decideMode({ event: 'push', inputMode: 'full', fullGreen: false }))
      .toEqual({ tests: 'full', trace: 'none', skip: false });
  });

  it('schedule, full-green true -> none/none/skip', () => {
    expect(decideMode({ event: 'schedule', fullGreen: true })).toEqual({ tests: 'none', trace: 'none', skip: true });
  });

  it('schedule, full-green false -> full/rebuild', () => {
    expect(decideMode({ event: 'schedule', fullGreen: false })).toEqual({ tests: 'full', trace: 'rebuild', skip: false });
  });

  it("inputMode 'full' -> full/none", () => {
    expect(decideMode({ event: 'workflow_dispatch', inputMode: 'full', fullGreen: false }))
      .toEqual({ tests: 'full', trace: 'none', skip: false });
  });

  it("inputMode 'rebuild' -> none/rebuild", () => {
    expect(decideMode({ event: 'workflow_dispatch', inputMode: 'rebuild', fullGreen: false }))
      .toEqual({ tests: 'none', trace: 'rebuild', skip: false });
  });

  it("push WITH inputMode 'full' (release-stable's workflow_call: the caller's event is a push to stable) -> full/none", () => {
    expect(decideMode({ event: 'push', inputMode: 'full', fullGreen: true }))
      .toEqual({ tests: 'full', trace: 'none', skip: false });
  });

  it('workflow_call with mode full -> full/none, same as workflow_dispatch', () => {
    expect(decideMode({ event: 'workflow_call', inputMode: 'full', fullGreen: false }))
      .toEqual({ tests: 'full', trace: 'none', skip: false });
  });

  it("pull_request WITH inputMode 'full' (its own pipeline changed — ci.yml's plain-bash check) -> full/none", () => {
    expect(decideMode({ event: 'pull_request', inputMode: 'full', fullGreen: false }))
      .toEqual({ tests: 'full', trace: 'none', skip: false });
  });

  it('anything else (no matching event, no inputMode) -> full/none', () => {
    expect(decideMode({ event: 'workflow_dispatch', fullGreen: false })).toEqual({ tests: 'full', trace: 'none', skip: false });
  });
});

describe('modeInvariantViolation: what a trigger can never answer (ruling T2)', () => {
  it('a pull_request never answers tests none', () => {
    expect(modeInvariantViolation('pull_request', undefined, 'none')).toMatch(/pull_request/);
    expect(modeInvariantViolation('pull_request', undefined, 'selected')).toBeNull();
    expect(modeInvariantViolation('pull_request', 'full', 'full')).toBeNull();
  });

  it('a schedule, a refresh push and a rebuild never answer tests selected', () => {
    expect(modeInvariantViolation('schedule', undefined, 'selected')).toMatch(/schedule/);
    expect(modeInvariantViolation('push', undefined, 'selected')).toMatch(/push/);
    expect(modeInvariantViolation('workflow_dispatch', 'rebuild', 'selected')).toMatch(/rebuild/);
    expect(modeInvariantViolation('schedule', undefined, 'full')).toBeNull();
    expect(modeInvariantViolation('push', undefined, 'none')).toBeNull();
    expect(modeInvariantViolation('push', 'full', 'full')).toBeNull();
  });
});

describe('select.mjs CLI — pull_request', () => {
  it('enforce: selects exactly the rule-3/4/2 files, table carries the reasons, matrices carry only the selection', () => {
    const { repo, mapFile, baseSha } = buildMainFixture();
    const { status, outputs, summary } = runSelect(repo, { event: 'pull_request', selection: 'enforce', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('selected');
    expect(outputs.trace).toBe('none');
    expect(outputs.shadow).toBe('false');
    expect(outputs.fallback).toBe('');
    expect(outputs.map_sha).toBe(baseSha);

    expectValidMatrix(outputs.server_matrix);
    expectValidMatrix(outputs.macos_matrix);
    const files = uniqueFilesInMatrix(outputs.server_matrix);
    expect(files).toEqual(new Set(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts']));
    expect(outputs.count).toBe('3');
    expect(outputs.macos_count).toBe('3');
    expect(uniqueFilesInMatrix(outputs.macos_matrix).size).toBe(Number(outputs.macos_count));

    expect(summary).toContain('| rule | test | changed path |');
    expect(summary).toContain('| 3 READ | `server/test/a.test.ts` | `src/foo.ts` |');
    expect(summary).toContain('| 4 PROBED | `server/test/b.test.ts` | `src/newfile.ts` |');
    expect(summary).toContain('| 2 ALWAYS | `server/test/c.test.ts` |');
    expect(summary).not.toContain('server/test/d.test.ts');
  });

  it('a directory a test linked whole: a change under it selects the test, and the table names rule 6 SUBTREE', () => {
    const repo = initRepo();
    writeFile(repo, 'lib/linked.sh', 'echo 1\n');
    writeFile(repo, 'server/test/linker.test.ts', "it('l', () => {});\n");
    writeFile(repo, 'server/test/other.test.ts', "it('o', () => {});\n");
    const baseSha = commitAll(repo, 'base');
    const mapFile = writeMapFile(repo, {
      format: 1, sha: baseSha, baseline: depRecord(),
      tests: {
        'server/test/linker.test.ts': testRecord({ subtree: ['lib'] }),
        'server/test/other.test.ts': testRecord({ read: ['src/other.ts'] }),
      },
    });
    writeFile(repo, 'lib/linked.sh', 'echo 2\n');
    commitAll(repo, 'change a file under the linked directory');
    const { status, outputs, summary } = runSelect(repo, { event: 'pull_request', selection: 'enforce', mapFile });
    expect(status).toBe(0);
    expect(outputs.tests).toBe('selected');
    expect(uniqueFilesInMatrix(outputs.server_matrix)).toEqual(new Set(['test/linker.test.ts']));
    expect(summary).toContain('| 6 SUBTREE | `server/test/linker.test.ts` | `lib/linked.sh` |');
  });

  it('shadow: table shows the SAME would-be selection, but the matrices carry ALL live tests and shadow=true', () => {
    const { repo, mapFile } = buildMainFixture();
    const { status, outputs, summary } = runSelect(repo, { event: 'pull_request', selection: 'shadow', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('selected');
    expect(outputs.shadow).toBe('true');

    // The reason table is still the real, narrow selection (would-be), not
    // the broadened shadow file list.
    expect(summary).toContain('server/test/a.test.ts');
    expect(summary).toContain('server/test/b.test.ts');
    expect(summary).toContain('server/test/c.test.ts');

    // But the matrices — what actually runs in shadow mode — carry every
    // live test, including `d`, which no rule selected.
    const files = uniqueFilesInMatrix(outputs.server_matrix);
    expect(files).toEqual(new Set(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts']));
    expect(outputs.count).toBe('4');
    expect(outputs.macos_count).toBe('4');
  });

  it('missing map -> full, non-empty fallback, matrices carry every live test', () => {
    const { repo } = buildMainFixture();
    const missingMap = path.join(repo, 'does-not-exist.json');
    const { status, outputs } = runSelect(repo, { event: 'pull_request', mapFile: missingMap });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    // Says what happened and where it looked — ci.yml always passes the fetch
    // path, so "no map restored" is the ordinary first-run answer, not an error.
    expect(outputs.fallback).toBe(`map: no map restored at ${missingMap}`);
    expect(outputs.map_sha).toBe('');
    const files = uniqueFilesInMatrix(outputs.server_matrix);
    expect(files).toEqual(new Set(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts']));
    expect(outputs.count).toBe('4');
  });

  it('a map file that exists but cannot be read (invalid JSON) -> full, the fallback names the read error', () => {
    // The file-exists path reaches readMap; a corrupt map must fall back to
    // full, never be taken as an empty selection.
    const { repo } = buildMainFixture();
    const corrupt = path.join(repo, 'corrupt-map.json');
    writeFileSync(corrupt, '{not json');
    const { status, outputs } = runSelect(repo, { event: 'pull_request', mapFile: corrupt });
    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.fallback).toMatch(/^map: invalid JSON: /);
    expect(outputs.count).toBe('4');
  });

  it('no --map at all -> full, and the fallback says no map was given', () => {
    const { repo } = buildMainFixture();
    const { status, outputs } = runSelect(repo, { event: 'pull_request' });
    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.fallback).toBe('map: no map restored (select.mjs was given no --map)');
  });

  it('map whose commit is not in the checkout -> full, non-empty fallback', () => {
    const { repo } = buildMainFixture();
    const fakeSha = 'a'.repeat(40);
    const mapFile = writeMapFile(repo, { format: 1, sha: fakeSha, baseline: depRecord(), tests: {} });
    const { status, outputs } = runSelect(repo, { event: 'pull_request', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.fallback.length).toBeGreaterThan(0);
    expect(outputs.map_sha).toBe('');
  });

  it('live tests that cannot be listed (a broken --repo) -> exits non-zero and writes no outputs', () => {
    // Not `full` with an empty list: `tests: full, count: 0` skips every
    // shard, and verdict.mjs reads a skip with count 0 as a pass — a green
    // `test (server)` that ran nothing. A select that fails makes it red.
    const { mapFile } = buildMainFixture();
    const badRepoHolder = mkTmp('ccrc-ci-select-badrepo-');
    const notADirectory = path.join(badRepoHolder, 'this-is-a-file.txt');
    writeFileSync(notADirectory, 'not a directory\n');

    const { status, stderr, outputs } = runSelect(notADirectory, { event: 'pull_request', mapFile });

    expect(status).not.toBe(0);
    expect(stderr).toContain('cannot list the live server tests');
    expect(outputs).toEqual({});
  });

  it('a tree with no server test files at all -> exits non-zero (never a zero-test full run)', () => {
    const repo = initRepo();
    writeFile(repo, 'package.json', '{"name":"x"}\n');
    commitAll(repo, 'no tests');
    const { status, stderr, outputs } = runSelect(repo, { event: 'schedule' });
    expect(status).not.toBe(0);
    expect(stderr).toContain('no live server test files');
    expect(outputs).toEqual({});
  });

  it('a live test path with whitespace -> exits non-zero: a space-joined matrix would split it into two wrong filters', () => {
    const repo = initRepo();
    writeFile(repo, 'server/test/a.test.ts', "it('a', () => {});\n");
    writeFile(repo, 'server/test/has space.test.ts', "it('s', () => {});\n");
    commitAll(repo, 'a spaced test file');
    const { status, stderr, outputs } = runSelect(repo, { event: 'pull_request' });
    expect(status).not.toBe(0);
    expect(stderr).toContain('server/test/has space.test.ts');
    expect(stderr).toContain('whitespace');
    expect(outputs).toEqual({});
  });

  // Final review FR-2: a name git would C-quote (a non-ASCII byte, `"`, `\\`, a control character) used to fail
  // the `.test.ts` filter and silently leave every list — so the daily run and the stable gate went green
  // without it. Non-ASCII names now pass and run; the names a space-joined shard list or a one-per-line list
  // file cannot carry are refused by name, loudly, like whitespace.
  it('a non-ASCII test name is listed, counted and sharded in a full run (and traced in its rebuild)', () => {
    const repo = initRepo();
    writeFile(repo, 'server/test/a.test.ts', "it('a', () => {});\n");
    writeFile(repo, 'server/test/café.test.ts', "it('c', () => {});\n");
    commitAll(repo, 'a non-ASCII test name');
    const { status, outputs } = runSelect(repo, { event: 'schedule' });
    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.count).toBe('2');
    expect(uniqueFilesInMatrix(outputs.server_matrix)).toEqual(new Set(['test/a.test.ts', 'test/café.test.ts']));
    expect(uniqueFilesInMatrix(outputs.macos_matrix)).toEqual(new Set(['test/a.test.ts', 'test/café.test.ts']));
    expect(uniqueFilesInMatrix(outputs.trace_matrix)).toEqual(new Set(['test/a.test.ts', 'test/café.test.ts']));
  });

  for (const [what, name] of [
    ['a double quote', 'server/test/q"uote.test.ts'],
    ['a backslash', 'server/test/back\\slash.test.ts'],
    ['a control character', 'server/test/bell\u0007.test.ts'],
    ['a newline', 'server/test/new\nline.test.ts'],
  ] as const) {
    it(`a live test path with ${what} -> exits non-zero, naming it, and writes no outputs`, () => {
      const repo = initRepo();
      writeFile(repo, 'server/test/a.test.ts', "it('a', () => {});\n");
      writeFile(repo, name, "it('q', () => {});\n");
      commitAll(repo, `a test name with ${what}`);
      const { status, stderr, outputs } = runSelect(repo, { event: 'schedule' });
      expect(status).not.toBe(0);
      expect(stderr).toContain(JSON.stringify(name));
      expect(outputs).toEqual({});
    });
  }

  it("--input-mode full on a pull_request (its pipeline changed) -> tests full, no map consulted", () => {
    const { repo, mapFile } = buildMainFixture();
    const { status, outputs, summary } = runSelect(repo, { event: 'pull_request', inputMode: 'full', mapFile });
    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.trace).toBe('none');
    expect(outputs.count).toBe('4');
    expect(summary).toContain('input mode: `full`');
  });

  it('a map whose commit is not an ancestor of HEAD -> full: a map from another line of history is not trusted', () => {
    const repo = initRepo();
    writeFile(repo, 'server/test/a.test.ts', "it('a', () => {});\n");
    commitAll(repo, 'base');
    git(repo, ['checkout', '-q', '-b', 'side']);
    writeFile(repo, 'side.txt', 'x\n');
    const sideSha = commitAll(repo, 'side');
    git(repo, ['checkout', '-q', 'main']);
    writeFile(repo, 'main.txt', 'y\n');
    commitAll(repo, 'main moves on');
    const mapFile = writeMapFile(repo, {
      format: 1, sha: sideSha, baseline: depRecord(), tests: { 'server/test/a.test.ts': testRecord({}) },
    });
    const { status, outputs } = runSelect(repo, { event: 'pull_request', mapFile });
    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.fallback).toBe(`map: ${sideSha} is not an ancestor of HEAD`);
  });

  it('macOS budget follows the EVENT: a pull request that fell back to full still gets at most 2 macOS shards', () => {
    const { repo } = buildMainFixture();
    const times = path.join(mkTmp('ccrc-ci-select-times-'), 'times.json');
    writeFileSync(times, JSON.stringify(Object.fromEntries(['a', 'b', 'c', 'd'].map((n) => [`server/test/${n}.test.ts`, 10_000_000]))));
    const pr = runSelect(repo, { event: 'pull_request', timesFile: times });
    expect(pr.outputs.tests).toBe('full');
    expect(JSON.parse(pr.outputs.macos_matrix).include).toHaveLength(2);
    const daily = runSelect(repo, { event: 'schedule', timesFile: times });
    expect(daily.outputs.tests).toBe('full');
    expect(JSON.parse(daily.outputs.macos_matrix).include).toHaveLength(4);
  });

  it('a full trigger (package.json changed) -> full, fallback names the file', () => {
    const { repo, mapFile } = buildFullTriggerFixture();
    const { status, outputs } = runSelect(repo, { event: 'pull_request', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.fallback).toContain('package.json');
  });
});

/** Every `files` entry across a matrix, repeats kept — to prove each file is in exactly one shard. */
function allFilesInMatrix(matrixJson: string): string[] {
  const parsed = JSON.parse(matrixJson) as { include: Array<{ files: string }> };
  return parsed.include.flatMap((row) => row.files.split(' ').filter(Boolean)).sort();
}

describe('select.mjs CLI — push (refresh)', () => {
  it('tests: none; trace: refresh with the affected list, not the whole tree', () => {
    const { repo, mapFile, baseSha } = buildMainFixture();
    // --input-mode omitted, as ci.yml omits it on a push to main.
    const { status, outputs } = runSelect(repo, { event: 'push', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('none');
    expect(outputs.trace).toBe('refresh');
    expect(outputs.count).toBe('0');
    expect(outputs.macos_count).toBe('0');
    expect(JSON.parse(outputs.server_matrix).include).toEqual([]);
    expect(outputs.map_sha).toBe(baseSha);

    const traced = uniqueFilesInMatrix(outputs.trace_matrix);
    expect(traced).toEqual(new Set(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts']));
    expect(outputs.trace_count).toBe('3');
  });

  it('the trace matrix is an exact partition even with no durations: each file once, no vitest --shard', () => {
    // trace-run.mjs takes an exact list and has no --shard, so the trace plan
    // must never be the every-shard-gets-everything fallback the test legs use.
    const { repo, mapFile } = buildMainFixture();
    const { outputs } = runSelect(repo, { event: 'workflow_dispatch', inputMode: 'rebuild', mapFile });
    const rows = JSON.parse(outputs.trace_matrix).include as Array<{ vitest_shard: string }>;
    expect(rows.every((r) => r.vitest_shard === '')).toBe(true);
    expect(allFilesInMatrix(outputs.trace_matrix)).toEqual(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts']);
    expect(outputs.trace_count).toBe('4');
  });

  it('--trace-list writes the trace list select MEANT to trace, repo-relative — what map-build refreshes against', () => {
    const { repo, mapFile } = buildMainFixture();
    const traceList = path.join(mkTmp('ccrc-ci-select-tl-'), 'sub', 'traced.txt');
    const { status } = runSelect(repo, { event: 'push', mapFile, traceList });
    expect(status).toBe(0);
    expect(readFileSync(traceList, 'utf8')).toBe('server/test/a.test.ts\nserver/test/b.test.ts\nserver/test/c.test.ts\n');
  });

  it("push WITH --input-mode full (release-stable's call) -> tests full, trace none, nothing to trace", () => {
    const { repo, mapFile } = buildMainFixture();
    const { status, outputs } = runSelect(repo, { event: 'push', inputMode: 'full', mapFile });
    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.trace).toBe('none');
    expect(outputs.trace_count).toBe('0');
    expect(outputs.count).toBe('4');
  });
});

describe('select.mjs CLI — schedule', () => {
  it('full-green true -> skip: everything none/empty', () => {
    const { repo, mapFile } = buildMainFixture();
    const { status, outputs } = runSelect(repo, { event: 'schedule', fullGreen: 'true', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('none');
    expect(outputs.trace).toBe('none');
    expect(outputs.shadow).toBe('false');
    expect(outputs.count).toBe('0');
    expect(outputs.macos_count).toBe('0');
    expect(JSON.parse(outputs.server_matrix).include).toEqual([]);
    expect(JSON.parse(outputs.macos_matrix).include).toEqual([]);
    expect(JSON.parse(outputs.trace_matrix).include).toEqual([]);
    expect(outputs.trace_count).toBe('0');
    expect(outputs.map_sha).toBe('');
    expect(outputs.fallback).toBe('');
  });

  it('full-green false -> full + rebuild, every live test in both the test and trace matrices', () => {
    const { repo, mapFile } = buildMainFixture();
    const { status, outputs } = runSelect(repo, { event: 'schedule', fullGreen: 'false', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.trace).toBe('rebuild');
    expect(outputs.map_sha).toBe('');

    const all = new Set(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts']);
    expect(uniqueFilesInMatrix(outputs.server_matrix)).toEqual(all);
    expect(uniqueFilesInMatrix(outputs.trace_matrix)).toEqual(all);
    expect(outputs.count).toBe('4');
  });
});

describe('select.mjs CLI — workflow_dispatch', () => {
  it("input mode 'rebuild' -> tests none, trace rebuild traces every live test", () => {
    const { repo, mapFile } = buildMainFixture();
    const { status, outputs } = runSelect(repo, { event: 'workflow_dispatch', inputMode: 'rebuild', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('none');
    expect(outputs.trace).toBe('rebuild');
    expect(outputs.count).toBe('0');
    expect(JSON.parse(outputs.server_matrix).include).toEqual([]);

    const traced = uniqueFilesInMatrix(outputs.trace_matrix);
    expect(traced).toEqual(new Set(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts']));
  });
});
