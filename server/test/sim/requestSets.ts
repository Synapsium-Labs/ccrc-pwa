// The request record's deciders' mutant sets (Overlord W2 request record plan, Task A2). The cases are `requestCases.ts`, shared with
// `overlord-requests-policy.test.ts`; `mutation-floors.test.ts` runs each set against its textual mutants (D-8217's every-run floors).
// One mutant the real table cannot kill is left out on purpose: dropping `requestMoveEntersNeedsYou(move) ||` from the reason guard
// changes nothing while every move that enters needs-you also has a reason word, which the transitions test holds. Only a move that
// entered with no word could tell it apart.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MutantSet, SuiteCase } from './mutate.js';
import {
  answeredSinceNeedsYouCases, citationVerdictCases, closeUnownedVerdictCases, followUpAfterMoveCases, nextRequestIdCases,
  nextRequestStateCases, openMoveVerdictCases, parentClockAfterChildMoveCases, type RequestsModule,
} from '../requestCases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'server/src/coord/overlordRequests.ts');
const KEY = 'server/src/coord/overlordRequests.ts';
type M = RequestsModule;

const set = (cases: (m: M) => Record<string, SuiteCase>, mutants: MutantSet<M>['mutants']): MutantSet<M> =>
  ({ modulePath: MODULE, mutants, suite: cases });

const TAKEN = "  if (actor === 'overlord' && ctx.takenFrom !== null) return refuse('taken');\n";
const ANSWERED = "  if (actor === 'overlord' && state === 'needs-you' && !ctx.answered) return refuse('not-answered');\n";
const NOT_FROM = "  if (!row.from.includes(state)) return refuse('not-from');\n";
const WRONG_ACTOR = "  if (actor !== row.actor) return refuse('wrong-actor');\n";
const NOT_ALLOWED = "  if (ctx.fields.some((f) => !allowed.includes(f))) return refuse('field-not-allowed');\n";
const REQUIRED = "  if (required.some((f) => !ctx.fields.includes(f))) return refuse('field-required');\n";

