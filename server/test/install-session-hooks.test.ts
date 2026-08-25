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
  // MUTATION RECORD (measured): dropping "SessionStart" from EVENTS_JSON
  // turns this red on the SessionStart iteration alone ("expected false to
  // be true // SessionStart") — session-hook.sh:62-73 handles the event
  // (the F1 fix), but a fresh box's converger never registered it. Restored
  // after confirming the red. Main found the same gap independently (D-306 (was D-B8-10))
  // and made the pairing a mechanism: the derived-set test below fails on any
  // divergence between EVENTS_JSON and the hook's own case arms.
  it('registers the ten measured events and preserves existing entries byte-identically', () => {
    run();
    const s = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    for (const ev of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest',
      'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'SessionStart']) {
      const entries = s.hooks[ev] as any[];
      expect(entries.some((e) => e.hooks?.some((h: any) => String(h.command).includes('/session-hook.sh'))),
        ev).toBe(true);
    }
    // PreToolUse carries matcher '*'; the managed entries and nothing else.
    const pre = (s.hooks.PreToolUse as any[]).find((e) => e.hooks?.[0]?.command?.includes('/session-hook.sh'));
    expect(pre.matcher).toBe('*');
    // Every pre-existing entry survives exactly. SessionStart carries foreign
    // entries (restore.sh under matcher 'compact', the code-usage upload) AND
    // now a managed one: D-306 wired the arm that had never run. The foreign
    // entries must come through untouched and in order, with ours appended —
    // and exactly ONE of ours (the length pin catches a double-append).
    expect(s.hooks.SessionStart.slice(0, EXISTING.hooks.SessionStart.length))
      .toEqual(EXISTING.hooks.SessionStart);
    expect(s.hooks.SessionStart).toHaveLength(EXISTING.hooks.SessionStart.length + 1);
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
    // The managed-entry sweep matches on filename inside .hooks[*].hooks[*].command
    // only; statusLine is a different top-level key holding a different command
    // string (no /session-hook.sh substring), so it cannot be caught by — or
    // swept as — a stale managed entry.
    expect(after.statusLine).toEqual(EXISTING.statusLine);
  });
  it('refuses a home whose settings.json is broken JSON, touching nothing — but still processes the other home in the same run', () => {
    fs.writeFileSync(cfg('.claude-personal'), '{broken');
    expect(() => run()).toThrow();
    expect(fs.readFileSync(cfg('.claude-personal'), 'utf8')).toBe('{broken');
    const s = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    expect(s.hooks.Stop.some((e: any) => e.hooks?.some((h: any) => String(h.command).includes('/session-hook.sh'))))
      .toBe(true);
  });
  it('a home with NO settings.json gets one with only the managed hooks and the seeded statusLine', () => {
    fs.rmSync(cfg('.claude-personal'));
    run();
    const s = JSON.parse(fs.readFileSync(cfg('.claude-personal'), 'utf8'));
    expect(Object.keys(s).sort()).toEqual(['hooks', 'statusLine']);
    expect(s.statusLine).toEqual({ type: 'command', command: 'bash "$HOME/.claude/statusline-command.sh"' });
  });
  it('backs up every settings.json it rewrites', () => {
    run();
    const backups = fs.readdirSync(path.join(home, 'ccrc-backups'));
    expect(backups.length).toBeGreaterThan(0);
  });

  // statusLine is load-bearing, not cosmetic: statusline-command.sh writes the
  // ~/.cc-limits telemetry ccd's auto-swap and server placement consume, and
  // ccd parses its ctx segment for auto-compact — but nothing in this repo has
  // ever WRITTEN the settings.json key that wires the script in. The reference
  // fleet's entries are hand-made history; a fresh box gets nothing without
  // this seed.
  it('seeds statusLine when absent, $HOME left literal-unexpanded like HOOK_CMD', () => {
    const s = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    delete s.statusLine;
    fs.writeFileSync(cfg('.claude'), JSON.stringify(s));
    run();
    const after = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    expect(after.statusLine).toEqual({ type: 'command', command: 'bash "$HOME/.claude/statusline-command.sh"' });
  });
  it('statusLine seeding is idempotent (second run is a byte no-op)', () => {
    const s = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    delete s.statusLine;
    fs.writeFileSync(cfg('.claude'), JSON.stringify(s));
    run();
    const first = fs.readFileSync(cfg('.claude'), 'utf8');
    run();
    expect(fs.readFileSync(cfg('.claude'), 'utf8')).toBe(first);
  });
  it('never overwrites an operator-customized statusLine (set-if-absent: converge-not-damage)', () => {
    run(); // converge hooks first, so a second run touches nothing but statusLine
    const custom = { type: 'command', command: 'python3 /custom/statusline.py' };
    const s = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    s.statusLine = custom;
    fs.writeFileSync(cfg('.claude'), JSON.stringify(s, null, 2));
    const before = fs.readFileSync(cfg('.claude'), 'utf8');
    run();
    // MUTATION RECORD (measured): deleting the `if has("statusLine") then .`
    // guard from JQ_PROGRAM (leaving only `.statusLine = {type:"command",
    // command:$sl}`) turns this red — the custom command is clobbered with the
    // default and the file is rewritten (no longer byte-identical). Restored
    // after confirming the red.
    expect(fs.readFileSync(cfg('.claude'), 'utf8')).toBe(before);
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

// D-306. The set of events session-hook.sh HANDLES was enumerated twice — as
// `case` arms in the hook, and as EVENTS_JSON in the installer — with nothing
// tying them together. They drifted: the hook grew a SessionStart arm (F1) that
// the installer never wired, so on the live fleet that arm was dead code for
// months. Measured 2026-08-19: 12 of 17 resumed sessions carried hookstate
// written BEFORE the boot that restarted them, and two sat at `state: 'working'`
// stamped by a process the reboot had destroyed.
//
// This is the mechanism, not a comment: it derives the expected set from the
// hook's own case arms and measures what the installer actually writes, so
// adding an arm without wiring it (or wiring one that does not exist) is red.
describe('installer wiring cannot drift from the hook it installs (D-306)', () => {
  const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');

  /** Every event session-hook.sh dispatches on, read from its `case` block. */
  const handledEvents = (): string[] => {
    const src = fs.readFileSync(HOOK, 'utf8');
    const block = /case\s+"\$event"\s+in\n([\s\S]*?)\nesac/.exec(src);
    expect(block, 'case "$event" in ... esac not found in session-hook.sh').toBeTruthy();
    const events = new Set<string>();
    for (const line of block![1].split('\n')) {
      const m = /^\s{2}([A-Za-z|]+)\)/.exec(line);
      if (m) for (const ev of m[1].split('|')) events.add(ev);
    }
    return [...events].sort();
  };

  it('wires exactly the events the hook handles — no more, no fewer', () => {
    run();
    const s = JSON.parse(fs.readFileSync(cfg('.claude'), 'utf8'));
    const wired = Object.entries(s.hooks as Record<string, any[]>)
      .filter(([, entries]) => entries.some((e) =>
        e.hooks?.some((h: any) => String(h.command).includes('/session-hook.sh'))))
      .map(([ev]) => ev).sort();
    expect(wired).toEqual(handledEvents());
  });

  it('the derivation is real: it reads SessionStart out of the hook source', () => {
    expect(handledEvents()).toContain('SessionStart');
    expect(handledEvents().length).toBeGreaterThanOrEqual(10);
  });
});
