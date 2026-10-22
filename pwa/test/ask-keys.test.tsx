// The ask sheets' keyboard, like Claude Code's (decision `ask-sheet-keyboard-model`), the tab strip (decision
// `ask-tab-strip`) and Escape that never interrupts (decision `ask-sheet-escape-never-interrupts`). The model is pure
// (`askKeys.ts`); the sheet cases drive the real DialogSheet over the recorded Claude Code 2.1.296 ask
// (`cc296-ask-2q-long-*`, neutral text) and its envelope (`CC296_LONG`).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Dialog } from '../../shared/api';
import { ToastHost } from '@ccrc/ui';
import { api, ApiError } from '../src/lib/api';
import { DialogSheet } from '../src/session/DialogSheet';
import { SessionHeaderHost, type HeaderHostProps } from './sessionHost';
import { TABS_HELD } from '../src/session/AskParts';
import {
  askKeyAction, keyTabs, multiKeys, questionKeys, reviewKeys, type KeyPress, type KeyScreen,
} from '../src/session/askKeys';
import { DIALOG_TAB_REFUSE_TEXT } from '../src/session/askWords';
import { createSessionStore } from '../src/stores/session';
import { CC296_LONG, TOOLS_SIZES, pane } from './askPanes';
import { declValue, ruleIn } from './cssRule';
import { askFixture } from './askFixtures';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const press = (key: string, more: Partial<KeyPress> = {}): KeyPress => ({ key, ...more });

