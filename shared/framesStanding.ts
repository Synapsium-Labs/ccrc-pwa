// The box frames recipe's STANDING: the new-form alarm (Desktop polish wave 198; plan
// docs/superpowers/plans/2026-11-28-box-frames-alarm.md section 3, after section 7 of
// docs/superpowers/plans/2026-11-26-box-frames-recipe.md). Pure, in `deliveryLane.ts`'s pattern: it imports only `shared/`
// siblings and decides; `server/src/buildCaptureLane.ts` acts on `framesShapeToStore`, the store reads the rows
// `framesStandingBuilds` names, and the status read (`GET /api/testbox`) serves `framesStandingAnswerOf`'s answer as its
// `frames`, read back by `readFramesStandingAnswer`, the one reader.
//
// WHAT LEAVES THE SERVER: fixed words, build names and frame ids. Never a shape token, a hash, a count or a frame's text.
import { compareClaudeVersions, isClaudeVersion } from './claudeVersion.js';
import type { ClaudeBuildRecord } from './claudeBuildTrust.js';
import { newestTrustedBuild } from './deliveryLane.js';
import { FRAMES_RECIPE_COMPLETE, framesOurs } from './framesCapture.js';
import { isCurrentFrames } from './framesLane.js';
import {
  FRAMES_PARTS, FRAMES_PART_COUNT, framesFrameId, framesPartOfId, type FramesCaptureResult, type FramesRefusal, type FramesWord,
} from './framesResult.js';
import { FRAME_SHAPE_HEX, FRAME_SHAPE_VERSION, frameShape } from './framesShape.js';

// ── what is stored, and whether to store it ─────────────────────────────────────────────────────────────────────

/** A frame's stored shape: the shape version it was computed at and its hash. Never the tokens (the capture owner's
 *  change A, call 1963): they hold a rule label's and a chip's words, which would outlive the build's set-aside text. */
export interface FramesStoredShape { readonly version: string; readonly hash: string }

/** Whether a stored shape is whole: two 16 hex words. */
export const isFramesStoredShape = (v: unknown): v is FramesStoredShape =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).sort().join() === 'hash,version'
  && typeof (v as FramesStoredShape).version === 'string' && FRAME_SHAPE_HEX.test((v as FramesStoredShape).version)
  && typeof (v as FramesStoredShape).hash === 'string' && FRAME_SHAPE_HEX.test((v as FramesStoredShape).hash);

/** THE ONE DECISION of whether a stored frame is shaped (plan 3.5): exactly a `drawn` frame with its text whose receiver
 *  check was `clear`, at this side's shape version; null for an unsettled, over-cap or refused frame, or one the server's
 *  check refused. The lane passes the answer to the store, and decides nothing of its own. */
export function framesShapeToStore(result: FramesCaptureResult, checked: 'clear' | FramesRefusal): FramesStoredShape | null {
  if (checked !== 'clear' || result.frame.outcome !== 'drawn' || result.frame.text === null) return null;
  const p = FRAMES_PARTS[result.part];
  if (p === undefined) return null;
  return { version: FRAME_SHAPE_VERSION, hash: frameShape(result.frame.text, result.frame.cursor, framesOurs(p.case, p.pane)).hash };
}

// ── the rows the standing reads, and which builds they are ──────────────────────────────────────────────────────

/** One (build, part) row as the text-free store read gives it (`claudeBuildFramesStore.ts#claudeBuildFrameShapes`): a row
 *  type of its own, with no `text` key at all, so "this read carries no text" is never spelled `text: null`, which on
 *  `FramesRow` means the text was set aside. `shape` is null when none was stored, or the stored one is not this row's. */
export interface FramesShapeRow {
  readonly build: string;
  readonly part: number;
  readonly version: string | null;
  readonly word: FramesWord | null;
  readonly record: FramesCaptureResult | null;
  readonly checked: 'clear' | FramesRefusal | null;
  readonly at: number | null;
  readonly shape: FramesStoredShape | null;
}

/** How many trusted builds older than the newest the standing reads (the capture owner's change B, call 1963): the status
 *  read runs every 30 seconds per open card on the synchronous store, and the table grows by 52 rows a build for good. */
export const FRAMES_STANDING_OLDER = 4;

/** The builds the store read is bounded to: the newest trusted build, then up to {@link FRAMES_STANDING_OLDER} trusted
 *  builds older than it, newest first. Each is `deliveryLane.ts#newestTrustedBuild` asked again of the records older than
 *  the one before, so "trusted" is decided in one place. Only a trusted build is ever framed. */
export function framesStandingBuilds(records: readonly ClaudeBuildRecord[]): string[] {
  const out: string[] = [];
  let left = records;
  for (let i = 0; i <= FRAMES_STANDING_OLDER; i++) {
    const b = newestTrustedBuild(left);
    if (b === null) break;
    out.push(b);
    left = left.filter((r) => isClaudeVersion(r.build) && compareClaudeVersions(r.build, b) < 0);
  }
  return out;
}

