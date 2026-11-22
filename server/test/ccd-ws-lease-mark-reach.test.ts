// `ws-lease-mark` (and, from PR2, `ws-lease-audit`, W5-G12) sits behind the privileged direct-entry check (delegation broker wave 5, W5-G4, as `ws-shed-deps` does, D-7278): the installed launcher (`ccd/ccd-entry.py`'s
// `is_protected`, a case-folding superset) starts it with `-p`, and the body's own entry guard refuses an unprivileged explicit
// bash. One table run against both, in the style of `ccd-ws-collect-reach.test.ts`. PR8b (D-8112; review 1665 N1): the adoption switch's
// writer `delegation-adopt` sits behind the same boundary, in the same table, so a case-folded spelling a child might reach through an
// inherited `nocasematch` starts protected and matches no verb. D-8666 (the delegation broker's Rider): the forbidden verbs the
// launcher did not yet protect (`ws-rm`, `ws-reap`, `ws-gc`, `ws-archive`, `ws-restore`, `roll` and `claude`) join the same
// table as a class of their own, `entry`: the launcher starts them under `-p` and the body does NOT refuse an unprivileged
// start of them, because the operator and their own suites start the body directly. FIXTURE HOME ONLY: every launcher is a
// fixture install under the harness HOME, and no argv here reaches a removal — a protected shape is refused at entry or started
// over an echo body, and the real body runs an `entry`-class shape only where it removes nothing (a usage refusal or a listing).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, ghContainedEnv, installDirectEntry, type DirectEntry } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { spawnSyncGroup } from './spawnGroup.js';

let h: PrHarness;
let de: DirectEntry;
beforeEach(() => { h = makePrHarness('ccrc-lease-mark-reach-'); });
afterEach(() => { h.cleanup(); });

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
/** `ccd/ccd` by an unprivileged explicit bash, the REAL body running in a process group of its own, so a timeout ends
 *  whatever it started too (#896; review 2313 A7): the `entry` class's body half runs the verbs themselves. */
