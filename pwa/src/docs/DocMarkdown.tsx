// A Docs page's Markdown body (spec 2026-10-01 4.10 "DocMarkdown", steps 1-6, and 4.12's doc-body mount; W5 part 1
// Task 8). In order:
//   1. the gate: a document over `DOCS_RENDER_GATE_BYTES` UTF-8 bytes asks first, and nothing is parsed until the
//      reader chooses **Format anyway** (a `DOCS_PARSE_BUDGET_LARGE_MS` job) or **Show as text**;
//   2. the parse, through `useParsedMarkdown` on the page's parser (`docsRunner.parse` from `DocsScreen`), profile
//      `docs`, budget `DOCS_PARSE_BUDGET_MS(bytes)`; the body says "Formatting…" until the outcome for this text lands;
//   3. `worker-unavailable` on a text of at most `CHAT_SYNC_MAX_BYTES` parses here, on the main thread; a longer one
//      is plain text with its own note;
//   4. a tree is detached once per outcome (`detachUrls`: a copy, every URL moved into its map) and rendered with
//      `renderHast(copy, {components: DOC_COMPONENTS})` and no url transform, in `<article className="doc-body
//      msg-assist">`, inside the doc-body `RenderBoundary` keyed by the pin; every other outcome is `DocPlain`;
//   5. each outcome but a tree has one note (`docsPlainNote`); a `timeout` under the normal budget offers **Format
//      anyway**, a `worker-failed` offers **Retry**;
//   6. a `.md` whose bytes arrived as base64 is decoded by `docMarkdownSource`: strict UTF-8 renders as Markdown, and
//      anything else is decoded with a non-fatal `TextDecoder('utf-8')` and shown as plain text, "Not valid UTF-8.".
// The element cap is the parse's (`too-wide`, counted before anything renders): nothing here counts after a render.
// New class names (registered by Task 11): `doc-gate`, `doc-gate-copy`, `doc-gate-btn`, `doc-formatting`,
// `doc-plain`, `doc-plain-note`, `doc-plain-action`.
import { useMemo, useState, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import type { DocsShowOk } from '../../../shared/docs';
import { RenderBoundary } from '../components/RenderBoundary';
import { PreHighlightContext, SHARED_COMPONENTS } from '../lib/markdown';
import { utf8ByteLength } from '../lib/markdownGuard';
import {
  CHAT_SYNC_MAX_BYTES, DOCS_MAX_RENDER_ELEMENTS, DOCS_PARSE_BUDGET_LARGE_MS, DOCS_PARSE_BUDGET_MS,
  DOCS_RENDER_GATE_BYTES, MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN, MD_MAX_TREE_DEPTH,
} from '../lib/markdownLimits';
import { parseMarkdown, type ParseOutcome } from '../lib/markdownParse';
import type { MarkdownParser } from '../lib/markdownRunner';
import { renderHast } from '../lib/renderHast';
import { useParsedMarkdown } from '../lib/useParsedMarkdown';
import { DocImage } from './DocImage';
import { DocLink, DocLinkContext, type DocLinkContextValue } from './DocLink';
import { detachUrls } from './docsLinks';
import { showBytes } from './objectUrls';

/** The components a Docs body renders with (spec 4.10): the shared code, pre and table, and the Docs `a` and `img`,
 *  which are the only way a URL from the document reaches the DOM. */
export const DOC_COMPONENTS: Components = { ...SHARED_COMPONENTS, a: DocLink, img: DocImage };

/** The doc-body boundary's note (spec 4.12's table). */
export const DOC_BODY_FALLBACK_NOTE = 'This document could not be displayed; shown as plain text.';
/** The note of a `.md` whose bytes are not UTF-8 (spec 4.10 step 6). */
export const DOC_NOT_UTF8_NOTE = 'Not valid UTF-8.';
/** The body's line while the parse runs (spec 4.10 step 2). */
export const DOC_FORMATTING = 'Formatting…';
/** The two gate buttons and the two note actions (spec 4.10 steps 1 and 5). */
export const DOC_MARKDOWN_ACTION = {
  formatAnyway: 'Format anyway',
  showAsText: 'Show as text',
  retry: 'Retry',
} as const;

/** `n` in decimal, its digits grouped by three with a space, as the spec writes its limits ("limit 20 000"). */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** `bytes` in MiB to one decimal place, with its unit: 614 400 bytes is "0.6 MiB". */
export function mib(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MiB`;
}

/** The gate's sentence (spec 4.10 step 1). */
export function docGateSentence(bytes: number): string {
  return `This document is ${mib(bytes)}. Formatting it may take a while.`;
}

/** The note of a document shown as text because the reader chose **Show as text** at the gate. */
export function docShownAsTextNote(bytes: number): string {
  return `This document is ${mib(bytes)}; shown as plain text, as asked.`;
}

/** The one-line note above a document Docs shows as plain text: why it was not formatted (spec 4.10 step 5). Exhaustive
 *  over every outcome but `tree` (a new kind is a compile error here); the limits are interpolated from
 *  `markdownLimits.ts`, never restated. */
export function docsPlainNote(o: Exclude<ParseOutcome, { kind: 'tree' }>): string {
  switch (o.kind) {
    case 'refused':
      return o.why === 'container-depth'
        ? `Line ${grouped(o.line)} nests ${grouped(o.value)} levels deep (limit ${grouped(MD_MAX_CONTAINER_DEPTH)}); shown as plain text.`
        : `Line ${grouped(o.line)} has a run of ${grouped(o.value)} emphasis marks (limit ${grouped(MD_MAX_DELIMITER_RUN)}); shown as plain text.`;
    case 'too-deep':
      return `This document nests ${grouped(o.depth)} levels deep (limit ${grouped(MD_MAX_TREE_DEPTH)}); shown as plain text.`;
    case 'too-wide':
      return `This document would draw ${grouped(o.elements)} elements (limit ${grouped(DOCS_MAX_RENDER_ELEMENTS)}); shown as plain text.`;
    case 'threw':
      return `This document could not be formatted (${o.error}); shown as plain text.`;
    case 'timeout':
      return `Formatting took longer than ${o.budgetMs / 1000} s; shown as plain text.`;
    case 'worker-unavailable':
      return 'This browser cannot format long documents in the background; shown as plain text.';
    case 'worker-failed':
      return `The formatter stopped (${o.error}); shown as plain text.`;
  }
}

/** A document shown as plain text: the note line, then `action` when given (absent = no action), then the text
 *  verbatim in `<pre className="doc-plain">`. */
export function DocPlain(p: { readonly text: string; readonly note: string; readonly action?: ReactNode }): ReactNode {
  return (
    <>
      <p className="doc-plain-note">{p.note}</p>
      {p.action}
      <pre className="doc-plain">{p.text}</pre>
    </>
  );
}

/** What a markdown leaf's show answer holds (spec 4.10 step 6). `markdown`: text to format, `utf8` as sent or `base64`
 *  bytes that decode as strict UTF-8 (ccd sends valid UTF-8 as base64 when that frames shorter, spec 3's encoding
 *  rule). `not-utf8`: base64 bytes that are not UTF-8, decoded non-fatally (each bad sequence a U+FFFD) for
 *  `DocPlain` with `DOC_NOT_UTF8_NOTE`. `no-bytes`: the field the answer's encoding names is missing, or its base64
 *  does not decode (the caller shows a malformed answer). */
export type DocMarkdownSource =
  | { readonly kind: 'markdown'; readonly text: string }
  | { readonly kind: 'not-utf8'; readonly text: string }
  | { readonly kind: 'no-bytes' };

export function docMarkdownSource(show: DocsShowOk): DocMarkdownSource {
  if (show.encoding === 'utf8') return typeof show.text === 'string' ? { kind: 'markdown', text: show.text } : { kind: 'no-bytes' };
  const bytes = showBytes(show);
  if (bytes === null) return { kind: 'no-bytes' };
  try {
    return { kind: 'markdown', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { kind: 'not-utf8', text: new TextDecoder('utf-8').decode(bytes) };
  }
}

/** The props of `DocMarkdown`. `text`: the document, as it is to be formatted. `pinKey`: the pin the text was read
 *  at, as a string (the doc-body boundary's reset key; the caller also keys `DocMarkdown` by it, so a new pin starts
 *  over and its stale job is aborted). `parser`: the page's parser. `link`: the page the body's links and images
 *  resolve from; `DocMarkdown` adds the detached `urls`. */
export interface DocMarkdownProps {
  readonly text: string;
  readonly pinKey: string;
  readonly parser: MarkdownParser;
  readonly link: Omit<DocLinkContextValue, 'urls'>;
}

/** A parsed tree on the page: detached ONCE per tree (the memo is keyed by the tree object), then rendered with
 *  `DOC_COMPONENTS` and no url transform, under the page's link context and highlight budget. Lives inside the
 *  doc-body boundary, so a throw from `renderHast` or from any component it draws is the boundary's. */
function DocTree(p: { readonly tree: HastRoot; readonly link: Omit<DocLinkContextValue, 'urls'> }): ReactNode {
  const detached = useMemo(() => detachUrls(p.tree), [p.tree]);
  const ctx = useMemo<DocLinkContextValue>(() => ({ ...p.link, urls: detached.urls }), [p.link, detached]);
  const budget = useMemo(() => (pre: HastElement): boolean => detached.urls.get(pre)?.highlight !== false, [detached]);
  return (
    <DocLinkContext value={ctx}>
      <PreHighlightContext value={budget}>
        <article className="doc-body msg-assist">{renderHast(detached.tree, { components: DOC_COMPONENTS })}</article>
      </PreHighlightContext>
    </DocLinkContext>
  );
}

/** Steps 2-5 for one budget and attempt. `large`: the reader chose **Format anyway**. */
function DocParse(p: DocMarkdownProps & {
  readonly bytes: number; readonly budgetMs: number; readonly attempt: number;
  readonly onFormatAnyway: () => void; readonly onRetry: () => void;
}): ReactNode {
  const { outcome, pending } = useParsedMarkdown(p.text, p.parser, { profile: 'docs', budgetMs: p.budgetMs, attempt: p.attempt });
  // Step 3: no worker here, and the text is small enough to parse on the main thread. Memoised per outcome.
  const inThread = useMemo(
    () => (outcome?.kind === 'worker-unavailable' && p.bytes <= CHAT_SYNC_MAX_BYTES ? parseMarkdown(p.text, 'docs') : null),
    [outcome, p.text, p.bytes],
  );
  if (pending || outcome === null) return <p className="doc-formatting">{DOC_FORMATTING}</p>;
  const shown = inThread ?? outcome;
  if (shown.kind === 'tree') {
    return (
      <RenderBoundary where="doc body" resetKey={p.pinKey} fallback={() => <DocPlain text={p.text} note={DOC_BODY_FALLBACK_NOTE} />}>
        <DocTree tree={shown.tree} link={p.link} />
      </RenderBoundary>
    );
  }
  let action: ReactNode = null;
  if (shown.kind === 'timeout' && shown.budgetMs < DOCS_PARSE_BUDGET_LARGE_MS) {
    action = <button type="button" className="doc-plain-action" onClick={p.onFormatAnyway}>{DOC_MARKDOWN_ACTION.formatAnyway}</button>;
  } else if (shown.kind === 'worker-failed') {
    action = <button type="button" className="doc-plain-action" onClick={p.onRetry}>{DOC_MARKDOWN_ACTION.retry}</button>;
  }
  return <DocPlain text={p.text} note={docsPlainNote(shown)} action={action} />;
}

/** What the reader has chosen. `ask`: the gate is up and nothing is parsed. `format`: the normal budget. `large`:
 *  **Format anyway**, the large budget. `text`: **Show as text**. */
type Choice = 'ask' | 'format' | 'large' | 'text';

/** A Docs page's Markdown body (spec 4.10). The caller keys it by `pinKey`. */
export function DocMarkdown(p: DocMarkdownProps): ReactNode {
  const bytes = useMemo(() => utf8ByteLength(p.text), [p.text]);
  const [choice, setChoice] = useState<Choice>(() => (bytes > DOCS_RENDER_GATE_BYTES ? 'ask' : 'format'));
  const [attempt, setAttempt] = useState(0);
  if (choice === 'ask') {
    return (
      <div className="doc-gate">
        <p className="doc-gate-copy">{docGateSentence(bytes)}</p>
        <button type="button" className="doc-gate-btn" onClick={() => setChoice('large')}>{DOC_MARKDOWN_ACTION.formatAnyway}</button>
        <button type="button" className="doc-gate-btn" onClick={() => setChoice('text')}>{DOC_MARKDOWN_ACTION.showAsText}</button>
      </div>
    );
  }
  if (choice === 'text') return <DocPlain text={p.text} note={docShownAsTextNote(bytes)} />;
  const budgetMs = choice === 'large' ? DOCS_PARSE_BUDGET_LARGE_MS : DOCS_PARSE_BUDGET_MS(bytes);
  return (
    <DocParse
      {...p} bytes={bytes} budgetMs={budgetMs} attempt={attempt}
      onFormatAnyway={() => setChoice('large')} onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}
