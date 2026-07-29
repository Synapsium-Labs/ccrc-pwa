// jsdom applies no stylesheet, so these rules cannot be asserted through a
// render. Each one below fixes a defect MEASURED on the live page; reading the
// stylesheet as text is what stops them regressing silently.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
const shellCss = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'styles', 'shell.css'), 'utf8');

/** The declarations of the first rule whose selector list starts with `sel`
 *  in `text`, tolerating leading indentation — fleet.css's rules sit at
 *  column 0, but shell.css nests its desktop rules inside `@media`. */
function ruleIn(text: string, sel: string): string {
  const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\n[ \\t]*${escaped} \\{`);
  const m = re.exec(text);
  if (!m) throw new Error(`no rule for ${sel}`);
  const open = text.indexOf('{', m.index);
  return text.slice(open + 1, text.indexOf('}', open));
}

/** The declarations of the first rule whose selector list starts with `sel`. */
function ruleFor(sel: string): string {
  return ruleIn(css, sel);
}

describe('fleet density and alignment', () => {
  it('stacks the two lines and centres them vertically in the 44px box', () => {
    // The original defect (a single line wobbling 10.8px above .sess-line's
    // centre because baseline alignment does not centre inside a min-height
    // box) is now moot: .sess-open holds two full lines, stacked, so it is a
    // COLUMN flex — justify-content, not align-items, does the vertical
    // centring on that axis. align-items: baseline would only mean anything
    // on a single-line ROW flex, so its presence here would be a regression
    // back to that layout.
    const rule = ruleFor('.sess-open');
    expect(rule).toContain('flex-direction: column');
    expect(rule).toContain('justify-content: center');
    expect(rule).not.toContain('align-items: baseline');
  });

  it('keeps the 44px thumb target on the row and its label button', () => {
    // The fix is centring, NOT shrinking: these are tap surfaces.
    expect(ruleFor('.sess-line')).toContain('min-height: 44px');
    expect(ruleFor('.sess-open')).toContain('min-height: 44px');
  });

  it('gives the row three tracks — lamp, a two-line label block, actions', () => {
    // state/tally/warn/account moved inside .sess-open's second line
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
    // .sess-line now has only THREE grid children (lamp, the label block,
    // actions) — state/tally/warn/account moved into .sess-meta, a flex row
    // inside the label button, so they can never be grid-compacted by a
    // hidden sibling. The three that remain are still pinned explicitly, on
    // the same reasoning as before: a test that only checked a selector's
    // presence somewhere would pass against a wrong-order regression too, so
    // this checks each child's own column number.
    const order = ['.sess-lamp', '.sess-open', '.sess-actions'];
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
    expect(css).toContain('.proj-card--attention { border-color: var(--status-attention-text); }');
  });

  it('strips every status and account hue from the slab', () => {
    // ruleFor anchors on `<sel> {`, so only the LAST selector of a list can
    // fetch the block; the rest are asserted as members of that same list,
    // read back from the block's own brace rather than from the whole file —
    // this is what catches a STRANDED cell when someone adds a new coloured
    // element to .sess-meta and forgets it here.
    const last = '.sess-line--active .sess-meta > *:not(:first-child)::before';
    expect(ruleFor(last)).toContain('color: var(--edge-strong)');
    const open = css.indexOf(`${last} {`);
    const list = css.slice(css.lastIndexOf('}', open) + 1, open);
    for (const cell of ['.sess-meta', '.sess-state', '.sess-tally', '.sess-warn',
                        '.sess-acct', '.sess-acct-away']) {
      expect(list).toContain(`.sess-line--active ${cell},`);
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
    const at = css.indexOf('@media (forced-colors: active)');
    expect(at).toBeGreaterThan(-1);
    expect(ruleIn(css.slice(at), '.sess-line--active')).toContain('outline: 2px solid CanvasText');
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
