// `ccrc models …` (§10) — what the verb group DOES.
// `server/test/ccrc-cli.test.ts` owns its DISCOVERABILITY (the usage line),
// which is the split that file states verb by verb.
//
// A TOP-LEVEL verb, not a subverb of `ccrc account`: round-2 ruling 5, because
// `cmd_account` is the account-connections branch's and is not on `main`.
//
// The fixture is `ccrc-doctor-graphify.test.ts`'s box, for its reasons: HOME is
// a throwaway `mkTmp`; `ccrc` is invoked through `<home>/ccrc/ccd/ccrc`, the
// shape a deployed box has (deploy.sh rsyncs `ccd` whole) and the shape
// `CCRC_HERE` resolves `../deploy/models-op.mjs` against; `gh`, `curl`,
// `systemctl` and `launchctl` are poisoned beside it. This verb shells out to
// node and to the probe and to nothing else, which the cases below assert.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { CODEX } from './fixtures/modelCases.js';
import { randomBytes } from 'node:crypto';
import {
  assertManagerStandIns, authDirOf, codexAuthDir, freePort, freePorts, MANAGER_STANDIN_MARK, plantCodexBins,
  plantFakeRuntime, plantLaneAuth, probeArgv0, probeRuntime, probeRuntimeCalls,
} from './codexLaneFixture.js';
import { pythonOrSkip } from './ccgptHarness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
const CODEX_RAW = join(here, 'fixtures', 'catalogues', 'codex-raw-2026-09-08.json');
const COMPAT_RAW = join(here, 'fixtures', 'catalogues', 'compatible-raw.json');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

const ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'claude-a', label: 'claude-a', configDirSuffix: '.claude-a',
      exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    { id: 'gpt', label: 'gpt', configDirSuffix: '.claude-gpt',
      exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none' },
    // `secretsFile` is Task 8's: the model probe is a box-level executable
    // with no lane context, so `_models_endpoints` sources this file in a
    // subshell around the probe call, mirroring `shared/wrapper.mjs`'s own
    // generated line. Relative to $HOME, per `shared/roster.ts`'s SECRETS_SAFE_RE.
    { id: 'router', label: 'router', configDirSuffix: '.claude-router',
      exec: { kind: 'generated', secretsFile: '.secrets/router.env' }, homeAble: false, hue: 'blue',
      telemetry: 'none' },
    // Fix round 1, Finding 2: a SECOND openrouter-shaped lane, deliberately
    // with no `exec.secretsFile` at all — `router`'s own "no secrets file"
    // case only ever deleted the FILE while the roster row still declared
    // one, which stops at `_models_endpoints`'s `[ -r ]` guard inside the
    // secretsFile branch and never reaches the `else` (ambient-environment)
    // branch. This lane is what actually reaches it.
    { id: 'router2', label: 'router2', configDirSuffix: '.claude-router2',
      exec: { kind: 'external' }, homeAble: false, hue: 'green', telemetry: 'none' },
    // Final wave round 3, M1: a CODEX-shaped lane that also carries
    // `exec.secretsFile` — every other codex-shaped lane (`gpt`) has none, so
    // no fixture reached `_models_run_probe`'s secrets-file branch (the `if`
    // at `_models_run_probe`'s secrets-file branch) with a CHATGPT_TOKEN_DIR to scrub. The secrets file
    // this lane sources sets only ANTHROPIC_AUTH_TOKEN, the normal case: no
    // fleet secrets file sets CHATGPT_TOKEN_DIR.
    { id: 'gpt2', label: 'gpt2', configDirSuffix: '.claude-gpt2',
      exec: { kind: 'external', secretsFile: '.secrets/gpt2.env' }, homeAble: false, hue: 'amber',
      telemetry: 'none' },
  ],
};

let home: string;

/** A box carrying the tree `ccrc` resolves against — `ccrc-doctor-graphify.
 *  test.ts`'s `installCcrc`, with `ccrc-models-probe` added to the symlinked
 *  `ccd/` set because `ccrc models refresh` execs it out of `$CCRC_HERE`.
 *  `deploy` and `shared` are symlinked WHOLE: `deploy/models-op.mjs` imports
 *  three `../shared/*.mjs` modules and node resolves them through the link's
 *  realpath. */
function box(roster: unknown = ROSTER): string {
  const h = mkTmp('ccrc-models-verb-');
  const ccd = join(h, 'ccrc', 'ccd');
  fs.mkdirSync(ccd, { recursive: true });
  for (const f of ['ccrc', 'ccrc-wrapper-shape', 'ccrc-doctor-checks', 'ccrc-models-probe']) {
    fs.symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
  }
  fs.symlinkSync(join(REPO, 'deploy'), join(h, 'ccrc', 'deploy'));
  fs.symlinkSync(join(REPO, 'shared'), join(h, 'ccrc', 'shared'));
  fs.mkdirSync(join(h, '.ccrc'), { recursive: true });
  fs.writeFileSync(join(h, '.ccrc', 'accounts.json'), `${JSON.stringify(roster, null, 2)}\n`);
  env(h);
  return h;
}

/** Round 1 review, Important 2: the `no-answer` seam (`_models_answer`) had
 *  no test. Same box as `box()`, except `deploy/` is a REAL directory holding
 *  one symlink per file the repo's `deploy/` has, rather than one symlink to
 *  the whole directory — so a test can drop its OWN `models-op.mjs` in
 *  without touching the real one. `shared/` stays symlinked whole: a stub
 *  script never imports it, and the box still needs to look like a complete
 *  install for `ccrc-wrapper-shape` and the other symlinked `ccd/` files. */
function boxWithStubOp(stubSource: string, roster: unknown = ROSTER): string {
  const h = mkTmp('ccrc-models-verb-stubop-');
  const ccd = join(h, 'ccrc', 'ccd');
  fs.mkdirSync(ccd, { recursive: true });
  for (const f of ['ccrc', 'ccrc-wrapper-shape', 'ccrc-doctor-checks', 'ccrc-models-probe']) {
    fs.symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
  }
  const deploy = join(h, 'ccrc', 'deploy');
  fs.mkdirSync(deploy, { recursive: true });
  for (const f of fs.readdirSync(join(REPO, 'deploy'))) {
    if (f === 'models-op.mjs') continue;
    fs.symlinkSync(join(REPO, 'deploy', f), join(deploy, f));
  }
  fs.writeFileSync(join(deploy, 'models-op.mjs'), stubSource, { mode: 0o755 });
  fs.symlinkSync(join(REPO, 'shared'), join(h, 'ccrc', 'shared'));
  fs.mkdirSync(join(h, '.ccrc'), { recursive: true });
  fs.writeFileSync(join(h, '.ccrc', 'accounts.json'), `${JSON.stringify(roster, null, 2)}\n`);
  env(h);
  return h;
}

/** One `exec.kind: "codex"` roster row, its authDir the fixture's. Hoisted out of
 *  the codex-kind litellm describe by Plan 3a Task 1; that describe still uses it.
 *  `extraExec` adds exec fields (`secretsFile`, which a codex row may carry). */
const codexRow = (id: string, proxyPort: number, litellmPort: number,
  extraExec: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, label: id, configDirSuffix: `.claude-${id}`,
  exec: { kind: 'codex', provider: 'openai', proxyPort, litellmPort, authDir: codexAuthDir(id), ...extraExec },
  homeAble: false, telemetry: 'codex',
});

/** Plan 3a Task 1: `box()` with one codex row per id appended, each on two DISTINCT
 *  kernel-chosen ports (never a constant: the real lane library probes them), then
 *  `extra`. It replaces the box the file-level `beforeEach` made. */
async function codexBox(ids: readonly string[], extra: readonly Record<string, unknown>[] = []): Promise<string> {
  const ports = await freePorts(ids.length * 2);
  fs.rmSync(home, { recursive: true, force: true });
  return box({ ...ROSTER, accounts: [...ROSTER.accounts,
    ...ids.map((id, i) => codexRow(id, ports[2 * i]!, ports[2 * i + 1]!)), ...extra] });
}

/** Prints nothing and exits 0 — the pre-existing emptiness case. */
const STUB_SILENT_OK = '#!/usr/bin/env node\nprocess.exit(0);\n';
/** Prints a two-line, non-JSON stack to STDOUT and exits 7 — the exact shape
 *  the round 1 reviewer measured breaking both "exactly one JSON object on
 *  stdout" and the 0/1/2 exit-code contract at once. */
const STUB_STACK = "#!/usr/bin/env node\n"
  + "process.stdout.write('Error: kaboom\\n    at somewhere.js:12:34\\n');\n"
  + 'process.exit(7);\n';
/** Round 1 review addendum: the SAME two-line non-JSON body as `STUB_STACK`,
 *  but exiting 0 — INSIDE the rc-clamp's 0/1/2 allow-list, so this stub can
 *  be caught ONLY by the shape check, never by the clamp. `STUB_STACK`'s own
 *  exit 7 trips both guards at once, which is why removing the shape check
 *  alone left it green; this one isolates the shape check as its own
 *  measured, committed case. */
const STUB_STACK_EXIT0 = "#!/usr/bin/env node\n"
  + "process.stdout.write('Error: kaboom\\n    at somewhere.js:12:34\\n');\n"
  + 'process.exit(0);\n';
/** Prints one valid refusal object and exits 1 — the shape check and the
 *  rc-clamp must both let this through UNCHANGED. */
const STUB_VALID_REFUSAL = '#!/usr/bin/env node\n'
  + "process.stdout.write(JSON.stringify({ok:false,error:'roster-absent',detail:'stub refusal'}) + '\\n');\n"
  + 'process.exit(1);\n';
/** C2: a VALID object, `type=="object"`, rc 0 — `_models_answer`'s three
 *  clamps (non-empty, object, 0/1/2) all pass this — but with no `lanes`
 *  FIELD at all, the exact half-updated-box shape `_models_answer`'s own
 *  clamps do not reach: a node half new enough to answer at all, old enough
 *  that its `lanes` op does not exist yet. */
const STUB_VALID_NO_LANES = '#!/usr/bin/env node\n'
  + "process.stdout.write(JSON.stringify({ok:true}) + '\\n');\n"
  + 'process.exit(0);\n';
/** C9: the mirror image of `STUB_VALID_REFUSAL` — a VALID object (passes the
 *  shape check) at an exit code OUTSIDE the 0/1/2 clamp. `STUB_STACK`'s exit 7
 *  trips both the shape check AND the clamp at once, so it cannot isolate
 *  the clamp the way `STUB_STACK_EXIT0` isolates the shape check; nothing
 *  before this paired a valid body with an out-of-contract code. */
const STUB_VALID_EXIT7 = '#!/usr/bin/env node\n'
  + "process.stdout.write(JSON.stringify({ok:true,op:'show',id:'gpt'}) + '\\n');\n"
  + 'process.exit(7);\n';

