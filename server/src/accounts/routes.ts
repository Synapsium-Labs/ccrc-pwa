import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ACCOUNT_CAPS, AT_PROVIDER_KINDS, AT_PROVIDER_PAGES, AT_PROVIDER_STATES, LANE_NOT_READY_REASONS, REGISTRY_ID_MAX_CHARS, isSessionIdShape,
  type AccountAddAnswer, type AccountCheckAnswer, type AccountCredentialAnswer, type AccountOutcome,
  type AccountRemoveAnswer, type AccountRemoveCheckAnswer, type AccountSub, type AccountSwitchAnswer, type AtProviderKind,
  type AtProviderRow, type LaneWire, type RosterWire,
} from '../../../shared/api.js';
import { isLaneIdentity, type LaneStateRead } from '../../../shared/accounts.js';
import { isAccountLaneId, isAccountStdin } from '../../../shared/account-argv.js';
import { PROVIDERS, PROVIDER_IDS, type ConnectMethod, type ProviderId } from '../../../shared/providers.js';
import type { RouteRefusal } from '../../../shared/refusal.js';
import { ACCOUNT_ID_RE } from '../../../shared/roster.js';
import { refuseRoute } from '../refuse.js';
import type { AccountAudit, AccountEventInput } from './audit.js';
import { maskHeld } from './egress.js';
import type { AccountGate } from './gate.js';
import type { AccountOpFields, AccountOpResult, AccountOps } from './ops.js';

/**
 * THE LANE ROUTES: Check, and the kill switch (spec §10, §13.1; D-5511, D-5518; accounts plan Task A14, D-7732). The
 * write routes (A17, D-7739) follow below, under their own header, and share this file's `routeOutcomeOf`.
 *
 *  - `POST /api/accounts/:id/check` runs `ccrc account check` (one probe turn, which spends a request, then the seed
 *    in-verb, A13) and answers `{ok, lane}`.
 *  - `POST /api/accounts/:id/enable` and `/disable` run the verbs of those names and answer `{ok, roster, lane}`.
 *
 * Each takes the account gate FIRST (A7: dark, insecure origin, any verdict but a session, and the fleet's measured
 * `account-v2` cap, in that order), before the id is read or the fleet asked. No step-up: the three are reversible and
 * touch no secret (spec §13.1). No body is read, so none can carry a flag: `enable`'s `--force` is the CLI's alone,
 * and the argv builder (`shared/account-argv.ts`) has no field that becomes it.
 *
 * THE ANSWER IS RE-READ, NEVER INFERRED. After an act that ran, the route reads the lane back (`view`: the telemetry
 * row, the lane-state file and the kill-switch marker, through the same `lanesWire` as `GET /api/accounts`), so the
 * screen's knob moves to what the box now holds.
 *
 * A REFUSAL IS A WORD, NEVER THE VERB'S SENTENCE. The verb's envelope names a code and a sentence that can carry paths
 * and commands; only the code crosses, mapped to a route word (`not-ready` with its reason, `lane-busy`,
 * `last-enabled-home`, `not-found`), or `lane-act-refused` with the code as `verbCode` when it is a plain word. The
 * screen words every refusal from these.
 *
 * AN UNKNOWN OUTCOME IS SAID SO. A timeout, a lost answer or an output past its cap answers `outcome-unknown`: the
 * `ops` port is the reconciling wrapper (`reconcile.ts`), which has already run the `roster` sub and written its
 * `reconcile` row; the route never retries (D-5518).
 *
 * Every act writes one `account_events` row (D-5516) with what ran and how it ended.
 *
 * L4: it reads the request and answers on the reply; every decision it takes is `routeOutcomeOf` (pure), and every
 * read and act is a port the composition root wires.
 */

/** The lane subs these routes run. */
export const LANE_ROUTE_SUBS = ['check', 'enable', 'disable'] as const satisfies readonly AccountSub[];
export type LaneRouteSub = (typeof LANE_ROUTE_SUBS)[number];

