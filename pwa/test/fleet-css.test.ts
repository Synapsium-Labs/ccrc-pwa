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
  it('centres the row group instead of baselining it in a taller box', () => {
    // Measured: .sess-label sat 10.8px above .sess-line's centre, because
    // baseline alignment does not centre inside a min-height box.
    const rule = ruleFor('.sess-open');
    expect(rule).toContain('align-items: center');
    expect(rule).not.toContain('align-items: baseline');
  });

  it('keeps the 44px thumb target on the row and its label button', () => {
    // The fix is centring, NOT shrinking: these are tap surfaces.
    expect(ruleFor('.sess-line')).toContain('min-height: 44px');
    expect(ruleFor('.sess-open')).toContain('min-height: 44px');
  });

  it('has one track per always-present cell, with the tally and warn fixed', () => {
    // SEVEN cells: lamp · label · state · tally · warn · account · actions.
    // Six tracks for seven children silently collapses the last one, and an
    // `auto` tally track aligns nothing on a row whose tally is empty.
    const cols = /grid-template-columns:([^;]+);/.exec(ruleFor('.sess-line'))?.[1] ?? '';
    expect(cols).toContain('3.25rem');
    expect(cols.trim().split(/\s+(?![^(]*\))/)).toHaveLength(7);
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
    // CSS Grid drops a display:none item from grid-item generation entirely
    // (unlike visibility:hidden, which keeps its track) — so auto-placed
    // children compact one track to the left when a sibling is hidden. That
    // is exactly what the @container query below did to .sess-acct once
    // .sess-state vanished at a narrow width: every child after it slid into
    // the vacated track and .sess-acct was squeezed into .sess-warn's 1rem
    // track. A test that only checks the @container block's selector would
    // pass against this bug — pinning every child to its column number is
    // what actually prevents it, regardless of which sibling gets hidden.
    const order = [
      '.sess-lamp', '.sess-open', '.sess-state', '.sess-tally',
      '.sess-warn', '.sess-acct', '.sess-actions',
    ];
    order.forEach((sel, i) => {
      expect(ruleFor(sel)).toContain(`grid-column: ${i + 1}`);
    });
  });

  it('drops the STATE word in a narrow container, never the account chip', () => {
    // The old query hid .sess-acct — the session's only visible binding —
    // while keeping a projection identical on every card. Inverted: the lamp
    // already encodes status by colour and shape, so the word is the redundant
    // cell, and the account appears nowhere else on the row.
    const q = css.slice(css.indexOf('@container fleetlist'));
    expect(q).toContain('.sess-state');
    expect(q).not.toContain('.sess-acct');
  });

  it('tightens the card padding and closes the header/body gap', () => {
    const rule = ruleFor('.proj-card');
    expect(rule).toContain('padding: var(--sp-2)');
    expect(rule).toContain('gap: 0');
  });
});
