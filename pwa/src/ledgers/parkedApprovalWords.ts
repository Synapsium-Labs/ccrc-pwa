// The words of the parked-approvals group on the Waiting screen (approvals PR 3): a child's permission prompt held for a
// ruling. Pure (ring L1): every sentence the group says is here, and no colour carries meaning alone.
import type { ParkedApprovalView } from '../../../shared/approval-park';
import { refusalText } from '../lib/refusalWords';

export const PARKED_HEADING = 'Permission prompts parked, with your coordinator';
export const ALLOW_WORD = 'Allow';
export const DENY_WORD = 'Deny';
export const RECORDED_WORD = 'Recorded';

/** One row's line: who asks to run what, and that it did not run and waits. */
export const parkedRowLine = (a: Pick<ParkedApprovalView, 'childId' | 'tool'>): string =>
  `${a.childId} asks to run ${a.tool}. The command did not run and waits for a ruling.`;

/** The state of a row whose ruling is already recorded and waits for the child's retry. */
export const ruledLine = (ruled: NonNullable<ParkedApprovalView['ruled']>): string => {
  const who = ruled.authority === 'operator' ? 'the operator' : ruled.authority === 'overlord' ? 'the Overlord' : 'your coordinator';
  return ruled.verdict === 'allow'
    ? `Allowed by ${who}: waiting for the child to run it again.`
    : `Denied by ${who}: the child will be told, and the command will not run.`;
};

/** A refusal word the answer door sends, each with its sentence. */
export const PARKED_REFUSAL_TEXT: Readonly<Record<string, string>> = {
  'park-ruled': 'A ruling is already recorded for this prompt, and it waits for the child to run it again.',
  'hook-gone': 'The park has closed: the child no longer waits on this prompt.',
  'coordinator-denied': 'Your coordinator has already denied this prompt.',
  'auth-off': 'Sign-in is off on this box, so a ruling cannot be made from here.',
};
export const PARKED_DEFAULT_REFUSAL = 'The box did not take that ruling. Nothing was recorded.';

export const parkedRefusalText = (err: unknown): string => refusalText(err, PARKED_REFUSAL_TEXT) ?? PARKED_DEFAULT_REFUSAL;

/** Oldest first, never mutating the view. */
export const parkedOldestFirst = (rows: readonly ParkedApprovalView[]): ParkedApprovalView[] =>
  [...rows].sort((x, y) => x.askAt - y.askAt || x.id - y.id);
