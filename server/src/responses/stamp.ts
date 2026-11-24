// L4, context C6: the response record's stamp (Overlord spec §4.3 C67, I18; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md`, questions 5, 6 and 17). Every response row a writer
// inserts carries the stamp read here: the boot half is the epoch this process recorded in `response_boots`
// (`recordResponseBoot`, once a boot, from `index.ts`), and the restore half is the restore generation authority journal
// PR C counts. `index.ts` sets `Deps.responseStamp` to `() => responseStampNow(boot, restore.restoreGeneration())`, and the
// writers read it from the deps they are handed (slug the-stamp-rides-the-deps), so no writer imports this module.
import type { ResponseStamp, RestoreStamp } from '../../../shared/responses.js';
import type { CoordStore } from '../coord/store.js';

/** THE ONE PLACE a response row's stamp is read (index question 35, ruled). Authority journal PR C switched the restore half
 *  from the constant `unmeasured` to its accessor, `restoreGeneration()` (`coord/overlordRestoreState.ts`), here and nowhere
 *  else: a journal that cannot be read or does not agree with its head row reads `unmeasured`, never 0, so such a row never
 *  seals `not-opened`. */
export function responseStampNow(boot: ReturnType<CoordStore['recordResponseBoot']>, restore: RestoreStamp): ResponseStamp {
  return {
    boot: boot.ok ? { kind: 'measured', epoch: boot.epoch } : { kind: 'unmeasured' },
    restore: restore.kind === 'measured' ? { kind: 'measured', n: restore.n } : { kind: 'unmeasured' },
  };
}
