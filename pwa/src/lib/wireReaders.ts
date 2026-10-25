// The PWA's readers of a 2xx or refusal body: each takes `unknown` off the wire and answers the typed view or null,
// never a field it did not check. Pure (L1) apart from `ApiError`'s class, a leaf. `lib/api.ts` re-exports all of it
// (ARCH-13b, #557).
import type { AutoMode, ArchiveAnswer, ArchiveBody, ArchiveRefusal, Dialog, DialogAnswered, NotifyMode, RouteFields, UpdateChannel } from '../../../shared/api';
import { isArchiveRefusal } from '../../../shared/api';
import { LINEAR_CHECK_OUTCOMES, LINEAR_DETAILS_PROBLEMS, type LinearCheckOutcome, type LinearConnectionView } from '../../../shared/linear';
import { isResolveReason, type LookupNote, type ResolveRead } from '../fleet/workspaceNameWords';
import { isNodeRole } from '../../../shared/node-role';
import { TOKEN_TRANSPORTS } from '../../../shared/agent-protocol';
import { BOX_TOKEN_PHASES, OWED_REASONS, TOKEN_FILE_PROBLEMS, TOKEN_HOLDS, TOKEN_ORIGINS, type BoxTokenView, type RotateAnswer } from '../../../shared/box-token';
import { ApiError } from './apiError';
import { isCount, isRecord } from './wire';

/** An answer route's 200 that could not be read: the answer landed, and the next screen is unknown (`next` absent). */
export const ANSWERED: DialogAnswered = { ok: true };

/** An answer route's 200 body, read (decision `ask-answer-returns-next-screen`): `next` kept only when it is null or
 *  looks like a Dialog (a string id, a boolean `parsed`, an options array). Anything else reads as absent, which leaves
 *  the sheet on the session stream's next frame, as before. */
export function answered(body: unknown): DialogAnswered {
  if (body === null || typeof body !== 'object' || !('next' in body)) return ANSWERED;
  const next = (body as { next: unknown }).next;
  if (next === null) return { ok: true, next: null };
  const d = next as Partial<Dialog> | undefined;
  return d !== undefined && typeof d === 'object' && typeof d.id === 'string' && typeof d.parsed === 'boolean'
    && Array.isArray(d.options) && typeof d.raw === 'string' && typeof d.title === 'string'
    ? { ok: true, next: d as Dialog }
    : ANSWERED;
}

/** The archive door's PARTIAL outcome, or `null` when the answer says nothing of one (workspace lifecycle §5.2): the
 *  door stopped the session and `ws-archive` then refused, so the row stays at the top level, stopped, with Archive
 *  offered again. THE ONE READER of `archived:false`. Absence permits: an older server's `{ok:true}` (no `archived`),
 *  or an answer this client could not read (`null`), is a completed archive, exactly what the door used to mean. */
export function archivePartial(a: ArchiveAnswer | null): { refusal: ArchiveRefusal | null; detail: string | null } | null {
  if (a === null || typeof a !== 'object' || a.archived !== false) return null;
  const refusal = isArchiveRefusal(a.refusal) ? a.refusal : null;
  return { refusal, detail: typeof a.detail === 'string' && a.detail.trim() !== '' ? a.detail.trim() : null };
}

// ── The box-token card's wire (box-token lifecycle wave 1, Task B6, D-4392) ──
// `UpdatesView.boxToken` is ADDITIVE: absent from an older server and from one
// that runs no driver. `readBoxTokenView` is its ONE reader, and every enumerated
// field is checked against the L0 list that declares it (`shared/box-token.ts`,
// `shared/agent-protocol.ts`, `shared/api.ts`), never a list spelled here, so a
// word a newer server adds reads as "not reported" rather than as a state this
// build would have to guess at. Malformed is null; the card says "not reported".

