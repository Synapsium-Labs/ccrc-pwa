// BYPASS FIXTURE — MUST NOT COMPILE.
//
// DELEGATION BROKER WAVE 5: `['ws-lease-mark', '--lease']` -> `['ws-lease-mark']`, a grant that keeps the carrier
// writer and drops the flag that names the one lease it may write. `isExecAllowed` is PREFIX-matching, so the bare
// grant admits every argv `CCD_ARGV.leaseMark` builds; the ENROLMENT in `REQUIRED_VERB_FLAG` makes this a TS2322 on
// the proof line and a boot refusal at module load.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-lease-mark']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
