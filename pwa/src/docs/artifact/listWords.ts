// The live artifact links' list: its words and its pure choices (X5 A5.3; spec 2026-11-19 §3.3 "Revocation" and "Re-hand"). Ring L1:
// no React, no fetch, no DOM global. The list shows each live capability's page, version, when it was opened, its last request and
// its expiry, and never a URL: `ArtifactRow` carries none, and nothing here builds one. Times are RELATIVE words (the fleet's
// `formatAge` for a past moment, `formatReset` for the moment ahead), taken from a clock the caller passes.
import type { ArtifactRow } from '../../../../shared/artifacts';
import type { DocSectionSlug } from '../../../../shared/docs';
import { formatAge, formatReset } from '../../fleet/formatReset';
import { fillSentence } from '../docsText';
import { artifactStop, type ArtifactAnswer } from './tier';

/** How old the list the store holds may be before a list that mounts reads it again: ten seconds. */
export const ARTIFACT_LIST_FRESH_MS = 10000;
/** The characters of a capability's id the list shows. The id is a handle, never the token. */
export const ARTIFACT_LIST_ID_CHARS = 8;
/** Under this long left, the list says "under a minute" and not a count of minutes. */
const MINUTE_MS = 60000;

export const ARTIFACT_LIST_TEXT = {
  heading: 'Open as artifacts',
  /** `{page}` is the row's page, `{project}` its project (the index form only). */
  revokeLabel: 'Revoke {page} ({id})',
  revokeLabelIn: 'Revoke {page} in {project} ({id})',
  id: 'Link {id}',
  revoke: 'Revoke',
  revokeAll: 'Revoke all',
  /** The accessible name of Revoke all: it ends every artifact link on the box, not only the ones listed. */
  revokeAllLabel: 'Revoke all artifact links on this box',
  revokeAllNote: 'Revoke all ends every artifact link on this box, {n} in all.',
  pinned: 'Pinned to {pin}',
  minted: 'Opened {age}',
  last: 'Last request {age}',
  lastNone: 'No request yet',
  expires: 'Ends in {left}',
  expiresNow: 'Ends now',
  expiresSoon: 'Ends in under a minute',
  windowsAllowed: 'Windows allowed',
  windowsClosed: 'Windows closed',
  hosts: 'Outside hosts: {n}',
  /** One sentence for a revoke the box did not take: the rows stay, and nothing else is claimed. */
  failed: 'The link was not revoked. Try again.',
  failedAll: 'The links were not revoked. Try again.',
  /** Drawn beside a list the store holds but could not read again: it shows what it last read, until a read answers. */
  stale: 'This list could not be read again; it shows what it last read.',
} as const;

/** The page a list is scoped to: a project's page by section and path. */
export interface ArtifactListScope { readonly project: string; readonly section: DocSectionSlug; readonly path: string }

/** The rows a list shows: every live row, or only the scope's page's when a scope is given. */
export function artifactRowsFor(live: readonly ArtifactRow[], scope: ArtifactListScope | undefined): readonly ArtifactRow[] {
  if (scope === undefined) return live;
  return live.filter((r) => r.project === scope.project && r.section === scope.section && r.path === scope.path);
}

/** A row's page as the list names it: `section/path`. */
export const artifactPageName = (row: Pick<ArtifactRow, 'section' | 'path'>): string => `${row.section}/${row.path}`;

/** A row's lines in words, from `nowMs`: when it was opened, its last request (a capability never requested has `lastAt` equal to
 *  `mintedAt`) and its end. */
export function artifactWhen(
  row: ArtifactRow, nowMs: number,
): { readonly minted: string; readonly last: string; readonly expires: string } {
  const ago = (at: number): string => formatAge((nowMs - at) / 1000);
  const left = formatReset(row.expiresAt / 1000, nowMs / 1000);
  return {
    minted: fillSentence(ARTIFACT_LIST_TEXT.minted, { age: ago(row.mintedAt) }),
    last: row.lastAt > row.mintedAt ? fillSentence(ARTIFACT_LIST_TEXT.last, { age: ago(row.lastAt) }) : ARTIFACT_LIST_TEXT.lastNone,
    expires: row.expiresAt <= nowMs
      ? ARTIFACT_LIST_TEXT.expiresNow
      : row.expiresAt - nowMs < MINUTE_MS ? ARTIFACT_LIST_TEXT.expiresSoon : fillSentence(ARTIFACT_LIST_TEXT.expires, { left }),
  };
}

/** A row's short id: the first characters of its id. */
export const artifactShortId = (row: Pick<ArtifactRow, 'id'>): string => row.id.slice(0, ARTIFACT_LIST_ID_CHARS);

/** Whether the list names each row's project: the index form (no scope) does, a page's own list does not. */
export const artifactNamesProject = (scope: ArtifactListScope | undefined): boolean => scope === undefined;

/** A Revoke button's accessible name: the page, its project in the index form, and the short id, so two links of one page differ. */
export function artifactRevokeLabel(row: Pick<ArtifactRow, 'id' | 'project' | 'section' | 'path'>, named: boolean): string {
  return fillSentence(named ? ARTIFACT_LIST_TEXT.revokeLabelIn : ARTIFACT_LIST_TEXT.revokeLabel,
    { page: artifactPageName(row), project: row.project, id: artifactShortId(row) });
}

/** The one sentence for a revoke that did not end anything. A refusal, a docs failure word or a client slot has its own sentence
 *  (`artifactStop`, the owner the launch sheet speaks through, so `unauthenticated` says "You are not signed in." and never "Try
 *  again"); `null` is a call that threw, which has no word, so it says the list's plain sentence for the door it called. */
export function artifactNotRevoked(answer: Exclude<ArtifactAnswer<unknown>, { s: 'ok' }> | null, plain: string): string {
  return answer === null ? plain : artifactStop(answer).sentence;
}
