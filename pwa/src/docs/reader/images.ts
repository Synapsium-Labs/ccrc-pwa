// The reader frame's images (native Docs reader, W8a Task 6; the 2026-10-31 reader-frame spec's A7 as refined by (d),
// section 4.3's Images row, base 4.11). Ring L3: it loads bytes through the page's queue and loaders and decides
// nothing of its own: which images the page may show is `planImageRef`, the plain view's one pin rule, and how one is
// loaded is `fetchImage`, the plain view's own loader path with its raster checks. The reader's frame cannot hold a
// `blob:` URL, so every image here is a `data:` URL in the shared Markdown library's image grammar. W6's asset planner
// replaces this file.
import { docsApi } from '../../../../shared/docs';
import { READER_IMAGE_BUDGET_BYTES } from '../../lib/readerLimits';
import {
  fetchImage, planImageRef, rasterDataUrl, type DocsAssetContextValue, type Fetched, type LoadJob,
} from '../DocImage';
import type { DocLinkContextValue } from '../DocLink';

/** What the images of one page came to: the `data:` URL of each loaded image under the exact ref string `scanRefs`
 *  gave, and `drafts`, the number of those images whose pin is a draft. The caller adds `onDraftAsset(drafts)` once
 *  the images resolve and takes back `onDraftAsset(-drafts)` on unmount; this function calls no `onDraftAsset`. */
export interface ReaderImages {
  readonly urls: Readonly<Record<string, string>>;
  readonly drafts: number;
}

/** The decoded size of a `data:...;base64,` URL's payload (`fetchImage` returns an SVG as one and no bytes). */
function decodedSize(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  let pad = 0;
  while (pad < b64.length && b64[b64.length - 1 - pad] === '=') pad += 1;
  return Math.floor(b64.length * 3 / 4) - pad;
}

/** Loads the images of `refs`, which are the DISTINCT srcs `scanRefs` returns, in first-seen order (the library dedupes
 *  them, so no ref repeats and nothing here dedupes again). Index `i` is a ref's place in that list, NOT the plain view's
 *  count, which numbers every `img` element: on a page whose repeats push a new src past the plain view's 30th element,
 *  the reader may load an image the plain view defers. The bound of `DOCS_MAX_IMAGES_PER_PAGE` loads holds either way
 *  (refinement (d)). Only a pinned plan before that index loads; the page's byte budget stops further adds; a failed load is
 *  left out; an aborted `signal` ends the walk with what had loaded. The loads are launched together and run through
 *  the screen's queue (its concurrency bounds them), and are read back in ref order, so the budget is order-stable. */
export async function loadReaderImages(
  refs: readonly string[], ctx: DocLinkContextValue, assets: DocsAssetContextValue, signal: AbortSignal,
): Promise<ReaderImages> {
  let full = false;
  const launched: { readonly ref: string; readonly draft: boolean; readonly result: Promise<Fetched | null> }[] = [];
  refs.forEach((ref, i) => {
    const plan = planImageRef(ctx, ref, i);
    if (plan.kind !== 'pinned' || plan.deferred) return;
    const job: LoadJob = {
      key: docsApi.file(ctx.project, plan.pin), project: ctx.project, pin: plan.pin, cls: plan.cls,
      loaders: assets.loaders, queue: assets.queue,
    };
    // Every rejection (a loader that throws, a queue that drops an aborted job) is the same answer: left out.
    const result = assets.queue.run((s) => (full || s.aborted ? Promise.resolve(null) : fetchImage(job, s)), signal)
      .catch((): null => null);
    launched.push({ ref, draft: plan.draft, result });
  });

  const urls: Record<string, string> = {};
  let drafts = 0;
  let total = 0;
  for (const { ref, draft, result } of launched) {
    const f = await result;
    if (f === null || f.s === 'failed') continue;
    const size = f.s === 'raster' ? f.bytes.length : decodedSize(f.src);
    if (total + size > READER_IMAGE_BUDGET_BYTES) {
      full = true;
      break;
    }
    total += size;
    urls[ref] = f.s === 'raster' ? rasterDataUrl(f.bytes, f.mime) : f.src;
    if (draft) drafts += 1;
    if (signal.aborted) break;
  }
  return { urls, drafts };
}
