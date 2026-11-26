// The invariant monitor's deciders (Overlord spec §10.4 "One invariant monitor", §11.7, Table 11.7a, H33; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md` Tasks 4 to 6). Ring L1, context C5: pure, no clock,
// no database, no file. The gatherer (`invariantFacts.ts`, L3) reads every input in one synchronous span; the runner
// (`invariantLane.ts`, L4) asks `invariantVerdict` for every row and `findingMoves` for what to record, and decides nothing.
//
// THE TABLE IS TABLE 11.7a, ROW FOR ROW (`INVARIANT_MAP`). A row with a predicate runs; a row without one reads `not-applicable`
// with its reason: `tables-absent` when what it reads is not built yet, `predicate-not-built` when its tables are on `main` but
// its predicate has its own ticket (call 1219). I9 reads `simulator-only`. The piece that creates a row's tables adds its
// predicate here, as a row and a function, beside its gatherer (plan question 11, slug `predicates-join-with-their-tables`).
//
// NO FOLD OF `unmeasured` (Review Focus 4 and 6). An input the gatherer could not read makes its row `unmeasured`; a subject a
// predicate could not measure is listed beside the findings, never a pass and never a violation. Adding an unknown line, an
// unmeasured fact or a `known: false` line never turns an arm into `holds`, and never removes a finding, with one exception in
// the safe direction (review 3843 F7): a designation line this build cannot name makes I5's binding unknown, so a session line
// it found violated may read unmeasured instead.
import type { SequenceWireLine } from '../../../shared/overlord-sequence.js';
import { TIMER_MAIL_SENDER } from '../../../shared/continuity-timers.js';
import { rungRank } from '../../../shared/overlord-ladder.js';
import type { AuthorityState } from './overlordAuthorityCoherence.js';
import type { RestoreSide } from './overlordRestore.js';

/** One line of the one sequence, as the monitor reads it: the wire line (D-8214, moved from the simulator, which re-exports it). */
export type SequenceLine = SequenceWireLine;

/** A simulator invariant's first violation (moved from `server/test/sim/sequence.ts`, D-8214). */
export interface Violation { readonly invariant: string; readonly seq: number; readonly message: string }

// ── the table ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Why a row reads `not-applicable` (call 1219: a row whose tables are on `main` must not say they are absent). */
const NOT_APPLICABLE_WHY_MAP = { 'tables-absent': 'what the row reads is not built yet', 'predicate-not-built': 'its tables are on main; its predicate has its own ticket' } as const;
export type NotApplicableWhy = keyof typeof NOT_APPLICABLE_WHY_MAP;

interface InvariantRow {
  /** Table 11.7a's text, shortened. */
  readonly says: string;
  /** What the predicate reads. */
  readonly tables: readonly string[];
  /** The piece (or ticket) that adds what is missing; for a row that runs, what its later arms wait on, or null. */
  readonly waitsOn: string | null;
  /** How the row reads in W1. */
  readonly w1: 'runs' | 'simulator-only' | NotApplicableWhy;
}

