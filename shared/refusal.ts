/**
 * Every refusal word a route answers in `error`, and the ONE status each one
 * is answered with (D-5381, audit ticket #547, ARCH-11a). L0: type imports, and `SWAP_REFUSALS` (D-5242: its three
 * codes key their rows below by the declaration, so no code is spelled a second time).
 *
 * `RouteRefusal` is the union of the refusal vocabularies the typed route
 * helpers already answered with — the claim door's (`ClaimRefusal`), the mail
 * ingress's (`MailRouteRefusal`, below), the update routes'
 * (`UpdateRouteError`) and the collect-lane door's (`CollectLaneRouteRefusal`,
 * below) — the swap route's (`SwapRefusal`, `SWAP_REFUSALS`: all three are 409s, D-5242 added `hibernated` and moved
 * the route's swap refusals onto `refuseRoute`) — plus `GenericRefusal`, every other word a route sends as a literal
 * `error`. `REFUSAL_STATUS` is a `Record` over that union, so a word with
 * no status, or a status for no word, is a compile error, and a word cannot
 * carry two statuses. The runtime list is derived from it (`ROUTE_REFUSALS`),
 * never hand-kept.
 *
 * The four typed helpers consult this table instead of taking a status:
 * `token/routes.ts`'s and `update/routes.ts`'s `refuse`, `coord/routes.ts`'s
 * mail `refuse` (which still calls `recordRejection` first: a mail refusal is a
 * recorded fact) and its `collectRefuse`, plus `refuseRoute`
 * (`server/src/refuse.ts`) for every other route.
 * `server/test/refusal-status.test.ts` scans every refusal send (`.code(S)` or
 * `.status(S)`, any `.header(…)` chain, an `ok: false` body in any key order)
 * and holds that each literal-status send with a literal `error` word answers
 * that word's status here, the measured splits below excepted and counted;
 * that each `GenericRefusal` is still sent somewhere; and that the counts of
 * literal-status and computed-status inline sends only fall. A send whose
 * status or word is computed is counted, not checked against the table.
 *
 * `registry-unmeasurable` answers the table's 502 everywhere (D-5971, #549,
 * ARCH-11b): `server.ts`'s eight sends answered 503 until then and now answer
 * through `refuseRoute`, and the scan holds that no send of the word uses
 * another status. Readers branch on the word, not the status.
 *
 * TWO MEASURED SPLITS, kept as they were:
 *   - `unauthenticated` answers 429 with verdict `locked-out` and a
 *     `retry-after` header from the three sign-in lockout sends in
 *     `server.ts`. The table's 401 is every other `unauthenticated`.
 *   - `bad-request` answers 413 from the claim route's error handler when
 *     Fastify refused an oversized body (spec 4.6 reshapes Fastify's own 413
 *     into the small claim body). That one send is `token/routes.ts`'s
 *     `refuseOversizedClaim`, not the table.
 */
import type { ClaimRefusal } from './box-token.js';
import type { AccountAuthRefusal, AccountGateRefusal, AccountRouteRefusal, AccountWriteRefusal, ApprovalRefusal, TestboxAdminRouteRefusal, ArchiveRefusal, CollectLaneRefusal, DigestRefusal, DoneRejectCode, MailRejectCode, QuestionDoorRefusal, RunRefuseCode, RunRouteRefuseCode, StepUpRefusal, SwapRefusal, UpdateRouteError } from './api.js';
import { ARCHIVE_REFUSALS, LEASE_DOOR_REFUSALS, SWAP_REFUSALS, type LeaseDoorRefusal } from './api.js';
import type { LinkingRefusal } from './linking.js';
import { DELEGATION_ADOPT_REFUSALS, type DelegationAdoptRefusal } from './delegation-adopt.js';
import type { DispatchAbandonRefusal } from './dispatch-abandon.js';
import type { RunCloseRefusal } from './run-close.js';
import type { LandingInfrastructureCode, LandingMutationCode } from './landingLine.js';
import type { ItemMoveRefusal } from './ledgers.js';

/**
 * The named workspace create's own words (named workspaces S5): decided by `planCreate` (`server/src/workspaceCreate.ts`,
 * L1) before any argv exists and sent by the route through `refuseRoute` with a computed word, so they are a typed
 * vocabulary of their own rather than `GenericRefusal`s, whose "still sent" scan reads only literal words at a send.
 */
export const WS_CREATE_REFUSALS = ['bad-project', 'name-too-long', 'bad-name', 'bad-wrapper', 'id-too-long'] as const;
export type WsCreateRefusal = (typeof WS_CREATE_REFUSALS)[number];

/**
 * The project add's words (`POST /api/projects`, add-project spec 2026-11-04 §4): `bad-source` is decided by
 * `planProjectAdd` (`server/src/projectAdd.ts`, L1) before any argv exists, `project-exists` is ccd's refusal read by
 * `classifyProjectAddFailure`, and `outcome-unknown` is that reader's answer for a runner that may have run ccd (its wait
 * expired, the link dropped), so the box may have added the project; the route sends all three through `refuseRoute`
 * with a computed word, so a typed vocabulary, like `WS_CREATE_REFUSALS`. `outcome-unknown` is the account routes' word
 * too (`ACCOUNT_ROUTE_REFUSALS`, `shared/api.ts`), with the same meaning and its ONE status row there (502): listed here
 * so every reader of this list (the sheet's sentences) answers it. It reuses `bad-request`, the create's `bad-project`
 * and `unsupported`.
 */
