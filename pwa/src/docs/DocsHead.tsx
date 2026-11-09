// The Docs header (spec 2026-10-01 4.4's layout, 4.5; W5 part 1 Task 10): back (up one level, never
// `history.back()`: a deep link has no history), the crumbs (on a phone the last two behind a leading `…`), the truth
// line (the served ref, the short commit with copy commit, how the ref was chosen, a leaf's source, badge and size,
// and the freshness chip), the actions (View on GitHub, Share, Export, Open committed version) and "Updated to <short>". A pure
// renderer of the page, the visit and the tree answer: it starts no request, and the chip's tap is the visit's
// `refreshManual`. Every draft word is `entryView`'s through `ENTRY_BADGE_TEXT`, the one badge function the rows use
// too (M4.T7). Share (spec 4.16) opens ShareSheet over shareTargetFor's answer and makes no request either; Export
// (spec 4.17) follows Share on a leaf: exportStateFor decides, and ExportSheet builds and saves.
// Under DOCS_COMPACT_QUERY (600 CSS px) a leaf page draws the compact head instead (the phone-header plan of 2026-11-03):
// one row of back, where and what, Share and Export as icons, and Page details, which opens a panel holding the crumbs,
// the truth line and the link actions (`CompactHead`). Every other page, and every page at a wider viewport, draws the
// header above as one row and one dense line (desk-nav Part B, D-8101): back, the crumbs and the actions share the row
// (GitHub, Share and Export an icon beside their words, the words giving way first when the row is short, `HeadRow`),
// and the truth line sits under it on one line.
import {
  useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import {
  DOCS_CLASS_CAP, contentClass, docsApi, docsPageUrl, entryView, githubBlobUrl,
  type DocPin, type DocsPageLocation, type DocsShowOk, type DocsTreeOk, type EntryBadge, type EntryMode, type GithubTarget,
} from '../../../shared/docs';
import { doorMark } from '../command/door';
import { formatAge } from '../fleet/formatReset';
import { NO_SUBSCRIPTION, openExternal } from '../lib/markdown';
import { navigate } from '../lib/router';
import { DESK_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { Icon, useNow } from '@ccrc/ui';
import { docsLocation } from './docsLinks';
import {
  DOCS_HEAD_TEXT, ENTRY_BADGE_TEXT, EXPORT_WAIT_TEXT, GITHUB_REFUSAL_TEXT, VIA_SENTENCE,
  failureSentence, fillSentence, kib, relationSentence, servedRefText, shortCommit, slotSentence, worktreeLabel,
} from './docsText';
import { SECTION_LABEL, docsPathKind, githubTargetFor } from './docsTree';
import { DocsPageLink } from './DocsTreeView';
import type { DocsNotOk } from './failures';
import { copyText, shareTargetFor, type ShareOpened } from './share';
import { ShareSheet } from './ShareSheet';
import { docMarkdownSource } from './DocMarkdown';
import { ExportSheet } from './ExportSheet';
import type { ExportRequest, ExportSource } from './export/exportInput';
import type { ExportWait } from './export/policy';
import { showBytes } from './objectUrls';
import type { ExportBody } from './exportBody';
import type { ExportAssets } from './export/exportAssets';
import type { HighlightStore } from '../lib/highlightStore';
import { pinCommit, pinFor, samePin, type DocsVisit, type FileSlot, type Freshness } from './useDocsVisit';

type Leaf = DocsPageLocation & { kind: 'path' };
type TreePage = Exclude<DocsPageLocation, { kind: 'index' }>;

const SEP = ' · ';
/** `sourceDraft` after its `{badge}`, so a draft source can draw its badge as the `.docs-badge` the rows draw. */
const SOURCE_DRAFT_TAIL = DOCS_HEAD_TEXT.sourceDraft.slice(DOCS_HEAD_TEXT.sourceDraft.indexOf('{badge}') + '{badge}'.length);

function modeOf(page: DocsPageLocation): EntryMode {
  return page.kind !== 'index' && page.ref !== null ? 'ref' : 'default';
}

function notOkSentence(answer: DocsNotOk): string {
  return answer.s === 'failed' ? failureSentence(answer.body) : slotSentence(answer);
}

/** Where back goes (spec 4.4: "up one level"): a leaf or a directory to its parent directory or its section, a
 *  section to its project, a project to the index, the index to the fleet (`/`). The page's ref is kept; `view` is
 *  dropped. */
export function docsUpHref(page: DocsPageLocation): string {
  switch (page.kind) {
    case 'index':
      return '/';
    case 'project':
      return docsPageUrl(docsLocation(page, { kind: 'index' }));
    case 'section':
      return docsPageUrl(docsLocation(page, { kind: 'project' }));
    case 'path': {
      const cut = page.path.lastIndexOf('/');
      return docsPageUrl(docsLocation(page, cut < 0
        ? { kind: 'section', section: page.section }
        : { kind: 'path', section: page.section, path: page.path.slice(0, cut), dirSlash: true }));
    }
  }
}

/** One crumb: its label and the page it links. The last crumb is the page itself (rendered, not linked). */
export interface DocsCrumb { readonly label: string; readonly href: string }

/** The crumbs from the index down to `page`, each keeping the page's ref (refinement (q)). */
export function docsCrumbs(page: DocsPageLocation): DocsCrumb[] {
  const crumbs: DocsCrumb[] = [{ label: DOCS_HEAD_TEXT.index, href: docsPageUrl(docsLocation(page, { kind: 'index' })) }];
  if (page.kind === 'index') return crumbs;
  crumbs.push({ label: page.project, href: docsPageUrl(docsLocation(page, { kind: 'project' })) });
  if (page.kind === 'project') return crumbs;
  crumbs.push({ label: SECTION_LABEL[page.section], href: docsPageUrl(docsLocation(page, { kind: 'section', section: page.section })) });
  if (page.kind === 'section') return crumbs;
  const parts = page.path.split('/');
  parts.forEach((label, i) => {
    const last = i === parts.length - 1;
    const to = { kind: 'path', section: page.section, path: parts.slice(0, i + 1).join('/'), dirSlash: last ? page.dirSlash : true } as const;
    crumbs.push({ label, href: docsPageUrl(docsLocation(page, to)) });
  });
  return crumbs;
}

/** View on GitHub's and Share's target (spec 3.11, 4.4, 4.16): `docsTree.ts`'s, re-exported for the callers that import
 *  it from the header. */
export { githubTargetFor };

/** A leaf's source (spec 4.5). `badge` null on a draft: the opened draft pin's entry no longer opens a draft in
 *  this tree (the pin outlived a re-list); `worktreePath` null: the drafts are no longer held by one worktree. */
type LeafSource =
  | { readonly kind: 'none' }
  | { readonly kind: 'committed'; readonly viewCommitted: boolean }
  | { readonly kind: 'draft'; readonly badge: EntryBadge | null; readonly label: string; readonly worktreePath: string | null };

function leafSource(tree: DocsTreeOk, page: Leaf, opened: DocPin | null): LeafSource {
  if (opened === null) return { kind: 'none' };
  if (opened.kind === 'committed') return { kind: 'committed', viewCommitted: page.view === 'committed' };
  const d = tree.drafts;
  const e = tree.entries.find((x) => x.section === page.section && x.path === page.path);
  const badge = e === undefined ? null : entryView(e, d, modeOf(page)).badge;
  return d.state === 'holder'
    ? { kind: 'draft', badge, label: worktreeLabel(d.worktree), worktreePath: d.worktree.path }
    : { kind: 'draft', badge, label: opened.branch, worktreePath: null };
}

/** The pin the leaf has open: the visit's file slot's, else the one the tree implies (nothing read yet). */
function openedPin(tree: DocsTreeOk, page: Leaf, file: DocsVisit['file']): DocPin | null {
  return file.s === 'none' ? pinFor(tree, page) : file.pin;
}

function badgeText(badge: EntryBadge | null): string {
  return badge === null ? DOCS_HEAD_TEXT.sourceDraftUnbadged : ENTRY_BADGE_TEXT[badge];
}

/** The truth line's source for a leaf (spec 4.5): `committed`, `committed (view=committed)`, or
 *  `draft · <state> in <worktree label>`. `opened` is the pin the leaf opened; null = nothing opened yet (or nothing
 *  to open), which reads "nothing opened". */
export function truthSource(tree: DocsTreeOk, page: Leaf, opened: DocPin | null): string {
  const s = leafSource(tree, page, opened);
  switch (s.kind) {
    case 'none':
      return DOCS_HEAD_TEXT.sourceNone;
    case 'committed':
      return s.viewCommitted ? DOCS_HEAD_TEXT.sourceViewCommitted : DOCS_HEAD_TEXT.sourceCommitted;
    case 'draft':
      return fillSentence(DOCS_HEAD_TEXT.sourceDraft, { badge: badgeText(s.badge), label: s.label });
  }
}

/** Whether Share is offered on `page`, and on what (spec 4.5, 4.16; M4.SH8, M4.EX12). The header draws no actions until
 *  the tree slot is `ok`, so Share is hidden before then. Past that:
 *  - `absent`: no Share here: the index, a full-screen mockup (`frame=full`), or a path this listing does not hold
 *    (no GitHub counterpart, as for View on GitHub; refinement (m));
 *  - `updating`: a leaf that does not show `pinFor`'s pin yet: its first read is in flight, a re-list moved the pin and
 *    the new read is in flight, or its raster image has not settled (refinements (f), (h)). `to` is the commit it is
 *    moving to (a draft pin's holder HEAD);
 *  - `ready`: what the page opened, for `shareTargetFor`.
 *  Here and not in `share.ts` (refinement (o)): the header renders under tests that mock `share.ts` to `copyText`. */
export type ShareState =
  | { readonly s: 'absent' }
  | { readonly s: 'updating'; readonly to: string }
  | { readonly s: 'ready'; readonly opened: ShareOpened };

export function shareStateFor(
  page: DocsPageLocation, tree: DocsTreeOk, file: FileSlot, leafImage: DocPin | null,
): ShareState {
  if (page.kind === 'index' || (page.kind === 'path' && page.frame === 'full')) return { s: 'absent' };
  if (githubTargetFor(page, tree) === null) return { s: 'absent' };
  const none: ShareState = { s: 'ready', opened: { kind: 'none' } };
  if (page.kind !== 'path') return none;
  const k = docsPathKind(tree, page.section, page.path, modeOf(page));
  const expected = pinFor(tree, page);
  // A directory, or a leaf that opens nothing (a symlink, a submodule, a withheld new file): refinement (r).
  if (k.kind !== 'leaf' || expected === null) return none;
  const updating: ShareState = { s: 'updating', to: pinCommit(expected) };
  const readyAt = (pin: DocPin, show: DocsShowOk | null): ShareState => ({ s: 'ready', opened: { kind: 'file', pin, show } });
  if (contentClass(page.path) === 'raster') {
    // `DocImage` refuses a raster over its class cap and never loads it, as nothing is read for a file slot's
    // `too-large`: the leaf is ready at `pinFor`'s pin.
    const size = expected.kind === 'draft' ? k.entry.draft?.size : k.entry.committed?.size;
    if (typeof size === 'number' && size > DOCS_CLASS_CAP.raster) return readyAt(expected, null);
    return leafImage !== null && samePin(leafImage, expected) ? readyAt(expected, null) : updating;
  }
  // `none` at a leaf that opens a file is a class Docs does not preview (`other`): nothing is read until Download, so
  // the leaf is ready at `pinFor`'s pin (refinement (q)).
  if (file.s === 'none') return contentClass(page.path) === 'other' ? readyAt(expected, null) : updating;
  if (file.s === 'loading') return updating;
  // A same-blob re-list rebinds only an `ok` slot's pin (`useDocsVisit`'s settle effect), so a settled slot that is not
  // `ok` (failed, changing, too-large, a client slot) still carries the older pin. It shows no bytes, so the page
  // serves the tree's commit: ready at `pinFor`'s pin with no answer, as refinement (f) settles a failed raster. Only
  // an `ok` slot's body can still be the old one, so only it waits for the new read (a held body in flight).
  if (file.s !== 'ok') return readyAt(expected, null);
  return samePin(file.pin, expected) ? readyAt(file.pin, file.answer.show) : updating;
}

/** Whether Export is offered on `page`, and on what (spec 4.5, 4.17; M4.SH3, M4.SH8, M4.EX12, M4.EX15; refinements (a),
 *  (j), (k)). Only a leaf has Export, never in `frame=full`; the header draws no actions until the tree slot is `ok`.
 *  - `absent`: a leaf that opens nothing (a withheld new file, a symlink, a submodule); class `other` or `html` (W6); an
 *    over-cap raster; a file slot that settled with no bytes to show (refinement (k));
 *  - `updating`: the leaf does not show `pinFor`'s pin yet (its read, or its raster image, is in flight);
 *  - `waiting`: disabled, with why (`ExportWait`);
 *  - `plain-view`: the reader frame shows the leaf; a tap turns it off so Export saves the plain view (refinement (a));
 *  - `ready`: what to export.
 *  Here and not in a module the header imports from `share.ts`: Share's refinement (o). */
export type ExportState =
  | { readonly s: 'absent' }
  | { readonly s: 'updating'; readonly to: string }
  | { readonly s: 'waiting'; readonly why: ExportWait }
  | { readonly s: 'plain-view' }
  | { readonly s: 'ready'; readonly source: ExportSource };

export interface ExportInputs {
  /** What the leaf's body shows; `null`: nothing published (it is formatting, or nothing is mounted). */
  readonly body: ExportBody | null;
  /** The page's or text leaf's store; `null`: none published. */
  readonly store: HighlightStore | null;
  /** `store.settled()`, read by the caller so the header re-renders when it settles. */
  readonly settled: boolean;
  /** The visit's image registry; `null`: none, so a raster leaf never readies. */
  readonly assets: ExportAssets | null;
}

const EXPORT_ABSENT: ExportState = { s: 'absent' };
const exportWaits = (why: ExportWait): ExportState => ({ s: 'waiting', why });

export function exportStateFor(page: DocsPageLocation, tree: DocsTreeOk, file: FileSlot, x: ExportInputs): ExportState {
  if (page.kind !== 'path' || page.frame === 'full') return EXPORT_ABSENT;
  const k = docsPathKind(tree, page.section, page.path, modeOf(page));
  const expected = pinFor(tree, page);
  if (k.kind !== 'leaf' || expected === null) return EXPORT_ABSENT;
  const cls = contentClass(page.path);
  if (cls === 'other' || cls === 'html') return EXPORT_ABSENT;
  const updating: ExportState = { s: 'updating', to: pinCommit(expected) };
  if (cls === 'raster') {
    const size = expected.kind === 'draft' ? k.entry.draft?.size : k.entry.committed?.size;
    if (typeof size === 'number' && size > DOCS_CLASS_CAP.raster) return EXPORT_ABSENT;
    const held = x.assets?.get(docsApi.file(page.project, expected));
    if (held === undefined || held.s === 'loading') return updating;
    if (held.s === 'failed') return exportWaits('image-failed');
    return held.asset.kind === 'raster' ? { s: 'ready', source: { kind: 'raster', pin: expected, asset: held.asset } } : EXPORT_ABSENT;
  }
  if (file.s === 'none' || file.s === 'loading') return updating;
  if (file.s !== 'ok') return EXPORT_ABSENT;
  if (!samePin(file.pin, expected)) return updating;
  const pin = file.pin;
  const show = file.answer.show;
  if (cls === 'svg') {
    const bytes = file.answer.contentClass === 'svg' ? showBytes(show) : null;
    return bytes === null ? EXPORT_ABSENT : { s: 'ready', source: { kind: 'svg', pin, show, bytes } };
  }
  const src = docMarkdownSource(show);
  if (src.kind === 'no-bytes') return EXPORT_ABSENT;
  const b = x.body;
  if (b === null) return exportWaits('formatting');
  if (cls === 'markdown' && b.kind === 'reader') return { s: 'plain-view' };
  if (cls === 'markdown' && b.kind === 'gate') return exportWaits('gate');
  if (b.kind === 'plain' && b.text === src.text) return { s: 'ready', source: { kind: 'plain', pin, show, body: b } };
  if (cls === 'markdown' && b.kind === 'tree' && b.text === src.text) {
    return x.store === null || !x.settled ? exportWaits('highlighting')
      : { s: 'ready', source: { kind: 'tree', pin, show, body: b, store: x.store } };
  }
  if (cls === 'text' && b.kind === 'text' && b.text === src.text) {
    if (b.lang === null) return { s: 'ready', source: { kind: 'text', pin, show, body: b, store: null } };
    return x.store === null || !x.settled ? exportWaits('highlighting')
      : { s: 'ready', source: { kind: 'text', pin, show, body: b, store: x.store } };
  }
  return exportWaits('formatting');
}

/** The freshness chip's `data-state` (spec 4.5's table). */
export type FreshChipState = 'none' | 'never' | 'ok' | 'local' | 'failed' | 'fetching' | 'soon';

/** When the `soon` chip's wait ends (ms since the epoch), or null when the freshness is not a `soon` one. The visit's
 *  own `soon` (its one automatic retry pending) carries it; an answered `fetch-too-soon` past that retry (a second one
 *  in the visit) is `soon` too (spec 4.5: an answered fetch-too-soon is the `soon` state), counted from the answer's
 *  `retryAfterMs` and when it landed, with no retry behind it. The time can lie in the past: a retry dropped because
 *  the user left the key leaves its `soon` behind, and a second answer's wait runs out with nothing after it. Both
 *  readers then treat the wait as over: the chip falls back to the stamp (`freshnessChip`), and the no-listing page's
 *  fetch note, which has no stamp, says nothing (`fetchNoteOf`, DocsScreen). Neither counts "again in 0s". */
export function soonUntil(freshness: Freshness): number | null {
  if (freshness.s === 'soon') return freshness.retryAt;
  if (freshness.s === 'answered' && freshness.fetch.state === 'failed' && freshness.fetch.failure.failure === 'fetch-too-soon') {
    const after = freshness.fetch.failure.retryAfterMs;
    return freshness.at + (typeof after === 'number' && Number.isFinite(after) && after >= 0 ? after : 0);
  }
  return null;
}

/** The freshness chip (spec 4.5), from the tree's own facts and the visit's refresh state. A `soon` freshness shows
 *  its countdown only while `now < soonUntil`; from that time on (nothing is due and nothing is pending) the chip
 *  is the stamp's, as if the visit had no `soon`. Ages are
 *  `attemptAgeMs + (now - receivedAt)` (and `okAgeMs` likewise), in `formatAge`'s words; an answer this visit got is
 *  aged from when it landed. */
export function freshnessChip(
  tree: DocsTreeOk, receivedAt: number, freshness: Freshness, now: number,
): { readonly state: FreshChipState; readonly text: string } {
  const f = tree.freshness;
  const aged = (ms: number): string => formatAge(Math.floor((ms + Math.max(0, now - receivedAt)) / 1000));
  const okAge = f.stamp === null || f.stamp.okAgeMs === null ? DOCS_HEAD_TEXT.freshNeverGood : aged(f.stamp.okAgeMs);
  if (f.remote === null) return { state: 'none', text: DOCS_HEAD_TEXT.freshNone };
  switch (freshness.s) {
    case 'fetching':
      return { state: 'fetching', text: DOCS_HEAD_TEXT.freshFetching };
    case 'stale-lock':
      return {
        state: 'failed',
        text: freshness.ref === null ? DOCS_HEAD_TEXT.freshStaleLockUnnamed : fillSentence(DOCS_HEAD_TEXT.freshStaleLock, { ref: freshness.ref }),
      };
    case 'relist-failed':
      return { state: 'failed', text: fillSentence(DOCS_HEAD_TEXT.freshRelistFailed, { sentence: notOkSentence(freshness.answer) }) };
    case 'refresh-failed':
      return { state: 'failed', text: fillSentence(DOCS_HEAD_TEXT.freshRefreshFailed, { sentence: notOkSentence(freshness.answer) }) };
    case 'soon':
    case 'answered': {
      const until = soonUntil(freshness);
      if (until !== null) {
        // The wait is over (now >= until): nothing is due and nothing is pending, so the chip is what it would be with
        // no `soon` at all, the stamp's. Before then `n` is at least 1, so it never reads "again in 0s".
        if (now < until) return { state: 'soon', text: fillSentence(DOCS_HEAD_TEXT.freshSoon, { n: Math.ceil((until - now) / 1000) }) };
        break;
      }
      if (freshness.s !== 'answered') break;
      if (freshness.fetch.state === 'skipped') return { state: 'local', text: DOCS_HEAD_TEXT.freshLocalRef };
      // The same word the stamp path maps to `local`: the repository has no such branch on origin, which is not a failure.
      if (freshness.fetch.state === 'failed' && freshness.fetch.failure.failure === 'remote-branch-absent') {
        return { state: 'local', text: DOCS_HEAD_TEXT.freshLocalOnly };
      }
      if (freshness.fetch.state === 'failed') {
        const age = formatAge(Math.floor(Math.max(0, now - freshness.at) / 1000));
        return {
          state: 'failed',
          text: fillSentence(DOCS_HEAD_TEXT.freshFailed, { age, sentence: failureSentence(freshness.fetch.failure), okAge }),
        };
      }
      break;
    }
    case 'idle':
      break;
  }
  const stamp = f.stamp;
  if (stamp === null) return { state: 'never', text: DOCS_HEAD_TEXT.freshNever };
  if (stamp.lastOutcome === 'ok') return { state: 'ok', text: fillSentence(DOCS_HEAD_TEXT.freshOk, { age: aged(stamp.attemptAgeMs) }) };
  if (stamp.lastOutcome === 'remote-branch-absent') return { state: 'local', text: DOCS_HEAD_TEXT.freshLocalOnly };
  const sentence = failureSentence({ ok: false, failure: stamp.lastOutcome });
  return { state: 'failed', text: fillSentence(DOCS_HEAD_TEXT.freshFailed, { age: aged(stamp.attemptAgeMs), sentence, okAge }) };
}

/** The compact head's width (phone-header refinement (b)): under 600 CSS px, the compact window class. A leaf page draws one row there
 *  (`CompactHead`); a tablet, a desktop, and every other page at any width keep the header as it was. Spelled once, here:
 *  docs.css keys the row's rules on its own classes, never on a width (docs-compact-css.test.ts holds that half; docs-compact-head.test.tsx
 *  holds the other, that DocsHead.tsx alone spells it under pwa/src). */
export const DOCS_COMPACT_QUERY = '(max-width: 599.98px)';

/** A touch screen's pointer: no hover, so a `title` is never seen (review 1697 F5). */
const COARSE_POINTER_QUERY = '(pointer: coarse)';

/** Which header a page draws. */
export type HeadLayout = 'full' | 'compact';

/** The header for `page` (phone-header refinement (a)): the compact row on a leaf page at the compact width, else the full header. A
 *  directory (its URL ends in `/`), a section, a project and the index keep the full header at every width. */
export function headLayoutFor(compactWidth: boolean, page: DocsPageLocation): HeadLayout {
  return compactWidth && page.kind === 'path' && !page.dirSlash ? 'compact' : 'full';
}

/** How the full header is drawn (desk-nav Part B, D-8101; fix round 1, F2(b)): at 600 CSS px and wider, the desk head's
 *  one row and dense line (`row`); under the compact width, where only a listing or the index draws the full header,
 *  the stacked header main drew (`stacked`): the crumbs row, the truth line, then the actions in words. Part B is the
 *  head at 600 px and wider, so below it nothing changes. */
export type FullHeadForm = 'row' | 'stacked';

export function fullHeadFormFor(compactWidth: boolean): FullHeadForm {
  return compactWidth ? 'stacked' : 'row';
}

/** The Page details button's dot (phone-header refinement (f)), from the freshness chip's state: `ok` a good fetch, `warn`
 *  never fetched, `failed` a failed fetch, re-list or refresh, or a stale lock. `warn` and `failed` draw the same
 *  attention colour, as the picked mockup does; the button's name tells them apart. `null` has one meaning: no dot (no
 *  origin, a local ref, a fetch in flight, a `soon` wait), where the chip itself says nothing a glance must catch. */
export type FreshDot = 'ok' | 'warn' | 'failed' | null;

export function freshDot(state: FreshChipState): FreshDot {
  return state === 'ok' ? 'ok' : state === 'never' ? 'warn' : state === 'failed' ? 'failed' : null;
}

/** Share's words (spec 4.5): "Share", or "Updating to <short>…" while the leaf moves to `pinFor`'s pin. The full header's
 *  button reads them; the compact row's icon takes them as its accessible name (phone-header refinement (e)). */
function shareWords(share: Exclude<ShareState, { s: 'absent' }>): string {
  return share.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(share.to) }) : DOCS_HEAD_TEXT.share;
}

