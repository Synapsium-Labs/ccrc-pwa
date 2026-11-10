// Box settings view (D-6914, D-7861; wave 2 D-7910): `ccrc settings [--json] [--write] [--from timer]` — what the 61 settings a fleet or server
// node reads resolve to, by display class, printed or recorded as ~/.ccrc/box-settings.json (version 2). Every case runs the REAL
// `bash ccd/ccrc settings` (or the sourced `cmd_settings`, where a ccrc function is stubbed through `stubFn`) in a mkTmp fixture HOME with
// a contained environment: nothing here reaches the live HOME, a manager, a network or tmux. Every row that plants a value asserts the value
// is absent from stdout, stderr, the `--write` file and the human form. Neutral names only: this repository is public.
//
// The corpus row (the `ok` documents of server/test/fixtures/box-settings/, regenerated from the real verb with `date`, `df` and
// `du` stubbed by PATH) is box-settings-read.test.ts's.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import { stubFn } from './ccdStub.js';
import { ccrcSettingsNames } from './ccrcSettingsLine.js';
import { BOX_SETTINGS_SHOWN, BOX_SETTING_REFUSAL_WORDS, BOX_SETTING_SPECS } from '../../shared/api.js';
import { NODE_FILE_CAP_BYTES } from '../src/update/inventory.js';
import { CLAUDE_HEADROOM_GATE_BYTES } from '../../shared/claudeVersion.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CCRC = path.resolve(here, '..', '..', 'ccd', 'ccrc');
const SRC = readFileSync(CCRC, 'utf8');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const REAL = (name: string): string => spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
const FLOCK = REAL('flock');

interface Result { code: number; stdout: string; stderr: string }
interface Row { key: string; state: string; value?: string; from?: string; why?: string }
interface Doc {
  v: number; at: number; reader: string; settings: Row[];
  deadline: { plainMs: number; minMs: number; maxMs: number };
  backups: { state: string; kept?: number; withData?: number; bytes?: number; why?: string };
  disk: { state: string; availBytes?: number; sizeBytes?: number; why?: string };
}

const KEYS = ['CCRC_BACKUP_KEEP', 'CCRC_BACKUP_DATA_KEEP', 'CCRC_VERSIONS_KEEP', 'CCRC_UPDATE_HEALTH_S', 'CCRC_UPDATE_DEADLINE_MS',
  'CCRC_RELEASE_BASE_URL', 'CCRC_MODELS_ADVANCE_BUDGET_S'];
const NOW = 1_792_948_000;

const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) {
    try { if (c.pid !== undefined) process.kill(-c.pid, 'SIGKILL'); } catch { c.kill('SIGKILL'); }
  }
});

function boxWith(prefix: string, envText: string | Buffer | null = null): string {
  const home = mkTmp(prefix);
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  mkdirSync(join(home, 'tmp'), { recursive: true });
  if (envText !== null) writeFileSync(join(home, '.ccrc', 'ccrc.env'), envText);
  return home;
}

/** The environment of a case: contained, every ccrc setting unset, TMPDIR inside the fixture, `extra` over it, and `stubs` (a
 *  directory of executables) first on PATH. */
function envOf(home: string, extra: NodeJS.ProcessEnv = {}, stubs?: string): NodeJS.ProcessEnv {
  const env = ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' });
  for (const k of [...(ccrcSettingsNames(SRC) ?? []), 'CCRC_EXPOSURE_FILE']) delete env[k];
  env['TMPDIR'] = join(home, 'tmp');
  Object.assign(env, extra);
  if (stubs !== undefined) env['PATH'] = `${stubs}:${env['PATH'] ?? ''}`;
  assertNoRealTool(env, home);
  return env;
}

