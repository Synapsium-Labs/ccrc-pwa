/**
 * THE OPERATION TABLE (#1444, D-7669, D-7670, D-7682 R5, R7, R9; spec 2026-10-31 §4.4, §4.5, §5.3, §5.4, §6.4, §6.5,
 * §6.8): the closed allow-list of what a workspace key can run, with each verb's body validator and its shaper.
 *
 * L1 POLICY: pure and total. It imports L0 modules and types only, makes no I/O and never calls Linear; the proxy
 * routes (a later task) call Linear with what it builds, and shape what Linear answers with it.
 *
 * NEVER A PASSTHROUGH (§6.4). {@link LINEAR_OPS} has one row per verb. Every GraphQL document is a constant of this
 * file ({@link LINEAR_DOCUMENTS}), and no caller field becomes part of one: a route accepts no document, field list,
 * operation name or variable that a row does not build. A write row's document is one mutation (`issueCreate`,
 * `issueUpdate` or `commentCreate`) taking resolved UUIDs (§4.5); a resolve document and every read document is a
 * query. A route's class is its row's, never its HTTP method's.
 *
 * CLOSED BODIES (§5.2, §5.3). The validators run over the parsed object, so they see keys as JSON defines them, not as
 * they are spelled on the wire (`"byId"` is `byId` by then). An unknown field is `bad-field`, never dropped, and
 * `byId`, `byUuid` and `workspace` are refused by name in every body: identity travels only in the query, which the
 * route's `onRequest` checks, and the workspace only as a declared query key.
 *
 * LINEAR'S TEXT IS DATA (§5.4, §6.5). A shaper picks only the fields §5.4 names, and anything else is `malformed`.
 * Titles, descriptions and comment bodies are answered only under `untrusted`. Every one-line string passes
 * `stripLine` and every markdown field `stripMultiline` ({@link LINEAR_STRIPS}, a column of this table), and every
 * Linear-sourced name passes `cleanName`, in answers and in refusal details alike. `url` is built here from the slot's
 * URL key and the shaped identifier, never taken from Linear's answer.
 *
 * WHAT IS NOT YET RECORDED (D-7684, the coordinator's FX capture; the ruling of 2026-11-01 lands this without it).
 * The documents below are written from the spec's shapes and are not yet held, byte for byte, against a recorded
 * answer; no `X-Complexity` value is known for any of them, so the page sizes are the spec's (250 a directory page)
 * and none is computed here. The create input's caller-chosen `id` is not confirmed, so `requestId` is not a create
 * field (`slug linear-create-request-id`). The GraphQL error-code table holds only `RATELIMITED`, from Linear's
 * published rate-limiting page; the codes for a forbidden, an invalid and a missing entity wait for FX's recorded error
 * answers, and until then every other code is `unreachable`.
 */
import { isLinearTeamKey, isLinearUrlKey, isLinearUuid } from '../../../shared/linear.js';
import { LINEAR_NAME_MAX_CHARS, cleanName, stripLine, stripMultiline } from '../../../shared/unprintable.js';
import { redactLinearText } from '../coord/redact.js';
import type { LinearRouteAsk } from './route.js';

// ── the verbs ──

/** The twelve verbs (spec §5.1), in the client's row order. THE ONE LIST: the table below has one row per entry. */
export const LINEAR_VERBS = [
  'workspaces', 'teams', 'issue', 'search', 'comments', 'statuses', 'projects', 'labels', 'users', 'create', 'update', 'comment',
] as const;
export type LinearVerb = (typeof LINEAR_VERBS)[number];
export type LinearOpClass = 'read' | 'write';
/** A declared query key (§5.1). `byId` and `byUuid` are never one: the route's `onRequest` reads them. */
export type LinearQueryKey = 'workspace' | 'team' | 'limit' | 'after';
/** The identity pair the route's `onRequest` checks; the query validator leaves them to it. */
export const LINEAR_IDENTITY_QUERY_KEYS = ['byId', 'byUuid'] as const;

// ── the grammars and bounds (spec §5.1, §5.3, §5.4) ──

/** An issue identifier (`AAA-12`): a team key, a hyphen and the issue's number. The team key is bounded as the
 *  journal bounds it (`journal.ts`), so every identifier this table accepts is one the journal can record. */
export const LINEAR_IDENTIFIER_SHAPE = /^[A-Za-z][A-Za-z0-9_]{0,15}-[0-9]{1,9}$/;
export const isLinearIdentifier = (v: unknown): v is string => typeof v === 'string' && LINEAR_IDENTIFIER_SHAPE.test(v);

/** `title`: 1 to 255 characters (code points). */
export const LINEAR_TITLE_MAX_CHARS = 255;
/** `description`: markdown, at most 64 KiB (UTF-8 bytes), on the way out and as answered (longer is cut and flagged). */
export const LINEAR_DESCRIPTION_MAX_BYTES = 64 * 1024;
/** A comment's `body`: markdown, 1 byte to 16 KiB. */
export const LINEAR_COMMENT_MAX_BYTES = 16 * 1024;
/** `search.text`: at most 256 characters. */
export const LINEAR_SEARCH_TEXT_MAX_CHARS = 256;
/** `labels`, `addLabels`, `removeLabels`: at most 20 names or ids each. */
export const LINEAR_LABELS_MAX = 20;
/** `priority`: Linear's 0 (none) to 4 (low). */
export const LINEAR_PRIORITY_MAX = 4;
/** A list's `limit`: 1 to 50, 25 when absent (§5.3's `search`; the other list verbs take the same bounds). */
export const LINEAR_LIST_LIMIT = { min: 1, max: 50, default: 25 } as const;
/** The most labels an issue's answer names. */
export const LINEAR_ISSUE_LABELS_MAX = 50;
/** The most entries a `statuses` or `labels` answer lists: one page, no cursor (§5.1 gives them no `limit`). */
export const LINEAR_SMALL_LIST_MAX = 250;
/** The longest Linear cursor taken back to it (the key check's bound, `client.ts`). */
export const LINEAR_CURSOR_MAX_CHARS = 512;
/** A name a caller sends (a state, a label, a project, a user): Linear's names are kept at this length (`cleanName`). */
export const LINEAR_NAME_FIELD_MAX_CHARS = LINEAR_NAME_MAX_CHARS;

/** The directory's page size and cap (spec §4.4, R5): 250 entries a page, up to 4 pages a collection, so at most 1,000
 *  of each. Past the cap a name is a known limit whose remedy is its id. The FX capture records each page's
 *  `X-Complexity`, and the spec's rule is that it stays under `LINEAR_QUOTA.maxQueryComplexity`: a page that would not
 *  is lowered HERE, never at run time. */
export const LINEAR_DIRECTORY_PAGE_SIZE = 250;
export const LINEAR_DIRECTORY_MAX_PAGES = 4;

/** Linear's web origin: the one place an issue's `url` points (§5.4). Written alone, never joined with a path. */
export const LINEAR_WEB_ORIGIN = 'https://linear.app';

/** THE PROVENANCE LINE (spec §5.4, R7): appended, after a blank line, to every comment body and to every description a
 *  create or an update sends, after the `linear-egress` pass. It names no session, account, box, workspace or team. */
export const LINEAR_PROVENANCE_LINE = '— written by a ccrc fleet session';

/** Which strip each shaped string takes (spec §6.5): `line` for every one-line string, `multiline` for the two
 *  markdown fields only. A column of the shaper's table; `linear-ops.test.ts` pins it. */
export const LINEAR_STRIPS = Object.freeze({
  identifier: 'line', title: 'line', name: 'line', urlKey: 'line', team: 'line', type: 'line',
  description: 'multiline', body: 'multiline',
} as const satisfies Record<string, 'line' | 'multiline'>);
type StripField = keyof typeof LINEAR_STRIPS;
const strip = (field: StripField, s: string): string => (LINEAR_STRIPS[field] === 'line' ? stripLine(s) : stripMultiline(s));

// ── the documents (spec §4.4, §4.5, §6.4) ──

/** The issue fields every issue answer asks for (§5.4's issue, before shaping). */
const ISSUE_FIELDS = 'id identifier title description priority createdAt updatedAt team { key } state { name type } '
  + `assignee { name } labels(first: ${LINEAR_ISSUE_LABELS_MAX}) { nodes { name } } project { name } parent { identifier }`;
