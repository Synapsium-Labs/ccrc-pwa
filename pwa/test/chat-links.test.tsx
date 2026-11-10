// Chat reading Task L (D-8062; spec 2026-11-06 sections 4.1 and 4.2): the chat draws the names it recognises as links, through
// `ChatRef` and `ChatLink`, with the context `SessionScreen` provides. Every case renders `MessageBubble`, the component chat
// mounts, under `ChatRefsContext` and `withSyncHighlight`. Placeholders only: repo `owner-a/repo-a`, project `project-a`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MessageBubble } from '../src/session/MessageBubble';
import { ChatRefsContext } from '../src/session/chatRefsContext';
import type { ChatRefContext } from '../src/lib/chatRefs';
import { chatRunner } from '../src/lib/markdownRunner';
import { parseMarkdown, type ParseOutcome } from '../src/lib/markdownParse';
import { utf8ByteLength } from '../src/lib/markdownGuard';
import { CHAT_SYNC_MAX_BYTES } from '../src/lib/markdownLimits';
import { navigate } from '../src/lib/router';
import { withSyncHighlight } from './highlightTestStore';

const CTX: ChatRefContext = {
  repo: 'owner-a/repo-a', project: 'project-a', branch: 'ws/one', knownRuns: new Set([12]), knownItems: new Set([3]),
  runsElsewhere: false,
};

