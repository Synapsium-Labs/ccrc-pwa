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
// exceptions: `ENV_ONLY` (D-6588's 42 environment-only names, in six classes),
// `SERVER_SETTINGS` (the keys ccrc reads where the server reads them, from the
// server's own files) and `VAR_KEY_BODIES` (the functions that may hand those
// readers a key in a variable). A new name reds a row until it is classed.
//
// WHY `set -u` IS A ROW (C7). The scan below sees `${NAME…}` forms and the two
// bounded readers' literal arguments; a bare `$NAME` is invisible to it. Under
// `set -u` a bare `$NAME` of an unset environment name aborts ccrc, so an
// environment-only read must spell a default, which this scan sees.
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
/** D-6588's 42 environment-only names. Each is a reasoned exception: a value
 *  for one call, one test, one run or one process, never a box's setting. */
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
  // fixture path: a path or permission a test points elsewhere.
  CCRC_CADDY_SYSTEM_FILE: { cls: 'fixture-path', why: 'Its header in ccd/ccrc says it is overridable so the suite can point the root-owned Caddyfile at a fixture.' },
  CCRC_CADDY_ROOT_CA: { cls: 'fixture-path', why: 'Its header in ccd/ccrc makes it a constant for CCRC_CADDY_SYSTEM_FILE\'s reason, a root-side path a test points at a fixture.' },
  CCRC_SCOPE_SWEEP_STATE: { cls: 'fixture-path', why: '`_check_scope-sweep` reads the sweep\'s verdict record there, a runtime path a test points at a fixture.' },
  CCRC_CGROUP_ROOT: { cls: 'fixture-path', why: '`_check_scopes` reads the cgroup tree there, which a test points at a fixture.' },
  CCRC_PROC_ROOT: { cls: 'fixture-path', why: '`_check_scopes` reads /proc there, which a test points at a fixture.' },
  CCRC_ALLOW_SANDBOX_LAUNCHCTL: { cls: 'fixture-path', why: '`_svc_launchctl` lets a harness that asks reach launchctl from a home that is not the real one.' },
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

  it('C7: the census is complete only under set -u, which ccd/ccrc keeps', () => {
    expect(CODE['ccd/ccrc'].split('\n').some((l) => /^set -[a-z]*u[a-z]*o pipefail$/.test(l))).toBe(true);
  });

  it('C8: there is no second reader of a setting', () => {
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
});