export const PROJECT_ADD_REFUSALS = ['bad-source', 'project-exists', 'outcome-unknown'] as const;
export type ProjectAddRefusal = (typeof PROJECT_ADD_REFUSALS)[number];

/**
 * The Linear proxy's own words (#1444, spec §6.8): the thirteen `/api/linear/proxy/*` routes (`linear/proxyRoutes.ts`)
 * answer them through `refuseRoute` with a computed word (the router's, the operation table's, a Linear answer's), so
 * they are a typed vocabulary of their own rather than `GenericRefusal`s, whose "still sent" scan reads only literal
 * words at a send. The words the proxy shares with older routes (`unauthenticated`, the attribution three,
 * `bad-request`, `not-found`, `not-configured`, `rate-limited`, `timeout`, `unreachable`, `malformed`,
 * `linear-unavailable`) keep their one row elsewhere in the table.
 */
export const LINEAR_PROXY_REFUSALS = [
  'bad-field', 'team-unknown', 'workspace-unknown', 'name-unknown', 'team-ambiguous', 'workspace-required', 'name-ambiguous',
  'issue-moved', 'policy-denied', 'policy-unavailable', 'journal-unavailable', 'linear-unauthorised', 'linear-forbidden',
  'linear-invalid',
] as const;
export type LinearProxyRefusal = (typeof LINEAR_PROXY_REFUSALS)[number];

/**
 * The workspace rename's own words (named workspaces S9, `POST /api/sessions/:id/title`), decided from ccd's refusal
 * sentences by `classifyTitleFailure` (`server/src/workspaceTitle.ts`, L1) and sent through `refuseRoute` with a
 * computed word, so a typed vocabulary of their own, like `WS_CREATE_REFUSALS`. The rename reuses the create's `bad-name`
 * and `name-too-long` for a name the grammar refuses, and the existing `bad-session-id`, `unknown-session`, `bad-request`
 * and `unsupported`; only what is new to it is listed here.
 */
export const WS_TITLE_REFUSALS = ['not-a-workspace', 'bad-title', 'title-not-saved'] as const;
export type WsTitleRefusal = (typeof WS_TITLE_REFUSALS)[number];

/** Why `bad-title`: the three rules ccd re-proves over a title the server already sanitised, so a refusal here means the
 *  two sanitisers disagree (an older or newer ccd), never a thing the operator typed past the field's own checks. */
export const BAD_TITLE_REASONS = ['blank', 'control-characters', 'too-long'] as const;
export type BadTitleReason = (typeof BAD_TITLE_REASONS)[number];

/** The mail codes a route answers in `error`. The done-authority codes travel
 *  as a run advance's `reject.code` and `undeliverable` is a delivery outcome;
 *  neither is an HTTP `error` word. */
export type MailRouteRefusal = Exclude<MailRejectCode, DoneRejectCode | 'undeliverable'>;

/** The collect-lane words `collectRefuse` answers. `confirm-required` and
 *  `confirm-stale` travel in a body that carries the effect and its key, never
 *  through the helper, so they are not route refusal words here. */
export type CollectLaneRouteRefusal = Exclude<CollectLaneRefusal, 'confirm-required' | 'confirm-stale'>;

/** Every word a route sends as a literal that none of the four vocabularies
 *  above holds. Eighteen of them were declared nowhere in `shared/` before
 *  D-5381; the others also belong to a narrower vocabulary of their own (the
 *  asks', the claims', the pools'), which this list does not replace. */
export const GENERIC_REFUSALS = [
  'application-failed', 'ask-mismatch', 'ask-unreadable', 'bad-account-id', 'bad-attachment', 'bad-path',
  'bad-pool-name', 'bad-session', 'bad-session-id', 'bad-transition', 'ceiling', 'child-unmeasurable',
  'claim-conflict', 'claim-terminal', 'claimant-changed', 'clip-unmeasurable', 'fable-operator-only', 'fleetFailed',
  'foreign-origin', 'gone', 'hetzner-error', 'incarnation-changed', 'internal', 'no-record',
  'no-session', 'no-such-passkey', 'not-found', 'not-held', 'not-owner', 'not-parent', 'not-ready', 'not-waiting',
  'not-remote', 'not-seeded', 'pool-mismatch', 'pool-unreadable', 'registry-unreadable', 'run-closed',
  'run-unreadable', 'runs-unreadable', 'sweep-stopped', 'too-large', 'unknown-ask', 'unknown-claim',
  'unknown-session', 'unmeasured', 'unrouteable-record', 'unsupported', 'unsupported-type',
  // The Linear routes (named workspaces S4 and S4b): the preview read's two and the connection routes' six.
  'bad-ref', 'ref-too-long', 'bad-key', 'key-rejected', 'key-forbidden', 'not-connected', 'unreachable', 'timeout', 'malformed',
  // The Linear routes with no rate service to ask (#1444, D-7684): nothing calls Linear.
  'linear-unavailable',
  // The Settings add (#1444, spec §10.1): the key's workspace already has a slot, and `replace` was not sent.
  'workspace-exists',
  // The named workspace create (named workspaces S5): ccd's three refusals, mapped by the route.
  'slug-taken', 'bad-slug', 'account-refused',
] as const;
export type GenericRefusal = (typeof GENERIC_REFUSALS)[number];

