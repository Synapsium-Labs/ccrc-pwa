// An outside folder's pages (X2 P2.4, spec 4.1): the root, a section or directory listing and a leaf, under `DocsHead`, which
// draws a folder page's head too. The page family of `DocsTreeView.tsx`'s project pages, kept apart so that file holds one
// family. Everything is read through
// `DocsFolderLoaders` (the labels, tree, file and range doors), never the project doors; the rows and decisions are
// `folderPage.ts`'s; every link is `docsPageUrl` over a `DocsFolderLocation`. Nothing here draws the folder's absolute path:
// the only door that carries one is `paths`, which Settings' section alone calls.
//
// A FOLDER LEAF RENDERS AS A DRAFT DOES. A draft is a file read with no commit, by its fingerprint (spec 4.1: an outside
// folder "reuses those leaf checks and the fingerprinted read"), and `DocsLeaf` shows it through `DocMarkdown` under a link
// context. This does the same: Markdown through `DocMarkdown`, SVG as the same `data:` image, text and range reads through
// `DocsLeaf`'s own `RangeSource`. The link context names the folder as its project (`~<label>`), so the one link decision
// (`docLinkTarget`) writes `/docs/~<label>/<section>/<path>` for a relative link into the six sections and, with no GitHub
// origin in the empty stand-in tree, makes every link that would leave them inert, exactly as a draft's. The body sits under
// a null asset context, so a relative image is refused as outside a page and never read. The rich reader (`ReaderFrame`) is
// not used: it reads a project's pin and history, which a folder has none of.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  contentClass, docsPageUrl,
  type DocSectionSlug, type DocsFolderEntry, type DocsFolderFileResponse, type DocsFolderLocation, type DocsFolderTreeOk,
  type DocsShowOk, type DocsTreeOk,
} from '../../../shared/docs';
import { onAuthRegained } from '../lib/auth';
import { navigate } from '../lib/router';
import type { MarkdownParser } from '../lib/markdownRunner';
import { DocsAssetContext, svgDataUrl } from './DocImage';
import type { DocLinkContextValue } from './DocLink';
import { DOC_NOT_UTF8_NOTE, DocMarkdown, DocPlain, docMarkdownSource } from './DocMarkdown';
import { RangeSource } from './DocsLeaf';
import { DocsHead } from './DocsHead';
import {
  DOCS_FOLDER_TEXT, DOCS_RELIST_WORDS, DOCS_VIEW_TEXT, failureSentence, fillSentence, kib, pluralS, slotSentence,
} from './docsText';
import { CLASS_GLYPH, FOLDER_GLYPH, SECTION_LABEL, leafName } from './docsTree';
import type { DocsNotOk } from './failures';
import {
  folderListing, folderPathKind, folderRangeLoader, folderRangeVisit, folderReadPlan, folderSectionRows,
  type DocsFolderLoaders,
} from './folderPage';
import { showBytes } from './objectUrls';
import { RangeLeaf, rangeReadKey, type RangeBytes } from './range/RangeLeaf';

/** One `.docs-row` button; a tap navigates with a history entry. */
function RowButton(p: { readonly href: string; readonly children: ReactNode }): ReactNode {
  return <button type="button" className="docs-row" onClick={() => navigate(p.href)}>{p.children}</button>;
}

/** A folder page's answer slot: the listing, or why there is none. */
type FolderTreeSlot = { s: 'loading' } | { s: 'ok'; tree: DocsFolderTreeOk } | DocsNotOk;

/** One folder's tree, read once per label and again on `reload` or a sign-in after an `auth` answer. `reads` counts the
 *  trees that have answered, which a range leaf watches to read again after a re-list. */
function useFolderTree(label: string, folders: DocsFolderLoaders): { slot: FolderTreeSlot; reload: () => void; reads: number } {
  const [slot, setSlot] = useState<FolderTreeSlot>({ s: 'loading' });
  const [nonce, setNonce] = useState(0);
  const [reads, setReads] = useState(0);
  // The newest slot, for the sign-in handler: it decides from this and does its one effect outside any state updater.
  const latest = useRef<FolderTreeSlot>(slot);
  latest.current = slot;
  useEffect(() => {
    const ac = new AbortController();
    setSlot({ s: 'loading' });
    void folders.tree(label, ac.signal).then((a) => {
      if (ac.signal.aborted) return;
      setSlot(a.s === 'ok' ? { s: 'ok', tree: a.value.tree } : a);
      setReads((n) => n + 1);
    }, () => undefined);
    return () => ac.abort();
  }, [label, folders, nonce]);
  useEffect(() => onAuthRegained(() => { if (latest.current.s === 'auth') setNonce((n) => n + 1); }), []);
  return { slot, reload: useCallback(() => setNonce((n) => n + 1), []), reads };
}

