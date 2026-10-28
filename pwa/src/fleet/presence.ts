// IS THE SESSION THERE, in the PWA: the server's word, read once (D-7181; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, Task C7c; ARCH-49, spec K3).
//
// The server computes `FleetSession.presence` once (`server/src/sessionReading.ts#readSession`, ARCH-47 and ARCH-48):
// `alive`, `asleep` (hibernated, woken by mail or ensure), `dead` (the pane is gone under a lifecycle that does not
// resolve on its own) or `unknown` (doubt: tmux did not answer, the lifecycle could not be read). DOUBT IS NEVER DEAD.
// This module is the PWA's one reader of that word, and of the one other fact OA-C15 (a) keeps (D-7265, #1760):
//
//   - `presenceOf`: a site that offers a door or counts live sessions follows the server's word. An absent key (a
//     server older than ARCH-48, or a snapshot written before the revive kept it, D-7208) and a word this build does
//     not know read `unknown`, and `unknown` hides the door: a hidden door costs one refresh, a door over a live session
//     costs its work.
//   - `coordinatorPresence`: the run board's and the orphan marker's coordinator, `coordPresence`'s frame and claim
//     rules over `presenceOf`, in its four words (`asleep` is spelled `hibernated` there, so every screen word stays).
//   - `paneGone`: a site that only WORDS what the pane shows (a note, a chip, a fact about a running pane) reads the
//     pane itself. The assembly writes `status: 'dead'` for a pane tmux called gone and for one it could not ask
//     (D-309), so this is "the pane is not shown running", never "the session is dead"; no door may hang on it.
//
// L1: pure, clock-free and store-free; no `.tsx`, store or `lib/api.ts` import.
import { PRESENCES, type FleetSession, type Presence } from '../../../shared/api';

/** The server's word for one row. The `fleet` frame is CAST on arrival (`stores/fleet.ts`'s `asFleetMsg`), so the
 *  field is read as `unknown` at runtime: an absent key or a word this build has never heard of reads `unknown`. */
export function presenceOf(session: Partial<Pick<FleetSession, 'presence'>>): Presence {
  const p: unknown = session.presence;
  return typeof p === 'string' && (PRESENCES as readonly string[]).includes(p) ? (p as Presence) : 'unknown';
}

/** The client's answer to "is the run's coordinator there?" (program-leverage wave 5, D-1129). Four answers; `unknown`
 *  hides the Resume door and says nothing of a gone coordinator. `hibernated` (D-5242): asleep, woken by mail or when
 *  opened, never `dead` (no Resume door, no "coordinator gone", D-5430). */
export type CoordinatorPresence = 'alive' | 'dead' | 'hibernated' | 'unknown';

const COORDINATOR_WORD: Record<Presence, CoordinatorPresence> = {
  alive: 'alive', asleep: 'hibernated', dead: 'dead', unknown: 'unknown',
};

/** `coordPresence`'s two rules the client alone can know, over the server's word: a run that names no claimant, and a
 *  fleet frame that has not landed (a session missing from an unlanded frame is not a missing session, D-1138), read
 *  `unknown`; so does a claimant the landed frame does not list. Otherwise the claimant's presence, in these words. */
export function coordinatorPresence(
  claimedBy: string | null,
  session: FleetSession | null | undefined,
  frameSeen: boolean,
): CoordinatorPresence {
  if (claimedBy === null) return 'unknown';
  if (!frameSeen) return 'unknown';
  if (session === null || session === undefined) return 'unknown';
  return COORDINATOR_WORD[presenceOf(session)];
}

/** The pane is not shown running: the assembly's `dead` status (a gone pane, or one tmux could not be asked about).
 *  For the sites that word what the pane shows; a door or a live count reads `presenceOf`. */
export function paneGone(session: Pick<FleetSession, 'status'>): boolean {
  return session.status === 'dead';
}