beforeEach(() => { navigate('/s/sess-a', { replace: true }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const bubble = (text: string, ctx: ChatRefContext | null): ReactNode => withSyncHighlight(
  <ChatRefsContext value={ctx}>
    <MessageBubble id="sess-a" event={{ kind: 'assistant', uuid: 'a1', ts: '2026-11-06T12:00:00Z', text }} />
  </ChatRefsContext>,
);

const assistant = (text: string, ctx: ChatRefContext | null = CTX) => render(bubble(text, ctx));

const anchors = (c: HTMLElement): HTMLAnchorElement[] => [...c.querySelectorAll<HTMLAnchorElement>('.msg-assist a')];

describe('the chat draws a name as a link (chat reading Task L, D-8062)', () => {
  it('run 1527 is an in-app link and a plain click navigates without a new tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = assistant('Waiting on run 1527 now.');
    const [a, ...rest] = anchors(container);
    expect(rest).toEqual([]);
    expect(a!.textContent).toBe('run 1527');
    expect(a!.getAttribute('href')).toBe('/runs/1527');
    expect(a!.hasAttribute('target')).toBe(false);
    fireEvent.click(a!);
    expect(location.pathname + location.search).toBe('/runs/1527');
    expect(open).not.toHaveBeenCalled();
  });

  it('a modified click keeps the browser\'s own handling', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = assistant('See run 1527.');
    const a = anchors(container)[0]!;
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ...mod });
      act(() => { a.dispatchEvent(ev); });
      expect(ev.defaultPrevented, JSON.stringify(mod)).toBe(false);
    }
    expect(location.pathname).toBe('/s/sess-a');
    expect(open).not.toHaveBeenCalled();
  });

  it('#651 opens a new tab with no opener', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = assistant('Merged in #651.');
    const a = anchors(container)[0]!;
    expect(a.textContent).toBe('#651');
    expect(a.getAttribute('href')).toBe('https://github.com/owner-a/repo-a/issues/651');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(a);
    expect(open).toHaveBeenCalledWith('https://github.com/owner-a/repo-a/issues/651', '_blank', 'noopener,noreferrer');
    expect(location.pathname).toBe('/s/sess-a');
  });

  it('an unresolved name is plain text with no anchor', () => {
    const { container } = assistant('Try run 2 times, see #651 and item 34.', { ...CTX, repo: null });
    expect(anchors(container)).toEqual([]);
    expect(container.querySelector('.msg-assist')!.textContent).toBe('Try run 2 times, see #651 and item 34.');
  });

  it('inline code whose whole text is a path links and keeps its code element', () => {
    const { container } = assistant('Read `docs/superpowers/specs/x-design.md` first.');
    const a = anchors(container)[0]!;
    expect(a.getAttribute('href')).toBe('/docs/project-a/specs/x-design.md?ref=ws/one');
    const code = a.querySelector('code');
    expect(code?.className).toBe('md-code');
    expect(code?.textContent).toBe('docs/superpowers/specs/x-design.md');
    expect(a.textContent).toBe('docs/superpowers/specs/x-design.md');
  });

  it('inline code holding a sentence with a path does not link', () => {
    const { container } = assistant('Run `cat docs/superpowers/specs/x-design.md` and `git show 4c677d328`.');
    expect(anchors(container)).toEqual([]);
    expect(container.querySelectorAll('.msg-assist code.md-code')).toHaveLength(2);
  });

  it('a Markdown link to /runs navigates in the app', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = assistant('Open [the board](/runs) now.');
    const a = anchors(container)[0]!;
    expect(a.getAttribute('href')).toBe('/runs');
    expect(a.hasAttribute('target')).toBe(false);
    fireEvent.click(a);
    expect(location.pathname).toBe('/runs');
    expect(open).not.toHaveBeenCalled();
  });

  it('an unrouted or protocol-relative path keeps the external arm', () => {
    for (const href of ['//host/x', '/%2e%2e//host', '/api/x']) {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const { container, unmount } = assistant(`Open [this](${href}) now.`);
      const a = anchors(container)[0]!;
      expect(a.getAttribute('target'), href).toBe('_blank');
      expect(a.getAttribute('rel'), href).toBe('noopener noreferrer');
      fireEvent.click(a);
      expect(open, href).toHaveBeenCalledTimes(1);
      expect(location.pathname, href).toBe('/s/sess-a');
      unmount();
      vi.restoreAllMocks();
    }
  });

  // Review 1586 F2 and F3: a protocol-relative address keeps today's external arm; it neither throws (which dropped the whole
  // message to the plain-text fallback) nor routes to the console path it resolves to.
  it.each(['//', '///', '//a%', '//4294967296/x', '//host/runs', '//evil.example/s/abc', '//host/waiting/340'])(
    'a link to the protocol-relative %j keeps the external arm and the message renders as Markdown', (href) => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const { container } = assistant(`Open [this](${href}) now.`);
      const body = container.querySelector('.msg-assist')!;
      expect(body.querySelector('pre.msg-plain'), href).toBeNull();
      expect(body.querySelector('p')?.textContent, href).toBe('Open this now.');
      const [a, ...rest] = anchors(container);
      expect(rest, href).toEqual([]);
      expect(a!.getAttribute('target'), href).toBe('_blank');
      expect(a!.getAttribute('rel'), href).toBe('noopener noreferrer');
      fireEvent.click(a!);
      expect(open, href).toHaveBeenCalledTimes(1);
      expect(location.pathname, href).toBe('/s/sess-a');
    });

  it('the worker path draws the same links as the sync path', async () => {
    const body = 'Merged #651 at 4c677d328; run 1527 and item 340 wait. Read `docs/superpowers/plans/p.md`. [board](/runs)';
    const sync = assistant(body).container.querySelector('.msg-assist')!.innerHTML;
    cleanup();
    const long = `${body}\n\n${'a'.repeat(CHAT_SYNC_MAX_BYTES)}`;
    expect(utf8ByteLength(long)).toBeGreaterThan(CHAT_SYNC_MAX_BYTES);
    const calls: (() => void)[] = [];
    vi.spyOn(chatRunner, 'parse').mockImplementation((src, opts) => new Promise<ParseOutcome>((resolve) => {
      expect(opts.profile).toBe('chat');
      calls.push(() => resolve(parseMarkdown(src, 'chat')));
    }));
    const { container } = assistant(long);
    await act(async () => { calls[0]!(); });
    const viaWorker = container.querySelector('.msg-assist')!;
    expect(viaWorker.querySelector('pre.msg-plain')).toBeNull();
    expect(viaWorker.querySelector('p')!.outerHTML).toBe(sync);
    expect([...viaWorker.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'https://github.com/owner-a/repo-a/issues/651', 'https://github.com/owner-a/repo-a/commit/4c677d328', '/runs/1527',
      '/waiting/340', '/docs/project-a/plans/p.md?ref=ws/one', '/runs',
    ]);
  });

  it('without a provider the output is byte-identical to today\'s', () => {
    const text = 'Merged #651 at 4c677d328; run 1527 waits. Read `docs/superpowers/plans/p.md`.';
    const without = render(withSyncHighlight(
      <MessageBubble id="sess-a" event={{ kind: 'assistant', uuid: 'a1', ts: '2026-11-06T12:00:00Z', text }} />,
    )).container.innerHTML;
    cleanup();
    const withNull = assistant(text, null).container.innerHTML;
    expect(withNull).toBe(without);
    expect(without).not.toContain('<a ');
    expect(without).toContain('Merged #651 at 4c677d328; run 1527 waits. Read <code class="md-code">docs/superpowers/plans/p.md</code>.');
  });
});

