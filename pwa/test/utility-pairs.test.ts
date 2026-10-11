// The pairs a COMPONENT renders are derived from the component, not listed.
//
// WHY THIS EXISTS. The contrast gate has two halves and a seam between them.
// `design/audit.mjs` parses stylesheet RULES: it finds `color` and
// `background` in a `.css` file, resolves both through twelve palettes and
// measures them. `design/contrast-check.mjs` measures a hand-written list of
// TOKEN PAIRS — `ink-on-accent / accent`, the status dots on each ground, and
// so on. Between them they print ALL 3540 PASS.
//
// Neither half can see a component styled with Tailwind utilities. There is no
// stylesheet rule to parse — `Button` has no `button.css`, and `Skeleton` has
// no rules at all — so audit.mjs contributes zero pairs for them. And while
// contrast-check.mjs does measure `ink-on-accent / accent`, nothing connects
// that pair to the component: the list is hand-maintained, so it says those two
// tokens are legible TOGETHER, never that `Button`'s primary variant is the
// thing that puts them together. Change `bg-accent` to `bg-raised` in
// `button.tsx` and both halves still print ALL PASS, because the stylesheet
// half sees no rule and the token half is still measuring the pair the
// component no longer renders.
//
// That is precisely the drift tokens.css's own header warns about: "both of
// those shapes shipped live AA failures under a green gate", and "a count of
// pairs is deliberately not quoted here" because the comment said 74 while the
// gate measured 94. A hand-kept list of pairs is the same artifact as a
// hand-kept count.
//
// So this guard DERIVES. It reads the class strings out of the design system's
// own .tsx, groups the utilities by state prefix (a `disabled:` ground and a
// `disabled:` ink are a real pair; a `disabled:` ground and an unprefixed ink
// are not), maps each utility back through theme.css's @theme block to the
// token it actually names, and measures the result across every palette. Add a
// variant, and its pair is measured because it exists — not because someone
// remembered to add a line here.
//
// WHAT IT DELIBERATELY DOES NOT DO. A utility pair with no ground in the same
// prefix group (StatusDot's `text-status-busy`, which inherits whatever is
// behind it) is NOT measured here. Those are the INHERITED_GROUNDS case, and
// audit.mjs already owns that machinery for stylesheet rules; duplicating a
// weaker copy of it would mean two answers for the same pixels. They remain
// covered by contrast-check.mjs's token arm. This file closes the
// self-grounded case, which is the one where the component alone decides both
// sides of the pair and nothing was checking it.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadThemes, ratio } from '../design/audit.mjs';
import { cn } from '../../ui/src/lib/cn';
import * as ui from '@ccrc/ui';

const UI_SRC = path.join(import.meta.dirname, '..', '..', 'ui', 'src');

/** Every shipped `.tsx` in the design system. Stories are excluded for the
 *  same reason `ui-package-boundary.test.ts` excludes them: tsconfig.build
 *  excludes them, so nothing a story writes reaches a consumer. */
function componentFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...componentFiles(p));
    else if (e.isFile() && e.name.endsWith('.tsx') && !e.name.endsWith('.stories.tsx')) out.push(p);
  }
  return out.sort();
}

/** theme.css's `@theme` block as `utility-stem -> css expression`, e.g.
 *  `accent -> var(--accent)`. This is the ONLY source of truth for whether a
 *  `text-*` names a colour or a font size: `--color-ink-primary` exists and
 *  `--color-base` does not, so `text-ink-primary` is ink and `text-base` is a
 *  size. A hand-kept exclusion list of size names would be the same drift
 *  this whole file exists to avoid. */
function colourStems(): Map<string, string> {
  const css = readFileSync(path.join(UI_SRC, 'styles', 'theme.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  for (const m of css.matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1] ?? '', (m[2] ?? '').trim());
  }
  return out;
}

const STEMS = colourStems();

/** Every class string literal in a component: cva bases, cva variant values,
 *  and plain `className="…"`. Taken as raw literals rather than by parsing the
 *  cva call, because a variant value and a className are the same thing for
 *  this purpose — a set of utilities that land on one element together. */
function classStrings(src: string): string[] {
  const out: string[] = [];
  // Single- and double-quoted literals that contain at least one space-
  // separated utility-looking token. Template literals are skipped on purpose:
  // an interpolated class is not statically knowable, and guessing would make
  // this guard report pairs no build ever emits.
  for (const m of src.matchAll(/'([^'\\\n]{8,})'|"([^"\\\n]{8,})"/g)) {
    const s = m[1] ?? m[2] ?? '';
    if (/(^|\s)(bg|text|border|shadow)-[a-z]/.test(s)) out.push(s);
  }
  return out;
}

