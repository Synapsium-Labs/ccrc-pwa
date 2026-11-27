// The artifact tier's ports (native Docs HTML artifacts X5, plan Task A2.2; spec
// docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md section 3.3). Ring L2: the consumer declares each port and
// the port states its failure contract. Type-only: no value is exported or imported here (an `import type` is not a value).
// A2.3 adds the tree port; wave A3 adds the byte port (`ArtifactBytes`, with `ArtifactReadAt`).
import type { DocPin, DocsFailureBody, DocSectionSlug, DocsTreeOk } from '../../../shared/docs.js';
import type { ArtifactManifestEntry } from './store.js';

/**
 * One tree read of a docs project at the ref a pin names, for the mint's manifest (spec 3.2). The ADAPTER is the docs plugin's
 * (`server/src/docs/routes.ts`), over the console's own tree read, so the mint shares the console's lane, flight and cache.
 *
 * FAILURE CONTRACT. It never throws. A tree read that succeeds answers `{ok: true, tree}`: what the ref holds NOW, which may
 * not be the version the pin names, so the caller checks it (`pinHolds`). Any failure of the docs tree read answers
 * `{ok: false}`, with the docs failure body kept as `detail` (the lane's `docs-busy` and a client that left included), and never
 * an empty tree: a caller never reads a failure as a page with no files.
 */
export interface ArtifactTree {
  read(project: string, pin: DocPin, signal: AbortSignal):
    Promise<{ ok: true; tree: DocsTreeOk } | { ok: false; detail: DocsFailureBody }>;
}

/**
 * Whether the session a capability was minted under still stands (spec 3.3, "the capability's life").
 *
 * FAILURE CONTRACT. It measures the CURRENT secret generation on every call, uncached, as the account gate does, so a
 * passphrase change ends every capability at once with no other act. A secret that is `absent`, `unusable` or `unread` answers
 * `ended`, so a missing or broken secret ends every capability. Any other failure answers `ended` too. It never throws. The
 * capability keeps no generation of its own, so nothing can compare against a stale one.
 */
export interface SessionLiveness {
  of(sessionIdHash: string, now: number): 'live' | 'ended';
}

/**
 * Where one artifact read reads (plan Task A3.3): the capability's project and its pin exactly as the mint accepted it, the tree
 * read's ref at the mint (`ref.commit` and `ref.served`, which `pinHolds` matched to the pin's `commit` or `head`), and the file's
 * section and SECTION-relative path (the manifest's key). The content door builds it from the capability; the adapter reads from
 * nothing else, so every read names the pinned version, never what a branch holds now.
 */
export interface ArtifactReadAt {
  project: string;
  pin: DocPin;
  ref: { commit: string; served: string };
  section: DocSectionSlug;
  path: string;
}

/** A prepare's answer: the snapshot id X2 P1's range reads name, or why there is none. `prepare-busy` is ccd's own word (its
 *  snapshot cache or budget cannot take one now: the door waits and asks again inside its bounded wait); `busy` is the docs lane's
 *  (its wait ran out, it was closed, or the read was abandoned); `draft-changed` is a draft file no longer at its pin;
 *  `unreadable` is every other failure. */
export type ArtifactPrepareAnswer =
  | { ok: true; snapshot: string }
  | { ok: false; error: 'prepare-busy' | 'busy' | 'draft-changed' | 'unreadable' };

/** A read's answer. `ok` once every frame of the range has been handed to the sink, or the sink answered `stop`. Otherwise:
 *  `draft-changed` (a draft file no longer at its pin), `too-large` (ccd refused a size bound), `frame-digest` (a frame failed its
 *  check: its bytes, length or digest were not what was asked), `snapshot-gone` (the snapshot expired: prepare once more),
 *  `busy` (the docs lane's wait ran out, it was closed, or the read was abandoned), and `unreadable` for every other failure. */
export type ArtifactReadAnswer =
  | { ok: true }
  | { ok: false; error: 'draft-changed' | 'unreadable' | 'too-large' | 'frame-digest' | 'snapshot-gone' | 'busy' };

/** What the content door's sink answers once it has written one frame and the socket has drained it: `next` asks for the next
 *  frame; `stop` says the response has ended (its capability died, the client left, a deadline passed), so no further frame is
 *  read. */
export type ArtifactSinkAnswer = 'next' | 'stop';

/**
 * The bytes of one manifest entry, read through the console's own docs reads (plan Task A3.3, spec section 5): an entry at most
 * `DOCS_LANE_LARGE_RAW` is one `docs-show` (`snapshot` null), read whole and cut to the range; a larger one is X2 P1's range
 * read, a `prepare` by the entry's pin, then frames of at most `DOCS_RANGE_FRAME_BYTES`. Every exec is a job of source
 * `artifact` on the shared docs read lane. The ADAPTER is the docs plugin's (`server/src/docs/routes.ts`), a closure over the
 * console's reader and lanes (D-9136's rule: `ccdsource.ts` is L3 and books no lane).
 *
 * FAILURE CONTRACT. It never throws. Every failure is one of the answer words above, each kept apart: `busy` is never folded into
 * `unreadable`, and a draft that changed is never `unreadable`. A frame is handed to the sink only after it has passed its checks
 * (its echo, its exact length, its digest, and the snapshot's size against the entry's), so a byte that fails a check never
 * reaches the sink. After the sink answers `stop`, no further frame is read. `signal` aborts a job still queued on the lane (it
 * answers `busy`); a running exec is never cancelled (the agent has no cancel), and its answer is then dropped.
 */
export interface ArtifactBytes {
  prepare(at: ArtifactReadAt, entry: ArtifactManifestEntry, signal: AbortSignal): Promise<ArtifactPrepareAnswer>;
  read(
    at: ArtifactReadAt, entry: ArtifactManifestEntry, range: { start: number; end: number }, snapshot: string | null,
    sink: (frame: Uint8Array) => Promise<ArtifactSinkAnswer>, signal: AbortSignal,
  ): Promise<ArtifactReadAnswer>;
}
