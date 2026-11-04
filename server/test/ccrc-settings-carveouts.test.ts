// Box settings view, Task 1 (D-6914): the characterization pins of the four acts whose resolvers `ccrc settings` shares.
// Each act reads one setting, and the verb must read it THE SAME WAY the act does, so before any resolver is carved out
// of an act these rows pin what the act prints, returns and writes today. They are green on the code before the move and
// stay green, unchanged, after it:
//   - the health gate (`_upd_gate`): CCRC_UPDATE_HEALTH_S, its WARN lines, the limit it waits, and the order of the WARN
//     before the `checking` phase write;
//   - the models advance (`_models_advance_budget_secs`): CCRC_MODELS_ADVANCE_BUDGET_S, its stdout seconds, its clamp (which
//     is silent) and its two stderr sentences;
//   - the deadline (`_upd_deadline_ms`) and the release base (`_upd_release_base`): the rc and which of KNOB_WHY / KNOB
//     says what, because the verb reads those two in its own shell and tells "refused" from "unmeasured" by them.
// Every case runs in a mkTmp HOME with a contained environment; nothing here reaches the live HOME, a manager or a network.
// The suites that own the acts' own behaviour (ccrc-update-flip-backups, ccrc-update-phases, ccrc-update-fetch,
// ccrc-models-advance, update-watchdog-revert) stay as they were.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import { stubFn } from './ccdStub.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CCRC = path.resolve(here, '..', '..', 'ccd', 'ccrc');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

interface Result { code: number; stdout: string; stderr: string }

/** Every name `ccd/ccrc` reads as a setting, removed from the inherited environment, so a row's inputs are its own. */
const SETTING_NAMES = ['CCRC_BACKUP_KEEP', 'CCRC_BACKUP_DATA_KEEP', 'CCRC_VERSIONS_KEEP', 'CCRC_UPDATE_HEALTH_S',
  'CCRC_UPDATE_DEADLINE_MS', 'CCRC_RELEASE_BASE_URL', 'CCRC_MODELS_ADVANCE_BUDGET_S', 'CCRC_EXPOSURE_FILE'];

function boxWith(prefix: string, envText: string | Buffer | null): string {
  const home = mkTmp(prefix);
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  mkdirSync(join(home, 'tmp'), { recursive: true });
  if (envText !== null) writeFileSync(join(home, '.ccrc', 'ccrc.env'), envText);
  return home;
}

/** `script` in a shell that SOURCED the checkout's ccd/ccrc (its dispatch is guarded, so sourcing runs nothing), with the
 *  fixture HOME's contained environment and `extra` over it. */
