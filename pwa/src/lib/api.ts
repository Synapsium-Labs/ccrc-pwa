// Typed REST client for ccrc-server. All server state arrives over the two
// WebSocket streams; every WRITE goes through here. Each function throws
// ApiError { status, body } on non-2xx — callers branch on status/body
// (e.g. 409 { error: 'draft-present', draft } from prompt).
import type { AccountsResponse, AckAnswer, ApplyUpdateBody, CatalogueState, CatchUp, ClaimSummary, CollectLaneRequest, CollectLaneView, CoordCaps, CoordCapsView, FleetHealth, FleetSession, IntentWriteAnswer, LifecycleQueryResult, LoginRequest, MoveRequestAnswer, NotifyEvent, PaneHistoryReply, PasskeyAssertFinish, PasskeyAssertStart, PasskeyListResponse, PasskeyRegisterFinish, PasskeyRegisterStart, ProjectPoolWire, ProjectRow, PrView, ReapResult, ReviewCapLiftAnswer, ReviewCapView, RollbackUpdateBody, RouteField, RunSpend, RunSummary, SlashCommand, StagedClip, StallWatchRequest, StallWatchView, StepUpAnswer, StepUpStart, UpdatesView, WsAudit } from '../../../shared/api';
import type { ArchiveAnswer, DialogAnswered, DialogTabRequest, DigestAnswer, DigestCorrectAnswer, DigestCorrectBody, InterruptRouteSource } from '../../../shared/api';
import type { LinearConnectionView } from '../../../shared/linear';
import type { RotateAnswer } from '../../../shared/box-token';
import type { ResolveRead } from '../fleet/workspaceNameWords';
import { raiseAuthLostFrom } from './auth';
import { ApiError } from './apiError';
import { ANSWERED, answered, linearViewOf, rotateRefusalOf, readRotateStarted, linearNotConnectedOf, readResolve, readWorkspaceAdd, readWorkspaceTitle, archiveBody, workspaceAddBody, type ArchiveOptions, type UpdateIntentRequest, type WorkspaceAddAnswer, type WorkspaceAddOptions, type WorkspaceTitleAnswer, type WorkspaceTitleChange } from './wireReaders';
import { TOKEN_ROTATE_PATH } from '../../../shared/box-token';
import {
  DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, contentClass, docsApi, type DocsFileResponse, type DocsProjectsResponse,
  type DocsRefreshResponse, type DocsTreeResponse,
} from '../../../shared/docs';
import {
  declaredRaster, docsAnswerFromError, readDocsEnvelope, readDocsRaster, type DocsAnswer, type DocsLoaders,
} from '../docs/failures';


// `ApiError` lives in `./apiError` (D-5897, ARCH-05), a leaf that imports nothing, so a pure word module can name
// it without loading this fetch adapter. Re-exported: every existing import, and every screen, keeps its line.
export { ApiError };
// The refusal tables and the readers left this file (ARCH-13b): re-exported, so no importer changes a line.
export * from './refusalWords';
export * from './wireReaders';


/** Origin-qualified on purpose: MessageBubble's `absolute()` turns a bare
 *  `/api/...` into `https:///api/...` (empty host), so a root-relative href
 *  would make every thumbnail tap dead. `/api/` is in navigateFallbackDenylist,
 *  so the SPA shell does not hijack it. */
export const clipUrl = (id: string, name: string): string =>
  new URL(`/api/sessions/${encodeURIComponent(id)}/clip/${encodeURIComponent(name)}`,
    location.origin).href;

