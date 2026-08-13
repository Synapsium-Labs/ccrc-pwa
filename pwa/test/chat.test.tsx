import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatEvent } from '../../shared/api';
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createSessionStore, type SessionStore } from '../src/stores/session';
import { ChatListInner } from '../src/session/ChatList';
import { Composer } from '../src/session/Composer';
import { loadAcks } from '../src/lib/seen';
import { SessionScreen } from '../src/screens/SessionScreen';

// Virtuoso needs a real viewport to measure; jsdom has none. Screen-level
// tests render the list through this simple-list stand-in (the plan's
// prescribed approach); item-level tests use ChatListInner directly.
vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: {
      totalCount: number;
      itemContent: (i: number) => ReactNode;
      computeItemKey?: (i: number) => string | number;
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) =>
          React.createElement('div', { key: props.computeItemKey?.(i) ?? i }, props.itemContent(i)),
        ),
      ),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// (pointer: fine) stub — the one predicate behind both Enter-sends and the
// esc keycap's touch-only visibility. Unstubbed, setup.ts's matchMedia shim
// already answers `false` (touch), so only the fine-pointer path needs it.
const stubPointer = (fine: boolean): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('pointer: fine') ? fine : false,
    media: q, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null,
    dispatchEvent: () => false,
  }));
};

// — fixtures —

const TS = '2026-07-20T10:00:00.000Z';
const TS_LATER = '2026-07-20T10:00:12.400Z';
const NOW = TS;

const user = (uuid: string, text: string): ChatEvent => ({ kind: 'user', uuid, ts: TS, text });
const assistant = (uuid: string, text: string): ChatEvent =>
  ({ kind: 'assistant', uuid, ts: TS, text });
const toolUse = (uuid: string, toolId: string, input = 'pnpm test --filter contracts'): ChatEvent =>
  ({ kind: 'tool_use', uuid, ts: TS, toolId, name: 'Bash', input });
const toolResult = (toolId: string, text: string, isError = false): ChatEvent =>
  ({ kind: 'tool_result', ts: TS_LATER, toolId, text, isError });

// A modest AskUserQuestion, as the transcript parser hands it over: `input` is
// the tool call's JSON, capped at TOOL_INPUT_MAX (4000) upstream.
const ASK_USE = {
  kind: 'tool_use', uuid: 'a1', ts: NOW, toolId: 't1', name: 'AskUserQuestion',
  input: JSON.stringify({ questions: [{ question: 'Which colour?', header: 'Colour',
    multiSelect: false, options: [{ label: 'Red' }, { label: 'Green' }] }] }),
} as const;

const askUse = (...questions: string[]): ChatEvent => ({
  kind: 'tool_use', uuid: 'a1', ts: NOW, toolId: 't1', name: 'AskUserQuestion',
  input: JSON.stringify({ questions: questions.map((question) => ({ question, header: 'H',
    multiSelect: false, options: [{ label: 'Red' }, { label: 'Green' }] })) }),
});
const askResult = (text: string, isError = false): ChatEvent =>
  ({ kind: 'tool_result', ts: NOW, toolId: 't1', text, isError });

// Every ask assertion reads the ask card's own DOM. `screen.getByText` does not:
// the generic row it replaces prints the tool input's first JSON line into
// .tool-sum, so an unscoped /Green/ or 'AskUserQuestion' match is satisfied by
// the very card this feature exists to remove — and stays green with the whole
// feature deleted.
const askQs = (): string[] =>
  [...document.querySelectorAll('.tool-ask .tool-ask-q')].map((n) => n.textContent ?? '');
const askAs = (): string[] =>
  [...document.querySelectorAll('.tool-ask .tool-ask-a')].map((n) => n.textContent ?? '');

// Three real result shapes, verbatim from the 205 AskUserQuestion pairs in the
// author's transcripts (only the question text is swapped for the fixture's).

