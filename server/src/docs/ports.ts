// The native Docs reader's L2 ports (design 2026-10-01, section 1's ports row), DECLARED BY THE CONSUMER: W3's routes
// are the code that calls them, and this file states what those routes need and what each answer means.
// `ccdsource.ts` (L3) is one implementation, over the fleet's `ccd docs-*` verbs.
//
// Ring, checked by imports (M7.10): `import type` lines only and no runtime export, so nothing here executes.
//
// The failure contract, the same for every operation: each answers its own named result type, `{ ok: true; ... }` or
// a `DocsFailureBody` (`shared/docs.ts`). Every gate, transport, ccd and classification condition is a failure BODY
// carrying its word; the promise rejects only on a defect. No operation answers `null` or `undefined` for a failure,
// and every `null` in a signature below has exactly one meaning, stated beside it.
//
// The failure arm is the whole `DocsFailureBody`, not a narrower per-operation union (refinement (d)): ccd's per-verb
// word set is not a checked contract, so a narrower static type would claim what the adapter cannot measure.
import type {
  DocPin, DocsFailureBody, DocsFetchOk, DocsIndexOk, DocsRefSpec, DocsShowOk, DocsTreeOk,
} from '../../../shared/docs.js';
import type { DocsJob } from './policy.js';

/** Which fleet node answers a project-less read. An implementation is bound to one node at construction; W3's node
 *  map selects it, and passes the id through so every port operation names its node the same way. */
export interface DocsNodeId { node: string }

/** One project on one fleet node. `project` is a `:project` that L1's `parseDocsProjectParam` admitted. */
export interface DocsSourceId { node: string; project: string }

/** The server's own facts about one show, decided before the call and never taken from the request (M6.4):
 *  - `maxBytes`: the class cap of the path's content class (`docsShowPlan(...).maxBytes`), sent as `--max-bytes`;
 *  - `job`: L1's lane estimate for the answer (`docsShowPlan(...).job`), its `wire` the bound check 9 holds;
 *  - `listedBlob`: the committed blob the server's listing map holds for this pin; `null` means only "the server
 *    holds no listing entry for it", never "the blob is absent". A draft pin carries `null`. */
export interface DocsShowAsk { maxBytes: number; job: DocsJob; listedBlob: string | null }

/** `docs-index --all`'s answer, carried verbatim, or the failure. */
export type DocsIndexRead = { ok: true; answer: DocsIndexOk } | DocsFailureBody;

/** `docs-tree`'s answer, carried verbatim, or the failure. */
export type DocsTreeRead = { ok: true; answer: DocsTreeOk } | DocsFailureBody;

/** `docs-show`'s answer, carried verbatim, with `bytes`: the content it encodes, decoded once here so W3's raster
 *  path serves exactly the bytes the adapter checked. Or the failure. */
export type DocsShowRead = { ok: true; answer: DocsShowOk; bytes: Uint8Array } | DocsFailureBody;

/** `docs-fetch`'s answer, carried verbatim, or the failure. */
export type DocsFetchRun = { ok: true; answer: DocsFetchOk } | DocsFailureBody;

/** The three reads. None of them writes anything on the fleet (section 2 (g)'s wall 1: the read registration is built
 *  with this port alone and holds no fetcher). */
export interface DocsReader {
  /** Every project on the node (`docs-index --all`). */
  index(at: DocsNodeId): Promise<DocsIndexRead>;
  /** One project's listing. `ref` is the request's ref in either grammar; `null` means the default view (ccd's
   *  origin-default chain), sent as no `--ref` at all. */
  tree(src: DocsSourceId, ref: DocsRefSpec | null): Promise<DocsTreeRead>;
  /** One file at a pin from a tree answer: a committed pin, or a draft pin; `ask` carries the server's facts. */
  show(src: DocsSourceId, pin: DocPin, ask: DocsShowAsk): Promise<DocsShowRead>;
}

/** The one docs operation that writes (a git fetch on the fleet), held apart so a read route cannot reach it. */
export interface DocsFetcher {
  /** Fetch `branch` (bare) from origin. `null` means the origin default branch, sent as no `--branch` at all. */
  fetch(src: DocsSourceId, branch: string | null): Promise<DocsFetchRun>;
}
