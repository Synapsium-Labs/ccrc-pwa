// The Settings screen's third section, Stall watch (stall watch settings, design 2026-10-05 §13; programme
// stall-watch-settings W2 Task 3). What the watch does now, the next step up its ladder, the level and quiet-time
// controls, and the notice counts, over the section's OWN read of GET /api/coord/stall-watch (`useStallWatchView`,
// beside the screen's one /api/updates poll that the other two sections share).
//
// Four rules this file keeps, each pinned in settings-screen.test.tsx:
//   * NOT AVAILABLE WINS. A 501 not-configured, or the 404 not-found an older server answers, replaces the whole
//     body, even over a view that landed before (older-server-404-reads-not-configured (D-4035)): after a rollback
//     to a build without the route, an old choice with its radio checked must not stay on screen.
//   * THE SERVER'S ANSWER IS WHAT IS SHOWN. The checked radio and the selected quiet time come from the reply,
//     never from the tap. A write settles its reply; a refused or unreadable write re-reads.
//   * THE SERVER DECIDES THE CONFIRM (server-decides-the-confirm (D-4033)). A write goes out with only the field
//     moved and no key. A 409 confirm-required opens the sheet from the effect the server measured, and Set sends
//     the same body again with the server's key, so a key the server no longer matches opens a fresh sheet. The
//     sheet says, stage by stage, what the write turns on and what stops (confirm-on-stage-diff (D-4034)).
//   * NO LADDER HERE. The section spells no level id and keeps no ladder column: the Now and Next blocks, the files'
//     reading and every write's effect come from the wire, and every word is an L0 STALL_* constant (apart from
//     the shared `UNCONFIRMED_TEXT` (§13 step 3)), filled by `fillStallText`. There is no viewport,
//     pointer or user-agent branch.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import {
  STALL_BUSY_GATE_OFF_TEXT, STALL_BUSY_GATE_TEXT, STALL_CONFIRM_TEXT, STALL_FALLBACK_TEXT, STALL_FILES_EXCEED_TEXT,
  STALL_FOLLOW_LABEL, STALL_HAZARD_TEXT, STALL_HELD_REASON, STALL_HELD_TEXT, STALL_LEVELS, STALL_LEVEL_TEXT,
  STALL_NEXT_TEXT, STALL_NOTICE_TEXT, STALL_NOT_AVAILABLE_TEXT, STALL_QUIET_NOTE, STALL_RUNLESS_FOOTNOTE,
  STALL_SECTION_TEXT, STALL_SOURCE_TEXT, STALL_STAGES, STALL_STAGE_TEXT, STALL_STORED_TEXT,
  type StallConfirmRequired, type StallHeld, type StallLevel, type StallLevelChoice, type StallNoticeCount,
  type StallStage, type StallWatchEffective, type StallWatchRequest, type StallWatchView, type StallWriteEffect,
} from '../../../shared/api';
import { QuickConfirm } from '../components/QuickConfirm';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import {
  asStallWatchView, stallWriteRefusal, useStallWatchView, type StallWatchPoll,
} from '../fleet/useStallWatchView';
import { api } from '../lib/api';
import { UNCONFIRMED_TEXT } from './settingsText';

/** Fill each `{name}` slot of an L0 text from `slots`. A slot it was not given stays as written; a value is
 *  inserted literally (a replacer function, so a `$` in a server's detail is never a replacement pattern). */
export function fillStallText(text: string, slots: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(slots, key) ? (slots[key] ?? whole) : whole));
}

/** A span in hours and minutes, "30 min", "2 h", "1 h 30 min": every duration the section shows comes off the
 *  wire (the quiet bounds, step and built-in, the counts window) and is written by this one function. */
export function quietText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** One option of the quiet-time select: `default` (the built-in) or a value in milliseconds. */
export interface StallQuietChoice { value: number | 'default'; label: string }

