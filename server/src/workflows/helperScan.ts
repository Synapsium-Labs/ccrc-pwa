// L3 adapter (C3 Session Conversation): every read below calls the FleetIO port, through the shared back-reader. Its imports
// alone (a type import of the port) would read L1, so this header says L3. Spec 2026-11-19-session-helpers-design §3.1 "The
// start scan" and §5; session helpers H1c, D-8873. Table 12 puts the scan in `read.ts`; it is a file of its own instead
// (`scan-in-its-own-file`), so the helper read and the scan change for their own reasons, and `read.ts` calls it once.
//
// THE START SCAN. A stream that starts mid-session, on a reload or a reconnect, has read only the backlog's window (the last
// 1 MiB) or nothing before the client's offset. So, once per reader (one per stream and session dir), the transcript is
// scanned BACKWARDS from the stream's seam for helper facts only: launch results and task notifications, through the one
// parser the tailer uses (`transcript/parse.ts#helperFactsOf`). It stops at whichever comes first:
//  - time: a segment whose oldest line is older than `scanCutoff` (the earliest start of a listed Agent helper, and ten
//    minutes before now, whichever is earlier), so it covers every listed helper and every one the keep could still show.
//    The cutoff only falls: each later usable roster lowers it to the minimum of old and new, and a scan that stopped on
//    time reads on, from where it stopped, when its last read's oldest line is no longer older than it (review 3067 F7,
//    session helpers HF1, D-8876). Lowered, not waited for: a session whose roster is never usable still gets its scan,
//    at once, and one that lists a helper later costs only the reads that helper needs;
//  - bytes: `HELPER_SCAN_BYTES` (8 MiB), as `HELPER_SCAN_CHUNKS` reads of `READ_FROM_MAX_BYTES` (256 KiB, review 2900 F10);
//  - the file's start, or a read that fails or rejects (the scan ends; what it found stands). A scan that stopped on a
//    failed read starts again on the stream's next NEW seam (another backlog), once per seam (review 3067 F6, HF1).
//
// THE SEAM, so no byte is read twice (review 2900 F4). The stream's forward reading starts at one offset, and the scan ends
// there: on a backlog stream, the backlog window's first byte (`BacklogRead.scanEnd`); on a resumed stream, the client's
// offset. The backlog drops the partial line its window starts in, and hands it over (`BacklogRead.cut`); the scan's newest
// segment ends in that line's head, and joins the two, so the line the seam cuts is parsed once, by the scan. A character
// the seam splits reads as U+FFFD in that one line's text. A resumed stream whose offset falls inside a line (the client
// counts the bytes its tailer held as a partial line) loses that one line, for the scan as for the chat.
//
// LEGITIMATELY DIFFERENT from the tailer (`transcript/tail.ts`), the other reader of the session transcript (the
// consolidation rule; review 2900 F4). The tailer reads FORWARD from the seam, the backlog's window then each appended
// chunk, for the chat and its helper facts, for the stream's life. The scan reads BACKWARD from the same seam, once, for
// helper facts only, bounded by time and bytes. They read disjoint bytes, and they share the parser and the back-reader
// (`backread.ts#walkBack`, which `commands.ts` and `read.ts`' done agents walk with too). Neither can be the other: the
// tailer's offset only moves forward.
//
// OUTSIDE THE FEED'S POLLING GATE (review 2900 F10). `step` never awaits a read: it grants the scan up to
// `HELPER_SCAN_CHUNKS_PER_READING` reads and returns the facts found since the last step. The reads run on their own,
// one at a time, so a reading never waits for them and the feed's next reading is never held back, for this socket or
// for the other sockets on the session. A scan nobody steps any more (its stream stopped, its reader was rebuilt) stops
// after its last grant.
import type { FleetIO } from '../io.js';
import { walkBack, wholeLines, type BackSegment, type BackStep } from '../backread.js';
import { READ_FROM_MAX_BYTES } from '../../../shared/agent-protocol.js';
import { HELPER_FINISHED_KEEP_MS, isHelperId } from '../../../shared/workflows.js';
import { helperFactsOf, type HelperFact } from '../transcript/parse.js';
import { isWorkflowAgentName, type RosterInput } from './model.js';