// ── the standing ────────────────────────────────────────────────────────────────────────────────────────────────

/** The form word (plan 3.2). `first-form`: no earlier complete build within the read's bound, `against` null.
 *  `not-compared` (the coordinator's ruling 4): an earlier complete build exists, `against` names it, but no frame compares
 *  (another shape version, or every frame of one side refused or uncomparable). Two conditions a reader acts on
 *  differently never share a word. */
export type FramesFormWord = 'same-form' | 'new-form' | 'first-form' | 'not-compared' | 'incomplete';
export const FRAMES_FORM_WORD_MAP: Record<FramesFormWord, true> = {
  'same-form': true, 'new-form': true, 'first-form': true, 'not-compared': true, incomplete: true,
};

/** The refusals word (plan 3.3), the coordinator's addition: the newest build's frames refused or over the cap. */
export type FramesRefusalsWord = 'none' | 'refused' | 'over-cap' | 'refused-and-over-cap';
export const FRAMES_REFUSALS_WORD_MAP: Record<FramesRefusalsWord, true> = { none: true, refused: true, 'over-cap': true, 'refused-and-over-cap': true };

/** The refusals word over its two lists. */
export const framesRefusalsWord = (refused: number, overCap: number): FramesRefusalsWord =>
  refused > 0 ? (overCap > 0 ? 'refused-and-over-cap' : 'refused') : overCap > 0 ? 'over-cap' : 'none';

/** The newest trusted build's frames standing. Every value a fixed word, a build name or a frame id. */
export interface FramesStanding {
  readonly build: string;
  /** The newest build older than `build` whose 52 parts are all current, among the bounded builds, or null. */
  readonly against: string | null;
  readonly word: FramesFormWord;
  /** The frame ids drawn, cleared and shaped at this shape version in both builds whose shapes differ, in part order. */
  readonly differing: readonly string[];
  readonly refusals: FramesRefusalsWord;
  /** The newest build's current frames refused, by the box's reducer or by the server's check, in part order. */
  readonly refused: readonly string[];
  /** The newest build's current frames over the cap, in part order. */
  readonly overCap: readonly string[];
}

/** The status read's `frames`, four answers kept apart, as `delivery`'s are; a null would also be how "no trusted build"
 *  reads, so each is a kind word of its own. `held` (wave 198, packet 4): the recipe's hold is down
 *  (`framesCapture.ts#FRAMES_RECIPE_COMPLETE` false), so the lane frames nothing; it is answered before the store is read,
 *  so a held recipe costs no read and never answers `unreadable` (the capture owner's condition 1, call 1966). */
export type FramesStandingAnswer =
  | { readonly kind: 'standing'; readonly standing: FramesStanding }
  | { readonly kind: 'no-trusted-build' }
  | { readonly kind: 'held' }
  | { readonly kind: 'unreadable' };

/** What a reader can learn: one of the three, or `unknown`, a server older than the key or one with no store. */
export type FramesStandingRead = FramesStandingAnswer | { readonly kind: 'unknown' };

const isCurrent = (r: FramesShapeRow): boolean => isCurrentFrames(r);

/** The hash of a part's frame, when it is comparable: current, drawn, cleared at store time, shaped at this shape version. */
const comparable = (r: FramesShapeRow | undefined): string | null =>
  r !== undefined && isCurrent(r) && r.record!.frame.outcome === 'drawn' && r.checked === 'clear' && r.shape !== null && r.shape.version === FRAME_SHAPE_VERSION
    ? r.shape.hash : null;

/** THE STANDING (plan 3.2 and 3.3), from the trust records and the rows. Rows of builds outside `framesStandingBuilds` are
 *  not read, so the answer over a whole table equals the answer over the bounded rows. A read that throws is the route's
 *  `unreadable`, never decided here. */
export function framesStandingAnswerOf(records: readonly ClaudeBuildRecord[], rows: readonly FramesShapeRow[]): FramesStandingAnswer {
  const builds = framesStandingBuilds(records);
  const build = builds[0];
  if (build === undefined) return { kind: 'no-trusted-build' };
  const byBuild = new Map<string, Map<number, FramesShapeRow>>(builds.map((b) => [b, new Map()]));
  for (const r of rows) {
    const parts = byBuild.get(r.build);
    if (parts !== undefined && Number.isInteger(r.part) && r.part >= 0 && r.part < FRAMES_PART_COUNT && !parts.has(r.part)) parts.set(r.part, r);
  }
  const complete = (b: string): boolean => FRAMES_PARTS.every((_, p) => { const r = byBuild.get(b)!.get(p); return r !== undefined && isCurrent(r); });
  const newest = byBuild.get(build)!;
  const against = builds.slice(1).find(complete) ?? null;
  const differing: string[] = [];
  const refused: string[] = [];
  const overCap: string[] = [];
  let compared = 0;
  FRAMES_PARTS.forEach((part, p) => {
    const id = framesFrameId(part);
    const r = newest.get(p);
    if (r !== undefined && isCurrent(r)) {
      if (r.record!.frame.outcome === 'over-cap') overCap.push(id);
      else if (r.record!.frame.outcome === 'refused' || r.checked !== 'clear') refused.push(id);
    }
    if (against === null) return;
    const [hn, ha] = [comparable(r), comparable(byBuild.get(against)!.get(p))];
    if (hn === null || ha === null) return;
    compared++;
    if (hn !== ha) differing.push(id);
  });
  const word: FramesFormWord = differing.length > 0 ? 'new-form' : !complete(build) ? 'incomplete'
    : against === null ? 'first-form' : compared === 0 ? 'not-compared' : 'same-form';
  return { kind: 'standing', standing: { build, against, word, differing, refusals: framesRefusalsWord(refused.length, overCap.length), refused, overCap } };
}

