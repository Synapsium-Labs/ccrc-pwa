/**
 * L4 delivery lane (context C4, landing order wave 5h): the landed reader ACTS. Once a sweep it walks the entries still
 * in the landing line, reads ten of them from GitHub by PR number (`ccd pr-state --project <p> --pr <n>`), and asks the
 * line's one writer (`CoordStore.advanceLanding`, the land arm) to mark each merged one landed and each closed or absent
 * one closed. Every DECISION it acts on is `landed.ts`'s (L1) or `landingEntry.ts`'s (L1): which entries are landable,
 * which are read, what an answer means, when the entry is read again. It reads the store only through its injected port.
 * It sends the PR-keyed form only behind `ccdCan(…, 'prStatePr')` and treats a call that did not run as a stop, never as
 * an answer about the PR.
 */
import type { FleetState } from '../fleetstate.js';
import type { NoticeSink } from '../notice.js';
import { readPrStatePrLine } from '../prstate.js';
import { CCD_ARGV, ccdCan } from '../ccdargv.js';
import type { RunCcd, WatcherCoordPort } from './ports.js';
import type { LandingEntry } from '../../../shared/landingLine.js';
import {
  landedAnswerOf, landedCandidatesOf, landedLandOf, landedNext, landedNoticeModeOf, mergedBody, mergedKey, mergedNoticeOf,
  pickLandedReads, type LandedCandidate, type LandedMemory,
} from './landed.js';

export interface LandedLaneDeps {
  coord: Pick<WatcherCoordPort, 'advanceLanding' | 'hasNotice' | 'landingReadProjects' | 'readLanding' | 'run'>;
  runCcd: RunCcd;
  fleetState?: FleetState;
  notice: NoticeSink;
  now: () => number;
  memory: Map<number, LandedMemory>;
  warn: (line: string) => void;
}

/** What one pass did: reads that ran, entries marked, and why it ended early (null: it did not). */
export type LandedPassResult = { read: number; landed: number; closed: number; stopped: null | 'unsupported' | 'store' | 'link' };

/** The warnings said once per process: the watcher's memory map lives as long as the process, so it keys the latch. */
const said = new WeakMap<object, Set<string>>();
function sayOnce(deps: LandedLaneDeps, key: string, line: string): void {
  let set = said.get(deps.memory);
  if (set === undefined) { set = new Set(); said.set(deps.memory, set); }
  if (set.has(key)) return;
  set.add(key);
  deps.warn(line);
}

/** The line is fenced by the reader's own mark, or the store stopped the pass: each said once. */
function sayStopped(deps: LandedLaneDeps, error: string): void {
  sayOnce(deps, `stopped:${error}`, `ccrc-server: landed reader: stopped (${error}); no entry is read until it clears`);
}

/** The merged record of a landed entry: once per (session, PR), through the notice funnel. `no-session` when the entry
 *  names no run, the run cannot be read or has no session; `already` when the archive holds the record. A throw from
 *  `hasNotice` raises, as the merged sweep's does. */
export function raiseLandedNotice(f: {
  coord: Pick<WatcherCoordPort, 'hasNotice' | 'run'>; notice: NoticeSink; entry: LandingEntry; mergedAt: string | null; now: number;
}): 'raised' | 'already' | 'no-session' {
  if (f.entry.runId === null) return 'no-session';
  const read = f.coord.run(f.entry.runId);
  if (!read.ok || read.run === null || read.run.sessionId === null) return 'no-session';
  const sessionId = read.run.sessionId;
  const key = mergedKey(sessionId, f.entry.pr);
  if (f.coord.hasNotice('merged', sessionId, key, mergedBody(f.entry.pr, null))) return 'already';
  const workspace = read.run.branch?.split('/').pop() || sessionId;
  const { dedupeKey, tag, ...record } = mergedNoticeOf({ pr: f.entry.pr, reason: null, sessionId, workspace, key });
  f.notice(record, landedNoticeModeOf(f.mergedAt, f.now), { tag, dedupeKey, lane: 'landed reader' });
  return 'raised';
}

export async function landedPass(deps: LandedLaneDeps): Promise<LandedPassResult> {
  const result: LandedPassResult = { read: 0, landed: 0, closed: 0, stopped: null };
  if (!ccdCan(deps.fleetState, 'prStatePr')) return { ...result, stopped: 'unsupported' };
  const projects = deps.coord.landingReadProjects();
  if (!projects.ok) { sayStopped(deps, projects.error); return { ...result, stopped: 'store' }; }
  const cands: LandedCandidate[] = [];
  let complete = true;
  for (const project of projects.projects) {
    const read = deps.coord.readLanding(project);
    if (read.ok) { cands.push(...landedCandidatesOf(read.facts)); continue; }
    if (read.error === 'landing-projection-unreadable') { complete = false; continue; }
    sayStopped(deps, read.error);
    return { ...result, stopped: 'store' };
  }
  if (complete) {
    const live = new Set(cands.map((c) => c.id));
    for (const id of [...deps.memory.keys()]) if (!live.has(id)) deps.memory.delete(id);
  }
  for (const cand of pickLandedReads(cands, deps.memory, deps.now())) {
    const res = await deps.runCcd(CCD_ARGV.prStatePr(cand.project, cand.pr));
    if (res.ran === false) {
      deps.memory.set(cand.id, landedNext(deps.memory.get(cand.id), cand, { act: 'retry', missingField: false }, deps.now()));
      return { ...result, stopped: 'link' };
    }
    result.read++;
    const read = res.ok ? readPrStatePrLine(res.stdout, cand.pr) : { state: 'call-failed' as const };
    const answer = landedAnswerOf(read);
    if (answer.act === 'wait' || answer.act === 'retry') {
      const next = landedNext(deps.memory.get(cand.id), cand, answer, deps.now());
      deps.memory.set(cand.id, next);
      if (next.missingStreak === 2) {
        sayOnce(deps, `missing-field:${cand.id}`,
          `ccrc-server: landed reader: ${cand.project} #${cand.pr} reads missing-field twice; reading it hourly`);
      }
      continue;
    }
    const mark = deps.coord.advanceLanding(landedLandOf(cand, answer, deps.now()));
    if (!mark.ok) {
      if (mark.error === 'landing-recovery-unresolved' || mark.error === 'landing-identity-conflict') {
        // A recovery refusal is the line's, not the PR's: read it again at the next sweep.
        const at = deps.now();
        deps.memory.set(cand.id, { ...landedNext(undefined, cand, { act: 'wait' }, at), nextAt: at });
        continue;
      }
      if (mark.error === 'landing-db-apply' || mark.error === 'landing-db-commit') {
        sayOnce(deps, `fence:${mark.error}`, `ccrc-server: landed reader: the mark of ${cand.project} #${cand.pr} answered ${mark.error}; the landing line is fenced until the server restarts`);
      } else {
        sayStopped(deps, mark.error);
      }
      return { ...result, stopped: 'store' };
    }
    deps.memory.delete(cand.id);
    if (mark.landing.kind === 'closed') result.closed++;
    if (mark.landing.kind !== 'landed') continue;
    result.landed++;
    try {
      raiseLandedNotice({
        coord: deps.coord, notice: deps.notice, entry: mark.landing.entry,
        mergedAt: answer.outcome.word === 'merged' ? answer.outcome.mergedAt : null, now: deps.now(),
      });
    } catch (err) {
      deps.warn(`ccrc-server: landed reader: the merged record of ${cand.project} #${cand.pr} failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  return result;
}
