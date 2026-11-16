// BYPASS FIXTURE — MUST NOT COMPILE.
//
// FLEET DISK RETENTION, DR-18 (D-6630): `['ws-orphan', '--expect']` -> `['ws-orphan']`,
// i.e. a grant that keeps the destructive verb and drops its confirmation
// token — g13's and g15's shape for the orphan-worktree verb, which removes a
// linked worktree no registry row names.
//
// `isExecAllowed` is PREFIX-matching, so `['ws-orphan']` admits the argv
// `CCD_ARGV.wsOrphan` builds exactly as the two-token grant does, and
// `server/test/whitelist-subset.test.ts`'s reachability layer stays green on
// the narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`:
// it makes this edit a TS2322 on the proof line below and a boot refusal at
// module load. A bare `ws-orphan` permits an UNCONFIRMED removal of any tree
// the server was talked into composing, with no token re-proved against the
// box inside the orphan lock before the move.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-orphan']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
