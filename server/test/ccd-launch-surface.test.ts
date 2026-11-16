// server/test/ccd-launch-surface.test.ts
//
// Overlord W1 sandbox, Task 3 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md`; spec §3.6 H1; slugs
// expected-digest-rides-the-route and surfaced-profile-fails-closed): while the route carries `profiledigest`, ccd checks
// that the row `profile` names hashes to it (`_profile_digest_ok`) and renders the row's surface whole (flags, settings,
// remote control, CCRC_LAUNCH_PROFILE and CCRC_LAUNCH_RC), or refuses the spawn with no pane and one journal line. A route
// without the field takes W1a's path, fail-open included (`ccd-launch-profile.test.ts` pins that path, Review Focus 1).
// The substrate is that suite's: `_spawn_start` in a fixture HOME with tmux recorded, both resume lines, the fleet pins.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { committedDigest } from './sim/launchProfileSets.js';
import { FLEET_ROLES } from '../../shared/fleetRoles.js';

const ID = 'lane-a-project-a';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const DIGEST = committedDigest('overlord');
const PROFILES = path.resolve(__dirname, '../../ccd/lib/launch-profiles.json');
const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-launch-surface-'); });
afterEach(() => { h.cleanup(); });

/** The row's workspace: a git repository of its own (PR A2's workspace step links into it and writes its exclude file). */
const wsDir = (): string => path.join(h.home, 'projects', 'overlord');
const seed = (route: readonly (readonly [string, string])[]): void => {
  fs.mkdirSync(wsDir(), { recursive: true });
  execFileSync('git', ['-C', wsDir(), 'init', '-q']);
  h.sh(`_reg_set ${ID} wrapper claude
        _reg_set ${ID} workdir '${wsDir()}'
        _reg_set ${ID} uuid ${UUID}
        ${route.map(([f, v]) => `_reg_set ${ID} ${f} '${v}'`).join('\n        ')}`);
};
const OVERLORD: readonly (readonly [string, string])[] = [['profile', 'overlord'], ['profiledigest', DIGEST]];
/** `_spawn_start` with `mode`; the tmux new-session lines, the status, stderr and the journal. */
const spawn = (mode: 'new' | 'resume', pre = ''): { lines: string[]; status: number | null; err: string; journal: string[] } => {
  h.sh(`rm -f "$HOME/ccd-calls" "$HOME/pane-up"`);
  const r = spawnSync('bash', ['-c', 'a_src=$A_SRC a_snip=$A_SNIP; unset A_SRC A_SNIP; source "$a_src"; eval "$a_snip"'], {
    env: ghContainedEnv(h.home, { ...h.env(), A_SRC: CCD, A_SNIP: `${RESUME_DIES} ${pre} _spawn_start ${ID} ${mode}` }, { systemd: true, tmux: true, net: true }),
    cwd: h.home, encoding: 'utf8',
  });
  const log = path.join(h.home, '.cc-sessions', 'swap.log');
  const journal = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.includes('launch-profile-refused')) : [];
  return { lines: h.calls().filter((c) => c.startsWith('tmux new-session')), status: r.status, err: r.stderr, journal };
};
const settingsOf = (l: string): Record<string, any> => {
  const all = [...l.matchAll(/--settings '([^']*)'/g)].map((m) => m[1] as string);
  expect(all, l).toHaveLength(1);
  return JSON.parse(all[0]!) as Record<string, any>;
};
/** A doctored copy of the committed profiles file, named to ccd through `LAUNCH_PROFILES_JSON` (a snippet prefix). */
const altFile = (edit: (rows: Record<string, any>) => unknown): string => {
  const f = path.join(h.home, 'alt-profiles.json');
  const out = edit(JSON.parse(fs.readFileSync(PROFILES, 'utf8')) as Record<string, any>);
  fs.writeFileSync(f, typeof out === 'string' ? out : JSON.stringify(out));
  return `LAUNCH_PROFILES_JSON='${f}';`;
};
/** The digest ccd computes over the doctored file's overlord row: real `jq -cS`, hashed here. */
const altDigest = (): string => createHash('sha256')
  .update(execFileSync('jq', ['-cS', '.overlord', path.join(h.home, 'alt-profiles.json')], { encoding: 'utf8' })).digest('hex');
