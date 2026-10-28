// `ccrc doctor`, part: core (D-6767). The doctor suite was one 17,000-line file that held a worker for 661 s; its describe blocks moved
// here unchanged, and the fixtures they share are in `ccrc-doctorFixture.ts`.
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, existsSync, utimesSync, appendFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ghContainedEnv, ghPoisonAt, plantPoolEpoch, seedAccountsSh } from './ccdWsHelpers.js';
import { fixtureSecretLine } from './authFixtures.js';
import { writeShippedTimer } from './shippedTimers.js';
import { describeLinux, describeDarwin, itLinux, itDarwin } from './platformFixtures.js';
import { codexAuthDir } from './codexLaneFixture.js';
import { familyClassOf } from '../../shared/models.mjs';
import { installDoctorHooks, here, REPO, CCRC_SRC, CHECKS_SRC, LIB_SRC, BASH, realPath, writeAuthSecret, writePkg, writeRawPkg, stubBin, stub, unstubManager, unstub, linkReal, stubNode, entry, shq, ghStub, GH_OK, writeCcrcEnv, unitDirOf, unitFileOf, writeUnitFile, removeUnitFile, writeExposureEnv, containedPath, doctorEnv, sysCaddyfile, runDoctor, healthy, broken, tableNames, lineFor, anyVerdictFor, HEALTHY_SKIPS, expectUndecided, UnitEnvAnswer, remedyFor } from './ccrc-doctorFixture.js';

// Each case's homes go when the case ends, not in a file-wide end sweep (R100, review 518's S1): that sweep overran vitest's 20 s
// hook timeout on the one file this family was split from. Registered before `installDoctorHooks()`'s root `afterEach` (the codex
// lanes' process kill) because vitest runs after-hooks in reverse order of registration: that kill still sees its home.
removeTmpFixturesEachTest();
installDoctorHooks();

// ── transcripts: the operator's signal for a forked-session marker ────────
// Task 8 of the 2026-09-20-forked-session-transcript plan. Claude Code forks
// a live session into a background PTY under a new sessionId and writes a
// `continued-in` pointer as the last line of the transcript it abandons; a
// registry `ccd` has not yet followed still names that abandoned file, and
// the operator's chat freezes silently. This check counts how many registry
// sessions are in that state; it must read 0 on a converged box.
//
// `healthy()` owns no `$HOME/.cc-sessions` at all (no test in this file needs
// a registry), which is exactly the "nothing to measure" shape this check's
// vacuous PASS is for — and it never writes `~/.ccrc/accounts.sh` either, so
// a fixture that plants real sessions must seed both itself.
const TRANSCRIPT_ROSTER = { version: 1, accounts: [
  { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
] };

/** Compact JSON, exactly the shape `_dr_continued_in` and `_continued_in_of`
 *  both key on — `JSON.stringify` with no replacer/space produces no space
 *  after `:`, which is the literal both bash readers match. */
const continuedInLine = (from: string, to: string): string =>
  `${JSON.stringify({ type: 'continued-in', sessionId: from, continuedInSessionId: to })}\n`;
const turnLine = (text: string): string =>
  `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;

/** One registry row, in the three flat files `_check_transcripts` reads
 *  itself (`<id>.uuid`, `<id>.wrapper`, `<id>.workdir`) — no ccd invoked, this
 *  check is deliberately readable with nothing but `cat`. */
function writeTranscriptSession(home: string, id: string, wrapper: string, workdir: string, uuid: string): void {
  const reg = join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  writeFileSync(join(reg, `${id}.uuid`), `${uuid}\n`);
  writeFileSync(join(reg, `${id}.wrapper`), `${wrapper}\n`);
  writeFileSync(join(reg, `${id}.workdir`), `${workdir}\n`);
}

/** The transcript file itself, munged the same way `ccd/ccd`'s `_munge_wd`
 *  and `server/src/munge.ts`'s `mungePath` both do — `tr './_' '---'` over the
 *  workdir. `forRawSpelling` writes under the UNRESOLVED munge (what a
 *  symlinked workdir sometimes writes under on the real fleet box, per
 *  `ccd-sync-uuid.test.ts`'s "follows a chain whose CURRENT transcript sits
 *  only at the raw spelling"); the default writes under the plain munge,
 *  which is both spellings at once whenever `workdir` carries no symlink. */
function writeTranscript(
  home: string, cfgSuffix: string, workdir: string, uuid: string, body: string,
): string {
  const munged = workdir.replace(/[/._]/g, '-');
  const dir = join(home, cfgSuffix, 'projects', munged);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${uuid}.jsonl`);
  writeFileSync(f, body, 'utf8');
  return f;
}

/** `~/.ccrc/update-intent`, in `_upd_intent_state`'s own nine-line grammar
 *  (`updateIntentFixtures.ts`'s `readIntent` reads the same shape back;
 *  `update-intent-cross-side.test.ts` plants an identical document by hand
 *  for the same reason: a fixture writer belongs beside the check it feeds,
 *  not behind an import that would register a second file's tests here). */
function plantUpdateIntent(home: string, overrides: Partial<{
  epoch: number; issued: number; lease: number; channel: string;
  desired: string; desiredStable: string; desiredDev: string; auto: string;
}> = {}): void {
  const now = Math.floor(Date.now() / 1000);
  const o = {
    epoch: 1, issued: now, lease: now + 900, channel: 'stable',
    desired: 'v0.0.11', desiredStable: 'v0.0.11', desiredDev: 'v0.0.12', auto: 'off',
    ...overrides,
  };
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'update-intent'), [
    `epoch ${o.epoch}`, `issued ${o.issued}`, `lease ${o.lease}`, `channel ${o.channel}`,
    `desired ${o.desired}`, `desired-stable ${o.desiredStable}`, `desired-dev ${o.desiredDev}`,
    `auto ${o.auto}`, 'end', '',
  ].join('\n'), { mode: 0o600 });
}

/** One row of `_box_unit_env`'s answer, read back from a sourced `ccd/ccrc`: the rc and its four out-params. */
interface UnitEnvRow { label: string; env: string | null; exp: string | 'UNREADABLE' | null; key: string }

/** The UTF-8 locale this host's bash really runs under (D-3833's pins): the first candidate under which bash counts the
 *  two-byte `é` as ONE character. A locale that is not installed falls back to C silently, which would make a UTF-8
 *  row hollow — so the probe measures the effect, and a host with none THROWS (the case fails, never skips). Linux
 *  runners carry `C.UTF-8`; macOS ships `en_US.UTF-8`, tried second. */
function utf8Locale(): string {
  for (const loc of ['C.UTF-8', 'en_US.UTF-8']) {
    const r = spawnSync(BASH, ['-c', `x=$'\\xc3\\xa9'; printf '%s' "\${#x}"`], { encoding: 'utf8', env: { LC_ALL: loc } });
    if (r.status === 0 && r.stdout === '1') return loc;
  }
  throw new Error('no UTF-8 locale takes effect in bash on this host (C.UTF-8, en_US.UTF-8): the UTF-8 rows cannot run');
}

/** `_box_unit_env <key>` over each row's fixture files, with `CCD_OS` set AFTER sourcing (so the Darwin arm runs on
 *  every platform). One bash for all rows; every result goes through a file, so no `$(…)` eats a byte. The files are
 *  written byte for byte (latin1: every row below `\u0100`). `locale` replaces the harness's `LC_ALL=C` (D-3833), and
 *  the run first proves it took effect — bash counts `é` as one character — or exits 7, which fails the case. */
function unitEnvAnswers(rows: UnitEnvRow[], os: 'linux' | 'darwin', locale = 'C'): UnitEnvAnswer[] {
  const dir = mkTmp('ccrc-doctor-unitenv-');
  rows.forEach((row, i) => {
    const d = join(dir, `r${i}`);
    mkdirSync(d, { recursive: true });
    if (row.env !== null) writeFileSync(join(d, 'ccrc.env'), row.env, 'latin1');
    if (row.exp === 'UNREADABLE') mkdirSync(join(d, 'exposure.env'));
    else if (row.exp !== null) writeFileSync(join(d, 'exposure.env'), row.exp, 'latin1');
    writeFileSync(join(d, 'key'), row.key);
  });
  const proof = locale === 'C' ? [] : [
    `x=$'\\xc3\\xa9'; [ "\${#x}" -eq 1 ] || { echo "LC_ALL=${locale} did not take effect: \${#x} characters in a 2-byte é" >&2; exit 7; }`,
  ];
  const script = [
    'set -uo pipefail', ...proof, `. ${shq(CCRC_SRC)}`, `CCD_OS=${os}`,
    `for ((i=0;i<${rows.length};i++)); do d=${shq(dir)}/r$i`,
    '  BOX_ENV_FILE=$d/ccrc.env; CCRC_EXPOSURE_FILE=$d/exposure.env; read -r key < "$d/key"',
    '  _box_unit_env "$key"; rc=$?',
    '  printf "%s" "$rc" > "$d/rc"; printf "%s" "$BUE_VAL" > "$d/val"; printf "%s" "$BUE_SRC" > "$d/src"',
    '  printf "%s" "$BUE_WHY" > "$d/why"; printf "%s" "$BUE_FIX" > "$d/fix"',
    'done',
  ].join('\n');
  const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8', env: { HOME: dir, PATH: join(dir, 'no-bin'), LC_ALL: locale } });
  expect(r.status, r.stderr).toBe(0);
  return rows.map((_, i) => {
    const d = join(dir, `r${i}`);
    const g = (n: string): string => readFileSync(join(d, n), 'utf8');
    return { rc: Number(g('rc')), val: g('val'), src: g('src'), why: g('why'), fix: g('fix'),
      envPath: join(d, 'ccrc.env'), expPath: join(d, 'exposure.env') };
  });
}   // +1 server-caps (no role): its block at the end; +1 update-sweep (no update.json on a healthy box); +1 approval-verifier-runnable (no registry); +1 approval-key-colocated (no server key); +2 the backups checks of the other platform (A11b): Linux SKIPs filevault and secrets-backup-excluded, macOS snapshot-posture

// ── the table itself ──────────────────────────────────────────────────────

describe('ccrc doctor: the check list is data', () => {
  it('every name in the table has a _check_<name> function, and vice versa', () => {
    // The table and its implementations are two halves of one thing; this is
    // the mechanism that stops them drifting. Adding a check is one entry plus
    // one function plus one test — and forgetting either half is red here.
    const names = tableNames();
    expect(names.length).toBeGreaterThan(0);
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(CHECKS_SRC)}\n`
      + 'for n in "${CCRC_DOCTOR_CHECKS[@]}"; do declare -F "_check_$n" >/dev/null || echo "MISSING _check_$n"; done\n'
      + 'declare -F | sed -n "s/^declare -f _check_//p" | while read -r f; do\n'
      + '  case " ${CCRC_DOCTOR_CHECKS[*]} " in *" $f "*) ;; *) echo "ORPHAN _check_$f" ;; esac\n'
      + 'done'],
      { encoding: 'utf8', env: { ...process.env, PATH: process.env['PATH'] ?? '' } });
    expect(r.stdout.trim()).toBe('');
  });

  it('runs every check in the table and reports one verdict line each', () => {
    const home = healthy('ccrc-doctor-table-');
    const r = runDoctor(home);
    for (const n of tableNames()) {
      // SKIP counts here: the census is "did every check ANSWER", and a check
      // with nothing on this platform to measure answers by skipping.
      expect(anyVerdictFor(r.stdout, n), `no verdict line for check "${n}"\n${r.stdout}`).toBeTruthy();
    }
  });
});


// ── the node floor ────────────────────────────────────────────────────────

describe('ccrc doctor: node', () => {
  it('reads the node floor from package.json rather than carrying its own copy', () => {
    // The floor moves in ONE place. Mutate the shipped package.json's engines
    // pin in the fixture and the check must move with it.
    const home = healthy('ccrc-doctor-node-floor-');
    writePkg(home, '>=99.0.0');
    expect(runDoctor(home).stdout).toMatch(/FAIL node: .*99\.0\.0/);
  });

  it('refuses a range form it does not understand instead of guessing a floor', () => {
    const home = healthy('ccrc-doctor-node-range-');
    writePkg(home, '^22 || >=24');
    expect(runDoctor(home).stdout).toMatch(/FAIL node: unrecognised engines range/);
  });

  it('goes red when node itself is removed from the fixture', () => {
    const home = healthy('ccrc-doctor-node-missing-');
    unstub(home, 'node');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL node: not on PATH/m);
    expect(r.code).toBe(1);
  });

  it('reads the AGENT package.json on a fleet box, where that is the only one shipped', () => {
    // deploy.sh (the fleet rsync) rsyncs `agent shared deploy ccd` to the fleet host: there
    // is no server/ directory there at all. node-floor.test.ts (its server-dir assertion) asserts
    // all three declarations are byte-identical, which is why either answer is
    // the same answer — but only if doctor actually looks for both.
    const home = healthy('ccrc-doctor-node-agent-pkg-');
    rmSync(join(home, 'ccrc', 'server'), { recursive: true, force: true });
    writePkg(home, '>=99.0.0', 'agent');
    expect(runDoctor(home).stdout).toMatch(/FAIL node: .*99\.0\.0/);
  });

  it('says so plainly when no shipped package.json can be found at all', () => {
    const home = healthy('ccrc-doctor-node-no-pkg-');
    rmSync(join(home, 'ccrc', 'server'), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL node: no shipped package\.json/m);
    expect(r.stdout).toMatch(/agent\/package\.json/);
  });

  it('a package.json that does not parse is its own answer, not "unrecognised range"', () => {
    const home = healthy('ccrc-doctor-node-bad-json-');
    writeRawPkg(home, 'not json at all');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL node: .*does not parse/m);
    expect(r.stdout).not.toMatch(/unrecognised engines range/);
  });

  it.skipIf(process.getuid?.() === 0)(
    'a package.json it cannot READ is its own answer, not "does not parse"', () => {
      // Two conditions an operator acts on completely differently — a mode fix
      // vs. a redeploy — must not share one signal. Before this split, `chmod
      // 000` produced "does not parse as JSON" and a remedy telling the
      // operator to redeploy a file that was never corrupt. Skipped as root,
      // where 000 is not a permission at all.
      const home = healthy('ccrc-doctor-node-unreadable-');
      chmodSync(join(home, 'ccrc', 'server', 'package.json'), 0o000);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^FAIL node: .*cannot be read \(EACCES\)/m);
      expect(r.stdout).not.toMatch(/does not parse/);
      expect(r.stdout).toMatch(/^ {2}remedy: .*ls -l/m);
    });

  it('accepts a floor with surrounding whitespace, exactly as node-floor.test.ts does', () => {
    // node-floor.test.ts (its range match) matches against `range.trim()`, so " >=1.0.0 "
    // leaves all three declarations identical and that suite green. A doctor
    // stricter than the rule it copies would fail a box whose manifests are
    // fine — the check must be as strict as node-floor, not stricter.
    const home = healthy('ccrc-doctor-node-ws-floor-');
    writePkg(home, ' >=1.0.0 ');
    const line = lineFor(runDoctor(home).stdout, 'node');
    expect(line).toMatch(/^PASS node: v22\.20\.0 satisfies >=1\.0\.0 /);
  });

  it('a package.json with no engines.node is its own answer too', () => {
    const home = healthy('ccrc-doctor-node-no-engines-');
    writePkg(home, null);
    expect(runDoctor(home).stdout).toMatch(/^FAIL node: .*declares no engines\.node/m);
  });

  it('passes when the interpreter clears the declared floor, and names both', () => {
    const home = healthy('ccrc-doctor-node-ok-');
    const line = lineFor(runDoctor(home).stdout, 'node');
    expect(line).toMatch(/^PASS node: v22\.20\.0 /);
    expect(line).toMatch(/>=1\.0\.0/);
  });
});


// ── the binaries ──────────────────────────────────────────────────────────

describe('ccrc doctor: the binaries a fleet box needs', () => {
  // One test per check, each removing that check's SUBJECT from the fixture.
  it.each(['tmux', 'git', 'jq', 'python3', 'flock'])(
    '%s goes red when it is removed from the fixture PATH', (bin) => {
      const home = healthy(`ccrc-doctor-bin-${bin}-`);
      unstub(home, bin);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(new RegExp(`^FAIL ${bin}: not on PATH`, 'm'));
      expect(r.code).toBe(1);
    });

  it('gh goes red when it is removed from the fixture PATH', () => {
    // `gh` lives in ghContainedEnv's own directory, not stub-bin, so its
    // removal is that file's removal. Nothing else on this PATH is a system
    // directory, so the real gh is still unreachable with it gone.
    const home = healthy('ccrc-doctor-bin-gh-');
    rmSync(join(home, '.local', 'bin', 'gh'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL gh: not on PATH/m);
    expect(r.code).toBe(1);
  });

  it('names the binary it found when it is there', () => {
    const home = healthy('ccrc-doctor-bin-ok-');
    expect(lineFor(runDoctor(home).stdout, 'tmux')).toContain(join(home, 'stub-bin', 'tmux'));
  });
});


// ── jq_regex: the regex engine the session hook's merge deny runs on ──────

describe('ccrc doctor: jq_regex — a jq without lookaround fails the merge deny open, and says so', () => {
  /** A jq that answers the lookbehind probe as `answer` says and runs the real
   *  jq for everything else, so every other check that reads JSON is
   *  untouched. `rmSync` first: `healthy()` links the REAL jq here, and a write
   *  through that symlink would land on the box's own binary. */
  const lookbehindJq = (home: string, answer: string): void => {
    unstub(home, 'jq');
    stub(home, 'jq', `case "$*" in *'(?<!b)a'*) ${answer} ;; esac\nexec ${shq(realPath('jq'))} "$@"`);
  };

  it('passes on a jq that matches a lookbehind, naming the binary', () => {
    const home = healthy('ccrc-doctor-jqre-ok-');
    const line = lineFor(runDoctor(home).stdout, 'jq_regex');
    expect(line).toMatch(/^PASS jq_regex: /);
    expect(line, 'the PASS line does not name the jq it measured').toContain(`${join(home, 'stub-bin', 'jq')} matches a lookbehind`);
  });

  it('FAILs, with a remedy, on a jq built without Oniguruma — the deny would read no command', () => {
    const home = healthy('ccrc-doctor-jqre-noonig-');
    // jq 1.7 built without Oniguruma answers every regex builtin with this
    // error and exit 5 (its src/builtin.c, the `#else` arm of f_match).
    lookbehindJq(home, "echo 'jq: error (at <unknown>): jq was compiled without ONIGURUMA regex library. match/test/sub and related functions are not available.' >&2; exit 5");
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL jq_regex: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('FAILS OPEN');
    expect(lines[i]).toContain('rc 5');
    expect(lines[i]).toContain('compiled without ONIGURUMA');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: install a jq built with Oniguruma/);
    expect(r.code).toBe(1);
    // The presence check still passes: jq is there, its regex is not.
    expect(lineFor(r.stdout, 'jq')).toMatch(/^PASS jq: /);
  });

  it('FAILs when the probe answers anything but true — a lookbehind that does not match', () => {
    const home = healthy('ccrc-doctor-jqre-false-');
    lookbehindJq(home, 'echo false; exit 0');
    expect(lineFor(runDoctor(home).stdout, 'jq_regex')).toMatch(/^FAIL jq_regex: .*answered 'false', rc 0/);
  });

  it('skips on a server-role box — no session hook runs there', () => {
    const home = healthy('ccrc-doctor-jqre-server-');
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    lookbehindJq(home, 'exit 5');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP jq_regex: this box records CCRC_ROLE=server/m);
    expect(lineFor(r.stdout, 'jq_regex')).toBeUndefined();
  });

  it('skips with no jq on PATH — presence is the jq check\'s FAIL, not this one\'s', () => {
    const home = healthy('ccrc-doctor-jqre-nojq-');
    unstub(home, 'jq');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP jq_regex: jq is not on PATH/m);
    expect(r.stdout).toMatch(/^FAIL jq: not on PATH/m);
  });
});


// ── timeout: the bound the session hook and the status line put on tmux ──
// `ccd/session-hook.sh` and `ccd/statusline-command.sh` ask tmux one question
// each, bounded by `timeout` or `gtimeout`, and with neither on PATH they SKIP
// it rather than ask unbounded — so the hook exits before every arm (no
// hookstate, no turn marker, no merge or search deny) and the status line
// writes no usage sidecar, silently. macOS ships no `timeout` at all.
// Each case removes the subject from the contained PATH: `healthy()` links
// exactly one of the two names (the one the host has), and nothing else on
// that PATH is a system directory.

describe('ccrc doctor: timeout', () => {
  const unstubDeadlines = (home: string): void => {
    for (const b of ['timeout', 'gtimeout']) unstub(home, b);
  };

  it('FAILs when neither timeout nor gtimeout is on PATH, naming what goes silent and the coreutils remedy', () => {
    const home = healthy('ccrc-doctor-timeout-none-');
    unstubDeadlines(home);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL timeout: neither timeout nor gtimeout is on PATH — .*session hook.*status line/m);
    expect(r.stdout).toMatch(/^FAIL timeout: .*the hook then does nothing at all .*worker-merge deny/m);
    // Each platform gets its own package manager's line — `CCD_OS` comes from
    // `$OSTYPE`, so each leg pins its own arm and swapping them reds both.
    expect(r.stdout).toMatch(process.platform === 'darwin'
      ? /^FAIL timeout: .*\n {2}remedy: install GNU coreutils: brew install coreutils \(it installs timeout as gtimeout\)$/m
      : /^FAIL timeout: .*\n {2}remedy: install GNU coreutils: sudo apt install coreutils$/m);
    expect(r.code).toBe(1);
  });

  it('with both on PATH, names `timeout` — the session hook and the status line try it first', () => {
    const home = healthy('ccrc-doctor-timeout-both-');
    unstubDeadlines(home);
    const real = realPath(process.platform === 'darwin' ? 'gtimeout' : 'timeout');
    for (const name of ['timeout', 'gtimeout']) symlinkSync(real, join(stubBin(home), name));
    expect(lineFor(runDoctor(home).stdout, 'timeout'))
      .toBe(`PASS timeout: timeout at ${join(home, 'stub-bin', 'timeout')}`);
  });

  it('PASSes on bare `timeout`, naming where it is', () => {
    const home = healthy('ccrc-doctor-timeout-gnu-');
    unstubDeadlines(home);
    symlinkSync(realPath(process.platform === 'darwin' ? 'gtimeout' : 'timeout'), join(stubBin(home), 'timeout'));
    expect(lineFor(runDoctor(home).stdout, 'timeout'))
      .toBe(`PASS timeout: timeout at ${join(home, 'stub-bin', 'timeout')}`);
  });

  it('PASSes on `gtimeout` alone — Homebrew coreutils on macOS — and says which name it found', () => {
    const home = healthy('ccrc-doctor-timeout-g-');
    unstubDeadlines(home);
    symlinkSync(realPath(process.platform === 'darwin' ? 'gtimeout' : 'timeout'), join(stubBin(home), 'gtimeout'));
    expect(lineFor(runDoctor(home).stdout, 'timeout'))
      .toBe(`PASS timeout: gtimeout at ${join(home, 'stub-bin', 'gtimeout')}`);
  });

  it('SKIPs on a server-role box — no session hook or status line runs there', () => {
    const home = healthy('ccrc-doctor-timeout-server-');
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    unstubDeadlines(home);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP timeout: this box records CCRC_ROLE=server, so it hosts no sessions/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) timeout:/m);
  });
});


