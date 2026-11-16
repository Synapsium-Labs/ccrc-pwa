// The substrate fault's SENTENCE, said once.
//
// FIVE COPIES, EACH WITH A COMMENT DENYING IT. `tmux unreachable — <reason>`
// was written out in `SessionScreen`, `SessionMeta`, `SessionActionsSheet`,
// `ArchiveSheet` (twice) and `SessionHeader`'s own prose — and three of those
// call sites carry a comment saying the string is "`SessionLine`'s chip's own
// `tmux unreachable — <reason>`, never a second copy". Every one of them WAS
// the second copy. A comment is a request; this is the mechanism.
//
// INVISIBLE TO EVERY CENSUS ON THIS BRANCH, and that is the measured point:
// the stylesheet census reads rules, the markup census reads elements, class
// strings and leaves, and this is none of those — it is one template literal
// in six places. It was found by scanning for repeated four-line windows of
// normalised code across both packages.
//
// NOT IN `shared/api.ts` beside `substrateFault` itself: that file is L0 and
// the server imports it, while this is PWA COPY — operator-facing words that
// the ring rules keep out of the shared layer.
import { substrateFault, type FleetSession } from '../../../shared/api';

/** The reading `substrateFault` returns, named so the callers below can pass
 *  it around without re-deriving the shape. */
export type SubstrateFaultRead = NonNullable<ReturnType<typeof substrateFault>>;

/** The one sentence. Takes a MEASURED fault, so a caller that has none keeps
 *  its own answer for that case — a tooltip wants `undefined`, an inline error
 *  wants nothing rendered at all, and a toast is never sent. */
export const substrateFaultText = (fault: SubstrateFaultRead): string =>
  `tmux unreachable — ${fault.text}`;

/** The same sentence as a `title`, for the three controls that gate on a fault
 *  and explain themselves through the attribute. `undefined` rather than `''`:
 *  an empty title renders an empty tooltip box on some platforms. */
export const substrateFaultTitle = (session: FleetSession): string | undefined => {
  const fault = substrateFault(session);
  return fault === null ? undefined : substrateFaultText(fault);
};
