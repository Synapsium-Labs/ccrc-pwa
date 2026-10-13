// Chat's Markdown renderer, extracted from `session/MessageBubble.tsx` (native Docs reader, W4 Task 2; design
// 2026-10-01 section 4.9) so chat and the Docs screen share one set of components. Moved unchanged: the image
// test, `absolute`, `openExternal`, the highlight.js registration (a module side effect), `LANG_LABEL`,
// `nodeText`, `keystrokeParts`, `CodeBlock`, `TableWrap`, and today's `mdComponents` split into
// `SHARED_COMPONENTS` (code, pre, table) and `CHAT_COMPONENTS` (those plus chat's `a` and `img`). `ChatMarkdown`
// is both of `MessageBubble`'s Markdown sites. `markdown-golden.test.tsx` holds chat's output byte for byte.
// Hardened per ruling U3 (W4 Task 6; section 4.12): a message of at most `CHAT_SYNC_MAX_BYTES` UTF-8 bytes is
// pre-scanned, then rendered as before; a longer one parses in `chatRunner`'s worker; whatever is not formatted
// shows as `MsgPlain` with `chatPlainNote`'s sentence; and `isRefusedChatImageSrc` keeps chat from drawing an
// image whose source is root-relative or protocol-relative (`chat-hardening.test.tsx`).
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import React, { useCallback, useState, type ReactNode } from 'react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml'; // html / svg
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import sql from 'highlight.js/lib/languages/sql';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import { remarkAlerts } from './remarkAlerts';
import {
  CHAT_PARSE_BUDGET_MS, CHAT_SYNC_MAX_BYTES, DOCS_MAX_RENDER_ELEMENTS, MD_HIGHLIGHT_BLOCK_MAX_CHARS,
  MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN, MD_MAX_TREE_DEPTH,
} from './markdownLimits';
import { prescanMarkdown, utf8ByteLength } from './markdownGuard';
import type { ParseOutcome } from './markdownParse';
import { chatRunner, type MarkdownParser } from './markdownRunner';
import { renderHast, type RenderHastOptions } from './renderHast';
import { useParsedMarkdown } from './useParsedMarkdown';
import '../session/chat.css';

export const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
export const isImageUrl = (href: string | undefined): href is string => href !== undefined && IMG_EXT.test(href);

/** Whether chat refuses `src` as an image source: true when it is root-relative or protocol-relative as the browser
 *  resolves it, including a same-scheme special-relative http(s): source. Leading ASCII whitespace and C0 controls
 *  are skipped, as a browser strips them from an attribute URL, and a leading backslash counts as a slash, as the
 *  parser reads it (`\\h/x` is `//h/x`). An http(s) scheme NOT followed by two slashes or backslashes
 *  (`https:/api/x`) is refused too: when it is the page's own scheme it resolves against the page's origin; when it
 *  is the other scheme the parser reads it as an absolute URL whose host is the next segment. The predicate does not
 *  know the page's scheme, so refusing the other scheme as well is a deliberate over-refusal. A refused source would
 *  be fetched from ccrc's own origin, or from a host the message names, carrying the operator's cookie. A
 *  path-relative source (`x.png`, `../x`) is not refused; absent (`undefined`) is not refused either.
 *  Takes the value after react-markdown's `defaultUrlTransform`. The ONE predicate: `img` and the auto-embed in `a`
 *  both call it. */
export function isRefusedChatImageSrc(src: string | undefined): boolean {
  if (src === undefined) return false;
  let i = 0;
  while (i < src.length && src.charCodeAt(i) <= 0x20) i += 1;
  if (/^https?:(?![/\\]{2})/i.test(src.slice(i))) return true;
  const lead = src.charAt(i);
  return lead === '/' || lead === '\\';
}

/** Absolute, scheme-qualified URL — a bare "example.com" would otherwise resolve
 *  same-origin and get swallowed by the PWA's navigation fallback. */
