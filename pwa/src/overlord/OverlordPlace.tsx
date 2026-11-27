// The Overlord's place (Overlord W1 home B, Task 4; spec 2026-11-09 §4, Table 4a): L4. One column, read from the top, in
// Table 4a's order: the readiness word with Pause and the Overlord's own controls (part 1, with the ladder beside Pause),
// "Since you were last here" (2), the portfolio strip (4) and the capacity line (5). Parts 3, 6 and 7 come from W3, W2 and
// the chat piece, which mounts below them; none is drawn here.
//
// It is drawn only under `overlord-v1`: `OverlordRoute` replaces the address with the Fleet's otherwise (plan question 9).
//
// ONE STEP-UP FOR THE PAGE (F16): one `useStepUp` and one `ConfirmItsYou` serve the body part (Start, Rebind) and the ladder
// part (a raise, a latch's Clear). `RestoreBanner` keeps its own, as its plan says.
//
// ONE STREAM (ruled F3): the place opens the bound Overlord's session store through `useOverlordSessionStream`, so the
// store's existing visibility beat tells the server the place is on display; the chat piece reuses that handle.
//
// It decides nothing: every part reads the store or its own read and asks its L1 words module.
import type { ReactNode } from 'react';
import { PageScaffold } from '@ccrc/ui';
import { ConfirmItsYou } from '../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../accounts/useStepUp';
import { useDesignationState, useOverlordStore } from '../stores/overlord';
import { BodyPart } from './BodyPart';
import { CapacityLine } from './CapacityLine';
import { FacePart } from './FacePart';
import { designationWordOf } from './homePlace';
import { LadderPart } from './LadderPart';
import { PortfolioStrip } from './PortfolioStrip';
import { ReadinessPart } from './ReadinessPart';
import { RestoreBanner } from './RestoreBanner';
import { SincePart } from './SincePart';
import { useLadderDoors } from './useLadderDoors';
import { useOverlordSessionStream } from './useOverlordSessionStream';
import './overlord.css';

const NO_STEP_UP_DEPS: StepUpDeps = {};
/** The place acts first and shows the step on `step-up-required` (`useStepUp`'s rule): the server's gate is the authority. */
const ASSUME_FRESH = Infinity;

export function OverlordPlace({ stepUpDeps = NO_STEP_UP_DEPS }: { readonly stepUpDeps?: StepUpDeps }): ReactNode {
  const state = useDesignationState();
  const designation = useOverlordStore((s) => s.designation);
  useOverlordSessionStream(state.kind === 'bound' ? state.sessionId : null);
  const stepUp = useStepUp(ASSUME_FRESH, stepUpDeps);
  const doors = useLadderDoors(stepUp);
  return (
    <PageScaffold title="Overlord">
      <div className="ov-place" data-overlord-place>
        <RestoreBanner />
        <header className="ov-place-head">
          <FacePart />
          <p className="ov-place-word" data-designation-word>{designationWordOf(designation)}</p>
        </header>
        <ReadinessPart doors={doors} />
        <BodyPart stepUp={stepUp} />
        <LadderPart doors={doors} />
        <SincePart />
        <PortfolioStrip />
        <CapacityLine />
        <ConfirmItsYou stepUp={stepUp} subject="Confirm it's you to change the Overlord" />
      </div>
    </PageScaffold>
  );
}
