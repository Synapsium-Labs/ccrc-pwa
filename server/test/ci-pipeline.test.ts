// ── ci.yml's SHAPE — the part of the pipeline no run of it can check ─────────
//
// Design 2026-09-23 §4.2: GitHub reports a job skipped by a conditional as
// SUCCESS, a job whose `needs:` failed is skipped, a workflow skipped by a
// `paths:` filter leaves its required checks PENDING forever, and a matrix
// skipped by a job-level `if:` never expands, so its `test (agent)` name
// never appears. Every one of those turns a broken pipeline into a green or
// a stuck required check, and none of them is visible from inside a run —
// the run that would notice is the run that did not happen. So the shape is
// pinned here, as text, the way build-release.test.ts pins the release
// workflows: line-anchored, per job block, never a bare substring a comment
// could satisfy.
//
// The reader is deliberately small (no YAML dependency — the select job
// runs before any `npm ci`, and this file should read the workflow the same
// way oss-metadata.test.ts's `jobBlocks` does). It goes red if it parses no
// jobs at all, so a layout change cannot make every assertion vacuous.

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');
const CI = '.github/workflows/ci.yml';
const DEPS = '.github/actions/server-deps/action.yml';

/** A top-level section — `key:` at column 0 through the line before the next
 *  column-0 key. Comments at column 0 end nothing. */
function section(yml: string, key: string): string {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}: `));
  expect(start, `${key}: not found at column 0`).toBeGreaterThan(-1);
  const out = [lines[start]];
  for (const l of lines.slice(start + 1)) {
    if (/^[A-Za-z]/.test(l)) break;
    out.push(l);
  }
  return out.join('\n');
}

/** job id → the raw text of its block (every line after its header up to the
 *  next two-space key). */
function jobs(yml: string): Map<string, string> {
  const body = section(yml, 'jobs').split('\n').slice(1);
  const acc = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const l of body) {
    const head = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(l);
    if (head) {
      expect(acc.has(head[1]), `job id ${head[1]} appears twice`).toBe(false);
      cur = [];
      acc.set(head[1], cur);
      continue;
    }
    cur?.push(l);
  }
  const out = new Map([...acc].map(([id, block]) => [id, block.join('\n')]));
  expect(out.size, 'parsed no jobs at all').toBeGreaterThan(0);
  return out;
}

/** A job-level scalar key (four-space indent), or null when absent. */
function jobKey(block: string, key: string): string | null {
  const m = new RegExp(`^ {4}${key}: (.*)$`, 'm').exec(block);
  return m ? m[1] : null;
}

/** The ids a job `needs:`, from either the flow-list or the bare-scalar form. */
function needs(block: string): string[] {
  const v = jobKey(block, 'needs');
  if (v === null) return [];
  return v.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean).sort();
}

/** Each step of a job, as the text from its `      - ` line to the next. */
function steps(block: string): string[] {
  const parts = block.split(/^(?= {6}- )/m);
  return parts.filter((p) => /^ {6}- /.test(p));
}

function job(id: string): string {
  const b = jobs(read(CI)).get(id);
  expect(b, `ci.yml has no job \`${id}\``).toBeDefined();
  return b!;
}

/** The one step of `block` whose `name:` is `name`. */
function step(block: string, name: string): string {
  const found = steps(block).filter((st) => st.includes(`name: ${name}\n`));
  expect(found, `no step named "${name}"`).toHaveLength(1);
  return found[0];
}

/** A step's `run: |` script, dedented — the bytes the runner hands to bash. */
function runScript(st: string): string {
  const lines = st.split('\n');
  const at = lines.findIndex((l) => /^ {8}run: \|$/.test(l));
  expect(at, 'the step has no `run: |` block').toBeGreaterThan(-1);
  const body: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l !== '' && !l.startsWith(' '.repeat(10))) break;
    body.push(l.slice(10));
  }
  return body.join('\n').trimEnd() + '\n';
}

