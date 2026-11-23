// D-8166 (plan docs/superpowers/plans/2026-11-10-test-box-connect.md, Task TC9; spec §2.8, C8, C16): the parity tool's scope and
// record (`ccd/testbox-parity --recent --fixtures --record`) and the verb's `parity` sub (`ccrc testbox-admin parity`).
//
// What is held here: that the default scope is the newest merged pull request of each installed row, over a sample of its tests
// (D-8945: the changed tests, the known load flakes and a fixed sha256 spread, costed by CI's per-file times), and that named
// pull requests replace it; that each of the three fixtures runs on both sides and a byte difference fails it; that the record
// carries the result, the pull requests and revisions, the fixtures, the release, the tools key, the fingerprint, the box
// file's sha256 and the time, at 0600, in the shape `readTestboxParityRecord` reads; that a leg that differs writes a fail
// record; that `gh` signed out is refused before any unit with no record; that the unit runs in `ccrctests.slice`; and that a
// pass clears the stale mark.
//
// Two layers. The tool runs against a real fixture repository (a worktree per revision, no lockfile so no install) with fake
// `gh`, `ccrc-test` and box client: the seams of the tool itself (`TP_GH`, and the two files it finds beside itself). The verb
// runs with a fake `ssh` (the rules of the connect tests), a fake tool (`TBA_PARITY_TOOL`) and a fake `gh` (`TBA_GH`); the
// detached act runs in this process as the unit would. HOME is a fixture; ghContainedEnv poisons the user manager and tmux.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { TESTBOX_ADMIN_DEADLINE_S, parityArmable, readTestboxAdminStatus, readTestboxParityRecord } from '../../shared/testbox-admin.js';
import { CI_WORKFLOW_PATH, TRUSTED_EVENTS } from '../../.github/ci/main-artifact.mjs';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERB = join(REPO, 'ccd', 'ccrc-testbox-admin');
const TOOL = join(REPO, 'ccd', 'testbox-parity');
const BOXFAKE = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-connect-ssh.sh');
const SCANFAKE = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-ssh.sh');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const has = (c: string): boolean => spawnSync('bash', ['-c', `command -v ${c}`], { encoding: 'utf8' }).status === 0;
const HAS_ALL = has('ssh-keygen') && has('flock') && has('node') && has('git');
/** GNU `timeout`: what the platform shim bounds a parity leg and the tool with, KILL included (D-8899). */
const HAS_TIMEOUT = has('timeout');
const ADDR = '203.0.113.9';
const SRC_ADDR = '192.0.2.5';
const TOOLS = '/opt/tools';
const SHA = 'b'.repeat(64);
const FP = `SHA256:${'A'.repeat(43)}`;
const SRC = '. "$1" || exit 90; shift; REAL_OS=$CCD_OS; CCD_OS=linux; '
  + 'for f in _plat_mode _plat_sha256; do eval "$(declare -f $f | sed "1s/^$f/${f}_real/")"; eval "$f() { local CCD_OS=\\$REAL_OS; ${f}_real \\"\\$@\\"; }"; done; ';
const FX = ['git-state', 'socket', 'workers'] as const;

// ── the tool ────────────────────────────────────────────────────────────────────────────────────────────────────────
interface ToolFix { dir: string; repo: string; revs: string[]; env: NodeJS.ProcessEnv; tool: string; ghLog: string; clientLog: string; localLog: string }
/** The fixture repository's test files: `server/test/t<i>.test.ts`, so a leg runs exactly the files it was asked for. */
const N_TESTS = 200;
const TESTS = Array.from({ length: N_TESTS }, (_, i) => `test/t${i}.test.ts`);
/** What the newest pull request (revs[5]) changed among them, and the fixture's `server/load-flakes.txt` (one is gone at the rev).
 *  It also changes a tracked test outside the package's vitest include (E2E), which the package's vitest never lists. */
const CHANGED = ['test/t3.test.ts', 'test/t150.test.ts'];
const E2E = 'test-e2e/x.e2e.test.ts';
const FLAKES = ['test/t7.test.ts', 'test/t42.test.ts', 'test/gone.test.ts'];
const hashOf = (f: string): string => createHash('sha256').update(f).digest('hex');
const byHash = (xs: string[]): string[] => [...xs].sort((a, b) => (hashOf(a) < hashOf(b) ? -1 : hashOf(a) > hashOf(b) ? 1 : 0));
/** The fixture's default CI time of every test file, and the tool's default budget (one row's share of `parity/sample`). */
const EACH_MS = 5_000;
const BUDGET_S = 240;
/** The sample the tool must pick with the fixture's default times, computed here from the rule: the changed tests in hash order,
 *  the known load flakes in the file's order (those at the rev), then the rest in ascending sha256 of their path, every file
 *  EACH_MS, until the budget is spent. */
function timedSample(changed: string[]): string[] {
  const first = [...byHash(changed), ...FLAKES.filter((f) => TESTS.includes(f) && !changed.includes(f))];
  const spread = Math.floor((BUDGET_S * 1000 - first.length * EACH_MS) / EACH_MS);
  return [...first, ...byHash(TESTS.filter((f) => !first.includes(f))).slice(0, spread)];
}
/** The sample with no per-file times: at most four changed tests, no flake, and eight spread files, by count. */
function untimedSample(changed: string[]): string[] {
  const first = byHash(changed).slice(0, 4);
  return [...first, ...byHash(TESTS.filter((f) => !first.includes(f))).slice(0, 8)];
}
/** The test files one leg was asked for: the `*.test.ts` words of one logged argv line. */
const filesOf = (line: string): string[] => line.split(' ').filter((w) => w.endsWith('.test.ts'));

function git(cwd: string, ...a: string[]): string {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@testbox.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@testbox.invalid' } });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}

function toolFixture(extra: NodeJS.ProcessEnv = {}, opts: { tests?: boolean; flakes?: string[] | 'link' } = {}): ToolFix {
  const dir = mkTmp('tb-parity-');
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'server', 'test'), { recursive: true });
  mkdirSync(join(repo, 'server', 'test-e2e'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  const flakesText = (fs: string[]): string => `# known load flakes\n\n${fs.join('\n')}\n`;
  if (Array.isArray(opts.flakes) || opts.flakes === undefined) {
    writeFileSync(join(repo, 'server', 'load-flakes.txt'), flakesText(Array.isArray(opts.flakes) ? opts.flakes : FLAKES));
  } else {
    // a symlink committed at the revision, to a file that names a changed test and a flake: never read
    writeFileSync(join(repo, 'server', 'flakes-real.txt'), flakesText(['test/t3.test.ts', 'test/t7.test.ts']));
    symlinkSync('flakes-real.txt', join(repo, 'server', 'load-flakes.txt'));
  }
  writeFileSync(join(repo, 'server', 'test', 'helper.ts'), 'export {};\n');
  if (opts.tests !== false) for (const f of [...TESTS, E2E]) writeFileSync(join(repo, 'server', f), `// ${f}\n`);
  const revs: string[] = [];
  for (let i = 0; i < 6; i++) {
    writeFileSync(join(repo, 'server', 'f.txt'), `${i}\n`);
    // the newest pull request changes two test files, and one outside the package's include
    if (i === 5 && opts.tests !== false) for (const f of [...CHANGED, E2E]) writeFileSync(join(repo, 'server', f), `// ${f} changed\n`);
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', `c${i}`);
    revs.push(git(repo, 'rev-parse', 'HEAD'));
  }
  // The tool finds ccrc-test beside itself and the box client under agent/dist (its own layout).
  const tdir = join(dir, 'tree');
  mkdirSync(join(tdir, 'ccd'), { recursive: true });
  mkdirSync(join(tdir, 'agent', 'dist', 'agent', 'src', 'testbox'), { recursive: true });
  const tool = join(tdir, 'ccd', 'testbox-parity');
  copyFileSync(TOOL, tool);
  // the tool sources ccd/ccrc beside itself, for the platform timeout shim
  copyFileSync(join(REPO, 'ccd', 'ccrc'), join(tdir, 'ccd', 'ccrc'));
  chmodSync(tool, 0o755);
  // The package's vitest, as `list --filesOnly` sees it: the files its include (`test/**/*.test.ts`) names, never test-e2e/.
  // FAKE_LIST_RC: the listing fails with that status.
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'vitest'), `#!/usr/bin/env bash
[ "$1 $2" = "list --filesOnly" ] || { echo "fake vitest: only list --filesOnly" >&2; exit 64; }
[ -z "\${FAKE_LIST_RC:-}" ] || exit "$FAKE_LIST_RC"
[ ! -d test ] || find test -name '*.test.ts' | sort
`, { mode: 0o755 });
  const localLog = join(dir, 'local-log');
  // FAKE_LOCAL_HANG: the local leg never ends by itself (it sleeps that long, and leaves its pid in $HOME/leg-pid), as the leg
  // that once held the admin lock did. FAKE_LOCAL_RC: the leg ends at once with that status and no report. A fixture leg prints
  // two lines of each fixture it names; a test leg two tap-flat lines per test file it names, a pass and a skip (FAKE_DROP: one
  // file left out).
  // FAKE_LOCAL_QUEUE: the leg waits that many seconds in the heavy-test queue first, saying so as ccrc test does.
  writeFileSync(join(tdir, 'ccd', 'ccrc-test'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(localLog)}
[ -z "\${FAKE_LOCAL_RC:-}" ] || exit "$FAKE_LOCAL_RC"
if [ -n "\${FAKE_LOCAL_HANG:-}" ]; then echo $$ > "$HOME/leg-pid"; exec sleep "$FAKE_LOCAL_HANG"; fi
if [ -n "\${FAKE_LOCAL_QUEUE:-}" ]; then
  echo "ccrc test: queued: all 2 heavy test slots are held (pid 1); waiting (it starts when that clears)" >&2
  sleep "$FAKE_LOCAL_QUEUE"
  echo "ccrc test: slot 0 is free after \${FAKE_LOCAL_QUEUE}s; starting" >&2
fi
fx=0
for m in git-state socket workers; do
  case " $* " in *" testbox-parity-fixture-$m.test.mjs "*)
    [ -f "testbox-parity-fixture-$m.test.mjs" ] || { echo "fixture file missing" >&2; exit 1; }
    fx=1; echo "decoration before"; echo "TP|$m|k|ok"; echo "TP|$m|k2|ok"; echo "decoration after" ;;
  esac
done
[ "$fx" = 0 ] || exit 0
n=0
for a in "$@"; do case "$a" in *.test.ts) [ "$a" = "\${FAKE_DROP:-}" ] || { n=$((n + 2)); printf 'ok %s - %s > t # time=1ms\\nok %s - %s > s # SKIP\\n' "$((n - 1))" "$a" "$n" "$a"; } ;; esac; done
`, { mode: 0o755 });
  const clientLog = join(dir, 'client-log');
  // The box prints the fixtures in the other order, so only a split by fixture name agrees. FAKE_BOX_DIFF: '1' fails every file,
  // a file's name fails that file; FAKE_BOX_DIFF_ONCE: those files (comma-separated) fail on the first box leg that names them,
  // and pass after; FAKE_BOX_NO_VERDICT_ALONE: a re-run alone of that file writes no verdict.
  writeFileSync(join(tdir, 'agent', 'dist', 'agent', 'src', 'testbox', 'client.js'), `const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(clientLog)}, a.join(' ') + '\\n');
