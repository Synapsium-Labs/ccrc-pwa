import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { WorkbenchAccountRow, type WorkbenchAccountItem, type WorkbenchUsageWindow } from './workbench-account-row';

const win = (pct: number | null, reset: string, rolledOver = false): WorkbenchUsageWindow =>
  ({ pct, reset, ...(rolledOver ? { rolledOver } : {}) });

const acct = (name: string, hue: string | null, five: WorkbenchUsageWindow, seven: WorkbenchUsageWindow,
  over: Partial<WorkbenchAccountItem> = {}): WorkbenchAccountItem =>
  ({ id: name, name, hue, five, seven, ...over });

/** One account in each band: ok, warn, crit. */
const BANDS: WorkbenchAccountItem[] = [
  acct('lane-a', 'cyan', win(22, '2h 10m'), win(41, '3d 4h')),
  acct('lane-b', 'violet', win(63, '1h 05m'), win(58, '2d 11h')),
  acct('lane-c', 'blue', win(82, '45m'), win(77, '3d 4h')),
];

const meta = {
  title: 'Components/WorkbenchAccountRow',
  component: WorkbenchAccountRow,
  args: { accounts: BANDS, onOpen: () => {} },
  // The sidebar foot's width: the desk shell sets the column, not the row.
  decorators: [(Story) => <div style={{ width: 380 }}><Story /></div>],
} satisfies Meta<typeof WorkbenchAccountRow>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Half a pixel of rounding, in a measurement of where a box ends. */
const EPS = 0.5;

/** The play tests' ruler: in a real browser, nothing in the foot may draw past
 *  the foot's own content edge (its 6px padding), and no visible cell may draw
 *  past its row. jsdom lays nothing out, so this is the one place the column
 *  fit is measured rather than read off the sheet. */
async function expectWithinColumn(canvas: HTMLElement): Promise<void> {
  const foot = canvas.querySelector<HTMLElement>('.wb-acct');
  if (foot === null) throw new Error('story did not render');
  const edge = foot.getBoundingClientRect().right - parseFloat(getComputedStyle(foot).paddingRight);
  for (const row of foot.querySelectorAll<HTMLElement>('.wb-acct-row, .wb-acct-colh')) {
    const r = row.getBoundingClientRect().right;
    await expect(r, `${row.className} ends inside the column`).toBeLessThanOrEqual(edge + EPS);
    for (const cell of row.querySelectorAll<HTMLElement>(':scope > *')) {
      if (getComputedStyle(cell).display === 'none') continue;
      await expect(cell.getBoundingClientRect().right, `${cell.className || cell.textContent} inside its row`)
        .toBeLessThanOrEqual(r + EPS);
    }
  }
}

/** Which reset cells draw, by window. */
const shownResets = (canvas: HTMLElement): string[] =>
  [...canvas.querySelectorAll<HTMLElement>('.wb-acct-row .wb-acct-reset')]
    .filter((c) => getComputedStyle(c).display !== 'none')
    .map((c) => c.getAttribute('data-win') ?? '?');

/** Three accounts, one per band. CHECK that each meter is green, amber and red
 *  by `limitBand` while every percentage stays the same secondary ink — the
 *  meter carries the band, the number the fact. CHECK the columns line up under
 *  `5h` and `7d`, and that no hue dot glows. Flip the Skin toolbar to
 *  Instrument: the meters become ten LEDs, and the row does not change shape. */
export const Default: Story = {};

/** A window never measured. CHECK `—` and NO fill at all on lane-a's 7d, and
 *  that its row's name says "never measured", not "0% used". */
export const NeverMeasured: Story = {
  args: { accounts: [acct('lane-a', 'cyan', win(34, '2h 10m'), win(null, '—')), BANDS[1]!] },
};

/** A measured zero. CHECK `0%` with an empty track (a zero-width fill), which
 *  must read differently from NeverMeasured's `—`. */
export const MeasuredZero: Story = {
  args: { accounts: [acct('lane-a', 'cyan', win(0, '4h 59m'), win(12, '6d 2h')), BANDS[1]!] },
};

/** A window that ended with nothing measuring the new one. CHECK `reset` and no
 *  fill on lane-b's 5h, with `↻ now` beside it — not a stale 64%. */
export const RolledOver: Story = {
  args: { accounts: [BANDS[0]!, acct('lane-b', 'violet', win(64, 'now', true), win(58, '2d 11h'))] },
};

/** An account that cannot take work. CHECK lane-d keeps its numbers with grey
 *  fills, its hue dot is a hollow ring, and the reason reads in words under its
 *  meters — three cues, none of them colour alone. */
export const Off: Story = {
  args: {
    accounts: [
      BANDS[0]!,
      acct('lane-d', 'amber', win(12, '1h 05m'), win(46, '3d 4h'), {
        off: true,
        note: { tone: 'off', text: 'sign-in expired on the fleet host' },
      }),
    ],
  },
};

/** Past the swap ceiling. CHECK the forecast line is in the dead text colour
 *  and says, in words, that the sessions move to another account. */
