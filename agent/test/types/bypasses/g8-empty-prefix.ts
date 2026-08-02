// BYPASS FIXTURE — MUST NOT COMPILE.
//
// The widest grant expressible, written as the smallest diff in the file.
// `isExecAllowed` answers with `prefixes.some((p) => p.length <= args.length &&
// p.every(...))`, and `[].every(...)` is vacuously TRUE — so one empty prefix
// in the `ccd` list permits every ccd verb that exists: `ws-rm`, `ws-gc
// --prune`, a token-free `ws-reap`, all of them. It is also the mutant class
// `isExecAllowed`'s own disclosed-survivor comment names (M13/M14), previously
// pinned only by behavioural tests.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], []],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
