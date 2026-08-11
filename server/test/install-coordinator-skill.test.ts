// The skill installer, tested exactly the way install-session-hooks.test.ts
// tests its sibling: a fixture HOME, never the live one, and the properties
// that matter are convergence, non-destruction and per-home isolation.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { ACCOUNTS, type Wrapper } from '../../shared/api.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-coordinator-skill.sh');
const SRC = path.resolve(__dirname, '../../ccd/coordinator-skill');
const HOMES = ['.claude', '.claude-personal', '.claude-corp', '.claude-gpt'];

let home: string;
const skill = (d: string, ...rest: string[]): string =>
  path.join(home, d, 'skills', 'ccrc-coordinator', ...rest);

beforeEach(() => {
  home = mkTmp('ccrc-skillinstall-');
  for (const d of HOMES) fs.mkdirSync(path.join(home, d), { recursive: true });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const run = (...homes: string[]): void => {
  execFileSync('bash', [INSTALLER, '--homes', ...(homes.length ? homes : HOMES.map((d) => path.join(home, d)))],
    { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: SRC } });
};

describe('install-coordinator-skill', () => {
  it('installs the skill into every home it is given', () => {
    run();
    for (const d of HOMES) {
      expect(fs.readFileSync(skill(d, 'SKILL.md'), 'utf8'))
        .toBe(fs.readFileSync(path.join(SRC, 'SKILL.md'), 'utf8'));
      expect(fs.existsSync(skill(d, 'references', 'wave-lifecycle.md'))).toBe(true);
      expect(fs.existsSync(skill(d, 'references', 'ledger-template.md'))).toBe(true);
    }
  });

  it('re-running converges — the second run does not rewrite a converged home', () => {
    // Byte-level idempotence is what install-session-hooks promises, and the
    // observable proof here is the inode: a rewrite would replace the file.
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
    expect(fs.readFileSync(skill('.claude', 'SKILL.md'), 'utf8')).toContain('name: ccrc-coordinator');
    const backups = fs.readdirSync(path.join(home, 'ccrc-backups'));
    expect(backups.length).toBeGreaterThan(0);
    const inside = fs.readdirSync(path.join(home, 'ccrc-backups', backups[0]!));
    expect(inside.some((n) => n.includes('ccrc-coordinator'))).toBe(true);
  });

  it('skips a home that does not exist without failing the run', () => {
    // A box missing one of its wrapper homes is an ordinary box, not an error.
    fs.rmSync(path.join(home, '.claude-gpt'), { recursive: true });
    run();
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(true);
    // Fix-round finding (mutation M2): deleting the `[[ -d "$dir" ]] ||
    // continue` guard entirely still passes THIS FAR — `mkdir -p
    // "$dir/skills"` conjures the absent home right back into existence,
    // silently manufacturing a wrapper's config dir on a box that never had
    // it. The missing home must STAY missing, not merely "still process the
    // others" — that's the property the guard actually holds.
    expect(fs.existsSync(path.join(home, '.claude-gpt'))).toBe(false);
  });

  it('refuses the whole run when the source has no SKILL.md, touching nothing', () => {
    const empty = mkTmp('ccrc-skillsrc-');
    expect(() => execFileSync('bash', [INSTALLER, '--homes', path.join(home, '.claude')],
      { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: empty } })).toThrow();
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(false);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  // Fix, review finding 14: SKILL.md alone used to be the WHOLE guard, even
  // though the same comment two lines above it names the property this is
  // for ("a half-installed skill is worse than none"). A partial source
  // (SKILL.md present, `references/` incomplete or absent — exactly the
  // shape an interrupted `rsync -az --delete` leaves, since SKILL.md sorts
  // before `references/`) used to install cleanly: exit 0, no stderr, a home
  // left with `SKILL.md` alone even though that very file tells a live
  // coordinator to read three files under `references/` "before the first
  // dispatch of a program".
  it('refuses the whole run when the source is missing a references/ file, touching nothing', () => {
    const partial = mkTmp('ccrc-skillsrc-partial-');
    fs.mkdirSync(path.join(partial, 'references'), { recursive: true });
    fs.writeFileSync(path.join(partial, 'SKILL.md'), fs.readFileSync(path.join(SRC, 'SKILL.md')));
    // wave-lifecycle.md and mail-envelope.md are both missing — ledger-
    // template.md alone is not enough to look "complete".
    fs.writeFileSync(path.join(partial, 'references', 'ledger-template.md'),
      fs.readFileSync(path.join(SRC, 'references', 'ledger-template.md')));
    expect(() => execFileSync('bash', [INSTALLER, '--homes', path.join(home, '.claude')],
      { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: partial } })).toThrow();
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(false);
    fs.rmSync(partial, { recursive: true, force: true });
  });

  it('never replaces a previously-good install with a partial source (the dangerous direction, review finding 14)', () => {
    // The MEASURED failure mode the finding names: `diff -r -q` sees a
    // partial SRC as "differs" from a converged good install and REPLACES
    // it — a stale-but-complete skill is safer than a fresh-but-broken one,
    // so this direction matters more than the fresh-home case above.
    run(path.join(home, '.claude'));
    const goodWaveLifecycle = fs.readFileSync(skill('.claude', 'references', 'wave-lifecycle.md'), 'utf8');
    expect(goodWaveLifecycle.length).toBeGreaterThan(0);

    const partial = mkTmp('ccrc-skillsrc-partial2-');
    fs.mkdirSync(path.join(partial, 'references'), { recursive: true });
    fs.writeFileSync(path.join(partial, 'SKILL.md'), 'a newer generation, shipped without its references');
    expect(() => execFileSync('bash', [INSTALLER, '--homes', path.join(home, '.claude')],
      { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: partial } })).toThrow();

    // The good install must survive, byte for byte — not silently
    // downgraded to the fragment.
    expect(fs.readFileSync(skill('.claude', 'SKILL.md'), 'utf8')).toContain('name: ccrc-coordinator');
    expect(fs.readFileSync(skill('.claude', 'references', 'wave-lifecycle.md'), 'utf8')).toBe(goodWaveLifecycle);
    fs.rmSync(partial, { recursive: true, force: true });
  });

  it('reports a failed home in the exit status but still processes the others', () => {
    // Same rule as the hook installer: one bad home must not silently strand
    // the account a swap could move the coordinator onto.
    const blocked = path.join(home, '.claude-corp', 'skills');
    fs.mkdirSync(blocked, { recursive: true });
    fs.chmodSync(blocked, 0o500);
    let threw = false;
    try { run(); } catch { threw = true; }
    fs.chmodSync(blocked, 0o700);
    expect(threw).toBe(true);
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(skill('.claude-personal', 'SKILL.md'))).toBe(true);
    // Fix-round finding (mutation M1): asserting only the two homes
    // processed BEFORE the blocked one cannot tell "continued past the bad
    // home" from "aborted at it" — a `rc=1; continue` mutated to `exit 1`
    // still passes those two. `.claude-gpt` is the FOURTH home, processed
    // AFTER `.claude-corp` fails; only the per-home `continue` reaches it.
    expect(fs.existsSync(skill('.claude-gpt', 'SKILL.md'))).toBe(true);
  });

  it('never writes outside the homes it was given', () => {
    run(path.join(home, '.claude'));
    for (const d of ['.claude-personal', '.claude-corp', '.claude-gpt']) {
      expect(fs.existsSync(path.join(home, d, 'skills'))).toBe(false);
    }
  });
});

