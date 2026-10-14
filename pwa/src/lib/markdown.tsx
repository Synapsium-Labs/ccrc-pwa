// Chat's Markdown renderer, extracted from `session/MessageBubble.tsx` (native Docs reader, W4 Task 2; design
// 2026-10-01 section 4.9) so chat and the Docs screen share one set of components. Moved unchanged: the image
// test, `absolute`, `openExternal`, the highlight.js registration (a module side effect), `LANG_LABEL`,
// `nodeText`, `keystrokeParts`, `CodeBlock`, `TableWrap`, and today's `mdComponents` split into
// `SHARED_COMPONENTS` (code, pre, table) and `CHAT_COMPONENTS` (those plus chat's `a` and `img`). `ChatMarkdown`
// is both of `MessageBubble`'s Markdown sites. `markdown-golden.test.tsx` holds chat's output byte for byte.
// Hardened per ruling U3 (W4 Task 6; section 4.12): a message of at most `CHAT_SYNC_MAX_BYTES` UTF-8 bytes is
// pre-scanned, then rendered as before; a longer one parses in `chatRunner`'s worker; whatever is not formatted
// shows as `MsgPlain` with `chatPlainNote`'s sentence; and `isRefusedChatImageSrc` keeps chat from drawing an
// image whose source is not an absolute http(s) URL (`chat-hardening.test.tsx`).
// Bounded per W5 Task 3 (section 4.10's "Bounds on the shared components"): `CodeBlock` does not highlight a block
// holding a word longer than `MD_HIGHLIGHT_MAX_WORD_CHARS` (r10), and `keystrokeParts` moved to `markdownGuard.ts`,
// where the parse's element count calls it too (2-2) and it refuses a span over `MD_KEYSTROKE_MAX_CHARS` (r11).
// W5 Task 6: `SHARED_COMPONENTS.pre` reads `PreHighlightContext`, the Docs page's highlight budget; chat provides
// none, so chat's output is unchanged (refinement (h)).
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import React, { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Element as HastElement } from 'hast';
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
import php from 'highlight.js/lib/languages/php';
import { remarkAlerts } from './remarkAlerts';
import {
  CHAT_PARSE_BUDGET_MS, CHAT_SYNC_MAX_BYTES, DOCS_MAX_RENDER_ELEMENTS, MD_HIGHLIGHT_BLOCK_MAX_CHARS,
  MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS, MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_BLANK_CHARS, MD_HIGHLIGHT_MAX_LINE_CHARS, MD_HIGHLIGHT_MAX_WORD_CHARS,
  MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN, MD_MAX_TREE_DEPTH,
} from './markdownLimits';
import { keystrokeParts, prescanMarkdown, utf8ByteLength } from './markdownGuard';
import type { ParseOutcome } from './markdownParse';
import { chatRunner, type MarkdownParser } from './markdownRunner';
import { renderHast, type RenderHastOptions } from './renderHast';
import { useParsedMarkdown } from './useParsedMarkdown';
import '../session/chat.css';

export const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
export const isImageUrl = (href: string | undefined): href is string => href !== undefined && IMG_EXT.test(href);

/** Whether chat refuses `src` as an image source. Chat draws an image only when its source is an absolute http(s)
 *  URL: after leading ASCII whitespace and C0 controls are skipped (as a browser strips them from an attribute URL),
 *  the source must start with `http://` or `https://` (scheme in either case, then two forward slashes). Everything
 *  else is refused: a path-relative source (`x.png`, `../api/x`), a root-relative one (`/x`), a protocol-relative one
 *  (`//h/x`, and `\\h/x`, which a browser reads the same way), `https:/x` and `https:\\h/x` (one slash, or
 *  backslashes), a `data:` URI, `mailto:` and every other scheme. A relative source would be fetched from ccrc's own
 *  origin, or from a host the message names, carrying the operator's cookie. Absent (`undefined`) is not refused: the
 *  `img` component then has no source to draw. Takes the value after react-markdown's `defaultUrlTransform`. The ONE
 *  predicate: `img` and the auto-embed in `a` both call it; a refused source renders as the ordinary external link,
 *  except one the url transform left empty, whose image renders its alt text as plain text, or nothing. */