/** Table 11.7a's rows (`server/test/single-definition/invariant-table.test.ts` reads the spec's table both ways). */
export const INVARIANT_MAP = {
  I1: { says: 'a held row is settled by its deadline or reaches the operator', tables: ['hold rows'], waitsOn: 'W3, the holds', w1: 'tables-absent' },
  I2: {
    says: 'a row that reached the operator has exactly one reach stamp and one outbox row',
    tables: ['asks', 'operator_items', 'push_outbox'], waitsOn: 'the state arm: W3, the deferral rows', w1: 'runs',
  },
  I3: { says: 'at most one effect per natural key, and every effect has an act row', tables: ['act rows'], waitsOn: 'W2, the acts', w1: 'tables-absent' },
  I4: { says: 'every act of a class other than none commits with its authority', tables: ['act rows', 'grants', 'commands'], waitsOn: 'W2, the acts; W3, the grants', w1: 'tables-absent' },
  I5: {
    says: 'a write is accepted only from the current term, generation and act key',
    tables: ['overlord_sequence', 'overlord_designation'], waitsOn: 'the generation and act-key arms: W2, the acts', w1: 'runs',
  },
  I6: { says: 'a lineage\'s class never loses a member of O1 to O6', tables: ['classes'], waitsOn: 'W3, the classes', w1: 'tables-absent' },
  I7: {
    says: 'after a restore, no authority field is wider than the journal\'s, and the term and the model class equal the journal\'s',
    tables: ['the authority journal', 'overlord_designation', 'overlord_ladder', 'overlord_latches'],
    waitsOn: 'the decision-model rows: after authority journal C', w1: 'runs',
  },
  I8: {
    says: 'after a crash, the next card lists every unsettled message and open hold',
    tables: ["the private store's messages", 'the card'], waitsOn: 'ticket invariant-message-predicates', w1: 'predicate-not-built',
  },
  I9: { says: 'while mayHold is false, question rows push as without the Overlord', tables: [], waitsOn: null, w1: 'simulator-only' },
  I10: { says: 'every open row is on the operator\'s list at all times', tables: ['hold rows', 'requests'], waitsOn: 'W2, the requests; W3, the holds', w1: 'tables-absent' },
  I11: {
    says: 'authority widens only by the operator',
    tables: ['overlord_sequence', 'overlord_ladder'], waitsOn: 'the rung arm: the ladder row\'s actor columns', w1: 'tables-absent',
  },
  I12: { says: 'every open request has a follow-up time or an open child that does', tables: ['requests'], waitsOn: 'W2, the requests', w1: 'tables-absent' },
  I13: {
    says: 'after a restore, the store serves nothing retired, replaced or wiped, and no id twice',
    tables: ["the private store's messages", 'the privacy journal'], waitsOn: 'ticket invariant-message-predicates; the entries: W2', w1: 'predicate-not-built',
  },
  I14: { says: 'no answer is delivered and no grant used while a latch or condition forbids it', tables: ['answers', 'grants'], waitsOn: 'W3, the answers and grants', w1: 'tables-absent' },
  I15: { says: 'an agreement joins a gate, cell or grant once, only from a scored operator answer', tables: ['gates'], waitsOn: 'W3, the gates', w1: 'tables-absent' },
  I16: { says: 'a drill, the replay body and the auditor cause no effect', tables: ['drills'], waitsOn: 'W3, the drills', w1: 'tables-absent' },
  I17: {
    says: 'a timer fires at most once, with the one mail naming it, to its setter',
    tables: ['continuity_timers', 'mail'], waitsOn: 'the arm that the setter\'s stamp still matches: Later', w1: 'runs',
  },
  I18: {
    says: 'a response row is sealed once, after its window, from what the server received',
    tables: ['operator_responses', 'response_receipts', 'response_boots'], waitsOn: 'ticket invariant-i18-seal-predicate', w1: 'predicate-not-built',
  },
} as const satisfies Readonly<Record<string, InvariantRow>>;
export type InvariantName = keyof typeof INVARIANT_MAP;
export const INVARIANT_NAMES = Object.keys(INVARIANT_MAP) as InvariantName[];
export function isInvariantName(v: unknown): v is InvariantName {
  return typeof v === 'string' && Object.hasOwn(INVARIANT_MAP, v);
}

// ── the verdict ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A finding: one subject a predicate measured as violated. `subject` is the predicate's own key for it. */
export interface Finding { readonly invariant: InvariantName; readonly subject: string; readonly seq: number | null; readonly message: string }
/** A subject the predicate could not measure, and why. */
export interface Unmeasured { readonly subject: string; readonly why: string }
/** Six arms (ruled, F4: the mixed arm). A violation always wins over what could not be measured, and carries it. */
export type InvariantVerdict =
  | { readonly kind: 'holds' }
  | { readonly kind: 'violated'; readonly findings: readonly Finding[]; readonly unmeasured: readonly Unmeasured[] }
  | { readonly kind: 'holds-where-measured'; readonly unmeasured: readonly Unmeasured[] }
  | { readonly kind: 'unmeasured'; readonly why: string }
  | { readonly kind: 'not-applicable'; readonly waitsOn: string; readonly why: NotApplicableWhy }
  | { readonly kind: 'simulator-only' };