const isWord = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);
const isInstant = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const orNull = (v: unknown, ok: (x: unknown) => boolean): boolean => v === null || ok(v);
/** `BoxTokenView['fleetConfirmed']` keyed once, so a word added to the type is a compile error here. */
const FLEET_CONFIRMED_WORDS: Record<BoxTokenView['fleetConfirmed'], true> = {
  current: true, behind: true, absent: true, unreadable: true, 'own-write': true, unknown: true,
};
const BOOT_RECOVERY_SOURCES: Record<NonNullable<BoxTokenView['lastBootRecovery']>['source'], true> = { pending: true, previous: true };
/** Plan assembly: the two additive fields, keyed once. Absent (an older server) reads as null, never as a refusal. */
const STALL_WHYS: Record<NonNullable<BoxTokenView['stalled']>['why'], true> = { 'mint-failed': true, owed: true };
const FILE_SLOTS: Record<NonNullable<BoxTokenView['fileProblem']>['file'], true> = { current: true, pending: true, previous: true };

export function readBoxTokenView(raw: unknown): BoxTokenView | null {
  if (!isRecord(raw)) return null;
  const v = raw;
  const ok = isWord(BOX_TOKEN_PHASES, v.phase)
    && orNull(v.origin, (x) => isWord(TOKEN_ORIGINS, x))
    && orNull(v.currentSeq, isCount) && orNull(v.currentSince, isInstant) && orNull(v.lastRotationAt, isInstant)
    && typeof v.rotationOwed === 'boolean' && orNull(v.owedWhy, (x) => isWord(OWED_REASONS, x))
    && orNull(v.hold, (x) => isWord(TOKEN_HOLDS, x)) && orNull(v.holdNode, (x) => typeof x === 'string')
    && isCount(v.failures) && orNull(v.lastFailure, (x) => typeof x === 'string') && typeof v.banner === 'boolean'
    && typeof v.fleetConfirmed === 'string' && Object.hasOwn(FLEET_CONFIRMED_WORDS, v.fleetConfirmed)
    && orNull(v.fleetTransport, (x) => x === 'unmeasured' || isWord(TOKEN_TRANSPORTS, x))
    && orNull(v.lastSync, (x) => isRecord(x) && isInstant(x.at) && typeof x.word === 'string')
    && isCount(v.previousPresented) && isCount(v.retiredPresented) && typeof v.retiredRefused === 'boolean'
    && orNull(v.lastBootRecovery, (x) => isRecord(x) && isInstant(x.at)
      && typeof x.source === 'string' && Object.hasOwn(BOOT_RECOVERY_SOURCES, x.source))
    && (v.stalled === undefined || orNull(v.stalled, (x) => isRecord(x) && isInstant(x.since)
      && typeof x.why === 'string' && Object.hasOwn(STALL_WHYS, x.why)))
    && (v.fileProblem === undefined || orNull(v.fileProblem, (x) => isRecord(x) && isInstant(x.at)
      && typeof x.file === 'string' && Object.hasOwn(FILE_SLOTS, x.file) && isWord(TOKEN_FILE_PROBLEMS, x.word)))
    && isNodeRole(v.role);
  return ok ? { ...(v as unknown as BoxTokenView), stalled: (v.stalled ?? null) as BoxTokenView['stalled'],
    fileProblem: (v.fileProblem ?? null) as BoxTokenView['fileProblem'] } : null;
}

/** A refusal `POST /api/token/rotate` answers (409, 429, 501) read back as the `RotateAnswer` it is, or null for
 *  anything else — the caller then rethrows the `ApiError` it caught. */
export function rotateRefusalOf(err: unknown): RotateAnswer | null {
  if (!(err instanceof ApiError) || !isRecord(err.body) || err.body.ok !== false) return null;
  const b = err.body;
  if (err.status === 409 && b.error === 'held' && isWord(TOKEN_HOLDS, b.hold)
    && orNull(b.node, (x) => typeof x === 'string')) {
    const view = readBoxTokenView(b.view);
    return view === null ? null : { ok: false, error: 'held', hold: b.hold, node: (b.node as string | null), view };
  }
  if (err.status === 429 && b.error === 'rate-limited' && isCount(b.retryAfterS)) {
    return { ok: false, error: 'rate-limited', retryAfterS: b.retryAfterS };
  }
  if (err.status === 501 && b.error === 'not-configured') return { ok: false, error: 'not-configured' };
  return null;
}