/**
 * The programme ledgers' coordinator routes' own words (plan PL3): a coordinator acting outside its programme, a spec pin
 * the Docs reader could not safely link, and an In short outside its bounds. Declared once, here, and spelled by the
 * routes through this table (the idiom of `SWAP_REFUSALS` and `ARCHIVE_REFUSALS`), so no code is spelled a second time
 * and the coord code-word census (`mail-routes.test.ts`) has no literal of theirs to find. An item move's four words
 * (`unknown-item`, `wrong-actor`, `not-open`, `programme-live`) are `shared/ledgers.ts`'s `ItemMoveRefusal`, below.
 */
export const LEDGER_ROUTE_REFUSALS = {
  notYourProgramme: 'not-your-programme', badSpecPath: 'bad-spec-path', badInShort: 'bad-in-short',
  // The operator's routes (plan PL4): a tick when the programme has no open run (`programme-ended`: dismiss the item), when its
  // only open run has no claimant (`programme-unclaimed`: abandon that run, a dismiss is refused `programme-live`), and a tick of
  // a secret item (`use-secret-route`: the value goes to its own route, never the tick).
  programmeEnded: 'programme-ended', programmeUnclaimed: 'programme-unclaimed', useSecretRoute: 'use-secret-route',
  // …and the tick's mail past the mail body cap (review 1335 F6): the generic `too-large` word, 413, its status declared with the generic ones.
  tooLarge: 'too-large',
  // The secret's own route (plan PL6): an item that is not a secret item (`not-a-secret-item`), and a stored programme or slot
  // name that fails its shape when the route re-checks both before building any path (`bad-slot`).
  notSecretItem: 'not-a-secret-item', badSlot: 'bad-slot',
  // …and every failure AFTER the value is in its slot (review 1389 F3): the value is stored, the item is not ticked.
  storedNotTicked: 'stored-not-ticked',
  // The PL6 follow-up: a value carrying a line break (`secret-not-one-line`, programme item 8: one line is enough);
  // a slot's chain still held by an earlier act past its deadline (`slot-busy`, review 1391 A-3); and the operator's
  // stored-secrets read and Remove door (programme item 9): a slot with no value stored (`secret-not-stored`), a store that
  // could not be read (`secrets-unreadable`, never folded into "no slots"), and a value file that could not be removed
  // (`remove-failed`).
  secretNotOneLine: 'secret-not-one-line', slotBusy: 'slot-busy',
  secretNotStored: 'secret-not-stored', secretsUnreadable: 'secrets-unreadable', removeFailed: 'remove-failed',
  // The secret's PUT, a programme or slot name that case-folds to a stored entry spelled differently (review 1416 F3): on a
  // case-insensitive filesystem the two are one directory or file, so it is refused before any write, on every platform.
  secretNameCollides: 'secret-name-collides',
  // The raise route (desktop-polish PL10, D-7952; spec D28): an item whose text links a document through an artifact page or a
  // document server outside the console (`outsideDocLink`, shared/ledgers.ts). A document link is its repository path.
  outsideDocLink: 'outside-doc-link',
  // The definition of done (D-8126): a list that is not 1 to 12 strings of 1 to 2,000 characters (`bad-done-when`), and a
  // modification that carries a list with neither a `ruling` nor an `itemId` to stand on (`done-when-needs-ruling`).
  badDoneWhen: 'bad-done-when', doneWhenNeedsRuling: 'done-when-needs-ruling',
  // The Seen door (D-8126): a call that is not a big one has nothing to be Seen.
  notBig: 'not-big',
} as const;
export type LedgerRouteRefusal = (typeof LEDGER_ROUTE_REFUSALS)[keyof typeof LEDGER_ROUTE_REFUSALS];

/**
 * The coordinator's review-rounds door (D-8125), `POST /api/runs/:id/review-rounds`, in `LEDGER_ROUTE_REFUSALS`' idiom: an
 * object of literals the route and the census read. `run-closed`, `not-found`, `bad-request`, `not-your-programme`,
 * `run-unreadable` and `not-configured` are reused words, declared with their own tables.
 */
export const REVIEW_ROUNDS_REFUSALS = { capNotReached: 'cap-not-reached' } as const;
export type ReviewRoundsRefusal = (typeof REVIEW_ROUNDS_REFUSALS)[keyof typeof REVIEW_ROUNDS_REFUSALS];
const REVIEW_ROUNDS_WORDS: ReadonlySet<string> = new Set(Object.values(REVIEW_ROUNDS_REFUSALS));
/** Whether `word` is one of the review-rounds door's own words (the mail-routes code census admits them through this). */
export const isReviewRoundsRefusal = (word: string): word is ReviewRoundsRefusal => REVIEW_ROUNDS_WORDS.has(word);
/** The end-request route's own words (D-8076; spec 2026-11-04 §10): a session that is not the run's claimant, its worker or a
 *  review run's worker (`not-yours`), a run that already has an open request (`already-asked`, the item named in `detail`),
 *  and the same asker again inside 24 hours of a decline or a withdraw (`recently-asked`). A closed run is the generic
 *  `run-closed`. Box-facing, so the console has no sentence for them. */
