// The held-rows list (cleanup un-wedge R2): one line per row holding the cleanup, each with its own control — ONE
// tap, then a confirm. Forget only for a gone-unrecorded row the server says forget for; every other case re-checks.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { CleanupHeldByItem } from '../../shared/api';
import { HeldByRows } from '../src/fleet/HeldByRows';
import {
  CLEANUP_HELD_BY_LABEL, CLEANUP_HELD_BY_RECHECKED, heldByRowControl, heldByRowsOf, heldByRowWhyNotForget,
} from '../src/fleet/heldByRowsWords';
import { ApiError, api } from '../src/lib/api';
import { ToastHost } from '@ccrc/ui';
import { labelInName, shownText } from './labelInName';
import { deadSession, fleetSession, hibernatedSession } from './fleetFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const held = (over: Partial<CleanupHeldByItem> = {}): CleanupHeldByItem => ({
  rowId: 'row-a', word: 'gone-unrecorded', sentence: 'Its workspace is gone and nothing records it.',
  holds: { reclaim: 3, expire: 0, collect: 1 }, act: 'forget', ...over,
});
const PACE = 'usually within minutes for a new hold; a few hours or more for what has been failing a long time; longer when many items are held';
const PAUSED = 'ccrc reads nothing again while the cleanup is paused.';
const frame = (list: unknown): unknown => ({ pause: 'clear', mail: 'clear', cleanupHeldBy: list });
/** The rows these cases name, each listed dead with no workspace and not asleep: the session sheet's Forget check. */
const DEAD = ['row-a', 'row-b', 'acct-a-demo', 'acct-b-demo'].map((id) => deadSession({ id }));
const confirmBtn = (): HTMLElement => {
  const b = document.querySelector('.qc-actions .btn-primary');
  if (b === null) throw new Error('no confirm open');
  return b as HTMLElement;
};

