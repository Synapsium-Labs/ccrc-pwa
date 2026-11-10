// D-8166 (test box connect plan, Task TC2; spec §2.6, C12): the overlay `~/.ccrc/testbox.env`. The Test box card
// writes the fleet-side settings there and ccrc's one reader, `_ccrc_knob`, learns it for the sixteen fleet-host test
// box keys alone, and only when `ccrc.env` does not name the key. The overlay is read with the same scan and byte-wise
// model as `ccrc.env`, so a line it cannot decide refuses that key alone and the sentence names the overlay. A value
// from it reads `from: file`. The 28 box keys and the 16 fleet-host keys are disjoint, so box mode never meets it.
//
// Every row runs a fixed bash program on stdin; paths and keys are its arguments, never spliced into it. The fixture
// HOME holds ccrc.env and testbox.env; the real ccd/ccrc and the generated library are the code under test.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { healthy, runDoctor } from './ccrc-doctorFixture.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CCRC = join(REPO, 'ccd', 'ccrc');
const KNOBS = join(REPO, 'ccd', 'testbox-knobs');
const LIB = join(REPO, 'ccd', 'lib', 'ccrc-settings.sh');
const WRAPPER = join(REPO, 'ccd', 'ccrc-test');
const TIMES = join(REPO, 'ccd', 'ccd-testbox-times');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const US = '\x1f';

/** The sixteen fleet-host keys, spelled once here from the table `_tb_host_table` reads them in. */
const SIXTEEN = [
  'CCRC_TESTBOX_URL', 'CCRC_TESTBOX_TOKEN_FILE', 'CCRC_TESTBOX_GIT_URL_BASE', 'CCRC_TESTBOX_GIT_KEY',
  'CCRC_TESTBOX_UNTRACKED_FILE_MAX', 'CCRC_TESTBOX_SNAPSHOT_MAX', 'CCRC_TESTBOX_STATUS_DEADLINE',
  'CCRC_TESTBOX_RECONNECT_DEADLINE', 'CCRC_TESTBOX_LOST_RUN', 'CCRC_TESTBOX_QUEUE_LIMIT', 'CCRC_TESTBOX_QUEUE_WAIT',
  'CCRC_TESTBOX_BUDGET', 'CCRC_TESTBOX_DENY_GLOBS', 'CCRC_TESTBOX_POLL', 'CCRC_TESTBOX_FALLBACK_INSTALL', 'CCRC_TESTBOX_TIMES',
] as const;

interface Home { home: string; env: NodeJS.ProcessEnv }
function fixture(o: { ccrcEnv?: string | Buffer; overlay?: string | Buffer } = {}): Home {
  const home = mkTmp('tb-overlay-');
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  mkdirSync(join(home, 'tmp'), { recursive: true });
  if (o.ccrcEnv !== undefined) writeFileSync(join(home, '.ccrc', 'ccrc.env'), o.ccrcEnv);
  if (o.overlay !== undefined) writeFileSync(join(home, '.ccrc', 'testbox.env'), o.overlay);
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_') && !k.startsWith('TB_')) env[k] = v;
  Object.assign(env, { HOME: home, TMPDIR: join(home, 'tmp') });
  return { home, env };
}

/** `_ccrc_knob <key> <default> file` through ccd/ccrc (`src` = ccrc) or the generated library (`src` = lib), printed as
 *  `rc|KNOB|KNOB_FROM|KNOB_WHY`. A static program: the source file, the key and the default are its arguments. */
const KNOB_PROGRAM = '. "$1" || exit 90; _ccrc_knob "$2" "$3" file; rc=$?; printf "%s|%s|%s|%s" "$rc" "$KNOB" "$KNOB_FROM" "$KNOB_WHY"';
function knob(h: Home, key: string, def = '', src: 'ccrc' | 'lib' = 'ccrc'): { rc: string; value: string; from: string; why: string } {
  const r = spawnSync(BASH, ['-c', KNOB_PROGRAM, '_', src === 'ccrc' ? CCRC : LIB, key, def], { env: h.env, encoding: 'utf8', cwd: h.home });
  const [rc, value, from, ...why] = (r.stdout ?? '').split('|');
  expect(rc, `stderr: ${r.stderr}`).toBeDefined();
  return { rc: rc!, value: value!, from: from!, why: why.join('|') };
}

