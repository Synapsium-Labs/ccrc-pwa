// The held-rows list (cleanup un-wedge R2): one line per row holding the cleanup, each with its own control — ONE
// tap, then a confirm. Forget only for a gone-unrecorded row the server says forget for; every other case re-checks.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { CleanupHeldByItem } from '../../shared/api';
import { HeldByRows } from '../src/fleet/HeldByRows';
import {
  CLEANUP_HELD_BY_LABEL, CLEANUP_HELD_BY_RECHECKED, heldByRowControl, heldByRowsOf,
} from '../src/fleet/heldByRowsWords';
import { ApiError, api } from '../src/lib/api';
import { ToastHost } from '@ccrc/ui';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const held = (over: Partial<CleanupHeldByItem> = {}): CleanupHeldByItem => ({
  rowId: 'row-a', word: 'gone-unrecorded', sentence: 'Its workspace is gone and nothing records it.',
  holds: { reclaim: 3, expire: 0, collect: 1 }, act: 'forget', ...over,
});
const PACE = 'within minutes for a new hold, and up to four hours for children that have been failing a long time';
const frame = (list: unknown): unknown => ({ pause: 'clear', mail: 'clear', cleanupHeldBy: list });
const confirmBtn = (): HTMLElement => {
  const b = document.querySelector('.qc-actions .btn-primary');
  if (b === null) throw new Error('no confirm open');
  return b as HTMLElement;
};

