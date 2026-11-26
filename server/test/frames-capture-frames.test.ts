// The capture contract's frames recipe (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md
// section 5.6; the capture owner's call 1558, point E): the submission's `frames` recipe with its part, and the state
// frame's `frames`, each read by its one reader. Build trust and delivery read exactly as before, and a frame never names
// both recipes' fields.
import { describe, expect, it } from 'vitest';
import { CAPTURE_RECIPE_MAP, captureRecipeOf } from '../../shared/claudeBuildCapture.js';
import { FRAMES_PARTS, FRAMES_PART_COUNT, frameSize } from '../../shared/framesResult.js';
import { readTestboxFrame } from '../../shared/testbox.js';

const BUILD = '2.1.332';
const ID = '0123456789abcdef0123456789abcdef';
const read = (frame: Record<string, unknown>) => readTestboxFrame(JSON.stringify(frame));
const state = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ t: 'capture.state', captureId: ID, build: BUILD, state: 'ended', refusal: null, detail: null, position: null, result: null, ...over });
const TEXT = '❯ frames row 001 of 003 abcdefghij\n';
const result = (part: number): Record<string, unknown> => {
  const p = FRAMES_PARTS[part]!;
  return {
    recipe: 'frames', version: '0123456789abcdef', build: BUILD, part, case: p.case, pane: { ...p.pane }, release: null, unmeasured: [],
    word: 'framed', sends: [], turns: 0, sideRequests: 0, frame: { outcome: 'drawn', refusal: null, ...frameSize(TEXT), cursor: null, text: TEXT },
  };
};

describe('the submission: a frames capture names its recipe and a part of it', () => {
  it('frames is a capture recipe', () => {
    expect(Object.keys(CAPTURE_RECIPE_MAP)).toEqual(['build-trust', 'delivery', 'frames']);
    expect(captureRecipeOf({ recipe: 'frames' })).toBe('frames');
  });
  it('a frames submission carries its recipe and any part of the list', () => {
    for (const part of [0, 1, FRAMES_PART_COUNT - 1]) {
      expect(read({ t: 'capture.submit', captureId: ID, build: BUILD, recipe: 'frames', part }))
        .toEqual({ ok: true, value: { t: 'capture.submit', captureId: ID, build: BUILD, recipe: 'frames', part } });
    }
  });
  it.each<[string, Record<string, unknown>]>([
    ['the recipe without a part', { recipe: 'frames' }],
    ['a part past the list', { recipe: 'frames', part: FRAMES_PART_COUNT }],
    ['a negative part', { recipe: 'frames', part: -1 }],
    ['a part spelled as text', { recipe: 'frames', part: '0' }],
  ])('refuses %s', (_why, over) => {
    expect(read({ t: 'capture.submit', captureId: ID, build: BUILD, ...over }).ok).toBe(false);
  });
  it('a frames part is judged against the frames list, not the delivery parts', () => {
    expect(read({ t: 'capture.submit', captureId: ID, build: BUILD, recipe: 'frames', part: 40 }).ok).toBe(true);
    expect(read({ t: 'capture.submit', captureId: ID, build: BUILD, recipe: 'delivery', part: 40 }).ok).toBe(false);
  });
});

describe('the state frame: frames on a frames capture\'s frames only', () => {
  it('a frames capture\'s queued, running and refused frames carry frames: null', () => {
    expect(read(state({ state: 'queued', position: 1, frames: null })).ok).toBe(true);
    expect(read(state({ state: 'running', frames: null })).ok).toBe(true);
    expect(read(state({ state: 'refused', refusal: 'no-runner', detail: 'x', frames: null })).ok).toBe(true);
  });
  it('an ended frames capture carries its result, read by the result\'s one reader', () => {
    const r = read(state({ frames: result(3) }));
    expect(r.ok && (r.value as { frames?: { part: number } }).frames?.part).toBe(3);
  });
  it('an ended frames capture with no result carries null and a detail', () => {
    expect(read(state({ frames: null, detail: 'a fault of the box' })).ok).toBe(true);
  });
  it.each<[string, Record<string, unknown>]>([
    ['a result off its shape', { frames: { ...result(0), word: 'gaps' } }],
    ['a result for another build', { frames: { ...result(0), build: '2.1.331' } }],
    ['a result beside a trust verdict', { frames: result(0), result: { build: BUILD, pass: true, cwd: true, output: 'x' } }],
    ['a result on a running capture', { state: 'running', frames: result(0) }],
    ['a detail beside a result', { frames: result(0), detail: 'x' }],
    ['frames beside delivery', { frames: null, delivery: null }],
  ])('refuses %s', (_why, over) => {
    expect(read(state(over)).ok).toBe(false);
  });
});
