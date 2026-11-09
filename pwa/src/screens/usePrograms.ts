// The board's programmes (the runs rebuild, Task 18, D-8075; spec 2026-11-04 §8.2.2, §8.2.3, §11.6). `GET /api/programmes`
// is read on mount and again when the live runs frame changes what is open or where a run stands, so a close or a new wave
// reaches the cards without a poll. The CARDS are the live frame's open programmes (nothing else lists an open run, the
// board's standing rule); this answer gives each its wave counts and last move, and gives the Finished fold its endings.
// A programme the live frame holds that this answer does not (a read not yet landed, or an older server) still has a
// card, counted from the open runs alone, so a card never waits on this read to exist.
//
// Pure helpers first (`openCards`, `quietSplit`, `finishedProgrammes`, `endingWords`), then the hook.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProgrammeEnding, ProgrammeRow, ProgrammesAnswer, RunClosedBy, RunSummary } from '../../../shared/api';
import { WAVE_BUCKET, programmeCurrentWave } from '../../../shared/programmes';
import { api, ApiTimeout } from '../lib/api';
import { isOlderServerAnswer } from './useRunList';
import { programWave, programmeTitle, runLastMove, runsByProgram } from '../fleet/runWords';

/** A programme with no run opened or closed for this long folds under quiet programmes (§8.2 item 8), and a finished one
 *  leaves the Finished fold (§8.2.3). */
export const QUIET_AFTER_MS = 7 * 86_400_000;

/** One card: the programme's facts, and its open runs as the live frame has them. */
export interface CardProgramme {
  readonly row: ProgrammeRow;
  readonly open: readonly RunSummary[];
  readonly title: string;
}

/** The programme's row counted from its open runs alone: the stand-in while the read has not landed. `done` is unknown
 *  there (a closed run is not in the frame) and reads zero, so it is left off the line rather than shown as a count. */
function derivedRow(slug: string, open: readonly RunSummary[]): ProgrammeRow {
  const work = open.filter((r) => r.kind !== 'review');
  const byWave = new Map<number, RunSummary>();
  for (const r of work) {
    const cur = byWave.get(r.wave);
    if (cur === undefined || r.id > cur.id) byWave.set(r.wave, r);
  }
  const waves = { working: 0, waiting: 0, queued: 0, done: 0, failed: 0 };
  const facts = [...byWave].map(([wave, r]) => {
    const bucket = WAVE_BUCKET[r.state] ?? 'working';
    waves[bucket] += 1;
    return { wave, waveOf: r.waveOf, bucket };
  });
  const cur = programmeCurrentWave(facts);
  const { waveOf } = programWave(open);
  const moves = open.map(runLastMove).filter((t): t is number => t !== null);
  const newest = [...open].sort((a, b) => b.id - a.id)[0];
  return {
    slug, title: programmeTitle(slug, open), currentWave: cur === null ? null : cur.wave, waveOf: cur === null ? waveOf : cur.waveOf,
    claimedBy: newest?.claimedBy ?? null, waves, lastMoveAt: moves.length === 0 ? null : Math.max(...moves), ending: null,
  };
}

/** The row with its last move raised to the newest move the live frame holds for the programme's open runs. */
function withFrameMove(row: ProgrammeRow, open: readonly RunSummary[]): ProgrammeRow {
  let best = row.lastMoveAt;
  for (const r of open) {
    const t = runLastMove(r);
    if (t !== null && (best === null || t > best)) best = t;
  }
  return best === row.lastMoveAt ? row : { ...row, lastMoveAt: best };
}

/** Whether a body is a `GET /api/programmes` answer: a partial one reads as no answer, never as a crash (D-8075). */
export function isProgrammesAnswer(a: unknown): a is ProgrammesAnswer {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as { programmes?: unknown; closedToday?: unknown };
  const c = o.closedToday as { operator?: unknown; sweep?: unknown; coordinator?: unknown } | null | undefined;
  return Array.isArray(o.programmes) && typeof c === 'object' && c !== null
    && typeof c.operator === 'number' && typeof c.sweep === 'number' && typeof c.coordinator === 'number';
}

/** The cards: one per programme the live frame holds an open run of, each with the read's row when it has one. A programme
 *  with a gone coordinator has a card too, because the cards come from runs and not from coordinators. */
export function openCards(open: readonly RunSummary[], answer: ProgrammesAnswer | null): CardProgramme[] {
  const rows = new Map((answer?.programmes ?? []).map((p) => [p.slug, p] as const));
  return runsByProgram(open).map(({ program, runs }) => {
    const read = rows.get(program);
    // The read is a snapshot taken when a run's state last changed; the live frame carries each run's newer `lastMoveAt` (D-7334)
    // without any state change, so the card's last move is the newer of the two, or a worker moving inside one long state
    // would read as stalled.
    const row = read === undefined ? derivedRow(program, runs) : withFrameMove(read, runs);
    const named = programmeTitle(program, runs);
    return { row, open: runs, title: named !== program || row.title.trim() === '' ? named : row.title };
  });
}

