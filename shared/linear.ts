/**
 * The Linear connection, as the Settings screen and the server both say it (named workspaces S4b, design
 * 2026-10-20 §5.1). L0: imports nothing, because the PWA bundles this file.
 *
 * ONE VOCABULARY for the section's state. `LinearConnectionView` is what `GET /api/linear/connection` answers,
 * and it is NEVER the key: the most the wire carries of a credential is `keyTail`, its last four characters.
 *
 * EVERY STATE ITS OWN. `readValueFile` tells `absent`, `unreadable`, `unusable` and `placeholder` apart, and the
 * details file (`linear.json`) adds three more conditions of its own, because each has a different remedy:
 * paste a key, fix permissions, edit the file, or just press Check again. Folding any two is the overloaded
 * result CLAUDE.md forbids.
 */
import type { NameRefusal } from './slug.js';

/** The shortest key the server will send to Linear. A personal API key is several dozen characters; the floor
 *  stops a pasted word from being stored and, with it, `keyTail` from showing a quarter of a short value. */
export const LINEAR_KEY_MIN_CHARS = 16;
/** The longest. A bound on what an authenticated caller can make the server hold, hash and send. */
export const LINEAR_KEY_MAX_CHARS = 256;
/** The characters a key is made of. Anything else (whitespace, a leading `#`, a newline) would be stored
 *  differently from how it was verified: `readValueFile` takes the first non-comment line and strips
 *  whitespace, and `fetch` throws on a control character in a header, which would be reported as unreachable. */
export const LINEAR_KEY_SHAPE = /^[A-Za-z0-9_-]+$/;

/** Whether `key` is a string worth sending to Linear. Pure: the server answers `bad-key` on false and calls
 *  nothing; the PWA uses it to say so before a round trip. */
export function isLinearKeyShape(key: unknown): key is string {
  return typeof key === 'string' && key.length >= LINEAR_KEY_MIN_CHARS && key.length <= LINEAR_KEY_MAX_CHARS
    && LINEAR_KEY_SHAPE.test(key);
}

/** What the last check of the stored key found. `ok`, `rejected` (Linear answered 401: the key is bad), `forbidden`
 *  (Linear answered 403: it refused this request, which is not a verdict on the key) or `unreachable` (a timeout, a
 *  5xx, a refused connection, an answer that was not the shape asked for: nothing was decided about the key). */
export const LINEAR_CHECK_OUTCOMES = ['ok', 'rejected', 'forbidden', 'unreachable'] as const;
export type LinearCheckOutcome = (typeof LINEAR_CHECK_OUTCOMES)[number];

/** Why a stored key has no usable details beside it: the file is `absent` (a crash between the two writes, or an
 *  older build), `unreadable`, `malformed`, or `stale` (it describes a key that is no longer the stored one). */
export const LINEAR_DETAILS_PROBLEMS = ['absent', 'unreadable', 'malformed', 'stale'] as const;
export type LinearDetailsProblem = (typeof LINEAR_DETAILS_PROBLEMS)[number];

/** What the section shows of a key it has checked. `org` and `user` are null only when the first check of this
 *  key could not name them (it was rejected, or Linear did not answer). */
export interface LinearShown {
  org: string | null;
  user: string | null;
  /** The last four characters of the key. The only part of it that ever leaves the server. */
  keyTail: string;
  /** Epoch ms of the last check, the server's clock. */
  checkedAt: number;
}

export type LinearConnectionView =
  | { state: 'not-connected' }
  | ({ state: 'connected' } & LinearShown & { outcome: 'ok' })
  | ({ state: 'key-rejected' } & LinearShown & { outcome: 'rejected' })
  /** Linear answered 403 at the last check. The key is not called bad: it may lack a scope, or a team. */
  | ({ state: 'key-forbidden' } & LinearShown & { outcome: 'forbidden' })
  | ({ state: 'unreachable' } & LinearShown & { outcome: 'unreachable' })
  /** A key is stored and no details describe it. The key may be fine: Check again says. */
  | { state: 'details-unknown'; why: LinearDetailsProblem }
  /** `linear.key` exists and cannot be read (permissions): not "not connected". */
  | { state: 'unreadable' }
  /** `linear.key` exists and holds no value line. */
  | { state: 'unusable' }
  /** `linear.key` still holds an example value. */
  | { state: 'placeholder' };

