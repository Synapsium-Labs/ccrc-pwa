// The four features of the assistant's richest renderer that had no test —
// found by MEASURING, not by reading: `MessageBubble.tsx` is the lowest-covered
// component in the package (67.85% of statements, 59.68% of branches), and the
// gap is not the link handling `message-links.test.tsx` already pins. It is the
// GitHub alert blockquotes, the keystroke caps, the copy button and the table
// wrapper — four user-visible behaviours, each a decision with arms, none of
// them ever asked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessageBubble } from '../src/session/MessageBubble';

// `cleanup` AND `restoreAllMocks`: measured, because the second link case
// below spied `window.open` while the first case's spy was still installed,
// and `vi.spyOn` on an already-mocked method hands back the SAME mock — so a
// fresh expectation read the previous test's call and the assertion inverted.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const assistant = (text: string) =>
  render(<MessageBubble id="s" event={{ kind: 'assistant', uuid: 'a1', ts: '2026-07-21T20:00:00Z', text }} />);

describe('GitHub alert blockquotes become callouts (remark-gfm does NOT do this)', () => {
  it('tags the callout with its kind and DROPS the marker from the prose', () => {
    // The marker is syntax, not copy. Left in, every alert would open with
    // `[!WARNING]` — which is what the stripping in `remarkAlerts` is for, and
    // what nothing checked.
    assistant('> [!WARNING]\n> the pane is already gone');
    const callout = document.querySelector('.callout');
    expect(callout).not.toBeNull();
    expect(callout).toHaveAttribute('data-callout', 'warning');
    expect(callout?.textContent).toContain('the pane is already gone');
    expect(callout?.textContent, 'the marker is syntax, never prose').not.toContain('[!WARNING]');
  });

  it('maps all five kinds, case-insensitively', () => {
    for (const [written, expected] of [
      ['NOTE', 'note'], ['TIP', 'tip'], ['IMPORTANT', 'important'],
      ['Warning', 'warning'], ['caution', 'caution'],
    ] as const) {
      const { unmount } = assistant(`> [!${written}]\n> body`);
      expect(document.querySelector('.callout'), written)
        .toHaveAttribute('data-callout', expected);
      unmount();
    }
  });

  it('leaves an ORDINARY blockquote a blockquote', () => {
    // The negative control: a quote is not an alert, and a renderer that
    // tagged every blockquote would be louder than the author asked for.
    assistant('> just a quotation');
    expect(document.querySelector('.callout')).toBeNull();
    expect(document.querySelector('blockquote')).not.toBeNull();
  });

  it('keeps the body when the marker sits ALONE on its first line', () => {
    // The arm that shifts the emptied text node out, and then the paragraph
    // itself when nothing is left of it — the shape a writer produces by
    // habit, and the one that would otherwise render an empty first line.
    assistant('> [!NOTE]\n>\n> the body is a second paragraph');
    const callout = document.querySelector('.callout');
    expect(callout).toHaveAttribute('data-callout', 'note');
    expect(callout?.textContent?.trim()).toBe('the body is a second paragraph');
  });
});

