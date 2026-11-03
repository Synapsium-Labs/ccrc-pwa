// D-7571 (ARCH-05): the box-token card's words and its summary verdict, moved out of `SecuritySection.tsx` so the
// Settings section status (`sectionStatus.ts`) reads them without loading the card. Pure: sentences from a
// `BoxTokenView`, keyed by the shared types so a new word is a compile error. The card keeps its ink classes
// (`SecuritySection.tsx#SUMMARY_CLASS`), keyed by `BoxTokenTone`.
import { elapsedShort } from '@ccrc/ui';
import { isPlaceableInstant } from '../../fleet/updatesRead';
import type { BoxTokenView, TokenHold } from '../../../../shared/box-token';

/** The summary's tone: the card's calm note, its amber and its one red sentence. */
export type BoxTokenTone = 'calm' | 'amber' | 'red';

const BOX_TOKEN_HOLD_TEXT: Record<TokenHold, (node: string | null) => string> = {
  'update-in-flight': (n) => `an update is in flight on ${n ?? 'a node'}`,
  'agent-predates-op': () => 'fleet agent predates token-sync',
  'verb-missing': (n) => `release not yet on ${n ?? 'the fleet box'} (its ccrc has no token verb)`,
  'stale-client': (n) => `a stale ccrc-api on ${n ?? 'the fleet box'}`,
  'fleet-rows': () => 'not exactly one reachable fleet node',
  'node-id-unmeasured': (n) => `the node id of ${n ?? 'the fleet box'} is not measured`,
  'link-down': () => 'the agent link is down',
  'pending-cap': () => 'the handed-out values at the cap still await confirmation',
  'no-coord': () => 'no coordination database',
  'role-unrecorded': () => "this box's role is not recorded as both (CCRC_ROLE in ~/.ccrc/ccrc.env)",
  'mint-failed': () => 'the server could not mint a value',
};

/** "held: …", the card's spelling of the server's hold word (spec 4.7's own examples). */
export function boxTokenHoldText(hold: TokenHold, node: string | null): string {
  return `held: ${BOX_TOKEN_HOLD_TEXT[hold](node)}`;
}

export function boxTokenStateText(v: BoxTokenView): string {
  switch (v.phase) {
    case 'unconfigured': return 'no current value';
    case 'idle': return 'idle';
    case 'staged': return 'rotating (a new value is staged)';
    case 'handed-out': return 'rotating (handed out, awaiting the fleet box)';
    case 'promoting': return 'rotating (promoting)';
    case 'grace': return 'grace (the previous value is still accepted)';
    case 'held': return v.hold !== null ? boxTokenHoldText(v.hold, v.holdNode) : 'held';
    case 'failed': return `failed (${v.lastFailure ?? 'unknown'})`;
  }
}

/** Plain http is said as unencrypted and still rotates (R2); `unmeasured` is never folded into https. */
export function boxTokenTransportText(t: BoxTokenView['fleetTransport']): string {
  if (t === null) return 'transport: no sync yet';
  if (t === 'unmeasured') return 'transport: not measured';
  return t === 'http' ? 'transport: http (unencrypted)' : 'transport: https';
}

export const BOX_TOKEN_FLEET_TEXT: Record<BoxTokenView['fleetConfirmed'], string> = {
  current: 'confirmed the current generation',
  // `behind` says only what the server's word means: the fleet's generation read is not the current id (review 362 F3).
  // It may hold an older generation or, mid-promotion, a newer one; the card never says which.
  behind: 'not on the current generation',
  absent: 'no generation recorded on the fleet box',
  unreadable: "the fleet box's generation file could not be read",
  'own-write': 'this box writes the fleet copy itself',
  unknown: 'not yet measured',
};

const SPAN_UNIT: Readonly<Record<string, string>> = { m: 'minute', h: 'hour', d: 'day' };

/** "2 days", "5 hours", "40 minutes", "moments": `elapsedShort`'s one-unit ladder, said in words. */
export function spanWords(ms: number): string {
  const short = elapsedShort(ms);
  if (short === null) return 'moments';
  const n = Number(short.slice(0, -1));
  return `${n} ${SPAN_UNIT[short.slice(-1)] ?? short.slice(-1)}${n === 1 ? '' : 's'}`;
}