const i = a.indexOf('--verdict');
const silent = process.env.FAKE_BOX_NO_VERDICT_ALONE !== undefined && a.includes(process.env.FAKE_BOX_NO_VERDICT_ALONE) && i >= 0 && a[i + 1].endsWith('.alone.verdict');
if (i >= 0 && !silent) fs.writeFileSync(a[i + 1], (process.env.FAKE_BOX_VERDICT || 'remote') + '\\tid\\tfixture text\\n');
const fx = ['workers', 'socket', 'git-state'].filter((m) => a.includes('testbox-parity-fixture-' + m + '.test.mjs'));
if (fx.length > 0) {
  for (const m of fx) {
    if (!fs.existsSync('testbox-parity-fixture-' + m + '.test.mjs')) { console.error('fixture file missing'); process.exit(1); }
    console.log('decoration before');
    console.log('TP|' + m + '|k|' + (process.env.FAKE_FX_DIFF === m ? 'other' : 'ok'));
    console.log('TP|' + m + '|k2|ok');
    console.log('decoration after');
  }
} else {
  const once = (process.env.FAKE_BOX_DIFF_ONCE || '').split(',').filter(Boolean);
  const failOnce = new Set();
  for (const o of once) {
    const mark = process.env.HOME + '/diff-once-done-' + o.replace(/[^a-z0-9]/gi, '_');
    if (a.includes(o) && !fs.existsSync(mark)) { fs.writeFileSync(mark, ''); failOnce.add(o); }
  }
  const d = process.env.FAKE_BOX_DIFF || '';
  let n = 0;
  for (const f of a.filter((x) => x.endsWith('.test.ts'))) {
    if (f === process.env.FAKE_DROP) continue;
    const fail = d === '1' || d === f || failOnce.has(f);
    console.log((fail ? 'not ok ' : 'ok ') + (++n) + ' - ' + f + ' > t # time=1ms');
    console.log('ok ' + (++n) + ' - ' + f + ' > s # SKIP');
  }
}
`);
  const ghLog = join(dir, 'gh-log');
  const gh = join(dir, 'gh-fake');
  // FAKE_GH_DEFAULT: the default branch `repo view` names ('-' fails it); FAKE_GH_ARTIFACTS: the artifact listing; FAKE_GH_RUN:
  // the run a `runs/<id>` lookup answers ('-' fails it); FAKE_TIMES: the file a download of testtimes writes.
  writeFileSync(gh, `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(ghLog)}
case "$1" in
  repo) [ "$2" = view ] && [ "\${FAKE_GH_DEFAULT:-main}" != - ] || exit 1; printf '%s\\n' "\${FAKE_GH_DEFAULT:-main}" ;;
  pr) case "$2" in
      list) n=20; while [ $# -gt 0 ]; do [ "$1" = --limit ] && n="$2"; shift; done
        node -e 'process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).slice(0, Number(process.argv[2]))) + "\\n")' "$FAKE_GH_LIST" "$n" ;;
      view) printf '%s\\n' "$FAKE_GH_VIEW" ;;
      *) exit 1 ;;
    esac ;;
  api) case "$2" in
      */actions/runs/*) [ -n "\${FAKE_GH_RUN:-}" ] && [ "$FAKE_GH_RUN" != - ] || exit 1; printf '%s\\n' "$FAKE_GH_RUN" ;;
      *) [ -n "\${FAKE_GH_ARTIFACTS:-}" ] || exit 1; printf '%s\\n' "$FAKE_GH_ARTIFACTS" ;;
    esac ;;
  run) [ "$2" = download ] && [ -n "\${FAKE_TIMES:-}" ] || exit 1
    d=""; while [ $# -gt 0 ]; do [ "$1" = -D ] && d="$2"; shift; done
    mkdir -p "$d" && cp "$FAKE_TIMES" "$d/testtimes.json" ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  const list = JSON.stringify(revs.slice(1).reverse().map((oid, k) => ({ number: 100 - k, mergeCommit: { oid }, mergedAt: `2026-11-2${5 - k}T10:00:00Z` })));
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  // CI's times by default: a trusted artifact and run, every test file EACH_MS (a case that wants none says so)
  const times = join(dir, 'times-default.json');
  writeFileSync(times, JSON.stringify(Object.fromEntries(TESTS.map((f) => [`server/${f}`, EACH_MS]))));
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('FAKE_') && !k.startsWith('TP_') && !k.startsWith('GIT_')) base[k] = v;
  Object.assign(base, {
    HOME: home, TMPDIR: dir, LANG: 'C', TP_GH: gh, FAKE_GH_LIST: list, FAKE_GH_VIEW: revs[2],
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    FAKE_GH_ARTIFACTS: listing(ARTIFACT), FAKE_GH_RUN: JSON.stringify(RUN), FAKE_TIMES: times, ...extra,
  });
  return { dir, repo, revs, env: ghContainedEnv(home, base, { systemd: true, tmux: true }), tool, ghLog, clientLog, localLog };
}

/** The tool's argv: `--sample-budget 240` (one row's share of the table's `parity/sample`) unless the case names its own. */
const withBudget = (args: string[]): string[] => (args.includes('--sample-budget') ? args : ['--sample-budget', '240', ...args]);
function runTool(t: ToolFix, args: string[]): { out: string; err: string; rc: number } {
  const r = spawnSync(BASH, [t.tool, '--repo', t.repo, '--package', 'server', ...withBudget(args), '--', 'vitest', 'run'], { env: t.env, encoding: 'utf8', cwd: t.dir });
  return { out: r.stdout ?? '', err: r.stderr ?? '', rc: r.status ?? -1 };
}
const META = ['--repo-name', 'project-a', '--release', 'v1.2.3', '--tools-key', 'node-20.1.0+chrome-130.0', '--fingerprint', FP, '--box-sha256', SHA];
/** The artifact listing of a trusted `testtimes` (this repository's own run on the default branch), its run, and its times. */
const ARTIFACT = { id: 5, name: 'testtimes', expired: false, created_at: '2026-11-22T03:00:00Z', workflow_run: { id: 777, repository_id: 1, head_repository_id: 1, head_branch: 'main' } };
const RUN = { id: 777, path: '.github/workflows/ci.yml', event: 'schedule', head_branch: 'main', repository: { id: 1 }, head_repository: { id: 1 } };
const listing = (...artifacts: unknown[]): string => JSON.stringify({ total_count: artifacts.length, artifacts });
function timesFile(t: ToolFix, ms: (f: string) => number | undefined, raw?: string): string {
  const f = join(t.dir, 'times.json');
  const o: Record<string, number> = {};
  for (const x of TESTS) { const v = ms(x); if (v !== undefined) o[`server/${x}`] = v; }
  writeFileSync(f, raw ?? JSON.stringify(o));
  return f;
}
/** The box legs' test-file lists, in order (fixture legs left out). */
const boxLegs = (t: ToolFix): string[][] => (existsSync(t.clientLog) ? readFileSync(t.clientLog, 'utf8').split('\n').filter((l) => l !== '' && !l.includes('testbox-parity-fixture-')).map(filesOf) : []);

