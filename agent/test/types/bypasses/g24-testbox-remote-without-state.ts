// BYPASS FIXTURE — MUST NOT COMPILE.
//
// THE TEST BOX SWITCH (test box plan TB9, D-7411): `['testbox-remote', '--state']` -> `['testbox-remote']`, i.e. a
// grant that keeps the switch's writer and drops the flag it is enrolled on — g14's shape for the marker that sends
// test runs off the fleet host.
//
// `isExecAllowed` is PREFIX-matching, so `['testbox-remote']` admits the argv `CCD_ARGV.testboxRemote` builds exactly
// as the two-token grant does, and `server/test/whitelist-subset.test.ts`'s reachability layer stays green on the
// narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof line
// below and a boot refusal at module load.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['testbox-remote']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