export interface AccountRouteDeps {
  /** The account gate (`gate.ts`), built by the composition root. REQUIRED: an account route with no gate is a fleet
   *  act any reader could run. */
  gate: AccountGate;
  /** The ONE `AccountOps` arm, wrapped for reconcile (`reconcile.ts`). */
  ops: Pick<AccountOps, 'run'>;
  /** The roster's lane by id: its provider for the audit row (null when the roster names none), or null for an id the
   *  roster does not hold. */
  laneOf: (id: string) => { provider: ProviderId | null } | null;
  /** The roster `GET /api/accounts` answers, and lane `id` as it reads now (null when the roster no longer holds it). */
  view: (id: string) => Promise<{ roster: RosterWire[]; lane: LaneWire | null }>;
  audit?: Pick<AccountAudit, 'write'>;
  /** The node-id of the fleet the act ran against, or null when it is not known. */
  fleetIdentity: () => string | null;
  /** Lane `id`'s lane-state file as the server reads it, and whether its kill-switch marker holds it off: discard's
   *  check (A17). */
  laneState: (id: string) => Promise<{ lane: LaneStateRead; disabled: boolean }>;
  /** The registry rows naming lane `id` (its `wrapper` or `home`), live, asleep or archived; null when the registry
   *  could not be listed, which refuses a discard rather than reading as no session (A17). */
  sessionsOn: (id: string) => Promise<readonly string[] | null>;
}

/** What one run means for the route: the act ran to a good end, or the refusal word to answer, its extra fields, and
 *  the audit row's outcome. */
export type RouteOutcome =
  | { kind: 'ok' }
  | { kind: 'refuse'; word: RouteRefusal; extra: Readonly<Record<string, RefusalExtra>>; audit: Exclude<AccountOutcome, 'ok'> };
/** A refusal's extra field: a word, a fact the box measured, or the session ids it named. */
export type RefusalExtra = string | boolean | readonly string[];

/** A verb's code as a word: the verbs' own codes are kebab words (`_acct_refuse`'s second argument). */
const VERB_CODE_RE = /^[a-z][a-z0-9-]{0,47}$/;

/** The verb's one JSON document, read whole: the verbs answer one; a line of output before it is tolerated by reading
 *  the last line too. Null when neither is a JSON object. */
function answerOf(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim();
  for (const candidate of [text, text.slice(text.lastIndexOf('\n') + 1)]) {
    try {
      const j: unknown = JSON.parse(candidate);
      if (typeof j === 'object' && j !== null && !Array.isArray(j)) return j as Record<string, unknown>;
    } catch { /* not this candidate */ }
  }
  return null;
}

/** The verb's refusal envelope (`{ok: false, error, reason?, detail, …}`), or null. Only the code and the named facts
 *  are read by the callers; the sentence never is. */
function envelopeOf(stdout: string): (Record<string, unknown> & { error: string }) | null {
  const j = answerOf(stdout);
  return j !== null && j['ok'] === false && typeof j['error'] === 'string' ? j as Record<string, unknown> & { error: string } : null;
}

/** The most session ids a refusal names. */
const SESSIONS_MAX = 64;
/** The session ids a verb's refusal named, held to the session-id shape (and the registry's length cap) for the screen
 *  to list; anything else is dropped. Display only: no id here is ever composed into an argv. */
const sessionIdsOf = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.length <= REGISTRY_ID_MAX_CHARS && isSessionIdShape(x)).slice(0, SESSIONS_MAX)
    : [];

/** The verb codes that cross as a route word of the same spelling (D-7739), with nothing but the word. */
const SAME_WORD = new Set<string>([
  'lane-busy', 'last-enabled-home', 'key-charset', 'key-rejected', 'token-unverified', 'upstream', 'last-home-able',
  'auth-in-progress', 'not-discardable', 'not-a-token-lane', 'bad-stated', 'duplicate-id',
] satisfies RouteRefusal[]);

