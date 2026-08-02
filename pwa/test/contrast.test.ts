// The design system's contrast gate, run as a test — plus the part the gate
// cannot do by construction: reading the STYLESHEETS.
//
// design/contrast-check.mjs is the file every ratio quoted in tokens.css comes
// from — but a pair that isn't in it is a pair nothing can regress on. Two
// colour combinations shipped with the ask sheet (the header chip's accent on
// --accent-tint, the preview toggle's accent on --bg-sheet) were live in the
// CSS while the gate still measured 74 pairs and reported ALL PASS. So the
// suite runs the gate itself: any FAIL fails here, and the pairs listed below
// must be among the ones it actually measured, in both themes.
//
// That was still not enough, twice over, because the gate has TWO structural
// blind spots and both shipped a live WCAG failure under a green gate:
//
//   1. It measures a HAND-MAINTAINED table of token pairs (`D`/`Lt`), not the
//      stylesheets. `.pr-body-preview` set --ink-secondary on --bg-well and
//      measured 2.44 in the light theme (floor 4.5) while the gate printed
//      ALL 94 PASS — because nobody added that pair to the table. Two sibling
//      rules had the same defect: .dlg-reply-input (1.09 light) and
//      .msg-attach-gone (3.17 light).
//   2. It has no concept of `opacity`. `.proj-archived-body .sess-line` set
//      `opacity: 0.72`, which composited FIFTEEN already-gated pairs in the
//      SessionLine subtree below their floors — invisible to a token-pair
//      checker even in principle.
//
// So this file carries its own auditor, and it PARSES:
//
//   * tokens.css — both theme blocks, resolving var() chains and color-mix()
//     — instead of duplicating them. The `D`/`Lt` tables in the gate are then
//     checked FOR DRIFT against the parsed truth, which is the whole reason
//     deviations 86 and 87 existed.
//   * chat.css / fleet.css / primitives.css / shell.css — every rule that sets
//     both a `color` and a `background` is measured against the ground it
//     names ITSELF, in both themes. No human has to remember to add the pair;
//     the rule IS the pair. This is what catches blind spot 1.
//   * every static `opacity` between 0 and 1 in those files, which must be
//     registered below either with the composited pairs it affects, or with a
//     reason it affects no coloured content. This is what catches blind spot 2.
//
// Deliberately NOT attempted here, and why: full selector coverage of the
// ~230 rules that set a `color` but NOT a background. Their ground is
// inherited from an ancestor, so each one needs a hand-written background
// chain — DOM knowledge a stylesheet parser cannot recover. That is real work
// (77 chains for chat.css alone) and it belongs in design/contrast-check.mjs,
// which is not this lane's file. DECLARED_PAIRS below carries the handful
// whose ground is load-bearing and non-obvious; the rest stay uncovered and
// this comment is the disclosure.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// ── tmp fixtures ────────────────────────────────────────────────────────────
// server/test/tmpHelpers.ts is the repo's rule for this and pwa/ had no
// equivalent, so this file called mkdtempSync bare and never removed the
// directory: 688 /tmp/contrast-* dirs had accumulated by the time it was
// found, the oldest dated the day this branch's work started, and a mutation
// sweep runs the suite 50-120 times. Same shape as the helper: remember what
// we made, remove it in a file-scoped afterAll. A file-scoped hook rather than
// a sweep of /tmp/contrast-*, because test FILES run in parallel processes and
// a prefix sweep would delete a sibling's live fixture.
const madeTmp: string[] = [];
function mkTmp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  madeTmp.push(dir);
  return dir;
}
function removeTmpFixtures(): void {
  // `force`: a fixture its own test already removed is the normal case here,
  // not an error — this hook is the net underneath that.
  for (const dir of madeTmp.splice(0)) rmSync(dir, { recursive: true, force: true });
}
afterAll(removeTmpFixtures);

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

// ── WCAG 2.1 maths, over parsed CSS ─────────────────────────────────────────
type RGBA = readonly [number, number, number, number];

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

const read = (rel: string): string =>
  stripComments(readFileSync(path.resolve(process.cwd(), rel), 'utf8'));

/** The brace-balanced body of the first `open …{ }` block. Comments are
 *  stripped BEFORE this runs: `:root` and `[data-theme='light']` both appear
 *  in tokens.css's own prose, and a naive indexOf lands on the comment. */
function blockBody(src: string, open: string): string {
  const at = src.indexOf(open);
  if (at < 0) throw new Error(`tokens.css has no ${open} block`);
  const start = src.indexOf('{', at);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start + 1, i);
  }
  throw new Error(`unbalanced braces after ${open}`);
}

