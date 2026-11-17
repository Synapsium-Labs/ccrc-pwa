// The Overlord's authority ladder, deciders (Overlord spec §7.5, Table 7.5a, §7.6, §11.2; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-ladder.md` Task 1). Ring L1, context C5: pure decisions over facts a
// door or a reader gathers. It imports L0 (`shared/overlord-ladder.ts`) only, makes no I/O and reads no clock, and it
// declares no wire type of its own: every word the wire carries is L0's. Deciders: `effectiveRung` (computed, never
// stepped), `rungMoveVerdict` (the rung door's and Pause's one decider), `offStep` and `rungStep` (the gate order's
// steps 4 and 10), `narrowingState` (§7.6's "taking effect") and the rung-word pair, `highestHeldRung` and
// `rungWordReading` (the W2 route plan's RV8 row, `rung-word-missing`).
import {
  LADDER_DEFAULT_RUNG, RUNGS, RUNG_CELLS, rungNeeds, rungRank, LADDER_EFFECT_KINDS, NARROWING_STATES,
  NARROWING_WHYS, LADDER_CAUSES, LADDER_READERS, LADDER_ACT_KINDS,
} from '../../../shared/overlord-ladder.js';
import type {
  Binding, ConditionReading, LadderActKind, LadderCauseRow, NarrowingState, ReadByEntry, Rung,
} from '../../../shared/overlord-ladder.js';

export interface LadderFacts {
  readonly operatorRung: { readonly kind: 'set'; readonly rung: Rung } | { readonly kind: 'default' };
  readonly latches: readonly { readonly cause: string; readonly cap: Rung }[];        // standing rows, stored caps
  /** `cause` is a string so a synthetic table works; production passes `LadderConditionCause` values. */
  readonly conditions: readonly { readonly cause: string; readonly reading: ConditionReading }[];
  readonly causeTable: Readonly<Record<string, LadderCauseRow>>;                     // LADDER_CAUSE_MAP in production
  /** The server's own capability words (`SERVER_CAPS`), which the `server-words` effect reads. */
  readonly serverCaps: readonly string[];
}
export interface EffectiveRung {
  readonly rung: Rung;                 // the lowest of everything below
  readonly operatorRung: Rung;         // the row's, or the default
  readonly binding: readonly Binding[];  // every latch and standing or unmeasured condition whose cap is at or below `rung`
  readonly readBy: readonly ReadByEntry[];
}

const rungOfRank = (rank: number): Rung => RUNGS.find((r) => rungRank(r) === rank) ?? 'off';
const lowest = (a: Rung, b: Rung): Rung => (rungRank(b) < rungRank(a) ? b : a);
const rowOf = (table: Readonly<Record<string, LadderCauseRow>>, cause: string): LadderCauseRow | undefined =>
  Object.prototype.hasOwnProperty.call(table, cause) ? table[cause] : undefined;

/** The highest rung whose `needs` word is none or one the server holds. */
export function highestHeldRung(serverCaps: readonly string[]): Rung {
  let best: Rung = 'off';
  for (const r of RUNGS) {
    const need = rungNeeds(r);
    if ((need === null || serverCaps.includes(need)) && rungRank(r) > rungRank(best)) best = r;
  }
  return best;
}

/** §7.5: total over the facts. A condition `unmeasured` applies its effect (plan question 17). */
export function effectiveRung(f: LadderFacts): EffectiveRung {
  const operator: Rung = f.operatorRung.kind === 'set' ? f.operatorRung.rung : LADDER_DEFAULT_RUNG;
  const caps: Binding[] = [];
  const readBy: ReadByEntry[] = [];
  for (const l of f.latches) {
    caps.push({ cause: l.cause, kind: 'latch', cap: l.cap, reading: 'standing', known: rowOf(f.causeTable, l.cause)?.kind === 'latch' });
  }
  for (const c of f.conditions) {
    if (c.reading === 'lifted') continue;
    const row = rowOf(f.causeTable, c.cause);
    if (row === undefined || row.kind !== 'condition') {
      caps.push({ cause: c.cause, kind: 'condition', cap: 'off', reading: c.reading, known: false });
      continue;
    }
    const e = row.effect;
    if (e.kind === 'read-by') {
      readBy.push({ cause: c.cause, reader: e.reader, reading: c.reading });
      continue;
    }
    const cap: Rung = e.kind === 'cap' ? e.cap
      : e.kind === 'server-words' ? highestHeldRung(f.serverCaps)
        : rungOfRank(Math.max(rungRank(e.floor), rungRank(operator) - 1));
    caps.push({ cause: c.cause, kind: 'condition', cap, reading: c.reading, known: true });
  }
  const rung = caps.reduce((acc, b) => lowest(acc, b.cap), operator);
  return { rung, operatorRung: operator, binding: caps.filter((b) => rungRank(b.cap) <= rungRank(rung)), readBy };
}

/** The `rung-word-missing` condition's input (W2 route plan RV8): standing when the operator's rung is above the highest
 *  rung whose word the server holds. An unreadable rung is unmeasured; the default reads `LADDER_DEFAULT_RUNG`. */
