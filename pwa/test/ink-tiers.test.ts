// THE THREE INK TIERS ARE THREE INKS (D-5097).
//
// `--ink-primary`, `--ink-secondary` and `--ink-tertiary` say "this matters",
// "this is supporting" and "this is meta" — a timestamp, a chip label, the
// fleet count. The generator used to fit all three from the SAME seed against
// the SAME floor, so wherever the seed already cleared that floor all three
// came out as the seed itself. Measured on the base this file was written
// against, OKLab lightness distance between primary and tertiary: Nord, Tokyo
// Night, Dracula, GitHub Light and Catppuccin Latte 0.000; Gruvbox Dark 0.003;
// Catppuccin Mocha 0.012; Solarized Light 0.067; Solarized Dark 0.084; One Dark
// 0.085. Ten of twelve palettes had one ink wearing three names.
//
// Four cases, each a different owner of the rule:
//   * the TREE — every palette's committed tiers are separated (the result),
//     at the gate's 0.12 everywhere and the generator's own 0.14 where it wrote;
//   * the GATE — contrast-check.mjs reds a collapsed palette (the contract);
//   * the WALK — tertiary was walked to the grounds it will actually sit on,
//     including the two Task 9 adds (the accent tint under the selected row,
//     and the pressed recipe), so those pairs hold before they are gated;
//   * the LIFT — primary was lifted toward 9:1, which is what opens the band,
//     and secondary, between the two, clears 6.0.
//
// The OKLab maths is inline on purpose: the gate and the generator each carry
// their own copy, and a test that imported either would agree with it by
// construction.
import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadThemes, ratio, resolveColor, stylesheets } from '../design/audit.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TOKENS = path.join(ROOT, '..', 'ui', 'src', 'styles', 'tokens.css');

/** The gate's floor and step, restated here as the contract this file holds. */
const TIER_FLOOR = 0.12;
const TIER_STEP = 0.04;
/** The generator's own, stricter floor: the gate's plus a margin. */
const GENERATED_TIER_FLOOR = 0.14;
/** The tertiary floor the generator walks to (4.5 plus a margin). */
const TERTIARY_FLOOR = 4.9;
/** Primary's lift target on the card grounds, and secondary's floor. */
const PRIMARY_TARGET = 9;
const SECONDARY_FLOOR = 6.0;

// ── OKLab lightness ─────────────────────────────────────────────────────────
const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const oklabL = (rgba: readonly number[]): number => {
  const [r, g, b] = [rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0].map(lin) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
};

/** The tiers' lightness, SIGNED toward the ground: positive means "steps from
 *  primary toward the card", which is the only direction a quieter ink can
 *  go. An absolute distance would pass a tertiary that is LOUDER than primary. */
function tiers(theme: Record<string, string>): { dL: number; ps: number; st: number } {
  const L = (name: string): number => oklabL(resolveColor(`var(${name})`, theme));
  const p = L('--ink-primary'), s = L('--ink-secondary'), t = L('--ink-tertiary');
  const toward = Math.sign(L('--bg-surface') - p) || 1;
  return { dL: (t - p) * toward, ps: (s - p) * toward, st: (t - s) * toward };
}

/** The palettes the generator owns, read off the GENERATED block itself —
 *  Phosphor's two are hand-tuned and answer to the gate, not to the walk. */
function generatedPalettes(): string[] {
  const css = readFileSync(TOKENS, 'utf8');
  const start = css.indexOf('/* === GENERATED THEMES');
  const end = css.indexOf('/* === END GENERATED THEMES === */');
  if (start < 0 || end < start) throw new Error('tokens.css has no GENERATED THEMES block');
  return [...css.slice(start, end).matchAll(/^\[data-theme='([a-z0-9-]+)'\]\s*\{/gm)].map((m) => m[1] as string);
}

// ── a throwaway copy of what the gate reads ────────────────────────────────
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 30_000);

/** `<tmp>/pwa` beside `<tmp>/ui`, the sibling layout `stylesheets()` spells
 *  (`../ui/src/...`), with `design/*.mjs` copied so the gate audits ITSELF. */