export const LINEAR_VIEW_STATES = [
  'not-connected', 'connected', 'key-rejected', 'key-forbidden', 'unreachable', 'details-unknown', 'unreadable', 'unusable', 'placeholder',
] as const satisfies readonly LinearConnectionView['state'][];

/** What `~/.ccrc/linear.json` holds: the DISPLAY record of the stored key (never a credential). `org`/`user` are
 *  null only when no check of this key has named them; `keyDigest` is the sha256 of the key it describes, which
 *  is how a record left by a different key is told from a current one. The server writes it; the wire never
 *  carries it (`LinearConnectionView` does not hold the digest). */
export interface LinearDetails {
  org: string | null;
  user: string | null;
  keyTail: string;
  keyDigest: string;
  checkedAt: number;
  outcome: LinearCheckOutcome;
}

/** The measured read of that file: absent, unreadable and malformed are three answers, never one `null`. */
export type LinearDetailsRead =
  | { kind: 'details'; details: LinearDetails }
  | { kind: 'absent' }
  | { kind: 'unreadable'; code: string }
  | { kind: 'malformed' };

/** The body of every successful `/api/linear/connection` answer. */
export interface LinearConnectionAnswer { ok: true; connection: LinearConnectionView }

/**
 * Why a lookup of a ticket's title produced none: THE ONE LIST of the failure arms, read by the server's client
 * (`server/src/linear/client.ts` makes them) and by the PWA (`LOOKUP_NOTE` says each in a sentence, a `satisfies
 * Record` over this type, so a new arm is a compile error until it has its words). EACH ITS OWN, because the operator
 * and the caller do different things about each: `not-configured` is a setup step, `unauthorised` a bad or expired
 * key (a 401, the ONLY answer that marks the stored key rejected), `forbidden` Linear refusing this request (a 403: a
 * scope or a team the key lacks, which says nothing against the key and never marks it), `not-found` a ticket that
 * does not exist, `timeout` is worth retrying,
 * `malformed` is an answer that was not the shape asked for, and `unreachable` is everything else the service or the
 * network did (a 5xx, a 429, a refused connection, a GraphQL errors array).
 */
export const LINEAR_FAILURES = [
  'not-configured', 'unauthorised', 'forbidden', 'not-found', 'timeout', 'malformed', 'unreachable',
] as const;
export type LinearFailure = (typeof LINEAR_FAILURES)[number];

/**
 * What `GET /api/linear/resolve` answers (named workspaces S4, S7). `reason` is the grammar's refusal for a `refused`
 * name, and, on a `named` one that fell back to `source: 'offline'`, the Linear failure arm that made it: the `kind`
 * says which vocabulary it is.
 */
export type ResolveAnswer =
  | { kind: 'auto'; slug: null; title: null; source: 'offline' }
  | { kind: 'refused'; slug: null; title: null; source: 'offline'; reason: NameRefusal }
  | { kind: 'named'; slug: string; title: string; source: 'linear' | 'offline'; reason?: LinearFailure };

// ---------------------------------------------------------------------------
// The slot store (#1444): one key per Linear workspace under `~/.ccrc/linear/`, `<id>.key` beside its version 2
// record `<id>.json`, where `<id>` is the workspace's id. The record is a DISPLAY record, never a credential: of the
// key it carries the tail and the digest, and the digest never leaves the server. `server/src/linear/store.ts`
// reads and writes it; the wire answer that shows it (`LinearWorkspaceView`) is a later stage's.
// ---------------------------------------------------------------------------

/** A Linear id (a workspace's `organization { id }`, a team's `id`): a lowercase UUID. A workspace id is a slot's
 *  file stem, so it is checked against this before it becomes a file name. */
export const LINEAR_UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A workspace's URL key, the `ws-a` of its links. */
export const LINEAR_URL_KEY_SHAPE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A team key (`AAA`), after it is uppercased: team keys are compared uppercased. */
export const LINEAR_TEAM_KEY_SHAPE = /^[A-Z][A-Z0-9_]{0,15}$/;
/** The most teams a record keeps: two pages of the key check. */
export const LINEAR_TEAMS_MAX = 500;

export const isLinearUuid = (v: unknown): v is string => typeof v === 'string' && LINEAR_UUID_SHAPE.test(v);
export const isLinearUrlKey = (v: unknown): v is string => typeof v === 'string' && LINEAR_URL_KEY_SHAPE.test(v);
export const isLinearTeamKey = (v: unknown): v is string => typeof v === 'string' && LINEAR_TEAM_KEY_SHAPE.test(v.toUpperCase());

