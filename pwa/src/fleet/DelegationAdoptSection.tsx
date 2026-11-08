// D-8114 (delegation broker wave 5 PR8c): Settings › Automation › "Worktrees left behind", the operator's switch for the
// delegation lane's keep: whether the server holds a changed worktree that a finished delegated agent or workflow left behind
// back from the disk sweep, and mails its owner. Its read is the Settings frame's (`SettingsDataProvider`,
// `useDelegationAdoptView`), handed in as `poll`; it is mounted after Leftover processes. It ships in shadow; nothing here
// arms the switch but an operator's confirmed tap.
//
// TURNING IT ON ASKS FIRST. A tap on "Keep them" opens a confirm sheet (`QuickConfirm`) that names how many worktrees the last
// pass listed (or that the card cannot tell) and that their owners are mailed; the write goes out only from the sheet's
// confirm. "Do not keep" asks nothing.
//
// THE WAIT is `ScopeSweepSection`'s: the checked radio is the server's reading, never the tap, and an unmeasured marker
// checks neither; a confirmed tap holds the choice with its line on screen, `COORD_CONFIRM_MS` bounds that hold, and the
// write's answer speaks only while no read has shown what it asked and no newer tap has replaced it. This door answers with
// the view itself, read after the verb ran, so a good answer settles the card at once; any other answer re-reads. A refusal
// of the door's own is said in the card's sentence for its word.
//
// THE REST OF THE CARD IS READ-ONLY: the lane's mode and counts at its last pass, the two capabilities of the fleet box, and
// the worktrees the last pass listed. Nothing branches on the viewer's screen or pointer.
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { QuickConfirm, Section, Skeleton } from '@ccrc/ui';
import { delegationAdoptionKeepsOf } from '../../../shared/api';
import type { DelegationAdoptView } from '../../../shared/delegation-adopt';
import { api } from '../lib/api';
import { COLLECT_SECTION_TEXT } from './collectLaneWords';
import { COORD_CONFIRM_MS } from './coordWords';
import {
  DELEGATION_ADOPT_TEXT, asDelegationAdoptView, delegationAdoptCapLine, delegationAdoptChecked, delegationAdoptConfirm,
  delegationAdoptCountsLine, delegationAdoptFailure, delegationAdoptKeepChanges, delegationAdoptKeepLine,
  delegationAdoptKeepsHeading, delegationAdoptKeepsMore, delegationAdoptModeLine, delegationAdoptRefusedLine,
  delegationAdoptUnmeasured, type DelegationAdoptChoice,
} from './delegationAdoptWords';
import {
  NotedRadioSet, ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_NOW_CLASS, UNCONFIRMED_TEXT, useResultLine,
} from './settingsText';
import type { DelegationAdoptPoll } from './useDelegationAdoptView';

const T = DELEGATION_ADOPT_TEXT;

export function DelegationAdoptSection({ poll }: { poll: DelegationAdoptPoll }): ReactNode {
  const { view, failure } = poll;
  const card = SETTINGS_CARDS.automation.delegationAdopt;
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      {failure === 'not-configured' ? (
        <p className="settings-note">{COLLECT_SECTION_TEXT.notAvailable}</p>
      ) : view !== null ? (
        <DelegationAdoptBody view={view} stale={failure !== null} poll={poll} />
      ) : failure !== null ? (
        <p className="settings-note">{T.unread}</p>
      ) : (
        <Skeleton lines={2} />
      )}
    </Section>
  );
}

