// BYPASS FIXTURE — MUST NOT COMPILE.
//
// NATIVE DOCS READER, wave 2: `['docs-fetch', '--project']` -> `['docs-fetch']`,
// i.e. the one docs verb that writes anything (one remote-tracking ref and
// ccd's own fetch stamp) granted without the flag that is its whole argument
// surface — g16's shape for the fetch.
//
// `isExecAllowed` is PREFIX-matching, so `['docs-fetch']` admits both argv
// `CCD_ARGV.docsFetch` builds (with and without `--branch`) exactly as the
// two-token grant does, and `server/test/whitelist-subset.test.ts`'s
// reachability layer stays green on the narrowed grant. What refuses is the
// ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof
// line below and a boot refusal at module load. A bare `docs-fetch` would
// admit every positional form the verb might grow.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['docs-fetch']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
