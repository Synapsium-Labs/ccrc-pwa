// The export builder (spec 2026-10-01 4.17 "Built as React, never as strings", "The doctype", "The head", "CSP",
// "Stylesheet and theme", "Images", "Size", "Highlighting"; native Docs reader W5, Export; refinements (e), (o), (p),
// (q), (r)). `buildExport` builds one React element, `<html>`, renders it with `renderToStaticMarkup`, joins
// `EXPORT_PREFIX` to the markup in this one place, and answers the bytes, their size, the notes and the count of images
// waiting for Load image, or that the body alone is too large. Every value enters as a React prop or child, so React
// escapes it: an export is inert by construction, with no string-level strip pass (M4.EX2). Images come from the page's
// registry only, after waiting at most `limits.imageWaitMs` for those still loading, and are inlined in document order
// while the file fits `limits.maxBytes`; the first that does not, and every later one, is a placeholder (refinement
// (r)). The body is never cut: a body alone over the limit is rendered again with no store, so every block is plain and
// the provenance says colouring was dropped; still over, the answer is `too-large`. Building makes no request and no
// highlight call: code reads the page's store through `exportEntry` (M4.EX18), and this file's import closure holds no
// highlighter (M4.EX17). The element never leaves this file, which exports only `buildExport` and types (M4.EX16); only
// `ExportSheet.tsx` imports it, through one dynamic `import()`, so `react-dom/server` stays out of the main chunk.
//
// Ring L4 delivery.
import { Fragment, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser';
import type { Element as HastElement, Root as HastRoot, RootContent } from 'hast';
import { PROSE, cn } from '@ccrc/ui';
import { DOCS_RASTER_TYPES, docsApi, type RasterMime } from '../../../../shared/docs';
import { codeBlocksOf, type HighlightStore } from '../../lib/highlightStore';
import { codeBlockParts } from '../../lib/markdown';
import { renderHast } from '../../lib/renderHast';
import { SVG_DATA_PREFIX, planImageRef, rasterDataUrl, svgDataUrl } from '../DocImage';
import type { DocLinkContextValue } from '../DocLink';
import type { DetachedUrls } from '../docsLinks';
import { DOC_IMAGE_TEXT, EXPORT_TEXT, fillSentence, pluralS } from '../docsText';
import { exportColouring, type ExportColouring } from './colouring';
import { settleExportAssets, type ExportAsset, type ExportAssets } from './exportAssets';
import { EXPORT_COMPONENTS, ExportCode, ExportMarkdownContext, type ExportImageDecision } from './exportMarkdown';
import {
  DOCS_EXPORT_CSP, DOCS_EXPORT_IMAGE_WAIT_MS, DOCS_EXPORT_MAX_BYTES, EXPORT_GENERATOR, EXPORT_PREFIX, type ExportMissing,
} from './policy';
import { colouringNotes, missingNotes, type ExportMeta, type ExportProvenance } from './provenance';
import { EXPORT_CSS } from './stylesheet';

/** The body an export holds (spec 4.17 "What the file holds, by content class"). */
export type ExportBodyInput =
  | {
    readonly kind: 'tree'; readonly tree: HastRoot; readonly urls: WeakMap<HastElement, DetachedUrls>;
    readonly link: Omit<DocLinkContextValue, 'urls'>; readonly store: HighlightStore;
  }
  | { readonly kind: 'plain'; readonly text: string; readonly note: string }
  | { readonly kind: 'text'; readonly text: string; readonly lang: string | null; readonly store: HighlightStore | null }
  | {
    readonly kind: 'image'; readonly alt: string; readonly draft: boolean;
    readonly image:
      | { readonly kind: 'raster'; readonly bytes: Uint8Array; readonly mime: RasterMime }
      | { readonly kind: 'svg'; readonly bytes: Uint8Array };
  };

export interface ExportInput {
  readonly title: string;
  readonly name: string;
  /** The exporter's `data-theme` (refinement (e)); `null`: the dark default, which has none. */
  readonly theme: string | null;
  /** C: the commit every permalink names (`ExportProvenance.commit`). */
  readonly commit: string;
  readonly provenance: ExportProvenance;
  readonly body: ExportBodyInput;
  /** The page's image registry, for a Markdown body's images; `null`: none. */
  readonly assets: ExportAssets | null;
}

/** The file's two limits; production passes none and gets `policy.ts`'s (refinement (p)). */
export interface ExportLimits { readonly maxBytes: number; readonly imageWaitMs: number }

export type ExportResult =
  | {
    readonly ok: true; readonly name: string; readonly bytes: Uint8Array<ArrayBuffer>; readonly size: number;
    readonly notes: readonly string[]; readonly deferred: number;
  }
  | { readonly ok: false; readonly why: 'too-large' };

const LIMITS: ExportLimits = { maxBytes: DOCS_EXPORT_MAX_BYTES, imageWaitMs: DOCS_EXPORT_IMAGE_WAIT_MS };
const RASTER_MIMES: readonly string[] = Object.values(DOCS_RASTER_TYPES).map((t) => t.mime);
const NO_IMAGES: ReadonlyMap<HastElement, ExportImageDecision> = new Map();
/** A doctype React may write before `<html>`: removed, so the file holds `EXPORT_PREFIX` only (refinement (q)). */
const LEADING_DOCTYPE = /^<!doctype html>/i;
const encoder = new TextEncoder();
const missing = (why: ExportMissing): ExportImageDecision => ({ kind: 'missing', why });

/** Every `img` of `tree`, in document order. Iterative. */
function imagesOf(tree: HastRoot): HastElement[] {
  const out: HastElement[] = [];
  const stack: RootContent[] = [...tree.children].reverse();
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type !== 'element') continue;
    if (n.tagName === 'img') out.push(n);
    for (let k = n.children.length - 1; k >= 0; k -= 1) stack.push(n.children[k]!);
  }
  return out;
}

