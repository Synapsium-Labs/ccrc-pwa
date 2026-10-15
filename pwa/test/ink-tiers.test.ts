// THE THREE INK TIERS ARE THREE INKS (D-5097), AND PRIMARY STAYS THE
// PALETTE'S OWN INK (D-5155).
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
// The band is opened by the QUIET tiers. Primary is what makes a palette
// recognisable — Nord's primary is Nord — so it moves last, by lightness alone,
// and never more than one just-noticeable difference (D-5155).
//
// Six cases, each a different owner of the rule:
//   * the TREE — every palette's committed tiers are separated at the gate's
//     0.12, with secondary the OKLab midpoint;
//   * the GATE, twice — contrast-check.mjs reds a palette whose tertiary has
//     collapsed onto primary, and one whose secondary has (each TIER row has
//     its own forgery, so deleting or zeroing either row reds here);
//   * the WALK — tertiary was walked to the grounds it will actually sit on,
//     including the two Task 9 adds (the accent tint under the selected row,
//     and the pressed recipe), to 4.9 and past it only while the band needed;
//   * the IDENTITY — primary is within ΔEOK 0.02 of the ink it was fitted to,
//     moved by lightness alone, and moved only where the gate's band needed it;
//   * the EDGE — `--edge-strong` is fitted against the FINAL primary.
//
// The OKLab maths is inline on purpose: the gate and the generator each carry
// their own copy, and a test that imported either would agree with it by
// construction. So is the replay of the generator's `fit` that the identity
// and edge cases need: it is restated here from the rule, not imported.
import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadThemes, ratio, resolveColor, stylesheets } from '../design/audit.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TOKENS = path.join(ROOT, '..', 'ui', 'src', 'styles', 'tokens.css');
const GENERATOR = path.join(ROOT, '..', 'ui', 'design', 'make-themes.mjs');

/** The gate's floor and step, restated here as the contract this file holds. */
const TIER_FLOOR = 0.12;
const TIER_STEP = 0.04;
/** The band the quiet tiers aim for (the gate's plus a margin): tertiary
 *  walks past 4.9 only while the band is under it. */
const TIER_AIM = 0.14;
/** Tertiary's preferred stop, and the lowest it may go: the gate's text floor. */
const TERTIARY_FLOOR = 4.9;
const TERTIARY_MIN = 4.5;
/** How far primary may move from the ink it was fitted to: one JND in OKLab
 *  (the 0.02 CSS Color 4's gamut mapping uses), D-5155. */
const PRIMARY_CAP = 0.02;

type Rgb = [number, number, number];

