// D-8114 (delegation broker wave 5 PR8c): Settings › Automation › "Worktrees left behind". The card reads the lane's
// keep switch through its own hook (as the Settings frame hands it one) and writes `{on}`; every case spies
// `api.delegationAdopt` and `api.setDelegationAdopt`, or hands the card a poll of its own, and renders the card alone.
// Every word is `DELEGATION_ADOPT_TEXT` (or one of its functions), read by name. Turning the switch ON asks first, in a
// confirm sheet that names how many worktrees it would keep; nothing is sent before the confirm.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import type { DelegationAdoptionHealth, DelegationAdoptionKeep } from '../../shared/api';
import { DELEGATION_ADOPTION_KEEPS_MAX } from '../../shared/api';
import {
  DELEGATION_ADOPT_REFUSALS, isDelegationAdoptOnRefusal, isDelegationAdoptRefusal, type DelegationAdoptView,
} from '../../shared/delegation-adopt';
import { DelegationAdoptSection } from '../src/fleet/DelegationAdoptSection';
import { COLLECT_SECTION_TEXT } from '../src/fleet/collectLaneWords';
import { COORD_CONFIRM_MS } from '../src/fleet/coordWords';
import { useDelegationAdoptView, type DelegationAdoptPoll } from '../src/fleet/useDelegationAdoptView';
import * as words from '../src/fleet/delegationAdoptWords';
import {
  DELEGATION_ADOPT_REFUSAL_TEXT as REFUSAL, DELEGATION_ADOPT_TEXT as T, asDelegationAdoptView, delegationAdoptCapLine,
  delegationAdoptChecked, delegationAdoptConfirm, delegationAdoptCountsLine, delegationAdoptFailure, delegationAdoptKeepChanges,
  delegationAdoptKeepLine, delegationAdoptKeepsHeading, delegationAdoptKeepsMore, delegationAdoptModeLine,
  delegationAdoptRefusedLine,
} from '../src/fleet/delegationAdoptWords';
import { ApiError, api } from '../src/lib/api';
import { UNCONFIRMED_TEXT } from '../src/fleet/settingsText';
import { renderSettings } from './settingsHost';

