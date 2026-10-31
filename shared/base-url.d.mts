// shared/base-url.d.mts — hand-written, in `shared/wrapper.d.mts`'s shape: the
// `.mjs` above is what runs, and this is what lets a TypeScript caller import
// it with types. The verdict types are IMPORTED from `shared/base-url.ts`, not
// declared here (D-7307): `rings/wire-totality.test.ts` scans `shared/*.ts`
// only, so a union declared in this file would sit outside its sight (and its
// `base-url.ts:BaseUrlRefusal` exemption would go stale). One declaration,
// one home; the cycle back to the `.ts` is type-only.
import type { BaseUrlVerdict } from './base-url.js';
export type { BaseUrlRefusal, BaseUrlVerdict } from './base-url.js';
export declare const LOOPBACK_HOSTS: readonly string[];
export declare const BASE_URL_OK: (raw: unknown) => BaseUrlVerdict;
