// The predicted-conflict chip's words (landing order wave 4b; D-7480, D-7481). L1: types, the wire's own readers and the
// PWA's guard kit and formatter only, never a screen, a store or `lib/api.ts`.
//
// `FleetSession.landing` is the landing radar's reading of one session's PR, or ABSENT. Absence is "the radar does not
// speak for this session now" and is never "no conflict": the chip says "No predicted conflicts" only when every
// measured landing is clean in every field. The live frame is CAST, so `landingOf` is the one reader: it validates the
// key through the wire's own revive (a malformed one reads as absent) and ages it by `landingShown`, so a cache, the
// degraded `GET /api/fleet` or the offline snapshot never shows an old prediction.
import { landingShown, reviveSessionLanding, type FleetSession, type SessionLanding } from '../../../shared/api';
import { timeOf } from '../lib/format';
import { isRecord } from '../lib/wire';

/** One predicted conflict, shown once: the PR, what it conflicts with (the base branch, or another PR) and the paths. */
export interface ConflictLine {
  pr: number;
  against: { base: string } | { pr: number };
  paths: readonly string[];
  pathsCut: boolean;
}

export interface ConflictSummary {
  /** The PRs with a landing in the window. */
  measured: number;
  conflicted: readonly ConflictLine[];
  /** Some landing is neither clean nor in conflict, or carries a cut (D-7480). */
  partial: boolean;
  /** Merges and pairs the radar could not measure. */
  unmeasured: number;
  /** The radar left heads or pairs out, or a fleet head unpaired (`cut`). */
  cut: boolean;
  /** The oldest `at` among the landings: the chip is only as current as its oldest reading. */
  oldestAt: string;
}

/** A session's landing, or `null` for every reason the chip must not speak: no key, a malformed one, one past the window. */
export function landingOf(s: FleetSession, nowMs: number): SessionLanding | null {
  const landing = isRecord(s) ? reviveSessionLanding(s, 'landing') : undefined;
  if (landing === undefined) return null;
  return landingShown(landing.at, nowMs) ? landing : null;
}

/** Clean in every field (D-7480): a measured base, in the pairwise set, with nothing in conflict, unmeasured or cut. */
const isClean = (l: SessionLanding): boolean =>
  l.base.state === 'clean' && l.paired && l.conflicts.length === 0 && l.unmeasuredWith.length === 0
  && !l.cut.pairs && !l.cut.heads && !l.cut.unbound;

const inConflict = (l: SessionLanding): boolean => l.base.state === 'conflict' || l.conflicts.length > 0;

const hasCut = (l: SessionLanding): boolean => l.cut.pairs || l.cut.heads || l.cut.unbound;

/** What the fleet's landings say together, or `null` when no session has a landing in the window. */
export function conflictSummaryOf(sessions: readonly FleetSession[], nowMs: number): ConflictSummary | null {
  // One landing per PR: two sessions naming one PR are one measured PR.
  const byPr = new Map<number, SessionLanding>();
  for (const s of sessions) {
    const l = landingOf(s, nowMs);
    if (l !== null && !byPr.has(l.pr)) byPr.set(l.pr, l);
  }
  if (byPr.size === 0) return null;

  const lines = new Map<string, ConflictLine>();
  const unmeasuredPairs = new Set<string>();
  let unmeasured = 0;
  let partial = false;
  let cut = false;
  let oldestAt = '';
  let oldestMs = Infinity;
  for (const l of byPr.values()) {
    const ms = new Date(l.at).getTime();
    if (ms < oldestMs) { oldestMs = ms; oldestAt = l.at; }
    if (!isClean(l) && !inConflict(l)) partial = true;
    if (hasCut(l)) { partial = true; cut = true; }
    if (l.base.state === 'unmeasured') unmeasured += 1;
    if (l.base.state === 'conflict') {
      lines.set(`b:${l.pr}`, { pr: l.pr, against: { base: l.baseRef }, paths: l.base.paths ?? [], pathsCut: l.base.pathsCut === true });
    }
    // A pair {a, b} is listed once, under its lower PR number, whichever side reported it.
    for (const c of l.conflicts) {
      const lo = Math.min(l.pr, c.pr);
      const hi = Math.max(l.pr, c.pr);
      if (!lines.has(`p:${lo}:${hi}`)) lines.set(`p:${lo}:${hi}`, { pr: lo, against: { pr: hi }, paths: c.paths, pathsCut: c.pathsCut });
    }
    for (const other of l.unmeasuredWith) unmeasuredPairs.add(`${Math.min(l.pr, other)}:${Math.max(l.pr, other)}`);
  }
  const conflicted = [...lines.values()].sort((a, b) => a.pr - b.pr || againstPr(a) - againstPr(b));
  return { measured: byPr.size, conflicted, partial, unmeasured: unmeasured + unmeasuredPairs.size, cut, oldestAt };
}

const againstPr = (line: ConflictLine): number => ('pr' in line.against ? line.against.pr : 0);

/** The state the chip's colour is chosen on. The word, not the colour, carries the meaning. */
export type ConflictChipState = 'conflict' | 'partial' | 'clean';

export function conflictChipState(summary: ConflictSummary): ConflictChipState {
  return summary.conflicted.length > 0 ? 'conflict' : summary.partial ? 'partial' : 'clean';
}

/** The chip's visible word: total over the summary. */
export function conflictChipWord(summary: ConflictSummary): string {
  const n = summary.conflicted.length;
  if (n > 0) return n === 1 ? '1 predicted conflict' : `${n} predicted conflicts`;
  if (summary.partial) return 'Conflicts partly measured';
  return summary.measured === 1 ? 'No predicted conflicts in 1 measured PR' : `No predicted conflicts in ${summary.measured} measured PRs`;
}

const lineSentence = (line: ConflictLine): string => {
  const where = line.paths.length === 0 ? '' : ` in ${line.paths.join(', ')}`;
  const cut = line.pathsCut ? ' (list cut)' : '';
  return 'base' in line.against
    ? `PR #${line.pr} conflicts with ${line.against.base}${where}${cut}`
    : `PRs #${line.pr} and #${line.against.pr} conflict${where}${cut}`;
};

/** The chip's accessible name and title: the word, each conflict by PR number, base and path, what was left out, and
 *  when the oldest reading was measured. */
export function conflictChipSentence(summary: ConflictSummary): string {
  const at = timeOf(summary.oldestAt);
  return [
    conflictChipWord(summary),
    ...summary.conflicted.map(lineSentence),
    ...(summary.cut ? ['(list cut)'] : []),
    ...(summary.unmeasured > 0 ? [`${summary.unmeasured} not measured`] : []),
    ...(at === '' ? [] : [`measured ${at}`]),
  ].join('. ');
}
