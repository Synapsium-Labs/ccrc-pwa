// D-6267, D-6268: LEGACY checkpoint stock, as the fold wrote it before rule A. Before D-6267 a Bash PreToolUse or PostToolUse that carried
// a worktree `listing` was a qualifying join, so every listed Bash call opened an activity at its first listing-carrying record (D-4649:
// a PreToolUse without one was skipped, so its PostToolUse was then the identity record) and every later record of the call touched it,
// a PostToolUse ending it. Rule A opens far fewer, so a row that needs the stock a live box carries cannot get it from the fold at the
// tip; it gets it here, from ONE helper, never by hand and never from the new fold alone.
//
// `oldRuleCheckpoint(journal)` folds the EVIDENCE records with the fold at hand, then sets every Bash call's row and natural-key mapping
// to the old rule's (identity, opening, last event, end), and finally recomputes the holds through `recoverDelegation` over the same
// journal, so no hold the new fold computed (a pending Bash call the old build never held) is carried over. At the base, where the fold
// IS the old rule, it returns what that fold returns, which RE0 (`delegation-recovery.test.ts`) pins by digest.
//
// Only evidence goes in: a `lease-created` record naming an old-rule row would reach `foldLease` before the row exists. A row that needs
// such a lease writes it through the journal writer AFTER the helper's applied position, and the fixture's recovery replays it.
// No IO, no clock, no randomness: the output is a function of the records alone.
import type { DelegationActivityNaturalKey, DelegationEventEnvelopeV1 } from '../../shared/api.js';
import { encodeDelegationCheckpoint, recoverDelegation } from '../src/coord/delegation-checkpoint.js';
import {
  deriveDelegationActivityId,
  encodeDelegationNaturalKey,
  sortedProjectionRows,
  type DelegationActivityRow,
  type DelegationCheckpointV1,
  type DelegationJournalRecordV1,
} from '../src/coord/delegation-model.js';

const maxInstant = (a: string, b: string): string => (a >= b ? a : b);
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The old rule's row for every Bash `tool_use_id` it opened, by encoded natural key, from the evidence alone. */
export function oldRuleBashRows(journal: readonly DelegationJournalRecordV1[]): Map<string, DelegationActivityRow> {
  const rows = new Map<string, DelegationActivityRow>();
  for (const record of journal) {
    if (record.entry.kind !== 'evidence-accepted') throw new Error('oldRuleCheckpoint takes evidence records only: write a lease after its applied position');
    const e: DelegationEventEnvelopeV1 = record.entry.event;
    if ((e.eventKind !== 'PreToolUse' && e.eventKind !== 'PostToolUse') || e.toolName !== 'Bash') continue;
    if (typeof e.toolUseId !== 'string' || e.toolUseId === '') continue;
    const key: DelegationActivityNaturalKey = { parentId: e.sessionId, parentIncarnation: e.parentIncarnation, sourceKind: 'bash-worktree', upstreamId: e.toolUseId };
    const encoded = encodeDelegationNaturalKey(key);
    const ends = e.eventKind === 'PostToolUse';
    const prior = rows.get(encoded);
    if (prior === undefined) {
      if (!Array.isArray(e.listing)) continue;               // the old rule: a Bash record without a listing was no join and opened nothing
      const activityId = deriveDelegationActivityId(key, record.journalId);
      rows.set(encoded, {
        activityId, parentId: key.parentId, parentIncarnation: key.parentIncarnation, sourceKind: 'bash-worktree', upstreamId: key.upstreamId,
        identityJournalId: record.journalId, displayName: null, executionState: ends ? 'ended' : 'active',
        openedAt: e.observedAt, endedAt: ends ? e.observedAt : null, lastEventAt: e.observedAt,
      });
      continue;
    }
    const ending = ends && prior.executionState !== 'ended';     // the old fold's `touchActivity` on a mapped key
    rows.set(encoded, {
      ...prior,
      lastEventAt: maxInstant(prior.lastEventAt, e.observedAt),
      executionState: ending ? 'ended' : prior.executionState,
      endedAt: ending ? maxInstant(e.observedAt, prior.openedAt) : prior.endedAt,
    });
  }
  return rows;
}

/** A checkpoint covering `journal` exactly as the pre-D-6267 fold would have written it, holds recomputed by the fold at hand. */
export function oldRuleCheckpoint(journal: readonly DelegationJournalRecordV1[]): DelegationCheckpointV1 {
  const folded = recoverDelegation(null, journal);
  if (folded.failure !== null) throw new Error(`oldRuleCheckpoint: the fold refused the journal: ${folded.failure.code}: ${folded.failure.detail}`);
  const cp = structuredClone(folded.state.checkpoint) as DelegationCheckpointV1;
  const old = oldRuleBashRows(journal);
  const mapping: Record<string, string> = {};
  const replaced = new Set<string>();
  for (const [encoded, id] of Object.entries(cp.activityIdsByNaturalKey)) {
    if (old.has(encoded)) { replaced.add(id); continue; }     // a Bash call both rules opened takes the OLD rule's row (its identity may differ)
    mapping[encoded] = id;
  }
  const activities = cp.activities.filter((a) => !replaced.has(a.activityId) && a.sourceKind !== 'bash-worktree');
  const keptBash = cp.activities.filter((a) => !replaced.has(a.activityId) && a.sourceKind === 'bash-worktree');
  if (keptBash.length > 0) throw new Error(`oldRuleCheckpoint: the fold opened ${keptBash.length} Bash call(s) the old rule did not`);
  for (const [encoded, row] of old) { mapping[encoded] = row.activityId; activities.push(row); }
  const liveIds = new Set(activities.map((a) => a.activityId));
  for (const l of cp.leases) if (!liveIds.has(l.activityId)) throw new Error(`oldRuleCheckpoint: lease ${l.leaseId} names an activity the old rule re-derived`);
  const rows = sortedProjectionRows({ sessions: cp.sessions, attempts: cp.attempts, activities, leases: cp.leases, lineage: cp.lineage });
  const injected: DelegationCheckpointV1 = {
    ...cp,
    activityIdsByNaturalKey: Object.fromEntries(Object.entries(mapping).sort(([a], [b]) => byCodeUnits(a, b))),
    sessions: rows.sessions, attempts: rows.attempts, activities: rows.activities, leases: rows.leases, lineage: rows.lineage,
  };
  const recovered = recoverDelegation(encodeDelegationCheckpoint(injected), journal);
  if (recovered.failure !== null) throw new Error(`oldRuleCheckpoint: recovery refused the legacy stock: ${recovered.failure.code}: ${recovered.failure.detail}`);
  return recovered.state.checkpoint;
}
