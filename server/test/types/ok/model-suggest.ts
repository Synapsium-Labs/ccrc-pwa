// The tsc probe for `shared/model-suggest.d.mts`, `model-advance.ts`'s idiom: a `.d.mts` enters a compiler program only
// when something in it imports the `.mjs`. It MUST compile clean, and it carries no cast.
import { SUGGESTED_SUBAGENT_CLASS, suggestedClasses, suggestedModelMap } from '../../../../shared/model-suggest.mjs';
import type { Catalogue, ModelClass } from '../../../../shared/models.js';

declare const cat: Catalogue;
const classes: Record<ModelClass, string | null> | null = suggestedClasses(cat);
const subagent: ModelClass = SUGGESTED_SUBAGENT_CLASS;
if (classes !== null) {
  const opus: string = suggestedModelMap(classes).opus;
  void opus;
}
void subagent;