const customProps = (body: string): Record<string, string> =>
  Object.fromEntries(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]),
  );

const TOKENS = read('src/styles/tokens.css');
const DARK: Record<string, string> = customProps(blockBody(TOKENS, ':root'));
// The light theme is an OVERRIDE block, not a full palette: the wells, the
// syntax palette and every --syn-* value are declared once in :root and
// deliberately never re-declared. Spreading dark under light is what makes
// `[data-theme='light']` resolve the way a browser resolves it.
const LIGHT: Record<string, string> = { ...DARK, ...customProps(blockBody(TOKENS, "[data-theme='light']")) };

const hexToRgba = (s: string): RGBA | null => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (!m) return null;
  const h = m[1] as string;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    1,
  ] as const;
};

/** Resolve a CSS colour expression to premultiplied-nothing sRGB + alpha.
 *  Handles #rrggbb, var() chains, rgb()/rgba(), color-mix(in srgb, A p%, B)
 *  and the `transparent` keyword. Anything else throws — an unparsed colour
 *  must fail the audit loudly, never pass by being skipped. */
function resolveColor(expr: string, theme: Record<string, string>, depth = 0): RGBA {
  const e = expr.trim();
  if (depth > 12) throw new Error(`var() cycle resolving ${expr}`);
  if (/^transparent$/i.test(e)) return [0, 0, 0, 0] as const;
  const hex = hexToRgba(e);
  if (hex) return hex;
  let m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(e);
  if (m) {
    const name = m[1] as string;
    const v = theme[name];
    if (v === undefined) throw new Error(`unknown custom property ${name}`);
    return resolveColor(v, theme, depth + 1);
  }
  m = /^rgba?\(([^)]*)\)$/.exec(e);
  if (m) {
    const p = (m[1] as string).split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some(Number.isNaN)) throw new Error(`bad rgb(): ${e}`);
    return [p[0] as number, p[1] as number, p[2] as number, p[3] ?? 1] as const;
  }
  m = /^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)$/.exec(e);
  if (m) {
    const a = resolveColor(m[1] as string, theme, depth + 1);
    const b = resolveColor(m[3] as string, theme, depth + 1);
    const p = Number(m[2]) / 100;
    return [0, 1, 2, 3].map((i) => (a[i] as number) * p + (b[i] as number) * (1 - p)) as unknown as RGBA;
  }
  throw new Error(`unparsed colour expression: ${e}`);
}

/** Source-over composite of a (possibly translucent) fg onto an opaque bg. */
const over = (fg: RGBA, bg: RGBA): RGBA =>
  [0, 1, 2].map((i) => fg[3] * (fg[i] as number) + (1 - fg[3]) * (bg[i] as number)).concat([1]) as unknown as RGBA;

const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (c: RGBA): number =>
  0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);

const contrast = (a: RGBA, b: RGBA): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** The ratio of `fg` (optionally faded by an inherited element `opacity`)
 *  against a background CHAIN, painted back to front: chain[0] is the opaque
 *  ground, each later entry is composited over the one before it. */
function ratio(
  fgExpr: string,
  bgChain: readonly string[],
  theme: Record<string, string>,
  opacity = 1,
): number {
  let bg = resolveColor(bgChain[0] as string, theme);
  if (bg[3] !== 1) throw new Error(`background chain must start opaque, got ${bgChain[0]}`);
  for (const layer of bgChain.slice(1)) bg = over(resolveColor(layer, theme), bg);
  const raw = resolveColor(fgExpr, theme);
  return contrast(over([raw[0], raw[1], raw[2], raw[3] * opacity] as const, bg), bg);
}

const THEMES = [
  ['DARK ', DARK],
  ['LIGHT', LIGHT],
] as const;

// ── stylesheet rules ────────────────────────────────────────────────────────
const SHEETS = [
  'src/session/chat.css',
  'src/fleet/fleet.css',
  'src/components/primitives.css',
  'src/styles/shell.css',
] as const;

interface Rule { file: string; selector: string; body: string }

/** Every `selector { … }` in a stylesheet, including rules nested inside
 *  @media / @supports (the inner rule is what matches; the at-rule prelude is
 *  not a selector and never matches this pattern). */
function rules(file: string): Rule[] {
  const css = read(file);
  const found: Rule[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] as string).trim().replace(/\s+/g, ' ');
    if (selector === '' || selector.startsWith('@')) continue;
    found.push({ file: file.split('/').pop() as string, selector, body: m[2] as string });
  }
  return found;
}

