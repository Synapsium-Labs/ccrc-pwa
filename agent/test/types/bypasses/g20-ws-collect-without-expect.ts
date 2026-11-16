// BYPASS FIXTURE — MUST NOT COMPILE.
//
// CHILD RECLAMATION, wave 7: `['ws-collect', '--expect']` -> `['ws-collect']`,
// i.e. a grant that keeps the destructive verb and drops its confirmation
// token — g13's and g15's shape for the temp-root collector, which removes a
// witnessed child temp root whose workspace is gone.
//
// `isExecAllowed` is PREFIX-matching, so `['ws-collect']` admits the argv
// `CCD_ARGV.wsCollect` builds exactly as the two-token grant does, and
// `server/test/whitelist-subset.test.ts`'s reachability layer stays green on
// the narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`:
// it makes this edit a TS2322 on the proof line below and a boot refusal at
// module load. A bare `ws-collect` permits an UNCONFIRMED collection of any id
// the server was talked into composing, with no tree token re-proved against
// the box inside the reap lock before the move.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-collect']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
