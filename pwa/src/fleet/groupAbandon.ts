// Abandon a stuck group (D-8074; spec 2026-11-04 §9.2, A12, A13, A33, A34, A40, A41, A49, A61; wave B4 Task 14). The loop and
// the words of the group act, apart from the sheet that drives them. The PWA calls the existing abandon route once per run, one
// at a time: before each call it asks where the run stands, and every run the operator confirmed ends in exactly one of six
// results (A41). No new route (A12).
// L4 composition: it drives the abandon route through the fetch adapter and reads the single sheet's error sentence.
import type { RunSummary, StuckReason } from '../../../shared/api';
import { ApiError, isRegistryUnmeasurable } from '../lib/api';
import { abandonErrorText, type AbandonAnswer } from './AbandonSheet';
import type { CoordinatorPresence } from './presence';
import { coordinatorGoneOf, isRunClosed } from './runWords';
import { STUCK_HEADING, heldBack } from './stuckWords';

/** C1 sets no time limit on a POST unless the caller passes one, so each call of the loop passes this (A49). A bulk run holds
 *  no session or workspace, so its abandon has no fleet act to wait on. */
export const ABANDON_CALL_MS = 30_000;

/** Where a run stands before its call (A49, A61). A run gone from the frame has closed; `stuck` absent means the reader is empty
 *  (as after a restart), so nothing says what the run is; `stuck` null, another reason, or a held session or workspace means it
 *  moved. */
export type GroupStanding = 'in-group' | 'moved' | 'closed' | 'unread';

/** The six results (A41). `refused` carries the sentence the run's refusal reads. */
export interface GroupResult {
  abandoned: number[]; alreadyClosed: number[]; leftAlone: number[];
  refused: { id: number; sentence: string }[]; noAnswer: number[]; notReached: number[];
}

export function groupStanding(run: RunSummary | undefined, reason: StuckReason): GroupStanding {
  if (run === undefined || isRunClosed(run)) return 'closed';
  if (run.stuck === undefined) return 'unread';
  if (run.stuck === null || run.stuck.reason !== reason || heldBack(run)) return 'moved';
  return 'in-group';
}

export interface GroupDeps {
  abandon(id: number): Promise<AbandonAnswer>;
  standing(id: number): GroupStanding;
  stopped(): boolean;
  onStep(done: number): void;
}

/** What one failed call means: the run had already closed (a 409 `bad-transition`), a refusal of that run alone, a fault of the
 *  whole box (501, 502, `registry-unmeasurable`: stop, A33), or no answer (a timeout or network failure: stop, never retried). */
type CallEnd =
  | { kind: 'closed' } | { kind: 'refused'; sentence: string; stop: boolean } | { kind: 'no-answer' };

function endOf(err: unknown): CallEnd {
  if (!(err instanceof ApiError)) return { kind: 'no-answer' };
  const body = err.body;
  const code = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  if (err.status === 409 && code === 'bad-transition') return { kind: 'closed' };
  const said = abandonErrorText(err);
  const sentence = said.lead === null ? said.text : `${said.lead} ${said.text}`;
  return { kind: 'refused', sentence, stop: err.status === 501 || err.status === 502 || isRegistryUnmeasurable(err) };
}

/** Abandon the confirmed list, one run at a time, on the list the sheet showed (A34). Every id ends in exactly one result. */
export async function runGroupAbandon(list: readonly number[], deps: GroupDeps): Promise<GroupResult> {
  const r: GroupResult = { abandoned: [], alreadyClosed: [], leftAlone: [], refused: [], noAnswer: [], notReached: [] };
  deps.onStep(0);
  for (let i = 0; i < list.length; i++) {
    const id = list[i]!;
    const rest = (from: number): void => { r.notReached.push(...list.slice(from)); };
    if (deps.stopped()) { rest(i); break; }
    const standing = deps.standing(id);
    if (standing === 'unread') { rest(i); break; }
    if (standing === 'closed') r.alreadyClosed.push(id);
    else if (standing === 'moved') r.leftAlone.push(id);
    else {
      let halt = false;
      try {
        await deps.abandon(id);
        r.abandoned.push(id);
      } catch (err) {
        const end = endOf(err);
        if (end.kind === 'closed') r.alreadyClosed.push(id);
        else if (end.kind === 'no-answer') { r.noAnswer.push(id); halt = true; }
        else { r.refused.push({ id, sentence: end.sentence }); halt = end.stop; }
      }
      if (halt) { rest(i + 1); break; }
    }
    deps.onStep(i + 1);
  }
  return r;
}

