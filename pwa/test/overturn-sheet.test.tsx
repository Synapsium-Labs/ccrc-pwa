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

  it('two options with the same text are both drawn, each with its own key (review 2792 F8)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<OverturnSheet call={call({ options: ['files', 'files', 'sql'], chosen: 'sql' })} send={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByRole('listitem').map((i) => i.textContent)).toEqual(['files', 'files', 'sql (chosen)']);
    expect(err.mock.calls.filter((c) => String(c[0]).includes('same key'))).toEqual([]);
    err.mockRestore();
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

  it('the device\'s saved copy offers no Overturn…', () => {
    render(<WaitingScreen view={view()} {...props} onOverturn={vi.fn()} notCurrent="Saved on this device." />);
    expect(screen.queryByRole('button', { name: 'Overturn…' })).toBeNull();
  });

  it('an overturned call offers no second Overturn…', () => {
    const v = waitingView({ items: [itemView({ id: 1, program: 'prog-a' })], calls: [call({ overturnedAt: NOW, overturnNote: 'x' })] });
    render(<WaitingScreen view={v} {...props} onOverturn={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Overturn…' })).toBeNull();
  });
});

// Fix round 1 (review 2792 F1, F2): the acts' state lives above the two parents that draw a programme's calls, so a frame that
// moves a programme across "has rows" or takes the open call away keeps the sheet, its typed note and Seen's pending state.
describe('the acts on a call survive their frame', () => {
  const props = { sessions: [], runs: [], now: NOW, onOpenItem: vi.fn(), onOpenSession: vi.fn() };
  const withRows = () => waitingView({ items: [itemView({ id: 1, program: 'prog-a', neededBy: 'blocking' })], calls: [call()] });
  const typeNote = (text: string) => fireEvent.change(screen.getByRole('textbox', { name: 'What should it have decided?' }), { target: { value: text } });
  const note = () => (screen.queryByRole('textbox', { name: 'What should it have decided?' }) as HTMLTextAreaElement | null)?.value ?? null;

  it('an open sheet and its note survive the programme losing its rows', () => {
    const view = render(<WaitingScreen view={withRows()} {...props} onOverturn={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Overturn…' }));
    typeNote('use files');
    view.rerender(<WaitingScreen view={waitingView({ calls: [call()] })} {...props} onOverturn={vi.fn()} />);
    expect(screen.queryByRole('form', { name: 'Overturn call 9' })).not.toBeNull();
    expect(note()).toBe('use files');
  });

  it('an open sheet and its note survive the programme gaining rows', () => {
    const view = render(<WaitingScreen view={waitingView({ calls: [call()] })} {...props} onOverturn={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Overturn…' }));
    typeNote('use files');
    view.rerender(<WaitingScreen view={withRows()} {...props} onOverturn={vi.fn()} />);
    expect(note()).toBe('use files');
  });

  it('an open sheet survives its call leaving the list, and still sends', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const view = render(<WaitingScreen view={withRows()} {...props} onOverturn={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Overturn…' }));
    typeNote('use files');
    view.rerender(<WaitingScreen view={waitingView({ items: [itemView({ id: 1, program: 'prog-a' })] })} {...props} onOverturn={send} />);
    expect(note()).toBe('use files');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ rowKind: 'call', id: 9, text: 'use files' }));
  });

  it('an open sheet and its note survive a frame with no list yet', () => {
    const view = render(<WaitingScreen view={withRows()} {...props} onOverturn={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Overturn…' }));
    typeNote('use files');
    view.rerender(<WaitingScreen view={null} {...props} onOverturn={vi.fn()} />);
    expect(note()).toBe('use files');
  });

  it('a Seen in flight stays asked when the programme loses its rows', () => {
    const onSeen = vi.fn(() => new Promise<unknown>(() => undefined));
    const view = render(<WaitingScreen view={withRows()} {...props} onSeen={onSeen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seen' }));
    view.rerender(<WaitingScreen view={waitingView({ calls: [call()] })} {...props} onSeen={onSeen} />);
    expect((screen.getByRole('button', { name: 'Seen' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
