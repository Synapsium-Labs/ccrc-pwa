// L1: pure. The landing line's entry (landing order wave 5e): what an advance writes to it, decided from values, and
// the reader of its rows. No fs, no node:sqlite, no clock; the one writer, `CoordStore.advanceLanding` (L3), gathers
// the facts, calls `decideLandingWrite`, and acts inside its transaction. Value imports are L0 only.
import type { RunState } from '../../../shared/api.js';
import type { ChecksMode } from '../../../shared/landing.js';
import { isLandingEjectionKind, isLandingEntryState } from '../../../shared/landingLine.js';
import type { LandingEjectionKind, LandingEntry, LandingEntryState } from '../../../shared/landingLine.js';

/** What the route asks the line to do with one advance, built by `landingAdvanceOf` from the target alone. */
export type LandingAdvance =
  | { kind: 'plain' }
  | { kind: 'pin'; head: string; pr: number | null; mode: ChecksMode; handoffCommit: string }
  | { kind: 'retreat'; ejection: { base: string; kind: LandingEjectionKind } | null };

/** What the line recorded, as the store answers it and the advance's 200 body carries it (D-7627). `no-pr`,
 *  `no-episode` and `no-entry` are in-process words, never wire refusal codes (D-7619). */
export type LandingWrite =
  | { kind: 'none' } | { kind: 'no-pr' } | { kind: 'no-episode' } | { kind: 'no-entry' }
  | { kind: 'kept'; state: LandingEntryState }
  | { kind: 'pinned'; entry: LandingEntry; created: boolean }
  | { kind: 'ejected'; entry: LandingEntry };

/** The composite's decision: a write that touches no row, or the one statement to run. */
export type LandingWriteDecision =
  | { act: 'none'; write: Extract<LandingWrite, { kind: 'none' | 'no-pr' | 'no-episode' | 'no-entry' | 'kept' }> }
  | { act: 'insert' } | { act: 'repin'; id: number }
  | { act: 'eject'; id: number; base: string | null; kind: LandingEjectionKind | null };

/** advanceAct's choice: to 'merging' with a verdict → pin (head = measured.branchTip, pr = measured.prNumber ?? null);
 *  to 'working' → retreat (the parsed ejection or null); anything else → plain. */
export function landingAdvanceOf(f: { to: RunState; measured: { branchTip: string; prNumber: number | null } | null;
  mode: ChecksMode | null; handoffCommit: string; ejection: { base: string; kind: LandingEjectionKind } | null }): LandingAdvance {
  if (f.to === 'merging' && f.measured !== null && f.mode !== null) {
    return { kind: 'pin', head: f.measured.branchTip, pr: f.measured.prNumber ?? null, mode: f.mode, handoffCommit: f.handoffCommit };
  }
  if (f.to === 'working') return { kind: 'retreat', ejection: f.ejection };
  return { kind: 'plain' };
}

/** `episode` is `CoordStore.currentEpisode`'s answer, passed whole (typed structurally, so L1 imports no store):
 *  null means the run has no episode row, which is not an episode whose verdict measured no PR (`pr: null`).
 *  `current` is the row for (project, `pin.pr`) on a pin, or for (project, `episode.pr`) on a retreat; null means no
 *  such row. D-7618 (advances the line does not place) and D-7617 (a re-pin moves to the back). */
export function decideLandingWrite(f: { landing: LandingAdvance; from: RunState; runId: number;
  current: LandingEntry | null; episode: { pr: number | null } | null }): LandingWriteDecision {
  const { landing, current } = f;
  if (landing.kind === 'plain') return { act: 'none', write: { kind: 'none' } };
  if (landing.kind === 'pin') {
    if (landing.pr === null) return { act: 'none', write: { kind: 'no-pr' } };
    if (current === null) return { act: 'insert' };
    if (current.state === 'pinned' || current.state === 'ejected') return { act: 'repin', id: current.id };
    return { act: 'none', write: { kind: 'kept', state: current.state } };
  }
  if (f.from !== 'merging') return { act: 'none', write: { kind: 'none' } };
  if (f.episode === null) return { act: 'none', write: { kind: 'no-episode' } };
  if (f.episode.pr === null) return { act: 'none', write: { kind: 'no-pr' } };
  if (current === null) return { act: 'none', write: { kind: 'no-entry' } };
  if (current.runId !== f.runId || current.state !== 'pinned') return { act: 'none', write: { kind: 'kept', state: current.state } };
  return { act: 'eject', id: current.id, base: landing.ejection?.base ?? null, kind: landing.ejection?.kind ?? null };
}

const isPositiveSafe = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

/** A stored `afterIds`: a JSON array of positive safe integers, or null for anything else. */
function afterIdsOf(v: unknown): number[] | null {
  if (typeof v !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) && parsed.every(isPositiveSafe) ? parsed : null;
  } catch {
    return null;
  }
}

/** One `landing_entries` row, read without a cast: a `state` that is not a word, an `ejectionKind` that is not null and
 *  not a kind, or an `afterIds` that is not readable reads `state: 'unknown'` (never in the line), with `ejectionKind`
 *  null and `afterIds` empty for the unreadable field. `fixesMain` is `!== 0`; every integer goes through `Number()`
 *  (node:sqlite may hand back a bigint). */
export function landingEntryOfRow(row: Record<string, unknown>): LandingEntry {
  const kindOk = row.ejectionKind === null || row.ejectionKind === undefined || isLandingEjectionKind(row.ejectionKind);
  const afterIds = afterIdsOf(row.afterIds);
  const readable = isLandingEntryState(row.state) && kindOk && afterIds !== null;
  return {
    id: Number(row.id), project: String(row.project), pr: Number(row.pr), pinnedSha: String(row.pinnedSha),
    handoffCommit: String(row.handoffCommit), runId: row.runId === null || row.runId === undefined ? null : Number(row.runId),
    state: readable && isLandingEntryState(row.state) ? row.state : 'unknown',
    baseSha: row.baseSha === null || row.baseSha === undefined ? null : String(row.baseSha),
    ejectionKind: kindOk && isLandingEjectionKind(row.ejectionKind) ? row.ejectionKind : null,
    ejections: Number(row.ejections), afterIds: afterIds ?? [], fixesMain: row.fixesMain !== 0 && row.fixesMain !== 0n,
    setBy: String(row.setBy), pinnedAt: Number(row.pinnedAt),
  };
}

/** A project's two flags. An absent row reads both clear. A flag is false only when its value is `0` or `0n`; any other
 *  value reads as set (fail closed). */
export function landingFlagsOfRow(row: Record<string, unknown> | undefined): { operatorPaused: boolean; mainRedHold: boolean } {
  const set = (v: unknown): boolean => v !== 0 && v !== 0n;
  return row === undefined ? { operatorPaused: false, mainRedHold: false }
    : { operatorPaused: set(row.operatorPaused), mainRedHold: set(row.mainRedHold) };
}
