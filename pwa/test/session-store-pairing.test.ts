// The session store keeps the server's pairing, and the sheet reads it (W7 Task C7f, D-7184, D-7206, D-7211, D-7213,
// D-7220; ARCH-58's PWA half; plan docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, Task C7f, Step 3).
//
// ONE RULE, the server's own (`server/src/sessionws.ts#paired`): the store holds one `pairing`; every `ask`, `dialog`
// and `ask_cleared` frame replaces it with its own, a frame without the field clearing it; `dialog_cleared` and the
// socket leaving `open` clear it; and `applyAnswered`, the one writer that is not a frame, clears it with the dialog it
// writes (D-7220). The rows below are the plan's (i) to (x), each driven through the store's own frame reader (`apply`)
// and, where it says what the operator sees, through `DialogSheet` itself:
//  - the frames carry pairings from the recorded tables (`wirePairing.ts`: Q3a's `corpus.json`, C7q's
//    `transcript-corpus.json`), or the server's rule where no table holds the state (D-7363);
//  - row (vi) and the D-7220 rows replay C7q's `transcript-sequences.json` frame by frame in the server's order, never a
//    hand-set store state (D-7211); a call site the recorded sequence (e) has no screen for (own words, a multiSelect
//    commit) replays the same shape over recorded screens, paired by the server's rule.
//  - THE NAMED BEHAVIOUR ROWS: the skew rows (a dialog with no pairing is the unpaired view, the terminal door; a pairing
//    from the other source is no pairing) and (ix)/(x) (an answer's reply ahead of its `dialog` frame shows the next
//    screen's unpaired view until the frame lands). Rows (vii) and (viii) are guards: green before C7f and after.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import type { AskPairing, Dialog, DialogAnswered, HookAsk, SessionStreamMsg } from '../../shared/api';
import { askSource } from '../src/session/askLive';
import { DialogSheet } from '../src/session/DialogSheet';
import { createSessionStore, type SessionStore } from '../src/stores/session';
import { answerSeam, type AnswerSeamMocks } from './answerSeam';
import { CACHING_TRACING, DRINK_FEATURES_TOOLS, pane } from './askPanes';
import { recordedPairing, tablePairing, wirePairing } from './wirePairing';

const SESSION_ID = 'lane-a:project-a';

// ─── C7q's recorded frame sequences ────────────────────────────────────────────────────────────────────────────────

interface Sent { step: number; frame: SessionStreamMsg; conn?: number }
interface Recorded { frames: Sent[]; replies: { step: number; body: { ok: true; next: Dialog | null } }[] }
const SEQUENCES = JSON.parse(readFileSync(
  path.join(import.meta.dirname, '..', '..', 'server', 'test', 'fixtures', 'ask-pairing', 'transcript-sequences.json'), 'utf8',
)) as Record<string, Recorded>;
const sequence = (name: string): Recorded => {
  const s = SEQUENCES[name];
  if (s === undefined) throw new Error(`transcript-sequences.json has no sequence ${name}`);
  return s;
};
const pairingOn = (f: SessionStreamMsg): AskPairing | null => (f as { pairing?: AskPairing }).pairing ?? null;

// ─── the store and its socket ──────────────────────────────────────────────────────────────────────────────────────