const ALL_RULES: Rule[] = SHEETS.flatMap(rules);
const key = (r: Rule): string => `${r.file} ${r.selector}`;

const declOf = (body: string, prop: string): string | null => {
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(body);
  return m ? (m[1] as string).trim() : null;
};

// ── audit 1: every rule that names its own ground ───────────────────────────
// A rule that sets BOTH `color` and `background` carries its whole pair in one
// place: no DOM knowledge is needed and no human has to register anything.
// This is the audit that catches `.pr-body-preview`.

/** Rules whose `background` is not a self-sufficient opaque colour — a
 *  translucent tint, a gradient, `none` — need the ground they are painted on.
 *  One line of DOM knowledge each, and the ONLY hand-maintained part of the
 *  self-grounded audit. `floor` defaults to the 4.5 body-text floor. */
const GROUNDS: Record<string, { under: readonly string[]; floor?: number; why: string }> = {
  // The EXIT pill's tint is 12% alpha and rides a tool/message card.
  'chat.css .exit-badge': { under: ['var(--bg-surface)'], why: 'card ground; the same pair the gate calls "EXIT-badge pill"' },
  // Markdown tables and the terminal keycaps use an ink-tinted transparent
  // wash over whatever they sit on.
  'chat.css .msg-assist thead th': { under: ['var(--bg-page)'], why: 'assistant messages have no fill of their own' },
  'chat.css .term-keys .keycap': { under: ['var(--bg-well)'], why: 'the terminal screen is the well' },
  // `background: transparent` rules — the border and the ink are the whole
  // treatment. Each of these clears the floor on EITHER plausible ground
  // (page and surface / well), so the choice below is not load-bearing.
  'chat.css .pending-actions button': { under: ['var(--bg-page)'], why: 'ghost button in the message column; chat.css:16 paints the screen --bg-page' },
  'chat.css .code-block-copy': { under: ['var(--bg-well)'], why: 'the copy affordance sits inside the code well it copies' },
  'chat.css .compaction-head': { under: ['var(--bg-page)'], why: 'a full-width divider in the message column' },
  'primitives.css .btn-ghost': { under: ['var(--bg-sheet)'], why: 'the ghost button is a sheet/dialog control' },
};

/** Rules exempt from the self-grounded audit, each with the reason. WCAG
 *  1.4.3 exempts disabled controls; nothing else here is exempt for
 *  convenience. */
const SELF_GROUNDED_EXEMPT: Record<string, string> = {
  'chat.css .chat-head .keycap:disabled': 'WCAG 1.4.3 exempts inactive controls; --ink-disabled is documented sub-AA in tokens.css',
  'chat.css .send-btn:disabled': 'WCAG 1.4.3 exempts inactive controls',
  'primitives.css .btn-primary:disabled': 'WCAG 1.4.3 exempts inactive controls',
  'chat.css .attach-strip': 'the ground is the user\'s own image, so no ratio is computable; the rule IS the mitigation (a scrim gradient under --ink-on-well)',
};

/** Custom properties a rule declares in its OWN body shadow the theme for that
 *  rule — `.msg-assist .callout` sets `--callout-tint` and then paints with
 *  it, so resolving against the bare theme would throw on an unknown token. */
const localVars = (body: string): Record<string, string> =>
  Object.fromEntries(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]),
  );

// ── audit 2: static element opacity ─────────────────────────────────────────
// `opacity` composites over the ground and the token-pair gate cannot see it.
// Every static opacity strictly between 0 and 1 must appear here, either with
// the pairs it fades or with a reason it fades no coloured content.
//
// Animation KEYFRAME troughs (@keyframes … { from { opacity: .55 } }) are out
// of scope on purpose: they are transient states of a running animation, and
// the steady state each one reduces to under prefers-reduced-motion IS
// registered below. Measured for the record, none of them is text on a card:
// working-glyph .35, working-dot .25, tool-breathe .55, task-breathe .55.
type OpacityEntry =
  | { noText: string }
  | { pairs: readonly (readonly [string, string, readonly string[], number])[] };

