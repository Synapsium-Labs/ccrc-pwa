// D-6326 (plan docs/superpowers/plans/2026-10-22-desktop-polish.md, Task T1c): at the desk the ask is answered INLINE in
// the session pane, a `[data-ask-surface]` card between the transcript and the strips; a phone keeps the T1b `Sheet`.
// Exactly one container is mounted at any width, and the keys, Escape, focus and the composer all follow from the card
// blocking nothing: a key acts only inside it, Escape never declines a question by accident, an arriving ask takes no
// focus, and Send keeps its text while a question is up.
//
// THE DESK is `matchMedia` stubbed so `(min-width: 900px)` and `(pointer: fine)` are true (`DESK_QUERY` is the one
// spelling in production; this file stubs by the same words the `ui` hook asks); BELOW 900 both are false unless a case
// says otherwise. Every other query answers false, so the inspector rail (1600) never mounts.
//
// The inputs are the plan's ask fixtures (`askFixtures.ts`): fixture 1 (the hook envelope with three questions, its
// parsed dialog), 7 (an approval) and 8 (the review). The cases render the real `SessionScreen`, so the slot's place,
// the interrupt and the composer are the screen's own, and `DialogSheet` alone where only the controller matters.
//
// RED FIRST, measured on the task's base (T1b's `AskSheet` at every width): the cases that need the card red on the
// missing `[data-ask-surface]` or on the behaviour that follows from its absence (a key on the page answering, an
// arriving ask taking focus, Send making its request); the regression pins (a busy turn still interrupts with no ask up;
// the phone halves) pass today and keep passing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useLayoutEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatEvent, Dialog, FleetSession } from '../../shared/api';
import { api, ApiError, sendErrorText } from '../src/lib/api';
import { ChatListInner } from '../src/session/ChatList';
import { DialogSheet } from '../src/session/DialogSheet';
import { SessionScreen } from '../src/screens/SessionScreen';
import { createFleetStore } from '../src/stores/fleet';
import { createSessionStore, type SessionStore } from '../src/stores/session';
import { askFixture, HOOK_QUESTIONS } from './askFixtures';
import { fleetSession } from './fleetFixture';

// The transcript's rows, all of them in order: virtuoso measures nothing in jsdom and would render none.
vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: { totalCount: number; itemContent: (i: number) => ReactNode }) =>
      React.createElement('div', { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) =>
          React.createElement('div', { key: i }, props.itemContent(i)))),
  };
});

const watchers: Array<() => void> = [];
afterEach(() => {
  for (const stop of watchers.splice(0)) stop();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ID = 'lane-a-project-a';
const TS = '2026-10-24T10:00:00.000Z';

/** A width class: the desk (`(min-width: 900px)` and `(pointer: fine)`), or below it (a phone: both false, unless a case
 *  asks for a fine pointer on a narrow window). */
function media(desk: boolean, fine: boolean = desk): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width: 900px') ? desk : q.includes('pointer: fine') ? fine : false,
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

const fakeSocket = (): WebSocket =>
  ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;

const EVENTS: ChatEvent[] = [
  { kind: 'user', uuid: 'u1', ts: TS, text: 'run the suites' },
  { kind: 'assistant', uuid: 'a1', ts: TS, text: 'Running them now.' },
];

/** The live `AskUserQuestion` call the transcript's ask card renders, with no result yet. */
const ASK_CALL: ChatEvent = {
  kind: 'tool_use', uuid: 'a2', ts: TS, toolId: 't1', name: 'AskUserQuestion',
  input: JSON.stringify({ questions: [{ question: 'Which cache should the service use?', header: 'Cache', multiSelect: false,
    options: [{ label: 'Redis' }, { label: 'In-process' }] }] }),
};

/** The session screen over a store that holds no ask yet; `arrive(n)` then delivers fixture `n`'s frames, as the stream
 *  does after the connect. `prompt` is the store's own send: a case asserts it was never called. */
function mount(o: { status?: 'idle' | 'busy'; events?: ChatEvent[]; row?: FleetSession } = {}) {
  const status = o.status ?? 'idle';
  const prompt = vi.fn().mockResolvedValue(undefined);
  const store: SessionStore = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt } });
  const row: FleetSession = o.row ?? fleetSession({ id: ID, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', status });
  const fleet = createFleetStore({ makeSocket: fakeSocket });
  act(() => fleet.setState({ sessions: [row], conn: 'open' }));
  act(() => store.setState({ uuid: 'u1', status, events: o.events ?? EVENTS }));
  render(<SessionScreen id={ID} store={store} fleet={fleet} />);
  const arrive = (n: number): void => {
    act(() => {
      for (const frame of askFixture(n).frames) store.getState().apply(frame);
    });
  };
  return { store, prompt, arrive };
}

/** A frame, so every timer the ask's arrival starts (the focus move, about 16 ms on) has run. */
const frame = async (): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

/** R102: records every `focusin` that lands inside the inline card from now on. After a send this client initiates, the
 *  next screen assigns no focus, so none may fire here until the operator re-engages; focus a reused row node RETAINS
 *  fires no event, which is why the oracle is this record and not `activeElement` alone. Stopped by `afterEach`. */
function watchCardFocus(): { seen: () => string[] } {
  const seen: string[] = [];
  const on = (e: Event): void => {
    const t = e.target instanceof Element ? e.target : null;
    if (t !== null && t.closest('[data-ask-surface="inline"]') !== null) seen.push(`${t.tagName} ${t.textContent?.slice(0, 30) ?? ''}`);
  };
  document.addEventListener('focusin', on, true);
  watchers.push(() => document.removeEventListener('focusin', on, true));
  return { seen: () => seen };
}

/** R102: the focus after this client's answer is either the node it was on right after the answer (a reused row may keep
 *  it) or the page body (a row that left the DOM drops it there); never a node the next screen assigned it to. */
function expectNoRefocus(w: { seen: () => string[] }, atAnswer: Element | null, what: string): void {
  expect(w.seen(), `${what}: no focus or focusin was assigned inside the card`).toEqual([]);
  expect([atAnswer, document.body], `${what}: focus is where the answer left it, or on the body`).toContain(document.activeElement);
}

const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-ask-surface]')];
const dialogs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
const overlays = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="sheet-overlay"]')];

/** The inline card, which the case under test presupposes: a missing one is the red. */
function card(): HTMLElement {
  const found = cards();
  expect(found, 'an inline [data-ask-surface] card is mounted').toHaveLength(1);
  return found[0]!;
}

const composer = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
const opt = (scope: HTMLElement, name: RegExp): HTMLElement => within(scope).getByRole('button', { name });
const QUESTION = 'Which cache should the service use?';
const key = (el: Element, k: string): boolean => fireEvent.keyDown(el, { key: k });

describe('the ask is one container at each width', () => {
  it('at ≥900 the ask renders as a [data-ask-surface] section in the pane, and no Sheet is mounted; below 900 the Sheet and no section', () => {
    media(false);
    const phone = mount();
    phone.arrive(1);
    expect(cards(), 'below 900: no section').toHaveLength(0);
    expect(dialogs(), 'below 900: the Sheet').toHaveLength(1);
    expect(overlays(), 'below 900: its scrim').toHaveLength(1);
    expect(within(dialogs()[0]!).getByText(QUESTION)).toBeInTheDocument();
    cleanup();

    media(true);
    const desk = mount();
    desk.arrive(1);
    expect(cards(), 'at the desk: one section').toHaveLength(1);
    expect(dialogs(), 'at the desk: no Sheet dialog').toHaveLength(0);
    expect(overlays(), 'at the desk: no Sheet scrim').toHaveLength(0);
    expect(cards()[0]!.tagName).toBe('SECTION');
    expect(within(cards()[0]!).getByText(QUESTION), 'the question is in the card').toBeInTheDocument();
    expect(opt(cards()[0]!, /^Redis/)).toBeInTheDocument();
  });

  it('the ask slot sits between the transcript and the strips, and the composer keeps its node across the ask\'s arrival', () => {
    media(true);
    const { arrive } = mount();
    const box = composer();
    arrive(1);
    const section = card();
    expect(section.previousElementSibling, 'the transcript is above it').toHaveClass('chat-body');
    expect(section.nextElementSibling, 'the strips are below it').toHaveClass('chat-strips');
    expect(section.parentElement, 'in the pane, beside the composer').toBe(document.querySelector('.chat'));
    expect(composer(), 'the composer is the same node').toBe(box);
    expect(box.isConnected).toBe(true);
  });
});

describe('Escape at the desk', () => {
  it('Escape inside the card is prevented and sends no interrupt', () => {
    media(true);
    const interrupt = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined);
    const { arrive } = mount({ status: 'busy' });
    arrive(1);
    const first = opt(card(), /^Redis/);
    const notPrevented = key(first, 'Escape');
    expect(notPrevented, 'the card prevents the default (the interrupt skips a prevented Escape, D-5235)').toBe(false);
    expect(interrupt).not.toHaveBeenCalled();
    // The card is not dismissed by it either: the question is still there.
    expect(within(card()).getByText(QUESTION)).toBeInTheDocument();
  });

  it('with live status busy and an inline ask mounted, Escape with focus on the page body or a transcript row sends no interrupt', () => {
    media(true);
    const interrupt = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined);
    const { arrive } = mount({ status: 'busy' });
    arrive(1);
    // The premise: the card is mounted and, being no dialog, is no reason for the interrupt to stand down by itself.
    card();
    expect(dialogs()).toHaveLength(0);
    key(document.body, 'Escape');
    expect(interrupt, 'from the page body').not.toHaveBeenCalled();
    key(screen.getByText('Running them now.'), 'Escape');
    expect(interrupt, 'from a transcript row').not.toHaveBeenCalled();
  });

  it('with no ask up, Escape from the page still interrupts a busy turn', () => {
    media(true);
    const interrupt = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined);
    mount({ status: 'busy' });
    expect(cards()).toHaveLength(0);
    key(document.body, 'Escape');
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(interrupt).toHaveBeenCalledWith(ID, 'escape-key');
  });
});

describe('the keys act only inside the inline card', () => {
  it('a digit pressed with focus on the page body does not answer an inline ask', () => {
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive } = mount();
    arrive(1);
    const section = card();
    key(document.body, '2');
    expect(answer, 'a digit on the page body').not.toHaveBeenCalled();
    key(screen.getByText('Running them now.'), '2');
    expect(answer, 'a digit on a transcript row').not.toHaveBeenCalled();
    // The same key inside the card does answer: the case is not vacuous.
    key(opt(section, /^In-process/), '2');
    expect(answer).toHaveBeenCalledTimes(1);
  });

  it('← with focus on the page body sends no tab move', () => {
    media(true);
    // The review: ← there is a real move (to the last question), so a page-body ← that sent nothing is the card's doing.
    const tab = vi.spyOn(api, 'answerDialogTab').mockReturnValue(new Promise(() => {}));
    const { arrive } = mount();
    arrive(8);
    const section = card();
    key(document.body, 'ArrowLeft');
    expect(tab, '← on the page body').not.toHaveBeenCalled();
    // Inside the card the same key moves the pane's tab: the case is not vacuous.
    key(opt(section, /^Submit answers/), 'ArrowLeft');
    expect(tab).toHaveBeenCalledTimes(1);
    expect(tab).toHaveBeenCalledWith(ID, { dialogId: askFixture(8).dialog!.id, to: 'prev' });
  });

  // The sheet's own keyboard, over the same rows, at both widths: below 900 the keys are scoped to the dialog, at the
  // desk to the card, and in either one a digit answers its row and an arrow moves the focus (`ask-keys.test.tsx`'s model).
  it.each([
    ['below 900, on the sheet', false],
    ['at the desk, in the card', true],
  ])('the number keys and arrows answer inside the card as they do on the sheet (%s)', (_where, desk) => {
    media(desk, desk);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive } = mount();
    arrive(1);
    const scope = desk ? card() : dialogs()[0]!;
    expect(scope).toBeTruthy();
    const first = opt(scope, /^Redis/);
    act(() => first.focus());
    key(first, 'ArrowDown');
    const second = opt(scope, /^In-process/);
    expect(document.activeElement, 'ArrowDown moves focus to the next row').toBe(second);
    expect(second).toHaveAttribute('tabindex', '0');
    key(second, '3');
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith(ID, askFixture(1).dialog!.id, 3);
  });
});

describe('an inline ask takes no focus', () => {
  it('an inline ask arriving at a fine pointer leaves focus where it was, in the composer or anywhere else', async () => {
    media(true);
    const { arrive } = mount();
    await frame();
    // In the composer (a fine pointer put it there when the session opened).
    const box = composer();
    act(() => box.focus());
    expect(document.activeElement).toBe(box);
    arrive(1);
    await frame();
    card();
    expect(document.activeElement, 'the composer keeps focus').toBe(box);
    cleanup();

    // Anywhere else: a button in the page the operator had just used.
    const mounted = mount();
    await frame();
    const elsewhere = document.createElement('button');
    elsewhere.textContent = 'elsewhere';
    document.body.appendChild(elsewhere);
    act(() => elsewhere.focus());
    expect(document.activeElement).toBe(elsewhere);
    mounted.arrive(1);
    await frame();
    card();
    expect(document.activeElement, 'a control elsewhere keeps focus').toBe(elsewhere);
    elsewhere.remove();
  });
});

/** Question 2 of fixture 1 as the pane paints it after question 1 is answered: another id, other rows (the `repainted`
 *  screen of `ask-structured.test.tsx`'s gap cases), `☒ Cache` in the tab row. */
const nextScreen = (): Dialog => ({
  ...askFixture(1).dialog!, id: 'dlg-a2', selectedIndex: 1,
  options: [{ index: 1, label: 'Yes' }, { index: 2, label: 'No' }, { index: 3, label: 'Type something.' }, { index: 4, label: 'Chat about this' }],
  raw: ['╭ pane chrome ╮', '←  ☒ Cache  ☐ Tracing  ☐ Regions  ✔ Submit  →', '  1. Yes', '  2. No', '  3. Type something.',
    '  4. Chat about this'].join('\n'),
});
const QUESTION_2 = 'Should tracing be on from the first deploy?';
/** Aged question 2 of fixture 1: the envelope gone, the pane's other rows, the transcript's copy of the question. */
const agedQuestion2 = (): Dialog => {
  const q2 = HOOK_QUESTIONS[1]!;
  return {
    ...askFixture(2).dialog!, id: 'dlg-a2-q2', selectedIndex: 1,
    options: [...q2.options.map((o, i) => ({ index: i + 1, label: o.label, description: o.description })),
      { index: q2.options.length + 1, label: 'Type something.' }, { index: q2.options.length + 2, label: 'Chat about this' }],
    ask: { question: q2.question, header: q2.header, multiSelect: false, options: q2.options.map((o) => ({ ...o })) },
  };
};

/** R115: a DIFFERENT aged ask (another question, other options, another pane dialog id) as the pane paints it, with no
 *  envelope, so its rows are keyed by position like fixture 2's. */
const OTHER_QUESTION = 'Which database should the service use?';
const otherAgedAsk = (): Dialog => {
  const options = [{ label: 'Postgres', description: 'A server.' }, { label: 'SQLite', description: 'A file.' }, { label: 'Neither' }];
  return {
    ...askFixture(2).dialog!, id: 'dlg-other-ask', title: OTHER_QUESTION, body: OTHER_QUESTION, selectedIndex: 1,
    options: [...options.map((o, n) => ({ index: n + 1, label: o.label, description: o.description })),
      { index: options.length + 1, label: 'Type something.' }, { index: options.length + 2, label: 'Chat about this' }],
    ask: { question: OTHER_QUESTION, header: 'Database', multiSelect: false, options: options.map((o) => ({ ...o })) },
  };
};