/** A refusal in words, with Retry where another try could help. */
function FolderNote(p: { readonly answer: DocsNotOk; readonly onRetry: () => void }): ReactNode {
  const text = p.answer.s === 'failed' ? failureSentence(p.answer.body) : slotSentence(p.answer);
  return (
    <div className="docs-fail" role="alert">
      <p className="docs-note">{text}</p>
      {p.answer.s !== 'auth' && <button type="button" className="docs-fail-action" onClick={p.onRetry}>{DOCS_FOLDER_TEXT.retry}</button>}
    </div>
  );
}

/** The folder's root page: the sections it has entries in. */
function FolderRootPage(p: { readonly loc: DocsFolderLocation; readonly tree: DocsFolderTreeOk }): ReactNode {
  const rows = folderSectionRows(p.tree);
  if (rows.length === 0) return <p className="docs-note">{DOCS_FOLDER_TEXT.emptyFolder}</p>;
  return (
    <ul className="docs-rows">
      {rows.map((r) => (
        <li key={r.section}>
          <RowButton href={docsPageUrl({ kind: 'folder-section', label: p.loc.label, section: r.section })}>
            <span className="docs-row-name">{SECTION_LABEL[r.section]}</span> <span className="docs-row-count">{r.count}</span>
          </RowButton>
        </li>
      ))}
    </ul>
  );
}

/** A section root or directory of a folder: a filter and `folderListing`'s rows. A file that is no regular file is shown
 *  with its kind and opens nothing (its page says so). */
function FolderListingPage(p: {
  readonly label: string; readonly tree: DocsFolderTreeOk; readonly section: DocSectionSlug; readonly dir: string;
}): ReactNode {
  const { label, tree, section, dir } = p;
  const [filter, setFilter] = useState('');
  const listing = folderListing(tree.entries, section, dir);
  const needle = filter.toLowerCase();
  const shown = (name: string): boolean => needle === '' || name.toLowerCase().includes(needle);
  const prefix = dir === '' ? '' : dir + '/';
  return (
    <div className="docs-listing">
      <input
        type="search" className="docs-filter" aria-label={DOCS_VIEW_TEXT.filterEntries} placeholder={DOCS_VIEW_TEXT.filterEntries}
        value={filter} onChange={(e) => setFilter(e.target.value)}
      />
      {listing.folders.length + listing.files.length === 0 && <p className="docs-note">{DOCS_VIEW_TEXT.emptyListing}</p>}
      <ul className="docs-rows">
        {listing.folders.filter((f) => shown(f.name)).map((f) => (
          <li key={'d:' + f.name}>
            <RowButton href={docsPageUrl({ kind: 'folder-path', label, section, path: prefix + f.name, dirSlash: true })}>
              <span className="docs-row-glyph" aria-hidden="true">{FOLDER_GLYPH}</span>
              <span className="docs-row-name">{f.name}/</span> <span className="docs-row-count">{f.count}</span>
            </RowButton>
          </li>
        ))}
        {listing.files.filter((e) => shown(leafName(e.path))).map((e) => (
          <li key={'f:' + e.path}>
            <RowButton href={docsPageUrl({ kind: 'folder-path', label, section, path: e.path, dirSlash: false })}>
              <span className="docs-row-glyph" aria-hidden="true">{CLASS_GLYPH[contentClass(e.path)]}</span>
              <span className="docs-row-name">{leafName(e.path)}</span>
              {e.kind !== 'file' && <> <span className="docs-row-mark">{DOCS_FOLDER_TEXT.entryKind[e.kind]}</span></>}
              {typeof e.size === 'number' && <> <span className="docs-row-size">{kib(e.size)}</span></>}
            </RowButton>
          </li>
        ))}
      </ul>
      {tree.unlisted.count > 0 && (
        <p className="docs-note">{fillSentence(DOCS_VIEW_TEXT.treeUnlisted, { n: tree.unlisted.count, s: pluralS(tree.unlisted.count) })}</p>
      )}
    </div>
  );
}

