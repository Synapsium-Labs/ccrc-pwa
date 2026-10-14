// The Markdown `img` of a Docs page (spec 2026-10-01 4.11, 5.4, 5.5; W5 part 1 Task 7) and the context it loads
// through. `DocImage` is, with `DocLink`, the only way a URL reaches the DOM from a document: `detachUrls` took the
// image's `src` into the map, and `DocImage` reads it back through its `node`, resolves it with L0 `resolveDocRef`,
// asks `imagePinFor` which bytes the page may show, and loads them through the screen's queue. The only `src` it ever
// writes is an object URL of verified raster bytes (`rasterObjectUrl`, revoked on unmount and on replacement) or an
// SVG's `data:image/svg+xml;base64,` URL (never a `blob:`); everything else is a refused span with its reason.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { Element as HastElement } from 'hast';
import {
  DOCS_CLASS_CAP, DOCS_MAX_IMAGES_PER_PAGE, contentClass, docsApi, docsPageUrl, resolveDocRef,
  type DocPin, type DocsPageLocation, type RasterMime,
} from '../../../shared/docs';
import { onAuthRegained } from '../lib/auth';
import { openExternal } from '../lib/markdown';
import { navigate } from '../lib/router';
import { DocInLinkContext, DocLinkContext, type DocLinkContextValue } from './DocLink';
import { docsLocation, imagePinFor } from './docsLinks';
import {
  DOC_IMAGE_REFUSED_SENTENCE, DOC_IMAGE_TEXT, DOCS_SHOW_NO_BYTES, DOCS_SHOW_NOT_SVG, failureSentence, fillSentence,
  kib, slotSentence, type DocImageRefusal,
} from './docsText';
import type { FetchQueue } from './fetchQueue';
import type { DocsLoaders, DocsNotOk } from './failures';
import { rasterObjectUrl, showBytes } from './objectUrls';

/** What a Docs page gives its images (refinement (p)): the loaders, the screen's one queue, and the banner's counter.
 *  `onDraftAsset(delta)` is called with `+1` when an image starts resolving to a `DraftPin` and `-1` when it stops
 *  (unmount, or a new pin), so the sum is the number of drafted embeds on screen ("This draft page embeds {k}
 *  uncommitted asset{s}"). The provider keeps `loaders`, `queue` and `onDraftAsset` stable across renders: a new
 *  `loaders` or `queue` loads every image again. */
export interface DocsAssetContextValue {
  readonly loaders: Pick<DocsLoaders, 'file' | 'raster'>;
  readonly queue: FetchQueue;
  readonly onDraftAsset: (count: number) => void;
}

/** `null`, the default, has ONE meaning: `DocImage` is rendered outside a Docs page, and refuses every image. */
export const DocsAssetContext = createContext<DocsAssetContextValue | null>(null);

type Leaf = Extract<DocsPageLocation, { kind: 'path' }>;

/** What one image is. `refused`: its reason, the fields its sentence takes, and the one action it offers (`external`
 *  opens the URL on tap; `viewer` opens the document's own leaf in-app; `null`, none). `pinned`: the bytes the pin rule
 *  gives, the class that says how to load them, the chips, the image's own leaf, and whether it waits for Load image
 *  (its index at or past `DOCS_MAX_IMAGES_PER_PAGE`, or no index recorded). */
type ImagePlan =
  | { kind: 'refused'; why: DocImageRefusal; fields: Readonly<Record<string, string>>;
      action: { kind: 'external' | 'viewer'; href: string } | null }
  | { kind: 'pinned'; pin: DocPin; cls: 'raster' | 'svg'; draft: boolean; uncommittedNotShown: boolean;
      leafHref: string; deferred: boolean };

const refused = (why: DocImageRefusal, action: Extract<ImagePlan, { kind: 'refused' }>['action'] = null,
  fields: Readonly<Record<string, string>> = {}): ImagePlan => ({ kind: 'refused', why, fields, action });

/** The page the image sits on, as the leaf location `imagePinFor` reads (its project, ref and view). */
function leafOf(ctx: DocLinkContextValue): Leaf {
  const loc = docsLocation({ kind: 'project', project: ctx.project, ref: ctx.pageRef },
    { kind: 'path', section: ctx.section, path: ctx.path, dirSlash: false, view: ctx.view });
  if (loc.kind !== 'path') throw new Error('DocImage: a path target built a page that is not a leaf');
  return loc;
}