describe('askKeyAction: Claude Code\'s keys, as the sheet maps them', () => {
  // Two options, the own-words field at the free-text row's digit 3, then Chat at 4: the 2.1.296 question 1.
  const Q: KeyScreen = questionKeys([1, 2], 3, 4, keyTabs(2, 0, false));

  it('↓ runs options → own words → Chat and stops there; ↑ from option 1 wraps to own words', () => {
    expect(askKeyAction(Q, 'o1', 'o1', press('ArrowDown'))).toEqual({ type: 'move', to: 'o2' });
    expect(askKeyAction(Q, 'o2', 'o1', press('ArrowDown'))).toEqual({ type: 'move', to: 'words' });
    expect(askKeyAction(Q, 'o4', 'o1', press('ArrowDown'))).toEqual({ type: 'none' });
    expect(askKeyAction(Q, 'o1', 'o1', press('ArrowUp'))).toEqual({ type: 'move', to: 'words' });
    expect(askKeyAction(Q, 'o4', 'o1', press('ArrowUp'))).toEqual({ type: 'move', to: 'words' });
  });

  it('in the own-words field: ↑ is the last option, ↓ is Chat, and everything else is the field\'s', () => {
    expect(askKeyAction(Q, 'words', 'o1', press('ArrowUp', { inWords: true }))).toEqual({ type: 'move', to: 'o2' });
    expect(askKeyAction(Q, 'words', 'o1', press('ArrowDown', { inWords: true }))).toEqual({ type: 'move', to: 'o4' });
    for (const key of ['ArrowLeft', 'ArrowRight', '1', 'Enter', ' ']) {
      expect(askKeyAction(Q, 'words', 'o1', press(key, { inWords: true })), key).toEqual({ type: 'none' });
    }
  });

  it('a digit answers its option; the free-text row\'s digit goes to the field; Chat\'s only highlights it', () => {
    expect(askKeyAction(Q, 'o1', 'o1', press('2'))).toEqual({ type: 'answer', index: 2 });
    expect(askKeyAction(Q, 'o1', 'o1', press('3'))).toEqual({ type: 'words' });
    expect(askKeyAction(Q, 'o1', 'o1', press('4'))).toEqual({ type: 'move', to: 'o4' });
    expect(askKeyAction(Q, 'o1', 'o1', press('5'))).toEqual({ type: 'none' });
  });

  it('modifiers, a held-down digit, Enter, Space, Escape, Tab and letters (a preview\'s n) are never the sheet\'s', () => {
    for (const p of [press('2', { meta: true }), press('2', { ctrl: true }), press('2', { alt: true }),
      press('2', { shift: true }), press('2', { repeat: true }), press('ArrowRight', { repeat: true }), press('Enter'),
      press(' '), press('Escape'), press('Tab'), press('n')]) {
      expect(askKeyAction(Q, 'o1', 'o1', p), JSON.stringify(p)).toEqual({ type: 'none' });
    }
  });

  it('←/→ move the pane\'s tab, with no request at an edge the sheet can see, nor while picks are uncommitted', () => {
    expect(askKeyAction(Q, 'o1', 'o1', press('ArrowRight'))).toEqual({ type: 'tab', to: 'next' });
    expect(askKeyAction(Q, 'o1', 'o1', press('ArrowLeft')), 'question 1').toEqual({ type: 'none' });
    const q2 = questionKeys([1, 2, 3], 4, 5, keyTabs(2, 1, false));
    expect(askKeyAction(q2, 'o1', 'o1', press('ArrowLeft'))).toEqual({ type: 'tab', to: 'prev' });
    const unknown = questionKeys([1, 2], 3, 4, keyTabs(2, null, false));
    expect(askKeyAction(unknown, 'o1', 'o1', press('ArrowLeft')), 'the server decides')
      .toEqual({ type: 'tab', to: 'prev' });
    const oneQ = questionKeys([1, 2], 3, 4, keyTabs(null, null, false));
    expect(askKeyAction(oneQ, 'o1', 'o1', press('ArrowRight')), 'no tab row').toEqual({ type: 'none' });
    const held = multiKeys([1, 2], keyTabs(2, 0, false, true));
    expect(askKeyAction(held, 'o1', 'o1', press('ArrowRight'))).toEqual({ type: 'none' });
  });

  it('the review: ↑/↓ wrap, 1 submits and 2 cancels at once (Match Claude Code), ← is the last question, → nothing', () => {
    const R = reviewKeys(1, 2, keyTabs(2, null, true));
    expect(askKeyAction(R, 'o2', 'o1', press('ArrowDown'))).toEqual({ type: 'move', to: 'o1' });
    expect(askKeyAction(R, 'o1', 'o1', press('ArrowUp'))).toEqual({ type: 'move', to: 'o2' });
    expect(askKeyAction(R, 'o1', 'o1', press('1'))).toEqual({ type: 'answer', index: 1 });
    expect(askKeyAction(R, 'o1', 'o1', press('2'))).toEqual({ type: 'answer', index: 2 });
    expect(askKeyAction(R, 'o1', 'o1', press('ArrowLeft'))).toEqual({ type: 'tab', to: 'prev' });
    expect(askKeyAction(R, 'o1', 'o1', press('ArrowRight'))).toEqual({ type: 'none' });
  });

  it('multiSelect: a digit toggles its box, ↓ runs the boxes then the commit and stops', () => {
    const M = multiKeys([1, 2, 3], keyTabs(2, 0, false));
    expect(askKeyAction(M, 'o1', 'o1', press('2'))).toEqual({ type: 'toggle', index: 2 });
    expect(askKeyAction(M, 'o3', 'o1', press('ArrowDown'))).toEqual({ type: 'move', to: 'commit' });
    expect(askKeyAction(M, 'commit', 'o1', press('ArrowDown'))).toEqual({ type: 'none' });
    expect(askKeyAction(M, 'o1', 'o1', press('ArrowUp'))).toEqual({ type: 'none' });
  });

  it('nothing in the sheet focused yet: an arrow puts the highlight on the start row', () => {
    expect(askKeyAction(Q, null, 'o2', press('ArrowDown'))).toEqual({ type: 'move', to: 'o2' });
  });
});

