// jsdom applies no stylesheet, so these rules cannot be asserted through a
// render. Each one below fixes a defect MEASURED on the live page; reading the
// stylesheet as text is what stops them regressing silently.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { atBlock, declValue, norm, normSel, ruleIn, selectorsOf, stripComments } from './cssRule';

const css = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
const shellCss = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'styles', 'shell.css'), 'utf8');

// The rule reader is shared (test/cssRule.ts) rather than hand-rolled per
// file: fix round 3, verifier P5. The copy that used to live here demanded
// exactly ONE space before the brace, so re-indenting fleet.css — a file this
// lane does not own — turned an assertion into a thrown "no rule for". The
// shared one tolerates grouping, newlines and comments, and still fails when
// the declaration itself changes.

/** The declarations of the first rule whose selector list starts with `sel`. */
function ruleFor(sel: string): string {
  return ruleIn(css, sel);
}

describe('fleet density and alignment', () => {
  it('stacks the two lines and centres them vertically in the 44px box', () => {
    // The original defect (a single line wobbling 10.8px above .sess-line's
    // centre because baseline alignment does not centre inside a min-height
    // box) is now moot: .sess-body holds two full lines, stacked, so it is a
    // COLUMN flex — justify-content, not align-items, does the vertical
    // centring on that axis. align-items: baseline would only mean anything
    // on a single-line ROW flex, so its presence here would be a regression
    // back to that layout.
    const rule = ruleFor('.sess-body');
    expect(rule).toContain('flex-direction: column');
    expect(rule).toContain('justify-content: center');
    expect(rule).not.toContain('align-items: baseline');
  });

  it('keeps the 44px thumb target on the row and on the block that is tapped', () => {
    // The fix is centring, NOT shrinking: these are tap surfaces. The floor
    // lives on .sess-body, the block the row's click forwarder is on — NOT on
    // .sess-open, which is only the label line inside it now that the
    // subagent toggle had to become a real, un-nested <button>.
    expect(ruleFor('.sess-line')).toContain('min-height: 44px');
    expect(ruleFor('.sess-body')).toContain('min-height: 44px');
  });

  // Task 7 fix round 2. The row's controls must all be siblings, never
  // ancestor/descendant: `button` is children-presentational, so a control
  // nested in .sess-open is one AT-invisible element on iOS. The stylesheet's
  // half of that contract is that the tap floor and the column centring live
  // on the plain block, not on a button — .sess-open regaining either would
  // mean it had gone back to wrapping the row's content.
  it('leaves the label button as a label line, not the block it used to wrap', () => {
    const rule = ruleFor('.sess-open');
    expect(rule).not.toContain('min-height');
    expect(rule).not.toContain('flex-direction: column');
    expect(rule).not.toContain('grid-column');
  });

  it('gives the row three tracks — lamp, a two-line label block, actions', () => {
    // state/tally/warn/account moved inside .sess-body's second line
    // (.sess-meta, a flex row) so they no longer need a grid track each.
    const cols = /grid-template-columns:([^;]+);/.exec(ruleFor('.sess-line'))?.[1] ?? '';
    expect(cols.trim().split(/\s+(?![^(]*\))/)).toHaveLength(3);
  });

  it('reserves room under the list for the fixed 56px FAB', () => {
    expect(ruleFor('.fleet-list')).toContain('padding-bottom');
    expect(ruleFor('.fleet-list')).toContain('56px');
  });

  it('lets the card shrink below its content — the cause of the h-scroll', () => {
    // .fleet-list is display:grid, and a grid item's default min-width is auto
    // (= min-content), so .proj-card refused to go below 393px in a 312px
    // column: measured 65px of horizontal overflow on .shell-nav at 1440px.
    expect(ruleFor('.proj-card')).toContain('min-width: 0');
  });

  it('pins every .sess-line child to an explicit grid-column', () => {
    // .sess-line now has only THREE grid children (lamp, .sess-body, actions)
    // — state/tally/warn/account moved into .sess-meta, a flex row inside
    // that block, so they can never be grid-compacted by a hidden sibling. The three that remain are still pinned explicitly, on
    // the same reasoning as before: a test that only checked a selector's
    // presence somewhere would pass against a wrong-order regression too, so
    // this checks each child's own column number.
    const order = ['.sess-lamp', '.sess-body', '.sess-actions'];
    order.forEach((sel, i) => {
      expect(ruleFor(sel)).toContain(`grid-column: ${i + 1}`);
    });
  });

  it('has no @container query left — .sess-acct can no longer be hidden or squeezed', () => {
    // The query this repeatedly guarded (first hiding .sess-acct, then
    // hiding .sess-state, then discovered to compact .sess-acct into a
    // neighbour's track) is gone along with the one-line layout it existed
    // to rescue. .fleet-list's own container-type/-name went with it —
    // nothing else in this file uses them.
    expect(css).not.toContain('@container');
    expect(css).not.toContain('container-type');
    expect(css).not.toContain('container-name');
  });

  it('tightens the card padding and closes the header/body gap', () => {
    const rule = ruleFor('.proj-card');
    expect(rule).toContain('padding: var(--sp-2)');
    expect(rule).toContain('gap: 0');
  });

  it("aligns the lamp to the label's own line, not the two-line block's centre", () => {
    // .sess-line centres everything on the full two-line ~52px box, but the
    // label is only the TOP line — measured 8.5-9.25px apart live (the
    // user's sharpest complaint). align-self: start + a box the height of
    // the label's own line (--text-base at --leading-tight) still lands
    // 4.125px high, because .sess-open centres its whole two-line content
    // block inside the tap target — margin-top makes up exactly that
    // slack, derived from the same tokens .sess-open's stack uses (CDP-
    // measured 0px gap after this fix, at both 1440 and 390).
    const rule = ruleFor('.sess-lamp');
    expect(rule).toContain('align-self: start');
    expect(rule).toContain('height: calc(var(--text-base) * var(--leading-tight))');
    expect(rule).toContain('display: grid');
    expect(rule).toContain('place-items: center');
    expect(rule).toContain('margin-top: calc(');
    expect(rule).toContain('var(--tap-min)');
    expect(rule).toContain('var(--text-xs)');
  });

  it('compensates the lamp for EVERY line that can push the stack past the floor', () => {
    // The MEASUREMENT cannot be tested (jsdom lays nothing out — fleet.css
    // says so in the rule's own comment). The SELECTOR GROUP can, and it is
    // what shipped wrong in Task 7 round 1: .sess-ask was compensated and
    // .sess-subagent-list — an equally line-adding sibling in the same flex
    // column, one row of which already exceeds the 44px floor on its own —
    // was not, so opening the disclosure on a row with no ask summary put the
    // status dot ~4px below the workspace name again, the exact defect the
    // preceding fix round removed.
    const group = selectorsOf(css, '.sess-line:has(.sess-ask) .sess-lamp');
    for (const line of ['.sess-ask', '.sess-subagent-list']) {
      // `normSel` on both sides: `selectorsOf` returns the group already
      // normalised, and that normalisation eats the descendant space after a
      // `)`, so a raw literal never matches one of these.
      expect(group).toContain(normSel(`.sess-line:has(${line}) .sess-lamp`));
    }
    // And it is the CLAMPED three-line variant they share, not the base
    // formula: max(0px, …) is what makes one rule correct for a list of N
    // rows and for a row carrying both extra lines.
    const rule = ruleFor('.sess-line:has(.sess-subagent-list) .sess-lamp');
    expect(rule).toContain('max(0px');
    expect(rule).toContain('var(--text-2xs)');
  });

  it('gives .proj-card-add and .sess-actions the same real-button treatment', () => {
    // The two read as a matched pair stacked down the card's right edge:
    // identical 32×32 (--sp-8) box, bg-raised fill, edge-subtle hairline,
    // r-md corner — not a bare glyph either.
    for (const sel of ['.proj-card-add', '.sess-actions']) {
      const rule = ruleFor(sel);
      expect(rule).toContain('width: var(--sp-8)');
      expect(rule).toContain('height: var(--sp-8)');
      expect(rule).toContain('background: var(--bg-raised)');
      expect(rule).toContain('border: 1px solid var(--edge-subtle)');
      expect(rule).toContain('border-radius: var(--r-md)');
      expect(rule).toContain('position: relative');
      // The hit area grows via an overlay, never by growing the visible box.
      expect(rule).not.toContain('min-width: 44px');
      expect(rule).not.toContain('min-height: 44px');
    }
  });

  it('extends each button to --tap-min with an invisible ::before overlay', () => {
    for (const sel of ['.proj-card-add::before', '.sess-actions::before']) {
      const rule = ruleFor(sel);
      expect(rule).toContain('position: absolute');
      expect(rule).toContain('var(--tap-min)');
      expect(rule).toContain('var(--sp-8)');
    }
  });

  // Whole-branch review, finding 7. The subagent disclosure — the branch's
  // headline new interaction — shipped as a ~22×15px box with `padding: 0`,
  // the first row-level button in this file to skip the --tap-min pattern
  // entirely, inside a 44px surface whose click forwarder NAVIGATES. A thumb
  // landing a few px low did not miss quietly; it opened the session.
  describe('the subagent disclosure is a real target', () => {
    it('grows its hit area with an overlay instead of its visible box', () => {
      // The visible box must not grow: .sess-meta is a flex row, so padding
      // there raises the whole line and throws .sess-lamp's centring formula
      // out on every row in the fleet.
      const rule = ruleFor('.sess-subagents');
      expect(rule).toContain('position: relative');
      expect(rule).toContain('padding: 0');

      const overlay = ruleFor('.sess-subagents::before');
      expect(overlay).toContain('position: absolute');
      // --tap-min WIDE — the axis with room. Vertically --sp-6 (WCAG 2.2 SC
      // 2.5.8's 24px floor): a 44px-tall overlay would reach 14.5px up over
      // .sess-open's whole line box, so taps on the workspace name would
      // toggle the disclosure — a WRONG control, worse than the near-miss.
      expect(overlay).toContain('var(--tap-min)');
      expect(overlay).toContain('var(--sp-6)');
      expect(norm(stripComments(overlay))).not.toContain('44px');
    });

    it('lets the label win the strip they overlap', () => {
      // Both are positioned, and the overlay comes later in tree order, so
      // `position: relative` alone would still lose. The explicit z-index is
      // what keeps a tap on the name opening the session.
      const rule = ruleFor('.sess-open');
      expect(rule).toContain('position: relative');
      expect(declValue(rule, 'z-index')).toBe('1');
    });

    it('stops .sess-meta clipping the overlay and the focus ring away', () => {
      // `overflow: hidden` clips POINTER EVENTS as well as paint, so the
      // overlay would have been clipped back to the 15px line and bought
      // nothing — and base.css's :focus-visible, drawn 2px wide at 2px
      // offset, lost its top and bottom edges on this same rule.
      const rule = ruleFor('.sess-meta');
      expect(rule).toContain('overflow: clip');
      expect(rule).not.toContain('overflow: hidden');
      expect(declValue(rule, 'overflow-clip-margin')).toBe('12px');
    });
  });

  // The ack control's own floor. `padding: var(--sp-1) 0` around an 11px line
  // measured ~19px — under WCAG 2.2's 24px — on a control whose action cannot
  // be undone.
  it('gives "Mark all seen" a real 24px box rather than an overhanging overlay', () => {
    const rule = ruleFor('.bucket-head .bucket-head-seen');
    expect(declValue(rule, 'min-height')).toBe('var(--sp-6)');
    // Deliberately NOT the ::before overlay pattern: every neighbour in the
    // chip is inert, so an overhang would turn a near-miss that does nothing
    // into an irreversible ack.
    expect(() => ruleFor('.bucket-head-seen::before')).toThrow();
  });

  it('right-aligns .sess-actions in its column so it shares an edge with .proj-card-add', () => {
    // .sess-line's own right padding sits INSIDE .proj-card's padding, so
    // the header needs the same padding-right to keep the + and ··· on one
    // vertical line (CDP-measured rightEdgeDelta 0 at 1440 and 390).
    expect(ruleFor('.sess-actions')).toContain('justify-self: end');
    expect(ruleFor('.proj-card-head')).toContain('padding-right: var(--sp-2)');
  });

  it('tops-aligns .sess-actions with the row, like the lamp, instead of floating centred', () => {
    expect(ruleFor('.sess-actions')).toContain('align-self: start');
  });
});

