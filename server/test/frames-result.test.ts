// The box frames recipe's result (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md
// section 5.1; `shared/framesResult.ts`): the part list, a frame's shape rule and the cap, and the result's ONE reader,
// with a case for each refusal.
import { describe, expect, it } from 'vitest';
import { DELIVERY_COUNT_MAX } from '../../shared/deliveryResult.js';
import {
  FRAMES_CASE_IDS, FRAMES_PANES, FRAMES_PARTS, FRAMES_PART_COUNT, FRAME_BYTES_MAX, frameSize, frameTextFits, framesFrameId,
  framesPartOfId, framesWord, isFramesPart, readFramesCaptureResult, type FramesCaptureResult,
} from '../../shared/framesResult.js';

const BUILD = '2.1.332';
const RELEASE = 'v0.0.1500';
const ESC = '\x1b';

/** A frame of `rows` lines of `width` characters each, ending in a line break as `capture-pane -p` does. */
const frameText = (rows: number, width: number): string => Array.from({ length: rows }, (_, i) => String(i % 10).repeat(width)).join('\n') + '\n';

/** A drawn result for part `part`, which a case then breaks one field at a time. */
function result(part = 0, over: Record<string, unknown> = {}, frame: Record<string, unknown> = {}): Record<string, unknown> {
  const p = FRAMES_PARTS[part]!;
  const text = frameText(3, 20);
  return {
    recipe: 'frames', version: '0123456789abcdef', build: BUILD, part, case: p.case, pane: { cols: p.pane.cols, rows: p.pane.rows },
    release: RELEASE, unmeasured: [], word: 'framed', sends: [], turns: 0, sideRequests: 0,
    frame: { outcome: 'drawn', refusal: null, ...frameSize(text), cursor: [2, 1], text, ...frame },
    ...over,
  };
}

describe('the part list', () => {
  it('is every case at 220x50 then 220x40, in the case order: 26 cases, 52 parts', () => {
    expect(FRAMES_CASE_IDS).toHaveLength(26);
    expect(FRAMES_PANES).toEqual([{ cols: 220, rows: 50 }, { cols: 220, rows: 40 }]);
    expect(FRAMES_PART_COUNT).toBe(52);
    expect(FRAMES_PARTS.slice(0, 4).map(framesFrameId)).toEqual(['empty@220x50', 'empty@220x40', 'rows-3@220x50', 'rows-3@220x40']);
    expect(new Set(FRAMES_PARTS.map(framesFrameId)).size).toBe(52);
  });
  it('the wave 185 worker\'s ranking: the rows and cap cases, their -turns, then the rest', () => {
    expect(FRAMES_CASE_IDS.slice(0, 13)).toEqual([
      'empty', 'rows-3', 'cap', 'cap-over', 'rows-25', 'rows-180',
      'empty-turns', 'rows-3-turns', 'cap-turns', 'cap-over-turns', 'rows-25-turns', 'rows-180-turns', 'submitted',
    ]);
  });
  it('a frame id is query-safe (no `+`, no space) and names its part back', () => {
    for (const [i, p] of FRAMES_PARTS.entries()) {
      expect(framesFrameId(p)).toMatch(/^[a-z0-9-]+@\d+x\d+$/);
      expect(framesPartOfId(framesFrameId(p))).toBe(i);
    }
    expect(framesPartOfId('rows-25+turns@220x50')).toBeNull();
    expect(framesPartOfId('rows-25@220x30')).toBeNull();
    expect(framesPartOfId(7)).toBeNull();
  });
  it('isFramesPart: an integer index of the list only', () => {
    expect([0, 51].every(isFramesPart)).toBe(true);
    expect([-1, 52, 1.5, '0', null].some(isFramesPart)).toBe(false);
  });
});

describe('a frame\'s shape rule and the cap', () => {
  const pane = { cols: 220, rows: 50 };
  it('measures rows less the trailing line break, the widest row less SGR, and UTF-8 bytes', () => {
    expect(frameSize(`a${ESC}[2mbc${ESC}[0m\nxy\n`)).toEqual({ rows: 2, width: 3, bytes: Buffer.byteLength(`a${ESC}[2mbc${ESC}[0m\nxy\n`) });
    expect(frameSize('❯ ж\n').width).toBe(3);
  });
  it('takes SGR, and a frame at exactly the cap', () => {
    expect(frameTextFits(`${ESC}[38;5;246mdim${ESC}[0m\n`, pane)).toBe(true);
    expect(frameTextFits(frameText(50, 220), pane)).toBe(true);
  });
  it('refuses a hyperlink, a cursor move, a bare ESC, a tab and a carriage return: never stripped', () => {
    for (const t of [`${ESC}]8;;http://x${ESC}\\x${ESC}]8;;${ESC}\\\n`, `${ESC}[2Ax\n`, `${ESC}x\n`, 'a\tb\n', 'a\r\n']) expect(frameTextFits(t, pane)).toBe(false);
  });
  it('refuses one row over, one column over, and one byte over the cap', () => {
    expect(frameTextFits(frameText(51, 10), pane)).toBe(false);
    expect(frameTextFits(frameText(1, 221), pane)).toBe(false);
    const big = 'x'.repeat(200) + '\n';
    const fat = big.repeat(Math.ceil((FRAME_BYTES_MAX + 1) / big.length)).slice(0, FRAME_BYTES_MAX + 1);
    expect(frameSize(fat).bytes).toBe(FRAME_BYTES_MAX + 1);
    expect(frameTextFits(fat, { cols: 220, rows: 1000 })).toBe(false);
  });
});

