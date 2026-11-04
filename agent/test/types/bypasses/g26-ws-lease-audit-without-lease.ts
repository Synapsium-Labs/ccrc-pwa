// BYPASS FIXTURE — MUST NOT COMPILE.
//
// DELEGATION BROKER WAVE 5: `['ws-lease-audit', '--lease']` -> `['ws-lease-audit']`, a grant that keeps the lease audit
// and drops the flag that names the one lease it may measure. `isExecAllowed` is PREFIX-matching, so the bare grant
// admits an audit of any lease the server was talked into naming; the ENROLMENT in `REQUIRED_VERB_FLAG` makes this a
// TS2322 on the proof line and a boot refusal at module load.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-lease-audit']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