export const OverCeiling: Story = {
  args: {
    accounts: [
      acct('lane-c', 'blue', win(99, '45m'), win(63, '2d 11h'), {
        note: { tone: 'dead', text: '5h at 99%, over the 98% ceiling — its sessions move to another account.' },
      }),
      BANDS[0]!,
    ],
  },
};

/** Folded with hot windows (the phone's default). CHECK `▸`, aria-expanded
 *  false, and one line naming the two hottest windows at 75% or more, hottest
 *  first, each in its band's text colour: `lane-c 5h 82% · lane-c 7d 77%`. */
export const FoldedHot: Story = { args: { defaultFolded: true } };

/** Folded with nothing hot, one account off. CHECK `all under 75% · lane-d
 *  off`: an account that cannot take work is named, never folded into "all". */
export const FoldedCalm: Story = {
  args: {
    defaultFolded: true,
    accounts: [
      BANDS[0]!,
      BANDS[1]!,
      acct('lane-d', 'amber', win(12, '1h 05m'), win(46, '3d 4h'), {
        off: true,
        note: { tone: 'off', text: 'disabled on the fleet host' },
      }),
    ],
  },
};

/** Folded in a 360px column with two hot windows and three accounts off. CHECK
 *  the line keeps `· 3 off` whole at its right end while the hot windows
 *  before it ellipsize; a screen reader hears the three names after the count,
 *  and unfolding lists each with its reason. */
export const FoldedManyOff: Story = {
  args: {
    defaultFolded: true,
    accounts: [
      acct('lane-a', 'cyan', win(100, '12m'), win(100, '2d 1h')),
      BANDS[1]!,
      ...(['lane-d', 'lane-e', 'lane-f'] as const).map((n) =>
        acct(n, 'amber', win(12, '1h 05m'), win(46, '3d 4h'), { off: true, note: { tone: 'off', text: 'disabled on the fleet host' } })),
    ],
  },
  decorators: [(Story) => <div style={{ width: 360 }}><Story /></div>],
};

/** Folded in a 260px column, one account off with a long name. CHECK the line
 *  ends `· lane-d-secon… off`: the name ellipsizes, the word `off` is whole
 *  and inside the column, and hovering the name shows it in full. */
export const FoldedLongOffName: Story = {
  args: {
    defaultFolded: true,
    accounts: [
      acct('lane-a', 'cyan', win(100, '12m'), win(82, '2d 1h')),
      acct('lane-d-secondary-reserve-account', 'amber', win(12, '1h 05m'), win(46, '3d 4h'), {
        off: true,
        note: { tone: 'off', text: 'disabled on the fleet host' },
      }),
    ],
  },
  decorators: [(Story) => <div style={{ width: 260 }}><Story /></div>],
  play: async ({ canvasElement }) => {
    const head = canvasElement.querySelector<HTMLElement>('.wb-acct-head');
    const who = canvasElement.querySelector<HTMLElement>('.wb-acct-who');
    const word = canvasElement.querySelector<HTMLElement>('.wb-acct-word');
    if (head === null || who === null || word === null) throw new Error('story did not render');
    const inner = head.getBoundingClientRect().right - parseFloat(getComputedStyle(head).paddingRight);
    // The state word is whole and inside the head: never cut, never past it.
    await expect(word.textContent).toBe(' off');
    await expect(word.scrollWidth, 'the word off is not cut').toBeLessThanOrEqual(word.clientWidth);
    await expect(word.getBoundingClientRect().right, 'off ends inside the head').toBeLessThanOrEqual(inner + EPS);
    // The name gives instead: ellipsized, no narrower than its 4ch floor.
    await expect(who.scrollWidth, 'the long name ellipsizes').toBeGreaterThan(who.clientWidth);
    const ch = parseFloat(getComputedStyle(who).fontSize) * 0.5;
    await expect(who.getBoundingClientRect().width, 'the name keeps its floor').toBeGreaterThanOrEqual(4 * ch);
  },
};

/** Open in a 336px column (the desk's sidebar). CHECK nothing draws past the
 *  column's right edge: in Refined the 7d reset column is gone (Instrument's
 *  smaller type keeps it), the 5h reset stays, and each row's name still reads
 *  both resets. */
export const Column336: Story = {
  decorators: [(Story) => <div style={{ width: 336 }}><Story /></div>],
  play: async ({ canvasElement }) => {
    await expectWithinColumn(canvasElement);
    // Refined's 12px grid needs about 338px and drops the 7d reset here;
    // Instrument's 11px one fits whole. Either way every 5h reset stays.
    await expect(shownResets(canvasElement).filter((w) => w === '5h')).toHaveLength(3);
  },
};

/** Open in a 260px column. CHECK both reset columns are gone, `5h` and `7d`
 *  still sit over their meters, and nothing draws past the column's edge. */
export const Column260: Story = {
  args: {
    accounts: [
      ...BANDS,
      acct('lane-d', 'amber', win(12, '1h 05m'), win(46, '3d 4h'), {
        off: true,
        note: { tone: 'off', text: 'sign-in expired on the fleet host' },
      }),
    ],
  },
  decorators: [(Story) => <div style={{ width: 260 }}><Story /></div>],
  play: async ({ canvasElement }) => {
    await expectWithinColumn(canvasElement);
    await expect(shownResets(canvasElement)).toEqual([]);
  },
};
