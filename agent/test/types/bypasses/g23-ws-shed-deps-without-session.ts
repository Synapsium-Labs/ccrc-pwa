// BYPASS FIXTURE — MUST NOT COMPILE.
//
// THE DEPS-SHED ARM (D-7278): `['ws-shed-deps', '--session']` -> `['ws-shed-deps']`, i.e. a grant that keeps the
// destructive verb and drops the flag it is enrolled on — g21's shape for the verb that removes a sleeping session's
// ignored dependency directories.
//
// `isExecAllowed` is PREFIX-matching, so `['ws-shed-deps']` admits the argv `CCD_ARGV.wsShedDeps` builds exactly as the
// two-token grant does, and `server/test/whitelist-subset.test.ts`'s reachability layer stays green on the narrowed
// grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof line below and
// a boot refusal at module load.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-shed-deps']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