export type InvariantVerdictKind = InvariantVerdict['kind'];
const VERDICT_KIND_MAP = {
  holds: true, violated: true, 'holds-where-measured': true, unmeasured: true, 'not-applicable': true, 'simulator-only': true,
} as const satisfies Record<InvariantVerdictKind, true>;
/** How a live finding's latch stood when it was recorded (`overlord_invariant_findings.latched`). */
const LATCHED_MAP = { raised: 'raised by this pass', standing: 'already standing', 'row-only': 'raised as its row alone' } as const;
export type FindingLatched = keyof typeof LATCHED_MAP;
/** The monitor's own words, for the coordination kebab census: each rides a verdict or a findings row, never a refusal. */
export const isInvariantKebab = (word: string): boolean =>
  [Object.keys(VERDICT_KIND_MAP), Object.keys(NOT_APPLICABLE_WHY_MAP), Object.keys(LATCHED_MAP)].some((words) => words.includes(word));

/** A facts arm, as the gatherer read it: `absent` when a table it reads has no migration applied. */
export type FactsRead<F> =
  | { readonly kind: 'measured'; readonly value: F }
  | { readonly kind: 'unmeasured'; readonly why: string }
  | { readonly kind: 'absent'; readonly what: string };

/** I2's facts: the reach-stamped sources, and the bound outbox rows. */
export interface I2Facts {
  readonly reached: readonly { readonly kind: 'ask' | 'item'; readonly id: number }[];
  readonly bound: readonly { readonly sourceKind: string; readonly sourceId: number }[];
}
/** I5's facts: the kept designation line (the window's baseline, below the prune floor; null when none is kept), and the current
 *  binding as the designation row reads it. */
export interface I5Facts {
  readonly baseline: SequenceLine | null;
  readonly current: { readonly kind: 'bound'; readonly sessionId: string } | { readonly kind: 'none' } | { readonly kind: 'unmeasured'; readonly why: string };
}
/** I7's facts: the authority guard's state, and the two sides Confirm the restore reads (call 1219: one model of each side). */
export interface I7Facts {
  readonly guard: AuthorityState;
  readonly rows: RestoreSide;
  readonly journal: RestoreSide;
}
/** I17's facts: every fired or cancelled timer, and each mail their `mailId`s name (absent from the map: no such mail). */
export interface I17Facts {
  readonly timers: readonly { readonly id: number; readonly setter: string; readonly state: string; readonly mailId: number | null }[];
  readonly mails: ReadonlyMap<number, { readonly fromId: string; readonly toId: string }>;
}
/** The facts each running row reads. A row joins here with its predicate. */
export interface InvariantFacts { I2: I2Facts; I5: I5Facts; I7: I7Facts; I17: I17Facts }

/** What the gatherer gives the predicates: the window's lines (above the prune floor), and each running row's facts. */
export interface InvariantInput {
  readonly lines: FactsRead<readonly SequenceLine[]>;
  readonly facts: { readonly [K in keyof InvariantFacts]?: FactsRead<InvariantFacts[K]> };
}
/** A live predicate: pure, total, over the lines and its own facts. */
export type LivePredicate<F> = (lines: readonly SequenceLine[], facts: F) => InvariantVerdict;

