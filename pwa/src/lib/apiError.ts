// D-5897 (ARCH-05, #551): the API client's error, a leaf that imports nothing. It moved out of `lib/api.ts`, the fetch
// adapter, so a pure word module that branches on a refusal's status or body can import the class alone.
// `lib/api.ts` imports it and re-exports it, so `instanceof` holds whichever path a caller used.
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  /** The response's `content-type` header; `null` has one meaning: the response carried none (Docs W5, spec 4.3:
   *  the docs client's `unexpected-response` names it). A header that is present but empty is `''`, which the docs
   *  client folds with `null` as "absent or empty". Absent from the constructor's arguments, also `null`. */
  readonly contentType: string | null;

  constructor(status: number, body: unknown, contentType: string | null = null) {
    const serverError =
      typeof body === 'object' && body !== null && 'error' in body
        && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : null;
    super(serverError ?? `request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.contentType = contentType;
  }
}
