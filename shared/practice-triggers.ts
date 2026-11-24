// L0: the PWA may bundle this file; it imports `./stall-watch.js`, `./refusal.js` and `./programmeFacts.js`.
//
// The trigger table (Overlord spec §9.7, Table 11.1b; waves W1a and W1): the facts that open a case, each one row. W1a's
// rows are the stall watch's arms, derived from `STALL_ARMS` so a new arm is a new row with no second list. W1's rows are
// the Overlord's refusal words, derived from `OVERLORD_REFUSAL_WORDS` the same way, so a later wave's word joins the
// triggers by joining that group (the plan's question 8). W2's rows are the programme health words, derived from
// `PROGRAMME_HEALTH_WORDS` (forecasts B): one more kind and one more arm of `TriggerSignature`. No W1 code records a refusal as a case observation: the refusal kind has rows and no writer until
// W4b's `practiceFor`.
// The persisted form of a row is its signature text, `<kind>:<key>`, and `parseSignature` is its one reader.
import { STALL_ARMS, isStallArm } from './stall-watch.js';
import type { StallArm } from './stall-watch.js';
import { OVERLORD_REFUSAL_WORDS, isOverlordRefusal } from './refusal.js';
import type { OverlordRefusal } from './refusal.js';
import { PROGRAMME_HEALTH_WORDS, isProgrammeHealthWord } from './programmeFacts.js';
import type { ProgrammeHealthWord } from './programmeFacts.js';

/** The trigger kinds (spec §9.7). W1a: the stall arms. W1: the Overlord's refusal words. W2: the health words. */
const TRIGGER_KIND_TABLE = {
  'stall-arm': 'a stall watch arm decided a rung for a run worker (W1a)',
  refusal: "a route refusal word of the Overlord's group answered a call (W1; served from W4b)",
  health: "the forecast lane recorded a programme's health word (W2; a programme_health row is the occurrence)",
} as const;
export type TriggerKind = keyof typeof TRIGGER_KIND_TABLE;
export const TRIGGER_KINDS = Object.keys(TRIGGER_KIND_TABLE) as TriggerKind[];

/** A signature: one row of the trigger table. A union by kind, so each wave's kind is one more arm. */
export type TriggerSignature =
  | { readonly kind: 'stall-arm'; readonly key: StallArm }
  | { readonly kind: 'refusal'; readonly key: OverlordRefusal }
  | { readonly kind: 'health'; readonly key: ProgrammeHealthWord };

/** Stall arms first, so W1a's rows keep their order, then one row per Overlord refusal word, then one per health word,
 *  worst first. */
export const TRIGGER_TABLE: readonly TriggerSignature[] = [
  ...STALL_ARMS.map((key) => ({ kind: 'stall-arm' as const, key })),
  ...OVERLORD_REFUSAL_WORDS.map((key) => ({ kind: 'refusal' as const, key })),
  ...PROGRAMME_HEALTH_WORDS.map((key) => ({ kind: 'health' as const, key })),
];

/** The persisted form of a signature. */
export function signatureText(s: TriggerSignature): string {
  return `${s.kind}:${s.key}`;
}

/** The one reader of a persisted signature: null for anything that is not a row of the table, a key under the wrong
 *  kind included (a stall arm under `refusal`, a refusal word under `stall-arm`). Each kind's key goes through its own
 *  guard, the `includes` or own-property form, so an inherited name such as `constructor` is never a key. An older build
 *  has no `refusal` or `health` kind and reads such a signature as null, so a newer build's row is skipped, never misread. */
export function parseSignature(text: string): TriggerSignature | null {
  const at = text.indexOf(':');
  if (at < 0) return null;
  const kind = text.slice(0, at);
  const key = text.slice(at + 1);
  if (!(TRIGGER_KINDS as readonly string[]).includes(kind)) return null;
  if (kind === 'stall-arm') return isStallArm(key) ? { kind: 'stall-arm', key } : null;
  if (kind === 'refusal') return isOverlordRefusal(key) ? { kind: 'refusal', key } : null;
  if (kind === 'health') return isProgrammeHealthWord(key) ? { kind: 'health', key } : null;
  return null;
}
