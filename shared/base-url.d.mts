// shared/base-url.d.mts — hand-written, in `shared/wrapper.d.mts`'s shape (22
// lines, the same job): the `.mjs` above is what runs, and this is what lets a
// TypeScript caller import it with types. The names and the shape are
// `shared/base-url.ts`'s exactly — a declaration that drifted from either file
// would typecheck against nothing.
export type BaseUrlRefusal =
  | 'base-url-unparseable'
  | 'base-url-insecure'
  | 'base-url-credentials'
  | 'base-url-query'
  | 'base-url-fragment';
export type BaseUrlVerdict =
  | { ok: true; url: string }
  | { ok: false; reason: BaseUrlRefusal };
export declare const LOOPBACK_HOSTS: readonly string[];
export declare const BASE_URL_OK: (raw: unknown) => BaseUrlVerdict;
