import type { DatabaseSync } from 'node:sqlite';
import {
  ACCOUNT_ACTS, ACCOUNT_AUDIT_RETENTION_DAYS, ACCOUNT_KEY_PLANE_CODES, ACCOUNT_LANELESS_ACTS, ACCOUNT_OUTCOMES,
  type AccountAct, type AccountKeyPlaneCode, type AccountOutcome,
} from '../../../shared/api.js';
import { ROUTE_REFUSALS, type RouteRefusal } from '../../../shared/refusal.js';
import { PROVIDERS, PROVIDER_IDS, type ConnectMethod, type ProviderId } from '../../../shared/providers.js';
import { ACCOUNT_ID_RE } from '../../../shared/roster.js';
import { NODE_ID_RE } from '../coord/store.js';
import type { CurrentFleetIdentity } from '../fleetidentity.js';

/**
 * THE ACCOUNT AUDIT (D-5516; spec §3.6; plan Task A7): the session-only `account_events` table in coord.db
 * (`coord/schema.ts`, migration 26) and its ONE writer.
 *
 * A row is `{id, at, actor, act, laneId, provider, method?, outcome, code?, keyName?, fleetIdentity}`:
 *  - `actor` is the session's device label and the first 8 hex characters of its `idHash`, minted only by
 *    {@link actorOf} from what the gate measured. Never an IP: nothing here is handed the request.
 *  - `act`, `outcome` and `code` are closed vocabularies (`shared/api.ts`, `shared/refusal.ts`); `provider` and
 *    `method` are `shared/providers.ts`'s. Each is checked here at run time as well as by the types, because the
 *    row is the one durable trace of an account act and a value outside them is a defect, never a row.
 *  - Every other string has one grammar: `laneId` the roster's `ACCOUNT_ID_RE`, `fleetIdentity` the node-id
 *    grammar (`NODE_ID_RE`), and `keyName` a minted OpenRouter key's fixed name, `ccrc <lane-id> <yyyy-mm-dd>`
 *    (D-5555), which is what the operator needs to find it at openrouter.ai.
 *  - So no secret, code, URL, key hint, key hash or email can be written: there is no field that takes free text.
 *
 * AS BUILT (D-5620): `laneId` is NULL only on the laneless acts (`ACCOUNT_LANELESS_ACTS`); `provider` is NULL when
 * the act names none (a laneless act, or a refusal answered before the provider was read); `keyName`
 * is its own column, so the one string a row may carry beside the vocabularies has one grammar; `fleetIdentity` is
 * NULL when the node is not known; a `code` rides only a row that did not end `ok`.
 *
 * Rows are kept {@link ACCOUNT_AUDIT_RETENTION_DAYS} days ({@link AccountAudit.sweep}). v1 writes the table and ships
 * no screen to read it (spec §3.6); the box run reads it with `sqlite3`.
 *
 * L3 adapter over the coord.db handle. A refused or failed write is an answer, never a throw: an audit write must
 * not turn an act that happened into a 500. Logs name the reason word only, never a value.
 */

/** Who acted, as the audit records it. Minted only by {@link actorOf}; a look-alike object is refused. */
export interface AccountActor {
  readonly label: string;
  readonly idHash8: string;
  /** The stored text: `<label> <8 hex>`. */
  toString(): string;
}

const MINTED_ACTORS = new WeakSet<AccountActor>();

/** The longest device label a row carries. The session row keeps up to 120 characters of a user-agent. */
const ACTOR_LABEL_MAX = 64;
const ACTOR_UNKNOWN = 'unknown device';
/** C0, DEL and C1 controls (the 8-bit CSI among them), line and paragraph separators, the combining grapheme
 *  joiner, and every Unicode format character (\p{Cf}) a terminal or a viewer would act on or hide: zero-width and
 *  directional marks (the Arabic letter mark among them), bidi embeddings, overrides and isolates, the soft hyphen,
 *  the interlinear annotation marks, the tag block and the BOM (D-5621). */
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u034f\u2028\u2029\u2060-\u206f\p{Cf}]+/gu;

/**
 * The actor of a gated request: the device label of the session the gate verified (`GateDecision.device`) and the
 * first 8 hex characters of its `idHash`. The label is attribution, never authentication (`auth/gate.ts`); it is
 * stripped of control and format characters and bounded, since a user-agent is attacker-chosen text.
 */
export function actorOf(device: string | null, idHash: string): AccountActor {
  const cleaned = (device ?? '').replace(UNPRINTABLE, ' ').replace(/\s+/g, ' ').trim().slice(0, ACTOR_LABEL_MAX).trim();
  const label = cleaned === '' ? ACTOR_UNKNOWN : cleaned;
  const idHash8 = /^[0-9a-f]{8}/.test(idHash) ? idHash.slice(0, 8) : '00000000';
  const text = `${label} ${idHash8}`;
  const actor: AccountActor = Object.freeze({ label, idHash8, toString: () => text });
  MINTED_ACTORS.add(actor);
  return actor;
}

/** The fleet node an act ran against, as the row records it: the node-id when the identity is known, otherwise
 *  NULL (unmeasured, or a collision). */
export function knownFleetIdentity(cell: { current(): CurrentFleetIdentity } | undefined): string | null {
  const now = cell?.current();
  return now?.kind === 'known' ? now.nodeId : null;
}