export function isRefusedChatImageSrc(src: string | undefined): boolean {
  if (src === undefined) return false;
  let i = 0;
  while (i < src.length && src.charCodeAt(i) <= 0x20) i += 1;
  return !/^https?:\/\//i.test(src.slice(i));
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

// Registering a grammar also registers any aliases IT declares — that is where
// `golang` comes from, and why it is not in the list below. The php grammar
// declares none, so `php` is the only fence word that reaches it.
for (const [name, def] of Object.entries({
  bash, typescript, javascript, json, python, css, xml,
  yaml, markdown, diff, sql, dockerfile, rust, go, php,
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
  dockerfile: 'Dockerfile', rust: 'Rust', go: 'Go', php: 'PHP',
};

/** Flatten a react-markdown child tree to source text (for copy + highlight). */
export function nodeText(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join('');
  if (React.isValidElement(n)) return nodeText((n.props as { children?: ReactNode }).children);
  return '';
}

/** The longest run of word units in `s` (0 for none): a word unit is a UTF-16 code unit in `[A-Za-z0-9_$]` or at
 *  `0x7f` or above. The upper range is counted because highlight.js's PHP grammar takes `\x7f-\xff` as identifier
 *  characters (64 KiB of `_é` in a `php` fence cost about 38 s), and a unit above it cannot be told from one inside
 *  it without the grammar, so the class fails closed. One pass over its code units, no regular expression, so its
 *  cost is linear in the length of `s` whatever it holds. */
export function longestWordRun(s: string): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c === 0x24 || c >= 0x7f) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/** The length in UTF-16 code units of the longest line of `s` (0 for none); a line ends at `\n` or `\r`, so a
 *  CRLF pair counts neither character. One pass, linear in the length of `s`. */
export function longestLine(s: string): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c === 0x0a || c === 0x0d) {
      run = 0;
    } else {
      run += 1;
      if (run > best) best = run;
    }
  }
  return best;
}

/** The length of the longest run of blank code units in `s` (0 for none): ECMAScript's `\s` set, U+0009 to U+000D,
 *  U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. The run crosses line
 *  breaks: `typescript` and `javascript` cost highlight.js the square of a blank run that holds a line terminator
 *  (64 KiB of `\n` about 5 to 6 s, of U+2028 about 10 s), and these are exactly the units that join such a run. One
 *  pass, no regular expression, so its cost is linear in the length of `s` whatever it holds. */
export function longestBlankRun(s: string): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if ((c >= 0x09 && c <= 0x0d) || c === 0x20 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a)
        || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/** The language a code element's class names (`language-<name>`), lower-cased; `''` when it names none. */
export function codeLanguage(className: string): string {
  return (/language-([\w-]+)/.exec(className)?.[1] ?? '').toLowerCase();
}

/** Which of the three grammars highlight.js is quadratic in (D-4928) `lang` resolves to, compared by identity with
 *  what `hljs.getLanguage` answers for the grammar's own name, so every alias highlight.js knows follows it and no
 *  list of aliases is kept here. */
function scanGrammar(lang: string): 'js' | 'rust' | null {
  if (!lang) return null;
  const def = hljs.getLanguage(lang);
  if (def === undefined) return null;
  if (def === hljs.getLanguage('typescript') || def === hljs.getLanguage('javascript')) return 'js';
  if (def === hljs.getLanguage('rust')) return 'rust';
  return null;
}

/** The longest block, in characters, `CodeBlock` highlights in `lang`: a smaller cap for `typescript`/`javascript`
 *  and `rust` (D-4928), `MD_HIGHLIGHT_BLOCK_MAX_CHARS` for every other grammar. */
