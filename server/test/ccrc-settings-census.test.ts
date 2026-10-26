// D-6598: ccrc's own settings live on ONE reader, and every other CCRC_ name
// ccrc reads from the environment is a reasoned exception. Text only, no spawn.
//
// THE SCOPE, STATED. It reads `ccd/ccrc`, `ccd/ccrc-doctor-checks` (which
// `cmd_doctor` sources) and `deploy/ccrc.env.example`, plus README's
// `**ccrc's own settings.**` paragraph. It does not read the ccd-* sibling
// scripts, `ccd/ccgpt-runtime`, `ccd/ccrc-models-probe`, `ccd/ccrc-codex` or
// the `deploy/*.mjs` helpers ccrc runs: the wave-24 plan's "Not in this wave"
// names each of their CCRC_ reads with a class. C6 alone also knows
// `CCRC_SIGSTORE_TRUSTED_ROOT` by name, so the example never offers it.
//
// WHAT IT DERIVES, AND WHAT IT HOLDS BY HAND. The settings come from the one
// `CCRC_SETTINGS=(…)` line of ccd/ccrc, never from a second list here, and
// each setting's default from the second argument of its literal
// `_ccrc_knob`/`_keep_knob` calls. Held here, each with its reason, are the
// exceptions: `ENV_ONLY` (D-6588's 42 environment-only names and D-6921's one,
// in six classes), `SERVER_SETTINGS` (the keys ccrc reads where the server
// reads them, from the server's own files), `VAR_KEY_BODIES` (the functions
// that may hand those readers a key in a variable) and `SOURCING_BODIES` (the
// one function that may source the box env file, for the server, how often, and
// only inside the launchd command string it emits). A new name reds a row until
// it is classed.
//
// WHAT IT GUARDS: THE SPELLINGS IT NAMES (D-6746). It is not a proof that no
// other reader exists. It sees a `${NAME…}` or `$NAME` expansion of a setting
// (C3), a `${NAME…}` with a default or assignment operator and the two bounded
// readers' literal arguments (C5), the box-env readers' keys and the reader's
// own indirection and awk program elsewhere (C8), a nameref to a setting (C9),
// a `-v` test of a CCRC_ name (C10), and `.` or `source` of the box env file
// in any body SOURCING_BODIES does not list, or outside the launchd command
// string of the one it lists, a `$(`, a backtick or bash 5.3's `${ ` or `${|`
// on that line counting as outside since it runs as the line assigns (C11): in
// command position (after `if`, `elif`, `while`, `until`, `!`, `builtin`,
// `command` or a backtick too, a `--` before the operand skipped), of
// `$BOX_ENV_FILE`, a `ccrc.env` path (a quote inside it included), a name
// bound to either, `<(…)` naming one, or `/dev/stdin <` one. A name bound in a
// body that declares it `local` is followed in that body alone; any other
// binding, and BOX_ENV_FILE, everywhere. `set -u` (C7) makes a bare `$NAME` of
// an unset name abort, so an unguarded read must spell a default C5 sees; a
// `-v` test is one guard that needs none, which is why C10 is a row of its
// own.
//
// WHAT IT DOES NOT CATCH, measured by review 891's mutants and named so no
// reader takes this file for more: `${#NAME}`; an expansion split by a
// backslash-newline; an indirect call through the timeout helper (a key in a
// variable, `_upd_validate_timeout "$k"`, or the helper renamed); a nameref
// whose target is assigned after its declaration or held in a variable
// (`local -n r="$k"`); a `-v` test of a name held in a variable, and the other
// guard that needs no default, `declare -p NAME`; an environment read from
// node (`process.env.`), jq (`$ENV.`) or printenv; a two-line loop that reads
// the box env file (`while IFS== read`); the box env file sourced by another
// route: `eval "$(cat …)"`, a name bound through a second variable, or a
// helper that sources a positional parameter (`_svc_run_supervised`'s
// `. "$1"`) handed the file; four sourcing shapes the re-review measured
// surviving C11 and the coordinator ruled named, not caught (R29): a `case`
// arm (`x) . "$BOX_ENV_FILE" ;;`), `time . …`, a sourcing in a callee that
// reads a name its caller declared `local` (dynamic scope), and a `.` and its
// operand split across a backslash-newline; the launchd command string run a
// second time through a nameref to it (`local -n`/`declare -n`) or a `${!…}`
// indirect name, which C11's count of `$cmd` and `${cmd` does not see (review
// 902, F4: named, not caught); and C6's spacing and export
// variants of an environment-only example line (`#CCRC_X=`, `#  CCRC_X=`,
// leading spaces, `export CCRC_X=`, `# export CCRC_X=`).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');
/** A file's code lines: every line whose first non-blank is `#` dropped. */
const codeOf = (text: string): string =>
  text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const FILES = ['ccd/ccrc', 'ccd/ccrc-doctor-checks'] as const;
