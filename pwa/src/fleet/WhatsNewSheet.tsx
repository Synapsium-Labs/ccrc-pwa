// WhatsNewSheet — what an update would bring (D-5549). The update banner's
// "See what's new" opens it in place: before, the button navigated to
// /settings, whose release list sits far below the fold, so the tap read as
// doing nothing.
//
// WHAT IT LISTS: every catalogue release above the OLDEST version a node that
// is behind runs (a node with an arrow, `pendingTag`), up to the tag the
// banner announces, newest first — every channel, because each release's
// notes cover only its own range, so the dev releases in between are where a
// stable tag's changes are written. A node already on the tag, or one with no
// measured version, does not narrow the range; with no measured version behind
// at all, the sheet shows the banner's tag alone and says "in", not "since".
//
// THE NOTES are `ReleaseNotes` (the Settings rows render the same component):
// plain text, grouped, Behind the scenes folded, each `#NNN` a link built from
// the number and the server's release source. A release with no body says
// "No notes for this release" under its tag and date.
//
// THE FOOTER is the banner's own two moves: Update all — the same move sheet,
// opened by the banner once this sheet has closed, and disabled with the same
// reason line while a node halts the fleet — and Close.
//
// ≥900 IT IS A CENTRED DIALOG (the skins rules' desktop arm for a sheet):
// `.whats-new-panel` in fleet.css re-places the shared Sheet's panel — layout
// only, no colour — until the Sheet primitive grows that arm itself.
import { useId } from 'react';
import type { ReactNode } from 'react';
import type { ReleaseWire, UpdatesView } from '../../../shared/api';
import { isReleaseTag } from '../../../shared/api';
import { compareReleaseTags } from '../../../shared/semver';
import { Button, QC_ACTIONS, RESET_LIST, Sheet } from '@ccrc/ui';
import { releaseDate } from '../screens/updates';
import { NO_NOTES_TEXT, ReleaseNotes, hasReleaseNotes } from './ReleaseNotes';
import { behindSince } from './useUpdatesView';
import './fleet.css';

// The one wording for empty notes, defined beside the component (the release rows' summary reads it too, D-5505).
export { NO_NOTES_TEXT };
/** A one-line sentence in the sheet: the no-notes line and the halted reason. */
const SHEET_LINE = 'm-0 text-sm';

/** The releases an update to `tag` brings, newest first, and the version they
 *  are counted from (`null` when no behind node has a measured version). */
export function whatsNewReleases(view: UpdatesView, tag: string): { since: string | null; releases: ReleaseWire[] } {
  const since = behindSince(view.nodes);
  const releases = (Array.isArray(view.releases) ? view.releases : [])
    .filter((r) => isReleaseTag(r.tag) && compareReleaseTags(r.tag, tag) <= 0
      && (since === null ? r.tag === tag : compareReleaseTags(r.tag, since) === 1))
    .sort((a, b) => compareReleaseTags(b.tag, a.tag));
  return { since, releases };
}

function ReleaseBlock({ release: r, view }: { release: ReleaseWire; view: UpdatesView }): ReactNode {
  return (
    <li className="grid gap-2" data-tag={r.tag}>
      <p className="m-0 flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono font-semibold">{r.tag}</span>
        <span className="font-mono text-xs">{releaseDate(r.publishedAt)}</span>
      </p>
      {hasReleaseNotes(r.notes)
        ? <ReleaseNotes notes={r.notes} source={view.source} hideSince />
        : <p className={SHEET_LINE}>{NO_NOTES_TEXT}</p>}
    </li>
  );
}

export function WhatsNewSheet({ open, view, tag, halted, onClose, onUpdateAll }: {
  open: boolean; view: UpdatesView | null; tag: string | null; halted: string | null;
  onClose: () => void; onUpdateAll: () => void;
}): ReactNode {
  const haltedId = useId();
  if (!open || view === null || tag === null) return null;
  const { since, releases } = whatsNewReleases(view, tag);
  const title = since === null ? `What's new in ${tag}` : `What's new since ${since}`;
  const count = `${releases.length} ${releases.length === 1 ? 'release' : 'releases'}`;
  return (
    <Sheet open onClose={onClose} title={title} eyebrow={count} className="whats-new-panel">
      <div className="whats-new-sheet grid gap-4">
        <ol className={`${RESET_LIST} gap-5`} aria-label="Releases, newest first">
          {releases.map((r) => <ReleaseBlock key={r.tag} release={r} view={view} />)}
        </ol>
        {halted !== null && <p className={SHEET_LINE} id={haltedId}>{halted}</p>}
        <div className={QC_ACTIONS}>
          <Button
            variant="primary"
            disabled={halted !== null}
            aria-describedby={halted !== null ? haltedId : undefined}
            onClick={onUpdateAll}
          >
            Update all
          </Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Sheet>
  );
}
