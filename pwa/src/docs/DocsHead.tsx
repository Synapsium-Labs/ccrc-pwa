// The Docs header (spec 2026-10-01 4.4's layout, 4.5; W5 part 1 Task 10): back (up one level, never
// `history.back()`: a deep link has no history), the crumbs (on a phone the last two behind a leading `…`), the truth
// line (the served ref, the short commit with copy commit, how the ref was chosen, a leaf's source, badge and size,
// and the freshness chip), the actions (View on GitHub, Open committed version) and "Updated to <short>". A pure
// renderer of the page, the visit and the tree answer: it starts no request, and the chip's tap is the visit's
// `refreshManual`. Every draft word is `entryView`'s through `ENTRY_BADGE_TEXT`, the one badge function the rows use
// too (M4.T7). Share and Export are W5 part 2's.
import { useState, type ReactNode } from 'react';
import {
  docsPageUrl, entryView, githubBlobUrl,
  type DocPin, type DocsPageLocation, type DocsTreeOk, type EntryBadge, type EntryMode, type GithubTarget,
} from '../../../shared/docs';
import { formatAge } from '../fleet/formatReset';
import { openExternal } from '../lib/markdown';
import { navigate } from '../lib/router';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useNow } from '@ccrc/ui';
import { docsLocation } from './docsLinks';
import {
  DOCS_HEAD_TEXT, ENTRY_BADGE_TEXT, GITHUB_REFUSAL_TEXT, VIA_SENTENCE,
  failureSentence, fillSentence, kib, relationSentence, servedRefText, shortCommit, slotSentence, worktreeLabel,
} from './docsText';
import { SECTION_LABEL, docsPathKind } from './docsTree';
import { DocsPageLink } from './DocsTreeView';
import type { DocsNotOk } from './failures';
import { copyText } from './share';
import { pinFor, type DocsVisit, type Freshness } from './useDocsVisit';

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

/** What View on GitHub points at (spec 3.11, 4.4): the repository root on a project page, the section, the
 *  directory, or the leaf (`uncommitted` when its entry has no committed side). Null has one meaning: the page has no
 *  GitHub counterpart (the index, or a path this listing does not hold). */
export function githubTargetFor(page: DocsPageLocation, tree: DocsTreeOk): GithubTarget | null {
  switch (page.kind) {
    case 'index':
      return null;
    case 'project':
      return { kind: 'root' };
    case 'section':
      return { kind: 'section', section: page.section };
    case 'path': {
      const k = docsPathKind(tree, page.section, page.path, modeOf(page));
      if (k.kind === 'leaf') return { kind: 'leaf', section: page.section, path: page.path, uncommitted: k.entry.committed === null };
      return k.kind === 'dir' ? { kind: 'dir', section: page.section, path: page.path } : null;
    }
  }
}

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

/** The crumbs (spec 4.4's layout): every crumb on a desktop; on a phone (under 900 px) the last two behind a leading
 *  `…` button, which shows them all. The last crumb is the page itself. */
function Crumbs(p: { readonly crumbs: readonly DocsCrumb[] }): ReactNode {
  const desktop = useMediaQuery('(min-width: 900px)');
  const [whole, setWhole] = useState(false);
  const folded = !desktop && !whole && p.crumbs.length > 2;
  const shown = folded ? p.crumbs.slice(-2) : p.crumbs;
  return (
    <nav className="docs-crumbs" aria-label={DOCS_HEAD_TEXT.crumbs}>
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
              ? <span className="docs-crumb-here" aria-current="page">{c.label}</span>
              : <DocsPageLink className="docs-crumb" href={c.href}>{c.label}</DocsPageLink>}
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
      <span className="docs-truth-via">{fillSentence(VIA_SENTENCE[ref.via], ref.requested === null ? {} : { requested: ref.requested })}</span>
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

/** View on GitHub (spec 3.11, opened with `openExternal` on tap), with its may-differ note, or its refusal in words.
 *  `showsDraft`: the leaf shows draft bytes, which GitHub never has, so the note stands whatever the ref's relation. */
function GithubAction(p: { readonly tree: DocsTreeOk; readonly target: GithubTarget; readonly showsDraft: boolean }): ReactNode {
  const link = githubBlobUrl(p.tree.github, p.tree.ref, p.target);
  if (!link.ok) {
    return <span className="docs-action-off">{fillSentence(DOCS_HEAD_TEXT.githubOff, { reason: GITHUB_REFUSAL_TEXT[link.why] })}</span>;
  }
  return (
    <>
      <a className="docs-action" href={link.url} target="_blank" rel="noopener noreferrer" onClick={(e) => openExternal(e, link.url)}>
        {DOCS_HEAD_TEXT.github}
      </a>
      {(link.note === 'may-differ' || p.showsDraft) && <span className="docs-action-note">{DOCS_HEAD_TEXT.githubMayDiffer}</span>}
    </>
  );
}

/** The actions (spec 4.5): View on GitHub, and Open committed version, offered iff `entryView(...).offersCommitted`
 *  on a leaf not already at `view=committed`. It navigates with a history entry (URL state, so Back returns to the
 *  draft); the commit never enters the URL, it is resolved from this visit's tree. */
function Actions(p: { readonly page: TreePage; readonly tree: DocsTreeOk; readonly file: DocsVisit['file'] }): ReactNode {
  const { page, tree, file } = p;
  const target = githubTargetFor(page, tree);
  const showsDraft = page.kind === 'path' && openedPin(tree, page, file)?.kind === 'draft';
  let committedHref: string | null = null;
  if (page.kind === 'path' && page.view !== 'committed') {
    const k = docsPathKind(tree, page.section, page.path, modeOf(page));
    if (k.kind === 'leaf' && k.view.offersCommitted) {
      const to = { kind: 'path', section: page.section, path: page.path, dirSlash: false, view: 'committed' } as const;
      committedHref = docsPageUrl(docsLocation(page, to));
    }
  }
  if (target === null && committedHref === null) return null;
  return (
    <div className="docs-actions">
      {target !== null && <GithubAction tree={tree} target={target} showsDraft={showsDraft} />}
      {committedHref !== null && <DocsPageLink className="docs-action" href={committedHref}>{DOCS_HEAD_TEXT.openCommitted}</DocsPageLink>}
    </div>
  );
}

/** The Docs header. `tree` null has one meaning: the visit's tree slot is not `ok` (loading, failed, or the page names
 *  no project), so the header is back and the crumbs only (spec 4.7: a tree failure keeps the crumbs). */
export function DocsHead(p: { readonly page: DocsPageLocation; readonly visit: DocsVisit; readonly tree: DocsTreeOk | null }): ReactNode {
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
  return (
    <header className="docs-head">
      <div className="docs-head-bar">
        <button type="button" className="docs-back" aria-label={DOCS_HEAD_TEXT.back} onClick={() => navigate(docsUpHref(page))}>
          ‹
        </button>
        <Crumbs key={crumbs.at(-1)?.href} crumbs={crumbs} />
      </div>
      {tree !== null && page.kind !== 'index' && (
        <>
          <TruthLine page={page} visit={visit} tree={tree} receivedAt={receivedAt} now={now} />
          <Actions page={page} tree={tree} file={visit.file} />
        </>
      )}
      {visit.updatedTo !== null && (
        <p className="docs-updated" role="status">{fillSentence(DOCS_HEAD_TEXT.updatedTo, { short: shortCommit(visit.updatedTo) })}</p>
      )}
    </header>
  );
}