function rasterSrc(bytes: Uint8Array, mime: string): string | null {
  return RASTER_MIMES.includes(mime) ? rasterDataUrl(bytes, mime as RasterMime) : null;
}

/** An SVG's `src` is inlined only as the `data:image/svg+xml;base64,` URL Docs itself builds (`DocImage`'s
 *  `SVG_DATA_PREFIX`). React 19 hoists any other `<img src>` into a `<link rel="preload">` written BEFORE the CSP meta, so
 *  the CSP is no second line behind this check. */
const srcOf = (asset: ExportAsset): string | null => (asset.kind === 'svg'
  ? (asset.src.startsWith(SVG_DATA_PREFIX) ? asset.src : null)
  : rasterSrc(asset.bytes, asset.mime));

/** What each image of the body becomes, from the page's registry only (spec 4.17 "Images"; M4.EX3). */
async function decideImages(
  tree: HastRoot, link: DocLinkContextValue, assets: ExportAssets | null, waitMs: number,
): Promise<Map<HastElement, ExportImageDecision>> {
  const planned = imagesOf(tree).map((node) => {
    const recorded = link.urls.get(node);
    const plan = planImageRef(link, recorded?.attrs['src'] ?? '', recorded?.imageIndex ?? null);
    return { node, plan, key: plan.kind === 'pinned' ? docsApi.file(link.project, plan.pin) : null };
  });
  if (assets !== null) await settleExportAssets(assets, planned.flatMap((p) => (p.key === null ? [] : [p.key])), waitMs);
  const out = new Map<HastElement, ExportImageDecision>();
  for (const { node, plan, key } of planned) {
    if (plan.kind === 'refused') {
      out.set(node, missing(plan.why === 'external' ? 'external' : 'refused'));
      continue;
    }
    const held = key === null || assets === null ? undefined : assets.get(key);
    if (held === undefined) out.set(node, missing(plan.deferred ? 'deferred' : 'failed'));
    else if (held.s === 'loading') out.set(node, missing('timed-out'));
    else if (held.s === 'failed') out.set(node, missing('failed'));
    else {
      const src = srcOf(held.asset);
      out.set(node, src === null ? missing('failed') : { kind: 'inline', src, draft: plan.draft });
    }
  }
  return out;
}

