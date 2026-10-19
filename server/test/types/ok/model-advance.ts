// The tsc probe for `shared/model-advance.d.mts` (the `legit-modelenv-composition.ts` idiom): a `.d.mts` enters a
// compiler program only when something in it imports the `.mjs`, so this file is what puts the declarations in
// front of tsc. `modelenv-types.test.ts`'s first case compiles `test/types/tsconfig.ok.json`, whose include is
// `ok/**/*.ts`, so this file is checked there with no new project. It MUST compile clean, and it carries no cast.
import {
  BLOCKED_CAUSES, REASON_MAX, canaryEffort, chooseCandidate, compareVersions, eligibleIds, familyOf, parseModelId,
  resolveEffort,
} from '../../../../shared/model-advance.mjs';
import type { BlockedCause, Choice, ParsedModelId } from '../../../../shared/model-advance.mjs';
import type { Catalogue, ModelClass, Registry } from '../../../../shared/models.js';

declare const reg: Registry;
declare const cat: Catalogue | null;
declare const cls: ModelClass;

export const parsed: ParsedModelId | null = parseModelId('model-6.1-alpha');
export const fam: string | null = familyOf(null);
export const order: -1 | 0 | 1 = compareVersions([6, 1], [6]);
export const ids: string[] = eligibleIds(reg, cat);
export const choice: Choice = chooseCandidate({ registry: reg, catalogue: cat, cls, family: fam });
export const effort: string | undefined = resolveEffort({ stored: 'max', oldEfforts: null, newEfforts: ['low'] });
export const lowest: string | null = canaryEffort([]);
export const firstCause: BlockedCause = BLOCKED_CAUSES[0];
export const reasonCap: 200 = REASON_MAX;
