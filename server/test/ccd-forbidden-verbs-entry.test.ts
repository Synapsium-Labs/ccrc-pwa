// D-8666 (the delegation broker's Rider): the installed direct entry (`ccd/ccd-entry.py#is_protected`) starts every verb of
// FORBIDDEN_CCD_VERBS it did not yet protect — `ws-rm`, `ws-reap`, `ws-gc`, `ws-archive`, `ws-restore`, `roll` and `claude`,
// each with any tail — under `bash -p`, so a case variant a caller reaches through an inherited `nocasematch` (exported in
// BASHOPTS) folds into none of them: `-p` drops the option and the body's dispatcher compares exactly. This file runs the
// REAL body behind the rendered launcher; `ccd-ws-lease-mark-reach.test.ts` holds the table that runs the shapes against both
// halves (these verbs are its `entry` class: the body does not refuse them when started another way).
//
// FIXTURE HOME ONLY: the launcher is a fixture install under the harness HOME, and no argv here reaches a removal. A case
// variant is refused as an unknown verb (the dispatcher's usage line) before any verb runs, and the exact spellings run here
// only as a usage refusal or the read-only `ws-gc` listing. `roll` and `claude` are no verb of the body yet (D-8667): their
// exact spelling reaches the dispatcher's usage line too, and their rows guard the spelling ahead of the verbs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { ghContainedEnv, installDirectEntry, type DirectEntry } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { spawnSyncGroup } from './spawnGroup.js';

let h: PrHarness;
let de: DirectEntry;
beforeEach(() => { h = makePrHarness('ccrc-forbidden-entry-'); });
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
/** The installed direct entry, executed by the kernel — the agent's own `execFile` shape — in a process group of its own,
 *  so a timeout ends whatever the body started too (#896). */
const direct = (args: readonly string[], env: Record<string, string> = {}): Ran => {
  const bin = path.join(h.home, '.local', 'bin');
  const r = spawnSyncGroup(de.entry, [...args], {
    cwd: h.home, encoding: 'utf8', timeout: 120_000,
    env: ghContainedEnv(h.home, { ...cleanEnv(), HOME: h.home, PATH: `${bin}:${process.env['PATH'] ?? ''}`, ...env },
      { systemd: true, tmux: true }),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** The body's dispatcher refusing a word that is no verb: its catch-all arm, exit 1. */
const UNKNOWN_VERB = 'usage: ccd {start|';
/** An inherited `nocasematch`, in a UTF-8 locale, where Bash folds beyond ASCII (U+0130 to `i`). */
const FOLDING = { BASHOPTS: 'nocasematch', LC_ALL: 'C.UTF-8' };

/** Every entry under HOME by its relative path: a file by its bytes' digest, a link by its target, a directory as such. */
const snapshot = (): Map<string, string> => {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e);
      const rel = path.relative(h.home, p);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) out.set(rel, `link ${fs.readlinkSync(p)}`);
      else if (st.isDirectory()) { out.set(rel, 'dir'); walk(p); } else out.set(rel, createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
    }
  };
  walk(h.home);
  return out;
};

/** A case variant of each verb, each with a tail the verb would act on. `ws-archİve` carries the non-ASCII fold. */
const VARIANTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['ws-rm', ['WS-RM', 'demo-x']],
  ['ws-rm', ['Ws-Rm', '--reason', 'r', 'demo-x']],
  ['ws-reap', ['WS-REAP', '--expect', 'a'.repeat(64), '--session', 'demo-x']],
  ['ws-gc', ['WS-GC']],
  ['ws-gc', ['Ws-Gc', '--prune']],
  ['ws-archive', ['WS-ARCHIVE', '--session', 'demo-x']],
  ['ws-archive', ['ws-archİve', '--session', 'demo-x']],
  ['ws-restore', ['WS-RESTORE', '--session', 'demo-x']],
  ['roll', ['ROLL', '--to', '1.2.3']],
  ['claude', ['Claude', 'mem']],
];

describe('the forbidden verbs through the installed direct entry, on the real body (D-8666)', () => {
  for (const [verb, argv] of VARIANTS) {
    it(`${argv.join(' ')} under an inherited nocasematch reaches no verb (${verb}) and changes nothing in the fixture`, () => {
      de = installDirectEntry(h.home);
      expect(direct(['version']).code, 'CONTROL: the body runs through the launcher').toBe(0);
      const before = snapshot();
      const r = direct(argv, FOLDING);
      expect(r.code, `${argv.join(' ')}: ${r.stderr.slice(0, 300)}`).toBe(1);
      expect(r.stderr, `${argv.join(' ')} reached a verb`).toContain(UNKNOWN_VERB);
      expect(snapshot(), `${argv.join(' ')} changed the fixture`).toEqual(before);
    }, 60_000);
  }

  it('the exact spellings still reach their verbs through the launcher', () => {
    de = installDirectEntry(h.home);
    for (const [verb, usage] of [['ws-rm', 'usage: ccd ws-rm'], ['ws-reap', 'usage: ccd ws-reap'],
      ['ws-archive', 'usage: ccd ws-archive'], ['ws-restore', 'usage: ccd ws-restore']] as const) {
      const r = direct([verb]);
      expect(r.code, `${verb}: ${r.stderr.slice(0, 300)}`).not.toBe(0);
      expect(r.stderr, `${verb} did not reach its own verb`).toContain(usage);
      expect(r.stderr, verb).not.toContain(UNKNOWN_VERB);
    }
    // D-8667: no `roll` or `claude` verb exists in the body yet, so the exact spelling is the dispatcher's unknown verb too.
    for (const verb of ['roll', 'claude']) expect(direct([verb]).stderr, verb).toContain(UNKNOWN_VERB);
  }, 60_000);

  it('ws-gc without --prune still lists through the launcher, under -p', () => {
    de = installDirectEntry(h.home);
    for (const argv of [['ws-gc'], ['ws-gc', '--fast']]) {
      const r = direct(argv);
      expect(r.code, `${argv.join(' ')}: ${r.stderr.slice(0, 300)}`).toBe(0);
      expect(r.stderr, argv.join(' ')).not.toContain(UNKNOWN_VERB);
    }
  }, 60_000);
});