export const END_REQUEST_REFUSALS = { notYours: 'not-yours', alreadyAsked: 'already-asked', recentlyAsked: 'recently-asked' } as const;
export type EndRequestRefusal = (typeof END_REQUEST_REFUSALS)[keyof typeof END_REQUEST_REFUSALS];

/** The approval routes' own words (plan Task 16, D-5298): typed from the start, as D-5381 set out to make them. */
export type RouteRefusal = ClaimRefusal | MailRouteRefusal | UpdateRouteError | CollectLaneRouteRefusal | SwapRefusal | GenericRefusal
  | ApprovalRefusal | DigestRefusal | StepUpRefusal | AccountGateRefusal | WsCreateRefusal | WsTitleRefusal | ProjectAddRefusal
  | ArchiveRefusal
  // The coordinator's route door (D-6735, ARCH-20): `decideRoute` answers a `RunRouteRefuseCode`, sent through `refuseRoute`.
  | RunRouteRefuseCode
  // The question door family (W3 Q3f, D-7030): its one word of its own, `kind-mismatch`.
  | QuestionDoorRefusal
  // The dead-dispatch switch door (D-7319): its one word of its own, `state-unreadable`.
  | DispatchAbandonRefusal
  // The run-close switch door (D-8077, Task 26): its two words of its own, a lane held by a pause and a registry that would not list.
  | RunCloseRefusal
  // The programme ledgers' coordinator routes (plan PL3): an item move's four words, declared once in `ledgers.ts`.
  | ItemMoveRefusal | LedgerRouteRefusal
  // The coordinator's review-rounds door (D-8125): its two words of its own.
  | ReviewRoundsRefusal
  // The end-request route (D-8076): its three words of its own.
  | EndRequestRefusal
  // The lane routes, Check and the kill switch (accounts plan Task A14, D-7732): their four words of their own.
  | AccountRouteRefusal
  // The test box connect routes (D-8166): their one word of their own.
  | TestboxAdminRouteRefusal
  // The Linear proxy's routes (#1444, spec §6.8): their fourteen words of their own.
  | LinearProxyRefusal
  // The write routes (accounts plan Task A17, D-7739): their words of their own.
  | AccountWriteRefusal
  // The sign-in routes (accounts plan Task A21, D-7793): their nine words of their own.
  | AccountAuthRefusal
  // The landing line's guarded entrances (wave 5f): the infrastructure words and the mutation words, one closed family.
  | LandingInfrastructureCode | LandingMutationCode
  // The lease doors (delegation broker wave 5 PR8): their words and statuses are declared once, `api.ts#LEASE_DOOR_REFUSALS`.
  | LeaseDoorRefusal
  // The adoption switch's door (delegation broker wave 5 PR8b, D-8113): declared once, `delegation-adopt.ts#DELEGATION_ADOPT_REFUSALS`.
  | DelegationAdoptRefusal
  // The linking standard's words (D-8147): declared once, `linking.ts#LINKING_REFUSALS`, each with its status below.
  | LinkingRefusal;

/** The landing family's statuses, declared once (wave 5f, shared contract §5): every infrastructure word is 503, a
 *  missing thing 404, a refused graph or identity 409, an unreadable dependency 503. Spread into `REFUSAL_STATUS` and
 *  `ADVANCE_REJECT_STATUS`; chosen, not measured: new words. */
export const LANDING_REFUSAL_STATUS: Readonly<Record<LandingInfrastructureCode | LandingMutationCode, number>> = {
  'landing-journal-unavailable': 503, 'landing-journal-unreadable': 503, 'landing-journal-invalid': 503, 'landing-journal-missing': 503,
  'landing-journal-cursor': 503, 'landing-journal-changed': 503, 'landing-journal-durability': 503, 'landing-journal-append': 503,
  'landing-db-unavailable': 503, 'landing-db-apply': 503, 'landing-db-commit': 503, 'landing-fenced': 503,
  'landing-projection-unreadable': 503,
  'landing-entry-exists': 409, 'landing-entry-missing': 404, 'landing-after-missing': 409, 'landing-after-cross-project': 409,
  'landing-cycle': 409, 'landing-dependencies-unreadable': 503, 'landing-recovery-unresolved': 409, 'landing-identity-conflict': 409,
  'landing-id-overflow': 409, 'landing-sequence-overflow': 409,
};

/** Each route refusal word's one status (D-5381). Measured from the sends on
 *  landing day, never chosen: changing one is a behaviour change. */