const OPACITY_REGISTRY: Record<string, OpacityEntry> = {
  'fleet.css .bell 0.55': {
    noText: 'an emoji glyph button with an aria-label; it carries its own bitmap palette, no token colour composites here, and the meaningful state (.bell--on) is opacity 1',
  },
  'fleet.css .bell:disabled 0.35': { noText: 'WCAG 1.4.3 exempts inactive controls' },
  'chat.css .attach-chip[data-state=\'uploading\'] .attach-thumb 0.55': {
    noText: 'an <img> upload preview; the uploading state is also carried by the ::before ring',
  },
  'primitives.css .dot--busy, .dot--attention 0.85': {
    pairs: [
      ['busy dot on the lamp well', 'var(--status-busy)', ['var(--bg-well)'], 3],
      ['attention dot on the lamp well', 'var(--status-attention)', ['var(--bg-well)'], 3],
      ['busy dot on a card', 'var(--status-busy)', ['var(--bg-surface)'], 3],
      ['attention dot on a card', 'var(--status-attention)', ['var(--bg-surface)'], 3],
    ],
  },
  'chat.css .tool-dot--run 0.8': {
    pairs: [['running tool dot on a card', 'var(--status-busy)', ['var(--bg-surface)'], 3]],
  },
  'chat.css .task-mark--running 0.85': {
    pairs: [['the breathing task mark on a card', 'var(--status-busy-text)', ['var(--bg-surface)'], 4.5]],
  },
  'chat.css .term-overlay--connecting .term-overlay-word 0.8': {
    pairs: [[
      'the "attaching" word on the terminal scrim',
      'var(--ink-on-well)',
      ['var(--bg-well)', 'color-mix(in srgb, var(--bg-well) 78%, transparent)'],
      4.5,
    ]],
  },
  'shell.css .shell-placeholder-mark 0.6': {
    // Measured for the record: 2.93 dark / 2.42 light, under even the 3:1
    // large-text floor. It is exempt because it is not content — app.tsx:64
    // marks it aria-hidden="true" and the pane's actual message
    // (.shell-placeholder-copy, "Select a session") renders beside it at full
    // strength, --ink-secondary on the page.
    noText: 'purely decorative: aria-hidden="true" in app.tsx, and .shell-placeholder-copy carries the message unfaded',
  },
};

