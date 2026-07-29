// jsdom applies no stylesheet, so these rules cannot be asserted through a
// render. Each one below fixes a defect MEASURED on the live page; reading the
// stylesheet as text is what stops them regressing silently.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

/** The declarations of the first rule whose selector list starts with `sel`. */
function ruleFor(sel: string): string {
  const i = css.indexOf(`\n${sel} {`);
  if (i < 0) throw new Error(`no rule for ${sel}`);
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
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
});
