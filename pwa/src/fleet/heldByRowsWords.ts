// The held-rows list's vocabulary (cleanup un-wedge R2): the ONE reader of
// `CoordStatus.cleanupHeldBy`, the console's own L1 check of which control a
// line gets, and the words of each control's confirm. The server decides the
// act and writes the sentence; nothing here counts or re-words either.
import {
  CLEANUP_HELD_BY_ACTS, HELD_BY_WORDS, type CleanupHeldByAct, type CleanupHeldByItem,
} from '../../../shared/api';
import { isCount, isOneOf, isRecord } from '../lib/wire';

export const CLEANUP_HELD_BY_LABEL = 'rows holding the cleanup';

const ROW_ID = /^[A-Za-z0-9._-]+$/;

const isItem = (a: unknown): a is CleanupHeldByItem => {
  if (!isRecord(a)) return false;
  if (typeof a.rowId !== 'string' || !ROW_ID.test(a.rowId)) return false;
  if (!isOneOf(HELD_BY_WORDS, a.word) || typeof a.sentence !== 'string' || !isOneOf(CLEANUP_HELD_BY_ACTS, a.act)) return false;
  const h = a.holds;
  return isRecord(h) && isCount(h.reclaim) && isCount(h.expire) && isCount(h.collect);
};

/** THE ONE READER of `CoordStatus.cleanupHeldBy`. Absent field (an older server), a null coord or a non-array answer
 *  `[]`, never undefined; a malformed member is dropped on its own. The server's order is kept. */
export function heldByRowsOf(coord: unknown): CleanupHeldByItem[] {
  if (!isRecord(coord)) return [];
  const list = coord.cleanupHeldBy;
  if (!Array.isArray(list)) return [];
  return list.filter(isItem);
}

/** Which control a line gets. Forget ONLY for a gone-unrecorded row the server also says forget for; every other
 *  case is a re-check, so a server item that asks for forget on another word still gets the harmless control. */
export function heldByRowControl(item: CleanupHeldByItem): CleanupHeldByAct {
  return item.act === 'forget' && item.word === 'gone-unrecorded' ? 'forget' : 'recheck';
}

/** The real pace (review 1580 F1): ccrc asks a held child again only once that child's own backoff has run, which is
 *  minutes for a new hold and up to four hours on the persistent tier. Nothing here resets it or asks the server. */
const HELD_PACE = 'within minutes for a new hold, and up to four hours for children that have been failing a long time';

export const CLEANUP_HELD_BY_CONTROL: Record<CleanupHeldByAct, {
  button: string; confirmLabel: string;
  /** The button's accessible name: its words with the row it acts on. */
  ariaLabel: (rowId: string) => string;
  title: (rowId: string) => string;
  consequence: (item: CleanupHeldByItem) => string;
}> = {
  forget: {
    button: 'Forget row…',
    confirmLabel: 'Forget row',
    ariaLabel: (rowId) => `Forget ${rowId}…`,
    title: (rowId) => `Forget ${rowId}?`,
    consequence: (item) => `Only the registry entry of ${item.rowId} is removed. Its transcript and any pasted images stay on disk and nothing in git is touched. The cleanup it blocked goes ahead, wherever no other row still holds it, when ccrc next checks the children this row holds: ${HELD_PACE}.`,
  },
  recheck: {
    button: 'Check again…',
    confirmLabel: 'Check again',
    ariaLabel: (rowId) => `Check ${rowId} again…`,
    title: (rowId) => `Check ${rowId} again?`,
    consequence: (item) => `Nothing is sent and nothing changes for ${item.rowId}. This re-reads the latest status; ccrc reads this row again when it next checks the children it holds: ${HELD_PACE}.`,
  },
};

export const CLEANUP_HELD_BY_RECHECKED =
  `Checked again against the latest status; nothing was sent. ccrc reads this row again when it next checks the children it holds: ${HELD_PACE}.`;

/** The toast after a forget the server accepted: the row is gone from the registry, and its line stays until the
 *  children it held are asked again. */
export const heldByRowForgot = (rowId: string): string =>
  `Forgot ${rowId}. The line clears as each child it held is checked again, ${HELD_PACE}.`;

/** What a line says, for telling a changed line from the same one in a new frame. */
export const heldByRowLine = (item: CleanupHeldByItem): string =>
  JSON.stringify([item.word, item.act, item.sentence, item.holds.reclaim, item.holds.expire, item.holds.collect]);

export const heldByRowWho = (item: CleanupHeldByItem): string => `${item.rowId} · ${item.word}`;