export const REFUSAL_STATUS: Readonly<Record<RouteRefusal, number>> = {
  // The lease doors (delegation broker wave 5 PR8): spread FIRST, so a word the table below already holds keeps the table's status;
  // `lease-routes.test.ts` holds every lease door word's status equal to this table's. CHOSEN, not measured, for the new words.
  ...LEASE_DOOR_REFUSALS,
  // The adoption switch's door (D-8113): three new words, CHOSEN, each with its status in `DELEGATION_ADOPT_REFUSALS`.
  ...DELEGATION_ADOPT_REFUSALS,
  // The linking standard (D-8147): CHOSEN, not measured, new words. 400 for what the operator can retype (a team key or an
  // override the grammar refuses), 404 for a project the box does not know, 409 for a request the project's state refuses
  // now (the repository is public, nothing is measured yet, the template is there, no key is set, a tracker id or a
  // ticket slug would reach a public repository).
  'bad-team-key': 400, 'bad-override': 400, 'no-project': 404,
  'repo-public': 409, 'repo-unmeasured': 409, 'template-exists': 409, 'no-team-key': 409, 'tracker-id-public': 409,
  'ticket-slug-public': 409, 'override-private-public': 409,
  // 502: the template pull request's ccd act failed (a fetch, a push or a create), with ccd's stderr beside the word.
  'template-failed': 502,
  // 400
  'bad-request': 400, 'bad-tag': 400, 'bad-kind': 400, 'bad-account-id': 400, 'bad-attachment': 400,
  'bad-path': 400, 'bad-pool-name': 400, 'bad-session-id': 400,
  // 401, 403
  'unauthenticated': 401,
  'wrong-node': 403, 'unknown-sender': 403, 'stale-uuid': 403, 'foreign-origin': 403, 'not-owner': 403,
  'not-parent': 403, 'sign-in-unarmed': 403,
  // 404, 410
  'no-claim': 404, 'unknown-recipient': 404, 'unknown-run': 404, 'unknown-scope': 404, 'unknown-node': 404,
  'gone': 404, 'no-such-passkey': 404, 'not-found': 404, 'unknown-ask': 404, 'unknown-claim': 404,
  'unknown-session': 404,
  'code-expired': 410, 'code-used': 410,
  // 409
  'duplicate': 409, 'superseded': 409, 'busy': 409, 'auto-needs-rollback-gate': 409, 'no-channel': 409,
  'unknown-tag': 409, 'not-newer': 409, 'refused-by-node': 409, 'stamp-unread': 409, 'floor-unread': 409,
  'no-detach-cap': 409, 'no-rollback-cap': 409, 'agent-predates-update-op': 409, 'halted': 409,
  'no-bundle': 409, 'no-previous': 409, 'no-desired': 409,
  'ask-mismatch': 409, 'bad-session': 409, 'bad-transition': 409, 'ceiling': 409, 'child-unmeasurable': 409,
  'claim-conflict': 409, 'claim-terminal': 409, 'claimant-changed': 409, 'no-record': 409, 'no-session': 409,
  'not-held': 409, 'not-waiting': 409, 'not-remote': 409, 'not-seeded': 409, 'pool-mismatch': 409, 'run-closed': 409,
  'sweep-stopped': 409, 'floor': 409, 'no-effort-rungs': 409, 'unrouteable-record': 409, 'marker-still-controls': 409, 'conflict': 409,
  'incarnation-changed': 409, 'fable-operator-only': 409,
  [SWAP_REFUSALS.sessionBusy]: 409, [SWAP_REFUSALS.statusUnknown]: 409, [SWAP_REFUSALS.hibernated]: 409,
  // 413, 415, 429
  'oversize': 413, 'too-large': 413,
  'unsupported-type': 415,
  'rate-limited': 429, 'peer-quota': 429,
  // 500, 501, 502, 503
  'internal': 500,
  'not-configured': 501, 'unsupported': 501,
  'registry-unmeasurable': 502, 'clip-unmeasurable': 502, 'fleetFailed': 502, 'hetzner-error': 502,
  'unmeasured': 502,
  'unavailable': 503, 'journal-unreadable': 503, 'journal-unwritable': 503, 'ask-unreadable': 503,
  'pool-unreadable': 503, 'registry-unreadable': 503, 'run-unreadable': 503, 'runs-unreadable': 503,
  'state-unmeasurable': 503, 'write-failed': 503, 'application-failed': 503, 'not-ready': 503,
  // The approval routes (plan Task 16, D-5298): CHOSEN, not measured — new words. 404 for a row the caller cannot
  // name (another nonce reads as no row), 503 for a row that could not be read back, 409 for every other refusal,
  // the conflict status spec §6.3 names them with.
  'unknown-approval': 404, 'approval-unreadable': 503,
  'not-a-child': 409, 'approvals-disabled': 409, 'single-box': 409, 'deny-not-engaged': 409, 'digest-mismatch': 409,
  'version-unverified': 409, 'approval-released': 409, 'parent-changed': 409, 'guard-forbidden': 409,
  'guard-escalate': 409, 'declined': 409, 'hook-gone': 409, 'already-ruled': 409,
  // The digest routes (plan Task 17, D-5300): CHOSEN, not measured — new words, the approval routes' statuses.
  'not-coordinator': 409, 'digest-unreadable': 503, 'unknown-call': 404,
  // The step-up routes (D-5512, plan Task A5): CHOSEN, not measured — new words. 403 for a session that is signed
  // in and not fresh (never 401, which raises the login screen over a live session), 429 for a spent budget, 409
  // for the passphrase arm on a box with a passkey, and 501 for a dark gate, the status the other auth routes
  // answer dark (`not-configured`), which keeps them in the gate sweep's `FLAG_AWARE` set (D-5618).
  'step-up-required': 403, 'step-up-locked': 429, 'passkey-enrolled': 409, 'auth-off': 501,
  // The account gate (D-5511, D-5620, plan Task A7): CHOSEN, not measured — one new word. 403, the status `foreign-origin`
  // answers, and never 401: the credential is fine, the box's own origin is not, and a 401 with a verdict would raise
  // the PWA's login screen, which no passphrase could clear. Its other four words are defined above.
  'insecure-origin': 403,
  // The lane routes (accounts plan Task A14, D-7732): CHOSEN, not measured — new words. 409 for a lane the box's state
  // refuses to act on now (the lock held, the last placeable lane, a verb's own refusal: the request was well formed),
  // and 502 for an outcome the server could not learn, the status `fleetFailed` answers for a fleet that did not
  // answer, because the box may have acted and the cure is the re-read, never the caller's retry.
  'lane-busy': 409, 'last-enabled-home': 409, 'lane-act-refused': 409, 'testbox-admin-refused': 409, 'parity-required': 409, 'outcome-unknown': 502, 'check-unrecorded': 502,
  // The write routes (accounts plan Task A17, D-7739): CHOSEN, not measured — new words, on the lane routes' rule. 400
  // for what the operator can retype (a secret's bytes, the typed confirm, the stated account), 409 for a lane the box's
  // state refuses to act on now, and 503 for a provider that did not answer the probe (`unreachable`'s status: a retry
  // may help, and nothing was saved).
  'key-charset': 400, 'confirm-mismatch': 400, 'bad-stated': 400,
  'not-discardable': 409, 'lane-exists': 409, 'config-dir-exists': 409, 'live-sessions': 409, 'sleeping-sessions': 409,
  'upstream': 409, 'last-home-able': 409, 'auth-in-progress': 409, 'not-a-token-lane': 409, 'duplicate-id': 409,
  'token-unverified': 503,
  // The sign-in routes (accounts plan Task A21, D-7793): CHOSEN, not measured — new words, on the write routes' rule. 400
  // for a code the operator can paste again, 403 for a session that did not start the attempt (never 401: it is signed
  // in), 409 for an attempt or a lane whose state refuses the act now, and 501 for a node that cannot run a sign-in at
  // all, the status `unsupported` answers.
  'bad-code': 400, 'not-your-attempt': 403,
  'code-already-sent': 409, 'no-auth-attempt': 409, 'auth-url-untrusted': 409, 'method-unmeasured': 409, 'node-changed': 409,
  'not-a-sign-in-lane': 409,
  'auth-unsupported-here': 501,
  // The Linear routes (named workspaces S4, S4b): CHOSEN, not measured — new words. 400 for what the caller sent
  // (a ref with no text or over its cap, a key the shape rule refuses, a key Linear rejected or forbade: all things the
  // operator can fix and none a fault of the box), 409 for a check with no usable stored key, and 503 for Linear
  // not answering, one word per arm (`timeout` and `malformed` are not folded into `unreachable`: a retry helps
  // the first and not the second).
  'bad-ref': 400, 'ref-too-long': 400, 'bad-key': 400, 'key-rejected': 400, 'key-forbidden': 400,
  'not-connected': 409,
  'unreachable': 503, 'timeout': 503, 'malformed': 503,
  // The Linear routes with no rate service (#1444, D-7684): CHOSEN — 503, the box's composition is missing a service
  // it needs, which is the box's fault and not the caller's, the status `unavailable` answers.
  'linear-unavailable': 503,
  // The Settings add (#1444, spec §10.1): the status the spec gives it — 409, the request was well-formed and the box's
  // state (a slot already holding the workspace) refused it, until the operator confirms the replace.
  'workspace-exists': 409,
  // The named workspace create (named workspaces S5): CHOSEN — 400 for a name, project or wrapper the operator can
  // retype, 409 for a slug already in use and an account ccd will not place this workspace on (the request was
  // well-formed; the box's state refused it). A missing ccd cap answers the existing `unsupported` (501).
  'bad-project': 400, 'name-too-long': 400, 'bad-name': 400, 'bad-wrapper': 400, 'bad-slug': 400,
  // `id-too-long`: the project plus the slug would pass ccd's id cap (`WS_ID_MAX`), which ccd refuses with nothing made.
  'id-too-long': 400,
  'slug-taken': 409, 'account-refused': 409,
  // The project add (add-project spec 2026-11-04 §4): CHOSEN, not measured. 400 for a repo the operator can retype (not a
  // GitHub repository in one of the accepted shapes), 409 for a name a directory under the projects root already holds
  // (the request was well-formed; the box's state refused it).
  'bad-source': 400, 'project-exists': 409,
  // The workspace rename (named workspaces S9): CHOSEN — `not-a-workspace` is 409, the request was well-formed and the
  // row's own state (a main checkout) refuses it; `bad-title` is 400, the one thing the operator can retype, though only
  // an older or newer ccd's sanitiser reaches it; `title-not-saved` is 502, the box could not write its registry fields,
  // which is the box's fault and not the operator's, and the one answer here whose cure is to try again.
  'not-a-workspace': 409, 'bad-title': 400, 'title-not-saved': 502,
  // The archive door (ARCH-36, #559): every one answered 409 from its own sends (`decideArchive`, `refusedAtStop`,
  // `archiveOutcome`) before the door answered through `refuseRoute`. `session-busy` and `status-unknown` are the swap
  // route's rows above (the same two words, D-5242), declared once.
  [ARCHIVE_REFUSALS.runOpen]: 409, [ARCHIVE_REFUSALS.coordinatorHasOpenRuns]: 409,
  [ARCHIVE_REFUSALS.programmePartlyEnded]: 409, [ARCHIVE_REFUSALS.worktreeGone]: 409,
  [ARCHIVE_REFUSALS.manifestUnbuildable]: 409,
  // D-8199: CHOSEN, not measured — a new word. 409, the request was well-formed and the heir's or the store's state
  // refused the move (the heir not live, not known, a worker elsewhere); nothing was stopped or archived.
  [ARCHIVE_REFUSALS.claimsNotMoved]: 409,
  // The question door family (W3 Q3f, D-7030): CHOSEN, not measured — a new word. 400: an id of the other principal's
  // kind, or a body kind that disagrees with the id's, is the caller's to fix, like a malformed body.
  'kind-mismatch': 400,
  // The dead-dispatch switch door (D-7319): CHOSEN, not measured — a new word. 503, the status the other `-unreadable`
  // words answer: the switch's one row could not be read, which is the box's fault and not the operator's.
  'state-unreadable': 503,
  // The run-close switch door (D-8077, Task 26): CHOSEN, not measured — new words. 409 for a pause the operator can lift, 503 for a registry
  // the box could not list, the status the other unreadable words answer.
  'coordination-paused': 409, 'registry-unread': 503,
  // The programme ledgers' coordinator routes (plan PL3): CHOSEN, not measured — new words. 403 for a coordinator acting
  // outside its programme (the family of `not-owner` and `not-parent`), 400 for what the caller sent (the spec path and
  // the In short copy), and an item move's four words from `shared/ledgers.ts`: 404 for an item that is not there, 409 for
  // an item that is not in a state the move starts from, for the wrong actor and for a programme still running.
  [LEDGER_ROUTE_REFUSALS.notYourProgramme]: 403, [LEDGER_ROUTE_REFUSALS.badSpecPath]: 400, [LEDGER_ROUTE_REFUSALS.badInShort]: 400,
  'unknown-item': 404, 'not-open': 409, 'wrong-actor': 409, 'programme-live': 409,
  // The operator's routes (plan PL4): CHOSEN, not measured. 409 for each: the item's programme is in a state the tick cannot
  // act in, or the item is of a kind whose door is another route; none is a fault in what the operator sent.
  [LEDGER_ROUTE_REFUSALS.programmeEnded]: 409, [LEDGER_ROUTE_REFUSALS.programmeUnclaimed]: 409, [LEDGER_ROUTE_REFUSALS.useSecretRoute]: 409,
  // The secret's route (plan PL6): CHOSEN, not measured. 409 for both: the item is of a kind this door does not take, or names a
  // slot this server will not build a path from; neither is a fault in the value the operator sent.
  [LEDGER_ROUTE_REFUSALS.notSecretItem]: 409, [LEDGER_ROUTE_REFUSALS.badSlot]: 409,
  // CHOSEN, not measured: 503, as `write-failed`. The box failed partway (a write, an fsync, the tick's transaction); the value
  // the operator sent is stored, and saving it again finishes the act.
  [LEDGER_ROUTE_REFUSALS.storedNotTicked]: 503,
  // The PL6 follow-up: CHOSEN, not measured. 400 for a value with a line break (what the operator sent, theirs to fix,
  // as `bad-request`); 404 for a slot with nothing stored (as `unknown-item`); 503 for a slot still busy, a store that could
  // not be read and a value file that could not be removed (the box's fault, as `write-failed` and the `-unreadable` words).
  [LEDGER_ROUTE_REFUSALS.secretNotOneLine]: 400, [LEDGER_ROUTE_REFUSALS.secretNotStored]: 404,
  [LEDGER_ROUTE_REFUSALS.slotBusy]: 503, [LEDGER_ROUTE_REFUSALS.secretsUnreadable]: 503, [LEDGER_ROUTE_REFUSALS.removeFailed]: 503,
  [LEDGER_ROUTE_REFUSALS.secretNameCollides]: 409,
  // Desktop-polish PL10 (D-7952): CHOSEN, not measured. 400: the item's text is what the coordinator sent, theirs to fix (it
  // writes the repository path instead), as `bad-spec-path`.
  [LEDGER_ROUTE_REFUSALS.outsideDocLink]: 400,
  // The end-request route (D-8076): CHOSEN, not measured. 403 for a session that is no party to the run (the family of
  // `not-owner`); 409 for a request already open and for one repeated inside the 24 hours (the family of `duplicate`).
  [END_REQUEST_REFUSALS.notYours]: 403, [END_REQUEST_REFUSALS.alreadyAsked]: 409, [END_REQUEST_REFUSALS.recentlyAsked]: 409,
  // D-8126: CHOSEN, not measured. 400 for both: the coordinator sent a list of the wrong shape, or a change with nothing
  // to stand on; either is theirs to fix, as `bad-in-short`.
  [LEDGER_ROUTE_REFUSALS.badDoneWhen]: 400, [LEDGER_ROUTE_REFUSALS.doneWhenNeedsRuling]: 400,
  // The Seen door (D-8126): CHOSEN, not measured. 409 as `not-open`: the row is there, in a state this door does not act on.
  [LEDGER_ROUTE_REFUSALS.notBig]: 409,
  // The Linear proxy (#1444, spec §6.8): CHOSEN, not measured — new words, the statuses the spec's table gives them. 400
  // for a body or query field the caller can fix; 404 for a team, a workspace or a name no slot or directory holds; 409
  // for a call that names more than one, or names an issue that now lives in another team; 403 for the policy point's
  // deny and Linear's own 403; 503 for a policy or a journal that could not answer, the box's fault; 502 for a stored key
  // Linear rejected (the box's key is bad, never the caller's request); 422 for an input Linear refused.
  'bad-field': 400,
  'team-unknown': 404, 'workspace-unknown': 404, 'name-unknown': 404,
  'team-ambiguous': 409, 'workspace-required': 409, 'name-ambiguous': 409, 'issue-moved': 409,
  'policy-denied': 403, 'linear-forbidden': 403,
  'policy-unavailable': 503, 'journal-unavailable': 503,
  'linear-unauthorised': 502,
  'linear-invalid': 422,
  // The coordinator's review-rounds door (D-8125): CHOSEN, not measured. 409: the run is not at its cap, which is not a fault in
  // what the coordinator sent. (The lift is always on, D-8165: there is no refusal for a box that turned it off.)
  [REVIEW_ROUNDS_REFUSALS.capNotReached]: 409,
  ...LANDING_REFUSAL_STATUS,
};