describe('ccrc doctor: model-default', () => {
  // Two Anthropic lanes and one codex lane: the codex lane's `fable` alias
  // names a GPT model (ANTHROPIC_DEFAULT_FABLE_MODEL), so it is not the subject.
  const MD_ROSTER = { version: 1, accounts: [
    { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'claude-a', label: 'claude-a', configDirSuffix: '.claude-a',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/claude-a-oauth.env' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    { id: 'cx', label: 'cx', configDirSuffix: '.claude-cx',
      exec: { kind: 'codex', provider: 'openai', proxyPort: 41001, litellmPort: 41002, authDir: codexAuthDir('cx') },
      homeAble: false, telemetry: 'codex' },
  ] };
  /** A home with the projection and a real `node` (behind the `--version`
   *  stub every doctor fixture uses) on an otherwise-empty contained PATH. */
  const mdHome = (prefix: string): string => {
    const home = mkTmp(prefix);
    stubNode(home, 'v22.20.0');
    seedAccountsSh(home, MD_ROSTER);
    return home;
  };
  const settings = (home: string, suffix: string, body: unknown): string => {
    const d = join(home, suffix);
    mkdirSync(d, { recursive: true });
    const p = join(d, 'settings.json');
    writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    return p;
  };
  /** `_check_model-default` alone, sourced the way the launchd routing case
   *  sources `_check_routing`. */
  const runCheck = (home: string): { code: number; out: string } => {
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; _check_model-default`],
      { encoding: 'utf8', env: { HOME: home, PATH: containedPath(home), LC_ALL: 'C' } });
    return { code: r.status ?? -1, out: r.stdout ?? '' };
  };
  const verdicts = (out: string): string[] => out.split('\n').filter((l) => /^(PASS|WARN|FAIL|SKIP) model-default: /.test(l));
  const FABLE_LEAD = /^WARN model-default: an Anthropic lane's settings\.json defaults the model to Fable: /;

  it('WARNs on `model: "fable"` through `ccrc doctor` itself, naming the lane, the consequence and the remedy — never a FAIL', () => {
    const home = healthy('ccrc-doctor-mdef-alias-');
    seedAccountsSh(home, MD_ROSTER);
    settings(home, '.claude-a', { model: 'fable' });
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'model-default');
    expect(line, r.stdout).toMatch(FABLE_LEAD);
    expect(line).toContain('Fable: claude-a (model=fable) — ');
    expect(line).toContain('a session there with no routing record, or class `default`, starts on Fable (a dispatched worker whose run names no class included)');
    expect(r.stdout).toMatch(/^WARN model-default: .*\n {2}remedy: in that lane's settings\.json set `model` to Opus or remove it .*a `\/model` typed with a name saves the account default, while `s` in the \/model picker is session-only$/m);
    expect(r.stdout).not.toMatch(/^FAIL model-default:/m);
  });

  it('WARNs on `fable[1m]` and on a full Fable id — the alias with its suffix, and the dash-token rule', () => {
    const home = mdHome('ccrc-doctor-mdef-ids-');
    settings(home, '.claude', { model: 'fable[1m]' });
    settings(home, '.claude-a', { model: 'claude-fable-5-1' });
    const r = runCheck(home);
    expect(r.code).toBe(2);
    expect(verdicts(r.out)).toHaveLength(1);
    expect(verdicts(r.out)[0]).toMatch(FABLE_LEAD);
    expect(verdicts(r.out)[0]).toContain('Fable: claude (model=fable[1m]), claude-a (model=claude-fable-5-1) — ');
  });

  it('WARNs on env.ANTHROPIC_MODEL naming Fable — it outranks `model` — and PASSes when it outranks a Fable `model`', () => {
    const home = mdHome('ccrc-doctor-mdef-env-');
    settings(home, '.claude-a', { model: 'opus', env: { ANTHROPIC_MODEL: 'claude-fable-5-1' } });
    const r = runCheck(home);
    expect(verdicts(r.out)).toEqual([expect.stringMatching(FABLE_LEAD)]);
    expect(r.out).toContain('Fable: claude-a (env.ANTHROPIC_MODEL=claude-fable-5-1) — ');
    // The precedence the other way round: the env key decides, so the stale
    // `model` underneath it starts nothing.
    const back = mdHome('ccrc-doctor-mdef-env-back-');
    settings(back, '.claude-a', { model: 'fable', env: { ANTHROPIC_MODEL: 'opus' } });
    expect(verdicts(runCheck(back).out)).toEqual(['PASS model-default: 2 Anthropic lane(s): no settings.json defaults the model to Fable']);
    // An EMPTY env value is no value — the `model` beneath it is what runs.
    const empty = mdHome('ccrc-doctor-mdef-env-empty-');
    settings(empty, '.claude-a', { model: 'fable', env: { ANTHROPIC_MODEL: '' } });
    expect(runCheck(empty).out).toContain('Fable: claude-a (model=fable) — ');
  });

  it('PASSes on `opus`, on an absent key and on an absent file, naming how many lanes it measured', () => {
    const home = mdHome('ccrc-doctor-mdef-pass-');
    settings(home, '.claude', { model: 'opus' });
    settings(home, '.claude-a', { env: { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' } });
    const r = runCheck(home);
    expect(r.code).toBe(0);
    expect(verdicts(r.out)).toEqual(['PASS model-default: 2 Anthropic lane(s): no settings.json defaults the model to Fable']);
    const bare = mdHome('ccrc-doctor-mdef-nofile-');
    expect(verdicts(runCheck(bare).out)).toEqual(['PASS model-default: 2 Anthropic lane(s): no settings.json defaults the model to Fable']);
  });

  it('ignores a codex lane whose `model` is `fable` — the alias names a GPT slot there', () => {
    const home = mdHome('ccrc-doctor-mdef-codex-');
    settings(home, '.claude-cx', { model: 'fable' });
    expect(verdicts(runCheck(home).out)).toEqual(['PASS model-default: 2 Anthropic lane(s): no settings.json defaults the model to Fable']);
  });

  it('agrees with familyClassOf id for id: a Fable verdict exactly when the alias is `fable` or the family is fable', () => {
    const corpus = ['fable', 'fable[1m]', 'FABLE', 'Fable[1m]', 'fable-ish', 'xfable', 'claude-fable-5-1', 'claude-fable-5-1[1m]',
      'claude-fable-opus-hybrid-1', 'claude-opus-fable-x-1', 'claude-opus-5-5', 'claude-sonnet-5', 'opus', 'opus[1m]',
      'default', 'claude-fable', 'CLAUDE-FABLE-5-1', 'anthropic/claude-fable-5-1', 'us.anthropic.claude-fable-5-1-v1:0', ''];
    const home = mdHome('ccrc-doctor-mdef-agree-');
    const dir = join(home, 'corpus');
    mkdirSync(dir);
    corpus.forEach((id, i) => writeFileSync(join(dir, `${i}.json`), JSON.stringify({ model: id })));
    const r = spawnSync(BASH, ['-c', [
      `set -uo pipefail; . ${shq(CHECKS_SRC)}; mkdir -p "$HOME/.claude-a"`,
      `for i in $(seq 0 ${corpus.length - 1}); do cp "$HOME/corpus/$i.json" "$HOME/.claude-a/settings.json"; _check_model-default >/dev/null; echo "$?"; done`,
    ].join('\n')], { encoding: 'utf8', env: { HOME: home, PATH: `${containedPath(home)}:/usr/bin:/bin`, LC_ALL: 'C' } });
    const got = (r.stdout ?? '').trim().split('\n');
    expect(got, r.stderr).toHaveLength(corpus.length);
    corpus.forEach((id, i) => {
      const fable = id.replace(/\[1m\]$/, '').toLowerCase() === 'fable' || familyClassOf(id) === 'fable';
      expect(got[i], JSON.stringify(id)).toBe(fable ? '2' : '0');
    });
  });

  it('SKIPs on a server-role box — it hosts no sessions', () => {
    const home = healthy('ccrc-doctor-mdef-server-');
    seedAccountsSh(home, MD_ROSTER);
    settings(home, '.claude-a', { model: 'fable' });
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP model-default: this box records CCRC_ROLE=server, so it hosts no sessions/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) model-default:/m);
  });

  it.skipIf(process.getuid?.() === 0)('WARNs UNMEASURED — never PASSes — on a settings.json it cannot read, naming the errno', () => {
    const home = mdHome('ccrc-doctor-mdef-unread-');
    const p = settings(home, '.claude-a', { model: 'opus' });
    chmodSync(p, 0o000);
    try {
      const r = runCheck(home);
      expect(r.code).toBe(2);
      expect(verdicts(r.out)).toEqual([
        'WARN model-default: unmeasured: settings.json is present but could not be read for: claude-a (EACCES), so whether it defaults the model to Fable is unknown',
      ]);
      expect(r.out).toContain('or its mode/ownership (chmod u+r <home>/settings.json)');
    } finally {
      chmodSync(p, 0o600);
    }
  });

  it('WARNs UNMEASURED on invalid JSON and on JSON that is not an object — its own line, not the unreadable one', () => {
    const home = mdHome('ccrc-doctor-mdef-badjson-');
    settings(home, '.claude', '{"model": "fable",');
    settings(home, '.claude-a', '["fable"]');
    const r = runCheck(home);
    expect(r.code).toBe(2);
    expect(verdicts(r.out)).toEqual([
      'WARN model-default: unmeasured: settings.json is not a JSON object for: claude, claude-a, so whether it defaults the model to Fable is unknown',
    ]);
    expect(r.out).toContain('remedy: repair that lane\'s settings.json so it parses as a JSON object');
  });

  it('WARNs UNMEASURED when the reader exits with a code it does not define — never PASSes on it', () => {
    const home = mdHome('ccrc-doctor-mdef-weird-');
    settings(home, '.claude-a', { model: 'fable' });
    stub(home, 'node',
      `if [ "$1" = "--version" ]; then echo 'v22.20.0'; exit 0; fi\n`
      + 'case "$*" in *CCRC_DOCTOR_SETTINGS*) exit 9 ;; esac\n'
      + `exec '${process.execPath}' "$@"`);
    const r = runCheck(home);
    expect(verdicts(r.out)).toEqual([expect.stringMatching(/^WARN model-default: unmeasured: the settings reader \(node\) failed for: claude-a \(exit 9\)/)]);
  });

  it('a Fable lane and an unmeasured lane each get their own WARN, and no PASS', () => {
    const home = mdHome('ccrc-doctor-mdef-mixed-');
    settings(home, '.claude', { model: 'fable' });
    settings(home, '.claude-a', 'not json');
    const v = verdicts(runCheck(home).out);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatch(FABLE_LEAD);
    expect(v[1]).toMatch(/^WARN model-default: unmeasured: settings\.json is not a JSON object for: claude-a,/);
  });

  it('WARNs when the projection predates CCRC_ANTHROPIC_BACKEND, and PASSes vacuously with no projection at all', () => {
    const home = mdHome('ccrc-doctor-mdef-stale-sh-');
    writeFileSync(join(home, '.ccrc', 'accounts.sh'), 'CCRC_ACCOUNTS=(claude)\n');
    expect(verdicts(runCheck(home).out)).toEqual([expect.stringMatching(/^WARN model-default: could not read the roster projection .*predates CCRC_ANTHROPIC_BACKEND/)]);
    rmSync(join(home, '.ccrc', 'accounts.sh'));
    expect(verdicts(runCheck(home).out)).toEqual([expect.stringMatching(/^PASS model-default: 0 Anthropic lane\(s\): no roster projection/)]);
  });

  // ── review fixes (lane A) ──
  /** One exit code per `model` value, through the one function — the
   *  agreement case's loop. */
  const exitsFor = (prefix: string, bodies: unknown[]): string[] => {
    const home = mdHome(prefix);
    const dir = join(home, 'corpus');
    mkdirSync(dir);
    bodies.forEach((b, i) => writeFileSync(join(dir, `${i}.json`), JSON.stringify(b)));
    const r = spawnSync(BASH, ['-c', [
      `set -uo pipefail; . ${shq(CHECKS_SRC)}; mkdir -p "$HOME/.claude-a"`,
      `for i in $(seq 0 ${bodies.length - 1}); do cp "$HOME/corpus/$i.json" "$HOME/.claude-a/settings.json"; _check_model-default >/dev/null; echo "$?"; done`,
    ].join('\n')], { encoding: 'utf8', env: { HOME: home, PATH: `${containedPath(home)}:/usr/bin:/bin`, LC_ALL: 'C' } });
    const got = (r.stdout ?? '').trim().split('\n');
    expect(got, r.stderr).toHaveLength(bodies.length);
    return got;
  };

  it('normalises the value as Claude Code\'s own resolver does — trimmed, case-folded, `[1m]` stripped in any case — and counts `best`', () => {
    // The expectations are Claude Code 2.1.291's `xt`: `e.trim()`, then
    // `toLowerCase()`, then `[1m]` stripped by `/(\[1m\])+$/i` and re-trimmed,
    // then the alias switch, whose `best` arm resolves to the Fable default on
    // an entitled lane. A full id is NOT case-folded there (`-fable-` stays
    // case-sensitive, as `familyClassOf` is).
    const table: Array<[string, '2' | '0']> = [
      ['best', '2'], ['Best', '2'], [' best ', '2'], ['best[1m]', '2'],
      [' fable', '2'], ['fable ', '2'], ['FABLE[1M]', '2'], ['fable[1M]', '2'], ['fable [1m]', '2'],
      ['opus', '0'], [' opus ', '0'], ['OPUS[1M]', '0'], ['bestx', '0'], ['best-of', '0'], ['fable[2m]', '0'],
      ['CLAUDE-FABLE-5-1', '0'],
    ];
    const got = exitsFor('ccrc-doctor-mdef-resolver-', table.map(([m]) => ({ model: m })));
    table.forEach(([m, want], i) => expect(got[i], JSON.stringify(m)).toBe(want));
    // `best` is Fable only where the account is entitled to it — said so.
    const home = mdHome('ccrc-doctor-mdef-best-');
    settings(home, '.claude-a', { model: 'best' });
    expect(runCheck(home).out).toContain('Fable: claude-a (model=best, which resolves to Fable when the account is entitled to it) — ');
  });

  it('reads env.ANTHROPIC_DEFAULT_MODEL as the lowest rung — only when neither env.ANTHROPIC_MODEL nor `model` names a model', () => {
    const got = exitsFor('ccrc-doctor-mdef-defrung-', [
      { env: { ANTHROPIC_DEFAULT_MODEL: 'fable' } },
      { model: '', env: { ANTHROPIC_DEFAULT_MODEL: 'claude-fable-5-1' } },
      { model: 'opus', env: { ANTHROPIC_DEFAULT_MODEL: 'fable' } },
      { env: { ANTHROPIC_MODEL: 'opus', ANTHROPIC_DEFAULT_MODEL: 'fable' } },
      { env: { ANTHROPIC_DEFAULT_MODEL: 'opus' } },
    ]);
    expect(got).toEqual(['2', '2', '0', '0', '0']);
    const home = mdHome('ccrc-doctor-mdef-defrung-line-');
    settings(home, '.claude-a', { env: { ANTHROPIC_DEFAULT_MODEL: 'fable' } });
    expect(runCheck(home).out).toContain('Fable: claude-a (env.ANTHROPIC_DEFAULT_MODEL=fable) — ');
  });

  it('follows an alias through the lane\'s own ANTHROPIC_DEFAULT_<ALIAS>_MODEL remap to a Fable id', () => {
    const got = exitsFor('ccrc-doctor-mdef-remap-', [
      { model: 'opus', env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-fable-5-1' } },
      { model: 'Sonnet[1m]', env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-fable-5-1' } },
      { env: { ANTHROPIC_DEFAULT_MODEL: 'opus', ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-fable-5-1' } },
      { model: 'opus', env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5' } },
      { model: 'opus', env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-fable-5-1' } },
    ]);
    expect(got).toEqual(['2', '2', '2', '0', '0']);
    const home = mdHome('ccrc-doctor-mdef-remap-line-');
    settings(home, '.claude-a', { model: 'opus', env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-fable-5-1' } });
    expect(runCheck(home).out).toContain('Fable: claude-a (model=opus, via env.ANTHROPIC_DEFAULT_OPUS_MODEL=claude-fable-5-1) — ');
  });

  it('masks a Fable-class value that is not a plain id — no raw settings.json bytes reach the terminal', () => {
    const home = mdHome('ccrc-doctor-mdef-mask-');
    settings(home, '.claude', { model: 'claude-fable-5-1\u001b[31mRED' });
    settings(home, '.claude-a', { model: 'us.anthropic.claude-fable-5-1-v1:0' });
    const r = runCheck(home);
    expect(r.out).toContain('Fable: claude (model=<a Fable-class id>), claude-a (model=<a Fable-class id>) — ');
    expect(r.out).not.toContain('\u001b');
  });

  it('a dangling settings.json symlink and a directory in its place are "present but could not be read", with a remedy that fits them', () => {
    const home = mdHome('ccrc-doctor-mdef-dangle-');
    mkdirSync(join(home, '.claude-a'), { recursive: true });
    symlinkSync(join(home, 'nowhere.json'), join(home, '.claude-a', 'settings.json'));
    mkdirSync(join(home, '.claude', 'settings.json'), { recursive: true });
    const r = runCheck(home);
    expect(r.code).toBe(2);
    expect(verdicts(r.out)).toEqual([
      'WARN model-default: unmeasured: settings.json is present but could not be read for: claude (EISDIR), claude-a (ENOENT, a symlink whose target is missing), so whether it defaults the model to Fable is unknown',
    ]);
    expect(r.out).toContain('remedy: fix or remove it — a symlink whose target is missing, a directory in its place, or its mode/ownership (chmod u+r <home>/settings.json)');
    expect(r.out).not.toContain('exists but could not be read');
  });

  it('a reader (node) that fails is its own WARN, pointing at node — not an unreadable file with a chmod remedy', () => {
    const home = mdHome('ccrc-doctor-mdef-nodefail-');
    settings(home, '.claude-a', { model: 'opus' });
    stub(home, 'node',
      `if [ "$1" = "--version" ]; then echo 'v22.20.0'; exit 0; fi\n`
      + 'case "$*" in *CCRC_DOCTOR_SETTINGS*) echo boom >&2; exit 1 ;; esac\n'
      + `exec '${process.execPath}' "$@"`);
    const r = runCheck(home);
    expect(r.code).toBe(2);
    expect(verdicts(r.out)).toEqual([
      'WARN model-default: unmeasured: the settings reader (node) failed for: claude-a (exit 1), so whether its settings.json defaults the model to Fable is unknown',
    ]);
    expect(r.out).toContain('remedy: check that node runs (node -e 0) — see the \'node\' check above — then re-run ccrc doctor');
    expect(r.out).not.toContain('chmod');
  });

  it('a lane the projection gives no config dir is UNMEASURED, never counted as measured', () => {
    const home = mdHome('ccrc-doctor-mdef-nodir-');
    appendFileSync(join(home, '.ccrc', 'accounts.sh'), 'CCRC_ANTHROPIC_BACKEND+=(ghost)\n');
    const r = runCheck(home);
    expect(r.code).toBe(2);
    expect(verdicts(r.out)).toEqual([
      'WARN model-default: unmeasured: the roster projection names no config dir for: ghost, so whether its settings.json defaults the model to Fable is unknown',
    ]);
  });

  it('a projection that prints, or exits part-way, never leaks onto doctor output nor yields a lane or a PASS', () => {
    const home = mdHome('ccrc-doctor-mdef-leak-');
    const sh = join(home, '.ccrc', 'accounts.sh');
    writeFileSync(sh, `echo SIDE-EFFECT-PRINTED\n${readFileSync(sh, 'utf8')}`);
    const printed = runCheck(home);
    expect(printed.out).not.toContain('SIDE-EFFECT-PRINTED');
    expect(verdicts(printed.out)).toEqual(['PASS model-default: 2 Anthropic lane(s): no settings.json defaults the model to Fable']);
    const cut = mdHome('ccrc-doctor-mdef-cut-');
    const csh = join(cut, '.ccrc', 'accounts.sh');
    writeFileSync(csh, `echo SIDE-EFFECT-PRINTED; exit 0\n${readFileSync(csh, 'utf8')}`);
    const r = runCheck(cut);
    expect(r.out).not.toContain('SIDE-EFFECT-PRINTED');
    expect(verdicts(r.out)).toEqual([expect.stringMatching(/^WARN model-default: could not read the roster projection /)]);
  });

  it.skipIf(process.getuid?.() === 0)('WARNs UNMEASURED — never the vacuous PASS — on a projection that exists but cannot be read', () => {
    const home = mdHome('ccrc-doctor-mdef-unread-sh-');
    settings(home, '.claude-a', { model: 'fable' });
    const sh = join(home, '.ccrc', 'accounts.sh');
    chmodSync(sh, 0o000);
    try {
      const r = runCheck(home);
      expect(r.code).toBe(2);
      expect(verdicts(r.out)).toEqual([expect.stringMatching(/^WARN model-default: could not read the roster projection at \$HOME\/\.ccrc\/accounts\.sh/)]);
    } finally {
      chmodSync(sh, 0o600);
    }
  });
});


// ── tmux client/server skew ───────────────────────────────────────────────
// The loaded gun (substrate-unreachable spec §5): `tmux -V` is the CLIENT on
// disk, `display-message -p '#{version}'` is the RUNNING SERVER's own answer,
// and disagreement means an upgrade landed under a live server — the next new
// client is refused ("protocol version mismatch") and the console loses every
// session at once.

describe('ccrc doctor: tmux_skew', () => {
  it('passes when the client and the running server agree, naming both versions', () => {
    // Both versions, not the bare word "ok" — a PASS names its measurement.
    const home = healthy('ccrc-doctor-skew-ok-');
    const line = lineFor(runDoctor(home).stdout, 'tmux_skew');
    expect(line).toMatch(/^PASS tmux_skew: /);
    expect(line).toMatch(/client 3\.4.*server.*3\.4/);
  });

  it('warns when an upgrade landed under the running server, naming both versions', () => {
    const home = healthy('ccrc-doctor-skew-warn-');
    writeFileSync(join(home, 'fixture-tmux-server'), '3.3a\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN tmux_skew: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('3.4');    // the client on disk
    expect(lines[i]).toContain('3.3a');   // the server that predates it
    expect(lines[i + 1]).toMatch(
      /^ {2}remedy: a tmux upgrade landed under the running server — restart the tmux server at the next quiet moment or the next new client will be refused$/);
    // The gun is loaded, not fired: every session still runs, so the box's
    // exit code stays 0 — a WARN is a thing to schedule, not a broken box.
    expect(r.code).toBe(0);
  });

  it('SKIPS when no server is running — nothing to skew against', () => {
    // Not a PASS: "no skew" was never measured, there was no pair to compare.
    // And not a WARN: a box between servers is not a box with a problem.
    const home = healthy('ccrc-doctor-skew-noserver-');
    rmSync(join(home, 'fixture-tmux-server'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP tmux_skew: no tmux server is running/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) tmux_skew: /m);
    expect(r.stdout).toMatch(
      new RegExp(`^summary: \\d+ checks \\(${1 + HEALTHY_SKIPS} skipped\\)`, 'm'));
    expect(r.code).toBe(0);
  });

  it("SKIPS when tmux itself is absent — its absence is the tmux check's FAIL, not a skew", () => {
    const home = healthy('ccrc-doctor-skew-notmux-');
    unstub(home, 'tmux');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL tmux: not on PATH/m);   // the presence check owns the finding
    expect(r.stdout).toMatch(/^SKIP tmux_skew: /m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) tmux_skew: /m);
  });

  it('SKIPS when a server holds the socket but does not answer — a wedge is NOT "no server"', () => {
    // The rc-124 arm. Delete it and the timed-out probe falls one branch down
    // into the "no server is running" sentence — a server that holds the
    // socket without answering and a socket nobody holds collapsed into one
    // reading, the overloaded seam the check's own comment bans by name. The
    // stub hangs (sleep 60) and is killed by the check's OWN deadline at
    // CCRC_DOCTOR_GH_TIMEOUT=1 — the test is bounded by the very mechanism
    // under test, and by nothing else, which is the point.
    const home = healthy('ccrc-doctor-skew-wedge-');
    linkReal(home, 'sleep');
    stub(home, 'tmux', [
      'if [ "$1" = "-V" ]; then echo "tmux 3.4"; exit 0; fi',
      'if [ "$1" = "display-message" ]; then sleep 60; exit 0; fi',
      'echo "fixture tmux: unexpected argv: $*" >&2; exit 90',
    ].join('\n'));
    const r = runDoctor(home, ['doctor'], { CCRC_DOCTOR_GH_TIMEOUT: '1' });
    expect(r.stdout).toMatch(
      /^SKIP tmux_skew: a tmux server holds the socket but did not answer within 1s/m);
    expect(r.stdout).not.toMatch(/no tmux server is running/);   // the collapse, banned
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) tmux_skew: /m);
  });

  it("SKIPS when 'tmux -V' names no client version — nothing to compare a server against", () => {
    // The empty-client arm: a tmux that answers `-V` with nothing (a broken
    // or truncated binary) has named no client, so there is no pair. Without
    // this arm the check would compare a running server against `""` and WARN
    // on every such box — a finding about the comparison, not the substrate.
    const home = healthy('ccrc-doctor-skew-noclient-');
    stub(home, 'tmux', 'exit 0');   // present (the tmux check still PASSes); `-V` prints nothing
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP tmux_skew: 'tmux -V' printed ""/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) tmux_skew: /m);
  });
});


// ── gh's authentication ───────────────────────────────────────────────────

describe('ccrc doctor: gh_auth', () => {
  it('goes red when gh is logged out', () => {
    const home = healthy('ccrc-doctor-ghauth-out-');
    ghStub(home, ['You are not logged into any GitHub hosts. To log in, run: gh auth login'], 1);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL gh_auth: /m);
    expect(r.code).toBe(1);
  });

  it('goes red when the token is missing the repo scope', () => {
    const home = healthy('ccrc-doctor-ghauth-scope-');
    ghStub(home, [...GH_OK.slice(0, -1), "  - Token scopes: 'gist', 'read:org'"], 0);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL gh_auth: .*repo/m);
    expect(r.code).toBe(1);
  });

  it("does not mistake 'repo:status' for the repo scope", () => {
    const home = healthy('ccrc-doctor-ghauth-substring-');
    ghStub(home, [...GH_OK.slice(0, -1), "  - Token scopes: 'repo:status', 'read:org'"], 0);
    expect(runDoctor(home).stdout).toMatch(/^FAIL gh_auth: /m);
  });

  it("does not let a SECOND host's 'repo' scope mask github.com lacking it (D-82's neighbour)", () => {
    // MEASURED RED (before Task 1 of stage2d): with `_check_gh_auth` still
    // calling bare `gh auth status`, this fixture's `ghe.example.com` section
    // carries `Token scopes: 'repo'`, and the check's `case` match is a plain
    // substring test over the WHOLE combined output — so it matched, and the
    // check printed exactly `PASS gh_auth: authenticated, and the token
    // carries the 'repo' scope` (code 0, summary "0 failed") even though
    // github.com's own section, three lines above, has no 'repo' at all.
    const home = healthy('ccrc-doctor-ghauth-multihost-');
    ghStub(home, [
      'github.com',
      '  - Logged in to github.com account fixture-bot (keyring)',
      '  - Active account: true',
      '  - Git operations protocol: https',
      '  - Token: gho_************************************',
      "  - Token scopes: 'gist', 'read:org'",
      'ghe.example.com',
      '  - Logged in to ghe.example.com account fixture-bot (keyring)',
      '  - Active account: false',
      "  - Token scopes: 'repo'",
    ], 0);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL gh_auth: .*repo/m);
    expect(r.code).toBe(1);
  });

  it('WARNS, not passes, when gh reports no scopes line at all — unknown is not fine', () => {
    // An unreadable scope list is a third state: authenticated, but this check
    // cannot say whether the token can write. Collapsing it into PASS would
    // claim a fact nobody measured; collapsing it into FAIL would block a box
    // that may be perfectly fine. A WARN with a remedy is the honest answer.
    const home = healthy('ccrc-doctor-ghauth-noscopes-');
    ghStub(home, ['github.com', '  - Logged in to github.com account fixture-bot (oauth_token)'], 0);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN gh_auth: /m);
    expect(r.code).toBe(0);
  });

  it('passes on an authenticated token that carries repo', () => {
    const home = healthy('ccrc-doctor-ghauth-ok-');
    expect(lineFor(runDoctor(home).stdout, 'gh_auth')).toMatch(/^PASS gh_auth: /);
  });

  it('answers on a box with no coreutils timeout, rather than skipping the check', () => {
    const home = healthy('ccrc-doctor-ghauth-notimeout-');
    // BOTH spellings, or the degrade under test never happens on the
    // platform whose tool wears the other name.
    unstub(home, 'timeout');
    unstub(home, 'gtimeout');
    expect(lineFor(runDoctor(home).stdout, 'gh_auth')).toMatch(/^PASS gh_auth: /);
  });

  it('really executes the contained gh — the poison logs the argv it saw', () => {
    // Proof the check is not vacuous AND proof of containment in one
    // assertion: the only `gh` this suite can reach is the fixture's own.
    // MEASURED: Task 1 of stage2d changed the check's own argv from
    // `auth status` to `auth status --hostname github.com` (gh_auth's
    // github.com-scoping fix, above) — this exact-match `toContain` went red
    // on the unmodified logged line ("expected [ 'auth status --hostname
    // github.com' ] to include 'auth status'"), which is the correct
    // reaction: the poison is doing its job of recording precisely what was
    // asked. Loosened to a substring match so the containment proof survives
    // the argv the check legitimately sends now.
    const home = broken('ccrc-doctor-ghauth-poison-');
    const r = runDoctor(home);
    expect(ghPoisonAt(home).some((l) => l.includes('auth status'))).toBe(true);
    expect(r.stdout).toMatch(/^FAIL gh_auth: /m);
  });
});


// ── git's identity ────────────────────────────────────────────────────────

describe('ccrc doctor: git_email', () => {
  it('goes red when this box has no git user.email', () => {
    const home = healthy('ccrc-doctor-gitemail-missing-');
    rmSync(join(home, 'fixture-git-email'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL git_email: not set/m);
    expect(r.code).toBe(1);
  });

  it('names the address, and the scope it came from, when it is set', () => {
    const home = healthy('ccrc-doctor-gitemail-ok-');
    const line = lineFor(runDoctor(home).stdout, 'git_email');
    expect(line).toContain('ops@example.invalid');
    expect(line).toContain('--global');
  });

  it('falls back to the system config when there is no global one', () => {
    const home = healthy('ccrc-doctor-gitemail-system-');
    rmSync(join(home, 'fixture-git-email'), { force: true });
    writeFileSync(join(home, 'fixture-git-email-system'), 'box@example.invalid\n');
    const line = lineFor(runDoctor(home).stdout, 'git_email');
    expect(line).toMatch(/^PASS git_email: box@example\.invalid /);
    expect(line).toContain('--system');
  });

  // ABSENT-BY-POLICY. `user.useConfigOnly=true` is git's own way to say
  // "identity is per-repository": git then refuses to invent one from
  // user@host and demands an explicit address in each repo. That is a STRONGER
  // posture than a global default on a box carrying several identities — a
  // global silently attributes a commit to the wrong address whenever a repo
  // forgets its own, and a wrong author is permanent in history where a refusal
  // is loud and fixable. Before this arm the check read `user.email` alone and
  // called empty a failure, collapsing two states an operator handles
  // completely differently.
  it('a declared per-repository policy PASSES — it is not the same as never configured', () => {
    const home = healthy('ccrc-doctor-gitemail-policy-');
    rmSync(join(home, 'fixture-git-email'), { force: true });
    writeFileSync(join(home, 'fixture-git-useconfigonly'), 'true\n');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'git_email');
    expect(line).toMatch(/^PASS git_email: /);
    expect(line).toContain('useConfigOnly');
    expect(line).toMatch(/per-repositor/i);
    expect(r.stdout).not.toMatch(/^FAIL git_email/m);
  });

  it('a policy set to anything but true is NOT a policy', () => {
    // `useConfigOnly=false` is git's default and says nothing; treating any
    // present value as consent would turn the arm into a way to silence the
    // check by accident.
    const home = healthy('ccrc-doctor-gitemail-policy-false-');
    rmSync(join(home, 'fixture-git-email'), { force: true });
    writeFileSync(join(home, 'fixture-git-useconfigonly'), 'false\n');
    expect(runDoctor(home).stdout).toMatch(/^FAIL git_email/m);
  });

  it('an address WINS over the policy — a box with both is reported by its address', () => {
    const home = healthy('ccrc-doctor-gitemail-both-');
    writeFileSync(join(home, 'fixture-git-useconfigonly'), 'true\n');
    const line = lineFor(runDoctor(home).stdout, 'git_email');
    expect(line).toContain('ops@example.invalid');
    expect(line).not.toContain('useConfigOnly');
  });

  it('the FAIL names BOTH remedies, so neither posture reads as the only one', () => {
    // The old remedy named a global address and nothing else, which pointed an
    // operator whose identity is deliberately per-repository at the one change
    // that would make their commits wrong.
    const home = healthy('ccrc-doctor-gitemail-remedy-');
    rmSync(join(home, 'fixture-git-email'), { force: true });
    const out = runDoctor(home).stdout;
    expect(out).toMatch(/user\.email/);
    expect(out).toMatch(/useConfigOnly/);
  });

  it('a whitespace-only address is NOT set — and must not print an illegal line', () => {
    // "   " is non-empty after `$( )`, so it used to PASS, emitting
    // `PASS git_email:    ` — a line the shape test in this file declares
    // illegal, for a box whose commits carry an empty author address. Both
    // halves are asserted here: the verdict AND the line shape.
    const home = healthy('ccrc-doctor-gitemail-blank-');
    writeFileSync(join(home, 'fixture-git-email'), '   \n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL git_email: not set/m);
    expect(lineFor(r.stdout, 'git_email')).toMatch(/^(PASS|WARN|FAIL) [a-z0-9_]+: \S/);
    expect(r.code).toBe(1);
  });

  it('a dotfiles repo in $HOME is not this box\'s identity — the review\'s repro, pinned', () => {
    // THE REGRESSION THIS EXISTS FOR: the check first shipped as
    // `git -C "$HOME" config user.email`, which reads system + global PLUS
    // $HOME's own repo-local config. Under the widespread `git init ~`
    // dotfiles pattern that is a PASS on a value applying to exactly one
    // repository — a false PASS on the very box the check exists to catch.
    //
    // Uses the REAL git, deliberately: a stub cannot reproduce the config
    // precedence that IS the bug. Everything it reads is inside the fixture,
    // and GIT_CONFIG_NOSYSTEM keeps a box's /etc/gitconfig out of the answer so
    // the test means the same thing on every machine (this one has no
    // /etc/gitconfig at all; another might).
    const home = healthy('ccrc-doctor-gitemail-dotfiles-');
    unstub(home, 'git');
    linkReal(home, 'git');
    writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = only-a-name\n');
    const genv = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' };
    execFileSync('git', ['-C', home, 'init', '-q', '.'], { env: genv });
    execFileSync('git', ['-C', home, 'config', 'user.email', 'dotfiles-local@example.invalid'], { env: genv });
    // Sanity: the fixture really is the shape the bug needs — repo-local set,
    // global unset. Without this the test could go green on a fixture that
    // never reproduced anything.
    expect(execFileSync('git', ['-C', home, 'config', 'user.email'], { env: genv, encoding: 'utf8' }).trim())
      .toBe('dotfiles-local@example.invalid');

    const r = runDoctor(home, ['doctor'], { GIT_CONFIG_NOSYSTEM: '1' });
    expect(r.stdout).toMatch(/^FAIL git_email: not set/m);
    expect(r.stdout).not.toMatch(/dotfiles-local/);
    expect(r.code).toBe(1);
  });
});


// ── systemd linger ────────────────────────────────────────────────────────

// LINGER IS A LINUX CONCEPT AND macOS HAS NO EQUIVALENT — see the check's own
// Darwin arm. The four cases below are logind's (`Linger=yes`, an unknown
// uid, no loginctl at all), and none of them can arise on a box where the
// answer is a standing property of the platform rather than a setting. macOS
// gets its own case immediately after.
describeLinux('ccrc doctor: linger', () => {
  it('goes red when linger is off for this user', () => {
    const home = healthy('ccrc-doctor-linger-off-');
    writeFileSync(join(home, 'fixture-linger'), 'no\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL linger: not enabled/m);
    expect(r.code).toBe(1);
  });

  it('goes red when logind does not know this user at all', () => {
    // The measured shape of a box that never had linger: `loginctl show-user`
    // exits nonzero for a user with neither a live session nor linger, so the
    // absent answer arrives as an error, not as `Linger=no`.
    const home = healthy('ccrc-doctor-linger-unknown-');
    rmSync(join(home, 'fixture-linger'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL linger: /m);
    expect(r.code).toBe(1);
  });

  it('goes red when the box has no loginctl at all', () => {
    const home = healthy('ccrc-doctor-linger-nologinctl-');
    unstub(home, 'loginctl');
    expect(runDoctor(home).stdout).toMatch(/^FAIL linger: loginctl is not on PATH/m);
  });

  it('passes when linger is enabled', () => {
    const home = healthy('ccrc-doctor-linger-ok-');
    expect(lineFor(runDoctor(home).stdout, 'linger')).toMatch(/^PASS linger: enabled/);
  });
});


describeDarwin('ccrc doctor: linger, on a platform that has none', () => {
  it('WARNS rather than fails, and names the guarantee that is missing', () => {
    // A FAIL says "fix this", and there is nothing to fix: a LaunchAgent runs
    // in the login session, and the only thing on macOS that survives a
    // logout is a root-owned LaunchDaemon — a posture `ccrc install`
    // deliberately does not choose. So the standing fact is reported as a
    // WARN, with a remedy an operator can actually act on.
    const home = healthy('ccrc-doctor-linger-darwin-');
    const line = lineFor(runDoctor(home).stdout, 'linger');
    expect(line).toMatch(/^WARN linger: not a macOS concept/);
    expect(line).toMatch(/stop at logout and start again at login/);
  });

  it('does not fail the run — a by-design WARN is not a broken box', () => {
    const home = healthy('ccrc-doctor-linger-darwin-ok-');
    const r = runDoctor(home);
    expect(r.code, r.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join('\n')).toBe(0);
  });

  it('never asks logind anything', () => {
    // There is no logind to ask, and a fixture that recorded a call would
    // mean the check had reached the Linux arm on a macOS box.
    const home = healthy('ccrc-doctor-linger-darwin-noask-');
    runDoctor(home);
    expect(existsSync(join(home, 'loginctl-poison'))).toBe(false);
  });
});


// ── $HOME/.local/bin on PATH ──────────────────────────────────────────────
// Stage 2d, Task 2. The check that makes every OTHER remedy in this file
// executable: `ccrc`, `ccd` and every generated account wrapper are installed
// into `$HOME/.local/bin` (deploy.sh's `install_atomic … .local/bin/…`), so a
// box whose login shell never put that directory on PATH answers "command not
// found" to every instruction doctor prints.
//
// MUTATIONS MEASURED (a guard ships with a test that reds when it is deleted —
// each was applied to the shipped check, run, and reverted):
//   - the WARN arm deleted, so the check can only pass -> RED, "warns when
//     $HOME/.local/bin is not on PATH…", `expected -1 to be greater than -1`
//     (no WARN line to find).
//   - `local want=` drifted to `$HOME/bin` -> RED, "names the same directory the
//     wrapper library does…", `expected '$HOME/bin' to be '$HOME/.local/bin'`.
//   - the `path` entry deleted from the table -> RED, the bijection test,
//     `ORPHAN _check_path` (measured in the same shape for all four checks).

describe('ccrc doctor: path', () => {
  /** The one fixture mutation this check has: a PATH with the stub directory on
   *  it and `<home>/.local/bin` gone. Still no system directory anywhere on it,
   *  so the real `gh` stays unreachable — the other checks that resolve out of
   *  `.local/bin` go red beside this one, which is true and deliberate. */
  const pathWithoutLocalBin = (home: string): NodeJS.ProcessEnv =>
    ({ PATH: join(home, 'stub-bin') });

  it('warns when $HOME/.local/bin is not on PATH, and the remedy is paste-able', () => {
    const home = healthy('ccrc-doctor-path-missing-');
    const lines = runDoctor(home, ['doctor'], pathWithoutLocalBin(home)).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN path: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('$HOME/.local/bin is not in $PATH');
    // The remedy is asserted VERBATIM, not by regex: it is a line an operator
    // pastes into ~/.profile, and a quoting slip in it is a line that either
    // does nothing or truncates their PATH.
    expect(lines[i + 1]).toBe(
      '  remedy: add \'export PATH="$HOME/.local/bin:$PATH"\' to ~/.profile (or ~/.bashrc), then log in again');
  });

  it('passes naming the position it was found at — not the bare word "ok"', () => {
    // "the detail is always a measurement" (the check file's own header): the
    // position is what distinguishes "it is on PATH" from "it is on PATH ahead
    // of /usr/bin", which is the difference between running the wrapper and
    // running whatever a distro package left in /usr/bin.
    const home = healthy('ccrc-doctor-path-ok-');
    expect(lineFor(runDoctor(home).stdout, 'path'))
      .toMatch(/^PASS path: \$HOME\/\.local\/bin is in \$PATH \(position 1\)$/);
  });

  it('finds it at a LATER position too, and says which', () => {
    const home = healthy('ccrc-doctor-path-late-');
    const r = runDoctor(home, ['doctor'],
      { PATH: `${join(home, 'stub-bin')}:${join(home, '.local', 'bin')}` });
    expect(lineFor(r.stdout, 'path')).toContain('(position 2)');
  });

  it('names the same directory the wrapper library does — one spelling, two files', () => {
    // `ccrc-wrapper-shape`'s own comment: "One spelling, because two files
    // comparing "$HOME/.local/bin" against each other is the same drift in
    // miniature." The `path` check deliberately does NOT source that value (it
    // must answer on a box where the best-effort library did not ship — see its
    // own comment), so the guarantee is a mechanism here instead of a promise
    // there: the two literals are compared, and a drift is red.
    const lib = readFileSync(LIB_SRC, 'utf8');
    const checks = readFileSync(CHECKS_SRC, 'utf8');
    const wrapperDir = /WRAPPER_BIN_DIR="([^"]+)"/.exec(lib)?.[1];
    const pathDir = /_check_path\(\) \{\n\s*local want="([^"]+)"/.exec(checks)?.[1];
    expect(wrapperDir, 'ccrc-wrapper-shape no longer declares WRAPPER_BIN_DIR').toBeTruthy();
    expect(pathDir, '_check_path no longer opens with `local want="…"`').toBeTruthy();
    expect(pathDir).toBe(wrapperDir);
  });
});