const NEXT_SET = set(nextRequestStateCases, [
  { id: 'N1 a taken row is not read', old: TAKEN, new: '' },
  { id: 'N2 every actor meets a taken row', old: "actor === 'overlord' && ctx.takenFrom !== null", new: 'ctx.takenFrom !== null' },
  { id: 'N3 an unanswered row is not read', old: ANSWERED, new: '' },
  { id: 'N4 every actor meets an unanswered row', old: "actor === 'overlord' && state === 'needs-you' && !ctx.answered", new: "state === 'needs-you' && !ctx.answered" },
  { id: 'N5 every state is unanswered', old: "actor === 'overlord' && state === 'needs-you' && !ctx.answered", new: "actor === 'overlord' && !ctx.answered" },
  { id: 'N6 from is read before the taken row', old: TAKEN + ANSWERED + NOT_FROM, new: NOT_FROM + TAKEN + ANSWERED },
  { id: 'N7 from is not read', old: NOT_FROM, new: '' },
  { id: 'N8 the actor is not read', old: WRONG_ACTOR, new: '' },
  { id: 'N9 the actor is read before from', old: NOT_FROM + WRONG_ACTOR, new: WRONG_ACTOR + NOT_FROM },
  { id: 'N10 a hand back needs no taken state', old: "  if (HAND_BACK_MOVES.includes(move) && row.to !== ctx.takenFrom) return refuse('not-taken-from');\n", new: '' },
  { id: 'N11 a hand back needs any taken state', old: 'HAND_BACK_MOVES.includes(move) && row.to !== ctx.takenFrom', new: 'HAND_BACK_MOVES.includes(move) && ctx.takenFrom === null' },
  { id: 'N12 an answer needs no acknowledgement', old: "  if (move === 'answer' && !ctx.ownerAcknowledged) return refuse('not-acknowledged');\n", new: '' },
  { id: 'N13 the recorded answer needs the acknowledgement', old: "move === 'answer' && !ctx.ownerAcknowledged", new: "(move === 'answer' || move === 'answer-recorded') && !ctx.ownerAcknowledged" },
  { id: 'N14 close-unowned ignores open children', old: "['close-unowned', 'drop', 'escalate']", new: "['drop', 'escalate']" },
  { id: 'N15 drop ignores open children', old: "['close-unowned', 'drop', 'escalate']", new: "['close-unowned', 'escalate']" },
  { id: 'N16 escalate ignores open children', old: "['close-unowned', 'drop', 'escalate']", new: "['close-unowned', 'drop']" },
  { id: 'N17 two open children are needed', old: 'ctx.openChildren > 0', new: 'ctx.openChildren > 1' },
  { id: 'N18 no children is open children', old: 'ctx.openChildren > 0', new: 'ctx.openChildren >= 0' },
  { id: 'N19 an open child is read for every move', old: 'NO_OPEN_CHILD_MOVES.includes(move) && ctx.openChildren > 0', new: 'ctx.openChildren > 0' },
  { id: 'N20 route ignores children', old: "['route', 're-relay', 'route-elsewhere']", new: "['re-relay', 'route-elsewhere']" },
  { id: 'N21 re-relay ignores children', old: "['route', 're-relay', 'route-elsewhere']", new: "['route', 'route-elsewhere']" },
  { id: 'N22 route-elsewhere ignores children', old: "['route', 're-relay', 'route-elsewhere']", new: "['route', 're-relay']" },
  { id: 'N23 a relay reads open children only', old: 'CHILDLESS_ONLY_MOVES.includes(move) && ctx.hasChildren', new: 'CHILDLESS_ONLY_MOVES.includes(move) && ctx.openChildren > 0' },
  { id: 'N24 any move reads children', old: 'CHILDLESS_ONLY_MOVES.includes(move) && ctx.hasChildren', new: 'ctx.hasChildren' },
  { id: 'N25 a field is not checked', old: NOT_ALLOWED, new: '' },
  { id: 'N26 one allowed field excuses the rest', old: 'ctx.fields.some((f) => !allowed.includes(f))', new: 'ctx.fields.every((f) => !allowed.includes(f))' },
  { id: 'N27 a required field is not checked', old: REQUIRED, new: '' },
  { id: 'N28 one required field excuses the rest', old: 'required.some((f) => !ctx.fields.includes(f))', new: 'required.every((f) => !ctx.fields.includes(f))' },
  { id: 'N29 the required field is read before the allowed ones', old: NOT_ALLOWED + "  const required = REQUEST_MOVE_REQUIRED_FIELDS[move] ?? [];\n" + REQUIRED,
    new: "  const required = REQUEST_MOVE_REQUIRED_FIELDS[move] ?? [];\n" + REQUIRED + NOT_ALLOWED },
  { id: 'N30 a move that must carry a reason need not', old: "  if ((requestMoveEntersNeedsYou(move) || reasons.length > 0) && ctx.reason === null) return refuse('reason-required');\n", new: '' },
  { id: 'N31 only an entering move must carry a reason', old: ' || reasons.length > 0) && ctx.reason === null', new: ') && ctx.reason === null' },
  { id: 'N32 a reason is not checked', old: "  if (ctx.reason !== null && !reasons.includes(ctx.reason)) return refuse('reason-not-allowed');\n", new: '' },
  { id: 'N33 a move with no reasons takes any', old: 'ctx.reason !== null && !reasons.includes(ctx.reason)', new: 'ctx.reason !== null && reasons.length > 0 && !reasons.includes(ctx.reason)' },
  { id: 'N34 the reasons are read before the fields', old: NOT_ALLOWED + "  const required = REQUEST_MOVE_REQUIRED_FIELDS[move] ?? [];\n" + REQUIRED + "  const reasons = reasonsOfMove(move);\n"
    + "  if ((requestMoveEntersNeedsYou(move) || reasons.length > 0) && ctx.reason === null) return refuse('reason-required');\n",
  new: "  const reasons = reasonsOfMove(move);\n  if ((requestMoveEntersNeedsYou(move) || reasons.length > 0) && ctx.reason === null) return refuse('reason-required');\n"
    + NOT_ALLOWED + "  const required = REQUEST_MOVE_REQUIRED_FIELDS[move] ?? [];\n" + REQUIRED },
  { id: 'N35 the answer lands on the state it left', old: '  return { ok: true, to: row.to };\n}\n\n/** The insert', new: '  return { ok: true, to: state };\n}\n\n/** The insert' },
  { id: 'N36 every move is read from the drop row', old: "const row = requestTransition(move);\n  if (actor === 'overlord'", new: "const row = requestTransition('drop');\n  if (actor === 'overlord'" },
]);

const OPEN_SET = set(openMoveVerdictCases, [
  { id: 'O1 the wrong actor opens', old: 'actor === row.actor ?', new: "actor !== 'server' ?" },
  { id: 'O2 a request opens in another state', old: "{ ok: true, to: row.to } : { ok: false", new: "{ ok: true, to: 'routed' } : { ok: false" },
  { id: 'O3 the row is another move\'s', old: "requestTransition('open')", new: "requestTransition('route')" },
  { id: 'O4 nobody opens', old: "{ ok: true, to: row.to } : { ok: false, why: 'wrong-actor' }", new: "{ ok: false, why: 'wrong-actor' } : { ok: false, why: 'wrong-actor' }" },
]);