/** A scripted socket (`stores.test.ts`'s): `open`, `drop` and nothing else. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  readonly url: string;
  constructor(url: string) { this.url = url; FakeSocket.instances.push(this); }
  close(): void {}
  open(): void { this.onopen?.(new Event('open')); }
  drop(): void { this.onclose?.(new Event('close') as CloseEvent); }
}
const lastSocket = (): FakeSocket => FakeSocket.instances[FakeSocket.instances.length - 1]!;
const makeSocket = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;

/** A store over a scripted socket. Not `served`: every frame here carries exactly the pairing the row hands it. */
const makeStore = (): SessionStore => createSessionStore(SESSION_ID, { makeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
const apply = (store: SessionStore, ...frames: SessionStreamMsg[]): void => {
  act(() => { for (const f of frames) store.getState().apply(f); });
};

/** Connect `store` and open its socket, so a drop and a reconnect run through the socket's own events. */
function connect(store: SessionStore): void {
  store.getState().connect();
  lastSocket().open();
}
/** The socket drops and the store's own backoff opens the next one (fake timers, as `stores.test.ts` drives it). */
function reconnect(): void {
  const first = lastSocket();
  first.drop();
  vi.advanceTimersByTime(60_000);
  expect(lastSocket()).not.toBe(first);
  lastSocket().open();
}

/** Replay a recorded sequence's frames through `store.apply` in the server's order, a reconnect where the connection
 *  changes. `upTo`: only the frames sent on steps up to it. */
function replay(store: SessionStore, frames: readonly Sent[], upTo = Infinity): void {
  let conn = 0;
  for (const s of frames) {
    if (s.step > upTo) break;
    if ((s.conn ?? 0) !== conn) { conn = s.conn ?? 0; reconnect(); }
    apply(store, s.frame);
  }
}

// ─── the sheet ─────────────────────────────────────────────────────────────────────────────────────────────────────

let answers: AnswerSeamMocks = answerSeam();
const mount = (store: SessionStore): void => {
  render(createElement('div', null,
    createElement(DialogSheet, { answers, id: SESSION_ID, store, onOpenTerminal: vi.fn() }),
    createElement(ToastHost)));
};
const title = (): string | null => document.querySelector('.sheet-title')?.textContent ?? null;
const rows = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.opts > .opt')];
/** The option row whose label is `label`. */
const row = (label: string): HTMLButtonElement => {
  const r = rows().find((b) => b.querySelector('.opt-label')?.textContent === label);
  if (r === undefined) throw new Error(`no option row ${label}`);
  return r;
};
const UNREADABLE = "Claude is asking a question this screen can't read yet.";
const CTA = 'Open terminal to answer';
/** The unpaired view (D-7184): the terminal door, the question's words and rows absent, nothing to tap. */
function expectUnpaired(why: string): void {
  expect(title(), why).toBe(UNREADABLE);
  expect(screen.getByRole('button', { name: CTA }), why).toBeInTheDocument();
  expect(rows(), `${why}: no option rows`).toEqual([]);
  expect(screen.queryAllByRole('checkbox'), `${why}: no boxes`).toEqual([]);
}
/** Every write the seam carries, counted: a tap that sends nothing leaves it as it was. */
const sends = (): number => Object.values(answers).reduce((n, m) => n + m.mock.calls.length, 0);
/** Click every control the sheet draws but the terminal door; none may send. */
function tapEverything(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')) {
    if (b.textContent?.includes(CTA) === true || b.textContent?.includes('Not now') === true) continue;
    fireEvent.click(b);
  }
}
const deferred = () => {
  let land!: (v: DialogAnswered) => void;
  const promise = new Promise<DialogAnswered>((r) => { land = r; });
  return { promise, land };
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  answers = answerSeam();
  FakeSocket.instances = [];
});

// The recorded screens and their recorded pairings (Q3a's table).
const Q1 = (): Dialog => pane('cc300-ask-same-labels-q1');
const Q2 = (): Dialog => pane('cc300-ask-same-labels-q2');
const REVIEW = (): Dialog => pane('cc300-ask-review-same-labels');
const P1 = (): AskPairing => tablePairing('cc300-ask-same-labels-q1', 'CACHING_TRACING');
const P2 = (): AskPairing => tablePairing('cc300-ask-same-labels-q2', 'CACHING_TRACING');
const ASK: HookAsk = CACHING_TRACING;
/** The transcript's copy of `CACHING_TRACING`'s question `i` on `dialog`, every row aligned (`w7-transcript-pairing`). */
const copied = (dialog: Dialog, i: number): Dialog => {
  const q = CACHING_TRACING.questions[i]!;
  return { ...dialog, ask: { question: q.question, header: q.header, multiSelect: false, options: q.options.map((o) => ({ ...o })) } };
};
const P3 = (): AskPairing => recordedPairing('transcript: CACHING_TRACING.q2 on cc300-ask-same-labels-q2, no envelope')!;

// ─── the store's rule ──────────────────────────────────────────────────────────────────────────────────────────────

