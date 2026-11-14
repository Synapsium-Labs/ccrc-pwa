// L1, context C3 (Session Conversation): the probes that measure a long-lived session's memory (Overlord spec §3.3.5,
// C41; §3.3.9, C52; the plan is `docs/superpowers/plans/2026-11-10-overlord/w1a-probes.md`, Tasks 1 to 3). Pure: the
// snapshot and the probe rows arrive as arguments, and chance comes only from the `Entropy` port, so one seed gives one
// round.
//
// - `probeRound` composes a round from the session's own rows: one question per class its role's `probeSet` carries and
//   the snapshot can support, topped up from `fact` to `PROBE_ROUND_MIN`; a snapshot too thin for that answers fewer
//   and says so (`short`, and a `skipped` line per class it could not ask). A read that failed is never taken for an
//   empty one: it is named, and a short round is `unmeasured` when any class had a failed read, whether that read
//   emptied the class or only cost it questions (reviews 1999 F4, 2001 F-A).
// - `gradeProbe` grades one answer closed-form, and `roundVerdict` a round, all or nothing, with `unmeasured` kept apart.
// - `fittedCeiling` fits the depth a model class holds its memory to, from closed-book spot probes, derived on read
//   (no table of its own, §3.3.6's one rule for derived values).
import type { CardFacts, CardItem, CardNote, Fact } from '../../../shared/continuity-card.js';
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

/** A class the round could not ask, and why. `unmeasured` is true when a read it needed failed: the class may have had
 *  rows, and `why` names the reads by their own `what`. */
export interface ProbeSkip { readonly cls: ProbeClass; readonly why: string; readonly unmeasured: boolean }

export type ProbeKind = 'start' | 'compaction' | 'spot';

/** A composed round. `short` is true when it asks fewer than its kind's least count (three, or one for a spot probe);
 *  `unmeasured` is true when it is short and any class it consulted had a failed read, whether or not that class still
 *  asked something, so the shortfall may be the server's. A full round is never `unmeasured`. */
export interface ProbeRound {
  readonly kind: ProbeKind;
  readonly questions: readonly ProbeQuestion[];
  readonly skipped: readonly ProbeSkip[];
  readonly short: boolean;
  readonly unmeasured: boolean;
}

type Draft = Omit<ProbeQuestion, 'id'>;
/** A class's candidate questions; `unread` names each read the class needed that failed, whether or not it drafted. */
interface Pool { readonly drafts: readonly Draft[]; readonly why: string; readonly unread: readonly string[] }

/** The one fold grading uses: decoys are filtered by it too, so no decoy grades as the answer (review 1999, F5). */
const fold = (t: string): string => t.trim().toLowerCase();

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

/** A fact's value, or null when it was not read. */
const valueOf = <T>(f: Fact<T>): T | null => (f.kind === 'read' ? f.value : null);
/** The `what` of each fact that was not read. */
const unreadOf = (...facts: readonly Fact<unknown>[]): string[] =>
  facts.flatMap((f) => (f.kind === 'unmeasured' ? [f.what] : []));
/** A pool's reason: the failed reads when there are any, else what the rows lacked. */
const pool = (drafts: readonly Draft[], lacked: string, unread: readonly string[]): Pool =>
  ({ drafts, why: unread.length > 0 ? `not read: ${unread.join(', ')}` : lacked, unread });

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
 *  and names, then from its runs' plan paths, none folding equal to or under a held path). */
