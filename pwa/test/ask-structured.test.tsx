// D-6325 (plan docs/superpowers/plans/2026-10-22-desktop-polish.md, Task T1b, S2): every ask surface renders from
// `askSource`, so no string the pane painted reaches an AskUserQuestion, and each surface says who asks.
//
// The inputs are the plan's ask fixtures (`askFixtures.ts`), whose every pane field is debris (`ASK_DEBRIS`): a case
// asserts the debris is ABSENT from the DOM and, beside it, that what the surface does show is PRESENT (the transcript's
// question, the can't-read sentence with its way to the terminal, the review's fixed words). The answer path is the
// one it always was: a tap answers through `/dialog` with the dialog's id and the printed index.
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatEvent, Dialog, FleetSession, HookAsk } from '../../shared/api';
import { ToastHost } from '@ccrc/ui';
import { api } from '../src/lib/api';
import { DialogSheet } from '../src/session/DialogSheet';
import { heldAskLine } from '../src/session/askWords';
import { SessionScreen } from '../src/screens/SessionScreen';
import { createFleetStore } from '../src/stores/fleet';
import { createSessionStore, type SessionStore } from '../src/stores/session';
import {
  ASKER_COORD, ASKER_PROJECT, ASKER_SESSION, ASK_DEBRIS, DEBRIS_LABEL, HOOK_QUESTIONS, askFixture, type AskFixture,
} from './askFixtures';
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
});

const ID = 'lane-a-project-a';

const fakeSocket = (): WebSocket =>
  ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;

/** A store holding what `fx`'s frames left, applied in the order the stream sent them. */
function storeFor(fx: AskFixture): SessionStore {
  const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
  act(() => {
    for (const frame of fx.frames) store.getState().apply(frame);
  });
  expect(store.getState().askFrameSeen, 'the fixture says whether a frame was seen').toBe(fx.askFrameSeen);
  return store;
}

/** The sheet alone, over fixture `n`. */
function renderSheet(n: number, props: Partial<Parameters<typeof DialogSheet>[0]> = {}) {
  const fx = askFixture(n);
  const store = storeFor(fx);
  const onOpenTerminal = vi.fn();
  render(
    <>
      <DialogSheet id={ID} store={store} onOpenTerminal={onOpenTerminal} {...props} />
      <ToastHost />
    </>,
  );
  return { fx, store, onOpenTerminal };
}

/** The whole session screen over fixture `n` and the fleet row `row`, which is where the header's who and held lines are
 *  built (`SessionScreen` from the row, `sessionLabel`, and the header's own gated coordinator words). */
function renderScreen(n: number, row: FleetSession) {
  const fx = askFixture(n);
  const store = storeFor(fx);
  const fleet = createFleetStore({ makeSocket: fakeSocket });
  act(() => fleet.setState({ sessions: [row], conn: 'open' }));
  act(() => store.setState({ uuid: 'u1', status: row.status }));
  render(<SessionScreen id={ID} store={store} fleet={fleet} />);
  // The screen connects the store on mount, and a connecting socket is not live (`onState` lowers `askFrameSeen`, D-6325).
  // The stream's frames come after the connect, so they are applied again here, as the new connection would send them.
  act(() => {
    for (const frame of fx.frames) store.getState().apply(frame);
  });
  expect(store.getState().askFrameSeen, 'the fixture says whether a frame was seen').toBe(fx.askFrameSeen);
  return { fx, store };
}

/** Fixtures 1 and 7 carry no fleet row: this one names the session `ws-a` of `project-a`. */
const plainRow = (): FleetSession => fleetSession({
  id: ID, wrapper: 'lane-a', home: 'lane-a', project: ASKER_PROJECT, workspace: ASKER_SESSION, bucket: 'working',
  hookState: 'waiting',
});

const dom = (): string => document.body.textContent ?? '';
const eyebrow = (): HTMLElement => document.querySelector<HTMLElement>('.sheet-eyebrow')!;
const CANT_READ = "Claude is asking a question this screen can't read yet.";