/** `ccrc settings <args>` as an operator runs it. */
function settings(home: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}, stubs?: string): Result {
  const r = spawnSyncGroup(BASH, [CCRC, 'settings', ...args], { env: envOf(home, extra, stubs), encoding: 'utf8', input: '', timeout: 60_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const docOf = (r: Result): Doc => {
  expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  return JSON.parse(r.stdout) as Doc;
};
const json = (home: string, extra: NodeJS.ProcessEnv = {}, args: string[] = []): Doc => docOf(settings(home, ['--json', ...args], extra));
const rowOf = (d: Doc, key: string): Row => {
  const row = d.settings.find((s) => s.key === key);
  expect(row, key).toBeDefined();
  return row!;
};

/** A directory of stubs: `date` answers `NOW` for `+%s` (and the real date for anything else); more by name. */
function stubDir(home: string, more: Record<string, string> = {}): string {
  const dir = join(home, 'stubbin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'date'), `#!/bin/sh\nif [ "$1" = +%s ]; then echo ${NOW}; else exec ${REAL('date')} "$@"; fi\n`, { mode: 0o755 });
  for (const [name, body] of Object.entries(more)) writeFileSync(join(dir, name), body, { mode: 0o755 });
  return dir;
}

/** Every file under ~/.ccrc, by relative name and content digest. */
function ccrcState(home: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(join(home, '.ccrc'), { recursive: true, encoding: 'utf8' })) {
    const p = join(home, '.ccrc', f);
    out[f] = statSync(p).isFile() ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'dir';
  }
  return out;
}

const US = '\u001f';
// On macOS `_ccrc_knob` reads ccrc.env by its own rule: the launchd job sources both env files with bash, so ONE line that is
// not a plain NAME=value line (a space, a control byte, a `?`) makes every key the file names, and CCRC_BACKUP_DATA_KEEP
// always, unmeasured with the launchd sentence. Rows that plant such a line assert that sentence on macOS and keep every leak
// check (a row with a fallback adds its own words after the sentence, so the sentence is matched as a prefix); the Linux-shaped assertions run on a plain fixture there.
const MAC = process.platform === 'darwin';
const LAUNCHD = (k: string): RegExp => new RegExp(`^${k} cannot be measured: ~/\\.ccrc/ccrc\\.env line \\d+ is not a plain NAME=value line, and on macOS the launchd job sources both env files with bash, so that line can change what they set`);
const PLAIN = /^[A-Za-z0-9_./:@%+,=-]+$/;
/** Every key in CCRC_SETTINGS, for the environment of a case (the verb reads 61 of them, wave 1's seven from the environment too). */
const ALL: string[] = ccrcSettingsNames(SRC) ?? [];
const CLS = (k: string): string => BOX_SETTING_SPECS[k as keyof typeof BOX_SETTING_SPECS].cls;
const DEFAULTS: Record<string, string> = {
  CCRC_GRAPH_BUDGET: '4', CCRC_TESTBOX_QUEUE_WAIT: '10m', CCRC_TEST_SLICE_CPU_QUOTA: '400%', CCRC_SESSION_SLICE_MEMORY_MAX: '24G',
  CCRC_KEEPALIVE_FRESH: '1800', CCRC_USAGE_SWEEP_DAYS: '7', CCRC_CARRY_COPY_WARN_BYTES: '10737418240', CCRC_TESTBOX_LOST_RUN: 'local',
};

/** Runs a shell script after sourcing ccd/ccrc (or a copy of it), in the fixture HOME. */
function shell(home: string, script: string, extra: NodeJS.ProcessEnv = {}, ccrc: string = CCRC): Result {
  const r = spawnSyncGroup(BASH, ['-c', `. "$1"; ${script}`, 'x', ccrc], { env: envOf(home, extra), encoding: 'utf8', input: '', timeout: 120_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const COPIES: Record<string, string> = {};
/** A copy of ccd/ with the named libraries missing, so a verb run from it cannot load them. */
function ccrcWithout(...names: string[]): string {
  const key = names.join('+');
  if (COPIES[key] === undefined) {
    const dir = join(mkTmp('ccrc-sv-ccd-'), 'ccd');
    cpSync(path.dirname(CCRC), dir, { recursive: true });
    for (const n of names) rmSync(join(dir, n));
    COPIES[key] = join(dir, 'ccrc');
  }
  return COPIES[key];
}
/** The verb run from `ccrc` (a copy of ccd/ccrc) as `settings --json`. */
function jsonFrom(home: string, ccrc: string, extra: NodeJS.ProcessEnv = {}): Doc {
  const r = spawnSyncGroup(BASH, [ccrc, 'settings', '--json'], { env: envOf(home, extra), encoding: 'utf8', input: '', timeout: 120_000 });
  return docOf({ code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' });
}

interface Surfaces { json: Result; human: Result; file: string }
/** Every place a value could leave the box: the verb's stdout and stderr, the `--write` file, and the human form with its stderr. */
function surfaces(home: string, extra: NodeJS.ProcessEnv = {}): Surfaces {
  // `df` is stubbed: a live filesystem's figures could hold any digits a needle names.
  const stubs = stubDir(home, { df: '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/fixture 1000 400 600 40%% /\\n"\n' });
  const j = settings(home, ['--json', '--write'], extra, stubs);
  const h = settings(home, [], extra, stubs);
  return { json: j, human: h, file: readFileSync(join(home, '.ccrc', 'box-settings.json'), 'utf8') };
}
function expectAbsent(s: Surfaces, needles: string[], ctx: string): void {
  for (const n of needles) {
    for (const [name, text] of [['stdout', s.json.stdout], ['stderr', s.json.stderr], ['the file', s.file], ['the human form', s.human.stdout], ['the human stderr', s.human.stderr]] as const) {
      expect(text, `${ctx}: ${name} holds ${JSON.stringify(n)}`).not.toContain(n);
    }
  }
}

describe('ccrc settings: the 61 settings by display class, and where each came from (D-7861, D-7910)', () => {
  it('V1: version 2 lists BOX_SETTINGS_SHOWN in order; the verb holds no literal key list; every row is ok and default, a value row at its default, an is-set row bare', () => {
    const line = /^CCRC_SETTINGS=\(([A-Z0-9_ ]+)\)$/m.exec(SRC)?.[1]?.split(' ') ?? [];
    expect(line.length).toBeGreaterThan(61);
    for (const k of KEYS) expect(line.filter((n) => n === k), `${k} appears once in CCRC_SETTINGS`).toHaveLength(1);
    expect(line.slice(0, 7), 'the seven are the first seven of CCRC_SETTINGS').toEqual(KEYS);
    expect(/^BOX_SETTINGS_KEYS=\(/m.test(SRC), 'ccd/ccrc holds no BOX_SETTINGS_KEYS literal (D-7910)').toBe(false);
    const home = boxWith('ccrc-sv-keys-');
    const r = settings(home, ['--json']);
    const d = docOf(r);
    expect(d.v).toBe(2);
    expect(d.settings.map((s) => s.key)).toEqual([...BOX_SETTINGS_SHOWN]);
    expect(d.settings.map((s) => s.key)).not.toContain('CCRC_TESTBOX_RUNS');
    expect(d.settings.slice(0, 7).map((s) => s.key)).toEqual(KEYS);
    for (const row of d.settings) {
      if (CLS(row.key) === 'is-set') expect(row, row.key).toEqual({ key: row.key, state: 'ok', from: 'default' });
      else { expect(row.state, row.key).toBe('ok'); expect(row.from, row.key).toBe('default'); expect(typeof row.value, row.key).toBe('string'); }
    }
    for (const [k, v] of Object.entries(DEFAULTS)) expect(rowOf(d, k), k).toEqual({ key: k, state: 'ok', value: v, from: 'default' });
    expect(r.stdout, 'CCRC_GRAPH_STORE\'s default is under the HOME, and the HOME is nowhere').not.toContain(home);
    expect(r.stderr).toBe('');
  });

  it('reads each source as itself: environment, file, empty and default', () => {
    const home = boxWith('ccrc-sv-src-', 'CCRC_BACKUP_DATA_KEEP=4\nCCRC_VERSIONS_KEEP=\n');
    const d = json(home, { CCRC_BACKUP_KEEP: '5' });
    expect(rowOf(d, 'CCRC_BACKUP_KEEP')).toEqual({ key: 'CCRC_BACKUP_KEEP', state: 'ok', value: '5', from: 'environment' });
    expect(rowOf(d, 'CCRC_BACKUP_DATA_KEEP')).toEqual({ key: 'CCRC_BACKUP_DATA_KEEP', state: 'ok', value: '4', from: 'file' });
    expect(rowOf(d, 'CCRC_VERSIONS_KEEP')).toEqual({ key: 'CCRC_VERSIONS_KEEP', state: 'ok', value: '3', from: 'empty' });
    expect(rowOf(d, 'CCRC_UPDATE_HEALTH_S')).toEqual({ key: 'CCRC_UPDATE_HEALTH_S', state: 'ok', value: '90', from: 'default' });
    expect(rowOf(d, 'CCRC_UPDATE_DEADLINE_MS')).toEqual({ key: 'CCRC_UPDATE_DEADLINE_MS', state: 'ok', value: '900000', from: 'default' });
    expect(rowOf(d, 'CCRC_RELEASE_BASE_URL')).toEqual({ key: 'CCRC_RELEASE_BASE_URL', state: 'ok', value: 'default', from: 'default' });
    expect(rowOf(d, 'CCRC_MODELS_ADVANCE_BUDGET_S')).toEqual({ key: 'CCRC_MODELS_ADVANCE_BUDGET_S', state: 'ok', value: '250', from: 'default' });
  });

  it('shows what the act uses: a keep is decimal (0007 is 7), a window as written, a budget in base 10, the deadline plain', () => {
    const home = boxWith('ccrc-sv-used-');
    const d = json(home, { CCRC_BACKUP_KEEP: '0007', CCRC_UPDATE_HEALTH_S: '120', CCRC_MODELS_ADVANCE_BUDGET_S: '0250', CCRC_UPDATE_DEADLINE_MS: '600000' });
    expect(rowOf(d, 'CCRC_BACKUP_KEEP').value).toBe('7');
    expect(rowOf(d, 'CCRC_UPDATE_HEALTH_S').value).toBe('120');
    expect(rowOf(d, 'CCRC_MODELS_ADVANCE_BUDGET_S').value).toBe('250');
    expect(rowOf(d, 'CCRC_UPDATE_DEADLINE_MS')).toEqual({ key: 'CCRC_UPDATE_DEADLINE_MS', state: 'ok', value: '600000', from: 'environment' });
    expect(d.deadline).toEqual({ plainMs: 600000, minMs: 600000, maxMs: 600000 });
  });
});

describe('ccrc settings: a setting other than wave 1\'s is read in file mode (D-7910, spec D20, 5.7)', () => {
  it('V2: ccrc.env values read from the file; the same keys set only in the environment read their defaults; wave 1\'s keep their mode', () => {
    const home = boxWith('ccrc-sv-v2-', 'CCRC_GRAPH_BUDGET=6\nCCRC_TESTBOX_POLL=45s\nCCRC_KEEPALIVE_FRESH=900\n');
    const d = json(home);
    expect(rowOf(d, 'CCRC_GRAPH_BUDGET')).toEqual({ key: 'CCRC_GRAPH_BUDGET', state: 'ok', value: '6', from: 'file' });
    expect(rowOf(d, 'CCRC_TESTBOX_POLL')).toEqual({ key: 'CCRC_TESTBOX_POLL', state: 'ok', value: '45s', from: 'file' });
    expect(rowOf(d, 'CCRC_KEEPALIVE_FRESH')).toEqual({ key: 'CCRC_KEEPALIVE_FRESH', state: 'ok', value: '900', from: 'file' });
    const e = json(boxWith('ccrc-sv-v2b-'), { CCRC_GRAPH_BUDGET: '9', CCRC_TESTBOX_POLL: '5s', CCRC_KEEPALIVE_FRESH: '60', CCRC_TEST_PRESSURE_MAX: '50' });
    expect(rowOf(e, 'CCRC_GRAPH_BUDGET')).toEqual({ key: 'CCRC_GRAPH_BUDGET', state: 'ok', value: '4', from: 'default' });
    expect(rowOf(e, 'CCRC_TESTBOX_POLL')).toEqual({ key: 'CCRC_TESTBOX_POLL', state: 'ok', value: '30s', from: 'default' });
    expect(rowOf(e, 'CCRC_KEEPALIVE_FRESH')).toEqual({ key: 'CCRC_KEEPALIVE_FRESH', state: 'ok', value: '1800', from: 'default' });
    expect(rowOf(e, 'CCRC_TEST_PRESSURE_MAX'), '`_test_knobs` reads the pressure bound environment-first; the verb reads it in file mode').toEqual({ key: 'CCRC_TEST_PRESSURE_MAX', state: 'ok', value: '0', from: 'default' });
    expect(rowOf(json(boxWith('ccrc-sv-v2c-'), { CCRC_BACKUP_KEEP: '5' }), 'CCRC_BACKUP_KEEP')).toEqual({ key: 'CCRC_BACKUP_KEEP', state: 'ok', value: '5', from: 'environment' });
  });
});

describe('ccrc settings: a refused row carries the check\'s words and its source, never the value (D14, D22)', () => {
  /** A value each check refuses; the default is `zz-refused-<i>`, and a key whose check accepts that has its own here. */
  const REFUSED_SAMPLE: Record<string, string> = {
    CCRC_TESTBOX_GIT_KEY: 'relative/key', CCRC_TESTBOX_UNTRACKED_FILE_MAX: '5MB', CCRC_GRAPH_MAX_SHRINK_PCT: '150', CCRC_GRAPH_SOURCE_REF: '../x',
    CCRC_TEST_SLICE_CPU_QUOTA: '4', CCRC_SESSION_SLICE_MEMORY_MAX: '90', CCRC_KEEPALIVE_FRESH: '30m', CCRC_USAGE_SWEEP_DAYS: '0',
    CCRC_CARRY_COPY_WARN_BYTES: '10G', CCRC_TESTBOX_DENY_GLOBS: 'a\tzz-denied', CCRC_BROWSER_MCP_SERVERS: 'zz/refused-servers',
  };
  const LIST = `for k in ${BOX_SETTINGS_SHOWN.join(' ')}; do w="$(_set_says "$k")" && printf '%s\\037%s\\n' "$k" "$w"; done`;
  const WITH_WORDS = (): [string, string][] => {
    const home = boxWith('ccrc-sv-v4w-');
    const r = shell(home, `_set_libs; ${LIST}`);
    expect(r.code, r.stderr).toBe(0);
    return r.stdout.split('\n').filter(Boolean).map((l) => l.split(US) as [string, string]);
  };

  it('V4: every key _set_says has words for (the 67) is written refused, with its words and its source, and the sample is nowhere', () => {
    const keys = WITH_WORDS();
    expect(keys).toHaveLength(67);
    const sample = (k: string, i: number): string => REFUSED_SAMPLE[k] ?? `zz-refused-${i}`;
    const home = boxWith('ccrc-sv-v4-', keys.map(([k], i) => `${k}=${sample(k, i)}\n`).join(''));
    // The sample is a refused one, in this fixture, for every key: a sample a check accepts fails here, loudly.
    const rcs = shell(home, `_set_libs; ${keys.map(([k], i) => `_set_check ${k} "$V${i}"; echo "${k} $?"`).join('; ')}`,
      Object.fromEntries(keys.map(([k], i) => [`V${i}`, sample(k, i)])));
    expect(rcs.stdout.trim().split('\n').filter((l) => !l.endsWith(' 1')), 'a sample the check does not refuse').toEqual([]);
    const s = surfaces(home);
    const d = docOf(s.json);
    const refusedRows = (doc: Doc, ks: [string, string][]): void => {
      for (const [k, words] of ks) {
        expect(rowOf(doc, k), k).toEqual({ key: k, state: 'refused', from: 'file', why: words.replace(/\n$/, '') });
        expect(rowOf(doc, k), k).not.toHaveProperty('value');
      }
    };
    const needles = keys.flatMap(([k], i) => [...sample(k, i).split(/[\t/]/), sample(k, i)]).filter((t) => t.length >= 4);
    if (!MAC) {
      refusedRows(d, keys);
      expect(d.settings.filter((r) => r.state === 'refused')).toHaveLength(67);
      expect(BOX_SETTING_REFUSAL_WORDS.length).toBeGreaterThan(0);
      for (const r of d.settings.filter((x) => x.state === 'refused')) expect(BOX_SETTING_REFUSAL_WORDS, r.key).toContain(r.why);
    } else {
      // Some sample is not a plain line, so the launchd rule makes every key the file names unmeasured; the refused rows are
      // then measured on a file of the plain samples alone.
      expect(keys.some(([k], i) => !PLAIN.test(sample(k, i))), 'the fixture holds a non-plain line').toBe(true);
      for (const [k] of keys) expect(rowOf(d, k), k).toEqual({ key: k, state: 'unmeasured', why: expect.stringMatching(LAUNCHD(k)) });
      const plain = keys.filter(([k], i) => PLAIN.test(sample(k, i)));
      expect(plain.length).toBeGreaterThan(0);
      const home2 = boxWith('ccrc-sv-v4p-', keys.map(([k], i) => (PLAIN.test(sample(k, i)) ? `${k}=${sample(k, i)}\n` : '')).join(''));
      const s2 = surfaces(home2);
      const d2 = docOf(s2.json);
      refusedRows(d2, plain);
      for (const r of d2.settings.filter((x) => x.state === 'refused')) expect(BOX_SETTING_REFUSAL_WORDS, r.key).toContain(r.why);
      expectAbsent(s2, needles, 'V4 plain');
    }
    expectAbsent(s, needles, 'V4');
  });

  it.each([
    ['CCRC_TESTBOX_GIT_KEY', 'relative/key', 'an absolute path, or one starting ~/, with no . or .. part'],
    ['CCRC_TESTBOX_UNTRACKED_FILE_MAX', '5MB', 'a whole number with a K, M or G suffix'],
    ['CCRC_GRAPH_MAX_SHRINK_PCT', '150', 'a whole percentage from 0 to 100'],
    ['CCRC_GRAPH_SOURCE_REF', '../x', 'a ref name such as origin/HEAD'],
    ['CCRC_TEST_SLICE_CPU_QUOTA', '4', 'a whole percentage such as 400%'],
    ['CCRC_SESSION_SLICE_MEMORY_MAX', '90', 'a whole number with an optional K, M, G, T, P or E suffix, at least 1G, or a whole percentage from 1% to 100%'],
    ['CCRC_KEEPALIVE_FRESH', '30m', 'a whole number of seconds from 0 to 9223372036854775807'],
    ['CCRC_USAGE_SWEEP_DAYS', '0', 'a whole number from 1 to 999'],
    ['CCRC_CARRY_COPY_WARN_BYTES', '10G', 'a whole number of bytes from 1 to 18 digits'],
  ])('V4 named: %s=%s reads refused from the file with its words', (k, v, words) => {
    const home = boxWith('ccrc-sv-v4n-', `${k}=${v}\n`);
    const s = surfaces(home);
    expect(rowOf(docOf(s.json), k)).toEqual({ key: k, state: 'refused', from: 'file', why: words });
    expectAbsent(s, [`${k}=${v}`, `'${v}'`], k);
  });

  it('V4 wave 1: the seven\'s refusals are the check\'s words, from the environment or the file, and the value is nowhere', () => {
    const home = boxWith('ccrc-sv-v4w1-', 'CCRC_BACKUP_DATA_KEEP=1\nCCRC_UPDATE_DEADLINE_MS=6e5\nCCRC_MODELS_ADVANCE_BUDGET_S=off\n');
    const extra = { CCRC_BACKUP_KEEP: 'abc', CCRC_UPDATE_HEALTH_S: 'ninety' };
    const s = surfaces(home, extra);
    const d = docOf(s.json);
    expect(rowOf(d, 'CCRC_BACKUP_KEEP')).toEqual({ key: 'CCRC_BACKUP_KEEP', state: 'refused', from: 'environment', why: 'a whole number from 0 to 9999' });
    expect(rowOf(d, 'CCRC_BACKUP_DATA_KEEP')).toEqual({ key: 'CCRC_BACKUP_DATA_KEEP', state: 'refused', from: 'file', why: 'a whole number from 2 to 9999' });
    expect(rowOf(d, 'CCRC_UPDATE_HEALTH_S')).toEqual({ key: 'CCRC_UPDATE_HEALTH_S', state: 'refused', from: 'environment', why: 'a number of seconds (digits only, at most 18)' });
    expect(rowOf(d, 'CCRC_UPDATE_DEADLINE_MS')).toEqual({ key: 'CCRC_UPDATE_DEADLINE_MS', state: 'refused', from: 'file',
      why: 'a positive whole number of milliseconds in canonical digits (at most 15, no lead zero)' });
    expect(rowOf(d, 'CCRC_MODELS_ADVANCE_BUDGET_S')).toEqual({ key: 'CCRC_MODELS_ADVANCE_BUDGET_S', state: 'refused', from: 'file', why: 'a whole number of seconds from 0 to 3600' });
    expect(d.deadline.plainMs).toBe(900000);
    expect(d.deadline.minMs, 'min is 0 when a reading cannot be decided').toBe(0);
    expectAbsent(s, ['abc', 'ninety', '6e5', "'off'", '=off'], 'wave 1');
    for (const v of ['3601', '99999', 'off']) {
      const h2 = boxWith('ccrc-sv-v4w1b-');
      const s2 = surfaces(h2, { CCRC_MODELS_ADVANCE_BUDGET_S: v });
      expect(rowOf(docOf(s2.json), 'CCRC_MODELS_ADVANCE_BUDGET_S')).toEqual({ key: 'CCRC_MODELS_ADVANCE_BUDGET_S', state: 'refused', from: 'environment', why: 'a whole number of seconds from 0 to 3600' });
      expectAbsent(s2, [v === 'off' ? "'off'" : v], `budget ${v}`);
    }
  });
});

describe('ccrc settings: a ccrc.env the reader cannot take is unmeasured, never unset (D-6365, D-6604)', () => {
  it('V5: a NUL byte makes all 61 settings unmeasured, each why naming the key and the file, at most 240 bytes, and the verb still answers rc 0', () => {
    const d = json(boxWith('ccrc-sv-nul-', Buffer.from('NOTE=x\u0000y\n', 'utf8')));
    expect(d.v).toBe(2);
    expect(d.settings.map((s) => s.state)).toEqual(BOX_SETTINGS_SHOWN.map(() => 'unmeasured'));
    for (const s of d.settings) {
      expect(s.why, s.key).toContain(`${s.key} cannot be measured:`);
      expect(s.why, s.key).toContain('~/.ccrc/ccrc.env');
      expect(Buffer.byteLength(s.why!), s.key).toBeLessThanOrEqual(240);
      expect(s).not.toHaveProperty('value');
      expect(s).not.toHaveProperty('from');
    }
  });

  // Each platform's own reader (`_ccrc_knob`). On Linux the systemd reader makes only the key on the bad line unmeasured. On macOS the
  // launchd job sources the whole file with bash, so the shell reader refuses every key that job reads.
  it('an inner CR: on Linux only the key on that line is unmeasured, on macOS the keys the launchd job reads', () => {
    const d = json(boxWith('ccrc-sv-cr-', 'CCRC_BACKUP_KEEP=5\rjunk\nNOTE=1\n'));
    expect(rowOf(d, 'CCRC_BACKUP_KEEP').state).toBe('unmeasured');
    const unm = d.settings.filter((s) => s.state === 'unmeasured').map((s) => s.key);
    // macOS: the keys the file names (CCRC_BACKUP_KEEP) plus CCRC_BACKUP_DATA_KEEP, which `_ccrc_knob` always reads through the
    // launchd model there. A key the file never names (CCRC_VERSIONS_KEEP) reads as before, ok: wave 2's rows that read in file
    // mode (`_ccrc_knob ... file`) are read only for keys the file names, so none of them changes this.
    if (MAC) expect(unm).toEqual(['CCRC_BACKUP_KEEP', 'CCRC_BACKUP_DATA_KEEP']);
    else expect(unm).toEqual(['CCRC_BACKUP_KEEP']);
    expect(rowOf(d, 'CCRC_VERSIONS_KEEP').state).toBe('ok');
  });

  it('V6: a reader sentence over 240 bytes is cut at 240 and ends with three dots', () => {
    const d = json(boxWith('ccrc-sv-long-', 'CCRC_BACKUP_KEEP="5\nCCRC_X=1"\n'));
    const r = rowOf(d, 'CCRC_BACKUP_KEEP');
    expect(r.state).toBe('unmeasured');
    if (process.platform !== 'darwin') {
      expect(r.why!.startsWith("CCRC_BACKUP_KEEP cannot be measured: ~/.ccrc/ccrc.env names CCRC_BACKUP_KEEP in a shape this reader does not decide (a space around '=', an export prefix")).toBe(true);
      expect(Buffer.byteLength(r.why!)).toBe(240);
      expect(r.why!.endsWith('...')).toBe(true);
    }
  });

  it('a ccrc.env that cannot be read at all (mode 000) names ~/.ccrc/ccrc.env, never the fixture HOME', () => {
    if (process.getuid?.() === 0) return;
    const home = boxWith('ccrc-sv-unread-', 'NOTE=1\n');
    chmodSync(join(home, '.ccrc', 'ccrc.env'), 0o000);
    try {
      const r = settings(home, ['--json']);
      const d = docOf(r);
      expect(d.settings.map((s) => s.state)).toEqual(BOX_SETTINGS_SHOWN.map(() => 'unmeasured'));
      expect(rowOf(d, 'CCRC_BACKUP_KEEP').why).toBe('CCRC_BACKUP_KEEP cannot be measured: ~/.ccrc/ccrc.env is there but cannot be read');
      expect(r.stdout).not.toContain(home);
    } finally { chmodSync(join(home, '.ccrc', 'ccrc.env'), 0o600); }
  });

  it('a ccrc.env that cannot be read for the release base reads unmeasured, not default', () => {
    const sf = surfaces(boxWith('ccrc-sv-unm-url-', 'export CCRC_RELEASE_BASE_URL=https://u:p@h/r\n'));
    const d = docOf(sf.json);
    expectAbsent(sf, ['u:p', 'u:p@h', 'p@h/', 'https://h'], 'unreadable release base');
    expect(rowOf(d, 'CCRC_RELEASE_BASE_URL')).toEqual({ key: 'CCRC_RELEASE_BASE_URL', state: 'unmeasured',
      why: 'CCRC_RELEASE_BASE_URL cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take (it reads only a plain KEY=value line)' });
  });

  it('V5: `export CCRC_GRAPH_BUDGET=6` makes that key alone unmeasured, with the reader\'s sentence', () => {
    const d = json(boxWith('ccrc-sv-v5x-', 'export CCRC_GRAPH_BUDGET=6\n'));
    const r = rowOf(d, 'CCRC_GRAPH_BUDGET');
    expect(r.state).toBe('unmeasured');
    expect(r.why).toContain('CCRC_GRAPH_BUDGET cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take');
    expect(d.settings.filter((s) => s.state !== 'ok').map((s) => s.key)).toEqual(['CCRC_GRAPH_BUDGET']);
  });

  it('V5: with graph-resolve hidden the 23 graph rows are unmeasured with its sentence; with testbox-knobs hidden the 16 test box rows with its; nothing else changes', () => {
    const home = boxWith('ccrc-sv-v5lib-');
    const base = json(home);
    const graph = jsonFrom(home, ccrcWithout('graph-resolve'));
    const gRows: string[] = BOX_SETTINGS_SHOWN.filter((k) => k.startsWith('CCRC_GRAPH_'));
    expect(gRows).toHaveLength(23);
    for (const k of gRows) expect(rowOf(graph, k), k).toEqual({ key: k, state: 'unmeasured', why: 'the graph settings check (graph-resolve) could not be loaded beside ccrc' });
    for (const row of graph.settings.filter((r) => !gRows.includes(r.key))) expect(row, row.key).toEqual(rowOf(base, row.key));
    const tb = jsonFrom(home, ccrcWithout('testbox-knobs'));
    const tRows: string[] = BOX_SETTINGS_SHOWN.filter((k) => k.startsWith('CCRC_TESTBOX_'));
    expect(tRows).toHaveLength(16);
    for (const k of tRows) expect(rowOf(tb, k), k).toEqual({ key: k, state: 'unmeasured', why: 'the test box settings check (testbox-knobs) could not be loaded beside ccrc' });
    for (const row of tb.settings.filter((r) => !tRows.includes(r.key))) expect(row, row.key).toEqual(rowOf(base, row.key));
  });
});

describe('ccrc settings: a unit separator in a value is never split into a why (review L1)', () => {
  const sentence = (k: string): string => `${k}'s value holds a control byte this view does not record`;
  it.each([['CCRC_GRAPH_STORE', '/x'], ['CCRC_TEST_SLICE_MEMORY_MAX', '6G'], ['CCRC_KEEPALIVE_PROMPT', 'a']])('V11: %s=%s<US>zz-secret reads the fixed sentence, and zz-secret is nowhere', (k, head) => {
    const home = boxWith('ccrc-sv-v11-', Buffer.from(`${k}=${head}${US}zz-secret\n`, 'latin1'));
    const s = surfaces(home);
    const d = docOf(s.json);
    if (MAC) {
      // The launchd rule pre-empts the control-byte sentence: the line is not plain, so the keys the file names and
      // CCRC_BACKUP_DATA_KEEP read unmeasured with the launchd sentence. The fixed sentence is Linux's; the leak half is both.
      expect(rowOf(d, k)).toEqual({ key: k, state: 'unmeasured', why: expect.stringMatching(LAUNCHD(k)) });
      expect(d.settings.filter((r) => r.state !== 'ok').map((r) => r.key).sort()).toEqual([k, 'CCRC_BACKUP_DATA_KEEP'].sort());
    } else {
      expect(rowOf(d, k)).toEqual({ key: k, state: 'unmeasured', why: sentence(k) });
      expect(d.settings.filter((r) => r.state !== 'ok').map((r) => r.key)).toEqual([k]);
    }
    expectAbsent(s, ['zz-secret', US], k);
  });
});

describe('ccrc settings: nothing private reaches the output or the file', () => {
  it('a keep value of $HOME/x is refused, and the fixture HOME appears nowhere', () => {
    const home = boxWith('ccrc-sv-red1-');
    const s = surfaces(home, { CCRC_BACKUP_KEEP: `${home}/x` });
    expect(rowOf(docOf(s.json), 'CCRC_BACKUP_KEEP')).toEqual({ key: 'CCRC_BACKUP_KEEP', state: 'refused', from: 'environment', why: 'a whole number from 0 to 9999' });
    expectAbsent(s, [home], 'keep');
  });

  it.each(['CCRC_BACKUP_KEEP', 'CCRC_BACKUP_DATA_KEEP', 'CCRC_VERSIONS_KEEP'])(
    'a refused %s holding a path under a HOME of 40+ characters shows no part of the home path', (key) => {
      const home = boxWith(`ccrc-sv-long-home-${'p'.repeat(40)}-`);
      expect(home.length, 'the fixture HOME is long').toBeGreaterThan(40);
      const s = surfaces(home, { [key]: `${home}/backups` });
      const row = rowOf(docOf(s.json), key);
      expect(row.state).toBe('refused');
      expect(row).not.toHaveProperty('value');
      expect(row.why).toBe(key === 'CCRC_BACKUP_DATA_KEEP' ? 'a whole number from 2 to 9999' : 'a whole number from 0 to 9999');
      for (const [name, out] of [['stdout', s.json.stdout], ['stderr', s.json.stderr], ['file', s.file], ['human', s.human.stdout]] as const) {
        expect(out, name).not.toContain(home);
        expect(out, `${name}: no prefix of the home path`).not.toContain(home.slice(0, 9));
        for (let i = 0; i + 12 <= home.length; i++) expect(out, `${name}: a 12-character window of the home path at ${i}`).not.toContain(home.slice(i, i + 12));
      }
    });

  it('a health window under the fixture HOME or with userinfo is refused, and neither the path nor the credential is printed', () => {
    const home = boxWith('ccrc-sv-red2-');
    const s = surfaces(home, { CCRC_UPDATE_HEALTH_S: `${home}/deep/x` });
    expect(rowOf(docOf(s.json), 'CCRC_UPDATE_HEALTH_S')).toEqual({ key: 'CCRC_UPDATE_HEALTH_S', state: 'refused', from: 'environment', why: 'a number of seconds (digits only, at most 18)' });
    expectAbsent(s, [home, 'deep/x'], 'path');
    const h3 = boxWith('ccrc-sv-red3-');
    const s3 = surfaces(h3, { CCRC_UPDATE_HEALTH_S: 'https://u:p@h/' });
    expect(rowOf(docOf(s3.json), 'CCRC_UPDATE_HEALTH_S').state).toBe('refused');
    expectAbsent(s3, ['u:p', 'h/'], 'userinfo');
  });

  it('every string is printable ASCII, and a refused value with a tab, a CR, a quote, a backslash or a non-ASCII byte records none of it', () => {
    const home = boxWith('ccrc-sv-ascii-');
    const s = surfaces(home, { CCRC_UPDATE_HEALTH_S: 'a\tb\rc', CCRC_BACKUP_KEEP: 'café"\\' });
    const d = docOf(s.json);
    expect(rowOf(d, 'CCRC_UPDATE_HEALTH_S').state).toBe('refused');
    expect(rowOf(d, 'CCRC_BACKUP_KEEP').state).toBe('refused');
    // eslint-disable-next-line no-control-regex
    expect(s.json.stdout.replace(/\n$/, '')).toMatch(/^[\x20-\x7e]*$/);
    expectAbsent(s, ['café', 'a\tb'], 'ascii');
  });

  it('a refused 900-byte value records nothing of it (the version-1 cut of a refused value is retired)', () => {
    const home = boxWith('ccrc-sv-cut-');
    const s = surfaces(home, { CCRC_UPDATE_HEALTH_S: 'x'.repeat(900) });
    const row = rowOf(docOf(s.json), 'CCRC_UPDATE_HEALTH_S');
    expect(row).toEqual({ key: 'CCRC_UPDATE_HEALTH_S', state: 'refused', from: 'environment', why: 'a number of seconds (digits only, at most 18)' });
    expectAbsent(s, ['xxxxxxxx'], 'cut');
  });
});

describe('ccrc settings: an ok value outside the envelope, or a refused-looking one, is never shown (D-7909)', () => {
  it('V6: a 40-digit size its check passes reads unmeasured with the value\'s fixed why, never a cut or the whole value', () => {
    const big = `1${'9'.repeat(39)}M`;
    const home = boxWith('ccrc-sv-v6a-', `CCRC_TESTBOX_SNAPSHOT_MAX=${big}\n`);
    const s = surfaces(home);
    expect(rowOf(docOf(s.json), 'CCRC_TESTBOX_SNAPSHOT_MAX')).toEqual({ key: 'CCRC_TESTBOX_SNAPSHOT_MAX', state: 'unmeasured',
      why: "CCRC_TESTBOX_SNAPSHOT_MAX's value passes its check but is wider than this view records (at most 32 digits and one unit, or one of its words)" });
    expectAbsent(s, ['9999999999', big], 'snapshot');
  });

  it('V6: `_upd_url_origin https://h:abc/r` answers rc 0 and https://h:abc (measured), so the base reads unmeasured with the origin\'s fixed why', () => {
    const home = boxWith('ccrc-sv-v6b-');
    const o = shell(home, '_upd_url_origin "https://h:abc/r"; echo " rc $?"');
    expect(o.stdout).toBe('https://h:abc rc 0\n');
    const s = surfaces(home, { CCRC_RELEASE_BASE_URL: 'https://h:abc/r' });
    expect(rowOf(docOf(s.json), 'CCRC_RELEASE_BASE_URL')).toEqual({ key: 'CCRC_RELEASE_BASE_URL', state: 'unmeasured',
      why: "CCRC_RELEASE_BASE_URL's origin is wider than this view records (an http or https scheme, a plain host name and a port)" });
    expectAbsent(s, ['h:abc'], 'base');
  });

  it('V6: `https://` alone (rc 0, origin `https://`) reads unmeasured with the origin\'s fixed why, never `custom https://` (review L10)', () => {
    const home = boxWith('ccrc-sv-v6c-');
    const o = shell(home, '_upd_url_origin "https://"; echo " rc $?"');
    expect(o.stdout).toBe('https:// rc 0\n');
    const sf = surfaces(home, { CCRC_RELEASE_BASE_URL: 'https://' });
    const row = rowOf(docOf(sf.json), 'CCRC_RELEASE_BASE_URL');
    expectAbsent(sf, ['custom https://'], 'bare scheme');
    expect(row.state).toBe('unmeasured');
    expect(row.why).toBe("CCRC_RELEASE_BASE_URL's origin is wider than this view records (an http or https scheme, a plain host name and a port)");
  });

  it('V6: wave 1\'s value rows go through the envelope too: 9999 reads ok, and a resolver that answers /etc/x reads unmeasured, the value in neither stream', () => {
    const home = boxWith('ccrc-sv-v6d-');
    expect(rowOf(json(home, { CCRC_BACKUP_KEEP: '9999' }), 'CCRC_BACKUP_KEEP')).toEqual({ key: 'CCRC_BACKUP_KEEP', state: 'ok', value: '9999', from: 'environment' });
    const r = shell(home, '_bak_keep() { KEEP=/etc/x; KEEP_WHY=; KNOB_FROM=default; }; cmd_settings --json');
    const d = docOf(r);
    expect(rowOf(d, 'CCRC_BACKUP_KEEP')).toEqual({ key: 'CCRC_BACKUP_KEEP', state: 'unmeasured',
      why: "CCRC_BACKUP_KEEP's value passes its check but is wider than this view records (at most 32 digits and one unit, or one of its words)" });
    expect(r.stdout).not.toContain('/etc/x');
    expect(r.stderr).not.toContain('/etc/x');
  });
});

describe('ccrc settings: the largest document fits the node-file cap (spec 5.4, V7)', () => {
  it('V7: the worst row of each key and the worst top level, built from the writer\'s own functions, stay under NODE_FILE_CAP_BYTES', () => {
    const home = boxWith('ccrc-sv-v7-');
    const quotes = '"'.repeat(3000);   // handed in through the environment: every byte a quote, which escapes to two; longer than any cut, so the writer's own cut decides the size
    const script = [
      'rows=""; sep=""',
      `for k in ${BOX_SETTINGS_SHOWN.join(' ')}; do`,
      '  a="$(_set_row_json "$k" unmeasured "" "" "$Q")"; b="$(_set_row_json "$k" ok environment "${N}E" "")"',
      '  if [ "${#a}" -ge "${#b}" ]; then r="$a"; else r="$b"; fi',
      '  rows+="$sep$r"; sep=,',
      'done',
      'bw="$(_set_json "$Q480")"',
      'printf \'{"v":2,"at":17929480000,"reader":"shell","settings":[%s],"deadline":{"plainMs":999999999999999,"minMs":999999999999999,"maxMs":999999999999999},"backups":{"state":"unmeasured","why":%s},"disk":{"state":"unmeasured","why":%s}}\\n\' "$rows" "$bw" "$bw"',
    ].join('\n');
    const r = shell(home, script, { Q: quotes, Q480: '"'.repeat(480), N: '9'.repeat(32) });
    expect(r.code, r.stderr).toBe(0);
    const bytes = Buffer.byteLength(r.stdout);
    expect(() => JSON.parse(r.stdout), 'the worst document is still a document').not.toThrow();
    expect(bytes, `the largest document is ${bytes} bytes`).toBeLessThanOrEqual(NODE_FILE_CAP_BYTES);
    expect(bytes, 'the worst case really was built: a quote why is cut to 240 and escapes to about 480 bytes a row').toBeGreaterThan(30_000);
    console.log(`V7 largest document: ${bytes} bytes of ${NODE_FILE_CAP_BYTES}`);
  });
});

describe('ccrc settings: the release base shows its scheme and host, nothing else', () => {
  const SECRETS = ['secret', 'token', 'u:p', '/r', 'user', 'tok@'];
  it.each([
    ['https://user:secret@mirror.example.invalid/r/x?token=abc', 'custom https://mirror.example.invalid'],
    // D-7923 (operator item 41): a base whose raw text has no http(s) scheme shows `custom` alone; it read `custom mirror.example.invalid` before.
    ['user:secret@mirror.example.invalid/r?token=x', 'custom'],
    ['https://u:p@x@mirror.example.invalid/r', 'custom https://mirror.example.invalid'],
    // D-7873: `tok@mirror.example.invalid` read `custom mirror.example.invalid` before; `_upd_redact` leaves a token-only userinfo before
    // a bare host (its KNOWN LIMIT), the `@` stays, and the row now records `custom` alone.
    ['tok@mirror.example.invalid', 'custom'],
    ['tok@mirror.example.invalid:8080/r', 'custom'],   // D-7923: read `custom mirror.example.invalid:8080` before
    ['https://tok@mirror.example.invalid/r', 'custom https://mirror.example.invalid'],
  ])('%s shows as %s', (url, shown) => {
    const home = boxWith('ccrc-sv-url-');
    const sf = surfaces(home, { CCRC_RELEASE_BASE_URL: url });
    const row = rowOf(docOf(sf.json), 'CCRC_RELEASE_BASE_URL');
    expect(row).toEqual({ key: 'CCRC_RELEASE_BASE_URL', state: 'ok', value: shown, from: 'environment' });
    expectAbsent(sf, SECRETS, 'release base');
  });

  it('a port stays, a value from ccrc.env is custom too, an empty line and the default read default', () => {
    expect(rowOf(json(boxWith('ccrc-sv-url2-'), { CCRC_RELEASE_BASE_URL: 'http://mirror.example.invalid:8080/a' }), 'CCRC_RELEASE_BASE_URL').value)
      .toBe('custom http://mirror.example.invalid:8080');
    expect(rowOf(json(boxWith('ccrc-sv-url3-', 'CCRC_RELEASE_BASE_URL=https://m.example.invalid/x\n')), 'CCRC_RELEASE_BASE_URL'))
      .toEqual({ key: 'CCRC_RELEASE_BASE_URL', state: 'ok', value: 'custom https://m.example.invalid', from: 'file' });
    expect(rowOf(json(boxWith('ccrc-sv-url4-', 'CCRC_RELEASE_BASE_URL=\n')), 'CCRC_RELEASE_BASE_URL'))
      .toEqual({ key: 'CCRC_RELEASE_BASE_URL', state: 'ok', value: 'default', from: 'empty' });
  });
});

describe('ccrc settings: a release base with no http(s) scheme shows custom alone (D-7923, operator item 41)', () => {
  // Review 1496 F1: the last three put userinfo before a scheme; only the verb's gate on the raw value keeps them at `custom`.
  const PLANTS = ['zz-leak-tok-0123456789abcdef', 'mirror.example.invalid/r', 'user:pw@mirror.example.invalid/r',
    'tok@https://mirror.example.invalid', 'u:pw@https://mirror.example.invalid/r', 'u@HTTPS://mirror.example.invalid'];
  it.each(PLANTS)('%s reads exactly `custom`, and its text is on no surface', (url) => {
    const home = boxWith('ccrc-sv-url-noscheme-');
    const sf = surfaces(home, { CCRC_RELEASE_BASE_URL: url });
    expect(rowOf(docOf(sf.json), 'CCRC_RELEASE_BASE_URL')).toEqual({ key: 'CCRC_RELEASE_BASE_URL', state: 'ok', value: 'custom', from: 'environment' });
    expect(sf.human.stdout).toMatch(/^CCRC_RELEASE_BASE_URL {10}custom {2}\(/m);
    expectAbsent(sf, ['zz-leak', 'mirror.example', 'user:pw', 'tok@', 'u@HTTPS'], 'release base');
  });
  it('CONTROL: a scheme-ful value keeps its scheme and host', () => {
    expect(rowOf(json(boxWith('ccrc-sv-url-scheme-'), { CCRC_RELEASE_BASE_URL: 'https://mirror.example.invalid:8443/r' }), 'CCRC_RELEASE_BASE_URL'))
      .toEqual({ key: 'CCRC_RELEASE_BASE_URL', state: 'ok', value: 'custom https://mirror.example.invalid:8443', from: 'environment' });
  });
});

describe('ccrc settings: _upd_url_origin', () => {
  const origin = (u: string): string => {
    const home = boxWith('ccrc-sv-origin-');
    const r = spawnSync(BASH, ['-c', '. "$1"; _upd_url_origin "$2"', 'x', CCRC, u], { env: envOf(home), encoding: 'utf8' });
    return r.stdout;
  };
  it.each([
    ['https://h/p?q#f', 'https://h'], ['https://h?q', 'https://h'], ['https://h#f', 'https://h'], ['h/p', 'h'],
    ['https://user:secret@mirror.example.invalid/r/x?token=abc', 'https://mirror.example.invalid'],
    ['user:secret@mirror.example.invalid/r?token=x', 'mirror.example.invalid'],
    ['https://u:p@x@mirror.example.invalid/r', 'https://mirror.example.invalid'],
    ['http://h:8080/a', 'http://h:8080'], ['', ''],
    // D-7873: an `@` left after `_upd_redact` and the scheme prints nothing (rc 1): see the next describe.
    ['tok@mirror.example.invalid', ''], ['tok@mirror.example.invalid:8080/r', 'mirror.example.invalid:8080'],
    ['https://tok@mirror.example.invalid/r', 'https://mirror.example.invalid'],
    ['https://deploy:s3cr/et@mirror.example.invalid/r', ''], ['https://u:p@[::1]:8080/x?y=z@w#f', ''],
    ['https://[::1]:8080/x?y=z#f', 'https://[::1]:8080'], ['http://[2001:db8::1]:9/p', 'http://[2001:db8::1]:9'],
  ])('%s is %s', (u, want) => { expect(origin(u)).toBe(want); });

  it('answers rc 1 and prints nothing when an @ is left after the redaction and the scheme (D-7873), rc 0 otherwise', () => {
    const home = boxWith('ccrc-sv-origin-rc-');
    const rc = (u: string): { code: number | null; out: string } => {
      const r = spawnSync(BASH, ['-c', '. "$1"; _upd_url_origin "$2"', 'x', CCRC, u], { env: envOf(home), encoding: 'utf8' });
      return { code: r.status, out: r.stdout };
    };
    for (const u of ['tok/abc@m', 'https://deploy:s3cr/et@mirror.example.invalid/r', 'https://u:pw@host:99/p@q']) expect(rc(u), u).toEqual({ code: 1, out: '' });
    // Review 1396 F1: whitespace, or another byte `_upd_redact` starts a token at, in the RAW value: rc 1, nothing printed. Before the
    // fix the first three printed `https://u:p h`, `https://u:p<TAB>h` and `https://user h`.
    for (const u of ['https://u:p w@h/r', 'https://u:p\tw@h/r', 'https://user name:pw@h/r', 'https://u:p\nw@h/r', 'https://u:p"w@h/r',
      "https://u:p'w@h/r", 'https://u:p<w@h/r', 'https://u:p(w@h/r', 'https://u:p`w@h/r', 'https://h/r x']) expect(rc(u), JSON.stringify(u)).toEqual({ code: 1, out: '' });
    // Review 1398 F1: a '/', a '\' or a '=' in the raw value between the scheme's `://` (or the start) and the last '@', and any scheme
    // but http(s): rc 1, nothing printed. Before the fix the first two printed `https://deploy:` and `https://deploy:ab:`, the
    // `=` form `user=mirror.example.invalid` and the `//` form `deploy://mirror.example.invalid`.
    for (const u of ['https://deploy:/s3cret@mirror.example.invalid/r', 'https://deploy:ab:/cd@mirror.example.invalid/r',
      'https://deploy:\\/s3cret@mirror.example.invalid/r', 'deploy:/s3cret@mirror.example.invalid/r', 'deploy:\\s3cret@mirror.example.invalid/r',
      'user=x:pw@mirror.example.invalid/r', 'deploy://s3cret@mirror.example.invalid/r', 'ftp://mirror.example.invalid/r',
      // Review 1403 F1: a scheme AFTER a userinfo is not http(s) either; before the fix the first two printed `ftp://h`.
      'user:pw@ftp://h/r', 'tok@ftp://h', 'user:pw@ftp://mirror.example.invalid/r', 'tok@ftp://mirror.example.invalid']) {
      expect(rc(u), JSON.stringify(u)).toEqual({ code: 1, out: '' });
    }
    // An ordinary userinfo keeps its host, a value with no '@' is untouched, and the scheme's case is kept.
    expect(rc('https://user:secret@mirror.example.invalid/r')).toEqual({ code: 0, out: 'https://mirror.example.invalid' });
    expect(rc('user:pw@https://mirror.example.invalid/r')).toEqual({ code: 0, out: 'https://mirror.example.invalid' });
    expect(rc('HTTPS://mirror.example.invalid/r/x')).toEqual({ code: 0, out: 'HTTPS://mirror.example.invalid' });
    for (const u of ['https://h/p', 'h/p', 'http://h:8080/a']) expect(rc(u).code, u).toBe(0);
  });
});

describe('ccrc settings: a release base whose userinfo survives the redaction records `custom` alone (D-7873, review 1385 F1)', () => {
  // `_upd_redact` leaves a userinfo that holds a raw '/', '?' or '#' whole (its KNOWN LIMITS), and the old projection cut the authority
  // at the first '/', '?' or '#' BEFORE it looked for the '@', so a prefix of the credential came out. Now an '@' left anywhere after
  // the redaction and the scheme means the host cannot be told from the credential: no host is recorded.
  const FORBIDDEN = ['deploy', 's3cr', 'pw', 'tok', 'u:'];
  it.each([
    'https://deploy:s3cr/et@mirror.example.invalid/r',
    'https://deploy:pw?x@m.example/r',
    'tok/abc@m',
    'https://u:pw@host:99/p@q',
    'https://u:p@[::1]:8080/x?y=z@w#f',
    // Review 1396 F1: a userinfo that holds whitespace; the real verb recorded `custom https://deploy:pa mirror.example.invalid`.
    'https://deploy:pa ss@mirror.example.invalid/r',
    'https://deploy:pa\tss@mirror.example.invalid/r',
    'https://deploy name:pw@mirror.example.invalid/r',
    // Review 1398 F1: a '/' inside the password; the real verb recorded `custom https://deploy:` and `custom https://deploy:ab:`.
    'https://deploy:/s3cret@mirror.example.invalid/r',
    'https://deploy:ab:/cd@mirror.example.invalid/r',
    'deploy://s3cret@mirror.example.invalid/r',
    // Review 1403 F1: a scheme after a userinfo; the real verb recorded `custom ftp://mirror.example.invalid`.
    'user:pw@ftp://mirror.example.invalid/r',
    'tok@ftp://mirror.example.invalid',
  ])('%s reads exactly `custom`, in the JSON, the file and the human form', (url) => {
    const home = boxWith('ccrc-sv-url-at-');
    const sf = surfaces(home, { CCRC_RELEASE_BASE_URL: url });
    expect(rowOf(docOf(sf.json), 'CCRC_RELEASE_BASE_URL')).toEqual({ key: 'CCRC_RELEASE_BASE_URL', state: 'ok', value: 'custom', from: 'environment' });
    expect(sf.human.stdout).toMatch(/^CCRC_RELEASE_BASE_URL {10}custom {2}\(/m);
    expectAbsent(sf, FORBIDDEN, 'release base');
  });
});

describe('ccrc settings: the backups and the disk', () => {
  it('two timestamped dirs (one holding coord.db) and a hand-made sibling read kept 2, withData 1', () => {
    const home = boxWith('ccrc-sv-bak-');
    const root = join(home, 'ccrc-backups');
    mkdirSync(join(root, '20250101-000000'), { recursive: true });
    mkdirSync(join(root, '20250102-000000'), { recursive: true });
    mkdirSync(join(root, 'pre-x'), { recursive: true });
    writeFileSync(join(root, '20250101-000000', 'coord.db'), 'x'.repeat(4096));
    writeFileSync(join(root, 'pre-x', 'coord.db'), 'y');
    const b = json(home).backups;
    expect(b.state).toBe('ok');
    expect(b.kept).toBe(2);
    expect(b.withData).toBe(1);
    expect(b.bytes).toBeGreaterThanOrEqual(4096);
    expect(Number.isSafeInteger(b.bytes)).toBe(true);
  });

  it('a timestamp-named symlink is not a backup, and a coord.db that is a link does not count as data', () => {
    const home = boxWith('ccrc-sv-bak2-');
    const root = join(home, 'ccrc-backups');
    mkdirSync(join(root, '20250101-000000'), { recursive: true });
    writeFileSync(join(root, 'real.db'), 'x');
    spawnSync('ln', ['-s', join(root, 'real.db'), join(root, '20250101-000000', 'coord.db')]);
    spawnSync('ln', ['-s', join(root, '20250101-000000'), join(root, '20250102-000000')]);
    const b = json(home).backups;
    expect(b).toMatchObject({ state: 'ok', kept: 1, withData: 0 });
  });

  it('no ~/ccrc-backups at all is ok with 0, 0, 0', () => {
    expect(json(boxWith('ccrc-sv-bak3-')).backups).toEqual({ state: 'ok', kept: 0, withData: 0, bytes: 0 });
  });

  it('a ~/ccrc-backups that is a file reads unmeasured, naming it, never 0', () => {
    const home = boxWith('ccrc-sv-bak4-');
    writeFileSync(join(home, 'ccrc-backups'), 'not a directory');
    const b = json(home).backups;
    expect(b).toEqual({ state: 'unmeasured', why: '~/ccrc-backups is not a readable directory' });
  });

  it('a directory that cannot be searched reads unmeasured', () => {
    if (process.getuid?.() === 0) return;
    const home = boxWith('ccrc-sv-bak5-');
    mkdirSync(join(home, 'ccrc-backups', '20250101-000000'), { recursive: true });
    chmodSync(join(home, 'ccrc-backups'), 0o000);
    try { expect(json(home).backups.state).toBe('unmeasured'); } finally { chmodSync(join(home, 'ccrc-backups'), 0o700); }
  });

  it('a du that fails reads the backups unmeasured; a df that fails reads the disk unmeasured (through stubFn)', () => {
    const home = boxWith('ccrc-sv-du-');
    mkdirSync(join(home, 'ccrc-backups', '20250101-000000'), { recursive: true });
    const run = (stubs: string): Doc => {
      const r = spawnSync(BASH, ['-c', `. "$1"; ${stubs} cmd_settings --json`, 'x', CCRC], { env: envOf(home), encoding: 'utf8' });
      return docOf({ code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' });
    };
    const d = run(`${stubFn('_set_du', 'return 1')} ${stubFn('_set_df', 'return 1')}`);
    expect(d.backups.state).toBe('unmeasured');
    expect(d.backups.why).toBe('~/ccrc-backups could not be measured (du did not answer in time, or failed)');
    expect(d.disk.state).toBe('unmeasured');
    expect(d.disk.why).toContain('could not be measured');
    // The controls: the same call without the stubs measures both.
    const ok = run('true;');
    expect(ok.backups.state).toBe('ok');
    expect(ok.disk.state).toBe('ok');
  });

  it.each([['12 digits stay a safe integer', '999999999999', true], ['13 digits are refused: the conservative bound, though this sample is below 2^53', '8790000000000', false]])(
    'a df reporting %s', (_w, blocks, ok) => {
      const home = boxWith('ccrc-sv-df-');
      const stubs = stubDir(home, { df: `#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/fixture ${blocks} 1 ${blocks} 1%% /\\n"\n` });
      const d = docOf(settings(home, ['--json'], {}, stubs)).disk;
      if (ok) {
        expect(d.state).toBe('ok');
        expect(d.sizeBytes).toBe(Number(blocks) * 1024);
        expect(Number.isSafeInteger(d.sizeBytes)).toBe(true);
      } else {
        expect(d.state).toBe('unmeasured');
      }
    });

  it('the disk is non-negative safe integers, available no more than the size', () => {
    const d = json(boxWith('ccrc-sv-disk-')).disk;
    expect(d.state).toBe('ok');
    for (const n of [d.availBytes, d.sizeBytes]) {
      expect(Number.isSafeInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
    expect(d.availBytes!).toBeLessThanOrEqual(d.sizeBytes!);
  });

  it('a df and a du that answer are read as the bytes they print (stubbed by PATH)', () => {
    const home = boxWith('ccrc-sv-stub-');
    mkdirSync(join(home, 'ccrc-backups'), { recursive: true });
    const stubs = stubDir(home, {
      df: '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/fixture 1000 400 600 40%% /\\n"\n',
      du: '#!/bin/sh\nprintf "12345\\t%s\\n" "$3"\n',
    });
    const d = docOf(settings(home, ['--json'], {}, stubs));
    expect(d.disk).toEqual({ state: 'ok', availBytes: 600 * 1024, sizeBytes: 1000 * 1024 });
    // macOS's `_plat_bytes` sizes with find, never du, so the du stub is not asked there and the empty directory is 0 bytes.
    expect(d.backups).toEqual({ state: 'ok', kept: 0, withData: 0, bytes: process.platform === 'darwin' ? 0 : 12345 });
    expect(d.at).toBe(NOW);
  });
});

describe('ccrc settings: a symlinked ~/ccrc-backups measures its target (A5)', () => {
  it('sizes the directory the link names, not the link: the path du receives resolves into the target (stubbed by PATH)', () => {
    const home = boxWith('ccrc-sv-link-');
    const target = join(home, 'elsewhere');
    mkdirSync(join(target, '20250101-000000'), { recursive: true });
    writeFileSync(join(target, '20250101-000000', 'coord.db'), 'x'.repeat(100_000));
    spawnSync('ln', ['-s', target, join(home, 'ccrc-backups')]);
    // The stub reports what the REAL du would: the link's own size (a few bytes) for a path that does not follow it, the target's for
    // one that does. `du -sb <link>` measured 163 against 100000 in review 1385; a trailing slash is what makes it follow.
    const stubs = stubDir(home, {
      du: '#!/bin/sh\nfor a in "$@"; do p="$a"; done\nif [ -L "$p" ]; then echo "163\t$p"; else echo "100000\t$p"; fi\n',
    });
    const b = docOf(settings(home, ['--json'], {}, stubs)).backups;
    expect(b).toEqual({ state: 'ok', kept: 1, withData: 1, bytes: 100000 });
  });

  it('measures real bytes of the target through a link (the real du)', () => {
    const home = boxWith('ccrc-sv-link2-');
    const target = join(home, 'elsewhere');
    mkdirSync(join(target, '20250101-000000'), { recursive: true });
    writeFileSync(join(target, '20250101-000000', 'coord.db'), 'x'.repeat(100_000));
    spawnSync('ln', ['-s', target, join(home, 'ccrc-backups')]);
    const b = json(home).backups;
    expect(b.state).toBe('ok');
    expect(b.bytes).toBeGreaterThanOrEqual(100_000);
  });
});

describe('ccrc settings: a symlinked ~/ccrc-backups, the macOS arm of _plat_bytes (A5)', () => {
  it('the find-based arm follows the link through the trailing slash too (GNU find stands in for the platform\'s here)', () => {
    const home = boxWith('ccrc-sv-link3-');
    const target = join(home, 'elsewhere');
    mkdirSync(join(target, '20250101-000000'), { recursive: true });
    writeFileSync(join(target, '20250101-000000', 'coord.db'), 'x'.repeat(100_000));
    spawnSync('ln', ['-s', target, join(home, 'ccrc-backups')]);
    // OSTYPE is read when the file is sourced: `darwin` selects `_plat_bytes`' find and awk arm.
    const r = spawnSync(BASH, ['-c', 'OSTYPE=darwin21; . "$1"; [ "$CCD_OS" = darwin ] || exit 9; cmd_settings --json', 'x', CCRC], { env: envOf(home), encoding: 'utf8' });
    const b = docOf({ code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }).backups;
    expect(b.state).toBe('ok');
    expect(b.bytes).toBeGreaterThanOrEqual(100_000);
  });
});

describe('ccrc settings: usage', () => {
  it.each([['--bogus', '--bogus'], ['bogus', 'bogus']])('%s is a usage error: exit 2 and ccrc: unknown argument on stderr', (arg, shown) => {
    const r = settings(boxWith('ccrc-sv-usage-'), [arg]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`ccrc: unknown argument: ${shown}\n`);
    expect(r.stderr).toMatch(/usage: ccrc \{/);
    expect(r.stdout).toBe('');
  });

  it.each([[['--from', 'shell'], 'shell'], [['--from', 'timers'], 'timers'], [['--from'], '--from']])('%j is a usage error naming %s', (args, shown) => {
    const home = boxWith('ccrc-sv-from-');
    const r = settings(home, args);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`ccrc: unknown argument: ${shown}\n`);
    expect(existsSync(join(home, '.ccrc', 'box-settings.json'))).toBe(false);
  });

  it.each([['-h'], ['--help']])('%s prints usage on stdout at exit 0, and names the verb', (flag) => {
    const r = settings(boxWith('ccrc-sv-help-'), [flag]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/usage: ccrc \{[^}]*\|settings\|/);
    expect(r.stdout).toMatch(/^ {2}settings {2}print what each setting a fleet or server node reads resolves to$/m);
  });
});

describe('ccrc settings: an is-set row (the spec\'s presence, D12) records whether a setting is set, never what it is set to (D-7910, V3)', () => {
  it('V3: a URL, a key path, a prompt and an empty list read set, set, set and set to empty, and none of their text is anywhere', () => {
    const needles = ['secret-host', 'token=abc', 'invalid:9000', 'push.key', 'say hi', 'say-hi'];
    const check = (text: string): void => {
      const s = surfaces(boxWith('ccrc-sv-v3-', text));
      const d = docOf(s.json);
      expect(rowOf(d, 'CCRC_TESTBOX_URL')).toEqual({ key: 'CCRC_TESTBOX_URL', state: 'ok', from: 'file' });
      expect(rowOf(d, 'CCRC_TESTBOX_GIT_KEY')).toEqual({ key: 'CCRC_TESTBOX_GIT_KEY', state: 'ok', from: 'file' });
      expect(rowOf(d, 'CCRC_KEEPALIVE_PROMPT')).toEqual({ key: 'CCRC_KEEPALIVE_PROMPT', state: 'ok', from: 'file' });
      expect(rowOf(d, 'CCRC_GRAPH_REPOS_EXCLUDE')).toEqual({ key: 'CCRC_GRAPH_REPOS_EXCLUDE', state: 'ok', from: 'empty' });
      expectAbsent(s, needles, 'V3');
    };
    const spaced = 'CCRC_TESTBOX_URL=https://secret-host.invalid:9000/x?token=abc\nCCRC_TESTBOX_GIT_KEY=~/k/push.key\nCCRC_KEEPALIVE_PROMPT=say hi\nCCRC_GRAPH_REPOS_EXCLUDE=\n';
    if (!MAC) { check(spaced); return; }
    // macOS: a `?`, a `~` and a space are not plain lines, so the four named keys read unmeasured (launchd sentence); the
    // is-set shapes are then measured on a plain file.
    const s = surfaces(boxWith('ccrc-sv-v3m-', spaced));
    const d = docOf(s.json);
    for (const k of ['CCRC_TESTBOX_URL', 'CCRC_TESTBOX_GIT_KEY', 'CCRC_KEEPALIVE_PROMPT', 'CCRC_GRAPH_REPOS_EXCLUDE']) {
      expect(rowOf(d, k), k).toEqual({ key: k, state: 'unmeasured', why: expect.stringMatching(LAUNCHD(k)) });
    }
    expectAbsent(s, needles, 'V3 spaced');
    check('CCRC_TESTBOX_URL=https://secret-host.invalid:9000/x\nCCRC_TESTBOX_GIT_KEY=/k/push.key\nCCRC_KEEPALIVE_PROMPT=say-hi\nCCRC_GRAPH_REPOS_EXCLUDE=\n');
  });
});


describe('ccrc settings: the human form keeps its three formats (V8, review F4)', () => {
  const lineOf = (out: string, key: string): string => out.split('\n').find((l) => l.startsWith(`${key} `)) ?? '';
  it('V8: ok, refused and unmeasured rows keep their formats; is-set rows say set, unset or set to empty; a refused row says not shown', () => {
    const home = boxWith('ccrc-sv-words-', 'CCRC_BACKUP_DATA_KEEP=4\nCCRC_VERSIONS_KEEP=\nCCRC_UPDATE_DEADLINE_MS=6e5\nCCRC_MODELS_ADVANCE_BUDGET_S=off\n'
      + 'CCRC_TESTBOX_URL=https://secret-host.invalid\nCCRC_GRAPH_REPOS_EXCLUDE=\nCCRC_GRAPH_BUDGET=zz\n');
    const human = settings(home, [], { CCRC_BACKUP_KEEP: '5', CCRC_UPDATE_HEALTH_S: 'ninety' });
    const out = human.stdout;
    expect(human.stderr, 'the planted URL and value are not on stderr either').not.toMatch(/secret-host|ninety/);
    expect(lineOf(out, 'CCRC_BACKUP_KEEP')).toBe(`${'CCRC_BACKUP_KEEP'.padEnd(30)} 5  (environment, ok)`);
    expect(lineOf(out, 'CCRC_BACKUP_DATA_KEEP')).toBe(`${'CCRC_BACKUP_DATA_KEEP'.padEnd(30)} 4  (ccrc.env, ok)`);
    expect(lineOf(out, 'CCRC_VERSIONS_KEEP')).toBe(`${'CCRC_VERSIONS_KEEP'.padEnd(30)} 3  (ccrc.env (empty line), ok)`);
    expect(lineOf(out, 'CCRC_RELEASE_BASE_URL')).toBe(`${'CCRC_RELEASE_BASE_URL'.padEnd(30)} default  (default, ok)`);
    expect(lineOf(out, 'CCRC_UPDATE_HEALTH_S')).toBe(`${'CCRC_UPDATE_HEALTH_S'.padEnd(30)} not shown  (environment, refused): a number of seconds (digits only, at most 18)`);
    expect(lineOf(out, 'CCRC_TESTBOX_URL')).toBe(`${'CCRC_TESTBOX_URL'.padEnd(30)} set  (ccrc.env, ok)`);
    expect(lineOf(out, 'CCRC_GRAPH_REPOS_EXCLUDE')).toBe(`${'CCRC_GRAPH_REPOS_EXCLUDE'.padEnd(30)} set to empty  (ccrc.env (empty line), ok)`);
    expect(lineOf(out, 'CCRC_KEEPALIVE_PROMPT')).toBe(`${'CCRC_KEEPALIVE_PROMPT'.padEnd(30)} unset  (default, ok)`);
    expect(lineOf(out, 'CCRC_GRAPH_BUDGET')).toBe(`${'CCRC_GRAPH_BUDGET'.padEnd(30)} not shown  (ccrc.env, refused): a whole number, 1 or more; takes effect at the next ccrc update`);
    // A row whose `applies` is update ends with the note, one whose `applies` is run does not.
    expect(lineOf(out, 'CCRC_GRAPH_KEEP_BUILDS').endsWith('(default, ok)')).toBe(true);
    expect(lineOf(settings(boxWith('ccrc-sv-words2-'), [], {}).stdout, 'CCRC_GRAPH_BUDGET')).toBe(`${'CCRC_GRAPH_BUDGET'.padEnd(30)} 4  (default, ok); takes effect at the next ccrc update`);
    // A key longer than 30 characters prints with the format's one literal space and no padding.
    expect(out).toMatch(/^CCRC_GRAPH_INCREMENTAL_MAX_FILES 0 {2}\(default, ok\)$/m);
    // Wave 1's rows keep their exact spacing.
    expect(lineOf(out, 'CCRC_UPDATE_DEADLINE_MS')).toMatch(/^CCRC_UPDATE_DEADLINE_MS {8}not shown {2}\(ccrc\.env, refused\): /);
    expect(out).not.toContain('secret-host');
    // The JSON keeps its four tokens.
    const d = json(home, { CCRC_BACKUP_KEEP: '5' });
    expect([rowOf(d, 'CCRC_BACKUP_KEEP').from, rowOf(d, 'CCRC_BACKUP_DATA_KEEP').from, rowOf(d, 'CCRC_VERSIONS_KEEP').from, rowOf(d, 'CCRC_RELEASE_BASE_URL').from])
      .toEqual(['environment', 'file', 'empty', 'default']);
  });

  it('prints one line per shown setting in order, then the deadline, backups and disk lines, and writes nothing', () => {
    const home = boxWith('ccrc-sv-human-');
    const r = settings(home, [], { CCRC_BACKUP_KEEP: 'abc', CCRC_UPDATE_HEALTH_S: '120' });
    expect(r.code, r.stderr).toBe(0);
    const lines = r.stdout.split('\n').filter(Boolean);
    expect(lines.slice(0, 70).map((l) => l.split(/\s+/)[0])).toEqual([...BOX_SETTINGS_SHOWN]);
    expect(lines[0]).toBe('CCRC_BACKUP_KEEP               not shown  (environment, refused): a whole number from 0 to 9999');
    expect(lines[3]).toBe('CCRC_UPDATE_HEALTH_S           120  (environment, ok)');
    expect(lines[70]).toBe('deadline: plain 900000 ms, min 900000 ms, max 900000 ms');
    expect(lines[71]).toMatch(/^backups: /);
    expect(lines[72]).toMatch(/^disk: /);
    expect(existsSync(join(home, '.ccrc', 'box-settings.json')), 'the human form writes nothing').toBe(false);
  });
});

describe('ccrc settings --write: the file', () => {
  const file = (home: string): string => join(home, '.ccrc', 'box-settings.json');
  const tmps = (home: string): string[] => readdirSync(join(home, '.ccrc')).filter((f) => f.startsWith('box-settings.json.tmp.'));

  it('writes mode 0600 and the bytes --json prints, and prints nothing', () => {
    const home = boxWith('ccrc-sv-w1-');
    // `df` is stubbed: a live filesystem's free space moves between two runs, and this row compares their bytes.
    const stubs = stubDir(home, { df: '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/fixture 1000 400 600 40%% /\\n"\n' });
    const w = settings(home, ['--write'], {}, stubs);
    expect(w).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(statSync(file(home)).mode & 0o777).toBe(0o600);
    const j = settings(home, ['--json'], {}, stubs);
    expect(readFileSync(file(home), 'utf8')).toBe(j.stdout);
    const both = settings(home, ['--write', '--json'], {}, stubs);
    expect(both.stdout).toBe(j.stdout);
    expect(tmps(home)).toEqual([]);
  });

  it('creates ~/.ccrc when it is missing', () => {
    const home = mkTmp('ccrc-sv-w2-');
    expect(settings(home, ['--write']).code).toBe(0);
    expect(existsSync(file(home))).toBe(true);
  });

  it('writes nothing else under ~/.ccrc, and replaces a prior file whole', () => {
    const home = boxWith('ccrc-sv-w3-', 'CCRC_ROLE=both\n');
    writeFileSync(join(home, '.ccrc', 'update.json'), '{"phase":"done"}\n');
    writeFileSync(file(home), 'OLD');
    const before = ccrcState(home);
    expect(settings(home, ['--write']).code).toBe(0);
    const after = ccrcState(home);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const [f, sum] of Object.entries(before)) if (f !== 'box-settings.json') expect(after[f], f).toBe(sum);
    expect(after['box-settings.json']).not.toBe(before['box-settings.json']);
    expect(JSON.parse(readFileSync(file(home), 'utf8')).v).toBe(2);
  });

  it('records reader "timer" only with --from timer', () => {
    const home = boxWith('ccrc-sv-w4-');
    expect(json(home).reader).toBe('shell');
    expect(json(home, {}, ['--from', 'timer']).reader).toBe('timer');
    expect(settings(home, ['--write', '--from', 'timer']).code).toBe(0);
    expect((JSON.parse(readFileSync(file(home), 'utf8')) as Doc).reader).toBe('timer');
    expect(settings(home, ['--write']).code).toBe(0);
    expect((JSON.parse(readFileSync(file(home), 'utf8')) as Doc).reader).toBe('shell');
  });

  it('a write that fails leaves no temp file and keeps the last good file', () => {
    const home = boxWith('ccrc-sv-w5-');
    writeFileSync(file(home), 'LAST-GOOD');
    // `mv` fails after the temp file is complete: the arm that must remove it.
    const stubs = stubDir(home, { mv: '#!/bin/sh\nexit 1\n' });
    const r = settings(home, ['--write'], {}, stubs);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ccrc: settings: could not write ~/.ccrc/box-settings.json');
    expect(r.stderr).not.toContain(home);
    expect(tmps(home)).toEqual([]);
    expect(readFileSync(file(home), 'utf8')).toBe('LAST-GOOD');
    // A chmod that fails: the same arm, one step earlier.
    const stubs2 = stubDir(boxWith('ccrc-sv-w5b-'), { chmod: '#!/bin/sh\nexit 1\n' });
    const home2 = boxWith('ccrc-sv-w5c-');
    writeFileSync(file(home2), 'LAST-GOOD');
    expect(settings(home2, ['--write'], {}, stubs2).code).toBe(1);
    expect(tmps(home2)).toEqual([]);
    expect(readFileSync(file(home2), 'utf8')).toBe('LAST-GOOD');
  });

  it('a directory at the name is refused, not moved into', () => {
    const home = boxWith('ccrc-sv-w6-');
    mkdirSync(file(home));
    const r = settings(home, ['--write']);
    expect(r.code).toBe(1);
    expect(readdirSync(file(home))).toEqual([]);
    expect(tmps(home)).toEqual([]);
  });

  it('a die after the temp file exists leaves no temp file (the EXIT chain)', () => {
    const home = boxWith('ccrc-sv-w7-');
    writeFileSync(file(home), 'LAST-GOOD');
    // Sourced, with the final step replaced (through stubFn) by a die: the temp file is complete by then.
    const r = spawnSync(BASH, ['-c', `. "$1"; ${stubFn('_ccrc_die', 'echo "$PROG: $*" >&2; exit 1')} `
      + 'mv() { _ccrc_die "interrupted"; }; cmd_settings --write', 'x', CCRC], { env: envOf(home), encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(tmps(home)).toEqual([]);
    expect(readFileSync(file(home), 'utf8')).toBe('LAST-GOOD');
  });

  // The two SIGTERM rows are ordered by a handshake the test controls, never a sleep (fix round 1b): the stubbed step marks
  // `$HOME/hs/<name>-ready` once the temp file stands, then waits for `$HOME/hs/release`, which the test writes only after the
  // signal is sent; `<name>-done` says the step (orphaned or not) has finished. The `mv` may finish after the EXIT chain has run (the
  // chain runs on the signal and the step it was waiting on can outlive it), and nothing here depends on how long anything takes. A
  // stub acts only on the temp file and is the real command otherwise. D-7875 records what is promised. What each row guards (review
  // 1396 F7): the chmod row guards the EXIT chain (with `_tmp_guard` gone its temp file stays); the rename row pins only "no temp
  // file, never partial", because a rename that finishes consumes the temp file itself, so it stays green without the chain.
  const gated = (name: string): string => `#!/bin/sh\ncase "$*" in *box-settings.json.tmp.*) ;; *) exec ${REAL(name)} "$@" ;; esac\n`
    + `: > "$HOME/hs/${name}-ready"\ni=0\nwhile [ ! -e "$HOME/hs/release" ] && [ "$i" -lt 600 ]; do sleep 0.05; i=$((i + 1)); done\n`
    + `${REAL(name)} "$@"; rc=$?\n: > "$HOME/hs/${name}-done"\nexit "$rc"\n`;
  const until = async (p: string): Promise<boolean> => {
    const deadline = Date.now() + 30_000;
    while (!existsSync(p) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    return existsSync(p);
  };
  async function termDuring(name: 'chmod' | 'mv'): Promise<string> {
    const home = boxWith(`ccrc-sv-w8${name}-`);
    mkdirSync(join(home, 'hs'));
    writeFileSync(file(home), 'LAST-GOOD');
    const stubs = stubDir(home, { [name]: gated(name) });
    const child = spawn(BASH, [CCRC, 'settings', '--write'], { env: envOf(home, {}, stubs), stdio: 'ignore', detached: true });
    children.push(child);
    const closed = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => { child.on('close', (c, s) => resolve([c, s])); });
    expect(await until(join(home, 'hs', `${name}-ready`)), `the stubbed ${name} was reached`).toBe(true);
    expect(tmps(home), 'the temp file stood while the write was in flight').toHaveLength(1);
    child.kill('SIGTERM');
    writeFileSync(join(home, 'hs', 'release'), '');
    await closed;
    expect(await until(join(home, 'hs', `${name}-done`)), `the stubbed ${name} finished`).toBe(true);
    expect(tmps(home), 'no temp file stays').toEqual([]);
    return readFileSync(file(home), 'utf8');
  }

  it('SIGTERM before the rename runs the EXIT chain: no temp file stays, the last good file is kept', async () => {
    expect(await termDuring('chmod')).toBe('LAST-GOOD');
  }, 60_000);

  it('SIGTERM during the rename: no temp file stays, and the file is the last good one or the whole new one, never partial', async () => {
    const got = await termDuring('mv');
    if (got !== 'LAST-GOOD') {
      const doc = JSON.parse(got) as { v: number; settings: unknown[] };
      expect(doc.v).toBe(2);
      expect(doc.settings).toHaveLength(70);
    }
  }, 60_000);
});

describe.skipIf(FLOCK === '')('ccrc settings is read-only', () => {
  it('a held update.lock does not stop it, and it neither takes the lock nor changes a backup', async () => {
    const home = boxWith('ccrc-sv-ro-');
    const root = join(home, 'ccrc-backups');
    mkdirSync(join(root, '20250101-000000'), { recursive: true });
    writeFileSync(join(root, '20250101-000000', 'coord.db'), 'x');
    const lock = join(home, '.ccrc', 'update.lock');
    const holder = spawn(FLOCK, ['-x', lock, 'sleep', '30'], { stdio: 'ignore', detached: true });
    children.push(holder);
    const deadline = Date.now() + 10_000;
    const free = (): boolean => spawnSync(FLOCK, ['-n', lock, 'true']).status === 0;
    while (free() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(free(), 'the lock is held').toBe(false);
    const before = JSON.stringify(readdirSync(root, { recursive: true }));
    const lockBefore = readFileSync(lock, 'utf8');
    const r = settings(home, ['--json', '--write']);
    expect(docOf(r).backups).toMatchObject({ state: 'ok', kept: 1, withData: 1 });
    expect(JSON.stringify(readdirSync(root, { recursive: true }))).toBe(before);
    expect(readFileSync(lock, 'utf8')).toBe(lockBefore);
    expect(free(), 'still held by its holder alone').toBe(false);
  }, 30_000);

  it('the withData count is read only where the backups object is emitted, so no decision path can borrow it', () => {
    const body = /^cmd_settings\(\) \{[\s\S]*?\n\}$/m.exec(SRC)?.[0] ?? '';
    const lines = body.split('\n').filter((l) => !/^\s*#/.test(l));
    const uses = lines.filter((l) => /\bbd\b/.test(l));
    expect(uses.map((l) => l.trim().replace(/\s+/g, ' '))).toEqual([
      'local bj bk=0 bd=0 bb d db bwhy=""',
      'if [ -f "$db" ] && [ ! -L "$db" ]; then bd=$((bd + 1)); fi',
      'bj="{\\"state\\":\\"$s_ok\\",\\"kept\\":$bk,\\"withData\\":$bd,\\"bytes\\":$bb}"',
      'tx+="backups: kept $bk, $bd with coordination data, $bb bytes"$\'\\n\'',
    ]);
    // ... and those lines sit between the backups block's start and the disk block's: nothing before or after reads it.
    const first = body.indexOf('local bj bk=0');
    const last = body.indexOf('local dj dfo');
    expect(first).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(first);
    expect(body.slice(0, first)).not.toMatch(/\bbd\b/);
    expect(body.slice(last)).not.toMatch(/\bbd\b/);
  });

  it('the verb names no prune, no lock and no ccd verb in its body', () => {
    const body = /^cmd_settings\(\) \{[\s\S]*?\n\}$/m.exec(SRC)?.[0] ?? '';
    expect(body.length).toBeGreaterThan(500);
    const code = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).not.toMatch(/_bak_prune|_bak_gc|_ver_gc|_upd_lock|_ver_lock_try|flock|rm -rf|ccd /);
    // The variable-key reads the settings census holds to two rows: none here.
    expect(code).not.toMatch(/_ccrc_knob "\$|"_set_\$/);
  });
});

describe('ccrc settings: the vocabularies are spelled once in the verb', () => {
  const body = /^cmd_settings\(\) \{[\s\S]*?\n\}$/m.exec(SRC)?.[0] ?? '';
  const code = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  it.each([
    ['state', ['ok', 'refused', 'unmeasured'], 's_'], ['from', ['environment', 'file', 'empty', 'default'], 'f_'], ['reader', ['timer', 'shell'], 'r_'],
  ] as [string, string[], string][])('the %s words are each assigned once, to a local, and no document literal spells one', (_what, words, pre) => {
    for (const w of words) {
      const decl = new RegExp(`\\b[a-z]_[a-z]+=${w}\\b`, 'g');
      expect([...code.matchAll(decl)], `${w} is declared once`).toHaveLength(1);
      expect(code, `${w} has the ${pre} prefix`).toMatch(new RegExp(`\\b${pre}[a-z]+=${w}\\b`));
    }
    // No JSON text spells a word: the keys' values are interpolated.
    expect(code).not.toMatch(new RegExp(`\\\\"${_what}\\\\":\\\\"(${words.join('|')})\\\\"`));
  });
});

describe('ccrc settings: the verb reads by literal calls, and its table of host test box keys mirrors the owner\'s (V9)', () => {
  const bodyOf = (name: string): string => new RegExp(`^${name}\\(\\) [({][\\s\\S]*?\\n[)}]$`, 'm').exec(SRC)?.[0] ?? '';
  const knobPairs = (body: string): string[] =>
    [...body.matchAll(/_ccrc_knob (CCRC_TESTBOX_[A-Z_]+) ('[^']*'|"[^"]*"|\S+) file/g)].map((m) => `${m[1]}=${m[2]}`);
  const TB_SRC = readFileSync(join(path.dirname(CCRC), 'testbox-knobs'), 'utf8');
  const bodyOfTb = (name: string): string => new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\n\\}$`, 'm').exec(TB_SRC)?.[0] ?? '';

  it('V9: _set_tb_host holds exactly _tb_host_table\'s (key, default) pairs, in order, each a literal file-mode read', () => {
    const mine = knobPairs(bodyOf('_set_tb_host'));
    const theirs = knobPairs(bodyOfTb('_tb_host_table'));
    expect(theirs).toHaveLength(16);
    expect(mine).toEqual(theirs);
    expect(bodyOf('_set_tb_host').match(/_ccrc_knob /g)).toHaveLength(16);
  });

  it('V9: the slice, keepalive, usage, carry and pressure reads are literal calls in file mode', () => {
    const reads = bodyOf('_set_reads');
    for (const re of [
      /_ccrc_knob CCRC_SESSION_SLICE_MEMORY_MAX 24G file;/, /_ccrc_knob CCRC_SESSION_SLICE_SWAP_MAX 6G file;/, /_ccrc_knob CCRC_TEST_PRESSURE_MAX 0 file;/,
      /_ccrc_knob CCRC_KEEPALIVE_FRESH 1800 file;/, /_ccrc_knob CCRC_KEEPALIVE_MODEL haiku file;/, /_ccrc_knob CCRC_KEEPALIVE_PROMPT "Reply with the single word: ok" file;/,
      /_ccrc_knob CCRC_USAGE_SWEEP_DAYS 7 file;/, /_ccrc_knob CCRC_CARRY_COPY_WARN_BYTES 10737418240 file;/, /_graph_knobs file\)/,
      /_ccrc_knob CCRC_BROWSER_MCP_DEFAULT off file;/, /_ccrc_knob CCRC_BROWSER_MCP_SERVERS "\$\(_browser_mcp_servers_default\)" file;/,
      // D-8122: the memory gate's four, at the defaults the server (`wakeGateConfigOf`) and the sweep (`_upd_sweep_knobs`) use.
      /_ccrc_knob CCRC_WAKE_PRESSURE_GATE warn file;/, /_ccrc_knob CCRC_WAKE_HEADROOM_MIN_GIB 3 file;/, /_ccrc_knob CCRC_SWEEP_BATCH 5 file;/,
      /_ccrc_knob CCRC_SWEEP_PRESSURE_WAIT_S 300 file;/,
      // D-8123: the limit rescue's two, at the defaults ccd (`_rescue_jitter_max`, the watchdog) uses.
      /_ccrc_knob CCRC_RESCUE_SOLO_JITTER_S 15 file;/, /_ccrc_knob CCRC_LIMIT_WATCHDOG_MIN 5 file;/,
      // D-8124: the admin-merge door's switch.
      /_ccrc_knob CCRC_ADMIN_MERGE auto file;/,
    ]) expect(reads, String(re)).toMatch(re);
    expect(reads.match(/_ccrc_knob /g), 'seventeen direct reads (D-8121 added the two browser reads, D-8122 the memory gate\'s four, D-8123 the limit rescue\'s two, D-8124 the admin-merge switch; D-8165 retired the coordinator lift\'s one); the two line readers are the owners\' own').toHaveLength(17);
  });

  // D-8122: the headroom floor's default is CLAUDE_HEADROOM_GATE_BYTES (the server's WAKE_HEADROOM_MIN_GIB_DEFAULT is
  // derived from it); the console's default (ccrc's bash read) and the docs' default are held to it, not to a literal.
  it('V9: CCRC_WAKE_HEADROOM_MIN_GIB\'s default is CLAUDE_HEADROOM_GATE_BYTES in GiB, in ccrc, the README and ccrc.env.example', () => {
    const gib = CLAUDE_HEADROOM_GATE_BYTES / 2 ** 30;
    expect(Number.isInteger(gib), 'the gate is a whole number of GiB').toBe(true);
    expect(bodyOf('_set_reads')).toContain(`_ccrc_knob CCRC_WAKE_HEADROOM_MIN_GIB ${gib} file;`);
    const readme = readFileSync(join(path.dirname(CCRC), '..', 'README.md'), 'utf8');
    expect(readme).toContain(`| \`CCRC_WAKE_HEADROOM_MIN_GIB\` | server | Whole GiB, default ${gib} (spec decision 6)`);
    const example = readFileSync(join(path.dirname(CCRC), '..', 'deploy', 'ccrc.env.example'), 'utf8');
    expect(example).toContain(`MemAvailable). Default ${gib},\n# spec decision 6's figure`);
  });

  it('CCRC_ADMIN_MERGE: auto by default, off accepted, any other word refused (D-8124)', () => {
    expect(rowOf(json(boxWith('ccrc-sv-lnd-', '')), 'CCRC_ADMIN_MERGE')).toEqual({ key: 'CCRC_ADMIN_MERGE', state: 'ok', value: 'auto', from: 'default' });
    expect(rowOf(json(boxWith('ccrc-sv-lnd-', 'CCRC_ADMIN_MERGE=off\n')), 'CCRC_ADMIN_MERGE')).toMatchObject({ state: 'ok', value: 'off', from: 'file' });
    expect(rowOf(json(boxWith('ccrc-sv-lnd-', 'CCRC_ADMIN_MERGE=on\n')), 'CCRC_ADMIN_MERGE')).toMatchObject({ state: 'refused', why: 'auto or off' });
  });

  it('V9: cmd_settings and its _set_ helpers never name the warning arrays, _tb_load, _gr_knobs or `_slice_limit ` with a space', () => {
    for (const fn of ['cmd_settings', '_set_reads', '_set_tb_host', '_set_lines', '_set_got', '_set_row_json', '_set_check', '_set_says', '_set_fits', '_set_libs']) {
      const code = bodyOf(fn).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
      expect(code.length, fn).toBeGreaterThan(50);
      expect(code, fn).not.toMatch(/TBK_WARN|GK_WARN|_tb_load|_gr_knobs|_slice_limit /);
    }
  });
});

describe('ccrc settings: empty means the default, in every family a consumer reads (V10, the ruling on Q5)', () => {
  // One empty line per family; the verb reads `from: empty` and, for a value row, the default; the consumer whose read the verb copies answers its default.
  const rows: [string, string, string][] = [
    ['CCRC_SESSION_SLICE_SWAP_MAX', '6G', '_ccrc_knob CCRC_SESSION_SLICE_SWAP_MAX 6G file; echo "$KNOB:$KNOB_FROM"'],
    ['CCRC_TEST_WIDE_FILES', '3', '_test_knobs | while IFS= read -r l; do case "$l" in CCRC_TEST_WIDE_FILES*) IFS=$\'\\037\' read -r _ _ v f <<<"$l"; echo "$v:$f";; esac; done'],
    ['CCRC_GRAPH_STORE', '', '_graph_knobs file | while IFS= read -r l; do case "$l" in CCRC_GRAPH_STORE*) IFS=$\'\\037\' read -r _ d v f <<<"$l"; [ "$v" = "$d" ] && echo "default:$f";; esac; done'],
    ['CCRC_TESTBOX_URL', '', '_tb_load host; echo "${TBK[CCRC_TESTBOX_URL]}:${TBK_FROM[CCRC_TESTBOX_URL]}"'],
    ['CCRC_KEEPALIVE_PROMPT', 'Reply with the single word: ok', '_ccrc_knob CCRC_KEEPALIVE_PROMPT "Reply with the single word: ok" file; echo "$KNOB:$KNOB_FROM"'],
    ['CCRC_USAGE_SWEEP_DAYS', '7', '_ccrc_knob CCRC_USAGE_SWEEP_DAYS 7 file; echo "$KNOB:$KNOB_FROM"'],
    ['CCRC_CARRY_COPY_WARN_BYTES', '10737418240', '_ccrc_knob CCRC_CARRY_COPY_WARN_BYTES 10737418240 file; echo "$KNOB:$KNOB_FROM"'],
  ];
  it.each(rows)('V10: an empty %s line reads from empty in the verb, and its consumer answers the default', (key, def, consumer) => {
    const home = boxWith('ccrc-sv-v10-', `${key}=\n`);
    const row = rowOf(json(home), key);
    expect(row.from, key).toBe('empty');
    expect(row.state, key).toBe('ok');
    if (CLS(key) === 'value') expect(row.value, key).toBe(def);
    else expect(row).not.toHaveProperty('value');
    const r = shell(home, `_set_libs; ${consumer}`);
    const out = r.stdout.trim();
    expect(out, `${key}: the consumer's answer (stderr: ${r.stderr})`).toMatch(new RegExp(`^${def.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:empty$|^default:empty$`));
  });
});
