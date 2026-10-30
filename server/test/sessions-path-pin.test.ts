// D-7504 (ARCH-05, #551), characterization: the session store's path default, held by its inputs and outputs before
// it moves inward. `defaultSessionsPath(home)` is the ONE place `sessions.json` is spelled (D-123), and
// `config.ts#loadConfig` is its one caller: the `sessionsPath` default, which `CCRC_SESSIONS_PATH` overrides. A move
// commit changes this file only in its import line.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { defaultSessionsPath } from '../src/auth/sessions.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** A temp home with the account roster seeded: `loadConfig` reads the roster through `config.ts#loadRoster`, which
 *  throws on a bare home for a reason that has nothing to do with the path. */
const seededHome = (): string => {
  const home = mkTmp('ccrc-sessions-path-');
  seedRoster(home);
  return home;
};

describe('the session store path default (D-7504 characterization)', () => {
  it("defaultSessionsPath('/h') is '/h/.ccrc/sessions.json'", () => {
    expect(defaultSessionsPath('/h')).toBe('/h/.ccrc/sessions.json');
  });

  it("loadConfig's sessionsPath is defaultSessionsPath(CCRC_HOME)", () => {
    const home = seededHome();
    const cfg = loadConfig({ CCRC_HOME: home });
    expect(cfg.sessionsPath).toBe(defaultSessionsPath(home));
    expect(cfg.sessionsPath).toBe(path.join(home, '.ccrc', 'sessions.json'));
  });

  it('CCRC_SESSIONS_PATH overrides the default', () => {
    const home = seededHome();
    const over = path.join(home, 'elsewhere', 's.json');
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_SESSIONS_PATH: over });
    expect(cfg.sessionsPath).toBe(over);
    expect(cfg.sessionsPath).not.toBe(defaultSessionsPath(home));
  });
});