// ── audit 3: hand-declared pairs the parser cannot ground ───────────────────
// Deliberately small — see the file header. These are the rules whose ground
// is load-bearing AND non-obvious, i.e. the ones a reviewer would get wrong.
const DECLARED_PAIRS: readonly (readonly [string, string, readonly string[], number])[] = [
  // Wells are dark in BOTH themes, which is exactly the trap the light theme
  // sets: every ink token except --ink-on-well and the --syn-* palette is
  // TUNED FOR PAPER and dies on the glass. These four are every text role
  // that renders on a well.
  ['.pr-body-preview body text on the well', 'var(--ink-on-well)', ['var(--bg-well)'], 4.5],
  ['.dlg-reply-input typed text on the well', 'var(--ink-on-well)', ['var(--bg-well)'], 4.5],
  ['.dlg-reply-input::placeholder on the well', 'var(--syn-comment)', ['var(--bg-well)'], 4.5],
  ['.msg-attach-gone filename on the well', 'var(--syn-comment)', ['var(--bg-well)'], 4.5],
  // Archived rows: the fade that used to sit on .sess-line is gone, so the
  // past-tense signal is an ink step on the label. Both ends must hold.
  ['archived .sess-label ink step', 'var(--ink-secondary)', ['var(--bg-surface)'], 4.5],
  // Markdown callouts. The five variants rebind --callout-tint in rules that
  // set no colour of their own, so the self-grounded audit only ever sees the
  // base rule; the ::before label takes --callout-hue and is the tightest of
  // the ten. All ten sit on the message column, i.e. --bg-page.
  ['callout note body', 'var(--ink-secondary)', ['var(--bg-page)', 'var(--acct-corp-tint)'], 4.5],
  ['callout tip body', 'var(--ink-secondary)', ['var(--bg-page)', 'var(--accent-tint)'], 4.5],
  ['callout important body', 'var(--ink-secondary)', ['var(--bg-page)', 'var(--acct-claude2-tint)'], 4.5],
  ['callout warning body', 'var(--ink-secondary)', ['var(--bg-page)', 'var(--status-attention-tint)'], 4.5],
  ['callout caution body', 'var(--ink-secondary)', ['var(--bg-page)', 'var(--status-dead-tint-solid)'], 4.5],
  ['callout note label', 'var(--acct-corp)', ['var(--bg-page)', 'var(--acct-corp-tint)'], 4.5],
  ['callout tip label', 'var(--status-busy-text)', ['var(--bg-page)', 'var(--accent-tint)'], 4.5],
  ['callout important label', 'var(--acct-claude2)', ['var(--bg-page)', 'var(--acct-claude2-tint)'], 4.5],
  ['callout warning label', 'var(--status-attention-text)', ['var(--bg-page)', 'var(--status-attention-tint)'], 4.5],
  ['callout caution label', 'var(--status-dead-text)', ['var(--bg-page)', 'var(--status-dead-tint-solid)'], 4.5],
];

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

  // The injected copy lives in a REGISTERED tmp dir and is removed the moment
  // the child exits — `leaked` is what the next test reads.
  let leaked: string | undefined;

  it('exits non-zero when a pair fails', () => {
    const gate = path.resolve(process.cwd(), 'design/contrast-check.mjs');
    // Same script, one token swapped for a colour that cannot pass on dark.
    const broken = readFileSync(gate, 'utf8').replace('inkP: "#ECF0EC"', 'inkP: "#151815"');
    const dir = mkTmp('contrast-');
    leaked = dir;
    try {
      const injected = path.join(dir, 'contrast-check.mjs');
      writeFileSync(injected, broken);
      const bad = spawnSync(process.execPath, [injected], { encoding: 'utf8' });

      expect(bad.stdout).toMatch(/^FAIL/m);
      expect(bad.status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      madeTmp.splice(madeTmp.indexOf(dir), 1);
    }
  });

  // The pin for the /tmp leak: an afterAll cannot be observed from inside the
  // file it runs for, so the removal has to be observable from the NEXT test.
  // Before the fix this file made a /tmp/contrast-* directory on every run and
  // nothing ever removed it — 688 of them, oldest dated the day this branch
  // started.
  it('leaves no /tmp fixture behind', () => {
    expect(leaked).toBeDefined();
    expect(existsSync(leaked as string)).toBe(false);
    expect(madeTmp).toEqual([]);
  });

  // 11px text (--text-2xs) is body text, not a UI glyph: 4.5, not 3:1.
  it.each([
    'DARK  ask header chip / accent-tint',
    'LIGHT ask header chip / accent-tint',
    'DARK  preview toggle / sheet',
    'LIGHT preview toggle / sheet',
  ])('measures %s at the 4.5 body threshold', (label) => {
    const { ratio: r, min } = measured(label);
    expect(min).toBe(4.5);
    expect(r).toBeGreaterThanOrEqual(4.5);
  });

  // Originally the project-group header, which had no ground of its own, so
  // both of the things it put the attention hue behind sat on the bare page.
  // Same omission as the ask sheet's two pairs above: live in the CSS,
  // invisible to the gate. The dot (now .proj-card-attn, on a card surface —
  // kept here as a defensive floor on the raw hue/page combination) is a
  // glyph at 3:1; the projected-account line (.proj-add-acct[data-low], now
  // deleted — ccrc/fleet-polish Task 4 dropped the visible headroom flag
  // entirely) was 11px text at 4.5, which is exactly why it took
  // --status-attention-TEXT — LIGHT's dot hue reads 3.58 on the page and
  // would fail the body threshold. Both pairs stay as defensive floors, same
  // rationale as the dot/page pair.
  it.each([
    ['DARK  attention dot / page', 3],
    ['LIGHT attention dot / page', 3],
    ['DARK  attention-text / page', 4.5],
    ['LIGHT attention-text / page', 4.5],
  ])('measures %s at the %s threshold', (label, floor) => {
    const { ratio: r, min } = measured(label);
    expect(min).toBe(floor);
    expect(r).toBeGreaterThanOrEqual(floor);
  });

  // The PR keycap's merged dot (Task 15) is a non-text graphical object, so
  // 3:1 — not the 4.5 body-text floor. Both themes clear 4.5 too (8.06 dark,
  // 5.93 light), so without pinning the min itself here, a mutant that
  // loosened the pair's threshold to 4.5 would still print PASS and survive.
  it.each([
    'DARK  pr-merged / raised',
    'LIGHT pr-merged / raised',
  ])('measures %s at the 3:1 UI threshold, not 4.5 body', (label) => {
    const { ratio: r, min } = measured(label);
    expect(min).toBe(3);
    expect(r).toBeGreaterThanOrEqual(3);
  });
});