const CLOCKED_LINE = '.filter((s) => !UNCLOCKED_REQUEST_STATES.includes(s))';

const FOLLOW_SET = set(followUpAfterMoveCases, [
  { id: 'F1 an open child leaves the clock', old: '  if (m.openChildren > 0) return null;\n', new: '' },
  { id: 'F2 two open children are needed', old: 'm.openChildren > 0', new: 'm.openChildren > 1' },
  { id: 'F3 every state is clocked', old: '  if (!CLOCKED_REQUEST_STATES.includes(m.to)) return null;\n', new: '' },
  { id: 'F4 the promise is ignored', old: 'm.promiseAt ?? m.at + REQUEST_NEXT_MOVE_MS', new: 'm.at + REQUEST_NEXT_MOVE_MS' },
  { id: 'F5 a promise of zero is none', old: 'm.promiseAt ?? m.at + REQUEST_NEXT_MOVE_MS', new: 'm.promiseAt || m.at + REQUEST_NEXT_MOVE_MS' },
  { id: 'F6 the clock is due at once', old: 'm.promiseAt ?? m.at + REQUEST_NEXT_MOVE_MS', new: 'm.promiseAt ?? m.at' },
  { id: 'F7 the unclocked states are clocked', old: CLOCKED_LINE, new: '.filter(() => true)' },
  { id: 'F8 only the unclocked states are clocked', old: CLOCKED_LINE, new: '.filter((s) => UNCLOCKED_REQUEST_STATES.includes(s))' },
]);

const PARENT_SET = set(parentClockAfterChildMoveCases, [
  { id: 'P1 a parent with an open child is clocked', old: '  if (p.openChildrenAfter !== 0) return null;\n', new: '' },
  { id: 'P2 one open child is none', old: 'p.openChildrenAfter !== 0', new: 'p.openChildrenAfter > 1' },
  { id: 'P3 every parent state is clocked', old: '  if (!CLOCKED_REQUEST_STATES.includes(p.parentState)) return null;\n', new: '' },
  { id: 'P4 the clock is due at once', old: 'p.at + REQUEST_NEXT_MOVE_MS', new: 'p.at' },
  { id: 'P5 the unclocked states are clocked', old: CLOCKED_LINE, new: '.filter(() => true)' },
]);

const ANSWERED_SET = set(answeredSinceNeedsYouCases, [
  { id: 'A1 an entry does not withdraw an answer', old: 'if (enters) { entered = true; answered = false; }', new: 'if (enters) { entered = true; }' },
  { id: 'A2 an answer always answers', old: "answered = entered;", new: 'answered = true;' },
  { id: 'A3 an unknown word is not an entry', old: ": m.toState === 'needs-you';", new: ': false;' },
  { id: 'A4 every word is read by its toState', old: "isRequestMove(m.move) ? requestMoveEntersNeedsYou(m.move) : m.toState === 'needs-you'", new: "m.toState === 'needs-you'" },
  { id: 'A5 an entry is not remembered', old: 'if (enters) { entered = true; answered = false; }', new: 'if (enters) { answered = false; }' },
  { id: 'A6 an answer needs no entry', old: 'let entered = false;', new: 'let entered = true;' },
  { id: 'A7 any move to needs-you answers', old: "else if (m.move === 'answer-recorded') answered = entered;", new: "else if (m.toState === 'needs-you') answered = entered;" },
  { id: 'A8 the answer is not read', old: "else if (m.move === 'answer-recorded') answered = entered;", new: '' },
  { id: 'A9 a move that enters is read by the first answer only', old: 'if (enters) {', new: 'if (enters && !answered) {' },
]);

