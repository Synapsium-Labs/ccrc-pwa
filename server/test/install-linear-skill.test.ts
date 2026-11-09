// The `ccrc-linear` skill's install half (#1444, D-7674; spec 2026-10-31 §11, §12, §14 row 22), tested the way
// install-history-skill.test.ts tests its sibling: a fixture HOME, never the live one.
//
// THE START CARD DOES NOT CHANGE (D-7682 R6). The switch-over reaches every session through the installed skill and
// the program skills' sections, never through a SessionStart line, so the first describe below is a characterization
// written green on `main` before any of this work: the card a session is shown at start, byte for byte, for the three
// rows the hook distinguishes (a coordinator row, a held worker row and a dispatched child), and no card assignment in
// `ccd/session-hook.sh` that names Linear. The hook harness is COPIED from session-hook-role-card.test.ts, not
// imported (a test file cannot import another).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { seedAccountsSh } from './ccdWsHelpers.js';
import { healthy, linkReal, lineFor, runDoctor } from './ccrc-doctorFixture.js';

const REPO = path.resolve(__dirname, '../..');
const HOOK = path.join(REPO, 'ccd/session-hook.sh');

describe('the start card is byte for byte as on main: no Linear line (D-7682 R6; spec §14 row 22)', () => {
  const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
  const SID = '00000000-0000-4000-8000-000000000001';
  const ID = 'project-a-calm-mesa';
  let home: string;
  const reg = (): string => path.join(home, '.cc-sessions');
  beforeEach(() => {
    home = mkTmp('ccrc-linear-card-');
    fs.mkdirSync(reg(), { recursive: true });
    fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(home, 'work'), { recursive: true });
    fs.writeFileSync(path.join(reg(), `${ID}.generation`), GENERATION);
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
  });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  /** The hook's whole stdout for a startup SessionStart, the exit 0 of its header contract asserted. */
  const card = (): string => {
    const r = spawnSync('bash', [HOOK], {
      input: JSON.stringify({
        session_id: SID, transcript_path: path.join(home, 'cfg', 'projects', '-work', `${SID}.jsonl`),
        cwd: path.join(home, 'work'), hook_event_name: 'SessionStart', source: 'startup', model: 'claude-model-a',
      }),
      encoding: 'utf8',
      env: {
        ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
        TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
      },
    });
    expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
    return r.stdout;
  };
  const envelope = (context: string): string =>
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } })}\n`;

  it('a coordinator row (no `.child`, no hold) is shown the role sentence and nothing else', () => {
    expect(card()).toBe(envelope('ccrc-role: You are this project\'s coordinator from your first turn. Load the '
      + '`ccrc-coordinator` skill now, before anything else, and act as it says. When your work belongs to a programme, '
      + 'read its goals and definition of done in its ledger (`docs/superpowers/programs/<slug>.md`) before you plan or '
      + 'ask. Your children\'s questions and permission prompts come to you first; your own go to the operator.'));
  });

  it('a held worker row is shown the hold card and nothing else', () => {
    fs.writeFileSync(path.join(reg(), `${ID}.hold`), 'program:prog-a wave:1/2 run:7\n');
    expect(card()).toBe(envelope(`ccrc-program: this workspace is claimed — \`~/.cc-sessions/${ID}.hold\` reads `
      + '`program:prog-a wave:1/2 run:7`, which names a program and a wave — what the `ccrc-worker` skill is for. Run that '
      + `skill. Any brief sent to you is listed by \`~/.local/bin/ccrc-api mail list --to ${ID}\`, and one you already `
      + 'acked is not listed again — the plan it named is the durable record. The hold can outlive the run that wrote it: '
      + 'whether that run is still open, and whether any brief was sent, are answered only by `~/.local/bin/ccrc-api runs '
      + 'list`, never by this file.'));
  });

  it('a dispatched child is shown no card at all', () => {
    fs.writeFileSync(path.join(reg(), `${ID}.child`), 'run-a\n');
    expect(card()).toBe('');
  });

  it('no card assignment in the hook names Linear', () => {
    // Every line that assigns one of the card's parts (`CARD`, `CARD_GRAPH`, `CARD_HOLD`, `CARD_ROLE`, `CARD_CCRC` or
    // a part a later change adds), comments dropped. A Linear sentence added to any of them, on any row, reds here.
    const assigns = fs.readFileSync(HOOK, 'utf8').split('\n')
      .filter((l) => !/^\s*#/.test(l) && /\bCARD[A-Z_]*\+?=/.test(l));
    expect(assigns.length, 'the scan found no card assignment: the hook moved, or the scan broke').toBeGreaterThan(5);
    expect(assigns.filter((l) => /linear/i.test(l))).toEqual([]);
  });
});

