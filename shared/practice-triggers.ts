// L0: the PWA may bundle this file; it imports only `./stall-watch.js`.
//
// The trigger table (Overlord spec §9.7, Table 11.1b; wave W1a): the facts that open a case, each one row. W1a's rows
// are the stall watch's arms, derived from `STALL_ARMS` so a new arm is a new row with no second list. W1 adds the
// refusal words and W2 the health words, each as one more kind and one more arm of `TriggerSignature`.
// The persisted form of a row is its signature text, `<kind>:<key>`, and `parseSignature` is its one reader.
import { STALL_ARMS, isStallArm } from './stall-watch.js';
import type { StallArm } from './stall-watch.js';

/** The trigger kinds (spec §9.7). W1a: the stall arms. W1 adds refusal words, W2 health words, each as one row. */
const TRIGGER_KIND_TABLE = { 'stall-arm': 'a stall watch arm decided a rung for a run worker (W1a)' } as const;
export type TriggerKind = keyof typeof TRIGGER_KIND_TABLE;
export const TRIGGER_KINDS = Object.keys(TRIGGER_KIND_TABLE) as TriggerKind[];

/** A signature: one row of the trigger table. A union by kind, so W1's refusal row is one more arm. */
export type TriggerSignature = { readonly kind: 'stall-arm'; readonly key: StallArm };

export const TRIGGER_TABLE: readonly TriggerSignature[] = STALL_ARMS.map((key) => ({ kind: 'stall-arm' as const, key }));

/** The persisted form of a signature. */
export function signatureText(s: TriggerSignature): string {
  return `${s.kind}:${s.key}`;
}

/** The one reader of a persisted signature: null for anything that is not a row of the table. */
export function parseSignature(text: string): TriggerSignature | null {
  const at = text.indexOf(':');
  if (at < 0) return null;
  const kind = text.slice(0, at);
  const key = text.slice(at + 1);
  if (!(TRIGGER_KINDS as readonly string[]).includes(kind)) return null;
  if (!isStallArm(key)) return null;
  return { kind: 'stall-arm', key };
}
