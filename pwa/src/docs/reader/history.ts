// The reader's history decisions (native Docs reader, completion plan Task 12). Ring L1 policy: pure deciders over
// plain values, no I/O, no timer, no DOM, no React, no library import (the shapes below mirror the shared Markdown
// library's, which the type test holds equal) and no `lib/api.ts`. `bridge.ts` hands the answers to the frame and
// the Docs screen acts on them: this file decides and does nothing else.
import { READER_STORE_PREFIX } from '../../lib/readerLimits';
import { isDocsCommit, type DocPin, type DocsFailure, type DocsLogAsk, type DocsLogOk, type DocsShowOk } from '../../../../shared/docs';

/** One commit of the document, in the library's seed shape. */
export interface ReaderCommit {
  readonly sha: string;
  readonly subject: string;
  readonly date: string;
  readonly parents: readonly string[];
}

/** What the frame's version list is seeded with for one body: the served commit, whether it is a draft, the doc's
 *  history (`null`: none was supplied) and the day filter (`null`: none). */
export interface ReaderVersionSeed {
  readonly sha: string;
  readonly draft: boolean;
  readonly commits: readonly ReaderCommit[] | null;
  readonly only: string | null;
}

/** The most commits a seed carries (the library's own limit, which it does not export). */
export const READER_SEED_MAX_COMMITS = 100;
/** The most UTF-16 units a seeded subject keeps (the library's limit). */
export const READER_SEED_SUBJECT_MAX_UNITS = 200;
/** The most UTF-16 units a seeded date holds (the library's limit). */
export const READER_SEED_DATE_MAX_UNITS = 64;
/** The most parents a seeded commit lists (the library's limit; a log entry has at most one). */
export const READER_SEED_MAX_PARENTS = 16;

/** `s` cut to at most `READER_SEED_SUBJECT_MAX_UNITS` UTF-16 units. A cut that would fall between the halves of a
 *  surrogate pair takes the high half out too, so the subject never ends in a lone surrogate. */
function cutSubject(s: string): string {
  if (s.length <= READER_SEED_SUBJECT_MAX_UNITS) return s;
  let end = READER_SEED_SUBJECT_MAX_UNITS;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return s.slice(0, end);
}

const own = (o: object, k: string): boolean => Object.hasOwn(o, k);

/** One log entry as a seed commit, or `null` when it is malformed: not an object, or a field that is not its own, or
 *  a hash that is not a full commit, or a date over the limit, or a subject that is not text. */
function commitOf(e: unknown): ReaderCommit | null {
  if (typeof e !== 'object' || e === null) return null;
  if (!own(e, 'sha') || !own(e, 'parent') || !own(e, 'date') || !own(e, 'subject')) return null;
  const { sha, parent, date, subject } = e as Record<string, unknown>;
  if (typeof sha !== 'string' || !isDocsCommit(sha)) return null;
  if (parent !== null && (typeof parent !== 'string' || !isDocsCommit(parent))) return null;
  if (typeof date !== 'string' || date.length > READER_SEED_DATE_MAX_UNITS) return null;
  if (typeof subject !== 'string') return null;
  return { sha, subject: cutSubject(subject), date, parents: parent === null ? [] : [parent] };
}

/** The history a log gives the frame, or `null` for "no history". A log that ended short (`truncated` is anything but
 *  exactly `false`) may be missing changes and the frame cannot be told so, so it is not shown as the doc's history;
 *  and one malformed entry in the first `READER_SEED_MAX_COMMITS` voids the whole list, because dropping it would show
 *  an incomplete list as complete. Only own properties count. The log is newest first; entries past the cap are not read. */
function commitsOfLog(log: DocsLogOk | null): readonly ReaderCommit[] | null {
  if (log === null) return null;
  if (!own(log, 'truncated') || log.truncated !== false) return null;
  if (!own(log, 'entries') || !Array.isArray(log.entries)) return null;
  const commits: ReaderCommit[] = [];
  const n = Math.min(log.entries.length, READER_SEED_MAX_COMMITS);
  for (let i = 0; i < n; i += 1) {
    const c = commitOf(log.entries[i]);
    if (c === null) return null;
    commits.push(c);
  }
  return commits;
}

/** The hash a show was served at: a draft's head, a committed show's commit, `null` when the field is absent. It does not
 *  validate: `readerVersionSeed` refuses a value that is not a full commit. */
export function readerServedHash(show: Pick<DocsShowOk, 'source' | 'commit' | 'head'>): string | null {
  return (show.source === 'draft' ? show.head : show.commit) ?? null;
}

/** The log read a body asks for, or `null` for no read: a draft body, a draft pin, and a served hash that is not a full
 *  commit read none. The ask names the opened pin's commit, section and path. */
export function readerLogAsk(pin: DocPin, draft: boolean, served: string): DocsLogAsk | null {
  if (draft || pin.kind !== 'committed' || !isDocsCommit(served)) return null;
  return { commit: pin.commit, section: pin.section, path: pin.path };
}

/** The version seed for one body, or `null` when `sha` is not a full served commit (40 or 64 lower-case hex; a value
 *  is never cut or lower-cased into validity). `commits` is `null` when no history was supplied or it cannot be shown
 *  as complete. `only` is kept only when it is a full hash that some commit or some commit's parent has: the oldest
 *  day's baseline is the oldest commit's parent, which need not be an entry itself. */
export function readerVersionSeed(
  sha: string, draft: boolean, log: DocsLogOk | null, only: string | null,
): ReaderVersionSeed | null {
  if (!isDocsCommit(sha)) return null;
  const commits = commitsOfLog(log);
  const kept = only !== null && commits !== null && isDocsCommit(only)
    && commits.some((c) => c.sha === only || c.parents.includes(only));
  return { sha, draft: draft === true, commits, only: kept ? only : null };
}

