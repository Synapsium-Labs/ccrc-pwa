// `ccd caps`'s pool-sync word (D-8015): the one measured fact that tells a box whose ccd CAN honour a central account
// tag from a box that DOES. It crosses the real `cmd_caps` through the real parser into the real decider, because the
// server tests inject `ccdVerbs` as literal arrays and would stay green against a ccd that printed nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseCcdCaps } from '../../shared/agent-protocol.js';
import { ACCOUNT_POOLS_CAP, POOL_SYNC_ABSENT_CAP, POOL_SYNC_INSTALLED_CAP } from '../src/ccdargv.js';
import { accountPoolsEnforcement } from '../src/pools.js';
import { CCD, ghContainedEnv, makeCcdHarness, plantPoolSyncTimer, type CcdHarness } from './ccdWsHelpers.js';
import { itLinux } from './platformFixtures.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('caps-pool-sync'); });
afterEach(() => { h.cleanup(); });

/** `cmd_caps` as `os` answers it. ccd sets `CCD_OS` from `uname` when it is sourced, so the word is named on the call
 *  rather than in the environment: the Linux arm is then read on a macOS leg too. */
const capsOn = (os: 'linux' | 'darwin'): string[] => h.sh(`CCD_OS=${os} cmd_caps`).split('\n').filter(Boolean);

/** The two words as printed, in print order. */
const words = (caps: readonly string[]): string[] =>
  caps.filter((c) => c === POOL_SYNC_INSTALLED_CAP || c === POOL_SYNC_ABSENT_CAP);

describe('ccd caps prints one pool-sync word, measured from the installed timer unit', () => {
  it('a Linux box with no timer unit prints pool-sync-absent', () => {
    expect(words(capsOn('linux'))).toEqual([POOL_SYNC_ABSENT_CAP]);
  });

  it('a Linux box with the timer unit prints pool-sync-installed', () => {
    plantPoolSyncTimer(h.home);
    expect(words(capsOn('linux'))).toEqual([POOL_SYNC_INSTALLED_CAP]);
  });

  it('reads the timer, not its neighbours: the service alone and the update timer are not installed', () => {
    const dir = path.join(h.home, '.config', 'systemd', 'user');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ccd-pool-sync.service'), '');
    fs.writeFileSync(path.join(dir, 'ccd-update-sync.timer'), '');
    expect(words(capsOn('linux'))).toEqual([POOL_SYNC_ABSENT_CAP]);
  });

  it('a macOS box prints pool-sync-absent: it has no timer to install, whatever sits on the Linux path', () => {
    plantPoolSyncTimer(h.home);
    expect(words(capsOn('darwin'))).toEqual([POOL_SYNC_ABSENT_CAP]);
  });

  it('keeps the account-pools word in both arms, so the server can tell this ccd from an older one', () => {
    expect(capsOn('linux')).toContain(ACCOUNT_POOLS_CAP);
    plantPoolSyncTimer(h.home);
    expect(capsOn('linux')).toContain(ACCOUNT_POOLS_CAP);
  });
});

describe('the word as the agent reads it: `ccd caps` run as a program, through parseCcdCaps', () => {
  const asAgent = (): string[] | null =>
    parseCcdCaps(execFileSync('bash', [CCD, 'caps'], {
      encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, h.env(), { systemd: true, tmux: true, net: true }),
    }));

  it('a box with no timer reads unavailable', () => {
    expect(accountPoolsEnforcement(asAgent())).toBe('unavailable');
  });

  // Linux only, as `ccd-crosspool.test.ts` says of its own rows: a program run on macOS answers macOS's arm, and a box
  // there cannot have this timer.
  itLinux('a box with the timer reads enforced', () => {
    plantPoolSyncTimer(h.home);
    expect(accountPoolsEnforcement(asAgent())).toBe('enforced');
  });
});
