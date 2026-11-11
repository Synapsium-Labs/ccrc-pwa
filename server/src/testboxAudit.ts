import type { DatabaseSync } from 'node:sqlite';
import type { TestboxEventRow } from '../../shared/api.js';
import { ROUTE_REFUSALS, type RouteRefusal } from '../../shared/refusal.js';
import {
  TESTBOX_ACTS, TESTBOX_ACT_OUTCOMES, TESTBOX_ADMIN_CODES, isHostKeyFingerprint,
  type TestboxAct, type TestboxActOutcome, type TestboxAdminCode,
} from '../../shared/testbox-admin.js';
// `NODE_ID_RE` straight from its L0 home, as `accounts/audit.ts` does (D-5896).
import { NODE_ID_RE } from '../../shared/agent-protocol.js';
import { isMintedActor, type AccountActor } from './accounts/audit.js';

/**
 * THE TEST BOX LEDGER (test box connect spec §2.10; plan TC12, D-8166): the session-only `testbox_events` table in coord.db
 * (`coord/schema.ts`, migration 54) and its ONE writer, on `accounts/audit.ts`'s shape.
 *
 * A row is `{id, at, actor, act, actId?, outcome, code?, fingerprint?, fleetIdentity}`:
 *  - `actor` is minted only by `actorOf` from what the gate measured (the session's device label and 8 hex characters of its
 *    `idHash`); a look-alike object is refused. Never an IP.
 *  - `act`, `outcome` and `code` are closed vocabularies (`TESTBOX_ACTS`, `TESTBOX_ACT_OUTCOMES`, and the union of
 *    `TESTBOX_ADMIN_CODES` with `ROUTE_REFUSALS`); a code rides only a row that did not end `ok`.
 *  - `fingerprint` is the host key's SHA-256 form (`isHostKeyFingerprint`); `fleetIdentity` the node-id grammar; `actId` a
 *    long act's 32-hex id, UNIQUE, so the lane that writes an act's end row (plan TC13) cannot write it twice across a restart.
 *  - So no address, path, secret or free text can be written: there is no field that takes it.
 *
 * Rows are kept {@link TESTBOX_AUDIT_RETENTION_DAYS} days ({@link TestboxAudit.sweep}).
 *
 * L3 adapter over the coord.db handle. A refused or failed write is an answer, never a throw: an audit write must not turn an
 * act that happened into a 500. Logs name the reason word only, never a value.
 */

/** How long a `testbox_events` row is kept: a row older than this is swept (spec §2.10). */
export const TESTBOX_AUDIT_RETENTION_DAYS = 365;

/** One row, as a caller states it. */
export interface TestboxEventInput {
  act: TestboxAct;
  /** A long act's id (32 lowercase hex); absent for a short act. */
  actId?: string;
  outcome: TestboxActOutcome;
  /** The verb's closed code or a route refusal word; only on a `refused`, `failed` or `unknown` row. */
  code?: TestboxAdminCode | RouteRefusal;
  /** The host key a `confirm-host-key` row pins, in its SHA-256 form. */
  fingerprint?: string;
  /** The node-id of the fleet the act ran against, or NULL when it is not known. */
  fleetIdentity: string | null;
  actor: AccountActor;
}

/** Why a write was refused: one word per field, or the store's own failure. */
export type TestboxAuditRefusal = 'act' | 'outcome' | 'code' | 'act-id' | 'fingerprint' | 'fleet-identity' | 'actor' | 'duplicate' | 'unwritable';
export type TestboxAuditWrite = { ok: true; id: number } | { ok: false; why: TestboxAuditRefusal };

const ACTS: ReadonlySet<string> = new Set(TESTBOX_ACTS);
const OUTCOMES: ReadonlySet<string> = new Set(TESTBOX_ACT_OUTCOMES);
const CODES: ReadonlySet<string> = new Set<string>([...TESTBOX_ADMIN_CODES, ...ROUTE_REFUSALS]);
const ACT_ID_RE = /^[0-9a-f]{32}$/;
const DAY_MS = 86_400_000;

