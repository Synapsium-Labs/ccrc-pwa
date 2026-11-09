// BYPASS FIXTURE — MUST NOT COMPILE.
//
// THE SKILL SELF-INSTALL (D-8126): `['skill-ensure', '--wrapper']` -> `['skill-ensure']`, i.e. a grant that keeps the
// installer verb and drops the flag that is its whole argument surface — g26's shape one verb over.
//
// `isExecAllowed` is PREFIX-matching, so `['skill-ensure']` admits the argv `CCD_ARGV.skillEnsure` builds exactly
// as the two-token grant does, and `server/test/whitelist-subset.test.ts`'s reachability layer stays green on the
// narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof line
// below and a boot refusal at module load.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['skill-ensure']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
