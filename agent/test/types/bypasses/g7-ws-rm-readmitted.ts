// BYPASS FIXTURE — MUST NOT COMPILE.
//
// Re-admitting the unguarded legacy delete. This one IS caught cross-package
// today (layer 3 of `server/test/whitelist-subset.test.ts` fails on an
// unreachable grant, measured by the verifier as 1 failing test) — but only by
// a test file, and only because no route builds it. `UNGRANTABLE_VERBS` makes
// it a compile error and a boot failure as well, so the mechanism does not
// depend on the server package continuing to have no `ws-rm` route.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-rm', '--session']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
