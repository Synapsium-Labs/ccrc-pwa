// D-8274 (worktree economy spec 2026-10-28 R-6): Settings › Automation › Shadow lanes, its pure half (L1): the wire guards
// for the card's view and the 409 confirm, the radio a row checks, and each row's lines. The words themselves are L0's
// (`LANE_ARM_TEXT`, `shared/lane-arm.ts`); nothing here retypes one.
import {
  LANE_ARM_TEXT, isLaneArmChoice, isLaneArmImport, isLaneArmLane,
  type LaneArmChoice, type LaneArmConfirmRequired, type LaneArmRowView, type LaneArmView,
} from '../../../shared/lane-arm';
import { isRecord } from '../lib/wire';

const STORED: readonly string[] = ['shadow', 'live', 'unknown', 'absent', 'unreadable'];
const numOrNull = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** One row, whole, or null: every field the card reads, each of its own type. */
function asRow(raw: unknown): LaneArmRowView | null {
  if (!isRecord(raw)) return null;
  const { lane, stored, detail, live, updatedAt, imported, marker } = raw;
  if (!isLaneArmLane(lane) || typeof stored !== 'string' || !STORED.includes(stored)) return null;
  if (!strOrNull(detail) || typeof live !== 'boolean' || !numOrNull(updatedAt) || !strOrNull(marker)) return null;
  let imp: LaneArmRowView['imported'] = null;
  if (imported !== null) {
    if (!isRecord(imported) || !isLaneArmImport(imported.result) || typeof imported.at !== 'number') return null;
    imp = { result: imported.result, at: imported.at };
  }
  return { lane, stored: stored as LaneArmRowView['stored'], detail, live, updatedAt, imported: imp, marker };
}

/** The view, whole, or null. A row this build does not know (a newer server's lane) is left out, not a failure. */
export function asLaneArmView(raw: unknown): LaneArmView | null {
  if (!isRecord(raw) || !Array.isArray(raw.lanes)) return null;
  const lanes: LaneArmRowView[] = [];
  for (const r of raw.lanes) {
    if (isRecord(r) && typeof r.lane === 'string' && !isLaneArmLane(r.lane)) continue;
    const row = asRow(r);
    if (row === null) return null;
    lanes.push(row);
  }
  return { lanes };
}

/** A 409's body read as the server's confirm, or null when it is not one. */
export function asLaneArmConfirm(raw: unknown): LaneArmConfirmRequired | null {
  if (!isRecord(raw) || raw.error !== 'confirm-required' || !isLaneArmLane(raw.lane) || typeof raw.confirmKey !== 'string') return null;
  const facts = raw.facts;
  if (!isRecord(facts) || typeof facts.stored !== 'string' || !STORED.includes(facts.stored)) return null;
  if (!numOrNull(facts.updatedAt) || !strOrNull(facts.shadowLog)) return null;
  return {
    ok: false, error: 'confirm-required', lane: raw.lane, confirmKey: raw.confirmKey,
    facts: { stored: facts.stored as LaneArmRowView['stored'], updatedAt: facts.updatedAt, shadowLog: facts.shadowLog },
  };
}

/** The radio a row checks: its stored choice, or neither for a token it does not know, a lost row or an unreadable one
 *  (so either tap can replace it). */
export function laneArmChecked(row: LaneArmRowView): LaneArmChoice | null {
  return isLaneArmChoice(row.stored) ? row.stored : null;
}

/** A row's lines under its choice: what stands when the server holds no usable choice, the import's note, then the shadow
 *  record's hint. */
export function laneArmLines(row: LaneArmRowView, shadowLog: string | null): { text: string; tone: 'note' | 'warn' }[] {
  const out: { text: string; tone: 'note' | 'warn' }[] = [];
  if (row.stored === 'unknown') out.push({ text: LANE_ARM_TEXT.unknown, tone: 'warn' });
  if (row.stored === 'absent') out.push({ text: LANE_ARM_TEXT.absent, tone: 'warn' });
  if (row.stored === 'unreadable') {
    out.push({ text: row.detail === null ? LANE_ARM_TEXT.unreadable : `${LANE_ARM_TEXT.unreadable} (${row.detail})`, tone: 'warn' });
  }
  if (row.imported !== null && row.marker !== null && row.imported.result !== 'absent') {
    out.push({
      text: row.imported.result === 'stood' ? LANE_ARM_TEXT.importedLive(row.marker) : LANE_ARM_TEXT.importedKept(row.marker),
      tone: 'note',
    });
  }
  if (shadowLog !== null) out.push({ text: LANE_ARM_TEXT.shadowLog(shadowLog), tone: 'note' });
  return out;
}