describe('install-coordinator-skill.sh default homes agree with ACCOUNTS.hooksAble, behaviourally', () => {
  // wrapper-roster-fixture.test.ts pins this by PARSING the installer's
  // source; this proves the same claim by actually RUNNING it — same shape
  // as install-session-hooks.test.ts's own behavioural pin (fix-round
  // finding: the two installers' default-homes fallback is NOT the "cannot
  // be usefully executed" case that file's header used to claim for both —
  // this test, and that one, are the disproof). A fixture HOME gets a config
  // dir for every roster wrapper (hooksAble and not), the installer is
  // invoked with NO --homes argv at all (its real default), and the skill
  // must land in exactly the hooksAble ones.
  const WRAPPERS = Object.keys(ACCOUNTS) as Wrapper[];
  let rosterHome: string;
  beforeEach(() => {
    rosterHome = mkTmp('ccrc-skillinstall-roster-');
    for (const w of WRAPPERS) fs.mkdirSync(path.join(rosterHome, ACCOUNTS[w].configDirSuffix), { recursive: true });
  });
  afterEach(() => { fs.rmSync(rosterHome, { recursive: true, force: true }); });

  it("touches exactly the roster's hooksAble config dirs when given no --homes argv", () => {
    execFileSync('bash', [INSTALLER], { env: { ...process.env, HOME: rosterHome, CCRC_SKILL_SRC: SRC } });
    for (const w of WRAPPERS) {
      const got = fs.existsSync(path.join(rosterHome, ACCOUNTS[w].configDirSuffix, 'skills', 'ccrc-coordinator', 'SKILL.md'));
      expect(got, w).toBe(ACCOUNTS[w].hooksAble);
    }
  });
});

