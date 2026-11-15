// The landing authority journal's file adapter, ring L3, context C4 (landing order wave 5f, shared contract §2): the ONE
// adapter that reads and appends `landing.log` inside an explicit, already existing directory (`cfg.ccrcDir`; no HOME
// default, no directory creation). It implements the port its consumer declares (`landingJournalPort.ts`, L2) and
// decides nothing: the text it reads goes to L1's `parseLandingJournal`, and what a distinction means is the caller's.
//
// Since Overlord W1 (authority journal A0) it is a BINDING over the byte-level append-only port (`../appendOnlyFile.ts`,
// K), which holds the file mechanics this file used to: the retained parent, `O_NOFOLLOW`, the snapshot and its re-proof,
// the short-write loop, the fsync order. What stays here is the landing journal's own encoding:
//
// - `read` decodes the bytes as UTF-8, FATALLY: invalid UTF-8 is `unreadable`, never replaced. A byte-order mark is kept
//   in the text, never stripped. An existing empty file is `present` with empty text (the parser calls it `empty`).
// - `append` writes exactly one `JSON.stringify(record)` plus LF. It never truncates, unlinks or retries, and it never
//   calls the port's cut: the landing journal's authority recovery (never in a snapshot, never restored over) is untouched.
// - The snapshot is the port's own, passed through: unusable after `release` or an `append`, and refused when foreign.
// - No answer carries a path or an error message; only the closed words of the landing port, which are the port's.
import { appendOnlyFileAt, NODE_APPEND_ONLY_FS, type AppendOnlyIoOps } from '../appendOnlyFile.js';
import type { LandingJournalRecord } from '../../../shared/landingLine.js';
import type { LandingJournalPort } from './landingJournalPort.js';

/** The journal's basename, spelled once. */
export const LANDING_JOURNAL_BASENAME = 'landing.log';

/** The low-level operations the port reads and appends with, under the name the landing journal's tests use. The port's
 *  three cut operations are not among them: this binding never cuts, and fills them from `node:fs`. */
export type LandingJournalFsOps = AppendOnlyIoOps;

// `ops` is a TEST SEAM (fault injection and observation of the open flags): production passes only `ccrcDir`.
export function createLandingJournal(ccrcDir: string, ops: LandingJournalFsOps = NODE_APPEND_ONLY_FS): LandingJournalPort {
  const file = appendOnlyFileAt(ccrcDir, LANDING_JOURNAL_BASENAME, { ...NODE_APPEND_ONLY_FS, ...ops });
  return {
    read() {
      const r = file.read();
      if (!r.ok || r.kind === 'absent') return r;
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(r.bytes);
      } catch {
        r.snapshot.release();
        return { ok: false, error: 'unreadable' };
      }
      return { ok: true, kind: 'present', text, snapshot: r.snapshot };
    },
    confirmDurable: (snapshot) => file.confirmDurable(snapshot),
    append: (snapshot, record: LandingJournalRecord) =>
      file.appendLine(snapshot, Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')),
  };
}