function factPool(s: CardFacts, entropy: Entropy): Pool {
  const drafts: Draft[] = [];
  const runs = valueOf(s.runs);
  const open = (runs ?? []).filter((r) => !(TERMINAL_RUN_STATES as readonly string[]).includes(r.state));
  if (runs !== null && open.length > 0) {
    const decoys = decoyIds(runs.map((r) => r.id), entropy);
    for (const r of open) {
      if (open.filter((o) => o.programme === r.programme).length !== 1) continue;
      drafts.push({
        cls: 'fact', text: `Which run of yours is open for programme \`${r.programme}\`?`,
        choices: shuffle([...open.map((o) => String(o.id)), ...decoys.map(String)], entropy), expected: String(r.id),
      });
    }
  }
  const held = [...new Set((valueOf(s.claims) ?? []).flatMap((c) => c.paths))];
  const heldFolded = held.map(fold);
  const crossed = held.flatMap((a) => held.map((b) => `${dirOf(a)}${baseOf(b)}`));
  const plans = (runs ?? []).flatMap((r) => (r.planPath === null ? [] : [r.planPath]));
  const decoyPaths = [...new Set([...crossed, ...plans])]
    .filter((p) => !heldFolded.some((h) => under(fold(p), h)))
    .filter((p, i, all) => all.findIndex((x) => fold(x) === fold(p)) === i);
  if (held.length > 0 && decoyPaths.length >= 2) {
    const target = held[entropy.below(held.length)]!;
    drafts.push({
      cls: 'fact', text: 'Which of these paths do you hold a claim on?',
      choices: shuffle([target, ...sample(decoyPaths, 2, entropy)], entropy), expected: target,
    });
  }
  return pool(drafts, 'no programme with one open run of yours, and no claim with two paths to set beside it',
    unreadOf(s.runs, s.claims));
}

/** temporal: which of a family of timed rows came last (mail sent to it, items it raised, notes it wrote). A family
 *  qualifies with three rows or more, so a question never offers fewer than three choices, and one newest. Each family
 *  is asked in the card's own word for its time: a delivery's `at` is when it was sent, so "sent" (review 1999, F1).
 *  The card carries no time on a run, so runs are not a family (slug temporal-reads-timed-rows). */
function temporalPool(s: CardFacts, entropy: Entropy): Pool {
  const families: { text: string; rows: { id: number; at: number }[] | null }[] = [
    { text: 'Which of these deliveries was sent last?',
      rows: valueOf(s.mailOutstanding)?.map((m) => ({ id: m.deliveryId, at: m.at })) ?? null },
    { text: 'Which of these items did you raise last?', rows: valueOf(s.itemsRaised)?.map((i) => ({ id: i.id, at: i.at })) ?? null },
    { text: 'Which of these notes did you write last?', rows: valueOf(s.notes)?.map((n) => ({ id: n.id, at: n.at })) ?? null },
  ];
  const drafts: Draft[] = [];
  for (const f of families) {
    if (f.rows === null || f.rows.length < 3 || new Set(f.rows.map((r) => r.id)).size !== f.rows.length) continue;
    const newest = Math.max(...f.rows.map((r) => r.at));
    const top = f.rows.filter((r) => r.at === newest);
    if (top.length !== 1) continue;
    const rest = sample(f.rows.filter((r) => r !== top[0]), 3, entropy);
    drafts.push({ cls: 'temporal', text: f.text, choices: shuffle([top[0]!, ...rest].map((r) => String(r.id)), entropy),
      expected: String(top[0]!.id) });
  }
  return pool(drafts, 'no family of three or more timed rows with one newest',
    unreadOf(s.mailOutstanding, s.itemsRaised, s.notes));
}

/** abstention: what the operator ruled on an item of the session's own record that carries no ruling: open and never
 *  ticked (a ticked item that was returned to `open` keeps its answer, review 1999, F2a). Never an id the snapshot does
 *  not hold (F2b): with no such item the class is skipped. The two item lists merge by id as the card merges them
 *  (`card.ts#itemsSections`: the items raised win), so the probe asks about the row the card showed (review 2001, F-D). */
function abstentionPool(s: CardFacts, entropy: Entropy): Pool {
  const byId = new Map<number, CardItem>();
  for (const p of valueOf(s.ledger) ?? []) for (const i of p.openItems) byId.set(i.id, i);
  for (const i of valueOf(s.itemsRaised) ?? []) byId.set(i.id, i);
  const unruled = [...byId.values()].filter((i) => i.state === 'open' && !i.everTicked).map((i) => i.id);
  const drafts: Draft[] = unruled.length === 0 ? [] : [{
    cls: 'abstention', text: `What did the operator rule on item ${unruled[entropy.below(unruled.length)]!}?`,
    choices: null, expected: PROBE_NONE,
  }];
  return pool(drafts, 'no open item on your record that was never ticked',
    unreadOf(s.ledger, s.itemsRaised));
}

