// WorkbenchAccountRow — the desk sidebar's foot: an "Accounts" eyebrow head
// that folds, the 5h/7d column heads, and one dense row per account, each row
// one button that opens the Accounts screen. Plain data in, callbacks out: the
// app maps its accounts store and `formatReset` onto `WorkbenchAccountItem`, and
// decides the swap ceiling, which arrives here only as a `note`.
//
// The three readings stay three facts — `—` never measured (no fill), `0%` a
// measured zero (a zero-width fill), `reset` a window that ended with nothing
// measuring the new one (no fill) — and an account that cannot take work keeps
// its last numbers with greyed fills, a hollow hue ring and its reason in words.
// Neutral fixtures only (`lane-a` …): this repository is public.
//
// MUTATION TABLE (mutation-table discipline: each guard measured red with the
// guard removed, green restored). Measured 2026-10-20 on this file, from pwa/:
// before 27/27 green; each mutant 1 failed | 26 passed; restored 27/27 green.
//   1. `reading()` folds rolled-over into the percentage (drop its rolledOver
//      arm)                         → RED "— for never measured … reset for rolled over"
//   2. `hottestWindows` stops skipping `off` accounts
//                                    → RED "hottestWindows: … off accounts excluded"
//   3. the row's `onClick` dropped   → RED "a row opens the Accounts screen: onOpen(id)"
//   4. the pointer-fine floor moved out of `@media (pointer: fine)`
//                                    → RED "the floor is the tap minimum…"
// Second round, same method (29/29 green before and after each):
//   5. the off tail rendered inside the shrinking lead
//                                    → RED "the off tail sits outside the shrinking lead…"
//   6. the off tail's `flex: none` dropped from the sheet
//                                    → RED "the off tail sits outside the shrinking lead…"
//   7. every off account named, never counted
//                                    → RED "two or more off accounts collapse to a count…"
// Third round (visual verifier S2 x2), same method, 34/34 green before and
// after each; every mutant red:
//   8. ` off` dropped from the never-shrinking rule   → RED "a long off name ellipsizes…"
//   9. the name's 4ch floor removed                    → RED "a long off name ellipsizes…"
//  10. a short name / count padded to the floor       → RED "a name of 4ch or less…"
//  11. the foot's `overflow-x: clip` removed          → RED "the foot clips, never spills…"
//  12. the narrow tier keeps the 7d reset             → RED "each reset names its window…"
//  13. the tail's `max-width: 100%` removed           → RED "the off tail sits outside…"
//  14. the tail no longer spoken as one phrase        → RED x3 (accessible-name assertions)
//  15. name and ` off` merged back into one span      → RED x2
// The column geometry itself is measured in a real browser by the stories'
// play tests (FoldedLongOffName, Column336, Column260) in storybook-a11y.
// Red-first: the whole file was run before the component existed and failed on
// the missing module.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  WorkbenchAccountRow,
  hottestWindows,
  type WorkbenchAccountItem,
  type WorkbenchUsageWindow,
} from '@ccrc/ui';
import { atBlock, declaredValues, declValue, norm, ruleIn, stripComments } from './cssRule';

afterEach(cleanup);

const SHEET = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'workbench-account-row.css'),
  'utf8',
);
const SOURCE = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'workbench-account-row.tsx'),
  'utf8',
);

const win = (pct: number | null, reset = '2h 10m', over: Partial<WorkbenchUsageWindow> = {}): WorkbenchUsageWindow =>
  ({ pct, reset, ...over });
const acct = (id: string, five: WorkbenchUsageWindow, seven: WorkbenchUsageWindow,
  over: Partial<WorkbenchAccountItem> = {}): WorkbenchAccountItem =>
  ({ id, name: id, hue: 'cyan', five, seven, ...over });

const A = acct('lane-a', win(82), win(41, '3d 4h'));
const B = acct('lane-b', win(12, '1h 05m'), win(77, '3d 4h'), { hue: 'violet' });
const C = acct('lane-c', win(30, '45m'), win(20, '2d 11h'), { hue: 'blue' });

