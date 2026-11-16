// BYPASS FIXTURE — MUST NOT COMPILE.
//
// THE ADOPTION SWITCH (D-8112): `['delegation-adopt', '--state']` -> `['delegation-adopt']`, i.e. a grant that keeps the
// switch's writer and drops the flag it is enrolled on — g14's shape for the marker that lets the delegation lane keep a
// finished delegated worktree.
//
// `isExecAllowed` is PREFIX-matching, so `['delegation-adopt']` admits the argv `CCD_ARGV.delegationAdopt` builds exactly
// as the two-token grant does, and `server/test/whitelist-subset.test.ts`'s reachability layer stays green on the
// narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof line
// below and a boot refusal at module load.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['delegation-adopt']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