/** A search item's: the same without the description. */
const SEARCH_FIELDS = 'id identifier title priority createdAt updatedAt team { key } state { name type } '
  + `assignee { name } labels(first: ${LINEAR_ISSUE_LABELS_MAX}) { nodes { name } } project { name } parent { identifier }`;
const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';
/** What a resolve selects of an issue (§4.5, R9): its id, its current identifier and its current team. */
const RESOLVED_FIELDS = 'id identifier team { id key }';

/**
 * EVERY DOCUMENT THE KEY CAN RUN, each a constant written here. The census (`linear-ops.test.ts`) holds that every
 * row's document and resolve documents, and every directory page, is one of these, and that a mutation appears only as
 * a write row's operation document.
 */
export const LINEAR_DOCUMENTS = Object.freeze({
  issue: `query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`,
  search: 'query Search($filter: IssueFilter, $first: Int!, $after: String, $includeArchived: Boolean) { '
    + `issues(filter: $filter, first: $first, after: $after, includeArchived: $includeArchived) { nodes { ${SEARCH_FIELDS} } ${PAGE_INFO} } }`,
  comments: 'query Comments($id: String!, $first: Int!, $after: String) { issue(id: $id) { '
    + `comments(first: $first, after: $after) { nodes { id body createdAt user { name } } ${PAGE_INFO} } } }`,
  statuses: 'query Statuses($filter: WorkflowStateFilter) { '
    + `workflowStates(filter: $filter, first: ${LINEAR_SMALL_LIST_MAX}) { nodes { id name type team { key } } } }`,
  projects: 'query Projects($filter: ProjectFilter, $first: Int!, $after: String) { '
    + `projects(filter: $filter, first: $first, after: $after) { nodes { id name } ${PAGE_INFO} } }`,
  labels: 'query Labels($filter: IssueLabelFilter) { '
    + `issueLabels(filter: $filter, first: ${LINEAR_SMALL_LIST_MAX}) { nodes { id name team { key } } } }`,
  users: `query Users($first: Int!, $after: String) { users(first: $first, after: $after) { nodes { id name displayName active } ${PAGE_INFO} } }`,
  create: `mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
  update: 'mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) { '
    + `issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
  comment: 'mutation CommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id createdAt } } }',
  resolveIssue: `query ResolveIssue($id: String!) { issue(id: $id) { ${RESOLVED_FIELDS} } }`,
  resolveIssueAndParent: 'query ResolveIssueAndParent($id: String!, $parent: String!) { '
    + `issue(id: $id) { ${RESOLVED_FIELDS} } parent: issue(id: $parent) { ${RESOLVED_FIELDS} } }`,
  resolveParent: `query ResolveParent($parent: String!) { parent: issue(id: $parent) { ${RESOLVED_FIELDS} } }`,
  directoryStates: 'query DirectoryStates($after: String) { '
    + `workflowStates(first: ${LINEAR_DIRECTORY_PAGE_SIZE}, after: $after) { nodes { id name type team { key } } ${PAGE_INFO} } }`,
  directoryLabels: 'query DirectoryLabels($after: String) { '
    + `issueLabels(first: ${LINEAR_DIRECTORY_PAGE_SIZE}, after: $after) { nodes { id name team { key } } ${PAGE_INFO} } }`,
  directoryProjects: 'query DirectoryProjects($after: String) { '
    + `projects(first: ${LINEAR_DIRECTORY_PAGE_SIZE}, after: $after) { nodes { id name } ${PAGE_INFO} } }`,
  directoryUsers: 'query DirectoryUsers($after: String) { viewer { id } '
    + `users(first: ${LINEAR_DIRECTORY_PAGE_SIZE}, after: $after) { nodes { id name displayName active } ${PAGE_INFO} } }`,
} as const);

/** The four directory collections, in the order the refresher reads them, each with its page document. */
export const LINEAR_DIRECTORY_COLLECTIONS = ['states', 'labels', 'projects', 'users'] as const;
export type LinearDirectoryCollection = (typeof LINEAR_DIRECTORY_COLLECTIONS)[number];
export const LINEAR_DIRECTORY_DOCUMENTS: Readonly<Record<LinearDirectoryCollection, string>> = Object.freeze({
  states: LINEAR_DOCUMENTS.directoryStates,
  labels: LINEAR_DOCUMENTS.directoryLabels,
  projects: LINEAR_DOCUMENTS.directoryProjects,
  users: LINEAR_DOCUMENTS.directoryUsers,
});

// ── the GraphQL error codes (spec §6.8) ──

/** The words a Linear answer can end in, beyond the call's own (`callLinear`'s arms). */
export type LinearAnswerRefusalWord =
  | 'not-found' | 'malformed' | 'unreachable' | 'rate-limited' | 'linear-forbidden' | 'linear-invalid';

/**
 * THE CLOSED ERROR-CODE TABLE: an `errors` entry's `extensions.code`, mapped to a refusal word. Anything not in it is
 * `unreachable`, and Linear's message is never forwarded. `RATELIMITED` is from Linear's published rate-limiting page
 * (its developer documentation, "Rate limiting"), which says a request over the limit is refused with that code in its
 * `errors` array; it cannot be provoked safely, so its test answer is LK2's constructed one (`RATELIMITED_ERRORS`).
 * The codes for `linear-forbidden`, `linear-invalid` and `not-found` join from the FX capture's recorded error answers
 * (D-7684); none is written here before it records them.
 */
export const LINEAR_ERROR_CODES: Readonly<Record<string, Exclude<LinearAnswerRefusalWord, 'malformed' | 'unreachable'>>> =
  Object.freeze({ RATELIMITED: 'rate-limited' });

// ── what a validated call is ──

/** A validated body's fields: each one §5.3 names, already checked against its bounds. */
export interface LinearBodyFields {
  text?: string;
  title?: string;
  description?: string;
  body?: string;
  state?: string;
  priority?: number;
  /** A name, `me`, a UUID, or (update only) null, which unassigns. */
  assignee?: string | null;
  label?: string;
  labels?: string[];
  addLabels?: string[];
  removeLabels?: string[];
  project?: string;
  parent?: string;
  includeArchived?: boolean;
}

/** A call, validated (§5.3): what the route routes, resolves, asks the policy about and sends. */
export interface LinearOpInput {
  op: LinearVerb;
  /** The issue reference from the path (`issue`, `comments`, `update`, `comment`), or null. */
  ref: string | null;
  /** The `workspace` query key, a URL key, or null. */
  workspace: string | null;
  /** The team: the `team` query key, or a body's `team` (`search`, `create`), uppercased; or null. */
  team: string | null;
  /** A list's page size, its default applied; null for a verb that takes none. */
  limit: number | null;
  /** Linear's own cursor, decoded from the `after` the caller sent back; null for the first page. */
  after: string | null;
  fields: LinearBodyFields;
}

/** Why a call was refused before routing: `bad-field` names the field (an unknown one, one no body may carry, or one
 *  out of its bounds); `bad-request` is a body that is not an object, or an update that changes nothing. */
export type LinearValidationRefusal =
  | { ok: false; word: 'bad-field'; field: string | null }
  | { ok: false; word: 'bad-request'; field: string | null };
export type LinearValidated = { ok: true; input: LinearOpInput } | LinearValidationRefusal;

/** A refusal's field name, when it is one a reader can be told: a field the caller sent is the caller's own text, so
 *  only a plain identifier is echoed. */
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const fieldRefusal = (field: string): LinearValidationRefusal =>
  ({ ok: false, word: 'bad-field', field: FIELD_NAME.test(field) ? field : null });

/** The fields no body may carry, whatever else it holds (§5.2, §5.3). */
export const LINEAR_FORBIDDEN_BODY_FIELDS = ['byId', 'byUuid', 'workspace'] as const;

// ── the field rules ──

type FieldRule = (v: unknown) => { ok: true; value: unknown } | { ok: false };
const ok = (value: unknown): { ok: true; value: unknown } => ({ ok: true, value });
const NO = { ok: false } as const;

const chars = (s: string): number => [...s].length;
const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

const textRule = (min: number, maxChars: number): FieldRule => (v) =>
  (typeof v === 'string' && chars(v) >= min && chars(v) <= maxChars ? ok(v) : NO);
const markdownRule = (minBytes: number, maxBytes: number): FieldRule => (v) =>
  (typeof v === 'string' && bytes(v) >= minBytes && bytes(v) <= maxBytes ? ok(v) : NO);
