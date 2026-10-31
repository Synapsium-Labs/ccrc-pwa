// D-7319: Settings › Automation › "Dispatches that never came back", the switch of the server's act that abandons a
// run whose dispatch never came back (the fleet card's "spawn never completed"). Its read is the Settings frame's
// (`SettingsDataProvider`, `useDispatchAbandonView`), handed in as `poll`; it is mounted after the Temp root collector.
//
// The conventions it keeps are the collector's and the stall watch's:
//   * NOT AVAILABLE WINS: a 501 `not-configured` or an older server's 404 replaces the body with one line.
//   * THE SERVER'S ANSWER IS WHAT IS SHOWN: the checked radio is the stored choice the server read, never the tap; a
//     token this build does not know, a lost row or an unreadable one checks neither, with its line, so either tap can
//     replace it. A write settles its reply; a refused, unconfirmed or unreadable write re-reads.
//   * A write's answer is a line under the choice (`ResultLine`), never a toast while the card is on screen.
// Every word is L0's (`DISPATCH_ABANDON_TEXT`), but the not-available line, which is the Settings sections' one sentence
// (`COLLECT_SECTION_TEXT.notAvailable`); nothing branches on the viewer's screen or pointer.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Section, Skeleton } from '@ccrc/ui';
import { DISPATCH_ABANDON_TEXT, type DispatchAbandonChoice, type DispatchAbandonView } from '../../../shared/dispatch-abandon';
import { api } from '../lib/api';
import {
  NotedRadioSet, ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_NOW_CLASS, UNCONFIRMED_TEXT, useResultLine,
} from './settingsText';
import { COLLECT_SECTION_TEXT } from './collectLaneWords';
import { asDispatchAbandonView, dispatchAbandonChecked, dispatchAbandonLines } from './dispatchAbandonWords';
import { dispatchAbandonWriteRefusal, type DispatchAbandonPoll } from './useDispatchAbandonView';

const T = DISPATCH_ABANDON_TEXT;

export function DispatchAbandonSection({ poll }: { poll: DispatchAbandonPoll }): ReactNode {
  const { view, failure } = poll;
  const card = SETTINGS_CARDS.automation.dispatch;
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      {failure === 'not-configured' ? (
        <p className="settings-note">{COLLECT_SECTION_TEXT.notAvailable}</p>
      ) : view !== null ? (
        <DispatchAbandonBody view={view} stale={failure !== null} poll={poll} />
      ) : failure !== null ? (
        <p className="settings-note">{T.unread}</p>
      ) : (
        <Skeleton lines={2} />
      )}
    </Section>
  );
}

function DispatchAbandonBody({ view, stale, poll }: { view: DispatchAbandonView; stale: boolean; poll: DispatchAbandonPoll }): ReactNode {
  const { reload, settle } = poll;
  const [busy, setBusy] = useState(false);
  const line = useResultLine();
  const choose = (choice: DispatchAbandonChoice): void => {
    if (busy) return;   // the disabled fieldset stops a finger; this stops a second call
    setBusy(true);
    line.clear();
    void api.setDispatchAbandon({ choice })
      .then(
        (answer) => {
          const reply = answer === 'unreadable' ? null : asDispatchAbandonView(answer);
          if (reply !== null) { settle(reply); return; }
          line.say(UNCONFIRMED_TEXT);
          reload();
        },
        (err: unknown) => {
          const r = dispatchAbandonWriteRefusal(err);
          if (r.kind === 'refused') line.say(`${T.refused} (${r.detail})`, 'refusal');
          else line.say(r.detail === null ? T.unanswered : `${T.unanswered} (${r.detail})`);
          reload();
        },
      )
      .finally(() => { setBusy(false); });
  };
  return (
    <>
      {stale && <p className={SETTINGS_AMBER_NOTE}>{T.stale}</p>}
      <NotedRadioSet<DispatchAbandonChoice>
        legend={T.legend}
        name="settings-dispatch-abandon"
        value={dispatchAbandonChecked(view)}
        disabled={busy}
        onPick={choose}
        options={[
          { value: 'on', label: T.on, note: T.onNote },
          { value: 'off', label: T.off, note: T.offNote },
        ]}
      />
      <ResultLine line={line.line} />
      {dispatchAbandonLines(view).map((l, i) => (
        <p key={i} className={l.tone === 'warn' ? SETTINGS_AMBER_NOTE : SETTINGS_NOW_CLASS.note}>{l.text}</p>
      ))}
    </>
  );
}
