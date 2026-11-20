// A Docs leaf (spec 2026-10-01 4.4's leaf row, 5.4, 5.5, 6.1; refinement (b); W5 part 1 Task 9): the body by
// `contentClass(path)`. `markdown` is `DocMarkdown`; `raster` is ONE `DocImage` (its bytes through `loaders.raster`,
// an object URL); `svg` is the same `data:` image Markdown gets, with Source and Download; `html` is the mockup viewer
// (`MockupView`: one sandboxed frame, C2 Task 8), keyed by the document's identity and the mode; `text` is the file in `<pre class="doc-plain">`, or `CodeBlock`
// on a one-block highlight store (W5h-a) when a registered grammar matches its extension; `other` is "No preview" and Download. A listed size over its
// class cap is the `too-large` sentence, and nothing was requested (the visit's `too-large` slot). The header and the
// banners are `DocsScreen`'s (`DocsHead`, `DocsBanners`), above this body, so a file failure replaces only the body.
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button } from '@ccrc/ui';
import type { Element as HastElement } from 'hast';
import {
  DOCS_CLASS_CAP, DOCS_MAX_IMAGE_BYTES, contentClass, docsApi, entryView, type DocListPin, type DocPin, type DocsEntry, type DocsPageLocation,
  type DocsRangePin, type DocsShowOk, type DocsTreeOk,
} from '../../../shared/docs';
import { utf8Bytes } from '../../../shared/utf8';
import { api } from '../lib/api';
import { DOCS_RENDER_GATE_BYTES } from '../lib/markdownLimits';
import { MarkdownParts } from './range/MarkdownParts';
import { RangeImage, RangeLeaf, rangeFailureSentence, rangeReadKey, type RangeBytes } from './range/RangeLeaf';
import { rangeOfTooLarge, rangePinOf } from './range/rangePolicy';
import { readRange, type RangeLoader } from './range/readRange';
import { SourceParts } from './range/SourceParts';
import { CodeBlock, PreHighlightContext } from '../lib/markdown';
import { isRegisteredGrammar } from '../lib/highlightNames';
import { useDocsHighlightStore } from '../lib/highlighterContext';
import type { MarkdownParser } from '../lib/markdownRunner';
import { DocImage, DocsAssetContext, DocsLeafImageContext, svgDataUrl, type DocsAssetContextValue } from './DocImage';
import { MockupView } from './MockupView';
import { mockupAssetReader } from './mockup/load';
import type { MockupContext } from './mockup/ports';
import { DocInLinkContext, DocLinkContext, fragmentTarget, type DocLinkContextValue } from './DocLink';
import { DOC_NOT_UTF8_NOTE, DocMarkdown, DocPlain, docMarkdownSource } from './DocMarkdown';
import { DocsFailureView } from './DocsFailureView';
import type { DetachedUrls } from './docsLinks';
import {
  DOCS_RANGE_TEXT, DOCS_SHOW_NO_BYTES, DOCS_SHOW_NOT_SVG, DOCS_VIEW_TEXT, failureSentence, fillSentence, kib, mib, shortCommit, slotSentence,
} from './docsText';
import { leafName } from './docsTree';
import type { DocsLoaders, DocsNotOk } from './failures';
import { downloadDocFile, saveBytes, showBytes } from './objectUrls';
import { ReaderFrame, type ReaderDeps } from './ReaderFrame';
import { useReaderOnly } from './readerHistory';
import { pinFor, type DocsVisit, type FileSlot } from './useDocsVisit';
import { usePublishExportBody, type ExportBody } from './exportBody';

type Leaf = DocsPageLocation & { kind: 'path' };
type LinkBase = Omit<DocLinkContextValue, 'urls'>;

/** A client-built `malformed-answer` for a file answer that does not hold what its class needs. */
function malformed(why: string): DocsNotOk {
  return { s: 'failed', body: { ok: false, failure: 'malformed-answer', why } };
}

/** A failed or client file slot as the failure view's answer (its pin dropped). */
function notOkOf(file: Extract<FileSlot, { s: 'failed' | 'auth' | 'unreachable' | 'no-docs-route' | 'unexpected-response' }>): DocsNotOk {
  switch (file.s) {
    case 'failed':
      return { s: 'failed', body: file.body };
    case 'unexpected-response':
      return { s: 'unexpected-response', status: file.status, contentType: file.contentType };
    default:
      return { s: file.s };
  }
}