/**
 * The Linear section's state, read off `{ok: true, connection}` (also off the `connection` a 409 `not-connected`
 * carries). A state this build does not know, or a field of the wrong type, reads as null: the section then says
 * it could not read the connection, never a state the box did not send. Every key the view has is checked, and
 * NOTHING else is kept, so a field a newer server adds is never rendered by accident.
 */
export function readLinearConnection(raw: unknown): LinearConnectionView | null {
  if (!isRecord(raw)) return null;
  const shown = (outcome: LinearCheckOutcome): { org: string | null; user: string | null; keyTail: string; checkedAt: number; outcome: LinearCheckOutcome } | null => {
    const { org, user, keyTail, checkedAt } = raw;
    if (!orNull(org, (x) => typeof x === 'string') || !orNull(user, (x) => typeof x === 'string')) return null;
    if (typeof keyTail !== 'string' || typeof checkedAt !== 'number' || !Number.isFinite(checkedAt)) return null;
    return { org: org as string | null, user: user as string | null, keyTail, checkedAt, outcome };
  };
  switch (raw.state) {
    case 'not-connected': case 'unreadable': case 'unusable': case 'placeholder':
      return { state: raw.state };
    case 'details-unknown':
      return isWord(LINEAR_DETAILS_PROBLEMS, raw.why) ? { state: 'details-unknown', why: raw.why } : null;
    case 'connected': case 'key-rejected': case 'key-forbidden': case 'unreachable': {
      const state = raw.state;
      const outcome: LinearCheckOutcome = state === 'connected' ? 'ok'
        : state === 'key-rejected' ? 'rejected' : state === 'key-forbidden' ? 'forbidden' : 'unreachable';
      if (!isWord(LINEAR_CHECK_OUTCOMES, raw.outcome) || raw.outcome !== outcome) return null;
      const s = shown(outcome);
      if (s === null) return null;
      return state === 'connected' ? { state, ...s, outcome: 'ok' }
        : state === 'key-rejected' ? { state, ...s, outcome: 'rejected' }
          : state === 'key-forbidden' ? { state, ...s, outcome: 'forbidden' }
            : { state, ...s, outcome: 'unreachable' };
    }
    default:
      return null;
  }
}

/** A 2xx `{ok: true, connection}` body, read; anything else is `'unreadable'`. */
export function linearViewOf(raw: unknown): LinearConnectionView | 'unreadable' {
  return (isRecord(raw) && raw.ok === true ? readLinearConnection(raw.connection) : null) ?? 'unreadable';
}

/**
 * `GET /api/linear/resolve`'s answer for a name that parsed, read (named workspaces S7). `named` is the only kind the
 * sheet asks it about, and the only one read: an `auto` or `refused` answer for a name the grammar here accepted is a
 * server whose grammar differs, and reads as unreadable rather than as a refusal the operator never earned. NOTHING
 * ELSE is kept, so a field a newer server adds is never shown by accident. An offline answer's `reason` is the
 * server's own word when this build knows it, and `unrecognised` when it does not: a lookup that failed in a way
 * this build cannot name is still a failure, never silence.
 */
export function readResolve(raw: unknown): ResolveRead | null {
  if (!isRecord(raw) || raw.kind !== 'named') return null;
  if (typeof raw.title !== 'string' || raw.title === '') return null;
  if (raw.source !== 'linear' && raw.source !== 'offline') return null;
  const note: LookupNote | null = raw.source === 'linear' || raw.reason === undefined
    ? null
    : isResolveReason(raw.reason) ? raw.reason : 'unrecognised';
  return { title: raw.title, source: raw.source, note };
}

/** A named create's 200: the workspace the box made, with the title it was given. `{ok:true}` alone is today's
 *  create, which makes no claim about a name. A named answer this build cannot read is `named: false`: the create
 *  DID land (the exchange completed and answered 2xx), only the title echo is lost, and the board shows the truth. */
export type WorkspaceAddAnswer =
  | { named: false }
  | { named: true; id: string; slug: string; title: string };

export function readWorkspaceAdd(raw: unknown): WorkspaceAddAnswer {
  if (isRecord(raw) && raw.ok === true && typeof raw.id === 'string' && typeof raw.slug === 'string' && typeof raw.title === 'string') {
    return { named: true, id: raw.id, slug: raw.slug, title: raw.title };
  }
  return { named: false };
}

