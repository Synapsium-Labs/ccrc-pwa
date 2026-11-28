// Settings › Overlord (Overlord W1 home C, Tasks 8 and 9; spec 2026-11-09 §3.4, Table 11.1a, Table 11.1d's Settings row; plan
// `w1-home.md` Tasks 8 and 9, slug `settings-gains-an-overlord-section`): nine cards, each a `Section` with its scope and purpose
// line, in this order: the Overlord (its state, the place's link, Retire), the model class, the account set, the renewal backstop,
// the response retention, each account's facts with its hold, and (Overlord W2 Settings) the decision model's host and its rows,
// and the private-name list. Ring L4, context K (a settings screen): it decides nothing.
//
// DRAWN ONLY UNDER `overlord-v1` (plan question 9): the frame draws Settings' index in its place without the word, and the index
// lists no Overlord row. A server whose designation read is `absent` (an older one) draws one sentence and no card.
//
// ONE STEP-UP FOR THE SECTION (the hook's one-instance rule, F16): one `useStepUp` and one `ConfirmItsYou`, drawn inside the
// card whose act was refused `step-up-required`, so the step sits beside the act it is for and is never mounted twice. Every card
// acts first (`ASSUME_FRESH`): the door is the authority on whether the act needs the step (the brief's ruling 1).
//
// THE CONFIRM STARTS THE RETRY, for a card that hands one (W2 Settings, review 4139 F1, ruled call 1876): the key's Save, the
// list's Upload and Clear the list, whose values must not wait in a field for a second press. The section keeps the one retry
// handed with the step, and when the confirm lands (the step stops being needed) it sends it once: that send is the retry, and
// its own `step-up-required` is final. A press by the operator is always a first send. Any other `ask`, another card's answer
// included, drops a retry not yet sent. The hook itself still retries nothing (`useStepUp`); the other cards, the decision rows
// among them, are pressed again after the confirm, as before (slug `rows-keep-the-press-after-the-confirm`). A card that hands a
// retry is held whole while its step shows and, once the confirm lands, until its retry has been sent (`held`, review 4167 F2 and
// F3, ruled call 1930; review 4191 F1): every input and every act of it, so no keystroke or other act meets the retry, and another
// card's answer frees it. The retry's own send in flight holds the card from there, by the card's door. The retry is made by the
// card outside every send, so the closure kept here can reach no value a send read (F1).
//
// THE CARDS' GATE (plan question 3): the Overlord, the model class and the account set act on the designation and are drawn from
// the store's read through `overlordGateOf`. The backstop, the retention and the account facts act on their own rows, so they are
// drawn in every state of the designation but `absent` (slug `independent-cards-draw-without-a-designation`): the account facts
// in particular are what Start counts, so they must be settable before any Overlord exists. The decision model's and the
// private-name list's cards are drawn the same way (W2 Settings, the brief's ruling 3).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmItsYou } from '../../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../../accounts/useStepUp';
import { OVERLORD_SETTINGS_WORDS as W, overlordGateOf } from '../../overlord/overlordSettingsWords';
import { useOverlordStore } from '../../stores/overlord';
import { AccountFactsCard } from './AccountFactsCard';
import { DecisionModelCards } from './DecisionModelCard';
import { PrivateNamesCard } from './PrivateNamesCard';
import {
  AccountSetCard, BackstopCard, DesignationCard, ModelCard, RetentionCard, type SectionCtx, type StepRetry,
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
  const [pending, setPending] = useState<(StepRetry & { readonly card: string }) | null>(null);
  const ask = useCallback((card: string | null, retry?: StepRetry): void => {
    setAsking(card);
    setPending(card !== null && retry !== undefined ? { ...retry, card } : null);
  }, []);
  // The confirm landed: the step was needed and is not now. The retry handed with this card's step is sent, once.
  const wasNeeded = useRef(stepUp.needed);
  useEffect(() => {
    const was = wasNeeded.current;
    wasNeeded.current = stepUp.needed;
    if (!was || stepUp.needed || pending === null || pending.card !== asking) return;
    setPending(null);
    pending.send();
  }, [stepUp.needed, pending, asking]);
  const confirmFor = useCallback((card: string): ReactNode => (asking === card
    ? <ConfirmItsYou stepUp={stepUp} subject="the Overlord's settings" /> : null), [asking, stepUp]);
  if (gate.kind === 'absent') return <p className="settings-note" role="status" data-settings-overlord="absent">{W.absent}</p>;
  // Held while the card's step shows, and after the confirm until its retry has been sent (review 4191 F1): the confirm puts the
  // step away in one render and the retry is sent after it, from the effect above. A retry that sends a request holds the card by
  // its door's `busy` from there; one that sends nothing frees it.
  const held = (card: string): boolean => asking === card && (stepUp.needed || pending?.card === card);
  const ctx: SectionCtx = { stepUp, gate, confirmFor, ask, held };
  return (
    <div className="ovs-section" data-settings-overlord={gate.kind}>
      <DesignationCard ctx={ctx} />
      <ModelCard ctx={ctx} />
      <AccountSetCard ctx={ctx} />
      <BackstopCard ctx={ctx} />
      <RetentionCard ctx={ctx} />
      <AccountFactsCard ctx={ctx} />
      <DecisionModelCards ctx={ctx} />
      <PrivateNamesCard ctx={ctx} />
    </div>
  );
}
