// The account picker's row fits its sheet body at every width (D-5570).
//
// MEASURED ON main BEFORE THIS FIX (dist build, Playwright, both Phosphor
// palettes): in the new-session sheet every account row ran past
// `.sheet-body`'s right edge, by 51.8px at 360 and 21.8px at 390 in Refined
// and by 37.8px and 7.8px in Instrument, which cut the right side of the
// keyboard ring by up to 55.8px. The swap picker fitted only because none of
// its rows carried a pool tag.
//
// THE CAUSE IS THE LIST'S TRACK, NOT ONE ROW. `.acct-list` is a grid whose
// single column was `auto`, which never sizes below its widest item's
// min-content contribution. A row's pool tag is `white-space: nowrap`, and
// `flex: 1 1 0` with `min-width: 0` does not take it out of the row's
// min-content in Chromium, so the column grew to the spare row's full one-line
// width (about 384px against a 328px list) and dragged every row with it.
//
// jsdom lays nothing out, so the geometry is held by the Playwright measure
// in the PR (row right edge <= sheet body right edge, ring room >= 0, at 360
// and 390, both skins, both modes). This file holds the two things that
// produce that geometry: the markup groups the name with its secondary tags,
// and the stylesheet lets that group, never the name, give way.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AccountRow } from '../src/fleet/AccountRow';
import { TEST_ROSTER } from './rosterFixture';
import { declValue, ruleIn } from './cssRule';

afterEach(() => { cleanup(); });

const css = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

const FACTS = { five: 34, seven: 58, fiveRolledOver: false, sevenRolledOver: false } as never;

function renderRow(): HTMLElement {
  const wrapper = TEST_ROSTER[0]!.id;
  render(
    <AccountRow
      wrapper={wrapper}
      facts={FACTS}
      suggested
      onPick={vi.fn()}
      roster={TEST_ROSTER}
      poolChip="pool-a"
    />,
  );
  return screen.getByRole('button');
}

describe('the account picker row fits the sheet body (D-5570)', () => {
  it('keeps the name, the suggested pill and the pool tag in one identity group', () => {
    const row = renderRow();
    const ident = row.querySelector(':scope > .acct-ident');
    expect(ident, 'the row has no identity group for its name and tags').not.toBeNull();
    expect(ident!.querySelector(':scope > .chip')).not.toBeNull();
    expect(ident!.querySelector(':scope > .acct-suggested')).not.toBeNull();
    expect(ident!.querySelector(':scope > .acct-pool')).not.toBeNull();
    // The gauges and the chevron stay the row's own: they are the fixed
    // right-hand column the group yields to.
    expect(row.querySelector(':scope > .acct-gauges')).not.toBeNull();
    expect(row.querySelector(':scope > .acct-chev')).not.toBeNull();
    expect([...row.children].map((c) => c.className))
      .toEqual(['acct-ident', 'acct-gauges', 'acct-chev']);
  });

  it('never lets one row widen the list: the track is minmax(0, 1fr)', () => {
    expect(declValue(ruleIn(css, '.acct-list'), 'display')).toBe('grid');
    expect(declValue(ruleIn(css, '.acct-list'), 'grid-template-columns')).toBe('minmax(0,1fr)');
  });

  it('lets the identity group shrink and wrap, and wraps a long name rather than cutting it', () => {
    const rule = ruleIn(css, '.acct-ident');
    expect(declValue(rule, 'display')).toBe('flex');
    expect(declValue(rule, 'flex')).toBe('1 1 0');
    expect(declValue(rule, 'min-width')).toBe('0');
    expect(declValue(rule, 'flex-wrap')).toBe('wrap');
    // The column gap is the row's own `gap-3`, so a wide row draws exactly as
    // it did; the row gap is what a wrapped tag sits under the name by.
    expect(declValue(rule, 'column-gap')).toBe('var(--sp-3)');
    expect(declValue(rule, 'row-gap')).toBe('var(--sp-1)');
    // The name is what the operator chooses by: it may wrap, never ellipsis.
    expect(declValue(rule, 'overflow-wrap')).toBe('anywhere');
    expect(declValue(rule, 'overflow')).toBeNull();
    expect(declValue(rule, 'text-overflow')).toBeNull();
    // No rule here reaches into @ccrc/ui's chip to shrink or clip it.
    expect(css).not.toMatch(/\.acct-ident\s+\.chip/);
  });

  it('drops the pool tag under the name when it does not fit, truncating only past the group width', () => {
    const rule = ruleIn(css, '.acct-ident .acct-pool');
    expect(declValue(rule, 'flex')).toBe('0 1 auto');
    expect(declValue(rule, 'max-width')).toBe('100%');
    // The base rule, which project rows also wear, is unchanged.
    expect(declValue(ruleIn(css, '.acct-pool'), 'flex')).toBe('1 1 0');
    expect(declValue(ruleIn(css, '.acct-pool'), 'text-overflow')).toBe('ellipsis');
  });
});
