// Typed REST client for ccrc-server. All server state arrives over the two
// WebSocket streams; every WRITE goes through here. Each function throws
// ApiError { status, body } on non-2xx — callers branch on status/body
// (e.g. 409 { error: 'draft-present', draft } from prompt).
import type { AccountUsage, CatchUp, FleetHealth, FleetSession, PrView, ProjectedHome, ReapResult, SlashCommand, StagedClip, WsAudit } from '../../../shared/api';

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
  'verify-failed': "The session never showed the text — open the terminal to check.",
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
 * The one sentence for a fleet host whose `ccd` predates the verb being called.
 *
 * `PrKeycap.tsx`'s `REASON_TEXT.unsupported` already owned it — it is what the
 * cap says when the PR SWEEP hits the same skew. This is the definition and
 * that map imports it, rather than the two spelling the same fact differently:
 * the reader who sees the greyed cap and the reader who taps Archive are
 * looking at one condition on one box.
 */
export const UNSUPPORTED_VERB_TEXT =
  'The fleet host is running a ccd that does not have this verb yet.';

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

  const sid = (id: string): string => `/api/sessions/${encodeURIComponent(id)}`;

  return {
    fleet: () => getJson<{ sessions: FleetSession[]; stale?: boolean; downSince?: number | null }>('/api/fleet'),
    fleetHealth: () => getJson<FleetHealth>('/api/fleet/health'),
    rebootFleet: () => post('/api/fleet/reboot'),
    accounts: () =>
      getJson<{ accounts: AccountUsage[]; projected: ProjectedHome }>('/api/accounts'),
    projects: () =>
      getJson<{ roots: string[]; projects: { name: string; workdir: string }[] }>('/api/projects'),
    createSession: (b: { wrapper: string; project: string; workdir?: string }) =>
      post('/api/sessions', b),
    ensure: (id: string) => post(`${sid(id)}/ensure`),
    workspaceAdd: (project: string): Promise<void> =>
      post(`/api/projects/${encodeURIComponent(project)}/workspaces`),
    stop: (id: string) => post(`${sid(id)}/stop`),
    swap: (id: string, wrapper: string) => post(`${sid(id)}/swap`, { wrapper }),
    pr: (id: string) => getJson<PrView>(`${sid(id)}/pr`),
    prOpen: (id: string, b: { title: string; body: string; draft: boolean }) => post(`${sid(id)}/pr`, b),
    archive: (id: string) => post(`${sid(id)}/archive`),
    restore: (id: string) => post(`${sid(id)}/restore`),
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
    interrupt: (id: string) => post(`${sid(id)}/interrupt`),
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
