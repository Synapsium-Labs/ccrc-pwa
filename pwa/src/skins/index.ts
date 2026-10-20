// The one map from a skin id to its parts (D-5469). Imported by `app.tsx`, the one shared branch on the skin, and by
// nothing else outside `pwa/src/skins/` (`skin-identity.test.ts` case (o)). Keyed by the catalogue's own ids, so a
// skin added to `SKINS` without a set here is a compile error.
import { INSTRUMENT, REFINED, type SkinId } from '@ccrc/ui';
import { INSTRUMENT_SET } from './instrument/parts';
import { REFINED_SET } from './refined/parts';
import type { SkinSet } from './types';

export const SKIN_SETS: Readonly<Record<SkinId, SkinSet>> = {
  [REFINED]: REFINED_SET,
  [INSTRUMENT]: INSTRUMENT_SET,
};

export type { SkinSet } from './types';