describe('the store holds one pairing, the last frame\'s (D-7184)', () => {
  it('(i) an ask frame with P1, then a dialog frame with P2: the store holds P2 and the sheet answers P2\'s question', () => {
    const store = makeStore();
    apply(store, { type: 'dialog', dialog: Q1() }, { type: 'ask', ask: ASK, key: null, pairing: P1() });
    expect(store.getState().pairing).toEqual(P1());
    apply(store, { type: 'dialog', dialog: Q2(), pairing: P2() });
    expect(store.getState().pairing).toEqual(P2());
    answers.answerDialog.mockReturnValue(new Promise(() => {}));
    mount(store);
    expect(title()).toBe('Enable tracing?');
    fireEvent.click(rows()[0]!);
    expect(answers.answerDialog).toHaveBeenCalledWith(SESSION_ID, Q2().id, 1);
  });

  it('(ii) an ask frame with P1, then a dialog frame with no pairing: none, and the sheet shows the unpaired view, never P1', () => {
    const store = makeStore();
    apply(store, { type: 'dialog', dialog: Q1() }, { type: 'ask', ask: ASK, key: null, pairing: P1() });
    apply(store, { type: 'dialog', dialog: Q2() });
    expect(store.getState().pairing).toBeNull();
    mount(store);
    expectUnpaired('question 2 with no pairing');
    tapEverything();
    expect(sends()).toBe(0);
  });

  it('(iii) P1, then ask_cleared with no pairing, or dialog_cleared: none', () => {
    const a = makeStore();
    apply(a, { type: 'dialog', dialog: Q1() }, { type: 'ask', ask: ASK, key: null, pairing: P1() }, { type: 'ask_cleared' });
    expect(a.getState().pairing).toBeNull();
    const b = makeStore();
    apply(b, { type: 'dialog', dialog: Q1() }, { type: 'ask', ask: ASK, key: null, pairing: P1() }, { type: 'dialog_cleared' });
    expect(b.getState().pairing).toBeNull();
  });

  it('(iii-b) P1, then ask_cleared carrying the copy\'s pairing P4 (from transcript): the store holds P4', () => {
    const store = makeStore();
    const P4 = recordedPairing('transcript: CACHING_TRACING.q1 on cc300-ask-same-labels-q1, no envelope')!;
    expect(P4.from).toBe('transcript');
    apply(store, { type: 'dialog', dialog: copied(Q1(), 0) }, { type: 'ask', ask: ASK, key: null, pairing: P1() });
    apply(store, { type: 'ask_cleared', pairing: P4 });
    expect(store.getState().pairing).toEqual(P4);
  });

  it('(iv) P1, then the socket reopens before any frame: none', () => {
    vi.useFakeTimers();
    const store = makeStore();
    connect(store);
    apply(store, { type: 'dialog', dialog: Q1() }, { type: 'ask', ask: ASK, key: null, pairing: P1() });
    expect(store.getState().pairing).toEqual(P1());
    const first = lastSocket();
    first.drop();
    expect(store.getState().pairing, 'the drop itself').toBeNull();
    vi.advanceTimersByTime(60_000);
    lastSocket().open();
    expect(store.getState().pairing, 'the new connection, before its first frame').toBeNull();
    store.getState().disconnect();
  });

  it('(v) a dialog frame carrying the transcript\'s copy and P3, no envelope: the copy\'s question, placed by P3, answered at P3\'s index', () => {
    const store = makeStore();
    apply(store, { type: 'ask_cleared' }, { type: 'dialog', dialog: copied(Q2(), 1), pairing: P3() });
    // `w7-transcript-pairing.test.ts`'s row for it: `CACHING_TRACING.q2 on cc300-ask-same-labels-q2: live 0 named 0
    // placed 0 shown 0 | question shown | tap 1`.
    expect(store.getState().pairing).toMatchObject({ live: 0, named: 0, placed: 0, shown: 0, from: 'transcript' });
    answers.answerDialog.mockReturnValue(new Promise(() => {}));
    mount(store);
    expect(title()).toBe('Enable tracing?');
    fireEvent.click(rows()[0]!);
    expect(answers.answerDialog).toHaveBeenCalledWith(SESSION_ID, Q2().id, 1);
  });
});

// ─── (vi) the recorded frame sequences ─────────────────────────────────────────────────────────────────────────────

