// Fixtures for the delivery recipe's capture lane tests (Desktop polish wave 178): a well-formed delivery result for one part,
// and a delivery row. Built from the recipe's own part list, never a literal part count.
import { DELIVERY_RECIPE_VERSION } from '../../shared/deliveryCapture.js';
import type { ClaudeBuildRecord } from '../../shared/claudeBuildTrust.js';
import type { DeliveryRow } from '../../shared/deliveryLane.js';
import {
  deliveryParts, deliveryWord, type DeliveryCaptureResult, type DeliveryCaseResult, type DeliveryCaseVerdict,
} from '../../shared/deliveryResult.js';

/** No side request on any route. */
const NO_SIDE = { messages: 0, count_tokens: 0 } as const;

/** A case of the verdict asked, shaped so the one reader accepts it (`intact`, `refused` and `altered` are the three used). */
function caseOf(id: DeliveryCaseResult['id'], verdict: DeliveryCaseVerdict): DeliveryCaseResult {
  if (verdict === 'refused') return { id, verdict, send: 'refused-empty', sentChars: 10, receivedChars: [], divergence: null, sideRequests: NO_SIDE, hook: 'absent' };
  if (verdict === 'altered') {
    return { id, verdict, send: 'ok', sentChars: 10, receivedChars: [9], divergence: { turn: 0, index: 3, expected: 'abc', received: 'abd' }, sideRequests: NO_SIDE, hook: 'unequal' };
  }
  return { id, verdict: 'intact', send: 'ok', sentChars: 10, receivedChars: [10], divergence: null, sideRequests: NO_SIDE, hook: 'equal' };
}

/** A delivery result for `build` and `part`: every case `intact`, except the first, which carries `first`; it names `release` as the box that ran it. */
export function deliveryResultFor(build: string, part: number, first: DeliveryCaseVerdict = 'intact', version: string = DELIVERY_RECIPE_VERSION, release: string | null = 'v0.0.1500'): DeliveryCaptureResult {
  const ids = deliveryParts()[part]!;
  const cases = ids.map((id, i) => caseOf(id, i === 0 ? first : 'intact'));
  return { recipe: 'delivery', version, build, part, word: deliveryWord(cases.map((c) => c.verdict)), cases, release, unmeasured: [] };
}

/** A delivery row holding `result` as the store would read it. */
export function rowOf(result: DeliveryCaptureResult, over: Partial<DeliveryRow> = {}): DeliveryRow {
  return { build: result.build, part: result.part, version: result.version, release: result.release, word: result.word, result, at: 5, attempts: 1, lastAttemptAt: 5, notSent: null, ...over };
}

/** A row that holds attempts only. */
export const attemptRow = (build: string, part: number, lastAttemptAt: number | null, over: Partial<DeliveryRow> = {}): DeliveryRow =>
  ({ build, part, version: null, release: null, word: null, result: null, at: null, attempts: 1, lastAttemptAt, notSent: null, ...over });

export const record = (build: string, capture: ClaudeBuildRecord['capture'], over: Partial<ClaudeBuildRecord> = {}): ClaudeBuildRecord =>
  ({ build, source: 'fleet', capture, cwd: capture === 'pass', seenAt: 1, attempts: 1, lastAttemptAt: null, notSent: null, verdictAt: capture === 'queued' ? null : 2, output: null, fails: 0, ...over });
