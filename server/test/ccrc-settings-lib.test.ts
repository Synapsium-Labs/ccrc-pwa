// ccd/lib/ccrc-settings.sh — ccrc's settings reader, GENERATED from ccd/ccrc for the ccd-* sweeps (wave 29).
//
// The sweeps never source ccd/ccrc, so to read ~/.ccrc/ccrc.env exactly as ccrc does they source a library file.
// That file is never a second hand-kept copy of the reader: deploy/gen-settings-lib.mjs slices the BOX_ENV_FILE and
// CCRC_SETTINGS lines and the eight functions of the reader's closure whole out of ccd/ccrc, and these rows hold the
// committed file equal to what it writes (L1), the slice closed over what it calls (L2), the file inert when sourced
// (L3), and the two readers' answers equal over the fixture files wave 24's reader is argued against (L4).
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SETTINGS_LIB_FUNCTIONS, settingsLibText } from '../../deploy/gen-settings-lib.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const CCRC = join(REPO, 'ccd', 'ccrc');
const LIB = join(REPO, 'ccd', 'lib', 'ccrc-settings.sh');
const GEN = join(REPO, 'deploy', 'gen-settings-lib.mjs');
const read = (p: string): string => readFileSync(p, 'utf8');

const homes: string[] = [];
const freshHome = (): string => {
  const h = mkdtempSync(join(tmpdir(), 'ccrc-settings-lib-'));
  homes.push(h);
  mkdirSync(join(h, '.ccrc'), { recursive: true });
  mkdirSync(join(h, 'tmp'), { recursive: true });
  return h;
};
afterAll(() => { for (const h of homes) { try { chmodSync(join(h, '.ccrc', 'ccrc.env'), 0o600); } catch { /* not there */ } rmSync(h, { recursive: true, force: true }); } });

/** Static program text on stdin; paths stay in argv. No inherited CCRC_ name beyond what the row names. */
const bash = (home: string, script: string, args: string[], extra: Record<string, string> = {}) =>
  spawnSync('bash', ['--noprofile', '--norc', '-s', '--', ...args],
    { input: script, env: { HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: join(home, 'tmp'), ...extra }, encoding: 'utf8' });

/** The sliced bodies of the committed library, by name: `^name() {` through the first line that is exactly `}`. */
const bodiesOf = (text: string): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\(\) \{/.exec(lines[i]!);
    if (m === null) continue;
    const end = lines.indexOf('}', i);
    out.set(m[1]!, lines.slice(i + 1, end));
    i = end;
  }
  return out;
};

