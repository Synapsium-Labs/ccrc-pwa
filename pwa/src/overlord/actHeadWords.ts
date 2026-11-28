// The act journal's signed head, in the console's words (Overlord W2, act journal plan Task A3; spec §7.6 H27): L1, pure, no store,
// no React, no DOM, no `lib/api.ts`. One view of what the console knows about the newest signed head (the read, the signature's
// check, and whether it extends the head this device kept) becomes the one line `ActHeadLine` draws beside the readiness line.
// Nothing unmeasured reads as a value: a failed read says so, a browser that cannot check Ed25519 says so, and a head that does not
// extend the kept one is drawn as a warning naming the kept record.
//
// The line names the head by its record number and its signed state only. It never carries a record's content or an actor (the
// head holds neither: a day, a sequence, a journal id and a digest).
import type { HeadExtends } from '../../../shared/actJournalHead';

/** What the console checked of the signature: it verified, it did not, this browser has no Ed25519, or the head is unsigned. */
export type ActHeadVerify = 'verified' | 'failed' | 'cannot-verify-here' | 'not-signed';

/** What the console knows of the newest signed head. `none`: no head has been recorded yet (no act yet), so no line. */
export type ActHeadView =
  | { readonly kind: 'none' }
  | { readonly kind: 'unmeasured' }
  | {
    readonly kind: 'read';
    readonly sequence: number;
    /** `null` when signed; otherwise the word the server recorded it unsigned with. */
    readonly unsigned: string | null;
    readonly verify: ActHeadVerify;
    readonly extendsKept: HeadExtends;
    /** The record this device kept, named when the offered head does not extend it. */
    readonly keptSequence: number | null;
  };

export type ActHeadTone = 'ok' | 'quiet' | 'attention';
export interface ActHeadLineWords { readonly text: string; readonly tone: ActHeadTone; readonly word: string }

const LEAD = 'Overlord act journal';
const recordNo = (n: number): string => n.toLocaleString('en-US');

/** The line, or `null` when there is nothing to draw (no head yet). */
export function actHeadOneLine(view: ActHeadView): ActHeadLineWords | null {
  if (view.kind === 'none') return null;
  if (view.kind === 'unmeasured') return { text: `${LEAD}: its signed head could not be read`, tone: 'attention', word: 'unmeasured' };
  const at = `record ${recordNo(view.sequence)}`;
  if (view.extendsKept === 'does-not-extend') {
    const kept = view.keptSequence === null ? 'the record this device kept' : `record ${recordNo(view.keptSequence)}, which this device kept`;
    return { text: `${LEAD}: ${at} does not extend ${kept}: the journal went back or was rewritten`, tone: 'attention', word: 'does-not-extend' };
  }
  if (view.extendsKept === 'unmeasured') {
    return { text: `${LEAD}: ${at}; whether it extends the head this device kept could not be read`, tone: 'attention', word: 'extends-unmeasured' };
  }
  if (view.unsigned !== null) return { text: `${LEAD}: ${at}, unsigned (${view.unsigned})`, tone: 'quiet', word: 'unsigned' };
  if (view.verify === 'failed') return { text: `${LEAD}: ${at}, but its signature does not verify`, tone: 'attention', word: 'signature-failed' };
  if (view.verify === 'cannot-verify-here') {
    return { text: `${LEAD}: ${at}, signed (this browser cannot check the signature)`, tone: 'quiet', word: 'cannot-verify-here' };
  }
  return { text: `${LEAD}: ${at}, signed`, tone: 'ok', word: 'signed' };
}