describe('keystroke-shaped inline code becomes real caps', () => {
  it('splits a combo into caps with a separator between them', () => {
    assistant('press `Cmd+K` to search');
    const caps = [...document.querySelectorAll('kbd')].map((k) => k.textContent);
    expect(caps).toEqual(['Cmd', 'K']);
    expect(document.querySelectorAll('.kbd-plus')).toHaveLength(1);
  });

  it('caps a bare NAMED key', () => {
    assistant('hit `Esc`');
    expect([...document.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Esc']);
  });

  it('leaves a bare single character as a code chip — the source says so', () => {
    // `keystrokeParts`' own comment: "bare single chars stay chips". A lone
    // `x` in prose is a variable far more often than a key.
    assistant('the flag is `x` here');
    expect(document.querySelectorAll('kbd')).toHaveLength(0);
    expect(document.querySelector('code.md-code')?.textContent).toBe('x');
  });

  it('refuses a combo whose parts are not keys', () => {
    assistant('the value is `alpha+beta` today');
    expect(document.querySelectorAll('kbd')).toHaveLength(0);
    expect(document.querySelector('code.md-code')).not.toBeNull();
  });
});

describe('the code block: a language label, and a copy that says it copied', () => {
  let written: string[];
  beforeEach(() => {
    written = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn(async (t: string) => { written.push(t); }) },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  const fenced = '```ts\nconst a = 1;\nconst b = 2;\n```';

  it('labels the language by its DISPLAY name, not by the fence token', () => {
    // `LANG_LABEL[lang] ?? (lang || 'text')`: a reader scanning a transcript
    // reads "TypeScript", not "ts". Measured rather than guessed — the first
    // version of this assertion expected the token and the code was right.
    assistant(fenced);
    expect(document.querySelector('.code-block-lang')?.textContent).toBe('TypeScript');
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
  });

  it('copies the SOURCE, flattened past the highlighter\'s own spans', () => {
    // `nodeText` exists for exactly this: by the time the button is pressed the
    // children are a tree of `hljs-*` spans, and a copy that took
    // `textContent` of the rendered DOM would be at the mercy of whatever the
    // highlighter emitted. Both lines must come back, in order.
    assistant(fenced);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('const a = 1;');
    expect(written[0]).toContain('const b = 2;');
  });

  it('says Copied, and stops saying it after 1600ms', async () => {
    // The latch is the whole feedback: a button that says `Copy` for ever
    // leaves the reader unsure whether the tap landed. 1600 is the source's
    // own number, so the test moves the clock by it rather than guessing.
    vi.useFakeTimers();
    assistant(fenced);
    const btn = screen.getByRole('button', { name: 'Copy code' });
    fireEvent.click(btn);
    await vi.waitFor(() => expect(btn.textContent).toBe('Copied'));
    expect(btn).toHaveAttribute('data-copied');
    vi.advanceTimersByTime(1600);
    await vi.waitFor(() => expect(btn.textContent).toBe('Copy'));
    expect(btn).not.toHaveAttribute('data-copied');
  });

  it('calls an UNLABELLED fence `text` rather than guessing a language', () => {
    // The `|| 'text'` arm. A blank label would leave the bar looking broken;
    // a GUESSED one would highlight by coincidence, which is worse.
    assistant('```\nplain text\n```');
    expect(document.querySelector('.code-block')).not.toBeNull();
    expect(document.querySelector('.code-block-lang')?.textContent).toBe('text');
  });
});

describe('a markdown table gets its own scroll container', () => {
  it('wraps the table so a wide one scrolls instead of widening the chat', () => {
    assistant('| a | b |\n| - | - |\n| 1 | 2 |');
    const wrap = document.querySelector('.md-table-wrap');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('table'), 'the wrapper owns the table, not the other way round')
      .not.toBeNull();
  });
});

describe('the link arms that are not http', () => {
  it('passes a `mailto:` through unchanged — only a SCHEME-LESS host is rewritten', () => {
    // `absolute`'s second arm. Prefixing `https://` onto `mailto:a@b.c` would
    // make a mail link unopenable; the rewrite exists only for a bare host,
    // which would otherwise resolve same-origin and be swallowed by the PWA's
    // navigation fallback.
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    assistant('[mail me](mailto:ops@example.com)');
    fireEvent.click(screen.getByRole('link', { name: 'mail me' }));
    expect(open).toHaveBeenCalledWith('mailto:ops@example.com', '_blank', 'noopener,noreferrer');
  });

  it('does nothing at all for a link with no target', () => {
    // `openExternal`'s `if (!href) return` — and the DEFAULT is not prevented
    // either, so the browser keeps whatever behaviour an empty href has
    // instead of the app swallowing the tap.
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    assistant('[nowhere]()');
    const link = screen.getByText('nowhere');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(open).not.toHaveBeenCalled();
    expect(ev.defaultPrevented, 'an empty href is the browser\'s business').toBe(false);
  });
});

describe('a blockquote that only LOOKS like an alert', () => {
  it('is not tagged when its first child is a list', () => {
    // `remarkAlerts`' first guard: `p.type !== 'paragraph'`. A quoted list
    // whose first item happens to start with the marker text is still a list.
    assistant('> - [!NOTE] inside a list item');
    expect(document.querySelector('.callout')).toBeNull();
    expect(document.querySelector('blockquote li')).not.toBeNull();
  });

  it('is not tagged when the marker is emphasised rather than plain text', () => {
    // The second guard: `lead.type !== 'text'`. Emphasis makes the lead an
    // `emphasis` node, and the marker is then prose the author styled, not
    // syntax — which is exactly the distinction the guard keeps.
    assistant('> *[!NOTE]* styled, not syntax');
    expect(document.querySelector('.callout')).toBeNull();
    expect(document.querySelector('blockquote em')).not.toBeNull();
  });
});

describe('the receipt, and the attachments a user message carries', () => {
  it('prints no time at all for an unparsable stamp — receipts degrade quietly', () => {
    render(<MessageBubble id="s" event={{ kind: 'user', uuid: 'u1', ts: 'not-a-date', text: 'hi' }} />);
    const receipt = document.querySelector('.msg-receipt');
    expect(receipt?.textContent?.trim(), 'the tick stays, the time goes').toBe('✓');
  });

  it('renders a sent clip as a thumbnail, and its PATH leaves the prose', () => {
    // `splitClipPaths` pulls the typed path out of the text: the reader sees
    // the image they attached, not the filename ccd typed into the pane.
    render(
      <MessageBubble id="demo-quiet-mesa" event={{
        kind: 'user', uuid: 'u2', ts: '2026-07-21T20:00:00Z',
        text: '/home/rc/.cc-clips/demo-quiet-mesa/clip-1-a1b2.png look at this',
      }} />,
    );
    const img = screen.getByRole('img', { name: 'clip-1-a1b2.png' });
    expect(img).toHaveClass('msg-attach-img');
    expect(screen.getByText('look at this'), 'the prose keeps only the words').toBeInTheDocument();
    expect(screen.queryByText(/\.cc-clips/), 'the path is not prose').toBeNull();
  });

  it('degrades a clip deleted off disk to its NAME, never a broken-image box', () => {
    // `onError` → the name. A broken-image icon would read as a bug in the
    // app rather than as a file the operator removed.
    render(
      <MessageBubble id="demo-quiet-mesa" event={{
        kind: 'user', uuid: 'u3', ts: '2026-07-21T20:00:00Z',
        text: '/home/rc/.cc-clips/demo-quiet-mesa/clip-9-zzzz.png',
      }} />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'clip-9-zzzz.png' }));
    expect(screen.getByText('clip-9-zzzz.png')).toHaveClass('msg-attach-gone');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