describe('the keys survive a screen change inside the card (D-6326)', () => {
  it('after a key answers a question in the card, the next question takes no focus and a digit sends nothing (R102)', async () => {
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockResolvedValueOnce({ ok: true, next: nextScreen() });
    const { arrive } = mount();
    await frame(); // the composer's own session-open focus (a 0 ms timer) has run, as in a real session
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    const watch = watchCardFocus();
    const at: { node: Element | null } = { node: null };
    await act(async () => { key(first, '1'); at.node = document.activeElement; });
    await frame();
    expect(answer).toHaveBeenCalledWith(ID, askFixture(1).dialog!.id, 1);
    expect(within(card()).getByText(QUESTION_2), 'question 2 is in the card').toBeInTheDocument();
    // The row that held focus left the DOM with question 1. R102: a send this client initiated released the keyboard, so
    // question 2 takes no focus (before R102 it took the highlighted row, and the next digit answered it).
    expectNoRefocus(watch, at.node, 'question 2');
    answer.mockReturnValue(new Promise(() => {}));
    expect(document.activeElement, 'question 2: the premise of the digit is body focus, so it lands outside the card').toBe(document.body);
    key(document.activeElement ?? document.body, '2');
    expect(answer, 'a digit sends nothing').toHaveBeenCalledTimes(1);
  });

  it('a screen change takes no focus back from the composer the operator moved to after the key answer', async () => {
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, '1');
    expect(answer).toHaveBeenCalledTimes(1);
    // The operator clicks into the composer before the next screen lands.
    const box = composer();
    act(() => box.focus());
    act(() => store.getState().apply({ type: 'dialog', dialog: nextScreen() }));
    await frame();
    expect(within(card()).getByText(QUESTION_2)).toBeInTheDocument();
    expect(document.activeElement, 'the composer keeps focus').toBe(box);
  });
});

describe('a keyboard engagement ends with its ask (D-6326)', () => {
  it('a later inline ask takes no focus from the page body because the keys were used on an earlier one', async () => {
    media(true);
    const { arrive, store } = mount();
    await frame();
    // The review (the controller's own keys): an arrow inside the card engages the keyboard and sends nothing.
    arrive(8);
    const submit = opt(card(), /^Submit answers/);
    act(() => submit.focus());
    key(submit, 'ArrowDown');
    expect(card().contains(document.activeElement), 'the arrow moved focus inside the card').toBe(true);
    // That ask ends: the card leaves, and focus with it.
    act(() => {
      store.getState().apply({ type: 'ask_cleared' });
      store.getState().apply({ type: 'dialog_cleared' });
    });
    await frame();
    expect(cards()).toHaveLength(0);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    // A new menu arrives with focus on the page body: it is a new ask, and an arriving ask takes no focus.
    arrive(4);
    await frame();
    expect(cards()).toHaveLength(1);
    expect(card().contains(document.activeElement), 'the new card took no focus').toBe(false);
  });
});

// R64 F1/F2: ONE engagement per logical ask (`useAskEngagement`, owned by `DialogSheet`). The keyboard stays engaged across
// question → review, review ← question and question → question of the SAME ask (the hooked envelope's identity), ends on a
// different ask even in one batch with the clear, and is never reclaimed after a deliberate move out of the card.
describe('one keyboard engagement per logical ask (R64 F1, F2)', () => {
  const reviewDialog = (): Dialog => askFixture(8).dialog!;

  it('a digit whose answer brings the review takes no focus on the review, and a next digit sends nothing (R102)', async () => {
    // Premises: the desk; fixture 1's envelope up; the answer's `next` is the review (review 917 F1's shape).
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockResolvedValueOnce({ ok: true, next: reviewDialog() });
    const { arrive } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    const watch = watchCardFocus();
    const at: { node: Element | null } = { node: null };
    await act(async () => { key(first, '1'); at.node = document.activeElement; });
    await frame();
    expect(answer).toHaveBeenCalledTimes(1);
    expect(opt(card(), /^Submit answers/), 'premise: the review is mounted').toBeInTheDocument();
    expectNoRefocus(watch, at.node, 'the review');
    answer.mockReturnValue(new Promise(() => {}));
    expect(document.activeElement, 'the review: the premise of the digit is body focus, so it lands outside the card').toBe(document.body);
    key(document.activeElement ?? document.body, '1');
    expect(answer, 'a digit on the review sends nothing').toHaveBeenCalledTimes(1);
  });

  it('← from the review back to a question takes no focus on the question, and a digit sends nothing (R102)', async () => {
    // Premises: the review is up with its envelope; ← inside the card moves the pane's tab (a send), and `next` is question 1.
    media(true);
    const tab = vi.spyOn(api, 'answerDialogTab').mockResolvedValueOnce({ ok: true, next: askFixture(1).dialog! });
    const { arrive } = mount();
    await frame();
    arrive(8);
    const submit = opt(card(), /^Submit answers/);
    act(() => submit.focus());
    const watch = watchCardFocus();
    const at: { node: Element | null } = { node: null };
    await act(async () => { key(submit, 'ArrowLeft'); at.node = document.activeElement; });
    await frame();
    expect(tab).toHaveBeenCalledTimes(1);
    expect(within(card()).getByText(QUESTION), 'premise: the question is back').toBeInTheDocument();
    expectNoRefocus(watch, at.node, 'the question');
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    expect(document.activeElement, 'the question: the premise of the digit is body focus, so it lands outside the card').toBe(document.body);
    key(document.activeElement ?? document.body, '2');
    expect(answer, 'a digit sends nothing').not.toHaveBeenCalled();
  });

  it('an ask that replaces an engaged one in the same batch as the clear takes no focus from the page body', async () => {
    // Premises: the review is engaged by an arrow; focus falls to the body; ONE batch clears the ask and brings a menu
    // (review 917 F2's shape). The card stays mounted across it (one container), so no unmount ends the engagement.
    media(true);
    const { arrive, store } = mount();
    await frame();
    arrive(8);
    const section = card();
    const submit = opt(section, /^Submit answers/);
    act(() => submit.focus());
    key(submit, 'ArrowDown');
    expect(section.contains(document.activeElement), 'premise: the arrow engaged the keyboard inside the card').toBe(true);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() => {
      store.getState().apply({ type: 'ask_cleared' });
      for (const f of askFixture(4).frames) store.getState().apply(f);
    });
    await frame();
    expect(card(), 'premise: the same card node carries the new ask').toBe(section);
    expect(within(section).getByText('Ready to code?'), 'premise: the menu is up').toBeInTheDocument();
    expect(card().contains(document.activeElement), 'replacing ask took focus from the body').toBe(false);
  });

  it.each([
    ['the page body', (): Element => document.body],
    ['a transcript row', (): Element => screen.getByText('Running them now.')],
  ])('after a click on %s, the next screen takes no focus back', async (_where, target) => {
    // Premises: a key engaged the card; the operator then pressed the page (pointerdown), the focused row blurred to the
    // body as a click on a non-focusable area does; the next question arrives. R102: engaged by a non-answer key (a digit
    // would send, and a send releases the engagement itself), so the pointerdown's release is what ends it.
    media(true);
    const { arrive, store } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, 'ArrowDown');
    act(() => { fireEvent.pointerDown(target()); });
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() => store.getState().apply({ type: 'dialog', dialog: nextScreen() }));
    await frame();
    expect(within(card()).getByText(QUESTION_2), 'premise: question 2 is in the card').toBeInTheDocument();
    expect(card().contains(document.activeElement), 'the click\'s release held: the screen took no focus back').toBe(false);
  });

  it('an engaged ask replaced by another with NO clear, and then returning byte-identical, takes no focus from the page body', async () => {
    // Premises: engaged on fixture 1's envelope; the hook sends envelopes on a change of JSON only, so fixture 7's approval
    // replaces it with no `ask_cleared` between (the identity never goes null); focus is on the body; fixture 1 returns.
    media(true);
    const { arrive, store } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    // R102: a digit would send, and a send releases the engagement itself (`claim()`), which would end it before the
    // identity change under test could. A non-answer key engages without sending, so the release proved here is the
    // identity's (`useAskEngagement`'s layout effect).
    key(first, 'ArrowDown');
    arrive(7);
    await frame();
    expect(cards(), 'premise: the approval is up in the card').toHaveLength(1);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    arrive(1);
    await frame();
    expect(within(card()).getByText(QUESTION), 'premise: fixture 1 is back').toBeInTheDocument();
    expect(store.getState().ask, 'premise: no clear came between').not.toBeNull();
    expect(card().contains(document.activeElement), 'returning A took focus from the body').toBe(false);
  });

  it('leaving the card by focus alone (the composer focused, then blurred; no pointerdown) ends the engagement', async () => {
    // Premises: a key engaged the card; focus then moved to the composer and fell to the body with no pointer press, so
    // only the `focusin` outside the card can say the operator left; the next question arrives. R102: engaged by a non-answer
    // key (a digit would send, and a send releases the engagement itself), so the focusin release is what ends it.
    media(true);
    const { arrive, store } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, 'ArrowDown');
    act(() => composer().focus());
    act(() => composer().blur());
    expect(document.activeElement, 'premise: focus fell to the body').toBe(document.body);
    act(() => store.getState().apply({ type: 'dialog', dialog: nextScreen() }));
    await frame();
    expect(within(card()).getByText(QUESTION_2), 'premise: question 2 is in the card').toBeInTheDocument();
    expect(card().contains(document.activeElement), 'the focusin release held: the screen took no focus back').toBe(false);
  });

  it('a clear then a later ask with the same content in another batch takes no focus from the page body', async () => {
    // Premises: engaged on fixture 1's envelope; the ask clears (the card leaves); the SAME envelope comes again later.
    media(true);
    const { arrive, store } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    // R102: engaged by a non-answer key, so the identity's release (not a send's) is what this case proves (see above).
    key(first, 'ArrowDown');
    act(() => {
      store.getState().apply({ type: 'ask_cleared' });
      store.getState().apply({ type: 'dialog_cleared' });
    });
    await frame();
    expect(cards(), 'premise: the card left').toHaveLength(0);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    arrive(1);
    await frame();
    expect(cards(), 'premise: the card is back').toHaveLength(1);
    expect(card().contains(document.activeElement), 'the later ask took no focus').toBe(false);
  });
});

