// L1, context C3 (Session Conversation): the probes that measure a long-lived session's memory (Overlord spec §3.3.5,
// C41; §3.3.9, C52; the plan is `docs/superpowers/plans/2026-11-10-overlord/w1a-probes.md`, Tasks 1 to 3). Pure: the
// snapshot, the notes and the probe rows arrive as arguments, and chance comes only from the `Entropy` port, so one
// seed gives one round.
//
// - `probeRound` composes a round from the session's own rows: one question per class its role's `probeSet` carries and
//   the snapshot can support, topped up from `fact` to `PROBE_ROUND_MIN`; a snapshot too thin for that answers fewer
//   and says so (`short`, and a `skipped` line per class it could not ask).
// - `gradeProbe` grades one answer closed-form, and `roundVerdict` a round, all or nothing.
// - `fittedCeiling` fits the depth a model class holds its memory to, from closed-book spot probes, derived on read
//   (no table of its own, §3.3.6's one rule for derived values).
import type { CardFacts, CardNote, Fact } from '../../../shared/continuity-card.js';
import {
  FIT_PASS_RATE, FIT_WINDOW, PROBE_NONE, PROBE_ROUND_MAX, PROBE_ROUND_MIN, SPOT_PROBE_EVERY_TOKENS, type ProbeClass,
} from '../../../shared/continuity.js';
import { FLEET_ROLES, type FleetRole } from '../../../shared/fleetRoles.js';
import { TERMINAL_RUN_STATES } from '../../../shared/api.js';
import type { Entropy } from '../time/ports.js';

/** One question of a round. `expected` never leaves the server: the probe door serves the rest. `choices` is null when
 *  the answer is an id or `none` with no list to choose from (an abstention question). */
export interface ProbeQuestion {
  readonly id: string;
  readonly cls: ProbeClass;
  readonly text: string;
  readonly choices: readonly string[] | null;
  readonly expected: string;
}

/** A class the round could not ask, and why, so a short round says what it lacked. */
export interface ProbeSkip { readonly cls: ProbeClass; readonly why: string }

export type ProbeKind = 'start' | 'compaction' | 'spot';

/** A composed round. `short` is true when it asks fewer than its kind's least count (three, or one for a spot probe). */
export interface ProbeRound {
  readonly kind: ProbeKind;
  readonly questions: readonly ProbeQuestion[];
  readonly skipped: readonly ProbeSkip[];
  readonly short: boolean;
}

type Draft = Omit<ProbeQuestion, 'id'>;
interface Pool { readonly drafts: readonly Draft[]; readonly why: string }

