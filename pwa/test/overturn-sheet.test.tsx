// The Overturn… confirm sheet (D-8126): options with the chosen one marked, a required note, the exact body, refusals in words.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CallView } from '../../shared/api';
import { ApiError } from '../src/lib/api';
import { OverturnSheet } from '../src/ledgers/OverturnSheet';
import { CALL_REFUSAL_TEXT } from '../src/ledgers/callWords';
import { WaitingScreen } from '../src/ledgers/WaitingScreen';
import { NOW, itemView, waitingView } from './ledgersFixture';

afterEach(cleanup);

const call = (over: Partial<CallView> = {}): CallView => ({
  id: 9, program: 'prog-a', runId: null, madeBy: 'coord', class: 'big', question: 'Which store?', options: ['sql', 'files'],
  chosen: 'files', why: 'simpler', reversible: true, wakeOn: null, at: NOW, seenAt: null, overturnedAt: null, overturnNote: null, ...over,
});

describe('the Overturn sheet', () => {
  it('lists the options weighed with the chosen one marked', () => {
    render(<OverturnSheet call={call()} send={vi.fn()} onClose={vi.fn()} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.getAttribute('data-chosen'))).toEqual(['false', 'true']);
    expect(items[1]!.textContent).toMatch(/files.*chosen/);
  });

  it('Confirm is disabled on an empty note', () => {
    render(<OverturnSheet call={call()} send={vi.fn()} onClose={vi.fn()} />);
    const confirm = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'use sql' } });
    expect(confirm.disabled).toBe(false);
  });

  it('Confirm posts the body exactly and closes on success', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    render(<OverturnSheet call={call()} send={send} onClose={onClose} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'use sql' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith({ rowKind: 'call', id: 9, text: 'use sql' });
  });

  it('a duplicate shows its words and keeps the sheet open', async () => {
    const send = vi.fn().mockRejectedValue(new ApiError(409, { error: 'duplicate' }));
    const onClose = vi.fn();
    render(<OverturnSheet call={call()} send={send} onClose={onClose} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'use sql' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect((await screen.findByRole('alert')).textContent).toBe(CALL_REFUSAL_TEXT.duplicate);
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Overturn… on the Waiting on you group', () => {
  const view = () => waitingView({ items: [itemView({ id: 1, program: 'prog-a', neededBy: 'blocking' })], calls: [call()] });
  const props = { sessions: [], runs: [], now: NOW, onOpenItem: vi.fn(), onOpenSession: vi.fn() };

  it('one tap on Overturn… opens the sheet for that call', () => {
    render(<WaitingScreen view={view()} {...props} onOverturn={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Overturn…' }));
    expect(screen.getByRole('form', { name: 'Overturn call 9' })).toBeTruthy();
  });

  it('no Overturn… control without the door', () => {
    render(<WaitingScreen view={view()} {...props} />);
    expect(screen.queryByRole('button', { name: 'Overturn…' })).toBeNull();
  });

  it('an overturned call offers no second Overturn…', () => {
    const v = waitingView({ items: [itemView({ id: 1, program: 'prog-a' })], calls: [call({ overturnedAt: NOW, overturnNote: 'x' })] });
    render(<WaitingScreen view={v} {...props} onOverturn={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Overturn…' })).toBeNull();
  });
});