/** Export's words (spec 4.17): "Export", "Export (plain view)", "Updating to <short>…" or why it waits. As for Share's. */
function exportWords(state: Exclude<ExportState, { s: 'absent' }>): string {
  return state.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(state.to) })
    : state.s === 'waiting' ? EXPORT_WAIT_TEXT[state.why]
      : state.s === 'plain-view' ? DOCS_HEAD_TEXT.exportPlainView : DOCS_HEAD_TEXT.export;
}

/** The crumbs (spec 4.4's layout): every crumb on a desktop; on a phone (under 900 px) the last two behind a leading
 *  `…` button, which shows them all. The last crumb is the page itself. `unfold`: every crumb at any width, with no `…`
 *  button (the compact head's panel, phone-header refinement (c)). `fold`: the last two behind `…` at a desk width too,
 *  when the desk row has no room for every crumb (desk-nav Part B, fix round 2: `HeadRow`). `--docs-crumbs-n` is the
 *  number of crumbs drawn, the `…` button counted, which docs.css's desk row reads for the crumbs' floor. A list the user
 *  unfolded with `…` is marked `data-unfolded`, and docs.css's desk row wraps it rather than clip its start (review 1704
 *  F1), as the compact head's panel does. */
function Crumbs(p: { readonly crumbs: readonly DocsCrumb[]; readonly unfold?: boolean; readonly fold?: boolean }): ReactNode {
  const desktop = useMediaQuery(DESK_QUERY);
  const [whole, setWhole] = useState(false);
  const folded = p.unfold !== true && (!desktop || p.fold === true) && !whole && p.crumbs.length > 2;
  const shown = folded ? p.crumbs.slice(-2) : p.crumbs;
  const drawn = { '--docs-crumbs-n': shown.length + (folded ? 1 : 0) } as CSSProperties;
  return (
    <nav className="docs-crumbs" aria-label={DOCS_HEAD_TEXT.crumbs} style={drawn} data-unfolded={whole ? '' : undefined}>
      <ol>
        {folded && (
          <li>
            <button type="button" className="docs-crumbs-more" aria-label={DOCS_HEAD_TEXT.crumbsMore} onClick={() => setWhole(true)}>
              …
            </button>
          </li>
        )}
        {shown.map((c, i) => (
          <li key={c.href}>
            {i === shown.length - 1
              ? <span className="docs-crumb-here" aria-current="page" title={c.label}>{c.label}</span>
              : <DocsPageLink className="docs-crumb" href={c.href} title={c.label}>{c.label}</DocsPageLink>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** "copy commit" (spec 4.5): the FULL commit, through `copyText`, the one clipboard writer under `pwa/src/docs`. */
function CopyCommit(p: { readonly commit: string }): ReactNode {
  const [said, setSaid] = useState<'copied' | 'failed' | null>(null);
  const onClick = (): void => {
    setSaid(null);
    void copyText(p.commit).then(() => setSaid('copied'), () => setSaid('failed'));
  };
  return (
    <>
      <button type="button" className="docs-copy" onClick={onClick}>{DOCS_HEAD_TEXT.copyCommit}</button>
      {said !== null && (
        <span className="docs-copy-said" role="status">{said === 'copied' ? DOCS_HEAD_TEXT.copied : DOCS_HEAD_TEXT.copyFailed}</span>
      )}
    </>
  );
}

/** The freshness chip: a `<button>` whose tap is one manual refresh, disabled while one runs; static text when the
 *  repository has no origin. */
function FreshChip(p: { readonly chip: ReturnType<typeof freshnessChip>; readonly onRefresh: () => void }): ReactNode {
  const { chip } = p;
  if (chip.state === 'none') return <span className="docs-fresh" data-state="none">{chip.text}</span>;
  return (
    <button type="button" className="docs-fresh" data-state={chip.state} disabled={chip.state === 'fetching'} onClick={p.onRefresh}>
      {chip.text}
    </button>
  );
}

/** The truth line (spec 4.5), facts inline joined by ` · `. */
function TruthLine(p: {
  readonly page: TreePage; readonly visit: DocsVisit; readonly tree: DocsTreeOk; readonly receivedAt: number;
  readonly now: number;
}): ReactNode {
  const { page, visit, tree } = p;
  const ref = tree.ref;
  const withRelation = ref.via === 'local' || ref.via === 'origin' || ref.via === 'qualified';
  const c = ref.counterpart;
  // ccd counts from the SERVED side (`ahead`: the served ref's lead over the counterpart), but the sentences speak of
  // LOCAL against origin. So when origin is served the two numbers trade places: `{ahead}` is always local's lead.
  const counts: Record<string, number> = {};
  const localLead = c === null ? null : ref.side === 'origin' ? c.behind : c.ahead;
  const originLead = c === null ? null : ref.side === 'origin' ? c.ahead : c.behind;
  // How the ref was chosen. The desk line may cut it to an ellipsis (desk-nav Part B, fix round 1, F2), so its title
  // carries the whole sentence.
  const via = fillSentence(VIA_SENTENCE[ref.via], ref.requested === null ? {} : { requested: ref.requested });
  if (localLead !== null) counts['ahead'] = localLead;
  if (originLead !== null) counts['behind'] = originLead;
  let leaf: ReactNode = null;
  if (page.kind === 'path') {
    const k = docsPathKind(tree, page.section, page.path, modeOf(page));
    if (k.kind === 'leaf') {
      const file = visit.file;
      const opened = openedPin(tree, page, file);
      const s = leafSource(tree, page, opened);
      const source = s.kind === 'draft'
        ? (
          <span className="docs-truth-source" title={s.worktreePath ?? undefined}>
            {s.badge === null ? DOCS_HEAD_TEXT.sourceDraftUnbadged : <span className="docs-badge">{ENTRY_BADGE_TEXT[s.badge]}</span>}
            {fillSentence(SOURCE_DRAFT_TAIL, { label: s.label })}
          </span>
        )
        : <span className="docs-truth-source">{truthSource(tree, page, opened)}</span>;
      leaf = (
        <>
          {SEP}{source}
          {k.view.badge !== null && s.kind !== 'draft' && <>{SEP}<span className="docs-badge">{ENTRY_BADGE_TEXT[k.view.badge]}</span></>}
          {file.s === 'ok' && <>{SEP}<span className="docs-truth-size">{kib(file.answer.show.size)}</span></>}
        </>
      );
    }
  }
  return (
    <p className="docs-truth">
      <span className="docs-truth-ref" title={ref.served}>{servedRefText(ref)}</span>{SEP}
      <code className="docs-truth-commit" title={ref.commit}>{shortCommit(ref.commit)}</code>{' '}
      <CopyCommit key={ref.commit} commit={ref.commit} />{SEP}
      <span className="docs-truth-via" title={via}>{via}</span>
      {withRelation && (
        <>
          {SEP}
          <span className="docs-truth-relation" data-tone={ref.relation === 'diverged' ? 'warn' : 'info'}>
            {fillSentence(relationSentence(ref.relation, ref.side, counts), counts)}
          </span>
        </>
      )}
      {ref.tried[0]?.result === 'dangling' && <>{SEP}<span className="docs-truth-dangling">{DOCS_HEAD_TEXT.danglingHead}</span></>}
      {leaf}
      {SEP}
      <FreshChip chip={freshnessChip(tree, p.receivedAt, visit.freshness, p.now)} onRefresh={visit.refreshManual} />
    </p>
  );
}

/** An action's face in the full head's row (desk-nav Part B, D-8101): its icon, then its words in `.docs-action-words`,
 *  which docs.css hides when `HeadRow` asks (and under the `docs-head` container query); the control's name is set
 *  beside it, so it is kept. */
function RowFace(p: { readonly icon: 'folder-code' | 'share' | 'download' | 'file-text'; readonly words: string }): ReactNode {
  return <><Icon name={p.icon} size={16} /><span className="docs-action-words">{p.words}</span></>;
}

/** View on GitHub (spec 3.11, opened with `openExternal` on tap), with its may-differ note, or its refusal in words.
 *  `showsDraft`: the leaf shows draft bytes, which GitHub never has, so the note stands whatever the ref's relation.
 *  `row`: the full head's form (desk-nav Part B): the icon and "GitHub", named "View on GitHub". There the note is a
 *  marker (`≠`) that takes no room from the crumbs (fix round 1, F1): its words are its `title`, a screen reader's
 *  text inside it, and the link's accessible description. Under a coarse pointer, which has no hover to show a
 *  `title`, the row's note draws its words instead (review 1697 F5; Task C16, D-8139). */
function GithubAction(p: {
  readonly tree: DocsTreeOk; readonly target: GithubTarget; readonly showsDraft: boolean; readonly row?: boolean;
}): ReactNode {
  const noteId = useId();
  const coarse = useMediaQuery(COARSE_POINTER_QUERY);
  const link = githubBlobUrl(p.tree.github, p.tree.ref, p.target);
  const row = p.row === true;
  if (!link.ok) {
    // The row may cut the refusal to an ellipsis (fix round 1, F5), so there its title carries the whole sentence.
    const off = fillSentence(DOCS_HEAD_TEXT.githubOff, { reason: GITHUB_REFUSAL_TEXT[link.why] });
    return <span className="docs-action-off" title={row ? off : undefined}>{off}</span>;
  }
  const noted = link.note === 'may-differ' || p.showsDraft;
  return (
    <>
      <a
        className="docs-action" href={link.url} target="_blank" rel="noopener noreferrer" onClick={(e) => openExternal(e, link.url)}
        aria-label={row ? DOCS_HEAD_TEXT.github : undefined} aria-describedby={row && noted ? noteId : undefined}
      >
        {row ? <RowFace icon="folder-code" words={DOCS_HEAD_TEXT.githubShort} /> : DOCS_HEAD_TEXT.github}
      </a>
      {noted && (row && !coarse
        ? (
          <span id={noteId} className="docs-action-note" title={DOCS_HEAD_TEXT.githubMayDiffer}>
            <span aria-hidden="true">≠</span><span className="sr-only">{DOCS_HEAD_TEXT.githubMayDiffer}</span>
          </span>
        )
        : <span id={row ? noteId : undefined} className="docs-action-note">{DOCS_HEAD_TEXT.githubMayDiffer}</span>)}
    </>
  );
}

/** Whether `store` has settled, re-read whenever it changes (its store-wide `subscribe()`); no store reads settled. */
function useStoreSettled(store: HighlightStore | null): boolean {
  const subscribe = useMemo(() => (store === null ? NO_SUBSCRIPTION : store.subscribe()), [store]);
  const read = (): boolean => store === null || store.settled();
  return useSyncExternalStore(subscribe, read, read);
}

/** Re-renders the caller whenever the image registry changes. */
function useAssetsVersion(assets: ExportAssets | null): number {
  const read = (): number => (assets === null ? 0 : assets.version());
  return useSyncExternalStore(assets === null ? NO_SUBSCRIPTION : assets.subscribe, read, read);
}

/** What an open export sheet is about (refinement (u)): the page, the commit its tree serves, and the pin it exports.
 *  `ExportAction` is keyed by it, so a re-list or a back gesture closes the sheet. The `export` prefix keeps it from
 *  ever equalling `shareKeyOf`'s key: both are siblings, and an `updating` pair would otherwise collide. */
function exportKeyOf(page: Leaf, tree: DocsTreeOk, state: Exclude<ExportState, { s: 'absent' }>): string {
  const shows = state.s === 'ready' ? docsApi.file(page.project, state.source.pin) : state.s;
  return ['export', docsPageUrl(page), tree.ref.commit, shows].join('\u0000');
}

/** Export (spec 4.17), after Share on a leaf. Ready: a tap opens the sheet over the request captured now. Plain view: a
 *  tap turns the reader off on this page (refinement (a)). Otherwise disabled, reading why; its accessible name then
 *  says it is Export's ("Export: <why>"), so it never shares a name with Share's own "Updating to <short>…". */
function ExportAction(p: {
  readonly page: Leaf; readonly tree: DocsTreeOk; readonly state: Exclude<ExportState, { s: 'absent' }>;
  readonly assets: ExportAssets | null; readonly readAt: number | null; readonly onPlainView: (() => void) | null;
  /** The compact row's form (phone-header refinement (e)): an icon, its words the accessible name. */
  readonly glyph?: boolean;
  /** The full head's form (desk-nav Part B): an icon beside its words, named as the words form is. */
  readonly row?: boolean;
}): ReactNode {
  const { page, tree, state } = p;
  const [request, setRequest] = useState<ExportRequest | null>(null);
  const words = exportWords(state);
  const busy = state.s === 'updating' || state.s === 'waiting';
  const enabled = state.s === 'ready' || (state.s === 'plain-view' && p.onPlainView !== null);
  const onClick = (): void => {
    if (state.s === 'plain-view') p.onPlainView?.();
    else if (state.s === 'ready') setRequest({ page, tree, source: state.source, assets: p.assets, readAt: p.readAt });
  };
  return (
    <>
      <button
        type="button" className="docs-action docs-export" disabled={!enabled} onClick={onClick}
        aria-label={busy ? fillSentence(DOCS_HEAD_TEXT.exportBusy, { state: words }) : p.glyph === true || p.row === true ? words : undefined}
      >
        {p.glyph === true ? <Icon name="download" size={20} /> : p.row === true ? <RowFace icon="download" words={words} /> : words}
      </button>
      {request !== null && <ExportSheet request={request} onClose={() => setRequest(null)} />}
    </>
  );
}

/** What an open share sheet is about (refinement (n)): the page, the commit its tree serves, and what the leaf opened.
 *  `ShareAction` is keyed by it, so a sheet left open closes when any of them changes, rather than name a page the
 *  screen no longer shows. */
function shareKeyOf(page: TreePage, tree: DocsTreeOk, share: Exclude<ShareState, { s: 'absent' }>): string {
  const opened = share.s === 'updating' ? 'updating'
    : share.opened.kind === 'none' ? 'none' : docsApi.file(page.project, share.opened.pin);
  return [docsPageUrl(page), tree.ref.commit, opened].join('\u0000');
}

/** Share (spec 4.5, 4.16), after View on GitHub: disabled, reading "Updating to <short>…", while the leaf does not show
 *  `pinFor`'s pin; otherwise a tap opens the sheet over `shareTargetFor`'s answer for what the page opened, worked out
 *  while the sheet is open. */
function ShareAction(p: {
  readonly page: TreePage; readonly tree: DocsTreeOk; readonly share: Exclude<ShareState, { s: 'absent' }>; readonly exportOffered: boolean;
  /** The compact row's form (phone-header refinement (e)): an icon, its words the accessible name ("Share: <words>" while
   *  it waits, as Export's is, since nothing visible says Share). */
  readonly glyph?: boolean;
  /** The full head's form (desk-nav Part B): an icon beside its words, named as the compact form is, so a waiting Share
   *  is "Share: <words>" whether or not its words show (fix round 1, F4). */
  readonly row?: boolean;
}): ReactNode {
  const { page, tree, share } = p;
  const [open, setOpen] = useState(false);
  const target = open && share.s === 'ready' ? shareTargetFor(tree, page, share.opened) : null;
  const words = shareWords(share);
  return (
    <>
      <button
        type="button" className="docs-action docs-share" disabled={share.s === 'updating'} onClick={() => setOpen(true)}
        aria-label={p.glyph !== true && p.row !== true ? undefined : share.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareBusy, { state: words }) : words}
      >
        {p.glyph === true ? <Icon name="share" size={20} /> : p.row === true ? <RowFace icon="share" words={words} /> : words}
      </button>
      {/* Whether this page offers Export (spec 4.17): the refusals that take Export's clause then carry it (spec 4.16). */}
      {target !== null && <ShareSheet target={target} exportOffered={p.exportOffered} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The actions (spec 4.5): View on GitHub; Share (spec 4.16), wherever `shareStateFor` offers it; and Open committed
 *  version, offered iff `entryView(...).offersCommitted` on a leaf not already at `view=committed`. Open committed
 *  version navigates with a history entry (URL state, so Back returns to the draft); the commit never enters the URL,
 *  it is resolved from this visit's tree. Export (spec 4.17) follows Share on a leaf. The full head draws them in its
 *  row (desk-nav Part B, D-8101): GitHub, Share, Export and Open committed version each an icon beside its words. */
function Actions(p: ActionInputs & { readonly form: FullHeadForm }): ReactNode {
  const { page, tree, file } = p;
  const row = p.form === 'row';
  const { target, showsDraft, share, exported, committedHref } = useHeadActions(p);
  if (target === null && committedHref === null) return null;
  return (
    <div className="docs-actions">
      {target !== null && <GithubAction tree={tree} target={target} showsDraft={showsDraft} row={row} />}
      {share.s !== 'absent' && (
        <ShareAction key={shareKeyOf(page, tree, share)} page={page} tree={tree} share={share} exportOffered={exported.s !== 'absent'} row={row} />
      )}
      {exported.s !== 'absent' && page.kind === 'path' && (
        <ExportAction
          key={exportKeyOf(page, tree, exported)} page={page} tree={tree} state={exported} assets={p.exportAssets}
          readAt={file.s === 'ok' ? file.receivedAt : null} onPlainView={p.onPlainView} row={row}
        />
      )}
      {committedHref !== null && (row
        ? (
          <DocsPageLink className="docs-action" href={committedHref} label={DOCS_HEAD_TEXT.openCommitted}>
            <RowFace icon="file-text" words={DOCS_HEAD_TEXT.openCommitted} />
          </DocsPageLink>
        )
        : <DocsPageLink className="docs-action" href={committedHref}>{DOCS_HEAD_TEXT.openCommitted}</DocsPageLink>)}
    </div>
  );
}

/** What the actions read: the page, its tree and file slot, and Export's inputs. */
interface ActionInputs {
  readonly page: TreePage; readonly tree: DocsTreeOk; readonly file: DocsVisit['file']; readonly leafImage: DocPin | null;
  readonly exportBody: ExportBody | null; readonly pageStore: HighlightStore | null; readonly exportAssets: ExportAssets | null;
  readonly onPlainView: (() => void) | null;
}

/** The actions on a page, worked out once for either header (phone-header refinement (e)): View on GitHub's target (`null`: none),
 *  whether the leaf shows draft bytes, Share's and Export's states, and Open committed version's href (`null`: not
 *  offered). The full header draws all of them in one line; the compact row draws Share and Export, and its panel the
 *  two links. */
interface HeadActions {
  readonly target: GithubTarget | null;
  readonly showsDraft: boolean;
  readonly share: ShareState;
  readonly exported: ExportState;
  readonly committedHref: string | null;
}

function useHeadActions(p: ActionInputs): HeadActions {
  const { page, tree, file } = p;
  const target = githubTargetFor(page, tree);
  const showsDraft = page.kind === 'path' && openedPin(tree, page, file)?.kind === 'draft';
  const share = shareStateFor(page, tree, file, p.leafImage);
  const settled = useStoreSettled(p.pageStore);
  useAssetsVersion(p.exportAssets);
  const exported = exportStateFor(page, tree, file, { body: p.exportBody, store: p.pageStore, settled, assets: p.exportAssets });
  let committedHref: string | null = null;
  if (page.kind === 'path' && page.view !== 'committed') {
    const k = docsPathKind(tree, page.section, page.path, modeOf(page));
    if (k.kind === 'leaf' && k.view.offersCommitted) {
      const to = { kind: 'path', section: page.section, path: page.path, dirSlash: false, view: 'committed' } as const;
      committedHref = docsPageUrl(docsLocation(page, to));
    }
  }
  return { target, showsDraft, share, exported, committedHref };
}

/** The Docs header. `tree` null has one meaning: the visit's tree slot is not `ok` (loading, failed, or the page names
 *  no project), so the header is back and the crumbs only (spec 4.7: a tree failure keeps the crumbs). */
export function DocsHead(p: {
  readonly page: DocsPageLocation; readonly visit: DocsVisit; readonly tree: DocsTreeOk | null;
  /** The pin a raster leaf's own image settled at (`DocsScreen`'s); absent or `null`, none has. */
  readonly leafImage?: DocPin | null;
  /** What the leaf's body shows, published for Export (`docs/exportBody.ts`); absent or `null`: nothing yet. */
  readonly exportBody?: ExportBody | null;
  /** The page's or text leaf's highlight store (W5h-a's `publish` slot); absent or `null`: none published. */
  readonly pageStore?: HighlightStore | null;
  /** The visit's image registry (refinement (g)); absent or `null`: none. */
  readonly exportAssets?: ExportAssets | null;
  /** The reader is off on this page, so Export can save the plain view (refinement (a)). */
  readonly plainView?: boolean;
  /** Turns the reader off on this page (refinement (a)); absent or `null`: the screen offers no plain view. */
  readonly onPlainView?: (() => void) | null;
}): ReactNode {
  const { page, visit, tree } = p;
  const slow = useNow(30_000, tree !== null);
  // While the chip is `soon` it counts seconds: a 1 s tick re-renders, and the figure is read from the clock at render
  // (never from the last tick), so an answer that lands between two 30 s ticks does not overstate the wait. The tick
  // runs only while `Date.now() < until`: the one that lands at or past `until` renders the stamp (`freshnessChip`)
  // and, `active` being false from then on, is the last, so a chip never sits on "again in 0s".
  const until = soonUntil(visit.freshness);
  useNow(1000, tree !== null && until !== null && Date.now() < until);
  const now = until === null ? slow : Date.now();
  const crumbs = docsCrumbs(page);
  const slot = visit.tree;
  const receivedAt = slot?.s === 'ok' ? slot.receivedAt : now;
  const compactWidth = useMediaQuery(DOCS_COMPACT_QUERY);
  // Phone-header refinement (a): a leaf page at the compact width draws one row. Keyed by the page, so a navigation closes its panel.
  if (headLayoutFor(compactWidth, page) === 'compact' && page.kind === 'path') {
    return (
      <CompactHead
        key={docsPageUrl(page)} page={page} visit={visit} tree={tree} receivedAt={receivedAt} now={now} crumbs={crumbs}
        leafImage={p.leafImage ?? null} exportBody={p.exportBody ?? null} pageStore={p.pageStore ?? null}
        exportAssets={p.exportAssets ?? null} plainView={p.plainView === true} onPlainView={p.onPlainView ?? null}
      />
    );
  }
  // The full head (desk-nav Part B, D-8101): one row of back, the crumbs and the actions, then the truth line as one dense
  // line, then the plain-view note and "Updated to". `docs-full` scopes docs.css's row and dense-line rules to this head,
  // so the compact head's panel, which draws the same truth line and link actions, keeps its own layout. Under the
  // compact width a listing keeps the stacked header main drew (fix round 1, F2(b)).
  const listed = tree !== null && page.kind !== 'index' ? { tree, page } : null;
  const actionInputs = {
    file: visit.file, leafImage: p.leafImage ?? null, exportBody: p.exportBody ?? null, pageStore: p.pageStore ?? null,
    exportAssets: p.exportAssets ?? null, onPlainView: p.onPlainView ?? null,
  };
  if (fullHeadFormFor(compactWidth) === 'stacked') {
    return (
      <header className="docs-head">
        <div className="docs-head-bar">
          <BackButton page={page} />
          <Crumbs key={crumbs.at(-1)?.href} crumbs={crumbs} />
        </div>
        {listed !== null && (
          <>
            <TruthLine page={listed.page} visit={visit} tree={listed.tree} receivedAt={receivedAt} now={now} />
            <Actions form="stacked" page={listed.page} tree={listed.tree} {...actionInputs} />
            {p.plainView === true && <p className="docs-note" role="status">{DOCS_HEAD_TEXT.exportPlainShown}</p>}
          </>
        )}
        {visit.updatedTo !== null && (
          <p className="docs-updated" role="status">{fillSentence(DOCS_HEAD_TEXT.updatedTo, { short: shortCommit(visit.updatedTo) })}</p>
        )}
      </header>
    );
  }
  return (
    <header className="docs-head docs-full">
      <HeadRow page={page} crumbs={crumbs} listed={listed} actionInputs={actionInputs} />
      {listed !== null && (
        <>
          <TruthLine page={listed.page} visit={visit} tree={listed.tree} receivedAt={receivedAt} now={now} />
          {p.plainView === true && <p className="docs-note" role="status">{DOCS_HEAD_TEXT.exportPlainShown}</p>}
        </>
      )}
      {visit.updatedTo !== null && (
        <p className="docs-updated" role="status">{fillSentence(DOCS_HEAD_TEXT.updatedTo, { short: shortCommit(visit.updatedTo) })}</p>
      )}
    </header>
  );
}

/** How far the desk row has given way (desk-nav Part B, fix round 2, D-8101): 0, every crumb and the action words; 1,
 *  every crumb and the actions as icons; 2, the actions as icons and the middle crumbs folded behind `…`. Past 2,
 *  docs.css gives way: the page's name shortens to its floor, and only then do the actions wrap onto a second line. */
type RowStage = 0 | 1 | 2;

/** Whether the page's name is cut by a fraction of a pixel, which still draws its ellipsis while the integer
 *  `scrollWidth` and `clientWidth` agree: its text's own width against its box's. Unmeasurable (no Range geometry): not. */
function nameCut(here: HTMLElement): boolean {
  const text = document.createRange();
  text.selectNodeContents(here);
  if (typeof text.getBoundingClientRect !== 'function') return false;
  return text.getBoundingClientRect().width > here.getBoundingClientRect().width + 0.01;
}

/** Whether the row, as now laid out, shows the page's whole name, every drawn crumb whole inside the crumbs' box (none
 *  clipped at the start), and the actions on the crumbs' line. A row not laid out (no box: jsdom, a hidden head) fits. */
function rowFits(row: HTMLElement): boolean {
  const nav = row.querySelector<HTMLElement>('.docs-crumbs');
  const here = nav?.querySelector<HTMLElement>('.docs-crumb-here');
  if (nav === null || nav === undefined || here === null || here === undefined) return true;
  const box = nav.getBoundingClientRect();
  if (box.height === 0) return true;
  if (here.scrollWidth > here.clientWidth || nameCut(here)) return false;
  for (const li of nav.querySelectorAll('li')) {
    const b = li.getBoundingClientRect();
    if (b.left < box.left - 0.5 || b.right > box.right + 0.5) return false;
  }
  const actions = row.querySelector('.docs-actions');
  return actions === null || actions.getBoundingClientRect().top < box.bottom - 0.5;
}

/** The stage the row at `ref` stands at: the first of 0, 1 and 2 that fits (`rowFits`), re-measured from 0 whenever the
 *  row's width changes, its contents change outside the crumbs (an action's words, a navigation, the tree arriving) or
 *  a font loads. Each try renders synchronously (`flushSync`) from the observer's callback, so a stage that does not fit
 *  is never painted, and starting from 0 every time makes the stage a function of the width and the words alone, so a
 *  wider row never stands further on than a narrower one. Changes inside the crumbs are the fold's own and are not
 *  watched. With no ResizeObserver (jsdom) the row stays at 0. */
function useRowStage(ref: { readonly current: HTMLElement | null }): RowStage {
  const [stage, setStage] = useState<RowStage>(0);
  useLayoutEffect(() => {
    const row = ref.current;
    if (row === null || typeof ResizeObserver === 'undefined') return;
    const probe = (): void => {
      for (const s of [0, 1, 2] as const) {
        flushSync(() => setStage(s));
        if (s === 2 || rowFits(row)) return;
      }
    };
    let width = -1;
    const resized = new ResizeObserver(() => {
      if (row.clientWidth === width) return;
      width = row.clientWidth;
      probe();
    });
    const changed = new MutationObserver((records) => {
      const nav = row.querySelector('.docs-crumbs');
      if (records.some((r) => nav === null || !nav.contains(r.target))) probe();
    });
    resized.observe(row);
    changed.observe(row, { childList: true, subtree: true, characterData: true });
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    fonts?.addEventListener?.('loadingdone', probe);
    return () => {
      resized.disconnect();
      changed.disconnect();
      fonts?.removeEventListener?.('loadingdone', probe);
    };
  }, [ref]);
  return stage;
}

/** The full head's row (desk-nav Part B, D-8101): back, the crumbs and the actions. When the row is short it gives way in
 *  the order fix round 2 ruled: the action words hide first (each icon keeps its name and `title`), then the middle
 *  crumbs fold behind `…` (`useRowStage`); then the page's name shortens to its floor, and only then do the actions wrap
 *  onto a second line (docs.css). */
function HeadRow(p: {
  readonly page: DocsPageLocation; readonly crumbs: readonly DocsCrumb[];
  readonly listed: { readonly tree: DocsTreeOk; readonly page: TreePage } | null;
  readonly actionInputs: Omit<ActionInputs, 'page' | 'tree'>;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const stage = useRowStage(ref);
  return (
    <div className="docs-head-bar" ref={ref} data-words={stage === 0 ? undefined : 'off'}>
      <BackButton page={p.page} />
      <Crumbs key={p.crumbs.at(-1)?.href} crumbs={p.crumbs} fold={stage === 2} />
      {p.listed !== null && <Actions form="row" page={p.listed.page} tree={p.listed.tree} {...p.actionInputs} />}
    </div>
  );
}

/** Back (spec 4.4: up one level, never `history.back()`), the one control both headers draw. The index's up door goes to
 *  the fleet: it is the `go-fleet` door there (W2 Task S5), and only there. */
function BackButton(p: { readonly page: DocsPageLocation }): ReactNode {
  const up = docsUpHref(p.page);
  return (
    <button
      type="button"
      className="docs-back"
      aria-label={DOCS_HEAD_TEXT.back}
      onClick={() => navigate(up)}
      {...(up === '/' ? doorMark('go-fleet') : {})}
    >
      ‹
    </button>
  );
}

/** The compact row's draft word (phone-header refinement (g)): the word, and the form, the truth line draws for this leaf, so the
 *  row follows the one source (M4.T7, one badge function). `entryView`'s badge through `ENTRY_BADGE_TEXT` is drawn as a
 *  `.docs-badge` (`badged`); for a draft whose entry no longer opens one (the pin outlived a re-list) the truth line draws
 *  `DOCS_HEAD_TEXT.sourceDraftUnbadged` as plain text, and so does the row (`badged` false). `null` when the truth line draws
 *  no draft word. */
interface RowBadge { readonly word: string; readonly badged: boolean }
function rowBadge(tree: DocsTreeOk, page: Leaf, file: DocsVisit['file']): RowBadge | null {
  const k = docsPathKind(tree, page.section, page.path, modeOf(page));
  if (k.kind !== 'leaf') return null;
  const s = leafSource(tree, page, openedPin(tree, page, file));
  if (s.kind === 'draft') return { word: badgeText(s.badge), badged: s.badge !== null };
  return k.view.badge === null ? null : { word: ENTRY_BADGE_TEXT[k.view.badge], badged: true };
}

/** The compact row's two lines (phone-header refinements (c), (g)): where the page is over its name. The first line is the
 *  parent crumb and, when one is shown, the served ref, joined by ` · ` (the ref's own span holds the separator), each its
 *  own text that ends in an ellipsis and the crumb the one that gives way first, so a long parent directory never hides
 *  which ref is served; the draft badge follows as a sibling, so a long ref is cut and the badge never is. Text, not
 *  links: back goes up one level, and the whole path is the panel's first line. */
function CompactLabel(p: {
  readonly where: string; readonly name: string; readonly refText: string | null; readonly badge: RowBadge | null;
}): ReactNode {
  return (
    <p className="docs-compact-label">
      <span className="docs-compact-where">
        <span className="docs-compact-where-text">
          <span className="docs-compact-where-crumb">{p.where}</span>
          {p.refText !== null && <span className="docs-compact-where-ref">{SEP}{p.refText}</span>}
        </span>
        {p.badge !== null && <>{SEP}{p.badge.badged ? <span className="docs-badge">{p.badge.word}</span> : p.badge.word}</>}
      </span>
      <span className="docs-compact-name">{p.name}</span>
    </p>
  );
}

/** The served ref the row names (phone-header refinement (g)): a ref the page asked for, a local side, or any default
 *  that is not origin/HEAD (a local main or master, or origin's main or master when origin/HEAD is unset or dangling,
 *  `ccd/ccd#default_chain`). The usual default view, origin/HEAD resolved, adds nothing. */
function rowRefText(page: Leaf, tree: DocsTreeOk): string | null {
  const ref = tree.ref;
  return page.ref !== null || ref.side === 'local' || ref.via !== 'default:origin-head' ? servedRefText(ref) : null;
}

/** What the compact head is given: the full header's inputs, settled (phone-header refinement (a)). */
interface CompactProps {
  readonly page: Leaf; readonly visit: DocsVisit; readonly receivedAt: number; readonly now: number;
  readonly crumbs: readonly DocsCrumb[]; readonly leafImage: DocPin | null; readonly exportBody: ExportBody | null;
  readonly pageStore: HighlightStore | null; readonly exportAssets: ExportAssets | null; readonly plainView: boolean;
  readonly onPlainView: (() => void) | null;
}

/** The compact head (phone-header refinements (a) to (h)): a leaf page under DOCS_COMPACT_QUERY. While the tree slot is
 *  not `ok` (loading, or failed) the head is back and the crumbs, as the full header's is (spec 4.7: a tree failure keeps
 *  the crumbs); the row and its panel need the tree. The two notes that answer a tap or a re-list (the plain view shown,
 *  Updated to) stay under the row, outside the panel, where the full header draws them. */
function CompactHead(p: CompactProps & { readonly tree: DocsTreeOk | null }): ReactNode {
  const { page, visit, tree } = p;
  const where = p.crumbs.at(-2)?.label ?? '';
  const name = p.crumbs.at(-1)?.label ?? '';
  return (
    <header className="docs-head docs-compact">
      {tree === null
        ? (
          <div className="docs-compact-crumbs">
            <BackButton page={page} />
            <Crumbs key={p.crumbs.at(-1)?.href} crumbs={p.crumbs} />
          </div>
        )
        : <CompactRow {...p} tree={tree} where={where} name={name} />}
      {p.plainView && <p className="docs-note" role="status">{DOCS_HEAD_TEXT.exportPlainShown}</p>}
      {visit.updatedTo !== null && (
        <p className="docs-updated" role="status">{fillSentence(DOCS_HEAD_TEXT.updatedTo, { short: shortCommit(visit.updatedTo) })}</p>
      )}
    </header>
  );
}

/** The compact row once the tree is `ok`, and its panel (phone-header refinements (c) to (g)). Page details is a disclosure: a button
 *  whose `aria-expanded` and `aria-controls` name the panel, a region drawn in the page's flow under the row and `hidden`
 *  while closed. Escape inside either closes it and puts focus back on the button. */
function CompactRow(p: CompactProps & { readonly tree: DocsTreeOk; readonly where: string; readonly name: string }): ReactNode {
  const { page, visit, tree } = p;
  const file = visit.file;
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { target, showsDraft, share, exported, committedHref } = useHeadActions({
    page, tree, file, leafImage: p.leafImage, exportBody: p.exportBody, pageStore: p.pageStore,
    exportAssets: p.exportAssets, onPlainView: p.onPlainView,
  });
  const dot = freshDot(freshnessChip(tree, p.receivedAt, visit.freshness, p.now).state);
  const exportNote = exported.s === 'plain-view' ? DOCS_HEAD_TEXT.exportPlainHint
    : exported.s === 'updating' || exported.s === 'waiting' ? fillSentence(DOCS_HEAD_TEXT.exportBusy, { state: exportWords(exported) })
      : null;
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    setOpen(false);
    toggle.current?.focus();
  };
  return (
    <>
      <div className="docs-compact-bar">
        <BackButton page={page} />
        <CompactLabel
          where={p.where} name={p.name} refText={rowRefText(page, tree)} badge={rowBadge(tree, page, file)}
        />
        {share.s !== 'absent' && (
          <ShareAction key={shareKeyOf(page, tree, share)} page={page} tree={tree} share={share} exportOffered={exported.s !== 'absent'} glyph />
        )}
        {exported.s !== 'absent' && (
          <ExportAction
            key={exportKeyOf(page, tree, exported)} page={page} tree={tree} state={exported} assets={p.exportAssets}
            readAt={file.s === 'ok' ? file.receivedAt : null} onPlainView={p.onPlainView} glyph
          />
        )}
        <button
          ref={toggle} type="button" className="docs-more" aria-expanded={open} aria-controls={panelId}
          aria-label={dot === 'failed' ? DOCS_HEAD_TEXT.moreFailed : dot === 'warn' ? DOCS_HEAD_TEXT.moreNever : DOCS_HEAD_TEXT.more}
          onClick={() => setOpen((o) => !o)} onKeyDown={onKeyDown}
        >
          <Icon name="ellipsis" size={20} />
          {dot !== null && <span className="docs-more-dot" data-tone={dot} aria-hidden="true" />}
        </button>
      </div>
      <div
        id={panelId} className="docs-more-panel" role="region" aria-label={DOCS_HEAD_TEXT.more} onKeyDown={onKeyDown}
        hidden={!open}
      >
        <Crumbs key={p.crumbs.at(-1)?.href} crumbs={p.crumbs} unfold />
        <TruthLine page={page} visit={visit} tree={tree} receivedAt={p.receivedAt} now={p.now} />
        {(target !== null || committedHref !== null) && (
          <div className="docs-actions">
            {target !== null && <GithubAction tree={tree} target={target} showsDraft={showsDraft} />}
            {committedHref !== null && <DocsPageLink className="docs-action" href={committedHref}>{DOCS_HEAD_TEXT.openCommitted}</DocsPageLink>}
          </div>
        )}
        {share.s === 'updating' && <p className="docs-note">{fillSentence(DOCS_HEAD_TEXT.shareBusy, { state: shareWords(share) })}</p>}
        {exportNote !== null && <p className="docs-note">{exportNote}</p>}
      </div>
    </>
  );
}