// 14 of the 205 are this: ~800 characters of harness boilerplate aimed at the
// model, arriving with is_error set. Note it quotes the question back — but
// without the `"=` join, so it must not read as an answer.
const ASK_REJECTED =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if"
  + ' it was a file edit, the new_string was NOT written to the file). To tell you how to'
  + ' proceed, the user said:\nThe user wants to clarify these questions.\n    This means'
  + ' they may have additional information, context or questions for you.\n    Take their'
  + ' response into account and then reformulate the questions if appropriate.\n    Start'
  + ' by asking them what they would like to clarify.\n\n    Questions asked:\n-'
  + ' "Which colour?"\n  (No answer provided)\n\nNote: The user\'s next message may contain'
  + ' a correction or preference. Pay close attention — if they explain what went wrong or'
  + " how they'd prefer you to work, consider saving that to memory for future sessions.";

// No error flag, still no answer.
const ASK_TIMEOUT =
  'No response after 60s — the user may be away from keyboard. Proceed using your best'
  + " judgment based on the context so far; you can re-ask this question later if it's"
  + ' still relevant.';

// A two-question ask whose first answer is free text and whose second carries an
// option preview — the shape that made a single lazy capture swallow question 2.
const MESH_Q1 = "The 'empty space in mesh' you saw — which is it?";
const MESH_Q2 =
  "The 'collision with body' — which mech(s), and is it the rest pose or the animation?";
const MESH_RESULT =
  `Your questions have been answered: "${MESH_Q1}"=(no option selected) notes: This is on one`
  + ' of the mech units, I think berserker, arm is floating in space basically,'
  + ` "${MESH_Q2}"="Berserker, rest pose" selected preview:\nberserker: arm/shoulder plates\n`
  + '  interpenetrate torso at rest\nfix: shoulder rest-pose / assembly xform.'
  + ' You can now continue with these answers in mind.';

/** Store whose socket is inert and whose api never reaches the network. */
const makeStore = (id = 'claude:OpenClawHetzner'): SessionStore =>
  createSessionStore(id, {
    makeSocket: () =>
      ({
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        close(): void {},
      }) as unknown as WebSocket,
    api: { prompt: vi.fn().mockResolvedValue(undefined) },
  });

const seed = (store: SessionStore, patch: Partial<ReturnType<SessionStore['getState']>>): void => {
  act(() => {
    store.setState(patch);
  });
};

// — ChatList (inner, plain-list renderer) —

