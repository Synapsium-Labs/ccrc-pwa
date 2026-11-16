// L0: imports nothing (the PWA bundles this file). The words of a dispatch's landing intents (landing order wave 5g,
// D-8080 to D-8086). A coordinator that dispatches a wave says which pull requests or deviations its run will land;
// `CoordStore.dispatchRun` is the one writer of those keys and `CoordStore.heldLandingIntents` the one reader.

/** One intent key: a pull request (`#123`) or a deviation (`D-8080`), a positive integer of at most nine digits and no
 *  leading zero. */
export const LANDING_INTENT_KEY_RE = /^(?:#[1-9][0-9]{0,8}|D-[1-9][0-9]{0,8})$/;

/** The most keys one dispatch may carry. */
export const LANDING_INTENTS_MAX = 8;

/** One held key: the run holding it and that run's programme. */
export interface LandingIntentHold { key: string; runId: number; program: string }

/** The one parser of a dispatch body's `intents`. `undefined` and `[]` both read as no intents. Every refusal's
 *  `detail` begins `intents: ` and names the rule that failed. */
export function parseLandingIntents(raw: unknown): { ok: true; keys: readonly string[] } | { ok: false; detail: string } {
  if (raw === undefined) return { ok: true, keys: [] };
  if (!Array.isArray(raw)) return { ok: false, detail: 'intents: not an array' };
  if (raw.length > LANDING_INTENTS_MAX) return { ok: false, detail: `intents: more than ${LANDING_INTENTS_MAX} keys` };
  const seen = new Set<string>();
  for (const k of raw as unknown[]) {
    if (typeof k !== 'string') return { ok: false, detail: 'intents: a key is not a string' };
    if (!LANDING_INTENT_KEY_RE.test(k)) return { ok: false, detail: `intents: not a key (${LANDING_INTENT_KEY_RE.source}): ${JSON.stringify(k)}` };
    if (seen.has(k)) return { ok: false, detail: `intents: repeated key ${k}` };
    seen.add(k);
  }
  return { ok: true, keys: [...seen] };
}