/** The runtime list, derived from the table (`PR_REASONS`'s idiom). */
export const ROUTE_REFUSALS = Object.keys(REFUSAL_STATUS) as RouteRefusal[];

/** The run refusals `POST /api/runs` answers in `refused` — a `RunRefuseCode`
 *  body key with its own field (`by`, `pr` or `detail`), never an `error` word,
 *  so they are not `RouteRefusal`s (D-5384, audit ticket ARCH-21). */
export type OpenRunConflict = Extract<RunRefuseCode,
  'project-mismatch' | 'home-mismatch' | 'claimant-is-a-worker' | 'workspace-spent' | 'spent-unmeasured'
  | 'claimed-by-another' | 'review-in-flight' | 'attribution-required' | 'not-a-child' | 'cap-review-rounds'>;

/** Each one's status (D-5384). Measured from the open route's inline sends on
 *  landing day — every one answered 409 — never chosen. */
export const RUN_REFUSAL_STATUS: Readonly<Record<OpenRunConflict, number>> = {
  'project-mismatch': 409, 'home-mismatch': 409, 'claimant-is-a-worker': 409,
  'workspace-spent': 409, 'spent-unmeasured': 409, 'claimed-by-another': 409, 'review-in-flight': 409,
  // D-5298 (coordinator-first Task 11b, spec §6.4): chosen, not measured — new
  // words, both 409 as the spec names them, the family's conflict status.
  'attribution-required': 409, 'not-a-child': 409,
  // D-6795: chosen, not measured — a new word, 409 like its family.
  'cap-review-rounds': 409,
};