describe('ChatListInner', () => {
  it('renders assistant markdown — bold lands as <strong>', () => {
    render(
      <ChatListInner
        id="s"
        events={[user('u1', 'run the tests'), assistant('a1', 'A **bold** move — all green.')]}
        pending={[]}
      />,
    );

    const bold = screen.getByText('bold');
    expect(bold.tagName).toBe('STRONG');
    expect(screen.getByText('run the tests')).toBeInTheDocument();
  });

  it('merges tool_use + tool_result into one ToolCard that expands on tap', () => {
    render(
      <ChatListInner
        id="s"
        events={[toolUse('t1', 'tool-1'), toolResult('tool-1', 'tests: 41 passed')]}
        pending={[]}
      />,
    );

    // One card, not two rows — the result folded into its use.
    expect(document.querySelectorAll('.toolcard')).toHaveLength(1);
    expect(screen.queryByText('tests: 41 passed')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Bash/ }));
    expect(screen.getByText('tests: 41 passed')).toBeInTheDocument();
  });

  it('renders a failed pending send with Retry and Discard actions', () => {
    const onRetry = vi.fn();
    render(
      <ChatListInner
        id="s"
        events={[]}
        pending={[{ key: 'p1', text: 'hello there', state: 'failed', error: 'no pane' }]}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('hello there')).toBeInTheDocument();
    expect(screen.getByText('no pane')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('p1');
  });

  it('renders an in-flight pending send with the sending tick', () => {
    render(
      <ChatListInner
        id="s"
        events={[]}
        pending={[{ key: 'p2', text: 'on its way', state: 'sending' }]}
      />,
    );

    expect(screen.getByText('on its way')).toBeInTheDocument();
    expect(screen.getByText('sending')).toBeInTheDocument();
  });

  it('shows the working indicator when busy — even when the last item is the user turn', () => {
    const { rerender } = render(
      <ChatListInner id="s" events={[user('u1', 'run the tests')]} pending={[]} busy={false} />,
    );
    // Not working when idle.
    expect(screen.queryByRole('status', { name: /working/i })).not.toBeInTheDocument();

    // Busy with the user's message as the tail (no assistant bubble to wear the
    // caret) — the explicit indicator must still appear.
    rerender(<ChatListInner id="s" events={[user('u1', 'run the tests')]} pending={[]} busy />);
    expect(screen.getByRole('status', { name: /working/i })).toBeInTheDocument();
  });

  it('renders a sent clip path as the image, not the path', () => {
    const P = '/home/u/.cc-clips/claude2-Proj/clip-20260726-150340-a1b2.png';
    render(<ChatListInner id="claude2-Proj" pending={[]} events={[
      { kind: 'user', uuid: 'u1', ts: NOW, text: `${P}\nwhat is this` },
    ]} />);

    const img = screen.getByRole('img', { name: 'clip-20260726-150340-a1b2.png' });
    expect(img).toHaveAttribute('src', `${location.origin}/api/sessions/claude2-Proj/clip/clip-20260726-150340-a1b2.png`);
    expect(screen.getByText('what is this')).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(P))).not.toBeInTheDocument();
  });

  it('falls back to the filename when the clip is gone from disk', () => {
    const P = '/home/u/.cc-clips/claude2-Proj/clip-20260726-150340-a1b2.png';
    render(<ChatListInner id="claude2-Proj" pending={[]} events={[
      { kind: 'user', uuid: 'u1', ts: NOW, text: P },
    ]} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('clip-20260726-150340-a1b2.png')).toBeInTheDocument();
  });

  it('leaves a message with no clip path alone', () => {
    render(<ChatListInner id="s" pending={[]} events={[
      { kind: 'user', uuid: 'u1', ts: NOW, text: 'just words' },
    ]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows the same thumbnails on the optimistic bubble, from the object URL', () => {
    // chip -> pending -> confirmed must never flicker empty, so the pending bubble
    // renders the blob it inherited rather than waiting on a server round trip.
    render(<ChatListInner id="claude2-Proj" events={[]} pending={[{
      key: 'p1', text: 'what is this', state: 'sending',
      attachments: [{ path: '/home/u/.cc-clips/claude2-Proj/clip-1-a1b2.png', previewUrl: 'blob:mock/1' }],
    }]} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:mock/1');
    expect(screen.getByText('what is this')).toBeInTheDocument();
  });

  it('shows an asked question as a question, not as JSON', () => {
    render(<ChatListInner id="s" pending={[]} events={[ASK_USE]} />);
    expect(askQs()).toEqual(['Which colour?']);
    expect(document.querySelector('.toolcard')).toBeNull();
    expect(screen.queryByText(/"questions"/)).not.toBeInTheDocument();
  });

  it('shows the answer once it lands', () => {
    render(<ChatListInner id="s" pending={[]} events={[ASK_USE, askResult(
      'Your questions have been answered: "Which colour?"="Green".'
      + ' You can now continue with these answers in mind.')]} />);
    expect(askAs()).toEqual(['Green']);
  });

  it('shows no answer chip while the ask is still open', () => {
    render(<ChatListInner id="s" pending={[]} events={[ASK_USE]} />);
    expect(askAs()).toEqual([]);
  });

  // A negative assertion alone is vacuous — "no ask card" is trivially true with
  // the feature deleted — so each case renders the good input too and demands
  // the card appear for it.
  it.each([
    ['truncated mid-JSON', '{"questions":[{"que'],
    // Nothing validates `question` beyond it being a string; a blank one would
    // leave a card with no question on it.
    ['a blank question', JSON.stringify({ questions: [{ question: '  ', options: [] }] })],
    ['a blank question after a good one', JSON.stringify({ questions: [
      { question: 'Which colour?' }, { question: '' }] })],
    ['no questions at all', JSON.stringify({ questions: [] })],
  ])('falls back to the generic row when the input is %s', (_why, input) => {
    render(<ChatListInner id="s" pending={[]} events={[{ ...ASK_USE, input }]} />);
    expect(document.querySelector('.tool-ask')).toBeNull();
    expect(screen.getByText('AskUserQuestion')).toBeInTheDocument();
    cleanup();
    render(<ChatListInner id="s" pending={[]} events={[ASK_USE]} />);
    expect(document.querySelector('.tool-ask')).not.toBeNull();
  });

  // The reader took the free-text option the sheet offers — the result says
  // "(no option selected) notes: …" instead of naming a label.
  it('shows a typed-in answer when no option was picked', () => {
    render(<ChatListInner id="s" pending={[]} events={[ASK_USE, askResult(
      'Your questions have been answered: "Which colour?"=(no option selected)'
      + ' notes: teal, actually. You can now continue with these answers in mind.')]} />);
    expect(askAs()).toEqual(['teal, actually']);
  });

  // Real questions quote things, so the answer must be found by the `"=` join
  // and never by "the text between the second and third quote".
  it('finds the answer even when the question quotes something itself', () => {
    const q = 'By "email validation", did you mean DMARC?';
    render(<ChatListInner id="s" pending={[]} events={[askUse(q), askResult(
      `Your questions have been answered: "${q}"="DMARC + config set".`
      + ' You can now continue with these answers in mind.')]} />);
    expect(askQs()).toEqual([q]);
    expect(askAs()).toEqual(['DMARC + config set']);
  });

  // …and real labels quote things too. Counting quotes cuts this one at 'Only'
  // — a different answer, silently, with nothing empty to trip a fallback.
  it('keeps a label that quotes something itself whole', () => {
    const q = 'What should be allowed to AUTO-REJECT a signup (vs hold for review)?';
    render(<ChatListInner id="s" pending={[]} events={[askUse(q), askResult(
      `Your questions have been answered: "${q}"="Only "not an organiser"" selected preview:`
      + '\norganiser=NOT(high)            -> REJECT\norganiser=uncertain            -> HOLD'
      + '\n\n(ownership never auto-rejects).'
      + ' You can now continue with these answers in mind.')]} />);
    expect(askAs()).toEqual(['Only "not an organiser"']);
  });

  // 41 of the 205 real asks carry more than one question. A single lazy capture
  // ran past question 1 and handed question 2's text, label and preview back as
  // the answer to question 1.
  it('keeps each answer with its own question on a multi-question ask', () => {
    render(<ChatListInner id="s" pending={[]} events={[
      askUse(MESH_Q1, MESH_Q2), askResult(MESH_RESULT)]} />);
    expect(askQs()).toEqual([MESH_Q1, MESH_Q2]);
    expect(askAs()).toEqual([
      'This is on one of the mech units, I think berserker, arm is floating in space basically',
      'Berserker, rest pose',
    ]);
  });

  // The third real shape, which the `"=` anchor matches just as happily.
  it('reads the "The user answered" shape too', () => {
    const q = 'The suppression gate currently collapses fleet-wide. How should I fix it?';
    render(<ChatListInner id="s" pending={[]} events={[askUse(q), askResult(
      `The user answered: "${q}"="I am beginning to wonder whether this was a good ide ainthe`
      + ' first place, given low confidence on "how many objects we expect to find"? ". Read'
      + ' the answers carefully — they may request clarification, changes, or that you not'
      + ' proceed — and follow what they actually say.')]} />);
    expect(askAs()).toEqual(['I am beginning to wonder whether this was a good ide ainthe first'
      + ' place, given low confidence on "how many objects we expect to find"?']);
  });

  // The rejection preamble is ~800 characters of model-directed boilerplate.
  // It is not a choice, so it never wears the accent tint, and it never lands
  // in the open — the generic row it replaced kept it behind a tap.
  it('does not paint a declined ask as an answer', () => {
    render(<ChatListInner id="s" pending={[]} events={[ASK_USE, askResult(ASK_REJECTED, true)]} />);
    expect(askQs()).toEqual(['Which colour?']);
    expect(askAs()).toEqual([]);
    expect(screen.getByText('ERROR')).toBeInTheDocument();
    expect(screen.queryByText(/tool use was rejected/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /no answer/i }));
    expect(screen.getByText(/tool use was rejected/)).toBeInTheDocument();
  });

  it('treats a timed-out ask as unanswered even though it is no error', () => {
    render(<ChatListInner id="s" pending={[]} events={[ASK_USE, askResult(ASK_TIMEOUT)]} />);
    expect(askAs()).toEqual([]);
    expect(screen.queryByText('ERROR')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /no answer/i })).toBeInTheDocument();
  });

  it('shows the raw result text behind a tap when the ask never got an answer', () => {
    render(<ChatListInner id="s" pending={[]} events={[
      ASK_USE, askResult('[Request interrupted by user]', true)]} />);
    expect(askAs()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /no answer/i }));
    expect(screen.getByText('[Request interrupted by user]')).toBeInTheDocument();
  });
});