export function absolute(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (/^[a-z][\w+.-]*:/i.test(href)) return href; // mailto:, tel:, …
  return `https://${href}`;
}

/** Open in a real new browser tab/instance. A plain target=_blank in a
 *  standalone PWA is unreliable (the app window itself can navigate, and the
 *  service worker's navigateFallback then serves index.html — the "back to the
 *  landing page" symptom), so force a fresh context via window.open. */
export function openExternal(e: React.MouseEvent, href: string | undefined): void {
  if (!href) return;
  e.preventDefault();
  window.open(absolute(href), '_blank', 'noopener,noreferrer');
}

for (const [name, def] of Object.entries({
  bash, typescript, javascript, json, python, css, xml,
  yaml, markdown, diff, sql, dockerfile, rust, go,
})) hljs.registerLanguage(name, def);
hljs.registerAliases(['zsh', 'shell'], { languageName: 'bash' });
hljs.registerAliases(['tsx'], { languageName: 'typescript' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });

export const LANG_LABEL: Readonly<Record<string, string>> = {
  bash: 'bash', sh: 'shell', shell: 'shell', zsh: 'zsh',
  typescript: 'TypeScript', ts: 'TypeScript', tsx: 'TSX',
  javascript: 'JavaScript', js: 'JavaScript', jsx: 'JSX',
  json: 'JSON', python: 'Python', py: 'Python', css: 'CSS',
  xml: 'XML', html: 'HTML', yaml: 'YAML', yml: 'YAML',
  markdown: 'Markdown', md: 'Markdown', diff: 'diff', sql: 'SQL',
  dockerfile: 'Dockerfile', rust: 'Rust', go: 'Go',
};

/** Flatten a react-markdown child tree to source text (for copy + highlight). */
export function nodeText(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join('');
  if (React.isValidElement(n)) return nodeText((n.props as { children?: ReactNode }).children);
  return '';
}

/** Keystroke-shaped inline code → real <kbd> caps (`Cmd+K`, `Esc`). */
const NAMED_KEY =
  /^(?:Ctrl|Control|Cmd|Command|⌘|Alt|Option|⌥|Opt|Shift|⇧|Win|Super|Meta|Fn|Esc|Escape|Enter|Return|↵|⏎|Tab|⇥|Space|Spacebar|Backspace|⌫|Delete|Del|Insert|Ins|Home|End|PageUp|PgUp|PageDown|PgDn|Up|Down|Left|Right|↑|↓|←|→|F(?:[1-9]|1[0-2]))$/;
