// Export's Markdown components (spec 2026-10-01 4.17 "The body", "Links", "Images", "Highlighting"; native Docs reader
// W5, Export; refinements (m), (n)). `EXPORT_COMPONENTS` is `DOC_COMPONENTS` with three overrides, each reading
// `ExportMarkdownContext`, which only `buildExport` provides:
//   - `a`: spec 4.17's link table, by `exportLinkTarget`, from the URL `detachUrls` moved into the map: a document in the
//     listing with a committed side, or a repository file, is a GitHub permalink at the commit the export names; a
//     fragment is kept; an http(s) or mailto link opens in a new tab; anything else is an inert span with no `href`;
//   - `img`: the builder's decision for this very element: inlined as a `data:image/` URL, or a placeholder whose words
//     are closed (`EXPORT_MISSING_SENTENCE`); it loads nothing;
//   - `pre`: a static code block with no copy button, its entry read through `exportEntry` (the copy's own skip, then
//     `peek`; never `request`) and drawn through `lib/markdown.tsx`'s one sink, `HighlightedCode`.
// The table wrapper stays `SHARED_COMPONENTS`' (refinement (n)). Every value is a React prop or child, so React escapes
// it; nothing here builds markup from a string.
//
// Ring L4 delivery.
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import type { Element as HastElement } from 'hast';
import { githubPermalink, resolveDocRef, type GithubPermalink } from '../../../../shared/docs';
import { blockKey, type HighlightStore } from '../../lib/highlightStore';
import { HighlightedCode, codeBlockLabel, codeBlockParts, type CodeBlockParts } from '../../lib/markdown';
import { DOC_COMPONENTS } from '../DocMarkdown';
import type { DocLinkContextValue } from '../DocLink';
import {
  DOC_IMAGE_TEXT, DOC_LINK_INERT_SENTENCE, EXPORT_MISSING_SENTENCE, EXPORT_TEXT, fillSentence, shareRefusalSentence,
  shortCommit,
} from '../docsText';
import type { ShareRefusal } from '../share';
import { exportEntry } from './colouring';
import type { ExportMissing } from './policy';

/** What the builder decided for one `img` of the body. */
export type ExportImageDecision =
  | { readonly kind: 'inline'; readonly src: string; readonly draft: boolean }
  | { readonly kind: 'missing'; readonly why: ExportMissing };

export interface ExportMarkdownContextValue {
  readonly link: DocLinkContextValue;
  /** C: the commit every permalink names. */
  readonly commit: string;
  readonly images: ReadonlyMap<HastElement, ExportImageDecision>;
  /** The page's store; `null`: draw every block plain (colouring dropped to fit). */
  readonly store: HighlightStore | null;
}

/** `null`, the default, has one meaning: rendered outside `buildExport`, so links are inert, images placeholders and
 *  code plain. */
export const ExportMarkdownContext = createContext<ExportMarkdownContextValue | null>(null);

/** What a link of the body becomes in the file (spec 4.17's link table). */
export type ExportLinkTarget =
  | { readonly kind: 'permalink'; readonly href: string }
  | { readonly kind: 'fragment'; readonly href: string }
  | { readonly kind: 'external'; readonly href: string }
  | { readonly kind: 'inert'; readonly title: string };

function refusedTitle(why: Extract<GithubPermalink, { ok: false }>['why'], commit: string): string {
  const word: ShareRefusal = why === 'uncommitted' ? 'new-draft' : why;
  return shareRefusalSentence(word, { short: shortCommit(commit) }, false);
}

/** Spec 4.17's link table, for the raw `href` a document wrote, on the leaf `link` names, at commit `commit`. A
 *  document's own fragment is not carried onto its permalink (refinement (m)). */
