// Chat hardening (native Docs reader, W4 Task 6; design 2026-10-01 section 4.12's chat clauses 1-4 under ruling U3
// = (b), section 4.15's M4.C1, M4.C2 and M4.C3, and M4.P7's chat half; the W4 plan's refinements (i), (j) and (k)).
// Every case renders `MessageBubble`, the component chat mounts, except the two pure functions' tables. jsdom has no
// `Worker`, so the real `chatRunner` answers `worker-unavailable`; a case that needs a tree from the worker path
// spies `chatRunner.parse` (ChatMarkdown's default parser reads it at call time) and answers with `parseMarkdown`,
// the function the worker runs. `message-links.test.tsx` runs beside this file, UNMODIFIED.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MessageBubble } from '../src/session/MessageBubble';
import { CHAT_COMPONENTS, chatPlainNote, isRefusedChatImageSrc, keystrokeParts } from '../src/lib/markdown';
import { remarkAlerts } from '../src/lib/remarkAlerts';
import { chatRunner } from '../src/lib/markdownRunner';
import { parseMarkdown, type ParseOutcome } from '../src/lib/markdownParse';
import { utf8ByteLength } from '../src/lib/markdownGuard';
import {
  CHAT_PARSE_BUDGET_MS, CHAT_SYNC_MAX_BYTES, DOCS_MAX_RENDER_ELEMENTS, MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN,
  MD_MAX_TREE_DEPTH,
} from '../src/lib/markdownLimits';
import { CHAT_CORPUS } from './markdownCorpus';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const bubble = (text: string, streaming = false) => (
  <MessageBubble id="s" event={{ kind: 'assistant', uuid: 'a1', ts: '2026-07-21T20:00:00Z', text }} streaming={streaming} />
);

/** An assistant message of `text`; `rerender` takes the next text of the same message. */
function assistant(text: string, streaming = false) {
  const r = render(bubble(text, streaming));
  return { ...r, next: (t: string) => r.rerender(bubble(t, streaming)) };
}

/** Spies the chat runner with a parser that never settles: it only counts calls. */
const countChatParses = () =>
  vi.spyOn(chatRunner, 'parse').mockImplementation(() => new Promise<ParseOutcome>(() => undefined));

/** Spies the chat runner with a parser each of whose calls waits for the test. */
function deferChatParses() {
  const calls: { readonly src: string; readonly resolve: (o: ParseOutcome) => void }[] = [];
  vi.spyOn(chatRunner, 'parse').mockImplementation(
    (src) => new Promise<ParseOutcome>((resolve) => {
      calls.push({ src, resolve });
    }),
  );
  return calls;
}

/** Answers call `i` inside `act`: with the outcome given, else with what the worker would answer. */
async function answer(calls: ReturnType<typeof deferChatParses>, i: number, outcome?: ParseOutcome): Promise<void> {
  const call = calls[i];
  if (call === undefined) throw new Error(`no call ${i}`);
  await act(async () => {
    call.resolve(outcome ?? parseMarkdown(call.src));
  });
}

const plainOf = (c: HTMLElement): Element | null => c.querySelector('.msg-assist > pre.msg-plain');
const noteOf = (c: HTMLElement): string | null => c.querySelector('.msg-assist > p.msg-plain-note')?.textContent ?? null;

/** A paragraph of `n` ASCII bytes after `head`. */
const longText = (head: string, n = 5000): string => `${head}\n\n${'a'.repeat(n)}`;

const UNAVAILABLE = 'Shown as plain text: this browser cannot format long messages in the background.';

