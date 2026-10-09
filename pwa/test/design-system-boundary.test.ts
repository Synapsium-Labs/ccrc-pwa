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
 *    - `pr-dot`, `tool-dot--run`, `chat-skel`: chat.css's own vocabulary, which
 *      only looks like the primitive's. Word-bounded matching keeps them out.
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
];

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
    expect(ownedClassLiterals('<span className="tool-dot--run" />')).toEqual([]);
    expect(ownedClassLiterals('<div className="chat-skel" />')).toEqual([]);
    // the option row's container and the three ccrc markers it carries
    expect(ownedClassLiterals('<div className="opts" />')).toEqual([]);
    expect(ownedClassLiterals('<span className="opt-wait">answering</span>')).toEqual([]);
    expect(ownedClassLiterals('<span className="opt-inert" />')).toEqual([]);
    expect(ownedClassLiterals('<span className="opt-degraded" />')).toEqual([]);
    expect(ownedClassLiterals('<pre className="well opt-preview" />')).toEqual([]);
  });

  it('does not fire on the variant call, which is the sanctioned route', () => {
    expect(ownedClassLiterals("<a className={buttonVariants({ variant: 'ghost' })} />")).toEqual([]);
  });
});
