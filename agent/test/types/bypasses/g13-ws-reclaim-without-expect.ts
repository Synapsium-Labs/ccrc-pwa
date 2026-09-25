// BYPASS FIXTURE — MUST NOT COMPILE.
//
// CHILD RECLAMATION, wave 3: `['ws-reclaim', '--expect']` -> `['ws-reclaim']`,
// i.e. a grant that keeps the destructive verb and drops its confirmation
// token — g5's shape for the one other verb that deletes a workspace.
//
// `isExecAllowed` is PREFIX-matching, so `['ws-reclaim']` admits the argv
// `CCD_ARGV.wsReclaim` builds exactly as the two-token grant does, and
// `server/test/whitelist-subset.test.ts`'s reachability layer stays green on
// the narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`:
// it makes this edit a TS2322 on the proof line below and a boot refusal at
// module load. A bare `ws-reclaim` is not a narrower grant: it permits an
// UNCONFIRMED reclaim of any id the server was talked into composing, with no
// fingerprint re-proved against the box at the instant of deletion.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-reclaim']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