function env(h: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  // Plan 2b-2 Task 6 (ruling R23): `ccrc models litellm|refresh` now reach
  // the codex lane library. `_models_litellm`'s dispatch asks `_codex_lanes`,
  // and a codex lane's render runs `_codex_tier_ours` and `_codex_lock`, whose
  // two bounds are ambient knobs. A runner's own value must never steer a
  // case, so neither is INHERITED. `extra` is applied after the deletion, so
  // a case that wants a bound still passes one.
  const inherited: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ['CCRC_CODEX_PROBE_S', 'CCRC_CODEX_READY_S']) delete inherited[k];
  const e = ghContainedEnv(h, { ...inherited, HOME: h, ...extra }, { systemd: true });
  const poison = (name: string, says: string): void =>
    fs.writeFileSync(join(h, '.local', 'bin', name),
      `#!/bin/sh\n${MANAGER_STANDIN_MARK}\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
      // C13: the header goes in via `curl -K -` on stdin now, never argv —
      // captured separately so a test can assert BOTH halves: argv never
      // carries the token, and stdin is where it actually went.
      + (name === 'curl' ? `cat >> "$HOME/${name}-stdin-poison" 2>/dev/null\n` : '')
      + `echo "${says}" >&2\nexit 97\n`, { mode: 0o755 });
  poison('curl', 'ccrc tests must never reach a real server');
  poison('systemctl', 'ccrc tests must never query this box\'s real systemd');
  poison('systemd-run', 'ccrc tests must never start a real transient unit on this box\'s systemd');
  poison('launchctl', 'ccrc tests must never query this box\'s real launchd');
  assertManagerStandIns(e, h);
  return e;
}

describe('the models harness containment wall', () => {
  it('plants and verifies both manager stand-ins in the final env', () => {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const start = src.indexOf('function env(');
    const body = src.slice(start, src.indexOf('\n}\n', start));
    expect(body).toContain('{ systemd: true }');
    expect(body).toContain('assertManagerStandIns(e, h);');
    expect(body.indexOf('assertManagerStandIns(e, h);')).toBeLessThan(body.indexOf('return e;'));
  });
});

interface Result { code: number; stdout: string; stderr: string }
function run(args: string[], extra: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, [join(home, 'ccrc', 'ccd', 'ccrc'), ...args],
    { env: env(home, extra), encoding: 'utf8', input: '' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The contract: stdout is EXACTLY one JSON object and nothing else. */
function oneObject(r: Result): Record<string, unknown> {
  const lines = r.stdout.split('\n');
  expect(lines[lines.length - 1], `stdout is not newline-terminated: ${JSON.stringify(r.stdout)}`).toBe('');
  expect(lines.length, `stdout carried ${lines.length - 1} lines, not one`).toBe(2);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

const poisonLog = (name: string): string[] => {
  const p = join(home, `${name}-poison`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

/** C13: what `curl` read on STDIN — where `-K -` now carries the
 *  Authorization header, so a caller can assert the token landed here and
 *  nowhere in {@link poisonLog}'s argv capture. */
const poisonStdin = (name: string): string => {
  const p = join(home, `${name}-stdin-poison`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

const registryOf = (id: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', `${id}.classes.json`), 'utf8'));

const writeCatalogue = (id: string, cat: unknown = CODEX): void => {
  fs.mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
  fs.writeFileSync(join(home, '.ccrc', 'models', `${id}.json`), JSON.stringify(cat));
};

// ── Task 6 (D-3482): the lane library, faked BY NAME ──────────
// The codex arm of `_models_litellm` asks four bash FUNCTIONS (the lane
// library and its lock), not two binaries on PATH, so the `pgrep`/`ccgpt` PATH stubs this
// file uses for the external arm cannot reach it. It is faked the way
// `ccrc-account.test.ts`'s `sourceCall` reaches a function: `ccd/ccrc` is
// SOURCED (the `BASH_SOURCE` guard at its foot exists for this), the named
// functions are redefined, and one call is made. Not `plantSystemd`
// (codexLaneFixture.ts): `env()` above re-plants its `systemctl` poison on
// EVERY `run()`, so a functional systemctl would be overwritten before it
// answered — and the claim here is what the models arm DOES with each
// answer, which a fake holding one answer still measures directly.
//
// A knob is `<home>/fake/<fn>-<id>` holding a code; absent → the fake's
// default. A NON-ZERO knob EXITS rather than returns, the way a `ccrc codex`
// refusal does, and every fake prints a stray line on STDOUT: a call site
// that forgot its subshell, or its `>/dev/null`, breaks the one-object
// envelope and reds, instead of passing on a fake that behaved politely.
// TWO EXCEPTIONS:
//   - `_codex_lock`: its knob RETURNS. A lock taken
//     in a subshell is released as the subshell exits, so the arm calls it in
//     its own shell and relies on its contract of returning — which the
//     install spine's callers need as well.
//   - `_codex_stop_tier` (ruling PF-21): the arm CAPTURES its stdout word —
//     `stopped` | `not running` | `foreign` — and never folds `foreign` into
//     stopped, so this fake's stdout is the real single-word contract, not a
//     "stray" line: `<home>/fake/stopword-<id>` (default `stopped`) picks the
//     word, and `<home>/fake/stop-<id>` (a nonzero rc) makes it EXIT with no
//     stdout at all, the way a stop-failed `_codex_stop_tier` does. Likewise
//     `_codex_start_tier`'s failure line goes on STDERR (ruling PF-26): the
//     arm appends its last stderr line to both `start-failed` details, so
//     this fake's failure line is what that assertion reads back.
//     F4/F5: the STOP also prints one STDERR line — the real
//     function's own shape — on a stop-failed exit (the specific
//     reason) and on a `foreign` word at rc 0 (what holds the port);
//     never on `stopped` or `not running`, matching `_codex_stop_tier`'s
//     own "$note" logic. The arm captures it via a tmp file and
//     appends it to `restart-failed` and `tier-foreign` alike.
//
// `_fk_probe` measures the REAL lock from OUTSIDE, only when
// `<home>/fake/probe-lock` exists: `flock -n` opens the lock file afresh,
// a new open file description, which a held flock refuses. It is off by
// default so no fake case creates a `.lock` file of its own.
const LANE_FAKE_PRELUDE = [
  // Review round 1: the `ours` fake's own per-call counter lives in a FILE
  // (below), because `_codex_tier_ours` is always called through a command
  // substitution subshell — an in-memory array's writes inside that subshell
  // never reach the parent (measured: it left every call reading count 1
  // forever). A file survives that boundary, so it is reset HERE, once, at
  // the top of every `sourced()` script: the SAME fixture box can run this
  // prelude across several SEPARATE bash processes in one test (the retry
  // case's two `sourced()` calls), and a counter file a PREVIOUS process
  // left behind must not make a fresh process's own first call read as its
  // second (measured: that broke the retry case, F5).
  'rm -f "$HOME"/fake/ours-n-* 2>/dev/null || :',
  '_fk_log() { printf \'%s\\n\' "$1" >> "$HOME/lane-calls"; }',
  // what the lane's config held AT THE MOMENT of the call: a STOP must see
  // the old bytes and a START the new ones — the ordering is the claim
  '_fk_cfg() { local f="$HOME/.ccrc/codex/$1/litellm.yaml"; if [ ! -f "$f" ]; then echo absent; elif grep -q "model_name:" "$f"; then echo new; else echo old; fi; }',
  '_fk_rc() { local k="$HOME/fake/$1-$2" rc="$3"; [ -f "$k" ] && rc="$(cat "$k")"; [ "$rc" -eq 0 ] && return 0; exit "$rc"; }',
  // The final-review fix wave (B1 at every site): the arm now reads the
  // tier question's verdict from a marker its subshell prints LAST, and an
  // `exit` inside the question leaves no marker — which is how a fault
  // inside the real library reads, and is refused as cannot-ask. The real
  // `_codex_tier_ours` always RETURNS its answer, so its fake does too.
  '_fk_ret() { local k="$HOME/fake/$1-$2" rc="$3"; [ -f "$k" ] && rc="$(cat "$k")"; return "$rc"; }',
  '_fk_probe() { [ -f "$HOME/fake/probe-lock" ] || return 0; if flock -n "$HOME/.ccrc/codex/$1/.lock" true 2>/dev/null; then echo "$2 free"; else echo "$2 held"; fi >> "$HOME/lock-probe"; }',
].join('\n');
const LANE_FAKES = {
  // The library's own sentence goes to STDERR, the way a `_codex_row`
  // refusal behind a 3 does: the arm must carry it, not discard it.
  //
  // Review round 1, item 5 (class fix): the arm now RE-ASKS this same
  // function right before the restart it owes, and starts only on a freshly
  // measured 1. So this fake counts its own calls per `<id> <tier>` key: the
  // 1st call answers from the `ours-<id>` knob (default 1, "not running"),
  // exactly as before, and every call after that answers from a SEPARATE
  // `ours2-<id>` knob (default 1, "not running" — the expected state right
  // after a stop that worked), so an EXISTING case that never sets `ours2`
  // gets the free-port re-ask its restart needs. `knob('ours2', id, rc)` is
  // this round's own addition, for the one new case that models a foreign
  // taker arriving strictly AFTER the stop. The counter FILE is reset at the
  // top of the prelude, above (this fake's own comment there says why it
  // must be a file, and why it must be reset per script).
  //
  // Review round 2, N1: a `whys2-<id>` file (`whyKnob(id, why)`) makes the
  // 2ND-AND-LATER call SILENT — no "stray library stdout", no "fake library
  // sentence" on stderr — and sets CX_TIER_WHY from its content BEFORE
  // returning, the real `_codex_tier_ours`'s own contract right before it
  // answers 2. Every existing case that never sets `whys2` is byte-identical
  // to before: the stray/sentence lines still print on every call.
  //
  // THIS ARM USES A PLAIN `return` ON EVERY PATH (`_fk_ret`), NEVER `_fk_rc`
  // (which `exit`s the whole subshell on a nonzero knob — right, for every
  // OTHER fake here, the way a refused library call really behaves, but
  // wrong for this one: the verdict is read from a marker printed after it
  // returns (the fix wave), and the
  // arm's own re-ask runs MORE code in the SAME subshell after this call
  // returns (`_codex_foreign_what`), and an `exit` inside this function
  // would end that subshell before any of it ran, the same way it would end
  // the real function — except the real one never exits, it returns
  // (measured: with `_fk_rc` here, `$recheck` came back empty every time).
  ours: '_codex_tier_ours() { _fk_log "ours $1 $2"; _fk_probe "$1" ours; '
    + 'local nf="$HOME/fake/ours-n-$1-$2" n=0; [ -f "$nf" ] && n="$(cat "$nf")"; n=$((n + 1)); mkdir -p "$HOME/fake"; printf \'%s\' "$n" > "$nf"; '
    + 'local wk="$HOME/fake/whys2-$1"; '
    + 'if [ "$n" -ge 2 ] && [ -f "$wk" ]; then '
    +   'CX_TIER_WHY="$(cat "$wk")"; local rk="$HOME/fake/ours2-$1" rc2=1; [ -f "$rk" ] && rc2="$(cat "$rk")"; return "$rc2"; '
    + 'elif [ "$n" -ge 2 ]; then echo "stray library stdout"; echo "fake library sentence for $1" >&2; _fk_ret ours2 "$1" 1; '
    + 'else echo "stray library stdout"; echo "fake library sentence for $1" >&2; _fk_ret ours "$1" 1; fi; }',
  // PF-21: the WORD is this fake's real stdout, not a "stray" line — the arm
  // captures it. A nonzero `stop-<id>` knob exits with NOTHING on stdout, the
  // way a stop-failed `_codex_stop_tier` does; on success it prints
  // `stopword-<id>` (default `stopped`).
  stop: '_codex_stop_tier() { _fk_log "stop $1 $2 cfg=$(_fk_cfg "$1")"; _fk_probe "$1" stop; '
    + 'local k="$HOME/fake/stop-$1" rc=0; [ -f "$k" ] && rc="$(cat "$k")"; '
    + 'if [ "$rc" -ne 0 ]; then echo "fake stop-failed for $1: no verified handle to stop it by" >&2; exit "$rc"; fi; '
    + 'local wk="$HOME/fake/stopword-$1" w=stopped; [ -f "$wk" ] && w="$(cat "$wk")"; '
    + '[ "$w" = foreign ] && echo "fake codex: $1: port held by a stranger \u2014 ccrc left it running." >&2; '
    + 'printf \'%s\\n\' "$w"; }',
  // PF-26: on failure this fake's STDERR carries one sentence, which the
  // arm's `start-failed` detail must append (its last line).
  start: '_codex_start_tier() { _fk_log "start $1 $2 cfg=$(_fk_cfg "$1")"; _fk_probe "$1" start; echo "stray library stdout"; '
    + 'local k="$HOME/fake/start-$1" rc=0; [ -f "$k" ] && rc="$(cat "$k")"; '
    + '[ "$rc" -eq 0 ] && return 0; echo "fake start-failed for $1" >&2; exit "$rc"; }',
  lock: '_codex_lock() { _fk_log "lock $1"; echo "stray library stdout"; local k="$HOME/fake/lock-$1"; [ -f "$k" ] && return "$(cat "$k")"; return 0; }',
  // Only for the one case that runs the REAL `_codex_start_tier`: records the
  // argv it is handed, one word per line, and answers as the systemd arm does.
  svc: '_svc_run_supervised() { printf \'%s\\n\' "$@" > "$HOME/svc-argv"; printf \'systemd %s\\n\' "$1"; }',
} as const;
type LaneFake = keyof typeof LANE_FAKES;

/** `ccd/ccrc` sourced, `fakes` redefined over the real library, then `call`
 *  (e.g. `cmd_models litellm codex-a`). `umask 022` first, so a directory
 *  mode this file asserts is this code's and not the runner's. */
function sourced(call: string, fakes: LaneFake[], extra: NodeJS.ProcessEnv = {}): Result {
  const script = ['umask 022', `. "${join(home, 'ccrc', 'ccd', 'ccrc')}"`, LANE_FAKE_PRELUDE,
    ...fakes.map((f) => LANE_FAKES[f]), call].join('\n');
  const r = spawnSync(BASH, ['-c', script], { env: env(home, extra), encoding: 'utf8', input: '' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const laneCalls = (): string[] => {
  const p = join(home, 'lane-calls');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

/** What `_fk_probe` saw of the lane lock, one `<fake> held|free` per call. */
const lockProbe = (): string[] => {
  const p = join(home, 'lock-probe');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

const knob = (fn: 'ours' | 'ours2' | 'stop' | 'start' | 'lock', id: string, rc: number): void => {
  fs.mkdirSync(join(home, 'fake'), { recursive: true });
  fs.writeFileSync(join(home, 'fake', `${fn}-${id}`), `${rc}\n`);
};

/** PF-21: the word `_codex_stop_tier` prints on stdout at rc 0. Default
 *  (no knob) is `stopped`. */
const stopWord = (id: string, word: 'stopped' | 'not running' | 'foreign'): void => {
  fs.mkdirSync(join(home, 'fake'), { recursive: true });
  fs.writeFileSync(join(home, 'fake', `stopword-${id}`), `${word}\n`);
};

/** Review round 2, N1: the CX_TIER_WHY the `ours` fake sets, silently, on
 *  its 2nd-and-later call for `id` — the real `_codex_tier_ours`'s own
 *  contract right before it answers 2. Also implies `knob('ours2', id, 2)`
 *  should be set by the caller: this alone does not change the returned rc. */
const whyKnob = (id: string, why: string): void => {
  fs.mkdirSync(join(home, 'fake'), { recursive: true });
  fs.writeFileSync(join(home, 'fake', `whys2-${id}`), `${why}\n`);
};

/** F7: every path under `dir`, relative to it and sorted — an absent `dir`
 *  is `[]`, never a throw, so a before/after pair around a refusal that is
 *  supposed to create nothing (PF-25) compares two lists rather than
 *  re-deriving one path the id happens to normalise to. */
const listUnder = (dir: string): string[] =>
  fs.existsSync(dir)
    ? (fs.readdirSync(dir, { recursive: true }) as string[]).slice().sort()
    : [];

beforeEach(() => { home = box(); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('the models dispatcher', () => {
  it('spells its per-lane subcommand list once, at file scope', () => {
    // The dispatcher below and the refusal that lists what this build
    // implements must read ONE string, or a subcommand can dispatch while the
    // refusal claims it does not exist.
    const src = fs.readFileSync(CCRC_SRC, 'utf8');
    const m = /^MODELS_SUBS="([^"]*)"$/m.exec(src);
    expect(m, 'ccd/ccrc has no file-scope MODELS_SUBS').toBeTruthy();
    expect(m![1]!.split(' ').filter(Boolean).sort())
      .toEqual(['discovery', 'init', 'rm', 'set-class', 'set-effort', 'set-subagent', 'show']);
  });

  it('spells the reserved first-token words once, at file scope', () => {
    // Deviation B-4: `refresh` and `litellm` are box-wide subcommands in the
    // slot an account id otherwise occupies, and an account id may legally BE
    // one of those words.
    const src = fs.readFileSync(CCRC_SRC, 'utf8');
    const m = /^MODELS_RESERVED="([^"]*)"$/m.exec(src);
    expect(m, 'ccd/ccrc has no file-scope MODELS_RESERVED').toBeTruthy();
    expect(m![1]!.split(' ').filter(Boolean).sort()).toEqual(['litellm', 'refresh']);
  });

  it('`_models_id_ok` reads the shared WRAPPER_ID_RE, not a hand-copied literal', () => {
    // Round 1 review, Important 3: a fourth typed-out `^[a-z][a-z0-9-]{0,31}$`
    // was the ONLY guard between `ccrc models <id> init` and a write outside
    // ~/.ccrc/models/ (`deploy/models-op.mjs` has no traversal guard of its
    // own), and it had drifted out of sync with `shared/roster.ts`'s ID_RE
    // three times already (`ccrc-wrapper-shape`'s own header). A static pin
    // so a fifth copy cannot creep back into this one function.
    const src = fs.readFileSync(CCRC_SRC, 'utf8');
    const m = /^_models_id_ok\(\) \{[\s\S]*?^\}$/m.exec(src);
    expect(m, 'ccd/ccrc has no _models_id_ok function').toBeTruthy();
    expect(m![0]).not.toContain('[a-z0-9-]{0,31}');
  });

  it('with nothing after it refuses at exit 2 with a body', () => {
    const r = run(['models']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('missing-argument');
  });

  it('with an id and no subcommand names the ones this build has', () => {
    const r = run(['models', 'gpt']);
    expect(r.code).toBe(2);
    const b = oneObject(r);
    expect(b['error']).toBe('missing-subcommand');
    expect(String(b['detail'])).toContain('show');
  });

  it('an unknown subcommand refuses at exit 2 rather than reaching node', () => {
    const r = run(['models', 'gpt', 'frobnicate']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-subcommand');
    expect(fs.existsSync(join(home, 'gh-poison'))).toBe(false);
  });

  it('an id that is not an id refuses at exit 2, before node', () => {
    const r = run(['models', '../escape', 'show']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('bad-account-id');
  });

  it('REFUSES an account literally named `refresh`, naming the collision (deviation B-4)', () => {
    // `ID_RE` allows it, and the grammar cannot allow both readings. The
    // refusal is at exit 2, on the ROSTER, and names the fix.
    fs.rmSync(home, { recursive: true, force: true });
    home = box({ ...ROSTER, accounts: [...ROSTER.accounts,
      { id: 'refresh', label: 'refresh', configDirSuffix: '.claude-refresh',
        exec: { kind: 'external' }, homeAble: false, hue: 'green', telemetry: 'none' }] });
    const r = run(['models', 'refresh', '--all']);
    expect(r.code).toBe(2);
    const b = oneObject(r);
    expect(b['error']).toBe('reserved-account-id');
    expect(String(b['detail'])).toContain('rename');
  });

  it('spells the implemented box-wide subcommands once, at file scope', () => {
    const src = fs.readFileSync(CCRC_SRC, 'utf8');
    const m = /^MODELS_BOX_SUBS="([^"]*)"$/m.exec(src);
    expect(m, 'ccd/ccrc has no file-scope MODELS_BOX_SUBS').toBeTruthy();
    expect(m![1]!.split(' ').filter(Boolean).sort()).toEqual(['litellm', 'refresh']);
  });
});

describe('ccrc models <id> show', () => {
  it('answers one JSON object and a human summary on STDERR', () => {
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['ok']).toBe(true);
    expect(b['id']).toBe('gpt');
    expect(b['registry']).toBeNull();
    // The verb's contract is one object on stdout; a person still needs a
    // sentence, so it goes where a sentence goes.
    expect(r.stderr).toMatch(/never probed/);
    expect(r.stderr).toMatch(/no class registry yet/);
  });

  it('--json prints the object and NOTHING on stderr', () => {
    const r = run(['models', 'gpt', 'show', '--json']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['ok']).toBe(true);
    expect(r.stderr).toBe('');
  });

  it('summarises a probed, seeded lane: the four unclassified, the missing fable, the subagent', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect((b['derived'] as { unclassified: string[] }).unclassified).toHaveLength(4);
    expect(r.stderr).toContain('gpt-6-astra');
    expect(r.stderr).toMatch(/fable\s+—/);
    expect(r.stderr).toMatch(/subagents run as sonnet/);
  });

  it('names the render failure on a lane whose subagent is a legacy opus/fable (fix round 2A, N1)', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    // A registry already on disk with `subagent: opus`, the way a lane set
    // up before the 2026-09-09 narrowing would still read — `parseRegistry`
    // reads it faithfully; `show` must NAME why nothing can be materialised.
    const p = join(home, '.ccrc', 'models', 'gpt.classes.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.subagent = 'opus';
    fs.writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(String(b['renderRefusal'])).toMatch(/must be haiku or sonnet/);
    expect(r.stderr).toMatch(/the env block cannot be materialised: .*must be haiku or sonnet/);
    expect(r.stderr).toMatch(/set-subagent <haiku\|sonnet>/);
    // NEW-2 (round 3): the resolution parenthetical is only ever true when a
    // block was actually materialised — on this legacy lane nothing was, so
    // "subagents run as opus (gpt-5.6-sol)" would be a fabrication naming a
    // model that never runs a subagent.
    expect(r.stderr).not.toMatch(/subagents run as opus \(gpt-5\.6-sol\)/);
    expect(r.stderr).toMatch(/NOT in force/);
  });

  it('an anthropic lane answers read-only and says why', () => {
    const r = run(['models', 'claude-a', 'show']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['registry']).toBeNull();
    expect(r.stderr).toMatch(/Claude Code's own defaults/);
  });

  it('names a drifted settings key in the summary, with the remedy', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    const p = join(home, '.claude-gpt', 'settings.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.env.ANTHROPIC_MODEL = 'wrong';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    const r = run(['models', 'gpt', 'show']);
    expect(oneObject(r)['settingsDrift']).toEqual(['ANTHROPIC_MODEL']);
    expect(r.stderr).toMatch(/settings\.json has drifted/);
  });

  it('an ORPHAN registry — no roster row for this id — answers orphan:true rather than refusing (§11)', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    fs.writeFileSync(join(home, '.ccrc', 'models', 'ghost.classes.json'),
      fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.json'), 'utf8'));
    const r = run(['models', 'ghost', 'show']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['orphan']).toBe(true);
    expect((b['derived'] as { available: string[] }).available).toEqual([]);
  });

  it('a refusal still carries exactly one JSON object on stdout', () => {
    fs.rmSync(join(home, '.ccrc', 'accounts.json'));
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('roster-absent');
  });

  it('reaches node and NOTHING else — no curl, no systemctl, no gh', () => {
    run(['models', 'gpt', 'show']);
    expect(poisonLog('curl')).toEqual([]);
    expect(poisonLog('systemctl')).toEqual([]);
    expect(fs.existsSync(join(home, 'gh-poison'))).toBe(false);
  });

  it('takes only --json', () => {
    const r = run(['models', 'gpt', 'show', '--wat']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });
});

describe('ccrc models <id> init', () => {
  it('seeds the gpt registry and materialises, at exit 0', () => {
    const r = run(['models', 'gpt', 'init', 'codex']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['created']).toBe(true);
    expect((registryOf('gpt')['classes'] as Record<string, unknown>)['opus']).toBe('gpt-5.6-sol');
    expect(registryOf('gpt')['subagent']).toBe('sonnet');
    const settings = JSON.parse(fs.readFileSync(join(home, '.claude-gpt', 'settings.json'), 'utf8'));
    expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
  });

  it('needs a probe kind', () => {
    const r = run(['models', 'gpt', 'init']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toContain('probe');
  });

  it('refuses an unknown probe kind at exit 2, before node runs', () => {
    const r = run(['models', 'gpt', 'init', 'gemini']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-probe');
  });

  it('refuses `openai` with its own sentence — that is a PROVIDER, not a probe kind', () => {
    const r = run(['models', 'gpt', 'init', 'openai']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toMatch(/spelled "codex"/);
  });

  it('refuses `anthropic` with its own sentence', () => {
    const r = run(['models', 'claude-a', 'init', 'anthropic']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toMatch(/Claude Code's own defaults/);
  });

  it('passes --base-url through for a compatible lane', () => {
    const r = run(['models', 'router', 'init', 'compatible', '--base-url', 'https://api.cortecs.ai']);
    expect(r.code).toBe(0);
    expect(registryOf('router')['baseUrl']).toBe('https://api.cortecs.ai');
  });

  it('an openrouter lane is created unseeded and prints the remedy', () => {
    const r = run(['models', 'router', 'init', 'openrouter']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['created']).toBe(true);
    expect(String(b['remedy'])).toMatch(/discovery add/);
    // Carry-forward 10: the remedy reaches the HUMAN stream too, not only
    // the JSON a person never reads (m-spine §8: `_models_answer` is the site).
    expect(r.stderr).toMatch(/^ccrc: probe "openrouter" ships no seed mapping/m);
    expect(r.stderr).toMatch(/discovery add/);
  });

  it('takes no extra argument', () => {
    const r = run(['models', 'gpt', 'init', 'codex', 'extra']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });
});

// Spec §5.4: `~/.ccrc/codex/<id>/lane.json`, the one manifest the lane's
// launcher, shim and usage publisher read so none of them re-derives a path
// from a naming convention. Its writer is the materialiser, so rule 3 of
// `deploy/models-op.mjs`'s header ("MATERIALISE ON SUCCESS") is what re-renders
// it — which is what this case drives, through the verb as a box runs it:
// `init`, then a reclassification. The payload's every field is
// `models-op.test.ts`'s; this file owns the claim that the VERB reaches it.
describe('lane.json — the codex lane manifest (spec §5.4)', () => {
  const CODEX_LANE = {
    id: 'codex-a', label: 'codex-a', configDirSuffix: '.claude-codex-a',
    exec: { kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011, authDir: '.codex-a-auth' },
    homeAble: false, telemetry: 'codex',
  };
  const laneOf = (): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(join(home, '.ccrc', 'codex', 'codex-a', 'lane.json'), 'utf8'));
  const haikuOf = (): unknown => (registryOf('codex-a')['classes'] as Record<string, unknown>)['haiku'];

  beforeEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    home = box({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_LANE] });
  });

  it('init writes it, and a later reclassification re-renders probeModel from the registry', () => {
    expect(run(['models', 'codex-a', 'init', 'codex']).code).toBe(0);
    const lane = laneOf();
    expect(lane['id']).toBe('codex-a');
    expect(lane['authDir']).toBe('.codex-a-auth');
    // D-3158: the key name is a cross-plan contract — ccd/ccgpt-usage.py reads
    // exactly `probeModel`, and its own fixture cannot prove the producer
    // agrees. The value is the REGISTRY's haiku class, read back off the file.
    expect(typeof haikuOf()).toBe('string');
    expect(lane['probeModel']).toBe(haikuOf());
    // Rule 3: an accepted mutation re-renders it. The id is one `init`'s seed
    // does not carry, so a writer that read the seed rather than the registry
    // on disk stays on the old value and reds here.
    expect(run(['models', 'codex-a', 'set-class', 'haiku', 'gpt-x-mini']).code).toBe(0);
    expect(haikuOf()).toBe('gpt-x-mini');
    expect(laneOf()['probeModel']).toBe('gpt-x-mini');
  });

  it('a mutation that leaves haiku null prints its remedy on STDERR, and one that does not prints nothing there (carry-forward 10)', () => {
    expect(run(['models', 'codex-a', 'init', 'codex']).code).toBe(0);
    // One model, one class: giving sonnet haiku's model MOVES haiku to null
    // (models-op.test.ts' own case, driven through the verb here).
    const r = run(['models', 'codex-a', 'set-class', 'sonnet', String(haikuOf())]);
    expect(r.code, r.stderr).toBe(0);
    expect(String(oneObject(r)['remedy'])).toMatch(/usage publisher refuses/);
    expect(r.stderr).toMatch(/^ccrc: account "codex-a" routes haiku to nothing/m);
    expect(r.stderr).toContain("'ccrc models codex-a set-class haiku <modelId>'");
    // Control: an answer with no remedy leaves stderr EMPTY — the line is
    // keyed on the field, never printed on every answer.
    const back = run(['models', 'codex-a', 'set-class', 'haiku', 'gpt-x-mini']);
    expect(back.code, back.stderr).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(oneObject(back), 'remedy')).toBe(false);
    expect(back.stderr).toBe('');
  });
});

// Round 1 review, Important 2: `_models_answer`'s seam had no test at all —
// `grep -n no-answer server/test/ccrc-models.test.ts` found nothing. These
// three drop a STUB `deploy/models-op.mjs` into the fixture box, through
// `boxWithStubOp`, and drive it through `ccrc models <id> show` — the seam
// itself does not care which subcommand called it.
describe('the _models_answer seam ("no-answer")', () => {
  it('the node half prints nothing and exits 0: refused, not a silent drop', () => {
    fs.rmSync(home, { recursive: true, force: true });
    home = boxWithStubOp(STUB_SILENT_OK);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('no-answer');
    expect(r.stderr).not.toBe('');
  });

  it('the node half prints a bare stack and exits 7: refused, not two stray lines on stdout', () => {
    // This is the case the round 1 review measured: emptiness alone let both
    // lines of the stack through as if they were the promised JSON object,
    // and the caller's exit code was the node half's raw 7, not this file's
    // own 0/1/2.
    fs.rmSync(home, { recursive: true, force: true });
    home = boxWithStubOp(STUB_STACK);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('no-answer');
    expect(r.stderr).not.toBe('');
  });

  it('the node half prints a bare stack and exits 0: refused by the SHAPE check alone', () => {
    // Round 1 review addendum: `STUB_STACK`'s exit 7 trips the rc-clamp too,
    // so removing the shape check leaves that case green — the clamp alone
    // still catches it. This stub's exit code (0) is inside the clamp's
    // 0/1/2 allow-list, so ONLY the shape check can refuse it; the mutation
    // check below removes that check and expects exactly this case to go
    // red while (b) stays green.
    fs.rmSync(home, { recursive: true, force: true });
    home = boxWithStubOp(STUB_STACK_EXIT0);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('no-answer');
    expect(r.stderr).not.toBe('');
  });

  it('the node half prints one valid refusal object and exits 1: passed through unchanged', () => {
    // The shape check and the rc clamp must not turn a REAL refusal from
    // deploy/models-op.mjs into a manufactured "no-answer" — that would hide
    // the node half's own diagnosis behind this seam's.
    fs.rmSync(home, { recursive: true, force: true });
    home = boxWithStubOp(STUB_VALID_REFUSAL);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('roster-absent');
    expect(b['detail']).toBe('stub refusal');
  });

  it('the node half prints a VALID object and exits 7: refused by the RC CLAMP alone (C9)', () => {
    // The clamp's own comment names this exact case: "a node half that prints
    // a VALID object but exits some fourth code ... must not leak that code
    // past ccrc's own promise." STUB_VALID_EXIT7 is inside the shape check
    // (a real JSON object) and outside the clamp (exit 7) — the one
    // combination that isolates the clamp from the shape check, the mirror of
    // what STUB_STACK_EXIT0 does for the shape check.
    fs.rmSync(home, { recursive: true, force: true });
    home = boxWithStubOp(STUB_VALID_EXIT7);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('no-answer');
    expect(r.stderr).not.toBe('');
  });
});

// C2: `_models_answer`'s three clamps (non-empty, object, 0/1/2) all pass a
// valid-but-fieldless body — none of them check that the body carries the
// FIELDS the caller for this op then reads. `refresh --all` used to read
// `.lanes[]` with no shape guard of its own: on a body missing `lanes`, that
// jq call failed, the loop variable and its count both went empty, the
// `while` loop never ran, and the tail printed `all(.ok)` over an empty
// array — `ok:true`, exit 0 — over a body the seam's own comment says "must
// not reach the caller as a bare exit code".
describe('ccrc models refresh --all guards the lanes answer\'s SHAPE, not just its emptiness (C2)', () => {
  it('a valid object with no "lanes" field is a no-answer refusal, never a zero-row ok:true', () => {
    home = boxWithStubOp(STUB_VALID_NO_LANES);
    const r = run(['models', 'refresh', '--all']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['ok']).toBe(false);
    expect(b['error']).toBe('no-answer');
    expect(r.stderr).not.toBe('');
    expect(r.stderr.split('\n').filter((l) => l.length > 0).every((l) => l.startsWith('ccrc:'))).toBe(true);
  });

  it('the named-lane form already refuses correctly, unaffected by this guard', () => {
    home = boxWithStubOp(STUB_VALID_NO_LANES);
    const r = run(['models', 'refresh', 'router']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('no-answer');
  });
});

describe('ccrc models <id> set-class', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('assigns a class and rewrites the lane\'s settings.json and TSV', () => {
    const r = run(['models', 'gpt', 'set-class', 'fable', 'gpt-6-astra']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['ok']).toBe(true);
    const settings = JSON.parse(fs.readFileSync(join(home, '.claude-gpt', 'settings.json'), 'utf8'));
    expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('gpt-6-astra');
    expect(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.tsv'), 'utf8'))
      .toContain('fable\tgpt-6-astra\tassigned\n');
  });

  it('`none` clears it', () => {
    const r = run(['models', 'gpt', 'set-class', 'opus', 'none']);
    expect(r.code).toBe(0);
    expect((registryOf('gpt')['classes'] as Record<string, unknown>)['opus']).toBeNull();
    expect(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.tsv'), 'utf8'))
      .toContain('opus\t\tunassigned\n');
  });

  it('refuses a class that is not one of the four, at exit 2, before node', () => {
    const r = run(['models', 'gpt', 'set-class', 'subagent', 'gpt-5.5']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-class');
    expect(String(oneObject(r)['detail'])).toMatch(/set-subagent/);
  });

  it('needs both a class and a model', () => {
    expect(run(['models', 'gpt', 'set-class', 'fable']).code).toBe(2);
    expect(run(['models', 'gpt', 'set-class']).code).toBe(2);
  });

  it('takes no third argument', () => {
    const r = run(['models', 'gpt', 'set-class', 'fable', 'gpt-6-astra', 'extra']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });
});

describe('ccrc models <id> set-subagent', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('moves CLAUDE_CODE_SUBAGENT_MODEL, and nothing else in the block', () => {
    // `haiku`, not `opus`: fix round 1, v2 (2026-09-09) restricts `subagent`
    // to haiku/sonnet — opus is refused (see below).
    const before = JSON.parse(fs.readFileSync(join(home, '.claude-gpt', 'settings.json'), 'utf8'));
    const r = run(['models', 'gpt', 'set-subagent', 'haiku']);
    expect(r.code).toBe(0);
    const after = JSON.parse(fs.readFileSync(join(home, '.claude-gpt', 'settings.json'), 'utf8'));
    expect(after.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('haiku');
    expect(after.env.ANTHROPIC_MODEL).toBe(before.env.ANTHROPIC_MODEL);
    expect(after.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(before.env.ANTHROPIC_DEFAULT_SONNET_MODEL);
  });

  it.each(['opus', 'fable'])(
    'refuses %s: measured 2026-09-09 on Claude Code 2.1.267, it runs on the sonnet slot regardless',
    (cls) => {
      const r = run(['models', 'gpt', 'set-subagent', cls]);
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('subagent-class-unsupported');
      expect(String(oneObject(r)['detail'])).toMatch(/haiku or sonnet/);
    },
  );

  it('refuses a class whose slot is null, naming set-class', () => {
    // `haiku`, not `fable`: fix round 1, v2 (2026-09-09) restricts `subagent`
    // to haiku/sonnet, so a null-slot case has to be a class the new gate
    // still lets through — haiku, nulled first, rather than fable (which is
    // now refused before this check is ever reached).
    run(['models', 'gpt', 'set-class', 'haiku', 'none']);
    const r = run(['models', 'gpt', 'set-subagent', 'haiku']);
    expect(r.code).toBe(1);
    expect(String(oneObject(r)['detail'])).toMatch(/set-class haiku/);
  });

  it('refuses a word that is not a class, at exit 2', () => {
    const r = run(['models', 'gpt', 'set-subagent', 'sonnet-class']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-class');
  });

  it('needs a class', () => {
    expect(run(['models', 'gpt', 'set-subagent']).code).toBe(2);
  });
});

describe('ccrc models <id> set-effort', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('sets a level and it reaches the effort file the shim reads', () => {
    const r = run(['models', 'gpt', 'set-effort', 'sonnet', 'xhigh']);
    expect(r.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.effort.json'), 'utf8'))
      .byModel['gpt-5.6-terra']).toBe('xhigh');
  });

  it('refuses a level the classed model does not offer', () => {
    const r = run(['models', 'gpt', 'set-effort', 'haiku', 'ultra']);
    expect(r.code).toBe(1);
    expect(String(oneObject(r)['detail'])).toContain('gpt-5.6-luna');
  });

  it('refuses a class that is not one of the four, at exit 2', () => {
    const r = run(['models', 'gpt', 'set-effort', 'subagent', 'high']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-class');
  });
});

describe('ccrc models <id> discovery', () => {
  const whitelist = (providers: string[]): void => {
    fs.mkdirSync(join(home, '.handoff'), { recursive: true });
    fs.writeFileSync(join(home, '.handoff', 'providers-whitelist.json'), JSON.stringify({ providers }));
  };
  const endpointsFixture = (names: string[]): string => {
    const p = join(home, 'endpoints-fixture.json');
    fs.writeFileSync(p, JSON.stringify({ data: { endpoints: names.map((n) => ({ provider_name: n })) } }));
    return p;
  };
  // The probe is a box-level executable with no lane context (Task 8's
  // controller ruling): `_models_endpoints` supplies the lane's key by
  // sourcing this file in a SUBSHELL around the probe call, never in ccrc's
  // own shell — the same line `shared/wrapper.mjs`'s generated wrapper emits.
  const writeSecrets = (exportIt = true): void => {
    fs.mkdirSync(join(home, '.secrets'), { recursive: true });
    fs.writeFileSync(join(home, '.secrets', 'router.env'),
      `${exportIt ? 'export ' : ''}ANTHROPIC_AUTH_TOKEN=lane-token\n`);
  };

  it('add and rm on a codex lane, with no whitelist question asked', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    const r = run(['models', 'gpt', 'discovery', 'add', 'gpt-5.5']);
    expect(r.code).toBe(0);
    // `deploy/models-op.mjs`'s scope conversion (Task 6, ruling 2026-09-08):
    // every already-classed id, in CLASSES order, THEN the new one — not the
    // brief's literal order, which predates that ruling.
    expect(registryOf('gpt')['discovery']).toEqual(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.5']
      .filter((x) => (registryOf('gpt')['discovery'] as string[]).includes(x)));
    expect(fs.existsSync(join(home, '.handoff', 'providers-whitelist.json'))).toBe(false);
    expect(run(['models', 'gpt', 'discovery', 'catalogue']).code).toBe(0);
    expect(registryOf('gpt')['discovery']).toBe('catalogue');
  });

  it('an unknown action is a usage error naming the three', () => {
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'router', 'discovery', 'purge']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toContain('catalogue');
  });

  it('catalogue takes no model id', () => {
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'router', 'discovery', 'catalogue', 'gpt-5.5']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });

  // Fix round 1, Finding 1: the pre-check `show` call used to re-label EVERY
  // node refusal as `no-answer` — the empty-body seam's reserved "the build
  // is broken, redeploy" code — discarding node's own diagnosis. `ghost` is
  // never created in this describe block, so its `id` passes `_models_id_ok`
  // (a legal shape, not a reserved word) and reaches node, which refuses
  // `no-such-account` — the most common operator mistake this pre-check can
  // hit: a typo'd or already-removed id.
  it('a typo\'d or removed id gets node\'s own no-such-account, not a masked no-answer', () => {
    const r = run(['models', 'ghost', 'discovery', 'add', 'gpt-5.5']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('no-such-account');
  });

  describe('the ownership whitelist, on an openrouter lane only (§5)', () => {
    beforeEach(() => {
      run(['models', 'router', 'init', 'openrouter']);
      writeSecrets();
    });

    it('admits a model a whitelisted provider serves, and says which', () => {
      whitelist(['fireworks']);
      const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: endpointsFixture(['Fireworks', 'Z.AI']) });
      expect(r.code).toBe(0);
      expect(oneObject(r)['servedBy']).toEqual(['fireworks']);
      expect(registryOf('router')['discovery']).toEqual(['z-ai/glm-5.2']);
    });

    it('refuses when no whitelisted provider serves it, and writes nothing', () => {
      whitelist(['fireworks']);
      const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: endpointsFixture(['Z.AI']) });
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('no-allowed-provider');
      expect(registryOf('router')['discovery']).toEqual([]);
    });

    it('refuses when the endpoints call itself fails, and writes nothing', () => {
      whitelist(['fireworks']);
      const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: join(home, 'nope') });
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('endpoints-unreachable');
      expect(registryOf('router')['discovery']).toEqual([]);
    });

    it('rm never asks the whitelist question — removing needs no permission', () => {
      whitelist(['fireworks']);
      run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: endpointsFixture(['Fireworks']) });
      const r = run(['models', 'router', 'discovery', 'rm', 'z-ai/glm-5.2']);
      expect(r.code).toBe(0);
      expect(registryOf('router')['discovery']).toEqual([]);
    });

    it('leaves no endpoints temp file behind', () => {
      // Tightened per the brief's own Step 8 caveat: measured on this box,
      // `_plat_mktemp`'s bare `mktemp` call (CCD_OS=linux, the non-darwin arm)
      // DOES honour $TMPDIR, and its default name (`tmp.XXXXXXXXXX`) carries
      // no "endpoints" substring — so a leak would land outside `home` AND
      // fail the old filter's own name check. Pointing $TMPDIR at an empty
      // directory this test owns, and asserting THAT directory ends up empty,
      // is what actually observes the leak this case exists to catch.
      whitelist(['fireworks']);
      const tmpdir = join(home, 'tmpdir-for-endpoints');
      fs.mkdirSync(tmpdir);
      run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
        { CCRC_MODELS_PROBE_FIXTURE: endpointsFixture(['Fireworks']), TMPDIR: tmpdir });
      expect(fs.readdirSync(tmpdir)).toEqual([]);
    });

    // Controller ruling on `_models_endpoints` (Task 8, predates the brief):
    // the probe has no lane context, so a lane with no `exec.secretsFile` and
    // no ambient key gets the probe's OWN refusal, surfaced unchanged.
    it('with no secrets file and no ambient token, refuses with the probe\'s own message', () => {
      fs.rmSync(join(home, '.secrets', 'router.env'));
      const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'], { ANTHROPIC_AUTH_TOKEN: '' });
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('endpoints-unreachable');
      expect(String(oneObject(r)['detail'])).toContain('needs the lane\'s key: set ANTHROPIC_AUTH_TOKEN');
    });

    // No CCRC_MODELS_PROBE_FIXTURE here — the fixture seam bypasses the token
    // check entirely, so it cannot prove the token flowed anywhere. Instead
    // this drives the REAL openrouter fetch arm, whose `curl` the harness
    // poisons: the poison harness records curl's own argv AND its stdin
    // separately (C13: the header travels on stdin via `curl -K -`, never
    // argv), so a `Bearer lane-token` on STDIN proves the secrets file's
    // token reached the probe's request while argv stays clean — and neither
    // reaches ccrc's own environment or output. Measured: dropping `export`
    // from the secrets file (`writeSecrets(false)`) leaves the subshell's
    // ANTHROPIC_AUTH_TOKEN unexported, so `exec`ing the probe does not
    // inherit it, the probe's own token gate refuses BEFORE curl runs, and
    // this case reds.
    it('sources the lane\'s secrets file for the probe; the token never reaches ccrc\'s own output', () => {
      const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2']);
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('endpoints-unreachable');
      expect(poisonStdin('curl')).toContain('Bearer lane-token');
      expect(poisonLog('curl').join('\n')).not.toContain('lane-token');
      expect(poisonLog('curl').join('\n')).not.toContain('Authorization');
      expect(r.stdout).not.toContain('lane-token');
      expect(r.stderr).not.toContain('lane-token');
    });
  });

  // Fix round 1, Finding 2 (superseded by the final wave's C3 fix):
  // `_models_endpoints`'s `else` (ambient-environment) branch — taken when the
  // roster row has NO `exec.secretsFile` at all — was executed by zero tests.
  // `router`'s "no secrets file" case only deletes the FILE while the row
  // still declares one, which stops at the `[ -r ]` guard inside the `if`
  // branch. `router2` carries no `secretsFile` in the roster at all, so
  // `secrets` is empty and this describe's cases are the ones that actually
  // reach the `else`. C3 (final wave): `_models_run_probe` now unsets the
  // credential names the probe honours in BOTH branches before running it, so
  // there is no longer an "ambient environment" for a secrets-file-less lane
  // to inherit — a lane with no secrets file gets NO token, full stop, and
  // always surfaces the probe's own refusal, whatever the calling shell
  // happens to be carrying.
  describe('the ambient-environment branch, on a lane with no exec.secretsFile (§5)', () => {
    beforeEach(() => { run(['models', 'router2', 'init', 'openrouter']); });

    it('with no ambient token, refuses with the probe\'s own message', () => {
      const r = run(['models', 'router2', 'discovery', 'add', 'z-ai/glm-5.2'], { ANTHROPIC_AUTH_TOKEN: '' });
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('endpoints-unreachable');
      expect(String(oneObject(r)['detail'])).toContain('needs the lane\'s key: set ANTHROPIC_AUTH_TOKEN');
    });

    // C3: the ambient token here stands in for another lane's key already
    // sitting in the calling shell's environment — exactly what
    // `shared/wrapper.mjs`'s generated wrapper sources before exec'ing
    // `claude`. MEASURED before the fix: this reached curl as `Bearer
    // ambient-token`, i.e. a lane with no secrets file forwarded whatever key
    // the calling session happened to carry. After the fix, `_models_run_
    // probe` unsets it before the probe ever runs, so router2 never sees it
    // and the probe refuses before curl is invoked at all.
    it('with an ambient token, still refuses — a lane with no secrets file never sees the calling shell\'s own key', () => {
      const r = run(['models', 'router2', 'discovery', 'add', 'z-ai/glm-5.2'],
        { ANTHROPIC_AUTH_TOKEN: 'ambient-token' });
      expect(r.code).toBe(1);
      expect(oneObject(r)['error']).toBe('endpoints-unreachable');
      expect(String(oneObject(r)['detail'])).toContain('needs the lane\'s key: set ANTHROPIC_AUTH_TOKEN');
      expect(poisonLog('curl')).toEqual([]);
      expect(r.stdout).not.toContain('ambient-token');
      expect(r.stderr).not.toContain('ambient-token');
    });
  });

  // C3: the `compatible` arm is the one the finding's own repro exercises —
  // an ambient `ANTHROPIC_AUTH_TOKEN` (another lane's key, already in the
  // calling shell) reaching THIS lane's `baseUrl`, a host that key was never
  // issued for. Same fix, same shape as the openrouter case above: no secrets
  // file means no token reaches curl, whatever the calling shell carries.
  it('C3: a compatible lane with no secrets file never forwards an ambient token to its own baseUrl either', () => {
    run(['models', 'router2', 'init', 'compatible', '--base-url', 'https://vendor.example.com']);
    const r = run(['models', 'refresh', 'router2'], { ANTHROPIC_AUTH_TOKEN: 'ambient-token' });
    expect(r.code).toBe(1);
    expect(poisonLog('curl').join('\n')).not.toContain('ambient-token');
    expect(poisonLog('curl').join('\n')).not.toContain('Authorization');
    // C13 moved the header off argv onto curl's stdin (`-K -`), so an argv-only
    // check passes even when the token still reaches curl: this is the arm the
    // finding's own repro exercises, and it must never appear on stdin either.
    expect(poisonStdin('curl')).not.toContain('ambient-token');
    expect(r.stdout).not.toContain('ambient-token');
    expect(r.stderr).not.toContain('ambient-token');
  });

  // Item 3 of the final wave's round 2: `_models_run_probe` unsets
  // CHATGPT_TOKEN_DIR now too — the codex arm's own credential
  // (`ccrc-models-probe`'s `_fetch_codex` reads it to find `auth.json`), for
  // the same reason as ANTHROPIC_AUTH_TOKEN above: a lane with no secrets
  // file must not inherit whatever CHATGPT_TOKEN_DIR the calling shell
  // happens to carry, e.g. another lane's real token directory. `litellm` and
  // the venv `python` beside it are poisoned so a leak would be OBSERVABLE
  // without this test ever making a real network call: `_fetch_codex`
  // resolves its interpreter off `command -v litellm`, so the poisoned
  // `litellm` on PATH redirects it to the poisoned `python` right beside it,
  // which never runs at all when the scrub holds — the bash-level `[ -f
  // "$token_dir/auth.json" ]` guard refuses first, against the DEFAULT
  // directory, because the ambient one never reached `$token_dir`.
  it('an ambient CHATGPT_TOKEN_DIR pointing at a poisoned auth.json never reaches a codex lane\'s fetch', () => {
    const poisonedDir = join(home, 'someone-elses-chatgpt-auth');
    fs.mkdirSync(poisonedDir, { recursive: true });
    fs.writeFileSync(join(poisonedDir, 'auth.json'), JSON.stringify({ account_id: 'leaked-account-id' }));
    fs.writeFileSync(join(home, '.local', 'bin', 'litellm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(join(home, '.local', 'bin', 'python'),
      '#!/bin/sh\nprintf \'%s\\n\' "$CHATGPT_TOKEN_DIR" >> "$HOME/python-poison"\nexit 1\n', { mode: 0o755 });
    run(['models', 'gpt', 'init', 'codex']);
    const r = run(['models', 'refresh', 'gpt'], { CHATGPT_TOKEN_DIR: poisonedDir });
    expect(r.code).toBe(1);
    expect(fs.existsSync(join(home, 'python-poison')),
      'a scrubbed CHATGPT_TOKEN_DIR leaves no auth.json for the codex fetch to find, so it must refuse before the interpreter ever runs')
      .toBe(false);
    expect(r.stdout).not.toContain(poisonedDir);
    expect(r.stdout).not.toContain('leaked-account-id');
    expect(r.stderr).not.toContain(poisonedDir);
    expect(r.stderr).not.toContain('leaked-account-id');
  });

  // Round 3 re-review, M1: the test above only ever reaches the `else`
  // (no-secrets-file) branch of `_models_run_probe` — `gpt` has none. `gpt2`
  // carries `exec.secretsFile`, sourcing a file that sets ONLY
  // ANTHROPIC_AUTH_TOKEN, so this drives the `if` branch (`_models_run_probe`'s `if [ -n "$secrets" ]` branch)
  // instead: the secrets file it sources never mentions CHATGPT_TOKEN_DIR, so
  // the only thing that can keep an ambient one out is that branch's own
  // `unset`. MEASURED: deleting that `unset` (leaving the `[ -r ]`-and-source
  // line as the branch's first statement) reds this case — the poisoned
  // `python` runs and records the ambient directory — while the test above
  // stays green, because it never touches this branch at all.
  it('a codex lane with a secrets file that sets only ANTHROPIC_AUTH_TOKEN still scrubs an ambient CHATGPT_TOKEN_DIR', () => {
    fs.mkdirSync(join(home, '.secrets'), { recursive: true });
    fs.writeFileSync(join(home, '.secrets', 'gpt2.env'), 'export ANTHROPIC_AUTH_TOKEN=lane-token\n');
    const poisonedDir = join(home, 'someone-elses-chatgpt-auth-2');
    fs.mkdirSync(poisonedDir, { recursive: true });
    fs.writeFileSync(join(poisonedDir, 'auth.json'), JSON.stringify({ account_id: 'leaked-account-id' }));
    fs.writeFileSync(join(home, '.local', 'bin', 'litellm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(join(home, '.local', 'bin', 'python'),
      '#!/bin/sh\nprintf \'%s\\n\' "$CHATGPT_TOKEN_DIR" >> "$HOME/python-poison"\nexit 1\n', { mode: 0o755 });
    run(['models', 'gpt2', 'init', 'codex']);
    const r = run(['models', 'refresh', 'gpt2'], { CHATGPT_TOKEN_DIR: poisonedDir });
    expect(r.code).toBe(1);
    expect(fs.existsSync(join(home, 'python-poison')),
      'a secrets file that sets a different credential must not leave CHATGPT_TOKEN_DIR for the codex fetch to inherit from the calling shell')
      .toBe(false);
    expect(r.stdout).not.toContain(poisonedDir);
    expect(r.stderr).not.toContain(poisonedDir);
  });

  // Round 3 re-review, M1's second half: an UNREADABLE secrets file (`[ -r ]`
  // false) sources nothing, which must not be mistaken for "nothing to
  // scrub" — the ambient ANTHROPIC_AUTH_TOKEN has to go regardless of
  // whether the file could be read. MEASURED: deleting the secrets-file
  // branch's `unset` reds this case too (the ambient token reaches curl's
  // stdin and a real request is attempted, which the poisoned curl records),
  // while the existing "no secrets file at all" cases above (`router2`, and
  // `router` with the file deleted) never exercise this `[ -r ]`-false path.
  it('with an unreadable secrets file, sourcing nothing still scrubs the ambient token', () => {
    run(['models', 'router', 'init', 'openrouter']);
    fs.mkdirSync(join(home, '.secrets'), { recursive: true });
    fs.writeFileSync(join(home, '.secrets', 'router.env'), 'export ANTHROPIC_AUTH_TOKEN=lane-token\n');
    fs.chmodSync(join(home, '.secrets', 'router.env'), 0o000);
    const r = run(['models', 'router', 'discovery', 'add', 'z-ai/glm-5.2'],
      { ANTHROPIC_AUTH_TOKEN: 'ambient-token' });
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('endpoints-unreachable');
    expect(String(oneObject(r)['detail'])).toContain('needs the lane\'s key: set ANTHROPIC_AUTH_TOKEN');
    expect(poisonLog('curl')).toEqual([]);
    expect(poisonStdin('curl')).not.toContain('ambient-token');
    expect(r.stdout).not.toContain('ambient-token');
    expect(r.stderr).not.toContain('ambient-token');
  });
});