/** Fisher-Yates, drawn from the port. */
function shuffle<T>(xs: readonly T[], entropy: Entropy): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = entropy.below(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** `n` distinct draws from `xs`, in drawn order (fewer when `xs` is shorter). */
function sample<T>(xs: readonly T[], n: number, entropy: Entropy): T[] {
  return shuffle(xs, entropy).slice(0, n);
}

const readOr = <T>(f: Fact<T>, absent: T): T => (f.kind === 'read' ? f.value : absent);

/** Two ids near the snapshot's that are not among them, so a decoy reads as a plausible id. */
function decoyIds(taken: readonly number[], entropy: Entropy): number[] {
  const lo = Math.max(1, Math.min(...taken) - 10);
  const hi = Math.max(...taken) + 10;
  const free: number[] = [];
  for (let n = lo; n <= hi; n++) if (!taken.includes(n)) free.push(n);
  return sample(free, 2, entropy);
}

/** True when `p` is `held` or lies under it. */
const under = (p: string, held: string): boolean => p === held || p.startsWith(`${held}/`);
const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/** fact: which run is open for a programme (one question per programme with exactly one open run of this session's),
 *  and which of three paths it holds a claim on (one question, the decoys built by crossing its own paths' directories
 *  and names, then from its runs' plan paths). */
function factPool(s: CardFacts, entropy: Entropy): Pool {
  const drafts: Draft[] = [];
  const runs = readOr(s.runs, []);
  const open = runs.filter((r) => !(TERMINAL_RUN_STATES as readonly string[]).includes(r.state));
  if (open.length > 0) {
    const decoys = decoyIds(runs.map((r) => r.id), entropy);
    for (const r of open) {
      if (open.filter((o) => o.programme === r.programme).length !== 1) continue;
      drafts.push({
        cls: 'fact', text: `Which run of yours is open for programme \`${r.programme}\`?`,
        choices: shuffle([...open.map((o) => String(o.id)), ...decoys.map(String)], entropy), expected: String(r.id),
      });
    }
  }
  const held = [...new Set(readOr(s.claims, []).flatMap((c) => c.paths))];
  const crossed = held.flatMap((a) => held.map((b) => `${dirOf(a)}${baseOf(b)}`));
  const plans = runs.flatMap((r) => (r.planPath === null ? [] : [r.planPath]));
  const decoyPaths = [...new Set([...crossed, ...plans])].filter((p) => !held.some((h) => under(p, h)));
  if (held.length > 0 && decoyPaths.length >= 2) {
    const target = held[entropy.below(held.length)]!;
    drafts.push({
      cls: 'fact', text: 'Which of these paths do you hold a claim on?',
      choices: shuffle([target, ...sample(decoyPaths, 2, entropy)], entropy), expected: target,
    });
  }
  return { drafts, why: 'no programme with one open run of yours, and no claim with two paths to set beside it' };
}

/** temporal: which of a family of timed rows came last (mail delivered to it, items it raised, notes it wrote). A family
 *  qualifies with three rows or more, so a question never offers fewer than three choices, and one newest. The card
 *  carries no time on a run, so runs are not a family (slug temporal-reads-timed-rows). */
function temporalPool(s: CardFacts, notes: readonly CardNote[], entropy: Entropy): Pool {
  const families: { text: string; rows: { id: number; at: number }[] }[] = [
    { text: 'Which of these deliveries reached you last?',
      rows: readOr(s.mailOutstanding, []).map((m) => ({ id: m.deliveryId, at: m.at })) },
    { text: 'Which of these items did you raise last?', rows: readOr(s.itemsRaised, []).map((i) => ({ id: i.id, at: i.at })) },
    { text: 'Which of these notes did you write last?', rows: notes.map((n) => ({ id: n.id, at: n.at })) },
  ];
  const drafts: Draft[] = [];
  for (const f of families) {
    if (f.rows.length < 3 || new Set(f.rows.map((r) => r.id)).size !== f.rows.length) continue;
    const newest = Math.max(...f.rows.map((r) => r.at));
    const top = f.rows.filter((r) => r.at === newest);
    if (top.length !== 1) continue;
    const rest = sample(f.rows.filter((r) => r !== top[0]), 3, entropy);
    drafts.push({ cls: 'temporal', text: f.text, choices: shuffle([top[0]!, ...rest].map((r) => String(r.id)), entropy),
      expected: String(top[0]!.id) });
  }
  return { drafts, why: 'no family of three or more timed rows with one newest' };
}

/** abstention: what the operator ruled on an item that has no ruling on record: an open item when the snapshot holds
 *  one, else an id no item of the snapshot carries. Both item reads must be measured, or "no ruling on record" is
 *  itself unmeasured. */
function abstentionPool(s: CardFacts, entropy: Entropy): Pool {
  const why = 'the ledger or the items raised are unmeasured, so no ruling can be shown absent';
  if (s.ledger.kind !== 'read' || s.itemsRaised.kind !== 'read') return { drafts: [], why };
  const items = [...s.ledger.value.flatMap((p) => p.openItems), ...s.itemsRaised.value];
  const open = items.filter((i) => i.state === 'open').map((i) => i.id);
  const id = open.length > 0 ? open[entropy.below(open.length)]! : Math.max(0, ...items.map((i) => i.id)) + 1 + entropy.below(1000);
  return { drafts: [{ cls: 'abstention', text: `What did the operator rule on item ${id}?`, choices: null, expected: PROBE_NONE }], why };
}

/** continuation: what a note says comes next, beside two other notes' text. Until the notes piece gives a note its own
 *  `next`, a note's text is what it says comes next (slug continuation-reads-note-text). Skipped with fewer than three
 *  notes of distinct text. */
function continuationPool(notes: readonly CardNote[], entropy: Entropy): Pool {
  const norm = (t: string): string => t.trim().toLowerCase();
  const drafts: Draft[] = [];
  for (const n of notes) {
    const others = notes.filter((o) => norm(o.text) !== norm(n.text));
    const distinct = others.filter((o, i) => others.findIndex((x) => norm(x.text) === norm(o.text)) === i);
    if (distinct.length < 2) continue;
    drafts.push({
      cls: 'continuation', text: `What does your note ${n.id} say comes next?`,
      choices: shuffle([n.text, ...sample(distinct, 2, entropy).map((o) => o.text)], entropy), expected: n.text,
    });
  }
  return { drafts, why: 'fewer than three notes of distinct text' };
}

/** The classes whose rows a card snapshot does not carry in W1a. */
const NOT_IN_W1A: Pool = { drafts: [], why: 'its rows are not on the card in W1a' };

function poolFor(cls: ProbeClass, s: CardFacts, notes: readonly CardNote[], entropy: Entropy): Pool {
  switch (cls) {
    case 'fact': return factPool(s, entropy);
    case 'temporal': return temporalPool(s, notes, entropy);
    case 'abstention': return abstentionPool(s, entropy);
    case 'continuation': return continuationPool(notes, entropy);
    case 'update': case 'decision': case 'contradiction': case 'application': case 'thread': return NOT_IN_W1A;
  }
}

/** A round for `role` over its generation's snapshot (start and compaction rounds), or over this generation's rows (a
 *  spot round of one). Draws one question per class of the role's `probeSet` the rows support, in a drawn order, until
 *  the round is full; then tops up from `fact`, when the role has it, to the kind's least count. */
export function probeRound(role: FleetRole, snapshot: CardFacts, notes: readonly CardNote[], entropy: Entropy,
  kind: ProbeKind): ProbeRound {
  const [least, most] = kind === 'spot' ? [1, 1] : [PROBE_ROUND_MIN, PROBE_ROUND_MAX];
  const drafts: Draft[] = [];
  const skipped: ProbeSkip[] = [];
  let factRest: Draft[] = [];
  for (const cls of shuffle(FLEET_ROLES[role].probeSet, entropy)) {
    const pool = poolFor(cls, snapshot, notes, entropy);
    const [first, ...rest] = shuffle(pool.drafts, entropy);
    if (first === undefined) skipped.push({ cls, why: pool.why });
    else if (drafts.length >= most) skipped.push({ cls, why: 'the round was full' });
    else {
      drafts.push(first);
      if (cls === 'fact') factRest = rest;
    }
  }
  while (drafts.length < least && factRest.length > 0) drafts.push(factRest.shift()!);
  const questions = drafts.map((d, i) => ({ id: `p${i + 1}`, ...d }));
  return { kind, questions, skipped, short: questions.length < least };
}

export type ProbeGrade = 'pass' | 'fail';
/** Whether the session read anything between ask and answer (the probe door records it, PR B). */
export type BookState = 'closed' | 'open' | 'unmeasured';

/** Closed-form: the answer, trimmed and case-folded, must be the expected one, and one of the choices when there is a
 *  list. Free text is never graded: an answer that is not the expected id, choice or `none` fails. */
export function gradeProbe(q: ProbeQuestion, answer: string): ProbeGrade {
  const fold = (t: string): string => t.trim().toLowerCase();
  if (q.choices !== null && !q.choices.some((c) => fold(c) === fold(answer))) return 'fail';
  return fold(answer) === fold(q.expected) ? 'pass' : 'fail';
}

/** A round passes only when it asked something and every answer passed. */
export function roundVerdict(grades: readonly ProbeGrade[]): 'passed' | 'failed' {
  return grades.length > 0 && grades.every((g) => g === 'pass') ? 'passed' : 'failed';
}

/** One spot probe at depth, as its row records it. */
export interface SpotProbe {
  readonly depthTokens: number;
  readonly grade: ProbeGrade;
  readonly closed: boolean;
  readonly modelClass: string;
}

/** The fitted ceiling of `modelClass` (C41): closed-book spot probes of that class, bucketed by depth in steps of
 *  `SPOT_PROBE_EVERY_TOKENS` (bucket k holds depths from k steps to just under k + 1). Walking up from the first step to
 *  the hard cap, a bucket is good when its last `FIT_WINDOW` probes pass at `FIT_PASS_RATE` or better. The first bucket
 *  that is short of `FIT_WINDOW` probes leaves the ceiling at the hard cap, not fitted; the first bad one fits the
 *  ceiling at the depth below it (zero when the first step is bad, slug no-good-depth-fits-zero); every bucket good up
 *  to the hard cap fits the hard cap. Never above `hardCap`. */
export function fittedCeiling(spots: readonly SpotProbe[], modelClass: string, hardCap: number): { tokens: number; fitted: boolean } {
  const buckets = new Map<number, ProbeGrade[]>();
  for (const s of spots) {
    if (!s.closed || s.modelClass !== modelClass) continue;
    const k = Math.floor(s.depthTokens / SPOT_PROBE_EVERY_TOKENS);
    buckets.set(k, [...(buckets.get(k) ?? []), s.grade]);
  }
  for (let k = 1; k * SPOT_PROBE_EVERY_TOKENS <= hardCap; k++) {
    const grades = buckets.get(k) ?? [];
    if (grades.length < FIT_WINDOW) return { tokens: hardCap, fitted: false };
    const window = grades.slice(-FIT_WINDOW);
    if (window.filter((g) => g === 'pass').length / FIT_WINDOW < FIT_PASS_RATE) {
      return { tokens: (k - 1) * SPOT_PROBE_EVERY_TOKENS, fitted: true };
    }
  }
  return { tokens: hardCap, fitted: true };
}
