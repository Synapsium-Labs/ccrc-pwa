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
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatEvent, Dialog, FleetSession } from '../../shared/api';
import { api, sendErrorText } from '../src/lib/api';
import { ChatListInner } from '../src/session/ChatList';
import { DialogSheet } from '../src/session/DialogSheet';
import { SessionScreen } from '../src/screens/SessionScreen';
import { createFleetStore } from '../src/stores/fleet';
import { createSessionStore, type SessionStore } from '../src/stores/session';
import { askFixture } from './askFixtures';
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

afterEach(() => {
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
function mount(o: { status?: 'idle' | 'busy'; events?: ChatEvent[] } = {}) {
  const status = o.status ?? 'idle';
  const prompt = vi.fn().mockResolvedValue(undefined);
  const store: SessionStore = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt } });
  const row: FleetSession = fleetSession({ id: ID, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', status });
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

describe('the keys survive a screen change inside the card (D-6326)', () => {
  it('after a key answers a question in the card, the next question takes the keys without a click', async () => {
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockResolvedValueOnce({ ok: true, next: nextScreen() });
    const { arrive } = mount();
    await frame(); // the composer's own session-open focus (a 0 ms timer) has run, as in a real session
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    await act(async () => { key(first, '1'); });
    await frame();
    expect(answer).toHaveBeenCalledWith(ID, askFixture(1).dialog!.id, 1);
    expect(within(card()).getByText(QUESTION_2), 'question 2 is in the card').toBeInTheDocument();
    // The row that held focus left the DOM with question 1: focus must be in the card again, with no click.
    const active = document.activeElement as HTMLElement;
    expect(card().contains(active), 'focus is inside the card').toBe(true);
    expect(active).toBe(opt(card(), /^Yes/));
    answer.mockReturnValue(new Promise(() => {}));
    key(document.activeElement!, '2');
    expect(answer).toHaveBeenCalledTimes(2);
    expect(answer).toHaveBeenLastCalledWith(ID, 'dlg-a2', 2);
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

  it('a digit whose answer brings the review leaves focus on the review\'s highlighted row, and a next key acts', async () => {
    // Premises: the desk; fixture 1's envelope up; the answer's `next` is the review (review 917 F1's shape).
    media(true);
    const answer = vi.spyOn(api, 'answerDialog').mockResolvedValueOnce({ ok: true, next: reviewDialog() });
    const { arrive } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    await act(async () => { key(first, '1'); });
    await frame();
    expect(answer).toHaveBeenCalledTimes(1);
    const submit = opt(card(), /^Submit answers/);
    expect(submit, 'premise: the review is mounted').toBeInTheDocument();
    expect(card().contains(document.activeElement), 'focus is back inside the card on the review').toBe(true);
    expect(document.activeElement, 'on the review\'s highlighted row').toBe(submit);
    answer.mockReturnValue(new Promise(() => {}));
    key(document.activeElement!, '1');
    expect(answer, 'a key on the review acts').toHaveBeenCalledTimes(2);
    expect(answer).toHaveBeenLastCalledWith(ID, askFixture(8).dialog!.id, 1);
  });

  it('← from the review back to a question leaves focus inside the card on the question\'s row, and a key acts', async () => {
    // Premises: the review is up with its envelope; ← inside the card moves the pane's tab, and `next` is question 1.
    media(true);
    const tab = vi.spyOn(api, 'answerDialogTab').mockResolvedValueOnce({ ok: true, next: askFixture(1).dialog! });
    const { arrive } = mount();
    await frame();
    arrive(8);
    const submit = opt(card(), /^Submit answers/);
    act(() => submit.focus());
    await act(async () => { key(submit, 'ArrowLeft'); });
    await frame();
    expect(tab).toHaveBeenCalledTimes(1);
    expect(within(card()).getByText(QUESTION), 'premise: the question is back').toBeInTheDocument();
    expect(card().contains(document.activeElement), 'focus is back inside the card on the question').toBe(true);
    expect(document.activeElement, 'on the question\'s highlighted row').toBe(opt(card(), /^Redis/));
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    key(document.activeElement!, '2');
    expect(answer, 'a key on the question acts').toHaveBeenCalledWith(ID, askFixture(1).dialog!.id, 2);
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
    // body as a click on a non-focusable area does; the next question arrives.
    media(true);
    vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, '1');
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
    vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, '1');
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
    // only the `focusin` outside the card can say the operator left; the next question arrives.
    media(true);
    vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, '1');
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
    vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const { arrive, store } = mount();
    await frame();
    arrive(1);
    const first = opt(card(), /^Redis/);
    act(() => first.focus());
    key(first, '1');
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
      expect(scrolled, 'the click scrolled the mounted card into view').toEqual([section]);
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
    expect(scrolled, 'the raise scrolls the card into view').toEqual([section]);
    const first = section.querySelector<HTMLElement>('.opt[tabindex="0"]');
    expect(first, 'the roving tab stop is the first option').not.toBeNull();
    expect(first).toBe(opt(section, /^Redis/));
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
    // The Send button is the same door.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => { await Promise.resolve(); });
    expect(prompt).not.toHaveBeenCalled();
    expect(composer()).toHaveValue('half a thought');
  });

  it('the refusal line leaves once the question is answered and the card is gone, and a Send then goes through', async () => {
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

    // A later question starts clean: the old refusal does not come back with it.
    fireEvent.change(composer(), { target: { value: 'another thought' } });
    arrive(1);
    card();
    expect(screen.queryByText(sendErrorText('dialog-open')), 'a new ask shows no stale refusal').toBeNull();
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