describe('(vi) C7q\'s frame sequences, replayed through the store in the server\'s order (D-7211)', () => {
  // Each ends paired from the copy, as today's client paired the same end state (`w7-transcript-pairing.test.ts`'s row
  // `COLOUR_ONE.q1 on cc300-ask-1q-open: live 0 named 0 placed 0 shown 0 | question shown | tap 1`), except the reconnect
  // with an envelope (the hook's pairing, `from` absent) and (d), unpaired as today.
  const ENDS: readonly [string, 'transcript' | 'hook' | 'unpaired'][] = [
    ['(a) connect with a copy and no envelope', 'transcript'],
    ['(a) connect with a blank envelope and a copy', 'transcript'],
    ['(b) an envelope ageing out under a standing menu', 'transcript'],
    ['(c) a reconnect mid-ask, with an envelope', 'hook'],
    ['(c) a reconnect mid-ask, without an envelope', 'transcript'],
    ['(d) a menu with no readable copy, then the envelope clearing', 'unpaired'],
  ];
  it.each(ENDS)('%s', (name, end) => {
    vi.useFakeTimers();
    const store = makeStore();
    connect(store);
    const { frames } = sequence(name);
    replay(store, frames);
    vi.useRealTimers();
    const last = frames.at(-1)!.frame;
    expect(store.getState().pairing, 'the store holds the last frame\'s pairing').toEqual(pairingOn(last));
    const { ask, dialog, askFrameSeen } = store.getState();
    const src = askSource({ ask, dialog, askFrameSeen });
    answers.answerDialog.mockReturnValue(new Promise(() => {}));
    mount(store);
    if (end === 'unpaired') {
      expect(src.kind).toBe('ask-unreadable');
      expect(store.getState().pairing).toBeNull();
      expectUnpaired(name);
      return;
    }
    expect(src).toMatchObject({ kind: 'structured', from: end });
    expect(store.getState().pairing).toMatchObject({ live: 0, named: 0, placed: 0, shown: 0, screen: 'q0' });
    expect((store.getState().pairing?.from ?? 'hook')).toBe(end);
    expect(title()).toBe('Which colour?');
    fireEvent.click(rows()[0]!);
    expect(answers.answerDialog).toHaveBeenCalledWith(SESSION_ID, dialog!.id, 1);
    store.getState().disconnect();
  });
});

// ─── (vii), (viii): the two cases that are not the unpaired view (D-7213), guards ──────────────────────────────────

describe('(vii) the envelope before the menu: the constant unplaced view (D-7213)', () => {
  it('an ask frame with a question envelope and no pairing, no dialog yet: question 1 read-only, shown 0, screen null', () => {
    const store = makeStore();
    apply(store, { type: 'ask_cleared' }, { type: 'ask', ask: ASK, key: null });
    expect(store.getState().pairing ?? null).toBeNull();
    mount(store);
    // `w7-pairing-presence.test.tsx`'s row: question 1's words and its rows, read-only; not the terminal door alone.
    expect(title()).toBe('Enable caching?');
    expect(rows().slice(0, 2).map((r) => r.querySelector('.opt-label')?.textContent)).toEqual(['Yes', 'No']);
    for (const r of rows()) fireEvent.click(r);
    expect(sends()).toBe(0);
  });
});