/** Every `(pointer: …)` query answers as a desktop with a mouse (`fine`) or a phone (`coarse`). */
function pointer(kind: 'fine' | 'coarse'): void {
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    matches: kind === 'fine' ? q.includes('pointer: fine') : q.includes('pointer: coarse'),
    media: q, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

const SESSION_ID = 'lane-a:project-a';
const fakeSocket = (): WebSocket => ({
  readyState: 1, send: () => {}, close: () => {}, addEventListener: () => {}, removeEventListener: () => {},
}) as unknown as WebSocket;

const q1 = (): Dialog => pane('cc296-ask-2q-long-q1');
const q2 = (): Dialog => pane('cc296-ask-2q-long-q2');
const review = (): Dialog => pane('cc296-ask-2q-long-review');

/** A frame, so the sheet's focus move (one frame after the screen) has run. */
const frame = async (): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

function renderAsk(first: Dialog, envelope: typeof CC296_LONG | null = CC296_LONG, extra?: React.ReactNode) {
  const store = createSessionStore(SESSION_ID, {
    makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) },
  });
  act(() => {
    store.getState().apply({ type: 'ask_cleared' });
    store.getState().apply({ type: 'dialog', dialog: first });
    if (envelope !== null) store.getState().apply({ type: 'ask', ask: envelope, key: null });
  });
  render(
    <>
      {extra}
      <DialogSheet id={SESSION_ID} store={store} onOpenTerminal={vi.fn()} />
      <ToastHost />
    </>,
  );
  return store;
}

const row = (name: RegExp): HTMLElement => screen.getByRole('button', { name });