function sourced(home: string, script: string, extra: NodeJS.ProcessEnv = {}): Result {
  const env = ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' });
  for (const k of SETTING_NAMES) delete env[k];
  env['TMPDIR'] = join(home, 'tmp');
  Object.assign(env, extra);
  assertNoRealTool(env, home);
  const r = spawnSync(BASH, ['-c', `. "$1"; ${script}`, 'ccrc-under-test', CCRC], { env, encoding: 'utf8', input: '', timeout: 60_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ── the health gate ────────────────────────────────────────────────────────────────────────────────────────────────────
// The probe never passes, the probe moves a plain-variable clock 30 s and `sleep` returns at once (D-7330: `unset SECONDS`
// drops the variable's special meaning), so the window the gate used is the second count it reports. `_upd_phase` is
// replaced (through stubFn, so a rename of it reds here) by a line, which is what shows the WARN comes BEFORE the phase.
const GATE = 'unset SECONDS; SECONDS=0; sleep() { :; }; '
  + stubFn('_upd_gate_probe', 'SECONDS=$((SECONDS + 30)); UPD_GATE_WHY="fixture: never up"; return 1') + ' '
  + stubFn('_upd_phase', 'echo "PHASE $*"') + ' '
  + '_upd_gate server v2.0.0; set -- $?; echo "clock $SECONDS rc $1"';
const WARN_NOT_A_NUMBER = (shown: string): string =>
  `update: WARN: CCRC_UPDATE_HEALTH_S='${shown}' is not a number of seconds (digits only, at most 18) — using 90`;

describe('the health gate reads CCRC_UPDATE_HEALTH_S as it always did (D-6914 characterization)', () => {
  it.each([
    ['unset', null, {}, 90],
    ['named empty in ccrc.env', 'CCRC_UPDATE_HEALTH_S=\n', {}, 90],
    ['an exported empty value', null, { CCRC_UPDATE_HEALTH_S: '' }, 90],
    ['120 from ccrc.env', 'CCRC_UPDATE_HEALTH_S=120\n', {}, 120],
    ['the environment over ccrc.env', 'CCRC_UPDATE_HEALTH_S=30\n', { CCRC_UPDATE_HEALTH_S: '120' }, 120],
    ['an 18-character window as written', null, { CCRC_UPDATE_HEALTH_S: '000000000000000120' }, 120],
  ] as [string, string | null, NodeJS.ProcessEnv, number][])('%s waits %d s and prints no WARN', (_w, text, extra, secs) => {
    const home = boxWith('ccrc-carve-h-ok-', text);
    const r = sourced(home, GATE, extra);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout.split('\n')).toEqual([
      'PHASE checking',
      `update: gate FAILED after ${secs}s — fixture: never up`,
      `clock ${secs} rc 1`,
      '',
    ]);
  });

  it.each([
    ['ninety', 'ninety', 'ninety'],
    ['-5', '-5', '-5'],
    ['1.5', '1.5', '1.5'],
    ['a tab inside', 'a\tb', 'a?b'],
    ['19 digits', '9'.repeat(19), '9'.repeat(19)],
    ['zero-padded to 19 characters', '0000000000000000120', '0000000000000000120'],
  ])('%s is not a number of seconds: one WARN naming the value, then 90 s', (_w, value, shown) => {
    const home = boxWith('ccrc-carve-h-bad-', null);
    const r = sourced(home, GATE, { CCRC_UPDATE_HEALTH_S: value });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toBe('');
    // The WARN, then the phase write, then the verdict: the order is the contract (the phase is `checking` after any WARN).
    expect(r.stdout.split('\n')).toEqual([
      WARN_NOT_A_NUMBER(shown),
      'PHASE checking',
      'update: gate FAILED after 90s — fixture: never up',
      'clock 90 rc 1',
      '',
    ]);
  });

  it('a ccrc.env the reader cannot take for it WARNs with the reader\'s own sentence and waits 90 s', () => {
    const home = boxWith('ccrc-carve-h-unm-', 'export CCRC_UPDATE_HEALTH_S=7\n');
    const r = sourced(home, GATE);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')).toEqual([
      'update: WARN: CCRC_UPDATE_HEALTH_S cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take '
        + '(it reads only a plain KEY=value line) — using 90',
      'PHASE checking',
      'update: gate FAILED after 90s — fixture: never up',
      'clock 90 rc 1',
      '',
    ]);
  });

  it('a NUL byte in ccrc.env refuses the key too, and names the file without its bytes', () => {
    const home = boxWith('ccrc-carve-h-nul-', Buffer.from('NOTE=x\u0000y\n', 'utf8'));
    const r = sourced(home, GATE);
    expect(r.stdout.split('\n')[0]).toBe(
      'update: WARN: CCRC_UPDATE_HEALTH_S cannot be measured: ~/.ccrc/ccrc.env could not be scanned — using 90');
    expect(r.stdout).toContain('update: gate FAILED after 90s ');
  });

  it('a gate that passes prints its one line and returns 0 at the first probe, whatever the window read', () => {
    const home = boxWith('ccrc-carve-h-pass-', null);
    const r = sourced(home, 'unset SECONDS; SECONDS=0; sleep() { :; }; '
      + stubFn('_upd_gate_probe', 'UPD_GATE_WHY="fixture: up"; return 0') + ' ' + stubFn('_upd_phase', 'echo "PHASE $*"') + ' '
      + '_upd_gate server v2.0.0; echo "rc $?"', { CCRC_UPDATE_HEALTH_S: 'ninety' });
    expect(r.stdout.split('\n')).toEqual([WARN_NOT_A_NUMBER('ninety'), 'PHASE checking', 'update: gate: server answers on v2.0.0 (fixture: up)', 'rc 0', '']);
  });

  it('the `checking` phase is written to update.json once, after the WARN', () => {
    const home = boxWith('ccrc-carve-h-json-', null);
    const r = sourced(home, 'unset SECONDS; SECONDS=0; sleep() { :; }; UPD_REPORT_TARGET=v2.0.0; UPD_FROM=shell; '
      + stubFn('_upd_gate_probe', 'SECONDS=$((SECONDS + 30)); UPD_GATE_WHY="fixture: never up"; return 1') + ' '
      + '_upd_gate server v2.0.0 >/dev/null; cat "$HOME/.ccrc/update.json"', { CCRC_UPDATE_HEALTH_S: 'ninety' });
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(doc['phase']).toBe('checking');
    expect(doc['target']).toBe('v2.0.0');
    // The WARN is stdout only: the report's detail is empty, so no refusal of the window ever reaches update.json.
    expect(doc['detail']).toBeNull();
  });
});

