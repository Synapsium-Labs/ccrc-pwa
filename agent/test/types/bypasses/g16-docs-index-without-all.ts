// BYPASS FIXTURE — MUST NOT COMPILE.
//
// NATIVE DOCS READER, wave 2: `['docs-index', '--all']` -> `['docs-index']`,
// i.e. the fleet-wide docs listing granted without the flag that is its whole
// argument surface — g14's shape for the first of the four docs verbs.
//
// `isExecAllowed` is PREFIX-matching, so `['docs-index']` admits the argv
// `CCD_ARGV.docsIndex` builds exactly as the two-token grant does, and
// `server/test/whitelist-subset.test.ts`'s reachability layer stays green on
// the narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`:
// it makes this edit a TS2322 on the proof line below and a boot refusal at
// module load. The verb is read-only and takes no confirmation token, so the
// flag is all the grant can name; a bare `docs-index` would admit every
// positional form the verb might grow, reached from a session-gated route
// that carries no box token.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['docs-index']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