describe('no text from Dialog.body, Dialog.raw, Dialog.title or a scraped label renders on an AskUserQuestion, and the surface shows its own words', () => {
  // Fixtures 2, 3, 5, 8, 9 and 10: the pane's title, body, raw and labels are all debris, so every one of them that
  // reached the DOM would be found here.
  it.each([
    [2, 'an aged ask shows the transcript\'s own question and options'],
    [3, 'an unreadable ask says so, and offers the terminal'],
    [5, 'an unparsed pane says Claude is waiting on the terminal'],
    [8, 'the review shows its fixed words'],
    [9, 'a pick-several question with no copy says so'],
    [10, 'a free-text row drawn in a box is still an ask that cannot be read'],
  ])('fixture %i: %s', (n) => {
    renderSheet(n);
    for (const debris of ASK_DEBRIS) {
      expect(dom(), `the pane's text reached the DOM: ${debris}`).not.toContain(debris.trim());
    }
    expect(document.querySelector('.dlg-raw, .dlg-details-toggle, .dlg-body')).toBeNull();
    expect(screen.queryByText(/Show full question/)).toBeNull();
  });

  // A pick-several question answered with boxes: the option's words are Claude's (the hook's), and an option with none to
  // show, or a blank one, shows none. The pane's sub-text under the same box is debris and must not stand in for it.
  it('a pick-several option with no description, or a blank one, shows none and never the pane\'s sub-text', () => {
    const multi = askFixture(9).dialog!;
    const dialog: Dialog = {
      ...multi,
      multi: {
        ...multi.multi!,
        options: multi.multi!.options.map((o) => ({ ...o, description: DEBRIS_LABEL })),
      },
    };
    const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    act(() => {
      store.getState().apply({ type: 'dialog', dialog });
      store.getState().apply({
        type: 'ask', key: null,
        ask: { questions: [{
          question: 'Which regions should it deploy to?', header: 'Regions', multiSelect: true,
          options: [{ label: 'North' }, { label: 'East', description: '' }, { label: 'South', description: 'Only for the latency test.' }],
        }] },
      });
    });
    render(<DialogSheet id={ID} store={store} onOpenTerminal={vi.fn()} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    for (const label of ['North', 'East', 'South']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(dom()).not.toContain(DEBRIS_LABEL);
    expect(screen.getByText('Only for the latency test.')).toBeInTheDocument();
    expect(document.querySelectorAll('.opt-desc')).toHaveLength(1);
  });

  // The held line when the pane's cursor rests on the commit row names that row by the SHEET's own word (the one its
  // commit button shows), never by the pane's own label for it (a debris label here).
  it.each([
    [DEBRIS_LABEL, 'Next'],
    ['Submit', 'Review answers'],
  ])('a pick-several question with the cursor on a commit row labelled %j names it %j, never the pane\'s label', (commit, word) => {
    const multi = askFixture(9).dialog!;
    const dialog: Dialog = { ...multi, multi: { ...multi.multi!, commit, cursor: 'commit' } };
    const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    act(() => {
      store.getState().apply({ type: 'dialog', dialog });
      store.getState().apply({
        type: 'ask', key: null,
        ask: { questions: [{
          question: 'Which regions should it deploy to?', header: 'Regions', multiSelect: true,
          options: [{ label: 'North' }, { label: 'East' }, { label: 'South' }],
        }] },
      });
    });
    render(<DialogSheet id={ID} store={store} onOpenTerminal={vi.fn()} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('button', { name: word })).toBeInTheDocument();
    expect(dom()).toContain(`In the terminal the cursor is on the ${word} row`);
    expect(dom()).not.toContain(DEBRIS_LABEL);
  });

  it('fixture 2 (aged): the transcript\'s question, every label and every description', () => {
    renderSheet(2);
    expect(screen.getByRole('heading', { name: HOOK_QUESTIONS[0]!.question })).toBeInTheDocument();
    for (const o of HOOK_QUESTIONS[0]!.options) {
      // `Redis (Recommended)` is `Redis` and a tag: the label's own words.
      expect(screen.getByText(o.label.replace(/ \(Recommended\)$/, ''), { selector: '.opt-label' })).toBeInTheDocument();
      expect(screen.getByText(o.description!)).toBeInTheDocument();
    }
    expect(document.querySelector('[data-source="transcript"]')).not.toBeNull();
  });

  it.each([3, 9, 10])('fixture %i (unreadable): the can\'t-read sentence, the terminal door, no row to tap', (n) => {
    const { onOpenTerminal } = renderSheet(n);
    expect(screen.getByRole('heading', { name: CANT_READ })).toBeInTheDocument();
    expect(document.querySelectorAll('.opt')).toHaveLength(0);
    expect(screen.queryByLabelText('Your own answer')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Other/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Open terminal/ }));
    expect(onOpenTerminal).toHaveBeenCalledOnce();
  });

  it('fixture 5 (unparsed): Claude is waiting on the terminal, and the door to it', () => {
    const { onOpenTerminal } = renderSheet(5);
    expect(screen.getByRole('heading', { name: 'Claude is waiting on the terminal.' })).toBeInTheDocument();
    expect(eyebrow().textContent).toContain('Claude is waiting');
    fireEvent.click(screen.getByRole('button', { name: /^Open terminal/ }));
    expect(onOpenTerminal).toHaveBeenCalledOnce();
  });

  it('fixture 8 (review): Review your answers, each question by its header, Submit answers and Cancel', () => {
    renderSheet(8);
    expect(screen.getByRole('heading', { name: 'Review your answers' })).toBeInTheDocument();
    // The pane marks questions 1 and 3 answered (`☒ Cache ☐ Tracing ☒ Regions`): Claude's headers, the pane's marks.
    expect([...document.querySelectorAll('.ask-envelope li')].map((li) => li.textContent)).toEqual([
      'Cache · Answered', 'Tracing · Not answered yet', 'Regions · Answered',
    ]);
    expect(screen.getByRole('button', { name: /^Submit answers/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Cancel/ })).toHaveTextContent('Declines every question in this ask');
  });

  it('fixture 4 (a menu that is no ask): its parsed title and rows, the kicker Claude needs a choice, no raw text', () => {
    renderSheet(4);
    expect(screen.getByRole('heading', { name: 'Ready to code?' })).toBeInTheDocument();
    expect(eyebrow().textContent).toContain('Claude needs a choice');
    expect(screen.getByRole('button', { name: /^Yes, and manually approve edits/ })).toBeEnabled();
    expect(document.querySelector('.sheet-foot')?.textContent).toBe('Choose an option');
    expect(dom()).not.toContain('debris');
    expect(document.querySelector('.dlg-raw, .dlg-details-toggle, .dlg-body')).toBeNull();
  });

  it('fixture 0 (no ask or ask_cleared frame yet): nothing at all, whatever the pane holds', () => {
    renderSheet(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(dom()).toBe('');
  });
});

describe('one sheet from the first question to the review (D-6325)', () => {
  // The drawer is ONE container for every kind of surface: moving from the last question to the review (or back) changes
  // what is inside it, never the drawer itself, so it keeps its entrance, its scroll and its focus. A remount would be a
  // new panel node.
  it.each([
    [1, 8, 'Review your answers'],
    [8, 1, 'Which cache should the service use?'],
  ])('the panel is the same node moving from fixture %i to fixture %i', (from, to, heading) => {
    const { store } = renderSheet(from);
    const before = document.querySelector('[role="dialog"]');
    expect(before).not.toBeNull();
    act(() => {
      store.getState().apply({ type: 'dialog', dialog: askFixture(to).dialog! });
    });
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(document.querySelector('[role="dialog"]'), 'the sheet was remounted').toBe(before);
  });

  it('the panel is the same node moving from a question to an approval', () => {
    const { store } = renderSheet(1);
    const before = document.querySelector('[role="dialog"]');
    act(() => {
      store.getState().apply({ type: 'ask', key: 'ask-key-b', ask: { approval: { tool: 'Bash', summary: 'git status' } } });
    });
    expect(screen.getByRole('heading', { name: 'Bash' })).toBeInTheDocument();
    expect(document.querySelector('[role="dialog"]'), 'the sheet was remounted').toBe(before);
  });
});

describe('the tab strip (D-6325)', () => {
  it('the tab strip\'s labels are the structured headers, the pane\'s tab row only its marks', () => {
    const fx = askFixture(1);
    // The pane paints other words on its tab row, and marks the second tab answered.
    const dialog: Dialog = {
      ...fx.dialog!,
      raw: fx.dialog!.raw.replace(/^←.*→$/m, '←  ☐ Alpha  ☒ Beta  ☐ Gamma  ✔ Submit  →'),
    };
    expect(dialog.raw).toContain('Alpha');
    const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    act(() => {
      store.getState().apply({ type: 'dialog', dialog });
      store.getState().apply({ type: 'ask', ask: fx.ask!, key: null });
    });
    render(<DialogSheet id={ID} store={store} onOpenTerminal={vi.fn()} />);

    const strip = screen.getByRole('group', { name: 'Questions in this ask' });
    const chips = within(strip).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(chips).toEqual([
      'Go to Cache, not answered yet', 'Go to Tracing, answered', 'Go to Regions, not answered yet', 'Go to Submit',
    ]);
    expect(strip.textContent).not.toMatch(/Alpha|Beta|Gamma/);
  });

  it('a question with no header is named Question <n>, and no strip is drawn when the counts differ', () => {
    const fx = askFixture(1);
    const ask = structuredClone(fx.ask!);
    if (!('questions' in ask)) throw new Error('fixture 1 is a question envelope');
    delete ask.questions[1]!.header;
    const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    act(() => {
      store.getState().apply({ type: 'dialog', dialog: fx.dialog! });
      store.getState().apply({ type: 'ask', ask, key: null });
    });
    render(<DialogSheet id={ID} store={store} onOpenTerminal={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Go to Question 2,/ })).toBeInTheDocument();

    // Two tabs on the pane for three questions: the words cannot be matched to the marks, so there is no strip.
    cleanup();
    const two: Dialog = { ...fx.dialog!, raw: fx.dialog!.raw.replace(/^←.*→$/m, '←  ☐ Alpha  ☐ Beta  ✔ Submit  →') };
    const store2 = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    act(() => {
      store2.getState().apply({ type: 'dialog', dialog: two });
      store2.getState().apply({ type: 'ask', ask: fx.ask!, key: null });
    });
    render(<DialogSheet id={ID} store={store2} onOpenTerminal={vi.fn()} />);
    expect(screen.queryByRole('group', { name: 'Questions in this ask' })).toBeNull();
  });
});

