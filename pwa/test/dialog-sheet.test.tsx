// Task 9 — DialogSheet: parsed dialogs render as big tappable option rows
// (preselected marked with the ❯ accent) answering via api.answerDialog;
// unparsed dialogs render raw + a terminal CTA; a stale 409 toasts and keeps
// the sheet open on the store's dialog; scrim cancel only hides (the store
// keeps signalling) and is refused while an answer is in flight.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Dialog } from '../../shared/api';
import { ToastHost } from '../src/components/Toast';
import { api, ApiError } from '../src/lib/api';
import { DialogSheet } from '../src/session/DialogSheet';
import { createSessionStore } from '../src/stores/session';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// — fixtures —

const fakeSocket = (): WebSocket =>
  ({
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    close(): void {},
  }) as unknown as WebSocket;

const SESSION_ID = 'claude:OpenClawHetzner';

const parsedDialog = (patch: Partial<Dialog> = {}): Dialog => ({
  id: 'd-abc',
  title: 'Which migration strategy for the legacy orders table?',
  options: [
    { index: 1, label: 'Expand–contract' },
    { index: 2, label: 'Big-bang cutover' },
    { index: 3, label: 'Freeze reads, then migrate' },
    { index: 4, label: 'Ask me later' },
  ],
  selectedIndex: 1,
  parsed: true,
  raw: '❯ 1. Expand–contract',
  ...patch,
});

const makeStore = () =>
  createSessionStore(SESSION_ID, {
    makeSocket: fakeSocket,
    api: { prompt: vi.fn().mockResolvedValue(undefined) },
  });

const renderWithDialog = (dialog: Dialog, onOpenTerminal = vi.fn()) => {
  const store = makeStore();
  act(() => {
    store.getState().apply({ type: 'dialog', dialog });
  });
  render(
    <>
      <DialogSheet id={SESSION_ID} store={store} onOpenTerminal={onOpenTerminal} />
      <ToastHost />
    </>,
  );
  return { store, onOpenTerminal };
};

// — parsed dialogs —

describe('DialogSheet (parsed)', () => {
  it('renders the question and all four option rows, marking the preselected one', () => {
    renderWithDialog(parsedDialog());

    expect(
      screen.getByText('Which migration strategy for the legacy orders table?'),
    ).toBeInTheDocument();

    const first = screen.getByRole('button', { name: 'Expand–contract' });
    expect(first).toHaveClass('opt--selected');
    expect(first).toHaveTextContent('❯');

    for (const label of ['Big-bang cutover', 'Freeze reads, then migrate', 'Ask me later']) {
      expect(screen.getByRole('button', { name: label })).not.toHaveClass('opt--selected');
    }
  });

  it('tapping an option answers with dialogId + optionIndex and shows the answering state', () => {
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderWithDialog(parsedDialog());

    fireEvent.click(screen.getByRole('button', { name: 'Freeze reads, then migrate' }));
    expect(spy).toHaveBeenCalledWith(SESSION_ID, 'd-abc', 3);

    expect(screen.getByText('answering…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Big-bang cutover' })).toBeDisabled();
  });

  it('stays open after a successful answer until dialog_cleared closes it', async () => {
    vi.spyOn(api, 'answerDialog').mockResolvedValue(undefined);
    const { store } = renderWithDialog(parsedDialog());

    fireEvent.click(screen.getByRole('button', { name: 'Expand–contract' }));
    await act(async () => {});
    expect(screen.getByText('answering…')).toBeInTheDocument();

    act(() => {
      store.getState().apply({ type: 'dialog_cleared' });
    });
    expect(
      screen.queryByText('Which migration strategy for the legacy orders table?'),
    ).not.toBeInTheDocument();
  });

  it('a stale 409 toasts and keeps the sheet open on the store dialog', async () => {
    vi.spyOn(api, 'answerDialog').mockRejectedValue(
      new ApiError(409, { ok: false, error: 'stale-dialog' }),
    );
    renderWithDialog(parsedDialog());

    fireEvent.click(screen.getByRole('button', { name: 'Big-bang cutover' }));
    expect(
      await screen.findByText('That question changed — showing the latest'),
    ).toBeInTheDocument();

    // Sheet stays open showing the store's dialog; rows are tappable again.
    expect(
      screen.getByText('Which migration strategy for the legacy orders table?'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Big-bang cutover' })).toBeEnabled();
  });
});

// — unparsed dialogs —

describe('DialogSheet (unparsed)', () => {
  it('renders the raw pane in a mono block plus the terminal CTA', () => {
    const { onOpenTerminal } = renderWithDialog(
      parsedDialog({
        parsed: false,
        raw: 'Trust the files in this folder?\n\n❯ Yes, proceed\n  No, exit',
      }),
    );

    expect(screen.getByText(/Trust the files in this folder\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open terminal to answer' }));
    expect(onOpenTerminal).toHaveBeenCalledOnce();
  });
});

// — dismissal —

describe('DialogSheet dismissal', () => {
  it('scrim cancel hides the sheet while the store keeps the dialog; a new dialog reopens it', () => {
    const { store } = renderWithDialog(parsedDialog());

    fireEvent.click(screen.getByTestId('sheet-overlay'));
    expect(
      screen.queryByText('Which migration strategy for the legacy orders table?'),
    ).not.toBeInTheDocument();
    expect(store.getState().dialog).not.toBeNull();

    act(() => {
      store.getState().apply({
        type: 'dialog',
        dialog: parsedDialog({ id: 'd-new', title: 'Overwrite the existing file?' }),
      });
    });
    expect(screen.getByText('Overwrite the existing file?')).toBeInTheDocument();
  });

  it('refuses to dismiss while an answer is in flight', () => {
    vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderWithDialog(parsedDialog());

    fireEvent.click(screen.getByRole('button', { name: 'Ask me later' }));
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    expect(
      screen.getByText('Which migration strategy for the legacy orders table?'),
    ).toBeInTheDocument();
  });
});
