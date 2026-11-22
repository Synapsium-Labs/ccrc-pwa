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
// RAW WHEN NOTHING WAS COPIED (review 2068, F6). An answer that carries no mask placeholder was not copied from a masked
// text, so it is graded against the question as stored, unmasked: a wrong answer that differs from a choice only inside a
// masked secret then fails, where masked it would read as that choice. An answer that carries a placeholder is graded
// masked, as served, so a copied masked choice still passes.
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
import type { ReadCaller } from '../../../shared/operatorMessages.js';
import { identityOf, type DesignationFact } from '../roleOf.js';
import type { Read } from './hookReports.js';
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

/** The answer carries a mask placeholder: it was copied from a masked text. */
const hasPlaceholder = (answer: string): boolean => answer.includes(SECRET_MASK) || answer.includes(SECRET_MASK_TOO_LARGE);

/** A regular expression's literal text. */
const literal = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Each placeholder in an answer, as the text to split it at. */
const PLACEHOLDERS = new RegExp(`${literal(fold(SECRET_MASK))}|${literal(fold(SECRET_MASK_TOO_LARGE))}`);
/** The answer, read with each placeholder as a wildcard, is the whole of the stored choice `raw` (both folded). */
const wildcardMatches = (answer: string, raw: string): boolean =>
  new RegExp(`^${fold(answer).split(PLACEHOLDERS).map(literal).join('[\\s\\S]*')}$`).test(fold(raw));

/** The answer carries a mask placeholder, is none of the served choices, and, reading each placeholder as a wildcard, is
 *  still one of the stored choices: it was copied from a text the masker has since changed, so it proves nothing either way.
 *  One that matches no stored choice even so is a wrong answer, and fails (review 2103 F3): a placeholder never turns a
 *  failed round into an unmeasured one. Only a question with choices can be masked away (review 2068 F2): an answer to an id
 *  or `none` question copies no choice, so one that carries a secret's shape is graded, and fails unless it is the expected
 *  one. */
const maskedAway = (q: ProbeQuestion, answer: string, stored: readonly string[] | null): boolean =>
  q.choices !== null && hasPlaceholder(answer) && !q.choices.some((c) => fold(c) === fold(answer))
  && (stored ?? []).some((c) => wildcardMatches(answer, c));

/** The question as stored, unmasked: what an answer with no placeholder is graded against (review 2068 F6). */
const rawQuestion = (q: StoredQuestion): ProbeQuestion => ({ id: q.qid, cls: q.cls, text: q.question, choices: q.choices, expected: q.expected });

/** Every question of a round graded against the session's answers by question id, each answer as it was given. A question
 *  the door cannot grade as served (`gradableAsServed`, over the masked question), or an answer masked away, is
 *  `unmeasured`; otherwise a question with no answer fails: closed-form, an answer that is not given is not the expected one.
 *  An answer with no placeholder is graded against the stored question, one with a placeholder against the masked one
 *  (review 2068 F6). The answer is recorded masked. */
export function gradeAnswers(rows: readonly StoredQuestion[], answers: ReadonlyMap<string, string>, mask: (text: string) => string): readonly GradedAnswer[] {
  return rows.map((row) => {
    const q = maskedQuestion(row, mask);
    const a = answers.get(row.qid);
    const grade: ProbeGrade = !gradableAsServed(q) ? 'unmeasured' : a === undefined ? 'fail'
      : !hasPlaceholder(a) ? gradeProbe(rawQuestion(row), a) : maskedAway(q, mask(a), row.choices) ? 'unmeasured' : gradeProbe(q, mask(a));
    return { qid: row.qid, answer: a === undefined ? null : mask(a), grade };
  });
}

/** The session's newest card or notes read, or that it could not be read. */
export type LastRead = { readonly kind: 'read'; readonly at: number | null } | { readonly kind: 'unmeasured' };

/** The server's read ledger as closed-book reads it for one session (plan `w1-door-process.md` Task 9, ruled F10): whether
 *  the ledger covers the session, and how many of its lines fall between the ask and the answer. The plan's rule makes the
 *  designated session `covered`, on the premise that every read it makes goes through an Overlord read door that writes a
 *  ledger line. That premise holds only once such a door writes one: until then `covered` is false for every session, so no
 *  spot probe answers `closed` from card and notes stamps alone (`READ_LEDGER_WRITTEN`). A coordinator, a worker and a plain
 *  session are never covered (slugs `closed-book-reads-the-ledger`, `closed-book-waits-for-a-ledger-writer`). */
export type LedgerFacts = Read<{ readonly covered: boolean; readonly reads: number }>;

