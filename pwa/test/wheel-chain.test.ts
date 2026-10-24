// A wheel over a code block or a tool well must reach the transcript (D-6437, desktop polish Task C5).
//
// A code block is a scroll container (`max-height: var(--well-max)`, `overflow: auto`). An `overscroll-behavior:
// contain` on it stops scroll chaining on BOTH axes even when it has nothing to scroll, so a wheel over any block
// never reached `.chat-scroller`: measured in Chrome at 1920 in both skins, 0 px over a block, 600 px over prose.
// The rule is one: a box inside the transcript never keeps a y-axis containment, and keeps an x-axis one only if it
// can scroll sideways. `.msg-assist pre` (white-space: pre) can, so it takes `overscroll-behavior-x: contain`, as
// `.md-table-wrap` does; `WELL` (pre-wrap) and `.tool-ask-a` (overflow-wrap: anywhere) cannot, so they carry none.
//
// vitest runs with `css: false`, so this reads the two stylesheets and the class string as text (`cssRule.ts`).
// The behaviour itself — a wheel moving the scroller — is `browser/wheel-chain.browser.test.ts`'s, in a real Chrome.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WELL } from '@ccrc/ui';
import { declValue, norm, ruleIn, stripComments } from './cssRule';

const UI = path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components');
const prose = readFileSync(path.join(UI, 'prose.css'), 'utf8');
const toolCard = readFileSync(path.join(UI, 'tool-card.css'), 'utf8');

describe('a wheel over a transcript box chains to the transcript (D-6437)', () => {
  it('each transcript box carries exactly its containment', () => {
    // `.msg-assist pre` — the rule for the block itself; `ruleIn` matches a whole selector, so `.msg-assist pre code`
    // (a different rule, which sets no containment) cannot stand in for it.
    const pre = ruleIn(prose, '.msg-assist pre');
    expect(declValue(pre, 'max-height'), 'the block rule is the one that sets the block\'s scrolling').toBe('var(--well-max)');
    expect(declValue(pre, 'overscroll-behavior-x'), 'a block scrolls sideways, so it contains that axis').toBe('contain');
    expect(declValue(pre, 'overscroll-behavior'), 'the shorthand would contain y as well').toBeNull();
    expect(declValue(pre, 'overscroll-behavior-y'), 'no y-axis containment inside the transcript').toBeNull();

    // A WHOLE-PIXEL line height, declared AFTER the `font` shorthand (which resets it): 13px x 1.55 = 20.15px made a
    // 60-line block's scroll range fractional, and at some page offsets Chrome then swallowed the first wheel at the
    // block's end (the browser leg's sweep measures that). Either the round() form over the two tokens or an integer px.
    const names = stripComments(pre).split(';').map((d) => norm(d.slice(0, Math.max(d.indexOf(':'), 0))));
    const fontAt = names.lastIndexOf('font');
    const lineAt = names.lastIndexOf('line-height');
    expect(fontAt, 'the block sets its font through the shorthand').toBeGreaterThanOrEqual(0);
    expect(lineAt, 'the block declares a line-height after the font shorthand').toBeGreaterThan(fontAt);
    const line = (declValue(pre, 'line-height') ?? '').replace(/\s+/g, '');
    expect(line, 'a whole-pixel line height').toMatch(WHOLE_PIXEL);

    // `WELL` wraps its lines, so it never scrolls sideways: no token of its own begins `overscroll`
    // (neither `overscroll-contain` nor `overscroll-x-contain`).
    const overscrollTokens = WELL.split(/\s+/).filter((t) => t.startsWith('overscroll'));
    expect(overscrollTokens, 'WELL carries no overscroll token').toEqual([]);

    // `.tool-ask-a` wraps anywhere, so it carries no overscroll declaration of any spelling.
    const chip = ruleIn(toolCard, '.tool-ask-a');
    expect(declValue(chip, 'max-height'), 'the chip rule is the one that caps and scrolls the answer').toBe('var(--well-max)');
    for (const prop of ['overscroll-behavior', 'overscroll-behavior-x', 'overscroll-behavior-y']) {
      expect(declValue(chip, prop), `.tool-ask-a declares ${prop}`).toBeNull();
    }
    expect(stripComments(chip), 'no spelling of overscroll-behavior at all').not.toMatch(/overscroll-behavior/);
  });
});

// A mono box wraps its text in whole pixels: 13px x 1.55 = 20.15px makes a tall box's scroll range fractional, and at
// some page offsets Chrome then latches the first wheel at the box's end to the box, which cannot move (the browser leg
// sweeps eight offsets per box). Either the round() form over the two tokens or an integer px, in whatever spacing.
const WHOLE_PIXEL = /^(round\(down,calc\(var\(--fs-sm\)\*var\(--lh-mono\)\),1px\)|\d+px)$/;

describe('a mono box in the transcript declares a whole-pixel line height (D-6437, R68)', () => {
  it('WELL declares a whole-pixel line height', () => {
    // Tailwind spells it as one arbitrary-value `leading` class (spaces as underscores), or as an arbitrary
    // `line-height` property class. `leading-mono` is the token's unitless 1.55, which is the defect.
    const lineTokens = WELL.split(/\s+/).filter((t) => /^leading-|^\[line-height:/.test(t));
    expect(lineTokens, 'WELL carries exactly one line-height class').toHaveLength(1);
    const m = /^(?:leading-\[(.*)\]|\[line-height:(.*)\])$/.exec(lineTokens[0]!);
    expect(m, `WELL's line-height class ${lineTokens[0]} must be an arbitrary whole-pixel value (a bracketed leading class), not the unitless token`).not.toBeNull();
    const value = (m![1] ?? m![2] ?? '').replace(/_/g, '').replace(/\s+/g, '');
    expect(value, 'a whole-pixel line height').toMatch(WHOLE_PIXEL);
  });

  it('.tool-ask-a declares a whole-pixel line height', () => {
    // After the `font` shorthand, which resets it.
    const chip = ruleIn(toolCard, '.tool-ask-a');
    const names = stripComments(chip).split(';').map((d) => norm(d.slice(0, Math.max(d.indexOf(':'), 0))));
    const fontAt = names.lastIndexOf('font');
    const lineAt = names.lastIndexOf('line-height');
    expect(fontAt, 'the chip sets its font through the shorthand').toBeGreaterThanOrEqual(0);
    expect(lineAt, 'the chip declares a line-height after the font shorthand').toBeGreaterThan(fontAt);
    const line = (declValue(chip, 'line-height') ?? '').replace(/\s+/g, '');
    expect(line, 'a whole-pixel line height').toMatch(WHOLE_PIXEL);
  });
});