/** The first rule a row breaks, or `null` for a row that may be written. */
function refusalOf(e: TestboxEventInput): TestboxAuditRefusal | null {
  if (typeof e.act !== 'string' || !ACTS.has(e.act)) return 'act';
  if (typeof e.outcome !== 'string' || !OUTCOMES.has(e.outcome)) return 'outcome';
  if (e.code !== undefined && (typeof e.code !== 'string' || !CODES.has(e.code) || e.outcome === 'ok')) return 'code';
  if (e.actId !== undefined && (typeof e.actId !== 'string' || !ACT_ID_RE.test(e.actId))) return 'act-id';
  if (e.fingerprint !== undefined && !isHostKeyFingerprint(e.fingerprint)) return 'fingerprint';
  if (!isMintedActor(e.actor)) return 'actor';
  if (e.fleetIdentity !== null && (typeof e.fleetIdentity !== 'string' || !NODE_ID_RE.test(e.fleetIdentity))) return 'fleet-identity';
  return null;
}

export class TestboxAudit {
  /** @param db the process's one coord.db handle (`CoordStore.db`), already migrated. @param now the clock. */
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {}

  /** Writes one row, or refuses it with the first rule it breaks. Never throws. */
  write(e: TestboxEventInput): TestboxAuditWrite {
    const why = refusalOf(e);
    if (why !== null) {
      console.warn(`ccrc-server: testbox audit refused a row (${why})`);
      return { ok: false, why };
    }
    try {
      const res = this.db.prepare(
        'INSERT INTO testbox_events (at, actor, act, actId, outcome, code, fingerprint, fleetIdentity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(this.now(), e.actor.toString(), e.act, e.actId ?? null, e.outcome, e.code ?? null, e.fingerprint ?? null, e.fleetIdentity);
      return { ok: true, id: Number(res.lastInsertRowid) };
    } catch (err) {
      // `actId` is the table's one UNIQUE column: its constraint is a repeated act id, not a broken store.
      if (e.actId !== undefined && err instanceof Error && /UNIQUE/i.test(err.message)) return { ok: false, why: 'duplicate' };
      console.warn(`ccrc-server: testbox audit write failed (${err instanceof Error ? err.name : 'error'})`);
      return { ok: false, why: 'unwritable' };
    }
  }

  /** Whether a long act's end row is already written, so a restarted lane never writes it twice. A read that fails is
   *  `false`; the table's UNIQUE `actId` still refuses a second row. */
  hasAct(actId: string): boolean {
    try { return this.db.prepare('SELECT 1 AS x FROM testbox_events WHERE actId = ?').get(actId) !== undefined; } catch { return false; }
  }

  /** The `limit` newest rows, newest first. A failed read is an empty list (said in one line), never a throw. */
  recent(limit: number): TestboxEventRow[] {
    try {
      return this.db.prepare(
        'SELECT id, at, actor, act, actId, outcome, code, fingerprint, fleetIdentity FROM testbox_events ORDER BY id DESC LIMIT ?',
      ).all(Math.max(0, Math.floor(limit))) as unknown as TestboxEventRow[];
    } catch (err) {
      console.warn(`ccrc-server: testbox audit read failed (${err instanceof Error ? err.name : 'error'})`);
      return [];
    }
  }

  /** The retention: every row older than {@link TESTBOX_AUDIT_RETENTION_DAYS} days at `now` is deleted. Returns the count,
   *  or 0 when the delete failed (said in one line). */
  sweep(now: number): number {
    try {
      const res = this.db.prepare('DELETE FROM testbox_events WHERE at < ?').run(now - TESTBOX_AUDIT_RETENTION_DAYS * DAY_MS);
      return Number(res.changes);
    } catch (err) {
      console.warn(`ccrc-server: testbox audit sweep failed (${err instanceof Error ? err.name : 'error'}) — the next sweep retries`);
      return 0;
    }
  }
}