/** "Built-in (<builtInMs>)", then every `stepMs` step from `minMs` to `maxMs` except the one equal to `builtInMs`,
 *  so the built-in value appears once. Every number is the reply's own (`useStallWatchView`'s guard bounds the
 *  list's length). */
export function quietChoices(view: StallWatchView): StallQuietChoice[] {
  const { builtInMs, minMs, maxMs, stepMs } = view.quiet;
  const choices: StallQuietChoice[] = [
    { value: 'default', label: fillStallText(STALL_SECTION_TEXT.builtInOption, { value: quietText(builtInMs) }) },
  ];
  for (let ms = minMs; ms <= maxMs; ms += stepMs) {
    if (ms !== builtInMs) choices.push({ value: ms, label: quietText(ms) });
  }
  return choices;
}

/** How a Now line is drawn: the level heading, an ordinary note, or an amber one (a hold, a hazard, a stored or
 *  applied choice that is not what it seems). */
export type StallNowTone = 'head' | 'note' | 'warn';
export interface StallNowLine { text: string; tone: StallNowTone }

const HELD_FLAGS = Object.keys(STALL_HELD_TEXT) as Array<keyof StallHeld>;

const levelLabel = (level: StallLevel | 'custom'): string =>
  level === 'custom' ? STALL_SECTION_TEXT.custom : STALL_LEVEL_TEXT[level].label;

/** The source line. A held source names the CHOSEN level and why the fleet box holds it; a held reading over a
 *  choice that is not a level is not a reply the server builds, and draws no source line rather than a guess. */
function sourceLine(effective: Extract<StallWatchEffective, { measured: true }>,
  chosen: StallWatchView['chosen']['level']): string | null {
  if (effective.source !== 'held') return STALL_SOURCE_TEXT[effective.source];
  if (chosen === 'follow' || chosen === 'unreadable') return null;
  const reason = effective.held.watchOff ? STALL_HELD_REASON.watchOff : STALL_HELD_REASON.gateStrict;
  return fillStallText(STALL_SOURCE_TEXT.held, { label: STALL_LEVEL_TEXT[chosen].label, reason });
}

/** Exactly one line whenever the stored row does not apply whole, and none when it does. */
function storedLine(chosen: StallWatchView['chosen']): string | null {
  if (chosen.stored === 'absent') return STALL_STORED_TEXT.absent;
  if (chosen.stored === 'unreadable') return STALL_STORED_TEXT.unreadable;
  const level = chosen.level === 'unreadable';
  const quiet = chosen.quietMs === 'unreadable';
  if (level && quiet) return STALL_STORED_TEXT.both;
  if (level) return STALL_STORED_TEXT.level;
  return quiet ? STALL_STORED_TEXT.quiet : null;
}

/**
 * The Now block, top to bottom (§13): the effective level and its `does` text (or Custom and the stages that are
 * on, or Unknown, never Off); the busy gate; the source; one line per held flag; the hazard line; the files-exceed
 * line; the stored-choice line; the fallback line. Every condition reads a wire fact, so no level id is spelled.
 *
 * The busy-gate-off note names one cause only: a level read from the fleet box's files that runs without the gate.
 * Under a chosen level the ladder sets the gate, and while mail is off the gate reads off for that reason, which the
 * mail-off held line gives instead.
 */
