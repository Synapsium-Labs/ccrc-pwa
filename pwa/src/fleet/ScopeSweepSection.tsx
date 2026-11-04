// D-7994: Settings › Automation › "Leftover processes", the two switches of `ccd-scope-sweep`. Its read is the Settings
// frame's (`SettingsDataProvider`, `useScopeSweepView`), handed in as `poll`; it is mounted after Cleanup pause.
//
// TWO SWITCHES, ONE CONTROL. Idle leftovers (`scope-sweep-live`) have no writer in the tree, so that switch is a line.
// Busy leftovers (`scope-sweep-busy-live`) are the operator's to arm, after the shadow week, so that one is the radios.
// The conventions are `DispatchAbandonSection`'s: not-available wins; the checked radio is the server's answer, never the
// tap, and an unmeasured registry checks neither; a write settles its reply, and a refused, unconfirmed or unreadable
// write re-reads; a write's answer is a line under the choice. Nothing branches on the viewer's screen or pointer.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Section, Skeleton } from '@ccrc/ui';
import { SCOPE_SWEEP_TEXT, type ScopeSweepBusyChoice, type ScopeSweepView } from '../../../shared/scope-sweep';
import { api } from '../lib/api';
import {
  NotedRadioSet, ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_NOW_CLASS, UNCONFIRMED_TEXT, useResultLine,
} from './settingsText';
import { COLLECT_SECTION_TEXT } from './collectLaneWords';
import { asScopeSweepView, scopeSweepChecked, scopeSweepIdleLine, scopeSweepLines } from './scopeSweepWords';
import { scopeSweepWriteRefusal, type ScopeSweepPoll } from './useScopeSweepView';

const T = SCOPE_SWEEP_TEXT;

export function ScopeSweepSection({ poll }: { poll: ScopeSweepPoll }): ReactNode {
  const { view, failure } = poll;
  const card = SETTINGS_CARDS.automation.scopeSweep;
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      {failure === 'not-configured' ? (
        <p className="settings-note">{COLLECT_SECTION_TEXT.notAvailable}</p>
      ) : view !== null ? (
        <ScopeSweepBody view={view} stale={failure !== null} poll={poll} />
      ) : failure !== null ? (
        <p className="settings-note">{T.unread}</p>
      ) : (
        <Skeleton lines={2} />
      )}
    </Section>
  );
}

function ScopeSweepBody({ view, stale, poll }: { view: ScopeSweepView; stale: boolean; poll: ScopeSweepPoll }): ReactNode {
  const { reload, settle } = poll;
  const [busy, setBusy] = useState(false);
  const line = useResultLine();
  const choose = (choice: ScopeSweepBusyChoice): void => {
    if (busy) return;   // the disabled fieldset stops a finger; this stops a second call
    setBusy(true);
    line.clear();
    void api.setScopeSweepBusy({ on: choice === 'on' })
      .then(
        (answer) => {
          const reply = answer === 'unreadable' ? null : asScopeSweepView(answer);
          if (reply !== null) { settle(reply); return; }
          line.say(UNCONFIRMED_TEXT);
          reload();
        },
        (err: unknown) => {
          const r = scopeSweepWriteRefusal(err);
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
      <p className={SETTINGS_NOW_CLASS.note}>{scopeSweepIdleLine(view)}</p>
      <NotedRadioSet<ScopeSweepBusyChoice>
        legend={T.legend}
        name="settings-scope-sweep-busy"
        value={scopeSweepChecked(view)}
        disabled={busy}
        onPick={choose}
        options={[
          { value: 'off', label: T.off, note: T.offNote },
          { value: 'on', label: T.on, note: T.onNote },
        ]}
      />
      <ResultLine line={line.line} />
      {scopeSweepLines(view).map((l, i) => (
        <p key={i} className={l.tone === 'warn' ? SETTINGS_AMBER_NOTE : SETTINGS_NOW_CLASS.note}>{l.text}</p>
      ))}
    </>
  );
}
