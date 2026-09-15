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
// the verb might ever grow, and the session id it carries arrives off a
// JSON-parsed websocket frame — ccd's own gate is the whole of what stands
// behind it. The verb MUTATES a shared tmux server's window options, reached
// (wave 3) from a route the PWA hits with no box token of any kind.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['win-size']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