/** What the build adds to the provenance for one attempt: the colouring and image lines, the banner's images clause,
 *  and the store the body draws with (`null` once colouring is dropped). */
function partsOf(input: ExportInput, images: ReadonlyMap<HastElement, ExportImageDecision>, coloured: boolean) {
  const body = input.body;
  const store = coloured && (body.kind === 'tree' || body.kind === 'text') ? body.store : null;
  const colouring: ExportColouring | null = body.kind === 'tree'
    ? exportColouring(codeBlocksOf(body.tree), store, !coloured)
    // A text leaf with no store and colouring still on has nothing to count (never `exportColouring(blocks, null, false)`).
    : body.kind === 'text' && body.lang !== null && (store !== null || !coloured)
      ? exportColouring([{ lang: body.lang, raw: body.text.replace(/\n$/, '') }], store, !coloured)
      : null;
  const counts = new Map<ExportMissing, number>();
  let draftImages = 0;
  for (const d of images.values()) {
    if (d.kind === 'missing') counts.set(d.why, (counts.get(d.why) ?? 0) + 1);
    else if (d.draft) draftImages += 1;
  }
  const lines = [...(colouring === null ? [] : [colouringNotes(colouring)]), missingNotes(counts)];
  const notes: readonly string[] = [...input.provenance.notes, ...lines.flatMap((l) => l.notes)];
  const metas: readonly ExportMeta[] = [...input.provenance.metas, ...lines.flatMap((l) => l.metas)];
  const base = input.provenance.banner;
  const banner = base === null || draftImages === 0 ? base
    : `${base} ${fillSentence(EXPORT_TEXT.bannerImages, { k: draftImages, s: pluralS(draftImages) })}`;
  return { store, notes, metas, banner, deferred: counts.get('deferred') ?? 0 };
}

function bodyOf(input: ExportInput, images: ReadonlyMap<HastElement, ExportImageDecision>, store: HighlightStore | null): ReactNode {
  const body = input.body;
  switch (body.kind) {
    case 'tree':
      return (
        <ExportMarkdownContext value={{ link: { ...body.link, urls: body.urls }, commit: input.commit, images, store }}>
          <article className={cn('doc-body', PROSE)}>{renderHast(body.tree, { components: EXPORT_COMPONENTS })}</article>
        </ExportMarkdownContext>
      );
    case 'plain':
      return (
        <article className="doc-body">
          <p className="ccrc-export-note">{body.note}</p>
          <pre className="ccrc-export-plain">{body.text}</pre>
        </article>
      );
    case 'text':
      return body.lang === null
        ? <article className="doc-body"><pre className="ccrc-export-plain">{body.text}</pre></article>
        : (
          <article className={cn('doc-body', PROSE)}>
            <ExportCode parts={codeBlockParts(<code className={'language-' + body.lang}>{body.text}</code>)} store={store} />
          </article>
        );
    case 'image': {
      const src = body.image.kind === 'svg' ? svgDataUrl(body.image.bytes) : rasterSrc(body.image.bytes, body.image.mime);
      if (src === null) throw new Error('buildExport: the image is not a raster type');
      return (
        <article className="doc-body">
          <img className="ccrc-export-img" src={src} alt={body.alt} />
          {body.draft && <>{' '}<span className="ccrc-export-caption">{DOC_IMAGE_TEXT.draft}</span></>}
        </article>
      );
    }
  }
}