/** The verdict of what a predicate measured: findings win, then the unmeasured subjects, then `holds`. */
export function measuredVerdict(findings: readonly Finding[], unmeasured: readonly Unmeasured[]): InvariantVerdict {
  if (findings.length > 0) return { kind: 'violated', findings, unmeasured };
  if (unmeasured.length > 0) return { kind: 'holds-where-measured', unmeasured };
  return { kind: 'holds' };
}

// ── the predicates ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** I2's structural arm (ruled, F10), first match per subject: a reach-stamped source with no bound outbox row; a bound row whose
 *  source kind is not a word I2 names (unmeasured); a bound row whose source has no reach stamp. Subject `ask:<id>`/`item:<id>`. */
export const i2Structural: LivePredicate<I2Facts> = (_lines, f) => {
  const findings: Finding[] = [];
  const unmeasured: Unmeasured[] = [];
  const key = (kind: string, id: number): string => `${kind}:${id}`;
  const reached = new Set(f.reached.map((r) => key(r.kind, r.id)));
  const boundCount = new Map<string, number>();
  for (const b of f.bound) boundCount.set(key(b.sourceKind, b.sourceId), (boundCount.get(key(b.sourceKind, b.sourceId)) ?? 0) + 1);
  for (const subject of [...reached].sort()) {
    const n = boundCount.get(subject) ?? 0;
    if (n !== 1) findings.push({ invariant: 'I2', subject, seq: null, message: `reach-stamped with ${n} bound outbox rows` });
  }
  for (const subject of [...boundCount.keys()].sort()) {
    if (reached.has(subject)) continue;
    const kind = subject.slice(0, subject.indexOf(':'));
    if (kind !== 'ask' && kind !== 'item') unmeasured.push({ subject, why: 'a bound outbox row of a source kind I2 does not name' });
    else findings.push({ invariant: 'I2', subject, seq: null, message: 'a bound outbox row whose source has no reach stamp' });
  }
  return measuredVerdict(findings, unmeasured);
};

/** I5's term arm (designation A; the coordinator's ruling on the baseline, review 3740 F2, call 1077). Walk the window in seq
 *  order, the kept designation line first, tracking the binding the designation lines make: `live` binds its id, `retired` of
 *  the bound id ends the binding, `pending` and `failed` change nothing (a rebind's attempt never unbinds the standing body).
 *  A line whose actor kind is `session` is the Overlord's own act and must come from the bound session. `server` and
 *  `operator` lines are not read, and a designation line is a move of the binding, not a write under it. With no designation
 *  line before a session line, the current binding is used when no designation line follows it, else it is unmeasured. A
 *  designation line this build cannot name makes the binding unknown until the next known one. Subject `seq:<n>`. */
export const i5Term: LivePredicate<I5Facts> = (lines, f) => {
  const findings: Finding[] = [];
  const unmeasured: Unmeasured[] = [];
  const window = [...lines].sort((a, b) => a.seq - b.seq);
  const all = f.baseline !== null && !window.some((l) => l.seq === f.baseline!.seq) ? [f.baseline, ...window] : window;
  type Binding = { kind: 'known'; sessionId: string | null } | { kind: 'unknown'; why: string };
  let binding: Binding = { kind: 'unknown', why: 'no designation line before it' };
  const lastDesignation = all.reduce((m, l) => (l.kind === 'designation' ? l.seq : m), -1);
  for (const l of all) {
    const subject = `seq:${l.seq}`;
    if (l.kind === 'designation') {
      if (!l.known) { binding = { kind: 'unknown', why: `designation line ${l.seq} is of a state this build cannot name` }; continue; }
      if (l.state === 'live') binding = { kind: 'known', sessionId: l.id };
      else if (l.state === 'retired' && binding.kind === 'known' && binding.sessionId === l.id) binding = { kind: 'known', sessionId: null };
      else if (l.state === 'retired' && binding.kind === 'unknown') binding = { kind: 'known', sessionId: null };
      continue;
    }
    if (l.actorKind === 'server' || l.actorKind === 'operator') continue;
    if (!l.known || l.actorKind !== 'session') {
      unmeasured.push({ subject, why: 'a line this build cannot name, whose actor may be a session' });
      continue;
    }
    let bound: string | null;
    if (binding.kind === 'known') bound = binding.sessionId;
    else if (l.seq > lastDesignation && f.current.kind !== 'unmeasured') bound = f.current.kind === 'bound' ? f.current.sessionId : null;
    else {
      unmeasured.push({ subject, why: f.current.kind === 'unmeasured' && l.seq > lastDesignation ? `the designation could not be read: ${f.current.why}` : binding.why });
      continue;
    }
    if (bound === null) findings.push({ invariant: 'I5', subject, seq: l.seq, message: `a session line from ${l.actor} while nothing is bound` });
    else if (l.actor !== bound) findings.push({ invariant: 'I5', subject, seq: l.seq, message: `a session line from ${l.actor} while ${bound} is bound` });
  }
  return measuredVerdict(findings, unmeasured);
};