type CodeFile = (typeof FILES)[number];
const CODE: Record<CodeFile, string> = {
  'ccd/ccrc': codeOf(read('ccd/ccrc')),
  'ccd/ccrc-doctor-checks': codeOf(read('ccd/ccrc-doctor-checks')),
};
const EXAMPLE = read('deploy/ccrc.env.example');
const README = read('README.md');

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

/** The settings, from the one line of ccd/ccrc that lists them. */
function settingsLines(): string[] {
  return FILES.flatMap((f) => CODE[f].split('\n').filter((l) => /^\s*CCRC_SETTINGS\+?=/.test(l)));
}
const SETTINGS: string[] = (() => {
  const m = /^CCRC_SETTINGS=\(([^)]*)\)$/m.exec(CODE['ccd/ccrc']);
  return m ? m[1].split(' ').filter((w) => w !== '') : [];
})();

type EnvOnlyClass = 'call-bound' | 'fixture-path' | 'per-run' | 'rollout' | 'handshake' | 'constant';
/** D-6588's 42 environment-only names and D-6921's one. Each is a reasoned
 *  exception: a value for one call, one test, one run or one process, never a
 *  box's setting. */
const ENV_ONLY: Record<string, { cls: EnvOnlyClass; why: string }> = {
  // call bound: a time, size or concurrency bound on one call or wait, overridable so a suite need not wait it out.
  CCRC_HEALTH_TIMEOUT: { cls: 'call-bound', why: 'The header above its `:=` default in ccd/ccrc bounds one call to this box\'s server and says the default is what an operator gets, the override existing so a test need not wait out a production timeout.' },
  CCRC_RELEASE_CONNECT_TIMEOUT: { cls: 'call-bound', why: 'The release host\'s own time bounds header in ccd/ccrc makes it the connect bound of each curl call to the release host, overridable for CCRC_HEALTH_TIMEOUT\'s reason.' },
  CCRC_RELEASE_PROBE_MAX_TIME: { cls: 'call-bound', why: 'The release host\'s own time bounds header makes it the total bound of the small probes (`_upd_asset_listed` and the provenance bundle fetch), overridable for CCRC_HEALTH_TIMEOUT\'s reason.' },
  CCRC_RELEASE_SPEED_LIMIT: { cls: 'call-bound', why: 'The release host\'s own time bounds header makes it the stall floor of the SHA256SUMS and tarball fetches in `_upd_resolve`, a bound on one transfer.' },
  CCRC_RELEASE_SPEED_TIME: { cls: 'call-bound', why: 'The release host\'s own time bounds header makes it the stall window of the SHA256SUMS and tarball fetches in `_upd_resolve`, a bound on one transfer.' },
  CCRC_RELEASE_SUMS_MAX_TIME: { cls: 'call-bound', why: 'The release host\'s own time bounds header makes it the total bound of the SHA256SUMS fetch in `_upd_resolve`, a bound on one call.' },
  CCRC_RELEASE_SUMS_MAX_FILESIZE: { cls: 'call-bound', why: 'The release host\'s own time bounds header makes it the size bound of the SHA256SUMS fetch in `_upd_resolve`, a bound on one call.' },
  CCRC_ACCOUNT_AUTH_TIMEOUT: { cls: 'call-bound', why: 'The `ccrc account check` header on the cheap health question makes it a deadline on one local `claude auth status` call (`_acct_auth_deadline`), overridable so a test need not wait it out.' },
  CCRC_ACCOUNT_PROBE_TIMEOUT: { cls: 'call-bound', why: 'The `ccrc account check` header on the probe\'s deadline makes it the bound of one billed probe (`_acct_probe_deadline`), overridable for its sibling\'s reason.' },
  CCRC_ACCT_USAGE_WAIT_S: { cls: 'call-bound', why: '`_acct_usage_wait_secs` bounds one wait for a usage poll at the unit\'s own TimeoutStartSec.' },
  CCRC_CODEX_PROBE_S: { cls: 'call-bound', why: '`_codex_probe_secs` is the per-probe bound of one readiness probe.' },
  CCRC_CODEX_READY_S: { cls: 'call-bound', why: '`_codex_ready_secs` bounds one lane start\'s wait for readiness.' },
  CCRC_MODELS_LOCK_S: { cls: 'call-bound', why: '`_models_lock_secs` is the lane-files lock\'s wait for one locked call.' },
  CCRC_MODELS_CANARY_S: { cls: 'call-bound', why: '`_models_canary_secs` bounds one canary request, held equal to the canary helper\'s own bound.' },
  CCRC_BOOTOUT_WAIT_S: { cls: 'call-bound', why: '`_inst_enable_darwin` bounds one wait for a launchd label to leave before it bootstraps again.' },
  CCRC_WATCHDOG_PROBE_GAP_S: { cls: 'call-bound', why: '`_upd_watchdog_probe_gap_s` is the sampling interval inside one watchdog tick, which tests set to zero.' },
  CCRC_SWEEP_VERIFY_JOBS: { cls: 'call-bound', why: '`_upd_sweep` bounds how many of one sweep\'s verifications run at once.' },
  CCRC_VERIFY_SETTLE: { cls: 'call-bound', why: '`_ccrc_job_stayed_up` waits this settle before one stayed-up measurement.' },
  CCRC_VERIFY_WINDOW: { cls: 'call-bound', why: '`_ccrc_job_stayed_up` holds this window inside one stayed-up measurement.' },
  CCRC_DOCTOR_GH_TIMEOUT: { cls: 'call-bound', why: 'The header above its `:=` default in ccd/ccrc-doctor-checks bounds one `gh auth status` call so a test need not wait out a production timeout.' },
  CCRC_DOCTOR_DOCS_TIMEOUT: { cls: 'call-bound', why: 'The header above its `:=` default in ccd/ccrc-doctor-checks bounds one `ccd docs-index --all` call, overridable for the gh knob\'s reason.' },
  CCRC_SCOPE_SWEEP_STALE_S: { cls: 'call-bound', why: '`_check_scope-sweep` uses it as the age past which one verdict record reads stale.' },
  CCRC_SCOPE_SETTLE_SEC: { cls: 'call-bound', why: '`_check_scopes` waits this settle inside one scope measurement.' },
  // fixture path: a path, endpoint or permission a test points elsewhere.
  CCRC_CADDY_SYSTEM_FILE: { cls: 'fixture-path', why: 'Its header in ccd/ccrc says it is overridable so the suite can point the root-owned Caddyfile at a fixture.' },
  CCRC_CADDY_ROOT_CA: { cls: 'fixture-path', why: 'Its header in ccd/ccrc makes it a constant for CCRC_CADDY_SYSTEM_FILE\'s reason, a root-side path a test points at a fixture.' },
  CCRC_SCOPE_SWEEP_STATE: { cls: 'fixture-path', why: '`_check_scope-sweep` reads the sweep\'s verdict record there, a runtime path a test points at a fixture.' },
  CCRC_CGROUP_ROOT: { cls: 'fixture-path', why: '`_check_scopes` reads the cgroup tree there, which a test points at a fixture.' },
  CCRC_PROC_ROOT: { cls: 'fixture-path', why: '`_check_scopes` reads /proc there, which a test points at a fixture.' },
  CCRC_ALLOW_SANDBOX_LAUNCHCTL: { cls: 'fixture-path', why: '`_svc_launchctl` lets a harness that asks reach launchctl from a home that is not the real one.' },
  CCRC_CODEX_AUTH_BASE: { cls: 'fixture-path', why: '`_codex_bridge_prepare` forwards it to a direct lane\'s bridge only when its caller set it, the auth endpoint a test points at a loopback fake and a live box never sets (D-6921).' },
  // per run: the address for one run.
  CCRC_ADDR: { cls: 'per-run', why: '`_box_server_addr` takes it as one run\'s address, the box\'s own being CCRC_HOST and CCRC_PORT read from the file.' },
  // rollout: coordinates on the deploying machine, in deploy.env.
  CCRC_BOX: { cls: 'rollout', why: '`cmd_rollout` reads the server box\'s coordinate from the deploying machine\'s deploy.env or environment.' },
  CCRC_AGENT_BOX: { cls: 'rollout', why: '`cmd_rollout` reads the fleet box\'s coordinate from the deploying machine\'s deploy.env or environment.' },
  CCRC_SSH_KEY: { cls: 'rollout', why: '`cmd_rollout` reads the ssh key from the deploying machine\'s deploy.env or environment.' },
  CCRC_SSH_PORT: { cls: 'rollout', why: '`cmd_rollout` reads the ssh port from the deploying machine\'s deploy.env or environment.' },
  CCRC_DEPLOY_ENV: { cls: 'rollout', why: '`cmd_rollout` reads it as the path of the deploying machine\'s deploy.env.' },
  // handshake: passed between ccrc's own processes.
  CCRC_UPDATE_LOCK_HELD: { cls: 'handshake', why: '`_upd_lock` and `cmd_update`\'s restore arm read it as the marker a parent holding the update lock passes its child.' },
  CCRC_UPDATE_VERIFIED: { cls: 'handshake', why: '`_inst_installed` reads it as the mark a `ccrc … update` parent passes its install spine.' },
  CCRC_UPDATE_SPINE: { cls: 'handshake', why: '`_inst_installed` reads it as the pid of the `ccrc … update` parent that set CCRC_UPDATE_VERIFIED.' },
  // constant: set in the file and read with a guard default, or overridden for one call.
  CCRC_EXPOSURE_FILE: { cls: 'constant', why: 'ccd/ccrc sets it once at the top, and `_box_unit_env` and the doctor\'s checks read it with a guard default or as one call\'s prefix assignment.' },
  CCRC_CADDYFILE: { cls: 'constant', why: 'ccd/ccrc sets it once at the top, and the doctor\'s caddy checks read it with a guard default.' },
  CCRC_DDNS_UNIT: { cls: 'constant', why: 'ccd/ccrc sets it once at the top, and the doctor\'s name and update-exposure checks read it with a guard default.' },
  CCRC_HERE: { cls: 'constant', why: 'ccd/ccrc sets it to its own directory, and ccd/ccrc-doctor-checks resolves itself only when it is unset.' },
};