// ── OKLab ───────────────────────────────────────────────────────────────────
const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const unlin = (c: number): number => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const oklab = (rgb: readonly number[]): Rgb => {
  const [r, g, b] = [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0].map(lin) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
};
const fromLch = (L: number, C: number, h: number): Rgb => {
  const [A, B] = [C * Math.cos(h), C * Math.sin(h)];
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map(unlin) as Rgb;
};
const lch = (rgb: readonly number[]): Rgb => {
  const [L, a, b] = oklab(rgb);
  return [L, Math.hypot(a, b), Math.atan2(b, a)];
};
const deltaE = (x: readonly number[], y: readonly number[]): number => {
  const [p, q] = [oklab(x), oklab(y)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
/** What a hex holds: each channel rounded and clamped. */
const emit = (rgb: readonly number[]): Rgb =>
  [0, 1, 2].map((i) => Math.round(Math.max(0, Math.min(255, rgb[i] ?? 0)))) as Rgb;
const same = (x: readonly number[], y: readonly number[]): boolean => [0, 1, 2].every((i) => x[i] === y[i]);

// ── the generator's `fit`, replayed from its rule ───────────────────────────
// Keep `seed` if it clears `target` on every ground; otherwise step its OKLab
// lightness outward 0.004 at a time, nearest first and `hint`'s side first at
// each distance, hue and chroma held, and keep the first in-gamut value that
// clears. (The rule's chroma-bleed fallback is not replayed: no ink or edge
// takes it, and a replay that needed it throws rather than guess.)
const wcagLum = (c: readonly number[]): number =>
  0.2126 * lin(c[0] ?? 0) + 0.7152 * lin(c[1] ?? 0) + 0.0722 * lin(c[2] ?? 0);
const wcag = (a: readonly number[], b: readonly number[]): number => {
  const [x, y] = [wcagLum(a), wcagLum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
function fitReplay(seed: Rgb, grounds: readonly Rgb[], target: number, hint: 'up' | 'down'): Rgb {
  const clears = (c: readonly number[]): boolean => grounds.every((g) => wcag(c, g) >= target);
  if (clears(seed)) return seed;
  const [L0, C, h] = lch(seed);
  const order = hint === 'down' ? [-1, +1] : [+1, -1];
  for (let i = 1; i <= 260; i += 1) {
    for (const sign of order) {
      const L = L0 + sign * i * 0.004;
      if (L > 1.02 || L < -0.02) continue;
      const c = fromLch(L, C, h);
      if (c.every((v) => v >= -0.5 && v <= 255.5) && clears(c)) return emit(c);
    }
  }
  throw new Error(`the fit replay found no value for ${seed.join(',')} at ${target}`);
}

/** Each seed's `dark` flag and own ink, read from the generator's source —
 *  the palette's identity, not a copy typed here. */
function seeds(): Map<string, { dark: boolean; ink: Rgb }> {
  const src = readFileSync(GENERATOR, 'utf8');
  const out = new Map<string, { dark: boolean; ink: Rgb }>();
  for (const m of src.matchAll(/\{\s*name:\s*'([a-z0-9-]+)',\s*label:\s*'[^']*',\s*dark:\s*(true|false),[^}]*?\bink:\s*'#([0-9A-Fa-f]{6})'/g)) {
    const hex = m[3] as string;
    out.set(m[1] as string, {
      dark: m[2] === 'true',
      ink: [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb,
    });
  }
  return out;
}

const rgbOf = (theme: Record<string, string>, token: string): Rgb =>
  resolveColor(`var(${token})`, theme).slice(0, 3) as Rgb;
const CARD = ['--bg-surface', '--bg-raised', '--bg-page', '--bg-sheet'];

/** Primary as `build()` fits it before the tiers see it: 4.5 + 2.0 on the
 *  card grounds, then 4.5 + 1.4 with the accent tint added. */
function fittedPrimary(seed: { dark: boolean; ink: Rgb }, theme: Record<string, string>): Rgb {
  const card = CARD.map((t) => rgbOf(theme, t));
  const hint = seed.dark ? 'up' : 'down';
  const first = fitReplay(seed.ink, card, 4.5 + 2.0, hint);
  return fitReplay(first, [...card, rgbOf(theme, '--accent-tint')], 4.5 + 1.4, hint);
}

/** The tiers' lightness, SIGNED toward the ground: positive means "steps from
 *  primary toward the card", which is the only direction a quieter ink can
 *  go. An absolute distance would pass a tertiary that is LOUDER than primary. */
function tiers(theme: Record<string, string>): { dL: number; ps: number; st: number } {
  const L = (name: string): number => oklab(rgbOf(theme, name))[0];
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

/** Copy the gate's inputs, set Nord's `token` to its own `--ink-primary`,
 *  prove the copy carries that forgery, and run the gate there. */
function gateWithNordCollapsed(token: '--ink-secondary' | '--ink-tertiary'): { status: number | null; stdout: string } {
  const dir = gateTree();
  const tokens = path.join(dir, '..', 'ui', 'src', 'styles', 'tokens.css');
  const css = readFileSync(tokens, 'utf8');
  const open = css.indexOf("[data-theme='nord'] {");
  expect(open, 'tokens.css has no nord block').toBeGreaterThan(0);
  const close = css.indexOf('}', open);
  const block = css.slice(open, close);
  const primary = /--ink-primary:\s*(#[0-9A-Fa-f]{6});/.exec(block)?.[1];
  expect(primary, 'nord declares no --ink-primary').toBeDefined();
  const collapsed = block.replace(new RegExp(`(${token}:\\s*)#[0-9A-Fa-f]{6};`), `$1${primary};`);
  writeFileSync(tokens, css.slice(0, open) + collapsed + css.slice(close));
  // The forged tree is MEASURED collapsed, rather than asserted changed: on a
  // tree where Nord already shipped collapsed the forgery is a no-op, and
  // that is exactly the tree this case has to red on.
  const forged = loadThemes(dir).byName['nord'];
  if (forged === undefined) throw new Error('the forged tree lost its nord palette');
  expect(forged[token]).toBe(primary);
  const r = spawnSync(process.execPath, [path.join(dir, 'design', 'contrast-check.mjs')], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout };
}

describe('the ink tiers are three inks (D-5097)', () => {
  it("every palette's tiers are separated, secondary at the midpoint", () => {
    const { all } = loadThemes(ROOT);
    const generated = generatedPalettes().map((n) => n.toUpperCase());
    // Guards the guard: an empty loop passes everything.
    expect(all.length).toBeGreaterThan(5);
    const failures: string[] = [];
    for (const [label, theme] of all) {
      const { dL, ps, st } = tiers(theme);
      const name = label.trim();
      if (dL < TIER_FLOOR) failures.push(`${name} ΔL(primary, tertiary) ${dL.toFixed(3)} < ${TIER_FLOOR}`);
      if (ps < TIER_STEP) failures.push(`${name} primary → secondary ${ps.toFixed(3)} < ${TIER_STEP}`);
      if (st < TIER_STEP) failures.push(`${name} secondary → tertiary ${st.toFixed(3)} < ${TIER_STEP}`);
      // The generator's secondary is the OKLab midpoint of the other two, so
      // its two steps differ only by the hex's rounding. Phosphor's are
      // hand-tuned and owe only the steps.
      if (generated.includes(name) && Math.abs(ps - st) > 0.005) {
        failures.push(`${name} secondary is off the midpoint: steps ${ps.toFixed(3)} / ${st.toFixed(3)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('the gate reports a collapsed palette', () => {
    const r = gateWithNordCollapsed('--ink-tertiary');
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

  it('the gate reports a secondary collapsed onto primary', () => {
    // The other step row's own forgery. The case above leaves secondary where
    // it was, so its primary → secondary step still measures a healthy 0.07
    // and passes whether this row exists or not: deleting the row, or zeroing
    // its floor, reddened nothing until this case. Here tertiary keeps the
    // whole band (ΔL passes) and only this step collapses.
    const r = gateWithNordCollapsed('--ink-secondary');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/^FAIL\s+-?[\d.]+\s+\(min 0\.04\)\s+TIER NORD\s+step primary → secondary/m);
    expect(r.stdout).toMatch(/^PASS\s+[\d.]+\s+\(min 0\.12\)\s+TIER NORD\s+ΔL primary → tertiary/m);
    // Raising secondary to primary can only RAISE its contrast pairs.
    const fails = r.stdout.split('\n').filter((l) => l.startsWith('FAIL'));
    expect(fails.filter((l) => !l.includes('TIER'))).toEqual([]);
  }, 30_000);

  it('tertiary clears the text floor on all six grounds, stops at 4.9 when the band allows, and walks past it only as far as the band needs', () => {
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
      const on = GROUNDS.map(([label, ground]) => [label, ratio('var(--ink-tertiary)', [ground], theme)] as const);
      for (const [label, r] of on) {
        if (r < TERTIARY_MIN) failures.push(`${name} tertiary on ${label} ${r.toFixed(2)}`);
      }
      const w = Math.min(...on.map(([, r]) => r));
      const { dL } = tiers(theme);
      // The walk's three outcomes, each read off the tree. (Tolerances are
      // one walk step: 0.001 L moves the ratio by about 0.02, and a hex's
      // rounding by up to 0.05.)
      if (w >= TERTIARY_FLOOR) {
        // Stopped at 4.9: only because the band already had its margin, and at
        // the LAST value that clears — as quiet as its floor allows.
        if (dL < TIER_AIM) failures.push(`${name} tertiary stopped at ${w.toFixed(2)} with the band at ${dL.toFixed(3)}`);
        if (w >= TERTIARY_FLOOR + 0.1) failures.push(`${name} tertiary stopped short of 4.9, at ${w.toFixed(2)}`);
      } else if (dL < TIER_AIM) {
        // Walked past 4.9 because the band was short: then all the way to the floor.
        if (w >= TERTIARY_MIN + 0.1) failures.push(`${name} tertiary stopped at ${w.toFixed(2)} with the band short at ${dL.toFixed(3)}`);
      } else if (dL >= TIER_AIM + 0.005) {
        // Walked past 4.9 although the band was already wide.
        failures.push(`${name} tertiary went to ${w.toFixed(2)} for a band of ${dL.toFixed(3)}, past the ${TIER_AIM} it needed`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("primary stays the palette's own ink: within ΔEOK 0.02 of its fit, by lightness alone, and only where the gate's band needs it (D-5155)", () => {
    const { byName } = loadThemes(ROOT);
    const generated = generatedPalettes();
    const SEEDS = seeds();
    // Every generated palette has its seed read, or the case proves nothing.
    expect([...SEEDS.keys()].sort()).toEqual([...generated].sort());
    const failures: string[] = [];
    let held = 0;
    for (const name of generated) {
      const theme = byName[name];
      const seed = SEEDS.get(name);
      if (theme === undefined || seed === undefined) throw new Error(`generated palette ${name} did not load`);
      const fitted = fittedPrimary(seed, theme);
      const primary = rgbOf(theme, '--ink-primary');
      if (same(primary, fitted)) {
        held += 1;
        continue;
      }
      const moved = deltaE(primary, fitted);
      if (moved > PRIMARY_CAP) failures.push(`${name} primary moved ΔEOK ${moved.toFixed(3)} from its fit, past the ${PRIMARY_CAP} cap`);
      // Lightness alone: a and b (hue and chroma) are the fit's, to the hex's rounding.
      const [, a1, b1] = oklab(primary);
      const [, a0, b0] = oklab(fitted);
      if (Math.hypot(a1 - a0, b1 - b0) > 0.004) failures.push(`${name} primary's hue or chroma moved, not just its lightness`);
      // Only where the gate's band needed it, and only as far: a moved primary
      // either just reached 0.12, or is still short of it at the cap.
      const { dL } = tiers(theme);
      if (dL >= TIER_FLOOR + 0.005) {
        failures.push(`${name} primary moved ΔEOK ${moved.toFixed(3)} although the band reads ${dL.toFixed(3)}`);
      }
      if (dL < TIER_FLOOR && moved < PRIMARY_CAP - 0.002) {
        failures.push(`${name} primary stopped at ΔEOK ${moved.toFixed(3)} with the band short at ${dL.toFixed(3)}`);
      }
    }
    expect(failures).toEqual([]);
    // The ruling's own example: Nord's primary is Nord's ink, exactly.
    const nord = SEEDS.get('nord');
    const nordTheme = byName['nord'];
    if (nord === undefined || nordTheme === undefined) throw new Error('nord did not load');
    expect(rgbOf(nordTheme, '--ink-primary')).toEqual(nord.ink);
    // Guards the guard: a replay that never matched would pass the cap above
    // on every palette by measuring the wrong distance.
    expect(held).toBeGreaterThanOrEqual(3);
  });

  it('`--edge-strong` is fitted against the FINAL primary, not the seed ink', () => {
    // It is the INK of the inverted active row, where `--ink-primary` is the
    // GROUND, so it is fitted to clear 4.5 + 0.2 on that ground. Fitted
    // against the seed instead, it still clears the gate (a stale fit errs
    // toward MORE contrast wherever primary moved away from the seed), which
    // is why only a replay of the fit sees it: the gate's 4.5 cannot.
    const { byName } = loadThemes(ROOT);
    const generated = generatedPalettes();
    const SEEDS = seeds();
    const failures: string[] = [];
    let differs = 0;
    for (const name of generated) {
      const theme = byName[name];
      const seed = SEEDS.get(name);
      if (theme === undefined || seed === undefined) throw new Error(`generated palette ${name} did not load`);
      // `build()`'s `edge(0.12)`: a plain step off `raised`, away from the ground's side.
      const [L, C, h] = lch(rgbOf(theme, '--bg-raised'));
      const plain = emit(fromLch(seed.dark ? L + 0.12 : L - 0.12, C, h));
      const hint = seed.dark ? 'down' : 'up';
      const primary = rgbOf(theme, '--ink-primary');
      const expected = fitReplay(plain, [primary], 4.5 + 0.2, hint);
      const actual = rgbOf(theme, '--edge-strong');
      if (!same(actual, expected)) failures.push(`${name} --edge-strong ${actual.join(',')} is not the fit on its final primary (${expected.join(',')})`);
      if (!same(fitReplay(plain, [seed.ink], 4.5 + 0.2, hint), expected)) differs += 1;
    }
    expect(failures).toEqual([]);
    // Guards the guard: if the final primary and the seed fitted to the same
    // edge everywhere, this case could not tell the two derivations apart.
    expect(differs).toBeGreaterThanOrEqual(3);
  });
});
