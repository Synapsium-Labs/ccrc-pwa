// L4, context C6: the response record's stamp (Overlord spec §4.3 C67, I18; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md`, questions 5, 6 and 17). Every response row a writer
// inserts carries the stamp read here: the boot half is the epoch this process recorded in `response_boots`
// (`recordResponseBoot`, once a boot, from `index.ts`), and the restore half is the restore generation authority journal
// PR C counts. `index.ts` sets `Deps.responseStamp` to `() => responseStampNow(boot)`, and the writers read it from the
// deps they are handed (slug the-stamp-rides-the-deps), so no writer imports this module.
import type { ResponseStamp } from '../../../shared/responses.js';
import type { CoordStore } from '../coord/store.js';

/** THE ONE PLACE a response row's stamp is read (index question 35, ruled). Authority journal PR C replaces the restore
 *  line with its accessor, `restoreGeneration()`, mapped to a `RestoreStamp`, in its Task 9 and nowhere else. Until then
 *  the restore half is `unmeasured`, so no push seals `not-opened`: nothing can yet prove no restore fell in its window. */
export function responseStampNow(boot: ReturnType<CoordStore['recordResponseBoot']>): ResponseStamp {
  return {
    boot: boot.ok ? { kind: 'measured', epoch: boot.epoch } : { kind: 'unmeasured' },
    restore: { kind: 'unmeasured' },   // authority journal C: restoreStampOf(restoreGeneration())
  };
}
