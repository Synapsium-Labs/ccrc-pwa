// The Overlord's authority ladder, vocabulary (Overlord spec §7.5, Table 7.5a, H25; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-ladder.md` Task 1): L0, one concern. The four rungs, the cause
// table's row shape and its rows, the rung cells, the condition readings and the narrowing words. It imports NOTHING,
// not even `node:*`, because the PWA bundles this file. Every union below is the key set of a const map, and each map
// has a runtime list beside it, so a new member is a compile error in the map and never a silent wire change.

/** The four rungs, lowest first (§7.5, H25). `needs` is the server capability word a raise to it requires (plan
 *  question 1); a lowering never needs one. */
const RUNG_MAP = {
  off: { rank: 0, needs: null },
  chat: { rank: 1, needs: null },
  advise: { rank: 2, needs: 'overlord-route-v1' },
  full: { rank: 3, needs: 'overlord-answer-v1' },
} as const;
export type Rung = keyof typeof RUNG_MAP;
export const RUNGS = Object.keys(RUNG_MAP) as Rung[];
export function isRung(v: unknown): v is Rung {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(RUNG_MAP, v);
}
export function rungRank(r: Rung): number { return RUNG_MAP[r].rank; }
export function rungNeeds(r: Rung): string | null { return RUNG_MAP[r].needs; }
/** The rung an absent row reads (plan question 11). */
export const LADDER_DEFAULT_RUNG: Rung = 'chat';

/** The rows of Table 7.5a whose effect is not a cap are read by the one decider they name (§7.5; plan question 7). */
const LADDER_READER_MAP = {
  'launch-profile-unmet': 'the gate order step 6 refuses every door but card, probe and note',
} as const;
export type LadderReader = keyof typeof LADDER_READER_MAP;
export const LADDER_READERS = Object.keys(LADDER_READER_MAP) as LadderReader[];

/** What a row of the cause table does (plan question 7, and the W2 route plan's RV8 for `server-words`). */
export type LadderEffect =
  | { readonly kind: 'cap'; readonly cap: Rung }
  | { readonly kind: 'one-under-operator'; readonly floor: Rung }
  | { readonly kind: 'read-by'; readonly reader: LadderReader }
  | { readonly kind: 'server-words' };
/** The discriminators of the effect union, checked against every variant. */
const LADDER_EFFECT_KIND_MAP = {
  cap: true, 'one-under-operator': true, 'read-by': true, 'server-words': true,
} as const satisfies Record<LadderEffect['kind'], true>;
export const LADDER_EFFECT_KINDS = Object.keys(LADDER_EFFECT_KIND_MAP) as LadderEffect['kind'][];

const LADDER_NOTICE_MAP = { none: 'nothing', push: 'one push', item: 'one operator item' } as const;
export type LadderNotice = keyof typeof LADDER_NOTICE_MAP;
export const LADDER_NOTICES = Object.keys(LADDER_NOTICE_MAP) as LadderNotice[];

export interface LadderCauseRow {
  readonly kind: 'latch' | 'condition';
  readonly effect: LadderEffect;
  readonly notice: LadderNotice;
  readonly spec: string;               // the Table 7.5a row, in its own words
}

/** Every cause that is measured so far. Each later piece adds its row here (plan Table 2), never elsewhere. */
export const LADDER_CAUSE_MAP = {
  'generation-degraded': {
    kind: 'condition', effect: { kind: 'cap', cap: 'chat' }, notice: 'none',
    spec: 'a generation degraded (Table 7.5a, §3.3.11)',
  },
  'off-model': {
    kind: 'condition', effect: { kind: 'one-under-operator', floor: 'chat' }, notice: 'none',
    spec: 'a generation off the designated model, its replay not passed (Table 7.5a)',
  },
  'rung-word-missing': {
    kind: 'condition', effect: { kind: 'server-words' }, notice: 'none',
    spec: 'the operator\'s rung is above the highest rung whose word the server holds (the W2 route plan, RV8)',
  },
  // Serviceability PR B (plan w1-serviceability.md Task 7): an unmeasured line caps by this table's rule (ruled F3).
  'load-past-95': {
    kind: 'condition', effect: { kind: 'cap', cap: 'chat' }, notice: 'none',
    spec: 'the Overlord\'s accounts past the 95% load line (Table 7.5a, §6.8)',
  },
  'unwitnessed-third': {
    kind: 'latch', effect: { kind: 'cap', cap: 'advise' }, notice: 'push',
    spec: 'the third unwitnessed write in a day (Table 7.5a)',
  },
} as const satisfies Readonly<Record<string, LadderCauseRow>>;
export type LadderCause = keyof typeof LADDER_CAUSE_MAP;
export const LADDER_CAUSES = Object.keys(LADDER_CAUSE_MAP) as LadderCause[];
export type LadderConditionCause =
  { [K in LadderCause]: (typeof LADDER_CAUSE_MAP)[K]['kind'] extends 'condition' ? K : never }[LadderCause];
