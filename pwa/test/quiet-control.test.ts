// The quiet control's census.
//
// WHY THIS FILE EXISTS. Four rules in fleet.css declared the same eleven
// declarations — `.coord-toggle`, `.child-reclaim-toggle` and `.caps-save`
// byte-identical, `.program-start-door` differing only in font size — and the
// stylesheet said so itself, twice, in comments pointing at the other copies:
// "Same self-grounded pair as `.coord-toggle`/`.sess-actions` — not
// reinvented". A comment is a request; this is the mechanism.
//
// Folding four rules into one variant is only safe while two things hold, and
// NEITHER is visible to any other guard in this repo:
//
//   1. THE CHROME IS INTACT. vitest runs with `css: false`, so nothing here
//      computes a style — if `bg-raised` fell out of the variant, every quiet
//      control would render transparent and the whole suite would stay green.
//      The contrast gate cannot see it either: it scrapes STYLESHEETS, and
//      this chrome is utilities on an element now.
//   2. THE PRESS DID NOT MOVE. Three of the four rules pressed to 0.96 and
//      `.caps-save` to 0.97. The variant carries the majority figure and
//      `.caps-save` passes its own at the call site. Nothing else in the tree
//      would notice if either number drifted to the base's 0.97.
//
// And `flex: none` is the third: four call sites, three of which sit in flex
// rows and need it, one of which (the run board's door, in a grid) must not
// have it — review M6 took it out of that rule by hand, and the variant
// deliberately does not carry it, so the distinction now lives entirely in
// four `className` strings with nothing watching them.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buttonVariants } from '@ccrc/ui';

const src = (...seg: string[]): string =>
  readFileSync(path.join(import.meta.dirname, '..', 'src', ...seg), 'utf8');

const QUIET = buttonVariants({ variant: 'quiet', size: 'fit' });

/** The call sites, by file and by the hook class each one kept. The hook
 *  classes are the half that proves the variant reaches real markup, and they
 *  are selected on by `coord-banner.test.tsx`, `child-reclaim-banner.test.tsx`
 *  and `runs-screen.test.tsx` — so a rename here is already a red suite
 *  elsewhere. `flex` records which parent each sits in. */
const SITES = [
  { file: ['fleet', 'CoordBanner.tsx'], hook: 'coord-toggle', flex: true },
  { file: ['fleet', 'ChildReclaimBanner.tsx'], hook: 'child-reclaim-toggle', flex: true },
  { file: ['fleet', 'CapsControl.tsx'], hook: 'caps-save', flex: true },
  { file: ['screens', 'RunsScreen.tsx'], hook: 'program-start-door', flex: false },
  // The fifth, found BY this file on the day the other four were folded —
  // `.program-start-go` carried the same eleven declarations in the same
  // stylesheet and nobody had noticed. Three uses in one sheet component, all
  // through one shared `GO` string, so the count below is 3 rather than 1.
  { file: ['fleet', 'StartProgramSheet.tsx'], hook: 'program-start-go', flex: false, uses: 3 },
] as const;

/** Rules that legitimately carry the same four tokens and are NOT this
 *  control. Registered rather than excluded by a cleverer pattern, because
 *  the pattern is the point: a rule that looks like a quiet button has to be
 *  named here, with the reason it is not one. */
const NOT_A_BUTTON: Record<string, string> = {
  '.offline-banner':
    'a sticky status strip, not a control — no cursor, no press, --sp-8 tall rather than the tap floor',
  '.settings-badge':
    'a pill READOUT — r-full rather than r-md, 1.4 leading, no cursor and no press',
};

describe('the quiet control — one variant where four rules were', () => {
  it('carries the chrome those eleven declarations spelled out', () => {
    // Token for token, as every one of the four rules declared it. `font:` is
    // a SHORTHAND and resets `font-style` and `font-variant-numeric`; separate
    // utilities do not, which is why the two resets are named explicitly.
    for (const utility of [
      'bg-raised',           // background: var(--bg-raised)
      'border-edge-subtle',  // border: 1px solid var(--edge-subtle)
      'rounded-md',          // border-radius: var(--r-md)   — from the base
      'text-ink-secondary',  // color: var(--ink-secondary)
      'font-mono',           // the font shorthand's family
      'text-2xs',            //  … its size
      'font-medium',         //  … its weight
      'leading-none',        //  … its `/ 1`
      'not-italic',          //  … and what the shorthand reset for free
      'normal-nums',
      'min-h-tap',           // min-height: var(--tap-min)   — from the base
      'px-3',                // padding: 0 var(--sp-3)       — from size:fit
      'cursor-pointer',
    ]) {
      expect(QUIET, utility).toContain(utility);
    }
  });

  it('presses to 0.96, which is what three of the four rules said', () => {
    expect(QUIET).toContain('enabled:active:scale-[0.96]');
  });

  it('.caps-save keeps the 0.97 it alone declared', () => {
    // The one measured difference between the four, preserved rather than
    // averaged away. If this ever becomes 0.96 it is a DESIGN decision, and
    // this assertion is where it gets made rather than where it slips.
    // The CLASS STRING, not the file: a `toContain` over the whole source
    // passed while a mutation moved the figure, because the comment beside it
    // spells the same literal. Measured — that false green is why this reads
    // the className.
    const caps = src('fleet', 'CapsControl.tsx');
    const cls = /className="caps-save[^"]*"/.exec(caps);
    expect(cls).not.toBeNull();
    expect(cls?.[0]).toContain('enabled:active:scale-[0.97]');
  });

  it('does not carry flex: none — three call sites pass it, one must not', () => {
    expect(QUIET).not.toContain('flex-none');
  });

  it('is used at exactly the four sites, each with the right flex posture', () => {
    for (const site of SITES) {
      const code = src(...site.file);
      const uses = [...code.matchAll(/variant="quiet"/g)].length;
      expect(uses, site.hook).toBe('uses' in site ? site.uses : 1);
      // The class string, wherever it is spelled: inline on the element, or
      // hoisted to a `const` when one control is rendered from three places.
      const cls = new RegExp(`['"]${site.hook}[^'"]*['"]`).exec(code);
      expect(cls, site.hook).not.toBeNull();
      expect((cls?.[0] ?? '').includes('flex-none'), site.hook).toBe(site.flex);
    }
  });

  it('left no copy of its chrome behind in fleet.css', () => {
    // The point of the fold. A fifth copy appearing in the stylesheet is the
    // drift this replaces, and it looks exactly like the four did.
    const css = src('fleet', 'fleet.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const copies = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => {
      const body = m[2] ?? '';
      return body.includes('background: var(--bg-raised)')
        && body.includes('border: 1px solid var(--edge-subtle)')
        && body.includes('color: var(--ink-secondary)')
        && body.includes('var(--family-mono)');
    }).map((m) => (m[1] ?? '').trim().replace(/\s+/g, ' '));
    expect(copies.filter((sel) => !(sel in NOT_A_BUTTON))).toEqual([]);
    // Not vacuous: the registry's entries are rules that really are there.
    for (const sel of Object.keys(NOT_A_BUTTON)) expect(copies, sel).toContain(sel);
  });
});
