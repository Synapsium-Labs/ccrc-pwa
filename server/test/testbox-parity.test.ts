// D-8166 (plan docs/superpowers/plans/2026-11-10-test-box-connect.md, Task TC9; spec §2.8, C8, C16): the parity tool's scope and
// record (`ccd/testbox-parity --recent --fixtures --record`) and the verb's `parity` sub (`ccrc testbox-admin parity`).
//
// What is held here: that the default scope is the five most recent merged pull requests of each installed row and that named
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
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { parityArmable, readTestboxAdminStatus, readTestboxParityRecord } from '../../shared/testbox-admin.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERB = join(REPO, 'ccd', 'ccrc-testbox-admin');
const TOOL = join(REPO, 'ccd', 'testbox-parity');
const BOXFAKE = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-connect-ssh.sh');
const SCANFAKE = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-ssh.sh');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const has = (c: string): boolean => spawnSync('bash', ['-c', `command -v ${c}`], { encoding: 'utf8' }).status === 0;
const HAS_ALL = has('ssh-keygen') && has('flock') && has('node') && has('git');
const ADDR = '203.0.113.9';
const SRC_ADDR = '192.0.2.5';
const TOOLS = '/opt/tools';
const SHA = 'b'.repeat(64);
const FP = `SHA256:${'A'.repeat(43)}`;
const SRC = '. "$1" || exit 90; shift; REAL_OS=$CCD_OS; CCD_OS=linux; '
  + 'for f in _plat_mode _plat_sha256; do eval "$(declare -f $f | sed "1s/^$f/${f}_real/")"; eval "$f() { local CCD_OS=\\$REAL_OS; ${f}_real \\"\\$@\\"; }"; done; ';
const FX = ['git-state', 'socket', 'workers'] as const;

// ── the tool ────────────────────────────────────────────────────────────────────────────────────────────────────────
interface ToolFix { dir: string; repo: string; revs: string[]; env: NodeJS.ProcessEnv; tool: string; ghLog: string; clientLog: string }
const JUNIT = (fail: boolean): string => `<testsuites><testsuite><testcase classname="a.test.ts" name="t">${fail ? '<failure message="x"/>' : ''}</testcase></testsuite></testsuites>`;

