// Text the Settings screen and its sections share. This module imports nothing from either screen, so a section can
// take a shared line without importing the screen that mounts it.
//
// Since settings Task R1c (D-5503's words, D-5507's results) it also holds the two shapes every section writes those
// words with, so no section draws them its own way:
//   * `NotedRadioSet`: a radio set whose options each carry a one-line note UNDER the option, outside its name (the
//     note is the radio's description, so a radio is still found by its label alone);
//   * `useResultLine` and `ResultLine`: the one line under a control that says how its server action ended
//     (spec §6.4). `role="status"`, polite, amber for a refusal. A toast only when the control is gone: an answer that
//     lands after its section unmounted is toasted instead, in the tone the line would have had.
// Both are written with `createElement`, as `updateAck.ts`'s `AckConfirm` is, so this file stays the one `.ts` module
// the sections already import.
import { createElement, Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, ReactNode } from 'react';
import type { StallLevel } from '../../../shared/api';
import { RADIO_FIELDSET, RADIO_LEGEND, Radio, toast } from '@ccrc/ui';

/** A write that answered 2xx but unreadably (`postJsonOr`'s `unreadable`, D-1150): it may have landed. */
export const UNCONFIRMED_TEXT = "Saved — the server's answer could not be read; the screen will re-check.";

/** The classes a section's "now" lines wear, by tone: one map, so the Stall watch and Temp root collector sections
 *  cannot drift apart. */
export const SETTINGS_NOW_CLASS = {
  head: 'settings-catalogue',
  note: 'settings-note',
  warn: 'settings-catalogue settings-catalogue--amber',
} as const;

/** A section's amber note: a stale read, an inline refusal, a pause that failed. */
export const SETTINGS_AMBER_NOTE = 'settings-note settings-catalogue--amber';

// ── The words (settings spec §5, §11.2; D-5503) ──────────────────────────────────────────────────────────────────
// Each "what it does" line restates a measured effect; each "when" line says when an operator would change it. They
// are sentence case and name no device (P6). The wire's enum values do not change; only these words do.

/** Settings › Updates (spec §5.1). */
export const UPDATES_TEXT = {
  whatsNewNote: 'Shows what the waiting release changes, and every release between it and what the fleet runs.',
  whatsNewWhen: 'A release is waiting and you want to know what it brings.',
  checkNowNote: 'Asks GitHub for new releases now, instead of waiting for the next check.',
  checkNowWhen: 'You know a release just shipped.',
  nodesLead: "Each machine ccrc runs on. A node's Update and Roll back move that node only.",
  channelPurpose: "Sets which release the fleet treats as newest. That drives the update banner, each node's → arrow, "
    + 'the release window and, with auto-install on, what installs.',
  channelWhen: 'Once, at set-up. Choose Dev only if you want fixes as they merge and accept less tested builds.',
  autoPurpose: 'When on, the server installs a new release as soon as the release check sees it. It moves each node in '
    + 'turn (the fleet box, then the server), and a node whose new build fails its health check returns to the build '
    + 'it had. It never reinstalls a release a node was rolled back from: it waits for a newer one.',
  autoWhen: 'Once. Leave it Off if you want to choose when each release lands.',
} as const;

/** How often the server asks GitHub, in minutes. The server's `CATALOGUE_POLL_INTERVAL_MS` is not importable here
 *  (the PWA reads no server module), so `settings-screen.test.tsx` reads that constant's source and holds this equal
 *  to it: the sentence cannot drift from the schedule it states. */
export const CATALOGUE_CHECK_MINUTES = 30;

/** The catalogue line's explanation (spec §5.1). */
export const CATALOGUE_EXPLAIN_TEXT = `The server checks GitHub for new releases every ${CATALOGUE_CHECK_MINUTES} minutes.`;