describe('W29: ccd/lib/ccrc-settings.sh is ccd/ccrc\'s reader, generated, never a second copy', () => {
  it('W29-L1: the committed file is settingsLibText(ccd/ccrc), byte for byte', () => {
    expect(read(LIB) === settingsLibText(read(CCRC)),
      'ccd/lib/ccrc-settings.sh is not what ccd/ccrc generates — run: node deploy/gen-settings-lib.mjs').toBe(true);
  });

  it('W29-L2: the slice is closed', () => {
    const bodies = bodiesOf(read(LIB));
    expect([...bodies.keys()]).toEqual([...SETTINGS_LIB_FUNCTIONS]);
    // A word in command position: at a line's start, or after `;`, `&`, `|`, `(`, `{`, `!`, `$(` or a keyword that
    // starts a command list, past any `NAME=value` prefix assignments (`_ccrc_knob` calls the model behind one). No
    // bash builtin begins with `_`, so every `_name` there must be a sliced function.
    const CMD = /(?:^|[;&|({!]|\$\(|\b(?:then|do|else|elif|if|while|until)\b)[ \t]*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^ \t;'"]*)[ \t]+)*(_[a-z_]+)(?![A-Za-z0-9_=])/g;
    const called = new Set<string>();
    for (const body of bodies.values()) {
      for (const line of body) {
        const code = line.replace(/(^|[ \t])#.*$/, '$1');
        for (const m of code.matchAll(CMD)) called.add(m[1]!);
      }
    }
    expect([...called].filter((n) => !SETTINGS_LIB_FUNCTIONS.includes(n)), 'called but not sliced').toEqual([]);
    expect(called.has('_box_unit_env'), 'non-vacuity: the scan sees _ccrc_knob\'s call of the model').toBe(true);
    const ccrc = read(CCRC);
    for (const n of SETTINGS_LIB_FUNCTIONS) {
      expect(ccrc.split('\n').filter((l) => l.startsWith(`${n}() {`)).length, `${n} defined once in ccd/ccrc`).toBe(1);
    }
  });

  it('W29-L3: sourcing it alone under set -u defines the eight functions and the two names, and runs nothing', () => {
    const home = freshHome();
    const r = bash(home, 'set -u; . "$1"; compgen -A function; printf "%s|%s\\n" "$BOX_ENV_FILE" "${CCRC_SETTINGS[*]}"', [LIB]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const lines = r.stdout.trimEnd().split('\n');
    const last = lines.pop()!;
    expect(new Set(lines)).toEqual(new Set(SETTINGS_LIB_FUNCTIONS));
    const list = /^CCRC_SETTINGS=\((.*)\)$/m.exec(read(CCRC))![1]!;
    expect(last).toBe(`${home}/.ccrc/ccrc.env|${list}`);
  });

  type Case = [string, (home: string) => void, Record<string, string>?, string?, RegExp?];
  const env = (home: string): string => join(home, '.ccrc', 'ccrc.env');
  const put = (text: string | Buffer) => (home: string) => writeFileSync(env(home), text, { mode: 0o600 });
  const CASES: Case[] = [
    ['absent', () => {}],
    ['CCRC_BACKUP_KEEP=5', put('CCRC_BACKUP_KEEP=5\n')],
    ['CCRC_BACKUP_KEEP=', put('CCRC_BACKUP_KEEP=\n')],
    ['export CCRC_BACKUP_KEEP=5', put('export CCRC_BACKUP_KEEP=5\n')],
    ['CCRC_BACKUP_KEEP="5"', put('CCRC_BACKUP_KEEP="5"\n')],
    ['CCRC_BACKUP_KEEP=5\\', put('CCRC_BACKUP_KEEP=5\\\n')],
    ['CRLF', put('CCRC_BACKUP_KEEP=5\r\n')],
    ['a NUL byte', put(Buffer.from('CCRC_BACKUP_KEEP=5\n\0\n'))],
    ['mode 000', (h) => { put('CCRC_BACKUP_KEEP=5\n')(h); chmodSync(env(h), 0o000); }],
    ['a dangling link', (h) => symlinkSync(join(h, 'nowhere'), env(h))],
    ['a directory', (h) => mkdirSync(env(h))],
    ['# CCRC_BACKUP_KEEP=5 alone', put('# CCRC_BACKUP_KEEP=5\n')],
    ['OTHER=1 alone', put('OTHER=1\n')],
    ['a setting inside an unrelated multi-line quoted value', put('OTHER="a\nCCRC_BACKUP_KEEP=5\nb"\n'), {}, 'CCRC_BACKUP_KEEP', /^1\|\|\|CCRC_BACKUP_KEEP cannot be measured: .*a quote left open on an earlier line/],
    ['an environment value of 7 over a file value of 5', put('CCRC_BACKUP_KEEP=5\n'), { CCRC_BACKUP_KEEP: '7' }],
    ['the key CCRC_NOT_A_SETTING', put('CCRC_NOT_A_SETTING=5\n'), {}, 'CCRC_NOT_A_SETTING'],
  ];
  it.each(CASES)('W29-L4: the library and ccd/ccrc answer alike: %s', (_name, setup, extra = {}, key = 'CCRC_BACKUP_KEEP', want) => {
    const home = freshHome();
    setup(home);
    const probe = '. "$1"; _ccrc_knob "$2" 10; rc=$?; printf "%s|%s|%s|%s\\n" "$rc" "$KNOB" "$KNOB_FROM" "$KNOB_WHY"';
    const viaCcrc = bash(home, probe, [CCRC, key], extra);
    const viaLib = bash(home, probe, [LIB, key], extra);
    expect(viaCcrc.stdout.split('|').length, `ccd/ccrc answered: ${viaCcrc.stdout}${viaCcrc.stderr}`).toBe(4);
    expect(viaLib.stdout).toBe(viaCcrc.stdout);
    if (want) {
      expect(viaCcrc.stdout).toMatch(want);
      expect(viaLib.stdout).toMatch(want);
    }
  });

  it('W29-L6: reader paths with shell punctuation remain one literal argument', () => {
    const home = freshHome();
    put('CCRC_BACKUP_KEEP=5\n')(home);
    for (const [name, source] of [['ccrc', CCRC], ['library', LIB]] as const) {
      const copy = join(home, `${name} ' " $(printf expanded) [*].sh`);
      writeFileSync(copy, read(source));
      const r = bash(home, '. "$1"; _ccrc_knob "$2" 10; printf "%s|%s\\n" "$KNOB" "$KNOB_FROM"', [copy, 'CCRC_BACKUP_KEEP']);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toBe('');
      expect(r.stdout).toBe('5|file\n');
    }
  });

  it('W29-L5: --check names the first differing line', () => {
    const home = freshHome();
    const copy = join(home, 'copy.sh');
    writeFileSync(copy, read(LIB));
    const ok = spawnSync(process.execPath, [GEN, '--check', '--out', copy], { encoding: 'utf8' });
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    const lines = read(LIB).split('\n');
    lines[8] = `${lines[8]} # changed`;
    writeFileSync(copy, lines.join('\n'));
    const bad = spawnSync(process.execPath, [GEN, '--check', '--out', copy], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/first difference at line 9\b/);
    expect(read(copy)).toBe(lines.join('\n'));
  });
});