describe('the transcript\'s Answer control (D-6325)', () => {
  const askCard: ChatEvent = {
    kind: 'tool_use', uuid: 'a1', ts: '2026-10-22T10:00:00.000Z', toolId: 't1', name: 'AskUserQuestion',
    input: JSON.stringify({ questions: [{ question: 'Which cache?', header: 'Cache', multiSelect: false,
      options: [{ label: 'Redis' }, { label: 'None' }] }] }),
  };
  const withCard = (n: number) => {
    const out = renderScreen(n, plainRow());
    act(() => out.store.setState({ events: [askCard] }));
    return out;
  };

  // The control raises the sheet. Before this connection's first ask frame the sheet is nothing (`askSource`), so a
  // control offered then would be one that raises nothing.
  it('is offered while a sheet is up (fixture 1)', () => {
    withCard(1);
    expect(document.querySelector('.ask-answer')).not.toBeNull();
  });

  it('is not offered before the first ask frame, however the pane looks (fixture 0)', () => {
    withCard(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('.ask-answer'), 'a control that would raise nothing').toBeNull();
  });
});

describe('who asks (D-6325)', () => {
  it.each([1, 7])('the header names the session and its project (fixture %i)', (n) => {
    renderScreen(n, plainRow());
    expect(eyebrow().querySelector('.ask-who')?.textContent).toBe(`${ASKER_SESSION} · ${ASKER_PROJECT}`);
    expect(eyebrow().textContent).toContain('Claude is asking');
    // Sentence case in the DOM: the old kicker was the lowercase literal.
    expect(eyebrow().textContent).not.toContain('claude is asking');
    expect(eyebrow().querySelector('.ask-held')).toBeNull();
  });

  it('fixture 1 keeps the question\'s header chip and its place in the ask beside the kicker', () => {
    renderScreen(1, plainRow());
    expect(eyebrow().querySelector('.dlg-header-chip')?.textContent).toBe('Cache');
    expect(eyebrow().textContent).toContain('1 of 3');
  });

  it('every kind of surface draws the same header', () => {
    for (const n of [2, 3, 4, 5, 8]) {
      renderScreen(n, plainRow());
      expect(eyebrow().querySelector('.ask-who')?.textContent, `fixture ${n}`).toBe(`${ASKER_SESSION} · ${ASKER_PROJECT}`);
      cleanup();
    }
  });

  it('...and the held words while a coordinator holds it (fixture 6)', () => {
    const fx = askFixture(6);
    renderScreen(6, fx.session!);
    expect(eyebrow().querySelector('.ask-who')?.textContent).toBe(`${ASKER_SESSION} · ${ASKER_PROJECT}`);
    expect(eyebrow().querySelector('.ask-held')?.textContent).toBe(heldAskLine(ASKER_COORD.replace(`${ASKER_PROJECT}-`, '')));
    expect(eyebrow().querySelector('.ask-held')?.textContent).toContain('You can still answer.');
  });

  it('...and no held words for an idle row that keeps withCoordinator (fixture 11)', () => {
    const fx = askFixture(11);
    expect(fx.session!.withCoordinator, 'the row keeps the stale field').not.toBeNull();
    renderScreen(11, fx.session!);
    expect(eyebrow().querySelector('.ask-who')?.textContent).toBe(`${ASKER_SESSION} · ${ASKER_PROJECT}`);
    expect(eyebrow().querySelector('.ask-held')).toBeNull();
    expect(dom()).not.toContain('may answer first');
  });

  it('the sheet still opens while a coordinator holds the question, with every option answerable (fixture 6)', () => {
    renderScreen(6, askFixture(6).session!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: HOOK_QUESTIONS[0]!.question })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^In-process/ })).toBeEnabled();
  });

  it('with no fleet row there is no who line', () => {
    renderSheet(1);
    expect(eyebrow().querySelector('.ask-who')).toBeNull();
    expect(eyebrow().textContent).toContain('Claude is asking');
  });
});

