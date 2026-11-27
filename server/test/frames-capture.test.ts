// The box frames recipe's cases (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md
// section 3; `shared/framesCapture.ts`): the drafts, the steps, the neutral mail notice held equal to the product's own,
// the mode characters, and the version.
import { describe, expect, it } from 'vitest';
import { renderMailNudge } from '../src/coord/envelope.js';
import {
  FRAMES_LONG_LINE, FRAMES_MODE_CHARS, FRAMES_NUDGE_ID, FRAMES_NUDGE_TEXT, FRAMES_ROW_CHARS, framesCap300, framesDraftLines, framesOurs,
  framesRecipeVersionOf, framesRow, framesSteps,
} from '../../shared/framesCapture.js';
import { FRAMES_CASE_IDS, FRAMES_PANES, FRAMES_PARTS, FRAMES_VERSION_SHAPE } from '../../shared/framesResult.js';

const P50 = FRAMES_PANES[0]!;
const P40 = FRAMES_PANES[1]!;

describe('the drafts', () => {
  it('a row is 60 characters, numbered, and distinct from every other row of its draft', () => {
    expect(framesRow(7, 180)).toHaveLength(FRAMES_ROW_CHARS);
    expect(framesRow(7, 180).startsWith('frames row 007 of 180 ')).toBe(true);
    const rows = framesDraftLines('rows-180', P50);
    expect(new Set(rows).size).toBe(180);
  });
  it('the cap and one over follow 2.1.300\'s formula at each pane: 20 and 21 at 50 rows, 15 and 16 at 40', () => {
    expect([framesCap300(P50), framesCap300(P40)]).toEqual([20, 15]);
    expect(framesDraftLines('cap', P50)).toHaveLength(20);
    expect(framesDraftLines('cap-over', P50)).toHaveLength(21);
    expect(framesDraftLines('cap', P40)).toHaveLength(15);
    expect(framesDraftLines('cap-over-turns', P40)).toHaveLength(16);
  });
  it('the row counts of the other drafts', () => {
    const n = (c: Parameters<typeof framesDraftLines>[0]): number => framesDraftLines(c, P50).length;
    expect([n('empty'), n('rows-3'), n('rows-25'), n('rows-180'), n('up-3'), n('up-3-pageup'), n('person'), n('submitted'), n('chip')])
      .toEqual([0, 3, 25, 180, 180, 180, 180, 180, 1]);
  });
  it('the long line is over the 800-character collapse floor; in view it is the last row, scrolled out the second', () => {
    expect(FRAMES_LONG_LINE).toHaveLength(900);
    expect(framesDraftLines('long-in-view', P50)[179]).toBe(FRAMES_LONG_LINE);
    expect(framesDraftLines('long-out', P50)[1]).toBe(FRAMES_LONG_LINE);
    expect(framesDraftLines('long-out', P50).filter((l) => l === FRAMES_LONG_LINE)).toHaveLength(1);
  });
  it('a person types the same 180 rows the send types', () => {
    expect(framesDraftLines('person', P50)).toEqual(framesDraftLines('rows-180', P50));
  });
});

describe('the steps', () => {
  it('every case ends in its one frame, and has exactly one', () => {
    for (const c of FRAMES_CASE_IDS) {
      const s = framesSteps(c);
      expect(s[s.length - 1]).toEqual({ kind: 'frame' });
      expect(s.filter((x) => x.kind === 'frame')).toHaveLength(1);
    }
  });
  it('a -turns case is its base case after the two earlier turns', () => {
    for (const c of FRAMES_CASE_IDS.filter((x) => x.endsWith('-turns'))) {
      const base = c.slice(0, -'-turns'.length) as typeof c;
      expect(framesSteps(c)).toEqual([{ kind: 'turn', which: 1 }, { kind: 'turn', which: 2 }, ...framesSteps(base)]);
    }
  });
  it('the view cases press Up three times, and then PageUp once', () => {
    expect(framesSteps('up-3')[1]).toEqual({ kind: 'keys', keys: ['Up', 'Up', 'Up'] });
    expect(framesSteps('up-3-pageup')[1]).toEqual({ kind: 'keys', keys: ['Up', 'Up', 'Up', 'PageUp'] });
  });
  it('person is the only case that types as a person', () => {
    const typed = FRAMES_CASE_IDS.filter((c) => framesSteps(c).some((s) => s.kind === 'type' && s.shape === 'person'));
    expect(typed).toEqual(['person', 'person-turns']);
  });
});

describe('the second earlier turn is the product\'s mail notice, to a neutral id', () => {
  it('equals the product\'s own render for the neutral id (the agent cannot import it, so this holds the copy)', () => {
    expect(FRAMES_NUDGE_TEXT).toBe(renderMailNudge(FRAMES_NUDGE_ID));
  });
  it('the id is the neutral stand-in', () => {
    expect(FRAMES_NUDGE_ID).toBe('lane-a-project-a');
  });
});

describe('no frames text starts with a mode character', () => {
  it('at both panes, every case', () => {
    for (const p of FRAMES_PARTS) for (const t of framesOurs(p.case, p.pane)) expect(FRAMES_MODE_CHARS.includes(t.trim().charAt(0))).toBe(false);
  });
});

describe('the version', () => {
  it('is 16 hex, the same on every call, and moves with what it covers', () => {
    const v = framesRecipeVersionOf();
    expect(v).toMatch(FRAMES_VERSION_SHAPE);
    expect(framesRecipeVersionOf()).toBe(v);
    expect(framesRecipeVersionOf('another reducer')).not.toBe(v);
  });
});