// ── the models advance budget ──────────────────────────────────────────────────────────────────────────────────────────
const NOT_WHOLE = 'ccrc: CCRC_MODELS_ADVANCE_BUDGET_S is not a whole number of seconds, so the advance step is off for this run';
const budget = (home: string, extra: NodeJS.ProcessEnv = {}): Result => sourced(home, '_models_advance_budget_secs; echo " rc $?"', extra);

describe('the models advance budget reads CCRC_MODELS_ADVANCE_BUDGET_S as it always did (D-6914 characterization)', () => {
  it.each([
    ['unset', undefined, '250'],
    ['empty', '', '250'],
    ['0250 (base 10)', '0250', '250'],
    ['0', '0', '0'],
    ['3600', '3600', '3600'],
    ['3601, over the cap', '3601', '3600'],
    ['99999, five digits', '99999', '3600'],
    ['a 30-digit number', '184467440737095516160000000000', '3600'],
    ['thirty zeros and 250', `${'0'.repeat(30)}250`, '250'],
  ] as [string, string | undefined, string][])('%s reads as %s seconds, silently (the clamp prints nothing)', (_w, v, want) => {
    const home = boxWith('ccrc-carve-b-ok-', null);
    const r = budget(home, v === undefined ? {} : { CCRC_MODELS_ADVANCE_BUDGET_S: v });
    expect(r.stdout).toBe(`${want} rc 0\n`);
    expect(r.stderr).toBe('');
  });

  it.each([['off'], ['-1'], ['1.5'], [' '], ['false']])('%s is not a whole number: 0, and the act\'s one stderr line without the value', (v) => {
    const home = boxWith('ccrc-carve-b-bad-', null);
    const r = budget(home, { CCRC_MODELS_ADVANCE_BUDGET_S: v });
    expect(r.stdout).toBe('0 rc 0\n');
    expect(r.stderr).toBe(`${NOT_WHOLE}\n`);
  });

  it('a value from ccrc.env reads the same way', () => {
    const home = boxWith('ccrc-carve-b-file-', 'CCRC_MODELS_ADVANCE_BUDGET_S=3601\n');
    expect(budget(home).stdout).toBe('3600 rc 0\n');
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_MODELS_ADVANCE_BUDGET_S=off\n');
    const r = budget(home);
    expect(r.stdout).toBe('0 rc 0\n');
    expect(r.stderr).toBe(`${NOT_WHOLE}\n`);
  });

  it('a ccrc.env the reader cannot take for it is 0, said on stderr with the reader\'s sentence', () => {
    const home = boxWith('ccrc-carve-b-unm-', 'export CCRC_MODELS_ADVANCE_BUDGET_S=5\n');
    const r = budget(home);
    expect(r.stdout).toBe('0 rc 0\n');
    expect(r.stderr).toBe('ccrc: CCRC_MODELS_ADVANCE_BUDGET_S cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader '
      + 'does not take (it reads only a plain KEY=value line), so the advance step is off for this run\n');
  });
});