export function stallNowLines(view: StallWatchView): StallNowLine[] {
  const { effective, chosen } = view;
  const lines: StallNowLine[] = [];
  const push = (text: string, tone: StallNowTone): void => { lines.push({ text, tone }); };
  if (!effective.measured) {
    push(STALL_SECTION_TEXT.unknown, 'head');
  } else {
    const { stages, held, level } = effective;
    push(levelLabel(level), 'head');
    if (level === 'custom') {
      const on = STALL_STAGES.filter((s) => stages[s]).map((s) => STALL_STAGE_TEXT[s].name);
      if (on.length > 0) push(on.join(', '), 'note');
    } else {
      push(STALL_LEVEL_TEXT[level].does, 'note');
    }
    if (stages.busyGate) {
      push(stages.busyDelivery ? STALL_BUSY_GATE_TEXT.holds : `${STALL_BUSY_GATE_TEXT.holds} ${STALL_BUSY_GATE_TEXT.logs}`, 'note');
    } else if (effective.source === 'files' && stages.runs && level !== 'custom' && !held.mailOff) {
      push(STALL_BUSY_GATE_OFF_TEXT, 'note');
    }
    const source = sourceLine(effective, chosen.level);
    if (source !== null) push(source, 'note');
    for (const flag of HELD_FLAGS) if (held[flag]) push(STALL_HELD_TEXT[flag], 'warn');
    if (stages.alerts && stages.wave2 && !stages.busyDelivery && !held.mailOff) push(STALL_HAZARD_TEXT, 'warn');
    if (effective.filesExceed === true) push(STALL_FILES_EXCEED_TEXT, 'warn');
  }
  const stored = storedLine(chosen);
  if (stored !== null) push(stored, 'warn');
  if (view.fallback !== null) push(fillStallText(STALL_FALLBACK_TEXT, { reason: view.fallback.reason }), 'warn');
  return lines;
}

/** The Next step block, or null when there is none to show: an unmeasured reading, a `next` not stated, and
 *  `none` all draw nothing. `waitsOn` is the gate of each listed stage; the busy gate has none, and the server
 *  never lists it. */
export function stallNextLines(effective: StallWatchEffective): { lead: string; waitsOn: string[] } | null {
  if (!effective.measured || effective.next === undefined || effective.next.kind === 'none') return null;
  if (effective.next.kind === 'top') return { lead: STALL_NEXT_TEXT.top, waitsOn: [] };
  const waitsOn = effective.next.waitsOn
    .map((s) => STALL_STAGE_TEXT[s].gate)
    .filter((gate): gate is NonNullable<typeof gate> => gate !== null);
  return { lead: `${STALL_NEXT_TEXT.lead} ${STALL_LEVEL_TEXT[effective.next.level].label}.`, waitsOn };
}

/** One counts row: "<label> — <sent> sent · <shadow> shadow". */
export function stallCountLine(count: StallNoticeCount): string {
  const sent = fillStallText(STALL_SECTION_TEXT.sent, { count: String(count.sent) });
  const shadow = fillStallText(STALL_SECTION_TEXT.shadow, { count: String(count.shadow) });
  return `${STALL_NOTICE_TEXT[count.row]} — ${sent} · ${shadow}`;
}

/** The sheet's title, from the request the section sent: a level, Follow, or a quiet time (the built-in by its
 *  value and the word built-in). */
export function stallConfirmTitle(request: StallWatchRequest, builtInMs: number): string {
  const { level, quietMs } = request;
  if (level === 'follow') return fillStallText(STALL_CONFIRM_TEXT.followTitle, { label: STALL_FOLLOW_LABEL });
  if (level !== undefined) return fillStallText(STALL_CONFIRM_TEXT.title, { label: STALL_LEVEL_TEXT[level].label });
  const value = typeof quietMs === 'number'
    ? quietText(quietMs)
    : fillStallText(STALL_SECTION_TEXT.builtIn, { value: quietText(builtInMs) });
  return fillStallText(STALL_CONFIRM_TEXT.quietTitle, { value });
}

/** The stages that make a recorded notice due when they turn on: checks, reports and pushes, the further checks.
 *  Busy delivery makes only held mail due, and the busy gate nothing. */
const NOTICE_STAGES: readonly StallStage[] = ['checks', 'alerts', 'wave2'];

