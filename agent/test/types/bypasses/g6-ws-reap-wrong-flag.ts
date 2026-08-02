// BYPASS FIXTURE — MUST NOT COMPILE.
//
// The shape a plausible-looking edit actually produces, as opposed to g5's
// outright deletion: the flag is still there, it is just the wrong one. Every
// other ccd grant in the table is `[verb, '--session']`, so `--session` is what
// a tidy-up that "made ws-reap consistent with its neighbours" would write —
// and it would grant `ccd ws-reap --session <id>`, a reap with no token at all.
// g5 and g6 are the pair that show the pin checks the TOKEN and not merely the
// arity.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-reap', '--session']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