// R69 F1, F4: the engagement's identity carries ONE client-side lifecycle generation (the store's `askEpoch`, bumped by
// every `ask_cleared` and `dialog_cleared` frame, so a clear is seen even inside one batch). A hooked ask is its envelope
// plus the generation; an ask-backed surface with no envelope (the transcript's copy, its review, an unreadable ask) is
// ONE ask per generation, because its pane dialog id changes per screen; a plain menu is its own ask per screen.
describe('one lifecycle generation in the ask identity (R69 F1, F4)', () => {
  const reviewDialog = (): Dialog => askFixture(8).dialog!;
  it('an aged question\'s digit whose answer brings the review takes no focus on the review, and a next digit sends nothing (R102)', async () => {
    // Premises: the desk; fixture 2 (no envelope, the transcript's copy) up; the answer's `next` is the review (P1).
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockResolvedValueOnce({ ok: true, next: reviewDialog() });
    const { arrive, store } = mount();
    await frame();
    arrive(2);
    expect(store.getState().ask, 'premise: no envelope').toBeNull();
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    const watch = watchCardFocus();
    const at: { node: Element | null } = { node: null };
    await act(async () => { key(first, '1'); at.node = document.activeElement; });
    await frame();
    expect(opt(card(), /^Submit answers/), 'premise: the review is mounted').toBeInTheDocument();
    expectNoRefocus(watch, at.node, 'the aged review');
    answer.mockReturnValue(new Promise(() => {}));
    expect(document.activeElement, 'the aged review: the premise of the digit is body focus, so it lands outside the card').toBe(document.body);
    key(document.activeElement ?? document.body, '1');
    expect(answer, 'a digit on the aged review sends nothing').toHaveBeenCalledTimes(1);
  });

  it('← from an aged review back to its question takes no focus on the question, and a digit sends nothing (R102)', async () => {
    // Premises: the review is up, then the envelope clears (the aged copy of the same ask); ← inside the card moves the
    // pane's tab and `next` is the question with its transcript copy.
    media(true);
    const tab = vi.spyOn(api, 'answerDialogTab').mockResolvedValueOnce({ ok: true, next: askFixture(2).dialog! });
    const { arrive, store } = mount();
    await frame();
    arrive(8);
    act(() => store.getState().apply({ type: 'ask_cleared' }));
    expect(store.getState().ask, 'premise: no envelope').toBeNull();
    const submit = opt(card(), /^Submit answers/);
    act(() => submit.focus());
    const watch = watchCardFocus();
    const at: { node: Element | null } = { node: null };
    await act(async () => { key(submit, 'ArrowLeft'); at.node = document.activeElement; });
    await frame();
    expect(tab).toHaveBeenCalledTimes(1);
    expect(within(card()).getByText(QUESTION), 'premise: the question is back').toBeInTheDocument();
    expectNoRefocus(watch, at.node, 'the aged question');
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    expect(document.activeElement, 'the aged question: the premise of the digit is body focus, so it lands outside the card').toBe(document.body);
    key(document.activeElement ?? document.body, '2');
    expect(answer, 'a digit sends nothing').not.toHaveBeenCalled();
  });

  it('an aged question\'s digit whose answer brings another question, with the focused row gone, takes no focus and a digit sends nothing (R102)', async () => {
    // Premises: fixture 2 up; the operator focuses its THIRD row and answers it; question 2 has two options, so that row's
    // node does not exist on the next screen (review 932's P2 passed only because the first row's node was reused).
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockResolvedValueOnce({ ok: true, next: agedQuestion2() });
    const { arrive } = mount();
    await frame();
    arrive(2);
    const third = opt(card(), /^None/);
    act(() => third.focus());
    const watch = watchCardFocus();
    const at: { node: Element | null } = { node: null };
    await act(async () => { key(third, '3'); at.node = document.activeElement; });
    await frame();
    expect(within(card()).getByText(HOOK_QUESTIONS[1]!.question), 'premise: question 2 is in the card').toBeInTheDocument();
    expect(third.isConnected, 'premise: the focused row\'s node left the DOM').toBe(false);
    // R102: the focus the lost row dropped to the body is not taken back by the next screen.
    expectNoRefocus(watch, at.node, 'aged question 2');
    expect(document.activeElement, 'the focus the lost row dropped is on the body').toBe(document.body);
    answer.mockReturnValue(new Promise(() => {}));
    key(document.activeElement ?? document.body, '2');
    expect(answer, 'a digit sends nothing').toHaveBeenCalledTimes(1);
  });

  it('a clear and a byte-identical envelope in ONE batch, with a screen change, take no focus from the page body', async () => {
    // Premises: the review is engaged by an arrow and focus falls to the body (P4); ONE batch clears the ask, sends the
    // SAME review frames again and moves the pane to question 1. A content hash would call that one ask.
    media(true);
    const { arrive, store } = mount();
    await frame();
    arrive(8);
    const section = card();
    const submit = opt(section, /^Submit answers/);
    act(() => submit.focus());
    key(submit, 'ArrowDown');
    expect(section.contains(document.activeElement), 'premise: the arrow engaged the keyboard inside the card').toBe(true);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() => {
      store.getState().apply({ type: 'ask_cleared' });
      for (const f of askFixture(8).frames) store.getState().apply(f);
      store.getState().apply({ type: 'dialog', dialog: askFixture(1).dialog! });
    });
    await frame();
    expect(card(), 'premise: the same card node carries the new ask').toBe(section);
    expect(within(section).getByText(QUESTION), 'premise: question 1 is up').toBeInTheDocument();
    expect(card().contains(document.activeElement), 'the new ask took focus from the body').toBe(false);
  });

  it('an aged ask answered by a key, then a drop and a reconnect whose first frames are the screen and ask_cleared, takes no focus (R102)', async () => {
    // Premises (R1): fixture 2 (no envelope) engaged by a key, the answer in flight; the socket drops (`onState`'s own
    // writes: the connection has not spoken, the pane's menu is lowered); the new connection speaks with the next question
    // and, as the server's per-connection ask record always makes it for an ask with no envelope, `ask_cleared`: all in one
    // batch. The store held no envelope for that frame to clear, so it is the same ask. R102: the key was an ANSWER this
    // client sent, which released the keyboard at once, so neither the reconnect nor the next question takes focus.
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(2);
    expect(store.getState().ask, 'premise: no envelope is held').toBeNull();
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    const watch = watchCardFocus();
    const at: { node: Element | null } = { node: null };
    key(first, '1');
    at.node = document.activeElement;
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() => store.setState({ conn: 'down', askFrameSeen: false, dialog: null }));
    act(() => store.setState({ conn: 'open' }));
    act(() => {
      store.getState().apply({ type: 'dialog', dialog: agedQuestion2() });
      store.getState().apply({ type: 'ask_cleared' });
    });
    await frame();
    expect(within(card()).getByText(HOOK_QUESTIONS[1]!.question), 'premise: question 2 is in the card').toBeInTheDocument();
    expectNoRefocus(watch, at.node, 'the reconnect');
    expect(document.activeElement, 'the reconnect: the premise of the digit is body focus, so it lands outside the card').toBe(document.body);
    key(document.activeElement ?? document.body, '2');
    expect(answer, 'a digit sends nothing').toHaveBeenCalledTimes(1);
  });

  it('an aged ask\'s menu that vanishes and returns in ONE batch (dialog_cleared, then a screen) is a new ask and takes no focus from the body', async () => {
    // Premises: fixture 2 (no envelope, the transcript's copy) up and engaged by a key; focus falls to the body; ONE batch
    // clears the pane's menu and paints the next aged question. With no hook envelope the pane's menu is all there is of the
    // ask, so a vanished menu is the ask's end and only the generation (`dialog_cleared` counts) can tell it from one ask.
    media(true);
    vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(2);
    expect(store.getState().ask, 'premise: no envelope is held').toBeNull();
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, '1');
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() => {
      store.getState().apply({ type: 'dialog_cleared' });
      store.getState().apply({ type: 'dialog', dialog: agedQuestion2() });
    });
    await frame();
    expect(within(card()).getByText(HOOK_QUESTIONS[1]!.question), 'premise: question 2 is in the card').toBeInTheDocument();
    expect(card().contains(document.activeElement), 'the returned menu took focus from the body').toBe(false);
  });

  it('a hooked ask\'s menu that vanishes for one poll and returns as the next question, after a key answer, takes no focus (R102)', async () => {
    // Premises (R2): fixture 1's envelope up and engaged by a key, the answer in flight; focus falls to the body; a poll
    // sees no menu (`dialog_cleared`, its own batch) and the next poll the next question. The hook's envelope never went, and
    // for a hooked ask the hook is the lifecycle authority, so the pane's blink is not the ask's end. R102: the key was an
    // answer this client sent, which released the keyboard, so the question that returns takes no focus.
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(1);
    const section = card();
    const first = opt(section, /^Redis/);
    act(() => first.focus());
    const watch = watchCardFocus();
    const at: { node: Element | null } = { node: null };
    key(first, '1');
    at.node = document.activeElement;
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() => store.getState().apply({ type: 'dialog_cleared' }));
    await frame();
    expect(store.getState().ask, 'premise: the envelope is still held').not.toBeNull();
    act(() => store.getState().apply({ type: 'dialog', dialog: nextScreen() }));
    await frame();
    expect(card(), 'premise: the same card carries question 2').toBe(section);
    expect(within(section).getByText(QUESTION_2), 'premise: question 2 is in the card').toBeInTheDocument();
    expectNoRefocus(watch, at.node, 'the question after the transient clear');
    expect(document.activeElement, 'the question after the transient clear: the premise of the digit is body focus, so it lands outside the card').toBe(document.body);
    key(document.activeElement ?? document.body, '2');
    expect(answer, 'a digit sends nothing').toHaveBeenCalledTimes(1);
  });

  it('an aged ask\'s same screen sent again after a key answer, then the next question, takes no focus (R102)', async () => {
    // Premises: fixture 2 answered by a key; the SAME dialog frame arrives again (a repeat, no clear); focus falls to the
    // body; the next aged question arrives. A repeated frame is no lifecycle event, and R102's release at the send (not
    // the frame) is what leaves the next question without focus.
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(2);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    const watch = watchCardFocus();
    const at: { node: Element | null } = { node: null };
    key(first, '1');
    at.node = document.activeElement;
    act(() => store.getState().apply({ type: 'dialog', dialog: askFixture(2).dialog! }));
    await frame();
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() => store.getState().apply({ type: 'dialog', dialog: agedQuestion2() }));
    await frame();
    expect(within(card()).getByText(HOOK_QUESTIONS[1]!.question), 'premise: question 2 is in the card').toBeInTheDocument();
    expectNoRefocus(watch, at.node, 'the next aged question');
    expect(document.activeElement, 'the next aged question: the premise of the digit is body focus, so it lands outside the card').toBe(document.body);
    key(document.activeElement ?? document.body, '2');
    expect(answer, 'a digit sends nothing').toHaveBeenCalledTimes(1);
  });

  it('a plain menu replaced by another plain menu takes no focus from the page body: each menu is its own ask', async () => {
    // Premises: fixture 4's menu up and engaged by an arrow; focus falls to the body; ANOTHER plain menu (no ask evidence)
    // replaces it with no clear. The per-screen pane id is that kind of surface's identity, as it always was.
    media(true);
    const { arrive, store } = mount();
    await frame();
    arrive(4);
    const section = card();
    const yes = opt(section, /^Yes, and auto-accept edits/);
    act(() => yes.focus());
    key(yes, 'ArrowDown');
    expect(section.contains(document.activeElement), 'premise: the arrow engaged the keyboard inside the card').toBe(true);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    const other: Dialog = {
      ...askFixture(4).dialog!, id: 'dlg-a4-other', title: 'Run the migration?',
      options: [{ index: 1, label: 'Run it now' }, { index: 2, label: 'Not yet' }],
      raw: ['╭ pane chrome ╮', 'Run the migration?', '  1. Run it now', '  2. Not yet'].join('\n'),
    };
    act(() => store.getState().apply({ type: 'dialog', dialog: other }));
    await frame();
    expect(within(card()).getByText('Run it now'), 'premise: the second menu is up').toBeInTheDocument();
    expect(card().contains(document.activeElement), 'the replacing menu took focus from the body').toBe(false);
  });

  it('the store\'s askEpoch counts the clears that end an ask: an ask_cleared of a held envelope, a dialog_cleared with none held', () => {
    const store = createSessionStore(ID, { makeSocket: fakeSocket });
    const epoch = (): number => store.getState().askEpoch;
    expect(epoch(), 'it starts at 0').toBe(0);
    for (const f of askFixture(1).frames) store.getState().apply(f);
    store.getState().apply({ type: 'dialog', dialog: askFixture(2).dialog! });
    store.getState().apply({ type: 'rotated', uuid: 'u2' });
    expect(epoch(), 'ask, dialog and rotated frames leave it').toBe(0);
    store.getState().apply({ type: 'dialog_cleared' });
    expect(epoch(), 'dialog_cleared with an envelope held leaves it').toBe(0);
    store.getState().apply({ type: 'ask_cleared' });
    expect(epoch(), 'ask_cleared of a held envelope counts one').toBe(1);
    store.getState().apply({ type: 'ask_cleared' });
    expect(epoch(), 'ask_cleared with none held (a connection\'s first frame) leaves it').toBe(1);
    store.getState().apply({ type: 'dialog', dialog: askFixture(2).dialog! });
    store.getState().apply({ type: 'dialog_cleared' });
    expect(epoch(), 'dialog_cleared with no envelope held counts one').toBe(2);
  });
});

// R102 (the operator's ruling after review 944): at the desk, a send THIS client initiates ends the keyboard's engagement at
// that moment, in the same event, and the next screen takes no automatic focus. These are the release's cases; the fence and
// the explicit re-entry (R105, R106) follow in the cases below.
describe('a send this client initiates releases the keyboard (R102)', () => {
  it('an answer whose request never resolves, with the next screen arriving by a socket frame, takes no focus and a digit sends nothing', async () => {
    // Premises: aged fixture 2 (no envelope); a digit answers and its request stays pending; the pane's next question reaches
    // the store as a frame, which clears the in-flight marker (`[dialogId, closed]`) and re-enables the rows. The aged copy's
    // rows are keyed by position, so question 2 REUSES the node that holds focus.
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(2);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    const watch = watchCardFocus();
    const at: { node: Element | null } = { node: null };
    key(first, '1');
    at.node = document.activeElement;
    expect(answer).toHaveBeenCalledTimes(1);
    act(() => store.getState().apply({ type: 'dialog', dialog: agedQuestion2() }));
    await frame();
    expect(within(card()).getByText(HOOK_QUESTIONS[1]!.question), 'premise: question 2 is in the card').toBeInTheDocument();
    expectNoRefocus(watch, at.node, 'the frame-delivered question');
    expect(document.activeElement, 'the frame-delivered question: the premise of the digit is the retained node, which the answer left focused').toBe(at.node);
    key(document.activeElement ?? document.body, '2');
    expect(answer, 'a digit sends nothing').toHaveBeenCalledTimes(1);
  });

  it('a digit refused in the gap (the connection is not live) releases nothing: ArrowDown still moves the highlight', async () => {
    // Premises: fixture 1 up with focus on its first row; the socket drops, so the held surface is read-only and `claim()`
    // refuses every send. A refused claim initiated nothing, so it releases nothing; a later ArrowDown is not fenced.
    // Green before and after R102 (a regression guard against releasing before the refusals).
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    act(() => store.setState({ conn: 'down', askFrameSeen: false, dialog: null }));
    key(first, '2');
    expect(answer, 'the gap refuses the digit').not.toHaveBeenCalled();
    key(first, 'ArrowDown');
    expect(document.activeElement, 'ArrowDown still moves the highlight to the next row').toBe(opt(card(), /^In-process/));
  });

  it('on the phone (coarse pointer, below 900) a key answer still moves focus to the next screen\'s row, as before', async () => {
    // Premises: no desk, no fine pointer: the Sheet. The release is the desk's alone (`useDesk()` at the seam), so the
    // phone's own per-hook engagement keeps carrying focus to the next question. Green before and after R102.
    media(false);
    const answer = vi.spyOn(api, 'answerDialog').mockResolvedValueOnce({ ok: true, next: nextScreen() });
    const { arrive } = mount();
    await frame();
    arrive(1);
    const sheet = dialogs()[0]!;
    const first = opt(sheet, /^Redis/);
    act(() => first.focus());
    await act(async () => { key(first, '1'); });
    await frame();
    expect(answer).toHaveBeenCalledTimes(1);
    expect(within(dialogs()[0]!).getByText(QUESTION_2), 'premise: question 2 is in the Sheet').toBeInTheDocument();
    expect(document.activeElement, 'the next question\'s highlighted row took focus').toBe(opt(dialogs()[0]!, /^Yes/));
  });
});