function gateTree(): string {
  const parent = mkdtempSync(path.join(tmpdir(), 'ink-tiers-'));
  made.push(parent);
  const dir = path.join(parent, 'pwa');
  mkdirSync(path.join(dir, 'design'), { recursive: true });
  for (const f of readdirSync(path.join(ROOT, 'design')).filter((n) => n.endsWith('.mjs'))) {
    cpSync(path.join(ROOT, 'design', f), path.join(dir, 'design', f));
  }
  for (const rel of stylesheets(ROOT)) {
    const dest = path.join(dir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(path.join(ROOT, rel), dest);
  }
  return dir;
}

describe('the ink tiers are three inks (D-5097)', () => {
  it("every palette's tiers are separated", () => {
    const { all } = loadThemes(ROOT);
    const generated = generatedPalettes().map((n) => n.toUpperCase());
    // Guards the guard: an empty loop passes everything.
    expect(all.length).toBeGreaterThan(5);
    const failures: string[] = [];
    for (const [label, theme] of all) {
      const { dL, ps, st } = tiers(theme);
      const name = label.trim();
      // The gate's 0.12 for every palette; the generator's own 0.14 for the
      // ones it wrote, so its margin is a measured fact rather than a hope.
      const floor = generated.includes(name) ? GENERATED_TIER_FLOOR : TIER_FLOOR;
      if (dL < floor) failures.push(`${name} ΔL(primary, tertiary) ${dL.toFixed(3)} < ${floor}`);
      if (ps < TIER_STEP) failures.push(`${name} primary → secondary ${ps.toFixed(3)} < ${TIER_STEP}`);
      if (st < TIER_STEP) failures.push(`${name} secondary → tertiary ${st.toFixed(3)} < ${TIER_STEP}`);
    }
    expect(failures).toEqual([]);
  });

  it('the gate reports a collapsed palette', () => {
    const dir = gateTree();
    const tokens = path.join(dir, '..', 'ui', 'src', 'styles', 'tokens.css');
    const css = readFileSync(tokens, 'utf8');
    const open = css.indexOf("[data-theme='nord'] {");
    expect(open, 'tokens.css has no nord block').toBeGreaterThan(0);
    const close = css.indexOf('}', open);
    const block = css.slice(open, close);
    const primary = /--ink-primary:\s*(#[0-9A-Fa-f]{6});/.exec(block)?.[1];
    expect(primary, 'nord declares no --ink-primary').toBeDefined();
    const collapsed = block.replace(/(--ink-tertiary:\s*)#[0-9A-Fa-f]{6};/, `$1${primary};`);
    writeFileSync(tokens, css.slice(0, open) + collapsed + css.slice(close));
    // The forged tree is MEASURED collapsed, rather than asserted changed: on a
    // tree where Nord already shipped collapsed the forgery is a no-op, and
    // that is exactly the tree this case has to red on.
    const forged = loadThemes(dir).byName['nord'];
    if (forged === undefined) throw new Error('the forged tree lost its nord palette');
    expect(forged['--ink-tertiary']).toBe(primary);

    const r = spawnSync(process.execPath, [path.join(dir, 'design', 'contrast-check.mjs')], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    // The ΔL row itself, not just any TIER row: with tertiary = primary the
    // step rows fail too, and a gate whose ΔL floor had gone to 0 would still
    // print those.
    expect(r.stdout).toMatch(/^FAIL\s+-?[\d.]+\s+\(min 0\.12\)\s+TIER NORD\s+ΔL primary → tertiary/m);
    // Secondary no longer sits between them: the step half of the contract.
    expect(r.stdout).toMatch(/^FAIL\s+-?[\d.]+\s+\(min 0\.04\)\s+TIER NORD\s+step secondary → tertiary/m);
    // And the tier section is what caught it: raising tertiary to primary can
    // only RAISE every contrast pair, so no other row has a reason to fail.
    const fails = r.stdout.split('\n').filter((l) => l.startsWith('FAIL'));
    expect(fails.length).toBeGreaterThan(0);
    expect(fails.filter((l) => !l.includes('TIER'))).toEqual([]);
  }, 30_000);

  it('tertiary clears 4.9 on surface, raised, page, sheet, the accent tint and the pressed recipe in every generated palette', () => {
    const { byName } = loadThemes(ROOT);
    const generated = generatedPalettes();
    expect(generated.length).toBeGreaterThan(5);
    // The pressed recipe is Task 9's `--bg-pressed`: ink-primary at 9% over
    // surface, mixed in sRGB. It is computed here from the palette's own two
    // tokens because the token does not exist yet — which is the point: the
    // walk had to hold it before the gate could.
    const GROUNDS: [string, string][] = [
      ['surface', 'var(--bg-surface)'],
      ['raised', 'var(--bg-raised)'],
      ['page', 'var(--bg-page)'],
      ['sheet', 'var(--bg-sheet)'],
      ['accent-tint', 'var(--accent-tint)'],
      ['pressed', 'color-mix(in srgb, var(--ink-primary) 9%, var(--bg-surface))'],
    ];
    const failures: string[] = [];
    for (const name of generated) {
      const theme = byName[name];
      if (theme === undefined) throw new Error(`generated palette ${name} did not load`);
      for (const [label, ground] of GROUNDS) {
        const r = ratio('var(--ink-tertiary)', [ground], theme);
        if (r < TERTIARY_FLOOR) failures.push(`${name} tertiary on ${label} ${r.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('primary reaches 9:1 on the card grounds (or the gamut runs out first) and secondary clears 6.0, in every generated palette', () => {
    // The band the other two tiers live in is OPENED by primary's lift; a
    // derivation that skipped it could still separate the tiers (by pushing
    // tertiary toward its floor) while leaving primary at the 4.5-plus-margin
    // fit it started from. "As far as the gamut allows" has one measurable
    // meaning: the primary is the gamut's last step, white on a dark palette
    // and black on a light one.
    const { byName } = loadThemes(ROOT);
    const generated = generatedPalettes();
    expect(generated.length).toBeGreaterThan(5);
    const CARD = ['var(--bg-surface)', 'var(--bg-raised)', 'var(--bg-page)', 'var(--bg-sheet)'];
    const NEUTRAL = [...CARD, 'var(--accent-tint)', 'color-mix(in srgb, var(--ink-primary) 9%, var(--bg-surface))'];
    const failures: string[] = [];
    for (const name of generated) {
      const theme = byName[name];
      if (theme === undefined) throw new Error(`generated palette ${name} did not load`);
      const primary = Math.min(...CARD.map((g) => ratio('var(--ink-primary)', [g], theme)));
      // The gamut's last step, read off the channels rather than spelled as a
      // hex: every channel at 255 (white) or at 0 (black). A typed hex here
      // would be one more hand copy of a palette colour, which
      // contrast.test.ts's sweep refuses outside its registry.
      const rgb = resolveColor('var(--ink-primary)', theme).slice(0, 3);
      const atEdge = rgb.every((c) => c === 255) || rgb.every((c) => c === 0);
      if (primary < PRIMARY_TARGET && !atEdge) failures.push(`${name} primary ${primary.toFixed(2)} (${String(theme['--ink-primary'])})`);
      const secondary = Math.min(...NEUTRAL.map((g) => ratio('var(--ink-secondary)', [g], theme)));
      if (secondary < SECONDARY_FLOOR) failures.push(`${name} secondary ${secondary.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });
});