describe('the auditor itself', () => {
  // Six ratios the team computed by hand, over three years of tokens.css
  // comments. If the parser or the maths drifts, these move first.
  it.each([
    ['ink-tertiary on the light well', 'var(--ink-tertiary)', ['var(--bg-well)'], LIGHT, 3.167],
    ['dark violet on the LIGHT raised', '#C7A7F4', ['var(--bg-raised)'], LIGHT, 1.746],
    ['pr-merged on raised, dark', 'var(--pr-merged)', ['var(--bg-raised)'], DARK, 8.057],
    ['pr-merged on raised, light', 'var(--pr-merged)', ['var(--bg-raised)'], LIGHT, 5.932],
    ['ink-tertiary on raised, dark', 'var(--ink-tertiary)', ['var(--bg-raised)'], DARK, 5.27],
    ['ink-tertiary on raised, light', 'var(--ink-tertiary)', ['var(--bg-raised)'], LIGHT, 4.864],
    // alpha compositing: the EXIT pill is 12% --status-dead over a card
    ['dead-text on the EXIT pill', 'var(--status-dead-text)', ['var(--bg-surface)', 'var(--status-dead-tint)'], DARK, 5.884],
  ])('reproduces the hand-computed %s', (_n, fg, bg, theme, want) => {
    expect(ratio(fg, bg, theme as Record<string, string>)).toBeCloseTo(want as number, 2);
  });

  it('resolves var() chains and color-mix() rather than only literals', () => {
    // --pr-merged -> --acct-claude2 -> a hex, per theme.
    expect(resolveColor('var(--pr-merged)', DARK)).toEqual(resolveColor('#C7A7F4', DARK));
    expect(resolveColor('var(--pr-merged)', LIGHT)).toEqual(resolveColor('#6D3FB4', LIGHT));
    // 5% ink over the well, the well-bar chrome.
    const bar = resolveColor('var(--well-bar-bg)', DARK);
    expect(bar[0]).toBeGreaterThan(resolveColor('var(--bg-well)', DARK)[0]);
  });

  it('refuses to silently pass a colour it cannot parse', () => {
    expect(() => resolveColor('CanvasText', DARK)).toThrow(/unparsed colour/);
    expect(() => resolveColor('var(--no-such-token)', DARK)).toThrow(/unknown custom property/);
  });

  it.each(THEMES)('%s binds --status-dead-tint-solid to the tint it derives from', (_n, theme) => {
    // The 12%-over-a-card correction was written out as a color-mix() in three
    // stylesheets and five rows of this file, duplicating --status-dead-tint's
    // own definition with nothing binding the 12% or the base hue to it:
    // retuning tokens.css diverged from all three surfaces silently. tokens.css
    // owns the value now, and this is the pin that keeps the two spellings of
    // it — the translucent pill tint and the pre-composited banner fill — from
    // drifting apart.
    const composited = over(
      resolveColor('var(--status-dead-tint)', theme as Record<string, string>),
      resolveColor('var(--bg-surface)', theme as Record<string, string>),
    );
    expect(resolveColor('var(--status-dead-tint-solid)', theme as Record<string, string>)).toEqual(composited);
  });

  it('reads BOTH theme blocks out of tokens.css, not a copy of them', () => {
    expect(DARK['--bg-surface']).toBe('#141715');
    expect(LIGHT['--bg-surface']).toBe('#FFFFFF');
    // The light block is an override: values it does not re-declare fall
    // through from :root. --bg-well IS re-declared (deliberately still dark);
    // the syntax palette is not.
    expect(LIGHT['--bg-well']).toBe('#141715');
    expect(LIGHT['--syn-comment']).toBe(DARK['--syn-comment']);
  });
});

