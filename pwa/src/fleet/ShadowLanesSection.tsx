// D-8274 (worktree economy spec 2026-10-28 R-6): Settings › Automation › Shadow lanes, mounted after Temp root collector.
// One row per lane that ships in shadow (the roster card first): what stands now (Shadow or Live), the lane's shadow record
// to read before arming it, and the one choice that moves it. It reads its own door (`GET /api/coord/lane-arm`) through
// `useLaneArmView` and writes it (`POST`). The marker a lane was armed by before is retired: the row says when the upgrade
// imported it, and the card never names a file to touch.
//
// The conventions it keeps are the collector's:
//   * NOT AVAILABLE WINS: a 501 `not-configured` or an older server's 404 replaces the body with one line.
//   * THE SERVER'S ANSWER IS WHAT IS SHOWN: the checked radio is the stored choice the server read, never the tap; a
//     token this build does not know, a lost row or an unreadable one checks neither, with its line, so either tap can
//     replace it. A write settles its reply; a refused, unconfirmed or unreadable write re-reads.
//   * THE SERVER DECIDES THE CONFIRM. Live goes out as {lane, choice:'live'} with no key; the 409 `confirm-required` opens
//     the sheet from the facts the server read, and Go live sends the server's key. Shadow asks nothing.
//   * A write's answer is a line under the row (`ResultLine`), never a toast while the card is on screen.
// Every word is L0's (`LANE_ARM_TEXT`), but the not-available line, the Settings sections' one sentence
// (`COLLECT_SECTION_TEXT.notAvailable`); nothing branches on the viewer's screen or pointer.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, QuickConfirm, Section, Skeleton } from '@ccrc/ui';
import {
  ANCHOR_SLOT_LANE, APPROVAL_PARK_LANE, CAP_COUNTS_WORKING_LANE, CONTINUITY_LANE, LANE_ARM_TEXT, LAUNCH_PROFILE_LANE, ROSTER_CARD_LANE,
  ROSTER_CARD_SHADOW_LOG, WORKING_IDLE_SLEEP_LANE,
  type LaneArmChoice, type LaneArmConfirmRequired, type LaneArmLane, type LaneArmQuizView, type LaneArmRefusal, type LaneArmRequest, type LaneArmRowView,
} from '../../../shared/lane-arm';
import { ConfirmItsYou } from '../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../accounts/useStepUp';
import { ApiError, api, apiErrorText, refusalText, type QuizRuleAction } from '../lib/api';
import { isRecord } from '../lib/wire';
import {
  NotedRadioSet, ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_NOW_CLASS, UNCONFIRMED_TEXT, useResultLine,
} from './settingsText';
import { COLLECT_SECTION_TEXT } from './collectLaneWords';
import { asLaneArmView, laneArmChecked, laneArmLines, laneArmQuizDate } from './laneArmWords';
import { laneArmWriteRefusal, useLaneArmView, type LaneArmPoll } from './useLaneArmView';

const T = LANE_ARM_TEXT;

/** The refusals the row says in their own words, read through `refusalText`; every other refusal is `T.refused` with
 *  its detail. */
const OWN_REFUSAL_TEXT: Readonly<Record<Extract<LaneArmRefusal, 'sign-in-unarmed'>, string>> = {
  'sign-in-unarmed': T.signInUnarmed,
};

/** The shadow record each row names, where it has one. */
const SHADOW_LOG: Readonly<Record<LaneArmLane, string | null>> = {
  [ROSTER_CARD_LANE]: ROSTER_CARD_SHADOW_LOG,
  [CONTINUITY_LANE]: null,
  [LAUNCH_PROFILE_LANE]: null,
  [ANCHOR_SLOT_LANE]: null,
  [APPROVAL_PARK_LANE]: null,
  [WORKING_IDLE_SLEEP_LANE]: null,
  [CAP_COUNTS_WORKING_LANE]: null,
};

/** The hook is told the session's step-up is fresh until an act proves otherwise (the secret door's rule, `ItemView`). */
const ASSUME_FRESH = Infinity;
const NO_STEP_UP_DEPS: StepUpDeps = {};