const SINGLE = /^[\p{L}\p{N}`~!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|]$/u;
/** The most parts one inline code span splits into chips. A chord of single characters costs two bytes a part, so a
 *  part count above half of `CHAT_SYNC_MAX_BYTES` cannot come from a message chat renders on the main thread;
 *  past it the span stays plain code, as any code that is not a keystroke does. The parse's element cap counts hast
 *  elements, and one span of N parts draws 2N-1 more. */
const KEYSTROKE_MAX_PARTS = CHAT_SYNC_MAX_BYTES / 2;
export function keystrokeParts(raw: string): string[] | null {
  const parts = raw.trim().split(/\s*\+\s*/);
  if (parts.length > KEYSTROKE_MAX_PARTS) return null;
  const ok = (p: string): boolean => NAMED_KEY.test(p) || SINGLE.test(p);
  if (parts.length > 1) return parts.every(ok) ? parts : null;
  return NAMED_KEY.test(parts[0]!) ? parts : null; // bare single chars stay chips
}

/** Fenced code: language label + copy bar over a syntax-highlighted well.
 *  The bar is a SIBLING above the scrolling <pre>, never an overlay.
 *  Highlighted only when the language is registered, `highlight` is not `false`, and the block is at most
 *  `MD_HIGHLIGHT_BLOCK_MAX_CHARS` characters (after the trailing-newline strip); a registered block over the cap
 *  renders as plain text and says so in its label, its size in whole KiB of characters, rounded up. */
export function CodeBlock({ children, highlight }: { children?: ReactNode; highlight?: boolean }): ReactNode {
  const [copied, setCopied] = useState(false);
  const codeEl = React.Children.toArray(children).find(React.isValidElement) as
    | React.ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;
  const lang = (/language-([\w-]+)/.exec(codeEl?.props.className ?? '')?.[1] ?? '').toLowerCase();
  const label = LANG_LABEL[lang] ?? (lang || 'text');
  const raw = nodeText(children).replace(/\n$/, '');
  const wanted = highlight !== false && Boolean(lang && hljs.getLanguage(lang));
  const overCap = wanted && raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS;
  const html = wanted && !overCap
    ? hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value // sync, never throws
    : null;
  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(raw).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }, [raw]);
  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-block-lang">
          {overCap ? `${label} · not highlighted (${Math.ceil(raw.length / 1024)} KiB)` : label}
        </span>
        <button type="button" className="code-block-copy" onClick={onCopy}
                aria-label="Copy code" data-copied={copied || undefined}>
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre>
        {html != null
          ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          : <code className="hljs">{raw}</code>}
      </pre>
    </div>
  );
}

/** Wrap tables so the scroller is a div (enables the edge-fade affordance). */
export function TableWrap({ children }: { children?: ReactNode }): ReactNode {
  return <div className="md-table-wrap"><table>{children}</table></div>;
}

/** The components chat and the Docs screen share: inline code (kbd chips), fenced code, tables. */
export const SHARED_COMPONENTS: Components = {
  code({ className, children }) {
    const text = String(children ?? '');
    if (/language-/.test(className ?? '') || text.includes('\n')) {
      return <code className={className}>{children}</code>; // block code → left to CodeBlock
    }
    const keys = keystrokeParts(text);
    if (keys) {
      return (
        <span className="kbd-combo">
          {keys.map((k, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="kbd-plus">+</span>}
              <kbd>{k}</kbd>
            </React.Fragment>
          ))}
        </span>
      );
    }
    return <code className="md-code">{children}</code>;
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => <TableWrap>{children}</TableWrap>,
};

/** Open in the external browser (a bare `<a>` in a standalone PWA would try to
 *  navigate the app itself), and render image URLs inline as tap-to-open images,
 *  except a source `isRefusedChatImageSrc` refuses, which stays a plain link. */
export const CHAT_COMPONENTS: Components = {
  ...SHARED_COMPONENTS,
  a({ href, children }) {
    if (isImageUrl(href) && !isRefusedChatImageSrc(href)) {
      const name = href.split('/').pop()?.split(/[?#]/)[0] || 'image';
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="msg-img-link" onClick={(e) => openExternal(e, href)}>
          <img src={href} alt={name} loading="lazy" className="msg-img" />
        </a>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => openExternal(e, href)}>
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    const href = typeof src === 'string' ? src : undefined;
    if (isRefusedChatImageSrc(href)) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => openExternal(e, href)}>
          {href}
        </a>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="msg-img-link" onClick={(e) => openExternal(e, href)}>
        <img src={src} alt={alt ?? ''} loading="lazy" className="msg-img" />
      </a>
    );
  },
};

/** The one-line note under a message chat shows as plain text: why it was not formatted. Exhaustive over every
 *  outcome but `tree` (a new kind is a compile error here); the limits are interpolated from `markdownLimits.ts`. */
export function chatPlainNote(o: Exclude<ParseOutcome, { kind: 'tree' }>): string {
  switch (o.kind) {
    case 'refused':
      return o.why === 'container-depth'
        ? `Shown as plain text: line ${o.line} nests ${o.value} levels deep (limit ${MD_MAX_CONTAINER_DEPTH}).`
        : `Shown as plain text: line ${o.line} has a run of ${o.value} emphasis marks (limit ${MD_MAX_DELIMITER_RUN}).`;
    case 'too-deep':
      return `Shown as plain text: this message nests ${o.depth} levels deep (limit ${MD_MAX_TREE_DEPTH}).`;
    case 'too-wide':
      return `Shown as plain text: this message would draw ${o.elements} elements (limit ${DOCS_MAX_RENDER_ELEMENTS}).`;
    case 'threw':
      return `Shown as plain text: it could not be formatted (${o.error}).`;
    case 'timeout':
      return `Shown as plain text: formatting took longer than ${o.budgetMs / 1000} s.`;
    case 'worker-unavailable':
      return 'Shown as plain text: this browser cannot format long messages in the background.';
    case 'worker-failed':
      return `Shown as plain text: the formatter stopped (${o.error}).`;
  }
}

/** A message shown as plain text: the text verbatim in `<pre className="msg-plain">`, then, when `note` is given,
 *  `<p className="msg-plain-note">`. `note` absent = no note line. */
export function MsgPlain({ text, note }: { text: string; note?: string }): ReactNode {
  return (
    <>
      <pre className="msg-plain">{text}</pre>
      {note !== undefined && <p className="msg-plain-note">{note}</p>}
    </>
  );
}

/** The content of `line` after its container markers: spaces and tabs, then repeatedly `>`, a list marker (`-`, `+`,
 *  `*`, or up to 9 digits and `.` or `)`, followed by a blank) and the blanks after it. One pass, no recursion. */
function blockContent(line: string): string {
  let i = 0;
  for (;;) {
    while (line.charCodeAt(i) === 0x20 || line.charCodeAt(i) === 0x09) i += 1;
    const c = line.charCodeAt(i);
    if (c === 0x3e /* > */) {
      i += 1;
      continue;
    }
    let end = -1;
    const blankAt = (k: number): boolean => line.charCodeAt(k) === 0x20 || line.charCodeAt(k) === 0x09;
    if ((c === 0x2d || c === 0x2b || c === 0x2a) && blankAt(i + 1)) {
      end = i + 1;
    } else if (c >= 0x30 && c <= 0x39) {
      let j = i;
      while (line.charCodeAt(j) >= 0x30 && line.charCodeAt(j) <= 0x39) j += 1;
      const d = line.charCodeAt(j);
      if (j - i <= 9 && (d === 0x2e || d === 0x29) && blankAt(j + 1)) end = j + 1;
    }
    if (end < 0) return line.slice(i);
    i = end;
  }
}

/** The columns of a GFM delimiter row (`|---|:-:|`), or 0 when `s` is not one: it holds a pipe, and every cell
 *  between the pipes is `-` repeated with an optional `:` at either end. A leading and a trailing pipe add no cell. */
function delimiterColumns(s: string): number {
  if (s.indexOf('|') === -1) return 0;
  const cells = s.trim().split('|');
  if (cells[0]!.trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]!.trim() === '') cells.pop();
  if (cells.length === 0) return 0;
  for (const raw of cells) {
    const cell = raw.trim();
    let a = 0;
    let b = cell.length;
    if (cell[a] === ':') a += 1;
    if (b > a && cell[b - 1] === ':') b -= 1;
    if (b <= a) return 0;
    for (let k = a; k < b; k += 1) if (cell[k] !== '-') return 0;
  }
  return cells.length;
}

/** How many cells the GFM tables in `src` would draw: columns (read from the delimiter row) times rows (the header
 *  line, then every line up to a blank line). A cheap count from the source, one pass over the lines with no
 *  recursion: container markers (`>`, list markers) are stripped, and a table's body lines count whole rows, as the
 *  parse pads a short row to the table's width. Fences are NOT tracked: a fence the parser closes with its
 *  container, or opens inside one, would make a count that skips fenced lines miss a table the parse then draws, so
 *  table-shaped text is counted wherever it stands. It over-counts rather than misses. */
export function countChatTableCells(src: string): number {
  let total = 0;
  let cols = 0;
  let prev = '';
  let start = 0;
  while (start <= src.length) {
    let end = src.indexOf('\n', start);
    if (end < 0) end = src.length;
    const s = blockContent(src.slice(start, end));
    start = end + 1;
    if (s.trim() === '') {
      cols = 0;
      prev = '';
      continue;
    }
    if (cols > 0) {
      total += cols;
      continue;
    }
    const n = prev.indexOf('|') === -1 ? 0 : delimiterColumns(s);
    if (n > 0) {
      cols = n;
      total += n;
      prev = '';
    } else {
      prev = s;
    }
  }
  return total;
}

/** At most `CHAT_SYNC_MAX_BYTES`: the pre-scan, then a count of the cells its tables would draw, then react-markdown
 *  on the main thread, exactly as before. The sync path has no element cap of its own (the parse's cap is the
 *  worker's), and a table's body lines pad to its width, so a 4 KiB message can draw hundreds of thousands of cells;
 *  one that would draw more than `DOCS_MAX_RENDER_ELEMENTS` cells shows as plain text with the too-wide note. */
function SyncChatMarkdown({ text }: { text: string }): ReactNode {
  const scan = prescanMarkdown(text);
  if (!scan.ok) {
    return <MsgPlain text={text} note={chatPlainNote({ kind: 'refused', why: scan.why, line: scan.line, value: scan.value })} />;
  }
  const cells = countChatTableCells(text);
  if (cells > DOCS_MAX_RENDER_ELEMENTS) {
    return <MsgPlain text={text} note={chatPlainNote({ kind: 'too-wide', elements: cells })} />;
  }
  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;
}

/** How a tree from the worker renders in chat: chat's components and react-markdown's own url transform, so it is
 *  byte-identical to the synchronous path (M4.P10). */
const CHAT_RENDER: RenderHastOptions = { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform };

/** Over `CHAT_SYNC_MAX_BYTES`: the worker. While the current text parses, the newest tree that settled (so a
 *  streaming message advances with each settle); else the settled tree for the current text; else, after an outcome
 *  that is not a tree for the current text, plain text with its note; else (nothing settled yet, or no tree yet
 *  while the current text parses) plain text alone. No Format anyway. */
function AsyncChatMarkdown({ text, parser }: { text: string; parser: MarkdownParser }): ReactNode {
  const { outcome, lastGood, pending } = useParsedMarkdown(text, parser, { profile: 'chat', budgetMs: CHAT_PARSE_BUDGET_MS });
  if (pending && lastGood !== null) return renderHast(lastGood, CHAT_RENDER);
  if (outcome?.kind === 'tree') return renderHast(outcome.tree, CHAT_RENDER);
  if (outcome !== null && !pending) return <MsgPlain text={text} note={chatPlainNote(outcome)} />;
  return <MsgPlain text={text} />;
}

/** Chat's parser: `chatRunner.parse`, read at call time, so a test spies it with `vi.spyOn(chatRunner, 'parse')`. */
const chatParse: MarkdownParser = (src, opts) => chatRunner.parse(src, opts);

/** One chat message body (an assistant turn, an opened compaction recap) as Markdown: GFM, then the alert
 *  callouts, through chat's components. A text of at most `CHAT_SYNC_MAX_BYTES` UTF-8 bytes renders on the main
 *  thread behind the pre-scan; a longer one parses through `parser` (absent = `chatRunner`'s), with a
 *  `CHAT_PARSE_BUDGET_MS` budget. The two paths are two components, so crossing the threshold remounts. The
 *  streaming caret is the caller's sibling after it. */
export function ChatMarkdown({ text, parser = chatParse }: { text: string; parser?: MarkdownParser }): ReactNode {
  return utf8ByteLength(text) <= CHAT_SYNC_MAX_BYTES
    ? <SyncChatMarkdown text={text} />
    : <AsyncChatMarkdown text={text} parser={parser} />;
}
