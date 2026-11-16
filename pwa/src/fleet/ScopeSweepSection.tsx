// D-7994: Settings › Automation › "Leftover processes", the two switches of `ccd-scope-sweep`. Its read is the Settings
// frame's (`SettingsDataProvider`, `useScopeSweepView`), handed in as `poll`; it is mounted after Stop leftovers. It ships
// in shadow; nothing here arms the busy arm but an operator's tap.
//
// TWO SWITCHES, ONE CONTROL. Idle leftovers (`scope-sweep-live`) have no writer in the tree, so that switch is a line.
// Busy leftovers (`scope-sweep-busy-live`) are the operator's to arm, after the shadow week, so that one is the radios.
// The wait is `PaneScopeStopSection`'s: the checked radio is the server's reading, never the tap, and an unmeasured
// registry checks neither; a tap holds the choice with its line on screen, `COORD_CONFIRM_MS` bounds that hold, and the
// write's answer speaks only while no read has shown what it asked and no newer tap has replaced it. This door answers
// with the view itself, read after the verb ran, so a good answer settles the card at once; any other answer re-reads.
// An answer that reads the other choice says so, and that line outlives the reading it brought. One that cannot say what
// stands has no choice to point at, so the unmeasured note speaks for it.
// The sweep's own pause (`scope-sweep-paused`) is not in the view, so this card shows the switches, not a paused sweep.
// Nothing branches on the viewer's screen or pointer.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Section, Skeleton } from '@ccrc/ui';
import type { ScopeSweepView } from '../../../shared/scope-sweep';
import { api } from '../lib/api';
import { COLLECT_SECTION_TEXT } from './collectLaneWords';
import { COORD_CONFIRM_MS } from './coordWords';
import {
  SCOPE_SWEEP_TEXT, asScopeSweepView, scopeSweepChecked, scopeSweepIdleLine, scopeSweepUnmeasured,
  type ScopeSweepBusyChoice,
} from './scopeSweepWords';
import {
  NotedRadioSet, ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_NOW_CLASS, SETTINGS_WHEN, UNCONFIRMED_TEXT,
  useResultLine,
} from './settingsText';
import type { ScopeSweepPoll } from './useScopeSweepView';
import { verbWriteFailure } from './verbWriteFailure';

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
  const [asked, setAsked] = useState<ScopeSweepBusyChoice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The tap whose write's answer may still speak. `asked` ends at the bound; this ends when a read shows the tap.
  const tap = useRef<{ readonly choice: ScopeSweepBusyChoice } | null>(null);
  // The reading an answer's line is about: its arrival is not news, so only a reading after it retires the line.
  const spokenOf = useRef<ScopeSweepBusyChoice | null>(null);
  const line = useResultLine();
  const reading = scopeSweepChecked(view);

  const clearTimer = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  // A NEW reading retires any line about the old one; only the reading a tap asked for settles that tap.
  useEffect(() => {
    if (reading === null || reading !== spokenOf.current) line.clear();
    spokenOf.current = null;
    if (reading === tap.current?.choice) tap.current = null;
    if (reading === asked) {
      clearTimer();
      setAsked(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading]);

  useEffect(() => clearTimer, []);

  const choose = (choice: ScopeSweepBusyChoice): void => {
    if (asked !== null) return;   // the disabled fieldset stops a finger; this stops a second call
    line.clear();
    spokenOf.current = null;
    setAsked(choice);
    const mine = { choice };
    tap.current = mine;
    timer.current = setTimeout(() => {
      timer.current = null;
      setAsked(null);
      line.say(T.unconfirmed);
      reload();
    }, COORD_CONFIRM_MS);
    const answered = (): boolean => {
      if (tap.current !== mine) return false;
      tap.current = null;
      clearTimer();
      setAsked(null);
      return true;
    };
    void api.setScopeSweepBusy({ on: choice === 'on' }).then(
      (answer) => {
        if (!answered()) return;
        const reply = answer === 'unreadable' ? null : asScopeSweepView(answer);
        if (reply === null) {
          line.say(UNCONFIRMED_TEXT);
          reload();
          return;
        }
        const stands = scopeSweepChecked(reply);
        if (stands === choice || stands === null) line.clear();
        else {
          spokenOf.current = stands;
          line.say(T.unconfirmed);
        }
        settle(reply);
      },
      (err: unknown) => {
        if (!answered()) return;
        const failed = verbWriteFailure(err);
        line.say(failed.text, failed.tone);
        reload();
      },
    );
  };

  return (
    <>
      {stale && <p className={SETTINGS_AMBER_NOTE}>{T.stale}</p>}
      {scopeSweepUnmeasured(view) && <p className={SETTINGS_AMBER_NOTE}>{T.unmeasured}</p>}
      <p className={SETTINGS_NOW_CLASS.note}>{scopeSweepIdleLine(view)}</p>
      <NotedRadioSet<ScopeSweepBusyChoice>
        legend={T.legend}
        name="settings-scope-sweep-busy"
        value={reading}
        disabled={asked !== null}
        onPick={choose}
        options={[
          { value: 'off', label: T.off, note: T.offNote },
          { value: 'on', label: T.on, note: T.onNote },
        ]}
      />
      {asked !== null && <p className="settings-note" role="status">{T.asked}</p>}
      <ResultLine line={line.line} />
      {view.busy === 'set' && view.stop === 'clear' && <p className={SETTINGS_AMBER_NOTE}>{T.needsIdle}</p>}
      {view.busy === 'clear' && <p className={SETTINGS_WHEN}>{T.when}</p>}
    </>
  );
}