/** The one decision for an image (spec 4.11, "Markdown `img`"), from the `src` `detachUrls` moved off it. */
function planImage(ctx: DocLinkContextValue, node: HastElement | undefined): ImagePlan {
  const recorded = node === undefined ? undefined : ctx.urls.get(node);
  const r = resolveDocRef({ section: ctx.section, path: ctx.path }, recorded?.attrs['src'] ?? '');
  switch (r.kind) {
    case 'doc':
      break;
    case 'external':
      return r.scheme === 'mailto' ? refused('scheme') : refused('external', { kind: 'external', href: r.url });
    case 'fragment':
      return refused('fragment');
    case 'repo':
      return refused('repo');
    case 'self-contained':
      return refused(r.scheme);
    case 'refused':
      return refused(r.why);
  }
  const page = leafOf(ctx);
  // The image's own leaf at the page's ref, `view` dropped, exactly as `DocLink` links a document.
  const leafHref = docsPageUrl(docsLocation(page, { kind: 'path', section: r.section, path: r.path, dirSlash: false }));
  const cls = contentClass(r.path);
  if (cls !== 'raster' && cls !== 'svg') {
    return refused('not-image', cls === 'html' ? { kind: 'viewer', href: leafHref } : null);
  }
  const e = ctx.tree.entries.find((x) => x.section === r.section && x.path === r.path);
  const ip = imagePinFor(e, ctx.tree, page);
  if (!ip.ok) return refused(ip.why);
  const size = ip.pin.kind === 'draft' ? e?.draft?.size : e?.committed?.size;
  const cap = DOCS_CLASS_CAP[cls];
  if (typeof size === 'number' && size > cap) return refused('too-large', null, { size: kib(size), cap: kib(cap) });
  const index = recorded?.imageIndex ?? null;
  return {
    kind: 'pinned', pin: ip.pin, cls, draft: ip.draft, uncommittedNotShown: ip.uncommittedNotShown, leafHref,
    deferred: index === null || index >= DOCS_MAX_IMAGES_PER_PAGE,
  };
}

/** One load: `key` is the bytes' own API URL (`docsApi.file`), unique per project and pin. */
interface LoadJob {
  readonly key: string;
  readonly project: string;
  readonly pin: DocPin;
  readonly cls: 'raster' | 'svg';
  readonly loaders: Pick<DocsLoaders, 'file' | 'raster'>;
  readonly queue: FetchQueue;
}

type Fetched =
  | { s: 'raster'; bytes: Uint8Array<ArrayBuffer>; mime: RasterMime }
  | { s: 'svg'; src: string }
  | { s: 'failed'; sentence: string; auth: boolean };

/** `auth` is true for a 401 only: the one failure that signing in cures, so the one the image asks again after. */
type Shown = { s: 'loading' } | { s: 'loaded'; src: string } | { s: 'failed'; sentence: string; auth: boolean };

const SVG_DATA_PREFIX = 'data:image/svg+xml;base64,';

function notOkFailure(a: DocsNotOk): Extract<Fetched, { s: 'failed' }> {
  return { s: 'failed', sentence: a.s === 'failed' ? failureSentence(a.body) : slotSentence(a), auth: a.s === 'auth' };
}

/** Bytes as base64, in chunks small enough to spread into `String.fromCharCode`. */
function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** An SVG's bytes as the only `src` Docs ever gives an SVG (spec 5.5): `data:image/svg+xml;base64,...`, never a
 *  `blob:` and never an `/api/` URL. The SVG leaf (`DocsLeaf`) draws the bytes it already holds through this. */
export function svgDataUrl(bytes: Uint8Array): string {
  return SVG_DATA_PREFIX + base64Of(bytes);
}

/** The bytes for one job, read through its loader with the queue's signal: a raster's verified bytes and table MIME,
 *  an SVG as its `data:` URL, or the sentence of why not. */