// ── the deadline and the release base: what the verb will read in its own shell ────────────────────────────────────────
describe('the deadline and the release base answer as the verb will read them (D-6914 characterization)', () => {
  const dl = (home: string, extra: NodeJS.ProcessEnv = {}): Result =>
    sourced(home, '_upd_deadline_ms >/dev/null; rc=$?; echo "rc $rc from=$KNOB_FROM knob=$KNOB why=$KNOB_WHY"; '
      + 'echo "plain $(_upd_deadline_ms) min $(_upd_deadline_ms min) max $(_upd_deadline_ms max)"', extra);

  it('a decided reading is rc 0 with KNOB and KNOB_FROM and no KNOB_WHY', () => {
    const home = boxWith('ccrc-carve-d-ok-', 'CCRC_UPDATE_DEADLINE_MS=600000\n');
    expect(dl(home).stdout).toBe('rc 0 from=file knob=600000 why=\nplain 600000 min 600000 max 600000\n');
    expect(dl(home, { CCRC_UPDATE_DEADLINE_MS: '700000' }).stdout).toBe('rc 0 from=environment knob=700000 why=\nplain 700000 min 600000 max 700000\n');
    expect(dl(boxWith('ccrc-carve-d-def-', null)).stdout).toBe('rc 0 from=default knob=900000 why=\nplain 900000 min 900000 max 900000\n');
  });

  it('a value that is not canonical digits is rc 1 with KNOB set and KNOB_WHY empty, plain 900000', () => {
    const home = boxWith('ccrc-carve-d-bad-', null);
    expect(dl(home, { CCRC_UPDATE_DEADLINE_MS: '6e5' }).stdout).toBe('rc 1 from=environment knob=6e5 why=\nplain 900000 min 0 max 900000\n');
    expect(dl(home, { CCRC_UPDATE_DEADLINE_MS: '0600000' }).stdout).toBe('rc 1 from=environment knob=0600000 why=\nplain 900000 min 0 max 900000\n');
  });

  it('a ccrc.env the reader cannot take is rc 1 with KNOB empty and KNOB_WHY naming the file', () => {
    const home = boxWith('ccrc-carve-d-unm-', 'export CCRC_UPDATE_DEADLINE_MS=5\n');
    expect(dl(home).stdout.split('\n')[0]).toBe('rc 1 from= knob= why=CCRC_UPDATE_DEADLINE_MS cannot be measured: ~/.ccrc/ccrc.env names it '
      + 'on a line this reader does not take (it reads only a plain KEY=value line)');
  });

  const base = (home: string, extra: NodeJS.ProcessEnv = {}): Result =>
    sourced(home, '_upd_release_base >/dev/null 2>"$HOME/err"; rc=$?; echo "rc $rc from=$KNOB_FROM knob=$KNOB why=$KNOB_WHY"; echo "stderr $(cat "$HOME/err")"', extra);

  it('the release base is rc 0 with KNOB and KNOB_FROM, and its stderr is empty', () => {
    expect(base(boxWith('ccrc-carve-u-env-', null), { CCRC_RELEASE_BASE_URL: 'https://mirror.example.invalid/r' }).stdout)
      .toBe('rc 0 from=environment knob=https://mirror.example.invalid/r why=\nstderr \n');
    expect(base(boxWith('ccrc-carve-u-file-', 'CCRC_RELEASE_BASE_URL=https://mirror.example.invalid/f\n')).stdout)
      .toBe('rc 0 from=file knob=https://mirror.example.invalid/f why=\nstderr \n');
    expect(base(boxWith('ccrc-carve-u-empty-', 'CCRC_RELEASE_BASE_URL=\n')).stdout).toMatch(/^rc 0 from=empty knob=https:\/\/github\.com\/[^ ]+\/releases why=\n/);
    expect(base(boxWith('ccrc-carve-u-def-', null)).stdout).toMatch(/^rc 0 from=default knob=https:\/\/github\.com\/[^ ]+\/releases why=\n/);
  });

  it('an unreadable ccrc.env is rc 1 with KNOB_WHY, said once on stderr with the `ccrc:` prefix and no value', () => {
    const r = base(boxWith('ccrc-carve-u-unm-', 'export CCRC_RELEASE_BASE_URL=https://u:p@h/\n'));
    const why = 'CCRC_RELEASE_BASE_URL cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take '
      + '(it reads only a plain KEY=value line)';
    expect(r.stdout).toBe(`rc 1 from= knob= why=${why}\nstderr ccrc: ${why}\n`);
  });
});