/** The Update and Roll back notes on a node row (spec §5.1). */
export function nodeUpdateNote(tag: string): string {
  return `Moves this node to ${tag}, the newest on its channel.`;
}
export function nodeRollbackNote(previous: string): string {
  return `Moves this node back to ${previous}, the release it ran before its last update.`;
}

/** Auto-install's gate note, in a sentence (spec §5.1's "today's `AUTO_GATE_NOTE`, in a sentence"). */
export function autoGateNoteText(labels: readonly string[]): string {
  return `Auto-install needs every node to run a ccrc with the update gate. Not yet: ${labels.join(', ')}.`;
}

/** Settings › Notifications (spec §5.3). */
export const NOTIFICATIONS_TEXT = {
  browserPurpose: "Lets this browser show ccrc's alerts, such as a session asking for you or a release being announced, "
    + 'even when ccrc is closed. Other browsers and devices are turned on separately.',
  browserWhen: 'On each device where you want to be told.',
  announceLegend: 'Announce new releases',
  announcePurpose: 'Chooses which new releases the server pushes about, to every browser that has push turned on, not '
    + 'only this one. A push opens Settings › Updates.',
  announceWhen: 'If Dev-channel announcements are too many, choose Stable releases only.',
} as const;

/** Settings › Automation › Stall watch (spec §5.4). */
export const STALL_WORDS = {
  purpose: 'Notices workers that have gone quiet for too long, and, at the levels you allow, checks on them, tells '
    + 'their coordinator and you, or delivers waiting mail.',
  levelLead: 'Each level does everything the one above it does, plus:',
  followNote: 'Uses the arming files set by hand on the fleet box, as before this setting existed.',
  quietLine: 'How long a worker may be silent before stall watch checks on it. Shorter means more check mail.',
} as const;

/** Each stall level's note: the new part only, checked against `STALL_LEVEL_TEXT[level].does` (`shared/api.ts`),
 *  which stays the one full sentence. A TOTAL record, so a new level is a compile error here (plan R1c's table: three
 *  of the spec's drafts stated a different fact from the sentence they summarise, and all six are replaced). */
export const STALL_LEVEL_NOTE: Record<StallLevel, string> = {
  off: 'Nothing runs.',
  log: 'Records what it would send, and sends nothing.',
  check: 'Mails a check to a worker quiet past the quiet time.',
  alert: 'Tells its coordinator, then you, when a check goes unanswered, and tells you about other long waits.',
  deliver: 'Delivers mail to a session whose main turn has ended, while its background work runs.',
  all: 'Adds checks for workers that died, froze or failed, and for stuck mail.',
};

/** "Built-in: 2 h · Range: 30 min to 12 h", every value the wire's, written by the caller's formatter. */
export function stallQuietBoundsText(builtIn: string, min: string, max: string): string {
  return `Built-in: ${builtIn} · Range: ${min} to ${max}`;
}

// ── A radio set whose options carry notes ──────────────────────────────────────────────────────────────────────

export interface NotedOption<T extends string> {
  value: T;
  label: string;
  /** The option's one-line note, drawn under it and read as its description. */
  note?: string;
  disabled?: boolean;
  /** Another element that describes this option (a held option's reason), read after its note. */
  describedBy?: string;
}

/** The note's class: the secondary ink `.settings-note` carries, and the spacing rule that tucks it under its option
 *  (fleet.css, beside `.settings-note`; no colour). */
export const OPTION_NOTE_CLASS = 'settings-note settings-option-note';

/** One option's note, the element its radio's `aria-describedby` names. Exported for the two sets that still build
 *  their fieldset by hand (Stall watch's level, the collector's choice): `markup-census.test.ts` registers that
 *  shared shape, `fieldset(legend, Radio)`, and the census is frozen while #627 holds it, so those sets keep the
 *  shape and take their notes from here, the same element `NotedRadioSet` draws. */
export function optionNote(id: string, note: string): ReactNode {
  return createElement('p', { key: `${id}-note`, id, className: OPTION_NOTE_CLASS }, note);
}