export function rungWordReading(operatorRung: CurrentRung, serverCaps: readonly string[]): ConditionReading {
  if (operatorRung.kind === 'unreadable') return 'unmeasured';
  const rung = operatorRung.kind === 'rung' ? operatorRung.rung : LADDER_DEFAULT_RUNG;
  return rungRank(rung) > rungRank(highestHeldRung(serverCaps)) ? 'standing' : 'lifted';
}

const RUNG_MOVE_WHY_MAP = { 'rung-unreadable': true } as const;
const DOOR_CLASS_MAP = { 'card-probe-note': true, other: true } as const;
const WITNESS_READING_MAP = { held: true, 'not-yet': true, unmeasured: true } as const;

/** The ladder's local and shared vocabulary, for the coordination kebab census. */
export const isLadderKebab = (word: string): boolean =>
  [LADDER_EFFECT_KINDS, NARROWING_STATES, NARROWING_WHYS, LADDER_CAUSES, LADDER_READERS, LADDER_ACT_KINDS,
    Object.keys(RUNG_MOVE_WHY_MAP), Object.keys(DOOR_CLASS_MAP), Object.keys(WITNESS_READING_MAP)]
    .some((words) => (words as readonly string[]).includes(word));

export type RungMove =
  | { readonly kind: 'same'; readonly rung: Rung }
  | { readonly kind: 'lower'; readonly from: Rung; readonly to: Rung }
  | { readonly kind: 'raise'; readonly from: Rung; readonly to: Rung }
  | { readonly kind: 'refuse'; readonly word: 'capability-missing'; readonly needs: string }
  | { readonly kind: 'refuse'; readonly word: 'unavailable'; readonly why: keyof typeof RUNG_MOVE_WHY_MAP };
/** The operator's rung as the brakes read it (plan question 21): a rung word, absent (the default), or a word this build
 *  cannot read. A database that cannot be read never reaches the decider: the door refuses first. */
export type CurrentRung =
  | { readonly kind: 'rung'; readonly rung: Rung } | { readonly kind: 'default' } | { readonly kind: 'unreadable' };

/** The rung door's and Pause's one decider. `pause` targets the lower of the current rung and `chat`. */
export function rungMoveVerdict(
  current: CurrentRung, ask: { readonly kind: 'set'; readonly to: Rung } | { readonly kind: 'pause' }, serverCaps: readonly string[],
): RungMove {
  if (current.kind === 'unreadable') {
    return ask.kind === 'pause' || ask.to === 'off'
      ? { kind: 'lower', from: 'full', to: 'off' }
      : { kind: 'refuse', word: 'unavailable', why: 'rung-unreadable' };
  }
  const from: Rung = current.kind === 'rung' ? current.rung : LADDER_DEFAULT_RUNG;
  const to: Rung = ask.kind === 'pause' ? lowest(from, 'chat') : ask.to;
  if (to === from) return { kind: 'same', rung: from };
  if (rungRank(to) < rungRank(from)) return { kind: 'lower', from, to };
  const needs = rungNeeds(to);
  if (needs !== null && !serverCaps.includes(needs)) return { kind: 'refuse', word: 'capability-missing', needs };
  return { kind: 'raise', from, to };
}

export type DoorClass = keyof typeof DOOR_CLASS_MAP;

/** The gate order's step 4 (§11.2): the operator's rung, not the effective one (Table 11.6). Step 4's second half,
 *  `mail-disabled` at an answer door, is W3's, which brings the answer doors (plan F16). */
export function offStep(operatorRung: Rung, door: DoorClass): { readonly pass: true } | { readonly pass: false; readonly word: 'overlord-off' } {
  return operatorRung === 'off' && door === 'other' ? { pass: false, word: 'overlord-off' } : { pass: true };
}

type RungCells = Readonly<Record<string, Readonly<Record<Exclude<Rung, 'off'>, 'allow' | 'refuse'>>>>;

/** Step 10's rung half: the act's cell at the effective rung, skipped by card, probe and note at `off`. `cells` is
 *  `RUNG_CELLS`; a caller passes no other table, a test passes a synthetic one. A cell no rung allows names `full`. */
export function rungStep(
  effective: Rung, door: DoorClass, act: LadderActKind, cells: RungCells = RUNG_CELLS,
): { readonly pass: true } | { readonly pass: false; readonly word: 'rung-below'; readonly needs: Rung } {
  if (effective === 'off' && door === 'card-probe-note') return { pass: true };
  const cell = cells[act]!;
  if (effective !== 'off' && cell[effective] === 'allow') return { pass: true };
  const needs = RUNGS.find((r) => r !== 'off' && cell[r] === 'allow') ?? 'full';
  return { pass: false, word: 'rung-below', needs };
}

/** §7.6: a narrowing is done once a witness off the volume holds its record. */
export function narrowingState(recordSequence: number | null, held: keyof typeof WITNESS_READING_MAP): NarrowingState {
  if (recordSequence === null) return { state: 'taking-effect', why: 'not-journalled' };
  if (held === 'held') return { state: 'done' };
  return { state: 'taking-effect', why: held === 'not-yet' ? 'no-witness-yet' : 'witness-unmeasured' };
}
