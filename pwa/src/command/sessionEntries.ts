// The palette's session entries (D-6714, plan 2026-10-22-desktop-polish Task T5a): ONE builder of a session's entry and
// the terms it is found by, for the top search ('top', search-only) and the "Open session…" page ('page'). Pure: no
// React, no store.
//
// A session is found by its shown title (`sessionLabel`) and its underlying name (which a custom title may hide), its
// workspace slug, its branch, its project and its card when that differs, and, for a session that claims open runs,
// each programme's title and slug. A run's worker (`sessionId`) gets none of its programme's words: they belong to the
// claimant. A coordinator (`coordinatorRole`, never a claim) ranks first on an equal match, then the other sessions,
// then the exited ones.
import { boardHome, type FleetSession, type RunSummary } from '../../../shared/api';
import { isRunClosed, programmeTitle } from '../fleet/runWords';
import { COORDINATOR_WORD, coordinatorRole } from '../fleet/sessionFacts';
import { sessionLabel } from '../fleet/sessionLabel';
import type { Command } from './registry';

/** A coordinator's tier, any other session's, and an exited one's whatever its role. */
const TIER_COORDINATOR = 1;
const TIER_SESSION = 2;
const TIER_EXITED = 3;

/** The entry's group, said beside its title: the project, or `coordinator · <project>` for a coordinator. */
const groupWords = (project: string, lead: boolean): string => (lead ? `${COORDINATOR_WORD} · ${project}` : project);

/** The option's exact accessible name: `<title>, <project>`, or `<title>, coordinator, <project>`. */
const labelWords = (title: string, project: string, lead: boolean): string =>
  (lead ? `${title}, ${COORDINATOR_WORD}, ${project}` : `${title}, ${project}`);

/** Each session's palette entry, in the order given (the fleet's, `fleetOrder`). `runs` is the open runs frame; a
 *  closed run is skipped all the same. */
export function sessionEntries(
  sessions: readonly FleetSession[],
  runs: readonly RunSummary[],
  where: 'top' | 'page',
): Command[] {
  const open = runs.filter((r) => !isRunClosed(r));
  return sessions.map((s): Command => {
    const title = sessionLabel(s);
    const lead = coordinatorRole(s);
    const card = boardHome(s);
    const programmes = open.filter((r) => r.claimedBy === s.id).flatMap((r) => [programmeTitle(r.program, open), r.program]);
    const terms = [s.name, s.workspace, s.branch, s.project, card === s.project ? null : card, ...programmes]
      .filter((t): t is string => typeof t === 'string' && t.trim() !== '');
    return {
      id: `open-session-${s.id}`,
      title,
      group: groupWords(s.project, lead),
      label: labelWords(title, s.project, lead),
      terms,
      tier: s.bucket === 'dead' ? TIER_EXITED : lead ? TIER_COORDINATOR : TIER_SESSION,
      searchOnly: where === 'top',
      run: (c) => c.navigate(`/s/${encodeURIComponent(s.id)}`),
    };
  });
}