// The gate's D/Lt tables are a hand-typed copy of tokens.css, and a copy is a
// drift class: deviations 86 and 87 were both "the table and the stylesheet
// disagree". Until the gate itself parses tokens.css (design/contrast-check.mjs
// is not this lane's file), this test is what makes the copy safe.
describe('design/contrast-check.mjs does not drift from tokens.css', () => {
  const gateSrc = readFileSync(path.resolve(process.cwd(), 'design/contrast-check.mjs'), 'utf8');
  const table = (name: string): Record<string, string> => {
    const at = gateSrc.indexOf(`const ${name} = {`);
    if (at < 0) throw new Error(`design/contrast-check.mjs has no ${name} table`);
    const body = blockBody(stripComments(gateSrc.slice(at)), `const ${name} =`);
    return Object.fromEntries(
      [...body.matchAll(/(\w+)\s*:\s*"(#[0-9a-fA-F]{6})"/g)].map((m) => [m[1] as string, m[2] as string]),
    );
  };
  /** gate table key -> the tokens.css custom property it copies. */
  const OF: Record<string, string> = {
    page: '--bg-page', surface: '--bg-surface', raised: '--bg-raised', well: '--bg-well',
    sheet: '--bg-sheet', edgeStrong: '--edge-strong',
    inkP: '--ink-primary', inkS: '--ink-secondary', inkT: '--ink-tertiary', inkWell: '--ink-on-well',
    accent: '--accent', accentInk: '--ink-on-accent', accentTint: '--accent-tint',
    busy: '--status-busy', busyText: '--status-busy-text', idle: '--status-idle',
    att: '--status-attention', attText: '--status-attention-text', attTint: '--status-attention-tint',
    dead: '--status-dead', deadText: '--status-dead-text',
    claude: '--acct-claude', claudeT: '--acct-claude-tint',
    claude2: '--acct-claude2', claude2T: '--acct-claude2-tint',
    corp: '--acct-corp', corpT: '--acct-corp-tint',
    gpt: '--acct-gpt', gptT: '--acct-gpt-tint',
    track: '--limit-track', lOk: '--limit-ok', lWarn: '--limit-warn', lCrit: '--limit-critical',
    diffAdd: '--diff-add', diffDel: '--diff-del',
    prMerged: '--pr-merged',
  };

  it.each([['D', DARK], ['Lt', LIGHT]] as const)(
    'every hex in the %s table still equals the token it copies',
    (name, theme) => {
      const copied = table(name);
      const drift: string[] = [];
      for (const [field, hex] of Object.entries(copied)) {
        const token = OF[field];
        expect(token, `gate table ${name} has field "${field}" with no tokens.css mapping`).toBeDefined();
        const truth = resolveColor(`var(${token as string})`, theme);
        const mine = resolveColor(hex, theme);
        if (truth.join() !== mine.join()) drift.push(`${name}.${field} = ${hex} but ${token} is ${truth.slice(0, 3).join()}`);
      }
      expect(drift).toEqual([]);
      // and no token the gate SHOULD be copying has quietly vanished
      expect(Object.keys(copied).sort()).toEqual(Object.keys(OF).sort());
    },
  );
});