describe('the held-rows list', () => {
  it('one line per row, with its word and the server\'s sentence', () => {
    render(<HeldByRows sessions={DEAD} coord={frame([held(), held({ rowId: 'row-b', word: 'not-plain', act: 'recheck', sentence: 'Not a plain checkout.' })])} />);
    const list = screen.getByLabelText(CLEANUP_HELD_BY_LABEL);
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('row-a · gone-unrecorded')).toBeInTheDocument();
    expect(within(list).getByText('Its workspace is gone and nothing records it.')).toBeInTheDocument();
    expect(within(list).getByText('row-b · not-plain')).toBeInTheDocument();
    expect(within(list).getByText('Not a plain checkout.')).toBeInTheDocument();
  });

  it('nothing renders for an absent field', () => {
    const { container } = render(<HeldByRows sessions={DEAD} coord={{ pause: 'clear', mail: 'clear' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a malformed member is dropped alone', () => {
    const coord = frame([
      held(), { rowId: 7 }, held({ rowId: 'bad/id' }), held({ word: 'nope' as never }),
      { ...held({ rowId: 'row-b' }), sentence: 4 }, { ...held({ rowId: 'row-c' }), holds: null },
      { ...held({ rowId: 'row-d' }), holds: { reclaim: -1, expire: 0, collect: 0 } },
      held({ rowId: 'row-e', act: 'stop' as never }), null, 'x',
    ]);
    expect(heldByRowsOf(coord).map((i) => i.rowId)).toEqual(['row-a']);
  });

  it('heldByRowsOf answers [] for an absent field, never undefined', () => {
    expect(heldByRowsOf({ pause: 'clear' })).toEqual([]);
    expect(heldByRowsOf(null)).toEqual([]);
    expect(heldByRowsOf(frame('nope'))).toEqual([]);
  });

  it('forget is offered only for gone-unrecorded with act forget', () => {
    expect(heldByRowControl(held(), DEAD[0])).toBe('forget');
    expect(heldByRowControl(held({ word: 'not-plain', act: 'forget' }), DEAD[0])).toBe('recheck');
    expect(heldByRowControl(held({ act: 'recheck' }), DEAD[0])).toBe('recheck');
    render(<HeldByRows sessions={DEAD} coord={frame([held({ word: 'not-plain', act: 'forget' })])} />);
    expect(screen.getByRole('button', { name: 'Check again — row-a…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /forget/i })).toBeNull();
  });

  it('a recheck line offers Check again', () => {
    render(<HeldByRows sessions={DEAD} coord={frame([held({ act: 'recheck' })])} />);
    expect(screen.getByRole('button', { name: 'Check again — row-a…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /forget/i })).toBeNull();
  });

  it('the tap opens the confirm and sends nothing', () => {
    const forget = vi.fn().mockResolvedValue(undefined);
    render(<HeldByRows sessions={DEAD} coord={frame([held()])} forget={forget} />);
    expect(document.querySelector('.qc-actions')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Forget row row-a…' }));
    expect(document.querySelector('.qc-actions')).not.toBeNull();
    expect(forget).not.toHaveBeenCalled();
  });

  it('the confirm names the row and what will happen', () => {
    render(<HeldByRows sessions={DEAD} coord={frame([held()])} forget={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget row row-a…' }));
    expect(screen.getByText('Forget row-a?')).toBeInTheDocument();
    expect(screen.getByText(/Only the registry entry of row-a is removed/)).toBeInTheDocument();
    expect(screen.getByText(/transcript and any pasted images stay/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`when ccrc next checks what this row holds: ${PACE}\\. ${PAUSED}`))).toBeInTheDocument();
    expect(screen.queryByText(/next pass|once a minute/)).toBeNull();
  });

  it('confirming forget sends the act with the row id the server named', async () => {
    const forget = vi.fn().mockResolvedValue(undefined);
    render(<HeldByRows sessions={DEAD} coord={frame([held({ rowId: 'row-a' }), held({ rowId: 'row-b' })])} forget={forget} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget row row-b…' }));
    expect(screen.getByText('Forget row-b?')).toBeInTheDocument();
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(forget).toHaveBeenCalledTimes(1));
    expect(forget).toHaveBeenCalledWith('row-b');
  });

  it('confirming check again sends nothing and shows the checked-again note', () => {
    const forget = vi.fn().mockResolvedValue(undefined);
    render(<HeldByRows sessions={DEAD} coord={frame([held({ act: 'recheck', word: 'under-proc' })])} forget={forget} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check again — row-a…' }));
    expect(screen.getByText('Check row-a again?')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent and nothing changes for row-a/)).toBeInTheDocument();
    fireEvent.click(confirmBtn());
    expect(forget).not.toHaveBeenCalled();
    expect(screen.getByText(CLEANUP_HELD_BY_RECHECKED)).toBeInTheDocument();
  });

  it('a refused forget goes to the toast', async () => {
    const forget = vi.fn().mockRejectedValue(new ApiError(502, { ok: false, stderr: 'is-a-workspace' }));
    render(<><HeldByRows sessions={DEAD} coord={frame([held()])} forget={forget} /><ToastHost /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Forget row row-a…' }));
    fireEvent.click(confirmBtn());
    expect(await screen.findByText(/Couldn't forget — is-a-workspace/)).toBeInTheDocument();
  });

  it('each button names its row', () => {
    render(<HeldByRows sessions={DEAD} coord={frame([held(), held({ rowId: 'row-b', act: 'recheck' })])} />);
    expect(screen.getByRole('button', { name: 'Forget row row-a…' })).toHaveTextContent('Forget row…');
    expect(screen.getByRole('button', { name: 'Check again — row-b…' })).toHaveTextContent('Check again…');
  });

  it('check again names the real pace and never once a minute', () => {
    render(<HeldByRows sessions={DEAD} coord={frame([held({ act: 'recheck' })])} forget={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check again — row-a…' }));
    expect(screen.getByText(new RegExp(`ccrc reads this row again when it next checks what it holds: ${PACE}\\. ${PAUSED}`))).toBeInTheDocument();
    fireEvent.click(confirmBtn());
    expect(screen.getByText(CLEANUP_HELD_BY_RECHECKED)).toHaveTextContent(PACE);
    expect(screen.getByText(CLEANUP_HELD_BY_RECHECKED)).toHaveTextContent(PAUSED);
    expect(screen.queryByText(/once a minute|next pass/)).toBeNull();
    // Review 1590 N-a: the confirm says it re-reads the latest status, so its pause clause never says nothing is re-read.
    expect(screen.queryByText(/Nothing is re-read/)).toBeNull();
  });

  it('a forget act on another word confirms as a check again and calls no api at all', () => {
    const spies = Object.entries(api).filter(([, v]) => typeof v === 'function')
      .map(([k]) => vi.spyOn(api as unknown as Record<string, () => unknown>, k).mockResolvedValue(undefined));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    expect(spies.length).toBeGreaterThan(10);
    render(<HeldByRows sessions={DEAD} coord={frame([held({ word: 'not-plain', act: 'forget' })])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check again — row-a…' }));
    expect(screen.getByText('Check row-a again?')).toBeInTheDocument();
    expect(screen.queryByText(/Forget row-a\?/)).toBeNull();
    fireEvent.click(confirmBtn());
    expect(screen.getByText(CLEANUP_HELD_BY_RECHECKED)).toBeInTheDocument();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('check again calls no api at all, through the default forget too', () => {
    const spies = Object.entries(api).filter(([, v]) => typeof v === 'function')
      .map(([k]) => vi.spyOn(api as unknown as Record<string, () => unknown>, k).mockResolvedValue(undefined));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    render(<HeldByRows sessions={DEAD} coord={frame([held({ act: 'recheck', word: 'under-proc' })])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check again — row-a…' }));
    fireEvent.click(confirmBtn());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a successful forget is toasted', async () => {
    const forget = vi.fn().mockResolvedValue(undefined);
    render(<><HeldByRows sessions={DEAD} coord={frame([held()])} forget={forget} /><ToastHost /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Forget row row-a…' }));
    fireEvent.click(confirmBtn());
    const t = await screen.findByText(/Forgot row-a\. The line clears as each item it held is checked again/);
    expect(t).toHaveTextContent(PACE);
    expect(t).toHaveTextContent(PAUSED);
  });

  it('the confirm does not reopen by itself when its row leaves and returns', () => {
    const { rerender } = render(<HeldByRows sessions={DEAD} coord={frame([held()])} forget={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget row row-a…' }));
    expect(document.querySelector('.qc-actions')).not.toBeNull();
    rerender(<HeldByRows sessions={DEAD} coord={frame([])} forget={vi.fn()} />);
    expect(document.querySelector('.qc-actions')).toBeNull();
    rerender(<HeldByRows sessions={DEAD} coord={frame([held()])} forget={vi.fn()} />);
    expect(document.querySelector('.qc-actions')).toBeNull();
  });

  it('the checked-again note clears when a new frame changes that row\'s line', () => {
    const line = held({ act: 'recheck', word: 'under-proc' });
    const { rerender } = render(<HeldByRows sessions={DEAD} coord={frame([line])} forget={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check again — row-a…' }));
    fireEvent.click(confirmBtn());
    expect(screen.getByText(CLEANUP_HELD_BY_RECHECKED)).toBeInTheDocument();
    rerender(<HeldByRows sessions={DEAD} coord={frame([{ ...line }])} forget={vi.fn()} />);
    expect(screen.getByText(CLEANUP_HELD_BY_RECHECKED), 'the same line keeps its note').toBeInTheDocument();
    rerender(<HeldByRows sessions={DEAD} coord={frame([{ ...line, holds: { reclaim: 2, expire: 0, collect: 1 } }])} forget={vi.fn()} />);
    expect(screen.queryByText(CLEANUP_HELD_BY_RECHECKED)).toBeNull();
  });

  // Review 1590 N-h: a changed accessible name already fails the exact-name query above the `labelInName` line, so
  // that line guards the other mutation: the VISIBLE text changed and the name left as it was (mutants Nh-forget-text
  // and Nh-recheck-text, Task C15).
  it('each button keeps its visible words as one run in its name, for a multi-word id (D-7897)', () => {
    render(<HeldByRows sessions={DEAD} coord={frame([held({ rowId: 'acct-a-demo' }), held({ rowId: 'acct-b-demo', act: 'recheck' })])} />);
    const forget = screen.getByRole('button', { name: 'Forget row acct-a-demo…' });
    const recheck = screen.getByRole('button', { name: 'Check again — acct-b-demo…' });
    for (const b of [forget, recheck]) {
      const name = b.getAttribute('aria-label') ?? '';
      expect(labelInName(shownText(b), name), `"${shownText(b)}" in "${name}"`).toBe(true);
    }
  });

  it('a frame that flips recheck to forget under an open Check again closes it and calls no api', () => {
    const spies = Object.entries(api).filter(([, v]) => typeof v === 'function')
      .map(([k]) => vi.spyOn(api as unknown as Record<string, () => unknown>, k).mockResolvedValue(undefined));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const { rerender } = render(<HeldByRows sessions={DEAD} coord={frame([held({ act: 'recheck' })])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check again — row-a…' }));
    expect(screen.getByText('Check row-a again?')).toBeInTheDocument();
    rerender(<HeldByRows sessions={DEAD} coord={frame([held({ act: 'forget' })])} />);
    expect(document.querySelector('.qc-actions'), 'the dialog closed').toBeNull();
    expect(screen.queryByText('Forget row-a?')).toBeNull();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    rerender(<HeldByRows sessions={DEAD} coord={frame([held({ act: 'recheck' })])} />);
    expect(document.querySelector('.qc-actions'), 'it does not reopen').toBeNull();
  });

  it('a checked-again note is dropped when the line differs, and does not return with the old line', () => {
    const line = held({ act: 'recheck', word: 'under-proc' });
    const { rerender } = render(<HeldByRows sessions={DEAD} coord={frame([line])} forget={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check again — row-a…' }));
    fireEvent.click(confirmBtn());
    expect(screen.getByText(CLEANUP_HELD_BY_RECHECKED)).toBeInTheDocument();
    rerender(<HeldByRows sessions={DEAD} coord={frame([{ ...line, holds: { reclaim: 2, expire: 0, collect: 1 } }])} forget={vi.fn()} />);
    expect(screen.queryByText(CLEANUP_HELD_BY_RECHECKED)).toBeNull();
    rerender(<HeldByRows sessions={DEAD} coord={frame([line])} forget={vi.fn()} />);
    expect(screen.queryByText(CLEANUP_HELD_BY_RECHECKED), 'the old line brings no note back').toBeNull();
  });
});

// Task C15 (D-8111), review 1580 F9: Forget is offered only where the session sheet offers Forget session (the row
// listed dead, with no workspace, and not asleep). Every other row gets the harmless Check again, whatever the server said.
describe('Forget follows the session sheet\'s presence check', () => {
  const others: [string, readonly ReturnType<typeof deadSession>[]][] = [
    ['alive', [fleetSession({ id: 'row-a' })]],
    ['asleep', [hibernatedSession(1_700_000_000_000, { id: 'row-a' })]],
    // Review 1663 F2: the D-7371 shape, a hibernated orphan the server reads `dead`, where only the not-asleep part decides.
    ['asleep under a dead presence', [deadSession({ id: 'row-a', presence: 'dead', hibernatedAt: 1_700_000_000_000 })]],
    ['in doubt', [deadSession({ id: 'row-a', presence: 'unknown' })]],
    ['a workspace', [deadSession({ id: 'row-a', workspace: 'ws-a' })]],
    ['not listed', [deadSession({ id: 'row-b' })]],
  ];

  it('a row listed dead, with no workspace and not asleep, is offered Forget', () => {
    expect(heldByRowControl(held(), deadSession({ id: 'row-a' }))).toBe('forget');
    render(<HeldByRows sessions={[deadSession({ id: 'row-a' })]} coord={frame([held()])} />);
    expect(screen.getByRole('button', { name: 'Forget row row-a…' })).toBeInTheDocument();
  });

  it.each(others)('a row that is %s is offered Check again, never Forget', (_, sessions) => {
    expect(heldByRowControl(held(), sessions.find((x) => x.id === 'row-a'))).toBe('recheck');
    render(<HeldByRows sessions={sessions} coord={frame([held()])} />);
    const b = screen.getByRole('button', { name: 'Check again — row-a…' });
    // Review 1663 F3: the fleet switched the control from the server's act, so its visible words follow the switch too.
    expect(labelInName(shownText(b), b.getAttribute('aria-label') ?? ''), `"${shownText(b)}" in its name`).toBe(true);
    expect(screen.queryByRole('button', { name: /forget/i })).toBeNull();
  });

  it('an open Forget closes, and nothing is sent, when the next frame lists the row alive', () => {
    const forget = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<HeldByRows sessions={[deadSession({ id: 'row-a' })]} coord={frame([held()])} forget={forget} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget row row-a…' }));
    expect(screen.getByText('Forget row-a?')).toBeInTheDocument();
    rerender(<HeldByRows sessions={[fleetSession({ id: 'row-a' })]} coord={frame([held()])} forget={forget} />);
    expect(document.querySelector('.qc-actions'), 'the dialog closed').toBeNull();
    expect(forget).not.toHaveBeenCalled();
  });
});

// Review 1663 F1 (the coordinator's ruling): the server's act stays the authority, so when the fleet switches a forget
// act to Check again, a line under the server's sentence says why.
describe('a forget act the fleet holds back says why', () => {
  const RUNNING = 'Forget is not offered while the fleet lists this session as running.';
  const ASLEEP = 'Forget is not offered while the fleet lists this session as asleep; wake it or check again.';
  const DOUBT = 'Forget is not offered while the fleet cannot tell whether it is running.';
  const why: [string, ReturnType<typeof deadSession>, string][] = [
    ['running', fleetSession({ id: 'row-a' }), RUNNING],
    ['asleep', hibernatedSession(1_700_000_000_000, { id: 'row-a' }), ASLEEP],
    ['asleep under a dead presence', deadSession({ id: 'row-a', presence: 'dead', hibernatedAt: 1_700_000_000_000 }), ASLEEP],
    ['in doubt', deadSession({ id: 'row-a', presence: 'unknown' }), DOUBT],
    // Review 1666 F2(b): the server's doubt stays doubt, marker or not; an in-doubt row is never called asleep.
    ['in doubt with a hibernation marker', deadSession({ id: 'row-a', presence: 'unknown', hibernatedAt: 1_700_000_000_000 }), DOUBT],
  ];

  it.each(why)('a row the fleet lists as %s carries its line', (_, session, line) => {
    expect(heldByRowWhyNotForget(held(), session)).toBe(line);
    render(<HeldByRows sessions={[session]} coord={frame([held()])} />);
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it('no line shows when the act and the control agree', () => {
    render(<HeldByRows sessions={[deadSession({ id: 'row-a' }), deadSession({ id: 'row-b' })]}
      coord={frame([held(), held({ rowId: 'row-b', act: 'recheck' })])} />);
    expect(screen.queryByText(/Forget is not offered/)).toBeNull();
    expect(heldByRowWhyNotForget(held(), deadSession({ id: 'row-a' }))).toBeNull();
    expect(heldByRowWhyNotForget(held({ act: 'recheck' }), fleetSession({ id: 'row-a' }))).toBeNull();
  });

  // Review 1666 F2(a) and (c), ruling R2: a workspace row and an unlisted row get no line, whatever the presence.
  it.each([
    ['a dead workspace row', [deadSession({ id: 'row-a', workspace: 'ws-a' })]],
    ['a running workspace row', [fleetSession({ id: 'row-a', workspace: 'ws-a' })]],
    ['an unlisted row', [deadSession({ id: 'row-b' })]],
  ] as const)('%s gets no line', (_, sessions) => {
    expect(heldByRowWhyNotForget(held(), sessions.find((x) => x.id === 'row-a'))).toBeNull();
    render(<HeldByRows sessions={sessions} coord={frame([held()])} />);
    expect(screen.getByRole('button', { name: 'Check again — row-a…' })).toBeInTheDocument();
    expect(screen.queryByText(/Forget is not offered/)).toBeNull();
  });
});