// — Composer —

describe('Composer', () => {
  it('sends the drafted text and clears the box', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} pending={[]} />);

    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: 'fix the flaky test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledWith('fix the flaky test');
    expect(box).toHaveValue('');
  });

  it('sends on Cmd/Ctrl+Enter, never on bare Enter', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} pending={[]} />);

    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: 'line one' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledWith('line one');
  });

  it('disables input and send when disabled', () => {
    render(<Composer onSend={vi.fn()} pending={[]} disabled />);

    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});

describe('Enter with a physical keyboard', () => {
  it('sends on plain Enter', async () => {
    stubPointer(true);
    const onSend = vi.fn();
    render(<Composer onSend={onSend} pending={[]} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'hello');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it.each(['altKey', 'metaKey', 'ctrlKey', 'shiftKey'] as const)(
    'inserts a newline on %s+Enter', async (mod) => {
      stubPointer(true);
      const onSend = vi.fn();
      render(<Composer onSend={onSend} pending={[]} />);
      const box = screen.getByRole('textbox');
      await userEvent.type(box, 'hello');
      fireEvent.keyDown(box, { key: 'Enter', [mod]: true });
      expect(onSend).not.toHaveBeenCalled();
    });
});

describe('Enter on touch', () => {
  it('inserts a newline — phone keyboards have no Alt or Cmd', async () => {
    stubPointer(false);
    const onSend = vi.fn();
    render(<Composer onSend={onSend} pending={[]} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'hello');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('still sends on Cmd+Enter, as it does today', async () => {
    stubPointer(false);
    const onSend = vi.fn();
    render(<Composer onSend={onSend} pending={[]} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'hello');
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledWith('hello');
  });
});

// — Composer autofocus —
// Opening a session should land the cursor in the composer on a fine
// pointer (a physical keyboard) — the exact friction reported: tapping a
// fleet row, or picking one in the desktop sidebar, left focus on the row
// and cost an extra click. Gated on the same (pointer: fine) predicate as
// Enter-to-send above; must never pop the on-screen keyboard on touch.
//
// The actual focus() call is deferred a tick (see Composer.tsx) so a Sheet
// already open the instant the screen appears has settled into the DOM
// before Composer decides whether to take focus — every assertion here
// waits past that same tick before checking.
const flushTimers = (): Promise<void> => act(() => new Promise<void>((r) => setTimeout(r, 0)));

/** A sibling field the user is already mid-type in — focused via a layout
 *  effect so it claims focus strictly before Composer's own (deferred)
 *  effect runs, regardless of render order. */
function FieldBesideComposer({ id }: { id: string }): ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { ref.current?.focus(); }, []);
  return (
    <>
      <input ref={ref} data-testid="other-field" />
      <Composer id={id} onSend={vi.fn()} pending={[]} />
    </>
  );
}

describe('Composer autofocus', () => {
  it('focuses the composer when the session opens with a fine pointer', async () => {
    stubPointer(true);
    render(<Composer id="s1" onSend={vi.fn()} pending={[]} />);
    await flushTimers();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
  });

  it('does not steal focus on a coarse pointer', async () => {
    stubPointer(false);
    render(<Composer id="s1" onSend={vi.fn()} pending={[]} />);
    await flushTimers();
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveFocus();
  });

  it('does not focus a disabled (dead/read-only) composer', async () => {
    stubPointer(true);
    render(<Composer id="s1" onSend={vi.fn()} pending={[]} disabled />);
    await flushTimers();
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveFocus();
  });

  it('focuses with preventScroll, so opening a session never scrolls the page', async () => {
    stubPointer(true);
    const focusSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'focus');
    render(<Composer id="s1" onSend={vi.fn()} pending={[]} />);
    await flushTimers();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('re-focuses when the session id changes — the desktop-sidebar-switch flow', async () => {
    stubPointer(true);
    const { rerender } = render(<Composer id="s1" onSend={vi.fn()} pending={[]} />);
    await flushTimers();
    const box1 = screen.getByRole('textbox', { name: 'Message' });
    expect(box1).toHaveFocus();

    // Focus moves on in between, exactly as it does when the user clicks a
    // different row in the sidebar to open a different session.
    act(() => { box1.blur(); });
    expect(box1).not.toHaveFocus();

    rerender(<Composer id="s2" onSend={vi.fn()} pending={[]} />);
    await flushTimers();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
  });

  it('does not steal focus from a field the user is already typing in', async () => {
    stubPointer(true);
    render(<FieldBesideComposer id="s1" />);
    await flushTimers();
    expect(screen.getByTestId('other-field')).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveFocus();
  });

  it('does not autofocus while a Sheet/dialog is open over the chat', async () => {
    stubPointer(true);
    render(
      <>
        <div role="dialog" />
        <Composer id="s1" onSend={vi.fn()} pending={[]} />
      </>,
    );
    await flushTimers();
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveFocus();
  });
});

// — SessionScreen —

describe('SessionScreen', () => {
  // Opening a session IS the ack (Task 6, pwa/src/lib/seen.ts) — the honest
  // signal that a human looked, so the fleet screen's unseen badge for THIS
  // session clears without a separate "mark as read" step.
  it('acks the session on mount, written through to localStorage', () => {
    window.localStorage.clear();
    const store = makeStore();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} />);
    expect(loadAcks()).toHaveProperty('claude:OpenClawHetzner');
  });

  it('renders skeleton bubbles until the backlog arrives', () => {
    const store = makeStore();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} />);
    // untouched store: uuid null — no backlog yet
    expect(screen.getAllByRole('status', { name: 'Loading' }).length).toBeGreaterThan(0);
  });

  it('dead session disables the composer and offers restart', () => {
    const store = makeStore();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} />);
    seed(store, { uuid: 'u1', status: 'dead', events: [user('u1', 'last words')] });

    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart session' })).toBeInTheDocument();
  });

  it('shows the transcript diagnostic banner with the attempted path', () => {
    const store = makeStore();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} />);
    seed(store, { uuid: 'u1', missingFile: '/home/rc/.claude/projects/x/u1.jsonl' });

    expect(screen.getByText("Can't find this session's transcript")).toBeInTheDocument();
    expect(screen.getByText('/home/rc/.claude/projects/x/u1.jsonl')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open terminal' })).toBeInTheDocument();
  });

  it('focuses the composer on open with a fine pointer — no second click needed', async () => {
    stubPointer(true);
    const store = makeStore();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} />);
    await flushTimers();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
  });

  it('leaves focus alone on a coarse pointer', async () => {
    const store = makeStore();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} />);
    await flushTimers();
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveFocus();
  });

  it('does not steal focus from a dialog already open on arrival', async () => {
    // A real end-to-end version of the Sheet-guard: a pending dialog can be
    // showing the instant the screen appears (DialogSheet reads it straight
    // off the store), not just something Composer opens itself.
    stubPointer(true);
    const store = makeStore();
    seed(store, {
      dialog: {
        id: 'd1',
        title: 'Which migration strategy?',
        options: [{ index: 1, label: 'Expand–contract' }],
        selectedIndex: 1,
        parsed: true,
        raw: '❯ 1. Expand–contract',
      },
    });
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} />);
    await flushTimers();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Radix marks the rest of the page aria-hidden while the dialog is open
    // (correctly — it's inert to assistive tech), which takes the composer's
    // textarea out of getByRole entirely; query the raw DOM instead.
    const composerInput = document.querySelector('.composer-input');
    expect(composerInput).not.toBeNull();
    expect(composerInput).not.toHaveFocus();
  });
});

