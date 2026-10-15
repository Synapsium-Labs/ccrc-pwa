// THE ORPHANED WORKER'S MARKER — the sentence a card prints beside a worker
// whose coordinator is not one of its own live rows.
//
// Lifted out of `ProjectCard`, where it was eighty-odd lines of ruling between
// the row list and the repo label. Every one of those rulings is about WHAT TO
// SAY and WHEN TO STAY SILENT; none of it renders.
import type { FleetSession, RunSummary } from '../../../shared/api';
import { coordPresence, type CoordPresence } from './coordWords';
import { crossingNote, runForSession, waveLabel } from './runWords';
import type { FleetRow } from './nestFleet';

export interface OrphanNote {
  /** On the row itself. */
  readonly text: string;
  /** The `title`, which a phone never shows — see the `gone` clause below. */
  readonly title: string;
  readonly presence: CoordPresence;
}

// F4. `nestFleet`'s rule 3 leaves a worker whose coordinator is NOT on this
// card at depth 0, unbracketed — right, and until now silent. This is the
// sentence that ends the silence, computed HERE (the level that holds the
// runs) from the run the card already has, so the tree stays pure and its
// five rules stay exactly as they are.
//
// TWO facts, stated only when measured. The programme and wave come off the
// run itself and are always available. The HOME clause is Task 5's own
// decision — `crossingNote`, not a second copy of its predicate (D-2575) —
// asked against THIS CARD's project, `group.project`, not `run.project`
// (D-2576, re-read for wave 2): `group.project` is now the card this row
// was PLACED on, which for a moved worker is its COORDINATOR's project. The
// question the home clause asks is therefore "is this programme homed
// somewhere other than the card the reader is looking at", which is still
// the right question for a sentence printed on that card; `run.project`
// would ask about a card the row is not on.
// `crossingNote` answers `null` for two distinct reasons — home unknown (the
// legacy generation, or an older server) or home genuinely IS this card's
// project (measured sameness) — and both read the same way here: nothing to
// claim about a home, so nothing is claimed.
//
// The guard below reads as ONE two-reasons-for-one-silence statement:
// `parent === null` (no coordinator at all) and `parent === row.session.id`
// (self-claimed) are two different reasons there is no OTHER coordinator to
// call off-card, and collapsing either into "coordinator elsewhere" would be
// the overloaded silence this repo forbids at a seam. Only the `parent ===
// null` clause is independently load-bearing, though (D-2574(c), measured):
// a rendered row's own session is, by construction, always a member of
// `group.sessions` (rows are built from that exact array), so `parent ===
// row.session.id` implies the `group.sessions.some(...)` guard one line
// down is already true — dropping the self-claim clause changes nothing for
// any reachable row. Kept for what it documents, not for what it guards.
//
// The `group.sessions.some(...)` guard is what makes this the ORPHAN's marker
// and not every worker's: a child whose parent IS on this card is USUALLY
// bracketed, and the bracket already says what this sentence would say — but
// not always. `nestFleet`'s rule 4 lifts a session that is BOTH a child and
// a parent back to depth 0 with no bracket at all (`nestFleet.test.ts:145-157`
// pins it), and that row still reaches this guard, still finds its parent on
// `group.sessions`, and still returns null here — so this card says nothing
// about it either. That silence is acceptable for the same reason rule 4
// itself gives: the row IS a parent, rendering its own children beneath it,
// and a THIRD sentence ("your parent is also on this card") next to a row
// that is already a visible coordinator was judged not worth a marker; it is
// not evidence the guard's premise holds for every depth-0 row. It looks only
// at `group.sessions`, never `group.archived` — an archived coordinator IS
// still a row on this card (`group.archived.map(...)` renders it under the
// `Archived (N)` fold), just not among this card's LIVE rows, so a worker
// left behind by one still reads as an orphan (and still says nothing about
// home when that home is, measured, this card's own project).
export function orphanNote(
  row: FleetRow,
  runs: readonly RunSummary[],
  project: string,
  live: readonly FleetSession[],
  coordOf: (id: string) => FleetSession | null,
  frameSeen: boolean,
): OrphanNote | null {
  if (row.kind !== 'session' || row.depth !== 0) return null;
  const run = runForSession(runs, row.session.id);
  if (run === null) return null;
  const parent = run.claimedBy;
  if (parent === null || parent === row.session.id) return null;
  if (live.some((s) => s.id === parent)) return null;
  const crossing = crossingNote({ ...run, project });
  const label = `${run.program} ${waveLabel(run)}`;
  // D-3009: the runs board's own three-answer read (`coordPresence`), off a
  // FLEET-WIDE lookup — the coordinator may sit on another card, in an
  // archive fold, or nowhere this pass — so the marker never claims more
  // than the frame has actually measured.
  const presence = coordPresence(parent, coordOf(parent), frameSeen);
  const where = presence === 'dead'
    ? `coordinator ${parent} is gone — reclaim this programme from the run board (the held cell opens it)`
    : `this worker's coordinator is not among this card's live sessions`;
  // …AND IN THE TEXT, not only in `title`/`data-presence` (final fix round).
  // Both of those are invisible on touch — there is no hover on a phone, and
  // this board is mobile-first — so the one measured fact that changes what
  // the operator should DO (reclaim it) reached only a laptop. `dead` alone:
  // `unknown` and `alive` say nothing new, because `coordPresence` refusing
  // to measure is not a claim that anything is gone (D-1138).
  const gone = presence === 'dead' ? ' · coordinator gone' : '';
  return crossing === null
    ? { text: `${label}${gone}`, title: where, presence }
    : {
        text: `${label} · home ${crossing.home}${gone}`,
        title: `${where}; the programme is homed in ${crossing.home}`,
        presence,
      };
}