function DelegationAdoptBody({ view, stale, poll }: { view: DelegationAdoptView; stale: boolean; poll: DelegationAdoptPoll }): ReactNode {
  const { reload, settle } = poll;
  const [asked, setAsked] = useState<DelegationAdoptChoice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The tap whose write's answer may still speak. `asked` ends at the bound; this ends when a read shows the tap.
  const tap = useRef<{ readonly choice: DelegationAdoptChoice } | null>(null);
  // The reading an answer's line is about: its arrival is not news, so only a reading after it retires the line.
  const spokenOf = useRef<DelegationAdoptChoice | null>(null);
  const line = useResultLine();
  const reading = delegationAdoptChecked(view);
  const refusalId = useId();

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

  const choose = (choice: DelegationAdoptChoice): void => {
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
    void api.setDelegationAdopt({ on: choice === 'on' }).then(
      (answer) => {
        if (!answered()) return;
        const reply = answer === 'unreadable' ? null : asDelegationAdoptView(answer);
        if (reply === null) {
          line.say(UNCONFIRMED_TEXT);
          reload();
          return;
        }
        const stands = delegationAdoptChecked(reply);
        if (stands === choice || stands === null) line.clear();
        else {
          spokenOf.current = stands;
          line.say(T.unconfirmed);
        }
        settle(reply);
      },
      (err: unknown) => {
        if (!answered()) return;
        const failed = delegationAdoptFailure(err);
        line.say(failed.text, failed.tone);
        reload();
      },
    );
  };

  // Keep goes through the sheet; Do not keep goes out at once.
  // A choice the door would refuse, or any choice while one waits, is disabled; this stops a change event that comes round
  // the disabled radio, so a second tap neither opens a second sheet nor sends a second write.
  const pick = (choice: DelegationAdoptChoice): void => {
    if (view.refused[choice] !== null || asked !== null || confirming) return;
    if (choice === 'on') setConfirming(true);
    else choose('off');
  };

  const { adoption, refused } = view;
  const keeps = adoption === null ? null : delegationAdoptionKeepsOf(adoption);
  const sheet = delegationAdoptConfirm(keeps);
  const onId = `${refusalId}-on`;
  const offId = `${refusalId}-off`;

  return (
    <>
      {stale && <p className={SETTINGS_AMBER_NOTE}>{T.stale}</p>}
      {delegationAdoptUnmeasured(view) && <p className={SETTINGS_AMBER_NOTE}>{T.unmeasured}</p>}
      <p className={SETTINGS_NOW_CLASS.note}>{delegationAdoptModeLine(adoption)}</p>
      {adoption !== null && <p className={SETTINGS_NOW_CLASS.note}>{delegationAdoptCountsLine(adoption)}</p>}
      <p className={SETTINGS_NOW_CLASS.note}>{delegationAdoptCapLine('verb', view.caps.verb)}</p>
      <p className={SETTINGS_NOW_CLASS.note}>{delegationAdoptCapLine('audit', view.caps.audit)}</p>
      <NotedRadioSet<DelegationAdoptChoice>
        legend={T.legend}
        name="settings-delegation-adopt"
        value={reading}
        disabled={asked !== null || confirming}
        onPick={pick}
        options={[
          { value: 'off', label: T.off, note: T.offNote, disabled: refused.off !== null, describedBy: refused.off === null ? undefined : offId },
          { value: 'on', label: T.on, note: T.onNote, disabled: refused.on !== null, describedBy: refused.on === null ? undefined : onId },
        ]}
      />
      {refused.on !== null && <p id={onId} className={SETTINGS_AMBER_NOTE}>{delegationAdoptRefusedLine(T.on, refused.on)}</p>}
      {refused.off !== null && <p id={offId} className={SETTINGS_AMBER_NOTE}>{delegationAdoptRefusedLine(T.off, refused.off)}</p>}
      {asked !== null && <p className="settings-note" role="status">{T.asked}</p>}
      <ResultLine line={line.line} />
      {adoption !== null && (
        keeps === null ? (
          <p className="settings-note">{T.noList}</p>
        ) : (
          <>
            <p className={SETTINGS_NOW_CLASS.note}>{delegationAdoptKeepsHeading(adoption.mode)}</p>
            <ul className="left-behind-keeps" aria-label={delegationAdoptKeepsHeading(adoption.mode)}>
              {keeps.items.map((k) => (
                <li key={`${k.project}/${k.worktree}`} className={SETTINGS_NOW_CLASS.note}>
                  {delegationAdoptKeepLine(k)}
                  {': '}
                  {k.changes === undefined ? T.noChanges : delegationAdoptKeepChanges(k.changes).join(', ')}
                </li>
              ))}
            </ul>
            {keeps.more > 0 && <p className={SETTINGS_NOW_CLASS.note}>{delegationAdoptKeepsMore(keeps.more)}</p>}
          </>
        )
      )}
      <QuickConfirm
        open={confirming}
        title={sheet.title}
        consequence={sheet.consequence}
        confirmLabel={sheet.confirmLabel}
        onConfirm={() => choose('on')}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
