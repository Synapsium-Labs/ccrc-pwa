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
  DocFilePin, DocPin, DocsFailureBody, DocsFetchOk, DocsFolderAddOk, DocsFolderFrameOk, DocsFolderListOk, DocsFolderPreparedOk,
  DocsFolderRemoveOk, DocsFolderShowOk, DocsFolderTreeOk, DocsIndexOk, DocsLogAsk, DocsLogOk, DocsRangeFrameOk,
  DocsRangePreparedOk, DocsRefSpec, DocsShowOk, DocsTreeOk,
} from '../../../shared/docs.js';
import type { DocsFolderFileAsk, DocsFolderRangeTarget, DocsJob, DocsRangeFrameAsk, DocsRangeTarget } from './policy.js';

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

/** The server's own facts about one folder show, decided before the call and never taken from the request: `maxBytes`, the
 *  class cap of the path's content class (sent as `--max-bytes`), and `job`, L1's lane estimate for the answer. A folder has
 *  no listing map, so there is no `listedBlob` and no known size. */
export interface DocsFolderShowAsk { maxBytes: number; job: DocsJob }

/** `docs-index --all`'s answer, carried verbatim, or the failure. */
export type DocsIndexRead = { ok: true; answer: DocsIndexOk } | DocsFailureBody;

/** `docs-tree`'s answer, carried verbatim, or the failure. */
export type DocsTreeRead = { ok: true; answer: DocsTreeOk } | DocsFailureBody;

/** `docs-show`'s answer, carried verbatim, with `bytes`: the content it encodes, decoded once here so W3's raster
 *  path serves exactly the bytes the adapter checked. Or the failure. */
export type DocsShowRead = { ok: true; answer: DocsShowOk; bytes: Uint8Array } | DocsFailureBody;

/** `docs-fetch`'s answer, carried verbatim, or the failure. */
export type DocsFetchRun = { ok: true; answer: DocsFetchOk } | DocsFailureBody;

/** `docs-log`'s answer, carried verbatim once it echoes the ask, or the failure (rich-docs spec G4). */
export type DocsLogRead = { ok: true; answer: DocsLogOk } | DocsFailureBody;

/** `docs-show-range --prepare`'s ok line (the snapshot's id, size and digest), carried verbatim, or the failure. */
export type DocsRangePrepareRead = { ok: true; answer: DocsRangePreparedOk } | DocsFailureBody;

/** `docs-show-range --snapshot …`'s ok line, carried verbatim once the adapter has held it to the ask (the snapshot and
 *  offset it echoes, its bytes canonical base64 within the asked length and hashing to its digest), or the failure. */
export type DocsRangeFrameRead = { ok: true; answer: DocsRangeFrameOk } | DocsFailureBody;

/** One file read by range (X2 spec 4.3), a prepare and then frames of what it snapshotted. Both answer their own named
 *  result type under the port's one failure contract: every gate, transport, ccd and classification condition (an
 *  unsupported or unmeasured box, `snapshot-gone`, `range-too-large`, `prepare-busy`, `draft-changed`, a malformed
 *  answer) is a failure BODY carrying its word, never a `null` and never a rejection. A prepare writes a private
 *  snapshot into ccd's own range cache on the fleet box and nothing else; a frame reads only that cache. */
export interface DocsRangeRead {
  /** Snapshot `target`'s pinned bytes. */
  prepare(src: DocsSourceId, target: DocsRangeTarget): Promise<DocsRangePrepareRead>;
  /** One frame of a snapshot `prepare` made for `target`; `frame` is what L1's `docsRangePlan` admitted. */
  frame(src: DocsSourceId, target: DocsRangeTarget, frame: DocsRangeFrameAsk): Promise<DocsRangeFrameRead>;
}

/** One outside folder on one fleet node, by its label (X2 spec 4.1): the label is a value L1's `parseDocsFolderLabel` admitted,
 *  and it is all the server ever names of a folder, since ccd resolves the path from its own registry. */
export interface DocsFolderId { node: string; label: string }

/** `docs-folder --list`'s answer, carried verbatim once its shape holds (`docsFolderAnswerShape`), or the failure. A row
 *  whose registry file is unreadable is kept as `state: 'unreadable'` with `path: null`, never dropped or folded. */
export type DocsFolderListRead = { ok: true; answer: DocsFolderListOk } | DocsFailureBody;

/** `docs-folder-read --op tree`'s answer, carried verbatim once its shape holds and it echoes the label asked, or the failure. */
export type DocsFolderTreeRead = { ok: true; answer: DocsFolderTreeOk } | DocsFailureBody;

/** `docs-folder-read --op show`'s answer, carried verbatim once it is held to the bytes it encodes and to the leaf and
 *  fingerprint asked, with `bytes`: the content it encodes, decoded once here. Or the failure. */
export type DocsFolderShowRead = { ok: true; answer: DocsFolderShowOk; bytes: Uint8Array } | DocsFailureBody;

