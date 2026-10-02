// Theme generator — the ONE place a palette's 45 tokens come from.
//
// Run: node ui/design/make-themes.mjs --write
//      node ui/design/make-themes.mjs            (dry run, prints a report)
//
// WHY A GENERATOR AND NOT TEN HAND-WRITTEN BLOCKS.
//
// A theme is ~45 tokens, and `pwa/design/contrast-check.mjs` holds a contract
// of ~50 token pairs every theme must satisfy. Hand-authoring ten palettes
// against that contract is 450 hex values tuned by eye against 500 ratios —
// which is the shape of work that produced deviations 86 and 87 ("the table
// and the stylesheet disagree"). So a palette is declared as a SEED: the dozen
// colours that make it recognisable as Nord, or Dracula, or Gruvbox. Everything
// else is DERIVED to clear the contract.
//
// THE DERIVATION RULE: keep hue, keep as much chroma as the floor allows, move
// LIGHTNESS, and move it the smallest distance that clears the floor with a
// margin. A palette dragged to AA that way is still recognisably itself —
// nothing but L moved. Where lightness alone cannot reach the floor (a vivid
// yellow on white), chroma bleeds second, and that is reported.
//
// The seeds below are the published palettes. They are DATA, not measurements:
// nothing here claims a seed already passes, and every emitted value is
// measured before it is written.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKENS = path.join(HERE, '..', 'src', 'styles', 'tokens.css');

// ── colour maths ────────────────────────────────────────────────────────────
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

