// BYPASS FIXTURE — MUST NOT COMPILE.
//
// THE SWEEP'S BUSY ARM SWITCH (D-7994): `['scope-sweep-busy', '--state']` -> `['scope-sweep-busy']`, i.e. a grant that
// keeps the switch's writer and drops the flag it is enrolled on — g14's shape for the marker that lets the sweep stop a
// provably dead session's busy processes.
//
// `isExecAllowed` is PREFIX-matching, so `['scope-sweep-busy']` admits the argv `CCD_ARGV.scopeSweepBusy` builds exactly
// as the two-token grant does, and `server/test/whitelist-subset.test.ts`'s reachability layer stays green on the
// narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof line
// below and a boot refusal at module load.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['scope-sweep-busy']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
