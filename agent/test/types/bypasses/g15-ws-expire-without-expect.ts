// BYPASS FIXTURE — MUST NOT COMPILE.
//
// WORKSPACE LIFECYCLE, wave 3: `['ws-expire', '--expect']` -> `['ws-expire']`,
// i.e. a grant that keeps the destructive verb and drops its confirmation
// token — g13's shape for ws-reclaim's sibling, the teardown of an archived
// workspace seven days after its archive.
//
// `isExecAllowed` is PREFIX-matching, so `['ws-expire']` admits the argv
// `CCD_ARGV.wsExpire` builds exactly as the two-token grant does, and
// `server/test/whitelist-subset.test.ts`'s reachability layer stays green on
// the narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`:
// it makes this edit a TS2322 on the proof line below and a boot refusal at
// module load. A bare `ws-expire` permits an UNCONFIRMED expiry of any id the
// server was talked into composing, with no fingerprint — and no archive epoch —
// re-proved against the box at the instant of deletion.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-expire']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
