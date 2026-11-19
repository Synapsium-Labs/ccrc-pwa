/**
 * WHAT ONE SESSION'S MAILHOLD MARKER SHOULD BE (mid-turn mail, spec `docs/superpowers/specs/2026-11-19-mid-turn-mail-design.md`
 * §3.4; plan `docs/superpowers/plans/2026-11-19-mid-turn-mail.md` Task 4.2). L1, pure: no I/O, no store and no clock (the
 * caller hands it `now`, from the wall clock); context C5 by the `coord/**` row. The projection pass
 * (`coord/mailHoldLane.ts`) reads the facts and writes what this answers, through `ccd route`.
 *
 * The marker is a lease (`shared/mailHold.ts`, the grammar's one owner): the pass writes `now + MAILHOLD_LEASE_S` and the
 * held pairs, and renews a marker whose pairs already match once it has fewer than `MAILHOLD_RENEW_UNDER_S` left, or once
 * it is no longer live (lapsed, or reaching past `now + MAILHOLD_REACH_S`). So it writes only on appear, differ, renew and
 * clear, and a settled hold costs one write every few minutes. A marker the writer would not have spelled (another pair,
 * another role, an unsorted or malformed value, a forged one) differs, and is rewritten or cleared: the pass compares the
 * marker's pairs as written with the pairs it would write, never a parse of them alone.
 *
 * Fail open (spec §3.4, D3): `mail-disabled` holds nothing, so a standing marker is cleared and nothing is written. A
 * marker the registry could not read is skipped (never written or cleared blind), and so is a fleet whose ccd cannot take
 * the field (`route-mailhold-v1`), whose answer is never "no hold": a skipped session keeps whatever it has until its
 * lease lapses at the hook. A held pair the grammar cannot spell is skipped too, never thrown.
 */
import {
  MAILHOLD_LEASE_S, MAILHOLD_RENEW_UNDER_S, mailHoldLive, parseMailHold, renderMailHold, type MailHoldPair,
} from '../../../shared/mailHold.js';

/** One session's facts, read by the pass. */
export interface MailHoldFacts {
  /** The session's urgent deliveries on the hold's set (`CoordStore.urgentHolds`), each with its sender's role; empty when none. */
  readonly held: readonly MailHoldPair[];
  /** The marker as the registry read it, byte for byte; null when the session has none. */
  readonly measured: string | null;
  /** The registry named the marker unreadable (`route.unreadable`). */
  readonly unreadable: boolean;
  /** The wall clock, epoch seconds. */
  readonly now: number;
  /** The fleet's ccd advertises `route-mailhold-v1` and carries the `route` verb. */
  readonly capable: boolean;
  /** `$REG/mail-disabled` stands. */
  readonly mailDisabled: boolean;
}

/** What the pass does for one session: write a value (and why), clear the marker (and why), nothing, or skip (and why). */
export type MailHoldDecision =
  | { readonly act: 'write'; readonly value: string; readonly why: 'appear' | 'differ' | 'renew' }
  | { readonly act: 'clear'; readonly why: 'released' | 'mail-disabled' }
  | { readonly act: 'none' }
  | { readonly act: 'skip'; readonly why: 'incapable' | 'unreadable' | 'unrenderable' };

const NONE: MailHoldDecision = { act: 'none' };

/** Decide one session's marker. */
export function decideMailHold(m: MailHoldFacts): MailHoldDecision {
  if (!m.capable) return { act: 'skip', why: 'incapable' };
  if (m.unreadable) return { act: 'skip', why: 'unreadable' };
  if (m.mailDisabled) return m.measured === null ? NONE : { act: 'clear', why: 'mail-disabled' };
  if (m.held.length === 0) return m.measured === null ? NONE : { act: 'clear', why: 'released' };
  let want: string;
  try {
    want = renderMailHold(m.now + MAILHOLD_LEASE_S, m.held);
  } catch { return { act: 'skip', why: 'unrenderable' }; }
  const write = (why: 'appear' | 'differ' | 'renew'): MailHoldDecision => ({ act: 'write', value: want, why });
  if (m.measured === null) return write('appear');
  const parsed = parseMailHold(m.measured);
  if (!parsed.ok) return write('differ');
  if (m.measured.slice(m.measured.indexOf(':') + 1) !== want.slice(want.indexOf(':') + 1)) return write('differ');
  if (!mailHoldLive(parsed.hold.until, m.now)) return write('renew');
  const left = parsed.hold.until - m.now;
  if (left < MAILHOLD_RENEW_UNDER_S) return write('renew');
  return NONE;
}
