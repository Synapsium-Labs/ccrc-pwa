// Typed REST client for ccrc-server. All server state arrives over the two
// WebSocket streams; every WRITE goes through here. Each function throws
// ApiError { status, body } on non-2xx — callers branch on status/body
// (e.g. 409 { error: 'draft-present', draft } from prompt).
import type { AccountsResponse, AutomationLastFilter, AutomationRunSummary, AutomationState, AutomationStepWire, AutomationSummary, CatchUp, ClaimSummary, CoordCaps, CoordCapsView, FleetHealth, FleetSession, LifecycleQueryResult, LoginRequest, NotifyEvent, PasskeyAssertFinish, PasskeyAssertStart, PasskeyListResponse, PasskeyRegisterFinish, PasskeyRegisterStart, ProjectRow, PrView, ReapResult, RunSummary, SlashCommand, StagedClip, WsAudit } from '../../../shared/api';
import type { Cadence } from '../../../shared/schedule';
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
  // Two of the kickoff route's four codes (program-leverage wave 4). Without
  // these the operator reads a bare slug at the one moment the sheet has stopped
  // being able to retry for them — and a box with no `coord.db` is an ordinary,
  // silent state, not an error anybody has seen before.
  //
  // The other two — `unknown-session` and `bad-session-id` — are DELIBERATELY
  // absent, and the tree said so before this comment did: `uploadErrorText`
  // consumes THIS function's output as a KEY, so a code it owns must survive
  // `apiErrorText` unchanged or the upload translator gets a sentence to look up
  // and finds nothing. Adding `unknown-session` here reds
  // "does not shadow any code the UPLOAD translator owns", measured. The
  // start-program sheet says what it needs to about those two in its own
  // sentence, where the session id is in scope anyway.
  'not-configured': 'This box does not run coordination — there is no mail store to queue a kickoff into.',
  'registry-unmeasurable': 'The session registry could not be read, so this box cannot say whether that session exists.',
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

/**
 * `POST /api/sessions/:id/kickoff`'s own refusals (wave-4 review, MINOR 3,
 * D-1120). The fourth per-surface map in this file, composed exactly as
 * `useAttachImage.ts` composes the upload one: `kickoffErrorText(apiErrorText(err))`.
 *
 * WHY IT IS NOT MORE ENTRIES IN `API_ERROR_TEXT`. Three of the five codes that
 * route can answer with are OWNED by `uploadErrorText`, which consumes
 * `apiErrorText`'s OUTPUT as a KEY — so a sentence there hands the upload
 * translator a sentence to look up instead of a code, and its own upload
 * wording is lost. The suite says so in both directions, for all three
 * translators. Everything `API_ERROR_TEXT` already turns into a sentence passes
 * through here untouched, because a sentence matches no key.
 *
 * These are the sentences a phone shows above a retry button, so each says what
 * the box actually established and, where the answer is terminal, stops short of
 * implying a retry will help. `unknown-session` in particular used to reach the
 * operator as a bare slug inside a sentence that ALSO asserted the session was
 * running — the exact fact the registry had just denied.
 */
const KICKOFF_ERROR_TEXT: Record<string, string> = {
  'unknown-session': 'That session is no longer in the registry — nothing can be queued for it.',
  'bad-session-id': 'That session id is not one this box will accept.',
  'bad-request': 'The program name and title did not arrive with the request.',
  oversize: 'That program title is too long to send as mail — shorten it and start again.',
};

