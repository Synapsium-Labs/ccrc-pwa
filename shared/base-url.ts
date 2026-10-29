// The typed re-export of `shared/base-url.mjs`, the one implementation (the `models.ts` pattern, D-5867). Nothing but
// the verdict types is defined here (D-7307).

/** Why an endpoint was refused. Each is a distinct sentence on the add sheet;
 *  `base-url-required` is deliberately NOT here — an absent value never reaches
 *  this gate. */
export type BaseUrlRefusal =
  | 'base-url-unparseable'
  | 'base-url-insecure'
  | 'base-url-credentials'
  | 'base-url-query'
  | 'base-url-fragment';

/** `url` on the `ok` arm is the NORMALISED endpoint — see the header. */
export type BaseUrlVerdict =
  | { ok: true; url: string }
  | { ok: false; reason: BaseUrlRefusal };

export { BASE_URL_OK, LOOPBACK_HOSTS } from './base-url.mjs';