// ── W2 characterization (box settings wave 2): the pure slice-limit check, by direct calls ─────────────────────────────
// `_slice_limit_ok <directive> <value>` is pure: rc 0 when the value is one the slice renderer writes. `sourced()` passes no
// positional argument to the script, so each row hands the directive and the value in as exported variables.
describe('_slice_limit_ok, by direct calls, before its words move (W2 characterization)', () => {
  const rcOf = (dir: string, val: string): string =>
    sourced(boxWith('ccrc-carve-sl-', null), '_slice_limit_ok "$SL_DIR" "$SL_VAL"; echo "rc $?"', { SL_DIR: dir, SL_VAL: val }).stdout.trim();
  it.each([
    ['MemoryMax', '1G', 0], ['MemoryMax', '1073741824', 0], ['MemoryMax', '1048576K', 0], ['MemoryMax', '24G', 0],
    ['MemoryMax', '1%', 0], ['MemoryMax', '100%', 0], ['MemoryMax', '9999999999999999E', 0],
    ['MemoryMax', '1073741823', 1], ['MemoryMax', '1023M', 1], ['MemoryMax', '0', 1], ['MemoryMax', '0%', 1],
    ['MemoryMax', '101%', 1], ['MemoryMax', 'infinity', 1], ['MemoryMax', '1.5G', 1], ['MemoryMax', '01G', 1],
    ['MemoryMax', '1g', 1], ['MemoryMax', '9'.repeat(17), 1],
    ['MemorySwapMax', '0', 0], ['MemorySwapMax', '1M', 0], ['MemorySwapMax', '1048576', 0], ['MemorySwapMax', '6G', 0],
    ['MemorySwapMax', '1048575', 1], ['MemorySwapMax', '1023K', 1], ['MemorySwapMax', '50%', 1],
    ['MemoryHigh', '1G', 1],
  ] as [string, string, number][])('%s %s answers rc %d', (dir, val, rc) => {
    expect(rcOf(dir, val)).toBe(`rc ${rc}`);
  });
});

// ── W2 characterization: wave 1's keep and health sentences, byte for byte, before their words move ───────────────────
describe('the keep and health sentences, byte for byte, before their words move (W2 characterization)', () => {
  const S = (home: string, script: string, extra: NodeJS.ProcessEnv = {}): string => {
    const r = sourced(home, script, extra);
    expect(r.stderr).toBe('');
    return r.stdout;
  };
  it('K1: _keep_why names the key, the value and the bound', () => {
    const h = boxWith('ccrc-carve-k1-', null);
    expect(S(h, '_keep_why CCRC_BACKUP_KEEP "$KV"', { KV: 'abc' })).toBe("CCRC_BACKUP_KEEP='abc' is not a whole number from 0 to 9999");
    expect(S(h, '_keep_why CCRC_BACKUP_DATA_KEEP "$KV" 2', { KV: '1' })).toBe("CCRC_BACKUP_DATA_KEEP='1' is not a whole number from 2 to 9999");
    expect(S(h, '_keep_why CCRC_BACKUP_KEEP "$KV"', { KV: 'x'.repeat(40) })).toBe(`CCRC_BACKUP_KEEP='${'x'.repeat(32)}...' is not a whole number from 0 to 9999`);
    expect(S(h, '_keep_why CCRC_BACKUP_KEEP "$KV"', { KV: 'a\tb' })).toBe("CCRC_BACKUP_KEEP='a?b' is not a whole number from 0 to 9999");
  });
  it('K2: _keep_knob refuses with K1\'s sentence and the source that won', () => {
    const k1 = "CCRC_BACKUP_KEEP='abc' is not a whole number from 0 to 9999";
    const script = '_keep_knob CCRC_BACKUP_KEEP 10; printf \'%s|%s\' "$?" "$KEEP_WHY"';
    expect(S(boxWith('ccrc-carve-k2e-', null), script, { CCRC_BACKUP_KEEP: 'abc' })).toBe(`1|${k1}, as set in the environment`);
    expect(S(boxWith('ccrc-carve-k2f-', 'CCRC_BACKUP_KEEP=abc\n'), script)).toBe(`1|${k1}, as set in the box's ccrc.env`);
  });
  it('H1: _upd_health_s refuses a non-number with its sentence and the default 90', () => {
    const h = boxWith('ccrc-carve-h1-', null);
    expect(S(h, '_upd_health_s; printf \'%s|%s\' "$?" "$UPD_HEALTH_WHY"', { CCRC_UPDATE_HEALTH_S: 'ninety' }))
      .toBe("1|CCRC_UPDATE_HEALTH_S='ninety' is not a number of seconds (digits only, at most 18) — using 90");
  });
});