describe('the overlay ~/.ccrc/testbox.env: ccrc\'s one reader learns it for the sixteen fleet-host keys (D-8166, C12)', () => {
  it('the overlay path is spelled once beside the exposure file, and the sixteen keys are one literal list equal to the host table', () => {
    const text = readFileSync(CCRC, 'utf8');
    expect(text.split('\n').filter((l) => l.startsWith('CCRC_TESTBOX_OVERLAY_FILE='))).toEqual(['CCRC_TESTBOX_OVERLAY_FILE="$HOME/.ccrc/testbox.env"']);
    const lists = text.split('\n').filter((l) => l.startsWith('TB_OVERLAY_KEYS=('));
    expect(lists).toHaveLength(1);
    expect(lists[0]!.slice('TB_OVERLAY_KEYS=('.length, -1).split(' ')).toEqual([...SIXTEEN]);
    const table = readFileSync(KNOBS, 'utf8');
    const host = table.slice(table.indexOf('_tb_host_table() {'), table.indexOf('_tb_box_table() {'));
    expect([...host.matchAll(/_ccrc_knob (CCRC_[A-Z0-9_]+) /g)].map((m) => m[1])).toEqual([...SIXTEEN]);
  });

  it('a host key ccrc.env does not name reads from testbox.env with KNOB_FROM file', () => {
    const h = fixture({ ccrcEnv: 'CCRC_BACKUP_KEEP=5\n', overlay: 'CCRC_TESTBOX_URL=https://testbox.invalid:7790\nCCRC_TESTBOX_POLL=1m\n' });
    expect(knob(h, 'CCRC_TESTBOX_URL')).toMatchObject({ rc: '0', value: 'https://testbox.invalid:7790', from: 'file' });
    expect(knob(h, 'CCRC_TESTBOX_POLL', '30s')).toMatchObject({ rc: '0', value: '1m', from: 'file' });
    expect(knob(h, 'CCRC_TESTBOX_BUDGET', '15m')).toMatchObject({ rc: '0', value: '15m', from: 'default' });
  });

  it('the same row through the generated library', () => {
    const h = fixture({ overlay: 'CCRC_TESTBOX_URL=https://testbox.invalid:7790\n' });
    expect(knob(h, 'CCRC_TESTBOX_URL', '', 'lib')).toMatchObject({ rc: '0', value: 'https://testbox.invalid:7790', from: 'file' });
    expect(knob(h, 'CCRC_TESTBOX_POLL', '30s', 'lib')).toMatchObject({ rc: '0', value: '30s', from: 'default' });
  });

  it('a key ccrc.env names is read from ccrc.env and the overlay is never opened for it', () => {
    // An overlay line the model refuses would turn the key into rc 1 if the overlay were opened for it.
    const h = fixture({ ccrcEnv: 'CCRC_TESTBOX_URL=https://a.invalid:1\n', overlay: 'export CCRC_TESTBOX_URL=https://b.invalid:2\n' });
    expect(knob(h, 'CCRC_TESTBOX_URL')).toMatchObject({ rc: '0', value: 'https://a.invalid:1', from: 'file' });
    // A named-empty ccrc.env value is ccrc.env naming the key too: the overlay does not fill it.
    const e = fixture({ ccrcEnv: 'CCRC_TESTBOX_URL=\n', overlay: 'CCRC_TESTBOX_URL=https://b.invalid:2\n' });
    expect(knob(e, 'CCRC_TESTBOX_URL')).toMatchObject({ rc: '0', value: '', from: 'empty' });
  });

  it('an environment value still wins outside file mode', () => {
    const h = fixture({ overlay: 'CCRC_TESTBOX_POLL=1m\n' });
    h.env['CCRC_TESTBOX_POLL'] = '45s';
    const r = spawnSync(BASH, ['-c', '. "$1" || exit 90; _ccrc_knob CCRC_TESTBOX_POLL 30s; printf "%s|%s" "$KNOB" "$KNOB_FROM"', '_', CCRC], { env: h.env, encoding: 'utf8' });
    expect(r.stdout).toBe('45s|environment');
  });

  it('a key outside the sixteen is never read from the overlay', () => {
    const h = fixture({ overlay: 'CCRC_TESTBOX_RUNS=9\nCCRC_BACKUP_KEEP=9\nCCRC_TESTBOX_LISTEN=192.0.2.10:7790\n' });
    expect(knob(h, 'CCRC_TESTBOX_RUNS', '2')).toMatchObject({ rc: '0', value: '2', from: 'default' });
    expect(knob(h, 'CCRC_BACKUP_KEEP', '3')).toMatchObject({ rc: '0', value: '3', from: 'default' });
    expect(knob(h, 'CCRC_TESTBOX_LISTEN', '')).toMatchObject({ rc: '0', value: '', from: 'default' });
  });

  it('an overlay line the model cannot decide refuses that key only, never every setting', () => {
    const h = fixture({ overlay: 'export CCRC_TESTBOX_URL=https://b.invalid:2\nCCRC_TESTBOX_POLL=1m\n' });
    const url = knob(h, 'CCRC_TESTBOX_URL');
    expect(url.rc).toBe('1');
    expect(url.why).toContain('CCRC_TESTBOX_URL cannot be measured');
    expect(url.why).toContain('~/.ccrc/testbox.env');
    expect(url.why).not.toContain('b.invalid');
    expect(knob(h, 'CCRC_TESTBOX_POLL', '30s')).toMatchObject({ rc: '0', value: '1m', from: 'file' });
    expect(knob(h, 'CCRC_BACKUP_KEEP', '3')).toMatchObject({ rc: '0', value: '3' });
  });

  it('an overlay with a NUL refuses only the sixteen keys', () => {
    const h = fixture({ overlay: Buffer.from('CCRC_TESTBOX_POLL=1m\u0000\n', 'utf8') });
    for (const k of SIXTEEN) {
      const r = knob(h, k, 'x');
      expect(r.rc, k).toBe('1');
      expect(r.why, k).toContain('~/.ccrc/testbox.env');
    }
    expect(knob(h, 'CCRC_BACKUP_KEEP', '3')).toMatchObject({ rc: '0', value: '3', from: 'default' });
    expect(knob(h, 'CCRC_TESTBOX_RUNS', '2')).toMatchObject({ rc: '0', value: '2', from: 'default' });
  });

  it('an absent overlay reads every default', () => {
    const h = fixture({});
    for (const k of SIXTEEN) expect(knob(h, k, 'd'), k).toMatchObject({ rc: '0', value: 'd', from: 'default' });
  });

  it('an unreadable ccrc.env still refuses every key, the overlay does not stand in for it', () => {
    const h = fixture({ ccrcEnv: Buffer.from('A=1\u0000\n', 'utf8'), overlay: 'CCRC_TESTBOX_POLL=1m\n' });
    expect(knob(h, 'CCRC_TESTBOX_POLL', '30s').rc).toBe('1');
  });

  it('box mode never reads the overlay', () => {
    const h = fixture({ overlay: 'CCRC_TESTBOX_RUNS=9\nCCRC_TESTBOX_LISTEN=192.0.2.10:7790\nCCRC_TESTBOX_POLL=1m\n' });
    const root = mkTmp('tb-overlay-root-');
    mkdirSync(join(root, 'etc', 'ccrc-testbox'), { recursive: true });
    writeFileSync(join(root, 'etc', 'ccrc-testbox', 'ccrc.env'), 'CCRC_TESTBOX_WORKERS=3\n', { mode: 0o640 });
    Object.assign(h.env, { TB_FIXTURE_ROOT: root, TB_FIXTURE_OWNER_UID: String(process.getuid?.() ?? 0) });
    const r = spawnSync(BASH, ['-c', '. "$1" || exit 90; PROG="ccrc test"; . "$2" || exit 91; _testbox_knobs box', '_', CCRC, KNOBS], { env: h.env, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const v = Object.fromEntries(r.stdout.split('\n').filter((l) => l !== '').map((l) => l.split(US)).map((f) => [f[0]!, [f[2]!, f[3]!]]));
    expect(v['CCRC_TESTBOX_RUNS']).toEqual(['2', 'default']);
    expect(v['CCRC_TESTBOX_LISTEN']).toEqual(['', 'default']);
    expect(v['CCRC_TESTBOX_WORKERS']).toEqual(['3', 'file']);
  });

  it('ccrc test --testbox-knobs host prints the overlay\'s value', () => {
    const h = fixture({ ccrcEnv: '', overlay: 'CCRC_TESTBOX_URL=https://testbox.invalid:7790\nCCRC_TESTBOX_POLL=2m\n' });
    const r = spawnSync(BASH, [WRAPPER, '--testbox-knobs', 'host'], { env: h.env, encoding: 'utf8', cwd: h.home });
    expect(r.status, r.stderr).toBe(0);
    const rows = Object.fromEntries(r.stdout.split('\n').filter((l) => l !== '').map((l) => l.split(US)).map((f) => [f[0]!, [f[2]!, f[3]!]]));
    expect(rows['CCRC_TESTBOX_URL']).toEqual(['https://testbox.invalid:7790', 'file']);
    expect(rows['CCRC_TESTBOX_POLL']).toEqual(['2m', 'file']);
    expect(rows['CCRC_TESTBOX_BUDGET']).toEqual(['15m', 'default']);
  });

  it('ccrc settings --json shows an overlay value as from file and the four pairing keys as set', () => {
    const h = fixture({ ccrcEnv: '', overlay: [
      'CCRC_TESTBOX_URL=https://testbox.invalid:7790', 'CCRC_TESTBOX_TOKEN_FILE=/srv/fx/testbox.token',
      'CCRC_TESTBOX_GIT_URL_BASE=ssh://ccrc-tb-push@testbox.invalid/', 'CCRC_TESTBOX_GIT_KEY=/srv/fx/push.key',
      'CCRC_TESTBOX_POLL=2m', ''].join('\n') });
    const r = spawnSync(BASH, [CCRC, 'settings', '--json'], { env: h.env, encoding: 'utf8', cwd: h.home, input: '', timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as { settings?: { key: string; value?: string; set?: boolean; from?: string }[] };
    const rows = Object.fromEntries((doc.settings ?? []).map((s) => [s.key, s]));
    expect(rows['CCRC_TESTBOX_POLL']).toMatchObject({ value: '2m', from: 'file' });
    for (const k of ['CCRC_TESTBOX_URL', 'CCRC_TESTBOX_TOKEN_FILE', 'CCRC_TESTBOX_GIT_URL_BASE', 'CCRC_TESTBOX_GIT_KEY']) {
      expect(rows[k], k).toMatchObject({ from: 'file' });
      expect(JSON.stringify(rows[k]), `${k} shows no value`).not.toMatch(/testbox\.invalid|srv\/fx/);
    }
  });

  it('the doctor\'s testbox line reads CCRC_TESTBOX_URL from the overlay', () => {
    const home = healthy('tb-overlay-doctor-');
    appendFileSync(join(home, '.ccrc', 'testbox.env'), 'CCRC_TESTBOX_URL=https://testbox.invalid:7790\n');
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(home, '.local', 'bin', 'ccrc-api'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/ccrc-api-argv"\nprintf \'{"ok":false}\\n\'\nprintf \'http 503\\n\' >&2\n', { mode: 0o755 });
    const line = runDoctor(home).stdout.split('\n').find((l) => / testbox: /.test(l));
    expect(line, 'a testbox line').toBeDefined();
    expect(line).not.toMatch(/^SKIP testbox: off: no test box is configured/);
    expect(readFileSync(join(home, 'ccrc-api-argv'), 'utf8')).toBe('testbox status\n');
  });

  it('ccd-testbox-times reads CCRC_TESTBOX_URL from the overlay (through the launcher, which reads ccrc\'s reader)', () => {
    const h = fixture({ ccrcEnv: '', overlay: 'CCRC_TESTBOX_URL=https://testbox.invalid:7790\n' });
    mkdirSync(join(h.home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(h.home, '.local', 'bin', 'ccrc'), `#!/bin/sh\nexec "${BASH}" "${CCRC}" "$@"\n`, { mode: 0o755 });
    const stubs = join(h.home, 'stub-bin');
    mkdirSync(stubs, { recursive: true });
    writeFileSync(join(stubs, 'gh'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
    symlinkSync(BASH, join(stubs, 'bash'));   // ccd/ccrc-test's `#!/usr/bin/env bash` must find a bash 4+
    h.env['PATH'] = `${stubs}:/usr/bin:/bin`;
    const r = spawnSync(BASH, [TIMES], { env: h.env, encoding: 'utf8' });
    expect(r.stderr).not.toMatch(/no test box is configured/);
  });
});
