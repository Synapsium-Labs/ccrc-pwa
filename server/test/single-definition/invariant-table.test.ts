// THE INVARIANT TABLE IS TABLE 11.7a, BOTH WAYS (Overlord W1, sequence PR B2; plan w1-sequence-monitor.md Task 4). The
// monitor's `INVARIANT_MAP` (`server/src/coord/invariants.ts`) has one row per invariant of the spec's Table 11.7a and nothing
// else: a row the spec adds, or a row the map invents, reds here. A guard over the whole tree's spec, so it sits in this
// directory, which the fast plan runs.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INVARIANT_MAP, INVARIANT_NAMES } from '../../src/coord/invariants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SPEC = path.join(ROOT, 'docs/superpowers/specs/2026-11-09-overlord-design.md');

/** The I-numbers of the table whose caption is Table 11.7a: the `| I<n> |` rows above that caption, after its header. */
function specInvariantNames(text: string): string[] {
  const lines = text.split('\n');
  const caption = lines.findIndex((l) => l.startsWith('*Table 11.7a.'));
  if (caption < 0) throw new Error('no Table 11.7a caption in the spec');
  let header = caption - 1;
  while (header >= 0 && !/^\| # \| Invariant \|/.test(lines[header]!)) header -= 1;
  if (header < 0) throw new Error('no header row above Table 11.7a');
  return lines.slice(header + 2, caption).flatMap((l) => /^\| (I\d+) \|/.exec(l)?.[1] ?? []);
}

describe('INVARIANT_MAP is Table 11.7a', () => {
  it('names every invariant of the spec\'s table, and nothing else, in its order', () => {
    expect(INVARIANT_NAMES).toEqual(specInvariantNames(readFileSync(SPEC, 'utf8')));
  });
  it('I9 alone is simulator-only (§10.4: "I9 compares against a build without the Overlord")', () => {
    expect(INVARIANT_NAMES.filter((n) => INVARIANT_MAP[n].w1 === 'simulator-only')).toEqual(['I9']);
  });
  it('CONTROL: a row the spec adds or drops is seen', () => {
    const table = (rows: string[]): string => ['| # | Invariant |', '|---|---|', ...rows.map((r) => `| ${r} | text |`), '', '*Table 11.7a. Caption.*'].join('\n');
    expect(specInvariantNames(table(['I1', 'I2']))).toEqual(['I1', 'I2']);
    expect(specInvariantNames(table(['I1', 'I2', 'I19']))).not.toEqual(['I1', 'I2']);
  });
});
