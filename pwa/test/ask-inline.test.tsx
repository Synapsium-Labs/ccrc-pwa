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
    expect(live().querySelector('button.ask-answer'), 'no Answer while the card is up').toBeNull();
    // Positive content: the transcript still shows the question line itself.
    expect(document.querySelector('.tool-ask .tool-ask-q')?.textContent).toBe(QUESTION);
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