// R102, R105, R106: after a send this client initiated, no key in the card acts (the FENCE), even on a row node the next
// screen REUSED and re-enabled with focus still on it, until the operator re-enters deliberately: a pointer press in the card,
// or Go to question; Tab moves focus and never unlocks. The act counts only while input is eligible on the screen showing
// (no send in flight, the connection live, the surface not closing), so a click or a Go to question made during the flight
// pre-authorizes nothing: after the reply a NEW one is required. The cases use AGED fixture 2, whose rows are keyed by
// position, so question 2 reuses the node that holds focus (jsdom keeps focus on it with no event, as Chrome can).
describe('the keys in the card are fenced after a send and re-enter only deliberately (R102, R105, R106)', () => {
  const goTo = (): HTMLButtonElement =>
    [...document.querySelectorAll<HTMLButtonElement>('.tool-ask .ask-state button')].find((b) => b.textContent === 'Go to question')!;

  /** Aged fixture 2 up; a digit answers it and the request is PENDING (`reply` resolves it with aged question 2). */
  async function pendingAged() {
    media(true);
    let reply: (v: { ok: true; next: Dialog | null }) => void = () => {};
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValueOnce(new Promise((r) => { reply = r as typeof reply; }));
    const m = mount({ events: [...EVENTS, ASK_CALL] });
    await frame();
    m.arrive(2);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    act(() => { key(first, '1'); });
    expect(answer, 'premise: the digit sent').toHaveBeenCalledTimes(1);
    const deliver = async (): Promise<void> => { await act(async () => { reply({ ok: true, next: agedQuestion2() }); }); };
    return { ...m, answer, first, deliver };
  }

  /** The same, with the reply delivered and a frame passed: the card is fenced, on a reused, re-enabled row. */
  async function answeredAged() {
    const m = await pendingAged();
    await m.deliver();
    await frame();
    expect(within(card()).getByText(HOOK_QUESTIONS[1]!.question), 'premise: question 2 is in the card').toBeInTheDocument();
    expect(m.first.isConnected, 'premise: question 2 REUSED the row node').toBe(true);
    expect(document.activeElement, 'premise: focus stayed on the reused node').toBe(m.first);
    expect(m.first, 'premise: and the node is enabled again').toBeEnabled();
    return m;
  }

  // R115 fences at the reply above too, since question 2 is a new identity. A REFUSED answer leaves the same screen up and
  // unlocked, with no identity change, so there only the release this client's send made stops the next digit (the R102
  // cost: after a refused answer the operator re-enters).
  it('an answer refused on the same screen: a digit on the same row then sends nothing (R102, under R115)', async () => {
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'stale-dialog' }))
      .mockReturnValue(new Promise(() => {}));
    const { arrive } = mount({ events: [...EVENTS, ASK_CALL] });
    await frame();
    arrive(2);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    const w = watchCardFocus();
    await act(async () => { key(first, '1'); });
    await frame();
    expect(answer, 'premise: the digit sent').toHaveBeenCalledTimes(1);
    expect(within(card()).getByText(QUESTION), 'premise: the same question is still up').toBeInTheDocument();
    expect(first.isConnected && document.activeElement === first, 'premise: the same row node holds focus').toBe(true);
    expect(first, 'premise: and it is enabled').toBeEnabled();
    expect(w.seen(), 'premise: no focus was assigned').toEqual([]);
    key(first, '2');
    expect(answer, 'no second request').toHaveBeenCalledTimes(1);
  });

  it('a digit on a reused, re-enabled row node after the reply sends nothing', async () => {
    const m = await answeredAged();
    key(document.activeElement!, '2');
    expect(m.answer, 'no second request').toHaveBeenCalledTimes(1);
  });

  it('a Space toggle on a multiSelect box releases nothing: the keys stay (a guard, green before and after)', async () => {
    // A toggle is a local tick, not a send (`claim()` is never reached), so it must neither release nor fence. The native
    // Space activation is the click jsdom does not synthesize, so the case presses the key and clicks the box.
    media(true);
    const multi = askFixture(9).dialog!;
    const { store } = mount();
    act(() => {
      store.getState().apply({ type: 'dialog', dialog: multi });
      store.getState().apply({ type: 'ask', key: null, ask: { questions: [{
        question: 'Which regions should it deploy to?', header: 'Regions', multiSelect: true,
        options: HOOK_QUESTIONS[2]!.options.map((o) => ({ ...o })),
      }] } });
    });
    const boxes = within(card()).getAllByRole('checkbox');
    expect(boxes, 'premise: three boxes').toHaveLength(3);
    act(() => boxes[0]!.focus());
    key(boxes[0]!, 'ArrowDown'); // engages the keyboard
    act(() => boxes[0]!.focus());
    expect(fireEvent.keyDown(boxes[0]!, { key: ' ' }), 'Space is not prevented: the native toggle stands').toBe(true);
    fireEvent.click(boxes[0]!);
    expect(boxes[0], 'the click ticked it').toHaveAttribute('aria-checked', 'true');
    key(boxes[0]!, 'ArrowDown');
    expect(document.activeElement, 'ArrowDown still moves the highlight after the toggle').toBe(boxes[1]);
    key(boxes[1]!, '3');
    expect(boxes[2], 'and a digit still ticks its box').toHaveAttribute('aria-checked', 'true');
  });

  it('a key in the composer, the page body or the transcript is untouched while fenced (a guard, green before and after)', async () => {
    const m = await answeredAged();
    act(() => composer().focus());
    expect(fireEvent.keyDown(composer(), { key: 'a' }), 'a letter in the composer').toBe(true);
    expect(fireEvent.keyDown(composer(), { key: 'ArrowDown' }), 'ArrowDown in the composer').toBe(true);
    expect(fireEvent.keyUp(composer(), { key: 'Enter' }), 'Enter keyup in the composer').toBe(true);
    expect(fireEvent.keyPress(composer(), { key: ' ', charCode: 32 }), 'Space keypress in the composer').toBe(true);
    expect(fireEvent.keyDown(document.body, { key: '2' }), 'a digit on the page body').toBe(true);
    expect(fireEvent.keyUp(screen.getByText('Running them now.'), { key: ' ' }), 'Space keyup on a transcript row').toBe(true);
    expect(m.answer).toHaveBeenCalledTimes(1);
  });

  describe('R105: re-entry is a pointer press in the card, or Go to question; Tab never unlocks', () => {
    it('a pointer press and click in the card, then a digit, answers once', async () => {
      const m = await answeredAged();
      m.answer.mockReturnValue(new Promise(() => {}));
      const title = card().querySelector('h2')!;
      fireEvent.pointerDown(title);
      act(() => card().focus()); // a press on card text focuses the card section (`tabIndex={-1}`)
      fireEvent.click(title);
      expect(m.answer, 'the press itself sends nothing').toHaveBeenCalledTimes(1);
      key(document.activeElement!, '2');
      expect(m.answer, 'a digit answers').toHaveBeenCalledTimes(2);
      expect(m.answer).toHaveBeenLastCalledWith(ID, 'dlg-a2-q2', 2);
    });

    it('a pointer press on a reused row node itself, then a digit on it, answers once', async () => {
      const m = await answeredAged();
      m.answer.mockReturnValue(new Promise(() => {}));
      fireEvent.pointerDown(m.first);
      key(m.first, '2');
      expect(m.answer).toHaveBeenCalledTimes(2);
    });

    it('Tab moves focus into the card but never unlocks: a digit then sends nothing', async () => {
      const m = await answeredAged();
      // jsdom cannot Tab: the Tab keydown is not prevented (the browser would move focus), and focus is moved as it would.
      expect(fireEvent.keyDown(document.activeElement!, { key: 'Tab' }), 'Tab is not prevented').toBe(true);
      act(() => opt(card(), /^No/).focus());
      expect(card().contains(document.activeElement), 'premise: focus is on another row in the card').toBe(true);
      key(document.activeElement!, '2');
      expect(m.answer, 'a digit sends nothing').toHaveBeenCalledTimes(1);
    });

    it('Go to question with nothing in flight, then a digit, answers once', async () => {
      const m = await answeredAged();
      m.answer.mockReturnValue(new Promise(() => {}));
      fireEvent.click(goTo());
      key(document.activeElement!, '2');
      expect(m.answer, 'a digit answers').toHaveBeenCalledTimes(2);
      expect(m.answer).toHaveBeenLastCalledWith(ID, 'dlg-a2-q2', 2);
    });
  });

  describe('R106: re-entry counts only while input is eligible; nothing pre-authorizes the next screen', () => {
    it('a click on the card while the request is pending, then the reply, then a digit: nothing is sent', async () => {
      const m = await pendingAged();
      const title = card().querySelector('h2')!;
      fireEvent.pointerDown(title);
      act(() => card().focus());
      fireEvent.click(title);
      await m.deliver();
      await frame();
      expect(within(card()).getByText(HOOK_QUESTIONS[1]!.question), 'premise: question 2 is in the card').toBeInTheDocument();
      key(document.activeElement!, '2');
      expect(m.answer, 'nothing sent').toHaveBeenCalledTimes(1);
      // And a NEW press then unlocks.
      m.answer.mockReturnValue(new Promise(() => {}));
      fireEvent.pointerDown(title);
      act(() => card().focus());
      key(document.activeElement!, '2');
      expect(m.answer, 'a new press unlocks').toHaveBeenCalledTimes(2);
    });

    it('a click in the gap (the connection is not live) clears nothing', async () => {
      const m = await answeredAged();
      act(() => m.store.setState({ conn: 'down', askFrameSeen: false, dialog: null }));
      const title = card().querySelector('h2')!;
      fireEvent.pointerDown(title);
      act(() => m.store.setState({ conn: 'open' }));
      act(() => {
        m.store.getState().apply({ type: 'dialog', dialog: agedQuestion2() });
        m.store.getState().apply({ type: 'ask_cleared' });
      });
      await frame();
      key(document.activeElement ?? document.body, '2');
      expect(m.answer, 'a digit sends nothing: the click in the gap cleared nothing').toHaveBeenCalledTimes(1);
    });

    it('Go to question made in the gap (not live, nothing in flight) after a send unlocks nothing; a NEW one after the reconnect does', async () => {
      // A guard, green before and after: the raise's eligibility is captured in render, and `live` is part of it, so a raise made
      // while the connection is down is spent even though no send is in flight, and nothing replays it on the reconnect. The
      // transcript's button is not drawn in the gap (its card follows `askPending`), so the raise is the controller's own prop,
      // the nonce that button bumps, set on a real `DialogSheet`.
      media(true);
      const answer = vi.spyOn(api, 'answerDialog').mockResolvedValueOnce({ ok: true, next: agedQuestion2() });
      const store = createSessionStore(ID, { makeSocket: fakeSocket });
      for (const f of askFixture(2).frames) store.getState().apply(f);
      const view = render(<DialogSheet id={ID} store={store} raise={0} />);
      const first = opt(card(), /^Redis/);
      act(() => first.focus());
      await act(async () => { key(first, '1'); });
      await frame();
      expect(within(card()).getByText(HOOK_QUESTIONS[1]!.question), 'premise: question 2 is in the card').toBeInTheDocument();
      expect(document.activeElement, 'premise: focus stayed on the reused node').toBe(first);
      act(() => store.setState({ conn: 'down', askFrameSeen: false, dialog: null }));
      view.rerender(<DialogSheet id={ID} store={store} raise={1} />); // Go to question, made in the gap
      act(() => store.setState({ conn: 'open' }));
      act(() => {
        store.getState().apply({ type: 'dialog', dialog: agedQuestion2() });
        store.getState().apply({ type: 'ask_cleared' });
      });
      await frame();
      expect(within(card()).getByText(HOOK_QUESTIONS[1]!.question), 'premise: the card is back, live').toBeInTheDocument();
      key(document.activeElement!, '2');
      expect(answer, 'a digit sends nothing: the raise made in the gap unlocked nothing').toHaveBeenCalledTimes(1);
      answer.mockReturnValue(new Promise(() => {}));
      view.rerender(<DialogSheet id={ID} store={store} raise={2} />); // a NEW one, after the reconnect
      expect(card().contains(document.activeElement), 'the new Go to question focused the card').toBe(true);
      key(document.activeElement!, '2');
      expect(answer, 'and a digit then answers once').toHaveBeenCalledTimes(2);
    });

    // The coordinator's addition to R106: Go to question clicked while the answer is in flight, with the reply delivered as
    // tightly after the click as the harness honestly allows. Every timing must give the same public result: the section is
    // focused by the click (R69 F7), the keys stay fenced after the reply, no unlock follows, and a NEW eligible Go to
    // question then unlocks.
    it.each([
      ['in the same task right after the click', async (deliver: () => Promise<void>): Promise<void> => { await deliver(); }],
      ['on the next microtask', async (deliver: () => Promise<void>): Promise<void> => {
        await Promise.resolve();
        await deliver();
      }],
      ['after one frame', async (deliver: () => Promise<void>): Promise<void> => {
        await frame();
        await deliver();
      }],
    ])('Go to question while the answer is in flight, the reply %s: still fenced, and a NEW Go to question unlocks', async (_when, run) => {
      const m = await pendingAged();
      const watch = watchCardFocus();
      fireEvent.click(goTo());
      expect(document.activeElement, 'the click focused the card section (R69 F7)').toBe(card());
      watch.seen().length = 0; // the section's own focus is the click's; only focus AFTER the reply would be an unlock's
      await run(m.deliver);
      await frame();
      expect(within(card()).getByText(HOOK_QUESTIONS[1]!.question), 'premise: question 2 is in the card').toBeInTheDocument();
      expect(watch.seen(), 'no focusin from an unlock after the reply').toEqual([]);
      key(document.activeElement ?? document.body, '2');
      expect(m.answer, 'a digit sends nothing').toHaveBeenCalledTimes(1);
      m.answer.mockReturnValue(new Promise(() => {}));
      fireEvent.click(goTo());
      expect(card().contains(document.activeElement), 'the NEW Go to question focused the card').toBe(true);
      key(document.activeElement!, '2');
      expect(m.answer, 'and a digit then answers once').toHaveBeenCalledTimes(2);
      expect(m.answer).toHaveBeenLastCalledWith(ID, 'dlg-a2-q2', 2);
    });
  });
});

// R102: no automatic focus in the card. `OwnWords` once focused its field on ANY false -> true change of `chosen`, which a
// return to a question whose Other was kept (a sent ←, or a screen an outside move brought back) also makes. INLINE the
// field now takes focus only on a deliberate open (`words.onOpen`: a click on the row, or its handled digit); the Sheet
// keeps today's rule exactly.
describe('the own-words field takes focus only on a deliberate open inside the card (R102)', () => {
  /** Other chosen on question 1 by a click, its text typed and kept, focus then put on the body, and the pane moved to
   *  question 2. `scope()` is the container under test (the card, or the phone's dialog). */
  async function keptOtherAwayFromQuestion1(scope: () => HTMLElement) {
    const m = mount();
    await frame();
    m.arrive(1);
    fireEvent.click(opt(scope(), /^Other/));
    const field = (): HTMLInputElement => within(scope()).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(field(), { target: { value: 'Memcached' } });
    act(() => field().blur());
    act(() => m.store.getState().apply({ type: 'dialog', dialog: nextScreen() }));
    await frame();
    expect(within(scope()).getByText(QUESTION_2), 'premise: question 2 is up').toBeInTheDocument();
    return { ...m, field };
  }

  it('inline: a return to question 1 with Other and its text kept, by a frame, fires no focusin and leaves the field unfocused', async () => {
    media(true);
    const m = await keptOtherAwayFromQuestion1(card);
    const watch = watchCardFocus();
    act(() => m.store.getState().apply({ type: 'dialog', dialog: askFixture(1).dialog! }));
    await frame();
    expect(within(card()).getByText(QUESTION), 'premise: question 1 is back').toBeInTheDocument();
    expect(m.field(), 'premise: the field is open with its kept text').toHaveValue('Memcached');
    expect(watch.seen(), 'no focusin inside the card').toEqual([]);
    expect(document.activeElement, 'the field is not focused').not.toBe(m.field());
  });

  it('inline guard: choosing Other by a click focuses the field (green before and after)', async () => {
    media(true);
    const { arrive } = mount();
    await frame();
    arrive(1);
    fireEvent.click(opt(card(), /^Other/));
    expect(document.activeElement).toBe(within(card()).getByRole('textbox'));
  });

  it('inline guard: choosing Other by its digit with the card engaged focuses the field (green before and after)', async () => {
    media(true);
    const { arrive } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, 'ArrowDown'); // engages the keyboard inside the card
    key(document.activeElement!, '4');
    expect(document.activeElement).toBe(within(card()).getByRole('textbox'));
  });

  it('phone guard: the same return to a kept Other DOES focus the field, as today (green before and after)', async () => {
    media(false);
    const m = await keptOtherAwayFromQuestion1(() => dialogs()[0]!);
    act(() => m.store.getState().apply({ type: 'dialog', dialog: askFixture(1).dialog! }));
    await frame();
    expect(within(dialogs()[0]!).getByText(QUESTION), 'premise: question 1 is back').toBeInTheDocument();
    expect(document.activeElement, 'the Sheet\'s field takes focus on the return').toBe(m.field());
  });

  it('the desk, then a crossing below 900, then a return: the field is focused under the sheet rule (green before and after)', async () => {
    let desk = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (q: string) => ({
      get matches(): boolean { return q.includes('min-width: 900px') ? desk : q.includes('pointer: fine') ? desk : false; },
      media: q, onchange: null,
      addEventListener(_t: string, l: () => void) { listeners.add(l); },
      removeEventListener(_t: string, l: () => void) { listeners.delete(l); },
      addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }));
    const m = await keptOtherAwayFromQuestion1(card);
    desk = false;
    act(() => { for (const l of [...listeners]) l(); });
    expect(cards(), 'premise: the card is gone below 900').toHaveLength(0);
    const field = (): HTMLInputElement => within(dialogs()[0]!).getByRole('textbox') as HTMLInputElement;
    act(() => field().blur());
    act(() => m.store.getState().apply({ type: 'dialog', dialog: askFixture(1).dialog! }));
    await frame();
    expect(within(dialogs()[0]!).getByText(QUESTION), 'premise: question 1 is back in the Sheet').toBeInTheDocument();
    expect(document.activeElement, 'the Sheet\'s rule focuses the field').toBe(field());
  });
});