/** `docs-folder-read --op prepare`'s ok line, carried verbatim once held to the pin it was sent (the route then believes it
 *  after `docsRangeAnswerShape`, as for a project's range), or the failure. */
export type DocsFolderPrepareRead = { ok: true; answer: DocsFolderPreparedOk } | DocsFailureBody;

/** `docs-folder-read --op range`'s ok line, held to its ask as a project range frame is (and believed by the route after
 *  `docsRangeAnswerShape`), or the failure. */
export type DocsFolderFrameRead = { ok: true; answer: DocsFolderFrameOk } | DocsFailureBody;

/** `docs-folder --add`'s and `--remove`'s ok lines, carried verbatim once their shape holds, or the failure. */
export type DocsFolderAddRun = { ok: true; answer: DocsFolderAddOk } | DocsFailureBody;
export type DocsFolderRemoveRun = { ok: true; answer: DocsFolderRemoveOk } | DocsFailureBody;

/** One outside-folder file read by range (spec 4.1 and 4.3), a prepare and then frames of what it snapshotted. The failure
 *  contract of `DocsRangeRead` holds for it; `target` carries no commit, branch or head. */
export interface DocsFolderRangeRead {
  /** Snapshot `target`'s pinned bytes. */
  prepare(src: DocsFolderId, target: DocsFolderRangeTarget): Promise<DocsFolderPrepareRead>;
  /** One frame of a snapshot `prepare` made for `target`; `frame` is what L1's `docsFolderRangePlan` admitted. */
  frame(src: DocsFolderId, target: DocsFolderRangeTarget, frame: DocsRangeFrameAsk): Promise<DocsFolderFrameRead>;
}

/**
 * The outside-folder READS (X2 spec 4.1), under the port's one failure contract: each answers its own named result type, and
 * every gate, transport, ccd and classification condition (a fleet without `docs-folders-v1`, `unknown-folder`, a refused
 * admission, a malformed answer) is a failure BODY carrying its word, never a `null` and never a rejection. None of them
 * writes anything on the fleet but the range prepare's private cache. No answer carries a folder's path but `list`'s.
 */
export interface DocsFolderReader {
  /** Every registered folder: its label, its state and (state `ok` only) its path. */
  list(at: DocsNodeId): Promise<DocsFolderListRead>;
  /** One folder's six sections, walked below the held descriptor. */
  tree(src: DocsFolderId): Promise<DocsFolderTreeRead>;
  /** One leaf of a folder, read only while its bytes hash to `ask.fp`; `plan` carries the server's own facts (`maxBytes`,
   *  `job`), never taken from the request. */
  show(src: DocsFolderId, ask: DocsFolderFileAsk, plan: DocsFolderShowAsk): Promise<DocsFolderShowRead>;
  /** One file in frames, for a leaf above what `show` carries. */
  range: DocsFolderRangeRead;
}

/** The two operations that WRITE the folder registry (the fleet box's `docs-folder --add` and `--remove`), held apart from
 *  the reads so a read route cannot reach them (as `DocsFetcher` is for the one fetch). Both answer a failure BODY, never a
 *  `null` and never a rejection; neither answer carries a path. */
export interface DocsFolderRegistry {
  /** Register `path` (absolute, shape checked by L1) under `label`. ccd decides admission and answers its word. */
  add(at: DocsNodeId, label: string, path: string): Promise<DocsFolderAddRun>;
  /** Remove `label` and purge its range snapshots. */
  remove(at: DocsNodeId, label: string): Promise<DocsFolderRemoveRun>;
}

/** The five reads. None of them writes anything on the fleet but the range prepare's private cache (section 2 (g)'s wall
 *  1: the read registration is built with this port alone and holds no fetcher). */
export interface DocsReader {
  /** Every project on the node (`docs-index --all`). */
  index(at: DocsNodeId): Promise<DocsIndexRead>;
  /** One project's listing. `ref` is the request's ref in either grammar; `null` means the default view (ccd's
   *  origin-default chain), sent as no `--ref` at all. */
  tree(src: DocsSourceId, ref: DocsRefSpec | null): Promise<DocsTreeRead>;
  /** One file at a pin from a tree answer: a committed pin, or a draft pin; `ask` carries the server's facts. */
  show(src: DocsSourceId, pin: DocFilePin, ask: DocsShowAsk): Promise<DocsShowRead>;
  /** One doc's history from `ask.commit` back (rich-docs spec G4); `ask` is what L1's history parser admitted. */
  log(src: DocsSourceId, ask: DocsLogAsk): Promise<DocsLogRead>;
  /** One file in frames (X2 spec 4.3), for a file above what `show` carries. */
  range: DocsRangeRead;
}

/** The one docs operation that writes (a git fetch on the fleet), held apart so a read route cannot reach it. */
export interface DocsFetcher {
  /** Fetch `branch` (bare) from origin. `null` means the origin default branch, sent as no `--branch` at all. */
  fetch(src: DocsSourceId, branch: string | null): Promise<DocsFetchRun>;
}
