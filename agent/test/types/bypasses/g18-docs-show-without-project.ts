// BYPASS FIXTURE — MUST NOT COMPILE.
//
// NATIVE DOCS READER, wave 2: `['docs-show', '--project']` -> `['docs-show']`,
// i.e. the one grant both `docs-show` argv shapes ride (committed, 12 tokens
// after the verb; draft, 14) narrowed to the bare verb — g16's shape for the
// verb that returns file bytes.
//
// `isExecAllowed` is PREFIX-matching, so `['docs-show']` admits the argv
// `CCD_ARGV.docsShowCommitted` and `CCD_ARGV.docsShowDraft` build exactly as
// the two-token grant does, and `server/test/whitelist-subset.test.ts`'s
// reachability layer stays green on the narrowed grant. What refuses is the
// ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof
// line below and a boot refusal at module load. A bare `docs-show` would
// admit every positional form the verb might grow.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['docs-show']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