/** One row, as a caller states it. */
export interface AccountEventInput {
  act: AccountAct;
  /** The lane the act touched; NULL only for the laneless acts (`ACCOUNT_LANELESS_ACTS`). */
  laneId: string | null;
  /** NULL when the act names no provider: a laneless act, or a refusal answered before the provider was read. */
  provider: ProviderId | null;
  method?: ConnectMethod;
  outcome: AccountOutcome;
  /** The refusal word or key-plane outcome; only on a `refused`, `failed` or `unknown` row. */
  code?: RouteRefusal | AccountKeyPlaneCode;
  /** A minted OpenRouter key's NAME, never the key, its hint or its hash. */
  keyName?: string;
  /** The node-id of the fleet the act ran against, or NULL when it is not known. */
  fleetIdentity: string | null;
  actor: AccountActor;
}

/** Why a write was refused: one word per field, or the store's own failure. */
export type AccountAuditRefusal =
  | 'act' | 'outcome' | 'code' | 'provider' | 'method' | 'actor' | 'lane' | 'fleet-identity' | 'key-name' | 'unwritable';

export type AccountAuditWrite = { ok: true; id: number } | { ok: false; why: AccountAuditRefusal };

const ACTS: ReadonlySet<string> = new Set(ACCOUNT_ACTS);
const LANELESS: ReadonlySet<string> = new Set(ACCOUNT_LANELESS_ACTS);
const OUTCOMES: ReadonlySet<string> = new Set(ACCOUNT_OUTCOMES);
const CODES: ReadonlySet<string> = new Set<string>([...ROUTE_REFUSALS, ...ACCOUNT_KEY_PLANE_CODES]);
const PROVIDER_SET: ReadonlySet<string> = new Set(PROVIDER_IDS);
const METHODS: ReadonlySet<string> = new Set(Object.values(PROVIDERS).flatMap((p) => [...p.connect]));
/** D-5555's fixed name, `ccrc <lane-id> <yyyy-mm-dd>`, with the lane id in the roster's own grammar. */
const KEY_NAME_RE = new RegExp(`^ccrc ${ACCOUNT_ID_RE.source.slice(1, -1)} \\d{4}-\\d{2}-\\d{2}$`);
const DAY_MS = 86_400_000;

/** The first rule a row breaks, or `null` for a row that may be written. */
function refusalOf(e: AccountEventInput): AccountAuditRefusal | null {
  if (typeof e.act !== 'string' || !ACTS.has(e.act)) return 'act';
  if (typeof e.outcome !== 'string' || !OUTCOMES.has(e.outcome)) return 'outcome';
  if (e.code !== undefined && (typeof e.code !== 'string' || !CODES.has(e.code) || e.outcome === 'ok')) return 'code';
  if (e.provider !== null && (typeof e.provider !== 'string' || !PROVIDER_SET.has(e.provider))) return 'provider';
  if (e.method !== undefined && (typeof e.method !== 'string' || !METHODS.has(e.method))) return 'method';
  if (typeof e.actor !== 'object' || e.actor === null || !MINTED_ACTORS.has(e.actor)) return 'actor';
  if (e.laneId === null ? !LANELESS.has(e.act) : (typeof e.laneId !== 'string' || !ACCOUNT_ID_RE.test(e.laneId))) return 'lane';
  if (e.fleetIdentity !== null && (typeof e.fleetIdentity !== 'string' || !NODE_ID_RE.test(e.fleetIdentity))) return 'fleet-identity';
  if (e.keyName !== undefined && (typeof e.keyName !== 'string' || !KEY_NAME_RE.test(e.keyName))) return 'key-name';
  return null;
}

export class AccountAudit {
  /** @param db the process's one coord.db handle (`CoordStore.db`), already migrated. @param now the clock. */
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {}

  /** Writes one row, or refuses it with the first rule it breaks. Never throws. */
  write(e: AccountEventInput): AccountAuditWrite {
    const why = refusalOf(e);
    if (why !== null) {
      console.warn(`ccrc-server: account audit refused a row (${why})`);
      return { ok: false, why };
    }
    try {
      const res = this.db.prepare(
        'INSERT INTO account_events (at, actor, act, laneId, provider, method, outcome, code, keyName, fleetIdentity) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(this.now(), e.actor.toString(), e.act, e.laneId, e.provider, e.method ?? null, e.outcome, e.code ?? null,
        e.keyName ?? null, e.fleetIdentity);
      return { ok: true, id: Number(res.lastInsertRowid) };
    } catch (err) {
      console.warn(`ccrc-server: account audit write failed (${err instanceof Error ? err.name : 'error'})`);
      return { ok: false, why: 'unwritable' };
    }
  }

  /** The retention: every row older than {@link ACCOUNT_AUDIT_RETENTION_DAYS} days at `now` is deleted. Returns the
   *  count, or 0 when the delete failed (said in one line). */
  sweep(now: number): number {
    try {
      const res = this.db.prepare('DELETE FROM account_events WHERE at < ?').run(now - ACCOUNT_AUDIT_RETENTION_DAYS * DAY_MS);
      return Number(res.changes);
    } catch (err) {
      console.warn(`ccrc-server: account audit sweep failed (${err instanceof Error ? err.name : 'error'}) — the next sweep retries`);
      return 0;
    }
  }
}
