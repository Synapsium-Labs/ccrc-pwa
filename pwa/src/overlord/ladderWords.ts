// The Overlord's authority ladder, in the console's words (Overlord W1 home B, Task 4; plan Global Constraints, "Authority" and
// "Failure contracts"): L1, pure, no store, no React, no DOM, no clock, no `lib/api.ts`. The cause sentences keyed by the cause
// key, the condition readings' words, the "taking effect" sentences, and the deciders the ladder part and its doors call:
// whether a rung move is a raise, what one rung's control is, and the "taking effect" line.
//
// EVERY CONTROL COMES FROM A ROW OF THE READ (H9). Nothing here lists the rungs, the latches or the conditions: the part
// draws `LadderWire.rungs`, `latches` and `conditions` as the server sent them, and a cause this build does not know
// (`known: false`, or no row below) is drawn by its key.
import {
  RUNG_WORDS_NOT_YET_SHIPPED, isRung, rungRank,
  type ConditionReading, type LadderCause, type LadderEffect, type LadderWire, type NarrowingState, type NarrowingWhy,
} from '../../../shared/overlord-ladder';
import type { ReadState } from './readState';

/** One sentence per cause of Table 7.5a (`LADDER_CAUSE_MAP`), in the operator's words. */
export const ladderCauseWords: Readonly<Record<LadderCause, string>> = {
  'generation-degraded': 'A generation of the Overlord degraded',
  'off-model': 'A generation ran on a model other than the designated one',
  'rung-word-missing': 'Your rung is above what this server advertises',
  'shared-user': 'The server shares its user with other work',
  'load-past-95': 'The Overlord\'s accounts are past the 95% load line',
  'unwitnessed-third': 'A third unwitnessed write in a day',
  'probes-failed-twice': 'Its probes failed twice after a renewal',
  'launch-profile-unengaged': 'Its launch profile is not engaged',
  'restore-detected': 'A restore was detected',
  'invariant-violation': 'The invariant monitor found a violation',
  'no-witness-since-boot': 'No witness off the server\'s volume has answered since boot',
};

/** What each condition reading says. */
export const conditionReadingWords: Readonly<Record<ConditionReading, string>> = {
  standing: 'Standing',
  lifted: 'Lifted',
  unmeasured: 'Unmeasured: its effect applies',
};

/** The line kept while a narrowing door's change has not yet been held by a witness off the server's volume (§7.6). */
export const takingEffectWords: Readonly<Record<NarrowingWhy, string>> = {
  'no-witness-yet': 'Taking effect: no witness has held it yet',
  'witness-unmeasured': 'Taking effect: the witness could not be measured',
  'not-journalled': 'Taking effect: not recorded in the journal yet',
};

/** The ladder read could not be taken (a 503, a timeout, an older server): never an empty ladder. */
export const LADDER_UNREADABLE = 'The ladder could not be read';
export const LADDER_LOADING = 'Loading…';

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** A cause drawn in words, or by its key when this build has no row for it. */
export function causeWords(cause: string): { readonly text: string; readonly known: boolean } {
  return has(ladderCauseWords, cause) ? { text: ladderCauseWords[cause as LadderCause], known: true } : { text: cause, known: false };
}

/** What a condition's effect does, in words. An effect kind this build does not know is drawn by its kind. */
export function effectWords(effect: LadderEffect): string {
  switch (effect.kind) {
    case 'cap': return `caps the rung at ${effect.cap}`;
    case 'one-under-operator': return `holds the rung one under yours, never below ${effect.floor}`;
    case 'read-by': return `read by the ${effect.reader} check`;
    case 'server-words': return 'limits the rung to what the server advertises';
    default: return String((effect as { kind?: unknown }).kind);
  }
}

const RUNG_LABEL: Readonly<Record<string, string>> = { off: 'Off', chat: 'Chat', advise: 'Advise', full: 'Full' };
/** A rung's label: the known ones capitalised, one this build does not know raw. */
export const rungLabel = (rung: string): string => (has(RUNG_LABEL, rung) ? RUNG_LABEL[rung]! : rung);

/** Is moving from `current` to `to` a raise? A raise goes through the step-up and a lowering does not (plan "Authority"). A rung
 *  either side of which this build does not know is a raise: the safe direction, since the step-up door asks the server's gate
 *  and a lowering sent through it still runs. The server's gate stays the authority. */
export function rungMovesUp(current: string, to: string): boolean {
  if (!isRung(current) || !isRung(to)) return true;
  return rungRank(to) > rungRank(current);
}

/** One rung's control, from its row of the read. */
export interface RungControl {
  readonly rung: string;
  readonly label: string;
  readonly current: boolean;
  readonly disabled: boolean;
  /** "Needs <word>" while the server does not advertise the word this rung needs; null otherwise. */
  readonly needs: string | null;
  /** The wave that ships the word (`RUNG_WORDS_NOT_YET_SHIPPED`), where this build knows it. */
  readonly arrives: string | null;
}

export function rungControlOf(
  row: { readonly rung: string; readonly available: boolean; readonly needs: string | null }, operatorRung: string,
): RungControl {
  const current = row.rung === operatorRung;
  const missing = !row.available && row.needs !== null;
  return {
    rung: row.rung,
    label: rungLabel(row.rung),
    current,
    disabled: current || !row.available,
    needs: missing ? `Needs ${row.needs}` : null,
    arrives: missing && row.needs !== null && has(RUNG_WORDS_NOT_YET_SHIPPED, row.needs)
      ? RUNG_WORDS_NOT_YET_SHIPPED[row.needs as keyof typeof RUNG_WORDS_NOT_YET_SHIPPED] : null,
  };
}

/** The "taking effect" line (F1, F14). Null unless a narrowing door (Pause or a rung lowered) answered a `narrowing`, present
 *  and not null: keyed on that, never on `changed`. Then the ladder read's `lastChange.narrowing` rules while the read has a
 *  reading of the change: its sentence while it reads `taking-effect`, null once it reads `done`. Before the ladder has a
 *  reading of the change (the read loading or failed, or no change recorded yet), the door's own answer holds the line. */
export function takingEffectLine(
  doorNarrowing: NarrowingState | null | undefined, ladder: ReadState<LadderWire>,
): string | null {
  if (doorNarrowing === null || doorNarrowing === undefined) return null;
  const read = ladder.state === 'answered' || ladder.state === 'stale' ? ladder.value.lastChange?.narrowing ?? null : null;
  const reading = read ?? doorNarrowing;
  if (reading.state !== 'taking-effect') return null;
  return has(takingEffectWords, reading.why) ? takingEffectWords[reading.why] : `Taking effect: ${reading.why}`;
}
