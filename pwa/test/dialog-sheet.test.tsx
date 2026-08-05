// Task 9 — DialogSheet: parsed dialogs render as big tappable option rows
// (preselected marked with the ❯ accent) answering via api.answerDialog;
// unparsed dialogs render raw + a terminal CTA; a stale 409 toasts and keeps
// the sheet open on the store's dialog; scrim cancel only hides (the store
// keeps signalling) and is refused while an answer is in flight.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Dialog, HookAsk } from '../../shared/api';
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

  it('puts the question inside the scrolling body, never in the fixed header', () => {
    renderSheet(ASKED);
    const heading = screen.getByRole('heading', {
      name: 'How should the partial-capture hazard be handled?',
    });
    // The sheet's header row is flex:none and uncapped, and only .sheet-body
    // scrolls: a real question runs to 563 chars — ~15 lines on a 390px phone —
    // so above the body it squeezes the options to zero height on a landscape
    // viewport with nothing left to scroll to reach them. Inside, the question
    // scrolls together with the rows it is asking about.
    const body = document.querySelector('.sheet-body');
    expect(body).not.toBeNull();
    expect(body!.contains(heading)).toBe(true);
    expect(body!.contains(optionRows()[0]!)).toBe(true);
    // …and it is still what names the dialog.
    expect(
      screen.getByRole('dialog', { name: 'How should the partial-capture hazard be handled?' }),
    ).toBeInTheDocument();
  });

  it('keeps the pane’s own copy for a row the server could not confirm', () => {
    // alignAsk tolerates one disagreeing row from four options up, and sends
    // `null` for it: that row's index still types the PANE's option, so wearing
    // the transcript's copy would describe an answer the tap does not send.
    renderSheet({
      ...ASKED,
      options: [
        { ...ASKED.options[0]!, description: 'Scraped: inherits the last rate.' },
        ...ASKED.options.slice(1),
      ],
      ask: { ...ASKED.ask!, options: [null, ...ASKED.ask!.options.slice(1)] },
    });
    const rows = optionRows();

    expect(rows[0]!.querySelector('.opt-label')?.textContent).toBe('Forward-fill per class');
    expect(rows[0]!.querySelector('.opt-desc')?.textContent).toBe('Scraped: inherits the last rate.');
    // Its worked example goes with it — a preview is copy about the row too.
    expect(previewToggles()).toHaveLength(1);
    // The rows that did match are untouched.
    expect(rows[1]!.querySelector('.opt-desc')?.textContent).toBe('Emit only complete rows.');
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

  // The preview toggle is the one affordance on this sheet with no text label
  // of its own to fall back on, so its name has to survive without the glyph:
  // in the name, "▸" is announced as "black right-pointing small triangle",
  // and the NAME then changes on every toggle on top of the aria-expanded
  // state change — two announcements for one thing. Every other decorative
  // glyph in this file (.opt-glyph, .opt-idx, .opt-enter) is aria-hidden.
  it('names the preview toggle without the caret, in both states', () => {
    renderSheet(ASKED);
    const [openToggle, shutToggle] = previewToggles();

    // Exact-name lookups: an accessible name of "▾ preview" would not match.
    expect(screen.getAllByRole('button', { name: 'preview' })).toHaveLength(2);
    expect(openToggle).toHaveAccessibleName('preview');
    expect(shutToggle).toHaveAccessibleName('preview');
    // The caret is still on screen — hidden from the a11y tree, not deleted.
    expect(openToggle!.textContent).toContain('▾');
    expect(shutToggle!.textContent).toContain('▸');
    expect(openToggle!.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('▾');

    // Toggling changes the state, and only the state.
    fireEvent.click(shutToggle!);
    expect(shutToggle).toHaveAttribute('aria-expanded', 'true');
    expect(shutToggle).toHaveAccessibleName('preview');
  });

  it('points aria-expanded at the region it expands', () => {
    renderSheet(ASKED);
    const [openToggle] = previewToggles();
    const controls = openToggle!.getAttribute('aria-controls');

    // aria-expanded without aria-controls leaves the disclosed block
    // unassociated with its control — there is nothing to take the reader to.
    expect(controls).toBeTruthy();
    const region = document.getElementById(controls!);
    expect(region).not.toBeNull();
    expect(region).toHaveTextContent('07-01: in,out,cr');
    // Distinct per option, so one toggle never claims another's preview.
    expect(previewToggles()[1]!.getAttribute('aria-controls')).not.toBe(controls);
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

// — the hook envelope (Task 8) —
//
// `session-hook.sh` reports the same waiting state on its own clock, beside
// the pane scrape. When the store's `ask` is non-null the sheet renders it
// INSTEAD of the scraped dialog (data-source="hook" pins that), falling back
// to the scraped view the moment `ask_cleared` empties it. SEND still goes
// through the exact functions the scraped path already uses — `answerDialog`
// for numbered options (so both fixtures below carry a matching scraped
// `dialog` too: the envelope has no pane state of its own to answer against)
// and `api.interrupt` (literal Escape) for an approval's Deny.
describe('DialogSheet (hook envelope)', () => {
  const QUESTION_ASK: HookAsk = {
    questions: [
      {
        question: 'Which rollout strategy?',
        header: 'Rollout',
        options: [
          { label: 'Canary first', description: 'Ship to 5% for an hour.' },
          { label: 'Big bang', description: 'Ship to everyone at once.' },
        ],
      },
    ],
  };

  const APPROVAL_ASK: HookAsk = {
    approval: { tool: 'Bash', summary: 'rm -rf build/' },
  };

  // — C1: the scraped dialog that "corresponds" to a given envelope —
  //
  // `answerDialog` walks THIS pane by index, so an envelope's rows are only
  // tappable when its content and this dialog's describe the same question
  // (DialogSheet's `questionCorresponds`/Yes-first check). This suite used
  // to default every envelope test to `parsedDialog()` — a dialog about an
  // unrelated migration-strategy question — regardless of which envelope it
  // paired with, which is exactly what let the C1 bug through: a tap on
  // QUESTION_ASK's "Big bang" would walk parsedDialog()'s pane to index 2
  // ("Big-bang cutover") and send THAT. The 'correspondence gate' tests below
  // deliberately keep that mismatched pairing to prove the gate now catches
  // it; everywhere else pairs each envelope with a dialog that actually
  // matches it.
  const matchingDialog = (patch: Partial<Dialog> = {}): Dialog =>
    parsedDialog({
      title: 'Which rollout strategy?',
      options: [
        { index: 1, label: 'Canary first' },
        { index: 2, label: 'Big bang' },
      ],
      ...patch,
    });

  const yesNoDialog = (patch: Partial<Dialog> = {}): Dialog =>
    parsedDialog({
      title: 'Trust the files in this folder?',
      options: [
        { index: 1, label: 'Yes, proceed' },
        { index: 2, label: 'No, exit' },
      ],
      ...patch,
    });

  const TWO_QUESTIONS: HookAsk = {
    questions: [
      { question: 'First: which env?', options: [{ label: 'Staging' }, { label: 'Prod' }] },
      { question: 'Second: which region?', options: [{ label: 'EU' }, { label: 'US' }] },
    ],
  };

  const envDialog = (patch: Partial<Dialog> = {}): Dialog =>
    parsedDialog({
      title: 'First: which env?',
      options: [
        { index: 1, label: 'Staging' },
        { index: 2, label: 'Prod' },
      ],
      ...patch,
    });

  const renderWithAsk = (ask: HookAsk, dialog: Dialog | null) => {
    const store = makeStore();
    act(() => {
      if (dialog) store.getState().apply({ type: 'dialog', dialog });
      store.getState().apply({ type: 'ask', ask });
    });
    render(
      <>
        <DialogSheet id={SESSION_ID} store={store} />
        <ToastHost />
      </>,
    );
    return { store };
  };

  it('renders the envelope question, and tapping option N answers with digit N via answerDialog', () => {
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderWithAsk(QUESTION_ASK, matchingDialog());

    expect(screen.getByText('Which rollout strategy?')).toBeInTheDocument();
    expect(screen.getByText('Rollout')).toBeInTheDocument();
    expect(screen.getByText('Ship to 5% for an hour.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Big bang/ }));
    expect(spy).toHaveBeenCalledWith(SESSION_ID, 'd-abc', 2);
  });

  it('carries data-source="hook" while the envelope is showing', () => {
    renderWithAsk(QUESTION_ASK, matchingDialog());
    expect(document.querySelector('[data-source="hook"]')).toBeInTheDocument();
  });

  it('renders a multiSelect question\'s options as plain rows too — v1 has no multi-select UI, the send path is one digit either way', () => {
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderWithAsk(
      {
        questions: [
          {
            question: 'Pick languages',
            multiSelect: true,
            options: [{ label: 'TS' }, { label: 'Go' }],
          },
        ],
      },
      parsedDialog({
        title: 'Pick languages',
        options: [
          { index: 1, label: 'TS' },
          { index: 2, label: 'Go' },
        ],
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(spy).toHaveBeenCalledWith(SESSION_ID, 'd-abc', 2);
  });

  it('renders an approval envelope (tool + summary); Allow answers digit 1 via answerDialog', () => {
    const answerSpy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderWithAsk(APPROVAL_ASK, yesNoDialog());

    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('rm -rf build/')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(answerSpy).toHaveBeenCalledWith(SESSION_ID, 'd-abc', 1);
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
  });

  it('Deny sends Escape via api.interrupt', () => {
    vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const interruptSpy = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined as never);
    renderWithAsk(APPROVAL_ASK, yesNoDialog());

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(interruptSpy).toHaveBeenCalledWith(SESSION_ID);
  });

  it('toasts an honest, ambiguity-acknowledging message when Deny 409s (fix round 1: not-busy could mean either idle or already-resolved)', async () => {
    vi.spyOn(api, 'interrupt').mockRejectedValue(new ApiError(409, { ok: false, error: 'not-busy' }));
    renderWithAsk(APPROVAL_ASK, yesNoDialog());

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(
      await screen.findByText(/couldn't stop.*session may be idle or the request already resolved/i),
    ).toBeInTheDocument();
  });

  it('N1: toasts honestly about a 409 on the envelope path — nothing on screen actually changed', async () => {
    vi.spyOn(api, 'answerDialog').mockRejectedValue(
      new ApiError(409, { ok: false, error: 'stale-dialog' }),
    );
    renderWithAsk(QUESTION_ASK, matchingDialog());

    fireEvent.click(screen.getByRole('button', { name: /Big bang/ }));
    // Not "showing the latest" — that's the scraped path's copy, and unlike
    // that sheet, the envelope one renders `ask`, not `dialog`: a 409 here
    // doesn't change anything on screen the way it does there.
    expect(await screen.findByText(/moved on in the terminal/i)).toBeInTheDocument();
    expect(
      screen.queryByText('That question changed — showing the latest'),
    ).not.toBeInTheDocument();
  });

  it('prefers the envelope over a simultaneously pending scraped dialog', () => {
    renderWithAsk(QUESTION_ASK, parsedDialog());

    expect(screen.getByText('Which rollout strategy?')).toBeInTheDocument();
    expect(
      screen.queryByText('Which migration strategy for the legacy orders table?'),
    ).not.toBeInTheDocument();
  });

  it('regression: renders exactly the scraped dialog, with no data-source marker, when there is no envelope', () => {
    renderWithDialog(parsedDialog());

    expect(document.querySelector('[data-source="hook"]')).not.toBeInTheDocument();
    expect(
      screen.getByText('Which migration strategy for the legacy orders table?'),
    ).toBeInTheDocument();
    const first = screen.getByRole('button', { name: 'Expand–contract' });
    expect(first).toHaveClass('opt--selected');
  });

  it('ask_cleared empties the envelope and falls back to the still-pending scraped dialog', () => {
    const { store } = renderWithAsk(QUESTION_ASK, parsedDialog());
    expect(document.querySelector('[data-source="hook"]')).toBeInTheDocument();

    act(() => {
      store.getState().apply({ type: 'ask_cleared' });
    });

    expect(document.querySelector('[data-source="hook"]')).not.toBeInTheDocument();
    expect(
      screen.getByText('Which migration strategy for the legacy orders table?'),
    ).toBeInTheDocument();
  });

  // — fix round 1, (Critical) #1: dismissal parity with the scraped sheet —
  describe('dismissal', () => {
    it('a scrim tap hides the envelope without touching the store\'s ask (hide, not clear)', () => {
      const { store } = renderWithAsk(QUESTION_ASK, matchingDialog());
      fireEvent.click(screen.getByTestId('sheet-overlay'));

      expect(document.querySelector('[data-source="hook"]')).not.toBeInTheDocument();
      expect(store.getState().ask).toEqual(QUESTION_ASK);
    });

    it('reopens for a DIFFERENT envelope after being dismissed', () => {
      const { store } = renderWithAsk(QUESTION_ASK, matchingDialog());
      fireEvent.click(screen.getByTestId('sheet-overlay'));
      expect(document.querySelector('[data-source="hook"]')).not.toBeInTheDocument();

      const other: HookAsk = { approval: { tool: 'Write', summary: 'notes.md' } };
      act(() => {
        store.getState().apply({ type: 'ask', ask: other });
      });

      expect(document.querySelector('[data-source="hook"]')).toBeInTheDocument();
      expect(screen.getByText('Write')).toBeInTheDocument();
    });

    it('refuses to dismiss while a numbered-option answer is in flight', () => {
      const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
      renderWithAsk(QUESTION_ASK, matchingDialog());

      fireEvent.click(screen.getByRole('button', { name: /Big bang/ }));
      expect(spy).toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('sheet-overlay'));
      expect(document.querySelector('[data-source="hook"]')).toBeInTheDocument();
    });

    it('refuses to dismiss while Allow is in flight', () => {
      vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
      renderWithAsk(APPROVAL_ASK, yesNoDialog());

      fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
      fireEvent.click(screen.getByTestId('sheet-overlay'));
      expect(document.querySelector('[data-source="hook"]')).toBeInTheDocument();
    });

    it('refuses to dismiss while Deny is in flight', () => {
      vi.spyOn(api, 'interrupt').mockReturnValue(new Promise(() => {}));
      renderWithAsk(APPROVAL_ASK, yesNoDialog());

      fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
      fireEvent.click(screen.getByTestId('sheet-overlay'));
      expect(document.querySelector('[data-source="hook"]')).toBeInTheDocument();
    });
  });

  // — fix round 1, (Critical) #2: fail visibly, never a silent no-op —
  describe('no scraped dialog to answer against', () => {
    it('question options render disabled, plus the "Open terminal to answer" / "Not now" CTA', () => {
      const onOpenTerminal = vi.fn();
      const store = makeStore();
      act(() => {
        store.getState().apply({ type: 'ask', ask: QUESTION_ASK });
      });
      render(
        <>
          <DialogSheet id={SESSION_ID} store={store} onOpenTerminal={onOpenTerminal} />
          <ToastHost />
        </>,
      );

      for (const label of [/Canary first/, /Big bang/]) {
        expect(screen.getByRole('button', { name: label })).toBeDisabled();
      }
      const cta = screen.getByRole('button', { name: 'Open terminal to answer' });
      const notNow = screen.getByRole('button', { name: 'Not now' });

      fireEvent.click(cta);
      expect(onOpenTerminal).toHaveBeenCalledOnce();
      expect(document.querySelector('[data-source="hook"]')).not.toBeInTheDocument();

      // Reopen it to prove "Not now" hides too, independent of the CTA tap.
      act(() => {
        store.getState().apply({ type: 'ask_cleared' });
        store.getState().apply({ type: 'ask', ask: QUESTION_ASK });
      });
      fireEvent.click(notNow);
      expect(document.querySelector('[data-source="hook"]')).not.toBeInTheDocument();
    });

    it('an approval\'s Allow renders disabled with the same CTA; Deny stays enabled (interrupt needs no dialog)', () => {
      const interruptSpy = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined as never);
      const store = makeStore();
      act(() => {
        store.getState().apply({ type: 'ask', ask: APPROVAL_ASK });
      });
      render(
        <>
          <DialogSheet id={SESSION_ID} store={store} />
          <ToastHost />
        </>,
      );

      expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Open terminal to answer' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
      expect(interruptSpy).toHaveBeenCalledWith(SESSION_ID);
    });

    // Fix round 2 (Important): the CTA's own handler must gate on `busy` as
    // a whole, not just the hide half of it — a bug in fix round 1 let
    // `onOpenTerminal` fire unconditionally even when `close()` refused to
    // hide, exactly the "second action on top of an unresolved first one"
    // the code's own comment claimed was prevented.
    it('the CTA is refused while Deny is in flight: onOpenTerminal is not called, the sheet stays open', () => {
      vi.spyOn(api, 'interrupt').mockReturnValue(new Promise(() => {}));
      const onOpenTerminal = vi.fn();
      const store = makeStore();
      act(() => {
        store.getState().apply({ type: 'ask', ask: APPROVAL_ASK });
      });
      render(<DialogSheet id={SESSION_ID} store={store} onOpenTerminal={onOpenTerminal} />);

      fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
      fireEvent.click(screen.getByRole('button', { name: 'Open terminal to answer' }));

      expect(onOpenTerminal).not.toHaveBeenCalled();
      expect(document.querySelector('[data-source="hook"]')).toBeInTheDocument();
    });

    it('once a MATCHING scraped dialog appears, the same envelope\'s rows become tappable', () => {
      const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
      const store = makeStore();
      act(() => {
        store.getState().apply({ type: 'ask', ask: QUESTION_ASK });
      });
      render(<DialogSheet id={SESSION_ID} store={store} />);
      expect(screen.getByRole('button', { name: /Big bang/ })).toBeDisabled();

      act(() => {
        store.getState().apply({ type: 'dialog', dialog: matchingDialog() });
      });
      expect(screen.getByRole('button', { name: /Big bang/ })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: /Big bang/ }));
      expect(spy).toHaveBeenCalledWith(SESSION_ID, 'd-abc', 2);
    });
  });

  // — fix round 3, C1/I1: the correspondence gate —
  //
  // `canAnswer` used to be `dialog !== null` — enough to open the gate for
  // ANY live pane menu, not just the one the envelope is describing. A
  // multi-question AskUserQuestion paints one question at a time on the
  // pane, but the hook writes all of them at once and only clears on
  // working/done, so the sheet could show question 2's copy while `dialog`
  // was still question 1's pane state — tapping an option then walked
  // question 2's own index into question 1's menu. These pin the fix.
  describe('correspondence gate (fix round 3)', () => {
    it('C1: a mismatched dialog (a different question on the pane) disables the rows instead of answering the wrong one', () => {
      const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
      // Canary first / Big bang (QUESTION_ASK) vs Expand–contract / Big-bang
      // cutover / … (parsedDialog()) — this exact pairing used to pin the
      // bug this test now guards against: tapping "Big bang" walked the
      // PANE's index 2 ("Big-bang cutover") and sent it, a wrong answer
      // sent silently.
      renderWithAsk(QUESTION_ASK, parsedDialog());

      for (const label of [/Canary first/, /Big bang/]) {
        expect(screen.getByRole('button', { name: label })).toBeDisabled();
      }
      expect(screen.getByRole('button', { name: 'Open terminal to answer' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Big bang/ }));
      expect(spy).not.toHaveBeenCalled();
    });

    it('I1: an unparsed dialog disables the rows even when its options would otherwise match', () => {
      renderWithAsk(QUESTION_ASK, matchingDialog({ parsed: false }));

      for (const label of [/Canary first/, /Big bang/]) {
        expect(screen.getByRole('button', { name: label })).toBeDisabled();
      }
      expect(screen.getByRole('button', { name: 'Open terminal to answer' })).toBeInTheDocument();
    });

    it('C1: an approval whose pane options don\'t start with Yes disables Allow', () => {
      renderWithAsk(
        APPROVAL_ASK,
        parsedDialog({
          title: 'Delete build/ ?',
          options: [
            { index: 1, label: 'No, cancel' },
            { index: 2, label: 'Yes, delete it' },
          ],
        }),
      );

      expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Open terminal to answer' })).toBeInTheDocument();
    });

    it('I3: a read-only rest-question row carries the muted treatment attribute', () => {
      renderWithAsk(TWO_QUESTIONS, envDialog());
      const euRow = screen.getByText('EU').closest('.opt');
      expect(euRow).toHaveAttribute('aria-disabled', 'true');
    });
  });

  // — fix round 1, (I2): only questions[0] is tappable —
  it('with more than one question, only the first is tappable — the rest render read-only', () => {
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderWithAsk(TWO_QUESTIONS, envDialog());

    // The second question's copy is on screen…
    expect(screen.getByText('Second: which region?')).toBeInTheDocument();
    expect(screen.getByText('EU')).toBeInTheDocument();
    // …but not as a button: no accidental "digit 1 answers the wrong question".
    expect(screen.queryByRole('button', { name: 'EU' })).not.toBeInTheDocument();
    expect(screen.getByText('EU').closest('button')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Prod' }));
    expect(spy).toHaveBeenCalledWith(SESSION_ID, 'd-abc', 2);
  });

  // — fix round 1, (I4): a blank/empty envelope is treated as absent —
  describe('blank envelope guard', () => {
    it('an empty questions array falls through to the scraped dialog entirely', () => {
      renderWithAsk({ questions: [] }, parsedDialog());

      expect(document.querySelector('[data-source="hook"]')).not.toBeInTheDocument();
      expect(
        screen.getByText('Which migration strategy for the legacy orders table?'),
      ).toBeInTheDocument();
    });

    it('a blank first question falls through to the scraped dialog entirely', () => {
      renderWithAsk(
        { questions: [{ question: '   ', options: [{ label: 'Yes' }] }] },
        parsedDialog(),
      );

      expect(document.querySelector('[data-source="hook"]')).not.toBeInTheDocument();
      expect(
        screen.getByText('Which migration strategy for the legacy orders table?'),
      ).toBeInTheDocument();
    });
  });

  // — fix round 1, (I5): a11y parity with the scraped rows —
  describe('aria-busy', () => {
    it('a question row carries aria-busy and "answering…" while its answer is in flight', () => {
      vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
      renderWithAsk(QUESTION_ASK, matchingDialog());

      const row = screen.getByRole('button', { name: /Big bang/ });
      fireEvent.click(row);
      expect(row).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByText('answering…')).toBeInTheDocument();
    });

    it('Allow carries aria-busy while in flight; Deny carries it independently', () => {
      vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
      renderWithAsk(APPROVAL_ASK, yesNoDialog());

      const allow = screen.getByRole('button', { name: /Allow/ });
      fireEvent.click(allow);
      expect(allow).toHaveAttribute('aria-busy', 'true');
    });

    it('Deny carries aria-busy while its own interrupt call is in flight', () => {
      vi.spyOn(api, 'interrupt').mockReturnValue(new Promise(() => {}));
      renderWithAsk(APPROVAL_ASK, yesNoDialog());

      const deny = screen.getByRole('button', { name: /Deny/ });
      fireEvent.click(deny);
      expect(deny).toHaveAttribute('aria-busy', 'true');
    });
  });
});