/** The route's reading of one run (pure). */
export function routeOutcomeOf(r: AccountOpResult): RouteOutcome {
  switch (r.kind) {
    case 'exited': {
      if (r.code === 0) return { kind: 'ok' };
      const env = envelopeOf(r.stdout);
      if (env === null) return { kind: 'refuse', word: 'lane-act-refused', extra: {}, audit: 'failed' };
      switch (env.error) {
        case 'not-ready': {
          const reason: Record<string, string> =
            typeof env.reason === 'string' && (LANE_NOT_READY_REASONS as readonly string[]).includes(env.reason)
              ? { reason: env.reason } : {};
          return { kind: 'refuse', word: 'not-ready', extra: reason, audit: 'refused' };
        }
        case 'unknown-id': return { kind: 'refuse', word: 'not-found', extra: {}, audit: 'refused' };
        // The removal's census (spec §11.2, N3): the ids, never the sentence that lists them.
        case 'live-sessions':
          return { kind: 'refuse', word: 'live-sessions', extra: { sessions: sessionIdsOf(env['live']) }, audit: 'refused' };
        case 'sleeping-sessions':
          return { kind: 'refuse', word: 'sleeping-sessions', extra: { sessions: sessionIdsOf(env['sleeping']) }, audit: 'refused' };
        // G20: whether the config dir the box found is signed in, when it could tell; never the identity it named.
        case 'config-dir-exists': {
          const found = env['found'] as { signedIn?: unknown } | null | undefined;
          const signedIn: Record<string, RefusalExtra> =
            found !== null && typeof found === 'object' && typeof found.signedIn === 'boolean' ? { signedIn: found.signedIn } : {};
          return { kind: 'refuse', word: 'config-dir-exists', extra: signedIn, audit: 'refused' };
        }
        default:
          if (SAME_WORD.has(env.error)) return { kind: 'refuse', word: env.error as RouteRefusal, extra: {}, audit: 'refused' };
          return {
            kind: 'refuse', word: 'lane-act-refused', audit: 'refused',
            extra: VERB_CODE_RE.test(env.error) ? { verbCode: env.error } : {},
          };
      }
    }
    // The box may have acted: the wrapper reconciled, and the screen re-reads.
    case 'timeout': case 'lost': case 'too-large':
      return { kind: 'refuse', word: 'outcome-unknown', extra: {}, audit: 'unknown' };
    // Nothing ran.
    case 'not-started': return { kind: 'refuse', word: 'unavailable', extra: {}, audit: 'failed' };
    case 'unsupported': return { kind: 'refuse', word: 'unsupported', extra: {}, audit: 'refused' };
    // The port's own bytes rule refused the secret (a caller that skipped the route's check): its word, not the shape's.
    case 'refused':
      return { kind: 'refuse', word: r.why === 'key-charset' ? 'key-charset' : 'bad-request', extra: {}, audit: 'refused' };
    default: return r satisfies never;
  }
}

export function registerAccountRoutes(app: FastifyInstance, deps: AccountRouteDeps): void {
  const act = (sub: LaneRouteSub) => async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    // The gate first: before the id is read, before the fleet is asked. It sets `no-store` on every answer.
    const g = deps.gate(req, reply, { cap: ACCOUNT_CAPS[0] });
    if (!g.pass) return reply;
    const id = (req.params as { id?: unknown }).id;
    if (typeof id !== 'string' || !ACCOUNT_ID_RE.test(id)) return refuseRoute(reply, 'bad-account-id');
    const lane = deps.laneOf(id);
    if (lane === null) return refuseRoute(reply, 'not-found');
    const outcome = routeOutcomeOf(await deps.ops.run(sub, id, {}));
    deps.audit?.write({
      act: sub, laneId: id, provider: lane.provider,
      ...(outcome.kind === 'ok' ? { outcome: 'ok' } : { outcome: outcome.audit, code: outcome.word }),
      fleetIdentity: deps.fleetIdentity(), actor: g.actor,
    });
    if (outcome.kind === 'refuse') return refuseRoute(reply, outcome.word, outcome.extra);
    const v = await deps.view(id);
    // The roster lost the lane between the act and the read (a removal raced it): say so rather than answer a lane.
    if (v.lane === null) return refuseRoute(reply, 'not-found');
    if (sub === 'check') return { ok: true, lane: v.lane } satisfies AccountCheckAnswer;
    return { ok: true, roster: v.roster, lane: v.lane } satisfies AccountSwitchAnswer;
  };
  app.post('/api/accounts/:id/check', act('check'));
  app.post('/api/accounts/:id/enable', act('enable'));
  app.post('/api/accounts/:id/disable', act('disable'));
  registerAccountWriteRoutes(app, deps);
}

