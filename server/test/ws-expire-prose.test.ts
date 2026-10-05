// Workspace lifecycle wave 3 — who may remove an ARCHIVED workspace (spec 2026-09-24 §5.3, "The contracts that
// move"). Narrowed, never widened: every destructive verb stays forbidden to every session, `ws-reap` stays human-only
// literally, and the one new remover is the server, on an archived workspace seven days after its archive. The skill
// corpora never name the verb — CCR-15 wave 3's ruling for the server-composed `ws-reclaim`, and the same argument:
// a skill that names a verb has given a model a reason to reach for it.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const flat = (f: string): string => readFileSync(path.join(root, f), 'utf8').replace(/\s+/g, ' ');

/** Every file under a skill's directory, recursively — SKILL.md and every reference it ships. */
const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? filesUnder(p) : [p];
});
const SKILLS = ['ccd/coordinator-skill', 'ccd/worker-skill', 'ccd/reviewer-skill'];

describe('CLAUDE.md’s SAFETY bullet', () => {
  const md = flat('CLAUDE.md');
  it('still forbids all five destructive verbs, and keeps ws-reap human-only, literally', () => {
    expect(md).toContain('All five forbidden; `ws-reap` is **human-only by contract**.');
  });
  it('forbids ws-expire to every session, and says whose act it is, on what and when', () => {
    expect(md).toContain('**`ws-expire` is forbidden to every session too**');
    expect(md).toContain('it is the SERVER\'s act on an ARCHIVED workspace only, seven days after its archive');
    expect(md).toContain('(never a main checkout, never a child)');
    expect(md).toContain('with a token that binds that archive and is re-proved on the box');
  });
});

describe('agent/CLAUDE.md’s gated verbs', () => {
  it('names ws-expire beside ws-reclaim, on its confirmation token', () => {
    expect(flat('agent/CLAUDE.md')).toContain('`ws-expire` requires `--expect` (the expiry token, which binds the archive;');
  });
});

describe('the skill corpora never name the verb', () => {
  const files = SKILLS.flatMap((d) => filesUnder(path.join(root, d)));
  it('reads every skill file there is — an empty corpus would pass vacuously', () => {
    expect(files.length).toBeGreaterThanOrEqual(SKILLS.length);
  });
  it.each(SKILLS)('%s never names ws-expire', (dir) => {
    for (const f of files.filter((p) => p.startsWith(path.join(root, dir)))) {
      expect(readFileSync(f, 'utf8'), path.relative(root, f)).not.toContain('ws-expire');
    }
  });
});
