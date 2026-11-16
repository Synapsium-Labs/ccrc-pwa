// BYPASS FIXTURE — MUST NOT COMPILE.
//
// ADD A PROJECT (add-project spec 2026-11-04 §4): `['project-add', '--name']` -> `['project-add']`, i.e. a grant that
// keeps the project create and drops the flag that is its entire argument surface — g21's shape one verb over.
//
// `isExecAllowed` is PREFIX-matching, so `['project-add']` admits `ccd project-add --name demo --empty` exactly as the
// two-token grant does, and `server/test/whitelist-subset.test.ts`'s reachability layer stays green on the narrowed
// grant. What refuses the narrowing is the ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof
// line below and a boot refusal at module load. A bare `project-add` would admit every form the verb might grow.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['project-add']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