const bashGroup = (args: readonly string[]): Ran => {
  const bin = path.join(h.home, '.local', 'bin');
  const r = spawnSyncGroup('bash', [CCD, ...args], {
    cwd: h.home, encoding: 'utf8', timeout: 120_000,
    env: ghContainedEnv(h.home, { ...cleanEnv(), HOME: h.home, PATH: `${bin}:${process.env['PATH'] ?? ''}` },
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


/** Which halves protect a shape. `both`: the launcher starts it under `-p` AND the body refuses an unprivileged start
 *  (the server-composed verbs). `entry`: the launcher starts it under `-p`, and the body runs it however it was started
 *  (D-8666: the operator's forbidden verbs, whose callers start the body directly). */
type ShapeClass = 'both' | 'entry';
const SHAPES: ReadonlyArray<readonly [string, readonly string[], ShapeClass]> = [
  ['ws-lease-mark alone', ['ws-lease-mark'], 'both'],
  ['ws-lease-mark with its lease', ['ws-lease-mark', '--lease', '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab', '--generation', '1'], 'both'],
  // W5-G12 (PR2): the read-only audit starts protected as its writer does.
  ['ws-lease-audit alone', ['ws-lease-audit'], 'both'],
  ['ws-lease-audit with its lease', ['ws-lease-audit', '--lease', '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab', '--generation', '1', '--holders'], 'both'],
  // PR8b (D-8112, review 1665 N1): the adoption switch's one writer, protected as ws-lease-mark is.
  ['delegation-adopt alone', ['delegation-adopt'], 'both'],
  ['delegation-adopt on', ['delegation-adopt', '--state', 'on'], 'both'],
  // The Overlord W1 ccd arms (plan Task 3): the sleep markers' one writer, protected as delegation-adopt is.
  ['keep-awake alone', ['keep-awake'], 'both'],
  ['keep-awake on', ['keep-awake', '--session', 'demo-quiet-basin', '--state', 'on'], 'both'],
  // D-8666: every verb of FORBIDDEN_CCD_VERBS the launcher did not yet protect, with any tail. Each shape here is one the
  // REAL body may run unprivileged in the fixture HOME (the body half below runs it): a usage refusal or the read-only
  // listing. `roll` and `claude` are no body verb yet (D-8667).
  ['ws-rm alone', ['ws-rm'], 'entry'],
  ['ws-reap alone', ['ws-reap'], 'entry'],
  ['ws-gc alone, the read-only listing', ['ws-gc'], 'entry'],
  ['ws-gc --fast', ['ws-gc', '--fast'], 'entry'],
  ['ws-archive alone', ['ws-archive'], 'entry'],
  ['ws-restore alone', ['ws-restore'], 'entry'],
  ['roll with a tail', ['roll', '--to', '1.2.3'], 'entry'],
  ['claude with a tail', ['claude', 'mem'], 'entry'],
];

describe('the launcher protects every shape; the body refuses the `both` class only', () => {
  it('the body refuses an unprivileged explicit bash at entry for the `both` class — nothing runs', () => {
    for (const argv of SHAPES.filter(([, , c]) => c === 'both').map(([, a]) => a)) {
      const b = bash([], argv);
      expect(b.code, `${argv.join(' ')}: ${b.stderr.slice(0, 300)}`).toBe(125);
      expect(b.stderr).toContain('refused (entry-unprivileged)');
    }
  }, 60_000);

  it('the body does NOT refuse an unprivileged explicit bash for the `entry` class (D-8666): its callers start the body directly', () => {
    const entryOnly = SHAPES.filter(([, , c]) => c === 'entry').map(([, a]) => a);
    expect(entryOnly.length, 'the class is populated').toBe(8);
    for (const argv of entryOnly) {
      const b = bashGroup(argv);
      expect(b.code, `${argv.join(' ')}: ${b.stderr.slice(0, 300)}`).not.toBe(125);
      expect(b.stderr, argv.join(' ')).not.toContain('refused (entry-');
    }
  }, 120_000);

  for (const [name, argv] of SHAPES) {
    it(`${name}: the launcher starts the body protected (-p), argv exact`, () => {
      de = installDirectEntry(h.home, { body: ECHO_BODY });
      const r = direct(argv);
      expect(r.code, r.stderr).toBe(0);
      expect(echoed().argv).toEqual([...argv]);
      expect(echoed().flags.includes('p'), `launcher: flags ${echoed().flags}`).toBe(true);
    }, 60_000);
  }

  it('a case variant starts PROTECTED at the launcher (a superset), and the CONTROLS stay ordinary', () => {
    de = installDirectEntry(h.home, { body: ECHO_BODY });
    expect(direct(['WS-LEASE-MARK', '--lease', 'x'], { BASHOPTS: 'nocasematch' }).code).toBe(0);
    expect(echoed().flags.includes('p')).toBe(true);
    expect(direct(['Ws-Lease-Audit', '--lease', 'x'], { BASHOPTS: 'nocasematch' }).code).toBe(0);
    expect(echoed().flags.includes('p')).toBe(true);
    expect(direct(['DELEGATION-ADOPT', '--state', 'on'], { BASHOPTS: 'nocasematch' }).code).toBe(0);
    expect(echoed().flags.includes('p')).toBe(true);
    expect(direct(['Keep-Awake', '--session', 'x', '--state', 'on'], { BASHOPTS: 'nocasematch' }).code).toBe(0);
    expect(echoed().flags.includes('p')).toBe(true);
    // D-8666: a case variant of each verb the launcher newly protects, an ASCII one and one with a non-ASCII character
    // (which the matcher reads as any one character, so no locale's fold escapes it).
    for (const argv of [['WS-RM', 'demo-x'], ['Ws-Reap', '--expect', 'x'], ['WS-GC'], ['ws-gc', '--prune'], ['WS-GC', '--PRUNE'],
      ['Ws-Archive', '--session', 'x'], ['ws-arch\u0130ve', '--session', 'x'], ['WS-RESTORE', '--session', 'x'],
      ['ROLL', '--to', '1.2.3'], ['Ro\u0141l'], ['CLAUDE', 'mem'], ['Cl\u00e5ude'], ['w\u017f-rm', 'demo-x']]) {
      expect(direct(argv, { BASHOPTS: 'nocasematch' }).code, argv.join(' ')).toBe(0);
      expect(echoed().argv, argv.join(' ')).toEqual(argv);
      expect(echoed().flags.includes('p'), `${argv.join(' ')}: flags ${echoed().flags}`).toBe(true);
    }
    for (const argv of [['ws-lease-markx'], ['caps', 'ws-lease-mark'], ['ws-lease-auditx'], ['caps', 'ws-lease-audit'],
      ['delegation-adoptx'], ['caps', 'delegation-adopt'], ['keep-awakex'], ['caps', 'keep-awake'],
      // D-8666's controls: a longer or shorter word, or the verb in a later position, stays ordinary.
      ['ws-rmx'], ['ws-r'], ['caps', 'ws-rm'], ['ws-gcx'], ['ws-archived'], ['ws-restores'], ['rolls'], ['rol'], ['claudex'],
      ['claude-x'], ['caps', 'roll'], ['caps', 'claude']]) {
      expect(direct(argv).code).toBe(0);
      expect(echoed().flags.includes('p'), argv.join(' ')).toBe(false);
    }
  }, 60_000);
});

// PR8b (D-8112; review 1665 N1): the REAL body behind the rendered launcher. The switch still works through it, and a case-folded
// spelling under an inherited `nocasematch` starts under `-p`, where the dispatcher compares exactly and matches no verb.
describe('delegation-adopt through the installed direct entry, on the real body', () => {
  const marker = (): string => path.join(h.home, '.cc-sessions', 'delegation-adopt');

  it('on and off still work through the launcher', () => {
    de = installDirectEntry(h.home);
    const on = direct(['delegation-adopt', '--state', 'on']);
    expect([on.code, on.stdout.trim()], on.stderr).toEqual([0, 'on']);
    expect(fs.lstatSync(marker()).isFile()).toBe(true);
    const off = direct(['delegation-adopt', '--state', 'off']);
    expect([off.code, off.stdout.trim()], off.stderr).toEqual([0, 'off']);
    expect(fs.existsSync(marker())).toBe(false);
  }, 60_000);

  it('DELEGATION-ADOPT --state on with BASHOPTS=nocasematch exits non-zero and leaves no marker, while the exact verb raises it', () => {
    de = installDirectEntry(h.home);
    for (const verb of ['DELEGATION-ADOPT', 'Delegation-Adopt']) {
      const r = direct([verb, '--state', 'on'], { BASHOPTS: 'nocasematch', LC_ALL: 'C.UTF-8' });
      expect(r.code, `${verb}: ${r.stderr.slice(0, 200)}`).not.toBe(0);
      expect(fs.existsSync(marker()), `${verb} raised the switch`).toBe(false);
    }
    expect(direct(['delegation-adopt', '--state', 'on']).code, 'CONTROL: the exact verb raises it').toBe(0);
    expect(fs.existsSync(marker())).toBe(true);
  }, 60_000);
});

// The Overlord W1 ccd arms (plan Task 3): the REAL body behind the rendered launcher. `on` and `off` work through it, and a
// case-folded spelling under an inherited `nocasematch` starts under `-p`, where the dispatcher compares exactly, matches no
// verb, and writes nothing.
describe('keep-awake through the installed direct entry, on the real body', () => {
  const ID = 'demo-quiet-basin';
  const reg = (f: string): string => path.join(h.home, '.cc-sessions', `${ID}.${f}`);
  const seed = (): void => { fs.mkdirSync(path.join(h.home, '.cc-sessions'), { recursive: true }); fs.writeFileSync(reg('uuid'), 'u\n'); };

  it('on and off still work through the launcher', () => {
    de = installDirectEntry(h.home);
    seed();
    const on = direct(['keep-awake', '--session', ID, '--state', 'on']);
    expect([on.code, on.stdout.trim()], on.stderr).toEqual([0, `awake ${ID}`]);
    expect(fs.readFileSync(reg('no-roll'), 'latin1')).toBe('keep-awake v1');
    expect(fs.readFileSync(reg('no-hibernate'), 'latin1')).toBe('keep-awake v1');
    const off = direct(['keep-awake', '--session', ID, '--state', 'off']);
    expect([off.code, off.stdout.trim()], off.stderr).toEqual([0, `released ${ID}`]);
    expect(fs.existsSync(reg('no-roll'))).toBe(false);
    expect(fs.existsSync(reg('no-hibernate'))).toBe(false);
  }, 60_000);

  it('KEEP-AWAKE with BASHOPTS=nocasematch exits non-zero and writes nothing, while the exact verb writes both', () => {
    de = installDirectEntry(h.home);
    seed();
    for (const verb of ['KEEP-AWAKE', 'Keep-Awake']) {
      const r = direct([verb, '--session', ID, '--state', 'on'], { BASHOPTS: 'nocasematch', LC_ALL: 'C.UTF-8' });
      expect(r.code, `${verb}: ${r.stderr.slice(0, 200)}`).not.toBe(0);
      expect(fs.existsSync(reg('no-roll')), `${verb} wrote a marker`).toBe(false);
    }
    expect(direct(['keep-awake', '--session', ID, '--state', 'on']).code, 'CONTROL: the exact verb writes them').toBe(0);
    expect(fs.existsSync(reg('no-roll'))).toBe(true);
  }, 60_000);
});