/** Read by a helper ccrc runs, not by ccd/ccrc: C6 alone knows it. */
const HELPER_ENV_ONLY: Record<string, string> = {
  CCRC_SIGSTORE_TRUSTED_ROOT: 'deploy/verify-provenance.mjs reads it; a file line must never choose the provenance trust root',
};

/** The keys ccrc reads from the server's files, where the server reads them (D-6588). */
const SERVER_SETTINGS: Record<string, string> = {
  CCRC_ROLE: 'the role `ccrc install` recorded in ccrc.env',
  CCRC_HOST: 'the server\'s bind address, from ccrc.env or the exposure file as ccrc.service reads it',
  CCRC_PORT: 'the server\'s port, from ccrc.env',
  CCRC_FLEET: 'the server\'s fleet mode, from ccrc.env',
  CCRC_AUTH: 'the server\'s sign-in switch, from either file as ccrc.service reads it',
  CCRC_AGENT_URL: 'the server\'s link to the agent, from ccrc.env',
  CCRC_AGENT_TOKEN: 'the server\'s link token, from ccrc.env',
  CCRC_MAIL_TOKEN_PATH: 'the server\'s box-token path override, from ccrc.env',
  CCRC_AUTH_SECRET_PATH: 'the server\'s auth-secret path override, read through `_box_path_for`',
  CCRC_SESSIONS_PATH: 'the server\'s session-store path override, read through `_box_path_for`',
  CCRC_EXPOSE_MODE: 'the exposure file\'s mode, written by `ccrc expose`',
  CCRC_ORIGIN: 'the exposure file\'s origin, written by `ccrc expose`',
  CCRC_RP_ID: 'the exposure file\'s relying-party id, written by `ccrc expose`',
  CCRC_DDNS_TOKEN: 'the exposure file\'s DDNS token, written by `ccrc expose`',
  CCRC_DDNS_PROVIDER: 'the exposure file\'s DDNS provider, written by `ccrc expose`',
  CCRC_DDNS_DOMAIN: 'the exposure file\'s DDNS domain, written by `ccrc expose`',
  CCRC_CADDY_BIND: 'the exposure file\'s Caddy bind, written by `ccrc expose`',
};