/** What the folded line DRAWS: its text without the screen-reader-only spans. */
const drawn = (el: Element | null): string | undefined => {
  if (el === null) return undefined;
  const copy = el.cloneNode(true) as Element;
  for (const sr of copy.querySelectorAll('.sr-only')) sr.remove();
  return copy.textContent ?? '';
};

const rowOf = (name: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`^${name} — `) });

describe('the three readings, never collapsed', () => {
  it('— for never measured (no fill), 0% for a measured zero (a zero-width fill), reset for rolled over (no fill)', () => {
    render(
      <WorkbenchAccountRow
        accounts={[acct('lane-a', win(null, '—'), win(0, '3d 4h')), acct('lane-b', win(64, 'now', { rolledOver: true }), win(41))]}
        onOpen={() => {}}
      />,
    );
    const a = rowOf('lane-a');
    const b = rowOf('lane-b');
    expect(within(a).getByText('—')).toBeTruthy();
    expect(within(a).getByText('0%')).toBeTruthy();
    expect(within(b).getByText('reset')).toBeTruthy();
    expect(within(b).queryByText('64%')).toBeNull();

    const [aFive, aSeven] = [...a.querySelectorAll('.meter')];
    expect(aFive!.querySelector('.meter-fill')).toBeNull();
    const zero = aSeven!.querySelector<HTMLElement>('.meter-fill');
    expect(zero).not.toBeNull();
    expect(zero!.style.width).toBe('0%');

    const [bFive] = [...b.querySelectorAll('.meter')];
    expect(bFive!.querySelector('.meter-fill')).toBeNull();
  });

  it('percentages are whole numbers', () => {
    render(<WorkbenchAccountRow accounts={[acct('lane-a', win(82.6), win(41.2))]} onOpen={() => {}} />);
    const a = rowOf('lane-a');
    expect(within(a).getByText('83%')).toBeTruthy();
    expect(within(a).getByText('41%')).toBeTruthy();
  });

  it('the reset sits after ↻ in each window', () => {
    render(<WorkbenchAccountRow accounts={[A]} onOpen={() => {}} />);
    const resets = [...rowOf('lane-a').querySelectorAll('.wb-acct-reset')].map((n) => n.textContent);
    expect(resets).toEqual(['↻ 2h 10m', '↻ 3d 4h']);
  });
});

