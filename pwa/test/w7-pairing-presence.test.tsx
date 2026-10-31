// Where a pairing is present, and what the sheet does where it is not (D-7213; Task C7a Step 5; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 6; ARCH-58). A pairing and `askSource`'s answer are
// not one-to-one on two classes of row, both rendered here through `DialogSheet` and pinned before C7f reads the wire:
//   - THE ENVELOPE BEFORE THE MENU: a hook question envelope with `dialog` null (the hook-before-pane window at the start
//     of every AskUserQuestion). `askSource` answers `structured` `from: 'hook'`, and the sheet shows question 1
//     read-only: `live`, `named` and `placed` null, `shown` 0, `askScreen` null. It is the constant unplaced view, not
//     the unpaired one;
//   - THE REVIEW SCREEN'S DISMISSAL KEY (`CACHING_TRACING` × `cc300-ask-review-same-labels`): `askSource` answers
//     `review`, which has no `from`, but the sheet needs the review's pairing because `screenNow = askScreen(envelope,
//     dialog)` is the review screen's dismissal key: dismissed on the review it stays hidden there, and re-shows on a
//     question screen.
// C7f (D-7184): the sheet reads the wire's `pairing`. The review row's frames gain the hook's pairing from Q3a's recorded
// table (`corpus.json`, `wirePairing.ts#tablePairing`), on the frames the server pairs (the `ask` frame against the
// dialog sent before it, and each later `dialog` frame against the envelope); the no-pane row gains none, since no
// server pairs without a dialog. The constant unplaced view is `DialogSheet`'s own (`UNPLACED_VIEW`). No `expect` changes.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import type { AskPairing, Dialog } from '../../shared/api';
import { askSource } from '../src/session/askLive';
import { DialogSheet, UNPLACED_VIEW } from '../src/session/DialogSheet';
import { createSessionStore } from '../src/stores/session';
import { spyApiAnswer } from './answerSeam';
import { CACHING_TRACING, pane, type AskEnvelope } from './askPanes';
import { tablePairing, wirePairing } from './wirePairing';

const SESSION_ID = 'lane-a:project-a';
const fakeSocket = (): WebSocket => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;

/** `pairing`: the wire's pairing on the `ask` frame (the server pairs it against the dialog sent before it), or none. */
const mount = (envelope: AskEnvelope, dialog: Dialog | null, pairing: AskPairing | null = null) => {
  const store = createSessionStore(SESSION_ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
  act(() => {
    store.getState().apply({ type: 'ask_cleared' });
    if (dialog !== null) store.getState().apply({ type: 'dialog', dialog });
    store.getState().apply(pairing === null ? { type: 'ask', ask: envelope, key: null } : { type: 'ask', ask: envelope, key: null, pairing });
  });
  render(<><DialogSheet id={SESSION_ID} store={store} onOpenTerminal={vi.fn()} /><ToastHost /></>);
  return store;
};
const dismiss = async (): Promise<void> => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  await act(async () => {});
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the envelope before the menu (a hook question envelope, dialog null)', () => {
  it('askSource answers structured from the hook, and the pairing is the constant unplaced one', () => {
    expect(askSource({ ask: CACHING_TRACING, dialog: null, askFrameSeen: true })).toEqual({ kind: 'structured', questions: CACHING_TRACING.questions, from: 'hook' });
    expect(UNPLACED_VIEW).toEqual({ live: null, named: null, shown: 0, placed: null });
    expect(wirePairing(CACHING_TRACING, null)?.screen ?? null).toBeNull();
  });

  it('the sheet shows question 1, read-only: its words, no row a tap answers, and not the unpaired view', () => {
    const answer = spyApiAnswer('answerDialog').mockReturnValue(new Promise(() => {}));
    mount(CACHING_TRACING, null);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Question 1 is the sheet's title (question 2 is listed below it, as the envelope's next question).
    expect(document.querySelector('.sheet-title')?.textContent).toBe('Enable caching?');
    // Read-only: every option row the sheet draws is inert, so a tap sends nothing.
    for (const row of document.querySelectorAll<HTMLElement>('.opts > .opt')) fireEvent.click(row);
    expect(answer).not.toHaveBeenCalled();
    // Not the unpaired view: the hook's own rows for question 1 are drawn (read-only), not a bare terminal door.
    expect([...document.querySelectorAll('.opts > .opt .opt-label')].map((e) => e.textContent).slice(0, 2)).toEqual(['Yes', 'No']);
  });
});

describe('the review screen\'s dismissal key (CACHING_TRACING × cc300-ask-review-same-labels)', () => {
  const review = (): Dialog => pane('cc300-ask-review-same-labels');
  const q1 = (): Dialog => pane('cc300-ask-same-labels-q1');
  const reviewPairing = (): AskPairing => tablePairing('cc300-ask-review-same-labels', 'CACHING_TRACING');
  const q1Pairing = (): AskPairing => tablePairing('cc300-ask-same-labels-q1', 'CACHING_TRACING');

  it('askSource answers review (no from), and the pairing names the review screen', () => {
    expect(askSource({ ask: CACHING_TRACING, dialog: review(), askFrameSeen: true }).kind).toBe('review');
    expect(reviewPairing().screen).toBe('review');
  });

  it('dismissed on the review it stays hidden there, and re-shows on a question screen', async () => {
    const store = mount(CACHING_TRACING, review(), reviewPairing());
    expect(screen.getByRole('button', { name: /^Submit answers/ })).toBeInTheDocument();
    await dismiss();
    expect(screen.queryByRole('dialog')).toBeNull();
    // The same review screen repainted under a new id: the dismissal key is the screen, so it stays hidden.
    act(() => store.getState().apply({ type: 'dialog', dialog: { ...review(), id: 'review-repaint-1' }, pairing: reviewPairing() }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // A question screen is another screen: the sheet re-shows.
    act(() => store.getState().apply({ type: 'dialog', dialog: q1(), pairing: q1Pairing() }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('the other way round: dismissed on question 1, the review is another screen and re-shows it (it is keyed, not unplaced)', async () => {
    const store = mount(CACHING_TRACING, q1(), q1Pairing());
    await dismiss();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => store.getState().apply({ type: 'dialog', dialog: review(), pairing: reviewPairing() }));
    expect(screen.getByRole('button', { name: /^Submit answers/ })).toBeInTheDocument();
  });
});