const nameRule: FieldRule = (v) => (typeof v === 'string' && v.trim() !== '' && chars(v) <= LINEAR_NAME_FIELD_MAX_CHARS ? ok(v) : NO);
const namesRule: FieldRule = (v) => {
  if (!Array.isArray(v) || v.length > LINEAR_LABELS_MAX) return NO;
  for (const n of v) if (!nameRule(n).ok) return NO;
  return ok([...v] as string[]);
};
const teamRule: FieldRule = (v) => (isLinearTeamKey(v) ? ok(v.toUpperCase()) : NO);
const refRule: FieldRule = (v) => (isLinearIdentifier(v) ? ok(v) : NO);
const boolRule: FieldRule = (v) => (typeof v === 'boolean' ? ok(v) : NO);
const priorityRule: FieldRule = (v) =>
  (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= LINEAR_PRIORITY_MAX ? ok(v) : NO);
const limitRule: FieldRule = (v) =>
  (typeof v === 'number' && Number.isInteger(v) && v >= LINEAR_LIST_LIMIT.min && v <= LINEAR_LIST_LIMIT.max ? ok(v) : NO);
const nullableName: FieldRule = (v) => (v === null ? ok(null) : nameRule(v));

/** A cursor as a session holds it: base64url, no padding, so it passes the client's SAFE_RE (§5.4). */
const CURSOR_WIRE = /^[A-Za-z0-9_-]{1,700}$/;
/** `next`: Linear's cursor encoded so that it comes back as `--after`. */
export const encodeLinearCursor = (cursor: string): string => Buffer.from(cursor, 'utf8').toString('base64url');
/** The cursor a session sent back, decoded; null for anything that is not one this server encoded. */
export function decodeLinearCursor(wire: unknown): string | null {
  if (typeof wire !== 'string' || !CURSOR_WIRE.test(wire)) return null;
  const s = Buffer.from(wire, 'base64url').toString('utf8');
  if (s.length === 0 || s.length > LINEAR_CURSOR_MAX_CHARS || encodeLinearCursor(s) !== wire) return null;
  return s;
}
const cursorRule: FieldRule = (v) => {
  const c = decodeLinearCursor(v);
  return c === null ? NO : ok(c);
};

/** Each body's fields and their rules (§5.3), and which are required. `create` takes no `requestId` until the FX
 *  capture's introspection confirms the create input takes a caller-chosen id (`slug linear-create-request-id`). */
const BODIES: Readonly<Partial<Record<LinearVerb, { fields: Readonly<Record<string, FieldRule>>; required: readonly string[] }>>> = {
  search: {
    fields: {
      team: teamRule, text: textRule(1, LINEAR_SEARCH_TEXT_MAX_CHARS), state: nameRule, assignee: nameRule, label: nameRule,
      project: nameRule, includeArchived: boolRule, limit: limitRule, after: cursorRule,
    },
    required: [],
  },
  create: {
    fields: {
      team: teamRule, title: textRule(1, LINEAR_TITLE_MAX_CHARS), description: markdownRule(0, LINEAR_DESCRIPTION_MAX_BYTES),
      state: nameRule, priority: priorityRule, assignee: nameRule, labels: namesRule, project: nameRule, parent: refRule,
    },
    required: ['team', 'title'],
  },
  update: {
    fields: {
      title: textRule(1, LINEAR_TITLE_MAX_CHARS), description: markdownRule(0, LINEAR_DESCRIPTION_MAX_BYTES), state: nameRule,
      priority: priorityRule, assignee: nullableName, labels: namesRule, addLabels: namesRule, removeLabels: namesRule,
      project: nameRule, parent: refRule,
    },
    required: [],
  },
  comment: { fields: { body: markdownRule(1, LINEAR_COMMENT_MAX_BYTES) }, required: ['body'] },
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ── the table ──

/** What the routed call knows when it builds its variables: the routed slot's teams (from its record), what the
 *  resolve found (§4.5), and the slot's directory (§4.4), or null while it is not filled. */
export interface LinearOpContext {
  teams: readonly { id: string; key: string }[];
  resolved: LinearResolved | null;
  directory: LinearDirectoryEntries | null;
}

/** A row's variables, or why a name or the team could not be turned into an id. `name-unknown` and `name-ambiguous`
 *  are the directory's answers (§4.4): the route asks the refresher for the detail (`refreshing` or `unknown`). */
export type LinearVariables =
  | { ok: true; vars: Record<string, unknown>; fields: string[] }
  | { ok: false; word: 'name-unknown'; field: string }
  | { ok: false; word: 'name-ambiguous'; field: string; candidates: string[] }
  | { ok: false; word: 'team-unknown' }
  /** A write built before its resolve ran: the route's own ordering fault, never a session's answer. */
  | { ok: false; word: 'unresolved' };

/** What a shaper is given beside Linear's answer: the slot's URL key (for `url` and `workspace`) and the items a fleet
 *  write created (`LinearJournal.viaFleet` over the row's {@link LinearCallRow.fleetKeys}). */
export interface LinearShapeContext {
  urlKey: string;
  fleet: ReadonlySet<string>;
}

/** A shaped answer, with what the journal's `result` takes on an `ok` write (the created identifier or comment id). */
export type LinearShaped =
  | { ok: true; answer: Record<string, unknown>; result: string | null }
  | { ok: false; word: LinearAnswerRefusalWord; detail?: 'parent' };

interface RowCommon {
  readonly op: LinearVerb;
  readonly class: LinearOpClass;
  readonly method: 'GET' | 'POST';
  /** Whether the path carries an issue reference. */
  readonly ref: boolean;
  readonly query: readonly LinearQueryKey[];
  /** The body's fields, or null: a GET takes no body. */
  readonly body: readonly string[] | null;
}

/** A verb answered from the store, with no Linear call: `workspaces` and `teams` list what the slots' records hold. */
export interface LinearStoreRow extends RowCommon { readonly source: 'store'; readonly document: null }

/** A verb that runs one of this file's documents. */
export interface LinearCallRow extends RowCommon {
  readonly source: 'linear';
  /** The operation's one document: a query for a read, one mutation for a write. */
  readonly document: string;
  /** The resolve documents the row may send first (§4.5); empty for a read. */
  readonly resolves: readonly string[];
  readonly variables: (input: LinearOpInput, ctx: LinearOpContext) => LinearVariables;
  readonly shape: (body: unknown, ctx: LinearShapeContext) => LinearShaped;
  /** The identifiers or comment ids in Linear's answer that `viaFleet` asks the journal about. */
  readonly fleetKeys: (body: unknown) => string[];
}
export type LinearOpRow = LinearStoreRow | LinearCallRow;

// ── names from the directory (spec §4.4) ──

/** One workspace's directory: its workflow states (each with its team's key), labels (a team's, or the workspace's
 *  when `teamKey` is null), projects and active users, and the key's own user (`assignee: "me"`). Names are cleaned. */
export interface LinearDirectoryEntries {
  viewerId: string | null;
  states: readonly { id: string; name: string; type: string; teamKey: string }[];
  labels: readonly { id: string; name: string; teamKey: string | null }[];
  projects: readonly { id: string; name: string }[];
  users: readonly { id: string; name: string; displayName: string | null }[];
}

export type LinearNameKind = 'state' | 'label' | 'project' | 'user';
export type LinearNameLookup =
  | { kind: 'id'; id: string }
  | { kind: 'miss' }
  | { kind: 'ambiguous'; candidates: string[] };

/** Two names alike: each as `cleanName` keeps it, without regard to case. */
const same = (a: string, b: string): boolean => (cleanName(a) ?? '').toLowerCase() === (cleanName(b) ?? '').toLowerCase();

/**
 * A name, turned into Linear's id (§4.4). A value that matches the UUID pattern skips the directory and goes to Linear
 * as given. `me`, for a user, is the key's own user. Names are matched without regard to case, within `team` where
 * one is known (a state is a team's; a label is a team's or the workspace's). No match, or a directory not yet filled,
 * is a miss; two or more is ambiguous, and the candidates are cleaned names (a state's with its team key).
 */
export function lookupLinearName(
  dir: LinearDirectoryEntries | null, kind: LinearNameKind, value: string, team: string | null,
): LinearNameLookup {
  if (isLinearUuid(value)) return { kind: 'id', id: value };
  if (kind === 'user' && value === 'me') return dir?.viewerId != null ? { kind: 'id', id: dir.viewerId } : { kind: 'miss' };
  if (dir === null) return { kind: 'miss' };
  const want = cleanName(value);
  if (want === null) return { kind: 'miss' };
  let hits: { id: string; shown: string }[];
  switch (kind) {
    case 'state':
      hits = dir.states.filter((s) => same(s.name, want) && (team === null || same(s.teamKey, team)))
        .map((s) => ({ id: s.id, shown: `${s.name} (${s.teamKey})` }));
      break;
    case 'label':
      hits = dir.labels.filter((l) => same(l.name, want) && (team === null || l.teamKey === null || same(l.teamKey, team)))
        .map((l) => ({ id: l.id, shown: l.teamKey === null ? l.name : `${l.name} (${l.teamKey})` }));
      break;
    case 'project':
      hits = dir.projects.filter((p) => same(p.name, want)).map((p) => ({ id: p.id, shown: p.name }));
      break;
    case 'user':
      hits = dir.users.filter((u) => same(u.name, want) || (u.displayName !== null && same(u.displayName, want)))
        .map((u) => ({ id: u.id, shown: u.displayName === null ? u.name : `${u.name} (${u.displayName})` }));
      break;
  }
  const ids = [...new Set(hits.map((h) => h.id))];
  if (ids.length === 0) return { kind: 'miss' };
  if (ids.length === 1) return { kind: 'id', id: ids[0]! };
  const candidates = hits.map((h) => cleanName(h.shown)).filter((n): n is string => n !== null);
  return { kind: 'ambiguous', candidates: [...new Set(candidates)].sort() };
}

// ── the resolve (spec §4.5) ──

/** One issue as the resolve found it: its UUID, its current identifier, and its current team. */
export interface LinearResolvedIssue { id: string; identifier: string; teamId: string; teamKey: string }
export interface LinearResolved { issue: LinearResolvedIssue | null; parent: LinearResolvedIssue | null }

/** What a write resolves before the policy point, or null for a call that resolves nothing (every read; a create with
 *  no parent). One document, so the resolve is one Linear call. */
export interface LinearResolvePlan {
  document: string;
  variables: Record<string, unknown>;
  issue: boolean;
  parent: boolean;
}

export function linearResolvePlan(input: LinearOpInput): LinearResolvePlan | null {
  const parent = input.fields.parent ?? null;
  if (input.op === 'comment' || (input.op === 'update' && parent === null)) {
    return { document: LINEAR_DOCUMENTS.resolveIssue, variables: { id: input.ref }, issue: true, parent: false };
  }
  if (input.op === 'update') {
    return { document: LINEAR_DOCUMENTS.resolveIssueAndParent, variables: { id: input.ref, parent }, issue: true, parent: true };
  }
  if (input.op === 'create' && parent !== null) {
    return { document: LINEAR_DOCUMENTS.resolveParent, variables: { parent }, issue: false, parent: true };
  }
  return null;
}

/** An `errors` array's word, through the closed table; null when the answer carries none. */
export function linearErrorWord(body: unknown): Exclude<LinearAnswerRefusalWord, 'malformed'> | null {
  if (!isPlainObject(body) || !Array.isArray(body['errors']) || body['errors'].length === 0) return null;
  for (const e of body['errors']) {
    const code = isPlainObject(e) && isPlainObject(e['extensions']) ? e['extensions']['code'] : undefined;
    if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(LINEAR_ERROR_CODES, code)) return LINEAR_ERROR_CODES[code]!;
  }
  return 'unreachable';
}