async function fetchImage(job: LoadJob, signal: AbortSignal): Promise<Fetched> {
  if (job.cls === 'raster') {
    const a = await job.loaders.raster(job.project, job.pin, signal);
    return a.s === 'ok'
      ? { s: 'raster', bytes: a.value.bytes, mime: a.value.mime }
      : notOkFailure(a);
  }
  const a = await job.loaders.file(job.project, job.pin, signal);
  if (a.s !== 'ok') return notOkFailure(a);
  const bytes = a.value.contentClass === 'svg' ? showBytes(a.value.show) : null;
  if (bytes === null) {
    const why = a.value.contentClass === 'svg' ? DOCS_SHOW_NO_BYTES : DOCS_SHOW_NOT_SVG;
    return { s: 'failed', sentence: failureSentence({ ok: false, failure: 'malformed-answer', why }), auth: false };
  }
  return { s: 'svg', src: SVG_DATA_PREFIX + base64Of(bytes) };
}

/** Runs `job` through its queue while its key stands. A new key (a replaced image) or an unmount aborts the load and
 *  revokes the object URL this run created; a result for an older key is never shown. `job: null` loads nothing. */
function useImageSrc(job: LoadJob | null): Shown {
  const [done, setDone] = useState<{ key: string; shown: Shown } | null>(null);
  const key = job === null ? null : job.key;
  const [attempt, setAttempt] = useState(0);
  // What is on screen now, for the sign-in callback below (a ref, so the subscription is not remade on every answer).
  const current = useRef<{ key: string | null; shown: Shown | null }>({ key: null, shown: null });
  current.current = { key, shown: done !== null && done.key === key ? done.shown : null };
  // Sign-in returned: an image whose load answered 401 asks once more. Any other state is left as it is.
  useEffect(() => onAuthRegained(() => {
    const c = current.current;
    if (c.key !== null && c.shown !== null && c.shown.s === 'failed' && c.shown.auth) {
      setDone(null); // Loading again, not the old sentence
      setAttempt((n) => n + 1);
    }
  }), []);
  useEffect(() => {
    if (job === null || key === null) return undefined;
    const ctl = new AbortController();
    let live = true;
    let created: string | null = null;
    // `.then(ok).catch(err)`, not `.then(ok, err)`: a throw inside `ok` (`rasterObjectUrl` on a MIME outside the table)
    // is the same chip as a loader that rejects, never an unhandled rejection over an image stuck on Loading.
    job.queue.run((signal) => fetchImage(job, signal), ctl.signal).then((f) => {
      if (!live) return;
      if (f.s === 'raster') {
        created = rasterObjectUrl(f.bytes, f.mime);
        setDone({ key, shown: { s: 'loaded', src: created } });
      } else if (f.s === 'svg') {
        setDone({ key, shown: { s: 'loaded', src: f.src } });
      } else {
        setDone({ key, shown: f });
      }
    }).catch((err: unknown) => {
      if (!live) return;
      const error = err instanceof Error ? err.message : String(err);
      setDone({ key, shown: { s: 'failed', sentence: fillSentence(DOC_IMAGE_TEXT.loaderFailed, { error }), auth: false } });
    });
    return () => {
      live = false;
      ctl.abort();
      if (created !== null) {
        URL.revokeObjectURL(created);
        // `done` still holds the URL just revoked under this key; a render that comes back to the key (A, B, A, or the
        // same image under new loaders) would show it. Drop it, so the image reads Loading until its new bytes arrive.
        setDone((d) => (d !== null && d.key === key ? null : d));
      }
    };
    // The job's other fields are fixed by its key (`docsApi.file(project, pin)` and the class its path gives).
  }, [key, job?.loaders, job?.queue, attempt]);
  return done !== null && done.key === key ? done.shown : { s: 'loading' };
}

/** The Markdown `img` of a Docs page (spec 4.11). Its source comes only from the detached map, through `node`; of the
 *  tree's own props only `alt` and `title` are passed on.
 *  - refused: `<span className="doc-img-refused" role="img" aria-label={alt}>` "Image not loaded: {reason}", plus
 *    **Open image externally** (an http or https image, opened on tap only) or **Open in viewer** (an html document's
 *    own leaf, in-app).
 *  - pinned, at or past image `DOCS_MAX_IMAGES_PER_PAGE` (index 30 and on): **Load image** until tapped.
 *  - inside a link (`DocInLinkContext`): the link wins. A loaded image is a bare `<img>` and a refused one offers no
 *    action, so one tap is the link's alone; **Load image** still loads (it stops the tap).
 *  - loading, then `<button className="doc-img-link"><img src alt className="msg-img" /></button>`, whose tap opens
 *    the image's own leaf in-app, or a failure chip with its sentence; with the `draft` and "uncommitted change not
 *    shown" chips the pin rule gives. */
