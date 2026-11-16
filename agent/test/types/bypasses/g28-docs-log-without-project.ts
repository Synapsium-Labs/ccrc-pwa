// BYPASS FIXTURE — MUST NOT COMPILE.
//
// NATIVE DOCS READER, wave 5b: `['docs-log', '--project']` -> `['docs-log']`,
// i.e. the grant of the history verb (one doc's log from a commit, 8 tokens
// after the verb) narrowed to the bare verb — g18's shape for the verb that
// returns a doc's history.
//
// `isExecAllowed` is PREFIX-matching, so `['docs-log']` admits the argv the
// server's builder emits exactly as the two-token grant does, and
// `server/test/whitelist-subset.test.ts`'s reachability layer stays green on
// the narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`:
// it makes this edit a TS2322 on the proof line below and a boot refusal at
// module load. A bare `docs-log` would admit every positional form the verb
// might grow.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['docs-log']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