/**
 * The sheet's lines, from the effect the server measured at the write (§13), in this order: the target level's
 * `does` (none for Follow); a line per stage turning on; a `stops` line per stage turning off, and the further
 * checks' when the write leaves them from either reading; the held line; what falls due; the quiet-time lines; the
 * files-exceed line. No rank is involved: every choice reads a stage's own before and after.
 *
 * A stage turning on only in the unheld reading (held by the kill switch or the strict gate) takes its turn-on
 * line, never `backOn`, and makes nothing due until the hold lifts; the held line covers it. Under `mailOff` every
 * due and quiet line takes its mail-off variant, except `quietRecorded`, `quietOff` and the dialog line, which say
 * the same either way.
 */
export function stallConfirmLines(effect: StallWriteEffect, request: StallWatchRequest, builtInMs: number): string[] {
  if (!effect.measured) return [STALL_CONFIRM_TEXT.unknown];
  const { before, after, mailOff } = effect;
  const lines: string[] = [];
  if (request.level !== undefined && request.level !== 'follow') lines.push(STALL_LEVEL_TEXT[request.level].does);
  const turnsOnNow = (s: StallStage): boolean => !before[s] && after[s];
  for (const s of effect.turnsOn) {
    const { name, gate } = STALL_STAGE_TEXT[s];
    if (turnsOnNow(s) && !after.runs) lines.push(fillStallText(STALL_CONFIRM_TEXT.backOn, { name }));
    else if (gate === null) lines.push(fillStallText(STALL_CONFIRM_TEXT.turnsOnFree, { name }));
    else lines.push(fillStallText(STALL_CONFIRM_TEXT.turnsOn, { name, gate }));
  }
  for (const s of effect.turnsOff) lines.push(STALL_STAGE_TEXT[s].stops);
  if (effect.leavesWave2 && !effect.turnsOff.includes('wave2')) lines.push(STALL_STAGE_TEXT.wave2.stops);
  if (effect.heldByBox) lines.push(STALL_CONFIRM_TEXT.heldByBox);

  const on = effect.turnsOn.filter(turnsOnNow);
  const noticeDue = (before.runs && on.some((s) => NOTICE_STAGES.includes(s)))
    || (!before.runs && on.includes('checks'));
  if (noticeDue) {
    if (!mailOff) lines.push(before.runs ? STALL_CONFIRM_TEXT.due : STALL_CONFIRM_TEXT.dueFromOff);
    else lines.push(after.alerts ? STALL_CONFIRM_TEXT.dueMailOff : STALL_CONFIRM_TEXT.dueMailOffHeld);
  }
  if (on.includes('busyDelivery')) lines.push(mailOff ? STALL_CONFIRM_TEXT.dueMailBack : STALL_CONFIRM_TEXT.dueMail);

  if (effect.quietLowered) {
    const slots = { value: quietText(effect.quietMs.after) };
    const repeat = fillStallText(mailOff ? STALL_CONFIRM_TEXT.quietRepeatMailOff : STALL_CONFIRM_TEXT.quietRepeat, slots);
    // Always true for an effect the server built (`quiet-raise-asks-nothing` (D-4037): `quietLowered` means
    // strictly lower); kept for an off-wire shape.
    if (effect.quietMs.after < effect.quietMs.before) {
      if (!after.runs) lines.push(STALL_CONFIRM_TEXT.quietOff);
      else if (!after.checks) lines.push(fillStallText(STALL_CONFIRM_TEXT.quietRecorded, slots));
      else if (after.wave2) {
        lines.push(fillStallText(mailOff ? STALL_CONFIRM_TEXT.quietDueAllMailOff : STALL_CONFIRM_TEXT.quietDueAll, slots));
      } else {
        lines.push(fillStallText(mailOff ? STALL_CONFIRM_TEXT.quietDueMailOff : STALL_CONFIRM_TEXT.quietDue, slots));
      }
    }
    if (after.checks && !after.wave2 && effect.quietMs.after < builtInMs) lines.push(repeat);
    if (after.alerts) lines.push(fillStallText(STALL_CONFIRM_TEXT.quietDialogs, slots));
  }
  if (effect.filesExceed) lines.push(STALL_FILES_EXCEED_TEXT);
  return lines;
}

