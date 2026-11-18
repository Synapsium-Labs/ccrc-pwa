// D-8274 (worktree economy spec 2026-10-28 R-6): Settings › Automation › Shadow lanes, its pure half (L1): the wire guards
// for the card's view and the 409 confirm, the radio a row checks, and each row's lines. The words themselves are L0's
// (`LANE_ARM_TEXT`, `shared/lane-arm.ts`); nothing here retypes one.
import {
  LANE_ARM_TEXT, isLaneArmChoice, isLaneArmImport, isLaneArmLane, laneArmGate, laneArmLive,
  type LaneArmChoice, type LaneArmConfirmRequired, type LaneArmQuizPending, type LaneArmQuizView, type LaneArmRowView, type LaneArmView,
} from '../../../shared/lane-arm';
import { isOneOf, isRecord } from '../lib/wire';

const STORED: readonly string[] = ['shadow', 'live', 'unknown', 'absent', 'unreadable'];
/** The 409's own word, typed from its union (`collectLaneRead.ts`'s `CONFIRM_ERRORS` shape), never a second spelling. */
type ConfirmError = LaneArmConfirmRequired['error'];
const CONFIRM_ERRORS = Object.keys({ 'confirm-required': true } satisfies Record<ConfirmError, true>) as ConfirmError[];
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

const QUIZ_COUNTS = ['questions', 'families', 'answered', 'runFailed', 'absent'] as const;
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One pending quiz run, whole, or null. */
function asQuizPending(raw: unknown): LaneArmQuizPending | null {
  if (!isRecord(raw)) return null;
  const { id, recordedAt, reportShaPrefix, recordedBy, measuredAt, score, lo, hi } = raw;
  if (!isFiniteNum(id) || !isFiniteNum(recordedAt) || !isFiniteNum(measuredAt) || !isFiniteNum(score) || !isFiniteNum(lo) || !isFiniteNum(hi)) return null;
  if (typeof reportShaPrefix !== 'string' || typeof recordedBy !== 'string') return null;
  const counts: number[] = [];
  for (const k of QUIZ_COUNTS) {
    const v = raw[k];
    if (!isFiniteNum(v)) return null;
    counts.push(v);
  }
  const [questions, families, answered, runFailed, absent] = counts as [number, number, number, number, number];
  return { id, recordedAt, reportShaPrefix, recordedBy, measuredAt, score, lo, hi, questions, families, answered, runFailed, absent };
}

/** The quiz block, whole, or null (a malformed one is dropped: the card then shows no block, never a throw). */
function asQuizView(raw: unknown): LaneArmQuizView | null {
  if (!isRecord(raw) || !isRecord(raw.baseline) || !isRecord(raw.pending)) return null;
  const b = raw.baseline;
  let baseline: LaneArmQuizView['baseline'];
  if (b.state === 'recorded' && isFiniteNum(b.at)) baseline = { state: 'recorded', at: b.at };
  else if (b.state === 'not-yet') baseline = { state: 'not-yet' };
  else if (b.state === 'unreadable' && typeof b.detail === 'string') baseline = { state: 'unreadable', detail: b.detail };
  else return null;
  const p = raw.pending;
  if (p.ok === true && Array.isArray(p.runs)) {
    const runs: LaneArmQuizPending[] = [];
    for (const r of p.runs) {
      const run = asQuizPending(r);
      if (run === null) return null;
      runs.push(run);
    }
    return { baseline, pending: { ok: true, runs } };
  }
  if (p.ok === false && typeof p.detail === 'string') return { baseline, pending: { ok: false, detail: p.detail } };
  return null;
}

/** A quiz date as the card says it, in UTC and labelled so: "2026-11-24 UTC" (slug quiz-card-dates-are-utc, review 2442
 *  F10): the quiz week is UTC (slug quiz-week-is-utc), so a run's date and the weekly item's week always agree, and the label
 *  keeps anyone from reading it as local time. */
export function laneArmQuizDate(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 10)} UTC`;
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
  const quiz = raw.quizBaseline === undefined ? null : asQuizView(raw.quizBaseline);
  return quiz === null ? { lanes } : { lanes, quizBaseline: quiz };
}

/** A 409's body read as the server's confirm, or null when it is not one. */
export function asLaneArmConfirm(raw: unknown): LaneArmConfirmRequired | null {
  if (!isRecord(raw) || !isOneOf(CONFIRM_ERRORS, raw.error) || !isLaneArmLane(raw.lane) || typeof raw.confirmKey !== 'string') return null;
  const facts = raw.facts;
  if (!isRecord(facts) || typeof facts.stored !== 'string' || !STORED.includes(facts.stored)) return null;
  if (!numOrNull(facts.updatedAt) || !strOrNull(facts.shadowLog)) return null;
  return {
    ok: false, error: raw.error, lane: raw.lane, confirmKey: raw.confirmKey,
    facts: { stored: facts.stored as LaneArmRowView['stored'], updatedAt: facts.updatedAt, shadowLog: facts.shadowLog },
  };
}

/** The radio a row checks: its stored choice, or neither for a token it does not know, a lost row, an unreadable one, or
 *  a Live its gate holds (so either tap can replace it; review 2006 N1: one rule with the server's view, `laneArmLive`). */
export function laneArmChecked(row: LaneArmRowView): LaneArmChoice | null {
  if (row.stored === 'live') return laneArmLive(row.stored, laneArmGate(row.lane)) ? 'live' : null;
  return isLaneArmChoice(row.stored) ? row.stored : null;
}

/** A row's lines under its choice: why it cannot go live yet (its gate, review 2003 F3), what stands when the server holds
 *  no usable choice, the import's note, then the shadow record's hint. */
export function laneArmLines(row: LaneArmRowView, shadowLog: string | null): { text: string; tone: 'note' | 'warn' }[] {
  const out: { text: string; tone: 'note' | 'warn' }[] = [];
  const gate = laneArmGate(row.lane);
  if (gate !== null) out.push({ text: gate, tone: 'note' });
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