/** I7 (ruled, F2; call 1219; call 1286): read only while the authority guard reads `coherent`, else `unmeasured` with its cause.
 *  No authority field is wider than the journal's, and the term and the model class equal the journal's: neither has a width,
 *  so a row the journal does not witness is I7's subject in either direction. Compares the database's acted-on authority
 *  fields with the journal's fold, each side as Confirm the restore reads it (an absent side reads the narrowest value, ruling
 *  F8, on both sides alike). Violated when: the database binds and the journal does not, or binds another session or
 *  generation; the term differs; the model class differs; the account set has a pool the journal's
 *  lacks, or is `untagged` where the journal's is not; the rung ranks above the journal's; a latch the journal holds is not
 *  standing, or stands at a cap above the journal's. Decision-model rows are not compared (Later). Subject: the field. */
export const i7Authority: LivePredicate<I7Facts> = (_lines, f) => {
  if (f.guard.kind !== 'coherent') {
    const cause = f.guard.kind === 'rolled-back' ? f.guard.cause : f.guard.why;
    return { kind: 'unmeasured', why: `the authority guard reads ${f.guard.kind}: ${cause}` };
  }
  const { rows: db, journal: j } = f;
  const findings: Finding[] = [];
  const found = (subject: string, message: string): void => { findings.push({ invariant: 'I7', subject, seq: null, message }); };
  if (db.binding !== null && (j.binding === null || j.binding.sessionId !== db.binding.sessionId || j.binding.generation !== db.binding.generation)) {
    found('binding', j.binding === null ? 'the database binds a session the journal does not' : 'the database binds another session or generation');
  }
  if (db.term !== j.term) found('term', `the database term ${db.term} is not the journal's ${j.term}`);
  if (db.modelClass !== j.modelClass) found('modelClass', `the database model class ${db.modelClass} is not the journal's ${j.modelClass}`);
  if (db.accountSet.pools.some((p) => !j.accountSet.pools.includes(p)) || (db.accountSet.untagged && !j.accountSet.untagged)) {
    found('accountSet', 'the database account set is wider than the journal\'s');
  }
  if (rungRank(db.operatorRung) > rungRank(j.operatorRung)) found('operatorRung', `the database rung ${db.operatorRung} is above the journal's ${j.operatorRung}`);
  for (const l of j.latches) {
    const standing = db.latches.find((d) => d.cause === l.cause);
    if (standing === undefined) found(`latch:${l.cause}`, 'a latch the journal holds is not standing');
    else if (rungRank(standing.cap) > rungRank(l.cap)) found(`latch:${l.cause}`, `a latch stands at ${standing.cap}, above the journal's ${l.cap}`);
  }
  return measuredVerdict(findings, []);
};

/** I17 (ruled, F5): the timers against their mail, joined by `mailId`, never by the subject. First match per timer: a fired
 *  timer with no mail id, naming no mail, or naming a mail not from the timer sender or not to its setter; a cancelled timer
 *  with a mail id; a state word this build cannot name (unmeasured). Subject `timer:<id>`. */