/** The section: its heading, then one of four bodies. Not-configured comes FIRST, before any landed view (§13's one
 *  deliberate difference from the Updates section); "don't know yet" never borrows "nothing there". */
export function StallWatchSection(): ReactNode {
  const titleId = useId();
  const poll = useStallWatchView();
  const { view, failure } = poll;
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-section-title">{STALL_SECTION_TEXT.title}</h2>
      {failure === 'not-configured' ? (
        <p className="settings-note">{STALL_NOT_AVAILABLE_TEXT}</p>
      ) : view !== null ? (
        <StallWatchBody view={view} stale={failure === 'failed'} poll={poll} />
      ) : failure === 'failed' ? (
        <p className="settings-note">{STALL_SECTION_TEXT.unread}</p>
      ) : (
        <Skeleton lines={3} />
      )}
    </section>
  );
}

/** A write the server answered with 409 confirm-required: the request as the section sent it (no key), and the
 *  server's effect and key. */
interface PendingConfirm { request: StallWatchRequest; confirm: StallConfirmRequired }

const NOW_CLASS: Record<StallNowTone, string> = {
  head: 'settings-catalogue',
  note: 'settings-note',
  warn: 'settings-catalogue settings-catalogue--amber',
};
/** The select's value for the built-in, and for a stored value the list does not hold (an unreadable one): an
 *  empty option, drawn blank, so the select never shows a value the server did not answer. A stored number equal to
 *  the view's built-in is the built-in, whichever way it was stored: the list omits that step, so it selects the
 *  built-in option, not the blank one (departure `quiet-select-shows-no-unanswered-value`). */
const QUIET_BUILT_IN = 'default';
const QUIET_NONE = '';

const levelOptions = (view: StallWatchView): Array<{ value: StallLevelChoice; label: string }> => {
  const { effective } = view;
  const theySay = effective.measured
    ? fillStallText(STALL_SECTION_TEXT.theySay, { level: levelLabel(effective.files) })
    : STALL_SECTION_TEXT.theySayUnknown;
  return [
    { value: 'follow', label: `${STALL_FOLLOW_LABEL} (${theySay})` },
    ...STALL_LEVELS.map((level) => ({ value: level, label: STALL_LEVEL_TEXT[level].label })),
  ];
};

