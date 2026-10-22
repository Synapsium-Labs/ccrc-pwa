// `askSource` (D-6325): the one pure function that decides what an ask surface may show. It is the wall between the
// pane's text and the page: every case here runs it over `askFixtures.ts` and asserts both what the answer CARRIES
// (the hook's or the transcript's own words) and what it does not (a debris string, `Dialog.title`, `body`, `raw`).
import { describe, expect, it } from 'vitest';
import type { Dialog } from '../../shared/api';
import { askSource, freeTextSlot, optionCopy, isUsableAsk, stripBox, type AskSource } from '../src/session/askLive';
import { heldCoordinatorWords } from '../src/session/sessionHeaderView';
import {
  ASK_DEBRIS, ASKER_COORD, HOOK_QUESTIONS, askFixture, hookEnvelope, type AskFixture,
} from './askFixtures';

const sourceOf = (f: AskFixture): AskSource => askSource({ ask: f.ask, dialog: f.dialog, askFrameSeen: f.askFrameSeen });

/** Every string anywhere in a value, keys excluded. */
const stringsOf = (v: unknown): string[] => {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(stringsOf);
  if (v !== null && typeof v === 'object') return Object.values(v).flatMap(stringsOf);
  return [];
};

/** The strings a source may never carry unless it is `menu`: the debris and the pane's own `title`, `body`, `raw`. */
const paneStrings = (d: Dialog | null): string[] => [
  ...ASK_DEBRIS, ...(d === null ? [] : [d.title, d.body ?? '', d.raw]),
].filter((s) => s !== '');

describe('askSource: what an ask surface may show (D-6325)', () => {
  it('a usable hook envelope is structured', () => {
    const src = sourceOf(askFixture(1));
    expect(src).toEqual({ kind: 'structured', questions: HOOK_QUESTIONS, from: 'hook' });
  });

  it('an aligned transcript copy is structured only when every row aligned', () => {
    const aligned = askFixture(2);
    const src = sourceOf(aligned);
    expect(src.kind).toBe('structured');
    if (src.kind !== 'structured') return;
    expect(src.from).toBe('transcript');
    expect(src.questions).toHaveLength(1);
    expect(src.questions[0]!.question).toBe(HOOK_QUESTIONS[0]!.question);
    expect(src.questions[0]!.options.map((o) => o.label)).toEqual(HOOK_QUESTIONS[0]!.options.map((o) => o.label));
    // One row that did not align (a `null`): the copy is partly the transcript's, partly unknown. No longer structured.
    const partial = askFixture(2);
    partial.dialog!.ask!.options = [partial.dialog!.ask!.options[0]!, null, partial.dialog!.ask!.options[2]!];
    expect(sourceOf(partial)).toEqual({ kind: 'ask-unreadable' });
    // A blank question has nothing to show either.
    const blank = askFixture(2);
    blank.dialog!.ask!.question = '  ';
    expect(sourceOf(blank)).toEqual({ kind: 'ask-unreadable' });
  });

  it('the review screen is review, and carries no raw line', () => {
    const f = askFixture(8);
    const src = sourceOf(f);
    expect(src).toEqual({
      kind: 'review',
      rows: { submit: 1, cancel: 2 },
      summary: [
        { header: 'Cache', answered: true },
        { header: 'Tracing', answered: false },
        { header: 'Regions', answered: true },
      ],
    });
    for (const s of stringsOf(src)) expect(paneStrings(f.dialog)).not.toContain(s);
  });

  it('a review with no structured copy lists no summary', () => {
    const f = askFixture(8);
    const src = askSource({ ask: null, dialog: f.dialog, askFrameSeen: true });
    expect(src).toEqual({ kind: 'review', rows: { submit: 1, cancel: 2 }, summary: [] });
    // And a tab row that does not count the questions marks nothing answered: a position fact only when it lines up.
    const two = { questions: HOOK_QUESTIONS.slice(0, 2) };
    const src2 = askSource({ ask: two, dialog: f.dialog, askFrameSeen: true });
    expect(src2).toEqual({
      kind: 'review', rows: { submit: 1, cancel: 2 },
      summary: [{ header: 'Cache', answered: null }, { header: 'Tracing', answered: null }],
    });
  });

  it('ask evidence with no full alignment is ask-unreadable, and carries no pane string', () => {
    for (const n of [3, 9, 10]) {
      const f = askFixture(n);
      const src = sourceOf(f);
      expect(src, `fixture ${n}`).toEqual({ kind: 'ask-unreadable' });
      for (const s of stringsOf(src)) expect(paneStrings(f.dialog), `fixture ${n}`).not.toContain(s);
    }
  });

  it('a free-text row drawn with box characters is still ask evidence', () => {
    // Fixture 10's only evidence is `│ Type something. │`; with the box stripped it is the placeholder row.
    const f = askFixture(10);
    expect(f.dialog!.options.at(-1)!.label).toContain('│');
    expect(f.dialog!.options.some((o) => /chat about this/i.test(o.label))).toBe(false);
    expect(sourceOf(f)).toEqual({ kind: 'ask-unreadable' });
    // Without the placeholder (the row holds typed text, none of the other evidence painted) it is only a menu.
    const typed = askFixture(10);
    typed.dialog!.options[2]!.label = '│ something I typed │';
    expect(sourceOf(typed).kind).toBe('menu');
  });

  it('freeTextSlot finds the placeholder row whatever box characters surround it', () => {
    const f = askFixture(10);
    expect(stripBox('│ Type something. │')).toBe('Type something.');
    expect(freeTextSlot(f.dialog!, null)).toEqual({ kind: 'empty', index: 3 });
    expect(freeTextSlot(f.dialog!, 2)).toEqual({ kind: 'empty', index: 3 });
  });

  it('a plan approval with no ask evidence is menu', () => {
    const f = askFixture(4);
    const src = sourceOf(f);
    expect(src).toEqual({ kind: 'menu', title: 'Ready to code?', options: f.dialog!.options });
  });

  it('an unparsed pane with no ask evidence is terminal-only and carries no pane string', () => {
    const f = askFixture(5);
    const src = sourceOf(f);
    expect(src).toEqual({ kind: 'terminal-only' });
    for (const s of stringsOf(src)) expect(paneStrings(f.dialog)).not.toContain(s);
  });

  it('before the connection\'s first ask frame, a scraped dialog is none', () => {
    expect(sourceOf(askFixture(0))).toEqual({ kind: 'none' });
    // Whatever the store still held from an earlier connection is ignored until this one's first frame.
    const stale = askFixture(1);
    expect(askSource({ ask: stale.ask, dialog: stale.dialog, askFrameSeen: false })).toEqual({ kind: 'none' });
    expect(askSource({ ask: { approval: { tool: 'Bash', summary: 'ls' } }, dialog: null, askFrameSeen: false }))
      .toEqual({ kind: 'none' });
  });

  it('no menu on a connection that has seen its frame is none', () => {
    expect(askSource({ ask: null, dialog: null, askFrameSeen: true })).toEqual({ kind: 'none' });
  });

  it('an approval envelope is approval', () => {
    const f = askFixture(7);
    expect(sourceOf(f)).toEqual({ kind: 'approval', approval: { tool: 'Bash', summary: 'git status' } });
    // With a menu up it is the same answer: the envelope names the call, the menu is only where the answer goes.
    expect(askSource({ ask: f.ask, dialog: askFixture(4).dialog, askFrameSeen: true }).kind).toBe('approval');
  });

  it('an envelope with no menu is still structured/approval', () => {
    const ask = askFixture(1).ask;
    expect(askSource({ ask, dialog: null, askFrameSeen: true })).toEqual({ kind: 'structured', questions: HOOK_QUESTIONS, from: 'hook' });
    expect(sourceOf(askFixture(7)).kind).toBe('approval');
  });

  it('an unusable envelope (a blank first question) is no envelope', () => {
    const blank = { questions: [{ question: ' ', options: [{ label: 'A' }] }] };
    expect(isUsableAsk(blank)).toBe(false);
    expect(isUsableAsk(null)).toBe(false);
    expect(isUsableAsk(hookEnvelope())).toBe(true);
    expect(askSource({ ask: blank, dialog: null, askFrameSeen: true })).toEqual({ kind: 'none' });
  });

  it('no variant but menu carries a string equal to a debris constant, the title, the body or the raw', () => {
    for (let n = 0; n <= 11; n++) {
      const f = askFixture(n);
      const src = sourceOf(f);
      if (src.kind === 'menu') continue;
      for (const s of stringsOf(src)) expect(paneStrings(f.dialog), `fixture ${n} (${src.kind})`).not.toContain(s);
    }
  });

  it('the held and held-idle fixtures answer exactly as fixture 1 does (who holds it is not a source)', () => {
    expect(sourceOf(askFixture(6))).toEqual(sourceOf(askFixture(1)));
    expect(sourceOf(askFixture(11))).toEqual(sourceOf(askFixture(1)));
  });
});

