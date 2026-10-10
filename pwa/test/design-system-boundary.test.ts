// THE BOUNDARY BETWEEN @ccrc/ui AND THIS APP, AS A MECHANISM.
//
// This guard exists because the boundary was crossed silently once already.
// Wave 2 retired `styles/legacy.css`, whose `.btn-primary`/`.btn-ghost` rules
// were the last copy of the button's styling outside the design system. While
// that work sat on a branch, `main` grew four new files that hand-wrote those
// same class names on raw `<button>` elements. Both sides were green: the app's
// suite never rendered those buttons against the retired stylesheet, and the
// contrast gate reads stylesheets, so a class with no rule behind it is
// invisible to it. The defect only appeared on the rebase, as ten buttons with
// no styling at all.
//
// The rule is therefore not "prefer the primitive". It is that the VOCABULARY
// belongs to the primitive: `btn-primary` and `btn-ghost` are emitted by
// `buttonVariants` in @ccrc/ui and by nothing else. A call site that needs a
// button imports `Button`; one that needs to style a link as a button imports
// `buttonVariants`. Either way the class arrives from the one definition, so it
// cannot outlive it.
//
// The classes themselves STAY on the rendered element on purpose — several
// scoped descendant rules (`.block-screen .btn-primary`, `.update-banner-actions
// .btn-ghost`, `.btn-ghost.settings-move`) select on them from this package's
// own stylesheets, and those sheets are imported unlayered so they still beat
// the utilities. Structural hooks, not styling.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(import.meta.dirname, '..', 'src');
const UI_SRC = path.join(import.meta.dirname, '..', '..', 'ui', 'src');

/** Class names whose only legitimate source is a cva in @ccrc/ui.
 *
 *  Every entry is emitted by the primitive named beside it and by nothing else,
 *  so a call site that writes one by hand has forked the design system without
 *  saying so. The list is the WHOLE owned vocabulary, not just the button's:
 *  buttons were what drifted, but nothing made the other five safer.
 *
 *  What is deliberately NOT here, and why the distinction matters:
 *    - `skel--user`, `proj-skel`, `limit-row` on an app layout: MODIFIERS a
 *      call site passes through `className`. `<Skeleton className="proj-skel">`
 *      is the sanctioned shape, and the matcher is word-bounded so `skel--user`
 *      never reads as `skel`.
 *    - `qc-consequence` / `qc-actions`: hook classes the SHEETS carry, not the
 *      primitive — `QuickConfirm` is one way to build a confirm, and the three
 *      sheets that roll their own still want the same hooks for tests and for
 *      scoped rules.
 *    - `pr-dot` and `chat-skel`: chat.css's own vocabulary, which only looks
 *      like the primitive's. Word-bounded matching keeps them out.
 *      `tool-dot--run` was on this line too and did not belong: ToolCard
 *      emits it and tool-card.css styles it. Corrected when the completeness
 *      check at the end of this file found it.
 *    - `opts`, `opt-wait`, `opt-inert`, `opt-degraded`, `opt-preview*`: the
 *      app's, and the distinction is the sharpest one on this list because
 *      they share a prefix with eight entries that ARE owned. `OptionRow`
 *      renders the ROW; what a row MEANS on this fleet — a routing field
 *      inert on the session's lane, a class serving one rung down a share
 *      ceiling, a keystroke in flight — is ccrc's, and arrives through the
 *      row's `marker`/`children` slots wearing these names. `opt-wait` is
 *      not even always on a row: the approval sheet's Allow/Deny buttons
 *      wear it too. Word-bounded matching is what keeps `opts` from reading
 *      as `opt`.
 *    - `substrate-banner`, `offline-banner`, `chat-banner*`, `coord-banner`,
 *      `update-banner`: the app's. `banner` IS owned (Banner's base), and the
 *      boundary between it and these is the same whitespace one that keeps
 *      `opts` out: `substrate-banner` has a hyphen where the matcher needs a
 *      space, so it reads as a hook class the call site passes through
 *      `className` — which is exactly what it is, carrying no styling and
 *      existing so a screen rendering two banners can say which is which. */
