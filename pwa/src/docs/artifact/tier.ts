// Which tier an HTML page meets (X5 A5.1; spec 2026-11-19 §2.5, §3.2 "Earlier versions", §6.1 Figure 4). Ring L1: pure, no React,
// no fetch, no DOM global. `artifactOffer` decides from the box's availability and two facts about the page alone; it takes no
// input about what the walls refused, because nothing decides by that (§6.1 option b').
// This module also declares the consumer's port, `ArtifactDoors`, with its failure contract (the consumer declares the port; the
// adapter is `api.docs.artifacts` in `lib/api.ts`), and the answer union and the refusal reader that port speaks in.
import {
  ARTIFACT_REFUSALS, type ArtifactListOk, type ArtifactMintAsk, type ArtifactMintOk, type ArtifactOffWhy, type ArtifactRefusal,
  type ArtifactRevokeOk, type ArtifactScopeOk,
} from '../../../../shared/artifacts';
import type { DocListPin } from '../../../../shared/docs';
import type { DocsNotOk } from '../failures';
import { ARTIFACT_TEXT } from './artifactWords';

/** Whether a mint could work on this box now, and why not when it could not (the list read's `available` and `why`). */
export type ArtifactAvailability = { available: true } | { available: false; why: ArtifactOffWhy };

/** The pre-scan's census of the page, for the launch sheet (A5.2): the outside origins it names and the references above its
 *  folder. `null` wherever the pre-scan did not run. Declared here for the sheet; A5.1 never fills it. */
export interface ArtifactCensus { readonly origins: readonly string[]; readonly above: number }

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

/** An artifact door's answer: the success body, a refusal word of the scope read or the mint (`{ok: false, error}`), or the docs
 *  reads' union (a docs failure word, a 401, an unreadable answer). */
export type ArtifactAnswer<T> = { s: 'ok'; value: T } | { s: 'refused'; word: ArtifactRefusal } | DocsNotOk;

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
