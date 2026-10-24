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
import { declValue, ruleIn } from './cssRule';

const UI = path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components');
const prose = readFileSync(path.join(UI, 'prose.css'), 'utf8');
const toolCard = readFileSync(path.join(UI, 'tool-card.css'), 'utf8');

describe('a wheel over a transcript box chains to the transcript (D-6437)', () => {
  it('each transcript box carries exactly its containment', () => {
    // `.msg-assist pre` — the rule for the block itself; `ruleIn` matches a whole selector, so `.msg-assist pre code`
    // (a different rule, which sets no containment) cannot stand in for it.
    const pre = ruleIn(prose, '.msg-assist pre');
    expect(pre, 'the block rule is the one that sets the block\'s scrolling').toContain('max-height: var(--well-max)');
    expect(declValue(pre, 'overscroll-behavior-x'), 'a block scrolls sideways, so it contains that axis').toBe('contain');
    expect(declValue(pre, 'overscroll-behavior'), 'the shorthand would contain y as well').toBeNull();
    expect(declValue(pre, 'overscroll-behavior-y'), 'no y-axis containment inside the transcript').toBeNull();

    // `WELL` wraps its lines, so it never scrolls sideways: no token of its own begins `overscroll`
    // (neither `overscroll-contain` nor `overscroll-x-contain`).
    const overscrollTokens = WELL.split(/\s+/).filter((t) => t.startsWith('overscroll'));
    expect(overscrollTokens, 'WELL carries no overscroll token').toEqual([]);

    // `.tool-ask-a` wraps anywhere, so it carries no overscroll declaration of any spelling.
    const chip = ruleIn(toolCard, '.tool-ask-a');
    expect(chip, 'the chip rule is the one that caps and scrolls the answer').toContain('max-height: var(--well-max)');
    for (const prop of ['overscroll-behavior', 'overscroll-behavior-x', 'overscroll-behavior-y']) {
      expect(declValue(chip, prop), `.tool-ask-a declares ${prop}`).toBeNull();
    }
    expect(chip, 'no spelling of overscroll-behavior at all').not.toMatch(/overscroll-behavior/);
  });
});