export function highlightBlockCap(lang: string): number {
  const g = scanGrammar(lang);
  return g === 'js' ? MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS : g === 'rust' ? MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS : MD_HIGHLIGHT_BLOCK_MAX_CHARS;
}

/** Whether a block in `lang` counts against a Docs page's budget for the grammars that grow with the square of a
 *  block's size (`DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS`, D-4928). */
export function inScanPageBudget(lang: string): boolean {
  return scanGrammar(lang) !== null;
}

/** Fenced code: language label + copy bar over a syntax-highlighted well.
 *  The bar is a SIBLING above the scrolling <pre>, never an overlay.
 *  Highlighted only when the language is registered, `highlight` is not `false`, the block is at most
 *  `highlightBlockCap(lang)` characters (after the trailing-newline strip: `MD_HIGHLIGHT_BLOCK_MAX_CHARS`, or a smaller
 *  cap for `typescript`/`javascript` and for `rust`, D-4928), its longest run of word units
 *  (`longestWordRun`) is at most `MD_HIGHLIGHT_MAX_WORD_CHARS` (W5 bound r10), its longest line is at most
 *  `MD_HIGHLIGHT_MAX_LINE_CHARS` (the line bound), and its longest blank run (`longestBlankRun`, whitespace that may
 *  span lines) is at most `MD_HIGHLIGHT_MAX_BLANK_CHARS` (the whitespace bound). A registered block over the size cap
 *  renders as plain text and says so in its label, its size in whole KiB of characters, rounded up; one within it
 *  that holds a longer word renders as plain text labelled with that word's length, one with a longer line, labelled
 *  with that line's length, and one with a longer blank run, labelled with that run's length (a block that trips more
 *  than one is labelled by the first: word, then line, then blank run). The size check comes first, so a block over
 *  the cap is never scanned. A block the page budget refuses (`highlight={false}`) is labelled by its size the same way, and is never
 *  scanned either. */
export function CodeBlock({ children, highlight }: { children?: ReactNode; highlight?: boolean }): ReactNode {
  const [copied, setCopied] = useState(false);
  const codeEl = React.Children.toArray(children).find(React.isValidElement) as
    | React.ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;
  const lang = codeLanguage(codeEl?.props.className ?? '');
  const label = LANG_LABEL[lang] ?? (lang || 'text');
  const raw = nodeText(children).replace(/\n$/, '');
  const registered = Boolean(lang && hljs.getLanguage(lang));
  const wanted = highlight !== false && registered;
  const cap = highlightBlockCap(lang);
  const overCap = wanted && raw.length > cap;
  // A block the page budget refuses is over the cap all the same, and says so (M4.H1); the size is read from the
  // length alone, so a refused block is never scanned for a word or a line.
  const refusedOverCap = registered && !wanted && raw.length > cap;
  const word = wanted && !overCap ? longestWordRun(raw) : 0;
  const overWord = word > MD_HIGHLIGHT_MAX_WORD_CHARS;
  const line = wanted && !overCap ? longestLine(raw) : 0;
  const overLine = line > MD_HIGHLIGHT_MAX_LINE_CHARS;
  const blank = wanted && !overCap && !overWord && !overLine ? longestBlankRun(raw) : 0;
  const overBlank = blank > MD_HIGHLIGHT_MAX_BLANK_CHARS;
  const html = wanted && !overCap && !overWord && !overLine && !overBlank
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
          {overCap || refusedOverCap
            ? `${label} · not highlighted (${Math.ceil(raw.length / 1024)} KiB)`
            : overWord ? `${label} · not highlighted (a ${word}-character word)`
              : overLine ? `${label} · not highlighted (a ${line}-character line)`
                : overBlank ? `${label} · not highlighted (a ${blank}-character run of whitespace)` : label}
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

/** The Docs page's highlight budget as `pre` reads it (spec 4.10 "Highlighting"; refinement (h)): given the `pre`
 *  element being rendered (its hast `node`), whether the page admits highlighting it; `false` gives `CodeBlock`
 *  `highlight={false}`. `null`, the default, has ONE meaning: no page budget (chat never provides one), so the block
 *  rule alone decides, exactly as before. */
export const PreHighlightContext = createContext<((pre: HastElement) => boolean) | null>(null);

/** Fenced code through `CodeBlock`, under the page budget when one is provided. With a budget and no `node` (neither
 *  react-markdown nor `renderHast` ever omits it) the block is not highlighted: the budget cannot be asked. */
function SharedPre({ children, node }: { children?: ReactNode; node?: HastElement }): ReactNode {
  const budget = useContext(PreHighlightContext);
  const refused = budget !== null && (node === undefined || !budget(node));
  return <CodeBlock highlight={refused ? false : undefined}>{children}</CodeBlock>;
}

/** The components chat and the Docs screen share: inline code (kbd chips), fenced code (under the Docs page's highlight
 *  budget when one is provided), tables. */
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
  pre: SharedPre,
  table: ({ children }) => <TableWrap>{children}</TableWrap>,
};

