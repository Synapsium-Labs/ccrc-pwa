// The bucket chips above the project cards — and the ack they perform.
//
// WHY IT IS ITS OWN FILE. `FleetScreen` was ONE component with a 932-line
// body. This strip is 82 of them, and it does not merely render: it owns the
// ack's two repairs — moving focus to the chip's own label after the control
// that was activated unmounts itself, and announcing what happened to a
// screen reader that would otherwise get nothing at all. Both of those live
// here now, with the comments that argue them, instead of two hundred lines
// above the markup they are about.
//
// IT TAKES THREE PROPS AND KEEPS FOUR THINGS. `sessions`, `acks` and
// `ackAll` come in; the label vocabulary, the focus refs, the announcement
// state and `markSeen` are all this strip's own. The `role="status"` div
// comes with it and stays OUTSIDE the chip, for the reason its own comment
// gives: the update it reports is the one that unmounts the chip.
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { CountBadge } from '@ccrc/ui';
import { BUCKET_ORDER } from './sortFleet';
import { STATUS_GROUPS } from './statusGroups';
import { isUnseen, type Acks } from '../lib/seen';
import './fleet.css';

/** The chip's word for each bucket — DERIVED from `STATUS_GROUPS`, the one table Instrument's group heads read too, so
 *  the chips say `Needs you` and `Exited` exactly as the heads do (T3a, D-6331: one vocabulary). It used to be a
 *  deliberately SEPARATE small vocabulary (`Attention`, `Dead`), on the argument that a heading register needs no
 *  "one writer"; the cost was two words for one bucket on one screen, and a third beside it in the rows' own state
 *  word (`exited`). A heading is still presentational: it names buckets, it does not decide which bucket a session
 *  is in. Retitling a bucket is a change to `STATUS_GROUPS`'s `label`, and both surfaces follow it. */
const SECTION_LABEL = Object.fromEntries(
  BUCKET_ORDER.map((b) => [b, STATUS_GROUPS[b].label]),
) as Record<(typeof BUCKET_ORDER)[number], string>;

export function BucketBar(
  { sessions, acks, ackAll }: {
    sessions: readonly FleetSession[];
    acks: Acks;
    ackAll: (sessions: readonly FleetSession[], at: number) => void;
  },
): ReactNode {

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
  // count, because "done" would be the same sentence for every chip.
  const labelRefs = useRef<Partial<Record<(typeof BUCKET_ORDER)[number], HTMLElement | null>>>({});
  const [ackNote, setAckNote] = useState('');
  const markSeen = (
    bucket: (typeof BUCKET_ORDER)[number],
    inBucket: readonly FleetSession[],
    unseenCount: number,
  ): void => {
    ackAll(inBucket, Date.now());
    setAckNote(`${SECTION_LABEL[bucket]}: ${unseenCount} marked seen`);
    labelRefs.current[bucket]?.focus();
  };

  return (
    <>
          {/* Bucket chips — above the project cards, one per non-empty
              bucket, in the same RANK order the list itself sorts by. Counts
              come from THIS render's own `sessions` array, the identical one
              the cards below iterate, so a chip's number is always the number
              of ROWS the cards hold for that bucket. `groupFleet` splits its
              per-project fold on `inArchivedFold` — the `archived` bucket, and
              (workspace lifecycle §5.2) a stopped main checkout — and never on
              `archivedAt`, for exactly this
              reason: on the `archivedAt` split, a merged workspace counted
              under `Cleanup` here and rendered inside a fold labelled
              `Archived (n)`, so this row named a bucket whose rows, glyph and
              merge facts were nowhere on the screen.

              Two folds hold rows a chip counts. `Archived (n)` holds its
              chip's members and every STOPPED main checkout, whose bucket is
              still `dead` (M10), so the Exited chip counts a row that fold holds
              — stated, not changed (spec §5.2). `Released (n)` (workspace lifecycle
              §5.1) holds rows that are still `idle`, `done` or `dead` and
              still counted under those chips: folded, never removed, so a
              chip may count rows that sit inside a card's Released fold. The footer below is the wider DISK
              set (everything with an `archivedAt`, merged ones included) and
              says so in its own words rather than repeating the noun.

              A `<div role="group">`, NOT a `<section aria-label>`: a labelled
              section is a `region` LANDMARK, and seven of them named after
              buckets — none containing any of that bucket's sessions — turns
              the landmark rotor, whose whole job is to move a screen-reader
              user to the region they named, into seven dead ends. */}
          <div className="bucket-bar">
            {BUCKET_ORDER.map((bucket) => {
              const inBucket = sessions.filter((s) => s.bucket === bucket);
              if (inBucket.length === 0) return null;
              const unseenCount = inBucket.filter((s) => isUnseen(s, acks)).length;
              return (
                <div key={bucket} role="group" className="bucket-head" aria-label={SECTION_LABEL[bucket]}>
                  <span
                    className="bucket-head-label"
                    /* The focus target after an ack — see `markSeen`. -1, so
                       it is reachable programmatically and never a Tab stop
                       of its own. */
                    tabIndex={-1}
                    ref={(el) => { labelRefs.current[bucket] = el; }}
                  >
                    {SECTION_LABEL[bucket]}
                  </span>
                  <span className="bucket-head-count">{inBucket.length}</span>
                  {unseenCount > 0 && (
                    <>
                      {/* "Done 5 · 4 new": the count says its word (T3a, D-6331). The middot is decoration; the
                          group's own name carries the sentence. */}
                      <span className="bucket-head-sep" aria-hidden="true">·</span>
                      <CountBadge className="bucket-head-unseen" aria-label={`${unseenCount} new`}>
                        {unseenCount} new
                      </CountBadge>
                      <button
                        type="button"
                        className="bucket-head-seen"
                        /* The bucket is IN the accessible name. Every one of
                           these used to be the bare string "Mark all seen",
                           and NVDA's Elements List, JAWS's button list and
                           the VoiceOver rotor all list controls by name
                           alone, outside their containing group — so three
                           unseen buckets produced three identical entries and
                           picking the wrong one silently cleared the badge on
                           the session Claude is still blocked on, with no way
                           to restore it. */
                        aria-label={`Mark all ${SECTION_LABEL[bucket]} seen`}
                        onClick={() => markSeen(bucket, inBucket, unseenCount)}
                      >
                        Mark all seen
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {/* The ack's only evidence. Activating "Mark all seen" DESTROYS the
              control that was activated (both it and the badge live inside
              `unseenCount > 0`), so there is nothing left to announce a state
              change on and — without the focus transfer in `markSeen` — the
              browser drops focus to <body>, restarting the next Tab at the
              top of the document. Outside the chip so it is not unmounted by
              the very update it reports. */}
          <div className="sr-only" role="status">{ackNote}</div>
    </>
  );
}
