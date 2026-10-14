// Every sentence the Docs screen's part 1 shows for a word (spec 2026-10-01 4.5, 4.6, 4.7), each map keyed by the
// word's own type so a new word is a compile error until it has its sentence. `{field}` placeholders are filled by
// `fillSentence` from the failure's context or the caller's facts; a field that is absent renders `?`, never the
// braces. The spec's own sentences are copied verbatim (docs-failures.test.tsx pins them); the rest fill its
// silences in the same register: what happened, in the operator's words, and nothing the page cannot know.
import type {
  DocRefResolution, DocsFailure, DocsFailureBody, DocsFailureContext, DocsNotAFileKind, DocsPageParseFailure,
  DocsTreeOk, EntryBadge, GithubLink, WithheldReason,
} from '../../../shared/docs';
import { isDocsFailureWord, type DocsClientSlot } from './failures';
import type { ImagePin } from './docsLinks';

/** One sentence per docs failure word (spec 4.7), at least 20 characters each (M4.F1). */
export const DOCS_FAILURE_SENTENCE: Record<DocsFailure, string> = {
  'bad-project': 'That project name is not one Docs can address.',
  'bad-ref': 'That ref is not a branch name Docs can read.',
  'bad-commit': 'That commit id is not a full 40- or 64-character hex id.',
  'bad-section': 'That section is not one of the four Docs sections.',
  'bad-path': 'That path is not one Docs can address.',
  'bad-fingerprint': 'That draft fingerprint is not a 64-character hex hash.',
  'unknown-project': "There is no project by that name under the fleet box's projects folder ({root}).",
  'not-a-git-repo': 'That project folder is not a git repository.',
  'linked-worktree': 'That folder is a linked worktree; Docs reads the repository that owns it.',
  'shared-repo': 'That folder shares its repository with another project; Docs reads it there.',
  'partial-clone': 'That repository is a partial clone, which Docs does not read.',
  'repo-unreadable': 'The repository could not be read on the fleet box.',
  'no-default-branch': 'This repository has no default branch Docs can find.',
  'unresolved-ref': 'No branch by that name was found, locally or on origin.',
  'ref-not-commit': '{ref} names a {type}, not a commit.',
  'unknown-commit': 'That commit is not in this repository any more; the listing has to be read again.',
  'not-a-commit': 'That id names a git object that is not a commit.',
  'object-missing': 'A git object this page needs is missing from the repository.',
  'absent-path': 'There is no file at that path in this commit.',
  'not-a-file': 'That path is not a regular file.',
  'symlink-in-path': 'A folder on that path is a symbolic link, which Docs does not follow.',
  'too-large': 'This file is {size}; Docs shows files of this kind up to {cap}.',
  'too-many-entries': 'This repository has {count} entries, more than Docs lists at once.',
  'unreadable-path': 'That path could not be read on the fleet box ({errno}).',
  'worktree-gone': 'The worktree that held this draft is gone.',
  'ambiguous-worktree': 'Two or more worktrees hold this branch, so its draft cannot be chosen:',
  'untrusted-worktree': 'The worktree holding this draft failed the ownership check ({why}).',
  'worktree-moved': 'The worktree moved to another commit while Docs read it.',
  'draft-changed': 'The draft changed while Docs read it.',
  'remote-absent': 'This repository has no origin remote to fetch from.',
  'remote-branch-absent': 'Origin has no branch by this name.',
  'fetch-auth-failed': "Fetching from origin was refused: the fleet box's credentials were not accepted.",
  'fetch-rejected-objects': 'Fetching from origin failed: git rejected the objects it received.',
  'fetch-transport': 'Fetching from origin failed: the connection to origin did not work.',
  'ref-locked': "Another git process holds the lock on this branch's ref.",
  'fetch-too-soon': 'Fetched moments ago; Docs waits a little before fetching again.',
  'fetch-timeout': 'Fetching from origin took too long and was stopped.',
  'fetch-failed': 'Fetching from origin failed.',
  'git-failed': 'A git command failed on the fleet box ({step}).',
  'git-timeout': 'A git command took too long on the fleet box and was stopped.',
  'helper-unavailable': 'The fleet box has no usable python3, which Docs needs; run ccrc doctor there.',
  'helper-failed': "The fleet box's Docs helper failed.",
  'unsupported': "The fleet box's ccd predates Docs; roll out a newer release.",
  'caps-unknown': 'The server has not yet learned what the fleet agent can do.',
  'not-granted':
    'The fleet agent has not loaded the Docs grants yet. If a rollout is running this clears when it finishes; '
    + 'otherwise update the fleet box.',
  'link-failed': 'The server lost its link to the fleet box.',
  'link-timeout': 'The fleet box did not answer the server in time.',
  'docs-busy': 'Docs is busy with other reads right now.',
  'ccd-timeout': "The fleet box's ccd took too long to answer and was stopped.",
  'ccd-killed': "The fleet box's ccd was stopped before it answered ({signal}).",
  'ccd-fault': "The fleet box's ccd failed with exit code {code}.",
  'answer-overflow': "The fleet box's answer was larger than the server accepts.",
  'malformed-answer': "The fleet box's answer could not be read ({why}).",
  'unknown-failure': 'The fleet box answered a failure this server does not know ({word}).',
  'foreign-request': 'The server refused a request that did not come from the Docs screen.',
  'bad-query': "The server refused this request's parameters.",
  'raster-mismatch': 'These bytes are not a {declared} image.',
  'response-type-refused': 'The server refused to send an answer of an unexpected type.',
};