/** The head's group control (§9.2, o1): see `groupControlWords` in stuckWords. Re-exported here so the group act has one import. */
export { groupControlWords } from './stuckWords';

const runs = (n: number): string => `${n} ${n === 1 ? 'run' : 'runs'}`;

/** The toast after the loop, or null when the sheet must stay open (a refusal, a call with no answer or a stop, A41, A61). Each
 *  result that happened is added, so the numbers add up. */
export function groupToast(r: GroupResult): string | null {
  if (r.refused.length > 0 || r.noAnswer.length > 0 || r.notReached.length > 0) return null;
  const parts = [r.abandoned.length > 0 ? `${runs(r.abandoned.length)} abandoned.` : 'No runs abandoned.'];
  const alone = r.leftAlone.length;
  if (alone > 0) parts.push(`${alone} started moving and ${alone === 1 ? 'was' : 'were'} left alone.`);
  if (r.alreadyClosed.length > 0) parts.push(`${r.alreadyClosed.length} had already closed.`);
  return parts.join(' ');
}

/** "See them" only with something abandoned: with nothing abandoned there is nothing to see (A61). */
export const groupToastHasLink = (r: GroupResult): boolean => r.abandoned.length > 0;

/** The part-done line over the list (§9.2): "Not" counts refused, no answer and not reached. */
export function groupSummary(r: GroupResult): string {
  const not = r.refused.length + r.noAnswer.length + r.notReached.length;
  const closed = r.alreadyClosed.length > 0 ? `, ${r.alreadyClosed.length} had already closed` : '';
  return `${r.abandoned.length} abandoned${closed}, ${not} not:`;
}

/** The sentence under a listed run (§9.2). A run abandoned is not listed, so its sentence is only for completeness. */
export function groupRunSentence(r: GroupResult, id: number): string {
  const refused = r.refused.find((x) => x.id === id);
  if (refused !== undefined) return refused.sentence;
  if (r.noAnswer.includes(id)) return 'No answer. It may have closed.';
  if (r.notReached.includes(id)) return 'Not reached.';
  if (r.alreadyClosed.includes(id)) return 'This run already closed.';
  if (r.leftAlone.includes(id)) return 'It started moving and was left alone.';
  return 'Abandoned.';
}

const REASON_SENTENCE: Readonly<Record<StuckReason, { several: string; one: string }>> = {
  'review-of-closed': {
    several: 'These reviews have nothing left to review: the work closed or a later review took over.',
    one: 'This review has nothing left to review: the work closed or a later review took over.',
  },
  'overtaken': { several: 'A later wave moved on without these.', one: 'A later wave moved on without this one.' },
  'owner-gone': { several: 'The coordinator or worker behind these is gone.', one: 'The coordinator or worker behind this is gone.' },
  'start-never-landed': { several: 'These started and never landed.', one: 'This started and never landed.' },
  'never-started': { several: 'These were opened and never started.', one: 'This was opened and never started.' },
};

/** The sheet's title, lines and confirm for the ticked runs (§9.2). `lines` opens with the reason's heading and sentence for
 *  several runs, and with the singular sentence for one; the coordinator sentence follows by `coordinatorGoneOf` (§9.5) and is
 *  left out when every coordinator there is gone. `confirm` is null with none ticked. */
export function groupSheetLines(
  reason: StuckReason, ticked: readonly RunSummary[], presence: (r: RunSummary) => CoordinatorPresence,
): { title: string; lines: readonly string[]; confirm: string | null } {
  const n = ticked.length;
  if (n === 0) return { title: 'Choose a run to abandon.', lines: [], confirm: null };
  const claimed = ticked.filter((r) => r.claimedBy !== null);
  const live = claimed.filter((r) => !coordinatorGoneOf(r, presence(r))).length;
  const told = live === 0 ? null
    : live < claimed.length ? 'Live coordinators are told.'
      : n === 1 ? 'Its coordinator is told.' : 'Their coordinators are told.';
  const one = n === 1;
  const lines = one
    ? [REASON_SENTENCE[reason].one, 'It holds no workspace. It is recorded as closed by you.']
    : [STUCK_HEADING[reason], REASON_SENTENCE[reason].several, 'None holds a workspace. Each is recorded as closed by you.'];
  if (told !== null) lines.push(told);
  return { title: one ? 'Abandon 1 run?' : `Abandon ${n} runs?`, lines, confirm: one ? 'Abandon 1 run' : `Abandon ${n} runs` };
}