describe('ci.yml: the required checks cannot go missing (design 2026-09-23 §4.2)', () => {
  it('produces all four required names — test (server), test (agent), test (pwa), build-pwa', () => {
    const all = jobs(read(CI));
    // `test (server)` is a NAMED summary job now; the matrix keeps the other two.
    expect(jobKey(job('server'), 'name')).toBe('test (server)');
    expect(job('test'), 'the matrix must stay exactly [agent, pwa] — a new axis renames both checks')
      .toMatch(/^ {8}package: \[agent, pwa\]$/m);
    expect(jobKey(job('test'), 'name'), 'a name: on the matrix renames `test (agent)` and `test (pwa)`').toBeNull();
    expect(all.has('build-pwa')).toBe(true);
    expect(jobKey(job('build-pwa'), 'name'), 'a name: on build-pwa renames the required check').toBeNull();
    // No second producer of a required name — two jobs reporting
    // `test (server)` would let the green one answer for the red one.
    const named = [...all.values()].map((b) => jobKey(b, 'name')).filter((n) => n !== null);
    for (const req of ['test (server)', 'test (agent)', 'test (pwa)', 'build-pwa']) {
      expect(named.filter((n) => n === req).length, `${req} is produced by more than one job`)
        .toBeLessThanOrEqual(1);
    }
  });

  it('the required matrix and build-pwa carry no job-level if: and no needs:', () => {
    // A job-level `if:` that skips the matrix means it never expands: no
    // `test (agent)` check exists, and the PR waits on it forever. A failed
    // `needs:` skips the job the same way.
    for (const id of ['test', 'build-pwa']) {
      expect(jobKey(job(id), 'if'), `${id} has a job-level if:`).toBeNull();
      expect(needs(job(id)), `${id} needs another job — its failure would skip a required check`).toEqual([]);
    }
  });

  it('the required legs skip by STEP, only on a refresh or a rebuild', () => {
    const leg = "${{ ((github.event_name == 'push' && !inputs.mode) || inputs.mode == 'rebuild') && 'skip' || 'run' }}";
    for (const id of ['test', 'build-pwa']) {
      expect(job(id), `${id}: the job-level leg switch`).toContain(`\n    env:\n      CCRC_LEG: ${leg}\n`);
      const s = steps(job(id));
      expect(s.length, `${id} parsed no steps`).toBeGreaterThan(0);
      for (const st of s) {
        // `if:` either on the step's own dash line or as its first-level key.
        expect(st, `${id}: a step runs even on a refresh:\n${st}`).toMatch(/^(?: {6}- | {8})if: env\.CCRC_LEG == 'run'$/m);
      }
    }
  });

  it('test (server) is a summary that fails closed: always() over select, the shards and the typecheck', () => {
    const b = job('server');
    expect(jobKey(b, 'if')).toBe('always()');
    expect(needs(b)).toEqual(['select', 'server-shard', 'server-typecheck']);
    expect(b).toMatch(/^ {8}run: node \.github\/ci\/verdict\.mjs server$/m);
    // The verdict reads these six and nothing else; a swapped pair (the
    // typecheck's result passed as the shards') would be green on a red shard.
    // EVENT comes from the workflow's own context: a pull request never
    // answers tests none (ruling T2).
    for (const line of [
      'SELECT_RESULT: ${{ needs.select.result }}',
      'TYPECHECK_RESULT: ${{ needs.server-typecheck.result }}',
      'SHARDS_RESULT: ${{ needs.server-shard.result }}',
      'TESTS: ${{ needs.select.outputs.tests }}',
      'COUNT: ${{ needs.select.outputs.count }}',
      'EVENT: ${{ github.event_name }}',
    ]) {
      expect(b, `test (server) no longer passes ${line}`).toMatch(new RegExp(`^ {10}${line.replace(/[$.{}()|]/g, '\\$&')}$`, 'm'));
    }
  });

  it('both verdicts are fronted by a script-free step that can only ADD red (ruling T1)', () => {
    // A no-op verdict.mjs (a slip in its entry guard) must not be able to turn
    // a red leg green: these steps read the job results directly and fail.
    const s = steps(job('server'))[0];
    expect(s).toBe(
      "      - name: Refuse a prerequisite that did not succeed (no script involved)\n"
      + "        if: needs.select.result != 'success' || contains(fromJSON('[\"failure\",\"cancelled\"]'), needs.server-shard.result) || contains(fromJSON('[\"failure\",\"cancelled\"]'), needs.server-typecheck.result)\n"
      + "        run: exit 1\n");
    const f = steps(job('full-suite'))[0];
    expect(f).toBe(
      "      - name: Refuse any leg that did not succeed (no script involved)\n"
      + "        if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') || contains(needs.*.result, 'skipped')\n"
      + "        run: exit 1\n");
  });

  it('no workflow-level paths: or paths-ignore: filter', () => {
    const on = section(read(CI), 'on');
    expect(on, 'a paths filter leaves the required checks Pending forever').not.toMatch(/^\s+paths(-ignore)?:/m);
  });

  it('no matrix built from select can be empty when its job runs', () => {
    // An empty `include` is a hard error ("Matrix vector does not contain any
    // values"), which would turn a docs-only PR's `count: 0` into a red shard.
    expect(jobKey(job('server-shard'), 'if')).toContain("needs.select.outputs.count != '0'");
    expect(jobKey(job('test-macos'), 'if')).toContain("needs.select.outputs.macos_count != '0'");
    expect(jobKey(job('trace-shard'), 'if')).toContain("needs.select.outputs.trace_count != '0'");
    expect(jobKey(job('map-build'), 'if')).toContain("needs.select.outputs.trace_count != '0'");
  });
});