/** The tree a folder leaf's link context carries: a folder has no repository, so the honest tree is an empty one: no GitHub
 *  origin (so `docLinkTarget`'s `repo` arm, a link out of the six sections, makes the link inert, as a draft's would), no
 *  entries (so an image path names no listed file) and no drafts. Every field is a placeholder no reader of a folder leaf
 *  looks at; `DocImage`'s `entryAt` reads `entries`, which is why it is a real array and not a cast. */
const EMPTY_FOLDER_TREE: DocsTreeOk = {
  v: 1, verb: 'docs-tree', ok: true, elapsedMs: 0, project: '',
  repo: { key: '0'.repeat(32), objectFormat: 'sha1', shallow: false },
  github: { state: 'none' },
  ref: {
    requested: null, served: '', name: '', side: 'local', commit: '0'.repeat(40), via: 'local', tried: [],
    relation: 'unmeasured', counterpart: null,
  },
  mainCheckout: { path: '', branch: null, head: '0'.repeat(40) },
  sections: [], entries: [], unlisted: { count: 0, byReason: {} },
  drafts: { state: 'none', branch: '', skipped: [] },
  freshness: { remote: null, trackedRef: null, stamp: null, fetchHead: null },
};

/** The link context of a folder leaf: the folder is the "project" `~<label>`, so `docsPageUrl` writes `/docs/~<label>/...`
 *  (the tilde survives `encodeURIComponent`), the page has no ref or version, and its source is a draft's. A fragment link
 *  to another page has no visit to hand its fragment to, so the hand-off is a no-op and the page opens at its top. */
function folderLinkBase(label: string, section: DocSectionSlug, path: string): Omit<DocLinkContextValue, 'urls'> {
  return {
    project: '~' + label, pageRef: null, pageAt: null, view: 'effective', section, path, tree: EMPTY_FOLDER_TREE,
    pageSource: 'draft', onFragment: () => undefined,
  };
}

/** A folder file's answer as the docs-show shape the Markdown and source readers take: a draft's (no commit), keyed by the
 *  fingerprint that was read. */
function showOfFolder(answer: DocsFolderFileResponse): DocsShowOk {
  const s = answer.show;
  return {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: s.elapsedMs, source: 'draft', section: s.section, path: s.path, size: s.size,
    sha256: s.sha256, encoding: s.encoding, ...(s.text !== undefined ? { text: s.text } : {}), ...(s.b64 !== undefined ? { b64: s.b64 } : {}),
    fp: s.fp,
  };
}

/** One folder file's text as its class shows it. `markdown`: rendered, through `DocMarkdown`. `svg`: the `data:` image, as
 *  the project leaf draws it. Every other class that reads (text, and HTML, whose mockup viewer is a project's: it reads
 *  assets by a repository pin) is `DocsLeaf`'s own source view, which also says where bytes are not UTF-8. */
function FolderBody(p: {
  readonly show: DocsShowOk; readonly link: Omit<DocLinkContextValue, 'urls'>; readonly parser: MarkdownParser;
}): ReactNode {
  const { show, link, parser } = p;
  const cls = contentClass(show.path);
  const src = useMemo(() => docMarkdownSource(show), [show]);
  const bytes = useMemo(() => showBytes(show), [show]);
  if (src.kind === 'no-bytes' || bytes === null) return <p className="docs-note">{DOCS_FOLDER_TEXT.noPreview}</p>;
  if (src.kind === 'not-utf8') return <DocPlain text={src.text} note={DOC_NOT_UTF8_NOTE} />;
  if (cls === 'markdown') {
    const pinKey = ['folder', link.project, show.section, show.path, show.sha256].join('\u0000');
    return <DocMarkdown key={pinKey} text={src.text} pinKey={pinKey} parser={parser} link={link} />;
  }
  if (cls === 'svg') return <img className="docs-svg-img" src={svgDataUrl(bytes)} alt={leafName(show.path)} />;
  return <RangeSource read={{ bytes, digest: show.sha256 }} path={show.path} />;
}

