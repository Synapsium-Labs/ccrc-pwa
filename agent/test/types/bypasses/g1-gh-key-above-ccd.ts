// BYPASS FIXTURE — MUST NOT COMPILE.
//
// The exact mutation the final review performed to prove the no-`gh` invariant
// was pinned by one deletable test: `gh: [['pr','view']]` written ABOVE the
// `ccd` key. Position mattered to the old pin — the server's layer-3 check
// slices the source text from the `ccd` key onward, so a key written above it
// was outside the slice and went unseen (measured: 35/35 server PASS with the
// grant in place). A TYPE has no notion of "above": g1 and g2 differ only in
// where the key is written and produce the identical error.
//
// ROUND 3, P4 — written `as const satisfies ExecWhitelist`, NOT `: ExecWhitelist`.
// These fixtures used the annotation form until the real site at
// `whitelist.ts` became `} as const satisfies ExecWhitelist;`, and a
// compile-failure pin that does not reproduce the shipped construct proves
// nothing about the shipped construct. Excess-property checking under
// `satisfies` has changed across TS releases before; if it changes again, this
// fixture has to be the thing that notices.
import type { ExecWhitelist } from '../../../src/whitelist.js';

export const widened = {
  gh: [['pr', 'view']],
  tmux: [['has-session']],
  ccd: [['start']],
} as const satisfies ExecWhitelist;
