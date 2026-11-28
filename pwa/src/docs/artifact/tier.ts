// Which tier an HTML page meets (X5 A5.1; spec 2026-11-19 §2.5, §3.2 "Earlier versions", §6.1 Figure 4). Ring L1: pure, no React,
// no fetch, no DOM global. `artifactOffer` decides from the box's availability and two facts about the page alone; it takes no
// input about what the walls refused, because nothing decides by that (§6.1 option b').
// This module also declares the consumer's port, `ArtifactDoors`, with its failure contract (the consumer declares the port; the
// adapter is `api.docs.artifacts` in `lib/api.ts`), and the answer union and the refusal reader that port speaks in.
import {
  ARTIFACT_MAX_ORIGINS, ARTIFACT_REFUSALS, originAdmitted, type ArtifactListOk, type ArtifactMintAsk, type ArtifactMintOk, type ArtifactOffWhy,
  type ArtifactRefusal, type ArtifactRevokeOk, type ArtifactScopeOk,
} from '../../../../shared/artifacts';
import { resolveDocRef, type DocListPin, type DocSectionSlug } from '../../../../shared/docs';
import type { DocsNotOk } from '../failures';
import type { MockupAssetRow } from '../mockup/ports';
import { failureSentence, slotSentence } from '../docsText';
import { ARTIFACT_REFUSAL_TEXT, ARTIFACT_TEXT } from './artifactWords';

/** Whether a mint could work on this box now, and why not when it could not (the list read's `available` and `why`). */
export type ArtifactAvailability = { available: true } | { available: false; why: ArtifactOffWhy };

/** The pre-scan's census of the page, for the launch sheet (A5.2): the outside origins it names and the references above its
 *  folder. `null` wherever the pre-scan did not run. Declared here for the sheet; A5.1 never fills it. */
export interface ArtifactCensus { readonly origins: readonly string[]; readonly above: number }

/** What a leaf hands the sheet about its pre-scan: the census; `null` when the pre-scan did not run for this view (the sheet says
 *  the page was not scanned); `'pending'` when the view's pre-scan has not answered yet (the sheet waits and holds Prepare). The
 *  two are never one value: a caller that has not heard back must not read as one that did not scan. */
export type ArtifactCensusState = ArtifactCensus | null | 'pending';

/** A capability this console minted and still knows of: its id and page, never its URL or token (and not its end, which the box
 *  slides forward with use). */
export interface ArtifactKnown {
  readonly id: string; readonly project: string; readonly section: DocSectionSlug; readonly path: string;
}

/** What the offer draws: a live button, a disabled one with its sentence, or no button (a sentence, or nothing when `text` is ''). */
export interface ArtifactOfferView { readonly kind: 'button' | 'disabled' | 'none'; readonly text: string }

/** The offer beside an HTML page's walls view, in Figure 4's order: an earlier version first (its sentence), then an outside-folder
 *  page or a dark sign-in (nothing), then the box's availability (the button, or the disabled button with its own sentence). */
export function artifactOffer(
  avail: ArtifactAvailability,
  page: { readonly folder: boolean; readonly version: boolean },
): ArtifactOfferView {
  if (page.version) return { kind: 'none', text: ARTIFACT_TEXT.version };
  if (page.folder) return { kind: 'none', text: '' };
  if (avail.available) return { kind: 'button', text: ARTIFACT_TEXT.open };
  switch (avail.why) {
    case 'auth-off': return { kind: 'none', text: '' };
    case 'unset':
    case 'partial':
    case 'invalid': return { kind: 'disabled', text: ARTIFACT_TEXT.setup };
    case 'by-address': return { kind: 'disabled', text: ARTIFACT_TEXT.byAddress };
    case 'listener-down': return { kind: 'disabled', text: ARTIFACT_TEXT.listenerDown };
    default: {
      // A reason added to `ArtifactOffWhy` fails to compile here until it is placed above.
      const unplaced: never = avail.why;
      void unplaced;
      return { kind: 'none', text: '' };
    }
  }
}

/** Whether `path` (a section-relative path of a doc) lies in the folder of `page`: a page at a section root has the whole section as
 *  its folder; any other page has its own directory and below. */
function inFolderOf(page: { readonly section: DocSectionSlug; readonly path: string }, section: DocSectionSlug, path: string): boolean {
  if (section !== page.section) return false;
  const cut = page.path.lastIndexOf('/');
  return cut < 0 || path.startsWith(page.path.slice(0, cut + 1));
}

