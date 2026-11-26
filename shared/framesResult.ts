// The box frames recipe's RESULT (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md,
// section 5.1). L0: imports only `shared/` siblings. Split from the cases (`framesCapture.ts`) as the delivery recipe's
// result is split from its cases, so what travels (the vocabulary, the parts, the frame's shape check and the ONE reader)
// is all the capture contract pulls into any module graph: no draft text, and no generator.
//
// A third recipe on the one build capture runner (the capture owner's calls 1549 and 1558). One frame is one capture: a
// fresh start of the build, at one pane size, one case's steps, then ONE frame of the screen as the send's own read
// (`Tmux.captureAnsi`) returns it, REDUCED ON THE TEST BOX before it leaves the capture (`framesReduce.ts`). The text this
// result carries is that reduced frame and nothing else.
//
// IT NEVER TOUCHES BUILD TRUST OR THE DELIVERY RECIPE: a frames result is neither a `BuildCaptureResult` nor a
// `DeliveryCaptureResult`, and it decides nothing.
import { isReleaseTag } from './api.js';
import { isClaudeVersion } from './claudeVersion.js';
import { DELIVERY_COUNT_MAX, DELIVERY_SEND_WORD, DELIVERY_UNMEASURED, DELIVERY_UNMEASURED_MAP, type DeliveryUnmeasured } from './deliveryResult.js';

// ── the cases and the parts ──────────────────────────────────────────────────────────────────────────────────────

/** The frame cases, in the lane's order: the wave 185 worker's ranking (plan section 6), so a part list measured only in
 *  part holds the frames that matter most first. `-turns`: the same case after two earlier user turns. */
export type FramesCaseId =
  | 'empty' | 'rows-3' | 'cap' | 'cap-over' | 'rows-25' | 'rows-180'
  | 'empty-turns' | 'rows-3-turns' | 'cap-turns' | 'cap-over-turns' | 'rows-25-turns' | 'rows-180-turns'
  | 'submitted'
  | 'long-in-view' | 'long-out' | 'up-3' | 'up-3-pageup'
  | 'long-in-view-turns' | 'long-out-turns' | 'up-3-turns' | 'up-3-pageup-turns'
  | 'person' | 'person-turns'
  | 'chip' | 'stash' | 'queued';
export const FRAMES_CASE_ID_MAP: Record<FramesCaseId, true> = {
  empty: true, 'rows-3': true, cap: true, 'cap-over': true, 'rows-25': true, 'rows-180': true,
  'empty-turns': true, 'rows-3-turns': true, 'cap-turns': true, 'cap-over-turns': true, 'rows-25-turns': true, 'rows-180-turns': true,
  submitted: true,
  'long-in-view': true, 'long-out': true, 'up-3': true, 'up-3-pageup': true,
  'long-in-view-turns': true, 'long-out-turns': true, 'up-3-turns': true, 'up-3-pageup-turns': true,
  person: true, 'person-turns': true,
  chip: true, stash: true, queued: true,
};
export const FRAMES_CASE_IDS: readonly FramesCaseId[] = Object.keys(FRAMES_CASE_ID_MAP) as FramesCaseId[];
export const isFramesCaseId = (v: unknown): v is FramesCaseId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(FRAMES_CASE_ID_MAP, v);

/** A capture pane's size. */
export interface FramesPane { readonly cols: number; readonly rows: number }

/** The recipe's pane sizes, its parameters (the capture owner's condition): the fleet's pinned 220x50 first, then 220x40. */
export const FRAMES_PANES: readonly FramesPane[] = Object.freeze([Object.freeze({ cols: 220, rows: 50 }), Object.freeze({ cols: 220, rows: 40 })]);

/** One part of the recipe: one case at one pane size, one capture. */
export interface FramesPart { readonly case: FramesCaseId; readonly pane: FramesPane }

/** THE PART LIST: every case, in its order, at each pane size in turn. Its length is the part count: not a derivation and
 *  not a number kept by hand. */