/** A page-URL refusal (spec 4.4: a parse failure renders this and a link to the index), 20+ characters each. */
export const DOCS_PAGE_INVALID_SENTENCE: Record<DocsPageParseFailure, string> = {
  'not-docs': 'This address is not a Docs page.',
  'bad-project': 'This address names a project Docs cannot address.',
  'bad-section': 'This address names a section that is not one of the four Docs sections.',
  'bad-path': 'This address holds a path Docs cannot address.',
  'bad-ref': "This address's ref is not a branch name Docs can read.",
  'bad-view': "This address's view is not one Docs knows; only view=committed is.",
  'bad-frame': "This address's frame is not one Docs knows; only frame=full is.",
  'bad-escape': 'This address holds a percent-escape that does not decode.',
  'encoded-slash': 'This address hides a slash inside one path segment (%2F).',
  'commit-in-page':
    'A Docs page address never names a commit; open the page without it, or use a GitHub link for one exact commit.',
  'unknown-param': 'This address carries a query key Docs pages do not use.',
  'repeated-param': 'This address carries the same query key twice.',
  'reserved-node': 'This address names a fleet node, which Docs does not serve yet.',
};

/** `not-a-file {kind}` (spec 4.7: "renders kindText[kind]"), shown beside the word's sentence. */
export const NOT_A_FILE_KIND_TEXT: Record<DocsNotAFileKind, string> = {
  'directory': 'It is a directory.',
  'section-not-a-directory': "The section's own path is a file, not a directory.",
  'symlink': 'It is a symbolic link, which Docs does not follow.',
  'submodule': 'It is a git submodule, which Docs does not open.',
  'file-in-path': 'A file sits where a folder of that path should be.',
  'special': 'It is a special file (a device, a pipe or a socket).',
  'hardlink': 'It has more than one hard link, which Docs does not read.',
  'foreign-owner': 'It belongs to another user on the fleet box.',
  'other-device': 'It is on another file system than its repository.',
};

/** How the served ref was chosen (spec 4.5, verbatim; `{requested}` is `ref.requested`). */
export const VIA_SENTENCE: Record<DocsTreeOk['ref']['via'], string> = {
  'default:origin-head': 'default branch (origin/HEAD)',
  'default:origin-main': 'default branch (origin/main; origin/HEAD unset)',
  'default:origin-master': 'default branch (origin/master; origin/HEAD unset)',
  'default:local-main': 'default branch (local main; no origin branch)',
  'default:local-master': 'default branch (local master; no origin branch)',
  'local': 'you asked for {requested}, showing local',
  'origin': "you asked for {requested}, showing origin's",
  'qualified': 'exactly the ref you asked for',
};

/** Local against origin (spec 4.5, verbatim; `{ahead}` and `{behind}` are the counterpart's counts). */
export const RELATION_SENTENCE: Record<DocsTreeOk['ref']['relation'], string> = {
  'equal': 'local and origin agree',
  'local-only': 'not on origin',
  'origin-only': 'only on origin',
  'local-ahead': 'local is {ahead} ahead of origin',
  'local-behind': 'origin is {behind} ahead of local',
  'diverged': 'local and origin have diverged ({ahead} vs {behind}), showing local',
  'unmeasured': 'local vs origin not measured',
};

