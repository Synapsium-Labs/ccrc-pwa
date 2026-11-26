// The readiness part of the Overlord's place (Overlord W1 home B, Task 4; plan question 5, Table 4a's first part): L4, the place's
// form of the word. It draws one read of the word as the store holds it, through `readinessViewOf` (L1) and decides nothing: the word
// with its sentence and status label, since, `until` as the time left, `why`, the strand cause, and where questions go (from the
// wire's `questionsGo`, never from the word). A word the console does not know is drawn raw with "unknown word". A read that failed
// says "unmeasured" with its error and never a value; a stale one draws its last answer with "last read hh:mm"; an older server's
// 404 says no Overlord is bound.
//
// PAUSE sits here, drawn in every state: the brake never hides behind a failed read. One tap, no step-up (the doors are
// `useLadderDoors`'s, called once by the place and handed to this part and the ladder part). The "taking effect" line follows it
// until the ladder read says `done`, and its refusal is said beside it.
//
// Class hooks for the place's one stylesheet: `ovl-readiness` (the card), `ovl-readiness-head` (word row), `ovl-status` with
// `ovl-status--ok|quiet|attention|dead` (the status label), `ovl-readiness-meta` (since, time left, last read),
// `ovl-readiness-detail` (why, strand cause, where questions go), `ovl-pause` (the Pause button row) and `ovl-note` (a status line).
import type { ReactNode } from 'react';
import { Button, Chip, useNow } from '@ccrc/ui';
import { useLadder, useReadiness } from '../stores/overlord';
import { takingEffectLine } from './ladderWords';
import { DoorLines } from './LadderPart';
import { READINESS_ABSENT, READINESS_LOADING, readinessUnmeasuredWords, readinessViewOf } from './readinessWords';
import type { LadderDoors } from './useLadderDoors';

const NOW_TICK_MS = 15_000;

export function ReadinessPart({ doors }: { readonly doors: LadderDoors }): ReactNode {
  const read = useReadiness();
  const ladder = useLadder();
  const now = useNow(NOW_TICK_MS);
  const view = readinessViewOf(read, now);
  const line = doors.door === 'pause' ? takingEffectLine(doors.narrowing, ladder) : null;
  const said = doors.door === 'pause' ? doors.said : null;
  return (
    <section className="ovl-readiness" data-readiness-part aria-label="Overlord readiness">
      {view.kind === 'loading' && <p className="ovl-note" role="status">{READINESS_LOADING}</p>}
      {view.kind === 'unmeasured' && (
        <p className="ovl-note" role="status" data-readiness-unmeasured>{readinessUnmeasuredWords(view.error)}</p>
      )}
      {view.kind === 'absent' && <p className="ovl-note" data-readiness-absent>{READINESS_ABSENT}</p>}
      {view.kind === 'answered' && (
        <>
          <p className="ovl-readiness-head">
            <Chip dot className={`ovl-status ovl-status--${view.lines.tone}`} data-tone={view.lines.tone} data-readiness-word>
              {view.lines.word}
            </Chip>
            <span data-readiness-sentence>{view.lines.sentence}</span>
          </p>
          <p className="ovl-readiness-meta">
            <span data-readiness-since>{`since ${view.lines.since}`}</span>
            {view.lines.timeLeft !== null && <span data-readiness-left>{view.lines.timeLeft}</span>}
            {view.lastRead !== null && <span data-readiness-stale>{view.lastRead}</span>}
          </p>
          <div className="ovl-readiness-detail">
            {view.lines.why !== null && <p data-readiness-why>{`Why: ${view.lines.why}`}</p>}
            {view.lines.strand !== null && <p data-readiness-strand>{view.lines.strand}</p>}
            <p data-readiness-questions>{view.lines.questions}</p>
          </div>
        </>
      )}
      <div className="ovl-pause">
        <Button variant="ghost" size="fit" disabled={doors.busy} onClick={() => { void doors.pause(); }}>Pause</Button>
      </div>
      <DoorLines line={line} said={said} />
    </section>
  );
}