describe('every rule that names its own background is measured', () => {
  const selfGrounded = ALL_RULES.filter((r) => {
    const c = declOf(r.body, 'color');
    const b = declOf(r.body, 'background') ?? declOf(r.body, 'background-color');
    if (c === null || b === null) return false;
    if (/^(inherit|currentColor|unset|initial)$/i.test(c)) return false;
    if (/^(none|inherit|unset|initial)$/i.test(b)) return false;
    return true;
  });

  it('finds a non-trivial number of self-grounded rules', () => {
    // A parser that silently matched nothing would make every case below
    // vacuously green — the exact shape of a fake gate.
    expect(selfGrounded.length).toBeGreaterThanOrEqual(40);
  });

  it('clears the floor in BOTH themes, for every one of them', () => {
    const failures: string[] = [];
    for (const rule of selfGrounded) {
      const k = key(rule);
      if (k in SELF_GROUNDED_EXEMPT) continue;
      const fg = declOf(rule.body, 'color') as string;
      const bgDecl = (declOf(rule.body, 'background') ?? declOf(rule.body, 'background-color')) as string;
      const ground = GROUNDS[k];
      const floor = ground?.floor ?? 4.5;
      for (const [theme, base] of THEMES) {
        const tokens = { ...base, ...localVars(rule.body) };
        let r: number;
        try {
          const bg = resolveColor(bgDecl, tokens);
          const chain = bg[3] === 1 && ground === undefined
            ? [bgDecl]
            : [...(ground?.under ?? []), bgDecl];
          if (bg[3] !== 1 && ground === undefined) {
            failures.push(`${theme} ${k}: background ${bgDecl} is translucent and has no GROUNDS entry`);
            continue;
          }
          r = ratio(fg, chain, tokens);
        } catch (e) {
          failures.push(`${theme} ${k}: ${(e as Error).message} — add a GROUNDS entry or an exemption with a reason`);
          continue;
        }
        if (r < floor) failures.push(`${theme} ${k}: ${r.toFixed(2)} (floor ${floor}) — ${fg} on ${bgDecl}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('has no stale GROUNDS or exemption entries', () => {
    const live = new Set(selfGrounded.map(key));
    expect(Object.keys(GROUNDS).filter((k) => !live.has(k))).toEqual([]);
    expect(Object.keys(SELF_GROUNDED_EXEMPT).filter((k) => !live.has(k))).toEqual([]);
  });
});

describe('every static opacity is registered and composited', () => {
  /** file+selector+value for every static `opacity: x` with 0 < x < 1. */
  const faded = ALL_RULES.flatMap((r) => {
    // @keyframes stops ("from", "to", "0%, 80%, 100%") — see the note above.
    if (r.selector.split(',').every((s) => /^(from|to|[\d.]+%)$/.test(s.trim()))) return [];
    const v = declOf(r.body, 'opacity');
    if (v === null) return [];
    const n = Number(v);
    if (!(n > 0 && n < 1)) return [];
    return [{ rule: r, value: v, k: `${key(r)} ${v}` }];
  });

  it('finds the opacity declarations at all', () => {
    expect(faded.length).toBeGreaterThanOrEqual(6);
  });

  it('registers every one of them', () => {
    // The blind spot itself: `.proj-archived-body .sess-line { opacity: 0.72 }`
    // was added, faded fifteen gated pairs under their floors, and no gate
    // anywhere had an opinion. Now a new one cannot be added without a
    // contrast decision written down next to it.
    const unregistered = faded.filter((f) => !(f.k in OPACITY_REGISTRY)).map((f) => f.k);
    expect(unregistered).toEqual([]);
  });

  it('has no stale registry entries', () => {
    const live = new Set(faded.map((f) => f.k));
    expect(Object.keys(OPACITY_REGISTRY).filter((k) => !live.has(k))).toEqual([]);
  });

  it('clears the floor for every pair a fade composites', () => {
    const failures: string[] = [];
    for (const f of faded) {
      const entry = OPACITY_REGISTRY[f.k];
      if (entry === undefined || !('pairs' in entry)) continue;
      for (const [label, fg, chain, floor] of entry.pairs) {
        for (const [theme, tokens] of THEMES) {
          const r = ratio(fg, chain, tokens, Number(f.value));
          if (r < floor) failures.push(`${theme} ${f.k} — ${label}: ${r.toFixed(2)} (floor ${floor})`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('the fleet list carries no element opacity when the socket is down', () => {
    // This fade used to be here, registered as knownBelowFloor with a
    // "characterisation pin" — and the pin named the WRONG worst pair (the
    // .sess-meta middot at 3.34 light, while the attention lamp dot sat at
    // 2.67 against a 3:1 floor), while the knownBelowFloor form itself made
    // the floor test SKIP every other pair of that fade, so a regression in
    // the lamp dots moved silently. Removing the fade removes both the defect
    // and the escape hatch: every fade must now clear every floor it touches
    // or composite no coloured content.
    const dimmed = ALL_RULES.filter(
      (r) => r.selector.includes('data-conn') && declOf(r.body, 'opacity') !== null,
    );
    expect(dimmed.map((r) => r.selector)).toEqual([]);
  });
});

describe('hand-declared pairs whose ground is inherited', () => {
  it.each(DECLARED_PAIRS)('%s clears its floor in both themes', (_label, fg, chain, floor) => {
    for (const [, tokens] of THEMES) {
      expect(ratio(fg, chain, tokens)).toBeGreaterThanOrEqual(floor);
    }
  });

  // The declarations above are only worth anything if the stylesheet still
  // says what they claim it says.
  it.each([
    ['chat.css', '.pr-body-preview', 'color', 'var(--ink-on-well)'],
    ['chat.css', '.dlg-reply-input', 'color', 'var(--ink-on-well)'],
    ['chat.css', '.dlg-reply-input::placeholder', 'color', 'var(--syn-comment)'],
    ['chat.css', '.msg-attach-gone', 'color', 'var(--syn-comment)'],
    ['fleet.css', '.proj-archived-body .sess-line:not(.sess-line--active) .sess-label', 'color', 'var(--ink-secondary)'],
    // The three places the 12%-dead tint had to stop compositing over the page.
    ['chat.css', '.chat-banner--dead', 'background', 'var(--status-dead-tint-solid)'],
    ['fleet.css', '.fleet-host-banner', 'background', 'var(--status-dead-tint-solid)'],
    ['chat.css', ".msg-assist .callout[data-callout='caution']", '--callout-tint', 'var(--status-dead-tint-solid)'],
  ])('%s %s still sets %s: %s', (file, selector, prop, value) => {
    const rule = ALL_RULES.find((r) => r.file === file && r.selector === selector);
    expect(rule, `${file} has no rule for ${selector}`).toBeDefined();
    expect(declOf((rule as Rule).body, prop)).toBe(value);
  });

  // The archived fade is gone and must stay gone: no descendant of
  // .proj-archived-body may take element opacity again.
  it('archived rows carry no element opacity', () => {
    const archived = ALL_RULES.filter((r) => r.selector.includes('.proj-archived-body'));
    expect(archived.length).toBeGreaterThan(0);
    expect(archived.filter((r) => declOf(r.body, 'opacity') !== null).map((r) => r.selector)).toEqual([]);
  });
});
