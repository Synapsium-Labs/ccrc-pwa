// The design system's contrast gate, run as a test.
//
// design/contrast-check.mjs is the file every ratio quoted in tokens.css comes
// from — but a pair that isn't in it is a pair nothing can regress on. Two
// colour combinations shipped with the ask sheet (the header chip's accent on
// --accent-tint, the preview toggle's accent on --bg-sheet) were live in the
// CSS while the gate still measured 74 pairs and reported ALL PASS. So the
// suite runs the gate itself: any FAIL fails here, and the pairs listed below
// must be among the ones it actually measured, in both themes.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const out = execFileSync(
  process.execPath,
  [path.resolve(process.cwd(), 'design/contrast-check.mjs')],
  { encoding: 'utf8' },
);

/** "PASS 4.58 (min 4.5) LIGHT ask header chip / accent-tint #0E7B3F on #DFF2E5" */
const measured = (label: string): { ratio: number; min: number } => {
  const line = out
    .split('\n')
    .find((l) => l.includes(label));
  if (line === undefined) throw new Error(`contrast gate measures no pair matching "${label}"`);
  const [, ratio, min] = /^\w+\s+([\d.]+)\s+\(min ([\d.]+)\)/.exec(line.trim()) ?? [];
  return { ratio: Number(ratio), min: Number(min) };
};

describe('contrast gate', () => {
  it('passes every pair it measures', () => {
    expect(out).not.toMatch(/^FAIL/m);
    expect(out).toMatch(/\nALL \d+ PASS/);
  });

  // 11px text (--text-2xs) is body text, not a UI glyph: 4.5, not 3:1.
  it.each([
    'DARK  ask header chip / accent-tint',
    'LIGHT ask header chip / accent-tint',
    'DARK  preview toggle / sheet',
    'LIGHT preview toggle / sheet',
  ])('measures %s at the 4.5 body threshold', (label) => {
    const { ratio, min } = measured(label);
    expect(min).toBe(4.5);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
