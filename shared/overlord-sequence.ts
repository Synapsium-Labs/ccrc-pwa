// The one sequence's vocabulary (Overlord spec §10.4 "One sequence", H3, H27; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md` Tasks 1 and 3). L0, context K: the wire shape of one
// line, the table of stamped kinds, the bounds the writer checks, the retention figures and the cursor read's answer. It imports
// only other `shared/` files, and nothing from `node:*`, because the PWA may bundle it.
//
// A line carries ids, kinds, states and actors only, never a body (§10.4 "Payloads carry ids, kinds, states and actors only").
// Every id is opaque text: no reader parses one (slug `sequence-line-names-its-subject`).
import { GENERATION_STATES } from './continuity.js';
import { DESIGNATION_SEQUENCE_STATES } from './overlord-designation.js';
import { ACTOR_SUBJECT_MAX, type ActorKind } from './overlord-identity.js';
import { MESSAGE_STATES } from './operatorMessages.js';
import { RUNGS } from './overlord-ladder.js';
import { READINESS_WORDS } from './overlord-readiness.js';

/** A latch's two moves: its row inserted standing, and its clear stamped. The ladder's latch rows carry no state column (a latch
 *  stands while its clear is unset), so these words are named here, beside the one kind that stamps them (slug
 *  `ladder-stamps-ride-pr-b`). A cap narrowed by Confirm the restore is a value, not one of these, and stamps nothing. */
export const LADDER_LATCH_SEQUENCE_STATES = ['raised', 'cleared'] as const;

/** One line of the one sequence. `known` is false for a line whose kind or state this build lacks: its text is served as
 *  stored, opaque, never a failed page (slug `unknown-lines-are-served-opaque`). `actorKind` is `unknown` only on such a
 *  line, or on a stored kind word this build cannot name. */
export interface SequenceWireLine {
  readonly seq: number; readonly at: number; readonly kind: string; readonly id: string;
  readonly state: string; readonly actor: string; readonly actorKind: ActorKind | 'unknown'; readonly known: boolean;
}

/** Every stamped kind: its state words (from the kind's own L0 owner, never copied), how its id is chosen, and the spec text
 *  that stamps it. A later piece adds its kind here, beside its first stamped writer, and names its writers in the stamp
 *  census (`server/test/sequence-stamp-census.test.ts`). */
export const SEQUENCE_KIND_MAP = {
  generation: { states: GENERATION_STATES, id: 'the generation row id', spec: '§10.4 "a generation"' },
  designation: {
    states: DESIGNATION_SEQUENCE_STATES,
    id: 'the session the move concerns: the pending id for pending and failed, the bound id for live and retired',
    spec: '§10.4 "the designation"',
  },
  message: { states: MESSAGE_STATES, id: 'the operator message id', spec: '§10.4 "a message"' },
  'ladder-rung': { states: RUNGS, id: 'the fixed id operator: the one rung row', spec: '§10.4 "the ladder"' },
  'ladder-latch': { states: LADDER_LATCH_SEQUENCE_STATES, id: 'the latch cause', spec: '§10.4 "the ladder"' },
  readiness: { states: READINESS_WORDS, id: 'the session the word concerns, or none for absent', spec: '§10.4 "the readiness word"' },
} as const satisfies Readonly<Record<string, { readonly states: readonly string[]; readonly id: string; readonly spec: string }>>;
export type SequenceKind = keyof typeof SEQUENCE_KIND_MAP;
export const SEQUENCE_KINDS = Object.keys(SEQUENCE_KIND_MAP) as SequenceKind[];
export function isSequenceKind(v: unknown): v is SequenceKind {
  return typeof v === 'string' && Object.hasOwn(SEQUENCE_KIND_MAP, v);
}

/** The bounds the writer checks (opaque text, never parsed). An actor is the stamped row's actor subject, so its bound is the
 *  identity file's. */
export const SEQUENCE_ID_MAX = 200;
export const SEQUENCE_ACTOR_MAX = ACTOR_SUBJECT_MAX;
/** Table 11.5b: kept 90 days, by the server's wall clock. */
export const SEQUENCE_KEEP_MS = 90 * 24 * 3_600_000;
/** The most lines one retention pass deletes, so a long-stopped server catches up over a few passes. */
export const SEQUENCE_PRUNE_BATCH = 5_000;

/** What a reader learns of a restore: the restore generation, or `unmeasured` if the counter cannot be measured (slug
 *  `sequence-read-carries-the-restore-generation`). A reader that sees it move rewinds. */
export type RestoreGeneration = number | 'unmeasured';

/** The cursor read's answer (§10.4: "an explicit gap answer, never an empty page"). First match: `ahead` when the cursor is
 *  past the head (what a restored database looks like), `gap` when it is below the recorded prune floor, else a `page`, which
 *  is empty for a caught-up reader. `unmeasured` only when the sequence cannot be read. */
export type SequencePageWire =
  | { readonly kind: 'page'; readonly lines: readonly SequenceWireLine[]; readonly next: number; readonly head: number;
      readonly restoreGeneration: RestoreGeneration }
  | { readonly kind: 'gap'; readonly after: number; readonly prunedThrough: number; readonly head: number;
      readonly restoreGeneration: RestoreGeneration }
  | { readonly kind: 'ahead'; readonly after: number; readonly head: number; readonly restoreGeneration: RestoreGeneration }
  | { readonly kind: 'unmeasured'; readonly why: string };
/** The most lines one page serves. */
export const SEQUENCE_PAGE_MAX = 500;

/** The programme an Overlord-side server item is raised under: the weekly replay quiz's and the invariant monitor's (plan
 *  w1-sequence-monitor.md question 14, slug `invariant-items-sit-under-overlord`). One value, one home. */
export const OVERLORD_ITEM_PROGRAMME = 'overlord';