export function DocImage(p: ComponentProps<'img'> & { node?: HastElement }): ReactNode {
  const { node, alt, title } = p;
  const ctx = useContext(DocLinkContext);
  const assets = useContext(DocsAssetContext);
  const inLink = useContext(DocInLinkContext);
  const [asked, setAsked] = useState(false);
  const outside = ctx === null || assets === null;
  const plan = useMemo(
    () => (ctx === null || outside ? refused('outside-page') : planImage(ctx, node)), [ctx, outside, node]);
  const pinned = plan.kind === 'pinned' ? plan : null;
  const job: LoadJob | null = pinned !== null && ctx !== null && assets !== null && (!pinned.deferred || asked)
    ? {
      key: docsApi.file(ctx.project, pinned.pin), project: ctx.project, pin: pinned.pin, cls: pinned.cls,
      loaders: assets.loaders, queue: assets.queue,
    }
    : null;
  const shown = useImageSrc(job);
  const draftKey = pinned !== null && pinned.draft && ctx !== null ? docsApi.file(ctx.project, pinned.pin) : null;
  const onDraftAsset = assets?.onDraftAsset;
  useEffect(() => {
    if (draftKey === null || onDraftAsset === undefined) return undefined;
    onDraftAsset(1);
    return () => onDraftAsset(-1);
  }, [draftKey, onDraftAsset]);

  const label = alt ?? '';
  if (plan.kind === 'refused') {
    const reason = fillSentence(DOC_IMAGE_REFUSED_SENTENCE[plan.why], plan.fields);
    // Inside a link the link's action is the tap's alone: no second action, and no button inside the anchor.
    const action = inLink ? null : plan.action;
    return (
      <>
        <span className="doc-img-refused" role="img" aria-label={label}>
          {fillSentence(DOC_IMAGE_TEXT.refused, { reason })}
        </span>
        {action?.kind === 'external' && (
          <>{' '}<button type="button" className="doc-img-action" onClick={(e) => openExternal(e, action.href)}>
            {DOC_IMAGE_TEXT.openExternal}
          </button></>
        )}
        {action?.kind === 'viewer' && (
          <>{' '}<button type="button" className="doc-img-action" onClick={() => navigate(action.href)}>
            {DOC_IMAGE_TEXT.openViewer}
          </button></>
        )}
      </>
    );
  }
  const chips = (
    <>
      {plan.draft && <>{' '}<span className="doc-img-chip">{DOC_IMAGE_TEXT.draft}</span></>}
      {plan.uncommittedNotShown && <>{' '}<span className="doc-img-chip">{DOC_IMAGE_TEXT.uncommittedNotShown}</span></>}
    </>
  );
  if (job === null) {
    return (
      <>
        <button type="button" className="doc-img-load" onClick={(e) => {
          // Inside a link this tap loads the image and is not the link's.
          e.preventDefault();
          e.stopPropagation();
          setAsked(true);
        }}>{DOC_IMAGE_TEXT.load}</button>
        {chips}
      </>
    );
  }
  if (shown.s === 'loading') {
    return <><span className="doc-img-loading" role="img" aria-label={label}>{DOC_IMAGE_TEXT.loading}</span>{chips}</>;
  }
  if (shown.s === 'failed') {
    return <><span className="doc-img-failed" role="img" aria-label={label}>{shown.sentence}</span>{chips}</>;
  }
  if (inLink) {
    // The link is the control: a bare image, so one tap is the link's and no button sits inside the anchor.
    return <><img src={shown.src} alt={label} title={title} className="msg-img" />{chips}</>;
  }
  const leafHref = plan.leafHref;
  return (
    <>
      <button type="button" className="doc-img-link" onClick={() => navigate(leafHref)}>
        <img src={shown.src} alt={label} title={title} className="msg-img" />
      </button>
      {chips}
    </>
  );
}