describe('bands come from limitBand, on the meter only', () => {
  it('data-band is ok / warn / crit by limitBand, and none for never-measured and rolled-over windows', () => {
    render(
      <WorkbenchAccountRow
        accounts={[acct('lane-a', win(30), win(60)), acct('lane-b', win(82), win(null)), acct('lane-c', win(90, 'now', { rolledOver: true }), win(75))]}
        onOpen={() => {}}
      />,
    );
    const bands = (n: string): (string | null)[] =>
      [...rowOf(n).querySelectorAll('.meter')].map((m) => m.getAttribute('data-band'));
    expect(bands('lane-a')).toEqual(['ok', 'warn']);
    expect(bands('lane-b')).toEqual(['crit', 'none']);
    expect(bands('lane-c')).toEqual(['none', 'warn']);
  });

  it('the percentage is never coloured by band (the meter carries the band, the number the fact)', () => {
    const pct = ruleIn(SHEET, '.wb-acct-row .wb-acct-pct');
    expect(declValue(pct, 'color')).toBe('var(--ink-secondary)');
    expect(stripComments(SHEET)).not.toMatch(/\.wb-acct-pct\[data-band/);
  });
});

describe('an account that cannot take work', () => {
  const OFF = acct('lane-d', win(12, '1h 05m'), win(null, '—'), {
    hue: 'amber', off: true, note: { tone: 'off', text: 'sign-in expired on the fleet host' },
  });

  it('keeps its last numbers with greyed fills (limit-fill--off), its band still on the track', () => {
    render(<WorkbenchAccountRow accounts={[OFF]} onOpen={() => {}} />);
    const row = rowOf('lane-d');
    expect(within(row).getByText('12%')).toBeTruthy();
    const fill = row.querySelector('.meter-fill');
    expect(fill?.classList.contains('limit-fill--off')).toBe(true);
    expect(row.querySelector('.meter')?.getAttribute('data-band')).toBe('ok');
  });

  it('draws a hollow ring, not a filled dot, and never glows', () => {
    render(<WorkbenchAccountRow accounts={[OFF, A]} onOpen={() => {}} />);
    expect(rowOf('lane-d').querySelector('.wb-acct-hue')?.getAttribute('data-off')).toBe('true');
    expect(rowOf('lane-a').querySelector('.wb-acct-hue')?.hasAttribute('data-off')).toBe(false);
    const hollow = ruleIn(SHEET, '.wb-acct-row .wb-acct-hue[data-off=true]');
    expect(declValue(hollow, 'box-shadow')).toBe('inset 0 0 0 1.5px var(--acct-active)');
    // Glow means life: an account is not alive, its sessions are.
    expect(stripComments(SHEET)).not.toMatch(/animation|@keyframes|drop-shadow|--glow/);
  });

  it('says why in words on the row, and in the row\'s name', () => {
    render(<WorkbenchAccountRow accounts={[OFF]} onOpen={() => {}} />);
    const row = rowOf('lane-d');
    const note = within(row).getByText('sign-in expired on the fleet host');
    expect(note.getAttribute('data-tone')).toBe('off');
    expect(row.getAttribute('aria-label')).toMatch(/; sign-in expired on the fleet host$/);
  });

  it('the over-ceiling forecast is a dead-toned note', () => {
    const text = '5h at 99%, over the 98% ceiling — its sessions move to another account.';
    render(<WorkbenchAccountRow accounts={[acct('lane-c', win(99, '45m'), win(63), { note: { tone: 'dead', text } })]} onOpen={() => {}} />);
    expect(screen.getByText(text).getAttribute('data-tone')).toBe('dead');
    expect(declValue(ruleIn(SHEET, '.wb-acct-row .wb-acct-note[data-tone=dead]'), 'color')).toBe('var(--status-dead-text)');
  });
});

describe('hottestWindows', () => {
  it('the two hottest live windows at >= 75%, hottest first', () => {
    const hot = hottestWindows([
      acct('lane-a', win(82), win(41)),
      acct('lane-b', win(12), win(77)),
      acct('lane-c', win(99), win(75)),
      acct('lane-e', win(74.4), win(10)),
    ]);
    expect(hot).toEqual([
      { name: 'lane-c', window: '5h', pct: 99 },
      { name: 'lane-a', window: '5h', pct: 82 },
    ]);
  });

  it('the threshold is >= 75, inclusive; n widens the list', () => {
    const hot = hottestWindows([acct('lane-a', win(75), win(74)), acct('lane-b', win(80), win(76))], 5);
    expect(hot.map((h) => `${h.name} ${h.window} ${h.pct}`)).toEqual(['lane-b 5h 80', 'lane-b 7d 76', 'lane-a 5h 75']);
  });

  it('never-measured and rolled-over windows are not hot; off accounts excluded', () => {
    const hot = hottestWindows([
      acct('lane-a', win(null), win(90, 'now', { rolledOver: true })),
      acct('lane-d', win(95), win(96), { off: true }),
    ]);
    expect(hot).toEqual([]);
  });
});

describe('the fold', () => {
  it('open by default: the head is aria-expanded=true, the column heads and every row show', () => {
    render(<WorkbenchAccountRow accounts={[A, B, C]} onOpen={() => {}} />);
    const head = screen.getByRole('button', { name: /^Accounts/ });
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(rowOf('lane-a')).toBeTruthy();
    expect(rowOf('lane-c')).toBeTruthy();
    const colh = document.querySelector('.wb-acct-colh');
    expect(colh?.getAttribute('aria-hidden')).toBe('true');
    expect(colh?.textContent).toBe('5h7d');
  });

  it('folded: aria-expanded=false, no rows, and the hottest windows each in its band', () => {
    render(<WorkbenchAccountRow accounts={[A, B, C]} defaultFolded onOpen={() => {}} />);
    const head = screen.getByRole('button', { name: /^Accounts/ });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /^lane-a — / })).toBeNull();
    expect(drawn(document.querySelector('.wb-acct-sum'))).toBe('lane-a 5h 82% · lane-b 7d 77%');
    const hot = [...document.querySelectorAll('.wb-acct-hot')].map((h) => [h.textContent, h.getAttribute('data-band')]);
    expect(hot).toEqual([['lane-a 5h 82%', 'crit'], ['lane-b 7d 77%', 'crit']]);
  });

  it('folded and calm: "all under 75%"; an off account is named rather than implied', () => {
    const off = acct('lane-d', win(12), win(20), { off: true });
    render(<WorkbenchAccountRow accounts={[C, off]} defaultFolded onOpen={() => {}} />);
    expect(drawn(document.querySelector('.wb-acct-sum'))).toBe('all under 75% · lane-d off');
    expect(screen.getByRole('button', { name: /^Accounts/ })).toHaveAccessibleName(/lane-d off$/);
  });

  it('folded: two or more off accounts collapse to a count, their names still spoken', () => {
    const offs = ['lane-d', 'lane-e', 'lane-f'].map((n) => acct(n, win(12), win(20), { off: true }));
    render(<WorkbenchAccountRow accounts={[A, B, ...offs]} defaultFolded onOpen={() => {}} />);
    const tail = document.querySelector('.wb-acct-off');
    expect(drawn(tail)).toBe(' · 3 off');
    expect(tail?.querySelector('.sr-only')?.textContent).toBe('3 off: lane-d, lane-e, lane-f');
    expect(screen.getByRole('button', { name: /^Accounts/ })).toHaveAccessibleName(/3 off: lane-d, lane-e, lane-f$/);
  });

  it('folded: the off tail sits outside the shrinking lead, and never grows past the line', () => {
    const off = acct('lane-d', win(12), win(20), { off: true });
    render(<WorkbenchAccountRow accounts={[A, B, off]} defaultFolded onOpen={() => {}} />);
    const sum = document.querySelector('.wb-acct-sum')!;
    expect(sum.querySelector('.wb-acct-lead')?.textContent).toBe('lane-a 5h 82% · lane-b 7d 77%');
    expect(sum.querySelector('.wb-acct-lead .wb-acct-off')).toBeNull();
    expect(drawn(sum.querySelector(':scope > .wb-acct-off'))).toBe(' · lane-d off');
    expect(declValue(ruleIn(SHEET, '.wb-acct-head .wb-acct-off'), 'flex')).toBe('none');
    expect(declValue(ruleIn(SHEET, '.wb-acct-head .wb-acct-off'), 'max-width')).toBe('100%');
    expect(declValue(ruleIn(SHEET, '.wb-acct-head .wb-acct-lead'), 'text-overflow')).toBe('ellipsis');
  });

  // Visual verifier S2: a 32-character off name in a 260px column was cut
  // mid-glyph and took the word `off` with it. The tail is now three spans: the
  // name ellipsizes to a 4ch floor, the separator and ` off` never shrink. The
  // 260px geometry itself is measured by the story's play test
  // (FoldedLongOffName); jsdom lays nothing out, so this pins the structure
  // and the sheet that geometry rests on.
  it('folded: a long off name ellipsizes in its own span and the word off is never cut', () => {
    const long = 'lane-d-secondary-reserve-account';
    expect(long.length).toBeGreaterThanOrEqual(30);
    const off = acct('lane-d', win(12), win(20), { off: true, name: long });
    render(
      <div style={{ width: 260 }}>
        <WorkbenchAccountRow accounts={[A, off]} defaultFolded onOpen={() => {}} />
      </div>,
    );
    const tail = document.querySelector('.wb-acct-sum > .wb-acct-off')!;
    expect(drawn(tail)).toBe(` · ${long} off`);
    const [sep, who, word, spoken, ...rest] = [...tail.children];
    expect(rest).toEqual([]);
    // Drawn in three spans, spoken as one phrase.
    for (const drawnPart of [sep, who, word]) expect(drawnPart!.getAttribute('aria-hidden')).toBe('true');
    expect(spoken!.className).toBe('sr-only');
    expect(spoken!.textContent).toBe(`${long} off`);
    expect(who!.className).toBe('wb-acct-who');
    expect(who!.textContent).toBe(long);
    expect(who!.getAttribute('title')).toBe(long);
    expect(who!.hasAttribute('data-short')).toBe(false);
    expect(word!.className).toBe('wb-acct-word');
    expect(word!.textContent).toBe(' off');
    expect(screen.getByRole('button', { name: /^Accounts/ })).toHaveAccessibleName(new RegExp(`${long} off$`));

    const whoRule = ruleIn(SHEET, '.wb-acct-head .wb-acct-who');
    expect(declValue(whoRule, 'min-width')).toBe('4ch');
    expect(declValue(whoRule, 'overflow')).toBe('hidden');
    expect(declValue(whoRule, 'text-overflow')).toBe('ellipsis');
    expect(declValue(whoRule, 'flex')).toBe('0 1 auto');
    expect(declValue(ruleIn(SHEET, '.wb-acct-head .wb-acct-word'), 'flex')).toBe('none');
    expect(declValue(ruleIn(SHEET, '.wb-acct-head .wb-acct-sep'), 'flex')).toBe('none');
  });

  it('folded: a name of 4ch or less, and a count, never shrink, so the floor never pads them', () => {
    render(<WorkbenchAccountRow accounts={[A, acct('ab', win(1), win(2), { off: true })]} defaultFolded onOpen={() => {}} />);
    const who = document.querySelector('.wb-acct-who')!;
    expect(who.getAttribute('data-short')).toBe('true');
    expect(who.getAttribute('title')).toBe('ab');
    cleanup();
    const offs = ['lane-d', 'lane-e'].map((n) => acct(n, win(1), win(2), { off: true }));
    render(<WorkbenchAccountRow accounts={[A, ...offs]} defaultFolded onOpen={() => {}} />);
    const count = document.querySelector('.wb-acct-who')!;
    expect(count.textContent).toBe('2');
    expect(count.getAttribute('data-short')).toBe('true');
    expect(count.hasAttribute('title')).toBe(false);
    const short = ruleIn(SHEET, '.wb-acct-head .wb-acct-who[data-short=true]');
    expect(declValue(short, 'flex')).toBe('none');
    expect(declValue(short, 'min-width')).toBe('0');
  });

  it('exactly 75% is warn, not crit, in the folded line', () => {
    render(<WorkbenchAccountRow accounts={[acct('lane-a', win(75), win(10))]} defaultFolded onOpen={() => {}} />);
    expect(document.querySelector('.wb-acct-hot')?.getAttribute('data-band')).toBe('warn');
  });

  it('the head toggles the fold, and the fold glyph is aria-hidden', () => {
    render(<WorkbenchAccountRow accounts={[A]} onOpen={() => {}} />);
    const head = screen.getByRole('button', { name: /^Accounts/ });
    expect(head.querySelector('.wb-acct-fold')?.getAttribute('aria-hidden')).toBe('true');
    expect(head.querySelector('.wb-acct-fold')?.textContent).toBe('▾');
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(head.querySelector('.wb-acct-fold')?.textContent).toBe('▸');
    expect(screen.queryByRole('button', { name: /^lane-a — / })).toBeNull();
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(rowOf('lane-a')).toBeTruthy();
  });

  it('the hot words take the attention and dead text colours from the band', () => {
    expect(declValue(ruleIn(SHEET, '.wb-acct-head .wb-acct-hot[data-band=warn]'), 'color')).toBe('var(--status-attention-text)');
    expect(declValue(ruleIn(SHEET, '.wb-acct-head .wb-acct-hot[data-band=crit]'), 'color')).toBe('var(--status-dead-text)');
  });
});

