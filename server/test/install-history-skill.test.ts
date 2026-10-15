// The history skill installer (ccrc history spec 2026-10-05 §8.5; the install half of pin C23), tested the way
// install-worker-skill.test.ts tests its sibling: a fixture HOME, never the live one, and the properties that
// matter are convergence, non-destruction and per-home isolation.
//
// Two differences from the worker suite. The fail-closed guard is REQUIRED_FILES=(SKILL.md LICENSE.lossless-claw):
// the skill's recall-policy sentences are MIT material whose notice must travel with every copy (spec §12), so a
// source that holds SKILL.md without the sidecar is refused, and idempotence is measured on both files. And the
// skill points into no other skill's tree, so its deploy lane carries no ordering against the coordinator's.
// The last describe is the one-way relation spec §8.7 asks for: every hand-kept site that names the three ccrc
// skills names this one too.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { seedAccountsSh } from './ccdWsHelpers.js';

const HEAVY = 120_000;
const REPO = path.resolve(__dirname, '../..');
const INSTALLER = path.join(REPO, 'ccd/install-history-skill.sh');
const SRC = path.join(REPO, 'ccd/history-skill');
const FILES = ['SKILL.md', 'LICENSE.lossless-claw'] as const;
const HOMES = ['.claude', '.claude-a', '.claude-b', '.claude-c'];

let home: string;
const skill = (d: string, ...rest: string[]): string => path.join(home, d, 'skills', 'ccrc-history', ...rest);

beforeEach(() => {
  home = mkTmp('ccrc-historyskillinstall-');
  for (const d of HOMES) fs.mkdirSync(path.join(home, d), { recursive: true });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const run = (...homes: string[]): void => {
  execFileSync('bash', [INSTALLER, '--homes', ...(homes.length ? homes : HOMES.map((d) => path.join(home, d)))],
    { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: SRC }, stdio: 'pipe' });
};
/** A source of our own for the refusal cases: the shipped tree minus the named files. */
const partialSrc = (drop: readonly string[]): string => {
  const d = mkTmp('ccrc-historyskillsrc-');
  for (const f of FILES) if (!drop.includes(f)) fs.copyFileSync(path.join(SRC, f), path.join(d, f));
  return d;
};

describe('install-history-skill', () => {
  it('installs SKILL.md and its MIT sidecar, byte for byte, into every home it is given', () => {
    run();
    for (const d of HOMES) {
      for (const f of FILES) {
        expect(fs.readFileSync(skill(d, f)), `${d}: ${f}`).toEqual(fs.readFileSync(path.join(SRC, f)));
      }
    }
  }, HEAVY);

  it('re-running converges: the second run rewrites neither file and takes no backup', () => {
    run();
    const before = FILES.map((f) => fs.statSync(skill('.claude', f))).map((s) => [s.ino, s.mtimeMs]);
    run();
    expect(FILES.map((f) => fs.statSync(skill('.claude', f))).map((s) => [s.ino, s.mtimeMs])).toEqual(before);
    expect(fs.existsSync(path.join(home, 'ccrc-backups')), 'a converged re-run took a backup').toBe(false);
  }, HEAVY);

  it('replaces a stale SKILL.md and backs the old install up first', () => {
    run();
    fs.writeFileSync(skill('.claude', 'SKILL.md'), 'an older generation of the skill');
    run();
    expect(fs.readFileSync(skill('.claude', 'SKILL.md'), 'utf8')).toContain('name: ccrc-history');
    const backups = fs.readdirSync(path.join(home, 'ccrc-backups'));
    expect(backups.length).toBeGreaterThan(0);
    const inside = fs.readdirSync(path.join(home, 'ccrc-backups', backups[0]!));
    expect(inside.some((n) => n.includes('ccrc-history'))).toBe(true);
  }, HEAVY);

  it('a home whose sidecar alone differs is re-installed: diff -r -q compares the whole tree', () => {
    run();
    fs.writeFileSync(skill('.claude-a', 'LICENSE.lossless-claw'), 'not the upstream licence\n');
    run();
    expect(fs.readFileSync(skill('.claude-a', 'LICENSE.lossless-claw')))
      .toEqual(fs.readFileSync(path.join(SRC, 'LICENSE.lossless-claw')));
  }, HEAVY);

  it('skips a home that does not exist, and the missing home stays missing', () => {
    fs.rmSync(path.join(home, '.claude-c'), { recursive: true });
    run();
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.claude-c'))).toBe(false);
  }, HEAVY);

  it('refuses the whole run when the source has no SKILL.md, touching nothing', () => {
    const src = partialSrc(['SKILL.md']);
    try {
      expect(() => execFileSync('bash', [INSTALLER, '--homes', path.join(home, '.claude')],
        { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: src }, stdio: 'pipe' })).toThrow(/no SKILL\.md under/);
      expect(fs.existsSync(path.join(home, '.claude', 'skills'))).toBe(false);
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
    }
  }, HEAVY);

  it('refuses the whole run when the source has SKILL.md but not its MIT sidecar (spec §12)', () => {
    // The guard this installer adds to its sibling's: installing the adapted sentences without their notice would
    // strip the MIT licence from every home's copy.
    const src = partialSrc(['LICENSE.lossless-claw']);
    try {
      expect(() => execFileSync('bash', [INSTALLER, '--homes', path.join(home, '.claude')],
        { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: src }, stdio: 'pipe' }))
        .toThrow(/no LICENSE\.lossless-claw under/);
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
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(skill('.claude-a', 'SKILL.md'))).toBe(true);
    // `.claude-c` is processed AFTER `.claude-b` fails: only the per-home `continue` reaches it.
    expect(fs.existsSync(skill('.claude-c', 'SKILL.md'))).toBe(true);
  }, HEAVY);

  it('never writes outside the homes it was given', () => {
    run(path.join(home, '.claude'));
    for (const d of ['.claude-a', '.claude-b', '.claude-c']) {
      expect(fs.existsSync(path.join(home, d, 'skills'))).toBe(false);
    }
  }, HEAVY);
});

