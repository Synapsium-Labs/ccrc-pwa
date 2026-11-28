// The link context of a leaf page, built in one place (spec 2026-10-01 4.11; X2 P6.1 Step 1). Every link and image a Docs page decides
// is decided against "the page it stands on": its project, ref, version, view, section and path, the tree it was listed in, and whether
// the bytes it shows are a draft's (`DocLinkContextValue`, `DocLink.tsx`). The leaf (`DocsLeaf.tsx`) builds it for its body, and Print
// (`print/usePrint.ts`) builds it to decide a printed link's target and an image's pin, so the formula lives here once and both call it.
// The detached tree's URL map (`urls`) is the body's own and is not part of it.
//
// Ring L1: pure (types of the link module only).
import type { DocListPin, DocsPageLocation, DocsTreeOk } from '../../../shared/docs';
import type { DocLinkContextValue } from './DocLink';

type Leaf = DocsPageLocation & { kind: 'path' };

/** A link context without its URL map. */
export type LinkBase = Omit<DocLinkContextValue, 'urls'>;

/** The context a leaf's links and images are decided in. `pin`: the pin the leaf opens (`pinFor`'s), whose kind says whether the
 *  source is a draft's; `null` (nothing opens) reads as committed. `onFragment` receives a cross-doc link's fragment. */
export function linkBaseFor(page: Leaf, tree: DocsTreeOk, pin: DocListPin | null, onFragment: LinkBase['onFragment']): LinkBase {
  return {
    project: page.project, pageRef: page.ref, pageAt: page.at, view: page.view, section: page.section, path: page.path, tree,
    pageSource: pin?.kind === 'draft' ? 'draft' : 'committed', onFragment,
  };
}
