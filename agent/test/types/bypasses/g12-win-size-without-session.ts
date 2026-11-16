// BYPASS FIXTURE — MUST NOT COMPILE.
//
// TERMINAL DRAWER, wave 2: `['win-size', '--session']` -> `['win-size']`, i.e.
// a grant that keeps the verb and drops the flag that is its entire argument
// surface.
//
// This is g9/g10/g11's shape one verb over (g11 is ROUTING slice 1's
// `['route']`, not a win-size fixture — this file is g12 because that name was
// already taken), and it is here because the two halves of the mechanism are
// separable and only one of them is visible to a subset test. `isExecAllowed`
// is PREFIX-matching — `EXEC_WHITELIST`'s own docstring says "tokens after the
// prefix are unconstrained" — so `['win-size']` admits
// `ccd win-size --session demo --mode smallest` exactly as the two-token grant
// does, so `server/test/whitelist-subset.test.ts`'s layer 2 and layer 3's
// REACHABILITY check stay green on the narrowed grant (that file's explicit
// `win-size is grantable ONLY with --session` case, added with this fixture, is
// the deliberate exception — and it lives in the other package). What refuses
// the narrowing HERE is the ENROLMENT in
// `REQUIRED_VERB_FLAG`: it makes this edit a TS2322 on the proof line here, and
// a boot refusal at module load.
//
// A bare `win-size` is not a narrower grant. It permits every positional form
// the verb might ever grow, and the session id it carries has no server-side
// gate to fall back on: the route it comes from (wave 3) is `GET /ws/pty/:id`,
// which carries no box token of any kind, and its `:id` is a path param THAT
// HANDLER VALIDATES NOWHERE — measured over the handler body in
// `server/src/server.ts`, which passes the id straight to `resizeWindow` and
// `spawnPty` with no id-class test, no roster lookup and no 400. ccd's own
// `cmd_win_size` gate is the whole of what stands behind it, and the verb
// MUTATES a shared tmux server's window options.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['win-size']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