/** The bodies that may hand `_box_env_value`, `_box_unit_env` or `_box_unit_env_shell` a key in a variable. */
const VAR_KEY_BODIES: Record<string, string> = {
  _box_unit_env: 'the model itself, reading the key its caller named',
  _box_unit_env_shell: 'the macOS model, reading the key its caller named',
  _box_path_for: 'the server\'s path overrides, one key per caller',
  cmd_expose: 'its `for k in CCRC_ORIGIN CCRC_RP_ID CCRC_AUTH` shadow-key loop',
  _ccrc_knob: 'the one reader of a setting',
};

/** The bodies that may source the box env file, each with how many times, where and why. Counted per body, so a second sourcing
 *  reds; and each sourcing must sit inside the string `cmd` names (one `local cmd="…"` line, with no `$(`, backtick, or bash 5.3's
 *  current-shell `${ ` or `${|`, each of which would run in ccrc's own shell as the line assigns). C11 counts the body's expansions
 *  of that string in the spellings `$cmd` and `${cmd` alone, and wants exactly one, as the launchd job's `-c` argument, so a
 *  sourcing moved out of that string onto a line the body executes reds, and so does the string run a second time under either
 *  spelling. A nameref to it or a `${!…}` indirect name is not counted (the header names both as residuals). */
const SOURCING_BODIES: Record<string, { count: number; cmd: string; reason: string }> = {
  _inst_plist_server: { count: 1, cmd: 'cmd', reason: 'the macOS server job\'s launch line: the launchd job\'s parse of ccrc.env becomes the server\'s environment, and so reaches a ccrc the server spawns as its environment, as on Linux through ccrc.service\'s EnvironmentFile; it is the server\'s reading, the same one EnvironmentFile gives on Linux' },
};

/** Every name read from the environment outside the reader: `${NAME…}` with a
 *  default or assignment operator, and the two bounded readers' literal keys. */