describe('the sheet\'s keyboard over the recorded 2.1.296 ask', () => {
  it('under a fine pointer focus starts on the pane\'s cursor row, and ↓ moves it with the ❯ (roving tabindex)', async () => {
    pointer('fine');
    renderAsk(q1());
    await frame();
    const first = row(/^Split shifts/);
    expect(document.activeElement).toBe(first);
    expect(first).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('aria-keyshortcuts', '1');
    expect(row(/^Wait for the second tank/)).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    const second = row(/^Wait for the second tank/);
    expect(document.activeElement).toBe(second);
    expect(second).toHaveAttribute('tabindex', '0');
    expect(second.querySelector('.opt-glyph')?.textContent).toBe('❯');
    expect(first.querySelector('.opt-glyph')?.textContent).toBe('');
  });

  // D-6029: this row pinned the composer keeping the focus behind the open sheet's scrim, which D-5931 replaces (spec
  // 2026-10-20 §2.4: the Sheet takes the focus on open, and a phone's keyboard still never rises because the panel is
  // no field). What it guards is kept: under a coarse pointer the sheet puts no row in focus, and a key in the composer
  // is text, never an answer.
  it('under a coarse pointer the panel takes the focus, never a row (no keyboard rises); a key in the composer is text', async () => {
    pointer('coarse');
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const composer = document.createElement('textarea');
    document.body.appendChild(composer);
    composer.focus();
    renderAsk(q1());
    await frame();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    expect(document.activeElement).not.toBe(row(/^Split shifts/));
    fireEvent.keyDown(composer, { key: '2' });
    fireEvent.keyDown(composer, { key: 'ArrowDown' });
    expect(spy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    composer.remove();
  });

  it('a key aimed at a control outside the sheet (a header button) is that control\'s, never an answer', async () => {
    pointer('coarse');
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    renderAsk(q1());
    await frame();
    fireEvent.keyDown(outside, { key: '2' });
    fireEvent.keyDown(outside, { key: 'ArrowDown' });
    expect(spy).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(row(/^Split shifts/));
    outside.remove();
  });

  it('a hardware keyboard on a phone: the first arrow on the page moves focus into the sheet', async () => {
    pointer('coarse');
    renderAsk(q1());
    await frame();
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row(/^Split shifts/));
  });

  it('a digit answers that option; Enter on the focused row answers it (the row\'s own button)', async () => {
    pointer('fine');
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderAsk(q1());
    await frame();
    const user = userEvent.setup();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(spy).toHaveBeenCalledWith(SESSION_ID, q1().id, 2);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('Chat\'s digit only highlights Chat (it declines the whole ask); the free-text row\'s digit chooses Other and puts the cursor in the field', async () => {
    pointer('fine');
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderAsk(q1());
    await frame();
    // Other is a row of the list while its field is closed: a button, no field yet.
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: '4' });
    expect(spy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(row(/^Talk it over in the chat instead/));
    fireEvent.keyDown(document.activeElement!, { key: '3' });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Your own answer' }));
    expect(spy, 'choosing Other answers nothing').not.toHaveBeenCalled();
  });

  it('↓ from the last option reaches the Other row, and Enter on it opens the field with the cursor in it', async () => {
    pointer('fine');
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderAsk(q1());
    await frame();
    const user = userEvent.setup();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(row(/^Other/));
    expect(document.activeElement).toHaveAttribute('aria-keyshortcuts', '3');
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Your own answer' }));
    expect(spy).not.toHaveBeenCalled();
    // ↓ from the field is Chat; ↑ from Chat is the field again (the model's `words` row).
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(row(/^Talk it over in the chat instead/));
  });

  it('the own-answer field keeps ←/→ and digits; ↑ leaves it for the last option', async () => {
    pointer('fine');
    const tab = vi.spyOn(api, 'answerDialogTab').mockReturnValue(new Promise(() => {}));
    renderAsk(q1());
    await frame();
    fireEvent.click(row(/^Other/));
    const field = screen.getByRole('textbox', { name: 'Your own answer' });
    field.focus();
    fireEvent.keyDown(field, { key: 'ArrowRight' });
    fireEvent.keyDown(field, { key: '1' });
    expect(tab).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(row(/^Wait for the second tank/));
  });

  it('→ on the last question moves the pane, and the review it lands on opens with no stream frame', async () => {
    pointer('fine');
    const tab = vi.spyOn(api, 'answerDialogTab').mockResolvedValue({ ok: true, next: review() });
    renderAsk(q2());
    await frame();
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    });
    expect(tab).toHaveBeenCalledWith(SESSION_ID, { dialogId: q2().id, to: 'next' });
    expect(row(/^Submit answers/)).toBeEnabled();
  });

  it('← on question 1 and → on the review send nothing; ← on the review moves back', async () => {
    pointer('fine');
    const tab = vi.spyOn(api, 'answerDialogTab').mockReturnValue(new Promise(() => {}));
    renderAsk(q1());
    await frame();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(tab).not.toHaveBeenCalled();
    cleanup();
    renderAsk(review());
    await frame();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(tab).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(tab).toHaveBeenCalledWith(SESSION_ID, { dialogId: review().id, to: 'prev' });
  });

  // The transcript's copy is ONE question, so its own place in the copy is always 0; the key place is the question's
  // place on the pane's tab row, by its header (`headerTab`). ← must work on tab 2 of a three-tab pane (D-6325).
  it.each([
    ['Tracing', true, 'tab 2 of 3: ← moves the pane back'],
    ['Cache', false, 'tab 1 of 3: nothing before it'],
    ['A header no tab carries', true, 'a place it cannot tell: the server decides'],
  ])('a transcript copy with the header %s: ← sends %s (%s)', async (header, sends) => {
    pointer('fine');
    const tab = vi.spyOn(api, 'answerDialogTab').mockReturnValue(new Promise(() => {}));
    const fx = askFixture(2).dialog!;
    renderAsk({ ...fx, ask: { ...fx.ask!, header } }, null);
    await frame();
    expect(document.querySelector('[data-source="transcript"]')).not.toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    if (sends) expect(tab).toHaveBeenCalledWith(SESSION_ID, { dialogId: fx.id, to: 'prev' });
    else expect(tab).not.toHaveBeenCalled();
  });

  it('the review\'s ↑/↓ wrap between Submit and Cancel', async () => {
    pointer('fine');
    renderAsk(review());
    await frame();
    expect(document.activeElement).toBe(row(/^Submit answers/));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row(/^Cancel/));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row(/^Submit answers/));
  });

  it('a move in flight is a send: a digit pressed meanwhile answers nothing', async () => {
    pointer('fine');
    vi.spyOn(api, 'answerDialogTab').mockReturnValue(new Promise(() => {}));
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderAsk(q2());
    await frame();
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: '1' });
    expect(answer).not.toHaveBeenCalled();
  });

  it('a refused move says why and leaves the sheet where it is', async () => {
    pointer('fine');
    vi.spyOn(api, 'answerDialogTab').mockRejectedValue(new ApiError(409, { ok: false, error: 'no-move' }));
    renderAsk(q2());
    await frame();
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    });
    expect(await screen.findByText(DIALOG_TAB_REFUSE_TEXT['no-move'])).toBeInTheDocument();
    expect(row(/^Borrow and transport/)).toBeEnabled();
  });

  it('every key the sheet handles stops there: a window listener never sees it, and one it does not handle passes', async () => {
    pointer('fine');
    vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const seen: string[] = [];
    const onWindow = (e: KeyboardEvent): void => void seen.push(e.key);
    window.addEventListener('keydown', onWindow);
    renderAsk(q1());
    await frame();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: '1' });
    fireEvent.keyDown(document.activeElement!, { key: 'x' });
    window.removeEventListener('keydown', onWindow);
    expect(seen).toEqual(['x']);
  });
});