/** THE STATUS READ'S ANSWER, from the store's two reads given as calls: `held` when the recipe's hold is down, before either
 *  read is made; otherwise {@link framesStandingAnswerOf} over the trust records and the rows of the builds
 *  {@link framesStandingBuilds} names. A read that throws propagates: the route answers `unreadable` and logs it. */
export function framesStandingReadOf(
  read: { readonly records: () => readonly ClaudeBuildRecord[]; readonly rows: (builds: readonly string[]) => readonly FramesShapeRow[] },
  complete: boolean = FRAMES_RECIPE_COMPLETE,
): FramesStandingAnswer {
  if (!complete) return { kind: 'held' };
  const records = read.records();
  return framesStandingAnswerOf(records, read.rows(framesStandingBuilds(records)));
}

// ── the one reader ──────────────────────────────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const keysAre = (o: Obj, keys: readonly string[]): boolean => Object.keys(o).sort().join() === [...keys].sort().join();
const has = <T extends string>(map: Record<T, true>, v: unknown): v is T => typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v);

/** A list of this recipe's frame ids, each once, in part order. */
function readIds(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > FRAMES_PART_COUNT) return null;
  let after = -1;
  for (const id of v) {
    const p = framesPartOfId(id);
    if (p === null || p <= after) return null;
    after = p;
  }
  return v as string[];
}

const STANDING_KEYS = ['build', 'against', 'word', 'differing', 'refusals', 'refused', 'overCap'];

/** A standing: exactly its keys; the build and `against` builds, `against` older; the words from their maps; the three id
 *  lists; the form word agreeing with `differing` and `against` (plan 3.2 read backwards: `new-form` exactly when a frame
 *  differs, and with a build; `same-form` and `not-compared` with a build; `first-form` with none; `incomplete` with
 *  either); the refusals word agreeing with its lists; and no frame in two of the three lists. The reader cannot tell
 *  `same-form` from `not-compared` by shape (only the decider knows whether any frame was compared) and does not try. */
function readStanding(v: unknown): FramesStanding | null {
  if (!isObj(v) || !keysAre(v, STANDING_KEYS) || !isClaudeVersion(v['build'])) return null;
  const build = v['build'];
  const against = v['against'];
  if (against !== null && (!isClaudeVersion(against) || compareClaudeVersions(against, build) >= 0)) return null;
  const word = v['word'];
  const refusals = v['refusals'];
  if (!has(FRAMES_FORM_WORD_MAP, word) || !has(FRAMES_REFUSALS_WORD_MAP, refusals)) return null;
  const [differing, refused, overCap] = [readIds(v['differing']), readIds(v['refused']), readIds(v['overCap'])];
  if (differing === null || refused === null || overCap === null) return null;
  if ((differing.length > 0) !== (word === 'new-form')) return null;
  if (against === null ? word === 'new-form' || word === 'same-form' || word === 'not-compared' : word === 'first-form') return null;
  if (refusals !== framesRefusalsWord(refused.length, overCap.length)) return null;
  const seen = new Set<string>();
  for (const id of [...differing, ...refused, ...overCap]) { if (seen.has(id)) return null; seen.add(id); }
  return { build, against: against as string | null, word, differing, refusals, refused, overCap };
}

/** THE ONE READER of the status read's `frames`. ABSENT (`undefined`: a server older than the key, or one with no
 *  coordination store) reads as `unknown`; each answer with exactly its own keys; `null` for anything else. */
export function readFramesStandingAnswer(v: unknown): FramesStandingRead | null {
  if (v === undefined) return { kind: 'unknown' };
  if (!isObj(v)) return null;
  if (v['kind'] === 'no-trusted-build' || v['kind'] === 'held' || v['kind'] === 'unreadable') return keysAre(v, ['kind']) ? { kind: v['kind'] } : null;
  if (v['kind'] !== 'standing' || !keysAre(v, ['kind', 'standing'])) return null;
  const standing = readStanding(v['standing']);
  return standing === null ? null : { kind: 'standing', standing };
}
