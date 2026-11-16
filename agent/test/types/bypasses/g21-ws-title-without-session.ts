// BYPASS FIXTURE — MUST NOT COMPILE.
//
// NAMED WORKSPACES, S9: `['ws-title', '--session']` -> `['ws-title']`, i.e. a grant that keeps the rename verb and
// drops the flag that is its entire argument surface — g11's and g12's shape one verb over.
//
// `isExecAllowed` is PREFIX-matching, so `['ws-title']` admits `ccd ws-title --session demo-x --title T` exactly as the
// two-token grant does, and `server/test/whitelist-subset.test.ts`'s reachability layer stays green on the narrowed
// grant. What refuses the narrowing is the ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof
// line below and a boot refusal at module load. A bare `ws-title` would admit every positional form the verb might grow.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-title']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