/** A range read's bytes: Markdown through the same body (its own render gate asks above the limit), other classes through
 *  `DocsLeaf`'s `RangeSource`, as source in parts. */
function FolderRangeBody(p: {
  readonly read: RangeBytes; readonly entry: DocsFolderEntry; readonly link: Omit<DocLinkContextValue, 'urls'>;
  readonly parser: MarkdownParser;
}): ReactNode {
  const { read, entry, link, parser } = p;
  const decoded = useMemo(() => {
    try {
      return { utf8: true, text: new TextDecoder('utf-8', { fatal: true }).decode(read.bytes) };
    } catch {
      return { utf8: false, text: new TextDecoder('utf-8').decode(read.bytes) };
    }
  }, [read.bytes]);
  if (contentClass(entry.path) !== 'markdown') return <RangeSource read={read} path={entry.path} />;
  if (!decoded.utf8) return <DocPlain text={decoded.text} note={DOC_NOT_UTF8_NOTE} />;
  const pinKey = ['folder-range', link.project, entry.section, entry.path, read.digest].join('\u0000');
  return <DocMarkdown key={pinKey} text={decoded.text} pinKey={pinKey} parser={parser} link={link} />;
}

/** A file of a folder, read by `folderReadPlan`: one fingerprinted file-door read, or a range read. A refusal that means
 *  the file changed under the read (`draft-changed`) is mended by a new listing, not by sending the old fingerprint again:
 *  Retry re-reads the tree (`onRelist`), whose new row has the file's new fingerprint. */
function FolderLeafBody(p: {
  readonly label: string; readonly entry: DocsFolderEntry; readonly folders: DocsFolderLoaders; readonly parser: MarkdownParser;
  readonly onTime: (mtimeNs: string | null) => void; readonly onRelist: () => void; readonly relists: number;
  /** Whether this page's one automatic re-list is used. Held by `FolderPage`, not here: a re-list shows the tree as loading,
   *  which unmounts this body, so a flag of its own would be new on every re-read and the limit would never hold. */
  readonly spent: { current: boolean };
}): ReactNode {
  const { label, entry, folders, parser, onTime, onRelist, relists, spent } = p;
  const plan = useMemo(() => folderReadPlan(entry), [entry]);
  const link = useMemo(() => folderLinkBase(label, entry.section, entry.path), [label, entry.section, entry.path]);
  const [slot, setSlot] = useState<{ s: 'loading' } | { s: 'ok'; answer: DocsFolderFileResponse } | DocsNotOk>({ s: 'loading' });
  const [nonce, setNonce] = useState(0);
  const timeRef = useRef(onTime);
  timeRef.current = onTime;
  useEffect(() => {
    // The truth line's time is the time of the read that gave the bytes on screen: none until they arrive, and none for a
    // range read (its prepare answer carries no time), so it is cleared when a read starts and set only by a show answer.
    timeRef.current(null);
    if (plan.mode !== 'file') return undefined;
    const ac = new AbortController();
    setSlot({ s: 'loading' });
    void folders.file(label, entry.section, entry.path, plan.fp, ac.signal).then((a) => {
      if (ac.signal.aborted) return;
      if (a.s === 'ok') timeRef.current(a.value.show.mtimeNs);
      setSlot(a.s === 'ok' ? { s: 'ok', answer: a.value } : a);
    }, () => undefined);
    return () => ac.abort();
  }, [label, entry, folders, plan, nonce]);
  const rangeLoader = useMemo(() => folderRangeLoader(label, folders.range), [label, folders]);
  const visit = useMemo(() => folderRangeVisit(onRelist, relists, spent), [onRelist, relists, spent]);
  const show = useMemo(() => (slot.s === 'ok' ? showOfFolder(slot.answer) : null), [slot]);
  if (plan.mode === 'none') {
    const why = plan.why === 'not-a-file' ? DOCS_FOLDER_TEXT.notAFile : plan.why === 'too-large' ? DOCS_FOLDER_TEXT.tooLarge
      : plan.why === 'unpinned' ? DOCS_FOLDER_TEXT.unpinned : DOCS_FOLDER_TEXT.noPreview;
    return <p className="docs-note">{why}</p>;
  }
  if (plan.mode === 'range') {
    // A folder's range target has no project pin: the page's draft-shaped pin names only the place and the stat.
    const target = {
      project: '~' + label, size: plan.size, range: plan.range,
      pin: { kind: 'draft', branch: '', head: '', section: entry.section, path: entry.path, fp: null,
        stat: { size: plan.size, mtimeNs: entry.mtimeNs ?? '0' } },
    } as const;
    return (
      <RangeLeaf
        key={rangeReadKey(target)} target={target} cls={contentClass(entry.path)} name={leafName(entry.path)}
        loader={rangeLoader} visit={visit}
      >
        {(read: RangeBytes) => <FolderRangeBody read={read} entry={entry} link={link} parser={parser} />}
      </RangeLeaf>
    );
  }
  if (slot.s === 'loading') return <p className="docs-loading">{DOCS_VIEW_TEXT.loading}</p>;
  if (slot.s !== 'ok' || show === null) {
    const changed = slot.s === 'failed' && DOCS_RELIST_WORDS.has(slot.body.failure);
    return <FolderNote answer={slot as DocsNotOk} onRetry={changed ? onRelist : () => setNonce((n) => n + 1)} />;
  }
  return <FolderBody show={show} link={link} parser={parser} />;
}

