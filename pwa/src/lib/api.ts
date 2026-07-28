// Typed REST client for ccrc-server. All server state arrives over the two
// WebSocket streams; every WRITE goes through here. Each function throws
// ApiError { status, body } on non-2xx — callers branch on status/body
// (e.g. 409 { error: 'draft-present', draft } from prompt).
import type { AccountUsage, FleetHealth, FleetSession, SlashCommand, StagedClip } from '../../../shared/api';

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
  'enter-ignored': "Typed it, but the session didn't accept it — open the terminal to check.",
  'verify-failed': "The session never showed the text — open the terminal to check.",
  'draft-clear-failed': "Couldn't clear the existing draft — open the terminal.",
  'not-alive': 'That session is not running.',
};

export const sendErrorText = (code: string): string => SEND_ERROR_TEXT[code] ?? code;

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

/** Human-readable failure text for a caught error: lifecycle routes fail as
 *  502 { stderr } (ccd's own words) — prefer that over the generic message. */
export function apiErrorText(err: unknown): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
    const stderr = (err.body as { stderr?: unknown }).stderr;
    if (typeof stderr === 'string' && stderr.trim().length > 0) return stderr.trim();
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

  const del = async (path: string): Promise<void> => {
    await request(path, { method: 'DELETE' });
  };

  const sid = (id: string): string => `/api/sessions/${encodeURIComponent(id)}`;

  return {
    fleet: () => getJson<{ sessions: FleetSession[]; stale?: boolean; downSince?: number | null }>('/api/fleet'),
    fleetHealth: () => getJson<FleetHealth>('/api/fleet/health'),
    rebootFleet: () => post('/api/fleet/reboot'),
    accounts: () => getJson<{ accounts: AccountUsage[] }>('/api/accounts'),
    projects: () =>
      getJson<{ roots: string[]; projects: { name: string; workdir: string }[] }>('/api/projects'),
    createSession: (b: { wrapper: string; project: string; workdir?: string }) =>
      post('/api/sessions', b),
    ensure: (id: string) => post(`${sid(id)}/ensure`),
    workspaceAdd: (project: string): Promise<void> =>
      post(`/api/projects/${encodeURIComponent(project)}/workspaces`),
    workspaceRemove: (id: string): Promise<void> => del(`${sid(id)}/workspace`),
    stop: (id: string) => post(`${sid(id)}/stop`),
    swap: (id: string, wrapper: string) => post(`${sid(id)}/swap`, { wrapper }),
    prompt: (id: string, text: string, opts: { replaceDraft?: boolean; attachments?: string[] } = {}) =>
      post(`${sid(id)}/prompt`, {
        text,
        ...(opts.replaceDraft === undefined ? {} : { replaceDraft: opts.replaceDraft }),
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
      }),
    answerDialog: (id: string, dialogId: string, optionIndex: number) =>
      post(`${sid(id)}/dialog`, { dialogId, optionIndex }),
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