// ── THE WRITE ROUTES (spec §3.2, §3.3, §11, §13.1; D-5511, D-5512, D-5513, D-5516; accounts plan Task A17, D-7739) ──

/** The body's own fields, or null for a body that is not a plain JSON object. */
function bodyOf(req: FastifyRequest): Record<string, unknown> | null {
  const b = req.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return null;
  const proto = Object.getPrototypeOf(b) as unknown;
  return proto === Object.prototype || proto === null ? b as Record<string, unknown> : null;
}

/** Whether `b` names only `allowed` keys. A key a later wave owns (`limit`, `models`, …) is a bad request here. */
const onlyKeys = (b: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(b).every((k) => allowed.includes(k));

/** The secret's bytes, or null when they fail the one bytes rule (`isAccountStdin`: 1 byte to 8 KiB, no NUL, other C0
 *  byte or DEL), which the route checks before any op (spec §3.3) and the verb checks again. */
function secretBytesOf(v: string): Buffer | null {
  const bytes = Buffer.from(v, 'utf8');
  return isAccountStdin(bytes) ? bytes : null;
}

/** What discard's route-side check decided (spec §11.5): the lane may be discarded, or the word to refuse with. */
export type DiscardVerdict =
  | { ok: true }
  | { ok: false; word: 'not-discardable'; sessions?: readonly string[] }
  | { ok: false; word: 'unmeasured' };

/**
 * DISCARD IS CHECKED TWICE (spec §11.5): here, before the op, and again by the verb. A lane is discardable only when
 * its lane state records that `add` made it (`addedAt`) and that `enable` never switched it on (`enabledAt` absent),
 * its marker still holds it off, and no registry row names it. A lane-state file the server cannot read is no record of
 * adding it; a registry it cannot list is unmeasured, never "no session". The verb adds the rest (upstream, a sign-in in
 * flight) under its lock. Pure.
 */
export function discardVerdictOf(lane: LaneStateRead, disabled: boolean, sessions: readonly string[] | null): DiscardVerdict {
  if (lane.kind !== 'read' || lane.state.addedAt === undefined || lane.state.enabledAt !== undefined || !disabled) {
    return { ok: false, word: 'not-discardable' };
  }
  if (sessions === null) return { ok: false, word: 'unmeasured' };
  if (sessions.length > 0) return { ok: false, word: 'not-discardable', sessions: sessions.slice(0, SESSIONS_MAX) };
  return { ok: true };
}

/** The longest ledger line, and the most lines, a removal's answer carries. */
const LEDGER_LINE_MAX = 512;
const LEDGER_LINES_MAX = 128;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const ledgerLinesOf = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x !== '' && x.length <= LEDGER_LINE_MAX && !CONTROL_RE.test(x))
      .slice(0, LEDGER_LINES_MAX)
    : [];

const oneOf = <T extends string>(set: readonly T[], v: unknown): v is T => typeof v === 'string' && (set as readonly string[]).includes(v);

/** The `atProvider` rows the box answered, each held to the closed vocabularies (a sign-in's state is `unmeasured` until
 *  G23 runs, the OA1 record); a row off them is dropped, never guessed. */
const atProviderOf = (v: unknown): AtProviderRow[] =>
  Array.isArray(v)
    ? v.flatMap((x): AtProviderRow[] => {
      const r = x as { kind?: unknown; state?: unknown; revokeAt?: unknown } | null;
      if (r === null || typeof r !== 'object' || !oneOf(AT_PROVIDER_KINDS, r.kind) || !oneOf(AT_PROVIDER_STATES, r.state)) return [];
      if (r.revokeAt !== null && !oneOf(AT_PROVIDER_PAGES, r.revokeAt)) return [];
      return [{ kind: r.kind, state: r.state, revokeAt: r.revokeAt }];
    })
    : [];

/** The removal's ledger, read off the verb's `removed` answer (spec §11.3), or null when the answer is not one. */
export function removedLedgerOf(stdout: string): Omit<AccountRemoveAnswer, 'ok' | 'roster'> | null {
  const j = answerOf(stdout);
  if (j === null || j['ok'] !== true) return null;
  return {
    removed: ledgerLinesOf(j['removed']), kept: ledgerLinesOf(j['kept']), rehomed: ledgerLinesOf(j['rehomed']),
    atProvider: atProviderOf(j['atProvider']),
  };
}