/** What a workspace create can carry. `name` and `wrapper` ride the body only for a NON-BLANK name: a blank one is
 *  today's create (the server ignores `wrapper` then, and an old server has no use for either), so the request is
 *  byte for byte what it was before names existed. */
export interface WorkspaceAddOptions { route?: RouteFields; name?: string; wrapper?: string }

/** What a rename can ask of `POST /api/sessions/:id/title` (named workspaces S9): set the title to text the server
 *  resolves (a plain title, a Linear ticket or a pasted link), or clear it, which hands the row back to the ai-title sweep. */
export type WorkspaceTitleChange = { title: string } | { clear: true };

/** A rename's 200: the title the box now holds, `null` after a clear. An answer this build cannot read is `'unreadable'`:
 *  the exchange completed and answered 2xx, so the rename DID land and only the echo is lost; the board shows the truth. */
export type WorkspaceTitleAnswer = { title: string | null } | 'unreadable';

export function readWorkspaceTitle(raw: unknown): WorkspaceTitleAnswer {
  if (isRecord(raw) && raw.ok === true && (raw.title === null || typeof raw.title === 'string')) return { title: raw.title };
  return 'unreadable';
}

/**
 * The body of `POST /api/updates/intent` — W2's `INTENT_BODY_KEYS`, and nothing
 * else (its parser refuses an unknown key). A PARTIAL over one scope: an omitted
 * field keeps its stored value, so moving one setting cannot clobber another
 * with a stale reading. `pinnedTag: null` clears a pin; leaving it out keeps it.
 * `scope` is `FLEET_SCOPE` for the fleet default, else a node id.
 */
export interface UpdateIntentRequest {
  scope: string;
  channel?: UpdateChannel;
  pinnedTag?: string | null;
  auto?: AutoMode;
  notify?: NotifyMode;
}

/** `POST /api/token/rotate`'s 2xx body, read: a started or joined rotation with a view this build can read, else
 *  `'unreadable'` (the exchange completed, so a rotation may have started). */
export function readRotateStarted(answer: unknown): RotateAnswer | 'unreadable' {
  if (!isRecord(answer) || answer.ok !== true || (answer.outcome !== 'started' && answer.outcome !== 'joined')) {
    return 'unreadable';
  }
  const view = readBoxTokenView(answer.view);
  return view === null ? 'unreadable' : { ok: true, outcome: answer.outcome, view };
}

/** The state a 409 `not-connected` from the Linear check carries (that state IS the check's answer), or null for
 *  any other failure, which the caller rethrows. */
export function linearNotConnectedOf(err: unknown): LinearConnectionView | 'unreadable' | null {
  if (err instanceof ApiError && err.status === 409 && isRecord(err.body) && err.body.error === 'not-connected') {
    return readLinearConnection(err.body.connection) ?? 'unreadable';
  }
  return null;
}

/** What the archive door can be asked beyond the plain tap: `force`, and the two consents that answer a refusal
 *  (workspace lifecycle §5.2). */
export interface ArchiveOptions { force?: boolean; interrupt?: boolean; programme?: 'end' }

/** The archive door's body: each consent rides only when given, and a plain tap sends no body at all. */
export function archiveBody(opts?: ArchiveOptions): ArchiveBody | undefined {
  const body: ArchiveBody = {
    ...(opts?.force === true ? { force: true as const } : {}),
    ...(opts?.interrupt === true ? { interrupt: true as const } : {}),
    ...(opts?.programme === 'end' ? { programme: 'end' as const } : {}),
  };
  return Object.keys(body).length > 0 ? body : undefined;
}

/** A workspace create's body: `route` when given, `name` (and `wrapper`, only beside a name) when the name is
 *  non-blank, and no body at all for today's plain create. */
export function workspaceAddBody(opts: WorkspaceAddOptions): Record<string, unknown> | undefined {
  const name = opts.name?.trim() ?? '';
  const body: Record<string, unknown> = {
    ...(opts.route === undefined ? {} : { route: opts.route }),
    ...(name === '' ? {} : { name, ...(opts.wrapper === undefined ? {} : { wrapper: opts.wrapper }) }),
  };
  return Object.keys(body).length === 0 ? undefined : body;
}