/** The one badge text, for rows and leaf headers alike (spec 4.6: `draft · modified`, `draft · new`). */
export const ENTRY_BADGE_TEXT: Record<EntryBadge, string> = {
  'modified': 'draft · modified',
  'new': 'draft · new',
  'deleted': 'draft · deleted',
  'typechange': 'draft · type changed',
  'conflicted': 'draft · conflicted',
  'withheld': 'draft · withheld',
};

/** Why an overlaid draft is not shown (spec 4.5's leaf-withheld banner, followed there by "Showing the committed
 *  version."). */
export const WITHHELD_SENTENCE: Record<WithheldReason, string> = {
  'too-large': 'The draft is too large for Docs to read.',
  'unreadable': 'The draft could not be read on the fleet box.',
  'not-a-file': 'The draft is not a regular file.',
};

/** The client slots (spec 4.3, 4.7, verbatim). `{contentType}` is filled by `slotSentence`. */
export const DOCS_SLOT_SENTENCE: Record<DocsClientSlot['s'], string> = {
  'auth': 'Sign in to read Docs.',
  'unreachable': 'The server could not be reached; Docs needs a connection.',
  'no-docs-route': 'This server predates Docs; update the server box.',
  'unexpected-response': 'The server answered {status} ({contentType}).',
};

type TriedResult = NonNullable<DocsFailureContext['tried']>[number]['result'];

/** One step of `unresolved-ref`'s `tried` chain, as the failure view lists it. */
export const TRIED_RESULT_TEXT: Record<TriedResult, string> = {
  'resolved': 'resolved',
  'absent': 'not found',
  'dangling': 'points at a missing branch',
  'malformed': 'malformed',
  'not-a-commit': 'not a commit',
};

/** `unresolved-ref {hint: 'tag'}` (spec 4.7). */
export const UNRESOLVED_TAG_HINT = 'A tag has that name; tags are not served.';

/** A word this build does not know, from a newer server (spec 4.7, verbatim): never folded into a known one. */
export function unknownWordSentence(word: string): string {
  return fillSentence("The server answered '{word}', which this app version does not know; reload to update.", { word });
}

/** Fill every `{name}` in `template` from `fields`, in one pass: a field that is absent renders `?`, and a value
 *  that itself holds braces is not filled again. */
export function fillSentence(template: string, fields: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (_m: string, name: string) =>
    Object.hasOwn(fields, name) ? String(fields[name]) : '?');
}

/** A byte count in KiB, rounded up, so a non-empty file never reads as 0. */
export function kib(bytes: number): string {
  return `${Math.ceil(bytes / 1024)} KiB`;
}

/** A commit's short form: its first 8 hex characters, everywhere (refinement (s)). */
export function shortCommit(sha: string): string {
  return sha.slice(0, 8);
}

/** The sentence for one failure body: a known word's sentence filled from the body's own context (sizes in KiB), or
 *  the unknown-word sentence naming the word. */
export function failureSentence(body: DocsFailureBody): string {
  const word: string = body.failure;
  if (!isDocsFailureWord(word)) return unknownWordSentence(word);
  const fields: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(body)) {
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) fields[name] = value;
  }
  if (typeof body.size === 'number') fields['size'] = kib(body.size);
  if (typeof body.cap === 'number') fields['cap'] = kib(body.cap);
  return fillSentence(DOCS_FAILURE_SENTENCE[word], fields);
}

/** The sentence for a client slot; an `unexpected-response` with no content-type header says so in words. */
export function slotSentence(slot: DocsClientSlot): string {
  if (slot.s !== 'unexpected-response') return DOCS_SLOT_SENTENCE[slot.s];
  return fillSentence(DOCS_SLOT_SENTENCE['unexpected-response'],
    { status: slot.status, contentType: slot.contentType === '' ? 'no content type' : slot.contentType });
}

/** The file-read words that mean the listing moved under the read (spec 4.3 item 1): the visit re-lists the tree
 *  once automatically, then shows "changing, Retry". Declared here, beside the sentences, because this is the one
 *  PWA file single-definition.test.ts's archive-door census lets spell the third word quoted on a code line. */
export const DOCS_RELIST_WORDS: ReadonlySet<DocsFailure> =
  new Set<DocsFailure>(['unknown-commit', 'draft-changed', 'worktree-moved', 'worktree-gone']);

/** Why a Markdown link on a Docs page is inert (spec 4.11, the `DocLink` arm "everything else"): a `resolveDocRef`
 *  refusal, a self-contained scheme (`data`, `blob`), or the reason `githubBlobUrl` gives no link for an in-repo
 *  file outside the four sections. */
