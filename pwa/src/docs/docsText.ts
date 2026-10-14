// Every sentence the Docs screen's part 1 shows for a word (spec 2026-10-01 4.5, 4.6, 4.7), each map keyed by the
// word's own type so a new word is a compile error until it has its sentence. `{field}` placeholders are filled by
// `fillSentence` from the failure's context or the caller's facts; a field that is absent renders `?`, never the
// braces. The spec's own sentences are copied verbatim (docs-failures.test.tsx pins them); the rest fill its
// silences in the same register: what happened, in the operator's words, and nothing the page cannot know.
import type {
  DocsFailure, DocsFailureBody, DocsFailureContext, DocsNotAFileKind, DocsPageParseFailure, DocsTreeOk, EntryBadge,
  WithheldReason,
} from '../../../shared/docs';
import { isDocsFailureWord, type DocsClientSlot } from './failures';

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
