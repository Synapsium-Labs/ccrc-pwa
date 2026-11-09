// D-8114 (delegation broker wave 5 PR8c): Settings › Automation › "Worktrees left behind", the operator's switch for the
// delegation lane's keep: whether the server holds a changed worktree that a finished delegated agent or workflow left behind
// back from the disk sweep, and mails its owner. Its read is the Settings frame's (`SettingsDataProvider`,
// `useDelegationAdoptView`), handed in as `poll`; it is mounted after Leftover processes. It ships in shadow; nothing here
// arms the switch but an operator's confirmed tap.
//
// TURNING IT ON ASKS FIRST. A tap on "Keep them" opens a confirm sheet (`QuickConfirm`) that names how many worktrees the last
// pass would keep when it ran in shadow (in any other mode it says the card cannot tell until the next pass, and with no counts,
// because no pass has counted or the last pass counted nothing, that the card cannot say how many), how many of them the card
// lists when the list leaves some off, and that their owners are mailed; the write goes out only from the sheet's confirm, and
// not when the card's current view refuses it. "Do not keep" asks nothing.
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
const RADIO_NAME = 'settings-delegation-adopt';
/** Each choice's refusal line, in the order the card draws them: one leaf, drawn per choice (the markup census). */
const REFUSAL_LINES = [['on', T.on], ['off', T.off]] as const;
/** What a refocus request waits for (review 1703): `flight`, the write has not settled; `now`, the view the card has; `reading`,
 *  the settled view's reading; `read`, the view the re-read with that issue number returns. */
