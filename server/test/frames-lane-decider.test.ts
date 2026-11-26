// The box frames recipe's lane, decided (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md
// section 6; `shared/framesLane.ts`): the next job (the newest trusted build only, parts in order, the spacing, never ahead),
// the frame texts set aside past the newest four framed builds, and the read's list answer with no text.
import { describe, expect, it } from 'vitest';
import { BUILD_CAPTURE_RETRY_MS, type ClaudeBuildRecord } from '../../shared/claudeBuildTrust.js';
import { FRAMES_RECIPE_VERSION } from '../../shared/framesCapture.js';
import { FRAMES_KEEP_BUILDS, framesListOf, framesTextToDrop, isCurrentFrames, nextFramesJob, type FramesRow } from '../../shared/framesLane.js';
import { FRAMES_PARTS, FRAMES_PART_COUNT, type FramesCaptureResult } from '../../shared/framesResult.js';

const rec = (build: string, capture: ClaudeBuildRecord['capture']): ClaudeBuildRecord => ({ build, capture } as unknown as ClaudeBuildRecord);
const record = (build: string, part: number, text: string | null = 'x\n'): FramesCaptureResult => ({
  recipe: 'frames', version: FRAMES_RECIPE_VERSION, build, part, case: FRAMES_PARTS[part]!.case, pane: FRAMES_PARTS[part]!.pane, release: null,
  unmeasured: [], word: 'framed', sends: [], turns: 0, sideRequests: 0,
  frame: { outcome: 'drawn', refusal: null, rows: 1, width: 1, bytes: 2, cursor: null, replaced: { cwd: 0, path: 0, model: 0, account: 0 }, text },
});
const row = (build: string, part: number, over: Partial<FramesRow> = {}): FramesRow => ({
  build, part, version: FRAMES_RECIPE_VERSION, word: 'framed', record: record(build, part, null), text: 'x\n', checked: 'clear', at: 5,
  attempts: 1, lastAttemptAt: 5, notSent: null, ...over,
});
const AT = 10 * BUILD_CAPTURE_RETRY_MS;

describe('nextFramesJob', () => {
  it('names the newest trusted build\'s first part with no current row', () => {
    const records = [rec('2.1.331', 'pass'), rec('2.1.332', 'pass'), rec('2.1.333', 'fail')];
    expect(nextFramesJob(records, [], AT)).toEqual({ build: '2.1.332', part: 0 });
    expect(nextFramesJob(records, [row('2.1.332', 0), row('2.1.332', 1)], AT)).toEqual({ build: '2.1.332', part: 2 });
  });
  it('no trusted build: nothing', () => {
    expect(nextFramesJob([rec('2.1.333', 'fail')], [], AT)).toBeNull();
  });
  it('a part tried within the spacing waits, and never skips ahead to a later part', () => {
    const records = [rec('2.1.332', 'pass')];
    const tried = row('2.1.332', 0, { version: null, word: null, record: null, text: null, checked: null, at: null, lastAttemptAt: AT - 1 });
    expect(nextFramesJob(records, [tried], AT)).toBeNull();
    expect(nextFramesJob(records, [{ ...tried, lastAttemptAt: AT - BUILD_CAPTURE_RETRY_MS }], AT)).toEqual({ build: '2.1.332', part: 0 });
  });
  it('a row of another recipe version is not current, so its part is asked again', () => {
    expect(isCurrentFrames(row('2.1.332', 0, { version: '0000000000000000' }))).toBe(false);
    expect(nextFramesJob([rec('2.1.332', 'pass')], [row('2.1.332', 0, { version: '0000000000000000', lastAttemptAt: 0 })], AT)).toEqual({ build: '2.1.332', part: 0 });
  });
  it('a build framed whole is asked nothing, ever, at this version; an older build is never asked (no back-fill)', () => {
    const all = FRAMES_PARTS.map((_, i) => row('2.1.332', i));
    expect(nextFramesJob([rec('2.1.331', 'pass'), rec('2.1.332', 'pass')], all, AT)).toBeNull();
  });
});

describe('framesTextToDrop: the newest four framed builds keep their texts', () => {
  it('keeps four, the incoming one counted, and drops the older', () => {
    const rows = ['2.1.320', '2.1.321', '2.1.322', '2.1.323', '2.1.324'].map((b) => row(b, 0));
    expect(FRAMES_KEEP_BUILDS).toBe(4);
    expect(framesTextToDrop(rows, '2.1.325')).toEqual(['2.1.321', '2.1.320']);
    expect(framesTextToDrop(rows, '2.1.324')).toEqual(['2.1.320']);
  });
  it('a build whose text is already gone is not named again', () => {
    expect(framesTextToDrop([row('2.1.300', 0, { text: null }), row('2.1.330', 0)], '2.1.331')).toEqual([]);
  });
});

describe('framesListOf: the list answer carries no text', () => {
  it('a row per stored record, every part with no current row unmeasured, and no text anywhere', () => {
    const list = framesListOf([row('2.1.332', 0), row('2.1.332', 2, { text: null })], '2.1.332');
    expect(list.frames.map((f) => [f.part, f.frame, f.hasText])).toEqual([[0, 'empty@220x50', true], [2, 'rows-3@220x50', false]]);
    expect(list.unmeasured).toHaveLength(FRAMES_PART_COUNT - 2);
    expect(JSON.stringify(list)).not.toContain('"text"');
  });
  it('a frame the server refused at store time lists as refused, with its word and no text', () => {
    // A text beside a store-time refusal is never listed as held, whatever the row carries.
    const f = framesListOf([row('2.1.332', 0, { checked: 'private-shape', text: 'x\n' })], '2.1.332').frames[0]!;
    expect([f.outcome, f.refusal, f.hasText]).toEqual(['refused', 'private-shape', false]);
  });
});
