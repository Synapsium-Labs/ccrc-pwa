// Child reclamation wave 7 — who may run the temp-root collector (spec 2026-09-22 §5.10). Narrowed, never widened:
// every destructive verb stays forbidden to every session, `ws-reap` stays human-only literally, and `ws-collect` is the
// SERVER's act on an orphaned, witnessed temp root only, behind a token re-proved on the box. The skill
// corpora never name the verb — `ws-expire-prose.test.ts`'s argument, made again: a skill that names a verb has given a
// model a reason to reach for it.
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
  it('forbids ws-collect to every session, and says whose act it is and on what', () => {
    expect(md).toContain('**`ws-collect` is forbidden to every session too**');
    expect(md).toContain('it is the SERVER\'s act on an ORPHANED, WITNESSED temp root only');
    expect(md).toContain('behind a token re-proved on the box — never a session\'s verb');
  });
});

describe('agent/CLAUDE.md’s gated verbs', () => {
  it('names ws-collect beside ws-expire, on its confirmation token', () => {
    expect(flat('agent/CLAUDE.md')).toContain('`ws-collect` requires `--expect` (the collection token, which binds the witnessed temp root;');
  });
});

describe('the skill corpora never name the verb', () => {
  const files = SKILLS.flatMap((d) => filesUnder(path.join(root, d)));
  it('reads every skill file there is — an empty corpus would pass vacuously', () => {
    expect(files.length).toBeGreaterThanOrEqual(SKILLS.length);
  });
  it.each(SKILLS)('%s never names ws-collect', (dir) => {
    const own = files.filter((p) => p.startsWith(path.join(root, dir) + path.sep));
    expect(own.length, `${dir} has files to read — an empty directory would pass vacuously`).toBeGreaterThan(0);
    for (const f of own) {
      expect(readFileSync(f, 'utf8'), path.relative(root, f)).not.toContain('ws-collect');
    }
  });
});