/** A field of a version request: absent, `undefined` and `null` are none (`null`); a full hash is itself; anything
 *  else is `'refused'`. Only an own property counts. */
function moveField(v: object, key: 'sha' | 'only'): string | null | 'refused' {
  if (!own(v, key)) return null;
  const x: unknown = (v as Record<string, unknown>)[key];
  if (x === undefined || x === null) return null;
  return typeof x === 'string' && isDocsCommit(x) ? x : 'refused';
}

/** The decision behind the frame's `version` operation (rich-docs spec M8.22): `at` is the commit to open the page
 *  at (`null`: the latest) and `only` the day filter, which goes in the visit's `history.state` and never in the URL.
 *  A field that is present and not a full hash refuses the whole request (`null`). */
export function readerVersionMove(
  v: { readonly sha?: string | null; readonly only?: string | null },
): { readonly at: string | null; readonly only: string | null } | null {
  const at = moveField(v, 'sha');
  const only = moveField(v, 'only');
  return at === 'refused' || only === 'refused' ? null : { at, only };
}

/** The pin a `changes(sha)` reads its base from (rich-docs spec G5): the same doc at any full commit, read through a
 *  committed pin. A draft pin answers `null` (unavailable), as does a hash that is not a full commit. */
export function readerChangesBase(pin: DocPin, sha: string): DocPin | null {
  if (pin.kind !== 'committed' || !isDocsCommit(sha)) return null;
  return { kind: 'committed', commit: sha, servedRef: pin.servedRef, section: pin.section, path: pin.path };
}

/** The key of a document's comparison base in the tab's session storage (X2 P5.4, parity spec 5.6): under the reader prefix, one
 *  value per doc, never in page storage (so another tab of the device starts without it). */
export function readerDocChangesBaseKey(docKey: string): string {
  return `${READER_STORE_PREFIX}changes-base:${docKey}`;
}

/** The key of the library's own per-doc `seen` field (`{ sha, at }`, the last visit) in page storage: `<prefix>doc:<docKey>:<field>`. */
export function readerSeenKey(docKey: string): string {
  return `${READER_STORE_PREFIX}doc:${docKey}:seen`;
}

/** The sha of the last visit as the library keeps it under `seen` (JSON `{ sha, at }`), read as a value and never trusted for its
 *  shape: a full sha, lower-cased, else `null` (absent, unparsable, not an object, no `sha`, or a `sha` that is not a full one). */
export function readerSeenSha(raw: string | null): string | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v) || !own(v, 'sha')) return null;
  const sha: unknown = (v as Record<string, unknown>)['sha'];
  if (typeof sha !== 'string') return null;
  const lower = sha.toLowerCase();
  return isDocsCommit(lower) ? lower : null;
}

/** The sha a `changes(sha)` request records as the doc's comparison base, or `null` for none (the library's own rule, its README's
 *  "Which request to record", binding): the frame asks `changes` unprompted only for the shas the host seeded into that mount, so a
 *  request is a pick of the reader's own only when its sha is none of them (compared in lower case) and the mount is not a one-day
 *  version (`only` set: the day's sha is the only one such a mount asks). `seeded` is every sha the host seeded into any library mount
 *  of this body, each as the mount was made with it (the last visit's sha the frame then read from `seen`, and the `changesBase`;
 *  the frame moves `seen` itself before it asks, so no later reading stands for it). The answer is lower case, and only a full sha is
 *  ever recorded. */
export function readerChangesBaseToRecord(
  sha: string, seeded: { readonly seeded: Iterable<string>; readonly only: string | null },
): string | null {
  if (seeded.only !== null) return null;
  const lower = typeof sha === 'string' ? sha.toLowerCase() : '';
  if (!isDocsCommit(lower)) return null;
  for (const s of seeded.seeded) if (s.toLowerCase() === lower) return null;
  return lower;
}

/** The server's word for a path that does not exist at the commit asked (the docs-show failure `absent-path`). */
const ABSENT_PATH = 'absent-path' satisfies DocsFailure;

/** One committed pin's file read, as `readerChangesTexts` takes it (rich-docs spec G5): the Markdown text at that commit,
 *  the server's failure word exactly as it was sent (a word this build knows, or a newer server's), or `unavailable` for
 *  everything else: a client slot, a rejection or an abort, and a body that is not Markdown text. The adapter keeps the
 *  word, so what it means is decided here. */
export type ReaderPinRead =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'failed'; readonly failure: string }
  | { readonly kind: 'unavailable' };

/** The two texts one `changes` call compares, or `null` for unavailable (rich-docs spec G5; the completion spec's Version
 *  callback row). The head must be text, and exactly the text the frame rendered, because the marks are keyed to those
 *  bytes: any other head, an absent doc's included, is not this body's. The base is its text, or the empty text when the
 *  doc does not exist at the base commit (`absent-path`, and only that word): the oldest day's baseline is the parent of
 *  the commit that first touched the path, so there every line of the head is new. Any other base is unavailable. */
export function readerChangesTexts(
  base: ReaderPinRead, head: ReaderPinRead, rendered: string,
): { readonly before: string; readonly after: string } | null {
  const after = head.kind === 'text' ? head.text : null;
  if (after === null || after !== rendered) return null;
  const before = base.kind === 'text' ? base.text : base.kind === 'failed' && base.failure === ABSENT_PATH ? '' : null;
  return before === null ? null : { before, after };
}