type Pair = {
  readonly file: string;
  readonly state: string;
  readonly ink: string;
  readonly ground: string;
};

/** The self-grounded pairs one class string declares, one per state prefix.
 *
 *  GROUPING BY PREFIX IS THE WHOLE POINT. `bg-accent text-ink-on-accent
 *  disabled:bg-edge-subtle disabled:text-ink-disabled` is TWO pairs, and
 *  measuring the cross products would invent two more that no state ever
 *  renders. Prefixes are compared whole, so `enabled:active:` and `disabled:`
 *  never mix. */
function pairsIn(file: string, s: string): Pair[] {
  const ink = new Map<string, string>();
  const ground = new Map<string, string>();
  for (const token of s.split(/\s+/)) {
    const at = token.lastIndexOf(':');
    const state = at < 0 ? '' : token.slice(0, at + 1);
    const bare = token.slice(at + 1);
    const bg = /^bg-(.+)$/.exec(bare);
    const fg = /^text-(.+)$/.exec(bare);
    // `transparent` is a real stem but not a ground — it paints nothing, so
    // the element's ground is its ancestor's and this is the inherited case.
    if (bg !== null && STEMS.has(bg[1] ?? '') && bg[1] !== 'transparent') {
      ground.set(state, STEMS.get(bg[1] ?? '') ?? '');
    }
    if (fg !== null && STEMS.has(fg[1] ?? '')) ink.set(state, STEMS.get(fg[1] ?? '') ?? '');
  }
  const out: Pair[] = [];
  for (const [state, g] of ground) {
    const i = ink.get(state);
    if (i !== undefined) out.push({ file, state, ink: i, ground: g });
  }
  return out;
}

const pairs = componentFiles(UI_SRC).flatMap((f) =>
  classStrings(readFileSync(f, 'utf8')).flatMap((s) => pairsIn(path.basename(f), s)));

// `:root` plus every named palette — the same twelve `loadThemes().all` loops
// over, built from `DARK` and `byName` instead because `all` is a
// heterogeneous array literal that TS widens to (string | Record)[][], and
// casting it back is a double assertion over the exact shape this guard
// depends on. These two are typed as themselves.
const { DARK, byName } = loadThemes();
const all: [string, Record<string, string>][] = [['DARK', DARK], ...Object.entries(byName)];

/** Pairs that are below the AA floor and allowed to be, each with the reason.
 *
 *  Keyed `<file> <state><ink> on <ground>`, the same shape audit.mjs's own
 *  registries use, and checked in BOTH directions below: an entry whose pair
 *  no longer exists is stale and reds, exactly as `contrast.test.ts` asserts
 *  `report.stale[kind]` is empty. An exemption nobody can delete is how a
 *  registry becomes a list of excuses. */
const BELOW_FLOOR: Record<string, string> = {
  'button.tsx disabled:var(--ink-disabled) on var(--edge-subtle)':
    'The disabled primary button, measured 2.01 at worst (LIGHT). WCAG 2.1 SC 1.4.3 '
    + 'exempts it by name: "Text or images of text that are part of an inactive user '
    + 'interface component … have no contrast requirement." Deliberately NOT raised to '
    + 'clear 4.5 — a disabled control that reads as crisply as an enabled one is a worse '
    + 'defect than a dim one, because the dimness IS the affordance. The state carries '
    + 'the two cues this palette requires without leaning on the ratio: the greyed fill, '
    + 'and `disabled:cursor-default` from the cva base — plus the `disabled` attribute '
    + 'itself, which is what a screen reader announces and no contrast figure can convey.',
};