const NODE_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Remove's pre-check, read off the verb's dry-run answer (spec §11.1; A16's `remove --dry-run`), or null when the
 *  answer is not one. */
export function removeCheckOf(stdout: string): Omit<AccountRemoveCheckAnswer, 'ok'> | null {
  const j = answerOf(stdout);
  if (j === null || j['ok'] !== true || j['dryRun'] !== true) return null;
  const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 9999 ? v : null);
  const at = typeof j['at'] === 'string' ? Date.parse(j['at']) : NaN;
  const live = j['live'] === null ? null : count(j['live']);
  const archived = count(j['archived']);
  const otherHomeAble = count(j['otherHomeAble']);
  if ((j['live'] !== null && live === null) || archived === null || otherHomeAble === null || !Number.isFinite(at)) return null;
  for (const k of ['upstream', 'authInProgress', 'discardable']) if (typeof j[k] !== 'boolean') return null;
  return {
    check: {
      live, sleeping: sessionIdsOf(j['sleeping']), archived, upstream: j['upstream'] as boolean, otherHomeAble,
      authInProgress: j['authInProgress'] as boolean, discardable: j['discardable'] as boolean, at,
    },
    fleetIdentity: typeof j['fleetIdentity'] === 'string' && NODE_ID_SHAPE.test(j['fleetIdentity']) ? j['fleetIdentity'] : null,
  };
}

/** The provider a credential kind belongs to, for the revoke row of a lane that may already be gone. */
const KIND_PROVIDER: Readonly<Record<AtProviderKind, ProviderId>> = {
  'anthropic-token': 'anthropic', 'anthropic-sign-in': 'anthropic', 'openrouter-key': 'openrouter', 'api-key': 'compatible',
  'codex': 'openai',
};

/**
 * THE WRITE ROUTES (spec §13.1, the first wave's; accounts plan Task A17):
 *  - `POST /api/accounts` (step-up): `{provider, id, label, hue, method?, credential?, placement?, adopt?}` → `ccrc
 *    account add`, answering `{ok, roster, lane, fleetIdentity}`. An id the server's roster already holds answers
 *    `lane-exists` with that lane, so a retry after an outcome-unknown add finds the lane rather than `duplicate-id`.
 *  - `POST /api/accounts/:id/credential` (step-up): `{credential}` → `ccrc account credential`, answering `{ok, lane}`.
 *  - `POST /api/accounts/:id/set`: `{stated?, placement?}` → `ccrc account set`, answering `{ok, roster, lane}`. No
 *    step-up: neither changes a method nor raises a minted key's commitment, the only `set`s spec §3.2 steps up, and
 *    neither is a later wave's (`limit`, `limitReset` are A32's and refused here). The stated account rides stdin.
 *  - `POST /api/accounts/:id/remove`: `{mode:'remove', confirmId}` (step-up; the typed id must equal the lane's,
 *    `confirm-mismatch`), `{mode:'discard'}` (step-up, no typed confirm, checked here before the op and by the verb), or
 *    `{mode:'check'}`, which changes nothing, so needs no step-up: `remove --dry-run`'s measurements with `fleetIdentity`.
 *  - `POST /api/accounts/revoke-ack` (N6, D-7738): `{laneId, kind}` writes one `revoke-acknowledged` row with no value
 *    and runs no op, so it takes the gate with `cap: null`. Outside `/api/accounts/:id`: the lane may already be gone.
 *
 * Each takes the account gate FIRST. Remove's gate is taken without the step-up, then again with it once the body says
 * the mode needs one, so a pre-check is never asked to step up and an act always is.
 *
 * THE SECRET (spec §3.3, D-5513). The route checks its bytes and size before the op (`key-charset`), holds it for this
 * request only as a local, passes it to the op as stdin (the remote arm's `stdinB64`), zeroes its buffer once the op
 * answered, and masks its exact bytes and their base64 in every text it returns (`maskHeld`), on top of the answer hook.
 * Nothing here logs a body, a field or an answer. Refusal sentences come from codes (`routeOutcomeOf`); the verb's own
 * sentence and every child's output stay on the box.
 *
 * Every mutating answer chains `reloadRoster` (the reconciling `ops` wrapper feeds each answer that carries a roster to
 * it, fingerprints included) and every error or timeout reconciles (the same wrapper); the route never retries. Every
 * act writes one `account_events` row; the pre-check, which changes nothing, writes none.
 */
