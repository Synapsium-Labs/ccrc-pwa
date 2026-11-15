// install-overlord-skill.sh stages the ccrc-overlord skill ONCE per box, at $HOME/.cc-sessions/overlord-skill, and no
// account home gets a copy (Overlord W1 plan, slug overlord-skill-staged-not-per-home). It is the reviewer installer's
// shape with one destination and the coordinator installer's references guard. Fixture HOMEs only (mkTmp), never the
// live $HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { siteRelation, SITES } from './skillSiteRelations.js';
import { healthy, linkReal, lineFor, runDoctor, STAGED_SKILL } from './ccrc-doctorFixture.js';

const HEAVY = 120_000;
const REPO = path.resolve(__dirname, '../..');
const INSTALLER = path.join(REPO, 'ccd/install-overlord-skill.sh');
const SRC = path.join(REPO, 'ccd/overlord-skill');
const REFS = ['answering.md', 'operator-model.md', 'routing.md', 'starting.md'] as const;
const HOMES = ['.claude', '.claude-a'];

/** Every file under a directory, as paths relative to it. */
const files = (dir: string): string[] => (fs.readdirSync(dir, { recursive: true }) as string[])
  .filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();

describe('install-overlord-skill', () => {
  let home: string;
  const staged = (...rest: string[]): string => path.join(home, '.cc-sessions', 'overlord-skill', ...rest);
  beforeEach(() => {
    home = mkTmp('ccrc-overlordskillinstall-');
    for (const d of HOMES) fs.mkdirSync(path.join(home, d), { recursive: true });
  });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });
  const run = (src = SRC, ...args: string[]): void => {
    execFileSync('bash', [INSTALLER, ...args], { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: src }, stdio: 'pipe' });
  };

  it('stages the skill at its one destination', () => {
    run();
    expect(files(staged())).toEqual(files(SRC));
    for (const f of files(SRC)) expect(fs.readFileSync(staged(f)), f).toEqual(fs.readFileSync(path.join(SRC, f)));
  }, HEAVY);

  it('re-running converges', () => {
    run();
    const before = fs.statSync(staged('SKILL.md'));
    run();
    const after = fs.statSync(staged('SKILL.md'));
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
    expect(fs.existsSync(path.join(home, 'ccrc-backups')), 'a converged re-run took a backup').toBe(false);
  }, HEAVY);

  it('replaces a stale staged copy and backs the old one up first', () => {
    run();
    fs.writeFileSync(staged('references', 'routing.md'), 'an older generation of the procedure');
    run();
    expect(fs.readFileSync(staged('references', 'routing.md'))).toEqual(fs.readFileSync(path.join(SRC, 'references', 'routing.md')));
    const backups = fs.readdirSync(path.join(home, 'ccrc-backups'));
    expect(backups.length).toBe(1);
    const kept = path.join(home, 'ccrc-backups', backups[0]!, 'staged.ccrc-overlord', 'references', 'routing.md');
    expect(fs.readFileSync(kept, 'utf8')).toBe('an older generation of the procedure');
  }, HEAVY);

  it.each(['SKILL.md', ...REFS.map((r) => `references/${r}`)])('refuses a source missing %s, and changes nothing', (drop) => {
    run();
    const before = files(staged()).map((f) => [f, fs.readFileSync(staged(f), 'utf8')]);
    const src = mkTmp('ccrc-overlordskillsrc-');
    try {
      fs.cpSync(SRC, src, { recursive: true });
      fs.writeFileSync(path.join(src, 'SKILL.md'), 'a newer generation that must not land');
      fs.rmSync(path.join(src, drop));
      expect(() => run(src)).toThrow(new RegExp(`no ${drop.replace('.', '\\.')} under`));
      expect(files(staged()).map((f) => [f, fs.readFileSync(staged(f), 'utf8')])).toEqual(before);
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
    }
  }, HEAVY);

  it('never writes outside its destination, and writes into no account home', () => {
    const dest = path.join(home, 'elsewhere', 'overlord-skill');
    run(SRC, '--dest', dest);
    expect(files(dest)).toEqual(files(SRC));
    expect(fs.readdirSync(home).sort()).toEqual([...HOMES, 'elsewhere'].sort());
    for (const d of HOMES) expect(fs.readdirSync(path.join(home, d)), d).toEqual([]);
    run();
    for (const d of HOMES) expect(fs.existsSync(path.join(home, d, 'skills')), d).toBe(false);
  }, HEAVY);
});

describe('the deploy stages it too: the fleet lane', () => {
  const deploy = fs.readFileSync(path.join(REPO, 'deploy/deploy.sh'), 'utf8');
  const agentArm = deploy.slice(deploy.indexOf('if [ "$TARGET" = "agent" ]'), deploy.indexOf('\nelse\n'));
  const RUN = 'bash ~/ccrc/ccd/install-overlord-skill.sh';

  it('runs the staging installer from the shipped tree, after the tree rsync and the reviewer\'s lines', () => {
    const at = agentArm.indexOf(RUN);
    expect(at, 'the agent arm no longer stages the overlord skill').toBeGreaterThan(-1);
    const tree = agentArm.indexOf('ccd "$BOX":ccrc/');
    expect(tree, 'the agent arm no longer rsyncs the tree to ~/ccrc').toBeGreaterThan(-1);
    expect(tree).toBeLessThan(at);
    expect(agentArm.indexOf("'bash ~/.cc-sessions/install-reviewer-skill.sh'")).toBeLessThan(at);
    expect(agentArm, 'a comment in the agent arm spells the directory with a trailing slash').not.toContain('overlord-skill/');
  });
});

