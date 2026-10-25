// `scratch-rescue` sits behind the privileged direct-entry check (D-6632): the installed launcher (`ccd/ccd-entry.py`'s
// `is_protected`, a case-folding superset) starts it with `-p`, and the body's own entry guard refuses an unprivileged explicit
// bash. One table run against both, in the style of `ccd-ws-collect-reach.test.ts`. FIXTURE HOME ONLY: every launcher is a
// fixture install under the harness HOME, and no argv here reaches a rescue — a protected shape is refused at entry or started
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
beforeEach(() => { h = makePrHarness('ccrc-scratch-rescue-reach-'); });
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
  ['scratch-rescue alone', ['scratch-rescue']],
  ['scratch-rescue with its full tail', ['scratch-rescue', '--session', 'x', '/nowhere']],
];

describe('scratch-rescue is a protected shape at both classifiers', () => {
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
    expect(direct(['SCRATCH-RESCUE', '--session', 'x', '/nowhere'], { BASHOPTS: 'nocasematch' }).code).toBe(0);
    expect(echoed().flags.includes('p')).toBe(true);
    for (const argv of [['scratch-rescuex'], ['caps', 'scratch-rescue']]) {
      expect(direct(argv).code).toBe(0);
      expect(echoed().flags.includes('p'), argv.join(' ')).toBe(false);
    }
  }, 60_000);
});