/** The card's words (spec §5.5). The interval is `TOKEN_ROTATION_INTERVAL_MS`, said in words at render, never typed:
 *  `box-token-card.test.tsx` runs against a 3-day fixture of it. The note names no interval (D-5615). */
export const BOX_TOKEN_TEXT = {
  purpose: (interval: string): string => 'The key that sessions and tools on the fleet box use to call this server, '
    + `for mail and coordination. The server makes a new one every ${interval} and hands it to the fleet box itself. `
    + 'The old key keeps working until the fleet box confirms the new one, so nothing restarts or drops.',
  handedOut: 'Rotating: waiting for the fleet box to confirm. The old key still works.',
  rotateNote: 'Starts a rotation now instead of waiting for the next scheduled one. Nothing restarts; the old key keeps '
    + 'working until the fleet box confirms.',
  rotateWhen: 'You think the key has leaked.',
} as const;

const sentenceCase = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** One sentence from the view. "Healthy" only in `idle` with the fleet confirmed (`current`, or `own-write`: this box
 *  writes the fleet copy itself) and nothing owed, stalled, failing, tampered with or leaked. Amber for `held` or `behind`, red for `failed`,
 *  each with its word, from today's state sentences. */
export function boxTokenSummary(v: BoxTokenView, now: number): { text: string; tone: BoxTokenTone } {
  if (v.phase === 'failed') return { text: sentenceCase(boxTokenStateText(v)), tone: 'red' };
  if (v.phase === 'held') return { text: sentenceCase(boxTokenStateText(v)), tone: 'amber' };
  if (v.phase === 'handed-out') return { text: BOX_TOKEN_TEXT.handedOut, tone: 'calm' };
  if (v.phase !== 'idle') return { text: sentenceCase(boxTokenStateText(v)), tone: 'calm' };
  if (v.fleetConfirmed === 'behind') return { text: `Behind: fleet ${BOX_TOKEN_FLEET_TEXT.behind}`, tone: 'amber' };
  // A tamper or leak signal is never folded under "Healthy" (D-5503: never optimistic; R1d review). The driver owes no
  // rotation for a file problem and bounds a retired presentation's owed rotation to one an hour, so an idle,
  // confirmed card can carry either; each names its fact here, in amber, as well as in Details.
  const check: string[] = [];
  if (v.fileProblem !== null) check.push(`server token file ${v.fileProblem.file} ${v.fileProblem.word} on re-read`);
  if (v.retiredPresented > 0) {
    check.push(`retired value presented ${v.retiredPresented} time${v.retiredPresented === 1 ? '' : 's'}`);
  }
  if (check.length > 0) return { text: `Check: ${check.join(' · ')}`, tone: 'amber' };
  const confirmed = v.fleetConfirmed === 'current' || v.fleetConfirmed === 'own-write';
  if (!confirmed || v.rotationOwed || v.stalled !== null || v.banner) {
    const parts = ['Idle'];
    if (v.rotationOwed) parts.push(`rotation owed: ${v.owedWhy ?? 'unspecified'}`);
    parts.push(`fleet: ${BOX_TOKEN_FLEET_TEXT[v.fleetConfirmed]}`);
    return { text: parts.join(' · '), tone: 'calm' };
  }
  const parts = ['Healthy'];
  parts.push(v.lastRotationAt !== null && isPlaceableInstant(v.lastRotationAt)
    ? `rotated ${spanWords(now - v.lastRotationAt)} ago` : 'never rotated');
  // `nextRotationAt` is optional and additive (an older server omits it), and `readBoxTokenView` passes it through
  // unread, so it is checked here: anything but a placeable instant says nothing about the next rotation.
  const next: unknown = v.nextRotationAt;
  if (typeof next === 'number' && isPlaceableInstant(next)) {
    parts.push(next > now ? `next in ${spanWords(next - now)}` : 'next due now');
  }
  // Plain http still rotates (R2), but the key travels unencrypted: said beside the verdict, not only in Details.
  if (v.fleetTransport === 'http') parts.push('transport http (unencrypted)');
  return { text: parts.join(' · '), tone: 'calm' };
}
