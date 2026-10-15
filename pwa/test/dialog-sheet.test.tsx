// Task 9 — DialogSheet: parsed dialogs render as big tappable option rows
// (preselected marked with the ❯ accent) answering via api.answerDialog;
// unparsed dialogs render raw + a terminal CTA; a stale 409 toasts and keeps
// the sheet open on the store's dialog; scrim cancel only hides (the store
// keeps signalling) and is refused while an answer is in flight.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DIALOG_MULTI_REFUSE_CODES, DIALOG_REFUSE_CODES, DIALOG_TEXT_MAX, DIALOG_TEXT_REFUSE_CODES, type Dialog, type HookAsk,
} from '../../shared/api';
import { ToastHost } from '@ccrc/ui';
import { api, ApiError, failedTo, sendErrorText } from '../src/lib/api';
import {
  DIALOG_MULTI_REFUSE_TEXT, DIALOG_REFUSE_TEXT, DIALOG_TEXT_REFUSE_TEXT, STALE_UNDER_ENVELOPE, dialogMultiRefusal,
  dialogRefusal, dialogTextRefusal,
} from '../src/session/askWords';
import { DialogSheet } from '../src/session/DialogSheet';
import { createSessionStore } from '../src/stores/session';
import {
  CACHING_TRACING,
  COLOUR_FEATURES,
  DRINK_FEATURES_TOOLS,
  FOUR_Q,
  FRUIT_DRINK,
  PETS_SIZE_MODE,
  TOOLS_SIZES,
  pane,
} from './askPanes';

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

