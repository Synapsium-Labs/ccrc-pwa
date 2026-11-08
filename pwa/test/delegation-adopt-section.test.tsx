// D-8114 (delegation broker wave 5 PR8b): Settings › Automation › "Worktrees left behind". The card reads the lane's
// keep switch through its own hook (as the Settings frame hands it one) and writes `{on}`; every case spies
// `api.delegationAdopt` and `api.setDelegationAdopt`, or hands the card a poll of its own, and renders the card alone.
// Every word is `DELEGATION_ADOPT_TEXT` (or one of its functions), read by name. Turning the switch ON asks first, in a
// confirm sheet that names how many worktrees it would keep; nothing is sent before the confirm.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DelegationAdoptionHealth, DelegationAdoptionKeep } from '../../shared/api';
import { DELEGATION_ADOPTION_KEEPS_MAX } from '../../shared/api';
import { DELEGATION_ADOPT_REFUSALS, type DelegationAdoptView } from '../../shared/delegation-adopt';
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
  project: 'project-a', worktree: 'agent-a1', path: '/work/project-a/worktrees/agent-a1', parent: 'session-a', ...over,
});
const TWO = [
  keep(),
  keep({
    worktree: 'agent-b2', path: '/work/project-b/worktrees/agent-b2', parent: 'session-b', project: 'project-b',
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
  const poll: DelegationAdoptPoll = { view: first, failure: null, reload: vi.fn(), settle: vi.fn() };
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
    render(<DelegationAdoptSection poll={{ view: view(), failure: 'failed', reload: vi.fn(), settle: vi.fn() }} />);
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
    expect(screen.queryByText(/is not available now/)).toBeNull();
    expect(radio(T.on).disabled).toBe(false);
    expect(radio(T.off).disabled).toBe(false);
  });

  it('each refusal word has its own sentence', () => {
    const sentences = Object.keys(DELEGATION_ADOPT_REFUSALS).map((w) => REFUSAL[w as keyof typeof REFUSAL]);
    expect(sentences.every((s) => s.length > 20)).toBe(true);
    expect(new Set(sentences).size).toBe(sentences.length);
  });
});

describe('the list of worktrees (D-8114)', () => {
  it('an item with changes, and one without: the project, the worktree and the parent show, and the path is the title', () => {
    owned(view());
    expect(screen.getByText(delegationAdoptKeepsHeading('shadow'))).toBeInTheDocument();
    const first = screen.getByTitle(TWO[0]!.path);
    expect(first).toHaveTextContent(delegationAdoptKeepLine(TWO[0]!));
    expect(first).toHaveTextContent('project-a');
    expect(first).toHaveTextContent('agent-a1');
    expect(first).toHaveTextContent('session-a');
    expect(first).toHaveTextContent(T.noChanges);
    const second = screen.getByTitle(TWO[1]!.path);
    for (const part of delegationAdoptKeepChanges(TWO[1]!.changes!)) expect(second).toHaveTextContent(part);
    expect(second).not.toHaveTextContent(T.noChanges);
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
    const items = Array.from({ length: DELEGATION_ADOPTION_KEEPS_MAX }, (_, i) => keep({ worktree: `agent-${i}`, path: `/work/p/agent-${i}` }));
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
    const c = delegationAdoptConfirm({ items: TWO, more: 0 });
    expect(within(sheet).getByText(c.title)).toBeInTheDocument();
    for (const line of c.consequence) expect(within(sheet).getByText(line)).toBeInTheDocument();
    expect(sheet.textContent).toContain('2 worktrees');
    expect(sheet.textContent).toMatch(/mail/i);
    expect(set, 'the tap alone must send nothing').not.toHaveBeenCalled();
    expect(radio(T.off).checked, 'the tap is not shown as landed').toBe(true);
  });

  it('the count is the items plus the ones more', () => {
    const c = delegationAdoptConfirm({ items: TWO, more: 5 });
    expect(c.consequence.join(' ')).toContain('7 worktrees');
    expect(delegationAdoptConfirm({ items: [TWO[0]!], more: 0 }).consequence.join(' ')).toMatch(/1 worktree\b/);
    expect(delegationAdoptConfirm({ items: [], more: 0 }).consequence.join(' ')).toMatch(/0 worktrees|no worktree/i);
  });

  it('without a list the sheet says it cannot tell how many, and still names the mail', () => {
    const c = delegationAdoptConfirm(null);
    expect(c.consequence.join(' ')).toContain(T.confirmCannotCount);
    expect(c.consequence.join(' ')).toMatch(/mail/i);
    expect(c.consequence.join(' ')).not.toMatch(/\d+ worktrees?/);
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
      { ...view(), adoption: { ...health(), keeps: { items: [{ project: 1 }], more: 0 } } },
      { ...view(), adoption: { ...health(), keeps: { items: [], more: 'x' } } },
    ];
    for (const bad of bads) expect(asDelegationAdoptView(bad)).toBeNull();
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
      ...Object.keys(DELEGATION_ADOPT_REFUSALS).flatMap((w) => [
        delegationAdoptRefusedLine(T.on, w as keyof typeof DELEGATION_ADOPT_REFUSALS),
        delegationAdoptRefusedLine(T.off, w as keyof typeof DELEGATION_ADOPT_REFUSALS),
        delegationAdoptFailure(new ApiError(409, { ok: false, error: w })),
      ]),
      delegationAdoptFailure(new TypeError('x')),
      delegationAdoptFailure(new ApiError(502, { ok: false, error: 'fleetFailed', stderr: 's' })),
      delegationAdoptKeepLine(keep()), ...changes.map((c) => delegationAdoptKeepChanges(c)),
      delegationAdoptKeepsMore(1), delegationAdoptKeepsMore(9),
      delegationAdoptConfirm(null), delegationAdoptConfirm({ items: TWO, more: 0 }), delegationAdoptConfirm({ items: [TWO[0]!], more: 4 }),
    ]);
    expect(all.length).toBeGreaterThan(40);
    for (const s of all) {
      expect(s, s).not.toMatch(/lease|adopt|retain|clean|spool/i);
      expect(s, s).not.toMatch(/running|\bactive\b|recent/i);
    }
  });

  it('names neither a path nor a marker nor a verb in its words', () => {
    for (const word of Object.values(T)) expect(word).not.toMatch(/-live|-paused|\/|~|\$REG|--state|ccd /);
  });

  it('the refusal table is total over the door\'s words', () => {
    expect(Object.keys(REFUSAL).sort()).toEqual(Object.keys(DELEGATION_ADOPT_REFUSALS).sort());
  });
});