describe('optionCopy: a trailing (Recommended) becomes a flag (D-6325)', () => {
  it('strips one trailing (Recommended) and keeps \'Recommended reading\' whole', () => {
    expect(optionCopy('Redis (Recommended)')).toEqual({ label: 'Redis', recommended: true });
    expect(optionCopy('Redis (recommended)')).toEqual({ label: 'Redis', recommended: true });
    expect(optionCopy('Redis   (RECOMMENDED)  ')).toEqual({ label: 'Redis', recommended: true });
    expect(optionCopy('Redis(Recommended)')).toEqual({ label: 'Redis', recommended: true });
    expect(optionCopy('Redis (Recommended) (Recommended)')).toEqual({ label: 'Redis (Recommended)', recommended: true });
    expect(optionCopy('Recommended reading')).toEqual({ label: 'Recommended reading', recommended: false });
    expect(optionCopy('Use the (Recommended) path')).toEqual({ label: 'Use the (Recommended) path', recommended: false });
    expect(optionCopy('In-process')).toEqual({ label: 'In-process', recommended: false });
    // A label that is only the tag keeps itself: there would be nothing left to read.
    expect(optionCopy('(Recommended)')).toEqual({ label: '(Recommended)', recommended: false });
  });
});

describe('heldCoordinatorWords: the one derivation of who holds the question (D-6325)', () => {
  it('a working row names its coordinator', () => {
    const f = askFixture(6);
    const words = heldCoordinatorWords(f.session!, 'idle');
    expect(words).not.toBeNull();
    expect(words!.short).toBe('coord');
    expect(words!.title).toContain(ASKER_COORD);
  });

  it('an idle row that keeps withCoordinator shows no held words', () => {
    const f = askFixture(11);
    expect(f.session!.withCoordinator).not.toBeNull();
    expect(heldCoordinatorWords(f.session!, 'idle')).toBeNull();
  });

  it('no row reads as no words', () => {
    expect(heldCoordinatorWords(null, null)).toBeNull();
  });
});
