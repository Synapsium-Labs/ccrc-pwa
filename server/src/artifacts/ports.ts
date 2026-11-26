// The artifact tier's ports (native Docs HTML artifacts X5, plan Task A2.2; spec
// docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md section 3.3). Ring L2: the consumer declares each port and
// the port states its failure contract. Type-only: no value is exported or imported here. Wave A3 adds the byte and tree ports.

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