// ── the units this box is supposed to be running ──────────────────────────
// Stage 2d, Task 2. A unit FILE with no process behind it is the failure the
// spec's §5 "services active" names, and it is invisible to every other check
// here: the box is configured, the binaries are installed, and nothing answers.
// Which units a box has is what its ROLE is (`_box_role`'s D-73 inference), so
// the check measures the ones whose file is present and skips the box that has
// none rather than demanding units a dev checkout was never meant to have.
//
// MUTATIONS MEASURED (applied to the shipped check, run, reverted):
//   - the SKIP arm deleted -> RED, "SKIPS a box with no ccrc units at all…",
//     `expected 'PASS node: …' to match /^SKIP services: no ccrc units instal…/`.
//   - the timer's WARN collapsed into the FAIL bucket (`_dr_warn` -> `_dr_fail`)
//     -> RED ×2, "warns — not fails — when only the cap-scopes timer is
//     stopped" and "reports a dead service and a dead timer as TWO lines…".
//   - `known=` losing `ccrc-agent.service` -> RED, "measures the fleet host's
//     own unit by the same rule", `to match /^FAIL services: ccrc-agent\.service …/`.
//   - the PASS detail replaced by the bare word "ok" (the header's "detail is
//     always a measurement" rule) -> RED, "passes naming every unit it
//     measured", `expected 'PASS services: ok' to contain 'ccrc.service is active'`.

describe('ccrc doctor: services', () => {
  it('SKIPS a box with no ccrc units at all — a dev checkout has nothing to measure', () => {
    const home = healthy('ccrc-doctor-services-none-');
    rmSync(unitDirOf(home), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP services: no ccrc units installed/m);
    expect(r.stdout).toMatch(/a dev checkout, or a box .*ccrc install.* never touched/);
    // A skip is not a verdict: no remedy line, and the run still exits 0.
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) services: /m);
    expect(r.code).toBe(0);
  });

  it('fails when ccrc.service is installed and not running, and the remedy starts it — in THIS box\'s vocabulary', () => {
    // The remedy is the whole point of the FAIL: three commands, and every
    // one must exist on the box that prints them. The first cut of the macOS
    // port left this string on systemd's spelling, so a macOS operator whose
    // server was down was handed `systemctl`, `journalctl` and an `enable
    // --now` — three dead ends in the one check whose FAIL means "configured
    // to run and not running" (PR #11 review). The Darwin remedy names the
    // bootstrap, the print, and the LOG FILE the plist actually writes.
    const home = healthy('ccrc-doctor-services-dead-');
    writeFileSync(join(home, 'fixture-unit-ccrc.service'), 'inactive\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccrc.service is installed but inactive');
    if (process.platform === 'darwin') {
      expect(lines[i + 1]).toMatch(
        /^ {2}remedy: launchctl bootstrap gui\/\d+ \S*app\.ccrc\.ccrc\.plist, then read what it says: launchctl print gui\/\d+\/app\.ccrc\.ccrc, tail -n 50 \S*\/\.ccrc\/logs\/app\.ccrc\.ccrc\.log$/);
      expect(lines[i + 1]).not.toMatch(/systemctl|journalctl/);
    } else {
      expect(lines[i + 1]).toMatch(
        /^ {2}remedy: systemctl --user enable --now ccrc\.service, then read what it says: systemctl --user status ccrc\.service, journalctl --user -u ccrc\.service -n 50$/);
    }
  });

  it('measures the fleet host\'s own unit by the same rule', () => {
    // A fleet host has `ccrc-agent.service` and no `ccrc.service`
    // (deploy.sh's two lanes). A check that knew only the server's unit would
    // report a perfectly healthy PASS on a box whose agent is dead — the link
    // the whole fleet runs over.
    const home = healthy('ccrc-doctor-services-agent-');
    removeUnitFile(home, 'ccrc.service');
    writeUnitFile(home, 'ccrc-agent.service');
    writeFileSync(join(home, 'fixture-unit-ccrc-agent.service'), 'inactive\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL services: ccrc-agent\.service is installed but inactive/m);
    expect(r.code).toBe(1);
  });

  itLinux('warns — not fails — when only the cap-scopes timer is stopped', () => {
    // Two different operator actions, so two different classes: a stopped
    // server answers nothing at all, while a stopped cap-scopes timer means
    // panes spawn without their memory cap (the OOM guardrail deploy.sh installs) —
    // degraded, not down.
    const home = healthy('ccrc-doctor-services-timer-');
    writeFileSync(join(home, 'fixture-unit-ccd-cap-scopes.timer'), 'inactive\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccd-cap-scopes.timer is installed but inactive');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccd-cap-scopes\.timer$/);
    expect(runDoctor(home).code).toBe(0);
  });

  itLinux('reports a dead service and a dead timer as TWO lines, each with its own remedy', () => {
    // The "ONE CHECK MAY ANSWER IN TWO CLASSES" rule, which the runner already
    // counts (`counts a check that answers in TWO classes in both`): joining
    // these would hand the timer finding the service's remedy.
    const home = healthy('ccrc-doctor-services-both-');
    writeFileSync(join(home, 'fixture-unit-ccrc.service'), 'inactive\n');
    writeFileSync(join(home, 'fixture-unit-ccd-cap-scopes.timer'), 'failed\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const f = lines.findIndex((l) => l.startsWith('FAIL services: '));
    const w = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(f, r.stdout).toBeGreaterThan(-1);
    expect(w, r.stdout).toBeGreaterThan(-1);
    expect(lines[f + 1]).toContain('enable --now ccrc.service');
    expect(lines[w + 1]).toContain('enable --now ccd-cap-scopes.timer');
    expect(lines[w]).toContain('failed');            // systemd's word, not "inactive"
    // The worse class is what the check returns, and the summary counts both.
    // `HEALTHY_SKIPS` rides along on every REAL-table count in this file: it
    // is 1 on Linux (`models` SKIPs on every healthy fixture regardless of
    // platform — the fixture plants only the upstream Anthropic account,
    // which never has a model registry) and 2 on macOS (`models` plus
    // `scopes`, which IS the Darwin-only one — cgroup throttling has nothing
    // to measure there).
    expect(r.stdout).toMatch(new RegExp(
      `^summary: \\d+ checks \\(${HEALTHY_SKIPS} skipped\\), \\d+ verdicts — \\d+ passed, 1 warned, 1 failed$`, 'm'));
    expect(r.code).toBe(1);
  });

  it('passes naming every unit it measured', () => {
    const home = healthy('ccrc-doctor-services-ok-');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).toContain('ccrc.service is active');
    // The cap-scopes timer is a Linux-only job (cgroup scopes), so "every
    // unit it measured" is a different — and shorter — list on macOS. The
    // property being pinned is that the line names what it measured, not that
    // any particular platform's set is the one true set.
    if (process.platform !== 'darwin') {
      expect(line).toContain('ccd-cap-scopes.timer is active');
    }
  });

  it('fails, rather than passing, when there are units and no systemctl to ask', () => {
    const home = healthy('ccrc-doctor-services-nosystemctl-');
    unstubManager(home);
    const r = runDoctor(home);
    // The BINARY differs, the verdict does not: a box holding job files it
    // cannot ask about is a failure on either platform, and the message names
    // whichever manager this one was supposed to have.
    const mgr = process.platform === 'darwin' ? 'launchctl' : 'systemctl';
    expect(r.stdout).toMatch(new RegExp(`^FAIL services: ${mgr} is not on PATH`, 'm'));
    expect(r.code).toBe(1);
  });
});


describe('ccrc doctor: services knows about the account-health timer', () => {
  itLinux('warns — with its OWN consequence — when the probe timer is installed and stopped', () => {
    // §A.7's parenthesis, measured: `_check_services`'s `known` is a
    // hand-written list, and a timer outside it is a unit this box runs
    // and doctor never asks about. WARN is the right class for the same reason
    // cap-scopes' is — a stopped probe is degradation, not a box that is down —
    // but the SENTENCE cannot be shared: cap-scopes' says "panes spawned while
    // it is stopped run without their memory cap", which is false here and
    // would send an operator to the wrong place with the right remedy.
    const home = healthy('ccrc-doctor-services-health-timer-');
    writeUnitFile(home, 'ccd-account-health.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-account-health.timer'), 'inactive\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccd-account-health.timer is installed but inactive');
    expect(lines[i]).toContain('no account\'s credential is being probed');
    expect(lines[i]).not.toContain('memory cap');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccd-account-health\.timer$/);
    // A stopped reading is not a failed box: WARN, and rc stays 0.
    expect(runDoctor(home).code).toBe(0);
  });

  itLinux('names it in the PASS line when it is installed and running', () => {
    // "The PASS names every unit it asked about" is `_check_services`' own
    // stated contract; a timer added to `known` and then never mentioned would
    // satisfy the warn case above while measuring nothing on a healthy box.
    const home = healthy('ccrc-doctor-services-health-timer-ok-');
    writeUnitFile(home, 'ccd-account-health.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-account-health.timer'), 'active\n');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).toContain('ccd-account-health.timer is active');
  });

  it('a box without the unit is never asked about it — no count moves', () => {
    // `_check_services` asks only about units whose FILE is in the unit dir, so
    // a fourth name in `known` costs nothing on a fixture that never plants it.
    // That is the whole reason `HEALTHY_SKIPS` and the counting pins that read
    // it (`:1280`, `:1789`, `:1894`, `:3128`, `:4501`, `:5177`, `:5178`) stay
    // exactly where they are.
    const home = healthy('ccrc-doctor-services-health-timer-absent-');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).not.toContain('ccd-account-health');
  });
});


describe('ccrc doctor: services knows about the telemetry keepalive timer', () => {
  // F4 (fix-wave 2026-09-07): `ccd-account-health.timer` and
  // `ccd-telemetry-keepalive.timer` joined `known` in ONE commit (d0064e6e),
  // which in the same act wrote the `*)` arm's "the day a fifth unit joins
  // it" — so that sentence was stale the instant it was written, which is
  // exactly what D-2192 books. A stopped keepalive is silent (no error,
  // just telemetry going stale) unless doctor names it; hence this block.
  itLinux('warns — with its OWN consequence — when the keepalive timer is installed and stopped', () => {
    const home = healthy('ccrc-doctor-services-keepalive-timer-');
    writeUnitFile(home, 'ccd-telemetry-keepalive.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-telemetry-keepalive.timer'), 'inactive\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccd-telemetry-keepalive.timer is installed but inactive');
    expect(lines[i]).toContain('goes stale');
    expect(lines[i]).not.toContain('memory cap');
    expect(lines[i]).not.toContain('credential is being probed');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccd-telemetry-keepalive\.timer$/);
    // A stopped reading is not a failed box: WARN, and rc stays 0.
    expect(runDoctor(home).code).toBe(0);
  });

  itLinux('names it in the PASS line when it is installed and running', () => {
    const home = healthy('ccrc-doctor-services-keepalive-timer-ok-');
    writeUnitFile(home, 'ccd-telemetry-keepalive.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-telemetry-keepalive.timer'), 'active\n');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).toContain('ccd-telemetry-keepalive.timer is active');
  });

  it('a box without the unit is never asked about it — no count moves', () => {
    const home = healthy('ccrc-doctor-services-keepalive-timer-absent-');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).not.toContain('ccd-telemetry-keepalive');
  });
});


describe('ccrc doctor: services knows about the temp-dir reaper timer', () => {
  // `ccd-tmp-sweep.timer` joins `known` — the DIRECT design, not the effect
  // one — because the reaper writes no artifact a check could read back: its
  // only output is a journal line. A stopped reaper is silent until `/` fills,
  // which is how /tmp/claude-1000 reached 138G on the fleet host.
  itLinux('warns — with its OWN consequence — when the reaper timer is installed and stopped', () => {
    const home = healthy('ccrc-doctor-services-tmp-sweep-timer-');
    writeUnitFile(home, 'ccd-tmp-sweep.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-tmp-sweep.timer'), 'inactive\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccd-tmp-sweep.timer is installed but inactive');
    expect(lines[i]).toContain('per-uid temp dir');
    expect(lines[i]).not.toContain('memory cap');
    expect(lines[i]).not.toContain('the job it fires is not running');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccd-tmp-sweep\.timer$/);
    // A stopped reaper is not a failed box: WARN, and rc stays 0.
    expect(runDoctor(home).code).toBe(0);
  });

  itLinux('names it in the PASS line when it is installed and running', () => {
    const home = healthy('ccrc-doctor-services-tmp-sweep-timer-ok-');
    writeUnitFile(home, 'ccd-tmp-sweep.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-tmp-sweep.timer'), 'active\n');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).toContain('ccd-tmp-sweep.timer is active');
  });

  it('a box without the unit is never asked about it — no count moves', () => {
    const home = healthy('ccrc-doctor-services-tmp-sweep-timer-absent-');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).not.toContain('ccd-tmp-sweep');
  });
});


describe('ccrc doctor: services knows about the models catalogue timer', () => {
  // D-2190/D-2191: `ccrc-models.timer` already ships (deploy/systemd/ccrc-models.timer)
  // but `_check_services`'s `known` array never named it, so a dead
  // models-refresh timer read as a silent PASS. Membership in `installed` is
  // gated on the unit FILE existing, so this fixture case is what proves the
  // fix is not a no-op: D-2191 measured that adding the name to `known`
  // alone changes nothing any suite can see. No suite count is quoted here
  // on purpose — two attempts at one went stale or conflated two different
  // runs. The mutation table is the measurement; a number here is not.
  itLinux('warns — with its OWN consequence — when the models timer is installed and stopped', () => {
    const home = healthy('ccrc-doctor-services-models-timer-');
    writeUnitFile(home, 'ccrc-models.timer');
    writeFileSync(join(home, 'fixture-unit-ccrc-models.timer'), 'inactive\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccrc-models.timer is installed but inactive');
    expect(lines[i]).toContain('catalogue goes stale');
    expect(lines[i]).not.toContain('memory cap');
    expect(lines[i]).not.toContain('credential is being probed');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccrc-models\.timer$/);
    // A stopped reading is not a failed box: WARN, and rc stays 0.
    expect(runDoctor(home).code).toBe(0);
  });

  itLinux('names it in the PASS line when it is installed and running', () => {
    const home = healthy('ccrc-doctor-services-models-timer-ok-');
    writeUnitFile(home, 'ccrc-models.timer');
    writeFileSync(join(home, 'fixture-unit-ccrc-models.timer'), 'active\n');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).toContain('ccrc-models.timer is active');
  });

  it('a box without the unit is never asked about it — no count moves', () => {
    const home = healthy('ccrc-doctor-services-models-timer-absent-');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).not.toContain('ccrc-models');
  });
});


describe('ccrc doctor: services knows about the pool-sync timer', () => {
  // account-pool-membership wave 1, Task 4: `ccd-pool-sync.timer` ships
  // (deploy/systemd/ccd-pool-sync.timer) but until this task `_check_services`'s
  // `known` array never named it. Ruling (task-4-brief.md): `ccd-pool-sync`
  // goes IN `known`, unlike `ccd-graph-sweep`/`ccrc-ddns` (covered by an
  // effect-based design reading what the timer PRODUCES) and unlike
  // `ccd-usage-sweep` (a disclosed gap in neither design) — because a stopped
  // sync is SILENT: a node just stops refreshing its cached projection, and
  // nothing surfaces until the lease expires, minutes later, and placement
  // starts refusing into every tagged project with no error anywhere.
  itLinux('warns — with its OWN consequence — when the pool-sync timer is installed and stopped', () => {
    const home = healthy('ccrc-doctor-services-pool-sync-timer-');
    writeUnitFile(home, 'ccd-pool-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-pool-sync.timer'), 'inactive\n');
    // Item 4 (I2, wave-1 fix round A): `pool-sync` (the ARTIFACT check) is a
    // SEPARATE finding from `services` (the ACTIVATION check) this describe
    // block is about — a fresh projection keeps that check PASSing so this
    // test still isolates exactly the one thing it breaks, matching
    // `healthy()`'s own "breaks exactly ONE thing" contract.
    plantPoolEpoch(home, {});
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccd-pool-sync.timer is installed but inactive');
    expect(lines[i]).toContain('stops refreshing');
    expect(lines[i]).toContain('lease expires');
    expect(lines[i]).not.toContain('memory cap');
    expect(lines[i]).not.toContain('credential is being probed');
    expect(lines[i]).not.toContain('catalogue goes stale');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccd-pool-sync\.timer$/);
    // A stopped reading is not a failed box: WARN, and rc stays 0.
    expect(runDoctor(home).code).toBe(0);
  });

  itLinux('names it in the PASS line when it is installed and running', () => {
    const home = healthy('ccrc-doctor-services-pool-sync-timer-ok-');
    writeUnitFile(home, 'ccd-pool-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-pool-sync.timer'), 'active\n');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).toContain('ccd-pool-sync.timer is active');
  });

  it('a box without the unit is never asked about it — no count moves', () => {
    const home = healthy('ccrc-doctor-services-pool-sync-timer-absent-');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).not.toContain('ccd-pool-sync');
  });
});


describe('ccrc doctor: services knows about the update-watchdog timer', () => {
  // W4a Task 9 (design §11): `ccrc-update-watchdog.timer` joins `known` — the
  // DIRECT design — because a stopped watchdog is SILENT: it acts only on the
  // day a server self-update dies mid-install, and on that day nothing else
  // is left on the box to measure the update.
  itLinux('warns — with its OWN consequence — when the watchdog timer is installed and stopped', () => {
    const home = healthy('ccrc-doctor-services-update-watchdog-');
    writeUnitFile(home, 'ccrc-update-watchdog.timer');
    writeFileSync(join(home, 'fixture-unit-ccrc-update-watchdog.timer'), 'inactive\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccrc-update-watchdog.timer is installed but inactive');
    expect(lines[i]).toContain('never measured or reverted');
    expect(lines[i]).not.toContain('the job it fires is not running');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccrc-update-watchdog\.timer$/);
    // The verdict line and the rc agree (cmd_doctor cross-checks them).
    expect(r.stdout).not.toMatch(/the check exited/);
    // A stopped watchdog is not a failed box: WARN, and rc stays 0.
    expect(r.code).toBe(0);
  });

  itLinux('names it in the PASS line when it is installed and running', () => {
    const home = healthy('ccrc-doctor-services-update-watchdog-ok-');
    writeUnitFile(home, 'ccrc-update-watchdog.timer');
    writeFileSync(join(home, 'fixture-unit-ccrc-update-watchdog.timer'), 'active\n');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).toContain('ccrc-update-watchdog.timer is active');
  });

  it('a box without the unit is never asked about it — no count moves', () => {
    const home = healthy('ccrc-doctor-services-update-watchdog-absent-');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).not.toContain('ccrc-update-watchdog');
  });
});


describe('ccrc doctor: services knows about the update-sync timer', () => {
  // programme wave 4 (design 2026-09-20 §9): `ccd-update-sync.timer` joins
  // `known` on `ccd-pool-sync.timer`'s own ruling — a stopped puller is
  // SILENT: the projection ages in place, nothing looks wrong, and then its
  // lease ends and every `ccrc update` without --to refuses as stale.
  itLinux('warns — with its OWN consequence — when the update-sync timer is installed and stopped', () => {
    const home = healthy('ccrc-doctor-services-update-sync-timer-');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'inactive\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccd-update-sync.timer is installed but inactive');
    expect(lines[i]).toContain('stops refreshing its update projection');
    expect(lines[i]).toContain('without --to refuses as stale');
    expect(lines[i]).not.toContain('pool projection');
    expect(lines[i]).not.toContain('memory cap');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccd-update-sync\.timer$/);
    // A stopped refresh is not a failed box: WARN, and rc stays 0.
    expect(runDoctor(home).code).toBe(0);
  });

  itLinux('names it in the PASS line when it is installed and running', () => {
    const home = healthy('ccrc-doctor-services-update-sync-timer-ok-');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'active\n');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).toContain('ccd-update-sync.timer is active');
  });

  it('a box without the unit is never asked about it — no count moves', () => {
    const home = healthy('ccrc-doctor-services-update-sync-timer-absent-');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).not.toContain('ccd-update-sync');
  });
});


// ── pool-sync: the EFFECT check, item 4 (I2, wave-1 fix round A) ──────────
// `services` (above) measures the TIMER's own activation state, which stays
// `active` while its oneshot fails every run — this describe block is the
// ARTIFACT check that catches that: `$HOME/.cc-sessions/pool-epoch` and its
// own lease, never the timer's reported state. `healthy()` installs no
// `ccd-pool-sync.timer` at all (see `HEALTHY_SKIPS`'s own docstring), so
// every test below plants the unit itself where the scenario needs a FLEET
// box, and the "no control plane by configuration" SKIP is the one
// `healthy()` already proves on its own.
describe('ccrc doctor: pool-sync', () => {
  it('SKIPs — no control plane by configuration — on a box with no ccd-pool-sync.timer installed at all', () => {
    const home = healthy('ccrc-doctor-pool-sync-no-unit-');
    const line = lineFor(runDoctor(home).stdout, 'pool-sync');
    expect(line).toBeUndefined();   // lineFor is PASS/WARN/FAIL only
    const any = anyVerdictFor(runDoctor(home).stdout, 'pool-sync') ?? '';
    expect(any).toMatch(/^SKIP pool-sync: /);
    expect(any).toContain('no control plane by configuration');
    expect(runDoctor(home).code).toBe(0);
  });

  itLinux('WARNs — not yet synced — when the timer was installed within its grace window and $REG/pool-epoch has not been written yet', () => {
    // Final fix round, item 16 (fix-wave-C): `_check_pool-sync`'s
    // never-synced arm used to FAIL unconditionally, which made a correct
    // fresh `ccrc install --role fleet` end at exit 1 on every box — the
    // timer converges on its own (60s) and a box that just landed the unit
    // has not had one tick yet. `writeUnitFile` writes the fixture unit with
    // `writeFileSync`, whose mtime is "now" by construction, so this test
    // reaches the discriminator's fresh-install path with no extra staging.
    const home = healthy('ccrc-doctor-pool-sync-not-yet-synced-');
    writeUnitFile(home, 'ccd-pool-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-pool-sync.timer'), 'active\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN pool-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('pool-sync-not-yet-synced');
    expect(lines[i]).toContain('has not been written yet');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    // The disclosed-but-not-fatal half of the pair this item requires: a
    // fresh install must still reach exit 0.
    expect(r.code).toBe(0);
  });

  itLinux('FAILs — never synced — when the timer was installed past its grace window and $REG/pool-epoch has never been written', () => {
    const home = healthy('ccrc-doctor-pool-sync-never-synced-');
    writeUnitFile(home, 'ccd-pool-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-pool-sync.timer'), 'active\n');
    // Past the check's 120s grace window (two of the timer's own 60s
    // periods) — this is the "had its chance and still never synced" case
    // the pair requires, not the fresh-install case above.
    const past = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(join(unitDirOf(home), unitFileOf('ccd-pool-sync.timer')), past, past);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL pool-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('pool-sync-never-synced');
    expect(lines[i]).toContain('has never been written');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(1);
  });

  itLinux('FAILs — stale — when the projection is past its lease, even though services still reports the timer active', () => {
    const home = healthy('ccrc-doctor-pool-sync-stale-');
    writeUnitFile(home, 'ccd-pool-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-pool-sync.timer'), 'active\n');
    plantPoolEpoch(home, {}, { lease: 1 });   // 1970 — long past its lease
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL pool-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('pool-sync-stale');
    expect(lines[i]).toContain('past its lease');
    // `services` still says the timer is fine — this is the exact false-PASS
    // gap item 4 exists to close, on the SAME box, in the SAME run.
    expect(lineFor(r.stdout, 'services')).toMatch(/^PASS services: /);
    expect(r.code).toBe(1);
  });

  itLinux('WARNs — malformed — when the timer is installed but the projection does not parse', () => {
    const home = healthy('ccrc-doctor-pool-sync-malformed-');
    writeUnitFile(home, 'ccd-pool-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-pool-sync.timer'), 'active\n');
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'pool-epoch'), 'not a projection at all\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN pool-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('pool-sync-malformed');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(0);   // WARN, not FAIL
  });

  itLinux('PASSes when the timer is installed and the projection is fresh', () => {
    const home = healthy('ccrc-doctor-pool-sync-fresh-');
    writeUnitFile(home, 'ccd-pool-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-pool-sync.timer'), 'active\n');
    plantPoolEpoch(home, {});
    const line = lineFor(runDoctor(home).stdout, 'pool-sync') ?? '';
    expect(line).toMatch(/^PASS pool-sync: /);
    expect(line).toContain('within its lease');
    expect(runDoctor(home).code).toBe(0);
  });
});