/** An outside folder's page (X2 P2.4): reads the folder's listing, then shows its root, a section, a directory, or a file. */
export function FolderPage(p: {
  readonly loc: DocsFolderLocation; readonly folders: DocsFolderLoaders; readonly parser: MarkdownParser;
}): ReactNode {
  const { loc, folders, parser } = p;
  const { slot, reload, reads } = useFolderTree(loc.label, folders);
  const [shown, setShown] = useState<{ key: string; mtimeNs: string } | null>(null);
  const tree = slot.s === 'ok' ? slot.tree : null;
  // A file's URL with a trailing slash shows the leaf (a listing says what a path is, never the URL's slash).
  const leaf = tree !== null && loc.kind === 'folder-path' ? folderPathKind(tree, loc.section, loc.path) : null;
  const entry = leaf !== null && leaf.kind === 'leaf' ? leaf.entry : null;
  const key = loc.kind === 'folder-path' ? loc.label + '\u0000' + loc.section + '\u0000' + loc.path : '';
  // The time of the bytes the page shows: the show's own, once this leaf's read has answered; else none (first clause alone).
  const mtimeNs = shown !== null && shown.key === key ? shown.mtimeNs : null;
  const onTime = useCallback((t: string | null) => setShown(t === null ? null : { key, mtimeNs: t }), [key]);
  // The one automatic re-list of a range read, per page: it outlives the leaf body (a re-list unmounts it) and starts over
  // on another page, and a successful read gives it back (`folderRangeVisit`'s `rangeRead`).
  const spent = useRef(false);
  useEffect(() => { spent.current = false; }, [key]);
  let body: ReactNode;
  if (slot.s === 'loading') body = <p className="docs-loading">{DOCS_FOLDER_TEXT.loading}</p>;
  else if (slot.s !== 'ok') body = <FolderNote answer={slot} onRetry={reload} />;
  else if (loc.kind === 'folder') body = <FolderRootPage loc={loc} tree={slot.tree} />;
  else if (loc.kind === 'folder-section') body = <FolderListingPage key={loc.section} label={loc.label} tree={slot.tree} section={loc.section} dir="" />;
  else {
    const kind = leaf === null ? 'missing' : leaf.kind;
    if (kind === 'leaf' && entry !== null) {
      body = (
        <FolderLeafBody
          key={key} label={loc.label} entry={entry} folders={folders} parser={parser} onTime={onTime} onRelist={reload} relists={reads} spent={spent}
        />
      );
    } else if (kind === 'dir') body = <FolderListingPage key={key} label={loc.label} tree={slot.tree} section={loc.section} dir={loc.path} />;
    else body = <p className="docs-note">{DOCS_FOLDER_TEXT.missing}</p>;
  }
  return (
    <>
      <DocsHead page={loc} folderTime={mtimeNs} />
      {/* No asset context: a relative image in a folder's Markdown is refused as outside a page, never read as a project's. */}
      <DocsAssetContext value={null}>
        <div className="docs-folder-body">{body}</div>
      </DocsAssetContext>
    </>
  );
}
