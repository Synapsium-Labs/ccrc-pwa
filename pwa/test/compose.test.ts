// The prompt composition rule, shared so the server that types a prompt and the
// PWA that recognises its echo can never disagree — plus its inverse, which has
// to cope with `ccd clip` typing a path on either side of the user's prose.
import { describe, expect, it } from 'vitest';
import { composePrompt, splitClipPaths, CLIP_PATH_RE } from '../../shared/api';

const P1 = '/home/you/.cc-clips/claude2-OpenClawHetzner/clip-20260726-150340-a1b2.png';
const P2 = '/home/you/.cc-clips/claude2-OpenClawHetzner/clip-20260726-150341-c3d4.jpg';

describe('composePrompt', () => {
  it('puts each attachment on its own line above the text', () => {
    expect(composePrompt('look at this', [P1])).toBe(`${P1}\nlook at this`);
    expect(composePrompt('two', [P1, P2])).toBe(`${P1}\n${P2}\ntwo`);
  });

  it('is the identity when there are no attachments', () => {
    expect(composePrompt('plain text', [])).toBe('plain text');
  });

  it('omits the blank line when an image is sent with no text', () => {
    expect(composePrompt('', [P1])).toBe(P1);
  });
});

describe('CLIP_PATH_RE', () => {
  it('exports a stateless regex — a g-flagged one would alternate true/false', () => {
    expect(CLIP_PATH_RE.test(P1)).toBe(true);
    expect(CLIP_PATH_RE.test(P1)).toBe(true);
  });
});

describe('splitClipPaths', () => {
  it('splits its own composed output back apart', () => {
    expect(splitClipPaths(composePrompt('look at this', [P1, P2]))).toEqual({
      paths: [P1, P2],
      rest: 'look at this',
    });
  });

  it('extracts a TRAILING path — what `ccd clip` produces when you type first', () => {
    // Verbatim from the transcript that motivated this feature.
    const raw =
      'Please make the handling of of screenshot attachments much nicer from a ' +
      `ui/ux perspective, what's there now is Poor ${P1}`;
    expect(splitClipPaths(raw)).toEqual({
      paths: [P1],
      rest:
        'Please make the handling of of screenshot attachments much nicer from a ' +
        "ui/ux perspective, what's there now is Poor",
    });
  });

  it('extracts a LEADING same-line path and eats ccd\'s trailing space', () => {
    expect(splitClipPaths(`${P1} what is this`)).toEqual({ paths: [P1], rest: 'what is this' });
  });

  it('extracts a MID-line path without doubling the surrounding spaces', () => {
    expect(splitClipPaths(`before ${P1} after`)).toEqual({ paths: [P1], rest: 'before after' });
  });

  it('reports a repeated path once', () => {
    expect(splitClipPaths(`${P1} and again ${P1}`)).toEqual({ paths: [P1], rest: 'and again' });
  });

  it('leaves a non-clip absolute path as prose', () => {
    const raw = 'see /etc/hosts and /home/me/photo.png';
    expect(splitClipPaths(raw)).toEqual({ paths: [], rest: raw });
  });

  it('returns text-only input untouched', () => {
    expect(splitClipPaths('nothing here')).toEqual({ paths: [], rest: 'nothing here' });
  });

  // The three below are the regression wall for the bug that shipped: this
  // function used to collapse runs of spaces on EVERY line, and MessageBubble
  // calls it on every user turn against a `white-space: pre-wrap` bubble — so
  // every pasted snippet in the whole history rendered flattened.
  it('leaves an indented code block byte-identical when there is no path', () => {
    const raw = [
      'here is the fix:',
      'function f() {',
      '    if (x) {',
      '        return 1;',
      '    }',
      '}',
    ].join('\n');
    expect(splitClipPaths(raw)).toEqual({ paths: [], rest: raw });
  });

  it('leaves an aligned table byte-identical', () => {
    const raw = [
      'name      | five | seven',
      '--------- | ---- | -----',
      'claude2   |  12% |   44%',
      'server-box |   3% |    9%',
    ].join('\n');
    expect(splitClipPaths(raw)).toEqual({ paths: [], rest: raw });
  });

  it('keeps the OTHER lines byte-identical when one interior line held a path', () => {
    const raw = `look at this\n${P1}\n    indented   tail`;
    expect(splitClipPaths(raw)).toEqual({
      paths: [P1],
      rest: 'look at this\n    indented   tail',
    });
  });

  it('does not eat the indentation of a message that OPENS indented', () => {
    const raw = '    const x = 1;\n        const y = 2;';
    expect(splitClipPaths(raw)).toEqual({ paths: [], rest: raw });
  });

  it('keeps a deliberate blank line when there is no path at all', () => {
    expect(splitClipPaths('paragraph one\n\nparagraph two')).toEqual({
      paths: [],
      rest: 'paragraph one\n\nparagraph two',
    });
  });

  it('keeps a deliberate blank line in a message that DOES carry a path', () => {
    expect(splitClipPaths(`${P1}\npara one\n\npara two`)).toEqual({
      paths: [P1],
      rest: 'para one\n\npara two',
    });
  });

  it('drops the line a path leaves empty, without merging the paragraphs around it', () => {
    expect(splitClipPaths(`line one\n${P1}\nline two`)).toEqual({
      paths: [P1],
      rest: 'line one\nline two',
    });
  });
});

describe('a leading blank line never reaches the box', () => {
  // VACUUM, not a red: nothing composes text with a leading newline today.
  //
  // The box cannot hold a leading blank line usefully and typing one destroys
  // the send proof: `sendPrompt` writes it with M-Enter, the marker row ends up
  // blank, and `submitted()`'s needle is the first NON-blank line — so it
  // returns true on its first poll whether or not Enter did anything. Measured:
  // a pane byte-identical before and after Enter returns {ok:true}, the route
  // answers 200, and the PWA deletes the optimistic bubble after 5 s with no
  // message anywhere.
  it('strips leading blank lines from the text', () => {
    expect(composePrompt('\n\nrun the tests', [])).toBe('run the tests');
  });

  it('strips a leading blank line that is only whitespace', () => {
    expect(composePrompt('   \n\t\nrun the tests', [])).toBe('run the tests');
  });

  it('leaves INTERIOR blank lines alone — they are the message', () => {
    expect(composePrompt('first\n\nsecond', [])).toBe('first\n\nsecond');
  });

  it('leaves TRAILING blank lines alone — only the marker row is at stake', () => {
    expect(composePrompt('first\n\n', [])).toBe('first\n\n');
  });

  it('strips before the attachment join, so the paths still lead', () => {
    expect(composePrompt('\ncaption', ['/c/clip-1.png'])).toBe('/c/clip-1.png\ncaption');
  });

  it('a text that is nothing but blank lines composes to nothing', () => {
    expect(composePrompt('\n\n  \n', [])).toBe('');
  });

  // The strip is LINE-WISE (`[^\S\n]*\n`), not `\s*`: a `\s*` strip would eat
  // the INDENTATION of the first content line too, so a prompt that opens with
  // a fenced code block or a bullet's hanging indent would arrive reflowed.
  it('keeps the indentation of the first CONTENT line', () => {
    expect(composePrompt('\n    indented first line', [])).toBe('    indented first line');
  });
});
