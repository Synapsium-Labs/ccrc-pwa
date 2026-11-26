// The box frames recipe's capture lane, DECIDED (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md
// section 6). L0: imports only `shared/` siblings, and nothing in `pwa/src` imports it (it reads the case file's version).
// `server/src/buildCaptureLane.ts` acts on these answers and decides nothing of its own:
// - `nextFramesJob`: which (build, part) to send next, after every trust job and every delivery job, never ahead of one;
// - `framesTextToDrop`: which builds' frame texts the store sets aside for good (the newest four framed builds keep theirs);
// - `framesListOf`: the one read's list answer for a build, cut from the rows, with no text.
//
// IT NEVER TOUCHES BUILD TRUST OR THE DELIVERY RECIPE. A frames row lives in its own table (`claude_build_frames`).
import { compareClaudeVersions, isClaudeVersion } from './claudeVersion.js';
import { BUILD_CAPTURE_RETRY_MS, type ClaudeBuildRecord } from './claudeBuildTrust.js';
import { newestTrustedBuild } from './deliveryLane.js';
import type { DeliveryNotSent } from './deliveryResult.js';
import { FRAMES_RECIPE_VERSION } from './framesCapture.js';
import { FRAMES_PARTS, framesFrameId, type FramesCaptureResult, type FramesRefusal, type FramesWord } from './framesResult.js';

/** One (build, part) row of `claude_build_frames`, as the store reads it. `record` is the stored result with its frame text
 *  kept apart (null on a row that only holds attempts, or one the reader no longer accepts); `text` is that frame's text,
 *  null once the build's text was set aside, or for a frame never carried. `checked` is the receiver's word at store time. */
export interface FramesRow {
  readonly build: string;
  readonly part: number;
  readonly version: string | null;
  readonly word: FramesWord | null;
  readonly record: FramesCaptureResult | null;
  readonly text: string | null;
  readonly checked: 'clear' | FramesRefusal | null;
  readonly at: number | null;
  /** How many frames jobs went out for this part. A try that sent nothing is not counted. */
  readonly attempts: number;
  readonly lastAttemptAt: number | null;
  readonly notSent: DeliveryNotSent | null;
}

/** A row holds a CURRENT result: this recipe's version, a word, a record and a time. */
export const isCurrentFrames = (r: FramesRow): boolean => r.version === FRAMES_RECIPE_VERSION && r.word !== null && r.record !== null && r.at !== null;

/** The frames job to send next, or null: only the NEWEST build whose trust capture passed (the delivery lane's same
 *  decider, so the two never name different builds), and its first part, in list order, with no current row. When that
 *  part's last try is within {@link BUILD_CAPTURE_RETRY_MS}, null: the lane waits and never skips ahead. Asked only on a
 *  pass that sent neither a trust job nor a delivery job (the lane's rule). */
export function nextFramesJob(records: readonly ClaudeBuildRecord[], rows: readonly FramesRow[], at: number): { readonly build: string; readonly part: number } | null {
  const build = newestTrustedBuild(records);
  if (build === null) return null;
  const mine = rows.filter((r) => r.build === build);
  for (let part = 0; part < FRAMES_PARTS.length; part++) {
    const row = mine.find((r) => r.part === part);
    if (row !== undefined && isCurrentFrames(row)) continue;
    if (row !== undefined && row.lastAttemptAt !== null && at - row.lastAttemptAt < BUILD_CAPTURE_RETRY_MS) return null;
    return { build, part };
  }
  return null;
}

/** How many framed builds keep their frame texts (the capture owner's condition 4). */
export const FRAMES_KEEP_BUILDS = 4;

/** The builds whose frame texts the store sets aside now: every build that still holds a text, past the newest
 *  {@link FRAMES_KEEP_BUILDS} builds that hold one or are being framed now (`incoming`, the build of the record being
 *  stored). Newest first by version. */
export function framesTextToDrop(rows: readonly FramesRow[], incoming: string): string[] {
  const withText = new Set(rows.filter((r) => r.text !== null && isClaudeVersion(r.build)).map((r) => r.build));
  const kept = [...new Set([...withText, ...(isClaudeVersion(incoming) ? [incoming] : [])])].sort((a, b) => compareClaudeVersions(b, a)).slice(0, FRAMES_KEEP_BUILDS);
  return [...withText].filter((b) => !kept.includes(b)).sort((a, b) => compareClaudeVersions(b, a));
}

/** One frame as the list answer carries it: no text, only whether one is held. */
export interface FramesListRow {
  readonly part: number;
  readonly frame: string;
  readonly case: FramesCaptureResult['case'];
  readonly pane: FramesCaptureResult['pane'];
  readonly version: string;
  readonly release: string | null;
  readonly at: number;
  readonly word: FramesWord;
  readonly outcome: FramesCaptureResult['frame']['outcome'];
  readonly refusal: FramesRefusal | null;
  readonly rows: number;
  readonly width: number;
  readonly bytes: number;
  readonly cursor: readonly [number, number] | null;
  readonly replaced: FramesCaptureResult['frame']['replaced'];
  readonly sends: FramesCaptureResult['sends'];
  readonly turns: number;
  readonly sideRequests: number;
  readonly hasText: boolean;
}

/** The list answer: a row for each part with a stored record (any version: the row says which), and each part with no
 *  current row beside its last not-sent word and attempts. A frame the receiver refused at store time lists its refusal. */
export function framesListOf(rows: readonly FramesRow[], build: string): { readonly frames: FramesListRow[]; readonly unmeasured: { readonly part: number; readonly notSent: DeliveryNotSent | null; readonly attempts: number }[] } {
  const frames: FramesListRow[] = [];
  const unmeasured: { part: number; notSent: DeliveryNotSent | null; attempts: number }[] = [];
  for (let part = 0; part < FRAMES_PARTS.length; part++) {
    const r = rows.find((x) => x.build === build && x.part === part);
    if (r !== undefined && r.record !== null && r.version !== null && r.word !== null && r.at !== null) {
      const f = r.record.frame;
      const refusedAtStore = r.checked !== null && r.checked !== 'clear';
      frames.push({
        part, frame: framesFrameId(FRAMES_PARTS[part]!), case: r.record.case, pane: r.record.pane, version: r.version, release: r.record.release, at: r.at,
        word: r.word, outcome: refusedAtStore ? 'refused' : f.outcome, refusal: refusedAtStore ? (r.checked as FramesRefusal) : f.refusal,
        rows: f.rows, width: f.width, bytes: f.bytes, cursor: f.cursor, replaced: f.replaced, sends: r.record.sends, turns: r.record.turns,
        sideRequests: r.record.sideRequests, hasText: r.text !== null && !refusedAtStore,
      });
    }
    if (r === undefined || !isCurrentFrames(r)) unmeasured.push({ part, notSent: r?.notSent ?? null, attempts: r?.attempts ?? 0 });
  }
  return { frames, unmeasured };
}
