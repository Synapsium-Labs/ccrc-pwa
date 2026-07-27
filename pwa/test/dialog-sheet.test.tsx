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

// — the real question (Dialog.ask) —
//
// When the live menu is an AskUserQuestion the transcript carries the copy the
// pane truncated: the question itself, a header chip, per-option descriptions
// and preview blocks. Enrichment is by POSITION only — the index that gets
// typed always comes from the pane; rows the transcript doesn't cover (the
// TUI's own "Chat about this") keep their scraped label.
describe('DialogSheet (enriched by Dialog.ask)', () => {
  const renderSheet = (dialog: Dialog) => renderWithDialog(dialog);

  /** The scraped preamble — a lossy copy of the question the transcript has whole. */
  const PREAMBLE = 'Rates capture is partial for some classes.';

  /** The option rows in DOM order. Position IS the contract here, so these are
   *  read positionally rather than looked up by the text under test. */
  const optionRows = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>('.opts > .opt'));

  const previewToggles = (): HTMLElement[] =>
    screen.queryAllByRole('button', { name: /preview/i });

  const ASKED: Dialog = {
    id: 'd1',
    title: 'Forward-fill per class',
    body: PREAMBLE,
    parsed: true,
    selectedIndex: 1,
    raw: 'RAW PANE',
    options: [
      { index: 1, label: 'Forward-fill per class' },
      { index: 2, label: 'Require completeness, Anthropic only' },
      { index: 3, label: 'Ship as-is, alert + runbook' },
      { index: 4, label: 'Chat about this' },
    ],
    ask: {
      question: 'How should the partial-capture hazard be handled?',
      header: 'Revised fix',
      multiSelect: false,
      options: [
        {
          label: 'Forward-fill per class (Recommended)',
          description: 'Inherit the last seen rate.',
          preview: '07-01: in,out,cr',
        },
        {
          label: 'Require completeness, Anthropic only',
          description: 'Emit only complete rows.',
        },
        {
          label: 'Ship as-is, alert + runbook',
          description: 'Change nothing; watch it.',
          preview: 'alert: rate-gap > 24h',
        },
      ],
    },
  };

  it('shows the real question, the header chip and every description', () => {
    renderSheet(ASKED);
    // As the sheet's heading, so the dialog's accessible name is the question.
    expect(
      screen.getByRole('heading', {
        name: 'How should the partial-capture hazard be handled?',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Revised fix')).toBeInTheDocument();
    expect(screen.getByText('Inherit the last seen rate.')).toBeInTheDocument();
    expect(screen.getByText('Emit only complete rows.')).toBeInTheDocument();
  });

  it('drops the scraped preamble once the real question is on the sheet', () => {
    renderSheet(ASKED);
    // The pane's preamble is a truncated copy of the title — don't say it twice.
    expect(screen.queryByText(PREAMBLE)).not.toBeInTheDocument();
  });

  it('falls back to the scraped title and preamble when the question is blank', () => {
    // The server passes any string through as the question, whitespace included:
    // a blank one enriches nothing, so the pane's own copy has to survive.
    renderSheet({ ...ASKED, ask: { ...ASKED.ask!, question: '   ' } });

    expect(screen.getByRole('heading', { name: 'Forward-fill per class' })).toBeInTheDocument();
    expect(screen.getByText(PREAMBLE)).toBeInTheDocument();
    // The rest of the enrichment still lands — only the question was missing.
    expect(screen.getByText('Inherit the last seen rate.')).toBeInTheDocument();
  });

  it('keeps the scraped description when the transcript sends a blank one', () => {
    renderSheet({
      ...ASKED,
      options: [
        { ...ASKED.options[0]!, description: 'Scraped: inherits the last rate.' },
        ...ASKED.options.slice(1),
      ],
      ask: {
        ...ASKED.ask!,
        options: [
          { ...ASKED.ask!.options[0]!, description: '' },
          ...ASKED.ask!.options.slice(1),
        ],
      },
    });

    expect(screen.getByText('Scraped: inherits the last rate.')).toBeInTheDocument();
  });

  it('opens the preselected option’s preview and leaves the others collapsed', () => {
    renderSheet(ASKED);
    const toggles = previewToggles();
    expect(toggles).toHaveLength(2);

    expect(screen.getByText('07-01: in,out,cr')).toBeVisible();
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
    // Row 3 is not the preselected row: its worked example stays folded away.
    expect(screen.queryByText('alert: rate-gap > 24h')).not.toBeInTheDocument();
    expect(toggles[1]).toHaveAttribute('aria-expanded', 'false');
  });

  it('answers with the pane index even when the transcript relabels the row', () => {
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderSheet(ASKED);

    fireEvent.click(screen.getByRole('button', { name: /Ship as-is, alert \+ runbook/ }));
    expect(spy).toHaveBeenCalledWith(SESSION_ID, 'd1', 3);
  });

  it('enriches by position and leaves the TUI’s own row alone', () => {
    renderSheet(ASKED);
    const rows = optionRows();

    // Rows 1–3 take the transcript's label and the sentence the 3-line pane box
    // had to throw away — nth row gets nth entry, no text matching involved.
    expect(rows.map((r) => r.querySelector('.opt-label')?.textContent)).toEqual([
      'Forward-fill per class (Recommended)',
      'Require completeness, Anthropic only',
      'Ship as-is, alert + runbook',
      'Chat about this',
    ]);
    // Row 4 is the TUI's own escape hatch: no counterpart, so no description…
    expect(rows.map((r) => r.querySelector('.opt-desc')?.textContent ?? null)).toEqual([
      'Inherit the last seen rate.',
      'Emit only complete rows.',
      'Change nothing; watch it.',
      null,
    ]);
    // …and nothing folded under it either.
    expect(document.querySelector('.opts')?.lastElementChild).toBe(rows[3]);
  });

  it('does not carry one question’s collapsed preview over to the next', () => {
    const { store } = renderSheet(ASKED);
    fireEvent.click(previewToggles()[0]!);
    expect(screen.queryByText('07-01: in,out,cr')).not.toBeInTheDocument();

    act(() => {
      store.getState().apply({
        type: 'dialog',
        dialog: {
          ...ASKED,
          id: 'd2',
          ask: {
            ...ASKED.ask!,
            question: 'And the backfill window?',
            options: [
              { ...ASKED.ask!.options[0]!, preview: '06-01: in,out' },
              ...ASKED.ask!.options.slice(1),
            ],
          },
        },
      });
    });
    // A new question opens its preselected preview afresh.
    expect(screen.getByText('06-01: in,out')).toBeVisible();
  });

  it('renders exactly as before when there is no ask', () => {
    renderSheet({ ...ASKED, ask: undefined });
    expect(screen.getByRole('button', { name: 'Forward-fill per class' })).toBeInTheDocument();
    expect(screen.getByText(PREAMBLE)).toBeInTheDocument();
    expect(screen.queryByText('Revised fix')).not.toBeInTheDocument();
    expect(screen.queryByText('Inherit the last seen rate.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument();
  });
});

// — answering in your own words —
//
// A menu owns the terminal's keyboard, so free text cannot simply be typed at
// the pane: the server refuses with dialog-open (see sendPrompt's hasMenu
// guard). The sheet must instead take the TUI's own "Chat about this" row,
// wait for the menu to clear, and only then send.
describe('DialogSheet free-text reply', () => {
  const withChatRow = () =>
    parsedDialog({
      options: [
        { index: 1, label: 'Forward-fill per class (Recommended)' },
        { index: 2, label: 'Require completeness, Anthropic only' },
        { index: 3, label: 'Chat about this' },
      ],
    });

  it('selects "Chat about this" first, then sends the text once the menu clears', async () => {
    const answer = vi.spyOn(api, 'answerDialog').mockResolvedValue(undefined as never);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore(SESSION_ID, { makeSocket: fakeSocket, api: { prompt } });
    const dialog = withChatRow();
    act(() => store.getState().apply({ type: 'dialog', dialog }));
    render(
      <>
        <DialogSheet id={SESSION_ID} store={store} />
        <ToastHost />
      </>,
    );

    fireEvent.change(screen.getByLabelText('Answer in your own words'), {
      target: { value: 'none of these — the rates table is the wrong layer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    // The escape hatch is taken by its own index, not by guessing.
    await vi.waitFor(() => expect(answer).toHaveBeenCalledWith(SESSION_ID, 'd-abc', 3));
    // Nothing is typed while the menu is still up.
    expect(prompt).not.toHaveBeenCalled();

    act(() => store.getState().apply({ type: 'dialog_cleared' }));
    await vi.waitFor(() =>
      expect(prompt).toHaveBeenCalledWith(
        SESSION_ID,
        'none of these — the rates table is the wrong layer',
        { replaceDraft: undefined },
      ),
    );
  });

  it('says so rather than failing silently when the question offers no free-text row', async () => {
    const answer = vi.spyOn(api, 'answerDialog').mockResolvedValue(undefined as never);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore(SESSION_ID, { makeSocket: fakeSocket, api: { prompt } });
    act(() => store.getState().apply({ type: 'dialog', dialog: parsedDialog() }));
    render(
      <>
        <DialogSheet id={SESSION_ID} store={store} />
        <ToastHost />
      </>,
    );

    fireEvent.change(screen.getByLabelText('Answer in your own words'), {
      target: { value: 'something else entirely' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/no free-text option/i)).toBeInTheDocument();
    expect(answer).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });
});