const resolvedIssueOf = (v: unknown): LinearResolvedIssue | 'malformed' => {
  if (!isPlainObject(v) || !isPlainObject(v['team'])) return 'malformed';
  const identifier = typeof v['identifier'] === 'string' ? strip('identifier', v['identifier']) : '';
  const teamKey = typeof v['team']['key'] === 'string' ? strip('team', v['team']['key']).toUpperCase() : '';
  if (!isLinearUuid(v['id']) || !isLinearIdentifier(identifier) || !isLinearUuid(v['team']['id']) || !isLinearTeamKey(teamKey)) {
    return 'malformed';
  }
  return { id: v['id'], identifier, teamId: v['team']['id'], teamKey };
};

/** The resolve's answer (§4.5): the issue and the parent the plan asked for, or why there is none. An issue Linear does
 *  not find is `not-found`; a parent it does not find is `not-found` with the detail `parent`. */
export function shapeLinearResolve(
  body: unknown, plan: Pick<LinearResolvePlan, 'issue' | 'parent'>,
): { ok: true; resolved: LinearResolved } | { ok: false; word: LinearAnswerRefusalWord; detail?: 'parent' } {
  const err = linearErrorWord(body);
  if (err !== null) return { ok: false, word: err };
  if (!isPlainObject(body) || !isPlainObject(body['data'])) return { ok: false, word: 'malformed' };
  const data = body['data'];
  let issue: LinearResolvedIssue | null = null;
  let parent: LinearResolvedIssue | null = null;
  if (plan.issue) {
    if (!('issue' in data)) return { ok: false, word: 'malformed' };
    if (data['issue'] === null) return { ok: false, word: 'not-found' };
    const r = resolvedIssueOf(data['issue']);
    if (r === 'malformed') return { ok: false, word: 'malformed' };
    issue = r;
  }
  if (plan.parent) {
    if (!('parent' in data)) return { ok: false, word: 'malformed' };
    if (data['parent'] === null) return { ok: false, word: 'not-found', detail: 'parent' };
    const r = resolvedIssueOf(data['parent']);
    if (r === 'malformed') return { ok: false, word: 'malformed' };
    parent = r;
  }
  return { ok: true, resolved: { issue, parent } };
}

/** The reference's prefix, uppercased: the routing hint, never the issue's team (§4.5). */
export const linearRefPrefix = (ref: string): string => ref.slice(0, ref.lastIndexOf('-')).toUpperCase();

/**
 * A write's moved-issue rule (§4.5): when the resolved team's key differs from the reference's prefix, the write is
 * refused as `issue-moved` and changes nothing. The detail is the current identifier, cleaned and held to the
 * identifier grammar, or null when it fails it. Null when the issue has not moved, or the call names no issue.
 */
export function linearMoved(input: LinearOpInput, resolved: LinearResolved): { word: 'issue-moved'; identifier: string | null } | null {
  if (input.ref === null || resolved.issue === null) return null;
  if (resolved.issue.teamKey === linearRefPrefix(input.ref)) return null;
  const current = cleanName(resolved.issue.identifier);
  return { word: 'issue-moved', identifier: current !== null && isLinearIdentifier(current) ? current : null };
}

// ── the route's ask (spec §4.2) ──

/** What a validated call names, for the router: an issue reference's prefix (a hint), a team, or the workspace. */
export function linearRouteAsk(input: LinearOpInput): LinearRouteAsk {
  if (input.ref !== null) return { kind: 'issue', prefix: linearRefPrefix(input.ref), workspace: input.workspace };
  if (input.team !== null) return { kind: 'team', team: input.team, workspace: input.workspace };
  return { kind: 'workspace', workspace: input.workspace };
}

// ── outbound text (spec §5.3, §5.4, §13.4) ──

/** Whether `text` already ends with the provenance line, on a line of its own. */
const endsWithProvenance = (text: string): boolean => {
  const t = text.replace(/\s+$/u, '');
  return t === LINEAR_PROVENANCE_LINE || t.endsWith(`\n${LINEAR_PROVENANCE_LINE}`);
};
/** `text` with the provenance line appended after a blank line, unless it already ends with it. */
export function withLinearProvenance(text: string): string {
  if (endsWithProvenance(text)) return text;
  return text === '' ? LINEAR_PROVENANCE_LINE : `${text}\n\n${LINEAR_PROVENANCE_LINE}`;
}

/**
 * The text a call sends to Linear, made ready to leave the fleet (§5.3, §5.4): every outbound field (`search.text`,
 * a title, a description, a comment body) through the `linear-egress` profile (`coord/redact.ts`, which reads the
 * credential shapes from their one home), its masked spans counted; then the
 * provenance line on every comment body and on every description a create or an update sends. An update that sends
 * no description gets none, and a description that already ends with the line gets no second one.
 */
