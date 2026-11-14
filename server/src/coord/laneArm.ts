// D-8274 (worktree economy spec 2026-10-28 R-6): THE SHADOW LANES CARD'S RULES. L1 policy: pure and clock-free (`at` is an
// argument), no I/O and no store. The route (`routes.ts`, L4) reads the rows, hands them here and sends the answer; the
// store (`CoordStore.importLaneArmMarker`) asks `decideLaneArmImport` inside its own transaction; the watcher hands the
// import the registry listing it already holds. The vocabulary and the wire are L0's (`shared/lane-arm.ts`).
//
// A lane is live when, and only when, its row's stored choice is exactly `live` and its gate is open (`laneArmRowViewOf`,
// `laneArmLive`). Every other read (a token this build does not know, a lost row, a read that failed, a gated row) is
// shadow, so doubt never arms a lane.
import {
  LANE_ARM_LANES, LANE_ARM_MARKER, ROSTER_CARD_LANE, ROSTER_CARD_SHADOW_LOG, isLaneArmChoice, isLaneArmImport, isLaneArmLane, laneArmGate,
  laneArmLive,
  type LaneArmChoice, type LaneArmConfirmRequired, type LaneArmImport, type LaneArmLane, type LaneArmRequest,
  type LaneArmRowView, type LaneArmView,
} from '../../../shared/lane-arm.js';

/** One row as the store read it (`CoordStore.laneArmSetting`), declared here by its consumer: the raw stored token, its
 *  write time and the import's columns, a lost row, or a read that failed. */
export type LaneArmRead =
  | {
    readonly kind: 'row'; readonly choice: unknown; readonly updatedAt: number | null;
    readonly importedAt: number | null; readonly imported: unknown;
  }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** The one reading of a row, for the route's view, the runs reply and the hook alike: live only on an exact `live`, while
 *  the row's gate is open (`laneArmLive`; review 2006 N1). `gate` is `laneArmGate(lane)`; a caller passes another only to
 *  drive a gated lane's live path in a test or the simulator. */
export function laneArmRowViewOf(lane: LaneArmLane, read: LaneArmRead, gate: string | null = laneArmGate(lane)): LaneArmRowView {
  const marker = LANE_ARM_MARKER[lane] ?? null;
  if (read.kind === 'absent') return { lane, stored: 'absent', detail: null, live: false, updatedAt: null, imported: null, marker };
  if (read.kind === 'unreadable') {
    return { lane, stored: 'unreadable', detail: read.detail, live: false, updatedAt: null, imported: null, marker };
  }
  const stored = isLaneArmChoice(read.choice) ? read.choice : 'unknown';
  const imported = read.importedAt !== null && isLaneArmImport(read.imported) ? { result: read.imported, at: read.importedAt } : null;
  return { lane, stored, detail: null, live: laneArmLive(stored, gate), updatedAt: read.updatedAt, imported, marker };
}

/** Every row of the card, in `LANE_ARM_LANES` order. */
export function laneArmViewOf(read: (lane: LaneArmLane) => LaneArmRead): LaneArmView {
  return { lanes: LANE_ARM_LANES.map((lane) => laneArmRowViewOf(lane, read(lane))) };
}

/** What `GET /api/runs` carries to the session hook for the roster card (`RUNS_ROSTER_CARD_FIELD`): `live` or `shadow`,
 *  or null (the field is left out) when the row could not be read, which the hook reads as shadow. */
export function rosterCardFieldOf(read: LaneArmRead): LaneArmChoice | null {
  if (read.kind !== 'row') return null;
  return laneArmRowViewOf(ROSTER_CARD_LANE, read).live ? 'live' : 'shadow';
}

/** The shadow record a row's card names, where it has one. */
export const laneArmShadowLog = (lane: LaneArmLane): string | null => (lane === ROSTER_CARD_LANE ? ROSTER_CARD_SHADOW_LOG : null);

/** The key a Live confirm binds: the row's stored choice and write time as the server read them. A write in between
 *  changes it, so a sheet opened over an older row is asked again with the newer facts. */
export const laneArmConfirmKey = (row: LaneArmRowView): string => `${row.lane}:${row.stored}:${row.updatedAt ?? 'none'}`;

