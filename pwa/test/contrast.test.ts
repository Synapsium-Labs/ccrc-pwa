// The design system's contrast gate, run as a test.
//
// design/contrast-check.mjs is the file every ratio quoted in tokens.css comes
// from — but a pair that isn't in it is a pair nothing can regress on. Two
// colour combinations shipped with the ask sheet (the header chip's accent on
// --accent-tint, the preview toggle's accent on --bg-sheet) were live in the
// CSS while the gate still measured 74 pairs and reported ALL PASS. So the
// suite runs the gate itself: any FAIL fails here, and the pairs listed below
// must be among the ones it actually measured, in both themes.
//
// spawnSync, not execFileSync: the gate exits non-zero on a failing pair, and
// a throw at import time would take the whole file down instead of reporting
// which pair regressed.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const run = spawnSync(
  process.execPath,
  [path.resolve(process.cwd(), 'design/contrast-check.mjs')],
  { encoding: 'utf8' },
);
const out = run.stdout;

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

  // Docs run the gate standalone (`… && node design/contrast-check.mjs`), so
  // the exit status — not just the printed summary — has to carry the verdict.
  // A gate that prints "2 FAILURES" and exits 0 is a gate no chain can trip on.
  it('exits 0 when every pair passes', () => {
    expect(run.status).toBe(0);
  });

  it('exits non-zero when a pair fails', () => {
    const gate = path.resolve(process.cwd(), 'design/contrast-check.mjs');
    // Same script, one token swapped for a colour that cannot pass on dark.
    const broken = readFileSync(gate, 'utf8').replace('inkP: "#ECF0EC"', 'inkP: "#151815"');
    const injected = path.join(mkdtempSync(path.join(tmpdir(), 'contrast-')), 'contrast-check.mjs');
    writeFileSync(injected, broken);
    const bad = spawnSync(process.execPath, [injected], { encoding: 'utf8' });

    expect(bad.stdout).toMatch(/^FAIL/m);
    expect(bad.status).not.toBe(0);
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

  // Originally the project-group header, which had no ground of its own, so
  // both of the things it put the attention hue behind sat on the bare page.
  // Same omission as the ask sheet's two pairs above: live in the CSS,
  // invisible to the gate. The dot (now .proj-card-attn, on a card surface —
  // kept here as a defensive floor on the raw hue/page combination) is a
  // glyph at 3:1; the projected-account line (.proj-add-acct[data-low]) is
  // 11px text at 4.5, which is exactly why it takes --status-attention-TEXT —
  // LIGHT's dot hue reads 3.58 on the page and would fail the body threshold.
  it.each([
    ['DARK  attention dot / page', 3],
    ['LIGHT attention dot / page', 3],
    ['DARK  attention-text / page', 4.5],
    ['LIGHT attention-text / page', 4.5],
  ])('measures %s at the %s threshold', (label, floor) => {
    const { ratio, min } = measured(label);
    expect(min).toBe(floor);
    expect(ratio).toBeGreaterThanOrEqual(floor);
  });
});
