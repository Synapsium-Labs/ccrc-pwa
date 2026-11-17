// The reader frame's images (native Docs reader, W8a Task 6; the rich-docs spec's (amended 2026-10-31) A7 as refined by the W8a plan's (d),
// section 4.3's Images row, base 4.11). Ring L3: it loads bytes through the page's queue and loaders and decides
// nothing of its own: which images the page may show is `planImageRef`, the plain view's one pin rule, and how one is
// loaded is `fetchImage`, the plain view's own loader path with its raster checks. The reader's frame cannot hold a
// `blob:` URL, so every image here is a `data:` URL in the shared Markdown library's image grammar. The reader, the plain
// view and the mockup planner share one pin rule (`imagePinFor`, through `planImageRef`) and one size basis
// (`mockupSizeBasis`, on every page but a version page, where the plain view keeps its rule of no listed-size check),
// while each keeps its own seed limits. A failed load is left out of the reader, so the frame shows its own "not loaded"
// chip for that image; a 401 is also COUNTED (`ReaderImages.auth`), because signing in cures it, and the caller asks the
// page's images once more when sign-in returns (completion plan Task 8, the plain view's own `useImageSrc` precedent).
import { docsApi } from '../../../../shared/docs';
import { READER_IMAGE_BUDGET_BYTES } from '../../lib/readerLimits';
import {
  fetchImage, planImageRef, rasterDataUrl, type DocsAssetContextValue, type Fetched, type LoadJob,
} from '../DocImage';
import type { DocLinkContextValue } from '../DocLink';

/** The longest image ref the reader hands the frame, in UTF-16 code units: the library's `SEED_LIMITS.imageRefMaxCodeUnits`
 *  (`pwa/test/reader-images.test.ts` holds the two equal). The seed check refuses a whole seed that carries one ref over it,
 *  and a refused seed rejects the mount, which sends the page to the plain view. A ref over it is left out here instead,
 *  before any plan or load, so the seed stays valid, the page stays in the reader, and only that image shows the frame's
 *  "not loaded" chip. */
export const READER_IMAGE_REF_MAX_UNITS = 2048;

/** What the images of one page came to: the `data:` URL of each loaded image under the exact ref string `scanRefs`
 *  gave, `drafts`, the number of those images whose pin is a draft, and `auth`, the number of loads that answered 401
 *  (`0` when none did): the failure sign-in cures, so the caller asks again once it returns. A 401's image is not in
 *  `urls`. The caller adds `onDraftAsset(drafts)` once the images resolve and takes back `onDraftAsset(-drafts)` on
 *  unmount; this function calls no `onDraftAsset`. */
export interface ReaderImages {
  readonly urls: Readonly<Record<string, string>>;
  readonly drafts: number;
  readonly auth: number;
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
 *  (the W8a plan's refinement (d)). Only a pinned plan before that index loads; the page's byte budget stops further adds; a failed load is
 *  left out (a 401 is counted too); an aborted `signal` ends the walk with what had loaded. The loads are launched together and run through
 *  the screen's queue (its concurrency bounds them), and are read back in ref order, so the budget is order-stable. */
export async function loadReaderImages(
  refs: readonly string[], ctx: DocLinkContextValue, assets: DocsAssetContextValue, signal: AbortSignal,
): Promise<ReaderImages> {
  let full = false;
  const launched: { readonly ref: string; readonly draft: boolean; readonly result: Promise<Fetched | null> }[] = [];
  refs.forEach((ref, i) => {
    // An over-long ref is left out before it is planned or loaded (its image shows the frame's "not loaded" chip), so the
    // seed stays valid; `i` still counts it, as it counts any ref that is not pinned.
    if (ref.length > READER_IMAGE_REF_MAX_UNITS) return;
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
  let auth = 0;
  let total = 0;
  for (const { ref, draft, result } of launched) {
    const f = await result;
    if (f === null) continue;
    if (f.s === 'failed') {
      if (f.auth) auth += 1;
      continue;
    }
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
  return { urls, drafts, auth };
}
