// Typed REST client for ccrc-server. All server state arrives over the two
// WebSocket streams; every WRITE goes through here. Each function throws
// ApiError { status, body } on non-2xx — callers branch on status/body
// (e.g. 409 { error: 'draft-present', draft } from prompt).
import type { AccountsResponse, CatchUp, ClaimSummary, FleetHealth, FleetSession, LifecycleQueryResult, LoginRequest, NotifyEvent, PasskeyAssertFinish, PasskeyAssertStart, PasskeyListResponse, PasskeyRegisterFinish, PasskeyRegisterStart, PrView, ReapResult, RunSummary, SlashCommand, StagedClip, WsAudit } from '../../../shared/api';
import { raiseAuthLostFrom } from './auth';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const serverError =
      typeof body === 'object' && body !== null && 'error' in body
        && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : null;
    super(serverError ?? `request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Send failures the server names by code. Left raw these surfaced as bare
 *  slugs under the failed bubble ("dialog-open"), which says nothing about what
 *  to do next. `draft-present` is absent on purpose — it has its own sheet. */
const SEND_ERROR_TEXT: Record<string, string> = {
  'dialog-open': "Claude is asking a question — answer that first, then send.",
  // No longer "open the terminal to check": the text is verified sitting in the
  // box, the server knows it, and the failed bubble now carries a Send it
  // button that presses one more Enter. A sentence that sends the operator
  // somewhere else to do something the UI can do is the dead end this build set
  // out to close.
  'enter-ignored': "Typed it, but the session didn't take it.",
  // Replaced, not reworded. The old sentence ("The session never showed the
  // text — open the terminal to check.") went false twice in Build 8: the
  // ordinary path now REFUSES rather than clearing, so the text is still in
  // the box, and the box-scoped echo check makes this refusal fire more often.
  // A message that tells the operator to go somewhere else and do something
  // the UI can do is the dead end `enter-ignored`'s own copy was rewritten to
  // close; this is its neighbour, in the same register, and deliberately not
  // the same string — the two failures are different (nothing came back at
  // all, versus it came back and then would not go).
  'verify-failed': 'Typed it, but the session never echoed it back.',
  'draft-clear-failed': "Couldn't clear the existing draft — open the terminal.",
  'not-alive': 'That session is not running.',
};

export const sendErrorText = (code: string): string => SEND_ERROR_TEXT[code] ?? code;

/** `POST /submit`'s own refusals. Separate from SEND_ERROR_TEXT because they
 *  answer a different question — not "why didn't my message send" but "why
 *  didn't the rescue work".
 *
 *  Not one of them is good news, and `nothing-to-submit` used to be written as
 *  if it were ("it went through after all"). An empty box is not proof that
 *  this message was sent: the draft-conflict sheet's "Replace draft" empties
 *  the box with `C-u` and types a different message over it, so the operator
 *  could be told their text went through at the exact moment it was destroyed.
 *  The server proves the box is empty; only the transcript can say what left
 *  it. */
const SUBMIT_ERROR_TEXT: Record<string, string> = {
  'nothing-to-submit': 'The box is empty — nothing was sent from here. Check the transcript before sending again.',
  'blank-first-row': "The box's first line is blank, so what would be sent can't be proven — open the terminal.",
  'box-mismatch': 'The box holds something else now — open the session and look before sending.',
  'dialog-open': 'A question is up — answer that first.',
  'not-alive': 'That session is not running.',
  'enter-ignored': "Still not taking it — open the terminal.",
};

export const submitErrorText = (code: string): string => SUBMIT_ERROR_TEXT[code] ?? code;

/** Upload failures the server names by code. Same reason as SEND_ERROR_TEXT,
 *  sharper consequence: a failed chip's only affordance is retry, and for a 413
 *  retry can never succeed — so the chip has to say what went wrong, in words
 *  that imply what to do instead. */
const UPLOAD_ERROR_TEXT: Record<string, string> = {
  'too-large': 'That image is too large — 12 MB is the limit.',
  'unsupported-type': "Can't attach that — PNG, JPEG or WebP only.",
  'bad-request': "That upload didn't arrive — try attaching it again.",
  'unknown-session': 'That session is not running.',
  'bad-session-id': 'That session is not running.',
};

export const uploadErrorText = (code: string): string => UPLOAD_ERROR_TEXT[code] ?? code;

/** Origin-qualified on purpose: MessageBubble's `absolute()` turns a bare
 *  `/api/...` into `https:///api/...` (empty host), so a root-relative href
 *  would make every thumbnail tap dead. `/api/` is in navigateFallbackDenylist,
 *  so the SPA shell does not hijack it. */
export const clipUrl = (id: string, name: string): string =>
  new URL(`/api/sessions/${encodeURIComponent(id)}/clip/${encodeURIComponent(name)}`,
    location.origin).href;

/**
 * The one sentence for a fleet host whose `ccd` predates the verb being
 * called — for the LIFECYCLE routes (`archive`/`restore`/PR sweep) only.
 *
 * `PrKeycap.tsx`'s `REASON_TEXT.unsupported` already owned it — it is what the
 * cap says when the PR SWEEP hits the same skew. This is the definition and
 * that map imports it, rather than the two spelling the same fact differently:
 * the reader who sees the greyed cap and the reader who taps Archive are
 * looking at one condition on one box.
 *
 * NOT the COORDINATION surfaces' 501 text (`COORD_UNSUPPORTED_TEXT`, just
 * below — spec §4.2's own literal "the fleet host needs the newer ccd").
 * That IS a second spelling of the same fact — a deliberate one, not the
 * drift this docstring used to argue against: the spec quotes its own phrase
 * verbatim and `coord-banner.test.tsx` pins it, so editing THIS constant does
 * not change what the pause banner or the abandon sheet renders.
 *
 * TWO constants, THREE call sites, and this names all three (review M2, which
 * found the previous wording had reasoned about exactly this question and then
 * listed only two of them, missing the one the same wave shipped):
 *   1. lifecycle routes (`PrKeycap.tsx`'s `REASON_TEXT.unsupported`,
 *      `PrSheet`'s archive/restore toasts) → THIS constant;
 *   2. the pause banner (`CoordBanner.tsx`'s `inlinePauseError`) → and
 *   3. the abandon sheet (`AbandonSheet.tsx`'s `ABANDON_COPY.unsupported`)
 *      → both `COORD_UNSUPPORTED_TEXT`.
 * If a fourth route ever needs the same refusal, wire it to whichever of the
 * two its own spec/test actually names — neither is universal.
 */
export const UNSUPPORTED_VERB_TEXT =
  'The fleet host is running a ccd that does not have this verb yet.';

/**
 * The same fact as `UNSUPPORTED_VERB_TEXT`, in the COORDINATION surfaces'
 * words — spec §4.2's literal phrase, pinned verbatim by
 * `coord-banner.test.tsx` and `abandon-sheet.test.tsx`.
 *
 * It lives here rather than in either component because it has TWO renderers
 * and they are in different files: `CoordBanner`'s 501 arm and
 * `AbandonSheet`'s `ABANDON_COPY.unsupported` shipped it as two byte-identical
 * literals (review M2). One box, one skew, one sentence — a reader who taps
 * Pause and a reader who taps Abandon on the same stale host must not be told
 * two different things, and two literals is how that starts.
 *
 * Lower-case and un-terminated on purpose: both sites render it as inline
 * refusal copy inside their own surface, not as a standalone sentence the way
 * `UNSUPPORTED_VERB_TEXT` reaches a toast.
 */
export const COORD_UNSUPPORTED_TEXT = 'the fleet host needs the newer ccd';

/**
 * ccd's own refusal for an empty hold reason (`cmd_ws_hold`, `ccd/ccd`),
 * verbatim: "empty reason — say which program holds this". The server's
 * `/hold` route refuses the identical input before building any argv (400
 * `bad-request`, no reason text on the wire back), so the ONLY place this
 * sentence can come from for a same-session client-side refusal is this
 * constant — copied, not fetched, because refusing before a network round
 * trip is the whole point of catching it here. `SessionActionsSheet` is the
 * one caller; keeping the string here rather than inline keeps it beside
 * `UNSUPPORTED_VERB_TEXT`, this file's other copy of a truth that also lives
 * in ccd.
 */
export const HOLD_EMPTY_REASON_TEXT = 'empty reason — say which program holds this';

/**
 * Failures the LIFECYCLE routes name by CODE rather than by ccd's stderr. Same
 * reason as `SEND_ERROR_TEXT` and `UPLOAD_ERROR_TEXT` above: left raw these
 * reach a toast as a bare slug.
 *
 * svc's round-4 residual. `/archive` and `/restore` grew a `verbSupported` gate
 * that answers `501 { error: 'unsupported' }` — a 501 has no `stderr`, so
 * `apiErrorText` fell through to `err.message`, which `ApiError`'s constructor
 * sets from `body.error`, and `PrSheet`'s toast read "Archiving failed —
 * unsupported". That is a slug where the reader needs the one thing that tells
 * them the tap will never work until the box is updated.
 *
 * Deliberately keyed on `body.error`, not on the message: the code is what the
 * server states, and a message that merely happens to equal a code should not
 * be rewritten into a sentence about the host.
 */
const API_ERROR_TEXT: Record<string, string> = {
  unsupported: UNSUPPORTED_VERB_TEXT,
};

/** Human-readable failure text for a caught error.
 *
 *  Order matters and is unchanged at the top: lifecycle routes fail as
 *  502 { stderr } (ccd's own words, which are more specific than anything this
 *  module could say) — prefer that. A coded failure with no stderr is next.
 *  The bare message stays the floor. */
export function apiErrorText(err: unknown): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
    const stderr = (err.body as { stderr?: unknown }).stderr;
    if (typeof stderr === 'string' && stderr.trim().length > 0) return stderr.trim();
    const code = (err.body as { error?: unknown }).error;
    if (typeof code === 'string') {
      const text = API_ERROR_TEXT[code];
      if (text !== undefined) return text;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

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
      throw new ApiError(res.status, body);
    }
    return res;
  };

  const getJson = async <T>(path: string): Promise<T> =>
    (await request(path)).json() as Promise<T>;

  const post = async (path: string, body?: unknown): Promise<void> => {
    await request(
      path,
      body === undefined
        ? { method: 'POST' }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
  };

  /** A POST whose RESPONSE is JSON — the passkey ceremonies' shape, where `post`
   *  (which resolves to `void`) would throw the answer away. Same funnel, so a
   *  401 still raises the one login screen. */
  const postJson = async <T>(path: string, body?: unknown): Promise<T> =>
    (await request(
      path,
      body === undefined
        ? { method: 'POST', headers: { accept: 'application/json' } }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body),
          },
    )).json() as Promise<T>;

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
    // `AccountsResponse`, not a restatement of it: this shape used to be
    // hand-written here, in the handler and in the route test, and the roster
    // field added in Stage 2a is exactly the kind of addition that lands in two
    // of three copies. The generic is the contract now.
    accounts: () => getJson<AccountsResponse>('/api/accounts'),
    projects: () =>
      getJson<{ roots: string[]; projects: { name: string; workdir: string }[] }>('/api/projects'),
    createSession: (b: { wrapper: string; project: string; workdir?: string }) =>
      post('/api/sessions', b),
    ensure: (id: string) => post(`${sid(id)}/ensure`),
    /** `{name}` ONLY when the operator typed one — an absent or blank name
     *  sends the byte-identical bodyless request this route has always taken
     *  (no `content-type`, no body), which is `archive`'s idiom below and the
     *  reason the route's original tests stay green unchanged.
     *
     *  The name is sent RAW, not pre-slugified. The server derives the slug
     *  with the same function the sheet previews it with, so there is exactly
     *  one slug rule and the client cannot disagree with the box; and the raw
     *  text is what a Linear lookup needs. */
    workspaceAdd: (project: string, name?: string): Promise<void> =>
      post(`/api/projects/${encodeURIComponent(project)}/workspaces`,
        name !== undefined && name.trim() !== '' ? { name } : undefined),
    stop: (id: string) => post(`${sid(id)}/stop`),
    swap: (id: string, wrapper: string) => post(`${sid(id)}/swap`, { wrapper }),
    pr: (id: string) => getJson<PrView>(`${sid(id)}/pr`),
    prOpen: (id: string, b: { title: string; body: string; draft: boolean }) => post(`${sid(id)}/pr`, b),
    /** `{force:true}` ONLY when it is true — `opts?.force === false` and an
     *  absent `opts` both send the byte-identical unforced request the route
     *  has always taken (no `content-type`, no body). The force flag is not a
     *  checkbox anywhere in the UI: it is a SECOND tap, made after the
     *  operator has read the `409 run-open` refusal, because the refusal is
     *  the whole information. See `ArchiveConflictSheet`. */
    archive: (id: string, opts?: { force?: boolean }) =>
      post(`${sid(id)}/archive`, opts?.force === true ? { force: true } : undefined),
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
    prompt: (id: string, text: string, opts: { replaceDraft?: boolean; attachments?: string[] } = {}) =>
      post(`${sid(id)}/prompt`, {
        text,
        ...(opts.replaceDraft === undefined ? {} : { replaceDraft: opts.replaceDraft }),
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
      }),
    answerDialog: (id: string, dialogId: string, optionIndex: number) =>
      post(`${sid(id)}/dialog`, { dialogId, optionIndex }),
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
    interrupt: (id: string) => post(`${sid(id)}/interrupt`),
    /** `POST /api/coord/pause` (spec §4.2) — request `{paused}`, response
     *  `{ok:true, requested}` on success (the field is `requested`, never
     *  `paused`: the route ran a verb, it did not read the marker back).
     *  `CoordBanner` ignores the response body entirely and waits for the
     *  next `{type:'coord'}` frame to confirm instead — the whole point of
     *  the toggle's own "not optimistic" rule (spec §4.2, `CoordBanner.tsx`).
     *  Ungated (no box token): the route is deliberately open, the same way
     *  every other same-origin PWA write is. */
    coordPause: (paused: boolean) => post('/api/coord/pause', { paused }),
    commands: (id: string) =>
      getJson<{ builtins: SlashCommand[]; skills: SlashCommand[] }>(`${sid(id)}/commands`),
    upload: async (id: string, file: File): Promise<StagedClip> => {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await request(`${sid(id)}/upload`, { method: 'POST', body: form });
      return ((await res.json()) as { clip: StagedClip }).clip;
    },
  };
}

export type Api = ReturnType<typeof createApi>;

export const api: Api = createApi();
