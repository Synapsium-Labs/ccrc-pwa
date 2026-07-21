// Typed REST client for ccrc-server. All server state arrives over the two
// WebSocket streams; every WRITE goes through here. Each function throws
// ApiError { status, body } on non-2xx — callers branch on status/body
// (e.g. 409 { error: 'draft-present', draft } from prompt).
import type { FleetSession } from '../../../shared/api';

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
    fleet: () => getJson<{ sessions: FleetSession[] }>('/api/fleet'),
    projects: () =>
      getJson<{ roots: string[]; projects: { name: string; workdir: string }[] }>('/api/projects'),
    createSession: (b: { wrapper: string; project: string; workdir?: string }) =>
      post('/api/sessions', b),
    ensure: (id: string) => post(`${sid(id)}/ensure`),
    stop: (id: string) => post(`${sid(id)}/stop`),
    swap: (id: string, wrapper: string) => post(`${sid(id)}/swap`, { wrapper }),
    prompt: (id: string, text: string, replaceDraft?: boolean) =>
      post(`${sid(id)}/prompt`, replaceDraft === undefined ? { text } : { text, replaceDraft }),
    answerDialog: (id: string, dialogId: string, optionIndex: number) =>
      post(`${sid(id)}/dialog`, { dialogId, optionIndex }),
    interrupt: (id: string) => post(`${sid(id)}/interrupt`),
    upload: async (id: string, file: File): Promise<void> => {
      const form = new FormData();
      form.append('file', file, file.name);
      await request(`${sid(id)}/upload`, { method: 'POST', body: form });
    },
  };
}

export type Api = ReturnType<typeof createApi>;

export const api: Api = createApi();
