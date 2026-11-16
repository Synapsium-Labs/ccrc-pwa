// shared/model-suggest.mjs — which of OpenRouter's Anthropic models a new lane starts on (accounts plan Task A26;
// spec §8.5; D-5556, D-8023). Pure: a catalogue in, four classes out, no I/O.
//
// OpenRouter's catalogue names no "suggested" model, so the suggestion is this rule: for each class, the newest
// `anthropic/claude-<class>-<version>` the catalogue lists visible. `:batch` and every other variant break the
// grammar, so they are never suggested. Equal versions keep the catalogue's order. `fable` stays null when the catalogue
// lists none; a lane needs every other class to route, so a catalogue missing one suggests nothing.
//
// Two callers read this: `ccrc account add` for the roster's map before anything is written, and `ccrc models <id> init
// openrouter --suggested` for the class registry after the roster entry stands. They read the same catalogue file, so
// the two answers are one answer.
import { CLASSES, MODEL_ID_RE } from './models.mjs';
import { compareVersions } from './model-advance.mjs';

/** The class subagents run as on a suggested lane: the OpenRouter seed's own (`deploy/models-op.mjs`'s `SEEDS`). */
export const SUGGESTED_SUBAGENT_CLASS = 'sonnet';

/** The classes a suggestion needs: every class but the one an OpenRouter lane may go without. */
const NEEDED = CLASSES.filter((c) => c !== 'fable');
const SUGGESTABLE_RE = new RegExp(`^anthropic/claude-(${CLASSES.join('|')})-([0-9]{1,6}(?:\\.[0-9]{1,6}){0,3})$`);

/** `(catalogue) => {<class>: id or null} | null`, one key per class. Null when a class in `NEEDED` has no id to suggest. */
export function suggestedClasses(catalogue) {
  const best = Object.fromEntries(CLASSES.map((c) => [c, null]));
  for (const m of catalogue.models) {
    const hit = m.hidden ? null : SUGGESTABLE_RE.exec(m.id);
    if (hit === null || !MODEL_ID_RE.test(m.id)) continue;
    const version = hit[2].split('.').map(Number);
    const seen = best[hit[1]];
    if (seen === null || compareVersions(version, seen.version) > 0) best[hit[1]] = { id: m.id, version };
  }
  if (NEEDED.some((c) => best[c] === null)) return null;
  return Object.fromEntries(CLASSES.map((c) => [c, best[c]?.id ?? null]));
}

/** `(classes) => the roster's four routing aliases`, the `NEEDED` classes and `subagent`, from `suggestedClasses`' answer. */
export function suggestedModelMap(classes) {
  return { ...Object.fromEntries(NEEDED.map((c) => [c, classes[c]])), subagent: classes[SUGGESTED_SUBAGENT_CLASS] };
}