/** Cards in the board's order: the programmes that need the operator first, then the newest move first, ties by title. */
export function sortCards(cards: readonly CardProgramme[], needs: (slug: string) => number): CardProgramme[] {
  return [...cards].sort((a, b) =>
    Number(needs(b.row.slug) > 0) - Number(needs(a.row.slug) > 0)
    || (b.row.lastMoveAt ?? -Infinity) - (a.row.lastMoveAt ?? -Infinity)
    || a.title.localeCompare(b.title));
}

/** The cards split into the live list and the quiet fold: quiet is no move for 7 days, and a programme that needs the
 *  operator is never quiet. Exactly 7 days is quiet and 6 is not. */
export function quietSplit(
  cards: readonly CardProgramme[], nowMs: number, needs: (slug: string) => number,
): { live: CardProgramme[]; quiet: CardProgramme[] } {
  const live: CardProgramme[] = [];
  const quiet: CardProgramme[] = [];
  for (const c of cards) {
    const at = c.row.lastMoveAt;
    (at !== null && nowMs - at >= QUIET_AFTER_MS && needs(c.row.slug) === 0 ? quiet : live).push(c);
  }
  return { live, quiet };
}

/** The programmes the Finished fold lists: an ending, no open run in the live frame, the last move within 7 days; the
 *  newest first. */
export function finishedProgrammes(answer: ProgrammesAnswer | null, openSlugs: ReadonlySet<string>, nowMs: number): ProgrammeRow[] {
  return (answer?.programmes ?? [])
    .filter((p) => p.ending !== null && !openSlugs.has(p.slug) && (p.lastMoveAt === null || nowMs - p.lastMoveAt <= QUIET_AFTER_MS))
    .sort((a, b) => (b.lastMoveAt ?? 0) - (a.lastMoveAt ?? 0) || a.slug.localeCompare(b.slug));
}

const CLOSER: Readonly<Record<RunClosedBy, string>> = { operator: 'you', sweep: 'ccrc', coordinator: 'the coordinator' };

/** A finished programme's ending in words (§8.2.3, A26): "complete · 5 waves done", "ended · 3 never started (closed by
 *  ccrc)", "ended · closed by you". */
export function endingWords(e: ProgrammeEnding): string {
  if (e.outcome === 'complete') return `complete · ${e.waves} ${e.waves === 1 ? 'wave' : 'waves'} done`;
  const by = e.closedBy === null ? null : CLOSER[e.closedBy];
  if (e.neverStarted > 0) return `ended · ${e.neverStarted} never started${by === null ? '' : ` (closed by ${by})`}`;
  return by === null ? 'ended' : `ended · closed by ${by}`;
}

/** The operator's local midnight, in epoch ms (A32): the PWA has the timezone, the server clamps. */
export function localMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export type ProgrammesReader = (since: number) => Promise<ProgrammesAnswer>;
/** The board's reader, module-scope so its identity is stable across renders. */
export const readProgrammes: ProgrammesReader = (since) => api.programmes(since);

export type ProgrammesState = 'loading' | 'ok' | 'error' | 'older';

export interface Programmes {
  /** The last answer, or null for none yet. A failed re-read keeps it. */
  readonly answer: ProgrammesAnswer | null;
  readonly state: ProgrammesState;
  /** Whether the read that left `state` at `error` ran out of time (C1's `ApiTimeout`). */
  readonly timedOut: boolean;
  readonly reload: () => Promise<void>;
}

/** What the live frame says is open and where each run stands: a change reads again. */
const standing = (live: readonly RunSummary[]): string => live.map((r) => `${r.id}:${r.state}`).join(',');

export function usePrograms(
  { read = readProgrammes, live, seen, now = Date.now }:
  { read?: ProgrammesReader; live: readonly RunSummary[]; seen: boolean; now?: () => number },
): Programmes {
  const [answer, setAnswer] = useState<ProgrammesAnswer | null>(null);
  const [state, setState] = useState<ProgrammesState>('loading');
  const [timedOut, setTimedOut] = useState(false);
  const issued = useRef(0);
  const readRef = useRef(read);
  readRef.current = read;
  const nowRef = useRef(now);
  nowRef.current = now;

  const reload = useCallback(async (): Promise<void> => {
    const mine = ++issued.current;
    try {
      const a = await readRef.current(localMidnight(nowRef.current()));
      if (mine !== issued.current) return;
      if (!isProgrammesAnswer(a)) { setState('older'); setTimedOut(false); return; }
      setAnswer(a);
      setState('ok');
      setTimedOut(false);
    } catch (err) {
      if (mine !== issued.current) return;
      setTimedOut(err instanceof ApiTimeout);
      // An older server has no such route (`isOlderServerAnswer`, the one reader of that skew): it counts as answered, and the
      // cards fall back to the frame.
      setState(isOlderServerAnswer(err) ? 'older' : 'error');
    }
  }, []);

  const key = seen ? standing(live) : '';
  useEffect(() => { void reload(); }, [reload, key]);
  return { answer, state, timedOut, reload };
}
