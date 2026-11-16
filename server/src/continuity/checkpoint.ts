// L1, context C3 (Session Conversation): `assembleCheckpoint`, what a renewing generation hands its successor (Overlord spec
// §3.3.2 C37, §3.3.11 H12; W1a, plan `w1a-renewal-act.md` Task 3). The checkpoint is the identity's live notes, the handover
// note the ending generation wrote, and, for a coordinator only, its last ten rulings: the operator's own decisions, sent to it
// as mail, kept verbatim and newest first. Pure: every reading arrives as an argument, nothing is read or written here. The
// generations lane (L4) gathers the facts, calls this once for the generation it renews, and stores the answer
// (`putCheckpoint`); the card reads the stored row back (`checkpointBefore`). Which mail rows are rulings is measured in the
// departures note (`w1a-renewal-act/departures.md`, rulings-rows) and read by `rulingRowsOf` (`continuityStore.ts`).
//
// A HARD TRIGGER CARRIES NO HANDOVER NOTE. A hard renewal drains at the next turn end and never asks for a handover (the
// machine goes `draining` to `clearing`), so a note a session wrote earlier in the generation is not this renewal's: the
// checkpoint holds none, whatever was given.
import type { FleetRole } from '../../../shared/fleetRoles.js';
import type { HandoverNote, NoteKey, NoteKind, TriggerClass } from '../../../shared/continuity.js';

/** How many rulings a coordinator's checkpoint carries, at most (spec §3.3.2). */
export const CHECKPOINT_RULINGS_MAX = 10;

const RULING_SOURCE_MAP = {
  tick: "an item's tick: the operator's answer, queued to the programme's coordinator",
  correction: "a digest correction: the operator's sentence on a decision the coordinator made in their name",
} as const;
/** The two operator doors that send a coordinator its decision. */
export type RulingSource = keyof typeof RULING_SOURCE_MAP;
export const RULING_SOURCES = Object.keys(RULING_SOURCE_MAP) as RulingSource[];
export function isRulingSource(v: unknown): v is RulingSource {
  return typeof v === 'string' && (RULING_SOURCES as readonly string[]).includes(v);
}

/** One ruling, as the checkpoint keeps it. `text` is the mail's body exactly as stored (the operator's own words; a tick's
 *  body also names the item), and `subject` the mail's subject. Both are untrusted text on the card. */
export interface Ruling { readonly at: number; readonly source: RulingSource; readonly subject: string; readonly text: string }

/** One live note, as stored; the lane hands the notes piece's rows through unchanged. */
export interface CheckpointNote {
  readonly id: number; readonly at: number; readonly kind: NoteKind; readonly key: NoteKey; readonly waitsOn: string; readonly next: string;
}

/** The handover note with the generation that wrote it and the status words dropped from it. */
export interface CheckpointHandover { readonly n: number; readonly dropped: number; readonly note: HandoverNote }

export interface CheckpointFacts {
  readonly role: FleetRole;
  readonly trigger: TriggerClass;
  readonly notes: readonly CheckpointNote[];
  readonly handover: CheckpointHandover | null;
  /** Every ruling row the reader found, in any order. */
  readonly rulings: readonly Ruling[];
}

export interface Checkpoint {
  readonly notes: readonly CheckpointNote[];
  readonly rulings: readonly Ruling[];
  readonly handover: CheckpointHandover | null;
}

export function assembleCheckpoint(f: CheckpointFacts): Checkpoint {
  const rulings = f.role === 'coordinator'
    ? [...f.rulings].sort((a, b) => b.at - a.at).slice(0, CHECKPOINT_RULINGS_MAX)
    : [];
  return { notes: [...f.notes], rulings, handover: f.trigger === 'hard' ? null : f.handover };
}