export const FRAMES_PARTS: readonly FramesPart[] = Object.freeze(FRAMES_CASE_IDS.flatMap((c) => FRAMES_PANES.map((pane) => Object.freeze({ case: c, pane }))));
export const FRAMES_PART_COUNT = FRAMES_PARTS.length;

/** A part index this side's recipe has. */
export const isFramesPart = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < FRAMES_PART_COUNT;

/** A frame's id, `<case>@<cols>x<rows>`: the read's key for one frame, and a fixture's name. */
export const framesFrameId = (p: FramesPart): string => `${p.case}@${p.pane.cols}x${p.pane.rows}`;

/** The part a frame id names, or null: only an id this recipe's part list holds. */
export function framesPartOfId(id: unknown): number | null {
  if (typeof id !== 'string') return null;
  const i = FRAMES_PARTS.findIndex((p) => framesFrameId(p) === id);
  return i < 0 ? null : i;
}

// ── the frame ────────────────────────────────────────────────────────────────────────────────────────────────────

/** How one frame came out. `drawn`: read, settled, inside the cap and cleared by the reducer. `unsettled`: the same, but
 *  two reads never agreed within the frame bound, so the last read is kept. `over-cap`: the frame as read passed the cap,
 *  so it is not carried (its measured sizes are). `refused`: the reducer could not clear it, so it is not carried (its rule
 *  word is). A refusal or a cap is never a cut. */
export type FramesOutcome = 'drawn' | 'unsettled' | 'over-cap' | 'refused';
export const FRAMES_OUTCOME_MAP: Record<FramesOutcome, true> = { drawn: true, unsettled: true, 'over-cap': true, refused: true };

/** Why the reducer, or the receiver's check, refused a frame (plan section 5.2): not a frame by the shape rule; a hit of
 *  the committed private-name matcher; a private shape left after reduction; a text the product's masker would change. */
export type FramesRefusal = 'not-a-frame' | 'private-name' | 'private-shape' | 'masked';
export const FRAMES_REFUSAL_MAP: Record<FramesRefusal, true> = { 'not-a-frame': true, 'private-name': true, 'private-shape': true, masked: true };
export const isFramesRefusal = (v: unknown): v is FramesRefusal => typeof v === 'string' && Object.prototype.hasOwnProperty.call(FRAMES_REFUSAL_MAP, v);

/** A part's word: `framed` when its frame was drawn, `gaps` otherwise. A box fault gives no result at all, never a word. */
export type FramesWord = 'framed' | 'gaps';
export const FRAMES_WORD_MAP: Record<FramesWord, true> = { framed: true, gaps: true };

/** THE word over a frame's outcome. */
export const framesWord = (o: FramesOutcome): FramesWord => (o === 'drawn' ? 'framed' : 'gaps');

/** The steps whose send word a result records: the two earlier turns, the case's own send, and the held turn. */
export type FramesSendStep = 'turn-1' | 'turn-2' | 'send' | 'held';
export const FRAMES_SEND_STEP_MAP: Record<FramesSendStep, true> = { 'turn-1': true, 'turn-2': true, send: true, held: true };
export const FRAMES_SEND_STEPS: readonly FramesSendStep[] = Object.keys(FRAMES_SEND_STEP_MAP) as FramesSendStep[];

/** A frame's byte ceiling (the capture owner's condition: a cap of rows by columns and bytes, refused over it). */
export const FRAME_BYTES_MAX = 65_536;

