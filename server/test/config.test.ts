import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
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

  // The postmortem `configDirFor`'s own docstring names, applied here at the
  // level `loadConfig`'s caller actually sees it: `claude-dev0` was missing
  // from the map `configDirFor` reads, for its entire life, because that map
  // used to be a hand-typed literal kept BESIDE the roster rather than
  // derived FROM it (`resolve()` in `sessionws.ts` returned null; the client
  // only ever saw "unknown session" — indistinguishable from a reaped one).
  // NOTE what this test does and does not prove: its expectation is derived
  // from `cfg.roster.accounts` itself, the same list it iterates, so on its
  // own it cannot catch a roster member silently missing a mapping (it would
  // pass identically for a roster of any size, including a shrunk one). What
  // it DOES prove is that `configDirFor` resolves EVERY entry the roster
  // claims to have, not merely a hardcoded subset of ids — the fixed
  // five-account SET is pinned separately, by the sibling test above
  // ('loads the roster...'), which is where a 6th account silently missing
  // its mapping would actually be caught.
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
    // Same two-step shape as roster.test.ts's own `refuses %s` table: throws
    // RosterError AND carries a non-empty remedy — `toThrow(RosterError)`
    // alone passed against a mutant that replaced the remedy with `''`.
    expect(() => loadConfig({ CCRC_HOME: home })).toThrow(RosterError);
    try {
      loadConfig({ CCRC_HOME: home });
    } catch (e) {
      expect((e as RosterError).remedy).toBeTruthy();
    }
  });

  // Companion to the malformed-roster case above, on the OTHER side of
  // `loadRoster`'s two try/catches: `'{"version":1,"accounts":[]}'` is valid
  // JSON that `parseRoster` rejects, so it never reaches the `JSON.parse`
  // catch at all. This fixture is invalid JSON itself (an operator's
  // trailing comma after hand-editing the file — the likeliest real-world
  // shape of this failure) so it actually exercises that second arm.
  it('refuses to boot when accounts.json is not valid JSON, naming the remedy', () => {
    const home = mkTmp('cfg-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(
      path.join(home, '.ccrc', 'accounts.json'),
      '{\n  "version": 1,\n  "accounts": [\n    {"id": "claude"},\n  ]\n}\n',
    );
    expect(() => loadConfig({ CCRC_HOME: home })).toThrow(RosterError);
    try {
      loadConfig({ CCRC_HOME: home });
    } catch (e) {
      expect((e as RosterError).remedy).toBeTruthy();
    }
  });

  it('refuses to boot when accounts.json is absent, rather than running an empty roster', () => {
    const home = mkTmp('cfg-');
    expect(() => loadConfig({ CCRC_HOME: home })).toThrow(/accounts\.json/);
    try {
      loadConfig({ CCRC_HOME: home });
    } catch (e) {
      expect((e as RosterError).remedy).toBeTruthy();
      expect((e as RosterError).remedy).toMatch(/ccrc install/);
    }
  });

  // Finding 2 (fix round 1): MISSING and UNREADABLE must not collapse to the
  // same remedy — a `chmod 000` file plainly EXISTS, and sending the operator
  // to `ccrc install` (which would not touch, let alone fix, a permissions
  // problem) is actively misleading. Root reads through any mode bit, so this
  // cannot discriminate when the suite runs as root (CI does not; the fleet
  // host does not) — same guard, same reasoning, as `coord-token.test.ts`'s
  // identical `chmod 000` case.
  it.skipIf(process.getuid?.() === 0)(
    'refuses to boot with a DISTINCT remedy when accounts.json exists but cannot be read, never claiming ' +
    'it is missing', () => {
      const home = mkTmp('cfg-');
      mkdirSync(path.join(home, '.ccrc'), { recursive: true });
      const p = path.join(home, '.ccrc', 'accounts.json');
      writeFileSync(p, JSON.stringify(DEFAULT_TEST_ROSTER));
      chmodSync(p, 0o000);
      try {
        expect(() => loadConfig({ CCRC_HOME: home })).toThrow(RosterError);
        try {
          loadConfig({ CCRC_HOME: home });
        } catch (e) {
          const err = e as RosterError;
          expect(err.message).not.toMatch(/no account roster at/);
          expect(err.remedy).not.toMatch(/ccrc install/);
          expect(err.remedy).toMatch(/permission/i);
        }
      } finally {
        chmodSync(p, 0o644); // restore — afterAll's recursive rm needs to read/unlink it
      }
    },
  );

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

  // Spec §2 (docs/superpowers/specs/2026-08-11-ccrc-oss-single-dev-infra-design.md):
  // "the three disagreeing projects-root definitions ($HOME/projects,
  // /data/projects, /srv/projects) reconcile to one
  // configured CCRC_PROJECTS_ROOT" — the agent and ccd already default to
  // `$HOME/projects` (an unconfigured box, e.g. a fresh install); this server
  // default was the lone holdout at `/data/projects`, a path specific to the
  // reference fleet's own volume layout. The live production box is
  // unaffected: its `~/.ccrc/ccrc.env` sets `CCRC_PROJECTS_ROOT` explicitly,
  // so this default is never reached there.
  it('defaults projectsRoot to $HOME/projects when CCRC_PROJECTS_ROOT is unset (spec §2)', () => {
    const cfg = loadConfig({ CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH });
    expect(cfg.projectsRoot).toBe(path.join('/h', 'projects'));
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

  // ── the WebAuthn relying party (Task 8) ────────────────────────────────

  it('defaults the relying party to localhost, with the origin built from the SAME port', () => {
    // The default is deliberately one that cannot silently work in production:
    // a credential enrolled under `localhost` is RECORDED with `localhost`
    // (`credentials.ts`), so a box that later gets a real name refuses it
    // loudly ("re-enrol") instead of failing an opaque signature check.
    const cfg = loadConfig({ CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH });
    expect(cfg.rpId).toBe('localhost');
    expect(cfg.origin).toBe('http://localhost:7788');
    expect(cfg.passkeysPath).toBe(path.join('/h', '.ccrc', 'passkeys.json'));
  });

  it('the default origin follows CCRC_PORT — one port, not two that can drift', () => {
    const cfg = loadConfig({ CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH, CCRC_PORT: '9001' });
    expect(cfg.port).toBe(9001);
    expect(cfg.origin).toBe('http://localhost:9001');
  });

  it('takes CCRC_RP_ID / CCRC_ORIGIN / CCRC_PASSKEYS_PATH as written', () => {
    const cfg = loadConfig({
      CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH,
      CCRC_RP_ID: 'tailnet-example.ts.net',
      CCRC_ORIGIN: 'https://server-box.tailnet-example.ts.net',
      CCRC_PASSKEYS_PATH: '/elsewhere/keys.json',
    });
    expect(cfg.rpId).toBe('tailnet-example.ts.net');
    expect(cfg.origin).toBe('https://server-box.tailnet-example.ts.net');
    expect(cfg.passkeysPath).toBe('/elsewhere/keys.json');
  });

  it('a BARE `CCRC_RP_ID=` line reads as unset, not as the empty domain', () => {
    // The house `||` vs `??` rule (`accountsPath`, :185-191): that is exactly
    // how `deploy/ccrc.env.example` ships a key whose default lives in this
    // file. With `??` the ceremony would be handed `rpId: ''`, which every
    // browser refuses with an opaque SecurityError and no server-side trace —
    // and `origin: ''`, which no `clientDataJSON.origin` could ever equal.
    const cfg = loadConfig({
      CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH,
      CCRC_RP_ID: '', CCRC_ORIGIN: '', CCRC_PASSKEYS_PATH: '',
    });
    expect(cfg.rpId).toBe('localhost');
    expect(cfg.origin).toBe('http://localhost:7788');
    expect(cfg.passkeysPath).toBe(path.join('/h', '.ccrc', 'passkeys.json'));
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
  // production accounts exactly — a drift here would desync dozens of tests
  // from what it silently changes. Doubly so since Task 6 deleted
  // `shared/api.ts`'s `ACCOUNTS`: this fixture is now the tree's only
  // TypeScript copy of those names, and `single-definition.test.ts`'s roster
  // scanner reads its own hunt list out of it.
  it('mirrors the five production accounts, in roster declaration order', () => {
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
