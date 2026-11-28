// Settings › Overlord's account facts (Overlord W1 home C, Task 9; spec 2026-11-09 §3.4, Table 11.1a, §3.6): one row per roster
// account, with its Fable billing fact, its continuity record and, when the Overlord's account holds name it, its hold with Clear.
// Ring L4, context K (a settings screen, by the architecture spec's table): the rows come from the roster (`GET /api/accounts`,
// the fleet store's one read), never from a name list in source, and every word is `overlordSettingsWords.ts`' (L1).
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
import { useEffect, useState, type ReactNode } from 'react';
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

/** One fact: its line, then one button per value the door takes. `pressed` marks the stored value (`null`: not a pressed pair). */
function Fact({ fact, line, busy, choices }: {
  readonly fact: string; readonly line: string; readonly busy: boolean;
  readonly choices: readonly { readonly control: string; readonly label: string; readonly pressed: boolean | null; readonly act: () => void }[];
}): ReactNode {
  return (
    <>
      <p className="ovs-note" data-fact={fact}>{line}</p>
      <div className="ovs-actions">
        {choices.map((c) => (
          <Button key={c.control} variant="ghost" size="fit" data-fact-control={c.control} disabled={busy}
            {...(c.pressed === null ? {} : { 'aria-pressed': c.pressed })} onClick={c.act}>{c.label}</Button>
        ))}
      </div>
    </>
  );
}

function FactRow({ ctx, account, hold, onHoldCleared }: {
  readonly ctx: SectionCtx; readonly account: RosterWire; readonly hold: StandingHold | null; readonly onHoldCleared: () => void;
}): ReactNode {
  const card = `facts:${account.id}`;
  // The fact door's refusals are the account words' (`accountFactRefusalText`), not the Overlord's.
  const door = useCardDoor(ctx, card, (err) => accountFactRefusalText(err, account.id));
  const refreshAccounts = useFleetStore((s) => s.refreshAccounts);
  // The latch keeps an answered Clear mounted, so its answer outlives the holds re-read it triggers: that re-read no longer names
  // the lane when the clear landed, or when no hold stood (review 4056 F7). It holds the held-at of the hold that answer ended, so
  // it is set only by `cleared` or `gone`, never by a refusal, which ended nothing (review 4065 F2), and a hold that returns with
  // another held-at is a new hold, with its own live Clear and none of the old answer (review 4065 F1). The control is keyed by
  // that held-at too. It is also set when the Clear is SENT (W2 Settings, the carried ticket
  // `clear-answer-after-its-control-unmounted`): a re-read that another row's Clear triggers, and that no longer names this lane,
  // then keeps the same control mounted, so its answer lands in it and is drawn, never a fresh Clear with no hold line. A refusal
  // drops the latch again, as before.
  const [latch, setLatch] = useState<number | null>(null);
  const heldAt = hold?.heldAt ?? null;
  useEffect(() => { if (heldAt !== null && latch !== null && heldAt !== latch) setLatch(null); }, [heldAt, latch]);
  const shownAt = heldAt ?? latch;
  const save = (field: { fableBilling: 'included' | 'credits' } | { continuity: 'on' | 'off' }): void => {
    void door.run(() => api.accountSet(account.id, field), () => [W.saved], refreshAccounts);
  };
  return (
    <li className="ovs-account" data-account-facts={account.id}>
      <p className="ovs-account-name">{account.label === account.id ? account.id : `${account.label} (${account.id})`}</p>
      <Fact
        fact="billing" line={`${FACT_WORDS.billingLegend}: ${billingWordOf(account)}`} busy={door.busy}
        choices={[
          { control: 'included', label: FACT_WORDS.included, pressed: account.fableBilling === 'included', act: () => save({ fableBilling: 'included' }) },
          { control: 'credits', label: FACT_WORDS.credits, pressed: account.fableBilling === 'credits', act: () => save({ fableBilling: 'credits' }) },
        ]}
      />
      <Fact
        fact="continuity" line={`${FACT_WORDS.continuityLegend}: ${continuityWordOf(account, dateOf)}`} busy={door.busy}
        choices={[
          { control: 'continuity-on', label: FACT_WORDS.recordOn, pressed: null, act: () => save({ continuity: 'on' }) },
          { control: 'continuity-off', label: FACT_WORDS.recordOff, pressed: null, act: () => save({ continuity: 'off' }) },
        ]}
      />
      {shownAt !== null && (
        <div className="ovs-actions" data-account-hold={account.id}>
          {hold !== null && <p className="ovs-note">{holdLineOf(hold)}</p>}
          <AccountHoldClear
            key={shownAt} lane={account.id} onSent={() => setLatch(shownAt)}
            onAnswered={(outcome) => { setLatch(outcome === 'refused' ? null : shownAt); onHoldCleared(); }}
          />
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
