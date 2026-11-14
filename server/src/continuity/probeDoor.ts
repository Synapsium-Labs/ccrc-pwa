// L1, context C3 (Session Conversation): the probe door's decisions (Overlord spec §3.3.5 C41, §3.3.9 C52; plan
// `docs/superpowers/plans/2026-11-10-overlord/w1a-probes.md`, Task 4). Pure: the door (`routes.ts`, L4) reads the round, the
// masker and the session's last continuity read, and asks these what to serve, how each answer grades and what the book
// state is; it decides nothing itself.
//
// MASKED ONCE, GRADED MASKED (the notes review 2039, F12). A snapshot's facts are stored unmasked, so a round's question,
// choices and expected answer may hold a secret a session wrote. The door masks every one of them, once, with the card's
// masker, before it serves or grades: the session sees the masked choice, and an answer copied from it grades against the
// masked expected answer, so it matches, and no secret goes out.
//
// GRADABLE AS SERVED (review 2063, F1 and F6). Masking runs per text, so two choices that differ only inside a secret
// collapse to one served text, and the masker can change between the GET that served a round and the POST that answers it (a
// restart forgets a box token until its re-key). Neither is the session's: a question whose masked choices are not
// fold-distinct, or whose masked expected answer is not exactly one masked choice, grades `unmeasured`, and so does an answer
// that carries the mask placeholder and matches no masked choice. The round then reads `unmeasured` (`roundVerdict`).
//
// UNTRUSTED (review 1999, F11). A question names slugs, paths and a note's next act, all text a session or a person wrote,
// so each question and its choices are rendered as one untrusted block, the choices as JSON strings so that a newline in
// one can never read as another choice.
import { SECRET_MASK, SECRET_MASK_TOO_LARGE } from '../../../shared/api.js';
import { BOOK_STATES, PROBE_NONE, type BookState, type ProbeGrade, type ProbeRoundKind } from '../../../shared/continuity.js';
import { CARD_TEXT_PREFACE, untrustedBlock } from '../coord/untrusted.js';
import { cardPages } from './card.js';
import { fold, gradeProbe, type ProbeQuestion } from './probes.js';

/** An answer longer than this is refused `bad-request`: the longest choice is a note's next act or a claimed path, each a few
 *  hundred characters, so an answer this long was never copied from one. */
export const PROBE_ANSWER_MAX_CHARS = 2_000;
/** Each question's untrusted block is cut at this many bytes, past any question a round can draw (a claimed path is at most
 *  512 bytes, a note's next act 500 characters), so no choice is ever cut and every one can be copied whole. */
export const PROBE_BLOCK_CAP_BYTES = 16_384;

/** One stored question as the door reads it (a `continuity_probes` row's columns). */
export interface StoredQuestion {
  readonly qid: string; readonly cls: ProbeQuestion['cls']; readonly question: string;
  readonly choices: readonly string[] | null; readonly expected: string;
}

/** The question as the session sees and is graded on it: every text field passed through `mask` once. */
export function maskedQuestion(q: StoredQuestion, mask: (text: string) => string): ProbeQuestion {
  return {
    id: q.qid, cls: q.cls, text: mask(q.question), choices: q.choices === null ? null : q.choices.map(mask), expected: mask(q.expected),
  };
}

/** One answer graded: the session's text (null when it gave none for that question) and its grade. */
export interface GradedAnswer { readonly qid: string; readonly answer: string | null; readonly grade: ProbeGrade }

/** The question can be graded as served: its masked choices are fold-distinct and its masked expected answer is exactly one
 *  of them (a question with no choices, an id or `none`, always can). */
export function gradableAsServed(q: ProbeQuestion): boolean {
  if (q.choices === null) return true;
  const folded = q.choices.map(fold);
  return new Set(folded).size === folded.length && folded.filter((c) => c === fold(q.expected)).length === 1;
}

/** The answer carries a mask placeholder and is none of the served choices (nor the expected id): it was copied from a text
 *  the masker has since changed, so it proves nothing either way. */
const maskedAway = (q: ProbeQuestion, answer: string): boolean =>
  (answer.includes(SECRET_MASK) || answer.includes(SECRET_MASK_TOO_LARGE))
  && !(q.choices ?? [q.expected]).some((c) => fold(c) === fold(answer));

/** Every question of a round graded against the answers by question id. A question the door cannot grade as served, or an
 *  answer masked away, is `unmeasured`; otherwise a question with no answer fails: closed-form, an answer that is not given
 *  is not the expected one. */
export function gradeAnswers(questions: readonly ProbeQuestion[], answers: ReadonlyMap<string, string>): readonly GradedAnswer[] {
  return questions.map((q) => {
    const a = answers.get(q.id);
    const grade: ProbeGrade = !gradableAsServed(q) ? 'unmeasured' : a === undefined ? 'fail' : maskedAway(q, a) ? 'unmeasured' : gradeProbe(q, a);
    return { qid: q.id, answer: a ?? null, grade };
  });
}

/** The session's newest card or notes read, or that it could not be read. */
export type LastRead = { readonly kind: 'read'; readonly at: number | null } | { readonly kind: 'unmeasured' };

/** Closed-book, recorded honestly (Review Focus 3): `open` when the session read its card or notes at or after the round
 *  was asked, and `unmeasured` otherwise, since reads through other doors carry no attribution in W1a and a read that could
 *  not be measured proves nothing either way. Never `closed` in W1a: that needs W1's witness (slug
 *  closed-book-is-unmeasured-in-w1a). */
export function bookOf(last: LastRead, askedAt: number): BookState {
  if (last.kind === 'read' && last.at !== null && last.at >= askedAt) return 'open';
  return 'unmeasured';
}
/** The states this build can record (`bookOf`'s answers): `closed` is not among them in W1a. */
export const BOOK_STATES_RECORDED: readonly BookState[] = BOOK_STATES.filter((b) => b !== 'closed');

/** The page text of one round: what to do, each question as one untrusted block with its choices, and the command that
 *  answers. Split into pages by the card's own pager (`cardPages`), so a page stays under the tool result cut. */
export function probePages(roundId: string, kind: ProbeRoundKind, questions: readonly ProbeQuestion[]): readonly string[] {
  const head = [
    `Probe round ${roundId} (${kind}): ${questions.length} question(s), closed-book. Answer from memory, without reading your card,`
      + ' your notes or any file first.',
    `Answer each question with exactly one of its choices, copied as shown (the JSON string's text), or \`${PROBE_NONE}\`.`
      + ` A question with no choices takes an id, or \`${PROBE_NONE}\` when nothing is on record.`,
  ];
  const blocks = questions.map((q) => {
    const body = q.choices === null ? q.text : `${q.text}\nchoices: ${JSON.stringify(q.choices)}`;
    return `${q.id} (${q.cls})\n${untrustedBlock(body, PROBE_BLOCK_CAP_BYTES, 'not shown in full', CARD_TEXT_PREFACE)}`;
  });
  const example = JSON.stringify({ roundId, answers: questions.map((q) => ({ id: q.id, answer: '<your answer>' })) });
  const tail = `Answer them all in one call: ccrc-api probe answer --json - <<'JSON'\n${example}\nJSON`;
  return cardPages([...head, '', ...blocks, '', tail].join('\n'));
}
