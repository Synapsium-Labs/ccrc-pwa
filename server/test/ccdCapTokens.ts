/**
 * D-6051 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0k; ARCH-23 (#527)). The tokens
 * `cmd_caps` prints that are CAPABILITIES, not verbs: each names a flag or a behaviour of an existing verb, and no
 * dispatcher arm answers to it (`ccd/ccd`'s own comment on `stop-surface`). Moved here unchanged from
 * `ccd-archive.test.ts`, which holds the advertised set exactly equal to it, so `ccd-verb-sets.test.ts` can take the
 * verbs out of the caps list with the same list rather than a second copy.
 */
export const CCD_CAPABILITY_TOKENS: readonly string[] = ['account-pools', 'account-v1', 'actor-flags-v1', 'child-argv-v1', 'collect-v1', 'delegation-events-v1', 'docs-v1', 'expire-v1', 'hibernate-hold-ok', 'lifecycle-v1', 'nested-rescue-v1', 'pools-v1', 'reclaim-pause-v1', 'reclaim-v1', 'route-apply-v1', 'route-argv-v1', 'route-v1', 'stop-surface', 'swap-busy-v1', 'win-size-v1', 'ws-title-v1', 'ws-wrapper-v1'];