// R102: "no automatic focus in the card" holds only while no code in the ask files assigns focus except the sites that were
// reviewed. This is the census of those sites, a text scan with comments removed: a new `.focus(` (or an `autoFocus`) in any of
// the five files is red until it is reviewed against the release and the fence and added here.
describe('every focus mover in the ask files is a reviewed one (R102)', () => {
  const SESSION_DIR = path.join(import.meta.dirname, '..', 'src', 'session');
  const stripped = (file: string): string =>
    readFileSync(path.join(SESSION_DIR, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const movers = (file: string): string[] => [...stripped(file).matchAll(/([\w.?()]*)\.focus\(/g)].map((m) => `${m[1]}.focus(`);

  it.each([
    // `focusRow` (a handled key) and the screen-change effect (its timer re-reads `engaged()`, false after the release).
    ['useAskKeys.ts', ['els.current.get(key)?.focus(', 'els.current.get(key)?.focus(']],
    // The own-words effect (a deliberate open inline, a `chosen` change in the Sheet) and the row's click.
    ['AskParts.tsx', ['field.current?.focus(', 'field.current?.focus(']],
    // The raise (Go to question, deliberate by the operator).
    ['AskSurface.tsx', ['first.focus(']],
    ['DialogSheet.tsx', []],
    ['EnvelopeSheet.tsx', []],
  ] as const)('%s: the focus call sites are exactly the reviewed ones', (file, expected) => {
    expect(movers(file)).toEqual(expected);
    expect(stripped(file), `${file}: no autoFocus`).not.toMatch(/autoFocus/);
  });
});

// R102: the fence is the desk's alone. It is raised only by a release at the desk (`useDesk()` at the seam) and stops only keys
// whose target is inside the inline card, which the phone's Sheet never carries; so a crossing in either direction carries
// nothing across. Both cases are guards, green before and after.
describe('a crossing between the phone and the desk carries no fence (R102)', () => {
  /** A matchMedia that follows `desk` (width and fine pointer together) and tells its listeners when it flips. */
  function crossing() {
    const state = { desk: false };
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (q: string) => ({
      get matches(): boolean { return q.includes('min-width: 900px') || q.includes('pointer: fine') ? state.desk : false; },
      media: q, onchange: null,
      addEventListener(_t: string, l: () => void) { listeners.add(l); },
      removeEventListener(_t: string, l: () => void) { listeners.delete(l); },
      addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }));
    return { cross: (desk: boolean): void => { state.desk = desk; act(() => { for (const l of [...listeners]) l(); }); } };
  }

  it('(a) a phone key answer, then a crossing to the desk: a card row focused by script answers once on a digit', async () => {
    const w = crossing();
    const answer = vi.spyOn(api, 'answerDialog').mockResolvedValueOnce({ ok: true, next: nextScreen() });
    const { arrive } = mount();
    await frame();
    arrive(1);
    const first = opt(dialogs()[0]!, /^Redis/);
    act(() => first.focus());
    await act(async () => { key(first, '1'); });
    await frame();
    expect(answer, 'premise: the phone answer was sent').toHaveBeenCalledTimes(1);
    answer.mockReturnValue(new Promise(() => {}));
    w.cross(true);
    expect(within(card()).getByText(QUESTION_2), 'premise: question 2 is in the card').toBeInTheDocument();
    const row = opt(card(), /^Yes/);
    act(() => row.focus());
    expect(fireEvent.keyDown(row, { key: '2' }), 'the digit keydown is prevented (handled or fenced: the request count below tells which)').toBe(false);
    expect(answer, 'a digit answers once').toHaveBeenCalledTimes(2);
    expect(answer).toHaveBeenLastCalledWith(ID, 'dlg-a2', 2);
  });

  it('(b) a desk key answer, then a crossing below 900: a digit in the Sheet answers', async () => {
    const w = crossing();
    w.cross(true);
    const answer = vi.spyOn(api, 'answerDialog').mockResolvedValueOnce({ ok: true, next: nextScreen() });
    const { arrive } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    await act(async () => { key(first, '1'); });
    await frame();
    expect(answer, 'premise: the desk answer was sent').toHaveBeenCalledTimes(1);
    answer.mockReturnValue(new Promise(() => {}));
    w.cross(false);
    expect(cards(), 'premise: no card below 900').toHaveLength(0);
    const row = opt(dialogs()[0]!, /^Yes/);
    act(() => row.focus());
    expect(fireEvent.keyDown(row, { key: '2' }), 'the digit keydown is prevented (handled or fenced: the request count below tells which)').toBe(false);
    expect(answer, 'a digit answers').toHaveBeenCalledTimes(2);
    expect(answer).toHaveBeenLastCalledWith(ID, 'dlg-a2', 2);
  });

  it('(c) an ARROW-engaged keyboard, a crossing below 900 and back: the card carries no fence, Tab in and a digit answers (R115)', async () => {
    // R115 joins the screen to the desk identity only, so a crossing changes the identity string; a change that leaves no
    // inline card showing raises no fence, and the keyboard's engagement simply ends there.
    const w = crossing();
    w.cross(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive } = mount();
    await frame();
    arrive(2);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, 'ArrowDown'); // engaged
    w.cross(false);
    expect(cards(), 'premise: no card below 900').toHaveLength(0);
    w.cross(true);
    const row = opt(card(), /^Redis/);
    act(() => row.focus()); // as Tab would
    key(row, '1');
    expect(answer, 'a digit answers once').toHaveBeenCalledTimes(1);
  });
});

// R102, R106 (review A1): the raise's eligibility is read in render, and `locked` (render state) can already read false while
// the send is still marked `sending` (the ref `claim` sets and the next render's layout effect clears). A send whose own
// continuation clears its busy flag (here Deny: `setDenying(false)` in its `finally`, touching no store) and a raise can render
// in ONE batch when both are default-lane updates, and the raise then reads `locked` false with the send still marked sending.
// A CONSTRUCTED ordering, labelled as such: the production raise is a click, a discrete (sync-lane) event that renders before a
// default-lane continuation can join it (an `act` that clicks and resolves the reply was tried: the click renders alone, with
// the flag still set). Here a real `createRoot` renders the raise as a default-lane root update right after the continuation
// has queued `setDenying(false)`, so the two render together. The case pins the conservative direction: a raise that shares
// its render with a send's completion unlocks nothing, observed as the fence still stopping a key. Public React and DOM APIs only; the flag is restored in a `finally`.
describe('a raise rendered in one batch with a Deny\'s completion unlocks nothing (R106 A1)', () => {
  it('the fence the Deny raised still stops a key in the card afterwards', async () => {
    media(true);
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const before = env.IS_REACT_ACT_ENVIRONMENT;
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    let reply: () => void = () => {};
    const interrupt = vi.spyOn(api, 'interrupt').mockReturnValueOnce(new Promise<void>((r) => { reply = r; }));
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const store = createSessionStore(ID, { makeSocket: fakeSocket });
    for (const f of askFixture(7).frames) store.getState().apply(f);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    // An approval has no keyed rows, so the fence is observed directly: a keydown inside the card that nothing else handles
    // comes back prevented while the fence stands (the dispatch returns false), and unprevented once it is lifted.
    const free = (k: string): boolean =>
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    const show = (raise: number): void => root.render(<DialogSheet id={ID} store={store} raise={raise} />);
    try {
      env.IS_REACT_ACT_ENVIRONMENT = false;
      show(0);
      await sleep(150);
      within(host).getByRole('button', { name: /^Deny/ }).click(); // Deny: held pending
      await sleep(100);
      expect(interrupt, 'premise: the Deny was sent and is pending').toHaveBeenCalledTimes(1);
      // The reply: the `finally`'s `setDenying(false)` runs in these microtasks and queues a default-lane update; the raise
      // is then rendered as a root update of the same lane, before the scheduler renders either.
      reply();
      for (let i = 0; i < 12; i++) await Promise.resolve();
      show(1);
      await sleep(400);
      expect(host.contains(document.activeElement) && document.activeElement !== host, 'premise: the raise focused inside the card').toBe(true);
      expect(free('x'), 'the keydown is stopped: the raise unlocked nothing').toBe(false);
      expect(answer).not.toHaveBeenCalled();
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = before;
      root.unmount();
      host.remove();
    }
  });
});

// R115 (the operator's choice, amending R64 for these changes): at the DESK, a screen change this client did not send (a
// socket frame: another client, the terminal, the session moving on, or a redraw under a new aged dialog id) ENDS the
// keyboard's engagement and FENCES the card when the keyboard was engaged or focus was inside the card. Nothing moves
// focus into the new screen, no key on its rows sends (a row node the new screen reused and left focused included), Tab
// still moves focus without unlocking, and only a NEW eligible pointer press in the card or Go to question re-enters. This
// replaces the retained R99 path, where an arrow-engaged keyboard continued into the new screen. The phone's Sheet is
// unchanged. Not covered, and not claimed: an externally driven BYTE-IDENTICAL replacement, which changes no identity this
// client can see, and a request already issued, which no client fence can revoke.
describe('a screen change this client did not send fences the card at the desk; only a new eligible act re-enters (R115)', () => {
  const reviewD = (): Dialog => askFixture(8).dialog!;
  const goTo = (): HTMLButtonElement =>
    [...document.querySelectorAll<HTMLButtonElement>('.tool-ask .ask-state button')].find((b) => b.textContent === 'Go to question')!;

  /** The new screen took no focus, its highlighted row (`row`), focused as Tab would, sends nothing on a digit, Enter or
   *  Space, and a pointer press on it then lets a digit answer once. `answer` is the spied `api.answerDialog`. */
  function expectFencedThenPress(w: { seen: () => string[] }, answer: ReturnType<typeof vi.spyOn>, row: HTMLElement): void {
    expect(w.seen(), 'nothing moved focus into the new screen').toEqual([]);
    expect(document.activeElement, 'focus stays on the page body, where the engaged row\'s removal left it').toBe(document.body);
    act(() => row.focus()); // as Tab would: the fence lets focus move and unlocks nothing
    key(row, '1');
    expect(fireEvent.keyDown(row, { key: 'Enter' }), 'Enter is stopped by the fence').toBe(false);
    expect(fireEvent.keyDown(row, { key: ' ' }), 'Space is stopped by the fence').toBe(false);
    expect(fireEvent.keyUp(row, { key: ' ' }), 'Space\'s keyup too').toBe(false);
    expect(answer, 'no key sent anything').not.toHaveBeenCalled();
    fireEvent.pointerDown(row);
    key(row, '1');
    expect(answer, 'after a pointer press a digit answers once').toHaveBeenCalledTimes(1);
  }

  it.each([
    ['question to question', (): Dialog => nextScreen(), /^Yes/],
    ['question to the review', reviewD, /^Submit answers/],
  ] as const)('hooked ask, %s: the new screen takes no focus and its keys are fenced', async (_what, next, row) => {
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, 'ArrowDown'); // engages, sends nothing; focus is on the second row
    const moved = document.activeElement as HTMLElement;
    expect(card().contains(moved) && moved !== first, 'premise: the arrow moved focus to another row').toBe(true);
    const w = watchCardFocus();
    act(() => store.getState().apply({ type: 'dialog', dialog: next() }));
    await frame();
    expect(moved.isConnected, 'premise: the engaged row left the DOM with its screen').toBe(false);
    expectFencedThenPress(w, answer, opt(card(), row));
  });

  it('hooked ask, the review to a question: the question takes no focus and its keys are fenced', async () => {
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(8);
    const submit = opt(card(), /^Submit answers/);
    act(() => submit.focus());
    key(submit, 'ArrowDown');
    const moved = document.activeElement as HTMLElement;
    expect(card().contains(moved) && moved !== submit, 'premise: the arrow moved focus to the Cancel row').toBe(true);
    const w = watchCardFocus();
    act(() => store.getState().apply({ type: 'dialog', dialog: askFixture(1).dialog! }));
    await frame();
    expect(within(card()).getByText(QUESTION), 'premise: question 1 is up').toBeInTheDocument();
    expect(moved.isConnected, 'premise: the engaged row left the DOM').toBe(false);
    expectFencedThenPress(w, answer, opt(card(), /^Redis/));
  });

  it('aged ask, a question whose third row is gone on the next question: the next question takes no focus and its keys are fenced', async () => {
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(2);
    expect(store.getState().ask, 'premise: no envelope').toBeNull();
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, 'ArrowDown');
    key(document.activeElement!, 'ArrowDown');
    const third = opt(card(), /^None/);
    expect(document.activeElement, 'premise: the arrows moved focus to the third row').toBe(third);
    const w = watchCardFocus();
    act(() => store.getState().apply({ type: 'dialog', dialog: agedQuestion2() }));
    await frame();
    expect(third.isConnected, 'premise: the third row\'s node left the DOM').toBe(false);
    expectFencedThenPress(w, answer, opt(card(), /^Yes/));
  });

  it('aged ask, a question to the review: the review takes no focus and its keys are fenced', async () => {
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(2);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, 'ArrowDown');
    key(document.activeElement!, 'ArrowDown');
    const third = opt(card(), /^None/);
    expect(document.activeElement, 'premise: the arrows moved focus to the third row').toBe(third);
    const w = watchCardFocus();
    act(() => store.getState().apply({ type: 'dialog', dialog: reviewD() }));
    await frame();
    expect(third.isConnected, 'premise: the third row\'s node left the DOM').toBe(false);
    expectFencedThenPress(w, answer, opt(card(), /^Submit answers/));
  });

  it('aged ask, the review to its question: the question takes no focus and its keys are fenced', async () => {
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(8);
    act(() => store.getState().apply({ type: 'ask_cleared' })); // the aged copy of the same ask
    expect(store.getState().ask, 'premise: no envelope').toBeNull();
    const submit = opt(card(), /^Submit answers/);
    act(() => submit.focus());
    key(submit, 'ArrowDown');
    const moved = document.activeElement as HTMLElement;
    expect(card().contains(moved) && moved !== submit, 'premise: the arrow moved focus to the Cancel row').toBe(true);
    const w = watchCardFocus();
    act(() => store.getState().apply({ type: 'dialog', dialog: askFixture(2).dialog! }));
    await frame();
    expect(within(card()).getByText(QUESTION), 'premise: the question is up').toBeInTheDocument();
    expect(moved.isConnected, 'premise: the engaged row left the DOM').toBe(false);
    expectFencedThenPress(w, answer, opt(card(), /^Redis/));
  });

  // F3 of review 939, the external path: a DIFFERENT aged ask (another question, other options, another pane dialog id)
  // replaces the first with no clear observed between them. Aged rows are keyed by position, so the row that holds focus is
  // REUSED by the second ask, still focused, with no focus event at all.
  /** Aged fixture 2 up, `prep` puts focus in the card; then a frame brings a DIFFERENT aged ask, with no clear. */
  async function otherAskOver(prep: (first: HTMLElement) => void) {
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount({ events: [...EVENTS, ASK_CALL] });
    await frame();
    arrive(2);
    const first = opt(card(), /^Redis/);
    prep(first);
    const held = document.activeElement as HTMLElement;
    expect(card().contains(held), 'premise: focus is on a row in the card').toBe(true);
    const w = watchCardFocus();
    act(() => store.getState().apply({ type: 'dialog', dialog: otherAgedAsk() }));
    await frame();
    expect(within(card()).getByText(OTHER_QUESTION), 'premise: the other ask is in the card').toBeInTheDocument();
    expect(store.getState().askEpoch, 'premise: no clear was observed').toBe(0);
    expect(held.isConnected, 'premise: the other ask REUSED the focused row node').toBe(true);
    expect(held, 'premise: and the node is enabled').toBeEnabled();
    expect(w.seen(), 'nothing moved focus into the new screen').toEqual([]);
    expect(document.activeElement, 'focus is still on the reused node, where it was').toBe(held);
    return { answer, held, w, store };
  }

  it('an arrow-engaged keyboard on a reused row: a digit, Enter and Space send nothing, nothing moves focus, a press re-enters', async () => {
    const m = await otherAskOver((first) => {
      act(() => first.focus());
      key(first, 'ArrowDown'); // engages; focus moves to the second row
    });
    key(m.held, '1');
    expect(fireEvent.keyDown(m.held, { key: 'Enter' }), 'Enter is stopped by the fence').toBe(false);
    expect(fireEvent.keyDown(m.held, { key: ' ' }), 'Space is stopped by the fence').toBe(false);
    expect(fireEvent.keyUp(m.held, { key: ' ' }), 'Space\'s keyup too').toBe(false);
    key(m.held, 'ArrowDown');
    expect(document.activeElement, 'an arrow moves nothing either').toBe(m.held);
    expect(m.w.seen(), 'no focus was assigned inside the card').toEqual([]);
    expect(m.answer, 'nothing was sent to the other ask').not.toHaveBeenCalled();
    fireEvent.pointerDown(m.held);
    key(m.held, '1');
    expect(m.answer, 'after a pointer press a digit answers the other ask once').toHaveBeenCalledTimes(1);
    expect(m.answer).toHaveBeenLastCalledWith(ID, 'dlg-other-ask', 1);
  });

  it('focus on a row with NO key pressed (Tab or a script put it there) is fenced too: a digit sends nothing', async () => {
    const m = await otherAskOver((first) => act(() => first.focus()));
    key(m.held, '1');
    expect(fireEvent.keyDown(m.held, { key: 'Enter' }), 'Enter is stopped by the fence').toBe(false);
    expect(m.answer, 'nothing was sent to the other ask').not.toHaveBeenCalled();
  });

  it('Tab after the change moves focus and unlocks nothing; Go to question then re-enters and a digit answers once', async () => {
    const m = await otherAskOver((first) => {
      act(() => first.focus());
      key(first, 'ArrowDown');
    });
    expect(fireEvent.keyDown(m.held, { key: 'Tab' }), 'Tab is not prevented').toBe(true);
    act(() => opt(card(), /^Postgres/).focus());
    key(document.activeElement!, '2');
    expect(m.answer, 'a digit after Tab sends nothing').not.toHaveBeenCalled();
    fireEvent.click(goTo());
    key(document.activeElement!, '2');
    expect(m.answer, 'after Go to question a digit answers once').toHaveBeenCalledTimes(1);
    expect(m.answer).toHaveBeenLastCalledWith(ID, 'dlg-other-ask', 2);
  });

  it('with focus outside the card and no key pressed in it, the change fences nothing: Tab in, then a digit, answers', async () => {
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(2);
    act(() => composer().focus());
    act(() => store.getState().apply({ type: 'dialog', dialog: otherAgedAsk() }));
    await frame();
    expect(document.activeElement, 'premise: focus stayed in the composer').toBe(composer());
    const row = opt(card(), /^Postgres/);
    act(() => row.focus());
    key(row, '1');
    expect(answer, 'an operator who was not in the card is not fenced').toHaveBeenCalledTimes(1);
  });

  it('an ask that ENDS while the keyboard is engaged leaves no fence for the next one: Tab into it, then a digit, answers', async () => {
    // The fence protects keys on a screen that is showing; a clear shows none. The next ask arrives with focus outside it.
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(2);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, 'ArrowDown'); // engaged
    act(() => store.getState().apply({ type: 'dialog_cleared' }));
    await frame();
    expect(cards(), 'premise: the ask ended and its card left').toHaveLength(0);
    act(() => store.getState().apply({ type: 'dialog', dialog: otherAgedAsk() }));
    await frame();
    expect(card().contains(document.activeElement), 'premise: the new ask took no focus').toBe(false);
    const row = opt(card(), /^Postgres/);
    act(() => row.focus()); // as Tab would
    key(row, '1');
    expect(answer, 'the new ask answers: nothing was fenced for it').toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenLastCalledWith(ID, 'dlg-other-ask', 1);
  });

  it('a hooked ask whose pane menu vanishes for one poll fences an engaged keyboard (the accepted cost, pinned)', async () => {
    // R115 joins the screen to the desk identity, and a hooked screen the pane does not show (no menu) is no screen, so the
    // flap is a change: an arrow-engaged keyboard is released and fenced, and a click re-enters. Not a residual: the safe side.
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, 'ArrowDown');
    act(() => store.getState().apply({ type: 'dialog_cleared' }));
    act(() => store.getState().apply({ type: 'dialog', dialog: askFixture(1).dialog! }));
    await frame();
    expect(within(card()).getByText(QUESTION), 'premise: question 1 is up again').toBeInTheDocument();
    const row = opt(card(), /^Redis/);
    act(() => row.focus());
    key(row, '1');
    expect(answer, 'fenced: a digit sends nothing').not.toHaveBeenCalled();
    fireEvent.pointerDown(row);
    key(row, '1');
    expect(answer, 'after a pointer press a digit answers once').toHaveBeenCalledTimes(1);
  });

  it('the phone keeps its Sheet\'s behaviour: the same change leaves the reused row\'s keys live (a guard, green before and after)', async () => {
    media(false);
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(2);
    expect(dialogs(), 'premise: the phone shows the Sheet').toHaveLength(1);
    const first = within(dialogs()[0]!).getByRole('button', { name: /^Redis/ });
    act(() => first.focus());
    key(first, 'ArrowDown');
    const held = document.activeElement as HTMLElement;
    act(() => store.getState().apply({ type: 'dialog', dialog: otherAgedAsk() }));
    await frame();
    expect(within(dialogs()[0]!).getByText(OTHER_QUESTION), 'premise: the other ask is in the Sheet').toBeInTheDocument();
    expect(held.isConnected, 'premise: the Sheet reused the row node that held focus').toBe(true);
    expect(dialogs()[0]!.contains(document.activeElement), 'focus is on a row in the Sheet').toBe(true);
    key(document.activeElement!, '1');
    expect(answer, 'on the phone a digit answers, as it always has').toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenLastCalledWith(ID, 'dlg-other-ask', 1);
  });
});

