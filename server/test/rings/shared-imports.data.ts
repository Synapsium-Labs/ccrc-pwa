/**
 * D-6045 (Task C0l; ARCH-04 (#545), stage 1): the `shared/*.ts` edges allowed to name something other than a
 * `./` sibling, keyed `shared/<file>.ts -> <specifier>`. Empty on the day the rule landed, and the aim is that it
 * stays so: L0 imports nothing outside `shared/`, not even `node:*` (the 08-10 spec, L0), because the PWA bundles
 * these files. An entry is a debt with its reason and date, never a carve-out.
 */
import type { EntrySet } from './exemptions.js';

export const SHARED_IMPORT_EXEMPTIONS: EntrySet = {};
