/**
 * `runCcrcOp`, THE SERVER-INTERNAL LINEAR CALLER (D-8180; Linear hierarchy design 2026-11-10 §6.3, §8): how ccrc's own
 * plan sync, drift pass and migration reach Linear. It is the proxy's order of work, less attribution and validation
 * (the caller is the server itself and its inputs are built, not parsed): take one call from the lane, read the
 * slot's key, for a write ask the policy as the ccrc actor and journal a `pending` row, call Linear, shape the answer,
 * settle the journal and the rate service (`oneCallOutcome`: one call spent, and a `rate-limited` answer, a 429 or a
 * RATELIMITED body, closes the slot for its wait).
 *
 * L4 DELIVERY, inert until wave 3: nothing calls it yet. It NEVER THROWS: a thrown fetch is `unreachable`.
 *
 * THE KEY is read from its file at the moment of the call, handed to `callLinear` and dropped; nothing here logs,
 * answers or journals it or its digest. A write that is refused before it is sent changes nothing, and a write that
 * timed out after it was sent is journaled `unknown` and answered `maybeSent: true`.
 */
import type { FetchLike, LinearCall } from './client.js';
import { callLinear, LINEAR_RATE_LIMITED_FALLBACK_S } from './client.js';
import {
  LINEAR_CCRC_OPS, type CcrcOpInput, type CcrcOpName, type CcrcOpRow,
} from './hierarchyOps.js';
import {
  ccrcActor, type LinearJournal, type LinearJournalCode, type LinearPendingInput, type LinearSettledOutcome,
} from './journal.js';
import type { LinearAnswerRefusalWord } from './ops.js';
import type { CcrcPass, LinearWriteAsk, LinearWritePolicy } from './policy.js';
import { askWithDeadline } from './policyPoint.js';
import { oneCallOutcome, type LinearRateService } from './rate.js';
import { readLinearSlotKey, type LinearSlotRef } from './store.js';

