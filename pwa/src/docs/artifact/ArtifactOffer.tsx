// The artifact tier's offer beside an HTML page's walls view (X5 A5.1; spec 2026-11-19 §2.5, §6.1 Figure 4). Ring L4: it draws
// `artifactOffer`'s answer and decides nothing. Until the availability read answers, or when it failed, it draws nothing. The button
// opens the launch sheet (A5.2) by setting the store's `sheetFor`, which is why it says it opens a dialog; A5.1 builds no sheet. The
// pin and the census are what the sheet will read; every caller states its census, null wherever the pre-scan did not run.
import { useId, type ReactNode } from 'react';
import type { DocListPin, DocSectionSlug } from '../../../../shared/docs';
import { ARTIFACT_TEXT } from './artifactWords';
import { artifactOffer, type ArtifactCensus } from './tier';
import { artifactPageKey, useArtifacts } from './useArtifacts';

export interface ArtifactOfferProps {
  readonly project: string;
  readonly pin: DocListPin;
  /** The leaf's place. `at` is its version commit, set on an earlier version of the page. */
  readonly page: { readonly section: DocSectionSlug; readonly path: string; readonly at: string | null };
  /** A page of an outside folder (never in A5.1: the leaf and the mockup view serve project pages only). */
  readonly folder?: boolean;
  /** The pre-scan's census, for A5.2's sheet; null where the pre-scan did not run. */
  readonly census: ArtifactCensus | null;
}

export function ArtifactOffer(p: ArtifactOfferProps): ReactNode {
  const { state, openSheet } = useArtifacts();
  const reasonId = useId();
  if (state.list.s !== 'ok') return null;
  const offer = artifactOffer(state.list.avail, { folder: p.folder === true, version: p.page.at !== null });
  if (offer.kind === 'none') return offer.text === '' ? null : <p className="docs-note">{offer.text}</p>;
  const key = artifactPageKey(p.project, p.page.section, p.page.path);
  return (
    <>
      <div className="docs-leaf-actions">
        {offer.kind === 'button'
          ? <button type="button" className="docs-leaf-action" aria-haspopup="dialog" onClick={() => openSheet(key)}>{offer.text}</button>
          : <button type="button" className="docs-leaf-action" aria-describedby={reasonId} disabled>{ARTIFACT_TEXT.open}</button>}
      </div>
      {offer.kind === 'disabled' && <p id={reasonId} className="docs-note">{offer.text}</p>}
    </>
  );
}
