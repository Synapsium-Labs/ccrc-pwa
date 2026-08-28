// `ccrc uninstall` / `ccrc backup` / `ccrc logs` — stage 4, Task 8 (spec §7).
// Uninstall moves a box OFF ccrc to a state where reinstall is safe: it
// refuses while live sessions exist (unless --force), removes the units
// (incl. both drop-ins and the slice escape), removes ccrc's managed
// settings.json hook entries through the installer's OWN predicate (unmanaged
// entries survive byte-identically, each rewritten file backed up first),
// removes marker-verified wrappers ONLY (`shared/mark.mjs` — a marker-less
// file with a wrapper's name survives), removes ccrc's own artifacts inside
// `~/.cc-sessions` file-by-file (registry rows and operator switches stay),
// and removes `~/ccrc` and the executables. It PRESERVES `~/.ccrc` whole,
// worktrees and backups; `--purge` additionally removes `~/.ccrc` and
// `~/ccrc-backups` — never worktrees, never tmux state. `backup` is update's
// step 2 standalone with `CCRC_BACKUP_KEEP` pruning; `logs` is a thin,
// role-aware journalctl passthrough.
//
// ── THE HARNESS ───────────────────────────────────────────────────────────
// `ccrc-update.test.ts`'s box idiom, trimmed to this file's needs and COPIED
// rather than imported (importing a .test.ts registers its whole suite —
// build-release.test.ts's stated reason). Everything runs against a throwaway
// $HOME; systemctl and journalctl are RECORDING stubs (no real systemd, no
// real journal, ever); tmux is a POISON — uninstall must never reach for it.
// The verbs run from the CHECKOUT's ccrc, so `$CCRC_HERE` resolves the REAL
// `install-session-hooks.sh`, `ccrc-wrapper-shape` and `shared/mark.mjs` —
// the predicate and the marker under test are the shipped ones, not copies.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
// The REAL marker writer — the wrapper fixtures below carry exactly the
// marker `verifyMarker` recognises, so the "marker-verified only" gate is
// measured against the shipped format, never a test's re-spelling of it.
import { markGenerated } from '../../shared/mark.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

function realPath(name: string): string {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
}
const BASH = realPath('bash');

interface Result { code: number; stdout: string; stderr: string }

/** Recorders and poisons on the fixture PATH. systemctl RECORDS and answers
 *  the two shapes uninstall asks (`disable --now`, `daemon-reload`);
 *  journalctl RECORDS (the `logs` passthrough pin); tmux is a poison —
 *  neither verb has any business near a pane. */
function verbEnv(home: string): NodeJS.ProcessEnv {
  const env = ghContainedEnv(home, { ...process.env, HOME: home });
  const plant = (name: string, body: string): void =>
    writeFileSync(join(home, '.local', 'bin', name), body, { mode: 0o755 });
  plant('tmux',
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/tmux-poison"\n'
    + 'echo "ccrc uninstall/backup/logs must never touch tmux" >&2\nexit 97\n');
  plant('systemctl', [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/systemctl-calls"',
    '[ "$1" = "--user" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    'shift',
    'case "$1" in',
    '  daemon-reload) exit 0 ;;',
    '  disable) [ "$2" = "--now" ] && [ -n "$3" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }; exit 0 ;;',
    'esac',
    'echo "fixture systemctl: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  plant('journalctl',
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/journalctl-argv"\nexit 0\n');
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_RELEASE_BASE_URL',
    'CCRC_BACKUP_KEEP', 'CCRC_ROLE']) delete env[k];
  return env;
}

const MANAGED_HOOK = { type: 'command', command: 'bash "$HOME/.cc-sessions/session-hook.sh"' };
const UNMANAGED_ENTRY = { hooks: [{ type: 'command', command: 'echo my-own-stop-hook' }] };
/** Hand-formatted on purpose (extra spaces): if uninstall rewrites this file
 *  at all, the bytes change and the byte-identity assertion goes red. */
