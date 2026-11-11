import { parseStallDetail } from './stall.js';
import { TRIGGER_TABLE, signatureText } from '../../../shared/practice-triggers.js';
/**
 * L1 policy: the case lane's decider (Overlord spec §10.5). No clock, no I/O, no store.
 *
 * An occurrence is one stall episode: the rows that parse to the same (run, arm, key), whatever their rung or mode.
 * A signature becomes a case when three occurrences fall in the window, or two programmes share it.
 */

/** §10.5: three times in 14 days. */
export const CASE_WINDOW_MS = 14 * 86_400_000;
export const CASE_MIN_OCCURRENCES = 3;
export const CASE_MIN_PROGRAMMES = 2;
/** W1a: no review exists; W4b computes the mode from `practice-v1`. */
export const CASE_MODE = 'shadow' as const;

const CASE_CAUSE_TABLE = { count: 'three occurrences in the window', programmes: 'two programmes in the window' } as const;
export type CaseCause = keyof typeof CASE_CAUSE_TABLE;
export const CASE_CAUSES = Object.keys(CASE_CAUSE_TABLE) as CaseCause[];

/** L2 port, declared by this consumer: one observation row (the store's `StallObservationRow` satisfies it). */
export interface CaseObservationRow { readonly eventId: number; readonly runId: number; readonly at: number; readonly detail: string | null }
export interface CasesInput {
  readonly rows: readonly CaseObservationRow[];
  /** runId to programme slug; a run absent here is not counted. */
  readonly programOf: ReadonlyMap<number, string>;
  /** signature text to its newest case's openedAt. */
  readonly newestCaseAt: ReadonlyMap<string, number>;
  readonly now: number;
}
export interface CaseDue {
  readonly signature: string;
  readonly cause: CaseCause;
  readonly occurrences: number;
  readonly programmes: readonly string[];
  readonly evidence: readonly number[];
  readonly windowFrom: number;
}

export function caseWindowFrom(now: number): number {
  return now - CASE_WINDOW_MS;
}

/** The runs of the rows this build can read, each once, ascending. */
export function caseRunIds(rows: readonly CaseObservationRow[]): number[] {
  const ids = new Set<number>();
  for (const r of rows) if (parseStallDetail(r.detail) !== null) ids.add(r.runId);
  return [...ids].sort((a, b) => a - b);
}

/** The signature text of each arm, read from the trigger table so this file spells no kind. */
const SIGNATURE_OF = new Map<string, string>(TRIGGER_TABLE.map((s) => [s.key, signatureText(s)]));

interface Episode { readonly signature: string; readonly runId: number; at: number; eventId: number }

export function casesDue(input: CasesInput): CaseDue[] {
  const windowFrom = caseWindowFrom(input.now);
  const episodes = new Map<string, Episode>();
  for (const r of input.rows) {
    const p = parseStallDetail(r.detail);
    if (p === null) continue;
    const signature = SIGNATURE_OF.get(p.arm);
    if (signature === undefined) continue; // an arm the trigger table has no row for
    const k = `${r.runId}|${p.arm}|${p.key}`;
    const e = episodes.get(k);
    if (e === undefined) {
      episodes.set(k, { signature, runId: r.runId, at: r.at, eventId: r.eventId });
    } else if (r.at < e.at || (r.at === e.at && r.eventId < e.eventId)) {
      e.at = r.at;
      e.eventId = r.eventId;
    }
  }
  const counted = new Map<string, { programme: string; eventId: number }[]>();
  for (const e of episodes.values()) {
    const programme = input.programOf.get(e.runId);
    if (programme === undefined || e.at < windowFrom) continue;
    const newest = input.newestCaseAt.get(e.signature);
    if (newest !== undefined && e.at <= newest) continue;
    const list = counted.get(e.signature) ?? [];
    list.push({ programme, eventId: e.eventId });
    counted.set(e.signature, list);
  }
  const out: CaseDue[] = [];
  for (const signature of [...counted.keys()].sort()) {
    const list = counted.get(signature)!;
    const programmes = [...new Set(list.map((x) => x.programme))].sort();
    const cause: CaseCause | null = list.length >= CASE_MIN_OCCURRENCES ? 'count' : programmes.length >= CASE_MIN_PROGRAMMES ? 'programmes' : null;
    if (cause === null) continue;
    out.push({ signature, cause, occurrences: list.length, programmes, evidence: list.map((x) => x.eventId).sort((a, b) => a - b), windowFrom });
  }
  return out;
}
