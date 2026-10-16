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
// Nine cases, each a different owner of the rule:
//   * the TREE — every palette's committed tiers are separated at the gate's
//     0.12 (0.10 for the two named exceptions), with secondary the OKLab
//     midpoint;
//   * the GATE, twice — contrast-check.mjs reds a palette whose tertiary has
//     collapsed onto primary, and one whose secondary has (each TIER row has
//     its own forgery, so deleting or zeroing either row reds here);
//   * the EXCEPTIONS, three times (D-5155) — the gate excepts exactly Solarized
//     Light and Catppuccin Latte, at exactly 0.10 and each with a non-blank
//     reason, and holds every other palette to exactly 0.12 and every step to
//     0.04, read both from the gate's own declarations and from the rows it
//     prints, so a third entry reds and so does a floor nudged inside its
//     rounding (0.105, 0.119); an excepted palette that drifts below 0.10
//     reds; and an entry that is stale, names no palette or gives no reason is
//     itself a FAIL row;
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
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadThemes, ratio, resolveColor, stylesheets } from '../design/audit.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TOKENS = path.join(ROOT, '..', 'ui', 'src', 'styles', 'tokens.css');
const GENERATOR = path.join(ROOT, '..', 'ui', 'design', 'make-themes.mjs');

/** The gate's floor and step, restated here as the contract this file holds. */
const TIER_FLOOR = 0.12;
const TIER_STEP = 0.04;
/** The gate's named exceptions to the ΔL floor (D-5155), restated the same
 *  way: EXACTLY these two light palettes, low-contrast by design, each held to
 *  its measured band (0.100 and 0.105) rounded down. Adding a third is a
 *  ruling, not an edit, and the exceptions case reds until this list says so. */
const TIER_FLOOR_EXCEPTIONS: Readonly<Record<string, number>> = {
  'SOLARIZED-LIGHT': 0.10,
  'CATPPUCCIN-LATTE': 0.10,
};
const exceptedFloor = (name: string): number | undefined =>
  Object.hasOwn(TIER_FLOOR_EXCEPTIONS, name) ? TIER_FLOOR_EXCEPTIONS[name] : undefined;
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

/** Set `token` in palette `name`'s block of a gate tree's tokens.css to `hex`. */
function forgeToken(dir: string, name: string, token: string, hex: string): void {
  const tokens = path.join(dir, '..', 'ui', 'src', 'styles', 'tokens.css');
  const css = readFileSync(tokens, 'utf8');
  const open = css.indexOf(`[data-theme='${name}'] {`);
  expect(open, `tokens.css has no ${name} block`).toBeGreaterThan(0);
  const close = css.indexOf('}', open);
  const block = css.slice(open, close);
  const declared = new RegExp(`(${token}:\\s*)#[0-9A-Fa-f]{6};`);
  if (!declared.test(block)) throw new Error(`${name} declares no ${token}`);
  writeFileSync(tokens, css.slice(0, open) + block.replace(declared, `$1${hex};`) + css.slice(close));
}

/** The gate's floors as the gate DECLARES them: its own `TIER_FLOOR`,
 *  `TIER_STEP` and `TIER_FLOOR_EXCEPTIONS` declarations, read off its source
 *  and evaluated as JavaScript. Exact numbers, where a printed row is only as
 *  exact as its formatting; importing the gate would run it. Each must be
 *  declared exactly once, or this throws rather than pick one. */
function gateDeclared(file: string): { floor: unknown; step: unknown; exceptions: unknown } {
  const src = readFileSync(file, 'utf8');
  const once = (re: RegExp, what: string): unknown => {
    const hits = [...src.matchAll(re)];
    if (hits.length !== 1) throw new Error(`the gate declares ${what} ${hits.length} times, not once`);
    return runInNewContext(`(${hits[0]?.[1] ?? ''})`);
  };
  return {
    floor: once(/^const TIER_FLOOR = ([^;\n]+);$/gm, 'TIER_FLOOR'),
    step: once(/^const TIER_STEP = ([^;\n]+);$/gm, 'TIER_STEP'),
    exceptions: once(/^const TIER_FLOOR_EXCEPTIONS = (\{[\s\S]*?^\});$/gm, 'TIER_FLOOR_EXCEPTIONS'),
  };
}