const hexToRgb = (h) => {
  const s = h.replace('#', '');
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
const rgbToHex = (rgb) =>
  '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
    .join('').toUpperCase();

const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => srgbToLin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG 2.1 contrast ratio between two opaque sRGB triples. */
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// OKLab, so "move lightness only" means what a reader expects it to mean.
const rgbToOklab = (rgb) => {
  const [r, g, b] = rgb.map((v) => srgbToLin(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
};
const oklabToRgb = ([L, A, B]) => {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((v) => linToSrgb(v) * 255);
};
const toLch = (rgb) => {
  const [L, a, b] = rgbToOklab(rgb);
  return [L, Math.hypot(a, b), Math.atan2(b, a)];
};
const fromLch = ([L, C, h]) => oklabToRgb([L, C * Math.cos(h), C * Math.sin(h)]);
const inGamut = (rgb) => rgb.every((v) => v >= -0.5 && v <= 255.5);

/** Composite a translucent wash over a ground — so a "12% dead over surface"
 *  token can be stored SOLID and measured without re-mixing at audit time,
 *  exactly as `--status-dead-tint-solid` already is. */
const over = (fgHex, alpha, groundHex) => {
  const f = hexToRgb(fgHex), g = hexToRgb(groundHex);
  return rgbToHex([0, 1, 2].map((i) => f[i] * alpha + g[i] * (1 - alpha)));
};

const NOTES = [];
const UNREACHABLE = [];

/** Move `seedHex`'s lightness (then, only if it must, its chroma) until it
 *  clears `floor` against EVERY ground, with margin.
 *
 *  THE SEARCH GOES BOTH WAYS, NEAREST FIRST, and that is not a refinement —
 *  it is the difference between working and not. A status DOT must clear 3:1
 *  against the card surface AND against the terminal well, and in a light
 *  theme those two grounds sit on OPPOSITE sides of it: white at one end,
 *  near-black at the other. Any colour that satisfies both lives BETWEEN
 *  them, so a monotonic walk away from the seed leaves the valid band
 *  immediately and never returns — it ran to pure black reporting failure
 *  while a perfectly good mid-tone sat four steps the other way. (Phosphor's
 *  own light theme proves the band exists: #178A48 reads 4.41 on white and
 *  4.10 on the well.)
 *
 *  `hint` is the direction tried first, so a result stays on the side of the
 *  seed a reader expects when both sides work. */
function fit(label, seedHex, groundHexes, floor, hint, margin = 0.15, fades = [], fadeGroundHexes = null) {
  const seed = hexToRgb(seedHex);
  const grounds = groundHexes.map(hexToRgb);
  // THE FADED CHECK HAS ITS OWN GROUNDS, because a faded mark is not rendered
  // everywhere the full-strength one is. `.tool-dot--run` at 0.8 and
  // `.task-mark--running` at 0.85 both sit on a CARD; neither is ever drawn on
  // the terminal well. Demanding the faded value clear the well as well as the
  // card over-constrains the search to nothing on a light palette — a mid
  // amber cannot be 3:1 against both white-at-80%-opacity and a near-black
  // well — and the search then fell back to pure black, which satisfies
  // neither and destroys the hue the two-cue rule depends on.
  const fadeGrounds = (fadeGroundHexes ?? groundHexes).map(hexToRgb);
  const target = floor + margin;
  // A token the stylesheets also render at reduced opacity must clear the
  // floor AS FADED, not merely at full strength. The audit measures the
  // composite; fitting only the full-strength value is how a mark that reads
  // 4.6 at 1.0 ships at 3.9 at 0.85 — which is exactly the shape of the
  // fifteen-pair opacity failure this gate was rebuilt after.
  // The MARGIN is headroom against future retints of the full-strength value;
  // the faded value is derived from it, so holding the fade to floor+margin
  // too is compounding the same safety twice and costs a real band of colour.
  // Phosphor's own hand-tuned light theme sits at 3.18 here — inside the floor,
  // outside this margin — so a generator stricter than the gate would reject
  // the very palette the system shipped. Fades are held to the FLOOR.
  const ok = (rgb) =>
    grounds.every((g) => ratio(rgb, g) >= target)
    && fadeGrounds.every((g) =>
      fades.every((a) => ratio(g.map((c, i) => rgb[i] * a + c * (1 - a)), g) >= floor));
  if (ok(seed)) return rgbToHex(seed);

  const [L0, C0, h] = toLch(seed);
  const order = hint === 'down' ? [-1, +1] : [+1, -1];
  const tryAt = (L, chroma) => {
    const rgb = fromLch([L, chroma, h]);
    return inGamut(rgb) && ok(rgb) ? rgbToHex(rgb) : null;
  };
  // Nearest-first: step outward, trying the hinted side before the other at
  // each distance, so the smallest move that works wins regardless of side.
  for (let i = 1; i <= 260; i += 1) {
    for (const sign of order) {
      const L = L0 + sign * i * 0.004;
      if (L > 1.02 || L < -0.02) continue;
      const hitK = tryAt(L, C0);
      if (hitK) return hitK;
    }
  }
  for (let c = 0.92; c >= 0; c -= 0.04) {
    for (let i = 0; i <= 260; i += 1) {
      for (const sign of order) {
        const L = L0 + sign * i * 0.004;
        if (L > 1.02 || L < -0.02) continue;
        const hit = tryAt(L, C0 * c);
        if (hit) {
          NOTES.push(`${label}: lightness alone could not reach ${floor}; chroma bled to ${Math.round(c * 100)}%`);
          return hit;
        }
      }
    }
  }
  // NO SILENT FALLBACK. Returning pure black or white here is how three light
  // palettes shipped `--status-busy/-attention/-dead` as #000000: a value that
  // cleared nothing, carried no hue, and looked deliberate in the file. A
  // generator that cannot satisfy the contract must say so and stop, so the
  // seed gets fixed rather than the symptom.
  UNREACHABLE.push(`${label}: no lightness or chroma of ${seedHex} clears ${floor} on every ground`);
  return seedHex;
}

// ── the seeds ───────────────────────────────────────────────────────────────
// Each entry is the published palette's own colours. `dark` decides which way
// legibility lies. `well` is the terminal glass: ALWAYS dark, in every theme,
// because a well is cut INTO the interface — that is a Phosphor & Ink rule the
// light theme already follows and every theme inherits.
const SEEDS = [
  { name: 'nord', label: 'Nord', dark: true,
    page: '#2E3440', surface: '#3B4252', raised: '#434C5E', sheet: '#3B4252', well: '#242933',
    ink: '#ECEFF4', accent: '#88C0D0',
    hues: { busy: '#A3BE8C', idle: '#4C566A', attention: '#EBCB8B', dead: '#BF616A',
            done: '#8FBCBB', cleanup: '#4C566A',
            cyan: '#88C0D0', violet: '#B48EAD', blue: '#81A1C1', magenta: '#B48EAD',
            amber: '#D08770', green: '#A3BE8C' } },
  { name: 'tokyo-night', label: 'Tokyo Night', dark: true,
    page: '#1A1B26', surface: '#24283B', raised: '#292E42', sheet: '#24283B', well: '#16161E',
    ink: '#C0CAF5', accent: '#7AA2F7',
    hues: { busy: '#9ECE6A', idle: '#565F89', attention: '#E0AF68', dead: '#F7768E',
            done: '#73DACA', cleanup: '#565F89',
            cyan: '#7DCFFF', violet: '#BB9AF7', blue: '#7AA2F7', magenta: '#FF9E64',
            amber: '#E0AF68', green: '#9ECE6A' } },
  { name: 'dracula', label: 'Dracula', dark: true,
    page: '#282A36', surface: '#343746', raised: '#44475A', sheet: '#343746', well: '#1E1F29',
    ink: '#F8F8F2', accent: '#BD93F9',
    hues: { busy: '#50FA7B', idle: '#6272A4', attention: '#F1FA8C', dead: '#FF5555',
            done: '#8BE9FD', cleanup: '#6272A4',
            cyan: '#8BE9FD', violet: '#BD93F9', blue: '#6272A4', magenta: '#FF79C6',
            amber: '#FFB86C', green: '#50FA7B' } },
  { name: 'catppuccin-mocha', label: 'Catppuccin Mocha', dark: true,
    page: '#1E1E2E', surface: '#313244', raised: '#45475A', sheet: '#313244', well: '#181825',
    ink: '#CDD6F4', accent: '#89B4FA',
    hues: { busy: '#A6E3A1', idle: '#6C7086', attention: '#F9E2AF', dead: '#F38BA8',
            done: '#94E2D5', cleanup: '#6C7086',
            cyan: '#89DCEB', violet: '#CBA6F7', blue: '#89B4FA', magenta: '#F5C2E7',
            amber: '#FAB387', green: '#A6E3A1' } },
  { name: 'gruvbox-dark', label: 'Gruvbox Dark', dark: true,
    page: '#282828', surface: '#3C3836', raised: '#504945', sheet: '#3C3836', well: '#1D2021',
    ink: '#EBDBB2', accent: '#B8BB26',
    hues: { busy: '#B8BB26', idle: '#7C6F64', attention: '#FABD2F', dead: '#FB4934',
            done: '#8EC07C', cleanup: '#7C6F64',
            cyan: '#8EC07C', violet: '#D3869B', blue: '#83A598', magenta: '#D3869B',
            amber: '#FE8019', green: '#B8BB26' } },
  { name: 'one-dark', label: 'One Dark', dark: true,
    page: '#282C34', surface: '#31353F', raised: '#3E4451', sheet: '#31353F', well: '#21252B',
    ink: '#ABB2BF', accent: '#61AFEF',
    hues: { busy: '#98C379', idle: '#5C6370', attention: '#E5C07B', dead: '#E06C75',
            done: '#56B6C2', cleanup: '#5C6370',
            cyan: '#56B6C2', violet: '#C678DD', blue: '#61AFEF', magenta: '#C678DD',
            amber: '#D19A66', green: '#98C379' } },
  { name: 'solarized-dark', label: 'Solarized Dark', dark: true,
    page: '#002B36', surface: '#073642', raised: '#0E4653', sheet: '#073642', well: '#001F27',
    ink: '#93A1A1', accent: '#268BD2',
    hues: { busy: '#859900', idle: '#586E75', attention: '#B58900', dead: '#DC322F',
            done: '#2AA198', cleanup: '#586E75',
            cyan: '#2AA198', violet: '#6C71C4', blue: '#268BD2', magenta: '#D33682',
            amber: '#CB4B16', green: '#859900' } },
  { name: 'github-light', label: 'GitHub Light', dark: false,
    page: '#FFFFFF', surface: '#FFFFFF', raised: '#F6F8FA', sheet: '#FFFFFF', well: '#24292F',
    ink: '#1F2328', accent: '#0969DA',
    hues: { busy: '#1A7F37', idle: '#656D76', attention: '#9A6700', dead: '#CF222E',
            done: '#1A7F37', cleanup: '#656D76',
            cyan: '#1B7C83', violet: '#8250DF', blue: '#0969DA', magenta: '#BF3989',
            amber: '#9A6700', green: '#1A7F37' } },
  { name: 'solarized-light', label: 'Solarized Light', dark: false,
    page: '#FDF6E3', surface: '#FFFBF0', raised: '#EEE8D5', sheet: '#FFFBF0', well: '#002B36',
    ink: '#586E75', accent: '#268BD2',
    hues: { busy: '#859900', idle: '#93A1A1', attention: '#B58900', dead: '#DC322F',
            done: '#2AA198', cleanup: '#93A1A1',
            cyan: '#2AA198', violet: '#6C71C4', blue: '#268BD2', magenta: '#D33682',
            amber: '#CB4B16', green: '#859900' } },
  { name: 'catppuccin-latte', label: 'Catppuccin Latte', dark: false,
    // well: Latte's own surfaces top out mid-tone (#4C4F69), which leaves no
    // lightness band where a status dot clears 3:1 against BOTH it and the
    // white card surface. The well takes Mocha's crust instead — a well is cut
    // into the interface and is dark in every theme anyway, so this is the
    // rule being honoured, not an exception to it.
    page: '#EFF1F5', surface: '#FFFFFF', raised: '#E6E9EF', sheet: '#FFFFFF', well: '#1E1E2E',
    ink: '#4C4F69', accent: '#1E66F5',
    hues: { busy: '#40A02B', idle: '#8C8FA1', attention: '#DF8E1D', dead: '#D20F39',
            done: '#179299', cleanup: '#8C8FA1',
            cyan: '#179299', violet: '#8839EF', blue: '#1E66F5', magenta: '#EA76CB',
            amber: '#FE640B', green: '#40A02B' } },
];

// ── derive one theme ────────────────────────────────────────────────────────
function build(seed) {
  const { name, dark, page, surface, raised, sheet, well, ink, accent, hues } = seed;
  const up = dark ? 'up' : 'down';          // where legibility lies for INK
  const grounds = [surface, raised, page, sheet];
  const t = {};

  t['--bg-page'] = page; t['--bg-surface'] = surface; t['--bg-raised'] = raised;
  t['--bg-sheet'] = sheet; t['--bg-well'] = well;
  t['--scrim'] = dark ? 'rgba(4, 6, 5, 0.62)' : 'rgba(20, 26, 22, 0.42)';

  // Edges are decorative hairlines — tokens.css exempts them from any contrast
  // claim, so they are a plain step off `raised` rather than a fitted value.
  const edge = (amount) => {
    const [L, C, h] = toLch(hexToRgb(raised));
    return rgbToHex(fromLch([dark ? L + amount : L - amount, C, h]));
  };
  t['--edge-subtle'] = edge(0.05);
  // (Fitted against `ink` deliberately: `--ink-primary` is not assigned yet at
  // this point, and it is re-fitted twice below, so reading it here would bind
  // to a ground that then moves. `ink` is the seed both derive from.)
  // `--edge-strong` is ALSO the INK of the inverted active row, where
  // `--ink-primary` is the background (`.sess-line--active .sess-meta` and its
  // twenty siblings, fleet.css). It is a hairline token being read as text, so
  // it owes the TEXT floor of 4.5 there — not the 3:1 a border would. Fitting
  // it at 3 left four palettes between 3.89 and 4.47: close enough to look
  // deliberate, and wrong.
  t['--edge-strong'] = fit(`${name} edge-strong`, edge(0.12),
    [ink], 4.5, dark ? 'down' : 'up', 0.2);

  t['--ink-primary']   = fit(`${name} ink-primary`, ink, grounds, 4.5, up, 2.0);
  t['--ink-secondary'] = fit(`${name} ink-secondary`, ink, grounds, 4.5, up, 1.2);
  t['--ink-tertiary']  = fit(`${name} ink-tertiary`, ink, grounds, 4.5, up, 0.35);
  // Disabled is deliberately sub-AA and WCAG-exempt (inactive controls), so it
  // is the one ink that is NOT fitted — it is a step toward the ground.
  {
    const [L, C, h] = toLch(hexToRgb(t['--ink-tertiary']));
    t['--ink-disabled'] = rgbToHex(fromLch([dark ? L - 0.14 : L + 0.14, C, h]));
  }
  // The well is dark in EVERY theme, so its ink always lightens.
  t['--ink-on-well'] = fit(`${name} ink-on-well`, ink, [well], 4.5, 'up', 2.0);

  // The accent carries TWO obligations at once: 3:1 against the page (it is
  // the focus ring) and enough separation from its own ink to clear 4.5 for a
  // button label. Fitting it against the page alone produced accents no ink
  // could sit on, which is how `ink-on-accent` ended up running to pure white
  // and reporting failure. Fit the pair together: accent first against the
  // page, then against whichever of near-black / near-white it will carry.
  // THE ACCENT IS READ, NOT JUST SEEN. It is the focus ring (3:1 on the page)
  // but it is also the ink of `.route-queued`, `.metachip--ultra`,
  // `.dlg-header-chip` and `.acct-suggested` — real text on the card grounds.
  // Fitting it at 3 against the page alone shipped eight 4.5 failures per
  // palette; the floor it actually owes is 4.5 on every ground it inks.
  t['--accent'] = fit(`${name} accent`, accent, [page, surface, raised], 4.5, dark ? 'up' : 'down', 0.3);
  {
    const INKS = dark ? ['#07140C', '#FFFFFF'] : ['#FFFFFF', '#0B0D0C'];
    const picked = INKS.find((i) => ratio(hexToRgb(i), hexToRgb(t['--accent'])) >= 4.6);
    if (picked) {
      t['--ink-on-accent'] = picked;
    } else {
      // Neither plain ink clears the accent as fitted — darken/lighten the
      // accent until the preferred one does, rather than muddying the ink.
      t['--accent'] = fit(`${name} accent (re-fit for its ink)`, t['--accent'],
        [page, INKS[0]], 4.5, dark ? 'up' : 'down', 0.15);
      t['--ink-on-accent'] = INKS[0];
    }
  }
  // THE TINT IS A GROUND THE ACCENT ITSELF SITS ON (a chip: accent ink on an
  // accent wash), so it cannot simply be a wash OF the accent — that was 40 of
  // the first run's 79 failures, and it is unfixable by tuning the wash
  // percentage, because a wash of a colour is always close to that colour.
  // The tint is therefore pushed AWAY from the accent, deep on a dark theme
  // and pale on a light one, until both the accent and the primary ink clear
  // it. Phosphor's hand-tuned pair already works this way: #45D67E on #12291B.
  t['--accent-tint'] = fit(`${name} accent-tint`,
    over(t['--accent'], dark ? 0.16 : 0.14, surface),
    [t['--accent']], 4.5, dark ? 'down' : 'up', 0.3);
  t['--ink-primary'] = fit(`${name} ink-primary (+tint)`, t['--ink-primary'],
    [...grounds, t['--accent-tint']], 4.5, up, 1.4);
  t['--accent-on-well'] = fit(`${name} accent-on-well`, accent, [well], 4.5, 'up', 0.8);

  // Status: the DOT is a 3:1 non-text mark on surface / page / well; the TEXT
  // is 4.5 on surface. They are separate tokens because they are separate
  // jobs, and collapsing them is what put a 3.58 dot where text needed 4.5.
  // The DOT is a 3:1 non-text mark; `.tool-dot--run` renders it at 0.8 and
  // `.task-mark--running` at 0.85, so both fades are fitted, not hoped for.
  // MARGIN 0.1, NOT 0.35, AND THAT IS A MEASUREMENT RATHER THAN A PREFERENCE.
  // A dot is squeezed from both sides in a light palette: dark enough to clear
  // a white card, light enough to clear a near-black well. The band between
  // those is narrow — roughly 0.08 in relative luminance on GitHub Light — and
  // a 0.35 margin applied at both ends closes it completely. The generator
  // then reported six hues UNREACHABLE that are in fact perfectly reachable;
  // before it was taught to refuse, it silently shipped them as #000000.
  // THE FADE GROUND IS `surface` ALONE, read off the opacity registry rather
  // than guessed: `.tool-dot--run 0.8` declares `['var(--bg-surface)']` and
  // `.task-mark--running 0.85` the same (audit.mjs). Neither faded mark is
  // ever drawn on `raised` or on the well, and including `raised` here closed
  // Solarized Light's band entirely — its `raised` (#EEE8D5) is dark enough
  // that an 80%-opacity composite over it lands too close to read.
  const dot  = (k, f) => fit(`${name} ${k} dot`, hues[k], [surface, page, raised, well],
    3, f ?? up, 0.1, [0.8], [surface]);
  // The TEXT inks raised as well as surface (`.task-mark--running`,
  // `.code-block-lang`), and fades to 0.85 on a card.
  const text = (k, g) => fit(`${name} ${k} text`, hues[k], g ?? [surface, page, raised],
    4.5, up, 0.3, [0.85], [surface]);

  t['--status-busy'] = dot('busy');       t['--status-busy-text'] = text('busy');
  t['--status-idle'] = dot('idle');
  t['--status-attention'] = dot('attention');
  t['--status-attention-tint'] = over(hues.attention, dark ? 0.18 : 0.22, surface);
  t['--status-attention-text'] = text('attention', [surface, page, t['--status-attention-tint']]);
  t['--status-dead'] = dot('dead');
  t['--status-dead-tint'] = `color-mix(in srgb, ${hues.dead} 12%, transparent)`;
  t['--status-dead-tint-solid'] = over(hues.dead, 0.12, surface);
  t['--status-dead-text'] = text('dead', [surface, page, t['--status-dead-tint-solid']]);
  t['--status-done'] = dot('done');       t['--status-done-text'] = text('done');
  t['--status-cleanup'] = dot('cleanup'); t['--status-cleanup-text'] = text('cleanup');

  // Account hues: each is ink on ITS OWN tint, so each pair is fitted together.
  for (const k of ['cyan', 'violet', 'blue', 'magenta', 'amber', 'green']) {
    const tint = over(hues[k], dark ? 0.18 : 0.16, surface);
    t[`--acct-${k}-tint`] = tint;
    t[`--acct-${k}`] = fit(`${name} acct-${k}`, hues[k], [tint, surface], 4.5, up, 0.3);
  }

  t['--limit-track'] = edge(0.03);
  t['--limit-ok']       = fit(`${name} limit-ok`, hues.busy, [t['--limit-track']], 3, up, 0.25);
  t['--limit-warn']     = fit(`${name} limit-warn`, hues.attention, [t['--limit-track']], 3, up, 0.25);
  t['--limit-critical'] = fit(`${name} limit-critical`, hues.dead, [t['--limit-track']], 3, up, 0.25);

  // Diffs render inside the dark well in every theme, so both always lighten.
  t['--diff-add'] = fit(`${name} diff-add`, hues.busy, [well], 4.5, 'up', 1.5);
  t['--diff-del'] = fit(`${name} diff-del`, hues.dead, [well], 4.5, 'up', 1.5);

  const rgbOf = (hex) => hexToRgb(hex).join(', ');
  t['--elev-card'] = dark
    ? '0 1px 2px rgba(0, 0, 0, 0.40), 0 2px 8px rgba(0, 0, 0, 0.28)'
    : '0 1px 3px rgba(26, 32, 27, 0.10), 0 1px 2px rgba(26, 32, 27, 0.06)';
  t['--elev-sheet'] = dark
    ? '0 -8px 40px rgba(0, 0, 0, 0.55)'
    : '0 -8px 40px rgba(26, 32, 27, 0.22)';
  // GLOW MEANS LIFE — only busy and attention emit, in every theme.
  const glow = (c) => `\n    0 0 0 1px   rgba(${rgbOf(c)}, 0.35),\n    0 0 16px    rgba(${rgbOf(c)}, 0.18),\n    0 0 40px    rgba(${rgbOf(c)}, 0.08)`;
  t['--glow-busy'] = glow(t['--status-busy']);
  t['--glow-attention'] = glow(t['--status-attention']);
  t['--glow-dot-busy'] = `0 0 7px rgba(${rgbOf(t['--status-busy'])}, 0.45)`;
  t['--glow-dot-attention'] = `0 0 7px rgba(${rgbOf(t['--status-attention'])}, 0.45)`;

  // THE SYNTAX PALETTE IS DECLARED ONCE IN :root, BUT ITS GROUND IS NOT.
  // `--well-bar-bg` is color-mix(--ink-on-well 5%, --bg-well) — both of which
  // every theme redefines — so a comment colour tuned for :root's well is
  // measured against a ground that moved out from under it. This is the
  // half-palette hazard in miniature: a token a theme does not mention is not
  // a token a theme cannot break. Only `--syn-comment` sits close enough to
  // its ground to fail, so only it is re-fitted; the gate measures the rest
  // and will say so if that stops being true.
  t['--syn-comment'] = fit(`${name} syn-comment`, '#8B948C',
    [well, over(t['--ink-on-well'], 0.05, well)], 4.5, 'up', 0.3);

  t['color-scheme'] = dark ? 'dark' : 'light';
  return t;
}

// ── emit ────────────────────────────────────────────────────────────────────
const START = '/* === GENERATED THEMES — do not edit by hand (ui/design/make-themes.mjs) === */';
const END = '/* === END GENERATED THEMES === */';

const blocks = SEEDS.map((seed) => {
  const t = build(seed);
  const body = Object.entries(t)
    .map(([k, v]) => `  ${k}:${' '.repeat(Math.max(1, 26 - k.length))}${v};`)
    .join('\n');
  return `[data-theme='${seed.name}'] {\n  /* ${seed.label} */\n${body}\n}`;
}).join('\n\n');

const banner = `${START}
/* ${SEEDS.length} palettes, each DERIVED from a seed in ui/design/make-themes.mjs
   and fitted against THAT FILE'S OWN floors before it was written here. The
   authority is still pwa/design/contrast-check.mjs, which measures these values
   afterwards and has caught the generator being wrong — the two statements of
   the contract are separate, and the gate is the one that rules. Edit the SEED and re-run; editing a value below
   is overwritten on the next run and is not measured by anything in between.

   Phosphor & Ink is NOT here: it is :root (dark) and [data-theme='light'], the
   hand-tuned original, and it stays the default. A theme is an override block,
   so every token a block omits falls through to :root — which is why the
   generator emits a COMPLETE palette rather than a diff. */
${blocks}
${END}`;

const src = readFileSync(TOKENS, 'utf8');
const hasBlock = src.includes(START);
const next = hasBlock
  ? src.slice(0, src.indexOf(START)) + banner + src.slice(src.indexOf(END) + END.length)
  : src.replace(/\n\/\* =+\n   ACCOUNT REBINDING/, `\n${banner}\n\n/* ${'='.repeat(74)}\n   ACCOUNT REBINDING`);

// THE REFUSAL COMES FIRST. It used to sit after the write, which made it a
// message rather than a mechanism: a run with unreachable seeds wrote the file
// with un-fitted values and then printed "Nothing was written." — the exact
// shape of comment-pretending-to-be-a-guard this generator exists to replace,
// and it would have shipped the #000000 palettes it was added to stop.
if (UNREACHABLE.length) {
  console.error('UNREACHABLE — the contract cannot be met from these seeds:');
  for (const u of UNREACHABLE) console.error('  ' + u);
  console.error('\nNothing was written. Fix the seed (usually: the well is too light for a');
  console.error('dot to clear both it and a white card, or the hue is too saturated).');
  process.exit(3);
}

// `--check` is the binding: it answers "is the committed block still what
// these seeds produce?" without touching the file, so a test and CI can ask.
// Without it the only way to find out was to run --write and read `git diff`,
// which means the check cannot be made without the risk of performing it.
if (process.argv.includes('--check')) {
  if (next === src) {
    console.log(`up to date — ${SEEDS.length} themes match their seeds`);
    process.exit(0);
  }
  console.error('DRIFT: tokens.css does not match what the seeds produce.');
  console.error('Either a generated value was hand-edited, or a seed changed');
  console.error('without re-running. Fix with: node ui/design/make-themes.mjs --write');
  process.exit(1);
}

if (process.argv.includes('--write')) {
  // An identity re-run is SUCCESS, not a refusal. `next === src` means the
  // committed block already matches what these seeds produce — which is the
  // state a check wants to assert, so it must be reachable by running the
  // generator twice. It previously exited 2 blaming a missing insertion point,
  // which is only a real diagnosis when the block is absent AND nothing changed.
  if (next === src) {
    if (!hasBlock) {
      console.error('REFUSED: no insertion point found in tokens.css');
      process.exit(2);
    }
    console.log(`already up to date — ${SEEDS.length} themes match their seeds`);
  } else {
    writeFileSync(TOKENS, next);
    console.log(`wrote ${SEEDS.length} themes into ${path.relative(process.cwd(), TOKENS)}`);
  }
} else {
  console.log(banner.split('\n').slice(0, 24).join('\n'));
  console.log(`\n… ${blocks.split('\n').length} lines, ${SEEDS.length} themes (dry run; pass --write)`);
}
if (NOTES.length) {
  console.log('\nderivation notes:');
  for (const n of NOTES) console.log('  ' + n);
}
