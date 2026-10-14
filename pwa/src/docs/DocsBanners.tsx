// The Docs banners (spec 2026-10-01 4.5's table; W5 part 1 Task 10): under the header, on every page with a listing,
// what the page does NOT show and why. The default view never overlays a draft, so its hint links the same page at
// the QUALIFIED `refs/heads/<branch>` (a bare name could serve origin and overlay nothing); a ref view overlays only
// when the holder's HEAD is the served commit, and otherwise says what the drafts are based on; each drafts state that
// shows none says why; a leaf's withheld, deleted, type-changed and conflicted drafts come from `entryView` (never a
// read of the draft's own state, M4.T7); a commit the branch no longer contains offers Re-list; drafted images are
// counted; `view=committed` offers the way back. A pure renderer: it starts no request (Retry and Re-list call
// `onRelist`), and every link is `docsPageUrl(docsLocation(page, to))` (refinement (q)).
import type { ReactNode } from 'react';
import { docsPageUrl, parseDocsRef, type DocsPageLocation, type DocsTreeOk } from '../../../shared/docs';
import { docsLocation } from './docsLinks';
import {
  DOCS_BANNER_TEXT, DOCS_VIEW_TEXT, WITHHELD_SENTENCE, fillSentence, pluralS, servedRefText, shortCommit, worktreeLabel,
} from './docsText';
import { docsPathKind } from './docsTree';
import { DocsPageLink } from './DocsTreeView';
import type { FileSlot } from './useDocsVisit';

type Tone = 'info' | 'warn';

function Banner(p: { readonly id: string; readonly tone: Tone; readonly text: string; readonly children?: ReactNode }): ReactNode {
  return (
    <div className="docs-banner" data-banner={p.id} data-tone={p.tone} role="status">
      <span className="docs-banner-text">{p.text}</span>
      {p.children}
    </div>
  );
}

function RelistButton(p: { readonly label: string; readonly onRelist: () => void }): ReactNode {
  return <>{' '}<button type="button" className="btn-ghost docs-banner-action" onClick={p.onRelist}>{p.label}</button></>;
}

function HintLink(p: { readonly href: string | null; readonly label: string }): ReactNode {
  return p.href === null ? null : <>{' '}<DocsPageLink className="docs-hint-link" href={p.href}>{p.label}</DocsPageLink></>;
}

/** The banners for `page` over `tree`. `file` is the visit's file slot (only a leaf's `ok` answer is read, for
 *  `onRef`); `draftAssets` counts the drafted images on the page; `onRelist` is the visit's `retryTree`. The index
 *  has none. */
