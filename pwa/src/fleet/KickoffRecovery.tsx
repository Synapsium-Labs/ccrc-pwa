// The standing kickoff-failure recovery: the statement, plus the two acts that
// finish it.
//
// WHAT IT IS. A session was STARTED and its kickoff was not queued, so nothing
// durable exists for a coordinator to read. That is a standing fact with an
// act beside it, not a notification — which is why it is a statement on the
// sheet rather than a toast (`Toast.tsx` returns before minting an item once
// `isAuthLost()` is up, and `api.ts` raises that signal on any 401 BEFORE it
// throws, so on an armed box the old toast-only shape said nothing at all
// about a kickoff that never landed).
//
// WHY IT IS ITS OWN NODE, which travels with it and is the whole reason this
// file exists (wave-5 review, MINOR 6 / D-1149). It used to live inside the
// confirm fragment, the LAST arm of the sheet's refusal chain, so EVERY arm
// above it retired the recovery by rendering instead of it — and one of those
// arms is driven by a prop the run board rebuilds every ~2 s
// (`openRunProjects`, `screens/RunsScreen.tsx`). A run opening in this project
// while a queue failure was standing therefore replaced a live retry door and
// an open-anyway door with a sentence about a collision, on a poll tick the
// operator never touched — and the retry door is the ONLY control that can
// re-post for that session. A recovery that vanishes mid-recovery is worse
// than one never offered.
//
// THE CALL SITE STILL OWES SOMETHING, and it is the half extraction cannot
// enforce: every arm of that chain must render this BESIDE its own refusal,
// never instead of it. `start-program.test.tsx`'s "a run appearing
// mid-failure never retires the standing kickoff recovery (D-1149)" is the
// mechanism; this note is the reason.
import type { ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import { navigate } from '../lib/router';

/** The one shape the sheet records when a queue fails, carried verbatim —
 *  `sessionId` is the id `startedSessionFor` MEASURED, and a retry must not
 *  re-open the addressing question D-291/D-292 already settled. */
export interface KickoffFailure {
  readonly sessionId: string;
  readonly slug: string;
  readonly title: string;
  readonly why: string;
}

/** The go-button class this sheet's family wears — `program-start-go` is
 *  already grounded and measured by the contrast census, so neither control
 *  here introduces a coloured rule nothing has seen.
 *
 *  EXPORTED, and that is the literal census's doing: the extraction left the
 *  same string in two files, and `literal-census.test.ts` red on it within the
 *  minute. One home, one spelling — `StartProgramSheet`'s own Start button
 *  imports it from here. */
export const PROGRAM_GO = 'program-start-go text-sm enabled:active:scale-[0.98]';

export function KickoffRecovery({ failure, retrying, onRetry }: {
  /** `null` when no failure is standing, so an arm that renders this says
   *  nothing extra in the ordinary case. */
  failure: KickoffFailure | null;
  retrying: boolean;
  onRetry: () => void;
}): ReactNode {
  if (failure === null) return null;
  return (
    <>
      <p className="program-start-error">
        {/* Wave-4 review, MINOR 3 (D-1120). This used to open
            "<id> is running, but…", which on a 404 asserts the exact fact the
            registry had just denied — above a retry that cannot succeed. What
            the sheet KNOWS is that it started the session and that nothing was
            queued for it; the reason comes last, where a `why` with no
            trailing period (the `err.message` floor) does not read as a
            typo. */}
        {`Started ${failure.sessionId}, but its kickoff could not be queued `
          + `— nothing was sent, and it has no brief yet. ${failure.why}`}
      </p>
      <Button variant="quiet" className={PROGRAM_GO} disabled={retrying} onClick={onRetry}>
        {retrying ? 'Queueing…' : 'Queue the kickoff again'}
      </Button>
      {/* The honest other door: the session IS running, so the operator may
          want to brief it by hand from inside. It queues nothing on the way —
          that is what the button above is for. */}
      <Button
        variant="quiet"
        className={PROGRAM_GO}
        onClick={() => navigate(`/s/${encodeURIComponent(failure.sessionId)}`)}
      >
        Open it without a brief
      </Button>
    </>
  );
}
