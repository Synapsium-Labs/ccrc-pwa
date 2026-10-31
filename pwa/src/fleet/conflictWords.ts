// The predicted-conflict chip's words (landing order wave 4b; D-7480, D-7481). L1: types, the wire's own readers and the
// PWA's guard kit and formatter only, never a screen, a store or `lib/api.ts`.
//
// The sentence is capped (wave 5a, review 1225's F6) and every word in it is true (D-7480). Only three things are dropped,
// each with "and N more": conflict lines past `CHIP_LINES_MAX`, paths past `CHIP_PATHS_MAX` on a line, and PRs past
// `CHIP_PATHS_MAX` in a clause. A cut is never dropped: the radar's own cut, a cut path list and an unbound head each have
// their own sentence, and the "not measured" and "not paired" clauses name their PRs.
//
// `FleetSession.landing` is the landing radar's reading of one session's PR, or ABSENT. Absence is "the radar does not
// speak for this session now" and is never "no conflict": the chip says "No predicted conflicts" only when every
// measured landing is clean in every field. The live frame is CAST, so `landingOf` is the one reader: it validates the
// key through the wire's own revive (a malformed one reads as absent) and ages it by `landingShown`, so a cache, the
// degraded `GET /api/fleet` or the offline snapshot never shows an old prediction.
import { landingShown, reviveSessionLanding, type FleetSession, type SessionLanding } from '../../../shared/api';
import { timeOf } from '../lib/format';
import { isRecord } from '../lib/wire';

/** Paths named on one conflict line, and PRs named in one partial clause; the rest read "and N more" (wave 5a, 4b F6). */
export const CHIP_PATHS_MAX = 3;
/** Conflict lines in one sentence; the rest read "and N more". The word above them already gives the total. */
export const CHIP_LINES_MAX = 5;

/** One merge the radar answered for, within one project: a PR with its base branch, or a pair under its lower PR. */
export interface ConflictRef {
  /** The project the PR numbers belong to: #12 of one project is not #12 of another. */
  project: string;
  pr: number;
  against: { base: string } | { pr: number };
}

/** One predicted conflict, shown once: the PR, what it conflicts with (the base branch, or another PR) and the paths. */
export interface ConflictLine extends ConflictRef {
  paths: readonly string[];
  pathsCut: boolean;
}

export interface ConflictSummary {
  /** The (project, PR) landings in the window. */
  measured: number;
  /** How many projects those landings span: the sentence names the project of a line only when this is above one. */
  projects: number;
  /** Measured landings whose head the radar left out of its pairwise set (`paired: false`), by project, then PR. */
  unpaired: readonly { project: string; pr: number }[];
  conflicted: readonly ConflictLine[];
  /** Some landing is neither clean nor in conflict, or carries a cut (D-7480). */
  partial: boolean;
  /** The base merges and pairs the radar could not measure, each once, sorted like `conflicted`. */
  unmeasured: readonly ConflictRef[];
  /** Some landing's radar cut its heads or its pairs (`cut.heads` or `cut.pairs`). */
  listCut: boolean;
  /** Some landing carries `cut.unbound`: a head on a session's branch was not matched to its session. */
  unbound: boolean;
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
  const unmeasuredRefs = new Map<string, ConflictRef>();
  const unpaired: { project: string; pr: number }[] = [];
  let partial = false;
  let listCut = false;
  let unbound = false;
  let oldestAt = '';
  for (const l of byPr.values()) {
    // Orders the landings for the "measured HH:MM" stamp ONLY: `at` is one fixed-width UTC stamp (`isRadarStamp`), so
    // strings order like times. Freshness is `landingShown`'s alone (D-7481).
    if (oldestAt === '' || l.at < oldestAt) oldestAt = l.at;
    if (!l.paired) unpaired.push({ project: l.project, pr: l.pr });
    if (!isClean(l) && !inConflict(l)) partial = true;
    if (hasCut(l)) partial = true;
    if (l.cut.heads || l.cut.pairs) listCut = true;
    if (l.cut.unbound) unbound = true;
    if (l.base.state === 'unmeasured') {
      unmeasuredRefs.set(`${l.project}:b:${l.pr}`, { project: l.project, pr: l.pr, against: { base: l.baseRef } });
    }
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
    // An unmeasured pair is named once within its project, under its lower PR, as a conflict pair is.
    for (const other of l.unmeasuredWith) {
      const lo = Math.min(l.pr, other);
      const hi = Math.max(l.pr, other);
      const key = `${l.project}:p:${lo}:${hi}`;
      if (!unmeasuredRefs.has(key)) unmeasuredRefs.set(key, { project: l.project, pr: lo, against: { pr: hi } });
    }
  }
  const conflicted = [...lines.values()].sort(byRef);
  const unmeasured = [...unmeasuredRefs.values()].sort(byRef);
  unpaired.sort((a, b) => a.project.localeCompare(b.project) || a.pr - b.pr);
  const projects = new Set([...byPr.values()].map((l) => l.project)).size;
  return { measured: byPr.size, projects, unpaired, conflicted, partial, unmeasured, listCut, unbound, oldestAt };
}