/** A set's lead line, under its legend (the stall level's "Each level does …, plus:"). */
export function setLead(text: string): ReactNode {
  return createElement('p', { className: 'settings-note' }, text);
}

/** Whether a blur leaves the set: the focus moved to nothing, or to something outside it. */
export function focusLeaves(e: FocusEvent<HTMLElement>): boolean {
  return !e.currentTarget.contains(e.relatedTarget as Node | null);
}

/** A native radio set (`fieldset`/`legend`, `@ccrc/ui`'s `Radio`) whose options each carry a note under them. The
 *  note sits OUTSIDE the option's label, so the radio's accessible name is its label alone and the note is its
 *  description. */
export function NotedRadioSet<T extends string>({
  legend, name, options, value, onPick, disabled, describedBy,
}: {
  legend: string;
  name: string;
  options: readonly NotedOption<T>[];
  value: T | null;
  onPick: (value: T) => void;
  disabled?: boolean;
  describedBy?: string;
}): ReactNode {
  const base = useId();
  return createElement(
    'fieldset',
    { className: RADIO_FIELDSET, disabled, 'aria-describedby': describedBy },
    createElement('legend', { className: RADIO_LEGEND }, legend),
    ...options.map((o, i) => {
      const noteId = o.note === undefined ? undefined : `${base}-${i}`;
      const described = [noteId, o.describedBy].filter((x): x is string => x !== undefined).join(' ');
      return createElement(
        Fragment,
        { key: o.value },
        createElement(Radio, {
          name,
          value: o.value,
          checked: value === o.value,
          disabled: o.disabled,
          'aria-describedby': described === '' ? undefined : described,
          onChange: () => onPick(o.value),
          children: o.label,
        }),
        noteId === undefined || o.note === undefined ? null : optionNote(noteId, o.note),
      );
    }),
  );
}

// ── The result line (spec §6.4; D-5507) ────────────────────────────────────────────────────────────────────────

/** `answer` for a line that reports (a write that may have landed, a request filed); `refusal` for the server's
 *  refusal or a failure, said amber. A line keeps the tone its toast had: a plain toast is an answer, an error toast
 *  a refusal. */
export type ResultTone = 'answer' | 'refusal';
export interface ResultLineValue { text: string; tone: ResultTone }

/** The class a result line wears: the secondary note for an answer, the section's amber note for a refusal (the
 *  existing `SETTINGS_AMBER_NOTE`, the page's "inline refusal" ink), plus the spacing hook. */
export function resultLineClass(tone: ResultTone): string {
  return `${tone === 'refusal' ? SETTINGS_AMBER_NOTE : 'settings-note'} settings-result`;
}

export interface ResultLineApi {
  line: ResultLineValue | null;
  /** Say how the action ended: under the control while it is on screen, as a toast once it is gone. */
  say: (text: string, tone?: ResultTone) => void;
  /** The next action on the control starts with no line. */
  clear: () => void;
}

/** One control's result line. `say` writes the line while the component is mounted; after it unmounts (the operator
 *  left the section while the request was in flight) the same sentence is toasted, an error toast for a refusal. */
export function useResultLine(): ResultLineApi {
  const [line, setLine] = useState<ResultLineValue | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  const say = useCallback((text: string, tone: ResultTone = 'answer') => {
    if (live.current) setLine({ text, tone });
    else toast(text, tone === 'refusal' ? 'error' : 'info');
  }, []);
  const clear = useCallback(() => setLine(null), []);
  return { line, say, clear };
}

/** The line itself, directly under its control. `className` replaces the page's ink where the line sits on another
 *  ground (the home screen's halt banner); the role and the live politeness are the same everywhere. */
export function ResultLine({ line, className }: { line: ResultLineValue | null; className?: string }): ReactNode {
  if (line === null) return null;
  return createElement('p', {
    className: className ?? resultLineClass(line.tone),
    role: 'status',
    'aria-live': 'polite',
  }, line.text);
}
