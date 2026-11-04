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
import { spawnSyncGroup } from './spawnGroup.js';
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
  const r = spawnSyncGroup(BASH, ['-c', `. "$1"; ${script}`, 'ccrc-under-test', CCRC], { env, encoding: 'utf8', input: '', timeout: 60_000 });
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