// A base merge sorts before a pair of the same PR: it has no second PR.
const againstPr = (r: ConflictRef): number => ('pr' in r.against ? r.against.pr : 0);
const byRef = (a: ConflictRef, b: ConflictRef): number =>
  a.project.localeCompare(b.project) || a.pr - b.pr || againstPr(a) - againstPr(b);

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

const PATHS_CUT_WORDS = ' (more paths not recorded)';
const LIST_CUT_WORDS = 'Not every open PR or pair of PRs was measured';
const UNBOUND_WORDS = "A PR on a session's branch was not matched to its session, so it was not compared with the others";

/** The first `CHIP_PATHS_MAX` items, then " and N more" when some were left out. */
const capped = (items: readonly string[]): string =>
  items.slice(0, CHIP_PATHS_MAX).join(', ') + (items.length > CHIP_PATHS_MAX ? ` and ${items.length - CHIP_PATHS_MAX} more` : '');

/** One merge by PR number: "#12 with main", "#12 with #14", with its project in front when the fleet spans projects. */
const refWords = (r: ConflictRef, named: boolean): string =>
  `${named ? `${r.project} ` : ''}#${r.pr} with ${'base' in r.against ? r.against.base : `#${r.against.pr}`}`;

const lineSentence = (line: ConflictLine, named: boolean): string => {
  const who = named ? `${line.project}: ` : '';
  const where = line.paths.length === 0 ? '' : ` in ${capped(line.paths)}`;
  const cut = line.pathsCut ? PATHS_CUT_WORDS : '';
  return who + ('base' in line.against
    ? `PR #${line.pr} conflicts with ${line.against.base}${where}${cut}`
    : `PRs #${line.pr} and #${line.against.pr} conflict${where}${cut}`);
};

/** The chip's accessible name and title: the word, at most `CHIP_LINES_MAX` conflicts by PR number, base and path, what was
 *  left out and which PRs it names, and when the oldest reading was measured. */
export function conflictChipSentence(summary: ConflictSummary): string {
  const at = timeOf(summary.oldestAt);
  const named = summary.projects > 1;
  const more = summary.conflicted.length - CHIP_LINES_MAX;
  return [
    conflictChipWord(summary),
    ...summary.conflicted.slice(0, CHIP_LINES_MAX).map((line) => lineSentence(line, named)),
    ...(more > 0 ? [`and ${more} more`] : []),
    ...(summary.listCut ? [LIST_CUT_WORDS] : []),
    ...(summary.unbound ? [UNBOUND_WORDS] : []),
    ...(summary.unmeasured.length > 0
      ? [`${summary.unmeasured.length} not measured: ${capped(summary.unmeasured.map((r) => refWords(r, named)))}`] : []),
    ...(summary.unpaired.length > 0
      ? [`${summary.unpaired.length} not paired: ${capped(summary.unpaired.map((r) => `${named ? `${r.project} ` : ''}#${r.pr}`))}`] : []),
    ...(at === '' ? [] : [`measured ${at}`]),
  ].join('. ');
}
