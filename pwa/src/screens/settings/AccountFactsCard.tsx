// Settings › Overlord's account facts (Overlord W1 home C, Task 9; spec 2026-11-09 §3.4, Table 11.1a, §3.6): one row per roster
// account, with its Fable billing fact, its continuity record and, when the Overlord's account holds name it, its hold with Clear.
// Ring L4, context C5: the rows come from the roster (`GET /api/accounts`, the fleet store's one read), never from a name list in
// source, and every word is `overlordSettingsWords.ts`' (L1).
//
// THE DOORS. A fact saves through the account set door (`POST /api/accounts/:id/set`) with one field; the door asks the step-up for
// `included` and `on`, whatever is stored (`factsChangeWidens`), and nothing for `credits` and `off`, so those land in one tap. An
// older fleet node that does not know the field answers `lane-act-refused` with the verb code `unknown-argument`, and a result
// nobody measured `outcome-unknown`; each is drawn by its sentence (`accountFactRefusalText`), and the roster is read again after
// every answer. Clear (`POST /api/continuity/account-holds/:lane/clear`) asks no step-up: a hold only narrows, so its clear widens
// back to the set the operator chose, which the door rules. It is drawn only for a lane the holds read names, and it is sent once.
//
// `AccountHoldClear` (its own file) is also mounted on the hold item's detail (`ItemView.tsx`, plan F17), so the item and the
// card share one control.
import type { ReactNode } from 'react';
import { Button, Section } from '@ccrc/ui';
import type { RosterWire } from '../../../../shared/api';
import { SETTINGS_CARDS } from '../../fleet/settingsText';
import { accountFactRefusalText, api } from '../../lib/api';
// `refreshAccounts` is the fleet store's one roster read: every fact answer, `outcome-unknown` included, reads it again.
import { AccountHoldClear } from '../../overlord/AccountHoldClear';
import {
  FACT_WORDS, OVERLORD_SETTINGS_WORDS as W, billingWordOf, continuityWordOf, holdLineOf, holdsOf, type StandingHold,
} from '../../overlord/overlordSettingsWords';
import { useFleetStore } from '../../stores/fleet';
import { DoorLines, useCardDoor, useCardRead, type SectionCtx } from './overlordCards';

const CARD = SETTINGS_CARDS.overlord.accounts;
const dateOf = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function FactRow({ ctx, account, hold, onHoldCleared }: {
  readonly ctx: SectionCtx; readonly account: RosterWire; readonly hold: StandingHold | null; readonly onHoldCleared: () => void;
}): ReactNode {
  const card = `facts:${account.id}`;
  // The fact door's refusals are the account words' (`accountFactRefusalText`), not the Overlord's.
  const door = useCardDoor(ctx, card, (err) => accountFactRefusalText(err, account.id));
  const refreshAccounts = useFleetStore((s) => s.refreshAccounts);
  const save = (field: { fableBilling: 'included' | 'credits' } | { continuity: 'on' | 'off' }): void => {
    void door.run(() => api.accountSet(account.id, field), () => [W.saved], refreshAccounts);
  };
  return (
    <li className="ovs-account" data-account-facts={account.id}>
      <p className="ovs-account-name">{account.label === account.id ? account.id : `${account.label} (${account.id})`}</p>
      <p className="ovs-note" data-fact="billing">{`${FACT_WORDS.billingLegend}: ${billingWordOf(account)}`}</p>
      <div className="ovs-actions">
        <Button variant="ghost" size="fit" data-fact-control="included" disabled={door.busy} aria-pressed={account.fableBilling === 'included'}
          onClick={() => save({ fableBilling: 'included' })}>{FACT_WORDS.included}</Button>
        <Button variant="ghost" size="fit" data-fact-control="credits" disabled={door.busy} aria-pressed={account.fableBilling === 'credits'}
          onClick={() => save({ fableBilling: 'credits' })}>{FACT_WORDS.credits}</Button>
      </div>
      <p className="ovs-note" data-fact="continuity">{`${FACT_WORDS.continuityLegend}: ${continuityWordOf(account, dateOf)}`}</p>
      <div className="ovs-actions">
        <Button variant="ghost" size="fit" data-fact-control="continuity-on" disabled={door.busy}
          onClick={() => save({ continuity: 'on' })}>{FACT_WORDS.recordOn}</Button>
        <Button variant="ghost" size="fit" data-fact-control="continuity-off" disabled={door.busy}
          onClick={() => save({ continuity: 'off' })}>{FACT_WORDS.recordOff}</Button>
      </div>
      {hold !== null && (
        <div className="ovs-actions" data-account-hold={account.id}>
          <p className="ovs-note">{holdLineOf(hold)}</p>
          <AccountHoldClear lane={account.id} onCleared={onHoldCleared} />
        </div>
      )}
      {ctx.confirmFor(card)}
      <DoorLines said={door.said} refusal={door.refusal} card={card} />
    </li>
  );
}

export function AccountFactsCard({ ctx }: { readonly ctx: SectionCtx }): ReactNode {
  const roster = useFleetStore((s) => s.roster);
  const accountsHeard = useFleetStore((s) => s.accountsHeard);
  const holds = useCardRead<readonly StandingHold[]>(() => api.accountHolds(), holdsOf);
  const held = holds.read.state === 'answered' || holds.read.state === 'stale' ? holds.read.value : [];
  return (
    <Section level={3} scope={CARD.scope} title={CARD.title} purpose={CARD.purpose} data-settings-card="accounts">
      {(holds.read.state === 'unmeasured' || holds.read.state === 'stale') && (
        <p className="ovs-note" role="status" data-settings-unread="holds">
          {FACT_WORDS.holdsUnread(holds.read.error)}{holds.read.state === 'stale' ? ` ${W.stale(holds.read.at)}` : ''}
        </p>
      )}
      {!accountsHeard ? (
        <p className="ovs-note" role="status">{FACT_WORDS.waiting}</p>
      ) : roster.length === 0 ? (
        <p className="ovs-note" role="status">{FACT_WORDS.noAccounts}</p>
      ) : (
        <ul className="ovs-accounts">
          {roster.map((a) => (
            <FactRow
              key={a.id} ctx={ctx} account={a} hold={held.find((h) => h.lane === a.id) ?? null}
              onHoldCleared={() => { void holds.reread(); }}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}