export function linearOutbound(input: LinearOpInput): { input: LinearOpInput; masked: number } {
  const f: LinearBodyFields = { ...input.fields };
  let masked = 0;
  for (const k of ['text', 'title', 'description', 'body'] as const) {
    const v = f[k];
    if (typeof v !== 'string') continue;
    const r = redactLinearText(v);
    f[k] = r.text;
    masked += r.masked;
  }
  if (input.op === 'comment' && typeof f.body === 'string') f.body = withLinearProvenance(f.body);
  if ((input.op === 'create' || input.op === 'update') && typeof f.description === 'string') {
    f.description = withLinearProvenance(f.description);
  }
  return { input: { ...input, fields: f }, masked };
}

// ── the shapers (spec §5.4, §6.5) ──

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const STATE_TYPE = /^[a-z_]{1,32}$/;
type Malformed = 'malformed';
const MALFORMED: Malformed = 'malformed';

/** `text` cut to at most `max` UTF-8 bytes, at a character boundary. */
const cutBytes = (text: string, max: number): { text: string; cut: boolean } => {
  if (bytes(text) <= max) return { text, cut: false };
  let out = '';
  let n = 0;
  for (const ch of text) {
    const b = bytes(ch);
    if (n + b > max) break;
    out += ch;
    n += b;
  }
  return { text: out, cut: true };
};

/** An issue's URL, in Linear's issue-URL form, from the slot's recorded URL key and the shaped identifier (§5.4). */
export const linearIssueUrl = (urlKey: string, identifier: string): string => `${LINEAR_WEB_ORIGIN}/${urlKey}/issue/${identifier}`;

const nameOf = (v: unknown): string | null => (isPlainObject(v) ? cleanName(v['name']) : null);

/** One issue as §5.4 answers it, or `malformed`. `withDescription` is false for a search item. */
function shapeIssue(v: unknown, ctx: LinearShapeContext, withDescription: boolean): Record<string, unknown> | Malformed {
  if (!isPlainObject(v)) return MALFORMED;
  const identifier = typeof v['identifier'] === 'string' ? strip('identifier', v['identifier']) : '';
  if (!isLinearIdentifier(identifier)) return MALFORMED;
  const team = isPlainObject(v['team']) && typeof v['team']['key'] === 'string' ? strip('team', v['team']['key']).toUpperCase() : '';
  if (!isLinearTeamKey(team)) return MALFORMED;
  const st = v['state'];
  if (!isPlainObject(st)) return MALFORMED;
  const stateName = cleanName(st['name']);
  const stateType = typeof st['type'] === 'string' ? strip('type', st['type']) : '';
  if (stateName === null || !STATE_TYPE.test(stateType)) return MALFORMED;
  const priority = v['priority'];
  if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0 || priority > LINEAR_PRIORITY_MAX) return MALFORMED;
  const createdAt = v['createdAt'];
  const updatedAt = v['updatedAt'];
  if (typeof createdAt !== 'string' || !ISO_TIME.test(createdAt) || typeof updatedAt !== 'string' || !ISO_TIME.test(updatedAt)) return MALFORMED;
  if (v['assignee'] !== null && !isPlainObject(v['assignee'])) return MALFORMED;
  if (v['project'] !== null && !isPlainObject(v['project'])) return MALFORMED;
  const labelsConn = v['labels'];
  if (!isPlainObject(labelsConn) || !Array.isArray(labelsConn['nodes'])) return MALFORMED;
  const labels: string[] = [];
  for (const n of labelsConn['nodes']) {
    const name = nameOf(n);
    if (name === null) return MALFORMED;
    labels.push(name);
  }
  let parent: string | null = null;
  if (v['parent'] !== null) {
    const p = v['parent'];
    const pid = isPlainObject(p) && typeof p['identifier'] === 'string' ? strip('identifier', p['identifier']) : '';
    if (!isLinearIdentifier(pid)) return MALFORMED;
    parent = pid;
  }
  if (typeof v['title'] !== 'string') return MALFORMED;
  const untrusted: Record<string, unknown> = { title: strip('title', v['title']) };
  if (withDescription) {
    const d = v['description'];
    if (d !== null && typeof d !== 'string') return MALFORMED;
    const cut = d === null ? { text: null, cut: false } : cutBytes(strip('description', d), LINEAR_DESCRIPTION_MAX_BYTES);
    untrusted['description'] = cut.text;
    untrusted['descriptionTruncated'] = cut.cut;
  }
  return {
    identifier,
    url: linearIssueUrl(ctx.urlKey, identifier),
    workspace: ctx.urlKey,
    team,
    state: { name: stateName, type: stateType },
    priority,
    assignee: v['assignee'] === null ? null : nameOf(v['assignee']),
    labels,
    project: v['project'] === null ? null : nameOf(v['project']),
    parent,
    createdAt,
    updatedAt,
    viaFleet: ctx.fleet.has(identifier),
    untrusted,
  };
}

/** The `data` object of an answer with no `errors`, or the word it ends in. */
const dataOf = (body: unknown): Record<string, unknown> | { word: LinearAnswerRefusalWord } => {
  const err = linearErrorWord(body);
  if (err !== null) return { word: err };
  if (!isPlainObject(body) || !isPlainObject(body['data'])) return { word: 'malformed' };
  return body['data'];
};
const isWord = (v: unknown): v is { word: LinearAnswerRefusalWord } => isPlainObject(v) && typeof v['word'] === 'string' && Object.keys(v).length === 1;

/** A connection's nodes and its next cursor (encoded for the wire), or `malformed`. `paged` false: no page info. */
function connectionOf(v: unknown, paged: boolean): { nodes: unknown[]; next: string | null } | Malformed {
  if (!isPlainObject(v) || !Array.isArray(v['nodes'])) return MALFORMED;
  if (!paged) return { nodes: v['nodes'], next: null };
  const info = v['pageInfo'];
  if (!isPlainObject(info)) return MALFORMED;
  if (info['hasNextPage'] === false) return { nodes: v['nodes'], next: null };
  const c = info['endCursor'];
  if (info['hasNextPage'] !== true || typeof c !== 'string' || c.length === 0 || c.length > LINEAR_CURSOR_MAX_CHARS) return MALFORMED;
  return { nodes: v['nodes'], next: encodeLinearCursor(c) };
}

/** A list answer: each node through `item`, any `malformed` node making the whole answer malformed. */
function listOf(
  conn: { nodes: unknown[]; next: string | null } | Malformed, item: (n: unknown) => Record<string, unknown> | Malformed,
): LinearShaped {
  if (conn === MALFORMED) return { ok: false, word: 'malformed' };
  const items: Record<string, unknown>[] = [];
  for (const n of conn.nodes) {
    const it = item(n);
    if (it === MALFORMED) return { ok: false, word: 'malformed' };
    items.push(it);
  }
  return { ok: true, answer: { items, next: conn.next }, result: null };
}

const idName = (n: unknown): { id: string; name: string } | Malformed => {
  if (!isPlainObject(n) || !isLinearUuid(n['id'])) return MALFORMED;
  const name = cleanName(n['name']);
  return name === null ? MALFORMED : { id: n['id'], name };
};
const teamKeyOf = (v: unknown): string | null | Malformed => {
  if (v === null) return null;
  const k = isPlainObject(v) && typeof v['key'] === 'string' ? strip('team', v['key']).toUpperCase() : '';
  return isLinearTeamKey(k) ? k : MALFORMED;
};

const shapeState = (n: unknown): Record<string, unknown> | Malformed => {
  const b = idName(n);
  if (b === MALFORMED || !isPlainObject(n)) return MALFORMED;
  const type = typeof n['type'] === 'string' ? strip('type', n['type']) : '';
  const team = teamKeyOf(n['team']);
  if (!STATE_TYPE.test(type) || team === MALFORMED || team === null) return MALFORMED;
  return { id: b.id, name: b.name, type, team };
};
const shapeLabel = (n: unknown): Record<string, unknown> | Malformed => {
  const b = idName(n);
  if (b === MALFORMED || !isPlainObject(n)) return MALFORMED;
  const team = teamKeyOf(n['team'] ?? null);
  return team === MALFORMED ? MALFORMED : { id: b.id, name: b.name, team };
};
const shapeProject = (n: unknown): Record<string, unknown> | Malformed => {
  const b = idName(n);
  return b === MALFORMED ? MALFORMED : { id: b.id, name: b.name };
};
/** A user: `{id, name, displayName, active}`. An email address is never shaped in, whatever Linear sends. */
const shapeUser = (n: unknown): Record<string, unknown> | Malformed => {
  const b = idName(n);
  if (b === MALFORMED || !isPlainObject(n) || typeof n['active'] !== 'boolean') return MALFORMED;
  const displayName = n['displayName'] === null || n['displayName'] === undefined ? null : cleanName(n['displayName']);
  return { id: b.id, name: b.name, displayName, active: n['active'] };
};

