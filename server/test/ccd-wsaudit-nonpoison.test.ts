// server/test/ccd-wsaudit-nonpoison.test.ts
//
// `wsaudit.test.ts` computes the refusal-token set by grepping THIS FILE'S TEXT
// with four regexes, comments included, and holds it set-equal to `SENTENCES`.
// The lifecycle emitter is a new writer of refusal-shaped JSON, so it is exactly
// the shape that could poison that scan — which is why the journal field is
// spelled `refusal`, never `refused`. ccd:2120-2126 and ccd:5834-5839 both record
// this class having shipped once already.
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts:1045`'s
// `/^ccd.*\.ts$/` containment scan. It reads ccd's TEXT and runs nothing, so it
// is compliant with no stub of its own.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';

const src = readFileSync(CCD, 'utf8');

const scan = (text: string): string[] => {
  const t = new Set<string>();
  for (const m of text.matchAll(/_reap_refuse\s+([a-zA-Z][a-zA-Z0-9_-]*)\b/g)) t.add(m[1]!);
  for (const m of text.matchAll(/"refused":"([a-zA-Z0-9-]+)"/g)) t.add(m[1]!);
  for (const m of text.matchAll(/'!([a-zA-Z0-9-]+)/g)) t.add(m[1]!);
  for (const m of text.matchAll(/"verdict":"([a-zA-Z0-9-]+)"/g)) { if (m[1] !== 'reapable') t.add(m[1]!); }
  return [...t].sort();
};

describe('the lifecycle block cannot poison wsaudit.test.ts\'s scan', () => {
  const from = src.indexOf('# ── lifecycle journal ');
  const to = src.indexOf('# ── end lifecycle journal ');

  it('found the block — an empty slice would pass every assertion below vacuously', () => {
    expect(from, 'LC-BEGIN marker not found in ccd').toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(src.slice(from, to).length).toBeGreaterThan(2000);
  });

  it('carries none of the four harvested shapes, in code OR in a comment', () => {
    // Mutant: spell the journal field `"refused":"` instead of `"refusal"` ->
    // this fails, AND wsaudit.test.ts's reverse direction fails with a token
    // SENTENCES has no copy for.
    //
    // Independent claims — one per shape — so a failure on one must not hide
    // whether the other three also fail. expect.soft per STANDING RULE #1,
    // softened from the brief's literal hard `expect` inside this loop.
    const slice = src.slice(from, to);
    for (const shape of [/_reap_refuse\s/, /"refused":"/, /"verdict":"/, /'!/]) {
      expect.soft(slice, `the lifecycle emitter is written in a harvested shape: ${shape}`).not.toMatch(shape);
    }
  });

  it('leaves the whole-file token set at exactly the 54 that shipped before build 9', () => {
    // Three independent claims about the same scan — STANDING RULE #1 —
    // softened from the brief's literal hard `expect`s so a first failure
    // does not hide the rest.
    expect.soft(scan(src)).toHaveLength(54);
    expect.soft(scan(src)).toContain('in-progress');
    expect.soft(scan(src)).not.toContain('refusal');
  });
});
