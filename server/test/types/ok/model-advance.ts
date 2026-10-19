// The tsc probe for `shared/model-advance.d.mts` (the `legit-modelenv-composition.ts` idiom): a `.d.mts` enters a
// compiler program only when something in it imports the `.mjs`, so this file is what puts the declarations in
// front of tsc. `modelenv-types.test.ts`'s first case compiles `test/types/tsconfig.ok.json`, whose include is
// `ok/**/*.ts`, so this file is checked there with no new project. It MUST compile clean, and it carries no cast.
import {
  ADVANCE_VERSION, AdvanceInvalid, BLOCKED_CAUSES, CANARY_RESULTS, HISTORY_CAP, HOLD_BY, HOWS, REASON_MAX,
  backfillAdvance, canaryEffort, chooseCandidate, compareVersions, eligibleIds, familyOf, heldBackOf, lastMoveOf,
  parseAdvance, parseModelId, reconcilePending, recordFailure, recordMove, resolveEffort, serializeAdvance,
} from '../../../../shared/model-advance.mjs';
import type {
  Advance, BlockedCause, Choice, HistoryEntry, ParsedModelId, Pending,
} from '../../../../shared/model-advance.mjs';
import type { Catalogue, ModelClass, Registry } from '../../../../shared/models.js';

declare const reg: Registry;
declare const cat: Catalogue | null;
declare const cls: ModelClass;
declare const adv: Advance;
declare const entry: HistoryEntry;

export const parsed: ParsedModelId | null = parseModelId('model-6.1-alpha');
export const fam: string | null = familyOf(null);
export const order: -1 | 0 | 1 = compareVersions([6, 1], [6]);
export const ids: string[] = eligibleIds(reg, cat);
export const choice: Choice = chooseCandidate({ registry: reg, catalogue: cat, cls, family: fam });
export const effort: string | undefined = resolveEffort({ stored: 'max', oldEfforts: null, newEfforts: ['low'] });
export const lowest: string | null = canaryEffort([]);
export const firstCause: BlockedCause = BLOCKED_CAUSES[0];
export const reasonCap: 200 = REASON_MAX;

export const read: Advance = parseAdvance(JSON.parse('{}'));
export const text: string = serializeAdvance(adv);
export const seeded: Advance = backfillAdvance({ registry: reg, seedFamilies: null });
export const moved: Advance = recordMove(adv, cls, entry);
export const failed: { advance: Advance; isNew: boolean } = recordFailure(adv, cls,
  { at: '2026-10-15T00:00:00Z', from: null, to: 'model-6.1-alpha', reason: 'http 500' });
export const healed: { advance: Advance; recovered: boolean } = reconcilePending(adv, reg);
export const back: HistoryEntry | null = heldBackOf(adv.classes[cls], 'model-6.1-alpha');
export const last: HistoryEntry | null = lastMoveOf(adv.classes[cls]);
export const version: 1 = ADVANCE_VERSION;
export const words: number = HISTORY_CAP + HOWS.length + CANARY_RESULTS.length + HOLD_BY.length;
export const invalid: AdvanceInvalid = new AdvanceInvalid('v', 'x');
export const handIntent: Pending = { how: 'hand', class: cls, from: null, to: null, emptied: [], at: '2026-10-15T00:00:00Z' };
export const advanceIntent: Pending = { class: cls, from: null, to: 'model-6.1-alpha', effortFrom: null, effortTo: null,
  at: '2026-10-15T00:00:00Z' };
