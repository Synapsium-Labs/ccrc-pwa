// `ws-collect` made REACHABLE (child reclamation spec 2026-09-22 §5.10, §8's wave 7): the dispatcher arm, the verb's
// name and its capability token `collect-v1` in `ccd caps`, and the direct-entry boundary both protected shapes cross
// — `ws-collect <any tail>` and `ws-audit --session <id> --collect` — at BOTH classifiers: the installed launcher
// (`ccd/ccd-entry.py`'s `is_protected`, a case-folding superset) and the body's own entry guard (exact). One table run
// against both, as `ccd-child-reclaim-entry.test.ts` runs its own; the collector's rows live here so that suite stays
// under the foreground ceiling. FIXTURE HOME ONLY: every launcher is a fixture install under the harness HOME, and no
// argv here reaches a collection — a protected shape is refused at entry, started over an echo body, or stopped by
// its own usage line.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, ghContainedEnv, installDirectEntry, type DirectEntry } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { itLinux } from './platformFixtures.js';

let h: PrHarness;
let de: DirectEntry;
beforeEach(() => { h = makePrHarness('ccrc-ws-collect-reach-'); });
afterEach(() => { h.cleanup(); });

const ANY_TOKEN = 'a'.repeat(64);
/** Every variable Bash startup consumes, removed so a CONTROL is clean by construction. */
const STARTUP_KEYS = ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS', 'CDPATH', 'GLOBIGNORE'];
const cleanEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(inheritedEnv())) {
    if (k.startsWith('BASH_FUNC_') || STARTUP_KEYS.includes(k)) continue;
    env[k] = v;
  }
  return env;
};
interface Ran { code: number; stdout: string; stderr: string }
const run = (file: string, args: readonly string[], env: Record<string, string> = {}): Ran => {
  const bin = path.join(h.home, '.local', 'bin');
  const r = spawnSync(file, [...args], {
    cwd: h.home, encoding: 'utf8', timeout: 120_000,
    env: ghContainedEnv(h.home, { ...cleanEnv(), HOME: h.home, PATH: `${bin}:${process.env['PATH'] ?? ''}`, ...env },
      { systemd: true, tmux: true }),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
/** The installed direct entry, executed by the kernel — the agent's own `execFile` shape. */
const direct = (args: readonly string[], env: Record<string, string> = {}): Ran => run(de.entry, args, env);
/** `ccd/ccd` by an EXPLICIT bash: `['-p']` is the launcher's start for a protected argv, `[]` the one it refuses. */
const bash = (flags: readonly string[], args: readonly string[], env: Record<string, string> = {}): Ran =>
  run('bash', [...flags, CCD, ...args], env);

/** A body that reports what it was started with (`$-` and its argv, NUL-terminated), installed in place of the real
 *  body, so the LAUNCHER's classification is what is read. */
const ECHO_BODY = '#!/usr/bin/env bash\n{ printf "%s\\0" "$-"; printf "%s\\0" "$@"; } > "$HOME/argv-out"\n';
const echoed = (): { flags: string; argv: string[] } => {
  const parts = fs.readFileSync(path.join(h.home, 'argv-out'), 'utf8').split('\0');
  parts.pop();
  return { flags: parts[0] ?? '', argv: parts.slice(1) };
};

describe('reachable: the capability token, the verb and the dispatcher arm', () => {
  it('ccd caps advertises the verb AND its capability token, on the line expire-v1 shares', () => {
    const advertised = h.sh('cmd_caps').split('\n');
    expect(advertised).toContain('ws-collect');
    expect(advertised).toContain('collect-v1');
    expect(advertised, 'the CONTROL: the shared line still prints its own tokens').toEqual(expect.arrayContaining(['expire-v1', 'ws-expire']));
  }, 60_000);

  it('the dispatcher routes ws-collect to its own usage, and the unknown-verb line names it', () => {
    const r = bash(['-p'], ['ws-collect']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain('usage: ccd ws-collect');
    expect(r.stderr).not.toContain('usage: ccd {start|');
    expect(bash(['-p'], ['no-such-verb']).stderr).toContain('|ws-collect|');
  }, 60_000);

  it('an unprivileged explicit bash is refused at entry for both protected shapes — nothing runs', () => {
    for (const argv of [['ws-collect'], ['ws-collect', '--expect', ANY_TOKEN, '--session', 'x'],
                        ['ws-audit', '--session', 'x', '--collect']]) {
      const b = bash([], argv);
      expect(b.code, `${argv.join(' ')}: ${b.stderr.slice(0, 300)}`).toBe(125);
      expect(b.stderr).toContain('refused (entry-unprivileged)');
    }
  }, 60_000);
});

/** Any `cmd_ws_audit` usage line that names the collector's mode — Task 5's wording, matched by what it must say. */
const AUDIT_USAGE = /^ccd: usage: ccd ws-audit --session <id> \[.*--collect.*\]$/m;
/** The GRAMMAR TABLE, run against both classifiers. `true` = protected. The fourth column is where a MALFORMED audit
 *  shape must die: ordinary at both entries, and still refused by `cmd_ws_audit`'s own parse. */
const GRAMMAR: ReadonlyArray<readonly [string, readonly string[], boolean, RegExp | null]> = [
  ['ws-collect alone', ['ws-collect'], true, null],
  ['ws-collect with the full tail', ['ws-collect', '--expect', ANY_TOKEN, '--session', 'x'], true, null],
  ['ws-collect with a dec trailing', ['ws-collect', '--expect', ANY_TOKEN, '--session', 'x', '--surface', 'agent'], true, null],
  ['ws-collect with a malformed tail (the body’s parser owns that)', ['ws-collect', '--defer-expired'], true, null],
  ['valid audit --collect', ['ws-audit', '--session', 'x', '--collect'], true, null],
  ['valid audit --collect with a session value the body will reject', ['ws-audit', '--session', '../../etc/passwd', '--collect'], true, null],
  ['audit, --collect --defer-expired (no such mode)', ['ws-audit', '--session', 'x', '--collect', '--defer-expired'], false, AUDIT_USAGE],
  ['audit, a later duplicate --collect', ['ws-audit', '--session', 'x', '--collect', '--collect'], false, AUDIT_USAGE],
  ['audit, --collect out of order', ['ws-audit', '--collect', '--session', 'x'], false, AUDIT_USAGE],
  ['a verb merely CONTAINING ws-collect later', ['caps', 'ws-collect'], false, null],
  ['ws-collectx (prefix only)', ['ws-collectx'], false, null],
  // CONTROLS: the shapes beside the collector's, unchanged by its rows.
  ['valid audit --expire (control)', ['ws-audit', '--session', 'x', '--expire'], true, null],
  ['plain audit (control)', ['ws-audit', '--session', 'x'], false, null],
];

describe('the protected grammar — the launcher and the body classify the same argv the same way', () => {
  for (const [name, argv, protectedShape, dies] of GRAMMAR) {
    it(`${name} → ${protectedShape ? 'protected' : 'ordinary'}`, () => {
      de = installDirectEntry(h.home, { body: ECHO_BODY });
      const r = direct(argv);
      expect(r.code, r.stderr).toBe(0);
      const got = echoed();
      expect(got.argv, 'argv arrives exactly').toEqual([...argv]);
      expect(got.flags.includes('p'), `launcher: flags ${got.flags}`).toBe(protectedShape);
      const b = bash([], argv);
      const refusedAtEntry = b.code === 125 && /refused \(entry-/.test(b.stderr);
      expect(refusedAtEntry, `body: rc ${b.code} ${b.stderr.slice(0, 300)}`).toBe(protectedShape);
      if (dies) {
        expect(b.code, `explicit bash: ${b.stderr.slice(0, 300)}`).toBe(1);
        expect(b.stderr).toMatch(dies);
        de = installDirectEntry(h.home);
        const l = direct(argv);
        expect(l.code, `launcher: ${l.stderr.slice(0, 300)}`).toBe(1);
        expect(l.stderr).toMatch(dies);
        expect(l.stderr).not.toContain('refused (entry-');
      }
    }, 60_000);
  }
});

/** An inherited `nocasematch` folds the BODY's guard and dispatcher (in C.UTF-8 beyond ASCII: U+0130 folds to `i`),
 *  so each variant must start PROTECTED at the launcher, where `-p` drops the option. */
const DOTTED_I = 'İ';
const NOCASE = { BASHOPTS: 'nocasematch', LC_ALL: 'C.UTF-8' };
const CASE_VARIANTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['WS-COLLECT alone', ['WS-COLLECT']],
  ['Ws-Collect with the full tail', ['Ws-Collect', '--expect', ANY_TOKEN, '--session', 'x']],
  ['WS-AUDIT --SESSION x --COLLECT', ['WS-AUDIT', '--SESSION', 'x', '--COLLECT']],
  [`ws-audit --sess${DOTTED_I}on x --collect (a non-ASCII fold)`, ['ws-audit', `--sess${DOTTED_I}on`, 'x', '--collect']],
];
/** Protected at the launcher although no measured locale folds them — the superset's harmless other half. */
const SUPERSET_ONLY: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['wſ-collect (a code point no measured fold maps to s)', ['wſ-collect']],
  ['ws-coléct (two bytes, two characters to a single-byte locale)', ['ws-coléct']],
];
const CASE_ORDINARY: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['WS-COLLECTX (prefix only)', ['WS-COLLECTX']],
  ['CAPS WS-COLLECT', ['CAPS', 'WS-COLLECT']],
  ['WS-AUDIT --SESSION x --COLLECT --DEFER-EXPIRED', ['WS-AUDIT', '--SESSION', 'x', '--COLLECT', '--DEFER-EXPIRED']],
];

describe('a case variant of a protected shape starts PROTECTED — the launcher folds case, a superset', () => {
  for (const [name, argv] of [...CASE_VARIANTS, ...SUPERSET_ONLY]) {
    it(`${name} → protected at the launcher`, () => {
      de = installDirectEntry(h.home, { body: ECHO_BODY });
      const r = direct(argv, NOCASE);
      expect(r.code, r.stderr).toBe(0);
      expect(echoed().argv, 'argv arrives exactly').toEqual([...argv]);
      expect(echoed().flags.includes('p'), `launcher: flags ${echoed().flags}`).toBe(true);
    }, 60_000);
  }
  for (const [name, argv] of CASE_ORDINARY) {
    it(`${name} → ordinary at the launcher`, () => {
      de = installDirectEntry(h.home, { body: ECHO_BODY });
      expect(direct(argv, NOCASE).code).toBe(0);
      expect(echoed().flags.includes('p'), `launcher: flags ${echoed().flags}`).toBe(false);
    }, 60_000);
  }

  itLinux('the CONTROL: under that nocasematch the BODY reads every variant as protected, and none of the ordinary ones', () => {
    for (const [name, argv] of CASE_VARIANTS) {
      const b = bash([], argv, NOCASE);
      expect(b.code === 125 && /refused \(entry-unprivileged\)/.test(b.stderr), `${name}: rc ${b.code} ${b.stderr.slice(0, 200)}`).toBe(true);
    }
    for (const [name, argv] of CASE_ORDINARY) {
      expect(/refused \(entry-/.test(bash([], argv, NOCASE).stderr), name).toBe(false);
    }
  }, 120_000);

  it('started protected, the real body compares exactly again: a variant is no verb at all', () => {
    de = installDirectEntry(h.home);
    const r = direct(['WS-COLLECT', '--expect', ANY_TOKEN], NOCASE);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/^usage: ccd \{/m);
    expect(r.stderr).not.toContain('refused (entry-');
  }, 60_000);
});