describe('every self-grounded utility pair a component renders is measured', () => {
  it('found pairs to measure — the scan is not vacuously empty', () => {
    // Without this the suite passes by finding nothing, which is exactly how a
    // census guard dies: a refactor moves the strings and the gate goes quiet
    // instead of red. Measured 3 pairs across 2 files today — few, because
    // most ui components inherit their ground rather than painting one, and
    // those stay with audit.mjs's INHERITED_GROUNDS machinery by design.
    // Five since the quiet variant and the count badge arrived with grounds
    // of their own.
    expect(pairs.length).toBeGreaterThanOrEqual(5);
    expect(new Set(pairs.map((p) => p.file)).size).toBeGreaterThanOrEqual(2);
  });

  it('includes the primary button, the most rendered pair in the tree', () => {
    // Named explicitly because it is the pair the shadcn-alias question turns
    // on: --color-accent is the phosphor here and the hover grey in shadcn.
    // If this stops being bg-accent/ink-on-accent, that is a design decision
    // someone should have to make deliberately.
    expect(pairs).toContainEqual({
      file: 'button.tsx',
      state: '',
      ink: 'var(--ink-on-accent)',
      ground: 'var(--accent)',
    });
  });

  it('includes the well, which this guard INHERITED from the stylesheet half', () => {
    // `chat.css .well` was measured by the stylesheet scan for twelve
    // palettes. The Well migration deleted that rule, and the gate's headline
    // fell by exactly those twelve — so this is the assertion that says the
    // coverage moved rather than evaporated. A surface whose ink and ground
    // are both utilities is invisible to audit.mjs by construction; it is
    // visible HERE or it is visible nowhere.
    expect(pairs).toContainEqual({
      file: 'well.tsx',
      state: '',
      ink: 'var(--ink-on-well)',
      ground: 'var(--bg-well)',
    });
  });

  it('includes the quiet control, whose five rules the gate used to measure', () => {
    // `.coord-toggle`, `.child-reclaim-toggle`, `.caps-save`,
    // `.program-start-door` and `.program-start-go` each declared
    // `color: var(--ink-secondary)` over `background: var(--bg-raised)`, and
    // audit.mjs measured all five across twelve palettes — SIXTY of the
    // gate's checks. Folding them into one cva variant took the gate from
    // 3564 to 3504, which is exactly those sixty and not one more.
    //
    // The coverage did not evaporate; it moved HERE, where one assertion
    // stands for all five because they render one class string. The variant is
    // self-grounded on purpose — it declares `bg-raised` as well as its ink —
    // precisely so this derivation has a ground to find.
    expect(pairs).toContainEqual({
      file: 'button.tsx',
      state: '',
      ink: 'var(--ink-secondary)',
      ground: 'var(--bg-raised)',
    });
  });

  it('includes the text input, whose two inline copies the gate used to measure', () => {
    // `.pr-title-input` and `.pool-new-input` each declared
    // `color: var(--ink-primary)` over `background: var(--bg-raised)` and were
    // measured across twelve palettes — twenty-four of the gate's checks, which
    // is exactly what it fell by (3504 -> 3480) when both became `<TextInput>`.
    // The three fields that migrated before them had already moved this pair
    // here; the two that arrived late simply joined it.
    expect(pairs).toContainEqual({
      file: 'text-input.tsx',
      state: '',
      ink: 'var(--ink-primary)',
      ground: 'var(--bg-raised)',
    });
  });

  it('includes the count badge, whose two rules the gate used to measure', () => {
    // `.bucket-head-unseen` and `.mail-badge-count` each declared
    // `--status-attention-text` over `--status-attention-tint` and were
    // measured across twelve palettes — twenty-four checks, which is exactly
    // what the gate fell by (3480 -> 3456) when both became `<CountBadge>`.
    // The attention pair is the one that matters most to get right: it is the
    // only thing on the screen saying something is waiting.
    expect(pairs).toContainEqual({
      file: 'count-badge.tsx',
      state: '',
      ink: 'var(--status-attention-text)',
      ground: 'var(--status-attention-tint)',
    });
  });

  const keyOf = (p: Pair): string => `${p.file} ${p.state}${p.ink} on ${p.ground}`;

  for (const [theme, palette] of all) {
    it(`clears AA 4.5:1 in ${theme.trim()}`, () => {
      const failures = pairs
        .filter((p) => BELOW_FLOOR[keyOf(p)] === undefined)
        .map((p) => ({ p, r: ratio(p.ink, [p.ground], palette) }))
        .filter(({ r }) => r < 4.5)
        .map(({ p, r }) => `${keyOf(p)} = ${r.toFixed(2)}`);
      expect(failures).toEqual([]);
    });
  }

  it('registers no exemption for a pair that no longer exists', () => {
    // The other direction. Without it, deleting the disabled variant leaves an
    // entry that quietly pre-authorises whatever is written next under the
    // same key — the stale-registry shape contrast.test.ts guards for the
    // stylesheet half.
    const live = new Set(pairs.map(keyOf));
    expect(Object.keys(BELOW_FLOOR).filter((k) => !live.has(k))).toEqual([]);
  });

  it('holds every exemption to a stated reason, not a bare entry', () => {
    const unexplained = Object.entries(BELOW_FLOOR)
      .filter(([, why]) => why.trim().length < 80)
      .map(([k]) => k);
    expect(unexplained).toEqual([]);
  });
});