export function ShadowLanesSection({ pollMs, stepUpDeps = NO_STEP_UP_DEPS }: { pollMs?: number; stepUpDeps?: StepUpDeps }): ReactNode {
  const poll = useLaneArmView(pollMs);
  const { view, failure } = poll;
  const card = SETTINGS_CARDS.automation.shadowLanes;
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      {failure === 'not-configured' ? (
        <p className="settings-note">{COLLECT_SECTION_TEXT.notAvailable}</p>
      ) : view !== null ? (
        <>
          {failure !== null && <p className={SETTINGS_AMBER_NOTE}>{T.stale}</p>}
          {view.lanes.map((row) => <LaneRow key={row.lane} row={row} poll={poll} />)}
          {view.quizBaseline !== undefined && <QuizBlock quiz={view.quizBaseline} reload={poll.reload} stepUpDeps={stepUpDeps} />}
        </>
      ) : failure !== null ? (
        <p className="settings-note">{T.unread}</p>
      ) : (
        <Skeleton lines={2} />
      )}
    </Section>
  );
}

function LaneRow({ row, poll }: { row: LaneArmRowView; poll: LaneArmPoll }): ReactNode {
  const { reload, settle } = poll;
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<LaneArmConfirmRequired | null>(null);
  const line = useResultLine();
  const words = T.rows[row.lane];
  const locked = busy || pending !== null;

  // Every answer is the server's: a reply that reads is settled; a 2xx the guard cannot read may have landed (a line,
  // then a re-read); a 409 confirm opens the sheet; a refusal with a known code is said amber with its detail, then a
  // re-read; anything else may have stored the choice, so it gets its own line and the same re-read.
  const write = (request: LaneArmRequest): void => {
    setBusy(true);
    line.clear();
    void api.setLaneArm(request)
      .then(
        (answer) => {
          const reply = answer === 'unreadable' ? null : asLaneArmView(answer);
          if (reply !== null) { settle(reply); return; }
          line.say(UNCONFIRMED_TEXT);
          reload();
        },
        (err: unknown) => {
          const r = laneArmWriteRefusal(err);
          if (r.kind === 'confirm') { setPending(r.confirm); return; }
          if (r.kind === 'refused') {
            line.say(refusalText(err, OWN_REFUSAL_TEXT) ?? `${T.refused} (${r.detail})`, 'refusal');
          } else {
            line.say(r.detail === null ? T.unanswered : `${T.unanswered} (${r.detail})`);
          }
          reload();
        },
      )
      .finally(() => { setBusy(false); });
  };
  const choose = (choice: LaneArmChoice): void => {
    if (!locked) write({ lane: row.lane, choice });   // the disabled fieldset stops a finger; this stops a second call
  };

  return (
    <>
      <NotedRadioSet<LaneArmChoice>
        legend={words.legend}
        name={`settings-lane-arm-${row.lane}`}
        value={laneArmChecked(row)}
        disabled={locked}
        onPick={choose}
        options={[
          { value: 'shadow', label: T.shadow, note: words.shadowNote },
          { value: 'live', label: T.live, note: words.liveNote },
        ]}
      />
      <ResultLine line={line.line} />
      {laneArmLines(row, SHADOW_LOG[row.lane]).map((l, i) => (
        <p key={i} className={l.tone === 'warn' ? SETTINGS_AMBER_NOTE : SETTINGS_NOW_CLASS.note}>{l.text}</p>
      ))}
      <QuickConfirm
        open={pending !== null}
        title={T.confirmTitle}
        consequence={pending === null ? [] : T.confirmLines(words.legend, pending.facts.shadowLog)}
        confirmLabel={T.confirmLabel}
        onConfirm={() => {
          const p = pending;
          if (p === null) return;
          setPending(null);
          write({ lane: p.lane, choice: 'live', confirm: p.confirmKey });
        }}
        onClose={() => setPending(null)}
      />
    </>
  );
}

/** The weekly unattended run's last tick (run 3212): a plain line when it advanced or waits for its next tick, an amber one
 *  when its word waits for attention or it failed, or when the server could not read it. */
