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
// A mockup (spec 5.6.9; completion plan Task 9) is one more arm of the same builder, never a second one. Its body is the
// viewer's inert Document and the attempt's plan, not a page this file renders: the snapshot (`mockup/exportMockup.ts`,
// built on a clone) is the INNER document, which this file puts in the wrapper's one frame, `<iframe sandbox=""
// srcDoc={inner}>`, the only `iframe` and `srcDoc` of the file (M4.EX16, M5.16), beside the same shell, banner and
// provenance as any export, the inlined-files list, the omitted list and the links list (all React, so escaped). It waits
// at most `limits.imageWaitMs` for the attempt's assets (past it, or when the attempt ended, no asset is inlined and every
// admitted one is listed as still loading, or failed) and counts the FINAL file's bytes, the inner document escaped into
// the attribute plus the wrapper: the snapshot with every loaded asset, else with none (over: `too-large`), else the
// largest prefix of the files, in the order of their first use (`heldInUseOrder`), that fits (`fits` is the one measure).
//
// Ring L4 delivery.
import { Fragment, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser';
import type { Element as HastElement, Root as HastRoot, RootContent } from 'hast';
import { PROSE, cn } from '@ccrc/ui';
import { DOCS_RASTER_TYPES, docRepoPath, docsApi, type RasterMime } from '../../../../shared/docs';
import { codeBlocksOf, type HighlightStore } from '../../lib/highlightStore';
import { codeBlockParts } from '../../lib/markdown';
import { renderHast } from '../../lib/renderHast';
import { SVG_DATA_PREFIX, planImageRef, rasterDataUrl, svgDataUrl } from '../DocImage';
import type { DocLinkContextValue } from '../DocLink';
import type { DetachedUrls } from '../docsLinks';
import { DOC_IMAGE_TEXT, EXPORT_TEXT, fillSentence, kib, pluralS } from '../docsText';
import type { MockupExportAssets, MockupLoadEnd } from '../exportBody';
import { TIMED_OUT, buildMockupSnapshot, heldInUseOrder, mockupDiagramCount } from '../mockup/exportMockup';
import type { MockupAssetPlan, MockupAssetResult } from '../mockup/ports';
import { exportColouring, type ExportColouring } from './colouring';
import { settleExportAssets, type ExportAsset, type ExportAssets } from './exportAssets';
import { EXPORT_COMPONENTS, ExportCode, ExportMarkdownContext, exportLinkTarget, type ExportImageDecision } from './exportMarkdown';
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
  }
  | {
    readonly kind: 'mockup'; readonly doc: Document; readonly assets: MockupExportAssets;
    /** The leaf's place and its listing, for the links list (spec 4.17's link table). */
    readonly link: Pick<DocLinkContextValue, 'section' | 'path' | 'tree'>;
  };

/** `ExportInput` of one arm; the unqualified one is any arm. */
export interface ExportInput<B extends ExportBodyInput = ExportBodyInput> {
  readonly title: string;
  readonly name: string;
  /** The exporter's `data-theme` (refinement (e)); `null`: the dark default, which has none. */
  readonly theme: string | null;
  /** C: the commit every permalink names (`ExportProvenance.commit`). */
  readonly commit: string;
  readonly provenance: ExportProvenance;
  readonly body: B;
  /** The page's image registry, for a Markdown body's images; `null`: none. */
  readonly assets: ExportAssets | null;
}

/** The file's two limits; production passes none and gets `policy.ts`'s (refinement (p)). */
export interface ExportLimits { readonly maxBytes: number; readonly imageWaitMs: number }

/** One file a mockup export inlined (spec 5.6.9 "Inlined files are listed"): its repo path, its size and whether it is a
 *  draft. Hidden-on-screen files are listed too. */
export interface ExportInlinedFile { readonly path: string; readonly size: number; readonly draft: boolean }

/** What a mockup export lists, for the sheet as the file lists it: the inlined files and the assets left out (each once,
 *  in DOM order, as a repo path or the reference as written). */
export interface ExportMockupFacts {
  readonly inlined: readonly ExportInlinedFile[];
  readonly omitted: readonly string[];
}

export type ExportResult =
  | {
    readonly ok: true; readonly name: string; readonly bytes: Uint8Array<ArrayBuffer>; readonly size: number;
    readonly notes: readonly string[]; readonly deferred: number;
    /** A mockup's lists; `null`: not a mockup. */
    readonly mockup: ExportMockupFacts | null;
  }
  | { readonly ok: false; readonly why: 'too-large' };

