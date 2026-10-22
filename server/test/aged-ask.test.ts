// D-6324: the per-session stream keeps the hook's structured ask past the 30-minute cut, but only while the pane's
// menu corresponds to that envelope's call. `keepAgedAsk` is the pure decider; these cases pin each conjunct.
import { describe, it, expect } from 'vitest';
import { keepAgedAsk, nextAgedKeep, NO_AGED_KEEP, type MenuEvidence } from '../src/askkey.js';
import type { HookState, HookStateRawRead } from '../src/hookstate.js';
import type { HookAsk } from '../../shared/api.js';

const QUESTIONS: HookAsk = {
  questions: [
    { question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Green' }, { label: 'Blue' }] },
    { question: 'Which size?', options: [{ label: 'Small' }, { label: 'Large' }] },
  ],
};
const MULTI_ASK: HookAsk = {
  questions: [{ question: 'Which tools?', multiSelect: true, options: [{ label: 'Hammer' }, { label: 'Saw' }, { label: 'Drill' }] }],
};
const APPROVAL: HookAsk = { approval: { tool: 'Bash', summary: 'rm -rf build/' } };

const raw = (over: {
  ask?: HookAsk | null; state?: HookState['state']; identity?: 'current' | 'foreign' | 'unregistered';
} = {}): HookStateRawRead => ({
  ok: true,
  sessionId: 'a'.repeat(36),
  identity: over.identity ?? 'current',
  state: {
    state: over.state ?? 'waiting', event: 'Notification', updatedAt: Date.now() - 31 * 60_000,
    ask: over.ask === undefined ? QUESTIONS : over.ask, subagents: [],
    graphQueries: null, graphGateDenials: null, interrupted: false,
  },
});

/** The aligned menu for question `k` of QUESTIONS, as `checkDialog` frames it. */
const parsedMenu = (k: number, labels?: (string | null)[]): MenuEvidence => {
  const q = (QUESTIONS as { questions: { question: string; options: { label: string }[] }[] }).questions[k]!;
  return {
    ask: {
      question: q.question, multiSelect: false,
      options: (labels ?? q.options.map((o) => o.label)).map((l) => (l === null ? null : { label: l })),
    },
    raw: null,
  };
};
const multiMenu = (labels: string[]): MenuEvidence => ({
  ask: null,
  raw: 'the unparsed pane',
  multi: { options: labels.map((label, i) => ({ index: i + 1, label, checked: false })), freeText: null, commit: 'Next', cursor: 1 },
});
const NO_MENU: MenuEvidence = { ask: null, raw: null };
/** The pane's review screen (`Submit answers` / `Cancel`): a parsed menu no question is aligned to. `review` carries
 *  the question texts the screen lists (`reviewQuestions`). */
const reviewOf = (...listed: string[]): MenuEvidence => ({ ask: null, review: listed, raw: null });
const REVIEW: MenuEvidence = reviewOf('Which colour?', 'Which size?');
/** An unparsed capture with no multi: a menu grabbed mid-redraw. */
const REDRAW: MenuEvidence = { ask: null, raw: 'half-painted pane' };

describe('keepAgedAsk (D-6324)', () => {
  it("keeps an aged envelope while the pane's parsed menu aligns with one of its questions", () => {
    expect(keepAgedAsk(raw(), parsedMenu(0))).toBe(true);
    // The pane may be on question 2: askKey hashes only the first, the correspondence reads every question.
    expect(keepAgedAsk(raw(), parsedMenu(1))).toBe(true);
  });

  it("keeps an aged multiSelect envelope while its unparsed multi menu's labels match", () => {
    expect(keepAgedAsk(raw({ ask: MULTI_ASK }), multiMenu(['Hammer', 'Saw', 'Drill']))).toBe(true);
    // A scraped label may be the truncated side: pairMatches compares as prefixes.
    expect(keepAgedAsk(raw({ ask: MULTI_ASK }), multiMenu(['Hamm', 'Saw', 'Drill']))).toBe(true);
  });

  it('forgives a row the alignment already forgave (a null entry), and no other', () => {
    expect(keepAgedAsk(raw(), parsedMenu(0, ['Red', null, 'Blue']))).toBe(true);
    expect(keepAgedAsk(raw(), parsedMenu(0, ['Red', 'Mauve', 'Blue']))).toBe(false);
  });

  it('answers false when the identity is foreign', () => {
    expect(keepAgedAsk(raw({ identity: 'foreign' }), parsedMenu(0))).toBe(false);
  });

  it('answers false when the identity is unregistered', () => {
    expect(keepAgedAsk(raw({ identity: 'unregistered' }), parsedMenu(0))).toBe(false);
  });

  it('answers false when the state is working', () => {
    expect(keepAgedAsk(raw({ state: 'working' }), parsedMenu(0))).toBe(false);
  });

  it('answers false when the state is done', () => {
    expect(keepAgedAsk(raw({ state: 'done' }), parsedMenu(0))).toBe(false);
  });

  it('answers false for an approval envelope', () => {
    expect(keepAgedAsk(raw({ ask: APPROVAL }), parsedMenu(0))).toBe(false);
    expect(keepAgedAsk(raw({ ask: null }), parsedMenu(0))).toBe(false);
  });

  it('answers false for a failed raw read', () => {
    expect(keepAgedAsk({ ok: false, reason: 'unmeasured' }, parsedMenu(0))).toBe(false);
    expect(keepAgedAsk({ ok: false, reason: 'absent' }, parsedMenu(0))).toBe(false);
  });

  it('answers false with no correspondence (a different menu is up)', () => {
    expect(keepAgedAsk(raw(), NO_MENU)).toBe(false);
    const other: MenuEvidence = {
      ask: { question: 'Trust this folder?', multiSelect: false, options: [{ label: 'Yes' }, { label: 'No' }] }, raw: null,
    };
    expect(keepAgedAsk(raw(), other)).toBe(false);
    expect(keepAgedAsk(raw({ ask: MULTI_ASK }), multiMenu(['Yes', 'No', 'Maybe']))).toBe(false);
  });

  it("answers false for an aligned copy whose labels differ from the envelope's", () => {
    expect(keepAgedAsk(raw(), parsedMenu(0, ['Red', 'Green', 'Teal']))).toBe(false);
    // Same labels, different question text.
    const m = parsedMenu(0);
    expect(keepAgedAsk(raw(), { ...m, ask: { ...m.ask!, question: 'Which shade?' } })).toBe(false);
    // Same leading labels, different count.
    expect(keepAgedAsk(raw(), parsedMenu(0, ['Red', 'Green']))).toBe(false);
  });
});

describe('keepAgedAsk: the multi menu\'s length and the review screen (D-6324)', () => {
  it('does not keep an aged multiSelect envelope for a multi menu with fewer labels', () => {
    expect(keepAgedAsk(raw({ ask: MULTI_ASK }), multiMenu(['Hammer', 'Saw']))).toBe(false);
  });

  it('does not keep an aged multiSelect envelope for a multi menu with more labels, and does not throw', () => {
    expect(keepAgedAsk(raw({ ask: MULTI_ASK }), multiMenu(['Hammer', 'Saw', 'Drill', 'Pliers']))).toBe(false);
  });

  it("keeps an aged multi-question envelope while the pane shows its review screen", () => {
    expect(keepAgedAsk(raw(), REVIEW)).toBe(true);
  });

  it('keeps a one-question multiSelect envelope on its own review screen', () => {
    // Claude Code paints a review after a one-question multiSelect ask too (`cc300-ask-review-1q-multiselect`).
    expect(keepAgedAsk(raw({ ask: MULTI_ASK }), reviewOf('Which tools?'))).toBe(true);
  });

  it('does not keep an ineligible envelope on the review screen', () => {
    expect(keepAgedAsk(raw({ identity: 'foreign' }), REVIEW)).toBe(false);
    expect(keepAgedAsk(raw({ state: 'working' }), REVIEW)).toBe(false);
    expect(keepAgedAsk(raw({ ask: APPROVAL }), REVIEW)).toBe(false);
  });
});

describe('nextAgedKeep: one mid-redraw capture holds the previous decision (D-6324)', () => {
  const KEPT = { kept: true, redraws: 0 };

  it('starts from no keep', () => {
    expect(NO_AGED_KEEP).toEqual({ kept: false, redraws: 0 });
  });

  it('decides with keepAgedAsk on a parsed menu', () => {
    expect(nextAgedKeep(NO_AGED_KEEP, raw(), parsedMenu(0))).toEqual({ kept: true, redraws: 0 });
    expect(nextAgedKeep(KEPT, raw(), multiMenu(['Hammer', 'Saw']))).toEqual({ kept: false, redraws: 0 });
    expect(nextAgedKeep(KEPT, raw(), parsedMenu(0, ['Red', 'Green', 'Teal']))).toEqual({ kept: false, redraws: 0 });
  });

  it('holds a kept decision across ONE unparsed capture that carries no multi', () => {
    expect(nextAgedKeep(KEPT, raw(), REDRAW)).toEqual({ kept: true, redraws: 1 });
  });

  it('decides as today on a second consecutive such capture', () => {
    expect(nextAgedKeep({ kept: true, redraws: 1 }, raw(), REDRAW)).toEqual({ kept: false, redraws: 2 });
  });

  it('holds nothing it did not already keep', () => {
    expect(nextAgedKeep(NO_AGED_KEEP, raw(), REDRAW)).toEqual({ kept: false, redraws: 1 });
  });

  it('holds only while the envelope is still eligible', () => {
    expect(nextAgedKeep(KEPT, raw({ identity: 'foreign' }), REDRAW).kept).toBe(false);
    expect(nextAgedKeep(KEPT, raw({ state: 'working' }), REDRAW).kept).toBe(false);
    expect(nextAgedKeep(KEPT, raw({ ask: APPROVAL }), REDRAW).kept).toBe(false);
    expect(nextAgedKeep(KEPT, { ok: false, reason: 'absent' }, REDRAW).kept).toBe(false);
  });

  it('resets the count on a capture that is not a redraw', () => {
    expect(nextAgedKeep({ kept: true, redraws: 1 }, raw(), parsedMenu(0))).toEqual({ kept: true, redraws: 0 });
    expect(nextAgedKeep({ kept: true, redraws: 1 }, raw(), NO_MENU)).toEqual({ kept: false, redraws: 0 });
    // An unparsed multi menu is a menu the stream can read, not a half-painted one.
    expect(nextAgedKeep(KEPT, raw({ ask: MULTI_ASK }), multiMenu(['Hammer', 'Saw', 'Drill']))).toEqual({ kept: true, redraws: 0 });
  });
});
