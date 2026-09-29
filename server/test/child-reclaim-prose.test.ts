// Child reclamation, wave 3 — the two operator-facing documents that state
// who may remove a workspace (spec 2026-09-22 §6). Both are narrowed, never
// widened: every destructive verb stays forbidden to every session, `ws-reap`
// stays human-only, and the ONE new remover is the server, on a child only.
// The skills' own sentences are pinned in their own census files
// (`coordinator-skill`, `worker-skill`, `reviewer-skill`); these two files
// have no census of their own for this, so they get one here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const flat = (f: string): string => readFileSync(path.join(root, f), 'utf8').replace(/\s+/g, ' ');

describe('CLAUDE.md’s SAFETY bullet', () => {
  const md = flat('CLAUDE.md');
  it('still forbids all five destructive verbs, and keeps ws-reap human-only', () => {
    expect(md).toContain('All five forbidden; `ws-reap` is **human-only by contract**.');
  });
  it('forbids ws-reclaim to every session, and says whose act it is and on what', () => {
    expect(md).toContain('**`ws-reclaim` is forbidden to every session too**');
    expect(md).toContain('it is the SERVER\'s act on a CHILD workspace only');
    expect(md).toContain('never a session\'s verb, and never run against the live host from a shell or a test');
  });
});

describe('README’s “ws-reap stays human-only” paragraph', () => {
  const readme = flat('README.md');
  it('keeps the human-only rule and narrows it by exactly the server’s child reclaim', () => {
    const at = readme.indexOf('that **`ws-reap` stays human-only, by convention plus a speed bump');
    expect(at, 'the human-only paragraph is gone').toBeGreaterThanOrEqual(0);
    const child = readme.indexOf('**A child is not a reap.**');
    expect(child, 'the narrowing is gone, or it moved away from the rule it narrows').toBeGreaterThan(at);
    const para = readme.slice(child, child + 900);
    expect(para).toContain('`ccd ws-reclaim`');
    expect(para).toContain('the server composes it and no session runs it');
    expect(para).toContain('a coordinator\'s own workspace is still cleaned up by a human');
  });
  it('limits "holds every workspace it owns" to the workspaces that are not children', () => {
    // A close releases every finished child and the server reclaims it with
    // no deliberate release, so the unlimited clause would contradict the
    // narrowing two sentences later.
    expect(readme).toContain('the coordinator holds every non-child workspace it owns so a reap needs a deliberate release first');
    expect(readme).not.toContain('the coordinator holds every workspace it owns');
  });
});
