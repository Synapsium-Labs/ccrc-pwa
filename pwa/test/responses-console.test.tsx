// The console's opened receipts and "I handled this elsewhere" on an item page and the digest (Overlord W1, C67, C69).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DigestAnswer, DigestLine } from '../../shared/api';
import { RECEIPTS_MAX_PER_BODY } from '../../shared/responses';
import { api } from '../src/lib/api';
import { ItemView } from '../src/ledgers/ItemView';
import { DigestScreen } from '../src/screens/DigestScreen';
import { HandledElsewhere } from '../src/responses/HandledElsewhere';
import type { ResponseRowBrief } from '../../shared/responses';
import { NOW, itemView } from './ledgersFixture';

const row = (id: number, handledAt: number | null = null): ResponseRowBrief =>
  ({ id, kind: 'waiting', label: 'item', state: 'pending', outcome: null, handledAt });
const reads = (rows: ResponseRowBrief[]) => vi.spyOn(api, 'responsesFor').mockResolvedValue({ ok: true, rows });
let receipts: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  receipts = vi.spyOn(api, 'postResponseReceipts').mockResolvedValue({ ok: true, kept: 1, dropped: [] });
  reads([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const showItem = () => render(<ItemView item={itemView({ id: 41 })} onTick={async () => {}} onDismiss={async () => {}} programmeLive={true} now={NOW} />);

describe('the item page', () => {
  it('posts one opened receipt for its item and none on a re-render', () => {
    const { rerender } = showItem();
    expect(receipts).toHaveBeenCalledTimes(1);
    expect(receipts).toHaveBeenCalledWith([{ ref: { kind: 'item', id: 41 }, receipt: 'opened', from: { source: 'console' } }]);
    rerender(<ItemView item={itemView({ id: 41 })} onTick={async () => {}} onDismiss={async () => {}} programmeLive={true} now={NOW + 1} />);
    expect(receipts).toHaveBeenCalledTimes(1);
  });
  it('shows nothing and no error when the receipt fails', async () => {
    receipts.mockRejectedValue(new Error('down'));
    showItem();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('I handled this elsewhere')).toBeNull();
  });
  it('reads the item ref for its control', async () => {
    const read = reads([row(9)]);
    showItem();
    expect(await screen.findByRole('button', { name: 'I handled this elsewhere' })).toBeTruthy();
    expect(read).toHaveBeenCalledWith('item:41');
  });
});

describe('the control', () => {
  const target = { kind: 'item', id: 1 } as const;
  it('marks every unhandled row the read lists and shows the handled sentence', async () => {
    reads([row(1), row(2, 99), row(3)]);
    const mark = vi.spyOn(api, 'markResponseHandled').mockResolvedValue({ ok: true, id: 1, handledAt: 5, changed: true });
    render(<HandledElsewhere target={target} />);
    fireEvent.click(await screen.findByRole('button', { name: 'I handled this elsewhere' }));
    expect(screen.getByText('Marked handled elsewhere')).toBeTruthy();
    await waitFor(() => expect(mark.mock.calls.map((c) => c[0]).sort()).toEqual([1, 3]));
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('rolls back to the button on a refusal', async () => {
    reads([row(1)]);
    vi.spyOn(api, 'markResponseHandled').mockRejectedValue(new Error('refused'));
    render(<HandledElsewhere target={target} />);
    fireEvent.click(await screen.findByRole('button', { name: 'I handled this elsewhere' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'I handled this elsewhere' })).toBeTruthy();
    expect(screen.queryByText('Marked handled elsewhere')).toBeNull();
  });
  it('shows the sentence for rows already handled, and nothing for no rows', async () => {
    reads([row(1, 4)]);
    const { unmount } = render(<HandledElsewhere target={target} />);
    expect(await screen.findByText('Marked handled elsewhere')).toBeTruthy();
    unmount();
    reads([]);
    const { container } = render(<HandledElsewhere target={target} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });
  it('shows nothing while the read is pending or after it failed', async () => {
    vi.spyOn(api, 'responsesFor').mockReturnValue(new Promise(() => {}));
    const a = render(<HandledElsewhere target={target} />);
    expect(a.container.textContent).toBe('');
    a.unmount();
    vi.spyOn(api, 'responsesFor').mockRejectedValue(new Error('unavailable'));
    const b = render(<HandledElsewhere target={target} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(b.container.textContent).toBe('');
  });
});

const T = Date.parse('2026-10-17T08:00:00Z');
const line = (rowKind: 'ask' | 'approval', id: number): DigestLine => ({
  at: T + id, coordinator: 'prog-a', childId: 'lane-a', text: 'Which colour?', tool: null, class: null, answer: null,
  reason: null, corrected: false, rowKind, id, kind: 'answer',
});
const digest = (lines: DigestLine[]): DigestAnswer => ({
  v: 1, day: '2026-10-18', hourUtc: 7, fromMs: Date.parse('2026-10-17T07:00:00Z'), toMs: Date.parse('2026-10-18T07:00:00Z'),
  totals: { decisions: lines.length, answers: lines.length, allows: 0, denies: 0, handOvers: 0, lapses: 0, calls: 0, guardForbidden: 0 },
  byCoordinator: [{ coordinator: 'prog-a', decisions: lines.length }], lines, sentAt: T, pushed: true,
});

describe('the digest page', () => {
  it('posts one body naming each decision line it shows, once', async () => {
    const load = vi.fn().mockResolvedValue(digest([line('ask', 1), line('approval', 2)]));
    const { rerender } = render(<DigestScreen day="2026-10-18" load={load} />);
    await screen.findAllByRole('button', { name: /^Correct / });
    expect(receipts).toHaveBeenCalledTimes(1);
    expect(receipts.mock.calls[0]![0]).toEqual([
      { ref: { kind: 'digest', key: '2026-10-18:ask:1' }, receipt: 'opened', from: { source: 'console' } },
      { ref: { kind: 'digest', key: '2026-10-18:approval:2' }, receipt: 'opened', from: { source: 'console' } },
    ]);
    rerender(<DigestScreen day="2026-10-18" load={load} />);
    expect(receipts).toHaveBeenCalledTimes(1);
  });
  it('splits a long day into bodies of at most 50', async () => {
    const lines = Array.from({ length: RECEIPTS_MAX_PER_BODY + 3 }, (_, i) => line('ask', i + 1));
    render(<DigestScreen day="2026-10-18" load={vi.fn().mockResolvedValue(digest(lines))} />);
    await waitFor(() => expect(receipts).toHaveBeenCalledTimes(2));
    expect(receipts.mock.calls.map((c: unknown[]) => (c[0] as unknown[]).length)).toEqual([RECEIPTS_MAX_PER_BODY, 3]);
  });
  it('puts the control on each decision line, reading its digest key', async () => {
    const read = reads([row(5)]);
    render(<DigestScreen day="2026-10-18" load={vi.fn().mockResolvedValue(digest([line('ask', 1)]))} />);
    expect(await screen.findByRole('button', { name: 'I handled this elsewhere' })).toBeTruthy();
    expect(read).toHaveBeenCalledWith('digest:2026-10-18:ask:1');
  });
});