const rcOn = (): void => { fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true }); fs.writeFileSync(path.join(h.home, '.ccrc', 'remote-control'), 'on\n'); };
const route = (args: string, pre = ''): { status: number; out: string } => {
  try {
    const out = execFileSync('bash', ['-c', `source "${CCD}"; exec 2>&1; ${pre} cmd_route ${args}`],
      { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

describe('a standing profiledigest renders the overlord surface whole (Review Focus 2)', () => {
  it('carries every flag, the merged deny rules and hooks, no remote control with the box file on, and the launch variables, on both resume lines', () => {
    rcOn();
    seed(OVERLORD);
    const { lines, status } = spawn('resume');
    expect(status).toBe(0);
    expect(lines).toHaveLength(2);
    const row = JSON.parse(fs.readFileSync(PROFILES, 'utf8')).overlord as { flags: string[]; surfaceSettings: { hooks: Record<string, unknown> } };
    for (const l of lines) {
      const words = row.flags.map((w, i) => (row.flags[i - 1] === '--agents' ? `'${w}'` : w)).join(' ');
      expect(l).toContain(` ${words} `);
      expect(l).not.toContain('--remote-control');
      expect(l).toContain(` CCRC_LAUNCH_PROFILE=overlord:${DIGEST} `);
      expect(l).toContain(' CCRC_LAUNCH_RC=off ');
      const s = settingsOf(l);
      expect(s.permissions.deny).toEqual(expect.arrayContaining(FLEET_ROLES.overlord.launchProfile.surface!.deny as string[]));
      expect(Object.keys(s.hooks).sort()).toStrictEqual(Object.keys(row.surfaceSettings.hooks).sort());
      expect(s.statusLine).toStrictEqual({ type: 'command', command: 'bash "$HOME/.claude/statusline-command.sh"' });
    }
  });
  it('the merged settings carry crossSessionInbound refuse, from the fleet pin and the row, which agree', () => {
    seed(OVERLORD);
    const l = spawn('new').lines[0]!;
    expect(settingsOf(l).crossSessionInbound).toBe('refuse');
    expect(FLEET_ROLES.overlord.launchProfile.settings.crossSessionInbound).toBe('refuse');
  });
  it('CCRC_LAUNCH_RC reads the final flags: on when the row keeps remote control', () => {
    rcOn();
    seed(OVERLORD);
    const pre = altFile((rows) => { rows.overlord.remoteControl = 'on'; return rows; });
    const doctored = JSON.parse(fs.readFileSync(path.join(h.home, 'alt-profiles.json'), 'utf8')).overlord;
    const d = altDigest();
    h.sh(`_reg_set ${ID} profiledigest '${d}'`);
    const l = spawn('new', pre).lines[0]!;
    expect(doctored.remoteControl).toBe('on');
    expect(l).toContain(`--remote-control '${ID}'`);
    expect(l).toContain(' CCRC_LAUNCH_RC=on ');
  });
  it('a row with an empty field reads its fields in place (the unit separator keeps an empty env)', () => {
    seed(OVERLORD);
    const f = path.join(h.home, 'alt-profiles.json');
    const pre = altFile((rows) => { rows.overlord.env = {}; rows.overlord.autoMemory = 'switch'; return rows; });
    const d = altDigest();
    h.sh(`_reg_set ${ID} profiledigest '${d}'; _reg_set ${ID} automem on`);
    const l = spawn('new', pre).lines[0]!;
    expect(l).toContain(' --tools Agent,Skill ');
    expect(l).toContain(` CCRC_LAUNCH_PROFILE=overlord:${d} `);
    expect(l).not.toContain('CLAUDE_CODE_DISABLE_AUTO_MEMORY');
  });
});

describe('each failure refuses the spawn: no pane, one journal line naming its reason, rc 1 (Review Focus 2; review 2135 F8)', () => {
  const OTHER = 'f'.repeat(64);
  const NO_ROW = 'row overlord does not hash to profiledigest';
  const NO_PROFILE = 'profile absent or unreadable';
  const cases: [string, readonly (readonly [string, string])[], (() => string) | string, string][] = [
    ['an unreadable profiles file', OVERLORD, () => `LAUNCH_PROFILES_JSON='${path.join(h.home, 'nope.json')}';`, 'launch profiles unreadable'],
    ['a missing row', OVERLORD, () => altFile((rows) => { delete rows.overlord; return rows; }), NO_ROW],
    ['a digest that differs', [['profile', 'overlord'], ['profiledigest', OTHER]], '', NO_ROW],
    ['a profile field of a bad shape', [['profile', 'Not A Row'], ['profiledigest', DIGEST]], '', NO_PROFILE],
    ['a standing digest with profile absent', [['profiledigest', DIGEST]], '', NO_PROFILE],
    ['a profile field present but unreadable (a directory)', [['profiledigest', DIGEST]], `mkdir "$REG/${ID}.profile";`, NO_PROFILE],
  ];
  for (const [name, r, pre, why] of cases) {
    it(name, () => {
      seed(r);
      const out = spawn('new', typeof pre === 'string' ? pre : pre());
      expect(out.status).not.toBe(0);
      expect(out.lines).toStrictEqual([]);
      expect(out.journal).toHaveLength(1);
      expect(out.journal[0]).toContain(`launch-profile-refused ${ID}: ${why} — no pane started`);
    });
  }
  const MALFORMED = 'row overlord malformed';
  const doctored: [string, (rows: Record<string, any>) => unknown, string][] = [
    ['a malformed flag word', (rows) => { rows.overlord.flags[1] = 'project;rm'; return rows; }, MALFORMED],
    ['an agents value carrying a single quote', (rows) => { rows.overlord.flags[6] = "{'x'}"; return rows; }, MALFORMED],
    ['an agents value carrying a control character (a newline)', (rows) => { rows.overlord.flags[6] = '{"x":\n1}'; return rows; }, MALFORMED],
    ['an agents value carrying the unit separator', (rows) => { rows.overlord.flags[6] = '{"x":\u001f1}'; return rows; }, MALFORMED],
    ['a settings merge that fails (a quote in a hook command)', (rows) => { rows.overlord.surfaceSettings.statusLine.command = "it's"; return rows; }, 'settings merge failed'],
  ];
  for (const [name, edit, why] of doctored) {
    it(name, () => {
      seed([['profile', 'overlord']]);
      const pre = altFile(edit);
      const d = altDigest();
      h.sh(`_reg_set ${ID} profiledigest '${d}'`);
      const out = spawn('new', pre);
      expect(out.status).not.toBe(0);
      expect(out.lines).toStrictEqual([]);
      expect(out.journal).toHaveLength(1);
      expect(out.journal[0]).toContain(`launch-profile-refused ${ID}: ${why} — no pane started`);
    });
  }
  it('a surfaced spawn reads the profiles file once: it renders the row the digest covered (review 2135 F7)', () => {
    seed(OVERLORD);
    const log = path.join(h.home, 'jq-reads');
    const out = spawn('new', `jq() { local a; for a in "$@"; do [[ "$a" == "$LAUNCH_PROFILES_JSON" ]] && echo x >> '${log}'; done; command jq "$@"; };`);
    expect(out.status).toBe(0);
    expect(out.lines).toHaveLength(1);
    expect(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
  });
});

describe('the workspace entries and the workspace refusal (PR A2, Task 6; question 2, slug workspace-links-for-skill-and-constitution)', () => {
  const SKILL = '.claude/skills/ccrc-overlord';
  const exclude = (): string[] => fs.readFileSync(path.join(wsDir(), '.git', 'info', 'exclude'), 'utf8').split('\n').filter((l) => l.startsWith('/'));
  const linkOf = (rel: string): string => fs.readlinkSync(path.join(wsDir(), rel));
  const refused = (out: ReturnType<typeof spawn>, why: string): void => {
    expect(out.status).not.toBe(0);
    expect(out.lines).toStrictEqual([]);
    expect(out.journal).toHaveLength(1);
    expect(out.journal[0]).toContain(`launch-profile-refused ${ID}: ${why}`);
  };
  it('a first spawn links the staged skill and the constitution, and excludes both names once', () => {
    seed(OVERLORD);
    expect(spawn('new').lines).toHaveLength(1);
    expect(linkOf(SKILL)).toBe(path.join(h.home, '.cc-sessions', 'overlord-skill'));
    expect(linkOf('CLAUDE.md')).toBe(path.join(h.home, '.cc-sessions', 'lib', 'overlord-constitution.md'));
    expect(exclude().sort()).toStrictEqual([`/${SKILL}`, '/CLAUDE.md']);
  });
  it('a respawn finds its own links and makes nothing new', () => {
    seed(OVERLORD);
    spawn('new');
    const before = fs.lstatSync(path.join(wsDir(), 'CLAUDE.md')).ino;
    expect(spawn('resume').status).toBe(0);
    expect(fs.lstatSync(path.join(wsDir(), 'CLAUDE.md')).ino).toBe(before);
    expect(exclude().sort()).toStrictEqual([`/${SKILL}`, '/CLAUDE.md']);
  });
  it('the check every move asks writes nothing; only the spawn (make) links and excludes (fix round 1 F1)', () => {
    seed(OVERLORD);
    h.sh(`_profile_launch_ok ${ID}`);
    expect(fs.existsSync(path.join(wsDir(), 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(wsDir(), '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(wsDir(), '.git', 'info', 'exclude')) ? exclude() : []).toStrictEqual([]);
    h.sh(`_profile_launch_ok ${ID} make`);
    expect(linkOf('CLAUDE.md')).toBe(path.join(h.home, '.cc-sessions', 'lib', 'overlord-constitution.md'));
    expect(exclude().sort()).toStrictEqual([`/${SKILL}`, '/CLAUDE.md']);
  });
  it('a route without profiledigest makes no entry (Review Focus 1)', () => {
    seed([['profile', 'overlord']]);
    expect(spawn('new').status).toBe(0);
    expect(fs.existsSync(path.join(wsDir(), '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(wsDir(), 'CLAUDE.md'))).toBe(false);
  });
  const planted: [string, (ws: string) => void, string][] = [
    ['a CLAUDE.md that is a regular file', (ws) => fs.writeFileSync(path.join(ws, 'CLAUDE.md'), 'mine\n'), 'CLAUDE.md is not ccd\'s link'],
    ['a skill link that points elsewhere', (ws) => { fs.mkdirSync(path.join(ws, '.claude', 'skills'), { recursive: true }); fs.symlinkSync('/elsewhere', path.join(ws, SKILL)); }, `${SKILL} is not ccd's link`],
    ...['settings.json', 'settings.local.json', 'agents/a.md', 'commands/c.md', 'hooks/h.sh', 'rules/r.md', 'other'].map((rel) =>
      [`.claude/${rel}`, (ws: string) => { fs.mkdirSync(path.dirname(path.join(ws, '.claude', rel)), { recursive: true }); fs.writeFileSync(path.join(ws, '.claude', rel), '{}\n'); }, 'a project source stands'] as [string, (ws: string) => void, string]),
    ['a second skill beside ccd\'s', (ws) => fs.mkdirSync(path.join(ws, '.claude', 'skills', 'mine'), { recursive: true }), 'a project source stands'],
    ['.mcp.json', (ws) => fs.writeFileSync(path.join(ws, '.mcp.json'), '{}\n'), 'a project source stands'],
    ['CLAUDE.local.md', (ws) => fs.writeFileSync(path.join(ws, 'CLAUDE.local.md'), 'x\n'), 'a project source stands'],
    ['a nested CLAUDE.md', (ws) => { fs.mkdirSync(path.join(ws, 'sub'), { recursive: true }); fs.writeFileSync(path.join(ws, 'sub', 'CLAUDE.md'), 'x\n'); }, 'a project source stands'],
    ['a nested .claude', (ws) => { fs.mkdirSync(path.join(ws, 'sub', '.claude'), { recursive: true }); }, 'a project source stands'],
    ['a .claude that is a link to a directory holding settings', (ws) => { const d = path.join(ws, '..', 'elsewhere'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'settings.json'), '{}\n'); fs.symlinkSync(d, path.join(ws, '.claude')); }, 'a project source stands: .claude'],
    ['a linked directory, which find does not follow', (ws) => { const d = path.join(ws, '..', 'elsewhere'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'CLAUDE.md'), 'x\n'); fs.symlinkSync(d, path.join(ws, 'sub')); }, 'a project source stands: sub'],
    ['a linked .claude/skills', (ws) => { const d = path.join(ws, '..', 'skills'); fs.mkdirSync(path.join(d, 'mine'), { recursive: true }); fs.mkdirSync(path.join(ws, '.claude'), { recursive: true }); fs.symlinkSync(d, path.join(ws, '.claude', 'skills')); }, 'a project source stands: .claude/skills'],
    ['a CLAUDE.md in a directory above the workspace', (ws) => fs.writeFileSync(path.join(ws, '..', 'CLAUDE.md'), 'x\n'), 'a CLAUDE.md stands above the workspace'],
    ['a CLAUDE.local.md in a directory above the workspace', (ws) => fs.writeFileSync(path.join(ws, '..', '..', 'CLAUDE.local.md'), 'x\n'), 'a CLAUDE.md stands above the workspace'],
  ];
  for (const [name, plant, why] of planted) {
    it(`refuses, with no pane and no new entry: ${name}`, () => {
      seed(OVERLORD);
      plant(wsDir());
      refused(spawn('new'), why);
      expect(fs.existsSync(path.join(wsDir(), '.git', 'info', 'exclude')) ? exclude() : []).toStrictEqual([]);
    });
  }
  it('a file under .git is not a project source (the bounded find prunes .git)', () => {
    seed(OVERLORD);
    fs.writeFileSync(path.join(wsDir(), '.git', 'CLAUDE.md'), 'x\n');
    expect(spawn('new').lines).toHaveLength(1);
  });
  it('refuses a workspace that is not a git repository (no exclude file to write)', () => {
    seed(OVERLORD);
    fs.rmSync(path.join(wsDir(), '.git'), { recursive: true });
    refused(spawn('new'), 'the workspace is not its own repository');
  });
  it('refuses a linked worktree, whose exclude file is the parent repository\'s, and writes nothing there (fix round 1 F5)', () => {
    seed(OVERLORD);
    const parent = path.join(h.home, 'projects', 'parent');
    const wt = path.join(h.home, 'projects', 'overlord-wt');
    fs.mkdirSync(parent, { recursive: true });
    execFileSync('git', ['-C', parent, 'init', '-q']);
    execFileSync('git', ['-C', parent, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'x']);
    execFileSync('git', ['-C', parent, 'worktree', 'add', '-q', wt]);
    h.sh(`_reg_set ${ID} workdir '${wt}'`);
    refused(spawn('new'), 'the workspace is not its own repository: .git is not a directory');
    const ex = path.join(parent, '.git', 'info', 'exclude');
    expect(fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8').split('\n').filter((l) => l.startsWith('/')) : []).toStrictEqual([]);
    expect(fs.existsSync(path.join(wt, 'CLAUDE.md'))).toBe(false);
  });
  it('a workspace reached through a link is walked through it: a source behind the link refuses (fix round 1 F3)', () => {
    seed(OVERLORD);
    const via = path.join(h.home, 'projects', 'overlord-via');
    fs.symlinkSync(wsDir(), via);
    fs.writeFileSync(path.join(wsDir(), '.mcp.json'), '{}\n');
    h.sh(`_reg_set ${ID} workdir '${via}'`);
    refused(spawn('new'), 'a project source stands: .mcp.json');
  });
  for (const [name, wd] of [['a relative workdir', 'projects/overlord'], ['a workdir with a trailing slash', 'TRAILING']] as const) {
    it(`refuses ${name} before the walk above it (fix round 1 F4)`, () => {
      seed(OVERLORD);
      h.sh(`_reg_set ${ID} workdir '${wd === 'TRAILING' ? `${wsDir()}/` : wd}'`);
      refused(spawn('new'), 'workspace entries could not be made');
      expect(fs.existsSync(path.join(wsDir(), 'CLAUDE.md'))).toBe(false);
    });
  }
  const shapes: [string, (rows: Record<string, any>) => unknown][] = [
    ['a skill name of a bad shape', (rows) => { rows.overlord.stagedSkills = { 'Bad Name': 'overlord-skill' }; return rows; }],
    ['a skill target with a .. segment', (rows) => { rows.overlord.stagedSkills = { 'ccrc-overlord': '../overlord-skill' }; return rows; }],
    ['an absolute memory target', (rows) => { rows.overlord.memory = '/etc/passwd'; return rows; }],
    ['a memory target with a .. segment', (rows) => { rows.overlord.memory = 'lib/../../x.md'; return rows; }],
  ];
  for (const [name, edit] of shapes) {
    it(`refuses ${name} (fed through a doctored profiles file), making nothing`, () => {
      seed([['profile', 'overlord']]);
      const pre = altFile(edit);
      h.sh(`_reg_set ${ID} profiledigest '${altDigest()}'`);
      refused(spawn('new', pre), 'workspace entries could not be made');
      expect(fs.existsSync(path.join(wsDir(), 'CLAUDE.md'))).toBe(false);
      expect(fs.existsSync(path.join(wsDir(), '.claude'))).toBe(false);
    });
  }
});

describe('no field, no change (Review Focus 1)', () => {
  it('the same overlord route without profiledigest spawns as W1a does: no surface, fail-open on a missing row', () => {
    seed([['profile', 'overlord']]);
    const ok = spawn('new');
    expect(ok.status).toBe(0);
    expect(ok.lines[0]).not.toContain('--tools');
    expect(ok.lines[0]).not.toContain('CCRC_LAUNCH_PROFILE');
    const missing = spawn('new', altFile((rows) => { delete rows.overlord; return rows; }));
    expect(missing.status).toBe(0);
    expect(missing.lines).toHaveLength(1);
    expect(missing.journal).toStrictEqual([]);
    expect(missing.err).toContain('spawning without it');
  });
});

describe('the route field (Task 3)', () => {
  it('the route verb accepts a 64-hex profiledigest and refuses any other value', () => {
    seed([]);
    expect(route(`--session ${ID} --set profiledigest=${DIGEST}`).status).toBe(0);
    expect(h.reg(ID, 'profiledigest')).toBe(DIGEST);
    for (const v of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'overlord']) {
      expect(route(`--session ${ID} --set profiledigest=${v}`).status, v).not.toBe(0);
    }
  });
  it('an empty value clears it', () => {
    seed([['profiledigest', DIGEST]]);
    expect(route(`--session ${ID} --set profiledigest=`).status).toBe(0);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.profiledigest`))).toBe(false);
  });
  it('_route_any does not count a row whose only fields are profile and profiledigest as routed', () => {
    seed(OVERLORD);
    expect(spawnSync('bash', ['-c', `source "${CCD}"; _route_any ${ID}`], { env: ghContainedEnv(h.home, h.env(), { systemd: true, tmux: true }), cwd: h.home }).status).toBe(1);
    h.sh(`_reg_set ${ID} effort high`);
    expect(spawnSync('bash', ['-c', `source "${CCD}"; _route_any ${ID}`], { env: ghContainedEnv(h.home, h.env(), { systemd: true, tmux: true }), cwd: h.home }).status).toBe(0);
  });
});