function documentOf(input: ExportInput, images: ReadonlyMap<HastElement, ExportImageDecision>, coloured: boolean): ReactElement {
  const parts = partsOf(input, images, coloured);
  return (
    <html data-theme={input.theme ?? undefined}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="Content-Security-Policy" content={DOCS_EXPORT_CSP} />
        <title>{input.title}</title>
        <meta name="generator" content={EXPORT_GENERATOR} />
        {parts.metas.map((m) => <meta key={m.name} name={m.name} content={m.content} />)}
        <style>{EXPORT_CSS}</style>
      </head>
      <body className="ccrc-export">
        {parts.banner !== null && <p className="ccrc-export-draft" role="note">{parts.banner}</p>}
        <div className="ccrc-export-page">
          <section className="ccrc-export-provenance" aria-label={EXPORT_TEXT.provenance}>
            <dl className="ccrc-export-facts">
              {input.provenance.facts.map((f) => <Fragment key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></Fragment>)}
            </dl>
            {parts.notes.length > 0 && <ul className="ccrc-export-notes">{parts.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          </section>
          {bodyOf(input, images, parts.store)}
        </div>
      </body>
    </html>
  );
}

/** The file for one attempt: `EXPORT_PREFIX` joined to the rendered `<html>`, here and nowhere else. */
function fileOf(input: ExportInput, images: ReadonlyMap<HastElement, ExportImageDecision>, coloured: boolean): Uint8Array<ArrayBuffer> {
  const markup = renderToStaticMarkup(documentOf(input, images, coloured));
  return encoder.encode(EXPORT_PREFIX + markup.replace(LEADING_DOCTYPE, ''));
}

export async function buildExport(input: ExportInput, limits: ExportLimits = LIMITS): Promise<ExportResult> {
  const body = input.body;
  const decided = body.kind === 'tree'
    ? await decideImages(body.tree, { ...body.link, urls: body.urls }, input.assets, limits.imageWaitMs)
    : NO_IMAGES;
  const done = (bytes: Uint8Array<ArrayBuffer>, images: ReadonlyMap<HastElement, ExportImageDecision>, coloured: boolean): ExportResult => {
    const parts = partsOf(input, images, coloured);
    return { ok: true, name: input.name, bytes, size: bytes.length, notes: parts.notes, deferred: parts.deferred };
  };
  const whole = fileOf(input, decided, true);
  if (whole.length <= limits.maxBytes) return done(whole, decided, true);
  // The body alone (every inlined image an over-size placeholder), coloured, then plain. The body is never cut.
  const none = new Map<HastElement, ExportImageDecision>(
    [...decided].map(([node, d]): [HastElement, ExportImageDecision] => [node, d.kind === 'inline' ? missing('over-size') : d]));
  let coloured = true;
  let file = fileOf(input, none, true);
  if (file.length > limits.maxBytes) {
    coloured = false;
    file = fileOf(input, none, false);
    if (file.length > limits.maxBytes) return { ok: false, why: 'too-large' };
  }
  // Images back in document order while the file fits: the first that does not, and every later one, stay out.
  const kept = new Map(none);
  const inlined: HastElement[] = [];
  let estimate = file.length;
  for (const [node, d] of decided) {
    if (d.kind !== 'inline') continue;
    if (estimate + d.src.length > limits.maxBytes) break;
    kept.set(node, d);
    inlined.push(node);
    estimate += d.src.length;
  }
  file = fileOf(input, kept, coloured);
  // The estimate counts each `src` and nothing else, so it can run high (a placeholder is wider than a bare `<img>`) or low
  // (a long image title, a draft caption). Whichever way it erred, this keeps the result a prefix of the images and under
  // budget: take the last one back out until the file fits.
  while (file.length > limits.maxBytes && inlined.length > 0) {
    kept.set(inlined.pop()!, missing('over-size'));
    file = fileOf(input, kept, coloured);
  }
  return done(file, kept, coloured);
}
