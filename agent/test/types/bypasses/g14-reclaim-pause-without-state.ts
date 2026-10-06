// BYPASS FIXTURE — MUST NOT COMPILE.
//
// CHILD RECLAMATION, wave 4: `['reclaim-pause', '--state']` -> `['reclaim-pause']`,
// i.e. a grant that keeps the verb and drops the flag that is its entire
// argument surface — g9's `coord-pause` finding, one verb over.
//
// `isExecAllowed` is PREFIX-matching (tokens after the prefix are
// unconstrained), so `['reclaim-pause']` admits
// `ccd reclaim-pause --state on` exactly as the two-token grant does, and
// `server/test/whitelist-subset.test.ts`'s layer 2 and layer 3's reachability
// check both stay green on the narrowed grant. What refuses the narrowing HERE
// is the ENROLMENT in `REQUIRED_VERB_FLAG`: a TS2322 on the proof line below,
// and a boot refusal at module load.
//
// A bare `reclaim-pause` is not a narrower grant. It permits every positional
// form the verb might ever grow, reached from `POST /api/coord/reclaim-pause`,
// a route that carries no box token — and the verb it guards is the switch
// that decides whether automation may DELETE workspaces.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['reclaim-pause']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