export function DocsBanners(p: {
  readonly page: DocsPageLocation; readonly tree: DocsTreeOk; readonly file: FileSlot; readonly draftAssets: number;
  readonly onRelist: () => void;
}): ReactNode {
  const { page, tree, file, draftAssets, onRelist } = p;
  if (page.kind === 'index') return null;
  const mode = page.ref === null ? 'default' : 'ref';
  const d = tree.drafts;
  const out: ReactNode[] = [];
  // `n` counts entries with a draft at all (spec 4.5), whatever the overlay would make of each.
  const n = tree.entries.filter((e) => e.draft !== null).length;

  switch (d.state) {
    case 'holder': {
      const label = worktreeLabel(d.worktree);
      const localRef = parseDocsRef('refs/heads/' + d.branch);
      const localHref = localRef === null ? null
        : docsPageUrl(docsLocation(page, { kind: 'same-page', project: page.project, ref: localRef }));
      if (mode === 'default' && n > 0) {
        out.push(
          <Banner key="default-hint" id="default-hint" tone="info"
            text={fillSentence(DOCS_BANNER_TEXT.defaultHint, { n, s: pluralS(n), label, branch: d.branch })}>
            <HintLink href={localHref} label={DOCS_VIEW_TEXT.openDraftView} />
          </Banner>,
        );
      }
      if (mode === 'ref' && !d.baseEqual && n > 0) {
        const text = fillSentence(DOCS_BANNER_TEXT.baseHint, {
          n, s: pluralS(n), label, branch: d.branch, short: shortCommit(d.worktree.head), served: servedRefText(tree.ref),
        });
        out.push(
          <Banner key="base-hint" id="base-hint" tone="info" text={text}>
            <HintLink href={localHref} label={DOCS_BANNER_TEXT.openLocalView} />
          </Banner>,
        );
      }
      if (d.caveats.includes('assume-unchanged') || d.caveats.includes('skip-worktree')) {
        out.push(<Banner key="caveat-hash" id="caveat-hash" tone="info" text={DOCS_BANNER_TEXT.caveatHash} />);
      }
      if (d.caveats.includes('filters-bypassed')) {
        out.push(<Banner key="caveat-filters" id="caveat-filters" tone="info" text={DOCS_BANNER_TEXT.caveatFilters} />);
      }
      break;
    }
    case 'ambiguous':
      out.push(
        <Banner key="ambiguous" id="ambiguous" tone="warn" text={fillSentence(DOCS_BANNER_TEXT.ambiguous, { branch: d.branch })}>
          <ul className="docs-banner-list">{d.candidates.map((c) => <li key={c}>{c}</li>)}</ul>
        </Banner>,
      );
      break;
    case 'untrusted':
      out.push(
        <Banner key="untrusted" id="untrusted" tone="warn"
          text={fillSentence(DOCS_BANNER_TEXT.untrusted, { branch: d.branch, why: d.why })} />,
      );
      break;
    case 'unreadable':
      out.push(<Banner key="unreadable" id="unreadable" tone="warn" text={fillSentence(DOCS_BANNER_TEXT.unreadable, { step: d.step })} />);
      break;
    case 'unsettled':
      out.push(
        <Banner key="unsettled" id="unsettled" tone="info" text={DOCS_BANNER_TEXT.unsettled}>
          <RelistButton label={DOCS_BANNER_TEXT.retry} onRelist={onRelist} />
        </Banner>,
      );
      break;
    case 'too-many':
      out.push(<Banner key="too-many" id="too-many" tone="info" text={fillSentence(DOCS_BANNER_TEXT.tooMany, { count: d.count })} />);
      break;
    case 'none':
      if (d.skipped.length > 0) {
        const why = [...new Set(d.skipped.map((x) => x.why))].join(', ');
        out.push(
          <Banner key="skipped" id="skipped" tone="info"
            text={fillSentence(DOCS_BANNER_TEXT.skipped, { k: d.skipped.length, branch: d.branch, why })} />,
        );
      }
      break;
  }

  if (page.kind === 'path') {
    const k = docsPathKind(tree, page.section, page.path, mode);
    if (k.kind === 'leaf') {
      const v = k.view;
      const label = d.state === 'holder' ? worktreeLabel(d.worktree) : d.branch;
      // "Showing the committed version." only when the page does show one (a withheld NEW file has none).
      const showing = (s: string): string => (v.opens === 'committed' ? s + ' ' + DOCS_BANNER_TEXT.showingCommitted : s);
      if (v.badge === 'withheld' && v.withheld !== null) {
        out.push(<Banner key="withheld" id="withheld" tone="info" text={showing(WITHHELD_SENTENCE[v.withheld])} />);
      }
      if (v.badge === 'deleted') {
        out.push(<Banner key="deleted" id="deleted" tone="info" text={showing(fillSentence(DOCS_BANNER_TEXT.deleted, { label }))} />);
      }
      if (v.badge === 'typechange') {
        out.push(<Banner key="typechange" id="typechange" tone="info" text={showing(fillSentence(DOCS_BANNER_TEXT.typechange, { label }))} />);
      }
      if (v.badge === 'conflicted') out.push(<Banner key="conflicted" id="conflicted" tone="warn" text={DOCS_BANNER_TEXT.conflicted} />);
      if (file.s === 'ok' && file.answer.show.onRef === 'not-contained') {
        const short = shortCommit(file.answer.show.commit ?? tree.ref.commit);
        out.push(
          <Banner key="not-contained" id="not-contained" tone="warn"
            text={fillSentence(DOCS_BANNER_TEXT.notContained, { short, served: servedRefText(tree.ref) })}>
            <RelistButton label={DOCS_BANNER_TEXT.relist} onRelist={onRelist} />
          </Banner>,
        );
      }
      if (draftAssets > 0) {
        out.push(
          <Banner key="draft-assets" id="draft-assets" tone="info"
            text={fillSentence(DOCS_BANNER_TEXT.draftAssets, { k: draftAssets, s: pluralS(draftAssets) })} />,
        );
      }
      if (page.view === 'committed') {
        const to = { kind: 'path', section: page.section, path: page.path, dirSlash: false, view: 'effective' } as const;
        out.push(
          <Banner key="view-committed" id="view-committed" tone="info"
            text={fillSentence(DOCS_BANNER_TEXT.viewCommitted, { short: shortCommit(tree.ref.commit) })}>
            <HintLink href={docsPageUrl(docsLocation(page, to))} label={DOCS_BANNER_TEXT.backToDraft} />
          </Banner>,
        );
      }
    }
  }
  return out.length === 0 ? null : <div className="docs-banners">{out}</div>;
}
