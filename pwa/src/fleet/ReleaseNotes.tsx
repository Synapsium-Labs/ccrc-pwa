// ReleaseNotes — one release's notes, as the What's-new sheet and the Settings
// release rows both show them (D-5549). The body is read by
// `shared/release-notes.ts`: the format deploy/release-notes.mjs writes at
// release time (D-5548) renders as its groups — New, Fixed, Faster open, and
// Behind the scenes folded behind a disclosure — and a body in any other shape
// (hand-written, or from before the notes step) renders as the text it is.
//
// PLAIN TEXT, ALWAYS (the centralised-update design's §18 "notes are capped
// and plain"). Every piece of a body reaches the DOM as a React text child —
// no markdown pass, no HTML, no URL taken from it. The one link is a `#NNN`
// reference, built by `pullUrl` from the number and the server's release
// source (`UpdatesView.source`); with no source, the number stays text.
//
// THE BLOCK IS `.settings-release-notes`, the rule the Settings rows already
// wear: self-grounded (its own background and ink), so everything inside it
// inherits a pair the contrast gate already measures, and nothing here adds
// one. The plain arm keeps the `<pre>` that rule was written for; the grouped
// arm is a `<div>`, because a `<pre>` may hold only phrasing content.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ReleaseSourceWire } from '../../../shared/api';
import {
  FOLDED_NOTE_GROUP, parseReleaseNotes, pullUrl, splitPrRefs,
} from '../../../shared/release-notes';
import { Button, RESET_LIST, TextLink } from '@ccrc/ui';
import { openExternal } from '../lib/markdown';

/** One line of notes: its text, every `#NNN` a link when the source allows. */
export function NoteText({ text, source }: { text: string; source: ReleaseSourceWire | null | undefined }): ReactNode {
  return splitPrRefs(text).map((p, i) => {
    if ('text' in p) return p.text;
    const url = pullUrl(source, p.pr);
    return url === null
      ? `#${p.pr}`
      : <TextLink key={i} href={url} onClick={(e) => openExternal(e, url)}>{`#${p.pr}`}</TextLink>;
  });
}

/** A group: its heading (or fold) above its lines. */
const GROUP_BOX = 'grid gap-1';

function Group({ name, items, source }: { name: string; items: readonly string[]; source: ReleaseSourceWire | null | undefined }): ReactNode {
  return (
    <ul className={`${RESET_LIST} gap-1`} aria-label={name}>
      {items.map((t, i) => <li key={i}>{'• '}<NoteText text={t} source={source} /></li>)}
    </ul>
  );
}

/** `null` when there is nothing to show (no body). A caller that must say
 *  "no notes" asks `hasReleaseNotes` first. */
export function ReleaseNotes({ notes, source }: {
  notes: string | null | undefined; source: ReleaseSourceWire | null | undefined;
}): ReactNode {
  const [unfolded, setUnfolded] = useState(false);
  const read = parseReleaseNotes(notes);
  if (read.kind === 'none') return null;
  if (read.kind === 'plain') {
    return <pre className="settings-release-notes"><NoteText text={read.text} source={source} /></pre>;
  }
  return (
    <div className="settings-release-notes grid gap-2">
      {read.since !== null && <p className="m-0">{`Changes since ${read.since}`}</p>}
      {read.empty && <p className="m-0">No changes.</p>}
      {read.groups.map((g) => g.name === FOLDED_NOTE_GROUP
        ? (
          <div key={g.name} className={GROUP_BOX}>
            <Button
              variant="ghost"
              size="fit"
              className="justify-self-start"
              aria-expanded={unfolded}
              onClick={() => setUnfolded((v) => !v)}
            >
              {`${g.name} (${g.items.length})`}
            </Button>
            {unfolded && <Group name={g.name} items={g.items} source={source} />}
          </div>
        )
        : (
          <div key={g.name} className={GROUP_BOX}>
            <p className="m-0 font-semibold">{g.name}</p>
            <Group name={g.name} items={g.items} source={source} />
          </div>
        ))}
      {read.more !== null && <p className="m-0">{`…and ${read.more} more ${read.more === 1 ? 'change' : 'changes'}`}</p>}
    </div>
  );
}

/** Whether `notes` carries anything `ReleaseNotes` would show. */
export function hasReleaseNotes(notes: string | null | undefined): boolean {
  return parseReleaseNotes(notes).kind !== 'none';
}
