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
                        '.sess-acct', '.sess-acct-away']) {
      expect(group).toContain(`.sess-line--active ${cell}`);
    }
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
});

// Task 13, spec §4.4: the run board's own door onto a new program, and the
// start-a-program sheet — same discipline "runs are not living panes" and the
// coord banner/abandon sheet blocks above already hold.
describe('the program-start door and sheet are not living panes, and every real target clears the tap floor', () => {
  it('no .program-start-* rule glows, breathes or animates', () => {
    for (const sel of [
      '.program-start-door', '.program-start-sheet', '.program-start-go',
      '.program-start-sheet .program-start-existing', '.program-start-sheet .program-start-refuse',
      '.program-start-sheet .program-start-warn', '.program-start-sheet .program-start-timeout',
      '.program-start-sheet .program-start-error',
    ]) {
      const rule = norm(stripComments(ruleIn(css, sel)));
      expect(rule, sel).not.toContain('--glow');
      expect(rule, sel).not.toContain('animation');
      expect(rule, sel).not.toContain('box-shadow');
    }
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