export const kickoffErrorText = (text: string): string => KICKOFF_ERROR_TEXT[text] ?? text;

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
    // `ProjectRow`, not a hand-written twin — the comment two lines up names
    // this exact failure mode, and F3's `readiness` is the field it predicted:
    // spelled inline here, this generic would have gone on declaring a shape
    // the server had already stopped sending (D-1028).
    projects: () => getJson<{ roots: string[]; projects: ProjectRow[] }>('/api/projects'),
    createSession: (b: { wrapper: string; project: string; workdir?: string }) =>
      post('/api/sessions', b),
    ensure: (id: string) => post(`${sid(id)}/ensure`),
    workspaceAdd: (project: string): Promise<void> =>
      post(`/api/projects/${encodeURIComponent(project)}/workspaces`),
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
    commands: (id: string) =>
      getJson<{ builtins: SlashCommand[]; skills: SlashCommand[] }>(`${sid(id)}/commands`),
    upload: async (id: string, file: File): Promise<StagedClip> => {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await request(`${sid(id)}/upload`, { method: 'POST', body: form });
      return ((await res.json()) as { clip: StagedClip }).clip;
    },

    // ── Task 11: the ten automations routes (spec §10, server/src/auto/routes.ts) ──
    //
    // Every write here throws `ApiError` on non-2xx, exactly like every other
    // write in this file: the automations screen reads `err.status`/`err.body`
    // (via `autoWords.ts`'s `automationErrorSentence`) rather than this client
    // pre-digesting the refusal, because the refusal vocabulary is closed and
    // typed one file over and a second copy of that translation here is the
    // drift `autoWords.ts`'s own header warns against.
    //
    // `GET /api/automations` — list, with the three query filters the route
    // itself parses (`state`/`project`/`last`, `last:'never-ran'` included —
    // spec §11 "Never ran is its own filter value because `lastFireAt IS
    // NULL` is its own fact"). Every param OMITTED rather than sent empty, so
    // an unfiltered read is byte-identical to the bare route.
    automations: (filter?: { state?: AutomationState; project?: string; last?: AutomationLastFilter }):
      Promise<{ automations: AutomationSummary[] }> => {
      const params = new URLSearchParams();
      if (filter?.state !== undefined) params.set('state', filter.state);
      if (filter?.project !== undefined && filter.project !== '') params.set('project', filter.project);
      if (filter?.last !== undefined) params.set('last', filter.last);
      const qs = params.toString();
      return getJson<{ automations: AutomationSummary[] }>(`/api/automations${qs === '' ? '' : `?${qs}`}`);
    },
    /** `POST /api/automations` — create, ALWAYS saved `paused` server-side
     *  (§7's arm gate): this call never carries a `state` field because the
     *  route does not read one. */
    createAutomation: (b: { name: string; project: string; prompt: string; cadence: Cadence; graceMs?: number }):
      Promise<{ automation: AutomationSummary }> =>
      postJson<{ automation: AutomationSummary }>('/api/automations', b),
    /** `GET /api/automations/:id` — one automation, with its recent runs
     *  (clamped to 20 server-side) — the detail panel's one read. */
    automation: (id: number): Promise<{ automation: AutomationSummary; runs: AutomationRunSummary[] }> =>
      getJson<{ automation: AutomationSummary; runs: AutomationRunSummary[] }>(`/api/automations/${id}`),
    /** `POST /api/automations/:id` — edit. Same body shape as create. */
    editAutomation: (id: number, b: { name: string; project: string; prompt: string; cadence: Cadence; graceMs?: number }):
      Promise<{ automation: AutomationSummary }> =>
      postJson<{ automation: AutomationSummary }>(`/api/automations/${id}`, b),
    /** `POST /api/automations/:id/arm` — the ONE door that moves
     *  `paused -> armed` (spec §7). No body: the route reads nothing off the
     *  request, only the stored row. Refuses `never-run-by-hand` (409) for an
     *  automation with no proven manual run yet. */
    armAutomation: (id: number): Promise<{ nextRunAt: number }> =>
      postJson<{ nextRunAt: number }>(`/api/automations/${id}/arm`),
    /** `POST /api/automations/:id/state` — pause | retire. `'armed'` is
     *  deliberately not a value this method can send: arming has exactly one
     *  door (`armAutomation` above), and the route itself answers `409
     *  bad-transition` for anything but the two live tokens. */
    setAutomationState: (id: number, state: 'paused' | 'retired'): Promise<{ state: AutomationState }> =>
      postJson<{ state: AutomationState }>(`/api/automations/${id}/state`, { state }),
    /** `POST /api/automations/:id/run` — *Run now*, D-280: reads NO body,
     *  same reason `abandonRun` reads none — every dangerous field
     *  (`project`/`prompt`/`trigger`) is a literal at the route's own call
     *  site, off the row the server already trusts. Answers `202 {runId}` on
     *  success (the parallel `server/src/auto/routes.ts` change this task's
     *  brief names: the tap returns immediately, the run's progress arrives
     *  over the `{type:'automations'}` frame or a re-fetch) or `409` with a
     *  refusal this client's caller renders through `automationErrorSentence`. */
    runAutomation: (id: number): Promise<{ runId: number }> =>
      postJson<{ runId: number }>(`/api/automations/${id}/run`),
    /** `GET /api/automations/:id/runs` — history, clamped to
     *  `AUTOMATION_RUN_RETENTION` server-side. Not the detail panel's
     *  primary read (`automation` above already embeds the same rows); this
     *  is for a caller that wants MORE than the embedded 20, or a narrower
     *  `limit`. */
    automationRuns: (id: number, limit?: number): Promise<{ runs: AutomationRunSummary[] }> =>
      getJson<{ runs: AutomationRunSummary[] }>(
        `/api/automations/${id}/runs${limit === undefined ? '' : `?limit=${limit}`}`),
    /** `GET /api/automations/runs/:runId` — one run and its step trail (spec
     *  §11's run detail: "the step trail in order, each with time, `ok`,
     *  detail, and a visible marker when `truncatedBytes > 0`"). */
    automationRun: (runId: number): Promise<{ run: AutomationRunSummary; steps: AutomationStepWire[] }> =>
      getJson<{ run: AutomationRunSummary; steps: AutomationStepWire[] }>(`/api/automations/runs/${runId}`),
    /** `POST /api/automations/pause` — the global kill switch, a SEPARATE
     *  marker from the coordinator's own `coordPause` above (spec §10: it is
     *  its own route, not a second consumer of `/api/coord/pause`). */
    automationsPause: (paused: boolean): Promise<{ paused: boolean }> =>
      postJson<{ paused: boolean }>('/api/automations/pause', { paused }),
  };
}

export type Api = ReturnType<typeof createApi>;

export const api: Api = createApi();