/** The `reject.code` words `POST /api/runs/:id/advance` answers (D-6733, audit ticket ARCH-33,
 *  GitHub #550). They travel in a `reject` object, never an `error` key, so they are neither `RouteRefusal`s nor
 *  `OpenRunConflict`s. `unknown-run` and `bad-session` are not `RunRefuseCode`s: the route sent them as bare literals. */
export type AdvanceRejectCode = 'unknown-run' | 'bad-session'
  | Extract<RunRefuseCode, 'bad-transition' | 'not-dispatched' | 'review-in-flight' | 'cap-concurrency' | 'ejection-not-merging'>
  // The landing line's closed code family (wave 5f): what `advanceLanding` answers when the line refuses or fails.
  | LandingInfrastructureCode | LandingMutationCode;

/** Each one's status, measured from the advance route's inline sends on landing day, never chosen: 404 for the one
 *  absent run, 409 for every refusal of a run that exists. */
export const ADVANCE_REJECT_STATUS: Readonly<Record<AdvanceRejectCode, number>> = {
  'unknown-run': 404, 'bad-transition': 409, 'not-dispatched': 409, 'review-in-flight': 409,
  'cap-concurrency': 409, 'bad-session': 409, 'ejection-not-merging': 409,   // D-7619: chosen, not measured — the family's 409
  ...LANDING_REFUSAL_STATUS,
};
