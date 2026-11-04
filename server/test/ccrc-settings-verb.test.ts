// Box settings view, Task 1 (D-6914, D-7861): `ccrc settings [--json] [--write] [--from timer]` — what the box's seven settings
// resolve to, printed or recorded as ~/.ccrc/box-settings.json. Every case runs the REAL `bash ccd/ccrc settings` (or the sourced
// `cmd_settings`, where a ccrc function is stubbed through `stubFn`) in a mkTmp fixture HOME with a contained environment:
// nothing here reaches the live HOME, a manager, a network or tmux. Neutral names only: this repository is public.
//
// The corpus row (the `ok` documents of server/test/fixtures/box-settings/, regenerated from the real verb with `date`, `df` and
// `du` stubbed by PATH) belongs to the server's parse task, which creates that directory; the stubs this file already plants
// (`date`, `mv`) are the seam it will use.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import { stubFn } from './ccdStub.js';

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
  for (const k of [...KEYS, 'CCRC_EXPOSURE_FILE']) delete env[k];
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

describe('ccrc settings: the seven settings and where each came from (D-7861)', () => {
  it('lists exactly the seven, in CCRC_SETTINGS order, each once; the verb\'s list is its own literal', () => {
    const line = /^CCRC_SETTINGS=\(([A-Z0-9_ ]+)\)$/m.exec(SRC)?.[1]?.split(' ') ?? [];
    expect(line.length).toBeGreaterThan(7);
    for (const k of KEYS) expect(line.filter((n) => n === k), `${k} appears once in CCRC_SETTINGS`).toHaveLength(1);
    expect(line.slice(0, 7), 'the seven are the first seven of CCRC_SETTINGS').toEqual(KEYS);
    const own = /^BOX_SETTINGS_KEYS=\(([A-Z0-9_ ]+)\)$/m.exec(SRC)?.[1]?.split(' ');
    expect(own, 'the verb holds its own literal list').toEqual(KEYS);
    const d = json(boxWith('ccrc-sv-keys-'));
    expect(d.settings.map((s) => s.key)).toEqual(KEYS);
    expect(d.v).toBe(1);
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

describe('ccrc settings: a refused value reads refused, with the act\'s own sentence', () => {
  it('CCRC_BACKUP_KEEP=abc: _keep_knob\'s sentence, the value as written', () => {
    const r = rowOf(json(boxWith('ccrc-sv-rf1-'), { CCRC_BACKUP_KEEP: 'abc' }), 'CCRC_BACKUP_KEEP');
    expect(r).toEqual({ key: 'CCRC_BACKUP_KEEP', state: 'refused', value: 'abc', from: 'environment',
      why: "CCRC_BACKUP_KEEP='abc' is not a whole number from 0 to 9999, as set in the environment" });
  });

  it('CCRC_BACKUP_DATA_KEEP=1: through _bak_data_keep\'s bound (2 is the lowest)', () => {
    const r = rowOf(json(boxWith('ccrc-sv-rf2-', 'CCRC_BACKUP_DATA_KEEP=1\n')), 'CCRC_BACKUP_DATA_KEEP');
    expect(r).toEqual({ key: 'CCRC_BACKUP_DATA_KEEP', state: 'refused', value: '1', from: 'file',
      why: "CCRC_BACKUP_DATA_KEEP='1' is not a whole number from 2 to 9999, as set in the box's ccrc.env" });
  });

  it('CCRC_VERSIONS_KEEP=10000 is over 9999', () => {
    const r = rowOf(json(boxWith('ccrc-sv-rf3-'), { CCRC_VERSIONS_KEEP: '10000' }), 'CCRC_VERSIONS_KEEP');
    expect(r.state).toBe('refused');
    expect(r.why).toBe("CCRC_VERSIONS_KEEP='10000' is not a whole number from 0 to 9999, as set in the environment");
  });

  it('CCRC_UPDATE_HEALTH_S=ninety: the health gate\'s own fallback words, in ASCII', () => {
    const r = rowOf(json(boxWith('ccrc-sv-rf4-'), { CCRC_UPDATE_HEALTH_S: 'ninety' }), 'CCRC_UPDATE_HEALTH_S');
    expect(r).toEqual({ key: 'CCRC_UPDATE_HEALTH_S', state: 'refused', value: 'ninety', from: 'environment',
      why: "CCRC_UPDATE_HEALTH_S='ninety' is not a number of seconds (digits only, at most 18) - using 90" });
  });

  it('CCRC_UPDATE_DEADLINE_MS=6e5: refused; the sentence gives the plain reading AS the plain reading, beside the min and max the acts read (F2)', () => {
    const d = json(boxWith('ccrc-sv-rf5-'), { CCRC_UPDATE_DEADLINE_MS: '6e5' });
    expect(rowOf(d, 'CCRC_UPDATE_DEADLINE_MS')).toEqual({ key: 'CCRC_UPDATE_DEADLINE_MS', state: 'refused', value: '6e5', from: 'environment',
      why: 'CCRC_UPDATE_DEADLINE_MS is not a positive whole number of milliseconds in canonical digits (at most 15, no lead zero), so its plain reading is 900000; the backup prune and the watchdog read the min and the max, which ccrc settings prints' });
    expect(rowOf(d, 'CCRC_UPDATE_DEADLINE_MS').why, 'no act reads the plain form').not.toContain('the acts read');
    expect(rowOf(d, 'CCRC_UPDATE_DEADLINE_MS').why, 'the card has no deadline line (review 1396 F2)').not.toContain('deadline line');
    expect(d.deadline.plainMs).toBe(900000);
    expect(d.deadline.minMs, 'min is 0 when a reading cannot be decided').toBe(0);
  });

  it.each([['3601', '3601'], ['99999', '99999']])('CCRC_MODELS_ADVANCE_BUDGET_S=%s is a clamp, which reads refused and says what the step uses', (v) => {
    const r = rowOf(json(boxWith('ccrc-sv-rf6-'), { CCRC_MODELS_ADVANCE_BUDGET_S: v }), 'CCRC_MODELS_ADVANCE_BUDGET_S');
    expect(r.state).toBe('refused');
    expect(r.value).toBe(v);
    expect(r.why).toBe(`CCRC_MODELS_ADVANCE_BUDGET_S='${v}' is over 3600 seconds, so the advance step uses 3600`);
  });

  it('CCRC_MODELS_ADVANCE_BUDGET_S of 30 zeros then 5000 is clamped, and the sentence marks its cut at 32 characters with three dots (A6)', () => {
    const v = `${'0'.repeat(30)}5000`;
    const r = rowOf(json(boxWith('ccrc-sv-rf6b-'), { CCRC_MODELS_ADVANCE_BUDGET_S: v }), 'CCRC_MODELS_ADVANCE_BUDGET_S');
    expect(r.state).toBe('refused');
    expect(r.why).toBe(`CCRC_MODELS_ADVANCE_BUDGET_S='${'0'.repeat(30)}50...' is over 3600 seconds, so the advance step uses 3600`);
    // A value of 32 characters or fewer is quoted whole, with no dots.
    expect(rowOf(json(boxWith('ccrc-sv-rf6c-'), { CCRC_MODELS_ADVANCE_BUDGET_S: `${'0'.repeat(28)}5000` }), 'CCRC_MODELS_ADVANCE_BUDGET_S').why)
      .toBe(`CCRC_MODELS_ADVANCE_BUDGET_S='${'0'.repeat(28)}5000' is over 3600 seconds, so the advance step uses 3600`);
  });

  it('CCRC_MODELS_ADVANCE_BUDGET_S=off is not a whole number: the act\'s sentence without its `ccrc: ` lead', () => {
    const r = rowOf(json(boxWith('ccrc-sv-rf7-'), { CCRC_MODELS_ADVANCE_BUDGET_S: 'off' }), 'CCRC_MODELS_ADVANCE_BUDGET_S');
    expect(r).toEqual({ key: 'CCRC_MODELS_ADVANCE_BUDGET_S', state: 'refused', value: 'off', from: 'environment',
      why: 'CCRC_MODELS_ADVANCE_BUDGET_S is not a whole number of seconds, so the advance step is off for this run' });
  });
});

describe('ccrc settings: a ccrc.env the reader cannot take is unmeasured, never unset (D-6365, D-6604)', () => {
  it('a NUL byte makes every setting unmeasured, and the verb still answers rc 0 with a valid document', () => {
    const d = json(boxWith('ccrc-sv-nul-', Buffer.from('NOTE=x\u0000y\n', 'utf8')));
    expect(d.v).toBe(1);
    expect(d.settings.map((s) => s.state)).toEqual(KEYS.map(() => 'unmeasured'));
    for (const s of d.settings) {
      expect(s.why, s.key).toContain(`${s.key} cannot be measured: ~/.ccrc/ccrc.env could not be scanned`);
      expect(s).not.toHaveProperty('value');
      expect(s).not.toHaveProperty('from');
    }
  });

  // Each platform's own reader (`_ccrc_knob`). On Linux the systemd reader makes only the key on the bad line unmeasured. On macOS the
  // launchd job sources the whole file with bash, so the shell reader refuses the backup keys that job reads: here CCRC_BACKUP_KEEP,
  // which the file names, and CCRC_BACKUP_DATA_KEEP, which it does not (as CI's macOS leg measured on this row); CCRC_VERSIONS_KEEP
  // stays ok on both.
  it('an inner CR: on Linux only the key on that line is unmeasured, on macOS the two backup keys the launchd job reads', () => {
    const d = json(boxWith('ccrc-sv-cr-', 'CCRC_BACKUP_KEEP=5\rjunk\nNOTE=1\n'));
    expect(rowOf(d, 'CCRC_BACKUP_KEEP').state).toBe('unmeasured');
    expect(d.settings.filter((s) => s.state === 'unmeasured').map((s) => s.key))
      .toEqual(process.platform === 'darwin' ? ['CCRC_BACKUP_KEEP', 'CCRC_BACKUP_DATA_KEEP'] : ['CCRC_BACKUP_KEEP']);
    expect(rowOf(d, 'CCRC_VERSIONS_KEEP').state).toBe('ok');
  });

  it('a line a quote carries across two lines: the reader\'s long sentence shows whole, under 480 bytes', () => {
    const d = json(boxWith('ccrc-sv-long-', 'CCRC_BACKUP_KEEP="5\nCCRC_X=1"\n'));
    const r = rowOf(d, 'CCRC_BACKUP_KEEP');
    expect(r.state).toBe('unmeasured');
    // On macOS the shell reader's sentence, which names the line, not the shape (`_box_unit_env_shell`).
    expect(r.why).toBe(process.platform === 'darwin'
      ? 'CCRC_BACKUP_KEEP cannot be measured: ~/.ccrc/ccrc.env line 1 is not a plain NAME=value line, and on macOS the launchd job '
        + 'sources both env files with bash, so that line can change what they set'
      : 'CCRC_BACKUP_KEEP cannot be measured: ~/.ccrc/ccrc.env names CCRC_BACKUP_KEEP in a shape this reader does not decide '
        + "(a space around '=', an export prefix, a backslash, a quote that is not one whole pair, a quote left open on an earlier line, "
        + 'or a line after one ending in a backslash)');
    expect(Buffer.byteLength(r.why!)).toBeLessThan(480);
    expect(r.why!.endsWith('...')).toBe(false);
  });

  it('a ccrc.env that cannot be read at all (mode 000) names ~/.ccrc/ccrc.env, never the fixture HOME', () => {
    if (process.getuid?.() === 0) return;
    const home = boxWith('ccrc-sv-unread-', 'NOTE=1\n');
    chmodSync(join(home, '.ccrc', 'ccrc.env'), 0o000);
    try {
      const r = settings(home, ['--json']);
      const d = docOf(r);
      expect(d.settings.map((s) => s.state)).toEqual(KEYS.map(() => 'unmeasured'));
      expect(rowOf(d, 'CCRC_BACKUP_KEEP').why).toBe('CCRC_BACKUP_KEEP cannot be measured: ~/.ccrc/ccrc.env is there but cannot be read');
      expect(r.stdout).not.toContain(home);
    } finally { chmodSync(join(home, '.ccrc', 'ccrc.env'), 0o600); }
  });

  it('a ccrc.env that cannot be read for the release base reads unmeasured, not default', () => {
    const d = json(boxWith('ccrc-sv-unm-url-', 'export CCRC_RELEASE_BASE_URL=https://u:p@h/\n'));
    expect(rowOf(d, 'CCRC_RELEASE_BASE_URL')).toEqual({ key: 'CCRC_RELEASE_BASE_URL', state: 'unmeasured',
      why: 'CCRC_RELEASE_BASE_URL cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take (it reads only a plain KEY=value line)' });
  });
});

describe('ccrc settings: nothing private reaches the output or the file', () => {
  it('a keep value of $HOME/x reads ~/x, and the fixture HOME appears nowhere', () => {
    const home = boxWith('ccrc-sv-red1-');
    const r = settings(home, ['--json', '--write'], { CCRC_BACKUP_KEEP: `${home}/x` });
    const d = docOf(r);
    expect(rowOf(d, 'CCRC_BACKUP_KEEP').value).toBe('~/x');
    expect(r.stdout).not.toContain(home);
    expect(readFileSync(join(home, '.ccrc', 'box-settings.json'), 'utf8')).not.toContain(home);
  });

  it.each(['CCRC_BACKUP_KEEP', 'CCRC_BACKUP_DATA_KEEP', 'CCRC_VERSIONS_KEEP'])(
    'a refused %s holding a path under a HOME of 40+ characters shows no part of the home path (the keep sentence cuts at 32 before it redacts)', (key) => {
      const home = boxWith(`ccrc-sv-long-home-${'p'.repeat(40)}-`);
      expect(home.length, 'the fixture HOME is long').toBeGreaterThan(40);
      const r = settings(home, ['--json', '--write'], { [key]: `${home}/backups` });
      const row = rowOf(docOf(r), key);
      expect(row.state).toBe('refused');
      expect(row.value).toBe('~/backups');
      expect(row.why).toMatch(new RegExp(`^${key}='~/backups' is not a whole number from [02] to 9999, as set in the environment$`));
      for (const out of [r.stdout, readFileSync(join(home, '.ccrc', 'box-settings.json'), 'utf8'), settings(home, [], { [key]: `${home}/backups` }).stdout]) {
        expect(out).not.toContain(home);
        expect(out, 'no prefix of the home path').not.toContain(home.slice(0, 9));
        for (let i = 0; i + 12 <= home.length; i++) expect(out, `a 12-character window of the home path at ${i}`).not.toContain(home.slice(i, i + 12));
      }
    });

  it('a path under the fixture HOME in the middle of a sentence comes out ~/..., and no fixture-HOME string is printed', () => {
    const home = boxWith('ccrc-sv-red2-');
    const r = settings(home, ['--json', '--write'], { CCRC_UPDATE_HEALTH_S: `${home}/deep/x` });
    const d = docOf(r);
    expect(rowOf(d, 'CCRC_UPDATE_HEALTH_S').why).toBe("CCRC_UPDATE_HEALTH_S='~/deep/x' is not a number of seconds (digits only, at most 18) - using 90");
    expect(r.stdout).not.toContain(home);
    expect(readFileSync(join(home, '.ccrc', 'box-settings.json'), 'utf8')).not.toContain(home);
    // The human form too.
    const h = settings(home, [], { CCRC_UPDATE_HEALTH_S: `${home}/deep/x` });
    expect(h.stdout).toContain("'~/deep/x'");
    expect(h.stdout).not.toContain(home);
  });

  it('a value holding https://u:p@h/ loses u:p@', () => {
    const home = boxWith('ccrc-sv-red3-');
    const r = settings(home, ['--json', '--write'], { CCRC_UPDATE_HEALTH_S: 'https://u:p@h/' });
    const row = rowOf(docOf(r), 'CCRC_UPDATE_HEALTH_S');
    expect(row.value).toBe('https://h/');
    expect(row.why).toContain("'https://h/'");
    expect(r.stdout).not.toContain('u:p');
    expect(readFileSync(join(home, '.ccrc', 'box-settings.json'), 'utf8')).not.toContain('u:p');
  });

  it('every string is printable ASCII: the three marks of this file are spelled in ASCII, a tab or a CR becomes ?', () => {
    const home = boxWith('ccrc-sv-ascii-');
    const row = rowOf(json(home, { CCRC_UPDATE_HEALTH_S: 'a\tb\rc' }), 'CCRC_UPDATE_HEALTH_S');
    expect(row.value).toBe('a?b?c');
    expect(row.why).toBe("CCRC_UPDATE_HEALTH_S='a?b?c' is not a number of seconds (digits only, at most 18) - using 90");
    const all = settings(home, ['--json'], { CCRC_UPDATE_HEALTH_S: 'a\tb\rc', CCRC_BACKUP_KEEP: 'café"\\' }).stdout;
    // eslint-disable-next-line no-control-regex
    expect(all.replace(/\n$/, '')).toMatch(/^[\x20-\x7e]*$/);
  });

  it('a double quote and a backslash in a value are JSON-escaped, and the document parses', () => {
    const d = json(boxWith('ccrc-sv-esc-'), { CCRC_BACKUP_KEEP: 'a"b\\c' });
    expect(rowOf(d, 'CCRC_BACKUP_KEEP').value).toBe('a"b\\c');
  });

  it('a string past 480 bytes is cut at 477 and ends with three dots', () => {
    const d = json(boxWith('ccrc-sv-cut-'), { CCRC_UPDATE_HEALTH_S: 'x'.repeat(900) });
    const row = rowOf(d, 'CCRC_UPDATE_HEALTH_S');
    expect(row.value).toBe(`${'x'.repeat(477)}...`);
    expect(Buffer.byteLength(row.why!)).toBe(480);
    expect(row.why!.endsWith('...')).toBe(true);
  });
});

describe('ccrc settings: the release base shows its scheme and host, nothing else', () => {
  const SECRETS = ['secret', 'token', 'u:p', '/r', 'user', 'tok@'];
  it.each([
    ['https://user:secret@mirror.example.invalid/r/x?token=abc', 'custom https://mirror.example.invalid'],
    ['user:secret@mirror.example.invalid/r?token=x', 'custom mirror.example.invalid'],
    ['https://u:p@x@mirror.example.invalid/r', 'custom https://mirror.example.invalid'],
    // D-7873: `tok@mirror.example.invalid` read `custom mirror.example.invalid` before; `_upd_redact` leaves a token-only userinfo before
    // a bare host (its KNOWN LIMIT), the `@` stays, and the row now records `custom` alone.
    ['tok@mirror.example.invalid', 'custom'],
    ['tok@mirror.example.invalid:8080/r', 'custom mirror.example.invalid:8080'],
    ['https://tok@mirror.example.invalid/r', 'custom https://mirror.example.invalid'],
  ])('%s shows as %s', (url, shown) => {
    const home = boxWith('ccrc-sv-url-');
    const r = settings(home, ['--json', '--write'], { CCRC_RELEASE_BASE_URL: url });
    const row = rowOf(docOf(r), 'CCRC_RELEASE_BASE_URL');
    expect(row).toEqual({ key: 'CCRC_RELEASE_BASE_URL', state: 'ok', value: shown, from: 'environment' });
    const file = readFileSync(join(home, '.ccrc', 'box-settings.json'), 'utf8');
    for (const s of SECRETS) {
      expect(r.stdout, `stdout holds ${s}`).not.toContain(s);
      expect(file, `the file holds ${s}`).not.toContain(s);
    }
    const human = settings(home, [], { CCRC_RELEASE_BASE_URL: url }).stdout;
    for (const s of SECRETS) expect(human, `the human form holds ${s}`).not.toContain(s);
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
      'user=x:pw@mirror.example.invalid/r', 'deploy://s3cret@mirror.example.invalid/r', 'ftp://mirror.example.invalid/r']) {
      expect(rc(u), JSON.stringify(u)).toEqual({ code: 1, out: '' });
    }
    // An ordinary userinfo keeps its host, a value with no '@' is untouched, and the scheme's case is kept.
    expect(rc('https://user:secret@mirror.example.invalid/r')).toEqual({ code: 0, out: 'https://mirror.example.invalid' });
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
  ])('%s reads exactly `custom`, in the JSON, the file and the human form', (url) => {
    const home = boxWith('ccrc-sv-url-at-');
    const r = settings(home, ['--json', '--write'], { CCRC_RELEASE_BASE_URL: url });
    expect(rowOf(docOf(r), 'CCRC_RELEASE_BASE_URL')).toEqual({ key: 'CCRC_RELEASE_BASE_URL', state: 'ok', value: 'custom', from: 'environment' });
    const file = readFileSync(join(home, '.ccrc', 'box-settings.json'), 'utf8');
    const human = settings(home, [], { CCRC_RELEASE_BASE_URL: url }).stdout;
    expect(human).toMatch(/^CCRC_RELEASE_BASE_URL {10}custom {2}\(/m);
    for (const out of [r.stdout, file, human]) for (const s of FORBIDDEN) expect(out, `${s} appears`).not.toContain(s);
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
    expect(r.stdout).toMatch(/^ {2}settings {2}print what this box's seven settings read as/m);
  });
});

describe('ccrc settings: the human form', () => {
  it('prints spec 2.1\'s source words, not the JSON tokens: environment, ccrc.env, ccrc.env (empty line), default (A9)', () => {
    const home = boxWith('ccrc-sv-words-', 'CCRC_BACKUP_DATA_KEEP=4\nCCRC_VERSIONS_KEEP=\nCCRC_UPDATE_DEADLINE_MS=6e5\nCCRC_MODELS_ADVANCE_BUDGET_S=off\n');
    const lines = settings(home, [], { CCRC_BACKUP_KEEP: '5', CCRC_UPDATE_HEALTH_S: 'ninety' }).stdout.split('\n');
    const line = (key: string): string => lines.find((l) => l.startsWith(`${key} `)) ?? '';
    expect(line('CCRC_BACKUP_KEEP')).toBe(`${'CCRC_BACKUP_KEEP'.padEnd(30)} 5  (environment, ok)`);
    expect(line('CCRC_BACKUP_DATA_KEEP')).toBe(`${'CCRC_BACKUP_DATA_KEEP'.padEnd(30)} 4  (ccrc.env, ok)`);
    expect(line('CCRC_VERSIONS_KEEP')).toBe(`${'CCRC_VERSIONS_KEEP'.padEnd(30)} 3  (ccrc.env (empty line), ok)`);
    expect(line('CCRC_RELEASE_BASE_URL')).toBe(`${'CCRC_RELEASE_BASE_URL'.padEnd(30)} default  (default, ok)`);
    // A refused row names its source the same way.
    expect(line('CCRC_UPDATE_HEALTH_S')).toMatch(/^CCRC_UPDATE_HEALTH_S {11}ninety {2}\(environment, refused\): /);
    expect(line('CCRC_UPDATE_DEADLINE_MS')).toMatch(/^CCRC_UPDATE_DEADLINE_MS {8}6e5 {2}\(ccrc\.env, refused\): /);
    // The JSON keeps its four tokens.
    const d = json(home, { CCRC_BACKUP_KEEP: '5' });
    expect([rowOf(d, 'CCRC_BACKUP_KEEP').from, rowOf(d, 'CCRC_BACKUP_DATA_KEEP').from, rowOf(d, 'CCRC_VERSIONS_KEEP').from, rowOf(d, 'CCRC_RELEASE_BASE_URL').from])
      .toEqual(['environment', 'file', 'empty', 'default']);
  });

  it('prints one line per setting (key, value, source, verdict, why) and the deadline, backups and disk lines', () => {
    const home = boxWith('ccrc-sv-human-');
    const r = settings(home, [], { CCRC_BACKUP_KEEP: 'abc', CCRC_UPDATE_HEALTH_S: '120' });
    expect(r.code, r.stderr).toBe(0);
    const lines = r.stdout.split('\n').filter(Boolean);
    expect(lines.slice(0, 7).map((l) => l.split(/\s+/)[0])).toEqual(KEYS);
    expect(lines[0]).toBe("CCRC_BACKUP_KEEP               abc  (environment, refused): CCRC_BACKUP_KEEP='abc' is not a whole number from 0 to 9999, as set in the environment");
    expect(lines[3]).toBe('CCRC_UPDATE_HEALTH_S           120  (environment, ok)');
    expect(lines[7]).toBe('deadline: plain 900000 ms, min 900000 ms, max 900000 ms');
    expect(lines[8]).toMatch(/^backups: /);
    expect(lines[9]).toMatch(/^disk: /);
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
    expect(JSON.parse(readFileSync(file(home), 'utf8')).v).toBe(1);
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
      expect(doc.v).toBe(1);
      expect(doc.settings).toHaveLength(7);
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
