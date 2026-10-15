// D-5089 (plan docs/superpowers/plans/2026-10-15-ask-sheet-half.md, Task 1): `askLive`, the pure reading the sheet
// takes off a live AskUserQuestion pane. Which of the envelope's questions the pane is painting (`liveQuestion`), the
// one its title names when labels cannot say (`namedQuestion`), the review screen (`isAskReview`) and its summary read
// from `raw` (`reviewSummary`), and the free-text row (`freeTextSlot`).
//
// Every screen is a recorded one (`askPanes.ts`, copied from `parseDialog` and kept equal to it by
// `server/test/dialog.test.ts`), named by its fixture. A shape no recording shows is DERIVED from one in the test, and
// says so.
import { describe, expect, it } from 'vitest';
import type { Dialog, HookAskQuestion } from '../../shared/api';
import {
  freeTextSlot,
  isAskReview,
  liveQuestion,
  namedQuestion,
  reviewSummary,
  rowText,
  titleMatches,
} from '../src/session/askLive';
import {
  CACHING_TRACING,
  COLOUR_ONE,
  DRINK_FEATURES_TOOLS,
  FOUR_Q,
  FRUIT_DRINK,
  pane,
  type AskEnvelope,
} from './askPanes';

/** A DERIVED envelope: a copy of a recorded one with `edit` applied, so the recorded constant stays as recorded. */
const derive = (env: AskEnvelope, edit: (qs: HookAskQuestion[]) => void): AskEnvelope => {
  const copy = structuredClone(env) as AskEnvelope;
  edit(copy.questions);
  return copy;
};

/** A DERIVED screen: a recorded one with `patch` applied. */
const screen = (name: string, patch: Partial<Dialog>): Dialog => ({ ...pane(name), ...patch });

