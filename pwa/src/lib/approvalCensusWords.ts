// The M38 card's words (approvals plan 2026-11-18, §3.1 "The counter, M38"): L1, pure. The sentences and per-path labels
// are derived from the census read's wire (`ApprovalCensusWire`, `shared/approval-census.ts`). No fetch, no React.
import { APPROVAL_CENSUS_PATHS, type ApprovalCensusPath, type ApprovalCensusWire } from '../../../shared/approval-census';
import { isRecord } from './wire';

/** Table 2a, one label per path word. A `Record` over the path type: a path added to the vocabulary is a compile error here. */
export const APPROVAL_PATH_LABELS: Readonly<Record<ApprovalCensusPath, string>> = {
  ruled: 'Ruled by the coordinator',
  'hook-skipped': 'Never sent (the hook stopped it)',
  'refused-at-mint': 'Refused when sent',
  'released-at-mint': 'Released at once',
  lapsed: 'Held, then lapsed',
  escalate: 'Held, could not be allowed',
  'envelope-erased': 'Menu with no context',
  'not-a-child': 'Not a child session',
  held: 'Still held',
};

/** The paths that do not reach the operator: settled by the coordinator, or not yet decided. */
const NOT_REACHING: readonly ApprovalCensusPath[] = ['ruled', 'held'];
export const OPERATOR_REACHING_PATHS: readonly ApprovalCensusPath[] =
  APPROVAL_CENSUS_PATHS.filter((p) => !NOT_REACHING.includes(p));

export const APPROVAL_CENSUS_TEXT = {
  unmeasured: 'unmeasured',
  staleNote: 'The last read failed; this is the previous answer.',
  unmeasuredNote: 'The census could not be read, so no figure is shown.',
  baseline: 'Baseline: the first two weeks after the census went live. It includes the stale-deny fix and the reviewer '
    + 'prevention clause if they were live by then.',
  pathsHead: 'Where they came from',
  noPaths: 'No path reached you.',
} as const;

/** The wire guard: the answer whole, or null. Only the fields this card reads are checked. */
export function asApprovalCensus(raw: unknown): ApprovalCensusWire | null {
  if (!isRecord(raw) || raw.ok !== true || typeof raw.days !== 'number') return null;
  if (!isRecord(raw.byPath) || typeof raw.readPrompts !== 'number') return null;
  const m = raw.m38;
  if (!isRecord(m) || !Array.isArray(m.byDay)) return null;
  if (m.perProgrammeDay !== null && typeof m.perProgrammeDay !== 'number') return null;
  return raw as unknown as ApprovalCensusWire;
}

const dayWord = (n: number): string => (n === 1 ? 'day' : 'days');

/** The headline figure: one decimal, or null when nothing reached the operator. */
export function m38Figure(w: ApprovalCensusWire): string | null {
  const v = w.m38.perProgrammeDay;
  return v === null ? null : v.toFixed(1);
}

export function m38Sentence(days: number): string {
  return `Permission prompts you had to answer, per programme-day, over the last ${days} ${dayWord(days)}`;
}

export function m38NoneSentence(days: number): string {
  return `None reached you in the last ${days} ${dayWord(days)}`;
}

export function readPromptsLine(n: number): string {
  return `Read prompts (the read-only family's gate): ${n}`;
}

export interface PathLine { readonly path: ApprovalCensusPath; readonly label: string; readonly count: number }

/** The paths that reached the operator, summed over the window's days (`m38.byDay`), most first, zero counts left out. */
export function operatorPathLines(w: ApprovalCensusWire): PathLine[] {
  const sums = new Map<ApprovalCensusPath, number>();
  for (const d of w.m38.byDay) {
    for (const p of OPERATOR_REACHING_PATHS) {
      const n = d.byPath[p];
      if (typeof n === 'number' && n > 0) sums.set(p, (sums.get(p) ?? 0) + n);
    }
  }
  return [...sums.entries()]
    .map(([path, count]) => ({ path, label: APPROVAL_PATH_LABELS[path], count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
