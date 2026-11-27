// The artifact tier's ports (native Docs HTML artifacts X5, plan Task A2.2; spec
// docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md section 3.3). Ring L2: the consumer declares each port and
// the port states its failure contract. Type-only: no value is exported or imported here (an `import type` is not a value).
// A2.3 adds the tree port; wave A3 adds the byte port.
import type { DocPin, DocsFailureBody, DocsTreeOk } from '../../../shared/docs.js';

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