/** One team the key's user reaches. `name` is Linear's text, cleaned before it is stored. */
export interface LinearTeam {
  id: string;
  key: string;
  name: string;
}

/** What `<id>.json` holds. `name`, `urlKey` and `user` are null, and `teams` empty with `teamsAt` null, only when no
 *  check of this key has learned them (its first check was rejected, or Linear did not answer), as the v1 record's
 *  `org` and `user` are. `outcome` keeps the four words of `LINEAR_CHECK_OUTCOMES`. */
export interface LinearStoreRecord {
  workspaceId: string;
  name: string | null;
  urlKey: string | null;
  user: string | null;
  teams: LinearTeam[];
  /** Epoch ms of the check that learned `teams`, or null when none has. */
  teamsAt: number | null;
  keyTail: string;
  keyDigest: string;
  checkedAt: number;
  outcome: LinearCheckOutcome;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** True when `o` has exactly the fields named, no more and no fewer. */
const hasExactly = (o: Record<string, unknown>, fields: readonly string[]): boolean => {
  const own = Object.keys(o);
  return own.length === fields.length && fields.every((f) => Object.prototype.hasOwnProperty.call(o, f));
};
/** A name as the server stores it: Linear's text after `cleanName` (control runs gone, bounded). The bound here is a
 *  parse bound, the v1 record's (`parseLinearDetails`), never looser than what the cleaner keeps. */
export const isLinearStoredName = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 400 && !/\p{Cc}/u.test(v);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isDigest = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

const TEAM_FIELDS = ['id', 'key', 'name'] as const;
const RECORD_FIELDS = [
  'v', 'workspaceId', 'name', 'urlKey', 'user', 'teams', 'teamsAt', 'keyTail', 'keyDigest', 'checkedAt', 'outcome',
] as const;

/** A team list as a record holds it; null when the list, or any entry, is not exactly that shape, when it holds more
 *  than `LINEAR_TEAMS_MAX` teams, or when two entries share an id or (uppercased) a key: the router never chooses
 *  between two teams of one workspace. */
export function parseLinearTeams(v: unknown): LinearTeam[] | null {
  if (!Array.isArray(v) || v.length > LINEAR_TEAMS_MAX) return null;
  const ids = new Set<string>();
  const keys = new Set<string>();
  const out: LinearTeam[] = [];
  for (const t of v) {
    if (!isPlainObject(t) || !hasExactly(t, TEAM_FIELDS)) return null;
    const { id, key, name } = t;
    if (!isLinearUuid(id) || !isLinearTeamKey(key) || !isLinearStoredName(name)) return null;
    if (ids.has(id) || keys.has(key.toUpperCase())) return null;
    ids.add(id);
    keys.add(key.toUpperCase());
    out.push({ id, key, name });
  }
  return out;
}

/** Parses a slot record's text; null when it is not exactly the version 2 shape: an unknown field, a missing one, or
 *  any field out of its grammar. Teams with no `teamsAt` are refused, since no check learned them. */
export function parseLinearStoreRecord(raw: string): LinearStoreRecord | null {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isPlainObject(v) || v['v'] !== 2 || !hasExactly(v, RECORD_FIELDS)) return null;
  const { workspaceId, name, urlKey, user, teamsAt, keyTail, keyDigest, checkedAt, outcome } = v;
  if (!isLinearUuid(workspaceId)) return null;
  if (!(name === null || isLinearStoredName(name)) || !(user === null || isLinearStoredName(user))) return null;
  if (!(urlKey === null || isLinearUrlKey(urlKey))) return null;
  const teams = parseLinearTeams(v['teams']);
  if (teams === null) return null;
  if (!(teamsAt === null || isTime(teamsAt)) || (teamsAt === null && teams.length > 0)) return null;
  if (typeof keyTail !== 'string' || keyTail.length !== 4 || !isDigest(keyDigest) || !isTime(checkedAt)) return null;
  if (!(LINEAR_CHECK_OUTCOMES as readonly unknown[]).includes(outcome)) return null;
  return {
    workspaceId, name, urlKey, user, teams, teamsAt, keyTail, keyDigest, checkedAt, outcome: outcome as LinearCheckOutcome,
  };
}
