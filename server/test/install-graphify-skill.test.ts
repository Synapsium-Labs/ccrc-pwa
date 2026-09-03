// The graphify skill installer — assembled SRC, never vendored (spec §B):
// unlike `install-coordinator-skill.sh`/`install-worker-skill.sh`, whose
// `SRC` is a tree `_inst_skills` stages under `~/.cc-sessions`, this
// installer's `SRC` is a mktemp'd stage it builds itself, byte for byte,
// out of the INSTALLED graphify PACKAGE (`<pkg>/skill.md` the body,
// `<pkg>/skills/claude/references/` the sidecar) and the pin
// (`~/.ccrc/graphify.pin` or `CCRC_GRAPHIFY_PIN`). Modelled on
// `install-worker-skill.test.ts:1-46` — same `mkTmp` + HOMES + `--homes`
// runner — because the swap loop underneath is the same one, copied
// faithfully.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { PKG_DESCRIPTION, skillMd } from './graphifySkillFixture.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-graphify-skill.sh');
const HOMES = ['.claude', '.claude-personal', '.claude-corp', '.claude-gpt'];
let home: string; let pkg: string;
const skill = (d: string, ...rest: string[]) => path.join(home, d, 'skills', 'graphify', ...rest);

// `PKG_DESCRIPTION` and `skillMd` live in graphifySkillFixture.ts — one
// definition for the three install suites that plant this package (D-1366).
const frontmatterDescription = (md: string) => {
  const fm = /^---\n([\s\S]*?)\n---/.exec(md);
  return /^description:(.*)$/m.exec(fm ? fm[1] : '')?.[1] ?? '';
};

beforeEach(() => {
  home = mkTmp('ccrc-gfxskill-');
  for (const d of HOMES) fs.mkdirSync(path.join(home, d), { recursive: true });
  // a fake installed package: skill body at <pkg>/skill.md, refs sidecar under skills/claude/
  pkg = path.join(home, 'fake-pkg');
  fs.mkdirSync(path.join(pkg, 'skills', 'claude', 'references'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'skill.md'), skillMd(PKG_DESCRIPTION));
  fs.writeFileSync(path.join(pkg, 'skills', 'claude', 'references', 'update.md'), 'ref\n');
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

// spawnSync, not execFileSync, because the installer's description report is a
// STDERR line on an exit-0 run — a report, never a refusal — and execFileSync
// hands back stdout alone.
const attempt = (...homes: string[]) =>
  spawnSync('bash', [INSTALLER, '--homes',
    ...(homes.length ? homes : HOMES.map((d) => path.join(home, d)))],
    { env: { ...process.env, HOME: home, CCRC_GRAPHIFY_PKG: pkg, CCRC_GRAPHIFY_PIN: '0.9.9' },
      encoding: 'utf8' });
const run = (...homes: string[]) => {
  const r = attempt(...homes);
  if (r.status !== 0) throw new Error(`install-graphify-skill exit ${r.status}: ${r.stderr}`);
  return r;
};

describe('install-graphify-skill', () => {
  it('assembles SKILL.md + references/ + .graphify_version into every home', () => {
    run();
    for (const d of HOMES) {
      expect(fs.readFileSync(skill(d, 'SKILL.md'), 'utf8')).toBe(skillMd(PKG_DESCRIPTION));
      expect(fs.readFileSync(skill(d, 'references', 'update.md'), 'utf8')).toBe('ref\n');
      expect(fs.readFileSync(skill(d, '.graphify_version'), 'utf8')).toBe('0.9.9');
    }
  });
  it('is idempotent: a second run leaves inode and mtime alone', () => {
    run();
    const p = skill('.claude', 'SKILL.md');
    const before = fs.statSync(p);
    run();
    const after = fs.statSync(p);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
  it('writes a symlinked skills dir exactly once (realpath de-dup)', () => {
    // .claude-gpt/skills -> .claude/skills, the live fleet's real shape (spec §B)
    fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
    fs.symlinkSync(path.join(home, '.claude', 'skills'), path.join(home, '.claude-gpt', 'skills'));
    run(path.join(home, '.claude'), path.join(home, '.claude-gpt'));
    // the backup dir would carry TWO entries if the second write re-swapped through the symlink
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(true);
    const backups = path.join(home, 'ccrc-backups');
    expect(fs.existsSync(backups)).toBe(false);   // fresh install: no backup, and no double-swap
  });
  // Spec §1's artifact table, row 3: the graphify skill is one of the five
  // artifacts the read side is allowed to live in, and what earns it that row is
  // its DESCRIPTION — "especially when graphify-out/ exists, where the question
  // should be treated as a graphify query first" is the sentence that makes a
  // session query the graph before it greps. That text is the PINNED PACKAGE's,
  // copied verbatim (`cp -a "$PKG/skill.md" "$STAGE/SKILL.md"`): ccrc neither
  // writes nor owns it, and doctor's `_check_graphify` compares `.graphify_version`
  // stamps only, never content. So a `GRAPHIFY_PIN` bump whose skill.md reworded
  // the clause away would delete a fifth of the read side with every suite green —
  // the class of D-1355. The guard therefore lives in the INSTALLER, which is the
  // only thing that ever sees the real package, and it REPORTS rather than refuses
  // (a drifted description is still worth installing). These two pin both arms.
  it('carries the query-first clause into every assembled SKILL.md, and says nothing', () => {
    const r = run();
    for (const d of HOMES) {
      const desc = frontmatterDescription(fs.readFileSync(skill(d, 'SKILL.md'), 'utf8'));
      expect(desc).toMatch(/graphify-out\//);
      expect(desc).toMatch(/graphify query/);
    }
    expect(r.stderr).toBe('');            // a faithful description is a silent install
  });
  // Two reworded descriptions, one per token, so neither half of the match can be
  // dropped and no `&&` can become an `||` without a red row: the first keeps the
  // tree and loses the instruction, the second keeps the instruction and loses the
  // tree it applies to. Match is on the two tokens, never the whole sentence, so a
  // harmless rewording stays green.
  it.each([
    ['keeps the tree, loses the instruction',
     'Use for any question about a codebase, its architecture or its content — especially when'
     + ' graphify-out/ exists.'],
    ['keeps the instruction, loses the tree it applies to',
     'Use for any question about a codebase — treat it as a graphify query first, and read the'
     + ' report only for broad architecture.'],
  ])('reports the pin — and installs anyway — when the packaged description %s', (_which, description) => {
    fs.writeFileSync(path.join(pkg, 'skill.md'), skillMd(description));
    const r = run();                                        // exit 0: a report, not a refusal
    expect(r.stderr).toMatch(/graphify query/);
    expect(r.stderr).toMatch(/graphify-out\//);
    expect(r.stderr).toMatch(/pin 0\.9\.9/);                 // names the pin the rewording arrived on
    // and the skill still lands, unedited — ccrc reports the package's text, never rewrites it
    expect(fs.readFileSync(skill('.claude', 'SKILL.md'), 'utf8')).toBe(skillMd(description));
  });
  it('refuses loudly when the package carries no skill body', () => {
    fs.rmSync(path.join(pkg, 'skill.md'));
    expect(() => run()).toThrow();
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(false);
  });
});