const CLOSE_SET = set(closeUnownedVerdictCases, [
  { id: 'C1 any state closes', old: "  if (f.state !== 'received') return 'not-received';\n", new: '' },
  { id: 'C2 done is not received', old: "f.state !== 'received'", new: "f.state === 'done'" },
  { id: 'C3 an open child is not read', old: "  if (f.openChildren > 0) return 'has-open-children';\n", new: '' },
  { id: 'C4 two open children are needed', old: 'f.openChildren > 0', new: 'f.openChildren > 1' },
  { id: 'C5 an act is not read', old: "  if (f.actKindsOnIt.some((k) => !CLOSE_UNOWNED_ACT_KINDS.includes(k))) return 'has-acts';\n", new: '' },
  { id: 'C6 every act must be foreign', old: 'f.actKindsOnIt.some((k) => !CLOSE_UNOWNED_ACT_KINDS.includes(k))', new: 'f.actKindsOnIt.every((k) => !CLOSE_UNOWNED_ACT_KINDS.includes(k))' },
  { id: 'C7 the acts are read before the children',
    old: "  if (f.openChildren > 0) return 'has-open-children';\n  if (f.actKindsOnIt.some((k) => !CLOSE_UNOWNED_ACT_KINDS.includes(k))) return 'has-acts';\n",
    new: "  if (f.actKindsOnIt.some((k) => !CLOSE_UNOWNED_ACT_KINDS.includes(k))) return 'has-acts';\n  if (f.openChildren > 0) return 'has-open-children';\n" },
  { id: 'C8 its own open is an act', old: "CLOSE_UNOWNED_ACT_KINDS: readonly string[] = ['open-request']", new: 'CLOSE_UNOWNED_ACT_KINDS: readonly string[] = []' },
  { id: 'C9 the state is read after the children',
    old: "  if (f.state !== 'received') return 'not-received';\n  if (f.openChildren > 0) return 'has-open-children';\n",
    new: "  if (f.openChildren > 0) return 'has-open-children';\n  if (f.state !== 'received') return 'not-received';\n" },
]);

const BOUND = "  if (c.ids.length > REQUEST_BOUNDS.cites) return refused('too-large', 'too-many', null);\n";
const REPEAT = "    if (seen.has(id)) return refused('bad-request', 'repeated', id);\n";
const MISSING = "    if (fact === undefined) return refused('unmeasured', 'unread', id, 'no fact was read for this id');\n";
const UNMEASURED = "    if (fact.read === 'unmeasured') return refused('unmeasured', 'unread', id, fact.why);\n";
const ABSENT = "  for (const { id, fact } of measured) if (fact.read === 'absent') return refused('said-not-operator', 'absent', id);\n";
const CHANGED = "  for (const { id, fact } of ok) if (!fact.hashMatches) return refused('said-not-operator', 'changed', id);\n";
const SPENT = "    for (const { id, fact } of ok) if (fact.state === 'spent') return refused('said-not-operator', 'spent', id);\n";
const WINDOW = "    for (const { id, fact } of ok) if (c.now - fact.at > ROOT_FOUND_WINDOW_MS) return refused('said-not-operator', 'spent', id);\n";