// ── the installer: every rostered home carries `ccrc-linear` (spec §11, §12; §14 row 22) ─────────────────────────
// The fifth near-clone of install-coordinator-skill.sh, so the properties are its siblings': convergence,
// non-destruction and per-home isolation. The skill is every session's, whatever its role, so nothing here gates on
// a role: the homes are the roster's, all of them.
const HEAVY = 120_000;
const INSTALLER = path.join(REPO, 'ccd/install-linear-skill.sh');
const SRC = path.join(REPO, 'ccd/linear-skill');
const HOMES = ['.claude', '.claude-a', '.claude-b', '.claude-c'];

describe('install-linear-skill', () => {
  let home: string;
  const skill = (d: string, ...rest: string[]): string => path.join(home, d, 'skills', 'ccrc-linear', ...rest);
  beforeEach(() => {
    home = mkTmp('ccrc-linearskillinstall-');
    for (const d of HOMES) fs.mkdirSync(path.join(home, d), { recursive: true });
  });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });
  const run = (...homes: string[]): void => {
    execFileSync('bash', [INSTALLER, '--homes', ...(homes.length ? homes : HOMES.map((d) => path.join(home, d)))],
      { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: SRC }, stdio: 'pipe' });
  };

  it('installs the shipped tree, byte for byte, into every home it is given', () => {
    run();
    for (const d of HOMES) {
      expect(fs.readFileSync(skill(d, 'SKILL.md')), d).toEqual(fs.readFileSync(path.join(SRC, 'SKILL.md')));
      expect(fs.readdirSync(skill(d)).sort(), d).toEqual(fs.readdirSync(SRC).sort());
    }
  }, HEAVY);

  it('re-running converges: the second run rewrites nothing and takes no backup', () => {
    run();
    const before = fs.statSync(skill('.claude', 'SKILL.md'));
    run();
    const after = fs.statSync(skill('.claude', 'SKILL.md'));
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
    expect(fs.existsSync(path.join(home, 'ccrc-backups')), 'a converged re-run took a backup').toBe(false);
  }, HEAVY);

  it('replaces a stale SKILL.md and backs the old install up first', () => {
    run();
    fs.writeFileSync(skill('.claude', 'SKILL.md'), 'an older generation of the skill');
    run();
    expect(fs.readFileSync(skill('.claude', 'SKILL.md'), 'utf8')).toContain('name: ccrc-linear');
    const backups = fs.readdirSync(path.join(home, 'ccrc-backups'));
    expect(backups.length).toBeGreaterThan(0);
    expect(fs.readdirSync(path.join(home, 'ccrc-backups', backups[0]!)).some((n) => n.includes('ccrc-linear'))).toBe(true);
  }, HEAVY);

  it('skips a home that does not exist, and the missing home stays missing', () => {
    fs.rmSync(path.join(home, '.claude-c'), { recursive: true });
    run();
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.claude-c'))).toBe(false);
  }, HEAVY);

  it('refuses the whole run when the source has no SKILL.md, touching nothing', () => {
    const src = mkTmp('ccrc-linearskillsrc-');
    try {
      expect(() => execFileSync('bash', [INSTALLER, '--homes', path.join(home, '.claude')],
        { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: src }, stdio: 'pipe' })).toThrow(/no SKILL\.md under/);
      expect(fs.existsSync(path.join(home, '.claude', 'skills'))).toBe(false);
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
    }
  }, HEAVY);

  it('reports a failed home in the exit status but still processes the others', () => {
    const blocked = path.join(home, '.claude-b', 'skills');
    fs.mkdirSync(blocked, { recursive: true });
    fs.chmodSync(blocked, 0o500);
    let threw = false;
    try { run(); } catch { threw = true; }
    fs.chmodSync(blocked, 0o700);
    expect(threw).toBe(true);
    for (const d of ['.claude', '.claude-a', '.claude-c']) expect(fs.existsSync(skill(d, 'SKILL.md')), d).toBe(true);
  }, HEAVY);

  it('never writes outside the homes it was given', () => {
    run(path.join(home, '.claude'));
    for (const d of ['.claude-a', '.claude-b', '.claude-c']) expect(fs.existsSync(path.join(home, d, 'skills'))).toBe(false);
  }, HEAVY);
});