// Review 1586 F1: never a link inside a link. A whole-name code span inside a Markdown link draws the link's own anchor alone,
// so one click does one thing: the link's.
describe('a name inside a link draws that link alone (chat reading Task L, D-8062)', () => {
  const GH = 'https://github.com/owner-a/repo-a';
  it.each([
    ['[`#651`](https://example.com/x)', 'https://example.com/x'],
    ['[`run 1527`](/runs)', '/runs'],
    [`[\`docs/superpowers/specs/x-design.md\`](${GH}/blob/main/docs/superpowers/specs/x-design.md)`, `${GH}/blob/main/docs/superpowers/specs/x-design.md`],
    [`[\`4c677d328\`](${GH}/commit/4c677d328)`, `${GH}/commit/4c677d328`],
  ])('%s draws one anchor and one click does one thing', (md, href) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = assistant(`See ${md} now.`);
    const all = anchors(container);
    expect(all).toHaveLength(1);
    const a = all[0]!;
    expect(a.getAttribute('href')).toBe(href);
    const code = a.querySelector('code');
    expect(code?.className).toBe('md-code');
    fireEvent.click(code!);
    if (href.startsWith('/')) {
      expect(open).not.toHaveBeenCalled();
      expect(location.pathname + location.search).toBe(href);
    } else {
      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith(href, '_blank', 'noopener,noreferrer');
      expect(location.pathname).toBe('/s/sess-a');
    }
  });

  // Review 1597 F1, fix round 2 ruling 1: an image written as a link's text draws without its own anchor, and a refused image
  // source there draws as text, never its own link.
  it.each([
    ['[![run 1527](https://example.com/y.png)](https://example.com)', 'img'],
    ['[![run 1527](/y.png)](https://example.com)', 'text'],
  ])('%s draws one anchor and one window.open', (md, inner) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = assistant(`See ${md} now.`);
    const all = anchors(container);
    expect(all).toHaveLength(1);
    const a = all[0]!;
    expect(a.getAttribute('href')).toBe('https://example.com');
    const img = a.querySelector('img');
    if (inner === 'img') {
      expect(img?.getAttribute('src')).toBe('https://example.com/y.png');
      expect(img?.getAttribute('alt')).toBe('run 1527');
      expect(img?.className).toBe('msg-img');
    } else {
      expect(img).toBeNull();
      expect(a.textContent).toBe('/y.png');
    }
    fireEvent.click(img ?? a);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
  });

  // Review 1606 F1 (desktop-polish Task C14, D-8110): a link the parser itself makes inside a link's text (an angle-bracket
  // autolink, a mailto autolink, a footnote reference) draws as text, so the outer link is the one anchor and one click.
  it.each([
    ['[<https://example.com/a> x](https://example.com/v)', 'https://example.com/a x'],
    ['[a <mailto:x@example.com> b](https://example.com/v)', 'a mailto:x@example.com b'],
    ['[see[^1]](https://example.com/v)\n\n[^1]: a note', 'see1'],
  ])('%s draws one anchor and one window.open', (md, text) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = assistant(`See ${md}`);
    expect(container.querySelectorAll('.msg-assist a a')).toHaveLength(0);
    const outer = anchors(container).filter((a) => a.getAttribute('href') === 'https://example.com/v');
    expect(outer).toHaveLength(1);
    expect(outer[0]!.textContent).toBe(text);
    fireEvent.click(outer[0]!.firstChild!);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com/v', '_blank', 'noopener,noreferrer');
  });

  it('the same autolink outside a link keeps its own anchor', () => {
    const { container } = assistant('See <https://example.com/a> now.');
    expect(anchors(container).map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a']);
  });

  it('the same image outside a link keeps its own tap-to-open anchor', () => {
    const { container } = assistant('See ![run 1527](https://example.com/y.png) now.');
    const all = anchors(container);
    expect(all.map((a) => [a.className, a.getAttribute('href')])).toEqual([['msg-img-link', 'https://example.com/y.png']]);
  });

  it('the same code span outside a link still links', () => {
    const { container } = assistant('See `#651` and [`#651`](https://example.com/x).');
    expect(anchors(container).map((a) => a.getAttribute('href'))).toEqual([
      'https://github.com/owner-a/repo-a/issues/651', 'https://example.com/x',
    ]);
  });
});