/** HAND-KEPT, and the test below is what stops it going stale.
 *
 *  It had already gone stale once: `Keycap` shipped emitting `.keycap`, two
 *  app rules redressed it, and `ui-package-boundary.test.ts` — which reads
 *  this list to decide what counts as a reach-in — could not see either of
 *  them. A list beside a package that grows is the drift this repo keeps
 *  rediscovering.
 *
 *  It stays a list rather than a derivation because it answers a question no
 *  derivation can: which tokens are VOCABULARY rather than utilities.
 *  `dot--busy` belongs here and is selected by no stylesheet at all; `grid`
 *  and `flex` are emitted on every second line and belong nowhere near it.
 *  What CAN be derived is the half that went stale — a class this package
 *  emits that some stylesheet also selects is a hook class by definition, and
 *  `completes every hook class @ccrc/ui emits` below reds until it is here. */
export const OWNED = [
  'btn-primary', 'btn-ghost',                                    // Button / buttonVariants
  'dot', 'dot--busy', 'dot--attention', 'dot--idle',             // StatusDot / dotVariants
  'dot--done', 'dot--cleanup', 'dot--dead',
  'limits', 'limit-track', 'limit-fill',                         // LimitBar / fillVariants / LIMIT_TRACK
  'limit-fill--ok', 'limit-fill--warn', 'limit-fill--crit', 'limit-fill--off',
  'skel',                                                        // Skeleton
  'sheet-panel', 'sheet-panel--full', 'sheet-scrim', 'sheet-grabber', // Sheet
  'toast', 'toast--error', 'toast-action',                       // ToastHost / toast()
  'opt', 'opt--selected', 'opt-glyph', 'opt-idx',                // OptionRow
  'opt-body', 'opt-label', 'opt-desc', 'opt-enter',
  'banner', 'banner-msg',                                        // Banner / bannerVariants
  'well',                                                        // Well / WELL
  'chip',                                                        // Chip / CHIP (the dot is an <i>, not a class)
  'keycap',                                                      // Keycap / KEYCAP
  // THE ELEVEN THE LIST HAD MISSED, found by the derivation below rather than
  // by a reader. Every one is emitted by the composite named beside it and
  // selected by that composite's own stylesheet, which is the definition of a
  // hook class — they were simply never typed here, and so neither guard
  // could see an app sheet or an app component reaching for one.
  'ask-live', 'ask-unanswered',                                  // ToolCard
  'tool-dot--run', 'tool-dot--ok', 'tool-dot--err',              // ToolCard
  'attach-btn',                                                  // AttachButton
  'build-line-side--warn',                                       // BuildLine
  'task-card-status--ok', 'task-card-status--bad',               // TaskCard
  'task-mark--running',                                          // TaskStrip
];

/** Tokens the derivation finds that are NOT vocabulary, each with the reason.
 *  Registered rather than filtered by a cleverer pattern: the pattern is a
 *  heuristic over string literals, so what it cannot tell apart has to be
 *  said out loud. */
export const NOT_VOCABULARY: Record<string, string> = {
  class: 'the English word, in a sentence inside a comment or an aria string',
  fleet: 'the English word — BuildLine labels a box "fleet"; the app also has a `.fleet` screen class, which is how it reaches the intersection',
  'sr-only': "Tailwind's own utility, which a stylesheet in this tree also defines; emitted by Sheet and owned by the framework",
};