/** The identifiers of the issues in a list answer (or one issue), for `viaFleet`. Only grammar-true ones. */
const identifiersIn = (nodes: unknown): string[] => (Array.isArray(nodes) ? nodes : [nodes]).flatMap((n) => {
  const id = isPlainObject(n) && typeof n['identifier'] === 'string' ? strip('identifier', n['identifier']) : '';
  return isLinearIdentifier(id) ? [id] : [];
});
const dig = (body: unknown, ...path: string[]): unknown => {
  let v: unknown = body;
  for (const p of path) v = isPlainObject(v) ? v[p] : undefined;
  return v;
};

// ── variables ──

/** The routed slot's team id for a team key, or null (the router chose the slot by that key, so null is a store that
 *  changed between the routing and the call). */
const teamIdOf = (ctx: LinearOpContext, key: string): string | null =>
  ctx.teams.find((t) => t.key.toUpperCase() === key.toUpperCase())?.id ?? null;

type Named = { ok: true; id: string } | Exclude<LinearVariables, { ok: true }>;
const named = (ctx: LinearOpContext, field: string, kind: LinearNameKind, value: string, team: string | null): Named => {
  const r = lookupLinearName(ctx.directory, kind, value, team);
  if (r.kind === 'id') return { ok: true, id: r.id };
  if (r.kind === 'miss') return { ok: false, word: 'name-unknown', field };
  return { ok: false, word: 'name-ambiguous', field, candidates: r.candidates };
};
const namedAll = (ctx: LinearOpContext, field: string, values: readonly string[], team: string | null):
  { ok: true; ids: string[] } | Exclude<LinearVariables, { ok: true }> => {
  const ids: string[] = [];
  for (const v of values) {
    const r = named(ctx, field, 'label', v, team);
    if (!r.ok) return r;
    ids.push(r.id);
  }
  return { ok: true, ids: [...new Set(ids)] };
};

/** The input of a create or an update, from the body's fields: names through the directory, the parent through the
 *  resolve. `team` scopes the state and label names. The changed field names come back for the journal. */
function issueInput(input: LinearOpInput, ctx: LinearOpContext, team: string | null):
  { ok: true; input: Record<string, unknown>; fields: string[] } | Exclude<LinearVariables, { ok: true }> {
  const f = input.fields;
  const out: Record<string, unknown> = {};
  const fields: string[] = [];
  if (f.title !== undefined) { out['title'] = f.title; fields.push('title'); }
  if (f.description !== undefined) { out['description'] = f.description; fields.push('description'); }
  if (f.state !== undefined) {
    const r = named(ctx, 'state', 'state', f.state, team);
    if (!r.ok) return r;
    out['stateId'] = r.id; fields.push('state');
  }
  if (f.priority !== undefined) { out['priority'] = f.priority; fields.push('priority'); }
  if (f.assignee !== undefined) {
    if (f.assignee === null) out['assigneeId'] = null;
    else {
      const r = named(ctx, 'assignee', 'user', f.assignee, null);
      if (!r.ok) return r;
      out['assigneeId'] = r.id;
    }
    fields.push('assignee');
  }
  for (const [field, key] of [['labels', 'labelIds'], ['addLabels', 'addedLabelIds'], ['removeLabels', 'removedLabelIds']] as const) {
    const values = f[field];
    if (values === undefined) continue;
    const r = namedAll(ctx, field, values, team);
    if (!r.ok) return r;
    out[key] = r.ids; fields.push(field);
  }
  if (f.project !== undefined) {
    const r = named(ctx, 'project', 'project', f.project, null);
    if (!r.ok) return r;
    out['projectId'] = r.id; fields.push('project');
  }
  if (f.parent !== undefined) {
    // The parent is the resolve's UUID, never the identifier the caller wrote (§4.5).
    if (ctx.resolved?.parent == null) return { ok: false, word: 'unresolved' };
    out['parentId'] = ctx.resolved.parent.id; fields.push('parent');
  }
  return { ok: true, input: out, fields };
}

/** A list verb's page: its size and its cursor. */
const page = (input: LinearOpInput): { first: number; after: string | null } =>
  ({ first: input.limit ?? LINEAR_LIST_LIMIT.default, after: input.after });

/** A team-scoped filter's team id, or the refusal; null when the call names no team. */
const scopedTeam = (input: LinearOpInput, ctx: LinearOpContext): { ok: true; id: string | null } | { ok: false; word: 'team-unknown' } => {
  if (input.team === null) return { ok: true, id: null };
  const id = teamIdOf(ctx, input.team);
  return id === null ? { ok: false, word: 'team-unknown' } : { ok: true, id };
};

// ── the rows ──

const issueShape = (body: unknown, ctx: LinearShapeContext): LinearShaped => {
  const data = dataOf(body);
  if (isWord(data)) return { ok: false, ...data };
  if (!('issue' in data)) return { ok: false, word: 'malformed' };
  if (data['issue'] === null) return { ok: false, word: 'not-found' };
  const issue = shapeIssue(data['issue'], ctx, true);
  return issue === MALFORMED ? { ok: false, word: 'malformed' } : { ok: true, answer: { issue }, result: null };
};

/** A write's answer: `success` must be true, and the issue or comment is shaped as a read shapes it. */
const writeShape = (key: 'issueCreate' | 'issueUpdate', result: boolean) => (body: unknown, ctx: LinearShapeContext): LinearShaped => {
  const data = dataOf(body);
  if (isWord(data)) return { ok: false, ...data };
  const payload = data[key];
  if (!isPlainObject(payload)) return { ok: false, word: 'malformed' };
  if (payload['success'] !== true) return { ok: false, word: 'unreachable' };
  const issue = shapeIssue(payload['issue'], ctx, true);
  if (issue === MALFORMED) return { ok: false, word: 'malformed' };
  return { ok: true, answer: { issue }, result: result ? (issue['identifier'] as string) : null };
};

const callRow = (r: Omit<LinearCallRow, 'source'>): LinearCallRow => Object.freeze({ source: 'linear', ...r });
const storeRow = (r: Omit<LinearStoreRow, 'source' | 'document'>): LinearStoreRow => Object.freeze({ source: 'store', document: null, ...r });

/**
 * THE TABLE: one row per verb, keyed by it (spec §6.4). A row's `class` is the route's class, whatever its method.
 */
