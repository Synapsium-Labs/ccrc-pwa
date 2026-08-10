import { describe, it, expect } from 'vitest';
import { configDirFor, loadConfig } from '../src/config.js';
import { mungePath } from '../src/munge.js';
import { ACCOUNTS } from '../../shared/api.js';

describe('loadConfig', () => {
  it('derives all paths from CCRC_HOME', () => {
    const cfg = loadConfig({ CCRC_HOME: '/fake/home' });
    expect(cfg.registryDir).toBe('/fake/home/.cc-sessions');
    expect(cfg.limitsDir).toBe('/fake/home/.cc-limits');
    expect(cfg.ccdBin).toBe('/fake/home/.local/bin/ccd');
    expect(cfg.wrappers['claude2']).toBe('/fake/home/.claude-personal');
    expect(cfg.wrappers['gpt']).toBe('/fake/home/.claude-gpt');
    expect(cfg.wrappers['claude-dev0']).toBe('/fake/home/.claude-dev0');
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(7788);
  });

  it('maps every account wrapper the fleet host can run — an unmapped one is invisible, not loud', () => {
    // The whole key set, not a spot-check. `sessionws.ts`'s `resolve()` answers
    // `null` when `wrappers[rec.wrapper]` is missing, and the ONLY thing that
    // reaches the client is `unknown session <id>` — indistinguishable from a
    // reaped session. `claude-dev0` was absent here for its entire life, so
    // chat was dead for every dev0 session and the fleet list still showed them
    // idle, because `assembleFleet` never consults this map.
    //
    // Pinning the SET (not just the members) is what makes adding a 6th account
    // a deliberate two-line act: `~/.local/bin/claude-dev0` exists on the fleet
    // host and sets `CLAUDE_CONFIG_DIR`, and nothing else in this repo would
    // have noticed it was missing.
    expect(Object.keys(loadConfig({ CCRC_HOME: '/fake/home' }).wrappers).sort())
      .toEqual(['claude', 'claude-corp', 'claude-dev0', 'claude2', 'gpt']);
  });

  // Increment 1a (docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md):
  // `wrappers` is now DERIVED from `shared/api.ts`'s `ACCOUNTS` roster rather
  // than a second hand-typed literal beside it, so the literal set pinned
  // above and the roster's own key set can never legally diverge — this is
  // the test that would catch it if they somehow did (a member added to one
  // without the other, past a refactor that broke the derivation).
  it('wraps exactly the ACCOUNTS roster\'s key set — no more, no fewer', () => {
    expect(Object.keys(loadConfig({ CCRC_HOME: '/fake/home' }).wrappers).sort())
      .toEqual(Object.keys(ACCOUNTS).sort());
  });

  it('derives coordDbPath from CCRC_HOME by default, and honours CCRC_COORD_DB as an override', () => {
    // The precedent this pins is `fleetstate.test.ts`'s `defaultCachePath`
    // check: without an assertion HERE, a rename in `defaultCoordDbPath` (or a
    // typo in the `CCRC_COORD_DB` key) goes green everywhere — no test imports
    // the helper and none asserts `cfg.coordDbPath`.
    expect(loadConfig({ CCRC_HOME: '/fake/home' }).coordDbPath).toBe('/fake/home/.ccrc/coord.db');
    expect(loadConfig({ CCRC_HOME: '/fake/home', CCRC_COORD_DB: '/elsewhere/coord.db' }).coordDbPath)
      .toBe('/elsewhere/coord.db');
  });

  it('derives mailTokenPath from CCRC_HOME by default, and honours CCRC_MAIL_TOKEN_PATH as an override', () => {
    // Same precedent as the `coordDbPath` check above, for the same reason:
    // without an assertion HERE, a rename in the `.ccrc/mail.token` literal
    // (or a typo in the `CCRC_MAIL_TOKEN_PATH` key) goes green everywhere —
    // `readMailToken` reads nothing, `mailToken` is `null`, and
    // `checkMailToken(null, …)` accepts every caller. Fix-round finding
    // 4(a): this exact gap was named as the one construct in this task with
    // no test anywhere in the repo.
    expect(loadConfig({ CCRC_HOME: '/fake/home' }).mailTokenPath).toBe('/fake/home/.ccrc/mail.token');
    expect(loadConfig({ CCRC_HOME: '/fake/home', CCRC_MAIL_TOKEN_PATH: '/elsewhere/mail.token' }).mailTokenPath)
      .toBe('/elsewhere/mail.token');
  });

  it('honours env overrides', () => {
    const cfg = loadConfig({ CCRC_HOME: '/h', CCRC_HOST: '203.0.113.7', CCRC_PORT: '9000', CCRC_PROJECTS_ROOT: '/data/projects' });
    expect(cfg.host).toBe('203.0.113.7');
    expect(cfg.port).toBe(9000);
    expect(cfg.projectsRoot).toBe('/data/projects');
  });

  it('defaults fleetMode to local with no agent/hetzner config', () => {
    const cfg = loadConfig({ CCRC_HOME: '/h' });
    expect(cfg.fleetMode).toBe('local');
    expect(cfg.agentUrl).toBeNull();
    expect(cfg.agentToken).toBeNull();
    expect(cfg.hetznerToken).toBeNull();
    expect(cfg.fleetServerId).toBeNull();
  });

  it('CCRC_FLEET=remote plus agent/hetzner env vars populate the remote fleet config', () => {
    const cfg = loadConfig({
      CCRC_HOME: '/h',
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
    const cfg = loadConfig({ CCRC_HOME: '/h', CCRC_FLEET: 'bogus' });
    expect(cfg.fleetMode).toBe('local');
  });
});

describe('configDirFor — the ONE place a wrapper becomes a directory', () => {
  it('joins a known wrapper\'s configDirSuffix onto the given home', () => {
    expect(configDirFor('/fake/home', 'claude2')).toBe('/fake/home/.claude-personal');
    expect(configDirFor('/fake/home', 'claude-dev0')).toBe('/fake/home/.claude-dev0');
  });

  // `SessionRecord.wrapper` is an untrusted string read off disk (registry
  // fixtures write `'ghost-wrapper'` on purpose — see pr-sweep.test.ts's
  // archiveSafety tests) — `configDirFor` must answer `undefined`, not throw
  // and not silently build a path under a wrapper that doesn't exist.
  it('answers undefined for a wrapper ACCOUNTS does not have, rather than fabricating a path', () => {
    expect(configDirFor('/fake/home', 'ghost-wrapper')).toBeUndefined();
    expect(configDirFor('/fake/home', '')).toBeUndefined();
  });
});

describe('mungePath', () => {
  it('replaces / . _ with - (ccd cmd_swap rule)', () => {
    expect(mungePath('/data/projects/orchard-api')).toBe('-data-projects-orchard-api');
    expect(mungePath('/data/projects/foo/.claude/worktrees/ui')).toBe('-data-projects-foo--claude-worktrees-ui');
    expect(mungePath('/a/b_c.d')).toBe('-a-b-c-d');
  });
});