const LIMITS: ExportLimits = { maxBytes: DOCS_EXPORT_MAX_BYTES, imageWaitMs: DOCS_EXPORT_IMAGE_WAIT_MS };
const RASTER_MIMES: readonly string[] = Object.values(DOCS_RASTER_TYPES).map((t) => t.mime);
const NO_IMAGES: ReadonlyMap<HastElement, ExportImageDecision> = new Map();
/** A doctype React may write before `<html>`: removed, so the file holds `EXPORT_PREFIX` only (refinement (q)). */
const LEADING_DOCTYPE = /^<!doctype html>/i;
const encoder = new TextEncoder();
const missing = (why: ExportMissing): ExportImageDecision => ({ kind: 'missing', why });

type MockupArm = Extract<ExportBodyInput, { kind: 'mockup' }>;
/** Every arm the Markdown, text, plain and image builder draws: all but the mockup's, which has its own below. */
type ShellInput = ExportInput<Exclude<ExportBodyInput, MockupArm>>;

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
function partsOf(input: ShellInput, images: ReadonlyMap<HastElement, ExportImageDecision>, coloured: boolean) {
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

function bodyOf(input: ShellInput, images: ReadonlyMap<HastElement, ExportImageDecision>, store: HighlightStore | null): ReactNode {
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

/** What a shell shows besides its body: the metas, the notes and the banner. */
interface ShellParts {
  readonly metas: readonly ExportMeta[];
  readonly notes: readonly string[];
  readonly banner: string | null;
}

/** The one `<html>` every export is: head, banner, provenance, then `content`. */
function shellOf(input: ExportInput, parts: ShellParts, content: ReactNode): ReactElement {
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
          {content}
        </div>
      </body>
    </html>
  );
}

function documentOf(input: ShellInput, images: ReadonlyMap<HastElement, ExportImageDecision>, coloured: boolean): ReactElement {
  const parts = partsOf(input, images, coloured);
  return shellOf(input, parts, bodyOf(input, images, parts.store));
}

/** The file for an element: `EXPORT_PREFIX` joined to the rendered `<html>`, here and nowhere else. */
function fileOfElement(element: ReactElement): Uint8Array<ArrayBuffer> {
  const markup = renderToStaticMarkup(element);
  return encoder.encode(EXPORT_PREFIX + markup.replace(LEADING_DOCTYPE, ''));
}

/** The file for one attempt of a Markdown, text, plain or image body. */
function fileOf(input: ShellInput, images: ReadonlyMap<HastElement, ExportImageDecision>, coloured: boolean): Uint8Array<ArrayBuffer> {
  return fileOfElement(documentOf(input, images, coloured));
}

// ---------------------------------------------------------------------------------------------------------------
// The mockup arm (spec 5.6.9, 4.17 "Size"; completion plan Task 9; rows M5.EX1, M5.EX5, M5.EX7)
// ---------------------------------------------------------------------------------------------------------------

/** One admitted asset the attempt's result holds, in the order of its first use (`heldInUseOrder`: depth-first in document
 *  order, a stylesheet's nested files right after its use). */
interface HeldFile {
  /** The key of `MockupAssetResult.assets`: the pin's own API URL. */
  readonly key: string;
  readonly path: string;
  readonly draft: boolean;
  readonly size: number;
  /** What the file adds to the saved file, from its `data:` URL's length and its uses on the page: an estimate, which a
   *  stylesheet's nested files and the placeholders' words make run low or high (the measured file decides). */
  readonly estimate: number;
}

function heldFiles(result: MockupAssetResult): HeldFile[] {
  const { rows, context } = result.plan;
  const uses = new Map<string, number>();
  for (const row of rows) {
    if (row.verdict.v === 'inline' && row.ref.depth === 0) {
      const key = docsApi.file(context.project, row.verdict.pin);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const out: HeldFile[] = [];
  for (const { key, verdict } of heldInUseOrder(result)) {
    const held = result.assets.get(key);
    if (held === undefined) continue;
    const url = `data:${verdict.mime};base64,`.length + 4 * Math.ceil(held.bytes.length / 3);
    out.push({
      key, path: docRepoPath(verdict.pin.section, verdict.pin.path), draft: verdict.draft, size: held.bytes.length,
      estimate: url * (uses.get(key) ?? 1),
    });
  }
  return out;
}

/** The attempt's plan with no bytes: every admitted row failed with `failure`, so the snapshot lists each as not
 *  inlined and words it by that failure (`TIMED_OUT`: still loading). */
function unheld(plan: MockupAssetPlan, failure: string): MockupAssetResult {
  const rows = plan.rows.map((row) => (row.verdict.v === 'inline' ? { ...row, verdict: { v: 'failed' as const, failure } } : row));
  return { plan: { ...plan, rows }, actualBytes: 0, assets: new Map() };
}

/** The attempt's end, or `'timed-out'` once `ms` have passed without one. It never rejects. */
function settledWithin(settled: Promise<MockupLoadEnd>, ms: number): Promise<MockupLoadEnd | 'timed-out'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timed-out'), ms);
    const done = (end: MockupLoadEnd): void => {
      clearTimeout(timer);
      resolve(end);
    };
    void settled.then(done, () => done({ s: 'ended' }));
  });
}

