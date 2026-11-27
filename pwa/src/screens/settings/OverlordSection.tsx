// Settings › Overlord (Overlord W1 home C, Tasks 8 and 9; spec 2026-11-09 §3.4, Table 11.1a, Table 11.1d's Settings row; plan
// `w1-home.md` Tasks 8 and 9, slug `settings-gains-an-overlord-section`): six cards, each a `Section` with its scope and purpose
// line, in this order: the Overlord (its state, the place's link, Retire), the model class, the account set, the renewal backstop,
// the response retention, and each account's facts with its hold. Ring L4, context K (a settings screen): it decides nothing.
//
// DRAWN ONLY UNDER `overlord-v1` (plan question 9): the frame draws Settings' index in its place without the word, and the index
// lists no Overlord row. A server whose designation read is `absent` (an older one) draws one sentence and no card.
//
// ONE STEP-UP FOR THE SECTION (the hook's one-instance rule, F16): one `useStepUp` and one `ConfirmItsYou`, drawn inside the
// card whose act was refused `step-up-required`, so the step sits beside the act it is for and is never mounted twice. Every card
// acts first (`ASSUME_FRESH`): the door is the authority on whether the act needs the step (the brief's ruling 1).
//
// THE CARDS' GATE (plan question 3): the Overlord, the model class and the account set act on the designation and are drawn from
// the store's read through `overlordGateOf`. The backstop, the retention and the account facts act on their own rows, so they are
// drawn in every state of the designation but `absent` (slug `independent-cards-draw-without-a-designation`): the account facts
// in particular are what Start counts, so they must be settable before any Overlord exists.
import { useCallback, useState, type ReactNode } from 'react';
import { ConfirmItsYou } from '../../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../../accounts/useStepUp';
import { OVERLORD_SETTINGS_WORDS as W, overlordGateOf } from '../../overlord/overlordSettingsWords';
import { useOverlordStore } from '../../stores/overlord';
import { AccountFactsCard } from './AccountFactsCard';
import {
  AccountSetCard, BackstopCard, DesignationCard, ModelCard, RetentionCard, type SectionCtx,
} from './overlordCards';
import '../../overlord/overlord.css';

const NO_STEP_UP_DEPS: StepUpDeps = {};
/** The section acts first and shows the step on `step-up-required` (`useStepUp`'s rule): the server's gate is the authority. */
const ASSUME_FRESH = Infinity;

export function OverlordSection({ stepUpDeps = NO_STEP_UP_DEPS }: { readonly stepUpDeps?: StepUpDeps }): ReactNode {
  const read = useOverlordStore((s) => s.designation);
  const gate = overlordGateOf(read);
  const stepUp = useStepUp(ASSUME_FRESH, stepUpDeps);
  const [asking, setAsking] = useState<string | null>(null);
  const confirmFor = useCallback((card: string): ReactNode => (asking === card
    ? <ConfirmItsYou stepUp={stepUp} subject="the Overlord's settings" /> : null), [asking, stepUp]);
  if (gate.kind === 'absent') return <p className="settings-note" role="status" data-settings-overlord="absent">{W.absent}</p>;
  const ctx: SectionCtx = { stepUp, gate, confirmFor, ask: setAsking };
  return (
    <div className="ovs-section" data-settings-overlord={gate.kind}>
      <DesignationCard ctx={ctx} />
      <ModelCard ctx={ctx} />
      <AccountSetCard ctx={ctx} />
      <BackstopCard ctx={ctx} />
      <RetentionCard ctx={ctx} />
      <AccountFactsCard ctx={ctx} />
    </div>
  );
}