/** Scrolls the visit's pending fragment into view once the body under `root` has rendered (refinement (o)): a cross-doc
 *  link's fragment, or a direct load's `location.hash`. Looked up inside the leaf's `<article>` by `DocLink`'s own id
 *  rule. The fragment is spent when the article is there, whether it holds the id or not, so it scrolls once and never
 *  waits for a later page. The body renders after the parse settles, so it watches for the article. */
function useFragmentScroll(root: RefObject<HTMLElement | null>, fragment: string | null, clear: (f: null) => void): void {
  useEffect(() => {
    const el = root.current;
    if (fragment === null || el === null) return undefined;
    const settle = (): boolean => {
      const article = el.querySelector('article');
      if (article === null) return false;
      fragmentTarget(article, fragment)?.scrollIntoView();
      clear(null);
      return true;
    };
    if (settle()) return undefined;
    const watch = new MutationObserver(() => {
      if (settle()) watch.disconnect();
    });
    watch.observe(el, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [root, fragment, clear]);
}

/** Download (spec 5.4): the file's original bytes through `downloadDocFile` and the page's loaders, octet-stream for
 *  every class; a failure is said under the button. */
function DownloadButton(p: {
  readonly project: string; readonly pin: DocPin; readonly name: string; readonly rangeLoader: RangeLoader;
}): ReactNode {
  const assets = useContext(DocsAssetContext);
  const { rangeLoader } = p;
  const [failed, setFailed] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);
  // A committed file the file route refused as too large, with the blob at this pin's commit named (a version page's
  // Download, review Q4), is read by range and saved; anything else says its failure.
  const readByRange = async (over: { blob: string; size: number }): Promise<void> => {
    if (p.pin.kind !== 'committed') return;
    ac.current?.abort();
    const mine = new AbortController();
    ac.current = mine;
    const target = { project: p.project, pin: p.pin, range: { kind: 'blob', sha: over.blob } as const, size: over.size };
    setReading(fillSentence(DOCS_RANGE_TEXT.reading, { done: mib(0), total: mib(over.size) }));
    try {
      const r = await readRange(rangeLoader, target, {
        signal: mine.signal,
        onProgress: (done, total) => { if (!mine.signal.aborted) setReading(fillSentence(DOCS_RANGE_TEXT.reading, { done: mib(done), total: mib(total) })); },
      });
      if (mine.signal.aborted) return;
      setReading(null);
      if (r.ok) saveBytes(p.name, r.bytes);
      else setFailed(rangeFailureSentence(r.why, over.size));
    } catch {
      if (mine.signal.aborted) return;
      setReading(null);
      setFailed(DOCS_RANGE_TEXT.threw);
    }
  };
  const onClick = (): void => {
    setFailed(null);
    void downloadDocFile(p.project, p.pin, p.name, assets?.loaders).then((a) => {
      if (a.s === 'ok') return;
      const over = a.s === 'failed' && p.pin.kind === 'committed' ? rangeOfTooLarge(a.body) : null;
      if (over !== null) void readByRange(over);
      else setFailed(a.s === 'failed' ? failureSentence(a.body) : slotSentence(a));
    });
  };
  return (
    <>
      <button type="button" className="docs-leaf-action" disabled={reading !== null} onClick={onClick}>{DOCS_VIEW_TEXT.download}</button>
      {reading !== null && <p className="docs-loading" role="status">{reading}</p>}
      {failed !== null && (
        <p className="docs-note" role="alert">{fillSentence(DOCS_VIEW_TEXT.downloadFailed, { sentence: failed })}</p>
      )}
    </>
  );
}

function SourceButton(p: { readonly shown: boolean; readonly onToggle: () => void }): ReactNode {
  return (
    <button type="button" className="docs-leaf-action" aria-pressed={p.shown} onClick={p.onToggle}>
      {DOCS_VIEW_TEXT.source}
    </button>
  );
}

/** A file's text as Source shows it: plain, in `<pre class="doc-plain">`; bytes that are not UTF-8 as `DocPlain`. */
function SourceText(p: { readonly show: DocsShowOk }): ReactNode {
  const src = docMarkdownSource(p.show);
  if (src.kind === 'no-bytes') return <DocsFailureView answer={malformed(DOCS_SHOW_NO_BYTES)} />;
  if (src.kind === 'not-utf8') return <DocPlain text={src.text} note={DOC_NOT_UTF8_NOTE} />;
  return <pre className="doc-plain">{src.text}</pre>;
}

/** A `text` leaf (spec 4.4, "The text leaf"): when a registered grammar knows the extension (`highlightNames.ts`, never
 *  highlight.js), the file is one `CodeBlock` on a one-block highlight store on the Docs highlighter, seeded with
 *  that block when it is created, published for the leaf's actions and released on unmount; else plain. */
function TextBody(p: { readonly show: DocsShowOk; readonly path: string }): ReactNode {
  const src = useMemo(() => docMarkdownSource(p.show), [p.show]);
  const name = leafName(p.path);
  // contentClass said `text`, so the extension is ASCII `a-z0-9` once lowered: `toLowerCase` lowers it the same way.
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const text = src.kind === 'markdown' && isRegisteredGrammar(ext) ? src.text : null;
  const store = useDocsHighlightStore(useMemo(
    () => (text === null ? null : [{ lang: ext, raw: text.replace(/\n$/, '') }]),
    [ext, text],
  ));
  // What this body shows, for Export: its text, and the grammar that colours it, if any. Bytes that are not UTF-8 are
  // `DocPlain`'s, which publishes itself.
  usePublishExportBody(useMemo<ExportBody | null>(
    () => (src.kind === 'markdown' ? { kind: 'text', text: src.text, lang: text === null ? null : ext } : null), [src, text, ext]));
  if (src.kind === 'no-bytes') return <DocsFailureView answer={malformed(DOCS_SHOW_NO_BYTES)} />;
  if (src.kind === 'not-utf8') return <DocPlain text={src.text} note={DOC_NOT_UTF8_NOTE} />;
  if (store === null) return <pre className="doc-plain">{src.text}</pre>;
  return (
    <PreHighlightContext value={store}>
      <CodeBlock><code className={'language-' + ext}>{src.text}</code></CodeBlock>
    </PreHighlightContext>
  );
}

/** An `svg` leaf (spec 5.5): the bytes as the same `data:` image Markdown gets (never a `blob:`, never `/api/`),
 *  with Source and Download. */
function SvgBody(p: { readonly show: DocsShowOk; readonly answered: string; readonly download: ReactNode; readonly name: string }): ReactNode {
  const [source, setSource] = useState(false);
  const bytes = p.answered === 'svg' ? showBytes(p.show) : null;
  if (bytes === null) return <DocsFailureView answer={malformed(p.answered === 'svg' ? DOCS_SHOW_NO_BYTES : DOCS_SHOW_NOT_SVG)} />;
  return (
    <div className="docs-svg">
      <div className="docs-leaf-actions"><SourceButton shown={source} onToggle={() => setSource((s) => !s)} />{p.download}</div>
      {source ? <SourceText show={p.show} /> : <img className="docs-svg-img" src={svgDataUrl(bytes)} alt={p.name} />}
    </div>
  );
}

/** The `html` leaf (base 5.6.7): the mockup viewer. Its context is the page's own pin and the tree this leaf listed, and
 *  its reader goes through the screen's loaders and queue (`DocsAssetContext`), so a mockup's assets share the images'
 *  one queue. Outside a Docs screen there is no such context, and the leaf is Source and Download alone, with no frame.
 *  The view is keyed by the document's identity AND the mode (`bodyKeyOf`, the page's view and frame): a re-list that
 *  moves the commit but not the file does not remount it (its one-relist cap would start over), and a new draft
 *  fingerprint, a version page, a view or a frame change does (D-8711). */
function HtmlBody(p: {
  readonly show: DocsShowOk; readonly pin: DocPin; readonly tree: DocsTreeOk; readonly page: Leaf; readonly visit: DocsVisit;
  readonly bodyKey: string; readonly download: ReactNode;
}): ReactNode {
  const assets = useContext(DocsAssetContext);
  const { page, pin, tree } = p;
  const context = useMemo<MockupContext>(() => ({ project: page.project, pin, tree }), [page.project, pin, tree]);
  const loaders = assets?.loaders;
  const queue = assets?.queue;
  const reader = useMemo(
    () => (loaders === undefined || queue === undefined ? null : mockupAssetReader(page.project, loaders, queue)),
    [page.project, loaders, queue],
  );
  const [source, setSource] = useState(false);
  if (reader === null) {
    return (
      <div className="docs-standin">
        <div className="docs-leaf-actions"><SourceButton shown={source} onToggle={() => setSource((s) => !s)} />{p.download}</div>
        {source && <SourceText show={p.show} />}
      </div>
    );
  }
  const key = [p.bodyKey, page.view, page.frame].join('\u0000');
  return <MockupView key={key} show={p.show} context={context} reader={reader} page={page} relist={p.visit.retryTree} download={p.download} />;
}

/** The leaf's own image is not an embedded draft asset (the truth line already says draft), so this leaf's assets
 *  context never counts it. */
const IGNORE_DRAFT_ASSET = (): void => {};

/** A `raster` leaf (spec 4.4: "one `DocImage`"): the leaf's own file as the only image of a one-image page, so the
 *  pin rule, the cap, the queue, the raster checks and the object URL are all `DocImage`'s. The image is the page
 *  itself, so two things a Markdown image does are withheld here: a tap on it opens nothing (its target is this very
 *  leaf, and `DocImage` would push a duplicate entry and drop `view=committed`), so it renders inside
 *  `DocInLinkContext` as a bare `<img>` with no button to focus; and it is not counted as a drafted asset the page
 *  embeds. The Download button sits in the actions row under this body, so the in-link refusal (no action buttons) loses
 *  nothing. Its one image reports the pin it settled at to `onLeafImage` (through `DocsLeafImageContext`), which Share
 *  waits for (spec 4.16; refinement (f)); no image inside a document has that listener. */
function RasterBody(p: {
  readonly link: LinkBase; readonly name: string; readonly onLeafImage: ((pin: DocPin | null) => void) | null;
  /** A version page (review Q4): told when the raster route answers `too-large` with the blob at the version's commit, so
   *  the leaf reads the image by range instead. Absent, the failure is the image's own sentence. */
  readonly onOverCap?: ((over: { blob: string; size: number }) => void) | null;
}): ReactNode {
  const assets = useContext(DocsAssetContext);
  const onOverCap = p.onOverCap ?? null;
  const own = useMemo<DocsAssetContextValue | null>(() => {
    if (assets === null) return null;
    const base = { ...assets, onDraftAsset: IGNORE_DRAFT_ASSET };
    if (onOverCap === null) return base;
    const raster: DocsLoaders['raster'] = async (project, pin, signal) => {
      const answer = await assets.loaders.raster(project, pin, signal);
      const over = answer.s === 'failed' ? rangeOfTooLarge(answer.body) : null;
      if (over !== null) onOverCap(over);
      return answer;
    };
    return { ...base, loaders: { ...assets.loaders, raster } };
  }, [assets, onOverCap]);
  const node = useMemo<HastElement>(() => ({ type: 'element', tagName: 'img', properties: {}, children: [] }), []);
  const ctx = useMemo<DocLinkContextValue>(() => {
    const urls = new WeakMap<HastElement, DetachedUrls>();
    urls.set(node, { attrs: { src: './' + encodeURIComponent(p.name) }, imageIndex: 0 });
    return { ...p.link, urls };
  }, [p.link, p.name, node]);
  return (
    <div className="docs-raster">
      <DocsAssetContext value={own}>
        <DocLinkContext value={ctx}><DocInLinkContext value={true}><DocsLeafImageContext value={p.onLeafImage}><DocImage node={node} alt={p.name} /></DocsLeafImageContext></DocInLinkContext></DocLinkContext>
      </DocsAssetContext>
    </div>
  );
}

/** What a Markdown body is keyed by: a value that changes only when the bytes can. A draft is keyed by its pin (every
 *  field, its fingerprint among them, so a new fingerprint asks the render gate again). A version page's body
 *  (`version`) is keyed by its pin too, so it remounts the reader with its own sha (rich-docs spec 4.1) even when its
 *  blob is the latest's (refinement (p)). Any other committed body is keyed by the blob the ANSWER carries, so a re-list
 *  that moves the commit but not the file keeps the formatted body (and its scroll), and an answer with no blob falls
 *  back to the commit-bearing pin. */
function bodyKeyOf(pin: DocPin, show: DocsShowOk, pinKey: string, version: boolean): string {
  if (pin.kind === 'draft' || version || show.blob === undefined) return pinKey;
  return ['blob', show.blob, show.section, show.path].join('\u0000');
}

/** A Markdown leaf's body, keyed by its bytes' identity, under the page's link context: the rich reader (`ReaderFrame`,
 *  which falls back to the plain view itself) when the page has one, else `DocMarkdown` as before (`reader === null`:
 *  this browser has no worker, and the plain view is the only view). */
function MarkdownBody(p: {
  readonly show: DocsShowOk; readonly bodyKey: string; readonly link: LinkBase; readonly parser: MarkdownParser;
  /** What the reader's history is read for: the pin this body opened at, the page now and the day filter of the entry. */
  readonly pin: DocPin; readonly page: Leaf; readonly only: string | null;
  readonly reader: ReaderDeps | null; readonly pendingFragment: string | null; readonly onFragmentConsumed: () => void;
}): ReactNode {
  const src = useMemo(() => docMarkdownSource(p.show), [p.show]);
  if (src.kind === 'no-bytes') return <DocsFailureView answer={malformed(DOCS_SHOW_NO_BYTES)} />;
  if (src.kind === 'not-utf8') return <DocPlain text={src.text} note={DOC_NOT_UTF8_NOTE} />;
  if (p.reader === null) {
    return <DocMarkdown key={p.bodyKey} text={src.text} pinKey={p.bodyKey} parser={p.parser} link={p.link} />;
  }
  // X2 P1 (spec 4.3, the render-gate carry): above the render gate the text is read in parts no larger than the gate,
  // each its own rich mount; the reader frame itself is unchanged (it meets no part above its gate).
  if (utf8Bytes(src.text) > DOCS_RENDER_GATE_BYTES) {
    const reader = p.reader;
    return (
      <MarkdownParts
        key={p.bodyKey} text={src.text} pre={reader.render} fragment={p.pendingFragment}
        renderPart={(part) => {
          const show: DocsShowOk = { ...p.show, encoding: 'utf8', text: part.text, size: utf8Bytes(part.text) };
          const key = p.bodyKey + '\u0000part:' + String(part.index);
          return (
            <ReaderFrame
              key={key + '\u0000' + (p.only ?? '')} show={show} bodyKey={key} link={p.link} parser={p.parser}
              reader={reader} opened={{ pin: p.pin, page: p.page, only: p.only }}
              pendingFragment={part.fragment} onFragmentConsumed={p.onFragmentConsumed}
            />
          );
        }}
      />
    );
  }
  return (
    <ReaderFrame
      // A new day filter on the same URL is a new body, which seeds it (M8.22); `bodyKey` itself is the bytes' identity.
      key={p.bodyKey + '\u0000' + (p.only ?? '')} show={p.show} bodyKey={p.bodyKey} link={p.link} parser={p.parser}
      reader={p.reader} opened={{ pin: p.pin, page: p.page, only: p.only }}
      pendingFragment={p.pendingFragment} onFragmentConsumed={p.onFragmentConsumed}
    />
  );
}

/** The opened pin of bytes read by range (spec 4.3, "Where the time comes from, and where the pin lives"): a draft the
 *  listing could not fingerprint takes the snapshot's digest as its `fp`, the sha256 of the bytes the page shows, and
 *  keeps its stat, so `samePin` holds it equal to the listing's pin and every reader of `fp` reads the bytes' digest. */
export function openedRangePin(pin: DocListPin, digest: string): DocPin {
  return pin.kind === 'draft' && pin.fp === null ? { ...pin, fp: digest, stat: pin.stat } : pin;
}

/** The bytes a range read gave, decoded as UTF-8. `utf8: false` carries the lossy decoding, for the plain view with its
 *  note (spec 4.4's not-UTF-8 row); a file that is not UTF-8 is never parsed, and never shown as source in parts. */
function decodeRangeBytes(bytes: Uint8Array<ArrayBuffer>): { utf8: boolean; text: string } {
  try {
    return { utf8: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { utf8: false, text: new TextDecoder('utf-8').decode(bytes) };
  }
}

/** The docs-show answer of bytes read by range: their text, size and digest, under the opened pin. */
function rangeShowOf(read: RangeBytes, entry: DocsEntry, opened: DocPin, text: string): DocsShowOk {
  const base = {
    v: 1 as const, verb: 'docs-show' as const, ok: true as const, elapsedMs: 0, section: entry.section, path: entry.path,
    size: read.bytes.length, sha256: read.digest, encoding: 'utf8' as const, text,
  };
  return opened.kind === 'draft'
    ? { ...base, source: 'draft', branch: opened.branch, head: opened.head, fp: read.digest }
    : { ...base, source: 'committed', commit: opened.commit, blob: entry.committed?.blob, onRef: 'unmeasured' };
}

/** One part of a text file read by range, through the leaf's own source body (`TextBody`): the part's text as a docs-show
 *  answer of its own, so it meets the same highlight budgets a text file under the cap meets. */
function RangeSourcePart(p: { readonly base: DocsShowOk; readonly text: string; readonly path: string }): ReactNode {
  const show = useMemo<DocsShowOk>(() => ({ ...p.base, encoding: 'utf8', text: p.text, size: utf8Bytes(p.text) }), [p.base, p.text]);
  return <TextBody show={show} path={p.path} />;
}

/** A text leaf read by range (spec 4.3, review F1): a file above its class cap, or a draft with no fingerprint, shown as
 *  source in parts of at most the text class cap, each part through the same source and highlight body. Bytes that are not
 *  UTF-8 stay a Download. */
export function RangeSource(p: { readonly read: RangeBytes; readonly entry: DocsEntry; readonly pin: DocListPin }): ReactNode {
  const opened = useMemo(() => openedRangePin(p.pin, p.read.digest), [p.pin, p.read.digest]);
  const decoded = useMemo(() => decodeRangeBytes(p.read.bytes), [p.read.bytes]);
  const base = useMemo(() => rangeShowOf(p.read, p.entry, opened, ''), [p.read, p.entry, opened]);
  if (!decoded.utf8) return <p className="docs-note">{fillSentence(DOCS_RANGE_TEXT.downloadOnly, { size: mib(p.read.bytes.length) })}</p>;
  return (
    <SourceParts
      key={p.read.digest} text={decoded.text} maxBytes={DOCS_CLASS_CAP.text}
      renderPart={(part) => <RangeSourcePart key={part.index} base={base} text={part.text} path={p.entry.path} />}
    />
  );
}

/** A Markdown leaf read by range (spec 4.3): its bytes as a docs-show answer of their own (text, size and digest), under
 *  the opened pin, through the same Markdown body, which shows it in parts. */
export function RangeMarkdown(p: {
  readonly read: RangeBytes; readonly entry: DocsEntry; readonly pin: DocListPin; readonly page: Leaf; readonly link: LinkBase;
  readonly parser: MarkdownParser; readonly reader: ReaderDeps | null; readonly only: string | null;
  readonly pendingFragment: string | null; readonly onFragmentConsumed: () => void;
}): ReactNode {
  const opened = useMemo(() => openedRangePin(p.pin, p.read.digest), [p.pin, p.read.digest]);
  // Bytes that are not UTF-8 are shown as the plain view with its note, never parsed (spec 4.4's not-UTF-8 row).
  const decoded = useMemo(() => decodeRangeBytes(p.read.bytes), [p.read.bytes]);
  const show = useMemo<DocsShowOk>(() => rangeShowOf(p.read, p.entry, opened, decoded.text), [p.read, p.entry, opened, decoded]);
  const bodyKey = ['range', p.page.project, p.entry.section, p.entry.path, p.read.digest].join('\u0000');
  if (!decoded.utf8) return <DocPlain text={decoded.text} note={DOC_NOT_UTF8_NOTE} />;
  return (
    <MarkdownBody
      show={show} bodyKey={bodyKey} link={p.link} parser={p.parser} pin={opened} page={p.page} only={p.only}
      reader={p.reader} pendingFragment={p.pendingFragment} onFragmentConsumed={p.onFragmentConsumed}
    />
  );
}

/** One leaf page's body (spec 4.4). `page` is a leaf of `tree` (`docsPathKind` said so); given anything else it
 *  renders nothing. */
export function DocsLeaf(p: {
  readonly visit: DocsVisit; readonly tree: DocsTreeOk; readonly page: Leaf; readonly parser: MarkdownParser;
  /** The rich reader's deps; absent or `null`, a Markdown leaf is the plain view alone. */
  readonly reader?: ReaderDeps | null;
  /** Where the leaf's own raster image reports the pin it settled at (Share waits for it, spec 4.16); absent or `null`,
   *  nothing listens. */
  readonly onLeafImage?: ((pin: DocPin | null) => void) | null;
  /** The range read's loader (X2 P1); absent, `api.docs.range`. */
  readonly rangeLoader?: RangeLoader;
}): ReactNode {
  const { visit, tree, page, parser } = p;
  const reader = p.reader ?? null;
  const assets = useContext(DocsAssetContext);
  const rangeLoader = p.rangeLoader ?? assets?.loaders.range ?? api.docs.range;
  // The day filter of the history entry the page stands on (never in the URL): it follows back and forward.
  const only = useReaderOnly();
  const root = useRef<HTMLDivElement | null>(null);
  const cls = contentClass(page.path);
  // Only a Markdown body has anchors; a fragment meant for any other leaf is spent as soon as that leaf is open.
  useFragmentScroll(root, cls === 'markdown' ? visit.pendingFragment : null, visit.setFragment);
  const { pendingFragment, setFragment } = visit;
  const fragmentConsumed = useCallback(() => setFragment(null), [setFragment]);
  useEffect(() => {
    if (cls !== 'markdown' && pendingFragment !== null) setFragment(null);
  }, [cls, pendingFragment, setFragment]);
  const pin = pinFor(tree, page);
  const link = useMemo<LinkBase>(() => ({
    project: page.project, pageRef: page.ref, pageAt: page.at, view: page.view, section: page.section, path: page.path, tree,
    pageSource: pin?.kind === 'draft' ? 'draft' : 'committed', onFragment: visit.setFragment,
  }), [page, tree, pin?.kind, visit.setFragment]);
  // A raster on a version page learns it is over its cap from the raster route's own answer (the visit reads no raster).
  const versionKey = JSON.stringify([page.project, page.ref, page.at, page.section, page.path]);
  const [rasterOver, setRasterOver] = useState<{ key: string; blob: string; size: number } | null>(null);
  const onRasterOver = useCallback(
    (over: { blob: string; size: number }) => setRasterOver({ key: versionKey, ...over }), [versionKey]);
  const entry = tree.entries.find((e) => e.section === page.section && e.path === page.path);
  if (entry === undefined) return null;
  const view = entryView(entry, tree.drafts, page.ref === null ? 'default' : 'ref');
  const name = leafName(page.path);
  let body: ReactNode;
  if (view.opens === 'none' || pin === null) {
    const why = view.committedKind === 'symlink' ? DOCS_VIEW_TEXT.symlink
      : view.committedKind === 'submodule' ? DOCS_VIEW_TEXT.submodule : DOCS_VIEW_TEXT.nothingToShow;
    body = <p className="docs-note">{why}</p>;
  } else {
    // A draft with no fingerprint is downloaded through its range read (`RangeLeaf`'s own button), never the file route.
    const download = pin.kind === 'draft' && pin.fp === null ? null
      : <DownloadButton project={page.project} pin={pin} name={name} rangeLoader={rangeLoader} />;
    const file = visit.file;
    const listedSize = page.at !== null ? undefined : pin.kind === 'draft' ? entry.draft?.size : entry.committed?.size;
    const rasterByRange = cls === 'raster'
      && ((pin.kind === 'draft' && pin.fp === null) || (typeof listedSize === 'number' && listedSize > DOCS_MAX_IMAGE_BYTES));
    // One range read of `rpin`'s bytes, the view by class: an image on its own page, Markdown in parts, a text file as
    // source in parts, any other class a Download that reads by range first.
    const rangeBody = (rpin: DocListPin, range: DocsRangePin, size: number, rentry: DocsEntry): ReactNode => (
      <RangeLeaf
        key={rangeReadKey({ project: page.project, pin: rpin, range, size })}
        target={{ project: page.project, pin: rpin, range, size }} cls={cls} name={name} loader={rangeLoader} visit={visit}
      >
        {cls === 'raster'
          ? (read) => (
            <RangeImage
              bytes={read.bytes} path={page.path} name={name}
              assetKey={docsApi.file(page.project, openedRangePin(rpin, read.digest))}
              openedPin={openedRangePin(rpin, read.digest)} onShown={p.onLeafImage ?? null}
            />
          )
          : cls === 'markdown'
            ? (read) => (
              <RangeMarkdown
                read={read} entry={rentry} pin={rpin} page={page} link={link} parser={parser} reader={reader} only={only}
                pendingFragment={pendingFragment} onFragmentConsumed={fragmentConsumed}
              />
            )
            : cls === 'text'
              ? (read) => <RangeSource read={read} entry={rentry} pin={rpin} />
              : undefined}
      </RangeLeaf>
    );
    // A version page (review Q4): the listing's size is the served commit's, so the file route (or, for an image, the
    // raster route) answered `too-large`, and that answer names the size and the blob of this path AT the version's
    // commit: the same range read, pinned by that blob. An answer that names none keeps the class cap's sentence.
    const over = pin.kind !== 'committed' || page.at === null ? null
      : cls === 'raster' ? (rasterOver !== null && rasterOver.key === versionKey ? rasterOver : null)
        : file.s === 'failed' ? rangeOfTooLarge(file.body) : null;
    if (over !== null) {
      const atVersion: DocsEntry = entry.committed === null ? entry : { ...entry, committed: { ...entry.committed, blob: over.blob } };
      body = rangeBody(pin, { kind: 'blob', sha: over.blob }, over.size, atVersion);
    } else if (cls === 'raster' && rasterByRange) {
      // X2 P1 (spec 4.3): an image above its class cap, or a draft image with no fingerprint, is shown on its own page
      // from bytes read by range, after its header's dimensions pass the image-view ceilings.
      const range = rangePinOf(pin, entry);
      body = range === null || typeof listedSize !== 'number'
        ? <p className="docs-note">{DOCS_VIEW_TEXT.nothingToShow}</p>
        : rangeBody(pin, range, listedSize, entry);
    } else if (cls === 'raster') {
      body = (
        <>
          <RasterBody link={link} name={name} onLeafImage={p.onLeafImage ?? null} onOverCap={page.at !== null ? onRasterOver : null} />
          <div className="docs-leaf-actions">{download}</div>
        </>
      );
    } else if (file.s === 'too-large' || file.s === 'stat-pinned') {
      // X2 P1 (spec 4.3): above the class cap, or a draft with no fingerprint, the file is read by range up to the range
      // ceiling: Markdown is shown in parts, a text file as source in parts (review F1); every other class is offered as a
      // Download read the same way.
      const range = rangePinOf(file.pin, entry);
      body = range === null ? <p className="docs-note">{DOCS_VIEW_TEXT.nothingToShow}</p> : rangeBody(file.pin, range, file.size, entry);
    } else if (cls === 'other') {
      const size = page.at !== null ? undefined : pin.kind === 'draft' ? entry.draft?.size : entry.committed?.size;
      body = (
        <>
          <p className="docs-note">{fillSentence(DOCS_VIEW_TEXT.noPreview, typeof size === 'number' ? { size: kib(size) } : {})}</p>
          <div className="docs-leaf-actions">{download}</div>
        </>
      );
    } else if (file.s === 'none') {
      body = <p className="docs-note">{DOCS_VIEW_TEXT.nothingToShow}</p>;
    } else if (file.s === 'loading') {
      body = <p className="docs-loading">{DOCS_VIEW_TEXT.loading}</p>;
    } else if (file.s === 'changing') {
      body = (
        <div className="docs-changing" role="alert">
          <p className="docs-note">{DOCS_VIEW_TEXT.changing}</p>
          <Button variant="ghost" className="docs-fail-action" onClick={visit.retryFile}>Retry</Button>
        </div>
      );
    } else if (file.s === 'failed' && page.at !== null && file.body.failure === 'unknown-commit') {
      // Refinement (p): the commit is the URL's, and no re-list can bring it back; on a shared link it may simply not be
      // in this box's clone, so the words name what is missing rather than the listing's remedy.
      // Retry is manual only: a refresh may have fetched the commit since, but nothing reads it again by itself.
      body = (
        <>
          <p className="docs-note">{fillSentence(DOCS_VIEW_TEXT.versionUnknownCommit, { short: shortCommit(page.at) })}</p>
          <div className="docs-leaf-actions">
            <Button variant="ghost" className="docs-fail-action" onClick={visit.retryFile}>Retry</Button>
          </div>
        </>
      );
    } else if (file.s !== 'ok') {
      body = <DocsFailureView answer={notOkOf(file)} onRetry={visit.retryFile} />;
    } else {
      const show = file.answer.show;
      const pinKey = docsApi.file(page.project, file.pin);
      switch (cls) {
        case 'markdown':
          body = (
            <MarkdownBody
              show={show} bodyKey={bodyKeyOf(file.pin, show, pinKey, page.at !== null)} link={link} parser={parser}
              pin={file.pin} page={page} only={only} reader={reader} pendingFragment={pendingFragment} onFragmentConsumed={fragmentConsumed}
            />
          );
          break;
        case 'text':
          body = <TextBody show={show} path={page.path} />;
          break;
        case 'svg':
          body = <SvgBody key={pinKey} show={show} answered={file.answer.contentClass} download={download} name={name} />;
          break;
        case 'html':
          body = (
            <HtmlBody
              show={show} pin={file.pin} tree={tree} page={page} visit={visit} download={download}
              bodyKey={bodyKeyOf(file.pin, show, pinKey, page.at !== null)}
            />
          );
          break;
      }
    }
  }
  return <div className="docs-leaf" data-class={cls} ref={root}>{body}</div>;
}
