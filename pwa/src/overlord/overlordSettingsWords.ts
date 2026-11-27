// Settings › Overlord: its words and its pure readers (Overlord W1 home C, Tasks 8 and 9; spec 2026-11-09 §3.4, Table 11.1a,
// Table 11.1d's Settings row; plan `w1-home.md` Tasks 8 and 9). Ring L1: no store, no React, no DOM, no clock and no
// `lib/api.ts`. It imports types, L0 shared vocabulary and other L1 modules only, and `now` is always an argument.
// `OverlordSection.tsx` and its cards (L4) draw what these answer and decide nothing.
//
// THE CONSOLE NEVER DECIDES WHAT A DOOR DECIDES (the brief's ruling 1). Nothing here says whether an act widens or narrows:
// every card sends its act, and the door asks the step-up, refuses or warns. What is here is reading. A read's answer is turned
// into its words, an answer's shape is checked before any field is read, and the three states stay three: an absent field is
// "not set", an unread one is unmeasured, and an empty one is said as empty. None of them becomes a default.
//
// THE GATE (plan question 3, ruled F11). The designation's cards are gated on the store's read as it stands:
// - `absent`, a 404 from an older server: "this server has no Overlord", and no control;
// - `loading`, or `unmeasured` with no answer before it: nothing can act on the designation until it is read;
// - an answer of `designation: null`: "Start the Overlord first";
// - an answer with a row, or a stale one: its controls, and a stale read says when it was last read.
// A door's `not-found` means "no designation row" only after the store has answered (`storeAnswered`): any unknown `/api` route
// also answers 404 `not-found`, so before an answer the console cannot tell an older server from a missing row.
import { OPEN_ITEM_STATES, type ItemState } from '../../../shared/ledgers';
import { OVERLORD_ITEM_PROGRAMME } from '../../../shared/overlord-sequence';
import { READINESS_ITEM_TEXT } from '../../../shared/overlord-readiness';
import type { DesignationView, OverlordModelClass } from '../../../shared/overlord-designation';
import type { PoolSet } from '../../../shared/poolset';
import { ACCOUNT_ID_RE } from '../../../shared/roster';
import type { FableBilling } from '../../../shared/rosterFacts';
import { clockOf } from './readinessWords';
import { MODEL_CLASS_OPTIONS, designateWarningText } from './placeWords';
import type { ReadState } from './readState';

// ── The gate ──

/** What the designation's cards may draw, from the store's read (plan question 3). */
export type OverlordGate =
  | { readonly kind: 'absent' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'unmeasured'; readonly error: string }
  | { readonly kind: 'none'; readonly staleAt: number | null }
  | { readonly kind: 'row'; readonly row: DesignationView; readonly staleAt: number | null };

/** The read, narrowed for Settings. Unlike `designationStateOf`, `absent` stays its own state: the home reads an older
 *  server as "no Overlord", but Settings says that this server has none, which is a different sentence from "start one". */
export function overlordGateOf(read: ReadState<DesignationView | null>): OverlordGate {
  switch (read.state) {
    case 'absent': return { kind: 'absent' };
    case 'loading': return { kind: 'loading' };
    case 'unmeasured': return { kind: 'unmeasured', error: read.error };
    case 'answered': case 'stale': {
      const staleAt = read.state === 'stale' ? read.at : null;
      return read.value === null ? { kind: 'none', staleAt } : { kind: 'row', row: read.value, staleAt };
    }
  }
}

/** Whether the store has answered the designation, so a door's `not-found` reads as "no designation row". */
export const storeAnswered = (g: OverlordGate): boolean => g.kind === 'none' || g.kind === 'row';