// Desktop polish Task C21 (D-8172; spec 2026-11-06 R15): a PR or commit name opens the repository the message means, or stays
// text, in both of the chat's paths. Neutral names: home `owner-a/repo-a`, another `owner-b/repo-b`.
describe('a PR or commit opens the repository the message means (Task C21, D-8172)', () => {
  const CROSS: ChatRefContext = { ...CTX, runsElsewhere: true };
  const screenshot = '#666 (the complete reference) \u2014 OPEN \u2014 `github.com/owner-b/repo-b/pull/666`';

  it('the screenshot case: a bare #666 beside a code span naming another repository\'s #666 opens that repository', () => {
    const { container } = assistant(screenshot, CROSS);
    expect(anchors(container).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['#666', 'https://github.com/owner-b/repo-b/issues/666'],
    ]);
  });

  it('a cross-repository coordinator\'s bare #512 with no evidence is text, its owner/repo#12 opens that repository', () => {
    const { container } = assistant('#512 is green; owner-b/repo-b#12 merged.', CROSS);
    expect(anchors(container).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['owner-b/repo-b#12', 'https://github.com/owner-b/repo-b/issues/12'],
    ]);
    expect(container.querySelector('.msg-assist')!.textContent).toBe('#512 is green; owner-b/repo-b#12 merged.');
  });

  it('a single-repository session\'s plain #123 opens the home repository, as before', () => {
    const { container } = assistant('Merged #123.');
    expect(anchors(container).map((a) => a.getAttribute('href'))).toEqual(['https://github.com/owner-a/repo-a/issues/123']);
  });

  it('two qualified names for one number each open their own repository, and the bare #12 between them is text', () => {
    const { container } = assistant('owner-b/repo-b#12 and owner-c/repo-c#12 both say #12.', CROSS);
    expect(anchors(container).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['owner-b/repo-b#12', 'https://github.com/owner-b/repo-b/issues/12'],
      ['owner-c/repo-c#12', 'https://github.com/owner-c/repo-c/issues/12'],
    ]);
  });

  it('two code spans naming two repositories for one number each open their own (review 1758 F9)', () => {
    const { container } = assistant('See `owner-b/repo-b#12` and `owner-c/repo-c#12`.', CROSS);
    expect(anchors(container).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['owner-b/repo-b#12', 'https://github.com/owner-b/repo-b/issues/12'],
      ['owner-c/repo-c#12', 'https://github.com/owner-c/repo-c/issues/12'],
    ]);
    expect(container.querySelectorAll('.msg-assist a > code')).toHaveLength(2);
  });

  it('a whole code span holding owner/repo#n links there', () => {
    const { container } = assistant('See `owner-b/repo-b#12`.', CROSS);
    expect(anchors(container).map((a) => a.getAttribute('href'))).toEqual(['https://github.com/owner-b/repo-b/issues/12']);
  });

  it('the worker path resolves the same way as the sync path', async () => {
    const body = `${screenshot}; #512 waits; owner-b/repo-b#12 merged.`;
    const sync = assistant(body, CROSS).container.querySelector('.msg-assist')!.innerHTML;
    cleanup();
    const long = `${body}\n\n${'a'.repeat(CHAT_SYNC_MAX_BYTES)}`;
    const calls: (() => void)[] = [];
    vi.spyOn(chatRunner, 'parse').mockImplementation((src) => new Promise<ParseOutcome>((resolve) => {
      calls.push(() => resolve(parseMarkdown(src, 'chat')));
    }));
    const { container } = assistant(long, CROSS);
    await act(async () => { calls[0]!(); });
    const viaWorker = container.querySelector('.msg-assist')!;
    expect(viaWorker.querySelector('p')!.outerHTML).toBe(sync);
    expect([...viaWorker.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'https://github.com/owner-b/repo-b/issues/666', 'https://github.com/owner-b/repo-b/issues/12',
    ]);
  });
});