/** How many of the page's references point above its folder, so the artifact tier cannot serve them (spec §6.2, "Above the
 *  folder"): a reference that resolves, from the file that wrote it (`basePath`, `<section>/<path>`), to a doc outside the page's
 *  folder, to a repo path outside the Docs sections, or above the repository root. External, fragment, data, blob and refused
 *  references of any other kind do not count: they are not a file the manifest could hold. */
export function aboveFolderCount(
  rows: readonly MockupAssetRow[],
  page: { readonly section: DocSectionSlug; readonly path: string },
): number {
  let n = 0;
  for (const row of rows) {
    const base = row.ref.basePath;
    const cut = base.indexOf('/');
    const from = { section: base.slice(0, cut) as DocSectionSlug, path: base.slice(cut + 1) };
    const at = resolveDocRef(from, row.ref.raw);
    if (at.kind === 'repo' || (at.kind === 'refused' && at.why === 'above-root')) n += 1;
    else if (at.kind === 'doc' && !inFolderOf(page, at.section, at.path)) n += 1;
  }
  return n;
}

/** The origins the launch sheet offers: the census's that the mint would admit (`originAdmitted`, the one origin rule of
 *  `shared/artifacts`: an exact https origin, not an address, none on `ours`, the console's, artifact and content hosts as an
 *  origin or a `Host` value), in order, at most `ARTIFACT_MAX_ORIGINS`. */
export function sheetOrigins(origins: readonly string[], ours: readonly string[]): string[] {
  const kept: string[] = [];
  for (const origin of origins) {
    if (originAdmitted(origin, ours)) kept.push(origin);
    if (kept.length === ARTIFACT_MAX_ORIGINS) break;
  }
  return kept;
}

/** An artifact door's answer: the success body, a refusal word of the scope read or the mint (`{ok: false, error}`), or the docs
 *  reads' union (a docs failure word, a 401, an unreadable answer). */
export type ArtifactAnswer<T> = { s: 'ok'; value: T } | { s: 'refused'; word: ArtifactRefusal } | DocsNotOk;

/** What stops a scope read or a mint, as the sheet draws it: the sentence; whether it is `pin-moved`, whose one action is
 *  Reload and open again; and whether a Retry that reads the scope again is offered (the `unmeasured` refusal, a docs failure
 *  word or a client slot: a read that did not complete or could not list the files, not an answer about the page). A refusal word
 *  has its own sentence (`ARTIFACT_REFUSAL_TEXT`, total over the vocabulary); a docs failure word or a client slot is worded by
 *  the docs views' own sentences, so the sheet speaks as they do. */
export interface ArtifactStop { readonly sentence: string; readonly pinMoved: boolean; readonly retry: boolean }
export function artifactStop(answer: Exclude<ArtifactAnswer<unknown>, { s: 'ok' }>): ArtifactStop {
  if (answer.s === 'refused') {
    return { sentence: ARTIFACT_REFUSAL_TEXT[answer.word], pinMoved: answer.word === 'pin-moved', retry: answer.word === 'unmeasured' };
  }
  return { sentence: answer.s === 'failed' ? failureSentence(answer.body) : slotSentence(answer), pinMoved: false, retry: true };
}

/** The five artifact doors, declared by their consumer. Failure contract: a call resolves an `ArtifactAnswer` for every server
 *  answer and never rejects for one; it rejects only when its own signal aborts (`scope`) or for a defect. */
export interface ArtifactDoors {
  list(): Promise<ArtifactAnswer<ArtifactListOk>>;
  scope(project: string, pin: DocListPin, signal?: AbortSignal): Promise<ArtifactAnswer<ArtifactScopeOk>>;
  mint(ask: ArtifactMintAsk): Promise<ArtifactAnswer<ArtifactMintOk>>;
  revoke(id: string): Promise<ArtifactAnswer<ArtifactRevokeOk>>;
  revokeAll(): Promise<ArtifactAnswer<ArtifactRevokeOk>>;
}

/** The refusal word of an artifact door's error body: its `error` when the body is `{ok: false, error}` and `error` is one of
 *  `ARTIFACT_REFUSALS`; null for anything else (a docs failure body, an unknown string, a non-object). */
export function artifactRefusalOf(body: unknown): ArtifactRefusal | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const error = record['error'];
  if (record['ok'] !== false || typeof error !== 'string') return null;
  return (ARTIFACT_REFUSALS as readonly string[]).includes(error) ? error as ArtifactRefusal : null;
}