const CITE_SET = set(citationVerdictCases, [
  { id: 'Q1 nine ids is not too many', old: 'c.ids.length > REQUEST_BOUNDS.cites', new: 'c.ids.length > REQUEST_BOUNDS.cites + 1' },
  { id: 'Q2 eight ids is too many', old: 'c.ids.length > REQUEST_BOUNDS.cites', new: 'c.ids.length >= REQUEST_BOUNDS.cites' },
  { id: 'Q3 the bound is not read', old: BOUND, new: '' },
  { id: 'Q4 a repeat is not read', old: REPEAT, new: '' },
  { id: 'Q5 a repeat is not remembered', old: '    seen.add(id);\n', new: '' },
  { id: 'Q6 a missing fact is absent', old: MISSING, new: "    if (fact === undefined) return refused('said-not-operator', 'absent', id);\n" },
  { id: 'Q7 a missing fact is not read', old: MISSING, new: "    if (fact === undefined) continue;\n" },
  { id: 'Q8 an unmeasured fact is not read', old: UNMEASURED, new: '' },
  { id: 'Q9 an unmeasured fact is absent', old: UNMEASURED, new: "    if (fact.read === 'unmeasured') return refused('said-not-operator', 'absent', id);\n" },
  { id: 'Q10 an unmeasured fact loses its reason', old: "refused('unmeasured', 'unread', id, fact.why)", new: "refused('unmeasured', 'unread', id)" },
  { id: 'Q11 absent is read before unmeasured, id by id',
    old: UNMEASURED + '    measured.push({ id, fact });\n',
    new: "    if (fact.read === 'absent') return refused('said-not-operator', 'absent', id);\n" + UNMEASURED + '    measured.push({ id, fact });\n' },
  { id: 'Q12 an absent id is not read', old: ABSENT, new: '' },
  { id: 'Q13 a changed hash is not read', old: CHANGED, new: '' },
  { id: 'Q14 a changed hash is read before absence', old: ABSENT + "  const ok = measured.map((m) => ({ id: m.id, fact: m.fact as Extract<CitationFact, { read: 'ok' }> }));\n" + CHANGED,
    new: "  const ok = measured.map((m) => ({ id: m.id, fact: m.fact as Extract<CitationFact, { read: 'ok' }> }));\n" + CHANGED + ABSENT },
  { id: 'Q15 a spent state is not read', old: SPENT, new: '' },
  { id: 'Q16 the window is not read', old: WINDOW, new: '' },
  { id: 'Q17 exactly a day is spent', old: 'c.now - fact.at > ROOT_FOUND_WINDOW_MS', new: 'c.now - fact.at >= ROOT_FOUND_WINDOW_MS' },
  { id: 'Q18 a day and an hour is the window', old: 'c.now - fact.at > ROOT_FOUND_WINDOW_MS', new: 'c.now - fact.at > ROOT_FOUND_WINDOW_MS + 3_600_000' },
  { id: 'Q19 the window is read before the state', old: SPENT + WINDOW, new: WINDOW + SPENT },
  { id: 'Q20 a child meets the root rules', old: '  if (c.root) {\n', new: '  if (true) {\n' },
  { id: 'Q21 a root meets the child rule', old: '  } else {\n    for (const { id } of ok)', new: '  }\n  {\n    for (const { id } of ok)' },
  { id: 'Q22 a null root list cites everything', old: 'c.rootCites === null || !c.rootCites.has(id)', new: 'c.rootCites !== null && !c.rootCites.has(id)' },
  { id: 'Q23 the root list is not read', old: 'c.rootCites === null || !c.rootCites.has(id)', new: 'c.rootCites === null' },
  { id: 'Q24 a cite is always a root cite', old: 'root: c.root }', new: 'root: true }' },
  { id: 'Q25 a cite loses its hash', old: 'sha256: fact.sha256,', new: "sha256: ''," },
  { id: 'Q26 the cites come back reversed', old: 'cites: ok.map(', new: 'cites: [...ok].reverse().map(' },
  { id: 'Q27 the first of the cites only', old: 'cites: ok.map(', new: 'cites: ok.slice(0, 1).map(' },
  { id: 'Q28 a refusal loses its id', old: "const refused = (\n  word: 'too-large' | 'bad-request' | 'unmeasured' | 'said-not-operator',\n  detail: 'too-many' | 'repeated' | 'unread' | 'absent' | 'changed' | 'spent' | 'not-in-root', id: number | null, why: string | null = null,\n): CitationAnswer => ({ kind: 'refused', word, detail, id, why });",
    new: "const refused = (\n  word: 'too-large' | 'bad-request' | 'unmeasured' | 'said-not-operator',\n  detail: 'too-many' | 'repeated' | 'unread' | 'absent' | 'changed' | 'spent' | 'not-in-root', id: number | null, why: string | null = null,\n): CitationAnswer => ({ kind: 'refused', word, detail, id: null, why });" },
]);

const ID_SET = set(nextRequestIdCases, [
  { id: 'R1 the lower of the two', old: 'Math.max(', new: 'Math.min(' },
  { id: 'R2 the highest itself', old: '?? 0) + 1;', new: '?? 0) + 0;' },
  { id: 'R3 the store only', old: 'Math.max(storeHighest ?? 0, journalHighest ?? 0)', new: '(storeHighest ?? 0)' },
  { id: 'R4 the journal only', old: 'Math.max(storeHighest ?? 0, journalHighest ?? 0)', new: '(journalHighest ?? 0)' },
  { id: 'R5 a null store is one', old: 'storeHighest ?? 0', new: 'storeHighest ?? 1' },
  { id: 'R6 a null journal is one', old: 'journalHighest ?? 0', new: 'journalHighest ?? 1' },
  { id: 'R7 the sum of the two', old: 'Math.max(storeHighest ?? 0, journalHighest ?? 0)', new: '((storeHighest ?? 0) + (journalHighest ?? 0))' },
]);

/** One entry per decider, keyed `<path>#<function>`; `mutation-floors.test.ts` spreads it into `MUTANT_SETS`. */
export const REQUEST_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [`${KEY}#nextRequestState`]: NEXT_SET as MutantSet<never>,
  [`${KEY}#openMoveVerdict`]: OPEN_SET as MutantSet<never>,
  [`${KEY}#followUpAfterMove`]: FOLLOW_SET as MutantSet<never>,
  [`${KEY}#parentClockAfterChildMove`]: PARENT_SET as MutantSet<never>,
  [`${KEY}#answeredSinceNeedsYou`]: ANSWERED_SET as MutantSet<never>,
  [`${KEY}#closeUnownedVerdict`]: CLOSE_SET as MutantSet<never>,
  [`${KEY}#citationVerdict`]: CITE_SET as MutantSet<never>,
  [`${KEY}#nextRequestId`]: ID_SET as MutantSet<never>,
};