/** Open in the external browser (a bare `<a>` in a standalone PWA would try to
 *  navigate the app itself), and render image URLs inline as tap-to-open images,
 *  except a source `isRefusedChatImageSrc` refuses, which stays a plain link, or,
 *  when the url transform left it empty, the image's alt text. */
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
      // react-markdown's url transform empties a source with an unsafe scheme (`data:`, `javascript:`, ...) before
      // chat sees it, and `![x]()` has none: such an image shows its alt text as plain text, or nothing, never an
      // empty link and never the source as written (review 408, F6). A blank destination (`![x](< >)`) never
      // arrives blank: the parse percent-encodes it (`%20`), a path-relative URL that renders as the ordinary link.
      if (!href) return alt ? <>{alt}</> : null;
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

/** An upper bound on the cells the GFM tables in `src` could draw: (the most pipes on any one line + 1) times the
 *  number of lines. It does not read GFM's table grammar, so no shape of table can slip past it. A table's columns
 *  equal its delimiter row's cells, which are at most that row's pipe count + 1, so at most the largest pipe count
 *  + 1; its rows are at most the lines of the text; and any number of tables share those lines, so their cells total
 *  at most this product. Escaped pipes, pipes in code and in fences only add to the count, which is safe. Lines end
 *  at `\r\n`, `\r` or `\n`, CommonMark's only line endings; a final line ending adds an empty line. One linear scan,
 *  no regex, no recursion. The bound can be too high: a pipe-heavy line and many lines multiply past the cap even
 *  where no table is that wide, and such a message is refused (shown as plain text) although it would have drawn
 *  fewer elements. */
export function countChatTableCells(src: string): number {
  let lines = 1;
  let maxPipes = 0;
  let pipes = 0;
  for (let i = 0; i < src.length; i += 1) {
    const c = src.charCodeAt(i);
    if (c === 0x7c /* | */) {
      pipes += 1;
    } else if (c === 0x0a || c === 0x0d) {
      if (c === 0x0d && src.charCodeAt(i + 1) === 0x0a) i += 1;
      lines += 1;
      if (pipes > maxPipes) maxPipes = pipes;
      pipes = 0;
    }
  }
  if (pipes > maxPipes) maxPipes = pipes;
  return (maxPipes + 1) * lines;
}

/** At most `CHAT_SYNC_MAX_BYTES`: the pre-scan, then `countChatTableCells`'s upper bound on the cells its tables could
 *  draw, then react-markdown on the main thread, exactly as before. The sync path has no element cap of its own (the
 *  parse's cap is the worker's), and a table's body lines pad to its width, so a 4 KiB message can draw hundreds of
 *  thousands of cells; one whose bound is above `DOCS_MAX_RENDER_ELEMENTS` shows as plain text with the too-wide
 *  note, which reports the bound as its element count. */
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