export const i17Timers: LivePredicate<I17Facts> = (_lines, f) => {
  const findings: Finding[] = [];
  const unmeasured: Unmeasured[] = [];
  for (const t of [...f.timers].sort((a, b) => a.id - b.id)) {
    const subject = `timer:${t.id}`;
    const found = (message: string): void => { findings.push({ invariant: 'I17', subject, seq: null, message }); };
    if (t.state === 'cancelled') { if (t.mailId !== null) found(`a cancelled timer names mail ${t.mailId}`); continue; }
    if (t.state !== 'fired') { unmeasured.push({ subject, why: 'a timer state this build cannot name' }); continue; }
    if (t.mailId === null) { found('a fired timer names no mail'); continue; }
    const mail = f.mails.get(t.mailId);
    if (mail === undefined) found(`a fired timer names mail ${t.mailId}, which does not exist`);
    else if (mail.fromId !== TIMER_MAIL_SENDER) found(`a fired timer's mail ${t.mailId} is not from the timer sender`);
    else if (mail.toId !== t.setter) found(`a fired timer's mail ${t.mailId} is not to its setter`);
  }
  return measuredVerdict(findings, unmeasured);
};

/** The running rows' predicates, and whether each reads the window's lines. */
const PREDICATES: { readonly [K in keyof InvariantFacts]: { readonly run: LivePredicate<InvariantFacts[K]>; readonly readsLines: boolean } } = {
  I2: { run: i2Structural, readsLines: false },
  I5: { run: i5Term, readsLines: true },
  I7: { run: i7Authority, readsLines: false },
  I17: { run: i17Timers, readsLines: false },
};
const hasPredicate = (name: InvariantName): name is keyof InvariantFacts => Object.hasOwn(PREDICATES, name);

/** The one decider the runner asks per row, first match: `simulator-only` for I9; `not-applicable` with the row's reason for a
 *  row with no predicate; `not-applicable` (`tables-absent`) for an absent facts or lines arm it reads; `unmeasured` for an
 *  unmeasured one, or for no facts at all; otherwise the predicate's answer. */
export function invariantVerdict(name: InvariantName, input: InvariantInput): InvariantVerdict {
  const row: InvariantRow = INVARIANT_MAP[name];
  if (row.w1 === 'simulator-only') return { kind: 'simulator-only' };
  if (!hasPredicate(name)) return { kind: 'not-applicable', waitsOn: row.waitsOn ?? name, why: row.w1 === 'runs' ? 'predicate-not-built' : row.w1 };
  return runRow(name, input);
}
function runRow<K extends keyof InvariantFacts>(name: K, input: InvariantInput): InvariantVerdict {
  const p = PREDICATES[name];
  const facts = input.facts[name] as FactsRead<InvariantFacts[K]> | undefined;
  if (facts === undefined) return { kind: 'unmeasured', why: 'the gatherer gave no facts for this row' };
  const reads: FactsRead<unknown>[] = p.readsLines ? [input.lines, facts] : [facts];
  const absent = reads.find((r) => r.kind === 'absent');
  if (absent !== undefined && absent.kind === 'absent') return { kind: 'not-applicable', waitsOn: absent.what, why: 'tables-absent' };
  const un = reads.find((r) => r.kind === 'unmeasured');
  if (un !== undefined && un.kind === 'unmeasured') return { kind: 'unmeasured', why: un.why };
  const lines = p.readsLines && input.lines.kind === 'measured' ? input.lines.value : [];
  return p.run(lines, (facts as { kind: 'measured'; value: InvariantFacts[K] }).value);
}

// ── what a pass records ───────────────────────────────────────────────────────────────────────────────────────────────────

/** An open findings row, as the store reads it. */
export interface OpenFinding { readonly id: number; readonly invariant: string; readonly subject: string }

