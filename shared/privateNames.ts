// The operator's uploaded private-name list (Overlord W2, private names B; spec §9.4 rule 7, C35): the upload door's wire
// and caps, and the status read's words. L0, context K. IT IMPORTS NOTHING, not even by type: the console bundles every
// `shared/*.ts`, and the matcher (`shared/private-names.mjs`) imports `node:crypto` and has no declaration file, so a type
// import of it would not resolve in `pwa/` (slug `private-names-wire-imports-nothing`). Where this file restates a value of
// the matcher (`NAME_LIST_MODES`), `server/test/private-names-list.test.ts` pins the two equal in both directions.

/** At most this many rows in one upload (question 7). */
export const NAME_LIST_MAX_ROWS = 1_000;
/** At most this many characters in one row's `text` (question 7). */
export const NAME_LIST_MAX_CHARS = 120;
/** The upload's body cap, in bytes (256 KiB): `credentialBodyRoute` answers `oversize` past it. */
export const NAME_LIST_BODY_MAX = 256 * 1024;

/** The matcher's modes (`shared/private-names.mjs#MODES`), restated for the console, which cannot load that module. */
export const NAME_LIST_MODES = ['part', 'exact', 'run', 'words'] as const;
export type NameListMode = (typeof NAME_LIST_MODES)[number];
export function isNameListMode(s: unknown): s is NameListMode {
  return typeof s === 'string' && (NAME_LIST_MODES as readonly string[]).includes(s);
}

/** The server-level slot of the operator-secrets store that holds the list's key (question 5): written once, at the first
 *  upload, and removed by nothing (`server/test/single-definition/name-list-key.test.ts`). */
export const NAME_LIST_KEY_SLOT = 'private-names-key';

/** One row the operator sends: a name and its mode. The text lives only in the upload handler's memory. */
export interface NameListRow { readonly text: string; readonly mode: NameListMode }
/** The upload's body: at least one row, or no row with `clear: true`, the console's confirmed "Clear the list" (the Settings
 *  plan's ruling, carried by the brief: an empty upload is refused unless it is that confirmed clear). */
export interface NameListUpload { readonly rows: readonly NameListRow[]; readonly clear?: true }
/** The upload's answer: how many rows it took, how many entries it stored (the canary and every row's entries), and when. */
export interface NameListUploaded { readonly ok: true; readonly rows: number; readonly entries: number; readonly uploadedAt: number }

/** The status read's three answers (question 9): never uploaded, a list, or one that cannot be read. */
export const NAME_LIST_STATES = ['none', 'list', 'unreadable'] as const;
export type NameListState = (typeof NAME_LIST_STATES)[number];
/** Why a list cannot be read (Table P1): the store's read failed; a key with no list; a list with no key; a key slot that
 *  cannot be read; a list whose canary is not under the slot's key. */
export const NAME_LIST_UNREADABLE = ['store', 'list-missing', 'key-missing', 'key-unreadable', 'key-mismatch'] as const;
export type NameListUnreadable = (typeof NAME_LIST_UNREADABLE)[number];
/** `GET /api/overlord/private-names`: whether a list is stored, never what is in it. */
export type NameListStatus =
  | { readonly state: 'none' }
  | { readonly state: 'list'; readonly rows: number; readonly uploadedAt: number }
  | { readonly state: 'unreadable'; readonly reason: NameListUnreadable };