function envReads(code: string): Set<string> {
  const out = new Set<string>();
  for (const m of code.matchAll(/\$\{(CCRC_[A-Z0-9_]*[A-Z0-9]):?[-=+?]/g)) out.add(m[1]);
  for (const m of code.matchAll(/\b(?:_upd_validate_timeout|_acct_deadline) (CCRC_[A-Z0-9_]+)/g)) out.add(m[1]);
  return out;
}

/** Each setting's defaults: the second argument of its literal calls, `""` (a
 *  file-mode call) dropped. A trailing `;`, `&`, `|` or `)` is shell syntax,
 *  not the argument (`… 900000; else`, `… 3; then`). */
function defaultsOf(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of FILES)
    for (const m of CODE[f].matchAll(/\b(?:_ccrc_knob|_keep_knob) (CCRC_[A-Z0-9_]+) ("[^"]*"|[^\s;&|)]+)/g)) {
      if (m[2] === '""') continue;
      if (!out.has(m[1])) out.set(m[1], new Set());
      out.get(m[1])!.add(m[2]);
    }
  return out;
}

/** A function's body as the W23 rows slice it: `name() {` to the first `}` alone on a line. */
function bodySpan(code: string, name: string, from = 0): { start: number; end: number } | null {
  const re = new RegExp('^' + escapeRe(name) + '\\(\\) \\{[\\s\\S]*?\\n\\}$', 'gm');
  re.lastIndex = from;
  const m = re.exec(code);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}
/** The function whose sliced body holds `index` (the nearest definition above it), or `(top level)`. */
function ownerOf(code: string, index: number): string {
  let last: RegExpMatchArray | null = null;
  for (const m of code.matchAll(/^([A-Za-z_][A-Za-z0-9_-]*)\(\) \{/gm)) {
    if (m.index! > index) break;
    last = m;
  }
  if (!last) return '(top level)';
  const span = bodySpan(code, last[1], last.index!);
  return span && span.start === last.index && index < span.end ? last[1] : '(top level)';
}

/** Every function definition's sliced body, in order: `spanAt` over it answers what `ownerOf` answers, in one pass. */
function spansOf(code: string): { owner: string; start: number; end: number }[] {
  const out: { owner: string; start: number; end: number }[] = [];
  for (const m of code.matchAll(/^([A-Za-z_][A-Za-z0-9_-]*)\(\) \{/gm)) {
    const span = bodySpan(code, m[1], m.index!);
    out.push({ owner: m[1], start: m.index!, end: span && span.start === m.index ? span.end : m.index! });
  }
  return out;
}
/** The body holding `index` as `ownerOf` decides it (the nearest definition above it), or null at the top level. */
function spanAt(spans: { owner: string; start: number; end: number }[], index: number): { owner: string; start: number; end: number } | null {
  let lo = 0;
  let hi = spans.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].start <= index) { last = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return last >= 0 && index < spans[last].end ? spans[last] : null;
}

/** Every call of a box-env reader with the key it passes: a literal CCRC_ name, or a variable. */
function boxEnvCalls(): { file: CodeFile; owner: string; key: string; text: string }[] {
  const out: { file: CodeFile; owner: string; key: string; text: string }[] = [];
  const KEY = '(CCRC_[A-Z0-9_]+|"?\\$\\{?[A-Za-z0-9_]+\\}?"?)(?![A-Za-z0-9_])';
  const shapes = [
    new RegExp('\\b_box_env_value "[^"]*" ' + KEY, 'g'),
    new RegExp('\\b(?:_box_unit_env|_box_unit_env_shell|_box_path_for) ' + KEY, 'g'),
  ];
  for (const f of FILES)
    for (const re of shapes)
      for (const m of CODE[f].matchAll(re))
        out.push({ file: f, owner: ownerOf(CODE[f], m.index!), key: m[1], text: m[0] });
  return out;
}

/** The README paragraph that opens `**ccrc's own settings.**`. */
function readmeSettingsParagraph(): string | null {
  const i = README.search(/^\*\*ccrc's own settings\.\*\*/m);
  if (i < 0) return null;
  const end = README.indexOf('\n\n', i);
  return README.slice(i, end < 0 ? undefined : end);
}

/** A documented setting's block: the `#` lines directly above its line, up to
 *  the nearest bare `#` line, blank line or other `# KEY=` line. */
function exampleBlocks(name: string): string[] {
  const lines = EXAMPLE.split('\n');
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (!new RegExp('^(# )?' + escapeRe(name) + '=').test(l)) return;
    const block: string[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const b = lines[j];
      if (!b.startsWith('#') || /^#\s*$/.test(b) || /^# ?[A-Z_][A-Z0-9_]*=/.test(b)) break;
      block.unshift(b.replace(/^# ?/, ''));
    }
    out.push(block.join(' '));
  });
  return out;
}

/** Every code line of both files that `pick` names a fault on (null: no hit), as `<file>: <fault>: <line>`. */
function lineHits(pick: (l: string) => string | null): string[] {
  const out: string[] = [];
  for (const f of FILES)
    for (const l of CODE[f].split('\n')) {
      const why = pick(l);
      if (why !== null) out.push(`${f}: ${why}: ${l.trim()}`);
    }
  return out;
}

const diff = (a: Iterable<string>, b: Iterable<string>): string[] => {
  const bs = new Set(b);
  return [...new Set(a)].filter((x) => !bs.has(x)).sort();
};

describe('W24: every ccrc setting is read through _ccrc_knob, and every environment-only CCRC_ name is a reasoned exception (D-6598)', () => {
  it('C1: CCRC_SETTINGS is one line of unique CCRC_ names, none of them an ENV_ONLY name', () => {
    expect(settingsLines(), 'exactly one code line assigns CCRC_SETTINGS').toHaveLength(1);
    expect(SETTINGS.length, 'the line parses as `CCRC_SETTINGS=(…)`').toBeGreaterThan(0);
    for (const s of SETTINGS) expect(s, 'each member is a CCRC_ name').toMatch(/^CCRC_[A-Z0-9_]+$/);
    expect(new Set(SETTINGS).size, 'no member twice').toBe(SETTINGS.length);
    expect(SETTINGS.filter((s) => s in ENV_ONLY), 'a setting is never an environment-only exception').toEqual([]);
  });

  it('C2: every setting is documented in deploy/ccrc.env.example: a "KEY=" or "# KEY=" line whose own block names the default the code uses', () => {
    const defaults = defaultsOf();
    const faults: string[] = [];
    for (const s of SETTINGS) {
      const d = [...(defaults.get(s) ?? [])];
      if (d.length !== 1) { faults.push(`${s}: ${d.length} distinct defaults across its literal calls (${d.join(', ')}), not one`); continue; }
      const blocks = exampleBlocks(s);
      if (blocks.length === 0) faults.push(`${s}: no "${s}=" or "# ${s}=" line in deploy/ccrc.env.example`);
      const re = /^\d+$/.test(d[0]) ? new RegExp('\\bDefault\\b[^.;]*\\b' + d[0] + '\\b') : /\bDefault\b/;
      for (const b of blocks) if (!re.test(b)) faults.push(`${s}: its block does not name its default (${d[0]}) as ${re}: ${JSON.stringify(b)}`);
    }
    const para = readmeSettingsParagraph();
    if (para === null) faults.push("README: no paragraph opens **ccrc's own settings.**");
    else for (const s of SETTINGS) if (!new RegExp('\\b' + s + '\\b').test(para)) faults.push(`README: the settings paragraph does not name ${s}`);
    expect(faults).toEqual([]);
  });

  it('C3: no code line expands a setting, or reads one through _box_env_value, _box_unit_env, _upd_validate_timeout or _acct_deadline', () => {
    const hits: string[] = [];
    for (const f of FILES)
      for (const l of CODE[f].split('\n'))
        for (const s of SETTINGS) {
          if (new RegExp('\\$\\{?' + s + '(?![A-Za-z0-9_])').test(l)) hits.push(`${f}: expands ${s}: ${l.trim()}`);
          if (new RegExp('\\b(?:_box_env_value|_box_unit_env|_upd_validate_timeout|_acct_deadline)\\b[^\\n]*\\b' + s + '\\b').test(l))
            hits.push(`${f}: reads ${s} outside the reader: ${l.trim()}`);
        }
    expect(hits).toEqual([]);
  });

  it('C4: _ccrc_knob and _keep_knob take a setting by its literal name, every setting is taken somewhere, and only two calls pass a name in a variable', () => {
    const literal = new Set<string>();
    const variable: string[] = [];
    for (const f of FILES) {
      for (const m of CODE[f].matchAll(/\b(?:_ccrc_knob|_keep_knob) (CCRC_[A-Z0-9_]+)/g)) literal.add(m[1]);
      // Quoted or not: `_ccrc_knob $name 5` passes a name in a variable as surely as `"$name"`, so quotes are dropped from what is listed.
      for (const m of CODE[f].matchAll(/\b(?:_ccrc_knob|_keep_knob) "?\$[^\s"]*"?/g))
        variable.push(`${m[0].replace(/"/g, '')} in ${ownerOf(CODE[f], m.index!)}`);
    }
    expect({ notASetting: diff(literal, SETTINGS), neverTaken: diff(SETTINGS, literal) }).toEqual({ notASetting: [], neverTaken: [] });
    expect(variable.sort()).toEqual(['_ccrc_knob $1 in _keep_knob', '_ccrc_knob $k in _check_box-settings']);
  });

  it('C5: every name read from the environment outside the reader is a reasoned exception, and every exception is still read', () => {
    const reads = new Set<string>();
    for (const f of FILES) for (const n of envReads(CODE[f])) reads.add(n);
    expect({ unclassified: diff(reads, Object.keys(ENV_ONLY)), noLongerRead: diff(Object.keys(ENV_ONLY), reads) }).toEqual({
      unclassified: [],
      noLongerRead: [],
    });
    for (const [n, e] of Object.entries(ENV_ONLY)) expect(e.why, `${n}'s reason is one sentence`).toMatch(/^[^\n]+\.$/);
  });

  it('C6: no exception is documented as a ccrc.env line', () => {
    const names = [...Object.keys(ENV_ONLY), ...Object.keys(HELPER_ENV_ONLY)];
    expect(names.filter((n) => new RegExp('^(# )?' + n + '=', 'm').test(EXAMPLE))).toEqual([]);
  });

  it('C7: ccd/ccrc keeps set -u, so a bare read of an unset name aborts and an unguarded read must spell the default C5 sees', () => {
    expect(CODE['ccd/ccrc'].split('\n').some((l) => /^set -[a-z]*u[a-z]*o pipefail$/.test(l))).toBe(true);
  });

  it('C8: the box-env readers take the server\'s keys by name and a key in a variable only in VAR_KEY_BODIES; the reader\'s indirection, its awk program and a setting beside a file read stay in _ccrc_knob', () => {
    // Each part adds to one list, so a second reader that breaks two parts is named by both.
    const faults: string[] = [];
    // (a) the box-env readers take the server's keys by name, and a key in a variable only inside the bodies listed.
    const calls = boxEnvCalls();
    const literal = calls.filter((c) => c.key.startsWith('CCRC_')).map((c) => c.key);
    for (const k of diff(literal, Object.keys(SERVER_SETTINGS))) faults.push(`(a) ${k} is read from a server file but is not in SERVER_SETTINGS`);
    for (const k of diff(Object.keys(SERVER_SETTINGS), literal)) faults.push(`(a) ${k} is in SERVER_SETTINGS but no longer read`);
    for (const k of Object.keys(SERVER_SETTINGS).filter((x) => SETTINGS.includes(x))) faults.push(`(a) ${k} is both a server key and a setting`);
    for (const c of calls.filter((x) => !x.key.startsWith('CCRC_') && !(x.owner in VAR_KEY_BODIES)))
      faults.push(`(a) ${c.file}: a key in a variable outside VAR_KEY_BODIES: ${c.text} in ${c.owner}`);

    // (b) indirection that is neither `${!arr[@]}` nor `${!PREFIX_@}`, and the whole-token awk program, live in `_ccrc_knob` alone.
    for (const f of FILES) {
      for (const m of CODE[f].matchAll(/\$\{!(?![A-Za-z_][A-Za-z0-9_]*(?:\[@\]|@)\})/g)) {
        const o = ownerOf(CODE[f], m.index!);
        if (o !== '_ccrc_knob') faults.push(`(b) ${f}: an indirection in ${o}`);
      }
      for (let i = CODE[f].indexOf('index(t, k "=") != 1'); i >= 0; i = CODE[f].indexOf('index(t, k "=") != 1', i + 1)) {
        const o = ownerOf(CODE[f], i);
        if (o !== '_ccrc_knob') faults.push(`(b) ${f}: the whole-token awk program in ${o}`);
      }
    }

    // (c) outside `_ccrc_knob`, no line names a setting beside BOX_ENV_FILE or a text tool, but as a reader call's literal first argument.
    for (const f of FILES) {
      const knob = bodySpan(CODE[f], '_ccrc_knob');
      let at = 0;
      for (const l of CODE[f].split('\n')) {
        const inKnob = knob !== null && at >= knob.start && at < knob.end;
        at += l.length + 1;
        if (inKnob || !/BOX_ENV_FILE|\b(?:awk|sed|grep|cut)\b/.test(l)) continue;
        const rest = l.replace(/\b(?:_ccrc_knob|_keep_knob) CCRC_[A-Z0-9_]+/g, '');
        for (const s of SETTINGS) if (new RegExp('\\b' + s + '\\b').test(rest)) faults.push(`(c) ${f}: ${s} beside a file read: ${l.trim()}`);
      }
    }
    expect(faults).toEqual([]);
  });

  it('C9: no nameref points at a setting (`local -n r=CCRC_X`, `declare -n`, `typeset -n`)', () => {
    // A nameref reads its target's value at every use, and its target is a plain word, which C3's `$NAME` scan never sees.
    const NAMEREF = /\b(?:local|declare|typeset)\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*n[A-Za-z]*\s(.*)$/;
    expect(lineHits((l) => {
      const rest = NAMEREF.exec(l)?.[1];
      if (rest === undefined) return null;
      const s = SETTINGS.find((x) => new RegExp('\\b' + x + '\\b').test(rest));
      return s === undefined ? null : `a nameref to ${s}`;
    })).toEqual([]);
  });

  it('C10: a -v test of a CCRC_ name reads the environment, so the name is a reasoned exception (never a setting, never unclassified)', () => {
    // `[[ -v CCRC_X ]] && v="$CCRC_X"` reads an unset name with no default under `set -u`, so C5's `${NAME:-…}` scan never sees it.
    // The narrowest form that catches it: the tested name itself must be in ENV_ONLY. A rule over every `$CCRC_X` expansion would
    // need a list of the names the files assign themselves (CCRC_CAP_WORDS, CCRC_ENTRY_PY and two dozen more), a second hand-kept list.
    // `printf -v` and `command -v` take no test.
    const TESTED = /(?<!\bprintf)(?<!\bcommand)\s-v\s+["']?(CCRC_[A-Z0-9_]+)/g;
    expect(lineHits((l) => {
      const bad = [...l.matchAll(TESTED)].map((m) => m[1]).filter((n) => !(n in ENV_ONLY));
      return bad.length === 0 ? null : `a -v test of ${bad.join(', ')}, which ENV_ONLY does not class`;
    })).toEqual([]);
  });

  it('C11: nothing sources the box env file (`.` or `source` of BOX_ENV_FILE, of a ccrc.env path, or of a name bound to either) but SOURCING_BODIES, by count, inside its launchd command string', () => {
    // Sourcing it is a whole second reader: bash's parse of every line, every setting set at once, no refusal of a line systemd
    // reads otherwise. The doctor and the model read the file as text (awk, grep, `_box_env_value`), which is not sourcing.
    // `.` counts only in command position: first on a line, or after `;`, `&`, `|`, `(`, `{`, `!` or a backtick, and after any run of
    // `if`, `elif`, `while`, `until`, `then`, `do`, `else`, `!`, `builtin` or `command` — never jq's `.` filter (`jq -S . "$f"`);
    // a `--` before the operand is skipped (`. -- "$BOX_ENV_FILE"`).
    // A bound name is any assignment whose value, less a trailing `;`, `&&`, `||` or `)` (as defaultsOf drops them), is a ccrc.env
    // path or BOX_ENV_FILE itself. It is followed only inside the body that makes it when that body declares it `local` (not -g), so a
    // generic local (`f`, `src`) never reds an unrelated body; any other binding (a global such as BUE_SRC) is followed everywhere.
    const FILE_VALUE = /^["']?(?:\$\{?BOX_ENV_FILE\}?|[^\s;&|]*\/ccrc\.env)["']?$/;
    const global = new Set<string>(['BOX_ENV_FILE']);
    const scoped = new Map<string, Set<string>>(); // `<file> <start>` of a body -> its local names bound to the file
    const SPANS = { 'ccd/ccrc': spansOf(CODE['ccd/ccrc']), 'ccd/ccrc-doctor-checks': spansOf(CODE['ccd/ccrc-doctor-checks']) };
    for (const f of FILES)
      for (const m of CODE[f].matchAll(/(?:^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]*)=(\S+)/gm)) {
        if (!FILE_VALUE.test(m[2].replace(/(?:;|&&|\|\||\))+$/, ''))) continue;
        const span = spanAt(SPANS[f], m.index!);
        const body = span === null ? '' : CODE[f].slice(span.start, span.end);
        const local = new RegExp('(?:^|[\\s;&|(])(?:local|declare|typeset)(?![^;\\n]*\\s-[A-Za-z]*g)\\s[^;\\n]*?\\b' + m[1] + '\\b(?!\\()', 'm');
        if (span === null || !local.test(body)) { global.add(m[1]); continue; }
        const key = `${f} ${span.start}`;
        if (!scoped.has(key)) scoped.set(key, new Set());
        scoped.get(key)!.add(m[1]);
      }
    expect([...global], 'the file\'s own binding, and the global one today\'s code makes').toEqual(expect.arrayContaining(['BOX_ENV_FILE', 'BUE_SRC']));
    const sourced = (names: Iterable<string>): RegExp => {
      const operand = '["\']?(?:\\$\\{?(?:' + [...names].map(escapeRe).join('|') + ')\\b|[^\\s;&|)]*ccrc\\.env\\b)';
      return new RegExp('(?:^|[;&|({!`])\\s*(?:(?:if|elif|while|until|then|do|else|builtin|command|!)\\s+)*(?:\\.|source)\\s+(?:--\\s+)?'
        + '(?:' + operand + '|<\\([^)]*?' + operand + '|/dev/stdin\\s*<\\s*' + operand + ')', 'gm');
    };
    const counts = new Map<string, number>();
    const faults: string[] = [];
    for (const f of FILES) {
      let at = 0;
      for (const l of CODE[f].split('\n')) {
        const span = spanAt(SPANS[f], at);
        at += l.length + 1;
        const names = new Set([...global, ...(span === null ? [] : scoped.get(`${f} ${span.start}`) ?? [])]);
        for (const m of l.matchAll(sourced(names))) {
          const o = span === null ? '(top level)' : span.owner;
          counts.set(o, (counts.get(o) ?? 0) + 1);
          if (!(o in SOURCING_BODIES)) faults.push(`${f}: ${o} sources the box env file: ${m[0].trim()}`);
          else if (!new RegExp('^\\s*local ' + SOURCING_BODIES[o].cmd + '="[^"]*"$').test(l) || /\$\(|`|\$\{[\s|]/.test(l))
            faults.push(`${f}: ${o} sources the box env file outside its launchd command string: ${l.trim()}`);
        }
      }
    }
    // The command string is the launchd job's: expanded once in the body, as the `-c` argument of the plist's ProgramArguments.
    for (const [o, e] of Object.entries(SOURCING_BODIES)) {
      const span = bodySpan(CODE['ccd/ccrc'], o);
      const body = span === null ? '' : CODE['ccd/ccrc'].slice(span.start, span.end);
      const uses = body.match(new RegExp('\\$\\{?' + e.cmd + '\\b', 'g')) ?? [];
      if (uses.length !== 1 || !new RegExp('<string>-c</string>\\s*<string>\\$' + e.cmd + '</string>').test(body))
        faults.push(`ccd/ccrc: ${o}'s $${e.cmd} is not expanded once, as the launchd job's -c argument (${uses.length} expansions)`);
    }
    const miscounted = Object.entries(SOURCING_BODIES).filter(([o, e]) => (counts.get(o) ?? 0) !== e.count)
      .map(([o, e]) => `${o}: ${counts.get(o) ?? 0} sourcings, listed as ${e.count}`);
    expect({ faults, miscounted }).toEqual({ faults: [], miscounted: [] });
  });
});