describe('(viii) the review screen\'s dismissal key is the pairing\'s screen (D-7213)', () => {
  it('dismissed on the review, hidden while pairing.screen is review, re-shown when a later frame\'s pairing names a question', async () => {
    const store = makeStore();
    const PR = tablePairing('cc300-ask-review-same-labels', 'CACHING_TRACING');
    expect(PR.screen).toBe('review');
    apply(store, { type: 'ask_cleared' }, { type: 'dialog', dialog: REVIEW() }, { type: 'ask', ask: ASK, key: null, pairing: PR });
    mount(store);
    expect(screen.getByRole('button', { name: /^Submit answers/ })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    apply(store, { type: 'dialog', dialog: { ...REVIEW(), id: 'review-repaint-1' }, pairing: PR });
    expect(screen.queryByRole('dialog'), 'the same screen, repainted').toBeNull();
    apply(store, { type: 'dialog', dialog: Q1(), pairing: P1() });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

// ─── the skew rows (THE NAMED BEHAVIOUR ROW) ───────────────────────────────────────────────────────────────────────

describe('the skew rows: no pairing on the wire is no pairing (D-7184)', () => {
  it('a server without C7q: the hook\'s envelope over its menu, no pairing on any frame, is the unpaired view', () => {
    const store = makeStore();
    apply(store, { type: 'ask_cleared' }, { type: 'dialog', dialog: Q1() }, { type: 'ask', ask: ASK, key: null });
    mount(store);
    expectUnpaired('the hook\'s question with no pairing');
    tapEverything();
    expect(sends()).toBe(0);
  });

  it('a server without C7q: the transcript\'s copy, no pairing, is the unpaired view', () => {
    const store = makeStore();
    apply(store, { type: 'ask_cleared' }, { type: 'dialog', dialog: copied(Q2(), 1) });
    expect(askSource({ ask: null, dialog: copied(Q2(), 1), askFrameSeen: true })).toMatchObject({ kind: 'structured', from: 'transcript' });
    mount(store);
    expectUnpaired('the copy with no pairing');
  });

  it('a pairing whose from is not askSource\'s is no pairing: the copy\'s on the hook\'s question, and the hook\'s on the copy', () => {
    const hooked = makeStore();
    apply(hooked, { type: 'ask_cleared' }, { type: 'dialog', dialog: Q1() }, { type: 'ask', ask: ASK, key: null, pairing: { ...P1(), from: 'transcript' } });
    mount(hooked);
    expectUnpaired('a transcript pairing on the hook\'s question');
    cleanup();
    const copy = makeStore();
    const { from: _f, ...hookShaped } = P3();
    apply(copy, { type: 'ask_cleared' }, { type: 'dialog', dialog: copied(Q2(), 1), pairing: hookShaped });
    mount(copy);
    expectUnpaired('a hook pairing on the transcript\'s copy');
  });

  it('D-7364: a pairing that does not fit the questions (one corresponds entry for two questions) is no pairing', () => {
    const store = makeStore();
    apply(store, { type: 'ask_cleared' }, { type: 'dialog', dialog: Q2() }, { type: 'ask', ask: ASK, key: null, pairing: { ...P2(), corresponds: [true] } });
    mount(store);
    expectUnpaired('a pairing for one question over two');
  });
});

// ─── (ix), (x): an answer's reply before its frame (D-7220) ────────────────────────────────────────────────────────

interface Site {
  /** The call site and the screens: the first screen's frames (with its pairing), the reply's `next`, and the recorded
   *  `dialog` frame that pairs `next`. */
  first: SessionStreamMsg[];
  next: Dialog;
  nextFrame: SessionStreamMsg;
  firstTitle: string;
  nextTitle: string;
  /** Point the call site's writer at `reply` and press it on the sheet. */
  press: (reply: Promise<DialogAnswered>) => void;
  /** After the send, before the reply: a frame the stream delivers (own words' typed row). */
  mid?: SessionStreamMsg;
  /** The sheet answers the paired next screen: press something there and assert what is sent. */
  answersNext: () => void;
}

const E = sequence('(e) an answer that moves the pane to the next question');
const eFirst = E.frames.filter((s) => s.step === 0).map((s) => s.frame);
const eNext = E.replies[0]!.body.next!;
const eNextFrame = E.frames.find((s) => s.step === 2)!.frame;
const tapNextTea = (): void => {
  answers.answerDialog.mockReturnValue(new Promise(() => {}));
  fireEvent.click(row('Tea'));
  expect(answers.answerDialog).toHaveBeenLastCalledWith(SESSION_ID, eNext.id, 1);
};

/** Own words on question 1 of `CACHING_TRACING` (no recorded sequence has a free-text row to type into): the same
 *  shape as sequence (e), its frames paired by the server's rule. */
const wordsFirst = (): SessionStreamMsg[] => [
  { type: 'dialog', dialog: Q1() },
  { type: 'ask', ask: ASK, key: null, pairing: wirePairing(ASK, Q1())! },
];
/** The typed row (DERIVED from `cc300-ask-same-labels-q1`: row 3 holds the text, so the id, which hashes the labels,
 *  differs, and the question's key does not). */
const TEXT = 'only in staging';
const typedQ1 = (): Dialog => ({
  ...Q1(), id: `${Q1().id}-typed`, options: Q1().options.map((o) => (o.index === 3 ? { ...o, label: TEXT } : o)),
});
const typeWords = (): void => {
  if (screen.queryByLabelText('Your own answer') === null) fireEvent.click(screen.getByRole('button', { name: /^Other/ }));
  fireEvent.change(screen.getByLabelText('Your own answer'), { target: { value: TEXT } });
  fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
};
const answersQ2 = (): void => {
  answers.answerDialog.mockReturnValue(new Promise(() => {}));
  fireEvent.click(rows()[0]!);
  expect(answers.answerDialog).toHaveBeenLastCalledWith(SESSION_ID, Q2().id, 1);
};

/** A multiSelect commit on `DRINK_FEATURES_TOOLS`'s question 2, which lands on question 3 (recorded screens; frames
 *  paired by the server's rule). */
const MULTI_FIRST = (): Dialog => pane('cc300-ask-multiselect-digit1');
const MULTI_NEXT = (): Dialog => pane('cc300-ask-multiselect-submit-open');

const SITES: Record<string, () => Site> = {
  'answer (a tapped option; C7q\'s sequence (e))': () => ({
    first: eFirst, next: eNext, nextFrame: eNextFrame, firstTitle: 'Which fruit?', nextTitle: 'Which drink?',
    press: (reply) => {
      answers.answerDialog.mockReturnValueOnce(reply);
      fireEvent.click(row('Apple'));
      expect(answers.answerDialog).toHaveBeenCalledWith(SESSION_ID, (eFirst[0] as { dialog: Dialog }).dialog.id, 1);
    },
    answersNext: tapNextTea,
  }),
  'moveTab (a tab-strip chip; C7q\'s sequence (e))': () => ({
    first: eFirst, next: eNext, nextFrame: eNextFrame, firstTitle: 'Which fruit?', nextTitle: 'Which drink?',
    press: (reply) => {
      answers.answerDialogTab.mockReturnValueOnce(reply);
      fireEvent.click(screen.getByRole('button', { name: /^Go to Drink/ }));
      expect(answers.answerDialogTab).toHaveBeenCalledTimes(1);
    },
    answersNext: tapNextTea,
  }),
  'sendWords (own words, the current screen\'s id)': () => ({
    first: wordsFirst(), next: Q2(), nextFrame: { type: 'dialog', dialog: Q2(), pairing: P2() },
    firstTitle: 'Enable caching?', nextTitle: 'Enable tracing?',
    press: (reply) => {
      answers.answerDialogText.mockReturnValueOnce(reply);
      typeWords();
      expect(answers.answerDialogText).toHaveBeenCalledWith(SESSION_ID, Q1().id, 3, TEXT);
    },
    answersNext: answersQ2,
  }),
  'sendWords (own words, its same ? held.id arm: the typed row reached the store first)': () => ({
    first: wordsFirst(), next: Q2(), nextFrame: { type: 'dialog', dialog: Q2(), pairing: P2() },
    firstTitle: 'Enable caching?', nextTitle: 'Enable tracing?',
    press: (reply) => {
      answers.answerDialogText.mockReturnValueOnce(reply);
      typeWords();
    },
    mid: { type: 'dialog', dialog: typedQ1(), pairing: wirePairing(ASK, typedQ1())! },
    answersNext: answersQ2,
  }),
  'commitPicks (a multiSelect commit)': () => ({
    first: [{ type: 'dialog', dialog: MULTI_FIRST() }, { type: 'ask', ask: DRINK_FEATURES_TOOLS, key: null, pairing: wirePairing(DRINK_FEATURES_TOOLS, MULTI_FIRST())! }],
    next: MULTI_NEXT(),
    nextFrame: { type: 'dialog', dialog: MULTI_NEXT(), pairing: wirePairing(DRINK_FEATURES_TOOLS, MULTI_NEXT())! },
    firstTitle: 'Which features do you want?', nextTitle: 'Which tools?',
    press: (reply) => {
      answers.answerDialogMulti.mockReturnValueOnce(reply);
      fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
      expect(answers.answerDialogMulti).toHaveBeenCalledWith(SESSION_ID, MULTI_FIRST().id, expect.any(Array));
    },
    answersNext: () => {
      answers.answerDialogMulti.mockReturnValue(new Promise(() => {}));
      fireEvent.click(screen.getAllByRole('checkbox')[0]!);
      fireEvent.click(screen.getByRole('button', { name: /^Review answers/ }));
      expect(answers.answerDialogMulti).toHaveBeenLastCalledWith(SESSION_ID, MULTI_NEXT().id, expect.any(Array));
    },
  }),
};

describe('(ix) an answer\'s reply before its dialog frame (D-7220): the next screen is unpaired until its frame lands', () => {
  it.each(Object.keys(SITES))('reply first, %s', async (name) => {
    const site = SITES[name]!();
    const store = makeStore();
    apply(store, ...site.first);
    mount(store);
    expect(title(), 'question 1, paired').toBe(site.firstTitle);
    const call = deferred();
    site.press(call.promise);
    if (site.mid !== undefined) apply(store, site.mid);
    const before = sends();
    await act(async () => call.land({ ok: true, next: site.next }));
    expect(store.getState().dialog?.id, 'the reply\'s next is the store\'s dialog').toBe(site.next.id);
    expect(store.getState().pairing, 'and no pairing beside it').toBeNull();
    // Never question 1 (shown from P1), nor P1's live and corresponds over the next screen: its unpaired view.
    expect(title()).not.toBe(site.firstTitle);
    expectUnpaired(`${name}: the next screen before its frame`);
    tapEverything();
    expect(sends(), 'a tap there sends nothing read from P1').toBe(before);
    apply(store, site.nextFrame);
    expect(store.getState().pairing).toEqual(pairingOn(site.nextFrame));
    expect(title()).toBe(site.nextTitle);
    site.answersNext();
  });

  it.each(Object.keys(SITES))('frame first, %s: applyAnswered writes nothing and the frame\'s pairing stays', async (name) => {
    const site = SITES[name]!();
    const store = makeStore();
    apply(store, ...site.first);
    mount(store);
    const call = deferred();
    site.press(call.promise);
    if (site.mid !== undefined) apply(store, site.mid);
    apply(store, site.nextFrame);
    expect(store.getState().pairing).toEqual(pairingOn(site.nextFrame));
    await act(async () => call.land({ ok: true, next: site.next }));
    expect(store.getState().pairing, 'the frame\'s pairing, kept').toEqual(pairingOn(site.nextFrame));
    expect(title()).toBe(site.nextTitle);
    site.answersNext();
  });
});

describe('(x) the null-dialog reply (D-7220)', () => {
  it('a dialog_cleared before the answer settles, then the reply\'s next: question 2, no pairing, until the recorded frame pairs it', async () => {
    const X = sequence('(e) a dialog_cleared before the answer settles');
    const store = makeStore();
    replay(store, X.frames, 0);
    mount(store);
    expect(title()).toBe('Which fruit?');
    const call = deferred();
    answers.answerDialog.mockReturnValueOnce(call.promise);
    fireEvent.click(row('Apple'));
    replay(store, X.frames.filter((s) => s.step === 2));
    expect(store.getState().dialog).toBeNull();
    expect(store.getState().pairing).toBeNull();
    const next = X.replies[0]!.body.next!;
    await act(async () => call.land({ ok: true, next }));
    expect(store.getState().dialog?.id).toBe(next.id);
    expect(store.getState().pairing).toBeNull();
    expectUnpaired('question 2 after a dialog_cleared, before its frame');
    replay(store, X.frames.filter((s) => s.step === 3));
    expect(store.getState().pairing).toMatchObject({ live: 1, screen: 'q1' });
    expect(title()).toBe('Which drink?');
  });

  it('a reply with next: null: no dialog, no pairing', async () => {
    const N = sequence('(e) an answer whose next is no menu');
    const store = makeStore();
    replay(store, N.frames, 0);
    mount(store);
    const call = deferred();
    answers.answerDialog.mockReturnValueOnce(call.promise);
    fireEvent.click(row('Apple'));
    await act(async () => call.land({ ok: true, next: N.replies[0]!.body.next }));
    expect(store.getState().dialog).toBeNull();
    expect(store.getState().pairing).toBeNull();
    replay(store, N.frames.filter((s) => s.step === 2));
    expect(store.getState().dialog).toBeNull();
    expect(store.getState().pairing).toBeNull();
  });
});

describe('D-7367: a reply whose next is the screen the store holds keeps its pairing', () => {
  it('a tab move to the tab showing (the route answers the same screen, and the stream sends no frame for it)', async () => {
    const store = makeStore();
    apply(store, ...eFirst);
    const shown = (eFirst[0] as { dialog: Dialog }).dialog;
    const p = store.getState().pairing;
    expect(p).not.toBeNull();
    act(() => store.getState().applyAnswered(shown.id, { ...shown }));
    expect(store.getState().pairing).toEqual(p);
    mount(store);
    expect(title()).toBe('Which fruit?');
  });
});
