import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { seedAccountsSh } from './ccdWsHelpers.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-session-hooks.sh');

// The MEASURED real-world shape (2026-08-05): SessionStart with a compact
// matcher + a matcher-less entry, SessionEnd; one home carries an extra
// cloneme SessionEnd entry. The installer must preserve every byte of these.
const EXISTING = {
  hooks: {
    SessionStart: [
      { matcher: 'compact', hooks: [{ type: 'command', command: '/home/u/.cc-handoff/restore.sh' }] },
      { hooks: [{ type: 'command', command: "'/home/u/.claude/skills/code-usage/scripts/cron-upload.sh' --hook" }] },
    ],
    SessionEnd: [
      { hooks: [{ type: 'command', command: "'/home/u/.claude/skills/code-usage/scripts/cron-upload.sh' --hook" }] },
      { hooks: [{ type: 'command', command: '/home/u/.cloneme/cloneme-session-end.sh' }] },
    ],
  },
  statusLine: { type: 'command', command: 'bash "$HOME/.claude/statusline-command.sh"' },
};

let home: string;
const cfg = (d: string): string => path.join(home, d, 'settings.json');
beforeEach(() => {
  home = mkTmp('ccrc-hookinstall-');
  for (const d of ['.claude', '.claude-personal']) {
    fs.mkdirSync(path.join(home, d), { recursive: true });
    fs.writeFileSync(cfg(d), JSON.stringify(EXISTING, null, 2));
  }
  fs.mkdirSync(path.join(home, 'ccrc-backups'), { recursive: true });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const run = (...args: string[]): void => {
  execFileSync('bash', [INSTALLER, '--homes', path.join(home, '.claude'), path.join(home, '.claude-personal'), ...args],
    { env: { ...process.env, HOME: home } });
};

describe('install-session-hooks', () => {
  it('registers the nine measured events and preserves existing entries byte-identically', () => {
    run();
    const s = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    for (const ev of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest',
      'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact']) {
      const entries = s.hooks[ev] as any[];
      expect(entries.some((e) => e.hooks?.some((h: any) => String(h.command).includes('/session-hook.sh'))),
        ev).toBe(true);
    }
    // PreToolUse carries matcher '*'; the managed entries and nothing else.
    const pre = (s.hooks.PreToolUse as any[]).find((e) => e.hooks?.[0]?.command?.includes('/session-hook.sh'));
    expect(pre.matcher).toBe('*');
    // Every pre-existing entry survives exactly.
    expect(s.hooks.SessionStart).toEqual(EXISTING.hooks.SessionStart);
    expect(s.hooks.SessionEnd).toEqual(EXISTING.hooks.SessionEnd);
    expect(s.statusLine).toEqual(EXISTING.statusLine);
  });
  it('re-running converges (second run is a byte no-op)', () => {
    run();
    const first = fs.readFileSync(cfg('.claude'), 'utf8');
    run();
    expect(fs.readFileSync(cfg('.claude'), 'utf8')).toBe(first);
  });
  it('sweeps a stale managed entry with an old path (filename match, not exact command)', () => {
    const s = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    s.hooks.Stop = [{ hooks: [{ type: 'command', command: 'bash /old/place/session-hook.sh' }] }];
    fs.writeFileSync(cfg('.claude'), JSON.stringify(s));
    run();
    const after = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    const stops = (after.hooks.Stop as any[]).filter((e) =>
      e.hooks?.some((h: any) => String(h.command).includes('session-hook.sh')));
    expect(stops).toHaveLength(1);
    expect(stops[0].hooks[0].command).not.toContain('/old/place/');
  });
  it('refuses a home whose settings.json is broken JSON, touching nothing — but still processes the other home in the same run', () => {
    fs.writeFileSync(cfg('.claude-personal'), '{broken');
    expect(() => run()).toThrow();
    expect(fs.readFileSync(cfg('.claude-personal'), 'utf8')).toBe('{broken');
    const s = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    expect(s.hooks.Stop.some((e: any) => e.hooks?.some((h: any) => String(h.command).includes('/session-hook.sh'))))
      .toBe(true);
  });
  it('a home with NO settings.json gets one with only the managed hooks', () => {
    fs.rmSync(cfg('.claude-personal'));
    run();
    const s = JSON.parse(fs.readFileSync(cfg('.claude-personal'), 'utf8'));
    expect(Object.keys(s)).toEqual(['hooks']);
  });
  it('backs up every settings.json it rewrites', () => {
    run();
    const backups = fs.readdirSync(path.join(home, 'ccrc-backups'));
    expect(backups.length).toBeGreaterThan(0);
  });
});

describe('install-session-hooks.sh default homes are the roster, behaviourally', () => {
  // The installer no longer carries a literal home list to pin: it sources the
  // same generated `~/.ccrc/accounts.sh` ccd does and installs into every
  // account's config dir. So this is now the ONLY test of that default — the
  // source-text pin in wrapper-roster-fixture.test.ts parsed a
  // `homes=(...)` line that no longer exists — and it is the stronger of the
  // two anyway: it RUNS the installer with no --homes argv (its real default)
  // against a fixture HOME holding a config dir for every rostered account.
  //
  // There is no `hooksAble` subset any more, which is why the expectation is a
  // flat `true` rather than a per-account flag. That concept only ever meant
  // "in the hand-kept array", and its point — a sixth account that the array
  // forgot, the silent mail hole `claude-dev0` had — is now impossible by
  // construction rather than caught by a comparison.
  let rosterHome: string;
  beforeEach(() => {
    rosterHome = mkTmp('ccrc-hookinstall-roster-');
    seedAccountsSh(rosterHome);
    for (const a of DEFAULT_TEST_ROSTER.accounts) {
      fs.mkdirSync(path.join(rosterHome, a.configDirSuffix), { recursive: true });
    }
  });
  afterEach(() => { fs.rmSync(rosterHome, { recursive: true, force: true }); });

  it("touches every rostered account's config dir when given no --homes argv", () => {
    execFileSync('bash', [INSTALLER], { env: { ...process.env, HOME: rosterHome } });
    for (const a of DEFAULT_TEST_ROSTER.accounts) {
      const got = fs.existsSync(path.join(rosterHome, a.configDirSuffix, 'settings.json'));
      expect(got, a.id).toBe(true);
    }
  });

  it('refuses, naming the remedy, when the box has no roster at all', () => {
    const bare = mkTmp('ccrc-hookinstall-noroster-');
    try {
      expect(() => execFileSync('bash', [INSTALLER],
        { env: { ...process.env, HOME: bare }, stdio: 'pipe' })).toThrow(/no account roster/);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});