describe('the held-rows list', () => {
  it('one line per row, with its word and the server\'s sentence', () => {
    render(<HeldByRows coord={frame([held(), held({ rowId: 'row-b', word: 'not-plain', act: 'recheck', sentence: 'Not a plain checkout.' })])} />);
    const list = screen.getByLabelText(CLEANUP_HELD_BY_LABEL);
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('row-a · gone-unrecorded')).toBeInTheDocument();
    expect(within(list).getByText('Its workspace is gone and nothing records it.')).toBeInTheDocument();
    expect(within(list).getByText('row-b · not-plain')).toBeInTheDocument();
    expect(within(list).getByText('Not a plain checkout.')).toBeInTheDocument();
  });

  it('nothing renders for an absent field', () => {
    const { container } = render(<HeldByRows coord={{ pause: 'clear', mail: 'clear' }} />);
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
    expect(heldByRowControl(held())).toBe('forget');
    expect(heldByRowControl(held({ word: 'not-plain', act: 'forget' }))).toBe('recheck');
    expect(heldByRowControl(held({ act: 'recheck' }))).toBe('recheck');
    render(<HeldByRows coord={frame([held({ word: 'not-plain', act: 'forget' })])} />);
    expect(screen.getByRole('button', { name: 'Check row-a again…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /forget/i })).toBeNull();
  });

  it('a recheck line offers Check again', () => {
    render(<HeldByRows coord={frame([held({ act: 'recheck' })])} />);
    expect(screen.getByRole('button', { name: 'Check row-a again…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /forget/i })).toBeNull();
  });

  it('the tap opens the confirm and sends nothing', () => {
    const forget = vi.fn().mockResolvedValue(undefined);
    render(<HeldByRows coord={frame([held()])} forget={forget} />);
    expect(document.querySelector('.qc-actions')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Forget row-a…' }));
    expect(document.querySelector('.qc-actions')).not.toBeNull();
    expect(forget).not.toHaveBeenCalled();
  });

  it('the confirm names the row and what will happen', () => {
    render(<HeldByRows coord={frame([held()])} forget={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget row-a…' }));
    expect(screen.getByText('Forget row-a?')).toBeInTheDocument();
    expect(screen.getByText(/Only the registry entry of row-a is removed/)).toBeInTheDocument();
    expect(screen.getByText(/transcript and any pasted images stay/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(PACE))).toBeInTheDocument();
    expect(screen.queryByText(/next pass|once a minute/)).toBeNull();
  });

  it('confirming forget sends the act with the row id the server named', async () => {
    const forget = vi.fn().mockResolvedValue(undefined);
    render(<HeldByRows coord={frame([held({ rowId: 'row-a' }), held({ rowId: 'row-b' })])} forget={forget} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget row-b…' }));
    expect(screen.getByText('Forget row-b?')).toBeInTheDocument();
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(forget).toHaveBeenCalledTimes(1));
    expect(forget).toHaveBeenCalledWith('row-b');
  });

  it('confirming check again sends nothing and shows the checked-again note', () => {
    const forget = vi.fn().mockResolvedValue(undefined);
    render(<HeldByRows coord={frame([held({ act: 'recheck', word: 'under-proc' })])} forget={forget} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check row-a again…' }));
    expect(screen.getByText('Check row-a again?')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent and nothing changes for row-a/)).toBeInTheDocument();
    fireEvent.click(confirmBtn());
    expect(forget).not.toHaveBeenCalled();
    expect(screen.getByText(CLEANUP_HELD_BY_RECHECKED)).toBeInTheDocument();
  });

  it('a refused forget goes to the toast', async () => {
    const forget = vi.fn().mockRejectedValue(new ApiError(502, { ok: false, stderr: 'is-a-workspace' }));
    render(<><HeldByRows coord={frame([held()])} forget={forget} /><ToastHost /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Forget row-a…' }));
    fireEvent.click(confirmBtn());
    expect(await screen.findByText(/Couldn't forget — is-a-workspace/)).toBeInTheDocument();
  });

  it('each button names its row', () => {
    render(<HeldByRows coord={frame([held(), held({ rowId: 'row-b', act: 'recheck' })])} />);
    expect(screen.getByRole('button', { name: 'Forget row-a…' })).toHaveTextContent('Forget row…');
    expect(screen.getByRole('button', { name: 'Check row-b again…' })).toHaveTextContent('Check again…');
  });

  it('check again names the real pace and never once a minute', () => {
    render(<HeldByRows coord={frame([held({ act: 'recheck' })])} forget={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check row-a again…' }));
    expect(screen.getByText(new RegExp(`ccrc reads this row again when it next checks the children it holds: ${PACE}`))).toBeInTheDocument();
    fireEvent.click(confirmBtn());
    expect(screen.getByText(CLEANUP_HELD_BY_RECHECKED)).toHaveTextContent(PACE);
    expect(screen.queryByText(/once a minute|next pass/)).toBeNull();
  });

  it('a forget act on another word confirms as a check again and calls no api at all', () => {
    const spies = Object.entries(api).filter(([, v]) => typeof v === 'function')
      .map(([k]) => vi.spyOn(api as unknown as Record<string, () => unknown>, k).mockResolvedValue(undefined));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    expect(spies.length).toBeGreaterThan(10);
    render(<HeldByRows coord={frame([held({ word: 'not-plain', act: 'forget' })])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check row-a again…' }));
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
    render(<HeldByRows coord={frame([held({ act: 'recheck', word: 'under-proc' })])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check row-a again…' }));
    fireEvent.click(confirmBtn());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a successful forget is toasted', async () => {
    const forget = vi.fn().mockResolvedValue(undefined);
    render(<><HeldByRows coord={frame([held()])} forget={forget} /><ToastHost /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Forget row-a…' }));
    fireEvent.click(confirmBtn());
    expect(await screen.findByText(/Forgot row-a\. The line clears as each child it held is checked again/)).toBeInTheDocument();
  });

  it('the confirm does not reopen by itself when its row leaves and returns', () => {
    const { rerender } = render(<HeldByRows coord={frame([held()])} forget={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget row-a…' }));
    expect(document.querySelector('.qc-actions')).not.toBeNull();
    rerender(<HeldByRows coord={frame([])} forget={vi.fn()} />);
    expect(document.querySelector('.qc-actions')).toBeNull();
    rerender(<HeldByRows coord={frame([held()])} forget={vi.fn()} />);
    expect(document.querySelector('.qc-actions')).toBeNull();
  });

  it('the checked-again note clears when a new frame changes that row\'s line', () => {
    const line = held({ act: 'recheck', word: 'under-proc' });
    const { rerender } = render(<HeldByRows coord={frame([line])} forget={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check row-a again…' }));
    fireEvent.click(confirmBtn());
    expect(screen.getByText(CLEANUP_HELD_BY_RECHECKED)).toBeInTheDocument();
    rerender(<HeldByRows coord={frame([{ ...line }])} forget={vi.fn()} />);
    expect(screen.getByText(CLEANUP_HELD_BY_RECHECKED), 'the same line keeps its note').toBeInTheDocument();
    rerender(<HeldByRows coord={frame([{ ...line, holds: { reclaim: 2, expire: 0, collect: 1 } }])} forget={vi.fn()} />);
    expect(screen.queryByText(CLEANUP_HELD_BY_RECHECKED)).toBeNull();
  });
});
