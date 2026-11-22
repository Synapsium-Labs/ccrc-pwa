// BYPASS FIXTURE — MUST NOT COMPILE.
//
// THE SLEEP MARKERS' VERB (Overlord W1 ccd arms, plan Task 3): `['keep-awake', '--session']` -> `['keep-awake']`, i.e. a
// grant that keeps the server-composed verb and drops the flag it is enrolled on — g29's shape for the verb the
// designation's create and retire set and clear the Overlord's `.no-hibernate` and `.no-roll` through.
//
// `isExecAllowed` is PREFIX-matching, so `['keep-awake']` admits the argv `CCD_ARGV.keepAwake` builds exactly as the
// two-token grant does, and also `ccd keep-awake <anything…>`. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`: it
// makes this edit a TS2322 on the proof line below and a boot refusal at module load.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['keep-awake']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