/** The most the scan reads, backwards from its seam. */
export const HELPER_SCAN_BYTES = 8 * 1024 * 1024;
/** Its reads: one range read of `READ_FROM_MAX_BYTES` each, the agent link's own cap. */
export const HELPER_SCAN_CHUNKS = HELPER_SCAN_BYTES / READ_FROM_MAX_BYTES;
/** The reads one reading grants it: 1 MiB per reading, the spec's pace (§5), so the scan ends within 8 readings. */
export const HELPER_SCAN_CHUNKS_PER_READING = 4;
const SCAN_SIZES: readonly number[] = Array<number>(HELPER_SCAN_CHUNKS).fill(READ_FROM_MAX_BYTES);

/** Where the stream's own reading of the transcript began: the scan ends there. `cut`: the partial line the backlog's
 *  window started in, which the backlog dropped (absent on a resumed stream). */
export interface HelperScanSeam { readonly file: string; readonly end: number; readonly cut?: string }
/** One seam is another by value: a backlog that hands over the same window again is the same seam. */
const sameSeam = (a: HelperScanSeam, b: HelperScanSeam): boolean => a.file === b.file && a.end === b.end && a.cut === b.cut;

/** Why the scan stopped, measured. */
export type HelperScanStop = 'time' | 'bytes' | 'start' | 'unreadable';

/** The time the scan reads back to: the earliest start of a listed Agent helper (a roster entry with a helper id that is not
 *  a workflow's agent), and ten minutes before now (`HELPER_FINISHED_KEEP_MS`), whichever is earlier. */
export function scanCutoff(roster: RosterInput, now: number): number {
  let at = now - HELPER_FINISHED_KEEP_MS;
  if (roster.kind !== 'usable') return at;
  for (const e of roster.entries) {
    if (isHelperId(e.id) && !isWorkflowAgentName(e.name) && e.startedAt !== null && e.startedAt < at) at = e.startedAt;
  }
  return at;
}