function git(cwd: string, ...a: string[]): string {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@testbox.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@testbox.invalid' } });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}

function toolFixture(extra: NodeJS.ProcessEnv = {}): ToolFix {
  const dir = mkTmp('tb-parity-');
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'server'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  const revs: string[] = [];
  for (let i = 0; i < 6; i++) {
    writeFileSync(join(repo, 'server', 'f.txt'), `${i}\n`);
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
  chmodSync(tool, 0o755);
  const fxLines = (side: string): string => `m=$(printf '%s' "$*" | sed -n 's/.*testbox-parity-fixture-\\([a-z-]*\\)\\.test\\.mjs.*/\\1/p')
if [ -n "$m" ]; then
  [ -f "testbox-parity-fixture-$m.test.mjs" ] || { echo "fixture file missing" >&2; exit 1; }
  v=ok; [ "${side}" = box ] && [ "\${FAKE_FX_DIFF:-}" = "$m" ] && v=other
  echo "decoration before"; echo "TP|$m|k|$v"; echo "decoration after"; exit 0
fi
`;
  writeFileSync(join(tdir, 'ccd', 'ccrc-test'), `#!/usr/bin/env bash\n${fxLines('local')}echo '${JUNIT(false)}'\n`, { mode: 0o755 });
  const clientLog = join(dir, 'client-log');
  writeFileSync(join(tdir, 'agent', 'dist', 'agent', 'src', 'testbox', 'client.js'), `const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(clientLog)}, a.join(' ') + '\\n');
const i = a.indexOf('--verdict');
if (i >= 0) fs.writeFileSync(a[i + 1], (process.env.FAKE_BOX_VERDICT || 'remote') + '\\tid\\tfixture text\\n');
const joined = a.join(' ');
const m = /testbox-parity-fixture-([a-z-]+)\\.test\\.mjs/.exec(joined);
if (m) {
  if (!fs.existsSync('testbox-parity-fixture-' + m[1] + '.test.mjs')) { console.error('fixture file missing'); process.exit(1); }
  console.log('decoration before');
  console.log('TP|' + m[1] + '|k|' + (process.env.FAKE_FX_DIFF === m[1] ? 'other' : 'ok'));
  console.log('decoration after');
} else {
  console.log(${JSON.stringify(JUNIT(false))}.replace('<testcase classname="a.test.ts" name="t">', '<testcase classname="a.test.ts" name="t">' + (process.env.FAKE_BOX_DIFF ? '<failure message="x"/>' : '')));
}
`);
  const ghLog = join(dir, 'gh-log');
  const gh = join(dir, 'gh-fake');
  writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(ghLog)}\ncase "$1 $2" in\n  "pr list") printf '%s\\n' "$FAKE_GH_LIST" ;;\n  "pr view") printf '%s\\n' "$FAKE_GH_VIEW" ;;\n  *) exit 1 ;;\nesac\n`, { mode: 0o755 });
  const list = JSON.stringify(revs.slice(1).reverse().map((oid, k) => ({ number: 100 - k, mergeCommit: { oid } })));
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('FAKE_') && !k.startsWith('TP_') && !k.startsWith('GIT_')) base[k] = v;
  Object.assign(base, { HOME: home, TMPDIR: dir, LANG: 'C', TP_GH: gh, FAKE_GH_LIST: list, FAKE_GH_VIEW: revs[2], ...extra });
  return { dir, repo, revs, env: ghContainedEnv(home, base, { systemd: true, tmux: true }), tool, ghLog, clientLog };
}

function runTool(t: ToolFix, args: string[]): { out: string; err: string; rc: number } {
  const r = spawnSync(BASH, [t.tool, '--repo', t.repo, '--package', 'server', ...args, '--', 'vitest', 'run'], { env: t.env, encoding: 'utf8', cwd: t.dir });
  return { out: r.stdout ?? '', err: r.stderr ?? '', rc: r.status ?? -1 };
}
const META = ['--repo-name', 'project-a', '--release', 'v1.2.3', '--tools-key', 'node-20.1.0+chrome-130.0', '--fingerprint', FP, '--box-sha256', SHA];

describe.skipIf(!HAS_ALL)('testbox-parity: its scope and its record (D-8166, TC9)', () => {
  it('with no --pr the scope is the five most recent merged pull requests of each row', () => {
    const t = toolFixture();
    const r = runTool(t, ['--recent', '5']);
    expect(r.rc, r.out + r.err).toBe(0);
    expect(readFileSync(t.ghLog, 'utf8').split('\n')[0]).toBe('pr list --state merged --limit 5 --json number,mergeCommit');
    expect(r.out.split('\n').filter((l) => l.startsWith('== '))).toEqual(t.revs.slice(1).reverse().map((v) => `== ${v}`));
    expect(r.out).toContain('parity: every file agrees');
  });

  it('named pull requests replace the default scope', () => {
    const t = toolFixture();
    const r = runTool(t, ['--pr', '7']);
    expect(r.rc, r.out + r.err).toBe(0);
    expect(readFileSync(t.ghLog, 'utf8')).not.toContain('pr list');
    expect(readFileSync(t.ghLog, 'utf8')).toContain('pr view 7 --json mergeCommit -q .mergeCommit.oid');
    expect(r.out.split('\n').filter((l) => l.startsWith('== '))).toEqual([`== ${t.revs[2]}`]);
  });

  it('refuses a --recent that is not 1 to 20 and a --record without its measurements', () => {
    const t = toolFixture();
    expect(runTool(t, ['--recent', '21']).rc).toBe(2);
    expect(runTool(t, ['--recent', '0']).rc).toBe(2);
    const r = runTool(t, ['--recent', '1', '--record', join(t.dir, 'rec.json')]);
    expect(r.rc).toBe(2);
    expect(r.err).toContain('--record needs');
    expect(existsSync(join(t.dir, 'rec.json'))).toBe(false);
  });

  it('each fixture leg runs on both sides and a byte difference fails it', () => {
    const ok = toolFixture();
    const a = runTool(ok, ['--recent', '1', '--fixtures']);
    expect(a.rc, a.out + a.err).toBe(0);
    for (const f of FX) expect(a.out).toContain(`fixture ${f}: byte-identical on both sides`);
    // both sides saw each fixture's command (the box client's log names the fixture files)
    const seen = readFileSync(ok.clientLog, 'utf8');
    for (const f of FX) expect(seen).toContain(`testbox-parity-fixture-${f}.test.mjs`);
    for (const f of FX) {
      const bad = toolFixture({ FAKE_FX_DIFF: f });
      const b = runTool(bad, ['--recent', '1', '--fixtures']);
      expect(b.rc, f).toBe(1);
      expect(b.out).toContain(`fixture ${f}: DIFFERS`);
      for (const other of FX.filter((x) => x !== f)) expect(b.out).toContain(`fixture ${other}: byte-identical`);
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
    writeFileSync(join(real, 'server', 'test', 'a.test.ts'), "import { it } from 'vitest';\nit('a', () => {});\n");
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
    const env = { ...t.env, PATH: `${join(REPO, 'server', 'node_modules', '.bin')}:${t.env.PATH ?? ''}` };
    const r = spawnSync(BASH, [t.tool, '--repo', real, '--package', 'server', '--fixtures', '--rev', rev, '--', 'vitest', 'run'], { env, encoding: 'utf8', cwd: t.dir });
    expect(r.stdout + r.stderr).not.toContain('No test files found');
    for (const f of FX) expect(r.stdout, r.stdout + r.stderr).toContain(`fixture ${f}: byte-identical on both sides`);
  });

  it('a fixture whose side printed nothing is not an agreement', () => {
    const t = toolFixture({ FAKE_BOX_VERDICT: 'local' });
    const r = runTool(t, ['--recent', '1', '--fixtures']);
    expect(r.rc).toBe(1);
    expect(r.out).toContain('fixture git-state: DIFFERS (or a leg could not run)');
  });

  it('the record carries the result, the pull requests and revisions, the fixtures, the release, the tools key, the fingerprint, the box file sha256 and the time', () => {
    const t = toolFixture();
    const rec = join(t.dir, 'rec.json');
    const before = Date.now();
    const r = runTool(t, ['--recent', '5', '--fixtures', '--record', rec, ...META]);
    expect(r.rc, r.out + r.err).toBe(0);
    expect((statSync(rec).mode & 0o777).toString(8)).toBe('600');
    const read = readTestboxParityRecord(readFileSync(rec, 'utf8'));
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
const RULES: string[][] = [
  ['build\\.json', '0', '{"version":"v1.2.3"}'],
  ['current', '0', 'node-20.1.0+chrome-130.0'],
  ['CCRC_TESTBOX_REPOS', '0', EVIL_ROWS_OUT],
  [BOXENV.replace(/\./g, '\\.'), '0', ''],
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
    FAKE_SSH_KEYSCAN_RC: '1', TBA_GH: ghAuth, TBA_PARITY_TOOL: tool, SYSTEMD_RUN_RC: '0', TBA_CHECK_DEADLINE: '0', ...extra,
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

describe.skipIf(!HAS_ALL)('ccrc testbox-admin parity (D-8166, TC9)', () => {
  it('with no --pr the unit asks each installed row for the five most recent merged pull requests, with the checkout and command prefilled', () => {
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
      expect(flag(c, '--recent')).toEqual(['5']);
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
    expect(flag(calls[1]!, '--recent')).toEqual(['5']);
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
});