export const OVERLORD_SETTINGS_WORDS = {
  absent: 'This server has no Overlord.',
  loading: 'Loading…',
  unmeasured: (error: string) => `The Overlord's designation could not be read (${error}), so nothing here can change it until it can be.`,
  none: 'Start the Overlord first.',
  startOnPlace: 'Start it on the Overlord place',
  openPlace: 'Open the Overlord place',
  rebindOnPlace: 'Rebind it on the Overlord place',
  stale: (at: number) => `Last read at ${clockOf(at)}: this may be out of date.`,
  owedStops: (ids: readonly string[]) => `Still owed a stop: ${ids.join(', ')}. Retire sends the stop again.`,
  retire: 'Retire the Overlord',
  retiring: 'Retiring…',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved.',
  saveAgain: 'Save again',
  saveAgainWhy: 'Save again sends the saved set unchanged, which rewrites it on every Overlord session.',
  modelLegend: 'Model class',
  modelLater: "A new model class takes effect at the Overlord's next renewal.",
  setLegend: 'Accounts it may use',
  untagged: 'Untagged accounts',
  notRostered: (pool: string) => `${pool} (no account carries this pool)`,
  waitsForAccounts: 'The set waits for the accounts to load, so the set it sends is the one you see.',
  hourLabel: 'Hour',
  zoneLabel: 'Time zone',
  theDefault: 'the default',
  daysLabel: 'Days',
  backstopUnread: (error: string) => `The backstop could not be read (${error}).`,
  retentionUnread: (error: string) => `The retention could not be read (${error}).`,
  retentionStoredUnread: 'The stored retention could not be read. Saving a value over it asks you to confirm it is you.',
  readAgain: 'Read again',
} as const;

// ── The index's status line (plan Task 8) ──

/** The Overlord section's status on Settings' index. `null` is the skeleton: the read is still loading. */
export type OverlordStatus = { readonly text: string; readonly tone: 'calm' | 'amber' } | null;

const MODEL_LABEL: Readonly<Record<OverlordModelClass, string>> =
  Object.fromEntries(MODEL_CLASS_OPTIONS.map((o) => [o.value, o.label])) as Record<OverlordModelClass, string>;
/** A model class in words; a class this build does not know is drawn raw. */
export const modelLabelOf = (m: string): string => (Object.hasOwn(MODEL_LABEL, m) ? MODEL_LABEL[m as OverlordModelClass] : m);

export function overlordStatusOf(read: ReadState<DesignationView | null>): OverlordStatus {
  const g = overlordGateOf(read);
  switch (g.kind) {
    case 'loading': return null;
    case 'absent': return { text: 'This server has no Overlord', tone: 'calm' };
    case 'unmeasured': return { text: 'unmeasured', tone: 'amber' };
    case 'none': return { text: 'No Overlord', tone: 'calm' };
    case 'row': {
      const model = modelLabelOf(g.row.model);
      if (g.row.bound !== null) return { text: `Bound to ${g.row.bound.sessionId}, ${model}`, tone: 'calm' };
      if (g.row.pending !== null) return { text: `Starting ${g.row.pending.sessionId}, ${model}`, tone: 'calm' };
      return { text: `No Overlord, ${model}`, tone: 'calm' };
    }
  }
}

// ── The Overlord card ──

/** The Overlord card's state line for a row. */
export function bindingWordOf(row: DesignationView): string {
  if (row.bound !== null) return `Bound to ${row.bound.sessionId} (term ${row.term}).`;
  if (row.pending !== null) return `Starting ${row.pending.sessionId}.`;
  return 'Nothing is bound.';
}

/** Retire is drawn while something is bound or starting, or while the row still owes a stop: the door drains owed stops on a
 *  row with nothing bound, so the answer's "Retire again" must stay something the operator can follow (review 4056 F1). With
 *  none of the three, there is nothing for the door to do. */
export const retireOffered = (row: DesignationView): boolean => row.bound !== null || row.pending !== null || row.stopsOwed.length > 0;

const strings = (v: unknown): readonly string[] | null =>
  (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v as string[] : null);
