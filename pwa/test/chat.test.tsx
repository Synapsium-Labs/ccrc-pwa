import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChatEvent } from '../../shared/api';
import type { ReactNode } from 'react';
import { createSessionStore, type SessionStore } from '../src/stores/session';
import { ChatListInner } from '../src/session/ChatList';
import { Composer } from '../src/session/Composer';
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
});

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
    expect(screen.getByText('Which colour?')).toBeInTheDocument();
    expect(screen.queryByText(/"questions"/)).not.toBeInTheDocument();
  });

  it('shows the answer once it lands', () => {
    render(<ChatListInner id="s" pending={[]} events={[ASK_USE, {
      kind: 'tool_result', ts: NOW, toolId: 't1',
      text: 'Your questions have been answered: "Which colour?"="Green"', isError: false,
    }]} />);
    expect(screen.getByText(/Green/)).toBeInTheDocument();
  });

  it('falls back to the generic row when the input was truncated', () => {
    render(<ChatListInner id="s" pending={[]} events={[{ ...ASK_USE, input: '{"questions":[{"que' }]} />);
    expect(screen.getByText('AskUserQuestion')).toBeInTheDocument();
  });

  // Same hazard the sheet guards: nothing validates `question` beyond it being
  // a string, and a blank one would render a card with no question on it.
  it('falls back to the generic row when the question is blank', () => {
    render(<ChatListInner id="s" pending={[]} events={[{ ...ASK_USE,
      input: JSON.stringify({ questions: [{ question: '  ', options: [] }] }) }]} />);
    expect(screen.getByText('AskUserQuestion')).toBeInTheDocument();
  });

  // The reader took the free-text option the sheet offers — the result says
  // "(no option selected) notes: …" instead of naming a label.
  it('shows a typed-in answer when no option was picked', () => {
    render(<ChatListInner id="s" pending={[]} events={[ASK_USE, {
      kind: 'tool_result', ts: NOW, toolId: 't1', isError: false,
      text: 'Your questions have been answered: "Which colour?"=(no option selected)'
        + ' notes: teal, actually. You can now continue with these answers in mind.',
    }]} />);
    expect(screen.getByText('teal, actually')).toBeInTheDocument();
    expect(screen.queryByText(/You can now continue/)).not.toBeInTheDocument();
  });

  // Real questions quote things, so the answer must be found by the `"=` join
  // and never by "the text between the second and third quote".
  it('finds the answer even when the question quotes something itself', () => {
    const q = 'By "email validation", did you mean DMARC?';
    render(<ChatListInner id="s" pending={[]} events={[
      { ...ASK_USE, input: JSON.stringify({ questions: [{ question: q, multiSelect: false,
        options: [{ label: 'DMARC + config set' }] }] }) },
      { kind: 'tool_result', ts: NOW, toolId: 't1', isError: false,
        text: `Your questions have been answered: "${q}"="DMARC + config set". You can now continue.` },
    ]} />);
    expect(screen.getByText(q)).toBeInTheDocument();
    expect(screen.getByText('DMARC + config set')).toBeInTheDocument();
  });

  it('shows the raw result text when the ask never got an answer', () => {
    render(<ChatListInner id="s" pending={[]} events={[ASK_USE, {
      kind: 'tool_result', ts: NOW, toolId: 't1',
      text: '[Request interrupted by user]', isError: true,
    }]} />);
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

// — SessionScreen —

describe('SessionScreen', () => {
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
});
