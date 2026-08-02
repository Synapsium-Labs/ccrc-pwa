// BYPASS FIXTURE — MUST NOT COMPILE.
//
// The same grant as g1, written BELOW the `ccd` key. The pair is the evidence
// that the new mechanism is position-independent: same error, same code, from a
// diff the old source-text slice would have treated completely differently.
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
  tmux: [['has-session']],
  ccd: [['start']],
  gh: [['pr', 'view']],
} as const satisfies ExecWhitelist;
