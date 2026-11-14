// A closed run's words (D-8071; spec 2026-11-04 §9.3, §11.3, A16, A17). Pure (L1). The word keys on who closed the run;
// the stored detail only adds the reason, because history stores none. `runStateWord` (`runWords.ts`) asks this first,
// so an abandoned run never reads "failed". An older server sends neither field, and every run then reads as today.
import { isRunClosedBy, type RunSummary } from '../../../shared/api';
import { ABANDON_REFUSED_PREFIX, ABANDON_REQUESTED_PREFIX, refusedCloseReason } from '../../../shared/ledgers';

type CloseFacts = Pick<RunSummary, 'state' | 'closedBy' | 'closeDetail'>;

/** The five reasons the stuck verdict gives, in the words the screen speaks. */
const REASON_WORDS: Readonly<Record<string, string>> = {
  'overtaken': 'overtaken',
  'never-started': 'never started',
  'owner-gone': 'owner gone',
  'review-of-closed': 'review of finished work',
  'start-never-landed': 'start never finished',
};

const reasonOf = (detail: string | null | undefined, prefix: 'abandon:' | 'expired:'): string | null => {
  if (typeof detail !== 'string' || !detail.startsWith(prefix)) return null;
  // The lane stores more than the reason (`expired:never-started quiet-since=<ms>`, `expired:review-orphaned target-closed`): the
  // reason is the first token, and the lane's `review-orphaned` is the stuck verdict's `review-of-closed`.
  const token = detail.slice(prefix.length).split(' ')[0] ?? '';
  return REASON_WORDS[token === 'review-orphaned' ? 'review-of-closed' : token] ?? null;
};

/** The words for a run someone ended, or null when the run is open, a coordinator closed it, or nobody is recorded (the
 *  caller then falls back to `RUN_WORD`). */
export function closeWords(run: CloseFacts): string | null {
  if (run.state !== 'done' && run.state !== 'failed') return null;
  const by = isRunClosedBy(run.closedBy) ? run.closedBy : null;
  if (by === 'operator') {
    if (typeof run.closeDetail === 'string' && run.closeDetail.startsWith(ABANDON_REQUESTED_PREFIX)) return 'closed by you, at its request';
    // A refused-close item's Abandon: ccrc's lane held the close and the operator took the door; no session asked.
    if (typeof run.closeDetail === 'string' && run.closeDetail.startsWith(ABANDON_REFUSED_PREFIX)) {
      // D-8558: the reason the operator gave when its claimant was gone ("Close this run"), when it gave one.
      const reason = refusedCloseReason(run.closeDetail);
      return reason === null ? 'closed by you, after ccrc held it' : `closed by you: ${reason}`;
    }
    const why = reasonOf(run.closeDetail, 'abandon:');
    return why === null ? 'closed by you' : `closed by you: ${why}`;
  }
  if (by === 'sweep') {
    const why = reasonOf(run.closeDetail, 'expired:');
    return why === null ? 'closed by ccrc' : `closed by ccrc: ${why}`;
  }
  return null;
}

/** The line beneath a closed run's word, carrying only what the word lacks (check 5): the date alone after a word that
 *  names the closer, and who and when after "done" or "failed". */
export function closedLine(
  run: Pick<RunSummary, 'state' | 'closedBy' | 'closeDetail' | 'closedAt'>, fmt: (ms: number) => string,
): string {
  const when = typeof run.closedAt === 'number' ? fmt(run.closedAt) : '';
  if (closeWords(run) === null && run.closedBy === 'coordinator') return `Closed by the coordinator, ${when}`;
  return when;
}

/** D-8558: the reasons "Close this run" offers on a refused-close item whose coordinator is gone, in the words the run's record
 *  then reads ("closed by you: done elsewhere"). The operator may type its own instead. */
export const CLOSE_RUN_REASONS: readonly string[] = ['done elsewhere', 'no longer needed', 'replaced by other work'];
