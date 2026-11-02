// One item (desktop-polish PL5a, D-7712; spec §2 and §3; the prototype's view 3, minus the secret panel, which is PL6):
// what, why, how as numbered steps, a needed-by pill, the history, and the action panel for the item's kind.
//
// The operator moves an item only by ticking it ("Mark done"), or by dismissing it while its programme has no open run;
// both go to the parent as promises, so a refusal comes back as an `ApiError` and is put in the operator's words HERE, with
// the button left enabled: a refused tick leaves the item as it was, and the operator may try again. An item's state is its
// `state` column only (plan PL5b R2): after a return, its note is shown as HISTORY ("sent back: <note>"), never as the
// current state, and a secret item's answer is never rendered at all.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, RadioFieldset, TextInput } from '@ccrc/ui';
import type { ItemView as ItemWire } from '../../../shared/ledgers';
import type { ProgHue } from '../fleet/programmeBoxes';
import { apiErrorText, LEDGER_REFUSAL_TEXT, refusalText } from '../lib/refusalWords';
import { ageWords, itemPill, KIND_WORD } from './ledgerWords';
import './ledgers.css';

export interface ItemViewProps {
  readonly item: ItemWire;
  /** Tick the item. `decide` and `value` pass the answer; `do` passes none. Rejects with the route's `ApiError` on a refusal. */
  readonly onTick: (answer?: string) => Promise<void>;
  readonly onDismiss: () => Promise<void>;
  /** The programme has an open run: dismiss is refused `programme-live`, so it is not offered. */
  readonly programmeLive: boolean;
  /** The page clock, epoch ms. */
  readonly now: number;
  /** The programme's name and fleet hue for the band; the slug and no hue when the shell has neither. */
  readonly programme?: { readonly name: string; readonly hue: ProgHue | null };
}

/** The history line of one act, in the operator's words. */
const ACT_WORD: Readonly<Record<ItemWire['history'][number]['act'], string>> = {
  raise: 'Raised by the coordinator', block: 'Became blocking', unblock: 'No longer blocking', tick: 'You marked it done',
  confirm: 'The coordinator confirmed it', return: 'Sent back by the coordinator', withdraw: 'The coordinator withdrew it',
  dismiss: 'You dismissed it',
};

function History({ item, now }: { item: ItemWire; now: number }): ReactNode {
  return (
    <ul className="wi-history" aria-label="History">
      {item.history.map((h, i) => (
        <li key={`${h.at}:${h.act}:${i}`}>
          {h.act === 'return' && h.note !== null ? `sent back: ${h.note}` : ACT_WORD[h.act]}
          {` · ${ageWords(h.at, now)}`}
        </li>
      ))}
    </ul>
  );
}

function Panel({ item, programmeLive, onTick, onDismiss }: Pick<ItemViewProps, 'item' | 'programmeLive' | 'onTick' | 'onDismiss'>): ReactNode {
  const [choice, setChoice] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const answer: string | undefined = item.kind === 'decide' && item.options !== null ? choice ?? undefined
    : item.kind === 'decide' || item.kind === 'value' ? typed.trim() : undefined;
  const needsAnswer = item.kind === 'decide' || item.kind === 'value';
  const ready = !needsAnswer || (answer !== undefined && answer !== '');

  const run = async (act: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    try { await act(); } catch (err) { setRefusal(refusalText(err, LEDGER_REFUSAL_TEXT) ?? apiErrorText(err)); } finally { setBusy(false); }
  };

  const open = item.state === 'open';
  const checking = item.state === 'checking';
  return (
    <section className="wi-card wi-act" aria-label="Your move">
      {open && item.kind === 'decide' && item.options !== null && (
        <RadioFieldset legend="Your decision" name={`item-${item.id}`} optionClassName="wi-opt"
                       options={item.options.map((o) => ({ value: o, label: o }))} value={choice} onPick={setChoice} />
      )}
      {open && (item.kind === 'value' || (item.kind === 'decide' && item.options === null)) && (
        <label className="wi-field">
          <span className="wi-label">{item.kind === 'value' ? 'Your value' : 'Your answer'}</span>
          <TextInput className="wi-input" value={typed} onChange={(e) => setTyped(e.target.value)} />
          {item.kind === 'value' && (
            <span className="wi-hint">An ordinary value: it is sent to the coordinator and may be written into the programme ledger.</span>
          )}
        </label>
      )}
      {open && item.kind === 'do' && (
        <p className="wi-hint">Nothing to fill in. The coordinator checks it itself and either closes the item or sends it back with what it found.</p>
      )}
      {open && item.kind === 'secret' && (
        <p className="wi-hint">This item asks for a secret. Giving one from here arrives in a later update; nothing is sent or stored from this page.</p>
      )}
      {checking && (
        <p className="wi-status" role="status" data-stale={item.stale ? 'true' : 'false'}>
          {item.stale
            ? 'Your tick was mailed to the coordinator, which has not picked it up yet. You can leave this page.'
            : 'The coordinator has been told and will confirm this or send it back. You can leave this page.'}
        </p>
      )}
      {refusal !== null && <p className="wi-refusal" role="alert">{refusal}</p>}
      <div className="wi-actions">
        {open && item.kind !== 'secret' && (
          <Button variant="primary" size="fit" disabled={busy || !ready}
                  onClick={() => void run(() => (answer === undefined ? onTick() : onTick(answer)))}>Mark done</Button>
        )}
        {(open || checking) && !programmeLive && (
          <Button variant="ghost" size="fit" disabled={busy} onClick={() => void run(onDismiss)}>Dismiss</Button>
        )}
      </div>
    </section>
  );
}

export function ItemView({ item, onTick, onDismiss, programmeLive, now, programme }: ItemViewProps): ReactNode {
  const pill = itemPill(item);
  const name = programme?.name ?? item.program;
  return (
    <div className="wi">
      <div className="wi-band" data-hue={programme?.hue ?? 'none'}>
        <span className="wi-prog">{name}</span>
        <span className="wl-pill wi-pill" data-tone={pill.tone}>{pill.word}</span>
      </div>
      <div className="wi-detail">
        <div className="wi-card">
          <span className="wl-kind wi-kind">{KIND_WORD[item.kind]}</span>
          <h1 className="wi-what">{item.title}</h1>
          <section>
            <h3 className="wi-h">Why</h3>
            <p className="wi-text">{item.why}</p>
          </section>
          {item.how.length > 0 && (
            <section>
              <h3 className="wi-h">How</h3>
              <ol className="wi-steps" aria-label="How">{item.how.map((s, i) => <li key={`${i}:${s}`}>{s}</li>)}</ol>
            </section>
          )}
          <section>
            <h3 className="wi-h">History</h3>
            <History item={item} now={now} />
          </section>
        </div>
        <Panel item={item} programmeLive={programmeLive} onTick={onTick} onDismiss={onDismiss} />
      </div>
    </div>
  );
}
