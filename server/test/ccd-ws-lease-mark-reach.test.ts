// `ws-lease-mark` (and, from PR2, `ws-lease-audit`, W5-G12) sits behind the privileged direct-entry check (delegation broker wave 5, W5-G4, as `ws-shed-deps` does, D-7278): the installed launcher (`ccd/ccd-entry.py`'s
// `is_protected`, a case-folding superset) starts it with `-p`, and the body's own entry guard refuses an unprivileged explicit
// bash. One table run against both, in the style of `ccd-ws-collect-reach.test.ts`. PR8b (D-8112; review 1665 N1): the adoption switch's
// writer `delegation-adopt` sits behind the same boundary, in the same table, so a case-folded spelling a child might reach through an
// inherited `nocasematch` starts protected and matches no verb. FIXTURE HOME ONLY: every launcher is a
// fixture install under the harness HOME, and no argv here reaches a removal — a protected shape is refused at entry or started
// over an echo body.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, ghContainedEnv, installDirectEntry, type DirectEntry } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';

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


const SHAPES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['ws-lease-mark alone', ['ws-lease-mark']],
  ['ws-lease-mark with its lease', ['ws-lease-mark', '--lease', '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab', '--generation', '1']],
  // W5-G12 (PR2): the read-only audit starts protected as its writer does.
  ['ws-lease-audit alone', ['ws-lease-audit']],
  ['ws-lease-audit with its lease', ['ws-lease-audit', '--lease', '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab', '--generation', '1', '--holders']],
  // PR8b (D-8112, review 1665 N1): the adoption switch's one writer, protected as ws-lease-mark is.
  ['delegation-adopt alone', ['delegation-adopt']],
  ['delegation-adopt on', ['delegation-adopt', '--state', 'on']],
];

describe('ws-lease-mark, ws-lease-audit and delegation-adopt are protected shapes at both classifiers', () => {
  it('the body refuses an unprivileged explicit bash at entry — nothing runs', () => {
    for (const argv of SHAPES.map(([, a]) => a)) {
      const b = bash([], argv);
      expect(b.code, `${argv.join(' ')}: ${b.stderr.slice(0, 300)}`).toBe(125);
      expect(b.stderr).toContain('refused (entry-unprivileged)');
    }
  }, 60_000);

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
    for (const argv of [['ws-lease-markx'], ['caps', 'ws-lease-mark'], ['ws-lease-auditx'], ['caps', 'ws-lease-audit'],
      ['delegation-adoptx'], ['caps', 'delegation-adopt']]) {
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

  it('DELEGATION-ADOPT --state on with BASHOPTS=nocasematch raises nothing: started protected, it matches no verb', () => {
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
