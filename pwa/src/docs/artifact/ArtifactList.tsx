// The live artifact links, listed with Revoke and Revoke all (X5 A5.3; spec 2026-11-19 §3.3 "Revocation" and "Re-hand"). Ring L4: it
// draws the store's live rows and calls the two revoke doors; every choice (which rows, the words, the times, the sentence of a
// refusal) is `listWords.ts`'s. With a `scope` it lists that one page's rows (Page details); without one, every live row on the box
// (the Docs index). It draws nothing until the availability read is ok, and nothing when no row is left to show. On mount it asks the
// store to read again when the list it holds is older than `ARTIFACT_LIST_FRESH_MS`.
// NEVER a URL: a row shows its page, short id, version, times, windows and outside-host count, and the component draws no anchor, no
// token and no Copy control, because a link is not meant to travel (spec §3.3). Revoke ends one capability and Revoke all every one
// on the box (also those another page's list shows); each then reads the list again, and a refused or failed revoke keeps the rows
// and says one sentence in a status line that stays mounted, so a screen reader hears the change. A tap while a revoke is under way
// is ignored (a ref, set in the tap itself, since the disabled state only lands with the next render). After a revoke that ended, focus
// moves to the list's heading, which the dropped row's button no longer holds.
import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, useNow } from '@ccrc/ui';
import type { ArtifactRow } from '../../../../shared/artifacts';
import { fillSentence } from '../docsText';
import type { ArtifactAnswer } from './tier';
import {
  ARTIFACT_LIST_FRESH_MS, ARTIFACT_LIST_TEXT, artifactNamesProject, artifactNotRevoked, artifactPageName, artifactRevokeLabel,
  artifactRowsFor, artifactShortId, artifactWhen, type ArtifactListScope,
} from './listWords';
import { ArtifactDoorsContext, useArtifacts } from './useArtifacts';

/** How often the relative times are drawn again: a minute is the finest word they hold. */
const TICK_MS = 60000;

function RowView(p: {
  readonly row: ArtifactRow; readonly now: number; readonly named: boolean; readonly busy: boolean; readonly onRevoke: () => void;
}): ReactNode {
  const { row } = p;
  const when = artifactWhen(row, p.now);
  return (
    <li className="grid gap-[var(--sp-1)]">
      <span className="docs-row-name">{artifactPageName(row)}</span>
      {p.named && <span className="docs-row-note">{row.project}</span>}
      <span className="docs-row-note">{fillSentence(ARTIFACT_LIST_TEXT.id, { id: artifactShortId(row) })}</span>
      <span className="docs-row-note">{fillSentence(ARTIFACT_LIST_TEXT.pinned, { pin: row.pinLabel })}</span>
      <span className="docs-row-note">{when.minted}</span>
      <span className="docs-row-note">{when.last}</span>
      <span className="docs-row-note">{when.expires}</span>
      <span className="docs-row-note">
        {row.windows ? ARTIFACT_LIST_TEXT.windowsAllowed : ARTIFACT_LIST_TEXT.windowsClosed}
        {' · '}
        {fillSentence(ARTIFACT_LIST_TEXT.hosts, { n: row.origins.length })}
      </span>
      <Button variant="ghost" size="fit" disabled={p.busy} onClick={p.onRevoke} aria-label={artifactRevokeLabel(row, p.named)}>
        {ARTIFACT_LIST_TEXT.revoke}
      </Button>
    </li>
  );
}

export function ArtifactList(p: { readonly scope?: ArtifactListScope }): ReactNode {
  const { state, refresh, ensureFresh } = useArtifacts();
  const doors = useContext(ArtifactDoorsContext);
  const now = useNow(TICK_MS);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const underWay = useRef(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => { ensureFresh(ARTIFACT_LIST_FRESH_MS); }, [ensureFresh]);
  if (state.list.s !== 'ok') return null;
  const live = state.list.live;
  const rows = artifactRowsFor(live, p.scope);
  if (rows.length === 0) return null;

  /** Runs one revoke door, then reads the list again; a failed answer keeps the rows and says its sentence. */
  const run = async (door: () => Promise<ArtifactAnswer<unknown>>, plain: string): Promise<void> => {
    if (underWay.current) return;
    underWay.current = true;
    setBusy(true);
    setSaid(null);
    let answer: ArtifactAnswer<unknown> | null = null;
    try {
      answer = await door();
    } catch {
      // A door never rejects for a server answer; a defect says the plain sentence and leaves the rows.
    }
    try {
      if (answer !== null && answer.s === 'ok') {
        await refresh();
        heading.current?.focus();
      } else setSaid(artifactNotRevoked(answer, plain));
    } finally {
      underWay.current = false;
      setBusy(false);
    }
  };

  const named = artifactNamesProject(p.scope);
  return (
    <section className="grid gap-[var(--sp-2)]" aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className="docs-note">{ARTIFACT_LIST_TEXT.heading}</h2>
      <ul className="docs-rows gap-[var(--sp-2)]">
        {rows.map((row) => (
          <RowView
            key={row.id} row={row} now={now} named={named} busy={busy}
            onRevoke={() => void run(() => doors.revoke(row.id), ARTIFACT_LIST_TEXT.failed)}
          />
        ))}
      </ul>
      <p className="docs-note" role="status">{said ?? ''}</p>
      <p className="docs-note">{fillSentence(ARTIFACT_LIST_TEXT.revokeAllNote, { n: live.length })}</p>
      <Button
        variant="ghost" size="fit" disabled={busy} aria-label={ARTIFACT_LIST_TEXT.revokeAllLabel}
        onClick={() => void run(() => doors.revokeAll(), ARTIFACT_LIST_TEXT.failedAll)}
      >
        {ARTIFACT_LIST_TEXT.revokeAll}
      </Button>
    </section>
  );
}