/** The oldest top-level `timestamp` among `lines` (oldest first): the first line that has one. Null: none. */
function oldestTime(lines: readonly string[]): number | null {
  for (const t of lines) {
    if (!t.includes('"timestamp"')) continue;
    let o: unknown;
    try { o = JSON.parse(t); } catch { continue; }
    const ts = (o as { timestamp?: unknown } | null)?.timestamp;
    const ms = typeof ts === 'string' ? Date.parse(ts) : NaN;
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/**
 * One reader's start scan (above). `step` is called by every reading, in `SessionWorkflows.readAll` (`read.ts`, its one
 * call site): the first one that names a seam for this reader's transcript starts it.
 */
export class HelperStartScan {
  private walk: ReturnType<typeof walkBack> | null = null;
  /** The seam the walk started from (the last one, after a restart). */
  private seam: HelperScanSeam | undefined;
  private cutoff = 0;
  /** The oldest time in the read that stopped the scan on time: a cutoff lowered to it or below reads on (F7). */
  private stoppedOn: number | null = null;
  private cut: string | undefined;
  private end = 0;
  private newest = true;
  private quota = 0;
  private pumping = false;
  private inflight = false;
  /** The running pump's end, so a caller can wait for the reads a reading granted; never awaited by `step`. */
  private pumpDone: Promise<void> = Promise.resolve();
  private found: HelperFact[] = [];
  /** Measured: the bytes and range reads it spent, and why it stopped (null while it runs or before it starts). */
  readonly cost: { bytes: number; reads: number; stop: HelperScanStop | null } = { bytes: 0, reads: 0, stop: null };

  /** `transcript`: the file whose session dir this reader reads (`read.ts#sessionDirOf`'s inverse). */
  constructor(private readonly io: FleetIO, private readonly transcript: string) {}

  /** Start the scan on the first seam for this transcript (or again on a new one after a failed read), lower its cutoff
   *  by a usable roster, grant it this reading's reads, and hand over the facts it found since the last step. Never awaits
   *  a read. */
  step(i: { scan?: HelperScanSeam; roster: RosterInput; now: number }): HelperFact[] {
    const seam = i.scan !== undefined && i.scan.file === this.transcript ? i.scan : undefined;
    if (seam !== undefined && (this.seam === undefined || (this.cost.stop === 'unreadable' && !sameSeam(seam, this.seam)))) {
      this.begin(seam, scanCutoff(i.roster, i.now));
    } else if (this.walk !== null && i.roster.kind === 'usable') {
      this.lower(scanCutoff(i.roster, i.now));
    }
    if (this.walk !== null && this.cost.stop === null) {
      this.quota = HELPER_SCAN_CHUNKS_PER_READING - Number(this.inflight); // a read still in flight counts against this grant
      if (!this.pumping) this.pumpDone = this.pump(); // a pump already running takes the new grant
    }
    const out = this.found;
    this.found = [];
    return out;
  }

  /** Whether the scan has stopped. */
  get done(): boolean { return this.cost.stop !== null; }

  /** A walk from `seam` down: the first, or a restart after a failed read (F6), whose bytes and reads add to the cost. */
  private begin(seam: HelperScanSeam, cutoff: number): void {
    this.seam = seam;
    this.walk = walkBack(this.io, seam.file, seam.end, SCAN_SIZES);
    this.end = seam.end;
    this.cut = seam.cut;
    this.newest = true;
    this.cutoff = cutoff;
    this.stoppedOn = null;
    this.cost.stop = null;
  }

  /** The cutoff only falls (F7). A time stop stands while the read that made it is still older than the cutoff. */
  private lower(cutoff: number): void {
    if (cutoff >= this.cutoff) return;
    this.cutoff = cutoff;
    if (this.cost.stop === 'time' && this.stoppedOn !== null && this.stoppedOn >= cutoff) {
      this.cost.stop = null;
      this.stoppedOn = null;
    }
  }

  /** The reads this reading granted, one at a time. */
  private async pump(): Promise<void> {
    this.pumping = true;
    try {
      this.stopAtEnd();
      while (this.quota > 0 && this.cost.stop === null) {
        this.quota--;
        let r: BackStep;
        this.inflight = true;
        try { r = await this.walk!.next(); } catch { r = { ok: false, reason: 'unreadable' }; } // never a rejection nobody awaits
        this.inflight = false;
        this.cost.reads++;
        if (!r.ok) { this.cost.stop = 'unreadable'; break; }
        this.cost.bytes += this.end - r.segment.start;
        this.end = r.segment.start;
        const lines = this.linesOf(r.segment);
        for (const l of lines) this.found.push(...helperFactsOf(l));
        const oldest = oldestTime(lines);
        if (oldest !== null && oldest < this.cutoff) { this.cost.stop = 'time'; this.stoppedOn = oldest; }
        this.stopAtEnd();
      }
    } finally {
      this.pumping = false;
    }
  }

  /** No read is left: the file's start was reached, or `HELPER_SCAN_BYTES` were read. */
  private stopAtEnd(): void {
    if (this.cost.stop === null && !this.walk!.more()) this.cost.stop = this.end === 0 ? 'start' : 'bytes';
  }

  /** A segment's whole lines, decoded, oldest first. The newest segment's last piece is the head of the line the seam cut:
   *  joined to the backlog's `cut` when there is one (a seam on a line boundary leaves no head, and `cut` is that line). A
   *  segment with no newline is carried whole into the next one (`walkBack`), so the head is looked for there. */
  private linesOf(seg: BackSegment): string[] {
    if (this.newest && seg.start > 0 && seg.cut === seg.bytes.length) return [];
    const dec = new TextDecoder();
    const lines = wholeLines(seg).map((b) => dec.decode(b));
    if (this.newest) {
      this.newest = false;
      const head = seg.bytes.length > 0 && seg.bytes[seg.bytes.length - 1] !== 10 ? lines.pop() ?? '' : '';
      if (this.cut !== undefined) lines.push(head + this.cut);
    }
    return lines;
  }
}