/** Every `className="..."` / `className={'...'}` string literal in a file. */
export function ownedClassLiterals(source: string): string[] {
  const hits: string[] = [];
  for (const m of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const value = m[1] ?? m[2] ?? m[3] ?? '';
    for (const owned of OWNED) {
      if (new RegExp(`(^|\\s)${owned}(\\s|$)`).test(value)) hits.push(owned);
    }
  }
  return hits;
}

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('the design-system boundary', () => {
  it('no component hand-writes a class the Button primitive owns', () => {
    const offenders: string[] = [];
    for (const f of tsxFiles(SRC)) {
      const hits = ownedClassLiterals(readFileSync(f, 'utf8'));
      if (hits.length > 0) {
        offenders.push(`${path.relative(SRC, f)}: ${[...new Set(hits)].join(', ')}`);
      }
    }
    expect(
      offenders,
      'import Button (or buttonVariants for a link) from @ccrc/ui instead of writing its classes',
    ).toEqual([]);
  });

  // Guards the guard: the scan above passes vacuously the moment its matcher
  // stops matching, and a matcher that silently matches nothing is exactly how
  // the original drift survived.
  it('reds on a raw button wearing the primitive vocabulary', () => {
    expect(ownedClassLiterals('<button className="btn-primary" />')).toEqual(['btn-primary']);
    expect(ownedClassLiterals('<a className="btn-ghost x" />')).toEqual(['btn-ghost']);
    expect(ownedClassLiterals('<div className={`btn-primary ${x}`} />')).toEqual(['btn-primary']);
  });

  it('does not fire on a substring or an unrelated class', () => {
    expect(ownedClassLiterals('<div className="btn-primary-ish" />')).toEqual([]);
    expect(ownedClassLiterals('<div className="settings-move" />')).toEqual([]);
  });

  it('fires on every owned vocabulary, not just the button that drifted', () => {
    expect(ownedClassLiterals('<span className="dot dot--busy" />'))
      .toEqual(['dot', 'dot--busy']);
    expect(ownedClassLiterals('<span className="limit-fill limit-fill--crit" />'))
      .toEqual(['limit-fill', 'limit-fill--crit']);
    expect(ownedClassLiterals('<div className="sheet-panel" />')).toEqual(['sheet-panel']);
    expect(ownedClassLiterals('<button className="opt opt--selected" />'))
      .toEqual(['opt', 'opt--selected']);
    expect(ownedClassLiterals('<span className="opt-glyph" />')).toEqual(['opt-glyph']);
    expect(ownedClassLiterals('<span className="opt-idx" />')).toEqual(['opt-idx']);
    expect(ownedClassLiterals('<span className="opt-body" />')).toEqual(['opt-body']);
    expect(ownedClassLiterals('<span className="opt-label" />')).toEqual(['opt-label']);
    expect(ownedClassLiterals('<span className="opt-desc" />')).toEqual(['opt-desc']);
    expect(ownedClassLiterals('<span className="opt-enter" />')).toEqual(['opt-enter']);
  });

  it('leaves the sanctioned shapes alone', () => {
    // a modifier passed to the primitive, the sheets' own hook classes, and
    // chat.css's look-alike vocabulary
    expect(ownedClassLiterals('<Skeleton className="proj-skel" />')).toEqual([]);
    expect(ownedClassLiterals('<Skeleton lines={1} className="skel--user" />')).toEqual([]);
    expect(ownedClassLiterals('<div className="qc-actions grid gap-2" />')).toEqual([]);
    expect(ownedClassLiterals('<span className="pr-dot" />')).toEqual([]);
    expect(ownedClassLiterals('<div className="chat-skel" />')).toEqual([]);
    // the option row's container and the three ccrc markers it carries
    expect(ownedClassLiterals('<div className="opts" />')).toEqual([]);
    expect(ownedClassLiterals('<span className="opt-wait">answering</span>')).toEqual([]);
    expect(ownedClassLiterals('<span className="opt-inert" />')).toEqual([]);
    expect(ownedClassLiterals('<span className="opt-degraded" />')).toEqual([]);
    // `opt-preview` alone. This example used to read `"well opt-preview"` and
    // was correct until `well` became owned — the app writes `<Well
    // className="opt-preview">` now, so the owned half arrives through the
    // component and only the marker is a literal. Kept as a POSITIVE case
    // below, because the pair is exactly what the guard must still refuse.
    expect(ownedClassLiterals('<pre className="opt-preview" />')).toEqual([]);
    // `tool-dot--run` USED TO BE on this list, as "chat.css's look-alike
    // vocabulary". It is not a look-alike: `tool-card.tsx` emits it and
    // `tool-card.css` styles it, and chat.css's own comment says so —
    // "The dot itself is @ccrc/ui's `.tool-dot--run` now". The prose outlived
    // the migration by a wave; the completeness check below is what found it.
    expect(ownedClassLiterals('<span className="tool-dot--run" />')).toEqual(['tool-dot--run']);
  });

  it('fires on the shape that the Well migration retired', () => {
    // `well` is owned as of the Well primitive. The old spelling must now be
    // refused, or the guard would let the app re-hand-write the surface the
    // component exists to own — which is the drift it was built for.
    expect(ownedClassLiterals('<pre className="well opt-preview" />')).toEqual(['well']);
    expect(ownedClassLiterals('<pre className="well" />')).toEqual(['well']);
    // and a look-alike is still not the class
    expect(ownedClassLiterals('<div className="draft-well" />')).toEqual([]);
    expect(ownedClassLiterals('<div className="well-bar" />')).toEqual([]);
  });

  it('does not fire on the variant call, which is the sanctioned route', () => {
    expect(ownedClassLiterals("<a className={buttonVariants({ variant: 'ghost' })} />")).toEqual([]);
  });
});

