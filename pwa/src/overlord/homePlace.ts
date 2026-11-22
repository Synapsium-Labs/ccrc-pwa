// The console's home, decided once (Overlord W1 home, Task 1; spec 2026-11-09 §4, C8, R9): L1, pure. No store, no DOM, no
// clock and no `lib/api.ts`; it imports types only, so the server's mutation sets can load it by path (`homeSets.ts`).
//
// THREE ANSWERS, EACH FROM ONE READ OF THE STORE (`stores/overlord.ts`):
// - `overlordShown`: the server advertises `overlord-v1` (index question 33, ruled F4). Without the word nothing of the
//   Overlord's is drawn: no door, no palette row, no Start, no Settings section, and the home is the Fleet.
// - `designationStateOf`: the designation read, narrowed to five kinds. An older server's 404 (`absent`) is `none`, "this
//   server has no Overlord", never `unmeasured`; a read that failed with no answer before it is `unmeasured`, never a value.
// - `homePlace`: where `/` lands. The Overlord place while one is designated and the operator's rung is not `off`, and the
//   Fleet otherwise. A designated Overlord whose rung cannot be read is still the home: Pause and the ladder's controls live
//   on the place, so sending the operator to the Fleet would hide the brake (plan question 3, ruled F11).
//
// THE RULES ARE TABLES (`HOME_TABLE`), read by the function and by the tests alike, so a new designation kind or rung class
// without a row is a compile error here and a red totality case there.
import type { DesignationView } from '../../../shared/overlord-designation';
import type { ReadState } from './readState';

/** The server capability word that draws the Overlord (plan question 9). Compared as a string here, held once: the word's
 *  `SERVER_CAP_MAP` row comes with the `overlord-v1` piece, which then points this name at its typed constant. */
export const OVERLORD_CAP = 'overlord-v1';

/** What the console knows of the designation, from one read. */
export type DesignationState =
  | { readonly kind: 'unmeasured'; readonly why: string }          // loading, 401, 5xx, timeout, network
  | { readonly kind: 'none' }                                     // no row, a retired row, or an older server (absent)
  | { readonly kind: 'failed-start'; readonly outcome: string }   // no binding, and the last attempt failed (§5.2)
  | { readonly kind: 'pending'; readonly sessionId: string }      // a designate or rebind awaiting its start
  | { readonly kind: 'bound'; readonly sessionId: string };

/** The ladder's `operatorRung`, or that it could not be read. */
export type RungRead = { readonly kind: 'unmeasured' } | { readonly kind: 'rung'; readonly rung: string };
/** The server's capability words (`GET /health`'s `caps`), or that they could not be read. */
export type CapRead = { readonly kind: 'unmeasured' } | { readonly kind: 'caps'; readonly caps: readonly string[] };

export type HomeAnswer =
  | { readonly place: 'overlord'; readonly why: 'designated' | 'rung-unmeasured' }
  | { readonly place: 'fleet'; readonly why: 'not-advertised' | 'none' | 'failed-start' | 'designation-unmeasured' | 'rung-off' };

/** True only for an answered read that names `OVERLORD_CAP`. */
export function overlordShown(caps: CapRead): boolean {
  return caps.kind === 'caps' && caps.caps.includes(OVERLORD_CAP);
}

/** The designation read, narrowed (plan Task 1's first table). A stale read keeps its last answer's state. */
export function designationStateOf(read: ReadState<DesignationView | null>): DesignationState {
  if (read.state === 'loading') return { kind: 'unmeasured', why: 'loading' };
  if (read.state === 'unmeasured') return { kind: 'unmeasured', why: read.error };
  if (read.state === 'absent') return { kind: 'none' };
  const row = read.value;
  if (row === null) return { kind: 'none' };
  if (row.bound !== null) return { kind: 'bound', sessionId: row.bound.sessionId };
  if (row.pending !== null) return { kind: 'pending', sessionId: row.pending.sessionId };
  // Designation's `goLive` clears the last attempt with the pending slot (slug `golive-clears-last-attempt`), so a last
  // attempt that stands is a failure that stands, unless the operator retired it.
  if (row.lastAttempt !== null && row.lastAttempt.outcome !== 'retired') return { kind: 'failed-start', outcome: row.lastAttempt.outcome };
  return { kind: 'none' };
}

