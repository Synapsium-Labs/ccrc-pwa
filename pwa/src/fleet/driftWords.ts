// The drift kinds in words (D-5923, the digest's "Out of step" section; plan Task DT4, D-5924). The one home of what each
// kind the drift reconciler finds (`DRIFT_KIND_MAP`, shared/api.ts) reads as on a screen: total over `DriftKind`, so a kind
// added there reds the typecheck here, and a kind this build does not know (a newer server) reads as the neutral
// fallback, never as its token.
import { DRIFT_KINDS, isDriftKind, type DriftKind } from '../../../shared/api';

/** Each kind in the operator's words: what is out of step, not the reconciler's token. */
export const DRIFT_KIND_WORD: Readonly<Record<DriftKind, string>> = {
  'run-quiet': 'run quiet',
  'claimant-gone': 'coordinator gone',
  'mail-parked': 'mail parked',
  'mail-held': 'mail held',
  'parent-mismatch': 'wrong parent',
  'review-waiting': 'review waiting',
  'question-orphaned': 'question orphaned',
};

/** What a kind this build does not know reads as. */
export const DRIFT_FALLBACK_WORD = 'out of step';

export const driftKindWord = (kind: string): string => (isDriftKind(kind) ? DRIFT_KIND_WORD[kind] : DRIFT_FALLBACK_WORD);

/** A finding's subject (the JSON of the ids it names, D-5921) as one line of ids in words: `run 12 · prog-a`,
 *  `delivery 4 · <session>`. A key this build does not name keeps its value; a subject that is not a JSON object reads as
 *  sent. */
const ID_WORD: Readonly<Record<string, string>> = { runId: 'run', deliveryId: 'delivery', askId: 'ask', approvalId: 'approval' };
export function driftSubjectText(subject: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(subject); } catch { return subject; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return subject;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const word = ID_WORD[k];
    parts.push(word === undefined ? String(v) : `${word} ${v}`);
  }
  return parts.length > 0 ? parts.join(' · ') : subject;
}

/** The section's totals line: a count per kind, zeros left out, known kinds in the map's order and any kind this build
 *  does not know summed under the fallback word. Empty when every count is zero. */
export function driftTotalsText(totals: Readonly<Record<string, number>>): string {
  const parts: string[] = [];
  for (const k of DRIFT_KINDS) {
    const n = totals[k] ?? 0;
    if (n > 0) parts.push(`${n} ${DRIFT_KIND_WORD[k]}`);
  }
  const unknown = Object.entries(totals).filter(([k]) => !isDriftKind(k)).reduce((a, [, n]) => a + n, 0);
  if (unknown > 0) parts.push(`${unknown} ${DRIFT_FALLBACK_WORD}`);
  return parts.join(' · ');
}
