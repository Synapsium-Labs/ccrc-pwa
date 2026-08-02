// BYPASS FIXTURE — MUST NOT COMPILE.
//
// The reverse drift, which the same annotation closes for free: a command
// DECLARED in `EXEC_COMMANDS` but with no entry in the object literal. That is
// the "route added, whitelist not updated, all suites green, dead on the fleet"
// failure the whole three-layer subset check exists for — it is invisible
// everywhere except a live 502. `Record<ExecCommand, …>` makes it TS2741, so
// the key set is pinned in BOTH directions by one annotation, not just against
// widening.
//
// ROUND 3, P4 — written `as const satisfies ExecWhitelist`, NOT `: ExecWhitelist`.
// These fixtures used the annotation form until the real site at
// `whitelist.ts` became `} as const satisfies ExecWhitelist;`, and a
// compile-failure pin that does not reproduce the shipped construct proves
// nothing about the shipped construct. Excess-property checking under
// `satisfies` has changed across TS releases before; if it changes again, this
// fixture has to be the thing that notices.
import type { ExecWhitelist } from '../../../src/whitelist.js';

export const incomplete = {
  tmux: [['has-session']],
} as const satisfies ExecWhitelist;