// ── Plan 3a Task 1 (spec §9.1, D-3706): each codex lane's probe reads its OWN
// OAuth through its OWN runtime. `_models_run_probe` exports the inputs and the
// codex-lane marker for an exec.kind "codex" row, after the scrub and after
// any secrets file. Every other row keeps today's probe environment exactly
// (operator ruling Z1): the two CHATGPT_TOKEN_DIR scrub cases in the describe
// above still hold it, unchanged. CONTAINMENT FIRST: every case poisons a PATH
// `litellm` and the `python` beside it, so no old or mutated probe can reach
// the runner's own LiteLLM.
describe.skipIf(pythonOrSkip() === null)('each codex lane\'s probe reads its OWN authDir through its OWN runtime, with no default; every other row keeps today\'s probe environment (Plan 3a Task 1)', () => {
  const poisonedDir = (): string => join(home, 'someone-elses-token-dir');
  const poisonRan = (): boolean => fs.existsSync(join(home, 'python-poison'));
  const poisonPathLitellm = (): string => {
    const bin = join(home, '.local', 'bin');
    fs.writeFileSync(join(bin, 'litellm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const p = join(bin, 'python');
    fs.writeFileSync(p, '#!/bin/sh\nprintf \'%s\\n\' "$0" >> "$HOME/python-poison"\nexit 1\n', { mode: 0o755 });
    return p;
  };
  const rowsOf = (r: Result): Record<string, unknown>[] => oneObject(r)['refreshed'] as Record<string, unknown>[];

  it('two codex lanes: each probe is handed its own authDir and the resolved runtime — never the other lane\'s, an ambient one, or a secrets file\'s', async () => {
    const [pa, la, pb, lb] = await freePorts(4);
    fs.rmSync(home, { recursive: true, force: true });
    home = box({ ...ROSTER, accounts: [...ROSTER.accounts,
      codexRow('codex-a', pa!, la!), codexRow('codex-b', pb!, lb!, { secretsFile: '.secrets/codex-b.env' })] });
    const poison = poisonPathLitellm();
    fs.mkdirSync(poisonedDir(), { recursive: true });
    fs.writeFileSync(join(poisonedDir(), 'auth.json'), JSON.stringify({ account_id: 'leaked-account-id' }));
    // codex-b's secrets file (legal on a codex row) tries to hand its probe
    // another directory and another interpreter. The codex inputs are exported
    // AFTER it is sourced, so neither may win.
    fs.mkdirSync(join(home, '.secrets'), { recursive: true });
    fs.writeFileSync(join(home, '.secrets', 'codex-b.env'),
      `export CHATGPT_TOKEN_DIR=${poisonedDir()}\nexport CCRC_CODEX_PYTHON=${poison}\n`);
    plantCodexBins(home);
    const pr = probeRuntime(home, CODEX_RAW);
    const rt = plantFakeRuntime(home, { python: pr.python });
    for (const id of ['codex-a', 'codex-b']) {
      plantLaneAuth(home, id);
      expect(run(['models', id, 'init', 'codex']).code).toBe(0);
    }
    const r = run(['models', 'refresh', '--all'], { CHATGPT_TOKEN_DIR: poisonedDir(), CCRC_CODEX_PYTHON: poison });
    expect(rowsOf(r).map((x) => [x['id'], x['ok']])).toEqual([['codex-a', true], ['codex-b', true]]);
    expect(r.code, 'refresh --all').toBe(0);
    const calls = probeRuntimeCalls(pr.rec);
    expect(calls.map((c) => c.env['CHATGPT_TOKEN_DIR']).sort())
      .toEqual([authDirOf(home, 'codex-a'), authDirOf(home, 'codex-b')]);
    expect(calls.map((c) => c.requests[0]?.headers['chatgpt-account-id']).sort())
      .toEqual(['acct-codex-a', 'acct-codex-b']);
    expect(probeArgv0(pr.rec)).toEqual([rt.python, rt.python]);
    for (const id of ['codex-a', 'codex-b']) {
      const cat = JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', `${id}.json`), 'utf8')) as { models: unknown[] };
      expect(cat.models, id).toHaveLength(9);
    }
    expect(poisonRan(), 'an interpreter the runtime did not resolve ran').toBe(false);
    expect(r.stdout + r.stderr).not.toContain(poisonedDir());
    expect(r.stdout + r.stderr).not.toContain('leaked-account-id');
  });

  it('a codex lane with no runtime refuses runtime-absent, naming ccrc install — an ambient interpreter and the PATH litellm never run', async () => {
    home = await codexBox(['codex-a']);
    const poison = poisonPathLitellm();
    plantCodexBins(home);                      // ccgpt-runtime is placed; no generation is built
    plantLaneAuth(home, 'codex-a');
    expect(run(['models', 'codex-a', 'init', 'codex']).code).toBe(0);
    const r = run(['models', 'refresh', 'codex-a'], { CCRC_CODEX_PYTHON: poison });
    expect(r.code).toBe(1);
    const [row] = rowsOf(r);
    expect(row).toMatchObject({ id: 'codex-a', probe: 'codex', ok: false });
    // Booleans: before this task the reason names the probe's default
    // directory, a real lane's path, which a failing `toMatch` would print.
    expect(/runtime-absent: run ccrc install/.test(String(row!['reason'])), 'the runtime-absent refusal').toBe(true);
    expect(poisonRan(), 'an inherited interpreter ran').toBe(false);
  });

  it('a codex lane whose authDir holds no auth.json is not-logged-in, naming ccrc codex login, and no interpreter runs', async () => {
    home = await codexBox(['codex-a']);
    poisonPathLitellm();
    plantCodexBins(home);
    const pr = probeRuntime(home, CODEX_RAW);
    plantFakeRuntime(home, { python: pr.python });
    expect(run(['models', 'codex-a', 'init', 'codex']).code).toBe(0);
    const r = run(['models', 'refresh', 'codex-a']);
    expect(r.code).toBe(1);
    expect(/not-logged-in: run ccrc codex login codex-a/.test(String(rowsOf(r)[0]!['reason'])), 'the not-logged-in refusal').toBe(true);
    expect(probeArgv0(pr.rec)).toEqual([]);
    expect(poisonRan()).toBe(false);
  });

  it('_models_run_probe hands a codex row its own authDir, runtime and marker; every other row gets neither marker nor runtime, and today\'s CHATGPT_TOKEN_DIR', async () => {
    home = await codexBox(['codex-a']);
    plantCodexBins(home);
    const rt = plantFakeRuntime(home);
    fs.mkdirSync(join(home, '.secrets'), { recursive: true });
    fs.writeFileSync(join(home, '.secrets', 'router.env'), 'export ANTHROPIC_AUTH_TOKEN=lane-token\n'
      + `export CHATGPT_TOKEN_DIR=${join(home, 'from-a-secrets-file')}\nexport CCRC_CODEX_PYTHON=${join(home, 'from-a-secrets-file-py')}\n`
      + 'export CCRC_PROBE_LANE_KIND=codex\n');
    // The ambient marker is a value no row would get, so a codex row's own
    // export is what the first expectation reads, never an inherited one.
    const ambient = { CHATGPT_TOKEN_DIR: join(home, 'ambient-dir'), CCRC_CODEX_PYTHON: join(home, 'ambient-py'), CCRC_PROBE_LANE_KIND: 'ambient' };
    const seen = (id: string): Record<string, string> => {
      const r = sourced(`_models_run_probe ${id} env`, [], ambient);
      expect(r.code, r.stderr).toBe(0);
      return Object.fromEntries(r.stdout.split('\n')
        .filter((l) => /^(CHATGPT_TOKEN_DIR|CCRC_CODEX_PYTHON|CCRC_PROBE_LANE_KIND)=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    };
    expect(seen('codex-a')).toEqual({
      CHATGPT_TOKEN_DIR: authDirOf(home, 'codex-a'), CCRC_CODEX_PYTHON: rt.python, CCRC_PROBE_LANE_KIND: 'codex' });
    // Z1: what the probe got before this task, and nothing more. The scrub
    // keeps an ambient CHATGPT_TOKEN_DIR out; a secrets file's value still
    // reaches the probe; the marker and the interpreter never do.
    expect(seen('router'), 'a row with a secrets file').toEqual({ CHATGPT_TOKEN_DIR: join(home, 'from-a-secrets-file') });
    expect(seen('router2'), 'a row with none').toEqual({});
  });
});

describe('ccrc models <id> rm (§4.1 Lifecycle, §10, §11) — reap, not a mutation', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('removes all four files and clears exactly the eight env keys, leaving another env key', () => {
    const p = join(home, '.claude-gpt', 'settings.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.env.DISABLE_TELEMETRY = '1';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    const r = run(['models', 'gpt', 'rm']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['ok']).toBe(true);
    expect((b['removed'] as string[]).length).toBe(4);
    expect(b['settings']).toBe('cleared');
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.classes.json'))).toBe(false);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.json'))).toBe(false);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.classes.tsv'))).toBe(false);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.effort.json'))).toBe(false);
    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(after.env.DISABLE_TELEMETRY).toBe('1');
    expect(Object.keys(after.env)).not.toContain('ANTHROPIC_MODEL');
  });

  it('a second run exits 0 with removed: []', () => {
    run(['models', 'gpt', 'rm']);
    const r = run(['models', 'gpt', 'rm']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['removed']).toEqual([]);
  });

  it('refuses an argument at exit 2', () => {
    const r = run(['models', 'gpt', 'rm', 'extra']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });

  it('an orphan — a registry for an id the fixture roster has no row for — reports settings: orphan', () => {
    fs.writeFileSync(join(home, '.ccrc', 'models', 'ghost.classes.json'),
      fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.json'), 'utf8'));
    const r = run(['models', 'ghost', 'rm']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['settings']).toBe('orphan');
  });
});