function Polled(): ReactNode {
  return <DelegationAdoptSection poll={useDelegationAdoptView()} />;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const health = (over: Partial<DelegationAdoptionHealth> = {}): DelegationAdoptionHealth => ({
  mode: 'shadow', adopted: 0, wouldAdopt: 2, waiting: 1, unchanged: 3, unaudited: 0, conflicting: 0, unsupported: 0,
  uncensused: 0, owed: 0, ...over,
});
const keep = (over: Partial<DelegationAdoptionKeep> = {}): DelegationAdoptionKeep => ({
  project: 'project-a', worktree: 'agent-a1', parent: 'session-a', ...over,
});
const TWO = [
  keep(),
  keep({
    worktree: 'agent-b2', parent: 'session-b', project: 'project-b',
    changes: { dirty: true, aheadOfBase: 2, branchAheadOfBase: 1 },
  }),
];
const view = (over: Partial<DelegationAdoptView> = {}): DelegationAdoptView => ({
  state: 'clear',
  caps: { verb: 'present', audit: 'present' },
  refused: { on: null, off: null },
  adoption: health({ keeps: { items: TWO, more: 0 } }),
  ...over,
});
/** `hidden`: while the confirm sheet is open the rest of the page is aria-hidden, and a case still reads the card behind it. */
const radio = (name: string): HTMLInputElement => screen.getByRole<HTMLInputElement>('radio', { name, hidden: true });
const group = (): HTMLElement => screen.getByRole('group', { name: T.legend, hidden: true });
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

/** A card on a poll the case owns: `show` is a read landing. */
function owned(first: DelegationAdoptView): { poll: DelegationAdoptPoll; show: (v: DelegationAdoptView) => void } {
  const poll: DelegationAdoptPoll = { view: first, failure: null, reload: vi.fn(() => 0), landed: 0, settle: vi.fn() };
  const { rerender } = render(<DelegationAdoptSection poll={poll} />);
  return { poll, show: (v) => { rerender(<DelegationAdoptSection poll={{ ...poll, view: v }} />); } };
}

type SetAnswer = Awaited<ReturnType<typeof api.setDelegationAdopt>>;
const deferred = (): { promise: Promise<SetAnswer>; resolve: (a: SetAnswer) => void; reject: (e: unknown) => void } => {
  let resolve: (a: SetAnswer) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<SetAnswer>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
/** Tap "on" and answer the sheet: the sheet's confirm button. */
async function tapOnAndConfirm(): Promise<void> {
  fireEvent.click(radio(T.on));
  const sheet = await screen.findByRole('dialog');
  fireEvent.click(within(sheet).getByRole('button', { name: T.confirmLabel }));
}

describe('the read: the card says what the lane says (D-8114)', () => {
  it('shadow: off is checked, the mode and its counts show, the title is the card\'s', async () => {
    vi.spyOn(api, 'delegationAdopt').mockResolvedValue(view());
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    expect(radio(T.on).checked).toBe(false);
    expect(screen.getByRole('heading', { level: 3, name: T.title })).toBeInTheDocument();
    expect(screen.getByText(T.offNote)).toBeInTheDocument();
    expect(screen.getByText(T.onNote)).toBeInTheDocument();
    expect(screen.getByText(delegationAdoptModeLine(health()))).toBeInTheDocument();
    expect(screen.getByText(delegationAdoptCountsLine(health()))).toBeInTheDocument();
  });

  it.each<[DelegationAdoptView['state'], boolean, boolean]>([
    ['set', true, false],
    ['clear', false, true],
    ['unmeasurable', false, false],
  ])('the marker %s: on checked %s, off checked %s', (state, on, off) => {
    owned(view({ state }));
    expect(radio(T.on).checked).toBe(on);
    expect(radio(T.off).checked).toBe(off);
    if (state === 'unmeasurable') {
      expect(screen.getByText(T.unmeasured)).toBeInTheDocument();
      expect(radio(T.on).disabled).toBe(false);
    } else expect(screen.queryByText(T.unmeasured)).toBeNull();
  });

  it.each<DelegationAdoptionHealth['mode']>(['live', 'shadow', 'suspended', 'unmeasured'])('mode %s has its own line and its counts', (mode) => {
    const h = health({ mode, adopted: 4, wouldAdopt: 0, waiting: 5, unchanged: 6, unaudited: 7, conflicting: 8, unsupported: 9, uncensused: 10, owed: 11 });
    owned(view({ adoption: h }));
    expect(screen.getByText(delegationAdoptModeLine(h))).toBeInTheDocument();
    const counts = screen.getByText(delegationAdoptCountsLine(h)).textContent ?? '';
    for (const n of ['4', '5', '6', '7', '8', '9', '10', '11']) expect(counts).toContain(n);
  });

  // Item 131 (D-8114, PR8d): in mode unmeasured the counts line names no would-keep figure, as the sheet names none, and says
  // the card cannot say how many until the next pass. Mode unmeasured is the breaker unmeasured with the marker read (set or
  // clear) or the marker unreadable, so the row renders each. Shadow still names the figure, as its sheet does.
  it.each<DelegationAdoptView['state']>(['clear', 'set', 'unmeasurable'])('mode unmeasured, would keep 4, marker %s: the counts line names no would-keep figure and says the next pass will tell (item 131)', (state) => {
    owned(view({ state, adoption: health({ mode: 'unmeasured', adopted: 1, wouldAdopt: 4, waiting: 5, unchanged: 6 }) }));
    const counts = screen.getByText(/^Last pass:/).textContent ?? '';
    expect(counts).not.toMatch(/would keep 4/);
    expect(counts).not.toMatch(/\b4\b/);
    expect(counts).toMatch(/what turning this on would keep, this card cannot say how many until the next pass\./);
    for (const n of ['kept 1', 'waiting 5', 'unchanged 6']) expect(counts).toContain(n);
  });

  it('shadow, would keep 4: the counts line still names the figure, as the sheet does (item 131)', () => {
    owned(view({ adoption: health({ mode: 'shadow', wouldAdopt: 4 }) }));
    const counts = screen.getByText(/^Last pass:/).textContent ?? '';
    expect(counts).toContain('would keep 4');
    expect(counts).not.toMatch(/until the next pass/);
  });

  // Review 1727 F2: live and suspended are unchanged too, so their counts line still names the figure.
  it.each<DelegationAdoptionHealth['mode']>(['live', 'suspended'])('mode %s, would keep 4: the counts line still names the figure and says nothing of the next pass (item 131)', (mode) => {
    owned(view({ adoption: health({ mode, wouldAdopt: 4 }) }));
    const counts = screen.getByText(/^Last pass:/).textContent ?? '';
    expect(counts).toContain('would keep 4');
    expect(counts).not.toMatch(/until the next pass/);
  });

  it('the four modes read differently from one another', () => {
    const lines = (['live', 'shadow', 'suspended', 'unmeasured'] as const).map((mode) => delegationAdoptModeLine(health({ mode })));
    expect(new Set(lines).size).toBe(4);
  });

  it('a lane that has counted nothing says so, never that nothing would be kept', () => {
    owned(view({ adoption: null }));
    expect(screen.getByText(T.nothingCounted)).toBeInTheDocument();
    expect(screen.queryByText(delegationAdoptKeepsHeading('shadow'))).toBeNull();
    expect(T.nothingCounted).not.toMatch(/nothing would be kept|none/i);
  });

  it('a failed poll keeps the last reading and says it may be out of date', () => {
    render(<DelegationAdoptSection poll={{ view: view(), failure: 'failed', reload: vi.fn(() => 0), landed: 0, settle: vi.fn() }} />);
    expect(screen.getByText(T.stale)).toBeInTheDocument();
    expect(radio(T.off).checked).toBe(true);
  });

  it('an older server\'s 404 replaces the body with the one not-available line', async () => {
    vi.spyOn(api, 'delegationAdopt').mockRejectedValue(new ApiError(404, { ok: false, error: 'not-found' }));
    render(<Polled />);
    await waitFor(() => expect(screen.getByText(COLLECT_SECTION_TEXT.notAvailable)).toBeInTheDocument());
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('a failed first read says it could not be read', async () => {
    vi.spyOn(api, 'delegationAdopt').mockRejectedValue(new TypeError('failed to fetch'));
    render(<Polled />);
    await waitFor(() => expect(screen.getByText(T.unread)).toBeInTheDocument());
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('the two capabilities (D-8114)', () => {
  it.each<[DelegationAdoptView['caps']]>([
    [{ verb: 'present', audit: 'present' }],
    [{ verb: 'absent', audit: 'present' }],
    [{ verb: 'present', audit: 'absent' }],
    [{ verb: 'unmeasured', audit: 'unmeasured' }],
  ])('%j: one line for the switch, one for the change check', (caps) => {
    owned(view({ caps }));
    expect(screen.getByText(delegationAdoptCapLine('verb', caps.verb))).toBeInTheDocument();
    expect(screen.getByText(delegationAdoptCapLine('audit', caps.audit))).toBeInTheDocument();
  });

  it('present, absent and unmeasured are three different lines for each capability', () => {
    for (const which of ['verb', 'audit'] as const) {
      const lines = (['present', 'absent', 'unmeasured'] as const).map((c) => delegationAdoptCapLine(which, c));
      expect(new Set(lines).size).toBe(3);
    }
  });
});

describe('a refused choice says why and is disabled (D-8113)', () => {
  it.each(Object.keys(DELEGATION_ADOPT_REFUSALS) as (keyof typeof DELEGATION_ADOPT_REFUSALS)[])('on refused with %s: its sentence shows and on cannot be chosen', (word) => {
    owned(view({ refused: { on: word, off: null } }));
    expect(screen.getByText(delegationAdoptRefusedLine(T.on, word))).toBeInTheDocument();
    expect(radio(T.on).disabled).toBe(true);
    expect(radio(T.off).disabled).toBe(false);
    fireEvent.click(radio(T.on));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('off refused with fleet-switch-missing: off is disabled with its sentence too', () => {
    owned(view({ state: 'set', refused: { on: 'fleet-switch-missing', off: 'fleet-switch-missing' } }));
    expect(screen.getByText(delegationAdoptRefusedLine(T.off, 'fleet-switch-missing'))).toBeInTheDocument();
    expect(radio(T.off).disabled).toBe(true);
    expect(radio(T.on).disabled).toBe(true);
  });

  it('nothing refused: no refusal line and both choices open', () => {
    owned(view());
    expect(screen.queryByText(/is not available/)).toBeNull();
    expect(radio(T.on).disabled).toBe(false);
    expect(radio(T.off).disabled).toBe(false);
  });

  it('on refused with sign-in-unarmed (review 1665 N6): a dark server\'s view reads whole and the card shows the refusal in its own words', async () => {
    const dark = view({ refused: { on: 'sign-in-unarmed', off: null } });
    expect(asDelegationAdoptView(dark)).toEqual(dark);
    vi.spyOn(api, 'delegationAdopt').mockResolvedValue(dark);
    render(<Polled />);
    await waitFor(() => expect(screen.getByText(delegationAdoptRefusedLine(T.on, 'sign-in-unarmed'))).toBeInTheDocument());
    expect(REFUSAL['sign-in-unarmed']).toMatch(/sign-in/i);
    expect(radio(T.on).disabled).toBe(true);
    expect(radio(T.off).disabled).toBe(false);
    expect(radio(T.off).checked).toBe(true);
  });

  it('sign-in-unarmed is on\'s word only: off refused with it is no view at all, and each guard keeps its own words', () => {
    expect(asDelegationAdoptView({ ...view(), refused: { on: null, off: 'sign-in-unarmed' } })).toBeNull();
    for (const w of [...Object.keys(DELEGATION_ADOPT_REFUSALS), 'sign-in-unarmed']) expect(isDelegationAdoptOnRefusal(w), w).toBe(true);
    for (const w of ['nope', '', null, 403, 'confirm-required']) expect(isDelegationAdoptOnRefusal(w), String(w)).toBe(false);
    expect(isDelegationAdoptRefusal('sign-in-unarmed')).toBe(false);
  });

  it('each refusal word has its own sentence', () => {
    const sentences = Object.keys(DELEGATION_ADOPT_REFUSALS).map((w) => REFUSAL[w as keyof typeof REFUSAL]);
    expect(sentences.every((s) => s.length > 20)).toBe(true);
    expect(new Set(sentences).size).toBe(sentences.length);
  });
});

describe('the list of worktrees (D-8114)', () => {
  it('an item with changes, and one without: the project, the worktree and the parent show, one item each', () => {
    owned(view());
    expect(screen.getByText(delegationAdoptKeepsHeading('shadow'))).toBeInTheDocument();
    const [first, second] = screen.getAllByRole('listitem');
    expect(first).toHaveTextContent(delegationAdoptKeepLine(TWO[0]!));
    expect(first).toHaveTextContent('project-a');
    expect(first).toHaveTextContent('agent-a1');
    expect(first).toHaveTextContent('session-a');
    expect(first).toHaveTextContent(T.noChanges);
    for (const part of delegationAdoptKeepChanges(TWO[1]!.changes!)) expect(second).toHaveTextContent(part);
    expect(second).not.toHaveTextContent(T.noChanges);
  });

  it('a malformed list item, with no earlier view: the list is dropped as the shared reader drops it, and the switch stays drawn (review 1693 F1)', async () => {
    const bad = { ...view(), adoption: { ...health(), keeps: { items: [{ project: 1 }], more: 0 } } };
    expect(asDelegationAdoptView(bad)).toEqual(view({ adoption: health() }));
    vi.spyOn(api, 'delegationAdopt').mockResolvedValue(bad as unknown as DelegationAdoptView);
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    expect(radio(T.on)).toBeInTheDocument();
    expect(screen.getByText(delegationAdoptCountsLine(health()))).toBeInTheDocument();
    expect(screen.getByText(T.noList)).toBeInTheDocument();
    expect(screen.queryByText(T.unread)).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('an item is project, worktree, parent and changes, with no path (review 1665 N10): the reader reads it whole and nothing shows a path', async () => {
    expect(Object.keys(TWO[1]!).sort()).toEqual(['changes', 'parent', 'project', 'worktree']);
    expect(asDelegationAdoptView(view())).toEqual(view());
    vi.spyOn(api, 'delegationAdopt').mockResolvedValue(view());
    render(<Polled />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    for (const li of screen.getAllByRole('listitem')) expect(li).not.toHaveAttribute('title');
  });

  it('an item that still carries a path (the shared reader passes it through): shown nowhere, no title, no key (review 1693 F2)', () => {
    const SAME = '/work/project-a/worktrees/shared-path';
    const withPath = (k: DelegationAdoptionKeep): DelegationAdoptionKeep => ({ ...k, path: SAME } as DelegationAdoptionKeep);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const read = asDelegationAdoptView({ ...view(), adoption: health({ keeps: { items: TWO.map(withPath), more: 0 } }) });
    expect(read).not.toBeNull();
    owned(read!);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    for (const li of items) {
      expect(li).not.toHaveAttribute('title');
      expect(li.textContent).not.toContain(SAME);
    }
    expect(document.body.innerHTML).not.toContain(SAME);
    // Two items with one path: a list keyed on the path would warn of a duplicate key.
    expect(errors.mock.calls.map((c) => String(c[0])).filter((m) => /same key/i.test(m))).toEqual([]);
  });

  it('the changes read in words: uncommitted yes, no or unread; commits; the branch\'s three odd states', () => {
    const parts = (c: NonNullable<DelegationAdoptionKeep['changes']>): string => delegationAdoptKeepChanges(c).join(' | ');
    const dirty = parts({ dirty: true, aheadOfBase: 0, branchAheadOfBase: 0 });
    const clean = parts({ dirty: false, aheadOfBase: 0, branchAheadOfBase: 0 });
    const unread = parts({ dirty: 'unmeasured', aheadOfBase: 'unmeasured', branchAheadOfBase: 'unmeasured' });
    expect(new Set([dirty, clean, unread]).size).toBe(3);
    expect(parts({ dirty: false, aheadOfBase: 3, branchAheadOfBase: 4 })).toMatch(/3/);
    expect(parts({ dirty: false, aheadOfBase: 3, branchAheadOfBase: 4 })).toMatch(/4/);
    expect(parts({ dirty: false, aheadOfBase: 1, branchAheadOfBase: 'no-branch' })).toMatch(/no branch/i);
    expect(parts({ dirty: false, aheadOfBase: 1, branchAheadOfBase: 'branch-gone' })).toMatch(/gone/i);
    expect(parts({ dirty: false, aheadOfBase: 1, branchAheadOfBase: 'no-branch' }))
      .not.toBe(parts({ dirty: false, aheadOfBase: 1, branchAheadOfBase: 'branch-gone' }));
    expect(parts({ dirty: 'unmeasured', aheadOfBase: 1, branchAheadOfBase: 1 })).not.toBe(parts({ dirty: false, aheadOfBase: 1, branchAheadOfBase: 1 }));
    expect(parts({ dirty: false, aheadOfBase: 1, branchAheadOfBase: 1 })).toMatch(/1 commit\b/);
  });

  it('"and N more" shows only when more is above zero', () => {
    owned(view({ adoption: health({ keeps: { items: TWO, more: 7 } }) }));
    expect(screen.getByText(delegationAdoptKeepsMore(7))).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('no "more" line at zero, and a list the lane did not serve says that instead', () => {
    owned(view());
    expect(screen.queryByText(/^and \d+ more/)).toBeNull();
    cleanup();
    owned(view({ adoption: health() }));
    expect(screen.getByText(T.noList)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('the heading follows the mode: would keep in shadow, kept in live', () => {
    expect(delegationAdoptKeepsHeading('shadow')).not.toBe(delegationAdoptKeepsHeading('live'));
    expect(delegationAdoptKeepsHeading('shadow')).toMatch(/would/);
    expect(delegationAdoptKeepsHeading('live')).not.toMatch(/would/);
  });

  it('a list of the bound\'s size is drawn whole', () => {
    const items = Array.from({ length: DELEGATION_ADOPTION_KEEPS_MAX }, (_, i) => keep({ worktree: `agent-${i}` }));
    owned(view({ adoption: health({ keeps: { items, more: 3 } }) }));
    expect(screen.getAllByRole('listitem')).toHaveLength(DELEGATION_ADOPTION_KEEPS_MAX);
  });
});

describe('turning the switch on asks first (D-8114, ruling 5)', () => {
  it('tapping on opens the sheet with the count and the mail sentence, and sends nothing', async () => {
    vi.spyOn(api, 'delegationAdopt').mockResolvedValue(view());
    const set = vi.spyOn(api, 'setDelegationAdopt').mockResolvedValue(view({ state: 'set' }));
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    fireEvent.click(radio(T.on));
    const sheet = await screen.findByRole('dialog');
    const c = delegationAdoptConfirm(health({ keeps: { items: TWO, more: 0 } }));
    expect(within(sheet).getByText(c.title)).toBeInTheDocument();
    for (const line of c.consequence) expect(within(sheet).getByText(line)).toBeInTheDocument();
    expect(sheet.textContent).toContain('2 worktrees');
    expect(sheet.textContent).toMatch(/mail/i);
    expect(set, 'the tap alone must send nothing').not.toHaveBeenCalled();
    expect(radio(T.off).checked, 'the tap is not shown as landed').toBe(true);
  });

  // Review 1693 F8 (ruled): the sheet names the counts line's would-keep figure, list or no list, and says it cannot tell only
  // when the lane has counted nothing; with more than it lists, it says how many are listed and how many are not.
  const said = (a: DelegationAdoptionHealth | null): string => delegationAdoptConfirm(a).consequence.join(' ');
  it('would keep 0 with no list served: the sheet says 0, as the counts line does, and never that it cannot tell (F8)', () => {
    const a = health({ wouldAdopt: 0 });
    expect(said(a)).toMatch(/This would keep 0 worktrees\b/);
    expect(delegationAdoptCountsLine(a)).toContain('would keep 0');
    expect(said(a)).not.toContain(T.confirmCannotCount);
  });

  it('a served list: the figure is the last pass\'s would-keep count, and no "listed" sentence while nothing is left off (F8)', () => {
    expect(said(health({ wouldAdopt: 2, keeps: { items: TWO, more: 0 } }))).toMatch(/This would keep 2 worktrees\b/);
    expect(said(health({ wouldAdopt: 1, keeps: { items: [TWO[0]!], more: 0 } }))).toMatch(/This would keep 1 worktree\b/);
    expect(said(health({ wouldAdopt: 9, keeps: { items: TWO, more: 0 } }))).toMatch(/This would keep 9 worktrees\b/);
    expect(said(health({ wouldAdopt: 2, keeps: { items: TWO, more: 0 } }))).not.toMatch(/listed on this card/);
  });

  it('more above 0: the sheet says how many are listed on this card and how many are not, never "the ones listed" (F8)', () => {
    const s7 = said(health({ wouldAdopt: 7, keeps: { items: TWO, more: 5 } }));
    expect(s7).toMatch(/This would keep 7 worktrees\b/);
    expect(s7).toContain('2 are listed on this card and 5 are not');
    expect(s7).not.toMatch(/the ones listed/);
    expect(said(health({ wouldAdopt: 2, keeps: { items: [TWO[0]!], more: 1 } }))).toContain('1 is listed on this card and 1 is not');
  });

  it('adoption null: the sheet says it cannot tell how many, and still names the mail (F8)', () => {
    const c = delegationAdoptConfirm(null);
    expect(c.consequence.join(' ')).toContain(T.confirmCannotCount);
    expect(c.consequence.join(' ')).toMatch(/mail/i);
    expect(c.consequence.join(' ')).not.toMatch(/\d+ worktrees?/);
  });

  it('live, suspended: the last pass did not count what this would keep, so the sheet cannot tell until the next pass and lists nothing (review 1699 R2-4)', () => {
    for (const mode of ['live', 'suspended'] as const) {
      const s = said(health({ mode, adopted: 3, wouldAdopt: 0, keeps: { items: TWO, more: 5 } }));
      expect(s, mode).toContain(T.confirmUntilNextPass);
      expect(s, mode).not.toMatch(/listed on this card/);
      expect(s, mode).not.toMatch(/\d+ worktrees?/);
      expect(s, mode).toMatch(/mail/i);
    }
    expect(said(health({ mode: 'shadow', wouldAdopt: 7, keeps: { items: TWO, more: 5 } }))).toMatch(/This would keep 7 worktrees\b/);
  });

  it('unmeasured, would keep 4: the sheet says the last pass could not read everything it needs, names no figure and never says the pass did not count (review 1703 F4, review 1709 finding 4)', () => {
    const s = said(health({ mode: 'unmeasured', wouldAdopt: 4, keeps: { items: TWO, more: 2 } }));
    expect(s).toContain(T.confirmUnreadPass);
    // Mode unmeasured is the breaker unmeasured with the marker read, or the marker unreadable: neither the sheet nor the mode
    // line may say which one it was (review 1709 finding 4, ruled).
    expect(s).not.toMatch(/whether keeping was on/);
    const mode = delegationAdoptModeLine(health({ mode: 'unmeasured', wouldAdopt: 4 }));
    expect(mode).not.toMatch(/whether it keeps|whether keeping/);
    expect(mode).not.toMatch(/\b4\b/);
    expect(s).not.toMatch(/did not count/);
    expect(s).not.toMatch(/\d+ worktrees?|\b4\b/);
    expect(s).not.toMatch(/listed on this card/);
    expect(s).toMatch(/until the next pass/);
    expect(s).toMatch(/mail/i);
  });

  // Item 131 (PR8d): the sheet's two "cannot say" sentences are now built from the phrases the counts line shares, so this row
  // pins what the sheet renders, word for word as before the split, in modes unmeasured, live and suspended.
  it('the sheet\'s sentences outside shadow, word for word, after the phrases they share with the counts line were split out (item 131)', () => {
    const unread = 'The last pass could not read everything it needs, so this card cannot say how many until the next pass.';
    const uncounted = 'The last pass did not count what turning this on would keep, so this card cannot say how many until the next pass.';
    const mail = 'The session that started each agent is mailed about its worktree. A kept worktree stays held back from the disk '
      + 'sweep until its hold ends.';
    const sheet = (mode: DelegationAdoptionHealth['mode']): string[] => delegationAdoptConfirm(health({ mode, wouldAdopt: 4 })).consequence;
    expect(sheet('unmeasured')).toEqual([unread, mail]);
    expect(sheet('live')).toEqual([uncounted, mail]);
    expect(sheet('suspended')).toEqual([uncounted, mail]);
  });

  it('the words speak of the last pass and the mode, and a refusal of on speaks of on only (review 1699 R2-5, R2-6, R2-7)', () => {
    for (const w of [T.nothingCounted, T.confirmCannotCount]) {
      expect(w).not.toMatch(/since it started/);
      expect(w).toMatch(/last pass counted nothing/);
    }
    expect(delegationAdoptModeLine(health({ mode: 'live', adopted: 0 }))).not.toMatch(/kept worktrees/);
    expect(delegationAdoptModeLine(health({ mode: 'live' }))).toMatch(/at the last pass/);
    expect(REFUSAL['fleet-caps-unmeasured']).not.toMatch(/nothing can be changed/);
    expect(REFUSAL['fleet-caps-unmeasured']).toMatch(/cannot be turned on/);
  });

  it('the card\'s own sheet, would keep 0 and no list: it opens saying 0 worktrees (F8)', async () => {
    owned(view({ adoption: health({ wouldAdopt: 0 }) }));
    fireEvent.click(radio(T.on));
    const sheet = await screen.findByRole('dialog');
    expect(sheet.textContent).toMatch(/This would keep 0 worktrees/);
  });

  it('the sheet is open, a newer view refuses on, the operator confirms: nothing is sent, the sheet closes, the refusal shows (review 1693 F3)', async () => {
    const set = vi.spyOn(api, 'setDelegationAdopt').mockResolvedValue(view({ state: 'set' }));
    const { show } = owned(view());
    fireEvent.click(radio(T.on));
    const sheet = await screen.findByRole('dialog');
    show(view({ refused: { on: 'sign-in-unarmed', off: null } }));
    fireEvent.click(within(sheet).getByRole('button', { name: T.confirmLabel }));
    await flush();
    expect(set).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(delegationAdoptRefusedLine(T.on, 'sign-in-unarmed'))).toBeInTheDocument();
    expect(radio(T.off).checked).toBe(true);
  });

  it('Cancel sends nothing and leaves the card as it was', async () => {
    const set = vi.spyOn(api, 'setDelegationAdopt').mockResolvedValue(view({ state: 'set' }));
    owned(view());
    fireEvent.click(radio(T.on));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(set).not.toHaveBeenCalled();
    expect(radio(T.off).checked).toBe(true);
    expect(group()).not.toBeDisabled();
  });

  it('after the confirm and the settle, the focus is on the checked answer, never BODY (review 1693 F4)', async () => {
    vi.spyOn(api, 'delegationAdopt').mockResolvedValue(view());
    vi.spyOn(api, 'setDelegationAdopt').mockResolvedValue(view({ state: 'set' }));
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    await tapOnAndConfirm();
    await waitFor(() => expect(radio(T.on).checked).toBe(true));
    await flush();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(radio(T.on));
  });

  it('after the confirm and a refused write, the focus is inside the card, never BODY (review 1693 F4)', async () => {
    vi.spyOn(api, 'setDelegationAdopt').mockRejectedValue(new ApiError(409, { ok: false, error: 'fleet-audit-missing' }));
    owned(view());
    await tapOnAndConfirm();
    await flush();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(REFUSAL['fleet-audit-missing']));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(radio(T.off));
  });

  it('through the Settings frame (SettingsDataProvider, as shipped): after the confirm and the settle, the focus is the radio the new reading checks (review 1699 R2-1)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    vi.spyOn(api, 'delegationAdopt').mockResolvedValue(view());
    const w = deferred();
    vi.spyOn(api, 'setDelegationAdopt').mockReturnValue(w.promise);
    try {
      renderSettings('automation');
      await waitFor(() => expect(radio(T.off).checked).toBe(true));
      radio(T.on).focus();   // a tap focuses the radio it lands on; fireEvent.click does not
      await tapOnAndConfirm();
      await flush();
      await act(async () => { w.resolve(view({ state: 'set' })); });
      await waitFor(() => expect(radio(T.on).checked).toBe(true));
      await flush();
      expect(document.activeElement).toBe(radio(T.on));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('focus moved outside the card while the write is in flight stays there after the settle (review 1699 R2-2)', async () => {
    vi.spyOn(api, 'delegationAdopt').mockResolvedValue(view());
    const w = deferred();
    vi.spyOn(api, 'setDelegationAdopt').mockReturnValue(w.promise);
    render(<><Polled /><button type="button">elsewhere</button></>);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    await tapOnAndConfirm();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const elsewhere = screen.getByRole('button', { name: 'elsewhere' });
    elsewhere.focus();
    await act(async () => { w.resolve(view({ state: 'set' })); });
    await waitFor(() => expect(radio(T.on).checked).toBe(true));
    await flush();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('an answer after the bound makes no refocus request: a later reading moves nothing (review 1703 F2)', async () => {
    vi.useFakeTimers();
    const w = deferred();
    vi.spyOn(api, 'setDelegationAdopt').mockReturnValue(w.promise);
    const { show } = owned(view());
    fireEvent.click(radio(T.on));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: T.confirmLabel }));
    act(() => { vi.advanceTimersByTime(COORD_CONFIRM_MS); });
    expect(screen.getByRole('status')).toHaveTextContent(T.unconfirmed);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => { w.resolve(view({ state: 'set' })); });
    show(view({ state: 'set' }));
    await flush();
    expect(radio(T.on).checked).toBe(true);
    expect(document.activeElement).toBe(document.body);
  });

  it('a poll that shows the chosen reading while the write is in flight still ends in one refocus, on the radio (review 1703 F3)', async () => {
    const w = deferred();
    vi.spyOn(api, 'setDelegationAdopt').mockReturnValue(w.promise);
    const { show } = owned(view());
    await tapOnAndConfirm();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    (document.activeElement as HTMLElement | null)?.blur();   // a browser blurs the radio the held fieldset disables
    show(view({ state: 'set' }));
    await flush();
    expect(document.activeElement).toBe(radio(T.on));
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => { w.resolve(view({ state: 'set' })); });
    await flush();
    expect(document.activeElement, 'the answer after the reading refocused a second time').toBe(document.body);
  });

  it('a rejected write, then a re-read whose view refuses the reading\'s choice: the focus waits for that view and lands on a line with text, never on a radio it disables (review 1703 F6)', async () => {
    vi.spyOn(api, 'setDelegationAdopt').mockRejectedValue(new ApiError(500, { ok: false, error: 'internal' }));
    const poll: DelegationAdoptPoll = { view: view(), failure: null, reload: vi.fn(() => 7), landed: 6, settle: vi.fn() };
    const { rerender } = render(<DelegationAdoptSection poll={poll} />);
    await tapOnAndConfirm();
    await flush();
    await waitFor(() => expect(poll.reload).toHaveBeenCalledTimes(1));
    const refusing = view({ caps: { verb: 'absent', audit: 'present' }, refused: { on: 'fleet-switch-missing', off: 'fleet-switch-missing' } });
    rerender(<DelegationAdoptSection poll={{ ...poll, view: refusing, landed: 7 }} />);
    await flush();
    expect(radio(T.off).disabled).toBe(true);
    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(document.body);
    expect(active.tagName, 'the focus is on a radio the re-read disabled').not.toBe('INPUT');
    expect(active.textContent?.trim()).not.toBe('');
    expect(screen.getByRole('region', { name: T.title }).contains(active)).toBe(true);
  });

  // Review 1709 finding 2: a rejected write whose re-read CHANGES the reading. The same commit clears the result line, so the
  // focus must land on what that commit leaves: the refusal line or unmeasured note for the new reading, or an enabled radio.
  const card = (): HTMLElement => screen.getByRole('region', { name: T.title });
  const onATextLineInTheCard = async (): Promise<void> => {
    await flush();
    const active = document.activeElement as HTMLElement;
    expect(active, 'the focus fell to the page').not.toBe(document.body);
    expect(active.tagName, 'the focus is on a radio the re-read disabled').not.toBe('INPUT');
    expect(active.textContent?.trim()).not.toBe('');
    expect(card().contains(active)).toBe(true);
  };
  it('Do not keep rejected while keeping was on, then a re-read that reads it off with both choices refused: the focus is a line with text in the card, never BODY (review 1709 finding 2)', async () => {
    vi.spyOn(api, 'setDelegationAdopt').mockRejectedValue(new ApiError(500, { ok: false, error: 'internal' }));
    const poll: DelegationAdoptPoll = { view: view({ state: 'set' }), failure: null, reload: vi.fn(() => 7), landed: 6, settle: vi.fn() };
    const { rerender } = render(<DelegationAdoptSection poll={poll} />);
    radio(T.off).focus();
    fireEvent.click(radio(T.off));
    (document.activeElement as HTMLElement | null)?.blur();   // a browser blurs the radio the held fieldset disables
    await flush();
    await waitFor(() => expect(poll.reload).toHaveBeenCalledTimes(1));
    const refusing = view({ state: 'clear', caps: { verb: 'absent', audit: 'present' }, refused: { on: 'fleet-switch-missing', off: 'fleet-switch-missing' } });
    rerender(<DelegationAdoptSection poll={{ ...poll, view: refusing, landed: 7 }} />);
    expect(radio(T.off).checked).toBe(true);
    expect(radio(T.off).disabled).toBe(true);
    await onATextLineInTheCard();
  });

  it('Keep them rejected while the switch moved, then a re-read that reads it on with sign-in dark: the focus is a line with text in the card, never BODY (review 1709 finding 2, the other direction)', async () => {
    vi.spyOn(api, 'setDelegationAdopt').mockRejectedValue(new ApiError(500, { ok: false, error: 'internal' }));
    const poll: DelegationAdoptPoll = { view: view(), failure: null, reload: vi.fn(() => 7), landed: 6, settle: vi.fn() };
    const { rerender } = render(<DelegationAdoptSection poll={poll} />);
    await tapOnAndConfirm();
    await flush();
    await waitFor(() => expect(poll.reload).toHaveBeenCalledTimes(1));
    rerender(<DelegationAdoptSection poll={{ ...poll, view: view({ state: 'set', refused: { on: 'sign-in-unarmed', off: null } }), landed: 7 }} />);
    expect(radio(T.on).checked).toBe(true);
    expect(radio(T.on).disabled).toBe(true);
    await onATextLineInTheCard();
  });

  it('a request waiting for the reading Keep them was answered with is dropped when another reading arrives after it: a later poll that shows on moves nothing (review 1709 finding 3)', async () => {
    // jsdom has no exit animation, so the confirm sheet leaves at once; a stand-in dialog holds the focus instead, as the real
    // sheet does through its exit, and the card waits for it to leave exactly as it waits for its own sheet.
    const w = deferred();
    vi.spyOn(api, 'setDelegationAdopt').mockReturnValue(w.promise);
    const poll: DelegationAdoptPoll = { view: view(), failure: null, reload: vi.fn(() => 0), landed: 0, settle: vi.fn() };
    const standIn = document.createElement('div');
    standIn.setAttribute('role', 'dialog');
    const inside = document.createElement('button');
    inside.textContent = 'leaving';
    standIn.append(inside);
    const { rerender } = render(<DelegationAdoptSection poll={poll} />);
    fireEvent.click(radio(T.on));
    const sheet = await screen.findByRole('dialog');
    document.body.append(standIn);
    inside.focus();
    fireEvent.click(within(sheet).getByRole('button', { name: T.confirmLabel }));
    await act(async () => { w.resolve(view({ state: 'set' })); });
    rerender(<DelegationAdoptSection poll={{ ...poll, view: view({ state: 'set' }) }} />);   // the answer's view, inside the exit
    await flush();
    rerender(<DelegationAdoptSection poll={{ ...poll, view: view({ state: 'clear' }) }} />);   // another actor's off, inside the exit
    await flush();
    await act(async () => { standIn.remove(); await Promise.resolve(); });
    await flush();
    expect(document.activeElement).toBe(document.body);
    rerender(<DelegationAdoptSection poll={{ ...poll, view: view({ state: 'set' }), landed: 1 }} />);   // a later poll shows on
    await flush();
    expect(radio(T.on).checked).toBe(true);
    expect(document.activeElement, 'a later poll moved the focus').toBe(document.body);
  });

  it('once the refocus has fired it is spent: the focus moved back to the page stays there through a later poll (review 1709 finding 5)', async () => {
    vi.spyOn(api, 'setDelegationAdopt').mockResolvedValue(view({ state: 'set' }));
    const poll: DelegationAdoptPoll = { view: view(), failure: null, reload: vi.fn(() => 0), landed: 0, settle: vi.fn() };
    const { rerender } = render(<DelegationAdoptSection poll={poll} />);
    await tapOnAndConfirm();
    await flush();
    rerender(<DelegationAdoptSection poll={{ ...poll, view: view({ state: 'set' }) }} />);
    await flush();
    expect(document.activeElement).toBe(radio(T.on));
    (document.activeElement as HTMLElement | null)?.blur();
    rerender(<DelegationAdoptSection poll={{ ...poll, view: view({ state: 'set' }), landed: 1 }} />);
    await flush();
    expect(document.activeElement, 'the spent request fired again').toBe(document.body);
  });

  it('the refocus picks the radio the page shows checked when it fires, even before the card\'s effects have read the new view (review 1709 finding 6)', async () => {
    // The sheet's removal and a poll that changes the reading in ONE commit, outside act, as the real app commits them: the sheet
    // watch's MutationObserver runs in the microtask after that commit, before React flushes the card's passive effects.
    vi.spyOn(api, 'setDelegationAdopt').mockRejectedValue(new ApiError(500, { ok: false, error: 'internal' }));
    let hostSet: (s: { view: DelegationAdoptView; dialog: boolean }) => void = () => undefined;
    function Host(): ReactNode {
      const [s, setS] = useState<{ view: DelegationAdoptView; dialog: boolean }>({ view: view({ state: 'set' }), dialog: true });
      hostSet = setS;
      const poll: DelegationAdoptPoll = { view: s.view, failure: null, reload: () => 0, landed: 0, settle: () => undefined };
      return (
        <>
          <DelegationAdoptSection poll={poll} />
          {s.dialog && <div role="dialog"><button type="button">leaving</button></div>}
        </>
      );
    }
    render(<Host />);
    screen.getByRole('button', { name: 'leaving', hidden: true }).focus();
    fireEvent.click(radio(T.off));
    await flush();
    await flush();
    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const was = g.IS_REACT_ACT_ENVIRONMENT;
    g.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      hostSet({ view: view({ state: 'clear' }), dialog: false });
      await new Promise((done) => { setTimeout(done, 50); });
    } finally {
      g.IS_REACT_ACT_ENVIRONMENT = was;
    }
    expect(radio(T.off).checked).toBe(true);
    expect(document.activeElement, 'the focus is the radio of the reading before the poll').not.toBe(radio(T.on));
    expect(document.activeElement).toBe(radio(T.off));
  });

  it('a reply that reads the marker unmeasurable: the focus lands on a line with text (the unmeasured note), and no empty element is focusable (review 1699 R2-3)', async () => {
    vi.spyOn(api, 'delegationAdopt').mockResolvedValue(view());
    vi.spyOn(api, 'setDelegationAdopt').mockResolvedValue(view({ state: 'unmeasurable' }));
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    await tapOnAndConfirm();
    await waitFor(() => expect(screen.getByText(T.unmeasured)).toBeInTheDocument());
    await flush();
    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(document.body);
    expect(active.textContent?.trim()).not.toBe('');
    expect(active).toHaveTextContent(T.unmeasured);
    const card = screen.getByRole('region', { name: T.title });
    for (const el of card.querySelectorAll<HTMLElement>('[tabindex="-1"]')) expect(el.textContent?.trim(), el.outerHTML).not.toBe('');
  });

  it('confirming sends {on:true} once and the reply is what the card then shows', async () => {
    vi.spyOn(api, 'delegationAdopt').mockResolvedValue(view());
    const set = vi.spyOn(api, 'setDelegationAdopt').mockResolvedValue(view({ state: 'set' }));
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    await tapOnAndConfirm();
    await waitFor(() => expect(radio(T.on).checked).toBe(true));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ on: true });
    expect(screen.queryByRole('status')).toBeNull();
    expect(group()).not.toBeDisabled();
  });

  it('the sheet names the unmeasured card\'s tap too: an unread marker is not a licence to skip it', async () => {
    const set = vi.spyOn(api, 'setDelegationAdopt').mockResolvedValue(view({ state: 'set' }));
    owned(view({ state: 'unmeasurable' }));
    fireEvent.click(radio(T.on));
    await screen.findByRole('dialog');
    expect(set).not.toHaveBeenCalled();
  });

  it('a confirmed tap holds the choice until the answer lands, and a second tap asks nothing', async () => {
    const write = deferred();
    const set = vi.spyOn(api, 'setDelegationAdopt').mockReturnValue(write.promise);
    const { poll } = owned(view());
    await tapOnAndConfirm();
    expect(screen.getByRole('status')).toHaveTextContent(T.asked);
    expect(radio(T.off).checked, 'the tap is never shown as landed').toBe(true);
    expect(group()).toBeDisabled();
    fireEvent.click(radio(T.on));
    expect(set).toHaveBeenCalledTimes(1);
    await act(async () => { write.resolve(view({ state: 'set' })); await write.promise; });
    expect(poll.settle).toHaveBeenCalledWith(view({ state: 'set' }));
    expect(screen.queryByText(T.asked)).toBeNull();
    expect(group()).not.toBeDisabled();
  });

  it('an answer that does not read what the tap asked says so, and settles on what it reads', async () => {
    vi.spyOn(api, 'setDelegationAdopt').mockResolvedValue(view());
    const { poll } = owned(view());
    await tapOnAndConfirm();
    await flush();
    expect(poll.settle).toHaveBeenCalledWith(view());
    expect(screen.getByRole('status')).toHaveTextContent(T.unconfirmed);
    expect(radio(T.off).checked).toBe(true);
  });

  it('no answer within the bound says so, keeps the last reading, frees the choice and re-reads', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'setDelegationAdopt').mockReturnValue(deferred().promise);
    const { poll } = owned(view());
    fireEvent.click(radio(T.on));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: T.confirmLabel }));
    act(() => { vi.advanceTimersByTime(COORD_CONFIRM_MS - 1); });
    expect(group()).toBeDisabled();
    expect(poll.reload).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('status')).toHaveTextContent(T.unconfirmed);
    expect(radio(T.off).checked).toBe(true);
    expect(group()).not.toBeDisabled();
    expect(poll.reload).toHaveBeenCalledTimes(1);
  });

  it('a reply it cannot read says it may have saved, and re-reads', async () => {
    vi.spyOn(api, 'setDelegationAdopt').mockResolvedValue('unreadable');
    const { poll } = owned(view());
    await tapOnAndConfirm();
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent(UNCONFIRMED_TEXT);
    expect(poll.reload).toHaveBeenCalledTimes(1);
    expect(poll.settle).not.toHaveBeenCalled();
  });
});

describe('turning the switch off asks nothing (D-8114)', () => {
  it('off goes out as {on:false} at once, with no sheet', async () => {
    vi.spyOn(api, 'delegationAdopt').mockResolvedValue(view({ state: 'set' }));
    const set = vi.spyOn(api, 'setDelegationAdopt').mockResolvedValue(view());
    render(<Polled />);
    await waitFor(() => expect(radio(T.on).checked).toBe(true));
    fireEvent.click(radio(T.off));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ on: false });
  });

  it('its note says off stops new keeps and that worktrees already kept keep their hold until it ends', () => {
    owned(view());
    expect(T.offNote).toMatch(/new/i);
    expect(T.offNote).toMatch(/already kept/i);
    expect(T.offNote).toMatch(/until (their|its) hold ends/i);
    expect(screen.getByText(T.offNote)).toBeInTheDocument();
  });
});

describe('a refused write says why, in the card\'s own words (D-8113)', () => {
  it.each(Object.entries(DELEGATION_ADOPT_REFUSALS) as [keyof typeof DELEGATION_ADOPT_REFUSALS, number][])('a %s reply (%i) shows its sentence and re-reads', async (word, status) => {
    vi.spyOn(api, 'setDelegationAdopt').mockRejectedValue(new ApiError(status, { ok: false, error: word, detail: 'server detail that names internals' }));
    const { poll } = owned(view());
    await tapOnAndConfirm();
    await flush();
    const line = screen.getByRole('status');
    expect(line).toHaveTextContent(REFUSAL[word]);
    expect(line.textContent).not.toContain('server detail');
    expect(poll.reload).toHaveBeenCalledTimes(1);
    expect(radio(T.off).checked).toBe(true);
    expect(group()).not.toBeDisabled();
  });

  it('a sign-in-unarmed reply (403) to on shows the card\'s own sentence, not the ccd write reader\'s (review 1665 N6)', async () => {
    vi.spyOn(api, 'setDelegationAdopt').mockRejectedValue(new ApiError(403, { ok: false, error: 'sign-in-unarmed' }));
    owned(view());
    await tapOnAndConfirm();
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent(REFUSAL['sign-in-unarmed']);
    expect(delegationAdoptFailure(new ApiError(403, { ok: false, error: 'sign-in-unarmed' })).tone).toBe('refusal');
  });

  it('a bad-request or ccd failure falls back to the ccd write reader\'s refusal line', async () => {
    vi.spyOn(api, 'setDelegationAdopt').mockRejectedValue(new ApiError(502, { ok: false, error: 'fleetFailed', stderr: 'verb died' }));
    owned(view());
    await tapOnAndConfirm();
    await flush();
    expect(screen.getByRole('status').textContent).toContain(T.refused);
  });

  it('a network failure is unanswered, never a refusal', async () => {
    vi.spyOn(api, 'setDelegationAdopt').mockRejectedValue(new TypeError('failed to fetch'));
    owned(view());
    await tapOnAndConfirm();
    await flush();
    expect(screen.getByRole('status').textContent).toBe(T.unanswered);
  });

  it('delegationAdoptFailure speaks the refusal in a refusal tone, and anything else as an answer', () => {
    const f = delegationAdoptFailure(new ApiError(409, { ok: false, error: 'fleet-audit-missing' }));
    expect(f).toEqual({ text: REFUSAL['fleet-audit-missing'], tone: 'refusal' });
    expect(delegationAdoptFailure(new TypeError('x')).tone).toBe('answer');
  });
});

describe('delegationAdoptWords: the wire guard and the radio', () => {
  it('reads a whole view, and nothing else', () => {
    expect(asDelegationAdoptView(view())).toEqual(view());
    expect(asDelegationAdoptView({ ok: true, ...view() })).toEqual(view());
    expect(asDelegationAdoptView(view({ adoption: null }))).toEqual(view({ adoption: null }));
    const bads: unknown[] = [
      null, {}, { ...view(), state: 'on' }, { ...view(), caps: { verb: 'yes', audit: 'present' } }, { ...view(), caps: null },
      { ...view(), refused: { on: 'nope', off: null } }, { ...view(), refused: { on: null } },
      { ...view(), adoption: { mode: 'weird' } }, { ...view(), adoption: 3 },
    ];
    for (const bad of bads) expect(asDelegationAdoptView(bad)).toBeNull();
    // A list `keeps`' one reader refuses is dropped, never the view (review 1693 F1).
    for (const keeps of [{ items: [{ project: 1 }], more: 0 }, { items: [], more: 'x' }, 'x']) {
      expect(asDelegationAdoptView({ ...view(), adoption: { ...health(), keeps } }), JSON.stringify(keeps)).toEqual(view({ adoption: health() }));
    }
  });
  it('only a measured marker checks a radio', () => {
    expect(delegationAdoptChecked(view({ state: 'set' }))).toBe('on');
    expect(delegationAdoptChecked(view({ state: 'clear' }))).toBe('off');
    expect(delegationAdoptChecked(view({ state: 'unmeasurable' }))).toBeNull();
  });
});

describe('WORDS CENSUS (W4-U10, D-7845): the card says keep, kept and the change check, never the broker\'s words', () => {
  const strings = (vs: readonly unknown[]): string[] => {
    const out: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === 'string') out.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) collect(x);
    };
    vs.forEach(collect);
    return out;
  };
  it('no exported string, and no string an exported function returns, carries a banned word', () => {
    const exported = Object.fromEntries(Object.entries(words).filter(([, v]) => typeof v !== 'function'));
    const modes = ['live', 'shadow', 'suspended', 'unmeasured'] as const;
    const caps = ['present', 'absent', 'unmeasured'] as const;
    const changes: NonNullable<DelegationAdoptionKeep['changes']>[] = [
      { dirty: true, aheadOfBase: 2, branchAheadOfBase: 1 }, { dirty: false, aheadOfBase: 0, branchAheadOfBase: 0 },
      { dirty: 'unmeasured', aheadOfBase: 'unmeasured', branchAheadOfBase: 'unmeasured' },
      { dirty: false, aheadOfBase: 1, branchAheadOfBase: 'no-branch' }, { dirty: false, aheadOfBase: 1, branchAheadOfBase: 'branch-gone' },
    ];
    const all = strings([
      exported,
      ...modes.map((mode) => [delegationAdoptModeLine(health({ mode })), delegationAdoptCountsLine(health({ mode })), delegationAdoptKeepsHeading(mode)]),
      delegationAdoptModeLine(null),
      ...(['verb', 'audit'] as const).flatMap((w) => caps.map((c) => delegationAdoptCapLine(w, c))),
      delegationAdoptRefusedLine(T.on, 'sign-in-unarmed'),
      ...Object.keys(DELEGATION_ADOPT_REFUSALS).flatMap((w) => [
        delegationAdoptRefusedLine(T.on, w as keyof typeof DELEGATION_ADOPT_REFUSALS),
        delegationAdoptRefusedLine(T.off, w as keyof typeof DELEGATION_ADOPT_REFUSALS),
        delegationAdoptFailure(new ApiError(409, { ok: false, error: w })),
      ]),
      delegationAdoptFailure(new TypeError('x')),
      delegationAdoptFailure(new ApiError(502, { ok: false, error: 'fleetFailed', stderr: 's' })),
      delegationAdoptKeepLine(keep()), ...changes.map((c) => delegationAdoptKeepChanges(c)),
      delegationAdoptKeepsMore(1), delegationAdoptKeepsMore(9),
      delegationAdoptConfirm(null), delegationAdoptConfirm(health()), delegationAdoptConfirm(health({ keeps: { items: TWO, more: 0 } })),
      delegationAdoptConfirm(health({ wouldAdopt: 5, keeps: { items: [TWO[0]!], more: 4 } })),
    ]);
    expect(all.length).toBeGreaterThan(40);
    for (const s of all) {
      expect(s, s).not.toMatch(/lease|adopt|retain|clean|spool/i);
      expect(s, s).not.toMatch(/running|\bactive\b|recent|\bnow\b/i);
    }
  });

  it('names neither a path nor a marker nor a verb in its words', () => {
    for (const word of Object.values(T)) expect(word).not.toMatch(/-live|-paused|\/|~|\$REG|--state|ccd /);
  });

  it('the refusal table is total over the door\'s words and on\'s own sign-in-unarmed (review 1665 N6)', () => {
    expect(Object.keys(REFUSAL).sort()).toEqual([...Object.keys(DELEGATION_ADOPT_REFUSALS), 'sign-in-unarmed'].sort());
    for (const w of Object.keys(REFUSAL)) expect(isDelegationAdoptOnRefusal(w), w).toBe(true);
  });
});
