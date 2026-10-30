// D-7278 — who may run the deps-shed verb. Narrowed, never widened: every destructive verb stays forbidden to every
// session, and `ws-shed-deps` is the SERVER's act on a sleeping session's ignored dependency directories only. The skill
// corpora never name the verb (`ws-collect-prose.test.ts`'s argument: a skill that names a verb has given a model a reason
// to reach for it). The lifecycle policy's containment row changes for this one class, on the record.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const flat = (f: string): string => readFileSync(path.join(root, f), 'utf8').replace(/\s+/g, ' ');
const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? filesUnder(p) : [p];
});
const SKILLS = ['ccd/coordinator-skill', 'ccd/worker-skill', 'ccd/reviewer-skill'];

describe('CLAUDE.md’s SAFETY bullet (D-7278)', () => {
  const md = flat('CLAUDE.md');
  it('still forbids all five destructive verbs, and keeps ws-reap human-only, literally', () => {
    expect(md).toContain('All five forbidden; `ws-reap` is **human-only by contract**.');
  });
  it('forbids ws-shed-deps to every session, and says whose act it is and on what', () => {
    expect(md).toContain('**`ws-shed-deps` is forbidden to every session too** (D-7278)');
    expect(md).toContain('it is the SERVER\'s act on a SLEEPING worker\'s or coordinator\'s git-ignored, untracked dependency directories only');
    expect(md).toContain('re-proved on the box — never a session\'s verb, and never run against the live host from a shell or a test.');
  });
});

describe('agent/CLAUDE.md’s gated verbs', () => {
  it('names ws-shed-deps, on --session', () => {
    expect(flat('agent/CLAUDE.md')).toContain('`ws-shed-deps` requires `--session`');
  });
});

describe('the lifecycle policy records the one class the ruling took out of containment (D-7278)', () => {
  const policy = flat('docs/superpowers/specs/2026-08-11-artifact-lifecycle-policy.md');
  it('row 2 of the inventory names its collector for a sleeping session', () => {
    expect(policy).toContain('| 2 | `node_modules` inside a workspace');
    expect(policy).toContain('ws-shed-deps');
    expect(policy).toContain('D-7278');
  });
});

describe('the skill corpora never name the verb', () => {
  const files = SKILLS.flatMap((d) => filesUnder(path.join(root, d)));
  it('reads every skill file there is — an empty corpus would pass vacuously', () => {
    expect(files.length).toBeGreaterThanOrEqual(SKILLS.length);
  });
  it.each(SKILLS)('%s never names ws-shed-deps', (dir) => {
    const own = files.filter((p) => p.startsWith(path.join(root, dir) + path.sep));
    expect(own.length).toBeGreaterThan(0);
    for (const f of own) expect(readFileSync(f, 'utf8'), path.relative(root, f)).not.toContain('ws-shed-deps');
  });
});