export interface CcrcCallDeps {
  ccrcDir: string;
  rate: LinearRateService;
  journal: LinearJournal;
  policy: LinearWritePolicy;
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

export interface CcrcOpAsk {
  op: CcrcOpName;
  pass: CcrcPass;
  lane: 'sync' | 'migration' | 'floor';
  slot: LinearSlotRef;
  workspaceId: string;
  teamKey: string | null;
  /** The object the write targets: a UUID for a hierarchy object, an identifier for an issue; null on a create. */
  target: string | null;
  /** The changed field names, from the op's closed list in the journal. */
  fields: readonly string[];
  input: CcrcOpInput;
}

export type CcrcOpOutcome =
  | { ok: true; value: Record<string, unknown>; created: string | null }
  | { ok: false; word: 'rate-limited'; retryAfterS: number }
  | {
    ok: false;
    word: 'policy-denied' | 'policy-unavailable' | 'journal-unavailable' | 'not-configured' | 'timeout' | 'unreachable'
    | 'linear-unauthorised' | LinearAnswerRefusalWord;
    maybeSent: boolean;
  };

type ObjectKind = 'initiative' | 'project' | 'milestone' | 'issue';
const objectKindOf = (op: CcrcOpName): ObjectKind => (op.startsWith('initiative') ? 'initiative'
  : op.startsWith('projectMilestone') ? 'milestone' : op.startsWith('project') ? 'project' : 'issue');

/** A failed call's word, and whether the change may have happened (a timeout, no answer, an answer out of grammar). */
function callWord(r: Exclude<LinearCall, { ok: true }>): { word: 'linear-unauthorised' | 'linear-forbidden' | 'timeout' | 'unreachable' | 'malformed'; outcome: 'failed' | 'unknown' } {
  switch (r.reason) {
    case 'unauthorised': return { word: 'linear-unauthorised', outcome: 'failed' };
    case 'forbidden': return { word: 'linear-forbidden', outcome: 'failed' };
    case 'timeout': return { word: 'timeout', outcome: 'unknown' };
    case 'unreachable': return { word: 'unreachable', outcome: 'unknown' };
    default: return { word: 'malformed', outcome: 'unknown' };
  }
}

export async function runCcrcOp(deps: CcrcCallDeps, ask: CcrcOpAsk): Promise<CcrcOpOutcome> {
  try {
    return await run(deps, ask);
  } catch {
    // Never a throw, never a value: the word only.
    console.warn('ccrc-server: linear ccrc call failed (internal)');
    return { ok: false, word: 'unreachable', maybeSent: false };
  }
}

async function run(deps: CcrcCallDeps, ask: CcrcOpAsk): Promise<CcrcOpOutcome> {
  const row: CcrcOpRow | undefined = LINEAR_CCRC_OPS[ask.op];
  if (row === undefined) return { ok: false, word: 'unreachable', maybeSent: false };
  const write = row.class === 'write';

  const take = deps.rate.take({ lane: ask.lane, slot: ask.slot, calls: 1 });
  if (!take.ok) return { ok: false, word: 'rate-limited', retryAfterS: take.retryAfterS };
  /** The one call this op made, as the rate service reads it (`oneCallOutcome`); null while none has gone out. */
  let sent: { ok: boolean; reason?: string; retryAfterS?: number } | null = null;
  try {
    const k = await readLinearSlotKey(deps.ccrcDir, ask.slot);
    if (k.kind !== 'key') return { ok: false, word: 'not-configured', maybeSent: false };

    let pendingId: number | null = null;
    const record: LinearPendingInput | null = write && row.journalOp !== null ? {
      op: row.journalOp, sessionId: null, sessionUuid: null, actor: ccrcActor(ask.pass), workspaceId: ask.workspaceId,
      teamKey: ask.teamKey, target: ask.target, fields: ask.fields,
    } : null;
    /** Settles the row (written now when the refusal came before it): a journal that refuses changes no answer. */
    const journalEnd = (outcome: LinearSettledOutcome, code?: LinearJournalCode, result?: string | null, decisionId?: string | null): void => {
      if (record === null) return;
      let id = pendingId;
      if (id === null) {
        const w = deps.journal.pending(record);
        if (!w.ok) return;
        id = w.id;
      }
      pendingId = null;
      const s = deps.journal.settle(id, outcome, code, result ?? null, null, decisionId ?? null);
      if (!s.ok && s.why !== 'row') deps.journal.settle(id, outcome, undefined, null, null, null);
    };

    let decisionId: string | null = null;
    if (record !== null && row.journalOp !== null) {
      const verdict = await askWithDeadline(deps.policy, {
        actor: { kind: 'ccrc', pass: ask.pass },
        verb: 'operate',
        route: `ccrc ${ask.op}`,
        resource: {
          workspaceId: ask.workspaceId, teamKey: ask.teamKey, issue: null, parentTeamKey: null, op: row.journalOp,
          object: { kind: objectKindOf(ask.op), id: ask.target },
        },
      } satisfies LinearWriteAsk);
      decisionId = verdict.decisionId;
      if (!verdict.allow) {
        journalEnd(verdict.code === 'policy-denied' ? 'denied' : 'refused', verdict.code, null, decisionId);
        return { ok: false, word: verdict.code, maybeSent: false };
      }
      const w = deps.journal.pending(record);
      if (!w.ok) return { ok: false, word: 'journal-unavailable', maybeSent: false };
      pendingId = w.id;
    }

    sent = { ok: false, reason: 'unreachable' };
    const r = await callLinear(k.key, row.document, row.variables(ask.input), { fetch: deps.fetch, timeoutMs: deps.timeoutMs, now: deps.now });
    sent = r;
    if (!r.ok) {
      if (r.reason === 'rate-limited') {
        journalEnd('failed', 'rate-limited', null, decisionId);
        return { ok: false, word: 'rate-limited', retryAfterS: r.retryAfterS };
      }
      const c = callWord(r);
      journalEnd(c.outcome, c.word, null, decisionId);
      return { ok: false, word: c.word, maybeSent: write && c.outcome === 'unknown' };
    }

    const shaped = row.shape(r.body);
    if (!shaped.ok) {
      if (shaped.word === 'rate-limited') {
        // A RATELIMITED body on a 200 carries no wait: the fallback's, as `callLinear` reads a 429 with none.
        sent = { ok: false, reason: 'rate-limited', retryAfterS: LINEAR_RATE_LIMITED_FALLBACK_S };
        journalEnd('failed', 'rate-limited', null, decisionId);
        return { ok: false, word: 'rate-limited', retryAfterS: LINEAR_RATE_LIMITED_FALLBACK_S };
      }
      const outcome = shaped.word === 'malformed' || shaped.word === 'unreachable' ? 'unknown' : 'failed';
      journalEnd(outcome, shaped.word, null, decisionId);
      return { ok: false, word: shaped.word, maybeSent: write && outcome === 'unknown' };
    }
    // A session-grammar create is journaled by the issue's identifier; every other op by the created UUID.
    const identifier = shaped.value['identifier'];
    const result = row.journalOp === 'create' ? (typeof identifier === 'string' ? identifier : null) : shaped.created;
    journalEnd('ok', undefined, result, decisionId);
    return { ok: true, value: shaped.value, created: shaped.created };
  } finally {
    deps.rate.settle(take.grant, sent === null ? { spent: 0, closeForS: null } : oneCallOutcome(sent));
  }
}
