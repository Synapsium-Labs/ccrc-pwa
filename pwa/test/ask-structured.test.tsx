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
import type { ChatEvent, Dialog, FleetSession } from '../../shared/api';
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
