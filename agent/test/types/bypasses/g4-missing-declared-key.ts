// BYPASS FIXTURE — MUST NOT COMPILE.
//
// The reverse drift, which the same annotation closes for free: a command
// DECLARED in `EXEC_COMMANDS` but with no entry in the object literal. That is
// the "route added, whitelist not updated, all suites green, dead on the fleet"
// failure the whole three-layer subset check exists for — it is invisible
// everywhere except a live 502. `Record<ExecCommand, …>` makes it TS2741, so
// the key set is pinned in BOTH directions by one annotation, not just against
// widening.
import type { ExecWhitelist } from '../../../src/whitelist.js';

export const incomplete: ExecWhitelist = {
  tmux: [['has-session']],
};