type RefocusWait =
  | { readonly kind: 'flight' } | { readonly kind: 'now' }
  | { readonly kind: 'reading'; readonly until: DelegationAdoptChoice | null } | { readonly kind: 'read'; readonly issue: number };

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
  const { reload, settle, landed } = poll;
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

  // THE REFOCUS (review 1693 F4; review 1699 R2-1 to R2-3; review 1703 F1, F2, F3 and F6, ruled as one mechanism). The sheet's
  // own give-back targets the radio that opened it, which is disabled while the write is in flight, so without this the focus
  // falls to the page. One confirmed write, or a refusal that closed the sheet, makes ONE request, and it fires at most once:
  // - It is in flight until the write settles: its answer, or a reading that shows the chosen value, whichever comes first.
  //   The bound settles it too, on the view the card has then. An answer after the bound, or after a reading settled it, finds
  //   no request in flight and makes none, so no later poll or other card's write moves the focus (F2, F3).
  // - A good answer waits for the settled view (R2-1): in the shipped app the view reaches the card through the Settings frame
  //   one commit after the write settles, and the radio that stood before the write must not be focused (Space on it would
  //   send the opposite choice). A rejected or unreadable answer waits for the view its re-read returns (F6), so the focus is
  //   never put on a radio that view then disables.
  // - Focus inside the card's own confirm sheet, open or leaving, counts as nowhere, and the request waits until the sheet has
  //   gone (F1): the sheet is portaled outside the card and holds the focus through its exit. Focus anywhere else outside the
  //   card drops the request (R2-2, workbench-tabs' guard): an operator who went elsewhere stays there.
  // - It then focuses the radio whose value is the reading, when enabled, else a line of the card's that holds text: the result
  //   line, the refusal line for the reading, either refusal line, the unmeasured note (R2-3). None of them is ever empty.
  const refocus = useRef<{ readonly of: object; readonly sheet: Element | null; wait: RefocusWait } | null>(null);
  const seen = useRef({ asked, confirming, reading, landed });
  const sheetWatch = useRef<MutationObserver | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const refusalRefs = useRef<Partial<Record<DelegationAdoptChoice, HTMLParagraphElement | null>>>({});
  const unmeasuredRef = useRef<HTMLParagraphElement | null>(null);

  const stopWatch = (): void => {
    sheetWatch.current?.disconnect();
    sheetWatch.current = null;
  };
  /** Moves the request of the write `of`, while it is in flight, on to what it waits for; any other request is left alone. */
  const settleRefocus = (of: object, wait: RefocusWait): void => {
    const req = refocus.current;
    if (req !== null && req.of === of && req.wait.kind === 'flight') req.wait = wait;
  };
  // Reads refs only, so the sheet watch's closure from an older render still reads the card as it stands.
  const tryRefocus = (): void => {
    const req = refocus.current;
    if (req === null) return;
    const { asked: holding, confirming: open, reading: now, landed: read } = seen.current;
    const { wait } = req;
    if (holding !== null || open || wait.kind === 'flight') return;
    if (wait.kind === 'reading' && wait.until !== now) return;          // the settled view has not reached the card yet
    if (wait.kind === 'read' && wait.issue > 0 && read < wait.issue) return;   // the re-read has not landed yet
    const radios = document.querySelectorAll<HTMLInputElement>(`input[name="${RADIO_NAME}"]`);
    const card = radios[0]?.closest('section') ?? null;
    const sheet = req.sheet !== null && req.sheet.isConnected ? req.sheet : null;
    const active = document.activeElement;
    const nowhere = active === null || active === document.body || (sheet !== null && sheet.contains(active));
    if (!nowhere && (card === null || !card.contains(active))) {
      refocus.current = null;
      stopWatch();
      return;
    }
    if (sheet !== null) {
      watchSheet(sheet);
      return;
    }
    refocus.current = null;
    stopWatch();
    const radio = [...radios].find((r) => r.value === now && !r.disabled);
    const refusal: HTMLElement | null = now === null ? null : refusalRefs.current[now] ?? null;
    const textLine = statusRef.current ?? refusal ?? refusalRefs.current.on ?? refusalRefs.current.off ?? unmeasuredRef.current;
    (radio ?? textLine)?.focus({ preventScroll: true });
  };
  /** Tries again once the sheet has left the document. */
  const watchSheet = (sheet: Element): void => {
    if (sheetWatch.current !== null) return;
    const watch = new MutationObserver(() => {
      if (sheet.isConnected) return;
      stopWatch();
      tryRefocus();
    });
    watch.observe(document.body, { childList: true, subtree: true });
    sheetWatch.current = watch;
  };

  // A NEW reading retires any line about the old one; only the reading a tap asked for settles that tap, and its refocus request.
  useEffect(() => {
    if (reading === null || reading !== spokenOf.current) line.clear();
    spokenOf.current = null;
    const settled = tap.current;
    if (settled !== null && reading === settled.choice) {
      settleRefocus(settled, { kind: 'now' });
      tap.current = null;
    }
    if (reading === asked) {
      clearTimer();
      setAsked(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading]);

  useEffect(() => {
    seen.current = { asked, confirming, reading, landed };
    tryRefocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, confirming, reading, landed]);

  useEffect(() => () => {
    clearTimer();
    stopWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (choice: DelegationAdoptChoice): void => {
    if (asked !== null) return;   // the disabled fieldset stops a finger; this stops a second call
    // The confirm sheet the focus is in, if any: its exit is waited out before the focus comes back.
    const sheet = document.activeElement?.closest('[role="dialog"]') ?? null;
    // The view the card shows now, not the one the sheet opened over (review 1693 F3): a choice it refuses sends nothing, the
    // sheet closes and the refusal line stays on screen.
    if (view.refused[choice] !== null) {
      refocus.current = { of: {}, sheet, wait: { kind: 'now' } };
      setConfirming(false);
      return;
    }
    line.clear();
    spokenOf.current = null;
    setAsked(choice);
    const mine = { choice };
    tap.current = mine;
    refocus.current = { of: mine, sheet, wait: { kind: 'flight' } };
    timer.current = setTimeout(() => {
      timer.current = null;
      settleRefocus(mine, { kind: 'now' });   // the bound gives up on the write: the view the card has, and nothing after
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
          settleRefocus(mine, { kind: 'read', issue: reload() });
          return;
        }
        const stands = delegationAdoptChecked(reply);
        settleRefocus(mine, { kind: 'reading', until: stands });
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
        settleRefocus(mine, { kind: 'read', issue: reload() });
      },
    );
  };

  // Keep goes through the sheet; Do not keep goes out at once.
  // A choice the door would refuse, or any choice while one waits, is disabled as a radio; this stops a change event that comes
  // round the disabled radio, so a second tap neither opens a second sheet nor sends a second write. A sheet already open when a
  // newer view refuses `on` is stopped in `choose`, which reads the current view.
  const pick = (choice: DelegationAdoptChoice): void => {
    if (view.refused[choice] !== null || asked !== null || confirming) return;
    if (choice === 'on') setConfirming(true);
    else choose('off');
  };

  const { adoption, refused } = view;
  const keeps = adoption === null ? null : delegationAdoptionKeepsOf(adoption);
  const sheet = delegationAdoptConfirm(adoption);
  const onId = `${refusalId}-on`;
  const offId = `${refusalId}-off`;

  return (
    <>
      {stale && <p className={SETTINGS_AMBER_NOTE}>{T.stale}</p>}
      {delegationAdoptUnmeasured(view) && <p ref={unmeasuredRef} tabIndex={-1} className={SETTINGS_AMBER_NOTE}>{T.unmeasured}</p>}
      <p className={SETTINGS_NOW_CLASS.note}>{delegationAdoptModeLine(adoption)}</p>
      {adoption !== null && <p className={SETTINGS_NOW_CLASS.note}>{delegationAdoptCountsLine(adoption)}</p>}
      <p className={SETTINGS_NOW_CLASS.note}>{delegationAdoptCapLine('verb', view.caps.verb)}</p>
      <p className={SETTINGS_NOW_CLASS.note}>{delegationAdoptCapLine('audit', view.caps.audit)}</p>
      <NotedRadioSet<DelegationAdoptChoice>
        legend={T.legend}
        name={RADIO_NAME}
        value={reading}
        disabled={asked !== null || confirming}
        onPick={pick}
        options={[
          { value: 'off', label: T.off, note: T.offNote, disabled: refused.off !== null, describedBy: refused.off === null ? undefined : offId },
          { value: 'on', label: T.on, note: T.onNote, disabled: refused.on !== null, describedBy: refused.on === null ? undefined : onId },
        ]}
      />
      {REFUSAL_LINES.map(([choice, label]) => {
        const word = refused[choice];
        return word === null ? null : (
          <p key={choice} id={choice === 'on' ? onId : offId} ref={(el) => { refusalRefs.current[choice] = el; }} tabIndex={-1}
            className={SETTINGS_AMBER_NOTE}>
            {delegationAdoptRefusedLine(label, word)}
          </p>
        );
      })}
      {(asked !== null || line.line !== null) && (
        <div ref={statusRef} tabIndex={-1}>
          {asked !== null && <p className="settings-note" role="status">{T.asked}</p>}
          <ResultLine line={line.line} />
        </div>
      )}
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
