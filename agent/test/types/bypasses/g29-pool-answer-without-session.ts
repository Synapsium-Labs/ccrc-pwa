// BYPASS FIXTURE — MUST NOT COMPILE.
//
// THE POOL ANSWER (Overlord W1 pool set, plan Task 6): `['pool-answer', '--session']` -> `['pool-answer']`, i.e. a grant
// that keeps the read-only verb and drops the flag it is enrolled on — g15's shape for the verb the designation door and
// the renewal lane read a session's pool answer through.
//
// `isExecAllowed` is PREFIX-matching, so `['pool-answer']` admits the argv `CCD_ARGV.poolAnswer` builds exactly as the
// two-token grant does, and `server/test/whitelist-subset.test.ts`'s reachability layer stays green on the narrowed
// grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof line below and
// a boot refusal at module load.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['pool-answer']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