describe('ccrc models refresh', () => {
  // Controller ruling on this task: a successfully-refreshed CODEX lane now
  // runs the litellm step (§5), which shells out to `pgrep` (is the proxy
  // running?) and, conditionally, `ccgpt stop`. The fixture HOME rule forbids
  // reaching this box's real binaries, so every test in this describe gets a
  // functional stub — not just the ones that name `gpt` explicitly — planted
  // BEFORE each case, the same shape `describe('ccrc models litellm')`'s own
  // `pgrep`/`ccgpt` helpers use. Harmless for a test that never refreshes a
  // codex lane: the litellm step never runs there (§5, "non-codex lanes never
  // trigger the litellm step"), so the stub just sits unused.
  beforeEach(() => {
    fs.writeFileSync(join(home, '.local', 'bin', 'pgrep'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/pgrep-calls"\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccgpt-calls"\nexit 0\n', { mode: 0o755 });
  });

  it('with no argument is a usage error naming both forms', () => {
    const r = run(['models', 'refresh']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toContain('--all');
  });

  it('refreshes one lane and writes its catalogue', () => {
    run(['models', 'gpt', 'init', 'codex']);
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['ok']).toBe(true);
    expect(b['refreshed']).toEqual([{ id: 'gpt', probe: 'codex', ok: true, count: 9, litellm: 'rendered' }]);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.json'))).toBe(true);
  });

  it('re-materialises the lane it refreshed, so the effort file is freshly rewritten from the new catalogue', () => {
    // Fix round 1, Finding 3: the original version of this test set no
    // effort level of its own, so `SEEDS.codex`'s own `effort` map (written,
    // unvalidated, by `init`'s OWN materialise call, before any catalogue
    // exists) was byte-identical to what `refresh`'s re-materialise would
    // separately produce — the test stayed green with that re-materialise
    // call deleted entirely (measured directly).
    //
    // A CONTENT-based fix (e.g. `set-effort haiku ultra` before any catalogue
    // exists, expecting the catalogue to DROP it once one arrives) does not
    // work either — measured directly, not just reasoned: `parseRegistry`
    // (`shared/models.mjs`) and `effortFile` (`shared/modelenv.mjs`) run the
    // IDENTICAL "does the classed model's own `efforts` list include this
    // level" check against the SAME catalogue, and `materialise`'s general op
    // path calls `readRegistry` — which runs `parseRegistry` — BEFORE it ever
    // calls `effortFile`. So a level the new catalogue would have DROPPED
    // instead makes the whole re-materialise call REFUSE (`registry-invalid`)
    // first, and that refusal is swallowed by refresh's own `|| true` (the
    // deferred masking minor) — leaving the file exactly as stale as if
    // refresh's materialise call had never run at all: no observable
    // difference, for the same underlying reason as the original bug.
    // `effortFile`'s own "dropped, not refused" case is consequently
    // unreachable through this call path for ANY registry that stays valid.
    //
    // What genuinely differs, provably, on every refresh — independent of
    // registry content — is that `materialise` always does a fresh
    // `writeFileSync(tmp) + renameSync(tmp, path)` (`deploy/models-op.mjs`),
    // which replaces the file's INODE even when the bytes it writes are
    // identical. `test/ccd-swap-carry.test.ts` and
    // `test/install-graphify-skill.test.ts` use the same `.ino` idiom for
    // "was this file freshly rewritten, not merely left alone". Measured:
    // with the mutation below (deleting the materialise call), the inode is
    // IDENTICAL before and after, because nothing touches the file during
    // refresh at all.
    run(['models', 'gpt', 'init', 'codex']);
    const effortPath = join(home, '.ccrc', 'models', 'gpt.effort.json');
    const before = fs.statSync(effortPath).ino;
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const after = fs.statSync(effortPath).ino;
    expect(after).not.toBe(before);
    // The content itself is, correctly, unchanged (SEEDS.codex's own
    // haiku/sonnet/opus levels are all valid against CODEX_RAW) — the TSV
    // sibling test below is what a CONTENT difference (a RETIRED class)
    // actually looks like.
    expect(JSON.parse(fs.readFileSync(effortPath, 'utf8')))
      .toEqual({ byModel: { 'gpt-5.6-luna': 'high', 'gpt-5.6-terra': 'high', 'gpt-5.6-sol': 'max' } });
  });

  it('re-materialises the TSV too, so a RETIRED class is visible to ccd', () => {
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'gpt', 'set-class', 'sonnet', 'gpt-5.5-mini']);
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.tsv'), 'utf8'))
      .toContain('sonnet\tgpt-5.5-mini\tretired\n');
  });

  it('--all probes every lane that HAS a registry, and no others', () => {
    // The probe kind lives in the registry file (round-2 ruling 10), so a lane
    // without one has no probe to run — asking would be a question with no
    // answer. `router` is initialised too, so this run is a MIXED result:
    // its normaliser refuses a Codex body.
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'refresh', '--all'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const refreshed = oneObject(r)['refreshed'] as { id: string }[];
    expect(refreshed.map((x) => x.id)).toEqual(['gpt', 'router']);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'claude-a.json'))).toBe(false);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'claude.json'))).toBe(false);
  });

  it('--all with NO registries anywhere is an empty, successful run', () => {
    const r = run(['models', 'refresh', '--all']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['refreshed']).toEqual([]);
  });

  it('--all exits 1 when any lane failed, and still reports the ones that worked', () => {
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'refresh', '--all'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(1);
    const rows = oneObject(r)['refreshed'] as { id: string; ok: boolean }[];
    expect(rows.find((x) => x.id === 'gpt')!.ok).toBe(true);
    expect(rows.find((x) => x.id === 'router')!.ok).toBe(false);
  });

  // C7 (second half): re-materialise's failure used to be swallowed
  // (`_models_node materialise ... || true`), so a lane whose catalogue had
  // just refreshed kept reporting `ok:true` with a fresh `count` while its
  // TSV/settings.json stayed STALE — the exact silent-drift shape the row's
  // own STOP-THEN-WRITE comment already refuses for LiteLLM. Forcing
  // materialise to fail deterministically: pre-creating a DIRECTORY at the
  // TSV path it writes means its `renameSync(tmp, p)` throws (p is not a
  // file), the same failure shape a permissions or disk-full problem would
  // produce on a real box.
  it('a lane whose re-materialise fails is a FAILED row, and litellm never runs (C7)', () => {
    run(['models', 'gpt', 'init', 'codex']);
    const tsvPath = join(home, '.ccrc', 'models', 'gpt.classes.tsv');
    fs.rmSync(tsvPath, { force: true });
    fs.mkdirSync(tsvPath);
    const r = run(['models', 'refresh', '--all'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['ok']).toBe(false);
    const rows = b['refreshed'] as { id: string; ok: boolean; reason?: string; litellm?: string }[];
    expect(rows).toEqual([{ id: 'gpt', ok: false, reason: expect.any(String) }]);
    expect(rows[0]!.reason!.length).toBeGreaterThan(0);
    // The probe's own effect stands (§6.1 amendment: a failed materialise
    // does not undo a successful catalogue fetch) — only the derived files
    // and the LiteLLM step, which reads them, are what the failure gates.
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.json'))).toBe(true);
    expect(fs.existsSync(join(home, '.handoff', 'litellm-config.yaml'))).toBe(false);
    expect(fs.existsSync(join(home, 'ccgpt-calls')), 'the litellm step must never run when materialise failed').toBe(false);
  });

  it('refuses an id the roster does not have', () => {
    const r = run(['models', 'refresh', 'ghost']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('no-such-lane');
  });

  it('refuses a lane with no registry, naming init', () => {
    const r = run(['models', 'refresh', 'gpt']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('no-such-lane');
    expect(String(oneObject(r)['detail'])).toMatch(/init/);
  });

  it('refuses an anthropic lane by name — there is nothing to probe (§5)', () => {
    const r = run(['models', 'refresh', 'claude-a']);
    expect(r.code).toBe(1);
    expect(String(oneObject(r)['detail'])).toMatch(/Claude Code's own defaults/);
  });

  it('passes a compatible lane\'s baseUrl to the probe', () => {
    run(['models', 'router', 'init', 'compatible', '--base-url', 'https://api.cortecs.ai']);
    const r = run(['models', 'refresh', 'router'], { CCRC_MODELS_PROBE_FIXTURE: COMPAT_RAW });
    expect(r.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', 'router.json'), 'utf8')).probe)
      .toBe('compatible');
  });

  // Controller ruling on this task (predates the brief): `_models_refresh_one`
  // runs the probe through the SAME secrets-sourcing subshell
  // `_models_endpoints` uses — factored into `_models_run_probe` — so a
  // `compatible` lane's catalogue fetch (which sends `ANTHROPIC_AUTH_TOKEN` as
  // a Bearer header, `ccrc-models-probe`'s `compatible` fetch arm) gets the
  // lane's key too. No `CCRC_MODELS_PROBE_FIXTURE` here — that seam bypasses
  // the fetch (and so the header) entirely, so it cannot prove the token
  // flowed anywhere; this drives the REAL `compatible` fetch arm, whose
  // `curl` the harness poisons, exactly as the discovery describe block's own
  // served-by test does for `_models_endpoints`. The poison harness records
  // curl's own argv AND its stdin separately (C13: the header travels on
  // stdin via `curl -K -`, never argv) — a `Bearer lane-token` on STDIN
  // proves the secrets file's token reached the probe's request while argv
  // stays clean, and the failing curl (poison exits 97) is what "refresh"
  // being wired straight through the real fetch arm looks like on this box:
  // the catalogue fetch fails, the lane's previous (nonexistent) catalogue
  // stays absent, and the run reports that one lane failed.
  it('sources the lane\'s secrets file for the compatible probe too; the token never reaches ccrc\'s own output', () => {
    fs.mkdirSync(join(home, '.secrets'), { recursive: true });
    fs.writeFileSync(join(home, '.secrets', 'router.env'), 'export ANTHROPIC_AUTH_TOKEN=lane-token\n');
    run(['models', 'router', 'init', 'compatible', '--base-url', 'https://api.cortecs.ai']);
    const r = run(['models', 'refresh', 'router']);
    expect(r.code).toBe(1);
    // Fix round 1, Finding 2 (ruling): every failed row now carries `reason`
    // (the probe's own first stderr line) — `count` dropped from a failed
    // row entirely, since it was always 0 and never a fact about the lane.
    const refreshed = oneObject(r)['refreshed'] as { id: string; probe: string; ok: boolean; reason: string }[];
    expect(refreshed).toEqual([{ id: 'router', probe: 'compatible', ok: false, reason: expect.any(String) }]);
    expect(refreshed[0]!.reason.length).toBeGreaterThan(0);
    expect(poisonStdin('curl')).toContain('Bearer lane-token');
    expect(poisonLog('curl').join('\n')).not.toContain('lane-token');
    expect(poisonLog('curl').join('\n')).not.toContain('Authorization');
    expect(r.stdout).not.toContain('lane-token');
    expect(r.stderr).not.toContain('lane-token');
  });

  it('a single-lane failure exits 1 and leaves the previous catalogue stale, not deleted', () => {
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: join(home, 'nope') });
    expect(r.code).toBe(1);
    const cat = JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.json'), 'utf8'));
    expect(cat.stale).toBe(true);
    expect(cat.models).toHaveLength(9);
  });

  it('takes one lane id or --all and nothing more', () => {
    const r = run(['models', 'refresh', 'gpt', '--all']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });

  // Fix round 1, Finding 1: `_models_answer lanes --file "$file"` can return
  // non-zero carrying a LEGITIMATE refusal body from node (a corrupt
  // accounts.json is the reachable case; the half-updated-box `no-answer`
  // seam is the other). The old `|| exit $?` captured that body into `$lanes`
  // (a command-substitution local) and exited without ever printing it —
  // empty stdout, a real refusal silently lost. `oneObject()` is what would
  // have caught it: an empty-stdout run fails on "stdout carried 0 lines, not
  // one" before ever reaching `error`.
  it('a corrupt accounts.json is reported as node\'s own refusal, not an empty stdout (Fix round 1, Finding 1)', () => {
    fs.writeFileSync(join(home, '.ccrc', 'accounts.json'), '{not json');
    const r = run(['models', 'refresh', '--all']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('roster-invalid');
  });

  // Fix round 1, Finding 2 (ruling): `hasRegistry` used to be computed AFTER
  // a catalogue-read shortcut that treated a broken CATALOGUE as "no
  // registry at all" — hiding the one lane `readCatalogue`'s own refusal text
  // names `ccrc models refresh <id>` as the remedy for. `readRegistry` now
  // always runs, so a valid registry behind a corrupt catalogue is still
  // found and still refreshed.
  it('a lane whose catalogue is corrupt is still refreshed, and repaired (Fix round 1, Finding 2)', () => {
    // `init` itself refuses on an already-broken catalogue file (the general
    // op path's early `cat.err` gate), so the registry has to be seeded
    // first, with no catalogue file yet, and the catalogue corrupted after.
    run(['models', 'gpt', 'init', 'codex']);
    fs.writeFileSync(join(home, '.ccrc', 'models', 'gpt.json'), '{"probe":"gemini"}');
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(0);
    expect(oneObject(r)['refreshed'])
      .toEqual([{ id: 'gpt', probe: 'codex', ok: true, count: 9, litellm: 'rendered' }]);
    const cat = JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.json'), 'utf8'));
    expect(cat.models).toHaveLength(9);
  });

  // The other half of the same ruling: a REGISTRY that exists but does not
  // parse/validate is `hasRegistry: true` with `probe: null` — the old code
  // fed the literal string "null" to the probe as its probe kind. Such a row
  // is now reported as a failed row named by the registry's own message,
  // without ever reaching the probe.
  it('a lane whose registry does not parse/validate is a failed row with a reason, and never reaches the probe (Fix round 1, Finding 2)', () => {
    fs.mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
    // No `subagent` key — the same fixture `models-op.test.ts`'s own
    // registry-invalid case uses.
    fs.writeFileSync(join(home, '.ccrc', 'models', 'gpt.classes.json'),
      JSON.stringify({ probe: 'codex', classes: { haiku: null, sonnet: null, opus: null, fable: null } }));
    const r = run(['models', 'refresh', '--all'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(1);
    const rows = oneObject(r)['refreshed'] as Record<string, unknown>[];
    const row = rows.find((x) => x['id'] === 'gpt')!;
    expect(row['ok']).toBe(false);
    expect(String(row['reason'])).toContain('subagent');
    expect('probe' in row).toBe(false);
    expect('count' in row).toBe(false);
    // The probe was never invoked: no catalogue landed for this lane.
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.json'))).toBe(false);
  });

  it('refresh <id> on a lane whose registry does not parse/validate refuses with that message, not no-such-lane (Fix round 1, Finding 2)', () => {
    fs.mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(join(home, '.ccrc', 'models', 'gpt.classes.json'),
      JSON.stringify({ probe: 'codex', classes: { haiku: null, sonnet: null, opus: null, fable: null } }));
    const r = run(['models', 'refresh', 'gpt']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('registry-invalid');
    expect(String(oneObject(r)['detail'])).toContain('subagent');
  });

  // Controller ruling on this task: the beforeEach's functional stubs prove
  // the litellm step BEHAVES correctly; this proves it never falls through to
  // whatever real `pgrep`/`ccgpt` this box happens to have on PATH if a stub
  // were ever missing — the same poisoned-tools pattern `env()` uses for
  // curl, systemctl and launchctl (`poisonLog`), applied here to the two
  // binaries this step is new for. Poisoned rather than stubbed: both always
  // exit 97 and log their argv, so `_models_litellm_running`'s nonzero-exit
  // "not running" reading holds even under a poison, and the assertion is
  // that `ccgpt`'s poison log — the restart step — stays EMPTY: a restart is
  // not expected when nothing looks like it is running.
  it('never reaches a real pgrep or ccgpt — poisoned, and no restart fires when neither looks running', () => {
    fs.writeFileSync(join(home, '.local', 'bin', 'pgrep'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/pgrep-poison"\n'
      + 'echo "ccrc tests must never reach a real pgrep" >&2\nexit 97\n', { mode: 0o755 });
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccgpt-poison"\n'
      + 'echo "ccrc tests must never reach a real ccgpt" >&2\nexit 97\n', { mode: 0o755 });
    run(['models', 'gpt', 'init', 'codex']);
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(0);
    expect(poisonLog('ccgpt')).toEqual([]);
  });
});

describe('ccrc models litellm', () => {
  const configPath = (): string => join(home, '.handoff', 'litellm-config.yaml');

  /** A `pgrep` that answers "LiteLLM is running" or "it is not", and records
   *  its argv — the probe `ccrc` uses to decide whether a restart is owed. */
  const pgrep = (running: boolean): void =>
    fs.writeFileSync(join(home, '.local', 'bin', 'pgrep'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/pgrep-calls"\n${running ? 'echo 4242\nexit 0' : 'exit 1'}\n`,
      { mode: 0o755 });

  /** A `ccgpt` that records its argv instead of stopping a real proxy. */
  const ccgpt = (): void =>
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccgpt-calls"\nexit 0\n', { mode: 0o755 });

  const calls = (name: string): string[] => {
    const p = join(home, `${name}-calls`);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
  };

  beforeEach(() => {
    pgrep(false); ccgpt();
    run(['models', 'gpt', 'init', 'codex']);
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    fs.rmSync(join(home, 'ccgpt-calls'), { force: true });
    fs.rmSync(configPath(), { force: true });
    fs.rmSync(`${configPath()}.prev`, { force: true });
  });

  it('renders the config from the lane\'s catalogue, with no reasoning key', () => {
    const r = run(['models', 'litellm', 'gpt']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['changed']).toBe(true);
    const yaml = fs.readFileSync(configPath(), 'utf8');
    // Scoped to the GENERATED block, not the whole file — the shipped
    // template's own header comment (carried verbatim) legitimately says
    // "reasoning" explaining why there is none; `litellm-render.test.ts`'s
    // own template-level case already bans a literal `reasoning:` key
    // anywhere, including in a comment.
    expect(yaml.slice(yaml.indexOf('model_list:'), yaml.indexOf('litellm_settings:'))).not.toContain('reasoning');
    expect(yaml).toContain('  - model_name: gpt-6-astra');
    // No `[1m]` alias in the GENERATED block (§6.3, amended 2026-09-08, Task
    // 16c; scoped in fix round 1 — the template's own header comment, carried
    // verbatim, now legitimately says `[1m]` explaining why there is none, so
    // a whole-file ban would fail on that prose, same as the `reasoning` ban
    // above). A fleet-host measurement found the catalogue's advertised
    // context is not the usable one, so the generator stops emitting a name
    // that would tell Claude Code it has 1M of room — the backend has no such
    // NAME (the removed alias mapped to the real id all along); the client's
    // window BELIEF was the lie (2026-07-26).
    expect(yaml.slice(yaml.indexOf('model_list:'), yaml.indexOf('litellm_settings:'))).not.toMatch(/\[1m\]/);
    expect(yaml).not.toContain('gpt-reserve');
  });

  it('is idempotent — a second run reports changed:false and touches nothing', () => {
    run(['models', 'litellm', 'gpt']);
    const before = fs.statSync(configPath()).mtimeMs;
    const r = run(['models', 'litellm', 'gpt']);
    expect(oneObject(r)['changed']).toBe(false);
    expect(fs.statSync(configPath()).mtimeMs).toBe(before);
  });

  it('keeps the previous config beside the new one', () => {
    fs.mkdirSync(join(home, '.handoff'), { recursive: true });
    fs.writeFileSync(configPath(), 'model_list: []\n');
    run(['models', 'litellm', 'gpt']);
    expect(fs.readFileSync(`${configPath()}.prev`, 'utf8')).toBe('model_list: []\n');
  });

  it('does NOT restart LiteLLM when it is not running', () => {
    run(['models', 'litellm', 'gpt']);
    expect(calls('ccgpt')).toEqual([]);
  });

  it('restarts LiteLLM when it IS running and the config changed, and says it did', () => {
    pgrep(true);
    const r = run(['models', 'litellm', 'gpt']);
    expect(r.code).toBe(0);
    expect(calls('ccgpt')).toEqual(['stop']);
    expect(r.stderr).toMatch(/stopped the running LiteLLM proxy/);
  });

  it('does NOT restart when the config did not change, even if it is running', () => {
    run(['models', 'litellm', 'gpt']);
    pgrep(true);
    fs.rmSync(join(home, 'ccgpt-calls'), { force: true });
    run(['models', 'litellm', 'gpt']);
    expect(calls('ccgpt')).toEqual([]);
  });

  // Fix round 1 (this task, controller ruling): STOP-THEN-WRITE. A running
  // proxy that will not stop must refuse BEFORE the op ever writes, so the
  // next run sees the same difference and retries — writing first and only
  // then discovering the stop failed would leave the new config already on
  // disk, reporting "unchanged" forever after, while the box keeps serving
  // the stale rendering with no operator signal.
  it('refuses when a running proxy will not stop, and writes nothing', () => {
    pgrep(true);
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccgpt-calls"\nexit 1\n', { mode: 0o755 });
    const r = run(['models', 'litellm', 'gpt']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['ok']).toBe(false);
    expect(b['error']).toBe('restart-failed');
    expect(fs.existsSync(configPath())).toBe(false);
    expect(fs.existsSync(`${configPath()}.prev`)).toBe(false);
  });

  it('restarts (a successful stop) and writes, reporting restarted:true', () => {
    fs.mkdirSync(join(home, '.handoff'), { recursive: true });
    fs.writeFileSync(configPath(), 'model_list: []\n');
    pgrep(true);
    const r = run(['models', 'litellm', 'gpt']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['changed']).toBe(true);
    expect(b['restarted']).toBe(true);
    expect(calls('ccgpt')).toEqual(['stop']);
    expect(fs.readFileSync(`${configPath()}.prev`, 'utf8')).toBe('model_list: []\n');
  });

  it('a second run after a failed stop retries once the proxy can be stopped', () => {
    pgrep(true);
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccgpt-calls"\nexit 1\n', { mode: 0o755 });
    const r1 = run(['models', 'litellm', 'gpt']);
    expect(r1.code).toBe(1);
    expect(fs.existsSync(configPath())).toBe(false);
    ccgpt();
    const r2 = run(['models', 'litellm', 'gpt']);
    expect(r2.code).toBe(0);
    expect(oneObject(r2)['changed']).toBe(true);
    expect(fs.existsSync(configPath())).toBe(true);
  });

  it('refuses a never-probed lane rather than rendering an empty list', () => {
    fs.rmSync(join(home, '.ccrc', 'models', 'gpt.json'));
    const r = run(['models', 'litellm', 'gpt']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('never-probed');
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it('refuses a lane whose probe is not codex', () => {
    run(['models', 'router', 'init', 'openrouter']);
    const r = run(['models', 'litellm', 'router']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('not-a-codex-lane');
  });

  // D-3482: the EXTERNAL arm is the live lanes' — the other
  // repository's LiteLLM reads its file — and this task leaves it byte for
  // byte. Characterisation pins: GREEN before the change by design; their
  // value is the mutation table (the dispatch sent the wrong way).
  //
  // R40: neither new case below names a live lane id. Each seeds its own
  // catalogue on `router2` — the tree's existing non-live EXTERNAL row
  // (`exec.kind: 'external'`, like the describe's own probed row above) —
  // rather than reusing the describe's `beforeEach`, which probes only its
  // own row.
  it('the external arm is untouched: pgrep on the box-global path, a bare `ccgpt stop`, and the lane library never asked', () => {
    writeCatalogue('router2');
    expect(run(['models', 'router2', 'init', 'codex']).code).toBe(0);
    fs.rmSync(join(home, 'pgrep-calls'), { force: true });
    pgrep(true);
    const r = sourced('cmd_models litellm router2', ['lock', 'ours', 'stop', 'start']);
    expect(r.code, r.stderr).toBe(0);
    const b = oneObject(r);
    expect(b['path']).toBe(configPath());
    expect(b['restarted']).toBe(true);
    expect(calls('pgrep')).toEqual([`-f litellm .*${configPath()}`]);
    expect(calls('ccgpt')).toEqual(['stop']);
    expect(laneCalls()).toEqual([]);
    expect(fs.existsSync(join(home, '.ccrc', 'codex'))).toBe(false);
  });

  it('the external arm still honours CCGPT_CONFIG — the other repository\'s override of that one path', () => {
    writeCatalogue('router2');
    expect(run(['models', 'router2', 'init', 'codex']).code).toBe(0);
    const elsewhere = join(home, 'elsewhere', 'litellm-config.yaml');
    fs.rmSync(join(home, 'pgrep-calls'), { force: true });
    const r = run(['models', 'litellm', 'router2'], { CCGPT_CONFIG: elsewhere });
    expect(r.code, r.stderr).toBe(0);
    expect(oneObject(r)['path']).toBe(elsewhere);
    expect(fs.existsSync(elsewhere)).toBe(true);
    expect(fs.existsSync(configPath())).toBe(false);
    expect(calls('pgrep')).toEqual([`-f litellm .*${elsewhere}`]);
  });

  it('needs an id', () => {
    expect(run(['models', 'litellm']).code).toBe(2);
  });
});

describe('refresh runs the litellm step for a codex lane (§5)', () => {
  const configPath = (): string => join(home, '.handoff', 'litellm-config.yaml');
  beforeEach(() => {
    fs.writeFileSync(join(home, '.local', 'bin', 'pgrep'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    run(['models', 'gpt', 'init', 'codex']);
  });

  it('a first refresh of the gpt lane renders the config', () => {
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(0);
    expect(fs.existsSync(configPath())).toBe(true);
    expect((oneObject(r)['refreshed'] as { litellm: string }[])[0]!.litellm).toBe('rendered');
  });

  it('a second refresh with the same catalogue leaves it alone', () => {
    run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    const before = fs.statSync(configPath()).mtimeMs;
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(fs.statSync(configPath()).mtimeMs).toBe(before);
    expect((oneObject(r)['refreshed'] as { litellm: string }[])[0]!.litellm).toBe('unchanged');
  });

  it('a non-Codex lane\'s refresh never touches the LiteLLM config', () => {
    run(['models', 'router', 'init', 'openrouter']);
    const orRaw = join(here, 'fixtures', 'catalogues', 'openrouter-raw-page.json');
    run(['models', 'refresh', 'router'], { CCRC_MODELS_PROBE_FIXTURE: orRaw });
    expect(fs.existsSync(configPath())).toBe(false);
  });

  // Fix round 1 (this task, controller ruling): a lane whose litellm step
  // refuses (a running proxy that will not stop) is a FAILED row, and the
  // whole run's exit code follows it — an `ok:true` row that quietly named a
  // failure was exactly the bug (the hourly `refresh --all` exiting 0 while
  // the box served the previous model list). The catalogue probe itself still
  // succeeded and its effects stand — the lane's catalogue is on disk — but
  // the LiteLLM config, having refused to write, is not.
  it('a lane whose restart fails is a FAILED row, and the run exits 1', () => {
    fs.writeFileSync(join(home, '.local', 'bin', 'pgrep'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/pgrep-calls"\necho 4242\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccgpt-calls"\nexit 1\n', { mode: 0o755 });
    const r = run(['models', 'refresh', 'gpt'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['ok']).toBe(false);
    const rows = b['refreshed'] as { id: string; ok: boolean; reason?: string }[];
    expect(rows).toEqual([{ id: 'gpt', ok: false, reason: expect.any(String) }]);
    expect(rows[0]!.reason).toMatch(/could not be stopped/);
    expect(fs.existsSync(join(home, '.ccrc', 'models', 'gpt.json'))).toBe(true);
    expect(fs.existsSync(configPath())).toBe(false);
  });
});

// D-3482 (spec §8): for an `exec.kind: "codex"` lane ONLY, the
// three things the STOP-THEN-WRITE doctrine names — the bytes, the tier and
// the stop — are this lane's own: ~/.ccrc/codex/<id>/litellm.yaml,
// `_codex_tier_ours <id> litellm`, and ccrc's `_codex_stop_tier`/
// `_codex_start_tier`. The doctrine itself is unchanged: a stop that fails
// writes NOTHING, so the next run sees the same difference and retries.
describe('ccrc models litellm — a codex-kind lane renders its own config and restarts its own tier (D-3482)', () => {
  const SYNTHETIC_LITELLM_CATALOGUE = {
    probe: 'codex', fetchedAt: 1789000000, stale: false,
    models: [{
      id: 'gpt-x', label: 'gpt-x', context: null, maxContext: null, efforts: [],
      hidden: false, priceIn: null, priceOut: null,
    }],
  };

  it('uses only the local synthetic gpt-x catalogue vocabulary', () => {
    expect(SYNTHETIC_LITELLM_CATALOGUE.models).toEqual([expect.objectContaining({ id: 'gpt-x', label: 'gpt-x' })]);
    // Round 2 (rereview Minor 4): the guard binds the EXECUTABLE consumer, not
    // only the plan and this constant. Both needles are built, so this guard's
    // own source (inside the block it scans) carries neither.
    const forbiddenHistoricalModel = ['gp', 't-6-astra'].join('');
    const consumer = ['writeCatalogue(id, ', 'SYNTHETIC_LITELLM_CATALOGUE)'].join('');
    const title = "describe('ccrc models litellm — a codex-kind lane";
    // This describe's own source block: from its title to the column-0 close.
    const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const at = self.indexOf(title);
    expect(at, 'this describe in its own file').toBeGreaterThan(0);
    const end = self.indexOf('\n});\n', at);
    expect(end, 'the describe\'s column-0 close').toBeGreaterThan(at);
    const block = self.slice(at, end);
    expect(block, 'the codex-kind describe renders the synthetic catalogue').toContain(consumer);
    expect(block, 'the codex-kind describe names the historical model').not.toContain(forbiddenHistoricalModel);
    // The plan's copied excerpt: from the same title to its code fence.
    const stagedPlan = fs.readFileSync(join(REPO, 'docs', 'superpowers', 'plans', '2026-09-23-gpt-lane-ownership-2b2-the-lane-runs.md'), 'utf8');
    const from = stagedPlan.indexOf(title);
    expect(from, 'the plan\'s excerpt of this describe').toBeGreaterThan(0);
    const fence = stagedPlan.indexOf('\n  ```', from);
    expect(fence, 'the excerpt\'s closing fence').toBeGreaterThan(from);
    const excerpt = stagedPlan.slice(from, fence);
    expect(excerpt, 'the plan excerpt renders the synthetic catalogue').toContain(consumer);
    expect(excerpt, 'the plan excerpt names the historical model').not.toContain(forbiddenHistoricalModel);
  });

  const laneDir = (id: string): string => join(home, '.ccrc', 'codex', id);
  const lanePath = (id: string): string => join(laneDir(id), 'litellm.yaml');
  const boxGlobal = (): string => join(home, '.handoff', 'litellm-config.yaml');
  const OLD = 'model_list: []\n';
  /** Dynamic and DISTINCT (global constraint: never a hard-coded port). No
   *  case binds one — every tier is faked or idle — but the roster refuses a
   *  shared port, and `freePort()` can hand the same one out twice. */
  const lanePorts = async (n: number): Promise<number[]> => {
    const got = new Set<number>();
    while (got.size < n) got.add(await freePort());
    return [...got];
  };

  beforeEach(async () => {
    const [pa, la, pb, lb] = await lanePorts(4);
    fs.rmSync(home, { recursive: true, force: true });
    home = box({ ...ROSTER, accounts: [...ROSTER.accounts,
      codexRow('codex-a', pa!, la!), codexRow('codex-b', pb!, lb!)] });
    // The external arm's two tools, POISONED: a codex lane's render
    // reaches neither. `systemctl` and `systemd-run` (the platform's unit
    // starter) are already poisoned by env() on every run in this file
    // (finding, this round: a describe-scoped poison left every OTHER case
    // that can now reach the lane library — any codex-kind roster row,
    // anywhere in this file — walking up to a real systemd-run; env()'s
    // file-level poison contains all of them, not only this describe's).
    for (const name of ['pgrep', 'ccgpt']) {
      fs.writeFileSync(join(home, '.local', 'bin', name),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
        + `echo "a codex lane's render must never reach ${name}" >&2\nexit 97\n`, { mode: 0o755 });
    }
    for (const id of ['codex-a', 'codex-b']) {
      writeCatalogue(id, SYNTHETIC_LITELLM_CATALOGUE);
      const r = run(['models', id, 'init', 'codex']);
      expect(r.code, r.stderr).toBe(0);
    }
  });

  it('renders to the lane\'s own litellm.yaml through the REAL library on an idle lane — never the box-global file, pgrep, ccgpt or systemd-run', () => {
    // The one case with no fakes: the real `_codex_tier_ours` must answer 1
    // (not running) for a lane with nothing on its port and no user manager,
    // and the real `_codex_lock` (Task 5) must take a fresh
    // lane's lock. A red naming `tier-foreign` here means something took the
    // free port between `freePort()` and the run — re-run before reading it
    // as a defect. A red naming `lock-failed` or `tier-unmeasured` is a
    // defect in the library, never in this case.
    const r = run(['models', 'litellm', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(oneObject(r)).toMatchObject({
      ok: true, op: 'litellm', id: 'codex-a', path: lanePath('codex-a'), changed: true, restarted: false,
    });
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toContain('  - model_name: gpt-x');
    expect(fs.statSync(lanePath('codex-a')).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(boxGlobal())).toBe(false);
    expect(fs.existsSync(lanePath('codex-b')), 'the other lane is untouched').toBe(false);
    for (const name of ['pgrep', 'ccgpt', 'systemd-run']) expect(poisonLog(name), name).toEqual([]);
  });

  it('a tier holding the previous rendering is STOPPED, then the bytes land, then it is STARTED on them', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    const r = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']);
    expect(r.code, r.stderr).toBe(0);
    const b = oneObject(r);
    expect(b['changed']).toBe(true);
    expect(b['restarted']).toBe(true);
    // Review round 1, item 5 (class fix): a SECOND `ours` call — the re-ask,
    // right before the restart — now sits between the stop and the start.
    expect(laneCalls()).toEqual([
      'lock codex-a', 'ours codex-a litellm', 'stop codex-a litellm cfg=old', 'ours codex-a litellm',
      'start codex-a litellm cfg=new',
    ]);
    expect(fs.readFileSync(`${lanePath('codex-a')}.prev`, 'utf8')).toBe(OLD);
    expect(r.stderr).toMatch(/restarted lane codex-a's LiteLLM tier/);
    for (const name of ['pgrep', 'ccgpt']) expect(poisonLog(name), name).toEqual([]);
  });

  it('a stop that fails writes NOTHING and starts nothing — restart-failed — and the next run retries', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    knob('stop', 'codex-a', 1);
    const r1 = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']);
    expect(r1.code).toBe(1);
    const b1 = oneObject(r1);
    expect(b1['error']).toBe('restart-failed');
    expect(String(b1['detail'])).toMatch(/could not be stopped/);
    expect(String(b1['detail'])).toContain("'ccrc codex stop codex-a'");
    // F5: the stop's OWN stop-failed sentence (the SPECIFIC reason, not
    // just this arm's generic one), captured off its stderr.
    expect(String(b1['detail'])).toContain('fake stop-failed for codex-a');
    expect(String(b1['detail'])).toMatch(/Nothing was written\.$/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
    expect(fs.existsSync(`${lanePath('codex-a')}.prev`)).toBe(false);
    expect(laneCalls()).toEqual(['lock codex-a', 'ours codex-a litellm', 'stop codex-a litellm cfg=old']);
    // THE RETRY: the bytes on disk are still the old ones, so the next run
    // sees the same difference and takes the whole decision again.
    knob('stop', 'codex-a', 0);
    fs.rmSync(join(home, 'lane-calls'));
    const r2 = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']);
    expect(r2.code, r2.stderr).toBe(0);
    expect(oneObject(r2)['restarted']).toBe(true);
    expect(laneCalls()).toEqual([
      'lock codex-a', 'ours codex-a litellm', 'stop codex-a litellm cfg=old', 'ours codex-a litellm',
      'start codex-a litellm cfg=new',
    ]);
  });

  it('an unchanged rendering asks the tier nothing, even when one is running', () => {
    expect(sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']).code).toBe(0);
    const before = fs.statSync(lanePath('codex-a')).mtimeMs;
    knob('ours', 'codex-a', 0);
    fs.rmSync(join(home, 'lane-calls'), { force: true });
    const r = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']);
    expect(r.code, r.stderr).toBe(0);
    expect(oneObject(r)['changed']).toBe(false);
    // The lane lock is taken BEFORE the compare (the whole decision is
    // one critical section), and the tier is never asked.
    expect(laneCalls()).toEqual(['lock codex-a']);
    expect(fs.statSync(lanePath('codex-a')).mtimeMs).toBe(before);
  });

  it('a tier ccrc cannot identify is refused, never stopped, and nothing is written (tier-foreign)', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 2);
    const r = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('tier-foreign');
    expect(String(b['detail'])).toContain("'ccrc codex status codex-a'");
    expect(String(b['detail'])).toMatch(/Nothing was written\.$/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
    expect(laneCalls()).toEqual(['lock codex-a', 'ours codex-a litellm']);
  });

  // PF-21: `_codex_tier_ours` answered "ours" (0), but `_codex_stop_tier`'s
  // OWN identity gate — re-measured at the stop itself — found it not
  // provably this lane's, and answered `foreign` at rc 0 rather than
  // stopping it. Folding that rc-0 "foreign" into "stopped" would write over
  // a tier something else may still be serving; the arm must capture the
  // WORD and refuse `tier-foreign`, exactly as it would for a 2 from
  // `_codex_tier_ours` itself.
  it('the stop itself finds the tier foreign (its word, not `_codex_tier_ours`\'s code): refused, nothing started, nothing written (PF-21)', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    stopWord('codex-a', 'foreign');
    const r = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('tier-foreign');
    expect(String(b['detail'])).toMatch(/not provably this lane's/);
    // F4: the stop's OWN stderr line (what it found holding the port), and
    // this arm's own remedy — the sibling `2)` arm's sentence has one too.
    expect(String(b['detail'])).toContain('fake codex: codex-a: port held by a stranger');
    expect(String(b['detail'])).toContain("'ccrc codex status codex-a'");
    expect(String(b['detail'])).toMatch(/Nothing was written\.$/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
    // The stop WAS called (and logged) — it is the stop's OWN answer that
    // refuses, never a skipped call.
    expect(laneCalls()).toEqual(['lock codex-a', 'ours codex-a litellm', 'stop codex-a litellm cfg=old']);
  });

  // CLASS FIX (review round 2, N1/N3/N4): `_codex_stop_tier` answers
  // `foreign` only when it stopped nothing; after a REAL stop it answers
  // `stopped`, and a taker that arrives after ITS OWN second measurement is
  // invisible to it. This arm's own re-ask, right before the restart it
  // owes, is what catches that: `ours2` (this round's own knob) answers 2
  // for the call AFTER the stop, while the stop's own word stays the
  // default "stopped" — never `foreign` — so this case binds the re-ask and
  // not the sibling PF-21 case above. `whyKnob` (N1) makes that 2nd call
  // silent and sets CX_TIER_WHY first, the real function's own contract, so
  // the arm's `_codex_foreign_what` call resolves a real holder description
  // — nothing here hand-writes the message text.
  it('a stop that answers "stopped" is re-measured right before the restart, and a foreign holder there is NAMED and leaves the tier DOWN (review round 2, N1/N3)', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    knob('ours2', 'codex-a', 2);
    whyKnob('codex-a', 'listener-other-process');
    // `_codex_foreign_what` (real, unstubbed) reads CX_LITELLM/CX_PROXY
    // unconditionally (`ccd/ccrc` runs under `set -u`, line 68). In
    // production the REAL `_codex_tier_ours` sets them as a side effect of
    // `_codex_row`, in the SAME subshell, before this arm's re-ask ever
    // calls `_codex_foreign_what`; the fake above bypasses `_codex_row`
    // entirely, so this test supplies them the way `env()`'s own `extra`
    // exists for. Pure-parse fixture ports (global constraints' own
    // vocabulary), no socket opened.
    const r = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start'],
      { CX_LITELLM: '45010', CX_PROXY: '45011' });
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('tier-foreign');
    // The holder description is `_codex_foreign_what`'s own text for
    // `listener-other-process` — asserted by its distinctive substring only,
    // so this case still binds if that wording moves.
    expect(String(b['detail'])).toMatch(/is held by a process that is not this lane's LiteLLM/);
    expect(String(b['detail'])).toMatch(/tier is DOWN/);
    expect(String(b['detail'])).toContain("'ccrc codex status codex-a'");
    expect(String(b['detail'])).toContain("'ccrc codex start codex-a'");
    expect(String(b['detail'])).toMatch(/Nothing was written\.$/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
    // The stop WAS called; the re-ask is the SECOND `ours` line, and no
    // start ever follows it.
    expect(laneCalls()).toEqual(['lock codex-a', 'ours codex-a litellm', 'stop codex-a litellm cfg=old',
      'ours codex-a litellm']);
  });

  // The Task 10 residue B1: the re-check's rc IS the verdict, so the holder
  // naming runs in a subshell of its own. A fault while naming — here an
  // unbound variable, which exits its shell 1 under `set -u` — must end the
  // naming alone: folded into the verdict it reads 1, "free", and the arm
  // writes and starts over a port something else holds.
  it('a fault while NAMING the re-check\'s holder never turns its 2 into "free": still tier-foreign, nothing written, nothing started (Task 10 residue B1)', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    knob('ours2', 'codex-a', 2);
    whyKnob('codex-a', 'listener-other-process');
    const r = sourced('_codex_foreign_what() { : "$F1_NAMING_FAULT"; }\ncmd_models litellm codex-a',
      ['lock', 'ours', 'stop', 'start']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('tier-foreign');
    expect(String(b['detail'])).toMatch(/tier is DOWN/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
    expect(laneCalls()).toEqual(['lock codex-a', 'ours codex-a litellm', 'stop codex-a litellm cfg=old',
      'ours codex-a litellm']);
  });

  // Review A2: the FIRST question's 2 is named by `_codex_foreign_what` too,
  // never a sentence of this arm's own — and for a unit whose identity is
  // only UNPROVEN (ruling PF-13), that sentence says so and suggests the
  // retry. The fake returns (as the real function does) rather than exits,
  // so the naming runs; `_codex_row` fills the CX_* it reads.
  it('the first question\'s 2 is named in _codex_foreign_what\'s words: a unit whose identity is only unproven says so, with the retry (review A2)', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    const r = sourced('_codex_tier_ours() { _codex_row "$1" >/dev/null 2>&1; CX_TIER_WHY=unit-unproven; return 2; }\n'
      + 'cmd_models litellm codex-a', ['lock', 'stop', 'start']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('tier-foreign');
    const detail = String(b['detail']);
    expect(detail).toMatch(/: the unit ccgpt-codex-a-litellm\.service is active, but its identity as codex-a's litellm tier is unproven: /);
    expect(detail).toContain('Re-run in a few seconds');
    expect(detail).not.toMatch(/cannot identify as this lane's own tier/);
    expect(detail).toMatch(/Nothing was written\.$/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
    expect(laneCalls()).toEqual(['lock codex-a']);
  });

  // The same B1 shape at the FIRST question, which now names its 2 as well.
  it('a fault while NAMING the first question\'s holder never turns its 2 into "free": still tier-foreign, nothing written (Task 10 residue B1)', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    const r = sourced('_codex_tier_ours() { CX_TIER_WHY=listener-unidentified; return 2; }\n'
      + '_codex_foreign_what() { : "$F1_NAMING_FAULT"; }\ncmd_models litellm codex-a', ['lock', 'stop', 'start']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('tier-foreign');
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
    expect(laneCalls()).toEqual(['lock codex-a']);
  });

  // The controller's ruling on the B1 residue, at EVERY site: a fault
  // INSIDE `_codex_tier_ours` itself (here an unbound variable, through a
  // `declare -f` wrapper) exits the question's subshell 1 under `set -u`.
  // Read off that exit status it was "not running": free, a write, a start.
  // The verdict is now the marker the subshell prints last, and a missing
  // marker is 3 — cannot ask.
  it('a fault INSIDE the library at the first question is cannot-ask: tier-unmeasured, nothing stopped, written or started (B1, every site)', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    const r = sourced([
      "eval \"$(declare -f _codex_tier_ours | sed '1s/^_codex_tier_ours/_codex_tier_ours_real/')\"",
      '_codex_tier_ours() { : "$F1_LIBRARY_FAULT"; _codex_tier_ours_real "$@"; }',
      'cmd_models litellm codex-a',
    ].join('\n'), ['lock', 'stop', 'start']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('tier-unmeasured');
    expect(String(b['detail'])).toMatch(/the lane library ended without an answer: .*F1_LIBRARY_FAULT: unbound variable/);
    expect(String(b['detail'])).toMatch(/Nothing was written\.$/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
    expect(laneCalls()).toEqual(['lock codex-a']);
  });

  it('a fault INSIDE the library at the re-check right before the restart is cannot-ask: tier-unmeasured, the tier DOWN, nothing written or started (B1, every site)', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    // The fake answers the FIRST question (0: ours, running); the second —
    // the re-check after the stop — faults before it can answer.
    const r = sourced([
      "eval \"$(declare -f _codex_tier_ours | sed '1s/^_codex_tier_ours/_codex_tier_ours_fake/')\"",
      '_codex_tier_ours() { if [ -f "$HOME/fake/ours-n-$1-$2" ]; then _fk_log "ours $1 $2"; : "$F1_LIBRARY_FAULT"; fi; _codex_tier_ours_fake "$@"; }',
      'cmd_models litellm codex-a',
    ].join('\n'), ['lock', 'ours', 'stop', 'start']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('tier-unmeasured');
    expect(String(b['detail'])).toMatch(/the lane library ended without an answer: .*F1_LIBRARY_FAULT: unbound variable/);
    expect(String(b['detail'])).toMatch(/tier is DOWN/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
    expect(laneCalls()).toEqual(['lock codex-a', 'ours codex-a litellm', 'stop codex-a litellm cfg=old',
      'ours codex-a litellm']);
  });

  // The marker's reader itself: the verdict is the LAST line only, a
  // malformed or missing one is 3, and the said-line is what precedes it.
  it('_models_lane_verdict reads the verdict from the last line alone: a missing or malformed marker is 3, unmarked (B1, every site)', () => {
    const r = sourced([
      'for c in "a sentence"$\'\\n\'"CX-VERDICT rc=2" $\'\\nCX-VERDICT rc=0\' "x"$\'\\n\\n\'"CX-VERDICT rc=4" "no marker at all" '
        + '"CX-VERDICT rc=1"$\'\\ntrailing\' "CX-VERDICT rc=x" ""; do',
      '  _models_lane_verdict "$c"; printf \'%s|%s|%s\\n\' "$CX_VERDICT_RC" "$CX_VERDICT_MARKED" "$CX_VERDICT_SAID"',
      'done',
    ].join('\n'), []);
    expect(r.stdout).toBe(['2|1|a sentence', '0|1|', '4|1|x', '3|0|no marker at all', '3|0|trailing',
      '3|0|CX-VERDICT rc=x', '3|0|', ''].join('\n'));
  });

  it('an unmeasurable re-ask (not 1, not 2) also leaves the tier DOWN, named as unmeasured (review round 2, N3)', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    knob('ours2', 'codex-a', 3);
    const r = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('tier-unmeasured');
    expect(String(b['detail'])).toMatch(/could not be measured/);
    expect(String(b['detail'])).toMatch(/tier is DOWN/);
    expect(String(b['detail'])).toContain("'ccrc codex start codex-a'");
    expect(String(b['detail'])).toMatch(/Nothing was written\.$/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
    expect(laneCalls()).toEqual(['lock codex-a', 'ours codex-a litellm', 'stop codex-a litellm cfg=old',
      'ours codex-a litellm']);
  });

  it('a tier that is still STARTING (4) is this lane\'s own: stopped, then the bytes land, then it is started on them', () => {
    // A 4 is a live handle whose command line proves this lane while its
    // port does not answer yet — a tier still importing litellm. It may
    // already have read the old bytes, and it is ours to stop
    // (D-3488 stops on 0 or 4).
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 4);
    const r = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']);
    expect(r.code, r.stderr).toBe(0);
    const b = oneObject(r);
    expect(b['changed']).toBe(true);
    expect(b['restarted']).toBe(true);
    expect(laneCalls()).toEqual([
      'lock codex-a', 'ours codex-a litellm', 'stop codex-a litellm cfg=old', 'ours codex-a litellm',
      'start codex-a litellm cfg=new',
    ]);
    expect(r.stderr).toMatch(/restarted lane codex-a's LiteLLM tier/);
  });

  it('a tier ccrc cannot ask about (3) is left running and named: tier-unmeasured, never stopped, nothing written (D-3488)', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 3);
    const r = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('tier-unmeasured');
    expect(String(b['detail'])).toMatch(/answered 3/);
    // The library's own sentence (for a real 3, `_codex_row`'s refusal)
    // names the remedy, so the arm carries it rather than discarding it.
    expect(String(b['detail'])).toContain('fake library sentence for codex-a');
    expect(String(b['detail'])).toMatch(/Nothing was written\.$/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
    expect(laneCalls()).toEqual(['lock codex-a', 'ours codex-a litellm']);
  });

  it('a lane lock that cannot be taken is lock-failed: nothing is asked, stopped or written', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    knob('lock', 'codex-a', 1);
    const r = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('lock-failed');
    expect(String(b['detail'])).toContain("'ccrc codex status codex-a'");
    expect(String(b['detail'])).toMatch(/Nothing was written\.$/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
    expect(laneCalls()).toEqual(['lock codex-a']);
  });

  // PF-25: `_codex_lanes` reads accounts.json RAW — `.id | strings`, no
  // shape check of its own — so a caller of `_models_litellm_lane` that
  // bypassed `cmd_models`'s own `_models_id_ok` gate (this call does, on
  // purpose, to measure THIS function's own defence) must not let a
  // path-shaped id reach `mkdir -p` unchecked.
  it('a malformed id refuses BEFORE any mkdir: nothing is created outside ~/.ccrc/codex/ (PF-25)', () => {
    // F7: `home/.ccrc/x` and `home/.ccrc/codex/../x` are the SAME path once
    // resolved, so two `existsSync` checks on them prove the same fact
    // twice. A recursive before/after listing of the whole `.ccrc` tree
    // proves the stronger claim the case's own title makes — nothing was
    // created ANYWHERE under it, not just at the one path this id happens
    // to normalise to.
    const before = listUnder(join(home, '.ccrc'));
    const r = sourced('_models_litellm_lane ../x', []);
    expect(r.code).toBe(2);
    const b = oneObject(r);
    expect(b['error']).toBe('bad-account-id');
    expect(listUnder(join(home, '.ccrc'))).toEqual(before);
    expect(laneCalls()).toEqual([]);
  });

  // F6: before this round, one combined guard folded a missing/older
  // `ccrc-wrapper-shape` (this BOX's build is incomplete — the id itself may
  // be fine) into `bad-account-id` (this ID is malformed — the box is fine).
  // A box whose install is inconsistent must never be told its id is wrong.
  it('a missing wrapper-shape contract is install-incomplete, never bad-account-id, and still refuses before any mkdir (F6)', () => {
    fs.rmSync(join(home, 'ccrc', 'ccd', 'ccrc-wrapper-shape'));
    const before = listUnder(join(home, '.ccrc'));
    const r = sourced('_models_litellm_lane codex-a', []);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('install-incomplete');
    expect(String(b['detail'])).toMatch(/wrapper shape contract/);
    // ONE line for one failure (the Task 6 residue): the library's own
    // `ccrc codex:` line would carry the wrong verb's prefix in a `ccrc
    // models` run, and the envelope already names the remedy.
    expect(r.stderr).not.toMatch(/^ccrc codex: install-incomplete/m);
    expect(listUnder(join(home, '.ccrc'))).toEqual(before);
    expect(laneCalls()).toEqual([]);
  });

  it('the REAL `_codex_lock` is held at the tier question, the stop and the start, and released when the render returns', () => {
    // The one case that runs Task 5's lock: no `lock` fake. The fakes probe
    // it from OUTSIDE — `flock -n` on the lock file is a new open file
    // description, which a held flock refuses — so `held` is a fact about
    // the lock, not about a variable. The probe after the call is made in
    // the SAME shell: a lock the render leaked into its caller would still
    // be held there. flock is on every supported box (install requires it
    // on macOS, and CI's macOS legs `brew install flock`) — THIS CASE
    // ASSUMES it. On a flock-less box `_codex_lock` returns rc 0 with
    // NOTHING held (Task 5's accepted fallback, ruling PF-22: starts and
    // stops then run unserialised, which is this race's behaviour without
    // the lock and no worse), so the probe would read `free` at every step
    // and this case would measure nothing about serialisation — that box
    // shape is out of scope here, not a defect this case would catch.
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    fs.writeFileSync(join(home, 'fake', 'probe-lock'), '');
    const r = sourced([
      '_models_litellm codex-a; rc=$?',
      'if flock -n "$HOME/.ccrc/codex/codex-a/.lock" true; then echo lock-released >&2; else echo lock-still-held >&2; fi',
      'exit "$rc"',
    ].join('\n'), ['ours', 'stop', 'start']);
    expect(r.code, r.stderr).toBe(0);
    expect(oneObject(r)['restarted']).toBe(true);
    expect(lockProbe()).toEqual(['ours held', 'stop held', 'ours held', 'start held']);
    expect(r.stderr).toMatch(/^lock-released$/m);
    expect(laneCalls()).toEqual([
      'ours codex-a litellm', 'stop codex-a litellm cfg=old', 'ours codex-a litellm',
      'start codex-a litellm cfg=new',
    ]);
  });

  it('a start that fails AFTER the write is start-failed, and says the new bytes ARE on disk', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    knob('start', 'codex-a', 1);
    const r = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']);
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('start-failed');
    expect(String(b['detail'])).toMatch(/WAS written/);
    expect(String(b['detail'])).toContain("'ccrc codex start codex-a'");
    // PF-26: `_codex_start_tier`'s own last stderr line reaches this detail.
    expect(String(b['detail'])).toContain('fake start-failed for codex-a');
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toContain('model_name:');
    expect(laneCalls()).toEqual([
      'lock codex-a', 'ours codex-a litellm', 'stop codex-a litellm cfg=old', 'ours codex-a litellm',
      'start codex-a litellm cfg=new',
    ]);
  });

  // A mode-0500 directory refuses the op's write; root ignores modes, so the
  // case cannot be reached as root (`ccd-bounded-reads.test.ts`' idiom).
  it.skipIf(process.getuid?.() === 0)('a write that fails after the stop starts the tier again on the PREVIOUS bytes, and passes the op\'s refusal through', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    fs.chmodSync(laneDir('codex-a'), 0o500);
    const r = (() => {
      try { return sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']); }
      finally { fs.chmodSync(laneDir('codex-a'), 0o700); }
    })();
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('config-unwritable');
    expect(laneCalls()).toEqual([
      'lock codex-a', 'ours codex-a litellm', 'stop codex-a litellm cfg=old', 'ours codex-a litellm',
      'start codex-a litellm cfg=old',
    ]);
    expect(r.stderr).toMatch(/started lane codex-a's LiteLLM tier again on the previous rendering/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
  });

  it.skipIf(process.getuid?.() === 0)('…and when that start fails too, it is start-failed naming both: the tier is down and the new list was not written', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    knob('start', 'codex-a', 1);
    fs.chmodSync(laneDir('codex-a'), 0o500);
    const r = (() => {
      try { return sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']); }
      finally { fs.chmodSync(laneDir('codex-a'), 0o700); }
    })();
    expect(r.code).toBe(1);
    const b = oneObject(r);
    expect(b['error']).toBe('start-failed');
    expect(String(b['detail'])).toMatch(/could not be written/);
    expect(String(b['detail'])).toContain("'ccrc codex start codex-a'");
    // PF-26: this is the SECOND start-failed detail — the restore attempt's
    // own failure line, appended too.
    expect(String(b['detail'])).toContain('fake start-failed for codex-a');
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
  });

  // F2: G and G2 both set `ours` to 0 (running), so `held` is always 1
  // there — nothing had exercised the restore path with `held` at its OTHER
  // value. Here the tier was never running (no `ours` knob: the fake
  // defaults to 1, "not running"), so `held` never becomes 1, and a write
  // that still fails (the same chmod-0500 fixture as G) must start NOTHING —
  // there was never a tier this arm stopped, so there is none to restore.
  it.skipIf(process.getuid?.() === 0)('a write that fails when the tier was NOT running starts no tier nobody stopped (F2)', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    fs.chmodSync(laneDir('codex-a'), 0o500);
    const r = (() => {
      try { return sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']); }
      finally { fs.chmodSync(laneDir('codex-a'), 0o700); }
    })();
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('config-unwritable');
    // No `stop` or `start` line: `ours` answered 1 (not running), so the
    // case arm's `1) : ;;` branch never sets `held`.
    expect(laneCalls()).toEqual(['lock codex-a', 'ours codex-a litellm']);
    expect(r.stderr).not.toMatch(/started lane codex-a's LiteLLM tier again/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
  });

  // F3: G/G2 only ever render codex-a, the roster's FIRST codex lane, so a
  // mutation that names the restore-start call `"$(_codex_lanes | head -n1)"`
  // instead of `"$1"` cannot be told apart from the correct code there —
  // "first lane" and "this lane" are the same answer. Rendering codex-b
  // (the second lane) through the SAME restore path pins that call site on
  // its own.
  it.skipIf(process.getuid?.() === 0)('a write that fails after the stop starts THAT lane\'s tier again — never the roster\'s first (F3)', () => {
    for (const id of ['codex-a', 'codex-b']) { fs.writeFileSync(lanePath(id), OLD); knob('ours', id, 0); }
    fs.chmodSync(laneDir('codex-b'), 0o500);
    const r = (() => {
      try { return sourced('cmd_models litellm codex-b', ['lock', 'ours', 'stop', 'start']); }
      finally { fs.chmodSync(laneDir('codex-b'), 0o700); }
    })();
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('config-unwritable');
    expect(laneCalls()).toEqual([
      'lock codex-b', 'ours codex-b litellm', 'stop codex-b litellm cfg=old', 'ours codex-b litellm',
      'start codex-b litellm cfg=old',
    ]);
    expect(r.stderr).toMatch(/started lane codex-b's LiteLLM tier again on the previous rendering/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
    expect(fs.readFileSync(lanePath('codex-b'), 'utf8')).toBe(OLD);
  });

  it('rendering one lane stops and starts THAT lane\'s tier only (spec §18: "the stop stops the wrong lane")', () => {
    for (const id of ['codex-a', 'codex-b']) { fs.writeFileSync(lanePath(id), OLD); knob('ours', id, 0); }
    const r = sourced('cmd_models litellm codex-b', ['lock', 'ours', 'stop', 'start']);
    expect(r.code, r.stderr).toBe(0);
    expect(laneCalls()).toEqual([
      'lock codex-b', 'ours codex-b litellm', 'stop codex-b litellm cfg=old', 'ours codex-b litellm',
      'start codex-b litellm cfg=new',
    ]);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
  });

  it('CCGPT_CONFIG — the other repository\'s variable — never redirects a lane ccrc owns', () => {
    const elsewhere = join(home, 'elsewhere.yaml');
    const r = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start'], { CCGPT_CONFIG: elsewhere });
    expect(r.code, r.stderr).toBe(0);
    expect(oneObject(r)['path']).toBe(lanePath('codex-a'));
    expect(fs.existsSync(elsewhere)).toBe(false);
  });

  it('an absent lane directory is created 0700, not at the op\'s mode-less mkdir (runtime.env lives there)', () => {
    fs.rmSync(laneDir('codex-a'), { recursive: true, force: true });
    const r = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'start']);
    expect(r.code, r.stderr).toBe(0);
    expect(fs.statSync(laneDir('codex-a')).mode & 0o777).toBe(0o700);
  });

  it('refresh reaches the same arm: a running tier is restarted and the row reads rendered', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    const r = sourced('cmd_models refresh codex-a', ['lock', 'ours', 'stop', 'start'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code, r.stderr).toBe(0);
    expect(oneObject(r)['refreshed'])
      .toEqual([{ id: 'codex-a', probe: 'codex', ok: true, count: 9, litellm: 'rendered' }]);
    expect(laneCalls()).toEqual([
      'lock codex-a', 'ours codex-a litellm', 'stop codex-a litellm cfg=old', 'ours codex-a litellm',
      'start codex-a litellm cfg=new',
    ]);
  });

  it('refresh: a codex lane whose stop fails is a FAILED row that says why, and its config is not written', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    knob('stop', 'codex-a', 1);
    const r = sourced('cmd_models refresh codex-a', ['lock', 'ours', 'stop', 'start'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
    expect(r.code).toBe(1);
    const rows = oneObject(r)['refreshed'] as { id: string; ok: boolean; reason?: string }[];
    expect(rows).toEqual([{ id: 'codex-a', ok: false, reason: expect.any(String) }]);
    expect(rows[0]!.reason).toMatch(/could not be stopped/);
    expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
  });

  it('the tier this arm starts is told to read the file this arm wrote — the REAL _codex_start_tier\'s --config', () => {
    fs.writeFileSync(lanePath('codex-a'), OLD);
    knob('ours', 'codex-a', 0);
    // What `_codex_start_tier` resolves before it builds argv (design contract): the
    // generation `ccgpt-runtime python` names, the stamp it hashes into
    // `litellm.started`, and the lane's gateway-key file. The generation
    // comes from the test tree's ONE runtime planter (ruling R28), and the
    // CLI that names it is the REAL `ccgpt-runtime` that `plantCodexBins`
    // places, never a stub that prints a path. Neither interpreter is run
    // here: `svc` fakes the spawn. If this case reds on anything but the
    // `--config` assertions, Task 5's function looks for a runtime where
    // `plantFakeRuntime` does not plant one. Read both, then EXTEND
    // `plantFakeRuntime` (Task 4's rule). Never hand-write a generation here,
    // and never weaken the assertions.
    plantCodexBins(home);
    plantFakeRuntime(home);
    // Generated, never asserted by value (global constraint).
    fs.writeFileSync(join(laneDir('codex-a'), 'runtime.env'),
      `LITELLM_MASTER_KEY=sk-${randomBytes(24).toString('hex')}\n`, { mode: 0o600 });
    const r = sourced('cmd_models litellm codex-a', ['lock', 'ours', 'stop', 'svc']);
    expect(r.code, r.stderr).toBe(0);
    const argv = fs.readFileSync(join(home, 'svc-argv'), 'utf8').split('\n');
    expect(argv[0]).toBe('ccgpt-codex-a-litellm.service');
    const at = argv.indexOf('--config');
    expect(at, argv.join(' ')).toBeGreaterThan(-1);
    expect(argv[at + 1]).toBe(lanePath('codex-a'));
    expect(argv[at + 1]).toBe(String(oneObject(r)['path']));
    expect(fs.readFileSync(argv[at + 1]!, 'utf8')).toContain('model_name:');
  });

  it('a runner\'s own lane-library bounds never reach the child, and `extra` still sets one (ruling R23)', () => {
    // A runs the REAL `_codex_tier_ours`, whose probe bound is
    // `CCRC_CODEX_PROBE_S`, and A and real-lock run the REAL `_codex_lock`,
    // whose wait derives from `CCRC_CODEX_READY_S`. The knobs are planted on
    // THIS process for two calls and then restored, so the pin measures
    // env()'s deletion and not a runner that happens to be clean.
    const knobs = ['CCRC_CODEX_PROBE_S', 'CCRC_CODEX_READY_S'] as const;
    const saved = knobs.map((k) => process.env[k]);
    const show = 'printf \'%s|%s\\n\' "${CCRC_CODEX_PROBE_S-unset}" "${CCRC_CODEX_READY_S-unset}"';
    const seen = (() => {
      for (const k of knobs) process.env[k] = '1';
      try {
        return { inherited: sourced(show, []), passed: sourced(show, [], { CCRC_CODEX_READY_S: '7' }) };
      } finally {
        knobs.forEach((k, i) => {
          const v = saved[i];
          if (v === undefined) delete process.env[k]; else process.env[k] = v;
        });
      }
    })();
    expect(seen.inherited.stdout).toBe('unset|unset\n');
    // The control: only the INHERITED value is dropped, so a case that
    // wants a bound still passes one.
    expect(seen.passed.stdout).toBe('unset|7\n');
  });

  describe('_codex_litellm_ensure — `ccrc codex start` renders an ABSENT config through the same arm', () => {
    it('absent: rendered through the codex arm, with NOTHING on stdout (ccrc codex prints its own line), and the lane lock is NOT taken again', () => {
      const r = sourced('_codex_litellm_ensure codex-a', ['lock', 'ours', 'stop', 'start']);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe('');
      expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toContain('model_name:');
      // No `lock` line: the one caller, `ccrc codex start`, already holds
      // this lane's lock, and `_codex_litellm_ensure` never calls
      // `_codex_lock` again — the real lock is RE-ENTRANT there and would
      // return 0 at once rather than deadlock (R38), but a second call
      // here would still blur one render's lock scope across two levels
      // and add a spurious `lock` line to the fake's call log.
      expect(laneCalls()).toEqual(['ours codex-a litellm']);
    });

    it('present: left alone, whatever it holds — staleness is refresh\'s question, not start\'s', () => {
      fs.writeFileSync(lanePath('codex-a'), OLD);
      const r = sourced('_codex_litellm_ensure codex-a', ['lock', 'ours', 'stop', 'start']);
      expect(r.code, r.stderr).toBe(0);
      expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
      expect(laneCalls()).toEqual([]);
    });

    it('a render that refuses is ONE `ccrc codex: litellm-unrendered:` line carrying the op\'s own remedy, rc 1', () => {
      fs.rmSync(join(home, '.ccrc', 'models', 'codex-a.json'));   // never probed
      const r = sourced('_codex_litellm_ensure codex-a', ['lock', 'ours', 'stop', 'start']);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      const lines = r.stderr.split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^ccrc codex: litellm-unrendered: /);
      expect(lines[0]).toContain("'ccrc models refresh codex-a'");
      expect(fs.existsSync(lanePath('codex-a'))).toBe(false);
    });

    it('never takes the EXTERNAL arm, even handed an id that is not a codex lane', () => {
      // `_codex_cmd_start` gates on `_codex_row` first, so this is belt and braces —
      // but the external arm's failure mode is the live box's box-global
      // file and a bare `ccgpt stop`, so the braces are measured. R40: the
      // non-codex id here is `router2`, the tree's existing external row —
      // never a live lane id.
      writeCatalogue('router2');
      expect(run(['models', 'router2', 'init', 'codex']).code).toBe(0);
      sourced('_codex_litellm_ensure router2', ['lock', 'ours', 'stop', 'start']);
      expect(fs.existsSync(boxGlobal())).toBe(false);
      for (const name of ['pgrep', 'ccgpt']) expect(poisonLog(name), name).toEqual([]);
    });

    it('`ccrc codex start` asks for it under the lane lock, after the gateway key and before any tier is adopted or started', () => {
      // A behavioural pin needs Task 5's whole start harness (auth, runtime,
      // readiness), which this file does not build; that START reaches this
      // step is pinned on the start sequence's own text. START_FN is
      // `_codex_cmd_start` (ruling R17), the function whose body runs `ccrc
      // codex start`'s sequence. `cmd_codex` only parses, gates and
      // dispatches `start` to it.
      const START_FN = '_codex_cmd_start';
      const src = fs.readFileSync(CCRC_SRC, 'utf8');
      const m = new RegExp(`^${START_FN}\\(\\) \\{[^\\n]*\\n([\\s\\S]*?)\\n\\}$`, 'm').exec(src);
      expect(m, `ccd/ccrc has no ${START_FN}`).toBeTruthy();
      const code = m![1]!.split('\n').filter((l) => !l.trim().startsWith('#'));
      const at = (fn: string): number[] =>
        code.flatMap((l, i) => (new RegExp(`(?:^|[\\s;&|(])${fn}\\s`).test(l) ? [i] : []));
      const ensure = at('_codex_litellm_ensure');
      expect(ensure, `${START_FN} calls _codex_litellm_ensure exactly once`).toHaveLength(1);
      // The ensure runs the arm's body WITHOUT taking the lane lock, so the
      // lock must already be held — taken by this function, earlier.
      expect(at('_codex_lock').some((i) => i < ensure[0]!),
        'the lane lock is taken before the config is rendered').toBe(true);
      // The interim absent-config refusal this call replaces is gone.
      expect(code.filter((l) => l.includes('litellm-unrendered')),
        `${START_FN} no longer spells the interim litellm-unrendered refusal`).toEqual([]);
      const key = at('_codex_runtime_env_ensure').filter((i) => i < ensure[0]!);
      expect(key.length, 'the gateway key is ensured before the config').toBeGreaterThan(0);
      const tiers = [...at('_codex_tier_ours'), ...at('_codex_start_tier')];
      expect(tiers.filter((i) => i > key[key.length - 1]! && i < ensure[0]!),
        'no tier is adopted or started between the gateway key and the config').toEqual([]);
      expect(tiers.some((i) => i > ensure[0]!), 'and the tier loop follows it').toBe(true);
    });
  });
});