describe('every site that stages a skill tree names overlord-skill', () => {
  // The relation helper with one pair: a site that names the linear skill in any spelling names the overlord skill in
  // some spelling. Not in the same spelling: the staged copy is on no per-home list, so `_fix_skills`' per-home loop
  // leaves it out and its one staging line names it instead.
  // `echo` lines are left out: `_inst_skills`' report names the staged copy, and a report stages nothing.
  const PAIR = { if: ['linear'], then: 'overlord', sameSpelling: false, ignore: /^\s*echo\b/ } as const;
  const STAGING_SITES = ['ccd/ccrc _inst_skills', 'ccd/ccrc _uninst_cc_sessions', 'ccd/ccrc-doctor-checks _check_skills',
    'ccd/ccrc-doctor-checks _fix_skills', 'deploy/deploy.sh agent arm'];

  it('CONTROL: the relation sees a site that left the overlord skill out, and passes one that names it once', () => {
    expect(siteRelation('  for name in history linear; do', PAIR).missing).toEqual(['for name in <x> …']);
    expect(siteRelation('  for name in history linear; do\n  bash "$t/install-overlord-skill.sh"', PAIR).missing).toEqual([]);
    expect(siteRelation('  for name in history linear; do\n  # bash "$t/install-overlord-skill.sh"', PAIR).missing,
      'a comment counted').toEqual(['for name in <x> …']);
    expect(siteRelation('  for name in history linear; do\n  echo "ccrc-overlord staged"', PAIR).missing,
      'a report counted').toEqual(['for name in <x> …']);
  });

  it.each(STAGING_SITES)('%s names the linear skill, and the overlord skill too', (site) => {
    const { named, missing } = siteRelation(SITES.find(([s]) => s === site)![1](), PAIR);
    expect(named.length, `${site} names the linear skill in no spelling: the site moved, or the scan broke`).toBeGreaterThan(0);
    expect(missing, `${site} names the linear skill but never the overlord skill`).toEqual([]);
  });
});

describe('doctor converges a box that lost the staged copy', () => {
  const stagedIn = (home: string): string => path.join(home, STAGED_SKILL[1]);

  it('a box without it FAILs by name, and --fix stages it again', () => {
    const home = healthy('ccrc-doctor-overlord-skill-');
    // healthy() plants no staged trees; an installed fleet box has them, the staged copy beside them, as `ccrc install` leaves it.
    fs.cpSync(path.join(REPO, 'ccd', 'coordinator-skill'), path.join(home, '.cc-sessions', 'coordinator-skill'), { recursive: true });
    fs.cpSync(path.join(REPO, 'ccd', STAGED_SKILL[0]), stagedIn(home), { recursive: true });
    expect(lineFor(runDoctor(home).stdout, 'skills')).toMatch(/^PASS skills: .*, and the staged ccrc-overlord copy$/);
    fs.rmSync(stagedIn(home), { recursive: true });
    let r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL skills: .*ccrc-overlord: staged copy missing/m);
    expect(r.stdout).toMatch(/CCRC_SKILL_SRC="\$HOME\/ccrc\/ccd\/overlord-skill" bash "\$HOME\/ccrc\/ccd\/install-overlord-skill\.sh"/);
    for (const t of ['rm', 'mkdir', 'mv', 'cp', 'date', 'basename', 'dirname']) linkReal(home, t);
    r = runDoctor(home, ['doctor', '--fix']);
    expect(r.stdout).toMatch(/^PASS skills: .*and the staged ccrc-overlord copy$/m);
    expect(r.code, r.stdout).toBe(0);
    expect(files(stagedIn(home))).toEqual(files(SRC));
    for (const f of files(SRC)) expect(fs.readFileSync(path.join(stagedIn(home), f)), f).toEqual(fs.readFileSync(path.join(SRC, f)));
  }, HEAVY);

  it('a box the spine never staged owes no staged copy, even with a registry, and --fix stages none', () => {
    const home = healthy('ccrc-doctor-overlord-noreg-');
    fs.mkdirSync(path.join(home, '.cc-sessions', 'pools'), { recursive: true });   // a registry, as the pools cases plant one
    expect(lineFor(runDoctor(home).stdout, 'skills')).toMatch(/^PASS skills: 1\/1 homes carry the shipped .*ccrc-linear$/);
    for (const t of ['rm', 'mkdir', 'mv', 'cp', 'date', 'basename', 'dirname']) linkReal(home, t);
    expect(runDoctor(home, ['doctor', '--fix']).code).toBe(0);
    expect(fs.existsSync(stagedIn(home)), '--fix staged a copy the spine never owed').toBe(false);
  }, HEAVY);

  it('the shipped tree without the overlord skill is a FAIL naming it', () => {
    const home = healthy('ccrc-doctor-overlord-notree-');
    fs.rmSync(path.join(home, 'ccrc', 'ccd', 'overlord-skill'), { recursive: true });
    expect(runDoctor(home).stdout).toMatch(/^FAIL skills: the shipped tree has no .*overlord-skill/m);
  }, HEAVY);
});