describe('ci.yml: modes, concurrency and the selection switch (design 2026-09-23 §3, §4.3)', () => {
  it('triggers: pull_request, main pushes, a daily schedule, dispatch and call — both with a mode', () => {
    const on = section(read(CI), 'on');
    expect(on).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
    expect(on).toMatch(/^ {2}pull_request:$/m);
    expect(on).toMatch(/^ {2}schedule:\n {4}- cron: '17 3 \* \* \*'$/m);
    expect(on).toMatch(/^ {2}workflow_dispatch:\n {4}inputs:\n {6}mode:\n(?: {8}.*\n)*? {8}type: choice\n {8}options: \[full, rebuild\]\n {8}default: full$/m);
    expect(on).toMatch(/^ {2}workflow_call:\n {4}inputs:\n {6}mode:\n(?: {8}.*\n)*? {8}type: string$/m);
    expect(on, 'the stable gate reads this output').toMatch(/^ {8}value: \$\{\{ jobs\.full-suite\.outputs\.verdict \}\}$/m);
  });

  it('cancels superseded runs for pull requests only, in groups that carry the mode', () => {
    const c = section(read(CI), 'concurrency');
    expect(c).toMatch(/^ {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m);
    const g = /^ {2}group: (.*)$/m.exec(c)?.[1] ?? '';
    // `ci-` first: when release-stable calls this file, the group is evaluated
    // in the CALLER's context, and a bare `${{ github.workflow }}` would be
    // `release-stable` — the caller's own group, a deadlock.
    expect(g).toMatch(/^ci-\$\{\{ github\.workflow \}\}-/);
    for (const part of ["format('pr-{0}', github.event.pull_request.number)", "'refresh'", 'inputs.mode']) {
      expect(g, `the group no longer carries ${part}`).toContain(part);
    }
  });

  it('CCRC_SELECTION is defined exactly once, at the top level, and select reads it', () => {
    const src = read(CI);
    const defs = src.match(/^\s*CCRC_SELECTION:.*$/gm) ?? [];
    expect(defs, 'one line flips shadow to enforce — a second definition would shadow it').toHaveLength(1);
    expect(section(src, 'env')).toMatch(/^ {2}CCRC_SELECTION: (shadow|enforce)$/m);
    expect(job('select')).toContain('--selection "$CCRC_SELECTION"');
  });

  it('select asks for contents: read, checks: read and actions: read, and nothing else', () => {
    // actions: read — to list and download the trusted main artifacts the map and durations come from.
    expect(job('select')).toMatch(/^ {4}permissions:\n {6}contents: read\n {6}checks: read\n {6}actions: read\n(?! {6}[a-z-]+:)/m);
  });

  it('probe-macos runs on pull requests and the daily schedule only — never gating a called or dispatched full run', () => {
    expect(jobKey(job('probe-macos'), 'if')).toBe("github.event_name == 'pull_request' || github.event_name == 'schedule'");
  });

  it('every job declares a deadline between 1 and 60 minutes', () => {
    for (const [id, b] of jobs(read(CI))) {
      const m = /^ {4}timeout-minutes: (\d+)$/m.exec(b);
      expect(m, `job ${id} has no timeout-minutes`).not.toBeNull();
      expect(Number(m![1]), `job ${id}`).toBeGreaterThan(0);
      expect(Number(m![1]), `job ${id}`).toBeLessThanOrEqual(60);
    }
  });
});

describe('ci.yml: every select output a job reads is one select declares (design 2026-09-23 §4.1)', () => {
  it('each needs.select.outputs.X is declared in select\'s outputs, as steps.select.outputs.X', () => {
    const src = read(CI);
    const used = [...new Set([...src.matchAll(/needs\.select\.outputs\.([a-z_]+)/g)].map((m) => m[1]))].sort();
    const outputs = /^ {4}outputs:\n((?: {6}.*\n)+)/m.exec(job('select'));
    expect(outputs, 'select declares no outputs').not.toBeNull();
    const declared = new Map([...outputs![1].matchAll(/^ {6}([a-z_]+): \$\{\{ steps\.select\.outputs\.([a-z_]+) \}\}$/gm)].map((m) => [m[1], m[2]]));
    for (const [name, from] of declared) expect(from, `select output ${name} reads another step output`).toBe(name);
    for (const name of used) expect(declared.has(name), `needs.select.outputs.${name} is read but select does not declare it`).toBe(true);
    expect(used).toContain('trace_count');
  });
});

describe('ci.yml: the map\'s inputs and outputs (design 2026-09-23 §5.3-§5.5)', () => {
  it('map-build refreshes against the map select diffed from (its select-inputs artifact), never a fresh fetch', () => {
    // A refresh racing the daily rebuild's publish would otherwise diff one
    // map and carry entries from another.
    const b = job('map-build');
    expect(b, 'map-build must not fetch a map of its own').not.toContain('main-artifact.mjs --repo "$REPO" --repo-id "$REPO_ID" --name testmap\n            run_id');
    expect(step(b, 'Fetch what select handed over')).not.toMatch(/^ {8}if:/m);
    expect(step(b, 'Fetch what select handed over')).toMatch(/^ {10}name: select-inputs\n {10}path: \$\{\{ runner\.temp \}\}\/select-inputs$/m);
    const build = runScript(step(b, 'Build the map'));
    expect(build).toContain('--old "$RUNNER_TEMP/select-inputs/testmap.json"');
    // The refresh is told what select MEANT to trace, not what arrived: a test
    // whose trace went missing is written unknown, never carried stale.
    expect(build).toContain('--traced "$RUNNER_TEMP/select-inputs/traced.txt"');
    // --map always names the fetch path, so select.mjs can say "no map restored at <path>" when none was fetched.
    expect(job('select')).toContain('args=(--repo "$GITHUB_WORKSPACE" --event "$EVENT" --selection "$CCRC_SELECTION" --full-green "$FULL_GREEN" --map .ci-cache/testmap.json --trace-list .ci-cache/traced.txt)');
    expect(step(job('select'), 'Hand the map to map-build')).toMatch(/^ {10}path: \|\n {12}\.ci-cache\/testmap\.json\n {12}\.ci-cache\/traced\.txt\n {12}\.ci-cache\/testmap\.artifact$/m);
    // Handed over whenever anything is traced: a build needs the fetched map too, to tell news from old failures.
    expect(step(job('select'), 'Hand the map to map-build')).toMatch(/^ {8}if: steps\.select\.outputs\.trace != 'none'$/m);
  });

  it('map-build runs after a FAILED trace shard too, and the shard keeps whatever records it wrote', () => {
    expect(jobKey(job('map-build'), 'if')).toContain("(needs.trace-shard.result == 'success' || needs.trace-shard.result == 'failure')");
    expect(jobKey(job('map-build'), 'if')).toMatch(/^always\(\) && /);
    // A failed Trace step (a crashed trace-run, a runner problem) must still upload what it wrote, or map-build
    // counts a missing shard and writes no map at all.
    expect(step(job('trace-shard'), 'Keep the records')).toMatch(/^ {8}if: always\(\)$/m);
  });

  it('a trace shard hands trace-run exactly its matrix row\'s files — no --shard split of its own', () => {
    const t = runScript(step(job('trace-shard'), 'Trace'));
    expect(t).toBe('echo "$FILES" | tr \' \' \'\\n\' > "$RUNNER_TEMP/trace.txt"\n'
      + 'node .github/ci/trace-run.mjs --repo "$GITHUB_WORKSPACE" --files "$RUNNER_TEMP/trace.txt" --out "$RUNNER_TEMP/records.json" --jobs 2 --timeout 1560\n');
  });

  it('map-build keeps the map it built as an artifact, so a replay can fetch it (gh run download -n testmap)', () => {
    expect(step(job('map-build'), 'Keep the map as an artifact')).toMatch(/^ {10}name: testmap\n {10}path: \.ci-cache\/testmap\.json\n/m);
  });

  it('times-build merges the durations from the workspace root — the times CLI makes keys relative to its cwd', () => {
    const st = step(job('times-build'), 'Merge the durations');
    expect(st, 'a working-directory would make every key server-relative').not.toMatch(/working-directory:/);
    expect(runScript(st)).toContain('node .github/ci/shards.mjs times --out .ci-cache/testtimes.json "$RUNNER_TEMP"/times/*/times.json');
  });
});

/** A scratch dir holding fake binaries, put first on PATH for a step's script. */
function fakeBin(bins: Record<string, string>): string {
  const dir = mkTmp('ccrc-ci-fakebin-');
  for (const [name, body] of Object.entries(bins)) {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

/** Runs a step's own script under the runner's default shell, in `cwd`, with `env`. */
function runStep(st: string, cwd: string, env: Record<string, string>): { status: number | null, output: string, stdout: string } {
  const dir = mkTmp('ccrc-ci-step-');
  const script = join(dir, 'step.sh');
  writeFileSync(script, runScript(st));
  const out = join(dir, 'out');
  writeFileSync(out, '');
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
    cwd, env: { PATH: process.env.PATH ?? '', ...env, GITHUB_OUTPUT: out }, encoding: 'utf8',
  });
  return { status: r.status, output: readFileSync(out, 'utf8'), stdout: r.stdout };
}

describe('ci.yml: maps and durations come ONLY from trusted main artifacts (ruling T4)', () => {
  it('no Actions cache anywhere — a pull request can write its own cache scope', () => {
    expect(read(CI)).not.toMatch(/actions\/cache/);
  });

  it('select fetches the newest trusted testmap and testtimes (main-artifact.mjs) and downloads them', () => {
    const st = step(job('select'), 'Fetch the newest trusted map and durations');
    const s = runScript(st);
    expect(s).toContain('for name in testmap testtimes; do');
    expect(s).toContain('node .github/ci/main-artifact.mjs --repo "$REPO" --repo-id "$REPO_ID" --name "$name"');
    expect(s).toContain('gh run download "$run_id" --repo "$REPO" -n "$name" -D .ci-cache');
    // Run it with fakes: node answers run 77 / artifact 5 for testmap and nothing for testtimes; gh "downloads".
    const ws = mkTmp('ccrc-ci-fetch-');
    const bin = fakeBin({
      node: 'case "$*" in *"--name testmap"*) printf "testmap: artifact 5\\nartifact_id=5\\nrun_id=77\\nhead_sha=%s\\n" "$(printf a%.0s $(seq 40))";; *) printf "testtimes: none\\nartifact_id=\\nrun_id=\\nhead_sha=\\n";; esac',
      gh: 'echo "gh $*" >> "$GH_LOG"; for d; do :; done; echo "{}" > "$d/testmap.json"',
    });
    const r = runStep(st, ws, { PATH: `${bin}:${process.env.PATH}`, REPO: 'o/r', REPO_ID: '1', GH_LOG: join(ws, 'gh.log') });
    expect(r.status).toBe(0);
    expect(readFileSync(join(ws, '.ci-cache', 'testmap.artifact'), 'utf8')).toBe('5\n');
    expect(existsSync(join(ws, '.ci-cache', 'testtimes.artifact'))).toBe(false);
    expect(readFileSync(join(ws, 'gh.log'), 'utf8')).toBe('gh run download 77 --repo o/r -n testmap -D .ci-cache\n');
    // A failed download is no map (a full run), never a failed select — and records no artifact id.
    const ws2 = mkTmp('ccrc-ci-fetch-');
    const failing = fakeBin({
      node: 'printf "artifact_id=5\\nrun_id=77\\nhead_sha=x\\n"',
      gh: 'echo "HTTP 410: artifact expired" >&2; exit 1',
    });
    const r2 = runStep(st, ws2, { PATH: `${failing}:${process.env.PATH}`, REPO: 'o/r', REPO_ID: '1' });
    expect(r2.status).toBe(0);
    expect(r2.stdout).toContain('::warning::could not download testmap from run 77');
    expect(existsSync(join(ws2, '.ci-cache', 'testmap.artifact'))).toBe(false);
    expect(existsSync(join(ws2, '.ci-cache', 'testmap.json'))).toBe(false);
  });

  function casStep(): string { return step(job('map-build'), 'Is the map this refresh was built on still the newest?'); }

  it('a refresh publishes only if, checked just before the upload, its base map is still the newest trusted one', () => {
    const ws = mkTmp('ccrc-ci-cas-');
    mkdirSync(join(ws, 'rt', 'select-inputs'), { recursive: true });
    writeFileSync(join(ws, 'rt', 'select-inputs', 'testmap.artifact'), '5\n');
    const answer = (id: string) => fakeBin({ node: `printf "testmap\\nartifact_id=${id}\\nrun_id=9\\nhead_sha=x\\n"` });
    const same = runStep(casStep(), ws, { PATH: `${answer('5')}:${process.env.PATH}`, RUNNER_TEMP: join(ws, 'rt'), REPO: 'o/r', REPO_ID: '1' });
    expect(same.output).toBe('publish=true\n');
    const moved = runStep(casStep(), ws, { PATH: `${answer('6')}:${process.env.PATH}`, RUNNER_TEMP: join(ws, 'rt'), REPO: 'o/r', REPO_ID: '1' });
    expect(moved.output).toBe('publish=false\n');
    expect(moved.stdout).toContain('::notice::');
    const none = runStep(casStep(), ws, { PATH: `${answer('')}:${process.env.PATH}`, RUNNER_TEMP: join(ws, 'rt'), REPO: 'o/r', REPO_ID: '1' });
    expect(none.output).toBe('publish=false\n');
    // No recorded base and no newest map are not "the same map": an empty id never matches.
    writeFileSync(join(ws, 'rt', 'select-inputs', 'testmap.artifact'), '\n');
    const blank = runStep(casStep(), ws, { PATH: `${answer('')}:${process.env.PATH}`, RUNNER_TEMP: join(ws, 'rt'), REPO: 'o/r', REPO_ID: '1' });
    expect(blank.output).toBe('publish=false\n');
  });

  it('map-build publishes testmap unless that check said no; times-build publishes testtimes', () => {
    const b = job('map-build');
    expect(b).toMatch(/^ {4}permissions:\n {6}contents: read\n {6}actions: read\n(?! {6}[a-z-]+:)/m);
    expect(jobKey(b, 'if')).not.toBeNull();
    expect(casStep()).toMatch(/^ {8}if: needs\.select\.outputs\.trace == 'refresh' && needs\.select\.outputs\.map_sha != ''$/m);
    expect(step(b, 'Keep the map as an artifact')).toMatch(/^ {8}if: steps\.cas\.outputs\.publish != 'false'$/m);
    expect(step(job('times-build'), 'Keep the durations as an artifact')).toMatch(/^ {10}name: testtimes\n {10}path: \.ci-cache\/testtimes\.json\n/m);
  });
});

describe('ci.yml: map-build publishes the map it wrote, then goes red on news (spec §5.4, rulings R5-R6)', () => {
  // testmap.mjs exits 3 (a traced test newly fails under trace) or 4 (a floor test written unknown) only AFTER it
  // has written the map. The Build step records the code and carries on, so the map is published; the job's last
  // step turns it red. Any other exit (a crash: no map) stops the step there.
  function buildRepo(): { ws: string, rt: string } {
    const ws = mkTmp('ccrc-ci-mapbuild-');
    const g = (...a: string[]) => execFileSync('git', a, { cwd: ws, env: { ...process.env,
      GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
    g('init', '-q');
    mkdirSync(join(ws, 'server', 'test'), { recursive: true });
    writeFileSync(join(ws, 'server', 'test', 'a.test.ts'), '1\n');
    g('add', '-A'); g('commit', '-qm', 'fixture');
    const rt = join(ws, 'rt');
    mkdirSync(join(rt, 'records', 'records-1'), { recursive: true });
    writeFileSync(join(rt, 'records', 'records-1', 'records.json'), '{}');
    return { ws, rt };
  }
  // node: `-e` answers the matrix length (1); the testmap call logs its arguments and exits $FAKE_RC.
  const fakeNode = () => fakeBin({ node: 'if [ "$1" = "-e" ]; then echo 1; exit 0; fi\necho "$*" >> "$NODE_LOG"\nexit "$FAKE_RC"' });
  function build(rc: number, opts: { trace?: string, mapSha?: string, handedMap?: boolean } = {}) {
    const { ws, rt } = buildRepo();
    if (opts.handedMap) {
      mkdirSync(join(rt, 'select-inputs'), { recursive: true });
      writeFileSync(join(rt, 'select-inputs', 'testmap.json'), '{}');
    }
    const r = runStep(step(job('map-build'), 'Build the map'), ws, {
      PATH: `${fakeNode()}:${process.env.PATH}`, RUNNER_TEMP: rt, TRACE: opts.trace ?? 'rebuild', MAP_SHA: opts.mapSha ?? '',
      TRACE_MATRIX: '{"include":[{}]}', GITHUB_SHA: 'f'.repeat(40), FAKE_RC: String(rc), NODE_LOG: join(ws, 'node.log'),
    });
    return { ...r, log: existsSync(join(ws, 'node.log')) ? readFileSync(join(ws, 'node.log'), 'utf8') : '' };
  }

  it('exit 0, 3 or 4 from testmap.mjs: the step succeeds and says which; any other exit fails it', () => {
    expect(build(0)).toMatchObject({ status: 0, output: 'rc=0\n' });
    expect(build(3)).toMatchObject({ status: 0, output: 'rc=3\n' });
    expect(build(4)).toMatchObject({ status: 0, output: 'rc=4\n' });
    expect(build(1).status).toBe(1);
  });

  it('a build is handed the map select fetched as --old, when there was one; a refresh always is', () => {
    expect(build(0).log).toMatch(/^\.github\/ci\/testmap\.mjs build --sha f{40} --records \S+ --out \.ci-cache\/testmap\.json$/m);
    expect(build(0, { handedMap: true }).log).toMatch(/^\.github\/ci\/testmap\.mjs build --sha f{40} --old \S+\/select-inputs\/testmap\.json --records /m);
    expect(build(0, { trace: 'refresh', mapSha: 'a'.repeat(40), handedMap: true }).log).toMatch(/^\.github\/ci\/testmap\.mjs refresh --sha f{40} --old \S+\/select-inputs\/testmap\.json /m);
  });

  it('the map is uploaded whatever the build said, and a last step turns the job red when it said 3 or 4', () => {
    const b = job('map-build');
    const names = steps(b).map((st) => /^ {6}- (?:name: (.*)|uses: .*)$/m.exec(st)?.[1] ?? '');
    const upload = names.indexOf('Keep the map as an artifact');
    const red = names.indexOf('Red if the map build reported news');
    expect(upload).toBeGreaterThan(-1);
    expect(red).toBe(names.length - 1);
    expect(red).toBeGreaterThan(upload);
    expect(step(b, 'Build the map')).toMatch(/^ {8}id: build$/m);
    const last = step(b, 'Red if the map build reported news');
    expect(last).toMatch(/^ {8}if: steps\.build\.outputs\.rc != '0'$/m);
    expect(runScript(last)).toMatch(/\nexit 1\n$/);
    // The upload is gated by the pre-upload check only — never by the build's code.
    expect(step(b, 'Keep the map as an artifact')).not.toContain('steps.build');
  });
});

describe('ci.yml: a pull request that changes the pipeline runs everything, decided in plain bash (ruling T3)', () => {
  function pipelineStep(): string { return step(job('select'), 'Does this pull request change the pipeline?'); }
  const gitEnv = {
    GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  /** A repo whose origin/main is its first commit, and whose HEAD changes `changed`. */
  function prRepo(changed: string): string {
    const dir = mkTmp('ccrc-ci-pipeline-change-');
    const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, env: { ...process.env, ...gitEnv } });
    g('init', '-q'); g('checkout', '-q', '-b', 'main');
    mkdirSync(join(dir, 'server'), { recursive: true });
    writeFileSync(join(dir, 'server', 'x.ts'), '1\n');
    g('add', '-A'); g('commit', '-qm', 'base');
    g('update-ref', 'refs/remotes/origin/main', 'HEAD');
    mkdirSync(path.dirname(join(dir, changed)), { recursive: true });
    writeFileSync(join(dir, changed), '2\n');
    g('add', '-A'); g('commit', '-qm', 'the pull request');
    return dir;
  }

  it('runs only on pull_request, and hands select --input-mode full when it answers changed=true', () => {
    expect(pipelineStep()).toMatch(/^ {8}if: github\.event_name == 'pull_request'$/m);
    const sel = step(job('select'), 'Select');
    expect(sel).toMatch(/^ {10}PIPELINE_CHANGED: \$\{\{ steps\.pipeline\.outputs\.changed \}\}$/m);
    expect(runScript(sel)).toContain('elif [ "$PIPELINE_CHANGED" = true ]; then args+=(--input-mode full); fi');
  });

  it('a change under .github/ -> changed=true; anything else -> false; a base it cannot diff against -> true', () => {
    expect(runStep(pipelineStep(), prRepo('.github/ci/select-tests.mjs'), { BASE_REF: 'main' })).toMatchObject({ status: 0, output: 'changed=true\n' });
    expect(runStep(pipelineStep(), prRepo('server/y.ts'), { BASE_REF: 'main' })).toMatchObject({ status: 0, output: 'changed=false\n' });
    expect(runStep(pipelineStep(), prRepo('server/y.ts'), { BASE_REF: 'nope' })).toMatchObject({ status: 0, output: 'changed=true\n' });
  });

  it('diffs from the merge base, so a pipeline change main made since the branch point is not this pull request\'s', () => {
    const dir = prRepo('server/y.ts');
    const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, env: { ...process.env, ...gitEnv } });
    // main moves on with a .github/ change of its own, after the pull request branched.
    g('checkout', '-q', '-b', 'later-main', 'origin/main');
    mkdirSync(join(dir, '.github'), { recursive: true });
    writeFileSync(join(dir, '.github', 'x.yml'), '1\n');
    g('add', '-A'); g('commit', '-qm', 'main moves on');
    g('update-ref', 'refs/remotes/origin/main', 'HEAD');
    g('checkout', '-q', 'main');
    expect(runStep(pipelineStep(), dir, { BASE_REF: 'main' })).toMatchObject({ status: 0, output: 'changed=false\n' });
  });
});

describe('ci.yml: the daily run\'s "already green?" question fails SAFE (design 2026-09-23 §3)', () => {
  // Run the step's own script, with a fake `gh` on PATH, under the runner's
  // default shell (`bash --noprofile --norc -eo pipefail`). A gh that fails —
  // rate limit, network — must answer `full_green=false`, which runs the full
  // suite; anything else would turn an API hiccup into a skipped daily run.
  function ask(gh: string): { status: number | null, output: string } {
    const dir = mkTmp('ccrc-ci-green-');
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'gh'), `#!/bin/sh\n${gh}\n`);
    chmodSync(join(dir, 'bin', 'gh'), 0o755);
    const script = join(dir, 'step.sh');
    writeFileSync(script, runScript(step(job('select'), 'Does this commit already carry a green full-suite?')));
    const out = join(dir, 'out');
    writeFileSync(out, '');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, GITHUB_OUTPUT: out, GH_TOKEN: 'x', REPO: 'o/r', SHA: 'f'.repeat(40) },
      encoding: 'utf8',
    });
    return { status: r.status, output: readFileSync(out, 'utf8') };
  }

  it('gh fails -> full_green=false, and the step itself succeeds', () => {
    expect(ask('echo "API rate limit exceeded" >&2; exit 1')).toEqual({ status: 0, output: 'full_green=false\n' });
  });

  it('gh finds a green full-suite -> full_green=true; finds none -> false', () => {
    expect(ask('echo 123')).toEqual({ status: 0, output: 'full_green=true\n' });
    expect(ask('exit 0')).toEqual({ status: 0, output: 'full_green=false\n' });
  });
});