describe('ccrc doctor: transcripts', () => {
  it('passes on a registry whose sessions all read a live transcript', () => {
    const home = healthy('ccrc-doctor-transcripts-pass-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    // `_dr_continued_in` shells one real `tail -c` per examined transcript —
    // the one external process its pure-bash rewrite could not avoid (there
    // is no bash-only way to read a file's last N bytes). `healthy()`'s
    // contained PATH holds nothing but explicitly-fixtured binaries, so a
    // real `tail` has to be asked for by name, the same way it asks for
    // `realpath`, `jq` and `git` elsewhere in this file.
    linkReal(home, 'tail');
    const wdA = join(home, 'projects', 'demo-a');
    const wdB = join(home, 'projects', 'demo-b');
    mkdirSync(wdA, { recursive: true });
    mkdirSync(wdB, { recursive: true });
    const uuidA = 'a'.repeat(36), uuidB = 'b'.repeat(36);
    writeTranscriptSession(home, 'sess-a', 'claude', wdA, uuidA);
    writeTranscriptSession(home, 'sess-b', 'claude', wdB, uuidB);
    writeTranscript(home, '.claude', wdA, uuidA, turnLine('hello'));
    writeTranscript(home, '.claude', wdB, uuidB, turnLine('hi'));
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^PASS transcripts: 2 session\(s\)/);
    // No overall-`.code` assertion here, deliberately: `seedAccountsSh`
    // hands `healthy()` a real account it was built without, so per-account
    // checks this test does not touch (`graphify`'s skill stamp, `memory`'s
    // session-hook reachability) now have a subject they were not
    // provisioned for and FAIL on their own account — collateral of seeding
    // a roster, not a finding about `transcripts`. `describe('ccrc doctor:
    // routing …')` establishes the same precedent for the same reason: once
    // a fixture adds a roster `healthy()` did not ship, only the ONE check's
    // own verdict line is asserted, never the whole run's exit code.
  });

  it('warns and names the session reading a superseded transcript', () => {
    const home = healthy('ccrc-doctor-transcripts-warn-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    const wdLive = join(home, 'projects', 'live-one');
    const wdFrozen = join(home, 'projects', 'frozen-one');
    mkdirSync(wdLive, { recursive: true });
    mkdirSync(wdFrozen, { recursive: true });
    const uuidLive = 'c'.repeat(36), uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-live', 'claude', wdLive, uuidLive);
    writeTranscriptSession(home, 'sess-frozen', 'claude', wdFrozen, uuidOld);
    writeTranscript(home, '.claude', wdLive, uuidLive, turnLine('still going'));
    writeTranscript(home, '.claude', wdFrozen, uuidOld,
      `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    // The successor is WRITTEN: ccd would take this hop, so a registry still
    // on the old id is one ccd has not followed (DR2 — an unwritten successor
    // is named apart, below).
    writeTranscript(home, '.claude', wdFrozen, uuidNew, turnLine('after the fork'));
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^WARN transcripts: /);
    expect(line).toContain('sess-frozen');
    expect(line, 'the live session must not be named').not.toContain('sess-live');
    expect(out).toMatch(/remedy: .+supervise tick/);
    // No overall-`.code` assertion — see the same note on the test above.
  });

  it('passes vacuously on a box with no sessions', () => {
    // The doctor's own healthy fixture has no `$HOME/.cc-sessions` at all — a
    // SKIP there is a check that cannot be counted (`_check_routing`'s rule:
    // it must state its own PASS in the same words a populated registry
    // would use, just with the count at zero).
    const home = healthy('ccrc-doctor-transcripts-vacuous-');
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^PASS transcripts: 0 session\(s\)/);
    expect(runDoctor(home).code).toBe(0);
  });

  it.skipIf(process.getuid?.() === 0)('fails when the registry cannot be searched', () => {
    const home = healthy('ccrc-doctor-transcripts-unsearchable-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    const reg = join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(join(reg, 'sess-a.uuid'), `${'f'.repeat(36)}\n`);
    chmodSync(reg, 0o000);
    try {
      const out = runDoctor(home).stdout;
      const line = lineFor(out, 'transcripts');
      expect(line, out).toMatch(/^FAIL transcripts: /);
      expect(line).toContain('not a readable, searchable directory');
      expect(out).toContain('remedy: fix its mode');
      expect(runDoctor(home).code).toBe(1);   // a FAIL always fails the overall run
    } finally {
      chmodSync(reg, 0o755);
    }
  });

  it('warns when the roster projection cannot be read but sessions exist to measure', () => {
    // The reordering that keeps the vacuous-PASS case above vacuous: an
    // unreadable/absent roster is only this check's business once there is
    // at least one session for `_ccrc_cfg_dir` to have resolved. `healthy()`
    // itself never writes `~/.ccrc/accounts.sh` — this test plants a session
    // WITHOUT seeding one, which is the one shape that must still WARN.
    const home = healthy('ccrc-doctor-transcripts-no-roster-');
    writeTranscriptSession(home, 'sess-a', 'claude', join(home, 'projects', 'demo'), 'a'.repeat(36));
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^WARN transcripts: /);
    expect(line).toContain('roster projection');
    expect(runDoctor(home).code).toBe(0);
  });

  it('finds the transcript through the RAW spelling when the workdir is reached through a symlink and the resolved munge has nothing (cross-task hazard, Task 6 review)', () => {
    // `_transcript_path` and `_ci_addrs`/`_ci_extant` (ccd/ccd) both try the
    // REALPATH-resolved munge FIRST and the raw munge SECOND, because Claude
    // Code munges its own physical cwd while the registry keeps the path ccd
    // wrote. A doctor that only tried the raw spelling — or only the resolved
    // one — would measure a file ccd does not, on a box shaped like this one.
    const home = healthy('ccrc-doctor-transcripts-raw-spelling-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    // A `realpath` that RESOLVES (`-m`), or the two spellings collapse into one
    // and this test cannot tell them apart: macOS's own `realpath` has no `-m`,
    // so the check falls back to the raw path there (#189 round 2: measured — a
    // lookup at one spelling only stayed green on this fixture without it).
    const gnu = ['grealpath', 'realpath'].map((n) => spawnSync('bash', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim())
      .find((p) => p !== '' && spawnSync(p, ['-m', '/nonexistent/x'], { encoding: 'utf8' }).status === 0);
    if (gnu !== undefined) { rmSync(join(stubBin(home), 'realpath'), { force: true }); symlinkSync(gnu, join(stubBin(home), 'realpath')); }
    const real = join(home, 'volume', 'demo');
    const link = join(home, 'projects-link');
    mkdirSync(real, { recursive: true });
    symlinkSync(join(home, 'volume'), link);
    const wd = join(link, 'demo');   // resolves to <home>/volume/demo
    const uuidOld = 'a'.repeat(36), uuidNew = 'b'.repeat(36);
    writeTranscriptSession(home, 'sess-raw', 'claude', wd, uuidOld);
    // Written under the RAW (unresolved) munge only — nothing exists at the
    // resolved (`volume/demo`) spelling at all.
    writeTranscript(home, '.claude', wd, uuidOld,
      `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    writeTranscript(home, '.claude', wd, uuidNew, turnLine('after the fork'));   // also at the raw spelling only (DR2)
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^WARN transcripts: /);
    expect(line).toContain('sess-raw');
    expect(line).toContain('Claude Code has superseded');
  });

  it('says how many rows it could NOT look at, and never counts them clean (whole-branch review, F4)', () => {
    // The check tries the two DIRECT spellings and `continue`d on a miss —
    // while still counting that row into the number it then reported as
    // "every registry uuid names a transcript Claude Code has not
    // superseded". A swapped session's row therefore read as healthy with
    // nothing having measured it, which is why the server's own ladder has a
    // uuid-glob rung and a foreign-account rung at all: that miss is routine.
    //
    // Fixture: one row that CAN be measured and is clean, and one whose
    // transcript exists at NEITHER spelling — planted under a project
    // directory no munge of its workdir produces, the same "stranded" idiom
    // `transcript-ladder.test.ts` uses for the glob rungs. The verdict must
    // name both counts.
    const home = healthy('ccrc-doctor-transcripts-skipped-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    const wdOk = join(home, 'projects', 'measurable');
    const wdSwapped = join(home, 'projects', 'swapped-away');
    mkdirSync(wdOk, { recursive: true });
    mkdirSync(wdSwapped, { recursive: true });
    const uuidOk = 'a'.repeat(36), uuidSwapped = 'b'.repeat(36);
    writeTranscriptSession(home, 'sess-ok', 'claude', wdOk, uuidOk);
    writeTranscriptSession(home, 'sess-swapped', 'claude', wdSwapped, uuidSwapped);
    writeTranscript(home, '.claude', wdOk, uuidOk, turnLine('hello'));
    // The swapped row's transcript, at an address neither spelling names.
    const stranded = join(home, '.claude', 'projects', '-a-directory-no-munge-produces');
    mkdirSync(stranded, { recursive: true });
    writeFileSync(join(stranded, `${uuidSwapped}.jsonl`), turnLine('carried elsewhere'), 'utf8');

    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^PASS transcripts: /);
    expect(line, 'the measured count').toContain('1 session(s) measured');
    expect(line, 'and the count it could not look at').toContain('1 not measured');
    // The overclaim this finding is about: a run with skipped rows must not
    // say EVERY registry uuid is healthy, in those words.
    expect(line, 'never the unqualified claim')
      .not.toContain('every registry uuid names a transcript Claude Code has not superseded');
  });

  it('refuses a marker whose sessionId is present but not a valid 36-character value — absence permits, a malformed author does not', () => {
    // The review-round finding `_continued_in_of` (ccd/ccd) was fixed for:
    // extracting `claims` straight through `grep -oE` with no presence check
    // first cannot tell "absent" from "present but malformed" — both leave
    // the extraction empty, and absence-permits would then wave a garbled
    // authorship claim through as if nobody had claimed it. This plants a
    // `sessionId` that is present and short, so a naive reader treats it as
    // absent and (wrongly) still follows the pointer; the fixed reader must
    // refuse the whole marker instead, leaving this session a PASS.
    const home = healthy('ccrc-doctor-transcripts-malformed-author-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    const wd = join(home, 'projects', 'demo-malformed');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'a'.repeat(36), uuidNew = 'b'.repeat(36);
    writeTranscriptSession(home, 'sess-malformed', 'claude', wd, uuidOld);
    const badMarker = `${JSON.stringify({ type: 'continued-in', sessionId: 'not-a-real-uuid', continuedInSessionId: uuidNew })}\n`;
    writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before')}${badMarker}`);
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^PASS transcripts: 1 session\(s\)/);
    expect(out, 'the malformed author must not be waved through as stale').not.toMatch(/^WARN transcripts: /m);
  });

  // ── D-4940: the doctor reads the marker by the rule all three readers share
  it('counts a marker followed by the metadata Claude Code re-stamps at exit as superseded (D-4940)', () => {
    // Claude Code re-stamps last-prompt / ai-title records when its process
    // exits, and its own reader scans backwards past them. The old last-line
    // reader called this transcript live; ccd now follows it, so the doctor
    // must call it superseded until ccd has.
    const home = healthy('ccrc-doctor-transcripts-restamped-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    const wd = join(home, 'projects', 'restamped');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'a'.repeat(36), uuidNew = 'b'.repeat(36);
    writeTranscriptSession(home, 'sess-restamped', 'claude', wd, uuidOld);
    writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`
      + `${JSON.stringify({ type: 'last-prompt', lastPrompt: 'go on', sessionId: uuidOld })}\n`
      + `${JSON.stringify({ type: 'ai-title', aiTitle: 'a title', sessionId: uuidOld })}\n`);
    writeTranscript(home, '.claude', wd, uuidNew, turnLine('after the fork'));
    const line = lineFor(runDoctor(home).stdout, 'transcripts');
    expect(line).toMatch(/^WARN transcripts: /);
    expect(line).toContain('sess-restamped');
    expect(line).toContain('Claude Code has superseded');
  });

  it('never calls a session superseded over a marker-shaped object nested in a tool call (D-4940, review F1)', () => {
    const home = healthy('ccrc-doctor-transcripts-nested-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    const wd = join(home, 'projects', 'nested');
    mkdirSync(wd, { recursive: true });
    const uuidA = 'a'.repeat(36), uuidB = 'b'.repeat(36);
    writeTranscriptSession(home, 'sess-nested', 'claude', wd, uuidA);
    writeTranscript(home, '.claude', wd, uuidA, `${turnLine('call a tool')}${JSON.stringify({
      parentUuid: 'u-1',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__x__y',
        input: { type: 'continued-in', continuedInSessionId: uuidB } }], stop_reason: 'tool_use' },
      type: 'assistant', sessionId: uuidA,
    })}\n`);
    const line = lineFor(runDoctor(home).stdout, 'transcripts');
    expect(line).toMatch(/^PASS transcripts: 1 session\(s\)/);
  });

  // ── D-4941: a measurement the doctor did not make is never reported as one
  it.skipIf(process.getuid?.() === 0)('a transcript whose tail cannot be read is NOT MEASURED, never counted clean (D-4941, review F2)', () => {
    // The PR's own stale fixture, made unreadable. `_dr_continued_in` used to
    // fold the failed `tail` into "not superseded", and the row was counted
    // inside "every registry uuid names a transcript Claude Code has not
    // superseded" — a PASS over a transcript nobody had read, which here is
    // in fact superseded.
    const home = healthy('ccrc-doctor-transcripts-unreadable-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    const wd = join(home, 'projects', 'frozen-one');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-frozen', 'claude', wd, uuidOld);
    const f = writeTranscript(home, '.claude', wd, uuidOld,
      `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    chmodSync(f, 0o000);
    try {
      const line = lineFor(runDoctor(home).stdout, 'transcripts');
      expect(line).toMatch(/^PASS transcripts: 0 session\(s\) measured, 1 not measured/);
      expect(line, 'and it says why').toContain('could not be read');
      expect(line, 'never the unqualified claim')
        .not.toContain('every registry uuid names a transcript Claude Code has not superseded');
    } finally {
      chmodSync(f, 0o600);
    }
  });

  it('a box whose PATH has no `tail` measures nothing, and says so rather than passing every row (D-4941, review F2)', () => {
    const home = healthy('ccrc-doctor-transcripts-no-tail-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    // deliberately NO linkReal(home, 'tail')
    const wd = join(home, 'projects', 'frozen-one');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-frozen', 'claude', wd, uuidOld);
    writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    const line = lineFor(runDoctor(home).stdout, 'transcripts');
    expect(line).toMatch(/^PASS transcripts: 0 session\(s\) measured, 1 not measured/);
    expect(line).toContain('could not be read');
  });

  it('`_dr_continued_in` answers 2 for a failed read even when the file that sources it never set pipefail (D-4941)', () => {
    // `ccrc` sources this file under `set -uo pipefail`, so a whole-doctor run
    // cannot tell whether the reader sets it itself. Sourced bare here, with
    // no `tail` on the contained PATH: without its own `pipefail`, the failed
    // `tail` hides behind a jq that parsed nothing and the answer is 1.
    const home = healthy('ccrc-doctor-transcripts-bare-source-');
    const f = join(home, 'some.jsonl');
    writeFileSync(f, continuedInLine('a'.repeat(36), 'b'.repeat(36)));
    const r = spawnSync(BASH, ['-c',
      `. ${shq(join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks'))}; _dr_continued_in ${shq(f)} ${'a'.repeat(36)}; echo "rc=$?"`],
      { env: doctorEnv(home), encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('rc=2');
  });

  // ── D-4941: an unlistable registry is a FAIL, in the file's own idiom
  for (const [what, plant] of [
    ['searchable but not readable (0300)', (reg: string) => { chmodSync(reg, 0o300); }],
    ['readable but not searchable (0600)', (reg: string) => { chmodSync(reg, 0o600); }],
  ] as const) {
    it.skipIf(process.getuid?.() === 0)(`fails when the registry is ${what} (D-4941, review F3)`, () => {
      // The pre-scan's glob needs BOTH bits: without r it lists nothing,
      // without x it can stat nothing it lists — either way `any` stays 0 and
      // the check used to print the vacuous PASS over real, superseded rows.
      const home = healthy('ccrc-doctor-transcripts-mode-');
      seedAccountsSh(home, TRANSCRIPT_ROSTER);
      linkReal(home, 'tail');
      const wd = join(home, 'projects', 'frozen-one');
      mkdirSync(wd, { recursive: true });
      const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
      writeTranscriptSession(home, 'sess-frozen', 'claude', wd, uuidOld);
      writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
      const reg = join(home, '.cc-sessions');
      plant(reg);
      try {
        const line = lineFor(runDoctor(home).stdout, 'transcripts');
        expect(line).toMatch(/^FAIL transcripts: /);
        expect(line).toContain('not a readable, searchable directory');
      } finally {
        chmodSync(reg, 0o755);
      }
    });
  }

  it('fails when the registry path is a file, or a symlink to nothing (D-4941)', () => {
    for (const shape of ['file', 'dangling'] as const) {
      const home = healthy(`ccrc-doctor-transcripts-${shape}-`);
      seedAccountsSh(home, TRANSCRIPT_ROSTER);
      const reg = join(home, '.cc-sessions');
      // EXECUTABLE and readable, so only the not-a-directory test can catch it.
      if (shape === 'file') writeFileSync(reg, 'not a directory\n', { mode: 0o755 });
      else symlinkSync(join(home, 'gone'), reg);
      const out = runDoctor(home).stdout;
      const line = lineFor(out, 'transcripts');
      expect(line, shape).toMatch(/^FAIL transcripts: /);
      // The remedy must be one that CAN clear this FAIL (D-4941). `chmod`
      // cannot turn a file into a directory or give a dangling link a target,
      // so a mode remedy here sends the operator round in a loop.
      expect(line, shape).toContain('is not a directory');
      const remedy = out.split('\n')[out.split('\n').indexOf(line!) + 1];
      expect(remedy, shape).toMatch(/^ {2}remedy: /);
      expect(remedy, shape).not.toContain('chmod');
      expect(remedy, shape).toContain(`ls -ld ${reg}`);
    }
  });

  // ── D-4941: the remedy is honest for rows no supervisor ticks
  it('a superseded STOPPED or ARCHIVED row is told it will be followed at its next resume, not to restart anything (D-4941)', () => {
    // No `ccd supervise` ticks a stopped or archived row, so "clears itself on
    // the next supervise tick … roll the fleet box forward" could never come
    // true for one. ccd follows the chain when such a session is next resumed
    // (D-4944), and the remedy says so.
    const home = healthy('ccrc-doctor-transcripts-parked-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    const uuidNew = 'e'.repeat(36);
    const parked: [string, string, string][] = [['sess-stopped', 'stopped', 'a'.repeat(36)], ['sess-archived', 'archived', 'b'.repeat(36)]];
    for (const [id, stamp, uuid] of parked) {
      const wd = join(home, 'projects', id);
      mkdirSync(wd, { recursive: true });
      writeTranscriptSession(home, id, 'claude', wd, uuid);
      writeFileSync(join(home, '.cc-sessions', `${id}.${stamp}`), '');
      writeTranscript(home, '.claude', wd, uuid, `${turnLine('before the fork')}${continuedInLine(uuid, uuidNew)}`);
      writeTranscript(home, '.claude', wd, uuidNew, turnLine('after the fork'));   // written: a hop ccd would take (DR2)
    }
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^WARN transcripts: /);
    expect(line).toContain('sess-stopped');
    expect(line).toContain('sess-archived');
    const remedy = /^WARN transcripts: .*\n\s+remedy: (.*)$/m.exec(out)?.[1] ?? '';
    expect(remedy, out).toContain('next resume');
    expect(remedy, 'no restart is prescribed for a row nothing supervises').not.toMatch(/supervise tick|roll the fleet box forward/);
  });

  it('names live and parked superseded rows apart, each with its own remedy clause (D-4941)', () => {
    const home = healthy('ccrc-doctor-transcripts-mixed-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    const uuidNew = 'e'.repeat(36);
    for (const [id, uuid, stamp] of [['sess-live', 'a'.repeat(36), ''], ['sess-stopped', 'b'.repeat(36), 'stopped']] as const) {
      const wd = join(home, 'projects', id);
      mkdirSync(wd, { recursive: true });
      writeTranscriptSession(home, id, 'claude', wd, uuid);
      if (stamp !== '') writeFileSync(join(home, '.cc-sessions', `${id}.${stamp}`), '');
      writeTranscript(home, '.claude', wd, uuid, `${turnLine('before the fork')}${continuedInLine(uuid, uuidNew)}`);
      writeTranscript(home, '.claude', wd, uuidNew, turnLine('after the fork'));   // written: a hop ccd would take (DR2)
    }
    const out = runDoctor(home).stdout;
    const remedy = /^WARN transcripts: .*\n\s+remedy: (.*)$/m.exec(out)?.[1] ?? '';
    expect(remedy, out).toMatch(/sess-live.*supervise tick/);
    expect(remedy, out).toMatch(/sess-stopped.*next resume/);
  });

  // ── #189 review round 2 ───────────────────────────────────────────────────
  /** `_check_transcripts` alone, sourced the way `ccrc` sources it, under a
   *  deadline: a check that blocks in open(2) is one failed case, not a hung
   *  suite (and not a hung `ccrc install`/`ccrc update`, which run the doctor
   *  at their tail). */
  const runTranscripts = (home: string): { code: number; stdout: string; stderr: string; hung: boolean } => {
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks'))}; _check_transcripts`],
      { env: doctorEnv(home), encoding: 'utf8', timeout: 10000 });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', hung: r.error !== undefined || r.signal !== null };
  };
  /** One measurable, clean row beside the bad one, so a verdict is printed
   *  whatever the bad row does. */
  const goodRow = (home: string): void => {
    const wd = join(home, 'projects', 'good');
    mkdirSync(wd, { recursive: true });
    writeTranscriptSession(home, 'sess-good', 'claude', wd, 'a'.repeat(36));
    writeTranscript(home, '.claude', wd, 'a'.repeat(36), turnLine('hello'));
  };
  const badRow = (home: string): string => {
    const wd = join(home, 'projects', 'bad');
    mkdirSync(wd, { recursive: true });
    writeTranscriptSession(home, 'sess-bad', 'claude', wd, 'b'.repeat(36));
    writeTranscript(home, '.claude', wd, 'b'.repeat(36), turnLine('hello'));
    return join(home, '.cc-sessions');
  };

  for (const field of ['uuid', 'wrapper', 'workdir'] as const) {
    it(`a FIFO at a row's .${field} never blocks the check, and the row is counted apart (DR1)`, () => {
      const home = healthy(`ccrc-doctor-transcripts-fifo-${field}-`);
      seedAccountsSh(home, TRANSCRIPT_ROSTER);
      linkReal(home, 'tail');
      goodRow(home);
      const reg = badRow(home);
      rmSync(join(reg, `sess-bad.${field}`));
      execFileSync('mkfifo', [join(reg, `sess-bad.${field}`)]);
      const r = runTranscripts(home);
      expect(r.hung, 'the check blocked opening a FIFO').toBe(false);
      expect(r.stdout).toMatch(/^PASS transcripts: 1 session\(s\) measured, 1 not measured/m);
      expect(r.stdout).toContain('own registry row could not be read');
      expect(r.stdout, 'not the account-swap reason').not.toContain('at neither direct spelling');
      expect(r.stderr).toBe('');
    });
  }

  it('a .uuid that is a symlink to a device never blocks the check (DR1)', () => {
    const home = healthy('ccrc-doctor-transcripts-devlink-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    goodRow(home);
    const reg = badRow(home);
    rmSync(join(reg, 'sess-bad.uuid'));
    symlinkSync('/dev/zero', join(reg, 'sess-bad.uuid'));
    const r = runTranscripts(home);
    expect(r.hung).toBe(false);
    expect(r.stdout).toMatch(/^PASS transcripts: 1 session\(s\) measured, 1 not measured/m);
  });

  it.skipIf(process.getuid?.() === 0)('an unreadable .uuid prints nothing on stderr, and is not explained as an account swap (DR1)', () => {
    const home = healthy('ccrc-doctor-transcripts-mode000-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    goodRow(home);
    const reg = badRow(home);
    chmodSync(join(reg, 'sess-bad.uuid'), 0o000);
    try {
      const r = runTranscripts(home);
      expect(r.stderr).toBe('');
      expect(r.stdout).toContain('own registry row could not be read');
      expect(r.stdout).not.toContain('at neither direct spelling');
    } finally {
      chmodSync(join(reg, 'sess-bad.uuid'), 0o600);
    }
  });

  it('a row with no .wrapper (a `ccd forget` mid-walk) prints nothing on stderr, and is counted apart (DR1)', () => {
    const home = healthy('ccrc-doctor-transcripts-nowrapper-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    goodRow(home);
    const reg = badRow(home);
    rmSync(join(reg, 'sess-bad.wrapper'));
    const r = runTranscripts(home);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('own registry row could not be read');
  });

  it('a .uuid that is a DANGLING symlink is still a row — counted apart, never silently dropped (DR1, verifier D-V1)', () => {
    // The loop's guard is `-e || -L`: `-e` alone follows the link, finds
    // nothing, and the row vanished from the count — a PASS that says every
    // row was measured over a row nobody looked at.
    const home = healthy('ccrc-doctor-transcripts-dangling-uuid-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    goodRow(home);
    const reg = badRow(home);
    rmSync(join(reg, 'sess-bad.uuid'));
    symlinkSync(join(home, 'nowhere', 'gone.uuid'), join(reg, 'sess-bad.uuid'));
    const r = runTranscripts(home);
    expect(r.stdout).toMatch(/^PASS transcripts: 1 session\(s\) measured, 1 not measured/m);
    expect(r.stdout).toContain('own registry row could not be read');
    expect(r.stderr).toBe('');
  });

  it('a row whose .workdir is EMPTY is counted apart — not explained as an account swap (DR1, verifier D-V2)', () => {
    const home = healthy('ccrc-doctor-transcripts-empty-workdir-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    goodRow(home);
    const reg = badRow(home);
    writeFileSync(join(reg, 'sess-bad.workdir'), '');
    const r = runTranscripts(home);
    expect(r.stdout).toMatch(/^PASS transcripts: 1 session\(s\) measured, 1 not measured/m);
    expect(r.stdout).toContain('own registry row could not be read');
    expect(r.stdout, 'not the account-swap reason').not.toContain('at neither direct spelling');
  });

  it('a row whose wrapper the roster does not know is counted apart — not explained as an account swap (DR1, verifier D-V3)', () => {
    const home = healthy('ccrc-doctor-transcripts-unknown-wrapper-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    goodRow(home);
    const reg = badRow(home);
    writeFileSync(join(reg, 'sess-bad.wrapper'), 'claude-nosuch\n');
    const r = runTranscripts(home);
    expect(r.stdout).toMatch(/^PASS transcripts: 1 session\(s\) measured, 1 not measured/m);
    expect(r.stdout).toContain('own registry row could not be read');
    expect(r.stdout, 'not the account-swap reason').not.toContain('at neither direct spelling');
  });

  it('a marker whose successor was never written is NOT called superseded — it is named apart, with a remedy that can clear it (DR2)', () => {
    // ccd declines such a hop (D-4942) and a resume stays on the row's own
    // transcript (D-4944), so "roll the fleet box forward" and "the next
    // supervise tick" could never clear this WARN. 2.1.296 writes the marker
    // on its queued-for-later path too, and a worker killed before its first
    // line leaves the same state for good.
    const home = healthy('ccrc-doctor-transcripts-unwritten-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    const wd = join(home, 'projects', 'forked');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-forked', 'claude', wd, uuidOld);
    writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts') ?? '';
    expect(line, out).toMatch(/^WARN transcripts: /);
    expect(line).toContain(`names a successor never written here (sess-forked -> ${uuidNew} on claude)`);
    expect(line).not.toContain('Claude Code has superseded');
    const remedy = /^WARN transcripts: .*\n\s+remedy: (.*)$/m.exec(out)?.[1] ?? '';
    expect(remedy).toContain('first prompt it answers');
    expect(remedy).not.toMatch(/roll the fleet box forward|supervise tick|next resume/);
  });

  it('a successor that exists but is EMPTY is not one ccd would hop to either (DR2)', () => {
    const home = healthy('ccrc-doctor-transcripts-empty-successor-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    const wd = join(home, 'projects', 'forked');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-forked', 'claude', wd, uuidOld);
    writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    writeTranscript(home, '.claude', wd, uuidNew, '');
    const line = lineFor(runDoctor(home).stdout, 'transcripts') ?? '';
    expect(line).toContain('names a successor never written here');
  });

  it('a pending row on a lane that is not the default names ITS wrapper — `<wrapper> agents`, never `claude agents` (review round 3)', () => {
    // A background job lives under its own config dir's `jobs/`, so `claude
    // agents` on a `lane-b` row lists the DEFAULT config dir's agents: the
    // fork's starting job is not there, the operator concludes it "failed or
    // is gone", and the prompt they then send cancels the pointer while the
    // job is in fact still starting.
    const home = healthy('ccrc-doctor-transcripts-pending-lane-');
    seedAccountsSh(home, { version: 1, accounts: [
      ...TRANSCRIPT_ROSTER.accounts,
      { id: 'lane-b', label: 'lane-b', configDirSuffix: '.claude-lane-b',
        exec: { kind: 'generated', secretsFile: '.cc-secrets/lane-b-oauth.env' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    ] });
    linkReal(home, 'tail');
    const wd = join(home, 'projects', 'forked');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-forked', 'lane-b', wd, uuidOld);
    writeTranscript(home, '.claude-lane-b', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts') ?? '';
    expect(line, out).toContain(`(sess-forked -> ${uuidNew} on lane-b)`);
    const remedy = /^WARN transcripts: .*\n\s+remedy: (.*)$/m.exec(out)?.[1] ?? '';
    expect(remedy).toContain('`<wrapper> agents`');
    expect(remedy).not.toContain('claude agents');
  });

  it('SKIPs on a server-role box — it hosts no sessions, so a registry left behind is not measured (review round 3)', () => {
    // A box that changed role from fleet to server and kept its old registry
    // would otherwise be told to "roll the fleet box forward" about rows no
    // supervisor runs for — and a box with no registry would print a vacuous
    // clean PASS the README's server-role rule says is not printed.
    const home = healthy('ccrc-doctor-transcripts-server-');
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    const wd = join(home, 'projects', 'frozen');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-frozen', 'claude', wd, uuidOld);
    writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    writeTranscript(home, '.claude', wd, uuidNew, turnLine('after the fork'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP transcripts: this box records CCRC_ROLE=server, so it hosts no sessions/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) transcripts:/m);
  });
});


// ── update-sync: the EFFECT check, fix round 1 item 6 / review 155 C3 ─────
// `services` (above) measures the TIMER's own activation state, which stays
// `active` while its oneshot fails every run — this describe block is the
// ARTIFACT check that catches that, the identical shape `pool-sync` (above)
// is for its own sibling timer: `_upd_intent_state`'s own verdict on
// `~/.ccrc/update-intent`, never the timer's reported state. `healthy()`
// installs no `ccd-update-sync.timer` at all (see `HEALTHY_SKIPS`'s own
// docstring), so every test below plants the unit itself where the scenario
// needs a FLEET box, and the "no puller by configuration" SKIP is the one
// `healthy()` already proves on its own.
describe('ccrc doctor: update-sync', () => {
  it('SKIPs — no puller by configuration — on a box with no ccd-update-sync.timer installed at all', () => {
    const home = healthy('ccrc-doctor-update-sync-no-unit-');
    const line = lineFor(runDoctor(home).stdout, 'update-sync');
    expect(line).toBeUndefined();   // lineFor is PASS/WARN/FAIL only
    const any = anyVerdictFor(runDoctor(home).stdout, 'update-sync') ?? '';
    expect(any).toMatch(/^SKIP update-sync: /);
    expect(any).toContain('no puller here');
    expect(runDoctor(home).code).toBe(0);
  });

  itLinux('WARNs — not yet synced — when the timer was installed within its grace window and ~/.ccrc/update-intent has not been written yet', () => {
    const home = healthy('ccrc-doctor-update-sync-not-yet-synced-');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'active\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN update-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('update-sync-not-yet-synced');
    expect(lines[i]).toContain('has not been written yet');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(0);
  });

  itLinux('FAILs — never synced — when the timer was installed past its grace window and ~/.ccrc/update-intent has never been written', () => {
    const home = healthy('ccrc-doctor-update-sync-never-synced-');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'active\n');
    // Past the check's 120s grace window (two of the timer's own 60s
    // periods) — the "had its chance and still never synced" case, not the
    // fresh-install case above.
    const past = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(join(unitDirOf(home), unitFileOf('ccd-update-sync.timer')), past, past);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL update-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('update-sync-unreadable');
    expect(lines[i]).toContain('never synced');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(1);
  });

  itLinux('FAILs — stale — when the projection is past its lease, even though services still reports the timer active', () => {
    const home = healthy('ccrc-doctor-update-sync-stale-');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'active\n');
    plantUpdateIntent(home, { issued: 1, lease: 1 });   // 1970 — long past its lease
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL update-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('update-sync-stale');
    // `_upd_intent_state`'s own words (item 6's own instruction to reuse
    // them), not pool-sync's "past its lease" phrasing — this check never
    // re-derives its own verdict text.
    expect(lines[i]).toContain('its lease ended');
    // `services` still says the timer is fine — the exact false-PASS gap
    // this check exists to close, on the SAME box, in the SAME run.
    expect(lineFor(r.stdout, 'services')).toMatch(/^PASS services: /);
    expect(r.code).toBe(1);
  });

  itLinux('FAILs — malformed — when the timer is installed but the projection does not parse (never a WARN: this is the "every update refuses" class, not pool-sync\'s self-healing one)', () => {
    const home = healthy('ccrc-doctor-update-sync-malformed-');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'active\n');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'update-intent'), 'not a projection at all\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL update-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('update-sync-malformed');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(1);
  });

  itLinux('PASSes when the timer is installed and the projection is fresh', () => {
    const home = healthy('ccrc-doctor-update-sync-fresh-');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'active\n');
    plantUpdateIntent(home);
    const line = lineFor(runDoctor(home).stdout, 'update-sync') ?? '';
    expect(line).toMatch(/^PASS update-sync: /);
    expect(line).toContain('within its lease');
    expect(runDoctor(home).code).toBe(0);
  });

  // Batch E review fix round 1, M3: the remedy is `_upd_intent_say`'s own,
  // role-aware — never a hard-coded puller remedy. The one box where the
  // hard-coded remedy was wrong: a server/both box carrying a LEFTOVER
  // `ccd-update-sync.timer` file (a role changed after install — `CCRC_ROLE`
  // is seed-once). There `_upd_intent_state` answers `unreadable (absent)`,
  // never `never synced` (that WHY is the fleet/no-role arm's own), so this
  // check's grace window never applies and falls straight to FAIL with the
  // SERVER remedy, not the puller's.
  itLinux('a leftover ccd-update-sync.timer on a server/both box gets the SERVER remedy from _upd_intent_say, never the puller one (M3)', () => {
    const home = healthy('ccrc-doctor-update-sync-leftover-timer-');
    writeCcrcEnv(home, 'CCRC_FLEET=local\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\nCCRC_ROLE=server\n');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'active\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL update-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('update-sync-unreadable');
    expect(lines[i]).toContain('absent');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: ~\/\.ccrc\/update-intent is unreadable \(absent\) — restart ccrc\.service/);
    expect(lines[i + 1]).not.toContain('ccd-update-sync.service');
  });

  // Batch E review fix round 1, M4: the loaded-guard every sibling check
  // that calls a function declared in `ccrc` carries. Sourced bare (this
  // file alone, never `ccrc`), `_upd_intent_state` is undefined.
  it('says so, rather than guessing, when ccrc\'s own update-intent reader is not loaded', () => {
    const nowhere = join(REPO, 'no-such-home-for-check-update-sync');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; _check_update-sync`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL update-sync: ccrc's own update-intent reader is not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });
});


// ── the box's own config file ─────────────────────────────────────────────
// Stage 2d, Task 2, and the one check whose FAIL is a REPRODUCTION: a
// `CCRC_FLEET=remote` with no agent URL or token makes the server print one
// line and exit 1 at boot (server/src/index.ts#main). Before this check, that
// state was visible only as a service that would not come up.
//
// MUTATIONS MEASURED (applied to the shipped check, run, reverted):
//   - the `[ -r ]` guard deleted -> RED, "a ccrc.env it cannot READ is its own
//     answer…", `to match /^WARN config: .*cannot be read/`.
//   - the CCRC_AGENT_URL/TOKEN gap check deleted -> RED ×4, every "fails a
//     remote box where …" case (`expected -1 to be greater than -1` — no FAIL
//     line at all, i.e. the boot-refusal state passing).
//   - the mode classification made stricter than `config.ts` (`!= remote` ->
//     `-z "$mode"`, so any non-empty value reads as remote) -> RED ×2, "passes
//     a local box…" and "never quotes a value out of the file…".
//   - the absent-file WARN downgraded to a PASS -> RED, "warns, and names ccrc
//     install, when the box has no ccrc.env at all".
//   - D-86, fix round 1: the topology branch reverted (`if false`) -> RED,
//     "SKIPS an env-less FLEET-ROLE box…", `expected -1 to be greater than -1`
//     (the box gets the server-role WARN again — the finding itself).
//   - D-86: the `ccrc-agent.service` half of the conjunction dropped, so "no
//     ccrc.service" alone reads as the fleet role -> RED, "still WARNS a dev
//     checkout with no units at all…". BOTH halves are pinned, which is what
//     the branch's own comment claims.

describe('ccrc doctor: config', () => {
  it('warns, and names ccrc install, when the box has no ccrc.env at all', () => {
    const home = healthy('ccrc-doctor-config-none-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN config: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('defaults apply: local mode on 127.0.0.1:7788');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*ccrc install/);
    expect(runDoctor(home).code).toBe(0);
  });

  it('SKIPS an env-less FLEET-ROLE box rather than advising it to install a server', () => {
    // D-86, from the Task 2 review. THE LIVE FLEET HOST IS THIS FIXTURE: it has
    // no `ccrc.env` (this suite and `_check_fleet` both say so — it carries
    // `~/.ccrc/agent.env` instead), and `ccrc` ships there (deploy.sh (the ccrc install)), so
    // before the fix every doctor run on it printed "the server's defaults
    // apply: local mode on 127.0.0.1:7788" — about a server that does not run
    // there — with the remedy `ccrc install`, which is the single-box
    // SERVER-role installer. Wrong sentence and wrong instruction, on the one
    // box in the topology that has neither.
    //
    // The evidence is the unit-file topology `_check_services` already reads,
    // and nothing else: no new file, no new declaration, no guess.
    const home = healthy('ccrc-doctor-config-fleetrole-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    removeUnitFile(home, 'ccrc.service');
    writeUnitFile(home, 'ccrc-agent.service');
    writeFileSync(join(home, 'fixture-unit-ccrc-agent.service'), 'active\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('SKIP config: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccrc-agent.service');
    expect(lines[i]).toMatch(/no .*ccrc\.env/);
    // The SKIP contract, all three halves: no verdict line, NO REMEDY under it
    // (a remedy reads as "there is something here to fix", and there is not),
    // and the runner counts it against checks rather than verdicts.
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) config: /m);
    expect(lines[i + 1] ?? '').not.toMatch(/^ {2}remedy: /);
    expect(r.stdout).not.toMatch(/ccrc install/);
    // `fleet` skips on the same box for its own reason (no server address),
    // `auth` for a third (the session gate is the server's, and nothing on a
    // fleet host reads `~/.ccrc/auth.scrypt`), `build` for a fourth
    // (Stage 4, Task 9: no address means no server of its own to compare
    // against) — and `update-exposure` for a fifth (W4, design 2026-09-20
    // §12: a box with no server serves no update route to gate), so the
    // summary proves the runner accepted ALL FIVE skips.
    expect(r.stdout).toMatch(/^SKIP auth: .*ccrc-agent\.service/m);
    expect(r.stdout).toMatch(/^SKIP build: /m);
    expect(r.stdout).toMatch(/^SKIP update-exposure: .*ccrc-agent\.service/m);
    expect(r.stdout).toMatch(
      new RegExp(`^summary: \\d+ checks \\(${6 + HEALTHY_SKIPS} skipped\\)`, 'm'));
    expect(r.code).toBe(0);
  });

  it('still WARNS a dev checkout with no units at all — absence of units is not the fleet role', () => {
    // The other side of the same branch: "no ccrc.service" alone must not mean
    // "fleet host". A checkout that has never installed anything has no units
    // either, and for it the defaults sentence is exactly right.
    const home = healthy('ccrc-doctor-config-nounits-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    rmSync(unitDirOf(home), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN config: .*defaults apply/m);
    expect(r.stdout).not.toMatch(/^SKIP config: /m);
  });

  it.each([
    ['neither key is there', 'CCRC_FLEET=remote\n'],
    ['the URL is empty', 'CCRC_FLEET=remote\nCCRC_AGENT_URL=\nCCRC_AGENT_TOKEN=t0ken\n'],
    ['the token is empty', 'CCRC_FLEET=remote\nCCRC_AGENT_URL=ws://fleet.invalid:7789\nCCRC_AGENT_TOKEN=\n'],
    ['only the URL is set', 'CCRC_FLEET=remote\nCCRC_AGENT_URL=ws://fleet.invalid:7789\n'],
  ] as const)('fails a remote box where %s — the server exits at boot in exactly this state', (_what, text) => {
    // server/src/index.ts#main: `if (!cfg.agentUrl || !cfg.agentToken) … exit(1)`.
    // Both halves of that condition are reachable here, because "empty" and
    // "absent" are the same thing to `config.ts#loadConfig` and must be the same
    // thing here.
    const home = healthy(`ccrc-doctor-config-remote-${_what.replace(/\W+/g, '-')}-`);
    writeCcrcEnv(home, text);
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL config: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/CCRC_FLEET=remote/);
    expect(lines[i + 1]).toBe(
      '  remedy: set both CCRC_AGENT_URL and CCRC_AGENT_TOKEN in ~/.ccrc/ccrc.env, or set CCRC_FLEET=local');
    expect(runDoctor(home).code).toBe(1);
  });

  it('passes a coherent remote box — doctor judges the file, not the agent', () => {
    // Reachability is the `fleet` check's question and it has its own three
    // answers for it. This one asserts only what the file says, which is the
    // thing the server reads at boot.
    const home = healthy('ccrc-doctor-config-remote-ok-');
    writeCcrcEnv(home, [
      'CCRC_FLEET=remote',
      'CCRC_AGENT_URL=ws://fleet.invalid:7789',
      'CCRC_AGENT_TOKEN=ccrc-canary-agent-1f4d9',
      'CCRC_HOST=ccrc-fixture.invalid',
      'CCRC_PORT=7788',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'config') ?? '';
    expect(line).toMatch(/^PASS config: /);
    expect(line).toContain('fleet mode remote');
    // …and the token it had to READ to say so never reaches the terminal.
    expect(r.stdout).not.toContain('ccrc-canary-agent-1f4d9');
    expect(r.stderr).not.toContain('ccrc-canary-agent-1f4d9');
  });

  it('passes a local box, naming the mode it measured', () => {
    const home = healthy('ccrc-doctor-config-local-');
    expect(lineFor(runDoctor(home).stdout, 'config')).toMatch(/^PASS config: .*fleet mode local/);
  });

  it('reads an ABSENT CCRC_FLEET as local — the same default config.ts applies', () => {
    // `server/src/config.ts#loadConfig`: `env.CCRC_FLEET === 'remote' ? 'remote' : 'local'`.
    // A check stricter than the config reader would report a box that runs
    // perfectly well as misconfigured.
    const home = healthy('ccrc-doctor-config-nofleet-');
    writeCcrcEnv(home, 'CCRC_HOST=ccrc-fixture.invalid\nCCRC_PORT=7788\n');
    const line = lineFor(runDoctor(home).stdout, 'config') ?? '';
    expect(line).toMatch(/^PASS config: .*fleet mode local/);
    expect(line).toMatch(/CCRC_FLEET/);              // it says WHY local, rather than asserting a key that is not there
  });

  it('reads a value systemd would NOT set as absent, not as a mode', () => {
    // The same one-directional subset rule `_box_env_value`'s header states and
    // the fleet check pins for CCRC_HOST: `\vCCRC_FLEET=remote` is a line
    // systemd's EnvironmentFile parser does not turn into an environment
    // variable, so the server boots in LOCAL mode — and a reader that skipped
    // the \v anyway would demand agent credentials for a mode this box is not
    // in.
    const home = healthy('ccrc-doctor-config-vtab-');
    writeCcrcEnv(home, '\vCCRC_FLEET=remote\n');
    const line = lineFor(runDoctor(home).stdout, 'config') ?? '';
    expect(line).toMatch(/^PASS config: .*fleet mode local/);
  });

  it('never quotes a value out of the file — it holds the agent token', () => {
    const home = healthy('ccrc-doctor-config-secrets-');
    writeCcrcEnv(home, [
      'CCRC_FLEET=local',
      'CCRC_AGENT_TOKEN=ccrc-canary-token-77c1a',
      'CCRC_VAPID_PRIVATE=ccrc-canary-vapid-2e8b0',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'config')).toMatch(/^PASS config: /);
    for (const canary of ['ccrc-canary-token-77c1a', 'ccrc-canary-vapid-2e8b0']) {
      expect(r.stdout).not.toContain(canary);
      expect(r.stderr).not.toContain(canary);
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    'a ccrc.env it cannot READ is its own answer, and bash does not diagnose it on stderr', () => {
      // Without the `-r` guard the read fails, bash puts its own message on
      // stderr (which doctor deliberately does not capture) and every key comes
      // back empty — which is indistinguishable from a file that declares
      // nothing, i.e. a confident PASS on a box nobody measured.
      const home = healthy('ccrc-doctor-config-unreadable-');
      chmodSync(join(home, '.ccrc', 'ccrc.env'), 0o000);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^WARN config: .*cannot be read/m);
      expect(r.stdout).not.toMatch(/^PASS config: /m);
      expect(r.stderr).toBe('');
    });

  it('a ccrc.env that is not a regular file is its own answer too', () => {
    const home = healthy('ccrc-doctor-config-dir-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    mkdirSync(join(home, '.ccrc', 'ccrc.env'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN config: .*is not a regular file/m);
    expect(r.stdout).not.toMatch(/defaults apply/);   // that is the OTHER answer
    expect(r.stderr).toBe('');
  });

  it('says so, rather than guessing, when ccrc\'s own config reader is not loaded', () => {
    // D-85: the check reads `BOX_ENV_FILE` and `_box_env_value`, both declared
    // once in `ccrc` (ccrc:91-101 says outright that doctor is one of the three
    // readers that must not re-spell the path). Sourced by anything that is not
    // `ccrc`, it says that in a verdict line — the shape `_check_fleet` already
    // uses for the same absence — rather than re-implementing either.
    const nowhere = join(REPO, 'no-such-home-for-check-config');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; _check_config`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL config: ccrc's own config reader is not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });
});


describe('ccrc doctor: auth — the gate, and the passphrase it needs', () => {
  /** `CCRC_AUTH=<value>` appended to the fixture's own `ccrc.env` — the file
   *  the SERVER reads its environment from. Appended rather than rewritten so
   *  the other checks that read that file keep measuring what they measured. */
  const armGate = (home: string, value = 'on'): void => {
    const p = join(home, '.ccrc', 'ccrc.env');
    writeFileSync(p, `${readFileSync(p, 'utf8')}CCRC_AUTH=${value}\n`);
  };
  const authLine = (out: string): string => lineFor(out, 'auth') ?? '';

  // Wave 8 item D (decision D) correction: `healthy()`'s exposure file carries
  // CCRC_AUTH=on (`writeExposureEnv`, :769-790) — under the fix, `_check_auth`
  // reads the flag through `_box_unit_env`, which honours that file, so every
  // case below that expected the gate OFF while building on `healthy()` alone
  // was passing at main only on the live defect: the exposure file's
  // CCRC_AUTH=on did not arm the gate. `unexposedBox` is `unexposed()`'s own
  // recipe (the update-exposure describe below, :7145) copied here so a
  // "gate OFF" case is built on a box that really is unexposed.
  const unexposedBox = (prefix: string, env = 'CCRC_FLEET=local\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n'): string => {
    const home = healthy(prefix);
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    rmSync(join(home, '.ccrc', 'Caddyfile'), { force: true });
    rmSync(sysCaddyfile(home), { force: true });
    writeCcrcEnv(home, env);
    return home;
  };

  it('PASSES a box with no passphrase and the gate off — a fresh install ends GREEN', () => {
    // ── OPERATOR RULING (Task 9 review), amending the plan's own text ─────
    // This shipped as a WARN, faithfully to the plan. The operator overruled
    // it: `CCRC_AUTH` off with no passphrase is the state EVERY box ships in —
    // `ccrc install` writes no passphrase, by doctrine — so the warning ended
    // every clean install yellow, which trains an operator to skim past the
    // warnings that matter. The state is a fact about a box configured the way
    // the project ships it (`rc`'s rule), and the arming instructions ride the
    // DETAIL as next-steps text instead of a remedy.
    const home = unexposedBox('ccrc-doctor-auth-none-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: no passphrase file at .*\/\.ccrc\/auth\.scrypt/);
    // …and the line still says, out loud, that nothing is gated. A PASS that
    // read as "we are protected" would be worse than the WARN it replaced.
    expect(authLine(r.stdout)).toMatch(/nothing is gated/);
    expect(authLine(r.stdout)).toMatch(/ccrc passwd/);
    // A PASS owes no remedy line, and must not print one.
    expect(remedyFor(r.stdout, 'auth')).toBe('');
    expect(r.code).toBe(0);
  });

  it('names CCRC_RP_ID and CCRC_ORIGIN in the same breath as CCRC_AUTH', () => {
    // Task 8's finding, and the reason it has to be said by the CLI: with the
    // flag armed and those two wrong, every /ws/* upgrade and every non-exempt
    // write is refused from the real origin — and the server cannot warn about
    // it at boot, because behind `tailscale serve` it never learns the
    // hostname it is reached under. An operator who arms the flag from this
    // line alone would find out one tap at a time.
    const home = unexposedBox('ccrc-doctor-auth-rpid-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    const line = authLine(runDoctor(home).stdout);
    expect(line).toContain('CCRC_AUTH=on');
    expect(line).toContain('CCRC_RP_ID');
    expect(line).toContain('CCRC_ORIGIN');
  });

  it('FAILS when the gate is ARMED and there is no passphrase — the fail-shut state, made visible', () => {
    // `readAuthSecret` returning null with the flag on is Task 5's fail-SHUT
    // polarity: every route answers 401 `'unconfigured'` and no login can
    // succeed. The server logs one line at boot; this is the instrument that
    // reports it without reading a journal.
    const home = healthy('ccrc-doctor-auth-armed-none-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    armGate(home);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: .*CCRC_AUTH=on.*NO passphrase file/);
    expect(authLine(r.stdout)).toMatch(/failing SHUT|401/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/ccrc passwd/);
    expect(r.code).toBe(1);
  });

  it('PASSES an armed box with a usable passphrase, naming what it measured', () => {
    const home = healthy('ccrc-doctor-auth-armed-ok-');
    armGate(home);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: CCRC_AUTH=on/);
    // The detail is a MEASUREMENT, never the bare word "ok": the parameters
    // and the generation the reader really found in the file.
    expect(authLine(r.stdout)).toMatch(/N=\d+,r=\d+,p=\d+,gen=\d+/);
    expect(r.code).toBe(0);
  });

  it('PASSES a box with a passphrase and the gate OFF — and says nothing is gated yet', () => {
    // A PASS rather than a WARN: `CCRC_AUTH` off is the shipped default and a
    // legitimate state (`rc`'s rule — a doctor that WARNed here would be
    // asserting a preference). The detail is what stops the line reading as
    // "we are protected".
    const home = unexposedBox('ccrc-doctor-auth-unarmed-ok-');
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: .*holds a usable passphrase/);
    expect(authLine(r.stdout)).toMatch(/the gate is OFF \(CCRC_AUTH is not "on"/);
    expect(authLine(r.stdout)).toMatch(/no request is gated yet/);
    expect(r.code).toBe(0);
  });

  it('reads the flag from the unit\'s env files and NOT from the shell it was run in', () => {
    // The server's environment comes from `ccrc.service`'s `EnvironmentFile=`
    // lines, i.e. from `~/.ccrc/ccrc.env` then the exposure file. An exported
    // `CCRC_AUTH` in the operator's own shell arms nothing, and a check that
    // believed it would report a box that does not exist — here, a FAIL about
    // a fail-shut gate on a box whose gate is off.
    const home = unexposedBox('ccrc-doctor-auth-env-shell-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    const r = runDoctor(home, ['doctor'], { CCRC_AUTH: 'on' });
    expect(authLine(r.stdout)).toMatch(/^PASS auth: no passphrase file/);
    expect(r.code).toBe(0);
  });

  it('reads a value systemd would not set as OFF, exactly as config.ts does', () => {
    // `config.ts#loadConfig` is `env.CCRC_AUTH === 'on'` and nothing else. A check
    // laxer OR stricter than the reader it describes reports a box nobody is
    // running — `_check_config` pins the same rule for CCRC_FLEET.
    const home = unexposedBox('ccrc-doctor-auth-flagcase-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    // D-3824: `'on '` and `'"on"x'` LEFT this list. `'on '` was pinned OFF on a wrong premise — systemd hands `on` to the
    // server for `CCRC_AUTH=on ` (A1 below, which expects ARMED) — and `'"on"x'` is now case E8: this reader does not
    // model what either parser does after a closing quote, so it answers "not measured", never a value.
    for (const v of ['ON', 'true', 'yes']) {
      armGate(home, v);
      expect(authLine(runDoctor(home).stdout), v).toMatch(/^PASS auth: no passphrase file/);
      writeCcrcEnv(home, readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')
        .split('\n').filter((l) => !l.startsWith('CCRC_AUTH=')).join('\n'));
    }
  });

  it('FAILS on a file the server would refuse to boot on, and quotes NOT ONE BYTE of it', () => {
    // The boot-brick state. With the flag on, `buildServer`'s uncaught
    // `readAuthSecret` means the unit does not come up at all — which reaches
    // an operator as a dead service and a journal to read, unless something
    // measured it first.
    //
    // AND THE CONTENT NEVER APPEARS. `AuthSecretUnusable`'s message quotes the
    // FIELD it choked on — measured: `unknown prefix "<field 1>" (want
    // "scrypt")` — so a misplaced copy of some other secret would put its
    // bytes, verbatim, in a transcript that goes into a ticket. CLAUDE.md:
    // never print secret file CONTENTS. The fixture is exactly that shape.
    const home = healthy('ccrc-doctor-auth-garbled-');
    const planted = 'PLANTED-SECRET-9f3a2b';
    writeAuthSecret(home, `${planted}$b$c$d$e\n`);
    armGate(home);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: .*auth\.scrypt exists and this box cannot use it/);
    expect(authLine(r.stdout)).toMatch(/REFUSES TO BOOT/);
    expect(r.stdout).not.toContain(planted);
    expect(r.stderr).not.toContain(planted);
    // The remedy is the `mv`, because `ccrc passwd` REFUSES to overwrite a file
    // it cannot read (it cannot read the generation either, and inventing one
    // revalidates sessions instead of expiring them). A bare `ccrc passwd` here
    // would send an operator to a command that is about to refuse.
    // The session file is NAMED, absolutely, and resolved rather than assumed —
    // see the override case below.
    expect(remedyFor(r.stdout, 'auth'))
      .toMatch(/mv .*auth\.scrypt .*auth\.scrypt\.broken && rm -f .*sessions\.json && ccrc passwd/);
    expect(remedyFor(r.stdout, 'auth')).toContain(join(home, '.ccrc', 'sessions.json'));
    expect(r.code).toBe(1);
  });

  it('the remedy RESOLVES the session file, it does not hard-code it (D-148)', () => {
    // D-143's defect class, one key over. This remedy resolved the SECRET
    // through `_box_auth_path` and then printed a literal
    // `rm -f ~/.ccrc/sessions.json` beside it — so on a box that redirects
    // `CCRC_SESSIONS_PATH` it told the operator to delete a file nothing reads,
    // leaving the sessions that the fresh generation-1 secret is about to
    // REVALIDATE exactly where they were. Both paths now come from one
    // parameterised resolver, so they cannot disagree.
    const home = healthy('ccrc-doctor-auth-sessover-');
    writeAuthSecret(home, 'PLANTED-SECRET-4c1a$b$c$d$e\n');
    writeCcrcEnv(home, `${readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')
      }CCRC_SESSIONS_PATH=/srv/ccrc/sessions.json\n`);
    const remedy = remedyFor(runDoctor(home).stdout, 'auth');
    expect(remedy).toContain('rm -f /srv/ccrc/sessions.json');
    expect(remedy).not.toContain('.ccrc/sessions.json');
    expect(remedy).toContain('CCRC_SESSIONS_PATH');
  });

  it('names NO session file at all when CCRC_SESSIONS_PATH is relative', () => {
    // The `_box_auth_path` rule for a relative override, reached by the same
    // code: the server resolves it against systemd's working directory and this
    // tool against the operator's, so nothing on the box can say which file it
    // is. A remedy that guessed would delete something else.
    const home = healthy('ccrc-doctor-auth-sessrel-');
    writeAuthSecret(home, 'PLANTED-SECRET-4c1a$b$c$d$e\n');
    writeCcrcEnv(home, `${readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')
      }CCRC_SESSIONS_PATH=sessions.json\n`);
    const remedy = remedyFor(runDoctor(home).stdout, 'auth');
    expect(remedy).toContain("rm -f <this box's session file>");
    expect(remedy).toContain('RELATIVE');
    // …and it must not have fallen back to the default, which is the mistake
    // this arm exists to refuse.
    expect(remedy).not.toContain(join(home, '.ccrc', 'sessions.json'));
  });

  it('FAILS on the same file with the gate OFF too — a boot refusal waiting to happen', () => {
    // Same class, different tense, and the tense is in the detail: the box
    // works today, and the one command that arms it takes the server down.
    const home = unexposedBox('ccrc-doctor-auth-garbled-off-');
    writeAuthSecret(home, 'not a secret line at all\n');
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: /);
    expect(authLine(r.stdout)).toMatch(/the moment CCRC_AUTH=on is set, the server will refuse to boot/);
    expect(r.code).toBe(1);
  });

  it('never prints the salt or the hash out of a file it CAN read', () => {
    const home = healthy('ccrc-doctor-auth-quiet-');
    const r = runDoctor(home);
    const [, , salt, hash] = fixtureSecretLine().trim().split('$');
    expect(salt.length).toBeGreaterThan(10);
    expect(r.stdout).not.toContain(salt);
    expect(r.stdout).not.toContain(hash);
  });

  it('WARNS — not passes — when this box has no server build to read the file with', () => {
    // A dev checkout that never ran `npm run build`. The file is there and
    // nothing on this box can say whether it is usable, which is neither a
    // PASS (nothing was measured) nor a FAIL (nothing is known to be wrong).
    const home = healthy('ccrc-doctor-auth-nobuild-');
    // `dist/` only — `server/package.json` beside it is what the `node` check
    // reads its floor out of, and taking that away too would make this a test
    // about two checks at once.
    rmSync(join(home, 'ccrc', 'server', 'dist'), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^WARN auth: .*no server build/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/npm run build/);
    expect(r.code).toBe(0);
  });

  it('FAILS, naming the node check, when node is not on PATH', () => {
    // `_check_wrappers`' rule: a box with no node gets exactly one FAIL about
    // node itself, and every check that NEEDED it says which one to read
    // rather than inventing a second diagnosis of the same absence.
    const home = healthy('ccrc-doctor-auth-nonode-');
    unstub(home, 'node');
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: node is not on PATH/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/see the 'node' check above/);
  });

  it('FAILS, blaming ccrc, when the hasher did not ship beside it', () => {
    const home = healthy('ccrc-doctor-auth-nohelper-');
    rmSync(join(home, 'ccrc', 'deploy', 'gen-auth-hash.mjs'), { force: true });
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: the passphrase helper is missing/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/bug in ccrc/);
  });

  it('SKIPS on a FLEET-ROLE box — the gate belongs to the server, with no remedy', () => {
    // `_check_config`'s D-86 evidence, reused for the same reason: `ccrc` ships
    // to the fleet host, nothing there reads `~/.ccrc/auth.scrypt`, and a WARN
    // would send that operator to write a file no process will ever open. NO
    // REMEDY under a skip — there is nothing here to fix.
    const home = healthy('ccrc-doctor-auth-fleetrole-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    removeUnitFile(home, 'ccrc.service');
    writeUnitFile(home, 'ccrc-agent.service');
    writeFileSync(join(home, 'fixture-unit-ccrc-agent.service'), 'active\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('SKIP auth: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i + 1] ?? '').not.toMatch(/^ {2}remedy: /);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) auth: /m);
    expect(r.stdout).not.toMatch(/ccrc passwd/);
  });

  // ── CCRC_AUTH_SECRET_PATH: the override, and the silent no-op it would be ──
  // `config.ts#loadConfig` is `env.CCRC_AUTH_SECRET_PATH || <default>`, so a box can
  // redirect the gate's secret. A doctor that measured the DEFAULT on such a
  // box would report `PASS auth … gen=1` about a file nothing reads — right
  // after a `ccrc passwd` that wrote the same wrong file. An operator rotating
  // after a compromise would get a green transcript over a live, unchanged
  // secret. Both tools go through ONE resolver (`ccrc`'s `_box_auth_path`).

  it('MEASURES the overridden path, and says the redirect out loud', () => {
    const home = healthy('ccrc-doctor-auth-override-');
    const elsewhere = join(home, 'secrets', 'gate.scrypt');
    mkdirSync(join(home, 'secrets'), { recursive: true });
    writeFileSync(elsewhere, fixtureSecretLine(), { mode: 0o600 });
    // …and the DEFAULT path is deliberately left holding something unusable:
    // if the check were still reading it, this would be a FAIL, not a PASS.
    writeAuthSecret(home, 'not a secret line at all\n');
    writeCcrcEnv(home, `${readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')}CCRC_AUTH_SECRET_PATH=${elsewhere}\n`);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: /);
    expect(authLine(r.stdout)).toContain(elsewhere);
    expect(authLine(r.stdout)).toContain('CCRC_AUTH_SECRET_PATH');
    expect(r.code).toBe(0);
  });

  it('FAILS a RELATIVE override rather than guessing which file it means', () => {
    // `config.ts` does not resolve it either, so the server resolves it against
    // whatever working directory systemd gives ccrc.service and every tool
    // against its own. Nothing on the box can say which file the secret is, and
    // a verdict about "the secret" is not available.
    const home = healthy('ccrc-doctor-auth-relative-');
    writeCcrcEnv(home, `${readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')}CCRC_AUTH_SECRET_PATH=secrets/gate.scrypt\n`);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: .*RELATIVE path \(secrets\/gate\.scrypt\)/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/make it absolute/);
    expect(r.code).toBe(1);
  });

  it('an EMPTY override is absent, exactly as config.ts\'s `||` reads it', () => {
    // The bare-`KEY=` lesson (`accountsPath`, D-…): systemd sets an empty
    // string for `CCRC_AUTH_SECRET_PATH=`, and `||` falls through to the
    // default. A resolver using `??` would take the empty string as a path.
    const home = healthy('ccrc-doctor-auth-emptyoverride-');
    writeCcrcEnv(home, `${readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')}CCRC_AUTH_SECRET_PATH=\n`);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: /);
    expect(authLine(r.stdout)).toContain(join(home, '.ccrc', 'auth.scrypt'));
    expect(authLine(r.stdout)).not.toContain('CCRC_AUTH_SECRET_PATH');
  });

  // ── the two layers that keep a byte of the file off the screen ───────────
  // D-140 rests on TWO defences, and each one alone is enough to keep the suite
  // green while the other is deleted — which is how a defence-in-depth pair
  // quietly becomes a defence-in-depth single. Both are pinned here with a
  // STUB helper: the fixture's copy is replaced by a script that leaks
  // deliberately, so the check's own containment is what is under test.

  /** Replace the fixture's helper copy with a script of our own. */
  const stubHelper = (home: string, body: string): void =>
    writeFileSync(join(home, 'ccrc', 'deploy', 'gen-auth-hash.mjs'),
      `#!/usr/bin/env node\n${body}\n`, { mode: 0o644 });

  it('discards the helper\'s stderr — a leaky subprocess cannot print through this check', () => {
    const home = healthy('ccrc-doctor-auth-stderr-');
    const planted = 'LEAKED-VIA-STDERR-4b1c';
    stubHelper(home, `process.stderr.write(${JSON.stringify(planted)} + "\\n"); process.exit(4);`);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: /);      // the state still lands
    expect(r.stdout).not.toContain(planted);
    expect(r.stderr).not.toContain(planted);
  });

  it('refuses a state line it does not recognise instead of printing it', () => {
    // The second layer. `--check`'s stdout crosses into a verdict line a human
    // reads on a terminal that acts on control bytes, so it is pinned to a
    // shape rather than trusted — `_box_build_fields`' rule for the build
    // stamp's fields.
    const home = healthy('ccrc-doctor-auth-shape-');
    const planted = 'LEAKED-VIA-STDOUT-7c2d';
    stubHelper(home, `process.stdout.write(${JSON.stringify(planted)} + "\\n"); process.exit(0);`);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: the passphrase helper reported a state line this check does not recognise/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/bug in ccrc/);
    expect(r.stdout).not.toContain(planted);
  });

  it('names an exit code it does not understand as a bug in ccrc', () => {
    // `_check_wrappers` pins the same arm for the same reason: a code nobody
    // taught this check about must not fall through to one of the legal
    // answers.
    const home = healthy('ccrc-doctor-auth-badcode-');
    stubHelper(home, 'process.exit(9);');
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: reading .* exited 9 — this check does not know what that means/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/bug in ccrc/);
    expect(r.code).toBe(1);
  });

  it('a dev checkout with no units at all is NOT the fleet role — it still answers', () => {
    // The other side of that branch, exactly as `config` draws it: "no
    // ccrc.service" alone is also a box that has installed nothing, and a dev
    // checkout DOES run a server.
    const home = unexposedBox('ccrc-doctor-auth-nounits-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    rmSync(unitDirOf(home), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: no passphrase file/);
    expect(r.stdout).not.toMatch(/^SKIP auth: /m);
  });

  // ── wave 8 item D (decision D): the flag as ccrc.service actually gets it ─
  // The unit carries TWO EnvironmentFile lines, ccrc.env then the
  // exposure file, and the later one wins by PRESENCE — `_box_unit_env`,
  // shared with `_check_update-exposure` and install's gate line. D4–D6
  // below are D-3596's unreadable-exposure-file cases.

  it('D1: the exposure file OVERRIDES ccrc.env — CCRC_AUTH=off there does not disarm a box `ccrc expose` armed (the live defect this wave fixes)', () => {
    const home = healthy('ccrc-doctor-auth-exposure-wins-');
    writeCcrcEnv(home, `${readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')}CCRC_AUTH=off\n`);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: CCRC_AUTH=on/);
    expect(authLine(r.stdout)).toContain(join(home, '.ccrc', 'exposure.env'));
    expect(authLine(r.stdout)).toMatch(/logins are gated/);
    expect(r.code).toBe(0);
  });

  it('D2: a present-but-empty CCRC_AUTH= in the exposure file wins over ccrc.env=on — gate OFF, and the arming words name the file that decides it', () => {
    const home = unexposedBox('ccrc-doctor-auth-bare-exp-',
      'CCRC_FLEET=local\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\nCCRC_AUTH=on\n');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    writeFileSync(join(home, '.ccrc', 'exposure.env'), '# fixture — a hand-edited bare line\nCCRC_AUTH=\n');
    const r = runDoctor(home);
    const exp = join(home, '.ccrc', 'exposure.env');
    expect(authLine(r.stdout)).toMatch(/^PASS auth: /);
    expect(authLine(r.stdout)).toMatch(/the gate is OFF/);
    expect(authLine(r.stdout)).toContain(exp);
    expect(authLine(r.stdout)).toContain(`set CCRC_AUTH=on in ${exp}, which overrides`);
    expect(remedyFor(r.stdout, 'auth')).toBe('');
  });

  it('D3: an unexposed box with CCRC_AUTH=on in ccrc.env and no passphrase — the fail-shut FAIL, unaffected by item D', () => {
    const home = unexposedBox('ccrc-doctor-auth-d3-',
      'CCRC_FLEET=local\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\nCCRC_AUTH=on\n');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toBe(
      `FAIL auth: CCRC_AUTH=on in ${join(home, '.ccrc', 'ccrc.env')} and there is NO passphrase file at `
      + `${join(home, '.ccrc', 'auth.scrypt')} — the gate is armed and failing SHUT: every route answers `
      + '401 and no login can succeed');
    expect(r.code).toBe(1);
  });

  it.skipIf(process.getuid?.() === 0)(
    // Controller fix round 1: "one WARN auth, rc 2" is a COUNT, not just a
    // shape — a mutation that fired the block twice (once per flag-dependent
    // arm it guards) would still match `/^WARN auth: /` on the FIRST line
    // `lineFor` returns. `rc 2` itself is `_dr_warn`'s own return, pinned
    // generically elsewhere (the header's own "`_dr_warn` exists and returns
    // rc 2" measurement); the class this check answers with is WARN, and
    // that class is observable only through the verdict word on the line —
    // there is no separate "rc 2" annotation doctor prints per check.
    'D4: an exposure file that is there and cannot be read is UNMEASURED — one WARN, naming the file, with a usable passphrase', () => {
      const home = healthy('ccrc-doctor-auth-exp-unread-');
      chmodSync(join(home, '.ccrc', 'exposure.env'), 0o000);
      const r = runDoctor(home);
      const warnLines = r.stdout.split('\n').filter((l) => l.startsWith('WARN auth: '));
      expect(warnLines.length, r.stdout).toBe(1);
      expect(warnLines[0]).toContain(join(home, '.ccrc', 'exposure.env'));
      expect(warnLines[0]).toMatch(/was not measured/);
      expect(authLine(r.stdout)).toMatch(/^WARN auth: /);
      // Fix round 1 item 3 / review 196 F4: the verdict no longer claims which
      // file would have won — what the service manager does with an
      // unreadable exposure file was not measured, on either platform.
      expect(warnLines[0]).not.toContain('would win');
      expect(warnLines[0]).not.toContain('would have won');
      // …and the remedy no longer states the macOS-stops-the-job premise that
      // was wrong; it still points the operator at the file itself.
      expect(remedyFor(r.stdout, 'auth')).not.toContain('stops the server job');
      expect(remedyFor(r.stdout, 'auth')).toContain('ls -ld');
    });

  it.skipIf(process.getuid?.() === 0)(
    // Controller fix round 1: item D's rc-3 unmeasured block is UNPINNED by
    // D4/D5/D6 alone — all three keep an auth.scrypt, so deleting the rc-3
    // block (as opposed to the rc-0 one D4 already pins) never reds any of
    // them. This is the rc-3 twin: no passphrase file EITHER, same unreadable
    // exposure file — the false verdict item D exists to stop is exactly
    // "PASS auth: … the gate is OFF …" on a box whose real armed state
    // nothing here measured. Root reads through a chmod 000, so this case
    // cannot run as uid 0 — skipped there, not weakened.
    'D4b: the SAME unreadable exposure file with NO passphrase file either is still UNMEASURED — one WARN, never the false "gate is OFF" PASS', () => {
      const home = healthy('ccrc-doctor-auth-exp-unread-nofile-');
      chmodSync(join(home, '.ccrc', 'exposure.env'), 0o000);
      rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
      const r = runDoctor(home);
      const warnLines = r.stdout.split('\n').filter((l) => l.startsWith('WARN auth: '));
      expect(warnLines.length, r.stdout).toBe(1);
      expect(warnLines[0]).toContain(join(home, '.ccrc', 'exposure.env'));
      expect(warnLines[0]).toMatch(/was not measured/);
      expect(r.stdout).not.toMatch(/^PASS auth: /m);
    });

  it.skipIf(process.getuid?.() === 0)(
    'D5: the same unreadable exposure file with a GARBLED auth.scrypt is still a FAIL (rc 4 is flag-independent) — no WARN auth: line', () => {
      const home = healthy('ccrc-doctor-auth-exp-unread-garbled-');
      chmodSync(join(home, '.ccrc', 'exposure.env'), 0o000);
      writeAuthSecret(home, 'not a secret line at all\n');
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^FAIL auth: /);
      // rc 4's third tense (unmeasured=1): the armed-vs-unarmed wording
      // never applies here — neither ccrc.env nor the exposure file's
      // CCRC_AUTH is knowable, so the sentence hedges on the condition
      // itself rather than asserting either state.
      expect(authLine(r.stdout)).toContain('if CCRC_AUTH is on (');
      expect(r.stdout).not.toMatch(/^WARN auth: /m);
      // Fix round 1 item 3 / review 196 F4: the hedge no longer names the
      // exposure file as the one "which decides it" — which file would win
      // was never measured either.
      expect(authLine(r.stdout)).not.toContain('which decides it');
    });

  it.skipIf(process.getuid?.() === 0)(
    'D6: the same unreadable exposure file with the helper MISSING is still the helper FAIL — no WARN auth: line', () => {
      const home = healthy('ccrc-doctor-auth-exp-unread-nohelper-');
      chmodSync(join(home, '.ccrc', 'exposure.env'), 0o000);
      rmSync(join(home, 'ccrc', 'deploy', 'gen-auth-hash.mjs'), { force: true });
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^FAIL auth: the passphrase helper is missing/);
      expect(r.stdout).not.toMatch(/^WARN auth: /m);
    });

  it('D7: an unexposed box whose ccrc.env says CCRC_AUTH=off stays OFF even with CCRC_AUTH=on exported in doctor\'s own shell', () => {
    const home = unexposedBox('ccrc-doctor-auth-d7-',
      'CCRC_FLEET=local\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\nCCRC_AUTH=off\n');
    const r = runDoctor(home, ['doctor'], { CCRC_AUTH: 'on' });
    expect(authLine(r.stdout)).toMatch(/gate is OFF/);
    expect(authLine(r.stdout)).not.toMatch(/^FAIL auth: /);
  });

  // D8's model: `ccrc-doctor-core.test.ts`'s own update-sync case above
  // ("says so, rather than guessing, when ccrc's own update-intent reader is
  // not loaded") sources the check table WITHOUT ccrc's constants. This case
  // sources ccrc TOO (so `_box_unit_env`, `_box_auth_path` and
  // `_box_sessions_path` ARE declared), but strips the one thing the new
  // preflight also requires: `CCRC_EXPOSURE_FILE`.
  it('D8: sourced with ccrc\'s own functions loaded but no CCRC_EXPOSURE_FILE — "the config reader is not loaded" FAIL', () => {
    const nowhere = join(REPO, 'no-such-home-for-check-auth');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(CCRC_SRC)}; . ${shq(CHECKS_SRC)}; unset CCRC_EXPOSURE_FILE; _check_auth`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL auth: ccrc's own config reader is not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });

  // Fix round 1 item 4 / review 196 F5: `_check_auth`'s guard tests
  // `_box_unit_env` too (`:1282`). Unlike D8, this sources BOTH files intact
  // and removes only the FUNCTION, so every constant the guard also checks
  // stays present — a dropped `_box_unit_env` term is the only thing that can
  // red this pin. `BUE_VAL=on` is preset AFTER sourcing ccrc (a shell
  // assignment, never an env entry — `BUE_VAL=""`, the out-param block's first line above `_box_unit_env`, resets it at file scope
  // on load) in case some path through the ungoverned body reads it, but in
  // THIS harness (`PATH` pointing nowhere) it never gets the chance.
  // MEASURED (wave 9, R11-F2), with the guard's `|| ! declare -F _box_unit_env`
  // term dropped from a scratch copy of the checks file: the read
  // `_box_unit_env CCRC_AUTH || unmeasured=$?` runs the missing function
  // (bash prints `_box_unit_env: command not found` on stderr, rc 127 lands in
  // `unmeasured`), nothing between that read and the node check prints the
  // unmeasured state, and `_check_auth` prints `FAIL auth: node is not on PATH,
  // so the passphrase file could not be read` (the node check, `command -v node`
  // under `PATH` pointing nowhere) and returns 1 — never the not-measured WARN.
  // So it is the SPECIFIC regex below, not a stale-ARMED read, that makes this
  // pin red.
  it('the not-loaded guard also requires _box_unit_env — without that term the read\'s `command not found` (rc 127) is swallowed by `|| unmeasured=$?` and the node check FAILs instead, not this check’s own text', () => {
    const nowhere = join(REPO, 'no-such-home-for-check-auth-bue');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(CCRC_SRC)}; . ${shq(CHECKS_SRC)}; unset -f _box_unit_env; BUE_VAL=on; _check_auth`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL auth: ccrc's own config reader is not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });

  // ── wave 9 R10a/R10e (D-3822, D-3823, D-3824) ───────────────────────────
  // The flag as the unit's FEEDER hands it. Linux: systemd's `EnvironmentFile=`, which discards whitespace around an
  // unquoted value — modelled — and whose other quirks are not modelled but REPORTED as not measured. macOS: the
  // launchd job's `set -a; . file` under bash, where a file that is not plain assignments throughout (round-2 ruling
  // R-A) makes every key not measured. Cases marked `d` are the macOS twins of the Linux case before them and run on
  // macOS only (`itDarwin`); the Linux ones cannot run there for the platform's own reason.
  describe('wave 9 R10a/R10e — the flag as the unit\'s feeder hands it, and not measured where that cannot be decided', () => {
    const envPath = (home: string): string => join(home, '.ccrc', 'ccrc.env');
    const expPath = (home: string): string => join(home, '.ccrc', 'exposure.env');
    const readEnv = (home: string): string => readFileSync(envPath(home), 'utf8');
    /** The 1-based number of the LAST line of a file that ends in a newline. */
    const lastLineNo = (p: string): number => readFileSync(p, 'utf8').split('\n').length - 1;
    const editExposure = (home: string, f: (s: string) => string): void =>
      writeFileSync(expPath(home), f(readFileSync(expPath(home), 'utf8')));
    /** `unexposedBox`, no passphrase, then `CCRC_AUTH=<value>` appended — A1/E4/E6/E7/E8/E11/E12's box. */
    const noPassBox = (prefix: string, appended: string): string => {
      const home = unexposedBox(prefix);
      rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
      writeCcrcEnv(home, `${readEnv(home)}${appended}`);
      return home;
    };
    /** Exactly one `WARN auth` line, not measured, about `file` — and never a PASS or FAIL auth line. */
    const expectOneUndecidedWarn = (out: string, file: string): void => {
      const warns = out.split('\n').filter((l) => l.startsWith('WARN auth: '));
      expect(warns.length, out).toBe(1);
      expectUndecided(warns[0] ?? '', file);
      expect(out).not.toMatch(/^(PASS|FAIL) auth: /m);
    };

    // D-3824: `reads a value systemd would not set as OFF` once pinned `'on '` as OFF. systemd hands `on` to the
    // server for `CCRC_AUTH=on ` (it discards the whitespace), so that premise was wrong.
    itLinux('A1: whitespace around an UNQUOTED value is discarded, as systemd discards it — `on `, `on<tab>`, ` on` and `<tab>on ` all arm the gate', () => {
      const home = noPassBox('ccrc-doctor-auth-a1-', '');
      const base = readEnv(home);
      for (const v of ['on ', 'on\t', ' on', '\ton ']) {
        writeCcrcEnv(home, `${base}CCRC_AUTH=${v}\n`);
        const r = runDoctor(home);
        expect(authLine(r.stdout), JSON.stringify(v)).toMatch(/^FAIL auth: CCRC_AUTH=on in .*NO passphrase file/);
        expect(authLine(r.stdout), JSON.stringify(v)).toMatch(/failing SHUT/);
        expect(r.code, JSON.stringify(v)).toBe(1);
      }
    });

    // PLATFORM-ONLY: this is the macOS reader — the launchd job sources the file with `set -a; . file`, so bash's
    // rules decide the line, where on Linux systemd's EnvironmentFile= does (A1). Its Linux twin is A1.
    itDarwin('A1d: the same box on macOS — a trailing space or tab is dropped by bash (ARMED); a leading one makes the line a command, so not measured', () => {
      const home = noPassBox('ccrc-doctor-auth-a1d-', '');
      const base = readEnv(home);
      for (const v of ['on ', 'on\t']) {
        writeCcrcEnv(home, `${base}CCRC_AUTH=${v}\n`);
        const r = runDoctor(home);
        expect(authLine(r.stdout), JSON.stringify(v)).toMatch(/^FAIL auth: CCRC_AUTH=on in .*NO passphrase file/);
        expect(r.code, JSON.stringify(v)).toBe(1);
      }
      for (const v of [' on', '\ton ']) {
        writeCcrcEnv(home, `${base}CCRC_AUTH=${v}\n`);
        expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
        expect(authLine(runDoctor(home).stdout)).toContain(`${envPath(home)} line ${lastLineNo(envPath(home))} `);
      }
    });

    it('A2: the control — a QUOTED inner space stays, so `"on "` is not `on` and the gate is OFF (green at main, on both platforms)', () => {
      const home = noPassBox('ccrc-doctor-auth-a2-', 'CCRC_AUTH="on "\n');
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^PASS auth: no passphrase file/);
      expect(authLine(r.stdout)).toMatch(/the gate is OFF/);
      expect(r.code).toBe(0);
    });

    it('E1: the exposure file names the flag with spaces around `=` — one WARN, not measured, naming that file (main: a false ARMED PASS)', () => {
      const home = healthy('ccrc-doctor-auth-e1-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=on\n`);
      editExposure(home, (s) => s.replace('CCRC_AUTH=on\n', 'CCRC_AUTH = off\n'));
      const r = runDoctor(home);
      expectOneUndecidedWarn(r.stdout, expPath(home));
    });

    it('E2: a physical line ending in a backslash above the key line in the exposure file — not measured (main: a false ARMED PASS)', () => {
      const home = healthy('ccrc-doctor-auth-e2-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=off\n`);
      // ASCII-only comment: with the fixture's em-dash comment AND a line ending in a backslash the file is not measured
      // as a whole instead (D-3831, fix round 2 — E18); this case is about the per-key continuation.
      editExposure(home, (s) => s.replace('\u2014', '-').replace('CCRC_AUTH=on\n', 'FOO=bar \\\nCCRC_AUTH=on\n'));
      expectOneUndecidedWarn(runDoctor(home).stdout, expPath(home));
    });

    itLinux('E3: a key line after a comment ending in \\ is not measured — systemd before v254 continued it, v254+ does not, and the reader does not know which runs', () => {
      const home = healthy('ccrc-doctor-auth-e3-');
      editExposure(home, (s) => s.replace('CCRC_AUTH=on\n', '# a comment ending in a backslash \\\nCCRC_AUTH=on\n'));
      expectOneUndecidedWarn(runDoctor(home).stdout, expPath(home));
    });

    // PLATFORM-ONLY: bash ends a comment at the newline; systemd's EnvironmentFile= (E3) may continue it
    // after a backslash. The two readers disagree, so each has its own case. Its Linux twin is E3.
    itDarwin('E3d: the same files read gated on macOS — bash ends a comment at the newline, backslash or not (measured, bash 5.2)', () => {
      const home = healthy('ccrc-doctor-auth-e3d-');
      editExposure(home, (s) => s.replace('CCRC_AUTH=on\n', '# a comment ending in a backslash \\\nCCRC_AUTH=on\n'));
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^PASS auth: CCRC_AUTH=on in .*logins are gated/);
    });

    it('E4: `CCRC_AUTH = on` in ccrc.env, no passphrase — one WARN, not measured, naming ccrc.env (main: a false OFF PASS)', () => {
      const home = noPassBox('ccrc-doctor-auth-e4-', 'CCRC_AUTH = on\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    itLinux('E5: the control for precedence by presence — an undecidable ccrc.env LOSES to an exposure file that decides the key, as the second EnvironmentFile= does (green at main by accident)', () => {
      const home = healthy('ccrc-doctor-auth-e5-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH = on\n`);
      editExposure(home, (s) => s.replace('CCRC_AUTH=on\n', 'CCRC_AUTH=off\n'));
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^PASS auth: .*but the gate is OFF/);
      expect(authLine(r.stdout)).toContain(expPath(home));
      expect(r.stdout).not.toMatch(/^WARN auth: /m);
    });

    // PLATFORM-ONLY: the macOS reader is bash's `. file`, whose whole-file rule has no precedence over a
    // failing file; on Linux the second EnvironmentFile= wins by presence (E5). Its Linux twin is E5.
    itDarwin('E5d: the same files on macOS — the WHOLE-FILE rule has no precedence over a failing file: not measured, naming ccrc.env', () => {
      const home = healthy('ccrc-doctor-auth-e5d-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH = on\n`);
      editExposure(home, (s) => s.replace('CCRC_AUTH=on\n', 'CCRC_AUTH=off\n'));
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    itLinux('E6: `export CCRC_AUTH=on` in ccrc.env, no exposure file — not measured (systemd does not take `export`)', () => {
      const home = noPassBox('ccrc-doctor-auth-e6-', 'export CCRC_AUTH=on\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    // PLATFORM-ONLY: bash accepts `export NAME=value` as a plain assignment; systemd's EnvironmentFile=
    // does not take `export` (E6). The platforms differ by reader. Its Linux twin is E6.
    itDarwin('E6d: the same line on macOS — bash\'s `export NAME=value` is a plain assignment, so ARMED, and with no passphrase the gate FAILs shut', () => {
      const home = noPassBox('ccrc-doctor-auth-e6d-', 'export CCRC_AUTH=on\n');
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^FAIL auth: CCRC_AUTH=on in .*NO passphrase file/);
      expect(r.code).toBe(1);
    });

    it('E6b: the export arm\'s control — `export CCRC_AUTH_SECRET_PATH=…` is another key, so `CCRC_AUTH=off` after it is MEASURED (OFF), on both platforms', () => {
      const missing = join(mkTmp('ccrc-doctor-auth-e6b-secret-'), 'no-such-secret');
      const home = unexposedBox('ccrc-doctor-auth-e6b-');
      writeCcrcEnv(home, `${readEnv(home)}export CCRC_AUTH_SECRET_PATH=${missing}\nCCRC_AUTH=off\n`);
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^PASS auth: /);
      expect(authLine(r.stdout)).toMatch(/the gate is OFF/);
      expect(authLine(r.stdout)).not.toContain('was not measured');
    });

    it('E7: `CCRC_AUTH="o\\"n"` — an escaped quote inside the value — is not measured', () => {
      const home = noPassBox('ccrc-doctor-auth-e7-', 'CCRC_AUTH="o\\"n"\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    it('E8: `CCRC_AUTH="on"x` — text after a closing quote, the value that left the `reads a value systemd would not set as OFF` list — is not measured (main: PASS OFF)', () => {
      const home = noPassBox('ccrc-doctor-auth-e8-', 'CCRC_AUTH="on"x\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    it('E9: an unclosed double quote that may swallow the key line — not measured, naming the exposure file (main: a false ARMED)', () => {
      const home = healthy('ccrc-doctor-auth-e9-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=off\n`);
      writeFileSync(expPath(home), 'CCRC_ORIGIN="https://x\nCCRC_AUTH=on\nCCRC_RP_ID=x\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, expPath(home));
    });

    it('E10: a single-quoted value spanning lines may swallow the key line — not measured (main: a false ARMED)', () => {
      const home = healthy('ccrc-doctor-auth-e10-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=off\n`);
      writeFileSync(expPath(home), "FOO='a\nCCRC_AUTH=on\n'\n");
      expectOneUndecidedWarn(runDoctor(home).stdout, expPath(home));
    });

    it('E11: an unquoted escape — `CCRC_AUTH=o\\n` (systemd reads `on`) — is not measured (main: PASS OFF)', () => {
      const home = noPassBox('ccrc-doctor-auth-e11-', 'CCRC_AUTH=o\\n\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    it('E12: a trailing unpaired quote — `CCRC_AUTH=on"` — is not measured', () => {
      const home = noPassBox('ccrc-doctor-auth-e12-', 'CCRC_AUTH=on"\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    itDarwin('E13: the round-2 attack\'s readonly shape — `readonly CCRC_AUTH` in ccrc.env keeps `off` against the exposure file\'s `on` — is not measured, naming ccrc.env line 2 of the failing shape, never the exposure file\'s PASS', () => {
      const home = healthy('ccrc-doctor-auth-e13-');
      const base = readEnv(home);
      writeCcrcEnv(home, `${base}CCRC_AUTH=off\nreadonly CCRC_AUTH\n`);
      const r = runDoctor(home);
      expectOneUndecidedWarn(r.stdout, envPath(home));
      expect(authLine(r.stdout)).toContain(`${envPath(home)} line ${base.split('\n').length + 1} `);
    });

    itLinux('E13l: the control — the same files read gated on Linux (systemd ignores a line with no `=`, and the exposure file wins by presence)', () => {
      const home = healthy('ccrc-doctor-auth-e13l-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=off\nreadonly CCRC_AUTH\n`);
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^PASS auth: CCRC_AUTH=on in .*logins are gated/);
      expect(authLine(r.stdout)).toContain(expPath(home));
    });

    // PLATFORM-ONLY: this is systemd's EnvironmentFile= reading — it discards a CR. The macOS reader is
    // bash's `. file`, which keeps it, so that platform's answer differs. Its macOS twin is E14d.
    itLinux('E14: a CR in the OTHER file is discarded by systemd — `CCRC_AUTH=on` in ccrc.env still arms, and with no passphrase the gate FAILs shut, as at main', () => {
      const home = healthy('ccrc-doctor-auth-e14-');
      rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=on\n`);
      writeFileSync(expPath(home), 'CCRC_RP_ID=x\r\n');
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^FAIL auth: CCRC_AUTH=on in .*NO passphrase file/);
      expect(r.code).toBe(1);
    });

    // PLATFORM-ONLY: bash's `. file` keeps a CR in the value; systemd's EnvironmentFile= discards it
    // (E14). The platforms differ by reader. Its Linux twin is E14.
    itDarwin('E14d: the same files on macOS — bash keeps a CR in the exposure file\'s value, so not measured, naming the exposure file line 1', () => {
      const home = healthy('ccrc-doctor-auth-e14d-');
      rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=on\n`);
      writeFileSync(expPath(home), 'CCRC_RP_ID=x\r\n');
      const r = runDoctor(home);
      expectOneUndecidedWarn(r.stdout, expPath(home));
      expect(authLine(r.stdout)).toContain(`${expPath(home)} line 1 `);
    });

    // ── wave 9 R10a (D-3831): a FILE systemd would split or skip whole ──────────────
    // Review found three shapes the Linux reader DECIDED (rc 0, `on`) while systemd hands the server something else: a
    // carriage return inside a line (systemd's NEWLINE is "\n\r", so a bare CR ends a line), a NUL byte (the file is
    // unreadable to systemd, and both EnvironmentFile= lines are `-`-prefixed, so it is skipped whole), and a byte that
    // is not valid UTF-8 in a key or value (the file fails). Each is written byte for byte (latin1).
    /** `[label, the lines that follow `CCRC_AUTH=…`'s own decider, the phrase BUE_WHY must carry]`. */
    const WHOLE_FILE: Array<[string, (decider: string) => string, string]> = [
      ['a CR inside a line', (d) => `# c\rX=1\r${d}\r\n`, 'carriage return inside a line'],
      ['a NUL byte', (d) => `CCRC_RP_ID=x\0y\n${d}\n`, 'NUL byte'],
      ['a byte that is not valid UTF-8 in a value', (d) => `CCRC_RP_ID=x\xff\n${d}\n`, 'non-ASCII byte in a NAME=value line'],
    ];
    const expectWholeFileWarn = (out: string, file: string, phrase: string, label: string): void => {
      const warns = out.split('\n').filter((l) => l.startsWith('WARN auth: '));
      expect(warns.length, `${label}\n${out}`).toBe(1);
      expect(warns[0], label).toContain(file);
      expect(warns[0], label).toContain(phrase);
      expect(warns[0], label).toContain('was not measured');
      expect(warns[0], label).not.toContain('cannot be read');
      expect(out, label).not.toMatch(/^(PASS|FAIL) auth: /m);
    };

    // PLATFORM-ONLY: splitting or skipping a file whole on a CR, NUL or non-UTF-8 byte is systemd's
    // EnvironmentFile= behaviour. bash's `. file` splits on none of them and checks no UTF-8. A NUL it neither splits on
    // nor skips: the launchd job's /bin/bash 3.2 stops reading the file at its first NUL (bash 5.2 strips each NUL
    // instead — measured, and why an earlier comment here said "neither"). The macOS whole-file cases are E5d, E14d and
    // E19d (a NUL, D-3832).
    itLinux('E15: the EXPOSURE file is split or skipped whole by systemd — ccrc.env says `on`, the exposure file `off` (or a key the reader would have decided) — not measured, never a false ARMED (main: `on`)', () => {
      for (const [label, shape, phrase] of WHOLE_FILE) {
        const home = healthy('ccrc-doctor-auth-e15-');
        writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=on\n`);
        writeFileSync(expPath(home), shape('CCRC_AUTH=off'), 'latin1');
        expectWholeFileWarn(runDoctor(home).stdout, expPath(home), phrase, label);
      }
    });

    // PLATFORM-ONLY: splitting or skipping a file whole on a CR, NUL or non-UTF-8 byte is systemd's
    // EnvironmentFile= behaviour; bash's `. file` does neither (a NUL truncates the file under /bin/bash 3.2 — E15's
    // comment). Its pair is E15; the macOS whole-file cases are E5d, E14d and E19d.
    itLinux('E16: ccrc.env is split or skipped whole by systemd — with the flag on in it and no exposure file, not measured, never a false OFF or ARMED (main: a false OFF for a CR, a false ARMED for NUL and non-UTF-8)', () => {
      for (const [label, shape, phrase] of WHOLE_FILE) {
        const home = noPassBox('ccrc-doctor-auth-e16-', '');
        writeFileSync(envPath(home), `${readEnv(home)}${shape('CCRC_AUTH=on')}`, 'latin1');
        expectWholeFileWarn(runDoctor(home).stdout, envPath(home), phrase, label);
      }
    });

    itLinux('E18: a comment-looking line inside a value that may span lines is part of that VALUE, and systemd UTF-8-checks it — the exemption is off for the whole file, so a decided key is not answered (main and round 1: a false ARMED, and a false OFF)', () => {
      // false ARMED: ccrc.env carries no key; the exposure file `decides` `on` before a quote that may span lines.
      const armed = healthy('ccrc-doctor-auth-e18a-');
      writeFileSync(expPath(armed), 'CCRC_AUTH=on\r\n"\nFOO=\'a\n # \xff\n', 'latin1');
      expectWholeFileWarn(runDoctor(armed).stdout, expPath(armed), 'non-ASCII byte in a NAME=value line', 'false ARMED');
      // false OFF: ccrc.env says `on`; the exposure file `decides` off, and systemd skips it whole.
      const off = healthy('ccrc-doctor-auth-e18b-');
      writeCcrcEnv(off, `${readEnv(off)}CCRC_AUTH=on\n`);
      writeFileSync(expPath(off), 'CCRC_AUTH=off\nFOO="a\n\r\n # \xff\n', 'latin1');
      expectWholeFileWarn(runDoctor(off).stdout, expPath(off), 'non-ASCII byte in a NAME=value line', 'false OFF');
    });

    // PLATFORM-ONLY: the launchd job's /bin/bash 3.2 stops reading a file at its first NUL byte (`_evalfile` hands it to
    // the parser as a C string), so the job never sets what follows it. Its Linux pair is E15's NUL row (systemd skips the
    // file whole); the reader table U4 runs both readers on every platform.
    itDarwin('E19d: a NUL byte anywhere in the exposure file on macOS — above the key, inside its value, or in a comment above it — is not measured, naming the file and the NUL, never a PASS ARMED (D-3832; f74f5e90: PASS, the gate off)', () => {
      const shapes: Array<[string, string]> = [
        ['a NUL at the end of a line above the key', 'X=1\0\nCCRC_AUTH=on\n'],
        ['a NUL inside the value', 'CCRC_AUTH=o\0n\n'],
        ['a NUL in a comment above the key', '# c\0\nCCRC_AUTH=on\n'],
      ];
      for (const [label, bytes] of shapes) {
        const home = healthy('ccrc-doctor-auth-e19d-');
        writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=off\n`);
        writeFileSync(expPath(home), bytes, 'latin1');
        const r = runDoctor(home);
        expectWholeFileWarn(r.stdout, expPath(home), 'NUL byte', label);
        expect(r.stdout, label).not.toMatch(/^PASS update-exposure: .*CCRC_AUTH=on/m);
      }
    });

    itLinux('E17: the control — a valid UTF-8 em dash in a COMMENT of the exposure file reads ARMED as before (the real writer\'s own first line carries one)', () => {
      const home = healthy('ccrc-doctor-auth-e17-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=off\n`);
      writeFileSync(expPath(home), '# a comment with an em dash \xe2\x80\x94 in it\nCCRC_AUTH=on\n', 'latin1');
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^PASS auth: CCRC_AUTH=on in .*logins are gated/);
      expect(r.stdout).not.toMatch(/^WARN auth: /m);
    });

    // ── the reader itself, as tables ─────────────────────────────────────
    // [label, file bytes, [stdout, rc] at MAIN (two-argument, `_box_env_value f CCRC_AUTH`), [stdout, rc] in `unit` mode]
    // The `main` column was CAPTURED from a copy of `ccd/ccrc` at the merge base, in a scratch tree, before the
    // function was touched: it is what 45 callers must keep reading, byte for byte.
    const SHAPES: Array<[string, string, [string, number], [string, number]]> = [
      ['A1 trailing space', 'CCRC_AUTH=on \n', ['on ', 0], ['on', 0]],
      ['A1 trailing tab', 'CCRC_AUTH=on\t\n', ['on\t', 0], ['on', 0]],
      ['A1 leading space in value', 'CCRC_AUTH= on\n', [' on', 0], ['on', 0]],
      ['A1 leading tab and trailing space', '\tCCRC_AUTH=on \n', ['on ', 0], ['on', 0]],
      ['A1 indented key and tab', ' CCRC_AUTH=\ton\n', ['\ton', 0], ['on', 0]],
      ['A2 quoted inner space', 'CCRC_AUTH="on "\n', ['on ', 0], ['on ', 0]],
      ['E1 spaced key', 'CCRC_AUTH = off\n', ['', 1], ['', 2]],
      ['E2 continuation above', 'FOO=bar \\\nCCRC_AUTH=on\n', ['on', 0], ['', 2]],
      ['E3 comment continuation above', '# c \\\nCCRC_AUTH=on\n', ['on', 0], ['', 2]],
      ['E6 export', 'export CCRC_AUTH=on\n', ['', 1], ['', 2]],
      ['E6b export of another key', 'export CCRC_AUTH_SECRET_PATH=/x/y\nCCRC_AUTH=off\n', ['off', 0], ['off', 0]],
      ['E7 escaped quote', 'CCRC_AUTH="o\\"n"\n', ['o\\"n', 0], ['', 2]],
      ['E8 text after a closing quote', 'CCRC_AUTH="on"x\n', ['"on"x', 0], ['', 2]],
      ['E9 open double quote above', 'CCRC_ORIGIN="https://x\nCCRC_AUTH=on\nCCRC_RP_ID=x\n', ['on', 0], ['', 2]],
      ['E10 open single quote above', 'FOO=\'a\nCCRC_AUTH=on\n\'\n', ['on', 0], ['', 2]],
      ['E11 unquoted escape', 'CCRC_AUTH=o\\n\n', ['o\\n', 0], ['', 2]],
      ['E12 trailing unpaired quote', 'CCRC_AUTH=on"\n', ['on"', 0], ['', 2]],
      ['E13 readonly line', 'CCRC_AUTH=off\nreadonly CCRC_AUTH\n', ['off', 0], ['off', 0]],
      ['E14 CR on another line', 'CCRC_AUTH=on\nCCRC_RP_ID=x\r\n', ['on', 0], ['on', 0]],
      ['CR after value', 'CCRC_AUTH=on\r\n', ['on', 0], ['on', 0]],
      // D-3831: after ONE trailing CR is stripped a CR still inside the line makes the file undecidable (`unit` mode).
      ['two CRs after value', 'CCRC_AUTH=v\r\r\n', ['v\r', 0], ['', 2]],
      ['one CR after value', 'CCRC_AUTH=v\r\n', ['v', 0], ['v', 0]],
      ['no trailing newline', 'CCRC_AUTH=on', ['on', 0], ['on', 0]],
      ['bare key', 'CCRC_AUTH=\n', ['', 0], ['', 0]],
      ['single-quoted', 'CCRC_AUTH=\'on\'\n', ['on', 0], ['on', 0]],
      ['double-quoted inner space', 'CCRC_AUTH="o n"\n', ['o n', 0], ['o n', 0]],
      ['longer key', 'CCRC_AUTHX=on\n', ['', 1], ['', 1]],
      ['last wins', 'CCRC_AUTH=off\nCCRC_AUTH=on\n', ['on', 0], ['on', 0]],
      ['one-char quote value', 'CCRC_AUTH="\n', ['"', 0], ['', 2]],
      ['empty quote pair', 'CCRC_AUTH=""\n', ['', 0], ['', 0]],
      ['absent key', 'FOO=1\n', ['', 1], ['', 1]],
      // Wave 9 R10a (D-3831): a file systemd would split or skip whole. `main` is again captured from the merge-base
      // copy (two-argument reads are untouched); the `unit` column is rc 2 for a carriage return inside a line, a NUL
      // byte anywhere, and a byte >= 0x80 in a non-comment line — and the two controls, whose only non-ASCII is a COMMENT,
      // read as before. Every row is written byte for byte (latin1), so `\xff` is one invalid-UTF-8 byte.
      ['W CR mid-line, key after it', 'X=1\rCCRC_AUTH=off\r\n', ['', 1], ['', 2]],
      ['W CR mid-line in a comment', '# c\rCCRC_AUTH=off\r\n', ['', 1], ['', 2]],
      ['W NUL in another line', 'CCRC_RP_ID=x\0y\nCCRC_AUTH=on\n', ['on', 0], ['', 2]],
      ['W invalid UTF-8 in another value', 'CCRC_RP_ID=x\xff\nCCRC_AUTH=on\n', ['on', 0], ['', 2]],
      ['W invalid UTF-8 in the key line', 'CCRC_AUTH=\xff\n', ['\xff', 0], ['', 2]],
      ['W valid UTF-8 in a value (a cost, never a false answer)', 'CCRC_RP_ID=\xc3\xa9\nCCRC_AUTH=on\n', ['on', 0], ['', 2]],
      ['W control: a valid UTF-8 em dash in a comment', '# a \xe2\x80\x94 b\nCCRC_AUTH=on\n', ['on', 0], ['on', 0]],
      ['W control: a non-ASCII comment after the key', 'CCRC_AUTH=on\n; \xe2\x80\x94\n', ['on', 0], ['on', 0]],
      // D-3831, fix round 2: the comment exemption is OFF for a whole file in which a non-comment line ends in a
      // backslash or carries a quote that is not one whole pair — systemd is then not in its key state on a later
      // "comment", it is inside a VALUE, and UTF-8-checks it. A quote that IS one whole pair changes nothing.
      ['W comment high byte inside a double-quoted value that spans lines', 'CCRC_AUTH=on\nX="a\n# \xff\n"\n', ['on', 0], ['', 2]],
      ['W comment high byte inside a single-quoted value that spans lines', 'CCRC_AUTH=on\nX=\'a\n# \xff\n\'\n', ['on', 0], ['', 2]],
      ['W comment high byte after an unquoted value ending in a backslash', 'CCRC_AUTH=on\nX=a\\\n# \xff\n', ['on', 0], ['', 2]],
      ['W comment high byte BEFORE a value that may span lines (the whole file, conservatively)', '# \xff\nCCRC_AUTH=on\nX="a\n"\n', ['on', 0], ['', 2]],
      ['W control: a quote that is one whole pair does not turn the exemption off', 'X="a"\n# \xff\nCCRC_AUTH=on\n', ['on', 0], ['on', 0]],
    ];
    /** `_box_env_value <file> CCRC_AUTH [mode]` over every shape: stdout and rc, read back through files. */
    const readShapes = (mode: string): Array<[string, number]> => {
      const dir = mkTmp('ccrc-doctor-shapes-');
      SHAPES.forEach(([, content], i) => writeFileSync(join(dir, `f${i}`), content, 'latin1'));
      const script = [
        'set -uo pipefail', `. ${shq(CCRC_SRC)}`,
        `for ((i=0;i<${SHAPES.length};i++)); do _box_env_value ${shq(dir)}/f$i CCRC_AUTH ${mode} > ${shq(dir)}/o$i; echo $? > ${shq(dir)}/c$i; done`,
      ].join('\n');
      const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8', env: { HOME: dir, PATH: join(dir, 'no-bin'), LC_ALL: 'C' } });
      expect(r.status, r.stderr).toBe(0);
      return SHAPES.map((_, i): [string, number] =>
        [readFileSync(join(dir, `o${i}`), 'latin1'), Number(readFileSync(join(dir, `c${i}`), 'utf8').trim())]);
    };

    it('U1: plain mode (two arguments) reads every shape exactly as main did — stdout and rc, byte for byte, CR handling included', () => {
      const got = readShapes('');
      SHAPES.forEach(([label, , plain], i) => expect(got[i], label).toEqual(plain));
    });

    it('U2: `unit` mode — whitespace around an unquoted value goes, a quoted inner space stays, and every shape the reader cannot decide is rc 2 with nothing on stdout', () => {
      const got = readShapes('unit');
      SHAPES.forEach(([label, , , unit], i) => expect(got[i], label).toEqual(unit));
    });

    /** `[label, ccrc.env, exposure file, key, macOS answer, Linux answer]`. */
    type Dar = { rc: 3; file: 'env' | 'exp'; line: number; cause: 'cr' | 'shape' } | { rc: 0 | 2; val: string; src: '' | 'env' | 'exp' };
    type Lin = [number, string, '' | 'env' | 'exp'];
    const U3: Array<[string, string | null, string | null, string, Dar, Lin]> = [
      ['a CR after the value', 'CCRC_AUTH=on\r\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'cr' }, [0, 'on', 'env']],
      ['a second assignment on a later line', 'CCRC_AUTH=on\nFOO=1 CCRC_AUTH=off\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 2, cause: 'shape' }, [0, 'on', 'env']],
      ['an unset behind an assignment', 'CCRC_AUTH=on\nFOO=a unset CCRC_AUTH\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 2, cause: 'shape' }, [0, 'on', 'env']],
      ['a semicolon command behind an assignment', 'CCRC_AUTH=on\nFOO=1;unset CCRC_AUTH\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 2, cause: 'shape' }, [0, 'on', 'env']],
      ['a command substitution on line 3', 'X=1\nCCRC_AUTH=on\nFOO=$(echo) CCRC_AUTH=off\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 3, cause: 'shape' }, [0, 'on', 'env']],
      ['a space after the equals sign', 'CCRC_AUTH= on\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, 'on', 'env']],
      ['a declare word', 'declare CCRC_AUTH=off\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, '', '']],
      ['a semicolon comment', '; c\nCCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, 'on', 'env']],
      ['a trailing comment on the assignment', 'CCRC_AUTH=on # c\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, 'on # c', 'env']],
      ['a plus-equals assignment', 'CCRC_AUTH+=x\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, '', '']],
      ['an indented assignment', '  CCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, 'on', 'env']],
      ['readonly in ccrc.env, the exposure file arms', 'CCRC_AUTH=off\nreadonly CCRC_AUTH\n', 'CCRC_AUTH=on\n', 'CCRC_AUTH', { rc: 3, file: 'env', line: 2, cause: 'shape' }, [0, 'on', 'exp']],
      ['a CR in the exposure file only', 'CCRC_AUTH=on\n', 'X=1\r\n', 'CCRC_AUTH', { rc: 3, file: 'exp', line: 1, cause: 'cr' }, [0, 'on', 'env']],
      ['a planted canary after the key line', 'CCRC_AUTH=on\nFOO=canary-9f2 x\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 2, cause: 'shape' }, [0, 'on', 'env']],
      ['every key: the readonly files read through CCRC_HOST', 'CCRC_AUTH=off\nreadonly CCRC_AUTH\n', 'CCRC_AUTH=on\n', 'CCRC_HOST', { rc: 3, file: 'env', line: 2, cause: 'shape' }, [0, '', '']],
      ['control: a trailing space', 'CCRC_AUTH=on \n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [0, 'on', 'env']],
      ['control: a trailing tab', 'CCRC_AUTH=on\t\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [0, 'on', 'env']],
      ['control: export', 'export CCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [3, '', '']],
      ['control: export of another name', 'export FOO=1\nCCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [0, 'on', 'env']],
      // Fix round 1, F2: `unit` mode's export arm is `export<ws>+KEY<ws>*=` (D-3823's "never a longer key that begins with
      // KEY") — an export of a LONGER key that ends in KEY, or of a value that spells `KEY=`, names another key.
      ['export of a longer key ending in the key', 'export OLD_CCRC_HOST=203.0.113.7\nCCRC_HOST=127.0.0.1\n', null, 'CCRC_HOST', { rc: 0, val: '127.0.0.1', src: 'env' }, [0, '127.0.0.1', 'env']],
      ['export of a value that spells the key', 'export NOTE=CCRC_AUTH=x\nCCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [0, 'on', 'env']],
      ['export of a longer key ending in the key, a space before =', 'export OLD_CCRC_HOST =203.0.113.7\nCCRC_HOST=127.0.0.1\n', null, 'CCRC_HOST', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, '127.0.0.1', 'env']],
      ['control: export with a space before =', 'export CCRC_AUTH =on\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [3, '', '']],
      ['control: export of the key, tabs around it', 'export\t\tCCRC_AUTH\t=on\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [3, '', '']],
      ['control: a comment', '# comment\nCCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [0, 'on', 'env']],
      ['control: a comment ending in a backslash', '# x \\\nCCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [3, '', '']],
      ['control: single quotes', 'CCRC_AUTH=\'on\'\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [0, 'on', 'env']],
      ['control: double quotes with an inner space', 'CCRC_AUTH="o n"\n', null, 'CCRC_AUTH', { rc: 0, val: 'o n', src: 'env' }, [0, 'o n', 'env']],
      ['control: the exposure file wins by presence', 'CCRC_AUTH=off\n', 'CCRC_AUTH=on\n', 'CCRC_AUTH', { rc: 0, val: 'on', src: 'exp' }, [0, 'on', 'exp']],
      ['control: a bare key in the exposure file wins', 'CCRC_AUTH=on\n', 'CCRC_AUTH=\n', 'CCRC_AUTH', { rc: 0, val: '', src: 'exp' }, [0, '', 'exp']],
      ['control: an exposure file there and unreadable', 'CCRC_AUTH=on\n', 'UNREADABLE', 'CCRC_AUTH', { rc: 2, val: 'on', src: 'env' }, [2, 'on', 'env']],
    ];
    const u3Rows: UnitEnvRow[] = U3.map(([label, env, exp, key]) => ({ label, env, exp, key }));

    it('U3: the Darwin table through `_box_unit_env` — either file not plain assignments (or any CR) is rc 3 for EVERY key, naming the file and the line NUMBER, never its bytes; plain files answer what bash would', () => {
      const got = unitEnvAnswers(u3Rows, 'darwin');
      U3.forEach(([label, , , , dar], i) => {
        const a = got[i]!;
        const path = (w: 'env' | 'exp' | ''): string => (w === 'env' ? a.envPath : w === 'exp' ? a.expPath : '');
        expect(a.rc, label).toBe(dar.rc);
        if (dar.rc === 3) {
          expect([a.val, a.src], label).toEqual(['', '']);
          expect(a.why.startsWith(`${path(dar.file)} line ${dar.line} `), `${label}: ${a.why}`).toBe(true);
          expect(a.why, label).toContain(dar.cause === 'cr' ? 'carriage return' : 'is not a plain NAME=value line');
          expect(a.fix, label).toContain(path(dar.file));
          // The reason names a NUMBER, never a line: ccrc.env holds tokens.
          expect(a.why + a.fix, label).not.toContain('canary-9f2');
        } else {
          expect([a.val, a.src], label).toEqual([dar.val, path(dar.src)]);
          expect([a.why, a.fix], label).toEqual(['', '']);
        }
      });
    });

    // Fix round 1, F1 (D-3832): /bin/bash 3.2's `. file` stops at the first NUL byte in the FILE, so the launchd job sets
    // what comes before it and nothing after; `read` drops the NUL, so the plain test passed such a file and decided the
    // key (review 265: rc 0 `on`, a false ARMED). Every row here is rc 3 on BOTH feeders — on Linux by D-3831's whole-file
    // rule — and on Darwin the reason names the file and the cause, with no line number.
    /** `[label, ccrc.env, exposure file, key, the file the reason names]`. */
    const U4: Array<[string, string, string | null, string, 'env' | 'exp']> = [
      ['a NUL at the end of a line above the key', 'CCRC_AUTH=off\n', 'X=1\0\nCCRC_AUTH=on\n', 'CCRC_AUTH', 'exp'],
      ['a NUL inside the value', 'CCRC_AUTH=off\n', 'CCRC_AUTH=o\0n\n', 'CCRC_AUTH', 'exp'],
      ['a NUL in a comment above the key', 'CCRC_AUTH=off\n', '# c\0\nCCRC_AUTH=on\n', 'CCRC_AUTH', 'exp'],
      ['a NUL in ccrc.env, no exposure file', 'X=1\0\nCCRC_AUTH=on\n', null, 'CCRC_AUTH', 'env'],
      ['every key: CCRC_HOST through a NUL exposure file', 'CCRC_HOST=127.0.0.1\n', 'X=1\0\nCCRC_AUTH=on\n', 'CCRC_HOST', 'exp'],
    ];
    const u4Rows: UnitEnvRow[] = U4.map(([label, env, exp, key]) => ({ label, env, exp, key }));

    it('U4: a NUL byte anywhere in either file is rc 3 for every key on Darwin, naming the file and "a NUL byte", never a line or the bytes — and rc 3 on Linux too (D-3832; main and f74f5e90: Darwin rc 0 `on`)', () => {
      for (const os of ['darwin', 'linux'] as const) {
        const got = unitEnvAnswers(u4Rows, os);
        U4.forEach(([label, , , , which], i) => {
          const a = got[i]!;
          const file = which === 'env' ? a.envPath : a.expPath;
          expect([a.rc, a.val, a.src], `${os}: ${label}`).toEqual([3, '', '']);
          expect(a.why.startsWith(`${file} holds a NUL byte`), `${os}: ${label}: ${a.why}`).toBe(true);
          expect(a.fix, `${os}: ${label}`).toContain(`remove the NUL byte from ${file}`);
          if (os === 'darwin') expect(a.why, label).toContain('/bin/bash, which stops reading a file at its first NUL byte');
        });
      }
    });

    // Fix round 2 (D-3833, review 266 F1/F2): every row above runs under the harness's LC_ALL=C. Under a UTF-8 locale bash
    // `read`s CHARACTERS: an incomplete lead byte (0xC3) takes the NUL after it (the NUL is never seen) or the newline
    // after it (two lines read as one). The Darwin arm reads bytes whatever the caller's locale (D-3833); these rows run
    // both feeders under a UTF-8 one, proved in effect first.
    // Wave 11 (D-3979), three things. The F2 row is no longer Darwin-only: `unit` mode reads bytes too, since the Linux
    // arm of `_box_unit_env` pins `LC_ALL=C` below its Darwin dispatch, so a comment ending in a lone lead byte keeps
    // its newline on both feeders (it read ccrc.env's `on` where systemd hands the unit `off`, measured identical at
    // b40f4145, f74f5e90, 670d25fd and main), and L1 is the same merge inside ccrc.env, a false OFF. And G1 is the input
    // review 269 measured giving a false ARMED under the "relocated pin" mutant: the plain test's own line loop under
    // UTF-8 reads the comment and the `unset` line as one, so it passes a file that unsets the key (Darwin rc 3, line 2);
    // systemd ignores a line with no `=`, so Linux decides `on` from ccrc.env.
    /** What one feeder answers: today's NUL arm, the line the plain test refuses, or a decided value and where it came from. */
    type Want = { rc: 3; nul: true } | { rc: 3; line: number } | { rc: 0; val: string; src: 'env' | 'exp' };
    /** `[label, ccrc.env, exposure file or null, answers per feeder]`. A feeder a row does not list is not asserted for it
     *  (none today: every row states both). */
    const U4U: Array<[string, string, string | null, { darwin?: Want; linux?: Want }]> = [
      ['F1: a lead byte right before the NUL', 'CCRC_AUTH=off\n', '# caf\xc3\0\nCCRC_AUTH=on\n',
        { darwin: { rc: 3, nul: true }, linux: { rc: 3, nul: true } }],
      ['F1b: the NUL as the last byte, after a lead byte', 'CCRC_AUTH=off\n', 'CCRC_AUTH=on\n#\xc3\0',
        { darwin: { rc: 3, nul: true }, linux: { rc: 3, nul: true } }],
      ['F2: a comment ending in a lone lead byte keeps its newline', 'CCRC_AUTH=on\n', '# caf\xc3\nCCRC_AUTH=off\n',
        { darwin: { rc: 0, val: 'off', src: 'exp' }, linux: { rc: 0, val: 'off', src: 'exp' } }],
      ['L1: the same merge in ccrc.env, no exposure file', '# caf\xc3\nCCRC_AUTH=on\n', null,
        { darwin: { rc: 0, val: 'on', src: 'env' }, linux: { rc: 0, val: 'on', src: 'env' } }],
      ['G1: the plain test\'s own line loop (review 269 F1)', 'CCRC_AUTH=on\n', '# caf\xc3\nunset CCRC_AUTH\n',
        { darwin: { rc: 3, line: 2 }, linux: { rc: 0, val: 'on', src: 'env' } }],
    ];

    it('U4u: under a UTF-8 locale, a lead byte before a NUL still reads rc 3, and a comment ending in a lead byte does not swallow the next line on either feeder (D-3833, D-3979; main under UTF-8: Linux rc 0 `on` for F2 and rc 0 empty for L1)', () => {
      const loc = utf8Locale();
      // `expect.soft`: every row is measured, so a red run names each one that moved (F2 and L1 together), not the first.
      const rows: UnitEnvRow[] = U4U.map(([label, env, exp]) => ({ label, env, exp, key: 'CCRC_AUTH' }));
      for (const os of ['darwin', 'linux'] as const) {
        const got = unitEnvAnswers(rows, os, loc);
        U4U.forEach(([label, , , wants], i) => {
          const want = wants[os];
          if (want === undefined) return;
          const a = got[i]!;
          const tag = `${os} under LC_ALL=${loc}: ${label}`;
          if (want.rc === 3 && 'nul' in want) {
            expect.soft([a.rc, a.val, a.src], tag).toEqual([3, '', '']);
            expect.soft(a.why.startsWith(`${a.expPath} holds a NUL byte`), `${tag}: ${a.why}`).toBe(true);
          } else if (want.rc === 3) {
            expect.soft([a.rc, a.val, a.src], tag).toEqual([3, '', '']);
            expect.soft(a.why.startsWith(`${a.expPath} line ${want.line} is not a plain NAME=value line`), `${tag}: ${a.why}`).toBe(true);
          } else {
            expect.soft([a.rc, a.val, a.src], tag).toEqual([0, want.val, want.src === 'env' ? a.envPath : a.expPath]);
          }
        });
      }
    });

    // Wave 11 (D-3979): the placement of the Linux pin is pinned structurally, in whatever spelling. `local LC_ALL=C` must
    // sit BELOW the Darwin dispatch: above it, it would also cover `_box_unit_env_shell`, whose own `LC_ALL=C` (D-3833)
    // would stop being load-bearing, and T4-M31 (dropping that one) would no longer red U4u (measured). No `LC_ALL` token
    // at all may precede the dispatch, on its own line or on the first `local` line.
    it('U4p: `_box_unit_env` pins `local LC_ALL=C` below its Darwin dispatch and no `LC_ALL` above it, and `_box_unit_env_shell` keeps its own pin (D-3979; T4-M31)', () => {
      const src = readFileSync(CCRC_SRC, 'utf8');
      const m = /_box_unit_env\(\) \{([\s\S]*?)\n\}/.exec(src);
      expect(m, '_box_unit_env must be readable by /_box_unit_env\\(\\) \\{([\\s\\S]*?)\\n\\}/').not.toBeNull();
      const body = m![1]!;
      const d = body.indexOf('_box_unit_env_shell "$key"; return; fi');
      expect(d, 'the Darwin dispatch must be in _box_unit_env').toBeGreaterThan(-1);
      expect(/\bLC_ALL\b/.test(body.slice(0, d)), 'an LC_ALL token above the Darwin dispatch would cover _box_unit_env_shell too, so T4-M31 would stop reding (D-3979)').toBe(false);
      expect(/^  local LC_ALL=C$/m.test(body.slice(d)), 'the Linux arm must pin `local LC_ALL=C` below the dispatch (D-3979)').toBe(true);
      expect(/_box_unit_env_shell\(\) \{[^\n]*\n  local key="\$1" v rc bad="" LC_ALL=C\n/.test(src), '_box_unit_env_shell must keep its own LC_ALL=C (T4-M31, D-3833)').toBe(true);
    });

    it('U4n: `_box_env_has_nul` alone, called with NO caller pinning a locale, under a UTF-8 one — it reads bytes itself, so neither arm\'s answer leans on its caller (D-3833)', () => {
      const loc = utf8Locale();
      const dir = mkTmp('ccrc-doctor-hasnul-');
      /** `[label, bytes, rc]`: 0 = a NUL is there, 1 = none. */
      const files: Array<[string, string, number]> = [
        ['a lead byte right before the NUL', '# caf\xc3\0\nCCRC_AUTH=on\n', 0],
        ['the NUL as the last byte, after a lead byte', 'CCRC_AUTH=on\n#\xc3\0', 0],
        ['a three-byte lead pair before the NUL', '# \xe2\x80\0\n', 0],
        ['control: high bytes and no NUL', '# caf\xc3\nX=\xe2\x80\x94\n', 1],
      ];
      files.forEach(([, bytes], i) => writeFileSync(join(dir, `f${i}`), bytes, 'latin1'));
      const script = [
        `x=$'\\xc3\\xa9'; [ "\${#x}" -eq 1 ] || { echo "LC_ALL=${loc} did not take effect" >&2; exit 7; }`,
        `. ${shq(CCRC_SRC)}`,
        `for ((i=0;i<${files.length};i++)); do _box_env_has_nul ${shq(dir)}/f$i; echo $?; done`,
      ].join('\n');
      const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8', env: { HOME: dir, PATH: join(dir, 'no-bin'), LC_ALL: loc } });
      expect(r.status, r.stderr).toBe(0);
      const rcs = r.stdout.trim().split('\n').map(Number);
      files.forEach(([label, , want], i) => expect(rcs[i], `LC_ALL=${loc}: ${label}`).toBe(want));
    });

    it('U3l: the same rows with CCD_OS=linux — `unit` mode\'s answers, the platform split stated as data: one set of bytes, two feeders', () => {
      const got = unitEnvAnswers(u3Rows, 'linux');
      U3.forEach(([label, , , , , lin], i) => {
        const a = got[i]!;
        const path = (w: '' | 'env' | 'exp'): string => (w === 'env' ? a.envPath : w === 'exp' ? a.expPath : '');
        expect([a.rc, a.val, a.src], label).toEqual([lin[0], lin[1], path(lin[2])]);
        if (lin[0] === 3) {
          expect(a.why, label).toContain('in a shape this reader does not decide');
          expect(a.why.startsWith(a.envPath), label).toBe(true);
          expect(a.fix, label).toContain(a.envPath);
        }
      });
    });

    // Wave 11 R14(j) (D-3980): the launchd job sources both env files with /bin/bash under `set -a`. Assigning one of the
    // names /bin/bash reserves ends that shell before its `exec` when POSIXLY_CORRECT has turned POSIX mode on (bash's
    // read-only variables, five of this set in bash 3.2 (BASHOPTS arrived in 4.1) and six in 5.2; in 3.2 also
    // BASH_ARGC, BASH_ARGV, BASH_LINENO, BASH_SOURCE, FUNCNAME and GROUPS), so the
    // job never starts, whatever CCRC_AUTH says. The plain test refuses the fifteen as a NAME, in either file and in any
    // order, under its own cause: the reason names the line, never the variable (A1) and calls none of them read-only (A5).
    // D-3987 widens it to fifteen: HISTCMD and OPTIND are integer variables with no assign function, so a value that is an
    // arithmetic error ends the job's bash before its `exec` in every bash, with no POSIX mode (review of Task 2, F1).
    const U5_NAMES = ['POSIXLY_CORRECT', 'BASHOPTS', 'BASH_VERSINFO', 'EUID', 'PPID', 'SHELLOPTS', 'UID',
      'BASH_ARGC', 'BASH_ARGV', 'BASH_LINENO', 'BASH_SOURCE', 'FUNCNAME', 'GROUPS', 'HISTCMD', 'OPTIND'];
    /** Names that merely look like one of the fifteen (or are other reserved-looking names bash lets a file set). */
    const U5_CONTROLS = ['PATH=/usr/bin', 'HOME=/x', 'LC_ALL=C.UTF-8', 'BASH_COMPAT=0', 'BASH_XTRACEFD=0', 'MY_UID=0', 'MY_OPTIND=0', 'UIDX=0', 'uid=0', 'POSIXLY_CORRECTX=1'];
    const U5_ARITH: UnitEnvRow[] = [
      { label: 'OPTIND=1/0', env: 'OPTIND=1/0\nCCRC_AUTH=on\n', exp: null, key: 'CCRC_AUTH' },
      { label: 'HISTCMD=1/0', env: 'HISTCMD=1/0\nCCRC_AUTH=on\n', exp: null, key: 'CCRC_AUTH' },
      { label: 'OPTIND=09', env: 'OPTIND=09\nCCRC_AUTH=on\n', exp: null, key: 'CCRC_AUTH' },
      { label: 'export OPTIND="1/0"', env: 'export OPTIND="1/0"\nCCRC_AUTH=on\n', exp: null, key: 'CCRC_AUTH' },
      { label: 'exposure HISTCMD=1+', env: 'CCRC_AUTH=on\n', exp: 'CCRC_RP_ID=x\nHISTCMD=1+\n', key: 'CCRC_AUTH' },
    ];
    const U5_REVIEW: UnitEnvRow = { label: 'the review\'s input', env: 'POSIXLY_CORRECT=1\n', exp: 'UID=0\nCCRC_AUTH=on\n', key: 'CCRC_AUTH' };

    it('U5: on Darwin, each of the fifteen names /bin/bash reserves is rc 3 for the gate, naming the file and the line and never the variable; names that only look like one read as before (D-3980)', () => {
      const rows: UnitEnvRow[] = [
        ...U5_NAMES.map((n) => ({ label: n, env: `${n}=0\nCCRC_AUTH=on\n`, exp: null, key: 'CCRC_AUTH' })),
        U5_REVIEW,
        { label: 'order-free: the name below the key, in the exposure file', env: 'CCRC_AUTH=on\n', exp: 'CCRC_RP_ID=x\nGROUPS=0\n', key: 'CCRC_AUTH' },
        // The review's measured arithmetic-error inputs: every value here passes the plain test's value rule, so only the NAME refuses it.
        ...U5_ARITH,
        ...U5_CONTROLS.map((c) => ({ label: `control: ${c}`, env: `${c}\nCCRC_AUTH=on\n`, exp: null, key: 'CCRC_AUTH' })),
      ];
      const got = unitEnvAnswers(rows, 'darwin');
      const prefix = 'assigns a variable /bin/bash reserves';
      U5_NAMES.forEach((name, i) => {
        const a = got[i]!;
        expect.soft([a.rc, a.val, a.src], name).toEqual([3, '', '']);
        expect.soft(a.why.startsWith(`${a.envPath} line 1 ${prefix}`), `${name}: ${a.why}`).toBe(true);
        expect.soft(a.why, name).not.toContain(name);
        expect.soft(a.fix, name).not.toContain(name);
        expect.soft(a.fix, name).toContain(`line 1 of ${a.envPath}`);
        expect.soft(a.why + a.fix, name).not.toMatch(/read-only|readonly/i);
      });
      const n = U5_NAMES.length;
      const rev = got[n]!;
      expect.soft([rev.rc, rev.val, rev.src], 'the review\'s input').toEqual([3, '', '']);
      expect.soft(rev.why.startsWith(`${rev.envPath} line 1 ${prefix}`), rev.why).toBe(true);
      const ord = got[n + 1]!;
      expect.soft([ord.rc, ord.val, ord.src], 'order-free').toEqual([3, '', '']);
      expect.soft(ord.why.startsWith(`${ord.expPath} line 2 ${prefix}`), ord.why).toBe(true);
      expect.soft(ord.why + ord.fix, 'order-free').not.toContain('GROUPS');
      const arithLines = [1, 1, 1, 1, 2];
      U5_ARITH.forEach((row, i) => {
        const a = got[n + 2 + i]!;
        const file = row.exp === null ? a.envPath : a.expPath;
        expect.soft([a.rc, a.val, a.src], row.label).toEqual([3, '', '']);
        expect.soft(a.why.startsWith(`${file} line ${arithLines[i]} ${prefix}`), `${row.label}: ${a.why}`).toBe(true);
        expect.soft(a.why + a.fix, row.label).not.toMatch(/HISTCMD|OPTIND/);
      });
      U5_CONTROLS.forEach((c, i) => {
        const a = got[n + 2 + U5_ARITH.length + i]!;
        expect.soft([a.rc, a.val, a.src, a.why, a.fix], `control: ${c}`).toEqual([0, 'on', a.envPath, '', '']);
      });
    });

    it('U5l: the same input with CCD_OS=linux reads `on` from the exposure file — systemd sets both as plain environment, so the platform split is data (D-3980)', () => {
      const [a] = unitEnvAnswers([U5_REVIEW], 'linux');
      expect([a!.rc, a!.val, a!.src]).toEqual([0, 'on', a!.expPath]);
    });

    // macOS only: the end-to-end line. The coordinator reads it on `test-macos`.
    itDarwin('E20d: the review\'s input through `ccrc doctor` on macOS — one WARN auth, not measured, naming ccrc.env line 1, never a PASS ARMED (D-3980)', () => {
      const home = healthy('ccrc-doctor-auth-e20d-');
      writeCcrcEnv(home, `POSIXLY_CORRECT=1\n${readEnv(home)}`);
      writeFileSync(expPath(home), 'UID=0\nCCRC_AUTH=on\n');
      const r = runDoctor(home);
      expectOneUndecidedWarn(r.stdout, envPath(home));
      expect(authLine(r.stdout)).toContain(`${envPath(home)} line 1 `);
      // A1 at the doctor surface: the line is named by number, never the variable.
      expect(authLine(r.stdout)).not.toContain('POSIXLY_CORRECT');
      expect(r.stdout).not.toMatch(/^PASS auth: .*gated/m);
    });
  });
});
// ── land-probe (landing order wave 3b) ──────────────────────────────────────
// `_check_land-probe` READS the two files `ccd-land-probe` rewrites every tick and never runs git or gh: a box whose fixture
// has neither on PATH still answers. `healthy()` writes no landing conf, so the check SKIPs there (counted in `HEALTHY_SKIPS`);
// every case below plants the conf and the files it needs.
describeLinux('ccrc doctor: land-probe', () => {
  const iso = (agoS: number): string => new Date(Date.now() - agoS * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const SHA = 'a'.repeat(40);
  const store = (count: number): object => ({ count, size: 0, inPack: 4, packs: 1 });
  const probeDoc = (agoS: number, over: Record<string, unknown> = {}): object => ({
    v: 1, project: 'proj-a', at: iso(agoS), state: 'measured', base: { ref: 'main', sha: SHA },
    heads: [
      { pr: 12, head: SHA, branch: 'ws/alpha', id: 'lane-a-proj-a-alpha', base: { state: 'clean' } },
      { pr: 13, head: SHA, branch: 'feature/x', id: null, base: { state: 'conflict', paths: ['README.md'], pathsCut: false } },
      { pr: 14, head: SHA, branch: 'ws/beta', id: null, base: { state: 'clean' } },
    ],
    headsCut: false, pairs: [], pairHeads: [14, 13, 12], pairsCut: false,
    store: { before: store(0), after: store(0) }, scratch: { sizeKiB: 12 }, elapsedMs: 1234, ...over,
  });
  const mainDoc = (agoS: number, over: Record<string, unknown> = {}): object => ({
    v: 1, project: 'proj-a', at: iso(agoS), sha: SHA, state: 'green', required: [{ name: 'build', app: null }], failing: [], pending: [], ...over,
  });
  /** One opted-in project: its conf, and (unless `null`) the two files, each as the object or the raw text given. */
  const plant = (home: string, project = 'proj-a', files: { probe?: object | string | null; main?: object | string | null } = {}, confAgeS = 3600): string => {
    mkdirSync(join(home, '.ccrc', 'landing'), { recursive: true });
    const confFile = join(home, '.ccrc', 'landing', `${project}.conf`);
    writeFileSync(confFile, 'lineage=off\n');
    const confTime = new Date(Date.now() - confAgeS * 1000);
    utimesSync(confFile, confTime, confTime);   // an opt-in older than ten minutes: a missing probe is then the radar's fault, not a fresh opt-in's
    const dir = join(home, '.cc-sessions', 'landing', project);
    mkdirSync(dir, { recursive: true });
    const put = (name: string, v: object | string | null | undefined, dflt: object): void => {
      if (v === null) return;
      const body = v === undefined ? dflt : v;
      writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
    };
    put('probe', files.probe, probeDoc(60));
    put('main-health', files.main, mainDoc(60));
    return dir;
  };
  const verdict = (home: string, extraEnv: NodeJS.ProcessEnv = {}): string => anyVerdictFor(runDoctor(home, ['doctor'], extraEnv).stdout, 'land-probe') ?? '';
  const ageUnit = (home: string, agoS: number): void => {
    writeUnitFile(home, 'ccd-land-probe.timer');
    const t = new Date(Date.now() - agoS * 1000);
    utimesSync(join(unitDirOf(home), unitFileOf('ccd-land-probe.timer')), t, t);
  };

  it('PASSes on fresh files, and says what it read: heads, conflicts, the base, the store delta and the scratch', () => {
    const home = healthy('ccrc-doctor-land-probe-pass-');
    plant(home);
    const out = runDoctor(home);
    expect(lineFor(out.stdout, 'land-probe')).toBe('PASS land-probe: proj-a: 3 heads, 1 conflicting with main, main green; store +0 objects, scratch 12 KiB this tick');
    expect(out.code).toBe(0);
  });

  it('reads the store delta as objects gained over the tick, loose and packed together', () => {
    const home = healthy('ccrc-doctor-land-probe-delta-');
    plant(home, 'proj-a', { probe: probeDoc(60, { store: { before: store(3), after: store(20) } }) });
    expect(verdict(home)).toContain('store +17 objects');
  });

  it('PASSes a red or a pending base: that is the repository\'s fact, which the line states, not the probe\'s fault', () => {
    const red = healthy('ccrc-doctor-land-probe-red-');
    plant(red, 'proj-a', { main: mainDoc(60, { state: 'red', failing: ['build'] }) });
    expect(verdict(red)).toMatch(/^PASS land-probe: proj-a: 3 heads, 1 conflicting with main, main red; /);
    const pending = healthy('ccrc-doctor-land-probe-pending-');
    plant(pending, 'proj-a', { main: mainDoc(60, { state: 'unmeasured', why: 'pending' }) });
    expect(verdict(pending)).toMatch(/^PASS land-probe: .*main pending; /);
  });

  it('names every opted-in project on one line', () => {
    const home = healthy('ccrc-doctor-land-probe-two-');
    plant(home, 'proj-a');
    plant(home, 'proj-b', { probe: probeDoc(60, { heads: [] }) });
    const line = lineFor(runDoctor(home).stdout, 'land-probe') ?? '';
    expect(line).toMatch(/^PASS land-probe: proj-a: 3 heads, .* \| proj-b: 0 heads, 0 conflicting with main, main green; /);
  });

  it('SKIPs on a server-role box, however stale its files', () => {
    const home = healthy('ccrc-doctor-land-probe-server-');
    plant(home, 'proj-a', { probe: probeDoc(86400) });
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    expect(verdict(home)).toMatch(/^SKIP land-probe: this box records CCRC_ROLE=server/);
  });

  it('SKIPs with no conf: nobody opted in, which is every box until the operator does', () => {
    const home = healthy('ccrc-doctor-land-probe-noconf-');
    expect(verdict(home)).toMatch(/^SKIP land-probe: no project is opted in /);
    mkdirSync(join(home, '.ccrc', 'landing'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'landing', 'notes.txt'), 'not a conf');
    expect(verdict(home), 'only <project>.conf files opt a project in').toMatch(/^SKIP land-probe: no project is opted in /);
  });

  it('SKIPs while the operator has paused the probe: its files then age by design, never a stopped timer', () => {
    const home = healthy('ccrc-doctor-land-probe-paused-');
    plant(home, 'proj-a', { probe: probeDoc(86400) });
    writeFileSync(join(home, '.cc-sessions', 'land-probe-paused'), '');
    expect(verdict(home)).toMatch(/^SKIP land-probe: paused by the operator /);
  });

  it('SKIPs when every opted-in project is paused, and measures the one that is not', () => {
    const home = healthy('ccrc-doctor-land-probe-project-paused-');
    const a = plant(home, 'proj-a', { probe: probeDoc(86400) });
    writeFileSync(join(a, 'paused'), '');
    expect(verdict(home)).toMatch(/^SKIP land-probe: every opted-in project is paused /);
    plant(home, 'proj-b');
    const line = verdict(home);
    expect(line).toMatch(/^PASS land-probe: proj-b: 3 heads/);
    expect(line, 'a paused project is not measured').not.toContain('proj-a');
  });

  it('WARNs land-probe-not-yet inside ten minutes of the timer unit landing, and land-probe-never after', () => {
    const fresh = healthy('ccrc-doctor-land-probe-notyet-');
    plant(fresh, 'proj-a', { probe: null, main: null });
    ageUnit(fresh, 30);
    const out = runDoctor(fresh).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(i, out.join('\n')).toBeGreaterThan(-1);
    expect(out[i]).toContain('land-probe-not-yet: proj-a has no probe file yet and ccd-land-probe.timer was installed ');
    expect(out[i], 'the first-tick sentence names no number').toContain(' ago - its first tick follows the timer\'s arming delay, so this is expected right after an install');
    expect(out[i + 1], 'the remedy names the shipped timer\'s period (300 s)').toMatch(/^ {2}remedy: wait for the first tick \(the timer fires every 5 minutes\), then re-run doctor/);

    const old = healthy('ccrc-doctor-land-probe-never-');
    plant(old, 'proj-a', { probe: null, main: null });
    ageUnit(old, 11 * 60);
    const o = runDoctor(old).stdout.split('\n');
    const j = o.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(o[j]).toContain('land-probe-never: proj-a is opted in but the radar has never written its probe, so no PR conflict is measured');
    expect(o[j]).not.toContain('land-probe-not-yet');
    expect(o[j + 1]).toMatch(/^ {2}remedy: systemctl --user status ccd-land-probe\.timer ccd-land-probe\.service/);

    const none = healthy('ccrc-doctor-land-probe-never-nounit-');
    plant(none, 'proj-a', { probe: null, main: null });
    expect(verdict(none), 'no timer unit file at all is a radar that was never installed').toContain('land-probe-never: proj-a');
  });

  it('WARNs land-probe-unreadable for a file that is not a v1 record, a missing main-health, a symlink and a future time', () => {
    const cases: Array<[string, { probe?: object | string | null; main?: object | string | null }, RegExp]> = [
      ['garbled', { probe: '{not json' }, /land-probe-unreadable: proj-a: the probe file under .* is not a regular v1 record with a readable time/],
      ['later-format', { probe: probeDoc(60, { v: 2 }) }, /land-probe-unreadable: proj-a: the probe file/],
      ['no-time', { probe: probeDoc(60, { at: 'yesterday' }) }, /land-probe-unreadable: proj-a: the probe file/],
      ['main-health-missing', { main: null }, /land-probe-unreadable: proj-a: the main-health file under .* is missing beside a probe/],
      ['main-health-garbled', { main: '[]' }, /land-probe-unreadable: proj-a: the main-health file/],
      ['future', { probe: probeDoc(-3600) }, /land-probe-unreadable: proj-a: the probe file under .* is dated in the future/],
      ['wrong-shape', { probe: probeDoc(60, { heads: 'three' }) }, /land-probe-unreadable: proj-a: the probe file/],
    ];
    for (const [name, files, re] of cases) {
      const home = healthy(`ccrc-doctor-land-probe-unreadable-${name}-`);
      plant(home, 'proj-a', files);
      const out = runDoctor(home).stdout.split('\n');
      const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
      expect(out.join('\n'), name).toMatch(re);
      expect(out[i + 1], name).toMatch(/^ {2}remedy: let the probe rewrite its files: systemctl --user start ccd-land-probe\.service/);
    }
    const link = healthy('ccrc-doctor-land-probe-unreadable-symlink-');
    const dir = plant(link, 'proj-a', { probe: null });
    writeFileSync(join(link, 'elsewhere.json'), JSON.stringify(probeDoc(60)));
    symlinkSync(join(link, 'elsewhere.json'), join(dir, 'probe'));
    expect(verdict(link), 'a symlink is not a regular file').toContain('land-probe-unreadable: proj-a: the probe file');
  });

  it('WARNs land-probe-stale past CCRC_LAND_PROBE_STALE_S (default four periods of the shipped timer, 1200 s), for either file, and the knob moves the line', () => {
    const home = healthy('ccrc-doctor-land-probe-stale-');
    plant(home, 'proj-a', { probe: probeDoc(1500) });
    const out = runDoctor(home).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(out[i], out.join('\n')).toMatch(/land-probe-stale: proj-a: the probe file is 1[0-9]{3}s old - the radar ticks every 5 minutes, so it has stopped/);
    expect(out[i + 1]).toMatch(/^ {2}remedy: systemctl --user status ccd-land-probe\.timer ccd-land-probe\.service; journalctl --user -u ccd-land-probe\.service/);
    expect(verdict(home, { CCRC_LAND_PROBE_STALE_S: '3600' })).toMatch(/^PASS land-probe: /);
    expect(verdict(home, { CCRC_LAND_PROBE_STALE_S: 'abc' }), 'a non-number falls back to the default').toContain('land-probe-stale');
    const mh = healthy('ccrc-doctor-land-probe-stale-main-');
    // A tick in progress (its probe has no store.after yet) beside a main-health from long ago: the main-health is stale.
    plant(mh, 'proj-a', { probe: probeDoc(60, { store: { before: store(0), after: null }, scratch: { sizeKiB: null } }), main: mainDoc(1500) });
    expect(verdict(mh)).toContain('land-probe-stale: proj-a: the main-health file is ');
    // A FINISHED probe beside a main-health older than it is the sharper fact: the tick stopped before writing it.
    const inc = healthy('ccrc-doctor-land-probe-incomplete-');
    plant(inc, 'proj-a', { main: mainDoc(1500) });
    expect(verdict(inc)).toMatch(/^WARN land-probe: land-probe-incomplete: proj-a: the main-health file is 14[0-9]{2}s older than the probe file, so the last tick wrote its probe and stopped before its main-health/);
    const edge = healthy('ccrc-doctor-land-probe-stale-edge-');
    plant(edge, 'proj-a', { probe: probeDoc(1100), main: mainDoc(1100) });
    expect(verdict(edge), 'inside the bound is fresh').toMatch(/^PASS land-probe: /);
  });

  it('an unreadable ccd-land-probe.timer: the bounds it would have set are not invented, and the WARN names the unit (D-7054, OA-C8c (a))', () => {
    // The shipped unit file is gone from the box's tree (the same fixture seam the other cadence rows use), so no period can be read.
    const noTimer = (prefix: string): string => {
      const h = healthy(prefix);
      writeShippedTimer(join(h, 'ccrc'), 'ccd-land-probe.timer', null);
      return h;
    };
    const lines = (h: string, env: NodeJS.ProcessEnv = {}): string[] => {
      const out = runDoctor(h, ['doctor'], env).stdout.split(h).join('<home>').split('\n');
      return out.flatMap((l, i) => (l.startsWith('WARN land-probe: ') || l.startsWith('PASS land-probe: ') ? [l, out[i + 1] ?? ''] : []));
    };
    const unreadSentence = (what: string): string =>
      `ccd-land-probe.timer's cadence could not be read from the shipped unit file (<home>/ccrc/deploy/systemd/ccd-land-probe.timer), so ${what} is unmeasured`;
    const unreadFix = '  remedy: the shipped tree at <home>/ccrc is incomplete or damaged';

    // No override: there is no stale bound, so a file 1500 s old is not called stale and a fresh one is not a PASS.
    const old = noTimer('ccrc-doctor-land-probe-unread-old-');
    plant(old, 'proj-a', { probe: probeDoc(1500), main: mainDoc(1500) });
    const o = lines(old);
    expect(o, o.join('\n')).toHaveLength(2);
    expect(o[0]).toBe(`WARN land-probe: ${unreadSentence("the stale bound (four of the timer's periods; the stale arm did not run)")}`);
    expect(o[1]).toContain(unreadFix);
    const fresh = noTimer('ccrc-doctor-land-probe-unread-fresh-');
    plant(fresh, 'proj-a');
    expect(lines(fresh)[0], 'a PASS would claim a freshness nothing measured').toBe(o[0]);

    // An override stands without the period: a fresh file PASSes, unchanged.
    expect(lines(fresh, { CCRC_LAND_PROBE_STALE_S: '3600' })[0]).toMatch(/^PASS land-probe: proj-a: 3 heads/);
    // ... and a stale one is called stale by the override, its sentence dropping the period it cannot name.
    const ov = lines(old, { CCRC_LAND_PROBE_STALE_S: '1000' });
    expect(ov[0]).toMatch(/^WARN land-probe: land-probe-stale: proj-a: the probe file is 1[0-9]{3}s old - the radar has stopped, and its conflict and base-health readings are stale$/);
    expect(ov.join('\n')).toContain(unreadSentence('the period the stale sentence names'));

    // An absent probe has no not-yet window to be judged by: it reads never, and the WARN says the window is unmeasured.
    const none = noTimer('ccrc-doctor-land-probe-unread-window-');
    plant(none, 'proj-a', { probe: null, main: null }, 30);
    ageUnit(none, 30);
    const n = lines(none, { CCRC_LAND_PROBE_STALE_S: '3600' });
    expect(n[0]).toContain('land-probe-never: proj-a');
    expect(n.join('\n')).not.toContain('land-probe-not-yet');
    expect(n.join('\n')).toContain(unreadSentence("the not-yet window (two of the timer's periods; the not-yet arm did not run)"));
  });

  it('F2 counts the heads that came back unmeasured on the PASS line, and WARNs land-probe-unmeasured when every head did', () => {
    const heads = (states: Array<object>): object[] => states.map((base, n) => ({ pr: 20 + n, head: SHA, branch: `feature/${n}`, id: null, base }));
    const some = healthy('ccrc-doctor-land-probe-some-unmeasured-');
    plant(some, 'proj-a', { probe: probeDoc(60, { heads: heads([{ state: 'clean' }, { state: 'conflict', paths: ['x'], pathsCut: false }, { state: 'unmeasured', why: 'budget' }, { state: 'unmeasured', why: 'timeout' }]) }) });
    expect(verdict(some)).toBe('PASS land-probe: proj-a: 4 heads, 1 conflicting with main, 2 unmeasured, main green; store +0 objects, scratch 12 KiB this tick');
    const none = healthy('ccrc-doctor-land-probe-none-unmeasured-');
    plant(none, 'proj-a', { probe: probeDoc(60, { heads: heads([{ state: 'clean' }, { state: 'conflict', paths: ['x'], pathsCut: false }]) }) });
    expect(verdict(none), 'K = 0 leaves the PASS text as it was').toBe('PASS land-probe: proj-a: 2 heads, 1 conflicting with main, main green; store +0 objects, scratch 12 KiB this tick');
    const all = healthy('ccrc-doctor-land-probe-all-unmeasured-');
    plant(all, 'proj-a', { probe: probeDoc(60, { heads: heads([{ state: 'unmeasured', why: 'budget' }, { state: 'unmeasured', why: 'rc-128' }, { state: 'unmeasured', why: 'timeout' }]) }) });
    const out = runDoctor(all).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(out[i], out.join('\n')).toContain('land-probe-unmeasured: proj-a: all 3 of its open PR heads came back unmeasured against the base');
    expect(out.join('\n')).not.toMatch(/^PASS land-probe/m);
    const zero = healthy('ccrc-doctor-land-probe-zero-heads-');
    plant(zero, 'proj-a', { probe: probeDoc(60, { heads: [] }) });
    expect(verdict(zero), 'no heads at all is nothing to measure, not an unmeasured radar').toMatch(/^PASS land-probe: proj-a: 0 heads, 0 conflicting with main, main green; /);
  });

  it('F3 reads a conf written under ten minutes ago as not-yet, never land-probe-never', () => {
    const fresh = healthy('ccrc-doctor-land-probe-newconf-');
    plant(fresh, 'proj-a', { probe: null, main: null }, 30);
    ageUnit(fresh, 3 * 3600);   // the timer is old: only the conf is new
    const out = runDoctor(fresh).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(out[i], out.join('\n')).toContain('land-probe-not-yet: proj-a has no probe file yet and its conf was written ');
    expect(out[i]).not.toContain('land-probe-never');
    expect(out[i], 'the next-tick clause is read from the shipped timer').toContain('the next tick (the timer fires every 5 minutes) is the first to measure it');
    expect(out[i + 1]).toMatch(/^ {2}remedy: wait for the first tick \(the timer fires every 5 minutes\), then re-run doctor/);
    // The window is two periods of the shipped timer (2 x 300 s), so 600 s is the edge this fixture's unit file puts it at.
    const old = healthy('ccrc-doctor-land-probe-oldconf-');
    plant(old, 'proj-a', { probe: null, main: null }, 601);
    ageUnit(old, 3 * 3600);
    expect(verdict(old), 'a conf past ten minutes with no probe is the radar\'s fault').toContain('land-probe-never: proj-a');
  });

  it('M5 the never and stale remedy names an invalid conf or a missing checkout as a reason the writes stop', () => {
    const home = healthy('ccrc-doctor-land-probe-remedy-');
    plant(home, 'proj-a', { probe: null, main: null });
    const out = runDoctor(home).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(out[i + 1]).toMatch(/an invalid conf or a missing checkout under .*\/projects also stops them, and the journal names it$/);
  });

  it('WARNs land-probe-unmeasured when the probe ran and could not measure, with the why it gave', () => {
    const home = healthy('ccrc-doctor-land-probe-unmeasured-');
    plant(home, 'proj-a', { probe: probeDoc(60, { state: 'unmeasured', why: 'fetch-failed', heads: [], pairs: [] }) });
    const out = runDoctor(home).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(out[i], out.join('\n')).toContain('land-probe-unmeasured: proj-a: the probe ran and could not measure its probe (why: fetch-failed), so no conflict reading stands for this project');
    expect(out[i], 'M4: the sentence is limited to what the file names').not.toContain('base-health');
    expect(out[i + 1]).toMatch(/^ {2}remedy: read why the tick could not measure: journalctl --user -u ccd-land-probe\.service/);
    expect(out.join('\n')).not.toMatch(/^PASS land-probe/m);

    const gh = healthy('ccrc-doctor-land-probe-unmeasured-main-');
    plant(gh, 'proj-a', { main: mainDoc(60, { state: 'unmeasured', why: 'gh-failed' }) });
    expect(verdict(gh)).toContain('the probe ran and could not measure its main-health (why: gh-failed), so no base-health reading stands for this project');
    expect(verdict(gh), 'M4: a main-health that could not be measured says nothing of the conflict reading').not.toContain('conflict reading');

    const odd = healthy('ccrc-doctor-land-probe-unmeasured-why-');
    plant(odd, 'proj-a', { probe: probeDoc(60, { state: 'unmeasured', why: 'x'.repeat(200) }) });
    expect(verdict(odd), 'a reason that is not a short word is never echoed').toContain('(why: no-reason)');
  });

  it('is the verdict when one project is fine and another is not: the fine one is not hidden, the bad one is named', () => {
    const home = healthy('ccrc-doctor-land-probe-mixed-');
    plant(home, 'proj-a');
    plant(home, 'proj-b', { probe: probeDoc(5000) });
    const line = verdict(home);
    expect(line).toMatch(/^WARN land-probe: land-probe-stale: proj-b: /);
    expect(line).not.toContain('proj-a');
  });

  it('services: an installed, stopped ccd-land-probe.timer WARNS with its own consequence', () => {
    const home = healthy('ccrc-doctor-services-land-probe-timer-');
    writeUnitFile(home, 'ccd-land-probe.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-land-probe.timer'), 'inactive\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccd-land-probe.timer is installed but inactive');
    expect(lines[i]).toContain('no open PR is measured for a conflict with the base');
    expect(lines[i]).not.toContain('the job it fires is not running');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccd-land-probe\.timer$/);
  });

  it('services: an active ccd-land-probe.timer is named among the PASSes', () => {
    const home = healthy('ccrc-doctor-services-land-probe-timer-ok-');
    writeUnitFile(home, 'ccd-land-probe.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-land-probe.timer'), 'active\n');
    expect(lineFor(runDoctor(home).stdout, 'services')).toContain('ccd-land-probe.timer is active');
  });
});
