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
  /** The project the PR numbers belong to: #12 of one project is not #12 of another. */
  project: string;
  pr: number;
  against: { base: string } | { pr: number };
  paths: readonly string[];
  pathsCut: boolean;
}

export interface ConflictSummary {
  /** The (project, PR) landings in the window. */
  measured: number;
  /** How many projects those landings span: the sentence names the project of a line only when this is above one. */
  projects: number;
  /** Measured landings whose head the radar left out of its pairwise set (`paired: false`). */
  unpaired: number;
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
  // One landing per (project, PR): the radar is per project, so #12 of one project is not #12 of another. Two sessions
  // naming one PR of one project are one measured PR. Every key below is scoped the same way, so a clean landing of one
  // project never hides a partial or conflicting one of another (D-7480).
  const byPr = new Map<string, SessionLanding & { project: string }>();
  for (const s of sessions) {
    const l = landingOf(s, nowMs);
    if (l !== null && !byPr.has(`${s.project}:${l.pr}`)) byPr.set(`${s.project}:${l.pr}`, { ...l, project: s.project });
  }
  if (byPr.size === 0) return null;

  const lines = new Map<string, ConflictLine>();
  const unmeasuredPairs = new Set<string>();
  let unmeasured = 0;
  let unpaired = 0;
  let partial = false;
  let cut = false;
  let oldestAt = '';
  for (const l of byPr.values()) {
    // Orders the landings for the "measured HH:MM" stamp ONLY: `at` is one fixed-width UTC stamp (`isRadarStamp`), so
    // strings order like times. Freshness is `landingShown`'s alone (D-7481).
    if (oldestAt === '' || l.at < oldestAt) oldestAt = l.at;
    if (!l.paired) unpaired += 1;
    if (!isClean(l) && !inConflict(l)) partial = true;
    if (hasCut(l)) { partial = true; cut = true; }
    if (l.base.state === 'unmeasured') unmeasured += 1;
    if (l.base.state === 'conflict') {
      lines.set(`${l.project}:b:${l.pr}`, { project: l.project, pr: l.pr, against: { base: l.baseRef }, paths: l.base.paths ?? [], pathsCut: l.base.pathsCut === true });
    }
    // A pair {a, b} is listed once within its project, under its lower PR number, whichever side reported it.
    for (const c of l.conflicts) {
      const lo = Math.min(l.pr, c.pr);
      const hi = Math.max(l.pr, c.pr);
      const key = `${l.project}:p:${lo}:${hi}`;
      if (!lines.has(key)) lines.set(key, { project: l.project, pr: lo, against: { pr: hi }, paths: c.paths, pathsCut: c.pathsCut });
    }
    for (const other of l.unmeasuredWith) unmeasuredPairs.add(`${l.project}:${Math.min(l.pr, other)}:${Math.max(l.pr, other)}`);
  }
  const conflicted = [...lines.values()].sort((a, b) => a.project.localeCompare(b.project) || a.pr - b.pr || againstPr(a) - againstPr(b));
  const projects = new Set([...byPr.values()].map((l) => l.project)).size;
  return { measured: byPr.size, projects, unpaired, conflicted, partial, unmeasured: unmeasured + unmeasuredPairs.size, cut, oldestAt };
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

const lineSentence = (line: ConflictLine, named: boolean): string => {
  const who = named ? `${line.project}: ` : '';
  const where = line.paths.length === 0 ? '' : ` in ${line.paths.join(', ')}`;
  const cut = line.pathsCut ? ' (list cut)' : '';
  return who + ('base' in line.against
    ? `PR #${line.pr} conflicts with ${line.against.base}${where}${cut}`
    : `PRs #${line.pr} and #${line.against.pr} conflict${where}${cut}`);
};

/** The chip's accessible name and title: the word, each conflict by PR number, base and path, what was left out, and
 *  when the oldest reading was measured. */
export function conflictChipSentence(summary: ConflictSummary): string {
  const at = timeOf(summary.oldestAt);
  return [
    conflictChipWord(summary),
    ...summary.conflicted.map((line) => lineSentence(line, summary.projects > 1)),
    ...(summary.cut ? ['(list cut)'] : []),
    ...(summary.unmeasured > 0 ? [`${summary.unmeasured} not measured`] : []),
    ...(summary.unpaired > 0 ? [`${summary.unpaired} not paired`] : []),
    ...(at === '' ? [] : [`measured ${at}`]),
  ].join('. ');
}
