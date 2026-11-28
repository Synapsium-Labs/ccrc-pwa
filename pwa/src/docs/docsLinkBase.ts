// The link context of a leaf page, built in one place (spec 2026-10-01 4.11; X2 P6.1 Step 1). Every link and image a Docs page decides
// is decided against "the page it stands on": its project, ref, version, view, section and path, the tree it was listed in, and whether
// the bytes it shows are a draft's (`DocLinkContextValue`, `DocLink.tsx`). The leaf (`DocsLeaf.tsx`) builds it for its body, and Print
// (`print/usePrint.ts`) builds it to decide a printed link's target and an image's pin, so the formula lives here once and both call it.
// The detached tree's URL map (`urls`) is the body's own and is not part of it.
//
// The page those two are given is the Docs screen's (X2 P5.1, I-2): where a Layout choice has ended the visit's `?variant=`, the screen
// hands every view the page with its variant dropped (`pageAfterVariantEnded`), so the head's links, the banners', the doc links and
// Print's all follow from the one page, and none of them reads the raw address.
//
// Ring L1: pure (types of the link module only).
import type { DocListPin, DocsPageLocation, DocsTreeOk, ReaderLayout } from '../../../shared/docs';
import type { DocLinkContextValue } from './DocLink';

type Leaf = DocsPageLocation & { kind: 'path' };

/** A link context without its URL map. */
export type LinkBase = Omit<DocLinkContextValue, 'urls'>;

/** The context a leaf's links and images are decided in. `pin`: the pin the leaf opens (`pinFor`'s), whose kind says whether the
 *  source is a draft's; `null` (nothing opens) reads as committed. `onFragment` receives a cross-doc link's fragment. `variant`: the
 *  layout the page's visit names for its links, required of every caller: the page's own `?variant=` (`page.variant ?? null`), since
 *  the page the Docs screen hands down already has it dropped once a Layout choice ended it. */
export function linkBaseFor(
  page: Leaf, tree: DocsTreeOk, pin: DocListPin | null, onFragment: LinkBase['onFragment'], variant: ReaderLayout | null,
): LinkBase {
  return {
    project: page.project, pageRef: page.ref, pageAt: page.at, pageVariant: variant, view: page.view, section: page.section,
    path: page.path, tree,
    pageSource: pin?.kind === 'draft' ? 'draft' : 'committed', onFragment,
  };
}

/** The page the Docs screen hands its views: `page` itself, or, when a Layout choice ended the visit's `?variant=` at this very
 *  address, the same page with its variant dropped (X2 P5.1, I-2: the choice ends the variant for the rest of that page, and the
 *  address is left as it is). `here` is the address the screen is at (`path` and `search`) and `endedAt` the address the latest choice
 *  was made at (`layoutPref.ts#readerLayoutChosenAt`, `null` for none). A page that names no variant, or is no leaf, is returned as it
 *  is, so its identity (and everything memoised on it) holds. */
export function pageAfterVariantEnded(page: DocsPageLocation, here: string, endedAt: string | null): DocsPageLocation {
  if (endedAt !== here || page.kind !== 'path' || page.variant === undefined) return page;
  const { variant: _ended, ...rest } = page;
  return rest;
}
