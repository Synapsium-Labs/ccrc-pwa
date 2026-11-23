/**
 * D-6045 (Task C0l; ARCH-04 (#545), stage 1): the L4 files allowed to import `fastify` or an `@fastify/*` package,
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
  'server/src/archiveAct.ts': { reason: 'the archive door\'s acts: answers the plan\'s refusal and the stop and ws-archive outcomes on the route\'s reply', since: '2026-10-23' },
  'server/src/auth/gate.ts': { reason: "the gate: one onRequest hook in front of every route", since: '2026-10-20' },
  'server/src/auth/stepup.ts': { reason: "step-up auth: reads the request's cookie and answers on the reply", since: '2026-10-20' },
  'server/src/accounts/gate.ts': { reason: "the accounts routes' gate: reads the request's session and answers on the reply", since: '2026-10-20' },
  'server/src/accounts/routes.ts': { reason: "the accounts context's HTTP routes: Check and the kill switch (D-7732), and the write routes (D-7739)", since: '2026-11-01' },
  'server/src/coord/routes.ts': { reason: "the coordination context's HTTP routes", since: '2026-10-20' },
  'server/src/coord/ledgersRoutes.ts': { reason: "the programme ledgers' coordinator HTTP routes (PL3)", since: '2026-11-01' },
  'server/src/coord/reviewRoundsRoute.ts': { reason: "the coordinator's review-cap lift door (D-8125)", since: '2026-11-09' },
  'server/src/coord/planRoutes.ts': { reason: "the plan verbs' HTTP routes (Linear hierarchy, D-8181): put, show, met, ticket-add, ticket-move, epic-drop and close", since: '2026-11-10' },
  'server/src/coord/hierarchyRoutes.ts': { reason: "the per-project hierarchy settings' HTTP routes (Linear hierarchy, D-8181): a project's settings, the owner for all, and the read", since: '2026-11-10' },
  'server/src/coord/endRequest.ts': { reason: "the end-request route's handler (D-8076), a session's ask to the operator", since: '2026-11-08' },
  'server/src/coord/coordCallsRoute.ts': { reason: "the coordinator call record's HTTP route (D-8126)", since: '2026-11-09' },
  'server/src/coord/programmeRemainingRoute.ts': { reason: "the coordinator's remaining-work door (Overlord W2 remaining work A)", since: '2026-11-16' },
  'server/src/coord/decisionModelRoutes.ts': { reason: "the operator's decision-model doors: the read, arm, off, ceiling and the key's PUT and DELETE (Overlord W2, decision model B)", since: '2026-11-17' },
  'server/src/operatorModel/nameListRoutes.ts': { reason: "the private-name list's upload door and status read (Overlord W2, private names B)", since: '2026-11-17' },
  'server/src/continuity/quizRoutes.ts': { reason: "the replay quiz's record door and its rule door (Overlord W1a quiz record), and the weekly unattended run's confirm, status and Live doors (run 3212)", since: '2026-11-17' },
  'server/src/docs/routes.ts': { reason: "the docs context's HTTP routes", since: '2026-10-20' },
  'server/src/docs/hooks.ts': { reason: "the docs plugin's request and response hooks (L4 by its header)", since: '2026-10-20' },
  'server/src/token/routes.ts': { reason: "the box token's HTTP routes", since: '2026-10-20' },
  'server/src/linear/routes.ts': { reason: "the Linear connection's HTTP routes (the ticket-title preview read)", since: '2026-10-20' },
  'server/src/linear/proxyRoutes.ts': { reason: "the Linear proxy's box-token HTTP routes", since: '2026-11-02' },
  'server/src/linking/routes.ts': { reason: "the linking standard's HTTP routes: the operator's team key and override per project (D-8147)", since: '2026-11-09' },
  'server/src/continuity/routes.ts': { reason: "the continuity routes: the hook's start report, its loads report (the loads door, Overlord W1 sandbox Task 5), the door process's act-key claim (Overlord W1 door process A1), the hook's report door (Overlord W1 door process B1), the card door, the note door, the timer doors, the probe door (Overlord W1a, spec §3.3.11, §3.3.3, §3.3.2, §3.3.12, §3.3.5) and the renewal backstop's doors (Overlord W1 renewal readings A, R19)", since: '2026-11-13' },
  'server/src/testboxAdmin.ts': { reason: "the test box connect routes (D-8166): the status read and the act behind the account gate, with the TestboxAdminOps port they run", since: '2026-11-10' },
  'server/src/update/routes.ts': { reason: "the update control plane's HTTP routes", since: '2026-10-20' },
  'server/src/readerLab/routes.ts': { reason: "the reader lab door's counter hook and HTTP routes (the reader lab plan, Task 3)", since: '2026-11-04' },
  'server/src/face/routes.ts': { reason: "the character choice's two HTTP routes (the face plan, Task 6)", since: '2026-11-13' },
  'server/src/coord/overlordRoutes.ts': { reason: "the Overlord's designation doors (Overlord W1 designation A): the read, Start and retire", since: '2026-11-16' },
  'server/src/coord/overlordGateRun.ts': { reason: "the Overlord gate's runner: every Overlord door's one call, which refuses through the reply (Overlord W1 gates B, §11.2)", since: '2026-11-19' },
  'server/src/laneModelsRoutes.ts': { reason: "the Models sheet's write door, POST /api/models/:lane (revert of one class; model-class-advance R4)", since: '2026-11-18' },
  'server/src/coord/approvalCensusRoutes.ts': { reason: "the approval census's read, its one session-gated GET (approvals PR 1, Task 1.4)", since: '2026-11-18' },
  'server/src/coord/approvalParkDoor.ts': { reason: "the operator door's approval arm, its step-up ladder over the request and reply (approvals PR 3)", since: '2026-11-19' },
  'server/src/responses/routes.ts': { reason: 'the receipts door, POST /api/responses/receipts (Overlord W1 responses A)', since: '2026-11-16' },
};