/** One try at the file: the snapshot with the first `k` held files, what it lists, and the measured bytes. */
interface MockupTry {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly facts: ExportMockupFacts;
  readonly notes: readonly string[];
}

/** One titled list of the wrapper's chrome: its heading, then one `li` per child. */
function MockupList(p: { readonly heading: string; readonly children: ReactNode }): ReactNode {
  return (
    <section className="ccrc-export-provenance" aria-label={p.heading}>
      <h2 className="ccrc-export-note">{p.heading}</h2>
      <ul className="ccrc-export-notes">{p.children}</ul>
    </section>
  );
}

function MockupContent(p: { readonly title: string; readonly html: string; readonly facts: ExportMockupFacts; readonly links: ReactNode }): ReactNode {
  const { facts } = p;
  return (
    <article className="doc-body">
      {facts.inlined.length > 0 && (
        <MockupList heading={EXPORT_TEXT.mockupInlined}>
          {facts.inlined.map((f, i) => (
            <li key={i}>
              {fillSentence(EXPORT_TEXT.inlinedFile, {
                path: f.path, size: kib(f.size), source: f.draft ? EXPORT_TEXT.fileDraft : EXPORT_TEXT.fileCommitted,
              })}
            </li>
          ))}
        </MockupList>
      )}
      {facts.omitted.length > 0 && (
        <MockupList heading={EXPORT_TEXT.mockupOmitted}>{facts.omitted.map((o, i) => <li key={i}>{o}</li>)}</MockupList>
      )}
      {p.links}
      {/* A srcdoc is transparent and mockups are authored on white (base 5.6.7): the frame's holder draws in the light
          palette (`data-theme`, from the file's own tokens stylesheet), so its ground is the light white surface token
          whatever the exporter's theme, as the viewer's canvas is (docs.css). */}
      <div data-theme="light" style={{ background: 'var(--bg-surface)' }}>
        <iframe
          sandbox="" srcDoc={p.html} title={fillSentence(EXPORT_TEXT.mockupFrame, { name: p.title })}
          style={{ display: 'block', width: '100%', height: '75vh', border: 0, colorScheme: 'light' }}
        />
      </div>
    </article>
  );
}

/** The links list (spec 5.6.9 step 5: "Links in this page", through spec 4.17's link table, as permalinks at C): each
 *  target as text, linked where the table gives a permalink or an external page, an inert span otherwise. */
function MockupLinks(p: { readonly links: readonly string[]; readonly input: ExportInput<MockupArm> }): ReactNode {
  if (p.links.length === 0) return null;
  const { input } = p;
  return (
    <MockupList heading={EXPORT_TEXT.mockupLinks}>
      {p.links.map((raw, i) => {
        const t = exportLinkTarget(input.body.link, input.commit, raw);
        switch (t.kind) {
          case 'permalink':
            return <li key={i}><a href={t.href} rel="noopener noreferrer">{raw}</a></li>;
          case 'external':
            return <li key={i}><a href={t.href} target="_blank" rel="noopener noreferrer">{raw}</a></li>;
          case 'fragment':
            return <li key={i}>{raw}</li>;
          case 'inert':
            return <li key={i}><span className="ccrc-export-inert" title={t.title}>{raw}</span></li>;
        }
      })}
    </MockupList>
  );
}