// — Build 4 Task 16: the truncation cue —
//
// Three states, and the third is why the field is optional: absent = *this
// server did not report*, 0 = not truncated, >0 = this many bytes were cut.
// An old server can only produce "absent". The rule the renderer must hold is
// that absent renders NOTHING — never a claim of completeness, which would be
// a lie told on a fragment.
describe('the truncation cue', () => {
  const cut = (): string[] =>
    [...document.querySelectorAll('.tool-cut')].map((n) => n.textContent ?? '');

  const expand = (): void => {
    fireEvent.click(screen.getByRole('button', { name: /Bash/ }));
  };

  it('renders no cue when the field is absent', () => {
    render(
      <ChatListInner
        id="s"
        events={[toolUse('t1', 'tool-1'), toolResult('tool-1', 'tests: 41 passed')]}
        pending={[]}
      />,
    );
    expand();
    expect(cut()).toEqual([]);
  });

  it('renders no cue at 0', () => {
    render(
      <ChatListInner
        id="s"
        events={[
          { ...toolUse('t1', 'tool-1'), truncatedBytes: 0 } as ChatEvent,
          { ...toolResult('tool-1', 'tests: 41 passed'), truncatedBytes: 0 } as ChatEvent,
        ]}
        pending={[]}
      />,
    );
    expand();
    expect(cut()).toEqual([]);
  });

  it('renders "+N bytes cut" at >0, inside the expanded well', () => {
    render(
      <ChatListInner
        id="s"
        events={[
          { ...toolUse('t1', 'tool-1'), truncatedBytes: 0 } as ChatEvent,
          { ...toolResult('tool-1', 'a long result'), truncatedBytes: 1500 } as ChatEvent,
        ]}
        pending={[]}
      />,
    );

    // Collapsed, the card says nothing about it — the cue lives with the text
    // it is describing, not on the summary row.
    expect(cut()).toEqual([]);
    expand();
    expect(cut()).toEqual(['+1500 bytes cut']);
  });

  it('cues the INPUT and the RESULT independently — each beside its own well', () => {
    render(
      <ChatListInner
        id="s"
        events={[
          { ...toolUse('t1', 'tool-1'), truncatedBytes: 42 } as ChatEvent,
          { ...toolResult('tool-1', 'a long result'), truncatedBytes: 1500 } as ChatEvent,
        ]}
        pending={[]}
      />,
    );
    expand();
    // Two cues, in document order: input first, result second — a single
    // shared cue would report one number for two different cuts.
    expect(cut()).toEqual(['+42 bytes cut', '+1500 bytes cut']);
  });

  it('cues a truncated ask outcome too — the well AskOutcome hides behind its tap', () => {
    render(
      <ChatListInner
        id="s"
        events={[askUse('Which colour?'), { ...askResult(ASK_TIMEOUT), truncatedBytes: 900 } as ChatEvent]}
        pending={[]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /no answer/ }));
    expect(cut()).toEqual(['+900 bytes cut']);
  });

  it('never says "complete" anywhere', () => {
    // The failure this feature exists to prevent is a fragment presented as
    // whole. No rendering of any of the three states may assert completeness.
    for (const truncatedBytes of [undefined, 0, 1500]) {
      cleanup();
      render(
        <ChatListInner
          id="s"
          events={[
            toolUse('t1', 'tool-1'),
            { ...toolResult('tool-1', 'a result'), ...(truncatedBytes === undefined ? {} : { truncatedBytes }) } as ChatEvent,
          ]}
          pending={[]}
        />,
      );
      expand();
      expect(document.body.textContent ?? '', String(truncatedBytes)).not.toMatch(/complete/i);
      expect(document.body.textContent ?? '', String(truncatedBytes)).not.toMatch(/\bwhole\b/i);
    }
  });
});