// ── W2 (box settings wave 2): `ccrc test`'s shape check, called directly on a sourced ccd/ccrc ─────────────────────────
describe('_tshape and _tshape_says live in ccd/ccrc (D-7906)', () => {
  const rc = (script: string): string => sourced(boxWith('ccrc-carve-tshape-', null), `${script}; echo "rc $?"`).stdout.trim();
  it.each([
    ['_tshape CCRC_TEST_HEAVY_SLOTS 99', 'rc 0'],
    ['_tshape CCRC_TEST_HEAVY_SLOTS 100', 'rc 1'],
    ['_tshape OTHER 1', 'rc 1'],
  ])('%s answers %s', (script, want) => {
    expect(rc(script)).toBe(want);
  });
  it('the words, with their newline', () => {
    const h = boxWith('ccrc-carve-tsays-', null);
    expect(sourced(h, '_tshape_says CCRC_TEST_WIDE_FILES').stdout).toBe('a whole number from 0 to 999\n');
    expect(sourced(h, '_tshape_says OTHER').stdout).toBe('a whole number from 1 to 10000\n');
  });
});

// ── W2: the session slice's words, by direct calls (D-7906) ────────────────────────────────────────────────────────────
describe('_slice_limit_says prints the slice limit words, with no newline', () => {
  it.each([
    ['MemoryMax', 'a whole number with an optional K, M, G, T, P or E suffix, at least 1G, or a whole percentage from 1% to 100%'],
    ['MemorySwapMax', 'a whole number with an optional K, M, G, T, P or E suffix, at least 1M, or 0'],
  ])('%s', (dir, words) => {
    expect(sourced(boxWith('ccrc-carve-sls-', null), '_slice_limit_says "$SL_DIR"', { SL_DIR: dir }).stdout).toBe(words);
  });
});

// ── W2: the keepalive's freshness check, by direct calls on a sourced ccd/ccrc (D-7906) ────────────────────────────────
// The values arrive as exported variables, so the empty string and a leading zero reach the function as typed.
const FRESH_ROWS: [string, number][] = [
  ['0', 0], ['0800', 0], ['9223372036854775807', 0], ['30m', 1], ['-1', 1], ['', 1],
  ['9223372036854775808', 2], ['99999999999999999999', 2],
];
describe('_keepalive_fresh_ok and _keepalive_fresh_says live in ccd/ccrc', () => {
  it.each(FRESH_ROWS)('%j answers rc %d', (v, rc) => {
    expect(sourced(boxWith('ccrc-carve-fresh-', null), '_keepalive_fresh_ok "$FV" 2>/dev/null; echo "rc $?"', { FV: v }).stdout.trim()).toBe(`rc ${rc}`);
  });
  it('the words, with no newline', () => {
    expect(sourced(boxWith('ccrc-carve-freshs-', null), '_keepalive_fresh_says').stdout).toBe('a whole number of seconds from 0 to 9223372036854775807');
  });
});
