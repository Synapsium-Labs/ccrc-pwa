// The paste delivery recipe's capture lane, DECIDED (Desktop polish wave 178; task note
// docs/superpowers/programs/desktop-polish/paste-delivery.md). L0: imports only `shared/` siblings. `server/src/buildCaptureLane.ts`
// acts on these answers and decides nothing of its own:
// - `nextDeliveryJob`: which (build, part) to send next, after every trust job and never ahead of one;
// - `deliveryWordOf`: the join of a build's parts, the one word the build list shows;
// - `deliveryViewsOf`: the list the build list carries, cut from the rows.
//
// IT NEVER TOUCHES BUILD TRUST. A delivery row lives in its own table (`claude_build_deliveries`), and nothing here reads
// `buildTrustOf` or writes a trust row.
import { compareClaudeVersions, isClaudeVersion } from './claudeVersion.js';
import { BUILD_CAPTURE_RETRY_MS, type ClaudeBuildRecord } from './claudeBuildTrust.js';
import { DELIVERY_RECIPE_VERSION } from './deliveryCapture.js';
import {
  deliveryCaseViewOf, deliveryJoinWord, deliveryParts, type DeliveryBuildView, type DeliveryCaptureResult, type DeliveryJoinWord, type DeliveryNotSent, type DeliveryPartView, type DeliveryUnmeasuredPart, type DeliveryWord,
} from './deliveryResult.js';

/** One (build, part) row of `claude_build_deliveries`, as `CoordStore.claudeBuildDeliveries` reads it. `version`, `word`,
 *  `result` and `at` are set together by a recorded result and null on a row that only holds attempts. A row whose stored
 *  result the reader no longer accepts reads with those four null: it is a missing part, asked again. */
export interface DeliveryRow {
  readonly build: string;
  readonly part: number;
  readonly version: string | null;
  readonly word: DeliveryWord | null;
  readonly result: DeliveryCaptureResult | null;
  readonly at: number | null;
  /** How many delivery jobs actually went out for this part. A try that sent nothing is not counted. */
  readonly attempts: number;
  /** When the lane last tried this part, sent or not: the retry clock. */
  readonly lastAttemptAt: number | null;
  /** Why that last try sent nothing; null when it sent a job, or before any try. */
  readonly notSent: DeliveryNotSent | null;
}

/** The part indexes of this side's recipe, derived from the one part list. */
const partIndexes = (): number[] => deliveryParts().map((_, i) => i);

/** A row holds a CURRENT result: the recipe's own version, a word, the result and its time. Another version's row, or one
 *  missing any of the four, is as good as none, so the join, the next job and the view all split a build's parts the same way. */
export const isCurrentDelivery = (r: DeliveryRow): boolean => r.version === DELIVERY_RECIPE_VERSION && r.word !== null && r.result !== null && r.at !== null;

/** The delivery job to send next, or null: only the NEWEST build whose capture passed, never an older one (no back-fill),
 *  and its first part, in index order, with no current row. A queued trust build does NOT hold it back (the capture owner's
 *  call 1145, point 2b, kept by call 1253): trust first is the lane's own rule, which asks this only on a pass that sent no
 *  trust job, so a queued build that is not due (the retry ladder's hour, or a build whose every try sends nothing) never
 *  stops delivery for the newest passed build. When that part's last try is within
 *  {@link BUILD_CAPTURE_RETRY_MS}, null: the lane waits, and never skips ahead to a later part. */
export function nextDeliveryJob(
  records: readonly ClaudeBuildRecord[], deliveries: readonly DeliveryRow[], at: number,
): { readonly build: string; readonly part: number } | null {
  const build = records.filter((r) => r.capture === 'pass' && isClaudeVersion(r.build)).map((r) => r.build)
    .sort((a, b) => compareClaudeVersions(b, a))[0];
  if (build === undefined) return null;
  const mine = deliveries.filter((r) => r.build === build);
  for (const part of partIndexes()) {
    const row = mine.find((r) => r.part === part);
    if (row !== undefined && isCurrentDelivery(row)) continue;
    if (row !== undefined && row.lastAttemptAt !== null && at - row.lastAttemptAt < BUILD_CAPTURE_RETRY_MS) return null;
    return { build, part };
  }
  return null;
}

/** THE JOIN over a build's parts. Only rows at the current version count. Any current part `fault` is `fault`; else any
 *  part with no current row is `incomplete`; else any `refused` is `refused`; else `intact`. `incomplete` is a word of its
 *  own, never folded into `intact` or `fault`. */
export function deliveryWordOf(deliveries: readonly DeliveryRow[], build: string): DeliveryJoinWord {
  return deliveryJoinWord(partIndexes().map((p): DeliveryWord | null => {
    const row = deliveries.find((r) => r.build === build && r.part === p);
    return row !== undefined && isCurrentDelivery(row) ? row.word : null;
  }));
}

/** The build list's `deliveries`: one entry for each build that has any row, newest build first, its join word and each
 *  current part that holds a result, by part, and each part with none beside its last not-sent word. */
export function deliveryViewsOf(deliveries: readonly DeliveryRow[]): DeliveryBuildView[] {
  const builds = [...new Set(deliveries.map((r) => r.build))].filter((b) => isClaudeVersion(b)).sort((a, b) => compareClaudeVersions(b, a));
  return builds.map((build) => {
    const parts: DeliveryPartView[] = [];
    const unmeasured: DeliveryUnmeasuredPart[] = [];
    for (const p of partIndexes()) {
      const r = deliveries.find((x) => x.build === build && x.part === p);
      if (r === undefined || !isCurrentDelivery(r) || r.result === null || r.version === null || r.word === null || r.at === null) {
        unmeasured.push({ part: p, notSent: r?.notSent ?? null });
        continue;
      }
      parts.push({ part: p, version: r.version, at: r.at, word: r.word, cases: r.result.cases.map(deliveryCaseViewOf) });
    }
    return { build, word: deliveryWordOf(deliveries, build), parts, unmeasured };
  });
}