export type DocLinkInertReason =
  | Extract<DocRefResolution, { kind: 'refused' }>['why']
  | Extract<DocRefResolution, { kind: 'self-contained' }>['scheme']
  | Extract<GithubLink, { ok: false }>['why'];

/** The first half of an inert link's title, `<sentence>: <raw>` (spec 4.11). */
export const DOC_LINK_INERT_SENTENCE: Record<DocLinkInertReason, string> = {
  'empty': 'This link has no target',
  'malformed': 'This link is not a well-formed URL (it may hold a space, a control character or a backslash)',
  'scheme': 'This link uses a scheme Docs does not open',
  'protocol-relative': 'This link names another host without a scheme',
  'root-relative': 'This link points at a server path, not at a document',
  'above-root': 'This link climbs above the repository',
  'bad-path': 'This link names a path Docs cannot address',
  'data': 'This link carries its own content, which Docs does not open',
  'blob': 'This link points at an object made inside a browser, which Docs does not open',
  'no-github-origin': 'This file is outside the Docs sections, and the repository has no GitHub origin',
  'not-on-origin': 'This file is outside the Docs sections, and this branch is not on GitHub',
  'uncommitted': 'This file is outside the Docs sections, and it is not committed',
  'bad-slug': "This file is outside the Docs sections, and the repository's GitHub name cannot be linked",
  'bad-target': 'This file is outside the Docs sections, and its branch or path cannot be linked',
};

/** The whole title of a link `DocLink` renders with no Docs page around it (no `DocLinkContext`). */
export const DOC_LINK_OUTSIDE_PAGE = 'Links open only inside a Docs page';

/** Why `DocImage` draws no image (spec 4.11: "Image not loaded: {reason}"): rendered outside a Docs page;
 *  `imagePinFor`'s three refusals; a document that is not a raster or an SVG (`not-image`); an http or https image
 *  (`external`: Docs never loads one); a listed size over its class cap (`too-large`, spec 5.5); an anchor; an
 *  in-repo file outside the four sections (`repo`); a self-contained scheme; or a `resolveDocRef` refusal. A
 *  `mailto:` source is `scheme`. */
export type DocImageRefusal =
  | 'outside-page'
  | Extract<ImagePin, { ok: false }>['why']
  | 'not-image' | 'external' | 'too-large' | 'fragment' | 'repo'
  | Extract<DocRefResolution, { kind: 'self-contained' }>['scheme']
  | Extract<DocRefResolution, { kind: 'refused' }>['why'];

/** The `{reason}` of "Image not loaded: {reason}", one per refusal. `too-large` fills `{size}` and `{cap}` in KiB. */
export const DOC_IMAGE_REFUSED_SENTENCE: Record<DocImageRefusal, string> = {
  'outside-page': 'images load only inside a Docs page',
  'absent': 'no file Docs can show is at that path',
  'deleted-in-worktree': 'the draft deletes it in the worktree',
  'draft-withheld': 'its draft is withheld or changed type, and the committed bytes are not shown in its place',
  'not-image': 'it is not an image Docs shows (PNG, JPEG, GIF, WebP or SVG)',
  'external': 'it is on another site, and Docs never loads images from other sites',
  'too-large': 'it is {size}; Docs shows images up to {cap}',
  'fragment': 'it names a place in this page, not an image',
  'repo': 'it is outside the Docs sections',
  'data': 'it carries its own bytes, which Docs does not load',
  'blob': 'it points at an object made inside a browser, which Docs does not load',
  'empty': 'it has no source',
  'malformed': 'its source holds a space, a control character or a backslash',
  'scheme': 'its source uses a scheme Docs does not load images from',
  'protocol-relative': 'its source names another host without a scheme',
  'root-relative': 'its source is a server path, not a document',
  'above-root': 'its source climbs above the repository',
  'bad-path': 'its source names a path Docs cannot address',
};

/** The rest of `DocImage`'s words (spec 4.11). `refused` is filled with `{reason}`, `loaderFailed` with `{error}`. */
export const DOC_IMAGE_TEXT = {
  refused: 'Image not loaded: {reason}',
  load: 'Load image',
  openExternal: 'Open image externally',
  openViewer: 'Open in viewer',
  draft: 'draft',
  uncommittedNotShown: 'uncommitted change not shown',
  loading: 'Loading image…',
  loaderFailed: 'Image not loaded: the request failed ({error}).',
} as const;