// ── THE LIST CANNOT FALL BEHIND THE PACKAGE ──────────────────────────────
//
// `OWNED` is read by two guards: this file's (no app component hand-writes an
// owned class) and `ui-package-boundary.test.ts`'s (no app sheet redresses
// one). Both are only as complete as the list, and the list is typed by hand.
//
// Measured: `Keycap` shipped emitting `.keycap`; `.chat-head .keycap` and
// `.term-keys .keycap` set `color`, `background` and `border-color` on it; and
// the appearance census stayed empty, because `keycap` was not in the list and
// so neither rule counted as a reach-in. Nothing in the tree could have said
// so.
//
// THE DERIVABLE HALF. A token this package EMITS in a class string and that
// some stylesheet SELECTS is a hook class by definition — that is the exact
// wording the primitives' own headers use ("stable selectors other stylesheets
// and the test suite key on"). A Tailwind utility is emitted and never
// selected; an app class is selected and never emitted. The intersection is
// the half that can be computed, and it reds until the list has it.
describe('the owned vocabulary keeps up with the package', () => {
  const walk = (dir: string, ext: RegExp): string[] => {
    const acc: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) acc.push(...walk(full, ext));
      else if (ext.test(e.name) && !e.name.endsWith('.stories.tsx')) acc.push(full);
    }
    return acc;
  };

  /** Bare lowercase tokens in every class-string literal @ccrc/ui ships.
   *  Template holes (`${part}-head`) are skipped by construction: what they
   *  emit is the consumer's word, not this package's. */
  function uiEmits(): Set<string> {
    const out = new Set<string>();
    for (const file of walk(UI_SRC, /\.tsx?$/)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/'([^'\n]*)'/g)) {
        const value = m[1] ?? '';
        for (const token of value.split(/\s+/)) {
          if (/^[a-z][a-z0-9-]*$/.test(token)) out.add(token);
        }
      }
    }
    return out;
  }

  /** Every class any stylesheet in either package selects, as a SUBJECT or an
   *  ancestor — the distinction does not matter here, only that a rule names
   *  it at all. */
  function selectedAnywhere(): Set<string> {
    const out = new Set<string>();
    for (const file of [...walk(UI_SRC, /\.css$/), ...walk(SRC, /\.css$/)]) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/\.([a-z][a-z0-9-]*)/g)) out.add(m[1] ?? '');
    }
    return out;
  }

  it('completes every hook class @ccrc/ui emits', () => {
    const emits = uiEmits();
    const selected = selectedAnywhere();
    const hooks = [...emits].filter((c) => selected.has(c)).sort();
    const missing = hooks.filter((c) => !OWNED.includes(c) && NOT_VOCABULARY[c] === undefined);
    expect(missing, 'a class @ccrc/ui emits and a stylesheet selects is a hook class — add it to OWNED')
      .toEqual([]);
  });

  it('registers no exception that the derivation no longer finds', () => {
    const emits = uiEmits();
    const selected = selectedAnywhere();
    const hooks = new Set([...emits].filter((c) => selected.has(c)));
    expect(Object.keys(NOT_VOCABULARY).filter((c) => !hooks.has(c))).toEqual([]);
  });

  it('found hooks to compare — the derivation is not vacuously empty', () => {
    const emits = uiEmits();
    const selected = selectedAnywhere();
    const hooks = [...emits].filter((c) => selected.has(c));
    expect(hooks.length).toBeGreaterThanOrEqual(10);
    // The two halves really are halves: this package emits far more than it
    // owns, and the stylesheets select far more than it emits.
    expect(emits.size).toBeGreaterThan(hooks.length);
    expect(selected.size).toBeGreaterThan(hooks.length);
  });
});