/** The POST's body, read: `{lane, choice}` plus an optional string `confirm`, and nothing else. */
export function decideLaneArmBody(body: unknown):
  { readonly ok: true; readonly request: LaneArmRequest } | { readonly ok: false; readonly detail: string } {
  const refuse = { ok: false, detail: "the body is {lane, choice:'shadow'|'live', confirm?} and nothing else" } as const;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return refuse;
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b);
  if (keys.some((k) => k !== 'lane' && k !== 'choice' && k !== 'confirm')) return refuse;
  if (!isLaneArmLane(b.lane) || !isLaneArmChoice(b.choice)) return refuse;
  if (b.confirm !== undefined && (typeof b.confirm !== 'string' || b.confirm.length === 0 || b.confirm.length > 200)) return refuse;
  return { ok: true, request: { lane: b.lane, choice: b.choice, ...(b.confirm === undefined ? {} : { confirm: b.confirm }) } };
}

/** The POST's verdict, in the collector door's order, after one of its own: Live is refused while the row's gate stands
 *  (review 2003 F3: the lane cannot go live yet, whoever asks); Live is refused while sign-in is dark (arming needs a
 *  signed-in operator); an unreadable row is refused (nothing is written over a read that failed); a Live whose key is missing or
 *  no longer matches the row answers 409 with the facts; anything else is written. Shadow never asks. */
export type LaneArmPostVerdict =
  | { readonly kind: 'gated'; readonly reason: string }
  | { readonly kind: 'sign-in-unarmed' }
  | { readonly kind: 'unreadable'; readonly detail: string }
  | { readonly kind: 'confirm'; readonly body: LaneArmConfirmRequired }
  | { readonly kind: 'write'; readonly lane: LaneArmLane; readonly choice: LaneArmChoice };

export function decideLaneArmPost(i: {
  readonly request: LaneArmRequest; readonly row: LaneArmRowView; readonly signedIn: boolean;
}): LaneArmPostVerdict {
  const { request, row } = i;
  const gate = laneArmGate(request.lane);
  if (request.choice === 'live' && gate !== null) return { kind: 'gated', reason: gate };
  if (request.choice === 'live' && !i.signedIn) return { kind: 'sign-in-unarmed' };
  if (row.stored === 'unreadable') return { kind: 'unreadable', detail: row.detail ?? 'the row could not be read' };
  if (request.choice === 'live') {
    const key = laneArmConfirmKey(row);
    if (request.confirm !== key) {
      return { kind: 'confirm', body: {
        ok: false, error: 'confirm-required', lane: request.lane, confirmKey: key,
        facts: { stored: row.stored, updatedAt: row.updatedAt, shadowLog: laneArmShadowLog(request.lane) },
      } };
    }
  }
  return { kind: 'write', lane: request.lane, choice: request.choice };
}

/** The feed row's body for a change, or null when the stored choice did not move. */
export function laneArmChangeLine(before: LaneArmRowView, after: LaneArmRowView, actor: string): string | null {
  if (before.stored === after.stored) return null;
  return `${before.lane}: ${before.stored} -> ${after.stored}; by ${actor}`;
}

/** THE ONE-TIME IMPORT of a row's retired marker (R-6), decided inside the store's transaction. Null: nothing to do (the
 *  import already ran, or there is no row to record it on). Otherwise the result to record, and whether the row is set
 *  Live: only when the marker stood AND the row was never written (`updatedAt` 0, the seed), so a choice the operator
 *  already made here is never overturned by a file. */
export function decideLaneArmImport(read: LaneArmRead, stood: boolean):
  { readonly result: LaneArmImport; readonly setLive: boolean } | null {
  if (read.kind !== 'row' || read.importedAt !== null) return null;
  if (!stood) return { result: 'absent', setLive: false };
  return read.updatedAt === 0 ? { result: 'stood', setLive: true } : { result: 'stood-kept', setLive: false };
}

/** The feed row's body when the import set a row Live, naming the file. */
export const laneArmImportLine = (lane: LaneArmLane, marker: string, result: LaneArmImport): string =>
  result === 'stood'
    ? `${lane}: set live from the standing ${marker} marker; the marker is no longer read and can be removed`
    : `${lane}: the ${marker} marker stood but the row had already been set, so it was kept; the marker is no longer read and can be removed`;