export function exportLinkTarget(
  link: Pick<DocLinkContextValue, 'section' | 'path' | 'tree'>, commit: string, raw: string,
): ExportLinkTarget {
  const r = resolveDocRef({ section: link.section, path: link.path }, raw);
  switch (r.kind) {
    case 'doc': {
      const kind = link.tree.entries.find((e) => e.section === r.section && e.path === r.path)?.committed?.kind;
      if (kind !== 'file' && kind !== 'exec') return { kind: 'inert', title: fillSentence(EXPORT_TEXT.notListed, { short: shortCommit(commit) }) };
      const p = githubPermalink(link.tree.github, link.tree.ref, commit, { kind: 'leaf', section: r.section, path: r.path, uncommitted: false });
      return p.ok ? { kind: 'permalink', href: p.url } : { kind: 'inert', title: refusedTitle(p.why, commit) };
    }
    case 'repo': {
      const p = githubPermalink(link.tree.github, link.tree.ref, commit, { kind: 'repo', repoPath: r.repoPath });
      return p.ok ? { kind: 'permalink', href: p.url } : { kind: 'inert', title: refusedTitle(p.why, commit) };
    }
    case 'fragment':
      return { kind: 'fragment', href: `#${r.fragment}` };
    case 'external':
      return { kind: 'external', href: r.url };
    case 'self-contained':
      return { kind: 'inert', title: DOC_LINK_INERT_SENTENCE[r.scheme] };
    case 'refused':
      return { kind: 'inert', title: DOC_LINK_INERT_SENTENCE[r.why] };
  }
}

/** The Markdown `a` of an export. Of the tree's own props it keeps what `DocLink` keeps (an `id`, a `title`, a
 *  footnote's `data-*` and `aria-*`), never a URL prop. */
function ExportLink(p: ComponentProps<'a'> & { node?: HastElement }): ReactNode {
  const { node, children, href: _href, ping: _ping, target: _target, rel: _rel, onClick: _onClick, ...rest } = p;
  const ctx = useContext(ExportMarkdownContext);
  const raw = (ctx === null || node === undefined ? undefined : ctx.link.urls.get(node)?.attrs['href']) ?? '';
  const t: ExportLinkTarget = ctx === null ? { kind: 'inert', title: '' } : exportLinkTarget(ctx.link, ctx.commit, raw);
  switch (t.kind) {
    case 'permalink':
      return <a {...rest} href={t.href} rel="noopener noreferrer">{children}</a>;
    case 'fragment':
      return <a {...rest} href={t.href}>{children}</a>;
    case 'external':
      return <a {...rest} href={t.href} target="_blank" rel="noopener noreferrer">{children}</a>;
    case 'inert':
      return <span className="ccrc-export-inert" title={t.title}>{children}</span>;
  }
}

/** The Markdown `img` of an export: the builder's decision for this element. */
function ExportImage(p: ComponentProps<'img'> & { node?: HastElement }): ReactNode {
  const ctx = useContext(ExportMarkdownContext);
  const alt = p.alt ?? '';
  const d = ctx === null || p.node === undefined ? undefined : ctx.images.get(p.node);
  if (d === undefined || d.kind === 'missing') {
    return <span className="ccrc-export-missing" role="img" aria-label={alt}>{EXPORT_MISSING_SENTENCE[d?.why ?? 'refused']}</span>;
  }
  return (
    <>
      <img className="ccrc-export-img" src={d.src} alt={alt} title={p.title} />
      {d.draft && <>{' '}<span className="ccrc-export-caption">{DOC_IMAGE_TEXT.draft}</span></>}
    </>
  );
}

/** A static code block: its label and its code as the page's `CodeBlock` draws them, from `store`, with no copy button
 *  and no request. `at` is the block's own `pre` element (the page skipped some copies, D-7762). */
export function ExportCode(p: { readonly parts: CodeBlockParts; readonly store: HighlightStore | null; readonly at?: object }): ReactNode {
  const { lang, label, raw } = p.parts;
  const answer = p.store === null ? blockKey(lang, raw) : p.store.keyOf(lang, raw);
  const entry = exportEntry(p.store, answer, p.at);
  return (
    <div className="code-block">
      <div className="code-block-bar"><span className="code-block-lang">{codeBlockLabel(label, raw, answer, entry)}</span></div>
      <pre><HighlightedCode entry={entry} raw={raw} /></pre>
    </div>
  );
}

function ExportPre({ children, node }: { children?: ReactNode; node?: HastElement }): ReactNode {
  const ctx = useContext(ExportMarkdownContext);
  return <ExportCode parts={codeBlockParts(children)} store={ctx?.store ?? null} at={node} />;
}

/** The components an export's Markdown body renders with (spec 4.17 "The body"). */
export const EXPORT_COMPONENTS: Components = { ...DOC_COMPONENTS, a: ExportLink, img: ExportImage, pre: ExportPre };
