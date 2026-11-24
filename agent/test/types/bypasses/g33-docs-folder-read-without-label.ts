// BYPASS FIXTURE — MUST NOT COMPILE.
//
// NATIVE DOCS READER, X2 wave P2: `['docs-folder-read', '--label']` -> `['docs-folder-read']`,
// i.e. the grant of the outside-folder read (a tree, a show, a prepare or one frame of a folder file)
// narrowed to the bare verb — g32's shape for the verb that reads a registered folder.
//
// `isExecAllowed` is PREFIX-matching, so `['docs-folder-read']` admits the argv the server's
// builder emits exactly as the two-token grant does, and `server/test/whitelist-subset.test.ts`'s
// reachability layer stays green on the narrowed grant. What refuses is the ENROLMENT in
// `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof line below and a boot refusal at
// module load. A bare `docs-folder-read` would admit every positional form the verb might grow.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['docs-folder-read']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
