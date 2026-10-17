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
  paneQuestion,
  paneTicks,
  questionCorresponds,
  questionKey,
  reviewSummary,
  rowText,
  slotHolds,
  slotHoldsPart,
  titleMatches,
  wantedTicks,
} from '../src/session/askLive';
import {
  CACHING_TRACING,
  COLOUR_ONE,
  DRINK_FEATURES_TOOLS,
  FOUR_Q,
  FRUIT_DRINK,
  TOOLS_SIZES,
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
    // The 2.1.222 multiSelect shape (`multiselect`): unparsed, and no `Dialog.multi` (no commit row on screen). DERIVED
    // envelope: that recording's prompt line is not captured, so its one question is read off the screen.
    const tools: AskEnvelope = { questions: [{ question: 'Select the tools to allow', multiSelect: true,
      options: [{ label: 'Bash' }, { label: 'Edit' }, { label: 'WebFetch' }] }] };
    expect(pane('multiselect').multi).toBeUndefined();
    expect(liveQuestion(tools, pane('multiselect'))).toBeNull();
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

  it('a multiSelect question corresponds through Dialog.multi, and never through a parsed menu (D-5091)', () => {
    // The boxes are the question's own options, so labels decide as they do for rows.
    expect(liveQuestion(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-next-open'))).toBe(1);
    expect(liveQuestion(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-digit1-3'))).toBe(1);
    expect(liveQuestion(DRINK_FEATURES_TOOLS, pane('cc300-ask-multiselect-submit-open'))).toBe(2);
    expect(liveQuestion(TOOLS_SIZES, pane('cc300-ask-multiselect-tools-open'))).toBe(0);
    expect(liveQuestion(TOOLS_SIZES, pane('cc300-ask-multiselect-sizes-large'))).toBe(1);
    expect(questionCorresponds(DRINK_FEATURES_TOOLS.questions[1]!, pane('cc300-ask-multiselect-next-open'))).toBe(true);
    // DERIVED: the envelope calls Features single-select. The pane says otherwise, and a tap on a box answers nothing.
    const single = derive(DRINK_FEATURES_TOOLS, (qs) => { qs[1]!.multiSelect = false; });
    expect(liveQuestion(single, pane('cc300-ask-multiselect-next-open'))).toBeNull();
    // DERIVED: an envelope question listing two of the pane's three boxes is another question. A box is the whole
    // question's, so the count must be equal, not merely covered (a parsed menu's rows run on past the options).
    const fewer = derive(DRINK_FEATURES_TOOLS, (qs) => { qs[1]!.options = qs[1]!.options.slice(0, 2); });
    expect(liveQuestion(fewer, pane('cc300-ask-multiselect-next-open'))).toBeNull();
    // DERIVED: a box label that disagrees at its position.
    const swapped = derive(DRINK_FEATURES_TOOLS, (qs) => { qs[1]!.options.reverse(); });
    expect(liveQuestion(swapped, pane('cc300-ask-multiselect-next-open'))).toBeNull();
  });
});

describe('paneTicks and wantedTicks: the set a multiSelect commit sends (D-5091)', () => {
  it('paneTicks reads the ticked boxes in screen order', () => {
    expect(paneTicks(pane('cc300-ask-multiselect-next-open').multi!)).toEqual([]);
    expect(paneTicks(pane('cc300-ask-multiselect-digit1-3').multi!)).toEqual([1, 3]);
    expect(paneTicks(pane('cc300-ask-multiselect-tools-revisit-digit2-1').multi!)).toEqual([1, 3]);
  });

  it('new ticks follow in the order they were tapped', () => {
    expect(wantedTicks(pane('cc300-ask-multiselect-tools-open').multi!, [3, 1])).toEqual([3, 1]);
  });

  it('a box already ticked on the pane keeps its place: it is never re-sent, so it never moves', () => {
    // `-digit1` has Logging ticked. Tracing tapped, then Logging unticked and ticked again: the pane still shows
    // Logging ticked, the server sends no digit for it, and the answer lists it where it already was.
    const multi = pane('cc300-ask-multiselect-digit1').multi!;
    expect(wantedTicks(multi, [3, 1])).toEqual([1, 3]);
    // A box the pane shows ticked but the set leaves out is unticked, so it is not listed at all.
    expect(wantedTicks(multi, [2])).toEqual([2]);
  });
});

describe('titleMatches: the question ends with the pane title (D-5089)', () => {
  it('strips the wrapped question\'s bar, and is case- and space-blind', () => {
    const order = FOUR_Q.questions[1]!.question;
    expect(titleMatches(order, '│ must land before any writer that relies on it?')).toBe(true);
    expect(titleMatches(order, '  │   MUST land  before any writer that relies on it?')).toBe(true);
    expect(titleMatches(order, '│ must land before any reader that relies on it?')).toBe(false);
  });

  it('a title the question only contains, not ends with, names nothing', () => {
    // A wrapped question's title is its LAST row: one of its earlier rows is not the question.
    const order = FOUR_Q.questions[1]!.question;
    expect(titleMatches(order, '│ machine reads files the first machine writes')).toBe(false);
    expect(titleMatches('Enable tracing in staging?', 'Enable tracing')).toBe(false);
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

/** A capture with every ready line taken out: the screen never painted it. */
const withoutReady = (raw: string): string => raw.split('\n').filter((l) => !/ready to submit your answers\?/i.test(l)).join('\n');

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
    // A third row under Submit answers and Cancel is the lenient arm's case (decision `ask-review-lenient-arm`): still
    // the review while the screen paints the ready line; without it, not.
    const third = { ...review, options: [...review.options, { index: 3, label: 'Chat about this' }] };
    expect(isAskReview(third)).toBe(true);
    expect(isAskReview({ ...third, raw: withoutReady(third.raw) })).toBe(false);
    // Each row is read: Submit answers over another second row is not it either.
    expect(isAskReview({ ...review, options: [review.options[0]!, { index: 2, label: 'Edit answers' }] })).toBe(false);
    expect(isAskReview({ ...review, options: [{ index: 1, label: 'Send' }, review.options[1]!] })).toBe(false);
  });

  it('Submit answers and Cancel on a screen that never paints the ready line are not the review (DERIVED)', () => {
    const review = pane('cc300-ask-review-same-labels');
    const raw = withoutReady(review.raw);
    expect(isAskReview({ ...review, raw, body: 'Review your answers\n\nEnable caching?\n   → Yes' })).toBe(false);
    expect(isAskReview({ ...review, raw, body: undefined })).toBe(false);
    // A body cut short of the ready line, on a screen that does paint it, is the lenient arm's (decision
    // `ask-review-lenient-arm`).
    expect(isAskReview({ ...review, body: 'Review your answers\n\nEnable caching?\n   → Yes' })).toBe(true);
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

  it('slotHolds and slotHoldsPart: the whole kept text, or only its start', () => {
    const typed = freeTextSlot(pane('cc300-ask-freetext-walk-3-typed'), 2);
    const text = '- only in staging, sampled 10%';
    expect(slotHolds(typed, text)).toBe(true);
    expect(slotHoldsPart(typed, text), 'the whole text is not a part of it').toBe(false);
    // The echo rule on both sides: whitespace collapsed, ends trimmed.
    expect(slotHoldsPart(typed, `${text} and nightly`)).toBe(true);
    expect(slotHoldsPart(typed, '-  only in staging,   sampled 10% and nightly ')).toBe(true);
    expect(slotHoldsPart(typed, 'only in staging')).toBe(false);
    // `Mango`, typed in the terminal, is not the start of another answer.
    expect(slotHoldsPart(freeTextSlot(pane('cc300-ask-freetext-held'), 2), 'Apple and Mango')).toBe(false);
    expect(slotHoldsPart(freeTextSlot(pane('cc300-ask-same-labels-q2'), 2), text), 'an empty row').toBe(false);
    expect(slotHoldsPart({ kind: 'held', index: 3, text: '' }, text), 'an empty held text is no part').toBe(false);
  });

  it('rowText is the server\'s echo rule: label, then description, whitespace collapsed', () => {
    expect(rowText({ label: 'Mango' })).toBe('Mango');
    expect(rowText({ label: ' keep  it ', description: ' portable\tand  tested ' })).toBe('keep it portable and tested');
  });
});

describe('questionKey: the question a free-text row belongs to, whatever the row holds (D-5090)', () => {
  it('typing into the row changes the dialog id but not the question', () => {
    const open = pane('cc300-ask-same-labels-q2');
    const typed = pane('cc300-ask-freetext-walk-3-typed');
    expect(typed.id).not.toBe(open.id);
    for (const name of ['cc300-ask-freetext-walk-2-focused', 'cc300-ask-freetext-walk-3-typed',
      'cc300-ask-freetext-walk-4-stepped-off', 'cc300-ask-freetext-walk-5-back-on-held']) {
      expect(questionKey(pane(name), 3), name).toBe(questionKey(open, 3));
    }
  });

  it('another question is another key, its title or any row other than the free-text one', () => {
    expect(questionKey(pane('cc300-ask-same-labels-q1'), 3)).not.toBe(questionKey(pane('cc300-ask-same-labels-q2'), 3));
    // DERIVED: the same title over one option more (no recording paints one): the row a refused call typed into is
    // a real option there.
    const drink = pane('cc300-ask-q2-of-2-single');
    const more = screen('cc300-ask-q2-of-2-single', {
      options: [
        { index: 1, label: 'Tea' }, { index: 2, label: 'Coffee' }, { index: 3, label: 'Water' },
        { index: 4, label: 'Type something.' }, { index: 5, label: 'Chat about this' },
      ],
    });
    expect(questionKey(more, 3)).not.toBe(questionKey(drink, 3));
    // DERIVED: an option relabelled under the same title.
    const relabelled = screen('cc300-ask-q2-of-2-single', {
      options: drink.options.map((o) => (o.index === 2 ? { ...o, label: 'Cocoa' } : o)),
    });
    expect(questionKey(relabelled, 3)).not.toBe(questionKey(drink, 3));
  });
});

describe('paneQuestion: the question and what the pane painted above it, without the ask\'s chrome (D-5089)', () => {
  it('drops the tab row and the question\'s own row', () => {
    expect(paneQuestion(pane('cc300-ask-q2-of-2-single'))).toEqual({ question: 'Which drink?', preamble: '' });
    expect(paneQuestion(pane('cc300-ask-markdown-question')))
      .toEqual({ question: 'Should the `ledger` table use **Postgres** or SQLite?', preamble: '' });
  });

  it('a wrapped question is its barred rows, joined, bars gone', () => {
    expect(paneQuestion(pane('cc300-ask-wrapped-question')))
      .toEqual({ question: FOUR_Q.questions[1]!.question, preamble: '' });
  });

  it('a one-question ask keeps its header above the question', () => {
    expect(paneQuestion(pane('cc300-ask-1q-open'))).toEqual({ question: 'Which colour?', preamble: 'Colour' });
    expect(paneQuestion(pane('ask-2col-chat-about')).preamble).toBe('Revised fix');
  });

  it('a body that never paints the title keeps the title and the whole body, the tab row aside (DERIVED)', () => {
    expect(paneQuestion(screen('cc300-ask-q2-of-2-single', { title: 'Do you want to proceed?', body: 'Bash command\n\n  rm -rf build' })))
      .toEqual({ question: 'Do you want to proceed?', preamble: 'Bash command\n\n  rm -rf build' });
    expect(paneQuestion(screen('cc300-ask-q2-of-2-single', { body: undefined }))).toEqual({ question: 'Which drink?', preamble: '' });
    // Only the LAST painting of the title is the question: an earlier line that reads the same is the pane's.
    expect(paneQuestion(screen('cc300-ask-q2-of-2-single', { body: 'Which drink?\n\nFor the team call\n\nWhich drink?' })))
      .toEqual({ question: 'Which drink?', preamble: 'Which drink?\n\nFor the team call' });
  });
});
