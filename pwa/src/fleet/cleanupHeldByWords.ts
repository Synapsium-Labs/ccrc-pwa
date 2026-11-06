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
export function cleanupHeldByOf(coord: unknown): CleanupHeldByItem[] {
  if (!isRecord(coord)) return [];
  const list = coord.cleanupHeldBy;
  if (!Array.isArray(list)) return [];
  return list.filter(isItem);
}

/** Which control a line gets. Forget ONLY for a gone-unrecorded row the server also says forget for; every other
 *  case is a re-check, so a server item that asks for forget on another word still gets the harmless control. */
export function cleanupHeldByControl(item: CleanupHeldByItem): CleanupHeldByAct {
  return item.act === 'forget' && item.word === 'gone-unrecorded' ? 'forget' : 'recheck';
}

export const CLEANUP_HELD_BY_CONTROL: Record<CleanupHeldByAct, {
  button: string; confirmLabel: string;
  title: (rowId: string) => string;
  consequence: (item: CleanupHeldByItem) => string;
}> = {
  forget: {
    button: 'Forget row…',
    confirmLabel: 'Forget row',
    title: (rowId) => `Forget ${rowId}?`,
    consequence: (item) => `Only the registry entry of ${item.rowId} is removed. Its transcript and any pasted images stay on disk and nothing in git is touched. The cleanup it blocked goes ahead on the next pass.`,
  },
  recheck: {
    button: 'Check again…',
    confirmLabel: 'Check again',
    title: (rowId) => `Check ${rowId} again?`,
    consequence: (item) => `Nothing is sent and nothing changes for ${item.rowId}. This re-reads the latest status; the cleanup reads the row again on its next pass, about once a minute.`,
  },
};

export const CLEANUP_HELD_BY_RECHECKED =
  'Checked again against the latest status. The cleanup reads this row again on its next pass, about once a minute.';

export const cleanupHeldByWho = (item: CleanupHeldByItem): string => `${item.rowId} · ${item.word}`;