function registerAccountWriteRoutes(app: FastifyInstance, deps: AccountRouteDeps): void {
  const cap = ACCOUNT_CAPS[0];
  type Row = Omit<AccountEventInput, 'fleetIdentity'>;
  const audit = (row: Row): boolean => deps.audit?.write({ ...row, fleetIdentity: deps.fleetIdentity() }).ok === true;
  const ended = (o: RouteOutcome): Pick<AccountEventInput, 'outcome' | 'code'> =>
    (o.kind === 'ok' ? { outcome: 'ok' } : { outcome: o.audit, code: o.word });
  /** Runs one op with the secret on stdin, and zeroes the route's own copy of its bytes once the op answered. */
  const runHolding = async (sub: AccountSub, id: string, fields: AccountOpFields, bytes?: Buffer): Promise<AccountOpResult> => {
    try { return await deps.ops.run(sub, id, fields, bytes); } finally { bytes?.fill(0); }
  };
  const laneIdOf = (req: FastifyRequest): string | null => {
    const id = (req.params as { id?: unknown }).id;
    return typeof id === 'string' && ACCOUNT_ID_RE.test(id) ? id : null;
  };

  app.post('/api/accounts', async (req, reply) => {
    const g = deps.gate(req, reply, { cap, stepUp: true });
    if (!g.pass) return reply;
    const b = bodyOf(req);
    if (b === null) return refuseRoute(reply, 'bad-request');
    const id = b['id'];
    if (!isAccountLaneId(id)) return refuseRoute(reply, 'bad-account-id');
    const provider = PROVIDER_IDS.find((p) => p === b['provider']) ?? null;
    const method = provider !== null && (PROVIDERS[provider].connect as readonly unknown[]).includes(b['method'])
      ? b['method'] as ConnectMethod : undefined;
    const row = (o: Pick<AccountEventInput, 'outcome' | 'code'>): boolean =>
      audit({ act: 'add', laneId: id, provider, ...(method !== undefined ? { method } : {}), ...o, actor: g.actor });
    const credential = b['credential'];
    const strings = ['provider', 'label', 'hue', 'method', 'placement'] as const;
    if (!onlyKeys(b, ['id', ...strings, 'credential', 'adopt'])
        || ['provider', 'label', 'hue'].some((k) => typeof b[k] !== 'string')
        || strings.some((k) => b[k] !== undefined && typeof b[k] !== 'string')
        || (credential !== undefined && typeof credential !== 'string')
        || (b['adopt'] !== undefined && b['adopt'] !== true)) {
      row({ outcome: 'refused', code: 'bad-request' });
      return refuseRoute(reply, 'bad-request');
    }
    const held = typeof credential === 'string' ? [credential] : [];
    const bytes = typeof credential === 'string' ? secretBytesOf(credential) : undefined;
    if (bytes === null) {
      row({ outcome: 'refused', code: 'key-charset' });
      return refuseRoute(reply, 'key-charset');
    }
    // The roster already holds the id: after an add whose outcome was unknown, the reconcile found it. Say so, with the
    // lane, rather than run an add into the verb's `duplicate-id` (spec §6.2).
    if (deps.laneOf(id) !== null) {
      bytes?.fill(0);
      row({ outcome: 'refused', code: 'lane-exists' });
      const v = await deps.view(id);
      return refuseRoute(reply, 'lane-exists', v.lane === null ? {} : { lane: v.lane });
    }
    const fields: Record<string, string> = {};
    for (const k of strings) if (typeof b[k] === 'string') fields[k] = b[k] as string;
    if (b['adopt'] === true) fields['adopt'] = 'true';
    const outcome = routeOutcomeOf(await runHolding('add', id, fields, bytes));
    row(ended(outcome));
    if (outcome.kind === 'refuse') return refuseRoute(reply, outcome.word, maskHeld(outcome.extra, held));
    const v = await deps.view(id);
    // The act ran, and the server could not take the roster it answered (another fleet's, or one it refused): the
    // screen re-reads, as for any outcome the server could not learn.
    if (v.lane === null) return refuseRoute(reply, 'outcome-unknown');
    return maskHeld({ ok: true, roster: v.roster, lane: v.lane, fleetIdentity: deps.fleetIdentity() } satisfies AccountAddAnswer, held);
  });

  app.post('/api/accounts/:id/credential', async (req, reply) => {
    const g = deps.gate(req, reply, { cap, stepUp: true });
    if (!g.pass) return reply;
    const id = laneIdOf(req);
    if (id === null) return refuseRoute(reply, 'bad-account-id');
    const lane = deps.laneOf(id);
    if (lane === null) return refuseRoute(reply, 'not-found');
    const row = (o: Pick<AccountEventInput, 'outcome' | 'code'>): boolean =>
      audit({ act: 'credential', laneId: id, provider: lane.provider, ...o, actor: g.actor });
    const b = bodyOf(req);
    // The first wave's one form: a replacement by paste. `{method:'mint'}` and `{retire}` are A32's.
    if (b === null || !onlyKeys(b, ['credential']) || typeof b['credential'] !== 'string') {
      row({ outcome: 'refused', code: 'bad-request' });
      return refuseRoute(reply, 'bad-request');
    }
    const held = [b['credential']];
    const bytes = secretBytesOf(b['credential']);
    if (bytes === null) {
      row({ outcome: 'refused', code: 'key-charset' });
      return refuseRoute(reply, 'key-charset');
    }
    const outcome = routeOutcomeOf(await runHolding('credential', id, {}, bytes));
    row(ended(outcome));
    if (outcome.kind === 'refuse') return refuseRoute(reply, outcome.word, maskHeld(outcome.extra, held));
    const v = await deps.view(id);
    if (v.lane === null) return refuseRoute(reply, 'not-found');
    return maskHeld({ ok: true, lane: v.lane } satisfies AccountCredentialAnswer, held);
  });

  app.post('/api/accounts/:id/set', async (req, reply) => {
    const g = deps.gate(req, reply, { cap });
    if (!g.pass) return reply;
    const id = laneIdOf(req);
    if (id === null) return refuseRoute(reply, 'bad-account-id');
    const lane = deps.laneOf(id);
    if (lane === null) return refuseRoute(reply, 'not-found');
    const row = (o: Pick<AccountEventInput, 'outcome' | 'code'>): boolean =>
      audit({ act: 'set', laneId: id, provider: lane.provider, ...o, actor: g.actor });
    const b = bodyOf(req);
    if (b === null || !onlyKeys(b, ['stated', 'placement']) || (b['stated'] === undefined && b['placement'] === undefined)
        || (b['placement'] !== undefined && typeof b['placement'] !== 'string')) {
      row({ outcome: 'refused', code: 'bad-request' });
      return refuseRoute(reply, 'bad-request');
    }
    // The stated account names a person: held to the lane-state file's identity grammar, carried on stdin, never argv.
    if (b['stated'] !== undefined && !isLaneIdentity(b['stated'])) {
      row({ outcome: 'refused', code: 'bad-stated' });
      return refuseRoute(reply, 'bad-stated');
    }
    const stated = typeof b['stated'] === 'string' ? Buffer.from(b['stated'], 'utf8') : undefined;
    const fields: Record<string, string> = typeof b['placement'] === 'string' ? { placement: b['placement'] } : {};
    const outcome = routeOutcomeOf(await runHolding('set', id, fields, stated));
    row(ended(outcome));
    if (outcome.kind === 'refuse') return refuseRoute(reply, outcome.word, outcome.extra);
    const v = await deps.view(id);
    if (v.lane === null) return refuseRoute(reply, 'not-found');
    return { ok: true, roster: v.roster, lane: v.lane } satisfies AccountSwitchAnswer;
  });

  app.post('/api/accounts/:id/remove', async (req, reply) => {
    // The gate without the step-up first: the pre-check changes nothing, and every other mode is gated again below.
    const g0 = deps.gate(req, reply, { cap });
    if (!g0.pass) return reply;
    const id = laneIdOf(req);
    if (id === null) return refuseRoute(reply, 'bad-account-id');
    const lane = deps.laneOf(id);
    if (lane === null) return refuseRoute(reply, 'not-found');
    const b = bodyOf(req);
    const mode = b?.['mode'];
    const shapeOk = b !== null && (
      (mode === 'remove' && onlyKeys(b, ['mode', 'confirmId']) && typeof b['confirmId'] === 'string')
      || ((mode === 'discard' || mode === 'check') && onlyKeys(b, ['mode'])));
    if (!shapeOk) return refuseRoute(reply, 'bad-request');

    if (mode === 'check') {
      const r = await deps.ops.run('remove', id, { mode: 'check' });
      const outcome = routeOutcomeOf(r);
      if (outcome.kind === 'refuse') return refuseRoute(reply, outcome.word, outcome.extra);
      const check = r.kind === 'exited' ? removeCheckOf(r.stdout) : null;
      if (check === null) return refuseRoute(reply, 'outcome-unknown');
      return { ok: true, ...check, fleetIdentity: check.fleetIdentity ?? deps.fleetIdentity() } satisfies AccountRemoveCheckAnswer;
    }

    const g = deps.gate(req, reply, { cap, stepUp: true });
    if (!g.pass) return reply;
    const act = mode === 'discard' ? 'discard' : 'remove';
    const row = (o: Pick<AccountEventInput, 'outcome' | 'code'>): boolean =>
      audit({ act, laneId: id, provider: lane.provider, ...o, actor: g.actor });
    if (mode === 'remove' && b['confirmId'] !== id) {
      row({ outcome: 'refused', code: 'confirm-mismatch' });
      return refuseRoute(reply, 'confirm-mismatch');
    }
    if (mode === 'discard') {
      const st = await deps.laneState(id);
      const verdict = discardVerdictOf(st.lane, st.disabled, await deps.sessionsOn(id));
      if (!verdict.ok) {
        row({ outcome: 'refused', code: verdict.word });
        return refuseRoute(reply, verdict.word, verdict.word === 'not-discardable' && verdict.sessions !== undefined
          ? { sessions: verdict.sessions } : {});
      }
    }
    const r = await deps.ops.run('remove', id, { mode: act });
    const ran = routeOutcomeOf(r);
    const ledger = ran.kind === 'ok' && r.kind === 'exited' ? removedLedgerOf(r.stdout) : null;
    if (ledger === null) {
      // A removal that answered ok and no ledger: the box acted, and what it did cannot be said, so it is unknown.
      const refused: Extract<RouteOutcome, { kind: 'refuse' }> = ran.kind === 'refuse' ? ran
        : { kind: 'refuse', word: 'outcome-unknown', extra: {}, audit: 'unknown' };
      row(ended(refused));
      return refuseRoute(reply, refused.word, refused.extra);
    }
    row({ outcome: 'ok' });
    const v = await deps.view(id);
    return { ok: true, roster: v.roster, ...ledger } satisfies AccountRemoveAnswer;
  });

  app.post('/api/accounts/revoke-ack', async (req, reply) => {
    // No ccd verb runs: the row is the whole act (N6, D-7738).
    const g = deps.gate(req, reply, { cap: null });
    if (!g.pass) return reply;
    const b = bodyOf(req);
    if (b === null || !onlyKeys(b, ['laneId', 'kind'])) return refuseRoute(reply, 'bad-request');
    const laneId = b['laneId'];
    if (typeof laneId !== 'string' || !ACCOUNT_ID_RE.test(laneId)) return refuseRoute(reply, 'bad-account-id');
    if (!oneOf(AT_PROVIDER_KINDS, b['kind'])) return refuseRoute(reply, 'bad-request');
    const wrote = audit({ act: 'revoke-acknowledged', laneId, provider: KIND_PROVIDER[b['kind']], outcome: 'ok', actor: g.actor });
    // The tick is recorded or it is not: an unwritten row is never answered as recorded.
    if (!wrote) return refuseRoute(reply, 'unavailable');
    return { ok: true };
  });
}