export type LadderLatchCause =
  { [K in LadderCause]: (typeof LADDER_CAUSE_MAP)[K]['kind'] extends 'latch' ? K : never }[LadderCause];

/** The shape a stored cause must have: the authority journal's own (`overlordAuthority.ts`, which reads these two). */
export const LADDER_CAUSE_KEY_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Bytes; the key is ASCII, so its length. */
export const LADDER_CAUSE_MAX = 64;
export function isLadderCauseKey(v: unknown): v is string {
  return typeof v === 'string' && v.length <= LADDER_CAUSE_MAX && LADDER_CAUSE_KEY_RE.test(v);
}

/** W1's rung cells (plan question 8). W2's act catalogue takes these rows over. `off` has no cell (§11.2). */
const RUNG_CELL_MAP = {
  read: { chat: 'allow', advise: 'allow', full: 'allow' },
  'write-note': { chat: 'allow', advise: 'allow', full: 'allow' },
  acknowledge: { chat: 'allow', advise: 'allow', full: 'allow' },
  // D-8809: the Overlord confirms one team candidate for a project, a call made in the operator's name: at `full` only.
  'link-team': { chat: 'refuse', advise: 'refuse', full: 'allow' },
} as const satisfies Readonly<Record<string, Readonly<Record<Exclude<Rung, 'off'>, 'allow' | 'refuse'>>>>;
export type LadderActKind = keyof typeof RUNG_CELL_MAP;
export const LADDER_ACT_KINDS = Object.keys(RUNG_CELL_MAP) as LadderActKind[];
export const RUNG_CELLS: typeof RUNG_CELL_MAP = RUNG_CELL_MAP;

/** The words every reader of the ladder shares. They are L0 because the read's wire carries them (plan F7). */
const CONDITION_READING_MAP = {
  standing: 'its input measures it',
  lifted: 'its input measured it ended',
  unmeasured: 'its input could not be read; its effect applies',
} as const;
export type ConditionReading = keyof typeof CONDITION_READING_MAP;
export const CONDITION_READINGS = Object.keys(CONDITION_READING_MAP) as ConditionReading[];

export interface Binding {
  readonly cause: string; readonly kind: 'latch' | 'condition'; readonly cap: Rung;
  readonly reading: Exclude<ConditionReading, 'lifted'>; readonly known: boolean;
}
export interface ReadByEntry {
  readonly cause: string; readonly reader: LadderReader; readonly reading: Exclude<ConditionReading, 'lifted'>;
}

const NARROWING_WHY_MAP = {
  'no-witness-yet': 'no witness off the volume holds it yet',
  'witness-unmeasured': 'the witness could not be asked',
  'not-journalled': 'written as its row only',
} as const;
export type NarrowingWhy = keyof typeof NARROWING_WHY_MAP;
export const NARROWING_WHYS = Object.keys(NARROWING_WHY_MAP) as NarrowingWhy[];
export type NarrowingState =
  | { readonly state: 'done' }
  | { readonly state: 'taking-effect'; readonly why: NarrowingWhy };
const NARROWING_STATE_MAP = { done: true, 'taking-effect': true } as const satisfies Record<NarrowingState['state'], true>;
export const NARROWING_STATES = Object.keys(NARROWING_STATE_MAP) as NarrowingState['state'][];

/** The session-gated ladder read. */
export interface LadderWire {
  readonly ok: true;
  readonly operatorRung: Rung; readonly operatorRungSource: 'set' | 'default'; readonly effectiveRung: Rung;
  readonly binding: readonly Binding[];
  readonly latches: readonly { cause: string; cap: Rung; raisedAt: number; detail: string; known: boolean; narrowing: NarrowingState }[];
  readonly conditions: readonly { cause: string; reading: ConditionReading; effect: LadderEffect }[];
  readonly readBy: readonly ReadByEntry[];
  readonly lastChange: { at: number; actor: string; narrowing: NarrowingState | null } | null;
  readonly rungs: readonly { rung: Rung; available: boolean; needs: string | null }[];
}

/** Plan question 23: the `needs` words no server build carries yet, each with its wave; shrink-only. */
export const RUNG_WORDS_NOT_YET_SHIPPED = { 'overlord-route-v1': 'W2', 'overlord-answer-v1': 'W3' } as const;