describe('readFramesCaptureResult: the one reader', () => {
  it('reads a drawn result back as written', () => {
    const r = readFramesCaptureResult(result(), BUILD, 0) as FramesCaptureResult;
    expect(r).not.toBeNull();
    expect(r.word).toBe('framed');
    expect(r.frame.cursor).toEqual([2, 1]);
  });
  it('reads an over-cap and a refused result, each with no text', () => {
    expect(readFramesCaptureResult(result(0, { word: 'gaps' }, { outcome: 'over-cap', rows: 60, width: 220, bytes: 9000, text: null }), BUILD, 0)).not.toBeNull();
    expect(readFramesCaptureResult(result(0, { word: 'gaps' }, { outcome: 'refused', refusal: 'private-shape', text: null }), BUILD, 0)).not.toBeNull();
    expect(readFramesCaptureResult(result(0, { word: 'gaps' }, { outcome: 'unsettled' }), BUILD, 0)).not.toBeNull();
  });
  const refuse: readonly [string, Record<string, unknown>, Record<string, unknown>?][] = [
    ['another recipe', { recipe: 'delivery' }],
    ['a key not named', { extra: 1 }],
    ['another build', { build: '2.1.331' }],
    ['a build off the grammar', {}, undefined],
    ['another part', { part: 1 }],
    ['another case', { case: 'rows-3' }],
    ['another pane', { pane: { cols: 220, rows: 40 } }],
    ['a pane with a key added', { pane: { cols: 220, rows: 50, x: 1 } }],
    ['a version off its shape', { version: 'ABC' }],
    ['a release off the grammar', { release: 'latest' }],
    ['an unmeasured name not known', { unmeasured: ['nope'] }],
    ['an unmeasured name twice', { unmeasured: ['fleet-tmux-config', 'fleet-tmux-config'] }],
    ['a send step twice', { sends: [{ step: 'turn-1', send: 'ok' }, { step: 'turn-1', send: 'ok' }] }],
    ['a send step not known', { sends: [{ step: 'later', send: 'ok' }] }],
    ['a send word off its shape', { sends: [{ step: 'send', send: 'OK!' }] }],
    ['a turn count over the ceiling', { turns: DELIVERY_COUNT_MAX + 1 }],
    ['a negative side-request count', { sideRequests: -1 }],
    ['a word the outcome does not give', { word: 'gaps' }],
    ['a refusal without the refused outcome', {}, { refusal: 'masked' }],
    ['the refused outcome without a refusal', { word: 'gaps' }, { outcome: 'refused', text: null }],
    ['a refusal word not known', { word: 'gaps' }, { outcome: 'refused', refusal: 'other', text: null }],
    ['text beside a refusal', { word: 'gaps' }, { outcome: 'refused', refusal: 'masked' }],
    ['no text on a drawn frame', {}, { text: null }],
    ['over-cap sizes on a drawn frame', {}, { rows: 51 }],
    ['an over-cap outcome inside the cap', { word: 'gaps' }, { outcome: 'over-cap', text: null }],
    ['a text that does not fit its pane', {}, { text: `${ESC}]8;;x${ESC}\\\n` }],
    ['a cursor outside the pane', {}, { cursor: [220, 0] }],
    ['a cursor not a pair', {}, { cursor: [1] }],
    ['a frame with a key added', {}, { extra: 1 }],
  ];
  for (const [name, over, frame] of refuse) {
    it(`refuses ${name}`, () => {
      const v = result(0, over, frame ?? {});
      const build = name === 'a build off the grammar' ? 'latest' : BUILD;
      if (name === 'a build off the grammar') v['build'] = 'latest';
      expect(readFramesCaptureResult(v, build, 0)).toBeNull();
    });
  }
  it('refuses a part not on the list', () => {
    expect(readFramesCaptureResult(result(), BUILD, 52)).toBeNull();
  });
  it('the word: framed only for drawn', () => {
    expect((['drawn', 'unsettled', 'over-cap', 'refused'] as const).map(framesWord)).toEqual(['framed', 'gaps', 'gaps', 'gaps']);
  });
});