const recordOf = (v: unknown): Record<string, unknown> | null =>
  (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** The retire door's answer: whether it changed the row, the term it ended, and the stops it carried out and still owes. */
export interface RetireAnswer {
  readonly changed: boolean; readonly term: number | null;
  readonly stopped: readonly string[]; readonly owed: readonly string[];
}

/** The one reader of the retire door's answer, or null for an answer it cannot read. `stopped` and `owed` absent read as
 *  none: the door answers them only when it drained. */
export function retireAnswerOf(body: unknown): RetireAnswer | null {
  const b = recordOf(body);
  if (b === null || typeof b.changed !== 'boolean') return null;
  const stopped = b.stopped === undefined ? [] : strings(b.stopped);
  const owed = b.owed === undefined ? [] : strings(b.owed);
  if (stopped === null || owed === null) return null;
  return { changed: b.changed, term: typeof b.term === 'number' ? b.term : null, stopped, owed };
}

/** The retire answer in words, one line each: what changed, what was stopped, and what is still owed a stop. */
export function retireWords(a: RetireAnswer | null): readonly string[] {
  if (a === null) return ['Retired, but the answer could not be read: the page reads the designation again.'];
  const out = [a.changed ? (a.term === null ? 'The Overlord was retired.' : `The Overlord was retired (term ${a.term}).`)
    : 'Nothing was bound, so nothing was retired.'];
  if (a.stopped.length > 0) out.push(`Stopped: ${a.stopped.join(', ')}.`);
  if (a.owed.length > 0) out.push(`Still owed a stop: ${a.owed.join(', ')}. Retire again to try the stop again.`);
  return out;
}

// ── The model class and the account set: their answers ──

const routeFailedWords = (written: unknown): string | null => {
  if (!Array.isArray(written)) return null;
  const failed = written.flatMap((w) => {
    const r = recordOf(w);
    return r !== null && r.ok === false && typeof r.sessionId === 'string' ? [r.sessionId] : [];
  });
  return failed.length === 0 ? null : `Saved, but not yet written to ${failed.join(', ')}: the next renewal writes it.`;
};

/** A warning beside a Settings save, in words: `overlord-single-account` with its count, `unknown-pool` as Start words it
 *  (`designateWarningText`, one definition), and a warning this build does not know drawn raw. */
export function settingsWarningText(w: unknown): string {
  const r = recordOf(w);
  if (r === null || typeof r.warning !== 'string') return 'A warning this console could not read.';
  if (r.warning === 'overlord-single-account') {
    return typeof r.count === 'number'
      ? `Only ${r.count} account${r.count === 1 ? '' : 's'} can serve it: the Overlord needs at least two.`
      : 'Fewer than two accounts can serve it: the Overlord needs at least two.';
  }
  return designateWarningText({ warning: r.warning, ...(typeof r.pool === 'string' ? { pool: r.pool } : {}) });
}

/** The model door's answer in words: no change, or the class set with "the next renewal", its warnings and any session it
 *  could not rewrite. An answer it cannot read says so. */
export function modelAnswerWords(body: unknown): readonly string[] {
  const b = recordOf(body);
  if (b === null || typeof b.changed !== 'boolean' || typeof b.model !== 'string') return ['Saved, but the answer could not be read: the page reads the designation again.'];
  if (!b.changed) return [`It is already ${modelLabelOf(b.model)}: nothing changed.`];
  const out = [`Set to ${modelLabelOf(b.model)}. ${OVERLORD_SETTINGS_WORDS.modelLater}`];
  if (Array.isArray(b.warnings)) out.push(...b.warnings.map(settingsWarningText));
  const failed = routeFailedWords(b.written);
  if (failed !== null) out.push(failed);
  return out;
}

/** The account set door's answer in words: saved or unchanged, the accounts it lists and how many can serve, the warnings,
 *  and any session it could not rewrite. An answer it cannot read says so. */
export function accountSetAnswerWords(body: unknown): readonly string[] {
  const b = recordOf(body);
  if (b === null || typeof b.changed !== 'boolean') return ['Saved, but the answer could not be read: the page reads the designation again.'];
  const out = [b.changed ? 'The account set was saved.' : 'The account set was already this: nothing changed.'];
  const accounts = recordOf(b.accounts);
  const list = accounts === null ? null : strings(accounts.list);
  const counted = accounts === null ? null : strings(accounts.counted);
  if (list !== null && counted !== null) {
    out.push(list.length === 0 ? 'It lists no account.' : `It lists ${list.join(', ')}; ${counted.length} can serve it.`);
  } else {
    out.push('Which accounts it lists was not in the answer.');
  }
  if (Array.isArray(b.warnings)) out.push(...b.warnings.map(settingsWarningText));
  const failed = routeFailedWords(b.written);
  if (failed !== null) out.push(failed);
  return out;
}

// ── The account set card's boxes ──

/** One box of the set: a pool, or the untagged accounts. `rostered` false is a saved pool no roster account carries. */
/** `rostered: null` is unread: the roster has not been heard, so whether any account carries the pool is not known (review
 *  4056 F6: unread is not absent, so no "no account carries this pool" verdict is drawn before the roster answers). */
export interface SetBox { readonly key: string; readonly pool: string | null; readonly rostered: boolean | null }

/** The boxes, in the SAVED set's order: the saved pools first, as saved, then each roster pool (`poolOptions`' answer, the
 *  same options Start uses) not in it, in the roster's order, then the untagged accounts. A saved pool the roster no longer
 *  carries keeps its box, so it can be switched off. `heard` is whether the roster has answered. */
export function setBoxesOf(saved: PoolSet, options: readonly string[], heard = true): readonly SetBox[] {
  return [
    ...saved.pools.map((p) => ({ key: p, pool: p, rostered: heard ? options.includes(p) : null })),
    ...options.filter((p) => !saved.pools.includes(p)).map((p) => ({ key: p, pool: p, rostered: true })),
    { key: '(untagged)', pool: null, rostered: true },
  ];
}

/** The set the card sends: the saved pools still on, in their saved order, then each pool switched on that was not saved, in
 *  the boxes' order; untagged as picked, else as saved. `picks` holds only the boxes the operator changed. */
export function editedSetOf(saved: PoolSet, options: readonly string[], picks: ReadonlyMap<string, boolean>): PoolSet {
  const on = (box: SetBox): boolean => picks.get(box.key) ?? (box.pool === null ? saved.untagged : saved.pools.includes(box.pool));
  const boxes = setBoxesOf(saved, options);
  return {
    pools: boxes.filter((b) => b.pool !== null && on(b)).map((b) => b.pool!),
    untagged: on(boxes[boxes.length - 1]!),
  };
}

/** Whether two sets say the same thing in the same order. */
export const sameSet = (a: PoolSet, b: PoolSet): boolean =>
  a.untagged === b.untagged && a.pools.length === b.pools.length && a.pools.every((p, i) => b.pools[i] === p);

// ── The renewal backstop ──

export interface BackstopView { readonly hour: number; readonly zone: string; readonly isDefault: boolean; readonly setAt: number | null }

/** The one reader of the backstop read's answer (and the save's, which answers the same view), or null. */
export function backstopOf(body: unknown): BackstopView | null {
  const b = recordOf(body);
  if (b === null || typeof b.hour !== 'number' || typeof b.zone !== 'string' || typeof b.isDefault !== 'boolean') return null;
  return { hour: b.hour, zone: b.zone, isDefault: b.isDefault, setAt: typeof b.setAt === 'number' ? b.setAt : null };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** The backstop's line: its own hour and zone, as read, and "the default" beside them when the read says so. */
export function backstopWords(v: BackstopView): string {
  return `Daily at ${pad2(v.hour)}:00, ${v.zone}${v.isDefault ? ` (${OVERLORD_SETTINGS_WORDS.theDefault})` : ''}.`;
}

/** The hours the picker offers: 0 to 23, the door's own bounds. */
export const BACKSTOP_HOURS: readonly number[] = Array.from({ length: 24 }, (_, h) => h);
export const hourLabel = (h: number): string => `${pad2(h)}:00`;

/** The zones the picker offers: the browser's list when it has one, with the saved zone kept in it; null, a free field, when
 *  the browser has none. The server's `Intl` check is the authority either way. */
export function zoneChoicesOf(browser: readonly string[] | null, saved: string | null): readonly string[] | null {
  if (browser === null || browser.length === 0) return null;
  return saved !== null && !browser.includes(saved) ? [saved, ...browser] : browser;
}

// ── The response retention ──

export interface RetentionView { readonly days: number | null; readonly min: number; readonly max: number; readonly default: number }

/** The one reader of the retention read's answer, or null. `days: null` with `unreadable` is the stored value unread, never a
 *  default; a missing `days` is an answer this console cannot read. */
export function retentionOf(body: unknown): RetentionView | null {
  const b = recordOf(body);
  if (b === null || typeof b.min !== 'number' || typeof b.max !== 'number' || typeof b.default !== 'number') return null;
  if (b.days === null && b.unreadable === true) return { days: null, min: b.min, max: b.max, default: b.default };
  return typeof b.days === 'number' ? { days: b.days, min: b.min, max: b.max, default: b.default } : null;
}

export function retentionWords(v: RetentionView): string {
  const bounds = `from ${v.min} to ${v.max} days`;
  return v.days === null ? `${OVERLORD_SETTINGS_WORDS.retentionStoredUnread} It may be ${bounds}.`
    : `Response rows are kept ${v.days} day${v.days === 1 ? '' : 's'}${v.days === v.default ? ` (${OVERLORD_SETTINGS_WORDS.theDefault})` : ''}. It may be ${bounds}.`;
}

/** The days the picker offers, from the read's own bounds. */
export const retentionChoicesOf = (v: RetentionView): readonly number[] =>
  Array.from({ length: Math.max(0, v.max - v.min + 1) }, (_, i) => v.min + i);

// ── Each account's facts (plan Task 9) ──

const BILLING_WORDS: Readonly<Record<FableBilling, string>> = { included: 'Fable is included', credits: 'Fable bills credits' };
export const NOT_SET = 'not set';

/** The billing fact in words. An absent field (nobody set it, or a server older than the field) is "not set", never
 *  `credits`: a missing fact is not a default (ruling 2). A word this build does not know is drawn raw. */
export function billingWordOf(a: { readonly fableBilling?: string }): string {
  const v = a.fableBilling;
  if (v === undefined) return NOT_SET;
  return Object.hasOwn(BILLING_WORDS, v) ? BILLING_WORDS[v as FableBilling] : v;
}

/** The continuity record in words: recorded, with its date, or "not set" for an absent field. */
export function continuityWordOf(a: { readonly continuity?: { readonly recordedAt?: unknown } }, dateOf: (ms: number) => string): string {
  const c = a.continuity;
  if (c === undefined) return NOT_SET;
  return typeof c.recordedAt === 'number' ? `Continuity recorded ${dateOf(c.recordedAt * 1000)}` : 'Continuity recorded (its date could not be read)';
}

export const FACT_WORDS = {
  billingLegend: 'Fable billing',
  continuityLegend: 'Continuity record',
  included: 'Included',
  credits: 'Bills credits',
  recordOn: 'Record continuity',
  recordOff: 'Clear the record',
  noAccounts: 'No account is on the roster.',
  waiting: 'Loading the accounts…',
  holdsUnread: (error: string) => `The Overlord's account holds could not be read (${error}), so a held account is not shown here.`,
  clear: 'Clear the hold',
  clearing: 'Clearing…',
  cleared: 'The hold was cleared.',
} as const;

// ── The account holds ──

export interface StandingHold { readonly lane: string; readonly cause: string; readonly heldAt: number }

/** The one reader of the holds read's answer, or null for one it cannot read. A row it cannot read makes the whole answer
 *  unreadable: a partial list would hide a held account. */
export function holdsOf(body: unknown): readonly StandingHold[] | null {
  const b = recordOf(body);
  if (b === null || !Array.isArray(b.holds)) return null;
  const out: StandingHold[] = [];
  for (const h of b.holds) {
    const r = recordOf(h);
    if (r === null || typeof r.lane !== 'string' || typeof r.cause !== 'string' || typeof r.heldAt !== 'number') return null;
    out.push({ lane: r.lane, cause: r.cause, heldAt: r.heldAt });
  }
  return out;
}

const HOLD_CAUSE_WORDS: Readonly<Record<string, string>> = { 'launch-profile-unmet': 'launch profile unmet' };
/** A standing hold's line: "Held: <cause>", a cause this build does not know drawn raw. */
export const holdLineOf = (h: { readonly cause: string }): string =>
  `Held: ${Object.hasOwn(HOLD_CAUSE_WORDS, h.cause) ? HOLD_CAUSE_WORDS[h.cause] : h.cause}`;

/** The lane an open Overlord hold item names, or null (plan Task 9, F17). The readiness lane raises one item per held lane,
 *  titled `<READINESS_ITEM_TEXT.hold.title>: <lane>` (L0's own grammar), in the Overlord's item programme; the lane must be an
 *  account id. An item no longer waiting (outside `OPEN_ITEM_STATES`), another programme's item or any other title names none, so no Clear is drawn for it. */
export function holdLaneOfItem(item: { readonly program: string; readonly title: string; readonly state: ItemState }): string | null {
  if (item.program !== OVERLORD_ITEM_PROGRAMME || !OPEN_ITEM_STATES.includes(item.state)) return null;
  const prefix = `${READINESS_ITEM_TEXT.hold.title}: `;
  if (!item.title.startsWith(prefix)) return null;
  const lane = item.title.slice(prefix.length);
  return ACCOUNT_ID_RE.test(lane) ? lane : null;
}