describe('a row is one button that opens the Accounts screen', () => {
  it('a row opens the Accounts screen: onOpen(id) on activation of its native button', () => {
    const onOpen = vi.fn();
    render(<WorkbenchAccountRow accounts={[A, acct('acct-2', win(1), win(2), { name: 'lane-b' })]} onOpen={onOpen} />);
    const row = rowOf('lane-b');
    expect(row.tagName).toBe('BUTTON');
    expect(row.getAttribute('type')).toBe('button');
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith('acct-2');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('the head never calls onOpen', () => {
    const onOpen = vi.fn();
    render(<WorkbenchAccountRow accounts={[A]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /^Accounts/ }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('the row\'s name reads both windows in words', () => {
    render(<WorkbenchAccountRow accounts={[A, acct('lane-b', win(null, '—'), win(10, 'now', { rolledOver: true }))]} onOpen={() => {}} />);
    expect(rowOf('lane-a').getAttribute('aria-label'))
      .toBe('lane-a — 5h 82% used, resets in 2h 10m; 7d 41% used, resets in 3d 4h');
    expect(rowOf('lane-b').getAttribute('aria-label'))
      .toBe('lane-b — 5h never measured, resets in —; 7d reset, resets in now');
  });

  it('every focusable control carries the focus ring; the hue rides data-acct, unknown for a null hue', () => {
    render(<WorkbenchAccountRow accounts={[A, acct('lane-x', win(1), win(2), { hue: null })]} onOpen={() => {}} />);
    for (const b of screen.getAllByRole('button')) expect(b.className).toMatch(/focus-visible:outline-2/);
    expect(rowOf('lane-a').getAttribute('data-acct')).toBe('cyan');
    expect(rowOf('lane-x').getAttribute('data-acct')).toBe('unknown');
  });
});

describe('the sheet', () => {
  // The wide grid, then one template per container tier, in source order.
  const TIERS = [
    '6px 6ch minmax(24px, 1fr) 5ch 8ch minmax(24px, 1fr) 5ch 8ch',
    '6px 6ch minmax(24px, 1fr) 5ch 8ch minmax(24px, 1fr) 5ch',
    '6px 6ch minmax(24px, 1fr) 5ch minmax(24px, 1fr) 5ch',
    '6px minmax(3ch, 6ch) minmax(12px, 1fr) 5ch minmax(12px, 1fr) 5ch',
  ].map(norm);
  const NO_7D = '@container wb-acct (width < calc(108px + 32ch))';
  const NO_RESET = '@container wb-acct (width < calc(102px + 24ch))';
  const TIGHT = '@container wb-acct (width < calc(96px + 16ch))';

  it('rows and column heads share one grid template, tier by tier', () => {
    expect(declaredValues(SHEET, '.wb-acct-row', 'grid-template-columns')).toEqual(TIERS);
    expect(declaredValues(SHEET, '.wb-acct-colh', 'grid-template-columns')).toEqual(TIERS);
    expect(declValue(ruleIn(SHEET, '.wb-acct-row'), 'column-gap')).toBe('6px');
    // Each tier's template lives in its own container block, never outside one.
    for (const [block, tpl] of [[NO_7D, TIERS[1]], [NO_RESET, TIERS[2]], [TIGHT, TIERS[3]]] as const) {
      expect(declaredValues(atBlock(SHEET, block), '.wb-acct-row', 'grid-template-columns')).toEqual([tpl]);
    }
  });

  // Visual verifier S2: the wide grid needs about 338px, so at the desk's 336
  // and 260px sidebar columns the reset cells drew past the column's edge. The
  // rows now sit in a size container whose tiers drop the 7d reset, then the
  // 5h one; the foot clips whatever a column narrower than the last tier asks
  // for. The geometry is measured by the Column336/Column260 play tests.
  it('the rows sit in a size container measured in their own mono ch', () => {
    render(<WorkbenchAccountRow accounts={[A, B]} onOpen={() => {}} />);
    const list = document.querySelector('.wb-acct > .wb-acct-list')!;
    expect(list.querySelector(':scope > .wb-acct-colh')).not.toBeNull();
    expect(list.querySelectorAll(':scope > .wb-acct-row')).toHaveLength(2);
    const rule = ruleIn(SHEET, '.wb-acct-list');
    expect(declValue(rule, 'container')).toBe('wb-acct / inline-size');
    expect(declValue(rule, 'font-family')).toBe('var(--family-mono)');
    expect(declValue(rule, 'font-size')).toBe('var(--fs-meta)');
    expect(declValue(rule, 'min-width')).toBe('0');
  });

  it('each reset names its window, and the tiers drop the 7d reset first, then both', () => {
    render(<WorkbenchAccountRow accounts={[A]} onOpen={() => {}} />);
    const wins = [...rowOf('lane-a').querySelectorAll('.wb-acct-reset')].map((n) => n.getAttribute('data-win'));
    expect(wins).toEqual(['5h', '7d']);
    expect(declValue(ruleIn(atBlock(SHEET, NO_7D), '.wb-acct-row .wb-acct-reset[data-win=7d]'), 'display')).toBe('none');
    expect(declValue(ruleIn(atBlock(SHEET, NO_RESET), '.wb-acct-row .wb-acct-reset'), 'display')).toBe('none');
    // Outside the tiers no reset is ever hidden.
    const outside = SHEET.replace(atBlock(SHEET, NO_7D), '').replace(atBlock(SHEET, NO_RESET), '');
    expect(declaredValues(outside, '.wb-acct-reset', 'display')).toEqual([]);
    // The column heads follow the cells they head.
    expect(declValue(ruleIn(atBlock(SHEET, NO_7D), '.wb-acct-colh > :last-child'), 'grid-column')).toBe('6 / 8');
    expect(declValue(ruleIn(atBlock(SHEET, NO_RESET), '.wb-acct-colh > :first-child'), 'grid-column')).toBe('3 / 5');
    expect(declValue(ruleIn(atBlock(SHEET, NO_RESET), '.wb-acct-colh > :last-child'), 'grid-column')).toBe('5 / 7');
  });

  it('the foot clips, never spills: min-width 0 and overflow-x clip', () => {
    expect(declaredValues(SHEET, '.wb-acct', 'overflow-x')).toEqual(['clip']);
    expect(declValue(ruleIn(SHEET, '.wb-acct'), 'min-width')).toBe('0');
  });

  it('the floor is the tap minimum, and 28px only inside (pointer: fine)', () => {
    const fine = atBlock(SHEET, '@media (pointer: fine)');
    const outside = SHEET.replace(fine, '');
    for (const sel of ['.wb-acct-head', '.wb-acct-row']) {
      expect(declaredValues(outside, sel, 'min-height')).toEqual(['var(--tap-min)']);
      expect(declaredValues(fine, sel, 'min-height')).toEqual(['28px']);
    }
    expect(stripComments(SHEET)).not.toMatch(/\b44px\b/);
  });

  it('tokens only: no literal colour, no opacity fade, every :hover inside (hover: hover)', () => {
    const css = stripComments(SHEET);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
    expect(css).not.toMatch(/(^|[;{\s])opacity\s*:/);
    expect(css).not.toMatch(/data-skin/);
    const hover = atBlock(SHEET, '@media (hover: hover)');
    expect((css.match(/:hover/g) ?? []).length).toBe((stripComments(hover).match(/:hover/g) ?? []).length);
    expect(css).toMatch(/^\s*@layer components\s*\{/m);
  });

  it('machine text is mono with tabular figures', () => {
    const row = ruleIn(SHEET, '.wb-acct-row');
    expect(declValue(row, 'font-family')).toBe('var(--family-mono)');
    expect(declValue(row, 'font-variant-numeric')).toBe('tabular-nums');
  });

  it('the source imports nothing from shared/ or the app, and holds no hue list', () => {
    expect(SOURCE).not.toMatch(/from '[^']*shared\//);
    expect(SOURCE).not.toMatch(/from '[^']*pwa\//);
    expect(SOURCE).not.toMatch(/'(cyan|violet|magenta|amber|green)'/);
  });
});