describe('selection is polarity, status is hue', () => {
  // The law: selection is achromatic polarity (fill + ink flip), status keeps
  // hue. Selection never owns a perimeter; status owns one only for attention.
  // Forced, not chosen: --accent and --status-busy are the same hex (#45D67E)
  // and the four account hues own the cool half of the wheel, so on THIS
  // screen any coloured selection is a status or identity collision.

  it('inverts the selected row instead of tinting it', () => {
    // The old signal was --bg-raised on --bg-surface: 1.10:1 dark / 1.17:1
    // light — less than the hairline that separates one card from the next.
    const rule = ruleFor('.sess-line--active');
    expect(rule).toContain('background: var(--ink-primary)');
    expect(rule).toContain('color: var(--bg-page)');
  });

  it('leaves no busy perimeter, and keeps the amber one byte for byte', () => {
    // Assert the RULE is gone, not the string: the deletion note names the
    // class, so a text search would find it in the comment and pass.
    expect(() => ruleFor('.proj-card--busy')).toThrow();
    // Attention is the only status that asks the reader to act and the one a
    // fold must never hide — it keeps the perimeter, now monosemous.
    // Fix round 4, controller item 1: this was a whitespace-exact literal of
    // the WHOLE rule, so reformatting the one-liner onto three lines failed it
    // for nothing. The declaration is what "byte for byte" was ever about.
    expect(declValue(ruleFor('.proj-card--attention'), 'border-color'))
      .toBe('var(--status-attention-text)');
  });

  it('strips every status and account hue from the slab', () => {
    // Every coloured cell on the row must be neutralised by the SAME rule —
    // this is what catches a STRANDED cell when someone adds a new coloured
    // element to .sess-meta and forgets it here.
    //
    // Fix round 4, controller item 1: the membership check used to slice the
    // file between the previous `}` and a literal `${last} {`, so it demanded
    // exactly one space before the brace — the very copy the shared reader
    // replaced elsewhere in this file, left standing inside one test.
    // `selectorsOf` returns the rule's own normalised list, so re-indenting or
    // re-ordering the group is free and dropping a member is not.
    const last = '.sess-line--active .sess-meta > *:not(:first-child)::before';
    expect(declValue(ruleFor(last), 'color')).toBe('var(--edge-strong)');
    const group = selectorsOf(css, last);
    for (const cell of ['.sess-meta', '.sess-state', '.sess-tally', '.sess-warn',
                        '.sess-acct', '.sess-acct-away',
                        // Final review, Minor 3. These four take their OWN
                        // `color: var(--ink-tertiary)` (one shared rule for
                        // the first three, its own for .sess-unmeasured), and
                        // a child's own colour beats the colour it would
                        // inherit from .sess-meta — so being absent from this
                        // group left them painting ink-tertiary on the
                        // --ink-primary slab: 2.72:1 dark / 2.91:1 light,
                        // against this repo's 4.5:1 body floor. Measured with
                        // design/audit.mjs's own resolver, the same engine
                        // the gate uses; --edge-strong gives 9.27 / 9.91.
                        //
                        // .sess-held was the original omission and shipped on
                        // main; .sess-lifecycle and .sess-swapblocked joined
                        // its rule on this branch and inherited the bug,
                        // which widened it — .sess-lifecycle renders on every
                        // non-running row, and the operator this branch
                        // serves selects the dead row precisely to read
                        // "stopped by agent, 2d ago".
                        '.sess-held', '.sess-lifecycle', '.sess-swapblocked',
                        '.sess-unmeasured',
                        // The substrate chip (spec §4) joined the same way:
                        // its own `color: var(--ink-tertiary)` beats the
                        // slab's inherited ink exactly like .sess-unmeasured
                        // next to it, so absence here is the same stranding.
                        '.sess-substrate',
                        // §1.6b's chip: it sets its own `--status-dead-text`
                        // (and `--ink-tertiary` on two variants), so it is a
                        // coloured cell exactly like `.sess-warn` above and
                        // strands the same way if it is left out of here.
                        '.sess-spawn']) {
      expect(group).toContain(`.sess-line--active ${cell}`);
    }
  });

  it('beats the spawn chip\'s own [data-spawn] variants by SPECIFICITY, not by source order', () => {
    // Membership in the achromatic group (asserted just above) is necessary and
    // NOT sufficient for this one cell. `.sess-line--active .sess-spawn` is
    // (0,2,0) — and so is `.sess-spawn[data-spawn='expired']`, which is declared
    // LATER in this file. On a selected row carrying one of those variants the
    // tie therefore goes to source order, the variant wins, and the chip paints
    // --ink-tertiary on the --ink-primary slab: 2.72:1 dark / 2.91:1 light,
    // against this file's 4.5:1 body floor. The group's
    // `.sess-line--active .sess-spawn[data-spawn]` member (0,3,0) is what
    // settles it by specificity instead — which is also what makes moving
    // either rule free. Nothing tested that member: deleting it left the whole
    // pwa suite green (measured 2026-08-17), so the one line standing between
    // the selected row and a sub-floor contrast was a comment, not a mechanism.
    //
    // Counting classes + attributes + pseudo-classes is enough for a (0,x,0)
    // comparison: there is no id and no element name anywhere near .sess-spawn,
    // and both sides of this tie are pure class/attribute selectors.
    const spec = (sel: string): number =>
      (sel.match(/\.[A-Za-z0-9_-]+|\[[^\]]*\]|:[a-z-]+/g) ?? []).length;
    const group = selectorsOf(css, '.sess-line--active .sess-meta > *:not(:first-child)::before')
      .filter((s) => s.startsWith('.sess-line--active .sess-spawn'));
    expect(group, 'the spawn chip left the achromatic group entirely').not.toEqual([]);
    const scrubbed = stripComments(css);
    const groupAt = scrubbed.indexOf('.sess-line--active .sess-spawn');
    for (const variant of ['expired', 'unrecognised']) {
      const sel = `.sess-spawn[data-spawn=${variant}]`;
      // The variant really does paint a colour of its own — without that there
      // is nothing to beat and everything below would be vacuous.
      expect(declValue(ruleFor(sel), 'color'), `${sel} no longer sets its own colour`)
        .toBe('var(--ink-tertiary)');
      // …and it is declared AFTER the achromatic rule, which is precisely why
      // an equal-specificity member cannot settle this.
      const variantAt = scrubbed.search(new RegExp(`\\.sess-spawn\\[data-spawn=['"]?${variant}['"]?\\]`));
      expect(variantAt, `${sel} is not in the stylesheet any more`).toBeGreaterThan(-1);
      expect(variantAt, `${sel} now precedes the achromatic rule — this test no longer proves anything`)
        .toBeGreaterThan(groupAt);
      expect(Math.max(...group.map(spec)),
        `no member of the achromatic group out-specifies ${sel}, so the selected row loses the tie to it`)
        .toBeGreaterThan(spec(sel));
    }
  });

  it('gives the spawn chip a flex: none cell so it cannot steal the hold reason\'s room', () => {
    // `.sess-held` is the ONE shrinkable cell in `.sess-meta` (overflow:hidden +
    // text-overflow:ellipsis, no `flex: none`), and §2.4 lengthens what it holds
    // in the same build. A chip without `flex: none` truncates it first.
    expect(ruleFor('.sess-spawn')).toContain('flex: none');
  });

  // The list above names cells; this names the RULE that keeps producing them.
  // Three separate cells have now been stranded on the selected slab by the
  // same move — add a meta cell, give it a colour, forget the achromatic
  // group — and a hand-written membership list only ever catches the ones
  // somebody remembered to type into it. contrast-check.mjs does not catch it
  // either: it prices the group's own pair (--edge-strong on --ink-primary)
  // and has no way to know a cell is missing FROM the group.
  //
  // So the census reads the row's own source. Every `sess-…` class
  // SessionLine.tsx actually renders, that fleet.css gives a colour of its
  // own, must be answered by a `.sess-line--active` rule that sets a colour —
  // the achromatic group for most of them, .sess-actions' own dedicated rule
  // for the ··· button. `color: inherit` is already an answer (the flip is
  // what it inherits). A modifier is covered by its base class, and that is
  // specificity, not hand-waving: `.sess-line--active .sess-state` is (0,2,0)
  // and `.sess-state--waiting` is (0,1,0), so the ancestor-qualified rule wins
  // wherever it sits in the file.
  //
  // What it cannot see is an INLINE style, which beats every selector short of
  // !important — .sess-acct's account hue is dropped in the component for
  // exactly that reason (SessionLine.tsx's `acctStyle`). That one is a TSX
  // decision and stays pinned there.
  it('leaves no coloured cell on the row without an answer on the slab', () => {
    const tsx = readFileSync(
      path.join(import.meta.dirname, '..', 'src', 'fleet', 'SessionLine.tsx'), 'utf8');

    // `className="a b"` and `` className={`a b--${x}`} `` alike; the
    // interpolation is stripped, leaving the `sess-state--` PREFIX, which is
    // expanded below into every modifier the stylesheet declares for it.
    const rendered = new Set<string>();
    for (const m of tsx.matchAll(/className=[{]?[`"']([^`"']*)[`"']/g)) {
      for (const c of (m[1] ?? '').replace(/\$\{[^}]*\}/g, '').split(/\s+/)) {
        if (c.startsWith('sess-')) rendered.add(c);
      }
    }
    // A prefix left by an interpolation stands for every class the stylesheet
    // actually declares under it, so the three .sess-state--* modifiers are
    // censused rather than skipped.
    for (const prefix of [...rendered].filter((c) => c.endsWith('--'))) {
      rendered.delete(prefix);
      for (const m of css.matchAll(new RegExp(`\\.(${prefix}[a-z0-9-]+)`, 'g'))) {
        rendered.add(m[1] ?? '');
      }
    }
    // The row itself is the ground, not a cell on it.
    rendered.delete('sess-line');
    rendered.delete('sess-line--active');
    expect(rendered.size).toBeGreaterThan(15); // the extraction still works

    const colorOf = (sel: string): string | null => {
      try {
        return declValue(ruleIn(css, sel), 'color');
      } catch {
        return null; // no such rule: nothing to strand
      }
    };
    const base = (c: string): string => c.slice(0, c.indexOf('--') + 2 || undefined);

    const stranded = [...rendered].sort().filter((c) => {
      const own = colorOf(`.${c}`);
      if (own === null || own === 'inherit') return false;
      const answered = colorOf(`.sess-line--active .${c}`)
        ?? (c.includes('--') ? colorOf(`.sess-line--active .${base(c).slice(0, -2)}`) : null);
      return answered === null;
    });
    expect(stranded).toEqual([]);
  });

  it('gives the lamp a --bg-well plate so its dot keeps the hue it was gated on', () => {
    // Every dot on this row must sit on --bg-well — the one background
    // design/contrast-check.mjs already verifies all four dots against at 3:1
    // in BOTH themes. Without it the dark dots die on the near-white slab
    // (busy 1.63, attention 1.55). Absolutely positioned so the first grid
    // column does not widen and push this row's label off the shared edge.
    const plate = ruleFor('.sess-line--active .sess-lamp::before');
    expect(plate).toContain('position: absolute');
    expect(plate).toContain('width: var(--lamp-size)');
    expect(plate).toContain('background: var(--bg-well)');
    // The plate is positioned; without this it paints over the dot.
    expect(ruleFor('.sess-line--active .sess-lamp > .dot')).toContain('position: relative');
  });

  it('keeps the focus ring visible on the row most likely to hold focus', () => {
    // base.css draws :focus-visible in --accent, which measures 1.63:1 on the
    // dark slab — an invisible ring exactly where focus lands.
    expect(ruleFor('.sess-line--active :focus-visible')).toContain('outline-color: var(--bg-page)');
  });

  it('flips the ··· with the row without touching its box', () => {
    // Colour only: the 32×32 box, the hairline and the 44px ::before overlay
    // stay on the base rule, so the matched pair with .proj-card-add survives.
    const rule = ruleFor('.sess-line--active .sess-actions');
    expect(rule).toContain('background: var(--bg-page)');
    expect(rule).not.toContain('width');
    expect(rule).not.toContain('height');
  });

  it('survives forced colours, where the polarity channel does not exist', () => {
    // Canvas/CanvasText flatten fill AND ink, leaving font-weight alone. An
    // inset border is the channel that survives.
    // Fix round 4, controller item 1: `css.indexOf('@media (forced-colors:
    // active)')` then a slice to END OF FILE would have accepted a
    // `.sess-line--active` rule that had fallen OUT of the block, and pinned
    // the space after the media feature's colon. `atBlock` returns the block's
    // own body, so both go away at once.
    const forced = atBlock(css, '@media (forced-colors: active)');
    expect(declValue(ruleIn(forced, '.sess-line--active'), 'outline'))
      .toBe('2px solid CanvasText');
  });
});

describe('shell-nav overflow backstop', () => {
  it('clips horizontal overflow on the desktop sidebar as a backstop behind min-width: 0', () => {
    // .proj-card's min-width: 0 (asserted above) is the real fix — this is
    // a belt-and-braces guarantee that the sidebar itself can never scroll
    // sideways even if some future child regresses that fix.
    const rule = ruleIn(shellCss, '.shell-nav');
    expect(rule).toContain('overflow-x: clip');
    expect(rule).toMatch(/backstop/i);
  });
});

describe('archived sub-fold (Task 18)', () => {
  it('keeps the 44px thumb target on the toggle, same as every other tap row', () => {
    expect(ruleFor('.proj-archived-toggle')).toContain('min-height: var(--tap-min)');
  });
});

describe('runs are not living panes', () => {
  it('no run rule glows, breathes or animates', () => {
    // DIRECTION.md's refused list, by name: "glow on non-living things". A run
    // row is a record of a lifecycle position; the pane it names may be alive,
    // and THAT row (the fleet line) is where the lamp belongs.
    for (const sel of ['.run-row', '.run-row .run-glyph', '.run-row .run-state', '.runs-group', '.fleet-runs-row',
      '.run-row .run-abandon']) {
      const rule = norm(stripComments(ruleIn(css, sel)));
      expect(rule, sel).not.toContain('--glow');
      expect(rule, sel).not.toContain('animation');
      expect(rule, sel).not.toContain('box-shadow');
    }
  });
});

// Task 11, spec §4.2: a paused fleet is a STATE, not a living pane — the same
// discipline "runs are not living panes" already holds a few rules up, for
// the same reason.
describe('the coord banner is not a living pane, and its toggle is a real target', () => {
  it('no .coord-* rule glows, breathes or animates', () => {
    for (const sel of ['.coord-banner', '.coord-banner .coord-glyph', '.coord-word', '.coord-toggle', '.coord-banner .coord-error']) {
      const rule = norm(stripComments(ruleIn(css, sel)));
      expect(rule, sel).not.toContain('--glow');
      expect(rule, sel).not.toContain('animation');
      expect(rule, sel).not.toContain('box-shadow');
    }
  });

  it('.coord-toggle is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleFor('.coord-toggle'), 'min-height')).toBe('var(--tap-min)');
  });

  it('.coord-banner itself clears the floor too — it is a status row, not just a label', () => {
    expect(declValue(ruleFor('.coord-banner'), 'min-height')).toBe('var(--tap-min)');
  });

  // Task 14 gate: same self-grounded proof `.abandon-sheet`/`.program-start-
  // sheet` already carry, applied here where the pattern was first used
  // (Task 11) but never itself pinned as a unit test — `.coord-banner
  // .coord-glyph`/`.coord-banner .coord-error` are only real, MEASURED pairs
  // (`design/audit.mjs`'s descendant pass) because `.coord-banner` declares
  // both `color` and `background` itself; losing either would silently drop
  // its descendants back into the `hosts.size === 0` skip and out of the
  // measured set, with `contrast.test.ts` staying green because there is
  // nothing left to fail on.
  it('.coord-banner is self-grounded — it declares its own color AND background', () => {
    const rule = ruleFor('.coord-banner');
    expect(declValue(rule, 'color')).not.toBeNull();
    expect(declValue(rule, 'background')).not.toBeNull();
  });
});

