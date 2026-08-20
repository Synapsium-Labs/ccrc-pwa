// The worker skill installer, tested exactly the way
// install-coordinator-skill.test.ts tests its sibling: a fixture HOME, never
// the live one, and the properties that matter are convergence,
// non-destruction and per-home isolation.
//
// One structural difference from the coordinator suite: this skill's
// fail-closed guard is REQUIRED_FILES=(SKILL.md) alone — the skill carries no
// references/ of its own (it points at the coordinator's installed tree), so
// there is no "SKILL.md present but references/ incomplete" shape to probe.
// The single "no SKILL.md at all" refusal is the whole guard surface.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { seedAccountsSh } from './ccdWsHelpers.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-worker-skill.sh');
const SRC = path.resolve(__dirname, '../../ccd/worker-skill');
const HOMES = ['.claude', '.claude-personal', '.claude-corp', '.claude-gpt'];

let home: string;
const skill = (d: string, ...rest: string[]): string =>
  path.join(home, d, 'skills', 'ccrc-worker', ...rest);

beforeEach(() => {
  home = mkTmp('ccrc-workerskillinstall-');
  for (const d of HOMES) fs.mkdirSync(path.join(home, d), { recursive: true });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const run = (...homes: string[]): void => {
  execFileSync('bash', [INSTALLER, '--homes', ...(homes.length ? homes : HOMES.map((d) => path.join(home, d)))],
    { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: SRC } });
};

describe('install-worker-skill', () => {
  it('installs the skill into every home it is given', () => {
    run();
    for (const d of HOMES) {
      expect(fs.readFileSync(skill(d, 'SKILL.md'), 'utf8'))
        .toBe(fs.readFileSync(path.join(SRC, 'SKILL.md'), 'utf8'));
    }
  });

  it('re-running converges — the second run does not rewrite a converged home', () => {
    // Byte-level idempotence is what install-coordinator-skill promises, and
    // the observable proof here is the inode: a rewrite would replace the file.
    run();
    const before = fs.statSync(skill('.claude', 'SKILL.md'));
    run();
    const after = fs.statSync(skill('.claude', 'SKILL.md'));
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('replaces a stale install and backs the old one up first', () => {
    run();
    fs.writeFileSync(skill('.claude', 'SKILL.md'), 'an older generation of the skill');
    run();
    expect(fs.readFileSync(skill('.claude', 'SKILL.md'), 'utf8')).toContain('name: ccrc-worker');
    const backups = fs.readdirSync(path.join(home, 'ccrc-backups'));
    expect(backups.length).toBeGreaterThan(0);
    const inside = fs.readdirSync(path.join(home, 'ccrc-backups', backups[0]!));
    expect(inside.some((n) => n.includes('ccrc-worker'))).toBe(true);
  });

  it('skips a home that does not exist without failing the run', () => {
    // A box missing one of its wrapper homes is an ordinary box, not an error.
    fs.rmSync(path.join(home, '.claude-gpt'), { recursive: true });
    run();
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(true);
    // Same property install-coordinator-skill's suite pins (mutation M2
    // there): the missing home must STAY missing, not merely "still process
    // the others" — `mkdir -p "$dir/skills"` would otherwise conjure the
    // absent home right back into existence.
    expect(fs.existsSync(path.join(home, '.claude-gpt'))).toBe(false);
  });

  it('refuses the whole run when the source has no SKILL.md, touching nothing', () => {
    const empty = mkTmp('ccrc-workerskillsrc-');
    expect(() => execFileSync('bash', [INSTALLER, '--homes', path.join(home, '.claude')],
      { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: empty } })).toThrow();
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(false);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('reports a failed home in the exit status but still processes the others', () => {
    // Same rule as the coordinator installer: one bad home must not silently
    // strand the account a swap could move a worker onto.
    const blocked = path.join(home, '.claude-corp', 'skills');
    fs.mkdirSync(blocked, { recursive: true });
    fs.chmodSync(blocked, 0o500);
    let threw = false;
    try { run(); } catch { threw = true; }
    fs.chmodSync(blocked, 0o700);
    expect(threw).toBe(true);
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(skill('.claude-personal', 'SKILL.md'))).toBe(true);
    // Same per-home-isolation pin as install-coordinator-skill's suite
    // (mutation M1 there): `.claude-gpt` is the FOURTH home, processed AFTER
    // `.claude-corp` fails — only the per-home `continue` reaches it, so a
    // `rc=1; continue` mutated to `exit 1` shows up here.
    expect(fs.existsSync(skill('.claude-gpt', 'SKILL.md'))).toBe(true);
  });

  it('never writes outside the homes it was given', () => {
    run(path.join(home, '.claude'));
    for (const d of ['.claude-personal', '.claude-corp', '.claude-gpt']) {
      expect(fs.existsSync(path.join(home, d, 'skills'))).toBe(false);
    }
  });
});

describe('install-worker-skill.sh default homes are the roster, behaviourally', () => {
  // Same shape, same reason, as install-coordinator-skill.test.ts's own
  // behavioural pin: the installer sources the generated `~/.ccrc/accounts.sh`
  // and installs into every rostered account's config dir, so this RUNS it
  // with no --homes argv against a fixture HOME holding a config dir for each.
  let rosterHome: string;
  beforeEach(() => {
    rosterHome = mkTmp('ccrc-workerskillinstall-roster-');
    seedAccountsSh(rosterHome);
    for (const a of DEFAULT_TEST_ROSTER.accounts) {
      fs.mkdirSync(path.join(rosterHome, a.configDirSuffix), { recursive: true });
    }
  });
  afterEach(() => { fs.rmSync(rosterHome, { recursive: true, force: true }); });

  it("touches every rostered account's config dir when given no --homes argv", () => {
    execFileSync('bash', [INSTALLER], { env: { ...process.env, HOME: rosterHome, CCRC_SKILL_SRC: SRC } });
    for (const a of DEFAULT_TEST_ROSTER.accounts) {
      const got = fs.existsSync(path.join(rosterHome, a.configDirSuffix, 'skills', 'ccrc-worker', 'SKILL.md'));
      expect(got, a.id).toBe(true);
    }
  });

  it('refuses, naming the remedy, when the box has no roster at all', () => {
    const bare = mkTmp('ccrc-workerskillinstall-noroster-');
    try {
      expect(() => execFileSync('bash', [INSTALLER],
        { env: { ...process.env, HOME: bare, CCRC_SKILL_SRC: SRC }, stdio: 'pipe' })).toThrow(/no account roster/);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('the deploy ships the worker skill too — the fleet lane, in order', () => {
  // install-coordinator-skill.test.ts:207-233's idiom, with this skill's own
  // tokens. Nothing else in this repository reads `deploy/deploy.sh`'s skill
  // lanes, so without these two assertions the four lines that ship this skill
  // to the fleet host can be deleted, reordered or stripped of `--delete` and
  // every suite stays green — the deploy is the only thing that ever runs them,
  // and it runs against a live box.
  const deploy = fs.readFileSync(path.resolve(__dirname, '../..', 'deploy/deploy.sh'), 'utf8');
  const agentArm = deploy.slice(deploy.indexOf('if [ "$TARGET" = "agent" ]'), deploy.indexOf('\nelse\n'));
  const COORD_RUN = 'bash ~/.cc-sessions/install-coordinator-skill.sh';
  const WORKER_RUN = 'bash ~/.cc-sessions/install-worker-skill.sh';

  it('installs the skill in the agent arm, after the coordinator skill installer has run', () => {
    // ANCHORED ON THE RUN LINES, and each anchor's EXISTENCE asserted before
    // any ordering is asked of it — both rules the coordinator suite paid for
    // by measurement (its Task 8 sweep: a bare `indexOf` matched a comment that
    // merely NAMED the other installer, and `indexOf` returning -1 for a
    // deleted invocation made `-1 < <any index>` a green ordering assertion
    // over an arm that ran nothing at all).
    //
    // WHY THIS ORDER IS A RULE AND NOT A HABIT: this skill's SKILL.md carries
    // no references/ of its own and sends a live worker to the coordinator's
    // installed tree by relative path (`../ccrc-coordinator/references/…`).
    // Shipping it first puts a skill on the box naming reference files nothing
    // there provides yet.
    expect(agentArm).toContain('install-worker-skill.sh');
    expect(agentArm).toContain(COORD_RUN);
    expect(agentArm).toContain(WORKER_RUN);
    expect(agentArm.indexOf(COORD_RUN)).toBeLessThan(agentArm.indexOf(WORKER_RUN));
  });

  it('rsyncs the skill tree with --delete, and does it after the coordinator lane', () => {
    // Located by the FIRST line in the arm that spells this skill's directory
    // with a trailing slash — which is why neither the block's own comment nor
    // any comment above it may carry that spelling (deploy.sh says so at both
    // skill lanes). A comment that did would shadow the real invocation, and
    // this assertion would then be measuring prose.
    expect(agentArm).toContain(COORD_RUN);
    const lines = agentArm.split('\n');
    const idx = lines.findIndex((l) => l.includes('worker-skill/'));
    expect(idx, 'no line in the agent arm ships the worker skill tree').toBeGreaterThan(-1);
    const line = lines[idx]!;
    expect(line).toContain('rsync');
    // --delete, for the same reason the coordinator's tree carries it: a
    // reference file deleted in git has to die on the box too, or the skill
    // keeps pointing a model at prose the repository no longer stands behind.
    expect(line).toContain('--delete');
    expect(agentArm.indexOf(COORD_RUN),
      "the worker skill's tree must land after the coordinator lane it points into")
      .toBeLessThan(agentArm.indexOf(line));
  });
});
