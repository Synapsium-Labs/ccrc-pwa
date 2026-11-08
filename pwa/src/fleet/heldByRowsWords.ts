// The held-rows list's vocabulary (cleanup un-wedge R2): the ONE reader of
// `CoordStatus.cleanupHeldBy`, the console's own L1 check of which control a
// line gets, and the words of each control's confirm. The server decides the
// act and writes the sentence; nothing here counts or re-words either.
import {
  CLEANUP_HELD_BY_ACTS, HELD_BY_WORDS, type CleanupHeldByAct, type CleanupHeldByItem,
} from '../../../shared/api';
import { isCount, isOneOf, isRecord } from '../lib/wire';
import { forgetHeldBack, forgetOffered, type ForgetFacts, type ForgetHeldBack } from './presence';

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

/** Which control a line gets. Forget ONLY for a gone-unrecorded row the server also says forget for, and only where
 *  the session sheet's Forget rule (`forgetOffered`) allows it: the fleet lists the row (`session`), and it is dead, no
 *  workspace and not asleep (Task C15, D-8111, review 1580 F9). Every other case is a re-check, so a server
 *  item that asks for forget on another word, or for a row ccd would refuse, still gets the harmless control. */
export function heldByRowControl(item: CleanupHeldByItem, session: ForgetFacts | undefined): CleanupHeldByAct {
  return item.act === 'forget' && item.word === 'gone-unrecorded' && session !== undefined && forgetOffered(session)
    ? 'forget' : 'recheck';
}

/** The line after the server's sentence, in the same wrapping row, when a forget act shows Check again because of
 *  the row's presence (review 1663 F1, the coordinator's ruling; words of mail 16603). One line per presence reason of
 *  `forgetHeldBack`; a workspace row has none (ruling R2). Forget needs the session stopped: checking again cannot
 *  change an asleep row, and waking it does not unlock Forget, so `running` and `asleep` both say stop it first. */
const HELD_BY_FORGET_HELD_BACK: Record<Exclude<ForgetHeldBack, 'workspace'>, string> = {
  running: 'Forget is not offered while the fleet lists this session as running: stop it first.',
  asleep: 'Forget is not offered while this session is asleep: stop it first.',
  doubt: 'Forget is not offered while the fleet cannot tell whether this session is running.',
};

/** The line for a forget act the console turned into Check again, or `null`. It decides nothing itself: the reason is
 *  `forgetHeldBack`'s, and this maps `running`, `asleep` and `doubt` to words. `null` when the act and the control agree,
 *  for a row the fleet does not list (the server's sentence already says so, ruling R2), and for a workspace row. */
export function heldByRowWhyNotForget(item: CleanupHeldByItem, session: ForgetFacts | undefined): string | null {
  if (item.act !== 'forget' || session === undefined || heldByRowControl(item, session) !== 'recheck') return null;
  const reason = forgetHeldBack(session);
  return reason === null || reason === 'workspace' ? null : HELD_BY_FORGET_HELD_BACK[reason];
}

/** The pace (reviews 1580 F1, 1585 F1 and 1590 F1): ccrc asks a held item again only once its own backoff has run, at
 *  each lane's own pace (review 1590 N-e: the reclaim lane asks one child a minute fleet-wide; the expiry and collect
 *  lanes run a few audits a pass). Nothing here resets it or asks the server. The server's sentences carry the same two
 *  phrases (`server/src/cleanupHeldBy.ts`); a parity test holds them equal. */
const HELD_PACE = 'usually within minutes for a new hold; a few hours or more for what has been failing a long time; longer when many items are held';
/** Said wherever a re-read is promised: the paused lanes read nothing. */
const HELD_PAUSED = 'ccrc reads nothing again while the cleanup is paused.';

export const CLEANUP_HELD_BY_CONTROL: Record<CleanupHeldByAct, {
  button: string; confirmLabel: string;
  /** The button's accessible name: its visible words as one unbroken run, then the row it acts on (D-7897). */
  ariaLabel: (rowId: string) => string;
  title: (rowId: string) => string;
  consequence: (item: CleanupHeldByItem) => string;
}> = {
  forget: {
    button: 'Forget row…',
    confirmLabel: 'Forget row',
    ariaLabel: (rowId) => `Forget row ${rowId}…`,
    title: (rowId) => `Forget ${rowId}?`,
    consequence: (item) => `Only the registry entry of ${item.rowId} is removed. Its transcript and any pasted images stay on disk and nothing in git is touched. The cleanup it blocked goes ahead, wherever no other row still holds it, when ccrc next checks what this row holds: ${HELD_PACE}. ${HELD_PAUSED}`,
  },
  recheck: {
    button: 'Check again…',
    confirmLabel: 'Check again',
    ariaLabel: (rowId) => `Check again — ${rowId}…`,
    title: (rowId) => `Check ${rowId} again?`,
    consequence: (item) => `Nothing is sent and nothing changes for ${item.rowId}. This re-reads the latest status; ccrc reads this row again when it next checks what it holds: ${HELD_PACE}. ${HELD_PAUSED}`,
  },
};

export const CLEANUP_HELD_BY_RECHECKED =
  `Checked again against the latest status; nothing was sent. ccrc reads this row again when it next checks what it holds: ${HELD_PACE}. ${HELD_PAUSED}`;

/** The toast after a forget the server accepted: the row is gone from the registry, and its line stays until the
 *  items it held (child workspaces, archived workspaces and temp roots) are checked again. */
export const heldByRowForgot = (rowId: string): string =>
  `Forgot ${rowId}. The line clears as each item it held is checked again, ${HELD_PACE}. ${HELD_PAUSED}`;

/** What a line says, for telling a changed line from the same one in a new frame. */
export const heldByRowLine = (item: CleanupHeldByItem): string =>
  JSON.stringify([item.word, item.act, item.sentence, item.holds.reclaim, item.holds.expire, item.holds.collect]);

export const heldByRowWho = (item: CleanupHeldByItem): string => `${item.rowId} · ${item.word}`;