/** An SGR sequence, the one escape a frame may hold. */
const SGR = /\x1b\[[0-9;:]*m/g;

/** The frame's measured size: its rows (lines, less one trailing empty line `capture-pane -p` ends with), its widest row in
 *  printable code points (SGR removed), and its UTF-8 bytes. */
export function frameSize(text: string): { readonly rows: number; readonly width: number; readonly bytes: number } {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const width = lines.reduce((w, l) => Math.max(w, Array.from(l.replace(SGR, '')).length), 0);
  return { rows: lines.length, width, bytes: new TextEncoder().encode(text).length };
}

/** Whether a measured frame passes the cap for `pane`. */
export const frameOverCap = (s: { readonly rows: number; readonly width: number; readonly bytes: number }, pane: FramesPane): boolean =>
  s.rows > pane.rows || s.width > pane.cols || s.bytes > FRAME_BYTES_MAX;

/** THE SHAPE RULE of a frame's text (plan 5.1; the reducer's rule 1 and the reader both ask it): inside the cap for its
 *  pane, no control character but ESC and LF, and every ESC the start of an SGR sequence. A hyperlink, a cursor move or any
 *  other escape fails it whole: it is never stripped. */
export function frameTextFits(text: string, pane: FramesPane): boolean {
  if (frameOverCap(frameSize(text), pane)) return false;
  const rest = text.replace(SGR, '');
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x09\x0b-\x1f\x7f]/.test(rest);
}

/** One frame as a result carries it. `text` is the REDUCED frame, present exactly with `drawn` or `unsettled`. */
export interface FramesFrame {
  readonly outcome: FramesOutcome;
  readonly refusal: FramesRefusal | null;
  /** The frame AS READ, before the reducer: rows, widest row and bytes, each capped at `DELIVERY_COUNT_MAX`. */
  readonly rows: number;
  readonly width: number;
  readonly bytes: number;
  /** The cursor as tmux reported it, column then row, or null when it could not be read. */
  readonly cursor: readonly [number, number] | null;
  readonly text: string | null;
}

/** One send a case made and the send's word for it. */
export interface FramesSend { readonly step: FramesSendStep; readonly send: string }

/** A frames capture's result: one part, one frame. */
export interface FramesCaptureResult {
  readonly recipe: 'frames';
  /** `framesCapture.ts#FRAMES_RECIPE_VERSION`, computed. */
  readonly version: string;
  readonly build: string;
  readonly part: number;
  readonly case: FramesCaseId;
  readonly pane: FramesPane;
  /** The release tag of the test box that ran it, or null when that box could not read it: unknown. */
  readonly release: string | null;
  readonly unmeasured: readonly DeliveryUnmeasured[];
  readonly word: FramesWord;
  /** Each send the case made, in order, each step at most once. */
  readonly sends: readonly FramesSend[];
  /** The turns and the side requests the stand-in received in the case's window (counts, capped). */
  readonly turns: number;
  readonly sideRequests: number;
  readonly frame: FramesFrame;
}

/** The recipe version's shape: 16 lowercase hex characters. */
export const FRAMES_VERSION_SHAPE = /^[0-9a-f]{16}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const keysAre = (o: Obj, keys: readonly string[]): boolean => Object.keys(o).sort().join() === [...keys].sort().join();
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= DELIVERY_COUNT_MAX;
const has = <T extends string>(map: Record<T, true>, v: unknown): v is T => typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v);

function readUnmeasured(v: unknown): DeliveryUnmeasured[] | null {
  if (!Array.isArray(v) || v.length > DELIVERY_UNMEASURED.length) return null;
  let at = -1;
  for (const n of v) {
    if (!has(DELIVERY_UNMEASURED_MAP, n)) return null;
    const i = DELIVERY_UNMEASURED.indexOf(n);
    if (i <= at) return null;
    at = i;
  }
  return v as DeliveryUnmeasured[];
}

function readSends(v: unknown): FramesSend[] | null {
  if (!Array.isArray(v) || v.length > FRAMES_SEND_STEPS.length) return null;
  const seen = new Set<string>();
  const out: FramesSend[] = [];
  for (const s of v) {
    if (!isObj(s) || !keysAre(s, ['step', 'send']) || !has(FRAMES_SEND_STEP_MAP, s['step']) || seen.has(s['step'])) return null;
    if (typeof s['send'] !== 'string' || !DELIVERY_SEND_WORD.test(s['send'])) return null;
    seen.add(s['step']);
    out.push({ step: s['step'], send: s['send'] });
  }
  return out;
}

