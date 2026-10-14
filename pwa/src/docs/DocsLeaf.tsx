// A Docs leaf (spec 2026-10-01 4.4's leaf row, 5.4, 5.5, 6.1; refinement (b); W5 part 1 Task 9): the body by
// `contentClass(path)`. `markdown` is `DocMarkdown`; `raster` is ONE `DocImage` (its bytes through `loaders.raster`,
// an object URL); `svg` is the same `data:` image Markdown gets, with Source and Download; `html` is the stand-in
// until W6's mockup viewer (no frame of any kind); `text` is the file in `<pre class="doc-plain">`, or `CodeBlock`
// when a registered grammar matches its extension; `other` is "No preview" and Download. A listed size over its
// class cap is the `too-large` sentence, and nothing was requested (the visit's `too-large` slot). The header and the
// banners are `DocsScreen`'s (`DocsHead`, `DocsBanners`), above this body, so a file failure replaces only the body.
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Element as HastElement } from 'hast';
import hljs from 'highlight.js/lib/core';
import { contentClass, docsApi, entryView, type DocPin, type DocsPageLocation, type DocsShowOk, type DocsTreeOk } from '../../../shared/docs';
import { CodeBlock } from '../lib/markdown';
import type { MarkdownParser } from '../lib/markdownRunner';
import { DocImage, DocsAssetContext, svgDataUrl, type DocsAssetContextValue } from './DocImage';
import { DocInLinkContext, DocLinkContext, fragmentTarget, type DocLinkContextValue } from './DocLink';
import { DOC_NOT_UTF8_NOTE, DocMarkdown, DocPlain, docMarkdownSource } from './DocMarkdown';
import { DocsFailureView } from './DocsFailureView';
import type { DetachedUrls } from './docsLinks';
import { DOCS_SHOW_NO_BYTES, DOCS_SHOW_NOT_SVG, DOCS_VIEW_TEXT, failureSentence, fillSentence, kib, slotSentence } from './docsText';
import { leafName } from './docsTree';
import type { DocsNotOk } from './failures';
import { downloadDocFile, showBytes } from './objectUrls';
import { pinFor, type DocsVisit, type FileSlot } from './useDocsVisit';

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
function DownloadButton(p: { readonly project: string; readonly pin: DocPin; readonly name: string }): ReactNode {
  const assets = useContext(DocsAssetContext);
  const [failed, setFailed] = useState<string | null>(null);
  const onClick = (): void => {
    setFailed(null);
    void downloadDocFile(p.project, p.pin, p.name, assets?.loaders).then((a) => {
      if (a.s !== 'ok') setFailed(a.s === 'failed' ? failureSentence(a.body) : slotSentence(a));
    });
  };
  return (
    <>
      <button type="button" className="docs-leaf-action" onClick={onClick}>{DOCS_VIEW_TEXT.download}</button>
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

/** A `text` leaf (spec 4.4): highlighted through the shared `CodeBlock` (and its size and word bounds) when a
 *  registered grammar knows the extension, else plain. */
function TextBody(p: { readonly show: DocsShowOk; readonly path: string }): ReactNode {
  const src = docMarkdownSource(p.show);
  if (src.kind === 'no-bytes') return <DocsFailureView answer={malformed(DOCS_SHOW_NO_BYTES)} />;
  if (src.kind === 'not-utf8') return <DocPlain text={src.text} note={DOC_NOT_UTF8_NOTE} />;
  const name = leafName(p.path);
  // contentClass said `text`, so the extension is ASCII `a-z0-9` once lowered: `toLowerCase` lowers it the same way.
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (hljs.getLanguage(ext) === undefined) return <pre className="doc-plain">{src.text}</pre>;
  return <CodeBlock><code className={'language-' + ext}>{src.text}</code></CodeBlock>;
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

/** The `html` stand-in until W6 (refinement (b)): the sentence, the size, Source and Download. It draws no frame of
 *  any kind and gives the HTML to nothing but the text renderer; `?frame=full` renders the same. */
function HtmlStandIn(p: { readonly show: DocsShowOk; readonly download: ReactNode }): ReactNode {
  const [source, setSource] = useState(false);
  return (
    <div className="docs-standin">
      <p className="docs-note">{DOCS_VIEW_TEXT.htmlStandIn}</p>
      <p className="docs-note">{fillSentence(DOCS_VIEW_TEXT.size, { size: kib(p.show.size) })}</p>
      <div className="docs-leaf-actions"><SourceButton shown={source} onToggle={() => setSource((s) => !s)} />{p.download}</div>
      {source && <SourceText show={p.show} />}
    </div>
  );
}

/** The leaf's own image is not an embedded draft asset (the truth line already says draft), so this leaf's assets
 *  context never counts it. */
const IGNORE_DRAFT_ASSET = (): void => {};

/** A `raster` leaf (spec 4.4: "one `DocImage`"): the leaf's own file as the only image of a one-image page, so the
 *  pin rule, the cap, the queue, the raster checks and the object URL are all `DocImage`'s. The image is the page
 *  itself, so two things a Markdown image does are withheld here: a tap on it opens nothing (its target is this very
 *  leaf, and `DocImage` would push a duplicate entry and drop `view=committed`), so it renders inside
 *  `DocInLinkContext` as a bare `<img>` with no button to focus; and it is not counted as a drafted asset the page
 *  embeds. The leaf's header already offers Download, so the in-link refusal (no action buttons) loses nothing. */
function RasterBody(p: { readonly link: LinkBase; readonly name: string }): ReactNode {
  const assets = useContext(DocsAssetContext);
  const own = useMemo<DocsAssetContextValue | null>(
    () => (assets === null ? null : { ...assets, onDraftAsset: IGNORE_DRAFT_ASSET }), [assets]);
  const node = useMemo<HastElement>(() => ({ type: 'element', tagName: 'img', properties: {}, children: [] }), []);
  const ctx = useMemo<DocLinkContextValue>(() => {
    const urls = new WeakMap<HastElement, DetachedUrls>();
    urls.set(node, { attrs: { src: './' + encodeURIComponent(p.name) }, imageIndex: 0, highlight: null });
    return { ...p.link, urls };
  }, [p.link, p.name, node]);
  return (
    <div className="docs-raster">
      <DocsAssetContext value={own}>
        <DocLinkContext value={ctx}><DocInLinkContext value={true}><DocImage node={node} alt={p.name} /></DocInLinkContext></DocLinkContext>
      </DocsAssetContext>
    </div>
  );
}

/** What a Markdown body is keyed by: a value that changes only when the bytes can. A draft is keyed by its pin (every
 *  field, its fingerprint among them, so a new fingerprint asks the render gate again). A committed body is keyed by
 *  the blob the ANSWER carries, so a re-list that moves the commit but not the file keeps the formatted body (and its
 *  scroll), and an answer with no blob falls back to the commit-bearing pin. */
function bodyKeyOf(pin: DocPin, show: DocsShowOk, pinKey: string): string {
  if (pin.kind === 'draft' || show.blob === undefined) return pinKey;
  return ['blob', show.blob, show.section, show.path].join('\u0000');
}

/** A Markdown leaf's body: `DocMarkdown` keyed by its bytes' identity, under the page's link context. */
function MarkdownBody(p: { readonly show: DocsShowOk; readonly bodyKey: string; readonly link: LinkBase; readonly parser: MarkdownParser }): ReactNode {
  const src = useMemo(() => docMarkdownSource(p.show), [p.show]);
  if (src.kind === 'no-bytes') return <DocsFailureView answer={malformed(DOCS_SHOW_NO_BYTES)} />;
  if (src.kind === 'not-utf8') return <DocPlain text={src.text} note={DOC_NOT_UTF8_NOTE} />;
  return <DocMarkdown key={p.bodyKey} text={src.text} pinKey={p.bodyKey} parser={p.parser} link={p.link} />;
}

/** One leaf page's body (spec 4.4). `page` is a leaf of `tree` (`docsPathKind` said so); given anything else it
 *  renders nothing. */
export function DocsLeaf(p: {
  readonly visit: DocsVisit; readonly tree: DocsTreeOk; readonly page: Leaf; readonly parser: MarkdownParser;
}): ReactNode {
  const { visit, tree, page, parser } = p;
  const root = useRef<HTMLDivElement | null>(null);
  const cls = contentClass(page.path);
  // Only a Markdown body has anchors; a fragment meant for any other leaf is spent as soon as that leaf is open.
  useFragmentScroll(root, cls === 'markdown' ? visit.pendingFragment : null, visit.setFragment);
  const { pendingFragment, setFragment } = visit;
  useEffect(() => {
    if (cls !== 'markdown' && pendingFragment !== null) setFragment(null);
  }, [cls, pendingFragment, setFragment]);
  const pin = pinFor(tree, page);
  const link = useMemo<LinkBase>(() => ({
    project: page.project, pageRef: page.ref, view: page.view, section: page.section, path: page.path, tree,
    pageSource: pin?.kind === 'draft' ? 'draft' : 'committed', onFragment: visit.setFragment,
  }), [page, tree, pin?.kind, visit.setFragment]);
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
    const download = <DownloadButton project={page.project} pin={pin} name={name} />;
    const file = visit.file;
    if (cls === 'raster') {
      body = <><RasterBody link={link} name={name} /><div className="docs-leaf-actions">{download}</div></>;
    } else if (file.s === 'too-large') {
      body = <DocsFailureView answer={{ s: 'failed', body: { ok: false, failure: 'too-large', size: file.size, cap: file.cap } }} />;
    } else if (cls === 'other') {
      const size = pin.kind === 'draft' ? entry.draft?.size : entry.committed?.size;
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
          <button type="button" className="btn-ghost docs-fail-action" onClick={visit.retryFile}>Retry</button>
        </div>
      );
    } else if (file.s !== 'ok') {
      body = <DocsFailureView answer={notOkOf(file)} onRetry={visit.retryFile} />;
    } else {
      const show = file.answer.show;
      const pinKey = docsApi.file(page.project, file.pin);
      switch (cls) {
        case 'markdown':
          body = <MarkdownBody show={show} bodyKey={bodyKeyOf(file.pin, show, pinKey)} link={link} parser={parser} />;
          break;
        case 'text':
          body = <TextBody show={show} path={page.path} />;
          break;
        case 'svg':
          body = <SvgBody key={pinKey} show={show} answered={file.answer.contentClass} download={download} name={name} />;
          break;
        case 'html':
          body = <HtmlStandIn key={pinKey} show={show} download={download} />;
          break;
      }
    }
  }
  return <div className="docs-leaf" data-class={cls} ref={root}>{body}</div>;
}
