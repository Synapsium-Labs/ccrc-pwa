// D-6324: the per-session stream keeps the hook's structured ask past the 30-minute cut, but only while the pane's
// menu corresponds to that envelope's call. `keepAgedAsk` is the pure decider; these cases pin each conjunct.
import { describe, it, expect } from 'vitest';
import { keepAgedAsk, type MenuEvidence } from '../src/askkey.js';
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
  } as HookState,
});

/** The aligned menu for question `k` of QUESTIONS, as `checkDialog` frames it. */
const parsedMenu = (k: number, labels?: (string | null)[]): MenuEvidence => {
  const q = (QUESTIONS as { questions: { question: string; options: { label: string }[] }[] }).questions[k]!;
  return {
    ask: {
      question: q.question, multiSelect: false,
      options: (labels ?? q.options.map((o) => o.label)).map((l) => (l === null ? null : { label: l })),
    },
  };
};
const multiMenu = (labels: string[]): MenuEvidence => ({
  ask: null,
  multi: { options: labels.map((label, i) => ({ index: i + 1, label, checked: false })), freeText: null, commit: 'Next', cursor: 1 },
});
const NO_MENU: MenuEvidence = { ask: null };

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
    const other: MenuEvidence = { ask: { question: 'Trust this folder?', multiSelect: false, options: [{ label: 'Yes' }, { label: 'No' }] } };
    expect(keepAgedAsk(raw(), other)).toBe(false);
    expect(keepAgedAsk(raw({ ask: MULTI_ASK }), multiMenu(['Yes', 'No', 'Maybe']))).toBe(false);
  });

  it("answers false for an aligned copy whose labels differ from the envelope's", () => {
    expect(keepAgedAsk(raw(), parsedMenu(0, ['Red', 'Green', 'Teal']))).toBe(false);
    // Same labels, different question text.
    const m = parsedMenu(0);
    expect(keepAgedAsk(raw(), { ask: { ...m.ask!, question: 'Which shade?' } })).toBe(false);
    // Same leading labels, different count.
    expect(keepAgedAsk(raw(), parsedMenu(0, ['Red', 'Green']))).toBe(false);
  });
});
