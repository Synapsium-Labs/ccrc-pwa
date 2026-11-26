// The database's side of the authority fields (Overlord spec §7.6, I7; authority journal plan Task 8, rulings F4 and F8; the
// sequence plan's Task 5, call 1219). Ring L3, context C5: one read, which Confirm the restore (`overlordRestoreState.ts`)
// compares with the journal's fold, and which the invariant monitor's I7 reads (`invariantFacts.ts`), so one model says what
// the database holds. The journal's side is `overlordRestore.ts#journalSideOf` (L1).
import type { DatabaseSync } from 'node:sqlite';
import { NARROWEST_RESTORE_SIDE, type RestoreSide } from './overlordRestore.js';
import { designationRead } from './overlordDesignationStore.js';
import { ladderRows } from './overlordLadderStore.js';
import { rungRank, type Rung } from '../../../shared/overlord-ladder.js';

/** The rows' side (the database's), read in the caller's transaction: an absent designation row binds nothing at term 0,
 *  `opus`, the empty set; an absent ladder row reads `off` (ruling F8); each standing latch at its cap. */
export function restoreRowsSide(db: DatabaseSync): RestoreSide | { kind: 'unmeasured'; why: string } {
  const d = designationRead(db);
  if (d.kind === 'unmeasured') return { kind: 'unmeasured', why: d.why };
  const l = ladderRows(db);
  if (l.kind === 'unmeasured') return { kind: 'unmeasured', why: l.why };
  const caps = new Map<string, Rung>();
  for (const s of l.standing) {
    const had = caps.get(s.cause);
    caps.set(s.cause, had === undefined || rungRank(s.cap) < rungRank(had) ? s.cap : had);
  }
  const row = d.row;
  return {
    binding: row?.bound ?? null,
    term: row?.term ?? 0,
    operatorRung: l.rung === null ? NARROWEST_RESTORE_SIDE.operatorRung : l.rung.operatorRung,
    latches: [...caps].map(([cause, cap]) => ({ cause, cap })).sort((a, b) => (a.cause < b.cause ? -1 : 1)),
    accountSet: row === null ? NARROWEST_RESTORE_SIDE.accountSet : { pools: [...row.accountPools.pools], untagged: row.accountPools.untagged },
    modelClass: row === null ? NARROWEST_RESTORE_SIDE.modelClass : row.model,
  };
}