// R102: a LATER send's release wins over an EARLIER raise. A CONSTRUCTED ordering that the production click path is not known
// to reach: Go to question is a click, a discrete event, and a discrete render's passive effects flush at the end of its commit,
// so no send can be claimed between that raise's render and its effect. Here the raise is rendered outside `act` (a default-lane
// render, whose passive effect React defers to the scheduler) while eligible, and a sibling's layout effect, which runs in
// that same commit, dispatches a native digit keydown: the send is claimed after the raise's render and before its effect.
// The effect then runs against a fence the release just raised, and must not lower it. Only public React and DOM APIs: a real
// `createRoot`, a plain `dispatchEvent`, real timers; `IS_REACT_ACT_ENVIRONMENT` is restored in a `finally`.
describe('a send claimed after an eligible raise renders and before its effect runs still releases (R102)', () => {
  it('the second digit sends nothing: the later release won', async () => {
    media(true);
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const before = env.IS_REACT_ACT_ENVIRONMENT;
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    const answer = vi.spyOn(api, 'answerDialog').mockResolvedValueOnce({ ok: true, next: agedQuestion2() })
      .mockReturnValue(new Promise(() => {}));
    const store = createSessionStore(ID, { makeSocket: fakeSocket });
    for (const f of askFixture(2).frames) store.getState().apply(f);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const press = (k: string): void => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    };
    // The sibling: its layout effect runs in the raise's commit, after the sheet's own, and before any passive effect.
    function Presser({ n }: { n: number }): null {
      useLayoutEffect(() => { if (n !== 0) press('1'); }, [n]);
      return null;
    }
    const show = (raise: number): void => root.render(<><DialogSheet id={ID} store={store} raise={raise} /><Presser n={raise} /></>);
    try {
      env.IS_REACT_ACT_ENVIRONMENT = false;
      show(0);
      await sleep(150);
      const first = within(host).getByRole('button', { name: /^Redis/ });
      first.focus();
      show(1); // an ELIGIBLE raise; its layout-phase sibling then claims a send
      await sleep(400);
      expect(answer, 'premise: the digit sent once').toHaveBeenCalledTimes(1);
      expect(within(host).getByText(HOOK_QUESTIONS[1]!.question), 'premise: the reply brought question 2').toBeInTheDocument();
      expect(document.activeElement, 'premise: question 2 reused the focused row node').toBe(first);
      press('2');
      await sleep(150);
      expect(answer, 'the second digit sends nothing: the release stood').toHaveBeenCalledTimes(1);
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = before;
      root.unmount();
      host.remove();
    }
  });

  // R115 masks the case above: its reply brings question 2, a new identity, so the fence rises at the reply whatever the
  // raise did. Here the answer is REFUSED: the same screen stays up, unlocked, with no identity change, so only the release,
  // and its winning over the earlier raise, can stop the second digit.
  it('the same with the answer refused on the same screen: the second digit sends nothing (R102, under R115)', async () => {
    media(true);
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const before = env.IS_REACT_ACT_ENVIRONMENT;
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    const answer = vi.spyOn(api, 'answerDialog').mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'stale-dialog' }))
      .mockReturnValue(new Promise(() => {}));
    const store = createSessionStore(ID, { makeSocket: fakeSocket });
    for (const f of askFixture(2).frames) store.getState().apply(f);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const press = (k: string): void => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    };
    // The sibling: its layout effect runs in the raise's commit, after the sheet's own, and before any passive effect.
    function Presser({ n }: { n: number }): null {
      useLayoutEffect(() => { if (n !== 0) press('1'); }, [n]);
      return null;
    }
    const show = (raise: number): void => root.render(<><DialogSheet id={ID} store={store} raise={raise} /><Presser n={raise} /></>);
    try {
      env.IS_REACT_ACT_ENVIRONMENT = false;
      show(0);
      await sleep(150);
      const first = within(host).getByRole('button', { name: /^Redis/ });
      first.focus();
      show(1); // an ELIGIBLE raise; its layout-phase sibling then claims a send
      await sleep(400);
      expect(answer, 'premise: the digit sent once').toHaveBeenCalledTimes(1);
      expect(within(host).getByText(QUESTION), 'premise: the same question is still up').toBeInTheDocument();
      expect(document.activeElement, 'premise: the same row node holds focus').toBe(first);
      expect(first, 'premise: and it is enabled').toBeEnabled();
      press('2');
      await sleep(150);
      expect(answer, 'the second digit sends nothing: the release stood').toHaveBeenCalledTimes(1);
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = before;
      root.unmount();
      host.remove();
    }
  });
});

// R64 (review of Task A): the phone's per-hook `engaged` is the phone's alone. `DialogSheet`'s own hook outlives a crossing
// below 900 and an ask's end, so an INLINE key must leave it untouched, or a later review in the sheet is focused.
describe('the phone path is its own after an inline engagement (R64)', () => {
  it('a key in the inline review at a coarse pointer, the ask ending and a crossing below 900 leave the next review in the Sheet unfocused', async () => {
    // Premises: the desk width with a COARSE pointer; an arrow in the inline review engages the keyboard; that ask clears;
    // the window crosses below 900; the next review opens in the Sheet. The phone rule (coarse pointer, no key handled in
    // THE SHEET) moves no focus onto a row, as it never did before the inline card.
    let desk = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (q: string) => ({
      get matches(): boolean { return q.includes('min-width: 900px') ? desk : false; },
      media: q, onchange: null,
      addEventListener(_t: string, l: () => void) { listeners.add(l); },
      removeEventListener(_t: string, l: () => void) { listeners.delete(l); },
      addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }));
    const { arrive, store } = mount();
    await frame();
    arrive(8);
    const submit = opt(card(), /^Submit answers/);
    act(() => submit.focus());
    key(submit, 'ArrowDown');
    expect(card().contains(document.activeElement), 'premise: the arrow engaged the keyboard inside the card').toBe(true);
    act(() => {
      store.getState().apply({ type: 'ask_cleared' });
      store.getState().apply({ type: 'dialog_cleared' });
    });
    await frame();
    expect(cards(), 'premise: the card left with its ask').toHaveLength(0);
    desk = false;
    act(() => { for (const l of [...listeners]) l(); });
    arrive(8);
    await frame();
    expect(cards(), 'premise: no inline card below 900').toHaveLength(0);
    const sheet = dialogs()[0]!;
    const rows = [opt(sheet, /^Submit answers/), opt(sheet, /^Cancel/)];
    expect(rows.includes(document.activeElement as HTMLElement), 'the Sheet\'s review row took focus from an inline key').toBe(false);
  });
});

describe('the transcript stops repeating the ask the card already shows', () => {
  it('the transcript\'s live ask card shows \'Waiting for you, below\' and no Answer while the inline card is mounted, and Answer below 900', () => {
    const live = (): HTMLElement => document.querySelector<HTMLElement>('.tool-ask .ask-state')!;

    media(false);
    const phone = mount({ events: [...EVENTS, ASK_CALL] });
    phone.arrive(1);
    // By class: the open sheet hides the page behind it from the accessibility tree, so no role query finds the button.
    expect(live().querySelector('button.ask-answer')?.textContent, 'below 900: Answer raises the sheet').toBe('Answer');
    expect(live().textContent ?? '', 'below 900: nothing is below').not.toMatch(/below/i);
    cleanup();

    media(true);
    const desk = mount({ events: [...EVENTS, ASK_CALL] });
    desk.arrive(1);
    card();
    expect(live().textContent ?? '', 'the card says where the question is').toMatch(/waiting for you, below/i);
    // R64 F5: the card offers "Go to question" (it raises what is already up) and never "Answer" (there is no sheet).
    expect(live().querySelector('button.ask-answer')?.textContent, 'the card offers Go to question').toBe('Go to question');
    expect(within(live()).queryByRole('button', { name: 'Answer' }), 'and no Answer while the card is up').toBeNull();
    // Positive content: the transcript still shows the question line itself.
    expect(document.querySelector('.tool-ask .tool-ask-q')?.textContent).toBe(QUESTION);
  });

  // The mutation table's row for `askBelow` (D-6326): through `SessionScreen` an awaiting card at the desk always has the
  // inline card beside it, so the width and the mounted card agree there. The card itself must follow the screen's fact,
  // never the width: rendered at a desk width with no inline card, it keeps Answer.
  it('at a desk width with no inline card mounted, the live ask card keeps Answer; askBelow alone turns it into Go to question', () => {
    media(true);
    const onAnswer = vi.fn();
    const view = render(<ChatListInner id={ID} events={[ASK_CALL]} pending={[]} askPending onAnswer={onAnswer} />);
    const answer = view.container.querySelector<HTMLButtonElement>('button.ask-answer');
    expect(answer?.textContent, 'the desk width alone keeps Answer').toBe('Answer');
    fireEvent.click(answer!);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    view.rerender(<ChatListInner id={ID} events={[ASK_CALL]} pending={[]} askPending askBelow onAnswer={onAnswer} />);
    expect(view.container.querySelector('button.ask-answer')?.textContent, 'askBelow turns Answer into Go to question').toBe('Go to question');
    expect(within(view.container).queryByRole('button', { name: 'Answer' }), 'askBelow takes Answer away').toBeNull();
    fireEvent.click(view.container.querySelector<HTMLButtonElement>('button.ask-answer')!);
    expect(onAnswer, 'Go to question calls the same raise').toHaveBeenCalledTimes(2);
    expect(view.container.querySelector('.tool-ask .ask-state')?.textContent ?? '').toMatch(/waiting for you, below/i);
  });

  // R64 F5: the desk's transcript card keeps "waiting for you, below" and offers "Go to question" beside it. It is the
  // existing raise (`SessionScreen`'s `setRaise`, through `ChatList` and `ToolCard`, to `DialogSheet`'s `raise` and the
  // inline card's effect), so the cases click the real button on the real screen.
  describe('Go to question (R64 F5)', () => {
    const goTo = (): HTMLButtonElement | null =>
      [...document.querySelectorAll<HTMLButtonElement>('.tool-ask .ask-state button')].find((b) => b.textContent === 'Go to question') ?? null;

    it('clicking Go to question on the transcript\'s live ask card scrolls the inline card into view and focuses its first option', async () => {
      // Premises: the desk; the transcript holds the live ask call; fixture 1's envelope is up in the inline card; focus
      // is in the composer, as a fine pointer leaves it.
      media(true);
      const scrolled: Element[] = [];
      vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function scrollIntoView(this: Element): void {
        scrolled.push(this);
      });
      const { arrive } = mount({ events: [...EVENTS, ASK_CALL] });
      await frame();
      arrive(1);
      const section = card();
      act(() => composer().focus());
      scrolled.length = 0;
      const button = goTo();
      expect(button, 'premise: the transcript card offers Go to question').not.toBeNull();
      act(() => button!.focus());
      fireEvent.click(button!);
      // R69 F3: the card first, then the focused option inside it (the reveal, held in real Chrome by the browser file).
      expect(scrolled, 'the click scrolled the mounted card into view, then its focused option').toEqual([section, opt(section, /^Redis/)]);
      expect(document.activeElement, 'and focused its first option').toBe(opt(section, /^Redis/));
      // The same button raises again after focus moved away: it is a nonce, not a one-shot.
      act(() => composer().focus());
      fireEvent.click(goTo()!);
      expect(document.activeElement, 'a second click focuses it again').toBe(opt(section, /^Redis/));
    });

    it('with the button on screen the card still says waiting for you, below, and there is one question form and no dialog', async () => {
      media(true);
      const { arrive } = mount({ events: [...EVENTS, ASK_CALL] });
      await frame();
      arrive(1);
      card();
      const live = document.querySelector<HTMLElement>('.tool-ask .ask-state')!;
      expect(live.textContent ?? '', 'the word is kept').toMatch(/waiting for you, below/i);
      expect(goTo(), 'premise: the button is beside it').not.toBeNull();
      fireEvent.click(goTo()!);
      expect(cards(), 'one inline card').toHaveLength(1);
      expect(dialogs(), 'no dialog').toHaveLength(0);
      expect(overlays(), 'no scrim').toHaveLength(0);
      expect(screen.getAllByRole('button', { name: /^Redis/ }), 'the options exist once, in the card').toHaveLength(1);
      expect(within(live).queryByRole('button', { name: 'Answer' }), 'and the transcript offers no Answer').toBeNull();
    });

    it('on the review screen the transcript button still says Go to question, not the answer label', async () => {
      media(true);
      const { arrive } = mount({ events: [...EVENTS, ASK_CALL] });
      await frame();
      arrive(8);
      card();
      expect(goTo(), 'Go to question, whatever the sheet is waiting on').not.toBeNull();
      expect(document.querySelector('.tool-ask .ask-state')!.textContent ?? '', 'the answer label is not the transcript\'s').not.toMatch(/Submit answers/);
    });

    it('below 900 the transcript card offers Answer and no Go to question', () => {
      media(false);
      const { arrive } = mount({ events: [...EVENTS, ASK_CALL] });
      arrive(1);
      expect(goTo(), 'no Go to question on a phone').toBeNull();
      expect(document.querySelector('.tool-ask .ask-state button.ask-answer')?.textContent, 'Answer raises the sheet').toBe('Answer');
    });
  });

  it('Answer\'s raise scrolls the card into view and focuses its first option', () => {
    media(true);
    const scrolled: Element[] = [];
    // `setup.ts` gives jsdom a no-op `scrollIntoView` on HTMLElement's prototype, which shadows Element's: spy there.
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function scrollIntoView(this: Element): void {
      scrolled.push(this);
    });
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt } });
    const fx = askFixture(1);
    act(() => { for (const f of fx.frames) store.getState().apply(f); });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const view = render(<DialogSheet id={ID} store={store} raise={0} />);
    const section = card();
    act(() => outside.focus());
    expect(scrolled, 'an inert raise (0) scrolls nothing').toHaveLength(0);
    expect(document.activeElement, 'and takes no focus').toBe(outside);

    view.rerender(<DialogSheet id={ID} store={store} raise={1} />);
    const first = section.querySelector<HTMLElement>('.opt[tabindex="0"]');
    expect(first, 'the roving tab stop is the first option').not.toBeNull();
    expect(first).toBe(opt(section, /^Redis/));
    // R69 F3: the card first, then the focused option inside it.
    expect(scrolled, 'the raise scrolls the card into view, then its focused option').toEqual([section, first]);
    expect(document.activeElement, 'and focuses it').toBe(first);
    outside.remove();
  });
});