// Neutral, as every session id in this public repository is (D-5089's task renamed it).
const SESSION_ID = 'lane-a:project-a';

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
    // Row 4 is the TUI's own escape hatch: no counterpart in the transcript, so
    // none of its copy. D-5090: it carries the sheet's own sentence instead, what
    // a tap on it does (it declines the whole ask), never a transcript description…
    expect(rows.map((r) => r.querySelector('.opt-desc')?.textContent ?? null)).toEqual([
      'Inherit the last seen rate.',
      'Emit only complete rows.',
      'Change nothing; watch it.',
      'Declines this ask so you can talk it over in the chat.',
    ]);
    // …and nothing folded under it either.
    expect(rows[3]!.parentElement?.lastElementChild).toBe(rows[3]);
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
      store.getState().apply({ type: 'ask', ask, key: null });
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

  // Task 7 (the "preview" half of I2): each option's description has been in
  // the envelope since Build 1 — this pins that it actually reaches the
  // screen, under its own label, for every option (not just the one under
  // test above).
  it('renders each option description under its label', () => {
    renderWithAsk(QUESTION_ASK, matchingDialog());

    const canary = screen.getByRole('button', { name: /Canary first/ });
    expect(canary.querySelector('.opt-desc')).toHaveTextContent('Ship to 5% for an hour.');
    const bigBang = screen.getByRole('button', { name: /Big bang/ });
    expect(bigBang.querySelector('.opt-desc')).toHaveTextContent('Ship to everyone at once.');
  });

  // Task 7: a question whose `options` array is empty is free text (the
  // envelope's own shape for the TUI's "chat about this" escape hatch) — no
  // rows to tap, and no text input either (typing blind into a live menu is
  // the send-race with worse consequences; the terminal is the only honest
  // way to answer one). This also pins the fix to `canAnswer`: without the
  // `options.length > 0` guard, `questionCorresponds`'s `every` over an
  // empty array is vacuously true whenever ANY parsed dialog is live, which
  // would hide the CTA with nothing tappable underneath it — a dead end
  // indistinguishable from "answered".
  it('offers no rows for a free-text question, only the terminal CTA', () => {
    const FREE_TEXT_ASK: HookAsk = {
      questions: [{ question: 'Anything else to add?', options: [] }],
    };
    const onOpenTerminal = vi.fn();
    const store = makeStore();
    act(() => {
      store.getState().apply({ type: 'dialog', dialog: matchingDialog() });
      store.getState().apply({ type: 'ask', ask: FREE_TEXT_ASK, key: null });
    });
    render(
      <>
        <DialogSheet id={SESSION_ID} store={store} onOpenTerminal={onOpenTerminal} />
        <ToastHost />
      </>,
    );

    expect(screen.getByText('Anything else to add?')).toBeInTheDocument();
    expect(document.querySelectorAll('.opts > .opt')).toHaveLength(0);
    const cta = screen.getByRole('button', { name: 'Open terminal to answer' });
    fireEvent.click(cta);
    expect(onOpenTerminal).toHaveBeenCalledOnce();
  });

  // The copy under an ungated sheet has to match the REASON it is ungated.
  // `matchingDialog()` is live and corresponds perfectly here — the sheet is
  // ungated purely because `options: []` gives it nothing to tap — so the
  // unmatched-dialog sentence ("wait for it to catch up") would be false
  // twice over: there is nothing unmatched, and `options` is fixed for the
  // life of the envelope, so no amount of waiting could ever make this
  // answerable. A user who followed it would wait forever.
  it('does not tell a free-text question to wait for the pane to catch up', () => {
    const FREE_TEXT_ASK: HookAsk = {
      questions: [{ question: 'Anything else to add?', options: [] }],
    };
    const store = makeStore();
    act(() => {
      store.getState().apply({ type: 'dialog', dialog: matchingDialog() });
      store.getState().apply({ type: 'ask', ask: FREE_TEXT_ASK, key: null });
    });
    render(
      <>
        <DialogSheet id={SESSION_ID} store={store} />
        <ToastHost />
      </>,
    );

    const copy = document.querySelector('.ask-envelope .dlg-copy')!;
    expect(copy).not.toBeNull();
    expect(copy.textContent).not.toMatch(/catch up|can't be matched/i);
    expect(copy.textContent).toMatch(/nothing to tap/i);
    expect(copy.textContent).toMatch(/terminal pane/i);
    // …and it does not guess what the terminal wants instead. `options: []`
    // says only that this envelope lists nothing to tap; it is NOT evidence
    // that Claude is asking for prose — this same file's `CHAT_ABOUT_RE`
    // exists because the TUI's free-text escape hatch arrives as an option
    // LABEL in a populated list. "Answer in your own words" told the operator
    // to type prose at what may well be a menu.
    expect(copy.textContent).not.toMatch(/your own words/i);
    expect(copy.textContent).not.toMatch(/type it/i);
  });

  // The other side of the same fork: a question WITH options that the pane
  // does not correspond to is genuinely transient, so that sentence stays.
  it('still says the pane may catch up when a real option list is unmatched', () => {
    renderWithAsk(QUESTION_ASK, matchingDialog({ parsed: false }));
    const copy = document.querySelector('.ask-envelope .dlg-copy')!;
    expect(copy.textContent).toMatch(/wait\s+for it to catch up/i);
  });

  it("renders a multiSelect question's options as rows but never lets a tap answer it", () => {
    // Even against a pane that PARSED and lines up option for option — which
    // is what 2.1.280 delivered before the server read its checkboxes: its
    // multi-select footer no longer says "Space to select". A tap walks the
    // cursor and presses Enter, and Enter on a 2.1.280 multi-select row ticks
    // that box and submits nothing (measured), so no tap is an answer.
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

    const go = screen.getByRole('button', { name: 'Go' });
    expect(go).toBeDisabled();
    fireEvent.click(go);
    expect(spy).not.toHaveBeenCalled();
    // D-5089: the pane's title names the question, so the sheet says what it is rather than that it cannot be
    // matched (D-5091 turns this into boxes where the pane carries `Dialog.multi`).
    const copy = document.querySelector('.ask-envelope .dlg-copy')!;
    expect(copy.textContent).toMatch(/several answers/i);
    expect(copy.textContent).toMatch(/terminal pane/i);
    expect(copy.textContent).not.toMatch(/catch up/i);
  });

  it.each([false, undefined])('control: the same question with multiSelect %s is tappable against that pane', (multiSelect) => {
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderWithAsk(
      { questions: [{ question: 'Pick languages', ...(multiSelect === undefined ? {} : { multiSelect }), options: [{ label: 'TS' }, { label: 'Go' }] }] },
      parsedDialog({ title: 'Pick languages', options: [{ index: 1, label: 'TS' }, { index: 2, label: 'Go' }] }),
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

  // — the three envelope arms nothing reached (measured: statements 75, 193
  // and 204 and branches 75#0, 198#1, 364#1 of `EnvelopeSheet.tsx`) —

  it('a pane with FEWER rows than the envelope asks about is not a correspondence', () => {
    // THE STRAY ARROW WALK. `answerDialog` walks the pane BY INDEX, so a tap
    // is only safe when the envelope's rows and the pane's describe the same
    // question. A pane mid-redraw can show one row where the envelope has
    // two: every row it DOES show may line up, and answering would still
    // send an arrow walk past the end of a menu that is not the one on
    // screen. The length check is what refuses that, and it is the arm the
    // per-row prefix comparison structurally cannot reach.
    renderWithAsk(QUESTION_ASK, matchingDialog({ options: [{ index: 1, label: 'Canary first' }] }));
    // The rows render — the envelope is still what the reader is shown — but
    // none of them answers.
    expect(screen.getByText(/Canary first/)).toBeInTheDocument();
    expect(screen.getByText(
      "This can't be matched to what's on the terminal pane yet — answer it there, "
      + 'or wait for it to catch up.')).toBeInTheDocument();
  });

  it('a read-only SECOND question with no header renders no chip rather than an empty one', () => {
    // `header` is optional on the wire, and the arm that reads it is in the
    // `rest` block — the questions this sheet renders read-only, because only
    // the first ever sends. Measured: a header-less FIRST question does not
    // reach it at all, so the fixture has to carry two.
    renderWithAsk(
      { questions: [
        { question: 'First: which env?', header: 'Env',
          options: [{ label: 'Staging' }, { label: 'Prod' }] },
        { question: 'Second: and the region?',
          options: [{ label: 'eu-west' }, { label: 'us-east' }] },
      ] },
      matchingDialog({ options: [{ index: 1, label: 'Staging' }, { index: 2, label: 'Prod' }] }),
    );
    expect(screen.getByText('Second: and the region?')).toBeInTheDocument();
    const chips = [...document.querySelectorAll('.dlg-header-chip')].map((n) => n.textContent);
    expect(chips, 'an empty header chip was rendered for the question that has none')
      .toEqual(['Env']);
  });

  it('a Deny that fails for any OTHER reason says what went wrong', async () => {
    // The 409 has its own deliberately ambiguous sentence (the case above).
    // Every other failure is unambiguous and must say so: a 502 from a box
    // whose tmux is gone is not "the session may be idle".
    vi.spyOn(api, 'interrupt').mockRejectedValue(
      new ApiError(502, { ok: false, stderr: 'tmux: no server running' }));
    renderWithAsk(APPROVAL_ASK, yesNoDialog());

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(await screen.findByText(/Couldn't decline — tmux: no server running/)).toBeInTheDocument();
    expect(screen.queryByText(/may be idle or the request already resolved/),
      "the ambiguous sentence was used for an unambiguous failure").toBeNull();
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
        store.getState().apply({ type: 'ask', ask: other, key: null });
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
        store.getState().apply({ type: 'ask', ask: QUESTION_ASK, key: null });
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
        store.getState().apply({ type: 'ask', ask: QUESTION_ASK, key: null });
      });
      fireEvent.click(notNow);
      expect(document.querySelector('[data-source="hook"]')).not.toBeInTheDocument();
    });

    it('an approval\'s Allow renders disabled with the same CTA; Deny stays enabled (interrupt needs no dialog)', () => {
      const interruptSpy = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined as never);
      const store = makeStore();
      act(() => {
        store.getState().apply({ type: 'ask', ask: APPROVAL_ASK, key: null });
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
        store.getState().apply({ type: 'ask', ask: APPROVAL_ASK, key: null });
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
        store.getState().apply({ type: 'ask', ask: QUESTION_ASK, key: null });
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
      // D-5089: the rest are listed one row per QUESTION (its number and text), not by their options.
      renderWithAsk(TWO_QUESTIONS, envDialog());
      const row = screen.getByText('Second: which region?').closest('.opt');
      expect(row).toHaveAttribute('aria-disabled', 'true');
    });
  });

  // — fix round 1, (I2), as D-5089 left it: the question the PANE is painting is the tappable one. With question 1 on
  // the pane that is question 1, and question 2 waits read-only (the control for "the envelope follows the pane").
  it('question 1 on the pane: question 1 is tappable, question 2 waits read-only', () => {
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderWithAsk(TWO_QUESTIONS, envDialog());

    // The second question is on screen…
    expect(screen.getByText('Second: which region?')).toBeInTheDocument();
    // …but not as a button: no accidental "digit 1 answers the wrong question".
    expect(screen.queryByRole('button', { name: /Second: which region\?/ })).not.toBeInTheDocument();
    expect(screen.getByText('Second: which region?').closest('button')).toBeNull();

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
      // A flex box drops the marker's leading space (`Allowanswering…`): the gap keeps them apart.
      expect(allow).toHaveClass('gap-2');
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

// — the envelope follows the pane (D-5089) —
//
// Plan docs/superpowers/plans/2026-10-15-ask-sheet-half.md, Task 2. The hook writes every question of an ask at once
// and keeps the envelope until the tool call ends, while the pane paints one question at a time, then the review
// screen. The sheet answers the question the PANE is painting (`askLive.ts`'s `liveQuestion`), lists the others
// read-only, offers the review's own two rows, and says plainly what it cannot answer. When the envelope ages out
// (`ask_cleared`) the scraped sheet takes over the same pane with the same behaviour.
//
// Every screen is a recorded Claude Code 2.1.300 one (`askPanes.ts`, kept equal to `parseDialog` by
// server/test/dialog.test.ts), named by its fixture; an envelope no recording shows is DERIVED and says so.
describe('the envelope follows the pane (D-5089)', () => {
  const renderAsk = (ask: HookAsk, dialog: Dialog | null) => {
    const store = makeStore();
    act(() => {
      if (dialog) store.getState().apply({ type: 'dialog', dialog });
      store.getState().apply({ type: 'ask', ask, key: null });
    });
    render(
      <>
        <DialogSheet id={SESSION_ID} store={store} onOpenTerminal={vi.fn()} />
        <ToastHost />
      </>,
    );
    return { store };
  };
  const heading = (name: string): HTMLElement => screen.getByRole('heading', { name });
  const pending = (): ReturnType<typeof vi.spyOn> =>
    vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
  const CANCEL_SAYS = 'Declines every question in this ask — nothing you answered is sent.';
  /** The one option BUTTON whose label is exactly `label` (a read-only row is a div, and is not one). By label, not
   *  by accessible name: the name runs the label into its description (`NoLeave tracing off`), and `/^No/` also
   *  matches the terminal CTA's `Not now`. */
  const optionButton = (label: string): HTMLButtonElement => {
    const buttons = screen.getAllByText(label, { selector: '.opt-label' })
      .map((l) => l.closest('button'))
      .filter((b): b is HTMLButtonElement => b !== null);
    expect(buttons, `option buttons reading ${label}`).toHaveLength(1);
    return buttons[0]!;
  };

  it('question 2 on the pane: the sheet shows question 2, and Tea answers pane row 1', () => {
    const spy = pending();
    const q2 = pane('cc300-ask-q2-of-2-single');
    expect(q2.id.startsWith('591e0a9e')).toBe(true);
    renderAsk(FRUIT_DRINK, q2);

    expect(heading('Which drink?')).toBeInTheDocument();
    const tea = screen.getByRole('button', { name: /^Tea/ });
    expect(tea).toBeEnabled();
    fireEvent.click(tea);
    expect(spy).toHaveBeenCalledWith(SESSION_ID, q2.id, 1);
  });

  it('same labels: No under Enable tracing? answers the tracing pane', () => {
    const spy = pending();
    const q1 = pane('cc300-ask-same-labels-q1');
    const q2 = pane('cc300-ask-same-labels-q2');
    expect(q2.id.startsWith('38f07f99')).toBe(true);
    const { store } = renderAsk(CACHING_TRACING, q1);
    expect(heading('Enable caching?')).toBeInTheDocument();

    // Caching answered in the terminal: the pane paints Tracing under the same two labels.
    act(() => store.getState().apply({ type: 'dialog', dialog: q2 }));
    expect(heading('Enable tracing?')).toBeInTheDocument();
    fireEvent.click(optionButton('No'));
    expect(spy).toHaveBeenCalledWith(SESSION_ID, q2.id, 2);
  });

  it('progress reads 2 of 2, and the other question is listed read-only', () => {
    renderAsk(FRUIT_DRINK, pane('cc300-ask-q2-of-2-single'));

    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    // The eyebrow carries the shown question's header chip; the other question's rides its own row.
    expect(document.querySelector('.sheet-eyebrow .dlg-header-chip')).toHaveTextContent('Drink');
    expect(screen.getByText('other questions in this ask')).toBeInTheDocument();
    const fruit = screen.getByText('Which fruit?').closest('.opt');
    expect(fruit).not.toBeNull();
    expect(fruit).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('button', { name: /Which fruit\?/ })).toBeNull();
    expect(screen.queryByText(/answer these in the terminal/i)).toBeNull();
  });

  it('no question live or named: the eyebrow claims no position', () => {
    // The fallback display is question 1, read-only behind the CTA; it is not the question the pane is painting, so
    // "1 of 2" would be a guess. `FRUIT_DRINK` over another ask's pane (`cc300-ask-1q-open`, Red/Blue), and with no pane.
    const { store } = renderAsk(FRUIT_DRINK, pane('cc300-ask-1q-open'));
    expect(heading('Which fruit?')).toBeInTheDocument();
    expect(screen.getByText(/can't be matched/)).toBeInTheDocument();
    expect(document.querySelector('.sheet-eyebrow')?.textContent).not.toMatch(/\d+ of \d+/);
    act(() => store.getState().apply({ type: 'dialog_cleared' }));
    expect(document.querySelector('.sheet-eyebrow')?.textContent).not.toMatch(/\d+ of \d+/);
    // The control: the pane paints question 2, and the sheet says so.
    act(() => store.getState().apply({ type: 'dialog', dialog: pane('cc300-ask-q2-of-2-single') }));
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  });

  it('a tie the title cannot break stays read-only behind the terminal CTA', () => {
    const spy = pending();
    // DERIVED: both questions read Yes/No, and the pane's title (`Enable tracing?`) is a suffix of both.
    const both: HookAsk = {
      questions: [
        { question: 'Enable tracing?', header: 'Tracing', multiSelect: false, options: CACHING_TRACING.questions[1]!.options },
        { question: 'Really enable tracing?', header: 'Really', multiSelect: false, options: CACHING_TRACING.questions[1]!.options },
      ],
    };
    renderAsk(both, pane('cc300-ask-same-labels-q2'));

    for (const label of ['Yes', 'No']) expect(optionButton(label)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open terminal to answer' })).toBeInTheDocument();
    fireEvent.click(optionButton('No'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('the review screen: Submit answers answers row 1, and the pane\'s summary shows with its warning', () => {
    const spy = pending();
    const review = pane('cc300-ask-review-skipped');
    expect(review.id.startsWith('3679f837')).toBe(true);
    renderAsk(PETS_SIZE_MODE, review);

    expect(heading('Review your answers')).toBeInTheDocument();
    expect(screen.getByText(/⚠ You have not answered all questions/)).toBeInTheDocument();
    expect(screen.getByText(/→ Dogs/)).toBeInTheDocument();
    // The review is the whole ask's: no question is "the other one" here.
    expect(screen.queryByText('other questions in this ask')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Submit answers/ }));
    expect(spy).toHaveBeenCalledWith(SESSION_ID, review.id, 1);
  });

  it('Cancel says it declines every question, and answers row 2', () => {
    // Measured (`cc300-ask-review-cancelled`): Cancel rejects the whole tool call, every answer discarded.
    const spy = pending();
    const review = pane('cc300-ask-review-same-labels');
    renderAsk(CACHING_TRACING, review);

    const cancel = screen.getByRole('button', { name: /^Cancel/ });
    expect(cancel).toHaveTextContent(CANCEL_SAYS);
    fireEvent.click(cancel);
    expect(spy).toHaveBeenCalledWith(SESSION_ID, review.id, 2);
  });

  it('a review taller than the parser\'s 20-row climb is still the review', () => {
    const review = pane('cc300-ask-review-4q-long');
    // The climb cut the first answer out of `body`, so a summary read from it would lose it.
    expect(review.body).not.toMatch(/→ Postgres/);
    renderAsk(FOUR_Q, review);

    expect(screen.getByRole('button', { name: /^Submit answers/ })).toBeEnabled();
    expect(screen.getByText(/→ Postgres/)).toBeInTheDocument();
  });

  it('a multiSelect question on the pane is named honestly', () => {
    // DERIVED (D-5091): the recorded screen without its `Dialog.multi`, as a pane with no commit row on screen reads
    // (the 2.1.222 shape). With `multi` the question is answered as boxes ("multiSelect boxes (D-5091)" below).
    const shape = pane('cc300-ask-multiselect-next-open');
    delete shape.multi;
    renderAsk(DRINK_FEATURES_TOOLS, shape);

    expect(heading('Which features do you want?')).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    const copy = document.querySelector('.ask-envelope .dlg-copy')!;
    expect(copy.textContent).toMatch(/several answers/i);
    expect(copy.textContent).toMatch(/terminal pane/i);
    expect(screen.queryByText(/catch up/i)).toBeNull();
    // No box answers by one tap, and none is offered without `Dialog.multi` to answer it through.
    expect(screen.getByRole('button', { name: /^Logging/ })).toBeDisabled();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Open terminal to answer' })).toBeInTheDocument();
  });

  describe('the hand-off: ask_cleared hands the same pane to the scraped sheet', () => {
    it('ask_cleared while question 2 is live: the scraped sheet shows question 2 and answers the same row', () => {
      const spy = pending();
      const q2 = pane('cc300-ask-q2-of-2-single');
      const { store } = renderAsk(FRUIT_DRINK, q2);
      act(() => store.getState().apply({ type: 'ask_cleared' }));

      expect(document.querySelector('[data-source="hook"]')).toBeNull();
      expect(heading('Which drink?')).toBeInTheDocument();
      // The pane marks the active tab by colour only, so the scraped sheet cannot say which of N this is.
      expect(screen.queryByText(/^\d+ of \d+$/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /^Tea/ }));
      expect(spy).toHaveBeenCalledWith(SESSION_ID, q2.id, 1);
    });

    it('ask_cleared while the review is live: the scraped sheet titles Review your answers and offers Submit answers', () => {
      const spy = pending();
      const review = pane('cc300-ask-review-same-labels');
      const { store } = renderAsk(CACHING_TRACING, review);
      act(() => store.getState().apply({ type: 'ask_cleared' }));

      expect(document.querySelector('[data-source="hook"]')).toBeNull();
      expect(heading('Review your answers')).toBeInTheDocument();
      expect(screen.getByText(/→ - only in staging, sampled 10%/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Cancel/ })).toHaveTextContent(CANCEL_SAYS);
      fireEvent.click(screen.getByRole('button', { name: /^Submit answers/ }));
      expect(spy).toHaveBeenCalledWith(SESSION_ID, review.id, 1);
    });

    it('the scraped sheet reads the question off the pane, never the raw tab row', () => {
      // Without the transcript's copy (`Dialog.ask`), the scraped sheet titles the pane's question and lists what else
      // the pane painted above it. The tab row (`← ☒ Fruit ☐ Drink ✔ Submit →`) is the ask's chrome, and the question
      // was painted twice (title and preamble).
      const { store } = renderAsk(FRUIT_DRINK, pane('cc300-ask-q2-of-2-single'));
      act(() => store.getState().apply({ type: 'ask_cleared' }));
      expect(heading('Which drink?')).toBeInTheDocument();
      expect(document.querySelector('.dlg-body'), 'a preamble that only repeats the question').toBeNull();
      expect(screen.queryByText(/←/)).toBeNull();
      cleanup();

      // A question too long for one row: the pane's title is its LAST row under a `│ ` bar, and the rows above it are
      // the rest of the question. The sheet titles the whole question, bars gone.
      const wrapped = renderAsk(FOUR_Q, pane('cc300-ask-wrapped-question'));
      act(() => wrapped.store.getState().apply({ type: 'ask_cleared' }));
      expect(heading(FOUR_Q.questions[1]!.question)).toBeInTheDocument();
      expect(document.querySelector('.dlg-body')).toBeNull();
      expect(screen.queryByText(/│/)).toBeNull();
      cleanup();

      // A one-question ask paints its header above the question: that stays, the question is not repeated.
      renderWithDialog(pane('ask-2col-chat-about'));
      expect(document.querySelector('.dlg-body')?.textContent).toBe('Revised fix');
    });

    // `ask_cleared` while a multiSelect question is live: D-5091's hand-off case ("multiSelect boxes (D-5091)" below)
    // answers it with the same boxes, where this one once only named it.

    it('a hidden envelope stays hidden when ask_cleared hands off the same pane question, and a new question opens it', () => {
      const { store } = renderAsk(FRUIT_DRINK, pane('cc300-ask-q2-of-2-single'));
      fireEvent.click(screen.getByTestId('sheet-overlay'));
      expect(screen.queryByRole('heading', { name: 'Which drink?' })).toBeNull();

      act(() => store.getState().apply({ type: 'ask_cleared' }));
      expect(screen.queryByRole('heading', { name: 'Which drink?' }), 'the waved-away question popped back').toBeNull();

      // Back to question 1 on the pane (a new dialog id): something new to answer, so the sheet opens.
      act(() => store.getState().apply({ type: 'dialog', dialog: pane('cc300-ask-freetext-held') }));
      expect(heading('Which fruit?')).toBeInTheDocument();
    });

    it('the transcript\'s raise re-opens a question hidden across the hand-off', () => {
      // D-286's nonce clears every dismissal, the hand-off's carried dialog id included: the transcript's Answer means
      // "open it", whichever sheet now holds the question.
      const store = makeStore();
      act(() => {
        store.getState().apply({ type: 'dialog', dialog: pane('cc300-ask-q2-of-2-single') });
        store.getState().apply({ type: 'ask', ask: FRUIT_DRINK, key: null });
      });
      const { rerender } = render(<DialogSheet id={SESSION_ID} store={store} raise={0} />);
      fireEvent.click(screen.getByTestId('sheet-overlay'));
      act(() => store.getState().apply({ type: 'ask_cleared' }));
      expect(screen.queryByRole('heading', { name: 'Which drink?' })).toBeNull();

      rerender(<DialogSheet id={SESSION_ID} store={store} raise={1} />);
      expect(heading('Which drink?')).toBeInTheDocument();
    });
  });
});

// — own words, through the free-text row (D-5090) —
//
// AskUserQuestion paints a free-text row under a question's n options: `n+1. Type something.` while it is empty, the
// typed text once typed. Own words answer the question THROUGH that row (`api.answerDialogText`, D-5047), which types
// only once the pane proves focus and presses Enter only once it proves the echo. They are never sent by pressing
// `Chat about this`, which declines the WHOLE ask, and never as a new prompt (the deleted `respond()`, diagnosis root
// cause 5). The in-flight state belongs to the CALL: typing changes the dialog's id (it hashes the labels, and the
// row's label becomes the text), so the stream can deliver the typed row while the call is still running.
//
// Every screen is a recorded Claude Code 2.1.300 one (`askPanes.ts`), named by its fixture; a shape no recording shows
// is DERIVED and says so.
describe('own words go through the free-text row (D-5090)', () => {
  /** The recorded walk's own words (`cc300-ask-freetext-walk-3-typed` paints them in row 3 of `Enable tracing?`). */
  const TEXT = '- only in staging, sampled 10%';
  const CHAT_SAYS = 'Declines this ask so you can talk it over in the chat.';
  const renderAsk = (ask: HookAsk | null, dialog: Dialog | null) => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore(SESSION_ID, { makeSocket: fakeSocket, api: { prompt } });
    act(() => {
      if (dialog) store.getState().apply({ type: 'dialog', dialog });
      if (ask) store.getState().apply({ type: 'ask', ask, key: null });
    });
    render(
      <>
        <DialogSheet id={SESSION_ID} store={store} onOpenTerminal={vi.fn()} />
        <ToastHost />
      </>,
    );
    return { store, prompt };
  };
  const field = (): HTMLInputElement => screen.getByLabelText('Answer in your own words');
  const noField = (): HTMLElement | null => screen.queryByLabelText('Answer in your own words');
  const send = (): HTMLButtonElement => screen.getByRole('button', { name: /^Send/ });
  const type = (text: string): void => {
    fireEvent.change(field(), { target: { value: text } });
  };
  const heading = (name: string): HTMLElement => screen.getByRole('heading', { name });
  /** The one option BUTTON whose label is exactly `label` (see the D-5089 describe's helper of the same name). */
  const optionButton = (label: string): HTMLButtonElement => {
    const buttons = screen.getAllByText(label, { selector: '.opt-label' })
      .map((l) => l.closest('button'))
      .filter((b): b is HTMLButtonElement => b !== null);
    expect(buttons, `option buttons reading ${label}`).toHaveLength(1);
    return buttons[0]!;
  };
  /** A call the test settles by hand. */
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const refused = (code: string) => new ApiError(409, { ok: false, error: code });

  it('envelope: an empty Type something. row at n+1 offers Answer in your own words, and Send calls answerDialogText', () => {
    const text = vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const q2 = pane('cc300-ask-same-labels-q2');
    expect(q2.id.startsWith('38f07f99')).toBe(true);
    const { prompt } = renderAsk(CACHING_TRACING, q2);
    expect(document.querySelector('[data-source="hook"]')).not.toBeNull();

    type(TEXT);
    fireEvent.click(send());
    // Row 3 is the pane's `Type something.`, under the question's two options.
    expect(text).toHaveBeenCalledWith(SESSION_ID, q2.id, 3, TEXT);
    expect(option, 'own words pressed a row').not.toHaveBeenCalled();
    expect(prompt, 'own words were sent as a new prompt').not.toHaveBeenCalled();
  });

  it('envelope: the pane\'s Chat about this row is offered after the own words, and says it declines the ask', () => {
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const q2 = pane('cc300-ask-same-labels-q2');
    renderAsk(CACHING_TRACING, q2);

    const chat = screen.getByRole('button', { name: /^Chat about this/ });
    expect(chat).toHaveTextContent(CHAT_SAYS);
    expect(field().compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING, 'Chat sits after the field')
      .toBeTruthy();
    fireEvent.click(chat);
    expect(option).toHaveBeenCalledWith(SESSION_ID, q2.id, 4);
  });

  it('scraped: Type something. is not a tappable row', () => {
    // `COLOUR_ONE`'s pane with no envelope: the scraped sheet alone. Enter on the empty row rejects the whole ask.
    renderAsk(null, pane('cc300-ask-1q-open'));

    expect(screen.queryByRole('button', { name: /Type something/ })).toBeNull();
    expect(screen.queryByText('Type something.')).toBeNull();
    expect(field()).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Red/ })).toBeEnabled();
  });

  it('scraped: own words answer the question through the Type something. row', () => {
    const text = vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const open = pane('cc300-ask-1q-open');
    expect(open.id.startsWith('ac059b8e')).toBe(true);
    const { prompt } = renderAsk(null, open);

    type('Teal, if there is one');
    fireEvent.click(send());
    expect(text).toHaveBeenCalledWith(SESSION_ID, open.id, 3, 'Teal, if there is one');
    expect(option, 'own words pressed Chat about this (row 4), declining the ask').not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('the two-column layout has no own-words row: one line, no field, and the Chat row says what it does', () => {
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const twoCol = pane('ask-2col-chat-about');
    renderAsk(null, twoCol);

    expect(noField()).toBeNull();
    expect(screen.getByText(/no own-words row on the terminal/i)).toBeInTheDocument();
    const chat = screen.getByRole('button', { name: /^Chat about this/ });
    expect(chat).toHaveTextContent(CHAT_SAYS);
    fireEvent.click(chat);
    expect(option).toHaveBeenCalledWith(SESSION_ID, twoCol.id, 4);
  });

  it('a row holding other text: one line, no field', () => {
    // `Mango` was typed in the terminal: typing more would append to it, so the route refuses `not-free-text`.
    renderAsk(FRUIT_DRINK, pane('cc300-ask-freetext-held'));

    expect(heading('Which fruit?')).toBeInTheDocument();
    expect(screen.getByText(/already holds other text/i)).toBeInTheDocument();
    expect(noField()).toBeNull();
    expect(screen.queryByRole('button', { name: /^Mango/ })).toBeNull();
  });

  it('the text and the busy state belong to the call: a frame with the typed label arriving mid-call changes neither', () => {
    const call = deferred();
    vi.spyOn(api, 'answerDialogText').mockReturnValue(call.promise);
    const q2 = pane('cc300-ask-same-labels-q2');
    const { store } = renderAsk(CACHING_TRACING, q2);
    type(TEXT);
    fireEvent.click(send());

    // The stream delivers the typed row, under a new id, before the call answers: first a capture taken while tmux
    // was still typing (DERIVED from `cc300-ask-freetext-walk-3-typed`: the row holds the text's first 22 characters,
    // and the id, which hashes the labels, differs), then the recorded one holding the whole text.
    const typed = pane('cc300-ask-freetext-walk-3-typed');
    expect(typed.id).not.toBe(q2.id);
    const partial: Dialog = {
      ...typed,
      id: `${typed.id}-partial`,
      options: typed.options.map((o) => (o.index === 3 ? { ...o, label: TEXT.slice(0, 22) } : o)),
    };
    for (const frame of [partial, typed]) {
      act(() => store.getState().apply({ type: 'dialog', dialog: frame }));

      expect(field(), frame.id).toHaveValue(TEXT);
      expect(field()).toBeDisabled();
      expect(send()).toBeDisabled();
      expect(send()).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByText(/already holds other text/i), 'the sheet read its own send as other text').toBeNull();
      expect(optionButton('Yes')).toBeDisabled();
    }
  });

  it('a send under way stays on screen when the pane stops matching mid-call', () => {
    // The envelope reads its free-text row only while the question is live; a capture of another screen mid-call
    // (DERIVED sequence: `cc300-ask-1q-open`, another ask's pane) must not take the operator's text and busy Send away.
    vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    const { store } = renderAsk(CACHING_TRACING, pane('cc300-ask-same-labels-q2'));
    type(TEXT);
    fireEvent.click(send());
    act(() => store.getState().apply({ type: 'dialog', dialog: pane('cc300-ask-1q-open') }));
    expect(document.querySelector('[data-source="hook"]')).not.toBeNull();
    expect(field()).toHaveValue(TEXT);
    expect(field()).toBeDisabled();
    expect(send()).toHaveAttribute('aria-busy', 'true');
  });

  it('a refused text answer keeps what was typed and says why', async () => {
    // The scraped sheet (`cc300-ask-same-labels-q2`, no envelope): the old reply emptied the box before its call.
    vi.spyOn(api, 'answerDialogText').mockRejectedValue(refused('echo-failed'));
    vi.spyOn(api, 'answerDialog').mockRejectedValue(refused('stale-dialog'));
    renderAsk(null, pane('cc300-ask-same-labels-q2'));
    type(TEXT);
    fireEvent.click(send());
    expect(field(), 'the box was emptied before the call').toHaveValue(TEXT);

    expect(await screen.findByText(DIALOG_TEXT_REFUSE_TEXT['echo-failed'])).toBeInTheDocument();
    expect(field()).toHaveValue(TEXT);
    expect(field()).toBeEnabled();
  });

  it('stranded text: when the row holds exactly the kept text, Send submits it under the new id', async () => {
    const call = vi.spyOn(api, 'answerDialogText')
      .mockRejectedValueOnce(refused('echo-failed'))
      .mockReturnValueOnce(new Promise(() => {}));
    const q2 = pane('cc300-ask-same-labels-q2');
    const { store } = renderAsk(CACHING_TRACING, q2);
    type(TEXT);
    fireEvent.click(send());
    await screen.findByText(DIALOG_TEXT_REFUSE_TEXT['echo-failed']);

    // The text was left in the row; the pane's cursor has stepped off it (a new id: the label is the text now).
    const stranded = pane('cc300-ask-freetext-walk-4-stepped-off');
    expect(stranded.id.startsWith('7a3fff18')).toBe(true);
    act(() => store.getState().apply({ type: 'dialog', dialog: stranded }));

    expect(screen.getByText(/typed in the terminal but not sent yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/already holds other text/i)).toBeNull();
    expect(field()).toHaveValue(TEXT);
    fireEvent.click(send());
    expect(call).toHaveBeenLastCalledWith(SESSION_ID, stranded.id, 3, TEXT);
  });

  it('a refusal belongs to its question: a later question under the same title is read from its own pane', async () => {
    // The scraped sheet (no enrichment) learns which row is the free-text row from its own call only while the pane
    // shows the question that call was made for. A refused call outliving it once hid a real option and offered the
    // placeholder as a row. DERIVED: a later question titled like the refused one, with an option more.
    const call = vi.spyOn(api, 'answerDialogText')
      .mockRejectedValueOnce(refused('stale-dialog'))
      .mockReturnValueOnce(new Promise(() => {}));
    const drink = pane('cc300-ask-q2-of-2-single');
    const { store } = renderAsk(null, drink);
    type('water, please');
    fireEvent.click(send());
    await screen.findByText(DIALOG_TEXT_REFUSE_TEXT['stale-dialog']);

    const later: Dialog = {
      ...drink,
      id: `${drink.id}-later`,
      options: [
        { index: 1, label: 'Tea' }, { index: 2, label: 'Coffee' }, { index: 3, label: 'Water' },
        { index: 4, label: 'Type something.' }, { index: 5, label: 'Chat about this' },
      ],
    };
    act(() => store.getState().apply({ type: 'dialog', dialog: later }));

    expect(optionButton('Water'), 'a real option was hidden as the free-text row').toBeEnabled();
    expect(screen.queryByText('Type something.'), 'the placeholder was offered as a row').toBeNull();
    expect(screen.queryByText(/already holds other text/i)).toBeNull();
    // "Your text is still here": the field keeps it, and Send types it into THIS question's free-text row.
    expect(field()).toHaveValue('water, please');
    fireEvent.click(send());
    expect(call).toHaveBeenLastCalledWith(SESSION_ID, later.id, 4, 'water, please');
  });

  it('after echo-failed with only part of the text in the row, the text stays in view, and Send types it once the row is cleared', async () => {
    // The toast must promise only what the sheet then offers: a row holding PART of the text is not the stranded
    // retry (the route refuses it, `not-free-text`), so the sheet keeps the text in view, says to clear the row in the
    // terminal, and Send types the whole text into the row once it is empty again. Both sheets: the scraped one reads
    // the row from its own call. DERIVED: the recorded typed row (`cc300-ask-freetext-walk-3-typed`) holding the
    // text's first 22 characters, as a capture taken while tmux was typing shows it.
    for (const ask of [CACHING_TRACING, null]) {
      const call = vi.spyOn(api, 'answerDialogText')
        .mockRejectedValueOnce(refused('echo-failed'))
        .mockReturnValueOnce(new Promise(() => {}));
      const q2 = pane('cc300-ask-same-labels-q2');
      const { store } = renderAsk(ask, q2);
      const where = ask === null ? 'scraped' : 'envelope';
      type(TEXT);
      fireEvent.click(send());
      const said = await screen.findByText(DIALOG_TEXT_REFUSE_TEXT['echo-failed']);
      expect(said.textContent, where).toMatch(/still here/i);
      expect(said.textContent, `${where}: the toast promised a retry the route refuses`).not.toMatch(/submits what/i);

      const typed = pane('cc300-ask-freetext-walk-3-typed');
      const partial: Dialog = {
        ...typed,
        id: `${typed.id}-partial`,
        options: typed.options.map((o) => (o.index === 3 ? { ...o, label: TEXT.slice(0, 22) } : o)),
      };
      act(() => store.getState().apply({ type: 'dialog', dialog: partial }));
      expect(field(), `${where}: the operator's text was hidden`).toHaveValue(TEXT);
      expect(send(), where).toBeDisabled();
      expect(screen.getByText(/holds only part of your answer/i), where).toBeInTheDocument();
      expect(screen.queryByText(/already holds other text/i), where).toBeNull();
      // Not the stranded retry: Send would not submit what the row holds, and the text is the operator's to edit.
      expect(screen.queryByText(/typed in the terminal but not sent yet/i), where).toBeNull();
      expect(field(), where).not.toHaveAttribute('readonly');
      expect(screen.queryByText(TEXT.slice(0, 22), { selector: '.opt-label' }), where).toBeNull();
      fireEvent.submit(field().form!);
      expect(call, `${where}: the partial row was sent into`).toHaveBeenCalledTimes(1);

      // Cleared in the terminal: the placeholder again, and Send types the whole text.
      act(() => store.getState().apply({ type: 'dialog', dialog: q2 }));
      expect(send(), where).toBeEnabled();
      fireEvent.click(send());
      expect(call, where).toHaveBeenLastCalledWith(SESSION_ID, q2.id, 3, TEXT);
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it('text typed here stays in view when the terminal row fills with other text', () => {
    // Not sent yet: the operator typed in the field, then text was typed into the row in the terminal (DERIVED: the
    // recorded typed row holding other words). The field keeps the operator's text, Send waits, and the line says why.
    const text = vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    const { store } = renderAsk(CACHING_TRACING, pane('cc300-ask-same-labels-q2'));
    type('only in production');
    const typed = pane('cc300-ask-freetext-walk-3-typed');
    act(() => store.getState().apply({ type: 'dialog', dialog: {
      ...typed, id: 'other-words', options: typed.options.map((o) => (o.index === 3 ? { ...o, label: 'never' } : o)),
    } }));
    expect(field()).toHaveValue('only in production');
    expect(send()).toBeDisabled();
    expect(screen.getByText(/already holds other text/i)).toBeInTheDocument();
    fireEvent.submit(field().form!);
    expect(text).not.toHaveBeenCalled();
  });

  it('ok clears the text, and question 2 is answerable', async () => {
    vi.spyOn(api, 'answerDialogText').mockResolvedValue(undefined);
    const q1 = pane('cc300-ask-same-labels-q1');
    const { store } = renderAsk(CACHING_TRACING, q1);
    type('only in production');
    fireEvent.click(send());
    await act(async () => {});

    // Caching answered: the pane paints Tracing.
    act(() => store.getState().apply({ type: 'dialog', dialog: pane('cc300-ask-same-labels-q2') }));
    expect(heading('Enable tracing?')).toBeInTheDocument();
    expect(field()).toHaveValue('');
    expect(field()).toBeEnabled();
    expect(optionButton('Yes')).toBeEnabled();
    expect(optionButton('No')).toBeEnabled();
  });

  it('an answer that landed waits for the pane to move on, through a late frame of the typed row', async () => {
    // Like a tapped option: the sheet stays busy after ok until the pane paints the next screen. A capture of the
    // typed row taken before Enter can arrive after the call answered; it is this send, not other text.
    vi.spyOn(api, 'answerDialogText').mockResolvedValue(undefined);
    const { store } = renderAsk(CACHING_TRACING, pane('cc300-ask-same-labels-q2'));
    type(TEXT);
    fireEvent.click(send());
    await act(async () => {});
    expect(field()).toBeDisabled();
    expect(optionButton('Yes')).toBeDisabled();

    act(() => store.getState().apply({ type: 'dialog', dialog: pane('cc300-ask-freetext-walk-3-typed') }));
    expect(field()).toHaveValue(TEXT);
    expect(field()).toBeDisabled();
    expect(screen.queryByText(/already holds other text/i)).toBeNull();

    act(() => store.getState().apply({ type: 'dialog', dialog: pane('cc300-ask-review-same-labels') }));
    expect(screen.getByRole('button', { name: /^Submit answers/ })).toBeEnabled();
  });

  it('an answer that landed stops waiting on another question, even one whose row reads the same text', async () => {
    // Only this send's OWN typed row keeps the sheet waiting: the same text in another question's free-text row is
    // that question's. DERIVED: the recorded typed row (`cc300-ask-freetext-walk-3-typed`) under Caching's title.
    vi.spyOn(api, 'answerDialogText').mockResolvedValue(undefined);
    const { store } = renderAsk(CACHING_TRACING, pane('cc300-ask-same-labels-q2'));
    type(TEXT);
    fireEvent.click(send());
    await act(async () => {});
    expect(field()).toBeDisabled();

    const caching: Dialog = { ...pane('cc300-ask-freetext-walk-3-typed'), id: 'caching-typed', title: 'Enable caching?' };
    act(() => store.getState().apply({ type: 'dialog', dialog: caching }));
    expect(heading('Enable caching?')).toBeInTheDocument();
    expect(optionButton('Yes'), 'the sheet kept waiting on another question').toBeEnabled();
    expect(noField()).toBeNull();
    expect(screen.getByText(/already holds other text/i)).toBeInTheDocument();
  });

  it('an answer whose next screen arrived mid-call does not hold that screen busy', async () => {
    const call = deferred();
    vi.spyOn(api, 'answerDialogText').mockReturnValue(call.promise);
    const { store } = renderAsk(CACHING_TRACING, pane('cc300-ask-same-labels-q2'));
    type(TEXT);
    fireEvent.click(send());
    // Enter landed and the stream painted the review before the call's answer came back.
    act(() => store.getState().apply({ type: 'dialog', dialog: pane('cc300-ask-review-same-labels') }));
    await act(async () => call.resolve());

    expect(screen.getByRole('button', { name: /^Submit answers/ })).toBeEnabled();
  });

  it('Send is enabled exactly where the route would type', () => {
    renderAsk(null, pane('cc300-ask-1q-open'));
    for (const text of ['   ', 'one\ttwo', 'x'.repeat(DIALOG_TEXT_MAX + 1)]) {
      type(text);
      expect(send(), JSON.stringify(text.slice(0, 12))).toBeDisabled();
    }
    type('x'.repeat(DIALOG_TEXT_MAX));
    expect(send()).toBeEnabled();
  });

  it('a paste over the limit is kept whole, counted, and held back with a sentence', () => {
    // The field once carried maxLength, so a browser cut a long paste at the limit and Send sent the first part,
    // silently. A realistic paste: a reviewer's notes, well over the route's limit.
    const paste = Array.from({ length: 14 }, (_, i) =>
      `Point ${i + 1}: keep the migration behind a flag, run it on staging first, and roll back on any checksum mismatch.`,
    ).join(' ');
    expect(paste.length).toBeGreaterThan(DIALOG_TEXT_MAX + 400);
    const text = vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    const open = pane('cc300-ask-1q-open');
    renderAsk(null, open);
    expect(field(), 'a browser would cut the paste at the limit').not.toHaveAttribute('maxlength');

    type(paste);
    expect(field()).toHaveValue(paste);
    expect(send()).toBeDisabled();
    const over = screen.getByText(new RegExp(`^${paste.length} of ${DIALOG_TEXT_MAX} characters`));
    expect(over.textContent).toMatch(/at most 1000/);
    expect(field()).toHaveAccessibleDescription(over.textContent!);
    fireEvent.submit(field().form!);
    expect(text, 'a paste over the limit was sent').not.toHaveBeenCalled();

    // Shortened to the limit: counted, and sent whole.
    const fits = paste.slice(0, DIALOG_TEXT_MAX);
    type(fits);
    expect(screen.getByText(`${DIALOG_TEXT_MAX} of ${DIALOG_TEXT_MAX} characters.`)).toBeInTheDocument();
    expect(send()).toBeEnabled();
    fireEvent.click(send());
    expect(text).toHaveBeenCalledWith(SESSION_ID, open.id, 3, fits.trim());
  });

  it('the counter shows only near the limit', () => {
    renderAsk(null, pane('cc300-ask-1q-open'));
    type('x'.repeat(799));
    expect(screen.queryByText(/ of 1000 characters/)).toBeNull();
    type('x'.repeat(800));
    expect(screen.getByText('800 of 1000 characters.')).toBeInTheDocument();
    // Counted as sent, trimmed: the route's rule reads what it receives.
    type(`   ${'x'.repeat(799)}   `);
    expect(screen.queryByText(/ of 1000 characters/)).toBeNull();
    type(`  ${'x'.repeat(DIALOG_TEXT_MAX)}  `);
    expect(send()).toBeEnabled();
  });

  it('a trailing ; disables Send and says why', () => {
    // tmux drops a literal's trailing `;` (measured in #417): the echo would fail and the retry would be refused.
    renderAsk(null, pane('cc300-ask-1q-open'));
    type('int x = 1;');
    expect(send()).toBeDisabled();
    expect(screen.getByText(/trailing ; doesn't survive/i)).toBeInTheDocument();
    type('int x = 1');
    expect(send()).toBeEnabled();
    expect(screen.queryByText(/trailing ; doesn't survive/i)).toBeNull();
  });

  it('dismissal is refused while a text answer is in flight, on either sheet', () => {
    vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    const { store } = renderAsk(CACHING_TRACING, pane('cc300-ask-same-labels-q2'));
    type(TEXT);
    fireEvent.click(send());

    fireEvent.click(screen.getByTestId('sheet-overlay'));
    expect(heading('Enable tracing?'), 'the envelope sheet hid mid-call').toBeInTheDocument();
    act(() => store.getState().apply({ type: 'ask_cleared' }));
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    expect(heading('Enable tracing?'), 'the scraped sheet hid mid-call').toBeInTheDocument();
  });

  describe('the hand-off: ask_cleared hands the same text and call to the scraped sheet', () => {
    it('ask_cleared mid-call: the scraped sheet shows the same text and busy state, and ok clears it', async () => {
      const call = deferred();
      vi.spyOn(api, 'answerDialogText').mockReturnValue(call.promise);
      const { store } = renderAsk(CACHING_TRACING, pane('cc300-ask-same-labels-q2'));
      type(TEXT);
      fireEvent.click(send());
      act(() => {
        store.getState().apply({ type: 'ask_cleared' });
        store.getState().apply({ type: 'dialog', dialog: pane('cc300-ask-freetext-walk-3-typed') });
      });

      expect(document.querySelector('[data-source="hook"]')).toBeNull();
      expect(field()).toHaveValue(TEXT);
      expect(field()).toBeDisabled();
      expect(send()).toHaveAttribute('aria-busy', 'true');
      // The typed row is this send's own row, never an option to tap.
      expect(screen.queryByText(TEXT, { selector: '.opt-label' })).toBeNull();

      await act(async () => call.resolve());
      // The next question (a new screen): its field starts empty.
      act(() => store.getState().apply({ type: 'dialog', dialog: pane('cc300-ask-same-labels-q1') }));
      expect(field()).toHaveValue('');
      expect(field()).toBeEnabled();
    });

    it('after a refusal, the scraped sheet offers the same stranded retry', async () => {
      // The scraped reading carries no transcript enrichment, so only this sheet's own call says which row is the
      // free-text row once it holds text.
      const call = vi.spyOn(api, 'answerDialogText')
        .mockRejectedValueOnce(refused('echo-failed'))
        .mockReturnValueOnce(new Promise(() => {}));
      const { store } = renderAsk(CACHING_TRACING, pane('cc300-ask-same-labels-q2'));
      type(TEXT);
      fireEvent.click(send());
      await screen.findByText(DIALOG_TEXT_REFUSE_TEXT['echo-failed']);
      const stranded = pane('cc300-ask-freetext-walk-4-stepped-off');
      act(() => {
        store.getState().apply({ type: 'ask_cleared' });
        store.getState().apply({ type: 'dialog', dialog: stranded });
      });

      expect(document.querySelector('[data-source="hook"]')).toBeNull();
      expect(screen.getByText(/typed in the terminal but not sent yet/i)).toBeInTheDocument();
      expect(screen.queryByText(TEXT, { selector: '.opt-label' }), 'the stranded row is offered as an option').toBeNull();
      fireEvent.click(send());
      expect(call).toHaveBeenLastCalledWith(SESSION_ID, stranded.id, 3, TEXT);
    });
  });

  it('every DialogTextRefuseCode has its sentence', () => {
    for (const code of DIALOG_TEXT_REFUSE_CODES) {
      expect(DIALOG_TEXT_REFUSE_TEXT[code], code).toEqual(expect.any(String));
      expect(DIALOG_TEXT_REFUSE_TEXT[code], code).not.toBe('');
      expect(dialogTextRefusal(new ApiError(code === 'bad-text' ? 400 : 409, { ok: false, error: code })), code)
        .toBe(DIALOG_TEXT_REFUSE_TEXT[code]);
    }
    expect(new Set(Object.values(DIALOG_TEXT_REFUSE_TEXT)).size, 'two codes share a sentence')
      .toBe(DIALOG_TEXT_REFUSE_CODES.length);
    // `not-alive` is the composer's own sentence, read, never spelled again.
    expect(DIALOG_TEXT_REFUSE_TEXT['not-alive']).toBe(sendErrorText('not-alive'));
    const other = new ApiError(502, { ok: false, stderr: 'tmux: no server running' });
    expect(dialogTextRefusal(other)).toBe(failedTo('answer', other));
  });
});

// — multiSelect questions, as boxes (D-5091) —
//
// A multiSelect AskUserQuestion question paints `[ ]` boxes, a `Type something` row and an unnumbered `Next` row
// (`Submit` on the last question). `parseDialog` keeps it `parsed: false` and reads it into `Dialog.multi` (D-5048), and
// `POST /dialog/multi` answers it with the WHOLE set of boxes to leave ticked, never a toggle: it sends a digit only for
// each box that differs, proves the ticks, then commits with Tab. The sheet renders the boxes as checkbox rows, seeded
// from the pane's ticks and following them until the operator touches one, and Next sends the set. The commit's
// in-flight state lives in `DialogSheet`, keyed to the call, so the hand-off on `ask_cleared` carries it.
//
// Every screen is a recorded Claude Code 2.1.300 one (`askPanes.ts`), named by its fixture; a shape no recording shows
// is DERIVED and says so.
describe('multiSelect boxes (D-5091)', () => {
  const renderAsk = (ask: HookAsk | null, dialog: Dialog | null) => {
    const store = makeStore();
    act(() => {
      if (dialog) store.getState().apply({ type: 'dialog', dialog });
      if (ask) store.getState().apply({ type: 'ask', ask, key: null });
    });
    render(
      <>
        <DialogSheet id={SESSION_ID} store={store} onOpenTerminal={vi.fn()} />
        <ToastHost />
      </>,
    );
    return { store };
  };
  const heading = (name: string): HTMLElement => screen.getByRole('heading', { name });
  /** The box whose label starts `label` (its accessible name runs on into its description). */
  const box = (label: string): HTMLElement => screen.getByRole('checkbox', { name: new RegExp(`^${label}`) });
  const ticks = (): string[] =>
    screen.getAllByRole('checkbox').filter((b) => b.getAttribute('aria-checked') === 'true')
      .map((b) => b.querySelector('.opt-label')!.textContent!);
  const commit = (name: 'Next' | 'Review answers'): HTMLButtonElement =>
    screen.getByRole('button', { name: new RegExp(`^${name}`) });
  const show = (store: ReturnType<typeof makeStore>, dialog: Dialog): void => {
    act(() => store.getState().apply({ type: 'dialog', dialog }));
  };
  const refused = (code: string) => new ApiError(409, { ok: false, error: code });
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  it('a live multiSelect question renders its boxes with the pane\'s ticks', () => {
    const digit1 = pane('cc300-ask-multiselect-digit1');
    expect(digit1.id.startsWith('ddbca498')).toBe(true);
    renderAsk(DRINK_FEATURES_TOOLS, digit1);

    expect(document.querySelector('[data-source="hook"]')).not.toBeNull();
    expect(heading('Which features do you want?')).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(box('Logging')).toHaveAttribute('aria-checked', 'true');
    expect(box('Metrics')).toHaveAttribute('aria-checked', 'false');
    expect(box('Tracing')).toHaveAttribute('aria-checked', 'false');
    expect(box('Metrics')).toBeEnabled();
    // Answerable here, so neither the several-answers line nor the terminal CTA.
    expect(screen.queryByText(/several answers/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open terminal to answer' })).toBeNull();
    // Free text inside a multiSelect question is the terminal's (D-5048 refuses it in v1).
    expect(screen.getByText(/own words on a pick-several question go in the terminal/i)).toBeInTheDocument();
  });

  it('Next sends the whole wanted set', () => {
    const multi = vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const digit1 = pane('cc300-ask-multiselect-digit1');
    renderAsk(DRINK_FEATURES_TOOLS, digit1);

    fireEvent.click(box('Tracing'));
    expect(box('Tracing')).toHaveAttribute('aria-checked', 'true');
    expect(multi, 'a tap on a box sent something').not.toHaveBeenCalled();
    fireEvent.click(commit('Next'));
    expect(multi).toHaveBeenCalledWith(SESSION_ID, digit1.id, [1, 3]);
    expect(option, 'a box was answered as a single-select row').not.toHaveBeenCalled();
  });

  it('boxes ticked here follow the pane\'s, in tap order', () => {
    const multi = vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
    const tools = pane('cc300-ask-multiselect-tools-open');
    renderAsk(TOOLS_SIZES, tools);
    fireEvent.click(box('Drill'));
    fireEvent.click(box('Hammer'));
    fireEvent.click(commit('Next'));
    // The answer lists new ticks in the order they land (measured, `cc300-ask-review-tick-order`).
    expect(multi).toHaveBeenLastCalledWith(SESSION_ID, tools.id, [3, 1]);
  });

  it('a box ticked on the pane keeps its place, even unticked and ticked again here', () => {
    const multi = vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
    const digit1 = pane('cc300-ask-multiselect-digit1');
    renderAsk(DRINK_FEATURES_TOOLS, digit1);
    fireEvent.click(box('Tracing'));
    fireEvent.click(box('Logging'));
    fireEvent.click(box('Logging'));
    fireEvent.click(commit('Next'));
    // Logging is ticked on the pane, so no digit is sent for it and the answer lists it where it already is.
    expect(multi).toHaveBeenLastCalledWith(SESSION_ID, digit1.id, [1, 3]);
  });

  it('an empty set cannot be sent', () => {
    renderAsk(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-next-open'));
    expect(commit('Next')).toBeDisabled();
    fireEvent.click(box('Metrics'));
    expect(commit('Next')).toBeEnabled();
    fireEvent.click(box('Metrics'));
    expect(commit('Next'), 'an empty set: Tab would skip the question, which is no answer').toBeDisabled();
  });

  it('the last question\'s commit reads Review answers', () => {
    const multi = vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
    const last = pane('cc300-ask-multiselect-submit-open');
    renderAsk(DRINK_FEATURES_TOOLS, last);
    expect(heading('Which tools?')).toBeInTheDocument();
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    // The pane's row reads Submit, but Tab from the last question lands on the review (measured: `-submit-open`, then
    // `cc300-ask-review-multiselect`), where Submit answers is the real submit.
    expect(screen.queryByRole('button', { name: /^Next/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Submit/ })).toBeNull();
    fireEvent.click(box('Saw'));
    fireEvent.click(commit('Review answers'));
    expect(multi).toHaveBeenCalledWith(SESSION_ID, last.id, [2]);
  });

  it('a ticked free-text box: one line, Next disabled', () => {
    renderAsk(COLOUR_FEATURES, pane('cc300-ask-multiselect-freetext-ticked'));
    expect(ticks()).toEqual(['Logging', 'Tracing']);
    expect(screen.getByText(/own-words box is ticked on this question/i)).toBeInTheDocument();
    expect(commit('Review answers')).toBeDisabled();
  });

  it('the cursor off the options: one line, Next disabled', () => {
    const { store } = renderAsk(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-on-freetext'));
    expect(screen.getByText(/cursor is on the own-words row/i)).toBeInTheDocument();
    expect(commit('Next')).toBeDisabled();

    show(store, pane('cc300-ask-multiselect-next-focused'));
    expect(screen.getByText(/cursor is on the Next row/i)).toBeInTheDocument();
    expect(commit('Next')).toBeDisabled();

    // Back on an option (`-row3`, cursor 3): nothing to say, and Next sends.
    show(store, pane('cc300-ask-multiselect-row3'));
    expect(screen.queryByText(/cursor is on the/i)).toBeNull();
    expect(commit('Next')).toBeEnabled();
  });

  it('ticks made in the terminal reach an untouched sheet', () => {
    const { store } = renderAsk(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-digit1'));
    expect(ticks()).toEqual(['Logging']);
    // The same question (same id) repainted with Tracing ticked in the terminal: the stream re-sends an unparsed dialog
    // on every repaint.
    show(store, pane('cc300-ask-multiselect-digit1-3'));
    expect(ticks()).toEqual(['Logging', 'Tracing']);
  });

  it('a touched sheet keeps its own set across a repaint', () => {
    const multi = vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
    const { store } = renderAsk(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-digit1'));
    fireEvent.click(box('Metrics'));
    show(store, pane('cc300-ask-multiselect-digit1-3'));
    expect(ticks()).toEqual(['Logging', 'Metrics']);
    fireEvent.click(commit('Next'));
    // The whole set: the server unticks Tracing and ticks Metrics.
    expect(multi).toHaveBeenLastCalledWith(SESSION_ID, pane('cc300-ask-multiselect-digit1-3').id, [1, 2]);
  });

  it('a refusal says why and re-enables the boxes, and Next sends the same set again', async () => {
    const multi = vi.spyOn(api, 'answerDialogMulti')
      .mockRejectedValueOnce(refused('ticks-failed'))
      .mockReturnValueOnce(new Promise(() => {}));
    // Untouched: Next commits the pane's own ticks (`-digit1-3`, Logging and Tracing).
    const both = pane('cc300-ask-multiselect-digit1-3');
    const { store } = renderAsk(DRINK_FEATURES_TOOLS, both);
    fireEvent.click(commit('Next'));

    expect(await screen.findByText(DIALOG_MULTI_REFUSE_TEXT['ticks-failed'])).toBeInTheDocument();
    expect(box('Metrics')).toBeEnabled();
    expect(commit('Next')).toBeEnabled();
    // The failed attempt may leave the boxes part toggled (D-5048): `-digit1`, Tracing gone. The set sent stays the
    // operator's, so the retry sends it again and the server sends only the digits still needed.
    show(store, pane('cc300-ask-multiselect-digit1'));
    expect(ticks()).toEqual(['Logging', 'Tracing']);
    fireEvent.click(commit('Next'));
    expect(multi).toHaveBeenLastCalledWith(SESSION_ID, both.id, [1, 3]);
  });

  it('every DialogMultiRefuseCode has its sentence', () => {
    for (const code of DIALOG_MULTI_REFUSE_CODES) {
      expect(DIALOG_MULTI_REFUSE_TEXT[code], code).toEqual(expect.any(String));
      expect(DIALOG_MULTI_REFUSE_TEXT[code], code).not.toBe('');
      expect(dialogMultiRefusal(new ApiError(code === 'bad-indexes' ? 400 : 409, { ok: false, error: code })), code)
        .toBe(DIALOG_MULTI_REFUSE_TEXT[code]);
    }
    expect(new Set(Object.values(DIALOG_MULTI_REFUSE_TEXT)).size, 'two codes share a sentence')
      .toBe(DIALOG_MULTI_REFUSE_CODES.length);
    expect(DIALOG_MULTI_REFUSE_TEXT['not-alive']).toBe(sendErrorText('not-alive'));
    const other = new ApiError(502, { ok: false, stderr: 'tmux: no server running' });
    expect(dialogMultiRefusal(other)).toBe(failedTo('answer', other));
  });

  it('a one-question multiSelect envelope answers through the boxes', () => {
    const multi = vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
    // DERIVED: `Which tools?` asked alone (the recorded ask has it first of two).
    const alone: HookAsk = { questions: [TOOLS_SIZES.questions[0]!] };
    const tools = pane('cc300-ask-multiselect-tools-open');
    renderAsk(alone, tools);
    expect(document.querySelector('[data-source="hook"]')).not.toBeNull();
    expect(screen.queryByText(/^\d+ of \d+$/)).toBeNull();
    fireEvent.click(box('Saw'));
    fireEvent.click(commit('Next'));
    expect(multi).toHaveBeenCalledWith(SESSION_ID, tools.id, [2]);
  });

  it('a multiSelect question with no Dialog.multi keeps the honest terminal copy and offers no box', () => {
    // The 2.1.222 shape (`multiselect`): no commit row, so no `Dialog.multi`, and its keys were never measured. DERIVED
    // envelope: that recording's prompt line is not captured, so its one question is read off the screen.
    const multi = vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
    const old = pane('multiselect');
    expect(old.multi).toBeUndefined();
    renderAsk({ questions: [{ question: 'Select the tools to allow', header: 'Tools', multiSelect: true,
      options: [{ label: 'Bash' }, { label: 'Edit' }, { label: 'WebFetch' }] }] }, old);

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText(/several answers/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Edit/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open terminal to answer' })).toBeInTheDocument();
    expect(multi).not.toHaveBeenCalled();
  });

  it('the boxes and Next are disabled, and dismissal refused, while the commit is in flight', async () => {
    const call = deferred();
    vi.spyOn(api, 'answerDialogMulti').mockReturnValue(call.promise);
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { store } = renderAsk(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-digit1'));
    fireEvent.click(box('Tracing'));
    fireEvent.click(commit('Next'));

    const busy = (): void => {
      for (const b of screen.getAllByRole('checkbox')) expect(b, b.textContent!).toBeDisabled();
      expect(commit('Next')).toBeDisabled();
      expect(commit('Next')).toHaveAttribute('aria-busy', 'true');
      expect(ticks(), 'the sheet stopped showing the set it sent').toEqual(['Logging', 'Tracing']);
    };
    busy();
    // The pane repaints under the same id while the server ticks: still the set sent, still busy.
    show(store, pane('cc300-ask-multiselect-digit1'));
    busy();
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    expect(heading('Which features do you want?'), 'the envelope sheet hid mid-commit').toBeInTheDocument();

    // ask_cleared mid-commit: the scraped sheet carries the same set and the same call.
    act(() => store.getState().apply({ type: 'ask_cleared' }));
    expect(document.querySelector('[data-source="hook"]')).toBeNull();
    busy();
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    expect(heading('Which features do you want?'), 'the scraped sheet hid mid-commit').toBeInTheDocument();

    // Ok: like a tapped option, the sheet waits for the pane to move on.
    await act(async () => call.resolve());
    busy();
    // The next question (a new id): its own boxes, from its own pane, ready.
    show(store, pane('cc300-ask-multiselect-submit-open'));
    expect(heading('Which tools?')).toBeInTheDocument();
    expect(ticks()).toEqual([]);
    expect(box('Saw')).toBeEnabled();
    expect(option).not.toHaveBeenCalled();
  });

  it('a commit whose next screen arrived mid-call does not hold that screen busy', async () => {
    const call = deferred();
    vi.spyOn(api, 'answerDialogMulti').mockReturnValue(call.promise);
    const { store } = renderAsk(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-digit1-3'));
    fireEvent.click(commit('Next'));
    show(store, pane('cc300-ask-multiselect-submit-open'));
    // Until the call answers, one call at a time: the next question's boxes wait, and show the PANE's ticks, never the
    // set committed to the question before (Hammer and Drill share its digits 1 and 3).
    expect(heading('Which tools?')).toBeInTheDocument();
    expect(box('Saw')).toBeDisabled();
    expect(ticks()).toEqual([]);
    await act(async () => call.resolve());
    expect(heading('Which tools?')).toBeInTheDocument();
    expect(box('Saw')).toBeEnabled();
    fireEvent.click(box('Saw'));
    expect(commit('Review answers')).toBeEnabled();
  });

  it('a single-select screen arriving mid-commit waits too, its own-words field included', () => {
    // DERIVED sequence: the recorded multiSelect question, then a recorded single-select screen (`cc300-ask-1q-open`)
    // before the commit answers. One call at a time, on the scraped sheet as on the envelope's.
    vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
    const { store } = renderAsk(null, pane('cc300-ask-multiselect-digit1-3'));
    fireEvent.click(commit('Next'));
    show(store, pane('cc300-ask-1q-open'));
    expect(heading('Which colour?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Red/ })).toBeDisabled();
    expect(screen.getByLabelText('Answer in your own words')).toBeDisabled();
  });

  describe('the hand-off: ask_cleared hands the same question to the scraped sheet', () => {
    it('the scraped sheet answers a multiSelect question with the same boxes', () => {
      const multi = vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
      const digit1 = pane('cc300-ask-multiselect-digit1');
      const { store } = renderAsk(DRINK_FEATURES_TOOLS, digit1);
      act(() => store.getState().apply({ type: 'ask_cleared' }));

      expect(document.querySelector('[data-source="hook"]')).toBeNull();
      expect(heading('Which features do you want?')).toBeInTheDocument();
      expect(ticks()).toEqual(['Logging']);
      expect(screen.queryByText(/doesn't fit tappable options/i)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Open terminal to answer' })).toBeNull();
      fireEvent.click(box('Tracing'));
      fireEvent.click(commit('Next'));
      expect(multi).toHaveBeenCalledWith(SESSION_ID, digit1.id, [1, 3]);
    });

    it('a wrapped multiSelect question is titled whole on the scraped sheet', () => {
      // DERIVED: the recorded boxes under a question too long for one row (the pane's title is its last row).
      const digit1 = pane('cc300-ask-multiselect-digit1');
      renderAsk(null, {
        ...digit1,
        title: '│ do you want switched on for the staging cluster?',
        body: `${digit1.body!.split('\n')[0]}\n\n│ Which of the observability features\n│ do you want switched on for the staging cluster?`,
      });
      expect(heading('Which of the observability features do you want switched on for the staging cluster?')).toBeInTheDocument();
      expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    });

    it('a set touched on the envelope sheet survives the hand-off', () => {
      const multi = vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
      const tools = pane('cc300-ask-multiselect-tools-open');
      const { store } = renderAsk(TOOLS_SIZES, tools);
      fireEvent.click(box('Drill'));
      fireEvent.click(box('Hammer'));
      act(() => store.getState().apply({ type: 'ask_cleared' }));
      expect(ticks()).toEqual(['Hammer', 'Drill']);
      fireEvent.click(commit('Next'));
      expect(multi).toHaveBeenCalledWith(SESSION_ID, tools.id, [3, 1]);
    });
  });
});

// — one send at a time, to the row it was meant for —
//
// `Chat about this` and the review's `Cancel` each decline the WHOLE ask, so neither may be tapped while another send
// is still landing: an own-words answer (D-5090) or a multiSelect commit (D-5091), whose next screen can reach the
// sheet before the call answers. Both sheets: the envelope's, and the scraped one that takes over on `ask_cleared`.
// The handlers hold the same rule at the source, for two taps handled before React commits the first one's state.
// And the guards that keep a send on its own row: own words only under the live question, the review told before any
// question, the form holding back what Send holds back, the stranded retry's text fixed, the text sent trimmed, and
// the scraped sheet's free-text row read from the transcript's option count.
describe('one send at a time, to the row it was meant for (D-5089, D-5090, D-5091)', () => {
  const TEXT = '- only in staging, sampled 10%';
  const renderAsk = (ask: HookAsk | null, dialog: Dialog | null) => {
    const store = makeStore();
    act(() => {
      if (dialog) store.getState().apply({ type: 'dialog', dialog });
      if (ask) store.getState().apply({ type: 'ask', ask, key: null });
    });
    render(
      <>
        <DialogSheet id={SESSION_ID} store={store} onOpenTerminal={vi.fn()} />
        <ToastHost />
      </>,
    );
    return { store };
  };
  const show = (store: ReturnType<typeof makeStore>, dialog: Dialog): void => {
    act(() => store.getState().apply({ type: 'dialog', dialog }));
  };
  const field = (): HTMLInputElement => screen.getByLabelText('Answer in your own words');
  const noField = (): HTMLElement | null => screen.queryByLabelText('Answer in your own words');
  const send = (): HTMLButtonElement => screen.getByRole('button', { name: /^Send/ });
  const chat = (): HTMLButtonElement => screen.getByRole('button', { name: /^Chat about this/ });
  const box = (label: string): HTMLElement => screen.getByRole('checkbox', { name: new RegExp(`^${label}`) });
  const commit = (name: 'Next' | 'Review answers'): HTMLButtonElement =>
    screen.getByRole('button', { name: new RegExp(`^${name}`) });
  const reviewRows = (): HTMLButtonElement[] => [
    screen.getByRole('button', { name: /^Submit answers/ }),
    screen.getByRole('button', { name: /^Cancel/ }),
  ];
  const optionButton = (label: string): HTMLButtonElement => {
    const buttons = screen.getAllByText(label, { selector: '.opt-label' })
      .map((l) => l.closest('button'))
      .filter((b): b is HTMLButtonElement => b !== null);
    expect(buttons, `option buttons reading ${label}`).toHaveLength(1);
    return buttons[0]!;
  };
  /** Taps the rows that decline the ask and proves nothing was sent. */
  const declineRowsWait = (spy: ReturnType<typeof vi.spyOn>, rows: HTMLButtonElement[], where: string): void => {
    for (const row of rows) {
      expect(row, `${where}: ${row.textContent}`).toBeDisabled();
      fireEvent.click(row);
    }
    expect(spy, `${where}: a row that declines the ask was sent`).not.toHaveBeenCalled();
  };

  it('Chat about this waits while own words are being sent, on both sheets', () => {
    vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { store } = renderAsk(CACHING_TRACING, pane('cc300-ask-same-labels-q2'));
    fireEvent.change(field(), { target: { value: TEXT } });
    fireEvent.click(send());
    declineRowsWait(option, [chat()], 'envelope');

    act(() => store.getState().apply({ type: 'ask_cleared' }));
    expect(document.querySelector('[data-source="hook"]')).toBeNull();
    declineRowsWait(option, [chat()], 'scraped');
  });

  it('Chat about this waits while a multiSelect commit is under way, on both sheets', () => {
    // The commit's next screen (question 1 of the same ask, `cc300-ask-q2-of-2-single`'s Which drink?, as the pane
    // paints it after a ← back) reaches the sheet before the commit answers. DERIVED sequence of recorded screens.
    vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const envelope = renderAsk(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-digit1-3'));
    fireEvent.click(commit('Next'));
    show(envelope.store, pane('cc300-ask-q2-of-2-single'));
    expect(screen.getByRole('heading', { name: 'Which drink?' })).toBeInTheDocument();
    expect(document.querySelector('[data-source="hook"]')).not.toBeNull();
    declineRowsWait(option, [chat()], 'envelope');
    cleanup();

    const scraped = renderAsk(null, pane('cc300-ask-multiselect-digit1-3'));
    fireEvent.click(commit('Next'));
    show(scraped.store, pane('cc300-ask-q2-of-2-single'));
    declineRowsWait(option, [chat()], 'scraped');
  });

  it('the review\'s Submit and Cancel wait while own words are being sent, on both sheets', () => {
    // Enter landed and the stream painted the review before the text call answered.
    vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const envelope = renderAsk(CACHING_TRACING, pane('cc300-ask-same-labels-q2'));
    fireEvent.change(field(), { target: { value: TEXT } });
    fireEvent.click(send());
    show(envelope.store, pane('cc300-ask-review-same-labels'));
    expect(document.querySelector('[data-source="hook"]')).not.toBeNull();
    declineRowsWait(option, reviewRows(), 'envelope');
    cleanup();

    const scraped = renderAsk(null, pane('cc300-ask-same-labels-q2'));
    fireEvent.change(field(), { target: { value: TEXT } });
    fireEvent.click(send());
    show(scraped.store, pane('cc300-ask-review-same-labels'));
    declineRowsWait(option, reviewRows(), 'scraped');
  });

  it('the review\'s Submit and Cancel wait while a multiSelect commit is under way, on both sheets', () => {
    // The last question's commit lands on the review (measured: `-submit-open`, then `cc300-ask-review-multiselect`).
    vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const envelope = renderAsk(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-submit-open'));
    fireEvent.click(box('Saw'));
    fireEvent.click(commit('Review answers'));
    show(envelope.store, pane('cc300-ask-review-multiselect'));
    expect(document.querySelector('[data-source="hook"]')).not.toBeNull();
    declineRowsWait(option, reviewRows(), 'envelope');
    cleanup();

    const scraped = renderAsk(null, pane('cc300-ask-multiselect-submit-open'));
    fireEvent.click(box('Saw'));
    fireEvent.click(commit('Review answers'));
    show(scraped.store, pane('cc300-ask-review-multiselect'));
    declineRowsWait(option, reviewRows(), 'scraped');
  });

  it('own words and Chat are offered only under the question the pane is painting', () => {
    // A tie the title cannot break (DERIVED: both questions Yes/No, the title a suffix of both): no question is live.
    const both: HookAsk = {
      questions: [
        { question: 'Enable tracing?', header: 'Tracing', multiSelect: false, options: CACHING_TRACING.questions[1]!.options },
        { question: 'Really enable tracing?', header: 'Really', multiSelect: false, options: CACHING_TRACING.questions[1]!.options },
      ],
    };
    renderAsk(both, pane('cc300-ask-same-labels-q2'));
    expect(noField()).toBeNull();
    expect(screen.queryByRole('button', { name: /^Chat about this/ })).toBeNull();
    cleanup();
    // A pane on another ask entirely (`cc300-ask-1q-open` under `FRUIT_DRINK`).
    renderAsk(FRUIT_DRINK, pane('cc300-ask-1q-open'));
    expect(noField()).toBeNull();
    expect(screen.queryByRole('button', { name: /^Chat about this/ })).toBeNull();
  });

  it('a question whose labels read like the review\'s rows never takes the review screen', () => {
    // DERIVED envelope: `Ship it?` offers Submit and Cancel, which prefix-match the review's two rows. The review is
    // told first (its body ends with the ready line), so its rows stay the review's.
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const review = pane('cc300-ask-review-same-labels');
    renderAsk({
      questions: [
        { question: 'Ship it?', header: 'Ship', multiSelect: false, options: [{ label: 'Submit' }, { label: 'Cancel' }] },
        CACHING_TRACING.questions[0]!,
      ],
    }, review);
    expect(screen.getByRole('heading', { name: 'Review your answers' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ship it?' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel/ }));
    expect(option).toHaveBeenCalledWith(SESSION_ID, review.id, 2);
  });

  it('the own-words form never submits what Send holds back (Enter in the field)', () => {
    const text = vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    renderAsk(null, pane('cc300-ask-1q-open'));
    for (const held of ['int x = 1;', 'one\ttwo', '   ']) {
      fireEvent.change(field(), { target: { value: held } });
      expect(send(), JSON.stringify(held)).toBeDisabled();
      fireEvent.submit(field().form!);
    }
    expect(text, 'Enter sent what Send holds back').not.toHaveBeenCalled();
  });

  it('the stranded retry\'s field is read-only: the row accepts exactly that text', async () => {
    const call = vi.spyOn(api, 'answerDialogText')
      .mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'echo-failed' }))
      .mockReturnValueOnce(new Promise(() => {}));
    const { store } = renderAsk(CACHING_TRACING, pane('cc300-ask-same-labels-q2'));
    fireEvent.change(field(), { target: { value: TEXT } });
    fireEvent.click(send());
    await screen.findByText(DIALOG_TEXT_REFUSE_TEXT['echo-failed']);
    show(store, pane('cc300-ask-freetext-walk-4-stepped-off'));
    expect(screen.getByText(/typed in the terminal but not sent yet/i)).toBeInTheDocument();
    expect(field(), 'an edit would turn the retry into a dead end').toHaveAttribute('readonly');
    fireEvent.click(send());
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('own words are sent trimmed: the route\'s rule is read on what it receives', () => {
    const text = vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    const open = pane('cc300-ask-1q-open');
    renderAsk(null, open);
    fireEvent.change(field(), { target: { value: '   Teal, if there is one  ' } });
    fireEvent.click(send());
    expect(text).toHaveBeenCalledWith(SESSION_ID, open.id, 3, 'Teal, if there is one');
  });

  it('the scraped sheet reads the free-text row from the transcript\'s option count', () => {
    // `cc300-ask-freetext-held` enriched as the server enriches a matched question (`Dialog.ask`): row 3, `Mango`, is
    // text typed in the terminal, never an option to tap, and no field is offered over it.
    const held: Dialog = {
      ...pane('cc300-ask-freetext-held'),
      ask: { question: 'Which fruit?', header: 'Fruit', multiSelect: false, options: [{ label: 'Apple' }, { label: 'Pear' }] },
    };
    renderAsk(null, held);
    expect(screen.queryByText('Mango', { selector: '.opt-label' })).toBeNull();
    expect(screen.getByText(/already holds other text/i)).toBeInTheDocument();
    expect(noField()).toBeNull();
  });

  describe('two taps handled before the sheet re-renders still send once', () => {
    // React commits a tap's state after the handler returns, so a second tap handled in the same tick finds every row
    // still enabled. The handlers hold the lock themselves (`DialogSheet`'s `sending`), at the moment a send starts.
    it('an option, then Chat about this', () => {
      const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
      const q2 = pane('cc300-ask-same-labels-q2');
      renderAsk(CACHING_TRACING, q2);
      const yes = optionButton('Yes');
      const decline = chat();
      act(() => {
        fireEvent.click(yes);
        fireEvent.click(decline);
      });
      expect(option).toHaveBeenCalledTimes(1);
      expect(option).toHaveBeenCalledWith(SESSION_ID, q2.id, 1);
    });

    it('own words, sent twice', () => {
      const text = vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
      renderAsk(null, pane('cc300-ask-1q-open'));
      fireEvent.change(field(), { target: { value: 'Teal' } });
      const button = send();
      act(() => {
        fireEvent.click(button);
        fireEvent.click(button);
      });
      expect(text).toHaveBeenCalledTimes(1);
    });

    it('own words, then Chat about this', () => {
      const text = vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
      const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
      renderAsk(null, pane('cc300-ask-1q-open'));
      fireEvent.change(field(), { target: { value: 'Teal' } });
      const button = send();
      const decline = chat();
      act(() => {
        fireEvent.click(button);
        fireEvent.click(decline);
      });
      expect(text).toHaveBeenCalledTimes(1);
      expect(option, 'Chat declined the ask under a send').not.toHaveBeenCalled();
    });

    it('a multiSelect commit, sent twice', () => {
      const multi = vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
      renderAsk(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-digit1-3'));
      const next = commit('Next');
      act(() => {
        fireEvent.click(next);
        fireEvent.click(next);
      });
      expect(multi).toHaveBeenCalledTimes(1);
    });
  });
});

// — the own-words region and the busy commits, as laid out —
//
// jsdom lays nothing out, so these pin the STRUCTURE each fix rides on, and the stylesheet rules that use it; the
// pixels are judged on a real build at phone, laptop and wide widths (plan, Task 5).
describe('the own-words region and the busy commits keep their shape (D-5090, D-5091)', () => {
  const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'session', 'chat.css'), 'utf8');
  /** The declarations of the rule whose selector list is exactly `selector`. */
  const rule = (selector: string): string => {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };
  const renderAsk = (ask: HookAsk | null, dialog: Dialog) => {
    const store = makeStore();
    act(() => {
      store.getState().apply({ type: 'dialog', dialog });
      if (ask) store.getState().apply({ type: 'ask', ask, key: null });
    });
    render(<DialogSheet id={SESSION_ID} store={store} onOpenTerminal={vi.fn()} />);
    return { store };
  };
  const field = (): HTMLInputElement => screen.getByLabelText('Answer in your own words');

  it('Send keeps its width while busy: both faces share one cell, and the one not showing is hidden', () => {
    vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    renderAsk(null, pane('cc300-ask-1q-open'));
    const faces = (b: HTMLElement): string[] =>
      [...b.querySelectorAll(':scope > span')].map((f) => `${f.textContent}${f.getAttribute('aria-hidden') === 'true' ? ':hidden' : ''}`);
    const idle = screen.getByRole('button', { name: 'Send' });
    expect(faces(idle)).toEqual(['Send', 'Sending…:hidden']);
    fireEvent.change(field(), { target: { value: 'Teal' } });
    fireEvent.click(idle);
    const busy = screen.getByRole('button', { name: 'Sending…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(faces(busy)).toEqual(['Send:hidden', 'Sending…']);
    // The cell is the button's grid; the hidden face holds its width without being seen.
    expect(rule('.dlg-reply-send')).toMatch(/display:\s*grid/);
    expect(rule('.dlg-reply-send > span')).toMatch(/grid-area:\s*1\s*\/\s*1/);
    expect(rule(".dlg-reply-send > [aria-hidden='true']")).toMatch(/visibility:\s*hidden/);
  });

  it('the busy commits keep a gap between the label and answering…', () => {
    // `Button` is a flex box, which drops the marker's leading space: `Nextanswering…` (measured, every width).
    vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));
    renderAsk(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-digit1-3'));
    const next = screen.getByRole('button', { name: /^Next/ });
    fireEvent.click(next);
    expect(next).toHaveAttribute('aria-busy', 'true');
    expect(next).toHaveClass('gap-2');
  });

  it('the own-words region spaces itself the same above and below, whatever it holds', () => {
    // The field and its lines, and a line alone, sit in one `.dlg-words` block with equal margins, so the Chat row's
    // rule below is as far from the field as the last option above it, and the field's focus ring clears both.
    renderAsk(CACHING_TRACING, pane('cc300-ask-same-labels-q2'));
    expect(field().closest('.dlg-words')).not.toBeNull();
    fireEvent.change(field(), { target: { value: 'int x = 1;' } });
    expect(screen.getByText(/trailing ; doesn't survive/i).closest('.dlg-words')).toBe(field().closest('.dlg-words'));
    cleanup();
    renderAsk(null, pane('ask-2col-chat-about'));
    expect(screen.getByText(/no own-words row on the terminal/i).closest('.dlg-words')).not.toBeNull();
    expect(rule('.dlg-words')).toMatch(/margin:\s*var\(--sp-3\) 0;/);
    expect(rule('.dlg-words .dlg-copy')).toMatch(/margin:\s*0;/);
    expect(rule('.dlg-reply')).not.toMatch(/margin/);
  });

  it('the own-words field looks disabled while it is', () => {
    expect(rule('.dlg-reply-input:disabled')).toMatch(/color:\s*var\(--syn-comment\)/);
    expect(rule('.dlg-reply-input:disabled')).toMatch(/border-style:\s*dashed/);
    expect(rule('.dlg-reply-input:disabled')).toMatch(/cursor:\s*default/);
  });
});

// — what a refused tap and the foot line say (plan, Task 5) —
//
// `answer()` once toasted every 409 alike ("That question changed — showing the latest"), whatever the route refused;
// #417's `answerDialog` refuses by code (`DialogRefuseCode`), and each code now has its own sentence. And the foot line
// offered own words under menus that offer no field.
describe('a refused tap, and the foot line, say what is true (D-5089, D-5090, D-5091)', () => {
  const refused = (code: string) => new ApiError(409, { ok: false, error: code });

  it('answer()\'s refusals say what happened, by code', async () => {
    for (const code of ['free-text-row', 'unparsed-dialog', 'walk-failed', 'not-alive'] as const) {
      vi.spyOn(api, 'answerDialog').mockRejectedValueOnce(refused(code));
      renderWithDialog(parsedDialog());
      fireEvent.click(screen.getByRole('button', { name: 'Big-bang cutover' }));
      expect(await screen.findByText(DIALOG_REFUSE_TEXT[code]), code).toBeInTheDocument();
      expect(screen.queryByText('That question changed — showing the latest'), code).toBeNull();
      expect(screen.getByRole('button', { name: 'Big-bang cutover' }), code).toBeEnabled();
      cleanup();
    }
  });

  it('every DialogRefuseCode has its sentence, and stale-dialog keeps its two', () => {
    for (const code of DIALOG_REFUSE_CODES) {
      expect(DIALOG_REFUSE_TEXT[code], code).toEqual(expect.any(String));
      expect(DIALOG_REFUSE_TEXT[code], code).not.toBe('');
      expect(dialogRefusal(refused(code), false), code).toBe(DIALOG_REFUSE_TEXT[code]);
    }
    expect(new Set(Object.values(DIALOG_REFUSE_TEXT)).size, 'two codes share a sentence').toBe(DIALOG_REFUSE_CODES.length);
    expect(DIALOG_REFUSE_TEXT['not-alive']).toBe(sendErrorText('not-alive'));
    // N1: under the envelope a refused tap changes nothing on screen, so "showing the latest" would be false there.
    expect(dialogRefusal(refused('stale-dialog'), true)).toBe(STALE_UNDER_ENVELOPE);
    expect(dialogRefusal(refused('walk-failed'), true)).toBe(DIALOG_REFUSE_TEXT['walk-failed']);
    const other = new ApiError(502, { ok: false, stderr: 'tmux: no server running' });
    expect(dialogRefusal(other, false)).toBe(failedTo('answer', other));
  });

  it('the foot line names own words only where the field is offered', () => {
    const foot = (): string | null | undefined => document.querySelector('.sheet-foot')?.textContent;
    renderWithDialog(pane('cc300-ask-1q-open'));
    expect(screen.getByLabelText('Answer in your own words')).toBeInTheDocument();
    expect(foot()).toBe('tap an option, or answer in your own words');
    cleanup();
    // The two-column layout paints no own-words row.
    renderWithDialog(pane('ask-2col-chat-about'));
    expect(screen.queryByLabelText('Answer in your own words')).toBeNull();
    expect(foot()).toBe('tap an option');
    cleanup();
    // A permission prompt is no AskUserQuestion (DERIVED: Yes / Yes, and don't ask again / No).
    renderWithDialog(parsedDialog({
      title: 'Do you want to proceed?',
      options: [{ index: 1, label: 'Yes' }, { index: 2, label: "Yes, and don't ask again" }, { index: 3, label: 'No' }],
    }));
    expect(screen.queryByLabelText('Answer in your own words')).toBeNull();
    expect(foot()).toBe('tap an option');
    cleanup();
    // A row holding text typed in the terminal, matched by the transcript (`Dialog.ask`): a line, no field.
    renderWithDialog({
      ...pane('cc300-ask-freetext-held'),
      ask: { question: 'Which fruit?', header: 'Fruit', multiSelect: false, options: [{ label: 'Apple' }, { label: 'Pear' }] },
    });
    expect(screen.queryByLabelText('Answer in your own words')).toBeNull();
    expect(foot()).toBe('tap an option');
  });
});

describe('the full question, behind its own disclosure', () => {
  it('is hidden until asked for, shows the pane’s RAW text, and hides again', () => {
    // The sheet renders the parsed question; the raw pane text is what the
    // reader falls back to when the parse is wrong, and it is the only place
    // the truth is verbatim. Nothing had ever opened it (measured: its
    // toggle was an uncovered function).
    renderWithDialog(parsedDialog({ raw: '❯ 1. Expand–contract\n  2. Something the parse missed' }));
    expect(screen.queryByText(/Something the parse missed/)).toBeNull();

    const toggle = screen.getByRole('button', { name: 'Show full question' });
    fireEvent.click(toggle);
    expect(screen.getByText(/Something the parse missed/)).toBeInTheDocument();

    // The LEGEND names the destination, like every other toggle in this app.
    fireEvent.click(screen.getByRole('button', { name: 'Hide full question' }));
    expect(screen.queryByText(/Something the parse missed/)).toBeNull();
  });
});
