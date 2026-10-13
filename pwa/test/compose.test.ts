// The prompt composition rule, shared so the server that types a prompt and the
// PWA that recognises its echo can never disagree — plus its inverse, which has
// to cope with `ccd clip` typing a path on either side of the user's prose.
import { describe, expect, it } from 'vitest';
import {
  composePrompt, splitClipPaths, CLIP_EXTS, CLIP_PATH_RE, hasClipExt, isImageClip,
} from '../../shared/api';

const P1 = '/home/you/.cc-clips/claude2-demo-app-ts/clip-20260726-150340-a1b2.png';
const P2 = '/home/you/.cc-clips/claude2-demo-app-ts/clip-20260726-150341-c3d4.jpg';
const DOC = '/home/you/.cc-clips/claude2-demo-app-ts/clip-20260726-150342-e5f6-design-notes.md';

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

  // This regex is what lifts an attachment out of the bubble's prose. A
  // document path it does not recognise is not a missing thumbnail — the raw
  // path stays in the message as text, and no chip is drawn at all.
  it('recognises a document clip, stem and all', () => {
    expect(CLIP_PATH_RE.test(DOC)).toBe(true);
    expect(splitClipPaths(composePrompt('read this', [DOC])))
      .toEqual({ paths: [DOC], rest: 'read this' });
  });

  it('recognises every admitted extension, and nothing outside the list', () => {
    const base = '/home/you/.cc-clips/claude2-demo-app-ts/clip-20260726-150340-a1b2';
    for (const ext of CLIP_EXTS) expect(CLIP_PATH_RE.test(`${base}.${ext}`), ext).toBe(true);
    for (const ext of ['docx', 'zip', 'exe', 'svg', 'html']) {
      expect(CLIP_PATH_RE.test(`${base}.${ext}`), ext).toBe(false);
    }
  });
});

describe('the image / document split', () => {
  // Every renderer asks this to decide between a thumbnail and a name chip,
  // and it has to answer off a NAME — a bubble is rebuilt from prompt text,
  // which carries no MIME types at all.
  it('calls an image an image and a document not', () => {
    expect(isImageClip(P1)).toBe(true);
    expect(isImageClip(P2)).toBe(true);
    expect(isImageClip(DOC)).toBe(false);
    expect(isImageClip('/x/clip-1-a1b2-report.pdf')).toBe(false);
  });

  it('is case-blind, because a picked extension is whatever the user typed', () => {
    expect(isImageClip('Screenshot.PNG')).toBe(true);
    expect(hasClipExt('NOTES.MD')).toBe(true);
  });

  it('says no when there is no extension to read at all', () => {
    expect(isImageClip('/x/clip-1-a1b2')).toBe(false);
    expect(hasClipExt('/x/clip-1-a1b2')).toBe(false);
    expect(hasClipExt('')).toBe(false);
  });

  // A dot in a DIRECTORY name is not an extension — the clips dir itself is
  // `.cc-clips`, so a path with no dot in its last segment must not read the
  // tail of the folder name as one.
  it('reads the last segment only, never a dot from the path above it', () => {
    expect(hasClipExt('/home/you/.cc-clips/claude2-x/README')).toBe(false);
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
      'serverbox |   3% |    9%',
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
