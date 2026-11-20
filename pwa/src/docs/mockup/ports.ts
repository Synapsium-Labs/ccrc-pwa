// The mockup asset pipeline's shapes and its one port (native Docs reader, completion plan Tasks 6-7; base spec 2026-10-01
// section 5.6.3, as amended for D-8659). Ring L2: types only. The planner (`plan.ts`, L1) decides admission from a
// captured context; the loader (`load.ts`) reads admitted pins through `MockupAssetReader`, which the consumer declares
// here and the screen's adapter implements over the existing Docs loaders and per-screen queue. No transport adapter
// receives admission authority: it reads the pins it is given and nothing else.
import type { DocPin, DocRefResolution, DocSectionSlug, DocsEntry, DocsPageLocation, DocsTreeOk } from '../../../../shared/docs';
import type { MockupAssetKind } from './policy';

/** Where a reference was written: the section and path of the page (depth 0) or of the stylesheet that holds it, as
 *  `<section>/<path>` (a section slug holds no `/`, so the first `/` splits them). `resolveDocRef` resolves the
 *  reference from there. */
export type MockupBase = `${DocSectionSlug}/${string}`;

/** One attempt's captured inputs: the project, the page's own pin (the commit C, or a draft), and the tree answer the
 *  attempt listed. Every decision of the attempt reads this object and no other listing; a whole-view retry is a new
 *  attempt with a new context. */
export interface MockupContext {
  readonly project: string;
  readonly pin: DocPin;
  readonly tree: DocsTreeOk;
}

/** One reference as discovered. `key` is its identity in DOM order, then CSS discovery order (unique within an
 *  attempt); it is never a URL to fetch. `raw` is the reference as written; `depth` is 0 on the page and d + 1 in a
 *  stylesheet at depth d. */
export interface MockupRef {
  readonly key: string;
  readonly raw: string;
  readonly basePath: MockupBase;
  readonly kind: MockupAssetKind;
  readonly depth: number;
}

/** Why the planner refuses a reference: `resolveDocRef`'s refused reasons, `repo` for a file outside the Docs sections, and
 *  `scheme` for a non-web scheme (`scheme` is also one of `resolveDocRef`'s own). Derived from `resolveDocRef`'s answer, so the
 *  viewer's sentences (`docsText.ts`) are keyed over exactly the reasons the planner can give. */
export type MockupRefusedWhy = 'repo' | Extract<DocRefResolution, { kind: 'refused' }>['why'];

/** Base spec 5.6.3's verdict union, every reason kept distinct. `inline.size` is the admission reservation (the row's
 *  `MockupSize.bytes`), not a measurement of the bytes. */
export type MockupRefVerdict =
  | { readonly v: 'inline'; readonly pin: DocPin; readonly kind: MockupAssetKind; readonly mime: string; readonly size: number; readonly draft: boolean }
  | { readonly v: 'kept'; readonly why: 'fragment' | 'self-contained' }
  | { readonly v: 'external'; readonly origin: string; readonly via: 'src' | 'script-text' }
  | { readonly v: 'refused'; readonly why: MockupRefusedWhy }
  | { readonly v: 'missing'; readonly why: 'absent-at-commit' | 'deleted-in-worktree' | 'draft-withheld' | 'draft-unhashed' }
  | { readonly v: 'unsupported'; readonly why: 'kind' | 'element' | 'css-depth' }
  | { readonly v: 'skipped'; readonly why: 'too-large' | 'over-budget' }
  | { readonly v: 'failed'; readonly failure: string };

/** The basis of a reservation (D-8659). `listed`: the listing's size, used only when it belongs to the exact admitted
 *  pin (a committed pin at the listing's own commit, or a draft pin at the listed fingerprint). `class-cap`: the
 *  asset class's full cap, reserved for a historical commit (or a listed size that is unknown), whose size the
 *  listing does not hold. */
export interface MockupSize {
  readonly kind: 'listed' | 'class-cap';
  readonly bytes: number;
}

/** One row per reference. `size` is the admission reservation basis: non-null exactly when the row's pin was
 *  admitted: its verdict is `inline`, or `failed` after an admitted read failed, or `skipped:'over-budget'` where the
 *  build's output cap kept an admitted, loaded use out (D-8662), or `unsupported:'css-depth'` where the build reached the
 *  row at no use within the depth limit; null for every row never admitted. */
export interface MockupAssetRow {
  readonly ref: MockupRef;
  readonly verdict: MockupRefVerdict;
  readonly size: MockupSize | null;
}

/** What the planner derives from a context ONCE per plan and carries across extensions, so that an extension decides
 *  only its new references (fix round 1, F1): the page location the pin rule reads, whether that page opens a draft,
 *  and the listing indexed by `<section>\u0000<path>` (the first entry of each). */
export interface MockupPlanBasis {
  readonly page: DocsPageLocation & { kind: 'path' };
  readonly pageDraft: boolean;
  readonly index: ReadonlyMap<string, DocsEntry>;
}

/** One attempt's plan. `reservedBytes` sums each admitted pin's reservation ONCE and never shrinks within the attempt:
 *  a smaller reply, a failed read and a duplicate return nothing to it. `basis` is the context's derivation, built by
 *  `planMockupAssets` and carried unchanged; `admitted` maps each admitted pin's file id to the index in `rows` of the
 *  row that admitted it (at most `MOCKUP_MAX_ASSETS` entries). A caller that rewrites rows keeps both and every row's
 *  index (`{ ...plan, rows }`). */
export interface MockupAssetPlan {
  readonly context: MockupContext;
  readonly basis: MockupPlanBasis;
  readonly admitted: ReadonlyMap<string, number>;
  readonly rows: readonly MockupAssetRow[];
  readonly reservedBytes: number;
}

/** What one read answered: the bytes of the pin, or the failure word the Docs loaders gave (a 401's own word, a moved
 *  pin's, an unavailable commit's), kept whole and never folded into `missing`. */
export type MockupReadAnswer =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly kind: 'failed'; readonly failure: string };

/** THE port the loader reads through. It reads exactly the pin it is given; it never relists, retries or replans. */
export interface MockupAssetReader {
  read(pin: DocPin, signal: AbortSignal): Promise<MockupReadAnswer>;
}

/** What loading an attempt's plan came to. `plan` keeps every failure as a `failed` row (its reservation kept);
 *  `assets` holds successful bytes only, keyed by the pin's own API URL (`docsApi.file`); `actualBytes` counts every
 *  completed unique reply, an overflow that was refused included, independently of `reservedBytes`. */
export interface MockupAssetResult {
  readonly plan: MockupAssetPlan;
  readonly actualBytes: number;
  readonly assets: ReadonlyMap<string, { readonly mime: string; readonly bytes: Uint8Array<ArrayBuffer> }>;
}

/** An exact `https` origin that `parseMockupOrigin` accepted; the only value `mockupCsp` appends. */
export type HttpsOrigin = string & { readonly __mockupOrigin: 'https' };