// The two surfaces that only point at the terminal (fixture 3, unreadable rows with no copy of the question; fixture 5, an
// unparsed pane): the sheet offers "Open terminal to answer" and "Not now"; the inline card covers nothing, so it offers
// the first alone, and opening the terminal leaves it where it is (`open` is `desk ||` first, D-6326).
describe.each([
  [3, 'ask-unreadable'],
  [5, 'terminal-only'],
] as const)('the terminal-door surface at the desk (fixture %i, %s)', (n, _surface) => {
  /** `DialogSheet` alone over fixture `n`'s frames, with the terminal door stubbed. */
  function mountDoor() {
    const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    act(() => { for (const f of askFixture(n).frames) store.getState().apply(f); });
    const onOpenTerminal = vi.fn();
    render(<DialogSheet id={ID} store={store} onOpenTerminal={onOpenTerminal} />);
    return { onOpenTerminal };
  }

  it('shows "Open terminal to answer" and no "Not now"', () => {
    media(true);
    mountDoor();
    const section = card();
    expect(within(section).getByRole('button', { name: 'Open terminal to answer' }), 'premise: the terminal door is in the card')
      .toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Not now' }), 'no "Not now" in the inline card').toBeNull();
    expect(screen.queryByText('Not now'), 'no "Not now" anywhere on the page').toBeNull();
  });

  it('opening the terminal leaves the inline card mounted', () => {
    media(true);
    const { onOpenTerminal } = mountDoor();
    const section = card();
    fireEvent.click(within(section).getByRole('button', { name: 'Open terminal to answer' }));
    expect(onOpenTerminal, 'premise: the click reached the terminal door').toHaveBeenCalledOnce();
    expect(cards(), 'the card is still mounted after the click').toHaveLength(1);
    expect(cards()[0], 'and it is the same node, not a remount').toBe(section);
    expect(section.isConnected, 'still in the document').toBe(true);
  });
});

describe('the composer while a question is up', () => {
  it('Send while an inline ask is up keeps the text, shows the dialog-open sentence and makes no request', async () => {
    media(true);
    const { arrive, prompt } = mount();
    arrive(1);
    card();
    const box = composer();
    fireEvent.change(box, { target: { value: 'half a thought' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await act(async () => { await Promise.resolve(); });
    expect(prompt, 'no request was made').not.toHaveBeenCalled();
    expect(composer()).toHaveValue('half a thought');
    expect(screen.getByText(sendErrorText('dialog-open')).closest('[role="status"]'), 'in a status line').not.toBeNull();
    // The Send button is the same door, and it is disabled before any click (R77 F1).
    expect(screen.getByRole('button', { name: 'Send' }), 'Send is disabled while the card is mounted').toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => { await Promise.resolve(); });
    expect(prompt).not.toHaveBeenCalled();
    expect(composer()).toHaveValue('half a thought');
  });

  it('the sentence leaves once the question is answered and the card is gone, a Send then goes through, and a later question shows it again', async () => {
    media(true);
    const { arrive, prompt, store } = mount();
    arrive(1);
    card();
    const box = composer();
    fireEvent.change(box, { target: { value: 'half a thought' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(sendErrorText('dialog-open'))).toBeInTheDocument();
    expect(prompt).not.toHaveBeenCalled();

    // The question is answered in the terminal: the pane's menu and the hook's envelope both go.
    act(() => {
      store.getState().apply({ type: 'dialog_cleared' });
      store.getState().apply({ type: 'ask_cleared' });
    });
    expect(cards(), 'the card is gone').toHaveLength(0);
    expect(screen.queryByText(sendErrorText('dialog-open')), 'and so is the refusal line').toBeNull();
    expect(composer(), 'the text is still in the field').toHaveValue('half a thought');

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => { await Promise.resolve(); });
    expect(prompt, 'a Send now reaches the store').toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0]!.slice(0, 2), 'with the text').toEqual([ID, 'half a thought']);

    // A later question shows the sentence again, because a surface is up (R77 F1): it is the surface's own sentence, not a
    // refusal that outlived its ask, and Send is disabled with it.
    fireEvent.change(composer(), { target: { value: 'another thought' } });
    arrive(1);
    card();
    expect(screen.getByText(sendErrorText('dialog-open')).closest('[role="status"]'),
      'a new ask shows the sentence, as its surface is up').not.toBeNull();
    expect(screen.getByRole('button', { name: 'Send' }), 'and Send is disabled for it').toBeDisabled();
  });

  it('fixture 7 (an approval, no pane menu) at the desk: Send is held locally, the draft is kept, no request is made and the dialog-open sentence shows', async () => {
    // Premises (R69 F2): the hook's permission envelope and `dialog: null` (the server's `hasMenu` is false for it, so the
    // server would NOT refuse this send), the inline card mounted at the desk. Send holds because the card is up, which is
    // the client's own deferral, not the server's predicate: a gate on the pane menu (`dialog !== null`) lets this send through.
    media(true);
    const { arrive, prompt, store } = mount();
    arrive(7);
    expect(store.getState().dialog, 'premise: the pane has no menu').toBeNull();
    expect(store.getState().ask, 'premise: the hook\'s approval envelope is held').not.toBeNull();
    card();
    const box = composer();
    fireEvent.change(box, { target: { value: 'half a thought' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await act(async () => { await Promise.resolve(); });
    expect(prompt, 'no request was made').not.toHaveBeenCalled();
    expect(composer(), 'the draft is kept').toHaveValue('half a thought');
    expect(screen.getByText(sendErrorText('dialog-open')).closest('[role="status"]'), 'the sentence shows, in a status line')
      .not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => { await Promise.resolve(); });
    expect(prompt, 'the Send button is the same door').not.toHaveBeenCalled();
    expect(composer()).toHaveValue('half a thought');
  });

  it('Stop still interrupts a busy turn while fixture 7 (no pane menu) is up at the desk', async () => {
    media(true);
    const interrupt = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined);
    const { arrive, store } = mount({ status: 'busy' });
    arrive(7);
    expect(store.getState().dialog, 'premise: the pane has no menu').toBeNull();
    card();
    const stop = document.querySelector<HTMLElement>('.composer .stop-slot')!;
    expect(stop, 'Stop is in the send slot').not.toBeNull();
    fireEvent.click(stop);
    await act(async () => { await Promise.resolve(); });
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(interrupt).toHaveBeenCalledWith(ID, 'keycap');
  });

  it('Stop still interrupts a busy turn while an inline ask is up', async () => {
    media(true);
    const interrupt = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined);
    const { arrive } = mount({ status: 'busy' });
    // The composer's Stop takes the send slot (busy, nothing drafted); its settle guard only follows a send, none here.
    arrive(1);
    card();
    const stop = document.querySelector<HTMLElement>('.composer .stop-slot')!;
    expect(stop, 'Stop is in the send slot').not.toBeNull();
    fireEvent.click(stop);
    await act(async () => { await Promise.resolve(); });
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(interrupt).toHaveBeenCalledWith(ID, 'keycap');
  });
});

// R77 F1: Send is DISABLED while the inline ask surface is mounted (the plan's Shape: while ANY ask surface is mounted, Send
// is locally deferred; the composer keeps the text, disables Send, makes no request and shows the question-first sentence).
// The disabling is BEFORE any click, and the sentence shows the whole time the surface is up, with no draft-only condition.
// `send()`'s own guard stays as defence, because Enter in the field calls it directly.
describe('Send is disabled while an inline ask surface is mounted (R77 F1)', () => {
  const sendButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
  const sentence = (): HTMLElement | null => {
    const found = screen.queryByText(sendErrorText('dialog-open'));
    return found === null ? null : found.closest<HTMLElement>('[role="status"]');
  };

  it('fixture 7 (an approval, no pane menu): with a draft typed and BEFORE any click or Enter, Send is disabled, the sentence shows, the draft is kept and no request was made; a click and Enter then change nothing', async () => {
    media(true);
    const { arrive, prompt, store } = mount();
    arrive(7);
    expect(store.getState().dialog, 'premise: the pane has no menu').toBeNull();
    expect(store.getState().ask, 'premise: the hook\'s approval envelope is held').not.toBeNull();
    card();
    fireEvent.change(composer(), { target: { value: 'half a thought' } });
    expect(sendButton(), 'Send is disabled before any click').toBeDisabled();
    expect(sentence(), 'the dialog-open sentence shows in a status line before any attempt').not.toBeNull();
    expect(composer(), 'the draft is kept').toHaveValue('half a thought');
    expect(prompt, 'no request has been made').not.toHaveBeenCalled();

    fireEvent.click(sendButton());
    fireEvent.keyDown(composer(), { key: 'Enter' });
    await act(async () => { await Promise.resolve(); });
    expect(prompt, 'a click on the disabled Send and an Enter make no request').not.toHaveBeenCalled();
    expect(composer(), 'and the draft is kept').toHaveValue('half a thought');
  });

  describe.each([
    [1, 'a structured question'],
    [3, 'a terminal-door surface (the unreadable menu)'],
    [5, 'a terminal-door surface (the unparsed menu)'],
    [4, 'a plain menu'],
    [8, 'the review screen'],
    [9, 'a pick-several (multiSelect) menu'],
    [6, 'a coordinator-held question'],
    [11, 'a coordinator-held question on an idle row'],
  ] as const)('fixture %i, %s', (n, what) => {
    it('Send is disabled before any click, and Enter makes no request', async () => {
      media(true);
      const { arrive, prompt } = mount({ row: askFixture(n).session });
      arrive(n);
      card();
      fireEvent.change(composer(), { target: { value: 'half a thought' } });
      expect(sendButton(), `Send is disabled while ${what} is mounted`).toBeDisabled();
      fireEvent.keyDown(composer(), { key: 'Enter' });
      await act(async () => { await Promise.resolve(); });
      expect(prompt, 'Enter makes no request').not.toHaveBeenCalled();
      expect(composer(), 'the draft is kept').toHaveValue('half a thought');
    });

    it('the sentence shows in a status line before any click', () => {
      media(true);
      const { arrive } = mount({ row: askFixture(n).session });
      arrive(n);
      card();
      fireEvent.change(composer(), { target: { value: 'half a thought' } });
      expect(sentence(), `the sentence shows while ${what} is mounted`).not.toBeNull();
    });
  });

  it.each([1, 7])('fixture %i: with the field EMPTY the sentence still shows, with no draft-only condition', (n) => {
    media(true);
    const { arrive } = mount();
    arrive(n);
    card();
    expect(composer(), 'premise: the field is empty').toHaveValue('');
    expect(sentence(), 'the sentence shows with the card mounted and nothing typed').not.toBeNull();
  });

  it('fixture 7 on a busy turn with a draft: Send is disabled and the small Stop beside it is enabled and interrupts once with keycap', async () => {
    // A characterization (green on arrival): the draft returns the send slot to Send and keeps a quieter Stop beside it;
    // the ask disables Send only, so Stop stays one tap away.
    media(true);
    const interrupt = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined);
    const { arrive, prompt, store } = mount({ status: 'busy' });
    arrive(7);
    expect(store.getState().dialog, 'premise: the pane has no menu').toBeNull();
    card();
    fireEvent.change(composer(), { target: { value: 'half a thought' } });
    const stops = document.querySelectorAll<HTMLButtonElement>('.composer .stop-slot');
    expect(stops, 'premise: one Stop in the send slot, beside Send').toHaveLength(1);
    expect(stops[0]!.getAttribute('aria-label'), 'premise: it is the small Stop').toBe('Stop');
    expect(sendButton(), 'Send is disabled').toBeDisabled();
    expect(stops[0]!, 'the small Stop beside Send is enabled').toBeEnabled();
    fireEvent.click(stops[0]!);
    await act(async () => { await Promise.resolve(); });
    expect(interrupt, 'a click on it interrupts once').toHaveBeenCalledTimes(1);
    expect(interrupt).toHaveBeenCalledWith(ID, 'keycap');
    expect(prompt, 'and no prompt was made').not.toHaveBeenCalled();
    expect(composer(), 'the draft is kept').toHaveValue('half a thought');
  });

  it('when the card goes the sentence is gone and Send is enabled again with the draft kept', async () => {
    media(true);
    const { arrive, prompt, store } = mount();
    arrive(1);
    card();
    fireEvent.change(composer(), { target: { value: 'half a thought' } });
    expect(sendButton(), 'premise: Send is disabled while the card is up').toBeDisabled();
    act(() => {
      store.getState().apply({ type: 'dialog_cleared' });
      store.getState().apply({ type: 'ask_cleared' });
    });
    expect(cards(), 'premise: the card is gone').toHaveLength(0);
    expect(sentence(), 'the sentence is gone').toBeNull();
    expect(sendButton(), 'Send is enabled again').toBeEnabled();
    fireEvent.click(sendButton());
    await act(async () => { await Promise.resolve(); });
    expect(prompt, 'a Send now reaches the store').toHaveBeenCalledTimes(1);
  });

  describe.each([[1, 'a structured question'], [7, 'an approval']] as const)('the phone with fixture %i, %s', (n, what) => {
    // The phone shows the ask in a Sheet, which `SessionScreen` never reports as `askInline`, so `askUp` stays false there:
    // Send is not disabled by the ask, no sentence shows from it, and a Send reaches the store exactly as it did before.
    it('Send is not disabled by the ask, no sentence shows, and a Send is the store\'s as before', async () => {
      media(false);
      const { arrive, prompt } = mount();
      arrive(n);
      expect(cards(), `premise: ${what} is in the Sheet, no inline card`).toHaveLength(0);
      expect(dialogs(), 'premise: the Sheet is up').toHaveLength(1);
      // The open Sheet hides the composer from the accessibility tree, so the field and the button are found by class.
      fireEvent.change(document.querySelector<HTMLTextAreaElement>('.composer .composer-input')!, { target: { value: 'half a thought' } });
      const send = document.querySelector<HTMLButtonElement>('.composer .send-btn')!;
      expect(send, 'premise: the Send button is in the composer').not.toBeNull();
      expect(send, 'the ask does not disable Send on the phone').toBeEnabled();
      expect(screen.queryByText(sendErrorText('dialog-open')), 'no sentence shows from the ask on the phone').toBeNull();
      fireEvent.click(send);
      await act(async () => { await Promise.resolve(); });
      expect(prompt, 'the phone\'s Send is unchanged: it reaches the store').toHaveBeenCalledTimes(1);
    });
  });
});

