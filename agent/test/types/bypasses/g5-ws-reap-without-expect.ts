// BYPASS FIXTURE — MUST NOT COMPILE.
//
// VERIFY ROUND 2, P1 — the mutation the verifier measured against the gh fix:
// `['ws-reap', '--expect']` -> `['ws-reap']`, i.e. deleting the confirmation
// token from the one grant whose own source comment calls it load-bearing.
// Against the SHIPPED tree that edit left `tsc -p agent` clean, the module-load
// audit silent and `server/test/whitelist-subset.test.ts` at 37/37 — only two
// deletable agent test files objected. `LawfulGrants` makes it TS2322 on the
// proof line, the same class of mechanism `ProvenGrantable` gives the key set.
//
// A bare `ws-reap` is not a NARROWER grant than `ws-reap --expect`. It is a
// different one: it permits an UNCONFIRMED reap, which is the single thing §7
// says can never cross the wire.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-reap']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