/** The `why` of a client-built `malformed-answer` when a docs-show answer holds no bytes in the field its encoding
 *  names (`downloadDocFile`, `DocImage`), and when an SVG path is answered as another class (`DocImage`). */
export const DOCS_SHOW_NO_BYTES = 'the answer held no bytes';
export const DOCS_SHOW_NOT_SVG = 'an SVG path was answered as another class';

/** The words of the index, project, section, directory and leaf views (spec 4.4, 4.7; refinements (b), (c), (r)).
 *  `{field}`s are filled by `fillSentence`; `{s}` is `''` for a count of one and `'s'` otherwise. The spec's own
 *  phrases are copied verbatim (docs-screen.test.tsx pins them); `redirectNullBranch` is refinement (c)'s sentence,
 *  which replaces spec 4.7's "that checkout is detached" because `branch: null` also covers an unmeasured read. */
export const DOCS_VIEW_TEXT = {
  indexHead: "Each project's default branch, read from the fleet box.",
  filterProjects: 'Filter projects',
  filterEntries: 'Filter this listing',
  noDocs: 'Projects with no docs ({n})',
  indexUnlisted: '{n} folder{s} not listed (names Docs cannot address).',
  indexUnwalked: '{n} project{s} not checked (Docs ran out of time listing them).',
  duplicate: 'same repository as {other}',
  partOf: 'part of {owner}',
  partOfUnknown: 'part of a repository outside the projects folder',
  fetched: 'fetched {age}',
  neverFetched: 'never fetched',
  sectionAbsent: 'not in this repository at {short}',
  sectionNotDir: 'is not a directory at {short}',
  sectionDrafts: '{n} draft{s}',
  sectionWithheld: '{n} withheld',
  treeUnlisted: '{n} file{s} not listed (names Docs cannot address).',
  opaque: 'Drafts inside nested repositories are not shown: {dirs}.',
  emptyListing: 'Nothing is listed here.',
  missing: 'Not in this listing at {short}.',
  openDraftView: 'Open the draft view',
  loading: 'Loading…',
  noPreview: 'No preview ({size})',
  htmlStandIn: 'HTML mockups open in a later release; Source shows the file and Download saves it.',
  size: 'Size: {size}',
  symlink: 'This is a symbolic link in the repository; Docs does not follow it.',
  submodule: 'This is a git submodule; Docs does not open it.',
  nothingToShow: 'There is no committed version of this file to show here.',
  changing: 'The listing changed while Docs read this file.',
  source: 'Source',
  download: 'Download',
  downloadFailed: 'Download failed: {sentence}',
  redirecting: 'Opening {owner}…',
  redirectNullBranch:
    "That checkout is not on a named branch, or its branch could not be read; showing {owner}'s default branch.",
  redirectBadBranch: "That checkout's branch {branch} is not one Docs can address; showing {owner}'s default branch.",
  redirectLoop: 'Docs did not follow it: the owner named for this folder leads back to this folder.',
  indexLink: 'Docs index',
} as const;

/** A count's plural suffix for `{s}`. */
export function pluralS(n: number): string {
  return n === 1 ? '' : 's';
}

/** The header's words (spec 4.4's layout; spec 4.5's truth line, freshness chip and actions; W5 part 1 Task 10). The
 *  chip's texts are spec 4.5's table, verbatim; the rest fill its silences in the same register. `{age}` and `{okAge}`
 *  are `formatAge`'s, `{n}` a count of whole seconds, `{sentence}` a failure's or a client slot's sentence, and
 *  `{badge}` is `ENTRY_BADGE_TEXT`'s (or `sourceDraftUnbadged`). */