function StallWatchBody({ view, stale, poll }: { view: StallWatchView; stale: boolean; poll: StallWatchPoll }): ReactNode {
  const { reload, settle } = poll;
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const locked = busy || pending !== null;

  // Only the field moved, and `confirm` only as the key the server sent. Every answer is the server's: a reply
  // that reads is settled, a 2xx the guard cannot read was answered and may have landed (UNCONFIRMED_TEXT, the
  // shared "Saved — the answer could not be read" line, then a re-read), a 409 the guard reads opens the sheet, and
  // any other refusal is toasted with the server's detail before a re-read. A rejection that never reached an
  // answer (a network failure) may not even have left, so it gets its own line, STALL_CONFIRM_TEXT.unanswered,
  // which never says "Saved" and never "Nothing was changed", then the same re-read.
  const write = (request: StallWatchRequest, confirm?: string): void => {
    setBusy(true);
    void api.setStallWatch(confirm === undefined ? request : { ...request, confirm })
      .then(
        (answer) => {
          const reply = answer === 'unreadable' ? null : asStallWatchView(answer);
          if (reply !== null) {
            settle(reply);
            return;
          }
          toast(UNCONFIRMED_TEXT);
          reload();
        },
        (err: unknown) => {
          const refusal = stallWriteRefusal(err);
          if (refusal.kind === 'confirm') {
            setPending({ request, confirm: refusal.confirm });
            return;
          }
          if (refusal.kind === 'unconfirmed') toast(STALL_CONFIRM_TEXT.unanswered);
          else toast(fillStallText(STALL_CONFIRM_TEXT.refused, { detail: refusal.detail }), 'error');
          reload();
        },
      )
      .finally(() => { setBusy(false); });
  };
  const choose = (request: StallWatchRequest): void => {
    if (!locked) write(request);   // the disabled fieldset stops a finger; this stops a second call
  };

  const now = stallNowLines(view);
  const next = stallNextLines(view.effective);
  const choices = quietChoices(view);
  const stored = view.chosen.quietMs;
  const quietValue = stored === 'default' || stored === view.quiet.builtInMs
    ? QUIET_BUILT_IN
    : choices.some((c) => c.value === stored) ? String(stored) : QUIET_NONE;
  const quietLine = fillStallText(
    view.quiet.source === 'chosen' ? STALL_SECTION_TEXT.chosenHere : STALL_SECTION_TEXT.builtIn,
    { value: quietText(view.quiet.effectiveMs) });
  const range = fillStallText(STALL_SECTION_TEXT.range,
    { min: quietText(view.quiet.minMs), max: quietText(view.quiet.maxMs) });

  return (
    <>
      {stale && <p className="settings-note settings-catalogue--amber">{STALL_SECTION_TEXT.stale}</p>}
      {now.map((line, i) => <p key={i} className={NOW_CLASS[line.tone]}>{line.text}</p>)}
      {next !== null && <p className="settings-catalogue">{next.lead}</p>}
      {next !== null && next.waitsOn.length > 0 && (
        <>
          <p className="settings-note">{STALL_NEXT_TEXT.waitsOn}</p>
          <ul className="settings-note">{next.waitsOn.map((gate) => <li key={gate}>{gate}</li>)}</ul>
        </>
      )}
      <fieldset className="settings-fieldset" disabled={locked}>
        <legend className="settings-legend">{STALL_SECTION_TEXT.level}</legend>
        {levelOptions(view).map(({ value, label }) => (
          <label key={value} className="settings-option">
            <input
              type="radio"
              name="settings-stall-level"
              value={value}
              checked={view.chosen.level === value}
              onChange={() => choose({ level: value })}
            />
            <span className="settings-option-sentence">{label}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="settings-fieldset" disabled={locked}>
        <legend className="settings-legend">{STALL_SECTION_TEXT.quiet}</legend>
        <p className="settings-catalogue">{quietLine}</p>
        <p className="settings-note">{range}</p>
        <select
          className="route-select"
          aria-label={STALL_SECTION_TEXT.quiet}
          value={quietValue}
          onChange={(e) => choose({ quietMs: e.target.value === QUIET_BUILT_IN ? 'default' : Number(e.target.value) })}
        >
          {quietValue === QUIET_NONE && <option value={QUIET_NONE} disabled hidden />}
          {choices.map((c) => (
            <option key={String(c.value)} value={String(c.value)}>{c.label}</option>
          ))}
        </select>
        <p className="settings-note">{STALL_QUIET_NOTE}</p>
      </fieldset>
      {view.notices.ok ? (
        <>
          <h3 className="settings-legend">
            {fillStallText(STALL_SECTION_TEXT.counts, { window: quietText(view.notices.windowMs) })}
          </h3>
          <ul className="settings-note">
            {view.notices.counts.map((c) => <li key={c.row}>{stallCountLine(c)}</li>)}
          </ul>
        </>
      ) : (
        <p className="settings-note">{STALL_SECTION_TEXT.countsFailed}</p>
      )}
      <p className="settings-note">{STALL_RUNLESS_FOOTNOTE}</p>
      <QuickConfirm
        open={pending !== null}
        title={pending === null ? '' : stallConfirmTitle(pending.request, view.quiet.builtInMs)}
        consequence={pending === null ? [] : stallConfirmLines(pending.confirm.effect, pending.request, view.quiet.builtInMs)}
        confirmLabel={STALL_CONFIRM_TEXT.confirm}
        onConfirm={() => { if (pending !== null) write(pending.request, pending.confirm.effectKey); }}
        onClose={() => setPending(null)}
      />
    </>
  );
}