export const LINEAR_OPS: Readonly<{ [V in LinearVerb]: LinearOpRow & { op: V } }> = Object.freeze({
  workspaces: storeRow({ op: 'workspaces', class: 'read', method: 'GET', ref: false, query: [], body: null }) as LinearStoreRow & { op: 'workspaces' },
  teams: storeRow({ op: 'teams', class: 'read', method: 'GET', ref: false, query: ['workspace'], body: null }) as LinearStoreRow & { op: 'teams' },

  issue: callRow({
    op: 'issue', class: 'read', method: 'GET', ref: true, query: ['workspace'], body: null,
    document: LINEAR_DOCUMENTS.issue, resolves: [],
    variables: (input) => ({ ok: true, vars: { id: input.ref }, fields: [] }),
    shape: issueShape,
    fleetKeys: (body) => identifiersIn(dig(body, 'data', 'issue')),
  }) as LinearCallRow & { op: 'issue' },

  search: callRow({
    op: 'search', class: 'read', method: 'POST', ref: false, query: ['workspace'], body: Object.keys(BODIES.search!.fields),
    document: LINEAR_DOCUMENTS.search, resolves: [],
    variables: (input, ctx) => {
      const f = input.fields;
      const filter: Record<string, unknown> = {};
      const t = scopedTeam(input, ctx);
      if (!t.ok) return t;
      if (t.id !== null) filter['team'] = { id: { eq: t.id } };
      const one = [['state', 'state', 'state'], ['assignee', 'user', 'assignee'], ['label', 'label', 'labels'], ['project', 'project', 'project']] as const;
      for (const [field, kind, key] of one) {
        const v = f[field];
        if (typeof v !== 'string') continue;
        const r = named(ctx, field, kind, v, input.team);
        if (!r.ok) return r;
        filter[key] = key === 'labels' ? { some: { id: { eq: r.id } } } : { id: { eq: r.id } };
      }
      if (f.text !== undefined) filter['or'] = [{ title: { containsIgnoreCase: f.text } }, { description: { containsIgnoreCase: f.text } }];
      const { first, after } = page(input);
      return { ok: true, vars: { filter, first, after, includeArchived: f.includeArchived ?? false }, fields: [] };
    },
    shape: (body, ctx) => {
      const data = dataOf(body);
      if (isWord(data)) return { ok: false, ...data };
      return listOf(connectionOf(data['issues'], true), (n) => shapeIssue(n, ctx, false));
    },
    fleetKeys: (body) => identifiersIn(dig(body, 'data', 'issues', 'nodes')),
  }) as LinearCallRow & { op: 'search' },

  comments: callRow({
    op: 'comments', class: 'read', method: 'GET', ref: true, query: ['workspace', 'limit', 'after'], body: null,
    document: LINEAR_DOCUMENTS.comments, resolves: [],
    variables: (input) => ({ ok: true, vars: { id: input.ref, ...page(input) }, fields: [] }),
    shape: (body, ctx) => {
      const data = dataOf(body);
      if (isWord(data)) return { ok: false, ...data };
      if (!('issue' in data)) return { ok: false, word: 'malformed' };
      if (data['issue'] === null) return { ok: false, word: 'not-found' };
      return listOf(connectionOf(dig(data, 'issue', 'comments'), true), (n) => {
        if (!isPlainObject(n) || !isLinearUuid(n['id']) || typeof n['body'] !== 'string') return MALFORMED;
        if (typeof n['createdAt'] !== 'string' || !ISO_TIME.test(n['createdAt'])) return MALFORMED;
        if (n['user'] !== null && !isPlainObject(n['user'])) return MALFORMED;
        return {
          author: n['user'] === null ? null : nameOf(n['user']),
          createdAt: n['createdAt'],
          viaFleet: ctx.fleet.has(n['id']),
          untrusted: { body: strip('body', n['body']) },
        };
      });
    },
    fleetKeys: (body) => {
      const nodes = dig(body, 'data', 'issue', 'comments', 'nodes');
      return Array.isArray(nodes) ? nodes.flatMap((n) => (isPlainObject(n) && isLinearUuid(n['id']) ? [n['id']] : [])) : [];
    },
  }) as LinearCallRow & { op: 'comments' },

  statuses: callRow({
    op: 'statuses', class: 'read', method: 'GET', ref: false, query: ['team', 'workspace'], body: null,
    document: LINEAR_DOCUMENTS.statuses, resolves: [],
    variables: (input, ctx) => {
      const t = scopedTeam(input, ctx);
      if (!t.ok) return t;
      return { ok: true, vars: { filter: t.id === null ? null : { team: { id: { eq: t.id } } } }, fields: [] };
    },
    shape: (body) => {
      const data = dataOf(body);
      if (isWord(data)) return { ok: false, ...data };
      return listOf(connectionOf(data['workflowStates'], false), shapeState);
    },
    fleetKeys: () => [],
  }) as LinearCallRow & { op: 'statuses' },

  projects: callRow({
    op: 'projects', class: 'read', method: 'GET', ref: false, query: ['team', 'workspace', 'limit', 'after'], body: null,
    document: LINEAR_DOCUMENTS.projects, resolves: [],
    variables: (input, ctx) => {
      const t = scopedTeam(input, ctx);
      if (!t.ok) return t;
      const filter = t.id === null ? null : { accessibleTeams: { some: { id: { eq: t.id } } } };
      return { ok: true, vars: { filter, ...page(input) }, fields: [] };
    },
    shape: (body) => {
      const data = dataOf(body);
      if (isWord(data)) return { ok: false, ...data };
      return listOf(connectionOf(data['projects'], true), shapeProject);
    },
    fleetKeys: () => [],
  }) as LinearCallRow & { op: 'projects' },

  labels: callRow({
    op: 'labels', class: 'read', method: 'GET', ref: false, query: ['team', 'workspace'], body: null,
    document: LINEAR_DOCUMENTS.labels, resolves: [],
    variables: (input, ctx) => {
      const t = scopedTeam(input, ctx);
      if (!t.ok) return t;
      // A team's labels are its own and the workspace's.
      const filter = t.id === null ? null : { or: [{ team: { id: { eq: t.id } } }, { team: { null: true } }] };
      return { ok: true, vars: { filter }, fields: [] };
    },
    shape: (body) => {
      const data = dataOf(body);
      if (isWord(data)) return { ok: false, ...data };
      return listOf(connectionOf(data['issueLabels'], false), shapeLabel);
    },
    fleetKeys: () => [],
  }) as LinearCallRow & { op: 'labels' },

  users: callRow({
    op: 'users', class: 'read', method: 'GET', ref: false, query: ['workspace', 'limit', 'after'], body: null,
    document: LINEAR_DOCUMENTS.users, resolves: [],
    variables: (input) => ({ ok: true, vars: page(input), fields: [] }),
    shape: (body) => {
      const data = dataOf(body);
      if (isWord(data)) return { ok: false, ...data };
      return listOf(connectionOf(data['users'], true), shapeUser);
    },
    fleetKeys: () => [],
  }) as LinearCallRow & { op: 'users' },

  create: callRow({
    op: 'create', class: 'write', method: 'POST', ref: false, query: ['workspace'], body: Object.keys(BODIES.create!.fields),
    document: LINEAR_DOCUMENTS.create, resolves: [LINEAR_DOCUMENTS.resolveParent],
    variables: (input, ctx) => {
      const teamId = input.team === null ? null : teamIdOf(ctx, input.team);
      if (teamId === null) return { ok: false, word: 'team-unknown' };
      const r = issueInput(input, ctx, input.team);
      if (!r.ok) return r;
      return { ok: true, vars: { input: { teamId, ...r.input } }, fields: ['team', ...r.fields] };
    },
    shape: writeShape('issueCreate', true),
    fleetKeys: () => [],
  }) as LinearCallRow & { op: 'create' },

  update: callRow({
    op: 'update', class: 'write', method: 'POST', ref: true, query: ['workspace'], body: Object.keys(BODIES.update!.fields),
    document: LINEAR_DOCUMENTS.update, resolves: [LINEAR_DOCUMENTS.resolveIssue, LINEAR_DOCUMENTS.resolveIssueAndParent],
    variables: (input, ctx) => {
      // The mutation takes the resolve's UUID, never the identifier (§4.5), and scopes names by the resolved team.
      const issue = ctx.resolved?.issue ?? null;
      if (issue === null) return { ok: false, word: 'unresolved' };
      const r = issueInput(input, ctx, issue.teamKey);
      if (!r.ok) return r;
      return { ok: true, vars: { id: issue.id, input: r.input }, fields: r.fields };
    },
    shape: writeShape('issueUpdate', false),
    fleetKeys: () => [],
  }) as LinearCallRow & { op: 'update' },

  comment: callRow({
    op: 'comment', class: 'write', method: 'POST', ref: true, query: ['workspace'], body: Object.keys(BODIES.comment!.fields),
    document: LINEAR_DOCUMENTS.comment, resolves: [LINEAR_DOCUMENTS.resolveIssue],
    variables: (input, ctx) => {
      const issue = ctx.resolved?.issue ?? null;
      if (issue === null) return { ok: false, word: 'unresolved' };
      return { ok: true, vars: { input: { issueId: issue.id, body: input.fields.body } }, fields: ['body'] };
    },
    shape: (body) => {
      const data = dataOf(body);
      if (isWord(data)) return { ok: false, ...data };
      const payload = data['commentCreate'];
      if (!isPlainObject(payload)) return { ok: false, word: 'malformed' };
      if (payload['success'] !== true) return { ok: false, word: 'unreachable' };
      const c = payload['comment'];
      if (!isPlainObject(c) || !isLinearUuid(c['id']) || typeof c['createdAt'] !== 'string' || !ISO_TIME.test(c['createdAt'])) {
        return { ok: false, word: 'malformed' };
      }
      return { ok: true, answer: { comment: { createdAt: c['createdAt'] } }, result: c['id'] };
    },
    fleetKeys: () => [],
  }) as LinearCallRow & { op: 'comment' },
});