/** The notes a mockup export carries: the provenance's, how many diagrams appear as source (none: no note), and what rests
 *  on the file's own policy. */
const mockupNotes = (input: ExportInput<MockupArm>, diagrams: number): readonly string[] => [
  ...input.provenance.notes,
  ...(diagrams === 0 ? [] : [fillSentence(EXPORT_TEXT.mockupDiagrams, { m: diagrams, s: pluralS(diagrams), es: diagrams === 1 ? 's' : '' })]),
  EXPORT_TEXT.mockupCss,
];

async function buildMockupExport(input: ExportInput<MockupArm>, limits: ExportLimits): Promise<ExportResult> {
  const arm = input.body;
  const end = await settledWithin(arm.assets.settled, limits.imageWaitMs);
  const result = end === 'timed-out' ? unheld(arm.assets.plan, TIMED_OUT) : end.s === 'loaded' ? end.result : unheld(arm.assets.plan, 'ended');
  const diagrams = mockupDiagramCount(arm.doc);
  const held = heldFiles(result);
  const attempt = (k: number): MockupTry => {
    const files = held.slice(0, k);
    const assets = new Map(files.flatMap((f) => {
      const a = result.assets.get(f.key);
      return a === undefined ? [] : [[f.key, a] as const];
    }));
    const snap = buildMockupSnapshot(arm.doc, { ...result, assets });
    const left = new Set(snap.omitted);
    const facts: ExportMockupFacts = {
      inlined: files.filter((f) => !left.has(f.path)).map((f) => ({ path: f.path, size: f.size, draft: f.draft })),
      omitted: snap.omitted,
    };
    const notes = mockupNotes(input, diagrams);
    const parts: ShellParts = { metas: input.provenance.metas, notes, banner: input.provenance.banner };
    const content = (
      <MockupContent title={input.title} html={snap.html} facts={facts} links={<MockupLinks links={snap.links} input={input} />} />
    );
    return { bytes: fileOfElement(shellOf(input, parts, content)), facts, notes };
  };
  // The one measure: the FINAL file's bytes, the inner document escaped into the frame's attribute plus the wrapper.
  const fits = (t: MockupTry): boolean => t.bytes.length <= limits.maxBytes;
  const done = (t: MockupTry): ExportResult =>
    ({ ok: true, name: input.name, bytes: t.bytes, size: t.bytes.length, notes: t.notes, deferred: 0, mockup: t.facts });

  const whole = attempt(held.length);
  if (fits(whole)) return done(whole);
  let best = attempt(0);
  if (held.length === 0 || !fits(best)) return { ok: false, why: 'too-large' };
  // The files back in DOM order while the file fits: the estimate (each `data:` URL, per use) gives the first try, and the
  // measured file decides, so the answer is always a measured fit: `lo` fits, `hi` does not.
  let lo = 0;
  let hi = held.length;
  let room = limits.maxBytes - best.bytes.length;
  let guess = 0;
  for (const f of held) {
    if (f.estimate > room) break;
    room -= f.estimate;
    guess += 1;
  }
  while (hi - lo > 1) {
    const k = Math.min(hi - 1, Math.max(lo + 1, guess));
    const t = attempt(k);
    if (fits(t)) {
      lo = k;
      best = t;
    } else {
      hi = k;
    }
    guess = Math.floor((lo + hi) / 2);
  }
  return done(best);
}

export async function buildExport(input: ExportInput, limits: ExportLimits = LIMITS): Promise<ExportResult> {
  const arm = input.body;
  if (arm.kind === 'mockup') return buildMockupExport({ ...input, body: arm }, limits);
  return buildShellExport({ ...input, body: arm }, limits);
}

async function buildShellExport(input: ShellInput, limits: ExportLimits): Promise<ExportResult> {
  const body = input.body;
  const decided = body.kind === 'tree'
    ? await decideImages(body.tree, { ...body.link, urls: body.urls }, input.assets, limits.imageWaitMs)
    : NO_IMAGES;
  const done = (bytes: Uint8Array<ArrayBuffer>, images: ReadonlyMap<HastElement, ExportImageDecision>, coloured: boolean): ExportResult => {
    const parts = partsOf(input, images, coloured);
    return { ok: true, name: input.name, bytes, size: bytes.length, notes: parts.notes, deferred: parts.deferred, mockup: null };
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