describe('Escape hides the sheet and never interrupts (decision ask-sheet-escape-never-interrupts)', () => {
  const headerProps = (onInterrupt: () => void): HeaderHostProps => ({
    session: fleetSession({ id: 'project-a-quiet-basin', project: 'project-a', status: 'busy', bucket: 'working' }),
    status: 'busy', statusUpdatedAt: null,
    onInterrupt, onOpenTerminal: vi.fn(), onBack: vi.fn(), onChangeModel: vi.fn(),
    onChangeEffort: vi.fn(), onMoveAccount: vi.fn(), onArchive: vi.fn(), onRestore: vi.fn(),
    onOpenHistory: vi.fn(), onReapWorkspace: vi.fn(), roster: TEST_ROSTER,
  });

  it('busy session, fine pointer: Escape on a focused row hides the sheet, and the header does not interrupt', async () => {
    pointer('fine');
    const onInterrupt = vi.fn();
    renderAsk(q1(), CC296_LONG, <SessionHeaderHost {...headerProps(onInterrupt)} />);
    await frame();
    const r = row(/^Split shifts/);
    r.focus();
    fireEvent.keyDown(r, { key: 'Escape' });
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it('the sheet\'s half alone: Escape on a row never reaches a window listener (the header guard, #484, is the other half)', async () => {
    // SessionHeader now also ignores an Escape a sheet handled (D-5235), so the busy-header case above holds with
    // either half. This one pins the sheet's own stop: Radix prevents the key's default but would let it propagate.
    pointer('fine');
    const seen: string[] = [];
    const onWindow = (e: KeyboardEvent): void => void seen.push(e.key);
    window.addEventListener('keydown', onWindow);
    try {
      renderAsk(q1());
      await frame();
      const r = row(/^Split shifts/);
      r.focus();
      fireEvent.keyDown(r, { key: 'Escape' });
      await act(async () => {});
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener('keydown', onWindow);
    }
  });

  it('a sheet Escape hid takes no keys: 2 on the page after hiding the review cancels nothing', async () => {
    pointer('fine');
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderAsk(review());
    await frame();
    const submit = row(/^Submit answers/);
    expect(document.activeElement).toBe(submit);
    fireEvent.keyDown(submit, { key: 'Escape' });
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: '2' });
    fireEvent.keyDown(document.body, { key: '1' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the tab strip (decision ask-tab-strip)', () => {
  it('one chip per question with its answered mark, then Submit; the question showing is current', async () => {
    renderAsk(q2());
    const strip = screen.getByRole('group', { name: 'Questions in this ask' });
    const chips = [...strip.querySelectorAll('button')];
    expect(chips.map((c) => c.textContent)).toEqual(['☒Water rota', '☐Table supply', '✔Submit']);
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Go to Water rota, answered', 'Go to Table supply, not answered yet', 'Go to Submit',
    ]);
    expect(chips[1]).toHaveAttribute('aria-current', 'step');
    expect(chips[1]).toBeDisabled();
  });

  it('a chip moves the pane: question 1 with the tab showing as from, and Submit to the review', async () => {
    const tab = vi.spyOn(api, 'answerDialogTab').mockReturnValue(new Promise(() => {}));
    renderAsk(q2());
    fireEvent.click(screen.getByRole('button', { name: /^Go to Water rota/ }));
    expect(tab).toHaveBeenCalledWith(SESSION_ID, { dialogId: q2().id, to: 1, from: 2 });
  });

  it('Submit from question 1, and every chip waits while the move runs', async () => {
    const tab = vi.spyOn(api, 'answerDialogTab').mockReturnValue(new Promise(() => {}));
    renderAsk(q1());
    fireEvent.click(screen.getByRole('button', { name: /Submit$/ }));
    expect(tab).toHaveBeenCalledWith(SESSION_ID, { dialogId: q1().id, to: 'submit', from: 1 });
    const strip = screen.getByRole('group', { name: 'Questions in this ask' });
    for (const chip of strip.querySelectorAll('button')) expect(chip).toBeDisabled();
  });

  it('on the review Submit is current, and question chips need no from', async () => {
    const tab = vi.spyOn(api, 'answerDialogTab').mockReturnValue(new Promise(() => {}));
    renderAsk(review());
    expect(screen.getByRole('button', { name: /Submit$/ })).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: /Table supply/ }));
    expect(tab).toHaveBeenCalledWith(SESSION_ID, { dialogId: review().id, to: 2 });
  });

  // D-6325, R3: a strip's chips carry Claude's own headers and are drawn only when the pane's tab row has exactly one tab
  // per question. Once the envelope has aged out the copy is the transcript's ONE question, so a two-tab row gets no
  // strip (the accepted loss: the envelope keeps the strip while it lasts), and a pane with no copy at all is
  // unreadable and draws nothing of its tab row. The strip's own behaviour is pinned above, over the envelope.
  it('the aged-out sheet draws no strip over a two-tab row: one question\'s copy cannot label two tabs', () => {
    const second = CC296_LONG.questions[1]!;
    const enriched: Dialog = {
      ...q2(),
      ask: { question: second.question, header: second.header, multiSelect: false, options: second.options },
    };
    renderAsk(enriched, null);
    expect(screen.getByRole('heading', { name: second.question })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Questions in this ask' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Go to / })).toBeNull();
  });

  it('with no copy of the question there is no strip, and none of the tab row is shown', () => {
    renderAsk(q2(), null);
    expect(screen.queryByRole('group', { name: 'Questions in this ask' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Go to / })).toBeNull();
    expect(screen.getByRole('heading', { name: "Claude is asking a question this screen can't read yet." })).toBeInTheDocument();
  });

  it('the chip of the screen showing is brought into the strip sideways only, and again when the screen changes', async () => {
    // D-6325: the strip's chip used to be `scrollIntoView`ed, whose `block: 'nearest'` also scrolled the sheet body
    // (with one scroller a long question put the strip below the fold, so the body opened scrolled down to the chip).
    // Now the strip's own `scrollLeft` moves, from the rectangles, and nothing else scrolls: `scrollIntoView` is never
    // called. jsdom lays nothing out, so each rectangle is staged: the strip is 100px wide at the page's left edge and
    // a chip sits at `chipLeft - strip.scrollLeft`, 80px wide.
    const intoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: intoView, configurable: true });
    const rect = (left: number, width: number): DOMRect => ({
      left, right: left + width, top: 0, bottom: 44, width, height: 44, x: left, y: 0, toJSON: () => ({}),
    });
    const chipLeft: Record<string, number> = {
      'Go to Table supply, not answered yet': 150, 'Go to Submit': 240,
    };
    const rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('ask-tabs')) return rect(0, 100);
      const name = this.getAttribute('aria-label') ?? '';
      const at = chipLeft[name];
      const strip = this.closest<HTMLElement>('.ask-tabs');
      return at === undefined || strip === null ? rect(0, 0) : rect(at - strip.scrollLeft, 80);
    });
    try {
      vi.spyOn(api, 'answerDialogTab').mockResolvedValue({ ok: true, next: review() });
      renderAsk(q2());
      const strip = screen.getByRole('group', { name: 'Questions in this ask' });
      // Chip 1 spans 150-230 against a 0-100 strip: its right edge is brought to the strip's (230 - 100).
      expect(strip.scrollLeft).toBe(130);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Go to Submit' }));
      });
      // Submit spans 240-320 at the page. The review is a new screen with its own strip, which starts at 0 and is
      // scrolled by its chip's right edge over the strip's (320 - 100).
      expect(screen.getByRole('group', { name: 'Questions in this ask' }).scrollLeft).toBe(220);
      expect(intoView, 'the sheet body is never scrolled by the strip').not.toHaveBeenCalled();
    } finally {
      rects.mockRestore();
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('the open-time focus never scrolls the sheet (D-6325), and an arrow key\'s focus keeps its scroll', async () => {
    pointer('fine');
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      renderAsk(q2());
      await frame();
      // The calls that landed on an option row: the open-time focus of `useAskKeys`.
      const onRow = (): FocusOptions[] => focus.mock.calls.flatMap((c, i) =>
        (focus.mock.contexts[i] as HTMLElement).classList.contains('opt') ? [(c[0] ?? {}) as FocusOptions] : []);
      expect(onRow().length, 'the open-time focus ran on a row').toBeGreaterThan(0);
      expect(onRow().every((o) => o.preventScroll === true), 'and with preventScroll').toBe(true);
      focus.mockClear();
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
      expect(focus, 'an arrow key moved the focus').toHaveBeenCalled();
      expect(onRow().length, 'on a row').toBeGreaterThan(0);
      expect(onRow().every((o) => o.preventScroll === undefined), 'with the normal scroll').toBe(true);
    } finally {
      focus.mockRestore();
    }
  });

  it('a one-question ask paints no tab row, so there is no strip', () => {
    renderAsk(pane('cc300-ask-1q-open'), null);
    expect(screen.queryByRole('group', { name: 'Questions in this ask' })).toBeNull();
  });

  it('multiSelect boxes changed and not committed: the strip and ←/→ wait, and say why', async () => {
    pointer('fine');
    const tab = vi.spyOn(api, 'answerDialogTab').mockReturnValue(new Promise(() => {}));
    const tools = pane('cc300-ask-multiselect-tools-open');
    renderAsk(tools, TOOLS_SIZES);
    await frame();
    fireEvent.keyDown(document.activeElement!, { key: '2' });
    expect(screen.getByText(TABS_HELD)).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(tab).not.toHaveBeenCalled();
    const strip = screen.getByRole('group', { name: 'Questions in this ask' });
    for (const chip of strip.querySelectorAll('button')) expect(chip).toBeDisabled();
  });

  it('the chips are the 44px tap floor tall and scroll sideways inside the strip, never the page', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'session', 'chat.css'), 'utf8');
    expect(declValue(ruleIn(css, '.ask-tab'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(css, '.ask-tabs'), 'overflow-x')).toBe('auto');
    expect(declValue(ruleIn(css, '.ask-tabs'), 'overscroll-behavior-x')).toBe('contain');
    expect(declValue(ruleIn(css, '.ask-tab'), 'flex')).toBe('none');
  });
});