/** What a pass records and resolves, in one mode (plan question 12, slug `monitor-keeps-its-findings`): each finding of a
 *  `violated` verdict whose (invariant, subject) has no open row is new (two of one subject in one pass are one); each open row
 *  whose subject the pass measured as holding resolves: its invariant `holds`, or a `violated`/`holds-where-measured` verdict
 *  names it in neither list. An `unmeasured`, `not-applicable` or `simulator-only` verdict, a subject in an unmeasured list, and
 *  an open row of an invariant the pass did not ask, resolve nothing. */
export function findingMoves(verdicts: ReadonlyMap<InvariantName, InvariantVerdict>, open: readonly OpenFinding[]):
  { record: readonly Finding[]; resolve: readonly number[] } {
  const k = (invariant: string, subject: string): string => `${invariant}\u0000${subject}`;
  const openKeys = new Set(open.map((o) => k(o.invariant, o.subject)));
  const record: Finding[] = [];
  const seen = new Set<string>();
  for (const [, v] of verdicts) {
    if (v.kind !== 'violated') continue;
    for (const f of v.findings) {
      const key = k(f.invariant, f.subject);
      if (openKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      record.push(f);
    }
  }
  const resolve: number[] = [];
  for (const o of open) {
    if (!isInvariantName(o.invariant)) continue;
    const v = verdicts.get(o.invariant);
    if (v === undefined) continue;
    if (v.kind === 'holds') { resolve.push(o.id); continue; }
    if (v.kind !== 'violated' && v.kind !== 'holds-where-measured') continue;
    const still = v.kind === 'violated' && v.findings.some((f) => f.subject === o.subject);
    const unknown = v.unmeasured.some((u) => u.subject === o.subject);
    if (!still && !unknown) resolve.push(o.id);
  }
  return { record, resolve };
}

// ── the runner's two small questions ──────────────────────────────────────────────────────────────────────────────────────

/** The last pass the runner remembers: the sequence head it read, the mode it ran in, and when (monotonic). */
export interface LastPass { readonly head: number | 'unmeasured'; readonly mode: 'shadow' | 'live'; readonly atMono: number }
/** Whether a pass runs now (Table 11.1c's "on each `overlord_sequence` row", measured as "the head moved"): the first pass, a
 *  mode that changed, a head that moved or cannot be read, or the table invariants' own cadence elapsed (I2, I7 and I17 read
 *  tables that stamp no line). */
export function invariantPassDue(now: { head: number | 'unmeasured'; mode: 'shadow' | 'live'; atMono: number }, last: LastPass | null,
  tableSweepMs: number): boolean {
  if (last === null || now.mode !== last.mode) return true;
  if (now.head === 'unmeasured' || now.head !== last.head) return true;
  return now.atMono - last.atMono >= tableSweepMs;
}

/** How a live finding's latch stood, from the ladder's answer: raised now, already standing, or raised as its row alone over a
 *  journal that could not take the record; `null` for a refused raise, which records no live finding. */
export function latchedOf(w: { readonly ok: false } | { readonly ok: true; readonly changed: false } | { readonly ok: true; readonly changed: true; readonly journalled: boolean }):
  FindingLatched | null {
  if (!w.ok) return null;
  if (!w.changed) return 'standing';
  return w.journalled ? 'raised' : 'row-only';
}

/** The invariants whose verdict word moved since the last pass (one log line each), in table order. */
export function verdictWordChanges(prev: ReadonlyMap<InvariantName, InvariantVerdict> | null, next: ReadonlyMap<InvariantName, InvariantVerdict>):
  readonly { readonly name: InvariantName; readonly from: InvariantVerdictKind | null; readonly to: InvariantVerdictKind }[] {
  return INVARIANT_NAMES.flatMap((name) => {
    const to = next.get(name)?.kind;
    if (to === undefined) return [];
    const from = prev?.get(name)?.kind ?? null;
    return from === to ? [] : [{ name, from, to }];
  });
}