/** Injectable for tests; defaults to the real global fetch. */
export function createApi(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    const res = await fetchImpl(path, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* non-JSON error body stays raw text */
      }
      // THE 401 BRANCH (Stage 3a, Task 7). One line, at the one funnel every
      // call in this file goes through, and it SIGNALS rather than decorating
      // the throw: `lib/auth.ts` explains why a rejection each caller must
      // separately catch could never raise exactly one login screen.
      //
      // The rejection below is UNCHANGED — same `ApiError`, same status, same
      // body. Callers await these promises to stop spinners, roll back
      // optimistic edits and release queues; swallowing the rejection (or
      // returning a promise that never settles) would leave the app half
      // committed behind the login screen. What is suppressed is the NOISE, not
      // the failure: `toast()` drops anything fired while the screen is up.
      if (res.status === 401) raiseAuthLostFrom(body);
      throw new ApiError(res.status, body, res.headers.get('content-type'));
    }
    return res;
  };

  const getJson = async <T>(path: string): Promise<T> =>
    (await request(path)).json() as Promise<T>;

  const postInit = (body?: unknown): RequestInit =>
    body === undefined
      ? { method: 'POST' }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        };

  const post = async (path: string, body?: unknown): Promise<void> => {
    await request(path, postInit(body));
  };

  /** `post`'s request, byte for byte, with its 2xx answer READ — for a door whose success carries a second outcome
   *  (the archive door's `archived:false`, workspace lifecycle §5.2). An answer that cannot be read resolves to
   *  `unreadable`, `postJsonOr`'s reasoning below: the exchange completed and answered 2xx. */
  const postRead = async <T>(path: string, unreadable: T, body?: unknown): Promise<T> =>
    (await (await request(path, postInit(body))).json().catch(() => unreadable)) as T;

  /** The init a JSON-answering POST sends, spelled ONCE for the two helpers
   *  below. `accept: application/json` on both arms, and no `content-type` at
   *  all when there is nothing to send — the byte-identical request every
   *  `postJson` caller has always made (`reclaimRun`'s own header pin measures
   *  exactly this pair, so a second copy of this shape would be a second thing
   *  to keep in step with it). */
  const jsonInit = (body?: unknown): RequestInit =>
    body === undefined
      ? { method: 'POST', headers: { accept: 'application/json' } }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
        };

  /** A POST whose RESPONSE is JSON — the passkey ceremonies' shape, where `post`
   *  (which resolves to `void`) would throw the answer away. Same funnel, so a
   *  401 still raises the one login screen. */
  const postJson = async <T>(path: string, body?: unknown): Promise<T> =>
    (await request(path, jsonInit(body))).json() as Promise<T>;

  /** `postJson`'s DEGRADING twin (wave-5 review, MINOR 7, D-1150): the same
   *  send, the same funnel, but an answer that cannot be READ resolves to
   *  `unreadable` instead of rejecting.
   *
   *  THE RESPONSE IS IN HAND BEFORE THE PARSE, and that ordering is the whole
   *  design rather than an accident of expression. By the time `.json()` is
   *  attempted, `request` has already established that the exchange completed
   *  and answered 2xx — so "the answer came back unreadable" is a measured,
   *  separate condition from "the request never happened". A `.catch` wrapped
   *  around `postJson` instead cannot separate them: a connection dropped
   *  before the request left, and a payload truncated after a 200, both arrive
   *  as a TypeError, and folding those together would tell a caller its write
   *  landed when nothing was ever sent. Non-2xx still rejects through the same
   *  funnel, 401 included, so the one login screen still rises.
   *
   *  NOT a default on `postJson` itself, and not an optional argument to it:
   *  the passkey ceremonies and `reclaimRun` all read fields off their answers,
   *  where a silent `{}` is an overloaded null at the seam. Only a caller that
   *  can state a SAFE reading of "no answer" may have this, and it states that
   *  reading in the call. */
  const postJsonOr = async <T>(path: string, unreadable: T, body?: unknown): Promise<T> =>
    (await (await request(path, jsonInit(body))).json().catch(() => unreadable)) as T;

  const sid = (id: string): string => `/api/sessions/${encodeURIComponent(id)}`;

  return {
    /**
     * `POST /api/auth/login` — the ONE write that is made while the gate is
     * refusing everything else (`server/src/auth/gate.ts`'s EXEMPT table).
     *
     * Success is `204 No Content` plus `Set-Cookie`, and `shared/api.ts`
     * declares no `LoginResponse` to go with it: the cookie IS the response, so
     * this resolves to `void` and reads no body. NO SEND-SIDE CHANGE IS NEEDED
     * ANYWHERE — the cookie is same-origin and rides every later request (and
     * every websocket upgrade) automatically; it is `HttpOnly`, so this client
     * never sees it and could not attach it by hand if it wanted to.
     *
     * Takes the whole `LoginRequest` rather than a bare string so the wire shape
     * is checked at the seam by the type its producer declares. The passphrase
     * travels in the BODY and nowhere else — never a query string, never a
     * header, both of which proxies routinely log.
     *
     * Its refusals reach the caller as ordinary `ApiError`s: 401 `wrong`/
     * `unconfigured`, and — note — 429 `locked-out`, which is NOT a 401 and so
     * never touches the funnel's signal at all. `LoginScreen` reads both off the
     * body it catches.
     */
    login: (req: LoginRequest): Promise<void> => post('/api/auth/login', req),

    /**
     * `POST /api/auth/logout` — end THIS session (D-145).
     *
     * It shipped with the server in Task 5 and had NO CALLER until now, which
     * made "sign out" a thing the box could do and the operator could not ask
     * for: the only routes back to a login screen were an empty cookie jar, a
     * `ccrc passwd` rotation, or waiting out a 30-day TTL. `api.ts` deliberately
     * shipped no `logout` at the time because nothing used it, and the gap was
     * only visible from the outside — writing the runbook is what found it.
     *
     * GATED, unlike `login`: only a logged-in caller may end a session, so an
     * already-dead session answers 401 and the funnel above raises the login
     * screen anyway. Both outcomes put the operator in the same place, which is
     * why the caller does not have to distinguish them.
     *
     * Resolves on 204. The `Set-Cookie` that expires the jar is the response —
     * there is no body, and this client could not clear an `HttpOnly` cookie by
     * hand if it wanted to. The LOCAL half (raising the signal so the login
     * screen mounts and both socket ladders park) belongs to the caller:
     * `lib/auth.ts`'s signal is a UI concern and this module is a wire client.
     */
    logout: (): Promise<void> => post('/api/auth/logout'),

    /**
     * THE FOUR PASSKEY CEREMONIES (Task 8). Wire shapes only — the WebAuthn
     * ceremony itself lives in `lib/passkey.ts`, which is the one module that
     * touches `navigator.credentials` and the one place base64url is spoken.
     *
     * The REGISTER pair requires a live session (the server gates it: enrolling
     * a key is something only someone already signed in may do). The ASSERT pair
     * does not, and cannot — it IS the login.
     *
     * `assertFinish` resolves on `204 + Set-Cookie`, exactly like `login`: the
     * cookie is the response, so there is no body to read and nothing for this
     * client to attach by hand (it is `HttpOnly`).
     */
    passkeyRegisterStart: (): Promise<PasskeyRegisterStart> =>
      postJson<PasskeyRegisterStart>('/api/auth/passkey/register/start'),
    passkeyRegisterFinish: (b: PasskeyRegisterFinish): Promise<void> =>
      post('/api/auth/passkey/register/finish', b),
    passkeyAssertStart: (): Promise<PasskeyAssertStart> =>
      postJson<PasskeyAssertStart>('/api/auth/passkey/assert/start'),
    passkeyAssertFinish: (b: PasskeyAssertFinish): Promise<void> =>
      post('/api/auth/passkey/assert/finish', b),

    /**
     * STEP-UP THAT KEEPS THE SESSION (D-5512, spec §3.2; accounts plan Tasks A5, A6). Wire shapes only: the
     * ceremony's browser half is `lib/passkey.ts`'s `assertStepUp`, and the step's state is `accounts/useStepUp.ts`.
     *
     * Unlike the login doors these mint nothing: no cookie, no new session, the same `generation`. Each 200 is the
     * requesting session's new `stepUpFreshUntil`. A refusal reaches the caller as an ordinary `ApiError` whose body
     * names the word (`step-up-required`, with `verdict: 'wrong'` on a failed proof, at 403 and never 401, so the
     * funnel above raises no login screen over a live session; `step-up-locked`; `passkey-enrolled`; `auth-off`).
     * The passphrase travels in the BODY only, as `login`'s does.
     */
    stepUpStart: (): Promise<StepUpStart> => postJson<StepUpStart>('/api/auth/step-up/start'),
    stepUpFinish: (b: PasskeyAssertFinish): Promise<StepUpAnswer> =>
      postJson<StepUpAnswer>('/api/auth/step-up/finish', b),
    stepUpPassphrase: (passphrase: string): Promise<StepUpAnswer> =>
      postJson<StepUpAnswer>('/api/auth/step-up/passphrase', { passphrase }),

    /**
     * The enrolment screen's two gated calls (Task 8 review, MF-2).
     *
     * `revokePasskey` is the control that was missing entirely: without it a lost
     * authenticator could not be un-enrolled, and the obvious workaround —
     * deleting `~/.ccrc/passkeys.json` — does NOT work on a running server,
     * because the store loads once at boot and the next accepted assertion
     * rewrites the file from memory, resurrecting the row.
     *
     * The id goes in the PATH, so it is `encodeURIComponent`'d: it is base64url,
     * whose alphabet (`A-Za-z0-9-_`) percent-encoding leaves untouched, so this
     * is the identity today — and it is written anyway, because "today's values
     * happen not to need escaping" is how a path-injection ships the day the id
     * format changes.
     */
    passkeys: (): Promise<PasskeyListResponse> => getJson<PasskeyListResponse>('/api/auth/passkeys'),
    revokePasskey: async (credentialIdB64url: string): Promise<void> => {
      await request(`/api/auth/passkey/${encodeURIComponent(credentialIdB64url)}`, { method: 'DELETE' });
    },

    fleet: () => getJson<{ sessions: FleetSession[]; stale?: boolean; downSince?: number | null }>('/api/fleet'),
    fleetHealth: () => getJson<FleetHealth>('/api/fleet/health'),
    rebootFleet: () => post('/api/fleet/reboot'),

    /** `GET /api/updates` — the control plane read (W2 Task 13): catalogue line,
     *  releases, live nodes, intent rows. `501 not-configured` on a box with no
     *  coordination database. Read through `useUpdatesView`, whose
     *  `asUpdatesView` treats a malformed answer as a failure — the generic
     *  here is the contract, not a proof. */
    updates: () => getJson<UpdatesView>('/api/updates'),
    /** `POST /api/updates/intent` — a PARTIAL over one scope (`UpdateIntentRequest`).
     *
     *  `postJsonOr`, not `postJson` (D-1150), for `setCoordCaps`'s reason: after
     *  an intent WRITE, "the answer could not be read" and "the request never
     *  happened" are different states — the first may well have stored the
     *  channel — so the screen says "unconfirmed" and re-polls rather than
     *  reporting a failure that may not have happened. A refusal still rejects
     *  with its `ApiError`, whose body (`nodes`, `field`, `detail`) the screen
     *  reads. */
    setUpdateIntent: (body: UpdateIntentRequest) =>
      postJsonOr<IntentWriteAnswer | 'unreadable'>('/api/updates/intent', 'unreadable', body),
    /** `POST /api/updates/refresh` — *Check now*. `postJson`: it stores no
     *  operator choice to be unconfirmed about — the answer IS the catalogue
     *  line the screen shows, and an unreadable one is a failed check, which
     *  the next 60 s poll heals. `429 rate-limited {retryAfterS}` inside the
     *  route's derived `REFRESH_MIN_INTERVAL_MS` of the last catalogue request
     *  (scheduled or tapped). */
    refreshUpdates: () => postJson<CatalogueState>('/api/updates/refresh'),
    /** `POST /api/updates/ack` — clears a node's failed/reverted state or an
     *  outstanding request. `postJsonOr`, the `setUpdateIntent` argument: an
     *  ack that answered unreadably may already have cleared the row. */
    ackUpdateNode: (nodeId: string) =>
      postJsonOr<AckAnswer | 'unreadable'>('/api/updates/ack', 'unreadable', { nodeId }),
    /** `POST /api/updates/apply` (programme wave 5) — move one node (`{nodeId}`) or
     *  every node the tag takes forward (`{all: true}`), to `tag` or, without one,
     *  to each node's resolved desired tag. The answer is a REQUEST written, never
     *  a move made: `202 {requested, skipped}`; the dispatcher moves the nodes one
     *  at a time and the inventory is where the result is read.
     *
     *  `postJsonOr`, the `setUpdateIntent` argument (D-1150): a 2xx whose body
     *  would not parse may still have written the request, so the move sheet
     *  says "requested, unconfirmed" and re-polls rather than reporting a refusal
     *  that did not happen. A refusal — `400`, `404`, a single node's `409`
     *  (the dispatcher's own predicate), `501` — still rejects with its
     *  `ApiError`, which `updateErrorText` reads code-first. */
    applyUpdate: (body: ApplyUpdateBody) =>
      postJsonOr<MoveRequestAnswer | 'unreadable'>('/api/updates/apply', 'unreadable', body),
    /** `POST /api/updates/rollback` (programme wave 5) — one node back to `to`, or
     *  without one to its `previousVersion`. Single-node by route: a fleet-wide
     *  rollback is one of these per node, in dispatch order (the move sheet's
     *  `sendMove`). `postJsonOr` for `applyUpdate`'s reason. */
    rollbackUpdate: (body: RollbackUpdateBody) =>
      postJsonOr<MoveRequestAnswer | 'unreadable'>('/api/updates/rollback', 'unreadable', body),

    /** `POST /api/token/rotate` — the card's "Rotate now" (box-token lifecycle wave 1, Task B6). Session-only
     *  route, no body. Its three refusals (409 `held`, 429 `rate-limited`, 501 `not-configured`) are ANSWERS the
     *  card renders in place, so they resolve as the `RotateAnswer` they carry; any other failure (a 401 included,
     *  which still raises the one login screen through `request`) rejects with its `ApiError`. `postJsonOr` for
     *  `setUpdateIntent`'s reason (D-1150): a 2xx that cannot be read may still have started a rotation. */
    rotateBoxToken: async (): Promise<RotateAnswer | 'unreadable'> => {
      let answer: unknown;
      try {
        answer = await postJsonOr<unknown>(TOKEN_ROTATE_PATH, 'unreadable');
      } catch (err) {
        const refusal = rotateRefusalOf(err);
        if (refusal !== null) return refusal;
        throw err;
      }
      return readRotateStarted(answer);
    },

    /** The Linear section's four calls (named workspaces S4b, design §5.1). Each answers the connection's state, or
     *  `'unreadable'` for a 2xx whose body is not one (the exchange completed, so a write may have landed: the
     *  section re-reads). A refusal rejects with its `ApiError`, whose body names the word (`bad-key`,
     *  `key-rejected`, `unreachable`, `step-up-required`…); `checkLinear` is the one exception, resolving the state
     *  a 409 `not-connected` carries, because that state IS its answer. The key is only ever in the PUT's body. */
    linearConnection: async (): Promise<LinearConnectionView | 'unreadable'> =>
      linearViewOf(await (await request('/api/linear/connection', { headers: { accept: 'application/json' } })).json().catch(() => null)),
    connectLinear: async (key: string): Promise<LinearConnectionView | 'unreadable'> =>
      linearViewOf(await (await request('/api/linear/connection', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ key }),
      })).json().catch(() => null)),
    checkLinear: async (): Promise<LinearConnectionView | 'unreadable'> => {
      try {
        return linearViewOf(await (await request('/api/linear/connection/check', jsonInit())).json().catch(() => null));
      } catch (err) {
        const state = linearNotConnectedOf(err);
        if (state !== null) return state;
        throw err;
      }
    },
    disconnectLinear: async (): Promise<LinearConnectionView | 'unreadable'> =>
      linearViewOf(await (await request('/api/linear/connection', { method: 'DELETE', headers: { accept: 'application/json' } })).json().catch(() => null)),

    // `AccountsResponse`, not a restatement of it: this shape used to be
    // hand-written here, in the handler and in the route test, and the roster
    // field added in Stage 2a is exactly the kind of addition that lands in two
    // of three copies. The generic is the contract now.
    accounts: () => getJson<AccountsResponse>('/api/accounts'),
    // `ProjectRow`, not a hand-written twin — the comment two lines up names
    // this exact failure mode, and F3's `readiness` is the field it predicted:
    // spelled inline here, this generic would have gone on declaring a shape
    // the server had already stopped sending (D-1028).
    /** `cls` appends `?class=` only when given (routing spec, slice 4, Task 6)
     *  — an ordinary fetch (the fleet screen, this sheet's own project list)
     *  asks nothing and gets the byte-identical class-blind answer; only a
     *  caller that means to forecast one class's placement sends it. */
    projects: async (cls?: string) => {
      const read = await getJson<{ roots: string[]; projects: ProjectRow[] }>(
        cls === undefined ? '/api/projects' : `/api/projects?class=${encodeURIComponent(cls)}`,
      );
      if (!Array.isArray(read?.projects)) throw new Error("The server's project list could not be read.");
      return read;
    },
    /** `crossPool` is STRIPPED unless it is literally `true`, so an ordinary
     *  start keeps the parsed request shape it sent before pools existed —
     *  no key an older server does not know, and a flag that only ever means
     *  "yes" never needs to travel saying "no". `route` rides the same rule:
     *  present only when the sheet's routing row set at least one field, so
     *  an ordinary start's body is unchanged from before that row existed. */
    createSession: ({ crossPool, route, ...rest }: {
      wrapper: string; project: string; workdir?: string; crossPool?: boolean;
      route?: Partial<Record<Extract<RouteField, 'class' | 'effort' | 'workflow'>, string>>;
    }) => post('/api/sessions', {
      ...rest,
      ...(crossPool === true ? { crossPool: true } : {}),
      ...(route !== undefined && Object.keys(route).length > 0 ? { route } : {}),
    }),
    ensure: (id: string) => post(`${sid(id)}/ensure`),
    /** `route` rides the body ONLY when given — the fleet screen's class
     *  chooser (routing spec, slice 5, Task 6) seeds it from whichever class
     *  is selected there, and an ordinary `+` (the chooser left on
     *  "Coordinator row") calls this with one argument, so its request body
     *  is byte-identical to every caller that predates this parameter.
     *
     *  `name` (named workspaces S7) rides only when it is non-blank after a trim, and `wrapper` only beside a name:
     *  the server ignores a wrapper without one, so sending it would be a field with no meaning. The 2xx is READ:
     *  a named create answers `{ok, id, slug, title}`. */
    workspaceAdd: async (project: string, opts: WorkspaceAddOptions = {}): Promise<WorkspaceAddAnswer> => {
      return readWorkspaceAdd(await postRead<unknown>(`/api/projects/${encodeURIComponent(project)}/workspaces`, null,
        workspaceAddBody(opts)));
    },
    /** `POST /api/sessions/:id/title` — rename an EXISTING workspace: the title only, the slug and branch never change
     *  (named workspaces S9). A title is sent trimmed; `{clear: true}` removes it. A refusal rejects with its `ApiError`
     *  (`workspaceRenameWords.ts` reads the word); a 2xx is READ, `'unreadable'` when this build cannot. */
    workspaceTitle: async (id: string, change: WorkspaceTitleChange): Promise<WorkspaceTitleAnswer> =>
      readWorkspaceTitle(await postRead<unknown>(`${sid(id)}/title`, null,
        'clear' in change ? { clear: true } : { title: change.title.trim() })),
    /** `GET /api/linear/resolve?ref=` — what a typed or pasted name would become, with Linear's real title when it
     *  can be asked (named workspaces S4/S7). Session-gated like every PWA read. A refusal (`bad-ref`,
     *  `ref-too-long`, a signed-out 401) rejects with its `ApiError`; a 2xx this build cannot read is `'unreadable'`,
     *  never a guess at a title. */
    linearResolve: async (ref: string): Promise<ResolveRead | 'unreadable'> =>
      readResolve(await (await request(`/api/linear/resolve?ref=${encodeURIComponent(ref)}`,
        { headers: { accept: 'application/json' } })).json().catch(() => null)) ?? 'unreadable',
    /** `POST /api/projects/:project/pool` — tag the project into an account
     *  pool, or clear it with an explicit `null`.
     *
     *  `postJson`, not `post`: the route answers the pool it RE-READ off the
     *  fleet box after the write, not the value that was requested, and that
     *  measured state is the only thing `PoolSheet` may render before the next
     *  `pools` frame settles it. The shape is spelled inline over the shared
     *  `ProjectPoolWire`, the same way `projects` above composes `ProjectRow`.
     *
     *  `warning: 'unknown-pool'` is a WARNING and not a refusal (ruling O4):
     *  this server's roster copy can lag the fleet's, so a pool no account
     *  here carries may still be about to gain one. */
    setProjectPool: (project: string, pool: string | null) =>
      postJson<{ ok: true; pool: ProjectPoolWire; warning?: 'unknown-pool' }>(
        `/api/projects/${encodeURIComponent(project)}/pool`, { pool }),
    /** `POST /api/pools/accounts/:id` (Task 7) — tag an account into a pool,
     *  or clear it with `pools: []`. Wave 1 is one pool per account, but the
     *  wire already carries an array (the server's own `one-pool-per-account`
     *  400 is the length gate, not this client).
     *
     *  Unlike `setProjectPool`, the reply does NOT echo the account's
     *  resulting tag — only the MEASURED epoch this write produced
     *  (`{ ok, epoch, raced?, warning? }`) — because the authority for an
     *  account's pool is `~/.ccrc/coord.db`'s `pool_edges`, re-read by
     *  `GET /api/pools/epoch`, not this route's own body. A caller that wants
     *  the resulting tag re-polls `GET /api/accounts`, the same route
     *  `AccountsScreen` already polls every 20s.
     *
     *  `warning: 'unknown-account'` is a WARNING and not a refusal, on
     *  `setProjectPool`'s exact terms: this box's roster copy can lag the
     *  fleet's, so an id no account here carries may still be about to gain
     *  one. */
    setAccountPools: (accountId: string, pools: string[]) =>
      postJson<{ ok: true; epoch: number; raced?: true; warning?: 'unknown-account' }>(
        `/api/pools/accounts/${encodeURIComponent(accountId)}`, { pools }),
    stop: (id: string) => post(`${sid(id)}/stop`),
    /** `{crossPool:true}` ONLY when it is true — `opts?.crossPool === false`
     *  and an absent `opts` both keep the ordinary `{wrapper}` request shape.
     *  Not a checkbox anywhere in the UI: it is what a
     *  pick made under `SwapSheet`'s "show other pools" disclosure sends, after
     *  a confirm sentence that names the crossing. `{interrupt:true}` the same way (D-5240): ONLY when it is true, sent
     *  only by `SwapSheet`'s "swap anyway", the second tap after the route answered `409 session-busy`. */
    swap: (id: string, wrapper: string, opts?: { crossPool?: boolean; interrupt?: boolean }) =>
      post(`${sid(id)}/swap`, {
        wrapper,
        ...(opts?.crossPool === true ? { crossPool: true } : {}),
        ...(opts?.interrupt === true ? { interrupt: true } : {}),
      }),
    /** The terminal drawer's scrollback — the pane's own history, read with
     *  `capture-pane`. `lines` is the server's number, echoed back: this side
     *  never names one, so there is nothing for the two to disagree about.
     *
     *  `scrollback`/`alternate`/`width` are ABSENT from an older server and
     *  from a pane that could not be measured, and absence is not zero: the
     *  drawer opens the history exactly as it always did when it cannot be
     *  told how much sits above the screen. A non-2xx rejects with `ApiError`,
     *  whose `.body` carries the route's own `{error, detail?}`. */
    paneHistory: (id: string) =>
      getJson<Extract<PaneHistoryReply, { ok: true }>>(`${sid(id)}/pane/history`),
    pr: (id: string) => getJson<PrView>(`${sid(id)}/pr`),
    prOpen: (id: string, b: { title: string; body: string; draft: boolean }) => post(`${sid(id)}/pr`, b),
    /** `{force:true}` ONLY when it is true — `opts?.force === false` and an
     *  absent `opts` both send the byte-identical unforced request the route
     *  has always taken (no `content-type`, no body). The force flag is not a
     *  checkbox anywhere in the UI: it is a SECOND tap, made after the
     *  operator has read the `409 run-open` refusal, because the refusal is
     *  the whole information. See `ArchiveConflictSheet`.
     *
     *  Workspace lifecycle §5.2 adds the two other consents on the same rule — each a second tap after the refusal it
     *  answers, each sent only when it is given: `interrupt` (after `session-busy`) and `programme: 'end'` (after
     *  `coordinator-has-open-runs`). Resolves to the door's answer (`archivePartial` reads it), or `null` when a 2xx
     *  carried nothing readable — an older server's `{ok:true}` with no `archived` reads as archived. */
    archive: (id: string, opts?: ArchiveOptions) =>
      postRead<ArchiveAnswer | null>(`${sid(id)}/archive`, null, archiveBody(opts)),
    restore: (id: string) => post(`${sid(id)}/restore`),
    /** `POST /forget` — registry-only removal of a dead non-workspace session.
     *  Every gate (not a workspace, not held, not alive) is ccd's, re-proven
     *  on the box; a refusal comes back as 502 stderr for the toast. */
    forget: (id: string) => post(`${sid(id)}/forget`),
    /** `POST /hold` — the server's own client-side mirror of ccd's refusal
     *  lives in `SessionActionsSheet` (`HOLD_EMPTY_REASON_TEXT`), so an empty
     *  reason never reaches this call; the server re-checks anyway (400
     *  `bad-request`) because a client is not a security boundary. */
    hold: (id: string, reason: string) => post(`${sid(id)}/hold`, { reason }),
    release: (id: string) => post(`${sid(id)}/release`),
    workspaceAudit: (id: string) => getJson<WsAudit>(`${sid(id)}/workspace/audit`),
    workspaceReap: async (id: string, expect: string): Promise<ReapResult> =>
      (await (await request(`${sid(id)}/workspace/reap`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expect }),
      })).json()) as ReapResult,
    prompt: (id: string, text: string, opts: { replaceDraft?: boolean; attachments?: string[]; resume?: boolean } = {}) =>
      post(`${sid(id)}/prompt`, {
        text,
        ...(opts.resume === true ? { resume: true } : {}),
        ...(opts.replaceDraft === undefined ? {} : { replaceDraft: opts.replaceDraft }),
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
      }),
    /** `POST /api/sessions/:id/route` — the model/effort pickers' write
     *  (routing spec 2026-09-14 §5.3, slice 4, Task 5). ONE field, ONE value:
     *  the picker taps a single control, and the record is the arbiter, never
     *  a slash command typed straight into the pane — see `prompt` above,
     *  which stays exactly that for the operator's own composer text. */
    route: (id: string, field: RouteField, value: string) => post(`${sid(id)}/route`, { field, value }),
    /** `POST /api/sessions/:id/kickoff` — queues the coordinator kickoff as
     *  DURABLE system mail instead of typing it into the pane (program-leverage
     *  wave 4). Deliberately adjacent to `prompt`, because the pair is the
     *  point: `prompt` is the operator's own keystrokes and stays exactly as it
     *  is; this is the machine's, and machines go through the idle-gated
     *  delivery lane like every wave brief since Build 4.
     *
     *  `{slug, title}`, never prose. The server composes the sentence from an
     *  L0 constant, which makes this route strictly NARROWER than `prompt` — it
     *  can queue a program kickoff and nothing else. `{runId, wave}` chooses
     *  WHICH sentence: absent is a program being STARTED, present is a wave-N
     *  revive of a run that is already open, and the two say opposite things
     *  about re-opening it. Absence-permits, so every wave-4 call site sends a
     *  byte-identical request; the server refuses a HALF pair with 400
     *  `bad-request`, a pairing this signature does not model.
     *
     *  IT READS THE ANSWER NOW (D-1133), and the paragraph this replaces argued
     *  it never should: "reading one here would ship a distinction nothing
     *  consumes." Wave 5 is the consumer that sentence said did not exist. On
     *  the START path both answers still mean "a kickoff is on its way"; on the
     *  REVIVE path "one was already waiting, unread" is the likelier answer and
     *  a different thing to tell the operator, so `ResumeSheet` renders them
     *  apart. Hence the `postJson` family (:301-303), whose own docstring names
     *  exactly what `post` was doing to this value — this method takes the
     *  degrading member of it, for the reason the next paragraph gives.
     *
     *  An absent `queued` reads TRUE — `abandonRun`'s degrade direction, for
     *  its reason. No deployed server can produce it; it covers a truncated or
     *  proxy-rewritten body, where claiming a kickoff was already waiting that
     *  never was is the unsafe half.
     *
     *  AND SO DOES AN UNREADABLE ONE (wave-5 review, MINOR 7, D-1150). The
     *  paragraph above shipped one edit ahead of the code that honours it:
     *  through plain `postJson` — `(await request(…)).json()`, no `.catch` — the
     *  parse THREW, so the sentence describing the degrade named the exact input
     *  that could not reach it. And it was a REGRESSION, not merely an
     *  unimplemented nicety: on `main` this method read no answer at all, so
     *  wave 5 turned a 200 that really did queue the kickoff into "nothing was
     *  sent, and it has no brief yet" on the sheet, above a retry that would
     *  queue a second one. `postJsonOr` above is the shape that makes the
     *  promise true; its docstring carries why the Response has to be in hand
     *  first — a failure to READ an answer is degradable, a request that never
     *  completed is not, and only that ordering can tell them apart. */
    kickoff: async (
      id: string, b: { slug: string; title: string; runId?: number; wave?: number },
    ): Promise<{ queued: boolean }> => {
      const answer = await postJsonOr<{ queued?: unknown }>(`${sid(id)}/kickoff`, {}, b);
      // The local is `answer` on purpose. This method's structural pin proves it
      // sends no prose key by scanning the whole method for the two words such a
      // payload would use, and a local named after either of them would blind it.
      // The pin is worth more than naming symmetry with `abandonRun` three doors
      // down — and it is also why the degrade is reached through a named helper
      // rather than spelled inline the way that door spells it (D-1150).
      return { queued: answer.queued !== false };
    },
    answerDialog: async (id: string, dialogId: string, optionIndex: number): Promise<DialogAnswered> =>
      answered(await postRead<unknown>(`${sid(id)}/dialog`, ANSWERED, { dialogId, optionIndex })),
    /** Answer an AskUserQuestion in your own words, through its free-text ("Type something.") row (D-5047). The server
     *  types `text` only once a capture proves the cursor on the empty row, and presses Enter only once a capture
     *  proves the row holds exactly `text`. It refuses 400 `bad-text` for a text it will not type (`isDialogText`,
     *  `shared/api.ts`), and 409 with a `DialogTextRefuseCode` otherwise. Typing changes the dialog's id, and a retry
     *  with the same text, under the id the stream then shows, submits text a refused attempt left in the row. */
    answerDialogText: async (id: string, dialogId: string, optionIndex: number, text: string): Promise<DialogAnswered> =>
      answered(await postRead<unknown>(`${sid(id)}/dialog/text`, ANSWERED, { dialogId, optionIndex, text })),
    /** Answer a multiSelect AskUserQuestion question (D-5048): `optionIndexes` are the printed digits of the boxes to
     *  leave ticked (`Dialog.multi`'s options), the whole set, never a toggle. The server sends a digit only for each
     *  box whose tick differs on the live pane, proves the ticks on a fresh capture, then commits with Tab and proves
     *  the screen moved on. It refuses 400 `bad-indexes` for a set it will not send (`isDialogMultiIndexes`,
     *  `shared/api.ts`: empty, repeated, or outside 1..9), and 409 with a `DialogMultiRefuseCode` otherwise. */
    answerDialogMulti: async (id: string, dialogId: string, optionIndexes: readonly number[]): Promise<DialogAnswered> =>
      answered(await postRead<unknown>(`${sid(id)}/dialog/multi`, ANSWERED, { dialogId, optionIndexes })),
    /** Move an AskUserQuestion's PANE to another tab (decision `ask-dialog-tab-route`): `prev`/`next` (the arrow keys),
     *  `submit` (the review), or question tab k with the tab the sheet believes is up as `from`. Arrows only, each step
     *  proved by the server. The 200 carries the screen the pane landed on as `next`, read like an answer's. */
    answerDialogTab: async (id: string, req: DialogTabRequest): Promise<DialogAnswered> =>
      answered(await postRead<unknown>(`${sid(id)}/dialog/tab`, ANSWERED, req)),
    /** Answer a hook-reported question by option index. `askKey` is minted
     *  server-side and carried verbatim: the server re-reads the CURRENT
     *  envelope and refuses unless the key still matches, so this can only ever
     *  answer the question the client was actually shown. */
    answerAsk: (id: string, askKey: string, optionIndexes: number[]) =>
      post(`${sid(id)}/ask`, { askKey, optionIndexes }),
    /** One verified Enter on a box that already holds text — the rescue for a
     *  send whose Enter the pane swallowed twice.
     *
     *  `expect` is the box row the failed send left behind (the server's own
     *  `draft`, carried back verbatim). The server re-reads the box and refuses
     *  `box-mismatch` unless it still reads exactly that, so this can only ever
     *  submit the message the bubble is showing — the same correspondence rule
     *  `answerAsk` applies with `askKey`. */
    submit: (id: string, expect: string) => post(`${sid(id)}/submit`, { expect }),
    catchUp: (epoch: string | null, seq: number) =>
      getJson<CatchUp>(`/api/notifications/catchup?epoch=${encodeURIComponent(epoch ?? '')}&seq=${seq}`),
    /** Cold start and cold deep links for `/runs`, since the `{type:'runs'}`
     *  frame only arrives after the socket is open.
     *
     *  `closed` defaults to `false` — matching the server's own default
     *  (`coord/routes.ts`'s `GET /api/runs`), a deliberate cold-start
     *  bandwidth choice — and reads the active set. Pass `true` for the
     *  archive view (`?closed=1`), the finished-runs half of the board that
     *  splits on `closedAt`. Without this parameter there is no way to reach
     *  a finished run from either of the client's two sources: the
     *  `{type:'runs'}` frame is active-only too (`CoordStore.runs`'s own
     *  default), so a caller that always omitted `closed` could never render
     *  one. */
    runs: (closed = false) =>
      getJson<{ runs: RunSummary[] }>(closed ? '/api/runs?closed=1' : '/api/runs'),
    /** `GET /api/runs/:id` (D-6799) - one run plus the `spend` its bound sessions
     *  have accrued per the usage sweep; `spend` is unmeasured, with a reason, when
     *  the sweep cannot say. */
    run: (id: number) => getJson<{ ok: true; run: RunSummary; spend: RunSpend }>(`/api/runs/${id}`),
    /** `POST /api/runs/:id/abandon` (spec §4.3, Task 12) — the operator's
     *  release valve for a wedged run, from the phone. The route (`server/src
     *  /coord/routes.ts:844`) reads NO body at all — `{intent:'abandon'}` is
     *  built server-side, so `archive` is not a field this call could even
     *  offer ("the phone can abandon; the phone can never archive" is
     *  structural on the server, and this client sends nothing that could
     *  smuggle it past that). Deliberately UNGATED, same reasoning as
     *  `coordPause` just above: no box token on this call.
     *
     *  It now RETURNS the resolution. `released:false` means the run closed
     *  but the WORKSPACE stayed claimed, because a sibling open run still
     *  names the session — the state the coordinator protocol deliberately
     *  creates by opening wave N+1 before closing wave N. An older server
     *  sends no such field, and absence reads TRUE: today's behaviour, no
     *  toast, the safe direction.
     *
     *  READ THE FIELD WITH ITS PRODUCER IN MIND (`CloseOutcome.released`,
     *  server/src/coord/close.ts): `false` is the negation of one fact, not
     *  one fact. On the ABANDON route it has two producers — a sibling
     *  re-hold, and a `planned` run with no session, which does no fleet act
     *  at all — and only the first is worth a sentence about another run.
     *  `AbandonSheet` separates them on the run's own `sessionId`. */
    abandonRun: async (id: number): Promise<{ released: boolean }> => {
      const res = await request(`/api/runs/${id}/abandon`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { released?: unknown };
      return { released: body.released !== false };
    },
    /** `POST /api/runs/:id/reclaim` — point a program's runs at a LIVING
     *  coordinator after the one they name has died. The wedge it opens is the
     *  one two readers create between them by answering the lowest-id
     *  `claimedBy` with no state predicate: while that name is a corpse, a
     *  second coordinator is refused at open time and `toId:'coordinator'` mail
     *  resolves to nobody at all.
     *
     *  UNGATED — no box token on this call — and NOT for `abandonRun`'s reason
     *  (:502-503), which is that the wedged session is still holding the key.
     *  Here the key-holder is the thing that DIED. A door whose only opener is
     *  the credential of a dead session is a door with no opener, which is
     *  where D-282 arrived from the other direction.
     *
     *  `claimedBy` is the only field it sends: the event trail's `causedBy` is
     *  a hardcoded literal on the server, so no body of this client's can
     *  attribute an operator act to somebody else.
     *
     *  `postJson`, because a render depends on `runIds` — the same test
     *  `abandonRun` passes and `kickoff` used to fail. Note that the
     *  `claimant-alive` 409 names its code in `refused`, not `error`, so
     *  `apiErrorText` cannot turn it into a sentence (D-1139); the sheet reads
     *  `err.body` itself, which is why `ResumeSheet` owns a status-first
     *  translator rather than borrowing this file's — and why it renders
     *  `detail`, the only thing telling `registry-unmeasurable`'s two
     *  producers apart. */
    reclaimRun: (id: number, claimedBy: string): Promise<{ program: string; runIds: number[]; from: string; to: string }> =>
      postJson<{ program: string; runIds: number[]; from: string; to: string }>(
        `/api/runs/${id}/reclaim`, { claimedBy }),
    /** The DURABLE feed. `catchUp` is the live tail and is volatile by
     *  construction (notifymark.ts advances the mark at receipt); this is the
     *  read that still has bodies after a deploy. */
    feed: (limit = 100) => getJson<{ events: NotifyEvent[] }>(`/api/feed?limit=${limit}`),
    /** `GET /api/lifecycle?session=<id>` — one session's past tense from the
     *  provenance mirror, oldest-first, `gaps` riding in the same answer (a
     *  timeline with a hole in it must say so, not hide it in a second call
     *  nobody makes). Cookie-authenticated from here; the same route takes
     *  the box token for a cookieless worker (Build 9 D16) — nothing this
     *  client needs to know about. */
    lifecycle: (session: string, limit?: number): Promise<LifecycleQueryResult> =>
      getJson<LifecycleQueryResult>(
        `/api/lifecycle?session=${encodeURIComponent(session)}` +
          (limit === undefined ? '' : `&limit=${limit}`)),
    /** `GET /api/claims` — the fleet's hot-file claims (Build 9 D12:
     *  ADVISORY, never enforcing — this client renders them and offers no
     *  way to release or break one; release is the holding session's own
     *  door, and the break door is the operator's, deliberately unnamed).
     *  `all` includes ended rows — "held by X until it died" is an answer,
     *  which is why a lapsed claim is a row and not a deletion. */
    claims: (opts?: { all?: boolean }): Promise<{ claims: ClaimSummary[] }> =>
      getJson<{ claims: ClaimSummary[] }>(
        opts?.all === true ? '/api/claims?all=1' : '/api/claims'),
    /** D-5237: `source` names the control that sent it (the keycap, the Escape key, a Deny); the server records it. */
    interrupt: (id: string, source: InterruptRouteSource) => post(`${sid(id)}/interrupt`, { source }),
    /** `POST /api/coord/pause` (spec §4.2) — request `{paused}`, response
     *  `{ok:true, requested}` on success (the field is `requested`, never
     *  `paused`: the route ran a verb, it did not read the marker back).
     *  `CoordBanner` ignores the response body entirely and waits for the
     *  next `{type:'coord'}` frame to confirm instead — the whole point of
     *  the toggle's own "not optimistic" rule (spec §4.2, `CoordBanner.tsx`).
     *  Ungated (no box token): the route is deliberately open, the same way
     *  every other same-origin PWA write is. */
    coordPause: (paused: boolean) => post('/api/coord/pause', { paused }),
    /** `POST /api/coord/reclaim-pause` (child-reclamation wave 4, spec §5.8) —
     *  the switch on automatic child reclamation. `state` is ccd's own on|off,
     *  passed through. Like `coordPause`, `ChildReclaimBanner` ignores the
     *  response and waits for the next `{type:'coord'}` frame's `reclaim` to
     *  confirm. No box token: an operator's same-origin write. */
    childReclaimPause: (state: 'on' | 'off') => post('/api/coord/reclaim-pause', { state }),
    /** `GET /api/coord/caps` — the two limits AND the two derived counts, in one
     *  shape and one round trip. They travel together because a cap without its
     *  usage is a number an operator cannot act on. 501 `not-configured` on a
     *  box with no coordination database, which `CapsControl` renders as
     *  nothing at all rather than as zeroes. */
    coordCaps: () => getJson<CoordCapsView>('/api/coord/caps'),
    /** `POST /api/coord/caps` — a PARTIAL; an omitted field keeps its stored
     *  value, so moving one dial cannot clobber the other with a stale reading.
     *  Session-gated when armed, open dark; NOT box-token (an operator dial is
     *  not a machine lane) and NOT one of the D-282 release valves — see the
     *  route's own docstring for both arguments (D-1240).
     *
     *  `postJsonOr`, not `postJson` (D-1150): after a caps WRITE, "the answer
     *  could not be read" and "the request never happened" are different states
     *  — the first may well have stored the value — and the control says
     *  "unconfirmed" for the one rather than reporting the other. The safe
     *  reading of "no answer" is stated here, at the call, as that helper's own
     *  docstring requires. */
    setCoordCaps: (next: Partial<CoordCaps>) =>
      postJsonOr<CoordCapsView | 'unreadable'>('/api/coord/caps', 'unreadable', next),
    /** `GET /api/coord/review-cap/:id` (D-6910): a work run's review-cap ask, composed by the refusal's own helper, with
     *  when it was raised and lifted. `LiftCapSheet` reads it on open. Session-gated when armed; no box token. */
    reviewCap: (run: number) => getJson<ReviewCapView>(`/api/coord/review-cap/${run}`),
    /** `POST /api/coord/review-cap` (D-6795): the operator lifts the cap for one work run, exactly `{ run }`. Idempotent:
     *  a second lift answers 200. `postJson`, so a refusal (404 not a work run, 400 a bad id) rejects with `ApiError`,
     *  which the sheet says in words. Session-gated when armed; no box token. */
    liftReviewCap: (run: number) =>
      postJson<ReviewCapLiftAnswer>('/api/coord/review-cap', { run }),
    /** `GET /api/coord/stall-watch` (stall watch settings, design 2026-10-05 §10, §13): the Settings page's Stall
     *  watch section reads it through `useStallWatchView`, whose `asStallWatchView` is the wire guard, so the type here
     *  is what the server promises, not what arrived. 501 `not-configured` on a box with no coordination database, and
     *  404 `not-found` from an older server that lacks the route; the hook reads both as not available on this server
     *  (departure `older-server-404-reads-not-configured` (D-4035)). */
    stallWatch: () => getJson<StallWatchView>('/api/coord/stall-watch'),
    /** `POST /api/coord/stall-watch`: a PARTIAL, carrying only the field the operator moved, and `confirm` only when
     *  it sends back the key a 409 `confirm-required` answered with. The server decides whether a write needs a
     *  confirm (departure `server-decides-the-confirm` (D-4033)), so a 409 rejects with `ApiError` like every non-2xx,
     *  and the section reads its body through `stallWriteRefusal`. Session-gated when armed, open dark; no box token.
     *
     *  `postJsonOr`, not `postJson`, for `setCoordCaps`' reason (D-1150): after a write, "the answer could not be
     *  read" may well have stored the value, and is not "the request never happened". */
    setStallWatch: (body: StallWatchRequest) =>
      postJsonOr<StallWatchView | 'unreadable'>('/api/coord/stall-watch', 'unreadable', body),
    /** `GET /api/coord/collect-lane` (path-identity spec 2026-10-12 §5.6, §5.7): the Settings page's Temp root
     *  collector section reads it through `useCollectLaneView`, whose `asCollectLaneView` (`fleet/collectLaneRead.ts`) is the wire guard, so the
     *  type here is what the server promises, not what arrived. `getJson`, as `stallWatch` is: a read changes
     *  nothing, so its failure is only a failure, which the hook classifies (404 and 501 through
     *  `settingsReadFailure`, a 503 `state-unmeasurable` as its own kind). Session-gated when armed, open dark; no
     *  box token. */
    collectLane: () => getJson<CollectLaneView>('/api/coord/collect-lane'),
    /** `POST /api/coord/collect-lane`: `{choice}`, plus `confirm` only as the key a 409 `confirm-required` or
     *  `confirm-stale` answered with. The server decides the confirm, so a 409 rejects with `ApiError` like every
     *  non-2xx, and the section reads its body through `collectLanePostRefusal`. Session-gated when armed, open dark,
     *  with `live` refused while sign-in is dark; no box token.
     *
     *  `postJsonOr`, not `postJson`, for `setCoordCaps`' reason, stated in `postJsonOr`'s own docstring: after a
     *  write, "the answer could not be read" may well have stored the choice, and is not "the request never
     *  happened". */
    setCollectLane: (body: CollectLaneRequest) =>
      postJsonOr<CollectLaneView | 'unreadable'>('/api/coord/collect-lane', 'unreadable', body),
    /** `GET /api/digest?day=` (coordinator-first routing spec §10, D-5300): the digest of what coordinators decided
     *  in the operator's name for one UTC day, or, with no day, the newest whose window has closed. The digest screen
     *  reads it through `asDigestAnswer`, the wire guard. Session-gated when armed; no box token. */
    digest: (day?: string) =>
      getJson<DigestAnswer>(day === undefined ? '/api/digest' : `/api/digest?day=${encodeURIComponent(day)}`),
    /** `POST /api/digest/correct` (D-5300): one line's correction, mailed verbatim to that line's coordinator. A 409
     *  (`not-coordinator`, `duplicate`) rejects with `ApiError` like every non-2xx. `postJson`, not `postJsonOr`: the
     *  screen reads nothing off the answer but its arrival, and a write whose answer was unreadable is shown as sent
     *  only after the next read of the digest says `corrected`. */
    correctDigest: (body: DigestCorrectBody) => postJson<DigestCorrectAnswer>('/api/digest/correct', body),
    commands: (id: string) =>
      getJson<{ builtins: SlashCommand[]; skills: SlashCommand[] }>(`${sid(id)}/commands`),
    upload: async (id: string, file: File): Promise<StagedClip> => {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await request(`${sid(id)}/upload`, { method: 'POST', body: form });
      return ((await res.json()) as { clip: StagedClip }).clip;
    },
    /**
     * The Docs reader's loaders (spec 2026-10-01 4.3, 5.4): `DocsScreen`'s default `DocsLoaders`. Every call goes
     * through `request`, so a 401 still raises the one login overlay, and carries the marker header through
     * `DOCS_REQUEST_HEADER`/`DOCS_REQUEST_HEADER_VALUE` to the URL L0's `docsApi` builds. Each resolves a union and
     * never rejects for a server answer (`docs/failures.ts`): it rejects only when the caller's signal aborts, or for
     * a defect. `file` and `raster` refuse each other's paths by throwing `wrong-representation` before any request.
     */
    docs: ((): DocsLoaders => {
      const marker = { [DOCS_REQUEST_HEADER]: DOCS_REQUEST_HEADER_VALUE };
      const read = async <T>(path: string, fields: readonly string[], init: RequestInit): Promise<DocsAnswer<T>> => {
        try {
          return await readDocsEnvelope<T>(await request(path, init), fields);
        } catch (err) {
          // `request` folds an unreadable error body to '' and throws ApiError, so an abort mid-body arrives as one.
          if (init.signal?.aborted) throw init.signal.reason;
          return docsAnswerFromError(err);
        }
      };
      return {
        projects: () => read<DocsProjectsResponse>(docsApi.projects(), ['index'], { headers: marker }),
        tree: (project, ref) =>
          read<DocsTreeResponse>(docsApi.tree(project, ref), ['tree', 'refreshDue'], { headers: marker }),
        file: (project, pin, signal) => {
          if (contentClass(pin.path) === 'raster') throw new Error('wrong-representation');
          return read<DocsFileResponse>(docsApi.file(project, pin), ['contentClass', 'show'], { headers: marker, signal });
        },
        raster: (project, pin, signal) => {
          const declared = declaredRaster(pin.path);
          if (declared === null) throw new Error('wrong-representation');
          return (async () => {
            try {
              return await readDocsRaster(await request(docsApi.file(project, pin), { headers: marker, signal }), declared);
            } catch (err) {
              if (signal?.aborted) throw signal.reason;
              return docsAnswerFromError(err);
            }
          })();
        },
        refresh: (project, body) => read<DocsRefreshResponse>(docsApi.refresh(project), ['fetch', 'tree'], {
          method: 'POST',
          headers: { ...marker, 'content-type': 'application/json' },
          body: JSON.stringify({ ref: body.ref, reason: body.reason }),
        }),
      };
    })(),
  };
}

export type Api = ReturnType<typeof createApi>;

export const api: Api = createApi();