function QuizTickLine({ tick }: { tick: NonNullable<LaneArmQuizView['unattended']> }): ReactNode {
  if (tick.state === 'none') return <p className={SETTINGS_NOW_CLASS.note} data-quiz-tick="none">{T.quizTick.none}</p>;
  if (tick.state === 'unreadable') return <p className={SETTINGS_AMBER_NOTE} data-quiz-tick="unreadable">{T.quizTick.unreadable}</p>;
  const amber = tick.outcome === 'refused' || tick.outcome === 'failed';
  return (
    <div data-quiz-tick={tick.outcome}>
      <p className={amber ? SETTINGS_AMBER_NOTE : SETTINGS_NOW_CLASS.note}>{T.quizTick.reported(laneArmQuizDate(tick.at), tick)}</p>
      {tick.detail !== null && <p className={SETTINGS_NOW_CLASS.note}>{tick.detail}</p>}
    </div>
  );
}

/** The replay quiz's block (Overlord W1a, plan 2026-11-17 §6): each pending run, in the order recorded, with Confirm and Discard
 *  through the step-up (`useStepUp`'s `runAct`, the secret door's flow), then the baseline line. A ruling that lands re-reads
 *  the card; a refusal is said as the rows say theirs and re-reads too (the run may already be ruled). */
function QuizBlock({ quiz, reload, stepUpDeps }: { quiz: LaneArmQuizView; reload: () => void; stepUpDeps: StepUpDeps }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const stepUp = useStepUp(ASSUME_FRESH, stepUpDeps);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const rule = async (id: number, action: QuizRuleAction): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      let ruled = false;
      const outcome = await stepUp.runAct(async () => { await api.ruleQuizRun(id, action); ruled = true; });
      if (outcome === 'step-up' || !ruled) return;
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      const body = err instanceof ApiError && isRecord(err.body) ? err.body : {};
      const detail = typeof body.detail === 'string' && body.detail.trim() !== '' ? body.detail.trim() : apiErrorText(err);
      if (mounted.current) setRefusal(`${T.refused} (${detail})`);
      reload();
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const b = quiz.baseline;
  const baselineLine = b.state === 'recorded' ? T.quizBaseline.recorded(laneArmQuizDate(b.at))
    : b.state === 'not-yet' ? T.quizBaseline.notYet : T.quizBaseline.unreadable;
  // In the order they were recorded (review 2442 F3): never by a field inside a report, which its poster chose.
  const runs = quiz.pending.ok ? [...quiz.pending.runs].sort((x, y) => x.id - y.id) : [];
  return (
    <div data-quiz-baseline={b.state}>
      {quiz.pending.ok ? runs.map((r) => (
        <div key={r.id} data-quiz-run={r.id}>
          <p className={SETTINGS_NOW_CLASS.note}>{T.quizPending(laneArmQuizDate(r.measuredAt), laneArmQuizDate(r.recordedAt), r)}</p>
          <Button variant="primary" size="fit" disabled={busy} onClick={() => { void rule(r.id, 'confirm'); }}>{T.quizConfirm}</Button>
          <Button variant="ghost" size="fit" disabled={busy} onClick={() => { void rule(r.id, 'discard'); }}>{T.quizDiscard}</Button>
        </div>
      )) : (
        <>
          <p className={SETTINGS_AMBER_NOTE}>{T.quizPendingUnreadable}</p>
          <p className={SETTINGS_NOW_CLASS.note}>{quiz.pending.detail}</p>
        </>
      )}
      {runs.length > 0 && <p className={SETTINGS_NOW_CLASS.note}>{T.quizRuleNote}</p>}
      {quiz.unattended !== undefined && <QuizTickLine tick={quiz.unattended} />}
      <ConfirmItsYou stepUp={stepUp} subject="a replay quiz run" />
      {refusal !== null && <p className={SETTINGS_AMBER_NOTE} role="alert">{refusal}</p>}
      <p className={b.state === 'unreadable' ? SETTINGS_AMBER_NOTE : SETTINGS_NOW_CLASS.note}>{baselineLine}</p>
      {b.state === 'unreadable' && <p className={SETTINGS_NOW_CLASS.note}>{b.detail}</p>}
    </div>
  );
}
