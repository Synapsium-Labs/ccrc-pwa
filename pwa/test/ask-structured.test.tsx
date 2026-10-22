// D-6325 (plan docs/superpowers/plans/2026-10-22-desktop-polish.md, Task T1b, S2): every ask surface renders from
// `askSource`, so no string the pane painted reaches an AskUserQuestion, and each surface says who asks.
//
// The inputs are the plan's ask fixtures (`askFixtures.ts`), whose every pane field is debris (`ASK_DEBRIS`): a case
// asserts the debris is ABSENT from the DOM and, beside it, that what the surface does show is PRESENT (the transcript's
// question, the can't-read sentence with its way to the terminal, the review's fixed words). The answer path is the
// one it always was: a tap answers through `/dialog` with the dialog's id and the printed index.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Dialog, FleetSession } from '../../shared/api';
import { ToastHost } from '@ccrc/ui';
import { api } from '../src/lib/api';
import { DialogSheet } from '../src/session/DialogSheet';
import { heldAskLine } from '../src/session/askWords';
import { SessionScreen } from '../src/screens/SessionScreen';
import { createFleetStore } from '../src/stores/fleet';
import { createSessionStore, type SessionStore } from '../src/stores/session';
import {
  ASKER_COORD, ASKER_PROJECT, ASKER_SESSION, ASK_DEBRIS, HOOK_QUESTIONS, askFixture, type AskFixture,
} from './askFixtures';
import { fleetSession } from './fleetFixture';

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

describe('no pane text on an AskUserQuestion (D-6325)', () => {
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

  it('fixture 2 (aged): the transcript\'s question, every label and every description', () => {
    renderSheet(2);
    expect(screen.getByRole('heading', { name: HOOK_QUESTIONS[0]!.question })).toBeInTheDocument();
    for (const o of HOOK_QUESTIONS[0]!.options) {
      expect(screen.getByText(o.label)).toBeInTheDocument();
      expect(screen.getByText(o.description!)).toBeInTheDocument();
    }
    expect(document.querySelector('[data-source="transcript"]')).not.toBeNull();
  });

  it.each([3, 9, 10])('fixture %i (unreadable): the can\'t-read sentence, the terminal door, no row to tap', (n) => {
    const { onOpenTerminal } = renderSheet(n);
    expect(screen.getByRole('heading', { name: CANT_READ })).toBeInTheDocument();
    expect(document.querySelectorAll('.opt')).toHaveLength(0);
    expect(screen.queryByLabelText('Answer in your own words')).toBeNull();
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