describe('the deploy ships the skill, agent-side — and PR I’s token lane is there', () => {
  const repo = (f: string): string => readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
  const deploy = repo('deploy/deploy.sh');
  const agentArm = deploy.slice(deploy.indexOf('if [ "$TARGET" = "agent" ]'), deploy.indexOf('\nelse\n'));

  it('installs the skill in the agent arm, after the hook installer', () => {
    expect(agentArm).toContain('coordinator-skill');
    expect(agentArm).toContain('install-coordinator-skill.sh');
    // Anchored on the actual RUN lines (`bash ~/.cc-sessions/…`), not a bare
    // substring: the coordinator-skill block's own explanatory comment names
    // "install-session-hooks.sh" in prose ("ccd, session-hook.sh,
    // install-session-hooks.sh, and now this") — a bare `indexOf` finds that
    // mention regardless of where the block sits, so a mutant that actually
    // swaps the two INVOCATION blocks survived this assertion untouched
    // (mutation sweep, Task 8: measured, not assumed).
    //
    // Task 8 fix round 1, finding 4: `indexOf` returns -1 for a missing
    // anchor, and `-1 < <any index>` is true — so this comparison alone
    // ALSO passed on a mutant that deleted the hook-installer invocation
    // outright (agent arm ships the installer, never runs it), the same
    // defect class the anchoring above was written to close. `toContain`
    // guards each anchor's EXISTENCE before the ordering is even asked.
    expect(agentArm).toContain('bash ~/.cc-sessions/install-session-hooks.sh');
    expect(agentArm).toContain('bash ~/.cc-sessions/install-coordinator-skill.sh');
    expect(agentArm.indexOf('bash ~/.cc-sessions/install-session-hooks.sh'))
      .toBeLessThan(agentArm.indexOf('bash ~/.cc-sessions/install-coordinator-skill.sh'));
  });

  it('rsyncs the skill with --delete, so a deleted reference dies on the box too', () => {
    const line = agentArm.split('\n').find((l) => l.includes('coordinator-skill/'))!;
    expect(line).toContain('--delete');
  });

  // The three below are assertions about PR I's work, deliberately. The skill
  // is useless without the token, and a silently absent lane would surface as a
  // coordinator that cannot authenticate — a long way from here. They check
  // SHAPE and EXISTENCE only: no test in this repo reads a token, and a token
  // in a fixture is a token in a CI log.
  it('the agent arm ships the fleet host’s copy of the box token', () => {
    expect(agentArm).toContain("ship_secret ccrc-mail.token '~/.cc-secrets' ccrc-mail.token");
  });

  it('notify.sh presents it under the header the server actually checks', () => {
    expect(repo('deploy/notify.sh')).toContain('x-ccrc-mail-token');
  });

  it('the token is gitignored and no token is committed', () => {
    // NOT existsSync: an operator who has minted a real token for actual
    // deploys leaves it sitting gitignored on disk in THIS repo's own working
    // tree by design (PR I's own note — "shipped only when the operator has
    // minted one"), so a raw filesystem check would fail on exactly the box
    // this project runs on. `git ls-files` is what "committed" means.
    expect(repo('.gitignore')).toContain('deploy/ccrc-mail.token');
    const tracked = execFileSync('git', ['ls-files', 'deploy/ccrc-mail.token'],
      { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' }).trim();
    expect(tracked, 'a real token must never be committed to this repo').toBe('');
  });
});