/** continuation: what a note says comes next, beside two other notes' `next`: the note's own next act, which the notes piece
 *  gave it (it read the note's whole text until then, slug continuation-reads-note-text). Only threads with a next act that
 *  is not blank, as subjects and as decoys alike: a caution names no next act, and a blank choice would let a blank answer
 *  pass (review 2039, F1). Skipped with fewer than three such notes of distinct next acts. */
function continuationPool(s: CardFacts, entropy: Entropy): Pool {
  const notes: readonly CardNote[] = (valueOf(s.notes) ?? []).filter((n) => n.kind === 'thread' && fold(n.next) !== '');
  const drafts: Draft[] = [];
  for (const n of notes) {
    const others = notes.filter((o) => fold(o.next) !== fold(n.next));
    const distinct = others.filter((o, i) => others.findIndex((x) => fold(x.next) === fold(o.next)) === i);
    if (distinct.length < 2) continue;
    drafts.push({
      cls: 'continuation', text: `What does your note ${n.id} say comes next?`,
      choices: shuffle([n.next, ...sample(distinct, 2, entropy).map((o) => o.next)], entropy), expected: n.next,
    });
  }
  return pool(drafts, 'fewer than three threads of distinct next acts', unreadOf(s.notes));
}

/** The classes whose rows a card snapshot does not carry in W1a. */
const NOT_IN_W1A: Pool = { drafts: [], why: 'its rows are not on the card in W1a', unread: [] };

function poolFor(cls: ProbeClass, s: CardFacts, entropy: Entropy): Pool {
  switch (cls) {
    case 'fact': return factPool(s, entropy);
    case 'temporal': return temporalPool(s, entropy);
    case 'abstention': return abstentionPool(s, entropy);
    case 'continuation': return continuationPool(s, entropy);
    case 'update': case 'decision': case 'contradiction': case 'application': case 'thread': return NOT_IN_W1A;
  }
}

/** A round for `role` over its generation's snapshot (start and compaction rounds), or over this generation's rows (a
 *  spot round of one). Draws one question per class of the role's `probeSet` the rows support, in a drawn order, until
 *  the round is full; then tops up from `fact`, when the role has it, to the kind's least count. The notes are the
 *  snapshot's own `Fact`, so a failed notes read is seen as one. */
export function probeRound(role: FleetRole, snapshot: CardFacts, entropy: Entropy, kind: ProbeKind): ProbeRound {
  const [least, most] = kind === 'spot' ? [1, 1] : [PROBE_ROUND_MIN, PROBE_ROUND_MAX];
  const drafts: Draft[] = [];
  const skipped: ProbeSkip[] = [];
  let factRest: Draft[] = [];
  const unread = new Set<string>();
  for (const cls of shuffle(FLEET_ROLES[role].probeSet, entropy)) {
    const p = poolFor(cls, snapshot, entropy);
    for (const w of p.unread) unread.add(w);
    const [first, ...rest] = shuffle(p.drafts, entropy);
    if (first === undefined) skipped.push({ cls, why: p.why, unmeasured: p.unread.length > 0 });
    else if (drafts.length >= most) skipped.push({ cls, why: 'the round was full', unmeasured: false });
    else {
      drafts.push(first);
      if (cls === 'fact') factRest = rest;
    }
  }
  while (drafts.length < least && factRest.length > 0) drafts.push(factRest.shift()!);
  const questions = drafts.map((d, i) => ({ id: `p${i + 1}`, ...d }));
  const short = questions.length < least;
  return { kind, questions, skipped, short, unmeasured: short && unread.size > 0 };
}

export type ProbeGrade = 'pass' | 'fail';
/** Whether the session read anything between ask and answer (the probe door records it, PR B). */
export type BookState = 'closed' | 'open' | 'unmeasured';
export type RoundVerdict = 'passed' | 'failed' | 'unmeasured';