describe('the answer path is unchanged (D-6325)', () => {
  it('a tap answers through /dialog with the same dialogId and printed index as today', () => {
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    // The hook's envelope (fixture 1), the transcript's copy (fixture 2) and a plain menu (fixture 4): three sources, one
    // route, and the digit printed on the pane, whatever the sheet calls the row.
    renderSheet(1);
    fireEvent.click(screen.getByRole('button', { name: /^In-process/ }));
    expect(spy).toHaveBeenLastCalledWith(ID, 'dlg-a1', 2);
    cleanup();
    renderSheet(2);
    fireEvent.click(screen.getByRole('button', { name: /^None/ }));
    expect(spy).toHaveBeenLastCalledWith(ID, 'dlg-a1', 3);
    cleanup();
    renderSheet(4);
    fireEvent.click(screen.getByRole('button', { name: /^No, keep planning/ }));
    expect(spy).toHaveBeenLastCalledWith(ID, 'dlg-a4', 3);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('the review answers Submit answers with its printed digit, and Cancel with its own', () => {
    const spy = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderSheet(8);
    fireEvent.click(screen.getByRole('button', { name: /^Submit answers/ }));
    expect(spy).toHaveBeenLastCalledWith(ID, 'dlg-review', 1);
    cleanup();
    spy.mockClear();
    renderSheet(8);
    fireEvent.click(screen.getByRole('button', { name: /^Cancel/ }));
    expect(spy).toHaveBeenLastCalledWith(ID, 'dlg-review', 2);
  });

  it('a stale answer toasts the structured sentence for a structured sheet, and the menu\'s for a menu', async () => {
    const { ApiError } = await import('../src/lib/api');
    vi.spyOn(api, 'answerDialog').mockRejectedValue(new ApiError(409, { ok: false, error: 'stale-dialog' }));
    renderSheet(1);
    fireEvent.click(screen.getByRole('button', { name: /^In-process/ }));
    expect(await screen.findByText(/moved on in the terminal/i)).toBeInTheDocument();
    cleanup();
    renderSheet(4);
    fireEvent.click(screen.getByRole('button', { name: /^No, keep planning/ }));
    expect(await screen.findByText('That question changed — showing the latest')).toBeInTheDocument();
  });

  it('fixture 7 (an approval with no menu): the tool and its summary, Allow held until the pane corresponds', () => {
    renderSheet(7, { asker: { session: ASKER_SESSION, project: ASKER_PROJECT, held: null } });
    expect(screen.getByRole('heading', { name: 'Bash' })).toBeInTheDocument();
    expect(screen.getByText('git status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    expect(eyebrow().querySelector('.ask-who')?.textContent).toBe(`${ASKER_SESSION} · ${ASKER_PROJECT}`);
  });
});

// D-6325, S3: the rows' copy and shape. The label is the row's name (a trailing `(Recommended)` leaves it for a tag), the
// description sits under it as its own element, and the free-text row is a row of the list, `Other`.
describe('the rows\' copy: Recommended, label over description, Other (D-6325)', () => {
  const rowOf = (name: RegExp): HTMLElement => screen.getByRole('button', { name });

  it('a trailing (Recommended) becomes a tag and leaves the label; \'Recommended reading\' stays whole', () => {
    renderSheet(1);
    const first = rowOf(/^Redis/);
    const label = first.querySelector('.opt-label')!;
    // The label's own words are `Redis`; the tag is a Chip after them, reading `Recommended`.
    expect(label.firstChild?.textContent).toBe('Redis');
    expect(label.textContent).not.toMatch(/\(/);
    const tag = label.querySelector('.chip');
    expect(tag?.textContent).toBe('Recommended');
    expect(tag?.previousSibling?.textContent, 'a space, then the tag, after the label').toBe(' ');
    expect(tag?.previousSibling?.previousSibling?.textContent).toBe('Redis');
    // Only the option that carried it wears it.
    expect(document.querySelectorAll('.opt-label .chip')).toHaveLength(1);
    expect(dom()).not.toContain('(Recommended)');
    cleanup();

    // Any case, any spacing; a label that merely contains the word keeps it whole and wears no tag.
    const fx = askFixture(1);
    const ask = structuredClone(fx.ask!);
    if (!('questions' in ask)) throw new Error('fixture 1 is a question envelope');
    ask.questions[0]!.options = [
      { label: 'Fast path (RECOMMENDED)', description: 'Skips the cache.' },
      { label: 'Recommended reading', description: 'Starts from the docs.' },
      { label: 'Read the (Recommended) docs first' },
    ];
    const dialog: Dialog = {
      ...fx.dialog!,
      options: [
        { index: 1, label: 'Fast path (RECOMMENDED)' }, { index: 2, label: 'Recommended reading' },
        { index: 3, label: 'Read the (Recommended) docs first' }, { index: 4, label: 'Type something.' },
        { index: 5, label: 'Chat about this' },
      ],
    };
    const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    act(() => {
      store.getState().apply({ type: 'dialog', dialog });
      store.getState().apply({ type: 'ask', ask, key: null });
    });
    render(<DialogSheet id={ID} store={store} onOpenTerminal={vi.fn()} />);
    const labels = [...document.querySelectorAll('.opt-label')].map((l) => l.firstChild?.textContent);
    expect(labels.slice(0, 3)).toEqual(['Fast path', 'Recommended reading', 'Read the (Recommended) docs first']);
    const tagged = [...document.querySelectorAll('.opt-label .chip')].map((c) => c.closest('.opt'));
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.querySelector('.opt-label')?.textContent).toBe('Fast path Recommended');
    expect(tagged[0]?.querySelector('.opt-desc')?.textContent).toBe('Skips the cache.');
  });

  it('each option\'s label and description are separate elements, the description after the label', () => {
    renderSheet(1);
    const rows = [...document.querySelectorAll<HTMLElement>('.ask-envelope .opts > .opt')].slice(0, 3);
    expect(rows).toHaveLength(3);
    rows.forEach((row, i) => {
      const label = row.querySelector('.opt-label')!;
      const desc = row.querySelector('.opt-desc')!;
      expect(label, `row ${i + 1}`).not.toBe(desc);
      expect(label.contains(desc) || desc.contains(label), 'neither holds the other').toBe(false);
      expect(label.compareDocumentPosition(desc) & Node.DOCUMENT_POSITION_FOLLOWING, 'the description follows').toBeTruthy();
      expect(desc.textContent).toBe(HOOK_QUESTIONS[0]!.options[i]!.description);
      expect(label.textContent).not.toContain(desc.textContent!);
    });
  });

  it('Other is a row; choosing it shows the field and Send; Send answers through /dialog/text with the same body as today', () => {
    const text = vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderSheet(1);
    // A row of the list, after the three options, at the free-text row's printed index (4), saying what it does.
    const other = rowOf(/^Other/);
    expect(other.querySelector('.opt-label')?.textContent).toBe('Other');
    expect(other.querySelector('.opt-desc')?.textContent).toBe('Type your own answer');
    expect(other.querySelector('.opt-idx')?.textContent).toBe('4');
    expect(other.closest('.opts')).toBe(rowOf(/^In-process/).closest('.opts'));
    // Closed until chosen: no field, no Send.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    fireEvent.click(other);
    expect(option, 'choosing Other sends nothing').not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    // Open in place, under the Other row and before the Chat row.
    const field = screen.getByRole('textbox');
    expect(other.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const chat = rowOf(/^Talk it over in the chat instead/);
    expect(field.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.activeElement, 'choosing it puts the cursor in the field').toBe(field);
    fireEvent.change(field, { target: { value: '  Memcached  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    // The route's arguments are as they were: session, the screen's id, the free-text row's index, the trimmed text.
    expect(text).toHaveBeenCalledWith(ID, 'dlg-a1', 4, 'Memcached');
    expect(text).toHaveBeenCalledTimes(1);
    expect(option).not.toHaveBeenCalled();
  });

  it('the Chat row reads Talk it over in the chat instead, and answers by its printed index', () => {
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    renderSheet(1);
    const chat = rowOf(/^Talk it over in the chat instead/);
    expect(chat.querySelector('.opt-idx')?.textContent).toBe('5');
    expect(dom()).not.toContain('Chat about this');
    fireEvent.click(chat);
    expect(option).toHaveBeenCalledWith(ID, 'dlg-a1', 5);
    expect(option).toHaveBeenCalledTimes(1);
  });

  it('a chosen Other does not outlive its screen: a new screen with nothing kept starts closed, one with text keeps it open', () => {
    const { fx, store } = renderSheet(1);
    fireEvent.click(rowOf(/^Other/));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    // The same question repainted under a new id (typing in the terminal, a mid-redraw grab): no text and no call are
    // kept here, so the choice is spent and the field is closed again.
    act(() => store.getState().apply({ type: 'dialog', dialog: { ...fx.dialog!, id: 'dlg-a1-repaint' } }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(rowOf(/^Other/)).toBeInTheDocument();
    // Chosen again, with text typed: a repaint under another new id keeps the field open, text and all.
    fireEvent.click(rowOf(/^Other/));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Memcached' } });
    act(() => store.getState().apply({ type: 'dialog', dialog: { ...fx.dialog!, id: 'dlg-a1-repaint-2' } }));
    expect(screen.getByRole('textbox')).toHaveValue('Memcached');
  });

  it('a refused send keeps the field open with the text, and says why', async () => {
    const { ApiError } = await import('../src/lib/api');
    vi.spyOn(api, 'answerDialogText').mockRejectedValue(new ApiError(409, { ok: false, error: 'not-free-text' }));
    renderSheet(1);
    fireEvent.click(rowOf(/^Other/));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Memcached' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    // The text is kept, so the field is open without another tap on Other.
    expect(screen.getByRole('textbox')).toHaveValue('Memcached');
    expect(await screen.findByText(/answer box in the terminal holds something else/i)).toBeInTheDocument();
  });

  it('the foot line names Other where it is offered, and a pick-several question has none and says why', () => {
    renderSheet(1);
    expect(document.querySelector('.sheet-foot')?.textContent).toBe('Choose an option, or Other to type your own');
    cleanup();
    // A pick-several question: the boxes, no Other row, and the line that sends the operator to the terminal.
    const multi = askFixture(9).dialog!;
    const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    act(() => {
      store.getState().apply({ type: 'dialog', dialog: multi });
      store.getState().apply({
        type: 'ask', key: null,
        ask: { questions: [{
          question: 'Which regions should it deploy to?', header: 'Regions', multiSelect: true,
          options: HOOK_QUESTIONS[2]!.options.map((o) => ({ ...o })),
        }] },
      });
    });
    render(<DialogSheet id={ID} store={store} onOpenTerminal={vi.fn()} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /^Other/ })).toBeNull();
    expect(screen.getByText('To add your own answer, use the terminal')).toBeInTheDocument();
    expect(document.querySelector('.sheet-foot')?.textContent).toBe('Choose an option');
  });
});

describe('one scroll region (D-6325)', () => {
  it('an ask sheet\'s title does not scroll on its own: the sheet body is the one scroller', () => {
    for (const n of [1, 2, 4, 5, 8, 3]) {
      renderSheet(n);
      const title = document.querySelector('.sheet-title')!;
      expect(title.className, `fixture ${n}`).not.toMatch(/overflow-y-auto|max-h-\[38vh\]/);
      cleanup();
    }
    renderSheet(7);
    expect(document.querySelector('.sheet-title')!.className).not.toMatch(/overflow-y-auto|max-h-\[38vh\]/);
  });

  it('no stylesheet rule caps an ask surface\'s body at 38vh', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'session', 'chat.css'), 'utf8');
    expect(css).not.toMatch(/\.dlg-body\s*\{/);
    // ...nor a rule above the list: each row has its own rule, so a seam above the first reads as a ruled box.
    expect(css).not.toMatch(/\n\.opts\s*\{/);
    expect(css).not.toMatch(/max-height:\s*38vh/);
  });
});

// D-6325, fix round 1 part B (decision `the-ask-holds-through-a-reconnect`): the ask holds through a reconnect, read-only
// (F2), and an ask that ends closes with the sheet's exit (F3). These drive the drop the way production does: a store
// that `connect()`s through a scripted socket, the socket's own close event for the drop, and the page's `online` event
// (`ReconnectingSocket.nudge`, which skips the backoff wait) for the reconnect, so `onState` and `onOpen` are the real ones.
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

const RECONNECTING = 'Reconnecting. Nothing can be sent until the session is back.';

describe('the ask holds through a reconnect, and an ask that ends closes with its exit (D-6325)', () => {
  /** The sockets of the store the case built, in the order its `makeSocket` made them: each store keeps its own list, so
   *  the current socket never depends on which store's `online` listener ran first. */
  let sockets: ScriptedSocket[] = [];
  const lastScripted = (): ScriptedSocket => sockets[sockets.length - 1]!;
  /** The stores `connected()` built: disconnected after each case, so no `online` listener or presence heartbeat outlives it. */
  const built: SessionStore[] = [];
  afterEach(() => {
    act(() => {
      for (const store of built.splice(0)) store.getState().disconnect();
    });
  });

  /** A connected store that has received `fx`'s frames on its first connection. */
  function connected(fx: AskFixture): SessionStore {
    sockets = [];
    const mine = sockets;
    const store = createSessionStore(ID, {
      makeSocket: (url) => new ScriptedSocket(url, mine) as unknown as WebSocket,
      api: { prompt: vi.fn().mockResolvedValue(undefined) },
    });
    built.push(store);
    act(() => {
      store.getState().connect();
      lastScripted().open();
      for (const frame of fx.frames) store.getState().apply(frame);
    });
    expect(store.getState().askFrameSeen).toBe(fx.askFrameSeen);
    return store;
  }
  /** The socket drops. */
  const drop = (): void => {
    act(() => lastScripted().drop());
  };
  /** The page reconnects at once and the new connection opens; it has said nothing yet. */
  const reconnect = (): void => {
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    act(() => lastScripted().open());
  };
  const panel = (): Element | null => document.querySelector('[role="dialog"]');
  const status = (): HTMLElement | null => screen.queryByRole('status');
  const mount = (store: SessionStore) =>
    render(<><DialogSheet id={ID} store={store} onOpenTerminal={vi.fn()} /><ToastHost /></>);

  // Every kind of surface: a question with Other open, a plan approval's menu, a permission prompt, the review, an
  // ask this screen cannot read and an unparsed pane. The gap ends with the new connection's first deciding frame.
  it.each([1, 4, 7, 8, 3, 5])(
    'a reconnect keeps the open ask on screen, read-only, until the new connection speaks: fixture %i',
    (n) => {
      const store = connected(askFixture(n));
      mount(store);
      const before = panel();
      expect(before).not.toBeNull();
      expect(status(), 'live: no status line').toBeNull();
      const title = screen.getAllByRole('heading')[0]!.textContent;

      drop();
      expect(panel(), 'the sheet vanished at the drop').toBe(before);
      expect(status()?.textContent).toBe(RECONNECTING);

      reconnect();
      // A dialog frame alone decides nothing: still the same sheet, still read-only.
      act(() => {
        const dialog = askFixture(n).dialog;
        if (dialog !== null) store.getState().apply({ type: 'dialog', dialog });
      });
      expect(panel(), 'the sheet vanished for the connect pipeline').toBe(before);
      expect(status()?.textContent).toBe(RECONNECTING);
      expect(screen.getAllByRole('heading')[0]!.textContent).toBe(title);

      // The new connection's first deciding frame: live again, the status line gone, the same drawer.
      act(() => {
        const fx = askFixture(n);
        store.getState().apply(fx.ask === null ? { type: 'ask_cleared' } : { type: 'ask', ask: fx.ask, key: 'ask-key-b' });
      });
      expect(status(), 'live again: the status line is gone').toBeNull();
      expect(panel()).toBe(before);
    },
  );

  it('a reconnect keeps the Other field\'s node, its text and its focus, and sends work again once the connection speaks', () => {
    const text = vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    const fx = askFixture(1);
    const store = connected(fx);
    mount(store);
    fireEvent.click(screen.getByRole('button', { name: /^Other/ }));
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Memcached' } });
    expect(document.activeElement).toBe(field);
    const before = panel();

    drop();
    reconnect();
    act(() => store.getState().apply({ type: 'dialog', dialog: fx.dialog! }));
    expect(panel()).toBe(before);
    expect(screen.getByRole('textbox'), 'the field was remounted').toBe(field);
    expect((field as HTMLInputElement).value).toBe('Memcached');
    expect(document.activeElement, 'the focus (a phone keyboard) was lost').toBe(field);
    expect(status()?.textContent).toBe(RECONNECTING);

    act(() => store.getState().apply({ type: 'ask', ask: fx.ask!, key: 'ask-key-b' }));
    expect(status()).toBeNull();
    expect(screen.getByRole('textbox')).toBe(field);
    expect(document.activeElement).toBe(field);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(text).toHaveBeenCalledWith(ID, 'dlg-a1', 4, 'Memcached');
  });

  it('a tap during the gap sends nothing', () => {
    const option = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const text = vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {}));
    const tab = vi.spyOn(api, 'answerDialogTab').mockReturnValue(new Promise(() => {}));
    const store = connected(askFixture(1));
    mount(store);
    fireEvent.click(screen.getByRole('button', { name: /^Other/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Memcached' } });

    drop();
    const state = store.getState();
    fireEvent.click(screen.getByRole('button', { name: /^In-process/ }));
    fireEvent.keyDown(screen.getByRole('button', { name: /^In-process/ }), { key: '2' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(screen.getByRole('button', { name: /^Talk it over in the chat instead/ }));
    expect(option).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(tab).not.toHaveBeenCalled();
    expect(store.getState(), 'a tap in the gap changed the store').toBe(state);

    // Hiding is not a send: the scrim and the close still work in the gap.
    reconnect();
    expect(option).not.toHaveBeenCalled();
  });

  // F3 of review 843: the gap is read-only in what it SHOWS, not only at the send. Every control that sends is disabled
  // (its own flag, not `locked`, which also refuses the dismissal); the Other field and its row are the operator's own
  // text and stay as they are, and a pick-several box is a local tick, not a send. The sheet still closes.
  it('in the gap every send control is disabled, the Other field is not, and the sheet still closes', () => {
    holdClosingContent();
    const button = (name: string | RegExp): HTMLElement => screen.getByRole('button', { name });

    // A question with Other open: its options, the Chat row, Send and the tab chips send; the field and its row do not.
    const one = connected(askFixture(1));
    mount(one);
    fireEvent.click(button(/^Other/));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Memcached' } });
    expect(button('Send'), 'live: Send is on').toBeEnabled();
    expect(button(/^In-process/)).toBeEnabled();
    drop();
    for (const name of [/^Redis/, /^In-process/, /^None/, /^Talk it over in the chat instead/, 'Send', /^Go to Tracing/]) {
      expect(button(name), `${String(name)} in the gap`).toBeDisabled();
    }
    expect(screen.getByRole('textbox'), 'the Other field in the gap').toBeEnabled();
    expect(button(/^Other/), 'the Other row in the gap').toBeEnabled();
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    expect(panel()?.getAttribute('data-state'), 'the scrim in the gap').toBe('closed');
    cleanup();

    // A menu that is no ask: every row.
    mount(connected(askFixture(4)));
    drop();
    for (const name of [/^Yes, and auto-accept edits/, /^Yes, and manually approve edits/, /^No, keep planning/]) {
      expect(button(name), `${String(name)} in the gap`).toBeDisabled();
    }
    cleanup();

    // A permission prompt whose menu matches: Allow and Deny.
    const approval: HookAsk = { approval: { tool: 'Bash', summary: 'rm -rf build/' } };
    const yesNo: Dialog = {
      id: 'dlg-allow', title: 'Do you want to proceed?', selectedIndex: 1, parsed: true, raw: '❯ 1. Yes',
      options: [{ index: 1, label: 'Yes' }, { index: 2, label: 'No' }],
    };
    mount(connected({
      ask: approval, dialog: yesNo, askFrameSeen: true,
      frames: [{ type: 'dialog', dialog: yesNo }, { type: 'ask', ask: approval, key: 'ask-key-p' }],
    }));
    expect(button('Allow'), 'live: Allow is on').toBeEnabled();
    expect(button('Deny')).toBeEnabled();
    drop();
    expect(button('Allow'), 'Allow in the gap').toBeDisabled();
    expect(button('Deny'), 'Deny in the gap').toBeDisabled();
    cleanup();

    // The review: Submit answers, Cancel and the tab chips.
    mount(connected(askFixture(8)));
    drop();
    for (const name of [/^Submit answers/, /^Cancel/, /^Go to Cache/]) {
      expect(button(name), `${String(name)} in the gap`).toBeDisabled();
    }
    cleanup();

    // A pick-several question: the boxes are a local tick, the commit is a send.
    const base = askFixture(9).dialog!;
    const dialog: Dialog = { ...base, multi: { ...base.multi!, commit: 'Submit' } };
    const ask = { questions: [{
      question: 'Which regions should it deploy to?', header: 'Regions', multiSelect: true,
      options: [{ label: 'North' }, { label: 'East' }, { label: 'South' }],
    }] };
    mount(connected({
      ask, dialog, askFrameSeen: true,
      frames: [{ type: 'dialog', dialog }, { type: 'ask', ask, key: 'ask-key-m' }],
    }));
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(button(/^(Next|Review answers)/), 'live: the commit is on once a box is ticked').toBeEnabled();
    drop();
    expect(button(/^(Next|Review answers)/), 'the commit in the gap').toBeDisabled();
    for (const box of screen.getAllByRole('checkbox')) expect(box, 'a box in the gap').toBeEnabled();
  });

  it('a permission prompt\'s Deny sends nothing in the gap', () => {
    const interrupt = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined as never);
    const store = connected(askFixture(7));
    mount(store);
    drop();
    fireEvent.click(screen.getByRole('button', { name: /^Deny/ }));
    expect(interrupt).not.toHaveBeenCalled();
  });

  // jsdom has no exit animation: this keeps the closed drawer mounted, as a browser's exit does (sheet-focus.test.tsx's device).
  const holdClosingContent = (): void => {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = real(el, pseudo);
      if (el.getAttribute('role') !== 'dialog') return style;
      return new Proxy(style, {
        get(target, key) {
          if (key === 'animationName') return el.getAttribute('data-state') === 'closed' ? 'sheet-out' : 'sheet-in';
          const v: unknown = Reflect.get(target, key, target);
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
    });
  };

  it('an ask that ends closes with the sheet\'s exit, its content held, its controls inert', () => {
    holdClosingContent();
    const store = connected(askFixture(1));
    mount(store);
    const before = panel();
    expect(before?.getAttribute('data-state')).toBe('open');

    act(() => {
      store.getState().apply({ type: 'ask_cleared' });
      store.getState().apply({ type: 'dialog_cleared' });
    });
    // Not unmounted at once: closed, holding the last question, inside an inert wrapper.
    expect(panel(), 'the drawer was unmounted instead of closing').toBe(before);
    expect(panel()?.getAttribute('data-state')).toBe('closed');
    expect(screen.getByRole('heading', { name: HOOK_QUESTIONS[0]!.question })).toBeInTheDocument();
    const inert = panel()!.querySelector('[inert]');
    expect(inert, 'nothing marks the held content inert').not.toBeNull();
    expect(inert!.contains(screen.getByRole('button', { name: /^In-process/ }))).toBe(true);
    expect(status(), 'a closed ask has no status line').toBeNull();

    // A later drop and reconnect does not open it again; a new live ask does, on the same drawer.
    drop();
    reconnect();
    expect(panel()?.getAttribute('data-state')).toBe('closed');
    act(() => store.getState().apply({ type: 'ask_cleared' }));
    expect(panel()?.getAttribute('data-state')).toBe('closed');
    const fx = askFixture(1);
    act(() => {
      store.getState().apply({ type: 'dialog', dialog: fx.dialog! });
      store.getState().apply({ type: 'ask', ask: fx.ask!, key: 'ask-key-c' });
    });
    expect(panel()?.getAttribute('data-state')).toBe('open');
    expect(panel()!.querySelector('[inert]')).toBeNull();
  });

  it('a reconnect whose first deciding frame is ask_cleared closes the sheet', () => {
    holdClosingContent();
    const store = connected(askFixture(1));
    mount(store);
    const before = panel();

    drop();
    reconnect();
    act(() => store.getState().apply({ type: 'dialog_cleared' }));
    expect(panel()?.getAttribute('data-state'), 'still held, not yet decided').toBe('open');
    act(() => store.getState().apply({ type: 'ask_cleared' }));
    expect(panel()).toBe(before);
    expect(panel()?.getAttribute('data-state')).toBe('closed');
    expect(screen.getByRole('heading', { name: HOOK_QUESTIONS[0]!.question })).toBeInTheDocument();
    expect(panel()!.querySelector('[inert]')).not.toBeNull();
    expect(status()).toBeNull();
  });

  // What the pane could paint on the new connection before its envelope arrives: the NEXT question of fixture 1's ask
  // (another id, other rows), or, for any other menu, the same menu repainted under another id with other words.
  const repainted = (n: number): Dialog => {
    const dialog = askFixture(n).dialog!;
    if (n === 1 || n === 8) {
      return {
        ...dialog, id: 'dlg-gap', selectedIndex: 2,
        options: [
          { index: 1, label: 'Yes' }, { index: 2, label: 'No' }, { index: 3, label: 'Type something.' },
          { index: 4, label: 'Chat about this' },
        ],
        raw: ['╭ pane chrome ╮', '←  ☒ Cache  ☐ Tracing  ☐ Regions  ✔ Submit  →', '  1. Yes', '  2. No', '  3. Type something.',
          '  4. Chat about this'].join('\n'),
      };
    }
    return { ...dialog, id: 'dlg-gap', title: 'Something else?', options: dialog.options.map((o) => ({ ...o, label: `Changed ${o.label}` })) };
  };
  const heldText = (): string => (panel()?.textContent ?? '').replace(RECONNECTING, '');

  it.each([1, 4, 8])(
    'a dialog frame in the gap, with another id and other rows, does not repaint the held surface: fixture %i',
    (n) => {
      const store = connected(askFixture(n));
      mount(store);
      const before = panel();
      const text = heldText();
      const heading = screen.getAllByRole('heading')[0]!.textContent;

      drop();
      reconnect();
      act(() => store.getState().apply({ type: 'dialog', dialog: repainted(n) }));
      expect(store.getState().dialog?.id, 'the store did take the new frame').toBe('dlg-gap');
      expect(panel()).toBe(before);
      expect(screen.getAllByRole('heading')[0]!.textContent, 'the question changed under the operator').toBe(heading);
      expect(heldText(), 'the held surface was repainted').toBe(text);
      expect(status()?.textContent).toBe(RECONNECTING);
    },
  );

  it('a dialog frame in the gap, with another id and other rows, leaves the Other field its node, its text and its focus', () => {
    const fx = askFixture(1);
    const store = connected(fx);
    mount(store);
    fireEvent.click(screen.getByRole('button', { name: /^Other/ }));
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Memcached' } });
    const heading = screen.getByRole('heading', { name: HOOK_QUESTIONS[0]!.question });
    const labels = [...document.querySelectorAll('.opt-label')].map((el) => el.textContent);

    drop();
    reconnect();
    act(() => store.getState().apply({ type: 'dialog', dialog: repainted(1) }));
    expect(screen.getByRole('heading', { name: HOOK_QUESTIONS[0]!.question })).toBe(heading);
    expect([...document.querySelectorAll('.opt-label')].map((el) => el.textContent)).toEqual(labels);
    expect(screen.getByRole('textbox'), 'the field was remounted').toBe(field);
    expect((field as HTMLInputElement).value).toBe('Memcached');
    expect(document.activeElement, 'the focus (a phone keyboard) was lost').toBe(field);

    // The deciding frame hands the surface to what the pane now shows: the next question, live.
    act(() => store.getState().apply({ type: 'ask', ask: fx.ask!, key: 'ask-key-b' }));
    expect(status()).toBeNull();
    expect(screen.getByRole('heading', { name: HOOK_QUESTIONS[1]!.question })).toBeInTheDocument();
  });

  it('hiding the sheet works in the gap, makes no call, and the hidden sheet stays hidden when the connection speaks', () => {
    holdClosingContent();
    const calls = [
      vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {})),
      vi.spyOn(api, 'answerDialogText').mockReturnValue(new Promise(() => {})),
      vi.spyOn(api, 'interrupt').mockResolvedValue(undefined as never),
    ];
    const fx = askFixture(1);
    const store = connected(fx);
    mount(store);
    const before = panel();
    expect(before?.getAttribute('data-state')).toBe('open');

    drop();
    fireEvent.keyDown(document.activeElement ?? before!, { key: 'Escape' });
    expect(panel(), 'the sheet is kept mounted for its exit').toBe(before);
    expect(panel()?.getAttribute('data-state'), 'Escape hides the held sheet in the gap').toBe('closed');
    for (const call of calls) expect(call).not.toHaveBeenCalled();

    // The same ask comes back live: a dismissal applies as it always did.
    reconnect();
    act(() => store.getState().apply({ type: 'dialog', dialog: fx.dialog! }));
    act(() => store.getState().apply({ type: 'ask', ask: fx.ask!, key: 'ask-key-b' }));
    expect(status()).toBeNull();
    expect(panel()?.getAttribute('data-state')).toBe('closed');
  });

  it('a tab move, a pick-several commit and the review\'s Submit send nothing in the gap', () => {
    const answer = vi.spyOn(api, 'answerDialog').mockReturnValue(new Promise(() => {}));
    const tab = vi.spyOn(api, 'answerDialogTab').mockReturnValue(new Promise(() => {}));
    const multi = vi.spyOn(api, 'answerDialogMulti').mockReturnValue(new Promise(() => {}));

    // A multi-tab question (fixture 1): the strip's chip and the arrow key.
    const one = connected(askFixture(1));
    mount(one);
    drop();
    fireEvent.click(screen.getByRole('button', { name: /^Go to Tracing/ }));
    fireEvent.keyDown(screen.getByRole('button', { name: /^In-process/ }), { key: 'ArrowRight' });
    expect(tab).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    cleanup();

    // A pick-several question: a box ticked in the gap is local, its commit is a send.
    const base = askFixture(9).dialog!;
    const dialog: Dialog = { ...base, multi: { ...base.multi!, commit: 'Submit' } };
    const ask = { questions: [{
      question: 'Which regions should it deploy to?', header: 'Regions', multiSelect: true,
      options: [{ label: 'North' }, { label: 'East' }, { label: 'South' }],
    }] };
    const picks = connected({
      ask, dialog, askFrameSeen: true,
      frames: [{ type: 'dialog', dialog }, { type: 'ask', ask, key: 'ask-key-m' }],
    });
    mount(picks);
    drop();
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /^(Next|Review answers)/ }));
    expect(multi).not.toHaveBeenCalled();
    cleanup();

    // The review: Submit answers and Cancel.
    const review = connected(askFixture(8));
    mount(review);
    drop();
    fireEvent.click(screen.getByRole('button', { name: /^Submit answers/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel/ }));
    expect(answer).not.toHaveBeenCalled();
    expect(tab).not.toHaveBeenCalled();
    expect(multi).not.toHaveBeenCalled();
  });

  // A pane menu's id is a hash of its labels and title, so the SAME menu asked again has the SAME id. The in-flight marker
  // of the answered one must not outlive its ask: it ends with the surface, whose closing content is still mounted for
  // its exit (what a browser does; jsdom has no animation, so `holdClosingContent`), or the menu that comes back opens
  // `answering…`, every row disabled and Escape refused, until a menu with another id arrives.
  it('the same menu asked again after an answered ask opens free: no in-flight marker, rows enabled, Escape hides it', async () => {
    holdClosingContent();
    const answer = vi.spyOn(api, 'answerDialog').mockResolvedValue({ next: null } as never);
    const fx = askFixture(4);
    const store = connected(fx);
    mount(store);
    const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.opts button')];
    expect(rows()).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: /^Yes, and auto-accept edits/ }));
    await act(async () => { await Promise.resolve(); });
    expect(answer).toHaveBeenCalledTimes(1);
    // The route said the pane moved on (`next: null`): the dialog is gone; the ask ends.
    act(() => {
      store.getState().apply({ type: 'dialog_cleared' });
      store.getState().apply({ type: 'ask_cleared' });
    });
    expect(panel()?.getAttribute('data-state')).toBe('closed');

    // The same menu again: the same id, a new ask.
    act(() => {
      for (const frame of fx.frames) store.getState().apply(frame);
    });
    expect(store.getState().dialog?.id).toBe(fx.dialog!.id);
    expect(panel()?.getAttribute('data-state')).toBe('open');
    expect(screen.queryByText('answering…'), 'the old marker survived the ask').toBeNull();
    expect(rows().map((r) => (r as HTMLButtonElement).disabled), 'rows locked by a send that ended').toEqual([false, false, false]);
    fireEvent.keyDown(document.activeElement ?? panel()!, { key: 'Escape' });
    expect(panel()?.getAttribute('data-state'), 'Escape was refused').toBe('closed');
  });

  // The own-words call and the pick commit are in-flight markers of the same kind (`landed`: the send was accepted and the
  // sheet stays busy until the pane moves on). When the route answers without a `next`, nothing clears them but the ask
  // ending, and the same screen coming back must not find them still set.
  it('own words sent before an ask ended do not lock the same question asked again', async () => {
    holdClosingContent();
    const send = vi.spyOn(api, 'answerDialogText').mockResolvedValue({} as never);
    const fx = askFixture(1);
    const store = connected(fx);
    mount(store);
    fireEvent.click(screen.getByRole('button', { name: /^Other/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Memcached' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => { await Promise.resolve(); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /^In-process/ }), 'a landed send holds the sheet busy').toBeDisabled();
    // The pane echoes the typed words in the free-text row (typing changes the screen's id): the held surface now shows the
    // very row the send typed, so only the ask ending, not a pane that moved on, can release it.
    const typed: Dialog = {
      ...fx.dialog!, id: 'dlg-typed', options: fx.dialog!.options.map((o) => (o.index === 4 ? { ...o, label: 'Memcached' } : o)),
    };
    act(() => store.getState().apply({ type: 'dialog', dialog: typed }));
    expect(screen.getByRole('button', { name: /^In-process/ })).toBeDisabled();

    act(() => {
      store.getState().apply({ type: 'ask_cleared' });
      store.getState().apply({ type: 'dialog_cleared' });
    });
    act(() => {
      store.getState().apply({ type: 'dialog', dialog: typed });
      store.getState().apply({ type: 'ask', ask: fx.ask!, key: 'ask-key-next' });
    });
    expect(panel()?.getAttribute('data-state')).toBe('open');
    expect(screen.getByRole('button', { name: /^In-process/ }), 'rows locked by a send that ended').toBeEnabled();
    expect(screen.queryByRole('textbox'), 'the sent words came back').toBeNull();
  });

  it('a pick commit sent before an ask ended does not lock the same question asked again', async () => {
    holdClosingContent();
    const commit = vi.spyOn(api, 'answerDialogMulti').mockResolvedValue({} as never);
    const base = askFixture(9).dialog!;
    const dialog: Dialog = { ...base, multi: { ...base.multi!, commit: 'Submit' } };
    const ask = { questions: [{
      question: 'Which regions should it deploy to?', header: 'Regions', multiSelect: true,
      options: [{ label: 'North' }, { label: 'East' }, { label: 'South' }],
    }] };
    const frames: AskFixture['frames'] = [{ type: 'dialog', dialog }, { type: 'ask', ask, key: 'ask-key-m' }];
    const store = connected({ ask, dialog, askFrameSeen: true, frames });
    mount(store);
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /^(Next|Review answers)/ }));
    await act(async () => { await Promise.resolve(); });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('checkbox')[0], 'a landed commit holds the sheet busy').toBeDisabled();

    act(() => {
      store.getState().apply({ type: 'ask_cleared' });
      store.getState().apply({ type: 'dialog_cleared' });
    });
    act(() => {
      for (const frame of frames) store.getState().apply(frame);
    });
    expect(panel()?.getAttribute('data-state')).toBe('open');
    expect(screen.getAllByRole('checkbox')[0], 'boxes locked by a commit that ended').toBeEnabled();
  });

  // The reset above belongs to the ask ENDING, not to the socket: an answer still landing when the connection drops is
  // still landing after it (the pane has not moved on, and nothing has said it did), so the gap and the same ask coming
  // back keep the marker, the disabled rows and the refused dismissal. Releasing them would let a second answer go
  // while the first is still being typed into the pane.
  it.each([
    ['in flight', () => new Promise<never>(() => {})],
    ['accepted but not yet moved on', () => Promise.resolve({} as never)],
  ])('a gap keeps an answer %s: the marker, the disabled rows and the refused dismissal, through the reconnect', async (_name, reply) => {
    holdClosingContent();
    const answer = vi.spyOn(api, 'answerDialog').mockImplementation(reply);
    const fx = askFixture(4);
    const store = connected(fx);
    mount(store);
    const rows = (): boolean[] => [...document.querySelectorAll<HTMLButtonElement>('.opts button')].map((r) => r.disabled);
    const held = (when: string): void => {
      expect(screen.getByText('answering…'), `the marker at ${when}`).toBeInTheDocument();
      expect(rows(), `rows at ${when}`).toEqual([true, true, true]);
      fireEvent.keyDown(document.activeElement ?? panel()!, { key: 'Escape' });
      expect(panel()?.getAttribute('data-state'), `Escape at ${when} was not refused`).toBe('open');
    };

    fireEvent.click(screen.getByRole('button', { name: /^Yes, and auto-accept edits/ }));
    await act(async () => { await Promise.resolve(); });
    expect(answer).toHaveBeenCalledTimes(1);
    held('the tap');

    drop();
    held('the drop');
    reconnect();
    held('the reconnect');
    act(() => {
      for (const frame of fx.frames) store.getState().apply(frame);
    });
    expect(status(), 'the same ask is live again').toBeNull();
    held('the same ask arriving again');
    expect(answer).toHaveBeenCalledTimes(1);
  });
});
