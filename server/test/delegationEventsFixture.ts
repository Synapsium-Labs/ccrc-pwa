// D-9167 (plan docs/superpowers/plans/2026-11-27-delegation-events-retention.md): the fixtures the delegation-events suites share. A
// fixture directory and a fixture `coord.db` per test, never the live `~/.ccrc`; neutral names only.
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import { delegationSha256Hex, formatDelegationInstant, type DelegationJournalRecordV1 } from '../src/coord/delegation-model.js';
import { buildDelegationJournalRecord } from '../src/coord/delegation-journal.js';
import type { DelegationProjectionPort } from '../src/coord/delegation-db-projection.js';
import { DelegationDurability, type DelegationDurabilityDeps } from '../src/coord/delegation-durability.js';
import { nodeDelegationFilePort } from '../src/coord/delegation-file-port.js';
import { mkTmp } from './tmpHelpers.js';

export const PARENT = 'lane-a-project-a';
export const INC = 'g1';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
export const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 10, 27) + s * 1000);

const base = (n: number) => ({
  v: 1 as const, observedAt: T(n), sessionId: PARENT, parentIncarnation: INC, claudeSessionId: CLAUDE,
  eventId: delegationSha256Hex(`events-fixture-${n}`), bucket: '2026112700', startOffset: n * 100, endOffset: n * 100 + 99,
});
export const sessionStart = (n: number): DelegationEventEnvelopeV1 => ({ ...base(n), eventKind: 'SessionStart', source: 'startup' });
/** A Bash call's two records: `n` is the record's own number (its eventId and time), `call` the call's (its toolUseId). */
export const bashPre = (n: number, listing?: readonly string[], call = n): DelegationEventEnvelopeV1 =>
  ({ ...base(n), eventKind: 'PreToolUse', toolName: 'Bash', toolUseId: `toolu_${call}`, ...(listing === undefined ? {} : { listing }) });
export const bashPost = (n: number, call = n): DelegationEventEnvelopeV1 =>
  ({ ...base(n), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${call}`, outcome: 'completed' });
export const agentPre = (n: number): DelegationEventEnvelopeV1 =>
  ({ ...base(n), eventKind: 'PreToolUse', toolName: 'Agent', toolUseId: `toolu_${n}`, isolation: null });

/** A chain of evidence records from sequence 1. */
export function evidenceRecords(events: readonly DelegationEventEnvelopeV1[]): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  let prev: string | null = null;
  events.forEach((event, i) => {
    const r = buildDelegationJournalRecord({ sequence: i + 1, acceptedAt: T(100000 + i), previousDigest: prev, entry: { kind: 'evidence-accepted', event } });
    out.push(r);
    prev = r.digest;
  });
  return out;
}

/** The production port's six members over the store, as `watch.ts`'s `DelegationLane` wires them. */
export function storePort(store: CoordStore): DelegationProjectionPort {
  return {
    project: (cp) => store.projectDelegationCheckpoint(cp),
    projectChanged: (prior, next) => store.projectDelegationCheckpointChanges(prior, next),
    insertEvents: (rows) => store.insertDelegationEvents(rows),
    eventStats: () => store.delegationEventStats(),
    countEventsAtOrBelow: (s) => store.countDelegationEventsAtOrBelow(s),
    deleteEventsBetween: (a, b, n) => store.deleteDelegationEventsBetween(a, b, n),
  };
}

export function freshStore(dir: string = mkTmp('ccrc-deleg-events-')): { dir: string; store: CoordStore } {
  return { dir, store: new CoordStore(openCoordDb(path.join(dir, 'coord.db'))) };
}

/** The sequences SQLite holds, ascending. */
export const heldSequences = (store: CoordStore): number[] =>
  (store.db.prepare('SELECT journalSequence AS s FROM delegation_events ORDER BY journalSequence').all() as Array<{ s: number }>).map((r) => r.s);

/** An applier over a fixture directory and store, with an injected clock; closed by the caller. */
export async function openApplier(dir: string, projection: DelegationProjectionPort | null, over: Partial<DelegationDurabilityDeps> = {}): Promise<DelegationDurability> {
  let n = 0;
  return DelegationDurability.open({
    dir, projection, port: nodeDelegationFilePort, now: () => Date.UTC(2026, 10, 27, 12), randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    warn: () => undefined, ...over,
  });
}

export const batchOf = (events: readonly DelegationEventEnvelopeV1[]) => ({ accepted: events.map((event) => ({ event })), cursor: null, interval: null });