/** Closed-form: the answer, trimmed and case-folded, must be the expected one, and one of the choices when there is a
 *  list. Free text is never graded: an answer that is not the expected id, choice or `none` fails. */
export function gradeProbe(q: ProbeQuestion, answer: string): ProbeGrade {
  if (q.choices !== null && !q.choices.some((c) => fold(c) === fold(answer))) return 'fail';
  return fold(answer) === fold(q.expected) ? 'pass' : 'fail';
}

/** A round passes only when it asked something and every answer passed. A wrong answer fails it whatever else holds:
 *  it is the session's. Otherwise a round the snapshot's failed reads made short (`ProbeRound.unmeasured`) is
 *  `unmeasured`, never `failed`, so the session is not blamed for the server's read (review 1999, F4b); a measured empty
 *  round still fails (slug empty-round-fails). */
export function roundVerdict(grades: readonly ProbeGrade[], unmeasured: boolean): RoundVerdict {
  if (grades.some((g) => g === 'fail')) return 'failed';
  if (unmeasured) return 'unmeasured';
  return grades.length > 0 ? 'passed' : 'failed';
}

/** One spot probe at depth, as its row records it. `at` (epoch milliseconds) orders the window, so a reader may hand the
 *  rows in any order (review 1999, F8). */
export interface SpotProbe {
  readonly depthTokens: number;
  readonly grade: ProbeGrade;
  readonly closed: boolean;
  readonly modelClass: string;
  readonly at: number;
}

/** The fitted ceiling, or that no depth holds: the first step measured bad. No number stands for that (review 1999, F3):
 *  the reader that wires the ceiling decides what it means. */
export type FittedCeiling =
  | { readonly kind: 'ceiling'; readonly tokens: number; readonly fitted: boolean }
  | { readonly kind: 'no-depth-holds' };

/** The fitted ceiling of `modelClass` (C41): closed-book spot probes of that class, ordered by `at`, bucketed by depth in
 *  steps of `SPOT_PROBE_EVERY_TOKENS` (bucket k holds depths from k steps to just under k + 1). Walking up the buckets
 *  that start below the hard cap, a bucket with `FIT_WINDOW` probes is good when its last `FIT_WINDOW` pass at
 *  `FIT_PASS_RATE` or better, and bad otherwise. The first bad bucket caps the ceiling at the depth below it, and a bad
 *  first bucket answers `no-depth-holds`; with none bad the ceiling is the hard cap. The ceiling never sits above a
 *  depth measured bad at or past the first step (slug bad-depth-caps-the-ceiling, review 1999 F7); depths below the
 *  first step are never a bucket (review 2001, F-E). It is `fitted` only when every bucket below
 *  it held `FIT_WINDOW` probes and at least one bucket was examined (F6). Never above `hardCap`. */
export function fittedCeiling(spots: readonly SpotProbe[], modelClass: string, hardCap: number): FittedCeiling {
  const buckets = new Map<number, ProbeGrade[]>();
  const ours = spots.filter((s) => s.closed && s.modelClass === modelClass).sort((a, b) => a.at - b.at);
  for (const s of ours) {
    const k = Math.floor(s.depthTokens / SPOT_PROBE_EVERY_TOKENS);
    buckets.set(k, [...(buckets.get(k) ?? []), s.grade]);
  }
  let fitted = true;
  let examined = 0;
  for (let k = 1; k * SPOT_PROBE_EVERY_TOKENS < hardCap; k++) {
    examined++;
    const grades = buckets.get(k) ?? [];
    if (grades.length < FIT_WINDOW) {
      fitted = false;
      continue;
    }
    if (grades.slice(-FIT_WINDOW).filter((g) => g === 'pass').length / FIT_WINDOW < FIT_PASS_RATE) {
      return k === 1 ? { kind: 'no-depth-holds' } : { kind: 'ceiling', tokens: (k - 1) * SPOT_PROBE_EVERY_TOKENS, fitted };
    }
  }
  return { kind: 'ceiling', tokens: hardCap, fitted: fitted && examined > 0 };
}