const FRAME_KEYS = ['outcome', 'refusal', 'rows', 'width', 'bytes', 'cursor', 'text'];

/** One frame, for `pane`: its outcome and refusal agreeing, its sizes counts, its cursor inside the pane, its text present
 *  exactly with `drawn` or `unsettled` and then fitting the shape rule, and `over-cap` exactly when the measured sizes pass
 *  the cap. */
export function readFramesFrame(v: unknown, pane: FramesPane): FramesFrame | null {
  if (!isObj(v) || !keysAre(v, FRAME_KEYS)) return null;
  const { outcome, refusal, rows, width, bytes, cursor, text } = v;
  if (!has(FRAMES_OUTCOME_MAP, outcome) || !isCount(rows) || !isCount(width) || !isCount(bytes)) return null;
  if ((outcome === 'refused') !== (refusal !== null) || (refusal !== null && !isFramesRefusal(refusal))) return null;
  if ((outcome === 'over-cap') !== frameOverCap({ rows, width, bytes }, pane)) return null;
  const carried = outcome === 'drawn' || outcome === 'unsettled';
  if (carried !== (text !== null)) return null;
  if (text !== null && (typeof text !== 'string' || !frameTextFits(text, pane))) return null;
  let cur: readonly [number, number] | null = null;
  if (cursor !== null) {
    if (!Array.isArray(cursor) || cursor.length !== 2) return null;
    const [x, y] = cursor as unknown[];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= pane.cols || y >= pane.rows) return null;
    cur = [x, y];
  }
  return { outcome, refusal: refusal as FramesRefusal | null, rows, width, bytes, cursor: cur, text: text as string | null };
}

const RESULT_KEYS = ['recipe', 'version', 'build', 'part', 'case', 'pane', 'release', 'unmeasured', 'word', 'sends', 'turns', 'sideRequests', 'frame'];

/** THE ONE READER of a frames capture's result, for `build` and the `part` asked: the recipe echoed, a version of its shape,
 *  the build and part echoed, the part's own case and pane, the box's release (a tag or null), the unmeasured list, the sends,
 *  the counts, the frame (`readFramesFrame`), and the word its outcome gives. `null`: not a frames result for this build and
 *  part. Which version is THIS side's is the lane's currency question, never a malformed answer. */
export function readFramesCaptureResult(v: unknown, build: string, part: number): FramesCaptureResult | null {
  if (!isObj(v) || !keysAre(v, RESULT_KEYS) || v['recipe'] !== 'frames') return null;
  const want = FRAMES_PARTS[part];
  if (want === undefined || v['part'] !== part || v['build'] !== build || !isClaudeVersion(build)) return null;
  if (typeof v['version'] !== 'string' || !FRAMES_VERSION_SHAPE.test(v['version'])) return null;
  if (v['case'] !== want.case) return null;
  const pane = v['pane'];
  if (!isObj(pane) || !keysAre(pane, ['cols', 'rows']) || pane['cols'] !== want.pane.cols || pane['rows'] !== want.pane.rows) return null;
  const release = v['release'];
  if (release !== null && !isReleaseTag(release)) return null;
  const unmeasured = readUnmeasured(v['unmeasured']);
  const sends = readSends(v['sends']);
  if (unmeasured === null || sends === null || !isCount(v['turns']) || !isCount(v['sideRequests'])) return null;
  const frame = readFramesFrame(v['frame'], want.pane);
  if (frame === null || v['word'] !== framesWord(frame.outcome)) return null;
  return {
    recipe: 'frames', version: v['version'], build, part, case: want.case, pane: want.pane, release: release as string | null, unmeasured,
    word: framesWord(frame.outcome), sends, turns: v['turns'], sideRequests: v['sideRequests'], frame,
  };
}
