// The Overlord's act catalogue (Overlord spec 2026-11-09 §7.1 C25 and H24; plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md`). Ring L0, context K: one row per act kind the Overlord
// can take, read by the ladder's `rungStep` (each row's `rungs`), and by every later decider that answers for an act. It
// imports only sibling `shared/` files, by type, and nothing at run time, because the PWA bundles this file. Every union is the
// key set of a const map, and each map has a runtime list beside it.
import type { Rung } from './overlord-ladder.js';

/** The five rung cell words (plan question 6). `rungStep` refuses only `refuse`; every other word passes and names its mode,
 *  which the decider of an act reads and binds into its allow. */
const RUNG_CELL_WORD_MAP = {
  allow: 'allowed at this rung',
  refuse: 'refused at this rung',
  proposal: 'staged for one tap',
  armed: 'allowed when the kind is armed, shadow while it is not',
  'by-grant': 'allowed only by a grant or a command',
} as const;
export type RungCellWord = keyof typeof RUNG_CELL_WORD_MAP;
export const RUNG_CELL_WORDS = Object.keys(RUNG_CELL_WORD_MAP) as RungCellWord[];
export function isRungCellWord(v: unknown): v is RungCellWord {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(RUNG_CELL_WORD_MAP, v);
}
/** A row's cells: one word at each rung but `off`, which has no cell (§11.2). */
export type RungCells = Readonly<Record<Exclude<Rung, 'off'>, RungCellWord>>;

/** W1's cells, moved from the ladder (index question 25). Each row's cells sit under `rungs`, because a catalogue row carries
 *  more columns. `off` has no cell (§11.2). */
const OVERLORD_ACT_KIND_MAP = {
  read: { rungs: { chat: 'allow', advise: 'allow', full: 'allow' } },
  'write-note': { rungs: { chat: 'allow', advise: 'allow', full: 'allow' } },
  acknowledge: { rungs: { chat: 'allow', advise: 'allow', full: 'allow' } },
  // D-8809: the Overlord confirms one team candidate for a project, a call made in the operator's name: at `full` only.
  'link-team': { rungs: { chat: 'refuse', advise: 'refuse', full: 'allow' } },
} as const satisfies Readonly<Record<string, { readonly rungs: RungCells }>>;
export type OverlordActKind = keyof typeof OVERLORD_ACT_KIND_MAP;
export const OVERLORD_ACT_KINDS: typeof OVERLORD_ACT_KIND_MAP = OVERLORD_ACT_KIND_MAP;
export const OVERLORD_ACT_KIND_LIST = Object.keys(OVERLORD_ACT_KIND_MAP) as OverlordActKind[];
export function isOverlordActKind(v: unknown): v is OverlordActKind {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(OVERLORD_ACT_KIND_MAP, v);
}