const UNMANAGED_ONLY_SETTINGS =
  '{   "hooks": { "Stop": [ {"hooks":[{"type":"command","command":"echo mine"}]} ] },'
  + '  "note": "hand-formatted, no managed entry"  }\n';

/** A box `ccrc install` (or a deploy) has converged: the tree, the bins, the
 *  units + both drop-in dirs, the ~/.ccrc config, ccrc's ~/.cc-sessions
 *  artifacts, two account homes with settings.json, three wrapper-named
 *  files (marked / marker-less / the upstream ELF), a worktree, an old
 *  backup, and a keep-aside pair. */
function plantInstalledBox(home: string): void {
  // The shipped tree and the three executables.
  mkdirSync(join(home, 'ccrc', 'server', 'dist'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'server', 'dist', 'index.js'), '// the installed dist\n');
  mkdirSync(join(home, 'ccrc', 'ccd'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'ccd', 'ccrc'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  mkdirSync(join(home, 'ccrc', 'agent', 'dist'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'agent', 'dist', 'index.js'), '// agent dist\n');
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'ccd'), '#!/bin/sh\n# the installed ccd\n', { mode: 0o755 });
  writeFileSync(join(bin, 'ccrc'), '#!/bin/sh\n# the launcher\n', { mode: 0o755 });
  writeFileSync(join(bin, 'ccd-cap-scopes'), '#!/bin/sh\n# cap scopes\n', { mode: 0o755 });
  // graphify Task 10/fix-round F2: the fourth `_inst_bins` executable.
  writeFileSync(join(bin, 'ccd-graph-sweep'), '#!/bin/sh\n# graph sweep\n', { mode: 0o755 });
  // The units, both drop-in dirs and the slice escape (its literal \x2d name).
  const units = join(home, '.config', 'systemd', 'user');
  mkdirSync(join(units, 'claude-session@.service.d'), { recursive: true });
  mkdirSync(join(units, 'app-claude\\x2dsession.slice.d'), { recursive: true });
  for (const u of ['ccrc.service', 'ccrc-agent.service', 'claude-session@.service',
    'ccd-cap-scopes.service', 'ccd-cap-scopes.timer',
    // graphify Task 10 (O3/O6b): the sweep pair, mirroring cap-scopes.
    'ccd-graph-sweep.service', 'ccd-graph-sweep.timer']) {
    writeFileSync(join(units, u), `[Unit]\nDescription=fixture ${u}\n`);
  }
  writeFileSync(join(units, 'claude-session@.service.d', 'limits.conf'), '[Service]\n');
  writeFileSync(join(units, 'app-claude\\x2dsession.slice.d', 'limits.conf'), '[Slice]\n');
  // ~/.ccrc — the user-owned side, which uninstall PRESERVES (spec §7).
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=both\n');
  writeFileSync(join(home, '.ccrc', 'build.json'),
    '{"sha":"fixturesha000000000000000000000000000000","ref":"main",'
    + '"builtAt":"2026-08-21T00:00:00Z","dirty":false}\n');
  writeFileSync(join(home, '.ccrc', 'accounts.json'), '{"fixture":"roster"}\n');
  writeFileSync(join(home, '.ccrc', 'accounts.sh'), [
    '# fixture projection — just enough for install-session-hooks.sh',
    'CCRC_ACCOUNTS=(claude2 claude3)',
    '_ccrc_cfg_dir() {',
    '  case "$1" in',
    '    claude2) printf \'%s\' "$HOME/.claude-claude2" ;;',
    '    claude3) printf \'%s\' "$HOME/.claude-claude3" ;;',
    '  esac',
    '}',
    '',
  ].join('\n'));
  // ccrc's artifacts in ~/.cc-sessions, beside a registry row and an
  // operator switch that MUST survive.
  const reg = join(home, '.cc-sessions');
  mkdirSync(join(reg, 'coordinator-skill'), { recursive: true });
  mkdirSync(join(reg, 'worker-skill'), { recursive: true });
  writeFileSync(join(reg, 'session-hook.sh'), '#!/bin/sh\n# hook\n', { mode: 0o755 });
  writeFileSync(join(reg, 'install-session-hooks.sh'), '#!/bin/sh\n# old installed copy\n', { mode: 0o755 });
  writeFileSync(join(reg, 'notify.sh'), '#!/bin/sh\n# notify\n', { mode: 0o755 });
  writeFileSync(join(reg, 'install-coordinator-skill.sh'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(reg, 'install-worker-skill.sh'), '#!/bin/sh\n', { mode: 0o755 });
  // graphify Task 3: `_inst_graphify_skill` stages this beside the other two
  // installers, the same lane `_uninst_cc_sessions` must remove it from.
  writeFileSync(join(reg, 'install-graphify-skill.sh'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(reg, 'coordinator-skill', 'SKILL.md'), '# the coordinator skill\n');
  writeFileSync(join(reg, 'worker-skill', 'SKILL.md'), '# the worker skill\n');
  // Two account homes. claude2: one managed entry per event shape the
  // installer writes, one unmanaged entry, a CUSTOM statusLine. claude3:
  // no managed entry at all, hand-formatted.
  mkdirSync(join(home, '.claude-claude2'), { recursive: true });
  writeFileSync(join(home, '.claude-claude2', 'settings.json'), JSON.stringify({
    hooks: {
      Stop: [{ hooks: [MANAGED_HOOK] }, UNMANAGED_ENTRY],
      PreToolUse: [{ matcher: '*', hooks: [MANAGED_HOOK] }],
    },
    statusLine: { type: 'command', command: 'my-custom-statusline' },
  }, null, 2) + '\n');
  mkdirSync(join(home, '.claude-claude3'), { recursive: true });
  writeFileSync(join(home, '.claude-claude3', 'settings.json'), UNMANAGED_ONLY_SETTINGS);
  // Three wrapper-named files: MARKED (exactly what ccrc last wrote),
  // marker-less (somebody's hand-written launcher), and the upstream binary.
  writeFileSync(join(bin, 'claude2'), markGenerated(
    '#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR="$HOME/.claude-claude2"\n'
    + 'exec "$HOME/.local/bin/claude" "$@"\n'), { mode: 0o755 });
  writeFileSync(join(bin, 'claude3'),
    '#!/usr/bin/env bash\n# hand-written launcher — NOT ccrc\'s\nexec /usr/bin/claude "$@"\n',
    { mode: 0o755 });
  writeFileSync(join(bin, 'claude'),
    '\x7fELF\x02\x01\x01\x00not-a-real-binary-just-a-fixture-marker', { mode: 0o755 });
  // A worktree, an existing backup, and the keep-aside pair.
  mkdirSync(join(home, 'worktrees', 'fixture-ws'), { recursive: true });
  writeFileSync(join(home, 'worktrees', 'fixture-ws', 'work.txt'), 'a session\'s work\n');
  mkdirSync(join(home, 'ccrc-backups', '20250101-000000'), { recursive: true });
  writeFileSync(join(home, 'ccrc-backups', '20250101-000000', 'ccd'), '# an old backup\n');
  writeFileSync(join(home, '.tmux.conf'), '# the shipped tmux.conf\n');
  writeFileSync(join(home, '.tmux.conf.pre-ccrc-20260101T000000Z'), '# the operator\'s own\n');
}

function runVerb(home: string, verb: string, args: string[] = [],
  extraEnv: NodeJS.ProcessEnv = {}): Result {
  const env = { ...verbEnv(home), ...extraEnv };
  const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), verb, ...args],
    { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A REAL sqlite coord.db, so `backup-coord.mjs`'s VACUUM INTO runs. */
function plantCoordDb(home: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  const db = new DatabaseSync(join(home, '.ccrc', 'coord.db'));
  db.exec('CREATE TABLE fixture (x INTEGER); INSERT INTO fixture VALUES (42);');
  db.close();
}

const settingsOf = (home: string, acct: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(home, `.claude-${acct}`, 'settings.json'), 'utf8')) as Record<string, unknown>;

describe('ccrc uninstall: the argument surface', () => {
  it('-h prints usage on STDOUT at exit 0 — a verb with flags explains them', () => {
    const home = mkTmp('ccrc-uninst-help-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall', ['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/usage: ccrc \{/);
    expect(existsSync(join(home, 'ccrc')), 'help removed the tree').toBe(true);
  });

  it('an unknown argument is a usage error, exit 2, before anything is removed', () => {
    const home = mkTmp('ccrc-uninst-badarg-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall', ['--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --bogus/m);
    expect(existsSync(join(home, 'ccrc'))).toBe(true);
    expect(existsSync(join(home, 'systemctl-calls'))).toBe(false);
  });
});

describe('ccrc uninstall: the live-session gate', () => {
  it('refuses while live sessions exist — exit 1, names the count and --force, removes NOTHING', () => {
    const home = mkTmp('ccrc-uninst-live-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.cc-sessions', 'alpha.uuid'), 'fixture-uuid\n');
    writeFileSync(join(home, '.cc-sessions', 'beta.uuid'), 'fixture-uuid\n');
    const r = runVerb(home, 'uninstall');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/2 live ccd session/);
    expect(r.stderr).toMatch(/--force/);
    // Nothing was removed and no unit was touched: the gate runs FIRST.
    expect(existsSync(join(home, 'ccrc'))).toBe(true);
    expect(existsSync(join(home, '.local', 'bin', 'ccd'))).toBe(true);
    expect(existsSync(join(home, '.local', 'bin', 'claude2'))).toBe(true);
    expect(existsSync(join(home, '.config', 'systemd', 'user', 'ccrc.service'))).toBe(true);
    expect(existsSync(join(home, 'systemctl-calls'))).toBe(false);
  });

  it('--force proceeds past live sessions, and the registry rows themselves still survive', () => {
    const home = mkTmp('ccrc-uninst-force-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.cc-sessions', 'alpha.uuid'), 'fixture-uuid\n');
    const r = runVerb(home, 'uninstall', ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
    expect(existsSync(join(home, '.cc-sessions', 'alpha.uuid')),
      '--force removed a live registry row').toBe(true);
  });

  it('zero sessions need no --force', () => {
    const home = mkTmp('ccrc-uninst-zero-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
  });
});

describe('ccrc uninstall: the remove set (spec §7)', () => {
  it('units: disable --now, delete every unit file incl. both drop-ins and the slice escape, daemon-reload — recording stub only', () => {
    const home = mkTmp('ccrc-uninst-units-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    const units = join(home, '.config', 'systemd', 'user');
    for (const u of ['ccrc.service', 'ccrc-agent.service', 'claude-session@.service',
      'ccd-cap-scopes.service', 'ccd-cap-scopes.timer',
      // graphify Task 10 (O3/O6b): the sweep pair, mirroring cap-scopes.
      'ccd-graph-sweep.service', 'ccd-graph-sweep.timer']) {
      expect(existsSync(join(units, u)), `${u} survived`).toBe(false);
    }
    expect(existsSync(join(units, 'claude-session@.service.d'))).toBe(false);
    expect(existsSync(join(units, 'app-claude\\x2dsession.slice.d'))).toBe(false);
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8')
      .split('\n').filter((l) => l !== '');
    expect(calls).toContain('--user disable --now ccrc.service');
    expect(calls).toContain('--user disable --now ccrc-agent.service');
    expect(calls).toContain('--user disable --now ccd-cap-scopes.timer');
    expect(calls).toContain('--user disable --now ccd-graph-sweep.timer');
    expect(calls[calls.length - 1]).toBe('--user daemon-reload');
    // The sacred rule holds even here: no claude-session@ instance is ever a
    // systemctl target, and tmux is never touched (poison would have fired).
    expect(calls.join('\n')).not.toMatch(/claude-session@/);
    expect(existsSync(join(home, 'tmux-poison'))).toBe(false);
  });

  it('settings.json: managed entries go through the installer\'s own predicate, unmanaged entries and the custom statusLine survive, the rewritten file is backed up first', () => {
    const home = mkTmp('ccrc-uninst-hooks-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    const s = settingsOf(home, 'claude2');
    const hooks = s['hooks'] as Record<string, unknown[]>;
    // The managed Stop entry is gone; the operator's own survives, deep-equal.
    expect(hooks['Stop']).toEqual([UNMANAGED_ENTRY]);
    // PreToolUse held ONLY the managed entry — swept empty, the key is dropped.
    expect(hooks['PreToolUse']).toBeUndefined();
    // The custom statusLine is not ccrc's to remove.
    expect(s['statusLine']).toEqual({ type: 'command', command: 'my-custom-statusline' });
    // The per-file backup, in install-session-hooks.sh's own shape.
    const backups = readdirSync(join(home, 'ccrc-backups'))
      .filter((d) => d !== '20250101-000000');
    expect(backups.length).toBe(1);
    expect(readdirSync(join(home, 'ccrc-backups', backups[0]!)))
      .toContain('.claude-claude2.settings.json');
  });

  it('a settings.json with NO managed entry is not rewritten — byte-identical, hand formatting and all', () => {
    const home = mkTmp('ccrc-uninst-hooks-noop-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, '.claude-claude3', 'settings.json'), 'utf8'))
      .toBe(UNMANAGED_ONLY_SETTINGS);
  });

  it('wrappers: removes ONLY the marker-verified file — a marker-less file with a wrapper\'s name survives byte-identically, and so does the upstream binary', () => {
    const home = mkTmp('ccrc-uninst-wrappers-');
    plantInstalledBox(home);
    const foreign = readFileSync(join(home, '.local', 'bin', 'claude3'), 'utf8');
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.local', 'bin', 'claude2')),
      'the marker-verified wrapper survived').toBe(false);
    expect(readFileSync(join(home, '.local', 'bin', 'claude3'), 'utf8'),
      'the hand-written launcher was touched').toBe(foreign);
    expect(existsSync(join(home, '.local', 'bin', 'claude')),
      'the upstream binary was removed').toBe(true);
    expect(r.stdout).toMatch(/uninstall: wrappers: removed .*claude2/);
  });

  it('a marked-but-edited wrapper is KEPT and named — the edit is the operator\'s work', () => {
    const home = mkTmp('ccrc-uninst-edited-');
    plantInstalledBox(home);
    const p = join(home, '.local', 'bin', 'claude2');
    writeFileSync(p, readFileSync(p, 'utf8') + '# an operator\'s edit\n', { mode: 0o755 });
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(p)).toBe(true);
    expect(r.stdout).toMatch(/uninstall: wrappers: kept .*claude2.*edited/);
  });

  it('~/.cc-sessions: ccrc\'s own artifacts go file-by-file; registry rows and operator switches stay', () => {
    const home = mkTmp('ccrc-uninst-sessions-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.cc-sessions', 'alpha.uuid'), 'fixture-uuid\n');
    writeFileSync(join(home, '.cc-sessions', 'coordinator-paused'), 'operator switch\n');
    writeFileSync(join(home, '.cc-sessions', 'mail-disabled'), 'operator switch\n');
    const r = runVerb(home, 'uninstall', ['--force']);
    expect(r.code, r.stderr).toBe(0);
    for (const f of ['session-hook.sh', 'install-session-hooks.sh', 'notify.sh',
      'install-coordinator-skill.sh', 'install-worker-skill.sh', 'install-graphify-skill.sh',
      'coordinator-skill', 'worker-skill']) {
      expect(existsSync(join(home, '.cc-sessions', f)), `${f} survived`).toBe(false);
    }
    for (const f of ['alpha.uuid', 'coordinator-paused', 'mail-disabled']) {
      expect(existsSync(join(home, '.cc-sessions', f)), `${f} was removed`).toBe(true);
    }
  });

  it('graphify skills: skills/graphify is removed from every rostered home, while OTHER skills there survive', () => {
    // `_uninst_graphify_skills` (graphify Task 3) — beside `_uninst_cc_sessions`
    // in the sweep, but a DIFFERENT lane: the assembled skill lives one level
    // down, in each rostered home's own `skills/graphify`, never under
    // `~/.cc-sessions`. A dummy `skills/ccrc-worker` in the same directory is
    // the proof the sweep is scoped to the one name, not a directory wipe.
    const home = mkTmp('ccrc-uninst-graphify-skills-');
    plantInstalledBox(home);
    for (const acct of ['claude2', 'claude3']) {
      const skills = join(home, `.claude-${acct}`, 'skills');
      mkdirSync(join(skills, 'graphify', 'references'), { recursive: true });
      writeFileSync(join(skills, 'graphify', 'SKILL.md'), '# the graphify skill\n');
      writeFileSync(join(skills, 'graphify', '.graphify_version'), '0.9.9');
      mkdirSync(join(skills, 'ccrc-worker'), { recursive: true });
      writeFileSync(join(skills, 'ccrc-worker', 'SKILL.md'), '# the worker skill (dummy)\n');
    }
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    for (const acct of ['claude2', 'claude3']) {
      const skills = join(home, `.claude-${acct}`, 'skills');
      expect(existsSync(join(skills, 'graphify')), `${acct}: graphify survived`).toBe(false);
      expect(existsSync(join(skills, 'ccrc-worker', 'SKILL.md')),
        `${acct}: an unrelated skill was swept too`).toBe(true);
    }
    expect(r.stdout).toMatch(/^uninstall: graphify skills: removed from 2 account home\(s\)/m);
  });

  it('the tree and the executables go; ~/.ccrc, worktrees and backups are PRESERVED without --purge', () => {
    const home = mkTmp('ccrc-uninst-preserve-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
    // graphify Task 10/fix-round F2: `ccd-graph-sweep` joins the set — an
    // uninstall that removed its units (`_uninst_units`) and left the binary
    // orphaned it on PATH forever, exactly the defect this test already
    // existed to catch for the other three.
    for (const b of ['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep']) {
      expect(existsSync(join(home, '.local', 'bin', b)), `${b} survived`).toBe(false);
    }
    // The preserve set, whole.
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(true);
    expect(existsSync(join(home, '.ccrc', 'ccrc.env'))).toBe(true);
    expect(existsSync(join(home, 'worktrees', 'fixture-ws', 'work.txt'))).toBe(true);
    expect(existsSync(join(home, 'ccrc-backups', '20250101-000000', 'ccd'))).toBe(true);
    expect(existsSync(join(home, '.tmux.conf'))).toBe(true);
  });

  it('keep-asides: the restore commands are PRINTED and the files untouched', () => {
    const home = mkTmp('ccrc-uninst-keepaside-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    const saved = join(home, '.tmux.conf.pre-ccrc-20260101T000000Z');
    expect(r.stdout).toContain(`mv ${saved} ${join(home, '.tmux.conf')}`);
    expect(readFileSync(saved, 'utf8')).toBe('# the operator\'s own\n');
    expect(readFileSync(join(home, '.tmux.conf'), 'utf8')).toBe('# the shipped tmux.conf\n');
  });

  it('--purge removes ~/.ccrc and ~/ccrc-backups — and NEVER worktrees', () => {
    const home = mkTmp('ccrc-uninst-purge-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall', ['--purge']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'worktrees', 'fixture-ws', 'work.txt')),
      '--purge ate a worktree').toBe(true);
    expect(existsSync(join(home, 'tmux-poison'))).toBe(false);
  });
});

describe('ccrc backup: update\'s step 2 standalone, with CCRC_BACKUP_KEEP pruning', () => {
  it('takes the same set to the same directory shape: coord.db snapshot, dists, ccd, units', () => {
    const home = mkTmp('ccrc-backup-set-');
    plantInstalledBox(home);
    plantCoordDb(home);
    const r = runVerb(home, 'backup');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const m = /^backup: (\S+)/m.exec(r.stdout);
    expect(m, `no "backup:" line in:\n${r.stdout}`).not.toBeNull();
    const dir = m![1]!;
    expect(dir.startsWith(join(home, 'ccrc-backups') + '/')).toBe(true);
    // A real snapshot (VACUUM INTO writes a database), the ccd, a unit, a dist.
    const snap = readFileSync(join(dir, 'coord.db'));
    expect(snap.subarray(0, 15).toString('utf8')).toBe('SQLite format 3');
    expect(readFileSync(join(dir, 'ccd'), 'utf8'))
      .toBe(readFileSync(join(home, '.local', 'bin', 'ccd'), 'utf8'));
    expect(existsSync(join(dir, 'ccrc.service'))).toBe(true);
    expect(existsSync(join(dir, 'server-dist', 'index.js'))).toBe(true);
    expect(existsSync(join(dir, 'agent-dist', 'index.js'))).toBe(true);
  });

  it('prunes to the newest CCRC_BACKUP_KEEP timestamped dirs — hand-made siblings survive', () => {
    const home = mkTmp('ccrc-backup-prune-');
    plantInstalledBox(home);
    for (const ts of ['20250101-000000', '20250102-000000', '20250103-000000']) {
      mkdirSync(join(home, 'ccrc-backups', ts), { recursive: true });
    }
    mkdirSync(join(home, 'ccrc-backups', 'pre-flip-agent-dist'), { recursive: true });
    writeFileSync(join(home, 'ccrc-backups', 'pre-flip-agent-dist', 'keep.txt'), 'hand-made\n');
    const r = runVerb(home, 'backup', [], { CCRC_BACKUP_KEEP: '2' });
    expect(r.code, r.stderr).toBe(0);
    const left = readdirSync(join(home, 'ccrc-backups')).sort();
    // This run's own dir (newest) + the newest planted one + the sibling.
    expect(left).toContain('pre-flip-agent-dist');
    expect(left).toContain('20250103-000000');
    expect(left).not.toContain('20250101-000000');
    expect(left).not.toContain('20250102-000000');
    expect(left.length).toBe(3);
  });
});

describe('ccrc logs: a thin, role-aware journalctl passthrough', () => {
  it('defaults to ccrc.service and passes -f / -n through — the recorded argv is the pin', () => {
    const home = mkTmp('ccrc-logs-server-');
    plantInstalledBox(home);
    const r = runVerb(home, 'logs', ['-f', '-n', '50']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, 'journalctl-argv'), 'utf8').trim())
      .toBe('--user -u ccrc.service -f -n 50');
  });

  it('CCRC_ROLE=fleet in ccrc.env selects ccrc-agent.service', () => {
    const home = mkTmp('ccrc-logs-fleet-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=fleet\n');
    const r = runVerb(home, 'logs');
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, 'journalctl-argv'), 'utf8').trim())
      .toBe('--user -u ccrc-agent.service');
  });

  it('-n without a value is a usage error, exit 2, and journalctl never ran', () => {
    const home = mkTmp('ccrc-logs-badn-');
    plantInstalledBox(home);
    const r = runVerb(home, 'logs', ['-n']);
    expect(r.code).toBe(2);
    expect(existsSync(join(home, 'journalctl-argv'))).toBe(false);
  });
});
