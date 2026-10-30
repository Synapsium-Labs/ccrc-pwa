// "Mark all seen" and its two repairs, as ONE hook (T3a, D-6331).
//
// WHY IT IS ITS OWN FILE. Two surfaces offer the ack: `BucketBar`'s chips and, in status mode, Instrument's group heads
// (`FleetTable`). The button is the same, so the repairs it needs are the same, and they were `BucketBar`'s private
// state. A second copy would drift: a head that acks but leaves focus on <body> and says nothing to a screen reader.
// Both surfaces call this hook, so the reasons below are argued once, with the code they are about.
//
// IT RENDERS NOTHING (a `.ts` file). The caller renders the announcement itself, OUTSIDE the control that unmounts:
// `<div className="sr-only" role="status">{note}</div>`, and hangs `labelRef(group)` on the label that takes focus.
//
// A GROUP IS A BUCKET OR THE STATUS VIEW'S PROGRAMMES (Task G3, D-7333): the chips' keys are buckets, and Instrument's
// heads add Programmes, whose door acks the coordinators its boxes draw. Every key is named by `statusGroupLabel`, the
// word its chip or head shows.
import { useRef, useState } from 'react';
import type { FleetSession } from '../../../shared/api';
import { statusGroupLabel, type StatusGroupId } from './statusGroups';

export interface MarkSeen {
  /** The ref-setter for a bucket's label: the focus target after an ack. The label needs `tabIndex={-1}`, so it takes
   *  focus programmatically and is never a Tab stop of its own. */
  labelRef: (group: StatusGroupId) => (el: HTMLElement | null) => void;
  /** What the status region says: empty until an ack, then `Needs you: 2 marked seen`. */
  note: string;
  /** Acks every session in `inBucket`, announces it, and moves focus to the bucket's label. */
  markSeen: (group: StatusGroupId, inBucket: readonly FleetSession[], unseenCount: number) => void;
}

/** What the status region says after an ack: the bucket by its chip's word, then the count. A top-level function, so the
 *  plain-words census reads the sentence. */
export const markedSeenNote = (group: StatusGroupId, unseenCount: number): string =>
  `${statusGroupLabel(group)}: ${unseenCount} marked seen`;

/** The door's accessible name: its visible words first, then the bucket IN it by its chip's word, `Mark all seen, Needs
 *  you` (WCAG 2.5.3, label in name: a voice-control user says what they read). `BucketBar`'s comment argues why the
 *  bucket is in it. One builder for both doors, and outside the skins: the skin boundary reads a skin file's string
 *  literals for colour words, and "Mark" is a CSS system colour. */
export const markAllSeenLabel = (group: StatusGroupId): string => `Mark all seen, ${statusGroupLabel(group)}`;

export function useMarkSeen(ackAll: (sessions: readonly FleetSession[], at: number) => void): MarkSeen {
  // "Mark all seen" unmounts itself. Both halves of the repair live here.
  //
  // FOCUS: the button is inside `{unseenCount > 0 && …}`, so activating it
  // removes the focused element, and the browser's fallback for that is
  // `document.body` — the next Tab restarts at the wordmark, past the bell,
  // the banners and every preceding chip. Focus moves to the chip's own
  // label, which is where the operator was.
  //
  // ANNOUNCEMENT: a screen-reader user otherwise gets nothing at all — the
  // control they were on ceased to exist and a pill silently vanished, which
  // is indistinguishable from a no-op. The message names the bucket and the
  // count, because "done" would be the same sentence for every chip. The
  // bucket is named by `statusGroupLabel`, the word the chip itself shows.
  const labelRefs = useRef<Partial<Record<StatusGroupId, HTMLElement | null>>>({});
  const [note, setNote] = useState('');
  const labelRef = (group: StatusGroupId) => (el: HTMLElement | null): void => { labelRefs.current[group] = el; };
  const markSeen = (group: StatusGroupId, inBucket: readonly FleetSession[], unseenCount: number): void => {
    ackAll(inBucket, Date.now());
    setNote(markedSeenNote(group, unseenCount));
    labelRefs.current[group]?.focus();
  };
  return { labelRef, note, markSeen };
}