// ── the string the DOM actually gets ────────────────────────────────────────
describe('every class string survives the merge that renders it', () => {
  // THE PAIR THIS FILE MEASURES HAS TO REACH THE ELEMENT. Every component here
  // renders `cn(BASE, className)`, and `cn` is tailwind-merge, which drops the
  // earlier of two utilities it believes touch the same property. It classifies
  // an unknown utility BY PREFIX — and this theme renames two families that
  // Tailwind v4 owns, so `text-input` and `text-2xs` looked like text COLOURS
  // and `font-regular` looked like a font FAMILY.
  //
  // Seven shipped strings lost a utility on the way to the DOM because of it:
  // `TEXT_INPUT` and `SELECT` rendered with NO ink utility at all, and `Well`
  // and `ControlRow` rendered in the UI family rather than mono. Every guard in
  // the tree reads the string, and the string was right — the loss happened
  // inside `cn`, where nothing was looking. `ui/src/lib/cn.ts` declares the two
  // groups now; this is the measurement that says it still does.
  //
  // It is also the general form: a future renamed family breaks this without
  // anyone having to think of it.
  //
  //   | mutation                                   | result            |
  //   |--------------------------------------------|-------------------|
  //   | `font-size` group deleted from cn.ts       | 1 red (ink lost)  |
  //   | `font-weight` group deleted from cn.ts     | 1 red (family)    |
  //   | the exported-constant source removed       | green — and that  |
  //   |                                            | is why it is here |
  //
  // The third row is the finding: the per-literal scan ALONE cannot see this
  // class of defect, because the strings that collide are written apart.
  // TWO SOURCES, AND THE SECOND IS THE ONE THAT CATCHES THIS. The per-file
  // literals above are what a component writes; the EXPORTED constants are
  // what an element wears. They differ because a long class string is written
  // as a CONCATENATION — `TEXT_INPUT` is five literals with comments between
  // them — so `text-ink-primary` and `text-input` never appear in the same
  // literal and a per-literal check cannot see them collide. Measured: with
  // the font-size group deleted from `cn`, the literal scan stayed green and
  // the constant scan went red.
  const exported = Object.entries(ui)
    .filter((e): e is [string, string] => typeof e[1] === 'string')
    .filter(([, v]) => /(^|\s)(bg|text|border|font|min-h|w)-[a-z0-9]/.test(v));
  // `buttonVariants()` is deliberately NOT a source: a cva composes BASE then
  // VARIANT, and a variant overriding the base is the mechanism working —
  // `ghost` replaces the base's `transition-transform`, `quiet` its `font-ui`
  // and its press scale. A check over the composed string would read every
  // intended override as a loss. What is checked here is each string ALONE.
  const strings: [string, string][] = [
    ...componentFiles(UI_SRC).flatMap((f) =>
      classStrings(readFileSync(f, 'utf8')).map((s) => [path.basename(f), s] as [string, string])),
    ...exported,
  ];

  it('reads enough strings for the check to mean something', () => {
    expect(strings.length).toBeGreaterThan(40);
    expect(exported.length, 'no exported class string was found — the scan is vacuous')
      .toBeGreaterThan(8);
    expect(exported.map(([k]) => k)).toContain('TEXT_INPUT');
    expect(exported.map(([k]) => k)).toContain('SELECT');
  });

  it('loses no utility between the source and the element', () => {
    const lost: string[] = [];
    for (const [file, s] of strings) {
      const kept = new Set(cn(s).split(/\s+/));
      const dropped = s.split(/\s+/).filter((t) => t !== '' && !kept.has(t));
      if (dropped.length > 0) lost.push(`${file}: ${dropped.join(' ')}  (in "${s}")`);
    }
    expect(lost).toEqual([]);
  });

  it('still lets a caller override what a component set', () => {
    // The other direction, and the reason `cn` exists at all: teaching it the
    // two groups must not turn it into `clsx`. A width, an ink and a size are
    // each replaceable by the call site — `FleetScreen`'s chooser depends on
    // exactly this for its `w-auto`.
    const merged = cn('w-full text-ink-primary text-input', 'w-auto text-ink-tertiary text-2xs')
      .split(/\s+/);
    expect(merged).toEqual(['w-auto', 'text-ink-tertiary', 'text-2xs']);
  });
});