// ── the validator (spec §5.2, §5.3) ──

/**
 * A call's path reference, query and parsed body, against its row (§5.1, §5.3). The query's declared keys only (the
 * identity pair is the route's `onRequest`'s, and skipped here), each one string; the body a plain object of the row's
 * fields only, with `byId`, `byUuid` and `workspace` refused by name; every value within its bounds.
 */
export function validateLinearCall(
  op: LinearVerb, call: { ref?: unknown; query?: unknown; body?: unknown },
): LinearValidated {
  const row = LINEAR_OPS[op];
  const input: LinearOpInput = { op, ref: null, workspace: null, team: null, limit: null, after: null, fields: {} };

  if (row.ref) {
    if (!isLinearIdentifier(call.ref)) return { ok: false, word: 'bad-field', field: 'ref' };
    input.ref = call.ref;
  } else if (call.ref !== undefined && call.ref !== null) {
    return { ok: false, word: 'bad-field', field: 'ref' };
  }

  const query = call.query ?? {};
  if (!isPlainObject(query)) return { ok: false, word: 'bad-request', field: 'query' };
  for (const [k, v] of Object.entries(query)) {
    if ((LINEAR_IDENTITY_QUERY_KEYS as readonly string[]).includes(k)) continue;
    if (!(row.query as readonly string[]).includes(k) || typeof v !== 'string') return fieldRefusal(k);
    if (k === 'workspace') {
      if (!isLinearUrlKey(v)) return fieldRefusal(k);
      input.workspace = v;
    } else if (k === 'team') {
      if (!isLinearTeamKey(v)) return fieldRefusal(k);
      input.team = v.toUpperCase();
    } else if (k === 'limit') {
      if (!/^[0-9]{1,3}$/.test(v)) return fieldRefusal(k);
      const r = limitRule(Number(v));
      if (!r.ok) return fieldRefusal(k);
      input.limit = r.value as number;
    } else {
      const c = decodeLinearCursor(v);
      if (c === null) return fieldRefusal(k);
      input.after = c;
    }
  }
  if (row.query.includes('limit') && input.limit === null) input.limit = LINEAR_LIST_LIMIT.default;

  if (row.body === null) {
    if (call.body !== undefined && call.body !== null) return { ok: false, word: 'bad-request', field: 'body' };
    return { ok: true, input };
  }
  const spec = BODIES[op]!;
  if (!isPlainObject(call.body)) return { ok: false, word: 'bad-request', field: 'body' };
  const body = call.body;
  for (const k of LINEAR_FORBIDDEN_BODY_FIELDS) if (Object.prototype.hasOwnProperty.call(body, k)) return fieldRefusal(k);
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    const rule = Object.prototype.hasOwnProperty.call(spec.fields, k) ? spec.fields[k] : undefined;
    if (rule === undefined) return fieldRefusal(k);
    const r = rule(v);
    if (!r.ok) return fieldRefusal(k);
    fields[k] = r.value;
  }
  for (const k of spec.required) if (!(k in fields)) return fieldRefusal(k);
  if (op === 'update') {
    if (Object.keys(fields).length === 0) return { ok: false, word: 'bad-request', field: 'body' };
    // `labels` replaces the set, so it is never combined with the edits of it.
    if ('labels' in fields && ('addLabels' in fields || 'removeLabels' in fields)) return fieldRefusal('labels');
  }
  if ('team' in fields) { input.team = fields['team'] as string; delete fields['team']; }
  if ('limit' in fields) { input.limit = fields['limit'] as number; delete fields['limit']; }
  if ('after' in fields) { input.after = fields['after'] as string; delete fields['after']; }
  if (op === 'search' && input.limit === null) input.limit = LINEAR_LIST_LIMIT.default;
  input.fields = fields as LinearBodyFields;
  return { ok: true, input };
}

// ── the store-answered verbs (spec §5.4) ──

/** A `teams` item per team the routed slot's present key reaches: `{workspace, key, name}`, the name cleaned. */
export function shapeLinearTeams(urlKey: string, teams: readonly { key: string; name: string }[]): Record<string, unknown>[] {
  return teams.flatMap((t) => {
    const key = stripLine(t.key).toUpperCase();
    const name = cleanName(t.name);
    return isLinearTeamKey(key) && name !== null ? [{ workspace: urlKey, key, name }] : [];
  });
}

/** A `workspaces` item per slot: `{workspace, name, teams:[key], state}`, where `state` is the slot's view state. A slot
 *  whose present key has learned nothing has a null URL key and name and no teams. */
export function shapeLinearWorkspaces(
  rows: readonly { urlKey: string | null; name: string | null; teamKeys: readonly string[]; state: string }[],
): Record<string, unknown>[] {
  return rows.map((r) => ({
    workspace: r.urlKey !== null && isLinearUrlKey(r.urlKey) ? r.urlKey : null,
    name: r.name === null ? null : cleanName(r.name),
    teams: r.teamKeys.map((k) => stripLine(k).toUpperCase()).filter((k) => isLinearTeamKey(k)),
    state: r.state,
  }));
}

// ── the directory's pages (spec §4.4) ──

/** One directory page, read: its cleaned entries, its next cursor (Linear's own, not encoded), and the key's own user
 *  on a users page. `malformed` for a page out of its grammar; the word for an answer with `errors`. */
export type LinearDirectoryPage =
  | {
      ok: true;
      states: LinearDirectoryEntries['states'][number][];
      labels: LinearDirectoryEntries['labels'][number][];
      projects: LinearDirectoryEntries['projects'][number][];
      users: LinearDirectoryEntries['users'][number][];
      viewerId: string | null;
      next: string | null;
    }
  | { ok: false; word: LinearAnswerRefusalWord };

const CONNECTION_OF: Readonly<Record<LinearDirectoryCollection, string>> = {
  states: 'workflowStates', labels: 'issueLabels', projects: 'projects', users: 'users',
};

export function readLinearDirectoryPage(kind: LinearDirectoryCollection, body: unknown): LinearDirectoryPage {
  const data = dataOf(body);
  if (isWord(data)) return { ok: false, ...data };
  const conn = data[CONNECTION_OF[kind]];
  if (!isPlainObject(conn) || !Array.isArray(conn['nodes']) || conn['nodes'].length > LINEAR_DIRECTORY_PAGE_SIZE) {
    return { ok: false, word: 'malformed' };
  }
  const info = conn['pageInfo'];
  if (!isPlainObject(info)) return { ok: false, word: 'malformed' };
  let next: string | null = null;
  if (info['hasNextPage'] === true) {
    const c = info['endCursor'];
    if (typeof c !== 'string' || c.length === 0 || c.length > LINEAR_CURSOR_MAX_CHARS) return { ok: false, word: 'malformed' };
    next = c;
  } else if (info['hasNextPage'] !== false) return { ok: false, word: 'malformed' };
  const out: Extract<LinearDirectoryPage, { ok: true }> = { ok: true, states: [], labels: [], projects: [], users: [], viewerId: null, next };
  for (const n of conn['nodes']) {
    const b = idName(n);
    if (b === MALFORMED || !isPlainObject(n)) return { ok: false, word: 'malformed' };
    if (kind === 'states') {
      const s = shapeState(n);
      if (s === MALFORMED) return { ok: false, word: 'malformed' };
      out.states.push({ id: b.id, name: b.name, type: s['type'] as string, teamKey: s['team'] as string });
    } else if (kind === 'labels') {
      const team = teamKeyOf(n['team'] ?? null);
      if (team === MALFORMED) return { ok: false, word: 'malformed' };
      out.labels.push({ id: b.id, name: b.name, teamKey: team });
    } else if (kind === 'projects') {
      out.projects.push(b);
    } else {
      const u = shapeUser(n);
      if (u === MALFORMED) return { ok: false, word: 'malformed' };
      // The directory holds active users only (§4.4).
      if (u['active'] === true) out.users.push({ id: b.id, name: b.name, displayName: u['displayName'] as string | null });
    }
  }
  if (kind === 'users') {
    const viewer = data['viewer'];
    if (!isPlainObject(viewer) || !isLinearUuid(viewer['id'])) return { ok: false, word: 'malformed' };
    out.viewerId = viewer['id'];
  }
  return out;
}