describe.skipIf(!HAS_ALL)('testbox-parity: its scope and its record (D-8166, TC9)', () => {
  it('--recent names the pull requests merged most recently into the default branch, and runs each', () => {
    const t = toolFixture();
    const r = runTool(t, ['--recent', '5']);
    expect(r.rc, r.out + r.err).toBe(0);
    // no origin/HEAD in the fixture's clone, so gh names the default branch, and the list asks for that branch alone
    const gh = readFileSync(t.ghLog, 'utf8').split('\n');
    expect(gh[0]).toBe('repo view --json defaultBranchRef -q .defaultBranchRef.name');
    expect(gh).toContain('pr list --state merged --base main --limit 50 --json number,mergeCommit,mergedAt');
    expect(r.out.split('\n').filter((l) => l.startsWith('== '))).toEqual(t.revs.slice(1).reverse().map((v) => `== ${v}`));
    expect(r.out).toContain('parity: every file agrees');
  });

  it('--recent 1 is the newest by merge time, not by creation, on the branch origin/HEAD names', () => {
    // gh lists by creation: the first listed was merged first, the third most recently
    const list = (t: ToolFix): string => JSON.stringify([
      { number: 90, mergeCommit: { oid: t.revs[1] }, mergedAt: '2026-11-20T10:00:00Z' },
      { number: 91, mergeCommit: { oid: t.revs[2] }, mergedAt: '2026-11-21T10:00:00Z' },
      { number: 92, mergeCommit: { oid: t.revs[3] }, mergedAt: '2026-11-22T09:00:00Z' },
      { number: 93, mergeCommit: { oid: t.revs[4] } },
    ]);
    const t = toolFixture();
    t.env['FAKE_GH_LIST'] = list(t);
    git(t.repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    const rec = join(t.dir, 'rec.json');
    const r = runTool(t, ['--recent', '1', '--record', rec, ...META]);
    expect(r.out.split('\n').filter((l) => l.startsWith('== '))).toEqual([`== ${t.revs[3]}`]);
    const gh = readFileSync(t.ghLog, 'utf8');
    expect(gh).toContain('pr list --state merged --base trunk --limit 50');
    expect(gh).not.toContain('repo view');
    const read = readTestboxParityRecord(readFileSync(rec, 'utf8'));
    expect(read.ok && read.value.prs.map((p) => p.number)).toEqual([92]);
    // with no default branch at all there is no such list, and the run fails
    const none = toolFixture({ FAKE_GH_DEFAULT: '-' });
    const n = runTool(none, ['--recent', '1']);
    expect(n.rc).toBe(1);
    expect(n.err).toContain('default branch could not be read');
    expect(readFileSync(none.ghLog, 'utf8')).not.toContain('pr list');
  });

  it('named pull requests replace the default scope', () => {
    const t = toolFixture();
    const r = runTool(t, ['--pr', '7']);
    expect(r.rc, r.out + r.err).toBe(0);
    expect(readFileSync(t.ghLog, 'utf8')).not.toContain('pr list');
    expect(readFileSync(t.ghLog, 'utf8')).toContain('pr view 7 --json mergeCommit -q .mergeCommit.oid');
    expect(r.out.split('\n').filter((l) => l.startsWith('== '))).toEqual([`== ${t.revs[2]}`]);
  });

  it('refuses a --recent that is not 1 to 20, a --record without its measurements, and a run with no --sample-budget', () => {
    const t = toolFixture();
    expect(runTool(t, ['--recent', '21']).rc).toBe(2);
    expect(runTool(t, ['--recent', '0']).rc).toBe(2);
    const r = runTool(t, ['--recent', '1', '--record', join(t.dir, 'rec.json')]);
    expect(r.rc).toBe(2);
    expect(r.err).toContain('--record needs');
    expect(existsSync(join(t.dir, 'rec.json'))).toBe(false);
    // the budget is the caller's (the verb's table row `parity/sample`): the tool holds no copy of it
    const bare = spawnSync(BASH, [t.tool, '--repo', t.repo, '--package', 'server', '--recent', '1', '--', 'vitest', 'run'], { env: t.env, encoding: 'utf8', cwd: t.dir });
    expect(bare.status).toBe(2);
    expect(bare.stderr).toContain('--sample-budget');
    for (const bad of ['0', '3601', '1.5', 'x', '']) expect(runTool(t, ['--recent', '1', '--sample-budget', bad]).rc, bad).toBe(2);
    // a queue wait is added to a bound, so it needs one; and the command is a vitest run, whose head also lists the files
    const q = runTool(t, ['--recent', '1', '--queue-wait', '300']);
    expect(q.rc).toBe(2);
    expect(q.err).toContain('--queue-wait needs --leg-deadline');
    const notRun = spawnSync(BASH, [t.tool, '--repo', t.repo, '--sample-budget', '240', '--recent', '1', '--', 'vitest'], { env: t.env, encoding: 'utf8', cwd: t.dir });
    expect(notRun.status).toBe(2);
    expect(notRun.stderr).toContain('the command must be a vitest run');
    expect(existsSync(t.clientLog)).toBe(false);
  });

  // ── the sample (D-8945) ──
  it('the sample is the changed tests, the known flakes, then the sha256 spread, on both sides', () => {
    const t = toolFixture();
    const r = runTool(t, ['--recent', '1']);
    expect(r.rc, r.out + r.err).toBe(0);
    const want = timedSample(CHANGED);
    expect(want).toHaveLength(48);
    // the box leg and the local leg were each asked for exactly the sample, in that order, and nothing else
    expect(boxLegs(t)).toEqual([want]);
    const local = readFileSync(t.localLog, 'utf8').split('\n').filter((l) => l !== '');
    expect(local.map(filesOf)).toEqual([want]);
    expect(local[0]).toMatch(/^--local -- vitest run --reporter=tap-flat --maxWorkers=2 test\//);
    // a file that is no test, and a flake gone at the rev, are never sampled
    expect(local[0]).not.toContain('helper.ts');
    expect(local[0]).not.toContain('gone.test.ts');
    // a changed test the package's vitest never lists (outside its include) is never sampled: it would differ `not run`
    expect(local[0]).not.toContain('test-e2e');
    expect(r.err).toContain('sample: 48 files (2 changed, 2 known load flakes, 44 spread), 240 s of CI time');
    expect(r.out).toContain('compared 48 test files on each side');
    // every sampled file is compared, and only those
    expect(r.out.split('\n').filter((l) => l.startsWith('test/')).map((l) => l.split(':')[0]).sort()).toEqual([...want].sort());
  });

  it('with times, a file over the 30 s ceiling is never sampled, whatever its group, and the fill stops at the budget and at 64 files', () => {
    // one changed file is over the ceiling, every other file costs 10 s, and the budget is 200 s
    const t = toolFixture();
    t.env['FAKE_TIMES'] = timesFile(t, (f) => (f === 'test/t3.test.ts' ? 31_000 : 10_000));
    const r = runTool(t, ['--recent', '1', '--sample-budget', '200']);
    expect(r.rc, r.out + r.err).toBe(0);
    const [legs] = boxLegs(t);
    expect(legs).not.toContain('test/t3.test.ts');
    expect(legs!.slice(0, 3)).toEqual(['test/t150.test.ts', 'test/t7.test.ts', 'test/t42.test.ts']);
    expect(legs).toHaveLength(20);
    // the summary names the changed test it left out
    expect(r.err).toContain('sample: 20 files (1 changed, 2 known load flakes, 17 spread), 200 s of CI time; left out, over the 30 s ceiling: test/t3.test.ts');
    // the times came from the listed run, by its id, once that run was checked
    const gh = readFileSync(t.ghLog, 'utf8');
    expect(gh).toContain('api repos/{owner}/{repo}/actions/artifacts?name=testtimes&per_page=10');
    expect(gh).toContain('api repos/{owner}/{repo}/actions/runs/777');
    expect(gh).toMatch(/^run download 777 -n testtimes -D \S+$/m);
    // every file a second: the budget would take all 200, the count stops at 64
    const many = toolFixture();
    many.env['FAKE_TIMES'] = timesFile(many, () => 1_000);
    const m = runTool(many, ['--recent', '1', '--sample-budget', '3600']);
    expect(m.rc, m.out + m.err).toBe(0);
    expect(boxLegs(many)[0]).toHaveLength(64);
  });

  it('with times, the changed tests take at most half the budget, so the flakes are still sampled; a file that would pass the budget is skipped and the fill goes on', () => {
    // budget 60 s: the changed tests (20 s each) may use 30, so one is taken; the flakes cost 10 s each; the first spread file
    // in hash order costs 25 s, which would pass the budget, and is skipped while the next two still fit
    const heavy = byHash(TESTS.filter((f) => !CHANGED.includes(f) && !FLAKES.includes(f)))[0]!;
    const t = toolFixture();
    t.env['FAKE_TIMES'] = timesFile(t, (f) => (CHANGED.includes(f) ? 20_000 : f === heavy ? 25_000 : 10_000));
    const r = runTool(t, ['--recent', '1', '--sample-budget', '60']);
    expect(r.rc, r.out + r.err).toBe(0);
    const [legs] = boxLegs(t);
    expect(legs!.slice(0, 3)).toEqual([byHash(CHANGED)[0], 'test/t7.test.ts', 'test/t42.test.ts']);
    expect(legs).not.toContain(heavy);
    expect(legs).toHaveLength(5);
    expect(r.err).toContain('sample: 5 files (1 changed, 2 known load flakes, 2 spread), 60 s of CI time');
  });

  it('with times, a spread file with no time is never sampled, and a changed test with none costs the ceiling', () => {
    // t150 (changed) and every odd-numbered file have no time; every other file costs 5 s
    const t = toolFixture();
    const untimed = (f: string): boolean => f === 'test/t150.test.ts' || Number(/t(\d+)\./.exec(f)![1]) % 2 === 1;
    t.env['FAKE_TIMES'] = timesFile(t, (f) => (untimed(f) ? undefined : 5_000));
    const r = runTool(t, ['--recent', '1']);
    expect(r.rc, r.out + r.err).toBe(0);
    const [legs] = boxLegs(t);
    expect(legs).toContain('test/t150.test.ts');
    expect(legs!.filter((f) => untimed(f) && !CHANGED.includes(f) && !FLAKES.includes(f))).toEqual([]);
    // t3, t150 and t7 have no time, so each costs the 30 s ceiling; t42 costs 5 s; then (240 - 95) / 5 = 29 spread
    expect(r.err).toContain('sample: 33 files (2 changed, 2 known load flakes, 29 spread), 240 s of CI time');
  });

  it('no times: at most four changed tests and eight spread files by count, and no known load flake, whatever the reason there are none', () => {
    const good = (over: object): unknown => ({ ...ARTIFACT, workflow_run: { ...ARTIFACT.workflow_run, ...over } });
    const run = (over: object): string => JSON.stringify({ ...RUN, ...over });
    const big = JSON.stringify({ [`server/${'y'.repeat(1_100_000)}`]: 1, 'server/test/t1.test.ts': 1 });
    const cases: [string, NodeJS.ProcessEnv, string | undefined][] = [
      ['none listed', { FAKE_GH_ARTIFACTS: listing() }, undefined],
      ['a malformed file', {}, '{"server/test/t1.test.ts":"fast"}'],
      ['a list, not an object', {}, '[1,2]'],
      ['a negative time', {}, '{"server/test/t1.test.ts":-5}'],
      ['a file over 1 MiB', {}, big],
      ['an expired artifact', { FAKE_GH_ARTIFACTS: listing({ ...ARTIFACT, expired: true }) }, undefined],
      ['an artifact on another branch', { FAKE_GH_ARTIFACTS: listing(good({ head_branch: 'feature' })) }, undefined],
      ['an artifact from another repository', { FAKE_GH_ARTIFACTS: listing(good({ head_repository_id: 2 })) }, undefined],
      ['a run of another workflow', { FAKE_GH_RUN: run({ path: '.github/workflows/other.yml' }) }, undefined],
      ['a run of a pull request', { FAKE_GH_RUN: run({ event: 'pull_request' }) }, undefined],
      ['a run on another branch', { FAKE_GH_RUN: run({ head_branch: 'feature' }) }, undefined],
      ['a run from a fork', { FAKE_GH_RUN: run({ head_repository: { id: 2 } }) }, undefined],
      ['a run that could not be read', { FAKE_GH_RUN: '-' }, undefined],
      ['gh failed', { FAKE_GH_ARTIFACTS: '' }, undefined],
    ];
    for (const [why, env, raw] of cases) {
      const t = toolFixture(env);
      // the file a download would give is a good one (every file a second), so only the rule keeps it out
      t.env['FAKE_TIMES'] = timesFile(t, () => 1_000, raw);
      const r = runTool(t, ['--recent', '1']);
      expect(r.rc, `${why}: ${r.out}${r.err}`).toBe(0);
      expect(boxLegs(t), why).toEqual([untimedSample(CHANGED)]);
      expect(r.err, why).toContain('sample: 10 files (2 changed, 0 known load flakes, 8 spread), no per-file times');
    }
    // the four-changed cap: a revision that changed six tests samples four of them, in hash order
    const six = ['test/t3.test.ts', 'test/t150.test.ts', 'test/t11.test.ts', 'test/t12.test.ts', 'test/t13.test.ts', 'test/t14.test.ts'];
    const t = toolFixture({ FAKE_GH_ARTIFACTS: '' });
    for (const f of six) writeFileSync(join(t.repo, 'server', f), `// ${f} changed again\n`);
    git(t.repo, 'add', '.');
    git(t.repo, 'commit', '-q', '-m', 'six');
    const r = runTool(t, ['--rev', git(t.repo, 'rev-parse', 'HEAD')]);
    expect(r.rc, r.out + r.err).toBe(0);
    expect(boxLegs(t)).toEqual([untimedSample(six)]);
  });

  it('the package\'s vitest that cannot list its test files fails the revision before any leg runs', () => {
    const t = toolFixture({ FAKE_LIST_RC: '3' });
    const r = runTool(t, ['--recent', '1']);
    expect(r.rc).toBe(1);
    expect(r.err).toContain('could not list its test files (vitest list --filesOnly)');
    expect(existsSync(t.clientLog)).toBe(false);
    expect(existsSync(t.localLog)).toBe(false);
  });

  it('a load-flakes.txt that is a symlink at the revision is never read: its entries are neither sampled as flakes nor re-run', () => {
    // the link's target names t3 (a changed test) and t7; t3 differs on the box, and is no flake, so it is not re-run
    const t = toolFixture({ FAKE_BOX_DIFF: 'test/t3.test.ts' }, { flakes: 'link' });
    const r = runTool(t, ['--recent', '1']);
    expect(r.rc).toBe(1);
    expect(r.err).toContain('(2 changed, 0 known load flakes,');
    expect(r.out).toContain('test/t3.test.ts: local pass, box fail; skipped local 1 (s), box 1 (s); DIFFERS');
    expect(readFileSync(t.clientLog, 'utf8')).not.toContain('.alone');
  });

  it('never the whole suite: a package with no test file at the rev runs no leg and fails', () => {
    const t = toolFixture({}, { tests: false });
    const rec = join(t.dir, 'rec.json');
    const r = runTool(t, ['--recent', '1', '--record', rec, ...META]);
    expect(r.rc).toBe(1);
    expect(r.out + r.err).toContain('no test file to compare');
    expect(existsSync(t.clientLog)).toBe(false);
    expect(existsSync(t.localLog)).toBe(false);
    const read = readTestboxParityRecord(readFileSync(rec, 'utf8'));
    expect(read.ok && read.value.result).toBe('fail');
  });

  it('a sampled file neither side reported differs', () => {
    const t = toolFixture({ FAKE_DROP: 'test/t150.test.ts' });
    const rec = join(t.dir, 'rec.json');
    const r = runTool(t, ['--recent', '1', '--record', rec, ...META]);
    expect(r.rc).toBe(1);
    expect(r.out).toContain('test/t150.test.ts: local absent, box absent; skipped local -, box -; DIFFERS (not run)');
    const read = readTestboxParityRecord(readFileSync(rec, 'utf8'));
    expect(read.ok && read.value.result).toBe('fail');
  });

  it('a known load flake that differs is re-run alone once on both sides, and that answer counts; a file not on the list is not re-run', () => {
    const t = toolFixture({ FAKE_BOX_DIFF_ONCE: 'test/t7.test.ts' });
    const r = runTool(t, ['--recent', '1']);
    expect(r.rc, r.out + r.err).toBe(0);
    expect(r.out).toContain('test/t7.test.ts: local pass, box fail; skipped local 1 (s), box 1 (s); agree (re-run alone)');
    const box = readFileSync(t.clientLog, 'utf8').split('\n').filter((l) => l.includes('.alone.verdict'));
    expect(box.map(filesOf)).toEqual([['test/t7.test.ts']]);
    const local = readFileSync(t.localLog, 'utf8').split('\n').filter((l) => l !== '');
    expect(local.map(filesOf)).toEqual([timedSample(CHANGED), ['test/t7.test.ts']]);
    // two flakes differ (compared in path order: t42, then t7); the second's re-run writes no box verdict, so it never borrows
    // the first re-run's: it still differs
    const two = toolFixture({ FAKE_BOX_DIFF_ONCE: 'test/t7.test.ts,test/t42.test.ts', FAKE_BOX_NO_VERDICT_ALONE: 'test/t7.test.ts' });
    const w = runTool(two, ['--recent', '1']);
    expect(w.rc).toBe(1);
    expect(w.out).toContain('test/t42.test.ts: local pass, box fail; skipped local 1 (s), box 1 (s); agree (re-run alone)');
    expect(w.out).toContain('test/t7.test.ts: local pass, box fail; skipped local 1 (s), box 1 (s); DIFFERS');
    expect(w.err).toContain('alone: the box leg did not run on the box (no verdict)');
    // a changed file is no known flake: the same first failure stands, and nothing is re-run
    const other = toolFixture({ FAKE_BOX_DIFF_ONCE: 'test/t150.test.ts' });
    const o = runTool(other, ['--recent', '1']);
    expect(o.rc).toBe(1);
    expect(o.out).toContain('test/t150.test.ts: local pass, box fail; skipped local 1 (s), box 1 (s); DIFFERS');
    expect(readFileSync(other.clientLog, 'utf8')).not.toContain('.alone');
  });

  it('the fixtures run in one leg pair, and a byte difference in one fails that fixture only', () => {
    const ok = toolFixture();
    const a = runTool(ok, ['--recent', '1', '--fixtures']);
    expect(a.rc, a.out + a.err).toBe(0);
    for (const f of FX) expect(a.out).toContain(`fixture ${f}: byte-identical on both sides`);
    // one box run and one local run named all three fixture files, under the fixture config
    for (const log of [ok.clientLog, ok.localLog]) {
      const fx = readFileSync(log, 'utf8').split('\n').filter((l) => l.includes('testbox-parity-fixture-'));
      expect(fx, log).toHaveLength(1);
      for (const f of FX) expect(fx[0]).toContain(` testbox-parity-fixture-${f}.test.mjs`);
      expect(fx[0]).toContain('--reporter=verbose --maxWorkers=2 --config testbox-parity-fixture.config.mjs');
    }
    for (const f of FX) {
      const bad = toolFixture({ FAKE_FX_DIFF: f });
      const rec = join(bad.dir, 'rec.json');
      const b = runTool(bad, ['--recent', '1', '--fixtures', '--record', rec, ...META]);
      expect(b.rc, f).toBe(1);
      expect(b.out).toContain(`fixture ${f}: DIFFERS`);
      for (const other of FX.filter((x) => x !== f)) expect(b.out).toContain(`fixture ${other}: byte-identical`);
      const read = readTestboxParityRecord(readFileSync(rec, 'utf8'));
      expect(read.ok && read.value.fixtures).toEqual(FX.map((name) => ({ name, result: name === f ? 'fail' : 'pass' })));
    }
    // the fixture files are gone from the worktree they ran in (the worktree itself is removed on exit)
    expect(a.out + a.err).not.toContain('fixture file missing');
  });

  it('the fixtures run under a real vitest whose package include is restrictive (they are found and print their lines)', () => {
    const t = toolFixture();
    // A repository whose server package includes only test/**/*.test.ts, with the real vitest of this suite linked in.
    const real = join(t.dir, 'real');
    mkdirSync(join(real, 'server', 'test'), { recursive: true });
    git(real, 'init', '-q', '-b', 'main');
    writeFileSync(join(real, 'server', 'vitest.config.ts'), "export default { test: { include: ['test/**/*.test.ts'] } };\n");
    writeFileSync(join(real, 'server', 'test', 'a.test.ts'), "import { it } from 'vitest';\nit('a', () => {});\nit.skip('s', () => {});\n");
    symlinkSync(join(REPO, 'server', 'node_modules'), join(real, 'server', 'node_modules'));
    git(real, 'add', '.');
    git(real, 'commit', '-q', '-m', 'c');
    const rev = git(real, 'rev-parse', 'HEAD');
    // Both sides run the command for real; the tool's files beside them are the only fakes.
    const tdir = join(t.dir, 'tree');
    writeFileSync(join(tdir, 'ccd', 'ccrc-test'), '#!/usr/bin/env bash\nshift 2\nexec "$@"\n', { mode: 0o755 });
    writeFileSync(join(tdir, 'agent', 'dist', 'agent', 'src', 'testbox', 'client.js'), `const a = process.argv.slice(2);
const i = a.indexOf('--verdict');
require('fs').writeFileSync(a[i + 1], 'remote\\tid\\ttext\\n');
const r = require('child_process').spawnSync(a[a.indexOf('--') + 1], a.slice(a.indexOf('--') + 2), { stdio: 'inherit' });
process.exit(r.status ?? 1);
`);
    // Colour forced on, as on a CI runner (no agent in the environment, TERM not dumb): vitest then wraps each console
    // log's header in escapes whose closing codes land at the START of the logged line, so a `^TP|` match on the raw
    // stream misses it. Inside an agent shell vitest turns colour off, which is why this passed there and failed in CI.
    // No CI times for this repository: its one test file is sampled by count.
    const env = { ...t.env, FORCE_COLOR: '1', FAKE_GH_ARTIFACTS: '', PATH: `${join(REPO, 'server', 'node_modules', '.bin')}:${t.env.PATH ?? ''}` };
    const r = spawnSync(BASH, [t.tool, '--repo', real, '--package', 'server', '--sample-budget', '240', '--fixtures', '--rev', rev, '--', 'vitest', 'run'], { env, encoding: 'utf8', cwd: t.dir });
    expect(r.stdout + r.stderr).not.toContain('No test files found');
    for (const f of FX) expect(r.stdout, r.stdout + r.stderr).toContain(`fixture ${f}: byte-identical on both sides`);
    // the one test file of a root commit is the whole sample, and both real runs agree on it
    // (vitest 5 writes junit to a file, not stdout: the legs' tap-flat report is what makes the file visible on both sides)
    expect(r.stdout, r.stdout + r.stderr).toContain('test/a.test.ts: local pass, box pass; skipped local 1 (s), box 1 (s); agree');
  }, 120_000);

  it('a fixture whose side printed nothing is not an agreement', () => {
    const t = toolFixture({ FAKE_BOX_VERDICT: 'local' });
    const r = runTool(t, ['--recent', '1', '--fixtures']);
    expect(r.rc).toBe(1);
    expect(r.out).toContain('fixture git-state: DIFFERS (or a leg could not run)');
  });

  it('the record carries the result, the pull requests and revisions, the fixtures, the release, the tools key, the fingerprint, the box file sha256 and the time; the files compared are printed', () => {
    const t = toolFixture();
    const rec = join(t.dir, 'rec.json');
    const before = Date.now();
    const r = runTool(t, ['--recent', '5', '--fixtures', '--record', rec, ...META]);
    expect(r.rc, r.out + r.err).toBe(0);
    expect((statSync(rec).mode & 0o777).toString(8)).toBe('600');
    const raw = readFileSync(rec, 'utf8');
    expect(raw).toMatch(/^\{"v":1,"result":"pass",/);
    // no `files` yet: a server older than its reader would refuse the whole status (the reader ships first)
    expect(Object.keys(JSON.parse(raw))).toEqual(['v', 'result', 'prs', 'fixtures', 'release', 'toolsKey', 'fingerprint', 'boxFileSha256', 'at']);
    // the newest pull request changed two tests, the four before it none: 48 sampled each
    expect(r.out).toContain(`parity: compared ${5 * 48} test files on each side`);
    const read = readTestboxParityRecord(raw);
    expect(read.ok, JSON.stringify(read)).toBe(true);
    if (!read.ok) return;
    expect(read.value).toMatchObject({
      v: 1, result: 'pass', release: 'v1.2.3', toolsKey: 'node-20.1.0+chrome-130.0', fingerprint: FP, boxFileSha256: SHA,
      prs: [100, 99, 98, 97, 96].map((number, k) => ({ repo: 'project-a', number, rev: t.revs[5 - k] })),
      fixtures: FX.map((name) => ({ name, result: 'pass' })),
    });
    expect(read.value.at).toBeGreaterThanOrEqual(before);
    expect(parityArmable(read.value, { fingerprint: FP, boxFileSha256: SHA, stale: false })).toBe(true);
  });

  it('a leg that differs writes a fail record', () => {
    const t = toolFixture({ FAKE_BOX_DIFF: '1' });
    const rec = join(t.dir, 'rec.json');
    const r = runTool(t, ['--recent', '1', '--record', rec, ...META]);
    expect(r.rc).toBe(1);
    expect(r.out).toContain('DIFFERS');
    const read = readTestboxParityRecord(readFileSync(rec, 'utf8'));
    expect(read.ok && read.value.result).toBe('fail');
    if (read.ok) expect(parityArmable(read.value, { fingerprint: FP, boxFileSha256: SHA, stale: false })).toBe(false);
  });

  it('a box leg that did not run on the box fails the record', () => {
    const t = toolFixture({ FAKE_BOX_VERDICT: 'local' });
    const rec = join(t.dir, 'rec.json');
    const r = runTool(t, ['--recent', '1', '--record', rec, ...META]);
    expect(r.rc).toBe(1);
    expect(r.err).toContain('did not run on the box');
    const read = readTestboxParityRecord(readFileSync(rec, 'utf8'));
    expect(read.ok && read.value.result).toBe('fail');
  });
});

// D-8899: one leg that never ended kept a parity act, and the admin lock, for 23 hours.
describe.skipIf(!HAS_ALL || !HAS_TIMEOUT)('testbox-parity: a step has a bound (D-8899)', () => {
  const KILL = ['--leg-kill', '2'];
  const runBounded = (t: ToolFix, args: string[]): { out: string; err: string; rc: number; ms: number } => {
    const t0 = Date.now();
    const r = spawnSyncGroup(BASH, [t.tool, '--repo', t.repo, '--package', 'server', ...withBudget(args), '--', 'vitest', 'run'], { env: t.env, encoding: 'utf8', cwd: t.dir, timeout: 60_000 });
    return { out: r.stdout ?? '', err: r.stderr ?? '', rc: r.status ?? -1, ms: Date.now() - t0 };
  };

  it('a leg that does not end within --leg-deadline is stopped and counted as a leg that could not run, and the tool goes on', () => {
    const t = toolFixture({ FAKE_LOCAL_HANG: '120' });
    const rec = join(t.dir, 'rec.json');
    const r = runBounded(t, ['--recent', '5', '--leg-deadline', '1', ...KILL, '--record', rec, ...META]);
    expect(r.rc, `${r.out}${r.err}`).toBe(1);
    // far inside the 120 s either leg would have taken: each was stopped at its one-second bound
    expect(r.ms).toBeLessThan(30_000);
    // every pull request ran: a leg's stop did not end the tool
    expect(r.out.split('\n').filter((l) => l.startsWith('== '))).toEqual(t.revs.slice(1).reverse().map((v) => `== ${v}`));
    // each pull request's sample leg, and the re-run alone of each of its two known load flakes (absent on the stopped side,
    // so they differ): three steps a pull request, each stopped at its bound
    expect(r.err.split('\n').filter((l) => l.includes('the local leg did not end within 1s and was stopped'))).toHaveLength(15);
    // the box leg of each still ran, and the stopped side reads absent, never as an agreement
    expect(readFileSync(t.clientLog, 'utf8').trim().split('\n')).toHaveLength(15);
    expect(r.out).toMatch(/^test\/t\d+\.test\.ts: local absent, box pass/m);
    const read = readTestboxParityRecord(readFileSync(rec, 'utf8'));
    expect(read.ok && read.value.result).toBe('fail');
  });

  it('a leg that ends inside its bound is untouched, and the bound is a whole number of seconds with a kill behind it', () => {
    const t = toolFixture();
    const r = runTool(t, ['--recent', '1', '--leg-deadline', '900', ...KILL]);
    expect(r.rc, r.out + r.err).toBe(0);
    expect(r.err).not.toContain('did not end');
    for (const bad of ['0', '15m', '-1', '']) expect(runTool(t, ['--recent', '1', '--leg-deadline', bad, ...KILL]).rc, bad).toBe(2);
    // the kill grace is the platform shim's, which holds it between 2 and 8 seconds: the tool takes no value the shim would change
    for (const bad of ['0', '1', '9', '30', '30s', '']) expect(runTool(t, ['--recent', '1', '--leg-deadline', '900', '--leg-kill', bad]).rc, bad).toBe(2);
    for (const bad of ['0', 'soon', '17', '']) expect(runTool(t, ['--recent', '1', '--until', bad, ...KILL]).rc, bad).toBe(2);
    // no default hides in the tool: a bound with no kill behind it is refused, and names why
    const bare = runTool(t, ['--recent', '1', '--leg-deadline', '900']);
    expect(bare.rc).toBe(2);
    expect(bare.err).toContain('need --leg-kill');
    expect(runTool(t, ['--recent', '1', '--until', String(Math.floor(Date.now() / 1000) + 600)]).rc).toBe(2);
  });

  it('a leg that ends with a kill\'s status inside its bound is not said to have run out of time', () => {
    // 137 is also what a test process the slice's memory cap killed leaves; 124 what a `timeout` of the leg's own does.
    for (const rc of ['137', '124']) {
      const t = toolFixture({ FAKE_LOCAL_RC: rc });
      const r = runBounded(t, ['--recent', '1', '--leg-deadline', '900', ...KILL]);
      expect(r.err, rc).not.toContain('did not end within');
      // the leg printed no report, so its side reads absent and the pull request differs: that is its one reason
      expect(r.out, rc).toMatch(/^test\/t\d+\.test\.ts: local absent, box pass/m);
      expect(r.rc, rc).toBe(1);
    }
  });

  it('after --until nothing more is started: every pull request is said not to have run, and the record is still written, as a fail', () => {
    const t = toolFixture({ FAKE_LOCAL_HANG: '120' });
    const rec = join(t.dir, 'rec.json');
    const r = runBounded(t, ['--recent', '5', '--fixtures', '--until', String(Math.floor(Date.now() / 1000) - 1), '--leg-deadline', '900', ...KILL, '--record', rec, ...META]);
    expect(r.rc, r.out + r.err).toBe(1);
    expect(r.ms).toBeLessThan(30_000);
    expect(r.err.split('\n').filter((l) => l.includes('not run: the time given to this run is over (--until)'))).toHaveLength(5);
    // no worktree, no leg on either side
    expect(r.out).not.toContain('== ');
    expect(existsSync(t.clientLog)).toBe(false);
    expect(existsSync(join(t.env['HOME']!, 'leg-pid'))).toBe(false);
    const read = readTestboxParityRecord(readFileSync(rec, 'utf8'));
    expect(read.ok, JSON.stringify(read)).toBe(true);
    if (read.ok) expect(read.value).toMatchObject({ result: 'fail', prs: [], fixtures: FX.map((name) => ({ name, result: 'fail' })) });
  });

  it('a step that begins near --until gets only what is left, so a run that is only slow ends by itself with its record', () => {
    const t = toolFixture({ FAKE_LOCAL_HANG: '120' });
    const rec = join(t.dir, 'rec.json');
    // --until two to three seconds away: the first local leg is cut to what is left, and what follows it is not started
    const r = runBounded(t, ['--recent', '5', '--until', String(Math.floor(Date.now() / 1000) + 3), '--leg-deadline', '900', ...KILL, '--record', rec, ...META]);
    expect(r.rc, r.out + r.err).toBe(1);
    expect(r.ms).toBeLessThan(30_000);
    expect(r.err).toMatch(/r0: the local leg did not end within [123]s and was stopped/);
    expect(r.err).not.toContain('within 900s');
    expect(r.err).toContain('r0: the box leg did not run: the time given to this run is over (--until)');
    expect(r.err.split('\n').filter((l) => l.includes('not run: the time given to this run is over (--until)') && !l.includes('leg'))).toHaveLength(4);
    const read = readTestboxParityRecord(readFileSync(rec, 'utf8'));
    expect(read.ok && read.value.result).toBe('fail');
  });

  it('a TERM to the tool\'s `timeout` reaches a running leg: the tool passes it on to the leg\'s own `timeout`', () => {
    // `ccrc testbox-admin parity` runs the tool under a `timeout` of its own and cancels by a TERM to that `timeout`, which
    // signals the tool. A bounded leg is under the platform shim's `timeout`, in a process group of its own, so the tool's
    // TERM trap is what reaches it.
    const t = toolFixture({ FAKE_LOCAL_HANG: '120' });
    const legPid = join(t.env['HOME']!, 'leg-pid');
    const r = spawnSyncGroup(BASH, ['-c', `timeout -k 5 100 "$BASH" "$1" --repo "$2" --package server --sample-budget 240 --recent 1 --leg-deadline 900 --leg-kill 2 -- vitest run >/dev/null 2>&1 & o=$!
      for i in $(seq 1 400); do [ -s "$3" ] && break; sleep 0.05; done
      [ -s "$3" ] || { echo no-leg; kill "$o"; exit 1; }
      leg=$(cat "$3"); kill -0 "$leg" || { echo leg-not-running; exit 1; }
      kill "$o"; wait "$o"
      for i in $(seq 1 100); do kill -0 "$leg" 2>/dev/null || { echo leg-gone; exit 0; }; sleep 0.05; done
      echo leg-alive; kill "$leg"`, '_', t.tool, t.repo, legPid], { env: t.env, encoding: 'utf8', cwd: t.dir, timeout: 60_000 });
    expect(r.stdout, r.stdout + r.stderr).toBe('leg-gone\n');
  });

  it('the local leg\'s wait in the heavy-test queue is added to its bound; one stopped while still queued says so', () => {
    // the leg waits 3 s in the queue, then runs at once: a 2 s bound alone stops it while it is still queued
    const t = toolFixture({ FAKE_LOCAL_QUEUE: '3' });
    const r = runBounded(t, ['--recent', '1', '--leg-deadline', '2', '--queue-wait', '4', ...KILL]);
    expect(r.rc, r.out + r.err).toBe(0);
    expect(r.err).not.toContain('did not end within');
    expect(r.err).toContain("r0: the local leg waited 3s in the fleet's heavy-test queue before it started");
    const q = toolFixture({ FAKE_LOCAL_QUEUE: '3' });
    const s2 = runBounded(q, ['--recent', '1', '--leg-deadline', '2', ...KILL]);
    expect(s2.rc).toBe(1);
    expect(s2.err).toContain("r0: the local leg waited in the fleet's heavy-test queue for its whole 2s and never started: the fleet box was busy");
    expect(s2.err).not.toContain('r0: the local leg did not end within');
    // the box leg never waits in that queue: its bound is the step's alone
    expect(s2.err).not.toContain('box leg waited');
  });

  it('--merge is the rows\' records as one: a pass needs every row a pass, the three fixtures and a pull request', () => {
    const t = toolFixture();
    const row = (name: string, result: string, fixtures: unknown[]): string => {
      const f = join(t.dir, `${name}.json`);
      writeFileSync(f, `${JSON.stringify({ v: 1, result, prs: [{ repo: name, number: 7, rev: 'c'.repeat(40) }], fixtures, release: 'v1.2.3', toolsKey: 'k', fingerprint: FP, boxFileSha256: SHA, at: 1 })}\n`);
      return f;
    };
    const fx = FX.map((name) => ({ name, result: 'pass' }));
    const merge = (fail: string, files: string[]): ReturnType<typeof readTestboxParityRecord> => {
      const r = spawnSync(BASH, [t.tool, '--merge', fail, 'v1.2.3', 'node-20.1.0', FP, SHA, ...files], { env: t.env, encoding: 'utf8', cwd: t.dir });
      expect(r.status, r.stderr).toBe(0);
      return readTestboxParityRecord(r.stdout);
    };
    const a = row('project-a', 'pass', fx);
    const b = row('project-b', 'pass', []);
    const both = merge('0', [a, b]);
    expect(both.ok && both.value).toMatchObject({
      result: 'pass', release: 'v1.2.3', toolsKey: 'node-20.1.0', fingerprint: FP, boxFileSha256: SHA, fixtures: fx,
      prs: [{ repo: 'project-a', number: 7 }, { repo: 'project-b', number: 7 }],
    });
    // the merged record carries no `files` either (the reader ships first)
    expect(both.ok && Object.hasOwn(both.value, 'files')).toBe(false);
    const failOf = (fail: string, files: string[]): unknown => { const m = merge(fail, files); return m.ok && m.value.result; };
    expect(failOf('1', [a, b]), 'a row could not run').toBe('fail');
    expect(failOf('0', [a, row('project-c', 'fail', [])]), 'a row failed').toBe('fail');
    expect(failOf('0', [b]), 'no fixtures').toBe('fail');
    expect(failOf('0', [a, join(t.dir, 'absent.json')]), 'a record that cannot be read').toBe('fail');
    expect(failOf('0', []), 'no row at all').toBe('fail');
  });
});

// The times' trust rule is copied from the CI module that owns it (legitimately different by host: the fleet box ships no
// `.github/`); the copy's workflow path and events must stay the owner's.
describe('testbox-parity: the trusted run is the one `.github/ci/main-artifact.mjs` trusts', () => {
  it('names the same workflow path and the same trusted events', () => {
    const text = readFileSync(TOOL, 'utf8');
    expect(/const CI_WORKFLOW_PATH = "([^"]+)";/.exec(text)?.[1]).toBe(CI_WORKFLOW_PATH);
    expect(JSON.parse(/const TRUSTED_EVENTS = (\[[^\]]*\]);/.exec(text)?.[1] ?? 'null')).toEqual(TRUSTED_EVENTS);
  });
});

// ── the verb ────────────────────────────────────────────────────────────────────────────────────────────────────────
const ROW = (name: string): unknown => ({
  name, fetchUrl: `https://testbox.invalid/${name}.git`, mirrorPath: `/srv/mirror/${name}.git`,
  packages: [{ name: 'server', installInputs: ['server/package.json'], commands: ['./node_modules/.bin/vitest'] }],
  buildOutputs: [], systemTools: [],
});
/** What the box's own row files would say if root on the box edited them: a head that runs a package. Parity must never read it. */
const EVIL_ROWS_OUT = ['project-a', 'project-b'].map((n) => `@@ ${n}.json\\n${JSON.stringify({ ...(ROW(n) as object), packages: [{ name: 'server', installInputs: [], commands: ['npx attacker-package'] }] })}\\n`).join('');
/** The fleet host's own record of the rows it sent (`~/.ccrc/testbox-rows`: name, fetch URL, package, command head). */
const FLEET_ROWS = ['project-a', 'project-b'].map((n) => `${n} https://testbox.invalid/${n}.git server ./node_modules/.bin/vitest\n`).join('');
const BOXENV = '/etc/ccrc-testbox/ccrc.env';
/** A regular expression matching `s` literally (every metacharacter, the backslash too, escaped). */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RULES: string[][] = [
  ['build\\.json', '0', '{"version":"v1.2.3"}'],
  ['current', '0', 'node-20.1.0+chrome-130.0'],
  ['CCRC_TESTBOX_REPOS', '0', EVIL_ROWS_OUT],
  [escapeRe(BOXENV), '0', ''],
];

interface Home { home: string; env: NodeJS.ProcessEnv; log: string; toolLog: string; state: string; parity: string; calls: string }

function fixture(extra: NodeJS.ProcessEnv = {}, rules: string[][] = RULES): Home {
  const home = mkTmp('tb-parity-verb-');
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const fakes = join(home, 'fakes');
  mkdirSync(fakes, { recursive: true });
  symlinkSync(BOXFAKE, join(fakes, 'ssh'));
  symlinkSync(BOXFAKE, join(fakes, 'ip'));
  symlinkSync(SCANFAKE, join(fakes, 'ssh-keyscan'));
  writeFileSync(join(home, 'rules'), rules.map((r) => r.join('\t')).join('\n') + '\n');
  writeFileSync(join(home, '.ccrc', 'testbox-rows'), FLEET_ROWS, { mode: 0o600 });
  // The fleet's own clones of the two rows' fetch URLs, one spelled as an ssh URL.
  for (const [n, url] of [['project-a', 'https://testbox.invalid/project-a.git'], ['project-b', 'git@testbox.invalid:project-b.git']] as const) {
    const d = join(home, 'projects', n);
    mkdirSync(d, { recursive: true });
    git(d, 'init', '-q');
    git(d, 'remote', 'add', 'origin', url);
  }
  const ghAuth = join(home, 'gh-fake');
  writeFileSync(ghAuth, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/gh-calls"\nexit "${FAKE_GH_AUTH_RC:-0}"\n', { mode: 0o755 });
  // The tool's stand-in: logs its argv (one word per line, a `--` line first) and writes the record it was told to.
  const toolLog = join(home, 'tool-log');
  const tool = join(home, 'tool-fake');
  writeFileSync(tool, `#!/bin/bash
{ printf -- '-- tool\\n'; for a in "$@"; do printf '%s\\n' "$a"; done; } >> ${JSON.stringify(toolLog)}
args=("$@"); rec=""; name=""; rel=""; tk=""; fp=""; sha=""; fx=0; n=0
for ((i = 0; i < \${#args[@]}; i++)); do
  case "\${args[i]}" in
    --record) rec="\${args[i+1]}" ;; --repo-name) name="\${args[i+1]}" ;; --release) rel="\${args[i+1]}" ;;
    --tools-key) tk="\${args[i+1]}" ;; --fingerprint) fp="\${args[i+1]}" ;; --box-sha256) sha="\${args[i+1]}" ;; --fixtures) fx=1 ;;
  esac
done
# FAKE_TOOL_LEAVE: a process the legs left behind, alive after the tool ends. FAKE_TOOL_HANG: a leg that never ends by itself.
if [ -n "\${FAKE_TOOL_LEAVE:-}" ]; then sleep "$FAKE_TOOL_LEAVE" </dev/null >/dev/null 2>&1 & echo $! >> "$HOME/left-pid"; fi
if [ -n "\${FAKE_TOOL_HANG:-}" ]; then sleep "$FAKE_TOOL_HANG" & echo $! > "$HOME/leg-pid"; echo $$ > "$HOME/tool-pid"; wait; fi
# FAKE_TOOL_LINES: after FAKE_TOOL_DELAY, one line written in two halves FAKE_TOOL_GAP apart, then that many lines, and the tool
# ends at once.
if [ -n "\${FAKE_TOOL_LINES:-}" ]; then
  sleep "\${FAKE_TOOL_DELAY:-0}"
  printf '%s' "$name first half, "; sleep "\${FAKE_TOOL_GAP:-0}"; echo "second half"
  for ((k = 1; k <= FAKE_TOOL_LINES; k++)); do echo "$name line $k"; done
fi
res="\${FAKE_TOOL_RESULT:-pass}"
fxs='[]'
[ "$fx" = 0 ] || fxs='[{"name":"git-state","result":"pass"},{"name":"socket","result":"pass"},{"name":"workers","result":"'"\${FAKE_FX_RESULT:-pass}"'"}]'
[ "\${FAKE_TOOL_NOREC:-0}" = 1 ] || printf '{"v":1,"result":"%s","prs":[{"repo":"%s","number":7,"rev":"%s"}],"fixtures":%s,"release":"%s","toolsKey":"%s","fingerprint":"%s","boxFileSha256":"%s","at":1}\\n' \\
  "$res" "$name" "$(printf 'c%.0s' $(seq 1 40))" "$fxs" "$rel" "$tk" "$fp" "$sha" > "$rec"
echo "parity: done"
[ "$res" = pass ]
`, { mode: 0o755 });
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_') && !k.startsWith('TB_') && !k.startsWith('FAKE_') && !k.startsWith('TBA_')) base[k] = v;
  Object.assign(base, {
    HOME: home, TMPDIR: join(home, 'tmp'), LANG: 'C', PATH: `${fakes}:${process.env['PATH'] ?? '/usr/bin:/bin'}`,
    FAKE_LOG: join(home, 'fake-log'), FAKE_RULES: join(home, 'rules'), FAKE_STDIN_DIR: join(home, 'stdin'), FAKE_IP_OUT: `${ADDR} dev eth0 src ${SRC_ADDR} uid 0`,
    FAKE_SSH_KEYSCAN_RC: '1', TBA_GH: ghAuth, TBA_PARITY_TOOL: tool, SYSTEMD_RUN_RC: '0', TBA_CHECK_DEADLINE: '0', TBA_CANCEL_POLL: '0.05', ...extra,
  });
  return {
    home, env: ghContainedEnv(home, base, { systemd: true, tmux: true }), log: join(home, 'fake-log'), toolLog,
    state: join(home, '.ccrc', 'testbox-admin.state'), parity: join(home, '.ccrc', 'testbox-parity.json'), calls: join(home, 'systemd-run-calls'),
  };
}

function sh(h: Home, program: string, args: string[] = []): { out: string; err: string; rc: number } {
  const r = spawnSync(BASH, ['-c', program, '_', ...args], { env: h.env, encoding: 'utf8', cwd: h.home });
  return { out: r.stdout ?? '', err: r.stderr ?? '', rc: r.status ?? -1 };
}
function connectedTo(h: Home, extra: string[] = []): void {
  const g = sh(h, SRC + '_tba_main key --address="$1"', [VERB, ADDR]);
  expect(g.out, g.out + g.err).toContain('"ok":true');
  writeFileSync(join(h.home, '.ccrc', 'testbox-known-hosts'), `${ADDR} ssh-ed25519 AAAA\n`, { mode: 0o600 });
  appendFileSync(h.state, ['connected=1', `box_tools=${TOOLS}`, 'box_root=/srv/box', `box_sha256=${SHA}`, `fingerprint=${FP}`, ...extra].join('\n') + '\n');
}
function detach(h: Home, words: string[]): { id: string | null; out: string } {
  const r = sh(h, SRC + '_tba_main parity "$@" --from pwa', [VERB, ...words]);
  const m = /^\{"ok":true,"act":"([0-9a-f]{32})"\}\n$/.exec(r.out);
  return { id: m ? m[1]! : null, out: r.out + r.err };
}
function unit(h: Home, id: string): void {
  const r = sh(h, SRC + `CCRC_TBA_ACT=${id} _tba_main parity >"$HOME/unit-out" 2>"$HOME/unit-err"; echo "rc=$?"`, [VERB]);
  expect(r.out.trim()).toBe('rc=0');
}
function act(h: Home, words: string[] = []): string {
  const d = detach(h, words);
  expect(d.id, d.out).not.toBeNull();
  unit(h, d.id!);
  return d.id!;
}
function toolCalls(h: Home): string[][] {
  if (!existsSync(h.toolLog)) return [];
  const calls: string[][] = [];
  for (const l of readFileSync(h.toolLog, 'utf8').split('\n')) {
    if (l === '-- tool') calls.push([]);
    else if (l !== '' && calls.length > 0) calls[calls.length - 1]!.push(l);
  }
  return calls;
}
function status(h: Home): NonNullable<ReturnType<typeof readTestboxAdminStatus> & { ok: true }>['value'] {
  const r = spawnSync(BASH, [VERB, 'status'], { env: h.env, encoding: 'utf8', cwd: h.home });
  const s = readTestboxAdminStatus((r.stdout ?? '').trim());
  expect(s.ok, JSON.stringify(s)).toBe(true);
  if (!s.ok) throw new Error('unreachable');
  return s.value;
}
const flag = (call: string[], name: string): string[] => call.flatMap((w, i) => (w === name ? [call[i + 1]!] : []));

describe.skipIf(!HAS_ALL || !HAS_TIMEOUT)('ccrc testbox-admin parity (D-8166, TC9)', () => {
  it('with no --pr the unit asks each installed row for its newest merged pull request over a sample, with the checkout and command prefilled', () => {
    const h = fixture();
    connectedTo(h);
    act(h);
    const calls = toolCalls(h);
    expect(calls).toHaveLength(2);
    expect(flag(calls[0]!, '--repo-name')).toEqual(['project-a']);
    expect(flag(calls[1]!, '--repo-name')).toEqual(['project-b']);
    // the fleet's own clone of each row's fetch URL, an https and an ssh spelling alike
    expect(flag(calls[0]!, '--repo')).toEqual([join(h.home, 'projects', 'project-a')]);
    expect(flag(calls[1]!, '--repo')).toEqual([join(h.home, 'projects', 'project-b')]);
    for (const c of calls) {
      // one pull request per row (D-8945), and each row's share of the table's sample budget: two rows, half each
      expect(flag(c, '--recent')).toEqual(['1']);
      expect(flag(c, '--sample-budget')).toEqual([String(TESTBOX_ADMIN_DEADLINE_S['parity/sample'] / 2)]);
      expect(flag(c, '--sample-budget')).toEqual(['120']);
      expect(flag(c, '--package')).toEqual(['server']);
      expect(flag(c, '--pr')).toEqual([]);
      expect(c.slice(c.indexOf('--') + 1)).toEqual(['./node_modules/.bin/vitest', 'run']);
      expect(flag(c, '--release')).toEqual(['v1.2.3']);
      expect(flag(c, '--tools-key')).toEqual(['node-20.1.0+chrome-130.0']);
      expect(flag(c, '--fingerprint')).toEqual([FP]);
      expect(flag(c, '--box-sha256')).toEqual([SHA]);
    }
    // the fixtures run once, with the first row
    expect(calls[0]).toContain('--fixtures');
    expect(calls[1]).not.toContain('--fixtures');
  });

  it('the rows come from the fleet host\'s own record, never from the box: root on the box cannot make parity run its command here (spec 2.11)', () => {
    const h = fixture();
    connectedTo(h);
    act(h);
    // The box's row files (EVIL_ROWS_OUT: a head `npx attacker-package`) were never asked for, and no tool call carries the head.
    expect(readFileSync(h.log, 'utf8')).not.toContain('CCRC_TESTBOX_REPOS');
    for (const c of toolCalls(h)) expect(c.join(' ')).not.toContain('attacker-package');
    expect(readFileSync(join(h.home, 'tool-log'), 'utf8')).not.toContain('npx');
  });

  it('with no row on record the unit ends status-not-ok and runs nothing, whatever the box holds', () => {
    const h = fixture();
    rmSync(join(h.home, '.ccrc', 'testbox-rows'));
    connectedTo(h);
    act(h);
    expect(toolCalls(h)).toEqual([]);
    expect(status(h).act).toMatchObject({ sub: 'parity', outcome: 'failed', code: 'status-not-ok' });
  });

  it('named pull requests replace the default scope, on the first row', () => {
    const h = fixture();
    connectedTo(h);
    act(h, ['--pr=11', '--pr=12']);
    const calls = toolCalls(h);
    expect(flag(calls[0]!, '--pr')).toEqual(['11', '12']);
    expect(flag(calls[0]!, '--recent')).toEqual([]);
    expect(calls[0]).toContain('--fixtures');
    expect(flag(calls[1]!, '--recent')).toEqual(['1']);
    for (const c of calls) expect(flag(c, '--sample-budget')).toEqual(['120']);
  });

  it('one row takes the whole sample budget, and a share is never under a minute (D-8945)', () => {
    const one = fixture();
    writeFileSync(join(one.home, '.ccrc', 'testbox-rows'), FLEET_ROWS.split('\n')[0] + '\n', { mode: 0o600 });
    connectedTo(one);
    act(one);
    expect(toolCalls(one).map((c) => flag(c, '--sample-budget'))).toEqual([[String(TESTBOX_ADMIN_DEADLINE_S['parity/sample'])]]);
    expect(TESTBOX_ADMIN_DEADLINE_S['parity/sample']).toBe(240);
    // a budget split five ways would be 48 s: the floor is 60
    const floor = fixture();
    connectedTo(floor);
    const d = detach(floor, []);
    expect(d.id, d.out).not.toBeNull();
    const r = sh(floor, SRC + `TBA_DEADLINE_S[parity/sample]=96; CCRC_TBA_ACT=${d.id} _tba_main parity >"$HOME/unit-out" 2>"$HOME/unit-err"; echo "rc=$?"`, [VERB]);
    expect(r.out.trim()).toBe('rc=0');
    expect(toolCalls(floor).map((c) => flag(c, '--sample-budget'))).toEqual([['60'], ['60']]);
  });

  it('the record carries the result, the pull requests, the fixtures, the release, the tools key, the fingerprint, the box file sha256 and the time', () => {
    const h = fixture();
    connectedTo(h);
    const before = Date.now();
    act(h);
    expect((statSync(h.parity).mode & 0o777).toString(8)).toBe('600');
    const read = readTestboxParityRecord(readFileSync(h.parity, 'utf8'));
    expect(read.ok, JSON.stringify(read)).toBe(true);
    if (!read.ok) return;
    expect(read.value).toMatchObject({
      v: 1, result: 'pass', release: 'v1.2.3', toolsKey: 'node-20.1.0+chrome-130.0', fingerprint: FP, boxFileSha256: SHA,
      prs: [{ repo: 'project-a', number: 7 }, { repo: 'project-b', number: 7 }],
      fixtures: FX.map((name) => ({ name, result: 'pass' })),
    });
    expect(read.value.at).toBeGreaterThanOrEqual(before);
    const s = status(h);
    expect(s.parity).toEqual(read.value);
    expect(s.act).toMatchObject({ sub: 'parity', outcome: 'ok' });
    expect(s.act?.phases.map((p) => p.name)).toEqual(['legs', 'record']);
  });

  it('a leg that differs writes a fail record and ends the act parity-differs', () => {
    const h = fixture({ FAKE_TOOL_RESULT: 'fail' });
    connectedTo(h, ['parity_stale=1']);
    act(h);
    const read = readTestboxParityRecord(readFileSync(h.parity, 'utf8'));
    expect(read.ok && read.value.result).toBe('fail');
    expect(status(h).act).toMatchObject({ sub: 'parity', outcome: 'failed', code: 'parity-differs' });
    // a fail leaves the stale mark where it was
    expect(readFileSync(h.state, 'utf8')).toContain('parity_stale=1');
  });

  it('a row with no clone on the fleet host, or a fixture that failed, is not a pass', () => {
    const missing = fixture();
    connectedTo(missing);
    sh(missing, 'rm -rf "$HOME/projects/project-b"');
    act(missing);
    const a = readTestboxParityRecord(readFileSync(missing.parity, 'utf8'));
    expect(a.ok && a.value.result).toBe('fail');
    const fx = fixture({ FAKE_FX_RESULT: 'fail' });
    connectedTo(fx);
    act(fx);
    const b = readTestboxParityRecord(readFileSync(fx.parity, 'utf8'));
    expect(b.ok && b.value.result).toBe('fail');
    // a tool that wrote no record is a fail too
    const none = fixture({ FAKE_TOOL_NOREC: '1' });
    connectedTo(none);
    act(none);
    const c = readTestboxParityRecord(readFileSync(none.parity, 'utf8'));
    expect(c.ok && c.value.result).toBe('fail');
  });

  it('gh signed out refuses gh-signed-out and writes no record', () => {
    const h = fixture({ FAKE_GH_AUTH_RC: '1' });
    connectedTo(h);
    const d = detach(h, []);
    expect(d.id).toBeNull();
    expect(JSON.parse(d.out)).toEqual({ ok: false, code: 'gh-signed-out' });
    expect(existsSync(h.parity)).toBe(false);
    expect(existsSync(h.calls)).toBe(false);
    expect(toolCalls(h)).toEqual([]);
    expect(readFileSync(join(h.home, 'gh-calls'), 'utf8')).toBe('auth status\n');
  });

  it('a box that is not connected refuses not-connected before any unit', () => {
    const h = fixture();
    const d = detach(h, []);
    expect(d.id).toBeNull();
    expect(JSON.parse(d.out)).toEqual({ ok: false, code: 'not-connected' });
    expect(existsSync(h.calls)).toBe(false);
  });

  it('the parity unit runs in ccrctests.slice', () => {
    const h = fixture();
    connectedTo(h);
    const d = detach(h, []);
    expect(d.id, d.out).not.toBeNull();
    const calls = readFileSync(h.calls, 'utf8');
    expect(calls).toContain(`--unit=ccrc-testbox-admin-parity-${d.id}`);
    expect(calls).toContain('--slice=ccrctests.slice');
    // the other long acts keep the verb's own slice (none named)
    const other = fixture();
    connectedTo(other);
    const o = sh(other, SRC + '_tba_main repair --from pwa', [VERB]);
    expect(o.out + o.err).not.toBe('');
    if (existsSync(other.calls)) expect(readFileSync(other.calls, 'utf8')).not.toContain('--slice');
  });

  it('a pass clears the stale mark', () => {
    const h = fixture();
    connectedTo(h, ['parity_stale=1']);
    expect(readFileSync(h.state, 'utf8')).toContain('parity_stale=1');
    act(h);
    const stateAfter = sh(h, SRC + '_tba_state_get parity_stale; echo "rc=$?"', [VERB]);
    expect(stateAfter.out.trim()).toBe('rc=1');
    const read = readTestboxParityRecord(readFileSync(h.parity, 'utf8'));
    expect(read.ok && read.value.result).toBe('pass');
    if (read.ok) expect(parityArmable(read.value, { fingerprint: FP, boxFileSha256: SHA, stale: false })).toBe(true);
  });
  // ── D-8899 ──────────────────────────────────────────────────────────────────────────────────────────────
  const alive = (pid: string): boolean => spawnSync(BASH, ['-c', 'kill -0 "$1" 2>/dev/null', '_', pid]).status === 0;
  const pidOf = (h: Home, name: string): string => readFileSync(join(h.home, name), 'utf8').trim();
  const lockFree = (h: Home): boolean => spawnSync('flock', ['-n', join(h.home, '.ccrc', 'testbox-admin.lock'), 'true']).status === 0;
  const gone = (pid: string): boolean => {
    for (let i = 0; i < 100 && alive(pid); i++) spawnSync('sleep', ['0.05']);
    return !alive(pid);
  };

  it('the parity unit has the parity row as its ceiling, and hands the tool its step\'s bound, its kill, its queue wait and the time to end by from the same table', () => {
    const h = fixture();
    connectedTo(h);
    const d = detach(h, []);
    expect(d.id, d.out).not.toBeNull();
    expect(readFileSync(h.calls, 'utf8')).toContain(` --property=RuntimeMaxSec=${TESTBOX_ADMIN_DEADLINE_S.parity} `);
    unit(h, d.id!);
    const calls = toolCalls(h);
    expect(calls).toHaveLength(2);
    // the legs end by the act's recorded start plus its ceiling less the tail: every row is given the same time
    const started = Number(/^act_started=(\d+)$/m.exec(readFileSync(h.state, 'utf8'))![1]);
    const until = Math.floor(started / 1000) + TESTBOX_ADMIN_DEADLINE_S.parity - TESTBOX_ADMIN_DEADLINE_S['parity/tail'];
    for (const c of calls) {
      expect(flag(c, '--leg-deadline')).toEqual([String(TESTBOX_ADMIN_DEADLINE_S['parity/leg'])]);
      expect(flag(c, '--leg-kill')).toEqual([String(TESTBOX_ADMIN_DEADLINE_S['parity/kill'])]);
      expect(flag(c, '--until')).toEqual([String(until)]);
      // the local leg's wait in the fleet's heavy-test queue, from the same table (D-8947)
      expect(flag(c, '--queue-wait')).toEqual([String(TESTBOX_ADMIN_DEADLINE_S['parity/queue'])]);
    }
  });

  /** The unit with the table's parity rows set for this run: `parity` and `parity/tail` equal, so the legs' time is already over. */
  const unitOutOfTime = (h: Home, id: string, tail: number): { rc: number; ms: number } => {
    const t0 = Date.now();
    const r = spawnSyncGroup(BASH, ['-c', SRC + `TBA_DEADLINE_S[parity]=${tail}; TBA_DEADLINE_S[parity/tail]=${tail}; TBA_DEADLINE_S[parity/kill]=2; CCRC_TBA_ACT=${id} _tba_main parity >"$HOME/unit-out" 2>"$HOME/unit-err"`, '_', VERB],
      { env: h.env, encoding: 'utf8', cwd: h.home, timeout: 60_000 });
    return { rc: r.status ?? -1, ms: Date.now() - t0 };
  };

  it('a tool that does not end by the act\'s time is stopped half the tail later: the act ends parity-differs with a record and the reason, and never waits for its ceiling', () => {
    const h = fixture({ FAKE_TOOL_HANG: '120' });
    connectedTo(h);
    const d = detach(h, []);
    expect(d.id, d.out).not.toBeNull();
    const r = unitOutOfTime(h, d.id!, 4);
    expect(r.rc).toBe(0);
    // two rows, each stopped two seconds (half the tail) after a time that had already passed: far inside the tool's 120 s
    expect(r.ms).toBeLessThan(30_000);
    expect(toolCalls(h)).toHaveLength(2);
    expect(gone(pidOf(h, 'tool-pid')), 'the tool is stopped').toBe(true);
    expect(status(h).act).toMatchObject({ id: d.id, sub: 'parity', outcome: 'failed', code: 'parity-differs' });
    expect(status(h).act?.phases.map((p) => p.name)).toEqual(['legs', 'record']);
    const read = readTestboxParityRecord(readFileSync(h.parity, 'utf8'));
    expect(read.ok && read.value.result).toBe('fail');
    const log = readFileSync(join(h.home, '.ccrc', 'testbox-admin.log'), 'utf8');
    expect(log.split('\n').filter((l) => l.endsWith("the tool did not end by the act's time and was stopped"))).toEqual([
      "parity: project-a: the tool did not end by the act's time and was stopped", "parity: project-b: the tool did not end by the act's time and was stopped",
    ]);
    expect(lockFree(h)).toBe(true);
  });

  /** The log's parity lines after one act whose tool printed `lines` lines per row. */
  const parityLog = (extra: NodeJS.ProcessEnv): string[] => {
    const h = fixture(extra);
    connectedTo(h);
    act(h);
    return readFileSync(join(h.home, '.ccrc', 'testbox-admin.log'), 'utf8').split('\n').filter((l) => l.startsWith('parity: '));
  };
  const wantLog = (lines: number): string[] => [
    'parity: begins',
    ...['project-a', 'project-b'].flatMap((n) => [
      `parity: ${n}: ${n} first half, second half`, ...Array.from({ length: lines }, (_, k) => `parity: ${n}: ${n} line ${k + 1}`), `parity: ${n}: parity: done`,
    ]),
    'parity: ok',
  ];

  it('every line the tool wrote is in the log, in order, before the act\'s own last line; a line written in two halves with a look between them is one line', () => {
    // the unit looks every 50 ms and the halves are 400 ms apart, so a look falls between them
    expect(parityLog({ FAKE_TOOL_LINES: '300', FAKE_TOOL_GAP: '0.4' })).toEqual(wantLog(300));
  });

  it('what the tool wrote just before it ended is in the log too: the unit looks once more after the tool is gone', () => {
    // the unit looks at once (nothing yet), then sleeps 1.5 s; the tool writes all its lines 0.3 s in and ends, so the unit's
    // next look at the tool finds it gone, and only the look after the wait can read them
    expect(parityLog({ FAKE_TOOL_LINES: '5', FAKE_TOOL_DELAY: '0.3', TBA_CANCEL_POLL: '1.5' })).toEqual(wantLog(5));
  });

  it('cancel ends a running parity act: the tool and its leg are stopped, the act ends cancelled, the lock is free and no record is written', () => {
    const h = fixture({ FAKE_TOOL_HANG: '120' });
    connectedTo(h);
    const d = detach(h, []);
    expect(d.id, d.out).not.toBeNull();
    const t0 = Date.now();
    const r = spawnSyncGroup(BASH, ['-c', SRC + `CCRC_TBA_ACT=${d.id} _tba_main parity >"$HOME/unit-out" 2>"$HOME/unit-err" & u=$!
      for i in $(seq 1 400); do [ -s "$HOME/tool-pid" ] && break; sleep 0.05; done
      ( _tba_main status ) >"$HOME/status-mid"
      ( _tba_main cancel --from pwa )
      wait "$u"; echo "rc=$?"`, '_', VERB], { env: h.env, encoding: 'utf8', cwd: h.home, timeout: 60_000 });
    expect(r.stdout, r.stdout + r.stderr).toBe('{"ok":true,"cancelled":true}\nrc=0\n');
    // far inside the 120 s the leg would have taken
    expect(Date.now() - t0).toBeLessThan(30_000);
    const mid = readTestboxAdminStatus(readFileSync(join(h.home, 'status-mid'), 'utf8').trim());
    expect(mid.ok && mid.value.act).toMatchObject({ id: d.id, sub: 'parity', outcome: 'running', phase: 'legs' });
    expect(status(h).act).toMatchObject({ id: d.id, sub: 'parity', outcome: 'failed', code: 'cancelled', phase: 'legs' });
    expect(gone(pidOf(h, 'tool-pid')), 'the tool is stopped').toBe(true);
    expect(gone(pidOf(h, 'leg-pid')), 'the leg the tool started is stopped with it').toBe(true);
    expect(lockFree(h)).toBe(true);
    // the first row was cancelled, so the second never ran, and nothing was recorded
    expect(toolCalls(h)).toHaveLength(1);
    expect(existsSync(h.parity)).toBe(false);
    expect(existsSync(join(h.home, '.ccrc', 'testbox-admin.cancel'))).toBe(false);
    expect(readFileSync(join(h.home, '.ccrc', 'testbox-admin.log'), 'utf8')).toContain('parity: cancelled');
    // an act that has ended is not cancelled
    expect(JSON.parse(sh(h, SRC + '_tba_main cancel --from pwa', [VERB]).out)).toEqual({ ok: true, cancelled: false });
  });

  it('cancel is refused once parity writes its record, and a cancel left by an earlier act never ends this one', () => {
    const h = fixture();
    connectedTo(h);
    const d = detach(h, []);
    expect(d.id, d.out).not.toBeNull();
    appendFileSync(h.state, 'act_phase=record\n');
    expect(JSON.parse(sh(h, SRC + '_tba_main cancel --from pwa', [VERB]).out)).toEqual({ ok: true, cancelled: false });
    sh(h, SRC + '_tba_state_write act_phase=', [VERB]);
    writeFileSync(join(h.home, '.ccrc', 'testbox-admin.cancel'), 'f'.repeat(32));
    unit(h, d.id!);
    expect(status(h).act).toMatchObject({ id: d.id, outcome: 'ok', code: null });
    expect(existsSync(join(h.home, '.ccrc', 'testbox-admin.cancel'))).toBe(false);
  });

  it('a process a leg leaves behind does not carry the act\'s lock: the lock is free when the act ends', () => {
    const h = fixture({ FAKE_TOOL_LEAVE: '30' });
    connectedTo(h);
    const d = detach(h, []);
    expect(d.id, d.out).not.toBeNull();
    // The unit's own output goes to files, as a unit's goes nowhere: the log reader of a row lives while a left-behind process
    // keeps its pipe open, and a pipe to this process would make the test wait for it.
    const out = openSync(join(h.home, 'unit-std'), 'w');
    const r = spawnSyncGroup(BASH, ['-c', SRC + `CCRC_TBA_ACT=${d.id} _tba_main parity`, '_', VERB], { env: h.env, encoding: 'utf8', cwd: h.home, stdio: ['ignore', out, out], timeout: 60_000 });
    closeSync(out);
    expect(r.status).toBe(0);
    const left = readFileSync(join(h.home, 'left-pid'), 'utf8').trim().split('\n');
    try {
      expect(left).toHaveLength(2);
      for (const pid of left) expect(alive(pid), 'the left-behind process outlives the act').toBe(true);
      expect(status(h).act).toMatchObject({ sub: 'parity', outcome: 'ok' });
      expect(lockFree(h), 'no later act is answered busy for it').toBe(true);
    } finally {
      for (const pid of left) spawnSync(BASH, ['-c', 'kill "$1" 2>/dev/null', '_', pid]);
    }
  });
});
