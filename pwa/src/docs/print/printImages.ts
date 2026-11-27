// L4: delivery wiring. The page's already-loaded images, for Print (X2 P6.1 Step 1; spec 4.6 "src only for an image the page has already
// loaded"). It reaches the registry of loaded images (`ExportAssets`, the map Export inlines from) through the one pin rule the plain
// view and the reader use (`planImageRef`, `DocImage.tsx`, a component module, which is why this file is not L1) and answers, for a
// ref a document wrote, the `data:` URL of the image the page holds under that pin, or `null`:
//   - a ref the pin rule refuses (a foreign URL, a `data:` URL, a path outside the docs): `null`, it is never loaded;
//   - a ref pinned but not loaded (still loading, failed, or not in the registry): `null`;
//   - a loaded raster: the `data:` URL of its verified bytes and table MIME;
//   - a loaded SVG: the `data:image/svg+xml;base64,` URL the page built, and only that (any other source of an SVG is refused).
// `printPlan.ts#imagesFor` composes it with the frame's own images; nothing here ever answers a ref as a URL.
import { docsApi } from '../../../../shared/docs';
import type { DocLinkContextValue } from '../DocLink';
import { planImageRef, rasterDataUrl, SVG_DATA_PREFIX } from '../DocImage';
import type { ExportAssets } from '../export/exportAssets';

/** The loaded-image lookup over `assets` for the page `link` names; `null` for either answers `null` for every ref. */
export function loadedImageOf(link: DocLinkContextValue | null, assets: ExportAssets | null): (ref: string) => string | null {
  return (ref) => {
    if (link === null || assets === null) return null;
    const plan = planImageRef(link, ref, null);
    if (plan.kind !== 'pinned') return null;
    const held = assets.get(docsApi.file(link.project, plan.pin));
    if (held === undefined || held.s !== 'loaded') return null;
    const a = held.asset;
    if (a.kind === 'raster') return rasterDataUrl(a.bytes, a.mime);
    return a.src.startsWith(SVG_DATA_PREFIX) ? a.src : null;
  };
}