// R89: the DESK local send hold covers the other send paths too. While the inline ask surface is mounted (`askInline`, the one
// fact `Composer`'s `askUp` already reads), a failed bubble's Retry and the draft-conflict sheet's Replace draft and Append
// anyway are DISABLED, and their handlers are guarded behind that. Nothing is cleared, nothing is sent, and nothing is queued
// to go when the card leaves: the failed bubble and the open sheet stay as they were, and after the card goes the same buttons
// work as before. Cancel and Discard are not sends and stay enabled. The failed bubble and the conflict come through the real
// composer and the store's own `dispatch` (a rejecting `api.prompt`), never a hand-built `pending`.
describe('the other send paths are held while an inline ask is up (R89)', () => {
  const OFFLINE = new Error('offline');
  const CONFLICT = (): ApiError => new ApiError(409, { ok: false, error: 'draft-present', draft: 'half-typed thought' });
  const retryBtn = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('.pending-retry')!;
  const byText = (name: string): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === name);
  const tick = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
  const clearAsk = (store: SessionStore): void => {
    act(() => {
      store.getState().apply({ type: 'dialog_cleared' });
      store.getState().apply({ type: 'ask_cleared' });
    });
  };

  /** A send that fails through the real composer and the store: `reject` is the one rejection of `api.prompt`. */
  async function failedSend(prompt: ReturnType<typeof vi.fn>, text: string, reject: Error): Promise<void> {
    prompt.mockRejectedValueOnce(reject);
    fireEvent.change(composer(), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await tick();
    expect(prompt, 'premise: the send was made and refused').toHaveBeenCalledTimes(1);
  }

  it('Retry on a failed bubble: with fixture 7 up it is disabled before any click, a click sends nothing and keeps the bubble, and after the clear one click sends the original text once', async () => {
    media(true);
    const { arrive, prompt, store } = mount();
    await failedSend(prompt, 'resend me', OFFLINE);
    expect(retryBtn(), 'premise: the failed bubble offers Retry').not.toBeNull();
    expect(retryBtn(), 'premise: Retry is enabled with no ask up').toBeEnabled();
    arrive(7);
    expect(store.getState().dialog, 'premise: the pane has no menu').toBeNull();
    expect(store.getState().ask, 'premise: the hook\'s approval envelope is held').not.toBeNull();
    card();
    expect(retryBtn(), 'Retry is disabled while the card is mounted').toBeDisabled();
    expect(prompt, 'no request has been made').toHaveBeenCalledTimes(1);
    fireEvent.click(retryBtn());
    await tick();
    expect(prompt, 'a click on the disabled Retry makes no request').toHaveBeenCalledTimes(1);
    expect(screen.getByText('resend me'), 'the failed bubble keeps its text').toBeInTheDocument();
    expect(store.getState().pending.map((p) => p.state), 'and stays failed: no optimistic duplicate, nothing queued').toEqual(['failed']);
    expect(screen.getByRole('button', { name: 'Discard' }), 'Discard is not a send and stays enabled').toBeEnabled();

    clearAsk(store);
    expect(cards(), 'premise: the card is gone').toHaveLength(0);
    await tick();
    expect(prompt, 'nothing was sent on its own when the card left').toHaveBeenCalledTimes(1);
    expect(retryBtn(), 'Retry is enabled once the card has gone').toBeEnabled();
    fireEvent.click(retryBtn());
    await tick();
    expect(prompt, 'one click makes exactly one request').toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls[1]!.slice(0, 2), 'with the original text').toEqual([ID, 'resend me']);
  });

  it('Discard on a failed bubble stays enabled while fixture 7 is up, and removes the bubble without a request', async () => {
    media(true);
    const { arrive, prompt, store } = mount();
    await failedSend(prompt, 'resend me', OFFLINE);
    arrive(7);
    card();
    expect(retryBtn(), 'premise: Retry is held').toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' }), 'Discard is enabled while the card is up').toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await tick();
    expect(store.getState().pending, 'the pending is gone').toEqual([]);
    expect(screen.queryByText('resend me'), 'and so is its bubble').toBeNull();
    expect(prompt, 'and no request was made').toHaveBeenCalledTimes(1);
  });

  it.each([
    [9, 'a pick-several (multiSelect) menu'],
    [6, 'a coordinator-held question'],
  ] as const)('Retry is disabled with fixture %i up (%s), and sends nothing', async (n, _what) => {
    media(true);
    const { arrive, prompt } = mount({ row: askFixture(n).session });
    await failedSend(prompt, 'resend me', OFFLINE);
    arrive(n);
    card();
    expect(retryBtn(), 'Retry is disabled while the card is mounted').toBeDisabled();
    fireEvent.click(retryBtn());
    await tick();
    expect(prompt, 'no request is made').toHaveBeenCalledTimes(1);
  });

  it('Retry stays disabled through the reconnect gap, while the held card is up', async () => {
    media(true);
    const { speak, drop, prompt, store } = mountLive();
    await failedSend(prompt, 'resend me', OFFLINE);
    speak(1);
    card();
    drop();
    expect(store.getState().conn, 'premise: the store left open').not.toBe('open');
    card();
    expect(retryBtn(), 'in the gap: Retry is disabled').toBeDisabled();
    fireEvent.click(retryBtn());
    await tick();
    expect(prompt, 'in the gap: no request is made').toHaveBeenCalledTimes(1);
  });

  describe.each([
    ['Replace draft', 'my message'],
    ['Append anyway', 'half-typed thought\nmy message'],
  ] as const)('the draft-conflict sheet\'s %s', (label, sent) => {
    it('with fixture 7 up it is disabled before any click, a click leaves the sheet open and sends nothing, and after the clear it resolves once', async () => {
      media(true);
      const { arrive, prompt, store } = mount();
      await failedSend(prompt, 'my message', CONFLICT());
      expect(screen.getByText(/already a draft in this session/), 'premise: the conflict sheet is open').toBeInTheDocument();
      expect(byText(label), `premise: ${label} is enabled with no ask up`).toBeEnabled();
      arrive(7);
      expect(store.getState().dialog, 'premise: the pane has no menu').toBeNull();
      expect(store.getState().ask, 'premise: the hook\'s approval envelope is held').not.toBeNull();
      card();
      expect(byText(label), `${label} is disabled while the card is mounted`).toBeDisabled();
      expect(prompt, 'no request has been made').toHaveBeenCalledTimes(1);
      fireEvent.click(byText(label)!);
      await tick();
      expect(prompt, `a click on the disabled ${label} makes no request`).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/already a draft in this session/), 'the sheet is still open').toBeInTheDocument();
      expect(screen.getByTestId('draft-well').textContent, 'with the draft it showed').toBe('half-typed thought');
      expect(store.getState().pending.map((p) => [p.state, p.text]), 'the pending is untouched: failed, with its text')
        .toEqual([['failed', 'my message']]);
      expect(byText('Cancel'), 'Cancel is not a send and stays enabled').toBeEnabled();

      clearAsk(store);
      expect(cards(), 'premise: the card is gone').toHaveLength(0);
      await tick();
      expect(prompt, 'nothing resolved on its own when the card left').toHaveBeenCalledTimes(1);
      expect(byText(label), `${label} is enabled once the card has gone`).toBeEnabled();
      fireEvent.click(byText(label)!);
      await tick();
      expect(prompt, `${label} resolves once`).toHaveBeenCalledTimes(2);
      expect(prompt.mock.calls[1]!.slice(0, 2), 'with the right text').toEqual([ID, sent]);
      expect(prompt.mock.calls[1]![2], 'and replaceDraft').toMatchObject({ replaceDraft: true });
    });
  });

  // R96: `Send it` (the rescue for a failure the server marked `submittable`) is a send too: one more Enter on the text the box
  // holds. It is held with Retry while the card is up, and a press after the card leaves submits once, as before.
  describe.each(['enter-ignored', 'verify-failed'] as const)('Send it on a submittable %s failure', (code) => {
    const SUBMITTABLE = (): ApiError => new ApiError(409, { ok: false, error: code, draft: 'resend me', submittable: true });
    const sendIt = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('.pending-send-it')!;

    it('with fixture 7 up it is disabled before any press, a press submits nothing and keeps the pending, and after the clear one press submits once', async () => {
      media(true);
      const submit = vi.spyOn(api, 'submit').mockResolvedValue(undefined);
      const { arrive, prompt, store } = mount();
      await failedSend(prompt, 'resend me', SUBMITTABLE());
      expect(sendIt(), 'premise: the failed bubble offers Send it').not.toBeNull();
      expect(sendIt(), 'premise: Send it is enabled with no ask up').toBeEnabled();
      arrive(7);
      expect(store.getState().dialog, 'premise: the pane has no menu').toBeNull();
      expect(store.getState().ask, 'premise: the hook\'s approval envelope is held').not.toBeNull();
      card();
      expect(sendIt(), 'Send it is disabled while the card is mounted').toBeDisabled();
      expect(submit, 'no submit has been made').not.toHaveBeenCalled();
      fireEvent.click(sendIt());
      await tick();
      expect(submit, 'a press on the disabled Send it submits nothing').not.toHaveBeenCalled();
      expect(screen.getByText('resend me'), 'the failed bubble keeps its text').toBeInTheDocument();
      expect(store.getState().pending.map((p) => [p.state, p.code, p.draft, p.submittable]),
        'and its recovery state is untouched: failed, with its code, draft and flag').toEqual([['failed', code, 'resend me', true]]);

      clearAsk(store);
      expect(cards(), 'premise: the card is gone').toHaveLength(0);
      await tick();
      expect(submit, 'nothing was submitted on its own when the card left').not.toHaveBeenCalled();
      expect(sendIt(), 'Send it is enabled once the card has gone').toBeEnabled();
      fireEvent.click(sendIt());
      await tick();
      expect(submit, 'one press submits once').toHaveBeenCalledTimes(1);
      expect(submit.mock.calls[0], 'with the expected text').toEqual([ID, 'resend me']);
    });

    it('the phone (a Sheet; askInline never reports) is unchanged: Send it is enabled and a press submits once', async () => {
      media(false);
      const submit = vi.spyOn(api, 'submit').mockResolvedValue(undefined);
      const { arrive, prompt } = mount();
      await failedSend(prompt, 'resend me', SUBMITTABLE());
      arrive(7);
      expect(cards(), 'premise: no inline card on the phone').toHaveLength(0);
      expect(dialogs(), 'premise: the Sheet is up').toHaveLength(1);
      expect(sendIt(), 'Send it is not disabled by the ask').toBeEnabled();
      fireEvent.click(sendIt());
      await tick();
      expect(submit, 'the phone\'s Send it submits once, as before').toHaveBeenCalledTimes(1);
      expect(submit.mock.calls[0]).toEqual([ID, 'resend me']);
    });
  });

  describe('the phone is unchanged (a Sheet never reports askInline)', () => {
    it('with fixture 7 in the Sheet, Retry is enabled and a click re-sends', async () => {
      media(false);
      const { arrive, prompt } = mount();
      await failedSend(prompt, 'resend me', OFFLINE);
      arrive(7);
      expect(cards(), 'premise: no inline card on the phone').toHaveLength(0);
      expect(dialogs(), 'premise: the Sheet is up').toHaveLength(1);
      expect(retryBtn(), 'Retry is not disabled by the ask').toBeEnabled();
      fireEvent.click(retryBtn());
      await tick();
      expect(prompt, 'the phone\'s Retry is the store\'s as before').toHaveBeenCalledTimes(2);
      expect(prompt.mock.calls[1]!.slice(0, 2)).toEqual([ID, 'resend me']);
    });

    it('with fixture 7 in the Sheet, Replace draft and Append anyway are enabled and act', async () => {
      media(false);
      const { arrive, prompt } = mount();
      await failedSend(prompt, 'my message', CONFLICT());
      arrive(7);
      expect(cards(), 'premise: no inline card on the phone').toHaveLength(0);
      expect(byText('Replace draft'), 'Replace draft is not disabled by the ask').toBeEnabled();
      expect(byText('Append anyway'), 'Append anyway is not disabled by the ask').toBeEnabled();
      fireEvent.click(byText('Replace draft')!);
      await tick();
      expect(prompt, 'Replace draft resolves').toHaveBeenCalledTimes(2);
      expect(prompt.mock.calls[1]!.slice(0, 2)).toEqual([ID, 'my message']);
    });
  });
});

// R69 F6, a CHARACTERIZATION (green on the base, not a guard that was red): the card and the composer are not remounted by
// anything the ask goes through. The geometry (the composer moves 0 px) does not prove that, so these compare the nodes.
// Arrival (above) and the skin switch (`skin-switch.test.tsx`) pin theirs; these pin the reconnect and the leave.
class ScriptedSocket {
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  readyState = 0;
  readonly url: string;
  constructor(url: string, sockets: ScriptedSocket[]) {
    this.url = url;
    sockets.push(this);
  }
  close(): void {}
  send(): void {}
  open(): void { this.readyState = 1; this.onopen?.(new Event('open')); }
  drop(): void { this.readyState = 3; this.onclose?.(new Event('close') as CloseEvent); }
}

/** The real `SessionScreen` over a store that `connect()`s through scripted sockets, so a drop and a reconnect are the
 *  store's own `onState` and `onOpen`. `speak(n)` is the connection delivering fixture `n`'s frames after its open. */
function mountLive() {
  const sockets: ScriptedSocket[] = [];
  const prompt = vi.fn().mockResolvedValue(undefined);
  const store: SessionStore = createSessionStore(ID, {
    makeSocket: (url) => new ScriptedSocket(url, sockets) as unknown as WebSocket,
    api: { prompt },
  });
  const row: FleetSession = fleetSession({ id: ID, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', status: 'idle' });
  const fleet = createFleetStore({ makeSocket: fakeSocket });
  act(() => fleet.setState({ sessions: [row], conn: 'open' }));
  act(() => store.setState({ uuid: 'u1', status: 'idle', events: EVENTS }));
  render(<SessionScreen id={ID} store={store} fleet={fleet} />);
  const last = (): ScriptedSocket => sockets[sockets.length - 1]!;
  act(() => last().open());
  const speak = (n: number): void => {
    act(() => { for (const f of askFixture(n).frames) store.getState().apply(f); });
  };
  const drop = (): void => { act(() => last().drop()); };
  const reconnect = (): void => {
    act(() => { window.dispatchEvent(new Event('online')); });
    act(() => last().open());
  };
  return { store, prompt, speak, drop, reconnect, sockets };
}

describe('the card and the composer are not remounted by the ask\'s own life (R69 F6)', () => {
  it('the SAME card node and the SAME composer node, with its typed text, across a drop, the gap and the resume', async () => {
    media(true);
    const { store, speak, drop, reconnect, sockets } = mountLive();
    speak(1);
    const section = card();
    const box = composer();
    fireEvent.change(box, { target: { value: 'half a thought' } });
    const option = opt(section, /^Redis/);
    expect(box, 'premise: the draft is typed').toHaveValue('half a thought');

    drop();
    expect(sockets.length, 'premise: the first socket carried the ask').toBe(1);
    expect(store.getState().conn, 'premise: the store left open').not.toBe('open');
    expect(document.body.textContent, 'premise: the gap says so').toMatch(/Reconnecting/);
    expect(card(), 'in the gap: the same card node').toBe(section);
    expect(composer(), 'in the gap: the same composer node').toBe(box);
    expect(composer(), 'in the gap: its text').toHaveValue('half a thought');
    expect(screen.getByRole('button', { name: 'Send' }), 'in the gap: Send is disabled').toBeDisabled();
    expect(screen.getByText(sendErrorText('dialog-open')).closest('[role="status"]'), 'in the gap: the sentence shows').not.toBeNull();

    reconnect();
    expect(sockets.length, 'premise: a second socket was made').toBe(2);
    speak(1);
    expect(store.getState().conn, 'premise: the store is open again').toBe('open');
    await frame();
    expect(card(), 'after the resume: the same card node').toBe(section);
    expect(opt(card(), /^Redis/), 'after the resume: the same option node').toBe(option);
    expect(composer(), 'after the resume: the same composer node').toBe(box);
    expect(composer(), 'after the resume: its text').toHaveValue('half a thought');
  });

  it('the composer keeps its node and its text when Open terminal is pressed on a terminal-door surface at the desk (fixtures 3 and 5)', () => {
    for (const n of [3, 5]) {
      media(true);
      const { arrive } = mount();
      arrive(n);
      const section = card();
      const box = composer();
      fireEvent.change(box, { target: { value: `draft ${n}` } });
      fireEvent.click(within(section).getByRole('button', { name: 'Open terminal to answer' }));
      expect(card(), `fixture ${n}: the card is the same node`).toBe(section);
      // Premise: the terminal drawer opened. At the desk the ask is the card, so the one dialog on the page is the drawer's
      // Sheet (whatever it renders inside).
      expect(dialogs(), `fixture ${n}: premise: the terminal drawer opened (the one Sheet dialog at the desk)`).toHaveLength(1);
      // The drawer is modal, so the page behind it leaves the accessibility tree: the composer is read with `hidden`.
      const behind = screen.getByRole('textbox', { name: 'Message', hidden: true }) as HTMLTextAreaElement;
      expect(behind, `fixture ${n}: the same composer node after Open terminal`).toBe(box);
      expect(behind.isConnected, `fixture ${n}: still in the document`).toBe(true);
      expect(behind, `fixture ${n}: its text`).toHaveValue(`draft ${n}`);
      cleanup();
    }
  });

  it('the composer keeps its node and its text when the ask ends and the card leaves', () => {
    media(true);
    const { arrive, store } = mount();
    arrive(1);
    card();
    const box = composer();
    fireEvent.change(box, { target: { value: 'half a thought' } });
    act(() => {
      store.getState().apply({ type: 'dialog_cleared' });
      store.getState().apply({ type: 'ask_cleared' });
    });
    expect(cards(), 'premise: the card is gone').toHaveLength(0);
    expect(composer(), 'the same composer node after the card left').toBe(box);
    expect(composer(), 'its text').toHaveValue('half a thought');
  });
});