export const DOCS_HEAD_TEXT = {
  back: 'Up one level',
  crumbs: 'Docs path',
  crumbsMore: 'Show the whole path',
  index: 'Docs',
  servedOrigin: 'origin/{name}',
  servedLocal: '{name} (local)',
  danglingHead: 'origin/HEAD points at a missing branch',
  copyCommit: 'copy commit',
  copied: 'copied',
  copyFailed: 'copy failed',
  sourceCommitted: 'committed',
  sourceViewCommitted: 'committed (view=committed)',
  sourceDraft: '{badge} in {label}',
  sourceDraftUnbadged: 'draft',
  sourceNone: 'nothing opened',
  updatedTo: 'Updated to {short}',
  github: 'View on GitHub',
  githubMayDiffer: "GitHub's copy may differ from this view",
  githubOff: 'View on GitHub: {reason}',
  openCommitted: 'Open committed version',
  freshNone: 'no origin',
  freshNever: 'never fetched ↻',
  freshOk: 'fetched {age} ↻',
  freshLocalOnly: 'local only ↻',
  freshFailed: 'fetch failed {age}: {sentence} · last good {okAge} ↻',
  freshNeverGood: 'never',
  freshFetching: 'fetching…',
  freshSoon: 'fetched moments ago; again in {n}s',
  freshStaleLock: 'stale lock on {ref}',
  freshStaleLockUnnamed: 'stale lock (the answer named no ref)',
  freshLocalRef: 'local ref; fetch does not change it',
  freshRelistFailed: 're-list failed: {sentence} ↻',
  freshRefreshFailed: 'refresh failed: {sentence} ↻',
  worktreeMain: 'main checkout',
  worktreeWorkspace: 'workspace {name}',
} as const;

/** Why View on GitHub gives no link (spec 3.11's refusals), as "View on GitHub: {reason}". */
export const GITHUB_REFUSAL_TEXT: Record<Extract<GithubLink, { ok: false }>['why'], string> = {
  'no-github-origin': 'no GitHub origin',
  'not-on-origin': 'not pushed',
  'uncommitted': 'not committed',
  'bad-slug': "the repository's GitHub name cannot be linked",
  'bad-target': 'this branch or path cannot be linked',
};

/** The banners' words (spec 4.5's table, verbatim; W5 part 1 Task 10). `{s}` is `pluralS`'s; `{label}` is
 *  `worktreeLabel`'s; `{served}` is `servedRefText`'s; `{why}` in `skipped` is the distinct reasons joined by `, `. */
export const DOCS_BANNER_TEXT = {
  defaultHint: '{n} uncommitted doc{s} in {label} on {branch}',
  baseHint: '{n} uncommitted doc{s} in {label} are based on local {branch} at {short}; this page shows {served}',
  openLocalView: 'Open the local view',
  ambiguous: 'Two or more worktrees hold {branch}, so drafts are not shown:',
  untrusted: 'The worktree holding {branch} failed the ownership check ({why}); drafts are not shown.',
  unreadable: 'Drafts could not be read ({step}); showing committed only.',
  unsettled: 'The worktree changed while Docs read it; showing committed only.',
  retry: 'Retry',
  tooMany: '{count} uncommitted files is over the limit; showing committed only.',
  skipped: '{k} worktree records for {branch} were skipped ({why}).',
  caveatHash: 'Some drafts were found by content hash.',
  caveatFilters: 'Clean/smudge filters were bypassed; drafts show raw working-tree bytes.',
  showingCommitted: 'Showing the committed version.',
  deleted: 'Deleted in {label} (uncommitted).',
  typechange: 'Its type changed in {label}; the draft is not read.',
  conflicted: 'Contains unresolved merge-conflict markers.',
  notContained: 'Commit {short} is no longer on {served} (the branch was rewritten).',
  relist: 'Re-list',
  draftAssets: 'This draft page embeds {k} uncommitted asset{s}.',
  viewCommitted: 'Showing the committed version at {short}.',
  backToDraft: 'Back to the draft',
} as const;

/** The served ref as the truth line and the banners name it (spec 4.5): `origin/<b>` when the origin side is served,
 *  `<b> (local)` when the local side is; the full refname (`ref.served`) goes in a `title` beside it. */
export function servedRefText(ref: DocsTreeOk['ref']): string {
  return fillSentence(ref.side === 'origin' ? DOCS_HEAD_TEXT.servedOrigin : DOCS_HEAD_TEXT.servedLocal, { name: ref.name });
}

/** A worktree as the truth line and the banners name it (spec 4.5): "main checkout", "workspace <last segment>", or
 *  the path's last two segments; the full path goes in a `title` beside it. */
export function worktreeLabel(w: { readonly path: string; readonly class: 'main' | 'workspace' | 'other' }): string {
  const parts = w.path.split('/').filter((s) => s !== '');
  switch (w.class) {
    case 'main':
      return DOCS_HEAD_TEXT.worktreeMain;
    case 'workspace':
      return fillSentence(DOCS_HEAD_TEXT.worktreeWorkspace, { name: parts.at(-1) ?? w.path });
    case 'other':
      return parts.slice(-2).join('/');
  }
}