/** How the home reads a rung: `off` sends it to the Fleet, an unread rung keeps the place, any other word is a rung. */
export type RungClass = 'off' | 'unmeasured' | 'other';
export function rungClassOf(rung: RungRead): RungClass {
  if (rung.kind === 'unmeasured') return 'unmeasured';
  return rung.rung === 'off' ? 'off' : 'other';
}

const FLEET = (why: Extract<HomeAnswer, { place: 'fleet' }>['why']): HomeAnswer => ({ place: 'fleet', why });
const DESIGNATED: Readonly<Record<RungClass, HomeAnswer>> = {
  off: FLEET('rung-off'),
  unmeasured: { place: 'overlord', why: 'rung-unmeasured' },
  other: { place: 'overlord', why: 'designated' },
};
const ALWAYS = (a: HomeAnswer): Readonly<Record<RungClass, HomeAnswer>> => ({ off: a, unmeasured: a, other: a });

/** The home while the server advertises `overlord-v1` (plan Task 1's second table): one row per designation kind, one cell
 *  per rung class. */
export const HOME_TABLE: Readonly<Record<DesignationState['kind'], Readonly<Record<RungClass, HomeAnswer>>>> = {
  bound: DESIGNATED,
  pending: DESIGNATED,
  'failed-start': ALWAYS(FLEET('failed-start')),
  none: ALWAYS(FLEET('none')),
  unmeasured: ALWAYS(FLEET('designation-unmeasured')),
};

/** The home without the word: the Fleet, whatever the designation reads. */
export const NOT_ADVERTISED: HomeAnswer = FLEET('not-advertised');

/** Where `/` lands. */
export function homePlace(caps: CapRead, d: DesignationState, rung: RungRead): HomeAnswer {
  if (!overlordShown(caps)) return NOT_ADVERTISED;
  return HOME_TABLE[d.kind][rungClassOf(rung)];
}

/** The caps read as the home reads it: an answer (or a stale one) is its words, anything else is unmeasured. */
export function capReadOf(read: ReadState<readonly string[]>): CapRead {
  return read.state === 'answered' || read.state === 'stale' ? { kind: 'caps', caps: read.value } : { kind: 'unmeasured' };
}

/** The ladder read as the home reads it: the operator's rung from an answer (or a stale one), and otherwise unmeasured. An
 *  older server with no ladder (`absent`) is unmeasured too: the rung is not known, and the place keeps the brake. */
export function rungReadOf(read: ReadState<{ readonly operatorRung: string }>): RungRead {
  return read.state === 'answered' || read.state === 'stale' ? { kind: 'rung', rung: read.value.operatorRung } : { kind: 'unmeasured' };
}

/** Whether the home is decided, so `/` may replace itself: no read the answer depends on is still loading. The caps decide
 *  first; with the word, the designation; for a designated Overlord, the ladder (its `off` sends the home to the Fleet). A
 *  failed read is decided (it answers the Fleet, or the place for an unread rung); only `loading` waits. */
export function homeSettled(
  caps: ReadState<readonly string[]>, designation: ReadState<DesignationView | null>, ladder: ReadState<unknown>,
): boolean {
  if (caps.state === 'loading') return false;
  if (!overlordShown(capReadOf(caps))) return true;
  if (designation.state === 'loading') return false;
  const d = designationStateOf(designation);
  return !((d.kind === 'bound' || d.kind === 'pending') && ladder.state === 'loading');
}

/** Whether the Overlord's door is drawn for a designation kind (spec §4: "while one is designated, and while a failed first
 *  start stands"). Read by `placesFor`, beside the word. */
export const OVERLORD_DOOR: Readonly<Record<DesignationState['kind'], boolean>> = {
  bound: true,
  pending: true,
  'failed-start': true,
  none: false,
  unmeasured: false,
};

/** The place's state word for a designation kind (PR A draws the place as its heading and this word; PR B the whole place). */
export const DESIGNATION_WORDS: Readonly<Record<DesignationState['kind'], string>> = {
  bound: 'The Overlord is running.',
  pending: 'The Overlord is starting.',
  'failed-start': 'The last start failed.',
  none: 'No Overlord is designated.',
  unmeasured: 'The designation could not be read.',
};
