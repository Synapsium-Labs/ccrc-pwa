// L3 adapter, context C3 (Session Conversation): the coordinator advisor's FORWARD reader (plan
// `2026-11-23-coordinator-advisor.md` PR C, D-8971). From a kept byte offset of the transcript the resolver names, it reads
// at most `READ_FROM_MAX_BYTES` and answers the WHOLE lines in that range and the offset past the last of them.
//
// A FILE IT HAS NO PLACE IN STARTS AT ITS TAIL (review F1): the first read of a coordinator, a new path (an account swap
// copies the transcript into the new account's directory) and a file that shrank below the kept offset (a rewrite) start
// `ADVISOR_TAIL_BYTES` before the end, at the first whole line. Read from 0, a coordinator's transcript of tens of MB
// would take hours at one range a minute, and the cap would act that late. Nothing is lost: a call the old path held is
// already recorded under its own id, and a coordinator first read has had no advisor before the lane asked for one.
//
// WHY ITS OWN READER (D-8971). It shares `parse.ts`'s line parser (`advisorFactsOf`) and the resolver with the chat
// tailer, but not the tailer: a tailer lives only while a viewer's stream is open, and a daily cap must count a coordinator
// nobody is watching. The usage sweep reads every 4 hours, per account; a cap needs minutes.
//
// It keeps every distinction it receives: absent and unreadable come back as they came.
import { READ_FROM_MAX_BYTES, type ReadFailure } from '../../../shared/agent-protocol.js';
import type { FleetIO } from '../io.js';

export type AdvisorForwardRead =
  | { readonly ok: true; readonly lines: readonly string[]; readonly next: number; readonly restarted: boolean;
      /** A range that held no newline at all (one line longer than the read): skipped, and counted by the caller. */
      readonly skippedLong: boolean }
  | { readonly ok: false; readonly reason: ReadFailure };

const NL = 0x0a;

/** How far before the end a file the reader has no place in is first read: four ranges, so it catches up in four passes. */
export const ADVISOR_TAIL_BYTES = 4 * READ_FROM_MAX_BYTES;

/** `offset`: the kept place in this file, or `tail` when the reader has none (its first read, or a new path). */
export async function readAdvisorForward(io: Pick<FleetIO, 'statMeasured' | 'readFileFromBytesMeasured'>, file: string,
  offset: number | 'tail'): Promise<AdvisorForwardRead> {
  const st = await io.statMeasured(file);
  if (!st.ok) return { ok: false, reason: st.reason };
  const restarted = offset !== 'tail' && st.size < offset;
  const from = offset === 'tail' || restarted ? Math.max(0, st.size - ADVISOR_TAIL_BYTES) : offset;
  // A tail start inside the file lands mid-line: the bytes up to its first newline are a line's end, never read as one.
  const aligning = from > 0 && (offset === 'tail' || restarted);
  if (st.size === from) return { ok: true, lines: [], next: from, restarted, skippedLong: false };
  const r = await io.readFileFromBytesMeasured(file, from, READ_FROM_MAX_BYTES);
  if (!r.ok) return { ok: false, reason: r.reason };
  const first = aligning ? r.bytes.indexOf(NL) + 1 : 0;
  const last = r.bytes.lastIndexOf(NL);
  const full = r.bytes.length >= READ_FROM_MAX_BYTES;
  if (last < 0) {
    // A partial last line: wait for its newline, unless the range was full, when one line outgrew the read. A tail start
    // with no newline at all sits inside one line, so it moves past what it read.
    return { ok: true, lines: [], next: full || aligning ? from + r.bytes.length : from, restarted, skippedLong: full };
  }
  if (last + 1 <= first) return { ok: true, lines: [], next: from + first, restarted, skippedLong: false };
  const text = Buffer.from(r.bytes.subarray(first, last)).toString('utf8');
  return { ok: true, lines: text.split('\n'), next: from + last + 1, restarted, skippedLong: false };
}