describe('liveQuestion: which question the pane is painting (D-5089)', () => {
  it('a one-question envelope keeps the labels-only rule', () => {
    expect(liveQuestion(COLOUR_ONE, pane('cc300-ask-1q-open'))).toBe(0);
    // DERIVED: Claude Code renders the question differently from the envelope's text. Labels alone still decide.
    expect(liveQuestion(COLOUR_ONE, screen('cc300-ask-1q-open', { title: 'Which color, please?' }))).toBe(0);
  });

  it('a unique label correspondence wins without the title', () => {
    expect(liveQuestion(FRUIT_DRINK, pane('cc300-ask-q2-of-2-single'))).toBe(1);
    // DERIVED: a title that is no suffix of the question. Only one question has Tea and Coffee, so it still wins.
    expect(liveQuestion(FRUIT_DRINK, screen('cc300-ask-q2-of-2-single', { title: 'Which drink, today?' }))).toBe(1);
  });

  it('same labels: the title breaks the tie', () => {
    expect(liveQuestion(CACHING_TRACING, pane('cc300-ask-same-labels-q1'))).toBe(0);
    expect(liveQuestion(CACHING_TRACING, pane('cc300-ask-same-labels-q2'))).toBe(1);
    // The walk onto the free-text row and the text typed into it change neither the labels above it nor the title.
    expect(liveQuestion(CACHING_TRACING, pane('cc300-ask-freetext-walk-2-focused'))).toBe(1);
    expect(liveQuestion(CACHING_TRACING, pane('cc300-ask-freetext-walk-3-typed'))).toBe(1);
  });

  it('a wrapped question matches by its last row once the bar is stripped', () => {
    // DERIVED: Notes takes Order's labels, so the labels tie and only the title can tell Order.
    const tied = derive(FOUR_Q, (qs) => { qs[2]!.options = structuredClone(qs[1]!.options); });
    const wrapped = pane('cc300-ask-wrapped-question');
    expect(wrapped.title.startsWith('│ ')).toBe(true);
    expect(liveQuestion(tied, wrapped)).toBe(1);
  });

  it('markdown is literal', () => {
    // DERIVED: Region takes Engine's labels; the title carries the backticks and asterisks as the envelope does.
    const tied = derive(FOUR_Q, (qs) => { qs[3]!.options = structuredClone(qs[0]!.options); });
    expect(liveQuestion(tied, pane('cc300-ask-markdown-question'))).toBe(0);
  });

  it('a tie the title cannot break is null', () => {
    // DERIVED: both questions read Yes/No, and the pane's title is a suffix of both.
    const both: AskEnvelope = {
      questions: [
        { question: 'Enable tracing?', header: 'Tracing', multiSelect: false, options: CACHING_TRACING.questions[1]!.options },
        { question: 'Really enable tracing?', header: 'Really', multiSelect: false, options: CACHING_TRACING.questions[1]!.options },
      ],
    };
    expect(liveQuestion(both, pane('cc300-ask-same-labels-q2'))).toBeNull();
  });

  it('no correspondence is null', () => {
    expect(liveQuestion(FRUIT_DRINK, pane('cc300-ask-same-labels-q1'))).toBeNull();
    expect(liveQuestion(FRUIT_DRINK, null)).toBeNull();
  });

  it('an unparsed dialog never corresponds', () => {
    expect(liveQuestion(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-next-open'))).toBeNull();
    // DERIVED: a recorded menu marked unparsed (a capture mid-redraw parses this way) keeps its rows and still never
    // corresponds: its rows are not per-position labels to type by.
    expect(liveQuestion(CACHING_TRACING, screen('cc300-ask-same-labels-q2', { parsed: false }))).toBeNull();
  });

  it('a question with no options is never a candidate', () => {
    // DERIVED: an envelope listing nothing to tap, against a parsed pane it would vacuously match.
    const empty = derive(FRUIT_DRINK, (qs) => { qs[1]!.options = []; qs[0]!.options = []; });
    expect(liveQuestion(empty, pane('cc300-ask-q2-of-2-single'))).toBeNull();
  });

  it('a multiSelect question never corresponds to a parsed menu', () => {
    // DERIVED: Drink marked multiSelect. One tap would tick a box, never answer it.
    const multi = derive(FRUIT_DRINK, (qs) => { qs[1]!.multiSelect = true; });
    expect(liveQuestion(multi, pane('cc300-ask-q2-of-2-single'))).toBeNull();
  });
});

describe('titleMatches: the question ends with the pane title (D-5089)', () => {
  it('strips the wrapped question\'s bar, and is case- and space-blind', () => {
    const order = FOUR_Q.questions[1]!.question;
    expect(titleMatches(order, '│ must land before any writer that relies on it?')).toBe(true);
    expect(titleMatches(order, '  │   MUST land  before any writer that relies on it?')).toBe(true);
    expect(titleMatches(order, '│ must land before any reader that relies on it?')).toBe(false);
  });

  it('an empty title names nothing', () => {
    expect(titleMatches('Which colour?', '')).toBe(false);
    expect(titleMatches('Which colour?', '│ ')).toBe(false);
  });
});

describe('namedQuestion: the question the pane title names (D-5089)', () => {
  it('names the multiSelect question by its title', () => {
    expect(namedQuestion(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-next-open'))).toBe(1);
    expect(namedQuestion(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-submit-open'))).toBe(2);
    expect(namedQuestion(FOUR_Q, pane('cc300-ask-wrapped-question'))).toBe(1);
  });

  it('an unrelated title, an empty one, a title two questions end with, or no dialog: null', () => {
    expect(namedQuestion(DRINK_FEATURES_TOOLS, screen('cc300-ask-multiselect-next-open', { title: 'Which pets?' })))
      .toBeNull();
    expect(namedQuestion(COLOUR_ONE, screen('cc300-ask-1q-open', { title: '' }))).toBeNull();
    const both = derive(CACHING_TRACING, (qs) => { qs[0]!.question = 'Really enable tracing?'; });
    expect(namedQuestion(both, pane('cc300-ask-same-labels-q2'))).toBeNull();
    expect(namedQuestion(COLOUR_ONE, null)).toBeNull();
  });
});

describe('isAskReview: the review screen, told by its body\'s last line and its two rows (D-5089)', () => {
  it('every recorded review screen', () => {
    for (const name of [
      'cc300-ask-review-same-labels', 'cc300-ask-review-cancel-focused', 'cc300-ask-review-skipped',
      'cc300-ask-review-multiselect', 'cc300-ask-review-1q-multiselect', 'cc300-ask-review-tick-order',
      'cc300-ask-review-4q-100col',
      // Taller than the parser's 20-row climb: its body has lost the heading, and its title is an answer row.
      'cc300-ask-review-4q-long',
    ]) {
      expect(isAskReview(pane(name)), name).toBe(true);
    }
    expect(pane('cc300-ask-review-4q-long').body).not.toMatch(/^Review your answers/);
  });

  it('a question screen is not the review', () => {
    expect(isAskReview(pane('cc300-ask-q1-of-2'))).toBe(false);
    expect(isAskReview(pane('cc300-ask-multiselect-next-open'))).toBe(false);
    expect(isAskReview(null)).toBe(false);
  });

  it('a permission prompt is not the review (DERIVED: Yes/No under its question)', () => {
    expect(isAskReview(screen('cc300-ask-same-labels-q1', {
      title: 'Do you want to proceed?', body: 'Bash command\n\nDo you want to proceed?',
      options: [{ index: 1, label: 'Yes' }, { index: 2, label: 'No' }],
    }))).toBe(false);
  });

  it('the review\'s last line over other rows is not the review (DERIVED)', () => {
    const review = pane('cc300-ask-review-same-labels');
    expect(isAskReview({ ...review, options: [{ index: 1, label: 'Yes' }, { index: 2, label: 'No' }] })).toBe(false);
    expect(isAskReview({ ...review, options: [...review.options, { index: 3, label: 'Chat about this' }] })).toBe(false);
  });

  it('Submit answers and Cancel under a body that does not end with the ready line are not the review (DERIVED)', () => {
    const review = pane('cc300-ask-review-same-labels');
    expect(isAskReview({ ...review, body: 'Review your answers\n\nEnable caching?\n   → Yes' })).toBe(false);
    expect(isAskReview({ ...review, body: undefined })).toBe(false);
    // An unparsed screen never is, whatever it carries.
    expect(isAskReview({ ...review, parsed: false })).toBe(false);
  });
});

describe('reviewSummary: the review\'s lines, read from raw (D-5089)', () => {
  it('a skipped question: the warning, then each answered question and its answer, and no ready line', () => {
    expect(reviewSummary(pane('cc300-ask-review-skipped'))).toEqual([
      '⚠ You have not answered all questions',
      '',
      ' ● Which pets do you like?',
      '   → Dogs',
      ' ● Which mode?',
      '   → Safe',
    ]);
  });

  it('the heading goes (it is the sheet\'s title), and so does the indent every line shares', () => {
    expect(reviewSummary(pane('cc300-ask-review-same-labels'))).toEqual([
      '● Enable caching?',
      '  → Yes',
      '● Enable tracing?',
      '  → - only in staging, sampled 10%',
    ]);
  });

  it('a review taller than the parser\'s climb is read whole, from the tab row down', () => {
    const d = pane('cc300-ask-review-4q-long');
    expect(d.body).not.toContain('→ Postgres');
    const lines = reviewSummary(d);
    expect(lines[0]).toBe('● Should the `ledger` table use **Postgres** or SQLite?');
    expect(lines).toContain('  → Postgres');
    expect(lines[2]).toMatch(/^│ ● When the new release is ready/);
    expect(lines.at(-1)).toMatch(/END-C$/);
    expect(lines.some((l) => /ready to submit/i.test(l) || /^review your answers$/i.test(l.trim()))).toBe(false);
  });

  it('a raw with no tab row starts after the rule (DERIVED)', () => {
    const review = pane('cc300-ask-review-same-labels');
    const tabRow = '←  ☒ Caching  ☒ Tracing  ✔ Submit  →';
    expect(review.raw).toContain(tabRow);
    const noTabs = { ...review, raw: review.raw.replace(`${tabRow}\n`, '') };
    expect(reviewSummary(noTabs)).toEqual(reviewSummary(review));
  });

  it('the LAST ready line is the review\'s (DERIVED: the same words said in chat above it)', () => {
    const review = pane('cc300-ask-review-same-labels');
    const anchor = 'Afterwards reply with the raw answers only.';
    expect(review.raw).toContain(anchor);
    const chatty = { ...review, raw: review.raw.replace(anchor, `${anchor}\n\nReady to submit your answers?`) };
    expect(reviewSummary(chatty)).toEqual(reviewSummary(review));
  });

  it('a screen with no ready line has no summary', () => {
    expect(reviewSummary(pane('cc300-ask-q1-of-2'))).toEqual([]);
  });
});

describe('freeTextSlot: the free-text row under the question\'s n options (D-5090)', () => {
  it('the empty row at n+1', () => {
    expect(freeTextSlot(pane('cc300-ask-same-labels-q2'), 2)).toEqual({ kind: 'empty', index: 3 });
    expect(freeTextSlot(pane('cc300-ask-freetext-walk-2-focused'), 2)).toEqual({ kind: 'empty', index: 3 });
  });

  it('a row holding text, with that text', () => {
    expect(freeTextSlot(pane('cc300-ask-freetext-held'), 2)).toEqual({ kind: 'held', index: 3, text: 'Mango' });
    expect(freeTextSlot(pane('cc300-ask-freetext-walk-3-typed'), 2))
      .toEqual({ kind: 'held', index: 3, text: '- only in staging, sampled 10%' });
  });

  it('a 1000-character answer is the row\'s label and description together', () => {
    const slot = freeTextSlot(pane('cc300-ask-freetext-1000'), 2);
    expect(slot.kind).toBe('held');
    const text = slot.kind === 'held' ? slot.text : '';
    expect(text).toHaveLength(1000);
    expect(text).toMatch(/^Sentence 01 of answer A: .* END-A$/);
  });

  it('the two-column layout has none: the row at n+1 is Chat about this', () => {
    expect(freeTextSlot(pane('ask-2col-chat-about'), 3)).toEqual({ kind: 'none' });
  });

  it('with n unknown, only the placeholder row is the slot', () => {
    expect(freeTextSlot(pane('cc300-ask-1q-open'), null)).toEqual({ kind: 'empty', index: 3 });
    expect(freeTextSlot(pane('cc300-ask-freetext-held'), null)).toEqual({ kind: 'none' });
  });

  it('no row at n+1, or an unparsed screen: none', () => {
    expect(freeTextSlot(pane('cc300-ask-same-labels-q2'), 4)).toEqual({ kind: 'none' });
    expect(freeTextSlot(pane('cc300-ask-multiselect-next-open'), 3)).toEqual({ kind: 'none' });
    expect(freeTextSlot(pane('cc300-ask-multiselect-next-open'), null)).toEqual({ kind: 'none' });
    // DERIVED: a recorded menu marked unparsed keeps its rows, and still offers no slot.
    expect(freeTextSlot(screen('cc300-ask-same-labels-q2', { parsed: false }), 2)).toEqual({ kind: 'none' });
  });

  it('rowText is the server\'s echo rule: label, then description, whitespace collapsed', () => {
    expect(rowText({ label: 'Mango' })).toBe('Mango');
    expect(rowText({ label: ' keep  it ', description: ' portable\tand  tested ' })).toBe('keep it portable and tested');
  });
});