describe('ci.yml: the full-suite verdict and the legs it runs (design 2026-09-23 §7, §8)', () => {
  it('full-suite needs every leg — Linux shards, typecheck, agent, pwa, build, macOS — and asks verdict.mjs full', () => {
    const b = job('full-suite');
    expect(needs(b)).toEqual(['build-pwa', 'select', 'server', 'server-shard', 'server-typecheck', 'test', 'test-macos']);
    expect(jobKey(b, 'if')).toBe("always() && needs.select.outputs.tests == 'full'");
    // RESULTS carries exactly one `name=result` pair per need — never toJSON(needs), which carries every select
    // matrix and outgrows an environment string's 128 KB as the suite grows.
    expect(b).not.toContain('toJSON(needs)');
    const results = /^ {10}RESULTS: (.*)$/m.exec(b)?.[1] ?? '';
    // A pair's expression holds spaces of its own; a pair starts where a space is followed by `name=`.
    expect(results.split(/ (?=[\w-]+=)/).sort()).toEqual(needs(b).map((n) => `${n}=\${{ needs.${n}.result }}`).sort());
    expect(b).toMatch(/^ {6}verdict: \$\{\{ steps\.verdict\.outputs\.verdict \}\}$/m);
    // The output is written BY the step whose id the job output reads, and
    // only after verdict.mjs exits 0: a step's GITHUB_OUTPUT is its own, so a
    // later step writing `verdict=green` would leave `steps.verdict.outputs`
    // empty — and release-stable would never promote on a called run.
    const v = steps(b).filter((st) => /^ {8}id: verdict$/m.test(st));
    expect(v, 'exactly one step has id: verdict').toHaveLength(1);
    expect(runScript(v[0])).toBe('node .github/ci/verdict.mjs full\necho "verdict=green" >> "$GITHUB_OUTPUT"\n');
    expect(b.match(/verdict=green/g), 'verdict=green is written in one place').toHaveLength(1);
  });

  it('a shard runs exactly its list, through vitest.select.config.ts', () => {
    const run = 'CCRC_TEST_LIST="$RUNNER_TEMP/tests.txt" ./node_modules/.bin/vitest run --config vitest.select.config.ts ${VITEST_SHARD:+--shard=$VITEST_SHARD}';
    for (const id of ['server-shard', 'test-macos']) {
      expect(job(id), `${id}: the list file`).toContain(`echo "$FILES" | tr ' ' '\\n' > "$RUNNER_TEMP/tests.txt"`);
      expect(job(id), `${id}: the exact-list run`).toContain(run);
    }
  });

  it('every server-running job installs through server-deps, and the Linux arm installs strace', () => {
    for (const [id, platform] of [['server-shard', 'linux'], ['trace-shard', 'linux'], ['test-macos', 'macos']] as const) {
      expect(job(id), `${id} must install what any server file needs`)
        .toMatch(new RegExp(`^ {6}- uses: \\./\\.github/actions/server-deps\\n {8}with:\\n {10}platform: ${platform}$`, 'm'));
    }
    const a = read(DEPS);
    expect(a).toMatch(/^ {4}- name: Install system dependencies \(linux\)\n {6}if: inputs\.platform == 'linux'\n {6}shell: bash\n {6}run: sudo apt-get update && sudo apt-get install -y tmux jq strace python3$/m);
    expect(a).toMatch(/^ {4}- name: Install system dependencies \(macos\)\n {6}if: inputs\.platform == 'macos'\n {6}shell: bash\n {6}run: brew install bash tmux flock jq coreutils$/m);
    for (const pkg of ['server', 'agent', 'pwa']) {
      expect(a, `server-deps no longer installs ${pkg}/`).toMatch(new RegExp(`^ {6}working-directory: ${pkg}\\n {6}run: npm ci$`, 'm'));
    }
  });
});
