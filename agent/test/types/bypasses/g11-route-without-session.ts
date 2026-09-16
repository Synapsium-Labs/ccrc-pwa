// BYPASS FIXTURE — MUST NOT COMPILE.
//
// ROUTING slice 1: `['route', '--session']` -> `['route']`, a grant that keeps
// the verb and drops the flag that is its entire argument surface. g9 and g10's
// shape one verb over: `isExecAllowed` is PREFIX-matching, so `['route']`
// admits `ccd route --session <id> --set <anything>` exactly as the two-token
// grant does and every subset test stays green. What refuses is the ENROLMENT
// in `REQUIRED_VERB_FLAG`: a TS2322 on the proof line here, and a boot refusal
// at module load. The verb WRITES a session's routing record — a byte channel
// into that session's next spawn argv — from a route the PWA reaches with no
// token of any kind, which is why the grant is exactly as narrow as the flag.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['route']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
