// BYPASS FIXTURE — MUST NOT COMPILE.
//
// ACCOUNT POOLS, wave 2a: `['project-pool', '--project']` -> `['project-pool']`,
// i.e. a grant that keeps the verb and drops the flag that is its entire
// argument surface.
//
// This is g9's shape one verb over, and it is here because the two halves of
// the mechanism are separable and only one of them is visible to a subset
// test. `isExecAllowed` is PREFIX-matching — its own comment says "tokens after
// the prefix are unconstrained" — so `['project-pool']` admits
// `ccd project-pool --project demo --pool pool-a` exactly as the two-token
// grant does, and `server/test/whitelist-subset.test.ts` stays green on the
// narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`: it
// makes this edit a TS2322 on the proof line here, and a boot refusal at
// module load.
//
// A bare `project-pool` is not a narrower grant. It permits every positional
// form the verb might ever grow — and this verb REWRITES A PLACEMENT POLICY
// for a whole project, from a route the PWA reaches with no token of any kind.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['project-pool']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