/** The port this door declares for the count (L2, declared by its consumer, built from the private store at composition; no
 *  C3 file imports the store). `callers` are the ledger's caller words for the designated session and its readers. A read
 *  that failed answers `unmeasured`, never zero. */
export interface ReadLedgerCount {
  readsBetween(callers: readonly ReadCaller[], from: number, to: number):
    { readonly kind: 'measured'; readonly value: number } | { readonly kind: 'unmeasured'; readonly why: string };
}
/** Whether any read door in this build writes the read ledger (`recordRead`, the private store's one writer of it). False in
 *  W1: nothing in `server/src` calls `recordRead`, so a designated session's reads leave no line and a ledger count of 0 proves
 *  nothing. While it is false the designated session is not `covered`, and its spot probes answer `unmeasured`, never `closed`:
 *  a `closed` would reach `closedSpotProbes` and through it `fittedCeilingOf` and the soft-ceiling trigger as evidence nobody
 *  measured (review 2870 F1, the coordinator's ruling). `probeDoorSets.ts` holds it equal to whether `server/src` has a
 *  `recordRead` caller, so the change that adds the first writer turns it true, and the plan's rule then applies unchanged. */
export const READ_LEDGER_WRITTEN = false;
/** The ledger's caller words that are the designated session's own reads: itself and the readers it starts. */
export const LEDGER_SESSION_CALLERS: readonly ReadCaller[] = ['overlord', 'reader'];

/** Who the ledger covers, and what its count was (`ReadLedgerCount`'s answer, or `null` when it was not asked). Covered only
 *  for the designated session (`identityOf` names it `overlord`), and only while a read door writes the ledger
 *  (`ledgerWritten`, `READ_LEDGER_WRITTEN` at the route); an unreadable designation or count is unmeasured. For a session the
 *  ledger does not cover, the ledger attributes nothing to it, so `reads` is 0 by construction and `covered: false` is what
 *  keeps `bookOf` from answering `closed`. */
export function ledgerFactsOf(i: { designation: DesignationFact | 'unmeasured'; callerId: string; ledgerWritten: boolean; reads: ReturnType<ReadLedgerCount['readsBetween']> | null }): LedgerFacts {
  if (i.designation === 'unmeasured') return { ok: false, detail: 'the designation could not be read' };
  if (identityOf(i.callerId, i.designation) !== 'overlord') return { ok: true, value: { covered: false, reads: 0 } };
  if (!i.ledgerWritten) return { ok: true, value: { covered: false, reads: 0 } };
  if (i.reads === null) return { ok: false, detail: 'the read ledger was not asked' };
  return i.reads.kind === 'measured' ? { ok: true, value: { covered: true, reads: i.reads.value } } : { ok: false, detail: i.reads.why };
}

/** Closed-book, recorded honestly (Review Focus 3; C41). `open` when the session read its card or notes at or after the round
 *  was asked, or when the ledger holds a read of its between ask and answer. `closed` only when the ledger covers the session,
 *  was measured, holds no such read, and the card and notes were measured with no read at or after the ask. `unmeasured`
 *  otherwise: a session the ledger does not cover, an unreadable ledger, and a card or notes read that could not be measured
 *  prove nothing either way. */
export function bookOf(last: LastRead, askedAt: number, ledger: LedgerFacts): BookState {
  if (last.kind === 'read' && last.at !== null && last.at >= askedAt) return 'open';
  if (!ledger.ok) return 'unmeasured';
  if (ledger.value.reads > 0) return 'open';
  if (ledger.value.covered && last.kind === 'read') return 'closed';
  return 'unmeasured';
}
/** The states this build can record (`bookOf`'s answers): all three. */
export const BOOK_STATES_RECORDED: readonly BookState[] = BOOK_STATES;

/** The page text of one round: what to do, each question as one untrusted block with its choices, and the command that
 *  answers. Split into pages by the card's own pager (`cardPages`), so a page stays under the tool result cut. `door` (the
 *  client's `--door`, the door process's reads: Overlord W1 door process A2) names the `probe_answer` door and its input in
 *  place of the shell command, for a session that has no shell. */
export function probePages(roundId: string, kind: ProbeRoundKind, questions: readonly ProbeQuestion[], door = false): readonly string[] {
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
  const tail = door ? `Answer them all in one call with the probe_answer door, its input:\n${example}`
    : `Answer them all in one call: ccrc-api probe answer --json - <<'JSON'\n${example}\nJSON`;
  return cardPages([...head, '', ...blocks, '', tail].join('\n'));
}