describe('M4.C1: the pre-scan in front of the synchronous path', () => {
  it("an assistant '>'.repeat(4000) renders .msg-plain with its container-depth note, and never reaches the runner", () => {
    const spy = countChatParses();
    const text = '>'.repeat(4000);
    const { container } = assistant(text);
    const pre = plainOf(container);
    expect(pre?.textContent).toBe(text);
    expect(pre?.nextElementSibling?.className).toBe('msg-plain-note');
    expect(noteOf(container)).toBe(`Shown as plain text: line 1 nests 4000 levels deep (limit ${MD_MAX_CONTAINER_DEPTH}).`);
    expect(container.querySelector('blockquote')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('a 4 096-run of * renders .msg-plain with its delimiter-run note', () => {
    const text = '*'.repeat(4096);
    const { container } = assistant(text);
    expect(plainOf(container)?.textContent).toBe(text);
    expect(noteOf(container)).toBe(`Shown as plain text: line 1 has a run of 4096 emphasis marks (limit ${MD_MAX_DELIMITER_RUN}).`);
  });

  it('nesting at the limit still formats', () => {
    const { container } = assistant(`${'>'.repeat(MD_MAX_CONTAINER_DEPTH)} deep`);
    expect(plainOf(container)).toBeNull();
    expect(container.querySelectorAll('blockquote')).toHaveLength(MD_MAX_CONTAINER_DEPTH);
  });
});

describe('M4.C2: messages over CHAT_SYNC_MAX_BYTES parse through chatRunner', () => {
  it('the runner is called for a 5 000-byte message, with the chat profile and budget, and not for a 4 000-byte one', () => {
    const spy = countChatParses();
    assistant('a'.repeat(4000));
    expect(spy).not.toHaveBeenCalled();
    cleanup();
    const text = 'a'.repeat(5000);
    assistant(text);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(text);
    expect(spy.mock.calls[0]![1]).toMatchObject({ profile: 'chat', budgetMs: CHAT_PARSE_BUDGET_MS });
  });

  it('bytes decide, not characters: 4 096 UTF-8 bytes stay synchronous, 4 097 go to the runner', () => {
    const atLimit = String.fromCharCode(0xe9).repeat(CHAT_SYNC_MAX_BYTES / 2);
    const overLimit = `${atLimit}a`;
    expect([utf8ByteLength(atLimit), atLimit.length]).toEqual([CHAT_SYNC_MAX_BYTES, CHAT_SYNC_MAX_BYTES / 2]);
    expect(utf8ByteLength(overLimit)).toBe(CHAT_SYNC_MAX_BYTES + 1);
    const spy = countChatParses();
    const { container, next } = assistant(atLimit);
    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector('.msg-assist > p')?.textContent).toBe(atLimit);
    next(overLimit);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(plainOf(container)?.textContent).toBe(overLimit);
  });

  it('with no Worker, a 5 KiB message shows .msg-plain and the worker-unavailable note (M4.P7, chat half)', async () => {
    expect((globalThis as { Worker?: unknown }).Worker).toBeUndefined();
    const text = longText('# Title');
    const { container } = assistant(text);
    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    expect(plainOf(container)?.textContent).toBe(text);
    expect(container.querySelector('h1')).toBeNull();
  });

  it('a tree from the worker path renders the same HTML as the synchronous path would', async () => {
    const text = [...CHAT_CORPUS.map((c) => c.text), '[go](javascript:alert(1))'].join('\n\n');
    expect(utf8ByteLength(text)).toBeGreaterThan(CHAT_SYNC_MAX_BYTES);
    const calls = deferChatParses();
    const viaWorker = assistant(text).container;
    await answer(calls, 0);
    expect(plainOf(viaWorker)).toBeNull();
    const sync = render(
      <div className="msg-assist">
        <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>
      </div>,
    ).container;
    expect(viaWorker.querySelector('.msg-assist')!.innerHTML).toBe(sync.querySelector('.msg-assist')!.innerHTML);
    expect(viaWorker.innerHTML).not.toContain('javascript:');
  });

  it('.msg-plain until the first outcome, then the last good tree while newer text parses, then the note', async () => {
    const calls = deferChatParses();
    const first = longText('# First');
    const { container, next } = assistant(first);
    expect(plainOf(container)?.textContent).toBe(first);
    expect(noteOf(container)).toBeNull();
    await answer(calls, 0);
    expect(screen.getByRole('heading', { name: 'First' })).toBeTruthy();
    expect(plainOf(container)).toBeNull();

    const second = `${first}\n\n## Second`;
    next(second);
    expect(calls).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'First' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Second' })).toBeNull();
    expect(plainOf(container)).toBeNull();
    await answer(calls, 1);
    expect(screen.getByRole('heading', { name: 'Second' })).toBeTruthy();

    const third = `${second} more`;
    next(third);
    await answer(calls, 2, { kind: 'timeout', budgetMs: CHAT_PARSE_BUDGET_MS });
    expect(plainOf(container)?.textContent).toBe(third);
    expect(noteOf(container)).toBe('Shown as plain text: formatting took longer than 2 s.');
    expect(container.querySelector('h1')).toBeNull();
    expect(screen.queryByText(/format anyway/i)).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it("a non-tree outcome for an older text never puts its note under a newer text that is still parsing", async () => {
    const calls = deferChatParses();
    const { container, next } = assistant(longText('# First'));
    await answer(calls, 0, { kind: 'timeout', budgetMs: CHAT_PARSE_BUDGET_MS });
    expect(noteOf(container)).toBe('Shown as plain text: formatting took longer than 2 s.');
    const second = longText('# Second');
    next(second);
    expect(calls).toHaveLength(2);
    expect(plainOf(container)?.textContent).toBe(second);
    expect(noteOf(container)).toBeNull();
    expect(container.querySelector('h1')).toBeNull();
  });

  it('the streaming caret stays after the body on the worker path, before and after the tree', async () => {
    const calls = deferChatParses();
    const { container } = assistant(longText('# Streaming'), true);
    const assist = container.querySelector('.msg-assist')!;
    expect(assist.lastElementChild?.className).toBe('stream-caret');
    expect(assist.lastElementChild?.previousElementSibling?.className).toBe('msg-plain');
    await answer(calls, 0);
    expect(assist.lastElementChild?.className).toBe('stream-caret');
    expect(assist.firstElementChild?.tagName).toBe('H1');
  });
});

describe("chatPlainNote: one sentence per outcome chat does not format (the W4 plan's refinement (j))", () => {
  type NonTree = Exclude<ParseOutcome, { kind: 'tree' }>;
  // Keyed on every kind: a new ParseOutcome arm is a compile error here until it has a sentence.
  const NOTES: { readonly [K in NonTree['kind']]: readonly (readonly [Extract<NonTree, { kind: K }>, string])[] } = {
    refused: [
      [{ kind: 'refused', why: 'container-depth', line: 3, value: 40 },
        `Shown as plain text: line 3 nests 40 levels deep (limit ${MD_MAX_CONTAINER_DEPTH}).`],
      [{ kind: 'refused', why: 'delimiter-run', line: 2, value: 65 },
        `Shown as plain text: line 2 has a run of 65 emphasis marks (limit ${MD_MAX_DELIMITER_RUN}).`],
    ],
    'too-deep': [[{ kind: 'too-deep', depth: 70 },
      `Shown as plain text: this message nests 70 levels deep (limit ${MD_MAX_TREE_DEPTH}).`]],
    'too-wide': [[{ kind: 'too-wide', elements: 20001 },
      `Shown as plain text: this message would draw 20001 elements (limit ${DOCS_MAX_RENDER_ELEMENTS}).`]],
    threw: [[{ kind: 'threw', error: 'RangeError' }, 'Shown as plain text: it could not be formatted (RangeError).']],
    timeout: [
      [{ kind: 'timeout', budgetMs: 2000 }, 'Shown as plain text: formatting took longer than 2 s.'],
      [{ kind: 'timeout', budgetMs: 30000 }, 'Shown as plain text: formatting took longer than 30 s.'],
    ],
    'worker-unavailable': [[{ kind: 'worker-unavailable' }, UNAVAILABLE]],
    'worker-failed': [[{ kind: 'worker-failed', error: 'messageerror' },
      'Shown as plain text: the formatter stopped (messageerror).']],
  };

  it('covers the seven kinds', () => {
    expect(Object.keys(NOTES).sort()).toEqual(
      ['refused', 'threw', 'timeout', 'too-deep', 'too-wide', 'worker-failed', 'worker-unavailable'],
    );
  });

  it.each(Object.values(NOTES).flat().map(([o, s]) => [JSON.stringify(o), o, s] as const))('%s', (_name, o, sentence) => {
    expect(chatPlainNote(o)).toBe(sentence);
  });
});

const TAB = String.fromCharCode(9);

describe('M4.C3: chat refuses a root-relative or protocol-relative image source', () => {
  it('![](/api/example/x) draws no image and renders the URL as a plain link', () => {
    const { container } = assistant('![](/api/example/x)');
    expect(container.querySelector('img[src^="/api"]')).toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(0);
    const link = screen.getByRole('link', { name: '/api/example/x' });
    expect(link.getAttribute('href')).toBe('/api/example/x');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.className).toBe('');
  });

  it.each([
    ['protocol-relative', '![](//h.example/x.png)', '//h.example/x.png'],
    ['slash then backslash', '![](/\\h.example/x.png)', '/%5Ch.example/x.png'],
    ['root-relative with alt text', '![a chart](/x.png)', '/x.png'],
  ])('an image, %s, draws no image: %s', (_name, text, href) => {
    const { container } = assistant(text);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getByRole('link', { name: href }).getAttribute('href')).toBe(href);
  });

  it.each([
    ['root-relative', '[x](/files/a.png)', '/files/a.png'],
    ['protocol-relative', '[x](//h.example/a.png)', '//h.example/a.png'],
  ])('a link to an image file, %s, is not auto-embedded: %s', (_name, text, href) => {
    const { container } = assistant(text);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    const link = screen.getByRole('link', { name: 'x' });
    expect(link.getAttribute('href')).toBe(href);
    expect(link.className).toBe('');
  });

  it.each([
    ['a backslash', '![](\\\\h.example/x.png)', '%5Ch.example/x.png'],
    ['a leading tab', `![](<${TAB}//h.example/x.png>)`, '%09//h.example/x.png'],
  ])('the parser percent-encodes %s, so the image source is path-relative, never root- or protocol-relative', (_name, text, src) => {
    const { container } = assistant(text);
    const imgs = [...container.querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([src]);
    expect(isRefusedChatImageSrc(src)).toBe(false);
  });

  it('a same-scheme special-relative https:/ source draws no image, as an img or as an auto-embed', () => {
    const asImg = assistant('![](https:/api/example/x)');
    expect(asImg.container.querySelectorAll('img')).toHaveLength(0);
    const imgLink = screen.getByRole('link', { name: 'https:/api/example/x' });
    expect(imgLink.getAttribute('href')).toBe('https:/api/example/x');
    expect(imgLink.className).toBe('');
    cleanup();
    const asLink = assistant('[x](https:/files/a.png)');
    expect(asLink.container.querySelectorAll('img')).toHaveLength(0);
    const link = screen.getByRole('link', { name: 'x' });
    expect(link.getAttribute('href')).toBe('https:/files/a.png');
    expect(link.className).toBe('');
  });

  it('an https image still embeds', () => {
    assistant('![ok](https://example.com/c.png)');
    expect(screen.getByRole('img', { name: 'ok' }).getAttribute('src')).toBe('https://example.com/c.png');
  });

  it('the worker path refuses too', async () => {
    const calls = deferChatParses();
    const { container } = assistant(longText('![](/api/example/x)\n\n![ok](https://example.com/c.png)'));
    await answer(calls, 0);
    expect(plainOf(container)).toBeNull();
    expect(container.querySelector('img[src^="/"]')).toBeNull();
    expect(screen.getByRole('img', { name: 'ok' }).getAttribute('src')).toBe('https://example.com/c.png');
    expect(screen.getByRole('link', { name: '/api/example/x' })).toBeTruthy();
  });
});

describe('isRefusedChatImageSrc: the URL parser\'s own reading of "root-relative or protocol-relative"', () => {
  const NUL = String.fromCharCode(0);
  const US = String.fromCharCode(0x1f);
  const LF = String.fromCharCode(10);
  it.each([
    '/api/example/x', '//h.example/x.png', '\\\\h.example/x.png', '/\\h.example/x.png', '\\/h.example/x.png',
    `${TAB}//h.example/x.png`, ' /api/x', `${NUL}/api/x`, `${US}${LF}//h.example/x`, '/',
    // A same-scheme special-relative http(s) source resolves against the page's own origin.
    'https:/api/x', 'HTTPS:/api/x', 'https:\\api\\x', '  https:/api/x', 'http:/x.png', `${TAB}https:/api/x`,
  ])('refuses %j', (src) => {
    expect(isRefusedChatImageSrc(src)).toBe(true);
  });

  // Path-relative sources are NOT refused (refinement (k); widening is the operator's open question).
  it.each([
    'https://example.com/c.png', 'http://example.com/c.png', 'https://h.example/x.png', 'http://h.example/x.png',
    'HTTPS://h.example/x.png', 'https:\\\\h.example/x.png', 'mailto:a@example.com', 'example.com/x.png', '../api/x',
    'x.png', '%5Ch.example/x.png', '',
  ])('keeps %j', (src) => {
    expect(isRefusedChatImageSrc(src)).toBe(false);
  });

  it('keeps an absent source', () => {
    expect(isRefusedChatImageSrc(undefined)).toBe(false);
  });
});

describe('T11 review 2-2: a keystroke chord is split into chips only up to a bound a 4 KiB message can reach', () => {
  // The longest chord of single-character parts inside backticks and 4 096 bytes: 2 + 4 093 bytes, 2 047 parts.
  const MAX_SYNC_PARTS = Math.floor((CHAT_SYNC_MAX_BYTES - 2 + 1) / 2);
  const chord = (n: number): string => `${'a+'.repeat(n - 1)}a`;

  it('a 200 KB chord on the worker path draws a bounded number of elements, as plain inline code', async () => {
    const calls = deferChatParses();
    const text = `\`${chord(100001)}\``;
    expect(utf8ByteLength(text)).toBeGreaterThan(200000);
    const { container } = assistant(text);
    await answer(calls, 0);
    expect(plainOf(container)).toBeNull();
    expect(container.querySelectorAll('*').length).toBeLessThanOrEqual(DOCS_MAX_RENDER_ELEMENTS);
    expect(container.querySelectorAll('kbd')).toHaveLength(0);
    expect(container.querySelector('code.md-code')?.textContent).toBe(chord(100001));
  });

  it('a normal chord still draws chips on both paths', async () => {
    const sync = assistant('Press `Ctrl+Shift+P` now.');
    expect([...sync.container.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Ctrl', 'Shift', 'P']);
    cleanup();
    const calls = deferChatParses();
    const { container } = assistant(longText('Press `Ctrl+Shift+P` now.'));
    await answer(calls, 0);
    expect([...container.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Ctrl', 'Shift', 'P']);
  });

  it('the longest chord a 4 KiB message can hold is still chips, so chat at 4 KiB renders as before', () => {
    const text = `\`${chord(MAX_SYNC_PARTS)}\``;
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(CHAT_SYNC_MAX_BYTES);
    const { container } = assistant(text);
    expect(container.querySelectorAll('kbd')).toHaveLength(MAX_SYNC_PARTS);
    expect(container.querySelector('code.md-code')).toBeNull();
  });

  it('keystrokeParts answers null past CHAT_SYNC_MAX_BYTES / 2 parts and parts at that count', () => {
    expect(keystrokeParts(chord(MAX_SYNC_PARTS))).toHaveLength(MAX_SYNC_PARTS);
    expect(keystrokeParts(chord(CHAT_SYNC_MAX_BYTES / 2))).toHaveLength(CHAT_SYNC_MAX_BYTES / 2);
    expect(keystrokeParts(chord(CHAT_SYNC_MAX_BYTES / 2 + 1))).toBeNull();
  });
});

describe('T11 review 3-4: the last good tree stays while a newer text parses after a non-tree outcome', () => {
  it('tree, then a timeout, then a newer text pending: the tree shows, not bare plain text', async () => {
    const calls = deferChatParses();
    const first = longText('# First');
    const { container, next } = assistant(first);
    await answer(calls, 0);
    next(`${first} two`);
    await answer(calls, 1, { kind: 'timeout', budgetMs: CHAT_PARSE_BUDGET_MS });
    expect(noteOf(container)).toBe('Shown as plain text: formatting took longer than 2 s.');
    next(`${first} three`);
    expect(calls).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'First' })).toBeTruthy();
    expect(plainOf(container)).toBeNull();
    expect(noteOf(container)).toBeNull();
  });
});

describe('T11 review N1: streaming shows each newer settled tree; A -> B -> A never shows B under A', () => {
  const heading = (c: HTMLElement): string[] => [...c.querySelectorAll('h1')].map((h) => h.textContent ?? '');

  it('a tree that settles behind newer streaming text replaces the shown tree: One, Two, Three', async () => {
    const calls = deferChatParses();
    const { container, next } = assistant(longText('# Zero'));
    await answer(calls, 0);
    expect(heading(container)).toEqual(['Zero']);
    next(longText('# One'));
    next(longText('# Two'));
    expect(calls.map((c) => c.src.slice(0, 7))).toEqual(['# Zero\n', '# One\n\n']);
    await answer(calls, 1);
    expect(heading(container)).toEqual(['One']);
    next(longText('# Three'));
    await answer(calls, 2);
    expect(heading(container)).toEqual(['Two']);
    await answer(calls, 3);
    expect(heading(container)).toEqual(['Three']);
  });

  it("text A settled, then B, then A again: B's tree settling afterwards never shows under A", async () => {
    const calls = deferChatParses();
    const { container, next } = assistant(longText('# A'));
    await answer(calls, 0);
    next(longText('# B'));
    next(longText('# A'));
    expect(heading(container)).toEqual(['A']);
    await answer(calls, 1);
    expect(heading(container)).toEqual(['A']);
    expect(calls).toHaveLength(2);
  });
});

describe('T11 review 2-3 (operator ruling): a short message whose tables would draw more cells than the cap is plain text', () => {
  /** A table of `cols` columns, then `x` body lines until the text is as near 4 096 bytes as it can be; `cells` is
   *  the cell count the parse would draw: the header and every body line, `cols` cells each. */
  function wideTable(cols: number, prefix = '', reserve = 0): { text: string; cells: number } {
    let text = `${prefix}|${'a|'.repeat(cols)}\n${prefix}|${'-|'.repeat(cols)}\n`;
    let rows = 1;
    while (utf8ByteLength(`${text}${prefix}x\n`) + reserve <= CHAT_SYNC_MAX_BYTES) {
      text += `${prefix}x\n`;
      rows += 1;
    }
    return { text, cells: cols * rows };
  }
  const tooWide = (cells: number): string =>
    `Shown as plain text: this message would draw ${cells} elements (limit ${DOCS_MAX_RENDER_ELEMENTS}).`;

  it.each([300, 500])('a 4 096-byte %i-column table shows .msg-plain with the too-wide note and draws no table', (cols) => {
    const { text, cells } = wideTable(cols);
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(CHAT_SYNC_MAX_BYTES);
    expect(utf8ByteLength(text)).toBeGreaterThan(CHAT_SYNC_MAX_BYTES - 4);
    expect(cells).toBeGreaterThan(DOCS_MAX_RENDER_ELEMENTS);
    const spy = countChatParses();
    const { container } = assistant(text);
    expect(plainOf(container)?.textContent).toBe(text);
    expect(noteOf(container)).toBe(tooWide(cells));
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelectorAll('*').length).toBeLessThan(10);
    expect(spy).not.toHaveBeenCalled();
  });

  it('the same table inside a blockquote is counted too', () => {
    const { text, cells } = wideTable(300, '> ');
    expect(cells).toBeGreaterThan(DOCS_MAX_RENDER_ELEMENTS);
    const { container } = assistant(text);
    expect(noteOf(container)).toBe(tooWide(cells));
    expect(container.querySelector('table')).toBeNull();
  });

  it('an ordinary 10 x 10 table still renders a <table>', () => {
    const row = (c: string): string => `|${`${c}|`.repeat(10)}`;
    const text = [row('h'), row('-'), ...Array.from({ length: 9 }, () => row('c'))].join('\n');
    const { container } = assistant(text);
    expect(plainOf(container)).toBeNull();
    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(container.querySelectorAll('td')).toHaveLength(90);
  });

  it('an ordinary fenced block holding a small table-shaped text still renders as code', () => {
    const text = '```\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n';
    const { container } = assistant(text);
    expect(plainOf(container)).toBeNull();
    expect(container.querySelector('.code-block')).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('a wide table behind a fence opened inside a list item (which ends with the item) is counted: plain text', () => {
    const open = '- a\n  ```\n';
    const { text: table, cells } = wideTable(300, '', open.length);
    const text = `${open}${table}`;
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(CHAT_SYNC_MAX_BYTES);
    expect(cells).toBeGreaterThan(DOCS_MAX_RENDER_ELEMENTS);
    const { container } = assistant(text);
    expect(plainOf(container)?.textContent).toBe(text);
    expect(noteOf(container)).toMatch(/^Shown as plain text: this message would draw \d+ elements/);
    expect(container.querySelector('table')).toBeNull();
  });
});
