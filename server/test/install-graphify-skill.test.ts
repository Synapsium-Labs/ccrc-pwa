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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-graphify-skill.sh');
const HOMES = ['.claude', '.claude-personal', '.claude-corp', '.claude-gpt'];
let home: string; let pkg: string;
const skill = (d: string, ...rest: string[]) => path.join(home, d, 'skills', 'graphify', ...rest);

beforeEach(() => {
  home = mkTmp('ccrc-gfxskill-');
  for (const d of HOMES) fs.mkdirSync(path.join(home, d), { recursive: true });
  // a fake installed package: skill body at <pkg>/skill.md, refs sidecar under skills/claude/
  pkg = path.join(home, 'fake-pkg');
  fs.mkdirSync(path.join(pkg, 'skills', 'claude', 'references'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'skill.md'), '# graphify skill body\n');
  fs.writeFileSync(path.join(pkg, 'skills', 'claude', 'references', 'update.md'), 'ref\n');
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const run = (...homes: string[]) =>
  execFileSync('bash', [INSTALLER, '--homes',
    ...(homes.length ? homes : HOMES.map((d) => path.join(home, d)))],
    { env: { ...process.env, HOME: home, CCRC_GRAPHIFY_PKG: pkg, CCRC_GRAPHIFY_PIN: '0.9.9' } });

describe('install-graphify-skill', () => {
  it('assembles SKILL.md + references/ + .graphify_version into every home', () => {
    run();
    for (const d of HOMES) {
      expect(fs.readFileSync(skill(d, 'SKILL.md'), 'utf8')).toBe('# graphify skill body\n');
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
  it('refuses loudly when the package carries no skill body', () => {
    fs.rmSync(path.join(pkg, 'skill.md'));
    expect(() => run()).toThrow();
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(false);
  });
});
