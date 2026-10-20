/**
 * D-6045 (Task C0k; ARCH-04 (#545), stage 1): the L4 files allowed to import `fastify` or an `@fastify/*` package,
 * or to bind a `Fastify*` name from any module, in any form (a type import, a re-export and a type query
 * included). Generated from the tree on the day the rule landed; `fastify-l4.test.ts` holds the set EXACTLY, so a
 * new importer needs an entry here (with its reason) and an entry whose file stopped importing fastify must go.
 * Every file here is L4 by the ring rules (the 08-10 spec, "Deciding a file's ring and context"): the import is the
 * fact that puts it there. The aim is a shrinking list: a file below L4 that needs a request or a reply takes a
 * port instead (ARCH-05, #551).
 */
import type { EntrySet } from './exemptions.js';

export const FASTIFY_L4_ALLOWLIST: EntrySet = {
  'server/src/server.ts': { reason: 'the HTTP host: builds the Fastify instance, registers its plugins and the routes it serves itself', since: '2026-10-20' },
  'server/src/pwaStatic.ts': { reason: "the PWA's static-file options, typed by @fastify/static's own option type", since: '2026-10-20' },
  'server/src/refuse.ts': { reason: 'the thin route refusal: sends the refusal word at its status on a reply', since: '2026-10-20' },
  'server/src/auth/gate.ts': { reason: "the gate: one onRequest hook in front of every route", since: '2026-10-20' },
  'server/src/auth/stepup.ts': { reason: "step-up auth: reads the request's cookie and answers on the reply", since: '2026-10-20' },
  'server/src/accounts/gate.ts': { reason: "the accounts routes' gate: reads the request's session and answers on the reply", since: '2026-10-20' },
  'server/src/coord/routes.ts': { reason: "the coordination context's HTTP routes", since: '2026-10-20' },
  'server/src/docs/routes.ts': { reason: "the docs context's HTTP routes", since: '2026-10-20' },
  'server/src/docs/hooks.ts': { reason: "the docs plugin's request and response hooks (L4 by its header)", since: '2026-10-20' },
  'server/src/token/routes.ts': { reason: "the box token's HTTP routes", since: '2026-10-20' },
  'server/src/update/routes.ts': { reason: "the update control plane's HTTP routes", since: '2026-10-20' },
};
