import type { Catalogue, ModelClass } from './models.js';

export const SUGGESTED_SUBAGENT_CLASS: 'sonnet';
export function suggestedClasses(catalogue: Catalogue): Record<ModelClass, string | null> | null;
export function suggestedModelMap(classes: Record<ModelClass, string | null>): Record<'opus' | 'sonnet' | 'haiku' | 'subagent', string>;