describe('install-linear-skill.sh default homes are the roster, every account whatever its role', () => {
  let rosterHome: string;
  beforeEach(() => {
    rosterHome = mkTmp('ccrc-linearskillinstall-roster-');
    seedAccountsSh(rosterHome);
    for (const a of DEFAULT_TEST_ROSTER.accounts) fs.mkdirSync(path.join(rosterHome, a.configDirSuffix), { recursive: true });
  });
  afterEach(() => { fs.rmSync(rosterHome, { recursive: true, force: true }); });

  it("touches every rostered account's config dir when given no --homes argv", () => {
    execFileSync('bash', [INSTALLER], { env: { ...process.env, HOME: rosterHome, CCRC_SKILL_SRC: SRC }, stdio: 'pipe' });
    expect(DEFAULT_TEST_ROSTER.accounts.length).toBeGreaterThan(1);
    for (const a of DEFAULT_TEST_ROSTER.accounts) {
      expect(fs.existsSync(path.join(rosterHome, a.configDirSuffix, 'skills', 'ccrc-linear', 'SKILL.md')), a.id).toBe(true);
    }
  }, HEAVY);

  it('refuses, naming the remedy, when the box has no roster at all', () => {
    const bare = mkTmp('ccrc-linearskillinstall-noroster-');
    try {
      expect(() => execFileSync('bash', [INSTALLER],
        { env: { ...process.env, HOME: bare, CCRC_SKILL_SRC: SRC }, stdio: 'pipe' })).toThrow(/no account roster/);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  }, HEAVY);
});

describe('the skill triggers on any Linear work (spec §11)', () => {
  it('its frontmatter is a name and a description, and the description names Linear issues and tickets', () => {
    const md = fs.readFileSync(path.join(SRC, 'SKILL.md'), 'utf8');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(md);
    expect(front, 'SKILL.md has no frontmatter').not.toBeNull();
    const lines = front![1]!.split('\n');
    expect(lines.map((l) => l.slice(0, l.indexOf(':')))).toEqual(['name', 'description']);
    expect(lines[0]).toBe('name: ccrc-linear');
    const desc = lines[1]!;
    for (const w of ['Linear issue', 'ticket', 'read', 'search', 'file', 'update', 'comment', 'teams', 'statuses',
      'projects', 'labels', 'users']) {
      expect(desc, `the description does not name ${w}`).toContain(w);
    }
    // Every session's, so it carries no "never inside a subagent" or role restriction the program skills carry.
    expect(desc).not.toMatch(/coordinat|worker|reviewer|subagent/i);
  });
});

describe('the deploy ships the linear skill too: the fleet lane', () => {
  // install-history-skill.test.ts's idiom with this skill's tokens. The rsync line is located by the FIRST line in the
  // arm that spells the skill's directory with a trailing slash, which is why no comment in the arm may carry it.
  const deploy = fs.readFileSync(path.join(REPO, 'deploy/deploy.sh'), 'utf8');
  const agentArm = deploy.slice(deploy.indexOf('if [ "$TARGET" = "agent" ]'), deploy.indexOf('\nelse\n'));
  const RUN = 'bash ~/.cc-sessions/install-linear-skill.sh';
  const PLACE = 'install_atomic ccd/install-linear-skill.sh .cc-sessions/install-linear-skill.sh 755';

  it('places the installer atomically and then runs it, in the agent arm, after the roster it sources', () => {
    expect(agentArm).toContain(PLACE);
    expect(agentArm).toContain(RUN);
    expect(agentArm.indexOf(PLACE)).toBeLessThan(agentArm.indexOf(RUN));
    const roster = agentArm.indexOf('accounts.sh');
    expect(roster, 'the agent arm no longer places the roster').toBeGreaterThan(-1);
    expect(roster).toBeLessThan(agentArm.indexOf(RUN));
  });

  it('rsyncs the skill tree with --delete before its installer runs', () => {
    const lines = agentArm.split('\n');
    const line = lines.find((l) => l.includes('linear-skill/'));
    expect(line, 'no line in the agent arm ships the linear skill tree').toBeDefined();
    expect(line).toContain('rsync');
    expect(line).toContain('--delete');
    expect(agentArm.indexOf(line!), 'the installer runs before its tree lands').toBeLessThan(agentArm.indexOf(RUN));
  });
});

describe('every hand-kept skill-name site that names ccrc-history also names ccrc-linear (spec §11, §14 census)', () => {
  // The history suite's one-way relation, anchored on the history skill: `ccrc-linear` joins every list the history
  // skill is on (spec §11), in the same spelling, at the same sites. Comment lines are dropped: a site is what it runs.
  const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');
  const fnBody = (rel: string, name: string): string => {
    const m = new RegExp(`\\n${name}\\(\\) \\{[^\\n]*\\n([\\s\\S]*?)\\n\\}\\n`).exec(read(rel));
    expect(m, `${rel} has no ${name}() defined at column 0`).not.toBeNull();
    return m![1]!;
  };
  const agentArm = (): string => {
    const d = read('deploy/deploy.sh');
    return d.slice(d.indexOf('if [ "$TARGET" = "agent" ]'), d.indexOf('\nelse\n'));
  };
  const SITES: ReadonlyArray<readonly [string, () => string]> = [
    ['ccd/ccrc _acct_provision', () => fnBody('ccd/ccrc', '_acct_provision')],
    ['ccd/ccrc _acct_unprovision', () => fnBody('ccd/ccrc', '_acct_unprovision')],
    ['ccd/ccrc _inst_skills', () => fnBody('ccd/ccrc', '_inst_skills')],
    ['ccd/ccrc _uninst_cc_sessions', () => fnBody('ccd/ccrc', '_uninst_cc_sessions')],
    ['ccd/ccrc-doctor-checks _check_skills', () => fnBody('ccd/ccrc-doctor-checks', '_check_skills')],
    ['ccd/ccrc-doctor-checks _fix_skills', () => fnBody('ccd/ccrc-doctor-checks', '_fix_skills')],
    ['deploy/deploy.sh agent arm', agentArm],
  ];
  const code = (t: string): string => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const FORMS: ReadonlyArray<readonly [string, (t: string) => string[]]> = [
    ['install-<x>-skill.sh', (t) => [...t.matchAll(/install-([a-z]+)-skill\.sh/g)].map((m) => m[1]!)],
    ['ccrc-<x>', (t) => [...t.matchAll(/(?<![\w./-])ccrc-([a-z]+)\b/g)].map((m) => m[1]!)],
    ['<x>-skill', (t) => [...t.matchAll(/(?<![\w-])([a-z]+)-skill\b(?![.\w-])/g)].map((m) => m[1]!)],
    ['for name in <x> …', (t) => [...t.matchAll(/\bfor name in ([a-z][a-z ]*); do/g)]
      .flatMap((m) => m[1]!.trim().split(/\s+/))],
  ];
  const relation = (body: string): { named: string[]; missing: string[] } => {
    const c = code(body);
    const named: string[] = [];
    const missing: string[] = [];
    for (const [form, names] of FORMS) {
      const got = new Set(names(c));
      if (!got.has('history')) continue;
      named.push(form);
      if (!got.has('linear')) missing.push(form);
    }
    return { named, missing };
  };

  it('CONTROL: the relation sees a site that left linear out, and passes one that names both', () => {
    expect(relation('  for name in coordinator-skill history-skill; do').missing).toEqual(['<x>-skill']);
    expect(relation('    for name in coordinator worker reviewer history linear; do').missing).toEqual([]);
    expect(relation('  # for name in history-skill; do').named, 'a comment counted').toEqual([]);
  });

  it.each(SITES.map(([site]) => site))('%s names history in some spelling, and linear wherever it does', (site) => {
    const { named, missing } = relation(SITES.find(([s]) => s === site)![1]());
    expect(named.length, `${site} names the history skill in no spelling: the site moved, or the scan broke`)
      .toBeGreaterThan(0);
    expect(missing, `${site} names the history skill but not the linear skill, in these spellings`).toEqual([]);
  });
});

describe('doctor converges a home that lost ccrc-linear (spec §11, §12)', () => {
  const installed = (home: string): string => path.join(home, '.claude', 'skills', 'ccrc-linear');

  it('a healthy box carries it and passes; a home without it FAILs by name, and --fix puts it back', () => {
    const home = healthy('ccrc-doctor-linear-skill-');
    expect(fs.existsSync(path.join(installed(home), 'SKILL.md')), 'the healthy fixture did not install it').toBe(true);
    expect(lineFor(runDoctor(home).stdout, 'skills')).toMatch(/^PASS skills: 1\/1 homes carry the shipped .*ccrc-linear/);
    fs.rmSync(installed(home), { recursive: true });
    let r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL skills: 1 skill\(s\) in the rostered homes .*: claude: ccrc-linear missing$/m);
    expect(r.stdout).toMatch(/CCRC_SKILL_SRC="\$HOME\/ccrc\/ccd\/linear-skill" bash "\$HOME\/ccrc\/ccd\/install-linear-skill\.sh"/);
    for (const t of ['rm', 'mkdir', 'mv', 'cp', 'date', 'basename']) linkReal(home, t);
    r = runDoctor(home, ['doctor', '--fix']);
    expect(r.stdout).toMatch(/^FIX skills: re-ran the shipped tree's installers into 1 home\(s\)/m);
    expect(r.stdout).toMatch(/^PASS skills: 1\/1 homes carry the shipped .*ccrc-linear$/m);
    expect(r.code, r.stdout).toBe(0);
    expect(fs.readFileSync(path.join(installed(home), 'SKILL.md'))).toEqual(fs.readFileSync(path.join(SRC, 'SKILL.md')));
  }, HEAVY);

  it('the shipped tree without the linear skill is a FAIL naming it', () => {
    const home = healthy('ccrc-doctor-linear-notree-');
    fs.rmSync(path.join(home, 'ccrc', 'ccd', 'linear-skill'), { recursive: true });
    expect(runDoctor(home).stdout).toMatch(/^FAIL skills: the shipped tree has no .*linear-skill/m);
  }, HEAVY);
});
