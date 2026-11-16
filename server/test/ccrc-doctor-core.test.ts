// `ccrc doctor`, part: core (D-6767). The doctor suite was one 17,000-line file that held a worker for 661 s; its describe blocks moved
// here unchanged, and the fixtures they share are in `ccrc-doctorFixture.ts`. This part is the prerequisite and services
// checks; `ccrc-doctor-core-state.test.ts` and `ccrc-doctor-core-auth.test.ts` hold the rest of what was this one file, which
// ran about 410 s on a CI runner and past the trace job's 1560 s budget under `strace -f`.
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, existsSync, utimesSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ghPoisonAt, plantPoolEpoch, seedAccountsSh } from './ccdWsHelpers.js';
import { describeLinux, describeDarwin, itLinux } from './platformFixtures.js';
import { codexAuthDir } from './codexLaneFixture.js';
import { familyClassOf } from '../../shared/models.mjs';
import { installDoctorHooks, CHECKS_SRC, LIB_SRC, BASH, realPath, writePkg, writeRawPkg, stubBin, stub, unstubManager, unstub, linkReal, stubNode, shq, ghStub, GH_OK, writeCcrcEnv, unitDirOf, unitFileOf, writeUnitFile, removeUnitFile, containedPath, runDoctor, healthy, broken, tableNames, lineFor, anyVerdictFor, HEALTHY_SKIPS } from './ccrc-doctorFixture.js';

// Each case's homes go when the case ends, not in a file-wide end sweep (R100, review 518's S1): that sweep overran vitest's 20 s
// hook timeout on the one file this family was split from. Registered before `installDoctorHooks()`'s root `afterEach` (the codex
// lanes' process kill) because vitest runs after-hooks in reverse order of registration: that kill still sees its home.
removeTmpFixturesEachTest();
installDoctorHooks();
// +1 server-caps (no role): its block at the end; +1 update-sweep (no update.json on a healthy box); +1 approval-verifier-runnable (no registry); +1 approval-key-colocated (no server key); +2 the backups checks of the other platform (A11b): Linux SKIPs filevault and secrets-backup-excluded, macOS snapshot-posture

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


describe('ccrc doctor: services knows about the box settings timer', () => {
  // D-6915: `ccrc-settings.timer` joins `known`, hand-kept until ARCH-69 derives the list. A stopped timer WARNs, naming the
  // unit: the console keeps showing the last record it read, which the card marks stale after 15 minutes.
  itLinux('warns, naming the unit, when the settings timer is installed and stopped', () => {
    const home = healthy('ccrc-doctor-services-settings-');
    writeUnitFile(home, 'ccrc-settings.timer');
    writeFileSync(join(home, 'fixture-unit-ccrc-settings.timer'), 'inactive\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccrc-settings.timer is installed but inactive');
    expect(lines[i]).toContain('ccrc-settings.timer');
    expect(lines[i]).not.toContain('every five minutes');
    expect(lines[i]).not.toContain('the job it fires is not running');
    // The console DOES mark the figures old (stale after 900 s, review 1385 A1): the sentence says so, and never says nothing does.
    expect(lines[i]).toContain('the console keeps showing the last settings it read, marked stale after 15 minutes');
    expect(lines[i]).not.toContain('nothing marks');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccrc-settings\.timer$/);
    expect(r.stdout).not.toMatch(/the check exited/);
    expect(r.code).toBe(0);
  });

  itLinux('names it in the PASS line when it is installed and running', () => {
    const home = healthy('ccrc-doctor-services-settings-ok-');
    writeUnitFile(home, 'ccrc-settings.timer');
    writeFileSync(join(home, 'fixture-unit-ccrc-settings.timer'), 'active\n');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).toContain('ccrc-settings.timer is active');
  });

  it('a box without the unit is never asked about it — no count moves', () => {
    const home = healthy('ccrc-doctor-services-settings-absent-');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).not.toContain('ccrc-settings');
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