const runGate = (dir: string): { status: number | null; stdout: string } => {
  const r = spawnSync(process.execPath, [path.join(dir, 'design', 'contrast-check.mjs')], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout };
};
const failRows = (stdout: string): string[] => stdout.split('\n').filter((l) => l.startsWith('FAIL'));
const toHex = (rgb: readonly number[]): string =>
  '#' + [0, 1, 2].map((i) => (rgb[i] ?? 0).toString(16).padStart(2, '0')).join('').toUpperCase();

/** Copy the gate's inputs, set Nord's `token` to its own `--ink-primary`,
 *  prove the copy carries that forgery, and run the gate there. */
function gateWithNordCollapsed(token: '--ink-secondary' | '--ink-tertiary'): { status: number | null; stdout: string } {
  const dir = gateTree();
  const primary = loadThemes(dir).byName['nord']?.['--ink-primary'];
  expect(primary, 'nord declares no --ink-primary').toBeDefined();
  forgeToken(dir, 'nord', token, primary as string);
  // The forged tree is MEASURED collapsed, rather than asserted changed: on a
  // tree where Nord already shipped collapsed the forgery is a no-op, and
  // that is exactly the tree this case has to red on.
  const forged = loadThemes(dir).byName['nord'];
  if (forged === undefined) throw new Error('the forged tree lost its nord palette');
  expect(forged[token]).toBe(primary);
  return runGate(dir);
}

/** `token`'s value with its OKLab lightness set to primary's plus `dL`
 *  toward the ground (negative: away from it), its own hue and chroma held. */
function shifted(theme: Record<string, string>, token: string, dL: number): string {
  const Lp = oklab(rgbOf(theme, '--ink-primary'))[0];
  const toward = Math.sign(oklab(rgbOf(theme, '--bg-surface'))[0] - Lp) || 1;
  const [, C, h] = lch(rgbOf(theme, token));
  return toHex(emit(fromLch(Lp + toward * dL, C, h)));
}