// Task 12, spec §4.3: releasing a wedged run is a decision, not a living
// pane — the same discipline "runs are not living panes" and the coord
// banner's own block above already hold.
describe('the abandon sheet is not a living pane, and its own control is a real target', () => {
  it('no .run-abandon or .abandon-* rule glows, breathes or animates', () => {
    for (const sel of ['.run-row .run-abandon', '.abandon-sheet', '.abandon-sheet .abandon-error']) {
      const rule = norm(stripComments(ruleIn(css, sel)));
      expect(rule, sel).not.toContain('--glow');
      expect(rule, sel).not.toContain('animation');
      expect(rule, sel).not.toContain('box-shadow');
    }
  });

  it('.run-abandon is at least one tap tall AND wide, off the shared token', () => {
    expect(declValue(ruleFor('.run-row .run-abandon'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleFor('.run-row .run-abandon'), 'min-width')).toBe('var(--tap-min)');
  });

  // The named-ancestor descendant pair itself (Task 12 review lesson,
  // applied ahead of time — Task 11's own review Minor 3): `.abandon-sheet`
  // sets BOTH its own `color` and `background`, so it is self-grounded and
  // `.abandon-sheet .abandon-error` is a rule `design/audit.mjs`'s
  // descendant pass can actually recover a ground for, rather than a bare
  // `.abandon-error { color: … }` selector it would file under `uncovered`
  // (`hosts.size === 0` → skipped, never measured).
  // Fix round 1, Minor 3: `.run-open` claiming the row's full width forced
  // its new sibling `.run-abandon` onto its own flex line on EVERY row,
  // roughly doubling every row's height on the primary board. jsdom applies
  // no layout engine, so this is pinned the same way every other rule here
  // is — reading the declaration back as text — rather than a computed-size
  // assertion no test in this suite can make.
  it('.run-open does not claim width: 100% — .run-abandon needs room on the same line', () => {
    expect(declValue(ruleFor('.run-row .run-open'), 'width')).toBeNull();
  });

  it('.abandon-sheet is self-grounded — it declares its own color AND background', () => {
    const rule = ruleFor('.abandon-sheet');
    expect(declValue(rule, 'color')).not.toBeNull();
    expect(declValue(rule, 'background')).not.toBeNull();
  });

  // Build 8 Wave 2, Task 212: the archive-conflict sheet is the same object as
  // the abandon sheet — a refusal the operator reads and answers — and shares
  // its rule by GROUPING rather than by a second copy of six declarations.
  // Pinned here, not assumed: a component shipped with a class no rule names
  // renders unstyled on a phone and green in every test in this suite, and its
  // `.abandon-error` descendant would drop back into `design/audit.mjs`'s
  // `uncovered` bucket the moment the grouping is dropped.
  it('.archive-conflict-sheet is grounded too, and shares the abandon sheet rule', () => {
    const rule = ruleFor('.archive-conflict-sheet');
    expect(declValue(rule, 'color')).not.toBeNull();
    expect(declValue(rule, 'background')).not.toBeNull();
    expect(selectorsOf(css, '.archive-conflict-sheet')).toContain('.abandon-sheet');
    // Its error line is a named-ancestor descendant under BOTH ancestors.
    expect(selectorsOf(css, '.archive-conflict-sheet .abandon-error'))
      .toContain('.abandon-sheet .abandon-error');
    // …and it is not a living pane either.
    for (const sel of ['.archive-conflict-sheet', '.archive-conflict-sheet .abandon-error']) {
      const r = norm(stripComments(ruleIn(css, sel)));
      expect(r, sel).not.toContain('--glow');
      expect(r, sel).not.toContain('animation');
      expect(r, sel).not.toContain('box-shadow');
    }
  });
});

// Task 13, spec §4.4: the run board's own door onto a new program, and the
// start-a-program sheet — same discipline "runs are not living panes" and the
// coord banner/abandon sheet blocks above already hold.
describe('the program-start door and sheet are not living panes, and every real target clears the tap floor', () => {
  // Whole-branch review, M5: this gate was a HAND-ENUMERATED list of eight
  // selectors, and it shipped already missing two of its own siblings —
  // `.program-start-ledger` and `.program-start-note`, which share a rule and
  // were simply never typed out. A glow added there passed the gate. The list
  // is now a SCAN: every rule in the file whose selector mentions
  // `.program-start-` is checked, so a future sibling cannot be missed by
  // forgetting to add it here. The floor assertion is what stops the scan
  // passing vacuously if the block is ever renamed out from under it — a
  // regex that matches nothing satisfies a bare `for` loop perfectly.
  it('no .program-start-* rule glows, breathes or animates', () => {
    const rules = [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => (m[1] ?? '').includes('.program-start-'));
    // Ten today: door, door:active, sheet, ledger+note, timeout, warn,
    // existing+refuse+error, go, go:active, go:disabled.
    expect(rules.length).toBeGreaterThanOrEqual(10);
    for (const m of rules) {
      const sel = norm(m[1] ?? '');
      const rule = norm(m[2] ?? '');
      expect(rule, sel).not.toContain('--glow');
      expect(rule, sel).not.toContain('animation');
      expect(rule, sel).not.toContain('box-shadow');
    }
    // The two the enumerated version missed, named explicitly as well: the
    // scan above is the mechanism, and this is the regression it was written
    // for, so it stays visible rather than living only in a comment.
    for (const sel of ['.program-start-sheet .program-start-ledger',
                       '.program-start-sheet .program-start-note']) {
      const rule = norm(stripComments(ruleIn(css, sel)));
      expect(rule, sel).not.toContain('--glow');
      expect(rule, sel).not.toContain('box-shadow');
    }
  });

  // Whole-branch review, M6: `.program-start-door` was copy-pasted from
  // `.coord-toggle`, which lives in a flex row (`.coord-banner`). The door's
  // own parent is `.runs-screen`, `display: grid` — `flex: none` there is
  // inert, a declaration that reads as load-bearing and does nothing.
  it('.program-start-door declares no flex — its parent .runs-screen is a grid', () => {
    expect(declValue(ruleFor('.runs-screen'), 'display')).toBe('grid');
    expect(declValue(ruleFor('.program-start-door'), 'flex')).toBeNull();
  });

  it('.program-start-door is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleFor('.program-start-door'), 'min-height')).toBe('var(--tap-min)');
  });

  it('.program-start-go is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleFor('.program-start-go'), 'min-height')).toBe('var(--tap-min)');
  });

  // The named-ancestor descendant pair itself (Task 12 review lesson, applied
  // ahead of time — same idiom `.abandon-sheet`'s own comment describes):
  // `.program-start-sheet` sets BOTH its own `color` and `background`, so it
  // is self-grounded and every `.program-start-sheet .program-start-*` rule
  // above is one `design/audit.mjs`'s descendant pass can recover a ground
  // for, rather than a bare `.program-start-error { color: … }` selector it
  // would file under `uncovered` (`hosts.size === 0` → skipped, never
  // measured).
  it('.program-start-sheet is self-grounded — it declares its own color AND background', () => {
    const rule = ruleFor('.program-start-sheet');
    expect(declValue(rule, 'color')).not.toBeNull();
    expect(declValue(rule, 'background')).not.toBeNull();
  });
});

describe('the hold composer', () => {
  it('declares its own placeholder colour — the block comment claims .proj-search verbatim', () => {
    // FIX-WAVE OBSERVATION. The comment above this block says `.sess-hold-input`
    // "copies .proj-search's declarations verbatim … same tokens, no new pair",
    // and it omitted `::placeholder`, which .proj-search does declare. Left
    // undeclared the placeholder falls to the UA default in both colour
    // schemes — and this placeholder is the ONLY place the reason convention
    // (`program:name wave:2/4`) is shown to whoever is typing it.
    expect(declValue(ruleIn(css, '.sess-hold-input::placeholder'), 'color'))
      .toBe(declValue(ruleIn(css, '.proj-search::placeholder'), 'color'));
    expect(declValue(ruleIn(css, '.sess-hold-input::placeholder'), 'color')).toBe('var(--ink-tertiary)');
  });
});