describe('install-history-skill.sh default homes are the roster, behaviourally', () => {
  let rosterHome: string;
  beforeEach(() => {
    rosterHome = mkTmp('ccrc-historyskillinstall-roster-');
    seedAccountsSh(rosterHome);
    for (const a of DEFAULT_TEST_ROSTER.accounts) {
      fs.mkdirSync(path.join(rosterHome, a.configDirSuffix), { recursive: true });
    }
  });
  afterEach(() => { fs.rmSync(rosterHome, { recursive: true, force: true }); });

  it("touches every rostered account's config dir when given no --homes argv (spec §6.10)", () => {
    execFileSync('bash', [INSTALLER], { env: { ...process.env, HOME: rosterHome, CCRC_SKILL_SRC: SRC }, stdio: 'pipe' });
    for (const a of DEFAULT_TEST_ROSTER.accounts) {
      for (const f of FILES) {
        expect(fs.existsSync(path.join(rosterHome, a.configDirSuffix, 'skills', 'ccrc-history', f)), `${a.id}: ${f}`)
          .toBe(true);
      }
    }
  }, HEAVY);

  it('refuses, naming the remedy, when the box has no roster at all', () => {
    const bare = mkTmp('ccrc-historyskillinstall-noroster-');
    try {
      expect(() => execFileSync('bash', [INSTALLER],
        { env: { ...process.env, HOME: bare, CCRC_SKILL_SRC: SRC }, stdio: 'pipe' })).toThrow(/no account roster/);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  }, HEAVY);
});

describe('the deploy ships the history skill too: the fleet lane (O16, the skill half)', () => {
  // install-worker-skill.test.ts's idiom with this skill's tokens. The run line is located by its exact text,
  // and its existence is asserted before any ordering is asked of it. The rsync line is located by the FIRST
  // line in the arm that spells the skill's directory with a trailing slash, which is why no comment in the arm
  // may carry that spelling.
  const deploy = fs.readFileSync(path.join(REPO, 'deploy/deploy.sh'), 'utf8');
  const agentArm = deploy.slice(deploy.indexOf('if [ "$TARGET" = "agent" ]'), deploy.indexOf('\nelse\n'));
  const RUN = 'bash ~/.cc-sessions/install-history-skill.sh';
  const PLACE = 'install_atomic ccd/install-history-skill.sh .cc-sessions/install-history-skill.sh 755';

  it('places the installer atomically and then runs it, in the agent arm', () => {
    expect(agentArm).toContain(PLACE);
    expect(agentArm).toContain(RUN);
    expect(agentArm.indexOf(PLACE)).toBeLessThan(agentArm.indexOf(RUN));
  });

  it('rsyncs the skill tree with --delete before its installer runs', () => {
    expect(agentArm).toContain(RUN);
    const lines = agentArm.split('\n');
    const idx = lines.findIndex((l) => l.includes('history-skill/'));
    expect(idx, 'no line in the agent arm ships the history skill tree').toBeGreaterThan(-1);
    const line = lines[idx]!;
    expect(line).toContain('rsync');
    // --delete: a file deleted in git has to leave the box's copy too, or the box's tree and the home it
    // installs stop being the shipped tree.
    expect(line).toContain('--delete');
    expect(agentArm.indexOf(line), 'the installer runs before its tree lands').toBeLessThan(agentArm.indexOf(RUN));
  });
});

describe('every hand-kept skill-name site that names the three ccrc skills also names ccrc-history (spec 2026-10-05 §8.7)', () => {
  // Spec §8.7 (rev 3.2 review, CT11): the sites do not name one set today. graphify is named at some sites
  // (the account add and remove paths, uninstall, the deploy lane) and not at others (`_inst_skills`' loop,
  // doctor's loops), because its installer has its own step. So an equal-set pin would be red at birth.
  // This pin is the spec's one-way relation: a site that names the coordinator, worker and reviewer skills in one
  // spelling names the history skill in that same spelling. The four spellings are the four the sites use.
  // Comment lines are dropped, because a site is what it runs.
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
  /** Each spelling, and the short names it finds in a site's code. */
  const FORMS: ReadonlyArray<readonly [string, (t: string) => string[]]> = [
    ['install-<x>-skill.sh', (t) => [...t.matchAll(/install-([a-z]+)-skill\.sh/g)].map((m) => m[1]!)],
    ['ccrc-<x>', (t) => [...t.matchAll(/(?<![\w./-])ccrc-([a-z]+)\b/g)].map((m) => m[1]!)],
    ['<x>-skill', (t) => [...t.matchAll(/(?<![\w-])([a-z]+)-skill\b(?![.\w-])/g)].map((m) => m[1]!)],
    ['for name in <x> …', (t) => [...t.matchAll(/\bfor name in ([a-z][a-z ]*); do/g)]
      .flatMap((m) => m[1]!.trim().split(/\s+/))],
  ];
  const TRIO = ['coordinator', 'worker', 'reviewer'];
  /** The spellings in which a body names all three, and those of them in which it does not name history. */
  const relation = (body: string): { trio: string[]; missing: string[] } => {
    const c = code(body);
    const trio: string[] = [];
    const missing: string[] = [];
    for (const [form, names] of FORMS) {
      const got = new Set(names(c));
      if (!TRIO.every((n) => got.has(n))) continue;
      trio.push(form);
      if (!got.has('history')) missing.push(form);
    }
    return { trio, missing };
  };

  it('CONTROL: the relation sees a site that dropped history, and passes one that never named the three', () => {
    expect(relation('  for name in coordinator-skill worker-skill reviewer-skill; do').missing).toEqual(['<x>-skill']);
    expect(relation('    for name in coordinator worker reviewer history; do').missing).toEqual([]);
    expect(relation('  install_atomic ccd/install-graphify-skill.sh x 755').trio).toEqual([]);
    expect(relation('  # for name in coordinator-skill worker-skill reviewer-skill; do').trio, 'a comment counted')
      .toEqual([]);
  });

  it.each(SITES.map(([site]) => site))('%s names the three in some spelling, and history wherever it does', (site) => {
    const body = SITES.find(([s]) => s === site)![1]();
    const { trio, missing } = relation(body);
    expect(trio.length, `${site} names the three ccrc skills in no spelling: the site moved, or the scan broke`)
      .toBeGreaterThan(0);
    expect(missing, `${site} names coordinator, worker and reviewer but not history, in these spellings`).toEqual([]);
  });
});