describe('the ink tiers are three inks (D-5097)', () => {
  it("every palette's tiers are separated, secondary at the midpoint", () => {
    const { all } = loadThemes(ROOT);
    const generated = generatedPalettes().map((n) => n.toUpperCase());
    // Guards the guard: an empty loop passes everything.
    expect(all.length).toBeGreaterThan(5);
    const names = all.map(([label]) => label.trim());
    // Every exception names a palette that is here, or it is holding nothing.
    for (const name of Object.keys(TIER_FLOOR_EXCEPTIONS)) expect(names).toContain(name);
    const failures: string[] = [];
    for (const [label, theme] of all) {
      const { dL, ps, st } = tiers(theme);
      const name = label.trim();
      const excepted = exceptedFloor(name);
      const floor = excepted ?? TIER_FLOOR;
      if (dL < floor) {
        failures.push(`${name} ΔL(primary, tertiary) ${dL.toFixed(3)} < ${floor.toFixed(2)}${excepted === undefined ? '' : ' (its D-5155 exception)'}`);
      }
      // The exception's other direction, the gate's staleness check restated:
      // a palette that clears the gate's own floor no longer needs one.
      if (excepted !== undefined && dL >= TIER_FLOOR) {
        failures.push(`${name} ΔL(primary, tertiary) ${dL.toFixed(3)} clears ${TIER_FLOOR}: its D-5155 exception is stale`);
      }
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

  it('the gate excepts exactly Solarized Light and Catppuccin Latte, each at exactly 0.10 with a reason, and holds every other palette to exactly 0.12 and every step to 0.04 (D-5155)', () => {
    // First the floors as the gate DECLARES them, exactly. A floor nudged
    // inside its rounding (0.105 or 0.098 for an exception, 0.119 or 0.1201
    // for the rest, 0.035 for a step) prints the same to two decimals, so
    // only the declared number tells it from the contract.
    const declared = gateDeclared(path.join(ROOT, 'design', 'contrast-check.mjs'));
    expect(declared.floor, "the gate's TIER_FLOOR").toBe(TIER_FLOOR);
    expect(declared.step, "the gate's TIER_STEP").toBe(TIER_STEP);
    const entries = Object.entries((declared.exceptions ?? {}) as Record<string, { floor?: unknown; why?: unknown }>);
    expect(Object.fromEntries(entries.map(([name, e]) => [name, e.floor]))).toEqual(TIER_FLOOR_EXCEPTIONS);
    // Each with its reason, and a reason is not blank.
    expect(entries.filter(([, e]) => typeof e.why !== 'string' || !/\S/.test(e.why)).map(([name]) => name)).toEqual([]);

    // Then the gate's OWN output on the committed tree, so the list this case
    // holds is the list the gate applies, not only the one it declares. A
    // third entry prints a third excepted row and reds here even when its
    // palette measures under 0.12, where the gate's staleness check cannot
    // see it. The gate prints each floor exactly, so a floor applied other
    // than as declared reds here too.
    const r = runGate(ROOT);
    const rows = r.stdout.split('\n').filter((l) => /\sTIER \S+\s+ΔL primary → tertiary/.test(l));
    const read = rows.map((l) => {
      const m = /^(PASS|FAIL)\s+-?[\d.]+\s+\(min ([\d.]+)\)\s+TIER (\S+)\s/.exec(l);
      if (m === null) throw new Error(`unparsed TIER row: ${l}`);
      return { name: m[3] as string, min: m[2] as string, excepted: /— exception \(D-5155\): \S/.test(l) };
    });
    // One ΔL row per palette, so no palette is missing from the reading.
    const { all } = loadThemes(ROOT);
    expect(read.map((x) => x.name).sort()).toEqual(all.map(([label]) => label.trim()).sort());
    const excepted = read.filter((x) => x.excepted || x.min !== String(TIER_FLOOR));
    expect(excepted.map((x) => `${x.name} ${x.min} ${x.excepted ? 'with' : 'without'} a reason`).sort()).toEqual(
      Object.entries(TIER_FLOOR_EXCEPTIONS).map(([name, floor]) => `${name} ${floor} with a reason`).sort(),
    );
    // Only the ΔL row is excepted: every step row, the two palettes' included,
    // keeps exactly 0.04 and carries no reason.
    const steps = r.stdout.split('\n').filter((l) => /\sTIER \S+\s+step /.test(l));
    expect(steps.length).toBe(2 * all.length);
    expect(steps.filter((l) => !l.includes(`(min ${TIER_STEP})`) || l.includes('exception'))).toEqual([]);
    // And the committed tree passes them: the gate is green with the two in it.
    expect(r.stdout).not.toMatch(/^FAIL/m);
    expect(r.status).toBe(0);
  }, 30_000);

  it('an excepted palette that drifts below its 0.10 reds the gate', () => {
    // Each excepted palette's tertiary moved to ΔL 0.095 from primary, hue and
    // chroma held: nearer primary, so every contrast pair can only rise, and
    // the steps stay over 0.04. Only the excepted ΔL rows have a reason to fail.
    const dir = gateTree();
    const { byName } = loadThemes(dir);
    for (const name of Object.keys(TIER_FLOOR_EXCEPTIONS)) {
      const theme = byName[name.toLowerCase()];
      if (theme === undefined) throw new Error(`no ${name} palette to forge`);
      forgeToken(dir, name.toLowerCase(), '--ink-tertiary', shifted(theme, '--ink-tertiary', 0.095));
    }
    // Measured on the forged tree: under the exception's floor, but only just.
    const forged = loadThemes(dir).byName;
    for (const name of Object.keys(TIER_FLOOR_EXCEPTIONS)) {
      const theme = forged[name.toLowerCase()];
      if (theme === undefined) throw new Error(`the forged tree lost ${name}`);
      const { dL } = tiers(theme);
      expect(dL, `${name} forged ΔL`).toBeLessThan(0.10);
      expect(dL, `${name} forged ΔL`).toBeGreaterThan(0.09);
    }
    const r = runGate(dir);
    expect(r.status).not.toBe(0);
    expect(failRows(r.stdout).map((l) => /TIER (\S+)/.exec(l)?.[1]).sort()).toEqual(Object.keys(TIER_FLOOR_EXCEPTIONS).sort());
    for (const name of Object.keys(TIER_FLOOR_EXCEPTIONS)) {
      // `(min 0.1)`: the gate prints the floor exactly.
      expect(r.stdout).toMatch(new RegExp(`^FAIL\\s+0\\.09\\d\\s+\\(min 0\\.1\\)\\s+TIER ${name}\\s+ΔL primary → tertiary .*exception \\(D-5155\\)`, 'm'));
    }
  }, 30_000);

  it('an exception that is stale, that names no palette, or that gives no reason, is itself a FAIL row', () => {
    // Stale: Latte's primary moved 0.02 further from the ground, so its band
    // clears 0.12 and the exception holds nothing. Darker ink on a light
    // palette only raises primary's pairs.
    const stale = gateTree();
    const latte = loadThemes(stale).byName['catppuccin-latte'];
    if (latte === undefined) throw new Error('no catppuccin-latte palette to forge');
    forgeToken(stale, 'catppuccin-latte', '--ink-primary', shifted(latte, '--ink-primary', -0.02));
    const forgedLatte = loadThemes(stale).byName['catppuccin-latte'];
    if (forgedLatte === undefined) throw new Error('the forged tree lost catppuccin-latte');
    expect(tiers(forgedLatte).dL).toBeGreaterThanOrEqual(TIER_FLOOR);
    const r1 = runGate(stale);
    expect(r1.status).not.toBe(0);
    expect(failRows(r1.stdout)).toEqual([
      expect.stringMatching(/^FAIL\s+-+\s+\(tier\)\s+TIER_FLOOR_EXCEPTIONS entry CATPPUCCIN-LATTE .*is stale/),
    ]);

    // Orphaned: the gate's own entry renamed to a palette that does not exist.
    // Latte then answers to 0.12 and fails it, and the entry is reported too.
    const orphan = gateTree();
    const gate = path.join(orphan, 'design', 'contrast-check.mjs');
    const src = readFileSync(gate, 'utf8');
    expect(src.split("'CATPPUCCIN-LATTE': {").length - 1, 'the gate names Latte once').toBe(1);
    writeFileSync(gate, src.replace("'CATPPUCCIN-LATTE': {", "'CATPPUCCIN-LATE': {"));
    const r2 = runGate(orphan);
    expect(r2.status).not.toBe(0);
    expect(failRows(r2.stdout)).toEqual([
      expect.stringMatching(/^FAIL\s+0\.1\d\d\s+\(min 0\.12\)\s+TIER CATPPUCCIN-LATTE\s+ΔL primary → tertiary/),
      expect.stringMatching(/^FAIL\s+-+\s+\(tier\)\s+TIER_FLOOR_EXCEPTIONS entry CATPPUCCIN-LATE .*names no palette/),
    ]);

    // Unreasoned: Latte's own entry with its reason blanked to whitespace. Its
    // floor still holds and its ΔL row still passes; the entry is reported.
    const blank = gateTree();
    const blankGate = path.join(blank, 'design', 'contrast-check.mjs');
    const blankSrc = readFileSync(blankGate, 'utf8');
    const latteAt = blankSrc.indexOf("'CATPPUCCIN-LATTE': {");
    expect(latteAt, 'the gate names Latte').toBeGreaterThan(0);
    const reason = /why: '[^']*',/.exec(blankSrc.slice(latteAt));
    if (reason === null) throw new Error("the gate's Latte entry has no reason to blank");
    const at = latteAt + reason.index;
    writeFileSync(blankGate, blankSrc.slice(0, at) + "why: '  '," + blankSrc.slice(at + reason[0].length));
    const r3 = runGate(blank);
    expect(r3.status).not.toBe(0);
    expect(failRows(r3.stdout)).toEqual([
      expect.stringMatching(/^FAIL\s+-+\s+\(tier\)\s+TIER_FLOOR_EXCEPTIONS entry CATPPUCCIN-LATTE \(floor 0\.1\) gives no reason/),
    ]);
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
