import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configDirFor, loadConfig } from '../src/config.js';
import { mungePath } from '../src/munge.js';
import { RosterError } from '../../shared/roster.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster, DEFAULT_TEST_ROSTER } from './helpers.js';

// Several tests below exercise `CCRC_HOME` as a bare, never-created string
// (`/fake/home`, `/h`) — `loadConfig` never touches most of what it derives
// from `home` (they are `path.join`s, nothing more), but it DOES read
// `accountsPath` synchronously now (it refuses to boot without a roster), so
// every one of them pairs the fake home with `CCRC_ACCOUNTS` pointed at a
// real, seeded fixture file rather than needing `/fake/home` itself to exist.
const rosterFixtureDir = mkTmp('cfg-roster-');
seedRoster(rosterFixtureDir);
const ROSTER_PATH = path.join(rosterFixtureDir, '.ccrc', 'accounts.json');

describe('loadConfig', () => {
  it('derives all paths from CCRC_HOME', () => {
    const cfg = loadConfig({ CCRC_HOME: '/fake/home', CCRC_ACCOUNTS: ROSTER_PATH });
    expect(cfg.registryDir).toBe('/fake/home/.cc-sessions');
    expect(cfg.limitsDir).toBe('/fake/home/.cc-limits');
    expect(cfg.ccdBin).toBe('/fake/home/.local/bin/ccd');
    expect(configDirFor(cfg, 'claude2')).toBe('/fake/home/.claude-personal');
    expect(configDirFor(cfg, 'gpt')).toBe('/fake/home/.claude-gpt');
    expect(configDirFor(cfg, 'claude-dev0')).toBe('/fake/home/.claude-dev0');
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(7788);
  });

  it('loads the roster from ~/.ccrc/accounts.json, and exposes where it came from', () => {
    const home = mkTmp('cfg-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home });
    expect(cfg.roster.accounts.map((a) => a.id))
      .toEqual(['claude', 'claude2', 'claude-corp', 'gpt', 'claude-dev0']);
    expect(cfg.accountsPath).toBe(path.join(home, '.ccrc', 'accounts.json'));
    expect(configDirFor(cfg, 'claude')).toBe(path.join(home, '.claude'));
  });

  // The postmortem `configDirFor`'s own docstring names, pinned here at the
  // level `loadConfig`'s caller actually sees it: `claude-dev0` was missing
  // from the map `configDirFor` reads, for its entire life, because that map
  // used to be a hand-typed literal kept BESIDE the roster rather than
  // derived FROM it (`resolve()` in `sessionws.ts` returned null; the client
  // only ever saw "unknown session" — indistinguishable from a reaped one).
  // Pinning the whole SET here, not just one member, is what makes adding a
  // 6th account a deliberate, visible act instead of a silent gap.
  it('maps every account the roster declares — an unmapped one is invisible, not loud', () => {
    const home = mkTmp('cfg-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home });
    const mapped = cfg.roster.accounts.map((a) => configDirFor(cfg, a.id));
    expect(mapped).toEqual(cfg.roster.accounts.map((a) => path.join(home, a.configDirSuffix)));
  });

  it('refuses to boot on a malformed roster, naming the remedy', () => {
    const home = mkTmp('cfg-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'accounts.json'), '{"version":1,"accounts":[]}');
    expect(() => loadConfig({ CCRC_HOME: home })).toThrow(RosterError);
  });

  it('refuses to boot when accounts.json is absent, rather than running an empty roster', () => {
    const home = mkTmp('cfg-');
    expect(() => loadConfig({ CCRC_HOME: home })).toThrow(/accounts\.json/);
  });

  it('derives coordDbPath from CCRC_HOME by default, and honours CCRC_COORD_DB as an override', () => {
    // The precedent this pins is `fleetstate.test.ts`'s `defaultCachePath`
    // check: without an assertion HERE, a rename in `defaultCoordDbPath` (or a
    // typo in the `CCRC_COORD_DB` key) goes green everywhere — no test imports
    // the helper and none asserts `cfg.coordDbPath`.
    expect(loadConfig({ CCRC_HOME: '/fake/home', CCRC_ACCOUNTS: ROSTER_PATH }).coordDbPath)
      .toBe('/fake/home/.ccrc/coord.db');
    expect(loadConfig({
      CCRC_HOME: '/fake/home', CCRC_ACCOUNTS: ROSTER_PATH, CCRC_COORD_DB: '/elsewhere/coord.db',
    }).coordDbPath).toBe('/elsewhere/coord.db');
  });

  it('derives mailTokenPath from CCRC_HOME by default, and honours CCRC_MAIL_TOKEN_PATH as an override', () => {
    // Same precedent as the `coordDbPath` check above, for the same reason:
    // without an assertion HERE, a rename in the `.ccrc/mail.token` literal
    // (or a typo in the `CCRC_MAIL_TOKEN_PATH` key) goes green everywhere —
    // `readMailToken` reads nothing, `mailToken` is `null`, and
    // `checkMailToken(null, …)` accepts every caller. Fix-round finding
    // 4(a): this exact gap was named as the one construct in this task with
    // no test anywhere in the repo.
    expect(loadConfig({ CCRC_HOME: '/fake/home', CCRC_ACCOUNTS: ROSTER_PATH }).mailTokenPath)
      .toBe('/fake/home/.ccrc/mail.token');
    expect(loadConfig({
      CCRC_HOME: '/fake/home', CCRC_ACCOUNTS: ROSTER_PATH, CCRC_MAIL_TOKEN_PATH: '/elsewhere/mail.token',
    }).mailTokenPath).toBe('/elsewhere/mail.token');
  });

  it('honours env overrides', () => {
    const cfg = loadConfig({
      CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH, CCRC_HOST: '203.0.113.7', CCRC_PORT: '9000',
      CCRC_PROJECTS_ROOT: '/data/projects',
    });
    expect(cfg.host).toBe('203.0.113.7');
    expect(cfg.port).toBe(9000);
    expect(cfg.projectsRoot).toBe('/data/projects');
  });

  it('defaults fleetMode to local with no agent/hetzner config', () => {
    const cfg = loadConfig({ CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH });
    expect(cfg.fleetMode).toBe('local');
    expect(cfg.agentUrl).toBeNull();
    expect(cfg.agentToken).toBeNull();
    expect(cfg.hetznerToken).toBeNull();
    expect(cfg.fleetServerId).toBeNull();
  });

  it('CCRC_FLEET=remote plus agent/hetzner env vars populate the remote fleet config', () => {
    const cfg = loadConfig({
      CCRC_HOME: '/h',
      CCRC_ACCOUNTS: ROSTER_PATH,
      CCRC_FLEET: 'remote',
      CCRC_AGENT_URL: 'wss://203.0.113.7:7789',
      CCRC_AGENT_TOKEN: 'secret-token',
      CCRC_HETZNER_TOKEN: 'hetzner-secret',
      CCRC_FLEET_SERVER_ID: '12345',
    });
    expect(cfg.fleetMode).toBe('remote');
    expect(cfg.agentUrl).toBe('wss://203.0.113.7:7789');
    expect(cfg.agentToken).toBe('secret-token');
    expect(cfg.hetznerToken).toBe('hetzner-secret');
    expect(cfg.fleetServerId).toBe('12345');
  });

  it('any CCRC_FLEET value other than "remote" stays local', () => {
    const cfg = loadConfig({ CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH, CCRC_FLEET: 'bogus' });
    expect(cfg.fleetMode).toBe('local');
  });
});

describe('configDirFor — the ONE place a wrapper becomes a directory', () => {
  it('joins a known wrapper\'s configDirSuffix onto the given home', () => {
    const cfg = loadConfig({ CCRC_HOME: '/fake/home', CCRC_ACCOUNTS: ROSTER_PATH });
    expect(configDirFor(cfg, 'claude2')).toBe('/fake/home/.claude-personal');
    expect(configDirFor(cfg, 'claude-dev0')).toBe('/fake/home/.claude-dev0');
  });

  // `SessionRecord.wrapper` is an untrusted string read off disk (registry
  // fixtures write `'ghost-wrapper'` on purpose — see pr-sweep.test.ts's
  // archiveSafety tests) — `configDirFor` must answer `undefined`, not throw
  // and not silently build a path under a wrapper that doesn't exist.
  it('answers undefined for a wrapper the roster does not have, rather than fabricating a path', () => {
    const cfg = loadConfig({ CCRC_HOME: '/fake/home', CCRC_ACCOUNTS: ROSTER_PATH });
    expect(configDirFor(cfg, 'ghost-wrapper')).toBeUndefined();
    expect(configDirFor(cfg, '')).toBeUndefined();
  });
});

describe('DEFAULT_TEST_ROSTER', () => {
  // Guards the fixture itself: every other test in this suite that seeds a
  // bare `seedRoster(home)` is trusting this shape to mirror today's five
  // production accounts (shared/api.ts's `ACCOUNTS`) exactly — a drift here
  // would desync dozens of tests from what it silently changes.
  it('mirrors the five production accounts, in ACCOUNTS declaration order', () => {
    expect(DEFAULT_TEST_ROSTER.accounts.map((a) => a.id))
      .toEqual(['claude', 'claude2', 'claude-corp', 'gpt', 'claude-dev0']);
  });
});

describe('mungePath', () => {
  it('replaces / . _ with - (ccd cmd_swap rule)', () => {
    expect(mungePath('/data/projects/orchard-api')).toBe('-data-projects-orchard-api');
    expect(mungePath('/data/projects/foo/.claude/worktrees/ui')).toBe('-data-projects-foo--claude-worktrees-ui');
    expect(mungePath('/a/b_c.d')).toBe('-a-b-c-d');
  });
});
