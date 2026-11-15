// Overlord W1, answer marks (spec 2026-11-09 §9.2.1, C70; plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-delegation-marks.md):
// the operator's two marks on a question they were shown on Waiting on you. `could-answer` says "the Overlord could answer
// this", and `unsure` says "I'm not sure of my answer". Ring: L0, context Coordination. The server's deciders
// (`server/src/coord/answerMarks.ts`), its store (`answerMarkStore.ts`) and the console read this one file, so it imports
// nothing, not even types.
//
// A MARK GRANTS NOTHING AND IS NEVER AN ANSWER. It is a label the operator keeps for the Overlord to learn from later (W3, W4).
// Only the operator's door (`POST /api/answer-marks`) writes one, through the one writer
// (`answerMarkStore.ts#recordAnswerMark`), and nothing that decides authority reads it.
//
// FOUR ANSWERS, NONE OF THEM NULL (plan question 14). On an item's view: the field absent means "this server cannot mark this
// row" (an older server, or a row that carries no box); `never` means markable with no record; `marked` and `withdrawn` are
// the newest record, ticked or unticked; `unmeasured` means the mark read failed.

/** The kind of row a mark names. `ask` is PR B's (plan Task 5): the parser accepts it, and the door refuses it until then. */
export type AnswerMarkKind = 'item' | 'ask';
export const ANSWER_MARK_KIND_MAP: Record<AnswerMarkKind, true> = { item: true, ask: true };
export const ANSWER_MARK_KINDS = Object.keys(ANSWER_MARK_KIND_MAP) as readonly AnswerMarkKind[];
export const isAnswerMarkKind = (v: unknown): v is AnswerMarkKind =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(ANSWER_MARK_KIND_MAP, v);

/** The two marks, independent of each other (plan question 2): the operator may hand a question over and be sure of their
 *  answer, or be unsure and keep it. */
export type AnswerMarkName = 'could-answer' | 'unsure';
export const ANSWER_MARK_NAME_MAP: Record<AnswerMarkName, true> = { 'could-answer': true, unsure: true };
export const ANSWER_MARK_NAMES = Object.keys(ANSWER_MARK_NAME_MAP) as readonly AnswerMarkName[];
export const isAnswerMarkName = (v: unknown): v is AnswerMarkName =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(ANSWER_MARK_NAME_MAP, v);

/** One mark on the wire. `signedIn` is false for a mark written while sign-in was dark (actor `flag-off`): kept and shown,
 *  and the weaker basis in the operator model (§9.2.1), because no cookie says who made it. */
export type AnswerMarkView =
  | { state: 'never' }
  | { state: 'marked' | 'withdrawn'; at: number; signedIn: boolean }
  | { state: 'unmeasured'; detail: string };
export type AnswerMarkState = AnswerMarkView['state'];
export const ANSWER_MARK_STATE_MAP: Record<AnswerMarkState, true> = { never: true, marked: true, withdrawn: true, unmeasured: true };

/** Both marks of one row. */
export interface AnswerMarksView { couldAnswer: AnswerMarkView; unsure: AnswerMarkView }

/** What the door writes: one mark of one row, ticked (`true`) or unticked (`false`). */
export interface AnswerMarkWrite { kind: AnswerMarkKind; id: number; mark: AnswerMarkName; value: boolean }

const WRITE_KEYS: Record<keyof AnswerMarkWrite, true> = { kind: true, id: true, mark: true, value: true };

/** The door's body, read once: exactly `{ kind, id, mark, value }`, with no other key. */
export function parseAnswerMarkWrite(body: unknown): { ok: true; write: AnswerMarkWrite } | { ok: false; detail: string } {
  const bad = (detail: string) => ({ ok: false as const, detail });
  if (typeof body !== 'object' || body === null) return bad('the body is { kind, id, mark, value }');
  const keys = Object.keys(body);
  if (keys.some((k) => !Object.prototype.hasOwnProperty.call(WRITE_KEYS, k))) return bad('the body carries only kind, id, mark and value');
  const { kind, id, mark, value } = body as { kind?: unknown; id?: unknown; mark?: unknown; value?: unknown };
  if (!isAnswerMarkKind(kind)) return bad(`kind is one of ${ANSWER_MARK_KINDS.join(', ')}`);
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return bad('id is a positive integer');
  if (!isAnswerMarkName(mark)) return bad(`mark is one of ${ANSWER_MARK_NAMES.join(', ')}`);
  if (typeof value !== 'boolean') return bad('value is true or false');
  return { ok: true, write: { kind, id, mark, value } };
}
