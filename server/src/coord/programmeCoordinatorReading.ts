// L3 adapter, context Coordination: one registry reading of a programme's bound session, for `coordinatorLineOf` (programme
// lifecycle spec 2026-11-24 §3; W2). It keeps every distinction the registry read gives it: a row it could not list or
// assemble is `unreadable` (doubt, never absence), a proven absence is `absent`, and a found row carries its uuid (null when
// that field could not be measured), whether it is archived, and `carrying` false: the registry lane's carry reading
// (mid-swap, mid-roll) is not reached from here yet, so a swap that keeps the session id and uuid reads `led`, as it should.
import type { CcrcConfig } from '../config.js';
import type { FleetIO } from '../io.js';
import { readSessionRecord } from '../registry.js';
import type { CoordinatorRegistryReading } from '../../../shared/programmeLifecycle.js';

export async function coordinatorReadingOf(io: FleetIO, cfg: CcrcConfig, session: string): Promise<CoordinatorRegistryReading> {
  const r = await readSessionRecord(io, cfg, session);
  switch (r.kind) {
    case 'found':
      return { kind: 'present', uuid: r.record.unmeasured.includes('uuid') || r.record.uuid === '' ? null : r.record.uuid,
        archived: r.record.archivedAt !== null, carrying: false };
    // An id the registry refuses names no row it could hand out: no session of that name is present.
    case 'absent': case 'bad-id': return { kind: 'absent' };
    case 'unlistable': case 'unmeasurable': return { kind: 'unreadable' };
  }
}

/** The readings of several sessions, one read each, keyed by session. */
export async function coordinatorReadingsOf(
  io: FleetIO, cfg: CcrcConfig, sessions: Iterable<string>,
): Promise<Map<string, CoordinatorRegistryReading>> {
  const ids = [...new Set(sessions)];
  const readings = await Promise.all(ids.map((s) => coordinatorReadingOf(io, cfg, s)));
  return new Map(ids.map((s, i) => [s, readings[i]!]));
}
